-- Roll back only Prompt 02B RLS/RPC objects. Product/data rows are untouched.
begin;

select pg_advisory_xact_lock(hashtext('CATALOG-INTEGRATION-02B-RLS-RPC'));

drop function if exists public.catalog_admin_update_website_lead(uuid,text,text);
drop function if exists public.catalog_admin_list_website_leads(text,integer);
drop function if exists public.catalog_submit_website_lead(jsonb);
drop function if exists public.catalog_admin_rollback_import(uuid,uuid);
drop function if exists public.catalog_admin_apply_import(uuid,uuid);
drop function if exists public.catalog_admin_preview_import(jsonb,jsonb);
drop function if exists public.catalog_crm_search_products(text,integer);
drop function if exists public.catalog_public_get_product(uuid);
drop function if exists public.catalog_public_list_products(text,integer,integer);
drop function if exists public.catalog_public_product_json_02b(uuid);
drop function if exists public.catalog_product_snapshot_02b(uuid);
drop function if exists public.catalog_require_admin_02b();

-- Restore the Product R2 pre-02B function grants. Table grants remain at their
-- safer pre-existing values and no data or policy is changed here.
grant execute on function public.crm_create_product(jsonb) to authenticated;
grant execute on function public.crm_update_product(uuid,bigint,jsonb) to authenticated;
grant execute on function public.crm_set_product_active(uuid,bigint,boolean) to authenticated;
grant execute on function public.crm_write_audit(text,text,text,jsonb) to public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.catalog_public_list_products(text,integer,integer)') is not null then
    raise exception 'CATALOG_02B_ROLLBACK_VERIFY_FAIL: RPC residue.';
  end if;
  if not has_function_privilege('authenticated','public.crm_create_product(jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.crm_update_product(uuid,bigint,jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.crm_set_product_active(uuid,bigint,boolean)','EXECUTE') then
    raise exception 'CATALOG_02B_ROLLBACK_VERIFY_FAIL: legacy grants not restored.';
  end if;
end;
$$;

commit;
