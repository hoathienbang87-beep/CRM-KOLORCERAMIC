begin;

-- Company / brand settings used by the separate admin panel.
-- Run this after a Supabase backup. Do not put database passwords or service keys in Git.

create table if not exists public.company_settings (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  raw_data jsonb not null default '{}'::jsonb,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.crm_is_owner_or_admin()
returns boolean
language sql
stable
as $$
  select public.crm_current_user_role() in ('owner', 'admin');
$$;

grant execute on function public.crm_is_owner_or_admin() to authenticated;

create or replace function public.crm_sync_company_settings_raw_data()
returns trigger
language plpgsql
as $$
begin
  new.raw_data = coalesce(new.data, '{}'::jsonb);
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists company_settings_sync_raw_data on public.company_settings;
create trigger company_settings_sync_raw_data
before insert or update on public.company_settings
for each row execute function public.crm_sync_company_settings_raw_data();

alter table public.company_settings enable row level security;

drop policy if exists "company settings owner admin read" on public.company_settings;
create policy "company settings owner admin read"
on public.company_settings
for select
to authenticated
using (public.crm_is_owner_or_admin());

drop policy if exists "company settings owner admin insert" on public.company_settings;
create policy "company settings owner admin insert"
on public.company_settings
for insert
to authenticated
with check (public.crm_is_owner_or_admin());

drop policy if exists "company settings owner admin update" on public.company_settings;
create policy "company settings owner admin update"
on public.company_settings
for update
to authenticated
using (public.crm_is_owner_or_admin())
with check (public.crm_is_owner_or_admin());

drop policy if exists "company settings owner admin delete" on public.company_settings;
create policy "company settings owner admin delete"
on public.company_settings
for delete
to authenticated
using (public.crm_is_owner_or_admin());

insert into public.company_settings (id, data, raw_data)
values (
  'main',
  jsonb_build_object(
    'companyName', 'Kolorceramic THT',
    'logoUrl', '',
    'phone', '',
    'email', '',
    'showroomAddress', '',
    'facebookUrl', '',
    'zaloUrl', '',
    'brandColor', '#147a68',
    'defaultNotice', ''
  ),
  jsonb_build_object(
    'companyName', 'Kolorceramic THT',
    'logoUrl', '',
    'phone', '',
    'email', '',
    'showroomAddress', '',
    'facebookUrl', '',
    'zaloUrl', '',
    'brandColor', '#147a68',
    'defaultNotice', ''
  )
)
on conflict (id) do nothing;

commit;
