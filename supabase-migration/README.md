# Firebase -> Supabase Migration

Thư mục này dùng để chuyển dữ liệu CRM từ Firestore sang Supabase.

## 1. Tạo Supabase project

Vào Supabase, tạo project mới rồi lấy:

- `Project URL`
- `service_role key`

Không đưa `service_role key` vào frontend. Key này chỉ dùng cho script migration trên máy.

## 2. Tạo bảng trong Supabase

Mở Supabase SQL Editor, chạy toàn bộ file:

```text
D:\crm-firebase\supabase\schema.sql
```

Schema này tạo các bảng:

- `app_users`
- `settings`
- `customers`
- `care_logs`
- `deals`
- `products`
- `kpi_rules`
- `kpi_proposals`
- `phone_index`
- `audit_logs`

Mỗi bảng có cột quan trọng để query/report nhanh và cột `raw_data jsonb` để giữ nguyên dữ liệu Firestore gốc.

## 3. Chuẩn bị Firebase service account

Trong Firebase Console:

1. Project settings
2. Service accounts
3. Generate new private key
4. Lưu file JSON vào thư mục an toàn, ví dụ:

```text
D:\secure\firebase-service-account.json
```

## 4. Cài dependency

```powershell
cd D:\crm-firebase\supabase-migration
copy .env.example .env
npm install
```

Mở `.env` và điền:

```text
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
GOOGLE_APPLICATION_CREDENTIALS=D:\secure\firebase-service-account.json
```

## 5. Chạy thử trước

```powershell
npm run dry-run
```

Lệnh này chỉ đếm số dòng từng collection, chưa ghi sang Supabase.

## 6. Chạy migrate thật

```powershell
npm run migrate
```

Script dùng `upsert`, nên nếu chạy lại cùng dữ liệu thì sẽ cập nhật theo `id`, không tạo trùng.

## 7. Kiểm tra sau migration

Trong Supabase Table Editor kiểm tra nhanh:

- `customers`: số khách hàng
- `care_logs`: lịch sử chăm sóc
- `deals`: đơn hàng
- `kpi_rules`: KPI tháng
- `kpi_proposals`: đề xuất KPI
- `app_users`: user và role

## Lưu ý về đăng nhập

Firestore `users` chỉ là hồ sơ phân quyền của app, không phải tài khoản Supabase Auth.

Khi chuyển web sang Supabase, cần tạo user trong Supabase Auth bằng email rồi dùng bảng `app_users` để map quyền `admin`, `manager`, `sale`.
