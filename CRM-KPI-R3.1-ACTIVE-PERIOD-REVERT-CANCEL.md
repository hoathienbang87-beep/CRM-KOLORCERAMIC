# CRM-KPI-R3.1 — Active Period Revert + Safe Period Cancellation

## 1. Kết luận

**CRM-KPI-R3.1 FULL PASS — SAFE PERIOD REVERT/CANCEL LIVE AND CRM REOPENED.** Production đã hỗ trợ `ACTIVE → DRAFT` khi runtime bằng 0, xóa an toàn kỳ `DRAFT`, và `ACTIVE → CANCELLED` cho Owner/Admin khi kỳ đã có runtime. Smoke production cho revert/delete đã PASS; cancel-used đã PASS integration và được hoãn mutation production vì không có fixture runtime an toàn.

## 2. Starting baseline

- Production Supabase: `jjeeazwlqcwynzquimeo`.
- Production domain: `https://crmkolor.vercel.app/`.
- Kỳ business: `53a130ba-b0ac-4a76-9a54-7bb7b06b809b`, `09/2026`, `ACTIVE`, version `20`.
- Canonical baseline: 8 definitions, 4 assignments, 0 submissions, 0 events, 0 evidence.
- Legacy baseline: 8 `kpi_rules`, 113 `kpi_proposals`.

## 3. Current period lifecycle audit

`kpi_periods.status` dùng `text + CHECK`. R3 trước có `DRAFT`, `ACTIVE`, `CLOSED`; version là optimistic lock. Assignments là cấu hình period-scoped, còn definitions dùng chung. Kỳ business production không được dùng cho smoke phá hủy.

## 4. Runtime dependency definition

RPC `crm_kpi_period_runtime_dependencies(uuid)` là authority phía server. Nó đếm submissions, events, evidence, review state, duplicate matches và action requests liên quan assignment. Assignment không được tính là runtime execution.

## 5. ACTIVE→DRAFT design

`crm_kpi_revert_active_period_to_draft(uuid, integer, text)` xác thực Manager/Owner/Admin, khóa period và assignments, kiểm tra version, tính lại dependency trong transaction, yêu cầu reason, từ chối khi runtime khác 0, tăng version và giữ nguyên assignments/targets/options.

## 6. DRAFT delete design

`crm_kpi_delete_draft_period(uuid, integer, text)` chỉ nhận kỳ `DRAFT` có runtime bằng 0. RPC khóa dữ liệu, ghi audit trước, xóa rõ ràng assignments rồi period. Không xóa shared definitions.

## 7. ACTIVE used cancellation design

`crm_kpi_cancel_active_period(uuid, integer, text)` chỉ cho Owner/Admin, yêu cầu `ACTIVE`, runtime lớn hơn 0, version đúng và reason hợp lệ. RPC ghi `CANCELLED`, `cancelled_at`, `cancelled_by_user_id`, `cancel_reason`; toàn bộ runtime/config được giữ nguyên.

## 8. Role governance

- Manager/Owner/Admin: revert kỳ ACTIVE chưa dùng và xóa kỳ DRAFT chưa dùng.
- Owner/Admin: hủy toàn bộ kỳ ACTIVE đã dùng.
- Sale: không có quyền cấu hình lifecycle.
- Smoke chỉ dùng Owner `hoathienbang87@gmail.com` và test account `devil8xonline@gmail.com`.

## 9. Audit design

Các event mới: `PERIOD_REVERTED_TO_DRAFT`, `PERIOD_DELETED_DRAFT`, `PERIOD_CANCELLED`. Payload chứa actor/role do audit infrastructure ghi, reason, before/after, version và dependency counts.

## 10. CANCELLED scoring semantics

`crm_kpi_get_monthly_scores` chỉ tính kỳ `ACTIVE`/`CLOSED`. `CANCELLED` không đóng góp vào điểm KPI hiện hành và không sửa số liệu lịch sử thành 0.

## 11. Submission/review freeze

Trigger `crm_kpi_guard_runtime_period_active()` khóa period `FOR SHARE` và chặn insert/update/delete trên submissions, events, evidence nếu period không còn `ACTIVE`. Vì vậy submission mới, revision, review và evidence mutation đều fail-closed sau cancel.

## 12. History UX

History có thể đọc progress của kỳ `CANCELLED`, hiển thị `ĐÃ HỦY`, reason, thời gian và actor. Review controls bị ẩn khi kỳ `CANCELLED`/`CLOSED`.

## 13. Status constraint/type change

CHECK mới cho phép `DRAFT`, `ACTIVE`, `CLOSED`, `CANCELLED`. Lifecycle-shape CHECK buộc metadata cancel đầy đủ cho `CANCELLED` và rỗng ở các trạng thái khác.

## 14. Concurrency design

Bốn race chạy trên PostgreSQL production trong maintenance và dùng fixture riêng:

- Revert khóa trước: period thành DRAFT, submission đồng thời bị chặn `55000`.
- Submission commit trước: revert bị chặn vì runtime khác 0.
- Cancel khóa trước: cancel thành công, submission mới bị chặn `55000`.
- Delete khóa trước: assignment đồng thời bị chặn bởi FK, không có orphan.

