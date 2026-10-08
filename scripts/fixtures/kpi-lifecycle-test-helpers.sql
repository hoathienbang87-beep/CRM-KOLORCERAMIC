-- =====================================================================
-- KPI 7C-A lifecycle — synthetic fixtures and helpers (disposable DB only).
-- Loaded after kpi-lifecycle-prod-baseline.sql and the 7C-A migration.
-- All people / customers are synthetic (example.test); no Production data.
-- Runtime rows are created through the REAL RPCs (submit / review /
-- withdraw / revision) so fixtures follow Production code paths.
-- =====================================================================

insert into auth.users(id, email) values
  ('7c000000-0000-4000-8000-0000000000a1', 'owner@example.test'),
  ('7c000000-0000-4000-8000-0000000000a2', 'admin@example.test'),
  ('7c000000-0000-4000-8000-0000000000a3', 'manager@example.test'),
  ('7c000000-0000-4000-8000-0000000000b1', 'sale1@example.test'),
  ('7c000000-0000-4000-8000-0000000000b2', 'sale2@example.test'),
  ('7c000000-0000-4000-8000-0000000000b3', 'sale3@example.test'),
  ('7c000000-0000-4000-8000-0000000000c1', 'inactive.manager@example.test');

insert into public.app_users(id, supabase_auth_id, email, name, role, active, lifecycle_status) values
  ('u_owner',   '7c000000-0000-4000-8000-0000000000a1', 'owner@example.test',   'Owner Test',   'owner',   true, 'active'),
  ('u_admin',   '7c000000-0000-4000-8000-0000000000a2', 'admin@example.test',   'Admin Test',   'admin',   true, 'active'),
  ('u_manager', '7c000000-0000-4000-8000-0000000000a3', 'manager@example.test', 'Manager Test', 'manager', true, 'active'),
  ('u_sale1',   '7c000000-0000-4000-8000-0000000000b1', 'sale1@example.test',   'Sale One',     'sale',    true, 'active'),
  ('u_sale2',   '7c000000-0000-4000-8000-0000000000b2', 'sale2@example.test',   'Sale Two',     'sale',    true, 'active'),
  ('u_sale3',   '7c000000-0000-4000-8000-0000000000b3', 'sale3@example.test',   'Sale Three',   'sale',    true, 'active'),
  ('u_inactive_manager', '7c000000-0000-4000-8000-0000000000c1', 'inactive.manager@example.test', 'Inactive Manager', 'manager', false, 'inactive');

insert into public.kpi_definitions(id, code, name, kpi_type, unit, created_by_user_id, updated_by_user_id,
  evidence_required, aggregation_mode, customer_relation_mode) values
  ('7c000000-0000-4000-8000-00000000d001', 'LIFECYCLE_VISIT', 'Lifecycle visit', 'MANUAL', 'lần', 'u_owner', 'u_owner', true, 'COUNT', 'NONE'),
  ('7c000000-0000-4000-8000-00000000d002', 'LIFECYCLE_SALES', 'Lifecycle sales', 'MANUAL', 'VND', 'u_owner', 'u_owner', false, 'SUM', 'NONE');

