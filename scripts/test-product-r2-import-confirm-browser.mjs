import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

const pdfPath=process.env.PRODUCT_R2_PRIVATE_PDF;
if(!pdfPath)throw new Error("Thiếu PRODUCT_R2_PRIVATE_PDF.");
const {chromium}=await import(pathToFileURL(process.env.PRODUCTS_TEST_PLAYWRIGHT_ENTRY).href).then(module=>module.default||module);
const root=path.resolve(fileURLToPath(new URL("../",import.meta.url)));
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8"};
const fixture=[
  "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><link rel=\"stylesheet\" href=\"/css/styles.css\"></head><body><main id=\"host\"></main><script type=\"module\">",
  "const source=await fetch('/index.html').then(r=>r.text());const parsed=new DOMParser().parseFromString(source,'text/html');const panel=parsed.getElementById('productsPanel');panel.classList.remove('hide');document.getElementById('host').append(panel);",
  "const {createProductImportController}=await import('/js/features/product-import-ui.js');let model=null;let confirmCalls=0;let sourceCalls=0;const rpc=async(name,args)=>{if(name==='crm_stage_product_import'){model={batch:{id:'fixture-confirm-batch',...args.p_batch,status:'STAGED',created_at:new Date().toISOString()},rows:args.p_rows.map((row,index)=>({...row,id:'row-'+index,classification:'NEW',selected_action:'CREATE'}))};return {batch_id:model.batch.id};}if(name==='crm_get_product_import'){return model;}if(name==='crm_update_product_import_review'){model.batch.status='READY';return model;}if(name==='crm_confirm_product_import'){confirmCalls++;model.batch.status='APPLIED';model.batch.confirmed_by_name='Manager Test';model.batch.applied_at=new Date().toISOString();model.batch.apply_summary={created:75,updated:0,history_created:75};return {batch_id:model.batch.id,status:'APPLIED',summary:model.batch.apply_summary};}if(name==='crm_refresh_product_import')return model;};",
  "const sourceUploader=async()=>{sourceCalls++;model.batch.status='READY';model.batch.source_verified_sha256=model.batch.source_sha256;model.batch.source_verified_size_bytes=model.batch.source_file_size_bytes;model.batch.storage_object_path='imports/'+model.batch.id+'/source.pdf';return {verified:true};};",
  "const controller=createProductImportController({rpc,sourceUploader});controller.bind();window.__ready=true;window.__controller=controller;window.__getConfirmCalls=()=>confirmCalls;window.__getSourceCalls=()=>sourceCalls;",
  "</script></body></html>"
].join("");
const server=http.createServer((request,response)=>{if(request.url==='/__fixture'){response.setHeader('content-type','text/html; charset=utf-8');return response.end(fixture);}const pathname=decodeURIComponent((request.url||'/').split('?')[0]);const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){response.statusCode=404;return response.end('not found');}response.setHeader('content-type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(response);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
const browser=await chromium.launch({executablePath:process.env.PRODUCTS_TEST_BROWSER_PATH,headless:true});const external=[];const errors=[];
try{
  const page=await browser.newPage({viewport:{width:1366,height:900}});page.on('request',request=>{const url=new URL(request.url());if(!['127.0.0.1','localhost'].includes(url.hostname))external.push(request.url());});page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.goto('http://127.0.0.1:'+port+'/__fixture');await page.waitForFunction(()=>window.__ready===true);await page.click('#productImportTab');await page.setInputFiles('#productImportFile',pdfPath);
  await page.waitForFunction(()=>document.getElementById('productImportSourceStatus')?.textContent.includes('Đã lưu và xác minh'),{timeout:30000});
  const sourceText=await page.locator('#productImportSourceStatus').textContent();assert.match(sourceText,/Đã lưu và xác minh/);assert.equal(await page.locator('#confirmProductImportBtn').isDisabled(),false);
  const confirmButton=page.locator('#confirmProductImportBtn');await confirmButton.click();await page.waitForFunction(()=>document.getElementById('confirmProductImportBtn')?.classList.contains('hide')===true);
  assert.equal(await page.evaluate(()=>window.__getSourceCalls()),1);assert.equal(await page.evaluate(()=>window.__getConfirmCalls()),1);assert.match(await page.locator('#productImportAppliedMeta').textContent(),/Manager Test/);
  for(const width of [360,390,768,1366,1440]){await page.setViewportSize({width,height:900});const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));assert.ok(dimensions.scroll<=dimensions.client,'overflow at '+width+': '+dimensions.scroll+'/'+dimensions.client);}
  assert.equal(external.length,0);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({browser_confirm:{source_verified:true,confirm_calls:1,status:"APPLIED",applied_actor:"Manager Test",viewports:[360,390,768,1366,1440],external_requests:0}}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
