-- Prompt 05A rollback rehearsal on cloud staging.
-- The drops are enclosed in a transaction that is always rolled back.
begin;

do $$
begin
  if (select count(*) from public.products) <> 123
     or (select count(*) from public.products where active) <> 75
     or (select count(*) from public.products where is_published) <> 0 then
    raise exception 'CATALOG_05A_ROLLBACK_STAGING_GUARD_FAIL: expected post-04 staging baseline 123/75/0.';
  end if;
end;
$$;

revoke all on function public.catalog_public_get_product_v1(text) from public, anon, authenticated;
revoke all on function public.catalog_public_list_products_v1(text,text,text,text,integer,integer,numeric,numeric,integer,integer) from public, anon, authenticated;

drop function public.catalog_public_get_product_v1(text);
drop function public.catalog_public_list_products_v1(text,text,text,text,integer,integer,numeric,numeric,integer,integer);
drop function public.catalog_public_resolve_product_id_v1_05a(text);
drop function public.catalog_public_product_json_v1_05a(uuid);

do $$
begin
  if to_regprocedure('public.catalog_public_get_product_v1(text)') is not null
     or to_regprocedure('public.catalog_public_list_products_v1(text,text,text,text,integer,integer,numeric,numeric,integer,integer)') is not null
     or to_regprocedure('public.catalog_public_resolve_product_id_v1_05a(text)') is not null
     or to_regprocedure('public.catalog_public_product_json_v1_05a(uuid)') is not null then
    raise exception 'CATALOG_05A_ROLLBACK_TEST_FAIL: 05A functions remain.';
  end if;

  if to_regprocedure('public.catalog_public_list_products(text,integer,integer)') is null
     or to_regprocedure('public.catalog_public_get_product(uuid)') is null then
    raise exception 'CATALOG_05A_ROLLBACK_TEST_FAIL: 02B compatibility RPCs were removed.';
  end if;
end;
$$;

rollback;

-- Read-back after rollback of the rehearsal transaction.
begin;
do $$
begin
  if to_regprocedure('public.catalog_public_get_product_v1(text)') is null
     or to_regprocedure('public.catalog_public_list_products_v1(text,text,text,text,integer,integer,numeric,numeric,integer,integer)') is null
     or to_regprocedure('public.catalog_public_resolve_product_id_v1_05a(text)') is null
     or to_regprocedure('public.catalog_public_product_json_v1_05a(uuid)') is null
     or not has_function_privilege('anon', 'public.catalog_public_get_product_v1(text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.catalog_public_list_products_v1(text,text,text,text,integer,integer,numeric,numeric,integer,integer)', 'EXECUTE') then
    raise exception 'CATALOG_05A_ROLLBACK_TEST_FAIL: rollback rehearsal was not fully reverted.';
  end if;
end;
$$;
commit;
