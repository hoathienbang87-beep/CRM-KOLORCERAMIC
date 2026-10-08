-- =====================================================================
-- KPI PERIOD LIFECYCLE — disposable Production-shaped baseline (Phase 7C-A)
--
-- Mirrors the live Production (jjeeazwlqcwynzquimeo) KPI surface read
-- read-only on 2026-10-08: tables, columns, CHECK/FK/UNIQUE constraints,
-- indexes, triggers, function bodies and grants for
--   app_users, customers (FK stub), audit_logs, kpi_periods, kpi_definitions,
--   kpi_assignments, kpi_submissions, kpi_submission_events, kpi_evidence,
--   kpi_duplicate_matches, kpi_action_requests.
-- Every function body below is byte-identical to Production: the test
-- runner re-checks md5(pg_get_functiondef) against the pinned manifest.
--
-- LOCAL / DISPOSABLE DATABASES ONLY. Never run against Production.
-- =====================================================================

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     or exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    raise exception 'REFUSING: this baseline is for disposable local Postgres only';
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;

create table auth.users (id uuid primary key, email text);

-- JWT simulation: request.jwt.claim.sub / request.jwt.claim.role, as PostgREST sets them.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '');
$$;
create or replace function auth.email() returns text language sql stable security definer as $$
  select email from auth.users where id = auth.uid();
$$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create table public.app_users (
  id text not null primary key,
  supabase_auth_id uuid,
  email text,
  name text,
  role text default 'sale'::text,
  active boolean default false,
  can_export boolean default false,
  team text,
  phone text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  raw_data jsonb not null default '{}'::jsonb,
  lifecycle_status text not null default 'inactive'::text,
  inactive_at timestamp with time zone,
  archived_at timestamp with time zone,
  lifecycle_changed_at timestamp with time zone,
  lifecycle_changed_by_email text
);

-- FK target only (customer-linked events are covered by their own suites).
create table public.customers (id text primary key, name text);

create table public.audit_logs (
  id text not null primary key,
  action text,
  entity text,
  entity_id text,
  email text,
  payload_json text,
  created_at timestamp with time zone,
  raw_data jsonb not null default '{}'::jsonb
);
create index audit_logs_email_idx on public.audit_logs using btree (lower(email));
create index audit_logs_created_at_idx on public.audit_logs using btree (created_at);

create table public.kpi_periods (
  id uuid not null default gen_random_uuid() primary key,
  period_month date not null,
  name text not null,
  status text not null default 'DRAFT'::text,
  timezone text not null default 'Asia/Ho_Chi_Minh'::text,
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone not null,
  created_by_user_id text not null,
  activated_by_user_id text,
  closed_by_user_id text,
  reopened_by_user_id text,
  reopen_reason text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  activated_at timestamp with time zone,
  closed_at timestamp with time zone,
  reopened_at timestamp with time zone,
  version integer not null default 1,
  cancelled_by_user_id text,
  cancelled_at timestamp with time zone,
  cancel_reason text,
  constraint kpi_periods_activated_by_user_id_fkey foreign key (activated_by_user_id) references app_users(id) on delete restrict,
  constraint kpi_periods_cancelled_by_user_id_fkey foreign key (cancelled_by_user_id) references app_users(id) on delete restrict,
  constraint kpi_periods_closed_by_user_id_fkey foreign key (closed_by_user_id) references app_users(id) on delete restrict,
  constraint kpi_periods_created_by_user_id_fkey foreign key (created_by_user_id) references app_users(id) on delete restrict,
  constraint kpi_periods_reopened_by_user_id_fkey foreign key (reopened_by_user_id) references app_users(id) on delete restrict,
  constraint kpi_periods_lifecycle_shape_check check ((((status = 'DRAFT'::text) AND (cancelled_at IS NULL) AND (cancelled_by_user_id IS NULL) AND (cancel_reason IS NULL)) OR ((status = 'ACTIVE'::text) AND (activated_at IS NOT NULL) AND (activated_by_user_id IS NOT NULL) AND (cancelled_at IS NULL) AND (cancelled_by_user_id IS NULL) AND (cancel_reason IS NULL)) OR ((status = 'CLOSED'::text) AND (activated_at IS NOT NULL) AND (activated_by_user_id IS NOT NULL) AND (closed_at IS NOT NULL) AND (closed_by_user_id IS NOT NULL) AND (cancelled_at IS NULL) AND (cancelled_by_user_id IS NULL) AND (cancel_reason IS NULL)) OR ((status = 'CANCELLED'::text) AND (activated_at IS NOT NULL) AND (activated_by_user_id IS NOT NULL) AND (cancelled_at IS NOT NULL) AND (cancelled_by_user_id IS NOT NULL) AND (NULLIF(btrim(cancel_reason), ''::text) IS NOT NULL)))),
  constraint kpi_periods_month_first_day_check check ((period_month = (date_trunc('month'::text, (period_month)::timestamp with time zone))::date)),
  constraint kpi_periods_name_check check ((NULLIF(btrim(name), ''::text) IS NOT NULL)),
  constraint kpi_periods_period_month_key unique (period_month),
  constraint kpi_periods_range_check check ((starts_at < ends_at)),
  constraint kpi_periods_status_check check ((status = ANY (ARRAY['DRAFT'::text, 'ACTIVE'::text, 'CLOSED'::text, 'CANCELLED'::text]))),
  constraint kpi_periods_timezone_check check ((NULLIF(btrim(timezone), ''::text) IS NOT NULL)),
  constraint kpi_periods_version_check check ((version > 0))
);
create index kpi_periods_status_month_idx on public.kpi_periods using btree (status, period_month desc);

create table public.kpi_definitions (
  id uuid not null default gen_random_uuid() primary key,
  code text not null,
  name text not null,
  description text,
  kpi_type text not null,
  source_metric_key text,
  unit text not null,
  submission_mode text not null default 'EVENT_CLAIM'::text,
  evidence_required boolean not null default false,
  active boolean not null default true,
  created_by_user_id text not null,
  updated_by_user_id text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  version integer not null default 1,
  aggregation_mode text not null default 'COUNT'::text,
  max_images_per_event integer not null default 2,
  location_required boolean not null default false,
  timestamp_required boolean not null default true,
  customer_relation_mode text not null default 'NONE'::text,
  constraint kpi_definitions_aggregation_mode_check check ((aggregation_mode = ANY (ARRAY['COUNT'::text, 'SUM'::text]))),
  constraint kpi_definitions_code_check check ((code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)),
  constraint kpi_definitions_code_key unique (code),
  constraint kpi_definitions_created_by_user_id_fkey foreign key (created_by_user_id) references app_users(id) on delete restrict,
  constraint kpi_definitions_customer_relation_mode_check check ((customer_relation_mode = ANY (ARRAY['REQUIRED'::text, 'OPTIONAL'::text, 'NONE'::text]))),
  constraint kpi_definitions_max_images_check check (((max_images_per_event >= 0) AND (max_images_per_event <= 2))),
  constraint kpi_definitions_name_check check ((NULLIF(btrim(name), ''::text) IS NOT NULL)),
  constraint kpi_definitions_submission_mode_check check ((submission_mode = ANY (ARRAY['EVENT_CLAIM'::text, 'PERIOD_TOTAL'::text]))),
  constraint kpi_definitions_type_check check ((kpi_type = ANY (ARRAY['AUTO'::text, 'MANUAL'::text, 'HYBRID'::text]))),
  constraint kpi_definitions_unit_check check ((NULLIF(btrim(unit), ''::text) IS NOT NULL)),
  constraint kpi_definitions_updated_by_user_id_fkey foreign key (updated_by_user_id) references app_users(id) on delete restrict,
  constraint kpi_definitions_version_check check ((version > 0))
);

create table public.kpi_assignments (
  id uuid not null default gen_random_uuid() primary key,
  period_id uuid not null,
  definition_id uuid not null,
  employee_id text not null,
  target numeric not null,
  effective_at timestamp with time zone not null,
  assignment_status text not null default 'ASSIGNED'::text,
  definition_snapshot jsonb not null,
  assigned_by_user_id text not null,
  assigned_at timestamp with time zone not null default now(),
  cancelled_by_user_id text,
  cancelled_at timestamp with time zone,
  cancel_reason text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  lock_version integer not null default 1,
  score_enabled boolean not null default false,
  constraint kpi_assignments_assigned_by_user_id_fkey foreign key (assigned_by_user_id) references app_users(id) on delete restrict,
  constraint kpi_assignments_cancel_shape_check check ((((assignment_status = 'ASSIGNED'::text) AND (cancelled_at IS NULL) AND (cancelled_by_user_id IS NULL)) OR ((assignment_status = 'CANCELLED'::text) AND (cancelled_at IS NOT NULL) AND (cancelled_by_user_id IS NOT NULL) AND (NULLIF(btrim(cancel_reason), ''::text) IS NOT NULL)))),
  constraint kpi_assignments_cancelled_by_user_id_fkey foreign key (cancelled_by_user_id) references app_users(id) on delete restrict,
  constraint kpi_assignments_definition_id_fkey foreign key (definition_id) references kpi_definitions(id) on delete restrict,
  constraint kpi_assignments_employee_id_fkey foreign key (employee_id) references app_users(id) on delete restrict,
  constraint kpi_assignments_lock_version_check check ((lock_version > 0)),
  constraint kpi_assignments_period_id_fkey foreign key (period_id) references kpi_periods(id) on delete restrict,
  constraint kpi_assignments_snapshot_fields_check check (((definition_snapshot ?& ARRAY['code'::text, 'name'::text, 'description'::text, 'kpi_type'::text, 'source_metric_key'::text, 'unit'::text, 'submission_mode'::text, 'evidence_required'::text, 'customer_relation_mode'::text, 'definition_version'::text]) AND ((definition_snapshot ->> 'customer_relation_mode'::text) = ANY (ARRAY['REQUIRED'::text, 'OPTIONAL'::text, 'NONE'::text])))),
  constraint kpi_assignments_snapshot_object_check check ((jsonb_typeof(definition_snapshot) = 'object'::text)),
  constraint kpi_assignments_status_check check ((assignment_status = ANY (ARRAY['ASSIGNED'::text, 'CANCELLED'::text]))),
  constraint kpi_assignments_target_check check ((target > (0)::numeric)),
  constraint kpi_assignments_unique unique (period_id, definition_id, employee_id)
);
create index kpi_assignments_period_status_idx on public.kpi_assignments using btree (period_id, assignment_status);
create index kpi_assignments_employee_period_idx on public.kpi_assignments using btree (employee_id, period_id);
create index kpi_assignments_definition_period_idx on public.kpi_assignments using btree (definition_id, period_id);

