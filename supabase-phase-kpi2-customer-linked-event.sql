-- CRM-KOLORCERAMIC KPI-2: Customer-linked KPI Event.
-- Forward-only Phase 2 database/domain/security foundation.
-- Dependencies: P0-B customer assignments, KPI-2 final consolidated, KPI R3.
-- This migration deliberately does not modify legacy kpi_rules/kpi_proposals.

begin;

-- ---------------------------------------------------------------------------
-- 1. Frozen definition contract and historical event snapshot columns
-- ---------------------------------------------------------------------------

alter table public.kpi_definitions
  add column if not exists customer_relation_mode text not null default 'NONE';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.kpi_definitions'::regclass
      and conname = 'kpi_definitions_customer_relation_mode_check'
  ) then
    alter table public.kpi_definitions
      add constraint kpi_definitions_customer_relation_mode_check
      check (customer_relation_mode in ('REQUIRED', 'OPTIONAL', 'NONE'));
  end if;
end;
$$;

create or replace function public.crm_kpi_create_definition_active_r4(
  p_period_id uuid,
  p_expected_period_version integer,
  p_reason text,
  p_code text,
  p_name text,
  p_description text,
  p_kpi_type text,
  p_source_metric_key text,
  p_unit text,
  p_submission_mode text,
  p_evidence_required boolean,
  p_aggregation_mode text,
  p_max_images_per_event integer,
  p_location_required boolean,
  p_timestamp_required boolean,
  p_customer_relation_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.kpi_periods%rowtype;
  v_row public.kpi_definitions%rowtype;
  v_reason text := public.crm_kpi_r3_reason(p_reason);
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_type text := upper(btrim(coalesce(p_kpi_type, '')));
  v_mode text := upper(btrim(coalesce(p_submission_mode, 'EVENT_CLAIM')));
  v_agg text := upper(btrim(coalesce(p_aggregation_mode, 'COUNT')));
  v_customer_mode text := upper(btrim(coalesce(p_customer_relation_mode, 'NONE')));
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Khong co quyen tao KPI.';
  end if;
  select * into v_period from public.kpi_periods where id = p_period_id for update;
  if v_period.id is null then
    raise exception using errcode = 'P0002', message = 'Khong tim thay ky KPI.';
  end if;
  if v_period.status <> 'ACTIVE' then
    raise exception using errcode = '55000', message = 'RPC nay chi tao definition cho ky ACTIVE.';
  end if;
  if p_expected_period_version is null or v_period.version <> p_expected_period_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Ky KPI da thay doi. Hay tai lai.';
  end if;
  if v_code !~ '^[A-Z][A-Z0-9_]{1,63}$'
     or nullif(btrim(coalesce(p_name, '')), '') is null
     or nullif(btrim(coalesce(p_unit, '')), '') is null then
    raise exception using errcode = '22023', message = 'Ma, ten hoac don vi KPI khong hop le.';
  end if;
  if v_type not in ('AUTO', 'MANUAL', 'HYBRID')
     or v_mode <> 'EVENT_CLAIM'
     or v_agg not in ('COUNT', 'SUM')
     or v_customer_mode not in ('REQUIRED', 'OPTIONAL', 'NONE') then
    raise exception using errcode = '22023', message = 'Cau hinh KPI khong hop le.';
  end if;
  if coalesce(p_max_images_per_event, 2) not between 0 and 2 then
    raise exception using errcode = '22023', message = 'Toi da 0-2 anh moi event.';
  end if;

  perform set_config('crm.kpi_write', 'on', true);
  insert into public.kpi_definitions(
    code, name, description, kpi_type, source_metric_key, unit,
    submission_mode, evidence_required, aggregation_mode, max_images_per_event,
    location_required, timestamp_required, customer_relation_mode,
    active, created_by_user_id, updated_by_user_id
  ) values (
    v_code, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
    v_type, nullif(btrim(coalesce(p_source_metric_key, '')), ''), btrim(p_unit),
    v_mode, coalesce(p_evidence_required, false), v_agg,
    coalesce(p_max_images_per_event, 2), coalesce(p_location_required, false),
    coalesce(p_timestamp_required, true), v_customer_mode, true,
    public.crm_current_app_user_id(), public.crm_current_app_user_id()
  ) returning * into v_row;

  update public.kpi_periods set version = version + 1, updated_at = now()
  where id = v_period.id;
  perform public.crm_kpi_write_audit(
    'ACTIVE_DEFINITION_CREATED', 'kpi_definitions', v_row.id::text,
    jsonb_build_object('periodId', v_period.id, 'reason', v_reason,
      'before', null, 'after', to_jsonb(v_row), 'periodVersion', v_period.version + 1)
  );
  return to_jsonb(v_row) || jsonb_build_object('periodVersion', v_period.version + 1);
exception when unique_violation then
  raise exception using errcode = '23505', message = 'Ma KPI da ton tai.';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Source adapters retain historical actor attribution and additionally
--    require current Customer access.
-- ---------------------------------------------------------------------------

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
      and (l.customer_id is null or public.crm_can_access_customer_id(l.customer_id))
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
      and public.crm_can_access_customer_id(c.id)
      and c.created_at >= v_period.starts_at and c.created_at < v_period.ends_at;
  elsif v_metric = 'deals_v1' then
    raise exception using errcode = '55000', message = 'KPI_BUSINESS_SOURCE_NOT_READY: deals_v1 chua co actor contract du tin cay.';
  else
    raise exception using errcode = '22023', message = 'Source adapter chua duoc ho tro cho KPI nay.';
  end if;

  if v_row is null then
    raise exception using errcode = 'P0002', message = 'Source event khong ton tai, ngoai ky, khong thuoc actor hoac Customer khong con duoc truy cap.';
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
  if v_a.id is null then
    raise exception using errcode = '42501', message = 'Assignment khong thuoc sale hien tai.';
  end if;
  select * into v_p from public.kpi_periods where id = v_a.period_id;
  if v_p.status <> 'ACTIVE' then
    raise exception using errcode = '55000', message = 'Ky KPI chua ACTIVE.';
  end if;
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
      and (l.customer_id is null or public.crm_can_access_customer_id(l.customer_id))
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
      and public.crm_can_access_customer_id(c.id)
      and c.created_at >= v_p.starts_at and c.created_at < v_p.ends_at
    order by c.created_at desc limit 200;
  elsif v_metric = 'deals_v1' then
    raise exception using errcode = '55000', message = 'KPI_BUSINESS_SOURCE_NOT_READY: deals_v1 chua co actor contract du tin cay.';
  else
    raise exception using errcode = '22023', message = 'KPI chua co candidate adapter san sang.';
  end if;
end;
$$;


create or replace function public.crm_kpi_definition_snapshot(p_definition public.kpi_definitions)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'code', p_definition.code,
    'name', p_definition.name,
    'description', coalesce(p_definition.description, ''),
    'kpi_type', p_definition.kpi_type,
    'source_metric_key', p_definition.source_metric_key,
    'unit', p_definition.unit,
    'submission_mode', p_definition.submission_mode,
    'evidence_required', p_definition.evidence_required,
    'aggregation_mode', p_definition.aggregation_mode,
    'max_images_per_event', p_definition.max_images_per_event,
    'location_required', p_definition.location_required,
    'timestamp_required', p_definition.timestamp_required,
    'customer_relation_mode', p_definition.customer_relation_mode,
    'definition_version', p_definition.version,
    'snapshotted_at', now()
  );
