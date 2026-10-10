#!/usr/bin/env node
// KPI 7C-B — static/unit contract for the period Close / Reopen / Cancel UI.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "js/features/crm-app.js"), "utf8");
const team = await import(pathToFileURL(path.join(root, "js/features/kpi-team.js")).href);
let checks = 0;
const ok = (cond, message) => { assert.ok(cond, message); checks++; };
const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };

// --- markup ---------------------------------------------------------------
for (const id of ["kpi1ClosePeriodBtn", "kpi1ReopenPeriodBtn", "kpi1CancelPeriodBtn", "kpiPeriodLifecycleDrawer",
  "kpiPeriodLifecycleOpenItems", "kpiPeriodLifecycleReason", "kpiPeriodLifecycleReasonLabel", "kpiPeriodLifecycleSubmitBtn", "kpiPeriodLifecycleCancelBtn"]) {
  ok(html.includes(`id="${id}"`), `index.html thiếu #${id}`);
}
ok(/id="kpi1ClosePeriodBtn" class="[^"]*\bhide\b/.test(html) && /id="kpi1ReopenPeriodBtn" class="[^"]*\bhide\b/.test(html), "Close/Reopen ẩn mặc định cho tới khi xét quyền");
ok(/id="kpi1ClosePeriodBtn"[^>]*>Đóng kỳ KPI</.test(html) && /id="kpi1ReopenPeriodBtn"[^>]*>Mở lại kỳ KPI</.test(html), "nhãn nút Close/Reopen");
ok(/kpi1ClosePeriodBtn"[^>]*title="Hoàn tất\/chốt kỳ KPI bình thường"/.test(html) && /kpi1CancelPeriodBtn"[^>]*title="Hủy kỳ KPI do kỳ được tạo\/vận hành sai"/.test(html), "phân biệt ngữ nghĩa Close vs Cancel");

// --- role visibility (single policy helper) --------------------------------
const actions = (status, role, runtimeTotal = 3) => team.kpiPeriodLifecycleActions({status, role, runtimeTotal});
eq(actions("ACTIVE", "sale"), {close:false, reopen:false, cancel:false}, "Sale: không có hành động vòng đời");
eq(actions("ACTIVE", "manager"), {close:true, reopen:false, cancel:false}, "Manager: chỉ Close, không Cancel");
eq(actions("ACTIVE", "admin"), {close:true, reopen:false, cancel:true}, "Admin ACTIVE");
eq(actions("ACTIVE", "owner"), {close:true, reopen:false, cancel:true}, "Owner ACTIVE");
eq(actions("ACTIVE", "owner", 0), {close:true, reopen:false, cancel:false}, "Cancel vẫn cần dữ liệu thực hiện (giữ luật R3.1)");
eq(actions("CLOSED", "manager"), {close:false, reopen:false, cancel:false}, "Manager không Reopen");
eq(actions("CLOSED", "admin"), {close:false, reopen:true, cancel:false}, "Admin Reopen");
eq(actions("CLOSED", "owner"), {close:false, reopen:true, cancel:false}, "Owner Reopen");
for (const status of ["DRAFT", "CANCELLED"]) for (const role of ["manager", "admin", "owner"]) {
  eq(actions(status, role), {close:false, reopen:false, cancel:false}, `${status}/${role}: không Close/Reopen/Cancel`);
}

// --- Close dialog model (counts come from backend payload only) ------------
const m13 = team.kpiPeriodCloseDialogModel({periodLabel:"09/2026", counts:{periodId:"p", pendingCount:13, needsRevisionCount:0, openTotal:13}});
eq(m13.title, "Đóng kỳ KPI 09/2026?", "tiêu đề");
eq(m13.intro, "Kỳ KPI sẽ chuyển sang trạng thái Đã đóng và chỉ còn chế độ xem.", "giải thích");
eq(m13.warning, "Có 13 đề xuất chưa được xử lý. Khi đóng kỳ, 13 đề xuất này sẽ tự động bị từ chối và không được tính vào KPI.", "cảnh báo auto-reject");
eq(m13.breakdown, [["Chờ duyệt", 13], ["Cần bổ sung", 0]], "breakdown");
eq(m13.submitLabel, "Đóng kỳ & từ chối 13 đề xuất", "primary động");
eq(m13.cancelLabel, "Hủy", "secondary");
const m0 = team.kpiPeriodCloseDialogModel({periodLabel:"10/2026", counts:{pendingCount:0, needsRevisionCount:0, openTotal:0}});
eq([m0.warning, m0.submitLabel], ["", "Đóng kỳ KPI"], "không có mục mở");
eq(team.kpiPeriodCloseDialogModel({counts:{pendingCount:3, needsRevisionCount:2, openTotal:5}}).total, 5, "tổng lấy từ openTotal của backend");
ok(!/phải xử lý hết|xử lý hết trước/i.test(JSON.stringify(m13)), "không dùng hợp đồng cũ “phải xử lý hết trước khi đóng”");

