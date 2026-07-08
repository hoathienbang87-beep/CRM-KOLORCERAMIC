# Giai đoạn F - Rà database/RLS sau khi rút về CRM thuần

Ngày thực hiện: 2026-07-08

## Mục tiêu

Dự án hiện được rút về CRM thuần, không còn là ERP/CMS. Vì vậy database và RLS cần được nhìn lại theo hướng:

- Giữ khách hàng, chăm sóc, lịch hẹn, KPI, nhân viên, báo cáo.
- Giữ `deals` ở mức "mua căn bản" để đánh giá giá trị khách hàng.
- Không vận hành sản phẩm, kho, báo giá, thanh toán, CMS website.
- Không xóa dữ liệu cũ khi chưa backup và chưa chốt phương án lưu trữ.

## Bảng CRM đang dùng chính

Các bảng này vẫn thuộc phạm vi vận hành:

- `app_users`: user, role, active, thông tin nhân viên.
- `settings`: dropdown CRM, trạng thái chăm sóc, kênh chi tiết, KPI labels.
- `company_settings`: cấu hình công ty dùng trong admin CRM.
- `customers`: hồ sơ khách hàng.
- `care_logs`: lịch sử chăm sóc/timeline.
- `deals`: mua căn bản, số lần mua/cọc/hủy và giá trị căn bản.
- `kpi_rules`: rule KPI.
- `kpi_proposals`: đề xuất KPI và minh chứng.
- `phone_index`: hỗ trợ kiểm tra/trùng số.
- `audit_logs`: nhật ký thao tác.
- `user_sessions`: ai đang truy cập.

## Bảng ngoài phạm vi CRM thuần

Các bảng này từng phục vụ ERP/CMS, hiện không nên dùng trong vận hành hằng ngày:

- `products`
- `quotes`
- `quote_items`
- `order_items`
- `payments`
- `inventory_movements`
- `website_pages`
- `website_sections`
- view `product_inventory_balance`

Khuyến nghị hiện tại: giữ làm dữ liệu lịch sử/archive, không cho sale/manager thao tác.

## File SQL mới

Đã tạo file:

`supabase-phase-f-crm-rls-cleanup.sql`

File này làm các việc chính:

- Chuẩn hóa helper role: `owner/admin/manager/sale`.
- Cho `owner/admin` được xem khu quản trị đúng nghĩa.
- Giữ quyền vận hành cho các bảng CRM chính.
- Chuyển bảng ERP/CMS cũ sang archive read-only cho `owner/admin`.
- Không xóa bảng.
- Không xóa dữ liệu.
- Bảng legacy nào chưa tồn tại thì tự bỏ qua, không làm SQL chết giữa chừng.

## Trước khi chạy SQL

Bắt buộc làm:

1. Backup Supabase database.
2. Commit code hiện tại.
3. Test local bản mới đã không còn dùng các màn ERP/CMS.
4. Không commit `.env`, database password, service role key, file backup lên GitHub.

## Sau khi chạy SQL cần test

Test bằng 3 vai trò:

- `admin/owner`
- `manager`
- `sale`

Checklist nhanh:

- Sale đăng nhập được.
- Sale chỉ thấy khách của mình.
- Sale thêm khách được.
- Sale chăm sóc khách được.
- Sale đề xuất KPI được.
- Manager thấy dữ liệu team/toàn bộ theo quyền hiện tại.
- Admin quản lý user/settings được.
- Tab CRM, Khách hàng, KPI, Báo cáo không báo lỗi.
- Không còn lỗi quyền liên quan `products`, `quotes`, `payments`, `inventory_movements`, `website_pages`.

## Việc chưa làm trong Phase F

Chưa drop bảng ERP/CMS cũ. Đây là chủ ý an toàn.

Nếu sau 2-4 tuần sử dụng CRM thuần ổn định, có thể làm Phase F.2:

- Xuất archive các bảng legacy ra file.
- Xác nhận không còn tính năng nào đọc bảng legacy.
- Tạo SQL drop bảng legacy nếu thật sự muốn dọn database.

## Kết luận

Database nên được vận hành theo mô hình:

- CRM active: khách hàng, chăm sóc, KPI, báo cáo.
- CRM history: mua căn bản trong `deals`.
- Legacy archive: ERP/CMS cũ chỉ owner/admin được xem khi cần đối soát.
