\set ON_ERROR_STOP on
do $$
begin
  if to_regprocedure('public.catalog_public_list_products(text,integer,integer)') is not null
     or to_regprocedure('public.catalog_admin_apply_import(uuid,uuid)') is not null
     or to_regprocedure('public.catalog_submit_website_lead(jsonb)') is not null then
    raise exception 'CATALOG_02B_ROLLBACK_TEST_FAIL: function residue';
  end if;
  if not has_function_privilege('authenticated','public.crm_create_product(jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.crm_update_product(uuid,bigint,jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.crm_set_product_active(uuid,bigint,boolean)','EXECUTE')
     or not has_function_privilege('anon','public.crm_write_audit(text,text,text,jsonb)','EXECUTE') then
    raise exception 'CATALOG_02B_ROLLBACK_TEST_FAIL: baseline grants not restored';
  end if;
  if (select count(*) from public.products) <> 75
     or (select count(*) from public.product_import_batches) <> 0
     or (select count(*) from public.website_leads) <> 0 then
    raise exception 'CATALOG_02B_ROLLBACK_TEST_FAIL: baseline data changed';
  end if;
end;
$$;
select 'CATALOG_02B_LOCAL_ROLLBACK_PASS' as result;
