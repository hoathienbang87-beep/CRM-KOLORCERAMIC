-- STAGING DEVELOPMENT / SUPERSEDED FOR PRODUCTION.
-- Production source of truth: supabase-phase-kpi2-final-consolidated.sql.
-- KPI-2R staging remediation for the six production-readiness blockers.
-- DEVELOPMENT CHAIN ONLY. Production must use the final consolidated artifact.
-- Dependencies: KPI-1 and all five KPI-2 staging development migrations.

begin;

-- ---------------------------------------------------------------------------
-- B1. Server-side payload-bound idempotency
-- ---------------------------------------------------------------------------

alter table public.kpi_action_requests
  add column if not exists request_payload_hash text,
  add column if not exists request_schema_version integer not null default 1;

-- Staging may contain an old request from a prior test. It cannot be replayed
-- safely because its original request payload was not persisted.
update public.kpi_action_requests
set request_payload_hash = repeat('0', 64),
    request_schema_version = 0
where request_payload_hash is null;

alter table public.kpi_action_requests
  alter column request_payload_hash set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'kpi_action_requests_payload_hash_check'
      and conrelid = 'public.kpi_action_requests'::regclass
  ) then
    alter table public.kpi_action_requests
      add constraint kpi_action_requests_payload_hash_check
      check (request_payload_hash ~ '^[a-f0-9]{64}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'kpi_action_requests_schema_version_check'
      and conrelid = 'public.kpi_action_requests'::regclass
  ) then
    alter table public.kpi_action_requests
      add constraint kpi_action_requests_schema_version_check
      check (request_schema_version >= 0);
  end if;
end;
$$;