// --- result message uses the RPC result, never the dialog count -----------
eq(team.kpiPeriodCloseResultMessage({autoRejectedTotal:14, pendingRejected:14, revisionRejected:0}),
  "Kỳ KPI đã được đóng. 14 đề xuất chưa xử lý đã được từ chối tự động.", "thông báo dùng autoRejectedTotal");
eq(team.kpiPeriodCloseResultMessage({autoRejectedTotal:0}), "Kỳ KPI đã được đóng. Không có đề xuất nào cần từ chối tự động.", "không có auto-reject");
ok(/kpiPeriodCloseResultMessage\(result\)/.test(app), "crm-app hiển thị thông báo từ kết quả RPC");
ok(!/kpiPeriodCloseResultMessage\([^)]*previewOpenTotal/.test(app), "không dùng số đếm cũ của dialog làm kết quả");

// --- Reopen ----------------------------------------------------------------
const reopen = team.kpiPeriodReopenDialogModel({periodLabel:"09/2026"});
eq(reopen.title, "Mở lại kỳ KPI 09/2026?", "tiêu đề Reopen");
ok(reopen.points.some(p => p.includes("ACTIVE")) && reopen.points.some(p => p.includes("đề xuất mới")) && reopen.points.some(p => p.includes("KHÔNG tự phục hồi")), "Reopen nói rõ không phục hồi");
eq([reopen.reasonLabel, reopen.submitLabel], ["Lý do mở lại", "Mở lại kỳ"], "Reopen reason/submit");
ok(/if \(!reason\) return notice\("Hãy nhập lý do mở lại kỳ KPI\."/.test(app), "Reopen chặn lý do trống ở client");
ok(/crm_kpi_reopen_period", \{p_period_id:periodId, p_expected_version:expectedVersion, p_reason:reason\}/.test(app), "Reopen gửi version + reason");
ok(/vẫn giữ trạng thái từ chối/.test(app), "thông báo Reopen không ngụ ý phục hồi");

// --- PERIOD_CLOSED label ---------------------------------------------------
eq(team.kpiReviewReasonLabel("PERIOD_CLOSED"), "Từ chối tự động do kỳ KPI đã được đóng", "nhãn PERIOD_CLOSED");
eq(team.kpiReviewReasonLabel("DUPLICATE"), "DUPLICATE", "lý do khác giữ nguyên");
const card = team.managerKpiEventCardHtml(team.managerKpiEventViewModel({event:{id:"e1", status:"REJECTED", review_reason_code:"PERIOD_CLOSED", reviewed_at:"2026-10-01T00:00:00Z"}}));
ok(card.includes("Lý do: Từ chối tự động do kỳ KPI đã được đóng") && !card.includes("PERIOD_CLOSED"), "thẻ đề xuất (Sale + Manager) không hiện mã thô");
ok(!/data-kpi2-withdraw-event/.test(team.managerKpiEventCardHtml(team.managerKpiEventViewModel({event:{id:"e1", status:"REJECTED", review_reason_code:"PERIOD_CLOSED"}}), {withdrawAction:true})), "Event auto-reject không thu hồi được");
ok(!/<option>PERIOD_CLOSED<\/option>/.test(app), "Manager không chọn được PERIOD_CLOSED khi duyệt");

// --- RPC wiring --------------------------------------------------------------
ok(/callCrmRpc\("crm_kpi_period_open_items", \{p_period_id:period\.id\}\)/.test(app), "preflight dùng crm_kpi_period_open_items");
ok(/callCrmRpc\("crm_kpi_close_period_foundation", \{p_period_id:periodId, p_expected_version:expectedVersion\}\)/.test(app), "Close gửi period + expected version");
ok(/drawer\.dataset\.periodVersion = String\(period\.version\)/.test(app), "dialog dùng version mới nhất đã tải");
const closeFn = app.slice(app.indexOf("async function confirmKpiPeriodClose"), app.indexOf("async function confirmKpiPeriodReopen"));
ok(/version_conflict[\s\S]*openKpiPeriodClose\(\{changed:true\}\)/.test(closeFn) && (closeFn.match(/crm_kpi_close_period_foundation/g) || []).length === 1, "VERSION_CONFLICT: tải lại + xác nhận lại, không tự retry");
ok(/refreshAfterKpiPeriodLifecycle\(periodId\)\.catch/.test(closeFn) && closeFn.indexOf("refreshAfterKpiPeriodLifecycle") < closeFn.indexOf("version_conflict\")"), "lỗi: tải lại trạng thái máy chủ, không đánh dấu CLOSED lạc quan");
ok(/result\?\.closed !== true/.test(closeFn), "backend cũ (closed:false) không bị coi là đã đóng");
const openCloseFn = app.slice(app.indexOf("async function openKpiPeriodClose"), app.indexOf("function openKpiPeriodReopen"));
ok(!/kpi_submission_events|status === "PENDING"|NEEDS_REVISION/.test(openCloseFn), "frontend không tự đếm mục mở");
ok(/KPI_PERIOD_CANCEL_OPEN_ITEMS_MESSAGE/.test(app) && team.KPI_PERIOD_CANCEL_OPEN_ITEMS_MESSAGE === "Không thể hủy kỳ vì còn đề xuất chưa xử lý. Hãy đóng kỳ nếu mục đích là kết thúc kỳ KPI.", "Cancel KPI_PERIOD_OPEN_ITEMS có hướng dẫn");
const cancelBlock = app.slice(app.indexOf('if (action === "cancel" && kpiPeriodLifecycleErrorKind(error) === "open_items")'), app.indexOf('if (action === "cancel" && kpiPeriodLifecycleErrorKind(error) === "open_items")') + 400);
ok(cancelBlock.length > 0 && !/crm_kpi_close_period_foundation/.test(cancelBlock), "Cancel không tự chuyển sang Close");
eq(team.kpiPeriodLifecycleErrorKind({message:"KPI_VERSION_CONFLICT: Kỳ KPI đã thay đổi."}), "version_conflict", "nhận diện version conflict");
eq(team.kpiPeriodLifecycleErrorKind({message:"KPI_PERIOD_OPEN_ITEMS: Kỳ KPI còn 1 mục"}), "open_items", "nhận diện open items");
ok(/refreshAfterKpiPeriodLifecycle[\s\S]{0,700}reloadKpiFoundationData\(\)[\s\S]{0,700}reloadKpiTeamSummary\(\{force:true\}\)[\s\S]{0,200}refreshCanonicalKpiPendingCount\(\)[\s\S]{0,120}reloadKpi2Data\(\)/.test(app), "sau Close/Reopen: tải lại kỳ, KPI Team, hàng chờ, KPI của tôi");
ok(/on\("kpi1ClosePeriodBtn"/.test(app) && /on\("kpi1ReopenPeriodBtn", "click", openKpiPeriodReopen\)/.test(app), "gắn sự kiện nút");
ok(/kpiPeriodLifecycleActions\(\{status:periodStatus, role:roleKey\(\), runtimeTotal\}\)/.test(app), "render dùng chung chính sách quyền");

// --- CLOSED read-only (existing guards preserved) --------------------------
ok(/pendingCount && !periodFrozen/.test(app) && /\["CANCELLED", "CLOSED"\]\.includes\(clean\(kpiTeamPeriod\(\)\?\.status\)\.toUpperCase\(\)\)/.test(app), "KPI Team CLOSED ẩn duyệt/từ chối");
ok(/const canConfigure = \["DRAFT", "ACTIVE"\]\.includes\(periodStatus\)/.test(app), "CLOSED không sửa target/assignment");
ok(/canSubmit=(?:display\.writable&&)?clean\(kpi2Field\(row,"periodStatus","period_status"\)\)\.toUpperCase\(\)==='ACTIVE'/.test(app), "CLOSED không gửi đề xuất mới");
ok(/value === "CLOSED" \? "ĐÃ ĐÓNG"/.test(app), "nhãn trạng thái ĐÃ ĐÓNG");

console.log(`KPI 7C-B lifecycle UI static contract: PASS (${checks} checks)`);
