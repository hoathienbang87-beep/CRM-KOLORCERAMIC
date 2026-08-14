# KPI-2.1E.1 - September KPI Business Configuration

> **CLOSED AS TEST DATA (14/08/2026):** Owner da xac nhan cac gia tri ben duoi chi dung de test va cho phep xoa. Period, 3 assignments va definition da duoc xoa qua workflow KPI-2.1E.2 co audit. Xem `KPI-2.1E.2-DRAFT-CONFIG-SAFE-DELETE.md`.

Ngày kiểm tra: 14/08/2026. Repository: `D:\SUPABASE\CRM-KOLORCERAMIC`.

## 1. Kết quả cuối

**KPI-2.1E.1 PARTIAL — SEPTEMBER KPI CONFIGURATION AWAITING OWNER BUSINESS INPUT**

Production đã có cấu hình canonical DRAFT do admin nhập qua workflow hỗ trợ. Cấu trúc kỹ thuật đầy đủ cho 3/3 sale, nhưng yêu cầu hiện tại không cung cấp lời phê duyệt rõ ràng cho definition, target và các cờ nghiệp vụ. Codex không tự xác nhận thay owner, không sửa production và không activate period.

## 2. Production baseline

So với cuối KPI-2.1E (`0/0/0`), production đã thay đổi thành:

- Period: 1.
- Definition: 1.
- Assignment: 3.
- Submission/event/evidence: 0/0/0.

Audit cho thấy admin Thiên Di (`hoathienbang87@gmail.com`) tạo period lúc 19:52, definition lúc 19:54 và assignment matrix lúc 19:56 ngày 14/08/2026. Những write này đã tồn tại trước khi Codex bắt đầu thao tác phase 2.1E.1; Codex chỉ đọc và kiểm tra.

## 3. Cutover status

Production ref đúng `jjeeazwlqcwynzquimeo`. DB clock hiện PRE-CUTOVER. Boundary vẫn `2026-09-01 00:00:00 Asia/Ho_Chi_Minh`. Legacy August chưa bị đóng sớm.

Git local và `origin/main` cùng commit `2edc8e4a1295f454fde55bcd9d908c180ceaaa17`. Production domain phục vụ đúng KPI-2.1E; Vercel request ID kiểm tra: `hkg1::46h6x-1786712217755-49e7b18e3f0a`.

## 4. Active Sale roster

| Nhân viên | Email | Employee ID | Role/lifecycle | Assignment tháng 09 |
|---|---|---|---|---:|
| Danh Băng Tâm | `bangtam.danh31@gmail.com` | `2nLbeTz36HevkpPwcp0ewSAXoVX2` | sale/active | 1 |
| Mỹ Trâm | `ttmt1406@gmail.com` | `5f7276eb-804a-4a34-942b-be87ce9cb0ba` | sale/active | 1 |
| Thien Di Tran | `devil8xonline@gmail.com` | `e989e233-2789-44ab-9010-925ba2a31e82` | sale/active | 1 |

Không đưa user inactive/archived vào roster.

## 5. Legacy reference

**LEGACY REFERENCE — DO NOT AUTO-CONVERT**

| Rule legacy | Target chung cũ | Approved | Pending hiện | Rejected |
|---|---:|---:|---:|---:|
| Chăm sóc khách hàng cũ | 10 | 17 | 1 | 9 |
| Đăng video kênh online social | 20 | 0 | 0 | 0 |
| Khai thác công trình | 4 | 3 | 5 | 0 |
| Mời khách hàng về showroom | 2 | 2 | 0 | 0 |
| Số hợp đồng ký kết hợp tác | 1 | 0 | 0 | 0 |
| Tìm Khách Mới | 7 | 7 | 7 | 1 |
| Trưng bày kệ chip cho VP Thiết kế/KTS | 8 | 17 | 3 | 2 |
| VP KTS mới | 7 | 9 | 2 | 1 |

Assigned owner/owner target cũ chỉ được giữ trong inventory read-only. Không giá trị nào trong bảng này được Codex dùng để tạo hoặc sửa canonical.

## 6. Owner business input

Cấu hình hiện hữu được xem là đề xuất cần owner xác nhận:

| KPI canonical đang nhập | Mục đích | Aggregation | Unit | Submission | Evidence/max | Location | Timestamp | Score mặc định | Source/type | Review |
|---|---|---|---|---|---|---|---|---|---|---|
| Chăm sóc khách hàng cũ | Liên hệ/chăm sóc khách cũ | COUNT | lượt | EVENT_CLAIM | Có/1 | Không | Có | Có | HYBRID, không adapter | PENDING OWNER REVIEW |

Owner cần quyết định liệu tháng 09 chỉ có KPI này hay phải tạo thêm KPI khác. Không tự động chuyển 7 rule legacy còn lại.

## 7. September period

- ID: `cecedb1f-bb9e-4296-a272-b69b9be82e2b`.
- Tên: KPI tháng 09/2026.
- Status: `DRAFT`.
- Timezone: Asia/Ho_Chi_Minh.
- Không duplicate period và chưa activate.

## 8. Canonical definitions

Có một definition ID `d29b1ec3-df5d-4b3e-99a7-95e14f92dc61`, code `CSKH`, version 1. Definition đang active nhưng trạng thái business review là `PENDING OWNER REVIEW`.

## 9. Employee assignments

Có 3 assignment, đúng 3 sale active. Mapping ID đầy đủ nằm trong manifest. Không có sale zero-KPI.

## 10. Targets

- Danh Băng Tâm: 10.
- Mỹ Trâm: 5.
- Thien Di Tran: 5.

Tất cả target > 0 và hợp lệ kỹ thuật, nhưng vẫn cần owner xác nhận business.

