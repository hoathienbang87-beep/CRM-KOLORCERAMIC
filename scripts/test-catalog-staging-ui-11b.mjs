import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {pathToFileURL} from "node:url";

const expectedRef="nalkeptqohjbjnqwpzzv";
const productionRef="jjeeazwlqcwynzquimeo";
const ref=process.env.STAGING_PROJECT_REF||"";
const supabaseUrl=(process.env.STAGING_SUPABASE_URL||"").replace(/\/$/,"");
const anonKey=process.env.STAGING_ANON_KEY||"";
const serviceKey=process.env.STAGING_SERVICE_ROLE_KEY||"";
const playwrightEntry=process.env.CATALOG_11B_PLAYWRIGHT_ENTRY||"";
const browserPath=process.env.CATALOG_11B_BROWSER_PATH||"";

assert.equal(ref,expectedRef,"11B requires the approved cloud staging ref");
assert.equal(supabaseUrl,`https://${expectedRef}.supabase.co`,"11B URL must be cloud staging");
assert.ok(!supabaseUrl.includes(productionRef),"11B refuses production");
assert.ok(anonKey&&serviceKey&&playwrightEntry&&browserPath,"11B staging credentials and browser dependencies are required");

const {chromium}=await import(pathToFileURL(playwrightEntry).href).then(module=>module.default||module);
const root=process.cwd();
const vercel=JSON.parse(fs.readFileSync("vercel.json","utf8"));
const runId=crypto.randomBytes(5).toString("hex");
const runCode=runId.toUpperCase();
const password=`${crypto.randomBytes(18).toString("base64url")}aA1!`;
const today=new Date().toISOString().slice(0,10);
const adminEmail=`catalog-11b-${runId}-admin@staging.invalid`;
const saleEmail=`catalog-11b-${runId}-sale@staging.invalid`;
const adminAppId=`catalog-11b-${runId}-admin`;
const saleAppId=`catalog-11b-${runId}-sale`;
const productIds={
  public:crypto.randomUUID(),
  candidateA:crypto.randomUUID(),
  candidateB:crypto.randomUUID()
};
const productCodes={
  public:`E2E11B-PUBLIC-${runCode}`,
  candidateA:`E2E11B-A-${runCode}`,
  candidateB:`E2E11B-B-${runCode}`
};
const candidateName=`E2E 11B MANUAL ${runCode}`;
const sourceFilename=`catalog-11b-${runId}.xlsx`;
const fixtureImage="https://assets.11b.invalid/product.svg";
const createdAuthIds=[];
let batchId="";
let server;
let browser;

async function request(resource,{method="GET",token=serviceKey,key=serviceKey,body,headers={},allowError=false}={}){
  let response;
  let transportError;
  for(let attempt=1;attempt<=3;attempt+=1){
    try{
      response=await fetch(`${supabaseUrl}${resource}`,{
        method,
        signal:AbortSignal.timeout(90000),
        headers:{apikey:key,Authorization:`Bearer ${token}`,...headers,...(body!==undefined?{"Content-Type":"application/json"}:{})},
        body:body===undefined?undefined:JSON.stringify(body)
      });
      break;
    }catch(error){
      transportError=error;
      if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*500));
    }
  }
  if(!response)throw new Error(`${method} ${resource} failed after 3 transport attempts`,{cause:transportError});
  const text=await response.text();
  let data=text;
  try{data=text?JSON.parse(text):null;}catch{}
  if(!allowError&&!response.ok)throw new Error(`${method} ${resource} failed with HTTP ${response.status}: ${typeof data==="string"?data:JSON.stringify(data)}`);
  return {ok:response.ok,status:response.status,data};
}

const service=(resource,options={})=>request(resource,{...options,token:serviceKey,key:serviceKey});
const rpc=(token,name,body)=>request(`/rest/v1/rpc/${name}`,{method:"POST",token,key:anonKey,body});
const query=async(table,params)=>service(`/rest/v1/${table}?${params}`);

async function createAuthUser(email){
  const result=await service("/auth/v1/admin/users",{method:"POST",body:{email,password,email_confirm:true}});
  assert.ok(result.data?.id,`auth user created for ${email}`);
  createdAuthIds.push(result.data.id);
  return result.data.id;
}

