import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const shellSource = await readFile(new URL("js/components/app-shell.js", root), "utf8");
const appSource = await readFile(new URL("js/features/crm-app.js", root), "utf8");
const html = await readFile(new URL("index.html", root), "utf8");
const css = await readFile(new URL("css/styles.css", root), "utf8");
const shell = await import(`data:text/javascript;base64,${Buffer.from(shellSource).toString("base64")}`);

assert.deepEqual(
  shell.CRM_NAV_ITEMS.map(item => item.id),
  ["overview", "customers", "kpi", "products", "reports", "admin"],
  "Thứ tự Sidebar phải theo IA đã duyệt"
);
assert.equal(shell.normalizeWorkspaceHash(""), "#/overview");
assert.equal(shell.normalizeWorkspaceHash("#/kpi/"), "#/kpi");
assert.equal(shell.workspaceForHash("#/unknown").id, "overview");
assert.equal(shell.CRM_HASH_ROUTES["#/reports"].mainView, "reports");
assert.equal(shell.CRM_NAV_ITEMS.find(item => item.id === "admin").path, "/admin");

assert.match(shellSource, /desktopNavItems/);
assert.match(shellSource, /mobileNavItems/);
assert.equal((shellSource.match(/CRM_NAV_ITEMS\.map/g) || []).length, 1, "Desktop/mobile phải render từ cùng model");
assert.match(html, /id="viewTabsSlot" class="legacy-view-tabs" hidden aria-hidden="true"/);
assert.match(css, /\.legacy-view-tabs\{display:none!important;pointer-events:none!important\}/);
for (const id of ["crmViewBtn", "customersViewBtn", "kpiViewBtn", "productsViewBtn", "reportsViewBtn", "adminViewBtn"]) {
  assert.match(shellSource, new RegExp(`id="${id}"[^>]*tabindex="-1"[^>]*aria-hidden="true"`), `${id} phải không tương tác`);
}
for (const id of ["name", "saveCustomerBtn", "customerSearchPanel", "drawer", "productDrawer", "kpiTeamPanel", "kpi2OperationsPanel", "reportsPanel"]) {
  assert.match(html, new RegExp(`id="${id}"`), `Không được xóa business DOM #${id}`);
}
assert.match(appSource, /function navigateToWorkspace/);
assert.match(appSource, /CRM_HASH_ROUTES\[normalized\]/, "Hash chỉ được resolve qua whitelist");
assert.match(appSource, /window\.addEventListener\("hashchange", scheduleRouteResolution\)/);
assert.match(appSource, /aria-current/);
assert.match(appSource, /canAccessAdminPanel\(\)/);
assert.match(css, /grid-template-columns:240px minmax\(0,1fr\)/);
assert.match(css, /@media\(max-width:760px\)[\s\S]*\.crm-sidebar\{display:none\}/);

console.log("PASS CRM-UI-R1 STEP2 navigation contracts");
