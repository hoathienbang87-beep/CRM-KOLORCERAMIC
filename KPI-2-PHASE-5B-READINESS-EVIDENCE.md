# CRM-KOLORCERAMIC — KPI-2 Phase 5B readiness evidence

Date: 2026-09-13 (Asia/Ho_Chi_Minh)  
Scope: local reproducibility and production read-only evidence only

## 1. Conclusion

Local reproducibility is unblocked: one disposable bootstrap command rebuilds the CRM/KPI schema and passes the Phase 2C A–O runtime harness. Production read-only evidence is also unblocked through the authenticated Supabase CLI. Phase 6 remains blocked only on KPI-by-KPI mode approval and production rollout prerequisites. No production write or deploy occurred.

## 2. Starting HEAD

Phase 4 code baseline: `0cc7467e427602c1dd0318547f659aa7c9ebe97c`. Phase 5B started from `801f38c0ce0baee68d4df2e1ed60fbb735a4ea24` (Phase 5 documentation commit).

## 3. Ending HEAD

Implementation HEAD before this report: `db3d19ed7963f47dc6fb499f4d39d1c3df1422d6`. The final documentation commit is reported in the task handoff.

## 4. Files changed

- `scripts/test-phase-kpi21e.mjs`: retires the stale legacy UI expectation and verifies the canonical post-R3 state.
- `scripts/bootstrap-local-kpi2.ps1`: fail-fast disposable bootstrap and A–O runner.
- `scripts/kpi2-local-bootstrap-prerequisites.sql`: test-only normalization between the tracked minimal baseline and reviewed CRM artifacts.
- `supabase/config.toml`: local-only ports outside the Windows/Hyper-V reserved range; analytics disabled locally.
- This report.

Existing unrelated user changes, including `vercel.json`, were not modified or staged.

## 5. Local schema topology root cause

The project intentionally uses reviewed one-off root SQL artifacts, not `supabase/migrations/`. `KPI-2-PRODUCTION-RUNBOOK.md` states that production migration history is non-canonical and that KPI-2 used the consolidated artifact. Therefore `supabase db reset` can only recreate Supabase-managed schemas and produces an empty `public` schema.

Phase 2C A–O previously passed because it ran against a production-like public baseline with the Phase 2 artifact applied directly; it did not prove that `supabase db reset` knew the root SQL order. The two observations are consistent.

Historical/development-only KPI-2 reconcile and remediation files remain audit artifacts and are not replayed. The production artifact is `supabase-phase-kpi2-final-consolidated.sql`.

## 6. Repeatable disposable DB solution

Command:

```powershell
pwsh -NoProfile -File scripts/bootstrap-local-kpi2.ps1
```

The runner verifies the exact local project ID, recreates only `local-product-r2`, never reads production credentials, preserves Supabase-managed `auth`/`storage`, and applies this deterministic order:

1. Public portion of tracked `harness-prod-baseline.sql`.
2. Test-only prerequisite normalization sourced from Phase 1/P0-A/P0-B table contracts.
3. Phase 1 security foundation.
4. Phase F CRM RLS cleanup.
5. P0-A transaction ownership.
6. P0-B employee assignment.
7. KPI-1 foundation.
8. KPI-2 final consolidated artifact.
9. KPI-2.1E cutover.
10. KPI-2.1E.2 draft delete.
11. KPI-2.1E.2R safe undo.
12. KPI-R3 active flexibility/legacy retirement.
13. KPI-R3.1 lifecycle.
14. Customer-linked Event migration.
15. Rollback-only Phase 2C A–O runtime harness.

This is a test bootstrap manifest, not rewritten production migration history.

## 7. Local runtime integration results

PASS: `PHASE2C_RUNTIME_A_TO_O_PASS` and `LOCAL_KPI2_BOOTSTRAP_PASS` from a fresh disposable stack. Runtime evidence covers assigned Customer success, cross-sale `42501`, REQUIRED/OPTIONAL/NONE, immutable snapshots, fresh revision snapshot, transfer race, atomic mixed-authority batch rollback, idempotency, Manager/Owner reads, search authorization, anonymous denial, and Customer FK behavior. Fixtures are enclosed by `BEGIN ... ROLLBACK`; post-run fixture counts are zero.

In particular, Sale A cannot submit an Event linked to Sale B's Customer: SQLSTATE `42501`, with no partial submission/event rows.

## 8. Authenticated browser E2E result

- DB runtime with authenticated role/JWT claims: **PASS**.
- Phase 3 Sale browser fixture contract A–L/mobile: **PASS**.
- Phase 4 Manager snapshot/navigation/review/mobile contract A–L: **PASS**.
- Full browser login through local Supabase Auth and the complete Customer Detail → KPI Mine → Manager path: **BLOCKED**, because the repository has no maintained local Auth-user bootstrap/browser-login fixture. This is not represented as a browser E2E pass.

