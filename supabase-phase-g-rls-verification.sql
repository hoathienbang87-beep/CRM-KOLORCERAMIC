-- CRM KOLORCERAMIC - Phase G verification queries
-- Created: 2026-07-08
--
-- Purpose:
-- - Read-only checks after running supabase-phase-f-crm-rls-cleanup.sql.
-- - Safe to run in Supabase SQL Editor.
-- - No data changes.

-- 1. Current auth context.
select
  auth.email() as auth_email,
  public.crm_current_email() as crm_email,
  public.crm_current_user_role() as crm_role,
  public.crm_is_active_user() as is_active,
  public.crm_is_manager() as is_manager,
  public.crm_is_admin() as is_admin;

-- 2. Core CRM tables should have RLS enabled.
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'app_users',
    'settings',
    'company_settings',
    'customers',
    'care_logs',
    'deals',
    'kpi_rules',
    'kpi_proposals',
    'phone_index',
    'audit_logs',
    'user_sessions'
  )
order by tablename;

-- 3. Legacy ERP/CMS tables should be archive-only.
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'products',
    'quotes',
    'quote_items',
    'order_items',
    'payments',
    'inventory_movements',
    'website_pages',
    'website_sections'
  )
order by tablename;

-- 4. Policy overview for CRM and legacy tables.
select
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'app_users',
    'settings',
    'company_settings',
    'customers',
    'care_logs',
    'deals',
    'kpi_rules',
    'kpi_proposals',
    'phone_index',
    'audit_logs',
    'user_sessions',
    'products',
    'quotes',
    'quote_items',
    'order_items',
    'payments',
    'inventory_movements',
    'website_pages',
    'website_sections'
  )
order by tablename, policyname;

-- 5. Legacy tables should only have archive select policies after Phase F.
select
  tablename,
  count(*) filter (where cmd = 'SELECT') as select_policies,
  count(*) filter (where cmd <> 'SELECT') as write_policies
from pg_policies
where schemaname = 'public'
  and tablename in (
    'products',
    'quotes',
    'quote_items',
    'order_items',
    'payments',
    'inventory_movements',
    'website_pages',
    'website_sections'
  )
group by tablename
order by tablename;

-- 6. Quick row counts for data awareness.
select 'customers' as table_name, count(*) as row_count from public.customers
union all select 'care_logs', count(*) from public.care_logs
union all select 'deals', count(*) from public.deals
union all select 'kpi_rules', count(*) from public.kpi_rules
union all select 'kpi_proposals', count(*) from public.kpi_proposals
union all select 'audit_logs', count(*) from public.audit_logs
union all select 'app_users', count(*) from public.app_users
order by table_name;
