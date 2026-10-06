import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";

const playwrightEntry=process.env.CATALOG_ADMIN_PLAYWRIGHT_ENTRY;
const browserPath=process.env.CATALOG_ADMIN_BROWSER_PATH;
if(!playwrightEntry||!browserPath)throw new Error("CATALOG_ADMIN_PLAYWRIGHT_ENTRY and CATALOG_ADMIN_BROWSER_PATH are required.");
const {chromium}=await import(pathToFileURL(playwrightEntry).href).then(module=>module.default||module);
const browser=await chromium.launch({executablePath:browserPath,headless:true});
const read=file=>fs.readFileSync(file,"utf8");
const html=read("admin/index.html").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"");
const source=read("js/admin/catalog-admin-import.js")
  .replace(/import\s*\{[^}]+\}\s*from\s*"\.\.\/product-import\/index\.js";\s*/,"")
  .replace(/import\s*\{[^}]+\}\s*from\s*"\.\/catalog-admin-api\.js";\s*/,"")
  .replaceAll("export function","function");
const helpers=`
function cleanText(value){return value==null?"":String(value).trim();}
function formatSize(p){return p?.width_mm&&p?.height_mm?\`${'${p.width_mm/10} × ${p.height_mm/10} cm'}\`:"Đang cập nhật";}
function formatVnd(value){return value==null?"Đang cập nhật":new Intl.NumberFormat("vi-VN").format(Number(value))+" ₫";}
function buildCatalogImportPreview(value){return value;}
function parseCatalogExcelWorkbook(){return {ok:true,metadata:{sheet_name:"Fixture",header_row:1},rows:[]};}
`;

const page=await browser.newPage();
const errors=[];
page.on("pageerror",error=>errors.push(error.message));
page.on("console",message=>{if(message.type()==="error"&&!/Failed to load resource/.test(message.text()))errors.push(message.text());});
page.on("dialog",async dialog=>{await dialog.accept();});
await page.route("**/*",route=>route.abort());
await page.setContent(html);
await page.addStyleTag({content:read("css/catalog-admin.css")});
await page.addScriptTag({content:helpers+"\n"+source});

await page.evaluate(()=>{
  window.confirm=()=>true;
  for(const id of ["adminLoadingView","adminLoginView","adminDeniedView"])document.getElementById(id).classList.add("hide");
  document.getElementById("adminWorkspace").classList.remove("hide");
  document.getElementById("adminWorkspace").removeAttribute("inert");
  const batch={
    id:"batch-06b",supplier:"Fixture Supplier",source_filename:"fixture.xlsx",source_file_size_bytes:600,
    parser_adapter:"CATALOG_06B_XLSX",parser_version:"1.0.0",effective_date:"2026-09-25",status:"STAGED",
    import_mode:"PRICE_UPDATE_ONLY",source_format:"EXCEL",created_at:"2026-09-25T10:00:00Z",approved_at:null,
    summary:{total:2,create:0,update:1,skip:0,unresolved:1,ready:1,updating:0,conflict:1},
    rows:[
      {id:"row-ready",source_sheet:"Sheet1",source_row_number:2,code:"K-001",name:"TRAVERTINO DARK GREY",width_mm:600,height_mm:1200,surface:"MATT",price_per_m2:1915000,classification:"CHANGED",disposition:"READY",selected_action:"UPDATE",previous_snapshot:{price_per_m2:1800000},proposed_snapshot:{price_per_m2:1915000}},
      {id:"row-conflict",source_sheet:"Sheet1",source_row_number:3,code:"K-002",name:"BARRO BEIGE",width_mm:600,height_mm:600,surface:"GLOSSY",price_per_m2:900000,classification:"CONFLICT",disposition:"CONFLICT",selected_action:"NONE",previous_snapshot:{},proposed_snapshot:{price_per_m2:900000},source_values:{catalog_match:{candidates:[{id:"candidate-1",code:"K-002",name:"BARRO BEIGE",width_mm:600,height_mm:600,surface:"GLOSSY"}],suggestions:[]}}}
    ]
  };
  const calls=[];
  const api={
    listImportBatches:async()=>({items:[batch],pagination:{total:1}}),
    getImportBatch:async()=>batch,
    reviewImportRows:async(_id,decisions)=>{calls.push({name:"review",decisions});const row=batch.rows.find(item=>item.id===decisions[0].row_id);row.selected_action=decisions[0].decision==="EXCLUDE"?"SKIP":"UPDATE";row.disposition=decisions[0].decision==="EXCLUDE"?"EXCLUDED_BY_REVIEW":"READY";row.classification=decisions[0].decision==="EXCLUDE"?"REVIEW":"CHANGED";batch.status="READY";batch.summary.unresolved=0;batch.summary.update=2;return batch;},
    approveImport:async()=>{calls.push({name:"approve"});batch.approved_at="2026-09-25T10:10:00Z";return {status:"APPROVED"};},
    applyImport:async()=>{calls.push({name:"apply"});batch.status="APPLIED";return {status:"APPLIED"};},
    rollbackImport:async()=>{calls.push({name:"rollback"});batch.status="CANCELLED";batch.rolled_back_at="2026-09-25T10:20:00Z";return {status:"ROLLED_BACK"};},
    catalogSnapshot:async()=>[],previewImport:async()=>({batch_id:batch.id,rows:2})
  };
  const controller=createCatalogAdminImport({api,root:document,notify:message=>calls.push({name:"notify",message})});
  controller.bind();controller.showPage("import");window.fixture={controller,calls,batch};
});

