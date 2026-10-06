-- Transactional rehearsal of the 06B rollback companion; leaves staging unchanged.
begin;
select pg_advisory_xact_lock(hashtext('CATALOG-06B-STAGING-ROLLBACK-TEST'));
drop function public.catalog_admin_review_import_rows_v1(uuid,jsonb);
drop function public.catalog_admin_get_import_batch_v1(uuid);
drop function public.catalog_admin_list_import_batches_v1(text,integer,integer);
drop function public.catalog_admin_import_batch_json_v1_06b(uuid,boolean);

do $$
begin
  if to_regprocedure('public.catalog_admin_review_import_rows_v1(uuid,jsonb)') is not null
     or to_regprocedure('public.catalog_admin_get_import_batch_v1(uuid)') is not null
     or to_regprocedure('public.catalog_admin_list_import_batches_v1(text,integer,integer)') is not null
     or to_regprocedure('public.catalog_admin_approve_import(uuid,uuid)') is null
     or to_regprocedure('public.catalog_admin_list_products_v1(text,text,boolean,boolean,integer,integer)') is null then
    raise exception 'CATALOG_06B_ROLLBACK_REHEARSAL_FAIL';
  end if;
end;
$$;
rollback;

do $$
begin
  if to_regprocedure('public.catalog_admin_review_import_rows_v1(uuid,jsonb)') is null
     or to_regprocedure('public.catalog_admin_get_import_batch_v1(uuid)') is null
     or to_regprocedure('public.catalog_admin_list_import_batches_v1(text,integer,integer)') is null then
    raise exception 'CATALOG_06B_ROLLBACK_REHEARSAL_WAS_NOT_FULLY_REVERTED';
  end if;
end;
$$;
select 'CATALOG_06B_STAGING_ROLLBACK_PASS' as result;
