import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sql = fs.readFileSync(path.join(root, "supabase-phase-kpi1-foundation.sql"), "utf8");
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
check(/create table if not exists public\.kpi_periods/i.test(sql), "kpi_periods missing.");
check(/create table if not exists public\.kpi_definitions/i.test(sql), "kpi_definitions missing.");
check(/create table if not exists public\.kpi_assignments/i.test(sql), "kpi_assignments missing.");
check(!/(drop|truncate)\s+table\s+(if\s+exists\s+)?public\.(kpi_rules|kpi_proposals)/i.test(sql), "Legacy KPI tables must not be dropped/truncated.");
check(!/alter\s+table\s+public\.(kpi_rules|kpi_proposals)/i.test(sql), "Legacy KPI tables must not be altered in KPI-1.");
check(/period_month\s+date\s+not null\s+unique/i.test(sql), "Unique period month missing.");
check(/period_month = date_trunc\('month'/i.test(sql), "First-day month normalization constraint missing.");
check(/status in \('DRAFT', 'ACTIVE', 'CLOSED'\)/i.test(sql), "Period lifecycle check missing.");
check(/kpi_type in \('AUTO', 'MANUAL', 'HYBRID'\)/i.test(sql), "KPI type check missing.");
check(/submission_mode in \('EVENT_CLAIM', 'PERIOD_TOTAL'\)/i.test(sql), "Future submission mode contract missing.");
check(/constraint kpi_assignments_unique unique \(period_id, definition_id, employee_id\)/i.test(sql), "Unique assignment constraint missing.");
check(/kpi_assignments_target_check check \(target > 0\)/i.test(sql), "Positive target constraint missing.");
check(/definition_snapshot jsonb not null/i.test(sql) && /definition_version/i.test(sql), "Definition snapshot/version missing.");
check(/references public\.app_users\(id\) on delete restrict/i.test(sql), "Employee history FKs must use RESTRICT.");
check(!/assigned_owners|owner_targets/i.test(sql), "New KPI foundation must not use legacy owner JSON.");

check(/revoke all on public\.kpi_periods from anon, authenticated/i.test(sql), "Direct period grants not revoked.");
check(/revoke all on public\.kpi_definitions from anon, authenticated/i.test(sql), "Direct definition grants not revoked.");
check(/revoke all on public\.kpi_assignments from anon, authenticated/i.test(sql), "Direct assignment grants not revoked.");
check(/grant select on public\.kpi_periods to authenticated/i.test(sql), "Period SELECT grant missing.");
check(/kpi periods canonical read/i.test(sql), "Canonical period policy missing.");
check(/kpi definitions canonical manager read/i.test(sql), "Canonical definition policy missing.");
check(/kpi assignments canonical read/i.test(sql), "Canonical assignment policy missing.");
check(!/email\s*=\s*public\.crm_current_email|lower\([^\n]*email/i.test(sql.slice(sql.indexOf("-- 4. Canonical RLS"), sql.indexOf("-- 5. Period RPCs"))), "Canonical KPI RLS must not grant by email.");
check(/crm_kpi_guard_direct_write/i.test(sql), "Direct-write guard missing.");
check(/crm_kpi_guard_employee_deactivation/i.test(sql), "Draft assignment deactivation guard missing.");

const requiredRpcs = [
  "crm_kpi_create_period",
  "crm_kpi_update_period",
  "crm_kpi_activate_period",
  "crm_kpi_close_period_foundation",
  "crm_kpi_reopen_period",
  "crm_kpi_create_definition",
  "crm_kpi_update_definition",
  "crm_kpi_set_definition_active",
  "crm_kpi_assign_employee",
  "crm_kpi_bulk_assign",
  "crm_kpi_update_assignment_target",
  "crm_kpi_sync_definition_assignments",
  "crm_kpi_cancel_assignment"
];

for (const rpc of requiredRpcs) {
  const body = latestFunction(rpc);
  check(Boolean(body), `Missing ${rpc}.`);
  check(/security definer/i.test(body), `${rpc} must use SECURITY DEFINER.`);
  check(/set search_path = public/i.test(body), `${rpc} must lock search_path.`);
  check(new RegExp(`revoke all on function public\\.${rpc}\\([\\s\\S]*?from public, anon`, "i").test(sql), `${rpc} must revoke public/anon.`);
  check(new RegExp(`grant execute on function public\\.${rpc}\\([\\s\\S]*?to authenticated`, "i").test(sql), `${rpc} must grant authenticated only.`);
}

check(/for update/i.test(latestFunction("crm_kpi_activate_period")), "Activate RPC must lock period.");
check(/p_expected_version/i.test(latestFunction("crm_kpi_activate_period")), "Activate RPC version check missing.");
check(/status <> 'DRAFT'/i.test(latestFunction("crm_kpi_assign_employee")), "Assignment DRAFT guard missing.");
check(/lower\(coalesce\(v_employee\.role, ''\)\) <> 'sale'/i.test(latestFunction("crm_kpi_assign_employee")), "Sale-only assignment validation missing.");
check(/pg_try_advisory_xact_lock\(hashtextextended\('crm:kpi:employee:' \|\| p_employee_id/i.test(latestFunction("crm_kpi_assign_employee")), "Single assignment must serialize against employee lifecycle changes.");
check(/pg_try_advisory_xact_lock\(hashtextextended\('crm:kpi:employee:' \|\| v_employee_id/i.test(latestFunction("crm_kpi_bulk_assign")), "Bulk assignment must serialize against employee lifecycle changes.");
check(/pg_try_advisory_xact_lock\(hashtextextended\('crm:kpi:employee:' \|\| v_employee_id/i.test(latestFunction("crm_kpi_sync_definition_assignments")), "Matrix sync must serialize against employee lifecycle changes.");
check(/pg_advisory_xact_lock\(hashtextextended\('crm:kpi:employee:' \|\| old\.id/i.test(latestFunction("crm_kpi_guard_employee_deactivation")), "Employee deactivation guard must share the KPI lifecycle advisory lock.");
check(/for update nowait/i.test(latestFunction("crm_kpi_assign_employee")) && /pg_try_advisory_xact_lock/i.test(latestFunction("crm_kpi_assign_employee")), "Single assignment concurrency must fail fast instead of hanging.");
check(/for update nowait/i.test(latestFunction("crm_kpi_bulk_assign")) && /pg_try_advisory_xact_lock/i.test(latestFunction("crm_kpi_bulk_assign")), "Bulk assignment concurrency must fail fast instead of hanging.");
check(/for update nowait/i.test(latestFunction("crm_kpi_sync_definition_assignments")) && /pg_try_advisory_xact_lock/i.test(latestFunction("crm_kpi_sync_definition_assignments")), "Matrix sync concurrency must fail fast instead of hanging.");
check(/jsonb_array_length\(p_rows\) > 200/i.test(latestFunction("crm_kpi_bulk_assign")), "Bulk limit missing.");
check(/KPI_REVIEW_FOUNDATION_INCOMPLETE/i.test(latestFunction("crm_kpi_close_period_foundation")), "Foundation close must fail closed.");
check(/crm_kpi_is_admin_owner/i.test(latestFunction("crm_kpi_reopen_period")), "Reopen must require admin/owner.");
check(/assignment_matrix_sync/i.test(latestFunction("crm_kpi_sync_definition_assignments")), "Matrix sync audit missing.");
check(!/errcode\s*=\s*'40001'/i.test(sql), "Optimistic version conflicts must not use retryable PostgreSQL SQLSTATE 40001.");
check(/KPI_VERSION_CONFLICT/i.test(sql), "KPI version conflict must return a deterministic application error.");

check(/kpiPeriods:\s*"kpi_periods"/.test(adapter), "Adapter kpiPeriods map missing.");
check(/kpiDefinitions:\s*"kpi_definitions"/.test(adapter), "Adapter kpiDefinitions map missing.");
check(/kpiAssignments:\s*"kpi_assignments"/.test(adapter), "Adapter kpiAssignments map missing.");
check(/function renderKpiFoundation\(\)/.test(app), "Manager KPI foundation renderer missing.");
check(/crm_kpi_sync_definition_assignments/.test(app), "Matrix UI must use atomic sync RPC.");
check(/crm_kpi_activate_period/.test(app), "Activate UI RPC missing.");
check(/kpiFoundationPanel/.test(html) && /kpi1MatrixRows/.test(html), "KPI foundation UI missing.");
check(/function renderKpiRuleList\(\)/.test(app), "Legacy KPI rule renderer must remain available.");
check(/function renderMyKpiProposalPanel\(\)/.test(app), "Legacy sale KPI proposal list must remain available.");
check(/function openKpiProposalModal\(/.test(app) && /function submitKpiProposal\(\)/.test(app), "Legacy sale KPI proposal workflow must remain available.");
check(/function renderKpiApprovalPanel\(\)/.test(app), "Legacy manager KPI approval workflow must remain available.");
check(/KPI cũ — Chỉ đọc từ 01\/09\/2026/.test(html), "Legacy KPI cutover/history label missing.");

const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
check(duplicateIds.length === 0, `Duplicate HTML IDs: ${duplicateIds.join(", ")}`);

if (failures.length) {
  console.error("KPI-1 static contract: FAIL");
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}

console.log(`KPI-1 static contract: PASS (${checks} checks)`);
