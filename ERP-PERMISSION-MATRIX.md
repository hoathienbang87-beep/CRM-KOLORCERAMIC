# ERP Permission Matrix

Cap nhat giai doan 4.9: chuan hoa luong van hanh va quyen ERP.

## Vai tro

| Chuc nang | Sale | Manager | Admin |
| --- | --- | --- | --- |
| Xem khach/bao gia/don hang | Chi du lieu minh phu trach | Tat ca | Tat ca |
| Tao khach, cham soc khach | Khach minh phu trach | Tat ca | Tat ca |
| Tao/sua deal dang hoat dong | Deal cua minh | Tat ca | Tat ca |
| Chuyen trang thai hoan thanh/huy deal | Deal cua minh theo RLS | Tat ca | Tat ca |
| Tao thanh toan | Don cua minh | Tat ca | Tat ca |
| In phieu thu/phieu giao | Don/thanh toan minh duoc xem | Tat ca | Tat ca |
| Xoa mem/huy thanh toan | Khong | Co | Co |
| Cap nhat giao hang/ban giao | Khong | Co | Co |
| Nhap/xuat kho | Khong | Co | Co |
| Xoa mem phieu kho | Khong | Khong | Co |
| Sua san pham | Khong | Co | Co |
| An/khoi phuc san pham | Khong | Khong | Co |

## Nguyen tac van hanh

- Sale chi thao tac tren khach, deal va thanh toan thuoc pham vi minh phu trach.
- Manager xu ly van hanh hang ngay: thanh toan, giao hang, kho, dieu phoi deal.
- Admin giu cac thao tac rui ro cao: an/khoi phuc danh muc san pham, xoa mem phieu kho va cau hinh he thong.
- UI chi hien nut dung quyen, nhung Supabase RLS/trigger van la lop bao ve chinh.

## SQL can chay lai sau giai doan 4.9

Chay lai file `supabase-phase-4-erp-mini.sql` trong Supabase SQL Editor de ap dung:

- Payment update chi cho `admin/manager`.
- Trigger chan non-admin doi `products.is_deleted`.
