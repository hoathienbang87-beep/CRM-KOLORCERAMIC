import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

const pdfPath=process.env.PRODUCT_R2_PRIVATE_PDF;
const outputPath=process.env.PRODUCT_R2_PRIVATE_STAGE_PAYLOAD;
if(!pdfPath||!outputPath)throw new Error("Thiếu PRODUCT_R2_PRIVATE_PDF hoặc PRODUCT_R2_PRIVATE_STAGE_PAYLOAD.");
const {chromium}=await import(pathToFileURL(process.env.PRODUCTS_TEST_PLAYWRIGHT_ENTRY).href).then(module=>module.default||module);
const root=path.resolve(fileURLToPath(new URL("../",import.meta.url)));
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8"};
const fixture=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/css/styles.css"></head><body><main id="host"></main><script type="module">
const source=await fetch('/index.html').then(r=>r.text());const parsed=new DOMParser().parseFromString(source,'text/html');const panel=parsed.getElementById('productsPanel');panel.classList.remove('hide');document.getElementById('host').append(panel);
const {createProductImportController}=await import('/js/features/product-import-ui.js');let model=null;const rpc=async(name,args)=>{if(name==='crm_stage_product_import'){window.__stagePayload={batch:args.p_batch,rows:args.p_rows};const groups=new Map();for(const row of args.p_rows){const key=String(row.code||'').normalize('NFKC').trim().replace(/\\s+/g,' ').toUpperCase();groups.set(key,(groups.get(key)||0)+1);}model={batch:{id:'fixture-batch',...args.p_batch,status:'STAGED',created_at:new Date().toISOString()},rows:args.p_rows.map((row,index)=>({...row,id:'row-'+index,classification:groups.get(String(row.code||'').normalize('NFKC').trim().replace(/\\s+/g,' ').toUpperCase())>1?'DUPLICATE_IN_FILE':'NEW',duplicate_group_id:groups.get(String(row.code||'').normalize('NFKC').trim().replace(/\\s+/g,' ').toUpperCase())>1?'dup-1':null,duplicate_kind:groups.get(String(row.code||'').normalize('NFKC').trim().replace(/\\s+/g,' ').toUpperCase())>1?'IDENTICAL':null,selected_action:groups.get(String(row.code||'').normalize('NFKC').trim().replace(/\\s+/g,' ').toUpperCase())>1?'NONE':'CREATE'}))};return {batch_id:'fixture-batch'};}if(name==='crm_get_product_import')return model;if(name==='crm_update_product_import_review'){model.batch.status='READY';model.rows.forEach((row,index)=>{if(row.classification==='DUPLICATE_IN_FILE')row.selected_action=index===model.rows.findIndex(item=>item.classification==='DUPLICATE_IN_FILE')?'CREATE':'SKIP';row.duplicate_resolution='COLLAPSE';});return model;}if(name==='crm_refresh_product_import')return model;};
const controller=createProductImportController({rpc});controller.bind();window.__ready=true;window.__controller=controller;
</script></body></html>`;
const server=http.createServer((request,response)=>{if(request.url==='/__fixture'){response.setHeader('content-type','text/html; charset=utf-8');return response.end(fixture);}const pathname=decodeURIComponent((request.url||'/').split('?')[0]);const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){response.statusCode=404;return response.end('not found');}response.setHeader('content-type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(response);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
const browser=await chromium.launch({executablePath:process.env.PRODUCTS_TEST_BROWSER_PATH,headless:true});const external=[];const errors=[];
try{
  const page=await browser.newPage({viewport:{width:1366,height:900}});page.on('request',request=>{const url=new URL(request.url());if(!['127.0.0.1','localhost'].includes(url.hostname))external.push(request.url());});page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/__fixture`);await page.waitForFunction(()=>window.__ready===true);await page.click('#productImportTab');
  const started=performance.now();await page.setInputFiles('#productImportFile',pdfPath);await page.waitForFunction(()=>window.__stagePayload?.rows?.length===76,{timeout:30000});const elapsed=Math.round(performance.now()-started);
  const payload=await page.evaluate(()=>window.__stagePayload);assert.equal(payload.rows.length,76);assert.equal(new Set(payload.rows.map(row=>row.code_normalized).filter(Boolean)).size,75);assert.equal(payload.rows.filter(row=>row.client_classification==='INVALID').length,0);
  fs.mkdirSync(path.dirname(outputPath),{recursive:true});fs.writeFileSync(outputPath,JSON.stringify(payload));
  for(const width of [360,390,768,1366,1440]){await page.setViewportSize({width,height:900});const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,visible:!document.getElementById('productImportView').classList.contains('hide')}));assert.equal(dimensions.visible,true);assert.ok(dimensions.scroll<=dimensions.client,`overflow at ${width}: ${dimensions.scroll}/${dimensions.client}`);}
  assert.equal(await page.locator('button:has-text("Áp dụng vào sản phẩm")').count(),0);assert.equal(external.length,0);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({browser_worker:{file_size_bytes:fs.statSync(pdfPath).size,physical_rows:payload.rows.length,unique_codes:75,total_parse_stage_preview_ms:elapsed,external_requests:0,viewports:[360,390,768,1366,1440]}}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
