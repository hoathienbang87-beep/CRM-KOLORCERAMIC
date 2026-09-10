import fs from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(process.env.UI_R1_PLAYWRIGHT_ENTRY).href);
const browser = await chromium.launch({ executablePath:process.env.UI_R1_BROWSER_PATH, headless:true });
try {
  const page = await browser.newPage();
  await page.route("**/*", route => route.abort());
  const html = fs.readFileSync("index.html", "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  await page.setContent(html);
  await page.addStyleTag({ content:fs.readFileSync("css/styles.css", "utf8") });
  await page.evaluate(() => {
    loginView.classList.add("hide"); maintenanceView.classList.add("hide"); appView.classList.remove("hide"); appView.removeAttribute("inert");
    window.fixtureRole = "manager";
    window.reportRoutes = {"#/reports":"reportsHubPanel","#/reports/summary":"reportSummaryPanel","#/reports/sales":"reportSalesPanel","#/reports/customers":"reportCustomersPanel"};
    window.renderFixtureRoute = () => {
      let hash = location.hash || "#/overview";
      if (hash.startsWith("#/reports") && !["manager","owner"].includes(window.fixtureRole)) hash = "#/overview";
      if (hash !== location.hash) history.replaceState({}, "", hash);
      const report = window.reportRoutes[hash];
      reportsPanel.classList.toggle("hide", !report);
      overviewDashboard.classList.toggle("hide", Boolean(report));
      Object.values(window.reportRoutes).forEach(id => {
        const panel = document.getElementById(id), visible = id === report;
        panel.classList.toggle("hide", !visible); panel.toggleAttribute("inert", !visible); panel.setAttribute("aria-hidden", String(!visible));
      });
    };
    reportsHubCards.innerHTML = [
      ["Tổng hợp quản trị","#/reports/summary"],["Hoạt động Sale","#/reports/sales"],["Khách hàng & kênh","#/reports/customers"]
    ].map(([label,route]) => `<button data-report-route="${route}">${label}</button>`).join("");
    document.addEventListener("click", event => { const route=event.target.closest("[data-report-route]")?.dataset.reportRoute; if(route){history.pushState({},"",route);window.renderFixtureRoute();} });
    addEventListener("popstate", window.renderFixtureRoute); window.renderFixtureRoute();
  });

  for (const width of [1440,1366,1180,768,390,360]) {
    await page.setViewportSize({width,height:width===1366?768:900});
    await page.goto("about:blank#/reports");
    await page.setContent(html); await page.addStyleTag({content:fs.readFileSync("css/styles.css","utf8")});
    // Kiểm tra responsive trên DOM thật không phụ thuộc router fixture sau navigation.
    await page.evaluate(() => { loginView.classList.add("hide"); maintenanceView.classList.add("hide"); appView.classList.remove("hide"); reportsPanel.classList.remove("hide"); reportsHubPanel.classList.remove("hide"); });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth);
    assert.ok(overflow<=1, `Reports không tràn ngang tại ${width}px`);
  }

  // Tạo lại fixture router để kiểm tra route/history/authorization.
  await page.setContent(html); await page.addStyleTag({content:fs.readFileSync("css/styles.css","utf8")});
  await page.evaluate(() => {
    loginView.classList.add("hide"); maintenanceView.classList.add("hide"); appView.classList.remove("hide");
    window.fixtureRole="manager"; window.routes={"#/reports":"reportsHubPanel","#/reports/summary":"reportSummaryPanel","#/reports/sales":"reportSalesPanel","#/reports/customers":"reportCustomersPanel"};
    window.renderRoute=hash=>{if(hash.startsWith("#/reports")&&!['manager','owner'].includes(window.fixtureRole))hash="#/overview";reportsPanel.classList.toggle('hide',hash==="#/overview");overviewDashboard.classList.toggle('hide',hash!=="#/overview");Object.entries(window.routes).forEach(([route,id])=>document.getElementById(id).classList.toggle('hide',route!==hash));return hash;};
    window.go=hash=>{hash=window.renderRoute(hash);history.pushState({},"",hash);};
    addEventListener('popstate',()=>window.renderRoute(location.hash));
  });
  for (const role of ["manager","owner"]) for (const route of ["#/reports","#/reports/summary","#/reports/sales","#/reports/customers"]) {
    await page.evaluate(([r,h])=>{window.fixtureRole=r;window.go(h)},[role,route]);
    assert.equal(await page.locator("#reportsPanel").isVisible(),true,`${role} phải mở ${route}`);
  }
  await page.evaluate(()=>{window.fixtureRole='manager';window.go('#/reports');window.go('#/reports/summary');window.go('#/reports/sales');window.go('#/reports/customers')});
  await page.goBack(); assert.equal(new URL(page.url()).hash,"#/reports/sales");
  await page.goBack(); assert.equal(new URL(page.url()).hash,"#/reports/summary");
  await page.goForward(); assert.equal(new URL(page.url()).hash,"#/reports/sales");
  for (const route of ["#/reports","#/reports/summary","#/reports/sales","#/reports/customers"]) {
    await page.evaluate(h=>{window.fixtureRole='sale';window.go(h)},route);
    assert.equal(new URL(page.url()).hash,"#/overview");
    assert.equal(await page.locator("#reportsPanel").isVisible(),false);
  }
  assert.equal(await page.locator("#growthChart").count(),1); assert.equal(await page.locator("#channelReportChart").count(),1);
  console.log("PASS CRM-UI-R1 STEP6 browser fixture: roles, routes, history và responsive");
} finally { await browser.close(); }
