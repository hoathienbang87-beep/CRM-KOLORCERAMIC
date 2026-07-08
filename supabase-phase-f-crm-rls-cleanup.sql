-- CRM KOLORCERAMIC - Phase F: CRM-only RLS cleanup
-- Created: 2026-07-08
--
-- Purpose:
-- 1. Keep the database aligned with the new CRM-only scope.
-- 2. Keep core CRM tables operational: customers, care_logs, deals, KPI, users, settings, audit.
-- 3. Move old ERP/CMS tables to archive/read-only mode for owner/admin.
-- 4. Do NOT drop tables and do NOT delete business data.
--
-- Run after:
-- - A fresh Supabase backup.
-- - The frontend has been updated to stop using ERP/CMS screens.
--
-- Important:
-- - This SQL is intentionally conservative.
-- - Legacy tables are kept for history/audit/export only.
-- - If the app still has a hidden flow that writes quotes/products/payments/inventory, that flow will be blocked.

begin;

-- ---------------------------------------------------------------------------
-- 1. Normalize role helpers for CRM-only operation
-- ---------------------------------------------------------------------------

create or replace function public.crm_current_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.email(), ''));
$$;

create or replace function public.crm_current_user_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select lower(coalesce(role, ''))
  from public.app_users
  where lower(coalesce(email, '')) = public.crm_current_email()
    and lower(coalesce(active::text, '')) in ('true', 'active', '1')
  limit 1;
$$;

create or replace function public.crm_is_active_user()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.app_users
    where lower(coalesce(email, '')) = public.crm_current_email()
      and lower(coalesce(active::text, '')) in ('true', 'active', '1')
  );
$$;

create or replace function public.crm_is_admin()
returns boolean
language sql
stable
as $$
  select public.crm_current_user_role() in ('owner', 'admin');
$$;

create or replace function public.crm_is_owner_or_admin()
returns boolean
language sql
stable
as $$
  select public.crm_is_admin();
$$;

create or replace function public.crm_is_manager()
returns boolean
language sql
stable
as $$
  select public.crm_current_user_role() in ('owner', 'admin', 'manager', 'quanly', 'quản lý', 'quản lí');
$$;

create or replace function public.crm_is_owner(p_owner_email text, p_created_by_email text default null)
returns boolean
language sql
stable
as $$
  select public.crm_current_email() <> ''
    and (
      lower(coalesce(p_owner_email, '')) = public.crm_current_email()
      or lower(coalesce(p_created_by_email, '')) = public.crm_current_email()
    );
$$;

