# Nhóm 2 — API và ứng dụng

Mọi prompt trong file này phải tuân thủ `../GOVERNANCE.md`.

## 05A — API catalog công khai

Tạo API/RPC v1 cho danh sách, chi tiết, tìm kiếm, lọc và phân trang sản phẩm published. Chỉ trả trường catalog; không trả raw data, tồn kho, audit hoặc người cập nhật. Không grant anon toàn bảng. Test staging.

## 05B — Website leads

Tạo luồng `website_leads` trung gian với validate, trạng thái xử lý, chống spam hook, quyền manager/owner, chuyển/ghép customer có kiểm tra trùng điện thoại và audit. Anon chỉ được gửi, không đọc.

## 06A — `/admin` quản lý catalog

Tạo ứng dụng admin tách CRM: auth guard, danh sách, lọc, chỉnh catalog, trạng thái, preview URL ảnh và fallback. Ảnh sản phẩm không upload Supabase Storage. Không lộ service role.

## 06B — `/admin` import

Thêm hai chế độ import, preview, chênh lệch giá, lọc trạng thái, duyệt/loại/chọn ứng viên, apply, lịch sử và rollback. PDF chỉ OCR/chờ duyệt. Chạy E2E staging.

## 07A — Website catalog `/`

Tạo website độc lập: published products, tìm kiếm, lọc, phân trang/lazy load, giá VNĐ/m², “Đang cập nhật”, URL ảnh ngoài, fallback và responsive. Chỉ gọi public API.

## 07B — Chi tiết, QR và lead

Thêm chi tiết `?id=SP-...`, gallery, PDF/video, chia sẻ, QR, Zalo/WhatsApp, website lead và tracking tối thiểu. Test ID hợp lệ/sai, draft, ảnh hỏng và mobile.

## 08A — Bộ chọn sản phẩm CRM

Tích hợp product selector vào đề xuất, báo giá, đơn hàng, sản phẩm quan tâm và kho nếu còn dùng. Thêm nút xem website. Báo giá lưu đầy đủ snapshot; test đổi giá không sửa báo giá cũ.

## 08B — Ẩn quản lý sản phẩm khỏi CRM

Kiểm kê dependency rồi ẩn menu/trang quản lý catalog, gỡ quyền sửa khỏi sale và hướng owner sang `/admin`. Giữ adapter cần cho nghiệp vụ; chỉ xóa dead code có bằng chứng. Regression test CRM/KPI/báo giá/đơn/kho.

Mỗi prompt PASS khi chức năng, RLS, test desktop/mobile liên quan đạt; không tác động production và có commit local riêng.
