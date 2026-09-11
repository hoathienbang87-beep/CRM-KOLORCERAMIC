import fs from "node:fs";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";

const entry = process.env.PRODUCTS_R2_PGLITE_ENTRY || "C:/Users/ADMIN/AppData/Local/Temp/crm-products-r1-runtime/node_modules/@electric-sql/pglite/dist/index.js";
const {PGlite} = await import(pathToFileURL(entry).href);
const db = new PGlite();
const migration = fs.readFileSync(new URL("../supabase-phase-product-r2-clean-rebuild.sql", import.meta.url), "utf8");
const q = async (sql, params=[]) => (await db.query(sql, params)).rows;
const scalar = async (sql, params=[]) => (await q(sql, params))[0];
const expectDenied = async (fn, code="42501") => {
  let error;
  try { await fn(); } catch (caught) { error = caught; }
  assert.ok(error, "Expected operation to be denied");
  if (code) assert.equal(error.code, code, error.message);
};

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$select nullif(current_setting('app.uid',true),'')::uuid$$;
  grant usage on schema auth to authenticated;

  create table app_users(
    id text primary key,
    email text unique,
    name text,
    role text,
    active boolean,
    lifecycle_status text,
    supabase_auth_id uuid unique
  );
  insert into app_users values
    ('sale-1','sale@test.local','Sale Test','sale',true,'active','11111111-1111-4111-8111-111111111111'),
    ('manager-1','manager@test.local','Manager Test','manager',true,'active','22222222-2222-4222-8222-222222222222');

  create function crm_current_app_user_id() returns text language sql stable security definer set search_path=public as
    $$select id from app_users where supabase_auth_id=auth.uid() and active and lifecycle_status='active' limit 1$$;
  create function crm_current_user_role() returns text language sql stable security definer set search_path=public as
    $$select lower(role) from app_users where id=crm_current_app_user_id() limit 1$$;
  create function crm_is_active_user() returns boolean language sql stable security definer set search_path=public as
    $$select crm_current_app_user_id() is not null$$;
  create function crm_current_email() returns text language sql stable security definer set search_path=public as
    $$select email from app_users where id=crm_current_app_user_id() limit 1$$;

  create table audit_logs(
    id text primary key, action text, entity text, entity_id text, email text,
    payload_json text, raw_data jsonb not null default '{}', created_at timestamptz default now()
  );
  create function crm_write_audit(p_action text,p_entity text,p_entity_id text,p_payload jsonb default '{}')
  returns void language plpgsql security definer set search_path=public as $$
  begin
    insert into audit_logs values(gen_random_uuid()::text,p_action,p_entity,p_entity_id,crm_current_email(),p_payload::text,p_payload,now());
  end$$;
  create function test_product_update_audit_count() returns integer language sql stable security definer set search_path=public as
    $$select count(*)::integer from audit_logs where action='updateProductR2'$$;

  create table products(
    id text primary key,
    name text,
    sku text,
    price numeric,
    unit text,
    active boolean default true,
    created_at timestamptz,
    updated_at timestamptz,
    raw_data jsonb not null default '{}',
    is_deleted boolean default false,
    stock_quantity numeric,
    updated_by_user_id text references app_users(id) on delete set null
  );
