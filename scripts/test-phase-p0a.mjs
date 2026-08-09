import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const sqlPath = path.join(root, "supabase-phase-p0a-transaction-ownership.sql");
const p0bSqlPath = path.join(root, "supabase-phase-p0b-employee-assignment.sql");
const appPath = path.join(root, "js", "features", "crm-app.js");
const adapterPath = path.join(root, "js", "firebase.js");
const htmlPath = path.join(root, "index.html");
const settingsSqlPath = path.join(root, "supabase-phase-8-settings-persistence.sql");
const sql = fs.readFileSync(sqlPath, "utf8");
const p0bSql = fs.readFileSync(p0bSqlPath, "utf8");
const migrationSql = `${sql}\n${p0bSql}`;
const app = fs.readFileSync(appPath, "utf8");
const adapter = fs.readFileSync(adapterPath, "utf8");
const html = fs.readFileSync(htmlPath, "utf8");
const settingsSql = fs.readFileSync(settingsSqlPath, "utf8");
const failures = [];
let checksRun = 0;

function check(condition, message) {
  checksRun++;
  if (!condition) failures.push(message);
}

function functionBody(name) {
  const marker = `create or replace function public.${name}`;
  const start = migrationSql.toLowerCase().lastIndexOf(marker.toLowerCase());
  if (start < 0) return "";
  const next = migrationSql.toLowerCase().indexOf("create or replace function public.", start + marker.length);
  return migrationSql.slice(start, next < 0 ? migrationSql.length : next);
}

check(/^begin;/im.test(sql) && /^commit;/im.test(sql), "Migration must have BEGIN/COMMIT boundaries.");
check(/add column if not exists owner_user_id text/i.test(sql), "customers.owner_user_id is missing.");
check(/add column if not exists created_by_user_id text/i.test(sql), "customers.created_by_user_id is missing.");
check(/owner_user_id is intentionally nullable/i.test(sql), "P0-A must allow legacy customers to enter the P0-B unassigned pool.");
check(/create table if not exists public\.customer_assignments/i.test(p0bSql), "P0-B assignment history table is missing.");
check(/customer_assignments_one_current_idx/i.test(p0bSql), "P0-B must enforce one current assignment per customer.");
check(/tablename in \('customers', 'care_logs', 'deals'\)/i.test(sql), "Migration must clean legacy ownership policies on all scoped CRM tables.");
check(/lower\(policyname\) not like '%admin%'/i.test(sql), "Migration must preserve explicit admin policies while replacing legacy ownership policies.");

const auditBody = functionBody("crm_write_audit");
check(/insert into public\.audit_logs\s*\(\s*id\s*,/i.test(auditBody), "Audit RPC must provide audit_logs.id.");
check(/gen_random_uuid\(\)::text/i.test(auditBody), "Audit RPC must generate a non-null audit_logs.id.");

const accessBody = functionBody("crm_can_access_customer_id");
check(/customer_assignments/i.test(accessBody) && /employee_id\s*=\s*public\.crm_current_app_user_id\(\)/i.test(accessBody), "Customer access must use the current assignment.");
check(!/created_by/i.test(accessBody), "created_by must not grant customer access.");

const ownerPolicy = p0bSql.match(/create policy "customers manager or assigned employee read"[\s\S]*?;/i)?.[0] || "";
check(/crm_can_access_customer_id\(id\)/i.test(ownerPolicy), "Customer read policy must use assignment-based access.");
check(!/created_by/i.test(ownerPolicy), "Customer read policy must not use created_by.");

const requiredRpcs = [
  "crm_create_customer",
  "crm_update_customer_profile",
  "crm_transfer_customer",
  "crm_add_care_log",
  "crm_snooze_customer",
  "crm_save_basic_purchase",
  "crm_submit_kpi_proposal",
  "crm_review_kpi_proposal",
  "crm_set_customer_archived"
];
for (const rpc of requiredRpcs) {
  const body = functionBody(rpc);
  check(Boolean(body), `Missing RPC ${rpc}.`);
  check(/security definer/i.test(body), `${rpc} must explicitly declare SECURITY DEFINER.`);
  check(/set search_path = public/i.test(body), `${rpc} must lock search_path.`);
  check(new RegExp(`callCrmRpc\\(\\s*["']${rpc}["']`).test(app), `Frontend does not call ${rpc}.`);
  check(new RegExp(`revoke all on function public\\.${rpc}\\([\\s\\S]*?from public, anon`, "i").test(migrationSql), `${rpc} must revoke PUBLIC/anon.`);
  check(new RegExp(`grant execute on function public\\.${rpc}\\([\\s\\S]*?to authenticated`, "i").test(migrationSql), `${rpc} must grant only authenticated callers.`);
}

const transferBody = functionBody("crm_transfer_customer");
check(/crm_is_manager\(\)/i.test(transferBody), "Transfer RPC must enforce manager/admin role.");
check(/coalesce\(active, false\) = true/i.test(transferBody), "Transfer RPC must require an active employee.");
check(/crm_assign_customer/i.test(transferBody), "Transfer RPC must delegate to assignment history transaction.");
check(/crm\.allow_owner_transfer/i.test(sql), "Direct owner mutation guard is missing.");
check(/revoke all on function public\.crm_guard_customer_owner_change\(\) from public, anon, authenticated/i.test(sql), "Owner trigger helper must not be callable by clients.");

check(!/\brunTransaction\b/.test(app), "crm-app.js still uses the fake runTransaction adapter.");
check(!/service_role/i.test(app), "Frontend must not contain a service_role credential/reference.");
check(/P0-A đã tạm khóa xóa vĩnh viễn/.test(app), "Hard customer delete must be disabled in P0-A.");

check(/create trigger settings_sync_payload/i.test(settingsSql), "Settings persistence trigger is missing.");
check(/new\.data\s*:=\s*merged/i.test(settingsSql) && /new\.raw_data\s*:=\s*merged/i.test(settingsSql), "Settings trigger must keep data/raw_data synchronized.");
check(/ref\.collection === "settings"[\s\S]*?row\.data = merged[\s\S]*?row\.raw_data = merged/.test(adapter), "Frontend adapter must preserve merged settings payloads.");

const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
check(duplicateIds.length === 0, `Duplicate HTML IDs: ${duplicateIds.join(", ")}`);

if (failures.length) {
  console.error("Phase P0-A static contract: FAIL");
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}

console.log(`Phase P0-A static contract: PASS (${checksRun} checks)`);
