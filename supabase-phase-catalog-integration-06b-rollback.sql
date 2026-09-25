-- Roll back only Prompt 06B additive admin import read/review APIs.
begin;
select pg_advisory_xact_lock(hashtext('CATALOG-INTEGRATION-06B-ADMIN-IMPORT'));
do $$ begin
  if exists(select 1 from public.product_import_rows where classification in ('CHANGED','CONFLICT')) then
    raise exception 'CATALOG_06B_ROLLBACK_BLOCKED: rows use 06B-compatible classifications.';
  end if;
end $$;
drop function public.catalog_admin_review_import_rows_v1(uuid,jsonb);
drop function public.catalog_admin_get_import_batch_v1(uuid);
drop function public.catalog_admin_list_import_batches_v1(text,integer,integer);
drop function public.catalog_admin_import_batch_json_v1_06b(uuid,boolean);
alter table public.product_import_rows drop constraint product_import_rows_classification_check;
alter table public.product_import_rows add constraint product_import_rows_classification_check check (
  classification in ('NEW','PRICE_CHANGED','INFO_CHANGED','UNCHANGED','REVIEW','DUPLICATE_IN_FILE','INVALID')
);
notify pgrst, 'reload schema';
commit;
