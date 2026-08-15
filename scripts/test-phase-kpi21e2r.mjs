import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const sql = read("supabase-phase-kpi21e2r-safe-kpi-undo.sql");
const app = read("js/features/crm-app.js");

let checks = 0;
function check(condition, message) {
  checks += 1;
  if (!condition) throw new Error(`FAIL: ${message}`);
}

check(/create or replace function public\.crm_kpi_remove_draft_assignment\(/.test(sql), "Explicit remove-assignment RPC missing.");
check(/security definer[\s\S]*set search_path = public/.test(sql), "RPC must pin search_path.");
check(/crm_kpi_is_business_manager\(\)/.test(sql), "Manager role guard missing.");
check(/from public\.kpi_submissions where assignment_id/.test(sql), "Submission dependency guard missing.");
check(/from public\.kpi_submission_events where assignment_id/.test(sql), "Event dependency guard missing.");
check(/from public\.kpi_evidence where assignment_id/.test(sql), "Evidence dependency guard missing.");
check(/v_period\.status = 'ACTIVE'/.test(sql) && /v_period\.status = 'CLOSED'/.test(sql), "ACTIVE/CLOSED guards missing.");
check(/p_expected_assignment_version/.test(sql) && /p_expected_period_version/.test(sql), "Optimistic lock inputs missing.");
check(/assignment_remove_draft/.test(sql), "Assignment removal audit missing.");
check(/'reason', v_reason/.test(sql), "Removal reason audit missing.");
check(/'target', v_assignment\.target/.test(sql) && /'scoreEnabled', v_assignment\.score_enabled/.test(sql), "Assignment audit detail missing.");
check(!/delete from public\.kpi_(submissions|submission_events|evidence)/.test(sql), "Runtime history must never be deleted.");
check(/create or replace function public\.crm_kpi_delete_unused_definition\(/.test(sql), "Definition delete hardening missing.");
check(/KPI này đã từng được sử dụng nên không thể xóa/.test(sql), "Used definition denial missing.");
check(/crm_kpi_set_definition_active/.test(app), "Canonical deactivate RPC must be reused.");
check(/Ngừng sử dụng/.test(app), "Deactivate wording missing.");
check(/Xóa KPI/.test(app), "Definition delete wording missing.");
check(/Gỡ KPI/.test(app), "Assignment remove wording missing.");
check(/data-kpi-team-edit-assignment/.test(app), "Employee detail edit action missing.");
check(/data-kpi1-remove-assignment/.test(app), "Employee detail remove action missing.");
check(/crm_kpi_update_assignment_target/.test(app) && /crm_kpi_update_assignment_options/.test(app), "Existing edit RPCs must be reused.");
check(/callCrmRpc\("crm_kpi_remove_draft_assignment"/.test(app), "Frontend must call remove RPC.");
check(/await reloadKpiFoundationData\(\)/.test(app) && /reloadKpiTeamSummary/.test(app), "Server read-back missing.");
check(/clean\(period\.status\)\.toUpperCase\(\) !== "DRAFT"/.test(app), "UI lifecycle guard missing.");
check(/revoke all on function public\.crm_kpi_remove_draft_assignment/.test(sql), "Public/anon revoke missing.");
check(/grant execute on function public\.crm_kpi_remove_draft_assignment[^;]+to authenticated/.test(sql), "Authenticated grant missing.");

console.log(`KPI-2.1E.2R static contract: PASS (${checks} checks)`);
