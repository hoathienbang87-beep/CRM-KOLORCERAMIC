-- CATALOG INTEGRATION 06B — repair PL/pgSQL alias ambiguity found by staging E2E.
begin;
select pg_advisory_xact_lock(hashtext('CATALOG-INTEGRATION-06B-REVIEW-ALIAS-FIX'));
create or replace function public.catalog_admin_review_import_rows_v1(p_batch_id uuid, p_decisions jsonb)
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

do $$ begin
  if to_regprocedure('public.catalog_admin_review_import_rows_v1(uuid,jsonb)') is null
     or not has_function_privilege('authenticated','public.catalog_admin_review_import_rows_v1(uuid,jsonb)','EXECUTE') then
    raise exception 'CATALOG_06B_REVIEW_ALIAS_FIX_VERIFY_FAIL';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
