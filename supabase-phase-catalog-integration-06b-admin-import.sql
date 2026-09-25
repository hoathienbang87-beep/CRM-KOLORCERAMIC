-- CATALOG INTEGRATION 06B — admin import review, history and candidate selection API.
-- Apply only after approved 03B and 06A migrations on guarded cloud staging.
begin;

select pg_advisory_xact_lock(hashtext('CATALOG-INTEGRATION-06B-ADMIN-IMPORT'));

do $$
begin
  if to_regprocedure('public.catalog_admin_approve_import(uuid,uuid)') is null
     or to_regprocedure('public.catalog_admin_list_products_v1(text,text,boolean,boolean,integer,integer)') is null
     or to_regclass('public.product_import_batches') is null then
    raise exception 'CATALOG_06B_PRECONDITION_FAIL: approved 03B/06A objects are missing.';
  end if;
  if to_regprocedure('public.catalog_admin_list_import_batches_v1(text,integer,integer)') is not null
     or to_regprocedure('public.catalog_admin_get_import_batch_v1(uuid)') is not null
     or to_regprocedure('public.catalog_admin_review_import_rows_v1(uuid,jsonb)') is not null then
    raise exception 'CATALOG_06B_PRECONDITION_FAIL: migration already or partially applied.';
  end if;
end;
$$;

create function public.catalog_admin_import_batch_json_v1_06b(p_batch_id uuid, p_include_rows boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id',b.id,'supplier',b.supplier,'source_filename',b.source_filename,
    'source_file_size_bytes',b.source_file_size_bytes,'parser_adapter',b.parser_adapter,
    'parser_version',b.parser_version,'effective_date',b.effective_date,'status',b.status,
    'import_mode',b.import_mode,'source_format',b.source_format,
    'created_at',b.created_at,'approved_at',b.approved_at,'confirmed_at',b.confirmed_at,
    'applied_at',b.applied_at,'rolled_back_at',b.rolled_back_at,
    'rollback_of_batch_id',b.rollback_of_batch_id,
    'summary',jsonb_build_object(
      'total',count(r.id),
      'create',count(r.id) filter (where r.selected_action='CREATE'),
      'update',count(r.id) filter (where r.selected_action='UPDATE'),
      'skip',count(r.id) filter (where r.selected_action='SKIP'),
      'unresolved',count(r.id) filter (where r.selected_action<>'SKIP' and r.classification in ('DUPLICATE_IN_FILE','CONFLICT','INVALID','REVIEW')),
      'ready',count(r.id) filter (where r.disposition='READY'),
      'updating',count(r.id) filter (where r.disposition='UPDATING'),
      'conflict',count(r.id) filter (where r.disposition='CONFLICT')
    ),
    'rows',case when p_include_rows then coalesce(jsonb_agg(
      jsonb_build_object(
        'id',r.id,'source_page',r.source_page,'source_row_number',r.source_row_number,
        'source_sheet',r.source_sheet,'source_cell_ref',r.source_cell_ref,
        'source_values',r.source_values,'code',r.code,'name',r.name,
        'width_mm',r.width_mm,'height_mm',r.height_mm,'surface',r.surface_candidate,
        'price_per_m2',r.price_per_m2,'classification',r.classification,
        'disposition',r.disposition,'match_rule',r.match_rule,'conflict_code',r.conflict_code,
        'selected_action',r.selected_action,'matched_product_id',r.matched_product_id,
        'current_product_version',r.current_product_version,'warnings',r.warnings,
        'previous_snapshot',r.previous_snapshot,'proposed_snapshot',r.proposed_snapshot,
        'rollback_snapshot',r.rollback_snapshot
      ) order by r.source_page,r.source_row_number,r.id
    ) filter (where r.id is not null),'[]'::jsonb) else null end
  )
  from public.product_import_batches b
  left join public.product_import_rows r on r.batch_id=b.id
  where b.id=p_batch_id
  group by b.id;
$$;

