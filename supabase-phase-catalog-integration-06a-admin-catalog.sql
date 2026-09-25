-- CATALOG INTEGRATION 06A — dedicated admin catalog APIs.
-- Apply only after Prompt 05A approval. Browser roles keep zero direct writes.
begin;

select pg_advisory_xact_lock(hashtext('CATALOG-INTEGRATION-06A-ADMIN-CATALOG'));

do $$
begin
  if to_regclass('public.products') is null
     or to_regclass('public.product_price_history') is null
     or to_regprocedure('public.catalog_require_admin_02b()') is null
     or to_regprocedure('public.crm_write_audit(text,text,text,jsonb)') is null
     or to_regprocedure('public.catalog_public_list_products_v1(text,text,text,text,integer,integer,numeric,numeric,integer,integer)') is null then
    raise exception 'CATALOG_06A_PRECONDITION_FAIL: required 02B/05A objects are missing.';
  end if;
  if to_regprocedure('public.catalog_admin_list_products_v1(text,text,boolean,boolean,integer,integer)') is not null
     or to_regprocedure('public.catalog_admin_update_product_v1(uuid,bigint,jsonb)') is not null
     or to_regprocedure('public.catalog_admin_set_product_state_v1(uuid,bigint,boolean,boolean)') is not null then
    raise exception 'CATALOG_06A_PRECONDITION_FAIL: migration already applied.';
  end if;
end;
$$;

create function public.catalog_admin_product_json_v1_06a(p_product_id uuid)
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
    'surface', p.surface,
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
    'price_effective_date', p.price_effective_date,
    'active', p.active,
    'data_status', p.data_status,
    'is_published', p.is_published,
    'version', p.version,
    'created_at', p.created_at,
    'created_by_user_id', p.created_by_user_id,
    'created_by_name', cu.name,
    'updated_at', p.updated_at,
    'updated_by_user_id', p.updated_by_user_id,
    'updated_by_name', uu.name
  )
  from public.products p
  left join public.app_users cu on cu.id = p.created_by_user_id
  left join public.app_users uu on uu.id = p.updated_by_user_id
  where p.id = p_product_id;
$$;

create function public.catalog_admin_list_products_v1(
  p_search text default null,
  p_data_status text default null,
  p_active boolean default null,
  p_is_published boolean default null,
  p_limit integer default 50,
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
  v_status text := nullif(upper(btrim(coalesce(p_data_status, ''))), '');
begin
  perform public.catalog_require_admin_02b();
  if v_status is not null and v_status not in ('READY', 'UPDATING') then
    raise exception using errcode = '22023', message = 'CATALOG_06A_INVALID_STATUS';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100
     or p_offset is null or p_offset < 0 or p_offset > 100000 then
    raise exception using errcode = '22023', message = 'CATALOG_06A_INVALID_PAGINATION';
  end if;

  return (
    with filtered as materialized (
      select p.id, p.updated_at, p.name_normalized, p.width_mm, p.height_mm, p.surface_normalized
      from public.products p
      where (v_status is null or p.data_status = v_status)
        and (p_active is null or p.active = p_active)
        and (p_is_published is null or p.is_published = p_is_published)
        and (
          v_search is null
          or position(v_search in p.name_normalized) > 0
          or position(v_search in coalesce(upper(normalize(p.code, NFKC)), '')) > 0
          or position(v_search in coalesce(p.surface_normalized, '')) > 0
          or position(v_search in coalesce(upper(normalize(p.category, NFKC)), '')) > 0
          or position(v_search in coalesce(upper(normalize(p.collection, NFKC)), '')) > 0
        )
    ), page as (
      select * from filtered
      order by updated_at desc, name_normalized, width_mm, height_mm, surface_normalized, id
      limit p_limit offset p_offset
    )
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(public.catalog_admin_product_json_v1_06a(x.id)
          order by x.updated_at desc, x.name_normalized, x.width_mm, x.height_mm, x.surface_normalized, x.id)
        from page x
      ), '[]'::jsonb),
      'pagination', jsonb_build_object(
        'limit', p_limit,
        'offset', p_offset,
        'total', (select count(*) from filtered),
        'has_more', p_offset + p_limit < (select count(*) from filtered),
        'next_offset', case when p_offset + p_limit < (select count(*) from filtered) then p_offset + p_limit else null end
      )
    )
  );
