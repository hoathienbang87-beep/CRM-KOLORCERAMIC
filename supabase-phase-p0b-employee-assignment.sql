-- CRM-KOLORCERAMIC - Phase P0-B
-- Employee lifecycle, customer assignment history and unassigned pool.
--
-- Dependencies:
--   1. supabase-phase-1-security-foundation.sql
--   2. supabase-phase-f-crm-rls-cleanup.sql
--   3. supabase-phase-p0a-transaction-ownership.sql
--
-- customer_assignments is authoritative. customers.owner_* is a database-
-- maintained compatibility cache for the current frontend.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Employee lifecycle
-- ---------------------------------------------------------------------------

alter table public.app_users add column if not exists lifecycle_status text;
alter table public.app_users add column if not exists inactive_at timestamptz;
alter table public.app_users add column if not exists archived_at timestamptz;
alter table public.app_users add column if not exists lifecycle_changed_at timestamptz;
alter table public.app_users add column if not exists lifecycle_changed_by_email text;

update public.app_users
set lifecycle_status = case when coalesce(active, false) then 'active' else 'inactive' end
where lifecycle_status is null
   or lower(lifecycle_status) not in ('active', 'inactive', 'archived');

alter table public.app_users alter column lifecycle_status set default 'inactive';
alter table public.app_users alter column lifecycle_status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_users_lifecycle_status_check'
      and conrelid = 'public.app_users'::regclass
  ) then
    alter table public.app_users
      add constraint app_users_lifecycle_status_check
      check (lower(lifecycle_status) in ('active', 'inactive', 'archived'));
  end if;
end $$;

create index if not exists app_users_lifecycle_status_idx
  on public.app_users(lower(lifecycle_status));

-- ---------------------------------------------------------------------------
-- 2. Assignment history
-- ---------------------------------------------------------------------------

create table if not exists public.customer_assignments (
  id text primary key default gen_random_uuid()::text,
  customer_id text not null references public.customers(id) on delete restrict,
  employee_id text references public.app_users(id) on delete restrict,
  employee_email_snapshot text,
  employee_name_snapshot text,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  assigned_by_user_id text references public.app_users(id) on delete restrict,
  assigned_by_email text,
  ended_by_user_id text references public.app_users(id) on delete restrict,
  ended_by_email text,
  assignment_reason text,
  end_reason text,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  raw_data jsonb not null default '{}'::jsonb,
  constraint customer_assignments_current_shape_check check (
    (is_current and employee_id is not null and ended_at is null)
    or
    (not is_current and ended_at is not null)
  )
);

create unique index if not exists customer_assignments_one_current_idx
  on public.customer_assignments(customer_id)
  where is_current;

create index if not exists customer_assignments_customer_history_idx
  on public.customer_assignments(customer_id, assigned_at desc);

create index if not exists customer_assignments_employee_history_idx
  on public.customer_assignments(employee_id, assigned_at desc);

-- Valid current owners become current assignments.
insert into public.customer_assignments(
  id, customer_id, employee_id, employee_email_snapshot, employee_name_snapshot,
  assigned_at, assignment_reason, is_current, created_at, raw_data
)
select
  gen_random_uuid()::text,
  c.id,
  u.id,
  u.email,
  coalesce(u.name, u.email),
  coalesce(c.created_at, now()),
  'P0-B migration from current owner cache',
  true,
  now(),
  jsonb_build_object('migration', 'P0-B', 'sourceOwnerEmail', c.owner_email)
from public.customers c
join public.app_users u on u.id = c.owner_user_id
where coalesce(c.is_deleted, false) = false
  and coalesce(u.active, false) = true
  and lower(coalesce(u.lifecycle_status, 'active')) = 'active'
  and not exists (
    select 1 from public.customer_assignments a
    where a.customer_id = c.id and a.is_current
  );

-- Unknown/inactive legacy owners are preserved as ended history snapshots.
insert into public.customer_assignments(
  id, customer_id, employee_id, employee_email_snapshot, employee_name_snapshot,
  assigned_at, ended_at, assignment_reason, end_reason, is_current, created_at, raw_data
)
select
  gen_random_uuid()::text,
  c.id,
  u.id,
  nullif(c.owner_email, ''),
  coalesce(nullif(c.owner, ''), nullif(c.owner_email, '')),
  coalesce(c.created_at, now()),
  now(),
  'P0-B migration from legacy owner snapshot',
  case when u.id is null then 'Legacy owner is not present in app_users'
       else 'Legacy owner is not ACTIVE' end,
  false,
  now(),
  jsonb_build_object('migration', 'P0-B', 'legacyOwnerEmail', c.owner_email, 'legacyOwnerName', c.owner)
