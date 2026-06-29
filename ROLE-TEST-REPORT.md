# Bao cao kiem thu vai tro CRM-KOLORCERAMIC

Ngay kiem thu: 2026-06-30

Pham vi kiem thu: frontend static `index.html` + `js/features/crm-app.js`, Supabase-compatible client adapter, RLS nen trong `supabase-phase-1-security-foundation.sql`.

## 1. Ket qua kiem tra bang may

- `node --check js/features/crm-app.js`: dat.
- `node --check js/firebase.js`: dat.
- Local app `http://127.0.0.1:5182/index.html`: tra ve HTTP 200.
- Da soat cac diem gate role chinh trong `js/features/crm-app.js`: `isAdmin`, `isManager`, `canSeeCustomer`, `canEditCustomer`, `canEditDeal`, `watchData`, `setMainView`, KPI approval, report center, admin settings.

Luu y: day la kiem thu tinh/tren local. Chua dang nhap live lan luot bang 3 tai khoan that admin/manager/sale tren Vercel trong phien nay, vi can tai khoan test dang hoat dong va thao tac browser nguoi dung de xac nhan 100% trai nghiem thuc te.

## 2. Ma tran quyen hien tai

| Chuc nang | Sale | Manager | Admin | Ghi chu |
| --- | --- | --- | --- | --- |
| Dang nhap Google | Co | Co | Co | Dieu kien: email co trong `app_users`, active. |
| Xem tab CRM | Co | Co | Co | Sale chi nen thay du lieu thuoc minh theo RLS/filter. |
| Xem tab Khach hang | Co | Co | Co | Sale xem khach owner/created_by cua minh. |
| Them khach | Co | Co | Co | Sale nen gan ve chinh minh, manager/admin co the gan nhan vien. |
| Sua khach | Khach cua minh | Tat ca | Tat ca | UI dung `canEditCustomer`; RLS can tiep tuc la tang bao ve cuoi. |
| Xoa mem khach | Khong | Co | Co | Ham xoa dang yeu cau `isManager()`. |
| CSKH / ghi log | Khach cua minh | Tat ca | Tat ca | Phu thuoc RLS `care_logs manager or owner`. |
| Don hang / Deal | Deal/khach cua minh, neu deal con active | Tat ca | Tat ca | Sale khong sua deal da hoan thanh/da huy/mat. |
| San pham | Xem | Sua/import | Sua/import | Phu hop policy `products manager write`. |
| KPI rule | Xem KPI duoc gan | Tao/sua | Tao/sua | `saveKpiRule` khoa boi `isManager()`. |
| De xuat KPI | Tao/xem cua minh, pending moi sua/xoa mem | Xem/duyet | Xem/duyet/xoa theo policy | Can test live pending/approved/rejected voi tai khoan sale. |
| Bao cao | Khong | Co | Co | `reportsViewBtn` chi hien voi `isManager()`. |
| Quan tri users/settings/thung rac/audit raw | Khong | Khong | Co | `adminViewBtn` chi hien voi `isAdmin()`. |
| Xuat Excel/XLSX | Co | Co | Co | Theo policy hien tai: sale/manager/admin deu duoc export. |

## 3. Ket qua soi code theo role

### Sale

Dung:
- Khong vao duoc tab `Bao cao` va `Quan tri`.
- Query data dang doc collection qua RLS cho `customers`, `careLogs`, `deals`, `kpiProposals`.
- `canSeeCustomer` chi tra ve true neu la owner/created_by cua sale.
- `canEditDeal` chi cho sale sua deal cua minh/khach cua minh va deal con active.
- KPI sale xem duoc bang KPI va de xuat cua minh; cac KPI da duyet/tu choi khong nen sua.

Can test live:
- Tao khach bang sale A, dang nhap sale B khong thay khach do.
- Sale A chi sua duoc khach/deal cua minh.
- Sale A export du lieu dung voi bo loc hien tai, khong vuot qua data minh duoc RLS cho phep.

### Manager

