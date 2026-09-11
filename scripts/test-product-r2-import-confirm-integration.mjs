import fs from "node:fs";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";

const entry = process.env.PRODUCTS_R2_PGLITE_ENTRY || "C:/Users/ADMIN/AppData/Local/Temp/crm-products-r1-runtime/node_modules/@electric-sql/pglite/dist/index.js";
const {PGlite} = await import(pathToFileURL(entry).href);
const db = new PGlite();
const migration = fs.readFileSync(new URL("../supabase-phase-product-r2-clean-rebuild.sql", import.meta.url), "utf8");
const importMigration = fs.readFileSync(new URL("../supabase-phase-product-r2-import-preview.sql", import.meta.url), "utf8");
const confirmMigration = fs.readFileSync(new URL("../supabase-phase-product-r2-import-confirm.sql", import.meta.url), "utf8");
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
  create function test_step6_audit_count() returns integer language sql stable security definer set search_path=public as
    $$select count(*)::integer from audit_logs$$;

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
await db.exec(confirmMigration);

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
const mainReview={rows:[{row_id:classified[1].id,surface_accepted:true},{row_id:classified[8].id,selected_action:"SKIP"},{row_id:classified[9].id,selected_action:"SKIP"},{row_id:classified[15].id,selected_action:"SKIP"}],duplicates:[{duplicate_group_id:identical[0].duplicate_group_id,resolution:"COLLAPSE",representative_row_id:identical[0].id},{duplicate_group_id:conflicting[0].duplicate_group_id,resolution:"SKIP_GROUP"}]};
preview=(await scalar("select crm_update_product_import_review($1,$2::jsonb) result",[staged.batch_id,JSON.stringify(mainReview)])).result;
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

let privateBatchId=null;
let privatePayload=null;
if(process.env.PRODUCT_R2_PRIVATE_STAGE_PAYLOAD){
  privatePayload=JSON.parse(fs.readFileSync(process.env.PRODUCT_R2_PRIVATE_STAGE_PAYLOAD,"utf8"));
  const privateStage=(await scalar("select crm_stage_product_import($1::jsonb,$2::jsonb,$3::uuid) result",[JSON.stringify(privatePayload.batch),JSON.stringify(privatePayload.rows),"12121212-1212-4121-8121-121212121212"])).result;
  privateBatchId=privateStage.batch_id;
  let privatePreview=(await scalar("select crm_get_product_import($1) result",[privateStage.batch_id])).result;
  assert.equal(privatePreview.rows.length,76);assert.equal(privatePreview.rows.filter(item=>item.classification==="NEW").length,74);assert.equal(privatePreview.rows.filter(item=>item.classification==="DUPLICATE_IN_FILE").length,2);assert.equal(privatePreview.rows.filter(item=>item.classification==="INVALID").length,0);
  const duplicate=privatePreview.rows.filter(item=>item.classification==="DUPLICATE_IN_FILE");assert.equal(new Set(duplicate.map(item=>item.duplicate_group_id)).size,1);assert.ok(duplicate.every(item=>item.duplicate_kind==="IDENTICAL"));
  privatePreview=(await scalar("select crm_update_product_import_review($1,$2::jsonb) result",[privateStage.batch_id,JSON.stringify({duplicates:[{duplicate_group_id:duplicate[0].duplicate_group_id,resolution:"COLLAPSE",representative_row_id:duplicate[0].id}]})])).result;
  assert.equal(privatePreview.batch.status,"READY");assert.equal(privatePreview.rows.filter(item=>item.selected_action==="CREATE").length,75);
  console.log(JSON.stringify({private_pdf:{physical_rows:76,new_rows:74,duplicate_rows:2,duplicate_groups:1,invalid_rows:0,ready_create_candidates:75,status:"READY"}}));
}

const verifiedStage=async(name,rows,requestId)=>{
  const result=(await scalar("select crm_stage_product_import($1::jsonb,$2::jsonb,$3::uuid) result",[JSON.stringify(batch(name)),JSON.stringify(rows),requestId])).result;
  await scalar("select crm_register_product_import_source($1,$2,$3,$4) result",[result.batch_id,"a".repeat(64),12345,`imports/${result.batch_id}/source.pdf`]);
  return result.batch_id;
};
const confirm=async(batchId,key)=>scalar("select crm_confirm_product_import($1,$2) result",[batchId,key]);

await q("select set_config('app.uid','33333333-3333-4333-8333-333333333333',false)");
await expectDenied(()=>confirm(staged.batch_id,"33333333-3333-4333-8333-333333333334"),"42501");

