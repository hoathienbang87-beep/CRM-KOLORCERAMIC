# Phase P0-A - Kiem chung staging truoc production

Ngay kiem tra: 2026-08-10
Repo: `D:\SUPABASE\CRM-KOLORCERAMIC`

## 1. Ket luan

**STAGING P0-A + P0-B: PASS**
**PRODUCTION: NO-GO cho den khi review va chay thu cong P0-A + P0-B sau backup**

P0-A va P0-B da duoc ap dung va kiem thu tren Supabase staging rieng. Production chua bi thay doi, chua deploy frontend, chua push va chua commit.

Danh gia P0-A doc lap ben duoi la lich su tai thoi diem truoc P0-B. P0-B da thay the phuong an gan tay 22 customer bat thuong: cac owner cu duoc giu bang assignment snapshot, customer chuyen ve pool `UNASSIGNED`, khong tao user gia. Xem tai `PHASE-P0B-EMPLOYEE-ASSIGNMENT-ARCHITECTURE.md`.

## 2. Preflight

| Hang muc | Ket qua |
|---|---|
| Branch | `main` |
| HEAD baseline | `e90592d5b752204a895f85139f42a1abd52dcf0a` |
| Working tree | Co thay doi P0-A chua commit |
| Supabase CLI | `2.113.0` qua `npx --yes supabase` |
| CLI login | PASS |
| CRM production ref | `jjeeazwlqcwynzquimeo` |
| Staging ref | `ykhtpvyelpujykheycsv` |
| Staging name | `CRM-KOLORCERAMIC-STAGING` |
| Staging region | Singapore, `ap-southeast-1` |
| Staging status | `ACTIVE_HEALTHY` |
| APP-SO ref | `yyjomihkrhjpzxekunfo`, khong duoc dung |

Moi lenh ghi trong phase validation nay deu dung workdir tam da link cung `ykhtpvyelpujykheycsv`. Production chi duoc dump schema/read-only preflight.

## 3. Staging strategy da dung

Staging la project moi, ban dau co 0 table trong schema `public`.

1. Dump **schema-only, public-only** tu production bang `pg_dump` read-only.
2. Khong copy customer, user, KPI, audit log hoac du lieu nhay cam production.
3. Khong ghi de cac schema Supabase managed nhu `auth`, `storage`, `realtime`.
4. Dung public schema production lam baseline de co dung table/function/RLS/Settings hien tai.
5. Ap dung migration P0-A tren staging.
6. Integration fixture duoc tao trong transaction va `ROLLBACK`.
7. API fixture duoc tao tam qua Auth/REST/RPC va xoa sach trong `finally`.

Kiem tra sau test: 0 fixture `app_users`, `auth.users`, `customers`, `care_logs`, `deals`, `kpi_rules`, `kpi_proposals` con lai.

## 4. Migration order va dependency

Trang thai production duoc xac dinh bang object thuc te trong backup/catalog:

| Object/migration | Production |
|---|---|
| Phase 1 security foundation | Da co bang/helper can thiet |
| Phase F CRM RLS cleanup | Da co helper va RLS |
| Phase 8 settings persistence | Da ap dung; trigger `settings_sync_payload` ton tai |
| Phase P0-A | Chua ap dung |

Thu tu staging da chay:

1. Public schema baseline tu production hien tai.
2. `supabase-phase-p0a-transaction-ownership.sql`.
3. `scripts/test-phase-p0a-integration.sql`.
4. `scripts/test-phase-p0a-staging-api.mjs` qua wrapper tam khong luu key.

Phase 8 khong phai dependency truc tiep cua P0-A. P0-A phu thuoc object Phase 1 va Phase F. Phase 8 duoc giu trong baseline de kiem tra Settings khong regression.

## 5. Migration result va cac loi da tim thay

### 5.1 Audit ID bat buoc

`audit_logs.id` la `NOT NULL` va khong co default. Ban P0-A ban dau bo quen ID khi ghi audit, lam moi RPC bat buoc audit rollback.

Da sua migration:

- `crm_write_audit` tao `id` bang `gen_random_uuid()::text`.
- Static test bat buoc xac nhan audit ID.

### 5.2 Owner preflight fail-closed

Da them guard:

- Customer active con `owner_user_id is null` sau backfill -> raise `CRM_OWNER_PREFLIGHT_FAILED` va rollback.
- Customer active thuoc user inactive -> rollback.

### 5.3 Legacy permissive policies

Integration lan dau fail vi baseline con:

- `customers scoped read`
- `customers scoped write`
- `care logs scoped`
- `deals scoped`

PostgreSQL OR cac permissive policy, nen policy cu van cap quyen theo `created_by_email`/snapshot owner du policy owner-only moi da ton tai.

Da sua migration:

- Xoa moi policy nghiep vu khong phai admin tren `customers`, `care_logs`, `deals`.
- Tao lai policy canonical theo `owner_user_id` va current customer access.
- Migration duoc chay lai nguyen file, khong va database ad-hoc.

Sau sua: legacy scoped policy count = 0.

### 5.4 Harness fixture

Fixture care log lan dau thieu `careChannel`; test dung som va transaction rollback. Da sua fixture theo contract hien tai, sau do harness PASS.

API test ban dau cung bat duoc hai loi test setup, khong phai production logic:

- Wrapper chon sai array API key; request bi 403 truoc khi tao du lieu.
- Archive/restore duoc test nham bang sale; contract dung la manager archive, admin restore.

