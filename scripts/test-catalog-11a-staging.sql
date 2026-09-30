-- Prompt 11A cloud-staging E2E extensions.
-- Synthetic fixtures only; every mutation is enclosed in a transaction and
-- followed by an independent residue check.

begin;
select pg_advisory_xact_lock(hashtext('CATALOG-11A-STAGING-E2E'));

create temporary table catalog_11a_guard on commit drop as
select
  (select count(*) from public.products) as products,
  (select count(*) from public.product_import_batches) as batches,
  (select count(*) from public.product_import_rows) as rows,
  (select count(*) from public.product_price_history) as history,
  (select count(*) from public.audit_logs) as audit,
  (select count(*) from public.quotes) as quotes,
  (select count(*) from public.quote_items) as quote_items;
grant select on catalog_11a_guard to authenticated;

create temporary table catalog_11a_result(
  batch_id uuid not null,
  updated_product_id uuid not null,
  skipped_product_id uuid not null,
  updated_old_price numeric not null,
  skipped_old_price numeric not null,
  ready_product_id uuid not null,
  draft_product_id uuid not null
) on commit drop;
grant all on catalog_11a_result to authenticated;

insert into public.app_users(
  id, supabase_auth_id, email, name, role, active, lifecycle_status, created_at, updated_at
)
values (
  'catalog-11a-admin', '11111111-1111-4111-8111-111111111111',
  'catalog-11a-admin@staging.invalid', 'Catalog 11A Admin', 'admin', true, 'active', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $$
declare
  p1 public.products%rowtype;
  p2 public.products%rowtype;
  v_batch jsonb;
  v_rows jsonb;
  v_result jsonb;
  v_batch_id uuid;
  v_ready_id uuid;
  v_draft_id uuid;
  v_p1_json jsonb;
  v_p2_json jsonb;
  v_ready_json jsonb;
  v_draft_json jsonb;
  v_apply_key uuid := '11111111-1111-4111-8111-111111111112';
  v_approval_key uuid := '11111111-1111-4111-8111-111111111113';
  v_rollback_key uuid := '11111111-1111-4111-8111-111111111114';
begin
  select * into p1
  from public.products
  where active and data_status = 'READY' and price_per_m2 is not null
  order by id limit 1;

  select * into p2
  from public.products
  where active and data_status = 'READY' and price_per_m2 is not null and id <> p1.id
  order by id limit 1;

  if p1.id is null or p2.id is null then
    raise exception 'CATALOG_11A_FIXTURE_PRODUCTS_MISSING';
  end if;

  v_batch := jsonb_build_object(
    'supplier', '11A STAGING FIXTURE',
    'source_filename', 'catalog-11a-fixture.xlsx',
    'source_sha256', repeat('1', 64),
    'source_file_size_bytes', 111,
    'parser_adapter', 'CATALOG_11A_STAGING_FIXTURE',
    'parser_version', '1.0.0',
    'effective_date', current_date,
    'import_mode', 'CATALOG_IMPORT',
    'source_format', 'EXCEL',
    'source_metadata', jsonb_build_object('prompt', '11A', 'fixture', true)
  );

  v_rows := jsonb_build_array(
    jsonb_build_object(
      'source_page', 1, 'source_row_number', 1, 'source_values', jsonb_build_object(),
      'code', p1.code, 'name', p1.name, 'width_mm', p1.width_mm, 'height_mm', p1.height_mm,
      'surface', p1.surface, 'classification', 'CHANGED', 'disposition', 'READY',
      'match_rule', 'PRODUCT_ID', 'selected_action', 'UPDATE', 'matched_product_id', p1.id,
      'current_product_version', p1.version, 'warnings', jsonb_build_array(),
      'proposed_snapshot', jsonb_build_object(
        'price_per_m2', p1.price_per_m2 + 777,
        'price_effective_date', current_date
      )
    ),
    jsonb_build_object(
      'source_page', 1, 'source_row_number', 2, 'source_values', jsonb_build_object(),
      'code', p2.code, 'name', p2.name, 'width_mm', p2.width_mm, 'height_mm', p2.height_mm,
      'surface', p2.surface, 'classification', 'UNCHANGED', 'disposition', 'MISSING_PRICE',
      'match_rule', 'PRODUCT_ID', 'conflict_code', 'MISSING_PRICE_SKIPPED',
      'selected_action', 'SKIP', 'matched_product_id', p2.id,
      'current_product_version', p2.version, 'warnings', jsonb_build_array('MISSING_PRICE'),
      'proposed_snapshot', jsonb_build_object()
    ),
    jsonb_build_object(
      'source_page', 1, 'source_row_number', 3, 'source_values', jsonb_build_object(),
      'code', 'E2E-11A-READY', 'name', 'E2E 11A READY', 'width_mm', 800, 'height_mm', 800,
      'surface', 'POLISH', 'classification', 'NEW', 'disposition', 'READY',
      'match_rule', 'MANUAL', 'selected_action', 'CREATE', 'warnings', jsonb_build_array(),
      'proposed_snapshot', jsonb_build_object(
        'code', 'E2E-11A-READY', 'name', 'E2E 11A READY', 'width_mm', 800, 'height_mm', 800,
        'surface', 'POLISH', 'category', 'Synthetic', 'collection', 'Prompt 11A',
        'image_url', 'https://example.invalid/catalog-11a-ready.jpg',
        'price_per_m2', 1915000, 'price_effective_date', current_date,
        'source_metadata', jsonb_build_object('fixture', true, 'prompt', '11A')
      )
    ),
    jsonb_build_object(
      'source_page', 1, 'source_row_number', 4, 'source_values', jsonb_build_object(),
      'code', 'E2E-11A-DRAFT', 'name', 'E2E 11A DRAFT', 'width_mm', 600, 'height_mm', 1200,
      'surface', 'MATT', 'classification', 'NEW', 'disposition', 'READY',
      'match_rule', 'MANUAL', 'selected_action', 'CREATE', 'warnings', jsonb_build_array('MISSING_PRICE'),
      'proposed_snapshot', jsonb_build_object(
        'code', 'E2E-11A-DRAFT', 'name', 'E2E 11A DRAFT', 'width_mm', 600, 'height_mm', 1200,
        'surface', 'MATT', 'category', 'Synthetic', 'collection', 'Prompt 11A',
        'source_metadata', jsonb_build_object('fixture', true, 'prompt', '11A')
      )
    )
  );

  v_result := public.catalog_admin_preview_import(v_batch, v_rows);
  v_batch_id := (v_result->>'batch_id')::uuid;

  if v_result->>'status' <> 'READY'
     or (v_result->>'blocking')::integer <> 0
     or (select count(*) from public.products) <> (select products from catalog_11a_guard)
     or (select price_per_m2 from public.products where id = p1.id) is distinct from p1.price_per_m2
     or (select price_per_m2 from public.products where id = p2.id) is distinct from p2.price_per_m2 then
    raise exception 'CATALOG_11A_DRY_RUN_FAIL';
  end if;

  v_result := public.catalog_admin_approve_import(v_batch_id, v_approval_key);
  if v_result->>'status' <> 'APPROVED' then
    raise exception 'CATALOG_11A_APPROVAL_FAIL';
  end if;

  v_result := public.catalog_admin_apply_import(v_batch_id, v_apply_key);
  if v_result->>'status' <> 'APPLIED'
     or (v_result->'summary'->>'created')::integer <> 2
     or (v_result->'summary'->>'updated')::integer <> 1
     or (v_result->'summary'->>'skipped')::integer <> 1 then
    raise exception 'CATALOG_11A_APPLY_CLASSIFICATION_FAIL';
  end if;

  v_result := public.catalog_admin_apply_import(v_batch_id, v_apply_key);
  if not (v_result->>'idempotent_replay')::boolean then
    raise exception 'CATALOG_11A_APPLY_REPLAY_FAIL';
  end if;

  select (x->>'matched_product_id')::uuid into v_ready_id
  from jsonb_array_elements(public.catalog_admin_get_import_batch_v1(v_batch_id)->'rows') x
  where (x->>'source_row_number')::integer = 3;
  select (x->>'matched_product_id')::uuid into v_draft_id
  from jsonb_array_elements(public.catalog_admin_get_import_batch_v1(v_batch_id)->'rows') x
  where (x->>'source_row_number')::integer = 4;

  select x into v_p1_json
  from jsonb_array_elements(public.catalog_admin_list_products_v1(p1.code,null,null,null,100,0)->'items') x
  where x->>'id' = p1.id::text;
  select x into v_p2_json
  from jsonb_array_elements(public.catalog_admin_list_products_v1(p2.code,null,null,null,100,0)->'items') x
  where x->>'id' = p2.id::text;
  select x into v_ready_json
  from jsonb_array_elements(public.catalog_admin_list_products_v1('E2E-11A-READY',null,null,null,100,0)->'items') x
  where x->>'id' = v_ready_id::text;
  select x into v_draft_json
  from jsonb_array_elements(public.catalog_admin_list_products_v1('E2E-11A-DRAFT',null,null,null,100,0)->'items') x
  where x->>'id' = v_draft_id::text;

  if nullif(v_p1_json->>'price_per_m2','')::numeric is distinct from p1.price_per_m2 + 777 then
    raise exception 'CATALOG_11A_UPDATE_PRICE_READBACK_FAIL';
  end if;
  if nullif(v_p2_json->>'price_per_m2','')::numeric is distinct from p2.price_per_m2 then
    raise exception 'CATALOG_11A_BLANK_PRICE_READBACK_FAIL';
  end if;
  if v_ready_json is null
     or v_ready_json->>'data_status' <> 'READY'
     or (v_ready_json->>'is_published')::boolean
     or (v_ready_json->>'price_per_m2')::numeric <> 1915000
     or v_ready_json->>'image_url' <> 'https://example.invalid/catalog-11a-ready.jpg' then
    raise exception 'CATALOG_11A_NEW_READY_READBACK_FAIL: id=%', v_ready_id;
  end if;
  if v_draft_json is null
     or v_draft_json->>'data_status' <> 'UPDATING'
     or (v_draft_json->>'is_published')::boolean
     or nullif(v_draft_json->>'price_per_m2','') is not null then
    raise exception 'CATALOG_11A_NEW_DRAFT_READBACK_FAIL: id=%', v_draft_id;
  end if;

  begin
    perform public.catalog_admin_update_product_v1(
      p1.id,
      (v_p1_json->>'version')::bigint,
      jsonb_build_object('description', '11A transient rollback-conflict fixture')
    );
    perform public.catalog_admin_rollback_import(v_batch_id, v_rollback_key);
    raise exception 'CATALOG_11A_EXPECTED_ROLLBACK_CONFLICT';
  exception when others then
    if sqlerrm not like '%CATALOG_ROLLBACK_VERSION_CONFLICT%' then raise; end if;
  end;

  v_result := public.catalog_admin_rollback_import(v_batch_id, v_rollback_key);
  if v_result->>'status' <> 'ROLLED_BACK'
     or (v_result->'summary'->>'restored')::integer <> 1
     or (v_result->'summary'->>'archived_created')::integer <> 2 then
    raise exception 'CATALOG_11A_ROLLBACK_FAIL';
  end if;

  v_result := public.catalog_admin_rollback_import(v_batch_id, v_rollback_key);
  if not (v_result->>'idempotent_replay')::boolean then
    raise exception 'CATALOG_11A_ROLLBACK_REPLAY_FAIL';
  end if;

  insert into catalog_11a_result values (
    v_batch_id, p1.id, p2.id, p1.price_per_m2, p2.price_per_m2, v_ready_id, v_draft_id
  );
end;
$$;

reset role;

do $$
declare r catalog_11a_result%rowtype;
begin
  select * into r from catalog_11a_result;
  if (select price_per_m2 from public.products where id = r.updated_product_id) is distinct from r.updated_old_price
     or (select price_per_m2 from public.products where id = r.skipped_product_id) is distinct from r.skipped_old_price
     or exists (select 1 from public.products where id in (r.ready_product_id, r.draft_product_id) and active)
     or (select count(*) from public.audit_logs
         where action = 'catalogImportProductApply03B'
           and raw_data->>'batch_id' = r.batch_id::text
           and raw_data ?& array['before','after']) <> 3
     or (select count(*) from public.audit_logs
         where action = 'catalogImportProductRollback03B'
           and raw_data->>'batch_id' = r.batch_id::text
           and raw_data ?& array['before','after']) <> 3 then
    raise exception 'CATALOG_11A_ROLLBACK_OR_AUDIT_READBACK_FAIL';
  end if;
end;
$$;

do $$
declare
  p public.products%rowtype;
  v_quote_id text := 'catalog-11a-quote';
  v_item_id text := 'catalog-11a-quote-item';
begin
  select * into p
  from public.products
  where active and data_status = 'READY' and price_per_m2 is not null
  order by id limit 1;

  insert into public.quotes(id, quote_no, customer_name, status, created_by_email)
  values (v_quote_id, 'Q-11A-FIXTURE', 'Synthetic 11A', 'draft', 'catalog-11a@staging.invalid');

  insert into public.quote_items(
    id, quote_id, product_id, product_sku, product_name, unit, qty, unit_price, line_total,
    width_mm_snapshot, height_mm_snapshot, surface_snapshot, list_price_snapshot
  ) values (
    v_item_id, v_quote_id, p.id, p.code, p.name, 'm2', 1, p.price_per_m2, p.price_per_m2,
    p.width_mm, p.height_mm, p.surface, p.price_per_m2
  );

  update public.products set price_per_m2 = price_per_m2 + 999 where id = p.id;

  if not exists (
    select 1 from public.quote_items
    where id = v_item_id and product_id = p.id
      and width_mm_snapshot is not distinct from p.width_mm
      and height_mm_snapshot is not distinct from p.height_mm
      and surface_snapshot is not distinct from p.surface
      and list_price_snapshot is not distinct from p.price_per_m2
  ) then
    raise exception 'CATALOG_11A_QUOTE_SNAPSHOT_FAIL';
  end if;
end;
$$;

rollback;

do $$
begin
  if exists (select 1 from public.app_users where id = 'catalog-11a-admin')
     or exists (select 1 from public.product_import_batches where parser_adapter = 'CATALOG_11A_STAGING_FIXTURE')
     or exists (select 1 from public.products where code in ('E2E-11A-READY', 'E2E-11A-DRAFT'))
     or exists (select 1 from public.quotes where id = 'catalog-11a-quote')
     or exists (select 1 from public.quote_items where id = 'catalog-11a-quote-item') then
    raise exception 'CATALOG_11A_FIXTURE_RESIDUE';
  end if;
end;
$$;

select 'CATALOG_11A_STAGING_E2E_PASS' as result;
