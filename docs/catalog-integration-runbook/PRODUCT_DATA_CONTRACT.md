# Product Data Contract

Phiên bản: `01A-2026-09-22`

Trạng thái tài liệu: đề xuất hoàn tất, chờ phê duyệt prompt `01A`

Phạm vi: contract dữ liệu; **không phải migration và không được dùng để ghi production**.

## 1. Nguồn và baseline được dùng

Contract này được chốt từ các nguồn read-only sau:

- Supabase snapshot production ref `jjeeazwlqcwynzquimeo`: 75 sản phẩm, SHA-256 `1a73ec6f51c63c482e02b49999e075b500846716de11029410ebd191f560a580`.
- Firebase project `kolor-ceramics`: 406 sản phẩm, SHA-256 `ef4746ee8b1c630a9b9c97cafcd255369ecf69e37a51b6491292ffee3f299d69`.
- Bảng giá Excel: 224 dòng sản phẩm, SHA-256 `608d15685354aa2523fa9772d582e1c3d91790a3a70059a03d1b7691efe42b18`.
- Workbook reconciliation: 52 identity match tự động, 104 dòng cần duyệt và 359 ứng viên tạo draft.
- Workbook finalized SHA-256 `bdbe0ac5c1832391db83a9a55a6b90eb4359efd8644df4b45336c465ae7e1dd8`: giữ 102 dòng, gồm 95 `READY`, 7 `UPDATING`; loại STT 22 và 24.

Snapshot là export cấp ứng dụng, không phải binary database dump. Mọi migration sau này phải đọc lại schema và số lượng trên môi trường đích trước khi chạy.

## 2. Nguyên tắc bất biến

1. `public.products` là nguồn catalog sản phẩm duy nhất sau tích hợp.
2. `products.id` là UUID nội bộ, bất biến. Không chuyển đổi hoặc thay ID của 75 sản phẩm Supabase hiện hữu.
3. ID Firebase dạng `SP-*` là source ID, không phải primary key UUID. ID này phải được giữ trong bảng ánh xạ nguồn.
4. Tên chuẩn không chứa quy cách hoặc hậu tố bề mặt.
5. Kích thước chuẩn lưu bằng millimet (`width_mm`, `height_mm`); centimet chỉ là định dạng hiển thị/tương thích tạm thời.
6. Giá niêm yết theo m² là số nguyên VNĐ và có thể `NULL`. Giá thiếu không bao giờ được thay bằng `0`.
7. Một biến thể được xác định bằng tên chuẩn + kích thước có thứ tự + bề mặt chuẩn.
8. Bề mặt có thể `NULL`; thiếu bề mặt không tự cho phép ghép khi có nhiều ứng viên.
9. Bản ghi thiếu tên, kích thước hoặc giá không được published và phải hiển thị `Đang cập nhật` trong giao diện nội bộ.
10. URL media ngoài được giữ nguyên; không sao chép media catalog vào Supabase Storage trong lần tích hợp đầu.
11. Website công khai không đọc trực tiếp bảng gốc. Public API chỉ trả whitelist của sản phẩm active, ready và published.
12. Báo giá lưu snapshot bất biến; thay đổi catalog/giá không sửa báo giá lịch sử.

## 3. Entity `products`

### 3.1 Trường nhận diện và catalog

| Trường | Kiểu contract | Null | Công khai | Quy tắc |
|---|---|---:|---:|---|
| `id` | `uuid` | Không | Có | PK nội bộ, bất biến; giữ nguyên 75 UUID hiện hữu. |
| `code` | `text` | Có | Có | SKU/mã nhà cung cấp. Không tự bịa mã cho Firebase record không có code. |
| `code_normalized` | `text` generated/managed | Có | Không | Unicode NFKC, trim, gộp khoảng trắng, uppercase; unique khi khác `NULL`. |
| `name` | `text` | Không trong `products` | Có | Không chứa quy cách/bề mặt; trim, không chuỗi rỗng. Dòng chưa có tên chỉ ở staging cho tới khi có thể tạo identity an toàn. |
| `name_normalized` | `text` generated/managed | Có | Không | Unicode NFKC, trim, gộp khoảng trắng, uppercase; dùng matching/variant key. |
| `width_mm` | `integer` | Có | Có | `> 0`; không tự đảo chiều. |
| `height_mm` | `integer` | Có | Có | `> 0`; không tự đảo chiều. |
| `surface` | `text` | Có | Có | Giá trị hiển thị đã trim, ví dụ `POLISH`, `MATT`, `GLOSSY`. |
| `surface_normalized` | `text` generated/managed | Có | Không | NFKC + uppercase; `NULL` vẫn là một trạng thái variant riêng. |
| `origin` | `text` | Có | Có | Xuất xứ hiển thị. |
| `color` | `text` | Có | Có | Màu catalog. |
| `category` | `text` | Có | Có | Nhóm catalog. |
| `collection` | `text` | Có | Có | Bộ sưu tập. |
| `description` | `text` | Có | Có | Nội dung catalog đã kiểm duyệt. |

