-- CATALOG INTEGRATION 01B — guarded rollback companion.
-- Do not run automatically. This rollback is valid only before any post-01B
-- catalog/import/lead data uses the new columns. Every lossy case aborts first.
begin;

select pg_advisory_xact_lock(hashtext('CATALOG-INTEGRATION-01B-ADDITIVE'));

do $$
begin
  if to_regclass('public.product_source_mappings') is null
     or to_regclass('public.website_leads') is null
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'products'
         and column_name = 'width_mm'
     ) then
    raise exception 'CATALOG_01B_ROLLBACK_PRECONDITION_FAIL: 01B schema is not fully present.';
  end if;

  if exists (select 1 from public.product_source_mappings)
     or exists (select 1 from public.website_leads) then
    raise exception 'CATALOG_01B_ROLLBACK_BLOCKED: source mappings or website leads would be lost.';
  end if;

  if exists (
    select 1
    from public.products
    where code is null
       or code_normalized is null
       or width_cm is null
       or height_cm is null
       or price_per_m2 is null
       or price_effective_date is null
       or color is not null
       or category is not null
       or collection is not null
       or description is not null
       or image_url is not null
       or gallery_urls <> '[]'::jsonb
       or pdf_url is not null
       or video_url is not null
       or more_info_url is not null
       or price_unit <> 'VND_M2'
       or is_published
       or source_metadata <> '{}'::jsonb
       or width_mm <> width_cm * 10
       or height_mm <> height_cm * 10
  ) then
    raise exception 'CATALOG_01B_ROLLBACK_BLOCKED: Product draft/catalog data would be lost or baseline NOT NULL cannot be restored.';
  end if;

  if exists (
    select 1
    from public.quote_items
    where width_mm_snapshot is not null
       or height_mm_snapshot is not null
       or surface_snapshot is not null
       or list_price_snapshot is not null
  ) then
    raise exception 'CATALOG_01B_ROLLBACK_BLOCKED: quote snapshot data would be lost.';
  end if;

  if exists (
    select 1
    from public.product_import_batches
    where import_mode <> 'PRICE_UPDATE_ONLY'
       or source_format <> 'PDF'
       or source_metadata <> '{}'::jsonb
       or rollback_of_batch_id is not null
       or rollback_idempotency_key is not null
       or rolled_back_at is not null
       or rolled_back_by_user_id is not null
  ) then
    raise exception 'CATALOG_01B_ROLLBACK_BLOCKED: import batch catalog/rollback data would be lost.';
  end if;

  if exists (
    select 1
    from public.product_import_rows
    where source_sheet is not null
       or source_cell_ref is not null
       or source_record_id is not null
       or width_mm is not null
       or height_mm is not null
       or surface_normalized is not null
       or disposition is not null
       or match_rule is not null
       or conflict_code is not null
       or previous_snapshot <> '{}'::jsonb
       or proposed_snapshot <> '{}'::jsonb
       or rollback_snapshot <> '{}'::jsonb
  ) then
    raise exception 'CATALOG_01B_ROLLBACK_BLOCKED: import row catalog data would be lost.';
  end if;

  if exists (
    select 1
    from public.product_price_history
    where previous_price_per_m2 is not null
       or source_format <> 'LEGACY'
       or change_kind <> 'PRICE_SET'
       or rollback_of_history_id is not null
       or product_version_before is not null
       or product_version_after is not null
       or change_metadata <> '{}'::jsonb
  ) then
    raise exception 'CATALOG_01B_ROLLBACK_BLOCKED: extended price-history data would be lost.';
  end if;
end;
$$;

create temporary table catalog_01b_rollback_products_guard on commit drop as
select id, to_jsonb(p) - array[
  'name_normalized', 'width_mm', 'height_mm', 'surface_normalized',
  'color', 'category', 'collection', 'description', 'image_url',
  'gallery_urls', 'pdf_url', 'video_url', 'more_info_url', 'price_unit',
  'data_status', 'is_published', 'source_metadata'
]::text[] as expected_row
from public.products p;

create temporary table catalog_01b_rollback_quotes_guard on commit drop as
select id, to_jsonb(q) - array[
  'width_mm_snapshot', 'height_mm_snapshot', 'surface_snapshot', 'list_price_snapshot'
]::text[] as expected_row
from public.quote_items q;

create temporary table catalog_01b_rollback_batches_guard on commit drop as
select id, to_jsonb(b) - array[
  'import_mode', 'source_format', 'source_metadata', 'rollback_of_batch_id',
  'rollback_idempotency_key', 'rolled_back_at', 'rolled_back_by_user_id'
]::text[] as expected_row
from public.product_import_batches b;

