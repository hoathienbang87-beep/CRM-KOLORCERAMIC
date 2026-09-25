-- Prompt 06A rollback rehearsal. DDL is transaction-scoped and self-reverting.
begin;

do $$
begin
  if to_regprocedure('public.catalog_admin_list_products_v1(text,text,boolean,boolean,integer,integer)') is null
     or to_regprocedure('public.catalog_admin_update_product_v1(uuid,bigint,jsonb)') is null
     or to_regprocedure('public.catalog_admin_set_product_state_v1(uuid,bigint,boolean,boolean)') is null then
    raise exception 'CATALOG_06A_ROLLBACK_GUARD_FAIL: required 06A functions missing.';
  end if;
end;
$$;

revoke all on function public.catalog_admin_list_products_v1(text,text,boolean,boolean,integer,integer) from public,anon,authenticated;
revoke all on function public.catalog_admin_update_product_v1(uuid,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.catalog_admin_set_product_state_v1(uuid,bigint,boolean,boolean) from public,anon,authenticated;
revoke all on function public.catalog_admin_product_json_v1_06a(uuid) from public,anon,authenticated;
drop function public.catalog_admin_set_product_state_v1(uuid,bigint,boolean,boolean);
drop function public.catalog_admin_update_product_v1(uuid,bigint,jsonb);
drop function public.catalog_admin_list_products_v1(text,text,boolean,boolean,integer,integer);
drop function public.catalog_admin_product_json_v1_06a(uuid);

do $$
begin
  if to_regprocedure('public.catalog_admin_list_products_v1(text,text,boolean,boolean,integer,integer)') is not null
     or to_regprocedure('public.catalog_admin_update_product_v1(uuid,bigint,jsonb)') is not null
     or to_regprocedure('public.catalog_public_list_products_v1(text,text,text,text,integer,integer,numeric,numeric,integer,integer)') is null
     or to_regprocedure('public.catalog_submit_website_lead_v1(jsonb)') is null then
    raise exception 'CATALOG_06A_ROLLBACK_TEST_FAIL: rollback shape or 05A/05B compatibility.';
  end if;
end;
$$;

rollback;

begin;
do $$
begin
  if to_regprocedure('public.catalog_admin_list_products_v1(text,text,boolean,boolean,integer,integer)') is null
     or to_regprocedure('public.catalog_admin_update_product_v1(uuid,bigint,jsonb)') is null
     or not has_function_privilege('authenticated','public.catalog_admin_set_product_state_v1(uuid,bigint,boolean,boolean)','EXECUTE')
     or has_function_privilege('anon','public.catalog_admin_list_products_v1(text,text,boolean,boolean,integer,integer)','EXECUTE') then
    raise exception 'CATALOG_06A_ROLLBACK_TEST_FAIL: rehearsal was not fully reverted.';
  end if;
end;
$$;
notify pgrst, 'reload schema';
commit;