create table public.kpi_submissions (
  id uuid not null default gen_random_uuid() primary key,
  assignment_id uuid not null,
  submission_no bigint generated by default as identity not null,
  attempt_no integer not null default 1,
  request_id uuid not null,
  submitted_by_user_id text not null,
  submitted_at timestamp with time zone not null default now(),
  sale_note text,
  status text not null default 'OPEN_REVIEW'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  lock_version integer not null default 1,
  constraint kpi_submissions_actor_request_unique unique (submitted_by_user_id, request_id),
  constraint kpi_submissions_assignment_id_fkey foreign key (assignment_id) references kpi_assignments(id) on delete restrict,
  constraint kpi_submissions_attempt_check check ((attempt_no > 0)),
  constraint kpi_submissions_status_check check ((status = ANY (ARRAY['OPEN_REVIEW'::text, 'PARTIALLY_REVIEWED'::text, 'COMPLETED'::text]))),
  constraint kpi_submissions_submitted_by_user_id_fkey foreign key (submitted_by_user_id) references app_users(id) on delete restrict,
  constraint kpi_submissions_version_check check ((lock_version > 0))
);
create index kpi_submissions_assignment_time_idx on public.kpi_submissions using btree (assignment_id, submitted_at desc);

create table public.kpi_submission_events (
  id uuid not null default gen_random_uuid() primary key,
  submission_id uuid not null,
  assignment_id uuid not null,
  source_type text not null,
  source_id text,
  source_event_key text not null,
  event_at timestamp with time zone not null,
  actor_user_id text not null,
  customer_id text,
  claimed_value numeric not null default 1,
  approved_value numeric,
  event_snapshot jsonb not null default '{}'::jsonb,
  location_snapshot jsonb,
  possible_duplicate boolean not null default false,
  duplicate_context jsonb not null default '[]'::jsonb,
  status text not null default 'PENDING'::text,
  review_reason_code text,
  manager_note text,
  reviewed_by_user_id text,
  reviewed_at timestamp with time zone,
  supersedes_event_id uuid,
  root_event_id uuid,
  revision_no integer not null default 1,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  lock_version integer not null default 1,
  customer_name_snapshot text,
  customer_company_name_snapshot text,
  customer_phone_snapshot text,
  customer_phone_normalized_snapshot text,
  customer_address_snapshot text,
  withdrawn_by_user_id text,
  withdrawn_at timestamp with time zone,
  withdraw_reason text,
  constraint kpi_submission_events_actor_user_id_fkey foreign key (actor_user_id) references app_users(id) on delete restrict,
  constraint kpi_submission_events_assignment_id_fkey foreign key (assignment_id) references kpi_assignments(id) on delete restrict,
  constraint kpi_submission_events_customer_id_fkey foreign key (customer_id) references customers(id) on delete restrict,
  constraint kpi_submission_events_customer_snapshot_shape_check check ((((customer_id IS NULL) AND (customer_name_snapshot IS NULL) AND (customer_company_name_snapshot IS NULL) AND (customer_phone_snapshot IS NULL) AND (customer_phone_normalized_snapshot IS NULL) AND (customer_address_snapshot IS NULL)) OR ((customer_id IS NOT NULL) AND (NULLIF(btrim(customer_name_snapshot), ''::text) IS NOT NULL)))),
  constraint kpi_submission_events_duplicate_context_check check ((jsonb_typeof(duplicate_context) = 'array'::text)),
  constraint kpi_submission_events_location_check check (((location_snapshot IS NULL) OR (jsonb_typeof(location_snapshot) = 'object'::text))),
  constraint kpi_submission_events_reason_check check (((review_reason_code IS NULL) OR (review_reason_code = ANY (ARRAY['DUPLICATE'::text, 'INVALID_EVIDENCE'::text, 'MISSING_LOCATION'::text, 'MISSING_TIMESTAMP'::text, 'INCOMPLETE_INFORMATION'::text, 'NOT_NEW'::text, 'OUT_OF_SCOPE'::text, 'OTHER'::text])))),
  constraint kpi_submission_events_review_shape_check check ((((status = 'PENDING'::text) AND (reviewed_by_user_id IS NULL) AND (reviewed_at IS NULL) AND (approved_value IS NULL) AND (withdrawn_by_user_id IS NULL) AND (withdrawn_at IS NULL) AND (withdraw_reason IS NULL)) OR ((status = 'APPROVED'::text) AND (reviewed_by_user_id IS NOT NULL) AND (reviewed_at IS NOT NULL) AND (approved_value IS NOT NULL) AND (withdrawn_by_user_id IS NULL) AND (withdrawn_at IS NULL) AND (withdraw_reason IS NULL)) OR ((status = ANY (ARRAY['NEEDS_REVISION'::text, 'REJECTED'::text])) AND (reviewed_by_user_id IS NOT NULL) AND (reviewed_at IS NOT NULL) AND (approved_value IS NULL) AND (withdrawn_by_user_id IS NULL) AND (withdrawn_at IS NULL) AND (withdraw_reason IS NULL)) OR ((status = 'WITHDRAWN'::text) AND (reviewed_by_user_id IS NULL) AND (reviewed_at IS NULL) AND (approved_value IS NULL) AND (withdrawn_by_user_id IS NOT NULL) AND (withdrawn_at IS NOT NULL) AND (NULLIF(btrim(withdraw_reason), ''::text) IS NOT NULL)))),
  constraint kpi_submission_events_reviewed_by_user_id_fkey foreign key (reviewed_by_user_id) references app_users(id) on delete restrict,
  constraint kpi_submission_events_revision_check check ((revision_no > 0)),
  constraint kpi_submission_events_root_event_id_fkey foreign key (root_event_id) references kpi_submission_events(id) on delete restrict,
  constraint kpi_submission_events_snapshot_check check ((jsonb_typeof(event_snapshot) = 'object'::text)),
  constraint kpi_submission_events_source_key_check check ((NULLIF(btrim(source_event_key), ''::text) IS NOT NULL)),
  constraint kpi_submission_events_source_type_check check ((source_type = ANY (ARRAY['MANUAL'::text, 'CARE_LOG'::text, 'CUSTOMER'::text, 'DEAL'::text, 'SHOWROOM_VISIT'::text, 'OTHER'::text]))),
  constraint kpi_submission_events_status_check check ((status = ANY (ARRAY['PENDING'::text, 'NEEDS_REVISION'::text, 'APPROVED'::text, 'REJECTED'::text, 'WITHDRAWN'::text]))),
  constraint kpi_submission_events_submission_id_fkey foreign key (submission_id) references kpi_submissions(id) on delete restrict,
  constraint kpi_submission_events_supersedes_event_id_fkey foreign key (supersedes_event_id) references kpi_submission_events(id) on delete restrict,
  constraint kpi_submission_events_value_check check ((claimed_value > (0)::numeric)),
  constraint kpi_submission_events_version_check check ((lock_version > 0)),
  constraint kpi_submission_events_withdraw_reason_check check (((withdraw_reason IS NULL) OR ((NULLIF(btrim(withdraw_reason), ''::text) IS NOT NULL) AND (char_length(withdraw_reason) <= 500)))),
  constraint kpi_submission_events_withdrawn_by_user_id_fkey foreign key (withdrawn_by_user_id) references app_users(id) on delete restrict
);
create unique index kpi_submission_events_single_revision_idx on public.kpi_submission_events using btree (supersedes_event_id) where (supersedes_event_id is not null);
create index kpi_events_assignment_status_idx on public.kpi_submission_events using btree (assignment_id, status, event_at desc);
create index kpi_events_submission_idx on public.kpi_submission_events using btree (submission_id, created_at);
create index kpi_events_source_lookup_idx on public.kpi_submission_events using btree (source_type, source_event_key);
create index kpi_submission_events_customer_event_at_idx on public.kpi_submission_events using btree (customer_id, event_at desc) where (customer_id is not null);
create unique index kpi_submission_events_root_dedupe_idx on public.kpi_submission_events using btree (assignment_id, source_type, source_event_key) where ((supersedes_event_id is null) and (status <> 'WITHDRAWN'::text));

create table public.kpi_evidence (
  id uuid not null primary key,
  assignment_id uuid not null,
  event_id uuid,
  bucket text not null default 'kpi2-evidence'::text,
  object_path text not null,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  uploaded_by_user_id text not null,
  uploaded_at timestamp with time zone not null default now(),
  attached_at timestamp with time zone,
  status text not null default 'STAGED'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  lock_version integer not null default 1,
  discard_requested_at timestamp with time zone,
  discarded_at timestamp with time zone,
  discard_requested_by_user_id text,
  constraint kpi_evidence_assignment_id_fkey foreign key (assignment_id) references kpi_assignments(id) on delete restrict,
  constraint kpi_evidence_attach_shape_check check ((((status = 'ATTACHED'::text) AND (event_id IS NOT NULL) AND (attached_at IS NOT NULL)) OR (status <> 'ATTACHED'::text))),
  constraint kpi_evidence_bucket_check check ((bucket = 'kpi2-evidence'::text)),
  constraint kpi_evidence_discard_complete_check check (((discarded_at IS NULL) OR ((status = 'ARCHIVED'::text) AND (discard_requested_at IS NOT NULL)))),
  constraint kpi_evidence_discard_requested_by_user_id_fkey foreign key (discard_requested_by_user_id) references app_users(id) on delete restrict,
  constraint kpi_evidence_discard_shape_check check (((discard_requested_at IS NULL) OR ((status = 'ARCHIVED'::text) AND (event_id IS NULL) AND (attached_at IS NULL) AND (discard_requested_by_user_id IS NOT NULL)))),
  constraint kpi_evidence_event_id_fkey foreign key (event_id) references kpi_submission_events(id) on delete restrict,
  constraint kpi_evidence_mime_check check ((mime_type = ANY (ARRAY['image/jpeg'::text, 'image/webp'::text]))),
  constraint kpi_evidence_name_check check ((NULLIF(btrim(original_name), ''::text) IS NOT NULL)),
  constraint kpi_evidence_object_path_key unique (object_path),
  constraint kpi_evidence_path_check check ((object_path ~~ 'kpi2/%'::text)),
  constraint kpi_evidence_sha_check check ((sha256 ~ '^[a-f0-9]{64}$'::text)),
  constraint kpi_evidence_size_check check (((size_bytes >= 1) AND (size_bytes <= 1572864))),
  constraint kpi_evidence_status_check check ((status = ANY (ARRAY['STAGED'::text, 'ATTACHED'::text, 'QUARANTINED'::text, 'ARCHIVED'::text]))),
  constraint kpi_evidence_uploaded_by_user_id_fkey foreign key (uploaded_by_user_id) references app_users(id) on delete restrict,
  constraint kpi_evidence_version_check check ((lock_version > 0))
);
create index kpi_evidence_event_idx on public.kpi_evidence using btree (event_id, status);
create index kpi_evidence_staged_ttl_idx on public.kpi_evidence using btree (status, uploaded_at) where (status = 'STAGED'::text);
create index kpi_evidence_discard_pending_idx on public.kpi_evidence using btree (uploaded_by_user_id, discard_requested_at) where ((status = 'ARCHIVED'::text) and (discarded_at is null));

