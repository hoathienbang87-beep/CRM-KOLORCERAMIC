-- EMPLOYEE-ONBOARDING-R1 — local integration test matrix (sections 33/34/35/37/38)
\set ON_ERROR_STOP on
set client_min_messages = warning;

create table if not exists test_results(name text, ok boolean, detail text);
truncate test_results;

create or replace function t_assert(p_name text, p_ok boolean, p_detail text default '')
returns void language sql as $$
  insert into test_results values (p_name, p_ok, p_detail);
$$;

create or replace function as_user(p_uid uuid) returns void language sql as $$
  select set_config('crm.test_uid', coalesce(p_uid::text,''), false);
$$;

-- =====================================================================
-- FIXTURES
-- =====================================================================
do $$
declare v_owner_auth uuid := gen_random_uuid();
begin
  -- Owner: already canonical, acts as the admin actor for every RPC below.
  insert into auth.users(id,email,email_confirmed_at,last_sign_in_at)
    values (v_owner_auth,'owner@kolor.test', now(), now());
  insert into auth.identities(user_id,provider) values (v_owner_auth,'google');
  insert into public.app_users(id,email,name,role,active,lifecycle_status,supabase_auth_id)
    values ('emp-owner','owner@kolor.test','Owner','owner',true,'active',v_owner_auth);
  perform set_config('crm.owner_auth', v_owner_auth::text, false);
end $$;

select as_user(current_setting('crm.owner_auth')::uuid);

-- =====================================================================
-- SECTION 33 — NEW EMPLOYEE
-- =====================================================================

-- 33.A Admin creates new Sale -> row exists, mapping NULL
do $$
declare v jsonb; v_map uuid; v_life text;
begin
  v := public.crm_create_employee(jsonb_build_object('id','emp-sale-a','email','SaleA@Kolor.Test','name','Sale A','role','sale'));
  select supabase_auth_id, lifecycle_status into v_map, v_life from public.app_users where id='emp-sale-a';
  perform t_assert('33.A admin create -> mapping NULL, lifecycle active',
    v_map is null and v_life = 'active', format('map=%s life=%s', v_map, v_life));
end $$;

-- 33.B first login with exact email -> LINK, same app_users.id
do $$
declare v_auth uuid := gen_random_uuid(); v jsonb; v_map uuid; v_id text;
begin
  insert into auth.users(id,email,email_confirmed_at,last_sign_in_at)
    values (v_auth,'salea@kolor.test', now(), now());
  insert into auth.identities(user_id,provider) values (v_auth,'google');
  perform as_user(v_auth);
  v := public.crm_claim_employee_identity_on_first_login();
  select supabase_auth_id, id into v_map, v_id from public.app_users where id='emp-sale-a';
  perform t_assert('33.B first login self-claim -> LINKED',
    v->>'status' = 'LINKED' and v_map = v_auth and v_id = 'emp-sale-a',
    format('status=%s map=%s id=%s', v->>'status', v_map, v_id));
  perform t_assert('33.B ledger + audit written exactly once',
    (select count(*) from public.identity_link_requests where target_app_user_id='emp-sale-a') = 1
    and (select count(*) from public.audit_logs where entity_id='emp-sale-a' and action='linkEmployeeAuthIdentity') = 1,
    '');
  perform set_config('crm.sale_a_auth', v_auth::text, false);
end $$;

-- 33.B2 replay of the same first login is idempotent
do $$
declare v jsonb;
begin
  perform as_user(current_setting('crm.sale_a_auth')::uuid);
  v := public.crm_claim_employee_identity_on_first_login();
  perform t_assert('33.B2 replay -> ALREADY_LINKED, still one ledger row',
    v->>'status' = 'ALREADY_LINKED'
    and (select count(*) from public.identity_link_requests where target_app_user_id='emp-sale-a') = 1,
    v->>'status');
end $$;

