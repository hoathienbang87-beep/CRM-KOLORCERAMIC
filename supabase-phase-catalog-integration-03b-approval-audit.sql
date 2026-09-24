-- CATALOG INTEGRATION 03B — explicit approval gate and row-level audit.
-- Apply only after approved 01B + 02B, and only on the guarded 03B integration environment.
begin;

select pg_advisory_xact_lock(hashtext('CATALOG-INTEGRATION-03B-APPROVAL-AUDIT'));

do $$
begin
  if to_regclass('public.product_import_batches') is null
     or to_regprocedure('public.catalog_admin_preview_import(jsonb,jsonb)') is null
     or to_regprocedure('public.catalog_admin_apply_import(uuid,uuid)') is null
     or to_regprocedure('public.catalog_admin_rollback_import(uuid,uuid)') is null then
    raise exception 'CATALOG_03B_PRECONDITION_FAIL: approved 01B/02B objects are missing.';
  end if;
  if to_regprocedure('public.catalog_admin_approve_import(uuid,uuid)') is not null
     or exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='product_import_batches'
         and column_name in ('approved_by_user_id','approved_at','approval_idempotency_key')
     ) then
    raise exception 'CATALOG_03B_PRECONDITION_FAIL: migration already or partially applied.';
  end if;
end;
$$;

alter table public.product_import_batches
  add column approved_by_user_id text references public.app_users(id) on delete restrict,
  add column approved_at timestamptz,
  add column approval_idempotency_key uuid,
  add constraint product_import_batches_approval_key_unique unique (approval_idempotency_key),
  add constraint product_import_batches_approval_shape_check check (
    (approved_by_user_id is null and approved_at is null and approval_idempotency_key is null)
    or (approved_by_user_id is not null and approved_at is not null and approval_idempotency_key is not null)
  );

comment on column public.product_import_batches.approved_at is
  'Explicit human approval gate recorded before catalog apply. Added by Prompt 03B.';

-- Preserve the approved 02B implementations verbatim behind non-browser names.
alter function public.catalog_admin_apply_import(uuid,uuid)
  rename to catalog_admin_apply_import_02b_impl;
alter function public.catalog_admin_rollback_import(uuid,uuid)
  rename to catalog_admin_rollback_import_02b_impl;

revoke all on function public.catalog_admin_apply_import_02b_impl(uuid,uuid) from public, anon, authenticated;
revoke all on function public.catalog_admin_rollback_import_02b_impl(uuid,uuid) from public, anon, authenticated;

