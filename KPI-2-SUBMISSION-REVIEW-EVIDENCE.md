# KPI-2 - Submission, Event Claims, Evidence, Review & Approved Actual

Ngày hoàn tất staging: 2026-08-12
Repository: `D:\SUPABASE\CRM-KOLORCERAMIC`
Staging: `ykhtpvyelpujykheycsv` (`CRM-KOLORCERAMIC-STAGING`)
Production: `jjeeazwlqcwynzquimeo` - **không thay đổi trong phase này**
Baseline Git: branch `main`, commit `37a802af3c403a01dc3248a9cd0311e7f4bbf878`

## 1. Kết luận

KPI-2 đã triển khai và kiểm thử thành công trên staging. Luồng mới hỗ trợ Sale gửi từng event KPI, đính kèm minh chứng riêng tư, Manager duyệt theo từng event hoặc theo nhóm và chỉ event `APPROVED` mới được cộng vào actual. P0-A, P0-B, KPI-1 và KPI legacy vẫn được giữ nguyên.

Kết luận hiện tại: **STAGING PASS, chưa rollout production**.

## 2. Baseline

- P0-A và P0-B vẫn giữ ownership/employee lifecycle hiện tại.
- KPI-1 vẫn là nền móng kỳ KPI, definition và assignment.
- KPI legacy (`kpi_rules`, `kpi_proposals`) vẫn chạy song song; không migrate, sửa hoặc xóa.
- Không triển khai commission, tiền thưởng, payroll hoặc ERP.
- Không commit, push, deploy frontend hoặc chạy migration production trong KPI-2.

## 3. Schema

KPI-2 thêm bốn bảng:

- `kpi_submissions`: gói Sale gửi, có request ID và lịch sử attempt.
- `kpi_submission_events`: từng business event được claim và review độc lập.
- `kpi_evidence`: metadata ảnh minh chứng private.
- `kpi_action_requests`: idempotency ledger cho submit/revision/review.

KPI-2 mở rộng có tính cộng thêm:

- `kpi_definitions`: `aggregation_mode`, `max_images_per_event`, `location_required`, `timestamp_required`.
- `kpi_assignments`: `score_enabled`.

Không DROP, TRUNCATE, DELETE hoặc ALTER bảng KPI legacy.

## 4. Submission

Một submission chứa một hoặc nhiều event. RPC `crm_kpi_submit_events` thực hiện toàn bộ trong một PostgreSQL transaction:

1. Xác thực Sale active và assignment thuộc Sale.
2. Khóa assignment/kỳ KPI liên quan.
3. Kiểm tra kỳ `ACTIVE` và snapshot definition.
4. Kiểm tra event, dedupe, evidence, vị trí và timestamp.
5. Tạo submission và tất cả event.
6. Gắn evidence từ `STAGED` sang `ATTACHED`.
7. Ghi idempotency response và audit.

Nếu bất kỳ bước nào lỗi, không có dữ liệu dở dang.

## 5. Event Claim

Mỗi event có source type, source ID/key, thời gian, Sale thực hiện, customer nếu có, claimed value, snapshot nghiệp vụ, location snapshot và trạng thái review. Identity dùng `app_users.id`, không dùng email làm khóa nghiệp vụ.

Trạng thái event:

- `PENDING`
- `NEEDS_REVISION`
- `APPROVED`
- `REJECTED`

Event đã final không bị Sale sửa trực tiếp.

## 6. COUNT và SUM

- `COUNT`: mỗi event hợp lệ đóng góp `1`, không tin giá trị tùy ý từ frontend.
- `SUM`: cộng `claimed_value` dương; Manager duyệt thì giá trị trở thành `approved_value`.
- `approved_actual` chỉ cộng `approved_value` của event `APPROVED`.
- Actual completion được phép vượt 100%; scoring completion bị cap ở 100%.

Test staging đã chứng minh COUNT `5/7 = 71.43%`, SUM `70/100` và actual `120%` được cap score thành `100%`.

## 7. score_enabled

`score_enabled` nằm ở assignment theo kỳ và theo Sale.

- `true`: KPI nằm trong mẫu số điểm tháng.
- `false`: actual vẫn hiển thị để tham khảo nhưng không nằm trong mẫu số.

Manager chỉ đổi tùy chọn này khi kỳ còn `DRAFT`. RPC dùng assignment version và period version để chống ghi đè dữ liệu mới hơn.

## 8. HYBRID

HYBRID lấy candidate từ CRM qua adapter có kiểm soát. KPI-2 hiện chứng minh ba adapter tối thiểu:

- `care_logs_v1`
- `customers_v1`
- `deals_v1`

Sale chọn candidate thay vì nhập lại dữ liệu. RPC đọc lại source row, kiểm tra ownership và khoảng thời gian kỳ KPI, rồi tạo snapshot tại server. Metric engine đầy đủ vẫn thuộc KPI-3.

## 9. MANUAL

