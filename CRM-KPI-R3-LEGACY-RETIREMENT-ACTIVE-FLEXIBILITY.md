# CRM-KPI-R3 — Legacy Retirement + Flexible Active Period Management

## 1. Kết luận

Trạng thái hiện tại: **CRM-KPI-R3 PASS — DEPLOYED BEHIND MAINTENANCE, REAL-ROLE SMOKE PENDING**. Backend và frontend R3 đã lên production, nhưng CRM vẫn khóa maintenance để chờ Owner chỉ định dữ liệu smoke an toàn.

## 2. Starting baseline

- Git/source: `8a6fbd2597ba91ec63cfcbadbf250df4d8375862`.
- Supabase: `jjeeazwlqcwynzquimeo`.
- Vercel project: `thien-di-s-projects1/crm_kolor`.
- Deployment đầu kỳ: `dpl_216FRcZYavW2joLZMfWBBoPTowJy`.
- CRM ban đầu OPEN; audit đầu kỳ chỉ đọc.

## 3. Current KPI architecture audit

Canonical authority gồm `kpi_periods`, `kpi_definitions`, `kpi_assignments`, `kpi_submissions`, `kpi_submission_events`, `kpi_evidence`, `kpi_action_requests`, `kpi_duplicate_matches` và các RPC `crm_kpi_*`. Assignment đã có `assignment_status`, `cancelled_*`, `cancel_reason`, `score_enabled`, `lock_version` và `definition_snapshot`.

## 4. Legacy dependency audit

Runtime cũ từng có DOM submit/review/export, snapshot `kpiRules`/`kpiProposals`, dashboard merge, customer timeline merge, các RPC mutation legacy và `kpi-cutover.js`. SQL/test/tài liệu lịch sử được giữ làm archive/documentation; runtime production không còn import hoặc gọi chúng.

## 5. Canonical KPI authority

Sau R3, KPI hiện hành chỉ đọc/ghi canonical tables và RPC. Báo cáo/dashboard hiện hành chỉ hiển thị hàng đợi event canonical; không ghép proposal legacy vào điểm hiện tại.

## 6. Current production period state

Production có một kỳ `KPI tháng 09/2026`, ID `53a130ba-b0ac-4a76-9a54-7bb7b06b809b`, trạng thái `ACTIVE`, version `13`, thời gian `2026-09-01` đến `2026-10-01` theo mốc UTC tương ứng. Có 8 definitions, 4 assignments `ASSIGNED`, 4 score-enabled, 0 submission, 0 event, 0 evidence, 0 cancelled.

Bốn assignment hiện thuộc `devil8xonline@gmail.com`; tài khoản này đã được Owner giữ ở role `manager`. Đây là dữ liệu có trước R3 và R3 không tự sửa role hay assignment.

## 7. ACTIVE lifecycle problem

RPC cũ chỉ cho phép cấu hình khi `DRAFT`; UI khóa toàn bộ khi kỳ `ACTIVE`. Vì vậy Manager không thể sửa sai target, bổ sung hoặc dừng KPI trong kỳ đang vận hành.

## 8. New ACTIVE business contract

`DRAFT` tiếp tục chỉnh theo cơ chế cũ. `ACTIVE` cho phép add/edit/remove/cancel/create-definition qua RPC R3 có reason, row lock, version guard và audit. `CLOSED` bị từ chối server-side.

## 9. Add KPI during ACTIVE

`crm_kpi_assign_employee_r3` cho phép `DRAFT/ACTIVE`, chỉ nhận Sale ACTIVE, chặn trùng kể cả assignment từng cancelled và đặt `effective_at=now()` khi ACTIVE để không tạo tiến độ hồi tố.

## 10. Target edit during ACTIVE

`crm_kpi_update_assignment_target_r3` khóa assignment/period, kiểm tra hai version, yêu cầu reason khi ACTIVE và ghi old/new target cùng runtime event count.

## 11. Assignment option edit

