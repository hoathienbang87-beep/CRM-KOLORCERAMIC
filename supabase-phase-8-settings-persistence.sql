-- CRM-KOLORCERAMIC - Phase 8: persist CRM settings safely.
-- IMPORTANT: Backup Supabase before running this migration in production.
-- This migration is idempotent and does not delete CRM data.

begin;

alter table public.settings
  add column if not exists data jsonb not null default '{}'::jsonb,
  add column if not exists raw_data jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz default now();

-- Repair rows where partial frontend patches caused data and raw_data to drift.
-- raw_data wins for duplicate keys because the legacy adapter kept merge history there.
with merged as (
  select
    id,
    coalesce(data, '{}'::jsonb) || coalesce(raw_data, '{}'::jsonb) as payload
  from public.settings
)
update public.settings as s
set
  data = merged.payload,
  raw_data = merged.payload,
  updated_at = now()
from merged
where s.id = merged.id
  and (s.data is distinct from merged.payload or s.raw_data is distinct from merged.payload);

create or replace function public.crm_sync_settings_payload()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  merged jsonb;
begin
  if tg_op = 'UPDATE' then
    merged :=
      coalesce(old.data, '{}'::jsonb)
      || coalesce(old.raw_data, '{}'::jsonb)
      || coalesce(new.data, '{}'::jsonb)
      || coalesce(new.raw_data, '{}'::jsonb);
  else
    merged := coalesce(new.data, '{}'::jsonb) || coalesce(new.raw_data, '{}'::jsonb);
  end if;

  new.data := merged;
  new.raw_data := merged;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists settings_sync_payload on public.settings;
create trigger settings_sync_payload
before insert or update on public.settings
for each row execute function public.crm_sync_settings_payload();

alter table public.settings enable row level security;

drop policy if exists "settings active users read" on public.settings;
create policy "settings active users read"
on public.settings
for select
to authenticated
using (public.crm_is_active_user());

drop policy if exists "settings admin write" on public.settings;
create policy "settings admin write"
on public.settings
for all
to authenticated
using (public.crm_is_admin())
with check (public.crm_is_admin());

commit;

-- Verification after running:
-- select id, data, raw_data, data = raw_data as payloads_match, updated_at
-- from public.settings
-- where id = 'crm';
