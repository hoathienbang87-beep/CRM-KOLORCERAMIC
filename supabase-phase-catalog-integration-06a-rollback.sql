-- CATALOG INTEGRATION 06A — rollback companion.
begin;

revoke all on function public.catalog_admin_list_products_v1(text,text,boolean,boolean,integer,integer) from public, anon, authenticated;
revoke all on function public.catalog_admin_update_product_v1(uuid,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.catalog_admin_set_product_state_v1(uuid,bigint,boolean,boolean) from public, anon, authenticated;
revoke all on function public.catalog_admin_product_json_v1_06a(uuid) from public, anon, authenticated;

drop function public.catalog_admin_set_product_state_v1(uuid,bigint,boolean,boolean);
drop function public.catalog_admin_update_product_v1(uuid,bigint,jsonb);
drop function public.catalog_admin_list_products_v1(text,text,boolean,boolean,integer,integer);
drop function public.catalog_admin_product_json_v1_06a(uuid);

notify pgrst, 'reload schema';
commit;
