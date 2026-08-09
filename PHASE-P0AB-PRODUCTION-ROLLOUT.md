# Phase P0-A/P0-B - Production rollout

Ngay rollout: 2026-08-10

## 1. Ket luan

**GO LIVE**

Production `jjeeazwlqcwynzquimeo` da chay P0-A va P0-B. Frontend production da deploy dung version, maintenance da tat sau khi database, RLS/RPC, Auth/REST va static frontend smoke test deu PASS.

Khong bat dau KPI redesign, P1, P2, ERP/CMS cleanup hoac refactor UI khac.

## 2. Project guard

| Hang muc | Gia tri |
|---|---|
| Repo | `D:\SUPABASE\CRM-KOLORCERAMIC` |
| Branch | `main` |
| Production | `jjeeazwlqcwynzquimeo` |
| Staging | `ykhtpvyelpujykheycsv` |
| GitHub | `hoathienbang87-beep/CRM-KOLORCERAMIC` |
| Production URL | `https://crmkolor.vercel.app/` |

## 3. Backup evidence

Backup: `D:\SUPABASE\BACKUPS\CRM-KOLORCERAMIC-2026-08-10-0301-PRE-UPGRADE`

| File | Size | Checksum |
|---|---:|---|
| `roles.sql` | 5,643 bytes | PASS |
| `schema.sql` | 293,203 bytes | PASS |
| `data.sql` | 2,434,929 bytes | PASS |
| Storage `kpi-evidence` | 66 files / 42,767,879 bytes | 66/66 PASS |

Backup khong bi sua/xoa. `SHA256.txt` va `STORAGE-SHA256.txt` van khop thuc te.

## 4. Git snapshot va deploy commits

| Moc | Commit |
|---|---|
| Baseline truoc P0 | `e90592d5b752204a895f85139f42a1abd52dcf0a` |
| P0-A/P0-B snapshot | `53532366b90ec17257e26a92cab0d343e125ce66` |
| Maintenance ON | `774741dac6c0a186f2a728d3481fdeba2c516432` |
| Frontend rollout / maintenance OFF | `31f72843f881561ce3dfbd9ba59b9069530d1c4a` |

Maintenance duoc deploy truoc migration qua GitHub/Vercel integration. Live config da duoc xac nhan `enabled: true` truoc khi ghi database.

Vercel CLI tren may dang login mot account khac khong chua CRM project. Rollout khong dung account do; dung dung GitHub remote va Vercel integration hien tai. GitHub deployment status tra `success`.

## 5. Production preflight

Read-only preflight ngay truoc migration:

| Metric | Gia tri |
|---|---:|
| Active customers | 167 |
| Owner khong map `app_users` | 22 |
| Distinct missing owner | 2 |
| Owner inactive | 0 |
| Null owner | 0 |
| Duplicate employee email | 0 |
| Customer policy dung `created_by` | 5 |

Ket qua khop baseline staging/audit.

## 6. Migration result

### P0-A

**PASS / COMMIT**

- Them/backfill `owner_user_id`, `created_by_user_id`.
- Tao RPC transaction, owner guard va canonical policies.
- 7 RPC P0-A ton tai sau migration.

### P0-B

Lan chay dau gap PostgreSQL deadlock khi doi policy. Transaction P0-B rollback toan bo. Read-only state check xac nhan:

- P0-A van day du.
- `customer_assignments` chua ton tai.
- `lifecycle_status` chua ton tai.
- Khong co partial P0-B state.

Sau khi xac nhan maintenance van bat, khong co query nghiep vu active va database nhat quan, da retry dung nguyen file P0-B mot lan. Lan retry **PASS / COMMIT**.

Khong va SQL ad-hoc, khong DELETE/DROP thu cong.

## 7. Remediation 22 customer

| Check | Ket qua |
|---|---:|
| Legacy snapshot customer | 22 |
| Van active | 22 |
| Co current assignment | 0 |
| Owner cache con gia tri | 0 |
| Fake `CRM_UNASSIGNED` employee | 0 |
| Care logs con lai | 18 |
| Basic purchase rows con lai | 1 |
| Audit rows con lai | 43 |