## 11. score_enabled

Cả 3 assignment hiện là `true`. Không có sales/order/revenue KPI. Cờ này đã được lưu rõ ràng nhưng chưa được Codex coi là owner-approved.

## 12. Evidence/location/timestamp

Evidence bắt buộc, tối đa 1 ảnh; timestamp bắt buộc; location không bắt buộc. Canonical evidence tiếp tục dùng bucket private `kpi2-evidence`, không dùng `kpi-evidence` legacy.

## 13. Source modes

Definition khai `HYBRID`, `source_metric_key=null`, submission `EVENT_CLAIM`. Không adapter tự động nào được bật. Owner cần xác nhận đây là lựa chọn có chủ ý hay muốn chuyển sang `MANUAL` qua UI hiện có.

## 14. Zero-KPI employees

0/3 sale active có zero assignment. Quyết định assignment đã có cho toàn bộ roster, nhưng chưa có xác nhận liệu mỗi sale chỉ cần một KPI này.

## 15. Duplicate check

Duplicate group theo `(period_id, definition_id, employee_id)` bằng 0. Unique backend vẫn là authority.

## 16. DRAFT lifecycle

Period vẫn DRAFT, `activated_at` và `activated_by_user_id` đều null. Không có lifecycle transition ngoài create/configure.

## 17. UI verification

Staging employee-centric UI PASS 12 checks: default employee list, assigned/zero-KPI render, assignment persistence, grouping, history snapshot, mobile drawer và không có browser error. Production không tạo test user/event để kiểm tra UI; cấu hình hiện hữu dùng đúng schema/RPC mà UI này đọc.

## 18. Sale visibility behavior

KPI-1 contract hiện tại không cho sale đọc period DRAFT. Đây là hành vi fail-closed hợp lệ; không nới RLS chỉ để preview. Sau activation đúng ngày, sale mới thấy KPI theo lifecycle hỗ trợ.

## 19. Staging rehearsal

Staging sample September PASS 10 checks:

- Tạo period 09/2026 DRAFT.
- Tạo definition canonical.
- Gán sale và lưu snapshot.
- Cập nhật `score_enabled=false` rõ ràng.
- Period vẫn DRAFT.
- Không duplicate, submission hoặc event.
- Fixture cleanup hoàn tất.

## 20. Production writes

Codex thực hiện **0 production write** trong phase này. Không migration, RLS, Auth, customer, employee, legacy, event hoặc evidence write. Dữ liệu 1/1/3 là cấu hình admin đã nhập trước audit phase.

## 21. Canonical IDs

Period, definition và ba assignment ID được ghi đầy đủ tại `KPI-2-SEPTEMBER-2026-CONFIGURATION-MANIFEST.md`.

## 22. Configuration manifest

Manifest chứa period, definition, mapping employee, target, score, evidence rules, timestamps, operator và checklist review. Không chứa secret.

## 23. Legacy integrity

Sau kiểm tra vẫn 8 rules, 102 proposals và 18 pending hiển thị. Không status legacy hoặc evidence object nào bị thay đổi/di chuyển/xóa.

## 24. Canonical zero-event check

September có 0 submission, 0 event và 0 evidence. Không fake progress/score được tạo. Snapshot assignment đầy đủ 3/3.

## 25. Role/RLS sanity

Manager/admin có workflow configuration; sale không được sửa definition/assignment và không đọc DRAFT theo contract. Không thay RLS. Staging role tests và P0/KPI regressions giữ nguyên.

## 26. Regression tests

PASS: staging September rehearsal 10, KPI-2.1B UI 12. Static gates P0-A, P0-B, Identity, KPI-1, KPI-2, KPI-2R.2, KPI-2.1B và KPI-2.1E được chạy lại trong phase; syntax, duplicate ID, secret scan và diff check phải PASS trước khi chốt.

## 27. Owner review status

Period, definition và cả ba assignments đều `PENDING OWNER REVIEW`. Người tạo là admin Thiên Di, nhưng không có trường/phát biểu business approval riêng để Codex tự nâng thành APPROVED.

## 28. September readiness

Kỹ thuật đã đủ: 1 DRAFT period, 1 definition, 3/3 sale assigned, target hợp lệ, score/evidence explicit, không duplicate/event. Business gate chưa đủ vì owner chưa xác nhận cấu hình hiện tại là cấu hình cuối.

## 29. Runbook 01/09 đã cập nhật

Thông số cần dùng ngày cutover:

- Period ID: `cecedb1f-bb9e-4296-a272-b69b9be82e2b`.
- Active sale: 3.
- Definition dự kiến: 1.
- Assignment: 3.
- Score-enabled hiện tại: 3.
- Legacy pending hiện tại: 18.

Chỉ activate nếu checklist owner đã hoàn tất và thời gian >= `2026-09-01 00:00 +07:00`.

## 30. Rủi ro còn lại

- Chỉ có một KPI canonical; có thể chưa phản ánh đủ nhu cầu tháng 09.
- Target `10/5/5` chưa có xác nhận bằng lời trong phase.
- `HYBRID` không có source adapter cần làm rõ.
- Cả ba KPI đều tính điểm; cần xác nhận không có assignment reference-only.
- Legacy evidence bucket public là rủi ro của KPI-2.1F, không xử lý ở đây.

## 31. Khuyến nghị cuối

Owner trả lời checklist trong manifest, đặc biệt xác nhận definition duy nhất, target `10/5/5`, ba cờ score và mode `HYBRID`/manual event. Không activate trước 01/09. Sau khi owner xác nhận, chỉ cần read-back production và đổi trạng thái review tài liệu; không cần migration hoặc deploy frontend.
