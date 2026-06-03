-- Run once if KPI rules created in May 2026 were disabled after the month changed.
-- This restores May KPI rules so they can be reused as long-running KPI definitions.

update public.kpi_rules
set
  active = true,
  updated_at = now()
where month = '2026-05'
  and coalesce(active, false) = false;

select 'OK: restored inactive KPI rules for 2026-05' as result;
