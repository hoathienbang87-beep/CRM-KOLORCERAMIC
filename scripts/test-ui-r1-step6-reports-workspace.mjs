import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { REPORT_WORKSPACES, CRM_HASH_ROUTES, workspaceForHash } from "../js/components/app-shell.js";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const app = await readFile(new URL("js/features/crm-app.js", root), "utf8");

assert.deepEqual(REPORT_WORKSPACES.map(item => item.hash), ["#/reports", "#/reports/summary", "#/reports/sales", "#/reports/customers"]);
for (const workspace of REPORT_WORKSPACES) {
  assert.equal(workspace.capability, "manager");
  assert.equal(CRM_HASH_ROUTES[workspace.hash].navId, "reports");
  assert.equal(workspaceForHash(workspace.hash).reportWorkspace, workspace.reportWorkspace);
  assert.equal((html.match(new RegExp(`id="${workspace.panelId}"`, "g")) || []).length, 1);
}
assert.match(html, /id="reportsHubPanel"[\s\S]*?id="reportsHubCards"/);
assert.match(app, /Tổng hợp quản trị[\s\S]*?#\/reports\/summary/);
assert.match(app, /Hoạt động Sale[\s\S]*?#\/reports\/sales/);
assert.match(app, /Khách hàng & kênh[\s\S]*?#\/reports\/customers/);
assert.match(app, /REPORT_WORKSPACES\.forEach\(workspace =>[\s\S]*?toggleAttribute\("inert", !visible\)[\s\S]*?aria-hidden/);
assert.match(app, /if \(activeReportWorkspace === "summary"\) renderReportCenter\(\)/);
assert.match(app, /if \(activeReportWorkspace === "sales"\) renderSaleActivityReport\(\)/);
assert.match(app, /if \(activeReportWorkspace === "customers"\) renderPipelineReport\(\)/);
assert.match(app, /item\.mainView === "reports"|canUseNavItem\(item\)/);
assert.equal((html.match(/id="pipelinePanel"/g) || []).length, 1);
assert.match(html.slice(html.indexOf('id="reportCustomersPanel"'), html.indexOf('id="productsPanel"')), /id="pipelinePanel"/);
assert.equal((html.match(/id="growthChart"/g) || []).length, 1);
assert.equal((html.match(/id="channelReportChart"/g) || []).length, 1);
const overview = html.slice(html.indexOf('id="overviewDashboard"'), html.indexOf('id="reportsPanel"'));
assert.match(overview, /id="channelReportChart"[\s\S]*?id="growthChart"/);
const reports = html.slice(html.indexOf('id="reportsPanel"'), html.indexOf('id="productsPanel"'));
assert.doesNotMatch(reports, /id="growthChart"|id="channelReportChart"|userAdminPanel|dropdownSettingsPanel|auditPanel|kpiTeamPanel/);
assert.match(reports, /id="reportSalesPanel"[\s\S]*?id="reportActivityOwner"[\s\S]*?id="saleActivityPager"/);
assert.match(reports, /id="reportExportManagementBtn"/);
assert.match(reports, /id="reportExportActivityBtn"/);
console.log("PASS CRM-UI-R1 STEP6 reports workspace contracts");
