# Audit CRM-KOLORCERAMIC theo 3 vai trò

Ngày audit: 2026-07-08

Phạm vi audit: CRM thuần cho ngành gạch/ceramic. Không đánh giá theo hướng ERP, không đề xuất quay lại sản phẩm, kho, đơn hàng chi tiết hay CMS website.

## 1. Tóm tắt tình trạng hiện tại

CRM-KOLORCERAMIC hiện đã được rút khá nhiều về đúng hướng CRM thuần. Menu chính hiện còn các khu vực hợp lý hơn: CRM, Khách hàng, KPI, Báo cáo, Quản trị. Các panel sản phẩm, kho, báo giá, thanh toán, CMS đã được loại khỏi UI chính.

Các phần đang có nền tốt:

- Có đăng nhập Supabase Auth.
- Có role `owner/admin/manager/sale`.
- Có hồ sơ khách hàng.
- Có lịch sử chăm sóc khách.
- Có follow-up và cảnh báo cần chăm.
- Có KPI rule và KPI proposal.
- Có audit log ở nhiều thao tác quan trọng.
- Có RLS nền tảng và SQL Phase F để chuyển bảng ERP/CMS cũ sang archive.

Các phần còn đáng lo:

- Code vẫn còn nhiều hàm legacy của ERP/CMS nằm trong `crm-app.js`, dù UI chính không gọi nữa.
- `deals` vẫn đang gánh cả nghĩa "mua căn bản" và một phần ngôn ngữ cũ của đơn hàng.
- KPI hiện phụ thuộc khá nhiều vào proposal thủ công, cần thêm KPI tự động từ dữ liệu gốc.
- Chưa có model riêng cho showroom visits, follow-up tasks, KPI snapshots.
- UI sale vẫn hơi dày nếu nhìn bằng điện thoại hoặc dùng hằng ngày.
- Dashboard quản lý có số liệu, nhưng cần tổ chức lại theo câu hỏi quản trị thật sự.

## 2. Đánh giá dưới góc nhìn nhân viên sale

### Sale làm được gì tốt

Sale có thể:

- Thêm khách mới.
- Gán kênh chi tiết.
- Ghi nhu cầu/ghi chú.
- Xem khách của mình.
- Chăm sóc khách và lưu lịch sử.
- Đặt ngày hẹn chăm tiếp.
- Xem nhóm khách cần chăm/lâu chưa chăm.
- Đề xuất KPI kèm ảnh minh chứng.
- Xem KPI của mình.
- Ghi nhận mua căn bản ở mức đơn giản.

### Điểm sale sẽ thấy tiện

- Có nút chăm sóc ngay trên danh sách khách.
- Có timeline chăm sóc trong drawer.
- Có lọc nhanh theo nhóm kênh: Công ty XD, Mạng XH, Kênh khác.
- Có cảnh báo tình trạng chăm.
- Có form đề xuất KPI ngay từ khách hàng.

### Điểm sale có thể thấy mệt/rối

- Form thêm khách vẫn còn tương đối nhiều trường nếu sale chỉ muốn nhập nhanh.
- Cụm "mua căn bản" vẫn còn vài dấu vết ngôn ngữ/logic cũ của đơn hàng trong code và một số thông báo.
- Kênh chi tiết đang thay thế nguồn/loại khách, nhưng nhu cầu ban đầu vẫn nhắc đến nguồn, loại khách, tiềm năng. Nếu thiếu các trường này, sale khó phân loại sâu.
- Chưa thấy một màn "Hôm nay tôi phải làm gì?" đủ nổi bật cho sale.
- Mobile có thể vẫn phải cuộn khá nhiều vì app là single-page lớn, nhiều panel nằm chung.

### Câu trả lời theo checklist sale