`size_display` là trường dẫn xuất, không lưu làm nguồn chuẩn: chia mm cho 10 và bỏ số 0 thừa, ví dụ `600 × 1200 mm` hiển thị `60 × 120 cm`.

### 3.2 Giá, đóng gói và tồn kho

| Trường | Kiểu contract | Null | Công khai | Quy tắc |
|---|---|---:|---:|---|
| `price_per_m2` | `numeric(18,0)` | Có | Có | Giá niêm yết VNĐ/m², phải `> 0` khi có giá. Đây là trường giá canonical để tương thích code hiện tại. |
| `price_unit` | `text` | Không | Có | Giá trị contract `VND_M2`; giao diện hiển thị `VNĐ/m²`. |
| `price_effective_date` | `date` | Có | Có | Bắt buộc khi `price_per_m2` khác `NULL`. |
| `price_per_box` | `numeric(18,0)` | Có | Không | CRM/đóng gói, `> 0` khi có. |
| `price_per_piece` | `numeric(18,0)` | Có | Không | CRM/đóng gói, `> 0` khi có. |
| `pieces_per_box` | `integer` | Có | Không | `> 0` khi có. |
| `sqm_per_box` | `numeric(12,4)` | Có | Không | `> 0` khi có. |
| `stock_quantity` | `numeric(18,4)` | Có | Không | Tồn tham khảo CRM; `NULL` là chưa biết, `0` là hết hàng thật. |

Chuẩn hóa input giá chấp nhận `1.915.000`, `1,915,000` hoặc `1915000` ở parser, nhưng database chỉ nhận giá trị số `1915000`. Giao diện dùng locale `vi-VN` để hiển thị `1.915.000`; không lưu dấu phân tách.

### 3.3 Media ngoài

| Trường | Kiểu contract | Null | Công khai | Quy tắc |
|---|---|---:|---:|---|
| `image_url` | `text` | Có | Có | URL HTTPS ảnh chính. |
| `gallery_urls` | `jsonb` array string | Không | Có | Mặc định `[]`; từng phần tử là URL HTTPS. |
| `pdf_url` | `text` | Có | Có | URL HTTPS tài liệu catalog. |
| `video_url` | `text` | Có | Có | URL HTTPS video. |
| `more_info_url` | `text` | Có | Có | URL HTTPS trang thông tin cũ nếu có. |

Không lưu token, signed URL dài hạn hoặc credential trong các trường media. Supabase Storage chỉ dùng cho source import riêng tư và minh chứng nội bộ theo policy riêng.

### 3.4 Trạng thái và audit

| Trường | Kiểu contract | Null | Công khai | Quy tắc |
|---|---|---:|---:|---|
| `data_status` | `text` | Không | Không | Chỉ `UPDATING` hoặc `READY`. |
| `is_published` | `boolean` | Không | Không | Mặc định `false`; chỉ được `true` khi ready và active. |
| `active` | `boolean` | Không | Không | Trạng thái sử dụng trong CRM; giữ nguyên 75 giá trị hiện hữu. |
| `version` | `bigint` | Không | Không | Optimistic concurrency, tăng khi thay đổi vật chất. |
| `created_at` / `updated_at` | `timestamptz` | Không | Không | Timestamp hệ thống. |
| `created_by_user_id` / `updated_by_user_id` | `text` FK | Không | Không | Actor nội bộ; không trả qua public API. |
| `source_metadata` | `jsonb` | Không | Không | Mặc định `{}`; provenance không chứa secret hoặc dữ liệu khách hàng. |

Quy tắc trạng thái:

- `READY` khi `name` không rỗng, `width_mm > 0`, `height_mm > 0`, `price_per_m2 > 0` và `price_effective_date` có giá trị.
- `UPDATING` khi thiếu ít nhất một trường bắt buộc trên. Label tiếng Việt là `Đang cập nhật`; không ghi label này vào trường số.
- `is_published = true` chỉ hợp lệ khi `data_status = 'READY'` và `active = true`.
- `surface` không phải trường bắt buộc để ready, nhưng surface `NULL` làm matching thận trọng hơn.
- Bản ghi chưa có `name` không được tạo product identity; nó ở lại `product_import_rows` với trạng thái draft/review cho tới khi có tên.

