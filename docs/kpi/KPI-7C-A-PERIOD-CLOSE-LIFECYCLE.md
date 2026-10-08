# KPI 7C-A — Period Close lifecycle (backend foundation)

Status: backend only. Nothing in the runtime UI calls Close yet (7C-B).
Migration: `supabase-phase-kpi-7c-period-close-lifecycle.sql` (forward-only, no data rewrite).
Tests: `scripts/test-kpi-period-lifecycle-close.mjs` (disposable local PostgreSQL).

## Contract

| Action | Roles | From → To | Version | Reason | Open items |
|---|---|---|---|---|---|
| Close `crm_kpi_close_period_foundation(p_period_id, p_expected_version)` | Manager, Admin, Owner | ACTIVE → CLOSED | required | not required | auto-rejected (`REJECTED` / `PERIOD_CLOSED`) in the same transaction |
| Cancel `crm_kpi_cancel_active_period(p_period_id, p_expected_version, p_reason)` | Admin, Owner | ACTIVE → CANCELLED | required | required | **fails** with `KPI_PERIOD_OPEN_ITEMS` |
| Reopen `crm_kpi_reopen_period(p_period_id, p_expected_version, p_reason)` (unchanged) | Admin, Owner | CLOSED → ACTIVE | required | required | none revived |

### Open item (single definition)

`crm_kpi_period_open_event_ids(period)` — an event of any assignment in the period with
`status = 'PENDING'`, or `status = 'NEEDS_REVISION'` with no event superseding it.
NEEDS_REVISION lives on the **Event**; a Sale revision creates a new PENDING event
(`supersedes_event_id`) and the old row stays `NEEDS_REVISION` as history.
Managers can read counts via `crm_kpi_period_open_items(period)`.

Terminal states: `APPROVED`, `REJECTED`, `WITHDRAWN`, and a superseded `NEEDS_REVISION`.
Submissions: `OPEN_REVIEW` / `PARTIALLY_REVIEWED` / `COMPLETED` via the existing
`crm_kpi_refresh_submission_status`.

### PERIOD_CLOSED

Stored in `kpi_submission_events.review_reason_code` (check constraint widened).
Only Close writes it; `crm_kpi_review_events` keeps its Manager allow-list.
UI label (7C-B): **"Từ chối tự động do kỳ KPI đã được đóng."**

### Close transaction order

1. actor + role (Manager/Admin/Owner, active)
2. `SELECT … FOR UPDATE` on the period; must be ACTIVE (`KPI_PERIOD_NOT_ACTIVE`) and at the expected version (`KPI_VERSION_CONFLICT`) — nothing has been written yet
3. open set from the canonical function, rows locked `FOR UPDATE` in id order
4. each open event → `REJECTED`, `PERIOD_CLOSED`, `reviewed_by = closer`, `lock_version + 1`; one `event_auto_reject` audit per event (previous status/reviewer kept)
5. affected submissions refreshed (Manager-review semantics → `COMPLETED`)
6. invariants: zero open items, zero `OPEN_REVIEW` submissions in the period
7. period → CLOSED, `closed_at`, `closed_by_user_id`, `updated_at`, `version + 1`
8. one `period_close` audit (actor, versions, states, counts, event ids)

Evidence rows and Storage objects are never touched. Actual still counts only APPROVED.

### Concurrency

Every runtime write path takes `FOR SHARE` on the period row (submit, revision, withdraw
and the `*_r31_period_guard` triggers on submissions/events/evidence). Close holds
`FOR UPDATE` before scanning, so an in-flight writer finishes first and is included,
and a later writer waits and then fails because the period is no longer ACTIVE.
Covered by the concurrency tests A–D (submit after Close, submit before Close,
withdraw in flight, review in flight).

## Running the tests

```bash
# disposable cluster, e.g. PostgreSQL 16 on a unix socket
initdb -D /tmp/pg7c -U postgres -A trust
pg_ctl -D /tmp/pg7c -o "-p 5433 -k /tmp -c listen_addresses=''" start
PGHOST=/tmp PGPORT=5433 node scripts/test-kpi-period-lifecycle-close.mjs
```

Exit 0 = PASS, 1 = FAIL, 3 = SKIP (no local Postgres). The runner refuses non-local hosts.
The baseline (`scripts/fixtures/kpi-lifecycle-prod-baseline.sql`) is pinned to Production:
the suite checks that all 28 function bodies match Production `md5(pg_get_functiondef)`.

## Rollout notes (for 7C-B and later)

- Applying the migration does not expose Close in the UI: no runtime JS calls
  `crm_kpi_close_period_foundation`.
- The Cancel guard is effective immediately: the existing "Hủy kỳ" drawer will show the
  `KPI_PERIOD_OPEN_ITEMS` error while a period has open items. That is intended.
- The current UI renders reason codes raw; add the PERIOD_CLOSED label before the first
  real Close.
- Staged (not attached) evidence of a closed period stays `STAGED`, the same as for
  Cancel today.
- An auto-rejected event still occupies its root-dedupe slot (same as a Manager
  rejection), so the same CARE_LOG/CUSTOMER source cannot be claimed again after Reopen.

## Rollback

Before any Close has run (no `PERIOD_CLOSED` rows): re-run the previous definitions of
`crm_kpi_close_period_foundation` (`supabase-phase-kpi1-foundation.sql`) and
`crm_kpi_cancel_active_period` (`supabase-phase-kpi-r31-period-lifecycle.sql`), drop
`crm_kpi_period_open_items` / `crm_kpi_period_open_event_ids`, and restore the
8-value reason check.

After a Close: keep the reason check (existing `PERIOD_CLOSED` rows need it). Roll back
only the functions (Close then returns to the no-op foundation), or reopen the period.
Never rewrite auto-rejected events.
