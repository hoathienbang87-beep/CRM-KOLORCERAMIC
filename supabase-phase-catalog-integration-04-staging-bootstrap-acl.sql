-- CATALOG INTEGRATION 04 — cloud staging bootstrap ACL hardening.
-- Approved by the user for Prompt 04 on 2026-09-24.
-- This migration is intentionally limited to the empty cloud staging baseline
-- and must run before catalog integration migration 01B.

begin;

select pg_advisory_xact_lock(hashtext('CATALOG-INTEGRATION-04-STAGING-BOOTSTRAP-ACL'));

-- Fail closed outside the newly provisioned, empty Product R2 staging schema.
do $$
declare
  v_missing text;
begin
  select string_agg(required_table, ', ' order by required_table)
    into v_missing
  from unnest(array[
    'public.app_users',
    'public.audit_logs',
    'public.customers',
    'public.products',
    'public.product_import_batches',
    'public.product_import_rows',
    'public.product_price_history',
    'public.quote_items'
  ]) as required(required_table)
  where to_regclass(required_table) is null;

  if v_missing is not null then
    raise exception 'CATALOG_04_STAGING_ACL_PRECONDITION_FAIL: missing baseline tables: %', v_missing;
  end if;

  if to_regclass('public.product_source_mappings') is not null
     or to_regclass('public.website_leads') is not null
     or exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'products'
         and column_name in ('width_mm', 'height_mm', 'data_status', 'is_published')
     ) then
    raise exception 'CATALOG_04_STAGING_ACL_PRECONDITION_FAIL: 01B is already applied or partially applied.';
  end if;

  if exists (select 1 from public.app_users)
     or exists (select 1 from public.audit_logs)
     or exists (select 1 from public.customers)
     or exists (select 1 from public.products)
     or exists (select 1 from public.product_import_batches)
     or exists (select 1 from public.product_import_rows)
     or exists (select 1 from public.product_price_history)
     or exists (select 1 from public.quote_items) then
    raise exception 'CATALOG_04_STAGING_ACL_PRECONDITION_FAIL: staging baseline must be empty.';
  end if;
end;
$$;

-- The production schema-only baseline carries legacy default grants for newly
-- created public tables. Remove only those defaults; explicit grants on
-- existing non-catalog tables remain untouched.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

-- Harden the existing Product R2 catalog tables without changing the baseline
-- read grants required by current authenticated CRM consumers.
revoke all on table public.products from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.products from authenticated;

revoke all on table
  public.product_import_batches,
  public.product_import_rows,
  public.product_price_history
from anon;

revoke insert, update, delete, truncate, references, trigger
  on table
    public.product_import_batches,
    public.product_import_rows,
    public.product_price_history
from authenticated;

-- Verify effective privileges and the default ACL rather than trusting the
-- migration statements alone.
do $$
begin
  if has_table_privilege('anon', 'public.products', 'SELECT')
     or has_table_privilege('anon', 'public.products', 'INSERT')
     or has_table_privilege('anon', 'public.products', 'UPDATE')
     or has_table_privilege('anon', 'public.products', 'DELETE')
     or has_table_privilege('anon', 'public.product_import_batches', 'SELECT')
     or has_table_privilege('anon', 'public.product_import_rows', 'SELECT')
     or has_table_privilege('anon', 'public.product_price_history', 'SELECT') then
    raise exception 'CATALOG_04_STAGING_ACL_VERIFY_FAIL: anon retains direct catalog table access.';
  end if;

  if has_table_privilege('authenticated', 'public.products', 'INSERT')
     or has_table_privilege('authenticated', 'public.products', 'UPDATE')
     or has_table_privilege('authenticated', 'public.products', 'DELETE')
     or has_table_privilege('authenticated', 'public.product_import_batches', 'INSERT')
     or has_table_privilege('authenticated', 'public.product_import_rows', 'INSERT')
     or has_table_privilege('authenticated', 'public.product_price_history', 'INSERT') then
    raise exception 'CATALOG_04_STAGING_ACL_VERIFY_FAIL: authenticated retains direct catalog write access.';
  end if;

  if exists (
    select 1
    from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole
      and d.defaclnamespace = 'public'::regnamespace
      and d.defaclobjtype = 'r'
      and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
  ) then
    raise exception 'CATALOG_04_STAGING_ACL_VERIFY_FAIL: unsafe public table default privileges remain.';
  end if;
end;
$$;

commit;
