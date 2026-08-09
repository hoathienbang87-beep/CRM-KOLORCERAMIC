-- CRM-KOLORCERAMIC - Phase P0-A
-- Atomic CRM writes and owner-only customer access.
--
-- Dependencies:
--   1. supabase-phase-1-security-foundation.sql
--   2. supabase-phase-f-crm-rls-cleanup.sql
--
-- This migration is additive and does not delete business data.

begin;

-- ---------------------------------------------------------------------------
-- 1. Stable employee references for current ownership and creation history
-- ---------------------------------------------------------------------------

alter table public.customers add column if not exists owner_user_id text;
alter table public.customers add column if not exists created_by_user_id text;

update public.customers c
set owner_user_id = u.id
from public.app_users u
where c.owner_user_id is null
  and lower(coalesce(c.owner_email, '')) = lower(coalesce(u.email, ''));

update public.customers c
set created_by_user_id = u.id
from public.app_users u
where c.created_by_user_id is null
  and lower(coalesce(c.created_by_email, '')) = lower(coalesce(u.email, ''));

-- owner_user_id is intentionally nullable. Phase P0-B introduces
-- customer_assignments and migrates unknown/inactive legacy owners into the
-- unassigned pool without inventing a replacement employee.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'customers_owner_user_id_fkey'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
      add constraint customers_owner_user_id_fkey
      foreign key (owner_user_id) references public.app_users(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'customers_created_by_user_id_fkey'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
      add constraint customers_created_by_user_id_fkey
      foreign key (created_by_user_id) references public.app_users(id) on delete restrict;
  end if;
end $$;

create index if not exists customers_owner_user_id_idx
  on public.customers(owner_user_id)
  where coalesce(is_deleted, false) = false;

create index if not exists customers_created_by_user_id_idx
  on public.customers(created_by_user_id);

-- Existing production data may already contain duplicates, so this phase does
-- not force a unique index that could abort deployment. The RPCs serialize by
-- normalized phone with an advisory transaction lock. A later cleanup can add
-- a unique partial index after duplicate review.

-- ---------------------------------------------------------------------------
-- 2. Internal helpers
-- ---------------------------------------------------------------------------

create or replace function public.crm_current_app_user_id()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select id
  from public.app_users
  where lower(coalesce(email, '')) = public.crm_current_email()
    and coalesce(active, false) = true
  limit 1;
$$;

create or replace function public.crm_json_timestamptz(p_value text)
returns timestamptz
language plpgsql
immutable
as $$
begin
  if nullif(trim(coalesce(p_value, '')), '') is null then
    return null;
  end if;
  return p_value::timestamptz;
exception when others then
  raise exception using errcode = '22007', message = 'Ngày giờ không hợp lệ.';
end;
$$;

create or replace function public.crm_write_audit(
  p_action text,
  p_entity text,
  p_entity_id text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs(id, action, entity, entity_id, email, payload_json, raw_data, created_at)
  values (
    gen_random_uuid()::text,
    p_action,
    p_entity,
    p_entity_id,
    public.crm_current_email(),
    coalesce(p_payload, '{}'::jsonb)::text,
    coalesce(p_payload, '{}'::jsonb),
    now()
  );
end;
$$;

revoke all on function public.crm_write_audit(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.crm_json_timestamptz(text) from public, anon, authenticated;
revoke all on function public.crm_current_app_user_id() from public, anon;
grant execute on function public.crm_current_app_user_id() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Owner access no longer inherits from created_by
-- ---------------------------------------------------------------------------

create or replace function public.crm_can_access_customer_id(p_customer_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.crm_is_manager()
    or exists (
      select 1
      from public.customers c
      where c.id = p_customer_id
        and c.owner_user_id = public.crm_current_app_user_id()
    );
$$;

revoke all on function public.crm_can_access_customer_id(text) from public, anon;
grant execute on function public.crm_can_access_customer_id(text) to authenticated;

create or replace function public.crm_guard_customer_owner_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.owner_user_id is distinct from new.owner_user_id
     or lower(coalesce(old.owner_email, '')) is distinct from lower(coalesce(new.owner_email, ''))
     or coalesce(old.owner, '') is distinct from coalesce(new.owner, '') then
    if coalesce(current_setting('crm.allow_owner_transfer', true), '') <> 'on'
       and coalesce(auth.role(), '') <> 'service_role' then
      raise exception using
        errcode = '42501',
        message = 'Không được đổi nhân viên phụ trách trực tiếp. Hãy dùng RPC crm_transfer_customer.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.crm_guard_customer_owner_change() from public, anon, authenticated;

drop trigger if exists customers_guard_owner_change on public.customers;
create trigger customers_guard_owner_change
before update on public.customers
for each row execute function public.crm_guard_customer_owner_change();

-- PostgreSQL combines permissive policies with OR. Remove every legacy
-- business policy on ownership-scoped tables before recreating the canonical
-- owner policies below. Explicit admin policies are preserved.
do $$
declare
  v_policy record;
begin
  for v_policy in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('customers', 'care_logs', 'deals')
      and lower(policyname) not like '%admin%'
  loop
    execute format('drop policy if exists %I on public.%I', v_policy.policyname, v_policy.tablename);
  end loop;
end $$;

drop policy if exists "customers manager or owner read" on public.customers;
drop policy if exists "customers manager or current owner read" on public.customers;
create policy "customers manager or current owner read" on public.customers
for select to authenticated
using (
  public.crm_is_active_user()
  and (public.crm_is_manager() or owner_user_id = public.crm_current_app_user_id())
);

drop policy if exists "customers manager or owner insert" on public.customers;
drop policy if exists "customers manager or current owner insert" on public.customers;
create policy "customers manager or current owner insert" on public.customers
for insert to authenticated
with check (
  public.crm_is_active_user()
  and (public.crm_is_manager() or owner_user_id = public.crm_current_app_user_id())
);

drop policy if exists "customers manager or owner update" on public.customers;
drop policy if exists "customers manager or current owner update" on public.customers;
create policy "customers manager or current owner update" on public.customers
for update to authenticated
using (
  public.crm_is_active_user()
  and (public.crm_is_manager() or owner_user_id = public.crm_current_app_user_id())
)
with check (
  public.crm_is_active_user()
  and (public.crm_is_manager() or owner_user_id = public.crm_current_app_user_id())
);

-- Related history follows current customer access. Snapshot owner fields remain
-- history only and no longer grant access after a transfer.
drop policy if exists "care logs manager or owner read" on public.care_logs;
drop policy if exists "care logs customer access read" on public.care_logs;
create policy "care logs customer access read" on public.care_logs
for select to authenticated
using (public.crm_is_active_user() and public.crm_can_access_customer_id(customer_id));

drop policy if exists "care logs manager or owner insert" on public.care_logs;
drop policy if exists "care logs customer access insert" on public.care_logs;
create policy "care logs customer access insert" on public.care_logs
for insert to authenticated
with check (public.crm_is_active_user() and public.crm_can_access_customer_id(customer_id));

drop policy if exists "deals manager or owner read" on public.deals;
drop policy if exists "basic purchases customer access read" on public.deals;
create policy "basic purchases customer access read" on public.deals
for select to authenticated
using (public.crm_is_active_user() and public.crm_can_access_customer_id(customer_id));

drop policy if exists "deals manager or owner insert" on public.deals;
drop policy if exists "basic purchases customer access insert" on public.deals;
create policy "basic purchases customer access insert" on public.deals
for insert to authenticated
with check (public.crm_is_active_user() and public.crm_can_access_customer_id(customer_id));

drop policy if exists "deals manager or owner update" on public.deals;
drop policy if exists "basic purchases customer access update" on public.deals;
create policy "basic purchases customer access update" on public.deals
for update to authenticated
using (public.crm_is_active_user() and public.crm_can_access_customer_id(customer_id))
with check (public.crm_is_active_user() and public.crm_can_access_customer_id(customer_id));

-- ---------------------------------------------------------------------------
-- 4. Atomic customer creation
-- ---------------------------------------------------------------------------

create or replace function public.crm_create_customer(p_customer jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id text := public.crm_current_app_user_id();
  v_actor_email text := public.crm_current_email();
  v_customer_id text := coalesce(nullif(p_customer->>'id', ''), gen_random_uuid()::text);
  v_owner public.app_users%rowtype;
  v_phone text := nullif(regexp_replace(coalesce(p_customer->>'phoneNormalized', ''), '[^0-9]', '', 'g'), '');
  v_duplicate_id text;
  v_raw jsonb;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'Tài khoản CRM không hoạt động.';
  end if;
  if nullif(trim(coalesce(p_customer->>'name', '')), '') is null then
    raise exception using errcode = '22023', message = 'Tên khách hàng là bắt buộc.';
  end if;

  if public.crm_is_manager() then
    select * into v_owner from public.app_users
    where lower(email) = lower(coalesce(p_customer->>'ownerEmail', v_actor_email))
      and coalesce(active, false) = true
      and lower(coalesce(role, 'sale')) not in ('admin', 'owner')
    limit 1;
  else
    select * into v_owner from public.app_users where id = v_actor_id;
  end if;
  if v_owner.id is null then
    raise exception using errcode = '22023', message = 'Nhân viên phụ trách không hợp lệ hoặc đã bị khóa.';
  end if;

  if v_phone is not null then
    perform pg_advisory_xact_lock(hashtext('crm_phone:' || v_phone));
    select id into v_duplicate_id
    from public.customers
    where phone_normalized = v_phone
      and coalesce(is_deleted, false) = false
    limit 1;
    if v_duplicate_id is not null then
      raise exception using errcode = '23505', message = 'CRM_DUPLICATE_PHONE:' || v_duplicate_id;
    end if;
  end if;

  v_raw := coalesce(p_customer, '{}'::jsonb) || jsonb_build_object(
    'id', v_customer_id,
    'owner', coalesce(v_owner.name, v_owner.email),
    'ownerEmail', v_owner.email,
    'ownerUserId', v_owner.id,
    'createdByEmail', v_actor_email,
    'createdByUserId', v_actor_id,
    'updatedByEmail', v_actor_email,
    'createdAt', coalesce(p_customer->>'createdAt', now()::text),
    'updatedAt', now()
  );

  insert into public.customers(
    id, name, company_name, phone_raw, phone_normalized, no_phone, address, channel,
    owner, owner_email, owner_user_id, created_by_email, created_by_user_id,
    status, follow, next_care_date, last_contact_at, note, need, is_deleted,
    raw_data, created_at, updated_at
  ) values (
    v_customer_id, p_customer->>'name', nullif(p_customer->>'companyName', ''),
    nullif(p_customer->>'phoneRaw', ''), v_phone, coalesce((p_customer->>'noPhone')::boolean, v_phone is null),
    nullif(p_customer->>'address', ''), nullif(p_customer->>'channel', ''),
    coalesce(v_owner.name, v_owner.email), v_owner.email, v_owner.id,
    v_actor_email, v_actor_id, nullif(p_customer->>'status', ''), nullif(p_customer->>'follow', ''),
    public.crm_json_timestamptz(p_customer->>'nextCareDate'), null,
    nullif(p_customer->>'note', ''), nullif(p_customer->>'need', ''), false,
    v_raw, coalesce(public.crm_json_timestamptz(p_customer->>'createdAt'), now()), now()
  );

  if v_phone is not null then
    insert into public.phone_index(phone, customer_id, owner, owner_email, raw_data)
    values (v_phone, v_customer_id, coalesce(v_owner.name, v_owner.email), v_owner.email,
      jsonb_build_object('customerId', v_customer_id, 'owner', coalesce(v_owner.name, v_owner.email), 'ownerEmail', v_owner.email))
    on conflict (phone) do update set
      customer_id = excluded.customer_id,
      owner = excluded.owner,
      owner_email = excluded.owner_email,
      raw_data = excluded.raw_data;
  end if;

  perform public.crm_write_audit('addCustomer', 'customers', v_customer_id, v_raw);
  return jsonb_build_object('id', v_customer_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Atomic profile update and audited transfer
-- ---------------------------------------------------------------------------

create or replace function public.crm_update_customer_profile(p_customer_id text, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id text := public.crm_current_app_user_id();
  v_actor_email text := public.crm_current_email();
  v_old public.customers%rowtype;
  v_phone text;
  v_duplicate_id text;
begin
  select * into v_old from public.customers where id = p_customer_id for update;
  if v_old.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy khách hàng.'; end if;
  if v_actor_id is null or not (public.crm_is_manager() or v_old.owner_user_id = v_actor_id) then
    raise exception using errcode = '42501', message = 'Bạn không có quyền sửa khách hàng này.';
  end if;
  if p_changes ? 'ownerEmail' or p_changes ? 'owner' or p_changes ? 'ownerUserId' then
    raise exception using errcode = '42501', message = 'Đổi người phụ trách phải dùng RPC crm_transfer_customer.';
  end if;

  v_phone := nullif(regexp_replace(coalesce(p_changes->>'phoneNormalized', v_old.phone_normalized, ''), '[^0-9]', '', 'g'), '');
  if v_phone is distinct from v_old.phone_normalized and v_phone is not null then
    perform pg_advisory_xact_lock(hashtext('crm_phone:' || v_phone));
    select id into v_duplicate_id from public.customers
    where phone_normalized = v_phone and id <> p_customer_id and coalesce(is_deleted, false) = false limit 1;
    if v_duplicate_id is not null then
      raise exception using errcode = '23505', message = 'CRM_DUPLICATE_PHONE:' || v_duplicate_id;
    end if;
  end if;

  update public.customers set
    name = coalesce(nullif(p_changes->>'name', ''), name),
    company_name = case when p_changes ? 'companyName' then nullif(p_changes->>'companyName', '') else company_name end,
    phone_raw = case when p_changes ? 'phoneRaw' then nullif(p_changes->>'phoneRaw', '') else phone_raw end,
    phone_normalized = v_phone,
    no_phone = coalesce((p_changes->>'noPhone')::boolean, v_phone is null),
    address = case when p_changes ? 'address' then nullif(p_changes->>'address', '') else address end,
    channel = coalesce(nullif(p_changes->>'channel', ''), channel),
    status = coalesce(nullif(p_changes->>'status', ''), status),
    follow = coalesce(nullif(p_changes->>'follow', ''), follow),
    next_care_date = case when p_changes ? 'nextCareDate' then public.crm_json_timestamptz(p_changes->>'nextCareDate') else next_care_date end,
    note = case when p_changes ? 'note' then nullif(p_changes->>'note', '') else note end,
    need = case when p_changes ? 'need' then nullif(p_changes->>'need', '') else need end,
    raw_data = coalesce(raw_data, '{}'::jsonb) || coalesce(p_changes, '{}'::jsonb)
      || jsonb_build_object('updatedByEmail', v_actor_email, 'updatedAt', now()),
    created_at = case when public.crm_is_admin() and p_changes ? 'createdAt'
      then coalesce(public.crm_json_timestamptz(p_changes->>'createdAt'), created_at) else created_at end,
    updated_at = now()
  where id = p_customer_id;

  if v_old.phone_normalized is distinct from v_phone and v_old.phone_normalized is not null then
    delete from public.phone_index where phone = v_old.phone_normalized and customer_id = p_customer_id;
  end if;
  if v_phone is not null then
    insert into public.phone_index(phone, customer_id, owner, owner_email, raw_data)
    values (v_phone, p_customer_id, v_old.owner, v_old.owner_email,
      jsonb_build_object('customerId', p_customer_id, 'owner', v_old.owner, 'ownerEmail', v_old.owner_email))
    on conflict (phone) do update set
      customer_id = excluded.customer_id, owner = excluded.owner,
      owner_email = excluded.owner_email, raw_data = excluded.raw_data;
  end if;

  perform public.crm_write_audit('updateCustomerInfo', 'customers', p_customer_id,
    jsonb_build_object('before', to_jsonb(v_old), 'changes', p_changes));
  return jsonb_build_object('id', p_customer_id);
end;
$$;

create or replace function public.crm_transfer_customer(
  p_customer_id text,
  p_new_owner_email text,
  p_profile_changes jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_email text := public.crm_current_email();
  v_old public.customers%rowtype;
  v_new_owner public.app_users%rowtype;
begin
  if not public.crm_is_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin được chuyển khách.';
  end if;
  select * into v_old from public.customers where id = p_customer_id for update;
  if v_old.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy khách hàng.'; end if;

  select * into v_new_owner from public.app_users
  where lower(email) = lower(trim(p_new_owner_email))
    and coalesce(active, false) = true
    and lower(coalesce(role, 'sale')) not in ('admin', 'owner')
  limit 1;
  if v_new_owner.id is null then
    raise exception using errcode = '22023', message = 'Nhân viên mới không hợp lệ hoặc đã bị khóa.';
  end if;

  if coalesce(p_profile_changes, '{}'::jsonb) <> '{}'::jsonb then
    perform public.crm_update_customer_profile(p_customer_id, p_profile_changes - 'owner' - 'ownerEmail' - 'ownerUserId');
  end if;

  perform set_config('crm.allow_owner_transfer', 'on', true);
  update public.customers set
    owner = coalesce(v_new_owner.name, v_new_owner.email),
    owner_email = v_new_owner.email,
    owner_user_id = v_new_owner.id,
    raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
      'owner', coalesce(v_new_owner.name, v_new_owner.email),
      'ownerEmail', v_new_owner.email,
      'ownerUserId', v_new_owner.id,
      'updatedByEmail', v_actor_email,
      'updatedAt', now()
    ),
    updated_at = now()
  where id = p_customer_id;

  update public.phone_index set
    owner = coalesce(v_new_owner.name, v_new_owner.email),
    owner_email = v_new_owner.email,
    raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
      'owner', coalesce(v_new_owner.name, v_new_owner.email), 'ownerEmail', v_new_owner.email)
  where customer_id = p_customer_id;

  perform public.crm_write_audit('transferCustomerOwner', 'customers', p_customer_id,
    jsonb_build_object(
      'customer', coalesce(v_old.name, p_customer_id),
      'oldOwner', v_old.owner,
      'oldOwnerEmail', v_old.owner_email,
      'oldOwnerUserId', v_old.owner_user_id,
      'newOwner', coalesce(v_new_owner.name, v_new_owner.email),
      'newOwnerEmail', v_new_owner.email,
      'newOwnerUserId', v_new_owner.id,
      'actor', v_actor_email,
      'timestamp', now()
    ));
  return jsonb_build_object('id', p_customer_id, 'ownerUserId', v_new_owner.id, 'ownerEmail', v_new_owner.email);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Atomic care/follow-up writes
-- ---------------------------------------------------------------------------

create or replace function public.crm_add_care_log(
  p_customer_id text,
  p_log jsonb,
  p_customer_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_email text := public.crm_current_email();
  v_customer public.customers%rowtype;
  v_log_id text := coalesce(nullif(p_log->>'id', ''), gen_random_uuid()::text);
  v_log jsonb;
begin
  select * into v_customer from public.customers where id = p_customer_id for update;
  if v_customer.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy khách hàng.'; end if;
  if not public.crm_can_access_customer_id(p_customer_id) then
    raise exception using errcode = '42501', message = 'Bạn không có quyền chăm sóc khách hàng này.';
  end if;
  if nullif(trim(coalesce(p_log->>'careChannel', '')), '') is null
     or nullif(trim(coalesce(p_log->>'careResult', '')), '') is null
     or nullif(trim(coalesce(p_log->>'note', '')), '') is null then
    raise exception using errcode = '22023', message = 'Hình thức, kết quả và ghi chú chăm sóc là bắt buộc.';
  end if;

  v_log := coalesce(p_log, '{}'::jsonb) || jsonb_build_object(
    'id', v_log_id, 'customerId', p_customer_id,
    'customerName', v_customer.name, 'phoneNormalized', v_customer.phone_normalized,
    'owner', v_customer.owner, 'ownerEmail', v_customer.owner_email,
    'createdByEmail', v_actor_email, 'createdAt', now()
  );

  insert into public.care_logs(
    id, customer_id, customer_name, phone_normalized, phone_raw, owner, owner_email,
    created_by_email, status, follow, care_channel, care_result, next_care_date,
    note, is_deleted, raw_data, created_at, updated_at
  ) values (
    v_log_id, p_customer_id, v_customer.name, v_customer.phone_normalized, v_customer.phone_raw,
    v_customer.owner, v_customer.owner_email, v_actor_email,
    nullif(p_log->>'status', ''), nullif(p_log->>'follow', ''), p_log->>'careChannel',
    p_log->>'careResult', public.crm_json_timestamptz(p_log->>'nextCareDate'), p_log->>'note',
    false, v_log, now(), now()
  );

  update public.customers set
    status = coalesce(nullif(p_customer_patch->>'status', ''), status),
    follow = coalesce(nullif(p_customer_patch->>'follow', ''), follow),
    next_care_date = case when p_customer_patch ? 'nextCareDate'
      then public.crm_json_timestamptz(p_customer_patch->>'nextCareDate') else next_care_date end,
    last_contact_at = now(),
    note = case when p_customer_patch ? 'note' then nullif(p_customer_patch->>'note', '') else note end,
    need = case when p_customer_patch ? 'need' then nullif(p_customer_patch->>'need', '') else need end,
    company_name = case when p_customer_patch ? 'companyName' then nullif(p_customer_patch->>'companyName', '') else company_name end,
    raw_data = coalesce(raw_data, '{}'::jsonb) || coalesce(p_customer_patch, '{}'::jsonb)
      || jsonb_build_object('lastContactAt', now(), 'updatedByEmail', v_actor_email, 'updatedAt', now()),
    updated_at = now()
  where id = p_customer_id;

  perform public.crm_write_audit('addCareLog', 'careLogs', v_log_id,
    jsonb_build_object('customerId', p_customer_id, 'log', v_log));
  return jsonb_build_object('id', v_log_id, 'customerId', p_customer_id);
end;
$$;

create or replace function public.crm_snooze_customer(
  p_customer_id text,
  p_next_care_date date,
  p_follow text,
  p_days integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.customers%rowtype;
begin
  select * into v_old from public.customers where id = p_customer_id for update;
  if v_old.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy khách hàng.'; end if;
  if not public.crm_can_access_customer_id(p_customer_id) then
    raise exception using errcode = '42501', message = 'Bạn không có quyền dời lịch khách này.';
  end if;
  update public.customers set
    next_care_date = p_next_care_date::timestamptz,
    follow = nullif(p_follow, ''),
    raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
      'nextCareDate', p_next_care_date, 'follow', p_follow,
      'updatedByEmail', public.crm_current_email(), 'updatedAt', now()),
    updated_at = now()
  where id = p_customer_id;
  perform public.crm_write_audit('snoozeTask', 'customers', p_customer_id,
    jsonb_build_object('before', v_old.next_care_date, 'after', p_next_care_date, 'days', p_days));
  return jsonb_build_object('id', p_customer_id, 'nextCareDate', p_next_care_date);
end;
$$;

create or replace function public.crm_update_care_log(
  p_log_id text,
  p_changes jsonb,
  p_customer_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.care_logs%rowtype;
begin
  if not public.crm_is_admin() then
    raise exception using errcode = '42501', message = 'Chỉ owner/admin được sửa lịch sử chăm sóc.';
  end if;
  select * into v_old from public.care_logs where id = p_log_id for update;
  if v_old.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy lịch sử chăm sóc.'; end if;
  perform 1 from public.customers where id = v_old.customer_id for update;

  update public.care_logs set
    status = coalesce(nullif(p_changes->>'status', ''), status),
    follow = coalesce(nullif(p_changes->>'follow', ''), follow),
    care_channel = coalesce(nullif(p_changes->>'careChannel', ''), care_channel),
    care_result = coalesce(nullif(p_changes->>'careResult', ''), care_result),
    next_care_date = case when p_changes ? 'nextCareDate'
      then public.crm_json_timestamptz(p_changes->>'nextCareDate') else next_care_date end,
    note = case when p_changes ? 'note' then nullif(p_changes->>'note', '') else note end,
    raw_data = coalesce(raw_data, '{}'::jsonb) || coalesce(p_changes, '{}'::jsonb)
      || jsonb_build_object('updatedByEmail', public.crm_current_email(), 'updatedAt', now()),
    updated_at = now()
  where id = p_log_id;

  update public.customers set
    status = coalesce(nullif(p_customer_patch->>'status', ''), status),
    follow = coalesce(nullif(p_customer_patch->>'follow', ''), follow),
    next_care_date = case when p_customer_patch ? 'nextCareDate'
      then public.crm_json_timestamptz(p_customer_patch->>'nextCareDate') else next_care_date end,
    last_contact_at = case when p_customer_patch ? 'lastContactAt'
      then public.crm_json_timestamptz(p_customer_patch->>'lastContactAt') else last_contact_at end,
    note = case when p_customer_patch ? 'note' then nullif(p_customer_patch->>'note', '') else note end,
    need = case when p_customer_patch ? 'need' then nullif(p_customer_patch->>'need', '') else need end,
    company_name = case when p_customer_patch ? 'companyName' then nullif(p_customer_patch->>'companyName', '') else company_name end,
    raw_data = coalesce(raw_data, '{}'::jsonb) || coalesce(p_customer_patch, '{}'::jsonb)
      || jsonb_build_object('updatedByEmail', public.crm_current_email(), 'updatedAt', now()),
    updated_at = now()
  where id = v_old.customer_id;

  perform public.crm_write_audit('editCareLog', 'careLogs', p_log_id,
    jsonb_build_object('before', to_jsonb(v_old), 'after', p_changes));
  return jsonb_build_object('id', p_log_id, 'customerId', v_old.customer_id);
end;
$$;

create or replace function public.crm_archive_care_log(
  p_log_id text,
  p_customer_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.care_logs%rowtype;
begin
  if not public.crm_is_admin() then
    raise exception using errcode = '42501', message = 'Chỉ owner/admin được xóa lịch sử chăm sóc.';
  end if;
  select * into v_old from public.care_logs where id = p_log_id for update;
  if v_old.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy lịch sử chăm sóc.'; end if;
  perform 1 from public.customers where id = v_old.customer_id for update;

  update public.care_logs set
    is_deleted = true,
    deleted_at = now(),
    deleted_by_email = public.crm_current_email(),
    raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
      'isDeleted', true, 'deletedAt', now(), 'deletedByEmail', public.crm_current_email(),
      'updatedByEmail', public.crm_current_email(), 'updatedAt', now()),
    updated_at = now()
  where id = p_log_id;

  update public.customers set
    status = coalesce(nullif(p_customer_patch->>'status', ''), status),
    follow = coalesce(nullif(p_customer_patch->>'follow', ''), follow),
    next_care_date = case when p_customer_patch ? 'nextCareDate'
      then public.crm_json_timestamptz(p_customer_patch->>'nextCareDate') else next_care_date end,
    last_contact_at = case when p_customer_patch ? 'lastContactAt'
      then public.crm_json_timestamptz(p_customer_patch->>'lastContactAt') else last_contact_at end,
    raw_data = coalesce(raw_data, '{}'::jsonb) || coalesce(p_customer_patch, '{}'::jsonb)
      || jsonb_build_object('updatedByEmail', public.crm_current_email(), 'updatedAt', now()),
    updated_at = now()
  where id = v_old.customer_id;

  perform public.crm_write_audit('deleteCareLog', 'careLogs', p_log_id, to_jsonb(v_old));
  return jsonb_build_object('id', p_log_id, 'customerId', v_old.customer_id);
end;
$$;

create or replace function public.crm_set_customer_archived(
  p_customer_id text,
  p_archived boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.customers%rowtype;
  v_phone_conflict text;
begin
  if p_archived and not public.crm_is_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin được lưu trữ khách.';
  end if;
  if not p_archived and not public.crm_is_admin() then
    raise exception using errcode = '42501', message = 'Chỉ owner/admin được khôi phục khách.';
  end if;
  select * into v_old from public.customers where id = p_customer_id for update;
  if v_old.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy khách hàng.'; end if;

  if not p_archived and v_old.phone_normalized is not null then
    perform pg_advisory_xact_lock(hashtext('crm_phone:' || v_old.phone_normalized));
    select id into v_phone_conflict from public.customers
    where id <> p_customer_id and phone_normalized = v_old.phone_normalized
      and coalesce(is_deleted, false) = false limit 1;
    if v_phone_conflict is not null then
      raise exception using errcode = '23505', message = 'CRM_DUPLICATE_PHONE:' || v_phone_conflict;
    end if;
  end if;

  update public.customers set
    is_deleted = p_archived,
    deleted_at = case when p_archived then now() else null end,
    deleted_by_email = case when p_archived then public.crm_current_email() else null end,
    raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
      'isDeleted', p_archived,
      case when p_archived then 'deletedAt' else 'restoredAt' end, now(),
      case when p_archived then 'deletedByEmail' else 'restoredByEmail' end, public.crm_current_email(),
      'updatedByEmail', public.crm_current_email(), 'updatedAt', now()),
    updated_at = now()
  where id = p_customer_id;

  if p_archived then
    update public.care_logs set
      is_deleted = true,
      deleted_at = now(),
      deleted_by_email = public.crm_current_email(),
      raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
        'isDeleted', true, 'archivedWithCustomer', true,
        'updatedByEmail', public.crm_current_email(), 'updatedAt', now()),
      updated_at = now()
    where customer_id = p_customer_id and coalesce(is_deleted, false) = false;

    update public.deals set
      is_deleted = true,
      raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
        'isDeleted', true, 'archivedWithCustomer', true,
        'updatedByEmail', public.crm_current_email(), 'updatedAt', now()),
      updated_at = now()
    where customer_id = p_customer_id and coalesce(is_deleted, false) = false;
  else
    update public.care_logs set
      is_deleted = false,
      deleted_at = null,
      deleted_by_email = null,
      raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
        'isDeleted', false, 'archivedWithCustomer', false,
        'updatedByEmail', public.crm_current_email(), 'updatedAt', now()),
      updated_at = now()
    where customer_id = p_customer_id
      and coalesce(raw_data->>'archivedWithCustomer', 'false') = 'true';

    update public.deals set
      is_deleted = false,
      raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
        'isDeleted', false, 'archivedWithCustomer', false,
        'updatedByEmail', public.crm_current_email(), 'updatedAt', now()),
      updated_at = now()
    where customer_id = p_customer_id
      and coalesce(raw_data->>'archivedWithCustomer', 'false') = 'true';
  end if;

  if p_archived then
    delete from public.phone_index where customer_id = p_customer_id;
  elsif v_old.phone_normalized is not null then
    insert into public.phone_index(phone, customer_id, owner, owner_email, raw_data)
    values (v_old.phone_normalized, p_customer_id, v_old.owner, v_old.owner_email,
      jsonb_build_object('customerId', p_customer_id, 'owner', v_old.owner, 'ownerEmail', v_old.owner_email))
    on conflict (phone) do update set customer_id = excluded.customer_id,
      owner = excluded.owner, owner_email = excluded.owner_email, raw_data = excluded.raw_data;
  end if;

  perform public.crm_write_audit(case when p_archived then 'softDeleteCustomer' else 'restoreCustomer' end,
    'customers', p_customer_id, jsonb_build_object('before', to_jsonb(v_old), 'archived', p_archived));
  return jsonb_build_object('id', p_customer_id, 'archived', p_archived);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Atomic basic purchase create/update/status/archive
-- ---------------------------------------------------------------------------

create or replace function public.crm_save_basic_purchase(
  p_action text,
  p_customer_id text,
  p_deal_id text,
  p_deal jsonb,
  p_customer_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := lower(trim(coalesce(p_action, 'create')));
  v_actor text := public.crm_current_email();
  v_customer public.customers%rowtype;
  v_old public.deals%rowtype;
  v_id text := coalesce(nullif(p_deal_id, ''), nullif(p_deal->>'id', ''), gen_random_uuid()::text);
  v_raw jsonb;
begin
  select * into v_customer from public.customers where id = p_customer_id for update;
  if v_customer.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy khách hàng.'; end if;
  if not public.crm_can_access_customer_id(p_customer_id) then
    raise exception using errcode = '42501', message = 'Bạn không có quyền ghi nhận mua căn bản cho khách này.';
  end if;
  if v_action not in ('create', 'update', 'complete', 'cancel', 'archive') then
    raise exception using errcode = '22023', message = 'Hành động mua căn bản không hợp lệ.';
  end if;
  if v_action in ('update', 'complete', 'cancel', 'archive') then
    select * into v_old from public.deals where id = v_id and customer_id = p_customer_id for update;
    if v_old.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy dữ liệu mua căn bản.'; end if;
  end if;
  if v_action = 'archive' and not public.crm_is_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin được xóa mềm mua căn bản.';
  end if;

  v_raw := coalesce(v_old.raw_data, '{}'::jsonb) || coalesce(p_deal, '{}'::jsonb)
    || jsonb_build_object('id', v_id, 'customerId', p_customer_id,
      'owner', v_customer.owner, 'ownerEmail', v_customer.owner_email,
      'updatedByEmail', v_actor, 'updatedAt', now());

  if v_action = 'create' then
    v_raw := v_raw || jsonb_build_object('createdByEmail', v_actor, 'createdAt', now());
    insert into public.deals(
      id, customer_id, customer_name, phone_normalized, phone_raw, owner, owner_email,
      deal_status, product, items_text, amount, revenue, completed, completed_at,
      canceled, canceled_at, note, is_deleted, raw_data, created_at, updated_at
    ) values (
      v_id, p_customer_id, v_customer.name, v_customer.phone_normalized, v_customer.phone_raw,
      v_customer.owner, v_customer.owner_email, nullif(p_deal->>'dealStatus', ''),
      nullif(p_deal->>'product', ''), nullif(p_deal->>'itemsText', ''),
      coalesce((p_deal->>'amount')::numeric, 0), coalesce((p_deal->>'revenue')::numeric, (p_deal->>'amount')::numeric, 0),
      coalesce((p_deal->>'completed')::boolean, false), public.crm_json_timestamptz(p_deal->>'completedAt'),
      coalesce((p_deal->>'canceled')::boolean, false), public.crm_json_timestamptz(p_deal->>'canceledAt'),
      nullif(p_deal->>'note', ''), false, v_raw, now(), now()
    );
  else
    update public.deals set
      deal_status = case when v_action = 'complete' then coalesce(nullif(p_deal->>'dealStatus', ''), 'Đã mua')
        when v_action = 'cancel' then coalesce(nullif(p_deal->>'dealStatus', ''), 'Đã hủy')
        else coalesce(nullif(p_deal->>'dealStatus', ''), deal_status) end,
      product = case when p_deal ? 'product' then nullif(p_deal->>'product', '') else product end,
      items_text = case when p_deal ? 'itemsText' then nullif(p_deal->>'itemsText', '') else items_text end,
      amount = case when p_deal ? 'amount' then coalesce((p_deal->>'amount')::numeric, 0) else amount end,
      revenue = case when p_deal ? 'revenue' then coalesce((p_deal->>'revenue')::numeric, 0) else revenue end,
      completed = case when v_action = 'complete' then true when v_action = 'cancel' then false
        else coalesce((p_deal->>'completed')::boolean, completed) end,
      completed_at = case when v_action = 'complete' then coalesce(completed_at, now())
        when p_deal ? 'completedAt' then public.crm_json_timestamptz(p_deal->>'completedAt') else completed_at end,
      canceled = case when v_action = 'cancel' then true else coalesce((p_deal->>'canceled')::boolean, canceled) end,
      canceled_at = case when v_action = 'cancel' then now()
        when p_deal ? 'canceledAt' then public.crm_json_timestamptz(p_deal->>'canceledAt') else canceled_at end,
      note = case when p_deal ? 'note' then nullif(p_deal->>'note', '') else note end,
      is_deleted = case when v_action = 'archive' then true else is_deleted end,
      raw_data = v_raw || case v_action
        when 'complete' then jsonb_build_object('completed', true, 'completedAt', coalesce(v_old.completed_at, now()), 'completedByEmail', v_actor)
        when 'cancel' then jsonb_build_object('canceled', true, 'canceledAt', now(), 'canceledByEmail', v_actor)
        when 'archive' then jsonb_build_object('isDeleted', true, 'deletedAt', now(), 'deletedByEmail', v_actor)
        else '{}'::jsonb end,
      updated_at = now()
    where id = v_id;
  end if;

  update public.customers set
    status = coalesce(nullif(p_customer_patch->>'status', ''), status),
    follow = coalesce(nullif(p_customer_patch->>'follow', ''), follow),
    next_care_date = case when p_customer_patch ? 'nextCareDate'
      then public.crm_json_timestamptz(p_customer_patch->>'nextCareDate') else next_care_date end,
    note = case when p_customer_patch ? 'note' then nullif(p_customer_patch->>'note', '') else note end,
    need = case when p_customer_patch ? 'need' then nullif(p_customer_patch->>'need', '') else need end,
    raw_data = coalesce(raw_data, '{}'::jsonb) || coalesce(p_customer_patch, '{}'::jsonb)
      || jsonb_build_object('updatedByEmail', v_actor, 'updatedAt', now()),
    updated_at = now()
  where id = p_customer_id;

  perform public.crm_write_audit(
    case v_action when 'create' then 'addDeal' when 'update' then 'updateDeal'
      when 'complete' then 'completeDeal' when 'cancel' then 'cancelDeal' else 'softDeleteDeal' end,
    'deals', v_id,
    jsonb_build_object('customerId', p_customer_id, 'action', v_action, 'before', to_jsonb(v_old), 'after', p_deal)
  );
  return jsonb_build_object('id', v_id, 'customerId', p_customer_id, 'action', v_action);
end;
$$;

create or replace function public.crm_import_customer(
  p_customer jsonb,
  p_basic_purchase jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_customer_id text;
  v_deal_id text;
  v_patch jsonb;
begin
  if not public.crm_is_admin() then
    raise exception using errcode = '42501', message = 'Chỉ owner/admin được import khách hàng.';
  end if;
  v_result := public.crm_create_customer(p_customer);
  v_customer_id := v_result->>'id';
  if p_basic_purchase is not null and p_basic_purchase <> '{}'::jsonb then
    v_deal_id := coalesce(nullif(p_basic_purchase->>'id', ''), gen_random_uuid()::text);
    v_patch := jsonb_build_object(
      'dealStatus', p_basic_purchase->>'dealStatus',
      'status', coalesce(p_basic_purchase->>'customerStatus', p_customer->>'status'),
      'follow', coalesce(p_basic_purchase->>'customerFollow', p_customer->>'follow'),
      'nextCareDate', coalesce(p_basic_purchase->>'customerNextCareDate', p_customer->>'nextCareDate')
    );
    perform public.crm_save_basic_purchase('create', v_customer_id, v_deal_id, p_basic_purchase, v_patch);
  end if;
  perform public.crm_write_audit('importCustomerCsv', 'customers', v_customer_id,
    jsonb_build_object('customer', p_customer, 'basicPurchase', p_basic_purchase));
  return jsonb_build_object('id', v_customer_id, 'dealId', v_deal_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Atomic KPI proposal submission/review
-- ---------------------------------------------------------------------------

create or replace function public.crm_submit_kpi_proposal(
  p_proposal_id text,
  p_proposal jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := public.crm_current_email();
  v_id text := coalesce(nullif(p_proposal_id, ''), gen_random_uuid()::text);
  v_rule public.kpi_rules%rowtype;
  v_old public.kpi_proposals%rowtype;
  v_is_update boolean := false;
  v_raw jsonb;
begin
  if not public.crm_is_active_user() then raise exception using errcode = '42501', message = 'Tài khoản CRM không hoạt động.'; end if;
  select * into v_rule from public.kpi_rules where id = p_proposal->>'kpiRuleId' and coalesce(active, true) = true;
  if v_rule.id is null then raise exception using errcode = '22023', message = 'KPI không tồn tại hoặc đang tắt.'; end if;
  if jsonb_array_length(coalesce(v_rule.assigned_owners, '[]'::jsonb)) > 0
     and not exists (select 1 from jsonb_array_elements_text(v_rule.assigned_owners) x where lower(x) = lower(v_actor)) then
    raise exception using errcode = '42501', message = 'KPI này chưa được gán cho bạn.';
  end if;
  if nullif(trim(coalesce(p_proposal->>'content', '')), '') is null then
    raise exception using errcode = '22023', message = 'Nội dung công việc KPI là bắt buộc.';
  end if;

  select * into v_old from public.kpi_proposals where id = v_id for update;
  v_is_update := v_old.id is not null;
  if v_is_update and (
    lower(coalesce(v_old.owner_email, v_old.email, v_old.created_by_email, '')) <> lower(v_actor)
    or lower(coalesce(v_old.status, 'pending')) <> 'pending'
    or coalesce(v_old.is_deleted, false)
  ) then
    raise exception using errcode = '42501', message = 'Chỉ được sửa đề xuất pending của chính bạn.';
  end if;

  v_raw := coalesce(v_old.raw_data, '{}'::jsonb) || coalesce(p_proposal, '{}'::jsonb)
    || jsonb_build_object('id', v_id, 'ownerEmail', v_actor, 'email', v_actor,
      'status', 'pending', 'isDeleted', false, 'updatedAt', now());

  insert into public.kpi_proposals(
    id, kpi_rule_id, kpi_name, month, owner, owner_email, email, phone, department,
    customer_id, customer_name, customer_phone, customer_company_name, customer_channel,
    content, evidence_url, status, is_deleted, created_by_email, raw_data, created_at, updated_at
  ) values (
    v_id, v_rule.id, v_rule.name, nullif(p_proposal->>'month', ''),
    coalesce(p_proposal->>'owner', v_actor), v_actor, v_actor,
    nullif(p_proposal->>'phone', ''), nullif(p_proposal->>'department', ''),
    nullif(p_proposal->>'customerId', ''), nullif(p_proposal->>'customerName', ''),
    nullif(p_proposal->>'customerPhone', ''), nullif(p_proposal->>'customerCompanyName', ''),
    nullif(p_proposal->>'customerChannel', ''), p_proposal->>'content',
    nullif(p_proposal->>'evidenceUrl', ''), 'pending', false, v_actor,
    v_raw || jsonb_build_object('createdAt', now(), 'createdByEmail', v_actor), now(), now()
  )
  on conflict (id) do update set
    content = excluded.content, evidence_url = excluded.evidence_url, phone = excluded.phone,
    department = excluded.department, customer_id = excluded.customer_id,
    customer_name = excluded.customer_name, customer_phone = excluded.customer_phone,
    customer_company_name = excluded.customer_company_name, customer_channel = excluded.customer_channel,
    raw_data = v_raw, updated_at = now();

  perform public.crm_write_audit(case when v_is_update then 'updateKpiProposal' else 'submitKpiProposal' end,
    'kpiProposals', v_id, jsonb_build_object('before', to_jsonb(v_old), 'after', p_proposal));
  return jsonb_build_object('id', v_id, 'updated', v_is_update);
end;
$$;

create or replace function public.crm_review_kpi_proposal(
  p_proposal_id text,
  p_status text,
  p_review_note text default '',
  p_review_snapshot jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.kpi_proposals%rowtype;
  v_status text := lower(trim(p_status));
begin
  if not public.crm_is_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin được duyệt KPI.';
  end if;
  if v_status not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'Trạng thái duyệt KPI không hợp lệ.';
  end if;
  select * into v_old from public.kpi_proposals where id = p_proposal_id for update;
  if v_old.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy đề xuất KPI.'; end if;
  if lower(coalesce(v_old.status, 'pending')) <> 'pending' or coalesce(v_old.is_deleted, false) then
    raise exception using errcode = '55000', message = 'Đề xuất KPI đã được xử lý.';
  end if;

  update public.kpi_proposals set
    status = v_status,
    review_note = nullif(p_review_note, ''),
    reviewed_by_email = public.crm_current_email(),
    reviewed_at = now(),
    raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
      'status', v_status, 'reviewNote', p_review_note,
      'reviewedByEmail', public.crm_current_email(), 'reviewedAt', now(),
      'reviewedSnapshotJson', coalesce(p_review_snapshot, '{}'::jsonb)::text, 'updatedAt', now()),
    updated_at = now()
  where id = p_proposal_id;

  perform public.crm_write_audit(case when v_status = 'approved' then 'approveKpiProposal' else 'rejectKpiProposal' end,
    'kpiProposals', p_proposal_id,
    jsonb_build_object('before', to_jsonb(v_old), 'status', v_status, 'reviewNote', p_review_note));
  return jsonb_build_object('id', p_proposal_id, 'status', v_status);
end;
$$;

create or replace function public.crm_archive_kpi_proposal(p_proposal_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.kpi_proposals%rowtype;
  v_actor text := public.crm_current_email();
  v_is_owner boolean;
begin
  select * into v_old from public.kpi_proposals where id = p_proposal_id for update;
  if v_old.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy đề xuất KPI.'; end if;
  v_is_owner := lower(coalesce(v_old.owner_email, v_old.email, v_old.created_by_email, '')) = lower(v_actor);
  if not public.crm_is_admin()
     and not (v_is_owner and lower(coalesce(v_old.status, 'pending')) = 'pending' and not coalesce(v_old.is_deleted, false)) then
    raise exception using errcode = '42501', message = 'Chỉ được xóa đề xuất pending của chính bạn.';
  end if;

  update public.kpi_proposals set
    is_deleted = true,
    deleted_by_email = v_actor,
    deleted_at = now(),
    raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
      'isDeleted', true, 'deletedByEmail', v_actor, 'deletedAt', now(),
      'updatedByEmail', v_actor, 'updatedAt', now()),
    updated_at = now()
  where id = p_proposal_id;

  perform public.crm_write_audit(
    case when public.crm_is_admin() and not v_is_owner then 'softDeleteAdminKpiProposal' else 'softDeleteKpiProposal' end,
    'kpiProposals', p_proposal_id, to_jsonb(v_old));
  return jsonb_build_object('id', p_proposal_id, 'archived', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. RPC exposure
-- ---------------------------------------------------------------------------

revoke all on function public.crm_create_customer(jsonb) from public, anon;
revoke all on function public.crm_import_customer(jsonb, jsonb) from public, anon;
revoke all on function public.crm_update_customer_profile(text, jsonb) from public, anon;
revoke all on function public.crm_transfer_customer(text, text, jsonb) from public, anon;
revoke all on function public.crm_add_care_log(text, jsonb, jsonb) from public, anon;
revoke all on function public.crm_snooze_customer(text, date, text, integer) from public, anon;
revoke all on function public.crm_update_care_log(text, jsonb, jsonb) from public, anon;
revoke all on function public.crm_archive_care_log(text, jsonb) from public, anon;
revoke all on function public.crm_set_customer_archived(text, boolean) from public, anon;
revoke all on function public.crm_save_basic_purchase(text, text, text, jsonb, jsonb) from public, anon;
revoke all on function public.crm_submit_kpi_proposal(text, jsonb) from public, anon;
revoke all on function public.crm_review_kpi_proposal(text, text, text, jsonb) from public, anon;
revoke all on function public.crm_archive_kpi_proposal(text) from public, anon;

grant execute on function public.crm_create_customer(jsonb) to authenticated;
grant execute on function public.crm_import_customer(jsonb, jsonb) to authenticated;
grant execute on function public.crm_update_customer_profile(text, jsonb) to authenticated;
grant execute on function public.crm_transfer_customer(text, text, jsonb) to authenticated;
grant execute on function public.crm_add_care_log(text, jsonb, jsonb) to authenticated;
grant execute on function public.crm_snooze_customer(text, date, text, integer) to authenticated;
grant execute on function public.crm_update_care_log(text, jsonb, jsonb) to authenticated;
grant execute on function public.crm_archive_care_log(text, jsonb) to authenticated;
grant execute on function public.crm_set_customer_archived(text, boolean) to authenticated;
grant execute on function public.crm_save_basic_purchase(text, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.crm_submit_kpi_proposal(text, jsonb) to authenticated;
grant execute on function public.crm_review_kpi_proposal(text, text, text, jsonb) to authenticated;
grant execute on function public.crm_archive_kpi_proposal(text) to authenticated;

commit;