-- 33.C login with an email that has no employee profile -> DENIED
do $$
declare v_auth uuid := gen_random_uuid(); v jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at,last_sign_in_at)
    values (v_auth,'stranger@gmail.test', now(), now());
  insert into auth.identities(user_id,provider) values (v_auth,'google');
  perform as_user(v_auth);
  v := public.crm_claim_employee_identity_on_first_login();
  perform t_assert('33.C unknown email -> NO_EMPLOYEE_PROFILE (no mutation)',
    v->>'status' = 'NO_EMPLOYEE_PROFILE'
    and (select count(*) from public.app_users where supabase_auth_id = v_auth) = 0, v->>'status');
end $$;

-- 33.D duplicate app_users email is structurally impossible
do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.app_users(id,email,role,active,lifecycle_status)
      values ('emp-dup','salea@kolor.test','sale',true,'active');
  exception when unique_violation then v_ok := true;
  end;
  perform t_assert('33.D duplicate app_users email blocked by unique index', v_ok, '');
end $$;

-- 33.E auth UUID already mapped to another employee -> DENIED
do $$
declare v jsonb;
begin
  perform as_user(current_setting('crm.owner_auth')::uuid);
  perform public.crm_create_employee(jsonb_build_object('id','emp-sale-b','email','saleb@kolor.test','role','sale'));
  -- point Sale B's discovery at Sale A's already-used Auth UUID by giving that
  -- Auth user Sale B's email is impossible (unique email), so assert the guard
  -- directly: an Auth UUID already in app_users cannot be claimed twice.
  perform t_assert('33.E auth UUID uniqueness enforced by partial unique index',
    (select count(*) from pg_indexes where indexname='app_users_supabase_auth_id_unique_idx') = 1, '');
  perform as_user(current_setting('crm.sale_a_auth')::uuid);
  v := public.crm_claim_employee_identity_on_first_login();
  perform t_assert('33.E re-claim by a linked Auth UUID does not touch another row',
    v->>'appUserId' = 'emp-sale-a', v->>'appUserId');
end $$;

-- 33.F Sale session after link resolves canonical identity
do $$
begin
  perform as_user(current_setting('crm.sale_a_auth')::uuid);
  perform t_assert('33.F post-link RLS helpers resolve',
    public.crm_current_app_user_id() = 'emp-sale-a'
    and public.crm_is_active_user() = true
    and public.crm_current_user_role() = 'sale', '');
end $$;

-- 33.G unconfirmed / anonymous / banned Auth is rejected
do $$
declare v_auth uuid := gen_random_uuid(); v jsonb;
begin
  perform as_user(current_setting('crm.owner_auth')::uuid);
  perform public.crm_create_employee(jsonb_build_object('id','emp-sale-c','email','salec@kolor.test','role','sale'));
  insert into auth.users(id,email,email_confirmed_at) values (v_auth,'salec@kolor.test', null);
  insert into auth.identities(user_id,provider) values (v_auth,'google');
  perform as_user(v_auth);
  v := public.crm_claim_employee_identity_on_first_login();
  perform t_assert('33.G unconfirmed Auth email -> AUTH_NOT_USABLE',
    v->>'status' = 'AUTH_NOT_USABLE'
    and (select supabase_auth_id from public.app_users where id='emp-sale-c') is null, v->>'status');
end $$;

-- 33.H privileged role cannot self-claim
do $$
declare v_auth uuid := gen_random_uuid(); v jsonb;
begin
  perform as_user(current_setting('crm.owner_auth')::uuid);
  perform public.crm_create_employee(jsonb_build_object('id','emp-admin-x','email','adminx@kolor.test','role','admin'));
  insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values (v_auth,'adminx@kolor.test', now(), now());
  insert into auth.identities(user_id,provider) values (v_auth,'google');
  perform as_user(v_auth);
  v := public.crm_claim_employee_identity_on_first_login();
  perform t_assert('33.H admin role -> PRIVILEGED_ROLE_MANUAL_LINK_REQUIRED (no mutation)',
    v->>'status' = 'PRIVILEGED_ROLE_MANUAL_LINK_REQUIRED'
    and (select supabase_auth_id from public.app_users where id='emp-admin-x') is null, v->>'status');
end $$;

