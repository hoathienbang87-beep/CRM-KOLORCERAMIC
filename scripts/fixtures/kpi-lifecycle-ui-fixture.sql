-- =====================================================================
-- KPI 7C-B — synthetic UI acceptance fixture (disposable DB only, no PII).
-- Requires kpi-lifecycle-prod-baseline.sql + 7C-A migration +
-- kpi-lifecycle-test-helpers.sql. Runtime rows go through the real RPCs.
-- =====================================================================

-- [KPI TEST] Lifecycle — 09/2026: 2 APPROVED, 1 REJECTED, 1 WITHDRAWN,
-- 3 PENDING, 2 unresolved NEEDS_REVISION; Evidence attached to every Event.
select lifecycle_test.mk_period('7cb00000-0000-4000-8000-000000000009', '2026-09-01', 'ACTIVE');
select lifecycle_test.mk_assignment('7cb10000-0000-4000-8000-000000000901', '7cb00000-0000-4000-8000-000000000009', 'u_sale1');
select lifecycle_test.mk_assignment('7cb10000-0000-4000-8000-000000000902', '7cb00000-0000-4000-8000-000000000009', 'u_sale2');
do $$
declare a1 uuid := '7cb10000-0000-4000-8000-000000000901'; a2 uuid := '7cb10000-0000-4000-8000-000000000902'; e uuid;
begin
  for i in 1..2 loop e := lifecycle_test.submit('u_sale1', a1); perform lifecycle_test.review(e, 'APPROVED'); end loop;
  e := lifecycle_test.submit('u_sale1', a1); perform lifecycle_test.review(e, 'REJECTED', 'DUPLICATE');
  e := lifecycle_test.submit('u_sale2', a2); perform lifecycle_test.withdraw('u_sale2', e);
  perform lifecycle_test.submit('u_sale1', a1);
  perform lifecycle_test.submit('u_sale1', a1);
  perform lifecycle_test.submit('u_sale2', a2);
  for i in 1..2 loop e := lifecycle_test.submit('u_sale2', a2); perform lifecycle_test.review(e, 'NEEDS_REVISION'); end loop;
end $$;
-- one unattached STAGED upload, to document that Close leaves it STAGED
insert into public.kpi_evidence(id, assignment_id, object_path, original_name, mime_type, size_bytes, sha256, uploaded_by_user_id)
values ('7cbe0000-0000-4000-8000-000000000001', '7cb10000-0000-4000-8000-000000000901',
        'kpi2/7cb10000-0000-4000-8000-000000000901/staged.jpg', 'staged.jpg', 'image/jpeg', 512,
        encode(extensions.digest('staged', 'sha256'), 'hex'), 'u_sale1');

-- [KPI TEST] current month — 10/2026 (Sale current-period view)
select lifecycle_test.mk_period('7cb00000-0000-4000-8000-000000000010', '2026-10-01', 'ACTIVE');
select lifecycle_test.mk_assignment('7cb10000-0000-4000-8000-000000001001', '7cb00000-0000-4000-8000-000000000010', 'u_sale1');
do $$ declare e uuid; begin
  e := lifecycle_test.submit('u_sale1', '7cb10000-0000-4000-8000-000000001001'); perform lifecycle_test.review(e, 'APPROVED');
  perform lifecycle_test.submit('u_sale1', '7cb10000-0000-4000-8000-000000001001');
end $$;

-- 08/2026: Cancel must fail (1 PENDING)
select lifecycle_test.mk_period('7cb00000-0000-4000-8000-000000000008', '2026-08-01', 'ACTIVE');
select lifecycle_test.mk_assignment('7cb10000-0000-4000-8000-000000000801', '7cb00000-0000-4000-8000-000000000008', 'u_sale1');
select lifecycle_test.submit('u_sale1', '7cb10000-0000-4000-8000-000000000801');

-- 07/2026: Cancel with zero open items (1 APPROVED)
select lifecycle_test.mk_period('7cb00000-0000-4000-8000-000000000007', '2026-07-01', 'ACTIVE');
select lifecycle_test.mk_assignment('7cb10000-0000-4000-8000-000000000701', '7cb00000-0000-4000-8000-000000000007', 'u_sale1');
select lifecycle_test.review(lifecycle_test.submit('u_sale1', '7cb10000-0000-4000-8000-000000000701'), 'APPROVED');

-- 06/2026: version conflict (2 PENDING)
select lifecycle_test.mk_period('7cb00000-0000-4000-8000-000000000006', '2026-06-01', 'ACTIVE');
select lifecycle_test.mk_assignment('7cb10000-0000-4000-8000-000000000601', '7cb00000-0000-4000-8000-000000000006', 'u_sale1');
select lifecycle_test.submit('u_sale1', '7cb10000-0000-4000-8000-000000000601');
select lifecycle_test.submit('u_sale1', '7cb10000-0000-4000-8000-000000000601');

-- 05/2026: count race (2 PENDING, a 3rd arrives while the dialog is open)
select lifecycle_test.mk_period('7cb00000-0000-4000-8000-000000000005', '2026-05-01', 'ACTIVE');
select lifecycle_test.mk_assignment('7cb10000-0000-4000-8000-000000000501', '7cb00000-0000-4000-8000-000000000005', 'u_sale1');
select lifecycle_test.submit('u_sale1', '7cb10000-0000-4000-8000-000000000501');
select lifecycle_test.submit('u_sale1', '7cb10000-0000-4000-8000-000000000501');

-- 04/2026: transactional failure (1 PENDING; the test installs a failing trigger)
select lifecycle_test.mk_period('7cb00000-0000-4000-8000-000000000004', '2026-04-01', 'ACTIVE');
select lifecycle_test.mk_assignment('7cb10000-0000-4000-8000-000000000401', '7cb00000-0000-4000-8000-000000000004', 'u_sale1');
select lifecycle_test.submit('u_sale1', '7cb10000-0000-4000-8000-000000000401');

update public.kpi_periods set name = '[KPI TEST] Lifecycle' where id = '7cb00000-0000-4000-8000-000000000009';
update public.kpi_periods set name = '[KPI TEST] ' || to_char(period_month, 'MM/YYYY') where id <> '7cb00000-0000-4000-8000-000000000009';