create function public.catalog_admin_list_import_batches_v1(
  p_status text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text := nullif(upper(btrim(coalesce(p_status,''))), '');
  v_total integer;
begin
  perform public.catalog_require_admin_02b();
  if p_limit is null or p_limit<1 or p_limit>100 or p_offset is null or p_offset<0 or p_offset>100000
     or (v_status is not null and v_status not in ('STAGED','READY','APPLIED','FAILED','CANCELLED')) then
    raise exception using errcode='22023', message='CATALOG_IMPORT_LIST_FILTER_INVALID';
  end if;
  select count(*) into v_total from public.product_import_batches b where v_status is null or b.status=v_status;
  return jsonb_build_object(
    'items',coalesce((select jsonb_agg(public.catalog_admin_import_batch_json_v1_06b(x.id,false) order by x.created_at desc,x.id desc)
      from (select b.id,b.created_at from public.product_import_batches b
        where v_status is null or b.status=v_status
        order by b.created_at desc,b.id desc limit p_limit offset p_offset) x),'[]'::jsonb),
    'pagination',jsonb_build_object('total',v_total,'limit',p_limit,'offset',p_offset,'has_more',p_offset+p_limit<v_total)
  );
end;
$$;

create function public.catalog_admin_get_import_batch_v1(p_batch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_result jsonb;
begin
  perform public.catalog_require_admin_02b();
  if p_batch_id is null then raise exception using errcode='22023', message='CATALOG_IMPORT_BATCH_ID_REQUIRED'; end if;
  v_result := public.catalog_admin_import_batch_json_v1_06b(p_batch_id,true);
  if v_result is null then raise exception using errcode='P0002', message='CATALOG_IMPORT_BATCH_NOT_FOUND'; end if;
  return v_result;
end;
$$;

create function public.catalog_admin_review_import_rows_v1(p_batch_id uuid, p_decisions jsonb)
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
  d jsonb;
  v_decision text;
  v_candidate_id uuid;
  v_candidate_allowed boolean;
  v_snapshot jsonb;
  v_blocking integer;
  v_status text;
  v_count integer := 0;
begin
  if p_batch_id is null or p_decisions is null or jsonb_typeof(p_decisions)<>'array'
     or jsonb_array_length(p_decisions)<1 or jsonb_array_length(p_decisions)>1000 then
    raise exception using errcode='22023', message='CATALOG_IMPORT_REVIEW_INVALID';
  end if;
  select * into b from public.product_import_batches where id=p_batch_id for update;
  if b.id is null then raise exception using errcode='P0002', message='CATALOG_IMPORT_BATCH_NOT_FOUND'; end if;
  if b.status not in ('STAGED','READY') or b.approved_at is not null then
    raise exception using errcode='P0001', message='CATALOG_IMPORT_REVIEW_LOCKED';
  end if;

  for d in select value from jsonb_array_elements(p_decisions) loop
    if jsonb_typeof(d)<>'object' or not (d ? 'row_id') or not (d ? 'decision')
       or exists (select 1 from jsonb_object_keys(d) k where k not in ('row_id','decision','candidate_product_id')) then
      raise exception using errcode='22023', message='CATALOG_IMPORT_REVIEW_DECISION_INVALID';
    end if;
    select * into r from public.product_import_rows
      where id=(d->>'row_id')::uuid and batch_id=b.id for update;
    if r.id is null then raise exception using errcode='P0002', message='CATALOG_IMPORT_ROW_NOT_FOUND'; end if;
    v_decision := upper(btrim(d->>'decision'));

    if v_decision='EXCLUDE' then
      update public.product_import_rows set selected_action='SKIP',classification='REVIEW',
        disposition='EXCLUDED_BY_REVIEW',conflict_code='EXCLUDED_BY_REVIEW'
      where id=r.id;
    elsif v_decision='USE_CANDIDATE' then
      v_candidate_id := nullif(d->>'candidate_product_id','')::uuid;
      select exists(
        select 1 from jsonb_array_elements(coalesce(r.source_values->'catalog_match'->'candidates','[]'::jsonb) || coalesce(r.source_values->'catalog_match'->'suggestions','[]'::jsonb)) c
        where c->>'id'=v_candidate_id::text
      ) into v_candidate_allowed;
      if v_candidate_id is null or not coalesce(v_candidate_allowed,false) then
        raise exception using errcode='22023', message='CATALOG_IMPORT_CANDIDATE_NOT_ALLOWED';
      end if;
      select * into p from public.products where id=v_candidate_id;
      if p.id is null then raise exception using errcode='P0002', message='CATALOG_IMPORT_CANDIDATE_NOT_FOUND'; end if;
      if r.price_per_m2 is null then
        update public.product_import_rows set matched_product_id=p.id,current_product_version=p.version,
          selected_action='SKIP',classification='UNCHANGED',disposition='MISSING_PRICE',
          match_rule='MANUAL_CANDIDATE',conflict_code='MISSING_PRICE_SKIPPED',
          previous_snapshot=public.catalog_product_snapshot_02b(p.id),proposed_snapshot='{}'::jsonb
        where id=r.id;
      else
        v_snapshot := case when b.import_mode='PRICE_UPDATE_ONLY' then
          jsonb_build_object('price_per_m2',r.price_per_m2,'price_effective_date',b.effective_date)
        else jsonb_strip_nulls(jsonb_build_object(
          'code',r.code,'name',r.name,'width_mm',r.width_mm,'height_mm',r.height_mm,
          'surface',r.surface_candidate,'price_per_m2',r.price_per_m2,
          'price_effective_date',b.effective_date,'active',true,'is_published',false
        )) end;
        update public.product_import_rows set matched_product_id=p.id,current_product_version=p.version,
          selected_action=case when b.import_mode='PRICE_UPDATE_ONLY' and p.price_per_m2=r.price_per_m2 then 'SKIP' else 'UPDATE' end,
          classification=case when b.import_mode='PRICE_UPDATE_ONLY' and p.price_per_m2=r.price_per_m2 then 'UNCHANGED' else 'CHANGED' end,
          disposition='READY',match_rule='MANUAL_CANDIDATE',conflict_code=null,
          previous_snapshot=public.catalog_product_snapshot_02b(p.id),
          proposed_snapshot=case when b.import_mode='PRICE_UPDATE_ONLY' and p.price_per_m2=r.price_per_m2 then '{}'::jsonb else v_snapshot end
        where id=r.id;
      end if;
    else
      raise exception using errcode='22023', message='CATALOG_IMPORT_REVIEW_DECISION_INVALID';
    end if;
    v_count := v_count+1;
  end loop;

  select count(*) into v_blocking from public.product_import_rows ir
  where ir.batch_id=b.id and ir.classification in ('DUPLICATE_IN_FILE','CONFLICT','INVALID','REVIEW') and ir.selected_action<>'SKIP';
  v_status := case when v_blocking=0 then 'READY' else 'STAGED' end;
  update public.product_import_batches set status=v_status where id=b.id;
  perform public.crm_write_audit('catalogImportReview06B','product_import_batches',b.id::text,
    jsonb_build_object('batch_id',b.id,'actor',v_actor,'decisions',v_count,'blocking',v_blocking,'status',v_status));
  return public.catalog_admin_import_batch_json_v1_06b(b.id,true);
end;
$$;

revoke all on function public.catalog_admin_import_batch_json_v1_06b(uuid,boolean) from public,anon,authenticated;
revoke all on function public.catalog_admin_list_import_batches_v1(text,integer,integer) from public,anon,authenticated;
revoke all on function public.catalog_admin_get_import_batch_v1(uuid) from public,anon,authenticated;
revoke all on function public.catalog_admin_review_import_rows_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.catalog_admin_list_import_batches_v1(text,integer,integer) to authenticated;
grant execute on function public.catalog_admin_get_import_batch_v1(uuid) to authenticated;
grant execute on function public.catalog_admin_review_import_rows_v1(uuid,jsonb) to authenticated;

do $$
declare v_bad integer;
begin
  select count(*) into v_bad from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
    'catalog_admin_import_batch_json_v1_06b','catalog_admin_list_import_batches_v1',
    'catalog_admin_get_import_batch_v1','catalog_admin_review_import_rows_v1'
  ) and (not p.prosecdef or not coalesce(p.proconfig,'{}'::text[]) @> array['search_path=pg_catalog, public']);
  if v_bad<>0
     or not has_function_privilege('authenticated','public.catalog_admin_list_import_batches_v1(text,integer,integer)','EXECUTE')
     or not has_function_privilege('authenticated','public.catalog_admin_get_import_batch_v1(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.catalog_admin_review_import_rows_v1(uuid,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.catalog_admin_import_batch_json_v1_06b(uuid,boolean)','EXECUTE')
     or has_table_privilege('authenticated','public.product_import_batches','INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception 'CATALOG_06B_VERIFY_FAIL: function security or grants mismatch.';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
