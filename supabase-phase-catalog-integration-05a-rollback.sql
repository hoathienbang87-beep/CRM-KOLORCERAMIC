-- CATALOG INTEGRATION 05A — rollback companion.
-- Removes only the v1 public API objects added by 05A.
begin;

select pg_advisory_xact_lock(hashtext('CATALOG-INTEGRATION-05A-PUBLIC-API-V1'));

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
    raise exception 'CATALOG_05A_ROLLBACK_FAIL: 05A functions remain.';
  end if;

  if to_regprocedure('public.catalog_public_list_products(text,integer,integer)') is null
     or to_regprocedure('public.catalog_public_get_product(uuid)') is null then
    raise exception 'CATALOG_05A_ROLLBACK_FAIL: 02B compatibility RPCs were removed.';
  end if;
end;
$$;

commit;