Danh sach doi chieu private read-only:

`D:\SUPABASE\BACKUP-TEMP\p0ab-unassigned-production-private.csv`

File co 22 dong va SHA256 rieng, nam ngoai Git repo.

## 8. Assignment integrity

| Check | Ket qua |
|---|---:|
| Active customers | 167 |
| Current assignments | 145 |
| Unassigned active customers | 22 |
| Customer co nhieu current assignment | 0 |
| Orphan assignment | 0 |
| Current assignment toi employee inactive | 0 |
| Current assignment thieu employee | 0 |
| Owner cache mismatch | 0 |
| Unassigned con owner cache | 0 |
| Customer policy dung `created_by` | 0 |
| Required P0-B RPC | 10 |
| Anonymous EXECUTE tren required RPC | 0 |

## 9. RLS/RPC/Auth tests

PostgreSQL integration P0-A va P0-B chay tren production trong transaction co `ROLLBACK`: **PASS**.

Auth/REST/RPC production smoke: **PASS 18/18**.

- Sale tao customer co assignment/cache dung.
- Direct assignment va direct owner update bi chan.
- Manager thay unassigned; sale khong thay.
- Concurrent assignment chi con mot current assignment.
- Sale moi co quyen; sale cu mat quyen.
- `created_by`/assignment dau tien van giu acquisition identity.
- Assignment workflow co audit.
- Deactivate dua khach ve pool, giu follow-up.
- Bulk partial failure rollback toan bo.
- Assign/deactivate race khong de khach tren employee inactive.
- Anonymous RPC bi chan.

Cleanup: 0 test profile, customer, assignment, audit hoac Auth user con lai.

## 10. Frontend deploy va smoke test

Live production da khop noi dung local sau deploy:

- `index.html`
- `css/styles.css`
- `js/app.js`
- `js/features/crm-app.js`
- `js/firebase.js`
- `js/config/maintenance.generated.js`

Maintenance live hien `enabled: false`.

Google Auth health PASS; Google provider enabled; OAuth probe tra `302` toi `accounts.google.com`.

Auth/REST smoke da bao phu login token, customer, care ownership, assignment, unassigned pool, bulk assignment va employee lifecycle. Khong co browser-control session de tu dong click UI bang tai khoan nguoi that; nen van khuyen nghi owner test nhanh login va cac nut chinh sau rollout.

## 11. Settings regression

- PostgreSQL Settings regression trong P0-A integration: PASS va ROLLBACK.
- `settings.data` mismatch `settings.raw_data`: 0.
- Migration P0-A/P0-B khong thay doi payload Settings production.

## 12. Audit va error checks

- Assignment audit: PASS.
- Existing history cua 22 customer: con du.
- Supabase database lint: PASS, 0 error.
- Orphan/multiple assignment: 0.
- Inactive employee current assignment: 0.
- Fixture residual: 0.

## 13. Maintenance status

**OFF - he thong da mo lai.**

Maintenance chi duoc tat sau khi migration, integrity, RLS/RPC, API cleanup va frontend content verification deu PASS.

## 14. Rollback point

Neu co P0 frontend issue nghiem trong:

1. Deploy lai maintenance commit `774741dac6c0a186f2a728d3481fdeba2c516432` de khoa app.
2. Khong deploy frontend baseline `e90592d` tren database moi vi frontend cu khong tuong thich RPC-only ownership.
3. Uu tien forward-fix tu snapshot `53532366b90ec17257e26a92cab0d343e125ce66`.
4. Khong drop `customer_assignments`, khong xoa lifecycle/history.
5. Restore backup chi la bien phap cuoi va phai lap ke hoach rieng.

## 15. Chua lam

- KPI redesign/snapshot phase moi.
- P1/P2.
- Refactor UI/admin ngoai P0-B.
- Xoa ERP/CMS legacy.
- Chuan hoa lai Vercel CLI ve dung account CRM.
