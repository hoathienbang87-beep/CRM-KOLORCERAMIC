\set ON_ERROR_STOP on
begin;

create temporary table catalog_03b_products(
  ordinal integer primary key,
  id uuid not null,
  old_price numeric not null,
  old_version bigint not null
) on commit drop;
insert into catalog_03b_products
select ordinality::integer,(item->>'id')::uuid,(item->>'price_per_m2')::numeric,(item->>'version')::bigint
from jsonb_array_elements(__BASELINE_JSON__) with ordinality as x(item,ordinality);

create temporary table catalog_03b_payloads(
  fixture text primary key,
  batch jsonb not null,
  rows jsonb not null
) on commit drop;
insert into catalog_03b_payloads values
  ('ready',__READY_BATCH__,__READY_ROWS__),
  ('conflict',__CONFLICT_BATCH__,__CONFLICT_ROWS__),
  ('retry',__RETRY_BATCH__,__RETRY_ROWS__),
  ('catalog',__CATALOG_BATCH__,__CATALOG_ROWS__);

create temporary table catalog_03b_state(
  fixture text primary key,
  batch_id uuid not null
) on commit drop;
grant all on catalog_03b_products,catalog_03b_payloads,catalog_03b_state to authenticated;

insert into public.app_users(id,email,name,role,active,lifecycle_status,supabase_auth_id)
values ('catalog-admin-03b-test','catalog-admin-03b@test.local','Catalog Admin 03B','admin',true,'active','44444444-4444-4444-8444-444444444444');

do $$
begin
  if (select count(*) from catalog_03b_products)<>3 then raise exception '03B_TEST_FAIL: baseline products'; end if;
  if exists (
    select 1 from catalog_03b_products s join public.products p on p.id=s.id
    where p.price_per_m2<>s.old_price or p.version<>s.old_version
  ) then raise exception '03B_TEST_FAIL: baseline mismatch'; end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
do $$
declare v jsonb; v_id uuid; v_denied boolean:=false;
begin
  select public.catalog_admin_preview_import(batch,rows) into v from catalog_03b_payloads where fixture='ready';
  if v->>'status'<>'READY' or (v->>'blocking')::integer<>0 then raise exception '03B_TEST_FAIL: ready preview'; end if;
  v_id:=(v->>'batch_id')::uuid;
  insert into catalog_03b_state values ('ready',v_id);

  begin
    perform public.catalog_admin_apply_import(v_id,'10000000-0000-4000-8000-000000000001');
  exception when others then
    if sqlerrm='CATALOG_IMPORT_APPROVAL_REQUIRED' then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception '03B_TEST_FAIL: apply without approval'; end if;

  v:=public.catalog_admin_approve_import(v_id,'20000000-0000-4000-8000-000000000001');
  if v->>'status'<>'APPROVED' or (v->>'idempotent_replay')::boolean then raise exception '03B_TEST_FAIL: approval'; end if;
  v:=public.catalog_admin_approve_import(v_id,'20000000-0000-4000-8000-000000000001');
  if not (v->>'idempotent_replay')::boolean then raise exception '03B_TEST_FAIL: approval replay'; end if;

  v:=public.catalog_admin_apply_import(v_id,'10000000-0000-4000-8000-000000000001');
  if v->>'status'<>'APPLIED' or (v->>'idempotent_replay')::boolean then raise exception '03B_TEST_FAIL: ready apply'; end if;
  v:=public.catalog_admin_apply_import(v_id,'10000000-0000-4000-8000-000000000001');
  if not (v->>'idempotent_replay')::boolean then raise exception '03B_TEST_FAIL: apply replay'; end if;
end;
$$;
reset role;

do $$
begin
  if not exists (
    select 1 from catalog_03b_products s join public.products p on p.id=s.id
    where s.ordinal=1 and p.price_per_m2=s.old_price+1000 and p.version=s.old_version+1
  ) then raise exception '03B_TEST_FAIL: applied update'; end if;
  if not exists (
    select 1 from catalog_03b_products s join public.products p on p.id=s.id
    where s.ordinal=2 and p.price_per_m2=s.old_price and p.version=s.old_version
  ) then raise exception '03B_TEST_FAIL: blank price overwrite'; end if;
  if (select count(*) from public.product_import_rows r join catalog_03b_state s on s.batch_id=r.batch_id where s.fixture='ready' and r.classification='DUPLICATE_IN_FILE' and r.selected_action='SKIP')<>1 then
    raise exception '03B_TEST_FAIL: duplicate same price';
  end if;
  if (select count(*) from public.product_price_history h join catalog_03b_state s on s.batch_id=h.import_batch_id where s.fixture='ready')<>1 then
    raise exception '03B_TEST_FAIL: history idempotency';
  end if;
  if (select count(*) from public.audit_logs a join catalog_03b_state s on a.entity_id=s.batch_id::text where s.fixture='ready' and a.action='catalogImportApprove03B')<>1 then
    raise exception '03B_TEST_FAIL: approval audit idempotency';
  end if;
  if (select count(*) from public.audit_logs a join catalog_03b_state s on (a.raw_data->>'batch_id')::uuid=s.batch_id where s.fixture='ready' and a.action='catalogImportProductApply03B' and a.raw_data->>'action'='UPDATE' and a.raw_data ? 'before' and a.raw_data ? 'after')<>1 then
    raise exception '03B_TEST_FAIL: apply before/after audit';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
