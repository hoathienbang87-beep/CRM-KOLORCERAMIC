import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const app = await readFile(new URL("js/features/crm-app.js", root), "utf8");
const css = await readFile(new URL("css/styles.css", root), "utf8");
const shell = await import(`data:text/javascript;base64,${Buffer.from(await readFile(new URL("js/components/app-shell.js", root), "utf8")).toString("base64")}`);

assert.match(html, /id="overviewDashboard"[\s\S]*?<h1>Tổng quan<\/h1>/);
assert.match(html, /id="executiveGrid" class="overview-summary-grid"/);
assert.match(html, /id="overviewAttentionPanel"[\s\S]*?Việc cần chú ý hôm nay/);
assert.equal((html.match(/id="todayCarePanel"/g) || []).length, 1);
assert.equal((html.match(/id="growthChart"/g) || []).length, 1);
assert.equal((html.match(/id="channelReportChart"/g) || []).length, 1);
assert.equal((html.match(/id="pipelinePanel"/g) || []).length, 1);
const overviewStart = html.indexOf('id="overviewDashboard"');
const reportsStart = html.indexOf('id="reportsPanel"');
const productsStart = html.indexOf('id="productsPanel"');
for (const id of ["growthChart", "channelReportChart"]) {
  const offset = html.indexOf(`id="${id}"`);
  assert.ok(offset > overviewStart && offset < reportsStart, `${id} phải nằm trong Overview`);
}
assert.ok(html.indexOf('id="pipelinePanel"') > reportsStart && html.indexOf('id="pipelinePanel"') < productsStart, "pipelinePanel phải nằm trong Reports");
assert.ok(html.indexOf('id="needCarePanel"') > productsStart, "Full Care panel không được nằm trong Overview");
assert.doesNotMatch(html.slice(overviewStart, reportsStart), /id="careWorkSummary"|id="needCareList"/);
assert.doesNotMatch(html.slice(overviewStart, reportsStart), /id="userAdminPanel"|id="dropdownSettingsPanel"|id="auditPanel"/);
assert.doesNotMatch(html, /<aside class="panel">\s*<h2>Thêm khách mới/);

assert.match(app, /const activePeriod = kpiPeriods\.find\(period => clean\(period\.status\)\.toUpperCase\(\) === "ACTIVE"\)/);
assert.match(app, /"Chưa có kỳ đang hoạt động"/);
assert.doesNotMatch(app.match(/function renderExecutiveDashboard\(\)[\s\S]*?\n}\n/)[0], /0%/);
assert.match(app, /isSale\(\) \? "Khách hàng của tôi" : "Khách hàng trong phạm vi"/);
assert.match(app, /if \(isManager\(\)\) cards\.splice[\s\S]*?#\/customers\/allocation/);
assert.match(app, /if \(isManager\(\)\) cards\.push\(\["Báo cáo"[\s\S]*?#\/reports/);
assert.match(app, /if \(overviewRoute\) navigateToWorkspace\(overviewRoute\)/);
for (const route of ["#/customers/list", "#/customers/care", "#/customers/allocation", "#/kpi", "#/reports"]) {
  assert.ok(shell.CRM_HASH_ROUTES[route], `${route} phải là canonical whitelist route`);
}
assert.match(app.match(/function renderCrmView\(\)[\s\S]*?\n}\n/)[0], /requestChartRender\(\)/);
assert.doesNotMatch(app.match(/if \(isReportsView\) \{[\s\S]*?\n  }/)[0], /requestChartRender\(\)/);
assert.match(css, /\.overview-summary-grid\{display:grid/);
assert.match(css, /@media\(max-width:760px\)[\s\S]*\.overview-summary-grid[\s\S]*grid-template-columns:1fr/);

console.log("PASS CRM-UI-R1 STEP4 overview contracts");
