# Catalog production release plan — Prompt 12A

Status: prepared only. This document does not authorize production access, migration, data write or deployment.

## 1. Immutable release identity

| Item | Pinned value |
|---|---|
| Repository | `hoathienbang87-beep/CRM-KOLORCERAMIC` |
| Branch | `feat/catalog-supabase-integration` |
| Merge base with `origin/main` | `7e9db5182844e2a14855fa7aba148a5fb990384c` |
| Application tree boundary | `a7f00692d7c66def1e7eff94b5ed6536872d0272` |
| Approved 11B gate baseline | `1033a82` |
| Supabase production | `jjeeazwlqcwynzquimeo` — `ERP kolorceramic` |
| Supabase staging | `nalkeptqohjbjnqwpzzv` — must remain different from production |
| Vercel project | `crm_kolor` / `prj_BNeqeHfdUbfR1uaZFyzeuxhzcBRw` |
| Vercel canonical URL | `https://crmkolor.vercel.app/` |
| Firebase project/site | `kolor-ceramics` / `kolor-ceramics` |
| Legacy Firebase URL | `https://kolor-ceramics.web.app/` |

The machine-readable source of truth is `catalog-production-release-12a.json`. Prompt 12B must stop if a checksum, project ID, site, URL or application tree differs. Documentation-only commits after the application boundary are allowed only when `git diff a7f0069 --` proves there is no unreviewed runtime or migration change.

### Authorized Prompt 12B routing amendment

After deployment-URL smoke showed that Vercel served the root `index.html` before the high-level `/` rewrite, the user explicitly authorized `TÔI CHO PHÉP TẠO ROUTING HOTFIX VÀ RELEASE AMENDMENT CHO PROMPT 12B`.

- Original application boundary remains `a7f00692d7c66def1e7eff94b5ed6536872d0272`.
- The only authorized runtime delta is routing hotfix commit `477f1265eac7b91af2bb8b6ed5e81ad7270ee32f` plus its two routing regression files.
- `vercel.json` moves only `/` from a post-filesystem rewrite to the exact pre-filesystem route `^/$` → `/website/index`; `/admin`, `/crm`, `/CRM`, Supabase configuration and Firebase configuration remain unchanged.
- Amended `vercel.json` SHA-256 is `17c25627af4eab377c125ea44aff4749fcd8a47f348a27cc409b8c9fc3038ea1`; the previous hash is retained in the manifest audit trail.
- The amended package must pass the release validator and actual protected deployment-URL smoke before alias promotion. This amendment does not authorize any new database mutation or a second catalog batch apply.

### Approved functional commits

The release history contains 49 commits after the merge base. The functional checkpoints are:

| Prompt | Commit | Scope |
|---|---|---|
| 01A | `8285746` | Product data contract |
| 01B | `66e0b43` | Additive catalog schema |
| 02A | `88c478e` | Local migration validation |
| 02B | `2e4382c` | RLS and RPC integration |
| 03A | `230c5d8` | Parser and matching |
| 03B | `d27772f` | Approval/apply/rollback integration |
| 04 | `77e1a89`, `02d66ad` | Cloud-staging rehearsal |
| 05A | `04f0f76` | Public API v1 |
| 05B | `a16b970` | Website lead workflow |
| 06A | `31da671` | Standalone catalog admin |
| 06B | `319c044` | Admin import/review/rollback |
| 07A | `585da0f` | Public catalog website |
| 07B | `8b7a3d1` | Detail, QR and lead UI |
| 08A | `dde1733` | CRM product selector/snapshot |
| 08B | `25ed03c` | Retire CRM catalog mutation UI |
| 09 | `307f407` | Split routing and entry points |
| 10 | `1206569` | Legacy Firebase redirect package |
| 11A | `5daa00c` | Automated cloud-staging E2E |
| 11B | `a7f0069` | Live cloud-staging UI rehearsal |

Gate/report commits are preserved in Git history but do not change the application boundary.

## 2. Production database bundle

Apply only the nine canonical SQL files listed under `database.apply` in the JSON manifest, in that exact order. Each file is independently transactional and fail-closed. Verify SHA-256 before execution.

1. `01B` additive schema.
2. `02B` RLS/RPC.
3. `03B` approval gate and before/after audit.
4. `05A` public API v1.
5. `05B` website lead workflow.
6. `06A` admin catalog APIs.
7. `06B` admin import APIs.
8. `06B-COMPAT` classification compatibility.
9. `06B-ALIAS` review alias fix.