$$;

revoke all on function public.crm_kpi_definition_snapshot(public.kpi_definitions)
  from public, anon, authenticated;

-- Existing periods keep their original meaning. No business mapping is inferred.
select set_config('crm.kpi_write', 'on', true);
update public.kpi_assignments
set definition_snapshot = definition_snapshot || jsonb_build_object(
  'customer_relation_mode', 'NONE'
)
where not (definition_snapshot ? 'customer_relation_mode');

alter table public.kpi_assignments
  drop constraint if exists kpi_assignments_snapshot_fields_check;
alter table public.kpi_assignments
  add constraint kpi_assignments_snapshot_fields_check
  check (definition_snapshot ?& array[
    'code', 'name', 'description', 'kpi_type', 'source_metric_key',
    'unit', 'submission_mode', 'evidence_required', 'customer_relation_mode',
    'definition_version'
  ] and definition_snapshot->>'customer_relation_mode' in ('REQUIRED', 'OPTIONAL', 'NONE'));

alter table public.kpi_submission_events
  add column if not exists customer_name_snapshot text,
  add column if not exists customer_company_name_snapshot text,
  add column if not exists customer_phone_snapshot text,
  add column if not exists customer_phone_normalized_snapshot text,
  add column if not exists customer_address_snapshot text;

