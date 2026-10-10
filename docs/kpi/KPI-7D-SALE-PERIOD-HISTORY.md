# KPI 7D — Sale period history selector

Frontend only. No SQL, RPC, RLS or migration change.

## Two period concepts

| | Source | Used for |
|---|---|---|
| **Current operational period** `currentSaleKpiPeriod` | 7T resolver: exactly one ACTIVE period with `starts_at <= now < ends_at` | every Sale write: KPI Mine proposal, Customer-origin proposal, evidence staging, revision, withdraw |
| **Selected view period** `selectedSaleKpiPeriodId` + `saleKpiHistoryView` | KPI Mine selector | KPI Mine cards, targets, actual, score, history, evidence viewer |

- The operational arrays (`kpi2Progress`, `kpi2Events`, `kpi2Evidence`, `kpi2Submissions`, `kpi2HistoryAssignments`) always hold the current period. History data lives only in `saleKpiHistoryView`. Write paths (`openKpi2EventForm`, `openKpi2ClaimFromCustomer`, submit, revision, withdraw) never read the view state.
- A view is writable only when it is exactly the current operational ACTIVE period (`saleKpiViewIsWritable`). Proposal, revision and withdraw controls are rendered only then.
- The selection lives in memory only. Logout, a fresh page load or a new session always starts from the current period. In-app reloads keep the in-session choice.

## Period options

- Query: `kpi_periods` `in status (ACTIVE, CLOSED)`, ordered by `period_month DESC`, limit 24.
- Production RLS (`kpi periods canonical read`) already restricts a Sale to ACTIVE/CLOSED periods where they have an own ASSIGNED assignment. As a result:
  - **DRAFT:** never visible.
  - **CANCELLED:** excluded in V1. RLS hides the period and the runtime-read helpers hide its events.
  - **Other Sales' periods:** never visible.
- Label: `MM/YYYY · Đang hoạt động` or `MM/YYYY · Đã đóng`. A custom period name is shown, truncated to 28 characters, but only when it is not just the month.

## Defaults and fail-safe behaviour

- **Exactly one current ACTIVE period:** the view shows it.
- **No current ACTIVE period:** the view shows the newest CLOSED period, read-only, with a banner that says no new proposal is possible. Customer-origin proposal fails closed with "Chưa có kỳ KPI đang hoạt động…".
- **Overlapping ACTIVE periods:** the 7T ambiguity rule is unchanged. The view shows the newest CLOSED period and never picks the first ACTIVE row. Every period is read-only. Customer-origin fails closed.
- **Sale without any period:** shows "Bạn chưa có kỳ KPI nào.", with no selector and no progress RPC.

## History loading (lazy)

On first load only the option list (1 light query) and the current period are fetched. Choosing another period triggers:
- `crm_kpi_get_assignment_progress({p_period_id})`, with an explicit id and a defensive filter on the period;
- events, ATTACHED evidence and submissions, scoped by that period's assignment ids;
- the assignments themselves.

Actual and score always come from the backend.

## Tests

- `scripts/test-kpi-sale-period-history.mjs`: static and unit checks.
- `scripts/test-kpi-sale-period-history-browser.mjs`: real frontend, plus the Production-shaped backend with Production read RLS (`scripts/fixtures/kpi-sale-read-rls.sql`), on a disposable Postgres. The gateway runs with `rlsReads: true`. Fixture: `scripts/fixtures/kpi-sale-history-fixture.sql`.
