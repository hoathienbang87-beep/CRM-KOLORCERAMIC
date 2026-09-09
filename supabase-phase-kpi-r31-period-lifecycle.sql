-- CRM-KPI-R3.1: safe ACTIVE revert, DRAFT deletion and used-period cancellation.
-- Canonical KPI runtime is preserved; legacy KPI is intentionally untouched.

begin;

alter table public.kpi_periods
  add column if not exists cancelled_by_user_id text references public.app_users(id) on delete restrict,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;

alter table public.kpi_periods drop constraint if exists kpi_periods_status_check;
alter table public.kpi_periods add constraint kpi_periods_status_check
  check (status in ('DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED'));

alter table public.kpi_periods drop constraint if exists kpi_periods_lifecycle_shape_check;
alter table public.kpi_periods add constraint kpi_periods_lifecycle_shape_check check (
  (status = 'DRAFT' and cancelled_at is null and cancelled_by_user_id is null and cancel_reason is null)
  or (status = 'ACTIVE' and activated_at is not null and activated_by_user_id is not null
      and cancelled_at is null and cancelled_by_user_id is null and cancel_reason is null)
  or (status = 'CLOSED' and activated_at is not null and activated_by_user_id is not null
      and closed_at is not null and closed_by_user_id is not null
      and cancelled_at is null and cancelled_by_user_id is null and cancel_reason is null)
  or (status = 'CANCELLED' and activated_at is not null and activated_by_user_id is not null
      and cancelled_at is not null and cancelled_by_user_id is not null
      and nullif(btrim(cancel_reason), '') is not null)
);

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

revoke all on function public.crm_kpi_period_runtime_dependencies(uuid) from public, anon;
grant execute on function public.crm_kpi_period_runtime_dependencies(uuid) to authenticated, service_role;

