begin;

insert into public.app_users(id, supabase_auth_id, email, name, role, active, lifecycle_status, raw_data)
values
  ('kpi21e2r-manager', '91000000-0000-4000-8000-000000000001', 'kpi21e2r-manager@example.com', 'KPI21E2R Manager', 'manager', true, 'active', '{"test":"KPI-2.1E.2R"}'),
  ('kpi21e2r-sale', '91000000-0000-4000-8000-000000000002', 'kpi21e2r-sale@example.com', 'KPI21E2R Sale', 'sale', true, 'active', '{"test":"KPI-2.1E.2R"}');

insert into public.kpi_definitions(
  id, code, name, kpi_type, unit, submission_mode, evidence_required, active,
  created_by_user_id, updated_by_user_id, aggregation_mode, max_images_per_event,
  location_required, timestamp_required, version
)
values
  ('92000000-0000-4000-8000-000000000001', 'KPI21E2R_USED', 'KPI used fixture', 'MANUAL', 'lượt', 'EVENT_CLAIM', false, true, 'kpi21e2r-manager', 'kpi21e2r-manager', 'COUNT', 1, false, true, 1),
  ('92000000-0000-4000-8000-000000000002', 'KPI21E2R_UNUSED', 'KPI unused fixture', 'MANUAL', 'lượt', 'EVENT_CLAIM', false, true, 'kpi21e2r-manager', 'kpi21e2r-manager', 'COUNT', 1, false, true, 1);

insert into public.kpi_periods(
  id, period_month, name, status, timezone, starts_at, ends_at,
  created_by_user_id, activated_by_user_id, closed_by_user_id,
  activated_at, closed_at, version
)
values
  ('93000000-0000-4000-8000-000000000001', '2097-01-01', 'KPI21E2R DRAFT clean', 'DRAFT', 'Asia/Ho_Chi_Minh', '2096-12-31 17:00+00', '2097-01-31 17:00+00', 'kpi21e2r-manager', null, null, null, null, 1),
  ('93000000-0000-4000-8000-000000000002', '2097-02-01', 'KPI21E2R DRAFT submission', 'DRAFT', 'Asia/Ho_Chi_Minh', '2097-01-31 17:00+00', '2097-02-28 17:00+00', 'kpi21e2r-manager', null, null, null, null, 1),
  ('93000000-0000-4000-8000-000000000003', '2097-03-01', 'KPI21E2R DRAFT event', 'DRAFT', 'Asia/Ho_Chi_Minh', '2097-02-28 17:00+00', '2097-03-31 17:00+00', 'kpi21e2r-manager', null, null, null, null, 1),
  ('93000000-0000-4000-8000-000000000004', '2097-04-01', 'KPI21E2R DRAFT evidence', 'DRAFT', 'Asia/Ho_Chi_Minh', '2097-03-31 17:00+00', '2097-04-30 17:00+00', 'kpi21e2r-manager', null, null, null, null, 1),
  ('93000000-0000-4000-8000-000000000005', '2097-05-01', 'KPI21E2R ACTIVE', 'ACTIVE', 'Asia/Ho_Chi_Minh', '2097-04-30 17:00+00', '2097-05-31 17:00+00', 'kpi21e2r-manager', 'kpi21e2r-manager', null, now(), null, 1),
  ('93000000-0000-4000-8000-000000000006', '2097-06-01', 'KPI21E2R CLOSED', 'CLOSED', 'Asia/Ho_Chi_Minh', '2097-05-31 17:00+00', '2097-06-30 17:00+00', 'kpi21e2r-manager', 'kpi21e2r-manager', 'kpi21e2r-manager', now(), now(), 1),
  ('93000000-0000-4000-8000-000000000007', '2097-07-01', 'KPI21E2R DRAFT edit', 'DRAFT', 'Asia/Ho_Chi_Minh', '2097-06-30 17:00+00', '2097-07-31 17:00+00', 'kpi21e2r-manager', null, null, null, null, 1);

select set_config('crm.kpi_write', 'on', true);
insert into public.kpi_assignments(
  id, period_id, definition_id, employee_id, target, effective_at,
  definition_snapshot, score_enabled, assigned_by_user_id, lock_version
)
select x.id, x.period_id, '92000000-0000-4000-8000-000000000001', 'kpi21e2r-sale', 10, x.effective_at,
  public.crm_kpi_definition_snapshot(d), true, 'kpi21e2r-manager', 1
from (values
  ('94000000-0000-4000-8000-000000000001'::uuid, '93000000-0000-4000-8000-000000000001'::uuid, '2096-12-31 17:00+00'::timestamptz),
  ('94000000-0000-4000-8000-000000000002'::uuid, '93000000-0000-4000-8000-000000000002'::uuid, '2097-01-31 17:00+00'::timestamptz),
  ('94000000-0000-4000-8000-000000000003'::uuid, '93000000-0000-4000-8000-000000000003'::uuid, '2097-02-28 17:00+00'::timestamptz),
  ('94000000-0000-4000-8000-000000000004'::uuid, '93000000-0000-4000-8000-000000000004'::uuid, '2097-03-31 17:00+00'::timestamptz),
  ('94000000-0000-4000-8000-000000000005'::uuid, '93000000-0000-4000-8000-000000000005'::uuid, '2097-04-30 17:00+00'::timestamptz),
  ('94000000-0000-4000-8000-000000000006'::uuid, '93000000-0000-4000-8000-000000000006'::uuid, '2097-05-31 17:00+00'::timestamptz),
  ('94000000-0000-4000-8000-000000000007'::uuid, '93000000-0000-4000-8000-000000000007'::uuid, '2097-06-30 17:00+00'::timestamptz)
) x(id, period_id, effective_at)
cross join public.kpi_definitions d
where d.id = '92000000-0000-4000-8000-000000000001';

