# Lo trinh chinh sua CRM-KOLORCERAMIC ve CRM thuan

Ngay lap: 2026-07-08

Muc tieu: dua du an ve dung pham vi CRM thuan cho cong ty gach/ceramic. Khong mo rong ERP, khong quan ly kho, khong quan ly san pham chi tiet, khong CMS website.

## Nguyen tac lam viec

1. Moi buoc chi lam mot nhom viec ro rang.
2. Truoc khi chay SQL lon phai backup Supabase.
3. Truoc khi sua nhieu code phai commit ban dang on.
4. Khong xoa cung du lieu cu neu chua chac; uu tien archive hoac an khoi UI.
5. Moi buoc xong phai test bang it nhat 3 role: admin/manager/sale.
6. Tap trung vao 4 truc chinh: khach hang, cham soc, KPI, bao cao.

## Giai doan 0 - Khoa pham vi va on dinh nen

Muc tieu: dam bao du an khong bi keo nguoc ve ERP/CMS.

Viec can lam:

| Viec | Ket qua can co | Kiem tra |
|---|---|---|
| Chot bang giu/bo/sua/them | Da co bang quyet dinh trong file audit | Doc lai voi owner, khong con tranh cai pham vi |
| Backup Supabase | Co folder backup theo ngay | File backup ton tai va co dung luong hop ly |
| Commit code hien tai | Git clean truoc khi sua | `git status` sach |
| Chay/test SQL Phase F/G neu chua lam tren production | RLS va legacy archive dung | Sale khong doc/sua du lieu ngoai quyen |

Do uu tien: Rat cao.

Khong nen lam tiep neu chua co backup va commit sach.

## Giai doan 1 - Don UI ve CRM thuan

Muc tieu: nhan vien vao app chi thay nhung gi phuc vu CRM hang ngay.

Trang thai: da thuc hien buoc UI/runtime chinh ngay 2026-07-08. Menu shell da duoc rut ve CRM, Khach hang, KPI, Bao cao, Quan tri; snapshot van hanh da bo cac sheet ERP/CMS; cac nhan hien thi chinh cua luong mua can ban da duoc doi khoi ngon ngu don hang chi tiet.

Viec can lam:

| Viec | Quyet dinh | Ket qua can co |
|---|---|---|
| Bo/An tab san pham, don hang chi tiet, kho, CMS neu con sot | Bo khoi CRM chinh | Menu gon: CRM, Khach hang, Cham soc/Lich hen, KPI, Bao cao, Quan tri |
| Doi ngon ngu "deal/don hang" thanh "mua can ban" neu chi de danh gia khach | Sua | Khong tao cam giac app quan ly don hang |
| Don cac nut thao tac thua trong bang khach | Sua | Sale thay cac nut can thiet: Cham soc, KPI, Mua can ban, Chi tiet |
| Kiem tra mobile/tablet | Sua | Form va bang khong bi qua dai kho thao tac |

Test xong giai doan 1:

- Sale dang nhap thay dung menu sale.
- Manager/admin thay them bao cao/quan tri.
- Khong con nut kho, san pham, thanh toan, CMS trong luong CRM chinh.

## Giai doan 2 - Chuan hoa ho so khach hang

Muc tieu: moi khach hang co ho so ro, du de cham soc va danh gia.

Trang thai: da thuc hien buoc chuan hoa dau tien ngay 2026-07-08. Form them nhanh da co Loai khach va Muc tiem nang, canh bao trung SDT khi nhap, ho so drawer hien Loai khach, export/snapshot co them phan loai va tiem nang. Da tach id ten cong ty cua khach khoi id cau hinh cong ty de tranh luu nham.

Viec can lam:

| Viec | Quyet dinh | Ket qua can co |
|---|---|---|
| Chuan hoa form them nhanh | Sua | Truong bat buoc it: Ten, SDT hoac Khong SDT, Kenh chi tiet, Sale phu trach |
| Them/sua truong phan loai khach neu can | Them co chon loc | Co nhom: Kha le, Cong ty TK/XD, KTS/Doi tac, Khach cu, Khac |
| Them/sua muc tiem nang | Them | Nong/Am/Lanh hoac A/B/C |
| Chuan hoa ten cong ty cho khach cong ty | Giu/Sua | Khach cong ty co ten cong ty rieng, khong tron vao ghi chu |
| Chong trung SDT | Nang cap | Tao moi bi canh bao khi SDT da ton tai |
| Ho so drawer | Nang cap | 1 noi xem thong tin, timeline, lich hen, mua can ban, KPI lien quan |

