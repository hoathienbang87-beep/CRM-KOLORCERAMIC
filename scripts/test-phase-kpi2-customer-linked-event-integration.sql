-- KPI-2 Customer-linked Event integration harness.
-- Run only on an isolated local/staging database after the Phase 2 migration.
-- Every fixture and mutation is rolled back.

begin;

insert into public.app_users(id, supabase_auth_id, email, name, role, active, lifecycle_status)
values
  ('k2cl-manager', '20000000-0000-4000-8000-000000000001', 'k2cl-manager@example.invalid', 'K2CL Manager', 'manager', true, 'active'),
  ('k2cl-sale-a',  '20000000-0000-4000-8000-000000000002', 'k2cl-sale-a@example.invalid',  'K2CL Sale A',  'sale', true, 'active'),
  ('k2cl-sale-b',  '20000000-0000-4000-8000-000000000003', 'k2cl-sale-b@example.invalid',  'K2CL Sale B',  'sale', true, 'active');

select set_config('crm.kpi_write', 'on', true);
select set_config('crm.allow_assignment_write', 'on', true);

insert into public.customers(
  id, name, company_name, phone_raw, phone_normalized, address,
  created_by_email, created_by_user_id, owner_user_id, is_deleted
)
values
  ('k2cl-x', 'Real X', 'Company X', '0901000001', '0901000001', 'Address X', 'k2cl-sale-a@example.invalid', 'k2cl-sale-a', 'k2cl-sale-a', false),
  ('k2cl-y', 'Real Y', 'Company Y', '0902000002', '0902000002', 'Address Y', 'k2cl-sale-b@example.invalid', 'k2cl-sale-b', 'k2cl-sale-b', false),
  ('k2cl-t', 'Transfer T', null, '0903000003', '0903000003', null, 'k2cl-sale-a@example.invalid', 'k2cl-sale-a', 'k2cl-sale-a', false),
  ('k2cl-archived', 'Archived C', null, '0904000004', '0904000004', null, 'k2cl-sale-a@example.invalid', 'k2cl-sale-a', 'k2cl-sale-a', true);

insert into public.customer_assignments(
  id, customer_id, employee_id, employee_email_snapshot, employee_name_snapshot,
  assigned_by_user_id, assignment_reason, is_current
)
values
  ('k2cl-ca-x', 'k2cl-x', 'k2cl-sale-a', 'k2cl-sale-a@example.invalid', 'K2CL Sale A', 'k2cl-manager', 'fixture', true),
  ('k2cl-ca-y', 'k2cl-y', 'k2cl-sale-b', 'k2cl-sale-b@example.invalid', 'K2CL Sale B', 'k2cl-manager', 'fixture', true),
  ('k2cl-ca-t', 'k2cl-t', 'k2cl-sale-a', 'k2cl-sale-a@example.invalid', 'K2CL Sale A', 'k2cl-manager', 'fixture', true),
  ('k2cl-ca-c', 'k2cl-archived', 'k2cl-sale-a', 'k2cl-sale-a@example.invalid', 'K2CL Sale A', 'k2cl-manager', 'fixture', true);

insert into public.kpi_periods(
  id, period_month, name, status, timezone, starts_at, ends_at,
  created_by_user_id, activated_by_user_id, activated_at
)
values (
  '21000000-0000-4000-8000-000000000001', date '2001-01-01', 'K2CL Integration',
  'ACTIVE', 'Asia/Ho_Chi_Minh', '2000-12-31T17:00:00Z', '2001-01-31T17:00:00Z',
  'k2cl-manager', 'k2cl-manager', now()
);

insert into public.kpi_definitions(
  id, code, name, kpi_type, unit, submission_mode, evidence_required,
  aggregation_mode, max_images_per_event, location_required, timestamp_required,
  customer_relation_mode, created_by_user_id, updated_by_user_id
)
values
  ('22000000-0000-4000-8000-000000000001', 'K2CL_REQUIRED', 'Required', 'MANUAL', 'event', 'EVENT_CLAIM', false, 'COUNT', 2, false, true, 'REQUIRED', 'k2cl-manager', 'k2cl-manager'),
  ('22000000-0000-4000-8000-000000000002', 'K2CL_OPTIONAL', 'Optional', 'MANUAL', 'event', 'EVENT_CLAIM', false, 'COUNT', 2, false, true, 'OPTIONAL', 'k2cl-manager', 'k2cl-manager'),
  ('22000000-0000-4000-8000-000000000003', 'K2CL_NONE', 'None', 'MANUAL', 'event', 'EVENT_CLAIM', false, 'COUNT', 2, false, true, 'NONE', 'k2cl-manager', 'k2cl-manager');

