-- CATALOG INTEGRATION 02B — fail-closed RLS/RPC integration.
-- Apply only after 01B. Browser roles never receive direct catalog-table writes.
begin;

select pg_advisory_xact_lock(hashtext('CATALOG-INTEGRATION-02B-RLS-RPC'));

do $$
declare
  v_missing text;
begin
  select string_agg(required_object, ', ' order by required_object)
    into v_missing
  from unnest(array[
    'public.products',
    'public.product_import_batches',
    'public.product_import_rows',
    'public.product_price_history',
    'public.product_source_mappings',
    'public.website_leads',
    'public.audit_logs'
  ]) required(required_object)
  where to_regclass(required_object) is null;

  if v_missing is not null then
    raise exception 'CATALOG_02B_PRECONDITION_FAIL: missing objects: %', v_missing;
  end if;

  if to_regprocedure('public.catalog_public_list_products(text,integer,integer)') is not null then
    raise exception 'CATALOG_02B_PRECONDITION_FAIL: migration already applied.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal helpers. These are SECURITY DEFINER but never browser-executable.
-- ---------------------------------------------------------------------------
create function public.catalog_require_admin_02b()
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor text := public.crm_current_app_user_id();
begin
  if auth.uid() is null
     or v_actor is null
     or not coalesce(public.crm_is_active_user(), false)
     or public.crm_current_user_role() not in ('admin', 'owner') then
    raise exception using errcode = '42501', message = 'CATALOG_ADMIN_REQUIRED';
  end if;
  return v_actor;
end;
$$;

create function public.catalog_product_snapshot_02b(p_product_id uuid)
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
    'price_per_box', p.price_per_box,
    'price_per_piece', p.price_per_piece,
    'pieces_per_box', p.pieces_per_box,
    'sqm_per_box', p.sqm_per_box,
    'origin', p.origin,
    'stock_quantity', p.stock_quantity,
    'price_effective_date', p.price_effective_date,
    'active', p.active,
    'is_published', p.is_published,
    'source_metadata', p.source_metadata,
    'version', p.version
  )
  from public.products p
  where p.id = p_product_id;
$$;

create function public.catalog_public_product_json_02b(p_product_id uuid)
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
    'origin', p.origin
  )
  from public.products p
  where p.id = p_product_id
    and p.active
    and p.data_status = 'READY'
    and p.is_published;
$$;

