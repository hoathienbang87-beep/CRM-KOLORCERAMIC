import {buildCatalogImportPreview, parseCatalogExcelWorkbook} from "../product-import/index.js";
import {cleanText, formatSize, formatVnd} from "./catalog-admin-api.js";

const STATUS_LABELS={STAGED:"Chờ xử lý",READY:"Sẵn sàng",APPLIED:"Đã áp dụng",FAILED:"Lỗi",CANCELLED:"Đã rollback"};
const DISPOSITION_LABELS={READY:"Sẵn sàng",UPDATING:"Đang cập nhật",MISSING_PRICE:"Thiếu giá",MANUAL_REVIEW:"Cần duyệt",DUPLICATE:"Trùng",CONFLICT:"Xung đột",EXCLUDED_BY_REVIEW:"Đã loại"};

function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);}
function uuid(){
  if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
  if(globalThis.crypto?.getRandomValues){
    const bytes=globalThis.crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=[...bytes].map(value=>value.toString(16).padStart(2,"0"));
    return `${hex.slice(0,4).join("")}-${hex.slice(4,6).join("")}-${hex.slice(6,8).join("")}-${hex.slice(8,10).join("")}-${hex.slice(10).join("")}`;
  }
  throw new Error("Trình duyệt chưa hỗ trợ mã thao tác an toàn.");
}
function filenameExtension(file){return cleanText(file?.name).split(".").pop()?.toLowerCase()||"";}
function dateLabel(value){const date=value?new Date(`${String(value).slice(0,10)}T00:00:00`):null;return date&&!Number.isNaN(date.getTime())?new Intl.DateTimeFormat("vi-VN").format(date):"—";}
function statusClass(value){return value==="READY"||value==="APPLIED"?"green":value==="FAILED"||value==="CONFLICT"?"red":"amber";}
function candidates(row){const match=row?.source_values?.catalog_match||{};return [...(match.candidates||[]),...(match.suggestions||[])].filter((item,index,all)=>item?.id&&all.findIndex(candidate=>candidate.id===item.id)===index);}
function currentPrice(row){return row?.previous_snapshot?.price_per_m2??null;}
function proposedPrice(row){return row?.proposed_snapshot?.price_per_m2??row?.price_per_m2??null;}
function delta(row){const before=Number(currentPrice(row)),after=Number(proposedPrice(row));if(!Number.isFinite(before)||!Number.isFinite(after))return null;return after-before;}
function rowSize(row){return formatSize({width_mm:row.width_mm,height_mm:row.height_mm});}
function fileSize(bytes){return bytes<1024?`${bytes} B`:bytes<1048576?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1048576).toFixed(1)} MB`;}

async function sha256(buffer){
  if(!globalThis.crypto?.subtle)throw new Error("Trình duyệt không hỗ trợ kiểm tra SHA-256.");
  const hash=await globalThis.crypto.subtle.digest("SHA-256",buffer);
  return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}

function errorText(error){
  const message=cleanText(error?.message);
  if(/source_adapter_key|duplicate key/i.test(message))return "File này đã được tạo preview trước đó. Hãy mở batch trong lịch sử.";
  if(/APPROVAL_REQUIRED/i.test(message))return "Batch chưa được duyệt.";
  if(/NOT_READY|UNRESOLVED/i.test(message))return "Batch còn dòng chưa xử lý nên chưa thể áp dụng.";
  if(/VERSION|STALE/i.test(message))return "Catalog đã thay đổi sau preview. Hãy tạo preview mới.";
  if(/ROLLBACK_VERSION_CONFLICT/i.test(message))return "Không thể rollback vì sản phẩm đã có cập nhật mới hơn.";
  if(/ADMIN_REQUIRED|permission|row-level/i.test(message))return "Tài khoản không có quyền quản trị import.";
  return message||"Không thể hoàn tất thao tác import.";
}

export function createCatalogAdminImport({api,root=document,notify=()=>{}}){
  const $=id=>root.getElementById(id);
  const state={batch:null,history:[],busy:false,loaded:false,approvalKeys:new Map(),applyKeys:new Map(),rollbackKeys:new Map()};

  function setMessage(message,type=""){
    const element=$("adminImportMessage");if(!element)return;
    element.textContent=message;element.className=`import-message ${type}`.trim();
  }
  function setBusy(value){
    state.busy=value;
    for(const id of ["adminImportPreviewButton","adminImportReload","adminImportApprove","adminImportApply"])if($(id))$(id).disabled=value;
  }
  function decisionMarkup(row){
    if(row.approved_at)return "";
    const options=candidates(row);
    const select=options.length?`<select class="candidate-select" data-candidate-row="${escapeHtml(row.id)}"><option value="">Chọn ứng viên…</option>${options.map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml([item.code,item.name,rowSize(item),item.surface].filter(Boolean).join(" · "))}</option>`).join("")}</select>`:"";
    return `<div class="row-decision">${select}<div class="row-decision-actions">${options.length?`<button class="button secondary" type="button" data-use-candidate="${escapeHtml(row.id)}">Chọn</button>`:""}<button class="button ghost" type="button" data-exclude-row="${escapeHtml(row.id)}">Loại</button></div></div>`;
  }
  function rowBadges(row){return `<span class="badge ${statusClass(row.disposition)}">${escapeHtml(DISPOSITION_LABELS[row.disposition]||row.disposition)}</span><span class="badge">${escapeHtml(row.selected_action)}</span>`;}
  function deltaMarkup(row){const value=delta(row);if(value===null||value===0)return value===0?"Không đổi":"—";return `<span class="${value>0?"price-up":"price-down"}">${value>0?"+":""}${escapeHtml(formatVnd(value))}</span>`;}

  function renderBatch(){
    const batch=state.batch,panel=$("adminImportPreviewPanel");
    panel?.classList.toggle("hide",!batch);if(!batch)return;
    const rows=(batch.rows||[]).filter(row=>!$("adminImportRowFilter")?.value||row.disposition===$("adminImportRowFilter").value);
    $("adminImportBatchTitle").textContent=batch.source_filename;
    $("adminImportBatchMeta").textContent=`${batch.import_mode==="PRICE_UPDATE_ONLY"?"Chỉ cập nhật giá":"Nhập catalog"} · Hiệu lực ${dateLabel(batch.effective_date)} · ${batch.source_format}`;
    $("adminImportBatchBadges").innerHTML=`<span class="badge ${statusClass(batch.status)}">${escapeHtml(STATUS_LABELS[batch.status]||batch.status)}</span>${batch.approved_at?'<span class="badge green">Đã duyệt</span>':''}`;
    const summary=batch.summary||{};
    $("adminImportTotalRows").textContent=summary.total||0;$("adminImportCreateRows").textContent=summary.create||0;$("adminImportUpdateRows").textContent=summary.update||0;$("adminImportConflictRows").textContent=summary.unresolved||0;
    $("adminImportFilteredCount").textContent=`Hiển thị ${rows.length}/${summary.total||0} dòng`;
    $("adminImportRows").innerHTML=rows.map(row=>`<tr><td>${escapeHtml([row.source_sheet,row.source_row_number].filter(Boolean).join(" #"))}</td><td><b>${escapeHtml(row.name||"Chưa có tên")}</b><br><small>${escapeHtml(row.code||"")}</small><div class="badges">${rowBadges(row)}</div></td><td>${escapeHtml(rowSize(row))}<br><small>${escapeHtml(row.surface||"—")}</small></td><td class="money">${escapeHtml(formatVnd(currentPrice(row)))}</td><td class="money">${escapeHtml(formatVnd(proposedPrice(row)))}</td><td>${deltaMarkup(row)}</td><td>${decisionMarkup({...row,approved_at:batch.approved_at})}</td></tr>`).join("");
    $("adminImportRowCards").innerHTML=rows.map(row=>`<article class="import-row-card"><div><h3>${escapeHtml(row.name||"Chưa có tên")}</h3><div class="badges">${rowBadges(row)}</div></div><dl><div><dt>Quy cách</dt><dd>${escapeHtml(rowSize(row))}</dd></div><div><dt>Chênh lệch</dt><dd>${deltaMarkup(row)}</dd></div><div><dt>Giá hiện tại</dt><dd>${escapeHtml(formatVnd(currentPrice(row)))}</dd></div><div><dt>Giá đề xuất</dt><dd>${escapeHtml(formatVnd(proposedPrice(row)))}</dd></div></dl>${decisionMarkup({...row,approved_at:batch.approved_at})}</article>`).join("");
    const approve=$("adminImportApprove"),apply=$("adminImportApply");
    approve.disabled=state.busy||batch.status!=="READY"||Boolean(batch.approved_at);
    apply.disabled=state.busy||batch.status!=="READY"||!batch.approved_at;
    $("adminImportGateHelp").textContent=batch.status==="STAGED"?"Hãy chọn ứng viên hoặc loại toàn bộ dòng xung đột.":batch.status==="APPLIED"?"Batch đã được áp dụng. Có thể rollback từ lịch sử nếu chưa có thay đổi mới hơn.":batch.approved_at?"Batch đã duyệt và sẵn sàng áp dụng.":"Catalog chưa đổi. Hãy kiểm tra kỹ rồi duyệt batch.";
  }

  function renderHistory(){
    const target=$("adminImportHistory");if(!target)return;
    if(!state.history.length){target.innerHTML='<p class="muted">Chưa có batch phù hợp.</p>';return;}
    target.innerHTML=state.history.map(batch=>`<article class="history-item"><div><h3>${escapeHtml(batch.source_filename)}</h3><p>${escapeHtml(batch.supplier)} · ${dateLabel(batch.effective_date)} · ${(batch.summary?.total||0)} dòng</p><div class="badges"><span class="badge ${statusClass(batch.status)}">${escapeHtml(STATUS_LABELS[batch.status]||batch.status)}</span><span class="badge">${escapeHtml(batch.import_mode)}</span></div></div><div class="history-actions"><button class="button secondary" type="button" data-open-batch="${escapeHtml(batch.id)}">Xem</button>${batch.status==="APPLIED"?`<button class="button ghost" type="button" data-rollback-batch="${escapeHtml(batch.id)}">Rollback</button>`:""}</div></article>`).join("");
  }

  async function loadHistory({force=false}={}){
    if(state.busy&&!force)return;setBusy(true);
    try{const result=await api.listImportBatches(cleanText($("adminImportHistoryFilter")?.value)||null);state.history=result?.items||[];state.loaded=true;renderHistory();}
    catch(error){setMessage(errorText(error),"error");}
    finally{setBusy(false);renderBatch();}
  }
  async function openBatch(batchId){
    setBusy(true);try{state.batch=await api.getImportBatch(batchId);renderBatch();$("adminImportPreviewPanel")?.scrollIntoView({behavior:"smooth",block:"start"});}
    catch(error){setMessage(errorText(error),"error");}finally{setBusy(false);renderBatch();}
  }

  async function createPreview(event){
    event.preventDefault();if(state.busy)return;
    const file=$("adminImportFile")?.files?.[0];
    if(!file){setMessage("Hãy chọn một file Excel hoặc PDF.","error");return;}
    const extension=filenameExtension(file);
    if(extension==="pdf"||file.type==="application/pdf"){
      state.batch=null;renderBatch();
      setMessage(`PDF “${file.name}” đã được nhận diện nhưng đang chờ OCR và duyệt thủ công. Không có preview database và không thể apply.`,"pending");return;
    }
    if(!["xlsx","xls"].includes(extension)){setMessage("Chỉ hỗ trợ file .xlsx, .xls hoặc .pdf.","error");return;}
    if(!globalThis.XLSX?.read){setMessage("Chưa tải được bộ đọc Excel. Hãy kiểm tra mạng và tải lại trang.","error");return;}
    setBusy(true);setMessage("Đang đọc Excel, đối chiếu catalog và tạo preview…");
    try{
      const buffer=await file.arrayBuffer();
      const workbook=globalThis.XLSX.read(buffer,{type:"array",raw:true,cellDates:false});
      const parsed=parseCatalogExcelWorkbook(workbook);
      if(!parsed.ok)throw new Error(`Không tìm thấy bảng hợp lệ (${parsed.error?.code||"PARSE_ERROR"}).`);
      const products=await api.catalogSnapshot();
      const digest=await sha256(buffer);
      const batch={supplier:cleanText($("adminImportSupplier").value),source_filename:file.name,source_sha256:digest,source_file_size_bytes:file.size,parser_adapter:"CATALOG_06B_XLSX",parser_version:"1.0.0",effective_date:$("adminImportEffectiveDate").value,import_mode:$("adminImportMode").value,source_format:"EXCEL",source_metadata:{prompt:"06B",sheet:parsed.metadata?.sheet_name||null,header_row:parsed.metadata?.header_row||null}};
      if(!batch.supplier||!batch.effective_date)throw new Error("Nhà cung cấp và ngày hiệu lực là bắt buộc.");
      const preview=buildCatalogImportPreview({batch,rows:parsed.rows,products});
      const result=await api.previewImport(preview.batch,preview.rows);
      state.batch=await api.getImportBatch(result.batch_id);
      setMessage(`Đã tạo preview ${result.rows} dòng. Catalog chưa thay đổi.`);
      await loadHistory({force:true});renderBatch();
    }catch(error){setMessage(errorText(error),"error");}
    finally{setBusy(false);renderBatch();}
  }

  async function review(rowId,decision,candidateProductId=null){
    if(!state.batch||state.busy)return;setBusy(true);
    try{state.batch=await api.reviewImportRows(state.batch.id,[{row_id:rowId,decision,...(candidateProductId?{candidate_product_id:candidateProductId}:{})}]);notify("Đã lưu quyết định cho dòng import.");await loadHistory({force:true});}
    catch(error){setMessage(errorText(error),"error");}finally{setBusy(false);renderBatch();}
  }
  async function approve(){
    if(!state.batch||state.busy)return;
    if(!confirm("Duyệt batch này để cho phép áp dụng? Catalog vẫn chưa thay đổi ở bước này."))return;
    setBusy(true);try{const key=state.approvalKeys.get(state.batch.id)||uuid();state.approvalKeys.set(state.batch.id,key);await api.approveImport(state.batch.id,key);state.batch=await api.getImportBatch(state.batch.id);notify("Đã duyệt batch import.");await loadHistory({force:true});}
    catch(error){setMessage(errorText(error),"error");}finally{setBusy(false);renderBatch();}
  }
  async function apply(){
    if(!state.batch||state.busy)return;
    if(!confirm(`Áp dụng batch “${state.batch.source_filename}”? Thay đổi sẽ được ghi vào catalog và audit.`))return;
    setBusy(true);try{const key=state.applyKeys.get(state.batch.id)||uuid();state.applyKeys.set(state.batch.id,key);await api.applyImport(state.batch.id,key);state.batch=await api.getImportBatch(state.batch.id);setMessage("Đã áp dụng batch thành công.");notify("Catalog đã được cập nhật từ batch đã duyệt.");await loadHistory({force:true});}
    catch(error){setMessage(errorText(error),"error");}finally{setBusy(false);renderBatch();}
  }
  async function rollback(batchId){
    if(state.busy||!confirm("Rollback batch này? Thao tác sẽ bị từ chối nếu sản phẩm đã có thay đổi mới hơn."))return;
    setBusy(true);try{const key=state.rollbackKeys.get(batchId)||uuid();state.rollbackKeys.set(batchId,key);await api.rollbackImport(batchId,key);state.batch=await api.getImportBatch(batchId);setMessage("Đã rollback batch thành công.");notify("Catalog đã được khôi phục theo batch.");await loadHistory({force:true});}
    catch(error){setMessage(errorText(error),"error");}finally{setBusy(false);renderBatch();}
  }

  function showPage(page){
    root.querySelectorAll("[data-admin-view]").forEach(view=>view.classList.toggle("hide",view.dataset.adminView!==page));
    root.querySelectorAll("[data-admin-page]").forEach(button=>{const active=button.dataset.adminPage===page;button.classList.toggle("active",active);button.toggleAttribute("aria-current",active);});
    if(page==="import"&&!state.loaded)loadHistory();
  }
  function bind(){
    $("adminImportEffectiveDate").value=new Date().toISOString().slice(0,10);
    root.querySelectorAll("[data-admin-page]").forEach(button=>button.addEventListener("click",()=>showPage(button.dataset.adminPage)));
    $("adminImportForm")?.addEventListener("submit",createPreview);
    $("adminImportFile")?.addEventListener("change",event=>{const file=event.target.files?.[0];$("adminImportFileMeta").textContent=file?`${file.name} · ${fileSize(file.size)}`:"";});
    $("adminImportReload")?.addEventListener("click",loadHistory);
    $("adminImportHistoryFilter")?.addEventListener("change",loadHistory);
    $("adminImportRowFilter")?.addEventListener("change",renderBatch);
    $("adminImportApprove")?.addEventListener("click",approve);$("adminImportApply")?.addEventListener("click",apply);
    $("adminImportRows")?.addEventListener("click",handleDecisionClick);$("adminImportRowCards")?.addEventListener("click",handleDecisionClick);
    $("adminImportHistory")?.addEventListener("click",event=>{const open=event.target.closest("[data-open-batch]");if(open)openBatch(open.dataset.openBatch);const rollbackButton=event.target.closest("[data-rollback-batch]");if(rollbackButton)rollback(rollbackButton.dataset.rollbackBatch);});
  }
  function handleDecisionClick(event){
    const exclude=event.target.closest("[data-exclude-row]");if(exclude)review(exclude.dataset.excludeRow,"EXCLUDE");
    const use=event.target.closest("[data-use-candidate]");if(use){const select=root.querySelector(`[data-candidate-row="${CSS.escape(use.dataset.useCandidate)}"]`);if(!select?.value){setMessage("Hãy chọn một ứng viên trước.","error");return;}review(use.dataset.useCandidate,"USE_CANDIDATE",select.value);}
  }

  return {bind,showPage,loadHistory,openBatch,renderBatch,state};
}
