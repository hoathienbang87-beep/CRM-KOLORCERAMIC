-- =====================================================================
-- KPI 7D — Sale period history fixture (disposable DB only, no PII).
-- Requires kpi-lifecycle-prod-baseline.sql + 7C-A migration +
-- kpi-lifecycle-test-helpers.sql + kpi-sale-read-rls.sql.
-- Runtime rows go through the real RPCs; September is closed by the real
-- crm_kpi_close_period_foundation.
--
--   09/2026 CLOSED  sale1 (visit + customer KPI) and sale2 history
--   10/2026 ACTIVE  current period (contains now) — sale1, sale2
--   11/2026 DRAFT   sale1 assignment — must never be visible to Sale
--   08/2026 CANCELLED sale1 assignment — excluded in V1
--   07/2026 CLOSED  sale2 only — must never be visible to sale1
-- =====================================================================

insert into public.kpi_definitions(id, code, name, kpi_type, unit, created_by_user_id, updated_by_user_id,
  evidence_required, aggregation_mode, customer_relation_mode) values
  ('7d000000-0000-4000-8000-00000000d003', 'HISTORY_CUSTOMER_VISIT', 'Customer visit', 'MANUAL', 'lần', 'u_owner', 'u_owner', false, 'COUNT', 'OPTIONAL');

-- 09/2026 (will be CLOSED)
select lifecycle_test.mk_period('7d000000-0000-4000-8000-000000000009', '2026-09-01', 'ACTIVE');
select lifecycle_test.mk_assignment('7d100000-0000-4000-8000-000000000901', '7d000000-0000-4000-8000-000000000009', 'u_sale1');
select lifecycle_test.mk_assignment('7d100000-0000-4000-8000-000000000902', '7d000000-0000-4000-8000-000000000009', 'u_sale1', '7d000000-0000-4000-8000-00000000d003');
select lifecycle_test.mk_assignment('7d100000-0000-4000-8000-000000000903', '7d000000-0000-4000-8000-000000000009', 'u_sale2');
do $$
declare a1 uuid := '7d100000-0000-4000-8000-000000000901'; a3 uuid := '7d100000-0000-4000-8000-000000000903'; e uuid;
begin
  for i in 1..2 loop e := lifecycle_test.submit('u_sale1', a1); perform lifecycle_test.review(e, 'APPROVED'); end loop;
  e := lifecycle_test.submit('u_sale1', a1); perform lifecycle_test.review(e, 'REJECTED', 'DUPLICATE');
  e := lifecycle_test.submit('u_sale1', a1); perform lifecycle_test.withdraw('u_sale1', e);
  for i in 1..3 loop perform lifecycle_test.submit('u_sale1', a1); end loop;
  e := lifecycle_test.submit('u_sale2', a3); perform lifecycle_test.review(e, 'APPROVED');
  for i in 1..2 loop perform lifecycle_test.submit('u_sale2', a3); end loop;
end $$;
-- real Close as Manager: sale1 3 + sale2 2 PENDING -> REJECTED/PERIOD_CLOSED
do $$ declare v integer; begin
  select version into v from public.kpi_periods where id = '7d000000-0000-4000-8000-000000000009';
  perform lifecycle_test.actor('u_manager');
  perform public.crm_kpi_close_period_foundation('7d000000-0000-4000-8000-000000000009', v);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('crm.kpi_write', '', true);
end $$;

-- 10/2026 (current ACTIVE)
select lifecycle_test.mk_period('7d000000-0000-4000-8000-000000000010', '2026-10-01', 'ACTIVE');
select lifecycle_test.mk_assignment('7d100000-0000-4000-8000-000000001001', '7d000000-0000-4000-8000-000000000010', 'u_sale1');
select lifecycle_test.mk_assignment('7d100000-0000-4000-8000-000000001002', '7d000000-0000-4000-8000-000000000010', 'u_sale1', '7d000000-0000-4000-8000-00000000d003');
select lifecycle_test.mk_assignment('7d100000-0000-4000-8000-000000001003', '7d000000-0000-4000-8000-000000000010', 'u_sale2');
do $$ declare e uuid; begin
  e := lifecycle_test.submit('u_sale1', '7d100000-0000-4000-8000-000000001001'); perform lifecycle_test.review(e, 'APPROVED');
  perform lifecycle_test.submit('u_sale1', '7d100000-0000-4000-8000-000000001001');
  perform lifecycle_test.submit('u_sale2', '7d100000-0000-4000-8000-000000001003');
end $$;

-- 11/2026 DRAFT (sale1 assignment)
select lifecycle_test.mk_period('7d000000-0000-4000-8000-000000000011', '2026-11-01', 'DRAFT');
select lifecycle_test.mk_assignment('7d100000-0000-4000-8000-000000001101', '7d000000-0000-4000-8000-000000000011', 'u_sale1');

-- 08/2026 CANCELLED (sale1 assignment + one approved event)
select lifecycle_test.mk_period('7d000000-0000-4000-8000-000000000008', '2026-08-01', 'ACTIVE');
select lifecycle_test.mk_assignment('7d100000-0000-4000-8000-000000000801', '7d000000-0000-4000-8000-000000000008', 'u_sale1');
select lifecycle_test.review(lifecycle_test.submit('u_sale1', '7d100000-0000-4000-8000-000000000801'), 'APPROVED');
select lifecycle_test.set_status('7d000000-0000-4000-8000-000000000008', 'CANCELLED');

-- 07/2026 CLOSED (sale2 only)
select lifecycle_test.mk_period('7d000000-0000-4000-8000-000000000007', '2026-07-01', 'ACTIVE');
select lifecycle_test.mk_assignment('7d100000-0000-4000-8000-000000000701', '7d000000-0000-4000-8000-000000000007', 'u_sale2');
select lifecycle_test.review(lifecycle_test.submit('u_sale2', '7d100000-0000-4000-8000-000000000701'), 'APPROVED');
select lifecycle_test.set_status('7d000000-0000-4000-8000-000000000007', 'CLOSED');

update public.kpi_periods set name = '[KPI TEST] ' || to_char(period_month, 'MM/YYYY');
