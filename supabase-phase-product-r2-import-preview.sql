-- PRODUCT-R2 STEP 5 — browser PDF staging, comparison and review only.
-- Intentionally contains no Product apply/confirm path and no Storage upload.
begin;

select pg_advisory_xact_lock(hashtext('PRODUCT-R2-STEP5-IMPORT-PREVIEW'));

do $$ begin
  if to_regclass('public.products') is null
     or to_regclass('public.product_import_batches') is null
     or to_regclass('public.product_import_rows') is null
     or to_regprocedure('public.crm_current_app_user_id()') is null then
    raise exception 'PRODUCT_R2_STEP5_PRECONDITION_FAIL: STEP 3 chưa sẵn sàng.';
  end if;
end $$;

drop index if exists public.product_import_batches_source_adapter_key;

alter table public.product_import_batches
  add column request_id uuid,
  add column page_count integer check (page_count is null or page_count between 1 and 50),
  add column row_count integer not null default 0 check (row_count between 0 and 1000),
  add column summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary)='object'),
  add column origin_candidate text,
  add column origin_accepted boolean not null default false,
  add column updated_by_user_id text references public.app_users(id) on delete restrict,
  add column updated_at timestamptz not null default now();

alter table public.product_import_batches
  add constraint product_import_batches_actor_request_key unique(created_by_user_id,request_id);

alter table public.product_import_rows drop constraint product_import_rows_classification_check;
alter table public.product_import_rows
  add column stt integer,
  add column effective_date date,
  add column base_classification text,
  add column review_reason text,
  add column duplicate_group_id text,
  add column duplicate_kind text check (duplicate_kind is null or duplicate_kind in ('IDENTICAL','CONFLICTING')),
  add column duplicate_resolution text check (duplicate_resolution is null or duplicate_resolution in ('COLLAPSE','SKIP_GROUP')),
  add column duplicate_representative_row_id uuid references public.product_import_rows(id) on delete set null,
  add column surface_accepted boolean not null default false,
  add column current_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(current_snapshot)='object'),
  add column decision_detail jsonb not null default '{}'::jsonb check (jsonb_typeof(decision_detail)='object'),
  add column is_stale boolean not null default false,
  add column updated_by_user_id text references public.app_users(id) on delete restrict,
  add column updated_at timestamptz not null default now(),
  add constraint product_import_rows_classification_check check (
    classification in ('NEW','PRICE_CHANGED','INFO_CHANGED','UNCHANGED','REVIEW','DUPLICATE_IN_FILE','INVALID')
  ),
  add constraint product_import_rows_base_classification_check check (
    base_classification is null or base_classification in ('NEW','PRICE_CHANGED','INFO_CHANGED','UNCHANGED','REVIEW','INVALID')
  );

create index product_import_batches_actor_created_idx on public.product_import_batches(created_by_user_id,created_at desc);
create index product_import_rows_batch_classification_idx on public.product_import_rows(batch_id,classification,source_row_number);
create index product_import_rows_batch_duplicate_idx on public.product_import_rows(batch_id,duplicate_group_id) where duplicate_group_id is not null;

create function public.crm_import_normalize_code(p_value text)
returns text language sql immutable set search_path=public as $$
  select upper(regexp_replace(btrim(normalize(coalesce(p_value,''),NFKC)),'[[:space:]]+',' ','g'));
$$;

create function public.crm_import_normalize_name(p_value text)
returns text language sql immutable set search_path=public as $$
  select upper(regexp_replace(regexp_replace(btrim(normalize(coalesce(p_value,''),NFKC)),'[[:space:]]+',' ','g'),'[[:space:]]*,[[:space:]]*',',','g'));
$$;

