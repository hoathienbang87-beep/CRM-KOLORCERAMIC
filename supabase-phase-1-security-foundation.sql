-- CRM KOLORCERAMIC - Phase 1 security foundation
-- Created: 2026-06-29
--
-- Purpose:
-- 1. Create/normalize the core Supabase tables used by the current static CRM.
-- 2. Add common helper functions for role checks.
-- 3. Enable RLS for all business tables.
-- 4. Add role-based policies for admin / manager / sale.
-- 5. Keep compatibility with the current frontend adapter in js/firebase.js.
--
-- How to run:
-- - Run this file in Supabase SQL Editor after taking a backup.
-- - It is designed to be idempotent: safe to run more than once.
-- - It does not delete business data.
--
-- Important:
-- - This file assumes Supabase Auth is the login source.
-- - app_users.email must match auth.users.email.
-- - app_users.active must be true/active/1 for a user to access CRM data.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Core tables and compatibility columns
-- ---------------------------------------------------------------------------

create table if not exists public.app_users (
  id text primary key default gen_random_uuid()::text,
  email text unique,
  name text,
  role text default 'sale',
  active boolean default false,
  can_export boolean default false,
  team text,
  phone text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.settings (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  raw_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.customers (
  id text primary key default gen_random_uuid()::text,
  name text,
  company_name text,
  phone_raw text,
  phone_normalized text,
  no_phone boolean default false,
  address text,
  channel text,
  owner text,
  owner_email text,
  created_by_email text,
  status text,
  follow text,
  next_care_date timestamptz,
  last_contact_at timestamptz,
  note text,
  need text,
  is_deleted boolean default false,
  deleted_at timestamptz,
  deleted_by_email text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.care_logs (
  id text primary key default gen_random_uuid()::text,
  customer_id text,
  customer_name text,
  phone_normalized text,
  phone_raw text,
  owner text,
  owner_email text,
  created_by_email text,
  status text,
  follow text,
  care_channel text,
  care_result text,
  next_care_date timestamptz,
  note text,
  is_deleted boolean default false,
  deleted_at timestamptz,
  deleted_by_email text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.deals (
  id text primary key default gen_random_uuid()::text,
  customer_id text,
  customer_name text,
  phone_normalized text,
  phone_raw text,
  owner text,
  owner_email text,
  deal_status text,
  product text,
  items_text text,
  amount numeric,
  revenue numeric,
  completed boolean default false,
  completed_at timestamptz,
  canceled boolean default false,
  canceled_at timestamptz,
  note text,
  is_deleted boolean default false,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.products (
  id text primary key default gen_random_uuid()::text,
  name text,
  sku text,
  price numeric,
  unit text,
  active boolean default true,
  is_deleted boolean default false,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.kpi_rules (
  id text primary key default gen_random_uuid()::text,
  month text,
  name text,
  description text,
  target numeric,
  count_mode text,
  assigned_owners jsonb not null default '[]'::jsonb,
  owner_targets jsonb not null default '{}'::jsonb,
  active boolean default true,
  created_by_email text,
  updated_by_email text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.kpi_proposals (
  id text primary key default gen_random_uuid()::text,
  kpi_rule_id text,
  kpi_name text,
  month text,
  owner text,
  owner_email text,
  email text,
  phone text,
  department text,
  customer_id text,
  customer_name text,
  customer_phone text,
  customer_company_name text,
  customer_channel text,
  content text,
  evidence_url text,
  status text default 'pending',
  review_note text,
  reviewed_by_email text,
  reviewed_at timestamptz,
  is_deleted boolean default false,
  deleted_by_email text,
  deleted_at timestamptz,
  created_by_email text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.phone_index (
  phone text primary key,
  customer_id text,
  owner text,
  owner_email text,
  raw_data jsonb not null default '{}'::jsonb
);

create table if not exists public.audit_logs (
  id text primary key default gen_random_uuid()::text,
  action text,
  entity text,
  entity_id text,
  email text,
  payload_json text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.user_sessions (
  id text primary key,
  email text,
  name text,
  role text,
  online boolean default false,
  last_seen_at timestamptz,
  updated_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb
);

-- Add compatibility columns when tables already existed.
alter table public.app_users add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.app_users add column if not exists can_export boolean default false;
alter table public.app_users add column if not exists team text;
alter table public.app_users add column if not exists phone text;
alter table public.app_users add column if not exists created_at timestamptz default now();
alter table public.app_users add column if not exists updated_at timestamptz default now();

alter table public.settings add column if not exists data jsonb not null default '{}'::jsonb;
alter table public.settings add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.settings add column if not exists updated_at timestamptz default now();

alter table public.customers add column if not exists company_name text;
alter table public.customers add column if not exists created_by_email text;
alter table public.customers add column if not exists is_deleted boolean default false;
alter table public.customers add column if not exists deleted_at timestamptz;
alter table public.customers add column if not exists deleted_by_email text;
alter table public.customers add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.customers add column if not exists created_at timestamptz default now();
alter table public.customers add column if not exists updated_at timestamptz default now();

alter table public.care_logs add column if not exists created_by_email text;
alter table public.care_logs add column if not exists is_deleted boolean default false;
alter table public.care_logs add column if not exists deleted_at timestamptz;
alter table public.care_logs add column if not exists deleted_by_email text;
alter table public.care_logs add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.care_logs add column if not exists created_at timestamptz default now();
alter table public.care_logs add column if not exists updated_at timestamptz default now();

alter table public.deals add column if not exists is_deleted boolean default false;
alter table public.deals add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.deals add column if not exists created_at timestamptz default now();
alter table public.deals add column if not exists updated_at timestamptz default now();

alter table public.products add column if not exists is_deleted boolean default false;
alter table public.products add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.products add column if not exists created_at timestamptz default now();
alter table public.products add column if not exists updated_at timestamptz default now();

alter table public.kpi_rules add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.kpi_rules add column if not exists created_at timestamptz default now();
alter table public.kpi_rules add column if not exists updated_at timestamptz default now();

alter table public.kpi_proposals add column if not exists is_deleted boolean default false;
alter table public.kpi_proposals add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.kpi_proposals add column if not exists created_at timestamptz default now();
alter table public.kpi_proposals add column if not exists updated_at timestamptz default now();

alter table public.audit_logs add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.audit_logs add column if not exists created_at timestamptz default now();

-- ---------------------------------------------------------------------------
-- 2. Helper functions
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

create or replace function public.crm_is_manager()
returns boolean
language sql
stable
as $$
  select public.crm_current_user_role() in ('admin', 'manager', 'quanly', 'quản lý', 'quản lí');
$$;

create or replace function public.crm_is_admin()
returns boolean
language sql
stable
as $$
  select public.crm_current_user_role() = 'admin';
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
grant execute on function public.crm_is_manager() to authenticated;
grant execute on function public.crm_is_admin() to authenticated;
grant execute on function public.crm_is_owner(text, text) to authenticated;
grant execute on function public.crm_can_access_customer_id(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------

create unique index if not exists app_users_email_unique_idx on public.app_users(lower(email));
create index if not exists app_users_role_idx on public.app_users(lower(role));
create index if not exists app_users_active_idx on public.app_users(active);

create index if not exists customers_owner_email_idx on public.customers(lower(owner_email));
create index if not exists customers_created_by_email_idx on public.customers(lower(created_by_email));
create index if not exists customers_phone_normalized_idx on public.customers(phone_normalized);
create index if not exists customers_created_at_idx on public.customers(created_at);
create index if not exists customers_is_deleted_idx on public.customers(is_deleted);

create index if not exists care_logs_customer_id_idx on public.care_logs(customer_id);
create index if not exists care_logs_owner_email_idx on public.care_logs(lower(owner_email));
create index if not exists care_logs_created_at_idx on public.care_logs(created_at);

create index if not exists deals_customer_id_idx on public.deals(customer_id);
create index if not exists deals_owner_email_idx on public.deals(lower(owner_email));
create index if not exists deals_created_at_idx on public.deals(created_at);
create index if not exists deals_completed_at_idx on public.deals(completed_at);

create index if not exists products_name_idx on public.products(lower(name));
create index if not exists products_sku_idx on public.products(lower(sku));

create index if not exists kpi_rules_active_idx on public.kpi_rules(active);
create index if not exists kpi_rules_month_idx on public.kpi_rules(month);
create index if not exists kpi_proposals_owner_email_idx on public.kpi_proposals(lower(owner_email));
create index if not exists kpi_proposals_status_idx on public.kpi_proposals(lower(status));
create index if not exists kpi_proposals_created_at_idx on public.kpi_proposals(created_at);

create index if not exists audit_logs_email_idx on public.audit_logs(lower(email));
create index if not exists audit_logs_created_at_idx on public.audit_logs(created_at);

create index if not exists user_sessions_online_idx on public.user_sessions(online);
create index if not exists user_sessions_last_seen_at_idx on public.user_sessions(last_seen_at);
create index if not exists user_sessions_email_idx on public.user_sessions(lower(email));

-- ---------------------------------------------------------------------------
-- 4. Grants and RLS
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.app_users,
  public.settings,
  public.customers,
  public.care_logs,
  public.deals,
  public.products,
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
alter table public.products enable row level security;
alter table public.kpi_rules enable row level security;
alter table public.kpi_proposals enable row level security;
alter table public.phone_index enable row level security;
alter table public.audit_logs enable row level security;
alter table public.user_sessions enable row level security;

-- ---------------------------------------------------------------------------
-- 5. Drop legacy policies from older standalone SQL files
-- ---------------------------------------------------------------------------

drop policy if exists "app users read own or manager" on public.app_users;
drop policy if exists "app users create own inactive profile" on public.app_users;

drop policy if exists "audit logs active users insert" on public.audit_logs;
drop policy if exists "audit logs user or manager read" on public.audit_logs;

drop policy if exists "kpi proposals active users insert own" on public.kpi_proposals;
drop policy if exists "kpi proposals owner edit pending" on public.kpi_proposals;
drop policy if exists "kpi proposals manager update review" on public.kpi_proposals;

drop policy if exists "user sessions manager read" on public.user_sessions;

drop policy if exists "kpi_evidence_authenticated_insert" on storage.objects;
drop policy if exists "kpi_evidence_authenticated_select" on storage.objects;

-- ---------------------------------------------------------------------------
-- 6. Policies: app_users
-- ---------------------------------------------------------------------------

drop policy if exists "app users read self or manager" on public.app_users;
create policy "app users read self or manager" on public.app_users
for select
to authenticated
using (
  lower(coalesce(email, '')) = public.crm_current_email()
  or public.crm_is_manager()
);

drop policy if exists "app users self create inactive" on public.app_users;
create policy "app users self create inactive" on public.app_users
for insert
to authenticated
with check (
  lower(coalesce(email, '')) = public.crm_current_email()
  and lower(coalesce(active::text, '')) in ('false', 'inactive', '0')
);

drop policy if exists "app users admin update" on public.app_users;
create policy "app users admin update" on public.app_users
for update
to authenticated
using (public.crm_is_admin())
with check (public.crm_is_admin());

drop policy if exists "app users admin delete" on public.app_users;
create policy "app users admin delete" on public.app_users
for delete
to authenticated
using (public.crm_is_admin());

-- ---------------------------------------------------------------------------
-- 7. Policies: settings
-- ---------------------------------------------------------------------------

drop policy if exists "settings active users read" on public.settings;
create policy "settings active users read" on public.settings
for select
to authenticated
using (public.crm_is_active_user());

drop policy if exists "settings admin write" on public.settings;
create policy "settings admin write" on public.settings
for all
to authenticated
using (public.crm_is_admin())
with check (public.crm_is_admin());

-- ---------------------------------------------------------------------------
-- 8. Policies: customers
-- ---------------------------------------------------------------------------

drop policy if exists "customers manager or owner read" on public.customers;
create policy "customers manager or owner read" on public.customers
for select
to authenticated
using (
  public.crm_is_manager()
  or public.crm_is_owner(owner_email, created_by_email)
);

drop policy if exists "customers manager or owner insert" on public.customers;
create policy "customers manager or owner insert" on public.customers
for insert
to authenticated
with check (
  public.crm_is_active_user()
  and (
    public.crm_is_manager()
    or public.crm_is_owner(owner_email, created_by_email)
  )
);

drop policy if exists "customers manager or owner update" on public.customers;
create policy "customers manager or owner update" on public.customers
for update
to authenticated
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
for delete
to authenticated
using (public.crm_is_admin());

-- ---------------------------------------------------------------------------
-- 9. Policies: care_logs
-- ---------------------------------------------------------------------------

drop policy if exists "care logs manager or owner read" on public.care_logs;
create policy "care logs manager or owner read" on public.care_logs
for select
to authenticated
using (
  public.crm_is_manager()
  or public.crm_is_owner(owner_email, created_by_email)
  or public.crm_can_access_customer_id(customer_id)
);

drop policy if exists "care logs manager or owner insert" on public.care_logs;
create policy "care logs manager or owner insert" on public.care_logs
for insert
to authenticated
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
for update
to authenticated
using (public.crm_is_admin())
with check (public.crm_is_admin());

drop policy if exists "care logs admin delete" on public.care_logs;
create policy "care logs admin delete" on public.care_logs
for delete
to authenticated
using (public.crm_is_admin());

-- ---------------------------------------------------------------------------
-- 10. Policies: deals
-- ---------------------------------------------------------------------------

drop policy if exists "deals manager or owner read" on public.deals;
create policy "deals manager or owner read" on public.deals
for select
to authenticated
using (
  public.crm_is_manager()
  or public.crm_is_owner(owner_email, null)
  or public.crm_can_access_customer_id(customer_id)
);

drop policy if exists "deals manager or owner insert" on public.deals;
create policy "deals manager or owner insert" on public.deals
for insert
to authenticated
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
for update
to authenticated
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
for delete
to authenticated
using (public.crm_is_admin());

-- ---------------------------------------------------------------------------
-- 11. Policies: products
-- ---------------------------------------------------------------------------

drop policy if exists "products active users read" on public.products;
create policy "products active users read" on public.products
for select
to authenticated
using (public.crm_is_active_user());

drop policy if exists "products manager write" on public.products;
create policy "products manager write" on public.products
for all
to authenticated
using (public.crm_is_manager())
with check (public.crm_is_manager());

-- ---------------------------------------------------------------------------
-- 12. Policies: kpi_rules
-- ---------------------------------------------------------------------------

drop policy if exists "kpi rules active users read" on public.kpi_rules;
create policy "kpi rules active users read" on public.kpi_rules
for select
to authenticated
using (public.crm_is_active_user());

drop policy if exists "kpi rules manager write" on public.kpi_rules;
create policy "kpi rules manager write" on public.kpi_rules
for all
to authenticated
using (public.crm_is_manager())
with check (public.crm_is_manager());

-- ---------------------------------------------------------------------------
-- 13. Policies: kpi_proposals
-- ---------------------------------------------------------------------------

drop policy if exists "kpi proposals owner or manager read" on public.kpi_proposals;
create policy "kpi proposals owner or manager read" on public.kpi_proposals
for select
to authenticated
using (
  public.crm_is_manager()
  or lower(coalesce(owner_email, email, created_by_email, '')) = public.crm_current_email()
);

drop policy if exists "kpi proposals active users insert own pending" on public.kpi_proposals;
create policy "kpi proposals active users insert own pending" on public.kpi_proposals
for insert
to authenticated
with check (
  public.crm_is_active_user()
  and lower(coalesce(owner_email, email, created_by_email, '')) = public.crm_current_email()
  and lower(coalesce(status, 'pending')) = 'pending'
  and coalesce(is_deleted, false) = false
);

drop policy if exists "kpi proposals owner edit own pending" on public.kpi_proposals;
create policy "kpi proposals owner edit own pending" on public.kpi_proposals
for update
to authenticated
using (
  lower(coalesce(owner_email, email, created_by_email, '')) = public.crm_current_email()
  and lower(coalesce(status, 'pending')) = 'pending'
  and coalesce(is_deleted, false) = false
)
with check (
  lower(coalesce(owner_email, email, created_by_email, '')) = public.crm_current_email()
  and lower(coalesce(status, 'pending')) = 'pending'
);

drop policy if exists "kpi proposals manager review" on public.kpi_proposals;
create policy "kpi proposals manager review" on public.kpi_proposals
for update
to authenticated
using (public.crm_is_manager())
with check (public.crm_is_manager());

drop policy if exists "kpi proposals admin delete" on public.kpi_proposals;
create policy "kpi proposals admin delete" on public.kpi_proposals
for delete
to authenticated
using (public.crm_is_admin());

-- ---------------------------------------------------------------------------
-- 14. Policies: phone_index
-- ---------------------------------------------------------------------------

drop policy if exists "phone index manager or owner read" on public.phone_index;
create policy "phone index manager or owner read" on public.phone_index
for select
to authenticated
using (
  public.crm_is_manager()
  or lower(coalesce(owner_email, '')) = public.crm_current_email()
);

drop policy if exists "phone index manager or owner write" on public.phone_index;
create policy "phone index manager or owner write" on public.phone_index
for all
to authenticated
using (
  public.crm_is_manager()
  or lower(coalesce(owner_email, '')) = public.crm_current_email()
)
with check (
  public.crm_is_manager()
  or lower(coalesce(owner_email, '')) = public.crm_current_email()
);

-- ---------------------------------------------------------------------------
-- 15. Policies: audit_logs
-- ---------------------------------------------------------------------------

drop policy if exists "audit logs active users insert own" on public.audit_logs;
create policy "audit logs active users insert own" on public.audit_logs
for insert
to authenticated
with check (
  public.crm_is_active_user()
  and lower(coalesce(email, '')) = public.crm_current_email()
);

drop policy if exists "audit logs self or manager read" on public.audit_logs;
create policy "audit logs self or manager read" on public.audit_logs
for select
to authenticated
using (
  public.crm_is_manager()
  or lower(coalesce(email, '')) = public.crm_current_email()
);

drop policy if exists "audit logs admin delete" on public.audit_logs;
create policy "audit logs admin delete" on public.audit_logs
for delete
to authenticated
using (public.crm_is_admin());

-- ---------------------------------------------------------------------------
-- 16. Policies: user_sessions
-- ---------------------------------------------------------------------------

drop policy if exists "user sessions self write" on public.user_sessions;
create policy "user sessions self write" on public.user_sessions
for all
to authenticated
using (
  public.crm_is_manager()
  or lower(coalesce(email, '')) = public.crm_current_email()
)
with check (
  lower(coalesce(email, '')) = public.crm_current_email()
);

drop policy if exists "user sessions self or manager read" on public.user_sessions;
create policy "user sessions self or manager read" on public.user_sessions
for select
to authenticated
using (
  public.crm_is_manager()
  or lower(coalesce(email, '')) = public.crm_current_email()
);

-- ---------------------------------------------------------------------------
-- 17. Storage for KPI evidence
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kpi-evidence',
  'kpi-evidence',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "kpi evidence authenticated insert own folder" on storage.objects;
create policy "kpi evidence authenticated insert own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'kpi-evidence'
  and public.crm_is_active_user()
  and (storage.foldername(name))[1] = regexp_replace(public.crm_current_email(), '[^a-z0-9._-]+', '-', 'g')
);

drop policy if exists "kpi evidence authenticated read" on storage.objects;
create policy "kpi evidence authenticated read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'kpi-evidence'
  and public.crm_is_active_user()
);

-- ---------------------------------------------------------------------------
-- 18. Realtime publication
-- ---------------------------------------------------------------------------

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'app_users',
    'settings',
    'customers',
    'care_logs',
    'deals',
    'products',
    'kpi_rules',
    'kpi_proposals',
    'phone_index',
    'audit_logs',
    'user_sessions'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    exception
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end loop;
end $$;

commit;

select 'OK: CRM KOLORCERAMIC phase 1 security foundation applied' as result;
