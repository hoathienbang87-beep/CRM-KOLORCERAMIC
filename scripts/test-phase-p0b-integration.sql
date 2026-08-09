-- P0-B integration harness. Run only on staging after P0-A and P0-B.
-- The outer transaction rolls back every fixture and test mutation.

begin;

insert into public.app_users(id, email, name, role, active, lifecycle_status)
values
  ('p0b-admin', 'p0b-admin@example.invalid', 'P0B Admin', 'admin', true, 'active'),
  ('p0b-manager', 'p0b-manager@example.invalid', 'P0B Manager', 'manager', true, 'active'),
  ('p0b-sale-a', 'p0b-sale-a@example.invalid', 'P0B Sale A', 'sale', true, 'active'),
  ('p0b-sale-b', 'p0b-sale-b@example.invalid', 'P0B Sale B', 'sale', true, 'active');

-- Sale A creates a customer. Creation, assignment and audit are atomic.
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"p0b-sale-a@example.invalid","role":"authenticated"}', true);
select public.crm_create_customer(jsonb_build_object(
  'id', 'p0b-customer', 'name', 'P0B Customer',
  'phoneRaw', '0911000001', 'phoneNormalized', '0911000001',
  'nextCareDate', (current_date + 1)::text
));

do $$
begin
  if not exists (
    select 1 from public.customer_assignments
    where customer_id = 'p0b-customer' and employee_id = 'p0b-sale-a' and is_current
  ) then raise exception 'CREATE failed: current assignment missing'; end if;
  if not exists (
    select 1 from public.customers
    where id = 'p0b-customer' and owner_user_id = 'p0b-sale-a'
      and created_by_user_id = 'p0b-sale-a'
  ) then raise exception 'CREATE failed: customer cache/history incorrect'; end if;
end $$;

-- Direct assignment and owner-cache mutation are forbidden.
do $$
begin
  begin
    execute $sql$insert into public.customer_assignments(customer_id, employee_id, is_current)
      values ('p0b-customer', 'p0b-sale-b', true)$sql$;
    raise exception 'DIRECT ASSIGN failed: insert unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
  begin
    execute $sql$update public.customers set owner_user_id = 'p0b-sale-b' where id = 'p0b-customer'$sql$;
    raise exception 'DIRECT OWNER failed: update unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
end $$;

reset role;

-- Manager unassigns. Follow-up remains and Sale A immediately loses access.
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"p0b-manager@example.invalid","role":"authenticated"}', true);
select public.crm_unassign_customer('p0b-customer', 'Sale A nghỉ phép');

do $$
begin
  if exists(select 1 from public.customer_assignments where customer_id='p0b-customer' and is_current) then
    raise exception 'UNASSIGN failed: current assignment survived';
  end if;
  if not exists(select 1 from public.customer_assignments where customer_id='p0b-customer' and employee_id='p0b-sale-a' and not is_current and ended_at is not null) then
    raise exception 'UNASSIGN failed: history missing';
  end if;
  if not exists(select 1 from public.customers where id='p0b-customer' and owner_user_id is null and owner_email is null and next_care_date is not null) then
    raise exception 'UNASSIGN failed: cache/follow-up incorrect';
  end if;
end $$;

select set_config('request.jwt.claims', '{"email":"p0b-sale-a@example.invalid","role":"authenticated"}', true);
do $$ begin
  if exists(select 1 from public.customers where id='p0b-customer') then
    raise exception 'UNASSIGN RLS failed: Sale A still sees customer';
  end if;
end $$;

-- Manager assigns Sale B. created_by and created_at do not change.
select set_config('request.jwt.claims', '{"email":"p0b-manager@example.invalid","role":"authenticated"}', true);
select public.crm_assign_customer('p0b-customer', 'p0b-sale-b', 'Phân công lại sau nghỉ phép');

do $$
declare v_created_at timestamptz;
begin
  select created_at into v_created_at from public.customers where id='p0b-customer';
  if not exists(select 1 from public.customers where id='p0b-customer'
    and owner_user_id='p0b-sale-b' and created_by_user_id='p0b-sale-a') then
    raise exception 'REASSIGN failed: owner/creator incorrect';
  end if;
  if (select count(*) from public.customer_assignments where customer_id='p0b-customer' and is_current) <> 1 then
    raise exception 'REASSIGN failed: current assignment count is not one';
  end if;
  if v_created_at is null then raise exception 'REASSIGN failed: created_at missing'; end if;
