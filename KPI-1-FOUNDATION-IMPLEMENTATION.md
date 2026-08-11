# KPI-1 - Foundation Schema, Period, Definition, Assignment va Canonical RLS

Ngay thuc hien: 2026-08-10

## 1. Ket luan

KPI-1 da duoc cai dat va kiem thu tren Supabase staging `ykhtpvyelpujykheycsv`.

Ket luan phase: **STAGING PASS - READY FOR KPI-1 PRODUCTION REVIEW**.

Chua co thay doi nao duoc chay tren production `jjeeazwlqcwynzquimeo`. Frontend production chua duoc deploy. Git chua commit/push.

## 2. Baseline

- Repository: `D:\SUPABASE\CRM-KOLORCERAMIC`
- Branch: `main`
- Baseline HEAD: `2e723ec19f3a99dde5de14fdacda09d5b91ab1e0`
- Source of truth: `KPI-0-BUSINESS-SPEC-AND-ARCHITECTURE.md`
- P0-A static regression: PASS, 80 checks
- P0-B static regression: PASS, 72 checks
- KPI-1 static contract: PASS, 121 checks
- Supabase CLI: 2.113.0
- Docker daemon khong chay. Viec nay chi lam CLI khong cache duoc migration catalog; khong anh huong migration staging hay test qua Management API.

## 3. Schema KPI-1

### `kpi_periods`

Luu mot ky KPI theo thang:

- `period_month` luon la ngay dau thang va unique.
- `status`: `DRAFT`, `ACTIVE`, `CLOSED`.
- `timezone` mac dinh `Asia/Ho_Chi_Minh`.
- Co moc thoi gian, actor lifecycle va `version` de chan stale update.
- Co thong tin reopen, nhung chi admin/owner duoc dung RPC reopen.

### `kpi_definitions`

La catalog/template KPI, khong phai target theo thang:

- `code` unique, `name`, `description`.
- `kpi_type`: `AUTO`, `MANUAL`, `HYBRID`.
- `source_metric_key`, `unit`.
- `submission_mode`: schema chua `EVENT_CLAIM` va `PERIOD_TOTAL`; UI KPI-1 chi dung `EVENT_CLAIM`.
- `evidence_required`, `active`, actor va `version`.

KPI-1 chi luu metadata AUTO/HYBRID, chua tinh actual.

### `kpi_assignments`

Gan KPI cho tung sale trong tung ky:

- FK den period, definition va `app_users.id`.
- Unique `(period_id, definition_id, employee_id)`.
- `target > 0` bat buoc o database.
- `assignment_status`: `ASSIGNED`, `CANCELLED`.
- `definition_snapshot` luu toan bo contract KPI tai luc assign.
- Co actor, cancellation history va `lock_version`.

Schema khong dung email lam FK va khong dung JSON `assigned_owners`/`owner_targets`.

## 4. Period lifecycle

### DRAFT

- Manager/admin/owner duoc tao va cau hinh bang RPC.
- Duoc sua ten, definition, assignment va target.
- Tat ca thay doi critical bi chan neu direct CRUD.

### ACTIVE

- Chi duoc kich hoat khi co assignment hop le.
- Sale nhan assignment phai la sale ACTIVE.
- Definition phai dang active va target phai lon hon 0.
- Target, assignment va snapshot bi khoa.

### CLOSED

- KPI-1 chua co submissions/reviews/results nen close final khong duoc gia lap.
- `crm_kpi_close_period_foundation` ghi audit va tra ve `KPI_REVIEW_FOUNDATION_INCOMPLETE`; period van ACTIVE.
- Day la fail-closed dung theo business specification.

### Reopen

- Manager bi chan.
- Chi admin/owner duoc reopen CLOSED bang RPC va bat buoc co reason.
- KPI-1 chi cung cap foundation; versioned result se thuoc KPI-2/KPI-3.

## 5. Monthly isolation

Khi tao assignment, database copy definition vao `definition_snapshot`.

Vi vay:

1. Thang 08 nhan snapshot ten A.
2. Period thang 08 ACTIVE va bi khoa.
3. Definition template doi thanh ten B.
4. Assignment thang 08 van la A.
5. Assignment tao cho thang 09 moi nhan B.

Target cung nam trong assignment, khong doc runtime tu definition.

## 6. RLS matrix