if(privateBatchId){
  const beforePrivate=await scalar("select (select count(*)::int from products) products,(select count(*)::int from product_price_history) history,test_step6_audit_count() audits");
  await q("select set_config('app.uid','11111111-1111-4111-8111-111111111111',false)");
  const sourceResult=(await scalar("select crm_register_product_import_source($1,$2,$3,$4) result",[privateBatchId,privatePayload.batch.source_sha256,privatePayload.batch.source_file_size_bytes,"imports/"+privateBatchId+"/source.pdf"])).result;
  assert.equal(sourceResult.verified,true);
  const privateConfirmStarted=performance.now();
  const appliedPrivate=(await confirm(privateBatchId,"12121212-1212-4121-8121-121212121213")).result;
  const privateConfirmMs=Math.round(performance.now()-privateConfirmStarted);
  assert.equal(appliedPrivate.status,"APPLIED");assert.equal(appliedPrivate.summary.created,75);assert.equal(appliedPrivate.summary.history_created,75);
  const afterPrivate=await scalar("select (select count(*)::int from products) products,(select count(*)::int from product_price_history) history,test_step6_audit_count() audits");
  assert.equal(afterPrivate.products-beforePrivate.products,75);assert.equal(afterPrivate.history-beforePrivate.history,75);assert.equal(afterPrivate.audits-beforePrivate.audits,77);
  const privateChecks=await scalar("select (select count(*)::int from products p join product_price_history h on h.product_id=p.id where h.import_batch_id=$1 and h.source_type='PDF_IMPORT') history_rows,(select count(*)::int from products where created_by_user_id='sale-1' and stock_quantity is null and code_normalized like 'INDO%') stock_null_products,(select count(*)::int from products where updated_by_user_id='sale-1' and code_normalized like 'INDO%') actor_rows",[privateBatchId]);
  assert.equal(privateChecks.history_rows,75);assert.equal(privateChecks.stock_null_products,75);assert.equal(privateChecks.actor_rows,75);
  assert.equal((await scalar("select crm_get_product_import($1) result",[privateBatchId])).result.batch.status,"APPLIED");
  const privateRetry=(await confirm(privateBatchId,"12121212-1212-4121-8121-121212121213")).result;assert.equal(privateRetry.idempotent_replay,true);
  console.log(JSON.stringify({private_confirm:{source_rows:76,unique_codes:75,resolved_duplicate_groups:1,create_actions:75,new_products:75,initial_pdf_import_history:75,stock_modified:0,partial_product_apply:0,status:"APPLIED",history_audit_delta:75,audit_rows:77,confirm_transaction_ms:privateConfirmMs}}));
}

await q("select set_config('app.uid','11111111-1111-4111-8111-111111111111',false)");
const noSourceStage=(await scalar("select crm_stage_product_import($1::jsonb,$2::jsonb,$3::uuid) result",[JSON.stringify(batch("confirm-no-source.pdf")),JSON.stringify([row(1,"SYN-NO-SOURCE","Synthetic no source")]),"11111111-1111-4111-8111-111111111111"])).result;
await expectDenied(()=>confirm(noSourceStage.batch_id,"11111111-1111-4111-8111-111111111112"),"P0001");
const confirmBatch=await verifiedStage("confirm-create.pdf",[row(1,"SYN-CONFIRM","Synthetic confirmed")],"11111111-1111-4111-8111-111111111113");
const sourceReplay=(await scalar("select crm_register_product_import_source($1,$2,$3,$4) result",[confirmBatch,"a".repeat(64),12345,"imports/"+confirmBatch+"/source.pdf"])).result;assert.equal(sourceReplay.idempotent_replay,true);
const confirmResult=(await confirm(confirmBatch,"11111111-1111-4111-8111-111111111114")).result;
assert.equal(confirmResult.status,"APPLIED");assert.equal(confirmResult.summary.created,1);assert.equal(confirmResult.summary.history_created,1);
const appliedProduct=await scalar("select code,name,stock_quantity::text,version from products where code_normalized='SYN-CONFIRM'");assert.equal(appliedProduct.code,"SYN-CONFIRM");assert.equal(appliedProduct.stock_quantity,null);assert.equal(appliedProduct.version,1);
const appliedHistory=await scalar("select source_type,import_batch_id,changed_by_user_id,effective_date::text from product_price_history where product_id=(select id from products where code_normalized='SYN-CONFIRM')");assert.deepEqual(appliedHistory,{source_type:"PDF_IMPORT",import_batch_id:confirmBatch,changed_by_user_id:"sale-1",effective_date:"2020-01-01"});
const retry=(await confirm(confirmBatch,"11111111-1111-4111-8111-111111111114")).result;assert.equal(retry.idempotent_replay,true);assert.equal(retry.summary.created,1);
const doubleConfirm=await Promise.all([confirm(confirmBatch,"11111111-1111-4111-8111-111111111114"),confirm(confirmBatch,"11111111-1111-4111-8111-111111111114")]);assert.ok(doubleConfirm.every(item=>item.result.idempotent_replay===true));
await expectDenied(()=>confirm(confirmBatch,"11111111-1111-4111-8111-111111111115"),"P0001");
await expectDenied(()=>q("select crm_update_product_import_review($1,$2::jsonb)",[confirmBatch,JSON.stringify({rows:[]})]),"42501");
await expectDenied(()=>scalar("select crm_refresh_product_import($1) result",[confirmBatch]),"42501");
assert.equal((await scalar("select crm_get_product_import($1) result",[confirmBatch])).result.batch.status,"APPLIED");
await expectDenied(()=>q("update product_import_batches set source_verified_sha256='b' where id=$1",[confirmBatch]),"42501");

