-- Rollback companion for CATALOG INTEGRATION 03B.
-- Run only after all 03B test fixtures have been rolled back/removed.
begin;

select pg_advisory_xact_lock(hashtext('CATALOG-INTEGRATION-03B-APPROVAL-AUDIT'));

do $$
begin
  if to_regprocedure('public.catalog_admin_approve_import(uuid,uuid)') is null
     or to_regprocedure('public.catalog_admin_apply_import_02b_impl(uuid,uuid)') is null
     or to_regprocedure('public.catalog_admin_rollback_import_02b_impl(uuid,uuid)') is null then
    raise exception 'CATALOG_03B_ROLLBACK_PRECONDITION_FAIL: 03B functions missing.';
  end if;
  if exists (
    select 1 from public.product_import_batches
    where approved_at is not null or approved_by_user_id is not null or approval_idempotency_key is not null
  ) then
    raise exception 'CATALOG_03B_ROLLBACK_GUARD: approval data exists.';
  end if;
end;
$$;

drop function public.catalog_admin_apply_import(uuid,uuid);
drop function public.catalog_admin_rollback_import(uuid,uuid);
drop function public.catalog_admin_approve_import(uuid,uuid);

alter function public.catalog_admin_apply_import_02b_impl(uuid,uuid)
  rename to catalog_admin_apply_import;
alter function public.catalog_admin_rollback_import_02b_impl(uuid,uuid)
  rename to catalog_admin_rollback_import;

revoke all on function public.catalog_admin_apply_import(uuid,uuid) from public, anon, authenticated;
revoke all on function public.catalog_admin_rollback_import(uuid,uuid) from public, anon, authenticated;
grant execute on function public.catalog_admin_apply_import(uuid,uuid) to authenticated;
grant execute on function public.catalog_admin_rollback_import(uuid,uuid) to authenticated;

alter table public.product_import_batches
  drop constraint product_import_batches_approval_shape_check,
  drop constraint product_import_batches_approval_key_unique,
  drop column approval_idempotency_key,
  drop column approved_at,
  drop column approved_by_user_id;

do $$
begin
  if to_regprocedure('public.catalog_admin_approve_import(uuid,uuid)') is not null
     or to_regprocedure('public.catalog_admin_apply_import_02b_impl(uuid,uuid)') is not null
     or to_regprocedure('public.catalog_admin_rollback_import_02b_impl(uuid,uuid)') is not null
     or to_regprocedure('public.catalog_admin_apply_import(uuid,uuid)') is null
     or to_regprocedure('public.catalog_admin_rollback_import(uuid,uuid)') is null
     or exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='product_import_batches'
         and column_name in ('approved_by_user_id','approved_at','approval_idempotency_key')
     ) then
    raise exception 'CATALOG_03B_ROLLBACK_VERIFY_FAIL: 02B contract was not restored.';
  end if;
end;
$$;

commit;