from public.customers c
left join public.app_users u on u.id = c.owner_user_id
where coalesce(c.is_deleted, false) = false
  and not exists (
    select 1 from public.customer_assignments a
    where a.customer_id = c.id and a.is_current
  )
  and (nullif(c.owner_email, '') is not null or nullif(c.owner, '') is not null)
  and not exists (
    select 1 from public.customer_assignments a
    where a.customer_id = c.id
      and coalesce(a.raw_data->>'migration', '') = 'P0-B'
  );

-- ---------------------------------------------------------------------------
-- 3. Database-maintained owner cache
-- ---------------------------------------------------------------------------

create or replace function public.crm_set_customer_owner_cache(
  p_customer_id text,
  p_employee_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee public.app_users%rowtype;
  v_owner_name text;
  v_owner_email text;
  v_previous_owner_guard text := coalesce(current_setting('crm.allow_owner_transfer', true), '');
begin
  if p_employee_id is not null then
    select * into v_employee from public.app_users where id = p_employee_id;
    if v_employee.id is null then
      raise exception using errcode = '23503', message = 'Nhân viên phụ trách không tồn tại.';
    end if;
    v_owner_name := coalesce(v_employee.name, v_employee.email);
    v_owner_email := v_employee.email;
  end if;

  perform set_config('crm.allow_owner_transfer', 'on', true);
  update public.customers
  set owner_user_id = p_employee_id,
      owner = v_owner_name,
      owner_email = v_owner_email,
      raw_data = (coalesce(raw_data, '{}'::jsonb) - 'owner' - 'ownerEmail' - 'ownerUserId')
        || case when p_employee_id is null then '{}'::jsonb else jsonb_build_object(
          'owner', v_owner_name,
          'ownerEmail', v_owner_email,
          'ownerUserId', p_employee_id
        ) end
        || jsonb_build_object('assignmentSyncedAt', now()),
      updated_at = now()
  where id = p_customer_id;

  update public.phone_index
  set owner = v_owner_name,
      owner_email = v_owner_email,
      raw_data = (coalesce(raw_data, '{}'::jsonb) - 'owner' - 'ownerEmail')
        || case when p_employee_id is null then '{}'::jsonb else jsonb_build_object(
          'owner', v_owner_name,
          'ownerEmail', v_owner_email
        ) end
  where customer_id = p_customer_id;
  perform set_config('crm.allow_owner_transfer', v_previous_owner_guard, true);
end;
$$;

revoke all on function public.crm_set_customer_owner_cache(text, text)
  from public, anon, authenticated;

create or replace function public.crm_sync_customer_owner_from_assignments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id text := coalesce(new.customer_id, old.customer_id);
  v_employee_id text;
begin
  select employee_id into v_employee_id
  from public.customer_assignments
  where customer_id = v_customer_id and is_current
  limit 1;

  perform public.crm_set_customer_owner_cache(v_customer_id, v_employee_id);
  return coalesce(new, old);
end;
$$;

revoke all on function public.crm_sync_customer_owner_from_assignments()
  from public, anon, authenticated;

drop trigger if exists customer_assignments_sync_owner_cache on public.customer_assignments;
create trigger customer_assignments_sync_owner_cache
after insert or update or delete on public.customer_assignments
for each row execute function public.crm_sync_customer_owner_from_assignments();

create or replace function public.crm_guard_assignment_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('crm.allow_assignment_write', true), '') <> 'on'
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'Phân công khách hàng phải thực hiện qua RPC CRM.';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.crm_guard_assignment_write()
  from public, anon, authenticated;

drop trigger if exists customer_assignments_guard_write on public.customer_assignments;
create trigger customer_assignments_guard_write
before insert or update or delete on public.customer_assignments
for each row execute function public.crm_guard_assignment_write();

-- Clear invalid legacy owner caches. The history snapshot above remains.
select set_config('crm.allow_owner_transfer', 'on', true);
update public.customers c
set owner_user_id = null,
    owner = null,
    owner_email = null,
    raw_data = coalesce(c.raw_data, '{}'::jsonb) - 'owner' - 'ownerEmail' - 'ownerUserId'
      || jsonb_build_object('unassignedAt', now(), 'unassignedReason', 'P0-B legacy owner migration'),
    updated_at = now()
where coalesce(c.is_deleted, false) = false
  and not exists (
    select 1 from public.customer_assignments a
    where a.customer_id = c.id and a.is_current
  );

-- ---------------------------------------------------------------------------
-- 4. Access derives from current assignment, never created_by
-- ---------------------------------------------------------------------------

create or replace function public.crm_current_assignment_employee_id(p_customer_id text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select a.employee_id
  from public.customer_assignments a
  where a.customer_id = p_customer_id and a.is_current
  limit 1;
$$;

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
      from public.customer_assignments a
      where a.customer_id = p_customer_id
        and a.is_current
        and a.employee_id = public.crm_current_app_user_id()
    );
$$;

