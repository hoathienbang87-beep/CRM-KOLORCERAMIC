import fs from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const {chromium}=await import(pathToFileURL(process.env.UI_R1_PLAYWRIGHT_ENTRY).href);
const browser=await chromium.launch({executablePath:process.env.UI_R1_BROWSER_PATH,headless:true});
try{
  const page=await browser.newPage();
  const errors=[];
  page.on("console",msg=>{if(msg.type()==="error") errors.push(msg.text());});
  page.on("pageerror",error=>errors.push(error.message));
  const html=fs.readFileSync("index.html","utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"");
  await page.setContent(html);
  await page.addStyleTag({content:fs.readFileSync("css/styles.css","utf8")});
  await page.addScriptTag({content:fs.readFileSync("js/components/app-shell.js","utf8").replaceAll("export function","function").replaceAll("export const","const")+";renderAppShell();window.NAV=CRM_NAV_ITEMS;"});
  await page.evaluate(()=>{
    loginView.classList.add("hide"); appView.classList.remove("hide"); appView.removeAttribute("inert"); maintenanceView.classList.add("hide");
    window.role="sale";
    window.applyRole=role=>{
      window.role=role;
      document.querySelectorAll("[data-workspace-nav]").forEach(btn=>{
        const item=window.NAV.find(x=>x.id===btn.dataset.workspaceNav);
        const allowed=item.capability==="crm"||(item.capability==="manager"&&["manager","admin","owner"].includes(role))||(item.capability==="admin"&&["admin","owner"].includes(role));
        btn.classList.toggle("hide",!allowed); btn.disabled=!allowed;
      });
    };
    window.showPanel=id=>{
      for(const el of document.querySelectorAll("#overviewDashboard,#customerHubPanel,#customerNewPanel,#customerSearchPanel,#needCarePanel,#customerAllocationPanel,#kpiHubPanel,#kpiTeamPanel,#kpiFoundationPanel,#kpi2OperationsPanel,#productsPanel,#reportsPanel")){const show=el.id===id;el.classList.toggle("hide",!show);el.toggleAttribute("inert",!show);el.setAttribute("aria-hidden",String(!show));}
    };
    kpiHubCards.innerHTML='<button class="customer-action-card">KPI của tôi</button>';
    reportsHubCards.innerHTML='<button class="customer-action-card">Tổng hợp quản trị</button>';
    productRows.innerHTML='<tr data-open-product="p"><td>TEST</td><td>Sản phẩm</td><td></td><td></td><td></td><td>0</td><td>0</td><td></td><td></td></tr>';
    window.applyRole("sale"); window.showPanel("overviewDashboard");
    window.openTestModal=()=>{detailModal.classList.remove("hide");detailModal.removeAttribute("inert");detailModalBackdrop.classList.remove("hide");closeDetailModalBtn.focus();};
    window.closeTestModal=()=>{detailModal.classList.add("hide");detailModal.setAttribute("inert","");detailModalBackdrop.classList.add("hide");};
    document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!detailModal.classList.contains("hide")){e.preventDefault();window.closeTestModal();}});
  });

  const roleExpected={sale:["overview","customers","kpi","products"],manager:["overview","customers","kpi","products","reports"],owner:["overview","customers","kpi","products","reports","admin"]};
  for(const [role,expected] of Object.entries(roleExpected)){
    await page.evaluate(r=>window.applyRole(r),role);
    const visible=await page.locator("#desktopNavItems [data-workspace-nav]:not(.hide)").evaluateAll(els=>els.map(x=>x.dataset.workspaceNav));
    assert.deepEqual(visible,expected,`${role} role nav`);
  }

  const panels=["overviewDashboard","customerHubPanel","customerNewPanel","customerSearchPanel","needCarePanel","customerAllocationPanel","kpiHubPanel","kpiTeamPanel","kpiFoundationPanel","kpi2OperationsPanel","productsPanel","reportsPanel"];
  for(const width of [360,390,430,768,1024,1180,1366,1440,1920]){
    await page.setViewportSize({width,height:width<=430?800:900});
    for(const id of panels){
      await page.evaluate(panel=>window.showPanel(panel),id);
      const overflow=await page.evaluate(()=>({amount:document.documentElement.scrollWidth-document.documentElement.clientWidth,offenders:[...document.querySelectorAll("body *")].filter(el=>el.getBoundingClientRect().right>document.documentElement.clientWidth+1).slice(0,5).map(el=>`${el.tagName}#${el.id}.${el.className}`)}));
      assert.ok(overflow.amount<=1,`${id} tràn ${overflow.amount}px tại ${width}: ${overflow.offenders.join(", ")}`);
    }
  }

  await page.setViewportSize({width:390,height:800});
  await page.evaluate(()=>{mobileNavDrawer.classList.remove("hide");mobileNavDrawer.removeAttribute("inert");mobileNavBackdrop.classList.remove("hide");mobileNavCloseBtn.focus();});
  assert.equal(await page.locator("#mobileNavCloseBtn").evaluate(el=>el===document.activeElement),true);
  const point=await page.locator("#mobileNavCloseBtn").boundingBox();
  assert.ok(point && await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest("#mobileNavCloseBtn")?.id==="mobileNavCloseBtn",{x:point.x+5,y:point.y+5}),"mobile nav hit-test");
  await page.evaluate(()=>window.openTestModal());
  assert.equal(await page.locator("#closeDetailModalBtn").evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#detailModal").isVisible(),false);

  await page.evaluate(()=>{history.replaceState({panel:"overviewDashboard"},"","#one");history.pushState({panel:"customerHubPanel"},"","#two");history.pushState({panel:"kpiHubPanel"},"","#three");addEventListener("popstate",e=>window.showPanel(e.state?.panel||"overviewDashboard"));window.showPanel("kpiHubPanel");});
  await page.goBack(); assert.ok(await page.locator("#customerHubPanel").isVisible());
  await page.goForward(); assert.ok(await page.locator("#kpiHubPanel").isVisible());
  assert.deepEqual(errors,[],`Console errors: ${errors.join(" | ")}`);
  console.log("PASS CRM-UI-R1 STEP8 browser: roles, 9 widths, overflow, keyboard, modal, hit-test và history");
}finally{await browser.close();}