create table public.kpi_duplicate_matches (
  id uuid not null default gen_random_uuid() primary key,
  event_id uuid not null,
  duplicate_event_id uuid not null,
  duplicate_employee_id text not null,
  created_at timestamp with time zone not null default now(),
  constraint kpi_duplicate_matches_duplicate_employee_id_fkey foreign key (duplicate_employee_id) references app_users(id) on delete restrict,
  constraint kpi_duplicate_matches_duplicate_event_id_fkey foreign key (duplicate_event_id) references kpi_submission_events(id) on delete restrict,
  constraint kpi_duplicate_matches_event_id_fkey foreign key (event_id) references kpi_submission_events(id) on delete restrict,
  constraint kpi_duplicate_matches_pair_unique unique (event_id, duplicate_event_id),
  constraint kpi_duplicate_matches_self_check check ((event_id <> duplicate_event_id))
);
create index kpi_duplicate_matches_event_idx on public.kpi_duplicate_matches using btree (event_id, created_at);

create table public.kpi_action_requests (
  id uuid not null default gen_random_uuid() primary key,
  actor_user_id text not null,
  action text not null,
  request_id uuid not null,
  request_payload_hash text not null,
  request_schema_version integer not null default 1,
  response jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  constraint kpi_action_requests_action_check check ((NULLIF(btrim(action), ''::text) IS NOT NULL)),
  constraint kpi_action_requests_actor_user_id_fkey foreign key (actor_user_id) references app_users(id) on delete restrict,
  constraint kpi_action_requests_payload_hash_check check ((request_payload_hash ~ '^[a-f0-9]{64}$'::text)),
  constraint kpi_action_requests_response_check check ((jsonb_typeof(response) = 'object'::text)),
  constraint kpi_action_requests_schema_version_check check ((request_schema_version >= 1)),
  constraint kpi_action_requests_unique unique (actor_user_id, action, request_id)
);


-- ===== Live function sources (byte-matched to Production pg_get_functiondef md5) =====
set check_function_bodies = off;

-- source: Production catalog
do $do$ begin
  -- Production body carries CRLF line endings (Windows-authored); built with E'' so the
  -- checked-in file has no raw CR and the md5 still matches Production.
  execute 'create or replace function public.crm_current_email() returns text language sql stable as '
    || quote_literal(E'\r\n  select lower(coalesce(auth.email(), \'\'));\r\n');
end $do$;

-- source: supabase-phase-auth-identity-linking-repair.sql @ offset 2874
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

-- source: supabase-hotfix-r1-0-crm-is-admin-fail-closed.sql @ offset 3793
create or replace function public.crm_current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select lower(coalesce(u.role, ''))
    from public.app_users u
    where u.id = public.crm_current_app_user_id()
    limit 1
  ), '');
$$;

-- source: supabase-phase-auth-identity-linking-repair.sql @ offset 3696
create or replace function public.crm_is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.crm_current_app_user_id() is not null;
$$;

-- source: supabase-phase-p0a-transaction-ownership.sql @ offset 3327
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

-- source: supabase-phase-kpi1-foundation.sql @ offset 6330
create or replace function public.crm_kpi_is_business_manager()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.app_users u
    where u.id = public.crm_current_app_user_id()
      and coalesce(u.active, false) = true
      and lower(coalesce(u.lifecycle_status, 'active')) = 'active'
      and lower(coalesce(u.role, '')) in ('manager', 'admin', 'owner')
  );
$$;

-- source: supabase-phase-kpi1-foundation.sql @ offset 6778
create or replace function public.crm_kpi_is_admin_owner()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.app_users u
    where u.id = public.crm_current_app_user_id()
      and coalesce(u.active, false) = true
      and lower(coalesce(u.lifecycle_status, 'active')) = 'active'
      and lower(coalesce(u.role, '')) in ('admin', 'owner')
  );
$$;

-- source: supabase-phase-kpi1-foundation.sql @ offset 8729
create or replace function public.crm_kpi_write_audit(
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
  perform public.crm_write_audit(
    p_action,
    p_entity,
    p_entity_id,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
      'actorUserId', public.crm_current_app_user_id(),
      'actorRole', public.crm_current_user_role(),
      'timestamp', now()
    )
  );
end;
$$;

-- source: supabase-phase-kpi-r3-active-flexibility.sql @ offset 164
create or replace function public.crm_kpi_r3_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'Lý do phải có từ 1 đến 500 ký tự.';
  end if;
  return v_reason;
end;
$$;

