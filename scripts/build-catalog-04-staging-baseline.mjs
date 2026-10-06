import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";

const snapshotPath=process.argv[2];
const outputPath=process.argv[3];
assert.ok(snapshotPath&&outputPath,"Usage: node scripts/build-catalog-04-staging-baseline.mjs <products.json> <output.sql>");

const source=readFileSync(snapshotPath);
const checksum=createHash("sha256").update(source).digest("hex");
assert.equal(checksum,"1a73ec6f51c63c482e02b49999e075b500846716de11029410ebd191f560a580","Unexpected Product snapshot checksum");

const snapshot=JSON.parse(source.toString("utf8"));
const rows=snapshot.rows;
assert.ok(Array.isArray(rows));
assert.equal(rows.length,75,"Expected exactly 75 Product rows");

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
assert.ok(rows.every(row=>uuid.test(row.id)),"Snapshot contains a non-UUID Product ID");
assert.equal(new Set(rows.map(row=>row.id)).size,75,"Product IDs must be unique");

const actorIds=[...new Set(rows.flatMap(row=>[row.created_by_user_id,row.updated_by_user_id]).filter(Boolean))];
const actors=actorIds.map((id,index)=>({
  id,
  email:`snapshot-actor-${index+1}@staging.invalid`,
  name:`Snapshot Actor ${index+1}`,
  role:"admin",
  active:true,
  lifecycle_status:"active"
}));

const columns=[
  "id","code","name","width_cm","height_cm","price_per_m2",
  "price_per_box","price_per_piece","pieces_per_box","sqm_per_box",
  "surface","origin","stock_quantity","price_effective_date","active",
  "version","created_at","created_by_user_id","updated_at","updated_by_user_id"
];
const products=rows.map(row=>Object.fromEntries(columns.map(column=>[column,row[column]])));
const actorJson=JSON.stringify(actors);
const productJson=JSON.stringify(products);
for(const [label,value] of [["actors",actorJson],["products",productJson]]){
  assert.equal(value.includes("$catalog04$"),false,`${label} contains reserved SQL dollar tag`);
}

const sql=`-- Prompt 04 staging-only Product baseline generated from the approved snapshot.
begin;

select pg_advisory_xact_lock(hashtext('CATALOG-INTEGRATION-04-STAGING-BASELINE-75'));

do $$
begin
  if to_regclass('public.product_source_mappings') is null
     or to_regclass('public.website_leads') is null
     or to_regprocedure('public.catalog_admin_preview_import(jsonb,jsonb)') is null
     or to_regprocedure('public.catalog_admin_approve_import(uuid,uuid)') is null then
    raise exception 'CATALOG_04_BASELINE_PRECONDITION_FAIL: 01B/02B/03B schema is incomplete.';
  end if;

  if exists (select 1 from public.products)
     or exists (select 1 from public.product_import_batches)
     or exists (select 1 from public.product_import_rows)
     or exists (select 1 from public.product_price_history)
     or exists (select 1 from public.product_source_mappings)
     or exists (select 1 from public.website_leads) then
    raise exception 'CATALOG_04_BASELINE_PRECONDITION_FAIL: catalog staging tables must be empty.';
  end if;
end;
$$;

insert into public.app_users(id,email,name,role,active,lifecycle_status)
select id,email,name,role,active,lifecycle_status
from jsonb_to_recordset($catalog04$${actorJson}$catalog04$::jsonb) as x(
  id text,email text,name text,role text,active boolean,lifecycle_status text
)
on conflict (id) do nothing;

insert into public.products(
  id,code,name,width_cm,height_cm,price_per_m2,price_per_box,price_per_piece,
  pieces_per_box,sqm_per_box,surface,origin,stock_quantity,price_effective_date,
  active,version,created_at,created_by_user_id,updated_at,updated_by_user_id
)
select
  id,code,name,width_cm,height_cm,price_per_m2,price_per_box,price_per_piece,
  pieces_per_box,sqm_per_box,surface,origin,stock_quantity,price_effective_date,
  active,version,created_at,created_by_user_id,updated_at,updated_by_user_id
from jsonb_to_recordset($catalog04$${productJson}$catalog04$::jsonb) as x(
  id uuid,code text,name text,width_cm numeric(9,3),height_cm numeric(9,3),
  price_per_m2 numeric(18,0),price_per_box numeric(18,0),price_per_piece numeric(18,0),
  pieces_per_box integer,sqm_per_box numeric(12,4),surface text,origin text,
  stock_quantity numeric(18,4),price_effective_date date,active boolean,version bigint,
  created_at timestamptz,created_by_user_id text,updated_at timestamptz,updated_by_user_id text
);

do $$
declare
  v_expected jsonb := $catalog04$${productJson}$catalog04$::jsonb;
begin
  if (select count(*) from public.products) <> 75
     or (select count(*) from public.products where data_status='READY') <> 75
     or (select count(*) from public.products where is_published) <> 0 then
    raise exception 'CATALOG_04_BASELINE_VERIFY_FAIL: expected 75 READY and 0 published Products.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_expected) e(
      id uuid,code text,name text,width_cm numeric,height_cm numeric,
      price_per_m2 numeric,price_effective_date date,version bigint
    )
    full join public.products p on p.id=e.id
    where e.id is null or p.id is null
       or p.code is distinct from e.code
       or p.name is distinct from e.name
       or p.width_cm is distinct from e.width_cm
       or p.height_cm is distinct from e.height_cm
       or p.price_per_m2 is distinct from e.price_per_m2
       or p.price_effective_date is distinct from e.price_effective_date
       or p.version is distinct from e.version
  ) then
    raise exception 'CATALOG_04_BASELINE_VERIFY_FAIL: Product identity or baseline value mismatch.';
  end if;
end;
$$;

commit;
`;

writeFileSync(outputPath,sql,{encoding:"utf8",flag:"wx"});
console.log(JSON.stringify({output:outputPath,products:products.length,actors:actors.length,source_sha256:checksum}));
