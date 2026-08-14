-- P0-A integration harness. Run only on a disposable/staging Supabase database
-- after applying supabase-phase-p0a-transaction-ownership.sql.
-- The entire harness is rolled back and leaves no test rows.

begin;

insert into public.app_users(id, supabase_auth_id, email, name, role, active, lifecycle_status)
values
  ('p0a-admin', '00000000-0000-4000-8000-00000000a001', 'p0a-admin@example.invalid', 'P0A Admin', 'admin', true, 'active'),
  ('p0a-manager', '00000000-0000-4000-8000-00000000a002', 'p0a-manager@example.invalid', 'P0A Manager', 'manager', true, 'active'),
  ('p0a-sale-a', '00000000-0000-4000-8000-00000000a003', 'p0a-sale-a@example.invalid', 'P0A Sale A', 'sale', true, 'active'),
  ('p0a-sale-b', '00000000-0000-4000-8000-00000000a004', 'p0a-sale-b@example.invalid', 'P0A Sale B', 'sale', true, 'active');

-- CASE 1 + CASE 3: Sale A creates and owns the customer. The RPC also writes
-- phone_index and audit_logs in the same PostgreSQL transaction.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a003","email":"p0a-sale-a@example.invalid","role":"authenticated"}', true);
select public.crm_create_customer(jsonb_build_object(
  'id', 'p0a-customer', 'name', 'P0A Customer',
  'phoneRaw', '0900000001', 'phoneNormalized', '0900000001',
  'channel', 'P0A Test', 'status', 'Lead mới'
));

select public.crm_add_care_log(
  'p0a-customer',
  jsonb_build_object(
    'id', 'p0a-care-log',
    'note', 'P0A care',
    'careChannel', 'Phone',
    'careResult', 'Hen lai'
  ),
  jsonb_build_object('follow', 'Dang cham')
);

select public.crm_save_basic_purchase(
  'create',
  'p0a-customer',
  'p0a-basic-purchase',
  jsonb_build_object('dealStatus', 'Da coc', 'amount', 1000000, 'note', 'P0A purchase'),
  '{}'::jsonb
);

do $$
begin
  if not exists(select 1 from public.customers where id = 'p0a-customer' and owner_user_id = 'p0a-sale-a') then
    raise exception 'CASE 1 failed: customer/owner missing';
  end if;
  if not exists(select 1 from public.phone_index where customer_id = 'p0a-customer') then
    raise exception 'CASE 1 failed: phone index missing';
  end if;
  if not exists(select 1 from public.audit_logs where entity_id = 'p0a-customer' and action = 'addCustomer') then
    raise exception 'CASE 1 failed: audit missing';
  end if;
  if not exists(select 1 from public.care_logs where id = 'p0a-care-log' and customer_id = 'p0a-customer') then
    raise exception 'CASE 1 failed: care log missing';
  end if;
  if not exists(select 1 from public.deals where id = 'p0a-basic-purchase' and customer_id = 'p0a-customer') then
    raise exception 'CASE 1 failed: basic purchase missing';
  end if;
end $$;

-- CASE 5: the current owner cannot change ownership through a direct UPDATE.
do $$
begin
  begin
    update public.customers
    set owner_user_id = 'p0a-sale-b', owner_email = 'p0a-sale-b@example.invalid'
    where id = 'p0a-customer';
    raise exception 'CASE 5 failed: direct owner update unexpectedly succeeded';
  exception
    when sqlstate '42501' then null;
  end;
end $$;

reset role;

-- CASE 2: force the mandatory audit write to fail. The customer and phone
-- index inserts must roll back with the failed RPC statement.
create or replace function public.p0a_force_audit_failure()
returns trigger language plpgsql as $$
begin
  if new.entity_id = 'p0a-rollback' then
    raise exception 'P0A forced audit failure';
  end if;
  return new;