do $$
declare v jsonb; v_id uuid; v_denied boolean:=false;
begin
  select public.catalog_admin_preview_import(batch,rows) into v from catalog_03b_payloads where fixture='conflict';
  if v->>'status'<>'STAGED' or (v->>'blocking')::integer<>2 then raise exception '03B_TEST_FAIL: conflict preview'; end if;
  v_id:=(v->>'batch_id')::uuid;
  insert into catalog_03b_state values ('conflict',v_id);
  begin
    perform public.catalog_admin_approve_import(v_id,'20000000-0000-4000-8000-000000000002');
  exception when others then
    if sqlerrm='CATALOG_IMPORT_NOT_READY_FOR_APPROVAL' then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception '03B_TEST_FAIL: conflict approval'; end if;
end;
$$;
reset role;

do $$
begin
  if (select count(*) from public.product_import_rows r join catalog_03b_state s on s.batch_id=r.batch_id where s.fixture='conflict' and r.classification='CONFLICT' and r.conflict_code='PRICE_CONFLICT')<>2 then
    raise exception '03B_TEST_FAIL: duplicate different price';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
do $$
declare v jsonb; v_id uuid;
begin
  select public.catalog_admin_preview_import(batch,rows) into v from catalog_03b_payloads where fixture='retry';
  v_id:=(v->>'batch_id')::uuid;
  insert into catalog_03b_state values ('retry',v_id);
  perform public.catalog_admin_approve_import(v_id,'20000000-0000-4000-8000-000000000003');
end;
$$;
reset role;

update public.products set version=version+1 where id=(select id from catalog_03b_products where ordinal=3);
set local role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
do $$
declare v_denied boolean:=false;
begin
  begin
    perform public.catalog_admin_apply_import((select batch_id from catalog_03b_state where fixture='retry'),'10000000-0000-4000-8000-000000000003');
  exception when serialization_failure then v_denied:=true;
  end;
  if not v_denied then raise exception '03B_TEST_FAIL: stale apply'; end if;
end;
$$;
reset role;
update public.products p set version=s.old_version from catalog_03b_products s where s.ordinal=3 and p.id=s.id;

set local role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
do $$
declare v jsonb;
begin
  v:=public.catalog_admin_apply_import((select batch_id from catalog_03b_state where fixture='retry'),'10000000-0000-4000-8000-000000000003');
  if (v->>'idempotent_replay')::boolean then raise exception '03B_TEST_FAIL: retry after error'; end if;
  v:=public.catalog_admin_apply_import((select batch_id from catalog_03b_state where fixture='retry'),'10000000-0000-4000-8000-000000000003');
  if not (v->>'idempotent_replay')::boolean then raise exception '03B_TEST_FAIL: retry replay'; end if;
end;
$$;
reset role;

update public.products set version=version+1 where id=(select id from catalog_03b_products where ordinal=3);
set local role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
do $$
declare v_denied boolean:=false;
begin
  begin
    perform public.catalog_admin_rollback_import((select batch_id from catalog_03b_state where fixture='retry'),'30000000-0000-4000-8000-000000000003');
  exception when serialization_failure then v_denied:=true;
  end;
  if not v_denied then raise exception '03B_TEST_FAIL: rollback version conflict'; end if;
end;
$$;
reset role;
update public.products p set version=s.old_version+1 from catalog_03b_products s where s.ordinal=3 and p.id=s.id;

set local role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
do $$
declare v jsonb;
begin
  v:=public.catalog_admin_rollback_import((select batch_id from catalog_03b_state where fixture='retry'),'30000000-0000-4000-8000-000000000003');
  if v->>'status'<>'ROLLED_BACK' or (v->>'idempotent_replay')::boolean then raise exception '03B_TEST_FAIL: retry rollback'; end if;
  v:=public.catalog_admin_rollback_import((select batch_id from catalog_03b_state where fixture='retry'),'30000000-0000-4000-8000-000000000003');
  if not (v->>'idempotent_replay')::boolean then raise exception '03B_TEST_FAIL: retry rollback replay'; end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
