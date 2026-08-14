-- KPI-1 PostgreSQL integration harness.
-- Run only after KPI-1 is installed on staging. The outer transaction rolls
-- back every fixture, audit row and state transition.

begin;

insert into public.app_users(id, supabase_auth_id, email, name, role, active, lifecycle_status)
values
  ('kpi1-owner', '00000000-0000-4000-8000-000000001001', 'kpi1-owner@example.invalid', 'KPI1 Owner', 'owner', true, 'active'),
  ('kpi1-admin', '00000000-0000-4000-8000-000000001002', 'kpi1-admin@example.invalid', 'KPI1 Admin', 'admin', true, 'active'),
  ('kpi1-manager', '00000000-0000-4000-8000-000000001003', 'kpi1-manager@example.invalid', 'KPI1 Manager', 'manager', true, 'active'),
  ('kpi1-sale-a', '00000000-0000-4000-8000-000000001004', 'kpi1-sale-a@example.invalid', 'KPI1 Sale A', 'sale', true, 'active'),
  ('kpi1-sale-b', '00000000-0000-4000-8000-000000001005', 'kpi1-sale-b@example.invalid', 'KPI1 Sale B', 'sale', true, 'active'),
  ('kpi1-sale-c', '00000000-0000-4000-8000-000000001006', 'kpi1-sale-c@example.invalid', 'KPI1 Sale C', 'sale', true, 'active'),
  ('kpi1-sale-inactive', '00000000-0000-4000-8000-000000001007', 'kpi1-inactive@example.invalid', 'KPI1 Inactive', 'sale', false, 'inactive');

-- Sale cannot create business configuration.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000001004","email":"kpi1-sale-a@example.invalid","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.crm_kpi_create_period('2098-08-18', 'KPI tháng 08/2098');
    raise exception 'ROLE failed: sale created a period';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- Manager creates a normalized DRAFT period and definitions.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000001003","email":"kpi1-manager@example.invalid","role":"authenticated"}', true);
select public.crm_kpi_create_period('2098-08-18', 'KPI tháng 08/2098');

do $$
begin
  if not exists (
    select 1 from public.kpi_periods
    where period_month = date '2098-08-01' and status = 'DRAFT' and version = 1
  ) then raise exception 'PERIOD failed: month was not normalized'; end if;
  begin
    perform public.crm_kpi_create_period('2098-08-01', 'Duplicate');
    raise exception 'PERIOD failed: duplicate month succeeded';
  exception when sqlstate '23505' then null;
  end;
end $$;

select public.crm_kpi_create_definition(
  'KPI1_CUSTOMER', 'Tên A', 'Definition snapshot test', 'MANUAL', null,
  'lượt', 'EVENT_CLAIM', true
);
select public.crm_kpi_create_definition(
  'KPI1_CARE', 'Chăm sóc', 'Bulk assignment test', 'HYBRID', 'care_logs_v1',
  'lượt', 'EVENT_CLAIM', false
);

-- Assign different targets to different sales. Each mutation advances the
-- period version and snapshots the current definition.
select public.crm_kpi_assign_employee(
  (select id from public.kpi_periods where period_month='2098-08-01'),
  (select id from public.kpi_definitions where code='KPI1_CUSTOMER'),
  'kpi1-sale-a', 20,
  (select version from public.kpi_periods where period_month='2098-08-01')
);
select public.crm_kpi_assign_employee(
  (select id from public.kpi_periods where period_month='2098-08-01'),
  (select id from public.kpi_definitions where code='KPI1_CUSTOMER'),
  'kpi1-sale-b', 15,
  (select version from public.kpi_periods where period_month='2098-08-01')
);