Dung:
- Vao duoc `Bao cao`, KPI approval, danh sach khach/deal/care logs.
- Khong vao duoc tab `Quan tri`.
- Tao/sua KPI rule, duyet KPI proposal, import/sua san pham.

Can test live:
- Manager thay du lieu tat ca sale.
- Manager khong thay panel admin-only: users/settings/thung rac/audit raw.
- Manager khong xoa vinh vien khach.

### Admin

Dung:
- Vao duoc tat ca tab, gom `Quan tri`.
- Quan ly users/settings/dropdown/thung rac/audit raw.
- Co quyen cua manager va quyen admin sau hon.

Can test live:
- Admin cap/quay role user xong refresh, role moi co hieu luc.
- Admin khoi phuc/xoa vinh vien khach dung theo RLS.
- Admin xem duoc user sessions neu Realtime/session write dang hoat dong.

## 4. Diem bao mat dang on

- Khong thay service role key trong frontend.
- Supabase anon key neu co trong frontend la binh thuong voi Supabase, mien la RLS bat chat.
- RLS da duoc khai bao cho cac bang quan trong: `app_users`, `settings`, `customers`, `care_logs`, `deals`, `products`, `kpi_rules`, `kpi_proposals`, `phone_index`, `audit_logs`, `user_sessions`.
- Storage `kpi-evidence` co policy insert theo folder email da sanitize va read cho authenticated.

## 5. Rủi ro / viec can xac nhan bang test live

1. Sale query dang doc collection rong va dua vao RLS. Neu Supabase adapter/RLS mapping co bug, co the anh huong hien thi. Can test live bang 2 sale khac nhau.
2. `isSale()` hien chua duoc dung truc tiep. Khong gay loi, nhung co the don code sau.
3. `audit_logs` policy cho manager read, nhung UI chi admin xem audit raw. Day la lua chon UI, khong phai loi; neu muon chat hon co the sua RLS audit read thanh admin only.
4. Export du lieu cho sale dang duoc cho phep theo yeu cau truoc day. Neu sau nay muon chan sale export, can sua `canExportData` va/hoac cot `can_export`.

## 6. Checklist test live de chot vai tro

### Tai khoan sale A

- Dang nhap thanh cong, hien dung ten/role.
- Khong thay nut `Bao cao`.
- Khong thay nut `Quan tri`.
- Them khach moi: owner tu dong la sale A.
- Vao chi tiet khach cua minh va ghi CSKH duoc.
- Tao deal cho khach cua minh duoc.
- Deal da mua/da huy/mat khong sua duoc bang sale.
- Tao de xuat KPI duoc.
- KPI pending sua/xoa mem duoc.
- KPI approved/rejected chi xem, khong sua/xoa.

### Tai khoan sale B

- Khong thay khach sale A vua tao.
- Tim so dien thoai/ten cua khach sale A khong ra.
- Khong thay deal/care log cua sale A.

### Tai khoan manager

- Thay khach cua sale A va sale B.
- Thay tab `Bao cao`.
- Khong thay tab `Quan tri`.
- Duyet/tu choi KPI proposal duoc.
- Sua owner khach/deal duoc neu can.
- Xuat bao cao duoc.

### Tai khoan admin

- Thay tab `Quan tri`.
- Sua user role/active/canExport duoc.
- Sua dropdown/settings duoc.
- Xem audit raw/thung rac duoc.
- Khoi phuc hoac xoa vinh vien theo dung canh bao.

## 7. Ket luan

Trang thai hien tai: role logic trong code da duoc chuan hoa tot hon va phu hop voi mo hinh admin/manager/sale. Chua thay loi lon o tang UI/query qua kiem tra tinh. Buoc bat buoc tiep theo la test live bang 3 tai khoan that de xac nhan RLS Supabase va UI khop nhau ngoai moi truong local/Vercel.

De xuat tiep theo: tao mot file `LIVE_ROLE_TEST_LOG.md` sau khi ban test bang tai khoan that, ghi lai ket qua tung dong trong checklist tren. Neu co loi, minh sua theo dung dong bi fail thay vi sua cam tinh.