create function public.catalog_admin_approve_import(p_batch_id uuid, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor text := public.catalog_require_admin_02b();
  b public.product_import_batches%rowtype;
begin
  if p_batch_id is null or p_idempotency_key is null then
    raise exception using errcode='22023', message='CATALOG_IMPORT_APPROVAL_KEYS_REQUIRED';
  end if;

  select * into b from public.product_import_batches where id=p_batch_id for update;
  if b.id is null then
    raise exception using errcode='P0002', message='CATALOG_IMPORT_BATCH_NOT_FOUND';
  end if;

  if b.approved_at is not null then
    if b.approval_idempotency_key=p_idempotency_key then
      return jsonb_build_object('batch_id',b.id,'status','APPROVED','idempotent_replay',true);
    end if;
    raise exception using errcode='P0001', message='CATALOG_IMPORT_ALREADY_APPROVED';
  end if;

  if b.status<>'READY' or b.import_mode='ROLLBACK' then
    raise exception using errcode='P0001', message='CATALOG_IMPORT_NOT_READY_FOR_APPROVAL';
  end if;

  update public.product_import_batches
  set approved_by_user_id=v_actor, approved_at=now(), approval_idempotency_key=p_idempotency_key
  where id=b.id;

  perform public.crm_write_audit(
    'catalogImportApprove03B','product_import_batches',b.id::text,
    jsonb_build_object('batch_id',b.id,'action','APPROVE','status','READY','approved_by',v_actor)
  );

  return jsonb_build_object('batch_id',b.id,'status','APPROVED','idempotent_replay',false);
end;
$$;

create function public.catalog_admin_apply_import(p_batch_id uuid, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  b public.product_import_batches%rowtype;
  r public.product_import_rows%rowtype;
  v_result jsonb;
  v_after jsonb;
begin
  perform public.catalog_require_admin_02b();
  if p_batch_id is null or p_idempotency_key is null then
    raise exception using errcode='22023', message='CATALOG_IMPORT_APPLY_KEYS_REQUIRED';
  end if;

  select * into b from public.product_import_batches where id=p_batch_id;
  if b.id is null then
    raise exception using errcode='P0002', message='CATALOG_IMPORT_BATCH_NOT_FOUND';
  end if;
  if b.approved_at is null or b.approved_by_user_id is null or b.approval_idempotency_key is null then
    raise exception using errcode='P0001', message='CATALOG_IMPORT_APPROVAL_REQUIRED';
  end if;

  v_result := public.catalog_admin_apply_import_02b_impl(p_batch_id,p_idempotency_key);

  if not coalesce((v_result->>'idempotent_replay')::boolean,false) then
    for r in
      select * from public.product_import_rows
      where batch_id=p_batch_id and selected_action in ('CREATE','UPDATE')
      order by source_page,source_row_number,id
    loop
      v_after := public.catalog_product_snapshot_02b(r.matched_product_id);
      perform public.crm_write_audit(
        'catalogImportProductApply03B','products',r.matched_product_id::text,
        jsonb_build_object(
          'batch_id',p_batch_id,
          'row_id',r.id,
          'product_id',r.matched_product_id,
          'action',r.selected_action,
          'before',case when r.selected_action='CREATE' then 'null'::jsonb else r.previous_snapshot end,
          'after',coalesce(v_after,'null'::jsonb)
        )
      );
    end loop;
  end if;

  return v_result;
end;
$$;

create function public.catalog_admin_rollback_import(p_batch_id uuid, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_item jsonb;
  v_before_rows jsonb;
  v_after jsonb;
  v_result jsonb;
  v_rollback_batch_id uuid;
begin
  perform public.catalog_require_admin_02b();
  if p_batch_id is null or p_idempotency_key is null then
    raise exception using errcode='22023', message='CATALOG_IMPORT_ROLLBACK_KEYS_REQUIRED';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'row_id',r.id,
    'product_id',r.matched_product_id,
    'selected_action',r.selected_action,
    'before',public.catalog_product_snapshot_02b(r.matched_product_id)
  ) order by r.source_page desc,r.source_row_number desc,r.id desc),'[]'::jsonb)
  into v_before_rows
  from public.product_import_rows r
  where r.batch_id=p_batch_id and r.selected_action in ('CREATE','UPDATE');

  v_result := public.catalog_admin_rollback_import_02b_impl(p_batch_id,p_idempotency_key);

  if not coalesce((v_result->>'idempotent_replay')::boolean,false) then
    v_rollback_batch_id := nullif(v_result->'summary'->>'rollback_batch_id','')::uuid;
    for v_item in select value from jsonb_array_elements(v_before_rows) loop
      v_after := public.catalog_product_snapshot_02b((v_item->>'product_id')::uuid);
      perform public.crm_write_audit(
        'catalogImportProductRollback03B','products',v_item->>'product_id',
        jsonb_build_object(
          'batch_id',p_batch_id,
          'rollback_batch_id',v_rollback_batch_id,
          'row_id',(v_item->>'row_id')::uuid,
          'product_id',(v_item->>'product_id')::uuid,
          'action',case when v_item->>'selected_action'='CREATE' then 'ARCHIVE_CREATED' else 'RESTORE' end,
          'before',coalesce(v_item->'before','null'::jsonb),
          'after',coalesce(v_after,'null'::jsonb)
        )
      );
    end loop;
  end if;

  return v_result;
end;
$$;

revoke all on function public.catalog_admin_approve_import(uuid,uuid) from public, anon, authenticated;
revoke all on function public.catalog_admin_apply_import(uuid,uuid) from public, anon, authenticated;
revoke all on function public.catalog_admin_rollback_import(uuid,uuid) from public, anon, authenticated;
grant execute on function public.catalog_admin_approve_import(uuid,uuid) to authenticated;
grant execute on function public.catalog_admin_apply_import(uuid,uuid) to authenticated;
grant execute on function public.catalog_admin_rollback_import(uuid,uuid) to authenticated;

do $$
declare
  v_bad integer;
begin
  if to_regprocedure('public.catalog_admin_approve_import(uuid,uuid)') is null
     or to_regprocedure('public.catalog_admin_apply_import_02b_impl(uuid,uuid)') is null
     or to_regprocedure('public.catalog_admin_rollback_import_02b_impl(uuid,uuid)') is null then
    raise exception 'CATALOG_03B_VERIFY_FAIL: required functions missing.';
  end if;

  if not has_function_privilege('authenticated','public.catalog_admin_approve_import(uuid,uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.catalog_admin_apply_import(uuid,uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.catalog_admin_rollback_import(uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.catalog_admin_apply_import_02b_impl(uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.catalog_admin_rollback_import_02b_impl(uuid,uuid)','EXECUTE') then
    raise exception 'CATALOG_03B_VERIFY_FAIL: function grants are unsafe.';
  end if;

  select count(*) into v_bad
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname in ('catalog_admin_approve_import','catalog_admin_apply_import','catalog_admin_rollback_import')
    and (not p.prosecdef or not coalesce(p.proconfig,'{}'::text[]) @> array['search_path=pg_catalog, public']);
  if v_bad<>0 then
    raise exception 'CATALOG_03B_VERIFY_FAIL: wrapper security-definer/search-path mismatch.';
  end if;
end;
$$;

commit;
