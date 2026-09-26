import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {createCatalogPublicApi} from "../js/website/catalog-api.js";

const playwrightEntry=process.env.CATALOG_WEBSITE_PLAYWRIGHT_ENTRY;
const browserPath=process.env.CATALOG_WEBSITE_BROWSER_PATH;
if(!playwrightEntry||!browserPath)throw new Error("CATALOG_WEBSITE_PLAYWRIGHT_ENTRY and CATALOG_WEBSITE_BROWSER_PATH are required.");
const {chromium}=await import(pathToFileURL(playwrightEntry).href).then(module=>module.default||module);
const browser=await chromium.launch({executablePath:browserPath,headless:true});
const read=file=>fs.readFileSync(file,"utf8");
const html=read("website/index.html")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"")
  .replace(/<link\b[^>]*catalog-website[^>]*>/gi,"");
const apiSource=read("js/website/catalog-api.js").replaceAll("export function","function");
const appSource=read("js/website/catalog-app.js")
  .replace(/import\s*\{[^}]+\}\s*from\s*"\.\/catalog-api\.js";\s*/,"")
  .replaceAll("export function","function");

const fixture=[
  {id:"p-1",code:"K-001",name:"TRAVERTINO DARK GREY",width_mm:600,height_mm:1200,size_display:"60 × 120 cm",surface:"MATT",color:"Grey",category:"Vân đá",collection:"Travertino",origin:"Italy",image_url:"https://images.invalid/travertino.jpg",price_per_m2:1915000,price_unit:"VND_M2"},
  {id:"p-2",code:"K-002",name:"BARRO BEIGE",width_mm:1200,height_mm:1200,size_display:"120 × 120 cm",surface:"GLOSSY",color:"Beige",category:"Xi măng",collection:"Barro",origin:null,image_url:"http://unsafe.invalid/barro.jpg",price_per_m2:null,price_unit:"VND_M2"},
  {id:"p-3",code:"K-003",name:"CALACATTA ORO",width_mm:1200,height_mm:2400,size_display:"120 × 240 cm",surface:"POLISH",color:"White",category:"Vân đá",collection:"Calacatta",origin:"Spain",image_url:null,price_per_m2:2450000,price_unit:"VND_M2"}
];

async function boot(){
  const page=await browser.newPage();
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("console",message=>{if(message.type()==="error"&&!/Failed to load resource/.test(message.text()))errors.push(message.text());});
  await page.route("**/*",route=>route.abort());
  await page.setContent(html);
  await page.addStyleTag({content:read("css/catalog-website.css").replace(/^@import[^\n]+\n/,"")});
  await page.addScriptTag({content:apiSource+"\n"+appSource});
  await page.evaluate(async products=>{
    const calls=[];
    let observerCallback;
    const api={list:async filters=>{
      calls.push({...filters});
      if(filters.offset===0)return {items:products.slice(0,2),pagination:{limit:2,offset:0,total:3,has_more:true,next_offset:2}};
      return {items:products.slice(2),pagination:{limit:2,offset:2,total:3,has_more:false,next_offset:null}};
    }};
    const observerFactory=callback=>{observerCallback=callback;return {observe(){},disconnect(){}};};
    const app=createCatalogWebsiteApp({api,root:document,observerFactory});
    await app.start();
    window.fixture={app,calls,triggerLazy:()=>observerCallback([{isIntersecting:true}])};
  },fixture);
  return {page,errors};
}

