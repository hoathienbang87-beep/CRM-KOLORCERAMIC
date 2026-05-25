# CRM Firebase - Production Checklist

Checklist này dùng trước khi chuyển CRM từ giai đoạn test sang chạy thật.

## 1. Chưa Động Vào Dữ Liệu

- Không bấm các nút `Dọn dữ liệu`, `Cleanup phoneIndex`, `Cleanup orphan`, `Xóa vĩnh viễn` khi chưa backup.
- Không deploy hosting/rules nếu chưa biết project Firebase đang trỏ tới đâu.
- Xác nhận project hiện tại:

```bash
firebase.cmd use
```

Project đúng hiện tại: `project-ffc49bd5-9852-4aa9-b6b`.

## 2. Backup Firestore

Trước khi chạy thật hoặc sửa rules, nên export dữ liệu Firestore ra Cloud Storage.

```bash
gcloud firestore export gs://YOUR_BACKUP_BUCKET/crm-backup-YYYY-MM-DD
```

Nếu chưa có bucket backup, tạo trước trên Google Cloud Storage rồi mới export.

Các collection quan trọng cần có trong backup:

- `customers`
- `careLogs`
- `deals`
- `phoneIndex`
- `users`
- `settings`
- `kpiRules`
- `kpiProposals`
- `auditLogs`
- `userSessions`

## 3. Kiểm Tra Firebase Rules

Rules hiện đã chặn mặc định ở cuối file:

```txt
match /{document=**} {
  allow read, write: if false;
}
```

Trước khi deploy:

```bash
firebase.cmd deploy --only firestore:rules --project project-ffc49bd5-9852-4aa9-b6b
```

Sau deploy, test đăng nhập bằng 3 loại tài khoản:

- `admin`: quản lý user, settings, dropdown, thùng rác, audit, cleanup.
- `manager`: xem dữ liệu đội/CRM, tạo KPI, chỉnh chăm sóc.
- `sale`: chỉ xem/sửa khách của mình.

## 4. Kiểm Tra Users Trước Khi Chạy Thật

Trong Firestore collection `users`, mỗi tài khoản cần có:

```js
{
  email: "user@example.com",
  name: "Tên nhân viên",
  role: "admin" | "manager" | "sale",
  active: true,
  canExport: true | false,
  team: ""
}
```

Lưu ý:

- User mới đăng nhập lần đầu sẽ tự tạo doc `users/{uid}` với `role: "sale"` và `active: false`.
- Admin cần bật `active: true` trước khi user dùng CRM.
- Không cấp `admin` rộng rãi.
- `canExport: true` chỉ cấp cho người được phép xuất dữ liệu.

## 5. Test Role Admin

Đăng nhập admin và kiểm tra:

- Tạo/cập nhật `SETTINGS`.
- Sửa dropdown.
- Tạo/sửa nhân viên.
- Xem audit log.
- Xem thùng rác.
- Tạo khách mới.
- Thêm chăm sóc.
- Thêm đơn hàng.
- Export Excel.

Chỉ test các nút nguy hiểm sau khi đã backup:

- `Cleanup phoneIndex`
- `Cleanup orphan`
- `Dọn dữ liệu`
- `Xóa vĩnh viễn`

## 6. Test Role Manager

Đăng nhập manager và kiểm tra:

- Xem danh sách khách theo quyền manager.
- Tạo khách.
- Chỉnh chăm sóc.
- Thêm đơn hàng.
- Duyệt/từ chối đề xuất KPI.
- Lưu `careDueDays` trong thiết lập chăm sóc.

Quyết định production:

- Manager được ẩn/xóa mềm khách.
- Manager chỉ được soft-delete `careLogs` liên quan bằng các field giới hạn: `isDeleted`, `deletedAt`, `deletedByEmail`, `updatedAt`, `updatedByEmail`.
- Manager không được xóa cứng `careLogs`.
- `deals` hiện đã cho manager update theo rules.

## 7. Test Role Sale

Đăng nhập sale và kiểm tra:

- Sale chỉ thấy khách của mình qua `ownerEmail`, `createdByEmail`, hoặc `owner`.
- Sale tạo khách mới được.
- Sale không đổi được chủ sở hữu khách.
- Sale chỉ cập nhật các field được rules cho phép.
- Sale không thấy user admin, settings admin, audit log, thùng rác.
- Sale không dùng được import/cleanup/sync.

## 8. Test Chống Trùng SĐT

Tạo 2 khách cùng số điện thoại:

- Lần 1 phải tạo được.
- Lần 2 phải bị chặn bởi `phoneIndex`.

Sau khi ẩn/xóa mềm khách:

- `phoneIndex` của khách đó phải được giải phóng.
- Có thể nhập lại SĐT nếu cần.

## 9. Test Import CSV

Chỉ test bằng file nhỏ 3-5 dòng trước.

Kiểm tra:

- Cột tên khách.
- Cột SĐT.
- Cột owner/email nhân viên.
- Dòng trùng SĐT bị bỏ qua.
- Audit log có ghi `importCustomerCsv`.

Không import file lớn khi chưa backup.

## 10. Test Báo Giá / Đề Xuất

Apps Script nằm ở:

```txt
apps-script/quote_service.gs
```

Cần xác nhận:

- `TEMPLATE_ID` đúng file Google Sheet mẫu.
- Tài khoản deploy Apps Script có quyền đọc template.
- Folder output đúng nhu cầu.
- Link `quoteTemplateUrl` trong settings đúng.
- File tạo ra mở được Google Sheet / Excel.

## 11. Deploy Hosting

Sau khi test rules và role ổn:

```bash
firebase.cmd deploy --only hosting --project project-ffc49bd5-9852-4aa9-b6b
```

Nếu deploy cả rules và hosting:

```bash
firebase.cmd deploy --only firestore:rules,hosting --project project-ffc49bd5-9852-4aa9-b6b
```

## 12. Rollback

Nếu hosting lỗi:

- Vào Firebase Console > Hosting > Release history.
- Chọn bản deploy trước đó và rollback.

Nếu rules lỗi:

- Sửa `firestore.rules`.
- Deploy lại rules.

Nếu dữ liệu lỗi:

- Dừng thao tác trên app.
- Restore từ bản Firestore export gần nhất.

## 13. Khuyến Nghị Sau Khi Chạy Ổn

- Tách `public/index.html` thành các file nhỏ hơn: `style.css`, `firebase.js`, `customers.js`, `settings.js`, `admin.js`.
- Chuẩn hóa role chỉ còn: `admin`, `manager`, `sale`.
- Chuẩn hóa tiếng Việt encoding trong comments/thông báo còn lỗi.
- Thêm tài liệu hướng dẫn nhập CSV cho nhân viên.
- Cân nhắc bật App Check nếu có API public nhạy cảm.
