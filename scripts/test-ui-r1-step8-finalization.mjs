import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CRM_NAV_ITEMS, CUSTOMER_WORKSPACES, KPI_WORKSPACES, REPORT_WORKSPACES, CRM_HASH_ROUTES, workspaceForHash } from "../js/components/app-shell.js";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const css = await readFile(new URL("css/styles.css", root), "utf8");
const app = await readFile(new URL("js/features/crm-app.js", root), "utf8");
const shell = await readFile(new URL("js/components/app-shell.js", root), "utf8");
const adapter = await readFile(new URL("js/firebase.js", root), "utf8");
const ignore = await readFile(new URL(".vercelignore", root), "utf8");

assert.deepEqual(CRM_NAV_ITEMS.map(x=>x.id), ["overview","customers","kpi","products","reports","admin"]);
assert.doesNotMatch(html+css+shell+app, /viewTabsSlot|legacy-view-tabs|crmViewBtn|customersViewBtn|kpiViewBtn|productsViewBtn|reportsViewBtn|adminViewBtn/);
assert.doesNotMatch(html+css+app, /legacy-kpi-mode-tabs|data-kpi-team-mode|kpiTeamEmployeesModeBtn|setKpiTeamMode/);
assert.doesNotMatch(html+app, /careSettingsPanel|dropdownSettingsPanel|userAdminPanel|auditPanel|saveCareSettings|saveDropdownSettings|renderAuditTrail/);

const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);
const duplicates=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
assert.deepEqual(duplicates, [], `DOM ID trùng: ${duplicates.join(", ")}`);
for(const id of ["channelReportChart","growthChart"]) assert.equal((html.match(new RegExp(`id="${id}"`,"g"))||[]).length,1);

const expectedHashes=["#/overview",...CUSTOMER_WORKSPACES.map(x=>x.hash),...KPI_WORKSPACES.map(x=>x.hash),"#/products",...REPORT_WORKSPACES.map(x=>x.hash)];
assert.deepEqual([...new Set(Object.keys(CRM_HASH_ROUTES))].sort(),[...new Set(expectedHashes)].sort());
for(const hash of Object.keys(CRM_HASH_ROUTES)) assert.equal(workspaceForHash(hash).hash,hash);
assert.equal(workspaceForHash("#/invalid").hash,"#/overview");
assert.equal(CRM_HASH_ROUTES["#/customers/allocation"].capability,"manager");
for(const hash of ["#/kpi/team","#/kpi/library","#/kpi/history", "#/reports","#/reports/summary","#/reports/sales","#/reports/customers"]) assert.equal(CRM_HASH_ROUTES[hash].capability,"manager");
assert.match(app,/const canAccessAdminPanel = \(\) => isOwner\(\) \|\| isAdmin\(\)/);
assert.match(app,/item\?\.capability === "sale" && isSale\(\)/);
assert.match(app,/item\?\.capability === "manager" && isManager\(\)/);

for(const panel of CUSTOMER_WORKSPACES) assert.match(html,new RegExp(`id="${panel.panelId}"[^>]*(?:inert[^>]*aria-hidden="true"|aria-hidden="true"[^>]*inert)`));
assert.match(app,/setViewHidden\("appView"/);
assert.match(app,/toggleAttribute\("inert", !open\)/);
assert.match(app,/restoreOverlayFocus/);
assert.match(app,/event\.key === "Escape"[\s\S]*?closeDetailModal[\s\S]*?closeProductDrawer[\s\S]*?closeKpiTeamAssign[\s\S]*?closeKpiTeamEmployee[\s\S]*?closeDrawer[\s\S]*?setMobileNavigationOpen/);
assert.match(html,/id="drawer"[^>]*role="dialog"[^>]*aria-modal="true"/);
assert.match(css,/\.crm-sidebar\{[^}]*overflow-y:auto/);
assert.match(css,/\.drawer-backdrop\{[^}]*z-index:20/);
assert.match(css,/\.drawer\{[^}]*z-index:21/);
assert.match(css,/\.saving-mask\{[^}]*z-index:31/);
assert.match(html,/href="\/css\/styles\.css"/);
assert.match(html,/src="\/js\//);
assert.doesNotMatch(html,/DELETE\s+app_users|Xóa vĩnh viễn[^<]*nhân viên/i);
assert.match(app,/if \(!Object\.keys\(patch\)\.length\) return/);
assert.match(adapter,/const merged = \{ \.\.\.oldData, \.\.\.oldRaw/);
assert.match(ignore,/\.codex\*/);
assert.match(ignore,/\.env\*/);
const topbar=html.slice(html.indexOf('<header class="topbar">'),html.indexOf('</header>',html.indexOf('<header class="topbar">')));
assert.doesNotMatch(topbar,/seedBtn|syncPhoneBtn|syncOwnerBtn|importBtn/);
const danger=html.slice(html.indexOf('id="adminDangerTools"'),html.indexOf('</div>',html.indexOf('id="adminDangerTools"')));
for(const id of ["seedBtn","syncPhoneBtn","syncOwnerBtn","importBtn","importFile"]) assert.match(danger,new RegExp(`id="${id}"`));

console.log("PASS CRM-UI-R1 STEP8 finalization contracts: navigation, legacy retirement, roles, hidden DOM, layers và safety");
