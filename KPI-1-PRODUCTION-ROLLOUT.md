# KPI-1 Production Rollout

Ngày triển khai: 2026-08-11  
Production Supabase: `jjeeazwlqcwynzquimeo`  
Staging Supabase: `ykhtpvyelpujykheycsv`  
Production domain: `https://crmkolor.vercel.app/`

## 1. Kết luận

**GO LIVE.** KPI-1 foundation đã được triển khai lên production theo thứ tự database trước, frontend sau. Migration, RLS/RPC, kiểm thử role, kiểm thử giao diện, cleanup fixture và integrity cuối đều PASS.

Phạm vi chỉ gồm `kpi_periods`, `kpi_definitions`, `kpi_assignments`, RPC/RLS KPI-1 và giao diện cấu hình KPI foundation cho Manager/Admin. Không bắt đầu KPI-2 và không migrate dữ liệu KPI legacy.

## 2. Backup verification

Backup đã xác minh tại:

`D:\SUPABASE\BACKUPS\CRM-KOLORCERAMIC-2026-08-10-0301-PRE-UPGRADE`

| Thành phần | Kết quả |
|---|---|
| `roles.sql` | PASS, 5.643 bytes, checksum đúng |
| `schema.sql` | PASS, 293.203 bytes, checksum đúng |
| `data.sql` | PASS, 2.434.929 bytes, checksum đúng |
| Storage `kpi-evidence` | PASS, 66/66 object, 42.767.879 bytes, 0 checksum failure |

Backup không nằm trong Git repository và không bị sửa trong rollout.

## 3. Commit và source hash

Commit ứng dụng KPI-1:

`60d77d2717796658836d2fd283c5bbb5eaaa54d2`

Commit message: `feat: add KPI-1 monthly foundation`

Migration source:

`supabase-phase-kpi1-foundation.sql`

SHA256 đã tính lại và khớp source đã staging PASS:

`D7610CD60E364C769E4226CFFFAEA08726A884C894795B3FA716EB8E87A03B0E`

## 4. Production identity

Production được xác minh bằng project ref trong workspace production và endpoint Supabase runtime: `jjeeazwlqcwynzquimeo`.

Frontend production cũng được kiểm tra đang dùng ref này, không dùng staging ref `ykhtpvyelpujykheycsv`. Vercel CLI không được dùng vì session CLI thuộc account khác với pipeline đã xác minh. Deployment sử dụng GitHub integration của đúng repository:

`https://github.com/hoathienbang87-beep/CRM-KOLORCERAMIC.git`

## 5. Final dry-run

Dry-run trên workspace production PASS và chỉ nhận đúng một migration:

`20260811090000_kpi1_foundation_consolidated.sql`

Không có seed, role file, migration khác hoặc cảnh báo destructive. Bản copy migration tạm ngoài repo có cùng SHA256 và đã được xóa sau rollout.

## 6. Migration result

Migration consolidated KPI-1 đã COMMIT thành công trên production.

Lần gọi đầu bị PowerShell hiểu PostgreSQL `NOTICE` từ `DROP TRIGGER IF EXISTS` là lỗi terminal. Inventory read-only ngay sau đó xác nhận transaction đã rollback hoàn toàn và không có object KPI-1 dở dang. Wrapper ngoài repo được chỉnh để quyết định bằng exit code của `psql`, sau đó chạy lại đúng source/hash không đổi và PASS.

Không sửa SQL production ad-hoc, không repair migration history và không chạy chuỗi reconcile migrations của staging.

## 7. Database inventory

Ba bảng mới tồn tại và bật RLS:

- `kpi_periods`
- `kpi_definitions`
- `kpi_assignments`

Inventory xác nhận constraint, index, trigger, policy, grant và 21 hàm `crm_kpi_*` đúng source. Các business RPC dùng `SECURITY DEFINER`, owner `postgres` và khóa `search_path=public`.

Role `authenticated` chỉ có quyền đọc theo RLS, không có direct DML. Ba direct-write guard trigger đang hoạt động. PostgreSQL/service role giữ quyền quản trị theo thiết kế.

## 8. RLS/RPC smoke

PostgreSQL integration harness chạy trong outer transaction và kết thúc bằng `ROLLBACK`: PASS.

REST/Auth/RLS/concurrency smoke: **23/23 PASS**, gồm:

- Sale không tạo được period và không direct insert assignment.
- Manager tạo DRAFT, definition, assignment và target hợp lệ.
- Target bằng 0 và duplicate month bị chặn.
- Sale không đọc DRAFT, definition catalog hoặc assignment của sale khác.
- Duplicate assign đồng thời chỉ có một winner và một row.
- Target edit/activate được serialize, không partial write.
- Anonymous không gọi được business RPC.
- Close/activate/version conflict fail-closed đúng thiết kế.

## 9. Audit evidence

Audit lifecycle cho period, definition và assignment được ghi đúng actor/entity/action trong cùng transaction nghiệp vụ. Ba audit fixture append-only được giữ theo thiết kế immutable; không có audit orphan hoặc missing entity ID trong kiểm thử.

## 10. Fixture cleanup

Sau API, integration và UI smoke:

