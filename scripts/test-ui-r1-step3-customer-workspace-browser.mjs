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
  const shellSource = fs.readFileSync("js/components/app-shell.js", "utf8")
    .replaceAll("export function", "function").replaceAll("export const", "const");
  await page.addScriptTag({ content: `${shellSource};renderAppShell();window.__customerWorkspaces=CUSTOMER_WORKSPACES;window.__route=workspaceForHash;` });
  await page.evaluate(() => {
    loginView.classList.add("hide"); maintenanceView.classList.add("hide"); appView.classList.remove("hide"); appView.removeAttribute("inert");
    window.showCustomerRoute = (hash, manager = true) => {
      let route = window.__route(hash);
      if (route.capability === "manager" && !manager) route = window.__route("#/customers");
      window.__customerWorkspaces.forEach(workspace => {
        const panel = document.getElementById(workspace.panelId);
        const hidden = workspace.customerWorkspace !== route.customerWorkspace;
        panel.classList.toggle("hide", hidden); panel.toggleAttribute("inert", hidden); panel.setAttribute("aria-hidden", String(hidden));
      });
      document.querySelectorAll('[data-workspace-nav="customers"]').forEach(button => button.classList.toggle("active", route.mainView === "customers"));
      document.querySelector('[data-customer-workspace="#/customers/allocation"]').classList.toggle("hide", !manager);
      location.hash = route.hash;
      return route;
    };
  });

  for (const width of [1440, 1366, 1180, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => showCustomerRoute("#/customers", true));
    const columns = await page.locator(".customer-action-grid").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    assert.equal(columns, width <= 760 ? 1 : 2, `Customer Hub columns tại ${width}px`);
    assert.equal(await page.locator(".layout>aside.panel").count(), 0);
  }

  await page.evaluate(() => showCustomerRoute("#/customers/new", true));
  await page.locator("#name").fill("DRAFT STEP3");
  await page.evaluate(() => showCustomerRoute("#/customers/list", true));
  assert.equal(await page.locator("#customerNewPanel").getAttribute("inert"), "");
  assert.equal(await page.locator("#customerNewPanel").getAttribute("aria-hidden"), "true");
  await page.evaluate(() => showCustomerRoute("#/customers/new", true));
  assert.equal(await page.locator("#name").inputValue(), "DRAFT STEP3", "draft phải còn trong cùng session");
  assert.equal(await page.locator("#name").count(), 1, "form không được trùng");

  const saleRoute = await page.evaluate(() => showCustomerRoute("#/customers/allocation", false));
  assert.equal(saleRoute.hash, "#/customers");
  assert.equal(await page.locator('[data-customer-workspace="#/customers/allocation"]:visible').count(), 0);
  assert.equal(await page.locator('[data-workspace-nav="customers"].active').count(), 2, "desktop/mobile Customer nav đều active");
  const invalid = await page.evaluate(() => showCustomerRoute("#/customers/foo", true));
  assert.equal(invalid.hash, "#/customers");

  console.log("PASS CRM-UI-R1 STEP3 browser fixture: desktop/mobile/routes/draft/accessibility");
} finally {
  await browser.close();
}
