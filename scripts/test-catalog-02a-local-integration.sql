-- Prompt 02A schema read-back and legacy CRM compatibility test.
-- Target is guarded externally as supabase_db_local-product-r2.
\set ON_ERROR_STOP on

do $$
declare
  v_missing text;
begin
  if (select count(*) from public.products) <> 75 then
    raise exception 'CATALOG_02A_VERIFY_FAIL: expected 75 baseline Products.';
  end if;

  if exists (
    select 1 from public.products
    where width_mm <> width_cm * 10
       or height_mm <> height_cm * 10
       or data_status <> 'READY'
       or is_published
       or price_per_m2 is null
  ) then
    raise exception 'CATALOG_02A_VERIFY_FAIL: Product backfill/readiness mismatch.';
  end if;

  select string_agg(item, ', ' order by item) into v_missing
  from unnest(array[
    'products.name_normalized','products.width_mm','products.height_mm',
    'products.surface_normalized','products.gallery_urls','products.price_unit',
    'products.data_status','products.is_published','products.source_metadata',
    'product_import_batches.import_mode','product_import_batches.source_format',
    'product_import_rows.width_mm','product_import_rows.height_mm',
    'product_price_history.previous_price_per_m2',
    'quote_items.width_mm_snapshot','quote_items.height_mm_snapshot'
  ]) as required(item)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema='public'
      and c.table_name=split_part(item,'.',1)
      and c.column_name=split_part(item,'.',2)
  );
  if v_missing is not null then
    raise exception 'CATALOG_02A_VERIFY_FAIL: missing columns %', v_missing;
  end if;

  if to_regclass('public.product_source_mappings') is null
     or to_regclass('public.website_leads') is null then
    raise exception 'CATALOG_02A_VERIFY_FAIL: missing new tables.';
  end if;

  if to_regprocedure('public.crm_catalog_sync_dimensions_01b()') is null
     or to_regprocedure('public.crm_catalog_https_url_array_01b(jsonb)') is null then
    raise exception 'CATALOG_02A_VERIFY_FAIL: missing compatibility/validation functions.';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname='products_catalog_sync_dimensions_01b'
      and tgrelid='public.products'::regclass and not tgisinternal
  ) then
    raise exception 'CATALOG_02A_VERIFY_FAIL: missing dimension sync trigger.';
  end if;

  select string_agg(item, ', ' order by item) into v_missing
  from unnest(array[
    'products_catalog_public_idx','products_catalog_variant_lookup_idx',
    'products_catalog_status_idx','product_source_mappings_product_idx',
    'product_import_batches_catalog_mode_idx','product_import_rows_variant_lookup_idx',
    'product_import_rows_disposition_idx','product_price_history_rollback_idx',
    'website_leads_status_created_idx','website_leads_product_created_idx'
  ]) as required(item)
  where to_regclass('public.'||item) is null;
  if v_missing is not null then
    raise exception 'CATALOG_02A_VERIFY_FAIL: missing indexes %', v_missing;
  end if;

  select string_agg(item, ', ' order by item) into v_missing
  from unnest(array[
    'products_dimension_pairs_check','products_ready_completeness_check',
    'products_publish_gate_check','products_gallery_urls_check',
    'product_source_mappings_source_key','product_import_batches_import_mode_check',
    'product_import_rows_disposition_check','product_price_history_previous_price_check',
    'quote_items_dimension_snapshot_pair_check','website_leads_contact_method_check'
  ]) as required(item)
  where not exists (select 1 from pg_constraint where conname=item);
  if v_missing is not null then
    raise exception 'CATALOG_02A_VERIFY_FAIL: missing constraints %', v_missing;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='products'
      and column_name in ('code','code_normalized','width_cm','height_cm','price_per_m2','price_effective_date')
      and is_nullable <> 'YES'
  ) then
    raise exception 'CATALOG_02A_VERIFY_FAIL: approved Product draft columns remain NOT NULL.';
  end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('product_source_mappings','website_leads')
      and not c.relrowsecurity
  ) then
    raise exception 'CATALOG_02A_VERIFY_FAIL: RLS missing on private tables.';
  end if;

  if has_table_privilege('anon','public.products','SELECT')
     or has_table_privilege('anon','public.product_source_mappings','SELECT')
     or has_table_privilege('anon','public.website_leads','INSERT') then
    raise exception 'CATALOG_02A_VERIFY_FAIL: anon direct table privilege found.';
  end if;

  if (select count(*) from public.product_source_mappings) <> 0
     or (select count(*) from public.website_leads) <> 0 then
    raise exception 'CATALOG_02A_VERIFY_FAIL: schema test imported catalog/lead data.';
  end if;

  if (select count(*) from public.quote_items) <> 1
     or not exists (
       select 1 from public.quote_items
       where id='quote-item-1' and product_sku='SKU-1' and product_name='Legacy Product 1'
         and unit='m²' and unit_price=100000 and qty=2 and raw_data->>'snapshot'='true'
     ) then
    raise exception 'CATALOG_02A_VERIFY_FAIL: legacy quote snapshot changed.';
  end if;
end;
$$;

-- Exercise the existing Product R2 CRM RPCs. All mutations are rolled back.
begin;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
set local role authenticated;

do $$
declare
  v_created jsonb;
  v_updated jsonb;
  v_id uuid;
begin
  if jsonb_array_length(public.crm_list_products()) <> 75 then
    raise exception 'CATALOG_02A_COMPAT_FAIL: legacy CRM list count mismatch.';
  end if;

  v_created := public.crm_create_product(jsonb_build_object(
    'code','LOCAL-CRM-COMPAT-01','name','Local CRM Compatibility',
    'width_cm','60','height_cm','120','price_per_m2','1915000',
    'surface','MATT','price_effective_date','2026-09-23'
  ));
  v_id := (v_created->>'id')::uuid;

  if not exists (
    select 1 from public.products
    where id=v_id and width_mm=600 and height_mm=1200
      and data_status='READY' and price_per_m2=1915000 and not is_published
  ) then
    raise exception 'CATALOG_02A_COMPAT_FAIL: legacy create RPC did not dual-write catalog fields.';
  end if;

  v_updated := public.crm_update_product(v_id,1,jsonb_build_object('width_cm','61'));
  if (v_updated->>'version')::bigint <> 2
     or not exists (select 1 from public.products where id=v_id and width_cm=61 and width_mm=610) then
    raise exception 'CATALOG_02A_COMPAT_FAIL: legacy update RPC did not sync cm/mm.';
  end if;

  if jsonb_array_length(public.crm_list_product_price_history(v_id)) <> 1 then
    raise exception 'CATALOG_02A_COMPAT_FAIL: legacy price history RPC failed.';
  end if;

  if jsonb_array_length(public.crm_list_products()) <> 76 then
    raise exception 'CATALOG_02A_COMPAT_FAIL: created Product is not visible to CRM list.';
  end if;
end;
$$;

rollback;

do $$
begin
  if (select count(*) from public.products) <> 75
     or exists (select 1 from public.products where code='LOCAL-CRM-COMPAT-01') then
    raise exception 'CATALOG_02A_COMPAT_FAIL: compatibility fixture rollback failed.';
  end if;
end;
$$;

select 'CATALOG_02A_LOCAL_INTEGRATION_PASS' as result;
