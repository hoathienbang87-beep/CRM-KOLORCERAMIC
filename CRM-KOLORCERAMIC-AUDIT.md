# CRM KOLORCERAMIC - Audit va Roadmap

Ngay lap bao cao: 2026-06-29

Muc tieu cua tai lieu nay la giup chu du an va nguoi phat trien theo doi tinh trang hien tai cua CRM, biet phan nao nen giu, phan nao can sua, va nang cap theo tung giai doan ma khong lam roi he thong dang chay.

## 1. Tong quan hien trang

Du an hien tai la CRM noi bo cho cong ty gach/ceramic, dang chay theo mo hinh:

- Frontend: HTML/CSS/JavaScript thuan.
- Hosting: Vercel.
- Database/Auth/Realtime/Storage: Supabase.
- Source code: GitHub repo `hoathienbang87-beep/CRM-KOLORCERAMIC`.
- Thu muc goc local: `D:\SUPABASE\CRM-KOLORCERAMIC`.

Ket luan ngan:

- App da co nhieu tinh nang dung duoc that, khong phai chi la demo.
- Nen giu Supabase va du lieu hien tai.
- Khong nen viet lai toan bo ngay.
- Can uu tien bao mat, schema/RLS, va tach code thanh module nho hon.

## 2. Stack hien tai

### Frontend

- `index.html`: shell UI chinh.
- `css/styles.css`: toan bo style.
- `js/app.js`: diem vao chinh, tai Supabase va import CRM logic.
- `js/features/crm-app.js`: logic nghiep vu va render UI chinh.
- `js/firebase.js`: adapter Supabase, giu API kieu Firebase cu.
- `js/vendor/supabase/`: Supabase client local de giam phu thuoc CDN luc login.

Nhan xet:

- Khong co React/Vue/build system.
- `crm-app.js` qua lon, kho bao tri.
- Ten `firebase.js` gay hieu nham vi thuc te khong con Firebase.

### Backend/database

- Supabase PostgreSQL.
- Frontend goi Supabase truc tiep.
- Khong co backend API rieng.

### Auth

- Supabase Auth.
- Email/password va Google OAuth.
- Quyen ung dung luu trong bang `app_users`.

### Firebase

- Khong dung Firebase that.
- Chi con adapter ten `firebase.js`.

## 3. Tinh nang hien co

### Dang nhap va phan quyen

Trang thai:

- Co dang nhap email/password.
- Co Google login.
- Co role `admin`, `manager`, `sale`.
- Co active/locked user.

Can cai thien:

- Can dam bao RLS trong Supabase khop voi role nay.
- Nen doi ten va tach module auth rieng.

### Quan ly khach hang

Trang thai:

- Them khach.
- Sua thong tin.
- Xoa mem.
- Admin xoa vinh vien.
- Kiem tra trung SDT qua `phone_index`.
- Sale chi thay khach theo owner/createdBy tren frontend.

Can cai thien:

- Can RLS that su tren bang `customers`.
- Nen chuyen thao tac tao khach + phone_index + audit sang Supabase RPC de dam bao transaction that.
- Nen co customer timeline ro hon.

### Cham soc khach

Trang thai:

- Co care log.
- Co ket qua cham.
- Co ngay hen cham tiep.
- Co canh bao can cham/qua han.
- Co lich hen hom nay.

Can cai thien:

- Nen tach `tasks` hoac `follow_up_tasks` rieng.
- Nen co trang thai hoan thanh/qua han/nhac viec ro hon.

### Don hang / giao dich

Trang thai:

- Co `deals`.
- Co dat coc/da mua/huy.
- Co san pham trong don.
- Co doanh so co ban.

Can cai thien:

- `deals` dang kiem nhieu vai tro.
- Nen tach `quotes`, `orders`, `order_items`, `payments` neu muon CRM that hon.

### KPI

Trang thai:

