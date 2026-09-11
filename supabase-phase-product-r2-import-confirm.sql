-- PRODUCT-R2 STEP 6 — private source verification and atomic Product confirmation.
-- Apply only to a local/isolated Supabase-compatible database in this phase.
begin;
select pg_advisory_xact_lock(hashtext('PRODUCT-R2-STEP6-IMPORT-CONFIRM'));

do $$ begin
  if to_regclass('public.products') is null
     or to_regclass('public.product_import_batches') is null
     or to_regclass('public.product_import_rows') is null
     or to_regprocedure('public.crm_import_can_access(uuid,boolean)') is null then
    raise exception 'PRODUCT_R2_STEP6_PRECONDITION_FAIL: thiếu STEP 3/5 contract.';
  end if;
end $$;

alter table public.product_import_batches
  add column source_verified_sha256 text check (source_verified_sha256 is null or source_verified_sha256 ~ '^[a-f0-9]{64}$'),
  add column source_verified_size_bytes bigint check (source_verified_size_bytes is null or source_verified_size_bytes > 0),
  add column source_verified_at timestamptz,
  add column source_verified_by_user_id text references public.app_users(id) on delete restrict,
  add column apply_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(apply_summary)='object');

alter table public.product_import_batches
  add constraint product_import_batches_source_path_check check (
    storage_object_path is null or storage_object_path = 'imports/'||id::text||'/source.pdf'
  );
create index product_import_batches_source_verified_idx on public.product_import_batches(source_verified_sha256) where source_verified_sha256 is not null;

-- A private bucket is created only when the Storage schema exists (not in PGlite).
-- No authenticated Storage read/write policy is created; the Edge Function uses
-- the service-role Storage boundary after checking the user JWT and batch RPC.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    execute $sql$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      values('product-price-imports','product-price-imports',false,20971520,array['application/pdf']::text[])
      on conflict (id) do update set public=false,file_size_limit=20971520,allowed_mime_types=array['application/pdf']::text[]$sql$;
  end if;
end $$;

