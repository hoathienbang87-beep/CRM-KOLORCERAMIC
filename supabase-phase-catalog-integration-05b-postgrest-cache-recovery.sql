-- CATALOG INTEGRATION 05B — PostgREST schema-cache recovery.
-- Follows the Supabase recovery guidance for a stale PostgREST notification queue.
begin;

do $$
begin
  if to_regprocedure('public.catalog_submit_website_lead_v1(jsonb)') is null
     or to_regprocedure('public.catalog_manager_list_website_leads_v1(text,integer,integer)') is null
     or to_regprocedure('public.catalog_manager_convert_website_lead_v1(uuid,text,text,text,uuid)') is null then
    raise exception 'CATALOG_05B_CACHE_RECOVERY_FAIL: required 05B functions are missing.';
  end if;
end;
$$;

select pg_notification_queue_usage();
notify pgrst, 'reload schema';

commit;
