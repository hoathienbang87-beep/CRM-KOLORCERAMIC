-- STAGING DEVELOPMENT / SUPERSEDED FOR PRODUCTION.
-- Production source of truth: supabase-phase-kpi2-final-consolidated.sql.
-- Aligns the patched staging final state with the clean consolidated artifact.

begin;

update public.kpi_action_requests
set request_schema_version = 1
where request_schema_version < 1;

alter table public.kpi_action_requests
  drop constraint if exists kpi_action_requests_schema_version_check;
alter table public.kpi_action_requests
  add constraint kpi_action_requests_schema_version_check
  check (request_schema_version >= 1);

revoke all on function public.crm_kpi_source_snapshot(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.crm_kpi_list_hybrid_candidates(uuid)
  from public, anon;
grant execute on function public.crm_kpi_list_hybrid_candidates(uuid)
  to authenticated;

revoke all on public.kpi_definitions, public.kpi_assignments, public.kpi_periods
  from anon, authenticated;
grant select on public.kpi_definitions, public.kpi_assignments, public.kpi_periods
  to authenticated;

commit;
