import fs from "node:fs";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";

const entry = process.env.PRODUCTS_R2_PGLITE_ENTRY || "C:/Users/ADMIN/AppData/Local/Temp/crm-products-r1-runtime/node_modules/@electric-sql/pglite/dist/index.js";
const {PGlite} = await import(pathToFileURL(entry).href);
const db = new PGlite();
const migration = fs.readFileSync(new URL("../supabase-phase-product-r2-clean-rebuild.sql", import.meta.url), "utf8");
const importMigration = fs.readFileSync(new URL("../supabase-phase-product-r2-import-preview.sql", import.meta.url), "utf8");
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
    ('manager-1','manager@test.local','Manager Test','manager',true,'active','22222222-2222-4222-8222-222222222222'),
    ('sale-2','sale2@test.local','Sale B','sale',true,'active','33333333-3333-4333-8333-333333333333'),
    ('admin-1','admin@test.local','Admin Test','admin',true,'active','44444444-4444-4444-8444-444444444444'),
    ('owner-1','owner@test.local','Owner Test','owner',true,'active','55555555-5555-4555-8555-555555555555');

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
await db.exec(importMigration);

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

await db.exec(`
  create function test_step5_state_hash() returns jsonb language sql stable security definer set search_path=public as $$
    select jsonb_build_object(
      'products_count',(select count(*)::int from products),
      'products_hash',(select md5(coalesce(string_agg(row_to_json(p)::text,'|' order by p.id),'')) from products p),
      'history_count',(select count(*)::int from product_price_history),
      'history_hash',(select md5(coalesce(string_agg(row_to_json(h)::text,'|' order by h.id),'')) from product_price_history h))
  $$;
  insert into products(code,name,width_cm,height_cm,price_per_m2,price_per_box,price_per_piece,pieces_per_box,sqm_per_box,surface,origin,stock_quantity,price_effective_date,active,created_by_user_id,updated_by_user_id)
  values
  ('SYN-UNCHANGED','Synthetic unchanged',60,60,100000,36000,18000,2,.36,'MATT','Testland',42,'2020-01-01',true,'sale-1','sale-1'),
  ('SYN-M2','Synthetic m2',60,60,100000,36000,18000,2,.36,null,null,42,'2020-01-01',true,'sale-1','sale-1'),
  ('SYN-BOX','Synthetic box',60,60,100000,36000,18000,2,.36,null,null,42,'2020-01-01',true,'sale-1','sale-1'),
  ('SYN-PIECE','Synthetic piece',60,60,100000,36000,18000,2,.36,null,null,42,'2020-01-01',true,'sale-1','sale-1'),
  ('SYN-PIECES','Synthetic pieces',60,60,100000,36000,18000,2,.36,null,null,42,'2020-01-01',true,'sale-1','sale-1'),
  ('SYN-SQM','Synthetic sqm',60,60,100000,36000,18000,2,.36,null,null,42,'2020-01-01',true,'sale-1','sale-1'),
  ('SYN-DATE','Synthetic date',60,60,100000,36000,18000,2,.36,null,null,42,'2019-01-01',true,'sale-1','sale-1'),
  ('SYN-NAME','Canonical name',60,60,100000,null,null,null,null,null,null,42,'2020-01-01',true,'sale-1','sale-1'),
  ('SYN-SIZE','Synthetic size',60,60,100000,null,null,null,null,null,null,42,'2020-01-01',true,'sale-1','sale-1'),
  ('SYN-MISSING','Synthetic missing optional',60,60,100000,999999,888888,9,9.999,null,null,42,'2020-01-01',true,'sale-1','sale-1');
`);

