import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {createCatalogPublicApi} from "../js/website/catalog-api.js";

const playwrightEntry=process.env.CATALOG_WEBSITE_PLAYWRIGHT_ENTRY,browserPath=process.env.CATALOG_WEBSITE_BROWSER_PATH;
if(!playwrightEntry||!browserPath)throw new Error("CATALOG_WEBSITE_PLAYWRIGHT_ENTRY and CATALOG_WEBSITE_BROWSER_PATH are required.");
const {chromium}=await import(pathToFileURL(playwrightEntry).href).then(module=>module.default||module);
const browser=await chromium.launch({executablePath:browserPath,headless:true});
const read=file=>fs.readFileSync(file,"utf8");
const html=read("website/index.html").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<link\b[^>]*catalog-website[^>]*>/gi,"");
const apiSource=read("js/website/catalog-api.js").replaceAll("export function","function");
const qrSource=read("js/website/catalog-qr.js").replaceAll("export function","function");
const detailSource=read("js/website/catalog-detail.js").replace(/import[^;]+;\s*/g,"").replaceAll("export function","function");
const product={id:"71000000-0000-4000-8000-000000000001",code:"SP-071",name:"TRAVERTINO DARK GREY",width_mm:1200,height_mm:2400,size_display:"120 × 240 cm",surface:"MATT",color:"Dark Grey",category:"Vân đá",collection:"Travertino",origin:"Italy",description:"Bề mặt vân đá tự nhiên dành cho không gian hiện đại.",image_url:"https://cdn.example.test/main.svg",gallery_urls:["https://cdn.example.test/second.svg","https://cdn.example.test/broken.jpg","http://unsafe.invalid/no.jpg"],pdf_url:"https://cdn.example.test/catalog.pdf",video_url:"https://cdn.example.test/video",more_info_url:"javascript:alert(1)",price_per_m2:1915000,price_unit:"VND_M2"};
const svg=colour=>`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="${colour}"/><path d="M0 150h800M0 430h800" stroke="#fff" stroke-opacity=".35" stroke-width="3"/></svg>`;

async function boot({identifier="SP-071",result=product}={}){
  const page=await browser.newPage();const errors=[];
  page.on("pageerror",error=>errors.push(error.message));page.on("console",message=>{if(message.type()==="error"&&!/Failed to load resource/.test(message.text()))errors.push(message.text());});
  await page.route("**/*",route=>route.abort());
  await page.route("https://cdn.example.test/main.svg",route=>route.fulfill({status:200,contentType:"image/svg+xml",body:svg("#8d7768")}));
  await page.route("https://cdn.example.test/second.svg",route=>route.fulfill({status:200,contentType:"image/svg+xml",body:svg("#b6aa98")}));
  await page.setContent(html);await page.addStyleTag({content:read("css/catalog-website.css").replace(/^@import[^\n]+\n/,"")});await page.addScriptTag({content:apiSource+"\n"+qrSource+"\n"+detailSource});
  await page.evaluate(async ({identifier,result})=>{
    const calls={get:[],lead:[],clipboard:[],events:[]};let failNext=false;
    const api={get:async value=>{calls.get.push(value);return result;},submitLead:async payload=>{calls.lead.push(structuredClone(payload));if(failNext){failNext=false;throw {code:"NETWORK",message:"offline"};}return{id:"lead-1",status:"RECEIVED",idempotent_replay:calls.lead.length>1};}};
    const locationRef=new URL(`https://catalog.example.test/?id=${encodeURIComponent(identifier)}&utm_source=test&utm_campaign=launch`);
    const navigatorRef={clipboard:{writeText:async value=>calls.clipboard.push(value)}};
    const track=(event,detail)=>calls.events.push({event,detail});
    const app=createCatalogDetailApp({api,identifier,root:document,locationRef,navigatorRef,track});await app.start();
    window.fixture={app,calls,setFail:()=>{failNext=true;}};
  },{identifier,result});
  return{page,errors};
}

async function fillLead(page,{name="Nguyễn An",phone="0912345678",email="",message="Tư vấn mẫu này"}={}){
  await page.locator("#leadName").fill(name);await page.locator("#leadPhone").fill(phone);await page.locator("#leadEmail").fill(email);await page.locator("#leadMessage").fill(message);await page.locator("#leadConsent").check();
}