create or replace function public.crm_kpi_revert_active_period_to_draft(
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
  v_reason text := public.crm_kpi_r3_reason(p_reason);
  v_dependencies jsonb;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode='42501', message='Chỉ manager/admin/owner được đưa kỳ ACTIVE về DRAFT.';
  end if;
  select * into v_old from public.kpi_periods where id=p_period_id for update;
  if v_old.id is null then raise exception using errcode='P0002', message='Không tìm thấy kỳ KPI.'; end if;
  if v_old.status <> 'ACTIVE' then raise exception using errcode='55000', message='Chỉ kỳ ACTIVE được đưa về DRAFT.'; end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception using errcode='P0001', message='KPI_VERSION_CONFLICT: Kỳ KPI đã thay đổi. Hãy tải lại.';
  end if;
  perform 1 from public.kpi_assignments where period_id=p_period_id order by id for update;
  v_dependencies := public.crm_kpi_period_runtime_dependencies(p_period_id);
  if (v_dependencies->>'runtimeTotal')::bigint <> 0 then
    raise exception using errcode='55000', message='Kỳ KPI đã có dữ liệu thực hiện và không thể đưa về DRAFT.';
  end if;
  perform set_config('crm.kpi_write','on',true);
  update public.kpi_periods set status='DRAFT', activated_by_user_id=null, activated_at=null,
    updated_at=now(), version=version+1 where id=p_period_id returning * into v_new;
  perform public.crm_kpi_write_audit('PERIOD_REVERTED_TO_DRAFT','kpi_periods',p_period_id::text,
    jsonb_build_object('periodId',p_period_id,'oldStatus','ACTIVE','newStatus','DRAFT',
      'versionBefore',v_old.version,'versionAfter',v_new.version,'reason',v_reason,
      'dependencyCounts',v_dependencies,'before',to_jsonb(v_old),'after',to_jsonb(v_new)));
  return to_jsonb(v_new) || jsonb_build_object('dependencyCounts',v_dependencies);
end;
$$;

drop function if exists public.crm_kpi_delete_draft_period(uuid, integer);
create function public.crm_kpi_delete_draft_period(
  p_period_id uuid,
  p_expected_period_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.kpi_periods%rowtype;
  v_assignments jsonb;
  v_dependencies jsonb;
  v_reason text := public.crm_kpi_r3_reason(p_reason);
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode='42501', message='Chỉ manager/admin/owner được xóa kỳ KPI DRAFT.';
  end if;
  select * into v_period from public.kpi_periods where id=p_period_id for update;
  if v_period.id is null then raise exception using errcode='P0002', message='Không tìm thấy kỳ KPI.'; end if;
  if v_period.status <> 'DRAFT' then raise exception using errcode='55000', message='Chỉ kỳ DRAFT mới được xóa.'; end if;
  if p_expected_period_version is null or v_period.version <> p_expected_period_version then
    raise exception using errcode='P0001', message='KPI_VERSION_CONFLICT: Kỳ KPI đã thay đổi. Hãy tải lại.';
  end if;
  perform 1 from public.kpi_assignments where period_id=p_period_id order by id for update;
  v_dependencies := public.crm_kpi_period_runtime_dependencies(p_period_id);
  if (v_dependencies->>'runtimeTotal')::bigint <> 0 then
    raise exception using errcode='55000', message='Kỳ KPI đã có dữ liệu thực hiện và không thể xóa.';
  end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) into v_assignments
    from public.kpi_assignments a where a.period_id=p_period_id;
  perform public.crm_kpi_write_audit('PERIOD_DELETED_DRAFT','kpi_periods',p_period_id::text,
    jsonb_build_object('periodId',p_period_id,'oldStatus','DRAFT','newStatus',null,
      'versionBefore',v_period.version,'reason',v_reason,'dependencyCounts',v_dependencies,
      'deletedPeriod',to_jsonb(v_period),'deletedAssignments',v_assignments));
  perform set_config('crm.kpi_write','on',true);
  delete from public.kpi_assignments where period_id=p_period_id;
  delete from public.kpi_periods where id=p_period_id;
  return jsonb_build_object('deleted',true,'periodId',p_period_id,
    'assignmentCount',jsonb_array_length(v_assignments),'dependencyCounts',v_dependencies);
end;
$$;

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

drop trigger if exists kpi_submissions_r31_period_guard on public.kpi_submissions;
create trigger kpi_submissions_r31_period_guard before insert or update or delete on public.kpi_submissions
  for each row execute function public.crm_kpi_guard_runtime_period_active();
drop trigger if exists kpi_submission_events_r31_period_guard on public.kpi_submission_events;
create trigger kpi_submission_events_r31_period_guard before insert or update or delete on public.kpi_submission_events
  for each row execute function public.crm_kpi_guard_runtime_period_active();
drop trigger if exists kpi_evidence_r31_period_guard on public.kpi_evidence;
create trigger kpi_evidence_r31_period_guard before insert or update or delete on public.kpi_evidence
  for each row execute function public.crm_kpi_guard_runtime_period_active();

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

revoke all on function public.crm_kpi_revert_active_period_to_draft(uuid,integer,text) from public,anon;
revoke all on function public.crm_kpi_delete_draft_period(uuid,integer,text) from public,anon;
revoke all on function public.crm_kpi_cancel_active_period(uuid,integer,text) from public,anon;
revoke all on function public.crm_kpi_guard_runtime_period_active() from public,anon,authenticated;
grant execute on function public.crm_kpi_revert_active_period_to_draft(uuid,integer,text) to authenticated,service_role;
grant execute on function public.crm_kpi_delete_draft_period(uuid,integer,text) to authenticated,service_role;
grant execute on function public.crm_kpi_cancel_active_period(uuid,integer,text) to authenticated,service_role;
revoke all on function public.crm_kpi_get_assignment_progress(uuid) from public,anon;
revoke all on function public.crm_kpi_get_monthly_scores(uuid) from public,anon;
grant execute on function public.crm_kpi_get_assignment_progress(uuid) to authenticated,service_role;
grant execute on function public.crm_kpi_get_monthly_scores(uuid) to authenticated,service_role;

commit;
