import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const shellSource = await readFile(new URL("js/components/app-shell.js", root), "utf8");
const appSource = await readFile(new URL("js/features/crm-app.js", root), "utf8");
const html = await readFile(new URL("index.html", root), "utf8");
const css = await readFile(new URL("css/styles.css", root), "utf8");
const shell = await import(`data:text/javascript;base64,${Buffer.from(shellSource).toString("base64")}`);

const routes = ["#/customers", "#/customers/new", "#/customers/list", "#/customers/care", "#/customers/allocation"];
assert.deepEqual(shell.CUSTOMER_WORKSPACES.map(item => item.hash), routes);
assert.deepEqual(shell.CUSTOMER_WORKSPACES.map(item => item.customerWorkspace), ["hub", "new", "list", "care", "allocation"]);
assert.equal(shell.CRM_HASH_ROUTES["#/customers/allocation"].capability, "manager");
assert.equal(shell.workspaceForHash("#/customers/foo").hash, "#/customers");
assert.equal(shell.workspaceForHash("#/customers///").hash, "#/customers");
assert.equal(shell.workspaceForHash("malformed").hash, "#/overview");
for (const route of routes) assert.equal(shell.workspaceForHash(route).navId, "customers");

for (const id of ["customerHubPanel", "customerNewPanel", "customerSearchPanel", "needCarePanel", "customerAllocationPanel"]) {
  assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `#${id} phải duy nhất`);
}
for (const id of ["name", "phone", "address", "channel", "customerType", "potentialLevel", "owner", "partnerFields", "need", "note", "saveCustomerBtn", "clearBtn"]) {
  assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `Form contract #${id} phải được giữ nguyên và không trùng`);
}
assert.doesNotMatch(html, /<aside class="panel">\s*<h2>Thêm khách mới/);
assert.match(html, /id="customerNewPanel"[^>]*\bhide\b[^>]*\binert\b[^>]*aria-hidden="true"/);
assert.match(html, /id="customerAllocationPanel"[^>]*\bhide\b[^>]*\binert\b[^>]*aria-hidden="true"/);
assert.match(html, /data-customer-workspace="#\/customers\/new"/);
assert.match(html, /data-customer-workspace="#\/customers\/list"/);
assert.match(html, /data-customer-workspace="#\/customers\/care"/);
assert.match(html, /class="customer-action-card manager-only" data-customer-workspace="#\/customers\/allocation"/);
assert.match(appSource, /workspaceForHash\(normalized\)/);
assert.match(appSource, /return CRM_HASH_ROUTES\["#\/customers"\]/, "Route Customer bị từ chối phải về Hub");
assert.match(appSource, /toggleAttribute\("inert", hidden\)/);
assert.match(appSource, /activeCustomerWorkspace = workspace\.customerWorkspace \|\| "hub"/);
assert.match(appSource, /\(item\?\.navId \|\| item\?\.id\) === config\?\.id/);
assert.match(appSource, /activeMainView === "customers" && activeCustomerWorkspace === "allocation"/);
assert.doesNotMatch(css, /\.layout\s*>\s*aside\.panel/);
assert.match(css, /\.layout\{display:block;padding:18px\}/);
assert.match(css, /@media\(max-width:760px\)[\s\S]*\.customer-action-grid\{grid-template-columns:1fr\}/);
assert.match(css, /\.customer-form-workspace\{max-width:880px\}/);

console.log("PASS CRM-UI-R1 STEP3 customer workspace contracts");