- Co KPI rules.
- Co gan KPI cho nhan vien.
- Sale de xuat KPI.
- Co anh minh chung.
- Manager/admin duyet/tu choi.
- Proposal pending thang cu van can hien de duyet.

Can cai thien:

- Nen co trang thai va lich su review rieng.
- Nen co bao cao KPI theo ky ro rang hon.
- Nen private storage neu anh minh chung nhay cam.

### San pham

Trang thai:

- Co danh muc san pham.
- Co import CSV.
- Co loc/tim san pham.

Can cai thien:

- Nen chuan hoa product schema.
- Neu sau nay lam ERP mini, can them ton kho, gia von, bang gia, nha cung cap.

### Dashboard/bao cao

Trang thai:

- Co dashboard quan tri.
- Co pipeline.
- Co bieu do tang truong.
- Co bao cao theo kenh chi tiet.
- Co export Excel.

Can cai thien:

- Chart dang ve canvas thu cong, kho mo rong.
- Nen dung chart library hoac component rieng.
- Nen them dashboard theo vai tro.

## 4. Bao mat

### Diem tot

- Khong thay service role key trong frontend.
- `anonKey` Supabase trong frontend la binh thuong.
- Da co mot so SQL RLS cho:
  - `app_users`
  - `kpi_proposals`
  - `audit_logs`
  - `user_sessions`
  - storage `kpi-evidence`

### Rui ro can kiem tra gap

Repo chua co day du SQL/RLS cho cac bang quan trong:

- `customers`
- `care_logs`
- `deals`
- `products`
- `kpi_rules`
- `settings`
- `phone_index`

Neu RLS tren Supabase that chua chat, sale co the doc/sua du lieu ngoai quyen bang cach goi API truc tiep.

### Viec can lam

- [ ] Export schema that tu Supabase.
- [ ] Kiem tra tat ca bang da enable RLS.
- [ ] Viet policy cho sale chi doc/sua du lieu thuoc owner/created_by.
- [ ] Manager/admin doc du lieu pham vi cong ty.
- [ ] Admin moi duoc xoa vinh vien, cleanup, sua settings he thong.
- [ ] Chuyen cac thao tac nhay cam sang RPC.
- [ ] Xem lai bucket `kpi-evidence`: public hay private.

## 5. Database/data model

### Bang hien app dang dung

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
- `user_sessions`

### Van de

- Schema SQL trong repo chua day du.
- Mot so bang dung `raw_data jsonb`, tien khi migrate nhung de lon xon ve sau.
- `deals` va `orders` chua tach ro.
- Chua co module quote dung nghia.
- Chua co task/follow-up rieng.

### De xuat schema dai han

- `customers`
- `customer_contacts` hoac `care_logs`
- `tasks`
- `deals`
- `quotes`
- `orders`
- `order_items`
- `products`
- `kpi_rules`
- `kpi_proposals`
- `kpi_reviews`
- `attachments`
- `audit_logs`
- `teams`

## 6. UI/UX

### Ly do app co cam giac so sai

- Qua nhieu chuc nang don vao mot man hinh.
- Sidebar them khach luon hien, lam giao dien nang.
- Bang qua rong, phu thuoc scroll ngang.
- Nhieu nut ky thuat hien trong app: tao settings, dong bo, cleanup.
- Drawer chi tiet chua that gon.
- Bieu do thu cong, it cam giac san pham hoan chinh.
- Chua co design system ro rang.

### Diem dang co

- Co toast/notice.
- Co loading state cho button.
- Co saving mask.
- Co empty state co ban.
- Co responsive CSS.

### Can cai thien

- [ ] Tach man hinh theo role va nghiep vu.
- [ ] Mobile dung card list thay vi table rong.
- [ ] Dung modal confirm dep hon `confirm()`.
- [ ] Them skeleton/loading cho bang lon.
- [ ] Don cac nut ky thuat vao khu vuc Bao tri he thong.
- [ ] Chuan hoa mau sac, typography, spacing.

