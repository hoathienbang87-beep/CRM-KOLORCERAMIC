-- =====================================================================
-- KPI read-side RLS mirror (Production jjeeazwlqcwynzquimeo, read 2026-10-10)
-- Loaded after kpi-lifecycle-prod-baseline.sql for tests that must prove
-- what an `authenticated` Sale can SELECT (period enumeration privacy,
-- own-KPI-only history). Function bodies are byte-matched to Production
-- (md5 pinned below); policies are copied from pg_policies verbatim.
-- DISPOSABLE DATABASES ONLY.
-- =====================================================================
-- source: supabase-phase-kpi1-foundation.sql @ offset 7210
create or replace function public.crm_kpi_sale_has_period_assignment(p_period_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.crm_is_active_user()
    and exists (
      select 1
      from public.kpi_assignments a
      where a.period_id = p_period_id
        and a.employee_id = public.crm_current_app_user_id()
        and a.assignment_status = 'ASSIGNED'
    );
$$;
-- source: supabase-phase-kpi1-foundation.sql @ offset 7642
create or replace function public.crm_kpi_sale_can_read_assignment(
  p_period_id uuid,
  p_employee_id text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.crm_is_active_user()
    and p_employee_id = public.crm_current_app_user_id()
    and exists (
      select 1
      from public.kpi_periods p
      where p.id = p_period_id and p.status in ('ACTIVE', 'CLOSED')
    );
$$;
-- source: supabase-phase-kpi2-final-consolidated.sql @ offset 11884
create or replace function public.crm_kpi_can_read_assignment_runtime(p_assignment_id uuid)
returns boolean language sql security definer set search_path = public stable
as $$
  select public.crm_kpi_is_business_manager() or exists (
    select 1 from public.kpi_assignments a join public.kpi_periods p on p.id = a.period_id
    where a.id = p_assignment_id and a.employee_id = public.crm_current_app_user_id()
      and a.assignment_status = 'ASSIGNED' and p.status in ('ACTIVE', 'CLOSED')
  );
$$;

revoke all on function public.crm_kpi_sale_has_period_assignment(uuid), public.crm_kpi_sale_can_read_assignment(uuid, text),
  public.crm_kpi_can_read_assignment_runtime(uuid) from public, anon;
grant execute on function public.crm_kpi_sale_has_period_assignment(uuid), public.crm_kpi_sale_can_read_assignment(uuid, text),
  public.crm_kpi_can_read_assignment_runtime(uuid) to authenticated, service_role;

-- Table privileges as in Production: authenticated may SELECT; all writes go through RPCs.
grant select on public.kpi_periods, public.kpi_assignments, public.kpi_submission_events, public.kpi_submissions, public.kpi_evidence to authenticated;
alter table public.kpi_periods enable row level security;
alter table public.kpi_assignments enable row level security;
alter table public.kpi_submission_events enable row level security;
alter table public.kpi_submissions enable row level security;
alter table public.kpi_evidence enable row level security;

create policy "kpi periods canonical read" on public.kpi_periods for select to authenticated
  using ((crm_kpi_is_business_manager() OR ((status = ANY (ARRAY['ACTIVE'::text, 'CLOSED'::text])) AND crm_kpi_sale_has_period_assignment(id))));
create policy "kpi assignments canonical read" on public.kpi_assignments for select to authenticated
  using ((crm_kpi_is_business_manager() OR crm_kpi_sale_can_read_assignment(period_id, employee_id)));
create policy "kpi2 events canonical read" on public.kpi_submission_events for select to authenticated
  using (crm_kpi_can_read_assignment_runtime(assignment_id));
create policy "kpi2 submissions canonical read" on public.kpi_submissions for select to authenticated
  using (crm_kpi_can_read_assignment_runtime(assignment_id));
create policy "kpi2 evidence canonical read" on public.kpi_evidence for select to authenticated
  using (((uploaded_by_user_id = crm_current_app_user_id()) OR crm_kpi_is_business_manager()));

insert into lifecycle_test.prod_function_manifest values
('crm_kpi_can_read_assignment_runtime','c6f24d9ce9499b613a156b818ce43fbd'),
('crm_kpi_sale_can_read_assignment','f62dcb49bd321f2660798d104ac59da5'),
('crm_kpi_sale_has_period_assignment','0e381e900857f69566ac2eeb9c05b3d3');