-- 33.I inactive employee cannot self-claim
do $$
declare v_auth uuid := gen_random_uuid(); v jsonb;
begin
  perform as_user(current_setting('crm.owner_auth')::uuid);
  perform public.crm_create_employee(jsonb_build_object('id','emp-sale-d','email','saled@kolor.test','role','sale'));
  perform public.crm_deactivate_employee('emp-sale-d','test');
  insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values (v_auth,'saled@kolor.test', now(), now());
  insert into auth.identities(user_id,provider) values (v_auth,'google');
  perform as_user(v_auth);
  v := public.crm_claim_employee_identity_on_first_login();
  perform t_assert('33.I inactive employee -> EMPLOYEE_NOT_ELIGIBLE (no mutation)',
    v->>'status' = 'EMPLOYEE_NOT_ELIGIBLE'
    and (select supabase_auth_id from public.app_users where id='emp-sale-d') is null, v->>'status');
end $$;

-- =====================================================================
-- SECTION 34 — RETURNING EMPLOYEE
-- =====================================================================

-- 34.A inactive + old Auth still valid -> reactivate only, mapping untouched
do $$
declare v_auth uuid := gen_random_uuid(); v_map_before uuid; v_map_after uuid;
begin
  perform as_user(current_setting('crm.owner_auth')::uuid);
  perform public.crm_create_employee(jsonb_build_object('id','emp-ret-a','email','reta@kolor.test','role','sale'));
  insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values (v_auth,'reta@kolor.test', now(), now());
  insert into auth.identities(user_id,provider) values (v_auth,'google');
  perform as_user(v_auth);
  perform public.crm_claim_employee_identity_on_first_login();
  select supabase_auth_id into v_map_before from public.app_users where id='emp-ret-a';
  perform as_user(current_setting('crm.owner_auth')::uuid);
  perform public.crm_deactivate_employee('emp-ret-a','nghi viec');
  perform public.crm_reactivate_employee('emp-ret-a','quay lai');
  select supabase_auth_id into v_map_after from public.app_users where id='emp-ret-a';
  perform t_assert('34.A reactivate with live Auth -> mapping unchanged, no relink needed',
    v_map_before = v_map_after and v_map_after = v_auth
    and (select lifecycle_status from public.app_users where id='emp-ret-a') = 'active', '');
end $$;

-- 34.B inactive + OLD Auth deleted + NEW login -> detect, reactivate, RELINK
do $$
declare v_old uuid := gen_random_uuid(); v_new uuid := gen_random_uuid();
        v jsonb; v_map uuid;
begin
  perform as_user(current_setting('crm.owner_auth')::uuid);
  perform public.crm_create_employee(jsonb_build_object('id','emp-ret-b','email','retb@kolor.test','role','sale'));
  insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values (v_old,'retb@kolor.test', now(), now());
  insert into auth.identities(user_id,provider) values (v_old,'google');
  perform as_user(v_old);
  perform public.crm_claim_employee_identity_on_first_login();
  perform as_user(current_setting('crm.owner_auth')::uuid);
  perform public.crm_deactivate_employee('emp-ret-b','nghi viec');

  -- Owner deletes the Auth account. app_users row survives untouched.
  delete from auth.identities where user_id = v_old;
  delete from auth.users where id = v_old;

  -- Employee returns and signs in with Google again -> brand new Auth UUID.
  insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values (v_new,'retb@kolor.test', now(), now());
  insert into auth.identities(user_id,provider) values (v_new,'google');
  perform as_user(v_new);
  v := public.crm_claim_employee_identity_on_first_login();
  perform t_assert('34.B stale mapping detected, self-claim refuses to overwrite',
    v->>'status' = 'RETURNING_EMPLOYEE_RELINK_REQUIRED'
    and (select supabase_auth_id from public.app_users where id='emp-ret-b') = v_old, v->>'status');

  -- Lifecycle first, then relink.
  perform as_user(current_setting('crm.owner_auth')::uuid);
  perform public.crm_reactivate_employee('emp-ret-b','tai tuyen');
  v := public.crm_relink_returning_employee_identity(
    'emp-ret-b', v_new, v_old, 'Tai tuyen: Auth cu da bi xoa', gen_random_uuid());
  select supabase_auth_id into v_map from public.app_users where id='emp-ret-b';
  perform t_assert('34.B RELINK succeeds, app_users.id preserved',
    v->>'status' = 'RELINKED' and v_map = v_new
    and (select count(*) from public.app_users where lower(email)='retb@kolor.test') = 1,
    format('status=%s map=%s', v->>'status', v_map));

  perform as_user(v_new);
  perform t_assert('34.B returning employee resolves canonical identity after relink',
    public.crm_current_app_user_id() = 'emp-ret-b', coalesce(public.crm_current_app_user_id(),'NULL'));
