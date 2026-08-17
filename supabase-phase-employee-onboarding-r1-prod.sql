-- =====================================================================
-- EMPLOYEE-ONBOARDING-R1-PROD — New Employee First Login + Returning Employee Relink
-- (R1-0 authorization hotfix đã TÁCH RIÊNG — xem
--  supabase-hotfix-r1-0-crm-is-admin-fail-closed.sql, phải áp TRƯỚC file này)
-- Repository : D:\SUPABASE\CRM-KOLORCERAMIC
-- Target     : STAGING FIRST. Production only after full staging PASS.
--
-- Canonical identity contract (unchanged):
--   auth.users.id -> public.app_users.supabase_auth_id -> public.app_users.id
--   public.app_users.id is the stable BUSINESS identity and never changes.
--
-- This migration does NOT:
--   * disable, loosen or bypass RLS
--   * add any email fallback to a policy
--   * mutate auth.users or auth.identities
--   * change crm_current_app_user_id() / crm_is_active_user()
--   * change crm_link_employee_auth_identity() / crm_relink_employee_auth_identity()
--   * change crm_guard_employee_lifecycle_change() / crm_guard_employee_auth_identity_change()
--   * contain any business DML
--
-- What it adds:
--   R1-1  crm_claim_employee_identity_on_first_login()  self-service LINK, NULL mapping only
--   R1-2  crm_relink_returning_employee_identity(...)   admin RELINK for returning SALE
--   R1-3  crm_restore_archived_employee(...)            owner-only ARCHIVED -> INACTIVE
--   R1-4  crm_employee_identity_status()                admin read-only onboarding status
--   R1-5  drop the now-dead self-create shell INSERT policy (tightening only)
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Preconditions. Fail closed if the identity phase is not deployed.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.identity_link_requests') is null then
    raise exception 'PRECONDITION_FAIL: identity_link_requests is missing. Apply supabase-phase-auth-identity-linking-repair.sql first.';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'app_users'
      and indexname = 'app_users_supabase_auth_id_unique_idx'
  ) then
    raise exception 'PRECONDITION_FAIL: partial unique index on app_users.supabase_auth_id is missing.';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.app_users'::regclass
      and tgname = 'app_users_guard_auth_identity_change'
  ) then
    raise exception 'PRECONDITION_FAIL: app_users_guard_auth_identity_change trigger is missing.';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.app_users'::regclass
      and tgname = 'app_users_guard_lifecycle_change'
  ) then
    raise exception 'PRECONDITION_FAIL: app_users_guard_lifecycle_change trigger is missing.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- BẮT BUỘC: hotfix R1-0 phải LIVE trước.
--
-- R1-0 đã được tách ra artifact riêng
-- (supabase-hotfix-r1-0-crm-is-admin-fail-closed.sql) và phải áp TRƯỚC.
-- Nếu chưa áp, RPC self-claim bên dưới sẽ biến lỗ hổng fail-open hiện có
-- thành leo thang đặc quyền đầy đủ: người ngoài tự tạo hồ sơ Sale rồi
-- self-claim. Migration này TỪ CHỐI cài đặt khi R1-0 chưa live.
-- ---------------------------------------------------------------------
do $$
begin
  if public.crm_is_admin() is null then
    raise exception 'PRECONDITION_FAIL: crm_is_admin() vẫn trả NULL. Áp supabase-hotfix-r1-0-crm-is-admin-fail-closed.sql TRƯỚC.';
  end if;
  if public.crm_is_manager() is null then
    raise exception 'PRECONDITION_FAIL: crm_is_manager() vẫn trả NULL. Áp hotfix R1-0 TRƯỚC.';
  end if;
  if public.crm_current_user_role() is null then
    raise exception 'PRECONDITION_FAIL: crm_current_user_role() vẫn trả NULL. Áp hotfix R1-0 TRƯỚC.';
  end if;
  if pg_get_functiondef(to_regprocedure('public.crm_is_admin()')) !~* 'coalesce' then
    raise exception 'PRECONDITION_FAIL: crm_is_admin() chưa có coalesce fail-closed. Áp hotfix R1-0 TRƯỚC.';
  end if;
  raise notice 'PRECONDITION_PASS: hotfix R1-0 đã live.';
