-- CATALOG INTEGRATION 06B — align legacy row classification constraint with the approved 02B RPC contract.
begin;
select pg_advisory_xact_lock(hashtext('CATALOG-INTEGRATION-06B-CLASSIFICATION-COMPAT'));

do $$
declare v_definition text;
begin
  select pg_get_constraintdef(c.oid) into v_definition
  from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
  where n.nspname='public' and t.relname='product_import_rows' and c.conname='product_import_rows_classification_check';
  if v_definition is null then raise exception 'CATALOG_06B_CLASSIFICATION_PRECONDITION_FAIL: constraint missing.'; end if;
  if position('''CHANGED''' in v_definition)>0 or position('''CONFLICT''' in v_definition)>0 then
    raise exception 'CATALOG_06B_CLASSIFICATION_PRECONDITION_FAIL: compatibility already or partially applied.';
  end if;
end;
$$;

alter table public.product_import_rows drop constraint product_import_rows_classification_check;
alter table public.product_import_rows add constraint product_import_rows_classification_check check (
  classification in (
    'NEW','PRICE_CHANGED','INFO_CHANGED','CHANGED','UNCHANGED',
    'REVIEW','CONFLICT','DUPLICATE_IN_FILE','INVALID'
  )
);

do $$
declare v_definition text;
begin
  select pg_get_constraintdef(c.oid) into v_definition
  from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
  where n.nspname='public' and t.relname='product_import_rows' and c.conname='product_import_rows_classification_check';
  if position('''CHANGED''' in coalesce(v_definition,''))=0 or position('''CONFLICT''' in coalesce(v_definition,''))=0 then
    raise exception 'CATALOG_06B_CLASSIFICATION_VERIFY_FAIL';
  end if;
end;
$$;
commit;