do $$
declare v jsonb; v_id uuid;
begin
  select public.catalog_admin_preview_import(batch,rows) into v from catalog_03b_payloads where fixture='catalog';
  if v->>'status'<>'READY' then raise exception '03B_TEST_FAIL: catalog preview'; end if;
  v_id:=(v->>'batch_id')::uuid;
  insert into catalog_03b_state values ('catalog',v_id);
  perform public.catalog_admin_approve_import(v_id,'20000000-0000-4000-8000-000000000004');
  v:=public.catalog_admin_apply_import(v_id,'10000000-0000-4000-8000-000000000004');
  if (v->'summary'->>'created')::integer<>2 then raise exception '03B_TEST_FAIL: catalog create'; end if;
  v:=public.catalog_admin_apply_import(v_id,'10000000-0000-4000-8000-000000000004');
  if not (v->>'idempotent_replay')::boolean then raise exception '03B_TEST_FAIL: catalog apply replay'; end if;
end;
$$;
reset role;

do $$
begin
  if (select count(*) from public.product_import_rows r join catalog_03b_state s on s.batch_id=r.batch_id join public.products p on p.id=r.matched_product_id where s.fixture='catalog' and r.classification='NEW' and r.selected_action='CREATE' and not p.is_published)<>2 then
    raise exception '03B_TEST_FAIL: new classification';
  end if;
  if (select count(*) from public.product_import_rows r join catalog_03b_state s on s.batch_id=r.batch_id join public.products p on p.id=r.matched_product_id where s.fixture='catalog' and p.data_status='READY')<>1
     or (select count(*) from public.product_import_rows r join catalog_03b_state s on s.batch_id=r.batch_id join public.products p on p.id=r.matched_product_id where s.fixture='catalog' and p.data_status='UPDATING')<>1 then
    raise exception '03B_TEST_FAIL: ready/draft classification';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
do $$
declare v jsonb;
begin
  v:=public.catalog_admin_rollback_import((select batch_id from catalog_03b_state where fixture='catalog'),'30000000-0000-4000-8000-000000000004');
  if (v->'summary'->>'archived_created')::integer<>2 then raise exception '03B_TEST_FAIL: created rollback archive'; end if;
  v:=public.catalog_admin_rollback_import((select batch_id from catalog_03b_state where fixture='catalog'),'30000000-0000-4000-8000-000000000004');
  if not (v->>'idempotent_replay')::boolean then raise exception '03B_TEST_FAIL: catalog rollback replay'; end if;

  v:=public.catalog_admin_rollback_import((select batch_id from catalog_03b_state where fixture='ready'),'30000000-0000-4000-8000-000000000001');
  if (v->'summary'->>'restored')::integer<>1 then raise exception '03B_TEST_FAIL: update rollback'; end if;
  v:=public.catalog_admin_rollback_import((select batch_id from catalog_03b_state where fixture='ready'),'30000000-0000-4000-8000-000000000001');
  if not (v->>'idempotent_replay')::boolean then raise exception '03B_TEST_FAIL: update rollback replay'; end if;
end;
$$;
reset role;

do $$
begin
  if not exists (
    select 1 from catalog_03b_products s join public.products p on p.id=s.id
    where s.ordinal=1 and p.price_per_m2=s.old_price and p.version=s.old_version+2
  ) then raise exception '03B_TEST_FAIL: rollback restore'; end if;
  if not exists (
    select 1 from catalog_03b_products s join public.products p on p.id=s.id
    where s.ordinal=3 and p.price_per_m2=s.old_price and p.version=s.old_version+2
  ) then raise exception '03B_TEST_FAIL: retry rollback restore'; end if;
  if (select count(*) from public.audit_logs where action='catalogImportProductApply03B' and raw_data ?& array['batch_id','row_id','product_id','action','before','after'])<>4 then
    raise exception '03B_TEST_FAIL: apply audit count';
  end if;
  if (select count(*) from public.audit_logs where action='catalogImportProductRollback03B' and raw_data ?& array['batch_id','rollback_batch_id','row_id','product_id','action','before','after'])<>4 then
    raise exception '03B_TEST_FAIL: rollback audit count';
  end if;
  if exists (
    select 1 from public.product_import_rows r join catalog_03b_state s on s.batch_id=r.batch_id
    where s.fixture='ready' and r.disposition='MISSING_PRICE' and r.selected_action<>'SKIP'
  ) then raise exception '03B_TEST_FAIL: blank price action'; end if;
end;
$$;

rollback;
\echo CATALOG_03B_LOCAL_INTEGRATION_PASS