R3 chỉ mở tùy chọn hiện có `score_enabled` qua `crm_kpi_update_assignment_options_r3`. Không có generic arbitrary update. UI cảnh báo nếu assignment đã có dữ liệu.

## 12. Remove unused assignment

`crm_kpi_remove_or_cancel_assignment_r3` đếm `submissions/events/evidence` trong transaction. Khi cả ba bằng 0, RPC chỉ xóa assignment và ghi `ACTIVE_ASSIGNMENT_REMOVED_UNUSED`.

## 13. Cancel used assignment

Nếu có dependency, cùng RPC chuyển assignment sang `CANCELLED`, giữ nguyên submission/event/evidence và ghi actor/time/reason cùng dependency counts.

## 14. Cancelled scoring semantics

RPC progress canonical hiện lọc `assignment_status='ASSIGNED'`; monthly score tổng hợp từ progress này. Assignment cancelled vì vậy không còn tính vào điểm chính thức hiện tại. Dữ liệu event cũ không bị viết lại.

## 15. Definition/version policy

Assignment lưu `definition_snapshot`. UI từ chối sửa definition đang được dùng trong kỳ ACTIVE và hướng Manager tạo code/definition mới. `crm_kpi_create_definition_active_r3` yêu cầu period/version/reason và audit.

## 16. CLOSED immutability

Cả năm mutation R3 đều từ chối trạng thái ngoài `DRAFT/ACTIVE`, hoặc yêu cầu chính xác `ACTIVE` với definition mới. UI cũng khóa hành động khi `CLOSED`.

## 17. Manager governance

Mọi mutation gọi `crm_kpi_is_business_manager()` và chỉ gán cho `app_users.role='sale'`, `active=true`, `lifecycle_status='active'`. Không mở quyền identity/settings/admin khác.

## 18. Audit/history design

Audit actions: `ACTIVE_ASSIGNMENT_ADDED`, `ACTIVE_ASSIGNMENT_TARGET_CHANGED`, `ACTIVE_ASSIGNMENT_OPTIONS_CHANGED`, `ACTIVE_ASSIGNMENT_REMOVED_UNUSED`, `ACTIVE_ASSIGNMENT_CANCELLED`, `ACTIVE_DEFINITION_CREATED`. `crm_kpi_get_config_history_r3` đưa reason/actor/time vào tab History hiện có.

## 19. Legacy runtime retirement

Đã xóa legacy DOM, modal, click handlers, renderers, exports, subscriptions và các merge path khỏi `index.html` và `js/features/crm-app.js`. Production asset scan trả `LegacyDom=False`, `LegacyRuntime=False`.

## 20. Legacy backend/archive state

Giữ nguyên 8 `kpi_rules`, 113 `kpi_proposals` và 85 objects trong bucket `kpi-evidence`. Authenticated không còn EXECUTE ba mutation RPC legacy và không còn INSERT/UPDATE/DELETE trên hai bảng legacy; `service_role` giữ quyền phục vụ archive/điều tra có kiểm soát.

## 21. Cutover simplification

Runtime không còn import `kpi-cutover.js`, gọi `crm_legacy_kpi_cutover_status` hoặc chọn nguồn theo ngày. File/tài liệu cutover lịch sử vẫn nằm trong repository để truy nguyên.

## 22. Migration artifact/hash

Artifact: `supabase-phase-kpi-r3-active-flexibility.sql`.

SHA256: `DD27EDA96EAC479ADF9138E88CE2D0E5B663FFEBB840AEA1F217F7354AFD5283`.

## 23. Local/static/integration tests

- R3 static: PASS, 46 checks.
- R3 PGlite integration: PASS, 5 ACTIVE audit events và 3 negative guards.
- KPI-2: PASS, 172 checks.
- KPI-2.1B: PASS, 25 checks.
- KPI-2.1E.2: PASS, 24 checks.
- KPI-2.1E.2R: PASS, 26 checks.
- KPI-2R.2: PASS, 57 checks.
- `node --check` và `git diff --check`: PASS.

