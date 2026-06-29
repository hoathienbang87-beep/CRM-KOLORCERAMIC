# Checklist log/audit va kiem thu end-to-end CRM-KOLORCERAMIC

Ngay tao: 2026-06-30

Muc dich: kiem tra app theo dung luong dung that, dong thoi xac nhan cac thao tac quan trong co de lai audit log de truy vet.

## 1. Tai khoan can co de test

- Admin: co role `admin`, active.
- Manager: co role `manager`, active.
- Sale A: co role `sale`, active.
- Sale B: co role `sale`, active.

Nen test tren link deploy that sau khi Vercel build xong. Neu test local thi van can dang nhap Google va ket noi Supabase that.

## 2. Luong dang nhap va phan quyen

### Sale A

- [ ] Dang nhap Google thanh cong.
- [ ] Hien dung email, ten hien thi va role sale.
- [ ] Khong thay tab `Bao cao`.
- [ ] Khong thay tab `Quan tri`.
- [ ] Dropdown nhan vien phu trach khi them/sua khach khong cho gan sang nguoi khac.

### Sale B

- [ ] Dang nhap thanh cong.
- [ ] Khong thay du lieu khach/deal/care log do Sale A tao.
- [ ] Tim ten/SĐT khach cua Sale A khong ra ket qua.

### Manager

- [ ] Dang nhap thanh cong.
- [ ] Thay du lieu cua Sale A va Sale B.
- [ ] Thay tab `Bao cao`.
- [ ] Khong thay tab `Quan tri`.
- [ ] Co the duyet hoac tu choi KPI proposal.

### Admin

- [ ] Dang nhap thanh cong.
- [ ] Thay tab `Quan tri`.
- [ ] Thay panel users/settings/dropdown/thung rac/audit.
- [ ] Co the cap nhat role/active/canExport cho user.

## 3. Luong khach hang end-to-end

Thuc hien bang Sale A:

- [ ] Tao khach moi co ten, SĐT, dia chi, kenh chi tiet, nhu cau.
- [ ] Khach moi hien ngay trong bang khach hang, khong can F5.
- [ ] Dashboard/CRM cap nhat so lieu lien quan.
- [ ] Mo chi tiet khach thanh cong.
- [ ] Sua thong tin khach trong drawer thanh cong.
- [ ] Them ten cong ty neu kenh la `Cong ty TK/XD`.
- [ ] Neu co lich hen cham, card `Can cham` / `Qua han cham` tinh dung.

Audit can co:

- [ ] `addCustomer`
- [ ] `updateCustomerInfo`

## 4. Luong cham soc khach

Thuc hien bang Sale A tren khach vua tao:

- [ ] Them lich su cham soc: kenh cham, ket qua cham, ghi chu, ngay hen tiep.
- [ ] Sau khi luu, lich su hien trong drawer.
- [ ] Ngay cham/follow cua khach cap nhat dung.
- [ ] Sua mot dong lich su cham soc.
- [ ] Xoa mem mot dong lich su cham soc neu can.

Audit can co:

- [ ] `addCareLog`
- [ ] `editCareLog`
- [ ] `deleteCareLog`

## 5. Luong deal/don hang

Thuc hien bang Sale A:

- [ ] Tao deal moi tu khach.
- [ ] Deal hien trong tab `Don hang`.
- [ ] Sua deal khi deal con active.
- [ ] Chuyen deal sang da coc/da mua neu hop le.
- [ ] Neu deal da mua, pipeline va dashboard dem dung.
- [ ] Sale khong sua deal da hoan thanh/da huy/mat.

Thuc hien bang Manager:

- [ ] Manager thay deal Sale A tao.
- [ ] Manager sua deal duoc neu can.

Audit can co:

- [ ] `addDeal`
- [ ] `updateDeal`
- [ ] `completeDeal` hoac `cancelDeal`
- [ ] `softDeleteDeal` neu co xoa mem

## 6. Luong KPI

Thuc hien bang Manager/Admin:

- [ ] Tao KPI rule gan cho Sale A.
- [ ] Sua KPI rule.
- [ ] Tat KPI rule.
- [ ] Bat lai KPI rule.

Thuc hien bang Sale A:

- [ ] Mo nut `De xuat KPI` tren khach.
- [ ] Form KPI co san ten/SĐT/cong ty/kenh cua khach.
- [ ] Dropdown KPI chi hien KPI duoc gan cho Sale A.
- [ ] Gui de xuat KPI co anh minh chung neu can.
- [ ] De xuat pending hien trong tab KPI.
- [ ] Sale sua/xoa mem duoc de xuat pending.

Thuc hien bang Manager/Admin:

- [ ] Xem duoc de xuat pending.
- [ ] Duyet de xuat.
- [ ] Tu choi de xuat va nhap ly do.
- [ ] KPI da duyet/tu choi khong cho Sale sua nua.
- [ ] Bang KPI chi tinh de xuat da duyet.

Audit can co:

- [ ] `createKpiRule`
- [ ] `updateKpiRule`
- [ ] `disableKpiRule`
- [ ] `activateKpiRule`
- [ ] `submitKpiProposal`
- [ ] `updateKpiProposal`
- [ ] `softDeleteKpiProposal`
- [ ] `approveKpiProposal`
- [ ] `rejectKpiProposal`

## 7. Luong bao cao va export

Thuc hien bang Sale A:

- [ ] Loc khach theo kenh/trang thai/follow/thang/tuan.
- [ ] Xuat file khach hang ra `.xlsx`.
- [ ] File chi gom du lieu dang thay theo bo loc/RLS cua Sale A.
- [ ] Xuat bao cao hoat dong sale neu co nut/hien quyen.

Thuc hien bang Manager/Admin:

- [ ] Xuat bao cao quan tri.
- [ ] Xuat KPI report.
- [ ] Xuat don hang.
- [ ] File mo duoc bang Excel moi.

Audit can co:

- [ ] `exportCustomers`
- [ ] `exportOrders`
- [ ] `exportSaleActivityReport`
- [ ] `exportManagementReport`
- [ ] `exportKpiReport`

## 8. Luong quan tri admin

Thuc hien bang Admin:

- [ ] Sua settings cham soc.
- [ ] Sua dropdown/settings danh muc.
- [ ] Dong bo SĐT.
- [ ] Dong bo nhan vien.
- [ ] Sua role/active/canExport cua mot user test.
- [ ] Xem audit panel thay cac thao tac moi.

Audit can co:

- [ ] `updateCareSettings`
- [ ] `updateDropdownSettings`
- [ ] `syncPhoneIndex`
- [ ] `syncOwnerEmail`
- [ ] `updateUser`

## 9. Tieu chi dat

Dat khi:

- Khong co loi console nghiem trong khi thao tac cac luong tren.
- Sale khong xem/sua duoc du lieu cua Sale khac.
- Manager xem va xu ly duoc du lieu team.
- Admin quan tri duoc settings/users/audit.
- Moi thao tac quan trong co audit log tuong ung.
- Export dung dinh dang `.xlsx` va dung bo loc dang xem.
- Refresh trang van giu dang nhap va khong lam mat trang thai lam viec quan trong.

## 10. Neu fail thi ghi lai

Dung mau sau de ghi bug:

```text
Ngay test:
Tai khoan:
Role:
Man hinh/tab:
Buoc thao tac:
Ket qua mong doi:
Ket qua thuc te:
Anh/chup man hinh:
Console error neu co:
```

De xuat: moi lan test live xong, copy cac dong fail vao issue/task rieng de sua dung trong tam.
