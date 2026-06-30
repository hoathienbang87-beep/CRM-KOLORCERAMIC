# Phase 3 UI/UX log

Muc tieu: nang giao dien CRM chuyen nghiep hon nhung giu workflow quen thuoc cho sale/manager/admin.

## Dot 1 - Nen giao dien

- Sua typo thuong hieu tren topbar.
- Tang do sau cho topbar, panel, tab, bang, drawer.
- Them focus/hover states cho form, nut, bang va card.
- Lam sidebar them khach sticky tren desktop, khong sticky tren mobile.
- Cai thien empty state, chart container, notice va scrollbar.

## Dot 2 - Man Khach hang va drawer KH

- Bang khach hang de quet hon: ten KH, cong ty/dia chi, so dien thoai va trang thai tach thanh cum ro.
- Cot don hang hien so theo dang pill nho thay vi text dai.
- Status KH thanh badge mau de nhin nhanh lead/da mua/da huy/mat.
- Drawer chi tiet KH co meta badge cho SĐT, cong ty/kenh, nhan vien phu trach va so lan mua.

## Dot 3 - Man Don hang / Deal

- Bang don hang gom ngay don/ngay mua/ngay giao thanh mot cum de bot roi cot.
- Dong deal co mau canh trai theo trang thai: da mua, da coc, da huy.
- San pham, ghi chu va gia tri don duoc dinh dang de de scan hon.
- Nut thao tac trong bang deal xep doc gon hon, tranh tran ngang.
- Chi tiet don hang chuyen tu alert dai sang modal co thong tin, san pham, ghi chu va hanh dong tiep theo.
- Card thong ke don hang co the click de mo modal danh sach don tuong ung theo bo loc hien tai.

## Dot 4 - Man KPI

- KPI trong bang tong hop co progress bar theo dang da lam/chi tieu/phan tram.
- Card de xuat KPI co mau theo trang thai: cho duyet, da duyet, tu choi.
- Phan duyet KPI co grid thong ke: tong cho duyet, dang hien thi, thang bao cao, ton thang cu.
- Action trong card KPI xep doc gon hon de tranh roi nut.
- Bang control KPI rule hien tien do tung nhan vien va tong rule bang progress bar.

## Dot 5 - Man Bao cao

- Them metric grid cho bao cao hoat dong sale: tong hoat dong, task qua han, cham soc, bao gia, deal tao, don hoan thanh, doanh so.
- Timeline hoat dong sale chuyen sang card ro nhan vien, SĐT, kenh, noi dung va tien neu co.
- Card bao cao tong quan co class rieng de dong bo UI voi dashboard.
- Task qua han trong timeline duoc nhan mau canh bao de manager de thay.
- Timeline hoat dong sale duoc boc vao khung scroll de danh sach dai khong keo trang qua lau.

## Dot 6 - Man Quan tri

- Health check co mau theo muc do: on, can chu y, can xu ly.
- Bang user hien badge role va active/locked ngay trong cot nhan vien.
- User bi khoa co nen canh bao de admin de thay.
- Audit action doi thanh badge de doc nhanh hanh dong.
- Thung rac hien thanh card co thong tin SĐT, nhan vien, ngay xoa, so care logs va deals lien quan.
- Them ghi chu ngan cho health check va thung rac de admin biet thao tac nao nhay cam.

## Dot 7 - Khung scroll cho danh sach dai

- Tab CRM: danh sach Tasks / Lich hen cong viec co khung scroll rieng.
- Tab Bao cao: timeline Hoat dong sale co khung scroll rieng.
- Filter, metric va summary van nam ngoai vung scroll de nguoi dung doi loc nhanh hon.

## Cac man hinh con lai nen lam tiep

1. Chay test UI thuc te tren Vercel voi admin/manager/sale va ghi cac diem can tinh chinh.
2. Neu can, tach tiep CSS theo module de bao tri de hon.