Do not use `supabase db push` from this checkout for production: `supabase/migrations` intentionally contains cloud-staging baseline, fixture, test and rehearsal migrations. Do not relink this checkout to production. Prompt 12B must use an explicit, separately supplied production database URL and execute only the checksum-pinned canonical files.

### Explicit exclusions

- `04-staging-bootstrap-acl` is staging-only.
- `05b-postgrest-cache` and `05b-postgrest-cache-recovery` were staging recovery artifacts and are not part of the production bundle.
- All `supabase/migrations/*baseline*`, `*staging_test*`, `*rollback_test*`, dry-run/apply/rollback rehearsal and `11A` E2E files are excluded.
- No baseline Product load is part of schema migration. Production already owns its 75 Product UUIDs.
- No workbook/batch apply is part of schema migration.

## 3. Fresh backup checklist

Create a new timestamped directory outside Git, for example:

`D:\SUPABASE\BACKUPS\CRM-KOLORCERAMIC\PRODUCTION-CUTOVER-<YYYYMMDD-HHMM>`

Before any production migration, all items below must be complete:

- [ ] Record operator, start time, production ref, database host and Git application commit.
- [ ] Confirm Supabase project `jjeeazwlqcwynzquimeo` is `ACTIVE_HEALTHY` and staging remains a different ref.
- [ ] Record Supabase managed-backup/PITR status and latest recoverable point from the dashboard.
- [ ] Dump roles, schema and data separately with `supabase db dump --db-url ... --role-only`, default schema dump, and `--data-only --use-copy`.
- [ ] Capture row counts for critical CRM/catalog tables using the read-only preflight script.
- [ ] Compute SHA-256 and byte size for every dump; write a backup manifest outside Git.
- [ ] Verify each dump is non-empty and parseable; do not accept a few-KB placeholder as a data backup.
- [ ] Export the in-app operational snapshot.
- [ ] Inventory Storage buckets and separately copy objects from `kpi-evidence`; a database dump contains metadata, not object bytes.
- [ ] Confirm a restore target and operator. A full production restore is never attempted first; restore must be rehearsed on an isolated database when needed.
- [ ] Record current Vercel production deployment ID and URL.
- [ ] Record current Firebase live version ID and status immediately before cutover.

No dump, spreadsheet, customer export, database URL or password may be stored in this repository.

## 4. Read-only preflight and migration read-back

Before connecting, parse the supplied database URL locally and prove its hostname contains `jjeeazwlqcwynzquimeo`, does not contain the staging ref, and uses TLS. Do not print the URL.

Run `scripts/catalog-production-preflight-12a.sql` under a read-only transaction. The GO result requires:

- all required legacy tables and CRM helper functions present;
- no partial catalog integration state;
- invalid width/height conversion counts equal zero;
- baseline Product and related-table counts recorded;
- production identity evidence matches the pinned manifest.

After each migration, perform read-back before continuing. At minimum verify table/column/index/constraint/function existence, RLS enabled, direct table writes denied to browser roles, and intended RPC grants present. Stop on the first error; do not skip or mark migration history manually.

The migration files contain their own transaction and verification blocks. A failed file rolls itself back. If an earlier file committed and a later file fails, prefer a reviewed forward fix. Do not automatically run the full rollback chain.

## 5. Production import dry-run and approval stop

After schema/RPC read-back, use the approved finalized workbook only:

`D:\SUPABASE\BACKUPS\CRM-KOLORCERAMIC\2026-09-22_13-13-13\reconciliation\product-review-finalized.xlsx`

Required SHA-256: `bdbe0ac5c1832391db83a9a55a6b90eb4359efd8644df4b45336c465ae7e1dd8`.

Expected preview invariants:

- 102 retained rows: 95 complete and 7 `UPDATING`.
- 2 explicitly excluded rows remain `SKIP`.
- 54 existing unchanged rows.
- 48 new candidates: 41 ready and 7 draft/updating.
- 6 retained rows have blank price and keep `NULL`.
- 3 retained rows have missing size.
- 0 update, duplicate, unresolved conflict or ambiguous exact match under the approved rehearsal baseline.
- 12 fuzzy suggestions remain suggestions only.
- 359 unapproved reconciliation candidates are absent from the batch.
- Catalog Product rows, prices and publish states are unchanged after preview.

Record the production batch ID, parser/source checksum, summary, unresolved rows, Product before-count/checksum and audit entry. Then stop completely. Data apply is forbidden until the user sends exactly:

`TÔI DUYỆT GHI DỮ LIỆU PRODUCTION BATCH <BATCH_ID>`

The `<BATCH_ID>` must exactly match the preview batch. If the approval is not received in the active window, do not reuse a stale preview after catalog changes; rerun preview in a new window.