## 9. kpi21e final disposition

The stale assertion required `crm-app.js` to import `./kpi-cutover.js`. The canonical R3 test simultaneously requires that the runtime contain no `kpi-cutover.js`, legacy proposal RPC, or legacy KPI DOM. Git history shows KPI-2.1E preceded R3 (`2edc8e4` before `90b84a2`).

The test was safely updated in separate commit `c6d4fcb` to retain historical cutover/server boundary checks while asserting the post-R3 legacy retirement. It does not restore a legacy runtime dependency. Results: KPI-2.1E 28 PASS; KPI-R3 53 PASS.

## 10. Production identity evidence

Authenticated `supabase projects list` confirms linked project `jjeeazwlqcwynzquimeo`, name `ERP kolorceramic`, organization `doburkcngqnrgloqrtzd`, region `ap-southeast-1`, status `ACTIVE_HEALTHY`. The historical staging project is `INACTIVE` and was not used.

Vercel CLI confirms account `hoathienbang87-2345` and project `thien-di-s-projects1/crm_kolor`, project ID `prj_BNeqeHfdUbfR1uaZFyzeuxhzcBRw`. Git is `main` with origin `hoathienbang87-beep/CRM-KOLORCERAMIC`.

## 11. Production access method

`supabase db query --linked` through the already authenticated CLI, inside `BEGIN READ ONLY` with `transaction_read_only=on` and a statement timeout. Only catalog/SELECT queries were issued. The redacted `.codex-prod-readonly.env` service key was not used, printed, repaired, or committed.

## 12. Production schema precondition

Status: **Phase 2 Customer-linked migration NOT APPLIED**.

- `kpi_definitions.customer_relation_mode`: absent.
- Event Customer snapshot columns: absent.
- `crm_kpi_search_accessible_customers(text, integer)`: absent.
- Submit/revision RPCs: old signatures are present.
- Existing `kpi_submission_events.customer_id`: present from older schema.
- Existing Customer FK: `ON DELETE SET NULL`; Phase 2 changes it to the reviewed restrictive behavior.
- Customer-linked definition/snapshot constraints and Customer/Event index: absent.

## 13. Current 9 KPI definitions

| Code | Name | Description | Active | Current mode |
| --- | --- | --- | --- | --- | --- |
| CUSTOMER_CARE | Chăm sóc khách hàng cũ | Số lần chăm sóc khách hàng cũ có nội dung/kết quả | YES | field absent |
| DISPLAY_RACK | Trưng bày kệ chip cho VP Thiết kế/KTS | Điểm trưng bày hoàn thành tại VP thiết kế/KTS | YES | field absent |
| DOANH_SO | DOANH SO | Tiền cọc hoặc tiền bán hàng thu từ khách hàng | YES | field absent |
| KTS_NEW | VP KTS mới | VP kiến trúc sư/thiết kế mới được tiếp cận | YES | field absent |
| NEW_CUSTOMER | Tìm công trình mới | Khách hàng mới được tìm kiếm/tiếp cận | NO | field absent |
| PARTNERSHIP_CONTRACT | Số hợp đồng ký kết hợp tác | Hợp đồng hợp tác được ký kết | YES | field absent |
| PROJECT_DEVELOPMENT | Khai thác công trình | Công trình mới được tiếp cận/khai thác | YES | field absent |
| SHOWROOM_INVITE | Mời khách hàng về showroom | Khách hàng được mời đến showroom | YES | field absent |
| SOCIAL_VIDEO | Đăng video kênh online/social | Video đăng trên kênh online/social | YES | field absent |

## 14. Current September period

Period `aeef3880-013e-43fc-83fc-eeea888fe2df`, name `KPI tháng 9/2026`, status `ACTIVE`, timezone boundary represented by `2026-08-31 17:00Z` through `2026-09-30 17:00Z` (Asia/Ho_Chi_Minh September). No Phase 6 cutover timestamp is selected here.

## 15. Current September assignment count

Exactly **21 ASSIGNED** rows. Breakdown: CUSTOMER_CARE 4, DISPLAY_RACK 2, DOANH_SO 3, KTS_NEW 3, PROJECT_DEVELOPMENT 3, SHOWROOM_INVITE 3, SOCIAL_VIDEO 3. NEW_CUSTOMER and PARTNERSHIP_CONTRACT have zero September assignments.

## 16. Current KPI-2 submission/event counts

`kpi_submissions = 0`; `kpi_submission_events = 0`. Consequently there is no production Event Customer shape or historical Event snapshot to rewrite. These are current read-backs, not reused prior assumptions.

## 17. 9 KPI mapping table

