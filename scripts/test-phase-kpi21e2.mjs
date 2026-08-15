import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const sql = read("supabase-phase-kpi21e2-draft-config-delete.sql");
const app = read("js/features/crm-app.js");

let checks = 0;
function check(condition, message) {
  checks += 1;
  if (!condition) throw new Error(`FAIL: ${message}`);
}

for (const name of [
  "crm_kpi_delete_draft_assignment",
  "crm_kpi_delete_draft_period",
  "crm_kpi_delete_unused_definition"
]) {
  check(new RegExp(`create or replace function public\\.${name}\\(`).test(sql), `${name} RPC must exist.`);
  check(new RegExp(`revoke all on function public\\.${name}`).test(sql), `${name} must revoke public/anon.`);
  check(new RegExp(`grant execute on function public\\.${name}`).test(sql), `${name} must grant authenticated execution.`);
  if (name !== "crm_kpi_delete_draft_assignment") {
    check(new RegExp(`callCrmRpc\\("${name}"`).test(app), `${name} must be used by the UI.`);
  } else {
    check(/callCrmRpc\("crm_kpi_(delete|remove)_draft_assignment"/.test(app), "Safe DRAFT assignment undo RPC must be used by the UI.");
  }
}

check((sql.match(/security definer/g) || []).length === 3, "All delete RPCs must be SECURITY DEFINER.");
check((sql.match(/set search_path = public/g) || []).length === 3, "All delete RPCs must lock search_path.");
check((sql.match(/crm_kpi_is_business_manager\(\)/g) || []).length === 3, "All delete RPCs must enforce manager role.");
check(/status <> 'DRAFT'/.test(sql), "DRAFT lifecycle guard must exist.");
check(/from public\.kpi_submissions/.test(sql) && /from public\.kpi_evidence/.test(sql), "Runtime data guards must exist.");
check(/assignment_delete_draft/.test(sql) && /period_delete_draft/.test(sql) && /definition_delete_unused/.test(sql), "Every deletion must have an audit action.");
check(!/delete from public\.kpi_(submissions|submission_events|evidence)/.test(sql), "Migration must never delete KPI runtime history.");
check(/data-kpi1-delete-period/.test(app), "DRAFT period delete control must exist.");
check(/data-kpi1-delete-definition/.test(app), "Unused definition delete control must exist.");
check(/data-kpi1-(delete|remove)-assignment/.test(app), "DRAFT assignment undo control must exist.");
check(/clean\(period\.status\)\.toUpperCase\(\) !== "DRAFT"/.test(app), "UI must guard period lifecycle.");
check(/await reloadKpiFoundationData\(\)/.test(app), "UI must read back server state after RPC success.");

console.log(`KPI-2.1E.2 static contract: PASS (${checks} checks)`);