-- ---------------------------------------------------------------------------
-- Public catalog read API. It exposes only published READY rows and no source,
-- import, stock, audit or actor metadata.
-- ---------------------------------------------------------------------------
create function public.catalog_public_list_products(
  p_search text default null,
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
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 or p_offset > 100000 then
    raise exception using errcode = '22023', message = 'CATALOG_INVALID_PAGINATION';
  end if;

  return coalesce((
    select jsonb_agg(public.catalog_public_product_json_02b(x.id) order by x.name_normalized, x.width_mm, x.height_mm, x.surface_normalized, x.id)
    from (
      select p.id, p.name_normalized, p.width_mm, p.height_mm, p.surface_normalized
      from public.products p
      where p.active
        and p.data_status = 'READY'
        and p.is_published
        and (
          v_search is null
          or position(v_search in p.name_normalized) > 0
          or position(v_search in coalesce(upper(p.code), '')) > 0
          or position(v_search in coalesce(p.surface_normalized, '')) > 0
        )
      order by p.name_normalized, p.width_mm, p.height_mm, p.surface_normalized, p.id
      limit p_limit offset p_offset
    ) x
  ), '[]'::jsonb);
end;
$$;

create function public.catalog_public_get_product(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_product_id is null then
    raise exception using errcode = '22023', message = 'CATALOG_PRODUCT_ID_REQUIRED';
  end if;
  return public.catalog_public_product_json_02b(p_product_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- CRM search API. Active employees may search; sale remains read-only.
-- ---------------------------------------------------------------------------
create function public.catalog_crm_search_products(
  p_search text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := public.crm_current_user_role();
  v_search text := nullif(upper(regexp_replace(btrim(normalize(coalesce(p_search, ''), NFKC)), '[[:space:]]+', ' ', 'g')), '');
begin
  if auth.uid() is null
     or not coalesce(public.crm_is_active_user(), false)
     or v_role not in ('sale', 'manager', 'admin', 'owner') then
    raise exception using errcode = '42501', message = 'CATALOG_EMPLOYEE_REQUIRED';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'CATALOG_INVALID_LIMIT';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'code', p.code,
      'name', p.name,
      'width_mm', p.width_mm,
      'height_mm', p.height_mm,
      'surface', p.surface,
      'price_per_m2', p.price_per_m2,
      'price_unit', p.price_unit,
      'data_status', p.data_status,
      'is_published', p.is_published,
      'active', p.active,
      'version', p.version
    ) order by p.active desc, p.name_normalized, p.width_mm, p.height_mm, p.id)
    from (
      select p.*
      from public.products p
      where (p.active or v_role in ('manager', 'admin', 'owner'))
        and (
          v_search is null
          or position(v_search in p.name_normalized) > 0
          or position(v_search in coalesce(upper(p.code), '')) > 0
          or position(v_search in coalesce(p.surface_normalized, '')) > 0
        )
      order by p.active desc, p.name_normalized, p.width_mm, p.height_mm, p.id
      limit p_limit
    ) p
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin import preview. Matching/parsing remains the responsibility of 03A;
-- this RPC persists a validated preview and captures server-side snapshots.
-- ---------------------------------------------------------------------------
create function public.catalog_admin_preview_import(p_batch jsonb, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor text := public.catalog_require_admin_02b();
  v_batch_id uuid;
  v_mode text;
  v_format text;
  v_effective_date date;
  v_row jsonb;
  v_row_no integer := 0;
  v_matched_id uuid;
  v_expected_version bigint;
  v_current_version bigint;
  v_action text;
  v_classification text;
  v_disposition text;
  v_conflict text;
  v_previous jsonb;
  v_proposed jsonb;
  v_blocking integer;
  v_status text;
begin
  if p_batch is null or jsonb_typeof(p_batch) <> 'object'
     or p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 1000 then
    raise exception using errcode = '22023', message = 'CATALOG_IMPORT_PREVIEW_INVALID';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_batch) k
    where k not in ('supplier','source_filename','source_sha256','source_file_size_bytes','parser_adapter','parser_version','effective_date','import_mode','source_format','source_metadata')
  ) then
    raise exception using errcode = '22023', message = 'CATALOG_IMPORT_BATCH_FIELD_NOT_ALLOWED';
  end if;

  v_mode := upper(coalesce(nullif(btrim(p_batch->>'import_mode'), ''), 'PRICE_UPDATE_ONLY'));
  v_format := upper(coalesce(nullif(btrim(p_batch->>'source_format'), ''), 'EXCEL'));
  v_effective_date := (p_batch->>'effective_date')::date;

  if v_mode not in ('CATALOG_IMPORT', 'PRICE_UPDATE_ONLY')
     or v_format not in ('PDF', 'EXCEL', 'MANUAL')
     or coalesce(p_batch->>'supplier', '') = ''
     or coalesce(p_batch->>'source_filename', '') = ''
     or coalesce(p_batch->>'source_sha256', '') !~ '^[A-Fa-f0-9]{64}$'
     or coalesce((p_batch->>'source_file_size_bytes')::bigint, 0) <= 0
     or coalesce(p_batch->>'parser_adapter', '') = ''
     or coalesce(p_batch->>'parser_version', '') = ''
     or v_effective_date is null
     or (p_batch ? 'source_metadata' and jsonb_typeof(p_batch->'source_metadata') <> 'object') then
    raise exception using errcode = '22023', message = 'CATALOG_IMPORT_BATCH_INVALID';
  end if;

  insert into public.product_import_batches(
    supplier, source_filename, source_sha256, source_file_size_bytes,
    parser_adapter, parser_version, effective_date, status,
    created_by_user_id, import_mode, source_format, source_metadata
  ) values (
    btrim(p_batch->>'supplier'), btrim(p_batch->>'source_filename'), lower(p_batch->>'source_sha256'),
    (p_batch->>'source_file_size_bytes')::bigint,
    btrim(p_batch->>'parser_adapter'), btrim(p_batch->>'parser_version'), v_effective_date, 'STAGED',
    v_actor, v_mode, v_format, coalesce(p_batch->'source_metadata', '{}'::jsonb)
  ) returning id into v_batch_id;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_row_no := v_row_no + 1;
    if jsonb_typeof(v_row) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(v_row) k
         where k not in (
           'source_page','source_row_number','source_sheet','source_cell_ref','source_record_id','source_values',
           'source_size_text','source_size_unit','source_packaging_text','code','name','width_mm','height_mm',
           'surface','classification','disposition','match_rule','conflict_code','selected_action',
           'matched_product_id','current_product_version','warnings','proposed_snapshot'
         )
       ) then
      raise exception using errcode = '22023', message = 'CATALOG_IMPORT_ROW_INVALID';
    end if;

    v_action := upper(coalesce(nullif(v_row->>'selected_action', ''), 'NONE'));
    v_classification := upper(coalesce(nullif(v_row->>'classification', ''), 'REVIEW'));
    v_disposition := upper(coalesce(nullif(v_row->>'disposition', ''), 'MANUAL_REVIEW'));
    v_conflict := nullif(btrim(v_row->>'conflict_code'), '');
    v_proposed := coalesce(v_row->'proposed_snapshot', '{}'::jsonb);
    v_matched_id := nullif(v_row->>'matched_product_id', '')::uuid;
    v_expected_version := nullif(v_row->>'current_product_version', '')::bigint;
    v_previous := '{}'::jsonb;

    if v_action not in ('NONE','CREATE','UPDATE','SKIP')
       or v_classification not in ('NEW','UNCHANGED','CHANGED','DUPLICATE_IN_FILE','CONFLICT','INVALID','REVIEW')
       or v_disposition not in ('READY','UPDATING','MISSING_PRICE','MANUAL_REVIEW','DUPLICATE','CONFLICT','EXCLUDED_BY_REVIEW')
       or jsonb_typeof(v_proposed) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(v_proposed) k
         where k not in (
           'code','name','width_mm','height_mm','surface','color','category','collection','description',
           'image_url','gallery_urls','pdf_url','video_url','more_info_url','price_per_m2','price_per_box',
           'price_per_piece','pieces_per_box','sqm_per_box','origin','stock_quantity','price_effective_date',
           'active','is_published','source_metadata'
         )
       ) then
      raise exception using errcode = '22023', message = 'CATALOG_IMPORT_ROW_CONTRACT_INVALID';
    end if;

    if v_action = 'CREATE' and v_mode = 'PRICE_UPDATE_ONLY' then
      v_action := 'NONE'; v_classification := 'CONFLICT'; v_disposition := 'CONFLICT'; v_conflict := 'PRICE_ONLY_CREATE_FORBIDDEN';
    elsif v_action = 'CREATE' and nullif(btrim(v_proposed->>'name'), '') is null then
      v_action := 'NONE'; v_classification := 'INVALID'; v_disposition := 'MANUAL_REVIEW'; v_conflict := 'NAME_REQUIRED';
    elsif v_action = 'UPDATE' then
      if v_matched_id is null or v_expected_version is null then
        v_action := 'NONE'; v_classification := 'CONFLICT'; v_disposition := 'CONFLICT'; v_conflict := 'MATCH_AND_VERSION_REQUIRED';
      else
        select p.version, public.catalog_product_snapshot_02b(p.id)
          into v_current_version, v_previous
        from public.products p where p.id = v_matched_id;
        if v_current_version is null or v_current_version <> v_expected_version then
          v_action := 'NONE'; v_classification := 'CONFLICT'; v_disposition := 'CONFLICT'; v_conflict := 'STALE_PRODUCT_VERSION';
        end if;
      end if;
    end if;

    if v_mode = 'PRICE_UPDATE_ONLY' and v_action = 'UPDATE' then
      if (v_proposed->>'price_per_m2') is null
         or (v_proposed->>'price_per_m2')::numeric <= 0
         or exists (
           select 1 from jsonb_object_keys(v_proposed) k
           where k not in ('price_per_m2','price_per_box','price_per_piece','pieces_per_box','sqm_per_box','price_effective_date')
         ) then
        v_action := 'NONE'; v_classification := 'CONFLICT'; v_disposition := 'CONFLICT'; v_conflict := 'PRICE_ONLY_FIELDS_INVALID';
      end if;
    end if;

    insert into public.product_import_rows(
      batch_id, source_page, source_row_number, source_values,
      source_size_text, source_size_unit, source_packaging_text,
      code, code_normalized, name, name_normalized, width_cm, height_cm,
      price_per_m2, price_per_box, price_per_piece, pieces_per_box, sqm_per_box,
      surface_candidate, warnings, classification, matched_product_id, selected_action,
      current_product_version, source_sheet, source_cell_ref, source_record_id,
      width_mm, height_mm, surface_normalized, disposition, match_rule, conflict_code,
      previous_snapshot, proposed_snapshot, rollback_snapshot
    ) values (
      v_batch_id,
      coalesce(nullif(v_row->>'source_page', '')::smallint, 1),
      coalesce(nullif(v_row->>'source_row_number', '')::integer, v_row_no),
      coalesce(v_row->'source_values', '{}'::jsonb),
      nullif(v_row->>'source_size_text',''), nullif(v_row->>'source_size_unit',''), nullif(v_row->>'source_packaging_text',''),
      nullif(v_row->>'code',''), nullif(upper(btrim(v_row->>'code')), ''),
      nullif(v_row->>'name',''), nullif(upper(regexp_replace(btrim(normalize(coalesce(v_row->>'name',''), NFKC)), '[[:space:]]+', ' ', 'g')), ''),
      case when nullif(v_row->>'width_mm','') is null then null else (v_row->>'width_mm')::numeric / 10 end,
      case when nullif(v_row->>'height_mm','') is null then null else (v_row->>'height_mm')::numeric / 10 end,
      nullif(v_proposed->>'price_per_m2','')::numeric,
      nullif(v_proposed->>'price_per_box','')::numeric,
      nullif(v_proposed->>'price_per_piece','')::numeric,
      nullif(v_proposed->>'pieces_per_box','')::integer,
      nullif(v_proposed->>'sqm_per_box','')::numeric,
      nullif(v_row->>'surface',''),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_row->'warnings','[]'::jsonb))), '{}'::text[]),
      v_classification, v_matched_id, v_action, v_expected_version,
      nullif(v_row->>'source_sheet',''), nullif(v_row->>'source_cell_ref',''), nullif(v_row->>'source_record_id',''),
      nullif(v_row->>'width_mm','')::integer, nullif(v_row->>'height_mm','')::integer,
      nullif(upper(regexp_replace(btrim(normalize(coalesce(v_row->>'surface',''), NFKC)), '[[:space:]]+', ' ', 'g')), ''),
      v_disposition, nullif(v_row->>'match_rule',''), v_conflict,
      coalesce(v_previous, '{}'::jsonb), v_proposed, '{}'::jsonb
    );
  end loop;

  select count(*) into v_blocking
  from public.product_import_rows r
  where r.batch_id = v_batch_id
    and r.classification in ('DUPLICATE_IN_FILE','CONFLICT','INVALID','REVIEW')
    and r.selected_action <> 'SKIP';
  v_status := case when v_blocking = 0 then 'READY' else 'STAGED' end;
  update public.product_import_batches set status = v_status where id = v_batch_id;

  perform public.crm_write_audit(
    'catalogImportPreview02B', 'product_import_batches', v_batch_id::text,
    jsonb_build_object('mode', v_mode, 'format', v_format, 'rows', v_row_no, 'blocking', v_blocking, 'status', v_status)
  );
  return jsonb_build_object('batch_id', v_batch_id, 'status', v_status, 'rows', v_row_no, 'blocking', v_blocking);