end;
$$;

-- ---------------------------------------------------------------------
-- R1-1. FIRST-LOGIN SELF-CLAIM
--
-- Authority model:
--   * The caller proves nothing but auth.uid(). Every other input is read
--     server-side. There is no employee_id parameter and no email parameter,
--     so a client cannot aim this RPC at a row of its choosing.
--   * The email is read from auth.users, NOT from the auth.email() JWT claim,
--     so the discovery key is the database's own record.
--   * Email is DISCOVERY ONLY. Authority remains the auth.uid() written into
--     app_users.supabase_auth_id.
--
-- Scope limits (deliberately narrow, per phase section 31):
--   * only NULL -> non-null. Never overwrites an existing mapping.
--   * only role = 'sale'. Manager/Admin/Owner keep the operator-only path.
--   * only active + lifecycle_status = 'active'.
--   * fails closed on any ambiguity.
--
-- Non-OK statuses perform NO mutation and are returned as data, not as
-- exceptions, so the frontend can render a business message instead of a
-- Postgres error string.
-- ---------------------------------------------------------------------
create or replace function public.crm_claim_employee_identity_on_first_login()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_auth            auth.users%rowtype;
  v_email           text;
  v_target          public.app_users%rowtype;
  v_app_email_count integer;
  v_auth_email_count integer;
  v_identity_count  integer;
  v_provider_count  integer;
  v_target_id       text;
  v_request_id      uuid;
  v_actor_key       text;
  v_payload_hash    text;
  v_existing        public.identity_link_requests%rowtype;
  v_response        jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('status', 'NOT_AUTHENTICATED');
  end if;

  select * into v_auth from auth.users where id = auth.uid() and deleted_at is null;
  if v_auth.id is null
     or v_auth.email_confirmed_at is null
     or coalesce(v_auth.is_anonymous, false)
     or (v_auth.banned_until is not null and v_auth.banned_until > now()) then
    return jsonb_build_object('status', 'AUTH_NOT_USABLE');
  end if;

  v_email := lower(btrim(coalesce(v_auth.email, '')));
  if v_email = '' then
    return jsonb_build_object('status', 'AUTH_NOT_USABLE');
  end if;

  -- Provider sanity: at least one identity, and no duplicated provider rows.
  -- Multiple DISTINCT providers on one Auth user is valid (email + google).
  select count(*), count(distinct provider)
    into v_identity_count, v_provider_count
  from auth.identities where user_id = v_auth.id;
  if v_identity_count < 1 or v_identity_count <> v_provider_count then
    return jsonb_build_object('status', 'IDENTITY_DISCOVERY_AMBIGUOUS');
  end if;

  -- Discovery must be unique on BOTH sides before anything is locked.
  select count(*) into v_app_email_count
  from public.app_users where lower(btrim(coalesce(email, ''))) = v_email;
  select count(*) into v_auth_email_count
  from auth.users where deleted_at is null and lower(btrim(coalesce(email, ''))) = v_email;

  if v_app_email_count = 0 then
    return jsonb_build_object('status', 'NO_EMPLOYEE_PROFILE');
  end if;
  if v_app_email_count > 1 or v_auth_email_count <> 1 then
    return jsonb_build_object('status', 'IDENTITY_DISCOVERY_AMBIGUOUS');
  end if;

  -- Serialize per employee and per Auth UUID (same lock keys as the canonical RPCs).
  select id into v_target_id from public.app_users
  where lower(btrim(coalesce(email, ''))) = v_email limit 1;
  perform pg_advisory_xact_lock(hashtextextended('crm:identity:employee:' || v_target_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('crm:identity:auth:' || v_auth.id::text, 0));

  select * into v_target from public.app_users
  where lower(btrim(coalesce(email, ''))) = v_email
  for update;

  -- Idempotent no-op: already canonical.
  if v_target.supabase_auth_id = v_auth.id then
    return jsonb_build_object(
      'status', 'ALREADY_LINKED',
      'appUserId', v_target.id,
      'role', v_target.role,
      'lifecycleStatus', v_target.lifecycle_status
    );
  end if;

  -- Stale/foreign mapping is NEVER silently overwritten here (section 32).
  if v_target.supabase_auth_id is not null then
    return jsonb_build_object(
      'status', 'RETURNING_EMPLOYEE_RELINK_REQUIRED',
      'appUserId', v_target.id
    );
  end if;

  -- Privileged roles keep the operator-only LINK path.
  if lower(coalesce(v_target.role, '')) <> 'sale' then
    return jsonb_build_object(
      'status', 'PRIVILEGED_ROLE_MANUAL_LINK_REQUIRED',
      'appUserId', v_target.id,
      'role', v_target.role
    );
  end if;

  if not coalesce(v_target.active, false)
     or lower(coalesce(v_target.lifecycle_status, 'inactive')) <> 'active' then
    return jsonb_build_object(
      'status', 'EMPLOYEE_NOT_ELIGIBLE',
      'appUserId', v_target.id,
      'lifecycleStatus', v_target.lifecycle_status
    );
  end if;

  -- This Auth UUID must not already belong to a different employee.
  if exists (
    select 1 from public.app_users
    where id <> v_target.id and supabase_auth_id = v_auth.id
  ) then
    return jsonb_build_object('status', 'AUTH_ALREADY_MAPPED');
  end if;

  -- Deterministic request id => concurrent duplicate calls collapse to one
  -- ledger row instead of racing (section 38).
  v_request_id := md5('crm:firstlogin:' || v_target.id || ':' || v_auth.id::text)::uuid;
  v_actor_key  := 'self:first-login:' || v_target.id;
  v_payload_hash := public.crm_identity_payload_hash(jsonb_build_object(
    'operation', 'LINK', 'schemaVersion', 1, 'targetAppUserId', v_target.id,
    'newAuthUserId', v_auth.id, 'expectedCurrentAuthId', null,
    'reason', 'FIRST_LOGIN_SELF_CLAIM'
  ));

  perform pg_advisory_xact_lock(
    hashtextextended('crm:identity:request:' || v_actor_key || ':LINK:' || v_request_id::text, 0));

  select * into v_existing from public.identity_link_requests
  where actor_key = v_actor_key and operation = 'LINK' and request_id = v_request_id;
  if v_existing.id is not null then
    return jsonb_set(v_existing.response, '{replayed}', 'true'::jsonb, true);
  end if;

  perform set_config('crm.allow_identity_write', 'on', true);
  update public.app_users
  set supabase_auth_id = v_auth.id, updated_at = now()
  where id = v_target.id;
  perform set_config('crm.allow_identity_write', '', true);

  v_response := jsonb_build_object(
    'status', 'LINKED',
    'operation', 'LINK',
    'appUserId', v_target.id,
    'targetAppUserId', v_target.id,
    'previousAuthId', null,
    'newAuthId', v_auth.id,
    'role', v_target.role,
    'lifecycleStatus', v_target.lifecycle_status,
    'source', 'firstLoginSelfClaim',
    'replayed', false
  );

  insert into public.identity_link_requests(
    actor_key, actor_app_user_id, actor_auth_id, operation, request_id,
    target_app_user_id, previous_auth_id, new_auth_id, reason,
    request_payload_hash, response
  ) values (
    v_actor_key, v_target.id, v_auth.id, 'LINK', v_request_id,
    v_target.id, null, v_auth.id, 'FIRST_LOGIN_SELF_CLAIM',
    v_payload_hash, v_response
  );

  perform public.crm_write_audit('linkEmployeeAuthIdentity', 'users', v_target.id,
    jsonb_build_object(
      'operation', 'LINK', 'actorKey', v_actor_key, 'actorAppUserId', v_target.id,
      'previousAuthId', null, 'newAuthId', v_auth.id, 'requestId', v_request_id,
      'reason', 'FIRST_LOGIN_SELF_CLAIM', 'role', v_target.role,
      'lifecycleStatus', v_target.lifecycle_status,
      'source', 'firstLoginSelfClaim', 'result', 'linked'
    ));

  return v_response;
end;
$$;

-- ---------------------------------------------------------------------
-- R1-2. RETURNING EMPLOYEE RELINK (SALE)
--
-- Why a separate RPC instead of reusing crm_relink_employee_auth_identity:
--   the existing RELINK is deliberately reserved for active Admin/Owner and
--   requires an OWNER actor. Widening it would weaken an operator repair RPC
--   (phase section 5). This one is narrower: SALE targets only, admin/owner
--   actor, and it keeps every safety guard of the original.
--
-- Preconditions enforced (phase section 9):
--   * target is SALE, active, lifecycle active  (reactivate FIRST, section 10)
--   * current mapping is non-null and equals p_expected_current_auth_id
--   * the OLD Auth UUID no longer exists in auth.users  (proven stale)
--   * the OLD Auth UUID is not referenced by another employee
--   * the NEW Auth user is confirmed, signed in, not deleted/anon/banned
--   * NEW Auth email == employee email
--   * email unique on both sides, provider identities unambiguous
--   * NEW Auth UUID unmapped elsewhere
-- ---------------------------------------------------------------------
create or replace function public.crm_relink_returning_employee_identity(
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
  v_actor  public.app_users%rowtype;
  v_target public.app_users%rowtype;
  v_auth   auth.users%rowtype;
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
    raise exception using errcode = '22023',
      message = 'RETURNING_RELINK_INVALID_REQUEST: Target, old/new Auth IDs, request ID and reason are required.';
  end if;
  if p_auth_user_id = p_expected_current_auth_id then
    raise exception using errcode = '22023',
      message = 'RETURNING_RELINK_NO_CHANGE: Replacement Auth ID must differ.';
  end if;

  if auth.uid() is null then
    if session_user <> 'postgres' then
      raise exception using errcode = '42501',
        message = 'RETURNING_RELINK_FORBIDDEN: Canonical owner/admin or authorized DB operator required.';
    end if;
    v_actor_key := 'system:postgres-owner-authorized';
  else
    select * into v_actor from public.app_users
    where supabase_auth_id = auth.uid()
      and coalesce(active, false) = true
      and lower(coalesce(lifecycle_status, 'inactive')) = 'active'
    for key share;
    if v_actor.id is null or lower(coalesce(v_actor.role, '')) not in ('owner', 'admin') then
      raise exception using errcode = '42501',
        message = 'RETURNING_RELINK_FORBIDDEN: Only canonical owner/admin can relink a returning Sale identity.';
    end if;
    v_actor_key := 'app:' || v_actor.id;
  end if;

  v_payload_hash := public.crm_identity_payload_hash(jsonb_build_object(
    'operation', 'RELINK', 'schemaVersion', 1, 'targetAppUserId', p_app_user_id,
    'newAuthUserId', p_auth_user_id, 'expectedCurrentAuthId', p_expected_current_auth_id,
    'reason', btrim(p_reason)
  ));
  perform pg_advisory_xact_lock(
    hashtextextended('crm:identity:request:' || v_actor_key || ':RELINK:' || p_request_id::text, 0));

  select * into v_existing from public.identity_link_requests
  where actor_key = v_actor_key and operation = 'RELINK' and request_id = p_request_id;
  if v_existing.id is not null then
    if v_existing.request_payload_hash <> v_payload_hash then
      raise exception using errcode = '23505',
        message = 'IDENTITY_REQUEST_PAYLOAD_CONFLICT: Request ID was already used with a different payload.';
    end if;
    return jsonb_set(v_existing.response, '{replayed}', 'true'::jsonb, true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('crm:identity:employee:' || p_app_user_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('crm:identity:auth:' || p_auth_user_id::text, 0));

  select * into v_target from public.app_users where id = p_app_user_id for update;
  if v_target.id is null then
    raise exception using errcode = 'P0002', message = 'IDENTITY_TARGET_NOT_FOUND: Employee does not exist.';
  end if;

  -- SALE only. Admin/Owner keep crm_relink_employee_auth_identity (owner-only).
  if lower(coalesce(v_target.role, '')) <> 'sale' then
    raise exception using errcode = '42501',
      message = 'RETURNING_RELINK_TARGET_NOT_ELIGIBLE: This RPC handles Sale employees only; use the owner RELINK for privileged roles.';
  end if;

  -- Lifecycle must already be restored through the lifecycle RPCs (section 10).
  if not coalesce(v_target.active, false)
     or lower(coalesce(v_target.lifecycle_status, 'inactive')) <> 'active' then
    raise exception using errcode = '42501',
      message = 'RETURNING_RELINK_LIFECYCLE_REQUIRED: Reactivate the employee through the lifecycle RPC before relinking.';
  end if;

  if v_target.supabase_auth_id is null then
    raise exception using errcode = '22023',
      message = 'RETURNING_RELINK_MAPPING_IS_NULL: Mapping is NULL; use LINK, not RELINK.';
  end if;
  if v_target.supabase_auth_id is distinct from p_expected_current_auth_id then
    raise exception using errcode = '40001',
      message = 'IDENTITY_EXPECTED_MAPPING_CONFLICT: Current mapping changed.';
  end if;

  -- The old mapping must be provably dead.
  if exists (select 1 from auth.users where id = p_expected_current_auth_id and deleted_at is null) then
    raise exception using errcode = '55000',
      message = 'IDENTITY_EXISTING_MAPPING_VALID: Existing Auth ID still exists; automatic relink is forbidden.';
  end if;
  if exists (select 1 from public.app_users
             where id <> v_target.id and supabase_auth_id = p_expected_current_auth_id) then
    raise exception using errcode = '23505',
      message = 'IDENTITY_STALE_MAPPING_CONFLICT: Old Auth ID is referenced by another employee.';
  end if;

  select * into v_auth from auth.users where id = p_auth_user_id and deleted_at is null for key share;
  if v_auth.id is null or v_auth.email_confirmed_at is null or v_auth.last_sign_in_at is null
     or coalesce(v_auth.is_anonymous, false)
     or (v_auth.banned_until is not null and v_auth.banned_until > now()) then
    raise exception using errcode = '42501',
      message = 'IDENTITY_AUTH_NOT_USABLE: Replacement Auth is missing, never signed in, unconfirmed, anonymous or banned.';
  end if;
  if exists (select 1 from public.app_users
             where id <> v_target.id and supabase_auth_id = p_auth_user_id) then
    raise exception using errcode = '23505',
      message = 'IDENTITY_AUTH_ALREADY_MAPPED: Replacement Auth ID belongs to another employee.';
  end if;
  if lower(btrim(coalesce(v_auth.email, ''))) <> lower(btrim(coalesce(v_target.email, ''))) then
    raise exception using errcode = '22023',
      message = 'IDENTITY_EMAIL_DISCOVERY_MISMATCH: Auth and employee emails do not match.';
  end if;

  select count(*) into v_auth_email_count from auth.users
  where deleted_at is null and lower(btrim(coalesce(email, ''))) = lower(btrim(v_target.email));
  select count(*) into v_app_email_count from public.app_users
  where lower(btrim(coalesce(email, ''))) = lower(btrim(v_target.email));
  select count(*), count(distinct provider) into v_identity_count, v_provider_count
  from auth.identities where user_id = p_auth_user_id;
  if v_auth_email_count <> 1 or v_app_email_count <> 1
     or v_identity_count < 1 or v_identity_count <> v_provider_count then
    raise exception using errcode = '23505',
      message = 'IDENTITY_DISCOVERY_AMBIGUOUS: Email/provider identity is not unique.';
  end if;

  perform set_config('crm.allow_identity_write', 'on', true);
  update public.app_users
  set supabase_auth_id = p_auth_user_id, updated_at = now()
  where id = v_target.id;
  perform set_config('crm.allow_identity_write', '', true);

  v_response := jsonb_build_object(
    'status', 'RELINKED',
    'operation', 'RELINK',
    'appUserId', v_target.id,
    'targetAppUserId', v_target.id,
    'previousAuthId', p_expected_current_auth_id,
    'newAuthId', p_auth_user_id,
    'role', v_target.role,
    'lifecycleStatus', v_target.lifecycle_status,
    'source', 'returningEmployeeRelink',
    'replayed', false
  );

  insert into public.identity_link_requests(
    actor_key, actor_app_user_id, actor_auth_id, operation, request_id,
    target_app_user_id, previous_auth_id, new_auth_id, reason,
    request_payload_hash, response
  ) values (
    v_actor_key, v_actor.id, auth.uid(), 'RELINK', p_request_id,
    v_target.id, p_expected_current_auth_id, p_auth_user_id, btrim(p_reason),
    v_payload_hash, v_response
  );

  perform public.crm_write_audit('relinkReturningEmployeeAuthIdentity', 'users', v_target.id,
    jsonb_build_object(
      'operation', 'RELINK', 'actorKey', v_actor_key, 'actorAppUserId', v_actor.id,
      'previousAuthId', p_expected_current_auth_id, 'newAuthId', p_auth_user_id,
      'requestId', p_request_id, 'reason', btrim(p_reason), 'role', v_target.role,
      'lifecycleStatus', v_target.lifecycle_status,
      'source', 'returningEmployeeRelink', 'result', 'relinked'
    ));

  return v_response;
end;
$$;

-- ---------------------------------------------------------------------
-- R1-3. ARCHIVED -> INACTIVE RESTORE (rehire path)
--
-- Blocker this closes: crm_reactivate_employee() refuses ARCHIVED rows and
-- no unarchive RPC exists, so a legitimately rehired employee had NO
-- supported path back. Deleting and recreating the row would break
-- app_users.id stability and every historical FK, which section 13/26 forbid.
--
-- Deliberately conservative: OWNER only (crm_reactivate_employee is admin),
-- and it restores to INACTIVE, not ACTIVE. The owner then uses the existing
-- crm_reactivate_employee() to go INACTIVE -> ACTIVE. Two explicit steps.
-- The lifecycle guard trigger stays enabled; this RPC uses the sanctioned
-- crm.allow_employee_lifecycle switch exactly like the other lifecycle RPCs.
-- ---------------------------------------------------------------------
create or replace function public.crm_restore_archived_employee(
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
  v_previous_guard text := coalesce(current_setting('crm.allow_employee_lifecycle', true), '');
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023',
      message = 'RESTORE_REASON_REQUIRED: Lý do phục hồi hồ sơ nhân viên là bắt buộc.';
  end if;
  if coalesce(public.crm_current_user_role(), '') <> 'owner' then
    raise exception using errcode = '42501',
      message = 'Chỉ owner được phục hồi hồ sơ nhân viên đã lưu trữ.';
  end if;

  select * into v_employee from public.app_users where id = p_employee_id for update;
  if v_employee.id is null then
    raise exception using errcode = 'P0002', message = 'Không tìm thấy nhân viên.';
  end if;
  if lower(coalesce(v_employee.lifecycle_status, 'inactive')) <> 'archived' then
    raise exception using errcode = '22023',
      message = 'Chỉ hồ sơ ARCHIVED mới cần phục hồi.';
  end if;

  perform set_config('crm.allow_employee_lifecycle', 'on', true);
  update public.app_users
  set active = false,
      lifecycle_status = 'inactive',
      archived_at = null,
      lifecycle_changed_at = now(),
      lifecycle_changed_by_email = public.crm_current_email(),
      raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
        'active', false, 'lifecycleStatus', 'inactive', 'restoredAt', now(),
        'lifecycleReason', btrim(p_reason),
        'lifecycleChangedByEmail', public.crm_current_email()
      ),
      updated_at = now()
  where id = p_employee_id;
  perform set_config('crm.allow_employee_lifecycle', v_previous_guard, true);

  perform public.crm_write_audit('restoreArchivedEmployee', 'users', p_employee_id,
    jsonb_build_object(
      'employeeEmail', v_employee.email, 'reason', btrim(p_reason),
      'previousLifecycleStatus', 'archived', 'lifecycleStatus', 'inactive'
    ));

  return jsonb_build_object('id', p_employee_id, 'lifecycleStatus', 'inactive');
end;
$$;

-- ---------------------------------------------------------------------
-- R1-4. ADMIN ONBOARDING STATUS (read-only)
--
-- The Admin UI cannot query auth.users, so it cannot tell "waiting for first
-- login" apart from "Auth account was deleted, needs relink". This exposes
-- exactly that classification and nothing else. No tokens, no password
-- hashes, no Auth internals beyond the candidate UUID and last sign-in.
-- ---------------------------------------------------------------------
create or replace function public.crm_employee_identity_status()
returns table (
  app_user_id text,
  email text,
  role text,
  active boolean,
  lifecycle_status text,
  supabase_auth_id uuid,
  identity_status text,
  candidate_auth_user_id uuid,
  candidate_last_sign_in_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not coalesce(public.crm_is_admin(), false) then
    raise exception using errcode = '42501',
      message = 'Chỉ owner/admin được xem trạng thái liên kết tài khoản nhân viên.';
  end if;

  return query
  with app as (
    select u.*, lower(btrim(coalesce(u.email, ''))) as norm_email
    from public.app_users u
  ),
  app_dup as (
    select norm_email from app group by norm_email having count(*) > 1
  ),
  auth_candidate as (
    select lower(btrim(coalesce(a.email, ''))) as norm_email,
           min(a.id::text)::uuid as auth_id,
           max(a.last_sign_in_at) as last_sign_in_at,
           count(*) as n
    from auth.users a
    where a.deleted_at is null
    group by 1
  )
  select
    app.id,
    app.email,
    app.role,
    app.active,
    app.lifecycle_status,
    app.supabase_auth_id,
    case
      when app.norm_email in (select norm_email from app_dup)
        or coalesce(c.n, 0) > 1                              then 'AMBIGUOUS'
      when app.supabase_auth_id is null and c.auth_id is null then 'AWAITING_FIRST_LOGIN'
      when app.supabase_auth_id is null                       then 'READY_TO_LINK'
      when app.supabase_auth_id = c.auth_id                   then 'LINKED'
      when not exists (select 1 from auth.users a2
                       where a2.id = app.supabase_auth_id and a2.deleted_at is null)
                                                              then 'RELINK_REQUIRED'
      else                                                         'MAPPING_MISMATCH'
    end as identity_status,
    c.auth_id,
    c.last_sign_in_at
  from app
  left join auth_candidate c on c.norm_email = app.norm_email
  order by app.email;
end;
$$;

-- ---------------------------------------------------------------------
-- R1-5. Remove the dead self-create shell INSERT policy.
--
-- This policy existed only to let loadAppUser() insert an inactive shell row
-- when the supabase_auth_id lookup missed. That fallback is removed in the
-- frontend of this phase, and the policy is a standing hole: any
-- authenticated Auth user could insert a row into public.app_users.
--
-- This is a TIGHTENING, not a weakening. crm_create_employee() is SECURITY
-- DEFINER and is unaffected. No other code path inserts into app_users.
--
-- Rollback if ever needed is recorded in the phase report, section 8.
-- ---------------------------------------------------------------------
drop policy if exists "app users self create inactive" on public.app_users;
drop policy if exists "app users create own inactive profile" on public.app_users;

-- ---------------------------------------------------------------------
-- Grants. Least privilege, same posture as the identity phase.
-- ---------------------------------------------------------------------
revoke all on function public.crm_claim_employee_identity_on_first_login()
  from public, anon, authenticated;
grant execute on function public.crm_claim_employee_identity_on_first_login()
  to authenticated;

revoke all on function public.crm_relink_returning_employee_identity(text, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.crm_relink_returning_employee_identity(text, uuid, uuid, text, uuid)
  to authenticated;

revoke all on function public.crm_restore_archived_employee(text, text)
  from public, anon, authenticated;
grant execute on function public.crm_restore_archived_employee(text, text)
  to authenticated;

revoke all on function public.crm_employee_identity_status()
  from public, anon, authenticated;
grant execute on function public.crm_employee_identity_status()
  to authenticated;

commit;
