# CRM-KPI-R3 — Legacy Retirement + ACTIVE Flexibility Smoke

Ngày thực hiện: 2026-09-09/10 (Asia/Saigon)  
Môi trường: production `jjeeazwlqcwynzquimeo` / `https://crmkolor.vercel.app`  
Kết luận: **PASS — CRM được giữ mở**

## Phạm vi và tài khoản

- Owner: `hoathienbang87@gmail.com`.
- Sale/Manager test: `devil8xonline@gmail.com`, đổi role qua UI/RPC canonical.
- Không yêu cầu Hoài Châu hoặc Sale thật khác đăng nhập.
- Chỉ dùng definition `TEST_KPI_R3_SMOKE_20260909` và assignment test tương ứng.
- Assignment test ban đầu trên Hoài Châu được gỡ bằng R3 RPC sau khi xác nhận submissions/events/evidence đều bằng 0.

## Kết quả real-role smoke

### Manager — tạo cấu hình ban đầu

- Shell hiển thị đúng role Manager.
- Tạo definition trong kỳ ACTIVE với lý do bắt buộc: PASS.
- Gán target 7, `score_enabled=true`: PASS.
- UI và DB readback đúng; audit ghi đúng actor, reason và period version.

### Sale — `devil8xonline@gmail.com`

- Login và shell role Sale: PASS.
- KPI cá nhân tải được; KPI test hiển thị: PASS.
- Target 7, progress 0, approved 0, pending 0: PASS.
- Không thấy legacy KPI: PASS.
- KPI Team và KPI Definition bị ẩn; không có quyền tạo definition, gán KPI hoặc sửa target/options: PASS.
- Logout sạch: PASS.

### Manager re-entry

- Login lại với shell role Manager: PASS.
- Sửa target 7 → 5 với lý do `Kiểm thử sửa target trong kỳ ACTIVE.`: PASS.
- Đổi `score_enabled` true → false với lý do `Kiểm thử thay đổi tùy chọn KPI trong kỳ ACTIVE.`: PASS.
- Gỡ assignment với lý do `Dọn assignment test sau smoke R3.`: PASS.
- Server ghi dependency lúc gỡ: submissions 0, events 0, evidence 0.
- Audit `ACTIVE_ASSIGNMENT_TARGET_CHANGED`, `ACTIVE_ASSIGNMENT_OPTIONS_CHANGED`, `ACTIVE_ASSIGNMENT_REMOVED_UNUSED` có before/after, actor Manager và lý do chính xác.

### Owner audit và cleanup

- Login và shell role Owner: PASS.
- Lịch sử kỳ ACTIVE tải được: PASS.
- Definition test được xóa bằng `crm_kpi_delete_unused_definition`: PASS.
- Audit cleanup `definition_delete_unused` ghi actor `hoathienbang87@gmail.com`, role Owner.
- Tài khoản test kết thúc ở role Manager, active/lifecycle active.

## Integrity sau cleanup

| Dữ liệu | Baseline | Sau smoke | Kết quả |
|---|---:|---:|---|
| `kpi_periods` | 1 | 1 | PASS; version/audit timestamps thay đổi đúng nghiệp vụ |
| `kpi_definitions` | 8 | 8 | PASS; fingerprint khớp `9255b482...` |
| `kpi_assignments` | 4 | 4 | PASS; fingerprint khớp `23fa8149...` |
| `kpi_submissions` | 0 | 0 | PASS |
| `kpi_submission_events` | 0 | 0 | PASS |
| `kpi_evidence` | 0 | 0 | PASS |
| legacy `kpi_rules` | 8 | 8 | PASS; fingerprint khớp `0b7a2e53...` |
| legacy `kpi_proposals` | 113 | 113 | PASS; fingerprint khớp `63d261b1...` |

Không có KPI business thật, customer data thật, lifecycle/Auth mapping của Sale thật hoặc dữ liệu legacy bị sửa/xóa.

## Settings gate

Baseline mới được Owner chấp nhận có fingerprint:

`dd7028fbd27e31a41aa9dd520fe96713548c38d47cffe671c9c22e225ecb11c5`

Fingerprint sau Sale, Manager và Owner smoke đều giữ nguyên. Owner auto-migration no-op trước đó chỉ đổi `settings.updated_at`; toàn bộ giá trị `data`/`raw_data` không đổi. Code path gây drift đã được xác định và sửa để mảng mặc định rỗng không kích hoạt write no-op.

Historical settings drift from the previous smoke cannot be reconstructed field-by-field because a pre-change field snapshot was not captured. The current production settings state was accepted by the owner as the new controlled baseline. All subsequent smoke changes were compared against this baseline.

## Forward fixes phát hiện trong smoke

- Gỡ các lời gọi startup legacy còn sót gây `hydrateProposalKpiOptions is not defined`.
- Thay `prompt()` tạo definition ACTIVE bằng ô lý do inline.
- Thay `prompt()` gỡ/ngừng assignment bằng drawer có lý do inline.
- Ngăn Owner settings migration ghi no-op với mảng mặc định rỗng.
- Giữ nhân viên đã có assignment trong KPI Team sau khi đổi role để Manager có thể audit/gỡ assignment mồ côi; khử trùng theo employee ID.
- Thay `confirm()` xóa definition bằng xác nhận hai lần inline trong 8 giây.

## Regression và production state

- R3 static contract: PASS (53 checks).
- R3 integration: PASS (5 ACTIVE audit events, 3 negative guards).
- KPI-2.1B: PASS (25 checks).
- KPI-2.1E.2: PASS (24 checks).
- KPI-2.1E.2R: PASS (26 checks).
- KPI-2R.2: PASS (57 checks).
- JavaScript syntax check: PASS.
- Production deployment cuối: `dpl_4s9eAzKhsfLtGy7a8tVB8DU3Rm4h`.
- `maintenance.generated.js`: `enabled: false`.

Cancel-used production smoke vẫn được hoãn theo quyết định scope; không tạo runtime data giả để kiểm thử nhánh này.