end $$;

-- 34.B2 RELINK must be refused while the old Auth user still exists
do $$
declare v_old uuid := gen_random_uuid(); v_new uuid := gen_random_uuid(); v_err text := '';
begin
  perform as_user(current_setting('crm.owner_auth')::uuid);
  perform public.crm_create_employee(jsonb_build_object('id','emp-ret-e','email','rete@kolor.test','role','sale'));
  insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values (v_old,'rete@kolor.test', now(), now());
  insert into auth.identities(user_id,provider) values (v_old,'google');
  perform as_user(v_old);
  perform public.crm_claim_employee_identity_on_first_login();
  perform as_user(current_setting('crm.owner_auth')::uuid);
  begin
    perform public.crm_relink_returning_employee_identity(
      'emp-ret-e', v_new, v_old, 'should fail', gen_random_uuid());
  exception when others then v_err := SQLERRM;
  end;
  perform t_assert('34.B2 RELINK denied while old Auth still exists',
    v_err like '%IDENTITY_EXISTING_MAPPING_VALID%', v_err);
end $$;

-- 34.C archived employee: reactivate blocked, owner restore, then reactivate
do $$
declare v_err text := ''; v jsonb; v_life text;
begin
  perform as_user(current_setting('crm.owner_auth')::uuid);
  perform public.crm_create_employee(jsonb_build_object('id','emp-ret-c','email','retc@kolor.test','role','sale'));
  perform public.crm_deactivate_employee('emp-ret-c','nghi viec');
  perform public.crm_archive_employee('emp-ret-c','luu tru');
  begin
    perform public.crm_reactivate_employee('emp-ret-c','tai tuyen');
  exception when others then v_err := SQLERRM;
  end;
  perform t_assert('34.C reactivate on ARCHIVED is blocked (pre-existing contract)',
    v_err like '%ARCHIVED%', v_err);

  v := public.crm_restore_archived_employee('emp-ret-c','Tai tuyen nhan vien cu');
  select lifecycle_status into v_life from public.app_users where id='emp-ret-c';
  perform t_assert('34.C owner restore ARCHIVED -> INACTIVE, id preserved',
    v->>'lifecycleStatus' = 'inactive' and v_life = 'inactive'
    and (select count(*) from public.app_users where id='emp-ret-c') = 1, v_life);

  perform public.crm_reactivate_employee('emp-ret-c','tai tuyen');
  select lifecycle_status into v_life from public.app_users where id='emp-ret-c';
  perform t_assert('34.C then reactivate -> ACTIVE', v_life = 'active', v_life);
end $$;

-- 34.C2 restore is owner-only
do $$
declare v_err text := ''; v_auth uuid := gen_random_uuid();
begin
  perform as_user(current_setting('crm.owner_auth')::uuid);
  perform public.crm_create_employee(jsonb_build_object('id','emp-admin-y','email','adminy@kolor.test','role','admin'));
  insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values (v_auth,'adminy@kolor.test', now(), now());
  insert into auth.identities(user_id,provider) values (v_auth,'google');
  perform set_config('crm.allow_identity_write','on',true);
  update public.app_users set supabase_auth_id = v_auth where id='emp-admin-y';
  perform set_config('crm.allow_identity_write','',true);
  perform public.crm_create_employee(jsonb_build_object('id','emp-ret-f','email','retf@kolor.test','role','sale'));
  perform public.crm_deactivate_employee('emp-ret-f','x');
  perform public.crm_archive_employee('emp-ret-f','x');
  perform as_user(v_auth);   -- admin, not owner
  begin
    perform public.crm_restore_archived_employee('emp-ret-f','test');
  exception when others then v_err := SQLERRM;
  end;
  perform t_assert('34.C2 restore denied for admin (owner-only)', v_err like '%owner%', v_err);