const managerBatch=await verifiedStage("confirm-manager.pdf",[withOptional(row(1,"SYN-M2","Synthetic m2"),{price_per_m2:"101000"})],"22222222-2222-4222-8222-222222222221");
await q("select set_config('app.uid','22222222-2222-4222-8222-222222222222',false)");
const managerResult=(await confirm(managerBatch,"22222222-2222-4222-8222-222222222223")).result;assert.equal(managerResult.summary.updated,1);
const managerProduct=await scalar("select price_per_m2::text,price_per_box::text,stock_quantity::text,version,updated_by_user_id from products where code_normalized='SYN-M2'");assert.deepEqual(managerProduct,{price_per_m2:"101000",price_per_box:"36000",stock_quantity:"42.0000",version:2,updated_by_user_id:"manager-1"});
assert.equal((await scalar("select changed_by_user_id,source_type from product_price_history where import_batch_id=$1",[managerBatch])).changed_by_user_id,"manager-1");

await q("select set_config('app.uid','11111111-1111-4111-8111-111111111111',false)");
const wrongHashStage=(await scalar("select crm_stage_product_import($1::jsonb,$2::jsonb,$3::uuid) result",[JSON.stringify(batch("wrong-hash.pdf")),JSON.stringify([row(1,"SYN-WRONG-HASH","Synthetic wrong hash")]),"33333333-3333-4333-8333-333333333331"])).result;
await expectDenied(()=>scalar("select crm_register_product_import_source($1,$2,$3,$4) result",[wrongHashStage.batch_id,"b".repeat(64),12345,`imports/${wrongHashStage.batch_id}/source.pdf`]),"22023");

const candidateBatch=(await scalar("select crm_stage_product_import($1::jsonb,$2::jsonb,$3::uuid) result",[JSON.stringify({...batch("candidate.pdf"),origin_candidate:"Indonesia"}),JSON.stringify([row(1,"SYN-CANDIDATE","Synthetic candidate",{surface_candidate:"GLOSSY",origin_candidate:"Indonesia"})]),"44444444-4444-4444-8444-444444444441"])).result;
await scalar("select crm_update_product_import_review($1,$2::jsonb) result",[candidateBatch.batch_id,JSON.stringify({origin_accepted:true,rows:[{row_id:(await scalar("select crm_get_product_import($1) result",[candidateBatch.batch_id])).result.rows[0].id,surface_accepted:true}]})]);
await scalar("select crm_register_product_import_source($1,$2,$3,$4) result",[candidateBatch.batch_id,"a".repeat(64),12345,`imports/${candidateBatch.batch_id}/source.pdf`]);
const candidateResult=(await confirm(candidateBatch.batch_id,"44444444-4444-4444-8444-444444444442")).result;assert.equal(candidateResult.summary.created,1);
const candidateProduct=await scalar("select surface,origin,stock_quantity from products where code_normalized='SYN-CANDIDATE'");assert.deepEqual(candidateProduct,{surface:"GLOSSY",origin:"Indonesia",stock_quantity:null});