end;
$$;

-- ---------------------------------------------------------------------------
-- Apply a READY preview. Every UPDATE uses optimistic version checks. Catalog
-- imports may create drafts; price-only batches can never create products.
-- ---------------------------------------------------------------------------
create function public.catalog_admin_apply_import(p_batch_id uuid, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor text := public.catalog_require_admin_02b();
  b public.product_import_batches%rowtype;
  r public.product_import_rows%rowtype;
  p public.products%rowtype;
  v_new_id uuid;
  v_before jsonb;
  v_price_changed boolean;
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_history integer := 0;
  v_summary jsonb;
begin
  if p_batch_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'CATALOG_IMPORT_APPLY_KEYS_REQUIRED';
  end if;
  select * into b from public.product_import_batches where id = p_batch_id for update;
  if b.id is null then raise exception using errcode = 'P0002', message = 'CATALOG_IMPORT_BATCH_NOT_FOUND'; end if;
  if b.status = 'APPLIED' then
    if b.confirm_idempotency_key = p_idempotency_key then
      return jsonb_build_object('batch_id', b.id, 'status', 'APPLIED', 'idempotent_replay', true);
    end if;
    raise exception using errcode = 'P0001', message = 'CATALOG_IMPORT_ALREADY_APPLIED';
  end if;
  if b.status <> 'READY' or b.import_mode = 'ROLLBACK' then
    raise exception using errcode = 'P0001', message = 'CATALOG_IMPORT_NOT_READY';
  end if;

  for r in select * from public.product_import_rows where batch_id = b.id order by source_page, source_row_number, id loop
    if r.selected_action in ('NONE','SKIP') then v_skipped := v_skipped + 1; continue; end if;
    if r.selected_action not in ('CREATE','UPDATE')
       or r.classification in ('DUPLICATE_IN_FILE','CONFLICT','INVALID','REVIEW') then
      raise exception using errcode = 'P0001', message = 'CATALOG_IMPORT_UNRESOLVED_ROW';
    end if;

    if r.selected_action = 'CREATE' then
      if b.import_mode = 'PRICE_UPDATE_ONLY' then
        raise exception using errcode = '42501', message = 'CATALOG_PRICE_ONLY_CREATE_FORBIDDEN';
      end if;
      insert into public.products(
        code, name, width_mm, height_mm, surface, color, category, collection, description,
        image_url, gallery_urls, pdf_url, video_url, more_info_url,
        price_per_m2, price_per_box, price_per_piece, pieces_per_box, sqm_per_box,
        origin, stock_quantity, price_effective_date, active, is_published, source_metadata,
        created_by_user_id, updated_by_user_id
      ) values (
        nullif(r.proposed_snapshot->>'code',''), btrim(r.proposed_snapshot->>'name'),
        nullif(r.proposed_snapshot->>'width_mm','')::integer, nullif(r.proposed_snapshot->>'height_mm','')::integer,
        nullif(r.proposed_snapshot->>'surface',''), nullif(r.proposed_snapshot->>'color',''),
        nullif(r.proposed_snapshot->>'category',''), nullif(r.proposed_snapshot->>'collection',''),
        nullif(r.proposed_snapshot->>'description',''), nullif(r.proposed_snapshot->>'image_url',''),
        coalesce(r.proposed_snapshot->'gallery_urls','[]'::jsonb), nullif(r.proposed_snapshot->>'pdf_url',''),
        nullif(r.proposed_snapshot->>'video_url',''), nullif(r.proposed_snapshot->>'more_info_url',''),
        nullif(r.proposed_snapshot->>'price_per_m2','')::numeric,
        nullif(r.proposed_snapshot->>'price_per_box','')::numeric,
        nullif(r.proposed_snapshot->>'price_per_piece','')::numeric,
        nullif(r.proposed_snapshot->>'pieces_per_box','')::integer,
        nullif(r.proposed_snapshot->>'sqm_per_box','')::numeric,
        nullif(r.proposed_snapshot->>'origin',''), nullif(r.proposed_snapshot->>'stock_quantity','')::numeric,
        nullif(r.proposed_snapshot->>'price_effective_date','')::date,
        coalesce((r.proposed_snapshot->>'active')::boolean, true), false,
        coalesce(r.proposed_snapshot->'source_metadata','{}'::jsonb), v_actor, v_actor
      ) returning id into v_new_id;
      update public.product_import_rows
      set matched_product_id = v_new_id,
          rollback_snapshot = jsonb_build_object('created', true, 'product_id', v_new_id, 'apply_version_after', 1)
      where id = r.id;
      if nullif(r.proposed_snapshot->>'price_per_m2','') is not null then
        insert into public.product_price_history(
          product_id, price_per_m2, price_per_box, price_per_piece, pieces_per_box, sqm_per_box,
          effective_date, source_type, import_batch_id, changed_by_user_id, reason,
          previous_price_per_m2, source_format, change_kind, product_version_after,
          change_metadata
        ) values (
          v_new_id, (r.proposed_snapshot->>'price_per_m2')::numeric,
          nullif(r.proposed_snapshot->>'price_per_box','')::numeric,
          nullif(r.proposed_snapshot->>'price_per_piece','')::numeric,
          nullif(r.proposed_snapshot->>'pieces_per_box','')::integer,
          nullif(r.proposed_snapshot->>'sqm_per_box','')::numeric,
          (r.proposed_snapshot->>'price_effective_date')::date,
          'PDF_IMPORT', b.id, v_actor, 'Catalog import 02B', null, b.source_format, 'PRICE_SET', 1,
          jsonb_build_object('row_id', r.id)
        );
        v_history := v_history + 1;
      end if;
      v_created := v_created + 1;
    else
      select * into p from public.products where id = r.matched_product_id for update;
      if p.id is null or p.version is distinct from r.current_product_version then
        raise exception using errcode = '40001', message = 'CATALOG_IMPORT_STALE_PRODUCT';
      end if;
      v_before := public.catalog_product_snapshot_02b(p.id);
      v_price_changed := p.price_per_m2 is distinct from case when r.proposed_snapshot ? 'price_per_m2' then nullif(r.proposed_snapshot->>'price_per_m2','')::numeric else p.price_per_m2 end;

      update public.products set
        code = case when r.proposed_snapshot ? 'code' then nullif(r.proposed_snapshot->>'code','') else p.code end,
        name = case when r.proposed_snapshot ? 'name' then nullif(btrim(r.proposed_snapshot->>'name'),'') else p.name end,
        width_mm = case when r.proposed_snapshot ? 'width_mm' then nullif(r.proposed_snapshot->>'width_mm','')::integer else p.width_mm end,
        height_mm = case when r.proposed_snapshot ? 'height_mm' then nullif(r.proposed_snapshot->>'height_mm','')::integer else p.height_mm end,
        surface = case when r.proposed_snapshot ? 'surface' then nullif(r.proposed_snapshot->>'surface','') else p.surface end,
        color = case when r.proposed_snapshot ? 'color' then nullif(r.proposed_snapshot->>'color','') else p.color end,
        category = case when r.proposed_snapshot ? 'category' then nullif(r.proposed_snapshot->>'category','') else p.category end,
        collection = case when r.proposed_snapshot ? 'collection' then nullif(r.proposed_snapshot->>'collection','') else p.collection end,
        description = case when r.proposed_snapshot ? 'description' then nullif(r.proposed_snapshot->>'description','') else p.description end,
        image_url = case when r.proposed_snapshot ? 'image_url' then nullif(r.proposed_snapshot->>'image_url','') else p.image_url end,
        gallery_urls = case when r.proposed_snapshot ? 'gallery_urls' then r.proposed_snapshot->'gallery_urls' else p.gallery_urls end,
        pdf_url = case when r.proposed_snapshot ? 'pdf_url' then nullif(r.proposed_snapshot->>'pdf_url','') else p.pdf_url end,
        video_url = case when r.proposed_snapshot ? 'video_url' then nullif(r.proposed_snapshot->>'video_url','') else p.video_url end,
        more_info_url = case when r.proposed_snapshot ? 'more_info_url' then nullif(r.proposed_snapshot->>'more_info_url','') else p.more_info_url end,
        price_per_m2 = case when r.proposed_snapshot ? 'price_per_m2' then nullif(r.proposed_snapshot->>'price_per_m2','')::numeric else p.price_per_m2 end,
        price_per_box = case when r.proposed_snapshot ? 'price_per_box' then nullif(r.proposed_snapshot->>'price_per_box','')::numeric else p.price_per_box end,
        price_per_piece = case when r.proposed_snapshot ? 'price_per_piece' then nullif(r.proposed_snapshot->>'price_per_piece','')::numeric else p.price_per_piece end,
        pieces_per_box = case when r.proposed_snapshot ? 'pieces_per_box' then nullif(r.proposed_snapshot->>'pieces_per_box','')::integer else p.pieces_per_box end,
        sqm_per_box = case when r.proposed_snapshot ? 'sqm_per_box' then nullif(r.proposed_snapshot->>'sqm_per_box','')::numeric else p.sqm_per_box end,
        origin = case when r.proposed_snapshot ? 'origin' then nullif(r.proposed_snapshot->>'origin','') else p.origin end,
        stock_quantity = case when r.proposed_snapshot ? 'stock_quantity' then nullif(r.proposed_snapshot->>'stock_quantity','')::numeric else p.stock_quantity end,
        price_effective_date = case when r.proposed_snapshot ? 'price_effective_date' then nullif(r.proposed_snapshot->>'price_effective_date','')::date else p.price_effective_date end,
        active = case when r.proposed_snapshot ? 'active' then (r.proposed_snapshot->>'active')::boolean else p.active end,
        is_published = case when r.proposed_snapshot ? 'is_published' then (r.proposed_snapshot->>'is_published')::boolean else p.is_published end,
        source_metadata = case when r.proposed_snapshot ? 'source_metadata' then r.proposed_snapshot->'source_metadata' else p.source_metadata end,
        version = p.version + 1, updated_at = now(), updated_by_user_id = v_actor
      where id = p.id;

      update public.product_import_rows
      set rollback_snapshot = v_before || jsonb_build_object('created', false, 'apply_version_after', p.version + 1)
      where id = r.id;

      if v_price_changed and nullif(r.proposed_snapshot->>'price_per_m2','') is not null then
        insert into public.product_price_history(
          product_id, price_per_m2, price_per_box, price_per_piece, pieces_per_box, sqm_per_box,
          effective_date, source_type, import_batch_id, changed_by_user_id, reason,
          previous_price_per_m2, source_format, change_kind, product_version_before, product_version_after,
          change_metadata
        )
        select p.id, x.price_per_m2, x.price_per_box, x.price_per_piece, x.pieces_per_box, x.sqm_per_box,
          x.price_effective_date, 'PDF_IMPORT', b.id, v_actor, 'Catalog import 02B',
          p.price_per_m2, b.source_format, 'PRICE_UPDATE', p.version, x.version,
          jsonb_build_object('row_id', r.id)
        from public.products x where x.id = p.id;
        v_history := v_history + 1;
      end if;
      v_updated := v_updated + 1;
    end if;
  end loop;

  v_summary := jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped, 'history_created', v_history);
  update public.product_import_batches
  set status = 'APPLIED', confirm_idempotency_key = p_idempotency_key,
      confirmed_by_user_id = v_actor, confirmed_at = now(), applied_at = now()
  where id = b.id;
  perform public.crm_write_audit('catalogImportApply02B', 'product_import_batches', b.id::text, v_summary);
  return jsonb_build_object('batch_id', b.id, 'status', 'APPLIED', 'summary', v_summary, 'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Compensating rollback. Updated rows are restored with a monotonic version;
-- products created by the batch are archived (history remains immutable).
-- ---------------------------------------------------------------------------
create function public.catalog_admin_rollback_import(p_batch_id uuid, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor text := public.catalog_require_admin_02b();
  b public.product_import_batches%rowtype;
  r public.product_import_rows%rowtype;
  p public.products%rowtype;
  s jsonb;
  v_rollback_batch_id uuid;
  v_restored integer := 0;
  v_archived integer := 0;
  v_history integer := 0;
  v_original_history_id uuid;
  v_summary jsonb;
begin
  if p_batch_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'CATALOG_IMPORT_ROLLBACK_KEYS_REQUIRED';
  end if;
  select * into b from public.product_import_batches where id = p_batch_id for update;
  if b.id is null then raise exception using errcode = 'P0002', message = 'CATALOG_IMPORT_BATCH_NOT_FOUND'; end if;
  if b.rolled_back_at is not null then
    if b.rollback_idempotency_key = p_idempotency_key then
      return jsonb_build_object('batch_id', b.id, 'status', 'ROLLED_BACK', 'idempotent_replay', true);
    end if;
    raise exception using errcode = 'P0001', message = 'CATALOG_IMPORT_ALREADY_ROLLED_BACK';
  end if;
  if b.status <> 'APPLIED' or b.import_mode = 'ROLLBACK' then
    raise exception using errcode = 'P0001', message = 'CATALOG_IMPORT_NOT_APPLIED';
  end if;

  insert into public.product_import_batches(
    supplier, source_filename, source_sha256, source_file_size_bytes,
    parser_adapter, parser_version, effective_date, status,
    confirm_idempotency_key, created_by_user_id, confirmed_by_user_id, confirmed_at, applied_at,
    import_mode, source_format, source_metadata, rollback_of_batch_id
  ) values (
    b.supplier, left('rollback-' || b.source_filename, 255), b.source_sha256, b.source_file_size_bytes,
    b.parser_adapter || '-rollback-02b', b.parser_version, current_date, 'APPLIED',
    p_idempotency_key, v_actor, v_actor, now(), now(),
    'ROLLBACK', 'MANUAL', jsonb_build_object('original_batch_id', b.id), b.id
  ) returning id into v_rollback_batch_id;

  for r in select * from public.product_import_rows where batch_id = b.id and selected_action in ('CREATE','UPDATE') order by source_page desc, source_row_number desc, id desc loop
    s := r.rollback_snapshot;
    select * into p from public.products where id = r.matched_product_id for update;
    if p.id is null or p.version is distinct from nullif(s->>'apply_version_after','')::bigint then
      raise exception using errcode = '40001', message = 'CATALOG_ROLLBACK_VERSION_CONFLICT';
    end if;

    if coalesce((s->>'created')::boolean, false) then
      update public.products
      set active = false, is_published = false,
          source_metadata = source_metadata || jsonb_build_object('rolled_back_batch_id', b.id),
          version = p.version + 1, updated_at = now(), updated_by_user_id = v_actor
      where id = p.id;
      v_archived := v_archived + 1;
    else
      select h.id into v_original_history_id
      from public.product_price_history h
      where h.import_batch_id = b.id and h.product_id = p.id
      order by h.changed_at desc, h.id desc limit 1;

      update public.products set
        code = nullif(s->>'code',''), name = s->>'name',
        width_mm = nullif(s->>'width_mm','')::integer, height_mm = nullif(s->>'height_mm','')::integer,
        surface = nullif(s->>'surface',''), color = nullif(s->>'color',''),
        category = nullif(s->>'category',''), collection = nullif(s->>'collection',''),
        description = nullif(s->>'description',''), image_url = nullif(s->>'image_url',''),
        gallery_urls = coalesce(s->'gallery_urls','[]'::jsonb), pdf_url = nullif(s->>'pdf_url',''),
        video_url = nullif(s->>'video_url',''), more_info_url = nullif(s->>'more_info_url',''),
        price_per_m2 = nullif(s->>'price_per_m2','')::numeric,
        price_per_box = nullif(s->>'price_per_box','')::numeric,
        price_per_piece = nullif(s->>'price_per_piece','')::numeric,
        pieces_per_box = nullif(s->>'pieces_per_box','')::integer,
        sqm_per_box = nullif(s->>'sqm_per_box','')::numeric,
        origin = nullif(s->>'origin',''), stock_quantity = nullif(s->>'stock_quantity','')::numeric,
        price_effective_date = nullif(s->>'price_effective_date','')::date,
        active = (s->>'active')::boolean, is_published = (s->>'is_published')::boolean,
        source_metadata = coalesce(s->'source_metadata','{}'::jsonb),
        version = p.version + 1, updated_at = now(), updated_by_user_id = v_actor
      where id = p.id;

      if v_original_history_id is not null and nullif(s->>'price_per_m2','') is not null then
        insert into public.product_price_history(
          product_id, price_per_m2, price_per_box, price_per_piece, pieces_per_box, sqm_per_box,
          effective_date, source_type, import_batch_id, changed_by_user_id, reason,
          previous_price_per_m2, source_format, change_kind, rollback_of_history_id,
          product_version_before, product_version_after, change_metadata
        ) values (
          p.id, (s->>'price_per_m2')::numeric,
          nullif(s->>'price_per_box','')::numeric, nullif(s->>'price_per_piece','')::numeric,
          nullif(s->>'pieces_per_box','')::integer, nullif(s->>'sqm_per_box','')::numeric,
          (s->>'price_effective_date')::date, 'PDF_IMPORT', v_rollback_batch_id, v_actor,
          'Catalog rollback 02B', p.price_per_m2, 'MANUAL', 'ROLLBACK', v_original_history_id,
          p.version, p.version + 1, jsonb_build_object('original_batch_id', b.id, 'row_id', r.id)
        );
        v_history := v_history + 1;
      end if;
      v_restored := v_restored + 1;
    end if;
  end loop;

  v_summary := jsonb_build_object('restored', v_restored, 'archived_created', v_archived, 'history_created', v_history, 'rollback_batch_id', v_rollback_batch_id);
  update public.product_import_batches
  set status = 'CANCELLED', rollback_idempotency_key = p_idempotency_key,
      rolled_back_at = now(), rolled_back_by_user_id = v_actor
  where id = b.id;
  perform public.crm_write_audit('catalogImportRollback02B', 'product_import_batches', b.id::text, v_summary);
  return jsonb_build_object('batch_id', b.id, 'status', 'ROLLED_BACK', 'summary', v_summary, 'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Public lead submission with a contact-key advisory lock and five requests
-- per fifteen minutes. PII is never copied into audit payloads.
-- ---------------------------------------------------------------------------
create function public.catalog_submit_website_lead(p_lead jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_product_id uuid;
  v_name text;
  v_phone text;
  v_email text;
  v_message text;
  v_source_path text;
  v_utm jsonb;
  v_contact_key text;
  v_recent integer;
begin
  if p_lead is null or jsonb_typeof(p_lead) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(p_lead) k
       where k not in ('product_id','contact_name','phone','email','message','source_path','utm','privacy_consent')
     ) then
    raise exception using errcode = '22023', message = 'WEBSITE_LEAD_INVALID';
  end if;
  v_product_id := nullif(p_lead->>'product_id','')::uuid;
  v_name := nullif(btrim(p_lead->>'contact_name'), '');
  v_phone := nullif(regexp_replace(coalesce(p_lead->>'phone',''), '[[:space:]]+', '', 'g'), '');
  v_email := nullif(lower(btrim(p_lead->>'email')), '');
  v_message := nullif(btrim(p_lead->>'message'), '');
  v_source_path := nullif(btrim(p_lead->>'source_path'), '');
  v_utm := coalesce(p_lead->'utm', '{}'::jsonb);

  if v_name is null or length(v_name) > 200
     or (v_phone is null and v_email is null)
     or (v_phone is not null and (length(v_phone) > 50 or v_phone !~ '^[+0-9().-]{7,50}$'))
     or (v_email is not null and (length(v_email) > 320 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'))
     or length(coalesce(v_message,'')) > 4000
     or length(coalesce(v_source_path,'')) > 1000
     or jsonb_typeof(v_utm) <> 'object'
     or coalesce((p_lead->>'privacy_consent')::boolean, false) is not true then
    raise exception using errcode = '22023', message = 'WEBSITE_LEAD_VALIDATION_FAILED';
  end if;
  if v_product_id is not null and public.catalog_public_product_json_02b(v_product_id) is null then
    raise exception using errcode = '22023', message = 'WEBSITE_LEAD_PRODUCT_NOT_PUBLIC';
  end if;

  v_contact_key := coalesce(v_email, '') || '|' || coalesce(v_phone, '');
  perform pg_advisory_xact_lock(hashtext('WEBSITE_LEAD_02B|' || v_contact_key));
  select count(*) into v_recent
  from public.website_leads l
  where l.created_at >= now() - interval '15 minutes'
    and lower(coalesce(l.email, '')) = coalesce(v_email, '')
    and regexp_replace(coalesce(l.phone, ''), '[[:space:]]+', '', 'g') = coalesce(v_phone, '');
  if v_recent >= 5 then
    raise exception using errcode = 'P0001', message = 'WEBSITE_LEAD_RATE_LIMITED';
  end if;

  insert into public.website_leads(
    product_id, contact_name, phone, email, message, source_path, utm, privacy_consent_at
  ) values (
    v_product_id, v_name, v_phone, v_email, v_message, v_source_path, v_utm, now()
  ) returning id into v_id;
  perform public.crm_write_audit(
    'websiteLeadCreate02B', 'website_leads', v_id::text,
    jsonb_build_object('product_id', v_product_id, 'source_path', v_source_path)
  );
  return jsonb_build_object('id', v_id, 'status', 'RECEIVED');
end;
$$;

create function public.catalog_admin_list_website_leads(p_status text default null, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.catalog_require_admin_02b();
  if p_limit is null or p_limit < 1 or p_limit > 500
     or (p_status is not null and upper(p_status) not in ('NEW','CONTACTED','CLOSED','SPAM')) then
    raise exception using errcode = '22023', message = 'WEBSITE_LEAD_QUERY_INVALID';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id)
    from (
      select l.id, l.product_id, l.contact_name, l.phone, l.email, l.message,
             l.source_path, l.utm, l.status, l.privacy_consent_at,
             l.assigned_to_user_id, l.created_at, l.updated_at
      from public.website_leads l
      where p_status is null or l.status = upper(p_status)
      order by l.created_at desc, l.id
      limit p_limit
    ) x
  ), '[]'::jsonb);
end;
$$;

create function public.catalog_admin_update_website_lead(
  p_lead_id uuid,
  p_status text,
  p_assigned_to_user_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor text := public.catalog_require_admin_02b();
  v_result jsonb;
begin
  if p_lead_id is null or upper(coalesce(p_status,'')) not in ('NEW','CONTACTED','CLOSED','SPAM')
     or (p_assigned_to_user_id is not null and not exists (
       select 1 from public.app_users u where u.id = p_assigned_to_user_id and u.active and u.lifecycle_status = 'active'
     )) then
    raise exception using errcode = '22023', message = 'WEBSITE_LEAD_UPDATE_INVALID';
  end if;
  update public.website_leads
  set status = upper(p_status), assigned_to_user_id = p_assigned_to_user_id, updated_at = now()
  where id = p_lead_id
  returning jsonb_build_object('id', id, 'status', status, 'assigned_to_user_id', assigned_to_user_id, 'updated_at', updated_at)
    into v_result;
  if v_result is null then raise exception using errcode = 'P0002', message = 'WEBSITE_LEAD_NOT_FOUND'; end if;
  perform public.crm_write_audit(
    'websiteLeadUpdate02B', 'website_leads', p_lead_id::text,
    jsonb_build_object('status', upper(p_status), 'assigned_to_user_id', p_assigned_to_user_id, 'actor', v_actor)
  );
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants and RLS: fail closed at tables, explicit allow-list at RPCs.
-- ---------------------------------------------------------------------------
alter table public.products enable row level security;
alter table public.product_import_batches enable row level security;
alter table public.product_import_rows enable row level security;
alter table public.product_price_history enable row level security;
alter table public.product_source_mappings enable row level security;
alter table public.website_leads enable row level security;

revoke all on public.products, public.product_import_batches, public.product_import_rows,
  public.product_price_history, public.product_source_mappings, public.website_leads
  from public, anon;
revoke insert, update, delete, truncate on public.products, public.product_import_batches,
  public.product_import_rows, public.product_price_history, public.product_source_mappings,
  public.website_leads from authenticated;

-- Catalog mutations move to admin-only APIs. Existing CRM read APIs remain.
revoke all on function public.crm_create_product(jsonb) from public, anon, authenticated;
revoke all on function public.crm_update_product(uuid,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.crm_set_product_active(uuid,bigint,boolean) from public, anon, authenticated;
revoke all on function public.crm_write_audit(text,text,text,jsonb) from public, anon, authenticated;

revoke all on function public.catalog_require_admin_02b() from public, anon, authenticated;
revoke all on function public.catalog_product_snapshot_02b(uuid) from public, anon, authenticated;
revoke all on function public.catalog_public_product_json_02b(uuid) from public, anon, authenticated;
revoke all on function public.catalog_public_list_products(text,integer,integer) from public, anon, authenticated;
revoke all on function public.catalog_public_get_product(uuid) from public, anon, authenticated;
revoke all on function public.catalog_crm_search_products(text,integer) from public, anon, authenticated;
revoke all on function public.catalog_admin_preview_import(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.catalog_admin_apply_import(uuid,uuid) from public, anon, authenticated;
revoke all on function public.catalog_admin_rollback_import(uuid,uuid) from public, anon, authenticated;
revoke all on function public.catalog_submit_website_lead(jsonb) from public, anon, authenticated;
revoke all on function public.catalog_admin_list_website_leads(text,integer) from public, anon, authenticated;
revoke all on function public.catalog_admin_update_website_lead(uuid,text,text) from public, anon, authenticated;

grant execute on function public.catalog_public_list_products(text,integer,integer) to anon, authenticated;
grant execute on function public.catalog_public_get_product(uuid) to anon, authenticated;
grant execute on function public.catalog_submit_website_lead(jsonb) to anon, authenticated;
grant execute on function public.catalog_crm_search_products(text,integer) to authenticated;
grant execute on function public.catalog_admin_preview_import(jsonb,jsonb) to authenticated;
grant execute on function public.catalog_admin_apply_import(uuid,uuid) to authenticated;
grant execute on function public.catalog_admin_rollback_import(uuid,uuid) to authenticated;
grant execute on function public.catalog_admin_list_website_leads(text,integer) to authenticated;
grant execute on function public.catalog_admin_update_website_lead(uuid,text,text) to authenticated;

-- In-transaction verification. Any mismatch aborts the migration.
do $$
declare
  v_proc regprocedure;
begin
  foreach v_proc in array array[
    'public.catalog_public_list_products(text,integer,integer)'::regprocedure,
    'public.catalog_public_get_product(uuid)'::regprocedure,
    'public.catalog_crm_search_products(text,integer)'::regprocedure,
    'public.catalog_admin_preview_import(jsonb,jsonb)'::regprocedure,
    'public.catalog_admin_apply_import(uuid,uuid)'::regprocedure,
    'public.catalog_admin_rollback_import(uuid,uuid)'::regprocedure,
    'public.catalog_submit_website_lead(jsonb)'::regprocedure,
    'public.catalog_admin_list_website_leads(text,integer)'::regprocedure,
    'public.catalog_admin_update_website_lead(uuid,text,text)'::regprocedure
  ] loop
    if not exists (
      select 1 from pg_proc p
      where p.oid = v_proc
        and p.prosecdef
        and p.proconfig @> array['search_path=pg_catalog, public']
    ) then
      raise exception 'CATALOG_02B_VERIFY_FAIL: unsafe function %', v_proc;
    end if;
  end loop;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('products','product_import_batches','product_import_rows','product_price_history','product_source_mappings','website_leads')
      and not c.relrowsecurity
  ) then
    raise exception 'CATALOG_02B_VERIFY_FAIL: RLS disabled.';
  end if;

  if has_table_privilege('anon','public.products','SELECT')
     or has_table_privilege('anon','public.website_leads','INSERT')
     or has_table_privilege('authenticated','public.products','INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('authenticated','public.product_import_batches','INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('authenticated','public.website_leads','INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception 'CATALOG_02B_VERIFY_FAIL: direct browser table access.';
  end if;

  if has_function_privilege('anon','public.crm_write_audit(text,text,text,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.crm_create_product(jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.crm_update_product(uuid,bigint,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.crm_set_product_active(uuid,bigint,boolean)','EXECUTE')
     or not has_function_privilege('anon','public.catalog_public_list_products(text,integer,integer)','EXECUTE')
     or not has_function_privilege('authenticated','public.catalog_crm_search_products(text,integer)','EXECUTE') then
    raise exception 'CATALOG_02B_VERIFY_FAIL: function grant matrix.';
  end if;
end;
$$;

commit;