75 sản phẩm hiện hữu đều có tên, kích thước và giá nên có thể backfill `READY`; `is_published` vẫn phải là `false` cho đến một phê duyệt publish riêng.

## 4. Kích thước và lớp tương thích cm

Contract canonical là mm:

- Input `600x1200 mm` → `width_mm=600`, `height_mm=1200`.
- Input `60x120 cm` → `width_mm=600`, `height_mm=1200`.
- Không tự đổi `600x1200` thành `1200x600` và không dùng phép sắp xếp cạnh trong variant key.
- Chỉ tự chuyển đổi khi đơn vị được xác định an toàn. Dữ liệu không đơn vị hoặc không chuyển chính xác sang số nguyên mm phải vào review.

Schema hiện tại dùng `width_cm numeric(9,3)` và `height_cm numeric(9,3)`. Giai đoạn tương thích phải:

1. Thêm `width_mm`, `height_mm` nullable.
2. Backfill đúng `width_mm = width_cm * 10`, `height_mm = height_cm * 10` cho 75 sản phẩm; fail closed nếu kết quả không phải số nguyên dương.
3. Giữ `width_cm`, `height_cm` trong giai đoạn chuyển tiếp để RPC/UI cũ tiếp tục hoạt động.
4. Mọi write path mới ghi mm và dual-write cm chính xác; không cho hai cặp sai khác.
5. API mới chỉ coi mm là nguồn chuẩn. Việc retire cột cm cần prompt/migration riêng sau khi toàn bộ consumer chuyển đổi.

Để biểu diễn draft có tên nhưng thiếu kích thước/giá mà không dùng giá trị giả, migration `01B` phải nới `NOT NULL` một cách không phá dữ liệu cho `code`, `code_normalized`, `width_cm`, `height_cm`, `price_per_m2` và `price_effective_date`. Đây là constraint relaxation có chủ đích; không drop cột, không đổi kiểu, không xóa hoặc sửa giá trị hiện hữu. Dòng chưa có tên vẫn ở `product_import_rows`, không được promote sang `products`.

### 4.1 Ma trận tương thích baseline → contract

| Baseline hiện tại | Contract đích | Cách tương thích |
|---|---|---|
| `id uuid` | `id uuid` | Giữ nguyên tuyệt đối. |
| `code text NOT NULL UNIQUE` | `code text NULL`, unique khi có giá trị | Nới null; 75 code hiện tại không đổi. |
| `name text NOT NULL` | `name text NOT NULL` | Giữ nguyên; thiếu tên ở staging. |
| `width_cm`, `height_cm` | `width_mm`, `height_mm` canonical | Thêm mm, backfill chính xác, dual-write cm trong chuyển tiếp. |
| `price_per_m2 NOT NULL` | `price_per_m2 NULL` | Nới null để draft; không thay 75 giá hiện tại. |
| `price_effective_date NOT NULL` | Nullable khi chưa có giá | Khi có giá thì ngày hiệu lực bắt buộc. |
| `active` | `active` + `data_status` + `is_published` | Giữ active; thêm readiness và publish gate. |
| Không có media catalog | Các URL/media field nullable | Chỉ thêm cột; fill qua batch đã duyệt. |
| Không có source mapping | `product_source_mappings` | UUID vẫn là PK; `SP-*` ở mapping. |

## 5. Variant identity và duplicate

Variant key logic:

```text
(name_normalized, width_mm, height_mm, coalesce(surface_normalized, ''))
```

- Cùng tên nhưng khác kích thước: variant riêng.
- Cùng tên + kích thước nhưng khác bề mặt: variant riêng.
- Chỉ duplicate khi trùng đủ variant key.
- Duplicate cùng variant nhưng khác giá là conflict giá, không tự xóa.
- Hai variant khác nhau có cùng giá là cảnh báo, không phải duplicate.
- Fuzzy match chỉ tạo gợi ý thủ công.
- Unique enforcement chỉ được bật cho dữ liệu `READY` sau khi kiểm tra backfill/duplicate; không áp unique mù lên dữ liệu chưa duyệt.

Thứ tự matching chính thức:

