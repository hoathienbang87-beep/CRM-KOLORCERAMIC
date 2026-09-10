import fs from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(process.env.UI_R1_PLAYWRIGHT_ENTRY).href);
const browser = await chromium.launch({executablePath:process.env.UI_R1_BROWSER_PATH, headless:true});
try {
  const page = await browser.newPage();
  const html = fs.readFileSync("index.html", "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  await page.setContent(html);
  await page.addStyleTag({content:fs.readFileSync("css/styles.css", "utf8")});
  await page.evaluate(() => {
    for (const id of ["proHealthPanel", "dataSafetyPanel"]) { const el=document.getElementById(id); el.classList.remove("hide"); adminHealthPanels.append(el); }
    for (const id of ["seedBtn", "syncPhoneBtn", "syncOwnerBtn", "importBtn", "importFile"]) { const el=document.getElementById(id); el.classList.remove("hide"); adminDangerTools.append(el); }
    trashPanel.classList.remove("hide"); adminTrashHost.append(trashPanel);
    for (const id of ["careSettingsPanel", "dropdownSettingsPanel", "userAdminPanel", "auditPanel"]) document.getElementById(id)?.remove();
    loginView.classList.add("hide"); appView.classList.add("hide"); adminAppView.classList.remove("hide"); adminAppView.removeAttribute("inert");
    adminHubCards.innerHTML=[
      ["Người dùng & vòng đời","/admin/users"],["Danh mục CRM","/admin/categories"],["Cấu hình công ty & chăm sóc","/admin/settings"],
      ["Sức khỏe & an toàn dữ liệu","/admin/health"],["Nhật ký & thùng rác","/admin/audit-logs"]
    ].map(([t,r])=>`<button class="admin-hub-card" data-admin-route="${r}"><b>${t}</b><span>Mô tả khu vực</span></button>`).join("");
    window.testRoute = path => {
      const map={"/admin":"dashboard","/admin/users":"users","/admin/categories":"categories","/admin/settings":"settings","/admin/health":"health","/admin/audit-logs":"audit-logs"};
      document.querySelectorAll("[data-admin-page]").forEach(el=>el.classList.toggle("hide",el.dataset.adminPage!==map[path]));
    };
    window.testGuard = role => {
      const allowed=["owner","admin"].includes(role);
      adminAppView.classList.toggle("hide",!allowed); appView.classList.toggle("hide",allowed);
      return allowed;
    };
    window.testRoute("/admin");
  });
  const routes=["/admin","/admin/users","/admin/categories","/admin/settings","/admin/health","/admin/audit-logs"];
  for (const width of [1440,1366,1180,768,390,360]) {
    await page.setViewportSize({width,height:900});
    assert.equal(await page.locator("#adminHubCards .admin-hub-card").count(),5);
    for (const route of routes) {
      await page.evaluate(r=>window.testRoute(r),route);
      assert.equal(await page.locator('[data-admin-page]:not(.hide)').count(),1, `${route} tại ${width}`);
    }
    const overflow = await page.evaluate(() => ({
      amount: document.documentElement.scrollWidth-document.documentElement.clientWidth,
      offenders: [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0,5).map(el => `${el.tagName}#${el.id}.${el.className}`)
    }));
    assert.ok(overflow.amount<=1, `Không tràn ngang tại ${width}px: ${overflow.amount}px ${overflow.offenders.join(", ")}`);
  }
  assert.equal(await page.locator("#adminDangerTools #seedBtn").count(),1);
  assert.equal(await page.locator("#adminTrashHost #trashPanel").count(),1);
  for (const role of ["manager","sale"]) assert.equal(await page.evaluate(r=>window.testGuard(r),role),false);
  assert.equal(await page.evaluate(()=>window.testGuard("owner")),true);
  await page.evaluate(() => {
    addEventListener("popstate", event => window.testRoute(event.state?.route || "/admin"));
    history.replaceState({route:"/admin"}, "", "#admin");
    history.pushState({route:"/admin/users"}, "", "#admin-users");
    window.testRoute("/admin/users");
    history.pushState({route:"/admin/settings"}, "", "#admin-settings");
    window.testRoute("/admin/settings");
  });
  await page.goBack();
  assert.ok(await page.locator('[data-admin-page="users"]').isVisible(), "Back khôi phục Users");
  await page.goForward();
  assert.ok(await page.locator('[data-admin-page="settings"]').isVisible(), "Forward khôi phục Settings");
  console.log("PASS CRM-UI-R1 STEP7 browser fixture: workspaces, responsive và role denial");
} finally { await browser.close(); }
