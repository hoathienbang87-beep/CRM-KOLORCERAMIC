-- CATALOG INTEGRATION 05B — PostgREST schema-cache synchronization.
-- Required after the transaction-scoped rollback rehearsal performs DDL.
begin;

do $$
begin
  if to_regprocedure('public.catalog_submit_website_lead_v1(jsonb)') is null
     or to_regprocedure('public.catalog_manager_list_website_leads_v1(text,integer,integer)') is null
     or to_regprocedure('public.catalog_manager_convert_website_lead_v1(uuid,text,text,text,uuid)') is null then
    raise exception 'CATALOG_05B_CACHE_SYNC_FAIL: required 05B functions are missing.';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