async function login(email){
  const result=await request("/auth/v1/token?grant_type=password",{method:"POST",token:anonKey,key:anonKey,body:{email,password}});
  assert.ok(result.data?.access_token,`staging login token for ${email}`);
  return result.data.access_token;
}

async function setupFixtures(){
  const adminAuthId=await createAuthUser(adminEmail);
  const saleAuthId=await createAuthUser(saleEmail);
  await service("/rest/v1/app_users",{
    method:"POST",
    headers:{Prefer:"return=minimal"},
    body:[
      {id:adminAppId,supabase_auth_id:adminAuthId,email:adminEmail,name:"Catalog 11B Admin",role:"admin",active:true,lifecycle_status:"active"},
      {id:saleAppId,supabase_auth_id:saleAuthId,email:saleEmail,name:"Catalog 11B Sale",role:"sale",active:true,lifecycle_status:"active"}
    ]
  });

  const common={width_mm:600,height_mm:1200,price_per_m2:1915000,price_effective_date:today,active:true,is_published:false,category:"Synthetic",collection:"Prompt 11B",origin:"Staging fixture",image_url:null,gallery_urls:[],description:null,created_by_user_id:adminAppId,updated_by_user_id:adminAppId,source_metadata:{fixture:true,prompt:"11B",run_id:runId}};
  await service("/rest/v1/products",{
    method:"POST",
    headers:{Prefer:"return=minimal"},
    body:[
      {...common,id:productIds.public,code:productCodes.public,name:`E2E 11B PUBLIC ${runCode}`,width_mm:1200,height_mm:2400,surface:"MATT",is_published:true,image_url:fixtureImage,gallery_urls:[fixtureImage],description:"Synthetic UI staging fixture"},
      {...common,id:productIds.candidateA,code:productCodes.candidateA,name:candidateName,surface:"MATT"},
      {...common,id:productIds.candidateB,code:productCodes.candidateB,name:candidateName,surface:"GLOSSY"}
    ]
  });

  const adminToken=await login(adminEmail);
  const candidates=[
    {id:productIds.candidateA,code:productCodes.candidateA,name:candidateName,width_mm:600,height_mm:1200,surface:"MATT",price_per_m2:1915000},
    {id:productIds.candidateB,code:productCodes.candidateB,name:candidateName,width_mm:600,height_mm:1200,surface:"GLOSSY",price_per_m2:1915000}
  ];
  const preview=await rpc(adminToken,"catalog_admin_preview_import",{
    p_batch:{
      supplier:"11B STAGING UI FIXTURE",source_filename:sourceFilename,
      source_sha256:crypto.createHash("sha256").update(sourceFilename).digest("hex"),source_file_size_bytes:111,
      parser_adapter:"CATALOG_11B_UI_FIXTURE",parser_version:"1.0.0",effective_date:today,
      import_mode:"CATALOG_IMPORT",source_format:"EXCEL",source_metadata:{fixture:true,prompt:"11B",run_id:runId}
    },
    p_rows:[{
      source_page:1,source_sheet:"11B Fixture",source_row_number:2,
      source_values:{catalog_match:{candidates,suggestions:[]}},
      code:null,name:candidateName,width_mm:600,height_mm:1200,surface:null,
      classification:"CONFLICT",disposition:"CONFLICT",match_rule:"MANUAL",conflict_code:"MULTIPLE_MATCH_CANDIDATES",
      selected_action:"NONE",warnings:[],proposed_snapshot:{price_per_m2:1915000,price_effective_date:today}
    }]
  });
  batchId=preview.data?.batch_id||"";
  assert.ok(batchId,"11B import preview batch created on staging");
}

