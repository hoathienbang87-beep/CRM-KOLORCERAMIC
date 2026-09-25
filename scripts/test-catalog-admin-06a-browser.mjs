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
const apiSource=read("js/admin/catalog-admin-api.js").replaceAll("export function","function");
const appSource=read("js/admin/catalog-admin-app.js")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/catalog-admin-api\.js";\s*/,"")
  .replaceAll("export function","function");

function fixtureProducts(){return [
  {id:"p-ready",code:"K-001",name:"TRAVERTINO DARK GREY",width_mm:600,height_mm:1200,surface:"MATT",color:"Grey",category:"Vân đá",collection:"Atlas",origin:"Italy",description:"Fixture",image_url:"https://example.invalid/product.jpg",gallery_urls:[],pdf_url:null,video_url:null,more_info_url:null,price_per_m2:1500000,price_effective_date:"2026-09-25",active:true,data_status:"READY",is_published:false,version:1,updated_at:"2026-09-25T08:00:00Z",updated_by_name:"Owner Fixture"},
  {id:"p-draft",code:"K-002",name:"BARRO BEIGE",width_mm:null,height_mm:null,surface:"GLOSSY",color:"Beige",category:"Xi măng",collection:"Terra",origin:null,description:null,image_url:null,gallery_urls:[],pdf_url:null,video_url:null,more_info_url:null,price_per_m2:null,price_effective_date:null,active:true,data_status:"UPDATING",is_published:false,version:1,updated_at:"2026-09-25T07:00:00Z",updated_by_name:"Owner Fixture"}
];}

async function boot(profile={id:"owner",name:"Owner Fixture",email:"owner@staging.invalid",role:"owner",active:true,lifecycle_status:"active"},session={user:{id:"auth-owner",email:"owner@staging.invalid"}}){
  const page=await browser.newPage();
  const errors=[];page.on("pageerror",error=>errors.push(error.message));page.on("console",message=>{if(message.type()==="error"&&!/Failed to load resource/.test(message.text()))errors.push(message.text());});
  await page.route("**/*",route=>route.abort());
  await page.setContent(html);
  await page.addStyleTag({content:read("css/catalog-admin.css")});
  await page.addScriptTag({content:apiSource+"\n"+appSource});
  await page.evaluate(async ({profile,session,products})=>{
    const calls=[];
    const fakeApi={
      getSession:async()=>session,onAuthStateChange:()=>()=>{},profile:async()=>profile,
      signIn:async()=>{},signInGoogle:async()=>{},signOut:async()=>{},
      list:async filters=>{calls.push({name:"list",filters});return {items:products,pagination:{limit:40,offset:filters.offset,total:products.length,has_more:false,next_offset:null}};},
      update:async(id,version,changes)=>{calls.push({name:"update",id,version,changes});const item=products.find(x=>x.id===id);Object.assign(item,changes,{version:version+1,is_published:false,updated_at:"2026-09-25T09:00:00Z"});return {...item};},
      setState:async(id,version,active,published)=>{calls.push({name:"state",id,version,active,published});const item=products.find(x=>x.id===id);Object.assign(item,{active,is_published:published,version:version+1});return {...item};}
    };
    const app=createCatalogAdminApp({api:fakeApi,root:document});await app.start();window.fixture={app,calls,products};
  },{profile,session,products:fixtureProducts()});
  return {page,errors};
}