| KPI | Description | September assignments | Suggested mode | Reason | Owner-approved mode |
| --- | --- | ---: | --- | --- | --- |
| CUSTOMER_CARE | Chăm sóc khách hàng cũ | 4 | REQUIRED | Mỗi lần chăm sóc phải gắn đúng khách hàng | PENDING |
| DISPLAY_RACK | Kệ chip tại VP thiết kế/KTS | 2 | REQUIRED | Điểm trưng bày gắn với một VP/KTS cụ thể | PENDING |
| DOANH_SO | Tiền cọc/bán hàng thu về | 3 | REQUIRED | Khoản thu phải truy được về khách hàng | PENDING |
| KTS_NEW | VP KTS mới | 3 | REQUIRED | KPI xác lập một quan hệ KTS cụ thể | PENDING |
| NEW_CUSTOMER | Khách hàng/công trình mới | 0 | REQUIRED | Bản chất KPI là tạo khách hàng/công trình cụ thể | PENDING |
| PARTNERSHIP_CONTRACT | Hợp đồng hợp tác | 0 | REQUIRED | Hợp đồng phải có đối tác/khách hàng | PENDING |
| PROJECT_DEVELOPMENT | Khai thác công trình | 3 | REQUIRED | Hoạt động phải gắn công trình/khách hàng | PENDING |
| SHOWROOM_INVITE | Mời về showroom | 3 | REQUIRED | Lượt mời phải gắn khách hàng | PENDING |
| SOCIAL_VIDEO | Video online/social | 3 | NONE | Hoạt động nội dung không mặc nhiên thuộc một khách hàng | PENDING |

Suggestions are for Owner review only and are not authorization to write.

## 18. Owner Option B status

**OPTION B — APPROVED.** Customer-linked KPI starts for the ACTIVE September 2026 period. This approves **when**, not **how each KPI links**. Individual modes for all nine KPI definitions are not yet approved.

## 19. September assignment dry patch table

After the additive migration, missing snapshot modes backfill to `NONE`. The table below compares that expected old value with the suggested—not yet approved—mode.

| Assignment ID | Employee | KPI | Old after migration | Suggested mode | Would change |
| --- | --- | --- | --- | --- | --- |
| 1cd86b67-500c-47e0-93c1-39af2aae5e63 | Danh Băng Tâm | CUSTOMER_CARE | NONE | REQUIRED | YES |
| ba817b50-ad0b-4993-8a20-09c50130dd82 | Hoài Châu | CUSTOMER_CARE | NONE | REQUIRED | YES |
| 53d36e27-4a62-4289-8c27-5c66964b23a7 | Mỹ Trâm | CUSTOMER_CARE | NONE | REQUIRED | YES |
| a5d7250b-d32e-4e8f-a7c1-0202055200c3 | Thien Di Tran | CUSTOMER_CARE | NONE | REQUIRED | YES |
| bafcc44e-4033-47aa-ae1a-34d71db8dc2d | Hoài Châu | DISPLAY_RACK | NONE | REQUIRED | YES |
| 885997a9-d11b-40c9-aeca-e9b40048bf88 | Mỹ Trâm | DISPLAY_RACK | NONE | REQUIRED | YES |
| 592db763-fe2a-427d-9f9e-1c5ad4d2a605 | Danh Băng Tâm | DOANH_SO | NONE | REQUIRED | YES |
| fc4a98c5-8454-4ea5-8cda-f30626bd7798 | Hoài Châu | DOANH_SO | NONE | REQUIRED | YES |
| de892251-e8d1-4aa9-8601-f231bb546d62 | Mỹ Trâm | DOANH_SO | NONE | REQUIRED | YES |
| 82d61fa1-c1fc-4ebd-897e-068900f5e985 | Danh Băng Tâm | KTS_NEW | NONE | REQUIRED | YES |
| a21b0de3-7e5e-434c-b192-9df0fe8bf34a | Hoài Châu | KTS_NEW | NONE | REQUIRED | YES |
| aa70b64d-3c75-43d4-9e9d-5d466aafc970 | Mỹ Trâm | KTS_NEW | NONE | REQUIRED | YES |
| 86fdff53-2de8-4f35-8852-1ecc9aef45d6 | Danh Băng Tâm | PROJECT_DEVELOPMENT | NONE | REQUIRED | YES |
| 20434fba-5b91-4d1d-a3c4-3f361ad74117 | Hoài Châu | PROJECT_DEVELOPMENT | NONE | REQUIRED | YES |
| 5667dd03-0fe3-4ee2-8e30-6b75b6ee8f34 | Mỹ Trâm | PROJECT_DEVELOPMENT | NONE | REQUIRED | YES |
| 6b7d2bd6-01fa-43b4-8a49-f8d86c146dc2 | Danh Băng Tâm | SHOWROOM_INVITE | NONE | REQUIRED | YES |
| deb295bb-a362-4b65-9a90-6e38ce4b2a16 | Hoài Châu | SHOWROOM_INVITE | NONE | REQUIRED | YES |
| 3209cddb-eeb8-4f38-89b1-e7c12b90be1d | Mỹ Trâm | SHOWROOM_INVITE | NONE | REQUIRED | YES |
| 2ae952e9-042c-4147-9b61-efbb87cc2331 | Danh Băng Tâm | SOCIAL_VIDEO | NONE | NONE | NO |
| 2658eefb-fe86-4a5b-afb5-03e0eed46e13 | Hoài Châu | SOCIAL_VIDEO | NONE | NONE | NO |
| aaaf073f-a3f7-433c-9bf7-32f46c0c6710 | Mỹ Trâm | SOCIAL_VIDEO | NONE | NONE | NO |