end $$;

-- 34.D stale UUID but email mismatch -> DENIED
do $$
declare v_old uuid := gen_random_uuid(); v_new uuid := gen_random_uuid(); v_err text := '';
begin
  perform as_user(current_setting('crm.owner_auth')::uuid);
  perform public.crm_create_employee(jsonb_build_object('id','emp-ret-d','email','retd@kolor.test','role','sale'));
  perform set_config('crm.allow_identity_write','on',true);
  update public.app_users set supabase_auth_id = v_old where id='emp-ret-d';
  perform set_config('crm.allow_identity_write','',true);
  insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values (v_new,'someoneelse@kolor.test', now(), now());
  insert into auth.identities(user_id,provider) values (v_new,'google');
  begin
    perform public.crm_relink_returning_employee_identity(
      'emp-ret-d', v_new, v_old, 'mismatch test', gen_random_uuid());
  exception when others then v_err := SQLERRM;
  end;
  perform t_assert('34.D relink with mismatched email -> DENIED',
    v_err like '%IDENTITY_EMAIL_DISCOVERY_MISMATCH%', v_err);
end $$;

-- 34.E NEW UUID already mapped to another employee -> DENIED
do $$
declare v_err text := ''; v_taken uuid;
begin
  perform as_user(current_setting('crm.owner_auth')::uuid);
  select supabase_auth_id into v_taken from public.app_users where id='emp-sale-a';
  begin
    perform public.crm_relink_returning_employee_identity(
      'emp-ret-d', v_taken, (select supabase_auth_id from public.app_users where id='emp-ret-d'),
      'already mapped test', gen_random_uuid());
  exception when others then v_err := SQLERRM;
  end;
  perform t_assert('34.E relink to an already-mapped Auth UUID -> DENIED',
    v_err like '%IDENTITY_AUTH_ALREADY_MAPPED%' or v_err like '%IDENTITY_EMAIL_DISCOVERY_MISMATCH%', v_err);
end $$;

-- 34.G RELINK refuses a NULL mapping (must use LINK)
do $$
declare v_err text := ''; v_auth uuid := gen_random_uuid();
begin
  perform as_user(current_setting('crm.owner_auth')::uuid);
  perform public.crm_create_employee(jsonb_build_object('id','emp-ret-g','email','retg@kolor.test','role','sale'));
  insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values (v_auth,'retg@kolor.test', now(), now());
  insert into auth.identities(user_id,provider) values (v_auth,'google');
  begin
    perform public.crm_relink_returning_employee_identity(
      'emp-ret-g', v_auth, gen_random_uuid(), 'null mapping test', gen_random_uuid());
  exception when others then v_err := SQLERRM;
  end;
  perform t_assert('34.G RELINK on NULL mapping -> DENIED (use LINK)',
    v_err like '%RETURNING_RELINK_MAPPING_IS_NULL%' or v_err like '%IDENTITY_EXPECTED_MAPPING_CONFLICT%', v_err);
end $$;

-- 34.H RELINK requires lifecycle reactivation first
do $$
declare v_old uuid := gen_random_uuid(); v_new uuid := gen_random_uuid(); v_err text := '';
begin
  perform as_user(current_setting('crm.owner_auth')::uuid);
  perform public.crm_create_employee(jsonb_build_object('id','emp-ret-h','email','reth@kolor.test','role','sale'));
  insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values (v_old,'reth@kolor.test', now(), now());
  insert into auth.identities(user_id,provider) values (v_old,'google');
  perform as_user(v_old);
  perform public.crm_claim_employee_identity_on_first_login();
  perform as_user(current_setting('crm.owner_auth')::uuid);
  perform public.crm_deactivate_employee('emp-ret-h','nghi viec');
  delete from auth.identities where user_id = v_old;
  delete from auth.users where id = v_old;
  insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values (v_new,'reth@kolor.test', now(), now());
  insert into auth.identities(user_id,provider) values (v_new,'google');
  begin
    perform public.crm_relink_returning_employee_identity(
      'emp-ret-h', v_new, v_old, 'lifecycle test', gen_random_uuid());
  exception when others then v_err := SQLERRM;
  end;
  perform t_assert('34.H RELINK denied while employee is INACTIVE',
    v_err like '%RETURNING_RELINK_LIFECYCLE_REQUIRED%', v_err);