-- Never guess historical customer details. Abort only when an old linked row cannot
-- satisfy the new authoritative snapshot contract; unlinked legacy rows remain valid.
do $$
begin
  if exists (
    select 1 from public.kpi_submission_events
    where customer_id is not null
      and nullif(btrim(customer_name_snapshot), '') is null
  ) then
    raise exception using
      errcode = '55000',
      message = 'KPI2_CUSTOMER_SNAPSHOT_PRECONDITION: linked historical events require an explicit data decision.';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.kpi_submission_events'::regclass
      and conname = 'kpi_submission_events_customer_snapshot_shape_check'
  ) then
    alter table public.kpi_submission_events
      add constraint kpi_submission_events_customer_snapshot_shape_check
      check (
        (customer_id is null
          and customer_name_snapshot is null
          and customer_company_name_snapshot is null
          and customer_phone_snapshot is null
          and customer_phone_normalized_snapshot is null
          and customer_address_snapshot is null)
        or
        (customer_id is not null
          and nullif(btrim(customer_name_snapshot), '') is not null)
      );
  end if;
end;
$$;

-- Customer lifecycle uses archive/restore; all audited mutation paths lock the
-- customer and no supported hard-delete path exists. Preserve event identity.
do $$
declare
  v_delete_action "char";
begin
  select confdeltype into v_delete_action
  from pg_constraint
  where conrelid = 'public.kpi_submission_events'::regclass
    and conname = 'kpi_submission_events_customer_id_fkey';

  if v_delete_action is distinct from 'r' then
    alter table public.kpi_submission_events
      drop constraint if exists kpi_submission_events_customer_id_fkey;
    alter table public.kpi_submission_events
      add constraint kpi_submission_events_customer_id_fkey
      foreign key (customer_id) references public.customers(id) on delete restrict;
  end if;
end;
$$;

create index if not exists kpi_submission_events_customer_event_at_idx
  on public.kpi_submission_events(customer_id, event_at desc)
  where customer_id is not null;

comment on column public.kpi_definitions.customer_relation_mode is
  'Customer linkage rule frozen into each assignment snapshot: REQUIRED, OPTIONAL, or NONE.';
comment on column public.kpi_submission_events.customer_name_snapshot is
  'Authoritative server-side customer name at event creation/revision time.';

-- ---------------------------------------------------------------------------
-- 2. Customer authorization/snapshot and least-data search
-- ---------------------------------------------------------------------------