async function cleanupFixtures(){
  const errors=[];
  const attempt=async(label,fn)=>{try{await fn();}catch(error){errors.push(`${label}: ${error.message}`);}};
  const leadRows=(await query("website_leads",`select=id&email=eq.${encodeURIComponent(saleEmail)}`).catch(()=>({data:[]}))).data||[];
  const batchRows=(await query("product_import_batches",`select=id&created_by_user_id=eq.${encodeURIComponent(adminAppId)}`).catch(()=>({data:[]}))).data||[];
  const batchIds=batchRows.map(item=>item.id);
  const auditEntityIds=[...batchIds,...leadRows.map(item=>item.id),...Object.values(productIds)];

  for(const entityId of auditEntityIds){
    await attempt(`audit ${entityId}`,()=>service(`/rest/v1/audit_logs?entity_id=eq.${encodeURIComponent(entityId)}`,{method:"DELETE"}));
  }
  await attempt("admin audit",()=>service(`/rest/v1/audit_logs?email=eq.${encodeURIComponent(adminEmail)}`,{method:"DELETE"}));
  for(const lead of leadRows)await attempt(`lead ${lead.id}`,()=>service(`/rest/v1/website_leads?id=eq.${lead.id}`,{method:"DELETE"}));

  for(const id of batchIds){
    const history=await query("product_price_history",`select=id&import_batch_id=eq.${id}`);
    if((history.data||[]).length)errors.push(`immutable price history residue for batch ${id}`);
    await attempt(`import rows ${id}`,()=>service(`/rest/v1/product_import_rows?batch_id=eq.${id}`,{method:"DELETE"}));
  }
  for(const id of batchIds)await attempt(`import batch ${id}`,()=>service(`/rest/v1/product_import_batches?id=eq.${id}`,{method:"DELETE"}));
  for(const id of Object.values(productIds))await attempt(`product ${id}`,()=>service(`/rest/v1/products?id=eq.${id}`,{method:"DELETE"}));
  await attempt("fixture app users",()=>service(`/rest/v1/app_users?id=in.(${encodeURIComponent(adminAppId)},${encodeURIComponent(saleAppId)})`,{method:"DELETE"}));
  for(const id of createdAuthIds)await attempt(`auth user ${id}`,()=>service(`/auth/v1/admin/users/${id}`,{method:"DELETE"}));

  const residue={
    products:(await query("products",`select=id&id=in.(${Object.values(productIds).join(",")})`)).data||[],
    batches:(await query("product_import_batches",`select=id&created_by_user_id=eq.${encodeURIComponent(adminAppId)}`)).data||[],
    leads:(await query("website_leads",`select=id&email=eq.${encodeURIComponent(saleEmail)}`)).data||[],
    users:(await query("app_users",`select=id&id=in.(${encodeURIComponent(adminAppId)},${encodeURIComponent(saleAppId)})`)).data||[],
    audit:(await query("audit_logs",`select=id&email=eq.${encodeURIComponent(adminEmail)}`)).data||[]
  };
  if(Object.values(residue).some(rows=>rows.length))errors.push(`fixture residue: ${JSON.stringify(Object.fromEntries(Object.entries(residue).map(([key,rows])=>[key,rows.length])))}`);
  if(errors.length)throw new Error(`11B cleanup failed: ${errors.join(" | ")}`);
}

function rewritePath(pathname){
  for(const route of vercel.rewrites||[]){
    if(route.source===pathname)return route.destination;
    if(route.source.endsWith("/:path*")&&pathname.startsWith(route.source.slice(0,-7)+"/"))return route.destination;
  }
  return pathname;
}

