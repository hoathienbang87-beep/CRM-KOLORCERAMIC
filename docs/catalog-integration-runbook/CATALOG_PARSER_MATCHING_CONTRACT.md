# Catalog parser và matching contract — Prompt 03A

## 1. Phạm vi

Module 03A chỉ đọc, chuẩn hóa, phân loại và dry-run matching. Module không ghi database, không tự áp giá, không import catalog và không đổi trạng thái sản phẩm.

Đầu vào Excel được chuyển thành một workbook object tương thích SheetJS. I/O đọc file nằm ngoài module thuần; provenance của từng dòng được giữ bằng sheet, số dòng và cell tham chiếu.

## 2. Chuẩn hóa bắt buộc

- Tên: Unicode NFKC, gom khoảng trắng, chuẩn hóa dấu nối và viết hoa khóa so khớp; tên hiển thị không bỏ dấu tiếng Việt.
- Quy cách: nhận `x`, `X`, `×`; nhận `mm` hoặc `cm`; quy đổi và lưu `width_mm`, `height_mm` theo đúng thứ tự nguồn.
- Ô quy cách merge: đọc từ cell neo và giữ `size_source_cell_ref`. Chỉ fill-down ô trống khi cột quy cách thật sự có vertical merge; ô trống trong file finalized không bị tự lấp.
- Bề mặt: tách các suffix đã biết như `POLISH`, `MATT`, `GLOSSY`, `BABY SKIN`; cột bề mặt có cấu trúc được ưu tiên và không được làm mất token tên khi suffix mâu thuẫn.
- Giá/m² VND: nhận số nguyên hoặc chuỗi `1.915.000`, `1,915,000`, `1915000`; lưu chuỗi số nguyên canonical để không mất độ chính xác. Giá trống giữ `null` và mang trạng thái cần cập nhật.
- Cột giá: khi file có cả giá cũ và giá mới/chốt, parser chọn giá mới/chốt.

## 3. Duplicate và conflict

Variant key là `tên chuẩn + width_mm + height_mm + bề mặt`.

- Cùng variant và cùng giá: giữ dòng đầu, các dòng sau là `SKIP_DUPLICATE`.
- Cùng variant nhưng nhiều giá: toàn nhóm là `PRICE_CONFLICT`, bắt buộc duyệt thủ công.
- Cùng tên và cùng giá nhưng khác kích thước hoặc bề mặt: không coi là duplicate; chỉ gắn `SAME_PRICE_WARNING`.
- Thiếu giá: `MISSING_PRICE`; thiếu hoặc sai tên/quy cách: `MANUAL_REVIEW`.

## 4. Thứ tự matching

1. `product_id` chính xác.
2. Source mapping ID chính xác.
3. SKU/code duy nhất.
4. Tên + kích thước có thứ tự + bề mặt chính xác.
5. Tên + kích thước có thứ tự, chỉ khi không có xung đột bề mặt.
6. Duyệt thủ công.

Fuzzy name chỉ tạo `FUZZY_SUGGESTION`; không bao giờ tạo auto-match. `1200 x 2400` không được tự đảo thành `2400 x 1200`.

## 5. Output dry-run

Mỗi dòng nguồn luôn có đúng một trạng thái matching: `MATCHED`, `AMBIGUOUS` hoặc `UNMATCHED`. Output gồm rule đã dùng, candidate/gợi ý và provenance nguồn. Dry-run phải giữ nguyên số dòng nguồn và chỉ xuất thống kê; việc apply/rollback database thuộc Prompt 03B.
