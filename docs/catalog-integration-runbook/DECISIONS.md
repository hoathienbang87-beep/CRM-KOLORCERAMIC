# Quyết định đã chốt

## Kiến trúc

- `/`: website catalog công khai.
- `/admin`: quản trị website, catalog và import.
- `/crm`: CRM nội bộ.
- `/CRM`: chuyển hướng sang `/crm`.
- Website và CRM cùng repository, Vercel project và Supabase project nhưng tách entry point, CSS, JavaScript và state.
- Supabase `products` là nguồn dữ liệu sản phẩm duy nhất.
- CRM không còn màn hình quản lý catalog; chỉ sử dụng bộ chọn sản phẩm trong nghiệp vụ.

## Sản phẩm

- Tên sản phẩm không chứa quy cách hoặc bề mặt trong dữ liệu chuẩn.
- Lưu kích thước chuẩn bằng `width_mm` và `height_mm`; centimet là định dạng hiển thị.
- Biến thể: tên chuẩn + kích thước + bề mặt.
- Bề mặt có thể thiếu nhưng trường hợp nhiều ứng viên không được auto-match.
- Giá là số nguyên/numeric VNĐ/m²; thiếu giá là `NULL`, không phải 0.
- Sản phẩm thiếu tên, kích thước hoặc giá phải ở trạng thái draft/“Đang cập nhật”.
- Ảnh sản phẩm dùng URL ngoài; Supabase Storage dành cho ảnh báo cáo/minh chứng nội bộ.
- Giữ ID Supabase hiện có và ID Firebase dạng `SP-...` khi có thể.
- Hai dòng STT 22 và 24 trong danh sách duyệt đã bị loại, phải lưu dấu vết và không import.
- 102 dòng được giữ lại: 95 sẵn sàng, 7 đang cập nhật.
- 359 ứng viên mới chưa mặc nhiên được phê duyệt để published.

## Import

- Import danh mục có thể tạo draft mới.
- Cập nhật giá hàng loạt không tạo sản phẩm mới.
- Matching: product ID → SKU duy nhất → tên + size + surface → tên + size duy nhất → thủ công.
- Fuzzy matching chỉ là gợi ý.
- Excel được đọc có cấu trúc; PDF chỉ vào vùng OCR/chờ duyệt.
- Mỗi batch có preview, audit, lịch sử giá và rollback.
- Báo giá lưu snapshot và không thay đổi khi catalog đổi giá.