-- source: supabase-phase-kpi2-final-consolidated.sql @ offset 32764
create or replace function public.crm_kpi_payload_hash(p_payload jsonb)
returns text
language sql
security definer
set search_path = public, extensions
immutable
as $$
  select encode(extensions.digest(convert_to(coalesce(p_payload, 'null'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');
$$;

-- source: supabase-phase-kpi2-final-consolidated.sql @ offset 33052
create or replace function public.crm_kpi_idempotent_response(
  p_actor_user_id text,
  p_action text,
  p_request_id uuid,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.kpi_action_requests%rowtype;
begin
  select * into v_row
  from public.kpi_action_requests
  where actor_user_id = p_actor_user_id
    and action = p_action
    and request_id = p_request_id;

  if v_row.id is null then return null; end if;
  if v_row.request_payload_hash <> p_payload_hash then
    raise exception using
      errcode = 'P0001',
      message = 'KPI_IDEMPOTENCY_PAYLOAD_CONFLICT: Request ID da duoc dung cho payload khac.';
  end if;
  return v_row.response;
end;
$$;

-- source: supabase-phase-kpi2-final-consolidated.sql @ offset 34193
create or replace function public.crm_kpi_validate_location(
  p_location jsonb,
  p_required boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
volatile
as $$
declare
  v_lat numeric;
  v_lng numeric;
  v_accuracy numeric;
  v_captured_at timestamptz;
  v_result jsonb;
begin
  if p_location is null or jsonb_typeof(p_location) = 'null' then
    if coalesce(p_required, false) then
      raise exception using errcode = '22023', message = 'KPI_LOCATION_REQUIRED: KPI nay bat buoc vi tri.';
    end if;
    return null;
  end if;
  if jsonb_typeof(p_location) <> 'object'
     or jsonb_typeof(p_location->'latitude') <> 'number'
     or jsonb_typeof(p_location->'longitude') <> 'number'
     or jsonb_typeof(p_location->'accuracy') <> 'number' then
    raise exception using errcode = '22023', message = 'KPI_LOCATION_INVALID: Vi tri phai co latitude, longitude va accuracy dang so.';
  end if;

  begin
    v_lat := (p_location->>'latitude')::numeric;
    v_lng := (p_location->>'longitude')::numeric;
    v_accuracy := (p_location->>'accuracy')::numeric;
  exception when others then
    raise exception using errcode = '22023', message = 'KPI_LOCATION_INVALID: Gia tri vi tri khong hop le.';
  end;

  if v_lat < -90 or v_lat > 90 then
    raise exception using errcode = '22023', message = 'KPI_LOCATION_INVALID: Latitude phai nam trong khoang -90 den 90.';
  end if;
  if v_lng < -180 or v_lng > 180 then
    raise exception using errcode = '22023', message = 'KPI_LOCATION_INVALID: Longitude phai nam trong khoang -180 den 180.';
  end if;
  if v_accuracy <= 0 or v_accuracy > 1000000 then
    raise exception using errcode = '22023', message = 'KPI_LOCATION_INVALID: Accuracy phai lon hon 0 va nam trong nguong ky thuat.';
  end if;

  v_result := jsonb_build_object(
    'latitude', v_lat,
    'longitude', v_lng,
    'accuracy', v_accuracy
  );

  if nullif(btrim(coalesce(p_location->>'capturedAt', p_location->>'captured_at', '')), '') is not null then
    begin
      v_captured_at := coalesce(p_location->>'capturedAt', p_location->>'captured_at')::timestamptz;
    exception when others then
      raise exception using errcode = '22023', message = 'KPI_LOCATION_INVALID: Thoi gian ghi nhan vi tri khong hop le.';
    end;
    if v_captured_at > clock_timestamp() + interval '5 minutes' then
      raise exception using errcode = '22023', message = 'KPI_LOCATION_INVALID: Thoi gian vi tri nam trong tuong lai.';
    end if;
    v_result := v_result || jsonb_build_object('captured_at', v_captured_at);
  end if;

  return v_result;
end;
$$;

-- source: supabase-phase-kpi2-final-consolidated.sql @ offset 36795
create or replace function public.crm_kpi_validate_event_at(
  p_event_at text,
  p_period_starts_at timestamptz,
  p_period_ends_at timestamptz,
  p_period_timezone text default 'Asia/Ho_Chi_Minh'
)
returns timestamptz
language plpgsql
security definer
set search_path = public
volatile
as $$
declare
  v_event_at timestamptz;
begin
  if nullif(btrim(coalesce(p_event_at, '')), '') is null then
    raise exception using errcode = '22023', message = 'KPI_TIMESTAMP_INVALID: Business event_at la bat buoc.';
  end if;
  if p_event_at !~* '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' then
    raise exception using errcode = '22023', message = 'KPI_TIMESTAMP_INVALID: Event time phai kem mui gio ro rang.';
  end if;
  if coalesce(p_period_timezone, '') <> 'Asia/Ho_Chi_Minh' then
    raise exception using errcode = '22023', message = 'KPI_TIMESTAMP_INVALID: Timezone ky KPI khong duoc ho tro.';
  end if;
  begin
    v_event_at := p_event_at::timestamptz;
  exception when others then
    raise exception using errcode = '22023', message = 'KPI_TIMESTAMP_INVALID: Event time khong hop le.';
  end;
  if v_event_at > clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'KPI_TIMESTAMP_FUTURE: Event time nam trong tuong lai.';
  end if;
  if v_event_at < p_period_starts_at or v_event_at >= p_period_ends_at then
    raise exception using errcode = '22023', message = 'KPI_TIMESTAMP_OUTSIDE_PERIOD: Event phai nam trong ky KPI.';
  end if;
  return v_event_at;
end;
$$;

-- source: supabase-phase-kpi2-customer-linked-event.sql @ offset 17750
create or replace function public.crm_kpi_strip_customer_metadata(p_snapshot jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(p_snapshot, '{}'::jsonb) - array[
    'customerId', 'customer_id', 'customerName', 'customer_name',
    'companyName', 'company_name', 'customerCompanyName',
    'phone', 'phoneRaw', 'phone_raw', 'customerPhone',
    'phoneNormalized', 'phone_normalized', 'customerPhoneNormalized',
    'address', 'customerAddress', 'customer_address',
    'customerSnapshot', 'customer_snapshot'
  ]::text[];
$$;

-- source: supabase-phase-kpi1-foundation.sql @ offset 10364
create or replace function public.crm_kpi_guard_direct_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and coalesce(current_setting('crm.kpi_write', true), '') <> 'on' then
    raise exception using
      errcode = '42501',
      message = 'Thay đổi cấu hình KPI phải thực hiện qua RPC nghiệp vụ.';
  end if;
  return coalesce(new, old);
end;
$$;

-- source: supabase-phase-kpi-r31-period-lifecycle.sql @ offset 10066
create or replace function public.crm_kpi_guard_runtime_period_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_assignment_id uuid; v_status text;
begin
  v_assignment_id := case when tg_op='DELETE' then old.assignment_id else new.assignment_id end;
  select p.status into v_status from public.kpi_assignments a
    join public.kpi_periods p on p.id=a.period_id where a.id=v_assignment_id
    for share of p;
  if v_status is distinct from 'ACTIVE' then
    raise exception using errcode='55000', message='Kỳ KPI không ACTIVE; dữ liệu thực hiện đã đóng băng.';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

-- source: supabase-phase-kpi2-final-consolidated.sql @ offset 23589
create or replace function public.crm_kpi_normalize_event_location()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.location_snapshot is not null and jsonb_typeof(new.location_snapshot) = 'null' then
    new.location_snapshot := null;
  end if;
  return new;
end $$;

-- source: supabase-phase-kpi2-sale-withdraw-pending-event.sql @ offset 2287
create or replace function public.crm_kpi_refresh_submission_status(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_final integer;
  v_reviewed integer;
begin
  select
    count(*),
    count(*) filter(where status in ('APPROVED', 'REJECTED', 'WITHDRAWN')),
    count(*) filter(where status <> 'PENDING')
  into v_total, v_final, v_reviewed
  from public.kpi_submission_events
  where submission_id = p_submission_id;

  update public.kpi_submissions
  set status = case
        when v_total > 0 and v_final = v_total then 'COMPLETED'
        when v_reviewed > 0 then 'PARTIALLY_REVIEWED'
        else 'OPEN_REVIEW'
      end,
      updated_at = now(),
      lock_version = lock_version + 1
  where id = p_submission_id;
end;
$$;

-- source: supabase-phase-kpi-r31-period-lifecycle.sql @ offset 1563
create or replace function public.crm_kpi_period_runtime_dependencies(p_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare v_result jsonb;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode='42501', message='Chỉ manager/admin/owner được xem dependency của kỳ KPI.';
  end if;
  with assignments as (
    select id from public.kpi_assignments where period_id = p_period_id
  ), counts as (
    select
      (select count(*) from assignments) as assignments,
      (select count(*) from public.kpi_submissions s join assignments a on a.id=s.assignment_id) as submissions,
      (select count(*) from public.kpi_submission_events e join assignments a on a.id=e.assignment_id) as events,
      (select count(*) from public.kpi_evidence e join assignments a on a.id=e.assignment_id) as evidence,
      (select count(*) from public.kpi_submission_events e join assignments a on a.id=e.assignment_id
        where e.reviewed_at is not null or e.status <> 'PENDING') as reviews,
      (select count(*) from public.kpi_duplicate_matches m
        join public.kpi_submission_events e on e.id=m.event_id join assignments a on a.id=e.assignment_id) as duplicate_matches,
      (select count(*) from public.kpi_action_requests r
        where exists (select 1 from assignments a where r.response::text like '%' || a.id::text || '%')) as action_requests
  )
  select jsonb_build_object(
    'assignmentCount', assignments,
    'submissions', submissions,
    'events', events,
    'evidence', evidence,
    'reviews', reviews,
    'duplicateMatches', duplicate_matches,
    'actionRequests', action_requests,
    'runtimeTotal', submissions + events + evidence + duplicate_matches + action_requests
  ) into v_result from counts;
  return v_result;
end;
$$;

-- source: supabase-phase-kpi1-foundation.sql @ offset 21497
create or replace function public.crm_kpi_close_period_foundation(
  p_period_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.kpi_periods%rowtype;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin/owner được yêu cầu đóng kỳ KPI.';
  end if;
  select * into v_period from public.kpi_periods where id = p_period_id for update;
  if v_period.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy kỳ KPI.'; end if;
  if v_period.status <> 'ACTIVE' then
    raise exception using errcode = '55000', message = 'Chỉ kỳ ACTIVE mới có thể yêu cầu đóng.';
  end if;
  if p_expected_version is null or v_period.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Kỳ KPI đã thay đổi. Hãy tải lại.';
  end if;

  -- KPI-1 has no submissions/results, so closing would falsely certify a period.
  perform public.crm_kpi_write_audit(
    'period_close_attempt', 'kpi_periods', p_period_id::text,
    jsonb_build_object(
      'periodId', p_period_id,
      'closed', false,
      'reason', 'KPI-2 review/result finalization is not installed'
    )
  );
  return jsonb_build_object(
    'id', p_period_id,
    'closed', false,
    'code', 'KPI_REVIEW_FOUNDATION_INCOMPLETE',
    'message', 'Chưa thể đóng kỳ trước khi KPI-2 hoàn thiện review và kết quả chính thức.'
  );
end;
$$;

-- source: supabase-phase-kpi1-foundation.sql @ offset 23029
create or replace function public.crm_kpi_reopen_period(
  p_period_id uuid,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.kpi_periods%rowtype;
  v_new public.kpi_periods%rowtype;
begin
  if not public.crm_kpi_is_admin_owner() then
    raise exception using errcode = '42501', message = 'Chỉ admin/owner được mở lại kỳ KPI đã đóng.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'Lý do mở lại kỳ KPI là bắt buộc.';
  end if;
  select * into v_old from public.kpi_periods where id = p_period_id for update;
  if v_old.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy kỳ KPI.'; end if;
  if v_old.status <> 'CLOSED' then
    raise exception using errcode = '55000', message = 'Chỉ kỳ CLOSED mới được mở lại.';
  end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Kỳ KPI đã thay đổi. Hãy tải lại.';
  end if;

  perform set_config('crm.kpi_write', 'on', true);
  update public.kpi_periods
  set status = 'ACTIVE',
      reopened_by_user_id = public.crm_current_app_user_id(),
      reopened_at = now(),
      reopen_reason = btrim(p_reason),
      updated_at = now(),
      version = version + 1
  where id = p_period_id
  returning * into v_new;

  perform public.crm_kpi_write_audit(
    'period_reopen', 'kpi_periods', p_period_id::text,
    jsonb_build_object(
      'periodId', p_period_id,
      'reason', btrim(p_reason),
      'before', to_jsonb(v_old),
      'after', to_jsonb(v_new)
    )
  );
  return to_jsonb(v_new);
end;
$$;

-- source: supabase-phase-kpi-r31-period-lifecycle.sql @ offset 8000
create or replace function public.crm_kpi_cancel_active_period(
  p_period_id uuid,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := public.crm_current_app_user_id();
  v_old public.kpi_periods%rowtype;
  v_new public.kpi_periods%rowtype;
  v_dependencies jsonb;
  v_reason text := public.crm_kpi_r3_reason(p_reason);
begin
  if not public.crm_kpi_is_admin_owner() then
    raise exception using errcode='42501', message='Chỉ Owner/Admin được hủy toàn bộ kỳ KPI đã có dữ liệu.';
  end if;
  select * into v_old from public.kpi_periods where id=p_period_id for update;
  if v_old.id is null then raise exception using errcode='P0002', message='Không tìm thấy kỳ KPI.'; end if;
  if v_old.status <> 'ACTIVE' then raise exception using errcode='55000', message='Chỉ kỳ ACTIVE được hủy.'; end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception using errcode='P0001', message='KPI_VERSION_CONFLICT: Kỳ KPI đã thay đổi. Hãy tải lại.';
  end if;
  v_dependencies := public.crm_kpi_period_runtime_dependencies(p_period_id);
  if (v_dependencies->>'runtimeTotal')::bigint = 0 then
    raise exception using errcode='55000', message='Kỳ chưa có dữ liệu thực hiện. Hãy đưa kỳ về DRAFT thay vì hủy.';
  end if;
  perform set_config('crm.kpi_write','on',true);
  update public.kpi_periods set status='CANCELLED', cancelled_by_user_id=v_actor,
    cancelled_at=now(), cancel_reason=v_reason, updated_at=now(), version=version+1
    where id=p_period_id returning * into v_new;
  perform public.crm_kpi_write_audit('PERIOD_CANCELLED','kpi_periods',p_period_id::text,
    jsonb_build_object('periodId',p_period_id,'oldStatus','ACTIVE','newStatus','CANCELLED',
      'versionBefore',v_old.version,'versionAfter',v_new.version,'reason',v_reason,
      'dependencyCounts',v_dependencies,'before',to_jsonb(v_old),'after',to_jsonb(v_new)));
  return to_jsonb(v_new) || jsonb_build_object('dependencyCounts',v_dependencies);
end;
$$;

-- source: supabase-phase-kpi2-final-consolidated.sql @ offset 65566
create or replace function public.crm_kpi_review_events(
  p_request_id uuid,
  p_rows jsonb,
  p_decision text,
  p_reason_code text,
  p_manager_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := public.crm_current_app_user_id();
  v_decision text := upper(btrim(coalesce(p_decision, '')));
  v_reason text := upper(nullif(btrim(coalesce(p_reason_code, '')), ''));
  v_note text := nullif(btrim(coalesce(p_manager_note, '')), '');
  v_response jsonb;
  v_row jsonb;
  v_event public.kpi_submission_events%rowtype;
  v_ids uuid[];
  v_submission_ids uuid[] := array[]::uuid[];
  v_submission_id uuid;
  v_result jsonb := '[]'::jsonb;
  v_canonical_rows jsonb;
  v_payload_hash text;
begin
  if not public.crm_kpi_is_business_manager() or p_request_id is null then
    raise exception using errcode = '42501', message = 'Chi manager/admin/owner duoc review KPI.';
  end if;
  if v_decision not in ('APPROVED', 'REJECTED', 'NEEDS_REVISION') then
    raise exception using errcode = '22023', message = 'Decision khong hop le.';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Review can 1-100 event.';
  end if;
  if jsonb_array_length(p_rows) <> (select count(distinct value->>'eventId') from jsonb_array_elements(p_rows)) then
    raise exception using errcode = '22023', message = 'Danh sach event bi trung.';
  end if;
  if v_decision = 'REJECTED'
     and v_reason not in ('DUPLICATE', 'INVALID_EVIDENCE', 'MISSING_LOCATION', 'MISSING_TIMESTAMP', 'INCOMPLETE_INFORMATION', 'NOT_NEW', 'OUT_OF_SCOPE', 'OTHER') then
    raise exception using errcode = '22023', message = 'Tu choi can reason code hop le.';
  end if;
  if (v_decision = 'NEEDS_REVISION' or v_reason = 'OTHER') and v_note is null then
    raise exception using errcode = '22023', message = 'Can ghi chu Manager cho NEEDS_REVISION/OTHER.';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'eventId', value->>'eventId',
      'expectedVersion', coalesce((value->>'expectedVersion')::integer, 0)
    ) order by value->>'eventId'
  ) into v_canonical_rows from jsonb_array_elements(p_rows);
  v_payload_hash := public.crm_kpi_payload_hash(jsonb_build_object(
    'action', 'event_review', 'schemaVersion', 1,
    'rows', v_canonical_rows, 'decision', v_decision,
    'reason', v_reason, 'managerNote', v_note
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'crm:kpi:action:' || v_actor || ':event_review:' || p_request_id::text, 0
  ));
  v_response := public.crm_kpi_idempotent_response(v_actor, 'event_review', p_request_id, v_payload_hash);
  if v_response is not null then return v_response; end if;

  select array_agg((x->>'eventId')::uuid order by x->>'eventId') into v_ids
  from jsonb_array_elements(p_rows) x;
  perform 1 from public.kpi_submission_events e where e.id = any(v_ids) order by e.id for update;
  if (select count(*) from public.kpi_submission_events where id = any(v_ids)) <> cardinality(v_ids) then
    raise exception using errcode = 'P0002', message = 'Co event khong ton tai.';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    select e.* into v_event
    from public.kpi_submission_events e
    join public.kpi_assignments a on a.id = e.assignment_id
    join public.app_users u on u.id = a.employee_id
    where e.id = (v_row->>'eventId')::uuid and lower(u.role) = 'sale';
    if v_event.id is null then raise exception using errcode = '42501', message = 'Manager chi review KPI cua sale.'; end if;
    if v_event.status <> 'PENDING'
       or v_event.lock_version <> coalesce((v_row->>'expectedVersion')::integer, 0) then
      raise exception using errcode = 'P0001', message = 'EVENT_VERSION_CONFLICT: Event da thay doi.';
    end if;
  end loop;

  perform set_config('crm.kpi_write', 'on', true);
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    update public.kpi_submission_events
    set status = v_decision,
        approved_value = case when v_decision = 'APPROVED' then claimed_value else null end,
        review_reason_code = case when v_decision = 'APPROVED' then null else v_reason end,
        manager_note = v_note,
        reviewed_by_user_id = v_actor,
        reviewed_at = now(), updated_at = now(), lock_version = lock_version + 1
    where id = (v_row->>'eventId')::uuid returning * into v_event;
    if not (v_event.submission_id = any(v_submission_ids)) then
      v_submission_ids := array_append(v_submission_ids, v_event.submission_id);
    end if;
    perform public.crm_kpi_write_audit(
      case v_decision when 'APPROVED' then 'event_approve'
        when 'REJECTED' then 'event_reject' else 'event_needs_revision' end,
      'kpi_submission_events', v_event.id::text,
      jsonb_build_object(
        'assignmentId', v_event.assignment_id,
        'submissionId', v_event.submission_id,
        'eventId', v_event.id, 'employeeId', v_event.actor_user_id,
        'decision', v_decision, 'reason', v_reason,
        'managerNote', v_note,
        'previousStatus', 'PENDING',
        'newStatus', v_event.status,
        'approvedValue', v_event.approved_value,
        'previousLockVersion', coalesce((v_row->>'expectedVersion')::integer, 0),
        'newLockVersion', v_event.lock_version,
        'sourceType', v_event.source_type,
        'sourceEventKey', v_event.source_event_key,
        'locationPresent', v_event.location_snapshot is not null
      )
    );
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'eventId', v_event.id, 'status', v_event.status, 'lockVersion', v_event.lock_version
    ));
  end loop;
  foreach v_submission_id in array v_submission_ids
  loop
    perform public.crm_kpi_refresh_submission_status(v_submission_id);
  end loop;

  v_response := jsonb_build_object(
    'decision', v_decision, 'count', jsonb_array_length(v_result), 'events', v_result
  );
  insert into public.kpi_action_requests(
    actor_user_id, action, request_id, request_payload_hash, request_schema_version, response
  ) values(v_actor, 'event_review', p_request_id, v_payload_hash, 1, v_response);
  perform public.crm_kpi_write_audit('bulk_review', 'kpi_submission_events', 'bulk',
    jsonb_build_object(
      'requestId', p_request_id, 'decision', v_decision,
      'reason', v_reason, 'managerNote', v_note,
      'eventCount', jsonb_array_length(v_result),
      'events', v_result
    ));
  return v_response;
end;
$$;

-- source: supabase-phase-kpi2-sale-withdraw-pending-event.sql @ offset 6414
create or replace function public.crm_kpi_withdraw_event(
  p_event_id uuid,
  p_expected_lock_version integer,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := public.crm_current_app_user_id();
  v_actor_role text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_event public.kpi_submission_events%rowtype;
  v_assignment public.kpi_assignments%rowtype;
  v_period public.kpi_periods%rowtype;
  v_response jsonb;
  v_payload_hash text;
  v_evidence_count integer;
begin
  if not public.crm_is_active_user() or p_request_id is null then
    raise exception using errcode = '42501', message = 'Yeu cau thu hoi khong hop le.';
  end if;

  select lower(role) into v_actor_role from public.app_users where id = v_actor and active = true;
  if v_actor_role <> 'sale' then
    raise exception using errcode = '42501', message = 'Chi Sale duoc thu hoi de xuat cua minh.';
  end if;
  if p_event_id is null or coalesce(p_expected_lock_version, 0) <= 0 then
    raise exception using errcode = '22023', message = 'Event hoac phien ban Event khong hop le.';
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'Ly do thu hoi la bat buoc va toi da 500 ky tu.';
  end if;

  v_payload_hash := public.crm_kpi_payload_hash(jsonb_build_object(
    'action', 'event_withdraw', 'schemaVersion', 1,
    'eventId', p_event_id, 'expectedVersion', p_expected_lock_version,
    'reason', v_reason
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'crm:kpi:action:' || v_actor || ':event_withdraw:' || p_request_id::text, 0
  ));
  v_response := public.crm_kpi_idempotent_response(
    v_actor, 'event_withdraw', p_request_id, v_payload_hash
  );
  if v_response is not null then return v_response; end if;

  select * into v_event
  from public.kpi_submission_events
  where id = p_event_id
  for update;
  if v_event.id is null then
    raise exception using errcode = 'P0002', message = 'Khong tim thay de xuat KPI.';
  end if;
  if v_event.actor_user_id <> v_actor then
    raise exception using errcode = '42501', message = 'Ban chi duoc thu hoi de xuat cua minh.';
  end if;
  if v_event.supersedes_event_id is not null then
    raise exception using errcode = '55000', message = 'Ban bo sung khong the thu hoi; hay gui lai theo yeu cau cua Manager.';
  end if;
  if v_event.status <> 'PENDING' or v_event.lock_version <> p_expected_lock_version then
    raise exception using errcode = 'P0001', message = 'EVENT_VERSION_CONFLICT: De xuat da duoc xu ly hoac thay doi.';
  end if;

  select * into v_assignment
  from public.kpi_assignments
  where id = v_event.assignment_id
  for share;
  if v_assignment.id is null or v_assignment.employee_id <> v_actor or v_assignment.assignment_status <> 'ASSIGNED' then
    raise exception using errcode = '42501', message = 'Assignment khong con thuoc Sale hien tai.';
  end if;
  select * into v_period from public.kpi_periods where id = v_assignment.period_id for share;
  if v_period.status <> 'ACTIVE' then
    raise exception using errcode = '55000', message = 'Chi de xuat trong ky KPI ACTIVE duoc thu hoi.';
  end if;

  select count(*) into v_evidence_count
  from public.kpi_evidence
  where event_id = v_event.id and status = 'ATTACHED';

  perform set_config('crm.kpi_write', 'on', true);
  update public.kpi_submission_events
  set status = 'WITHDRAWN',
      withdrawn_by_user_id = v_actor,
      withdrawn_at = now(),
      withdraw_reason = v_reason,
      updated_at = now(),
      lock_version = lock_version + 1
  where id = v_event.id
  returning * into v_event;

  perform public.crm_kpi_refresh_submission_status(v_event.submission_id);

  v_response := jsonb_build_object(
    'eventId', v_event.id,
    'submissionId', v_event.submission_id,
    'status', v_event.status,
    'lockVersion', v_event.lock_version,
    'withdrawnAt', v_event.withdrawn_at
  );
  insert into public.kpi_action_requests(
    actor_user_id, action, request_id, request_payload_hash, request_schema_version, response
  ) values(v_actor, 'event_withdraw', p_request_id, v_payload_hash, 1, v_response);

  perform public.crm_kpi_write_audit(
    'event_withdraw', 'kpi_submission_events', v_event.id::text,
    jsonb_build_object(
      'requestId', p_request_id,
      'assignmentId', v_event.assignment_id,
      'submissionId', v_event.submission_id,
      'eventId', v_event.id,
      'employeeId', v_actor,
      'reason', v_reason,
      'previousStatus', 'PENDING',
      'newStatus', 'WITHDRAWN',
      'previousLockVersion', p_expected_lock_version,
      'newLockVersion', v_event.lock_version,
      'evidenceCount', v_evidence_count,
      'sourceType', v_event.source_type,
      'sourceEventKey', v_event.source_event_key
    )
  );
  return v_response;
end;
$$;

-- source: supabase-phase-kpi2-customer-linked-event.sql @ offset 27781
create or replace function public.crm_kpi_submit_events(
  p_assignment_id uuid,
  p_request_id uuid,
  p_sale_note text,
  p_events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_actor text := public.crm_current_app_user_id();
  v_a public.kpi_assignments%rowtype;
  v_p public.kpi_periods%rowtype;
  v_s public.kpi_submissions%rowtype;
  v_event jsonb;
  v_e public.kpi_submission_events%rowtype;
  v_snapshot jsonb;
  v_customer_snapshot jsonb;
  v_source_type text;
  v_source_id text;
  v_source_key text;
  v_event_at timestamptz;
  v_customer_id text;
  v_requested_customer_id text;
  v_customer_name text;
  v_customer_company text;
  v_customer_phone text;
  v_customer_phone_normalized text;
  v_customer_address text;
  v_customer_mode text;
  v_value numeric;
  v_agg text;
  v_type text;
  v_evidence jsonb;
  v_evidence_id uuid;
  v_count integer;
  v_location jsonb;
  v_duplicate_count integer;
  v_ids jsonb := '[]'::jsonb;
  v_response jsonb;
  v_payload_hash text;
  v_note text := nullif(btrim(coalesce(p_sale_note, '')), '');
  v_duplicate record;
begin
  if not public.crm_is_active_user() or p_request_id is null then
    raise exception using errcode = '42501', message = 'Yeu cau submit khong hop le.';
  end if;
  v_payload_hash := public.crm_kpi_payload_hash(jsonb_build_object(
    'action', 'submission_create', 'schemaVersion', 1,
    'assignmentId', p_assignment_id, 'saleNote', v_note,
    'events', coalesce(p_events, 'null'::jsonb)
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'crm:kpi:action:' || v_actor || ':submission_create:' || p_request_id::text, 0
  ));
  v_response := public.crm_kpi_idempotent_response(
    v_actor, 'submission_create', p_request_id, v_payload_hash
  );
  if v_response is not null then return v_response; end if;

  select * into v_a from public.kpi_assignments
  where id = p_assignment_id for update;
  if v_a.id is null or v_a.employee_id <> v_actor or v_a.assignment_status <> 'ASSIGNED' then
    raise exception using errcode = '42501', message = 'Ban chi submit KPI duoc giao cho minh.';
  end if;
  select * into v_p from public.kpi_periods where id = v_a.period_id for share;
  if v_p.status <> 'ACTIVE' then
    raise exception using errcode = '55000', message = 'Chi ky KPI ACTIVE nhan submission.';
  end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'Moi submission can 1-50 event.';
  end if;

  v_agg := coalesce(v_a.definition_snapshot->>'aggregation_mode', 'COUNT');
  v_type := coalesce(v_a.definition_snapshot->>'kpi_type', 'MANUAL');
  v_customer_mode := upper(coalesce(
    nullif(v_a.definition_snapshot->>'customer_relation_mode', ''), 'NONE'
  ));
  if v_customer_mode not in ('REQUIRED', 'OPTIONAL', 'NONE') then
    raise exception using errcode = '55000', message = 'Assignment customer relation mode bi hong.';
  end if;

  perform set_config('crm.kpi_write', 'on', true);
  insert into public.kpi_submissions(assignment_id, request_id, submitted_by_user_id, sale_note)
  values(v_a.id, p_request_id, v_actor, v_note) returning * into v_s;

  for v_event in select value from jsonb_array_elements(p_events)
  loop
    v_source_type := upper(btrim(coalesce(v_event->>'sourceType', 'MANUAL')));
    v_source_id := nullif(btrim(v_event->>'sourceId'), '');
    v_requested_customer_id := nullif(btrim(v_event->>'customerId'), '');
    v_customer_snapshot := null;
    v_customer_name := null;
    v_customer_company := null;
    v_customer_phone := null;
    v_customer_phone_normalized := null;
    v_customer_address := null;

    if v_type in ('HYBRID', 'AUTO') then
      v_snapshot := public.crm_kpi_source_snapshot(v_a.id, v_source_type, v_source_id);
      v_source_key := v_snapshot->>'source_event_key';
      v_event_at := public.crm_kpi_validate_event_at(
        v_snapshot->>'event_at', v_p.starts_at, v_p.ends_at, v_p.timezone
      );
      v_customer_id := nullif(v_snapshot->>'customer_id', '');
      if v_event ? 'customerId' and v_requested_customer_id is distinct from v_customer_id then
        raise exception using errcode = '22023', message = 'Customer ID khong khop authoritative source event.';
      end if;
    else
      if v_source_type <> 'MANUAL' then
        raise exception using errcode = '22023', message = 'KPI MANUAL chi nhan event MANUAL.';
      end if;
      v_source_key := nullif(btrim(v_event->>'sourceEventKey'), '');
      if v_source_key is null or v_source_key !~ '^manual:[0-9a-f-]{36}$' then
        raise exception using errcode = '22023', message = 'Manual event key khong hop le.';
      end if;
      v_event_at := public.crm_kpi_validate_event_at(
        v_event->>'eventAt', v_p.starts_at, v_p.ends_at, v_p.timezone
      );
      v_customer_id := v_requested_customer_id;
      v_snapshot := coalesce(v_event->'eventSnapshot', '{}'::jsonb);
      if jsonb_typeof(v_snapshot) <> 'object'
         or nullif(btrim(coalesce(v_snapshot->>'title', v_snapshot->>'description', '')), '') is null then
        raise exception using errcode = '22023', message = 'Event MANUAL can tieu de hoac noi dung.';
      end if;
    end if;

    if v_customer_mode = 'REQUIRED' and v_customer_id is null then
      raise exception using errcode = '22023', message = 'KPI nay bat buoc Customer.';
    elsif v_customer_mode = 'NONE' and v_customer_id is not null then
      raise exception using errcode = '22023', message = 'KPI nay khong cho phep gan Customer.';
    end if;

    if v_customer_id is not null then
      v_customer_snapshot := public.crm_kpi_customer_snapshot(v_customer_id);
      v_customer_name := v_customer_snapshot->>'name';
      v_customer_company := v_customer_snapshot->>'companyName';
      v_customer_phone := v_customer_snapshot->>'phone';
      v_customer_phone_normalized := v_customer_snapshot->>'phoneNormalized';
      v_customer_address := v_customer_snapshot->>'address';
    end if;
    v_snapshot := public.crm_kpi_strip_customer_metadata(v_snapshot);

    begin
      v_value := coalesce((v_event->>'claimedValue')::numeric, 1);
    exception when others then
      raise exception using errcode = '22023', message = 'Gia tri event khong hop le.';
    end;
    if v_agg = 'COUNT' then
      v_value := 1;
    elsif v_value <= 0 then
      raise exception using errcode = '22023', message = 'Gia tri SUM phai lon hon 0.';
    end if;

    v_location := public.crm_kpi_validate_location(
      v_event->'location',
      coalesce((v_a.definition_snapshot->>'location_required')::boolean, false)
    );
    v_evidence := coalesce(v_event->'evidenceIds', '[]'::jsonb);
    if jsonb_typeof(v_evidence) <> 'array' then
      raise exception using errcode = '22023', message = 'Danh sach evidence khong hop le.';
    end if;
    v_count := jsonb_array_length(v_evidence);
    if v_count > least(2, coalesce((v_a.definition_snapshot->>'max_images_per_event')::integer, 2)) then
      raise exception using errcode = '22023', message = 'Vuot qua so anh cho phep moi event.';
    end if;
    if coalesce((v_a.definition_snapshot->>'evidence_required')::boolean, false) and v_count = 0 then
      raise exception using errcode = '22023', message = 'KPI nay bat buoc anh minh chung.';
    end if;
    if v_count <> (select count(*) from jsonb_array_elements_text(v_evidence))
       or v_count <> (select count(distinct value) from jsonb_array_elements_text(v_evidence)) then
      raise exception using errcode = '22023', message = 'Evidence ID bi trung hoac khong hop le.';
    end if;

    select count(*) into v_duplicate_count
    from public.kpi_submission_events x
    join public.kpi_assignments a on a.id = x.assignment_id
    where a.period_id = v_a.period_id and a.definition_id = v_a.definition_id
      and a.employee_id <> v_actor
      and x.source_type = v_source_type and x.source_event_key = v_source_key;

    insert into public.kpi_submission_events(
      submission_id, assignment_id, source_type, source_id, source_event_key,
      event_at, actor_user_id, customer_id,
      customer_name_snapshot, customer_company_name_snapshot,
      customer_phone_snapshot, customer_phone_normalized_snapshot,
      customer_address_snapshot,
      claimed_value, event_snapshot, location_snapshot,
      possible_duplicate, duplicate_context
    ) values (
      v_s.id, v_a.id, v_source_type, v_source_id, v_source_key,
      v_event_at, v_actor, v_customer_id,
      v_customer_name, v_customer_company, v_customer_phone,
      v_customer_phone_normalized, v_customer_address,
      v_value, v_snapshot, v_location, v_duplicate_count > 0,
      case when v_duplicate_count > 0
        then jsonb_build_array(jsonb_build_object('code', 'POSSIBLE_DUPLICATE', 'count', v_duplicate_count))
        else '[]'::jsonb end
    ) returning * into v_e;
    update public.kpi_submission_events set root_event_id = v_e.id where id = v_e.id;

    if v_duplicate_count > 0 then
      for v_duplicate in
        select x.id as duplicate_event_id, a.employee_id
        from public.kpi_submission_events x
        join public.kpi_assignments a on a.id = x.assignment_id
        where a.period_id = v_a.period_id and a.definition_id = v_a.definition_id
          and a.employee_id <> v_actor
          and x.source_type = v_source_type and x.source_event_key = v_source_key
        order by x.id
      loop
        insert into public.kpi_duplicate_matches(event_id, duplicate_event_id, duplicate_employee_id)
        values(v_e.id, v_duplicate.duplicate_event_id, v_duplicate.employee_id)
        on conflict (event_id, duplicate_event_id) do nothing;
      end loop;
    end if;

    for v_evidence_id in select value::text::uuid from jsonb_array_elements_text(v_evidence)
    loop
      update public.kpi_evidence
      set event_id = v_e.id, status = 'ATTACHED', attached_at = now(),
          updated_at = now(), lock_version = lock_version + 1
      where id = v_evidence_id and assignment_id = v_a.id
        and uploaded_by_user_id = v_actor and status = 'STAGED';
      if not found then
        raise exception using errcode = '22023', message = 'Evidence khong ton tai, khong thuoc ban hoac da duoc dung.';
      end if;
      perform public.crm_kpi_write_audit(
        'evidence_attach', 'kpi_evidence', v_evidence_id::text,
        jsonb_build_object('eventId', v_e.id, 'submissionId', v_s.id)
      );
    end loop;

    perform public.crm_kpi_write_audit(
      'event_claim_create', 'kpi_submission_events', v_e.id::text,
      jsonb_build_object(
        'periodId', v_a.period_id, 'assignmentId', v_a.id,
        'definitionId', v_a.definition_id, 'employeeId', v_actor,
        'submissionId', v_s.id, 'eventId', v_e.id,
        'sourceType', v_source_type, 'sourceId', v_source_id,
        'sourceEventKey', v_source_key, 'claimedValue', v_value,
        'possibleDuplicate', v_duplicate_count > 0,
        'customerId', v_customer_id, 'customerRelationMode', v_customer_mode,
        'customerLinked', v_customer_id is not null
      )
    );
    v_ids := v_ids || jsonb_build_array(v_e.id);
  end loop;

  v_response := jsonb_build_object(
    'submissionId', v_s.id, 'status', v_s.status,
    'eventIds', v_ids, 'eventCount', jsonb_array_length(v_ids)
  );
  insert into public.kpi_action_requests(
    actor_user_id, action, request_id, request_payload_hash, request_schema_version, response
  ) values(v_actor, 'submission_create', p_request_id, v_payload_hash, 1, v_response);
  perform public.crm_kpi_write_audit(
    'submission_create', 'kpi_submissions', v_s.id::text,
    jsonb_build_object(
      'periodId', v_a.period_id, 'assignmentId', v_a.id,
      'definitionId', v_a.definition_id, 'employeeId', v_actor,
      'submissionId', v_s.id, 'requestId', p_request_id, 'eventIds', v_ids
    )
  );
  return v_response;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'KPI_EVENT_ALREADY_CLAIMED: Event da duoc claim.';
end;
$$;

-- source: supabase-phase-kpi2-customer-linked-event.sql @ offset 40057
create or replace function public.crm_kpi_submit_revision(
  p_event_id uuid,
  p_request_id uuid,
  p_sale_note text,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := public.crm_current_app_user_id();
  v_old public.kpi_submission_events%rowtype;
  v_a public.kpi_assignments%rowtype;
  v_p public.kpi_periods%rowtype;
  v_s public.kpi_submissions%rowtype;
  v_new public.kpi_submission_events%rowtype;
  v_snapshot jsonb;
  v_source_snapshot jsonb;
  v_customer_snapshot jsonb;
  v_requested_customer_id text;
  v_customer_name text;
  v_customer_company text;
  v_customer_phone text;
  v_customer_phone_normalized text;
  v_customer_address text;
  v_customer_mode text;
  v_location jsonb;
  v_evidence jsonb;
  v_evidence_id uuid;
  v_count integer;
  v_value numeric;
  v_response jsonb;
  v_payload_hash text;
  v_note text := nullif(btrim(coalesce(p_sale_note, '')), '');
  v_event_at timestamptz;
begin
  if not public.crm_is_active_user() or p_request_id is null then
    raise exception using errcode = '42501', message = 'Revision request khong hop le.';
  end if;
  v_payload_hash := public.crm_kpi_payload_hash(jsonb_build_object(
    'action', 'event_revision', 'schemaVersion', 1,
    'eventId', p_event_id, 'saleNote', v_note,
    'event', coalesce(p_event, '{}'::jsonb)
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'crm:kpi:action:' || v_actor || ':event_revision:' || p_request_id::text, 0
  ));
  v_response := public.crm_kpi_idempotent_response(
    v_actor, 'event_revision', p_request_id, v_payload_hash
  );
  if v_response is not null then return v_response; end if;

  select * into v_old from public.kpi_submission_events
  where id = p_event_id for update;
  if v_old.id is null or v_old.actor_user_id <> v_actor or v_old.status <> 'NEEDS_REVISION' then
    raise exception using errcode = '42501', message = 'Chi event NEEDS_REVISION cua ban moi duoc gui lai.';
  end if;
  if exists(select 1 from public.kpi_submission_events where supersedes_event_id = v_old.id) then
    raise exception using errcode = '23505', message = 'Event nay da co revision.';
  end if;

  select * into v_a from public.kpi_assignments
  where id = v_old.assignment_id and employee_id = v_actor
    and assignment_status = 'ASSIGNED' for update;
  if v_a.id is null then
    raise exception using errcode = '42501', message = 'Assignment khong con thuoc sale hien tai.';
  end if;
  select * into v_p from public.kpi_periods where id = v_a.period_id for share;
  if v_p.status <> 'ACTIVE' then
    raise exception using errcode = '55000', message = 'Chi ky ACTIVE nhan revision.';
  end if;

  v_customer_mode := upper(coalesce(
    nullif(v_a.definition_snapshot->>'customer_relation_mode', ''), 'NONE'
  ));
  if v_customer_mode not in ('REQUIRED', 'OPTIONAL', 'NONE') then
    raise exception using errcode = '55000', message = 'Assignment customer relation mode bi hong.';
  end if;

  v_requested_customer_id := nullif(btrim(p_event->>'customerId'), '');
  if p_event ? 'customerId' and v_requested_customer_id is distinct from v_old.customer_id then
    raise exception using errcode = '22023', message = 'Revision khong duoc doi Customer.';
  end if;
  if v_customer_mode = 'REQUIRED' and v_old.customer_id is null then
    raise exception using errcode = '55000', message = 'Event khong dap ung Customer mode da dong bang.';
  elsif v_customer_mode = 'NONE' and v_old.customer_id is not null then
    raise exception using errcode = '55000', message = 'Event khong dap ung Customer mode da dong bang.';
  end if;

  v_snapshot := coalesce(p_event->'eventSnapshot', v_old.event_snapshot);
  if coalesce(v_a.definition_snapshot->>'kpi_type', 'MANUAL') in ('HYBRID', 'AUTO') then
    v_source_snapshot := public.crm_kpi_source_snapshot(
      v_a.id, v_old.source_type, v_old.source_id
    );
    if nullif(v_source_snapshot->>'customer_id', '') is distinct from v_old.customer_id then
      raise exception using errcode = '22023', message = 'Authoritative source da doi Customer; revision bi chan.';
    end if;
    v_snapshot := v_source_snapshot;
  elsif jsonb_typeof(v_snapshot) <> 'object'
        or nullif(btrim(coalesce(v_snapshot->>'title', v_snapshot->>'description', '')), '') is null then
    raise exception using errcode = '22023', message = 'Revision MANUAL can noi dung.';
  end if;
  v_snapshot := public.crm_kpi_strip_customer_metadata(v_snapshot);

  v_customer_name := null;
  v_customer_company := null;
  v_customer_phone := null;
  v_customer_phone_normalized := null;
  v_customer_address := null;
  if v_old.customer_id is not null then
    -- Rechecks current assignment + archive state and refreshes current DB values.
    v_customer_snapshot := public.crm_kpi_customer_snapshot(v_old.customer_id);
    v_customer_name := v_customer_snapshot->>'name';
    v_customer_company := v_customer_snapshot->>'companyName';
    v_customer_phone := v_customer_snapshot->>'phone';
    v_customer_phone_normalized := v_customer_snapshot->>'phoneNormalized';
    v_customer_address := v_customer_snapshot->>'address';
  end if;

  begin
    v_value := coalesce((p_event->>'claimedValue')::numeric, v_old.claimed_value);
  exception when others then
    raise exception using errcode = '22023', message = 'Gia tri revision khong hop le.';
  end;
  if coalesce(v_a.definition_snapshot->>'aggregation_mode', 'COUNT') = 'COUNT' then
    v_value := 1;
  elsif v_value <= 0 then
    raise exception using errcode = '22023', message = 'Gia tri SUM phai lon hon 0.';
  end if;

  v_event_at := public.crm_kpi_validate_event_at(
    coalesce(p_event->>'eventAt', v_old.event_at::text),
    v_p.starts_at, v_p.ends_at, v_p.timezone
  );
  v_location := public.crm_kpi_validate_location(
    coalesce(p_event->'location', v_old.location_snapshot),
    coalesce((v_a.definition_snapshot->>'location_required')::boolean, false)
  );
  v_evidence := coalesce(p_event->'evidenceIds', '[]'::jsonb);
  if jsonb_typeof(v_evidence) <> 'array' then
    raise exception using errcode = '22023', message = 'Danh sach evidence khong hop le.';
  end if;
  v_count := jsonb_array_length(v_evidence);
  if v_count > least(2, coalesce((v_a.definition_snapshot->>'max_images_per_event')::integer, 2)) then
    raise exception using errcode = '22023', message = 'Vuot qua so anh cho phep.';
  end if;
  if coalesce((v_a.definition_snapshot->>'evidence_required')::boolean, false) and v_count = 0 then
    raise exception using errcode = '22023', message = 'Revision bat buoc evidence moi.';
  end if;
  if v_count <> (select count(*) from jsonb_array_elements_text(v_evidence))
     or v_count <> (select count(distinct value) from jsonb_array_elements_text(v_evidence)) then
    raise exception using errcode = '22023', message = 'Evidence ID bi trung hoac khong hop le.';
  end if;

  perform set_config('crm.kpi_write', 'on', true);
  insert into public.kpi_submissions(
    assignment_id, attempt_no, request_id, submitted_by_user_id, sale_note
  ) values (
    v_a.id, v_old.revision_no + 1, p_request_id, v_actor, v_note
  ) returning * into v_s;

  insert into public.kpi_submission_events(
    submission_id, assignment_id, source_type, source_id, source_event_key,
    event_at, actor_user_id, customer_id,
    customer_name_snapshot, customer_company_name_snapshot,
    customer_phone_snapshot, customer_phone_normalized_snapshot,
    customer_address_snapshot,
    claimed_value, event_snapshot, location_snapshot,
    possible_duplicate, duplicate_context,
    supersedes_event_id, root_event_id, revision_no
  ) values (
    v_s.id, v_a.id, v_old.source_type, v_old.source_id, v_old.source_event_key,
    v_event_at, v_actor, v_old.customer_id,
    v_customer_name, v_customer_company, v_customer_phone,
    v_customer_phone_normalized, v_customer_address,
    v_value, v_snapshot || jsonb_build_object('supersedesEventId', v_old.id),
    v_location, v_old.possible_duplicate, v_old.duplicate_context,
    v_old.id, coalesce(v_old.root_event_id, v_old.id), v_old.revision_no + 1
  ) returning * into v_new;

  for v_evidence_id in select value::text::uuid from jsonb_array_elements_text(v_evidence)
  loop
    update public.kpi_evidence
    set event_id = v_new.id, status = 'ATTACHED', attached_at = now(),
        updated_at = now(), lock_version = lock_version + 1
    where id = v_evidence_id and assignment_id = v_a.id
      and uploaded_by_user_id = v_actor and status = 'STAGED';
    if not found then
      raise exception using errcode = '22023', message = 'Evidence revision khong hop le.';
    end if;
    perform public.crm_kpi_write_audit(
      'evidence_attach', 'kpi_evidence', v_evidence_id::text,
      jsonb_build_object('eventId', v_new.id, 'revision', true)
    );
  end loop;

  v_response := jsonb_build_object(
    'submissionId', v_s.id, 'eventIds', jsonb_build_array(v_new.id),
    'eventCount', 1, 'supersedesEventId', v_old.id
  );
  insert into public.kpi_action_requests(
    actor_user_id, action, request_id, request_payload_hash, request_schema_version, response
  ) values(v_actor, 'event_revision', p_request_id, v_payload_hash, 1, v_response);
  perform public.crm_kpi_write_audit(
    'event_revision', 'kpi_submission_events', v_new.id::text,
    jsonb_build_object(
      'periodId', v_a.period_id, 'definitionId', v_a.definition_id,
      'assignmentId', v_a.id, 'submissionId', v_s.id,
      'employeeId', v_actor, 'eventId', v_old.id,
      'newEventId', v_new.id, 'supersedesEventId', v_old.id,
      'sourceType', v_new.source_type, 'sourceEventKey', v_new.source_event_key,
      'previousStatus', v_old.status, 'newStatus', v_new.status,
      'previousLockVersion', v_old.lock_version,
      'newLockVersion', v_new.lock_version, 'saleNote', v_note,
      'locationPresent', v_new.location_snapshot is not null,
      'evidenceCount', v_count, 'customerId', v_old.customer_id,
      'customerRelationMode', v_customer_mode,
      'customerLinked', v_old.customer_id is not null
    )
  );
  return v_response;
end;
$$;

-- source: supabase-phase-kpi-r31-period-lifecycle.sql @ offset 11575
create or replace function public.crm_kpi_get_assignment_progress(p_period_id uuid default null)
returns table(
  assignment_id uuid, period_id uuid, period_month date, period_status text, definition_id uuid,
  employee_id text, employee_name text, definition_snapshot jsonb, target numeric, score_enabled boolean,
  aggregation_mode text, approved_actual numeric, pending_count bigint, pending_value numeric,
  needs_revision_count bigint, needs_revision_value numeric, rejected_count bigint, rejected_value numeric,
  actual_completion_pct numeric, scoring_completion_pct numeric, has_open_items boolean
)
language sql security definer set search_path=public stable as $$
  select a.id,p.id,p.period_month,p.status,a.definition_id,a.employee_id,u.name,a.definition_snapshot,
    a.target,a.score_enabled,coalesce(a.definition_snapshot->>'aggregation_mode','COUNT'),
    coalesce(sum(e.approved_value) filter(where e.status='APPROVED'),0),
    count(e.id) filter(where e.status='PENDING'),coalesce(sum(e.claimed_value) filter(where e.status='PENDING'),0),
    count(e.id) filter(where e.status='NEEDS_REVISION' and not exists(select 1 from public.kpi_submission_events r where r.supersedes_event_id=e.id)),
    coalesce(sum(e.claimed_value) filter(where e.status='NEEDS_REVISION' and not exists(select 1 from public.kpi_submission_events r where r.supersedes_event_id=e.id)),0),
    count(e.id) filter(where e.status='REJECTED'),coalesce(sum(e.claimed_value) filter(where e.status='REJECTED'),0),
    round(coalesce(sum(e.approved_value) filter(where e.status='APPROVED'),0)/a.target*100,2),
    least(round(coalesce(sum(e.approved_value) filter(where e.status='APPROVED'),0)/a.target*100,2),100),
    count(e.id) filter(where e.status='PENDING' or (e.status='NEEDS_REVISION' and not exists(select 1 from public.kpi_submission_events r where r.supersedes_event_id=e.id)))>0
  from public.kpi_assignments a join public.kpi_periods p on p.id=a.period_id
  join public.app_users u on u.id=a.employee_id left join public.kpi_submission_events e on e.assignment_id=a.id
  where a.assignment_status='ASSIGNED'
    and ((p_period_id is null and p.status in ('ACTIVE','CLOSED'))
      or (p_period_id is not null and p.id=p_period_id and p.status in ('ACTIVE','CLOSED','CANCELLED')))
    and (public.crm_kpi_is_business_manager() or a.employee_id=public.crm_current_app_user_id())
  group by a.id,p.id,u.name;
$$;

-- source: supabase-phase-kpi-r31-period-lifecycle.sql @ offset 13983
create or replace function public.crm_kpi_get_monthly_scores(p_period_id uuid)
returns table(employee_id text,employee_name text,included_kpi_count bigint,monthly_score numeric,has_open_items boolean)
language sql security definer set search_path=public stable as $$
  select x.employee_id,x.employee_name,count(*) filter(where x.score_enabled),
    round(coalesce(avg(x.scoring_completion_pct) filter(where x.score_enabled),0),2),
    coalesce(bool_or(x.has_open_items) filter(where x.score_enabled),false)
  from public.crm_kpi_get_assignment_progress(p_period_id) x
  where exists(select 1 from public.kpi_periods p where p.id=p_period_id and p.status in ('ACTIVE','CLOSED'))
  group by x.employee_id,x.employee_name;
$$;

reset check_function_bodies;


-- ===== Triggers (names and timing identical to Production) =====
create trigger kpi_periods_guard_direct_write before insert or delete or update on public.kpi_periods for each row execute function crm_kpi_guard_direct_write();
create trigger kpi_definitions_guard_direct_write before insert or delete or update on public.kpi_definitions for each row execute function crm_kpi_guard_direct_write();
create trigger kpi_assignments_guard_direct_write before insert or delete or update on public.kpi_assignments for each row execute function crm_kpi_guard_direct_write();
create trigger kpi_submissions_guard_direct_write before insert or delete or update on public.kpi_submissions for each row execute function crm_kpi_guard_direct_write();
create trigger kpi_submissions_r31_period_guard before insert or delete or update on public.kpi_submissions for each row execute function crm_kpi_guard_runtime_period_active();
create trigger kpi_submission_events_guard_direct_write before insert or delete or update on public.kpi_submission_events for each row execute function crm_kpi_guard_direct_write();
create trigger kpi_submission_events_normalize_location before insert or update of location_snapshot on public.kpi_submission_events for each row execute function crm_kpi_normalize_event_location();
create trigger kpi_submission_events_r31_period_guard before insert or delete or update on public.kpi_submission_events for each row execute function crm_kpi_guard_runtime_period_active();
create trigger kpi_evidence_guard_direct_write before insert or delete or update on public.kpi_evidence for each row execute function crm_kpi_guard_direct_write();
create trigger kpi_evidence_r31_period_guard before insert or delete or update on public.kpi_evidence for each row execute function crm_kpi_guard_runtime_period_active();
create trigger kpi_action_requests_guard_direct_write before insert or delete or update on public.kpi_action_requests for each row execute function crm_kpi_guard_direct_write();
create trigger kpi_duplicate_matches_guard_direct_write before insert or delete or update on public.kpi_duplicate_matches for each row execute function crm_kpi_guard_direct_write();

-- ===== Function ACLs (identical to Production proacl) =====
revoke all on all functions in schema public from public, anon, authenticated, service_role;
grant execute on function public.crm_current_email(), public.crm_current_user_role(), public.crm_is_active_user()
  to public, anon, authenticated, service_role;
grant execute on function
  public.crm_current_app_user_id(),
  public.crm_kpi_is_admin_owner(), public.crm_kpi_is_business_manager(),
  public.crm_kpi_get_assignment_progress(uuid), public.crm_kpi_get_monthly_scores(uuid),
  public.crm_kpi_period_runtime_dependencies(uuid),
  public.crm_kpi_close_period_foundation(uuid, integer),
  public.crm_kpi_cancel_active_period(uuid, integer, text),
  public.crm_kpi_reopen_period(uuid, integer, text),
  public.crm_kpi_review_events(uuid, jsonb, text, text, text),
  public.crm_kpi_withdraw_event(uuid, integer, text, uuid),
  public.crm_kpi_submit_events(uuid, uuid, text, jsonb),
  public.crm_kpi_submit_revision(uuid, uuid, text, jsonb)
  to authenticated, service_role;
grant execute on all functions in schema public to service_role;

-- ===== Pinned Production function manifest (md5 of pg_get_functiondef, 2026-10-08) =====
create schema if not exists lifecycle_test;
create table lifecycle_test.prod_function_manifest (proname text primary key, md5 text not null);
insert into lifecycle_test.prod_function_manifest values
('crm_current_app_user_id','9aac5c9a1f9e8f07c045ae6677da2ba7'),
('crm_current_email','7587c5eae664e202e70c56ca8c1de7af'),
('crm_current_user_role','a4ab573629d7166f7d63f4a53c82ea1d'),
('crm_is_active_user','ee1fd2f078bde359ea55a3b0105842a7'),
('crm_kpi_cancel_active_period','462fe13b70e6ef4c915d84021b5282d8'),
('crm_kpi_close_period_foundation','a95bb935b7822c9700166055bf3b7eac'),
('crm_kpi_get_assignment_progress','8c71bd6ef703dd27218e0a85e6f7d396'),
('crm_kpi_get_monthly_scores','708c3d8c4504a443af2bc8c4cde69bfa'),
('crm_kpi_guard_direct_write','5dc3d18befcba79f50200ca5f6189d56'),
('crm_kpi_guard_runtime_period_active','2e79400a55e697d7386dd42b0c058e66'),
('crm_kpi_idempotent_response','5ba4e363b86d0beddf5cc26e1d9abb5b'),
('crm_kpi_is_admin_owner','465bdff900eb5b58d3acd390b623f2a7'),
('crm_kpi_is_business_manager','8456327f8c2869c013f67c3b5bdcc8ce'),
('crm_kpi_normalize_event_location','7d6dc40bbdcd005a5fbad4df9e67f0df'),
('crm_kpi_payload_hash','4b986c1c13b3346c4384a16fd1057f1d'),
('crm_kpi_period_runtime_dependencies','67ce23a9be524959c875c4456fd0eede'),
('crm_kpi_r3_reason','d9b233aa9dcc22e13ac2695f40c2fa77'),
('crm_kpi_refresh_submission_status','5e400e5c71db44dd17075d394608d3ed'),
('crm_kpi_reopen_period','80f9b4434bf4d890ac541e864592cc38'),
('crm_kpi_review_events','8c4683686ec66bedbd7b57005c18dbf9'),
('crm_kpi_strip_customer_metadata','c333728b9306caef2b1e2689ae72d59c'),
('crm_kpi_submit_events','f9c504f2d9920619efda2ba012d37710'),
('crm_kpi_submit_revision','a1bb7ced600d1b86cbcee5391abb9e4a'),
('crm_kpi_validate_event_at','1aa0460febc9ebd88b0041de682e971d'),
('crm_kpi_validate_location','a068ae943f3496641de613c9eb43af8a'),
('crm_kpi_withdraw_event','a2a4e564fef4db1fbe3fe9826a56e546'),
('crm_kpi_write_audit','9da0455f5af1bffc7093252fcca9f8b2'),
('crm_write_audit','04de36f2cbd459a76f3a25a1ac8e2912');