## 7. Phan nen giu, refactor, viet lai, bo

### Nen giu

- Supabase.
- Du lieu hien tai.
- Login va role co ban.
- Luong khach hang/cham soc/KPI dang quen voi nguoi dung.
- Export Excel.
- KPI proposal + minh chung.

### Nen refactor

- `crm-app.js` thanh cac module:
  - `auth`
  - `customers`
  - `care`
  - `deals`
  - `products`
  - `kpi`
  - `reports`
  - `admin`
  - `ui`
- `firebase.js` doi thanh `supabase-adapter.js`.
- Data access layer.
- SQL schema/RLS.

### Nen viet lai mot phan

- Dashboard/report UI.
- Module quote/bao gia.
- Module order/order items.
- Task/follow-up.
- User management neu can phan quyen sau.

### Nen bo hoac an

- Nut ky thuat khoi UI thuong:
  - Tao SETTINGS
  - Dong bo SDT
  - Dong bo NV
  - Cleanup phoneIndex
  - Cleanup orphan
- Chi hien cac nut nay trong man Bao tri he thong cho admin.

## 8. Roadmap

### Giai doan 1: Sua nen mong va bao mat

Muc tieu: app an toan, it loi, khong ro du lieu.

- [ ] Backup Supabase.
- [ ] Export schema/RLS that.
- [ ] Tao file migration day du.
- [ ] Bo sung RLS cho cac bang core.
- [ ] Chuyen tao khach/trung SDT/xoa sang RPC.
- [ ] An nut ky thuat.
- [ ] Kiem tra storage KPI evidence.
- [ ] Doi ten adapter Firebase.
- [ ] Tach code auth/data access dau tien.

### Giai doan 2: Nang CRM thanh dung that

Muc tieu: sale/manager dung hang ngay on dinh.

- [ ] Chuan hoa pipeline.
- [ ] Them task/follow-up.
- [ ] Tach quote/order/order_items.
- [ ] Hoan thien customer timeline.
- [ ] Hoan thien KPI workflow.
- [ ] Bao cao doanh so/KPI theo thang/quy/nam.
- [ ] Audit log day du.

### Giai doan 3: Nang UI/UX chuyen nghiep

Muc tieu: giao dien nhin nhu san pham noi bo nghiem tuc.

- [ ] Tao dashboard rieng theo role.
- [ ] Cai thien mobile/tablet.
- [ ] Dung chart library.
- [ ] Thiet ke lai table/filter/form.
- [ ] Loading/empty/error state dong bo.
- [ ] Modal confirm thay browser confirm.
- [ ] Don mau sac va spacing.

### Giai doan 4: Mo rong ERP mini neu can

Muc tieu: tu CRM sang van hanh ban hang.

- [ ] Ton kho.
- [ ] Nhap/xuat hang.
- [ ] Bao gia PDF.
- [ ] Don hang/invoice.
- [ ] Cong no/thanh toan.
- [ ] Chinh sach gia.
- [ ] Nha cung cap.
- [ ] Bao cao lanh dao.

## 9. Checklist uu tien ngay

Nen lam truoc theo thu tu:

1. [ ] Kiem tra RLS that tren Supabase cho `customers`, `care_logs`, `deals`.
2. [ ] Tao file SQL schema/RLS day du trong repo.
3. [ ] An nut ky thuat khoi UI thuong.
4. [ ] Tach `crm-app.js` thanh module nho.
5. [ ] Chuyen thao tac tao khach sang RPC.
6. [ ] Tach quote/order ra khoi deals neu nghiep vu da ro.
7. [ ] Cai thien UI dashboard va customer detail.

## 10. Ket luan

Huong tot nhat khong phai dap di lam lai ngay. Nen giu nen Supabase va du lieu, sau do nang cap co kiem soat:

1. Bao mat va schema.
2. Refactor code.
3. Hoan thien nghiep vu CRM.
4. Nang UI/UX.
5. Mo rong ERP neu that su can.

