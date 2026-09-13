import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync("js/features/crm-app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("css/styles.css", "utf8");
const lifecycle = app.slice(app.indexOf("const drawerCustomerById"), app.indexOf("async function permanentlyDeleteCustomer"));
let checks = 0;
const check = (condition, message) => { checks += 1; assert.ok(condition, message); };

check(html.includes('id="customerLifecycleSection"'), "Customer Detail drawer contains the lifecycle section.");
check(html.includes('id="unassignCustomerBtn"') && html.includes("Gỡ phân công"), "Unassign action is present.");
check(html.includes('id="archiveCustomerBtn"') && html.includes("Lưu trữ khách hàng"), "Archive action is presented as soft lifecycle storage.");
check(html.includes('id="restoreCustomerBtn"'), "Restore action is available in the lifecycle surface.");
check(/const visible = !!c && isManager\(\)/.test(lifecycle), "Lifecycle visibility reuses the manager capability helper.");
check(/restoreButton\.classList\.toggle\("hide", !archived \|\| !canAccessAdminPanel\(\)\)/.test(lifecycle), "Restore visibility follows the existing Owner/Admin capability.");
check(/if \(currentCustomerAssignment\(c\.id\)\) return notice\("Cần Gỡ phân công/.test(lifecycle), "Archive refuses an assigned Customer in the UI handler.");
check(/archiveButton\.disabled = !!assignment/.test(lifecycle), "Archive is visibly disabled while a current assignment exists.");
check(/crm_unassign_customer[\s\S]*p_customer_id: c\.id, p_reason: reason/.test(lifecycle), "Unassign uses canonical crm_unassign_customer with a user reason.");
check(/crm_set_customer_archived[\s\S]*p_archived: true/.test(lifecycle), "Archive uses canonical crm_set_customer_archived(true).");
check(/crm_set_customer_archived[\s\S]*p_archived: false/.test(lifecycle), "Restore uses canonical crm_set_customer_archived(false).");
check(/customerUnassignReason/.test(lifecycle) && !/TEST_FIXTURE_CLEANUP/.test(lifecycle), "General UI requires a reason and does not hardcode the TEST cleanup reason.");
check(/openDetailModal\([\s\S]*Gỡ phân công khách hàng/.test(lifecycle) && /openDetailModal\([\s\S]*Lưu trữ khách hàng/.test(lifecycle), "Lifecycle confirmations reuse the application modal.");
check(!/\bconfirm\s*\(/.test(lifecycle), "Lifecycle controls do not use browser-native confirm.");
check(/crm_update_customer_profile/.test(app) && /p_changes: profileChanges/.test(app), "Profile rename continues through canonical crm_update_customer_profile.");
check(/patchCustomerLifecycleState\(c\.id,[\s\S]*renderAll\(\)/.test(lifecycle), "Successful lifecycle actions refresh local Customer/list state while realtime catches up.");
check(/customers\.find\([\s\S]*deletedCustomers\.find\([\s\S]*openDrawer\(customer\.id,"care",\{inPlace:true\}\)/.test(app), "Manager KPI Event can open active or archived current Customer in place.");
check(!/kpi_submission_events|customer_name_snapshot|event_snapshot\s*=/.test(lifecycle), "Lifecycle implementation never mutates KPI Event snapshots.");
check(/data-open-archived-customer/.test(app) && /function renderTrash\(\)[\s\S]*canAccessAdminPanel\(\)/.test(app), "Owner can open an archived Customer from the existing trash surface.");
check(/customer-lifecycle-actions button\{width:100%;min-height:44px\}/.test(css), "Mobile lifecycle actions have full-width 44px controls.");
check(/\.customer-lifecycle-summary/.test(css) && /\.customer-lifecycle-confirm/.test(css), "Lifecycle summary and confirmation styles are present.");

console.log(`Phase 6G Customer lifecycle static: ${checks} checks PASS`);