Test xong giai doan 2:

- Sale them khach trong duoi 30 giay.
- Khach cong ty hien dung ten cong ty.
- Tim kiem co dau/khong dau ra dung.
- Khong tao trung SDT ma khong canh bao.

## Giai doan 3 - Chuan hoa cham soc, lich hen, timeline

Muc tieu: CRM tro thanh cong cu theo doi cham soc that su.

Trang thai 2026-07-08: Da chuan hoa buoc dau. Form cham soc co them ngay cham va dau hieu khach den showroom; care log moi luu activityType, careDate, showroomVisit; timeline uu tien ngay cham that; so lan den showroom tu dong cap nhat khi luu/sua/xoa log; bao cao/xuat snapshot co them thong tin ngay cham va showroom visit.

Viec can lam:

| Viec | Quyet dinh | Ket qua can co |
|---|---|---|
| Tach task/lich hen cham soc ro rang | Them | Co ngay hen, noi dung, trang thai, nguoi phu trach |
| Chuan hoa care log | Sua | Moi log co loai hoat dong, noi dung, ngay cham, nguoi cham |
| Timeline hop nhat | Nang cap | Mot dong thoi gian gom: tao khach, cham soc, hen lai, showroom visit, mua can ban, KPI |
| Canh bao qua han cham | Kiem thu/sua | Logic giong ban cu: chua cham/lau qua han phai hien dung |
| Popup can cham/qua han | Giu/nang cap | Click so lieu ra danh sach khach lien quan |
| Showroom visit | Them | Ghi duoc so lan den, ngay den, ai tiep, ket qua |

Test xong giai doan 3:

- Sale mo CRM thay "hom nay can cham ai".
- Qua han cham hien dung.
- Cham xong thi last contact/follow-up cap nhat dung.
- Manager xem duoc sale nao bo quen khach.

## Giai doan 4 - Chuan hoa KPI

Muc tieu: KPI cong bang, co bang chung, khong mat du lieu qua thang.

Trang thai 2026-07-08: Da chuan hoa buoc dau. KPI rule dang active duoc hieu la ap dung lau dai qua cac thang; bang tien do chi dem de xuat da duyet; de xuat pending qua thang van hien trong khung duyet; sale chi sua/xoa mem de xuat pending cua minh; de xuat da duyet/tu choi bi khoa; de xuat KPI moi luu snapshot chi tieu/dieu kien KPI luc gui va luc duyet; admin an KPI test bang xoa mem thay vi xoa cung.

Viec can lam:

| Viec | Quyet dinh | Ket qua can co |
|---|---|---|
| Tach KPI tu dong va KPI de xuat | Sua | KPI tu dong lay tu du lieu, KPI de xuat can duyet |
| KPI proposal pending khong mat qua thang | Sua | Qua thang van xem/duyet duoc de xuat chua xu ly |
| KPI da duyet/tu choi bi khoa sua | Giu | Sale chi sua/xoa khi pending |
| Anh minh chung KPI | Giu/nang cap | Upload truc tiep, gioi han size, hien popup xem anh |
| KPI snapshot theo thang | Them | So da chot khong bi thay doi khi sua rule sau nay |
| Role trong KPI | Kiem thu | Sale chi thay KPI cua minh, manager/admin thay theo quyen |

Test xong giai doan 4:

- Sale gui duoc KPI.
- Sale sua/xoa duoc KPI pending.
- Da duyet/tu choi thi khong sua.
- Manager/admin duyet duoc KPI cu cua thang truoc.
- KPI da duyet moi duoc tinh vao chi tieu.

## Giai doan 5 - Bao cao sale va dashboard quan ly

Muc tieu: quan ly nhin vao la biet sale dang lam tot hay bo sot.

Trang thai 2026-07-08: Da nang cap buoc dau. Cac the KPI tong o man CRM co the bam ra popup chi tiet theo dung quyen sale/manager; dashboard bao cao manager co the drill-down cac chi so chinh; luot cham thang/KPI/report dung ngay cham thuc te careDate thay vi chi dua vao ngay tao log; bao cao hoat dong sale co bo loc, bang tong hop, timeline scroll va xuat XLSX theo du lieu dang loc.

