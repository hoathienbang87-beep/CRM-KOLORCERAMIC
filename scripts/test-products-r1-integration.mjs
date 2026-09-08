// Chỉ DB cục bộ PGlite trong bộ nhớ. Không dùng credential/URL production.
// PRODUCTS_TEST_PGLITE_ENTRY trỏ tới @electric-sql/pglite/dist/index.js ngoài repo.
import fs from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(pathToFileURL(process.env.PRODUCTS_TEST_PGLITE_ENTRY).href);
const db = new PGlite();
let checks = 0;
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const eq = (a, b) => { assert.deepEqual(a, b); checks++; };
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to authenticated,anon;
  create table app_users(id text primary key, supabase_auth_id uuid unique, name text, email text, role text, active boolean, lifecycle_status text);
  create function crm_current_app_user_id() returns text language sql stable security definer set search_path=public as $$
    select id from app_users where auth.uid() is not null and supabase_auth_id=auth.uid()
    and coalesce(active,false) and lower(coalesce(lifecycle_status,'inactive'))='active' limit 1 $$;
  create function crm_current_user_role() returns text language sql stable security definer set search_path=public as $$
    select coalesce((select lower(role) from app_users where id=crm_current_app_user_id()),'') $$;
  create function crm_is_active_user() returns boolean language sql stable as $$ select crm_current_app_user_id() is not null $$;
  create function crm_is_admin() returns boolean language sql stable as $$ select coalesce(crm_current_user_role() in ('owner','admin'),false) $$;
  create function crm_is_manager() returns boolean language sql stable as $$ select coalesce(crm_current_user_role() in ('owner','admin','manager'),false) $$;
  create function crm_current_email() returns text language sql stable security definer set search_path=public as $$ select email from app_users where id=crm_current_app_user_id() $$;
  create table audit_logs(action text,entity text,entity_id text,payload jsonb);
  create function crm_write_audit(text,text,text,jsonb) returns void language sql as $$ insert into audit_logs values($1,$2,$3,$4) $$;
  create table products(id text primary key,name text,sku text,price numeric,unit text,active boolean default true,
    created_at timestamptz,updated_at timestamptz,raw_data jsonb not null default '{}',is_deleted boolean default false);
  insert into products(id,name,sku,price,raw_data) select 'p'||g,'Product '||g,'SKU'||g,123.45,
    '{"size":"600x600","surface":"MATT","origin":"VN","legacy":{"keep":true},"color":"X"}' from generate_series(1,403) g;
  insert into app_users values
    ('sale','00000000-0000-4000-8000-000000000001','Sale','s@test','sale',true,'active'),
    ('manager','00000000-0000-4000-8000-000000000002','Manager','m@test','manager',true,'active'),
    ('admin','00000000-0000-4000-8000-000000000003','Admin','a@test','admin',true,'active'),
    ('inactive','00000000-0000-4000-8000-000000000004','Inactive','i@test','sale',false,'inactive'),
    ('archived','00000000-0000-4000-8000-000000000005','Archived','h@test','sale',true,'archived'),
    ('other','00000000-0000-4000-8000-000000000006','Other','o@test','unknown',true,'active'),
    ('owner','00000000-0000-4000-8000-000000000007','Owner','w@test','owner',true,'active');