try{
  await page.waitForFunction(()=>fixture.controller.state.loaded);
  assert.ok(await page.locator("#adminImportPage").isVisible(),"import page visible");
  assert.equal(await page.locator("#adminImportHistory .history-item").count(),1,"history rendered");
  await page.locator('[data-open-batch="batch-06b"]').click();
  assert.ok(await page.locator("#adminImportPreviewPanel").isVisible(),"preview visible");
  assert.match(await page.locator("#adminImportRows").textContent(),/\+115\.000 ₫/,"price delta visible");
  assert.match(await page.locator("#adminImportRows").textContent(),/Xung đột/,"conflict visible");
  await page.locator('#adminImportRows [data-candidate-row="row-conflict"]').selectOption("candidate-1");
  await page.locator('#adminImportRows [data-use-candidate="row-conflict"]').click();
  await page.waitForFunction(()=>fixture.calls.some(call=>call.name==="review"));
  assert.equal(await page.locator("#adminImportConflictRows").textContent(),"0","conflict resolved");
  await page.waitForFunction(()=>!document.getElementById("adminImportApprove").disabled);
  await page.locator("#adminImportApprove").click();
  await page.waitForFunction(()=>fixture.calls.some(call=>call.name==="approve"));
  assert.equal(await page.locator("#adminImportApply").isEnabled(),true,"apply unlocked after approval");
  await page.locator("#adminImportApply").click();
  await page.waitForFunction(()=>fixture.calls.some(call=>call.name==="apply"));
  assert.match(await page.locator("#adminImportBatchBadges").textContent(),/Đã áp dụng/);
  await page.locator('[data-rollback-batch="batch-06b"]').click();
  await page.waitForFunction(()=>fixture.calls.some(call=>call.name==="rollback"));
  assert.match(await page.locator("#adminImportBatchBadges").textContent(),/Đã rollback/);

  if(process.env.CATALOG_ADMIN_SCREENSHOT_DIR){
    fs.mkdirSync(process.env.CATALOG_ADMIN_SCREENSHOT_DIR,{recursive:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:path.join(process.env.CATALOG_ADMIN_SCREENSHOT_DIR,"catalog-admin-06b-desktop.png"),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(process.env.CATALOG_ADMIN_SCREENSHOT_DIR,"catalog-admin-06b-mobile.png"),fullPage:true});
  }

  await page.setInputFiles("#adminImportFile",{name:"price-list.pdf",mimeType:"application/pdf",buffer:Buffer.from("%PDF fixture")});
  await page.locator("#adminImportSupplier").fill("PDF Supplier");
  await page.locator("#adminImportForm").evaluate(form=>form.requestSubmit());
  assert.match(await page.locator("#adminImportMessage").textContent(),/chờ OCR/);
  assert.equal(await page.locator("#adminImportPreviewPanel").isVisible(),false,"PDF creates no database preview");

  for(const width of [360,390,430,768,1024,1366,1440]){
    await page.setViewportSize({width,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`no horizontal overflow ${width}`);
  }
  assert.deepEqual(errors,[],`browser errors: ${errors.join(" | ")}`);
  console.log("PASS: Catalog 06B browser fixture — navigation, preview/filter, price delta, candidate review, approval/apply/rollback, PDF OCR pending and responsive.");
}finally{await browser.close();}
