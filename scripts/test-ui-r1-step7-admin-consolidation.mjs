import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const app = await readFile(new URL("js/features/crm-app.js", root), "utf8");
const adapter = await readFile(new URL("js/firebase.js", root), "utf8");

const routes = ["/admin", "/admin/users", "/admin/categories", "/admin/settings", "/admin/health", "/admin/audit-logs"];
for (const route of routes) assert.match(app, new RegExp(`"${route.replaceAll("/", "\\/")}"\\s*:`), `Thiếu route ${route}`);
assert.match(app, /return adminRoutes\[path\] \? path : "\/admin"/);
assert.match(app, /const canAccessAdminPanel = \(\) => isOwner\(\) \|\| isAdmin\(\)/);
assert.match(app, /if \(isAdminRoute\(\)\) \{[\s\S]*?if \(!canAccessAdminPanel\(\)\)[\s\S]*?replaceState\(\{\}, "", "\/"\)[\s\S]*?return;/);
assert.match(html, /id="adminHubCards"/);
for (const key of ["dashboard", "users", "categories", "settings", "health", "audit-logs"]) assert.match(html, new RegExp(`data-admin-page="${key}"`));
assert.match(app, /function consolidateAdminDom\(\)/);
assert.doesNotMatch(html, /careSettingsPanel|dropdownSettingsPanel|userAdminPanel|auditPanel/);
assert.doesNotMatch(app, /saveCareSettings|saveDropdownSettings|renderAuditTrail/);
for (const id of ["seedBtn", "syncPhoneBtn", "syncOwnerBtn", "importBtn", "importFile"]) {
  assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `${id} phải có đúng một control`);
  assert.match(app, new RegExp(`"${id}"`));
}
assert.match(app, /dangerHost\.append\(control\)/);
assert.match(app, /healthHost\.append\(panel\)/);
assert.match(app, /adminTrashHost[\s\S]*?append\(trashPanel\)/);
assert.doesNotMatch(html, /DELETE\s+app_users|Xóa vĩnh viễn[^<]*nhân viên/i);
assert.match(app, /crm_deactivate_employee/);
assert.match(app, /crm_archive_employee/);
assert.match(app, /Không thể[^\n]*(Owner|owner)|officialOwner|isProtectedOwner/i);
assert.match(adapter, /const merged = \{ \.\.\.oldData, \.\.\.oldRaw, \.\.\.\(row\.data \|\| \{\}\), \.\.\.\(row\.raw_data \|\| \{\}\) \}/);
assert.match(adapter, /row\.data = merged;[\s\S]*?row\.raw_data = merged/);
assert.match(app, /if \(!Object\.keys\(patch\)\.length\) return/);
assert.match(app, /saveSettingsAndVerify[\s\S]*?getDoc/);
assert.match(html, /href="\/css\/styles\.css"/);
assert.match(html, /src="\/js\//);
assert.match(app, /renderAdminAuditPage\(\)/);
assert.doesNotMatch(html.slice(html.indexOf('id="adminAuditPage"'), html.indexOf('id="adminTrashHost"')), /data-(delete|edit|mutate)-audit|Xóa audit/i);
assert.match(app, /cleanupDataBtn[\s\S]*?cleanupData/);
assert.match(app, /confirm\(/);
assert.doesNotMatch(app, /consolidateAdminDom\(\)[\s\S]{0,400}(seedSettings|cleanupData|syncPhoneIndex)\(/);

console.log("PASS CRM-UI-R1 STEP7 Admin contracts: route, role, parity, settings và danger isolation");
