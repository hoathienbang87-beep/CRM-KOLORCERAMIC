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
    const scopedCustomers = [
      { id:"a", name:"Customer A", channel:"Facebook", allowed:true },
      { id:"b", name:"Customer B", channel:"facebook", allowed:true },
      { id:"c", name:"Customer C", channel:"Zalo", allowed:true },
      { id:"d", name:"Unauthorized D", channel:"Facebook", allowed:false }
    ];
    const labels = ["Facebook", "Zalo", "Khác"];
    const canonical = value => labels.find(label => label.toLowerCase() === String(value || "").toLowerCase()) || "Khác";
    const rowsByLabel = Object.fromEntries(labels.map(label => [label, []]));
    scopedCustomers.filter(row => row.allowed).forEach(row => rowsByLabel[canonical(row.channel)].push(row));
    window.fixtureRows = rowsByLabel;
    window.fixtureAreas = [
      { label:"Facebook", x:20, y:20, w:180, h:50 },
      { label:"Zalo", x:20, y:90, w:100, h:50 }
    ];
    const canvas = channelReportChart;
    canvas.width = 400; canvas.height = 180;
    canvas.addEventListener("click", event => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      const area = window.fixtureAreas.find(item => x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h);
      if (!area) return;
      const rows = rowsByLabel[area.label];
      detailModalTitle.textContent = `Khách hàng theo kênh: ${area.label}`;
      detailModalSubtitle.textContent = `${rows.length} khách hàng`;
      detailModalContent.innerHTML = rows.map(row => `<button data-customer="${row.id}">${row.name}</button>`).join("");
      detailModalBackdrop.classList.remove("hide"); detailModal.classList.remove("hide");
    });
    const close = () => { detailModalBackdrop.classList.add("hide"); detailModal.classList.add("hide"); };
    closeDetailModalBtn.addEventListener("click", close); detailModalBackdrop.addEventListener("click", close);
    document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
  });

  for (const width of [1440, 1366, 1180, 390, 360]) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 900 });
    assert.equal(await page.locator("#growthChart").isVisible(), true);
    assert.equal(await page.locator("#channelReportChart").isVisible(), true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `Không được tràn ngang tại ${width}px`);
    if (width <= 390) assert.equal(await page.locator(".chart-grid").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length), 1);
  }
  const canvas = page.locator("#channelReportChart");
  const clickCanvas = (x, y) => canvas.evaluate((element, point) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent("click", { bubbles:true, clientX:rect.left + point.x, clientY:rect.top + point.y }));
  }, { x, y });
  await clickCanvas(60, 40);
  assert.equal(await page.locator("#detailModalTitle").textContent(), "Khách hàng theo kênh: Facebook");
  assert.deepEqual(await page.locator("#detailModalContent button").allTextContents(), ["Customer A", "Customer B"]);
  assert.doesNotMatch(await page.locator("#detailModalContent").textContent(), /Customer C|Unauthorized D/);
  await page.locator("#closeDetailModalBtn").click();
  assert.equal(await page.locator("#detailModal").isVisible(), false);
  await clickCanvas(60, 110);
  assert.equal(await page.locator("#detailModalTitle").textContent(), "Khách hàng theo kênh: Zalo");
  assert.deepEqual(await page.locator("#detailModalContent button").allTextContents(), ["Customer C"]);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#detailModal").isVisible(), false);
  await clickCanvas(350, 165);
  assert.equal(await page.locator("#detailModal").isVisible(), false, "Click khoảng trắng không được mở modal");
  console.log("PASS CRM-UI-R1 STEP5.1 browser fixture: responsive, hit-test, modal và Sale scope");
} finally { await browser.close(); }