end $$;
create trigger p0a_force_audit_failure
before insert on public.audit_logs
for each row execute function public.p0a_force_audit_failure();

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a003","email":"p0a-sale-a@example.invalid","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.crm_create_customer(jsonb_build_object(
      'id', 'p0a-rollback', 'name', 'Must Roll Back',
      'phoneRaw', '0900000002', 'phoneNormalized', '0900000002'
    ));
    raise exception 'CASE 2 failed: forced fault did not fire';
  exception
    when others then
      if sqlerrm = 'CASE 2 failed: forced fault did not fire' then raise; end if;
  end;
  if exists(select 1 from public.customers where id = 'p0a-rollback')
     or exists(select 1 from public.phone_index where customer_id = 'p0a-rollback') then
    raise exception 'CASE 2 failed: partial data survived';
  end if;
end $$;
reset role;
drop trigger p0a_force_audit_failure on public.audit_logs;
drop function public.p0a_force_audit_failure();

-- CASE 4: manager transfers A -> B atomically.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a002","email":"p0a-manager@example.invalid","role":"authenticated"}', true);
select public.crm_transfer_customer('p0a-customer', 'p0a-sale-b@example.invalid', '{}'::jsonb);
do $$
begin
  if not exists(select 1 from public.customers where id = 'p0a-customer'
    and owner_user_id = 'p0a-sale-b' and created_by_user_id = 'p0a-sale-a') then
    raise exception 'CASE 4 failed: owner/history is incorrect';
  end if;
  if not exists(select 1 from public.audit_logs where entity_id = 'p0a-customer'
    and action = 'assignCustomer' and raw_data->>'oldEmployeeId' = 'p0a-sale-a'
    and raw_data->>'newEmployeeId' = 'p0a-sale-b') then
    raise exception 'CASE 4 failed: transfer audit is incorrect';
  end if;
end $$;

-- Manager retains visibility.
do $$ begin
  if (select count(*) from public.customers where id = 'p0a-customer') <> 1 then
    raise exception 'CASE 4 failed: manager cannot read customer';
  end if;
end $$;

-- Admin also retains visibility.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a001","email":"p0a-admin@example.invalid","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.customers where id = 'p0a-customer') <> 1 then
    raise exception 'CASE 4 failed: admin cannot read customer';
  end if;
end $$;

-- Sale A loses visibility; Sale B gains it.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a003","email":"p0a-sale-a@example.invalid","role":"authenticated"}', true);
do $$ begin
  if exists(select 1 from public.customers where id = 'p0a-customer') then
    raise exception 'CASE 4 failed: Sale A retained access';
  end if;
  if exists(select 1 from public.care_logs where id = 'p0a-care-log') then
    raise exception 'CASE 4 failed: Sale A retained care log access';
  end if;
  if exists(select 1 from public.deals where id = 'p0a-basic-purchase') then
    raise exception 'CASE 4 failed: Sale A retained basic purchase access';
  end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a004","email":"p0a-sale-b@example.invalid","role":"authenticated"}', true);
do $$ begin
  if not exists(select 1 from public.customers where id = 'p0a-customer') then
    raise exception 'CASE 4 failed: Sale B lacks access';
  end if;
  if not exists(select 1 from public.care_logs where id = 'p0a-care-log') then
    raise exception 'CASE 4 failed: Sale B lacks care log access';
  end if;
  if not exists(select 1 from public.deals where id = 'p0a-basic-purchase') then
    raise exception 'CASE 4 failed: Sale B lacks basic purchase access';
  end if;
end $$;

-- CASE 6: anon has no EXECUTE privilege. Check the ACL as database owner so
-- the test does not depend on whether the anon role may execute a DO block.
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.crm_create_customer(jsonb)', 'execute') then
    raise exception 'CASE 6 failed: anon has EXECUTE privilege';
  end if;
end $$;

-- Settings persistence regression: partial writes must leave data/raw_data in
-- sync. This row is also removed by the outer rollback.
insert into public.settings(id, data, raw_data)
values ('p0a-settings', '{"channels":["A"]}'::jsonb, '{}'::jsonb);
update public.settings
set data = '{"statuses":["Lead"]}'::jsonb
where id = 'p0a-settings';
do $$
begin
  if exists(
    select 1 from public.settings
    where id = 'p0a-settings' and data is distinct from raw_data
  ) then
    raise exception 'SETTINGS regression failed: data/raw_data drifted';
  end if;
end $$;

reset role;
rollback;