end;
$$;

create function public.catalog_admin_update_product_v1(
  p_product_id uuid,
  p_expected_version bigint,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor text := public.catalog_require_admin_02b();
  v_old public.products%rowtype;
  v_new public.products%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_price_changed boolean;
  v_unpublish boolean;
begin
  if p_product_id is null or p_expected_version is null or p_expected_version < 1
     or p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception using errcode = '22023', message = 'CATALOG_06A_INVALID_UPDATE';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_changes) k
    where k not in (
      'code','name','width_mm','height_mm','surface','color','category','collection','description',
      'image_url','gallery_urls','pdf_url','video_url','more_info_url','price_per_m2',
      'price_effective_date','origin'
    )
  ) then
    raise exception using errcode = '22023', message = 'CATALOG_06A_FIELD_NOT_ALLOWED';
  end if;
  if (p_changes ? 'width_mm') <> (p_changes ? 'height_mm') then
    raise exception using errcode = '22023', message = 'CATALOG_06A_DIMENSION_PAIR_REQUIRED';
  end if;
  if exists (
    select 1 from jsonb_each(p_changes) e
    where e.key in ('code','name','surface','color','category','collection','description','image_url','pdf_url','video_url','more_info_url','origin','price_effective_date')
      and jsonb_typeof(e.value) not in ('string','null')
  ) or exists (
    select 1 from jsonb_each(p_changes) e
    where e.key in ('width_mm','height_mm','price_per_m2')
      and jsonb_typeof(e.value) not in ('number','string','null')
  ) then
    raise exception using errcode = '22023', message = 'CATALOG_06A_INVALID_FIELD_TYPE';
  end if;
  if p_changes ? 'gallery_urls' and jsonb_typeof(p_changes->'gallery_urls') <> 'array' then
    raise exception using errcode = '22023', message = 'CATALOG_06A_INVALID_GALLERY';
  end if;
  if p_changes ? 'name' and nullif(btrim(p_changes->>'name'), '') is null then
    raise exception using errcode = '22023', message = 'CATALOG_06A_NAME_REQUIRED';
  end if;
  if p_changes ? 'width_mm' and (
    (nullif(p_changes->>'width_mm','') is null) <> (nullif(p_changes->>'height_mm','') is null)
    or (nullif(p_changes->>'width_mm','') is not null and (
      (p_changes->>'width_mm') !~ '^[0-9]+$' or (p_changes->>'height_mm') !~ '^[0-9]+$'
    ))
  ) then
    raise exception using errcode = '22023', message = 'CATALOG_06A_INVALID_DIMENSIONS';
  end if;
  if p_changes ? 'price_per_m2'
     and nullif(p_changes->>'price_per_m2','') is not null
     and ((p_changes->>'price_per_m2') !~ '^[0-9]+$' or (p_changes->>'price_per_m2')::numeric <= 0) then
    raise exception using errcode = '22023', message = 'CATALOG_06A_INVALID_PRICE';
  end if;
  if p_changes ? 'price_effective_date'
     and nullif(p_changes->>'price_effective_date','') is not null
     and (p_changes->>'price_effective_date') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception using errcode = '22023', message = 'CATALOG_06A_INVALID_PRICE_DATE';
  end if;

  select * into v_old from public.products where id = p_product_id for update;
  if v_old.id is null then
    raise exception using errcode = 'P0002', message = 'CATALOG_06A_PRODUCT_NOT_FOUND';
  end if;
  if v_old.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'CATALOG_06A_VERSION_CONFLICT';
  end if;
  if p_changes = '{}'::jsonb then
    return public.catalog_admin_product_json_v1_06a(v_old.id);
  end if;

  v_before := public.catalog_admin_product_json_v1_06a(v_old.id);
  v_price_changed := (p_changes ? 'price_per_m2' and nullif(p_changes->>'price_per_m2','')::numeric is distinct from v_old.price_per_m2)
    or (p_changes ? 'price_effective_date' and nullif(p_changes->>'price_effective_date','')::date is distinct from v_old.price_effective_date);
  v_unpublish := p_changes ?| array['name','width_mm','height_mm','price_per_m2','price_effective_date'];

  update public.products p set
    code = case when p_changes ? 'code' then nullif(btrim(p_changes->>'code'),'') else p.code end,
    name = case when p_changes ? 'name' then btrim(p_changes->>'name') else p.name end,
    width_mm = case when p_changes ? 'width_mm' then nullif(p_changes->>'width_mm','')::integer else p.width_mm end,
    height_mm = case when p_changes ? 'height_mm' then nullif(p_changes->>'height_mm','')::integer else p.height_mm end,
    surface = case when p_changes ? 'surface' then nullif(btrim(p_changes->>'surface'),'') else p.surface end,
    color = case when p_changes ? 'color' then nullif(btrim(p_changes->>'color'),'') else p.color end,
    category = case when p_changes ? 'category' then nullif(btrim(p_changes->>'category'),'') else p.category end,
    collection = case when p_changes ? 'collection' then nullif(btrim(p_changes->>'collection'),'') else p.collection end,
    description = case when p_changes ? 'description' then nullif(btrim(p_changes->>'description'),'') else p.description end,
    image_url = case when p_changes ? 'image_url' then nullif(btrim(p_changes->>'image_url'),'') else p.image_url end,
    gallery_urls = case when p_changes ? 'gallery_urls' then p_changes->'gallery_urls' else p.gallery_urls end,
    pdf_url = case when p_changes ? 'pdf_url' then nullif(btrim(p_changes->>'pdf_url'),'') else p.pdf_url end,
    video_url = case when p_changes ? 'video_url' then nullif(btrim(p_changes->>'video_url'),'') else p.video_url end,
    more_info_url = case when p_changes ? 'more_info_url' then nullif(btrim(p_changes->>'more_info_url'),'') else p.more_info_url end,
    price_per_m2 = case when p_changes ? 'price_per_m2' then nullif(p_changes->>'price_per_m2','')::numeric else p.price_per_m2 end,
    price_effective_date = case when p_changes ? 'price_effective_date' then nullif(p_changes->>'price_effective_date','')::date else p.price_effective_date end,
    origin = case when p_changes ? 'origin' then nullif(btrim(p_changes->>'origin'),'') else p.origin end,
    is_published = case when v_unpublish then false else p.is_published end,
    version = p.version + 1,
    updated_at = now(),
    updated_by_user_id = v_actor
  where p.id = v_old.id
  returning p.* into v_new;

  if v_price_changed and v_new.price_per_m2 is not null then
    insert into public.product_price_history(
      product_id, price_per_m2, price_per_box, price_per_piece, pieces_per_box, sqm_per_box,
      effective_date, source_type, changed_by_user_id, reason,
      previous_price_per_m2, source_format, change_kind, product_version_before, product_version_after,
      change_metadata
    ) values (
      v_new.id, v_new.price_per_m2, v_new.price_per_box, v_new.price_per_piece,
      v_new.pieces_per_box, v_new.sqm_per_box, v_new.price_effective_date,
      'MANUAL', v_actor, 'Catalog admin 06A', v_old.price_per_m2, 'MANUAL',
      case when v_old.price_per_m2 is null then 'PRICE_SET' else 'PRICE_UPDATE' end,
      v_old.version, v_new.version, jsonb_build_object('source','ADMIN_06A')
    );
  end if;

  v_after := public.catalog_admin_product_json_v1_06a(v_new.id);
  perform public.crm_write_audit(
    'catalogAdminUpdate06A', 'products', v_new.id::text,
    jsonb_build_object('before', v_before, 'after', v_after, 'changed_fields', (select jsonb_agg(k order by k) from jsonb_object_keys(p_changes) k))
  );
  return v_after;
