# Phase 4.11 - Performance & Stability

Muc tieu: giam lag khi du lieu realtime thay doi, tranh render lai qua rong, va lam thao tac nut bam on dinh hon.

## Thay doi da lam

- Them `dirtyCollections` de biet collection nao vua thay doi.
- Chi render lai tab dang mo khi collection thay doi co lien quan den tab do.
- Cac phan chung nhu lich hen, online users, drawer khach chi cap nhat khi dung nhom du lieu can thiet.
- Chuyen `runAction` sang co dem so action dang chay, tranh mask "Dang xu ly" bi tat som khi co nhieu thao tac song song.
- Them cache ton kho cho `productInventoryQty`, tu dong reset khi `products` hoac `inventoryMovements` thay doi.

## Ky vong cai thien

- Dang o tab Don hang se khong bi render lai chart CRM khi chi co payment/order item thay doi.
- Dang o tab San pham hoac Bao cao se tinh ton kho nhe hon khi danh sach san pham/phieu kho nhieu.
- Cac nut luu/xuat/import it bi cam giac dung app hon khi nhieu action gan nhau.

## Can test that

- [ ] Dang nhap admin/manager/sale.
- [ ] Them khach moi, kiem tra tab CRM va Khach hang cap nhat.
- [ ] Tao don, ghi thanh toan, giao hang, kiem tra tab Don hang cap nhat.
- [ ] Nhap/xuat kho, kiem tra tab San pham va Bao cao ERP cap nhat ton kho.
- [ ] Mo drawer khach, them cham soc, kiem tra lich su cap nhat.
- [ ] Doi qua lai cac tab khi realtime dang cap nhat, app khong giat man hinh qua nhieu.

## Neu van lag

- Uu tien kiem tra so dong trong `audit_logs`, `products`, `inventory_movements`.
- Neu du lieu tang lon, buoc tiep theo nen la phan trang/lazy load cho audit log, san pham va lich su cham soc.
- Bao cao nang nen tinh theo query/view/RPC o Supabase thay vi tinh het tren frontend.
