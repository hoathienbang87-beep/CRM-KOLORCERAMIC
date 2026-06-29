# CRM KOLORCERAMIC - Giai doan 2: Nang CRM thanh dung that

Ngay tao: 2026-06-29

Muc tieu giai doan 2 la giu nen Supabase hien tai, khong lam lai app tu dau, nhung nang cac luong nghiep vu quan trong de nhan vien sale, manager va admin co the dung hang ngay mot cach ro rang hon.

## Nguyen tac

- Khong thay doi logic dang on neu khong can thiet.
- Moi thay doi phai giu duoc role admin / manager / sale.
- Moi thay doi du lieu quan trong phai co audit log hoac it nhat khong lam mat lich su.
- Uu tien cac man hinh nhan vien dung moi ngay truoc khi lam UI lon.
- Moi buoc nen test local truoc khi deploy.

## Uu tien 1: Trung tam cham soc khach

Muc tieu:

- Sale mo CRM la biet ngay hom nay can lam gi.
- Manager xem duoc nhom can cham, qua han, chua co lich hen.
- Click vao tung nhom de mo popup danh sach khach.

Hang muc:

- [x] Tao cac the tong quan cham soc trong tab CRM.
- [x] Nhom khach: hom nay, qua han, chua co lich hen, dang cham.
- [x] Popup chi tiet danh sach khach cho tung nhom.
- [ ] Bo sung loc nhanh dua tren cac nhom nay trong bang khach hang neu can.
- [ ] Them cot/nhan uu tien cham soc neu cong ty can cham KH nong truoc.

## Uu tien 2: Ho so khach hang day du

Muc tieu:

- Khi mo mot khach, moi thong tin lien quan nam trong mot drawer ro rang.
- Lich su cham, don hang, KPI lien quan khong bi roi.

Hang muc:

- [ ] Tach block thong tin khach / lich su cham / don hang / KPI trong drawer de de doc hon.
- [ ] Lam timeline lich su hoat dong cua khach.
- [ ] Chuan hoa cac truong bat buoc khi tao khach: ten, kenh, nhan vien phu trach.
- [ ] Canh bao trung SDT ro rang hon.

## Uu tien 3: Don hang / deal

Muc tieu:

- Don hang khong chi la ghi chu, ma co trang thai va gia tri de bao cao.

Hang muc:

- [ ] Chuan hoa trang thai don: dang coc, da mua, da huy/mat.
- [ ] Tinh doanh so dua tren don da mua.
- [ ] Giu lai lich su thay doi don quan trong.
- [ ] Xem don theo sale, thang, trang thai.

## Uu tien 4: KPI dung that

Muc tieu:

- Sale thay tat ca de xuat KPI cua minh.
- Pending thi sua/xoa mem duoc.
- Da duyet/tu choi thi khoa sua.
- Manager/Admin duyet duoc nhung KPI ton tu thang truoc.

Hang muc:

- [ ] Riem tra lai logic hien thi KPI pending cu qua thang.
- [ ] Tach ro trang thai pending / approved / rejected / deleted.
- [ ] Dam bao chi KPI approved moi tinh vao thanh tich.
- [ ] Hien anh minh chung trong popup.

## Uu tien 5: Bao cao va export

Muc tieu:

- Manager co the lay bao cao cuoi tuan/thang khong can loc tay qua nhieu.

Hang muc:

- [ ] Xuat khach hang theo bo loc hien tai.
- [ ] Xuat log cham soc theo khoang ngay.
- [ ] Xuat don hang theo thang/sale.
- [ ] Xuat KPI theo thang/sale/trang thai.

## Uu tien 6: Quan tri va audit

Muc tieu:

- Admin de quan ly nhan vien, settings va biet ai da thao tac gi.

Hang muc:

- [ ] Lam audit log de doc hon.
- [ ] Them bo loc audit theo nguoi, hanh dong, thoi gian.
- [ ] An cac nut ky thuat khoi man hinh sale.
- [ ] Giam rui ro xoa vinh vien bang xac nhan ro.

## Uu tien 7: Refactor nhe

Muc tieu:

- Giam rui ro vi `crm-app.js` dang qua lon.

Hang muc:

- [ ] Tach cac helper tinh toan sang file rieng.
- [ ] Tach render KPI / orders / customers theo module nho.
- [ ] Giu API hien tai de khong phai rewrite lon.

## Thu tu de xuat

1. Trung tam cham soc khach.
2. Ho so khach hang.
3. KPI.
4. Don hang.
5. Bao cao/export.
6. Quan tri/audit.
7. Refactor nhe.