do $$
begin
  if not exists (
    select 1 from public.kpi_assignments a
    join public.kpi_periods p on p.id=a.period_id
    where p.period_month='2098-08-01' and a.employee_id='kpi1-sale-a'
      and a.target=20 and a.definition_snapshot->>'name'='Tên A'
  ) then raise exception 'ASSIGNMENT failed: Sale A target/snapshot incorrect'; end if;
  if not exists (
    select 1 from public.kpi_assignments a
    join public.kpi_periods p on p.id=a.period_id
    where p.period_month='2098-08-01' and a.employee_id='kpi1-sale-b' and a.target=15
  ) then raise exception 'ASSIGNMENT failed: Sale B target incorrect'; end if;
end $$;

-- Invalid target, role and lifecycle are rejected before writes.
do $$
begin
  begin
    perform public.crm_kpi_assign_employee(
      (select id from public.kpi_periods where period_month='2098-08-01'),
      (select id from public.kpi_definitions where code='KPI1_CUSTOMER'),
      'kpi1-sale-c', 0,
      (select version from public.kpi_periods where period_month='2098-08-01'));
    raise exception 'TARGET failed: zero target succeeded';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.crm_kpi_assign_employee(
      (select id from public.kpi_periods where period_month='2098-08-01'),
      (select id from public.kpi_definitions where code='KPI1_CUSTOMER'),
      'kpi1-manager', 10,
      (select version from public.kpi_periods where period_month='2098-08-01'));
    raise exception 'ELIGIBILITY failed: manager received KPI';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.crm_kpi_assign_employee(
      (select id from public.kpi_periods where period_month='2098-08-01'),
      (select id from public.kpi_definitions where code='KPI1_CUSTOMER'),
      'kpi1-sale-inactive', 10,
      (select version from public.kpi_periods where period_month='2098-08-01'));
    raise exception 'ELIGIBILITY failed: inactive sale received KPI';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- Bulk validation is all-or-nothing.
do $$
begin
  begin
    perform public.crm_kpi_bulk_assign(
      (select id from public.kpi_periods where period_month='2098-08-01'),
      (select id from public.kpi_definitions where code='KPI1_CARE'),
      jsonb_build_array(
        jsonb_build_object('employeeId','kpi1-sale-c','target',30),
        jsonb_build_object('employeeId','kpi1-sale-inactive','target',20)
      ),
      (select version from public.kpi_periods where period_month='2098-08-01'));
    raise exception 'BULK failed: invalid employee did not fail';
  exception when sqlstate '22023' then null;
  end;
  if exists (
    select 1 from public.kpi_assignments a
    join public.kpi_definitions d on d.id=a.definition_id
    where d.code='KPI1_CARE' and a.employee_id='kpi1-sale-c'
  ) then raise exception 'BULK failed: partial assignment survived'; end if;
end $$;

select public.crm_kpi_bulk_assign(
  (select id from public.kpi_periods where period_month='2098-08-01'),
  (select id from public.kpi_definitions where code='KPI1_CARE'),
  jsonb_build_array(
    jsonb_build_object('employeeId','kpi1-sale-a','target',30),
    jsonb_build_object('employeeId','kpi1-sale-b','target',25),
    jsonb_build_object('employeeId','kpi1-sale-c','target',20)
  ),
  (select version from public.kpi_periods where period_month='2098-08-01')
);

-- DRAFT configuration is invisible to sale at data layer.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000001004","email":"kpi1-sale-a@example.invalid","role":"authenticated"}', true);
do $$
begin
  if exists(select 1 from public.kpi_periods where period_month='2098-08-01') then
    raise exception 'RLS failed: sale sees DRAFT period';
  end if;
  if exists(select 1 from public.kpi_assignments where employee_id='kpi1-sale-a') then
    raise exception 'RLS failed: sale sees DRAFT assignment';
  end if;
  if exists(select 1 from public.kpi_definitions) then
    raise exception 'RLS failed: sale reads definition catalog';
  end if;
end $$;

-- Activate atomically. Stale activation/update will be blocked.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000001003","email":"kpi1-manager@example.invalid","role":"authenticated"}', true);
select public.crm_kpi_activate_period(
  (select id from public.kpi_periods where period_month='2098-08-01'),
  (select version from public.kpi_periods where period_month='2098-08-01')
);

