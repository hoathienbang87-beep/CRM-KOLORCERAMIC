# Phase 4.12 - Pagination & Lazy Load

Muc tieu: giam so dong DOM duoc render mot luc khi du lieu CRM/ERP tang lon.

## Da ap dung

- Bang khach hang: hien 40 khach dau tien, bam "Hien thi them" de mo tiep.
- Task / Lich hen cong viec: hien 30 task dau tien.
- Danh muc san pham: hien 80 san pham dau tien.
- Timeline hoat dong sale: hien 80 hoat dong dau tien, khong con bi cat cung mat du lieu.
- Audit log: hien 80 log dau tien, co the xem tiep bang nut "Hien thi them".

## Nguyen tac

- Bo loc/tim kiem van ap dung tren toan bo du lieu da tai.
- Xuat Excel/CSV van xuat toan bo du lieu theo bo loc, khong chi xuat cac dong dang hien thi.
- Khi doi bo loc hoac bam xoa loc, danh sach quay ve trang dau de tranh render qua dai.

## Buoc toi neu du lieu tiep tuc lon

- Chuyen tu lazy render tren frontend sang query phan trang that o Supabase.
- Uu tien cac bang: `audit_logs`, `care_logs`, `products`, `inventory_movements`, `customers`.
- Bao cao nang nen chuyen sang view/RPC trong Supabase de frontend khong phai tinh toan tren toan bo dataset.
