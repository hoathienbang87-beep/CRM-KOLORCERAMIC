# Phase P0-B - Employee lifecycle va customer assignment

Ngay kiem tra: 2026-08-10
Repo: `D:\SUPABASE\CRM-KOLORCERAMIC`
Production ref: `jjeeazwlqcwynzquimeo`
Staging ref: `ykhtpvyelpujykheycsv`

## 1. Ket luan

**STAGING: PASS**
**PRODUCTION: NO-GO cho den khi review va chay migration thu cong sau backup.**

P0-B da duoc thiet ke, ap dung va kiem thu tren staging. Production khong bi ghi, khong chay migration, khong deploy frontend, khong commit va khong push.

## 2. Van de cu

1. `customers.owner_user_id` vua la du lieu hien tai, vua bi dung nhu lich su ownership.
2. `created_by_email` tung co the cap quyen cho nguoi tao sau khi khach da chuyen sale.
3. Vo hieu hoa/xoa nhan vien khong co quy trinh xu ly khach dang phu trach.
4. Owner cu khong co lich su phan cong co cau truc.
5. Customer co owner cu khong ton tai trong `app_users` khong co trang thai nghiep vu ro rang.
6. Chuyen owner bang update truc tiep co nguy co sai cache va thieu audit.

## 3. Kien truc moi

`customer_assignments` la source of truth cho quyen phu trach.

- Moi customer toi da mot assignment hien tai (`is_current = true`).
- Lich su cu duoc giu bang assignment da ket thuc.
- `customers.owner_user_id`, `owner_email`, `owner` chi la compatibility cache do database dong bo.
- `created_by_user_id` va `created_by_email` chi la lich su nguoi tao, khong cap ownership.
- Customer khong co current assignment la `UNASSIGNED`; khong tao user gia `CRM_UNASSIGNED`.
- Follow-up van nam tren customer. Unassign/deactivate khong xoa `next_care_date`, `follow` hoac lich su cham soc.

## 4. Employee lifecycle

`app_users.lifecycle_status` co ba trang thai:

| Trang thai | Y nghia |
|---|---|
| `active` | Dang lam viec va co the nhan khach |
| `inactive` | Tam ngung; khong duoc vao CRM va khong duoc nhan assignment moi |
| `archived` | Da luu tru; van giu lai de bao cao va audit |

Khong hard-delete employee. Foreign key assignment dung `ON DELETE RESTRICT` de bao ve lich su.

## 5. Xu ly du lieu legacy

Migration tu dong xu ly hai nhom:

1. Owner hop le, active: tao current assignment voi `assigned_at` theo ngay tao customer.
2. Owner khong ton tai/khong active: tao ended assignment snapshot de giu ten/email cu, sau do dua customer ve pool `UNASSIGNED`.

Vi vay 22 customer production co owner bat thuong khong con can gan tay vao mot user gia. Du lieu owner cu van duoc bao ton trong assignment history va `raw_data`.

Migration khong `DELETE` customer, care log, KPI, employee hoac audit log.

## 6. RPC nghiep vu

| RPC | Quyen | Tac dung |
|---|---|---|
| `crm_create_customer` | Active user | Tao customer va assignment trong mot transaction; sale bat buoc tu nhan, manager co the tao unassigned |
| `crm_assign_customer` | Manager/admin/owner | Gan/chuyen customer sang employee ACTIVE va ghi audit |
| `crm_unassign_customer` | Manager/admin/owner | Dua customer ve pool, giu follow-up va ghi audit |
| `crm_bulk_assign_customers` | Manager/admin/owner | Gan nhieu customer atomic; mot dong loi thi rollback ca lo |
| `crm_transfer_customer` | Manager/admin/owner | Wrapper tuong thich nguoc sang assignment RPC |
| `crm_create_employee` | Manager/admin/owner theo policy hien tai | Tao profile employee co lifecycle |
| `crm_update_employee_profile` | Manager/admin/owner | Sua thong tin employee |
| `crm_deactivate_employee` | Manager/admin/owner | Chuyen toan bo customer ve pool hoac transfer roi moi inactive |
| `crm_reactivate_employee` | Manager/admin/owner | Active lai, khong tu dong lay lai customer cu |
| `crm_archive_employee` | Admin/owner | Archive employee khong con current assignment |

Tat ca RPC ghi quan trong la `SECURITY DEFINER`, co `search_path = public`, tu kiem tra Auth/role va bi revoke khoi `public/anon`. Frontend khong dung service role.

## 7. RLS va ownership

`crm_can_access_customer_id` chi cho phep:

- manager/admin/owner active; hoac
- employee active dang la current assignment.

Khong con nhanh cap quyen qua `created_by`.

Sau khi chuyen A sang B:

- Sale A mat quyen doc/sua customer, care log va mua can ban cua customer.
- Sale B co quyen theo current assignment.
- Manager/admin van co quyen.
- `created_by_*` khong doi.
- Assignment cu ket thuc va audit ghi actor, owner cu, owner moi, timestamp.

Direct insert customer, direct update owner cache va direct write assignment deu bi chan; frontend phai dung RPC.

## 8. Follow-up khi unassign/deactivate

- `next_care_date`, `follow`, `last_contact_at` khong bi xoa.
- Manager/admin van thay customer trong pool va thay lich hen con mo.
- Employee inactive mat quyen runtime.
- Khi gan cho employee moi, lich hen hien co di theo customer.
- Modal deactivate thong bao so customer va so follow-up dang mo, cho chon dua ve pool hoac transfer.

