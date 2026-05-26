alter table public.audit_logs enable row level security;

drop policy if exists "audit logs active users insert" on public.audit_logs;
create policy "audit logs active users insert" on public.audit_logs
for insert
to authenticated
with check (
  lower(coalesce(email, '')) = lower(coalesce(auth.email(), ''))
  and exists (
    select 1
    from public.app_users u
    where lower(u.email) = lower(coalesce(auth.email(), ''))
      and lower(coalesce(u.active::text, '')) in ('true', 'active', '1')
  )
);

drop policy if exists "audit logs user or manager read" on public.audit_logs;
create policy "audit logs user or manager read" on public.audit_logs
for select
to authenticated
using (
  lower(coalesce(email, '')) = lower(coalesce(auth.email(), ''))
  or exists (
    select 1
    from public.app_users u
    where lower(u.email) = lower(coalesce(auth.email(), ''))
      and lower(coalesce(u.active::text, '')) in ('true', 'active', '1')
      and lower(coalesce(u.role, '')) in ('admin', 'manager', 'quanly')
  )
);
