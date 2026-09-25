-- Prompt 05A cloud-staging runtime verification.
-- This file is deliberately self-rolling-back and guarded to the exact
-- post-Prompt-04 staging baseline. Never run it on production.
begin;

do $$
begin
  if (select count(*) from public.products) <> 123
     or (select count(*) from public.products where active) <> 75
     or (select count(*) from public.products where is_published) <> 0
     or not exists (select 1 from public.app_users where id = 'catalog-04-staging-admin') then
    raise exception 'CATALOG_05A_STAGING_GUARD_FAIL: expected post-04 staging baseline 123/75/0 and synthetic actor.';
  end if;
end;
$$;

insert into public.products (
  id, code, name, width_mm, height_mm, surface, origin, color, category, collection,
  description, image_url, gallery_urls, pdf_url, video_url, more_info_url,
  price_per_m2, price_effective_date, active, is_published,
  created_by_user_id, updated_by_user_id
) values
  ('050a0000-0000-4000-8000-000000000001', 'API05A-A', 'API 05A TRAVERTINO DARK GREY', 600, 1200, 'MATT', 'Italy', 'Grey', 'Gạch vân đá', 'Atlas',
   'Fixture public API A', 'https://example.invalid/a.jpg', '["https://example.invalid/a-1.jpg"]', 'https://example.invalid/a.pdf', 'https://example.invalid/a.mp4', 'https://example.invalid/a',
   1000000, date '2026-09-25', true, true, 'catalog-04-staging-admin', 'catalog-04-staging-admin'),
  ('050a0000-0000-4000-8000-000000000002', 'API05A-B', 'API 05A TRAVERTINO DARK GREY', 1200, 2400, 'POLISH', 'Italy', 'Grey', 'Gạch vân đá', 'Atlas',
   'Fixture public API B', 'https://example.invalid/b.jpg', '[]', null, null, null,
   2000000, date '2026-09-25', true, true, 'catalog-04-staging-admin', 'catalog-04-staging-admin'),
  ('050a0000-0000-4000-8000-000000000003', 'API05A-C', 'API 05A BARRO BEIGE', 600, 600, 'GLOSSY', 'Spain', 'Beige', 'Gạch xi măng', 'Terra',
   'Fixture public API C', null, '[]', null, null, null,
   750000, date '2026-09-25', true, true, 'catalog-04-staging-admin', 'catalog-04-staging-admin'),
  ('050a0000-0000-4000-8000-000000000004', 'API05A-D', 'API 05A PRIVATE', 600, 600, 'MATT', null, null, 'Private', null,
   'Must never be public', null, '[]', null, null, null,
   900000, date '2026-09-25', true, false, 'catalog-04-staging-admin', 'catalog-04-staging-admin'),
  ('050a0000-0000-4000-8000-000000000005', 'API05A-E', 'API 05A UPDATING', 600, 600, null, null, null, null, null,
   'Must never be public', null, '[]', null, null, null,
   null, null, true, false, 'catalog-04-staging-admin', 'catalog-04-staging-admin');

insert into public.product_source_mappings (
  product_id, source_system, source_id, match_rule, verified, metadata, created_by_user_id
) values (
  '050a0000-0000-4000-8000-000000000001', 'FIREBASE', 'SP-05A-001', 'TEST_FIXTURE', true, '{}', 'catalog-04-staging-admin'
);

set local role anon;

do $$
declare
  v_result jsonb;
  v_item jsonb;
  v_failed boolean;