revoke all on function public.crm_current_assignment_employee_id(text) from public, anon;
revoke all on function public.crm_can_access_customer_id(text) from public, anon;
grant execute on function public.crm_current_assignment_employee_id(text) to authenticated;
grant execute on function public.crm_can_access_customer_id(text) to authenticated;

alter table public.customer_assignments enable row level security;
grant select on public.customer_assignments to authenticated;
revoke insert, update, delete on public.customer_assignments from authenticated;

do $$
declare v_policy record;
begin
  for v_policy in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('customers', 'care_logs', 'deals', 'customer_assignments')
      and lower(policyname) not like '%admin%'
  loop
    execute format('drop policy if exists %I on public.%I', v_policy.policyname, v_policy.tablename);
  end loop;
end $$;

create policy "customers manager or assigned employee read" on public.customers
for select to authenticated
using (public.crm_is_active_user() and public.crm_can_access_customer_id(id));

create policy "customers manager or assigned employee update" on public.customers
for update to authenticated
using (public.crm_is_active_user() and public.crm_can_access_customer_id(id))
with check (public.crm_is_active_user() and public.crm_can_access_customer_id(id));

create policy "care logs assigned customer read" on public.care_logs
for select to authenticated
using (public.crm_is_active_user() and public.crm_can_access_customer_id(customer_id));

create policy "care logs assigned customer insert" on public.care_logs
for insert to authenticated
with check (public.crm_is_active_user() and public.crm_can_access_customer_id(customer_id));

create policy "basic purchases assigned customer read" on public.deals
for select to authenticated
using (public.crm_is_active_user() and public.crm_can_access_customer_id(customer_id));

create policy "basic purchases assigned customer insert" on public.deals
for insert to authenticated
with check (public.crm_is_active_user() and public.crm_can_access_customer_id(customer_id));

create policy "basic purchases assigned customer update" on public.deals
for update to authenticated
using (public.crm_is_active_user() and public.crm_can_access_customer_id(customer_id))
with check (public.crm_is_active_user() and public.crm_can_access_customer_id(customer_id));

create policy "assignment history manager or employee read" on public.customer_assignments
for select to authenticated
using (
  public.crm_is_active_user()
  and (
    public.crm_is_manager()
    or employee_id = public.crm_current_app_user_id()
  )
);

-- Customer creation is RPC-only so a cache cannot be inserted without an
-- authoritative assignment row.
revoke insert on public.customers from authenticated;

-- ---------------------------------------------------------------------------
-- 5. Assignment transactions
-- ---------------------------------------------------------------------------

