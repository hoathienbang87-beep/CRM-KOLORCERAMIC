alter table public.app_users enable row level security;

create or replace function public.crm_current_user_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select lower(coalesce(role, ''))
  from public.app_users
  where lower(email) = lower(coalesce(auth.email(), ''))
    and lower(coalesce(active::text, '')) in ('true', 'active', '1')
  limit 1;
$$;

grant execute on function public.crm_current_user_role() to authenticated;

drop policy if exists "app users read own or manager" on public.app_users;
create policy "app users read own or manager" on public.app_users
for select
to authenticated
using (
  lower(coalesce(email, '')) = lower(coalesce(auth.email(), ''))
  or public.crm_current_user_role() in ('admin', 'manager', 'quanly')
);

drop policy if exists "app users create own inactive profile" on public.app_users;
create policy "app users create own inactive profile" on public.app_users
for insert
to authenticated
with check (
  lower(coalesce(email, '')) = lower(coalesce(auth.email(), ''))
  and lower(coalesce(active::text, '')) in ('false', 'inactive', '0')
);

drop policy if exists "app users admin update" on public.app_users;
create policy "app users admin update" on public.app_users
for update
to authenticated
using (public.crm_current_user_role() = 'admin')
with check (public.crm_current_user_role() = 'admin');
