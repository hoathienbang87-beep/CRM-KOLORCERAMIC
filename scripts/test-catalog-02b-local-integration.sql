\set ON_ERROR_STOP on
begin;

create temporary table catalog_02b_test_state (
  product_id uuid,
  old_price numeric,
  old_version bigint,
  batch_id uuid,
  lead_id uuid
) on commit drop;
grant all on catalog_02b_test_state to anon, authenticated;

insert into catalog_02b_test_state(product_id, old_price, old_version)
select id, price_per_m2, version
from public.products
where active and data_status = 'READY' and price_per_m2 is not null
order by id limit 1;

do $$
begin
  if (select count(*) from catalog_02b_test_state) <> 1 then
    raise exception '02B_TEST_FAIL: missing baseline product';
  end if;
end;
$$;

insert into public.app_users(id,email,name,role,active,lifecycle_status,supabase_auth_id)
values ('catalog-admin-02b-test','catalog-admin-02b@test.local','Catalog Admin 02B','admin',true,'active','33333333-3333-4333-8333-333333333333');

update public.products
set is_published = true
where id = (select product_id from catalog_02b_test_state);

-- Anon can use only the public projection and lead submission API.
set local role anon;
do $$
declare
  v_result jsonb;
  v_denied boolean := false;
  v_rate_limited boolean := false;
  i integer;
begin
  v_result := public.catalog_public_list_products(null, 100, 0);
  if jsonb_array_length(v_result) <> 1
     or v_result->0 ? 'source_metadata'
     or v_result->0 ? 'stock_quantity' then
    raise exception '02B_TEST_FAIL: public projection/filter';
  end if;
  if public.catalog_public_get_product((select product_id from catalog_02b_test_state)) is null then
    raise exception '02B_TEST_FAIL: public detail missing';
  end if;

  begin
    perform 1 from public.products limit 1;
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception '02B_TEST_FAIL: anon direct products read'; end if;

  v_denied := false;
  begin
    perform public.crm_write_audit('forged','products','x','{}'::jsonb);
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception '02B_TEST_FAIL: anon audit forge'; end if;

  v_result := public.catalog_submit_website_lead(jsonb_build_object(
    'product_id',(select product_id from catalog_02b_test_state),
    'contact_name','Khách kiểm thử',
    'phone','0901234567',
    'message','Tư vấn sản phẩm',
    'source_path','/catalog-test',
    'utm',jsonb_build_object('source','02b-test'),
    'privacy_consent',true
  ));
  update catalog_02b_test_state set lead_id = (v_result->>'id')::uuid;
  if v_result->>'status' <> 'RECEIVED' then raise exception '02B_TEST_FAIL: lead submit'; end if;

  for i in 1..4 loop
    perform public.catalog_submit_website_lead(jsonb_build_object(
      'contact_name','Khách kiểm thử', 'phone','0901234567',
      'source_path','/catalog-test', 'privacy_consent',true
    ));
  end loop;
  begin
    perform public.catalog_submit_website_lead(jsonb_build_object(
      'contact_name','Khách kiểm thử', 'phone','0901234567',
      'source_path','/catalog-test', 'privacy_consent',true
    ));
  exception when others then
    if sqlstate = 'P0001' and sqlerrm = 'WEBSITE_LEAD_RATE_LIMITED' then
      v_rate_limited := true;
    else
      raise;
    end if;
  end;
  if not v_rate_limited then raise exception '02B_TEST_FAIL: lead rate limit'; end if;
end;
$$;
reset role;

do $$
begin
  if not exists (
    select 1 from public.website_leads
    where id = (select lead_id from catalog_02b_test_state)
      and privacy_consent_at is not null
  ) then raise exception '02B_TEST_FAIL: lead persistence'; end if;
  if not exists (
    select 1 from public.audit_logs
    where action = 'websiteLeadCreate02B'
      and entity_id = (select lead_id::text from catalog_02b_test_state)
      and raw_data ? 'product_id'
      and not (raw_data ? 'phone')
      and not (raw_data ? 'email')
  ) then raise exception '02B_TEST_FAIL: lead audit'; end if;
end;
$$;

-- Sale can search but cannot mutate catalog or enter admin import APIs.
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare
  v_result jsonb;
  v_denied boolean := false;
begin
  v_result := public.catalog_crm_search_products(null, 100);
  if jsonb_array_length(v_result) < 1 then raise exception '02B_TEST_FAIL: sale search'; end if;
  v_result := public.crm_list_products();
  if jsonb_array_length(v_result) < 1 then raise exception '02B_TEST_FAIL: legacy CRM list compatibility'; end if;

  begin
    perform public.crm_create_product('{}'::jsonb);
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception '02B_TEST_FAIL: sale legacy mutation'; end if;

  v_denied := false;
  begin
    perform public.crm_update_product(
      (select product_id from catalog_02b_test_state),
      (select old_version from catalog_02b_test_state),
      '{}'::jsonb
    );
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception '02B_TEST_FAIL: sale legacy update'; end if;

  v_denied := false;
  begin
    perform public.crm_set_product_active(
      (select product_id from catalog_02b_test_state),
      (select old_version from catalog_02b_test_state),
      false
    );
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception '02B_TEST_FAIL: sale legacy active mutation'; end if;

  v_denied := false;
  begin
    perform public.catalog_admin_preview_import('{}'::jsonb,'[]'::jsonb);
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception '02B_TEST_FAIL: sale admin preview'; end if;

  v_denied := false;
  begin
    insert into public.product_import_batches(
      supplier,source_filename,source_sha256,source_file_size_bytes,
      parser_adapter,parser_version,effective_date,created_by_user_id
    ) values ('x','x.xlsx',repeat('f',64),1,'x','1',current_date,'sale-1');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception '02B_TEST_FAIL: sale direct import write'; end if;