end;
$$;

create function public.catalog_admin_set_product_state_v1(
  p_product_id uuid,
  p_expected_version bigint,
  p_active boolean,
  p_is_published boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor text := public.catalog_require_admin_02b();
  v_old public.products%rowtype;
  v_after jsonb;
begin
  if p_product_id is null or p_expected_version is null or p_expected_version < 1
     or p_active is null or p_is_published is null then
    raise exception using errcode = '22023', message = 'CATALOG_06A_INVALID_STATE';
  end if;
  select * into v_old from public.products where id = p_product_id for update;
  if v_old.id is null then
    raise exception using errcode = 'P0002', message = 'CATALOG_06A_PRODUCT_NOT_FOUND';
  end if;
  if v_old.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'CATALOG_06A_VERSION_CONFLICT';
  end if;
  if p_is_published and (not p_active or v_old.data_status <> 'READY') then
    raise exception using errcode = '22023', message = 'CATALOG_06A_PUBLISH_GATE';
  end if;
  if v_old.active = p_active and v_old.is_published = p_is_published then
    return public.catalog_admin_product_json_v1_06a(v_old.id);
  end if;

  update public.products
  set active = p_active,
      is_published = p_is_published,
      version = version + 1,
      updated_at = now(),
      updated_by_user_id = v_actor
  where id = v_old.id;

  v_after := public.catalog_admin_product_json_v1_06a(v_old.id);
  perform public.crm_write_audit(
    'catalogAdminState06A', 'products', v_old.id::text,
    jsonb_build_object(
      'before', jsonb_build_object('active',v_old.active,'is_published',v_old.is_published,'version',v_old.version),
      'after', jsonb_build_object('active',p_active,'is_published',p_is_published,'version',v_old.version + 1)
    )
  );
  return v_after;
end;
$$;

revoke all on function public.catalog_admin_product_json_v1_06a(uuid) from public, anon, authenticated;
revoke all on function public.catalog_admin_list_products_v1(text,text,boolean,boolean,integer,integer) from public, anon, authenticated;
revoke all on function public.catalog_admin_update_product_v1(uuid,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.catalog_admin_set_product_state_v1(uuid,bigint,boolean,boolean) from public, anon, authenticated;

grant execute on function public.catalog_admin_list_products_v1(text,text,boolean,boolean,integer,integer) to authenticated;
grant execute on function public.catalog_admin_update_product_v1(uuid,bigint,jsonb) to authenticated;
grant execute on function public.catalog_admin_set_product_state_v1(uuid,bigint,boolean,boolean) to authenticated;

do $$
declare
  v_proc regprocedure;
begin
  foreach v_proc in array array[
    'public.catalog_admin_product_json_v1_06a(uuid)'::regprocedure,
    'public.catalog_admin_list_products_v1(text,text,boolean,boolean,integer,integer)'::regprocedure,
    'public.catalog_admin_update_product_v1(uuid,bigint,jsonb)'::regprocedure,
    'public.catalog_admin_set_product_state_v1(uuid,bigint,boolean,boolean)'::regprocedure
  ] loop
    if not exists (
      select 1 from pg_proc p
      where p.oid = v_proc and p.prosecdef
        and p.proconfig @> array['search_path=pg_catalog, public']
    ) then
      raise exception 'CATALOG_06A_VERIFY_FAIL: unsafe function %', v_proc;
    end if;
  end loop;
  if has_table_privilege('authenticated','public.products','INSERT,UPDATE,DELETE,TRUNCATE')
     or has_function_privilege('anon','public.catalog_admin_list_products_v1(text,text,boolean,boolean,integer,integer)','EXECUTE')
     or has_function_privilege('anon','public.catalog_admin_update_product_v1(uuid,bigint,jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.catalog_admin_list_products_v1(text,text,boolean,boolean,integer,integer)','EXECUTE')
     or not has_function_privilege('authenticated','public.catalog_admin_update_product_v1(uuid,bigint,jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.catalog_admin_set_product_state_v1(uuid,bigint,boolean,boolean)','EXECUTE') then
    raise exception 'CATALOG_06A_VERIFY_FAIL: grant matrix.';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