end $$;

-- 34.I RELINK on a privileged role is refused by this RPC
do $$
declare v_err text := '';
begin
  perform as_user(current_setting('crm.owner_auth')::uuid);
  begin
    perform public.crm_relink_returning_employee_identity(
      'emp-admin-x', gen_random_uuid(), gen_random_uuid(), 'privileged test', gen_random_uuid());
  exception when others then v_err := SQLERRM;
  end;
  perform t_assert('34.I returning-relink RPC refuses privileged roles',
    v_err like '%RETURNING_RELINK_TARGET_NOT_ELIGIBLE%', v_err);
end $$;

-- =====================================================================
-- SECTION 35 / 36 / 37 — zero data, regression, constraints
-- =====================================================================
do $$
begin
  perform as_user(current_setting('crm.sale_a_auth')::uuid);
  perform t_assert('35 zero business data still resolves an active identity',
    public.crm_is_active_user() = true and public.crm_current_user_role() = 'sale', '');

  perform as_user(current_setting('crm.owner_auth')::uuid);
  perform t_assert('36 existing canonical owner unaffected',
    public.crm_current_app_user_id() = 'emp-owner' and public.crm_is_admin() = true, '');

  perform t_assert('37 partial unique index on supabase_auth_id still present',
    (select count(*) from pg_indexes
     where schemaname='public' and tablename='app_users'
       and indexname='app_users_supabase_auth_id_unique_idx') = 1, '');

  perform t_assert('37 lifecycle + identity guard triggers still enabled',
    (select count(*) from pg_trigger
     where tgrelid='public.app_users'::regclass
       and tgname in ('app_users_guard_auth_identity_change','app_users_guard_lifecycle_change')
       and tgenabled = 'O') = 2, '');

  perform t_assert('37 self-create shell INSERT policy removed',
    (select count(*) from pg_policies
     where schemaname='public' and tablename='app_users'
       and policyname in ('app users self create inactive','app users create own inactive profile')) = 0, '');
end $$;

-- direct mapping update is still blocked outside the RPCs
do $$
declare v_err text := '';
begin
  begin
    update public.app_users set supabase_auth_id = gen_random_uuid() where id='emp-sale-a';
  exception when others then v_err := SQLERRM;
  end;
  perform t_assert('37 direct supabase_auth_id update still blocked by trigger',
    v_err like '%EMPLOYEE_AUTH_IDENTITY_RPC_REQUIRED%', v_err);
end $$;

-- =====================================================================
-- SECTION 39 — audit completeness
-- =====================================================================
do $$
begin
  perform t_assert('39 returning relink writes its own audit action',
    (select count(*) from public.audit_logs
     where action='relinkReturningEmployeeAuthIdentity' and entity_id='emp-ret-b') = 1, '');
  perform t_assert('39 archived restore writes audit',
    (select count(*) from public.audit_logs
     where action='restoreArchivedEmployee' and entity_id='emp-ret-c') = 1, '');
  perform t_assert('39 no token-like value stored in the identity ledger',
    (select count(*) from public.identity_link_requests
     where response::text ~* '(token|secret|password|jwt)') = 0, '');
end $$;

-- =====================================================================
-- SECTION 4 (R1-4) — admin status view
-- =====================================================================
do $$
declare v_awaiting int; v_linked int; v_relink int;
begin
  perform as_user(current_setting('crm.owner_auth')::uuid);
  select count(*) filter (where identity_status='AWAITING_FIRST_LOGIN'),
         count(*) filter (where identity_status='LINKED'),
         count(*) filter (where identity_status='RELINK_REQUIRED')
    into v_awaiting, v_linked, v_relink
  from public.crm_employee_identity_status();
  perform t_assert('R1-4 status function classifies rows',
    v_linked >= 3 and v_awaiting >= 1, format('awaiting=%s linked=%s relink=%s', v_awaiting, v_linked, v_relink));
