-- Prompt 06A cloud-staging runtime verification.
-- All fixtures and mutations are transaction-scoped and rolled back.
begin;

do $$
begin
  if (select count(*) from public.products) <> 123
     or (select count(*) from public.products where active) <> 75
     or (select count(*) from public.products where is_published) <> 0
     or not exists (
       select 1 from public.app_users
       where id='catalog-04-staging-admin' and role='admin' and active
         and supabase_auth_id='40404040-4040-4040-8040-404040404040'
     ) then
    raise exception 'CATALOG_06A_STAGING_GUARD_FAIL: expected post-05B staging baseline 123/75/0 and synthetic admin.';
  end if;
end;
$$;

insert into public.app_users(id,supabase_auth_id,email,name,role,active,lifecycle_status,created_at,updated_at)
values ('catalog-06a-sale','060a0000-0000-4000-8000-000000000002','catalog-06a-sale@staging.invalid','Catalog 06A Sale','sale',true,'active',now(),now());

insert into public.products(
  id,code,name,width_mm,height_mm,surface,category,collection,image_url,gallery_urls,
  price_per_m2,price_effective_date,active,is_published,created_by_user_id,updated_by_user_id
) values
  ('060a0000-0000-4000-8000-000000000001','ADMIN06A-READY','ADMIN 06A TRAVERTINO GREY',600,1200,'MATT','Gạch vân đá','Admin Fixture','https://example.invalid/admin-06a.jpg','[]',1500000,'2026-09-25',true,false,'catalog-04-staging-admin','catalog-04-staging-admin'),
  ('060a0000-0000-4000-8000-000000000002','ADMIN06A-UPDATING','ADMIN 06A UPDATING',null,null,null,'Draft','Admin Fixture',null,'[]',null,null,true,false,'catalog-04-staging-admin','catalog-04-staging-admin');

set local role authenticated;
select set_config('request.jwt.claim.sub','40404040-4040-4040-8040-404040404040',true);

do $$
declare
  v_result jsonb;
  v_saved jsonb;
  v_failed boolean;
begin
  v_result := public.catalog_admin_list_products_v1('admin 06a',null,null,null,1,0);
  if (v_result #>> '{pagination,total}')::integer <> 2
     or jsonb_array_length(v_result->'items') <> 1
     or (v_result #>> '{pagination,has_more}')::boolean is not true
     or (v_result #>> '{pagination,next_offset}')::integer <> 1 then
    raise exception 'CATALOG_06A_TEST_FAIL: admin list/pagination.';
  end if;
  if (public.catalog_admin_list_products_v1('admin 06a','READY',true,false,100,0) #>> '{pagination,total}')::integer <> 1
     or (public.catalog_admin_list_products_v1('admin 06a','UPDATING',true,false,100,0) #>> '{pagination,total}')::integer <> 1 then
    raise exception 'CATALOG_06A_TEST_FAIL: filters.';
  end if;

  v_saved := public.catalog_admin_update_product_v1(
    '060a0000-0000-4000-8000-000000000001',1,
    jsonb_build_object(
      'name','ADMIN 06A TRAVERTINO DARK GREY','width_mm',600,'height_mm',1200,
      'price_per_m2',1915000,'price_effective_date','2026-09-25',
      'surface','POLISH','image_url','https://example.invalid/admin-06a-updated.jpg',
      'gallery_urls',jsonb_build_array('https://example.invalid/gallery-1.jpg')
    )
  );
  if v_saved->>'name' <> 'ADMIN 06A TRAVERTINO DARK GREY'
     or (v_saved->>'price_per_m2')::numeric <> 1915000
     or (v_saved->>'version')::integer <> 2
     or v_saved->>'data_status' <> 'READY'
     or (v_saved->>'is_published')::boolean then
    raise exception 'CATALOG_06A_TEST_FAIL: content update/read-back.';
  end if;
  if (select count(*) from public.product_price_history where product_id='060a0000-0000-4000-8000-000000000001') <> 1
     or not exists (
       select 1 from public.product_price_history
       where product_id='060a0000-0000-4000-8000-000000000001'
         and price_per_m2=1915000 and previous_price_per_m2=1500000
         and source_format='MANUAL' and product_version_before=1 and product_version_after=2
     ) then
    raise exception 'CATALOG_06A_TEST_FAIL: price history.';
  end if;

  v_failed := false;
  begin
    perform public.catalog_admin_update_product_v1('060a0000-0000-4000-8000-000000000001',1,'{"surface":"MATT"}'::jsonb);
  exception when sqlstate '40001' then v_failed := true;
  end;
  if not v_failed then raise exception 'CATALOG_06A_TEST_FAIL: version conflict.'; end if;

  v_failed := false;
  begin
    perform public.catalog_admin_update_product_v1('060a0000-0000-4000-8000-000000000001',2,'{"image_url":"http://unsafe.invalid/a.jpg"}'::jsonb);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'CATALOG_06A_TEST_FAIL: HTTPS image constraint.'; end if;

  v_saved := public.catalog_admin_set_product_state_v1('060a0000-0000-4000-8000-000000000001',2,true,true);
  if not (v_saved->>'active')::boolean or not (v_saved->>'is_published')::boolean or (v_saved->>'version')::integer <> 3 then
    raise exception 'CATALOG_06A_TEST_FAIL: publish state.';
  end if;
  v_saved := public.catalog_admin_set_product_state_v1('060a0000-0000-4000-8000-000000000001',3,false,false);
  if (v_saved->>'active')::boolean or (v_saved->>'is_published')::boolean or (v_saved->>'version')::integer <> 4 then
    raise exception 'CATALOG_06A_TEST_FAIL: archive state.';
  end if;

  v_failed := false;
  begin
    perform public.catalog_admin_set_product_state_v1('060a0000-0000-4000-8000-000000000002',1,true,true);
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then raise exception 'CATALOG_06A_TEST_FAIL: publish readiness gate.'; end if;

  if (select count(*) from public.audit_logs where action='catalogAdminUpdate06A' and entity_id='060a0000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from public.audit_logs where action='catalogAdminState06A' and entity_id='060a0000-0000-4000-8000-000000000001') <> 2
     or not exists (
       select 1 from public.audit_logs
       where action='catalogAdminUpdate06A' and entity_id='060a0000-0000-4000-8000-000000000001'
         and raw_data #>> '{before,name}'='ADMIN 06A TRAVERTINO GREY'
         and raw_data #>> '{after,name}'='ADMIN 06A TRAVERTINO DARK GREY'
     ) then
    raise exception 'CATALOG_06A_TEST_FAIL: audit before/after.';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','060a0000-0000-4000-8000-000000000002',true);
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.catalog_admin_list_products_v1(null,null,null,null,10,0);
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'CATALOG_06A_TEST_FAIL: sale role guard.'; end if;
end;
$$;

reset role;
set local role anon;
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.catalog_admin_list_products_v1(null,null,null,null,10,0);
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'CATALOG_06A_TEST_FAIL: anon execute denial.'; end if;
end;
$$;

rollback;

begin;
do $$
begin
  if (select count(*) from public.products) <> 123
     or (select count(*) from public.products where active) <> 75
     or (select count(*) from public.products where is_published) <> 0
     or exists (select 1 from public.products where code like 'ADMIN06A-%')
     or exists (select 1 from public.app_users where id='catalog-06a-sale')
     or exists (select 1 from public.audit_logs where action in ('catalogAdminUpdate06A','catalogAdminState06A')) then
    raise exception 'CATALOG_06A_TEST_FAIL: fixture rollback residue.';
  end if;
end;
$$;
commit;
