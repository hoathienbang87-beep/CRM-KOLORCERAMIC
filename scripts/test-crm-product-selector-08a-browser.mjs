import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";

const playwrightEntry=process.env.CRM_SELECTOR_PLAYWRIGHT_ENTRY,browserPath=process.env.CRM_SELECTOR_BROWSER_PATH;
if(!playwrightEntry||!browserPath)throw new Error("CRM_SELECTOR_PLAYWRIGHT_ENTRY and CRM_SELECTOR_BROWSER_PATH are required.");
const {chromium}=await import(pathToFileURL(playwrightEntry).href).then(module=>module.default||module);
const browser=await chromium.launch({executablePath:browserPath,headless:true});
const read=file=>fs.readFileSync(file,"utf8");
const selectorSource=read("js/features/crm-product-selector.js").replaceAll("export function","function");
const css=read("css/styles.css");
const products=[
  {id:"p-1",code:"SP-120240",name:"TRAVERTINO DARK GREY",width_mm:1200,height_mm:2400,surface:"MATT",price_per_m2:1915000,price_unit:"VND_M2",data_status:"READY",is_published:true,active:true,version:7},
  {id:"p-2",code:"SP-BARRO",name:"BARRO BEIGE",width_mm:600,height_mm:1200,surface:"GLOSSY",price_per_m2:null,price_unit:"VND_M2",data_status:"UPDATING",is_published:false,active:true,version:2}
];

try{
  const page=await browser.newPage();const errors=[];
  page.on("pageerror",error=>errors.push(error.message));page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
  await page.setContent('<!doctype html><html><body><button id="open">Chọn sản phẩm</button><output id="picked" hidden></output></body></html>');
  await page.addStyleTag({content:css});await page.addScriptTag({content:selectorSource});
  await page.evaluate(products=>{
    const calls=[];
    const rpc=async(name,args)=>{calls.push({name,args});const q=(args.p_search||"").toUpperCase();return products.filter(item=>!q||`${item.code} ${item.name} ${item.surface}`.includes(q));};
    const selector=createCrmProductSelector({rpc,documentRef:document,windowRef:{location:{origin:"https://crm.example.test"},requestAnimationFrame:callback=>window.requestAnimationFrame(callback)}});
    document.querySelector("#open").addEventListener("click",()=>selector.open({heading:"Chọn cho đơn hàng",onSelect:product=>{document.querySelector("#picked").textContent=JSON.stringify(product);}}));
    window.fixture={calls,selector};
  },products);

  await page.locator("#open").click();await page.waitForFunction(()=>fixture.calls.length===1);
  assert.equal(await page.locator("[data-product-selector]").isVisible(),true,"selector opens");
  assert.equal(await page.locator(".crm-product-selector-card").count(),2,"products rendered");
  assert.match(await page.locator(".crm-product-selector-card").first().textContent(),/1\.915\.000 ₫\/m²/);
  assert.match(await page.locator(".crm-product-selector-card").first().textContent(),/120 × 240 cm/);
  assert.match(await page.locator(".crm-product-selector-card").nth(1).textContent(),/Đang cập nhật/);
  assert.equal(await page.locator(".crm-product-selector-card").first().locator("a").getAttribute("href"),"https://crm.example.test/?id=SP-120240");
  assert.equal(await page.locator(".crm-product-selector-card").first().locator("a").getAttribute("rel"),"noopener noreferrer");

  await page.locator("[data-product-selector-search]").fill("BARRO");await page.waitForFunction(()=>fixture.calls.length>=2);
  assert.equal(await page.locator(".crm-product-selector-card").count(),1,"debounced search result");
  const searchCall=await page.evaluate(()=>fixture.calls.at(-1));assert.equal(searchCall.name,"catalog_crm_search_products");assert.equal(searchCall.args.p_search,"BARRO");assert.equal(searchCall.args.p_limit,50);
  await page.locator("[data-product-selector-pick]").click();assert.equal(await page.locator("[data-product-selector]").isVisible(),false,"selector closes after pick");
  const picked=JSON.parse(await page.locator("#picked").textContent());assert.equal(picked.id,"p-2");assert.equal(picked.widthCm,"60");

  for(const width of [1440,1024,768,430,390,360]){
    await page.setViewportSize({width,height:850});await page.locator("#open").click();await page.waitForTimeout(30);
    const bounds=await page.locator("[data-product-selector]").evaluate(element=>{const rect=element.getBoundingClientRect();return{left:rect.left,right:rect.right,width:rect.width,viewport:document.documentElement.clientWidth};});
    assert.ok(bounds.left>=-1&&bounds.right<=bounds.viewport+1,`selector within viewport ${width}: ${JSON.stringify(bounds)}`);
    await page.keyboard.press("Escape");
  }
  if(process.env.CRM_SELECTOR_SCREENSHOT_DIR){fs.mkdirSync(process.env.CRM_SELECTOR_SCREENSHOT_DIR,{recursive:true});await page.setViewportSize({width:1440,height:900});await page.locator("#open").click();await page.screenshot({path:path.join(process.env.CRM_SELECTOR_SCREENSHOT_DIR,"crm-product-selector-08a-desktop.png"),fullPage:true});await page.keyboard.press("Escape");await page.setViewportSize({width:390,height:844});await page.locator("#open").click();await page.screenshot({path:path.join(process.env.CRM_SELECTOR_SCREENSHOT_DIR,"crm-product-selector-08a-mobile.png"),fullPage:true});}
  assert.deepEqual(errors,[],`browser errors: ${errors.join(" | ")}`);
  await page.close();
  console.log("PASS: CRM product selector 08A browser fixture — RPC search, Vietnamese price, website link, selection and desktop/mobile responsive.");
}finally{await browser.close();}
