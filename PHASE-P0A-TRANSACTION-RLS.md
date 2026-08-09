# Phase P0-A - PostgreSQL transaction va customer ownership

Ngay thuc hien: 2026-08-09

## 1. Pham vi

Phase nay chi xu ly hai nen mong:

1. Thay cac multi-write quan trong dang chay tuan tu tren frontend bang PostgreSQL RPC atomic.
2. Tach quyen so huu khach hang khoi lich su nguoi tao.

Khong thay doi employee lifecycle, khong redesign KPI/UI/admin, khong xoa ERP/CMS legacy. Khong migration nao duoc chay tu dong va khong ghi production trong qua trinh thuc hien.

Baseline truoc khi sua:

- Branch: `main`
- Commit: `e90592d5b752204a895f85139f42a1abd52dcf0a`
- Working tree: sach truoc Phase P0-A
- Repo khong co `package.json` hoac test framework san co

## 2. Root cause

Adapter Supabase trong `js/firebase.js` giu ten API Firebase de tuong thich giao dien cu, nhung:

```js
commit: async () => {
  for (const op of ops) await op();
}
```

`writeBatch()` chi gui tung request REST lan luot. `runTransaction()` cung chay callback truc tiep. Neu write thu hai loi, write thu nhat da commit va PostgreSQL khong the rollback no.

RLS cu coi `created_by_email` nhu mot dieu kien so huu. Vi vay Sale A tao khach, manager chuyen khach sang Sale B, nhung Sale A van co the doc/sua do van la nguoi tao.

## 3. Audit multi-write flow

### 3.1 Cac flow can RPC ngay va da chuyen

**Tao khach**

→ insert `customers`
→ insert/upsert `phone_index`
→ insert `audit_logs`
→ Loi giua chung truoc day co the tao khach khong co phone index/audit.

Xu ly: `crm_create_customer`.

**Import mot dong khach**

→ tao customer + phone index + audit
→ neu co lich su mua thi tao `deals`
→ cap nhat thong tin mua can ban tren customer
→ Loi giua chung co the import nua dong.

Xu ly: `crm_import_customer`, goi cac RPC nghiep vu trong cung transaction PostgreSQL.

**Sua ho so khach**

→ update `customers`
→ giai phong phone cu/upsert phone moi
→ insert audit
→ Loi giua chung co the lam phone index lech customer.

Xu ly: `crm_update_customer_profile`.

**Chuyen sale phu trach**

→ xac thuc manager/admin va employee moi
→ update owner tren customer
→ update phone index
→ ghi owner cu/moi/actor/timestamp vao audit
→ Loi giua chung truoc day co the doi owner nhung khong audit hoac phone index sai.

Xu ly: `crm_transfer_customer`.

**Them/chinh sua/an lich su cham soc**

→ insert/update `care_logs`
→ cap nhat status/follow/last contact/next care/showroom tren customer
→ audit
→ Loi giua chung co the co log nhung customer khong cap nhat, hoac nguoc lai.

Xu ly: `crm_add_care_log`, `crm_update_care_log`, `crm_archive_care_log`.

**Doi lich cham**

→ update next care/follow tren customer
→ audit
→ Loi giua chung co the cap nhat ma khong co audit.

Xu ly: `crm_snooze_customer`.

**Mua can ban**

→ insert/update/status/archive `deals`
→ cap nhat thong tin danh gia mua tren customer
→ audit
→ Loi giua chung co the deal va ho so khach bat dong bo.

Xu ly: `crm_save_basic_purchase` voi action tach biet.

**KPI proposal**

→ insert/update proposal
→ audit submit/review/archive
→ Loi giua chung co the thay doi KPI khong co audit.

Xu ly: `crm_submit_kpi_proposal`, `crm_review_kpi_proposal`, `crm_archive_kpi_proposal`.

Luu y: upload anh Supabase Storage xay ra truoc khi submit proposal. Database proposal + audit la atomic; file upload khong the nam trong PostgreSQL transaction. Neu submit that bai co the con file mo coi va can cleanup rieng sau nay.

**An/khoi phuc customer**

→ an/khoi phuc customer
→ an/khoi phuc care logs va basic purchases lien quan
→ xoa/khoi phuc phone index
→ audit
→ Loi giua chung co the de ho so bi an mot phan.