const row=(source_row_number,code,name="Synthetic product",changes={})=>({
  source_page:1,source_row_number,stt:source_row_number,code,name,width_cm:"60",height_cm:"60",price_per_m2:"100000",
  source_values:{code,name,width_cm:"60",height_cm:"60",price_per_m2:"100000"},warnings:[],...changes
});
const withOptional=(base,values={})=>{
  const merged={price_per_box:"36000",price_per_piece:"18000",pieces_per_box:"2",sqm_per_box:"0.36",...values};
  return {...base,...merged,source_values:{...base.source_values,...merged}};
};
const mainRows=[
  row(1,"SYN-NEW","Synthetic new"),
  withOptional(row(2,"SYN-UNCHANGED","  synthetic   unchanged "),{surface_candidate:"GLOSSY"}),
  withOptional(row(3,"SYN-M2","Synthetic m2"),{price_per_m2:"110000"}),
  withOptional(row(4,"SYN-BOX","Synthetic box"),{price_per_box:"37000"}),
  withOptional(row(5,"SYN-PIECE","Synthetic piece"),{price_per_piece:"19000"}),
  withOptional(row(6,"SYN-PIECES","Synthetic pieces"),{pieces_per_box:"3"}),
  withOptional(row(7,"SYN-SQM","Synthetic sqm"),{sqm_per_box:"0.37"}),
  withOptional(row(8,"SYN-DATE","Synthetic date")),
  row(9,"SYN-NAME","Different unsafe name"),
  row(10,"SYN-SIZE","Synthetic size",{width_cm:"30",source_values:{code:"SYN-SIZE",name:"Synthetic size",width_cm:"30",height_cm:"60",price_per_m2:"100000"}}),
  row(11,"SYN-MISSING","Synthetic missing optional"),
  row(12,"SYN-DUP-I","Identical duplicate"),row(13," syn-dup-i ","Identical duplicate"),
  row(14,"SYN-DUP-C","Conflicting duplicate"),row(15,"SYN-DUP-C","Conflicting duplicate",{price_per_m2:"120000",source_values:{code:"SYN-DUP-C",name:"Conflicting duplicate",width_cm:"60",height_cm:"60",price_per_m2:"120000"}}),
  row(16,"SYN-BAD","Invalid price",{price_per_m2:null,source_values:{code:"SYN-BAD",name:"Invalid price",width_cm:"60",height_cm:"60",price_per_m2:null}})
];
const batch=(name,date="2020-01-01")=>({supplier:"SYNTHETIC",source_filename:name,source_sha256:"a".repeat(64),source_file_size_bytes:12345,parser_adapter:"ISTONE_INDONESIA_V1",parser_version:"1.0.0",effective_date:date,page_count:1,origin_candidate:"Testland"});
const stateHash=async()=>(await scalar("select test_step5_state_hash() result")).result;

await db.exec("set role authenticated");
await q("select set_config('app.uid','11111111-1111-4111-8111-111111111111',false)");
const beforeImport=await stateHash();
const requestId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const staged=(await scalar("select crm_stage_product_import($1::jsonb,$2::jsonb,$3::uuid) result",[JSON.stringify(batch("synthetic-main.pdf")),JSON.stringify(mainRows),requestId])).result;
const replay=(await scalar("select crm_stage_product_import($1::jsonb,$2::jsonb,$3::uuid) result",[JSON.stringify(batch("synthetic-main.pdf")),JSON.stringify(mainRows),requestId])).result;
assert.equal(replay.batch_id,staged.batch_id);assert.equal(replay.idempotent_replay,true);
let preview=(await scalar("select crm_get_product_import($1) result",[staged.batch_id])).result;
const classified=preview.rows;
assert.equal(classified[0].classification,"NEW");
assert.equal(classified[1].classification,"UNCHANGED");
for(const index of [2,3,4,5,6,7])assert.equal(classified[index].classification,"PRICE_CHANGED");
assert.ok(classified[2].warnings.includes("SAME_EFFECTIVE_DATE_CHANGED"));
assert.equal(classified[8].review_reason,"NAME_MISMATCH");assert.equal(classified[9].review_reason,"SIZE_MISMATCH");
assert.equal(classified[10].classification,"UNCHANGED","missing optional does not clear current values");
assert.deepEqual(classified.slice(11,13).map(x=>x.duplicate_kind),["IDENTICAL","IDENTICAL"]);
assert.deepEqual(classified.slice(13,15).map(x=>x.duplicate_kind),["CONFLICTING","CONFLICTING"]);
assert.equal(classified[15].classification,"INVALID");
const tampered=mainRows.map(item=>({...item,code_normalized:"CLIENT-LIE",classification:"NEW",matched_product_id:"00000000-0000-0000-0000-000000000000",current_product_version:999,diff:{fake:true},created_by_user_id:"sale-2",created_at:"1900-01-01"}));
const tamperStage=(await scalar("select crm_stage_product_import($1::jsonb,$2::jsonb,$3::uuid) result",[JSON.stringify(batch("synthetic-tamper.pdf")),JSON.stringify(tampered),"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"])).result;
const tamperRow=(await scalar("select crm_get_product_import($1) result",[tamperStage.batch_id])).result.rows.find(item=>item.source_row_number===2);
assert.equal(tamperRow.code_normalized,"SYN-UNCHANGED");assert.equal(tamperRow.classification,"UNCHANGED");assert.notEqual(tamperRow.matched_product_id,"00000000-0000-0000-0000-000000000000");assert.equal(tamperRow.current_product_version,1);assert.equal(tamperRow.diff.fake,undefined);