MANUAL dùng cho hoạt động chưa có source event chuẩn. Sale nhập nội dung, ngày giờ, claimed value nếu SUM, ảnh và vị trí nếu definition yêu cầu. Server kiểm tra hình dạng dữ liệu và không tin snapshot quyền/role do frontend gửi.

## 10. Evidence

Bucket mới: `kpi2-evidence`.

- Private, không dùng public URL.
- Chỉ JPEG/WebP.
- Tối đa 1.5 MB mỗi ảnh sau xử lý.
- Tối đa 0-2 ảnh theo snapshot definition của từng event.
- Metadata lưu bucket/path/hash/size/uploader/status; public URL không phải source of truth.
- Manager xem bằng signed URL ngắn hạn.
- Sale khác và anonymous không đọc metadata hoặc tạo signed URL cho ảnh không thuộc quyền.

## 11. Compression

Frontend tự xử lý ảnh:

- Chặn file gốc trên 20 MB.
- Resize cạnh dài tối đa 1920 px.
- Convert WebP và giảm quality đến khi không quá 1.5 MB.
- Tính SHA-256 sau nén.
- HEIC/HEIF được báo lỗi rõ vì browser hiện tại không có converter an toàn trong scope này.

Người dùng không cần tự dùng phần mềm nén ảnh.

## 12. Location

Location chỉ bắt buộc khi snapshot definition có `location_required=true`. Frontend lấy latitude, longitude, accuracy và thời gian capture; server fail-closed nếu thiếu dữ liệu bắt buộc. Test staging đã xác nhận thiếu location bị từ chối và accuracy được lưu đúng.

Location là bằng chứng hỗ trợ, không được coi là bằng chứng tuyệt đối.

## 13. Duplicate

- Database có unique root-event key theo assignment/source type/source event key.
- Hai tab cùng submit một event: chỉ một transaction thắng.
- Revision có unique `supersedes_event_id`, tránh hai revision song song.
- Cùng source event xuất hiện ở assignment Sale khác được gắn `POSSIBLE_DUPLICATE`; hệ thống không tự reject.
- Manager là người quyết định duplicate nghiệp vụ.

## 14. Review

RPC `crm_kpi_review_events` hỗ trợ:

- `APPROVED`
- `REJECTED`
- `NEEDS_REVISION`

Reason code chuẩn: `DUPLICATE`, `INVALID_EVIDENCE`, `MISSING_LOCATION`, `MISSING_TIMESTAMP`, `INCOMPLETE_INFORMATION`, `NOT_NEW`, `OUT_OF_SCOPE`, `OTHER`. `OTHER` và `NEEDS_REVISION` bắt buộc có ghi chú Manager.

## 15. Bulk Review

Manager có thể chọn tối đa 100 event trong một lần review. RPC khóa row theo thứ tự ổn định, kiểm tra toàn bộ ID/status/version trước khi update. Nếu một event lỗi, toàn bộ batch rollback; không âm thầm bỏ qua row lỗi.

## 16. Approved Actual

Hàm `crm_kpi_get_assignment_progress` trả actual, pending, revision, rejected, phần trăm actual và scoring. Event cũ `NEEDS_REVISION` vẫn giữ lịch sử nhưng không còn là open item sau khi đã có event kế tiếp supersede. Vì vậy revision không làm KPI bị treo mãi ở trạng thái chưa hoàn tất.

Không có lớp “duyệt tổng KPI lần hai” trong KPI-2.

## 17. RLS

- Các bảng KPI-2 bật RLS.
- Client authenticated chỉ có SELECT canonical; direct INSERT/UPDATE/DELETE bị revoke và trigger guard chặn.
- Sale chỉ đọc submission/event của assignment thuộc chính mình trong kỳ `ACTIVE/CLOSED`.
- Manager/admin/owner đọc hàng đợi review theo role hiện tại.
- Evidence metadata và Storage object private theo uploader/manager.
- RPC tự xác thực active user, role, assignment; không tin role do frontend gửi.
- Không dùng service role trong frontend.

## 18. Concurrency

Các điểm tranh chấp được bảo vệ bằng unique constraint, row lock và optimistic version:

- Submit trùng business event.
- Hai Manager review cùng event.
- Bulk review có row thay đổi giữa chừng.
- Hai revision cùng một event.
- Sửa definition/assignment option trên dữ liệu đã đổi version.

Test hai Manager đồng thời cho đúng một winner.

## 19. Idempotency

`kpi_action_requests` lưu response theo `(actor_user_id, action, request_id)`. Retry cùng request ID trả lại kết quả cũ cho:

- submission create
- event revision
- event review

Test staging đã xác nhận submit và review retry không tạo hoặc duyệt trùng.

## 20. Audit

Audit được ghi cùng transaction cho:

- tạo/sửa definition
- đổi score option
- stage/attach evidence
- tạo submission/event
- approve/reject/needs revision
- bulk review
- tạo revision

