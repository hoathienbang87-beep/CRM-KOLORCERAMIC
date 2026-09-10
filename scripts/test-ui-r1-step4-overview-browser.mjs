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
  await page.evaluate(() => {
    loginView.classList.add("hide"); maintenanceView.classList.add("hide"); appView.classList.remove("hide"); appView.removeAttribute("inert");
    executiveGrid.innerHTML = `
      <button class="overview-summary-card" data-overview-route="#/customers/list"><span>Khách hàng của tôi</span><b>0</b><small>Danh sách được phân quyền</small></button>
      <button class="overview-summary-card" data-overview-route="#/customers/care"><span>Chăm sóc hôm nay</span><b>0</b><small>Không có lịch hôm nay</small></button>
      <button class="overview-summary-card" data-overview-route="#/customers/care"><span>Quá hạn</span><b>0</b><small>Không có việc quá hạn</small></button>
      <button class="overview-summary-card" data-overview-route="#/kpi"><span>KPI</span><b>Chưa có kỳ đang hoạt động</b><small>Không hiển thị phần trăm giả</small></button>`;
    overviewAttentionSummary.innerHTML = `<button class="overview-attention-card"><span>Hôm nay</span><b>0</b><small>Không có lịch chăm sóc hôm nay</small></button>`;
  });

  for (const width of [1440, 1366, 1180, 768, 390, 360]) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 900 });
    assert.equal(await page.locator("#overviewDashboard").isVisible(), true);
    assert.equal(await page.locator("#growthChart").isVisible(), false, "chart chi tiết không hiện ở Overview");
    assert.equal(await page.locator("#needCarePanel").isVisible(), false, "full care list không hiện ở Overview");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `Overview không tràn ngang tại ${width}px`);
    const columns = await page.locator("#executiveGrid").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    if (width <= 760) assert.equal(columns, 1, `Summary phải một cột tại ${width}px`);
  }
  assert.equal(await page.locator('.overview-summary-card[data-overview-route="#/reports"]').count(), 0, "Sale fixture không có Reports shortcut");
  assert.equal(await page.locator('.overview-summary-card[data-overview-route="#/customers/allocation"]').count(), 0, "Sale fixture không có Allocation shortcut");
  assert.match(await page.locator("#executiveGrid").textContent(), /Chưa có kỳ đang hoạt động/);
  assert.doesNotMatch(await page.locator("#executiveGrid").textContent(), /0%|NaN|undefined/);

  await page.evaluate(() => {
    overviewDashboard.classList.add("hide"); reportsPanel.classList.remove("hide");
    document.querySelector(".chart-grid").classList.remove("hide"); pipelinePanel.classList.remove("hide");
  });
  assert.equal(await page.locator("#growthChart").isVisible(), true);
  assert.equal(await page.locator("#channelReportChart").isVisible(), true);
  assert.equal(await page.locator("#pipelinePanel").isVisible(), true);

  console.log("PASS CRM-UI-R1 STEP4 browser fixture: roles/zero-state/responsive/report relocation");
} finally { await browser.close(); }
