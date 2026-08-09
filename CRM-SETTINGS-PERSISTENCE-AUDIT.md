# Audit lưu cấu hình CRM vào Supabase

Ngày audit: 2026-08-09

Phạm vi: cấu hình danh mục CRM, loại khách, kênh chi tiết, trạng thái, follow-up, mức tiềm năng và cấu hình chăm sóc. Audit này dựa trên code và SQL trong repo; chưa chạy thay đổi lên Supabase production.

## Kết luận nguyên nhân

Lỗi nằm ở adapter Supabase trong `js/firebase.js`.

Bảng `settings` lưu cùng payload ở hai cột JSONB:

- `data`
- `raw_data`

Khi frontend gọi `setDoc(..., {merge:true})`, code cũ chỉ merge `raw_data`, còn `data` bị ghi đè bằng patch nhỏ vừa gửi. Khi refresh, hàm đọc settings ưu tiên `data`. Những key không còn trong `data` được `DEFAULT_SETTINGS` điền lại, nên người dùng thấy giá trị cũ/mặc định quay trở lại.

Ví dụ luồng gây lỗi:

1. Admin đổi loại khách từ PCI thành BCI.
2. State hiện tại được cập nhật nên UI tạm thời hiện BCI.
3. Một patch khác như `followConfigVersion` hoặc `careDueDays` ghi vào settings.
4. `data` chỉ còn patch nhỏ; `raw_data` có dữ liệu đầy đủ hơn.
5. Refresh đọc `data`, thiếu `customerTypes`, nên frontend trả về default PCI.

## Những nguồn cấu hình hiện tại

| Nhóm | Nguồn chính sau sửa | Fallback |
|---|---|---|
| Kênh chi tiết | `public.settings`, id `crm`, key `channels` | `DEFAULT_SETTINGS.channels` |
| Loại khách | `public.settings`, key `customerTypes` | `DEFAULT_SETTINGS.customerTypes` |
| Mức tiềm năng | `public.settings`, key `potentialLevels` | `DEFAULT_SETTINGS.potentialLevels` |
| Trạng thái khách | `public.settings`, key `statuses` | `DEFAULT_SETTINGS.statuses` |
| Follow-up | `public.settings`, key `follows` | `DEFAULT_SETTINGS.follows` |
| Hình thức/kết quả chăm | `public.settings` | `DEFAULT_SETTINGS` |
| KPI rule | Bảng `kpi_rules` | Không dùng localStorage làm nguồn chính |

`localStorage` không được dùng làm nguồn cấu hình CRM. Nó chỉ được dùng cho một số trạng thái giao diện/thông báo phía trình duyệt.

## Cách sửa đã thực hiện

1. Adapter merge đồng thời `data` và `raw_data` cho `settings` và `company_settings`; dữ liệu lịch sử trong `raw_data` được ưu tiên vì adapter cũ giữ bản merge đầy đủ hơn ở đó.
2. Sau khi admin lưu, app đọc lại bản ghi từ Supabase và so sánh các key quan trọng.
3. Chỉ khi dữ liệu đọc lại khớp, frontend mới cập nhật state và báo thành công.
4. Nếu Supabase/RLS/trigger không lưu đúng, app báo lỗi rõ, không báo thành công giả.
5. Chuyển `potentialLevels` từ constant hardcode sang settings trong database.
6. Owner và admin đều được phép dùng luồng quản trị; manager/sale vẫn bị chặn.
7. Tạo migration `supabase-phase-8-settings-persistence.sql` để sửa dữ liệu `data/raw_data` đã lệch và thêm trigger giữ chúng đồng bộ.

## RLS hiện tại trong repo

- Active user được đọc `settings`.
- Chỉ `crm_is_admin()` được ghi.
- `crm_is_admin()` trả true cho role `owner` hoặc `admin`.
- Manager và sale không có quyền sửa settings.

RLS thực tế trên production vẫn cần kiểm tra sau khi backup và chạy migration, vì repo không tự chứng minh production đang dùng đúng phiên bản policy.

## Data model CRM liên quan hiện có trong repo

| Nhu cầu | Bảng/nguồn hiện tại | Đánh giá |
|---|---|---|
| Khách hàng | `customers` | Có owner, created_by, created_at, updated_at trong schema/adapter; phù hợp CRM thuần |
| Danh mục CRM | `settings` JSONB | Đủ dùng ngắn hạn; đã sửa persistence, nhưng chưa tách code/label |
| Lịch sử chăm | `care_logs` | Có customer, owner, care channel/result, next care date và timestamp |
| Follow-up/lịch hẹn | Đang gắn trong customer/care log | Dùng được nhưng nên chuẩn hóa thành event/task nếu cần KPI đúng hạn chi tiết |
| Showroom visit | Care log/customer aggregate | Có thể tính, nhưng nguồn chuẩn nên là event care log |
| Mua căn bản | `deals` ở mức đánh giá khách | Giữ ở mức CRM, không mở rộng thành quản lý đơn hàng |
| User/role | `app_users` | Có role, active, email, team và timestamp |
| KPI cấu hình | `kpi_rules` | Hiện thiên về proposal được duyệt; chưa đủ target/trọng số tự động |
| KPI đề xuất | `kpi_proposals` | Phù hợp KPI cần minh chứng/duyệt |
| Audit | `audit_logs` | Có action, entity, actor và thời gian |

Các bảng `customer_sources`, `customer_types`, `customer_statuses`, `potential_levels` chưa được tách riêng; hiện nằm trong `settings`. Không cần tách ngay để sửa lỗi. Khi tách ở giai đoạn sau, mỗi dòng nên có `code`, `label`, `active`, `sort_order`, `created_at`, `updated_at`, `updated_by_email` và RLS chỉ owner/admin ghi.

## Cách test sau khi backup và chạy SQL

1. Đăng nhập owner/admin.
2. Vào `/admin/categories`.
3. Đổi một nhãn thử nghiệm, ví dụ `PCI` thành `BCI`.
4. Bấm Lưu và chờ thông báo thành công.
5. Trong Supabase SQL Editor chạy:

```sql
select id, data, raw_data, data = raw_data as payloads_match, updated_at
from public.settings
where id = 'crm';
```

6. Kiểm tra `customerTypes` trong cả `data` và `raw_data` đã là BCI.
7. Refresh trình duyệt: BCI phải còn.
8. Đăng xuất/đăng nhập lại: BCI phải còn.
9. Đăng nhập manager/sale: nhìn thấy BCI trong dropdown nhưng không vào/sửa được Admin Panel.
10. Thử chặn policy hoặc dùng sale ghi settings: app phải báo lỗi, không được báo lưu thành công.

## Lưu ý code và label

Hiện danh mục cũ vẫn là mảng chuỗi, chưa tách `code` và `label`. Vì vậy đổi nhãn không tự migrate các khách hàng cũ đang lưu giá trị cũ. Bước nâng cấp sau nên tách danh mục thành bảng có `code` ổn định và `label` chỉnh được; chưa nên tự động đổi toàn bộ dữ liệu production trong bước sửa persistence này.
