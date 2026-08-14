-- Canonical Auth identity linking/relinking for CRM employees.
-- Stage and validate before any production execution.

begin;

create unique index if not exists app_users_supabase_auth_id_unique_idx
  on public.app_users(supabase_auth_id)
  where supabase_auth_id is not null;

create table if not exists public.identity_link_requests (
  id uuid primary key default gen_random_uuid(),
  actor_key text not null,
  actor_app_user_id text references public.app_users(id) on delete restrict,
  actor_auth_id uuid,
  operation text not null check (operation in ('LINK', 'RELINK')),
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

alter table public.identity_link_requests enable row level security;
revoke all on public.identity_link_requests from public, anon, authenticated, service_role;

create or replace function public.crm_identity_payload_hash(p_payload jsonb)
returns text
language sql
security definer
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function public.crm_guard_employee_auth_identity_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.supabase_auth_id is distinct from new.supabase_auth_id
     and coalesce(current_setting('crm.allow_identity_write', true), '') <> 'on' then
    raise exception using
      errcode = '42501',
      message = 'EMPLOYEE_AUTH_IDENTITY_RPC_REQUIRED: Auth mapping must be changed through the canonical identity RPC.';
  end if;
  return new;
end;
$$;

drop trigger if exists app_users_guard_auth_identity_change on public.app_users;
create trigger app_users_guard_auth_identity_change
before update of supabase_auth_id on public.app_users
for each row execute function public.crm_guard_employee_auth_identity_change();

-- Canonical runtime authority: Auth UUID -> explicit business identity bridge.
-- This helper resolves the bridge even after deactivation, solely so a user can
-- read their own employee status. It must not be used as a CRM access grant.
create or replace function public.crm_auth_linked_app_user_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from public.app_users u
  where auth.uid() is not null
    and u.supabase_auth_id = auth.uid()
  limit 1;
$$;

create or replace function public.crm_current_app_user_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from public.app_users u
  where auth.uid() is not null
    and u.supabase_auth_id = auth.uid()
    and coalesce(u.active, false) = true
    and lower(coalesce(u.lifecycle_status, 'inactive')) = 'active'
  limit 1;
$$;

create or replace function public.crm_current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(u.role, ''))
  from public.app_users u
  where u.id = public.crm_current_app_user_id()
  limit 1;
$$;

create or replace function public.crm_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.crm_current_user_role();
$$;

create or replace function public.crm_is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.crm_current_app_user_id() is not null;
$$;

drop policy if exists "app users read self or manager" on public.app_users;
create policy "app users read self or manager" on public.app_users
for select to authenticated
using (id = public.crm_auth_linked_app_user_id() or public.crm_is_manager());

-- Authenticated clients may create an employee/profile shell, but the Auth
-- bridge is established only by the audited identity RPCs below.
drop policy if exists "app users self create inactive" on public.app_users;
create policy "app users self create inactive" on public.app_users
for insert to authenticated
with check (
  lower(coalesce(email, '')) = public.crm_current_email()
  and coalesce(active, false) = false
  and lower(coalesce(lifecycle_status, 'inactive')) = 'inactive'
  and supabase_auth_id is null
);

drop policy if exists "app users admin insert" on public.app_users;
create policy "app users admin insert" on public.app_users
for insert to authenticated
with check (public.crm_is_admin() and supabase_auth_id is null);