## 9. KPI sau chuyen giao

- KPI de xuat van tinh theo proposal da duyet va employee snapshot cua proposal.
- `Khach moi` khong duoc quy lai cho owner moi chi vi customer bi chuyen giao.
- Frontend quy nguon khach moi theo sale tao customer; neu nguoi tao khong phai sale thi dung assignment dau tien.
- Current owner van duoc dung cho danh sach khach dang phu trach.
- Han che con lai: sale cu da mat quyen customer se khong tu doc lai chi tiet customer do; bao cao lich su day du cho sale cu nen duoc cung cap sau bang aggregate RPC neu nghiep vu yeu cau.

## 10. UI toi thieu da them

- The nhanh `Khach cho phan bo`.
- Pool unassigned co owner snapshot cu, ngay tao, lich cham va so ngay cho.
- Chon nhieu customer va gan hang loat.
- Xuat danh sach unassigned XLSX.
- Timeline customer co lich su assignment.
- Quan tri employee co lifecycle, deactivate, reactivate va archive.
- Sale khong thay/chinh owner ngoai policy hien tai.

## 11. Test evidence staging

### PostgreSQL integration

`scripts/test-phase-p0b-integration.sql`: PASS.

- Tao customer + assignment atomic.
- Direct assignment va direct owner cache write bi chan.
- Unassign giu follow-up, lich su va RLS dung.
- Reassign dung current owner.
- Deactivate xu ly customer atomic.
- Reactivate khong tu dong reclaim customer.
- Bulk assignment all-or-nothing.
- Legacy owner snapshot duoc giu.
- Unique partial index bao dam mot current assignment.

`scripts/test-phase-p0a-integration.sql`: PASS sau P0-B.

### Auth/REST/RPC

`scripts/test-phase-p0b-staging-api.mjs`: PASS 17 checks.

- Sale create dung assignment/cache.
- Direct write bi chan.
- Manager thay unassigned va follow-up; sale khong thay.
- Concurrent assign chi con dung mot current assignment.
- Reassignment giu nguyen acquisition identity cua sale ban dau.
- Sale moi co quyen, sale cu mat quyen.
- Deactivate ve pool, inactive mat runtime.
- Bulk failure rollback dong da xu ly truoc.
- Assign va deactivate dong thoi khong de assignment tren employee inactive.
- Anonymous bi chan.

`scripts/test-phase-p0a-staging-api.mjs`: PASS 12 checks sau P0-B.

Tat ca Auth/database fixture staging da duoc cleanup; khong con record test P0-A/P0-B.

## 12. File da sua/them

- `supabase-phase-p0a-transaction-ownership.sql`
- `supabase-phase-p0b-employee-assignment.sql`
- `js/firebase.js`
- `js/features/crm-app.js`
- `index.html`
- `css/styles.css`
- `scripts/test-phase-p0a-integration.sql`
- `scripts/test-phase-p0a-staging-api.mjs`
- `scripts/test-phase-p0a.mjs`
- `scripts/test-phase-p0b-integration.sql`
- `scripts/test-phase-p0b-staging-api.mjs`
- `scripts/test-phase-p0b.mjs`
- `PHASE-P0A-STAGING-VALIDATION.md`
- `PHASE-P0B-EMPLOYEE-ASSIGNMENT-ARCHITECTURE.md`

## 13. Thu tu deploy production sau khi duoc phep

1. Bat maintenance mode.
2. Xac nhan backup production va checksum con day du.
3. Xac nhan production ref dung `jjeeazwlqcwynzquimeo`.
4. Chay `supabase-phase-p0a-transaction-ownership.sql`.
5. Ngay sau do chay `supabase-phase-p0b-employee-assignment.sql`.
6. Chay catalog/read-only verification: current assignment duy nhat, cache khop assignment, 22 legacy anomalies thanh unassigned.
7. Deploy frontend cung version P0-A/P0-B.
8. Smoke test admin/manager/sale bang du lieu test co kiem soat.
9. Kiem tra audit, pool unassigned, follow-up va KPI.
10. Chi tat maintenance khi tat ca check PASS.

Khong deploy frontend P0-B truoc database. Khong de production chay lau chi voi P0-A ma chua P0-B.

## 14. Rollback

- Neu mot migration loi truoc `COMMIT`, PostgreSQL tu rollback migration do.
- Neu P0-B da commit nhung frontend loi: giu maintenance, rollback frontend ve ban truoc; owner cache van tuong thich doc.
- Khong drop `customer_assignments`, khong xoa lich su va khong hard-delete employee.
- Neu can quay lai policy cu, phai tao forward-fix migration rieng da test staging. Khong paste SQL va production.
- Restore backup chi la bien phap cuoi va phai duoc dien tap tren project trong truoc.

## 15. Viec chua lam va rui ro con lai

1. Chua chay P0-A/P0-B tren production.
2. Chua deploy frontend.
3. Chua smoke test Google OAuth staging bang browser.
4. Chua co aggregate RPC cho sale xem thong ke khach lich su da chuyen khoi minh.
5. Chua commit/push theo dung yeu cau phase.
6. UI pool/lifecycle moi can nguoi dung nghiem thu tren staging truoc production.

## 16. Lenh thu cong sau backup

Khong chay lenh nao tren production cho den khi owner review file migration va bao cao nay. Khi duoc phep, nen chay hai file SQL bang Supabase SQL Editor theo dung thu tu o muc 13 trong cua so maintenance; khong dung `db reset`, khong dung `db push` khong kiem soat.