1. Product UUID/source ID chính xác.
2. Code/SKU không rỗng, chính xác và duy nhất.
3. Tên chuẩn + size mm + surface chuẩn, chính xác và duy nhất.
4. Tên chuẩn + size mm chính xác và duy nhất, chỉ khi không xung đột surface.
5. Thủ công. Fuzzy không bao giờ auto-apply.

## 6. Source ID và provenance

Tạo contract `product_source_mappings`:

| Trường | Kiểu | Quy tắc |
|---|---|---|
| `id` | `uuid` | PK. |
| `product_id` | `uuid` | FK `products(id) ON DELETE RESTRICT`. |
| `source_system` | `text` | Ví dụ `FIREBASE`, `EXCEL`, `MANUAL`. |
| `source_id` | `text` | ID nguồn nguyên bản, gồm `SP-*`. |
| `source_checksum` | `text` | SHA-256 record/file khi có. |
| `match_rule` | `text` | Quy tắc ghép đã dùng. |
| `verified` | `boolean` | Chỉ true sau review/auto-match an toàn. |
| `metadata` | `jsonb` | Tham chiếu dòng/trang, không chứa secret. |
| `created_at` / `created_by_user_id` | audit | Actor và thời điểm. |

Ràng buộc `unique(source_system, source_id)` bảo đảm một source ID không trỏ tới nhiều sản phẩm. Một product có thể có nhiều source mapping.

- 75 UUID Supabase hiện hữu giữ nguyên tuyệt đối.
- Với Firebase record đã ghép, tạo mapping `FIREBASE + SP-*` tới UUID hiện hữu.
- Với Firebase record mới đủ điều kiện, tạo UUID mới rồi gắn mapping `SP-*`; không ép `SP-*` thành UUID.
- 359 ứng viên mới chưa mặc nhiên được tạo/published; giữ trong staging cho tới quyết định batch.
- STT 22 và 24 mang disposition `EXCLUDED_BY_REVIEW`, giữ provenance/audit nhưng không insert/update product.

## 7. Phân loại trường công khai và nội bộ

### Public catalog whitelist

`id`, `code`, `name`, `width_mm`, `height_mm`, `size_display`, `surface`, `origin`, `color`, `category`, `collection`, `description`, `image_url`, `gallery_urls`, `pdf_url`, `video_url`, `more_info_url`, `price_per_m2`, `price_unit`, `price_effective_date`.

Public API chỉ trả sản phẩm thỏa `active=true AND data_status='READY' AND is_published=true`. Không trả record `UPDATING`, unpublished hoặc archived.

### CRM picker whitelist

`id`, `code`, `name`, `width_mm`, `height_mm`, `size_display`, `surface`, `origin`, `price_per_m2`, `price_unit`, `active`, `version`.

CRM picker chỉ đọc; sale không được sửa catalog hoặc chạy import.

### Nội bộ tuyệt đối

Normalization fields, source mapping/checksum, source metadata, import batch/row, duplicate/conflict reason, stock, package price, actor IDs, timestamps, version internals, audit logs, publish control và dữ liệu rollback.

## 8. Quyền truy cập

| Chủ thể | Đọc | Ghi |
|---|---|---|
| `anon` | Chỉ public catalog RPC/view whitelist | Không |
| Sale authenticated | CRM picker cho active/ready | Không |
| Manager authenticated | CRM picker và dữ liệu vận hành được cấp | Không mặc nhiên có quyền catalog |
| Catalog admin | Đọc catalog/draft/import; review | Qua RPC kiểm soát, có version/audit |
| Owner | Như catalog admin | Qua RPC kiểm soát |
| Edge Function service role | Chỉ boundary kỹ thuật đã định nghĩa | Không được lộ cho browser |

`catalog_admin` là capability riêng; ánh xạ ban đầu chỉ cho `admin`/`owner`, không suy diễn từ quyền sale/manager. Bảng gốc không cấp `INSERT/UPDATE/DELETE` trực tiếp cho `anon` hoặc `authenticated`. RPC `SECURITY DEFINER` phải pin `search_path`, kiểm tra actor/capability và ghi audit.

RLS/public API không được trả stock, source metadata, user ID, audit, import source hoặc dữ liệu CRM khác.

## 9. Import và lịch sử giá