Test KPI-1/cutover cũ yêu cầu giữ legacy UI nên được xác định là superseded bởi R3. Các staging test tự từ chối vì project guard, không được dùng để chạm production.

## 24. Maintenance ON action

Đã đặt `VITE_MAINTENANCE_MODE=true` và redeploy baseline. Read-back trực tiếp `maintenance.generated.js` trả `enabled: true` trước khi apply backend.

## 25. Production backend rollout

Đã apply đúng artifact bằng `supabase db query --linked --file supabase-phase-kpi-r3-active-flexibility.sql` sau khi maintenance ON.

## 26. Production read-back

Sáu RPC R3 có đúng signature và ACL `authenticated/service_role`. Ba mutation RPC legacy chỉ còn `postgres/service_role`. Count và fingerprint period/definition/assignment/legacy trước và sau backend giống hoàn toàn.

## 27. Frontend implementation

KPI Team cho phép `+ Gán KPI`, edit target/score option, `Gỡ KPI` hoặc `Ngừng KPI` ở ACTIVE; reason tối đa 500 ký tự; warning có dữ liệu; audit hiển thị trong History. Sale chỉ nhận assignment `ASSIGNED` từ progress RPC nên cancelled không còn actionable.

## 28. Git commit

Commit/push `main`: `90b84a2ff60dac88ecc4e75c915d9603991669d0` — `feat: retire legacy KPI and support active period changes`.

## 29. Vercel deployment

Production deployment: `dpl_BHUVCYU9tMCrPNCzGDD7dTXkhf9r`, Ready, aliased tại `https://crmkolor.vercel.app/`. Asset xác nhận cache key `20260909-kpi-r3`, R3 RPC calls có mặt và legacy runtime không còn.

## 30. Manager smoke

PENDING. Cần Owner chỉ định Sale/KPI fixture an toàn để không tự ý đổi KPI thật.

## 31. Sale smoke

PENDING sau Manager smoke. Cần Sale đăng nhập để xác nhận assignment mới xuất hiện, cancelled không actionable và điểm đúng.

## 32. Owner smoke

PENDING. Cần Owner xác nhận audit/history và governance sau controlled mutation.

## 33. Legacy production proof

Static production HTML/JS proof PASS: không còn legacy DOM, legacy RPC call hoặc collection subscription. Quyền mutation backend legacy đã fail-closed. Real-role visual/network proof chờ mở maintenance có kiểm soát.

## 34. Data integrity

Trước/sau backend: periods `1`, definitions `8`, assignments `4`, submissions/events/evidence `0/0/0`, legacy rules/proposals `8/113`. Fingerprints trước/sau giống nhau: periods `5f1bca20e9eb2e25f416a958601d9c81`, definitions `1a583c0760039c6707042554193fe718`, assignments `5007ca909000bef78549d7d79c601097`, legacy rules `536b9a6e297c35ea95a403e514ed19b2`, legacy proposals `e1bb6501228b0328ee3425158e8ee4cc`.

## 35. Maintenance final state

ON. Production hiện khóa toàn bộ UI đúng chiến lược fail-closed trong khi chờ dữ liệu smoke được Owner duyệt.

## 36. Remaining limitations

- Chưa có real-role smoke vì production không có fixture KPI mutable được phê duyệt.
- Kỳ hiện tại chỉ có assignment của một tài khoản nay mang role Manager; ba Sale ACTIVE chưa có assignment canonical trong kỳ. R3 không tự diễn giải hoặc sửa dữ liệu này.
- Bucket `kpi-evidence` chứa 85 object lịch sử nhưng metadata hiện tại không đủ phân loại chắc chắn từng object legacy/canonical; không object nào bị xóa.

## 37. Final recommendation

Owner chỉ định một Sale ACTIVE và một definition an toàn để smoke add/edit/remove; nếu cần kiểm tra cancel-used thì phải phê duyệt rõ một fixture có event. Sau PASS, so sánh lại toàn bộ count/fingerprint, tắt maintenance, redeploy và read-back OPEN.