create or replace function lifecycle_test.actor(p_user text) returns void language plpgsql as $$
declare v uuid;
begin
  select supabase_auth_id into v from public.app_users where id = p_user;
  perform set_config('request.jwt.claim.sub', coalesce(v::text, ''), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end $$;

-- Period in any lifecycle state, written as the migration owner (no JWT).
create or replace function lifecycle_test.mk_period(p_id uuid, p_month date, p_status text) returns uuid language plpgsql as $$
declare v_start timestamptz := (p_month::timestamp at time zone 'Asia/Ho_Chi_Minh');
        v_end timestamptz := ((p_month + interval '1 month')::timestamp at time zone 'Asia/Ho_Chi_Minh');
begin
  insert into public.kpi_periods(id, period_month, name, status, starts_at, ends_at, created_by_user_id,
    activated_by_user_id, activated_at, closed_by_user_id, closed_at,
    cancelled_by_user_id, cancelled_at, cancel_reason, version)
  values (p_id, p_month, 'Kỳ ' || to_char(p_month, 'MM/YYYY'),
    case when p_status = 'DRAFT' then 'DRAFT' else 'ACTIVE' end, v_start, v_end, 'u_owner',
    case when p_status <> 'DRAFT' then 'u_owner' end, case when p_status <> 'DRAFT' then now() end,
    null, null, null, null, null, 3);
  -- runtime rows are created while ACTIVE; CLOSED/CANCELLED are applied via set_status
  return p_id;
end $$;

create or replace function lifecycle_test.set_status(p_id uuid, p_status text) returns void language plpgsql as $$
begin
  update public.kpi_periods set status = p_status,
    closed_by_user_id = case when p_status = 'CLOSED' then 'u_owner' end,
    closed_at = case when p_status = 'CLOSED' then now() end,
    cancelled_by_user_id = case when p_status = 'CANCELLED' then 'u_owner' end,
    cancelled_at = case when p_status = 'CANCELLED' then now() end,
    cancel_reason = case when p_status = 'CANCELLED' then 'fixture' end
  where id = p_id;
end $$;

create or replace function lifecycle_test.mk_assignment(p_id uuid, p_period uuid, p_employee text,
  p_definition uuid default '7c000000-0000-4000-8000-00000000d001', p_target numeric default 10) returns uuid language plpgsql as $$
declare d public.kpi_definitions%rowtype;
begin
  select * into d from public.kpi_definitions where id = p_definition;
  insert into public.kpi_assignments(id, period_id, definition_id, employee_id, target, effective_at,
    definition_snapshot, assigned_by_user_id, score_enabled)
  values (p_id, p_period, p_definition, p_employee, p_target, now(),
    jsonb_build_object('code', d.code, 'name', d.name, 'description', d.description, 'kpi_type', d.kpi_type,
      'source_metric_key', d.source_metric_key, 'unit', d.unit, 'submission_mode', d.submission_mode,
      'evidence_required', d.evidence_required, 'customer_relation_mode', d.customer_relation_mode,
      'definition_version', d.version, 'aggregation_mode', d.aggregation_mode,
      'max_images_per_event', d.max_images_per_event, 'location_required', d.location_required),
    'u_owner', true);
  return p_id;
end $$;

-- One event through the real crm_kpi_submit_events, with one attached Evidence.
create or replace function lifecycle_test.submit(p_sale text, p_assignment uuid, p_value numeric default 1)
returns uuid language plpgsql as $$
declare v_evidence uuid := gen_random_uuid(); v_result jsonb; v_period public.kpi_periods%rowtype;
begin
  select p.* into v_period from public.kpi_periods p join public.kpi_assignments a on a.period_id = p.id where a.id = p_assignment;
  insert into public.kpi_evidence(id, assignment_id, object_path, original_name, mime_type, size_bytes, sha256, uploaded_by_user_id)
  values (v_evidence, p_assignment, 'kpi2/' || p_assignment || '/' || v_evidence || '.jpg', 'evidence.jpg', 'image/jpeg', 1024,
          encode(extensions.digest(v_evidence::text, 'sha256'), 'hex'), p_sale);
  perform lifecycle_test.actor(p_sale);
  v_result := public.crm_kpi_submit_events(p_assignment, gen_random_uuid(), null, jsonb_build_array(jsonb_build_object(
    'sourceType', 'MANUAL', 'sourceEventKey', 'manual:' || gen_random_uuid(),
    'eventAt', to_char((v_period.starts_at + interval '3 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'claimedValue', p_value,
    'eventSnapshot', jsonb_build_object('title', 'Synthetic visit'),
    'evidenceIds', jsonb_build_array(v_evidence))));
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('crm.kpi_write', '', true);
  return (v_result->'eventIds'->>0)::uuid;
end $$;

create or replace function lifecycle_test.review(p_event uuid, p_decision text, p_reason text default null, p_note text default null)
returns void language plpgsql as $$
declare v_version integer;
begin
  select lock_version into v_version from public.kpi_submission_events where id = p_event;
  perform lifecycle_test.actor('u_manager');
  perform public.crm_kpi_review_events(gen_random_uuid(), jsonb_build_array(jsonb_build_object('eventId', p_event, 'expectedVersion', v_version)),
    p_decision, p_reason, coalesce(p_note, case when p_decision = 'NEEDS_REVISION' then 'Bổ sung ảnh' end));
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('crm.kpi_write', '', true);
end $$;

create or replace function lifecycle_test.withdraw(p_sale text, p_event uuid) returns void language plpgsql as $$
declare v_version integer;
begin
  select lock_version into v_version from public.kpi_submission_events where id = p_event;
  perform lifecycle_test.actor(p_sale);
  perform public.crm_kpi_withdraw_event(p_event, v_version, 'Gửi nhầm', gen_random_uuid());
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('crm.kpi_write', '', true);
end $$;

-- Resolve a NEEDS_REVISION event through the real crm_kpi_submit_revision.
create or replace function lifecycle_test.revise(p_sale text, p_event uuid) returns uuid language plpgsql as $$
declare v_evidence uuid := gen_random_uuid(); v_assignment uuid; v_result jsonb;
begin
  select assignment_id into v_assignment from public.kpi_submission_events where id = p_event;
  insert into public.kpi_evidence(id, assignment_id, object_path, original_name, mime_type, size_bytes, sha256, uploaded_by_user_id)
  values (v_evidence, v_assignment, 'kpi2/' || v_assignment || '/' || v_evidence || '.jpg', 'revision.jpg', 'image/jpeg', 2048,
          encode(extensions.digest(v_evidence::text, 'sha256'), 'hex'), p_sale);
  perform lifecycle_test.actor(p_sale);
  v_result := public.crm_kpi_submit_revision(p_event, gen_random_uuid(), 'Đã bổ sung',
    jsonb_build_object('eventSnapshot', jsonb_build_object('title', 'Synthetic visit (revised)'),
                       'evidenceIds', jsonb_build_array(v_evidence)));
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('crm.kpi_write', '', true);
  return (v_result->'eventIds'->>0)::uuid;
end $$;

-- Full, comparable state of one period (no customer data).
create or replace function lifecycle_test.snapshot(p_period uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'period', (select jsonb_build_object('status', status, 'version', version, 'closed_at', closed_at is not null,
                 'closed_by', closed_by_user_id) from public.kpi_periods where id = p_period),
    'events', coalesce((select jsonb_object_agg(e.id, jsonb_build_object('status', e.status, 'reason', e.review_reason_code,
                 'lock', e.lock_version, 'approved', e.approved_value, 'reviewed_by', e.reviewed_by_user_id,
                 'note', e.manager_note, 'supersedes', e.supersedes_event_id))
               from public.kpi_submission_events e join public.kpi_assignments a on a.id = e.assignment_id
               where a.period_id = p_period), '{}'::jsonb),
    'submissions', coalesce((select jsonb_object_agg(s.id, jsonb_build_object('status', s.status, 'lock', s.lock_version))
               from public.kpi_submissions s join public.kpi_assignments a on a.id = s.assignment_id
               where a.period_id = p_period), '{}'::jsonb),
    'evidence', coalesce((select jsonb_object_agg(v.id, jsonb_build_object('status', v.status, 'event', v.event_id,
                 'path', v.object_path, 'lock', v.lock_version))
               from public.kpi_evidence v join public.kpi_assignments a on a.id = v.assignment_id
               where a.period_id = p_period), '{}'::jsonb),
    'approved_actual', (select coalesce(sum(e.approved_value) filter (where e.status = 'APPROVED'), 0)
               from public.kpi_submission_events e join public.kpi_assignments a on a.id = e.assignment_id
               where a.period_id = p_period),
    'audit_count', (select count(*) from public.audit_logs)
  );
$$;