begin
  v_result := public.catalog_public_list_products_v1(
    null, null, null, null, null, null, null, null, 2, 0
  );
  if (v_result #>> '{pagination,total}')::integer <> 3
     or jsonb_array_length(v_result->'items') <> 2
     or (v_result #>> '{pagination,has_more}')::boolean is not true
     or (v_result #>> '{pagination,next_offset}')::integer <> 2 then
    raise exception 'CATALOG_05A_TEST_FAIL: first page contract.';
  end if;

  v_result := public.catalog_public_list_products_v1(
    null, null, null, null, null, null, null, null, 2, 2
  );
  if (v_result #>> '{pagination,total}')::integer <> 3
     or jsonb_array_length(v_result->'items') <> 1
     or (v_result #>> '{pagination,has_more}')::boolean is not false
     or (v_result #> '{pagination,next_offset}') <> 'null'::jsonb then
    raise exception 'CATALOG_05A_TEST_FAIL: second page contract.';
  end if;

  if (public.catalog_public_list_products_v1('travertino', null, null, null, null, null, null, null, 100, 0) #>> '{pagination,total}')::integer <> 2 then
    raise exception 'CATALOG_05A_TEST_FAIL: search.';
  end if;
  if (public.catalog_public_list_products_v1(null, 'gạch vân đá', null, null, null, null, null, null, 100, 0) #>> '{pagination,total}')::integer <> 2 then
    raise exception 'CATALOG_05A_TEST_FAIL: category filter.';
  end if;
  if (public.catalog_public_list_products_v1(null, null, 'atlas', null, null, null, null, null, 100, 0) #>> '{pagination,total}')::integer <> 2 then
    raise exception 'CATALOG_05A_TEST_FAIL: collection filter.';
  end if;
  if (public.catalog_public_list_products_v1(null, null, null, 'matt', null, null, null, null, 100, 0) #>> '{pagination,total}')::integer <> 1 then
    raise exception 'CATALOG_05A_TEST_FAIL: surface filter.';
  end if;
  if (public.catalog_public_list_products_v1(null, null, null, null, 1200, 2400, null, null, 100, 0) #>> '{pagination,total}')::integer <> 1 then
    raise exception 'CATALOG_05A_TEST_FAIL: ordered dimension filter.';
  end if;
  if (public.catalog_public_list_products_v1(null, null, null, null, null, null, 1500000, 2500000, 100, 0) #>> '{pagination,total}')::integer <> 1 then
    raise exception 'CATALOG_05A_TEST_FAIL: price filter.';
  end if;
  if (public.catalog_public_list_products_v1('dark grey', 'GẠCH VÂN ĐÁ', 'ATLAS', 'MATT', 600, 1200, 1000000, 1000000, 100, 0) #>> '{pagination,total}')::integer <> 1 then
    raise exception 'CATALOG_05A_TEST_FAIL: combined filters.';
  end if;

  v_item := public.catalog_public_get_product_v1('API05A-A');
  if v_item->>'id' <> '050a0000-0000-4000-8000-000000000001'
     or v_item->>'size_display' <> '60 × 120 cm'
     or v_item->>'price_unit' <> 'VND_M2'
     or (select count(*) from jsonb_object_keys(v_item)) <> 20
     or exists (
       select 1 from jsonb_object_keys(v_item) k
       where k in (
         'active','data_status','is_published','stock_quantity','price_per_box','price_per_piece',
         'pieces_per_box','sqm_per_box','source_metadata','version','created_at','updated_at',
         'created_by_user_id','updated_by_user_id'
       )
     ) then
    raise exception 'CATALOG_05A_TEST_FAIL: public projection.';
  end if;

  if public.catalog_public_get_product_v1('050a0000-0000-4000-8000-000000000001')->>'code' <> 'API05A-A'
     or public.catalog_public_get_product_v1('SP-05A-001')->>'code' <> 'API05A-A'
     or public.catalog_public_get_product_v1('API05A-D') is not null
     or public.catalog_public_get_product_v1('missing') is not null then
    raise exception 'CATALOG_05A_TEST_FAIL: detail identifier or publish gate.';
  end if;

  v_failed := false;
  begin
    perform public.catalog_public_list_products_v1(null, null, null, null, null, null, null, null, 101, 0);
  exception when sqlstate '22023' then
    v_failed := true;
  end;
  if not v_failed then raise exception 'CATALOG_05A_TEST_FAIL: pagination validation.'; end if;

  v_failed := false;
  begin
    perform public.catalog_public_list_products_v1(null, null, null, null, null, null, 200, 100, 24, 0);
  exception when sqlstate '22023' then
    v_failed := true;
  end;
  if not v_failed then raise exception 'CATALOG_05A_TEST_FAIL: price validation.'; end if;

  v_failed := false;
  begin
    perform count(*) from public.products;
  exception when insufficient_privilege then
    v_failed := true;
  end;
  if not v_failed then raise exception 'CATALOG_05A_TEST_FAIL: anon direct products read.'; end if;
end;
$$;

reset role;

do $$
begin
  if has_table_privilege('anon', 'public.products', 'SELECT')
     or has_table_privilege('anon', 'public.product_source_mappings', 'SELECT')
     or has_function_privilege('anon', 'public.catalog_public_product_json_v1_05a(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.catalog_public_resolve_product_id_v1_05a(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.catalog_public_list_products_v1(text,text,text,text,integer,integer,numeric,numeric,integer,integer)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.catalog_public_get_product_v1(text)', 'EXECUTE') then
    raise exception 'CATALOG_05A_TEST_FAIL: grant matrix.';
  end if;
end;
$$;

rollback;

-- Independent post-rollback proof that the fixture left no catalog residue.
begin;
do $$
begin
  if (select count(*) from public.products) <> 123
     or (select count(*) from public.products where active) <> 75
     or (select count(*) from public.products where is_published) <> 0
     or exists (select 1 from public.products where code like 'API05A-%')
     or exists (select 1 from public.product_source_mappings where source_id = 'SP-05A-001') then
    raise exception 'CATALOG_05A_TEST_FAIL: fixture rollback residue.';
  end if;
end;
$$;
commit;