insert into public.kpi_assignments(
  id, period_id, definition_id, employee_id, target, effective_at,
  definition_snapshot, assigned_by_user_id
)
select x.assignment_id, '21000000-0000-4000-8000-000000000001', d.id,
  'k2cl-sale-a', 10, '2000-12-31T17:00:00Z',
  public.crm_kpi_definition_snapshot(d), 'k2cl-manager'
from public.kpi_definitions d
join (values
  ('22000000-0000-4000-8000-000000000001'::uuid, '23000000-0000-4000-8000-000000000001'::uuid),
  ('22000000-0000-4000-8000-000000000002'::uuid, '23000000-0000-4000-8000-000000000002'::uuid),
  ('22000000-0000-4000-8000-000000000003'::uuid, '23000000-0000-4000-8000-000000000003'::uuid)
) as x(definition_id, assignment_id) on x.definition_id = d.id;

-- Execute as Sale A from this point unless a test explicitly switches actor.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000002","email":"k2cl-sale-a@example.invalid","role":"authenticated"}', true);

-- Test A: assigned Customer succeeds.
-- Test H: client snapshot lies are stripped and never authoritative.
select public.crm_kpi_submit_events(
  '23000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001', null,
  jsonb_build_array(jsonb_build_object(
    'sourceType', 'MANUAL',
    'sourceEventKey', 'manual:25000000-0000-4000-8000-000000000001',
    'eventAt', '2001-01-15T09:00:00+07:00',
    'customerId', 'k2cl-x',
    'eventSnapshot', jsonb_build_object(
      'title', 'Valid assigned customer', 'customerName', 'Fake Name',
      'phone', '999999', 'address', 'Fake Address',
      'customerSnapshot', jsonb_build_object('name', 'Fake Nested')
    ),
    'evidenceIds', '[]'::jsonb
  ))
);

do $$
begin
  if not exists (
    select 1 from public.kpi_submission_events
    where source_event_key = 'manual:25000000-0000-4000-8000-000000000001'
      and customer_id = 'k2cl-x'
      and customer_name_snapshot = 'Real X'
      and customer_company_name_snapshot = 'Company X'
      and customer_phone_snapshot = '0901000001'
      and customer_phone_normalized_snapshot = '0901000001'
      and customer_address_snapshot = 'Address X'
      and not (event_snapshot ?| array['customerName','phone','address','customerSnapshot'])
  ) then raise exception 'A/H failed: authoritative Customer snapshot mismatch'; end if;
end;
$$;

-- Test B: knowing Sale B's Customer ID is insufficient (SQLSTATE 42501).
do $$
begin
  begin
    perform public.crm_kpi_submit_events(
      '23000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000002', null,
      '[{"sourceType":"MANUAL","sourceEventKey":"manual:25000000-0000-4000-8000-000000000002","eventAt":"2001-01-15T09:01:00+07:00","customerId":"k2cl-y","eventSnapshot":{"title":"guessed"},"evidenceIds":[]}]'::jsonb
    );
    raise exception 'B failed: guessed Customer ID unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
  if exists(select 1 from public.kpi_submission_events where source_event_key = 'manual:25000000-0000-4000-8000-000000000002') then
    raise exception 'B failed: partial event survived';
  end if;
end;
$$;

-- Test C: transfer before submit invalidates the stale selection.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000001","email":"k2cl-manager@example.invalid","role":"authenticated"}', true);
select public.crm_assign_customer('k2cl-t', 'k2cl-sale-b', 'integration transfer before submit');
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000002","email":"k2cl-sale-a@example.invalid","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.crm_kpi_submit_events(
      '23000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000003', null,
      '[{"sourceType":"MANUAL","sourceEventKey":"manual:25000000-0000-4000-8000-000000000003","eventAt":"2001-01-15T09:02:00+07:00","customerId":"k2cl-t","eventSnapshot":{"title":"stale"},"evidenceIds":[]}]'::jsonb
    );
    raise exception 'C failed: transferred Customer unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- Test D: archived Customer is rejected after authoritative access validation.