await scalar("select crm_update_product_import_review($1,$2::jsonb) result",[staged.batch_id,JSON.stringify(mainReview)]);
const mixedSource=(await scalar("select crm_register_product_import_source($1,$2,$3,$4) result",[staged.batch_id,"a".repeat(64),12345,"imports/"+staged.batch_id+"/source.pdf"])).result;assert.equal(mixedSource.verified,true);
const mixedResult=(await confirm(staged.batch_id,"11111111-1111-4111-8111-111111111116")).result;
assert.equal(mixedResult.summary.created,2);assert.equal(mixedResult.summary.updated,7);assert.equal(mixedResult.summary.unchanged,1);assert.equal(mixedResult.summary.skipped,6);assert.equal(mixedResult.summary.history_created,8);
const mixedStock=await scalar("select (select stock_quantity::text from products where code_normalized='SYN-UNCHANGED') unchanged_stock,(select stock_quantity::text from products where code_normalized='SYN-M2') m2_stock,(select stock_quantity::text from products where code_normalized='SYN-BOX') box_stock,(select stock_quantity::text from products where code_normalized='SYN-NEW') new_stock,(select surface from products where code_normalized='SYN-UNCHANGED') accepted_surface,(select origin from products where code_normalized='SYN-UNCHANGED') preserved_origin");
assert.deepEqual(mixedStock,{unchanged_stock:"43.0000",m2_stock:"42.0000",box_stock:"42.0000",new_stock:null,accepted_surface:"GLOSSY",preserved_origin:"Testland"});
assert.equal((await scalar("select count(*)::int n from product_price_history where import_batch_id=$1",[staged.batch_id])).n,8);

await q("select set_config('app.uid','11111111-1111-4111-8111-111111111111',false)");
const adminBatch=await verifiedStage("admin-confirm.pdf",[row(1,"SYN-ADMIN-CONFIRM","Synthetic admin confirm")],"88888888-8888-4888-8888-888888888881");
await q("select set_config('app.uid','44444444-4444-4444-8444-444444444444',false)");
assert.equal((await confirm(adminBatch,"88888888-8888-4888-8888-888888888882")).result.summary.created,1);
await q("select set_config('app.uid','11111111-1111-4111-8111-111111111111',false)");
const ownerBatch=await verifiedStage("owner-confirm.pdf",[row(1,"SYN-OWNER-CONFIRM","Synthetic owner confirm")],"99999999-9999-4999-8999-999999999991");
await q("select set_config('app.uid','55555555-5555-4555-8555-555555555555',false)");
assert.equal((await confirm(ownerBatch,"99999999-9999-4999-8999-999999999992")).result.summary.created,1);
await q("select set_config('app.uid','11111111-1111-4111-8111-111111111111',false)");
const createRace=await verifiedStage("create-race.pdf",[row(1,"SYN-RACE-CREATE","Synthetic race create")],"55555555-5555-4555-8555-555555555551");
await scalar("select crm_create_product($1::jsonb) result",[JSON.stringify({code:"SYN-RACE-CREATE",name:"Race winner",width_cm:"60",height_cm:"60",price_per_m2:"1",price_effective_date:"2020-01-01"})]);
await expectDenied(()=>confirm(createRace,"55555555-5555-4555-8555-555555555552"),"40001");assert.equal((await scalar("select crm_get_product_import($1) result",[createRace])).result.batch.status,"READY");

const updateRace=await verifiedStage("update-race.pdf",[withOptional(row(1,"SYN-BOX","Synthetic box"),{price_per_box:"38000"})],"66666666-6666-4666-8666-666666666661");
const updateRaceProduct=(await scalar("select crm_get_product_import($1) result",[updateRace])).result.rows[0];
await scalar("select crm_update_product($1,$2,$3::jsonb) result",[updateRaceProduct.matched_product_id,updateRaceProduct.current_product_version,JSON.stringify({stock_quantity:"43"})]);
await expectDenied(()=>confirm(updateRace,"66666666-6666-4666-8666-666666666662"),"40001");assert.equal((await scalar("select price_per_box::text,version from products where code_normalized='SYN-BOX'")).price_per_box,"37000");

const rollbackBatch=await verifiedStage("rollback.pdf",[row(1,"SYN-ROLLBACK-A","Synthetic rollback A"),row(2,"SYN-ROLLBACK-B","Synthetic rollback B")],"77777777-7777-4777-8777-777777777771");
await db.exec("reset role");
await db.exec(`create function test_step6_late_failure() returns trigger language plpgsql as $$begin if new.code='SYN-ROLLBACK-B' then raise exception using errcode='P0001',message='TEST_LATE_FAILURE';end if;return new;end$$;create trigger test_step6_late_failure_trigger before insert on products for each row execute function test_step6_late_failure()`);
await db.exec("set role authenticated");
await q("select set_config('app.uid','11111111-1111-4111-8111-111111111111',false)");
await expectDenied(()=>confirm(rollbackBatch,"77777777-7777-4777-8777-777777777772"),"P0001");assert.equal((await scalar("select count(*)::int n from products where code_normalized like 'SYN-ROLLBACK-%'")).n,0);assert.equal((await scalar("select crm_get_product_import($1) result",[rollbackBatch])).result.batch.status,"READY");

console.log("Product R2 STEP 6 integration PASS: source metadata gate, atomic CREATE/UPDATE/history, sparse optional fields, candidate acceptance, Manager attribution, applied retry/already-applied, create/update races and late rollback.");
await db.close();