function selectorHarness(){
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/css/styles.css"><script src="/js/vendor/supabase/supabase.js"></script><script src="/js/supabase-config.js"></script></head><body><button id="openSelector">Chọn sản phẩm</button><output id="picked"></output><script type="module">
import {createSupabaseBrowserClient} from "/js/shared/supabase-client.js";
import {createCrmProductSelector,quoteSnapshotFromProduct,quoteSnapshotFromItem,encodeProductSnapshot,decodeProductSnapshot} from "/js/features/crm-product-selector.js";
const client=createSupabaseBrowserClient({authMode:"authenticated"});
const login=await client.auth.signInWithPassword({email:${JSON.stringify(saleEmail)},password:${JSON.stringify(password)}});
if(login.error)throw login.error;
const rpc=async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw error;return data;};
const selector=createCrmProductSelector({rpc,documentRef:document,windowRef:window});
document.getElementById("openSelector").onclick=()=>selector.open({heading:"Chọn sản phẩm staging",initialSearch:${JSON.stringify(productCodes.public)},onSelect:product=>{const snapshot=quoteSnapshotFromProduct(product);document.getElementById("picked").textContent=product.code;window.fixture.selected=product;window.fixture.snapshot=snapshot;window.fixture.encoded=encodeProductSnapshot(snapshot);}});
window.fixture={ready:true,rpc,selector,quoteSnapshotFromItem,decodeProductSnapshot};
</script></body></html>`;
}

async function startServer(){
  const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".png":"image/png"};
  server=http.createServer((req,res)=>{
    const url=new URL(req.url,"http://localhost");
    const redirect=(vercel.redirects||[]).find(route=>route.source===url.pathname);
    if(redirect){res.writeHead(redirect.permanent?308:307,{Location:`${redirect.destination}${url.search}`});return res.end();}
    if(url.pathname==="/js/supabase-config.js"){
      res.writeHead(200,{"Content-Type":"text/javascript; charset=utf-8","Cache-Control":"no-store"});
      return res.end(`window.CRM_SUPABASE_CONFIG=${JSON.stringify({url:supabaseUrl,anonKey})};`);
    }
    if(url.pathname==="/__11b-selector"){
      res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
      return res.end(selectorHarness());
    }
    let pathname=rewritePath(url.pathname);
    let file=path.resolve(root,decodeURIComponent(pathname).replace(/^\/+/,""));
    if(!path.extname(file)&&fs.existsSync(`${file}.html`))file=`${file}.html`;
    if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){
      res.writeHead(404,{"Content-Type":"text/plain"});return res.end("Not found");
    }
    res.writeHead(200,{"Content-Type":mime[path.extname(file)]||"application/octet-stream","Cache-Control":"no-store"});
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve,reject)=>server.listen(0,"127.0.0.1",error=>error?reject(error):resolve()));
  return `http://127.0.0.1:${server.address().port}`;
}

function watch(page,productionRequests,pageErrors){
  page.on("request",req=>{if(req.url().includes(productionRef))productionRequests.push(req.url());});
  page.on("pageerror",error=>pageErrors.push(error.message));
}

async function verifyResponsive(page,widths){
  for(const width of widths){
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>{window.scrollTo(0,0);document.documentElement.scrollLeft=0;document.body.scrollLeft=0;});
    const layout=await page.evaluate(()=>({
      scrollWidth:document.documentElement.scrollWidth,
      clientWidth:document.documentElement.clientWidth,
      offenders:[...document.querySelectorAll("body *")].map(element=>{
        const rect=element.getBoundingClientRect();
        return {tag:element.tagName,id:element.id,className:typeof element.className==="string"?element.className:"",left:Math.round(rect.left),right:Math.round(rect.right),width:Math.round(rect.width),scrollWidth:element.scrollWidth,clientWidth:element.clientWidth};
      }).filter(item=>item.right>document.documentElement.clientWidth+1||item.left< -1).sort((a,b)=>b.right-a.right).slice(0,8)
    }));
    assert.ok(layout.scrollWidth<=layout.clientWidth+1,`no horizontal overflow at ${width}px: ${JSON.stringify(layout)}`);
  }
}