do $$
declare
  v_period public.kpi_periods%rowtype;
  v_assignment public.kpi_assignments%rowtype;
begin
  select * into v_period from public.kpi_periods where period_month='2098-08-01';
  select a.* into v_assignment from public.kpi_assignments a
    join public.kpi_definitions d on d.id=a.definition_id
    where a.period_id=v_period.id and a.employee_id='kpi1-sale-a' and d.code='KPI1_CUSTOMER';
  begin
    perform public.crm_kpi_update_assignment_target(
      v_assignment.id, 99, v_assignment.lock_version, v_period.version);
    raise exception 'LOCK failed: ACTIVE target changed';
  exception when sqlstate '55000' then null;
  end;
  begin
    perform public.crm_kpi_activate_period(v_period.id, v_period.version - 1);
    raise exception 'CONCURRENCY failed: second activation succeeded';
  exception when sqlstate '55000' then null;
  end;
end $$;

-- Sale sees only own assignments and the ACTIVE period, not the catalog.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000001004","email":"kpi1-sale-a@example.invalid","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.kpi_periods where period_month='2098-08-01') <> 1 then
    raise exception 'RLS failed: sale cannot see ACTIVE assigned period';
  end if;
  if exists(select 1 from public.kpi_assignments where employee_id <> 'kpi1-sale-a') then
    raise exception 'RLS failed: Sale A sees another employee assignment';
  end if;
  if (select count(*) from public.kpi_assignments where employee_id='kpi1-sale-a') <> 2 then
    raise exception 'RLS failed: Sale A own assignment count incorrect';
  end if;
  if exists(select 1 from public.kpi_definitions) then
    raise exception 'RLS failed: sale reads definition catalog';
  end if;
end $$;

-- Editing the template after activation does not mutate the August snapshot.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000001003","email":"kpi1-manager@example.invalid","role":"authenticated"}', true);
select public.crm_kpi_update_definition(
  (select id from public.kpi_definitions where code='KPI1_CUSTOMER'),
  (select version from public.kpi_definitions where code='KPI1_CUSTOMER'),
  jsonb_build_object('name','Tên B')
);

select public.crm_kpi_create_period('2098-09-09', 'KPI tháng 09/2098');
select public.crm_kpi_assign_employee(
  (select id from public.kpi_periods where period_month='2098-09-01'),
  (select id from public.kpi_definitions where code='KPI1_CUSTOMER'),
  'kpi1-sale-a', 18,
  (select version from public.kpi_periods where period_month='2098-09-01')
);

do $$
begin
  if not exists (
    select 1 from public.kpi_assignments a join public.kpi_periods p on p.id=a.period_id
    where p.period_month='2098-08-01' and a.employee_id='kpi1-sale-a'
      and a.definition_snapshot->>'name'='Tên A'
  ) then raise exception 'ISOLATION failed: August snapshot changed'; end if;
  if not exists (
    select 1 from public.kpi_assignments a join public.kpi_periods p on p.id=a.period_id
    where p.period_month='2098-09-01' and a.employee_id='kpi1-sale-a'
      and a.definition_snapshot->>'name'='Tên B'
  ) then raise exception 'ISOLATION failed: September snapshot did not use new definition'; end if;
end $$;

-- Cancel/reassign is allowed only while DRAFT and preserves one unique row.
select public.crm_kpi_cancel_assignment(
  (select a.id from public.kpi_assignments a join public.kpi_periods p on p.id=a.period_id
    where p.period_month='2098-09-01' and a.employee_id='kpi1-sale-a'),
  (select a.lock_version from public.kpi_assignments a join public.kpi_periods p on p.id=a.period_id
    where p.period_month='2098-09-01' and a.employee_id='kpi1-sale-a'),
  (select version from public.kpi_periods where period_month='2098-09-01'),
  'Cấu hình lại target'
);
select public.crm_kpi_assign_employee(
  (select id from public.kpi_periods where period_month='2098-09-01'),
  (select id from public.kpi_definitions where code='KPI1_CUSTOMER'),
  'kpi1-sale-a', 22,
  (select version from public.kpi_periods where period_month='2098-09-01')
);

