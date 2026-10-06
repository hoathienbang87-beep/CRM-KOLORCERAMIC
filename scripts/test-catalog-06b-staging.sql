-- Prompt 06B cloud-staging runtime test. Fixtures are transactionally rolled back.
begin;
select pg_advisory_xact_lock(hashtext('CATALOG-06B-STAGING-RUNTIME-TEST'));

create temporary table catalog_06b_guard on commit drop as
select id,to_jsonb(p) old_row from public.products p;
create temporary table catalog_06b_counts on commit drop as
select (select count(*) from public.product_import_batches) batches,
       (select count(*) from public.product_import_rows) rows,
       (select count(*) from public.product_price_history) history,
       (select count(*) from public.audit_logs) audit;
grant select on catalog_06b_guard to authenticated;
create temporary table catalog_06b_result(batch_id uuid) on commit drop;
grant all on catalog_06b_result to authenticated;

insert into public.app_users(id,supabase_auth_id,email,name,role,active,lifecycle_status,created_at,updated_at)
values
('catalog-06b-admin','60606060-6060-4060-8060-606060606060','catalog-06b-admin@staging.invalid','Catalog 06B Admin','admin',true,'active',now(),now()),
('catalog-06b-sale','60606060-6060-4060-8060-606060606061','catalog-06b-sale@staging.invalid','Catalog 06B Sale','sale',true,'active',now(),now());

set local role authenticated;
select set_config('request.jwt.claim.sub','60606060-6060-4060-8060-606060606060',true);

do $$
declare
  p1 public.products%rowtype;
  p2 public.products%rowtype;
  v_batch jsonb;
  v_rows jsonb;
  v_result jsonb;
  v_batch_id uuid;
  v_conflict_row uuid;
  v_exclude_row uuid;
  v_approval uuid := '60606060-6060-4060-8060-606060606070';
  v_apply uuid := '60606060-6060-4060-8060-606060606071';
  v_rollback uuid := '60606060-6060-4060-8060-606060606072';
  v_before_count integer;