create function public.crm_prepare_product_import_source(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare b public.product_import_batches%rowtype;
begin
  if not public.crm_import_can_access(p_batch_id,true) then
    raise exception using errcode='42501',message='Bạn không có quyền xác minh source của batch này.';
  end if;
  select * into b from public.product_import_batches where id=p_batch_id;
  if b.status not in ('STAGED','READY') then
    raise exception using errcode='P0002',message='Batch không còn ở trạng thái xác minh source.';
  end if;
  return jsonb_build_object(
    'batch_id',b.id,'source_sha256',b.source_sha256,'source_file_size_bytes',b.source_file_size_bytes,
    'storage_object_path','imports/'||b.id::text||'/source.pdf','source_filename',b.source_filename,
    'source_verified_sha256',b.source_verified_sha256,'source_verified_size_bytes',b.source_verified_size_bytes,
    'source_verified_at',b.source_verified_at,'verified',b.source_verified_sha256=b.source_sha256
      and b.source_verified_size_bytes=b.source_file_size_bytes
      and b.storage_object_path='imports/'||b.id::text||'/source.pdf'
  );
end $$;

create or replace function public.crm_get_product_import(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;v_status text;
begin
  if not public.crm_import_can_access(p_batch_id,false) then raise exception using errcode='42501',message='Bạn không có quyền đọc batch này.';end if;
  select status into v_status from public.product_import_batches where id=p_batch_id;
  if v_status<>'APPLIED' then
    update public.product_import_rows r set is_stale=true where r.batch_id=p_batch_id and r.matched_product_id is not null and not exists(select 1 from public.products p where p.id=r.matched_product_id and p.version=r.current_product_version);
    perform public.crm_import_update_readiness(p_batch_id);
  end if;
  select jsonb_build_object('batch',jsonb_build_object('id',b.id,'supplier',b.supplier,'source_filename',b.source_filename,'source_sha256',b.source_sha256,'source_file_size_bytes',b.source_file_size_bytes,'parser_adapter',b.parser_adapter,'parser_version',b.parser_version,'effective_date',b.effective_date,'status',b.status,'summary',b.summary,'origin_candidate',b.origin_candidate,'origin_accepted',b.origin_accepted,'storage_object_path',b.storage_object_path,'source_verified_sha256',b.source_verified_sha256,'source_verified_size_bytes',b.source_verified_size_bytes,'source_verified_at',b.source_verified_at,'source_verified_by_user_id',b.source_verified_by_user_id,'source_verified_by_name',svu.name,'created_by_user_id',b.created_by_user_id,'created_by_name',cu.name,'created_at',b.created_at,'updated_by_user_id',b.updated_by_user_id,'updated_by_name',uu.name,'updated_at',b.updated_at,'confirmed_by_user_id',b.confirmed_by_user_id,'confirmed_by_name',cfu.name,'confirmed_at',b.confirmed_at,'applied_at',b.applied_at,'apply_summary',b.apply_summary),
    'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.source_page,r.source_row_number,r.id) from public.product_import_rows r where r.batch_id=b.id),'[]')) into v_result
  from public.product_import_batches b left join public.app_users cu on cu.id=b.created_by_user_id left join public.app_users uu on uu.id=b.updated_by_user_id left join public.app_users svu on svu.id=b.source_verified_by_user_id left join public.app_users cfu on cfu.id=b.confirmed_by_user_id where b.id=p_batch_id;
  return v_result;
end $$;

create function public.crm_register_product_import_source(
  p_batch_id uuid,
  p_source_verified_sha256 text,
  p_source_verified_size_bytes bigint,
  p_storage_object_path text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor text:=public.crm_current_app_user_id();b public.product_import_batches%rowtype;v_path text;
begin
  if v_actor is null or not public.crm_import_can_access(p_batch_id,true) then
    raise exception using errcode='42501',message='Bạn không có quyền đăng ký source PDF.';
  end if;
  select * into b from public.product_import_batches where id=p_batch_id for update;
  v_path:='imports/'||p_batch_id::text||'/source.pdf';
  if p_source_verified_sha256 is null or lower(p_source_verified_sha256)<>lower(b.source_sha256)
     or p_source_verified_size_bytes is distinct from b.source_file_size_bytes
     or p_storage_object_path<>v_path then
    raise exception using errcode='22023',message='Source PDF không khớp provenance của batch.';
  end if;
  if b.source_verified_sha256 is not null and (
      b.source_verified_sha256<>lower(p_source_verified_sha256)
      or b.source_verified_size_bytes<>p_source_verified_size_bytes
      or b.storage_object_path<>v_path) then
    raise exception using errcode='22023',message='Không được thay thế source PDF đã xác minh.';
  end if;
  if b.source_verified_sha256=lower(p_source_verified_sha256)
     and b.source_verified_size_bytes=p_source_verified_size_bytes
     and b.storage_object_path=v_path then
    return public.crm_prepare_product_import_source(p_batch_id)||jsonb_build_object('verified',true,'idempotent_replay',true);
  end if;
  update public.product_import_batches set
    storage_object_path=v_path,source_verified_sha256=lower(p_source_verified_sha256),
    source_verified_size_bytes=p_source_verified_size_bytes,source_verified_at=now(),
    source_verified_by_user_id=v_actor,updated_by_user_id=v_actor,updated_at=now()
  where id=p_batch_id;
  perform public.crm_write_audit('verifyProductImportSourceR2','product_import_batches',p_batch_id::text,
    jsonb_build_object('sha256',lower(p_source_verified_sha256),'sizeBytes',p_source_verified_size_bytes));
  return public.crm_prepare_product_import_source(p_batch_id)||jsonb_build_object('verified',true);
end $$;

create function public.crm_import_current_product_fingerprint(p_product_id uuid)
returns text language sql stable security definer set search_path=public as $$
  select md5(jsonb_build_object('id',p.id,'code',p.code,'name',p.name,'width_cm',p.width_cm::text,'height_cm',p.height_cm::text,'price_per_m2',p.price_per_m2::text,'price_per_box',p.price_per_box,'price_per_piece',p.price_per_piece,'pieces_per_box',p.pieces_per_box,'sqm_per_box',p.sqm_per_box,'surface',p.surface,'origin',p.origin,'price_effective_date',p.price_effective_date,'version',p.version)::text) from public.products p where p.id=p_product_id;
$$;

create function public.crm_confirm_product_import(p_batch_id uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor text:=public.crm_current_app_user_id();v_role text:=public.crm_current_user_role();b public.product_import_batches%rowtype;r public.product_import_rows%rowtype;p public.products%rowtype;
  v_today date:=(clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;v_path text;v_current_fingerprint text;
  v_new_product_id uuid;v_new_surface text;v_new_origin text;v_price_context_changed boolean;v_info_changed boolean;v_created integer:=0;v_updated integer:=0;v_unchanged integer:=0;v_skipped integer:=0;v_history integer:=0;v_total integer;v_summary jsonb;
begin
  if v_actor is null or auth.uid() is null or not coalesce(public.crm_is_active_user(),false) or v_role not in ('sale','manager','admin','owner') then
    raise exception using errcode='42501',message='Bạn không có quyền xác nhận import.';
  end if;
  if p_batch_id is null or p_idempotency_key is null then raise exception using errcode='22023',message='Batch và idempotency key là bắt buộc.';end if;

  select * into b from public.product_import_batches where id=p_batch_id for update;
  if b.id is null then raise exception using errcode='P0002',message='Không tìm thấy batch.';end if;
  if not (b.created_by_user_id=v_actor or v_role in ('manager','admin','owner')) then raise exception using errcode='42501',message='Bạn không có quyền xác nhận batch này.';end if;
  if b.status='APPLIED' then
    if b.confirm_idempotency_key=p_idempotency_key then return jsonb_build_object('batch_id',b.id,'status','APPLIED','summary',b.apply_summary,'idempotent_replay',true);end if;
    raise exception using errcode='P0001',message='IMPORT_ALREADY_APPLIED';
  end if;
  if b.status<>'READY' then raise exception using errcode='P0001',message='IMPORT_NOT_READY';end if;
  v_path:='imports/'||b.id::text||'/source.pdf';
  if b.source_verified_sha256 is null or b.source_verified_sha256<>lower(b.source_sha256)
     or b.source_verified_size_bytes is distinct from b.source_file_size_bytes or b.storage_object_path<>v_path then
    raise exception using errcode='P0001',message='SOURCE_NOT_VERIFIED';
  end if;
  if exists(select 1 from public.product_import_rows x where x.batch_id=b.id and x.is_stale)
     or exists(select 1 from public.product_import_rows x where x.batch_id=b.id and x.classification in ('REVIEW','INVALID') and x.selected_action<>'SKIP')
     or exists(select 1 from public.product_import_rows x where x.batch_id=b.id and x.classification='DUPLICATE_IN_FILE' and (x.duplicate_resolution is null or (x.duplicate_resolution='COLLAPSE' and x.duplicate_kind<>'IDENTICAL'))) then
    raise exception using errcode='P0001',message='IMPORT_STALE_OR_UNRESOLVED';
  end if;
  select count(*) into v_total from public.product_import_rows where batch_id=b.id;

  -- Re-read and validate every selected row before/while taking Product locks.
  for r in select * from public.product_import_rows where batch_id=b.id order by source_page,source_row_number,id loop
    if r.selected_action not in ('CREATE','UPDATE') then
      if r.selected_action in ('NONE','SKIP') then if r.selected_action='SKIP' then v_skipped:=v_skipped+1;else v_unchanged:=v_unchanged+1;end if;continue;end if;
      raise exception using errcode='P0001',message='IMPORT_INVALID_ACTION';
    end if;
    if r.classification='DUPLICATE_IN_FILE' and (r.duplicate_resolution<>'COLLAPSE' or r.duplicate_representative_row_id<>r.id) then raise exception using errcode='P0001',message='IMPORT_DUPLICATE_NOT_REPRESENTATIVE';end if;
    if r.classification in ('REVIEW','INVALID','UNCHANGED') then raise exception using errcode='P0001',message='IMPORT_INVALID_SELECTED_ACTION';end if;
    if r.code_normalized is null or r.name_normalized is null or r.width_cm is null or r.height_cm is null or r.price_per_m2 is null or r.effective_date is null or r.effective_date>v_today then raise exception using errcode='P0001',message='IMPORT_REVALIDATION_FAILED';end if;
    select * into p from public.products where code_normalized=r.code_normalized for update;
    if r.selected_action='CREATE' then
      if p.id is not null then raise exception using errcode='40001',message='IMPORT_STALE:PRODUCT_APPEARED';end if;
      continue;
    end if;
    if p.id is null or r.matched_product_id is distinct from p.id or r.current_product_version is distinct from p.version then raise exception using errcode='40001',message='IMPORT_STALE:PRODUCT_VERSION';end if;
    v_current_fingerprint:=public.crm_import_current_product_fingerprint(p.id);
    if r.current_fingerprint is distinct from v_current_fingerprint then raise exception using errcode='40001',message='IMPORT_STALE:PRODUCT_FINGERPRINT';end if;
    if public.crm_import_normalize_name(p.name)<>r.name_normalized or p.width_cm<>r.width_cm or p.height_cm<>r.height_cm or r.effective_date<p.price_effective_date then raise exception using errcode='P0001',message='IMPORT_REVALIDATION_FAILED';end if;
  end loop;

  -- Only after all gates pass are Product/history writes performed.
  for r in select * from public.product_import_rows where batch_id=b.id and selected_action in ('CREATE','UPDATE') order by source_page,source_row_number,id loop
    select * into p from public.products where code_normalized=r.code_normalized for update;
    v_new_surface:=case when r.surface_accepted then r.surface_candidate else case when r.selected_action='CREATE' then null else p.surface end end;
    v_new_origin:=case when b.origin_accepted then coalesce(r.origin_candidate,b.origin_candidate) else case when r.selected_action='CREATE' then null else p.origin end end;
    if r.selected_action='CREATE' then
      if p.id is not null then raise exception using errcode='40001',message='IMPORT_STALE:PRODUCT_APPEARED';end if;
      insert into public.products(code,name,width_cm,height_cm,price_per_m2,price_per_box,price_per_piece,pieces_per_box,sqm_per_box,surface,origin,stock_quantity,price_effective_date,active,version,created_by_user_id,updated_by_user_id)
      values(r.code,r.name,r.width_cm,r.height_cm,r.price_per_m2,case when r.source_values?'price_per_box' then r.price_per_box end,case when r.source_values?'price_per_piece' then r.price_per_piece end,case when r.source_values?'pieces_per_box' then r.pieces_per_box end,case when r.source_values?'sqm_per_box' then r.sqm_per_box end,v_new_surface,v_new_origin,null,b.effective_date,true,1,v_actor,v_actor) returning id into v_new_product_id;
      insert into public.product_price_history(product_id,price_per_m2,price_per_box,price_per_piece,pieces_per_box,sqm_per_box,effective_date,source_type,import_batch_id,changed_by_user_id,changed_at,reason)
      values(v_new_product_id,r.price_per_m2,case when r.source_values?'price_per_box' then r.price_per_box end,case when r.source_values?'price_per_piece' then r.price_per_piece end,case when r.source_values?'pieces_per_box' then r.pieces_per_box end,case when r.source_values?'sqm_per_box' then r.sqm_per_box end,b.effective_date,'PDF_IMPORT',b.id,v_actor,now(),'PRODUCT-R2 STEP6 import');
      v_created:=v_created+1;v_history:=v_history+1;
      perform public.crm_write_audit('createProductImportR2','products',v_new_product_id::text,jsonb_build_object('batchId',b.id,'sourceType','PDF_IMPORT','effectiveDate',b.effective_date));
    else
      if p.id is null then raise exception using errcode='40001',message='IMPORT_STALE:PRODUCT_MISSING';end if;
      v_price_context_changed:=p.price_per_m2 is distinct from r.price_per_m2
        or ((r.source_values?'price_per_box') and p.price_per_box is distinct from r.price_per_box)
        or ((r.source_values?'price_per_piece') and p.price_per_piece is distinct from r.price_per_piece)
        or ((r.source_values?'pieces_per_box') and p.pieces_per_box is distinct from r.pieces_per_box)
        or ((r.source_values?'sqm_per_box') and p.sqm_per_box is distinct from r.sqm_per_box)
        or p.price_effective_date is distinct from b.effective_date;
      v_info_changed:=p.surface is distinct from v_new_surface or p.origin is distinct from v_new_origin;
      if v_price_context_changed or v_info_changed then
        update public.products set price_per_m2=r.price_per_m2,price_per_box=case when r.source_values?'price_per_box' then r.price_per_box else p.price_per_box end,price_per_piece=case when r.source_values?'price_per_piece' then r.price_per_piece else p.price_per_piece end,pieces_per_box=case when r.source_values?'pieces_per_box' then r.pieces_per_box else p.pieces_per_box end,sqm_per_box=case when r.source_values?'sqm_per_box' then r.sqm_per_box else p.sqm_per_box end,surface=v_new_surface,origin=v_new_origin,price_effective_date=case when v_price_context_changed then b.effective_date else p.price_effective_date end,version=p.version+1,updated_at=now(),updated_by_user_id=v_actor where id=p.id;
        if v_price_context_changed then
          insert into public.product_price_history(product_id,price_per_m2,price_per_box,price_per_piece,pieces_per_box,sqm_per_box,effective_date,source_type,import_batch_id,changed_by_user_id,changed_at,reason)
          select p.id,r.price_per_m2,case when r.source_values?'price_per_box' then r.price_per_box else p.price_per_box end,case when r.source_values?'price_per_piece' then r.price_per_piece else p.price_per_piece end,case when r.source_values?'pieces_per_box' then r.pieces_per_box else p.pieces_per_box end,case when r.source_values?'sqm_per_box' then r.sqm_per_box else p.sqm_per_box end,b.effective_date,'PDF_IMPORT',b.id,v_actor,now(),'PRODUCT-R2 STEP6 import';v_history:=v_history+1;
        end if;
        v_updated:=v_updated+1;
        perform public.crm_write_audit('updateProductImportR2','products',p.id::text,jsonb_build_object('batchId',b.id,'sourceType','PDF_IMPORT','priceContextChanged',v_price_context_changed,'infoChanged',v_info_changed));
      else v_unchanged:=v_unchanged+1;end if;
    end if;
  end loop;
  v_summary:=jsonb_build_object('created',v_created,'updated',v_updated,'unchanged',v_unchanged,'skipped',v_skipped,'history_created',v_history,'total_source_rows',v_total,'effective_date',b.effective_date);
  update public.product_import_batches set status='APPLIED',confirm_idempotency_key=p_idempotency_key,confirmed_by_user_id=v_actor,confirmed_at=now(),applied_at=now(),updated_by_user_id=v_actor,updated_at=now(),apply_summary=v_summary where id=b.id;
  perform public.crm_write_audit('confirmProductImportR2','product_import_batches',b.id::text,v_summary||jsonb_build_object('confirmedBy',v_actor));
  return jsonb_build_object('batch_id',b.id,'status','APPLIED','summary',v_summary,'idempotent_replay',false);
exception when unique_violation then
  raise exception using errcode='40001',message='IMPORT_STALE:PRODUCT_CODE_CONFLICT';
end $$;

revoke all on function public.crm_prepare_product_import_source(uuid),public.crm_register_product_import_source(uuid,text,bigint,text),public.crm_import_current_product_fingerprint(uuid) from public,anon,authenticated;
revoke all on function public.crm_confirm_product_import(uuid,uuid) from public,anon;
grant execute on function public.crm_prepare_product_import_source(uuid),public.crm_register_product_import_source(uuid,text,bigint,text),public.crm_confirm_product_import(uuid,uuid) to authenticated;

-- Authenticated clients still cannot mutate tables or source metadata directly.
revoke all on public.product_import_batches,public.product_import_rows from anon,authenticated;
do $$ begin
  if to_regprocedure('public.crm_confirm_product_import(uuid,uuid)') is null then raise exception 'PRODUCT_R2_STEP6_VERIFY_FAIL: thiếu confirm RPC.';end if;
end $$;
commit;