try{
  const {page,errors}=await boot();
  assert.equal(await page.locator(".product-card").count(),2,"first page renders");
  assert.match(await page.locator("#catalogCount").textContent(),/3 sản phẩm/);
  assert.match(await page.locator('[data-product-id="p-1"] .product-price').textContent(),/1\.915\.000 VNĐ\/m²/);
  assert.match(await page.locator('[data-product-id="p-1"] .product-attributes').textContent(),/60 × 120 cm/);
  assert.match(await page.locator('[data-product-id="p-2"] .product-price').textContent(),/Đang cập nhật/);
  assert.equal(await page.locator('[data-product-id="p-2"] img').count(),0,"rejects non-HTTPS image");
  assert.ok(await page.locator('[data-product-id="p-2"] .image-fallback').isVisible(),"missing image fallback visible");
  await page.waitForTimeout(80);
  assert.equal(await page.locator('[data-product-id="p-1"] img').count(),0,"broken external image falls back");

  await page.evaluate(()=>fixture.triggerLazy());
  await page.waitForFunction(()=>document.querySelectorAll(".product-card").length===3);
  assert.equal(await page.locator(".product-card").count(),3,"lazy next page renders once");
  assert.equal(await page.locator("#loadMore").isVisible(),false,"load more hidden at end");
  assert.deepEqual(await page.evaluate(()=>fixture.calls.map(call=>call.offset)),[0,2],"stable offsets");

  await page.locator("#catalogSearch").fill("travertino");
  await page.waitForTimeout(420);
  assert.equal((await page.evaluate(()=>fixture.calls.at(-1).search)),"travertino","debounced search reaches API");
  await page.locator("#categoryFilter").fill("Vân đá");
  await page.locator("#surfaceFilter").fill("MATT");
  await page.locator("#sizeFilter").selectOption("600x1200");
  await page.locator("#priceFilter").selectOption("1000000:2000000");
  await page.locator("#catalogFilters").evaluate(form=>form.requestSubmit());
  await page.waitForFunction(()=>fixture.calls.at(-1).widthMm===600&&fixture.calls.at(-1).minPrice===1000000);
  const filtered=await page.evaluate(()=>fixture.calls.at(-1));
  assert.equal(filtered.category,"Vân đá");assert.equal(filtered.surface,"MATT");
  assert.equal(filtered.widthMm,600);assert.equal(filtered.heightMm,1200);
  assert.equal(filtered.minPrice,1000000);assert.equal(filtered.maxPrice,2000000);

  for(const width of [1024,1366,1440]){
    await page.setViewportSize({width,height:900});
    assert.ok(await page.locator("#productGrid").isVisible(),`desktop grid ${width}`);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`no desktop overflow ${width}`);
  }
  for(const width of [360,390,430,768]){
    await page.setViewportSize({width,height:850});
    assert.ok(await page.locator("#mobileFilterToggle").isVisible(),`mobile filter ${width}`);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`no mobile overflow ${width}`);
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator("#mobileFilterToggle").click();
  assert.ok(await page.locator("#filterFields").isVisible(),"mobile filter opens");
  assert.equal(await page.locator("#mobileFilterToggle").getAttribute("aria-expanded"),"true");

  if(process.env.CATALOG_WEBSITE_SCREENSHOT_DIR){
    fs.mkdirSync(process.env.CATALOG_WEBSITE_SCREENSHOT_DIR,{recursive:true});
    await page.locator("#clearFilters").click();
    await page.waitForFunction(()=>document.querySelectorAll(".product-card").length===2);
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:path.join(process.env.CATALOG_WEBSITE_SCREENSHOT_DIR,"catalog-website-07a-desktop.png"),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(process.env.CATALOG_WEBSITE_SCREENSHOT_DIR,"catalog-website-07a-mobile.png"),fullPage:true});
  }
  assert.deepEqual(errors,[],`browser errors: ${errors.join(" | ")}`);
  await page.close();

  const apiCalls=[];
  const fakeClient={rpc:async(name,args)=>{apiCalls.push({name,args});return {data:{items:[],pagination:{limit:24,offset:0,total:0,has_more:false,next_offset:null}},error:null};}};
  await createCatalogPublicApi(fakeClient).list({search:"stone"});
  assert.equal(apiCalls[0].name,"catalog_public_list_products_v1","uses public RPC");
  assert.equal(apiCalls[0].args.p_search,"stone");
  console.log("PASS: Catalog website 07A browser fixture — public list, filters, lazy pagination, Vietnamese price, image fallback, desktop/mobile responsive.");
}finally{await browser.close();}