| Doi tuong | Period | Definition | Assignment | Direct write |
|---|---|---|---|---|
| Anonymous | Khong | Khong | Khong | Khong |
| Sale | ACTIVE/CLOSED co assignment cua minh | Khong doc catalog | Chi assignment cua minh | Khong |
| Manager | Doc tat ca | Doc tat ca | Doc tat ca sale | Khong; dung RPC |
| Admin/Owner | Doc tat ca | Doc tat ca | Doc tat ca | Khong; dung RPC |

Identity dung `auth.uid()` qua ho so `app_users`; policy KPI-1 khong cap quyen bang email.

Moi bang chi co mot canonical SELECT policy. DML cua `anon` va `authenticated` bi revoke. Trigger guard chan direct write ngay ca khi grant/policy bi mo nham ve sau.

## 7. RPC da them

Period:

- `crm_kpi_create_period`
- `crm_kpi_update_period`
- `crm_kpi_activate_period`
- `crm_kpi_close_period_foundation`
- `crm_kpi_reopen_period`

Definition:

- `crm_kpi_create_definition`
- `crm_kpi_update_definition`
- `crm_kpi_set_definition_active`

Assignment:

- `crm_kpi_assign_employee`
- `crm_kpi_bulk_assign`
- `crm_kpi_update_assignment_target`
- `crm_kpi_sync_definition_assignments`
- `crm_kpi_cancel_assignment`

Tat ca RPC nghiep vu:

- Yeu cau authenticated va active app user.
- Tu kiem tra role, khong tin role frontend gui len.
- Dung `SECURITY DEFINER` voi `search_path = public` bi khoa.
- Lock period/row va kiem tra version.
- Validate toan bo bulk payload truoc write.
- Audit trong cung PostgreSQL transaction.
- Loi bat ky lam rollback toan bo RPC.

## 8. Concurrency protection

- Activate lock period `FOR UPDATE` va check expected version.
- Assignment cung period duoc serialize qua period lock va unique constraint.
- Assignment tranh chap dung `NOWAIT` va advisory try-lock de request thua fail-fast, khong treo API.
- Optimistic version conflict tra `KPI_VERSION_CONFLICT` voi SQLSTATE khong retry; khong dung `40001` vi day la ma PostgreSQL co the bi tang API retry lai.
- Edit target va activate khong the cung ghi thanh cong tren stale version.
- Assignment va employee deactivation dung chung advisory transaction lock; ket qua chi co mot ben thang va khong de lai assignment DRAFT cho sale inactive.
- Definition snapshot dung row lock de khong tao snapshot bi xe doi khi definition dang edit.
- Bulk/sync matrix validate all-or-nothing, gioi han 200 sale moi request.

## 9. Audit

Audit KPI-1 dung bang `audit_logs` hien tai va ghi trong cung transaction:

- Period create/update/activate/close attempt/reopen.
- Definition create/update/active toggle.
- Assignment create/bulk/target update/matrix sync/cancel.

Payload co actor, entity, period/definition/assignment/employee lien quan, before/after, reason va timestamp cua audit row.

## 10. Manager UI foundation

UI KPI hien tai duoc giu nguyen va doi nhan thanh `KPI hien tai (legacy)`.

Manager/admin/owner co them khu `Ky KPI moi`:

- Tao period DRAFT theo thang.
- Tao/sua/bat/tat definition.
- Xem danh sach period va thong ke KPI/sale/assignment.
- Cau hinh assignment matrix, target rieng tung sale.
- Luu tung hang bang mot RPC atomic `crm_kpi_sync_definition_assignments`.
- Preview so KPI, sale, assignment va row khong hop le.
- Confirm ro truoc activate.
- ACTIVE/CLOSED hien notice khoa va khong co control sua.

Sale khong thay manager foundation panel. Legacy sale proposal/runtime chua bi chuyen sang model moi.

## 11. Staging migration

Migration source trong repo:

- `supabase-phase-kpi1-foundation.sql`
- SHA256 source sau cung: `D7610CD60E364C769E4226CFFFAEA08726A884C894795B3FA716EB8E87A03B0E`

Staging migration history:

- `20260810090000_kpi1_foundation.sql`
- `20260810091000_kpi1_foundation_reconcile.sql`
- `20260810092000_kpi1_concurrency_reconcile.sql`
- `20260810093000_kpi1_employee_lock_reconcile.sql`
- `20260810094000_kpi1_fail_fast_concurrency.sql`
- `20260810095000_kpi1_nonretry_version_conflict.sql`

Staging co cac migration reconcile de kiem thu va harden concurrency theo tung buoc. Production review chi can dung source sau cung mot lan, khong can copy chuoi reconcile staging.

Khong co DROP/ALTER legacy `kpi_rules` hoac `kpi_proposals`.

## 12. Test evidence