end $$;

select set_config('request.jwt.claims', '{"email":"p0b-sale-b@example.invalid","role":"authenticated"}', true);
do $$ begin
  if not exists(select 1 from public.customers where id='p0b-customer') then
    raise exception 'REASSIGN RLS failed: Sale B cannot see customer';
  end if;
end $$;

-- Deactivation defaults to UNASSIGNED and preserves open follow-up/history.
select set_config('request.jwt.claims', '{"email":"p0b-admin@example.invalid","role":"authenticated"}', true);
select public.crm_deactivate_employee('p0b-sale-b', 'unassigned', null, 'Nhân viên nghỉ việc');

do $$
begin
  if not exists(select 1 from public.app_users where id='p0b-sale-b' and not active and lifecycle_status='inactive') then
    raise exception 'DEACTIVATE failed: lifecycle not inactive';
  end if;
  if exists(select 1 from public.customer_assignments where customer_id='p0b-customer' and is_current) then
    raise exception 'DEACTIVATE failed: customer still assigned';
  end if;
  if not exists(select 1 from public.customers where id='p0b-customer' and owner_user_id is null and next_care_date is not null) then
    raise exception 'DEACTIVATE failed: follow-up/cache lost';
  end if;
end $$;

-- Reactivation never reclaims old customers.
select public.crm_reactivate_employee('p0b-sale-b', 'Nhân viên quay lại');
do $$ begin
  if exists(select 1 from public.customer_assignments where customer_id='p0b-customer' and is_current) then
    raise exception 'REACTIVATE failed: customer was silently reclaimed';
  end if;
end $$;

-- Bulk assignment is all-or-nothing. A missing customer rolls back prior rows.
select set_config('request.jwt.claims', '{"email":"p0b-manager@example.invalid","role":"authenticated"}', true);
select public.crm_create_customer(jsonb_build_object('id','p0b-bulk-1','name','Bulk One'));
select public.crm_create_customer(jsonb_build_object('id','p0b-bulk-2','name','Bulk Two'));
do $$
begin
  begin
    perform public.crm_bulk_assign_customers(
      array['p0b-bulk-1','p0b-does-not-exist','p0b-bulk-2'],
      'p0b-sale-a',
      'Bulk rollback test'
    );
    raise exception 'BULK failed: missing customer did not fail';
  exception when sqlstate 'P0002' then null;
  end;
  if exists(select 1 from public.customer_assignments where customer_id in ('p0b-bulk-1','p0b-bulk-2') and is_current) then
    raise exception 'BULK failed: partial assignment survived';
  end if;
end $$;

-- Sanitized representation of the 22 production anomalies: historical owner
-- snapshot is allowed without a fake employee and can never be current.
reset role;
select set_config('crm.allow_assignment_write', 'on', true);
insert into public.customer_assignments(
  id, customer_id, employee_id, employee_email_snapshot, employee_name_snapshot,
  assigned_at, ended_at, assignment_reason, end_reason, is_current
)
values (
  'p0b-legacy-history', 'p0b-bulk-1', null, 'former-sale@example.invalid',
  'Former Sale', now() - interval '100 days', now() - interval '1 day',
  'Sanitized legacy migration fixture', 'Employee missing from app_users', false
);
do $$ begin
  if not exists(select 1 from public.customer_assignments where id='p0b-legacy-history'
    and employee_id is null and not is_current and employee_email_snapshot='former-sale@example.invalid') then
    raise exception 'LEGACY failed: historical snapshot missing';
  end if;
end $$;

-- ACL and catalog contracts.
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.crm_assign_customer(text,text,text)', 'execute') then
    raise exception 'ACL failed: anon can execute assignment RPC';
  end if;
  if has_table_privilege('authenticated', 'public.customer_assignments', 'insert') then
    raise exception 'ACL failed: authenticated has direct assignment insert';
  end if;
  if not exists (
    select 1 from pg_indexes where schemaname='public'
      and tablename='customer_assignments'
      and indexname='customer_assignments_one_current_idx'
      and indexdef ilike '%where is_current%'
  ) then raise exception 'CONCURRENCY failed: unique current index missing'; end if;
end $$;

rollback;