begin
  select * into p1 from public.products where active and data_status='READY' and price_per_m2 is not null order by id limit 1;
  select * into p2 from public.products where active and data_status='READY' and price_per_m2 is not null and id<>p1.id order by id limit 1;
  if p1.id is null or p2.id is null then raise exception 'CATALOG_06B_TEST_FIXTURE_PRODUCTS_MISSING'; end if;

  v_batch := jsonb_build_object(
    'supplier','06B STAGING FIXTURE','source_filename','catalog-06b-fixture.xlsx',
    'source_sha256',repeat('6',64),'source_file_size_bytes',606,
    'parser_adapter','CATALOG_06B_STAGING_FIXTURE','parser_version','1.0.0',
    'effective_date',current_date,'import_mode','PRICE_UPDATE_ONLY','source_format','EXCEL',
    'source_metadata',jsonb_build_object('prompt','06B','fixture',true)
  );
  v_rows := jsonb_build_array(
    jsonb_build_object('source_page',1,'source_row_number',1,'source_values',jsonb_build_object(),
      'code',p1.code,'name',p1.name,'width_mm',p1.width_mm,'height_mm',p1.height_mm,'surface',p1.surface,
      'classification','CHANGED','disposition','READY','match_rule','PRODUCT_ID','selected_action','UPDATE',
      'matched_product_id',p1.id,'current_product_version',p1.version,'warnings',jsonb_build_array(),
      'proposed_snapshot',jsonb_build_object('price_per_m2',p1.price_per_m2+1000,'price_effective_date',current_date)),
    jsonb_build_object('source_page',1,'source_row_number',2,
      'source_values',jsonb_build_object('catalog_match',jsonb_build_object('candidates',jsonb_build_array(jsonb_build_object('id',p2.id)),'suggestions',jsonb_build_array())),
      'code',p2.code,'name',p2.name,'width_mm',p2.width_mm,'height_mm',p2.height_mm,'surface',p2.surface,
      'classification','CONFLICT','disposition','CONFLICT','match_rule','MANUAL','conflict_code','MULTIPLE_MATCH_CANDIDATES','selected_action','NONE',
      'warnings',jsonb_build_array(),'proposed_snapshot',jsonb_build_object('price_per_m2',p2.price_per_m2+2000,'price_effective_date',current_date)),
    jsonb_build_object('source_page',1,'source_row_number',3,'source_values',jsonb_build_object(),
      'code','DUP-06B','name','DUPLICATE 06B','classification','DUPLICATE_IN_FILE','disposition','DUPLICATE',
      'conflict_code','IDENTICAL_VARIANT_PRICE','selected_action','SKIP','warnings',jsonb_build_array(),'proposed_snapshot',jsonb_build_object()),
    jsonb_build_object('source_page',1,'source_row_number',4,'source_values',jsonb_build_object(),
      'code','EXCLUDE-06B','name','EXCLUDE 06B','classification','CONFLICT','disposition','CONFLICT',
      'conflict_code','PRICE_CONFLICT','selected_action','NONE','warnings',jsonb_build_array(),'proposed_snapshot',jsonb_build_object())
  );

  v_result := public.catalog_admin_preview_import(v_batch,v_rows);
  v_batch_id := (v_result->>'batch_id')::uuid;

  -- dry-run catalog unchanged
  if v_result->>'status'<>'STAGED' or exists(select 1 from catalog_06b_guard g join public.products p on p.id=g.id where g.old_row is distinct from to_jsonb(p)) then
    raise exception 'CATALOG_06B_DRY_RUN_CHANGED_CATALOG';
  end if;

  select (x->>'id')::uuid into v_conflict_row from jsonb_array_elements(public.catalog_admin_get_import_batch_v1(v_batch_id)->'rows') x where (x->>'source_row_number')::integer=2;
  select (x->>'id')::uuid into v_exclude_row from jsonb_array_elements(public.catalog_admin_get_import_batch_v1(v_batch_id)->'rows') x where (x->>'source_row_number')::integer=4;
  v_result := public.catalog_admin_review_import_rows_v1(v_batch_id,jsonb_build_array(jsonb_build_object('row_id',v_conflict_row,'decision','USE_CANDIDATE','candidate_product_id',p2.id)));
  -- candidate review
  if v_result->'summary'->>'unresolved'<>'1' or not exists(select 1 from jsonb_array_elements(v_result->'rows') x where x->>'id'=v_conflict_row::text and x->>'selected_action'='UPDATE' and x->>'matched_product_id'=p2.id::text and x->>'match_rule'='MANUAL_CANDIDATE') then
    raise exception 'CATALOG_06B_CANDIDATE_REVIEW_FAIL';
  end if;
  v_result := public.catalog_admin_review_import_rows_v1(v_batch_id,jsonb_build_array(jsonb_build_object('row_id',v_exclude_row,'decision','EXCLUDE')));
  -- exclude decision
  if v_result->>'status'<>'READY' or not exists(select 1 from jsonb_array_elements(v_result->'rows') x where x->>'id'=v_exclude_row::text and x->>'selected_action'='SKIP' and x->>'disposition'='EXCLUDED_BY_REVIEW') then
    raise exception 'CATALOG_06B_EXCLUDE_REVIEW_FAIL';
  end if;

  -- approval gate
  begin perform public.catalog_admin_apply_import(v_batch_id,v_apply); raise exception 'EXPECTED_APPROVAL_DENIAL';
  exception when others then if sqlerrm not like '%CATALOG_IMPORT_APPROVAL_REQUIRED%' then raise; end if; end;
  v_result := public.catalog_admin_approve_import(v_batch_id,v_approval);
  if v_result->>'status'<>'APPROVED' then raise exception 'CATALOG_06B_APPROVAL_FAIL'; end if;

  v_result := public.catalog_admin_apply_import(v_batch_id,v_apply);
  -- apply result
  if v_result->>'status'<>'APPLIED' or (v_result->'summary'->>'updated')::integer<>2 then raise exception 'CATALOG_06B_APPLY_FAIL'; end if;
  v_result := public.catalog_admin_apply_import(v_batch_id,v_apply);
  -- apply replay
  if not (v_result->>'idempotent_replay')::boolean then raise exception 'CATALOG_06B_APPLY_REPLAY_FAIL'; end if;
  if (public.catalog_admin_list_import_batches_v1('APPLIED',30,0)->'pagination'->>'total')::integer<1
     or public.catalog_admin_get_import_batch_v1(v_batch_id)->>'status'<>'APPLIED' then raise exception 'CATALOG_06B_HISTORY_READ_FAIL'; end if;

  v_result := public.catalog_admin_rollback_import(v_batch_id,v_rollback);
  -- rollback result
  if v_result->>'status'<>'ROLLED_BACK' or (v_result->'summary'->>'restored')::integer<>2 then raise exception 'CATALOG_06B_ROLLBACK_FAIL'; end if;
  v_result := public.catalog_admin_rollback_import(v_batch_id,v_rollback);
  -- rollback replay
  if not (v_result->>'idempotent_replay')::boolean then raise exception 'CATALOG_06B_ROLLBACK_REPLAY_FAIL'; end if;

  if (select price_per_m2 from public.products where id=p1.id) is distinct from p1.price_per_m2
     or (select price_per_m2 from public.products where id=p2.id) is distinct from p2.price_per_m2 then
    raise exception 'CATALOG_06B_ROLLBACK_VALUE_FAIL';
  end if;
  insert into catalog_06b_result values(v_batch_id);
