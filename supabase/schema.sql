-- Supabase CRM schema migrated from Firestore.
-- Run this in Supabase SQL Editor before running the migration script.

create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id text primary key,
  supabase_auth_id uuid,
  email text unique,
  name text,
  role text default 'sale',
  active boolean default false,
  can_export boolean default false,
  team text,
  phone text,
  created_at timestamptz,
  updated_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb
);

create or replace function public.crm_current_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.crm_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce((
    select role from public.app_users
    where lower(email) = public.crm_current_email()
      and active = true
    limit 1
  ), ''));
$$;

create or replace function public.crm_is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.crm_current_role() in ('admin', 'manager', 'quanly', 'quản lý', 'quản lí');
$$;

create table if not exists public.settings (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  raw_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz
);

create table if not exists public.customers (
  id text primary key,
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
  created_at timestamptz,
  updated_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb
);

create unique index if not exists customers_phone_normalized_unique
on public.customers(phone_normalized)
where phone_normalized is not null and phone_normalized <> '' and is_deleted = false;

create index if not exists customers_owner_email_idx on public.customers(lower(owner_email));
create index if not exists customers_created_by_email_idx on public.customers(lower(created_by_email));
create index if not exists customers_channel_idx on public.customers(channel);
create index if not exists customers_created_at_idx on public.customers(created_at);

create table if not exists public.care_logs (
  id text primary key,
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
  created_at timestamptz,
  updated_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb
);

create index if not exists care_logs_customer_id_idx on public.care_logs(customer_id);
create index if not exists care_logs_owner_email_idx on public.care_logs(lower(owner_email));
create index if not exists care_logs_created_at_idx on public.care_logs(created_at);

create table if not exists public.deals (
  id text primary key,
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
  created_at timestamptz,
  updated_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb
);

create index if not exists deals_customer_id_idx on public.deals(customer_id);
create index if not exists deals_owner_email_idx on public.deals(lower(owner_email));
create index if not exists deals_created_at_idx on public.deals(created_at);

create table if not exists public.products (
  id text primary key,
  name text,
  sku text,
  price numeric,
  unit text,
  active boolean default true,
  created_at timestamptz,
  updated_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb
);

create table if not exists public.kpi_rules (
  id text primary key,
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
  created_at timestamptz,
  updated_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb
);

create index if not exists kpi_rules_month_idx on public.kpi_rules(month);

create table if not exists public.kpi_proposals (
  id text primary key,
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
  created_at timestamptz,
  updated_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb
);

create index if not exists kpi_proposals_rule_idx on public.kpi_proposals(kpi_rule_id);
create index if not exists kpi_proposals_owner_email_idx on public.kpi_proposals(lower(owner_email));
create index if not exists kpi_proposals_customer_id_idx on public.kpi_proposals(customer_id);
create index if not exists kpi_proposals_month_idx on public.kpi_proposals(month);

create table if not exists public.phone_index (
  phone text primary key,
  customer_id text,
  owner text,
  owner_email text,
  raw_data jsonb not null default '{}'::jsonb
);

create table if not exists public.audit_logs (
  id text primary key,
  action text,
  entity text,
  entity_id text,
  email text,
  payload_json text,
  created_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb
);

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

drop policy if exists "users read self or manager" on public.app_users;
create policy "users read self or manager" on public.app_users
for select using (public.crm_is_manager() or lower(email) = public.crm_current_email());

drop policy if exists "users manager writes" on public.app_users;
create policy "users manager writes" on public.app_users
for all using (public.crm_current_role() = 'admin') with check (public.crm_current_role() = 'admin');

drop policy if exists "settings active read" on public.settings;
create policy "settings active read" on public.settings
for select using (public.crm_current_email() <> '');

drop policy if exists "settings manager write" on public.settings;
create policy "settings manager write" on public.settings
for all using (public.crm_is_manager()) with check (public.crm_is_manager());

drop policy if exists "customers scoped read" on public.customers;
create policy "customers scoped read" on public.customers
for select using (
  public.crm_is_manager()
  or lower(owner_email) = public.crm_current_email()
  or lower(created_by_email) = public.crm_current_email()
);

drop policy if exists "customers scoped write" on public.customers;
create policy "customers scoped write" on public.customers
for all using (
  public.crm_is_manager()
  or lower(owner_email) = public.crm_current_email()
  or lower(created_by_email) = public.crm_current_email()
) with check (
  public.crm_is_manager()
  or lower(owner_email) = public.crm_current_email()
  or lower(created_by_email) = public.crm_current_email()
);

drop policy if exists "care logs scoped" on public.care_logs;
create policy "care logs scoped" on public.care_logs
for all using (public.crm_is_manager() or lower(owner_email) = public.crm_current_email())
with check (public.crm_is_manager() or lower(owner_email) = public.crm_current_email());

drop policy if exists "deals scoped" on public.deals;
create policy "deals scoped" on public.deals
for all using (public.crm_is_manager() or lower(owner_email) = public.crm_current_email())
with check (public.crm_is_manager() or lower(owner_email) = public.crm_current_email());

drop policy if exists "products active read" on public.products;
create policy "products active read" on public.products
for select using (public.crm_current_email() <> '');

drop policy if exists "products manager write" on public.products;
create policy "products manager write" on public.products
for all using (public.crm_is_manager()) with check (public.crm_is_manager());

drop policy if exists "kpi rules active read" on public.kpi_rules;
create policy "kpi rules active read" on public.kpi_rules
for select using (public.crm_current_email() <> '');

drop policy if exists "kpi rules manager write" on public.kpi_rules;
create policy "kpi rules manager write" on public.kpi_rules
for all using (public.crm_is_manager()) with check (public.crm_is_manager());

drop policy if exists "kpi proposals scoped" on public.kpi_proposals;
create policy "kpi proposals scoped" on public.kpi_proposals
for all using (
  public.crm_is_manager()
  or lower(owner_email) = public.crm_current_email()
  or lower(email) = public.crm_current_email()
) with check (
  public.crm_is_manager()
  or lower(owner_email) = public.crm_current_email()
  or lower(email) = public.crm_current_email()
);

drop policy if exists "phone index active read" on public.phone_index;
create policy "phone index active read" on public.phone_index
for select using (public.crm_current_email() <> '');

drop policy if exists "phone index scoped write" on public.phone_index;
create policy "phone index scoped write" on public.phone_index
for all using (public.crm_is_manager() or lower(owner_email) = public.crm_current_email())
with check (public.crm_is_manager() or lower(owner_email) = public.crm_current_email());

drop policy if exists "audit logs manager read" on public.audit_logs;
create policy "audit logs manager read" on public.audit_logs
for select using (public.crm_is_manager());

drop policy if exists "audit logs active insert" on public.audit_logs;
create policy "audit logs active insert" on public.audit_logs
for insert with check (lower(email) = public.crm_current_email());