try{
  const {page,errors}=await boot();
  assert.ok(await page.locator("#detailContent").isVisible(),"valid product detail visible");
  assert.equal(await page.locator("#catalogView").isVisible(),false,"catalog hidden in detail mode");
  assert.equal(await page.locator("#detailName").textContent(),product.name);
  assert.match(await page.locator("#detailPrice").textContent(),/1\.915\.000 VNĐ\/m²/);assert.equal(await page.locator("#detailSize").textContent(),"120 × 240 cm");
  await page.waitForFunction(()=>document.querySelectorAll("#detailThumbnails button").length===2);
  assert.equal(await page.locator("#detailThumbnails button").count(),2,"unsafe and broken gallery entries removed");
  await page.locator("#detailThumbnails button").nth(1).click();assert.match(await page.locator("#detailMainImage").getAttribute("src"),/second\.svg/);
  assert.equal(await page.locator("#detailMediaLinks a").count(),2,"only safe PDF/video links");
  assert.equal(await page.locator('#detailMediaLinks a[href^="javascript:"]').count(),0);
  assert.match(await page.locator("#zaloShare").getAttribute("href"),/^https:\/\/zalo\.me\/share\?url=/);assert.match(await page.locator("#whatsAppShare").getAttribute("href"),/^https:\/\/wa\.me/);
  await page.locator("#nativeShare").click();assert.match(await page.locator("#shareStatus").textContent(),/Đã sao chép/);assert.equal((await page.evaluate(()=>fixture.calls.clipboard.length)),1);
  await page.locator("#toggleQr").click();assert.ok(await page.locator("#qrPanel").isVisible());assert.ok((await page.locator("#productQr svg path").getAttribute("d")).length>1000,"local QR matrix rendered");

  await page.locator("#leadName").fill("Nguyễn An");await page.locator("#leadConsent").check();await page.locator("#leadForm").evaluate(form=>form.requestSubmit());assert.match(await page.locator("#leadContactError").textContent(),/số điện thoại hoặc email/);assert.equal(await page.evaluate(()=>fixture.calls.lead.length),0);
  await fillLead(page);await page.locator("#leadForm").evaluate(form=>form.requestSubmit());await page.waitForFunction(()=>fixture.calls.lead.length===1);assert.match(await page.locator("#leadStatus").textContent(),/Đã nhận yêu cầu/);
  const first=await page.evaluate(()=>fixture.calls.lead[0]);assert.equal(first.product_id,product.id);assert.equal(first.privacy_consent,true);assert.equal(first.utm.utm_source,"test");assert.equal(first.utm.utm_campaign,"launch");assert.match(first.request_id,/^[0-9a-f-]{36}$/);assert.equal(first.anti_spam.honeypot,"");

  await page.evaluate(()=>fixture.setFail());await fillLead(page,{name:"Trần Bình",phone:"",email:"binh@example.test"});await page.locator("#leadForm").evaluate(form=>form.requestSubmit());await page.waitForFunction(()=>fixture.calls.lead.length===2);assert.match(await page.locator("#leadStatus").textContent(),/Chưa thể gửi/);
  await page.locator("#leadForm").evaluate(form=>form.requestSubmit());await page.waitForFunction(()=>fixture.calls.lead.length===3);const retry=await page.evaluate(()=>fixture.calls.lead.slice(1));assert.equal(retry[0].request_id,retry[1].request_id,"retry keeps idempotency UUID");
  const events=await page.evaluate(()=>fixture.calls.events);assert.ok(events.some(item=>item.event==="product_view"));assert.ok(events.some(item=>item.event==="lead_submit_success"));assert.equal(JSON.stringify(events).includes("0912345678"),false,"tracking excludes contact PII");

  for(const width of [1024,1440,360,390,430,768]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`no detail overflow ${width}`);}
  if(process.env.CATALOG_WEBSITE_SCREENSHOT_DIR){fs.mkdirSync(process.env.CATALOG_WEBSITE_SCREENSHOT_DIR,{recursive:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(process.env.CATALOG_WEBSITE_SCREENSHOT_DIR,"catalog-website-07b-detail-desktop.png"),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(process.env.CATALOG_WEBSITE_SCREENSHOT_DIR,"catalog-website-07b-detail-mobile.png"),fullPage:true});}
  assert.deepEqual(errors,[],`browser errors: ${errors.join(" | ")}`);await page.close();

  for(const identifier of ["UNKNOWN-ID","DRAFT-071"]){const state=await boot({identifier,result:null});assert.ok(await state.page.locator("#detailNotFound").isVisible(),`${identifier} not found`);assert.equal(await state.page.locator("#detailContent").isVisible(),false);await state.page.close();}
  const broken=await boot({identifier:"BROKEN",result:{...product,code:"BROKEN",image_url:"https://cdn.example.test/broken.jpg",gallery_urls:[]}});await broken.page.waitForTimeout(80);assert.ok(await broken.page.locator("#detailImageFallback").isVisible(),"broken main image fallback");assert.equal(await broken.page.locator("#detailMainImage").isVisible(),false);await broken.page.close();

  const calls=[];const client={rpc:async(name,args)=>{calls.push({name,args});return{data:name.includes("get_product")?product:{id:"lead"},error:null};}};const adapter=createCatalogPublicApi(client);await adapter.get("SP-071");await adapter.submitLead({request_id:"id"});assert.deepEqual(calls.map(call=>call.name),["catalog_public_get_product_v1","catalog_submit_website_lead_v1"]);
  console.log("PASS: Catalog website 07B browser fixture — valid/invalid/draft detail, gallery/media fallback, share/QR, idempotent lead, privacy tracking and mobile.");
}finally{await browser.close();}