`);

await db.exec(`
  insert into products(id,name,sku,price,unit,raw_data)
  select 'legacy-'||g,'Legacy '||g,'SKU-'||g,100000,'m2',jsonb_build_object('size','60x60')
  from generate_series(1,404) g;

  create table quote_items(
    id text primary key, quote_id text, product_id text references products(id) on delete set null,
    product_sku text, product_name text, unit text, unit_price numeric, qty numeric,
    line_total numeric, raw_data jsonb not null default '{}', created_at timestamptz, updated_at timestamptz
  );
  insert into quote_items values(
    'quote-item-1','quote-1','legacy-1','SKU-1','Legacy Product 1','m²',100000,2,200000,
    '{"snapshot":true}',now(),now()
  );
  create index quote_items_product_id_idx on quote_items(product_id);

  create table order_items(id text primary key,product_id text references products(id) on delete set null);
  create index order_items_product_id_idx on order_items(product_id);
  create table inventory_movements(
    id text primary key,product_id text references products(id) on delete set null,
    product_sku text,product_name text,warehouse text,qty numeric,is_deleted boolean,updated_at timestamptz
  );
  create index inventory_movements_product_id_idx on inventory_movements(product_id);
  create view product_inventory_balance as
    select coalesce(product_id,'') product_id,coalesce(product_sku,'') product_sku,
      coalesce(product_name,'') product_name,coalesce(warehouse,'main') warehouse,
      sum(coalesce(qty,0)) qty_balance,max(updated_at) last_movement_at
    from inventory_movements where coalesce(is_deleted,false)=false
    group by coalesce(product_id,''),coalesce(product_sku,''),coalesce(product_name,''),coalesce(warehouse,'main');

  create function crm_guard_product_soft_delete() returns trigger language plpgsql as $$begin return new;end$$;
  create trigger products_guard_soft_delete before update on products for each row execute function crm_guard_product_soft_delete();
  create function crm_create_product(p_product jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;
  create function crm_update_product(p_product_id text,p_changes jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;
  create function crm_list_products() returns jsonb language sql as $$select '[]'::jsonb$$;
  create policy "products active employee read" on products for select to authenticated using (true);

  insert into audit_logs
  select gen_random_uuid()::text,'legacyProductAudit','products','legacy-'||g,'legacy@test.local','{}','{}',now()
  from generate_series(1,5) g;
`);

await db.exec(migration);

const clean = await scalar(`select
  (select count(*)::int from products) products,
  (select count(*)::int from quote_items where product_id is not null) quote_refs,
  (select count(*)::int from audit_logs where entity='products' and action='legacyProductAudit') legacy_audits,
  (select data_type from information_schema.columns where table_schema='public' and table_name='products' and column_name='id') id_type,
  (select data_type from information_schema.columns where table_schema='public' and table_name='quote_items' and column_name='product_id') quote_product_type,
  to_regclass('public.product_inventory_balance') is null view_retired`);
assert.deepEqual(clean, {products:0,quote_refs:0,legacy_audits:5,id_type:"uuid",quote_product_type:"uuid",view_retired:true});
const quote = await scalar("select product_sku,product_name,unit,unit_price::text,qty::text,line_total::text,raw_data from quote_items where id='quote-item-1'");
assert.equal(quote.product_sku,"SKU-1");
assert.equal(quote.product_name,"Legacy Product 1");
assert.equal(quote.unit,"m²");
assert.equal(quote.unit_price,"100000");
assert.equal(quote.raw_data.snapshot,true);

await db.exec("set role authenticated");
await q("select set_config('app.uid','11111111-1111-4111-8111-111111111111',false)");
const createdResult = await scalar("select crm_create_product($1::jsonb) result", [JSON.stringify({
  code:"  r2   -  a1  ", name:"Gạch R2 A1", width_cm:"7.5", height_cm:"30",
  price_per_m2:"760000", price_per_box:"1094400", price_per_piece:null,
  pieces_per_box:"2", sqm_per_box:"1.44", surface:"MATT", origin:null,
  stock_quantity:null, price_effective_date:"2026-09-03"
})]);
let product = createdResult.result;
assert.match(product.id,/^[0-9a-f-]{36}$/);
assert.equal(product.code,"r2   -  a1");
assert.equal(product.version,1);
assert.equal(product.created_by_name,"Sale Test");
assert.equal((await scalar("select code_normalized from products where id=$1",[product.id])).code_normalized,"R2 - A1");
assert.equal((await scalar("select count(*)::int n from product_price_history where product_id=$1",[product.id])).n,1);

await expectDenied(() => q("select crm_create_product($1::jsonb)",[JSON.stringify({
  code:"R2 - A1",name:"Duplicate",width_cm:"60",height_cm:"60",price_per_m2:"1",price_effective_date:"2026-09-03"
})]),"23505");

const beforeNoop = await scalar("select version,updated_at,test_product_update_audit_count() audit_count from products where id=$1",[product.id]);
const noop = (await scalar("select crm_update_product($1,$2,$3::jsonb) result",[product.id,product.version,"{}"])).result;
const afterNoop = await scalar("select version,updated_at,test_product_update_audit_count() audit_count from products where id=$1",[product.id]);
assert.equal(noop.version,1);
assert.deepEqual(afterNoop,beforeNoop);

product = (await scalar("select crm_update_product($1,$2,$3::jsonb) result",[
  product.id,product.version,JSON.stringify({price_per_m2:"800000",price_effective_date:"2026-09-11"})
])).result;
assert.equal(product.version,2);
assert.equal(product.price_per_m2,"800000");
assert.equal((await scalar("select count(*)::int n from product_price_history where product_id=$1",[product.id])).n,2);

const historyBeforeStock = (await scalar("select count(*)::int n from product_price_history where product_id=$1",[product.id])).n;
product = (await scalar("select crm_update_product($1,$2,$3::jsonb) result",[
  product.id,product.version,JSON.stringify({stock_quantity:"0"})
])).result;
assert.equal(product.stock_quantity,"0.0000");
assert.equal((await scalar("select count(*)::int n from product_price_history where product_id=$1",[product.id])).n,historyBeforeStock);

product = (await scalar("select crm_update_product($1,$2,$3::jsonb) result",[
  product.id,product.version,JSON.stringify({surface:null,price_per_box:null})
])).result;
assert.equal(product.surface,null);
assert.equal(product.price_per_box,null);
assert.equal((await scalar("select count(*)::int n from product_price_history where product_id=$1",[product.id])).n,3);

await expectDenied(() => q("select crm_update_product($1,$2,$3::jsonb)",[product.id,1,JSON.stringify({name:"Stale"})]),"40001");
await expectDenied(() => q("select crm_set_product_active($1,$2,false)",[product.id,product.version]),"42501");
await expectDenied(() => q("insert into products(code,name,width_cm,height_cm,price_per_m2,price_effective_date,created_by_user_id,updated_by_user_id) values('X','X',1,1,1,'2026-09-03','sale-1','sale-1')"),"42501");

const listedSale = (await scalar("select crm_list_products() result")).result;
assert.equal(listedSale.length,1);
assert.equal(listedSale[0].created_by_name,"Sale Test");
const historySale = (await scalar("select crm_list_product_price_history($1) result",[product.id])).result;
assert.equal(historySale.length,3);

await q("select set_config('app.uid','22222222-2222-4222-8222-222222222222',false)");
product = (await scalar("select crm_update_product($1,$2,$3::jsonb) result",[
  product.id,product.version,JSON.stringify({name:"Gạch R2 Manager"})
])).result;
assert.equal(product.updated_by_name,"Manager Test");
const archived = (await scalar("select crm_set_product_active($1,$2,false) result",[product.id,product.version])).result;
assert.equal(archived.active,false);
assert.equal((await scalar("select jsonb_array_length(crm_list_products()) n")).n,1,"Manager sees inactive Product");

await q("select set_config('app.uid','11111111-1111-4111-8111-111111111111',false)");
assert.equal((await scalar("select jsonb_array_length(crm_list_products()) n")).n,0,"Sale does not see inactive Product");
await expectDenied(() => q("select crm_list_product_price_history($1)",[product.id]),"P0002");

await db.exec("reset role");
await expectDenied(() => q("update product_price_history set reason='tamper' where product_id=$1",[product.id]),"42501");

console.log("Product R2 integration PASS: dependency cutover, 404 reset, UUID, Sale/Manager RPC, no-op, history, NULL, version, archive, RLS and quote snapshot.");
await db.close();
