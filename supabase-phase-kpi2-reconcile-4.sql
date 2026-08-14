-- STAGING DEVELOPMENT / SUPERSEDED FOR PRODUCTION.
-- Production source of truth: supabase-phase-kpi2-final-consolidated.sql.
-- KPI-2 staging reconciliation 4.
-- A superseded NEEDS_REVISION event remains immutable history, but is no longer
-- an open item in assignment progress or monthly score finality.
-- Dependency: KPI-2 revision chain from reconcile 1.

begin;

create or replace function public.crm_kpi_get_assignment_progress(p_period_id uuid default null)
returns table(
  assignment_id uuid, period_id uuid, period_month date, period_status text, definition_id uuid,
  employee_id text, employee_name text, definition_snapshot jsonb, target numeric, score_enabled boolean,
  aggregation_mode text, approved_actual numeric, pending_count bigint, pending_value numeric,
  needs_revision_count bigint, needs_revision_value numeric, rejected_count bigint, rejected_value numeric,
  actual_completion_pct numeric, scoring_completion_pct numeric, has_open_items boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    a.id,
    p.id,
    p.period_month,
    p.status,
    a.definition_id,
    a.employee_id,
    u.name,
    a.definition_snapshot,
    a.target,
    a.score_enabled,
    coalesce(a.definition_snapshot->>'aggregation_mode', 'COUNT'),
    coalesce(sum(e.approved_value) filter (where e.status = 'APPROVED'), 0),
    count(e.id) filter (where e.status = 'PENDING'),
    coalesce(sum(e.claimed_value) filter (where e.status = 'PENDING'), 0),
    count(e.id) filter (
      where e.status = 'NEEDS_REVISION'
        and not exists (
          select 1 from public.kpi_submission_events revision
          where revision.supersedes_event_id = e.id
        )
    ),
    coalesce(sum(e.claimed_value) filter (
      where e.status = 'NEEDS_REVISION'
        and not exists (
          select 1 from public.kpi_submission_events revision
          where revision.supersedes_event_id = e.id
        )
    ), 0),
    count(e.id) filter (where e.status = 'REJECTED'),
    coalesce(sum(e.claimed_value) filter (where e.status = 'REJECTED'), 0),
    round(coalesce(sum(e.approved_value) filter (where e.status = 'APPROVED'), 0) / a.target * 100, 2),
    least(round(coalesce(sum(e.approved_value) filter (where e.status = 'APPROVED'), 0) / a.target * 100, 2), 100),
    count(e.id) filter (
      where e.status = 'PENDING'
         or (
           e.status = 'NEEDS_REVISION'
           and not exists (
             select 1 from public.kpi_submission_events revision
             where revision.supersedes_event_id = e.id
           )
         )
    ) > 0
  from public.kpi_assignments a
  join public.kpi_periods p on p.id = a.period_id
  join public.app_users u on u.id = a.employee_id
  left join public.kpi_submission_events e on e.assignment_id = a.id
  where a.assignment_status = 'ASSIGNED'
    and p.status in ('ACTIVE', 'CLOSED')
    and (p_period_id is null or p.id = p_period_id)
    and (public.crm_kpi_is_business_manager() or a.employee_id = public.crm_current_app_user_id())
  group by a.id, p.id, u.name;
$$;

revoke all on function public.crm_kpi_get_assignment_progress(uuid)
  from public, anon;
grant execute on function public.crm_kpi_get_assignment_progress(uuid)
  to authenticated;

commit;
