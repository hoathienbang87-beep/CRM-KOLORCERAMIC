# Giai doan 7 - Bao mat, hieu nang, van hanh

Ngay cap nhat: 2026-07-08

Muc tieu: giu app CRM on dinh khi dung that, tranh lo key, tranh thao tac treo "Dang xu ly", va co checklist van hanh truoc/sau deploy.

## Da kiem tra

| Hang muc | Ket qua | Ghi chu |
|---|---|---|
| Supabase key trong frontend | Dat yeu cau | Repo chi co anon key trong `js/supabase-config.js`. Khong thay service_role key trong code app. |
| File bi mat | Dat yeu cau | `.gitignore` da chan `.env`, backup, dump SQL, CSV/XLS/XLSX export. |
| Auth | Dat yeu cau buoc dau | Dung Supabase Auth qua adapter `js/firebase.js`, session duoc persist bang `crm-kolor-supabase-auth`. |
| RLS | Can test tren Supabase | Frontend da hien thong bao ro khi gap loi RLS. RLS thuc te phai test bang admin/manager/sale sau moi lan chay SQL. |
| Loading/action timeout | Da co | `runAction` co khoa nut va timeout 45 giay de tranh dung vo han. |
| Render khi realtime thay doi | Da nang cap | Khi tab trinh duyet dang an, app gom thay doi lai va chi render khi user quay ve tab. |
| Canh bao du lieu lon | Da them | Admin/owner xem trong Quan tri > An toan du lieu de biet luc nao can phan trang/RPC sau hon. |

## Thay doi da lam trong Phase 7

1. Them co che hoan render khi tab trinh duyet dang an.
   - Giam viec render lien tuc khi user chuyen qua app/tab khac.
   - Khi quay lai tab, app render mot lan neu co du lieu moi.

2. Them canh bao van hanh trong khu An toan du lieu.
   - Khach hang vuot nguong.
   - Lich su cham soc vuot nguong.
   - Audit log vuot nguong.
   - KPI proposal vuot nguong.

3. Cho owner/admin cung xem duoc An toan du lieu.
   - Tranh owner bi ket neu role khong phai `admin`.

## Checklist test 3 role

### Admin/owner

- Dang nhap duoc.
- Vao Quan tri, xem An toan du lieu.
- Xuat snapshot van hanh duoc.
- Xem audit log duoc.
- Them/sua/khoa user co confirm va co audit log.

### Manager

- Khong vao duoc `/admin` neu khong phai owner/admin.
- Xem duoc khach/team theo quyen RLS.
- Xem bao cao sale, KPI cho duyet neu dung quyen.
- Khong sua cau hinh he thong neu khong duoc phep.

### Sale

- Chi thay khach cua minh hoac du lieu duoc RLS cap quyen.
- Them khach/cham soc/KPI proposal duoc.
- Khong sua/xoa KPI da duyet/tu choi.
- Khong vao duoc Quan tri/admin.

## Checklist truoc deploy

1. Chay test local:
   - Dang nhap Google.
   - Them khach test.
   - Ghi cham soc.
   - Gui KPI proposal.
   - Xem bao cao.
2. Xuat snapshot van hanh trong app.
3. Neu co chay SQL/RLS: backup Supabase bang CLI truoc.
4. Kiem tra Git:
   - Khong stage `.env`.
   - Khong stage file backup SQL/dump.
   - Khong stage export CSV/XLS/XLSX co du lieu khach.
   - Khong co database password/service_role key.
5. Deploy len Vercel.
6. Sau deploy test lai admin/manager/sale tren production.

## Viec nen lam tiep neu du lieu lon

| Van de | Huong xu ly tiep |
|---|---|
| Khach hang qua nhieu | Query theo bo loc tren Supabase thay vi tai het ve frontend. |
| Care log qua nhieu | Chi tai timeline khi mo ho so khach. |
| Audit log qua nhieu | Archive log cu theo thang, tao view/RPC de bao cao. |
| Bao cao cham | Tao Supabase view/RPC tinh san theo thang/tuan. |
| Realtime nhieu | Chi subscribe collection can cho tab dang mo. |

## Ket luan

Phase 7 da gia co mot lop on dinh van hanh va them canh bao som. Buoc nang cap sau neu app tang du lieu la dua cac bang lon sang query phan trang thuc su o Supabase, thay vi tiep tuc tai toan bo bang ve frontend.