1. Thêm khách nhanh: tạm ổn, nhưng nên có chế độ "thêm nhanh".
2. Form thêm khách: hơi nhiều với sale nhập nhanh, nên tách bắt buộc và nâng cao.
3. Trường bắt buộc: tên khách, SĐT hoặc đánh dấu không SĐT, kênh chi tiết, sale phụ trách là hợp lý.
4. Nguồn khách: hiện app thiên về "kênh chi tiết", chưa còn nguồn rõ ràng.
5. Loại khách: hiện chưa rõ bằng model riêng, nên bổ sung lại nếu công ty cần phân nhóm.
6. Tiềm năng: cần trường rõ hơn như nóng/ấm/lạnh hoặc A/B/C.
7. Ghi chú chăm sóc: đã có.
8. Xem lịch sử chăm sóc: đã có timeline, cần làm nổi bật hơn trong drawer.
9. Biết hôm nay chăm ai: có nền, nên đưa thành dashboard cá nhân.
10. Cảnh báo bị bỏ quên: có, cần kiểm tra lại logic quá hạn sau Phase F/G.
11. Cập nhật trạng thái khách: có.
12. Ghi nhận đến showroom: hiện có field tổng, nên tách thành lịch sử visit riêng.
13. Ghi nhận mua căn bản: có, vừa được rút khỏi `order_items`.
14. Mobile: dùng được nhưng chưa thật sự tối ưu cho thao tác nhanh.
15. Phần thừa: mọi dấu vết báo giá, giao hàng, phiếu giao, kho, thanh toán nên tiếp tục dọn khỏi code/UI.

## 3. Đánh giá dưới góc nhìn quản lý/owner

### Quản lý đang xem được gì

Quản lý có thể:

- Xem tổng quan CRM.
- Xem khách hàng theo sale.
- Xem khách cần chăm/quá hạn.
- Xem báo cáo sale activity.
- Xem KPI chờ duyệt và KPI theo nhân viên.
- Xem audit log nếu có quyền.
- Quản lý user trong khu admin riêng.
- Cấu hình dropdown và thiết lập chăm sóc.

### Điểm còn yếu cho quản lý

- Dashboard vẫn còn thiên về "đếm số" hơn là "ra quyết định".
- Chưa có bảng ưu tiên kiểu: sale nào đang bỏ quên khách, khách nóng nào chưa chăm, nguồn nào tạo khách chất lượng.
- Chưa có scoring rõ ràng cho khách tiềm năng.
- Chưa có báo cáo chuyển đổi theo pipeline CRM thuần: lead mới -> đã liên hệ -> tư vấn -> báo giá nội bộ nếu có -> mua căn bản.
- Chưa có snapshot KPI đóng kỳ để tránh dữ liệu tháng cũ thay đổi làm lệch báo cáo.

### Câu trả lời theo checklist quản lý

1. Tổng khách mới ngày/tuần/tháng: có thể làm qua filter/báo cáo, nên đưa lên dashboard rõ hơn.
2. Nguồn/kênh hiệu quả: có báo cáo theo kênh chi tiết, nhưng cần thêm tỷ lệ chất lượng.
3. Sale chăm khách nào: có qua owner và care logs.
4. Sale bỏ quên khách: có nền qua quá hạn, nên có bảng xếp hạng.
5. Khách tiềm năng cao: chưa đủ rõ nếu thiếu field tiềm năng/scoring.
6. Khách lâu chưa chăm: có.
7. Timeline từng khách: có.
8. Mỗi sale thêm bao nhiêu khách: có thể tính.
9. Mỗi sale chăm bao nhiêu lượt: có báo cáo hoạt động.
10. Lịch hẹn/tái chăm sóc: có nền, nên tách follow-up task rõ hơn.
11. Khách đến showroom nhiều lần: nên có bảng `customer_visits`.
12. Đối tác giá trị cao: cần scoring + purchase summary.
13. Xuất báo cáo: có export, cần chuẩn hóa theo câu hỏi quản trị.
14. Dashboard hiện tại: có ích nhưng chưa đủ "ra quyết định".
15. Nên bỏ khỏi quản lý: mọi module kho, sản phẩm, CMS, giao hàng, thanh toán chi tiết.

## 4. Đánh giá kỹ thuật dưới góc nhìn senior engineer

### Stack hiện tại