Da sua test, cleanup xac nhan 0 fixture con sot.

## 6. PostgreSQL integration evidence

`scripts/test-phase-p0a-integration.sql`: **PASS**.

Mapping 10 yeu cau:

| Yeu cau | Evidence |
|---|---|
| Tao customer atomic | Customer + phone index + audit ton tai trong CASE 1 |
| Ep loi giua transaction | Trigger ep audit fail, customer/phone index khong ton tai |
| Sale A la owner | CASE 1 + CASE 3 |
| Manager transfer A -> B | CASE 4 |
| Sale A mat quyen | Customer/care/deal deu khong con doc duoc |
| Sale B co quyen | Customer/care/deal deu doc duoc |
| `created_by` giu lich su | `created_by_user_id` van la Sale A |
| Sale direct-update owner | Bi trigger chan voi SQLSTATE 42501 |
| Anonymous | Khong co EXECUTE RPC |
| Audit transaction | Create/transfer audit dung; audit fail rollback ca transaction |

Harness bo sung Settings regression: partial update van giu `settings.data = settings.raw_data`. Tat ca fixture duoc outer `ROLLBACK`.

## 7. Auth/REST/RPC staging evidence

`scripts/test-phase-p0a-staging-api.mjs`: **PASS 12 checks**.

1. Sale A tao va own customer.
2. Sua ho so va read-back dung.
3. Sale khong direct-update owner.
4. Sale A mat customer sau transfer.
5. Sale B co customer sau transfer.
6. `created_by` van la Sale A.
7. Manager van xem duoc.
8. Admin van xem duoc.
9. Care log va mua can ban di theo current owner.
10. KPI submit/review hoat dong.
11. Manager archive, admin restore hoat dong.
12. Anonymous RPC bi chan.

Test dung 4 Auth user tam tren staging va xoa sach trong `finally`. Service-role chi duoc lay tam trong memory cua wrapper ngoai repo; khong dua vao frontend, source, report hay Git.

## 8. Security validation

| Check | Ket qua |
|---|---:|
| Required RPC | 13/13 |
| `SECURITY DEFINER` | 13/13 |
| `search_path=public` | 13/13 |
| Authenticated EXECUTE | 13/13 |
| Anonymous EXECUTE | 0/13 |
| Owner guard trigger | 1 |
| RLS table `customers/care_logs/deals` | 3/3 |
| Legacy owner/created_by policy | 0 |

## 9. Frontend compatibility

Static inspection xac nhan UI hien tai goi dung RPC cho:

- Create/edit customer.
- Add/update/archive care log.
- Snooze/reschedule care.
- Basic purchase.
- Archive/restore customer.
- Transfer owner.
- KPI submit/review/archive.

`callCrmRpc` throw khi Supabase tra error; UI chi bao success sau khi `await` thanh cong. API test da chay qua cung Auth/REST/RPC contract ma frontend su dung.

Chua chay OAuth Google bang browser staging vi project staging chua cau hinh Google provider/redirect URL. Day khong anh huong database/RLS evidence, nhung can smoke test UI staging truoc production rollout.

## 10. Ownership preflight production (read-only)

Tat ca query production chay trong read-only transaction va `ROLLBACK`.

| Metric | So luong |
|---|---:|
| Customer active | 167 |
| Owner email rong | 0 |
| Owner email khong ton tai trong `app_users` | 22 |
| So owner identity khong hop le | 2 |
| Invalid owner nhung ten khop active user | 0 |
| Customer thuoc owner inactive | 0 |
| Duplicate `app_users.email` | 0 |
| `created_by_email = owner_email` | 135 |
| `created_by_email <> owner_email` | 32 |
| Customer policy production con dung `created_by` | 5 |

Da tao file private ngoai repo:

`D:\SUPABASE\BACKUP-TEMP\CRM-KOLORCERAMIC-STAGING\ownership-remediation-private.csv`

File co 22 dong va cot trong `new_owner_email`. File chua du lieu khach hang, khong duoc commit/push/chia se cong khai.

## 11. Regression/quality gates

| Check | Ket qua |
|---|---|
| `node scripts/test-phase-p0a.mjs` | PASS, 80 checks tai moc staging |
| `node --check` JS noi bo | PASS |
| Duplicate HTML ID | PASS |
| Secret scan | PASS |
| `git diff --check` | PASS; chi canh bao LF/CRLF Windows |
| Settings persistence SQL | PASS staging integration |
| PostgreSQL P0-A integration | PASS |
| Auth/REST/RPC staging API | PASS 12 checks |
| Fixture cleanup | PASS, 0 record con lai |

## 12. Trang thai sau P0-B

Danh sach blocker va ke hoach CSV cu ben duoi da duoc huy bo boi kien truc P0-B. Owner khong hop le duoc giu bang historical snapshot va customer ve pool `UNASSIGNED`; owner khong can gan tay 22 customer cho sale khac.

Production van **NO-GO** vi P0-A/P0-B chua duoc review va chay thu cong, frontend chua deploy cung version va chua smoke test Google OAuth staging.

## 13. Production rollout/rollback hien hanh

Dung duy nhat runbook trong `PHASE-P0B-EMPLOYEE-ASSIGNMENT-ARCHITECTURE.md`. Khong su dung `ownership-remediation-private.csv` cho workflow P0-B.