async function runUi(base){
  browser=await chromium.launch({executablePath:browserPath,headless:true});
  const productionRequests=[];
  const pageErrors=[];

  const anonymous=await browser.newContext();
  await anonymous.route("https://assets.11b.invalid/**",route=>route.fulfill({status:200,contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#8d7768"/></svg>'}));
  const publicPage=await anonymous.newPage();watch(publicPage,productionRequests,pageErrors);
  await publicPage.goto(`${base}/`,{waitUntil:"domcontentloaded"});
  await publicPage.locator(`[data-product-id="${productIds.public}"]`).waitFor({state:"visible",timeout:30000});
  assert.match(await publicPage.locator(`[data-product-id="${productIds.public}"]`).textContent(),/1\.915\.000 VNĐ\/m²/);
  await verifyResponsive(publicPage,[1440,390]);

  await publicPage.goto(`${base}/?id=${encodeURIComponent(productCodes.public)}&utm_source=11b`,{waitUntil:"domcontentloaded"});
  await publicPage.locator("#detailContent").waitFor({state:"visible",timeout:30000});
  assert.equal(await publicPage.locator("#detailName").textContent(),`E2E 11B PUBLIC ${runCode}`);
  await publicPage.locator("#toggleQr").click();
  assert.ok(await publicPage.locator("#qrPanel").isVisible());
  assert.ok((await publicPage.locator("#productQr svg path").getAttribute("d")).length>1000,"local QR rendered");
  await publicPage.locator("#leadName").fill("11B Synthetic Lead");
  await publicPage.locator("#leadPhone").fill(`09${String(parseInt(runId.slice(0,8),16)).padStart(8,"0").slice(-8)}`);
  await publicPage.locator("#leadEmail").fill(saleEmail);
  await publicPage.locator("#leadMessage").fill("UI staging fixture");
  await publicPage.locator("#leadConsent").check();
  await publicPage.locator("#leadForm").evaluate(form=>form.requestSubmit());
  await publicPage.waitForFunction(()=>/Đã nhận yêu cầu/.test(document.getElementById("leadStatus")?.textContent||""),null,{timeout:30000});
  await verifyResponsive(publicPage,[1440,390]);

  const anonAdmin=await anonymous.newPage();watch(anonAdmin,productionRequests,pageErrors);
  await anonAdmin.goto(`${base}/admin`,{waitUntil:"domcontentloaded"});
  await anonAdmin.locator("#adminLoginView").waitFor({state:"visible",timeout:30000});
  assert.equal(await anonAdmin.locator("#adminWorkspace").isVisible(),false,"anonymous admin access denied");
  await anonymous.close();

  const saleAdminContext=await browser.newContext();
  const saleAdmin=await saleAdminContext.newPage();watch(saleAdmin,productionRequests,pageErrors);
  await saleAdmin.goto(`${base}/admin`,{waitUntil:"domcontentloaded"});
  await saleAdmin.locator("#adminLoginView").waitFor({state:"visible",timeout:30000});
  await saleAdmin.locator("#adminLoginEmail").fill(saleEmail);
  await saleAdmin.locator("#adminLoginPassword").fill(password);
  await saleAdmin.locator("#adminLoginForm").evaluate(form=>form.requestSubmit());
  await saleAdmin.locator("#adminDeniedView").waitFor({state:"visible",timeout:30000});
  assert.match(await saleAdmin.locator("#adminDeniedMessage").textContent(),/không có quyền owner\/admin/i);
  await saleAdminContext.close();

  const adminContext=await browser.newContext();
  await adminContext.route("https://cdn.jsdelivr.net/**",route=>route.abort());
  const adminPage=await adminContext.newPage();watch(adminPage,productionRequests,pageErrors);
  adminPage.on("dialog",dialog=>dialog.accept());
  await adminPage.goto(`${base}/admin/import`,{waitUntil:"domcontentloaded"});
  await adminPage.locator("#adminLoginView").waitFor({state:"visible",timeout:30000});
  await adminPage.locator("#adminLoginEmail").fill(adminEmail);
  await adminPage.locator("#adminLoginPassword").fill(password);
  await adminPage.locator("#adminLoginForm").evaluate(form=>form.requestSubmit());
  await adminPage.locator("#adminWorkspace").waitFor({state:"visible",timeout:30000});
  await adminPage.locator('[data-admin-page="import"]').click();
  await adminPage.locator(`[data-open-batch="${batchId}"]`).waitFor({state:"visible",timeout:30000});
  await adminPage.locator(`[data-open-batch="${batchId}"]`).click();
  await adminPage.locator("#adminImportPreviewPanel").waitFor({state:"visible",timeout:30000});
  assert.equal((await adminPage.locator("#adminImportConflictRows").textContent()).trim(),"1","manual conflict visible");
  const rowId=await adminPage.locator("#adminImportRows [data-candidate-row]").getAttribute("data-candidate-row");
  await adminPage.locator(`#adminImportRows [data-candidate-row="${rowId}"]`).selectOption(productIds.candidateB);
  await adminPage.locator(`#adminImportRows [data-use-candidate="${rowId}"]`).click();
  await adminPage.waitForFunction(()=>document.getElementById("adminImportConflictRows")?.textContent?.trim()==="0",null,{timeout:30000});
  await adminPage.locator("#adminImportApprove").click();
  await adminPage.waitForFunction(()=>/Đã duyệt/.test(document.getElementById("adminImportBatchBadges")?.textContent||""),null,{timeout:30000});
  await adminPage.locator("#adminImportApply").click();
  await adminPage.waitForFunction(()=>/Đã áp dụng/.test(document.getElementById("adminImportBatchBadges")?.textContent||""),null,{timeout:30000});
  await adminPage.locator(`[data-rollback-batch="${batchId}"]`).waitFor({state:"visible",timeout:30000});
  await adminPage.locator(`[data-rollback-batch="${batchId}"]`).click();
  await adminPage.waitForFunction(()=>/Đã rollback/.test(document.getElementById("adminImportBatchBadges")?.textContent||""),null,{timeout:30000});
  const batchRead=(await query("product_import_batches",`select=id,status,approved_by_user_id,approved_at,rolled_back_at&id=eq.${batchId}`)).data||[];
  assert.equal(batchRead.length,1,"staging batch read-back exists");
  assert.equal(batchRead[0].status,"CANCELLED","rolled-back source batch is cancelled on staging");
  assert.equal(batchRead[0].approved_by_user_id,adminAppId,"approval actor persisted");
  assert.ok(batchRead[0].approved_at,"approval timestamp persisted");
  assert.ok(batchRead[0].rolled_back_at,"rollback timestamp persisted");
  const rollbackRead=(await query("product_import_batches",`select=id,status,import_mode,rollback_of_batch_id&rollback_of_batch_id=eq.${batchId}`)).data||[];
  assert.equal(rollbackRead.length,1,"rollback batch read-back exists");
  assert.equal(rollbackRead[0].status,"APPLIED","rollback batch is applied");
  assert.equal(rollbackRead[0].import_mode,"ROLLBACK","rollback batch mode persisted");
  const rowRead=(await query("product_import_rows",`select=matched_product_id,selected_action,match_rule,previous_snapshot,proposed_snapshot&batch_id=eq.${batchId}`)).data||[];
  assert.equal(rowRead.length,1,"reviewed staging row read-back exists");
  assert.equal(rowRead[0].matched_product_id,productIds.candidateB,"manual candidate persisted");
  assert.equal(rowRead[0].selected_action,"UPDATE","manual review classified as update");
  assert.equal(rowRead[0].match_rule,"MANUAL_CANDIDATE","manual review rule persisted");
  assert.ok(rowRead[0].previous_snapshot&&rowRead[0].proposed_snapshot,"row keeps before/proposed snapshots");
  const auditRead=(await query("audit_logs",`select=action,entity,entity_id,raw_data&email=eq.${encodeURIComponent(adminEmail)}`)).data||[];
  for(const action of ["catalogImportReview06B","catalogImportApprove03B","catalogImportProductApply03B","catalogImportProductRollback03B"]){
    assert.ok(auditRead.some(item=>item.action===action),`${action} audit exists`);
  }
  for(const action of ["catalogImportProductApply03B","catalogImportProductRollback03B"]){
    const item=auditRead.find(entry=>entry.action===action&&entry.entity_id===productIds.candidateB);
    assert.equal(item.raw_data?.batch_id,batchId,`${action} records batch id`);
    assert.ok(Object.hasOwn(item.raw_data||{},"before")&&Object.hasOwn(item.raw_data||{},"after"),`${action} records before/after`);
  }
  await verifyResponsive(adminPage,[1440,390]);
  await adminPage.reload({waitUntil:"domcontentloaded"});
  await adminPage.locator("#adminWorkspace").waitFor({state:"visible",timeout:30000});
  assert.equal(new URL(adminPage.url()).pathname,"/admin/import","admin deep refresh path preserved");
  await adminContext.close();

  const selectorContext=await browser.newContext();
  const selectorPage=await selectorContext.newPage();watch(selectorPage,productionRequests,pageErrors);
  await selectorPage.goto(`${base}/__11b-selector`,{waitUntil:"domcontentloaded"});
  await selectorPage.waitForFunction(()=>window.fixture?.ready===true,null,{timeout:30000});
  await selectorPage.locator("#openSelector").click();
  await selectorPage.locator(`[data-product-selector-pick="0"]`).waitFor({state:"visible",timeout:30000});
  assert.match(await selectorPage.locator("[data-product-selector-results]").textContent(),/1\.915\.000 ₫\/m²/);
  await selectorPage.locator('[data-product-selector-pick="0"]').click();
  assert.equal(await selectorPage.locator("#picked").textContent(),productCodes.public);
  const snapshotResult=await selectorPage.evaluate(()=>{
    const snapshot=window.fixture.snapshot;
    const changed={...window.fixture.selected,pricePerM2:snapshot.listPriceSnapshot+500000,version:snapshot.catalogVersionSnapshot+1};
    const reopened=window.fixture.quoteSnapshotFromItem({id:"quote-11b",...snapshot},changed);
    return {snapshot,reopened,decoded:window.fixture.decodeProductSnapshot(window.fixture.encoded)};
  });
  assert.equal(snapshotResult.snapshot.listPriceSnapshot,1915000,"quote captures staging catalog price");
  assert.equal(snapshotResult.reopened.listPriceSnapshot,1915000,"quote snapshot stays immutable after catalog price change");
  assert.deepEqual(snapshotResult.decoded,snapshotResult.snapshot,"quote snapshot encode/decode");
  await verifyResponsive(selectorPage,[1440,390]);
  await selectorContext.close();

  const crmContext=await browser.newContext();
  const crmPage=await crmContext.newPage();watch(crmPage,productionRequests,pageErrors);
  await crmPage.goto(`${base}/crm/deep-refresh`,{waitUntil:"domcontentloaded"});
  await crmPage.locator("#loginView").waitFor({state:"visible",timeout:30000});
  await crmPage.locator("#loginEmail").fill(saleEmail);
  await crmPage.locator("#loginPassword").fill(password);
  await crmPage.locator("#loginBtn").click();
  await crmPage.locator("#appView").waitFor({state:"visible",timeout:60000});
  await crmPage.evaluate(()=>{window.location.hash="#/customers/new";});
  await crmPage.locator("#customerNewPanel").waitFor({state:"visible",timeout:30000});
  await crmPage.locator('#customerNewPanel [data-product-selector-context="interest"]').click();
  const search=crmPage.locator("[data-product-selector-search]");
  await search.fill(productCodes.public);
  await crmPage.locator('[data-product-selector-pick="0"]').waitFor({state:"visible",timeout:30000});
  await crmPage.locator('[data-product-selector-pick="0"]').click();
  assert.match(await crmPage.locator("#need").inputValue(),new RegExp(productCodes.public));
  assert.ok(await crmPage.locator("#need").getAttribute("data-product-snapshot"),"CRM keeps selected product snapshot");
  await verifyResponsive(crmPage,[1440,390]);
  await crmPage.reload({waitUntil:"domcontentloaded"});
  await crmPage.locator("#appView").waitFor({state:"visible",timeout:60000});
  assert.equal(new URL(crmPage.url()).pathname,"/crm/deep-refresh","CRM deep refresh path preserved");
  await crmContext.close();

  assert.deepEqual(productionRequests,[],"11B UI must not request production");
  assert.deepEqual(pageErrors,[],`11B browser page errors: ${pageErrors.join(" | ")}`);
  console.log("PASS: Prompt 11B live staging UI — catalog/detail/image/lead/auth/admin manual match/apply/rollback/CRM selector/quote snapshot/routes/unauthorized desktop-mobile.");
}

let primaryError;
try{
  console.log("11B_STAGE: setting up isolated staging fixtures");
  await setupFixtures();
  console.log("11B_STAGE: running browser scenarios against cloud staging");
  const base=await startServer();
  await runUi(base);
}catch(error){
  primaryError=error;
}finally{
  if(browser)await browser.close().catch(()=>{});
  if(server)await new Promise(resolve=>server.close(resolve));
  try{await cleanupFixtures();console.log("PASS: Prompt 11B staging fixtures cleaned with zero product/batch/lead/user residue.");}
  catch(cleanupError){primaryError=primaryError?new AggregateError([primaryError,cleanupError],"11B UI test and cleanup failed"):cleanupError;}
}
if(primaryError)throw primaryError;

