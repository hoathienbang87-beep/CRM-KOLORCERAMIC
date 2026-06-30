# Phase 3.5 UI/UX review

Muc tieu: ra soat trai nghiem dung that sau khi cac man hinh chinh da duoc chinh sau, giu workflow quen thuoc nhung giam thao tac thu cong va giam diem gay roi cho sale/manager/admin.

## Nguyen tac da chot

- Khu vuc nao co bo loc hoac tim kiem thi phai co nut `Xoa loc`.
- Reset filter phai dua ve mac dinh hop ly, khong bat nguoi dung tu chon lai tung o.
- Sale khong duoc reset ve trang thai thay tat ca neu role cua sale chi duoc xem du lieu cua minh.
- Cac danh sach dai phai nam trong khung scroll, filter/metric/tieu de nam ngoai vung scroll.
- Hanh dong nguy hiem nhu xoa, huy, cleanup phai co confirm va/hoac chi hien voi role phu hop.

## Cac diem da ra soat

- Tab Khach hang: da co tim kiem, bo loc, xoa loc, loc nhanh theo kenh chi tiet va xuat file theo bo loc hien tai.
- Tab Don hang: da co bo loc nam/thang/nhan vien/trang thai va bo sung `Xoa loc`.
- Tab San pham: da co tim kiem, bo loc size/be mat/xuat xu va `Xoa loc`.
- Tab KPI: bo sung `Xoa loc` cho de xuat KPI cua toi va duyet KPI.
- Tab Bao cao: da co `Xoa loc` cho bao cao hoat dong sale.
- Dashboard CRM: bo sung `Xoa loc` cho bao cao theo kenh chi tiet.
- Tasks / Lich hen cong viec: da co khung scroll va `Xoa loc`.

## Nen kiem thu thuc te

- Dang nhap bang 3 role admin, manager, sale.
- Vao tung tab, doi filter bat ky, bam `Xoa loc`, kiem tra du lieu tro ve mac dinh dung role.
- Kiem tra sale khong thay du lieu cua nguoi khac sau khi reset filter.
- Kiem tra export Excel/XLSX khi dang loc va khi da xoa loc.
- Kiem tra mobile/tablet: nut `Xoa loc` khong tran khoi khung filter.

## Viec nen de giai doan sau

- Tach CSS theo module neu file styles tiep tuc lon.
- Them test tu dong cho cac ham loc/report chinh.
- Chuan hoa copy UI cho tat ca empty state neu nguoi dung thuc te thay con kho hieu.