Payload có actor ID/role/timestamp và before/after khi phù hợp. Test staging xác nhận review action và bulk action có audit.

## 21. UI Sale

Sale thấy:

- Tiến độ actual/target, pending, needs revision và trạng thái “chỉ tham khảo”.
- Nút gửi event cho KPI đang được giao.
- Candidate CRM cho HYBRID/AUTO.
- Form MANUAL, upload/nén ảnh và xin vị trí khi bắt buộc.
- Nút `Bổ sung` cho event `NEEDS_REVISION` chưa có revision.
- Ghi chú Manager khi cần bổ sung.

Nếu RPC lỗi, UI không báo thành công và dữ liệu được tải lại khi cần.

## 22. UI Manager

Manager thấy:

- Actual/pending/revision theo Sale và KPI.
- Hàng đợi event `PENDING` trong khung cuộn.
- Cảnh báo `POSSIBLE_DUPLICATE`.
- Xem ảnh bằng signed URL.
- Chọn nhiều event, decision, reason và ghi chú để bulk review.
- Cấu hình COUNT/SUM, số ảnh, location, timestamp và `score_enabled` khi kỳ còn DRAFT.

## 23. Legacy

KPI legacy vẫn hiển thị và hoạt động song song. KPI-2 không đọc/chuyển/xóa dữ liệu legacy, không sửa `kpi_rules` hoặc `kpi_proposals` và chưa có migration production. Việc chuyển legacy phải là phase riêng có mapping, reconciliation và rollback.

## 24. Tests

Kết quả cuối trên staging:

- P0-A static: PASS 80 checks.
- P0-B static: PASS 72 checks.
- KPI-1 static: PASS 121 checks.
- KPI-2 static: PASS 122 checks.
- KPI-2 API/Auth/RLS/concurrency/evidence: PASS 24 checks.
- KPI-2 UI: PASS, Sale submit và Manager queue/review.
- Duplicate HTML ID: PASS 373 IDs.
- Secret material scan: PASS.
- `node --check`: PASS cho source JS/MJS ngoài vendor.
- `git diff --check`: PASS; chỉ có cảnh báo line-ending LF/CRLF, không có whitespace error.
- Supabase DB lint: không có cảnh báo KPI-2; còn một warning legacy `crm_json_timestamptz` IMMUTABLE/STABLE ngoài scope.
- Staging residue: PASS; không còn test user, period, definition, audit row hoặc Storage object.

## 25. Rủi ro còn lại

- Chưa có full metric engine cho mọi nguồn AUTO/HYBRID.
- Chưa có correction/reversal cho event đã `APPROVED`; kiến trúc giữ lịch sử để KPI-3 bổ sung.
- HEIC/HEIF chưa được convert trực tiếp.
- Storage và PostgreSQL không thể atomic tuyệt đối; staged upload cần job dọn TTL trong phase vận hành tiếp theo.
- UI hàng đợi hiện giới hạn 500 event mỗi lần đọc; production lớn cần server pagination/filter.
- Warning legacy `crm_json_timestamptz` cần audit riêng, không nên sửa chen vào KPI-2.

## 26. KPI-3

KPI-3 nên tập trung vào:

1. Metric resolver chuẩn cho care/customer/showroom/purchase và các nguồn CRM thật.
2. Period close/final score rõ ràng khi còn pending/revision.
3. Correction/reversal append-only cho approved event.
4. Staged evidence TTL cleanup và monitoring.
5. Server pagination/filter cho review queue.
6. Reconciliation báo cáo giữa source CRM, claim và approved actual.

Không bắt đầu KPI-3 trước khi KPI-2 production readiness audit được duyệt.

## 27. Production Rollout Safety

**DO NOT RUN IN PRODUCTION:** năm migration staging ban đầu, reconcile chain và remediation chain chỉ còn giá trị development/audit history và test input.

Production artifact duy nhất:

- File: `supabase-phase-kpi2-final-consolidated.sql`
- SHA256: `eb33f45534d96f335f494d12ba67b884d96360be5e03020092682945efdf0236`

Nguyên tắc bắt buộc:

1. Production migration history hiện không canonical; không dùng automatic `db push` làm source of truth và không repair migration history tự động.
2. Chỉ chạy reviewed one-off consolidated SQL theo `KPI-2-PRODUCTION-RUNBOOK.md`.
3. Tạo fresh database/Storage backup và checksums ngay trước rollout.
4. DB và private Storage phải PASS trước; frontend deploy sau.
5. Nếu DB/Storage smoke không PASS thì không deploy frontend.
6. Không dùng `DROP` nóng; giữ additive schema và safe-forward sau staging validation.
7. Runbook chỉ chuẩn bị quy trình, không phải authorization rollout.

Các hash của năm file staging cũ trong báo cáo trước chỉ là bằng chứng lịch sử. Chúng không phải production artifacts và không được chạy trên production.
