-- CATALOG INTEGRATION 05A — public catalog API v1.
-- Apply only after 02B and Prompt 04 approval. This migration is additive.
begin;

select pg_advisory_xact_lock(hashtext('CATALOG-INTEGRATION-05A-PUBLIC-API-V1'));

do $$
declare
  v_missing text;
begin
  select string_agg(required_object, ', ' order by required_object)
    into v_missing
  from unnest(array[
    'public.products',
    'public.product_source_mappings'
  ]) required(required_object)
  where to_regclass(required_object) is null;

  if v_missing is not null then
    raise exception 'CATALOG_05A_PRECONDITION_FAIL: missing objects: %', v_missing;
  end if;

  if to_regprocedure('public.catalog_public_list_products(text,integer,integer)') is null
     or to_regprocedure('public.catalog_public_get_product(uuid)') is null then
    raise exception 'CATALOG_05A_PRECONDITION_FAIL: Prompt 02B public RPCs are missing.';
  end if;

  if to_regprocedure('public.catalog_public_list_products_v1(text,text,text,text,integer,integer,numeric,numeric,integer,integer)') is not null
     or to_regprocedure('public.catalog_public_get_product_v1(text)') is not null then
    raise exception 'CATALOG_05A_PRECONDITION_FAIL: migration already applied.';
  end if;
end;
$$;

-- Whitelisted serializer. It never exposes readiness/publish controls, stock,
-- package prices, provenance, actors, timestamps, version, import or audit data.
create function public.catalog_public_product_json_v1_05a(p_product_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', p.id,
    'code', p.code,
    'name', p.name,
    'width_mm', p.width_mm,
    'height_mm', p.height_mm,
    'size_display', format(
      '%s × %s cm',
      case when p.width_mm % 10 = 0 then (p.width_mm / 10)::text else to_char(p.width_mm::numeric / 10, 'FM999999990.0') end,
      case when p.height_mm % 10 = 0 then (p.height_mm / 10)::text else to_char(p.height_mm::numeric / 10, 'FM999999990.0') end
    ),
    'surface', p.surface,
    'origin', p.origin,
    'color', p.color,
    'category', p.category,
    'collection', p.collection,
    'description', p.description,
    'image_url', p.image_url,
    'gallery_urls', p.gallery_urls,
    'pdf_url', p.pdf_url,
    'video_url', p.video_url,
    'more_info_url', p.more_info_url,
    'price_per_m2', p.price_per_m2,
    'price_unit', p.price_unit,
    'price_effective_date', p.price_effective_date
  )
  from public.products p
  where p.id = p_product_id
    and p.active
    and p.data_status = 'READY'
    and p.is_published;
$$;

-- Resolve a public identifier without exposing product_source_mappings. UUID and
-- current code win; a verified legacy source ID such as SP-* is accepted only
-- when it resolves to exactly one published product.
create function public.catalog_public_resolve_product_id_v1_05a(p_identifier text)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_identifier text := nullif(btrim(normalize(coalesce(p_identifier, ''), NFKC)), '');
  v_normalized text;
  v_product_id uuid;
  v_mapping_count bigint;
begin
  if v_identifier is null then
    raise exception using errcode = '22023', message = 'CATALOG_PRODUCT_IDENTIFIER_REQUIRED';
  end if;
  if length(v_identifier) > 200 then
    raise exception using errcode = '22023', message = 'CATALOG_PRODUCT_IDENTIFIER_TOO_LONG';
  end if;

  v_normalized := upper(v_identifier);

  select p.id
    into v_product_id
  from public.products p
  where p.active
    and p.data_status = 'READY'
    and p.is_published
    and (p.id::text = lower(v_identifier) or upper(normalize(coalesce(p.code, ''), NFKC)) = v_normalized)
  order by case when p.id::text = lower(v_identifier) then 0 else 1 end, p.id
  limit 1;

  if v_product_id is not null then
    return v_product_id;
  end if;

  select (array_agg(distinct m.product_id order by m.product_id))[1],
         count(distinct m.product_id)
    into v_product_id, v_mapping_count
  from public.product_source_mappings m
  join public.products p on p.id = m.product_id
  where m.verified
    and upper(normalize(m.source_id, NFKC)) = v_normalized
    and p.active
    and p.data_status = 'READY'
    and p.is_published;

  if coalesce(v_mapping_count, 0) <> 1 then
    return null;
  end if;
  return v_product_id;
end;
$$;

