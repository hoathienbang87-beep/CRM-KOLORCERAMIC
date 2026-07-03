# Phase 4.10 - ERP End-to-End Test

Muc tieu: kiem thu tron luong ERP mini tu CRM sang bao gia, don hang, thanh toan, giao hang, kho, chung tu va bao cao.

## Pham vi da ra soat

- Khach hang -> tao bao gia.
- Bao gia -> chuyen thanh don hang/deal.
- Don hang -> order items.
- Don hang -> ghi nhan thanh toan.
- Don hang -> ban giao/giao hang.
- Giao hang -> tao inventory movement.
- Thanh toan/giao hang -> in chung tu.
- Don hang/thanh toan/kho -> bao cao ERP mini.
- Role sale/manager/admin trong cac diem thao tac nhay cam.

## Ket qua chinh

- Sale chi thao tac voi du lieu minh phu trach theo UI va RLS.
- Admin/manager xu ly van hanh ERP: thanh toan, ban giao, kho, bao cao.
- Admin giu thao tac rui ro cao: an san pham, xoa mem phieu kho.
- Da bo sung guard truc tiep cho nut hoan thanh/huy don bang `canEditDeal`.
- Da bo sung audit bao gia moi vao bao cao hoat dong sale: `createQuote`, `updateQuote`, `convertQuoteToDeal`.

## Checklist test bang du lieu that

### 1. Sale

- [ ] Dang nhap sale.
- [ ] Tao khach moi.
- [ ] Tao bao gia cho khach minh phu trach.
- [ ] Sua bao gia vua tao.
- [ ] Chuyen bao gia thanh don hang.
- [ ] Tao thanh toan cho don cua minh.
- [ ] In phieu thu cua thanh toan vua tao.
- [ ] Khong thay nut xoa mem thanh toan.
- [ ] Khong thay nut an/xoa san pham.
- [ ] Chi thay khach, don, bao gia, KPI trong pham vi minh duoc giao.

### 2. Manager

- [ ] Dang nhap manager.
- [ ] Thay duoc don hang cua tat ca sale.
- [ ] Cap nhat ban giao/giao hang cho mot don.
- [ ] Kiem tra sau khi giao hang co sinh phieu kho/ton kho thay doi.
- [ ] Xoa mem/huy thanh toan khi nhap sai.
- [ ] Sua san pham va nhap/xuat kho.
- [ ] Khong thay nut an/xoa san pham neu khong phai admin.
- [ ] Xem bao cao ERP mini va so lieu khop voi don/thanh toan/giao hang.

### 3. Admin

- [ ] Dang nhap admin.
- [ ] Thay toan bo du lieu CRM/ERP.
- [ ] An san pham khoi danh muc.
- [ ] Xoa mem phieu kho neu can.
- [ ] Kiem tra audit log co ghi thao tac quan trong.
- [ ] Xem duoc bao cao ERP tong hop.

### 4. Luong so lieu

- [ ] Bao gia co tong tien dung theo dong san pham.
- [ ] Chuyen bao gia sang don khong mat dong san pham.
- [ ] Don hang tinh dung tong gia tri.
- [ ] Thanh toan lam giam cong no.
- [ ] Giao hang cap nhat trang thai: chua giao, giao thieu, giao du.
- [ ] Giao hang tao inventory movement dung chieu am/xuat kho.
- [ ] Phieu thu va phieu giao in dung khach, don, san pham, so tien.
- [ ] Bao cao ERP dung bo loc thoi gian va nhan vien.

## Ghi chu van hanh

- Neu vua chay SQL/RLS moi, can logout/login lai de token role cap nhat sach.
- Khi test sale, nen dung 2 sale khac nhau de xac nhan khong xem nham du lieu cua nhau.
- Neu so lieu bao cao lech, uu tien doi chieu theo bang: `deals`, `order_items`, `payments`, `inventory_movements`.