create temporary table catalog_01b_rollback_rows_guard on commit drop as
select id, to_jsonb(r) - array[
  'source_sheet', 'source_cell_ref', 'source_record_id', 'width_mm',
  'height_mm', 'surface_normalized', 'disposition', 'match_rule',
  'conflict_code', 'previous_snapshot', 'proposed_snapshot', 'rollback_snapshot'
]::text[] as expected_row
from public.product_import_rows r;

create temporary table catalog_01b_rollback_history_guard on commit drop as
select id, to_jsonb(h) - array[
  'previous_price_per_m2', 'source_format', 'change_kind',
  'rollback_of_history_id', 'product_version_before',
  'product_version_after', 'change_metadata'
]::text[] as expected_row
from public.product_price_history h;

drop index public.website_leads_product_created_idx;
drop index public.website_leads_status_created_idx;
drop index public.product_price_history_rollback_idx;
drop index public.product_import_rows_disposition_idx;
drop index public.product_import_rows_variant_lookup_idx;
drop index public.product_import_batches_catalog_mode_idx;
drop index public.product_source_mappings_product_idx;
drop index public.products_catalog_status_idx;
drop index public.products_catalog_variant_lookup_idx;
drop index public.products_catalog_public_idx;

drop trigger products_catalog_sync_dimensions_01b on public.products;

-- This constraint only references pre-01B columns, so dropping catalog columns
-- does not remove it automatically. Drop it explicitly to restore exact schema.
alter table public.products
  drop constraint products_price_effective_pair_check;

alter table public.quote_items
  drop column width_mm_snapshot,
  drop column height_mm_snapshot,
  drop column surface_snapshot,
  drop column list_price_snapshot;

alter table public.product_price_history
  drop column previous_price_per_m2,
  drop column source_format,
  drop column change_kind,
  drop column rollback_of_history_id,
  drop column product_version_before,
  drop column product_version_after,
  drop column change_metadata;

alter table public.product_import_rows
  drop column source_sheet,
  drop column source_cell_ref,
  drop column source_record_id,
  drop column width_mm,
  drop column height_mm,
  drop column surface_normalized,
  drop column disposition,
  drop column match_rule,
  drop column conflict_code,
  drop column previous_snapshot,
  drop column proposed_snapshot,
  drop column rollback_snapshot;

alter table public.product_import_batches
  drop column import_mode,
  drop column source_format,
  drop column source_metadata,
  drop column rollback_of_batch_id,
  drop column rollback_idempotency_key,
  drop column rolled_back_at,
  drop column rolled_back_by_user_id;

alter table public.products
  drop column name_normalized,
  drop column width_mm,
  drop column height_mm,
  drop column surface_normalized,
  drop column color,
  drop column category,
  drop column collection,
  drop column description,
  drop column image_url,
  drop column gallery_urls,
  drop column pdf_url,
  drop column video_url,
  drop column more_info_url,
  drop column price_unit,
  drop column data_status,
  drop column is_published,
  drop column source_metadata;

alter table public.products
  alter column code set not null,
  alter column code_normalized set not null,
  alter column width_cm set not null,
  alter column height_cm set not null,
  alter column price_per_m2 set not null,
  alter column price_effective_date set not null;

drop function public.crm_catalog_https_url_array_01b(jsonb);
drop function public.crm_catalog_sync_dimensions_01b();
drop table public.website_leads;
drop table public.product_source_mappings;

do $$
begin
  if exists (
    select 1
    from catalog_01b_rollback_products_guard g
    full join public.products p on p.id = g.id
    where g.id is null or p.id is null or g.expected_row <> to_jsonb(p)
  ) or exists (
    select 1
    from catalog_01b_rollback_quotes_guard g
    full join public.quote_items q on q.id = g.id
    where g.id is null or q.id is null or g.expected_row <> to_jsonb(q)
  ) or exists (
    select 1
    from catalog_01b_rollback_batches_guard g
    full join public.product_import_batches b on b.id = g.id
    where g.id is null or b.id is null or g.expected_row <> to_jsonb(b)
  ) or exists (
    select 1
    from catalog_01b_rollback_rows_guard g
    full join public.product_import_rows r on r.id = g.id
    where g.id is null or r.id is null or g.expected_row <> to_jsonb(r)
  ) or exists (
    select 1
    from catalog_01b_rollback_history_guard g
    full join public.product_price_history h on h.id = g.id
    where g.id is null or h.id is null or g.expected_row <> to_jsonb(h)
  ) then
    raise exception 'CATALOG_01B_ROLLBACK_VERIFY_FAIL: a pre-01B row changed during rollback.';
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
    raise exception 'CATALOG_01B_ROLLBACK_VERIFY_FAIL: 01B objects remain.';
  end if;
end;
$$;

commit;
