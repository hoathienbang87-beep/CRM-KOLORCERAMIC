# Giai đoạn 4.14 - Chuẩn hóa quy trình vận hành / deploy

## Mục tiêu

CRM Kolorceramic đang dùng dữ liệu thật, nên deploy không chỉ là `git push`. Mỗi lần đưa bản mới lên production cần có quy trình lặp lại được: backup trước, kiểm tra local, deploy, kiểm tra sau deploy và có hướng rollback nếu bản mới lỗi.

## Nền tảng đang dùng

- Frontend: static HTML/CSS/JavaScript.
- Hosting: Vercel, output directory là thư mục gốc repo.
- Database/Auth/Storage: Supabase.
- Storage bucket đang dùng: `kpi-evidence` cho ảnh minh chứng KPI.
- Git remote: GitHub repo `CRM-KOLORCERAMIC`.

## Checklist trước khi deploy

1. Kiểm tra Git sạch trước khi làm:

```powershell
git status --short
```

2. Chạy kiểm tra cú pháp JavaScript:

```powershell
node --check js/features/crm-app.js
```

3. Chạy kiểm tra whitespace/diff:

```powershell
git diff --check
```

4. Chạy local preview:

```powershell
python -m http.server 5181 --bind 127.0.0.1
```

Mở:

```text
http://127.0.0.1:5181/index.html
```

5. Test nhanh bằng 3 vai trò:

- Admin: đăng nhập, vào Quản trị, xem users, an toàn dữ liệu, audit.
- Manager: xem khách, đơn hàng, KPI, báo cáo, export được phần được phép.
- Sale: chỉ thấy dữ liệu thuộc quyền, tạo chăm sóc, tạo KPI đề xuất, tạo đơn/deal đúng quyền.

6. Nếu có đổi SQL/RLS/Storage policy, phải backup Supabase trước:

- Làm theo `PHASE-4-13-DATA-SAFETY-BACKUP.md`.
- Xuất thêm snapshot trong app: **Quản trị > An toàn dữ liệu > Xuất snapshot vận hành**.

7. Kiểm tra không commit nhầm dữ liệu nhạy cảm:

```powershell
git status --short
```

Không được có:

- `.env`, `.env.local`, `.env.production`.
- `service_role_key`.
- Database password.
- File `.sql`, `.dump`, `.backup`.
- File `.xlsx`, `.xls`, `.csv` chứa dữ liệu khách hàng thật.

## Checklist commit và push

Commit theo từng nhóm thay đổi rõ nghĩa:

```powershell
git add <file-1> <file-2>
git commit -m "Mo ta ngan gon thay doi"
git push
```

Sau khi push, Vercel sẽ tự deploy nếu project đang nối với branch production.

## Checklist sau deploy

Mở production:

```text
https://crmkolor.vercel.app/
```

Kiểm tra theo thứ tự:

1. Trang login hiện đúng.
2. Đăng nhập Google thành công.
3. Header hiện đúng email/tên/role.
4. Tab CRM tải được dashboard, khách cần chăm, pipeline.
5. Tab Khách hàng lọc/tìm kiếm được, mở drawer được.
6. Ghi chăm sóc khách thử với dữ liệu thật ít rủi ro.
7. Tab Đơn hàng mở chi tiết, sửa deal, thanh toán/công nợ nếu cần.
8. Tab KPI xem được rule, proposal chờ duyệt, ảnh minh chứng nếu có.
9. Tab Báo cáo tải được, export không lỗi.
10. Tab Quản trị chỉ admin thấy, manager/sale không thấy.

Nếu có lỗi, mở Vercel deployment logs và browser console để ghi lại:

- Thời điểm lỗi.
- Tài khoản đăng nhập.
- Tab đang thao tác.
- Thông báo lỗi.
- Ảnh chụp màn hình nếu có.

## Rollback khi bản mới lỗi

Ưu tiên rollback bằng Vercel:

1. Vào Vercel project.
2. Chọn tab Deployments.
3. Chọn bản deploy gần nhất còn ổn.
4. Bấm Promote to Production.

Nếu cần rollback bằng Git:

```powershell
git log --oneline -5
```

Tạo commit revert thay vì xóa lịch sử:

```powershell
git revert <commit_id>
git push
```

Không dùng `git reset --hard` trên repo đang làm việc nếu chưa chắc chắn vì dễ mất thay đổi.

## Quy tắc khi thay đổi database/RLS

Không chạy SQL trực tiếp trên production nếu chưa:

- Đọc lại toàn bộ câu SQL.
- Backup database.
- Kiểm tra câu lệnh không drop/truncate dữ liệu.
- Ưu tiên chạy trên project staging/test trước nếu có.

Sau khi đổi RLS, cần test tối thiểu:

- Sale không xem/sửa dữ liệu người khác.
- Manager xem được phạm vi được giao.
- Admin quản trị được toàn bộ.
- Các thao tác insert/update quan trọng không bị lỗi RLS: chăm sóc, KPI proposal, deal, payment, audit log.

## Quy tắc vận hành hàng ngày

- Không sửa dữ liệu trực tiếp trong Supabase nếu app đã có màn hình quản trị tương ứng.
- Trước import lớn: backup + snapshot.
- Cuối tuần hoặc trước thay đổi lớn: dump database.
- Khi nhân viên nghỉ: khóa user trong app trước, không xóa cứng ngay.
- Khi có lỗi từ người dùng: ghi lại tài khoản, thao tác, thời gian và ảnh chụp trước khi sửa.

## Đề xuất nâng cấp sau giai đoạn này

Nên có project Supabase staging riêng để test SQL/RLS trước khi đưa lên production. Khi có staging, quy trình deploy sẽ an toàn hơn nhiều:

1. Code mới chạy local.
2. SQL mới chạy staging.
3. Test vai trò trên staging.
4. Backup production.
5. Deploy production.
6. Kiểm tra sau deploy.