## 6. Deployment order after batch approval

1. Apply only the approved batch with a new idempotency key.
2. Read back Product counts/status, price history, audit before/after and batch status; replay the same key once to prove idempotency.
3. Deploy the Vercel application tree pinned above.
4. Verify Vercel deployment is `READY`, then move the canonical alias only after smoke tests on the deployment URL pass.
5. Smoke-test `/`, product detail, `/admin`, import history, `/crm`, Auth/RBAC, lead submission and quote snapshot.
6. Re-read Firebase live version, clone it to `pre-catalog-cutover-<YYYYMMDD>`, and verify the clone.
7. Deploy the Firebase redirect package only after Vercel canonical health is confirmed.
8. Verify legacy `?id=`, `?code=` and UTM query preservation. Never use `hosting:disable`.

Firebase is last because a cached 301 can send every legacy QR to the new destination.

## 7. Rollback matrix

| Failure point | Default response | Data action |
|---|---|---|
| Backup/preflight fails | NO-GO; end window | None |
| A migration file fails before commit | Stop; capture error; file transaction rolls back | None |
| Later migration fails after earlier files committed | Keep additive schema; assess forward fix | Rollback only after guard/read-back and explicit authorization |
| Preview differs from expected | Stop before approval | Cancel/retain preview for audit; no Product mutation |
| Batch apply fails | Retry only with same idempotency key after diagnosis | Use batch rollback RPC only if apply committed and rollback guards pass |
| Product read-back wrong after apply | Do not deploy frontend | Run audited batch rollback; verify restored/archive counts |
| Vercel deployment/smoke fails | Promote baseline deployment `dpl_FMLr7dPEzQd3uo8zY1QSBjsRFBLL` | Leave compatible additive DB schema; rollback batch only if data itself is wrong |
| Firebase redirect fails | Restore recorded live version/safety clone | No database change |
| Severe cross-system corruption | Keep maintenance/freeze, escalate | Restore fresh backup only with separate explicit approval |

Schema rollback companions are ordered `06B → 06A → 05B → 05A → 03B → 02B → 01B` and checksum-pinned in the manifest. They are not an automatic undo button: 06B, 05B and 03B contain data-state guards, and 01B removes additive structures. Once real lead/import/approval data exists, prefer application rollback plus forward fix or isolated backup restore analysis.

## 8. Maintenance window

Use two controlled phases with named operator and user available for both confirmation messages.

### Window A — schema and preview, target 45 minutes

- T-15: notify users; freeze catalog edits/imports and Product price changes. Other CRM work may continue only if backup consistency policy allows it.
- T0–T+15: identity checks, fresh backup, checksums and preflight.
- T+15–T+30: nine migrations with per-file read-back.
- T+30–T+45: production dry-run preview, catalog unchanged proof and batch report.
- Stop for batch-specific approval. If approval is not received within 30 minutes, end the window; do not apply or deploy.

### Window B — apply and deploy, target 60 minutes

- T0–T+15: recheck freeze, batch ID, Product versions and approval phrase; apply/read-back/idempotency.
- T+15–T+35: Vercel deploy, deployment-URL smoke, alias promotion and canonical smoke.
- T+35–T+50: Firebase safety clone, redirect deploy and QR/query smoke.
- T+50–T+60: final audit, unfreeze catalog writes and announce completion.

Keep a 30-minute observation period after Window B. Prompt 13 owns ongoing monitoring; it must not silently mutate production.

## 9. GO / NO-GO checklist

GO requires every item:

- [ ] Prompt 12A is `APPROVED` and user sent `TÔI XÁC NHẬN CUTOVER PRODUCTION`.
- [ ] Working tree is clean; application tree and manifest checksums pass.
- [ ] Exact Supabase/Vercel/Firebase identities match the manifest.
- [ ] Named operator, maintenance time and communication channel are recorded.
- [ ] Fresh backup, Storage copy, checksums and restore target are confirmed.
- [ ] Production preflight is clean and no partial catalog integration exists.
- [ ] Staging gates 11A/11B remain PASS with no newer runtime change.
- [ ] Previous Vercel deployment and Firebase live version are still available for rollback.
- [ ] User is available to review the production dry-run and send the batch-specific approval.

Any unchecked item is NO-GO. Do not substitute production for a missing test, do not relink this checkout, do not run all files in `supabase/migrations`, and do not infer either required confirmation.

## 10. Prompt 12B stop points

Prompt 12B may begin only after both 12A approval and the exact cutover confirmation. It must stop again after the production preview and report the concrete batch ID. Applying data, deploying Vercel and deploying Firebase remain forbidden until the batch-specific approval is received.