| Fixture | Còn lại |
|---|---:|
| KPI-1 test periods | 0 |
| KPI-1 test definitions | 0 |
| KPI-1 test assignments | 0 |
| Test app user profiles | 0 |
| Test Auth users | 0 |
| Retained immutable audit entries | 3 |

Không có KPI business thật được tạo trong rollout.

## 11. Legacy KPI regression

Legacy không bị alter/drop/migrate:

- `kpi_rules`: 8 rows, không đổi.
- `kpi_proposals`: 102 rows, không đổi.
- Các legacy RPC `crm_submit_kpi_proposal`, `crm_review_kpi_proposal`, `crm_archive_kpi_proposal` vẫn tồn tại.
- Sale vẫn thấy KPI cá nhân và danh sách đề xuất legacy.

## 12. Frontend deploy

Sau khi database GO gate PASS, commit `60d77d2...` được push lên đúng `origin/main`.

GitHub deployment status:

- Context: `Vercel`
- State: `success`
- Production URL: `https://crmkolor.vercel.app/`
- HTTP production: `200 OK`
- Cache policy: `no-store`

Domain `crmkolorceramic.vercel.app` trả 404 và không phải production domain của dự án này.

## 13. Manager UI smoke

Manager đăng nhập production thành công. Các kiểm tra PASS:

- KPI cá nhân/legacy vẫn tải.
- Panel `Kỳ KPI mới` hiển thị.
- Panel cấu hình `KPI hiện tại (legacy)` hiển thị.
- Manager không thấy nút/khu Quản trị dành riêng Admin.
- Màn Khách hàng tải bình thường.

Luồng tạo DRAFT, definition, matrix, target, preview và activate đã được chứng minh bằng API/RPC production smoke để tránh tạo KPI business thật qua UI.

## 14. Sale regression

Sale production smoke PASS:

- Đăng nhập thành công.
- KPI cá nhân và đề xuất legacy hiển thị.
- Không thấy KPI foundation/config của Manager.
- Không thấy definition catalog hoặc assignment sale khác theo RLS/API test.
- Màn Khách hàng tải bình thường; không submit proposal hoặc ghi customer/care thật.

## 15. Admin/Owner regression

Admin production smoke PASS:

- Đăng nhập và đọc KPI foundation đúng role.
- Thấy khu Quản trị.
- Manager không được nâng thành quyền Admin qua UI.
- P0-B employee/customer assignment integrity vẫn PASS.
- Không thay đổi Settings hoặc dữ liệu công ty trong smoke test.

## 16. Production integrity

Read-only integrity cuối sau cleanup:

| Check | Kết quả |
|---|---:|
| Duplicate periods | 0 |
| Duplicate assignments | 0 |
| Target `<= 0` | 0 |
| Orphan period FK | 0 |
| Orphan definition FK | 0 |
| Orphan employee FK | 0 |
| Invalid DRAFT employee assignment | 0 |
| P0-B duplicate current assignments | 0 |
| P0-B orphan customer assignments | 0 |
| P0-B orphan employee assignments | 0 |
| Duplicate normalized app-user email | 0 |
| Active/lifecycle mismatch | 0 |

## 17. Monitoring

Production UI smoke theo ba role không phát hiện page error hoặc HTTP 5xx. Vercel deployment hoàn tất và domain trả đúng HTML có cả nhãn `KPI hiện tại (legacy)` và `Kỳ KPI mới`.

Không có dấu hiệu RLS/RPC error trong các harness production. Cần tiếp tục theo dõi Vercel/Supabase logs và phản hồi Manager trong thời gian vận hành thực tế, nhưng không bắt đầu KPI-2 trong rollout này.

## 18. Git và deployed commit

Application commit đã deploy:

`60d77d2717796658836d2fd283c5bbb5eaaa54d2`

Tại thời điểm hoàn tất kiểm thử ứng dụng, local HEAD và `origin/main` cùng trỏ commit trên, working tree sạch. Báo cáo này được commit riêng sau rollout; commit báo cáo không thay đổi runtime KPI-1.

## 19. Rollback point

Rollback source/frontend gần nhất trước KPI-1:

`2e723ec19f3a99dde5de14fdacda09d5b91ab1e0`

Rollback database không được thực hiện bằng cách sửa migration history hoặc chạy DROP ad-hoc. Nếu cần rollback khẩn cấp:

1. Rollback frontend về commit trên để ẩn UI foundation.
2. Giữ nguyên các bảng additive để tránh mất dữ liệu.
3. Chỉ tạo migration rollback mới, được review và thử staging, nếu bắt buộc phải thu hồi grant/RPC/object.
4. Dùng backup đã xác minh nếu phát sinh sự cố dữ liệu nghiêm trọng.

## 20. Remaining backlog

- Chờ owner/Manager kiểm tra production và nhập KPI nghiệp vụ thật khi sẵn sàng.
- Chưa bắt đầu KPI-2.
- Chưa migrate `kpi_rules`, `kpi_proposals` hoặc evidence legacy.
- Chưa tạo submission/review/result model mới.
- Chưa làm AUTO/HYBRID metric engine.
- Không sửa `crm_json_timestamptz`.
- Không repair migration history.

Sau báo cáo này, rollout dừng tại KPI-1 foundation.
