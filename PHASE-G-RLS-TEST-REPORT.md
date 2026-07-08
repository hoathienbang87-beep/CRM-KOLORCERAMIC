# Giai đoạn G - Kiểm thử sau SQL Phase F

Ngày thực hiện: 2026-07-08

## Mục tiêu

Kiểm thử để chắc chắn sau khi chạy `supabase-phase-f-crm-rls-cleanup.sql`:

- CRM vẫn dùng được cho admin/manager/sale.
- Sale không bị lỗi quyền khi thêm khách, chăm sóc, đề xuất KPI, ghi nhận mua căn bản.
- Các bảng ERP/CMS cũ không còn là luồng vận hành hằng ngày.
- Không có màn hình hoặc nút chính nào còn cố ghi vào bảng legacy đã bị khóa.

## Kết quả rà code

Đã kiểm tra và phát hiện rủi ro:

- Luồng "mua căn bản" trước đó vẫn ghi thêm vào `order_items`.
- Một số chức năng giao hàng/kho cũ vẫn tồn tại trong code legacy.
- Nếu chạy Phase F mà không chỉnh, sale có thể gặp lỗi quyền khi lưu mua căn bản.

Đã xử lý:

- `saveDeal` chỉ ghi vào bảng `deals`.
- `updateDeal` chỉ cập nhật bảng `deals` và trạng thái khách hàng.
- Không còn ghi `order_items` trong luồng lưu mua căn bản.
- Modal chi tiết mua căn bản không còn hiện nút giao hàng/phiếu giao.
- Wording chuyển từ "đơn hàng" sang "mua căn bản" ở các điểm thao tác chính.

## File kiểm tra SQL

Đã tạo:

`supabase-phase-g-rls-verification.sql`

File này chỉ chạy `SELECT`, dùng để kiểm tra:

- User hiện tại đang có role gì.
- RLS có bật trên bảng chính chưa.
- Bảng ERP/CMS cũ có bị chuyển về archive read-only chưa.
- Policy write trên bảng legacy còn sót không.
- Số dòng cơ bản của các bảng CRM chính.

## Checklist test bằng tài khoản thật

Sau khi chạy `supabase-phase-f-crm-rls-cleanup.sql`, test theo thứ tự:

### 1. Admin / Owner

- Đăng nhập được.
- Vào CRM được.
- Vào Quản trị được.
- Xem danh sách nhân viên được.
- Thêm/sửa/khóa/mở nhân viên được.
- Xem toàn bộ khách hàng được.
- Xem báo cáo được.
- Duyệt/từ chối KPI được.
- Không thấy tab sản phẩm/kho/báo giá/CMS.

### 2. Manager

- Đăng nhập được.
- Xem danh sách khách theo quyền quản lý được.
- Lọc/tìm kiếm khách được.
- Xem báo cáo sale được.
- Xem KPI được.
- Duyệt/từ chối KPI nếu manager đang được phép.
- Không vào được khu admin nếu role không phải owner/admin.
- Không thấy chức năng sản phẩm/kho/báo giá/CMS.

### 3. Sale

- Đăng nhập được.
- Chỉ thấy khách của mình.
- Thêm khách mới được.
- Ghi chăm sóc được.
- Tạo lịch hẹn chăm tiếp được.
- Đề xuất KPI được.
- Sửa/xóa mềm đề xuất KPI đang chờ duyệt được.
- Không sửa được KPI đã duyệt/từ chối.
- Ghi nhận mua căn bản được.
- Không thấy dữ liệu khách của sale khác.
- Không vào được `/admin`.

## Các lỗi cần để ý khi test

Nếu thấy các lỗi sau, gửi lại ảnh console/toast:

- `new row violates row-level security policy`
- `permission denied for table`
- `Bạn chưa có quyền đọc/ghi Supabase`
- Lỗi khi lưu mua căn bản
- Lỗi khi gửi KPI
- Lỗi khi lưu chăm sóc

## Kết luận

Phase G hiện đã sẵn sàng để test sau khi chạy SQL Phase F.

Điểm quan trọng nhất đã được vá trước: luồng mua căn bản không còn phụ thuộc `order_items`, nên phù hợp hơn với CRM thuần.