Xu ly: `crm_set_customer_archived`. Chi khoi phuc ban ghi con da bi an cung customer; khong tu y khoi phuc ban ghi da xoa rieng truoc do.

### 3.2 Single-write nen giu

- Presence/session heartbeat.
- Mot so cap nhat settings don le.
- Upload file Storage (khac transaction domain database).

### 3.3 Chua thay doi trong P0-A

- Quan ly user bang batch: thuoc employee lifecycle, user da yeu cau chua sua.
- Products/quotes/delivery legacy: ngoai pham vi va chua xoa legacy.
- Cong cu rebuild/cleanup phone index: thao tac bao tri bulk, can mot maintenance RPC rieng.
- Settings + audit van la hai request: khong thuoc hai nen mong customer ownership, can dua vao phase hardening settings.

### 3.4 Da tam khoa vi nguy hiem

- Xoa vinh vien customer: batch cu co the xoa nua chung. P0-A chi cho soft archive.
- Cleanup xoa cung care log/deal mo coi: tam khoa cho den khi co RPC maintenance co dry-run va transaction that.

## 4. Kien truc moi

Frontend chi gui mot lenh nghiep vu:

```text
UI -> supabase.rpc("crm_*", payload)
   -> PostgreSQL function
      -> auth/role/ownership check
      -> lock row/advisory phone lock
      -> write 1
      -> write 2
      -> mandatory audit
      -> return
```

Moi RPC la mot PostgreSQL statement. Bat ky exception nao cung rollback toan bo write trong RPC.

`SECURITY DEFINER` chi duoc dung cho RPC can vuot RLS de thuc thi tron nghiep vu. Moi function nay deu:

- `SET search_path = public`
- lay email tu JWT qua helper server-side
- doc role/active tu `app_users`
- khong tin role frontend gui len
- khong dung service role tren frontend
- revoke `public`/`anon`, grant chi `authenticated`

## 5. Customer ownership va RLS

Migration them:

- `customers.owner_user_id`: employee dang chiu trach nhiem.
- `customers.created_by_user_id`: lich su nguoi tao.
- Foreign key den `app_users(id)` voi `ON DELETE RESTRICT`.

Backfill dung email hien co neu tim thay user tuong ung. Migration se fail-closed
voi `CRM_OWNER_PREFLIGHT_FAILED` neu customer active con thieu owner mapping hoac
owner dang inactive; toan bo migration rollback truoc khi policy moi duoc ap dung.

Quyen sale tren `customers`, `care_logs`, `deals` chi di qua:

```text
customers.owner_user_id = crm_current_app_user_id()
```

`created_by_email` va `created_by_user_id` khong con cap quyen. Manager/admin van co quyen theo role.

Migration xoa cac permissive policy nghiep vu cu tren `customers`, `care_logs`,
`deals` truoc khi tao policy canonical. Neu khong, PostgreSQL se OR policy cu va
moi, lam `created_by_email` hoac snapshot owner tiep tuc cap quyen.

Trigger `crm_guard_customer_owner_change` chan thay doi truc tiep `owner`, `owner_email`, `owner_user_id`. Chi RPC transfer duoc bat co noi bo trong transaction de doi owner.

## 6. RPC duoc them

- `crm_create_customer(jsonb)`
- `crm_import_customer(jsonb, jsonb)`
- `crm_update_customer_profile(text, jsonb)`
- `crm_transfer_customer(text, text, jsonb)`
- `crm_add_care_log(text, jsonb, jsonb)`
- `crm_snooze_customer(text, date, text, integer)`
- `crm_update_care_log(text, jsonb, jsonb)`
- `crm_archive_care_log(text, jsonb)`
- `crm_set_customer_archived(text, boolean)`
- `crm_save_basic_purchase(text, text, text, jsonb, jsonb)`
- `crm_submit_kpi_proposal(text, jsonb)`
- `crm_review_kpi_proposal(text, text, text, jsonb)`
- `crm_archive_kpi_proposal(text)`

## 7. File thay doi

