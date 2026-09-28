import fs from "node:fs";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";

const playwrightEntry=process.env.CRM_RETIREMENT_PLAYWRIGHT_ENTRY||process.env.PRODUCTS_TEST_PLAYWRIGHT_ENTRY||process.env.UI_R1_PLAYWRIGHT_ENTRY;
const browserPath=process.env.CRM_RETIREMENT_BROWSER_PATH||process.env.PRODUCTS_TEST_BROWSER_PATH||process.env.UI_R1_BROWSER_PATH;
if(!playwrightEntry||!browserPath)throw new Error("CRM_RETIREMENT_PLAYWRIGHT_ENTRY and CRM_RETIREMENT_BROWSER_PATH are required.");
const playwrightModule=await import(pathToFileURL(playwrightEntry).href);
const {chromium}=playwrightModule.default||playwrightModule;
const browser=await chromium.launch({executablePath:browserPath,headless:true});

try{
  const page=await browser.newPage();const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
  const html=fs.readFileSync("index.html","utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"");
  await page.setContent(html);
  await page.addStyleTag({content:fs.readFileSync("css/styles.css","utf8")});
  const shell=fs.readFileSync("js/components/app-shell.js","utf8").replaceAll("export function","function").replaceAll("export const","const");
  await page.addScriptTag({content:`${shell};renderAppShell();window.fixture={nav:CRM_NAV_ITEMS,resolve:hash=>workspaceForHash(hash)};`});
  await page.evaluate(()=>{loginView.classList.add("hide");appView.classList.remove("hide");appView.removeAttribute("inert");});

  assert.equal(await page.locator('[data-workspace-nav="products"]').count(),0,"no Product management navigation");
  assert.equal(await page.locator("#productsPanel,#productDrawer,#addProductBtn").count(),0,"no Product management DOM");
  assert.equal(await page.locator('[data-workspace-nav="admin"]').first().getAttribute("data-nav-path"),"/admin");
  assert.match(await page.locator('[data-workspace-nav="admin"]').first().textContent(),/Quản lý catalog/);
  assert.equal(await page.evaluate(()=>fixture.resolve("#/products").hash),"#/overview","stale Product URL falls back");
  for(const id of ["need","editNeed","careNeed","productOptions"])
    assert.equal(await page.locator(`#${id}`).count(),1,`business field #${id} retained`);

  const roleExpected={sale:["overview","customers","kpi"],manager:["overview","customers","kpi","reports"],owner:["overview","customers","kpi","reports","admin"]};
  for(const [role,expected] of Object.entries(roleExpected)){
    const visible=await page.evaluate(({role})=>{
      const allowed=item=>item.capability==="crm"||(item.capability==="manager"&&["manager","admin","owner"].includes(role))||(item.capability==="admin"&&["admin","owner"].includes(role));
      document.querySelectorAll("[data-workspace-nav]").forEach(button=>{const item=fixture.nav.find(entry=>entry.id===button.dataset.workspaceNav);button.classList.toggle("hide",!allowed(item));});
      return [...document.querySelectorAll("#desktopNavItems [data-workspace-nav]:not(.hide)")].map(button=>button.dataset.workspaceNav);
    },{role});
    assert.deepEqual(visible,expected,`${role} navigation`);
  }

  for(const width of [1440,1024,768,430,390,360]){
    await page.setViewportSize({width,height:850});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    assert.ok(overflow<=1,`CRM shell overflow ${overflow}px at ${width}`);
  }
  assert.deepEqual(errors,[],`browser errors: ${errors.join(" | ")}`);
  console.log("PASS: CRM catalog retirement 08B browser — Product management hidden, /admin handoff, role navigation and responsive shell.");
}finally{await browser.close();}