Viec can lam:

| Viec | Quyet dinh | Ket qua can co |
|---|---|---|
| Dashboard sale ca nhan | Them | Hom nay can cham, qua han, KPI cua toi, khach nong |
| Dashboard manager | Sua | Tong khach, khach moi, can cham, qua han, KPI cho duyet, kenh hieu qua |
| Bao cao hoat dong sale | Nang cap | So task, cham soc, hen lai, showroom visit, mua can ban |
| Bao cao kenh chi tiet | Giu/nang cap | Loc theo khoang ngay tuy chon |
| Xuat Excel theo bo loc | Giu | Xuat dung du lieu dang loc, khong xuat lan man |
| Ranking sale | Them co chon loc | Chi nen dung de quan tri, tranh tao ap luc sai |

Test xong giai doan 5:

- Manager xem duoc sale nao cham nhieu/it.
- Manager xem duoc kenh nao ra khach tot.
- Bao cao loc theo tuan/thang/khoang ngay dung.
- Xuat Excel ra dung tap du lieu dang xem.

## Giai doan 6 - Quan tri CRM noi bo

Muc tieu: admin/owner tu cau hinh CRM ma khong can vao Supabase.

Viec can lam:

| Viec | Quyet dinh | Ket qua can co |
|---|---|---|
| Quan ly nhan vien | Giu/nang cap | Them/sua/khoa user, gan role, gan manager neu can |
| Quan ly danh muc | Them | Kenh chi tiet, loai khach, tiem nang, trang thai cham soc |
| Quan ly KPI rule | Giu/nang cap | Them/sua/an rule KPI an toan |
| Audit log | Giu | Xem ai sua khach, doi owner, duyet KPI, khoa user |
| Xac nhan thao tac nguy hiem | Them | Xoa mem/khoa user/doi role deu can confirm |

Test xong giai doan 6:

- Admin them nhan vien moi khong can Supabase.
- Xoa/khoa nhan vien cu thi bao cao va dropdown cap nhat.
- Doi role co audit log.
- Sale khong vao duoc man quan tri.

## Giai doan 7 - Bao mat, hieu nang, van hanh

Muc tieu: app on dinh khi du lieu lon va nhieu nguoi dung.

Viec can lam:

| Viec | Ket qua can co |
|---|---|
| RLS test theo role | Sale khong xem/sua du lieu ngoai quyen |
| Kiem tra key frontend | Khong co service_role, database password, secret trong repo |
| Phan trang/lazy load | Khach/log/KPI nhieu van khong cham |
| Loading/error/empty state | Khong bi "dang xu ly" mai |
| Realtime hoac refresh thong minh | Sale them khach, manager thay cap nhat hop ly |
| Backup/deploy checklist | Co quy trinh truoc moi lan update |

Test xong giai doan 7:

- App chay on tren Vercel.
- Reload van giu dang nhap.
- Chuyen tab khong bi toast dang nhap lap lai.
- Bang lon khong lam treo UI.
- Co checklist rollback neu deploy loi.

## Thu tu uu tien de bat dau ngay

Neu can lam thuc te tu hom nay, nen theo thu tu nay:

1. Backup Supabase va commit code hien tai.
2. Kiem tra Phase F/G da chay dung tren Supabase production chua.
3. Don UI va code legacy con sot de khoa pham vi CRM thuan.
4. Chuan hoa ho so khach hang va form them nhanh.
5. Chuan hoa cham soc/timeline/task.
6. Chuan hoa KPI pending/approved/snapshot.
7. Lam dashboard sale va manager.
8. Lam quan tri nhan vien/danh muc/KPI rule.
9. RLS/security test va performance pass.

## Moc nghiem thu cuoi

Du an duoc xem la CRM thuan dung that khi dat cac dieu kien:

- Sale mo app moi ngay va biet can cham ai.
- Moi khach co lich su cham soc ro rang.
- Manager biet sale nao dang cham tot, sale nao bo sot.
- KPI khong bi tinh sai do de xuat chua duyet.
- Qua thang van duyet duoc KPI pending cu.
- Khong con UI san pham/kho/CMS/ERP trong luong CRM chinh.
- Admin quan ly nhan vien va danh muc khong can vao Supabase.
- Du lieu quan trong co audit log va RLS ro rang.
