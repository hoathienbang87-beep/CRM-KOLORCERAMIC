import fs from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(process.env.UI_R1_PLAYWRIGHT_ENTRY).href);
const browser = await chromium.launch({ executablePath: process.env.UI_R1_BROWSER_PATH, headless: true });
try {
  const page = await browser.newPage();
  await page.route("**/*", route => route.abort());
  const html = fs.readFileSync("index.html", "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  await page.setContent(html);
  await page.addStyleTag({ content: fs.readFileSync("css/styles.css", "utf8") });
  await page.evaluate(() => { loginView.classList.add("hide"); maintenanceView.classList.add("hide"); appView.classList.remove("hide"); appView.removeAttribute("inert"); });
  const matrices = {
    sale: [["KPI của tôi","#/kpi/mine","Chưa có kỳ KPI đang hoạt động"]],
    manager: [["KPI Team","#/kpi/team","Chưa có kỳ đang hoạt động"],["Bộ KPI & Kỳ KPI","#/kpi/library","8 mục · Chưa có kỳ"],["Lịch sử KPI","#/kpi/history","Chưa có lịch sử kỳ"]]
  };
  for (const role of ["sale","manager"]) {
    await page.evaluate(({role,cards}) => {
      kpiHubPanel.classList.remove("hide");
      kpiHubCards.innerHTML = cards.map(([a,b,c]) => `<button class="customer-action-card kpi-hub-card" data-kpi-route="${b}"><b>${a}</b><span>Mô tả</span><small>${c}</small></button>`).join("");
      kpiTeamPanel.classList.add("hide"); kpiFoundationPanel.classList.add("hide"); kpi2OperationsPanel.classList.add("hide");
    }, {role,cards:matrices[role]});
    assert.equal(await page.locator("#kpiHubCards button").count(), role === "sale" ? 1 : 3);
    if (role === "sale") assert.equal(await page.locator('[data-kpi-route="#/kpi/library"]').count(), 0);
    for (const width of [1440,1366,1180,768,390,360]) {
      await page.setViewportSize({width,height:900});
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `${role} KPI Hub không tràn tại ${width}px`);
      if (width <= 760) assert.equal(await page.locator("#kpiHubCards").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length), 1);
    }
  }
  await page.evaluate(() => { kpiHubPanel.classList.add("hide"); kpiTeamPanel.classList.remove("hide"); });
  assert.equal(await page.locator(".legacy-kpi-mode-tabs").isVisible(), false);
  assert.equal(await page.locator("#kpiTeamPendingBtn").isVisible(), true, "review/drawer controls còn khả dụng");
  console.log("PASS CRM-UI-R1 STEP5 browser fixture: roles/routes/mobile/controls");
} finally { await browser.close(); }