do $$
begin
  if (select count(*) from public.kpi_assignments a join public.kpi_periods p on p.id=a.period_id
      where p.period_month='2098-09-01' and a.employee_id='kpi1-sale-a') <> 1 then
    raise exception 'ASSIGNMENT failed: cancel/reassign created duplicate';
  end if;
end $$;

-- Draft KPI config blocks deactivation; no race can commit an invalid DRAFT assignment.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000001002","email":"kpi1-admin@example.invalid","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.crm_deactivate_employee('kpi1-sale-a', 'unassigned', null, 'KPI-1 deactivation guard');
    raise exception 'LIFECYCLE failed: employee with DRAFT KPI was deactivated';
  exception when sqlstate '55000' then null;
  end;
end $$;

-- Foundation close is fail-closed but audit-visible.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000001003","email":"kpi1-manager@example.invalid","role":"authenticated"}', true);
do $$
declare v_result jsonb;
begin
  select public.crm_kpi_close_period_foundation(
    (select id from public.kpi_periods where period_month='2098-08-01'),
    (select version from public.kpi_periods where period_month='2098-08-01')
  ) into v_result;
  if coalesce((v_result->>'closed')::boolean, true) then
    raise exception 'CLOSE failed: foundation falsely closed a period';
  end if;
  if not exists (
    select 1 from public.audit_logs
    where action='period_close_attempt'
      and entity_id=(select id::text from public.kpi_periods where period_month='2098-08-01')
  ) then raise exception 'AUDIT failed: close attempt missing'; end if;
end $$;

-- Prepare a CLOSED fixture as the SQL owner; Manager cannot reopen, Admin can.
reset role;
select set_config('crm.kpi_write', 'on', true);
update public.kpi_periods
set status='CLOSED', closed_by_user_id='kpi1-admin', closed_at=now(), version=version+1
where period_month='2098-08-01';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000001003","email":"kpi1-manager@example.invalid","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.crm_kpi_reopen_period(
      (select id from public.kpi_periods where period_month='2098-08-01'),
      (select version from public.kpi_periods where period_month='2098-08-01'),
      'Manager must not reopen');
    raise exception 'ROLE failed: manager reopened CLOSED period';
  exception when sqlstate '42501' then null;
  end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000001002","email":"kpi1-admin@example.invalid","role":"authenticated"}', true);
select public.crm_kpi_reopen_period(
  (select id from public.kpi_periods where period_month='2098-08-01'),
  (select version from public.kpi_periods where period_month='2098-08-01'),
  'Correction workflow fixture'
);

-- Direct authenticated writes and anonymous execution are forbidden.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000001003","email":"kpi1-manager@example.invalid","role":"authenticated"}', true);
do $$
begin
  begin
    update public.kpi_periods set status='CLOSED' where period_month='2098-09-01';
    raise exception 'DIRECT WRITE failed: authenticated UPDATE succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$
begin
  if has_table_privilege('authenticated', 'public.kpi_periods', 'insert')
     or has_table_privilege('authenticated', 'public.kpi_assignments', 'update') then
    raise exception 'ACL failed: authenticated has direct KPI write';
  end if;
  if has_function_privilege('anon', 'public.crm_kpi_create_period(date,text,text)', 'execute')
     or has_function_privilege('anon', 'public.crm_kpi_assign_employee(uuid,uuid,text,numeric,integer)', 'execute') then
    raise exception 'ACL failed: anonymous can execute KPI RPC';
  end if;
  if not exists(select 1 from public.audit_logs where action='period_create')
     or not exists(select 1 from public.audit_logs where action='definition_update')
     or not exists(select 1 from public.audit_logs where action='assignment_bulk_create')
     or not exists(select 1 from public.audit_logs where action='period_reopen') then
    raise exception 'AUDIT failed: required KPI actions missing';
  end if;
end $$;

rollback;
