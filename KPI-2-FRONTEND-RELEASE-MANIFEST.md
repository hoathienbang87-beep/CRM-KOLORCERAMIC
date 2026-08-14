# KPI-2 Frontend Release Manifest

Ngay lap: 2026-08-14

## Dich release

- Repository: `hoathienbang87-beep/CRM-KOLORCERAMIC`
- Branch: `main`
- Production Supabase ref: `jjeeazwlqcwynzquimeo`
- Production domain: `https://crmkolor.vercel.app/`
- Baseline commit: `37a802af3c403a01dc3248a9cd0311e7f4bbf878`

## Backend da live ma frontend phu thuoc

- KPI-2 core RPC/schema: da live production.
- KPI-2R.2 evidence STAGED lifecycle: da live production.
- Auth Identity Linking/Repair va UUID bridge: da live production.
- Bucket `kpi2-evidence`: private; JPEG/WebP; gioi han 1.5 MB.
- Khong co migration moi duoc chay trong frontend release nay.

## File dua vao release commit

### Runtime

- `css/styles.css`
- `index.html`
- `js/features/crm-app.js`
- `js/firebase.js`

### Regression va staging harness

- `scripts/build-phase-kpi2-consolidated.mjs`
- `scripts/check-phase-kpi2-staging-clean.mjs`
- `scripts/cleanup-phase-kpi2-staging-fixtures.mjs`
- `scripts/run-phase-auth-identity-staging.ps1`
- `scripts/run-phase-kpi2-staging-api.ps1`
- `scripts/run-phase-kpi2-staging-clean-check.ps1`
- `scripts/run-phase-kpi2-staging-fixture-cleanup.ps1`
- `scripts/run-phase-kpi2-staging-ui.ps1`
- `scripts/run-phase-kpi2r2-attached-serialization.ps1`
- `scripts/run-phase-kpi2r2-staging-api.ps1`
- `scripts/run-phase-kpi2r2-staging-ui.ps1`
- `scripts/test-phase-auth-identity-staging-api.mjs`
- `scripts/test-phase-auth-identity.mjs`
- `scripts/test-phase-kpi1-integration.sql`
- `scripts/test-phase-kpi2-staging-api.mjs`
- `scripts/test-phase-kpi2-staging-ui.mjs`
- `scripts/test-phase-kpi2.mjs`
- `scripts/test-phase-kpi2r2-attached-serialization.sql`
- `scripts/test-phase-kpi2r2-staging-api.mjs`
- `scripts/test-phase-kpi2r2-staging-ui.mjs`
- `scripts/test-phase-kpi2r2.mjs`
- `scripts/test-phase-p0a-integration.sql`
- `scripts/test-phase-p0b-integration.sql`

### SQL history da live va tai lieu contract

- `supabase-phase-auth-identity-linking-repair.sql`
- `supabase-phase-kpi2-final-consolidated.sql`
- `supabase-phase-kpi2-reconcile-1.sql`
- `supabase-phase-kpi2-reconcile-2.sql`
- `supabase-phase-kpi2-reconcile-3.sql`
- `supabase-phase-kpi2-reconcile-4.sql`
- `supabase-phase-kpi2-remediation-finalize.sql`
- `supabase-phase-kpi2-remediation.sql`
- `supabase-phase-kpi2-submission-review-evidence.sql`
- `supabase-phase-kpi2r2-evidence-staged-lifecycle.sql`
- `KPI-2-PRODUCTION-RUNBOOK.md`
- `KPI-2-SUBMISSION-REVIEW-EVIDENCE.md`
- `KPI-2-FRONTEND-RELEASE-MANIFEST.md`

## File co y khong dua vao release commit

### Bao cao lich su/local evidence

- `AUTH-IDENTITY-LINKING-REPAIR-KPI2-RELEASE-UNBLOCK.md`
- `AUTH-IDENTITY-PRODUCTION-CONTROLLED-REPAIR-KPI2-UNBLOCK.md`
- `KPI-2-PRODUCTION-READINESS-AUDIT.md`
- `KPI-2-PRODUCTION-ROLLOUT-PREPARATION.md`
- `KPI-2-PRODUCTION-ROLLOUT.md`
- `KPI-2R-PRODUCTION-READINESS-REAUDIT.md`
- `KPI-2R-REMEDIATION-REPORT.md`
- `KPI-2R1-FINAL-MICRO-REMEDIATION-REPORT.md`
- `KPI-2R1-FINAL-PRODUCTION-READINESS-REAUDIT.md`
- `KPI-2R2-EVIDENCE-LIFECYCLE-PRODUCTION-RELEASE-UNBLOCK.md`
- `KPI-2R2-PRODUCTION-FORWARD-FIX-EXECUTION.md`
- `KPI-2R2-PRODUCTION-FORWARD-FIX-PREPARATION.md`
- `PRODUCTION-REAL-USER-IDENTITY-KPI-SMOKE-FINAL-RELEASE-GATE.md`

### Production inventory helpers

- `scripts/inventory-kpi2r2-production-auth.mjs`
- `scripts/run-kpi2r2-production-auth-inventory.ps1`

Khong dua backup, dump, `.env`, access token, refresh token, database password, service-role key hoac raw production identity evidence vao commit.

## Rollback frontend

Neu production smoke bat buoc that bai, rollback/redeploy frontend Vercel ve deployment cua baseline commit o tren. Khong rollback KPI-2 database, Auth mapping hay xoa evidence bang service role.