do $$ begin
  begin
    perform public.crm_kpi_submit_events(
      '23000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000004', null,
      '[{"sourceType":"MANUAL","sourceEventKey":"manual:25000000-0000-4000-8000-000000000004","eventAt":"2001-01-15T09:03:00+07:00","customerId":"k2cl-archived","eventSnapshot":{"title":"archived"},"evidenceIds":[]}]'::jsonb
    );
    raise exception 'D failed: archived Customer unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;
end $$;

-- Test E: REQUIRED without Customer is rejected.
do $$ begin
  begin
    perform public.crm_kpi_submit_events(
      '23000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000005', null,
      '[{"sourceType":"MANUAL","sourceEventKey":"manual:25000000-0000-4000-8000-000000000005","eventAt":"2001-01-15T09:04:00+07:00","eventSnapshot":{"title":"missing"},"evidenceIds":[]}]'::jsonb
    );
    raise exception 'E failed: REQUIRED accepted NULL Customer';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- Test F: NONE with Customer is rejected.
do $$ begin
  begin
    perform public.crm_kpi_submit_events(
      '23000000-0000-4000-8000-000000000003', '24000000-0000-4000-8000-000000000006', null,
      '[{"sourceType":"MANUAL","sourceEventKey":"manual:25000000-0000-4000-8000-000000000006","eventAt":"2001-01-15T09:05:00+07:00","customerId":"k2cl-x","eventSnapshot":{"title":"forbidden"},"evidenceIds":[]}]'::jsonb
    );
    raise exception 'F failed: NONE accepted Customer';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- Test G: OPTIONAL without Customer succeeds.
-- Test O: legacy-compatible NULL Customer persists with all snapshots NULL.
select public.crm_kpi_submit_events(
  '23000000-0000-4000-8000-000000000002',
  '24000000-0000-4000-8000-000000000007', null,
  '[{"sourceType":"MANUAL","sourceEventKey":"manual:25000000-0000-4000-8000-000000000007","eventAt":"2001-01-15T09:06:00+07:00","eventSnapshot":{"title":"legacy-compatible-null"},"evidenceIds":[]}]'::jsonb
);
do $$ begin
  if not exists (
    select 1 from public.kpi_submission_events
    where source_event_key = 'manual:25000000-0000-4000-8000-000000000007'
      and customer_id is null and customer_name_snapshot is null
      and customer_company_name_snapshot is null and customer_phone_snapshot is null
      and customer_phone_normalized_snapshot is null and customer_address_snapshot is null
  ) then raise exception 'G/O failed: OPTIONAL NULL shape invalid'; end if;
end $$;

-- Test I: editing Customer does not mutate the old Event snapshot.
reset role;
update public.customers set name = 'Edited X', phone_raw = '0988000000' where id = 'k2cl-x';
do $$ begin
  if not exists (
    select 1 from public.kpi_submission_events
    where source_event_key = 'manual:25000000-0000-4000-8000-000000000001'
      and customer_name_snapshot = 'Real X' and customer_phone_snapshot = '0901000001'
  ) then raise exception 'I failed: historical snapshot changed with Customer'; end if;
end $$;

-- Test N: Manager/Owner business-manager read path includes dedicated snapshots.
-- Test O continuation: normal review accepts the NULL legacy-compatible row.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000001","email":"k2cl-manager@example.invalid","role":"authenticated"}', true);
do $$ begin
  if not exists (
    select 1 from public.kpi_submission_events
    where source_event_key = 'manual:25000000-0000-4000-8000-000000000001'
      and customer_name_snapshot = 'Real X'
  ) then raise exception 'N failed: manager cannot read Event Customer snapshot'; end if;
end $$;
select public.crm_kpi_review_events(
  '26000000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object(
    'eventId', (select id from public.kpi_submission_events where source_event_key = 'manual:25000000-0000-4000-8000-000000000007'),
    'expectedVersion', 1
  )), 'APPROVED', null, null
);

-- Put the Customer-linked event into NEEDS_REVISION through the canonical review RPC.
select public.crm_kpi_review_events(
  '26000000-0000-4000-8000-000000000002',
  jsonb_build_array(jsonb_build_object(
    'eventId', (select id from public.kpi_submission_events where source_event_key = 'manual:25000000-0000-4000-8000-000000000001'),
    'expectedVersion', 1
  )), 'NEEDS_REVISION', 'INCOMPLETE_INFORMATION', 'Please revise'
);