- Frontend: static HTML/CSS/JavaScript.
- Data/Auth: Supabase qua adapter `js/firebase.js`.
- Realtime: Supabase realtime qua adapter.
- Storage: Supabase Storage cho KPI evidence.
- Deploy: Vercel/static hosting.
- Database: Supabase Postgres + RLS.

### Điểm kỹ thuật tốt

- Không dùng service role key ở frontend.
- Có RLS và SQL migration theo phase.
- Có audit log ở nhiều thao tác.
- Có adapter để giữ API giống Firebase, giúp app chạy từ bản cũ sang Supabase.
- Đã có file Phase F/G để siết scope CRM.

### Điểm kỹ thuật yếu

- `js/features/crm-app.js` quá lớn, nhiều trách nhiệm trong một file.
- Còn legacy functions cho products/quotes/payments/inventory/delivery.
- `deals` vẫn dùng tên và logic của đơn hàng, dù nghiệp vụ đã đổi thành mua căn bản.
- Một số CSS legacy còn có thể tồn tại.
- Không có test tự động.
- Không có typed schema hoặc contract rõ giữa frontend và database.
- RLS theo SQL tốt hơn trước, nhưng cần test thật sau khi chạy Phase F.

### Nợ kỹ thuật nên xử lý

- Tách module theo CRM thật: customers, care, followups, KPI, reports, admin.
- Đổi ngôn ngữ code từ `deal/order` sang `basicPurchase` ở những phần CRM thuần.
- Ngừng watch/query các bảng legacy nếu không cần.
- Tạo view/report SQL hoặc RPC cho dashboard thay vì tính quá nhiều ở frontend.
- Thêm test checklist định kỳ trước deploy.

## 5. Những phần đang đi lệch nhu cầu CRM

Nên coi các phần sau là legacy/archive, không dùng vận hành:

- `products`
- `quotes`
- `quote_items`
- `order_items`
- `payments`
- `inventory_movements`
- `website_pages`
- `website_sections`
- `product_inventory_balance`
- Các hàm giao hàng, phiếu giao, kho, thanh toán trong `crm-app.js`.
- Các tài liệu Phase 4 ERP cũ nếu gây hiểu nhầm cho người quản trị.

## 6. Những phần nên giữ

- Supabase Auth.
- `app_users` + role.
- `customers`.
- `care_logs`.
- `deals` nhưng đổi nghĩa thành mua căn bản.
- `kpi_rules`.
- `kpi_proposals`.
- `audit_logs`.
- `user_sessions`.
- `settings`.
- `company_settings`.
- KPI evidence storage.
- Báo cáo hoạt động sale.
- Dashboard cần chăm/quá hạn.

## 7. Những phần nên bỏ hoặc ẩn tiếp

- Báo giá/đề xuất bán hàng theo sản phẩm.
- Quản lý sản phẩm.
- Nhập/xuất kho.
- Thanh toán/công nợ chi tiết.
- Phiếu giao/bàn giao.
- CMS website.
- Media/banner/section website.
- Các export ERP như inventory/products/quotes nếu không còn phục vụ CRM.

## 8. Những phần nên refactor

### Refactor code

Nên tách `crm-app.js` thành:

- `customers.js`
- `care.js`
- `followups.js`
- `basic-purchases.js`
- `kpi.js`
- `reports.js`
- `admin-users.js`
- `settings.js`
- `audit.js`
- `supabase-repositories.js`

### Refactor data

- Tách `deals` thành `customer_basic_purchases` trong tương lai.
- Tách showroom visit khỏi customer summary thành `customer_visits`.
- Tách follow-up task khỏi customer field thành `customer_followups`.
- Tạo KPI snapshots để khóa số liệu theo kỳ.

## 9. Thiếu nghiêm trọng cho CRM chăm sóc khách hàng

Các phần nên bổ sung nếu muốn CRM dùng thật lâu dài:

