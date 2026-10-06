-- Prompt 02A local-only compatibility baseline.
-- Run only inside container supabase_db_local-product-r2 after external identity guard.
\set ON_ERROR_STOP on

begin;

do $$
begin
  if current_database() <> 'postgres' then
    raise exception 'CATALOG_02A_LOCAL_GUARD_FAIL: unexpected database %', current_database();
  end if;
  if to_regclass('public.products') is not null then
    raise exception 'CATALOG_02A_LOCAL_GUARD_FAIL: public.products already exists.';
  end if;
end;
$$;

create table public.app_users (
  id text primary key,
  email text unique,
  name text,
  role text,
  active boolean,
  lifecycle_status text,
  supabase_auth_id uuid unique
);

insert into public.app_users(id,email,name,role,active,lifecycle_status,supabase_auth_id) values
  ('sale-1','sale@test.local','Sale Test','sale',true,'active','11111111-1111-4111-8111-111111111111'),
  ('manager-1','manager@test.local','Manager Test','manager',true,'active','22222222-2222-4222-8222-222222222222');

create function public.crm_current_app_user_id()
returns text language sql stable security definer set search_path=public as $$
  select id from public.app_users
  where supabase_auth_id=auth.uid() and active and lifecycle_status='active'
  limit 1
$$;

create function public.crm_current_user_role()
returns text language sql stable security definer set search_path=public as $$
  select lower(role) from public.app_users where id=public.crm_current_app_user_id() limit 1
$$;

create function public.crm_is_active_user()
returns boolean language sql stable security definer set search_path=public as $$
  select public.crm_current_app_user_id() is not null
$$;

create function public.crm_current_email()
returns text language sql stable security definer set search_path=public as $$
  select email from public.app_users where id=public.crm_current_app_user_id() limit 1
$$;

create table public.audit_logs (
  id text primary key,
  action text,
  entity text,
  entity_id text,
  email text,
  payload_json text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create function public.crm_write_audit(
  p_action text,
  p_entity text,
  p_entity_id text,
  p_payload jsonb default '{}'::jsonb
)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.audit_logs(id,action,entity,entity_id,email,payload_json,raw_data,created_at)
  values(gen_random_uuid()::text,p_action,p_entity,p_entity_id,public.crm_current_email(),p_payload::text,p_payload,now());
end;
$$;

create table public.products (
  id text primary key,
  name text,
  sku text,
  price numeric,
  unit text,
  active boolean default true,
  created_at timestamptz,
  updated_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb,
  is_deleted boolean default false,
  stock_quantity numeric,
  updated_by_user_id text references public.app_users(id) on delete set null
);

insert into public.products(id,name,sku,price,unit,raw_data)
select 'legacy-'||g,'Legacy '||g,'SKU-'||g,100000,'m2',jsonb_build_object('size','60x60')
from generate_series(1,404) g;

create table public.quote_items (
  id text primary key,
  quote_id text,
  product_id text references public.products(id) on delete set null,
  product_sku text,
  product_name text,
  unit text,
  unit_price numeric,
  qty numeric,
  line_total numeric,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

insert into public.quote_items(
  id,quote_id,product_id,product_sku,product_name,unit,unit_price,qty,line_total,raw_data,created_at,updated_at
) values (
  'quote-item-1','quote-1','legacy-1','SKU-1','Legacy Product 1','m²',100000,2,200000,
  '{"snapshot":true}'::jsonb,now(),now()
);

create index quote_items_product_id_idx on public.quote_items(product_id);

create table public.order_items (
  id text primary key,
  product_id text references public.products(id) on delete set null
);
create index order_items_product_id_idx on public.order_items(product_id);

create table public.inventory_movements (
  id text primary key,
  product_id text references public.products(id) on delete set null,
  product_sku text,
  product_name text,
  warehouse text,
  qty numeric,
  is_deleted boolean,
  updated_at timestamptz
);
create index inventory_movements_product_id_idx on public.inventory_movements(product_id);

create view public.product_inventory_balance as
select
  coalesce(product_id,'') product_id,
  coalesce(product_sku,'') product_sku,
  coalesce(product_name,'') product_name,
  coalesce(warehouse,'main') warehouse,
  sum(coalesce(qty,0)) qty_balance,
  max(updated_at) last_movement_at
from public.inventory_movements
where coalesce(is_deleted,false)=false
group by coalesce(product_id,''),coalesce(product_sku,''),coalesce(product_name,''),coalesce(warehouse,'main');

create function public.crm_guard_product_soft_delete()
returns trigger language plpgsql as $$begin return new;end$$;
create trigger products_guard_soft_delete
before update on public.products
for each row execute function public.crm_guard_product_soft_delete();

create function public.crm_create_product(p_product jsonb)
returns jsonb language sql as $$select '{}'::jsonb$$;
create function public.crm_update_product(p_product_id text,p_changes jsonb)
returns jsonb language sql as $$select '{}'::jsonb$$;
create function public.crm_list_products()
returns jsonb language sql as $$select '[]'::jsonb$$;

create policy "products active employee read"
on public.products for select to authenticated using (true);

insert into public.audit_logs(id,action,entity,entity_id,email,payload_json,raw_data,created_at)
select gen_random_uuid()::text,'legacyProductAudit','products','legacy-'||g,
  'legacy@test.local','{}','{}'::jsonb,now()
from generate_series(1,5) g;

commit;
