# Đề xuất thiết kế lại bảng KPI sale CRM thuần

Ngày đề xuất: 2026-08-09

Trạng thái: thiết kế để duyệt, chưa triển khai logic KPI phức tạp và chưa thay đổi database production.

## Mục tiêu

KPI đo hành vi quản lý/chăm sóc khách hàng, không đo chi tiết sản phẩm, kho hay đơn hàng. Kết quả phải tính từ dữ liệu gốc và truy ngược được danh sách khách/log tạo ra con số đó.

## Bảng tổng quan theo nhân viên

| Nhân viên | Khách mới hợp lệ | Lượt chăm | Đúng hạn | Quá hạn | Đến showroom | Tiềm năng cao | Tổng điểm | Xếp loại |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Nguyễn A | 8/10 - 80% | 34/40 - 85% | 25/30 - 83% | 3 | 4/5 - 80% | 6/5 - 120% | 82 | Gần đạt |

Mỗi ô có thể bấm để mở modal dữ liệu nguồn. Ví dụ bấm `8/10` sẽ hiện đúng 8 khách mới hợp lệ được tính.

## Bảng chi tiết KPI

| Nhân viên | KPI | Thực tế | Mục tiêu | Tỷ lệ | Trọng số | Điểm | Trạng thái | Kỳ |
|---|---|---:|---:|---:|---:|---:|---|---|
| Nguyễn A | Khách mới hợp lệ | 8 | 10 | 80% | 20% | 16 | Gần đạt | 08/2026 |

Công thức đề xuất:

```text
Tỷ lệ hoàn thành = min(Thực tế / Mục tiêu, 100%)
Điểm KPI = Tỷ lệ hoàn thành x Trọng số
Tổng điểm nhân viên = tổng Điểm KPI
```

Không nên cộng vượt 100% vào tổng điểm mặc định. Nếu công ty muốn thưởng vượt chỉ tiêu, nên có cột bonus riêng để báo cáo không bị méo.

## KPI nguồn dữ liệu

| KPI | Dữ liệu gốc | Quy tắc chính |
|---|---|---|
| Khách mới hợp lệ | `customers` | Unique theo SĐT chuẩn hóa; khách không SĐT cần quy tắc duyệt riêng |
| Lượt chăm sóc | `care_logs` | Đếm log không bị xóa, đúng owner và trong kỳ |
| Chăm sóc đúng hạn | `care_logs` + lịch hẹn | Log chăm diễn ra trước/đúng hạn |
| Khách quá hạn | `customers.next_care_date` | Quá ngày, chưa đóng/ngừng chăm |
| Lịch hẹn tạo/hoàn thành | Follow-up/task hiện có | Cần chuẩn hóa trường trạng thái hoàn thành |
| Đến showroom | `care_logs.showroom_visit` hoặc customer visit | Đếm event, không nhập tổng cuối bằng tay |
| Khách tiềm năng cao | `customers.potential_level` | Unique khách; cần audit khi đổi mức |
| Có mua căn bản | dữ liệu mua căn bản hiện có | Unique khách, chỉ dùng đánh giá giá trị khách |
| Tỷ lệ bỏ quên | khách quá hạn / khách đang chăm | Loại khách đã đóng/ngừng chăm |
| Tỷ lệ follow đúng hạn | đúng hạn / lịch đến hạn | Tránh chia 0 |

## Data model tối giản đề xuất

Giữ các bảng hiện có: `customers`, `care_logs`, `deals` ở mức mua căn bản, `app_users`, `kpi_rules`, `kpi_proposals`, `audit_logs`, `settings`.

Bổ sung ở giai đoạn triển khai KPI:

- `kpi_targets`: mục tiêu/trọng số theo KPI, nhân viên/team và kỳ.
- View hoặc RPC `crm_kpi_results`: tính kết quả từ dữ liệu nguồn theo khoảng ngày.
- Không cho frontend ghi trực tiếp kết quả cuối.
- Nếu cần chốt số cuối tháng, thêm snapshot chỉ do owner/admin tạo và có audit log.

## Trạng thái KPI

| Tỷ lệ | Trạng thái |
|---:|---|
| >= 100% | Đạt |
| 80-99% | Gần đạt |
| 50-79% | Cần cải thiện |
| < 50% | Không đạt |

Ngưỡng nên để owner/admin cấu hình; sale chỉ đọc.

## Bộ lọc bắt buộc

- Ngày, tuần, tháng hoặc khoảng ngày tùy chọn.
- Nhân viên.
- Team.
- Timezone `Asia/Ho_Chi_Minh` khi xác định đầu/cuối ngày.

## Quyền và audit

- Owner/admin: cấu hình KPI, target, trọng số và kỳ.
- Manager: xem KPI team, duyệt đề xuất nếu được phân quyền.
- Sale: xem KPI của mình, gửi minh chứng/đề xuất; không sửa kết quả tự động.
- Sale không được xóa care log để làm đẹp KPI.
- Đổi owner, sửa ngày chăm, đổi potential level, duyệt/từ chối KPI phải có audit log.

## Thứ tự triển khai sau khi duyệt

1. Chốt định nghĩa từng KPI và dữ liệu nguồn.
2. Chốt target/trọng số/xếp loại.
3. Tạo migration `kpi_targets` và RPC/view tính KPI.
4. Làm bảng tổng quan theo nhân viên.
5. Làm bảng chi tiết và modal truy ngược.
6. Test timezone, trùng SĐT và ba role trước khi deploy.
