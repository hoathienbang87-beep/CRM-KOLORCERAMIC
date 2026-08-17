-- Minimal faithful reproduction of the CRM-KOLORCERAMIC production surface
-- needed to exercise EMPLOYEE-ONBOARDING-R1. Mirrors the repo migrations.
create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  deleted_at timestamptz,
  banned_until timestamptz,
  is_anonymous boolean default false
);
create table auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  provider text not null
);

-- Session simulation: crm.test_uid / crm.test_role stand in for the JWT.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('crm.test_uid', true), '')
  )::uuid;
$$;
create or replace function auth.email() returns text language sql stable as $$
  select email from auth.users where id = auth.uid();
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('crm.test_role', true), ''), 'authenticated');
$$;

create table public.app_users (
  id text primary key,
  email text,
  name text,
  role text default 'sale',
  active boolean default false,
  lifecycle_status text not null default 'inactive',
  supabase_auth_id uuid,
  inactive_at timestamptz,
  archived_at timestamptz,
  lifecycle_changed_at timestamptz,
  lifecycle_changed_by_email text,
  can_export boolean default false,
  team text,
  phone text,
  raw_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint app_users_lifecycle_status_check
    check (lower(lifecycle_status) in ('active','inactive','archived'))
);
create unique index app_users_email_unique_idx on public.app_users(lower(email));

create table public.audit_logs (
  id text primary key,
  action text, entity text, entity_id text, email text,
  payload_json text, raw_data jsonb, created_at timestamptz default now()
);

-- ---- from supabase-phase-f-crm-rls-cleanup.sql / p0a ----
create or replace function public.crm_current_email() returns text
language sql stable as $$ select lower(coalesce(auth.email(), '')); $$;