- Follow-up task riêng có trạng thái: mở, hoàn thành, quá hạn, hủy.
- Customer visit log: ngày đến showroom, sale ghi nhận, ghi chú, chất lượng.
- Customer potential score: nóng/ấm/lạnh hoặc A/B/C.
- Customer source/type chuẩn hóa lại nếu công ty vẫn cần phân tích nguồn và loại khách.
- Timeline hợp nhất: thêm khách, chăm sóc, đổi trạng thái, hẹn lại, đến showroom, mua căn bản, KPI proposal.
- KPI snapshot theo tháng để báo cáo không bị thay đổi ngược.
- Quy tắc chống log chăm sóc quá ngắn/rỗng.
- Quy tắc không cho sale xóa/sửa care log sau một khoảng thời gian.

## 10. Rủi ro lớn nhất ở KPI

### Rủi ro nghiệp vụ

- Sale chạy theo nhập liệu thay vì chăm sóc thật.
- Sale ghi chăm sóc cho có nội dung.
- Sale thêm khách chất lượng thấp để tăng số.
- Một khách có thể bị tính nhiều lần nếu metric không rõ là theo khách hay theo lượt.
- Khách cũ bị tính thành khách mới nếu không khóa theo `created_at`.
- KPI thủ công qua proposal dễ phụ thuộc duyệt chủ quan.

### Rủi ro kỹ thuật

- Nếu KPI dựa trên dữ liệu có thể sửa/xóa, báo cáo có thể thay đổi sau khi đã chốt tháng.
- Timezone có thể làm lệch số liệu cuối ngày/tháng.
- Nếu không có audit đầy đủ, quản lý khó truy lại ai sửa gì.
- Nếu RLS sai, sale có thể xem/sửa dữ liệu không thuộc quyền.

### Rủi ro hiện tại trong app

- KPI proposal đã có duyệt, nhưng KPI tự động từ dữ liệu gốc chưa đủ mạnh.
- Care log có nội dung bắt buộc, nhưng chưa thấy rule tối thiểu về độ dài/chất lượng.
- Chưa có KPI snapshot đóng kỳ.
- Chưa có bảng follow-up riêng để tính đúng hạn/quá hạn thật sạch.

## 11. Đề xuất quy tắc KPI an toàn

### Nguyên tắc

- KPI nào cũng phải truy ngược được đến dữ liệu gốc.
- KPI tự động ưu tiên hơn KPI tự khai.
- KPI thủ công phải có duyệt và minh chứng.
- Sale không được tự xóa care log.
- Sửa dữ liệu quan trọng phải có audit log.
- KPI tháng phải có snapshot/chốt kỳ.

### KPI nên dùng

1. Khách mới hợp lệ
   - Nguồn: `customers`.
   - Điều kiện: có tên, có SĐT hoặc đánh dấu không SĐT, có owner, không trùng phone.
   - Chống gian lận: phone index, audit create.

2. Lượt chăm sóc hợp lệ
   - Nguồn: `care_logs`.
   - Điều kiện: có hình thức, kết quả, ghi chú tối thiểu, customer_id hợp lệ.
   - Không tính log rỗng hoặc quá ngắn.

3. Follow-up đúng hạn
   - Nguồn nên có: `customer_followups`.
   - Điều kiện: task hoàn thành trước hoặc đúng hạn.

4. Khách quá hạn chăm
   - Nguồn: `customers` + follow-up/care logs.
   - Tính theo ngày hẹn hoặc số ngày từ lần chăm cuối.

5. Khách đến showroom
   - Nguồn nên có: `customer_visits`.
   - Có ngày, người ghi, ghi chú.

6. Khách tiềm năng cao
   - Nguồn: customer potential field hoặc scoring.
   - Chỉ tính khi có tiêu chí rõ.

7. Mua căn bản
   - Nguồn: hiện tại `deals`, tương lai `customer_basic_purchases`.
   - Chỉ ghi nhận số lần và giá trị căn bản, không chi tiết đơn hàng.

8. KPI proposal được duyệt
   - Nguồn: `kpi_proposals`.
   - Chỉ tính trạng thái `approved`.

### Quy tắc chống sai lệch