end;
$$;

reset role;
-- audit before/after
do $$ declare v_batch_id uuid; begin
  select batch_id into v_batch_id from catalog_06b_result;
  if (select count(*) from public.audit_logs where entity_id=v_batch_id::text and action in ('catalogImportPreview02B','catalogImportReview06B','catalogImportApprove03B','catalogImportApply02B','catalogImportRollback02B'))<6
     or (select count(*) from public.audit_logs where action='catalogImportProductApply03B' and raw_data->>'batch_id'=v_batch_id::text and raw_data ?& array['before','after'])<>2
     or (select count(*) from public.audit_logs where action='catalogImportProductRollback03B' and raw_data->>'batch_id'=v_batch_id::text and raw_data ?& array['before','after'])<>2 then
    raise exception 'CATALOG_06B_AUDIT_FAIL';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','60606060-6060-4060-8060-606060606061',true);
-- sale denied
do $$ begin
  begin perform public.catalog_admin_list_import_batches_v1(null,30,0); raise exception 'EXPECTED_SALE_DENIAL';
  exception when others then if sqlerrm not like '%CATALOG_ADMIN_REQUIRED%' then raise; end if; end;
end $$;
reset role;
set local role anon;
-- anon denied
do $$ begin
  begin perform public.catalog_admin_list_import_batches_v1(null,30,0); raise exception 'EXPECTED_ANON_DENIAL';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;

-- fixture rollback residue
do $$
begin
  -- Temp guards are gone after rollback, so verify only fixed fixture identifiers and source hash.
  if exists(select 1 from public.app_users where id in ('catalog-06b-admin','catalog-06b-sale'))
     or exists(select 1 from public.product_import_batches where parser_adapter='CATALOG_06B_STAGING_FIXTURE')
     or exists(select 1 from public.audit_logs where action='catalogImportReview06B' and raw_data->>'actor'='catalog-06b-admin') then
    raise exception 'CATALOG_06B_FIXTURE_RESIDUE';
  end if;
end;
$$;

select 'CATALOG_06B_STAGING_RUNTIME_PASS' as result;