create or replace function public.crm_write_audit(
  p_action text, p_entity text, p_entity_id text, p_payload jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs(id, action, entity, entity_id, email, payload_json, raw_data, created_at)
  values (gen_random_uuid()::text, p_action, p_entity, p_entity_id,
          public.crm_current_email(), coalesce(p_payload,'{}'::jsonb)::text,
          coalesce(p_payload,'{}'::jsonb), now());
end; $$;

-- ---- from supabase-phase-auth-identity-linking-repair.sql ----
create unique index if not exists app_users_supabase_auth_id_unique_idx
  on public.app_users(supabase_auth_id) where supabase_auth_id is not null;

create table if not exists public.identity_link_requests (
  id uuid primary key default gen_random_uuid(),
  actor_key text not null,
  actor_app_user_id text references public.app_users(id) on delete restrict,
  actor_auth_id uuid,
  operation text not null check (operation in ('LINK','RELINK')),
  request_id uuid not null,
  target_app_user_id text not null references public.app_users(id) on delete restrict,
  previous_auth_id uuid,
  new_auth_id uuid not null,
  reason text not null check (nullif(btrim(reason), '') is not null),
  request_payload_hash text not null check (request_payload_hash ~ '^[a-f0-9]{64}$'),
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  constraint identity_link_requests_idempotency_unique unique(actor_key, operation, request_id)
);

create or replace function public.crm_identity_payload_hash(p_payload jsonb)
returns text language sql security definer immutable set search_path = public, extensions as $$
  select encode(extensions.digest(convert_to(coalesce(p_payload,'{}'::jsonb)::text,'UTF8'),'sha256'),'hex');
$$;

create or replace function public.crm_guard_employee_auth_identity_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.supabase_auth_id is distinct from new.supabase_auth_id
     and coalesce(current_setting('crm.allow_identity_write', true), '') <> 'on' then
    raise exception using errcode = '42501',
      message = 'EMPLOYEE_AUTH_IDENTITY_RPC_REQUIRED: Auth mapping must be changed through the canonical identity RPC.';
  end if;
  return new;
end; $$;
drop trigger if exists app_users_guard_auth_identity_change on public.app_users;
create trigger app_users_guard_auth_identity_change
before update of supabase_auth_id on public.app_users
for each row execute function public.crm_guard_employee_auth_identity_change();

create or replace function public.crm_current_app_user_id() returns text
language sql stable security definer set search_path = public as $$
  select u.id from public.app_users u
  where auth.uid() is not null and u.supabase_auth_id = auth.uid()
    and coalesce(u.active,false) = true
    and lower(coalesce(u.lifecycle_status,'inactive')) = 'active'
  limit 1;
$$;
create or replace function public.crm_current_user_role() returns text
language sql stable security definer set search_path = public as $$
  select lower(coalesce(u.role,'')) from public.app_users u
  where u.id = public.crm_current_app_user_id() limit 1;
$$;
create or replace function public.crm_is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select public.crm_current_app_user_id() is not null;
$$;
create or replace function public.crm_is_admin() returns boolean
language sql stable as $$ select public.crm_current_user_role() in ('owner','admin'); $$;

-- ---- from supabase-phase-p0b-employee-assignment.sql ----
create or replace function public.crm_guard_employee_lifecycle_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (old.active is distinct from new.active
      or lower(old.lifecycle_status) is distinct from lower(new.lifecycle_status))
     and coalesce(current_setting('crm.allow_employee_lifecycle', true), '') <> 'on'
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501',
      message = 'Đổi trạng thái nhân viên phải dùng RPC vòng đời nhân viên.';
  end if;
  return new;
end; $$;
drop trigger if exists app_users_guard_lifecycle_change on public.app_users;
create trigger app_users_guard_lifecycle_change
before update on public.app_users
for each row execute function public.crm_guard_employee_lifecycle_change();

create or replace function public.crm_create_employee(p_employee jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id text := coalesce(nullif(p_employee->>'id',''), gen_random_uuid()::text);
  v_email text := lower(trim(coalesce(p_employee->>'email','')));
  v_role text := lower(coalesce(nullif(p_employee->>'role',''),'sale'));
begin
  if not public.crm_is_admin() then
    raise exception using errcode='42501', message='Chỉ owner/admin được thêm nhân viên.';
  end if;
  if exists (select 1 from public.app_users where lower(email) = v_email) then
    raise exception using errcode='23505', message='Email nhân viên đã tồn tại.';
  end if;
  insert into public.app_users(id,email,name,role,active,lifecycle_status,can_export,team,
    lifecycle_changed_at,lifecycle_changed_by_email,raw_data,created_at,updated_at)
  values (v_id, v_email, coalesce(nullif(p_employee->>'name',''), v_email), v_role,
    true,'active', coalesce((p_employee->>'canExport')::boolean,false),
    nullif(p_employee->>'team',''), now(), public.crm_current_email(),
    coalesce(p_employee,'{}'::jsonb), now(), now());
  perform public.crm_write_audit('createEmployee','users',v_id,
    jsonb_build_object('email',v_email,'role',v_role,'lifecycleStatus','active'));
  return jsonb_build_object('id',v_id,'email',v_email,'lifecycleStatus','active');
end; $$;

create or replace function public.crm_reactivate_employee(p_employee_id text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_e public.app_users%rowtype;
        v_prev text := coalesce(current_setting('crm.allow_employee_lifecycle', true), '');
begin
  if not public.crm_is_admin() then
    raise exception using errcode='42501', message='Chỉ owner/admin được mở lại nhân viên.';
  end if;
  select * into v_e from public.app_users where id = p_employee_id for update;
  if v_e.id is null then raise exception using errcode='P0002', message='Không tìm thấy nhân viên.'; end if;
  if lower(coalesce(v_e.lifecycle_status,'inactive')) = 'archived' then
    raise exception using errcode='22023', message='Nhân viên đã ARCHIVED; cần phục hồi hồ sơ trước khi kích hoạt.';
  end if;
  perform set_config('crm.allow_employee_lifecycle','on',true);
  update public.app_users set active=true, lifecycle_status='active', inactive_at=null,
    lifecycle_changed_at=now(), lifecycle_changed_by_email=public.crm_current_email(), updated_at=now()
  where id = p_employee_id;
  perform set_config('crm.allow_employee_lifecycle', v_prev, true);
  perform public.crm_write_audit('reactivateEmployee','users',p_employee_id, jsonb_build_object('reason',p_reason));
  return jsonb_build_object('id',p_employee_id,'lifecycleStatus','active');
end; $$;

create or replace function public.crm_deactivate_employee(p_employee_id text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(current_setting('crm.allow_employee_lifecycle', true), '');
begin
  if not public.crm_is_admin() then
    raise exception using errcode='42501', message='Chỉ owner/admin được ngừng nhân viên.';
  end if;
  perform set_config('crm.allow_employee_lifecycle','on',true);
  update public.app_users set active=false, lifecycle_status='inactive', inactive_at=now(), updated_at=now()
  where id = p_employee_id;
  perform set_config('crm.allow_employee_lifecycle', v_prev, true);
  return jsonb_build_object('id',p_employee_id,'lifecycleStatus','inactive');
end; $$;

create or replace function public.crm_archive_employee(p_employee_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_e public.app_users%rowtype;
        v_prev text := coalesce(current_setting('crm.allow_employee_lifecycle', true), '');
begin
  if not public.crm_is_admin() then
    raise exception using errcode='42501', message='Chỉ owner/admin được lưu trữ nhân viên.';
  end if;
  select * into v_e from public.app_users where id = p_employee_id for update;
  if lower(coalesce(v_e.lifecycle_status,'inactive')) <> 'inactive' then
    raise exception using errcode='22023', message='Chỉ hồ sơ INACTIVE mới được lưu trữ.';
  end if;
  perform set_config('crm.allow_employee_lifecycle','on',true);
  update public.app_users set active=false, lifecycle_status='archived', archived_at=now(), updated_at=now()
  where id = p_employee_id;
  perform set_config('crm.allow_employee_lifecycle', v_prev, true);
  return jsonb_build_object('id',p_employee_id,'lifecycleStatus','archived');
end; $$;

-- ---- Bổ sung để tái hiện đúng bề mặt production bị ảnh hưởng ----
-- Bản NGUYÊN THỦY (fail-open) của các helper, copy từ
-- supabase-phase-f-crm-rls-cleanup.sql
create or replace function public.crm_is_owner_or_admin() returns boolean
language sql stable as $$ select public.crm_is_admin(); $$;

create or replace function public.crm_is_manager() returns boolean
language sql stable as $$
  select public.crm_current_user_role() in ('owner','admin','manager','quanly','quản lý','quản lí');
$$;

create table public.customers (
  id text primary key, name text, owner_user_id text,
  is_deleted boolean default false, next_care_date date,
  raw_data jsonb default '{}'::jsonb
);
create table public.customer_assignments (
  id text primary key default gen_random_uuid()::text,
  customer_id text references public.customers(id),
  employee_id text, is_current boolean default true
);

-- copy từ supabase-phase-p0b-employee-assignment.sql
create or replace function public.crm_can_access_customer_id(p_customer_id text)
returns boolean language sql security definer set search_path = public stable as $$
  select public.crm_is_manager()
    or exists (
      select 1 from public.customer_assignments a
      where a.customer_id = p_customer_id and a.is_current
        and a.employee_id = public.crm_current_app_user_id()
    );
$$;

-- RPC đại diện cho 3 call site `if not crm_can_access_customer_id(...)` ở p0a
create or replace function public.crm_snooze_customer(p_customer_id text, p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.crm_can_access_customer_id(p_customer_id) then
    raise exception using errcode='42501', message='Không có quyền với khách hàng này.';
  end if;
  update public.customers set next_care_date = p_date where id = p_customer_id;
  return jsonb_build_object('id', p_customer_id, 'nextCareDate', p_date);
end; $$;

-- copy nguyên guard "chỉ owner được ngừng admin/owner" từ p0b:766
create or replace function public.crm_deactivate_employee(p_employee_id text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_employee public.app_users%rowtype;
        v_prev text := coalesce(current_setting('crm.allow_employee_lifecycle', true), '');
begin
  if not public.crm_is_admin() then
    raise exception using errcode='42501', message='Chỉ owner/admin được ngừng nhân viên.';
  end if;
  select * into v_employee from public.app_users where id = p_employee_id for update;
  if v_employee.id is null then raise exception using errcode='P0002', message='Không tìm thấy nhân viên.'; end if;
  if lower(coalesce(v_employee.lifecycle_status,'inactive')) <> 'active' then
    raise exception using errcode='22023', message='Nhân viên không ở trạng thái ACTIVE.';
  end if;
  if lower(coalesce(v_employee.role,'sale')) in ('admin','owner')
     and public.crm_current_user_role() <> 'owner' then
    raise exception using errcode='42501', message='Chỉ owner được ngừng tài khoản admin/owner.';
  end if;
  perform set_config('crm.allow_employee_lifecycle','on',true);
  update public.app_users set active=false, lifecycle_status='inactive', inactive_at=now(), updated_at=now()
  where id = p_employee_id;
  perform set_config('crm.allow_employee_lifecycle', v_prev, true);
  return jsonb_build_object('id',p_employee_id,'lifecycleStatus','inactive');
end; $$;

create or replace function public.crm_update_employee_profile(p_employee_id text, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text; v_old public.app_users%rowtype;
begin
  if not public.crm_is_admin() then
    raise exception using errcode='42501', message='Chỉ owner/admin được cập nhật nhân viên.';
  end if;
  select * into v_old from public.app_users where id = p_employee_id for update;
  v_role := lower(coalesce(nullif(p_changes->>'role',''), v_old.role));
  update public.app_users set role = v_role, updated_at = now() where id = p_employee_id;
  return jsonb_build_object('id', p_employee_id, 'role', v_role);
end; $$;