- `supabase-phase-p0a-transaction-ownership.sql`: migration moi, khong sua migration lich su.
- `js/features/crm-app.js`: chuyen cac flow nghiep vu sang RPC; tam khoa hard delete/cleanup nguy hiem.
- `scripts/test-phase-p0a.mjs`: static contract, ownership, RPC, audit ID, owner preflight, Settings regression, duplicate HTML ID va frontend secret check.
- `scripts/test-phase-p0a-integration.sql`: test 6 case tren staging, luon `ROLLBACK`.
- `scripts/test-phase-p0a-staging-api.mjs`: test Auth/REST/RPC theo 4 role tren staging va cleanup fixture.
- `PHASE-P0A-TRANSACTION-RLS.md`: tai lieu nay.

## 8. Thu tu deploy sau khi backup

1. Backup Supabase va kiem tra file backup.
2. Deploy migration `supabase-phase-p0a-transaction-ownership.sql` tren staging truoc.
3. Chay `scripts/test-phase-p0a-integration.sql` tren staging bang SQL Editor/psql. Phai ket thuc khong loi va `ROLLBACK`.
4. Test UI staging bang Sale A, Sale B, manager/admin.
5. Chay migration production trong cua so bao tri.
6. Deploy frontend ngay sau migration. Khong deploy frontend RPC truoc migration.
7. Test smoke production bang du lieu test duoc phep, sau do xoa/an theo quy trinh.

Preflight read-only truoc migration:

```sql
select count(*) as total_customers,
       count(*) filter (where nullif(trim(owner_email), '') is null) as missing_owner_email
from public.customers;

select c.owner_email, count(*) as customer_count
from public.customers c
left join public.app_users u on lower(u.email) = lower(c.owner_email)
where c.owner_email is not null and u.id is null
group by c.owner_email
order by customer_count desc;
```

Sau khi backup, chay thu cong theo thu tu:

```powershell
node scripts/test-phase-p0a.mjs
```

Sau do mo Supabase SQL Editor cua **staging**, chay noi dung migration, roi chay `scripts/test-phase-p0a-integration.sql`. Chi khi staging PASS moi lap lai migration tren production trong maintenance window.

## 9. Rollback

Rollback frontend: deploy lai commit truoc P0-A.

Rollback database khong nen xoa cot `owner_user_id`/`created_by_user_id`, vi lam mat nen ownership moi. Neu buoc lui khan cap:

1. Bat maintenance mode.
2. Deploy lai policy tam thoi duoc DBA review.
3. Vo hieu trigger owner guard chi khi frontend cu buoc phai dung.
4. Khong drop cot, khong xoa audit.
5. Dieu tra va deploy lai P0-A sau khi sua.

Can tao mot migration rollback rieng neu that su can; khong chay cac cau lenh rollback thu cong khong duoc review tren production.

## 10. Test production read-only/safe

Sau deploy co the kiem tra khong ghi du lieu:

- Dang nhap Sale A va xac nhan chi thay customer dang owner.
- Dang nhap Sale B va xac nhan tuong tu.
- Manager kiem tra danh sach tong.
- SQL read-only: dem `owner_user_id is null` va doi chieu voi `owner_email` khong tim thay user.
- SQL read-only: kiem tra `created_by_user_id` van giu nguoi tao sau cac transfer da co.
- Kiem tra audit log moi nhat cua `transferCustomerOwner` sau mot ca transfer test duoc phep.

Khong test transfer tren customer that neu chua co ke hoach nghiem thu va rollback nghiep vu.

## 11. Gioi han va rui ro con lai

- Ban ghi customer co `owner_email` khong khop user active se lam migration fail va rollback. Can remediation ownership co audit truoc khi chay lai.
- Bulk maintenance va employee lifecycle van con adapter batch gia vi ngoai pham vi P0-A.
- Storage KPI khong the atomic voi PostgreSQL.
- Migration va integration da PASS tren staging `ykhtpvyelpujykheycsv`; production van bi chan boi ownership remediation va UI OAuth smoke test.
- Frontend moi phu thuoc migration moi, do do thu tu deploy la bat buoc.

## 12. Quality gates trong repo

- `node --check` cho tat ca JavaScript noi bo: PASS.
- `node scripts/test-phase-p0a.mjs`: PASS, 80 checks.
- Duplicate HTML ID check: PASS, nam trong static test.
- Frontend secret scan: PASS, khong thay service role/database password/private key.
- `git diff --check`: PASS; chi co canh bao line ending LF/CRLF cua Git tren Windows.
- PostgreSQL integration staging: PASS, harness rollback khong de lai fixture.
- Auth/REST/RPC staging API: PASS, 12 checks va cleanup 0 fixture.
