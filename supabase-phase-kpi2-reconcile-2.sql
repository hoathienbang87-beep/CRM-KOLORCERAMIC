-- STAGING DEVELOPMENT / SUPERSEDED FOR PRODUCTION.
-- Production source of truth: supabase-phase-kpi2-final-consolidated.sql.
-- KPI-2 staging reconcile 2: normalize JSON null location before validation.
begin;

create or replace function public.crm_kpi_normalize_event_location()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.location_snapshot is not null and jsonb_typeof(new.location_snapshot) = 'null' then
    new.location_snapshot := null;
  end if;
  return new;
end $$;

revoke all on function public.crm_kpi_normalize_event_location() from public,anon,authenticated;
drop trigger if exists kpi_submission_events_normalize_location on public.kpi_submission_events;
create trigger kpi_submission_events_normalize_location
before insert or update of location_snapshot on public.kpi_submission_events
for each row execute function public.crm_kpi_normalize_event_location();

commit;
