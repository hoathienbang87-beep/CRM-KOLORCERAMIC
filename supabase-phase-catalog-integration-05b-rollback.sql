-- CATALOG INTEGRATION 05B — rollback companion.
-- Refuses to discard qualified/converted workflow state.
begin;

select pg_advisory_xact_lock(hashtext('CATALOG-INTEGRATION-05B-WEBSITE-LEADS'));

do $$
begin
  if exists (
    select 1 from public.website_leads
    where status in ('QUALIFIED', 'CONVERTED')
       or customer_id is not null
       or conversion_idempotency_key is not null
  ) then
    raise exception 'CATALOG_05B_ROLLBACK_BLOCKED: qualified or converted lead state exists.';
  end if;
end;
$$;

revoke all on function public.catalog_submit_website_lead_v1(jsonb) from public, anon, authenticated;
revoke all on function public.catalog_manager_list_website_leads_v1(text,integer,integer) from public, anon, authenticated;
revoke all on function public.catalog_manager_update_website_lead_v1(uuid,text,text) from public, anon, authenticated;
revoke all on function public.catalog_manager_find_lead_customer_matches_v1(uuid) from public, anon, authenticated;
revoke all on function public.catalog_manager_convert_website_lead_v1(uuid,text,text,text,uuid) from public, anon, authenticated;

drop function public.catalog_manager_convert_website_lead_v1(uuid,text,text,text,uuid);
drop function public.catalog_manager_find_lead_customer_matches_v1(uuid);
drop function public.catalog_manager_update_website_lead_v1(uuid,text,text);
drop function public.catalog_manager_list_website_leads_v1(text,integer,integer);
drop function public.catalog_submit_website_lead_v1(jsonb);
drop function public.catalog_website_lead_spam_hook_05b(jsonb);
drop function public.catalog_require_lead_manager_05b();

drop index public.website_leads_customer_idx;
drop index public.website_leads_phone_normalized_idx;

alter table public.website_leads
  drop constraint website_leads_status_check,
  drop constraint website_leads_phone_normalized_check,
  drop constraint website_leads_spam_score_check,
  drop constraint website_leads_spam_reason_check,
  drop constraint website_leads_conversion_mode_check,
  drop constraint website_leads_conversion_shape_check,
  drop constraint website_leads_request_id_key,
  drop constraint website_leads_conversion_idempotency_key,
  drop column converted_by_user_id,
  drop column converted_at,
  drop column conversion_idempotency_key,
  drop column conversion_mode,
  drop column customer_id,
  drop column spam_reason,
  drop column spam_score,
  drop column request_id,
  drop column phone_normalized,
  add constraint website_leads_status_check check (
    status in ('NEW', 'CONTACTED', 'CLOSED', 'SPAM')
  );

drop function public.catalog_normalize_phone_05b(text);

grant execute on function public.catalog_submit_website_lead(jsonb) to anon, authenticated;
grant execute on function public.catalog_admin_list_website_leads(text,integer) to authenticated;
grant execute on function public.catalog_admin_update_website_lead(uuid,text,text) to authenticated;

do $$
begin
  if to_regprocedure('public.catalog_submit_website_lead_v1(jsonb)') is not null
     or to_regprocedure('public.catalog_manager_convert_website_lead_v1(uuid,text,text,text,uuid)') is not null
     or exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'website_leads' and column_name = 'conversion_idempotency_key'
     ) then
    raise exception 'CATALOG_05B_ROLLBACK_FAIL: 05B objects remain.';
  end if;
  if not has_function_privilege('anon', 'public.catalog_submit_website_lead(jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.catalog_admin_list_website_leads(text,integer)', 'EXECUTE') then
    raise exception 'CATALOG_05B_ROLLBACK_FAIL: 02B grants not restored.';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