-- Test J: revision cannot change Customer identity.
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000002","email":"k2cl-sale-a@example.invalid","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.crm_kpi_submit_revision(
      (select id from public.kpi_submission_events where source_event_key = 'manual:25000000-0000-4000-8000-000000000001'),
      '27000000-0000-4000-8000-000000000001', null,
      '{"customerId":"k2cl-y","eventSnapshot":{"title":"changed identity"},"evidenceIds":[]}'::jsonb
    );
    raise exception 'J failed: revision changed Customer';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- Test K: after transfer, former Sale cannot revise the original Event.
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000001","email":"k2cl-manager@example.invalid","role":"authenticated"}', true);
select public.crm_assign_customer('k2cl-x', 'k2cl-sale-b', 'integration transfer before revision');
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000002","email":"k2cl-sale-a@example.invalid","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.crm_kpi_submit_revision(
      (select id from public.kpi_submission_events where source_event_key = 'manual:25000000-0000-4000-8000-000000000001'),
      '27000000-0000-4000-8000-000000000002', null,
      '{"customerId":"k2cl-x","eventSnapshot":{"title":"after transfer"},"evidenceIds":[]}'::jsonb
    );
    raise exception 'K failed: former owner revised after transfer';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- Test L: one unauthorized Customer rolls back the entire two-event batch.
do $$
declare v_submissions bigint; v_events bigint;
begin
  select count(*) into v_submissions from public.kpi_submissions;
  select count(*) into v_events from public.kpi_submission_events;
  begin
    perform public.crm_kpi_submit_events(
      '23000000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-000000000008', null,
      '[
        {"sourceType":"MANUAL","sourceEventKey":"manual:25000000-0000-4000-8000-000000000008","eventAt":"2001-01-15T09:07:00+07:00","eventSnapshot":{"title":"valid first"},"evidenceIds":[]},
        {"sourceType":"MANUAL","sourceEventKey":"manual:25000000-0000-4000-8000-000000000009","eventAt":"2001-01-15T09:08:00+07:00","customerId":"k2cl-y","eventSnapshot":{"title":"unauthorized second"},"evidenceIds":[]}
      ]'::jsonb
    );
    raise exception 'L failed: mixed-authority batch succeeded';
  exception when sqlstate '42501' then null;
  end;
  if (select count(*) from public.kpi_submissions) <> v_submissions
     or (select count(*) from public.kpi_submission_events) <> v_events then
    raise exception 'L failed: partial batch rows survived';
  end if;
end $$;

-- Test M: exact retry returns the stored response; changed payload conflicts.
do $$
declare v_first jsonb; v_retry jsonb;
begin
  v_first := public.crm_kpi_submit_events(
    '23000000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-000000000009', 'same',
    '[{"sourceType":"MANUAL","sourceEventKey":"manual:25000000-0000-4000-8000-000000000010","eventAt":"2001-01-15T09:09:00+07:00","eventSnapshot":{"title":"idempotent"},"evidenceIds":[]}]'::jsonb
  );
  v_retry := public.crm_kpi_submit_events(
    '23000000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-000000000009', 'same',
    '[{"sourceType":"MANUAL","sourceEventKey":"manual:25000000-0000-4000-8000-000000000010","eventAt":"2001-01-15T09:09:00+07:00","eventSnapshot":{"title":"idempotent"},"evidenceIds":[]}]'::jsonb
  );
  if v_first is distinct from v_retry then raise exception 'M failed: exact retry changed response'; end if;
  begin
    perform public.crm_kpi_submit_events(
      '23000000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-000000000009', 'changed',
      '[{"sourceType":"MANUAL","sourceEventKey":"manual:25000000-0000-4000-8000-000000000011","eventAt":"2001-01-15T09:10:00+07:00","eventSnapshot":{"title":"conflict"},"evidenceIds":[]}]'::jsonb
    );
    raise exception 'M failed: changed payload reused request ID';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

-- Search stays on the current assignment boundary and exposes only six fields.
do $$ begin
  if exists(select 1 from public.crm_kpi_search_accessible_customers(null, 999) where id in ('k2cl-x','k2cl-y')) then
    raise exception 'Search failed: Sale A saw Customer assigned to Sale B';
  end if;
  if has_function_privilege('anon', 'public.crm_kpi_search_accessible_customers(text,integer)', 'execute') then
    raise exception 'Search ACL failed: anon can execute';
  end if;
end $$;

rollback;
