-- KPI-2.1E.2 integration test. All fixtures are rolled back.

begin;

insert into public.app_users(id, supabase_auth_id, email, name, role, active, lifecycle_status)
values
  ('kpi21e2-manager', '00000000-0000-4000-8000-000000002101', 'kpi21e2-manager@example.invalid', 'KPI21E2 Manager', 'manager', true, 'active'),
  ('kpi21e2-sale', '00000000-0000-4000-8000-000000002102', 'kpi21e2-sale@example.invalid', 'KPI21E2 Sale', 'sale', true, 'active');

select set_config('crm.kpi_write', 'on', true);
insert into public.kpi_definitions(id, code, name, kpi_type, unit, submission_mode, evidence_required, active, created_by_user_id, updated_by_user_id, version)
values
  ('10000000-0000-4000-8000-000000002101', 'KPI21E2_FREE', 'Unused definition', 'MANUAL', 'luot', 'EVENT_CLAIM', false, true, 'kpi21e2-manager', 'kpi21e2-manager', 1),
  ('10000000-0000-4000-8000-000000002102', 'KPI21E2_USED', 'Used definition', 'MANUAL', 'luot', 'EVENT_CLAIM', false, true, 'kpi21e2-manager', 'kpi21e2-manager', 1),
  ('10000000-0000-4000-8000-000000002103', 'KPI21E2_RUNTIME', 'Runtime definition', 'MANUAL', 'luot', 'EVENT_CLAIM', false, true, 'kpi21e2-manager', 'kpi21e2-manager', 1);

insert into public.kpi_periods(id, period_month, name, starts_at, ends_at, status, created_by_user_id, activated_by_user_id, activated_at, version)
values
  ('20000000-0000-4000-8000-000000002101', '2097-10-01', 'Delete assignment fixture', '2097-10-01 00:00:00+07', '2097-11-01 00:00:00+07', 'DRAFT', 'kpi21e2-manager', null, null, 1),
  ('20000000-0000-4000-8000-000000002102', '2097-11-01', 'Delete period fixture', '2097-11-01 00:00:00+07', '2097-12-01 00:00:00+07', 'DRAFT', 'kpi21e2-manager', null, null, 1),
  ('20000000-0000-4000-8000-000000002103', '2097-12-01', 'Active period fixture', '2097-12-01 00:00:00+07', '2098-01-01 00:00:00+07', 'ACTIVE', 'kpi21e2-manager', 'kpi21e2-manager', now(), 1),
  ('20000000-0000-4000-8000-000000002104', '2098-01-01', 'Runtime period fixture', '2098-01-01 00:00:00+07', '2098-02-01 00:00:00+07', 'DRAFT', 'kpi21e2-manager', null, null, 1);

insert into public.kpi_assignments(
  id, period_id, definition_id, employee_id, target, effective_at,
  assignment_status, definition_snapshot, assigned_by_user_id, lock_version
)
values
  ('30000000-0000-4000-8000-000000002101', '20000000-0000-4000-8000-000000002101', '10000000-0000-4000-8000-000000002102', 'kpi21e2-sale', 10, '2097-10-01', 'ASSIGNED', '{"code":"KPI21E2_USED","name":"Used definition","description":"","kpi_type":"MANUAL","source_metric_key":null,"unit":"luot","submission_mode":"EVENT_CLAIM","evidence_required":false,"definition_version":1}', 'kpi21e2-manager', 1),
  ('30000000-0000-4000-8000-000000002102', '20000000-0000-4000-8000-000000002102', '10000000-0000-4000-8000-000000002102', 'kpi21e2-sale', 5, '2097-11-01', 'ASSIGNED', '{"code":"KPI21E2_USED","name":"Used definition","description":"","kpi_type":"MANUAL","source_metric_key":null,"unit":"luot","submission_mode":"EVENT_CLAIM","evidence_required":false,"definition_version":1}', 'kpi21e2-manager', 1),
  ('30000000-0000-4000-8000-000000002103', '20000000-0000-4000-8000-000000002103', '10000000-0000-4000-8000-000000002102', 'kpi21e2-sale', 5, '2097-12-01', 'ASSIGNED', '{"code":"KPI21E2_USED","name":"Used definition","description":"","kpi_type":"MANUAL","source_metric_key":null,"unit":"luot","submission_mode":"EVENT_CLAIM","evidence_required":false,"definition_version":1}', 'kpi21e2-manager', 1),
  ('30000000-0000-4000-8000-000000002104', '20000000-0000-4000-8000-000000002104', '10000000-0000-4000-8000-000000002103', 'kpi21e2-sale', 5, '2098-01-01', 'ASSIGNED', '{"code":"KPI21E2_RUNTIME","name":"Runtime definition","description":"","kpi_type":"MANUAL","source_metric_key":null,"unit":"luot","submission_mode":"EVENT_CLAIM","evidence_required":false,"definition_version":1}', 'kpi21e2-manager', 1);