create function public.catalog_public_list_products_v1(
  p_search text default null,
  p_category text default null,
  p_collection text default null,
  p_surface text default null,
  p_width_mm integer default null,
  p_height_mm integer default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_limit integer default 24,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_search text := nullif(upper(regexp_replace(btrim(normalize(coalesce(p_search, ''), NFKC)), '[[:space:]]+', ' ', 'g')), '');
  v_category text := nullif(upper(regexp_replace(btrim(normalize(coalesce(p_category, ''), NFKC)), '[[:space:]]+', ' ', 'g')), '');
  v_collection text := nullif(upper(regexp_replace(btrim(normalize(coalesce(p_collection, ''), NFKC)), '[[:space:]]+', ' ', 'g')), '');
  v_surface text := nullif(upper(regexp_replace(btrim(normalize(coalesce(p_surface, ''), NFKC)), '[[:space:]]+', ' ', 'g')), '');
begin
  if length(coalesce(p_search, '')) > 200
     or length(coalesce(p_category, '')) > 100
     or length(coalesce(p_collection, '')) > 100
     or length(coalesce(p_surface, '')) > 100 then
    raise exception using errcode = '22023', message = 'CATALOG_FILTER_TOO_LONG';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100
     or p_offset is null or p_offset < 0 or p_offset > 100000 then
    raise exception using errcode = '22023', message = 'CATALOG_INVALID_PAGINATION';
  end if;
  if (p_width_mm is not null and p_width_mm <= 0)
     or (p_height_mm is not null and p_height_mm <= 0) then
    raise exception using errcode = '22023', message = 'CATALOG_INVALID_DIMENSION_FILTER';
  end if;
  if (p_min_price is not null and p_min_price < 0)
     or (p_max_price is not null and p_max_price < 0)
     or (p_min_price is not null and p_max_price is not null and p_min_price > p_max_price) then
    raise exception using errcode = '22023', message = 'CATALOG_INVALID_PRICE_FILTER';
  end if;

  return (
    with filtered as (
      select p.id, p.name_normalized, p.width_mm, p.height_mm, p.surface_normalized
      from public.products p
      where p.active
        and p.data_status = 'READY'
        and p.is_published
        and (
          v_search is null
          or position(v_search in p.name_normalized) > 0
          or position(v_search in coalesce(p.code_normalized, '')) > 0
          or position(v_search in coalesce(p.surface_normalized, '')) > 0
          or position(v_search in upper(normalize(coalesce(p.category, ''), NFKC))) > 0
          or position(v_search in upper(normalize(coalesce(p.collection, ''), NFKC))) > 0
          or position(v_search in upper(normalize(coalesce(p.description, ''), NFKC))) > 0
        )
        and (v_category is null or upper(regexp_replace(btrim(normalize(coalesce(p.category, ''), NFKC)), '[[:space:]]+', ' ', 'g')) = v_category)
        and (v_collection is null or upper(regexp_replace(btrim(normalize(coalesce(p.collection, ''), NFKC)), '[[:space:]]+', ' ', 'g')) = v_collection)
        and (v_surface is null or coalesce(p.surface_normalized, '') = v_surface)
        and (p_width_mm is null or p.width_mm = p_width_mm)
        and (p_height_mm is null or p.height_mm = p_height_mm)
        and (p_min_price is null or p.price_per_m2 >= p_min_price)
        and (p_max_price is null or p.price_per_m2 <= p_max_price)
    ), paged as (
      select f.*
      from filtered f
      order by f.name_normalized, f.width_mm, f.height_mm, f.surface_normalized, f.id
      limit p_limit offset p_offset
    )
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(
          public.catalog_public_product_json_v1_05a(x.id)
          order by x.name_normalized, x.width_mm, x.height_mm, x.surface_normalized, x.id
        )
        from paged x
      ), '[]'::jsonb),
      'pagination', jsonb_build_object(
        'limit', p_limit,
        'offset', p_offset,
        'total', (select count(*) from filtered),
        'has_more', p_offset + p_limit < (select count(*) from filtered),
        'next_offset', case
          when p_offset + p_limit < (select count(*) from filtered) then p_offset + p_limit
          else null
        end
      )
    )
  );
end;
$$;

create function public.catalog_public_get_product_v1(p_identifier text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_product_id uuid;
begin
  v_product_id := public.catalog_public_resolve_product_id_v1_05a(p_identifier);
  if v_product_id is null then
    return null;
  end if;
  return public.catalog_public_product_json_v1_05a(v_product_id);
end;
$$;

comment on function public.catalog_public_list_products_v1(text,text,text,text,integer,integer,numeric,numeric,integer,integer) is
  'Public catalog API v1: published READY products only, with search, exact filters and bounded offset pagination.';
comment on function public.catalog_public_get_product_v1(text) is
  'Public catalog API v1 detail lookup by UUID, code or unique verified legacy source ID.';

revoke all on function public.catalog_public_product_json_v1_05a(uuid) from public, anon, authenticated;
revoke all on function public.catalog_public_resolve_product_id_v1_05a(text) from public, anon, authenticated;
revoke all on function public.catalog_public_list_products_v1(text,text,text,text,integer,integer,numeric,numeric,integer,integer) from public, anon, authenticated;
revoke all on function public.catalog_public_get_product_v1(text) from public, anon, authenticated;

grant execute on function public.catalog_public_list_products_v1(text,text,text,text,integer,integer,numeric,numeric,integer,integer) to anon, authenticated;
grant execute on function public.catalog_public_get_product_v1(text) to anon, authenticated;

do $$
declare
  v_proc regprocedure;
begin
  foreach v_proc in array array[
    'public.catalog_public_product_json_v1_05a(uuid)'::regprocedure,
    'public.catalog_public_resolve_product_id_v1_05a(text)'::regprocedure,
    'public.catalog_public_list_products_v1(text,text,text,text,integer,integer,numeric,numeric,integer,integer)'::regprocedure,
    'public.catalog_public_get_product_v1(text)'::regprocedure
  ] loop
    if not exists (
      select 1 from pg_proc p
      where p.oid = v_proc
        and p.prosecdef
        and p.provolatile = 's'
        and p.proconfig @> array['search_path=pg_catalog, public']
    ) then
      raise exception 'CATALOG_05A_VERIFY_FAIL: unsafe function %', v_proc;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.products', 'SELECT')
     or has_table_privilege('anon', 'public.product_source_mappings', 'SELECT')
     or has_function_privilege('anon', 'public.catalog_public_product_json_v1_05a(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.catalog_public_resolve_product_id_v1_05a(text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.catalog_public_list_products_v1(text,text,text,text,integer,integer,numeric,numeric,integer,integer)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.catalog_public_get_product_v1(text)', 'EXECUTE') then
    raise exception 'CATALOG_05A_VERIFY_FAIL: public grant matrix.';
  end if;
end;
$$;

commit;
