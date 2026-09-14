-- KPI-2: Sale withdrawal for an unreviewed root proposal.
-- This is an append-only lifecycle transition: no Event, Evidence or audit row is deleted.

begin;

alter table public.kpi_submission_events
  add column if not exists withdrawn_by_user_id text references public.app_users(id) on delete restrict,
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdraw_reason text;

alter table public.kpi_submission_events
  drop constraint if exists kpi_submission_events_status_check,
  drop constraint if exists kpi_submission_events_review_shape_check,
  drop constraint if exists kpi_submission_events_withdraw_reason_check;

alter table public.kpi_submission_events
  add constraint kpi_submission_events_status_check
    check (status in ('PENDING', 'NEEDS_REVISION', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  add constraint kpi_submission_events_withdraw_reason_check
    check (withdraw_reason is null or (nullif(btrim(withdraw_reason), '') is not null and char_length(withdraw_reason) <= 500)),
  add constraint kpi_submission_events_review_shape_check check (
    (status = 'PENDING'
      and reviewed_by_user_id is null and reviewed_at is null and approved_value is null
      and withdrawn_by_user_id is null and withdrawn_at is null and withdraw_reason is null)
    or (status = 'APPROVED'
      and reviewed_by_user_id is not null and reviewed_at is not null and approved_value is not null
      and withdrawn_by_user_id is null and withdrawn_at is null and withdraw_reason is null)
    or (status in ('NEEDS_REVISION', 'REJECTED')
      and reviewed_by_user_id is not null and reviewed_at is not null and approved_value is null
      and withdrawn_by_user_id is null and withdrawn_at is null and withdraw_reason is null)
    or (status = 'WITHDRAWN'
      and reviewed_by_user_id is null and reviewed_at is null and approved_value is null
      and withdrawn_by_user_id is not null and withdrawn_at is not null
      and nullif(btrim(withdraw_reason), '') is not null)
  );

drop index if exists public.kpi_submission_events_root_dedupe_idx;
create unique index kpi_submission_events_root_dedupe_idx
  on public.kpi_submission_events(assignment_id, source_type, source_event_key)
  where supersedes_event_id is null and status <> 'WITHDRAWN';

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

revoke all on function public.crm_kpi_refresh_submission_status(uuid) from public, anon, authenticated;

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
          and e.source_event_key = 'care_log:' || l.id
          and e.supersedes_event_id is null and e.status <> 'WITHDRAWN'
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
          and e.source_event_key = 'customer:' || c.id
          and e.supersedes_event_id is null and e.status <> 'WITHDRAWN'
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

revoke all on function public.crm_kpi_list_hybrid_candidates(uuid) from public, anon;
grant execute on function public.crm_kpi_list_hybrid_candidates(uuid) to authenticated;

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

revoke all on function public.crm_kpi_withdraw_event(uuid, integer, text, uuid) from public, anon;
grant execute on function public.crm_kpi_withdraw_event(uuid, integer, text, uuid) to authenticated;

comment on function public.crm_kpi_withdraw_event(uuid, integer, text, uuid) is
  'Sale may withdraw only their own unreviewed root KPI Event in an ACTIVE period. Evidence and audit are retained.';

commit;
