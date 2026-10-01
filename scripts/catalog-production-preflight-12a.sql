-- Prompt 12A production preflight. READ-ONLY by construction.
-- Run only after independently proving the connection targets
-- Supabase production ref jjeeazwlqcwynzquimeo.
begin transaction read only;

select
  current_database() as database_name,
  current_user as database_user,
  current_setting('server_version') as server_version,
  now() as checked_at;

with required_objects(object_name) as (
  values
    ('public.products'),
    ('public.quote_items'),
    ('public.product_import_batches'),
    ('public.product_import_rows'),
    ('public.product_price_history'),
    ('public.app_users'),
    ('public.audit_logs'),
    ('public.customers'),
    ('public.phone_index')
)
select object_name, to_regclass(object_name) is not null as present
from required_objects
order by object_name;

select
  to_regprocedure('public.crm_current_app_user_id()') is not null as has_current_app_user,
  to_regprocedure('public.crm_is_active_user()') is not null as has_active_user_guard,
  to_regprocedure('public.crm_current_user_role()') is not null as has_role_guard,
  to_regprocedure('public.crm_write_audit(text,text,text,jsonb)') is not null as has_audit_writer,
  to_regprocedure('public.crm_create_customer(jsonb)') is not null as has_customer_create,
  to_regprocedure('public.crm_update_customer_profile(text,jsonb)') is not null as has_customer_update;

select
  to_regclass('public.product_source_mappings') is not null as product_source_mappings_exists,
  to_regclass('public.website_leads') is not null as website_leads_exists,
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='products'
      and column_name in ('width_mm','height_mm','data_status','is_published')
  ) as catalog_columns_present,
  to_regprocedure('public.catalog_public_list_products(text,integer,integer)') is not null as catalog_02b_present,
  to_regprocedure('public.catalog_admin_approve_import(uuid,uuid)') is not null as catalog_03b_present,
  to_regprocedure('public.catalog_public_list_products_v1(text,text,text,text,integer,integer,numeric,numeric,integer,integer)') is not null as catalog_05a_present,
  to_regprocedure('public.catalog_submit_website_lead_v1(jsonb)') is not null as catalog_05b_present,
  to_regprocedure('public.catalog_admin_list_products_v1(text,text,boolean,boolean,integer,integer)') is not null as catalog_06a_present,
  to_regprocedure('public.catalog_admin_list_import_batches_v1(text,integer,integer)') is not null as catalog_06b_present;

select
  count(*) as product_count,
  count(*) filter (where active) as active_product_count,
  count(*) filter (where code is null) as product_code_null_count,
  count(*) filter (where width_cm is null or height_cm is null) as missing_legacy_size_count,
  count(*) filter (where price_per_m2 is null) as missing_price_count
from public.products;

select
  count(*) filter (
    where width_cm is not null and (
      width_cm <= 0
      or width_cm * 10 <> trunc(width_cm * 10)
      or width_cm * 10 > 2147483647
    )
  ) as invalid_width_conversion_count,
  count(*) filter (
    where height_cm is not null and (
      height_cm <= 0
      or height_cm * 10 <> trunc(height_cm * 10)
      or height_cm * 10 > 2147483647
    )
  ) as invalid_height_conversion_count
from public.products;

select 'quote_items' as entity, count(*) as row_count from public.quote_items
union all select 'product_import_batches', count(*) from public.product_import_batches
union all select 'product_import_rows', count(*) from public.product_import_rows
union all select 'product_price_history', count(*) from public.product_price_history
union all select 'app_users', count(*) from public.app_users
union all select 'customers', count(*) from public.customers
union all select 'audit_logs', count(*) from public.audit_logs
order by entity;

rollback;
