-- Prompt 02A verification after executing the approved rollback companion.
\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.product_source_mappings') is not null
     or to_regclass('public.website_leads') is not null then
    raise exception 'CATALOG_02A_ROLLBACK_TEST_FAIL: new tables remain.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='products'
      and column_name in (
        'name_normalized','width_mm','height_mm','surface_normalized','color','category',
        'collection','description','image_url','gallery_urls','pdf_url','video_url',
        'more_info_url','price_unit','data_status','is_published','source_metadata'
      )
  ) then
    raise exception 'CATALOG_02A_ROLLBACK_TEST_FAIL: Product catalog columns remain.';
  end if;

  if to_regprocedure('public.crm_catalog_sync_dimensions_01b()') is not null
     or to_regprocedure('public.crm_catalog_https_url_array_01b(jsonb)') is not null then
    raise exception 'CATALOG_02A_ROLLBACK_TEST_FAIL: 01B functions remain.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='products'
      and column_name in ('code','code_normalized','width_cm','height_cm','price_per_m2','price_effective_date')
      and is_nullable <> 'NO'
  ) then
    raise exception 'CATALOG_02A_ROLLBACK_TEST_FAIL: baseline NOT NULL was not restored.';
  end if;

  if (select count(*) from public.products) <> 75
     or (select count(*) from public.quote_items) <> 1 then
    raise exception 'CATALOG_02A_ROLLBACK_TEST_FAIL: baseline row counts changed.';
  end if;

  if to_regprocedure('public.crm_list_products()') is null
     or to_regprocedure('public.crm_create_product(jsonb)') is null
     or to_regprocedure('public.crm_update_product(uuid,bigint,jsonb)') is null then
    raise exception 'CATALOG_02A_ROLLBACK_TEST_FAIL: baseline CRM RPC missing.';
  end if;
end;
$$;

select 'CATALOG_02A_LOCAL_ROLLBACK_PASS' as result;
