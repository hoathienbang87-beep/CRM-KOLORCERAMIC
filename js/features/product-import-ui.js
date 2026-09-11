import {ProductImportWorkerClient,parserResultToStagePayload,sha256Hex,validateProductImportFile} from "./product-import-client.js";

const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const labels={NEW:"Mới",PRICE_CHANGED:"Đổi giá",INFO_CHANGED:"Đổi thông tin",UNCHANGED:"Không đổi",REVIEW:"Cần xem",DUPLICATE_IN_FILE:"Trùng trong file",INVALID:"Không hợp lệ"};
const money=value=>value==null?"—":`${new Intl.NumberFormat("vi-VN").format(Number(value))} ₫`;

export function summarizeImportRows(rows=[]){
  return rows.reduce((out,row)=>{out.total++;out[row.classification]=(out[row.classification]||0)+1;if(row.selected_action==="CREATE")out.create++;if(row.selected_action==="UPDATE")out.update++;return out;},{total:0,create:0,update:0});
}

export function createProductImportController({rpc,notice=()=>{}}){
  const worker=new ProductImportWorkerClient();
  const state={batch:null,rows:[],filter:"ALL",busy:false,detailId:null};
  const el=id=>document.getElementById(id);
  const setStatus=(text,bad=false)=>{const target=el("productImportStatus");if(target){target.textContent=text;target.classList.toggle("bad",bad);}};
  const visibleRows=()=>state.rows.filter(row=>state.filter==="ALL"||row.classification===state.filter);
  function render(){
    const batch=state.batch,summary=summarizeImportRows(state.rows);
    el("productImportEmpty")?.classList.toggle("hide",!!batch);
    el("productImportPreview")?.classList.toggle("hide",!batch);
    if(!batch)return;
    el("productImportBatchMeta").textContent=`${batch.source_filename||"PDF"} · Hiệu lực ${batch.effective_date||"—"} · ${batch.created_by_name||"Người tải hiện tại"} · ${new Date(batch.created_at||Date.now()).toLocaleString("vi-VN")}`;
    el("productImportReadyState").textContent=batch.status==="READY"?"Sẵn sàng cho bước xác nhận":"Còn nội dung cần xem và lưu quyết định";
    el("productImportReadyState").className=`product-import-ready ${batch.status==="READY"?"is-ready":""}`;
    el("productImportSummary").innerHTML=[['Tổng dòng',summary.total],['Mới',summary.NEW||0],['Đổi giá',summary.PRICE_CHANGED||0],['Cần xem',(summary.REVIEW||0)+(summary.DUPLICATE_IN_FILE||0)+(summary.INVALID||0)],['Đã chọn',summary.create+summary.update]].map(([label,value])=>`<div><b>${value}</b><span>${label}</span></div>`).join("");
    const rows=visibleRows();
    el("productImportRows").innerHTML=rows.length?rows.map(row=>`<tr>
      <td>${esc(row.source_row_number||row.stt||"—")}</td><td><b>${esc(row.code||"—")}</b><div class="muted">${esc(row.name||"—")}</div></td>
      <td>${esc(row.width_cm||"—")} × ${esc(row.height_cm||"—")} cm</td><td>${money(row.price_per_m2)}</td>
      <td><span class="pill product-import-${esc(row.classification).toLowerCase()}">${esc(labels[row.classification]||row.classification)}</span>${row.review_reason?`<div class="muted">${esc(row.review_reason)}</div>`:""}</td>
      <td><select aria-label="Quyết định cho ${esc(row.code)}" data-import-action="${esc(row.id)}"><option value="NONE" ${row.selected_action==="NONE"?'selected':''}>Chưa chọn</option><option value="CREATE" ${row.selected_action==="CREATE"?'selected':''}>Tạo mới</option><option value="UPDATE" ${row.selected_action==="UPDATE"?'selected':''}>Cập nhật</option><option value="SKIP" ${row.selected_action==="SKIP"?'selected':''}>Bỏ qua</option></select></td>
      <td><button type="button" class="small" data-import-detail="${esc(row.id)}">Chi tiết</button></td></tr>`).join(""):`<tr><td colspan="7" class="muted">Không có dòng phù hợp.</td></tr>`;
    el("productImportCards").innerHTML=rows.map(row=>`<article class="product-import-card"><div><b>${esc(row.code||"—")}</b><span class="pill">${esc(labels[row.classification]||row.classification)}</span></div><p>${esc(row.name||"—")}</p><button type="button" data-import-detail="${esc(row.id)}">Xem chi tiết</button></article>`).join("");
    el("productImportOriginAccept").checked=!!batch.origin_accepted;
    const drawer=el("productImportDetail");
    const row=state.rows.find(item=>item.id===state.detailId);
    if(drawer&&row){drawer.classList.remove("hide");drawer.removeAttribute("inert");el("productImportDetailTitle").textContent=`${row.code||"Dòng"} · ${labels[row.classification]||row.classification}`;el("productImportDetailBody").innerHTML=`${row.is_stale?'<p class="maintenance-note">Dữ liệu sản phẩm đã thay đổi sau khi bảng giá được tải lên.</p>':''}<dl class="product-import-diff"><dt>Dữ liệu nguồn</dt><dd><pre>${esc(JSON.stringify(row.source_values||{},null,2))}</pre></dd><dt>So sánh hiện tại</dt><dd><pre>${esc(JSON.stringify(row.diff||{},null,2))}</pre></dd><dt>Cảnh báo</dt><dd>${esc((row.warnings||[]).map(w=>w.code||w).join(", ")||"Không có")}</dd></dl>${row.surface_candidate?`<label><input type="checkbox" data-import-surface="${esc(row.id)}" ${row.surface_accepted?'checked':''}> Áp dụng bề mặt đề xuất: ${esc(row.surface_candidate)}</label>`:""}${row.classification==='DUPLICATE_IN_FILE'?`<div class="actions"><button type="button" data-import-duplicate="${esc(row.duplicate_group_id)}" data-import-resolution="COLLAPSE" data-import-representative="${esc(row.id)}" ${row.duplicate_kind!=='IDENTICAL'?'disabled':''}>Giữ dòng này, gộp bản trùng</button><button type="button" data-import-duplicate="${esc(row.duplicate_group_id)}" data-import-resolution="SKIP_GROUP">Bỏ qua cả nhóm</button></div>`:""}`;}
  }
  async function reload(batchId){const data=await rpc("crm_get_product_import",{p_batch_id:batchId});state.batch=data.batch;state.rows=data.rows||[];render();}
  async function stageFile(file){
    if(state.busy)return;state.busy=true;setStatus("Đang đọc và phân tích PDF trong trình duyệt...");
    try{
      const sourceBuffer=await file.arrayBuffer();validateProductImportFile(file,sourceBuffer);
      const hash=await sha256Hex(sourceBuffer);const parserResult=await worker.parse(sourceBuffer.slice(0),hash);
      if(!parserResult?.ok)throw new Error(parserResult?.error?.message||"Parser không nhận diện được bảng giá.");
      setStatus("Đang gửi dữ liệu chuẩn hóa lên vùng staging...");
      const payload=parserResultToStagePayload(file,parserResult,hash);
      const staged=await rpc("crm_stage_product_import",{p_batch:payload.batch,p_rows:payload.rows,p_request_id:crypto.randomUUID()});
      await reload(staged.batch_id);setStatus("Đã tạo bản xem trước. PDF gốc vẫn chỉ ở máy của bạn.");notice("Đã tạo bản xem trước bảng giá.");
    }catch(error){if(error?.name!=="AbortError")setStatus(error?.message||"Không thể xử lý PDF.",true);}finally{state.busy=false;}
  }
  async function save(decisions){if(!state.batch)return;setStatus("Đang lưu quyết định...");try{await rpc("crm_update_product_import_review",{p_batch_id:state.batch.id,p_decisions:decisions});await reload(state.batch.id);setStatus("Đã lưu quyết định.");}catch(error){setStatus(error?.message||"Không lưu được quyết định.",true);}}
  function bind(){
    document.querySelectorAll("[data-product-tab]").forEach(button=>button.addEventListener("click",()=>{
      const importing=button.dataset.productTab==="import";
      el("productCatalogView")?.classList.toggle("hide",importing);
      el("productImportView")?.classList.toggle("hide",!importing);
      el("productImportView")?.toggleAttribute("inert",!importing);
      el("productCatalogTab")?.setAttribute("aria-selected",String(!importing));
      el("productImportTab")?.setAttribute("aria-selected",String(importing));
      el("addProductBtn")?.classList.toggle("hide",importing);
      if(importing)el("productImportFile")?.focus();
    }));
    el("productImportFile")?.addEventListener("change",event=>{const files=event.target.files;if(files?.length===1)stageFile(files[0]);else if(files?.length>1)setStatus("Mỗi batch chỉ nhận một file PDF.",true);});
    const drop=el("productImportDropzone");["dragenter","dragover"].forEach(type=>drop?.addEventListener(type,event=>{event.preventDefault();drop.classList.add("is-dragging");}));["dragleave","drop"].forEach(type=>drop?.addEventListener(type,event=>{event.preventDefault();drop.classList.remove("is-dragging");if(type==="drop"){const files=event.dataTransfer?.files;if(files?.length===1)stageFile(files[0]);else setStatus("Mỗi batch chỉ nhận một file PDF.",true);}}));
    el("cancelProductImportParse")?.addEventListener("click",()=>{worker.cancel();setStatus("Đã hủy phân tích PDF.");});
    el("productImportFilters")?.addEventListener("click",event=>{const button=event.target.closest("[data-import-filter]");if(button){state.filter=button.dataset.importFilter;render();}});
    el("productImportPreview")?.addEventListener("change",event=>{const action=event.target.closest("[data-import-action]");if(action)save({rows:[{row_id:action.dataset.importAction,selected_action:action.value}]});const surface=event.target.closest("[data-import-surface]");if(surface)save({rows:[{row_id:surface.dataset.importSurface,surface_accepted:surface.checked}]});if(event.target.id==="productImportOriginAccept")save({origin_accepted:event.target.checked});});
    el("productImportPreview")?.addEventListener("click",async event=>{const detail=event.target.closest("[data-import-detail]");if(detail){state.detailId=detail.dataset.importDetail;render();el("closeProductImportDetail")?.focus();}if(event.target.closest("#closeProductImportDetail")){state.detailId=null;el("productImportDetail")?.classList.add("hide");el("productImportDetail")?.setAttribute("inert","");}const duplicate=event.target.closest("[data-import-duplicate]");if(duplicate){await save({duplicates:[{duplicate_group_id:duplicate.dataset.importDuplicate,resolution:duplicate.dataset.importResolution,representative_row_id:duplicate.dataset.importRepresentative||null}]});state.detailId=null;}if(event.target.closest("#refreshProductImport")){await rpc("crm_refresh_product_import",{p_batch_id:state.batch.id});await reload(state.batch.id);}});
  }
  return {state,bind,render,reload,stageFile,cancel:()=>worker.cancel()};
}
