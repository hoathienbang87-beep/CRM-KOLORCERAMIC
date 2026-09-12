# CRM-KOLORCERAMIC — KPI-2 Phase 5 readiness package

Date: 2026-09-12  |  Scope: integration/readiness only  |  Production writes: none

## 1. Conclusion

Phase 2–4 code contracts remain green. Phase 5 is technically **BLOCKED for full E2E and Phase 6** because the repository has no `supabase/migrations/` directory and the provided production read-only service key is redacted/invalid for REST introspection. No rollout decision is made.

## 2. Starting HEAD

`0cc7467e427602c1dd0318547f659aa7c9ebe97c` (Phase 4).

## 3. Ending HEAD

Same HEAD; this package is documentation-only.

## 4. Files changed

`KPI-2-PHASE-5-READINESS-PACKAGE.md` only. Existing user changes (including `vercel.json`) were preserved and not staged.

## 5. Local environment

Docker 29.7.2 and Supabase CLI 2.116.0 are present. Disposable Supabase DB/API started on `127.0.0.1`; `supabase db reset --local --no-seed` succeeds, but creates an empty schema because no migration directory exists.

## 6. Full Sale E2E

BLOCKED: authenticated fixtures cannot run against an empty local schema. The rollback-only harness is present and statically validated.

## 7. Full Manager E2E

BLOCKED for the same schema prerequisite. Phase 4 browser/static Manager contracts pass.

## 8. REQUIRED/OPTIONAL/NONE E2E

BLOCKED at runtime; static coverage confirms all three modes, including OPTIONAL empty/linked and NONE unlinked behavior.

## 9. Cross-sale authorization

Runtime execution not available in this reset. The integration harness explicitly asserts SQLSTATE `42501` and atomic no-partial-write behavior. Prior Phase 2C local runtime baseline recorded this guard as PASS.

## 10. Transfer race

Runtime execution BLOCKED; the rollback-only integration harness contains transfer-before-submit coverage.

## 11. Snapshot vs live

Static/Phase 4 contracts PASS: Event cards use dedicated immutable Customer snapshot fields; navigation opens the live Customer drawer separately.

## 12. Revision

Static integration contract PASS: revision receives a fresh Customer snapshot while the historical Event snapshot remains immutable.

## 13. Evidence/review regression

Phase 4 Manager evidence/review static and browser contracts PASS.

## 14. Mobile

Phase 4 browser contract PASS for responsive Manager Event/customer review surfaces.

## 15. Full regression

PASS: KPI-2 Customer-linked 77, KPI-2 172, KPI-2R.2 57, KPI-2.1B 25, CRM UI R1 Step 5, CRM KPI-R3 53, Phase 3 UI 43, Phase 4 Manager UI 34 checks.

## 16. kpi21e root cause/resolution

Known baseline failure remains: `test-phase-kpi21e.mjs` requires `crm-app.js` to import `./kpi-cutover.js`, while current post-R3 runtime intentionally contains no legacy KPI cutover UI/imports (and CRM KPI-R3 forbids that legacy dependency). This is a stale cross-phase test contract, not a KPI-2 Customer-linked bypass; no safe Phase 5 code change was made. Resolution required: owner decision to retire/update the obsolete contract or restore the legacy surface (not recommended without scope approval).

## 17. Production identity read-back

Read-only URL resolves to Supabase project `jjeeazwlqcwynzquimeo` (`ERP kolorceramic`). No Vercel project identity or deploy authorization was changed. REST calls returned 401 because the supplied service-role value is a redacted placeholder; identity is therefore not fully verified.

## 18. Production schema precondition read-back

BLOCKED by 401. No DDL, migration, or production read was performed.

## 19. 9 KPI mapping table

BLOCKED pending Owner-approved read-only export of the nine definitions. Required columns: code, name, current `customer_relation_mode`, active flag, and intended mode.

## 20. September active assignment analysis

Prior repo baseline states 21 active September assignments with frozen `NONE` snapshots. This Phase 5 run did not mutate or re-assume those rows; production read-back remains pending.

## 21. Option A/B

**PENDING OWNER DECISION.** A = future periods only; B = explicitly update all 21 active September assignments. Codex selects neither.

## 22. Current production KPI-2 counts

BLOCKED: submissions/events endpoints returned 401; prior zero counts are not re-used as current evidence.

## 23. Migration dry review

Expected order is backup → verify backup → additive DB migration/functions/RLS/indexes/backfills → read-back. Review only; no SQL was applied to production.

## 24. Rollout order

New frontend before DB is forbidden. Controlled order: verified backup, DB migration, read-back, approved modes, optional assignment snapshot update, frontend deploy, Sale smoke, Manager smoke, audit/read-back.

## 25. Rollback/forward-fix

Frontend rollback may leave the additive DB migration in place. DB rollback is not destructive after Events exist; use a forward fix. App and DB rollback plans must remain separate.

## 26. Production smoke plan

Use only a designated TEST account and existing assigned TEST Customer. Verify Sale A cannot submit B (42501/no partial), then Manager employee/global queue, review, audit, and read-back. No fake production Customer/Event.

## 27. Excel future compatibility

No Excel implementation in Phase 5. Future export must consume canonical assignment/event/snapshot fields and preserve legacy compatibility without changing historical snapshots.

## 28. Production write/deploy status

**NONE.** No production DDL, DML, mapping, deploy, or Vercel mutation occurred.

## 29. Remaining risks

Missing migration topology blocks repeatable local authenticated E2E; invalid/redacted production key blocks read-only evidence; Owner has not chosen A/B; `kpi21e` stale test contract remains unexplained by the existing suite.

## 30. GO/BLOCKED for Phase 6

**BLOCKED.** Unblock only after restoring a disposable full migration order, rerunning authenticated Sale/Manager E2E, obtaining valid read-only production credentials and identity/schema/count evidence, and recording Owner A/B approval.

### Mandatory answers

1. Sale A submitting a Customer assigned to B: **NO** (42501 expected; prior Phase 2C runtime baseline PASS, current rerun blocked).
2. Historical Event snapshot retained: **YES**.
3. Changing a KPI definition auto-changes 21 frozen assignments: **NO**.
4. Owner approved A/B: **NO — PENDING OWNER DECISION**.
5. Production rollout allowed now: **NO**.