try{
  const {page,errors}=await boot();
  assert.ok(await page.locator("#adminWorkspace").isVisible(),"owner workspace visible");
  assert.equal(await page.locator("#adminProductRows tr").count(),2,"desktop products rendered");
  assert.match(await page.locator("#adminProductRows").textContent(),/1\.500\.000 ₫/);
  assert.match(await page.locator("#adminProductRows").textContent(),/60 × 120 cm/);
  assert.match(await page.locator("#adminProductRows").textContent(),/Đang cập nhật/);
  assert.equal(await page.locator('input[type="file"]').count(),0,"no upload control");

  for(const width of [1024,1366,1440]){
    await page.setViewportSize({width,height:900});
    assert.ok(await page.locator(".table-wrap").isVisible(),`desktop table ${width}`);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`no desktop overflow ${width}`);
  }

  await page.locator('[data-edit-product="p-ready"]').first().click();
  assert.ok(await page.locator("#adminProductDrawer").isVisible());
  assert.equal(await page.locator("#adminDrawerClose").evaluate(element=>element===document.activeElement),true,"drawer focus");
  await page.locator("#adminName").fill("TRAVERTINO DARK GREY UPDATED");
  await page.locator("#adminPrice").fill("1.915.000");
  await page.locator("#adminProductForm").evaluate(form=>form.requestSubmit());
  await page.waitForFunction(()=>fixture.calls.some(call=>call.name==="update"));
  const update=await page.evaluate(()=>fixture.calls.find(call=>call.name==="update"));
  assert.equal(update.version,1);assert.equal(update.changes.price_per_m2,"1915000");assert.equal(update.changes.name,"TRAVERTINO DARK GREY UPDATED");
  assert.equal(await page.locator("#adminProductDrawer").isVisible(),false);

  await page.locator('[data-edit-product="p-ready"]').first().click();
  await page.locator("#adminPublishedState").evaluate(element=>{element.checked=true;element.dispatchEvent(new Event("change",{bubbles:true}));});
  await page.locator("#adminSaveState").click();
  await page.waitForFunction(()=>fixture.calls.some(call=>call.name==="state"));
  const stateCall=await page.evaluate(()=>fixture.calls.find(call=>call.name==="state"));
  assert.equal(stateCall.version,2);assert.equal(stateCall.published,true);
  await page.keyboard.press("Escape");assert.equal(await page.locator("#adminProductDrawer").isVisible(),false);

  await page.locator("#adminStatusFilter").selectOption("READY");
  await page.waitForFunction(()=>fixture.calls.filter(call=>call.name==="list").length>=3);
  const lastList=await page.evaluate(()=>fixture.calls.filter(call=>call.name==="list").at(-1));
  assert.equal(lastList.filters.dataStatus,"READY");

  for(const width of [360,390,430,768]){
    await page.setViewportSize({width,height:850});
    assert.equal(await page.locator(".table-wrap").isVisible(),false,`mobile table hidden ${width}`);
    assert.ok(await page.locator("#adminProductCards").isVisible(),`mobile cards ${width}`);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`no mobile overflow ${width}`);
  }
  if(process.env.CATALOG_ADMIN_SCREENSHOT_DIR){
    fs.mkdirSync(process.env.CATALOG_ADMIN_SCREENSHOT_DIR,{recursive:true});
    await page.evaluate(()=>document.querySelector("#adminToast")?.classList.add("hide"));
    await page.locator("#adminStatusFilter").selectOption("");
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:path.join(process.env.CATALOG_ADMIN_SCREENSHOT_DIR,"catalog-admin-06a-desktop.png"),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(process.env.CATALOG_ADMIN_SCREENSHOT_DIR,"catalog-admin-06a-mobile.png"),fullPage:true});
  }
  assert.deepEqual(errors,[],`browser errors: ${errors.join(" | ")}`);
  await page.close();

  const denied=await boot({id:"sale",role:"sale",active:true,lifecycle_status:"active"});
  assert.ok(await denied.page.locator("#adminDeniedView").isVisible(),"sale denied");
  assert.equal(await denied.page.locator("#adminWorkspace").isVisible(),false);
  await denied.page.close();
  const anonymous=await boot(null,null);
  assert.ok(await anonymous.page.locator("#adminLoginView").isVisible(),"anonymous login gate");
  await anonymous.page.close();
  console.log("PASS: Catalog 06A browser fixture — auth/role guards, list/filter/edit/state, image fallback shell, Vietnamese price, desktop/mobile responsive.");
}finally{await browser.close();}