insert into public.kpi_submissions(
  id, assignment_id, request_id, submitted_by_user_id, status
)
values (
  '40000000-0000-4000-8000-000000002101',
  '30000000-0000-4000-8000-000000002104',
  '50000000-0000-4000-8000-000000002101',
  'kpi21e2-sale',
  'OPEN_REVIEW'
);
select set_config('crm.kpi_write', 'off', true);

set local role authenticated;

-- Sale cannot delete any business configuration.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000002102","email":"kpi21e2-sale@example.invalid","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.crm_kpi_delete_draft_period('20000000-0000-4000-8000-000000002102', 1);
    raise exception 'ROLE failed: sale deleted a DRAFT period';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- Manager may delete a clean assignment and the mutation is audited.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000002101","email":"kpi21e2-manager@example.invalid","role":"authenticated"}', true);
select public.crm_kpi_delete_draft_assignment(
  '30000000-0000-4000-8000-000000002101', 1, 1
);

do $$
begin
  if exists (select 1 from public.kpi_assignments where id = '30000000-0000-4000-8000-000000002101') then
    raise exception 'ASSIGNMENT failed: row still exists';
  end if;
  if (select version from public.kpi_periods where id = '20000000-0000-4000-8000-000000002101') <> 2 then
    raise exception 'ASSIGNMENT failed: period version was not advanced';
  end if;
  if not exists (select 1 from public.audit_logs where action = 'assignment_delete_draft' and entity_id = '30000000-0000-4000-8000-000000002101') then
    raise exception 'ASSIGNMENT failed: audit row missing';
  end if;
end $$;

-- A definition in use cannot be deleted.
do $$
begin
  begin
    perform public.crm_kpi_delete_unused_definition('10000000-0000-4000-8000-000000002102', 1);
    raise exception 'DEFINITION failed: used definition was deleted';
  exception when sqlstate '55000' then null;
  end;
end $$;

-- ACTIVE periods and DRAFT periods with runtime data cannot be deleted.
do $$
begin
  begin
    perform public.crm_kpi_delete_draft_period('20000000-0000-4000-8000-000000002103', 1);
    raise exception 'PERIOD failed: ACTIVE period was deleted';
  exception when sqlstate '55000' then null;
  end;
  begin
    perform public.crm_kpi_delete_draft_period('20000000-0000-4000-8000-000000002104', 1);
    raise exception 'PERIOD failed: period with submission was deleted';
  exception when sqlstate '55000' then null;
  end;
end $$;

-- Clean DRAFT period cascades only its unused runtime-free assignments.
select public.crm_kpi_delete_draft_period('20000000-0000-4000-8000-000000002102', 1);
do $$
begin
  if exists (select 1 from public.kpi_periods where id = '20000000-0000-4000-8000-000000002102')
     or exists (select 1 from public.kpi_assignments where id = '30000000-0000-4000-8000-000000002102') then
    raise exception 'PERIOD failed: period or assignment still exists';
  end if;
  if not exists (select 1 from public.audit_logs where action = 'period_delete_draft' and entity_id = '20000000-0000-4000-8000-000000002102') then
    raise exception 'PERIOD failed: audit row missing';
  end if;
end $$;

-- Unused definition can be removed and is audited.
select public.crm_kpi_delete_unused_definition('10000000-0000-4000-8000-000000002101', 1);
do $$
begin
  if exists (select 1 from public.kpi_definitions where id = '10000000-0000-4000-8000-000000002101') then
    raise exception 'DEFINITION failed: unused definition still exists';
  end if;
  if not exists (select 1 from public.audit_logs where action = 'definition_delete_unused' and entity_id = '10000000-0000-4000-8000-000000002101') then
    raise exception 'DEFINITION failed: audit row missing';
  end if;
end $$;

-- Anonymous callers have no EXECUTE privilege.
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.crm_kpi_delete_draft_assignment(uuid,integer,integer)', 'execute')
     or has_function_privilege('anon', 'public.crm_kpi_delete_draft_period(uuid,integer)', 'execute')
     or has_function_privilege('anon', 'public.crm_kpi_delete_unused_definition(uuid,integer)', 'execute') then
    raise exception 'ACL failed: anon can execute KPI delete RPC';
  end if;
end $$;

rollback;