`);
const migration = fs.readFileSync(new URL('../supabase-phase-crm-products-r1-lightweight-catalog.sql', import.meta.url),'utf8');
await db.exec(migration);
await db.exec(migration); // Đã tồn tại schema/policy/RPC: apply lại phải deterministic.
eq((await q('select count(*)::int n from products'))[0].n,403);
eq((await q('select count(*)::int n from products where stock_quantity is null'))[0].n,403);
const asUser = async (n, role='authenticated') => {
  await db.exec('reset role');
  await q("select set_config('request.jwt.claim.sub',$1,false)",[n ? '00000000-0000-4000-8000-'+String(n).padStart(12,'0') : '']);
  await db.exec('set role '+role);
};
const update = async (changes,id='p1') => (await q('select crm_update_product($1,$2::jsonb) result',[id,JSON.stringify(changes)]))[0].result;
const denied = async (fn,code) => { await assert.rejects(fn,e=>e.code===code); checks++; };
for(const [n,actor] of [[1,'sale'],[2,'manager'],[3,'admin'],[7,'owner']]) {
  await asUser(n);
  const result=await update({price:'325000.125',stock_quantity:'125.500000000000000001',size:'900x900'});
  eq(result.price,'325000.125'); eq(result.stock_quantity,'125.500000000000000001');
  eq(result.updated_by_user_id,actor); eq(result.updated_by_name,actor[0].toUpperCase()+actor.slice(1));
  assert.ok(Date.parse(result.updated_at));checks++;
}
await asUser(1);
eq((await update({stock_quantity:null})).stock_quantity,null);
eq((await update({stock_quantity:'0'})).stock_quantity,'0');
await update({origin:'SPAIN'});
const listed=(await q('select crm_list_products() rows'))[0].rows;
eq(listed.length,403); eq(listed.find(p=>p.id==='p1').updated_by_name,'Sale');
for(const payload of [{updated_by_user_id:'admin'},{updated_at:'1900-01-01'},{role:'admin'},{raw_data:{}},{employee_id:'admin'},null,[],{price:'-1'},{price:'NaN'},{price:'Infinity'},{price:'325.000,5'},{price:null},{stock_quantity:'NaN'},{stock_quantity:'Infinity'},{stock_quantity:-1},{stock_quantity:''},{name:{}},{name:''}]) {
  await denied(()=>update(payload),'22023');
}
await denied(()=>update({},'missing'),'P0002');
await denied(()=>q("select crm_create_product('{\"name\":\"new\",\"price\":1}')"),'42501');
await denied(()=>q("update products set price=0 where id='p1'"),'42501');
await db.exec('reset role');
const row=(await q("select * from products where id='p1'"))[0];
eq(row.raw_data.legacy,{keep:true});eq(row.raw_data.color,'X');eq(row.raw_data.surface,'MATT');eq(row.raw_data.size,'900x900');
eq(row.raw_data.origin,'SPAIN');eq(row.price,'325000.125');
await db.exec("update products set is_deleted=true where id='p2'");
await asUser(1);await denied(()=>update({},'p2'),'P0002');
eq((await q('select crm_list_products() rows'))[0].rows.length,402);
eq((await q('select count(*)::int n from products'))[0].n,402);
for(const n of [0,4,5,6,8]) {
  await asUser(n);
  await denied(()=>update({price:'1'}),'42501');
  await denied(()=>q('select crm_list_products()'),'42501');
  await denied(()=>q("select crm_create_product('{\"name\":\"new\",\"price\":1}')"),'42501');
}
await asUser(0,'anon');
await denied(()=>update({price:'1'}),'42501');await denied(()=>q('select * from products'),'42501');
for(const n of [2,3,7]) {
  await asUser(n);
  const created=(await q('select crm_create_product($1::jsonb) result',[JSON.stringify({code:'NEW'+n,name:'New',price:'1.125',stock_quantity:null})]))[0].result;
  eq(created.price,'1.125');eq(created.stock_quantity,null);
  await denied(()=>q('select crm_create_product($1::jsonb)',[JSON.stringify({name:'x',price:'Infinity'})]),'22023');
  await denied(()=>q('select crm_create_product($1::jsonb)',[JSON.stringify({name:'x',price:'1',raw_data:{}})]),'22023');
}
await db.exec('reset role');
eq((await q("select count(*)::int n from products where id like 'p%'"))[0].n,403);
console.log(`Product R1 PostgreSQL integration PASS (${checks} checks; 403 synthetic legacy rows preserved).`);
await db.close();