create or replace function public.crm_kpi_payload_hash(p_payload jsonb)
returns text
language sql
security definer
set search_path = public, extensions
immutable
as $$
  select encode(extensions.digest(convert_to(coalesce(p_payload, 'null'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');
$$;

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

revoke all on function public.crm_kpi_payload_hash(jsonb) from public, anon, authenticated;
revoke all on function public.crm_kpi_idempotent_response(text, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- B3. Canonical server validators
-- ---------------------------------------------------------------------------

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

revoke all on function public.crm_kpi_validate_location(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.crm_kpi_validate_event_at(text, timestamptz, timestamptz, text) from public, anon, authenticated;

-- Business event_at remains mandatory for every event. timestamp_required in
-- the definition controls supplementary capture-time evidence, not nullability
-- of the canonical business event timestamp.

-- ---------------------------------------------------------------------------
-- B6. Manager-only duplicate detail
-- ---------------------------------------------------------------------------

create table if not exists public.kpi_duplicate_matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.kpi_submission_events(id) on delete restrict,
  duplicate_event_id uuid not null references public.kpi_submission_events(id) on delete restrict,
  duplicate_employee_id text not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint kpi_duplicate_matches_pair_unique unique (event_id, duplicate_event_id),
  constraint kpi_duplicate_matches_self_check check (event_id <> duplicate_event_id)
);

create index if not exists kpi_duplicate_matches_event_idx
  on public.kpi_duplicate_matches(event_id, created_at);

drop trigger if exists kpi_duplicate_matches_guard_direct_write on public.kpi_duplicate_matches;
create trigger kpi_duplicate_matches_guard_direct_write
before insert or update or delete on public.kpi_duplicate_matches
for each row execute function public.crm_kpi_guard_direct_write();

alter table public.kpi_duplicate_matches enable row level security;
drop policy if exists "kpi2 duplicate manager read" on public.kpi_duplicate_matches;
create policy "kpi2 duplicate manager read"
on public.kpi_duplicate_matches for select to authenticated
using (public.crm_kpi_is_business_manager());

revoke all on public.kpi_duplicate_matches from public, anon, authenticated;
grant select on public.kpi_duplicate_matches to authenticated;

create or replace function public.crm_kpi_get_duplicate_context(p_event_ids uuid[] default null)
returns table(
  event_id uuid,
  duplicate_event_id uuid,
  duplicate_employee_id text,
  duplicate_employee_name text,
  source_type text,
  source_event_key text
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chi manager/admin/owner duoc xem chi tiet duplicate KPI.';
  end if;
  if p_event_ids is not null and cardinality(p_event_ids) > 500 then
    raise exception using errcode = '54000', message = 'Chi duoc xem toi da 500 event moi lan.';
  end if;
  return query
  select m.event_id, m.duplicate_event_id, m.duplicate_employee_id,
    u.name, e.source_type, e.source_event_key
  from public.kpi_duplicate_matches m
  join public.kpi_submission_events e on e.id = m.duplicate_event_id
  left join public.app_users u on u.id = m.duplicate_employee_id
  where p_event_ids is null or m.event_id = any(p_event_ids)
  order by m.event_id, m.created_at, m.duplicate_event_id;
end;
$$;

revoke all on function public.crm_kpi_get_duplicate_context(uuid[]) from public, anon;
grant execute on function public.crm_kpi_get_duplicate_context(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- B2. Canonical source attribution
-- ---------------------------------------------------------------------------

create or replace function public.crm_kpi_resolve_user_id_by_email(p_email text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select u.id
  from public.app_users u
  where lower(u.email) = lower(nullif(btrim(p_email), ''))
  order by u.created_at, u.id
  limit 1;
$$;

revoke all on function public.crm_kpi_resolve_user_id_by_email(text) from public, anon, authenticated;

create or replace function public.crm_kpi_source_snapshot(
  p_assignment_id uuid,
  p_source_type text,
  p_source_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_assignment public.kpi_assignments%rowtype;
  v_period public.kpi_periods%rowtype;
  v_metric text;
  v_row jsonb;
  v_actor text := public.crm_current_app_user_id();
begin
  select * into v_assignment from public.kpi_assignments where id = p_assignment_id;
  if v_assignment.id is null or v_assignment.employee_id <> v_actor then
    raise exception using errcode = '42501', message = 'Assignment khong thuoc sale hien tai.';
  end if;
  select * into v_period from public.kpi_periods where id = v_assignment.period_id;
  v_metric := coalesce(v_assignment.definition_snapshot->>'source_metric_key', '');

  if v_metric = 'care_logs_v1' and upper(p_source_type) = 'CARE_LOG' then
    select jsonb_build_object(
      'source_type', 'CARE_LOG', 'source_id', l.id,
      'source_event_key', 'care_log:' || l.id,
      'event_at', l.created_at, 'actor_user_id', v_actor,
      'customer_id', l.customer_id, 'customer_name', l.customer_name,
      'care_channel', l.care_channel, 'care_result', l.care_result,
      'note', l.note, 'source_updated_at', l.updated_at
    ) into v_row
    from public.care_logs l
    where l.id = p_source_id
      and not coalesce(l.is_deleted, false)
      and public.crm_kpi_resolve_user_id_by_email(l.created_by_email) = v_actor
      and l.created_at >= v_period.starts_at and l.created_at < v_period.ends_at;
  elsif v_metric = 'customers_v1' and upper(p_source_type) = 'CUSTOMER' then
    select jsonb_build_object(
      'source_type', 'CUSTOMER', 'source_id', c.id,
      'source_event_key', 'customer:' || c.id,
      'event_at', c.created_at, 'actor_user_id', c.created_by_user_id,
      'customer_id', c.id, 'customer_name', c.name,
      'company_name', c.company_name, 'phone_normalized', c.phone_normalized,
      'channel', c.channel, 'source_updated_at', c.updated_at
    ) into v_row
    from public.customers c
    where c.id = p_source_id
      and not coalesce(c.is_deleted, false)
      and c.created_by_user_id = v_actor
      and c.created_at >= v_period.starts_at and c.created_at < v_period.ends_at;
  elsif v_metric = 'deals_v1' then
    raise exception using errcode = '55000', message = 'KPI_BUSINESS_SOURCE_NOT_READY: deals_v1 chua co actor contract du tin cay.';
  else
    raise exception using errcode = '22023', message = 'Source adapter chua duoc ho tro cho KPI nay.';
  end if;

  if v_row is null then
    raise exception using errcode = 'P0002', message = 'Source event khong ton tai, ngoai ky hoac khong thuoc actor lich su.';
  end if;
  return v_row;
end;
$$;

create or replace function public.crm_kpi_list_hybrid_candidates(p_assignment_id uuid)
returns setof jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_a public.kpi_assignments%rowtype;
  v_p public.kpi_periods%rowtype;
  v_metric text;
  v_actor text := public.crm_current_app_user_id();
begin
  select * into v_a from public.kpi_assignments
  where id = p_assignment_id and employee_id = v_actor and assignment_status = 'ASSIGNED';
  if v_a.id is null then raise exception using errcode = '42501', message = 'Assignment khong thuoc sale hien tai.'; end if;
  select * into v_p from public.kpi_periods where id = v_a.period_id;
  if v_p.status <> 'ACTIVE' then raise exception using errcode = '55000', message = 'Ky KPI chua ACTIVE.'; end if;
  v_metric := coalesce(v_a.definition_snapshot->>'source_metric_key', '');

  if v_metric = 'care_logs_v1' then
    return query
    select jsonb_build_object(
      'sourceType', 'CARE_LOG', 'sourceId', l.id,
      'sourceEventKey', 'care_log:' || l.id, 'eventAt', l.created_at,
      'customerId', l.customer_id, 'customerName', l.customer_name,
      'summary', coalesce(l.care_result, l.note, 'Cham soc khach'),
      'claimed', exists(
        select 1 from public.kpi_submission_events e
        where e.assignment_id = v_a.id and e.source_type = 'CARE_LOG'
          and e.source_event_key = 'care_log:' || l.id and e.supersedes_event_id is null
      )
    )
    from public.care_logs l
    where public.crm_kpi_resolve_user_id_by_email(l.created_by_email) = v_actor
      and not coalesce(l.is_deleted, false)
      and l.created_at >= v_p.starts_at and l.created_at < v_p.ends_at
    order by l.created_at desc limit 200;
  elsif v_metric = 'customers_v1' then
    return query
    select jsonb_build_object(
      'sourceType', 'CUSTOMER', 'sourceId', c.id,
      'sourceEventKey', 'customer:' || c.id, 'eventAt', c.created_at,
      'customerId', c.id, 'customerName', c.name,
      'summary', coalesce(c.company_name, c.channel, 'Khach moi'),
      'claimed', exists(
        select 1 from public.kpi_submission_events e
        where e.assignment_id = v_a.id and e.source_type = 'CUSTOMER'
          and e.source_event_key = 'customer:' || c.id and e.supersedes_event_id is null
      )
    )
    from public.customers c
    where c.created_by_user_id = v_actor
      and not coalesce(c.is_deleted, false)
      and c.created_at >= v_p.starts_at and c.created_at < v_p.ends_at
    order by c.created_at desc limit 200;
  elsif v_metric = 'deals_v1' then
    raise exception using errcode = '55000', message = 'KPI_BUSINESS_SOURCE_NOT_READY: deals_v1 chua co actor contract du tin cay.';
  else
    raise exception using errcode = '22023', message = 'KPI chua co candidate adapter san sang.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- B1/B2/B3/B6. Atomic submit with canonical validation and redacted duplicate
-- ---------------------------------------------------------------------------

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
  v_source_type text;
  v_source_id text;
  v_source_key text;
  v_event_at timestamptz;
  v_customer_id text;
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
  v_response := public.crm_kpi_idempotent_response(v_actor, 'submission_create', p_request_id, v_payload_hash);
  if v_response is not null then return v_response; end if;

  select * into v_a from public.kpi_assignments where id = p_assignment_id for update;
  if v_a.id is null or v_a.employee_id <> v_actor or v_a.assignment_status <> 'ASSIGNED' then
    raise exception using errcode = '42501', message = 'Ban chi submit KPI duoc giao cho minh.';
  end if;
  select * into v_p from public.kpi_periods where id = v_a.period_id for share;
  if v_p.status <> 'ACTIVE' then raise exception using errcode = '55000', message = 'Chi ky KPI ACTIVE nhan submission.'; end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'Moi submission can 1-50 event.';
  end if;

  v_agg := coalesce(v_a.definition_snapshot->>'aggregation_mode', 'COUNT');
  v_type := coalesce(v_a.definition_snapshot->>'kpi_type', 'MANUAL');
  perform set_config('crm.kpi_write', 'on', true);
  insert into public.kpi_submissions(assignment_id, request_id, submitted_by_user_id, sale_note)
  values(v_a.id, p_request_id, v_actor, v_note) returning * into v_s;

  for v_event in select value from jsonb_array_elements(p_events)
  loop
    v_source_type := upper(btrim(coalesce(v_event->>'sourceType', 'MANUAL')));
    v_source_id := nullif(btrim(v_event->>'sourceId'), '');
    if v_type in ('HYBRID', 'AUTO') then
      v_snapshot := public.crm_kpi_source_snapshot(v_a.id, v_source_type, v_source_id);
      v_source_key := v_snapshot->>'source_event_key';
      v_event_at := public.crm_kpi_validate_event_at(
        v_snapshot->>'event_at', v_p.starts_at, v_p.ends_at, v_p.timezone
      );
      v_customer_id := nullif(v_snapshot->>'customer_id', '');
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
      v_customer_id := nullif(btrim(v_event->>'customerId'), '');
      v_snapshot := coalesce(v_event->'eventSnapshot', '{}'::jsonb);
      if jsonb_typeof(v_snapshot) <> 'object'
         or nullif(btrim(coalesce(v_snapshot->>'title', v_snapshot->>'description', '')), '') is null then
        raise exception using errcode = '22023', message = 'Event MANUAL can tieu de hoac noi dung.';
      end if;
    end if;

    begin
      v_value := coalesce((v_event->>'claimedValue')::numeric, 1);
    exception when others then
      raise exception using errcode = '22023', message = 'Gia tri event khong hop le.';
    end;
    if v_agg = 'COUNT' then v_value := 1;
    elsif v_value <= 0 then raise exception using errcode = '22023', message = 'Gia tri SUM phai lon hon 0.';
    end if;

    v_location := public.crm_kpi_validate_location(
      v_event->'location',
      coalesce((v_a.definition_snapshot->>'location_required')::boolean, false)
    );
    v_evidence := coalesce(v_event->'evidenceIds', '[]'::jsonb);
    if jsonb_typeof(v_evidence) <> 'array' then raise exception using errcode = '22023', message = 'Danh sach evidence khong hop le.'; end if;
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
      event_at, actor_user_id, customer_id, claimed_value, event_snapshot,
      location_snapshot, possible_duplicate, duplicate_context
    ) values (
      v_s.id, v_a.id, v_source_type, v_source_id, v_source_key,
      v_event_at, v_actor, v_customer_id, v_value, v_snapshot,
      v_location, v_duplicate_count > 0,
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
      if not found then raise exception using errcode = '22023', message = 'Evidence khong ton tai, khong thuoc ban hoac da duoc dung.'; end if;
      perform public.crm_kpi_write_audit('evidence_attach', 'kpi_evidence', v_evidence_id::text,
        jsonb_build_object('eventId', v_e.id, 'submissionId', v_s.id));
    end loop;

    perform public.crm_kpi_write_audit('event_claim_create', 'kpi_submission_events', v_e.id::text,
      jsonb_build_object(
        'periodId', v_a.period_id, 'assignmentId', v_a.id,
        'definitionId', v_a.definition_id, 'employeeId', v_actor,
        'submissionId', v_s.id, 'eventId', v_e.id,
        'sourceType', v_source_type, 'sourceId', v_source_id,
        'sourceEventKey', v_source_key, 'claimedValue', v_value,
        'possibleDuplicate', v_duplicate_count > 0
      ));
    v_ids := v_ids || jsonb_build_array(v_e.id);
  end loop;

  v_response := jsonb_build_object(
    'submissionId', v_s.id, 'status', v_s.status,
    'eventIds', v_ids, 'eventCount', jsonb_array_length(v_ids)
  );
  insert into public.kpi_action_requests(
    actor_user_id, action, request_id, request_payload_hash, request_schema_version, response
  ) values(v_actor, 'submission_create', p_request_id, v_payload_hash, 1, v_response);
  perform public.crm_kpi_write_audit('submission_create', 'kpi_submissions', v_s.id::text,
    jsonb_build_object(
      'periodId', v_a.period_id, 'assignmentId', v_a.id,
      'definitionId', v_a.definition_id, 'employeeId', v_actor,
      'submissionId', v_s.id, 'requestId', p_request_id, 'eventIds', v_ids
    ));
  return v_response;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'KPI_EVENT_ALREADY_CLAIMED: Event da duoc claim.';
end;
$$;

-- ---------------------------------------------------------------------------
-- B1/B3. Append-only revision with request binding and canonical validators
-- ---------------------------------------------------------------------------

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
  v_response := public.crm_kpi_idempotent_response(v_actor, 'event_revision', p_request_id, v_payload_hash);
  if v_response is not null then return v_response; end if;

  select * into v_old from public.kpi_submission_events where id = p_event_id for update;
  if v_old.id is null or v_old.actor_user_id <> v_actor or v_old.status <> 'NEEDS_REVISION' then
    raise exception using errcode = '42501', message = 'Chi event NEEDS_REVISION cua ban moi duoc gui lai.';
  end if;
  if exists(select 1 from public.kpi_submission_events where supersedes_event_id = v_old.id) then
    raise exception using errcode = '23505', message = 'Event nay da co revision.';
  end if;
  select * into v_a from public.kpi_assignments
  where id = v_old.assignment_id and employee_id = v_actor and assignment_status = 'ASSIGNED' for update;
  select * into v_p from public.kpi_periods where id = v_a.period_id;
  if v_p.status <> 'ACTIVE' then raise exception using errcode = '55000', message = 'Chi ky ACTIVE nhan revision.'; end if;

  v_snapshot := coalesce(p_event->'eventSnapshot', v_old.event_snapshot);
  if coalesce(v_a.definition_snapshot->>'kpi_type', 'MANUAL') in ('HYBRID', 'AUTO') then
    v_snapshot := public.crm_kpi_source_snapshot(v_a.id, v_old.source_type, v_old.source_id);
  elsif jsonb_typeof(v_snapshot) <> 'object'
        or nullif(btrim(coalesce(v_snapshot->>'title', v_snapshot->>'description', '')), '') is null then
    raise exception using errcode = '22023', message = 'Revision MANUAL can noi dung.';
  end if;

  begin
    v_value := coalesce((p_event->>'claimedValue')::numeric, v_old.claimed_value);
  exception when others then
    raise exception using errcode = '22023', message = 'Gia tri revision khong hop le.';
  end;
  if coalesce(v_a.definition_snapshot->>'aggregation_mode', 'COUNT') = 'COUNT' then v_value := 1;
  elsif v_value <= 0 then raise exception using errcode = '22023', message = 'Gia tri SUM phai lon hon 0.';
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
  if jsonb_typeof(v_evidence) <> 'array' then raise exception using errcode = '22023', message = 'Danh sach evidence khong hop le.'; end if;
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
  insert into public.kpi_submissions(assignment_id, attempt_no, request_id, submitted_by_user_id, sale_note)
  values(v_a.id, v_old.revision_no + 1, p_request_id, v_actor, v_note) returning * into v_s;
  insert into public.kpi_submission_events(
    submission_id, assignment_id, source_type, source_id, source_event_key,
    event_at, actor_user_id, customer_id, claimed_value, event_snapshot,
    location_snapshot, possible_duplicate, duplicate_context,
    supersedes_event_id, root_event_id, revision_no
  ) values (
    v_s.id, v_a.id, v_old.source_type, v_old.source_id, v_old.source_event_key,
    v_event_at, v_actor, coalesce(nullif(p_event->>'customerId', ''), v_old.customer_id),
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
    if not found then raise exception using errcode = '22023', message = 'Evidence revision khong hop le.'; end if;
    perform public.crm_kpi_write_audit('evidence_attach', 'kpi_evidence', v_evidence_id::text,
      jsonb_build_object('eventId', v_new.id, 'revision', true));
  end loop;

  v_response := jsonb_build_object(
    'submissionId', v_s.id, 'eventIds', jsonb_build_array(v_new.id),
    'eventCount', 1, 'supersedesEventId', v_old.id
  );
  insert into public.kpi_action_requests(
    actor_user_id, action, request_id, request_payload_hash, request_schema_version, response
  ) values(v_actor, 'event_revision', p_request_id, v_payload_hash, 1, v_response);
  perform public.crm_kpi_write_audit('event_revision', 'kpi_submission_events', v_new.id::text,
    jsonb_build_object(
      'periodId', v_a.period_id,
      'definitionId', v_a.definition_id,
      'assignmentId', v_a.id,
      'submissionId', v_s.id,
      'employeeId', v_actor,
      'eventId', v_old.id,
      'newEventId', v_new.id,
      'supersedesEventId', v_old.id,
      'sourceType', v_new.source_type,
      'sourceEventKey', v_new.source_event_key,
      'previousStatus', v_old.status,
      'newStatus', v_new.status,
      'previousLockVersion', v_old.lock_version,
      'newLockVersion', v_new.lock_version,
      'saleNote', v_note,
      'locationPresent', v_new.location_snapshot is not null,
      'evidenceCount', v_count
    ));
  return v_response;
end;
$$;

-- ---------------------------------------------------------------------------
-- B1. Atomic review with canonical idempotency payload
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- B4. Safe score defaults and explicit assignment matrix option
-- ---------------------------------------------------------------------------

alter table public.kpi_assignments alter column score_enabled set default false;

create or replace function public.crm_kpi_assign_employee(
  p_period_id uuid,
  p_definition_id uuid,
  p_employee_id text,
  p_target numeric,
  p_expected_period_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.kpi_periods%rowtype;
  v_definition public.kpi_definitions%rowtype;
  v_employee public.app_users%rowtype;
  v_existing public.kpi_assignments%rowtype;
  v_assignment public.kpi_assignments%rowtype;
  v_snapshot jsonb;
  v_score_enabled boolean;
begin
  if not public.crm_kpi_is_business_manager() then raise exception using errcode = '42501', message = 'Chi manager/admin/owner duoc giao KPI.'; end if;
  if p_target is null or p_target <= 0 then raise exception using errcode = '22023', message = 'Target KPI phai lon hon 0.'; end if;
  select * into v_period from public.kpi_periods where id = p_period_id for update nowait;
  if v_period.id is null then raise exception using errcode = 'P0002', message = 'Khong tim thay ky KPI.'; end if;
  if v_period.status <> 'DRAFT' then raise exception using errcode = '55000', message = 'Chi ky DRAFT moi duoc giao KPI.'; end if;
  if p_expected_period_version is null or v_period.version <> p_expected_period_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Ky KPI da thay doi.';
  end if;
  select * into v_definition from public.kpi_definitions where id = p_definition_id for share nowait;
  if v_definition.id is null or not v_definition.active then raise exception using errcode = '22023', message = 'KPI definition khong ton tai hoac dang tat.'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('crm:kpi:employee:' || p_employee_id, 0)) then
    raise exception using errcode = '55P03', message = 'Nhan vien dang duoc cap nhat KPI.';
  end if;
  select * into v_employee from public.app_users where id = p_employee_id;
  if v_employee.id is null or lower(coalesce(v_employee.role, '')) <> 'sale'
     or not coalesce(v_employee.active, false)
     or lower(coalesce(v_employee.lifecycle_status, 'inactive')) <> 'active' then
    raise exception using errcode = '22023', message = 'Chi duoc giao KPI cho sale ACTIVE.';
  end if;
  v_snapshot := public.crm_kpi_definition_snapshot(v_definition);
  v_score_enabled := coalesce(v_definition.source_metric_key, '') <> 'deals_v1';
  select * into v_existing from public.kpi_assignments
  where period_id = p_period_id and definition_id = p_definition_id and employee_id = p_employee_id for update;
  perform set_config('crm.kpi_write', 'on', true);
  if v_existing.id is null then
    insert into public.kpi_assignments(
      period_id, definition_id, employee_id, target, effective_at,
      assignment_status, definition_snapshot, score_enabled,
      assigned_by_user_id, assigned_at, created_at, updated_at, lock_version
    ) values (
      p_period_id, p_definition_id, p_employee_id, p_target, v_period.starts_at,
      'ASSIGNED', v_snapshot, v_score_enabled,
      public.crm_current_app_user_id(), now(), now(), now(), 1
    ) returning * into v_assignment;
  elsif v_existing.assignment_status = 'CANCELLED' then
    update public.kpi_assignments
    set target = p_target, effective_at = v_period.starts_at,
        assignment_status = 'ASSIGNED', definition_snapshot = v_snapshot,
        score_enabled = v_score_enabled,
        assigned_by_user_id = public.crm_current_app_user_id(), assigned_at = now(),
        cancelled_by_user_id = null, cancelled_at = null, cancel_reason = null,
        updated_at = now(), lock_version = lock_version + 1
    where id = v_existing.id returning * into v_assignment;
  else
    raise exception using errcode = '23505', message = 'Sale da duoc giao KPI nay trong ky.';
  end if;
  update public.kpi_periods set version = version + 1, updated_at = now() where id = p_period_id;
  perform public.crm_kpi_write_audit('assignment_create', 'kpi_assignments', v_assignment.id::text,
    jsonb_build_object(
      'periodId', p_period_id, 'definitionId', p_definition_id,
      'assignmentId', v_assignment.id, 'employeeId', p_employee_id,
      'scoreEnabled', v_assignment.score_enabled,
      'before', case when v_existing.id is null then null else to_jsonb(v_existing) end,
      'after', to_jsonb(v_assignment), 'periodVersion', v_period.version + 1
    ));
  return to_jsonb(v_assignment) || jsonb_build_object('periodVersion', v_period.version + 1);
end;
$$;

create or replace function public.crm_kpi_sync_definition_assignments(
  p_period_id uuid,
  p_definition_id uuid,
  p_rows jsonb,
  p_expected_period_version integer,
  p_reason text default 'Cap nhat ma tran KPI DRAFT'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.kpi_periods%rowtype;
  v_definition public.kpi_definitions%rowtype;
  v_employee public.app_users%rowtype;
  v_existing public.kpi_assignments%rowtype;
  v_row jsonb;
  v_employee_id text;
  v_target numeric;
  v_score_enabled boolean;
  v_snapshot jsonb;
  v_before jsonb;
  v_after jsonb;
begin
  if not public.crm_kpi_is_business_manager() then raise exception using errcode = '42501', message = 'Chi manager/admin/owner duoc cap nhat ma tran KPI.'; end if;
  if coalesce(jsonb_typeof(p_rows), '') <> 'array' then raise exception using errcode = '22023', message = 'Danh sach ma tran KPI khong hop le.'; end if;
  if jsonb_array_length(p_rows) > 200 then raise exception using errcode = '54000', message = 'Moi KPI chi duoc dong bo toi da 200 sale.'; end if;
  if jsonb_array_length(p_rows) > 0 and (
    (select count(*) from jsonb_array_elements(p_rows)) <>
    (select count(distinct nullif(btrim(value->>'employeeId'), '')) from jsonb_array_elements(p_rows))
  ) then raise exception using errcode = '22023', message = 'Ma tran KPI co employee trung hoac thieu.'; end if;

  select * into v_period from public.kpi_periods where id = p_period_id for update nowait;
  if v_period.id is null then raise exception using errcode = 'P0002', message = 'Khong tim thay ky KPI.'; end if;
  if v_period.status <> 'DRAFT' then raise exception using errcode = '55000', message = 'Chi ky DRAFT moi duoc sua ma tran KPI.'; end if;
  if p_expected_period_version is null or v_period.version <> p_expected_period_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Ky KPI da thay doi.';
  end if;
  select * into v_definition from public.kpi_definitions where id = p_definition_id for share nowait;
  if v_definition.id is null or not v_definition.active then raise exception using errcode = '22023', message = 'KPI definition khong ton tai hoac dang tat.'; end if;
  v_snapshot := public.crm_kpi_definition_snapshot(v_definition);
  perform 1 from public.kpi_assignments
  where period_id = p_period_id and definition_id = p_definition_id
  order by employee_id for update;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.employee_id), '[]'::jsonb) into v_before
  from public.kpi_assignments a where a.period_id = p_period_id and a.definition_id = p_definition_id;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_employee_id := nullif(btrim(v_row->>'employeeId'), '');
    begin
      v_target := (v_row->>'target')::numeric;
      if v_row ? 'scoreEnabled' then
        if jsonb_typeof(v_row->'scoreEnabled') <> 'boolean' then raise exception 'invalid scoreEnabled'; end if;
        v_score_enabled := (v_row->>'scoreEnabled')::boolean;
      else
        v_score_enabled := coalesce(v_definition.source_metric_key, '') <> 'deals_v1';
      end if;
    exception when others then
      raise exception using errcode = '22023', message = 'Target hoac scoreEnabled trong ma tran KPI khong hop le.';
    end;
    if v_target is null or v_target <= 0 then raise exception using errcode = '22023', message = 'Moi target KPI phai lon hon 0.'; end if;
    if not pg_try_advisory_xact_lock(hashtextextended('crm:kpi:employee:' || v_employee_id, 0)) then
      raise exception using errcode = '55P03', message = 'Ma tran co nhan vien dang duoc cap nhat KPI.';
    end if;
    select * into v_employee from public.app_users where id = v_employee_id;
    if v_employee.id is null or lower(coalesce(v_employee.role, '')) <> 'sale'
       or not coalesce(v_employee.active, false)
       or lower(coalesce(v_employee.lifecycle_status, 'inactive')) <> 'active' then
      raise exception using errcode = '22023', message = 'Ma tran co nhan vien khong phai sale ACTIVE.';
    end if;
  end loop;

  perform set_config('crm.kpi_write', 'on', true);
  update public.kpi_assignments a
  set assignment_status = 'CANCELLED', cancelled_by_user_id = public.crm_current_app_user_id(),
      cancelled_at = now(), cancel_reason = coalesce(nullif(btrim(p_reason), ''), 'Cap nhat ma tran KPI DRAFT'),
      updated_at = now(), lock_version = lock_version + 1
  where a.period_id = p_period_id and a.definition_id = p_definition_id
    and a.assignment_status = 'ASSIGNED'
    and not exists (
      select 1 from jsonb_array_elements(p_rows) row_data
      where btrim(row_data->>'employeeId') = a.employee_id
    );

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_employee_id := btrim(v_row->>'employeeId');
    v_target := (v_row->>'target')::numeric;
    v_score_enabled := case when v_row ? 'scoreEnabled'
      then (v_row->>'scoreEnabled')::boolean
      else coalesce(v_definition.source_metric_key, '') <> 'deals_v1' end;
    select * into v_existing from public.kpi_assignments
    where period_id = p_period_id and definition_id = p_definition_id and employee_id = v_employee_id for update;
    if v_existing.id is null then
      insert into public.kpi_assignments(
        period_id, definition_id, employee_id, target, effective_at,
        assignment_status, definition_snapshot, score_enabled,
        assigned_by_user_id, assigned_at, created_at, updated_at, lock_version
      ) values (
        p_period_id, p_definition_id, v_employee_id, v_target, v_period.starts_at,
        'ASSIGNED', v_snapshot, v_score_enabled,
        public.crm_current_app_user_id(), now(), now(), now(), 1
      );
    else
      update public.kpi_assignments
      set target = v_target, effective_at = v_period.starts_at,
          assignment_status = 'ASSIGNED', definition_snapshot = v_snapshot,
          score_enabled = v_score_enabled,
          assigned_by_user_id = public.crm_current_app_user_id(),
          assigned_at = case when assignment_status = 'CANCELLED' then now() else assigned_at end,
          cancelled_by_user_id = null, cancelled_at = null, cancel_reason = null,
          updated_at = now(), lock_version = lock_version + 1
      where id = v_existing.id;
    end if;
  end loop;

  update public.kpi_periods set version = version + 1, updated_at = now() where id = p_period_id;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.employee_id), '[]'::jsonb) into v_after
  from public.kpi_assignments a where a.period_id = p_period_id and a.definition_id = p_definition_id;
  perform public.crm_kpi_write_audit('assignment_matrix_sync', 'kpi_periods', p_period_id::text,
    jsonb_build_object(
      'periodId', p_period_id, 'definitionId', p_definition_id,
      'reason', coalesce(nullif(btrim(p_reason), ''), 'Cap nhat ma tran KPI DRAFT'),
      'before', v_before, 'after', v_after, 'periodVersion', v_period.version + 1
    ));
  return jsonb_build_object(
    'periodId', p_period_id, 'definitionId', p_definition_id,
    'assignments', v_after, 'periodVersion', v_period.version + 1
  );
end;
$$;

create or replace function public.crm_kpi_update_assignment_options(
  p_assignment_id uuid,
  p_score_enabled boolean,
  p_expected_assignment_version integer,
  p_expected_period_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.kpi_assignments%rowtype;
  v_new public.kpi_assignments%rowtype;
  v_period public.kpi_periods%rowtype;
begin
  if not public.crm_kpi_is_business_manager() then raise exception using errcode = '42501', message = 'Khong co quyen sua tuy chon KPI.'; end if;
  if p_score_enabled is null then raise exception using errcode = '22023', message = 'score_enabled phai duoc chon ro rang.'; end if;
  select * into v_old from public.kpi_assignments where id = p_assignment_id for update;
  if v_old.id is null then raise exception using errcode = 'P0002', message = 'Khong tim thay assignment.'; end if;
  select * into v_period from public.kpi_periods where id = v_old.period_id for update;
  if v_period.status <> 'DRAFT' then raise exception using errcode = '55000', message = 'Chi ky DRAFT duoc sua.'; end if;
  if v_old.lock_version <> p_expected_assignment_version or v_period.version <> p_expected_period_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Du lieu da thay doi.';
  end if;
  perform set_config('crm.kpi_write', 'on', true);
  update public.kpi_assignments
  set score_enabled = p_score_enabled, updated_at = now(), lock_version = lock_version + 1
  where id = p_assignment_id returning * into v_new;
  update public.kpi_periods set version = version + 1, updated_at = now() where id = v_old.period_id;
  perform public.crm_kpi_write_audit('assignment_options_update', 'kpi_assignments', v_new.id::text,
    jsonb_build_object('before', to_jsonb(v_old), 'after', to_jsonb(v_new), 'periodVersion', v_period.version + 1));
  return to_jsonb(v_new) || jsonb_build_object('periodVersion', v_period.version + 1);
end;
$$;

-- Reference-only KPI keeps its own pending indicator, but does not block the
-- monthly scoring finality flag.
create or replace function public.crm_kpi_get_monthly_scores(p_period_id uuid)
returns table(
  employee_id text,
  employee_name text,
  included_kpi_count bigint,
  monthly_score numeric,
  has_open_items boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select x.employee_id, x.employee_name,
    count(*) filter (where x.score_enabled),
    round(coalesce(avg(x.scoring_completion_pct) filter (where x.score_enabled), 0), 2),
    coalesce(bool_or(x.has_open_items) filter (where x.score_enabled), false)
  from public.crm_kpi_get_assignment_progress(p_period_id) x
  group by x.employee_id, x.employee_name;
$$;

revoke all on function public.crm_kpi_submit_events(uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.crm_kpi_submit_revision(uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.crm_kpi_review_events(uuid, jsonb, text, text, text) from public, anon;
revoke all on function public.crm_kpi_list_hybrid_candidates(uuid) from public, anon;
revoke all on function public.crm_kpi_source_snapshot(uuid, text, text) from public, anon, authenticated;
revoke all on function public.crm_kpi_assign_employee(uuid, uuid, text, numeric, integer) from public, anon;
revoke all on function public.crm_kpi_sync_definition_assignments(uuid, uuid, jsonb, integer, text) from public, anon;
revoke all on function public.crm_kpi_update_assignment_options(uuid, boolean, integer, integer) from public, anon;
revoke all on function public.crm_kpi_get_monthly_scores(uuid) from public, anon;

grant execute on function public.crm_kpi_submit_events(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.crm_kpi_submit_revision(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.crm_kpi_review_events(uuid, jsonb, text, text, text) to authenticated;
grant execute on function public.crm_kpi_list_hybrid_candidates(uuid) to authenticated;
grant execute on function public.crm_kpi_assign_employee(uuid, uuid, text, numeric, integer) to authenticated;
grant execute on function public.crm_kpi_sync_definition_assignments(uuid, uuid, jsonb, integer, text) to authenticated;
grant execute on function public.crm_kpi_update_assignment_options(uuid, boolean, integer, integer) to authenticated;
grant execute on function public.crm_kpi_get_monthly_scores(uuid) to authenticated;

-- Reassert the KPI-1 read-only table contract explicitly. This avoids hosted
-- or local default privileges changing the final runtime grants after ALTER.
revoke all on public.kpi_definitions, public.kpi_assignments, public.kpi_periods
  from anon, authenticated;
grant select on public.kpi_definitions, public.kpi_assignments, public.kpi_periods
  to authenticated;

commit;
