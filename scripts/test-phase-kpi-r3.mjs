import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const sql = read("supabase-phase-kpi-r3-active-flexibility.sql");
const app = read("js/features/crm-app.js");
const html = read("index.html");
const canonical = read("supabase-phase-kpi2-final-consolidated.sql");
let checks = 0;
const check = (ok, message) => { checks += 1; if (!ok) throw new Error(`FAIL: ${message}`); };

for (const rpc of [
  "crm_kpi_assign_employee_r3",
  "crm_kpi_update_assignment_target_r3",
  "crm_kpi_update_assignment_options_r3",
  "crm_kpi_remove_or_cancel_assignment_r3",
  "crm_kpi_create_definition_active_r3",
  "crm_kpi_get_config_history_r3"
]) {
  check(new RegExp(`create or replace function public\\.${rpc}\\(`).test(sql), `${rpc} phải tồn tại.`);
  check(new RegExp(`grant execute on function public\\.${rpc}`).test(sql), `${rpc} phải cấp quyền có chủ đích.`);
}

check(/status not in \('DRAFT','ACTIVE'\)/.test(sql), "CLOSED phải bị từ chối ở server.");
check(/crm_kpi_r3_reason\(p_reason\)/.test(sql), "ACTIVE mutation phải kiểm tra reason.");
check(/char_length\(v_reason\) < 1 or char_length\(v_reason\) > 500/.test(sql), "Reason phải có giới hạn 1-500.");
check(/for update/.test(sql), "Mutation phải khóa row.");
check(/KPI_VERSION_CONFLICT/.test(sql), "Mutation phải phát hiện version conflict.");
check(/exists\(select 1 from public\.kpi_assignments/.test(sql), "Assignment trùng phải bị chặn.");
check(/case when v_period\.status='ACTIVE' then now\(\) else v_period\.starts_at end/.test(sql), "Assignment thêm trong ACTIVE phải bắt đầu tại thời điểm tạo.");
check(/from public\.kpi_submissions where assignment_id/.test(sql), "Server phải kiểm tra submission dependency.");
check(/from public\.kpi_submission_events where assignment_id/.test(sql), "Server phải kiểm tra event dependency.");
check(/from public\.kpi_evidence where assignment_id/.test(sql), "Server phải kiểm tra evidence dependency.");
check(/delete from public\.kpi_assignments/.test(sql), "Assignment chưa dùng phải có thể gỡ.");
check(/assignment_status='CANCELLED'/.test(sql), "Assignment đã dùng phải chuyển CANCELLED.");
check(!/delete from public\.kpi_(submissions|submission_events|evidence)/.test(sql), "Không được xóa lịch sử runtime.");
for (const event of ["ACTIVE_ASSIGNMENT_ADDED","ACTIVE_ASSIGNMENT_TARGET_CHANGED","ACTIVE_ASSIGNMENT_OPTIONS_CHANGED","ACTIVE_ASSIGNMENT_REMOVED_UNUSED","ACTIVE_ASSIGNMENT_CANCELLED","ACTIVE_DEFINITION_CREATED"]) {
  check(sql.includes(event), `Thiếu audit ${event}.`);
}
check(/revoke execute on function public\.crm_submit_kpi_proposal/.test(sql), "Legacy submit phải fail-closed.");
check(/revoke insert,update,delete[^;]+public\.kpi_proposals/.test(sql), "Legacy table phải read-only cho authenticated.");
check(!/drop table|delete from public\.kpi_(rules|proposals)/i.test(sql), "Không được xóa dữ liệu legacy.");

check(!/kpi-cutover\.js|crm_legacy_kpi_cutover_status|crm_(submit|review|archive)_kpi_proposal|collection\(db, ["']kpi(Proposals|Rules)["']\)/.test(app), "Runtime không được dùng legacy KPI.");
check(!/KPI cũ|kpiProposalModal|kpiApprovalPanel|kpiSummaryPanel|kpiRulePanel/.test(html), "DOM legacy phải được gỡ.");
check(/crm_kpi_assign_employee_r3/.test(app), "UI phải dùng RPC gán R3.");
check(/crm_kpi_update_assignment_target_r3/.test(app) && /crm_kpi_update_assignment_options_r3/.test(app), "UI phải dùng RPC sửa ACTIVE R3.");
check(/crm_kpi_remove_or_cancel_assignment_r3/.test(app), "UI phải dùng RPC gỡ/ngừng R3.");
check(/Kỳ CLOSED không thể/.test(app), "UI phải thể hiện CLOSED immutable.");
check(/Lý do thay đổi/.test(html) && /maxlength="500"/.test(html), "UI phải yêu cầu reason có giới hạn.");
check(/Thay đổi mục tiêu hoặc cách tính điểm sẽ làm thay đổi tỷ lệ hoàn thành/.test(app), "UI phải cảnh báo tác động điểm.");
check(/Ngừng KPI/.test(app) && /Gỡ KPI/.test(app), "UI phải phân biệt gỡ và ngừng.");
check(/crm_kpi_get_config_history_r3/.test(app), "History phải tải audit ACTIVE.");
check(/where a\.assignment_status = 'ASSIGNED'[\s\S]+p\.status in \('ACTIVE', 'CLOSED'\)/.test(canonical), "Điểm canonical phải loại assignment CANCELLED.");
check(/crm_kpi_submit_events[\s\S]+for update[\s\S]+assignment_status <> 'ASSIGNED'/.test(canonical), "Submit và cancel phải serialize qua khóa assignment và fail-closed.");

console.log(`CRM-KPI-R3 static contract: PASS (${checks} checks)`);
