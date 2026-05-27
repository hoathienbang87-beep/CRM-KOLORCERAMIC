alter table public.kpi_proposals enable row level security;

drop policy if exists "kpi proposals owner or manager read" on public.kpi_proposals;
create policy "kpi proposals owner or manager read" on public.kpi_proposals
for select
to authenticated
using (
  lower(coalesce(owner_email, email, '')) = lower(coalesce(auth.email(), ''))
  or exists (
    select 1
    from public.app_users u
    where lower(u.email) = lower(coalesce(auth.email(), ''))
      and lower(coalesce(u.active::text, '')) in ('true', 'active', '1')
      and lower(coalesce(u.role, '')) in ('admin', 'manager', 'quanly')
  )
);

drop policy if exists "kpi proposals active users insert own" on public.kpi_proposals;
create policy "kpi proposals active users insert own" on public.kpi_proposals
for insert
to authenticated
with check (
  lower(coalesce(owner_email, email, '')) = lower(coalesce(auth.email(), ''))
  and lower(coalesce(status, 'pending')) = 'pending'
  and coalesce(is_deleted, false) = false
  and exists (
    select 1
    from public.app_users u
    where lower(u.email) = lower(coalesce(auth.email(), ''))
      and lower(coalesce(u.active::text, '')) in ('true', 'active', '1')
  )
);

drop policy if exists "kpi proposals owner edit pending" on public.kpi_proposals;
create policy "kpi proposals owner edit pending" on public.kpi_proposals
for update
to authenticated
using (
  lower(coalesce(owner_email, email, '')) = lower(coalesce(auth.email(), ''))
  and lower(coalesce(status, 'pending')) = 'pending'
  and coalesce(is_deleted, false) = false
)
with check (
  lower(coalesce(owner_email, email, '')) = lower(coalesce(auth.email(), ''))
  and lower(coalesce(status, 'pending')) = 'pending'
);

drop policy if exists "kpi proposals manager update review" on public.kpi_proposals;
create policy "kpi proposals manager update review" on public.kpi_proposals
for update
to authenticated
using (
  exists (
    select 1
    from public.app_users u
    where lower(u.email) = lower(coalesce(auth.email(), ''))
      and lower(coalesce(u.active::text, '')) in ('true', 'active', '1')
      and lower(coalesce(u.role, '')) in ('admin', 'manager', 'quanly')
  )
)
with check (
  exists (
    select 1
    from public.app_users u
    where lower(u.email) = lower(coalesce(auth.email(), ''))
      and lower(coalesce(u.active::text, '')) in ('true', 'active', '1')
      and lower(coalesce(u.role, '')) in ('admin', 'manager', 'quanly')
  )
);