- `CATALOG_IMPORT`: có thể tạo draft/new product sau preview và phê duyệt.
- `PRICE_UPDATE_ONLY`: chỉ cập nhật product hiện hữu; không tạo mới.
- Ô giá trống trong price-only là `MISSING_PRICE`, bỏ qua; không xóa giá cũ.
- PDF/OCR chỉ stage; Excel cũng phải preview trước apply.
- Apply dùng batch ID, idempotency key, expected version/fingerprint và transaction.
- Mọi thay đổi giá tạo record bất biến trong `product_price_history` gồm giá cũ/mới hoặc đủ snapshot giá, effective date, source type, batch, actor và timestamp.
- Rollback là một mutation mới có audit; không sửa/xóa history cũ.
- File nguồn riêng tư được kiểm tra SHA-256, kích thước và quyền trước apply.

Các bảng import/history hiện có được giữ tương thích; prompt sau có thể mở rộng enum/source type từ PDF-only sang Excel và catalog/price-only mà không xóa lịch sử cũ.

## 10. Snapshot báo giá

Mỗi `quote_items` phải giữ snapshot tại thời điểm tạo:

| Trường snapshot | Ý nghĩa |
|---|---|
| `product_id` | FK UUID nullable `ON DELETE SET NULL`; chỉ để tham chiếu hiện tại. |
| `product_code_snapshot` | Code/SKU tại thời điểm báo giá. |
| `product_name_snapshot` | Tên tại thời điểm báo giá. |
| `width_mm_snapshot`, `height_mm_snapshot` | Kích thước chuẩn tại thời điểm báo giá. |
| `surface_snapshot` | Bề mặt tại thời điểm báo giá. |
| `list_price_snapshot` | Giá niêm yết VNĐ/m² khi chọn sản phẩm. |
| `quoted_price` | Giá thực tế dùng cho dòng báo giá. |
| `quantity`, `unit` | Số lượng và đơn vị giao dịch. |

Các cột hiện tại `product_sku`, `product_name`, `unit_price`, `qty`, `unit` tiếp tục hoạt động trong giai đoạn tương thích; `unit_price` được hiểu là `quoted_price`. Các snapshot còn thiếu phải được bổ sung additively. Render báo giá lịch sử chỉ đọc snapshot, không join lại giá/tên hiện tại để thay thế.

## 11. Kế hoạch tương thích theo tập dữ liệu

### 75 sản phẩm Supabase

- Giữ nguyên UUID, code, giá, active, version, actor và timestamp.
- Backfill mm từ cm bằng chuyển đổi chính xác; không thay đổi giá.
- Backfill `data_status=READY`; `is_published=false` cho tới gate publish riêng.
- Không tự tách surface khỏi tên trong migration schema; việc chuẩn hóa nội dung thuộc batch đã duyệt.

### 406 sản phẩm Firebase

- Đọc như source catalog, không overwrite trường CRM/audit/stock.
- Giữ `SP-*` trong source mapping.
- Media/metadata chỉ fill blank hoặc apply theo quyết định review.
- Firebase-only/new candidate mặc định là staging/draft, không published.

### Workbook đã duyệt

- 102 dòng được giữ: 95 đủ dữ liệu ready; 7 thiếu quy cách/giá ở `UPDATING` hoặc staging draft.
- 3 dòng thiếu quy cách và 6 dòng thiếu giá, có hai dòng chồng lắp; không dùng `0`.
- STT 22 và 24 bị loại, phải còn audit/provenance nhưng không import.
- 359 ứng viên insert draft trong reconciliation chưa được suy diễn là 359 product đã duyệt.

## 12. Gate cho migration `01B`

Migration sau chỉ được coi là tương thích khi:

1. Không xóa/đổi ID hoặc thay dữ liệu nghiệp vụ của 75 products.
2. Không drop table/cột và không truncate/delete dữ liệu.
3. Mọi field mới nullable hoặc có default an toàn; chỉ nới các `NOT NULL` đã liệt kê ở mục 4, không drop cột/đổi kiểu; backfill có verification và rollback plan.
4. Chuyển cm → mm fail closed nếu không chính xác.
5. Không biến `NULL` thành `0`, chuỗi `Đang cập nhật` hoặc mã giả.
6. Public/anon không có direct table read/write; sale không có catalog write.
7. Public contract chỉ trả whitelist và chỉ published/ready/active.
8. Source ID `SP-*` có uniqueness và không thay PK UUID.
9. Quote snapshot lịch sử tiếp tục đọc được.
10. Schema migration không import 406 Firebase, 102 quyết định hay 359 ứng viên.

## 13. Ngoài phạm vi prompt `01A`

- Không viết/chạy migration SQL.
- Không thay RPC, parser, UI hoặc RLS hiện tại.
- Không stage/import/apply dữ liệu.
- Không deploy.
- Không ghi Supabase/Firebase production.
