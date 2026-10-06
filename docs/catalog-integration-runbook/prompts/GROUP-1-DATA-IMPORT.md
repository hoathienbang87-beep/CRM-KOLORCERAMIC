# Nhóm 1 — Dữ liệu và import

Mọi prompt trong file này phải tuân thủ `../GOVERNANCE.md`.

## 01A — Data contract sản phẩm

Đọc toàn bộ reconciliation, import rules, migration plan, workbook đã duyệt và schema/code sản phẩm hiện tại. Tạo data contract chính thức cho `products`, phân biệt trường công khai/nội bộ, quy tắc ID, kích thước mm, biến thể, giá nullable, trạng thái, ảnh ngoài, quyền và snapshot báo giá. Chưa viết/chạy migration.

PASS khi tài liệu không mâu thuẫn dữ liệu hiện tại, giải thích tương thích 75 sản phẩm Supabase, 406 Firebase, 95 ready, 7 draft và 2 dòng loại.

## 01B — Migration SQL additive

Từ data contract đã duyệt, viết migration theo convention repository. Chỉ additive; bổ sung trường catalog, index, constraint và các bảng `product_import_batches`, `product_import_rows`, `product_price_history`, `website_leads`. Không mở toàn bảng cho anon. Viết kiểm tra tĩnh, chưa chạy SQL.

PASS khi migration có rollback/verification, không destructive và kiểm tra cú pháp đạt.

## 02A — Migration integration

Được phép dùng Supabase local integration bằng Docker. Xác minh toàn bộ URL/host/project ID là local và không phải production `jjeeazwlqcwynzquimeo`; không relink. Backup trạng thái integration rồi chạy migration đã duyệt, read-back schema, rollback/re-apply và compatibility test CRM. Không import catalog, không deploy.

PASS khi local integration hoặc cloud staging đạt đầy đủ migration/schema/rollback/compatibility và production không bị tác động.

## 02B — RLS và RPC integration

Được phép triển khai trên Supabase local integration hoặc cloud staging: public catalog read API, CRM search API, admin import preview/apply/rollback, website lead API và audit. Anon không đọc trực tiếp bảng; sale không sửa catalog; security-definer cố định search path. Viết test vai trò.

PASS khi toàn bộ ma trận quyền đạt, không có fail-open.

## 03A — Parser và matching dry-run

Xây module thuần và test để đọc Excel, merged size, chuẩn hóa Unicode/tên/kích thước/bề mặt/giá. Lưu kích thước mm. Matching đúng thứ tự đã duyệt; fuzzy chỉ gợi ý. Phát hiện duplicate, nhiều giá, nhiều ứng viên và giá trống. Chưa ghi database.

PASS khi test bao phủ `x/X/×`, mm/cm, giá chấm/phẩy, blank, merged cell, surface thiếu và conflict.

## 03B — Import batch, apply và rollback staging

Được phép dùng Supabase local integration như một ngoại lệ kỹ thuật chỉ cho prompt này; phải xác minh local guard và tuyệt đối không dùng production. Kết nối parser với bảng/RPC integration. Dry-run lưu preview; chỉ batch đã duyệt mới apply. Cập nhật giá phải có history. Import danh mục có thể tạo draft; price-only không tạo mới. Apply/rollback idempotent và dùng version guard. Chỉ dùng fixture nhỏ, không nhập workbook thật. Local không thay cloud staging bắt buộc ở 04, 11A hoặc 11B.

PASS khi test apply, retry, rollback, rollback conflict, blank price, duplicate cùng/khác giá và audit đều đạt.

## 04 — Dữ liệu đã duyệt trên staging

Bắt buộc dùng Supabase cloud staging riêng; Supabase local không thay thế gate này. Dùng backup và workbook finalized chạy dry-run. Không mặc định duyệt 359 ứng viên. Phân loại update, draft, manual, duplicate, excluded. Sau báo cáo dry-run an toàn mới nạp thử staging. Kiểm tra 75 ID, ID `SP-...`, 95 ready, 7 draft, 2 excluded và rollback toàn batch.

PASS khi số lượng sau staging được giải thích đầy đủ và rollback khôi phục chính xác.
