import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("supabase-phase-kpi-r31-period-lifecycle.sql", "utf8");
const app = readFileSync("js/features/crm-app.js", "utf8");
const html = readFileSync("index.html", "utf8");

for (const token of [
  "PERIOD_REVERTED_TO_DRAFT", "PERIOD_DELETED_DRAFT", "PERIOD_CANCELLED",
  "crm_kpi_revert_active_period_to_draft", "crm_kpi_delete_draft_period",
  "crm_kpi_cancel_active_period", "crm_kpi_guard_runtime_period_active",
  "'DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED'"
]) assert.ok(sql.includes(token), `Thiếu SQL contract: ${token}`);

assert.match(sql, /runtimeTotal'\)::bigint <> 0[\s\S]*không thể đưa về DRAFT/);
assert.match(sql, /runtimeTotal'\)::bigint = 0[\s\S]*đưa kỳ về DRAFT thay vì hủy/);
assert.match(sql, /status='CANCELLED'[\s\S]*cancel_reason=v_reason/);
assert.match(sql, /p\.status in \('ACTIVE','CLOSED','CANCELLED'\)/);
assert.match(sql, /p\.status in \('ACTIVE','CLOSED'\)/);
assert.match(sql, /for share of p/);
assert.equal((sql.match(/kpi_\w+_r31_period_guard/g) || []).length >= 6, true, "Thiếu trigger create/drop runtime freeze");

for (const id of [
  "kpi1RevertPeriodBtn", "kpi1DeletePeriodR31Btn", "kpi1CancelPeriodBtn",
  "kpiPeriodLifecycleDrawer", "kpiPeriodLifecycleReason", "kpiPeriodLifecycleSubmitBtn"
]) assert.ok(html.includes(`id="${id}"`), `Thiếu UI: ${id}`);

for (const token of [
  "openKpiPeriodLifecycle", "confirmKpiPeriodLifecycle",
  "crm_kpi_period_runtime_dependencies", "ĐÃ HỦY", 'maxlength="500"'
]) assert.ok(app.includes(token) || html.includes(token), `Thiếu frontend contract: ${token}`);

assert.ok(!app.includes('data-kpi1-delete-period'), "Luồng xóa cũ không được tồn tại");
assert.ok(!/function deleteKpi1Period\s*\(/.test(app), "Hàm xóa cũ không được tồn tại");
assert.match(app, /pendingCount && !periodFrozen/);
assert.match(app, /\["ACTIVE","CLOSED","CANCELLED"\]/);

console.log("CRM-KPI-R3.1 static contracts: PASS");