const duplicateRows=classified.filter(item=>item.classification==="DUPLICATE_IN_FILE");
const identical=duplicateRows.filter(x=>x.duplicate_kind==="IDENTICAL"),conflicting=duplicateRows.filter(x=>x.duplicate_kind==="CONFLICTING");
preview=(await scalar("select crm_update_product_import_review($1,$2::jsonb) result",[staged.batch_id,JSON.stringify({rows:[{row_id:classified[1].id,surface_accepted:true},{row_id:classified[8].id,selected_action:"SKIP"},{row_id:classified[9].id,selected_action:"SKIP"},{row_id:classified[15].id,selected_action:"SKIP"}],duplicates:[{duplicate_group_id:identical[0].duplicate_group_id,resolution:"COLLAPSE",representative_row_id:identical[0].id},{duplicate_group_id:conflicting[0].duplicate_group_id,resolution:"SKIP_GROUP"}]})])).result;
assert.equal(preview.batch.status,"READY");
assert.equal(preview.rows.filter(item=>item.selected_action==="CREATE").length,2);
assert.equal(preview.rows.find(item=>item.source_row_number===2).base_classification,"INFO_CHANGED");
await scalar("select crm_refresh_product_import($1) result",[staged.batch_id]);
const afterImport=await stateHash();assert.deepEqual(afterImport,beforeImport,"stage/review/refresh must not mutate Product or history");
console.log(JSON.stringify({no_product_mutation:{before:beforeImport,after:afterImport}}));

await expectDenied(()=>q("insert into product_import_batches(supplier,source_filename,source_sha256,source_file_size_bytes,parser_adapter,parser_version,effective_date,created_by_user_id) values('X','x.pdf',$1,1,'X','1','2020-01-01','sale-1')",["c".repeat(64)]),"42501");
await q("select set_config('app.uid','33333333-3333-4333-8333-333333333333',false)");
await expectDenied(()=>q("select crm_get_product_import($1)",[staged.batch_id]),"42501");
for(const [uid] of [["22222222-2222-4222-8222-222222222222"],["44444444-4444-4444-8444-444444444444"],["55555555-5555-4555-8555-555555555555"]]){
  await q("select set_config('app.uid',$1,false)",[uid]);assert.ok((await scalar("select crm_get_product_import($1) result",[staged.batch_id])).result.batch.id);assert.ok((await scalar("select crm_refresh_product_import($1) result",[staged.batch_id])).result.batch.id);
}
await q("select set_config('app.uid','11111111-1111-4111-8111-111111111111',false)");
const older=(await scalar("select crm_stage_product_import($1::jsonb,$2::jsonb,$3::uuid) result",[JSON.stringify(batch("synthetic-older.pdf","2018-01-01")),JSON.stringify([row(1,"SYN-DATE","Synthetic date")]),"cccccccc-cccc-4ccc-8ccc-cccccccccccc"])).result;
assert.equal((await scalar("select crm_get_product_import($1) result",[older.batch_id])).result.rows[0].review_reason,"OLDER_EFFECTIVE_DATE");
const future=(await scalar("select crm_stage_product_import($1::jsonb,$2::jsonb,$3::uuid) result",[JSON.stringify(batch("synthetic-future.pdf","2099-01-01")),JSON.stringify([row(1,"SYN-NEW-FUTURE","Synthetic future")]),"dddddddd-dddd-4ddd-8ddd-dddddddddddd"])).result;
assert.equal((await scalar("select crm_get_product_import($1) result",[future.batch_id])).result.rows[0].review_reason,"FUTURE_EFFECTIVE_DATE");