insert into public.kpi_submissions(id, assignment_id, request_id, submitted_by_user_id)
values
  ('95000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000002', '96000000-0000-4000-8000-000000000002', 'kpi21e2r-sale'),
  ('95000000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000003', '96000000-0000-4000-8000-000000000003', 'kpi21e2r-sale');

insert into public.kpi_submission_events(
  id, submission_id, assignment_id, source_type, source_event_key,
  event_at, actor_user_id, claimed_value, event_snapshot
)
values (
  '97000000-0000-4000-8000-000000000003',
  '95000000-0000-4000-8000-000000000003',
  '94000000-0000-4000-8000-000000000003',
  'MANUAL', 'manual:97000000-0000-4000-8000-000000000003',
  '2097-03-15 03:00+00', 'kpi21e2r-sale', 1, '{"title":"fixture"}'
);

insert into public.kpi_evidence(
  id, assignment_id, bucket, object_path, original_name, mime_type,
  size_bytes, sha256, uploaded_by_user_id
)
values (
  '98000000-0000-4000-8000-000000000004',
  '94000000-0000-4000-8000-000000000004',
  'kpi2-evidence', 'kpi2/kpi21e2r/fixture.jpg', 'fixture.jpg', 'image/jpeg',
  100, repeat('a', 64), 'kpi21e2r-sale'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select public.crm_kpi_remove_draft_assignment(
  '94000000-0000-4000-8000-000000000001', 1, 1, 'Gán nhầm KPI'
);

do $$
begin
  if exists (select 1 from public.kpi_assignments where id = '94000000-0000-4000-8000-000000000001') then
    raise exception 'Clean DRAFT assignment was not removed';
  end if;
  if not exists (select 1 from public.kpi_definitions where id = '92000000-0000-4000-8000-000000000001') then
    raise exception 'Definition was removed with assignment';
  end if;
  if not exists (
    select 1 from public.audit_logs
    where action = 'assignment_remove_draft'
      and entity_id = '94000000-0000-4000-8000-000000000001'
      and raw_data->>'reason' = 'Gán nhầm KPI'
  ) then
    raise exception 'Assignment removal audit is incomplete';
  end if;
end $$;

do $$
declare v_id uuid;
begin
  foreach v_id in array array[
    '94000000-0000-4000-8000-000000000002'::uuid,
    '94000000-0000-4000-8000-000000000003'::uuid,
    '94000000-0000-4000-8000-000000000004'::uuid,
    '94000000-0000-4000-8000-000000000005'::uuid,
    '94000000-0000-4000-8000-000000000006'::uuid
  ] loop
    begin
      perform public.crm_kpi_remove_draft_assignment(v_id, 1, 1, 'negative test');
      raise exception 'Expected remove denial for %', v_id;
    exception
      when sqlstate '55000' then null;
    end;
  end loop;
end $$;

select public.crm_kpi_update_assignment_target(
  '94000000-0000-4000-8000-000000000007', 12, 1, 1
);
select public.crm_kpi_update_assignment_options(
  '94000000-0000-4000-8000-000000000007', false, 2, 2
);

do $$
begin
  if not exists (
    select 1 from public.kpi_assignments
    where id = '94000000-0000-4000-8000-000000000007'
      and target = 12 and score_enabled = false and lock_version = 3
  ) then
    raise exception 'DRAFT target/score edit failed';
  end if;
end $$;

do $$
begin
  begin
    perform public.crm_kpi_delete_unused_definition('92000000-0000-4000-8000-000000000001', 1);
    raise exception 'Used definition delete unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;
end $$;

select public.crm_kpi_set_definition_active('92000000-0000-4000-8000-000000000001', 1, false);

do $$
begin
  if exists (select 1 from public.kpi_definitions where id = '92000000-0000-4000-8000-000000000001' and active) then
    raise exception 'Used definition was not deactivated';
  end if;
  if not exists (
    select 1 from public.kpi_assignments
    where id = '94000000-0000-4000-8000-000000000007'
      and definition_snapshot->>'name' = 'KPI used fixture'
      and (definition_snapshot->>'definition_version')::integer = 1
  ) then
    raise exception 'Assignment snapshot changed after definition deactivation';
  end if;
  if not exists (select 1 from public.audit_logs where action = 'definition_deactivate' and entity_id = '92000000-0000-4000-8000-000000000001') then
    raise exception 'Definition deactivation audit missing';
  end if;
end $$;

select public.crm_kpi_delete_unused_definition('92000000-0000-4000-8000-000000000002', 1);

do $$
begin
  if exists (select 1 from public.kpi_definitions where id = '92000000-0000-4000-8000-000000000002') then
    raise exception 'Unused definition was not deleted';
  end if;
  if not exists (select 1 from public.audit_logs where action = 'definition_delete_unused' and entity_id = '92000000-0000-4000-8000-000000000002') then
    raise exception 'Unused definition delete audit missing';
  end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.crm_kpi_remove_draft_assignment('94000000-0000-4000-8000-000000000007', 3, 3, 'Sale bypass');
    raise exception 'Sale remove unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.crm_kpi_delete_unused_definition('92000000-0000-4000-8000-000000000001', 2);
    raise exception 'Sale definition delete unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.crm_kpi_set_definition_active('92000000-0000-4000-8000-000000000001', 2, true);
    raise exception 'Sale definition activation unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
end $$;

reset role;

select 'KPI-2.1E.2R INTEGRATION PASS' as result;
rollback;
