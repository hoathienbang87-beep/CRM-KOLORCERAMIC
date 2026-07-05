# Giai đoạn 4.13 - Sao lưu, phục hồi và an toàn dữ liệu vận hành

## Mục tiêu

CRM đang có dữ liệu thật nên trước mọi thao tác lớn như import CSV, dọn dữ liệu, xóa mềm hàng loạt, sửa SQL/RLS hoặc đổi cấu trúc bảng, cần có quy trình backup rõ ràng.

Trong app đã thêm mục **Quản trị > An toàn dữ liệu > Xuất snapshot vận hành**. File này dùng để xem nhanh bằng Excel và đối chiếu sau thay đổi. Nó không thay thế backup database thật bằng Supabase CLI.

## Dữ liệu quan trọng cần backup

Các bảng nên có trong backup đầy đủ:

- `app_users`: nhân viên, vai trò, trạng thái hoạt động.
- `customers`: khách hàng.
- `care_logs`: lịch sử chăm sóc.
- `deals`: đơn hàng / deal.
- `order_items`: sản phẩm trong đơn.
- `payments`: thanh toán / công nợ.
- `products`: sản phẩm.
- `quotes`, `quote_items`: báo giá / đề xuất.
- `tasks`: lịch hẹn / công việc nếu đang dùng.
- `kpi_rules`, `kpi_proposals`: KPI và đề xuất KPI.
- `audit_logs`: nhật ký thao tác.
- `settings`, `phone_index`, `inventory_movements`: cấu hình, chống trùng SĐT, nhập xuất kho.

App hiện có dùng Supabase Storage bucket `kpi-evidence` để lưu ảnh minh chứng KPI. Khi backup vận hành thật, cần backup thêm bucket này. Không nên chỉ backup database mà quên file upload.

## Quy trình backup khuyến nghị trên Windows PowerShell

Tạo thư mục backup theo ngày:

```powershell
$stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$backupDir = "D:\SUPABASE\CRM-KOLORCERAMIC\backups\$stamp"
New-Item -ItemType Directory -Force -Path $backupDir
```

Dump database bằng Supabase CLI. Không ghi mật khẩu thật vào file trong repo:

```powershell
$env:SUPABASE_DB_URL = "postgresql://postgres.PROJECT_REF:YOUR_DATABASE_PASSWORD@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"
supabase db dump --db-url $env:SUPABASE_DB_URL -f "$backupDir\schema-and-data.sql"
```

Nếu muốn tách riêng schema và data:

```powershell
supabase db dump --db-url $env:SUPABASE_DB_URL -f "$backupDir\schema-only.sql" --schema-only
supabase db dump --db-url $env:SUPABASE_DB_URL -f "$backupDir\data-only.sql" --data-only
```

Kiểm tra file backup có tồn tại và có dung lượng hợp lý:

```powershell
Get-ChildItem $backupDir | Select-Object Name, Length, LastWriteTime
```

File backup thật thường phải có dung lượng lớn hơn vài KB. Nếu file quá nhỏ, cần mở kiểm tra hoặc dump lại.

## Snapshot trong app

Admin có thể vào **Quản trị > An toàn dữ liệu** và bấm **Xuất snapshot vận hành** trước/sau khi thao tác lớn.

Snapshot xuất ra nhiều sheet:

- Tổng quan.
- Customers.
- CareLogs.
- Deals.
- OrderItems.
- Payments.
- Inventory.
- Products.
- Quotes.
- QuoteItems.
- KpiRules.
- KpiProposals.
- Users.
- AuditLogs.

Snapshot giúp trả lời nhanh các câu như:

- Trước khi import có bao nhiêu khách?
- Sau khi dọn dữ liệu có mất đơn/deal không?
- KPI proposal còn bao nhiêu dòng?
- Có thay đổi bất thường ở user hoặc audit log không?

## Phục hồi dữ liệu

Không restore trực tiếp vào production nếu chưa thử trên project Supabase phụ hoặc database staging.

Luồng an toàn:

1. Tạo project Supabase test/staging.
2. Restore file backup vào staging.
3. Mở app trỏ sang staging để kiểm tra đăng nhập, khách hàng, đơn hàng, KPI, báo cáo.
4. Chỉ restore production khi chắc chắn backup đúng và đã chấp nhận thời gian dừng hệ thống.

Ví dụ restore bằng `psql`:

```powershell
$env:SUPABASE_DB_URL = "postgresql://postgres.PROJECT_REF:YOUR_DATABASE_PASSWORD@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"
psql $env:SUPABASE_DB_URL -f "$backupDir\schema-and-data.sql"
```

## Những thứ không được commit lên GitHub

Không commit các thông tin sau:

- `.env`, `.env.local`, `.env.production`.
- Supabase `service_role_key`.
- Database password.
- File backup `.sql`, `.dump`, `.zip` có dữ liệu thật.
- File export Excel chứa dữ liệu khách hàng thật nếu repo public hoặc chia sẻ nhiều người.

Repo đã có `.gitignore`, nhưng vẫn cần kiểm tra `git status` trước khi commit.

## Khi nào cần backup

Nên backup trước các việc sau:

- Chạy SQL mới hoặc sửa RLS.
- Import CSV khách hàng/sản phẩm số lượng lớn.
- Dọn dữ liệu trùng, xóa mềm hàng loạt.
- Sửa cấu trúc bảng hoặc đổi logic quyền.
- Trước khi deploy bản lớn.
- Cuối ngày/cuối tuần nếu CRM đã vận hành thật.