- Không tính khách trùng SĐT.
- Không tính care log dưới số ký tự tối thiểu.
- Không cho sale sửa owner.
- Không cho sale xóa care log.
- Không cho sale tự duyệt KPI.
- Không tính proposal chưa duyệt.
- Không tính dữ liệu đã soft-delete.
- Chốt KPI tháng bằng snapshot.

## 12. Đề xuất data model CRM tối giản nhưng đủ dùng

### `app_users`

Dùng để quản lý nhân viên và quyền.

Field quan trọng:

- `id`
- `email` bắt buộc
- `name`
- `role` bắt buộc
- `active` bắt buộc
- `team`
- `phone`
- `created_at`
- `updated_at`

Liên quan KPI: owner/sale identity.

RLS: sale đọc bản thân; manager/admin đọc nhân viên theo quyền; admin/owner sửa.

### `customers`

Dùng để lưu hồ sơ khách.

Field quan trọng:

- `id`
- `name` bắt buộc
- `phone_raw`
- `phone_normalized`
- `no_phone`
- `company_name`
- `address`
- `source`
- `customer_type`
- `channel`
- `potential_level`
- `owner_email` bắt buộc
- `status`
- `follow`
- `next_care_date`
- `last_contact_at`
- `showroom_visit_count`
- `basic_purchase_count`
- `basic_purchase_value`
- `is_deleted`
- `created_by_email`
- `created_at`
- `updated_at`

Liên quan KPI: khách mới, khách hợp lệ, khách tiềm năng, khách quá hạn, owner.

RLS: sale chỉ đọc/sửa khách của mình hoặc do mình tạo; manager/team theo quyền; admin toàn bộ.

### `customer_sources`

Dùng để quản lý danh mục nguồn khách nếu công ty vẫn cần.

Field:

- `id`
- `name` bắt buộc
- `active`
- `sort_order`

Liên quan KPI: báo cáo nguồn hiệu quả.

RLS: active users đọc; admin/manager cấu hình.

### `customer_types`

Dùng để phân loại khách: khách lẻ, KTS, công ty TK/XD, đối tác, showroom...

Field:

- `id`
- `name`
- `active`
- `sort_order`

Liên quan KPI: phân tích chất lượng khách.

RLS: active users đọc; admin/manager cấu hình.

### `care_logs`

Dùng để lưu từng lần chăm sóc.

Field:

- `id`
- `customer_id` bắt buộc
- `owner_email`
- `care_channel` bắt buộc
- `care_result` bắt buộc
- `note` bắt buộc
- `next_care_date`
- `created_by_email`
- `created_at`
- `is_deleted`

Liên quan KPI: lượt chăm sóc, chất lượng chăm, follow-up.

RLS: sale thêm log cho khách của mình; sale không xóa; admin/manager có quyền quản lý.

### `customer_followups`

Nên thêm.

Dùng để quản lý lịch hẹn/tái chăm sóc như task thật.

Field:

- `id`
- `customer_id` bắt buộc
- `owner_email` bắt buộc
- `due_date` bắt buộc
- `status`: open, done, canceled, overdue
- `completed_at`
- `completed_by_email`
- `created_from_care_log_id`
- `note`
- `created_at`
- `updated_at`

Liên quan KPI: đúng hạn/quá hạn/lịch hẹn.

RLS: sale thao tác task của mình; manager xem team; admin toàn bộ.

### `customer_visits`

Nên thêm.

Dùng để ghi từng lần khách đến showroom.

Field:

- `id`
- `customer_id` bắt buộc
- `visit_date` bắt buộc
- `owner_email`
- `note`
- `created_by_email`
- `created_at`

Liên quan KPI: khách đến showroom, chất lượng khách.

RLS: sale ghi visit cho khách của mình; manager/admin xem.

### `customer_basic_purchases`

Nên thêm để thay thế dần `deals`.

Dùng để ghi số lần mua và giá trị mua căn bản.

Field:

- `id`
- `customer_id` bắt buộc
- `owner_email`
- `purchase_status`: deposit, bought, lost/canceled
- `purchase_date`
- `amount`
- `summary`
- `note`
- `created_by_email`
- `created_at`
- `updated_at`
- `is_deleted`