const staleStage=(await scalar("select crm_stage_product_import($1::jsonb,$2::jsonb,$3::uuid) result",[JSON.stringify(batch("synthetic-stale.pdf")),JSON.stringify([withOptional(row(1,"SYN-UNCHANGED","Synthetic unchanged"))]),"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"])).result;
let stalePreview=(await scalar("select crm_get_product_import($1) result",[staleStage.batch_id])).result;
const staleProduct=stalePreview.rows[0];
await scalar("select crm_update_product($1,$2,$3::jsonb) result",[staleProduct.matched_product_id,staleProduct.current_product_version,JSON.stringify({stock_quantity:"43"})]);
stalePreview=(await scalar("select crm_get_product_import($1) result",[staleStage.batch_id])).result;
assert.equal(stalePreview.rows[0].is_stale,true);assert.equal(stalePreview.batch.status,"STAGED");
stalePreview=(await scalar("select crm_refresh_product_import($1) result",[staleStage.batch_id])).result;
assert.equal(stalePreview.rows[0].is_stale,false);assert.equal(stalePreview.rows[0].selected_action,"NONE");

const source=importMigration.toLowerCase();
for(const forbidden of ["insert into public.products","update public.products","delete from public.products","insert into public.product_price_history","update public.product_price_history","delete from public.product_price_history"]){assert.equal(source.includes(forbidden),false,`forbidden mutation path: ${forbidden}`);}

if(process.env.PRODUCT_R2_PRIVATE_STAGE_PAYLOAD){
  const privatePayload=JSON.parse(fs.readFileSync(process.env.PRODUCT_R2_PRIVATE_STAGE_PAYLOAD,"utf8"));
  const privateStage=(await scalar("select crm_stage_product_import($1::jsonb,$2::jsonb,$3::uuid) result",[JSON.stringify(privatePayload.batch),JSON.stringify(privatePayload.rows),"ffffffff-ffff-4fff-8fff-ffffffffffff"])).result;
  let privatePreview=(await scalar("select crm_get_product_import($1) result",[privateStage.batch_id])).result;
  assert.equal(privatePreview.rows.length,76);assert.equal(privatePreview.rows.filter(item=>item.classification==="NEW").length,74);assert.equal(privatePreview.rows.filter(item=>item.classification==="DUPLICATE_IN_FILE").length,2);assert.equal(privatePreview.rows.filter(item=>item.classification==="INVALID").length,0);
  const duplicate=privatePreview.rows.filter(item=>item.classification==="DUPLICATE_IN_FILE");assert.equal(new Set(duplicate.map(item=>item.duplicate_group_id)).size,1);assert.ok(duplicate.every(item=>item.duplicate_kind==="IDENTICAL"));
  privatePreview=(await scalar("select crm_update_product_import_review($1,$2::jsonb) result",[privateStage.batch_id,JSON.stringify({duplicates:[{duplicate_group_id:duplicate[0].duplicate_group_id,resolution:"COLLAPSE",representative_row_id:duplicate[0].id}]})])).result;
  assert.equal(privatePreview.batch.status,"READY");assert.equal(privatePreview.rows.filter(item=>item.selected_action==="CREATE").length,75);
  console.log(JSON.stringify({private_pdf:{physical_rows:76,new_rows:74,duplicate_rows:2,duplicate_groups:1,invalid_rows:0,ready_create_candidates:75,status:"READY"}}));
}
console.log("Product R2 STEP 5 integration PASS: clean migration, classification, duplicate resolution, tamper resistance, idempotency, roles, direct-write denial, date safety and zero Product mutation.");
await db.close();