create or replace function public.crm_link_employee_auth_identity(
  p_app_user_id text,
  p_auth_user_id uuid,
  p_expected_current_auth_id uuid,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor public.app_users%rowtype;
  v_target public.app_users%rowtype;
  v_auth auth.users%rowtype;
  v_actor_key text;
  v_payload_hash text;
  v_existing public.identity_link_requests%rowtype;
  v_response jsonb;
  v_auth_email_count integer;
  v_app_email_count integer;
  v_identity_count integer;
  v_provider_count integer;
begin
  if p_app_user_id is null or p_auth_user_id is null or p_request_id is null
     or nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'IDENTITY_LINK_INVALID_REQUEST: Target, Auth ID, request ID and reason are required.';
  end if;

  if auth.uid() is null then
    if session_user <> 'postgres' then
      raise exception using errcode = '42501', message = 'IDENTITY_LINK_FORBIDDEN: Canonical owner/admin or authorized DB operator required.';
    end if;
    v_actor_key := 'system:postgres-owner-authorized';
  else
    select * into v_actor from public.app_users
    where supabase_auth_id = auth.uid()
      and coalesce(active, false) = true
      and lower(coalesce(lifecycle_status, 'inactive')) = 'active'
    for key share;
    if v_actor.id is null or lower(coalesce(v_actor.role, '')) not in ('owner', 'admin') then
      raise exception using errcode = '42501', message = 'IDENTITY_LINK_FORBIDDEN: Only canonical owner/admin can link Sale identities.';
    end if;
    v_actor_key := 'app:' || v_actor.id;
  end if;

  v_payload_hash := public.crm_identity_payload_hash(jsonb_build_object(
    'operation', 'LINK', 'schemaVersion', 1, 'targetAppUserId', p_app_user_id,
    'newAuthUserId', p_auth_user_id, 'expectedCurrentAuthId', p_expected_current_auth_id,
    'reason', btrim(p_reason)
  ));
  perform pg_advisory_xact_lock(hashtextextended('crm:identity:request:' || v_actor_key || ':LINK:' || p_request_id::text, 0));

  select * into v_existing from public.identity_link_requests
  where actor_key = v_actor_key and operation = 'LINK' and request_id = p_request_id;
  if v_existing.id is not null then
    if v_existing.request_payload_hash <> v_payload_hash then
      raise exception using errcode = '23505', message = 'IDENTITY_REQUEST_PAYLOAD_CONFLICT: Request ID was already used with a different payload.';
    end if;
    return jsonb_set(v_existing.response, '{replayed}', 'true'::jsonb, true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('crm:identity:employee:' || p_app_user_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('crm:identity:auth:' || p_auth_user_id::text, 0));
  select * into v_target from public.app_users where id = p_app_user_id for update;
  if v_target.id is null then raise exception using errcode = 'P0002', message = 'IDENTITY_TARGET_NOT_FOUND: Employee does not exist.'; end if;
  if not coalesce(v_target.active, false) or lower(coalesce(v_target.lifecycle_status, 'inactive')) <> 'active'
     or lower(coalesce(v_target.role, '')) <> 'sale' then
    raise exception using errcode = '42501', message = 'IDENTITY_TARGET_NOT_ELIGIBLE: Only active Sale employees can use LINK.';
  end if;
  if v_target.supabase_auth_id is distinct from p_expected_current_auth_id or v_target.supabase_auth_id is not null then
    raise exception using errcode = '40001', message = 'IDENTITY_EXPECTED_MAPPING_CONFLICT: Sale mapping is no longer NULL/expected.';
  end if;

  select * into v_auth from auth.users where id = p_auth_user_id and deleted_at is null for key share;
  if v_auth.id is null or v_auth.email_confirmed_at is null or coalesce(v_auth.is_anonymous, false)
     or (v_auth.banned_until is not null and v_auth.banned_until > now()) then
    raise exception using errcode = '42501', message = 'IDENTITY_AUTH_NOT_USABLE: Auth user is missing, deleted, unconfirmed, anonymous or banned.';
  end if;
  if exists(select 1 from public.app_users where id <> v_target.id and supabase_auth_id = p_auth_user_id) then
    raise exception using errcode = '23505', message = 'IDENTITY_AUTH_ALREADY_MAPPED: Auth ID belongs to another employee.';
  end if;
  if lower(btrim(coalesce(v_auth.email, ''))) <> lower(btrim(coalesce(v_target.email, ''))) then
    raise exception using errcode = '22023', message = 'IDENTITY_EMAIL_DISCOVERY_MISMATCH: Auth and employee emails do not match.';
  end if;

  select count(*) into v_auth_email_count from auth.users
  where deleted_at is null and lower(btrim(coalesce(email, ''))) = lower(btrim(v_target.email));
  select count(*) into v_app_email_count from public.app_users
  where lower(btrim(coalesce(email, ''))) = lower(btrim(v_target.email));
  select count(*), count(distinct provider) into v_identity_count, v_provider_count
  from auth.identities where user_id = p_auth_user_id;
  if v_auth_email_count <> 1 or v_app_email_count <> 1 or v_identity_count < 1
     or v_identity_count <> v_provider_count then
    raise exception using errcode = '23505', message = 'IDENTITY_DISCOVERY_AMBIGUOUS: Email/provider identity is not unique.';
  end if;

  perform set_config('crm.allow_identity_write', 'on', true);
  update public.app_users set supabase_auth_id = p_auth_user_id, updated_at = now() where id = v_target.id;

  v_response := jsonb_build_object(
    'operation', 'LINK', 'targetAppUserId', v_target.id, 'previousAuthId', null,
    'newAuthId', p_auth_user_id, 'role', v_target.role, 'lifecycleStatus', v_target.lifecycle_status,
    'replayed', false
  );
  insert into public.identity_link_requests(
    actor_key, actor_app_user_id, actor_auth_id, operation, request_id, target_app_user_id,
    previous_auth_id, new_auth_id, reason, request_payload_hash, response
  ) values(
    v_actor_key, v_actor.id, auth.uid(), 'LINK', p_request_id, v_target.id,
    null, p_auth_user_id, btrim(p_reason), v_payload_hash, v_response
  );
  perform public.crm_write_audit('linkEmployeeAuthIdentity', 'users', v_target.id, jsonb_build_object(
    'operation', 'LINK', 'actorKey', v_actor_key, 'actorAppUserId', v_actor.id,
    'previousAuthId', null, 'newAuthId', p_auth_user_id, 'requestId', p_request_id,
    'reason', btrim(p_reason), 'role', v_target.role, 'lifecycleStatus', v_target.lifecycle_status,
    'result', 'linked'
  ));
  return v_response;
end;
$$;

create or replace function public.crm_relink_employee_auth_identity(
  p_app_user_id text,
  p_auth_user_id uuid,
  p_expected_current_auth_id uuid,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor public.app_users%rowtype;
  v_target public.app_users%rowtype;
  v_auth auth.users%rowtype;
  v_actor_key text;
  v_payload_hash text;
  v_existing public.identity_link_requests%rowtype;
  v_response jsonb;
  v_auth_email_count integer;
  v_app_email_count integer;
  v_identity_count integer;
  v_provider_count integer;
begin
  if p_app_user_id is null or p_auth_user_id is null or p_expected_current_auth_id is null
     or p_request_id is null or nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'IDENTITY_RELINK_INVALID_REQUEST: Target, old/new Auth IDs, request ID and reason are required.';
  end if;
  if p_auth_user_id = p_expected_current_auth_id then
    raise exception using errcode = '22023', message = 'IDENTITY_RELINK_NO_CHANGE: Replacement Auth ID must differ.';
  end if;

  if auth.uid() is null then
    if session_user <> 'postgres' then
      raise exception using errcode = '42501', message = 'IDENTITY_RELINK_FORBIDDEN: Canonical owner or authorized DB operator required.';
    end if;
    v_actor_key := 'system:postgres-owner-authorized';
  else
    select * into v_actor from public.app_users
    where supabase_auth_id = auth.uid()
      and coalesce(active, false) = true
      and lower(coalesce(lifecycle_status, 'inactive')) = 'active'
    for key share;
    if v_actor.id is null or lower(coalesce(v_actor.role, '')) <> 'owner' then
      raise exception using errcode = '42501', message = 'IDENTITY_RELINK_FORBIDDEN: Only canonical owner can relink privileged identities.';
    end if;
    v_actor_key := 'app:' || v_actor.id;
  end if;

  v_payload_hash := public.crm_identity_payload_hash(jsonb_build_object(
    'operation', 'RELINK', 'schemaVersion', 1, 'targetAppUserId', p_app_user_id,
    'newAuthUserId', p_auth_user_id, 'expectedCurrentAuthId', p_expected_current_auth_id,
    'reason', btrim(p_reason)
  ));
  perform pg_advisory_xact_lock(hashtextextended('crm:identity:request:' || v_actor_key || ':RELINK:' || p_request_id::text, 0));
  select * into v_existing from public.identity_link_requests
  where actor_key = v_actor_key and operation = 'RELINK' and request_id = p_request_id;
  if v_existing.id is not null then
    if v_existing.request_payload_hash <> v_payload_hash then
      raise exception using errcode = '23505', message = 'IDENTITY_REQUEST_PAYLOAD_CONFLICT: Request ID was already used with a different payload.';
    end if;
    return jsonb_set(v_existing.response, '{replayed}', 'true'::jsonb, true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('crm:identity:employee:' || p_app_user_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('crm:identity:auth:' || p_auth_user_id::text, 0));
  select * into v_target from public.app_users where id = p_app_user_id for update;
  if v_target.id is null then raise exception using errcode = 'P0002', message = 'IDENTITY_TARGET_NOT_FOUND: Employee does not exist.'; end if;
  if not coalesce(v_target.active, false) or lower(coalesce(v_target.lifecycle_status, 'inactive')) <> 'active'
     or lower(coalesce(v_target.role, '')) not in ('admin', 'owner') then
    raise exception using errcode = '42501', message = 'IDENTITY_TARGET_NOT_ELIGIBLE: RELINK is reserved for active Admin/Owner.';
  end if;
  if v_target.supabase_auth_id is distinct from p_expected_current_auth_id then
    raise exception using errcode = '40001', message = 'IDENTITY_EXPECTED_MAPPING_CONFLICT: Current mapping changed.';
  end if;
  if exists(select 1 from auth.users where id = p_expected_current_auth_id and deleted_at is null) then
    raise exception using errcode = '55000', message = 'IDENTITY_EXISTING_MAPPING_VALID: Existing Auth ID still exists; automatic relink is forbidden.';
  end if;
  if exists(select 1 from public.app_users where id <> v_target.id and supabase_auth_id = p_expected_current_auth_id) then
    raise exception using errcode = '23505', message = 'IDENTITY_STALE_MAPPING_CONFLICT: Old Auth ID is referenced by another employee.';
  end if;

  select * into v_auth from auth.users where id = p_auth_user_id and deleted_at is null for key share;
  if v_auth.id is null or v_auth.email_confirmed_at is null or v_auth.last_sign_in_at is null
     or v_auth.last_sign_in_at < now() - interval '180 days' or coalesce(v_auth.is_anonymous, false)
     or (v_auth.banned_until is not null and v_auth.banned_until > now()) then
    raise exception using errcode = '42501', message = 'IDENTITY_AUTH_NOT_USABLE: Replacement Auth is missing, stale-login, unconfirmed, anonymous or banned.';
  end if;
  if exists(select 1 from public.app_users where id <> v_target.id and supabase_auth_id = p_auth_user_id) then
    raise exception using errcode = '23505', message = 'IDENTITY_AUTH_ALREADY_MAPPED: Replacement Auth ID belongs to another employee.';
  end if;
  if lower(btrim(coalesce(v_auth.email, ''))) <> lower(btrim(coalesce(v_target.email, ''))) then
    raise exception using errcode = '22023', message = 'IDENTITY_EMAIL_DISCOVERY_MISMATCH: Auth and employee emails do not match.';
  end if;
  select count(*) into v_auth_email_count from auth.users
  where deleted_at is null and lower(btrim(coalesce(email, ''))) = lower(btrim(v_target.email));
  select count(*) into v_app_email_count from public.app_users
  where lower(btrim(coalesce(email, ''))) = lower(btrim(v_target.email));
  select count(*), count(distinct provider) into v_identity_count, v_provider_count
  from auth.identities where user_id = p_auth_user_id;
  if v_auth_email_count <> 1 or v_app_email_count <> 1 or v_identity_count < 1
     or v_identity_count <> v_provider_count then
    raise exception using errcode = '23505', message = 'IDENTITY_DISCOVERY_AMBIGUOUS: Email/provider identity is not unique.';
  end if;

  perform set_config('crm.allow_identity_write', 'on', true);
  update public.app_users set supabase_auth_id = p_auth_user_id, updated_at = now() where id = v_target.id;
  v_response := jsonb_build_object(
    'operation', 'RELINK', 'targetAppUserId', v_target.id, 'previousAuthId', p_expected_current_auth_id,
    'newAuthId', p_auth_user_id, 'role', v_target.role, 'lifecycleStatus', v_target.lifecycle_status,
    'replayed', false
  );
  insert into public.identity_link_requests(
    actor_key, actor_app_user_id, actor_auth_id, operation, request_id, target_app_user_id,
    previous_auth_id, new_auth_id, reason, request_payload_hash, response
  ) values(
    v_actor_key, v_actor.id, auth.uid(), 'RELINK', p_request_id, v_target.id,
    p_expected_current_auth_id, p_auth_user_id, btrim(p_reason), v_payload_hash, v_response
  );
  perform public.crm_write_audit('relinkEmployeeAuthIdentity', 'users', v_target.id, jsonb_build_object(
    'operation', 'RELINK', 'actorKey', v_actor_key, 'actorAppUserId', v_actor.id,
    'previousAuthId', p_expected_current_auth_id, 'newAuthId', p_auth_user_id,
    'requestId', p_request_id, 'reason', btrim(p_reason), 'role', v_target.role,
    'lifecycleStatus', v_target.lifecycle_status, 'result', 'relinked'
  ));
  return v_response;
end;
$$;

revoke all on function public.crm_identity_payload_hash(jsonb) from public, anon, authenticated;
revoke all on function public.crm_guard_employee_auth_identity_change() from public, anon, authenticated;
revoke all on function public.crm_auth_linked_app_user_id() from public, anon;
grant execute on function public.crm_auth_linked_app_user_id() to authenticated;
revoke all on function public.crm_link_employee_auth_identity(text, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_relink_employee_auth_identity(text, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.crm_link_employee_auth_identity(text, uuid, uuid, text, uuid) to authenticated;
grant execute on function public.crm_relink_employee_auth_identity(text, uuid, uuid, text, uuid) to authenticated;

commit;