create or replace function public.crm_assign_customer(
  p_customer_id text,
  p_employee_id text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customers%rowtype;
  v_employee public.app_users%rowtype;
  v_current public.customer_assignments%rowtype;
  v_actor_id text := public.crm_current_app_user_id();
  v_actor_email text := public.crm_current_email();
  v_assignment_id text := gen_random_uuid()::text;
  v_previous_assignment_guard text := coalesce(current_setting('crm.allow_assignment_write', true), '');
begin
  if not public.crm_is_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin được phân công khách hàng.';
  end if;

  select * into v_customer from public.customers
  where id = p_customer_id and coalesce(is_deleted, false) = false
  for update;
  if v_customer.id is null then
    raise exception using errcode = 'P0002', message = 'Khách hàng không tồn tại hoặc đã lưu trữ.';
  end if;

  select * into v_employee from public.app_users
  where id = p_employee_id
    and coalesce(active, false) = true
    and lower(coalesce(lifecycle_status, 'inactive')) = 'active'
    and lower(coalesce(role, 'sale')) not in ('admin', 'owner')
  for key share;
  if v_employee.id is null then
    raise exception using errcode = '22023', message = 'Nhân viên nhận khách không tồn tại hoặc không ACTIVE.';
  end if;

  select * into v_current from public.customer_assignments
  where customer_id = p_customer_id and is_current
  for update;

  if v_current.employee_id = v_employee.id then
    return jsonb_build_object('id', p_customer_id, 'assignmentId', v_current.id, 'unchanged', true);
  end if;

  perform set_config('crm.allow_assignment_write', 'on', true);
  if v_current.id is not null then
    update public.customer_assignments
    set is_current = false,
        ended_at = now(),
        ended_by_user_id = v_actor_id,
        ended_by_email = v_actor_email,
        end_reason = coalesce(nullif(trim(p_reason), ''), 'Reassigned')
    where id = v_current.id;
  end if;

  insert into public.customer_assignments(
    id, customer_id, employee_id, employee_email_snapshot, employee_name_snapshot,
    assigned_at, assigned_by_user_id, assigned_by_email, assignment_reason,
    is_current, created_at, raw_data
  ) values (
    v_assignment_id, p_customer_id, v_employee.id, v_employee.email,
    coalesce(v_employee.name, v_employee.email), now(), v_actor_id, v_actor_email,
    nullif(trim(p_reason), ''), true, now(),
    jsonb_build_object('actor', v_actor_email, 'employeeEmail', v_employee.email)
  );
  perform set_config('crm.allow_assignment_write', v_previous_assignment_guard, true);

  perform public.crm_write_audit('assignCustomer', 'customers', p_customer_id,
    jsonb_build_object(
      'customer', coalesce(v_customer.name, p_customer_id),
      'oldAssignmentId', v_current.id,
      'oldEmployeeId', v_current.employee_id,
      'oldEmployeeEmail', v_current.employee_email_snapshot,
      'newAssignmentId', v_assignment_id,
      'newEmployeeId', v_employee.id,
      'newEmployeeEmail', v_employee.email,
      'reason', p_reason,
      'actor', v_actor_email,
      'timestamp', now()
    ));

  return jsonb_build_object(
    'id', p_customer_id,
    'assignmentId', v_assignment_id,
    'ownerUserId', v_employee.id,
    'ownerEmail', v_employee.email
  );
end;
$$;

create or replace function public.crm_unassign_customer(
  p_customer_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customers%rowtype;
  v_current public.customer_assignments%rowtype;
  v_actor_id text := public.crm_current_app_user_id();
  v_actor_email text := public.crm_current_email();
  v_previous_assignment_guard text := coalesce(current_setting('crm.allow_assignment_write', true), '');
begin
  if not public.crm_is_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin được đưa khách về chờ phân bổ.';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'Lý do bỏ phân công là bắt buộc.';
  end if;

  select * into v_customer from public.customers
  where id = p_customer_id and coalesce(is_deleted, false) = false
  for update;
  if v_customer.id is null then
    raise exception using errcode = 'P0002', message = 'Không tìm thấy khách hàng.';
  end if;

  select * into v_current from public.customer_assignments
  where customer_id = p_customer_id and is_current
  for update;

  if v_current.id is null then
    return jsonb_build_object('id', p_customer_id, 'unassigned', true, 'unchanged', true);
  end if;

  perform set_config('crm.allow_assignment_write', 'on', true);
  update public.customer_assignments
  set is_current = false,
      ended_at = now(),
      ended_by_user_id = v_actor_id,
      ended_by_email = v_actor_email,
      end_reason = trim(p_reason)
  where id = v_current.id;
  perform set_config('crm.allow_assignment_write', v_previous_assignment_guard, true);

  perform public.crm_write_audit('unassignCustomer', 'customers', p_customer_id,
    jsonb_build_object(
      'customer', coalesce(v_customer.name, p_customer_id),
      'assignmentId', v_current.id,
      'oldEmployeeId', v_current.employee_id,
      'oldEmployeeEmail', v_current.employee_email_snapshot,
      'reason', trim(p_reason),
      'openFollowup', v_customer.next_care_date,
      'actor', v_actor_email,
      'timestamp', now()
    ));

  return jsonb_build_object('id', p_customer_id, 'unassigned', true);
end;
$$;

create or replace function public.crm_bulk_assign_customers(
  p_customer_ids text[],
  p_employee_id text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id text;
  v_count integer := 0;
begin
  if not public.crm_is_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin được phân công nhiều khách.';
  end if;
  if coalesce(array_length(p_customer_ids, 1), 0) = 0 then
    raise exception using errcode = '22023', message = 'Chưa chọn khách hàng cần phân công.';
  end if;
  if array_length(p_customer_ids, 1) <> (select count(distinct x) from unnest(p_customer_ids) x) then
    raise exception using errcode = '22023', message = 'Danh sách khách hàng có ID trùng.';
  end if;

  foreach v_customer_id in array p_customer_ids loop
    perform public.crm_assign_customer(v_customer_id, p_employee_id, p_reason);
    v_count := v_count + 1;
  end loop;

  perform public.crm_write_audit('bulkAssignCustomers', 'customers', 'bulk',
    jsonb_build_object('customerIds', p_customer_ids, 'employeeId', p_employee_id,
      'count', v_count, 'reason', p_reason));
  return jsonb_build_object('count', v_count, 'employeeId', p_employee_id);
end;
$$;

-- Backward-compatible RPC used by the current customer edit drawer.
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
  v_employee_id text;
  v_result jsonb;
begin
  if not public.crm_is_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin được chuyển khách.';
  end if;
  select id into v_employee_id
  from public.app_users
  where lower(email) = lower(trim(p_new_owner_email))
    and coalesce(active, false) = true
    and lower(coalesce(lifecycle_status, 'inactive')) = 'active'
  limit 1;
  if v_employee_id is null then
    raise exception using errcode = '22023', message = 'Nhân viên mới không hợp lệ hoặc không ACTIVE.';
  end if;

  if coalesce(p_profile_changes, '{}'::jsonb) <> '{}'::jsonb then
    perform public.crm_update_customer_profile(
      p_customer_id,
      p_profile_changes - 'owner' - 'ownerEmail' - 'ownerUserId'
    );
  end if;
  v_result := public.crm_assign_customer(p_customer_id, v_employee_id, 'Chuyển phụ trách từ hồ sơ khách');
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Employee lifecycle transactions
-- ---------------------------------------------------------------------------

create or replace function public.crm_guard_employee_lifecycle_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (old.active is distinct from new.active
      or lower(old.lifecycle_status) is distinct from lower(new.lifecycle_status))
     and coalesce(current_setting('crm.allow_employee_lifecycle', true), '') <> 'on'
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'Đổi trạng thái nhân viên phải dùng RPC vòng đời nhân viên.';
  end if;
  return new;
end;
$$;

revoke all on function public.crm_guard_employee_lifecycle_change()
  from public, anon, authenticated;

drop trigger if exists app_users_guard_lifecycle_change on public.app_users;
create trigger app_users_guard_lifecycle_change
before update on public.app_users
for each row execute function public.crm_guard_employee_lifecycle_change();

create or replace function public.crm_create_employee(p_employee jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := coalesce(nullif(p_employee->>'id', ''), gen_random_uuid()::text);
  v_email text := lower(trim(coalesce(p_employee->>'email', '')));
  v_role text := lower(coalesce(nullif(p_employee->>'role', ''), 'sale'));
begin
  if not public.crm_is_admin() then
    raise exception using errcode = '42501', message = 'Chỉ owner/admin được thêm nhân viên.';
  end if;
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'Email nhân viên không hợp lệ.';
  end if;
  if v_role not in ('sale', 'manager', 'admin', 'owner') then
    raise exception using errcode = '22023', message = 'Role nhân viên không hợp lệ.';
  end if;
  if exists (select 1 from public.app_users where lower(email) = v_email) then
    raise exception using errcode = '23505', message = 'Email nhân viên đã tồn tại.';
  end if;

  insert into public.app_users(
    id, email, name, role, active, lifecycle_status, can_export, team,
    lifecycle_changed_at, lifecycle_changed_by_email, raw_data, created_at, updated_at
  ) values (
    v_id, v_email, coalesce(nullif(p_employee->>'name', ''), v_email), v_role,
    true, 'active', coalesce((p_employee->>'canExport')::boolean, false),
    nullif(p_employee->>'team', ''), now(), public.crm_current_email(),
    coalesce(p_employee, '{}'::jsonb) || jsonb_build_object(
      'active', true, 'lifecycleStatus', 'active', 'createdByEmail', public.crm_current_email()
    ), now(), now()
  );

  perform public.crm_write_audit('createEmployee', 'users', v_id,
    jsonb_build_object('email', v_email, 'role', v_role, 'lifecycleStatus', 'active'));
  return jsonb_build_object('id', v_id, 'email', v_email, 'lifecycleStatus', 'active');
end;
$$;

create or replace function public.crm_update_employee_profile(
  p_employee_id text,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.app_users%rowtype;
  v_role text;
begin
  if not public.crm_is_admin() then
    raise exception using errcode = '42501', message = 'Chỉ owner/admin được cập nhật nhân viên.';
  end if;
  select * into v_old from public.app_users where id = p_employee_id for update;
  if v_old.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy nhân viên.'; end if;
  v_role := lower(coalesce(nullif(p_changes->>'role', ''), v_old.role));
  if v_role not in ('sale', 'manager', 'admin', 'owner') then
    raise exception using errcode = '22023', message = 'Role nhân viên không hợp lệ.';
  end if;
  if lower(v_old.email) = public.crm_current_email()
     and v_role not in ('admin', 'owner') then
    raise exception using errcode = '42501', message = 'Không thể tự hạ quyền admin/owner.';
  end if;

  update public.app_users
  set name = case when p_changes ? 'name' then coalesce(nullif(p_changes->>'name', ''), name) else name end,
      role = v_role,
      team = case when p_changes ? 'team' then nullif(p_changes->>'team', '') else team end,
      can_export = case when p_changes ? 'canExport' then (p_changes->>'canExport')::boolean else can_export end,
      raw_data = coalesce(raw_data, '{}'::jsonb) || (coalesce(p_changes, '{}'::jsonb) - 'active' - 'lifecycleStatus')
        || jsonb_build_object('updatedByEmail', public.crm_current_email(), 'updatedAt', now()),
      updated_at = now()
  where id = p_employee_id;

  perform public.crm_write_audit('updateEmployeeProfile', 'users', p_employee_id,
    jsonb_build_object('before', to_jsonb(v_old), 'changes', p_changes - 'active' - 'lifecycleStatus'));
  return jsonb_build_object('id', p_employee_id, 'role', v_role);
end;
$$;

create or replace function public.crm_deactivate_employee(
  p_employee_id text,
  p_mode text default 'unassigned',
  p_replacement_employee_id text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee public.app_users%rowtype;
  v_replacement public.app_users%rowtype;
  v_assignment record;
  v_count integer := 0;
  v_followup_count integer := 0;
  v_mode text := lower(coalesce(nullif(trim(p_mode), ''), 'unassigned'));
  v_previous_lifecycle_guard text := coalesce(current_setting('crm.allow_employee_lifecycle', true), '');
begin
  if not public.crm_is_admin() then
    raise exception using errcode = '42501', message = 'Chỉ owner/admin được ngừng hoạt động nhân viên.';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'Lý do ngừng hoạt động là bắt buộc.';
  end if;
  if v_mode not in ('unassigned', 'transfer') then
    raise exception using errcode = '22023', message = 'Cách xử lý khách hàng không hợp lệ.';
  end if;

  select * into v_employee from public.app_users where id = p_employee_id for update;
  if v_employee.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy nhân viên.'; end if;
  if lower(v_employee.email) = public.crm_current_email() then
    raise exception using errcode = '42501', message = 'Không thể tự ngừng hoạt động tài khoản đang đăng nhập.';
  end if;
  if lower(coalesce(v_employee.lifecycle_status, 'inactive')) <> 'active' then
    raise exception using errcode = '22023', message = 'Nhân viên không ở trạng thái ACTIVE.';
  end if;
  if lower(coalesce(v_employee.role, 'sale')) in ('admin', 'owner')
     and public.crm_current_user_role() <> 'owner' then
    raise exception using errcode = '42501', message = 'Chỉ owner được ngừng tài khoản admin/owner.';
  end if;

  if v_mode = 'transfer' then
    select * into v_replacement from public.app_users
    where id = p_replacement_employee_id
      and id <> p_employee_id
      and coalesce(active, false) = true
      and lower(lifecycle_status) = 'active'
      and lower(coalesce(role, 'sale')) not in ('admin', 'owner')
    for key share;
    if v_replacement.id is null then
      raise exception using errcode = '22023', message = 'Nhân viên nhận bàn giao không hợp lệ hoặc không ACTIVE.';
    end if;
  end if;

  select count(*) into v_followup_count
  from public.customer_assignments a
  join public.customers c on c.id = a.customer_id
  where a.employee_id = p_employee_id and a.is_current
    and c.next_care_date is not null
    and coalesce(c.is_deleted, false) = false;

  for v_assignment in
    select a.customer_id
    from public.customer_assignments a
    where a.employee_id = p_employee_id and a.is_current
    order by a.customer_id
  loop
    if v_mode = 'transfer' then
      perform public.crm_assign_customer(
        v_assignment.customer_id,
        v_replacement.id,
        'Nhân viên ngừng hoạt động: ' || trim(p_reason)
      );
    else
      perform public.crm_unassign_customer(
        v_assignment.customer_id,
        'Nhân viên ngừng hoạt động: ' || trim(p_reason)
      );
    end if;
    v_count := v_count + 1;
  end loop;

  perform set_config('crm.allow_employee_lifecycle', 'on', true);
  update public.app_users
  set active = false,
      lifecycle_status = 'inactive',
      inactive_at = now(),
      archived_at = null,
      lifecycle_changed_at = now(),
      lifecycle_changed_by_email = public.crm_current_email(),
      raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
        'active', false,
        'lifecycleStatus', 'inactive',
        'inactiveAt', now(),
        'lifecycleReason', trim(p_reason),
        'lifecycleChangedByEmail', public.crm_current_email()
      ),
      updated_at = now()
  where id = p_employee_id;
  perform set_config('crm.allow_employee_lifecycle', v_previous_lifecycle_guard, true);

  perform public.crm_write_audit('deactivateEmployee', 'users', p_employee_id,
    jsonb_build_object(
      'employeeEmail', v_employee.email,
      'mode', v_mode,
      'replacementEmployeeId', v_replacement.id,
      'replacementEmail', v_replacement.email,
      'customerCount', v_count,
      'openFollowupCount', v_followup_count,
      'reason', trim(p_reason)
    ));

  return jsonb_build_object(
    'id', p_employee_id,
    'lifecycleStatus', 'inactive',
    'mode', v_mode,
    'customerCount', v_count,
    'openFollowupCount', v_followup_count
  );
end;
$$;

create or replace function public.crm_reactivate_employee(
  p_employee_id text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee public.app_users%rowtype;
  v_previous_lifecycle_guard text := coalesce(current_setting('crm.allow_employee_lifecycle', true), '');
begin
  if not public.crm_is_admin() then
    raise exception using errcode = '42501', message = 'Chỉ owner/admin được mở lại nhân viên.';
  end if;
  select * into v_employee from public.app_users where id = p_employee_id for update;
  if v_employee.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy nhân viên.'; end if;
  if lower(coalesce(v_employee.lifecycle_status, 'inactive')) = 'archived' then
    raise exception using errcode = '22023', message = 'Nhân viên đã ARCHIVED; cần phục hồi hồ sơ trước khi kích hoạt.';
  end if;

  perform set_config('crm.allow_employee_lifecycle', 'on', true);
  update public.app_users
  set active = true,
      lifecycle_status = 'active',
      inactive_at = null,
      lifecycle_changed_at = now(),
      lifecycle_changed_by_email = public.crm_current_email(),
      raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
        'active', true, 'lifecycleStatus', 'active', 'reactivatedAt', now(),
        'lifecycleReason', coalesce(p_reason, ''),
        'lifecycleChangedByEmail', public.crm_current_email()
      ),
      updated_at = now()
  where id = p_employee_id;
  perform set_config('crm.allow_employee_lifecycle', v_previous_lifecycle_guard, true);

  perform public.crm_write_audit('reactivateEmployee', 'users', p_employee_id,
    jsonb_build_object('employeeEmail', v_employee.email, 'reason', p_reason));
  return jsonb_build_object('id', p_employee_id, 'lifecycleStatus', 'active');
end;
$$;

create or replace function public.crm_archive_employee(
  p_employee_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee public.app_users%rowtype;
  v_previous_lifecycle_guard text := coalesce(current_setting('crm.allow_employee_lifecycle', true), '');
begin
  if not public.crm_is_admin() then
    raise exception using errcode = '42501', message = 'Chỉ owner/admin được lưu trữ nhân viên.';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'Lý do lưu trữ là bắt buộc.';
  end if;
  select * into v_employee from public.app_users where id = p_employee_id for update;
  if v_employee.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy nhân viên.'; end if;
  if lower(coalesce(v_employee.lifecycle_status, 'inactive')) <> 'inactive' then
    raise exception using errcode = '22023', message = 'Chỉ nhân viên INACTIVE mới được ARCHIVED.';
  end if;
  if exists (select 1 from public.customer_assignments where employee_id = p_employee_id and is_current) then
    raise exception using errcode = '23514', message = 'Nhân viên vẫn còn khách đang phụ trách.';
  end if;

  perform set_config('crm.allow_employee_lifecycle', 'on', true);
  update public.app_users
  set active = false,
      lifecycle_status = 'archived',
      archived_at = now(),
      lifecycle_changed_at = now(),
      lifecycle_changed_by_email = public.crm_current_email(),
      raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
        'active', false, 'lifecycleStatus', 'archived', 'archivedAt', now(),
        'lifecycleReason', trim(p_reason),
        'lifecycleChangedByEmail', public.crm_current_email()
      ),
      updated_at = now()
  where id = p_employee_id;
  perform set_config('crm.allow_employee_lifecycle', v_previous_lifecycle_guard, true);

  perform public.crm_write_audit('archiveEmployee', 'users', p_employee_id,
    jsonb_build_object('employeeEmail', v_employee.email, 'reason', trim(p_reason)));
  return jsonb_build_object('id', p_employee_id, 'lifecycleStatus', 'archived');
end;
$$;

-- No hard-delete employee policy. History FKs use ON DELETE RESTRICT as a
-- second line of defense.
do $$
declare v_policy record;
begin
  for v_policy in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'app_users'
  loop
    execute format('drop policy if exists %I on public.app_users', v_policy.policyname);
  end loop;
end $$;

create policy "app users read self or manager" on public.app_users
for select to authenticated
using (lower(coalesce(email, '')) = public.crm_current_email() or public.crm_is_manager());

create policy "app users self create inactive" on public.app_users
for insert to authenticated
with check (
  lower(coalesce(email, '')) = public.crm_current_email()
  and coalesce(active, false) = false
  and lower(lifecycle_status) = 'inactive'
);

create policy "app users admin insert" on public.app_users
for insert to authenticated
with check (public.crm_is_admin());

create policy "app users admin update profile" on public.app_users
for update to authenticated
using (public.crm_is_admin())
with check (public.crm_is_admin());

-- ---------------------------------------------------------------------------
-- 7. Customer creation with optional assignment for managers
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
  v_requested_owner_email text := nullif(trim(coalesce(p_customer->>'ownerEmail', '')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_customer->>'phoneNormalized', ''), '[^0-9]', '', 'g'), '');
  v_duplicate_id text;
  v_raw jsonb;
  v_previous_assignment_guard text := coalesce(current_setting('crm.allow_assignment_write', true), '');
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'Tài khoản CRM không hoạt động.';
  end if;
  if nullif(trim(coalesce(p_customer->>'name', '')), '') is null then
    raise exception using errcode = '22023', message = 'Tên khách hàng là bắt buộc.';
  end if;

  if public.crm_is_manager() then
    if v_requested_owner_email is not null then
      select * into v_owner from public.app_users
      where lower(email) = lower(v_requested_owner_email)
        and coalesce(active, false) = true
        and lower(lifecycle_status) = 'active'
        and lower(coalesce(role, 'sale')) not in ('admin', 'owner')
      limit 1;
      if v_owner.id is null then
        raise exception using errcode = '22023', message = 'Nhân viên phụ trách không hợp lệ hoặc không ACTIVE.';
      end if;
    end if;
  else
    select * into v_owner from public.app_users
    where id = v_actor_id and coalesce(active, false) = true and lower(lifecycle_status) = 'active';
  end if;

  if not public.crm_is_manager() and v_owner.id is null then
    raise exception using errcode = '42501', message = 'Sale không thể tạo khách khi không có assignment hợp lệ.';
  end if;

  if v_phone is not null then
    perform pg_advisory_xact_lock(hashtext('crm_phone:' || v_phone));
    select id into v_duplicate_id from public.customers
    where phone_normalized = v_phone and coalesce(is_deleted, false) = false limit 1;
    if v_duplicate_id is not null then
      raise exception using errcode = '23505', message = 'CRM_DUPLICATE_PHONE:' || v_duplicate_id;
    end if;
  end if;

  v_raw := (coalesce(p_customer, '{}'::jsonb) - 'owner' - 'ownerEmail' - 'ownerUserId')
    || jsonb_build_object(
      'id', v_customer_id,
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
    null, null, null, v_actor_email, v_actor_id,
    nullif(p_customer->>'status', ''), nullif(p_customer->>'follow', ''),
    public.crm_json_timestamptz(p_customer->>'nextCareDate'), null,
    nullif(p_customer->>'note', ''), nullif(p_customer->>'need', ''), false,
    v_raw, coalesce(public.crm_json_timestamptz(p_customer->>'createdAt'), now()), now()
  );

  if v_phone is not null then
    insert into public.phone_index(phone, customer_id, owner, owner_email, raw_data)
    values (v_phone, v_customer_id, null, null, jsonb_build_object('customerId', v_customer_id))
    on conflict (phone) do update set customer_id = excluded.customer_id,
      owner = null, owner_email = null, raw_data = excluded.raw_data;
  end if;

  if v_owner.id is not null then
    perform set_config('crm.allow_assignment_write', 'on', true);
    insert into public.customer_assignments(
      id, customer_id, employee_id, employee_email_snapshot, employee_name_snapshot,
      assigned_at, assigned_by_user_id, assigned_by_email, assignment_reason, is_current, created_at
    ) values (
      gen_random_uuid()::text, v_customer_id, v_owner.id, v_owner.email,
      coalesce(v_owner.name, v_owner.email), now(), v_actor_id, v_actor_email,
      'Phân công khi tạo khách', true, now()
    );
    perform set_config('crm.allow_assignment_write', v_previous_assignment_guard, true);
  end if;

  perform public.crm_write_audit('addCustomer', 'customers', v_customer_id,
    v_raw || jsonb_build_object('assignmentEmployeeId', v_owner.id, 'assignmentEmployeeEmail', v_owner.email));
  return jsonb_build_object('id', v_customer_id, 'assigned', v_owner.id is not null,
    'ownerUserId', v_owner.id, 'ownerEmail', v_owner.email);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. RPC exposure
-- ---------------------------------------------------------------------------

revoke all on function public.crm_assign_customer(text, text, text) from public, anon;
revoke all on function public.crm_unassign_customer(text, text) from public, anon;
revoke all on function public.crm_bulk_assign_customers(text[], text, text) from public, anon;
revoke all on function public.crm_deactivate_employee(text, text, text, text) from public, anon;
revoke all on function public.crm_reactivate_employee(text, text) from public, anon;
revoke all on function public.crm_archive_employee(text, text) from public, anon;
revoke all on function public.crm_create_employee(jsonb) from public, anon;
revoke all on function public.crm_update_employee_profile(text, jsonb) from public, anon;
revoke all on function public.crm_create_customer(jsonb) from public, anon;
revoke all on function public.crm_transfer_customer(text, text, jsonb) from public, anon;

grant execute on function public.crm_assign_customer(text, text, text) to authenticated;
grant execute on function public.crm_unassign_customer(text, text) to authenticated;
grant execute on function public.crm_bulk_assign_customers(text[], text, text) to authenticated;
grant execute on function public.crm_deactivate_employee(text, text, text, text) to authenticated;
grant execute on function public.crm_reactivate_employee(text, text) to authenticated;
grant execute on function public.crm_archive_employee(text, text) to authenticated;
grant execute on function public.crm_create_employee(jsonb) to authenticated;
grant execute on function public.crm_update_employee_profile(text, jsonb) to authenticated;
grant execute on function public.crm_create_customer(jsonb) to authenticated;
grant execute on function public.crm_transfer_customer(text, text, jsonb) to authenticated;

commit;