create or replace function public.crm_kpi_customer_snapshot(p_customer_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customers%rowtype;
begin
  if nullif(btrim(coalesce(p_customer_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'Customer ID khong hop le.';
  end if;

  -- Match crm_assign_customer lock order: customer first, current assignment second.
  select * into v_customer
  from public.customers
  where id = btrim(p_customer_id)
  for share;

  if v_customer.id is null then
    raise exception using errcode = 'P0002', message = 'Customer khong ton tai.';
  end if;

  perform 1
  from public.customer_assignments
  where customer_id = v_customer.id and is_current
  for share;

  if not public.crm_can_access_customer_id(v_customer.id) then
    raise exception using errcode = '42501', message = 'Ban khong co quyen truy cap Customer nay.';
  end if;
  if coalesce(v_customer.is_deleted, false) then
    raise exception using errcode = '55000', message = 'Customer da archived va khong the dung cho KPI Event.';
  end if;
  if nullif(btrim(coalesce(v_customer.name, '')), '') is null then
    raise exception using errcode = '55000', message = 'Customer thieu ten authoritative.';
  end if;

  return jsonb_build_object(
    'id', v_customer.id,
    'name', v_customer.name,
    'companyName', v_customer.company_name,
    'phone', coalesce(nullif(v_customer.phone_raw, ''), nullif(v_customer.phone_normalized, '')),
    'phoneNormalized', v_customer.phone_normalized,
    'address', v_customer.address
  );
end;
$$;

revoke all on function public.crm_kpi_customer_snapshot(text)
  from public, anon, authenticated;

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

revoke all on function public.crm_kpi_strip_customer_metadata(jsonb)
  from public, anon, authenticated;

create or replace function public.crm_kpi_search_accessible_customers(
  p_query text default null,
  p_limit integer default 20
)
returns table(
  id text,
  name text,
  company_name text,
  phone_raw text,
  phone_normalized text,
  address text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
begin
  if not public.crm_is_active_user() then
    raise exception using errcode = '42501', message = 'Tai khoan khong hoat dong.';
  end if;

  return query
  select c.id, c.name, c.company_name, c.phone_raw, c.phone_normalized, c.address
  from public.customers c
  where not coalesce(c.is_deleted, false)
    and public.crm_can_access_customer_id(c.id)
    and (
      v_query is null
      or c.name ilike '%' || v_query || '%'
      or c.company_name ilike '%' || v_query || '%'
      or c.phone_raw ilike '%' || v_query || '%'
      or c.phone_normalized ilike '%' || v_query || '%'
    )
  order by c.name nulls last, c.id
  limit v_limit;
end;
$$;

revoke all on function public.crm_kpi_search_accessible_customers(text, integer)
  from public, anon;
grant execute on function public.crm_kpi_search_accessible_customers(text, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Versioned Definition RPCs (no ambiguous PostgREST overload)
-- ---------------------------------------------------------------------------

create or replace function public.crm_kpi_create_definition_v3(
  p_code text, p_name text, p_description text, p_kpi_type text,
  p_source_metric_key text, p_unit text, p_submission_mode text,
  p_evidence_required boolean, p_aggregation_mode text,
  p_max_images_per_event integer, p_location_required boolean,
  p_timestamp_required boolean, p_customer_relation_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := public.crm_current_app_user_id();
  v_row public.kpi_definitions%rowtype;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_type text := upper(btrim(coalesce(p_kpi_type, '')));
  v_mode text := upper(btrim(coalesce(p_submission_mode, 'EVENT_CLAIM')));
  v_agg text := upper(btrim(coalesce(p_aggregation_mode, 'COUNT')));
  v_customer_mode text := upper(btrim(coalesce(p_customer_relation_mode, 'NONE')));
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chi manager/admin/owner duoc tao KPI.';
  end if;
  if v_code !~ '^[A-Z][A-Z0-9_]{1,63}$'
     or nullif(btrim(coalesce(p_name, '')), '') is null
     or nullif(btrim(coalesce(p_unit, '')), '') is null then
    raise exception using errcode = '22023', message = 'Ma, ten hoac don vi KPI khong hop le.';
  end if;
  if v_type not in ('AUTO', 'MANUAL', 'HYBRID')
     or v_mode <> 'EVENT_CLAIM'
     or v_agg not in ('COUNT', 'SUM')
     or v_customer_mode not in ('REQUIRED', 'OPTIONAL', 'NONE') then
    raise exception using errcode = '22023', message = 'Cau hinh KPI khong hop le.';
  end if;
  if coalesce(p_max_images_per_event, 2) not between 0 and 2 then
    raise exception using errcode = '22023', message = 'Toi da 0-2 anh moi event.';
  end if;

  perform set_config('crm.kpi_write', 'on', true);
  insert into public.kpi_definitions(
    code, name, description, kpi_type, source_metric_key, unit,
    submission_mode, evidence_required, aggregation_mode, max_images_per_event,
    location_required, timestamp_required, customer_relation_mode,
    active, created_by_user_id, updated_by_user_id
  ) values (
    v_code, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
    v_type, nullif(btrim(coalesce(p_source_metric_key, '')), ''), btrim(p_unit),
    v_mode, coalesce(p_evidence_required, false), v_agg,
    coalesce(p_max_images_per_event, 2), coalesce(p_location_required, false),
    coalesce(p_timestamp_required, true), v_customer_mode, true, v_actor, v_actor
  ) returning * into v_row;

  perform public.crm_kpi_write_audit(
    'definition_create', 'kpi_definitions', v_row.id::text,
    jsonb_build_object('after', to_jsonb(v_row), 'phase', 'KPI-2-CUSTOMER')
  );
  return to_jsonb(v_row);
exception when unique_violation then
  raise exception using errcode = '23505', message = 'Ma KPI da ton tai.';
end;
$$;

create or replace function public.crm_kpi_update_definition_v2(
  p_definition_id uuid,
  p_expected_version integer,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.kpi_definitions%rowtype;
  v_new public.kpi_definitions%rowtype;
  v_name text;
  v_type text;
  v_unit text;
  v_mode text;
  v_aggregation text;
  v_max_images integer;
  v_customer_mode text;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Only manager/admin/owner can update KPI definitions.';
  end if;
  if coalesce(jsonb_typeof(p_changes), '') <> 'object' then
    raise exception using errcode = '22023', message = 'KPI changes must be a JSON object.';
  end if;

  select * into v_old from public.kpi_definitions
  where id = p_definition_id for update;
  if v_old.id is null then
    raise exception using errcode = 'P0002', message = 'KPI definition not found.';
  end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Definition changed. Reload and retry.';
  end if;
  if p_changes ? 'code' and upper(btrim(p_changes->>'code')) <> v_old.code then
    raise exception using errcode = '55000', message = 'KPI code cannot be changed after creation.';
  end if;

  v_name := case when p_changes ? 'name' then nullif(btrim(p_changes->>'name'), '') else v_old.name end;
  v_type := case when p_changes ? 'kpiType' then upper(btrim(p_changes->>'kpiType')) else v_old.kpi_type end;
  v_unit := case when p_changes ? 'unit' then nullif(btrim(p_changes->>'unit'), '') else v_old.unit end;
  v_mode := case when p_changes ? 'submissionMode' then upper(btrim(p_changes->>'submissionMode')) else v_old.submission_mode end;
  v_aggregation := case when p_changes ? 'aggregationMode' then upper(btrim(p_changes->>'aggregationMode')) else v_old.aggregation_mode end;
  v_max_images := case when p_changes ? 'maxImagesPerEvent' then (p_changes->>'maxImagesPerEvent')::integer else v_old.max_images_per_event end;
  v_customer_mode := case
    when p_changes ? 'customerRelationMode' then upper(btrim(p_changes->>'customerRelationMode'))
    when p_changes ? 'customer_relation_mode' then upper(btrim(p_changes->>'customer_relation_mode'))
    else v_old.customer_relation_mode
  end;

  if v_name is null or v_unit is null then
    raise exception using errcode = '22023', message = 'KPI name and unit are required.';
  end if;
  if v_type not in ('AUTO', 'MANUAL', 'HYBRID')
     or v_mode <> 'EVENT_CLAIM'
     or v_aggregation not in ('COUNT', 'SUM')
     or v_customer_mode not in ('REQUIRED', 'OPTIONAL', 'NONE') then
    raise exception using errcode = '22023', message = 'Invalid KPI configuration.';
  end if;
  if v_max_images not between 0 and 2 then
    raise exception using errcode = '22023', message = 'Maximum images per event must be between 0 and 2.';
  end if;

  perform set_config('crm.kpi_write', 'on', true);
  update public.kpi_definitions
  set name = v_name,
      description = case when p_changes ? 'description' then nullif(btrim(p_changes->>'description'), '') else description end,
      kpi_type = v_type,
      source_metric_key = case when p_changes ? 'sourceMetricKey' then nullif(btrim(p_changes->>'sourceMetricKey'), '') else source_metric_key end,
      unit = v_unit,
      submission_mode = v_mode,
      evidence_required = case when p_changes ? 'evidenceRequired' then coalesce((p_changes->>'evidenceRequired')::boolean, false) else evidence_required end,
      aggregation_mode = v_aggregation,
      max_images_per_event = v_max_images,
      location_required = case when p_changes ? 'locationRequired' then coalesce((p_changes->>'locationRequired')::boolean, false) else location_required end,
      timestamp_required = case when p_changes ? 'timestampRequired' then coalesce((p_changes->>'timestampRequired')::boolean, true) else timestamp_required end,
      customer_relation_mode = v_customer_mode,
      updated_by_user_id = public.crm_current_app_user_id(),
      updated_at = now(),
      version = version + 1
  where id = p_definition_id
  returning * into v_new;

  perform public.crm_kpi_write_audit(
    'definition_update', 'kpi_definitions', p_definition_id::text,
    jsonb_build_object('definitionId', p_definition_id, 'before', to_jsonb(v_old),
      'after', to_jsonb(v_new), 'phase', 'KPI-2-CUSTOMER')
  );
  return to_jsonb(v_new);
exception when invalid_text_representation then
  raise exception using errcode = '22023', message = 'Invalid KPI numeric or boolean option.';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Atomic submit: frozen relation mode + current Customer authority
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

-- ---------------------------------------------------------------------------
-- 6. Append-only revision: immutable Customer ID, fresh authorized snapshot
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

-- ---------------------------------------------------------------------------
-- 7. Explicit execute surface
-- ---------------------------------------------------------------------------

revoke all on function public.crm_kpi_create_definition_v3(
  text,text,text,text,text,text,text,boolean,text,integer,boolean,boolean,text
) from public, anon;
revoke all on function public.crm_kpi_create_definition_active_r4(
  uuid,integer,text,text,text,text,text,text,text,text,boolean,text,integer,boolean,boolean,text
) from public, anon;
revoke all on function public.crm_kpi_update_definition_v2(uuid, integer, jsonb)
  from public, anon;
revoke all on function public.crm_kpi_submit_events(uuid, uuid, text, jsonb)
  from public, anon;
revoke all on function public.crm_kpi_submit_revision(uuid, uuid, text, jsonb)
  from public, anon;
revoke all on function public.crm_kpi_source_snapshot(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.crm_kpi_create_definition_v3(
  text,text,text,text,text,text,text,boolean,text,integer,boolean,boolean,text
) to authenticated, service_role;
grant execute on function public.crm_kpi_create_definition_active_r4(
  uuid,integer,text,text,text,text,text,text,text,text,boolean,text,integer,boolean,boolean,text
) to authenticated, service_role;
grant execute on function public.crm_kpi_update_definition_v2(uuid, integer, jsonb)
  to authenticated, service_role;
grant execute on function public.crm_kpi_submit_events(uuid, uuid, text, jsonb)
  to authenticated;
grant execute on function public.crm_kpi_submit_revision(uuid, uuid, text, jsonb)
  to authenticated;

commit;
