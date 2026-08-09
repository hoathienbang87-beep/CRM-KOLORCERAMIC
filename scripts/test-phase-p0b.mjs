import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const sql = fs.readFileSync(path.join(root, "supabase-phase-p0b-employee-assignment.sql"), "utf8");
const app = fs.readFileSync(path.join(root, "js", "features", "crm-app.js"), "utf8");
const adapter = fs.readFileSync(path.join(root, "js", "firebase.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const failures = [];
let checks = 0;

function check(condition, message) {
  checks++;
  if (!condition) failures.push(message);
}

function latestFunction(name) {
  const marker = `create or replace function public.${name}`;
  const start = sql.toLowerCase().lastIndexOf(marker.toLowerCase());
  if (start < 0) return "";
  const next = sql.toLowerCase().indexOf("create or replace function public.", start + marker.length);
  return sql.slice(start, next < 0 ? sql.length : next);
}

check(/^begin;/im.test(sql) && /^commit;/im.test(sql), "Migration must be transactional.");
check(/create table if not exists public\.customer_assignments/i.test(sql), "customer_assignments table missing.");
check(/customer_assignments_one_current_idx[\s\S]*?where is_current/i.test(sql), "Unique current assignment index missing.");
check(/employee_email_snapshot/i.test(sql) && /employee_name_snapshot/i.test(sql), "Legacy employee snapshots missing.");
check(/lifecycle_status[\s\S]*?active[\s\S]*?inactive[\s\S]*?archived/i.test(sql), "Employee lifecycle states missing.");
check(!/CRM_UNASSIGNED|holding user|fake employee/i.test(sql), "Migration must not create a fake unassigned employee.");
check(/legacy owner is not present in app_users/i.test(sql), "Unknown legacy owner remediation missing.");
check(/owner_user_id = null[\s\S]*?owner_email = null/i.test(sql), "Unassigned owner cache cleanup missing.");
check(/revoke insert, update, delete on public\.customer_assignments from authenticated/i.test(sql), "Direct assignment writes must be revoked.");
check(/revoke insert on public\.customers from authenticated/i.test(sql), "Direct customer inserts must be RPC-only.");
check(/on delete restrict/i.test(sql), "Employee/customer history FKs must prevent hard delete.");

const requiredRpcs = [
  "crm_assign_customer",
  "crm_bulk_assign_customers",
  "crm_unassign_customer",
  "crm_deactivate_employee",
  "crm_reactivate_employee",
  "crm_archive_employee",
  "crm_create_employee",
  "crm_update_employee_profile"
];
for (const rpc of requiredRpcs) {
  const body = latestFunction(rpc);
  check(Boolean(body), `Missing ${rpc}.`);
  check(/security definer/i.test(body), `${rpc} must use SECURITY DEFINER.`);
  check(/set search_path = public/i.test(body), `${rpc} must lock search_path.`);
  check(new RegExp(`revoke all on function public\\.${rpc}\\([\\s\\S]*?from public, anon`, "i").test(sql), `${rpc} must revoke anon/public.`);
  check(new RegExp(`grant execute on function public\\.${rpc}\\([\\s\\S]*?to authenticated`, "i").test(sql), `${rpc} must grant authenticated only.`);
}

const access = latestFunction("crm_can_access_customer_id");
check(/customer_assignments/i.test(access) && /is_current/i.test(access), "RLS access must use current assignment.");
check(!/created_by/i.test(access), "created_by must never grant customer access.");

const assign = latestFunction("crm_assign_customer");
check(/for update/i.test(assign), "Assign RPC must lock customer/current assignment.");
check(/lifecycle_status[\s\S]*?active/i.test(assign), "Assign RPC must validate ACTIVE employee.");
check(/crm_write_audit\('assignCustomer'/i.test(assign), "Assign RPC audit missing.");

const deactivate = latestFunction("crm_deactivate_employee");
check(/'unassigned', 'transfer'/i.test(deactivate), "Deactivate modes missing.");
check(/next_care_date is not null/i.test(deactivate), "Open follow-up accounting missing.");
check(/crm_unassign_customer/i.test(deactivate) && /crm_assign_customer/i.test(deactivate), "Deactivate customer handling missing.");
check(!/delete from public\.app_users/i.test(sql), "Employee hard delete must not exist.");

check(/customerAssignments:\s*"customer_assignments"/.test(adapter), "Adapter table mapping missing.");
check(/case "customerAssignments"/.test(adapter), "Adapter assignment row mapping missing.");
check(/lifecycle_status/.test(adapter), "Adapter lifecycle mapping missing.");
check(!/ownerMatchesCurrentUser\s*=\s*[^;]*createdByEmail/.test(app), "Frontend ownership still trusts createdByEmail.");
check(/crm_bulk_assign_customers/.test(app), "Frontend bulk assignment RPC missing.");
check(/crm_deactivate_employee/.test(app), "Frontend deactivate RPC missing.");
check(/crm_archive_employee/.test(app), "Frontend archive RPC missing.");
check(/quickUnassignedCard/.test(html) && /unassignedPoolPanel/.test(html), "Unassigned pool UI missing.");
check(/function customerAcquisitionOwnerKeys\(customer\)/.test(app), "Customer acquisition attribution helper missing.");
check(/function customerWasAcquiredBy\(customer, ownerKey\)/.test(app), "Historical customer acquisition matcher missing.");
check(/const acquired = customers\.filter\(c => canSeeCustomer\(c\) && customerWasAcquiredBy\(c, o\)\)/.test(app), "KPI new-customer metric still follows current owner instead of acquisition owner.");

const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
check(duplicateIds.length === 0, `Duplicate HTML IDs: ${duplicateIds.join(", ")}`);

if (failures.length) {
  console.error("Phase P0-B static contract: FAIL");
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}

console.log(`Phase P0-B static contract: PASS (${checks} checks)`);