No patch was executed. Phase 6 must regenerate this table after mode approval and immediately before the controlled transaction.

## 20. Production migration diff

Against current production, `supabase-phase-kpi2-customer-linked-event.sql` will:

- Add `kpi_definitions.customer_relation_mode` with default/backfill `NONE` and a three-mode check.
- Replace definition create/update and snapshot helpers so mode is canonical and frozen into assignments.
- Backfill the 21 existing September assignment snapshots to `NONE` when the key is missing, then add snapshot-shape validation.
- Add five Event snapshot columns: Customer name, company, phone, normalized phone, and address.
- Replace the current Customer FK (`SET NULL`) with the reviewed restrictive FK and add the Customer/event-time index.
- Add Customer snapshot sanitization and authorized search RPC.
- Replace submit/revision RPCs with Customer-mode, ownership-at-submit, immutable snapshot, atomicity, and revision rules.
- Apply intentional grants/revokes for the new/changed functions.

Expected existing data touched by migration semantics: 9 definition rows receive the column default; 21 assignment snapshots receive `NONE`; 0 existing Events require snapshot validation/backfill. No historical Customer is inferred.

## 21. Rollout order

1. Fresh production backup.
2. Verify backup.
3. Verify exact production identity.
4. Apply Customer-linked DB migration.
5. Schema/function read-back.
6. Apply Owner-approved modes to KPI definitions.
7. Patch September ACTIVE assignment snapshots.
8. Verify exact affected rows.
9. Deploy frontend.
10. Sale TEST smoke.
11. Manager TEST smoke.
12. Audit/read-back.
13. Forward-fix/rollback decision.

If the controlled snapshot update affects a row count different from the freshly computed expected count, roll back that config transaction and stop before frontend deploy.

## 22. Smoke plan

No production TEST account was found by a conservative name/email scan, so Phase 6 must designate an existing approved TEST identity and an assigned safe TEST Customer before rollout. Do not create a fake Customer/Event during Phase 5B. Smoke must verify Sale A own Customer success, Sale A → Sale B Customer `42501` with no partial rows, OPTIONAL/NONE semantics, Manager employee/global queue, evidence/review, snapshot vs live navigation, and audit/read-back.

## 23. Rollback/forward-fix

Frontend rollback is acceptable while the additive DB migration remains. Do not destructively roll back Customer/Event schema after Events use it; use a reviewed forward fix. Definition/snapshot configuration must be one controlled transaction with exact row-count guards. Historical Events are never rewritten by inference.

## 24. Production write/deploy status

**NONE.** No production DDL, DML, mutating RPC, role change, Customer/KPI/Event change, configuration update, migration apply, Vercel deploy, or Git push occurred.

## 25. Remaining risks

- KPI-by-KPI modes remain unapproved.
- No designated production TEST account/safe TEST Customer exists in current evidence.
- Full authenticated browser-login E2E lacks a maintained local Auth fixture.
- Phase 6 must refresh counts and schema immediately before rollout because production can change.
- Cutover timestamp must be chosen in Asia/Ho_Chi_Minh immediately before rollout, not now.

## 26. GO/BLOCKED for KPI mapping approval

**GO for Owner review.** The exact nine-definition mapping package and 21-row dry patch are ready. Approval itself remains pending.

## 27. GO/BLOCKED for Phase 6

**BLOCKED.** Option B is approved, local DB runtime and production read-only evidence pass, but Phase 6 cannot start until Owner approves each of the nine modes and a safe TEST account/Customer is designated.

### Mandatory answers

- Is Option B approved? **YES.**
- Have individual modes for all 9 KPI been approved? **NO — pending Owner review of the mapping.**
- Was any production write performed? **NO.**
- Is production rollout allowed before KPI-by-KPI mapping approval? **NO.**