create function public.crm_import_numeric(p_value jsonb,p_scale integer)
returns numeric language plpgsql immutable set search_path=public as $$
declare v_text text; begin
  if p_value is null or p_value='null'::jsonb or jsonb_typeof(p_value) not in ('number','string') then return null; end if;
  v_text:=btrim(p_value#>>'{}');
  if (p_scale=0 and v_text!~'^[0-9]+$') or (p_scale>0 and v_text!~('^[0-9]+([.][0-9]{1,'||p_scale||'})?$')) then return null; end if;
  begin return v_text::numeric; exception when others then return null; end;
end $$;

create function public.crm_import_can_access(p_batch_id uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and coalesce(public.crm_is_active_user(),false)
    and public.crm_current_user_role() in ('sale','manager','admin','owner')
    and exists(select 1 from public.product_import_batches b where b.id=p_batch_id and
      (b.created_by_user_id=public.crm_current_app_user_id() or public.crm_current_user_role() in ('manager','admin','owner'))
      and (not p_write or b.status in ('STAGED','READY')));
$$;

create function public.crm_import_recompute(p_batch_id uuid,p_clear_changed_actions boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare v_batch public.product_import_batches%rowtype; r record; p public.products%rowtype; v_base text; v_reason text; v_diff jsonb; v_snapshot jsonb; v_fingerprint text; v_price_changed boolean; v_info_changed boolean; v_material_changed boolean;
begin
  select * into v_batch from public.product_import_batches where id=p_batch_id for update;
  if v_batch.id is null then raise exception using errcode='P0002',message='Không tìm thấy batch.'; end if;

  if p_clear_changed_actions then
    update public.product_import_rows set decision_detail=jsonb_set(decision_detail,'{_previous_classification}',to_jsonb(classification),true) where batch_id=p_batch_id;
  end if;

  update public.product_import_rows set
    code_normalized=public.crm_import_normalize_code(code),
    name_normalized=public.crm_import_normalize_name(name),
    base_classification=null,review_reason=null,duplicate_group_id=null,duplicate_kind=null,
    matched_product_id=null,
    current_product_version=null,current_fingerprint=null,current_snapshot='{}',diff='{}',is_stale=false
  where batch_id=p_batch_id;

  for r in select * from public.product_import_rows where batch_id=p_batch_id order by source_row_number,id loop
    v_reason:=null;v_diff:='{}';v_snapshot:='{}';v_fingerprint:=null;v_price_changed:=false;v_info_changed:=false;
    if nullif(r.code_normalized,'') is null or r.code_normalized!~'^[^[:cntrl:]]+$' then v_reason:='INVALID_CODE';
    elsif nullif(r.name_normalized,'') is null then v_reason:='MISSING_NAME';
    elsif r.width_cm is null or r.width_cm<=0 or r.width_cm>10000 or r.height_cm is null or r.height_cm<=0 or r.height_cm>10000 then v_reason:='INVALID_SIZE';
    elsif r.price_per_m2 is null or r.price_per_m2<=0 then v_reason:='INVALID_PRICE';
    elsif r.effective_date is null then v_reason:='INVALID_EFFECTIVE_DATE';
    elsif r.price_per_box is not null and r.price_per_box<=0 then v_reason:='INVALID_PRICE_BOX';
    elsif r.price_per_piece is not null and r.price_per_piece<=0 then v_reason:='INVALID_PRICE_PIECE';
    elsif r.pieces_per_box is not null and (r.pieces_per_box<1 or r.pieces_per_box>10000) then v_reason:='INVALID_PIECES_PER_BOX';
    elsif r.sqm_per_box is not null and (r.sqm_per_box<=0 or r.sqm_per_box>100000) then v_reason:='INVALID_SQM_PER_BOX'; end if;
    if v_reason is not null then
      update public.product_import_rows set classification='INVALID',base_classification='INVALID',review_reason=v_reason,selected_action=case when selected_action='SKIP' then 'SKIP' else 'NONE' end where id=r.id;
      continue;
    end if;

    if r.effective_date>((clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date) then
      update public.product_import_rows set classification='REVIEW',base_classification='REVIEW',review_reason='FUTURE_EFFECTIVE_DATE',selected_action=case when selected_action='SKIP' then 'SKIP' else 'NONE' end where id=r.id;
      continue;
    end if;

    if ((r.source_values?'price_per_box') and (r.source_values?'sqm_per_box') and r.price_per_box is not null and r.sqm_per_box is not null and r.price_per_box<>round(r.price_per_m2*r.sqm_per_box,0))
       or ((r.source_values?'price_per_piece') and (r.source_values?'pieces_per_box') and r.price_per_piece is not null and r.pieces_per_box is not null and r.price_per_piece<>round(r.price_per_box/r.pieces_per_box,0)) then
      update public.product_import_rows set warnings=array(select distinct x from unnest(warnings||array['PRICE_MATH_MISMATCH']) x) where id=r.id;
    end if;

    select * into p from public.products where code_normalized=r.code_normalized;
    if p.id is null then v_base:='NEW';v_diff:=jsonb_build_object('create',true);update public.product_import_rows set selected_action=case when selected_action='SKIP' then 'SKIP' else 'CREATE' end where id=r.id;
    else
      v_snapshot:=jsonb_build_object('id',p.id,'code',p.code,'name',p.name,'width_cm',p.width_cm::text,'height_cm',p.height_cm::text,'price_per_m2',p.price_per_m2::text,'price_per_box',p.price_per_box,'price_per_piece',p.price_per_piece,'pieces_per_box',p.pieces_per_box,'sqm_per_box',p.sqm_per_box,'surface',p.surface,'origin',p.origin,'price_effective_date',p.price_effective_date,'version',p.version);
      v_fingerprint:=md5(v_snapshot::text);
      if public.crm_import_normalize_name(p.name)<>r.name_normalized then v_base:='REVIEW';v_reason:='NAME_MISMATCH';
      elsif p.width_cm<>r.width_cm or p.height_cm<>r.height_cm then v_base:='REVIEW';v_reason:='SIZE_MISMATCH';
      elsif r.effective_date<p.price_effective_date then v_base:='REVIEW';v_reason:='OLDER_EFFECTIVE_DATE';
      else
        v_price_changed:=p.price_per_m2 is distinct from r.price_per_m2
          or ((r.source_values?'price_per_box') and p.price_per_box is distinct from r.price_per_box)
          or ((r.source_values?'price_per_piece') and p.price_per_piece is distinct from r.price_per_piece)
          or ((r.source_values?'pieces_per_box') and p.pieces_per_box is distinct from r.pieces_per_box)
          or ((r.source_values?'sqm_per_box') and p.sqm_per_box is distinct from r.sqm_per_box)
          or p.price_effective_date is distinct from r.effective_date;
        v_info_changed:=(r.surface_accepted and r.surface_candidate is not null and p.surface is distinct from r.surface_candidate)
          or (v_batch.origin_accepted and v_batch.origin_candidate is not null and p.origin is distinct from v_batch.origin_candidate);
        v_base:=case when v_price_changed then 'PRICE_CHANGED' when v_info_changed then 'INFO_CHANGED' else 'UNCHANGED' end;
        if v_price_changed and r.effective_date=p.price_effective_date then
          update public.product_import_rows set warnings=array(select distinct x from unnest(warnings||array['SAME_EFFECTIVE_DATE_CHANGED']) x) where id=r.id;
        end if;
      end if;
      v_diff:=jsonb_strip_nulls(jsonb_build_object(
        'price_per_m2',case when p.price_per_m2 is distinct from r.price_per_m2 then jsonb_build_object('current',p.price_per_m2::text,'incoming',r.price_per_m2::text) end,
        'price_per_box',case when (r.source_values?'price_per_box') and p.price_per_box is distinct from r.price_per_box then jsonb_build_object('current',p.price_per_box,'incoming',r.price_per_box) end,
        'price_per_piece',case when (r.source_values?'price_per_piece') and p.price_per_piece is distinct from r.price_per_piece then jsonb_build_object('current',p.price_per_piece,'incoming',r.price_per_piece) end,
        'pieces_per_box',case when (r.source_values?'pieces_per_box') and p.pieces_per_box is distinct from r.pieces_per_box then jsonb_build_object('current',p.pieces_per_box,'incoming',r.pieces_per_box) end,
        'sqm_per_box',case when (r.source_values?'sqm_per_box') and p.sqm_per_box is distinct from r.sqm_per_box then jsonb_build_object('current',p.sqm_per_box,'incoming',r.sqm_per_box) end,
        'effective_date',case when p.price_effective_date is distinct from r.effective_date then jsonb_build_object('current',p.price_effective_date,'incoming',r.effective_date) end));
      update public.product_import_rows set selected_action=case when selected_action='SKIP' then 'SKIP' when v_base in ('PRICE_CHANGED','INFO_CHANGED') then 'UPDATE' when v_base='UNCHANGED' then 'NONE' else 'NONE' end where id=r.id;
    end if;
    update public.product_import_rows set classification=v_base,base_classification=v_base,review_reason=v_reason,matched_product_id=p.id,current_product_version=p.version,current_fingerprint=v_fingerprint,current_snapshot=v_snapshot,diff=v_diff where id=r.id;
  end loop;

  update public.product_import_rows pr set
    duplicate_group_id='DUP-'||substr(md5(pr.code_normalized),1,12),classification='DUPLICATE_IN_FILE',
    duplicate_kind=case when (select count(distinct md5(jsonb_build_array(x.name_normalized,x.width_cm,x.height_cm,x.price_per_m2,x.price_per_box,x.price_per_piece,x.pieces_per_box,x.sqm_per_box,x.surface_candidate,x.origin_candidate)::text)) from public.product_import_rows x where x.batch_id=p_batch_id and x.code_normalized=pr.code_normalized)=1 then 'IDENTICAL' else 'CONFLICTING' end,
    selected_action=case when pr.selected_action='SKIP' then 'SKIP' else 'NONE' end
  where pr.batch_id=p_batch_id and pr.code_normalized<>'' and (select count(*) from public.product_import_rows x where x.batch_id=p_batch_id and x.code_normalized=pr.code_normalized)>1;

  update public.product_import_rows set duplicate_resolution=null,duplicate_representative_row_id=null
  where batch_id=p_batch_id and classification<>'DUPLICATE_IN_FILE';

  if p_clear_changed_actions then
    update public.product_import_rows set selected_action='NONE',decision_detail='{}'
    where batch_id=p_batch_id and (is_stale or classification in ('REVIEW','DUPLICATE_IN_FILE','INVALID')
      or decision_detail->>'_previous_classification' is distinct from classification);
    update public.product_import_rows set decision_detail=decision_detail-'_previous_classification' where batch_id=p_batch_id;
  end if;
end $$;

create function public.crm_import_update_readiness(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_blocking integer;v_summary jsonb; begin
  select count(*) into v_blocking from public.product_import_rows where batch_id=p_batch_id and (
    is_stale or (classification in ('REVIEW','INVALID') and selected_action<>'SKIP')
    or (classification='DUPLICATE_IN_FILE' and duplicate_resolution is null));
  select jsonb_build_object('total',count(*),'new',count(*) filter(where classification='NEW'),'price_changed',count(*) filter(where classification='PRICE_CHANGED'),'info_changed',count(*) filter(where classification='INFO_CHANGED'),'unchanged',count(*) filter(where classification='UNCHANGED'),'review',count(*) filter(where classification='REVIEW'),'duplicates',count(*) filter(where classification='DUPLICATE_IN_FILE'),'invalid',count(*) filter(where classification='INVALID'),'blocking',v_blocking,'selected_create',count(*) filter(where selected_action='CREATE'),'selected_update',count(*) filter(where selected_action='UPDATE')) into v_summary from public.product_import_rows where batch_id=p_batch_id;
  update public.product_import_batches set status=case when v_blocking=0 then 'READY' else 'STAGED' end,summary=v_summary,updated_at=now() where id=p_batch_id and status in ('STAGED','READY');
  return v_summary;
end $$;

create function public.crm_stage_product_import(p_batch jsonb,p_rows jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor text:=public.crm_current_app_user_id();v_batch_id uuid;v_effective date;v_row jsonb;v_idempotent public.product_import_batches%rowtype;v_summary jsonb; begin
  if auth.uid() is null or not coalesce(public.crm_is_active_user(),false) or public.crm_current_user_role() not in ('sale','manager','admin','owner') or v_actor is null then raise exception using errcode='42501',message='Bạn không có quyền stage bảng giá.';end if;
  if p_request_id is null or p_batch is null or jsonb_typeof(p_batch)<>'object' or p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception using errcode='22023',message='Yêu cầu staging không hợp lệ.';end if;
  select * into v_idempotent from public.product_import_batches where created_by_user_id=v_actor and request_id=p_request_id;
  if v_idempotent.id is not null then return jsonb_build_object('batch_id',v_idempotent.id,'status',v_idempotent.status,'summary',v_idempotent.summary,'idempotent_replay',true);end if;
  if pg_column_size(p_batch)+pg_column_size(p_rows)>5242880 or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>1000 then raise exception using errcode='22023',message='Payload vượt giới hạn an toàn.';end if;
  if p_batch->>'parser_adapter'<>'ISTONE_INDONESIA_V1' or nullif(btrim(p_batch->>'parser_version'),'') is null then raise exception using errcode='22023',message='Parser adapter/version không hợp lệ.';end if;
  if coalesce(p_batch->>'source_sha256','')!~'^[A-Fa-f0-9]{64}$' or public.crm_import_numeric(p_batch->'source_file_size_bytes',0) is null or (p_batch->>'source_file_size_bytes')::bigint>20971520 then raise exception using errcode='22023',message='Metadata file không hợp lệ.';end if;
  if nullif(btrim(p_batch->>'source_filename'),'') is null or length(p_batch->>'source_filename')>255 or p_batch->>'source_filename'~'[\\/]' then raise exception using errcode='22023',message='Tên file không hợp lệ.';end if;
  v_effective:=public.crm_product_parse_date(p_batch,'effective_date',true);
  insert into public.product_import_batches(supplier,source_filename,source_sha256,source_file_size_bytes,parser_adapter,parser_version,effective_date,status,request_id,page_count,row_count,origin_candidate,created_by_user_id,updated_by_user_id)
  values(nullif(btrim(p_batch->>'supplier'),''),p_batch->>'source_filename',lower(p_batch->>'source_sha256'),(p_batch->>'source_file_size_bytes')::bigint,p_batch->>'parser_adapter',p_batch->>'parser_version',v_effective,'STAGED',p_request_id,nullif(p_batch->>'page_count','')::integer,jsonb_array_length(p_rows),nullif(btrim(p_batch->>'origin_candidate'),''),v_actor,v_actor) returning id into v_batch_id;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row)<>'object' then raise exception using errcode='22023',message='Dòng staging không hợp lệ.';end if;
    insert into public.product_import_rows(batch_id,source_page,source_row_number,stt,source_values,source_size_text,source_size_unit,source_packaging_text,code,code_normalized,name,name_normalized,width_cm,height_cm,price_per_m2,price_per_box,price_per_piece,pieces_per_box,sqm_per_box,surface_candidate,origin_candidate,warnings,classification,selected_action,effective_date,updated_by_user_id)
    values(v_batch_id,coalesce((v_row->>'source_page')::integer,1),coalesce((v_row->>'source_row_number')::integer,(v_row->>'stt')::integer),nullif(v_row->>'stt','')::integer,coalesce(v_row->'source_values','{}'),nullif(v_row->>'source_size_text',''),nullif(v_row->>'source_size_unit',''),nullif(v_row->>'source_packaging_text',''),nullif(btrim(v_row->>'code'),''),public.crm_import_normalize_code(v_row->>'code'),nullif(btrim(v_row->>'name'),''),public.crm_import_normalize_name(v_row->>'name'),public.crm_import_numeric(v_row->'width_cm',3),public.crm_import_numeric(v_row->'height_cm',3),public.crm_import_numeric(v_row->'price_per_m2',0),public.crm_import_numeric(v_row->'price_per_box',0),public.crm_import_numeric(v_row->'price_per_piece',0),public.crm_import_numeric(v_row->'pieces_per_box',0)::integer,public.crm_import_numeric(v_row->'sqm_per_box',4),nullif(btrim(v_row->>'surface_candidate'),''),nullif(btrim(v_row->>'origin_candidate'),''),coalesce(array(select case when jsonb_typeof(x)='string' then x#>>'{}' else coalesce(x->>'code','CLIENT_WARNING') end from jsonb_array_elements(coalesce(v_row->'warnings','[]')) x),'{}'),'INVALID','NONE',v_effective,v_actor);
  end loop;
  perform public.crm_import_recompute(v_batch_id,false);v_summary:=public.crm_import_update_readiness(v_batch_id);
  perform public.crm_write_audit('stageProductImportR2','product_import_batches',v_batch_id::text,jsonb_build_object('rowCount',jsonb_array_length(p_rows),'status',(select status from public.product_import_batches where id=v_batch_id)));
  return jsonb_build_object('batch_id',v_batch_id,'status',(select status from public.product_import_batches where id=v_batch_id),'summary',v_summary,'idempotent_replay',false);
end $$;

create function public.crm_get_product_import(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb; begin
  if not public.crm_import_can_access(p_batch_id,false) then raise exception using errcode='42501',message='Bạn không có quyền đọc batch này.';end if;
  update public.product_import_rows r set is_stale=true where r.batch_id=p_batch_id and r.matched_product_id is not null and not exists(select 1 from public.products p where p.id=r.matched_product_id and p.version=r.current_product_version);
  perform public.crm_import_update_readiness(p_batch_id);
  select jsonb_build_object('batch',jsonb_build_object('id',b.id,'supplier',b.supplier,'source_filename',b.source_filename,'source_sha256',b.source_sha256,'source_file_size_bytes',b.source_file_size_bytes,'parser_adapter',b.parser_adapter,'parser_version',b.parser_version,'effective_date',b.effective_date,'status',b.status,'summary',b.summary,'origin_candidate',b.origin_candidate,'origin_accepted',b.origin_accepted,'created_by_user_id',b.created_by_user_id,'created_by_name',cu.name,'created_at',b.created_at,'updated_by_user_id',b.updated_by_user_id,'updated_by_name',uu.name,'updated_at',b.updated_at),
    'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.source_page,r.source_row_number,r.id) from public.product_import_rows r where r.batch_id=b.id),'[]')) into v_result
  from public.product_import_batches b left join public.app_users cu on cu.id=b.created_by_user_id left join public.app_users uu on uu.id=b.updated_by_user_id where b.id=p_batch_id;
  return v_result;
end $$;

create function public.crm_update_product_import_review(p_batch_id uuid,p_decisions jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor text:=public.crm_current_app_user_id();v_item jsonb;v_row public.product_import_rows%rowtype;v_group text;v_resolution text;v_rep uuid; begin
  if not public.crm_import_can_access(p_batch_id,true) or v_actor is null then raise exception using errcode='42501',message='Bạn không có quyền review batch này.';end if;
  if p_decisions is null or jsonb_typeof(p_decisions)<>'object' or pg_column_size(p_decisions)>262144 then raise exception using errcode='22023',message='Quyết định review không hợp lệ.';end if;
  if p_decisions?'origin_accepted' then update public.product_import_batches set origin_accepted=(p_decisions->>'origin_accepted')::boolean,updated_by_user_id=v_actor,updated_at=now() where id=p_batch_id;end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_decisions->'rows','[]')) loop
    select * into v_row from public.product_import_rows where id=(v_item->>'row_id')::uuid and batch_id=p_batch_id for update;
    if v_row.id is null then raise exception using errcode='22023',message='Dòng review không thuộc batch.';end if;
    if v_item?'surface_accepted' then update public.product_import_rows set surface_accepted=(v_item->>'surface_accepted')::boolean,updated_by_user_id=v_actor,updated_at=now() where id=v_row.id;end if;
    if v_item?'selected_action' then
      if v_item->>'selected_action' not in ('NONE','CREATE','UPDATE','SKIP') then raise exception using errcode='22023',message='Action không hợp lệ.';end if;
      if (v_row.classification in ('REVIEW','INVALID') and v_item->>'selected_action' not in ('NONE','SKIP')) or (v_row.classification='UNCHANGED' and v_item->>'selected_action'<>'NONE') then raise exception using errcode='22023',message='Action không an toàn cho phân loại hiện tại.';end if;
      update public.product_import_rows set selected_action=v_item->>'selected_action',updated_by_user_id=v_actor,updated_at=now() where id=v_row.id;
    end if;
  end loop;
  perform public.crm_import_recompute(p_batch_id,false);
  for v_item in select value from jsonb_array_elements(coalesce(p_decisions->'duplicates','[]')) loop
    v_group:=v_item->>'duplicate_group_id';v_resolution:=v_item->>'resolution';v_rep=nullif(v_item->>'representative_row_id','')::uuid;
    if v_resolution not in ('COLLAPSE','SKIP_GROUP') or not exists(select 1 from public.product_import_rows where batch_id=p_batch_id and duplicate_group_id=v_group) then raise exception using errcode='22023',message='Quyết định duplicate không hợp lệ.';end if;
    if v_resolution='COLLAPSE' and ((select min(duplicate_kind) from public.product_import_rows where batch_id=p_batch_id and duplicate_group_id=v_group)<>'IDENTICAL' or not exists(select 1 from public.product_import_rows where batch_id=p_batch_id and duplicate_group_id=v_group and id=v_rep)) then raise exception using errcode='22023',message='Chỉ collapse duplicate IDENTICAL với representative hợp lệ.';end if;
    update public.product_import_rows set duplicate_resolution=v_resolution,duplicate_representative_row_id=case when v_resolution='COLLAPSE' then v_rep end,selected_action=case when v_resolution='SKIP_GROUP' or id<>v_rep then 'SKIP' when base_classification='NEW' then 'CREATE' when base_classification in ('PRICE_CHANGED','INFO_CHANGED') then 'UPDATE' else 'NONE' end,updated_by_user_id=v_actor,updated_at=now() where batch_id=p_batch_id and duplicate_group_id=v_group;
  end loop;
  perform public.crm_import_recompute(p_batch_id,false);
  -- Reapply explicit duplicate decisions after comparison recomputation.
  for v_item in select value from jsonb_array_elements(coalesce(p_decisions->'duplicates','[]')) loop
    v_group:=v_item->>'duplicate_group_id';v_resolution:=v_item->>'resolution';v_rep=nullif(v_item->>'representative_row_id','')::uuid;
    update public.product_import_rows set duplicate_resolution=v_resolution,duplicate_representative_row_id=case when v_resolution='COLLAPSE' then v_rep end,selected_action=case when v_resolution='SKIP_GROUP' or id<>v_rep then 'SKIP' when base_classification='NEW' then 'CREATE' when base_classification in ('PRICE_CHANGED','INFO_CHANGED') then 'UPDATE' else 'NONE' end where batch_id=p_batch_id and duplicate_group_id=v_group;
  end loop;
  update public.product_import_batches set updated_by_user_id=v_actor,updated_at=now() where id=p_batch_id;
  perform public.crm_import_update_readiness(p_batch_id);
  perform public.crm_write_audit('reviewProductImportR2','product_import_batches',p_batch_id::text,jsonb_build_object('status',(select status from public.product_import_batches where id=p_batch_id)));
  return public.crm_get_product_import(p_batch_id);
end $$;

create function public.crm_refresh_product_import(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor text:=public.crm_current_app_user_id();begin
  if not public.crm_import_can_access(p_batch_id,true) or v_actor is null then raise exception using errcode='42501',message='Bạn không có quyền làm mới batch này.';end if;
  perform public.crm_import_recompute(p_batch_id,true);perform public.crm_import_update_readiness(p_batch_id);
  update public.product_import_batches set updated_by_user_id=v_actor,updated_at=now() where id=p_batch_id;
  perform public.crm_write_audit('refreshProductImportR2','product_import_batches',p_batch_id::text,jsonb_build_object('status',(select status from public.product_import_batches where id=p_batch_id)));
  return public.crm_get_product_import(p_batch_id);
end $$;

revoke all on public.product_import_batches,public.product_import_rows from anon,authenticated;
revoke all on function public.crm_import_normalize_code(text),public.crm_import_normalize_name(text),public.crm_import_numeric(jsonb,integer),public.crm_import_can_access(uuid,boolean),public.crm_import_recompute(uuid,boolean),public.crm_import_update_readiness(uuid) from public,anon,authenticated;
revoke all on function public.crm_stage_product_import(jsonb,jsonb,uuid),public.crm_get_product_import(uuid),public.crm_update_product_import_review(uuid,jsonb),public.crm_refresh_product_import(uuid) from public,anon;
grant execute on function public.crm_stage_product_import(jsonb,jsonb,uuid),public.crm_get_product_import(uuid),public.crm_update_product_import_review(uuid,jsonb),public.crm_refresh_product_import(uuid) to authenticated;

do $$ begin
  if exists(select 1 from information_schema.role_table_grants where table_schema='public' and table_name in ('product_import_batches','product_import_rows') and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')) then raise exception 'PRODUCT_R2_STEP5_VERIFY_FAIL: direct import-table write grant.';end if;
  if to_regprocedure('public.crm_confirm_product_import(uuid)') is not null then raise exception 'PRODUCT_R2_STEP5_VERIFY_FAIL: confirm RPC ngoài scope.';end if;
end $$;

commit;