create or replace function public.crm_can_access_customer_id(p_customer_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.crm_is_manager()
    or exists (
      select 1
      from public.customers c
      where c.id = p_customer_id
        and (
          lower(coalesce(c.owner_email, '')) = public.crm_current_email()
          or lower(coalesce(c.created_by_email, '')) = public.crm_current_email()
        )
    );
$$;

grant execute on function public.crm_current_email() to authenticated;
grant execute on function public.crm_current_user_role() to authenticated;
grant execute on function public.crm_is_active_user() to authenticated;
grant execute on function public.crm_is_admin() to authenticated;
grant execute on function public.crm_is_owner_or_admin() to authenticated;
grant execute on function public.crm_is_manager() to authenticated;
grant execute on function public.crm_is_owner(text, text) to authenticated;
grant execute on function public.crm_can_access_customer_id(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Core CRM tables remain active
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on
  public.app_users,
  public.settings,
  public.customers,
  public.care_logs,
  public.deals,
  public.kpi_rules,
  public.kpi_proposals,
  public.phone_index,
  public.audit_logs,
  public.user_sessions
to authenticated;

alter table public.app_users enable row level security;
alter table public.settings enable row level security;
alter table public.customers enable row level security;
alter table public.care_logs enable row level security;
alter table public.deals enable row level security;
alter table public.kpi_rules enable row level security;
alter table public.kpi_proposals enable row level security;
alter table public.phone_index enable row level security;
alter table public.audit_logs enable row level security;
alter table public.user_sessions enable row level security;

-- app_users
drop policy if exists "app users read self or manager" on public.app_users;
create policy "app users read self or manager" on public.app_users
for select to authenticated
using (
  lower(coalesce(email, '')) = public.crm_current_email()
  or public.crm_is_manager()
);

drop policy if exists "app users self create inactive" on public.app_users;
create policy "app users self create inactive" on public.app_users
for insert to authenticated
with check (
  lower(coalesce(email, '')) = public.crm_current_email()
  and lower(coalesce(active::text, '')) in ('false', 'inactive', '0')
);

drop policy if exists "app users admin update" on public.app_users;
create policy "app users admin update" on public.app_users
for update to authenticated
using (public.crm_is_admin())
with check (public.crm_is_admin());

drop policy if exists "app users admin delete" on public.app_users;
create policy "app users admin delete" on public.app_users
for delete to authenticated
using (public.crm_is_admin());

-- settings
drop policy if exists "settings active users read" on public.settings;
create policy "settings active users read" on public.settings
for select to authenticated
using (public.crm_is_active_user());

drop policy if exists "settings admin write" on public.settings;
create policy "settings admin write" on public.settings
for all to authenticated
using (public.crm_is_admin())
with check (public.crm_is_admin());

-- customers
drop policy if exists "customers manager or owner read" on public.customers;
create policy "customers manager or owner read" on public.customers
for select to authenticated
using (
  public.crm_is_manager()
  or public.crm_is_owner(owner_email, created_by_email)
);

drop policy if exists "customers manager or owner insert" on public.customers;
create policy "customers manager or owner insert" on public.customers
for insert to authenticated
with check (
  public.crm_is_active_user()
  and (
    public.crm_is_manager()
    or public.crm_is_owner(owner_email, created_by_email)
  )
);

drop policy if exists "customers manager or owner update" on public.customers;
create policy "customers manager or owner update" on public.customers
for update to authenticated
using (
  public.crm_is_manager()
  or public.crm_is_owner(owner_email, created_by_email)
)
with check (
  public.crm_is_manager()
  or public.crm_is_owner(owner_email, created_by_email)
);

drop policy if exists "customers admin delete" on public.customers;
create policy "customers admin delete" on public.customers
for delete to authenticated
using (public.crm_is_admin());

-- care_logs
drop policy if exists "care logs manager or owner read" on public.care_logs;
create policy "care logs manager or owner read" on public.care_logs
for select to authenticated
using (
  public.crm_is_manager()
  or public.crm_is_owner(owner_email, created_by_email)
  or public.crm_can_access_customer_id(customer_id)
);

drop policy if exists "care logs manager or owner insert" on public.care_logs;
create policy "care logs manager or owner insert" on public.care_logs
for insert to authenticated
with check (
  public.crm_is_active_user()
  and (
    public.crm_is_manager()
    or public.crm_is_owner(owner_email, created_by_email)
    or public.crm_can_access_customer_id(customer_id)
  )
);

drop policy if exists "care logs admin update" on public.care_logs;
create policy "care logs admin update" on public.care_logs
for update to authenticated
using (public.crm_is_admin())
with check (public.crm_is_admin());

drop policy if exists "care logs admin delete" on public.care_logs;
create policy "care logs admin delete" on public.care_logs
for delete to authenticated
using (public.crm_is_admin());

-- deals remain as CRM basic purchase history only.
drop policy if exists "deals manager or owner read" on public.deals;
create policy "deals manager or owner read" on public.deals
for select to authenticated
using (
  public.crm_is_manager()
  or public.crm_is_owner(owner_email, null)
  or public.crm_can_access_customer_id(customer_id)
);

drop policy if exists "deals manager or owner insert" on public.deals;
create policy "deals manager or owner insert" on public.deals
for insert to authenticated
with check (
  public.crm_is_active_user()
  and (
    public.crm_is_manager()
    or public.crm_is_owner(owner_email, null)
    or public.crm_can_access_customer_id(customer_id)
  )
);

drop policy if exists "deals manager or owner update" on public.deals;
create policy "deals manager or owner update" on public.deals
for update to authenticated
using (
  public.crm_is_manager()
  or public.crm_is_owner(owner_email, null)
  or public.crm_can_access_customer_id(customer_id)
)
with check (
  public.crm_is_manager()
  or public.crm_is_owner(owner_email, null)
  or public.crm_can_access_customer_id(customer_id)
);

drop policy if exists "deals admin delete" on public.deals;
create policy "deals admin delete" on public.deals
for delete to authenticated
using (public.crm_is_admin());

-- kpi_rules
drop policy if exists "kpi rules active users read" on public.kpi_rules;
create policy "kpi rules active users read" on public.kpi_rules
for select to authenticated
using (public.crm_is_active_user());

drop policy if exists "kpi rules manager write" on public.kpi_rules;
create policy "kpi rules manager write" on public.kpi_rules
for all to authenticated
using (public.crm_is_manager())
with check (public.crm_is_manager());

-- kpi_proposals
drop policy if exists "kpi proposals owner or manager read" on public.kpi_proposals;
create policy "kpi proposals owner or manager read" on public.kpi_proposals
for select to authenticated
using (
  public.crm_is_manager()
  or lower(coalesce(owner_email, email, created_by_email, '')) = public.crm_current_email()
);

drop policy if exists "kpi proposals active users insert own pending" on public.kpi_proposals;
create policy "kpi proposals active users insert own pending" on public.kpi_proposals
for insert to authenticated
with check (
  public.crm_is_active_user()
  and lower(coalesce(owner_email, email, created_by_email, '')) = public.crm_current_email()
  and lower(coalesce(status, 'pending')) = 'pending'
);

drop policy if exists "kpi proposals owner edit own pending" on public.kpi_proposals;
create policy "kpi proposals owner edit own pending" on public.kpi_proposals
for update to authenticated
using (
  lower(coalesce(owner_email, email, created_by_email, '')) = public.crm_current_email()
  and lower(coalesce(status, 'pending')) = 'pending'
)
with check (
  lower(coalesce(owner_email, email, created_by_email, '')) = public.crm_current_email()
  and lower(coalesce(status, 'pending')) = 'pending'
);

drop policy if exists "kpi proposals manager review" on public.kpi_proposals;
create policy "kpi proposals manager review" on public.kpi_proposals
for update to authenticated
using (public.crm_is_manager())
with check (public.crm_is_manager());

drop policy if exists "kpi proposals admin delete" on public.kpi_proposals;
create policy "kpi proposals admin delete" on public.kpi_proposals
for delete to authenticated
using (public.crm_is_admin());

-- phone_index
drop policy if exists "phone index manager or owner read" on public.phone_index;
create policy "phone index manager or owner read" on public.phone_index
for select to authenticated
using (
  public.crm_is_manager()
  or lower(coalesce(owner_email, '')) = public.crm_current_email()
);

drop policy if exists "phone index manager or owner write" on public.phone_index;
create policy "phone index manager or owner write" on public.phone_index
for all to authenticated
using (
  public.crm_is_manager()
  or lower(coalesce(owner_email, '')) = public.crm_current_email()
)
with check (
  public.crm_is_manager()
  or lower(coalesce(owner_email, '')) = public.crm_current_email()
);

-- audit_logs
drop policy if exists "audit logs active users insert own" on public.audit_logs;
create policy "audit logs active users insert own" on public.audit_logs
for insert to authenticated
with check (
  public.crm_is_active_user()
  and lower(coalesce(email, '')) = public.crm_current_email()
);

drop policy if exists "audit logs self or manager read" on public.audit_logs;
create policy "audit logs self or manager read" on public.audit_logs
for select to authenticated
using (
  public.crm_is_manager()
  or lower(coalesce(email, '')) = public.crm_current_email()
);

drop policy if exists "audit logs admin delete" on public.audit_logs;
create policy "audit logs admin delete" on public.audit_logs
for delete to authenticated
using (public.crm_is_admin());

-- user_sessions
drop policy if exists "user sessions self write" on public.user_sessions;
create policy "user sessions self write" on public.user_sessions
for all to authenticated
using (
  public.crm_is_manager()
  or lower(coalesce(email, '')) = public.crm_current_email()
)
with check (
  lower(coalesce(email, '')) = public.crm_current_email()
);

drop policy if exists "user sessions self or manager read" on public.user_sessions;
create policy "user sessions self or manager read" on public.user_sessions
for select to authenticated
using (
  public.crm_is_manager()
  or lower(coalesce(email, '')) = public.crm_current_email()
);

-- ---------------------------------------------------------------------------
-- 3. Legacy ERP/CMS tables: archive read-only for owner/admin
-- ---------------------------------------------------------------------------

-- These tables are no longer part of daily CRM operations.
-- They stay in the database only to avoid data loss and to support manual archive review.

create or replace function public.crm_archive_table_owner_admin(p_table regclass, p_policy_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy text;
  v_schema text;
  v_table text;
begin
  select n.nspname, c.relname
    into v_schema, v_table
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.oid = p_table;

  execute format('revoke all on %s from authenticated', p_table);
  execute format('grant select on %s to authenticated', p_table);
  execute format('alter table %s enable row level security', p_table);

  for v_policy in
    select policyname
    from pg_policies
    where schemaname = v_schema
      and tablename = v_table
  loop
    execute format('drop policy if exists %I on %s', v_policy, p_table);
  end loop;

  execute format(
    'create policy %I on %s for select to authenticated using (public.crm_is_admin())',
    p_policy_name,
    p_table
  );
end;
$$;

do $$
declare
  v_table text;
  v_reg regclass;
begin
  foreach v_table in array array[
    'products',
    'quotes',
    'quote_items',
    'order_items',
    'payments',
    'inventory_movements',
    'website_pages',
    'website_sections'
  ]
  loop
    v_reg := to_regclass('public.' || v_table);
    if v_reg is not null then
      perform public.crm_archive_table_owner_admin(
        v_reg,
        'legacy ' || replace(v_table, '_', ' ') || ' owner admin read archive'
      );
    end if;
  end loop;
end $$;

drop function if exists public.crm_archive_table_owner_admin(regclass, text);

-- Optional view from ERP phase should not be used by regular CRM users.
do $$
begin
  if to_regclass('public.product_inventory_balance') is not null then
    revoke all on public.product_inventory_balance from authenticated;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Storage: KPI evidence remains active
-- ---------------------------------------------------------------------------

-- Keep KPI evidence upload/read policies from Phase 1. They are still in CRM scope.
-- Do not add service_role_key to frontend. Do not commit storage secrets.

commit;