Toàn bộ race fixtures và audit test đã được dọn; read-back còn 0 row test.

## 15. Migration artifact/hash

- Artifact: `supabase-phase-kpi-r31-period-lifecycle.sql`.
- SHA256: `b0f81e84f241e2e10eebd2624a8c03cdf67788a741ee74f3f06daacbea3e9dbd`.

## 16. Local/static/integration tests

- `node scripts/test-phase-kpi-r31.mjs`: PASS.
- `node scripts/test-phase-kpi-r31-integration.mjs`: PASS.
- Production transaction rollback integration: PASS cho revert/delete/cancel, roles, freeze, score, history và audit.
- `node scripts/test-phase-kpi-r3.mjs`: PASS, 53 checks.
- `node --check js/features/crm-app.js`: PASS.

## 17. Maintenance ON

Trước mutation backend, deployment `dpl_6NoqQsfBdid5tBDDrcRZYWCvWHa5` bật maintenance. Read-back `maintenance.generated.js` trả `enabled: true` và UI hiển thị màn bảo trì.

## 18. Production backend rollout

Migration được dry-run trong transaction rollback, sau đó áp dụng đúng artifact bằng `supabase db query --linked --file`.

## 19. Production read-back

Read-back xác nhận 3 cột cancel, hai CHECK constraints, 7 function signatures/bodies và 3 runtime-freeze triggers. Kỳ business vẫn `ACTIVE`, version `20`.

## 20. Frontend implementation

UI có các action rõ ràng `Đưa về DRAFT`, `Xóa kỳ`, `Hủy kỳ KPI`; drawer hiển thị warning, dependency counts và ô reason bắt buộc. Luồng kích hoạt cũng được chuyển khỏi browser `confirm()` sang drawer nội bộ để tương thích in-app browser.

## 21. Test period

Đã tạo kỳ `KPI TEST R3.1 PERIOD LIFECYCLE`, tháng `06/2098`, dùng shared definition `CUSTOMER_CARE`, chỉ gán test account, target `7`, `score_enabled = true`.

## 22. Manager revert smoke

PASS. Manager `devil8xonline@gmail.com` thấy runtime bằng 0 và thực hiện `ACTIVE v3 → DRAFT v4` với reason `Kiểm thử đưa kỳ ACTIVE chưa có dữ liệu về DRAFT.` Assignment, target `7` và score option còn nguyên.

## 23. DRAFT delete smoke

PASS. Manager xóa kỳ với reason `Dọn kỳ KPI test R3.1 sau smoke.` Read-back: test period count `0`, test assignment đã bị xóa, shared definition vẫn còn.

## 24. Owner cancel smoke/status

`REAL CANCEL-USED PRODUCTION SMOKE DEFERRED — NO SAFE FIXTURE`. Không tạo submission/evidence giả trên production. Owner cancel đã PASS integration, production function read-back PASS, warning/action gating đã được triển khai.

## 25. Current business period integrity

Sau smoke: period `53a130ba-b0ac-4a76-9a54-7bb7b06b809b` vẫn `ACTIVE`, version `20`, `updated_at` không đổi, 4 assignments và toàn bộ runtime counts bằng 0. Tổng canonical trở lại đúng 8 definitions/4 assignments/0 runtime.

## 26. Real-user data integrity

Không sửa assignments hoặc auth mapping của Băng Tâm, Hoài Châu, Mỹ Trâm hay người dùng thật khác. Chỉ test account đổi role có kiểm soát và cuối cùng trở lại `manager`, `active`, lifecycle `active`.

Settings vẫn có 1 row key `crm`, `updated_at = 2026-09-09T09:19:05.524674Z`, `updatedByEmail = hoathienbang87@gmail.com`, không đổi trong R3.1.

> Historical settings drift from the previous smoke cannot be reconstructed field-by-field because a pre-change field snapshot was not captured. The current production settings state was accepted by the owner as the new controlled baseline. All subsequent smoke changes were compared against this baseline.

## 27. Git commit

- `962b16a feat(kpi): add safe period lifecycle controls`
- `27eff53 fix(kpi): confirm period activation inline`

## 28. Vercel deployment

Deployment production cuối: `dpl_FwWAfeZ2HgLsj2yHuN4bM6r7iG8W`, alias `https://crmkolor.vercel.app/`.

## 29. Maintenance final state

`maintenance.generated.js` read-back: `enabled: false`. CRM đang OPEN.

## 30. Remaining limitations

Không thực hiện cancel-used mutation trên production vì không có fixture runtime dành riêng và Owner không cho phép tạo runtime giả chỉ để test. Coverage thay thế gồm local integration, production rollback integration, race tests và production function/trigger read-back.

## 31. Final recommendation

Giữ R3.1 ở trạng thái live. Khi có một kỳ test runtime chuyên dụng trong tương lai, có thể bổ sung Owner cancel UI smoke; việc này không chặn vận hành hiện tại.
