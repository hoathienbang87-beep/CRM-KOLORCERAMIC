// Browser fixture only: no login, production call or business-data mutation.
import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import {pathToFileURL} from "node:url";

const playwrightModule = await import(pathToFileURL(process.env.PRODUCTS_TEST_PLAYWRIGHT_ENTRY).href);
const {chromium} = playwrightModule.default || playwrightModule;
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const browser = await chromium.launch({executablePath:process.env.PRODUCTS_TEST_BROWSER_PATH,headless:true});
const page = await browser.newPage();
page.on("pageerror", error => console.error("BROWSER_PAGE_ERROR", error));
await page.route("**/*", route => route.abort());

try {
  await page.setContent(`<style>${read("css/styles.css")}</style><main id="fixture"></main>`);
  await page.evaluate(html => {
    const parsed = new DOMParser().parseFromString(html,"text/html");
    const host = document.querySelector("#fixture");
    host.style.padding = "12px";
    for (const id of ["productsPanel","productDrawerBackdrop","productDrawer","productOptions"])
      host.append(parsed.getElementById(id));
    document.querySelector("#productsPanel").classList.remove("hide");
  }, read("index.html"));

  const app = read("js/features/crm-app.js");
  const slice = (start,end) => app.slice(app.indexOf(start),app.indexOf(end));
  const harness = `
    ${read("js/features/product-catalog.js").replaceAll("export function","function")}
    const $=id=>document.getElementById(id),clean=x=>String(x??"").trim();
    const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const normalizeKey=x=>clean(x).normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/đ/g,"d").toLowerCase();
    const uniq=x=>[...new Set(x)],uniqueOptions=x=>x.map(value=>({value,label:value})),toDate=x=>new Date(x),todayIso=()=>"2026-09-11";
    const setViewHidden=(id,hidden)=>{const el=$(id);el.classList.toggle("hide",hidden);el.toggleAttribute("inert",hidden);el.setAttribute("aria-hidden",String(hidden));};
    const rememberOverlayFocus=()=>{},restoreOverlayFocus=()=>{},pageRows=(key,rows)=>rows.slice(0,80),renderPager=()=>{};
    let appUser={role:"sale"},products=[],notices=[],calls=[];
    const roleKey=()=>clean(appUser.role).toLowerCase();
    const isManager=()=>["owner","admin","manager"].includes(roleKey());
    const notice=(text,error=false)=>notices.push({text,error});
    window.confirm=()=>true;
    ${slice("function fillSelect(","function ownerOptions(")}
    ${slice("function productLabel(","function inventoryTypeLabel(")}
    const history=[{id:"h1",effective_date:"2026-09-03",price_per_m2:"760000",price_per_box:"1094400",price_per_piece:"547200",source_type:"MANUAL",changed_by_user_id:"sale-1",changed_by_name:"Sale Test",changed_at:"2026-09-11T01:00:00Z"}];
    function serverRow(extra={}){return {id:"11111111-aaaa-4aaa-8aaa-111111111111",code:"R2-A1",name:"Gạch R2 A1",width_cm:"60.000",height_cm:"120.000",price_per_m2:"760000",price_per_box:"1094400",price_per_piece:"547200",pieces_per_box:2,sqm_per_box:"1.4400",surface:"MATT",origin:null,stock_quantity:null,price_effective_date:"2026-09-03",active:true,version:1,created_at:"2026-09-11T00:00:00Z",created_by_user_id:"sale-1",created_by_name:"Sale Test",updated_at:"2026-09-11T01:00:00Z",updated_by_user_id:"sale-1",updated_by_name:"Sale Test",...extra};}
    async function callCrmRpc(name,args){calls.push({name,args});
      if(name==="crm_list_product_price_history")return history;
      if(name==="crm_create_product")return serverRow();
      if(name==="crm_update_product")return serverRow({name:args.p_changes.name||"Gạch R2 A1",version:2,updated_at:"2026-09-11T02:00:00Z"});
      if(name==="crm_set_product_active")return serverRow({active:args.p_active,version:2,updated_by_user_id:"manager-1",updated_by_name:"Manager Test"});
      return [];
    }
    ${slice("// PRODUCT-R2:","const quoteStatusOptions")}
    productsLoading=false;renderProducts();
    document.addEventListener("click",event=>{const id=event.target.closest("[data-open-product]")?.dataset.openProduct;if(id)openProductDrawer(id);});
    $("addProductBtn").onclick=()=>openProductDrawer(null);
    $("saveProductBtn").onclick=saveProductDrawer;
    $("editProductBtn").onclick=()=>{if(!canEditProduct())return;$("productDrawer").querySelectorAll("input").forEach(input=>input.disabled=false);$("editProductBtn").classList.add("hide");$("saveProductBtn").classList.remove("hide");};
    $("archiveProductBtn").onclick=toggleProductActive;
    $("closeProductDrawerBtn").onclick=closeProductDrawer;
    window.fixture={
      get products(){return products},get notices(){return notices},get calls(){return calls},
      setRole(role){appUser.role=role;renderProducts();},
      seed(){products=[productFromCanonical(serverRow())];renderProducts();}
    };
  `;
  await page.addScriptTag({content:harness});

  await page.setViewportSize({width:1440,height:1000});
  assert.match(await page.locator("#productRows").textContent(),/Chưa có sản phẩm/);
  assert.ok(await page.locator("#addProductBtn").isVisible(),"Sale sees Create Product");
  const addPoint = await page.locator("#addProductBtn").boundingBox();
  assert.ok(addPoint && await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.id==="addProductBtn",{x:addPoint.x+addPoint.width/2,y:addPoint.y+addPoint.height/2}),"Create button hit-test");

  await page.locator("#addProductBtn").click();
  assert.equal(await page.locator("#productPriceEffectiveDateInput").inputValue(),"2026-09-11","Ngày hiệu lực được prefill và hiển thị");
  await page.locator("#productCodeInput").fill("R2-A1");
  await page.locator("#productNameInput").fill("Gạch R2 A1");
  await page.locator("#productWidthCmInput").fill("60");
  await page.locator("#productHeightCmInput").fill("120");
  await page.locator("#productPricePerM2Input").fill("760000");
  await page.locator("#productPriceEffectiveDateInput").fill("2026-09-03");
  await page.locator("#saveProductBtn").click();
  await page.waitForFunction(()=>fixture.products.length===1);
  const createCall = await page.evaluate(()=>fixture.calls.find(call=>call.name==="crm_create_product"));
  assert.equal(createCall.args.p_product.width_cm,"60");
  assert.equal(createCall.args.p_product.height_cm,"120");
  assert.equal(createCall.args.p_product.price_per_m2,"760000");
  assert.equal(createCall.args.p_product.price_effective_date,"2026-09-03");
  assert.equal(createCall.args.p_product.stock_quantity,null);
  assert.match(await page.locator("#productCreatedByText").textContent(),/Sale Test/);
  assert.match(await page.locator("#productUpdatedByText").textContent(),/Sale Test/);
  assert.match(await page.locator("#productHistoryList").textContent(),/Giá\/m²: 760\.000 ₫/);

  await page.locator("#editProductBtn").click();
  await page.locator("#productNameInput").fill("Gạch R2 Sale cập nhật");
  await page.locator("#saveProductBtn").click();
  await page.waitForFunction(()=>fixture.calls.some(call=>call.name==="crm_update_product"));
  const updateCall = await page.evaluate(()=>fixture.calls.find(call=>call.name==="crm_update_product"));
  assert.equal(updateCall.args.p_expected_version,1);
  assert.deepEqual(updateCall.args.p_changes,{name:"Gạch R2 Sale cập nhật"});
  assert.equal(await page.locator("#archiveProductBtn").isVisible(),false,"Sale cannot archive");
  await page.locator("#closeProductDrawerBtn").click();

  for (const width of [1366,1440]) {
    await page.setViewportSize({width,height:900});
    assert.ok(await page.locator(".product-table-wrap").isVisible(),`Desktop table visible at ${width}`);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`No overflow at ${width}`);
  }
  for (const width of [360,390,768]) {
    await page.setViewportSize({width,height:900});
    assert.equal(await page.locator(".product-table-wrap").isVisible(),false,`Mobile cards at ${width}`);
    assert.ok(await page.locator("#productCardList").isVisible());
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`No overflow at ${width}`);
  }

  await page.evaluate(()=>fixture.setRole("manager"));
  await page.locator(".product-card").click();
  assert.ok(await page.locator("#archiveProductBtn").isVisible(),"Manager sees lifecycle control");
  await page.locator("#archiveProductBtn").click();
  await page.waitForFunction(()=>fixture.calls.some(call=>call.name==="crm_set_product_active"));
  await page.locator("#closeProductDrawerBtn").click();

  await page.evaluate(()=>fixture.setRole("owner"));
  assert.ok(await page.locator("#addProductBtn").isVisible(),"Owner sees Create Product");

  const output = process.env.PRODUCTS_TEST_OUTPUT_DIR;
  if (output) {
    fs.mkdirSync(output,{recursive:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:path.join(output,"products-r2-desktop.png"),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(output,"products-r2-mobile.png"),fullPage:true});
  }
  console.log("Product R2 UI fixture PASS: Sale create/edit, typed fields, actor/time/history, Manager lifecycle, empty state, 360/390/768/1366/1440 responsive and hit-testing.");
} finally {
  await browser.close();
}