### PostgreSQL integration

`scripts/test-phase-kpi1-integration.sql` chay tren staging qua `supabase db query --linked`.

- Outer transaction ket thuc bang `ROLLBACK`.
- PASS: role, period, duplicate month, target, employee eligibility, bulk atomicity, RLS, monthly snapshot, cancel/reassign, deactivation guard, close fail-closed, reopen va audit.

### Auth/REST/RPC/RLS/concurrency

`scripts/run-phase-kpi1-staging-api.ps1`

- PASS 23/23 checks.
- PASS cleanup, 0 residual fixture profile/period/definition.
- Co test race activate/edit, duplicate assign, definition edit/snapshot, assign/deactivate employee, invalid bulk rollback, anonymous denial va sale isolation.

### Manager browser UI

`scripts/run-phase-kpi1-staging-ui.ps1`

- PASS dang nhap manager staging.
- PASS tao DRAFT period va definition.
- PASS matrix target cho sale.
- PASS activate va locked notice.
- PASS legacy KPI panel van hien.
- Browser runtime cai ngoai repo tai `D:\SUPABASE\BACKUP-TEMP`; khong them dependency vao production app.
- Fixture duoc xoa sau test.

### Static/regression

- KPI-1: PASS 121 checks.
- P0-A: PASS 80 checks.
- P0-B: PASS 72 checks.
- JavaScript syntax: PASS.
- Duplicate HTML ID: PASS.
- `git diff --check`: PASS.
- Secret scan: PASS sau khi loai public anon key theo dung mo hinh Supabase.

### DB lint

KPI-1 khong con warning.

Con mot warning legacy `crm_json_timestamptz` duoc danh dau `IMMUTABLE` nhung co expression `STABLE`. Warning nay co truoc KPI-1, khong nam trong scope va khong anh huong test KPI-1. Can dua vao backlog hardening rieng.

## 13. Legacy compatibility

- Khong migrate/xoa/sua schema `kpi_rules` va `kpi_proposals`.
- Khong migrate evidence.
- Khong doi submission/review/result runtime cua sale.
- Khong them calculator AUTO/HYBRID.
- Khong thay dashboard KPI cu.
- Frontend chi them manager foundation panel va table mappings moi.

Thu tu rollout bat buoc trong tuong lai la database truoc, frontend sau. Neu deploy frontend truoc migration, manager watcher se gap table-not-found.

## 14. Risks con lai

1. KPI-1 chua co submission/review/result nen khong duoc close final.
2. Chua co source event claim/dedup table; schema foundation khong can tro KPI-2 bo sung unique source claim.
3. Chua co ACTIVE amendment workflow. KPI-1 chu dong khoa hoan toan.
4. Frontend van la vanilla HTML/JS mot ung dung lon; KPI-1 khong refactor architecture UI.
5. Legacy KPI va KPI-1 cung ton tai tam thoi; can nhan UI ro de manager khong nham.
6. Warning DB lint legacy can xu ly o phase hardening rieng.

## 15. Remaining KPI-2 work

KPI-2 nen thiet ke rieng:

- `kpi_submissions`
- `kpi_reviews`
- `kpi_results`
- `kpi_result_sources`
- Event claim dedupe theo period/definition/employee/source event.
- Evidence lifecycle va storage authorization.
- Review pending/approved/rejected.
- Close period production-grade dua tren completion gate.
- Result version/snapshot va reopen semantics day du.

Khong tu suy KPI legacy thanh AUTO theo ten.

## 16. Production rollout proposal

Chua duoc thuc hien. De production review:

1. Backup production database va inventory Storage.
2. Commit/tag baseline on dinh sau khi owner review diff.
3. Bat maintenance neu deployment co UI va SQL gan nhau.
4. Tao workspace migration production rieng ngoai repo.
5. Xac nhan project ref dung `jjeeazwlqcwynzquimeo`.
6. Copy source SHA256 o tren thanh mot migration production moi.
7. Chay `supabase db push --linked --dry-run` va review chi co migration KPI-1.
8. Chi sau phe duyet moi push migration production.
9. Chay smoke SQL read-only/safe va Auth/RPC fixture co cleanup.
10. Deploy frontend sau khi database PASS.
11. Test manager/admin/owner va xac nhan sale legacy van hoat dong.

Rollback staging/production chi nen thuc hien neu chua co KPI-1 data that. Vi KPI-1 la schema additive, phuong an an toan khi frontend co loi la rollback frontend va giu tables/RPC khong duoc su dung; khong DROP schema trong tinh huong khan cap.