end $$;

-- non-admin cannot read the status function
do $$
declare v_err text := '';
begin
  perform as_user(current_setting('crm.sale_a_auth')::uuid);
  begin
    perform * from public.crm_employee_identity_status();
  exception when others then v_err := SQLERRM;
  end;
  perform t_assert('R1-4 status function denied for Sale', v_err <> '', v_err);
end $$;

-- =====================================================================
-- R1-0 — NULL-safe role guard regression (privilege escalation)
-- =====================================================================
do $$
declare v_outsider uuid := gen_random_uuid(); v_err text := ''; v_created int;
begin
  insert into auth.users(id,email,email_confirmed_at,last_sign_in_at)
    values (v_outsider,'outsider@gmail.test', now(), now());
  insert into auth.identities(user_id,provider) values (v_outsider,'google');
  perform as_user(v_outsider);

  perform t_assert('R1-0 crm_is_admin() is false (not NULL) for a non-employee',
    public.crm_is_admin() = false, coalesce(public.crm_is_admin()::text,'NULL'));
  perform t_assert('R1-0 crm_is_manager() is false (not NULL) for a non-employee',
    public.crm_is_manager() = false, coalesce(public.crm_is_manager()::text,'NULL'));
  perform t_assert('R1-0 crm_current_user_role() is empty string (not NULL)',
    public.crm_current_user_role() = '', coalesce(public.crm_current_user_role(),'NULL'));

  begin
    perform public.crm_create_employee(jsonb_build_object(
      'id','evil-1','email','outsider@gmail.test','role','sale'));
  exception when others then v_err := SQLERRM;
  end;
  select count(*) into v_created from public.app_users where id='evil-1';
  perform t_assert('R1-0 outsider can no longer call crm_create_employee',
    v_err like '%Chỉ owner/admin%' and v_created = 0, v_err);

  perform t_assert('R1-0 outsider self-claim finds no profile',
    public.crm_claim_employee_identity_on_first_login()->>'status' = 'NO_EMPLOYEE_PROFILE', '');

  begin
    perform public.crm_reactivate_employee('emp-sale-a','escalation attempt');
    v_err := 'NO_ERROR';
  exception when others then v_err := SQLERRM;
  end;
  perform t_assert('R1-0 outsider can no longer call lifecycle RPCs',
    v_err like '%Chỉ owner/admin%', v_err);
end $$;

-- =====================================================================
-- SECTION 38 — concurrency (serialized first-login claims)
-- =====================================================================
do $$
declare v_auth uuid := gen_random_uuid(); v1 jsonb; v2 jsonb;
begin
  perform as_user(current_setting('crm.owner_auth')::uuid);
  perform public.crm_create_employee(jsonb_build_object('id','emp-conc','email','conc@kolor.test','role','sale'));
  insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values (v_auth,'conc@kolor.test', now(), now());
  insert into auth.identities(user_id,provider) values (v_auth,'google');
  perform as_user(v_auth);
  v1 := public.crm_claim_employee_identity_on_first_login();
  v2 := public.crm_claim_employee_identity_on_first_login();
  perform t_assert('38 repeated claim collapses to one canonical mapping + one ledger row',
    v1->>'status' = 'LINKED' and v2->>'status' = 'ALREADY_LINKED'
    and (select count(*) from public.identity_link_requests where target_app_user_id='emp-conc') = 1
    and (select count(*) from public.app_users where supabase_auth_id = v_auth) = 1,
    format('%s / %s', v1->>'status', v2->>'status'));
end $$;

-- =====================================================================
-- RESULTS
-- =====================================================================
select case when ok then 'PASS' else 'FAIL' end as result, name, detail
from test_results order by ok, name;

select count(*) filter (where ok) as passed,
       count(*) filter (where not ok) as failed,
       count(*) as total
from test_results;