end;
$$;
reset role;

-- Manager is also read-only for catalog administration.
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.catalog_admin_list_website_leads(null, 10);
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception '02B_TEST_FAIL: manager admin lead access'; end if;
end;
$$;
reset role;

-- Admin price preview -> apply -> idempotent replay -> rollback -> replay.
set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$
declare
  v_result jsonb;
  v_batch_id uuid;
begin
  v_result := public.catalog_admin_preview_import(
    jsonb_build_object(
      'supplier','02B Test Supplier',
      'source_filename','catalog-02b-test.xlsx',
      'source_sha256',repeat('a',64),
      'source_file_size_bytes',1024,
      'parser_adapter','catalog-02b-test',
      'parser_version','1.0.0',
      'effective_date',current_date,
      'import_mode','PRICE_UPDATE_ONLY',
      'source_format','EXCEL',
      'source_metadata',jsonb_build_object('test',true)
    ),
    jsonb_build_array(jsonb_build_object(
      'source_page',1,
      'source_row_number',1,
      'source_values',jsonb_build_object('test',true),
      'classification','CHANGED',
      'disposition','READY',
      'selected_action','UPDATE',
      'matched_product_id',(select product_id from catalog_02b_test_state),
      'current_product_version',(select old_version from catalog_02b_test_state),
      'match_rule','PRODUCT_ID',
      'proposed_snapshot',jsonb_build_object(
        'price_per_m2',(select old_price + 1000 from catalog_02b_test_state),
        'price_effective_date',current_date
      )
    ))
  );
  if v_result->>'status' <> 'READY' or (v_result->>'blocking')::integer <> 0 then
    raise exception '02B_TEST_FAIL: preview readiness';
  end if;
  v_batch_id := (v_result->>'batch_id')::uuid;
  update catalog_02b_test_state set batch_id = v_batch_id;

  v_result := public.catalog_admin_apply_import(v_batch_id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  if v_result->>'status' <> 'APPLIED' or (v_result->>'idempotent_replay')::boolean then
    raise exception '02B_TEST_FAIL: apply';
  end if;
  v_result := public.catalog_admin_apply_import(v_batch_id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  if not (v_result->>'idempotent_replay')::boolean then raise exception '02B_TEST_FAIL: apply replay'; end if;
end;
$$;
reset role;

do $$
begin
  if not exists (
    select 1 from public.products p, catalog_02b_test_state s
    where p.id=s.product_id and p.price_per_m2=s.old_price+1000 and p.version=s.old_version+1
  ) then raise exception '02B_TEST_FAIL: applied product state'; end if;
  if not exists (
    select 1 from public.product_price_history h, catalog_02b_test_state s
    where h.import_batch_id=s.batch_id and h.product_id=s.product_id
      and h.previous_price_per_m2=s.old_price and h.change_kind='PRICE_UPDATE' and h.source_format='EXCEL'
  ) then raise exception '02B_TEST_FAIL: apply history'; end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$
declare v_result jsonb;
begin
  v_result := public.catalog_admin_rollback_import(
    (select batch_id from catalog_02b_test_state),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  );
  if v_result->>'status' <> 'ROLLED_BACK' or (v_result->>'idempotent_replay')::boolean then
    raise exception '02B_TEST_FAIL: rollback';
  end if;
  v_result := public.catalog_admin_rollback_import(
    (select batch_id from catalog_02b_test_state),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  );
  if not (v_result->>'idempotent_replay')::boolean then raise exception '02B_TEST_FAIL: rollback replay'; end if;

  if jsonb_array_length(public.catalog_admin_list_website_leads('NEW',10)) <> 5 then
    raise exception '02B_TEST_FAIL: admin lead list';
  end if;
  v_result := public.catalog_admin_update_website_lead(
    (select lead_id from catalog_02b_test_state), 'CONTACTED', 'sale-1'
  );
  if v_result->>'status' <> 'CONTACTED' then raise exception '02B_TEST_FAIL: admin lead update'; end if;
end;
$$;
reset role;

do $$
begin
  if not exists (
    select 1 from public.products p, catalog_02b_test_state s
    where p.id=s.product_id and p.price_per_m2=s.old_price and p.version=s.old_version+2
  ) then raise exception '02B_TEST_FAIL: rollback product state'; end if;
  if not exists (
    select 1 from public.product_import_batches b, catalog_02b_test_state s
    where b.id=s.batch_id and b.status='CANCELLED' and b.rolled_back_at is not null
  ) then raise exception '02B_TEST_FAIL: rollback batch state'; end if;
  if not exists (
    select 1 from public.product_price_history h
    join public.product_import_batches rb on rb.id=h.import_batch_id
    join catalog_02b_test_state s on s.batch_id=rb.rollback_of_batch_id and s.product_id=h.product_id
    where rb.import_mode='ROLLBACK' and h.change_kind='ROLLBACK' and h.rollback_of_history_id is not null
  ) then raise exception '02B_TEST_FAIL: rollback history'; end if;
  if not exists (
    select 1 from public.audit_logs a, catalog_02b_test_state s
    where a.action='catalogImportApply02B' and a.entity_id=s.batch_id::text
  ) or not exists (
    select 1 from public.audit_logs a, catalog_02b_test_state s
    where a.action='catalogImportRollback02B' and a.entity_id=s.batch_id::text
  ) then raise exception '02B_TEST_FAIL: import audit'; end if;
end;
$$;

rollback;
\echo CATALOG_02B_LOCAL_INTEGRATION_PASS