Liên quan KPI: số khách có mua căn bản, tổng giá trị căn bản.

RLS: sale ghi cho khách của mình; manager/admin xem và sửa theo quyền.

### `kpi_rules`

Dùng để định nghĩa KPI.

Field:

- `id`
- `name`
- `description`
- `metric_key`
- `target`
- `assigned_owners`
- `owner_targets`
- `active`
- `period_type`
- `created_by_email`
- `created_at`

RLS: sale đọc rule được gán; manager/admin quản lý.

### `kpi_proposals`

Dùng cho KPI cần minh chứng/duyệt.

Field:

- `id`
- `kpi_rule_id`
- `owner_email`
- `customer_id`
- `content`
- `evidence_url`
- `status`: pending, approved, rejected
- `review_note`
- `reviewed_by_email`
- `reviewed_at`
- `created_at`
- `is_deleted`

RLS: sale tạo/sửa khi pending; manager/admin duyệt.

### `kpi_snapshots`

Nên thêm.

Dùng để chốt KPI theo kỳ.

Field:

- `id`
- `period`
- `owner_email`
- `metric_key`
- `value`
- `target`
- `source_query_version`
- `closed_by_email`
- `closed_at`

RLS: sale đọc snapshot của mình; manager/admin đọc theo quyền; chỉ manager/admin chốt.

### `audit_logs`

Dùng để truy vết thao tác.

Field:

- `id`
- `action`
- `entity`
- `entity_id`
- `email`
- `payload_json`
- `created_at`

RLS: sale đọc log của mình nếu cần; manager/admin đọc rộng hơn.

## 13. Đánh giá phân quyền

### Sale

Nên được:

- Thêm khách của mình.
- Xem/sửa khách của mình.
- Ghi chăm sóc khách của mình.
- Tạo follow-up.
- Đề xuất KPI.
- Sửa/xóa mềm KPI proposal đang pending của mình.
- Ghi mua căn bản cho khách của mình.

Không nên được:

- Sửa owner khách.
- Xóa care log.
- Duyệt KPI.
- Xóa khách thật.
- Xem khách của sale khác.
- Xem bảng archive ERP/CMS.

### Manager

Nên được:

- Xem khách của team hoặc toàn bộ theo mô hình hiện tại.
- Điều chuyển khách giữa sale.
- Xem và duyệt KPI.
- Xem báo cáo hoạt động.
- Xem khách quá hạn.
- Xem audit cần thiết.

Không nên được:

- Đụng cấu hình hệ thống nhạy cảm nếu không phải admin.
- Xóa dữ liệu vĩnh viễn.

### Owner/Admin

Nên được:

- Toàn quyền cấu hình CRM.
- Quản lý user/role.
- Xem audit log.
- Chạy export/backup.
- Xem archive legacy khi cần đối soát.

Không nên:

- Dùng chung màn hình thao tác hằng ngày quá nhiều nếu gây rối.

## 14. Đề xuất menu mới

### Menu cho sale

- Dashboard cá nhân
- Khách hàng của tôi
- Thêm khách hàng
- Cần chăm sóc hôm nay
- Lịch hẹn / Follow-up
- KPI của tôi

### Menu cho manager/admin

- Tổng quan CRM
- Tất cả khách hàng
- Khách cần chăm sóc
- Khách tiềm năng
- Nguồn/Kênh khách
- Loại khách
- Hoạt động chăm sóc
- KPI sale
- Báo cáo
- Quản lý user/role
- Cấu hình CRM
- Nhật ký hoạt động

### Menu/phần nên bỏ khỏi CRM thuần

- Sản phẩm
- Đơn hàng chi tiết
- Kho
- Thanh toán
- Báo giá theo sản phẩm
- CMS website
- Banner/trang chủ/media website

## 15. Dashboard đề xuất cho sale

Sale cần một dashboard rất thực dụng:

- Hôm nay cần chăm: số lượng + danh sách ưu tiên.
- Quá hạn chăm: số lượng + danh sách đỏ.
- Khách mới tháng này.
- Lượt chăm tháng này.
- Lịch hẹn sắp tới.
- KPI của tôi: đã đạt / chỉ tiêu.
- KPI đang chờ duyệt.
- Khách tiềm năng cao của tôi.
- Khách chưa có lịch hẹn tiếp.

Ưu tiên UI: ít chữ, nhiều nút hành động nhanh.

## 16. Dashboard đề xuất cho quản lý

Quản lý cần dashboard theo câu hỏi:

- Tháng này có bao nhiêu khách mới?
- Kênh nào tạo khách nhiều/chất lượng?
- Sale nào chăm tốt?
- Sale nào có khách quá hạn nhiều?
- Khách nóng nào chưa được chăm?
- KPI nào đang tụt?
- KPI nào chờ duyệt lâu?
- Khách/đối tác nào có giá trị cao?
- Có bao nhiêu khách không có lịch hẹn tiếp?

Nên có các bảng:

- Bảng sale ranking.
- Bảng khách quá hạn theo sale.
- Bảng nguồn/kênh hiệu quả.
- Bảng KPI pending.
- Bảng khách tiềm năng cao.

## 17. Roadmap triển khai

### Giai đoạn 1: Rút gọn scope

Trạng thái: đang làm tốt, cần dọn tiếp code legacy.

Việc làm:

- Dọn các hàm sản phẩm/kho/báo giá/thanh toán/giao hàng khỏi runtime.
- Giữ legacy archive ở database.
- Cập nhật tài liệu để không còn nhầm ERP/CMS.

### Giai đoạn 2: Làm chắc data khách hàng

Việc làm:

- Chuẩn hóa form thêm khách.
- Thêm chế độ thêm nhanh.
- Chống trùng SĐT.
- Khôi phục/chuẩn hóa nguồn, loại khách, tiềm năng nếu công ty cần.
- Khóa sale không tự đổi owner.

### Giai đoạn 3: Làm kỹ chăm sóc khách hàng

Việc làm:

- Tách follow-up thành bảng/task riêng.
- Timeline hợp nhất.
- Rule quá hạn rõ ràng.
- Ghi nhận showroom visit thành log riêng.
- Ghi nhận mua căn bản bằng bảng riêng hoặc chuẩn hóa `deals`.

### Giai đoạn 4: Làm kỹ KPI sale

Việc làm:

- Định nghĩa metric KPI tự động.
- Tách KPI proposal và KPI tự động.
- Chặn care log rỗng/quá ngắn.
- Tạo KPI snapshot theo tháng.
- Test các tình huống gian lận/sai lệch.

### Giai đoạn 5: Làm dashboard quản lý

Việc làm:

- Dashboard theo câu hỏi quản trị.
- Sale ranking.
- Khách quá hạn theo sale.
- Kênh khách hiệu quả.
- Khách tiềm năng cao.
- KPI pending/late approval.

### Giai đoạn 6: Bảo mật và kiểm thử

Việc làm:

- Chạy Phase F SQL sau backup.
- Test Phase G bằng admin/manager/sale.
- Kiểm tra RLS thật trên Supabase.
- Kiểm tra audit log.
- Viết checklist deploy cố định.

## 18. Kết luận cuối

CRM-KOLORCERAMIC đang đi đúng hướng sau khi rút khỏi ERP/CMS, nhưng để thành CRM dùng thật bền vững thì trọng tâm tiếp theo không phải thêm tính năng lớn, mà là làm chắc ba trục:

1. Dữ liệu khách hàng sạch.
2. Chăm sóc/follow-up có timeline rõ.
3. KPI có quy tắc công bằng, chống sai lệch và có snapshot.

Ưu tiên gần nhất nên là:

1. Chạy và test Phase F/G sau backup Supabase.
2. Dọn code legacy ERP/CMS còn nằm trong `crm-app.js`.
3. Thiết kế follow-up task và showroom visit riêng.
4. Thiết kế KPI tự động + KPI snapshot.

