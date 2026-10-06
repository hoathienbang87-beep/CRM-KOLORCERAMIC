import fs from "node:fs";

const snapshotPath = "D:/SUPABASE/BACKUPS/CRM-KOLORCERAMIC/2026-09-22_13-13-13/supabase/products.json";
const rows = JSON.parse(fs.readFileSync(snapshotPath, "utf8")).rows;

if (!Array.isArray(rows) || rows.length !== 75) {
  throw new Error(`Expected exactly 75 Supabase Product rows, got ${rows?.length ?? "invalid"}.`);
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!rows.every((row) => uuid.test(row.id))) {
  throw new Error("Snapshot contains a non-UUID Product ID.");
}

const actorIds = [...new Set(rows.flatMap((row) => [row.created_by_user_id, row.updated_by_user_id]))]
  .filter(Boolean);
const actors = actorIds.map((id, index) => ({
  id,
  email: `snapshot-actor-${index + 1}@local.invalid`,
  name: `Snapshot Actor ${index + 1}`,
  role: "admin",
  active: true,
  lifecycle_status: "active"
}));

const productColumns = [
  "id", "code", "name", "width_cm", "height_cm", "price_per_m2",
  "price_per_box", "price_per_piece", "pieces_per_box", "sqm_per_box",
  "surface", "origin", "stock_quantity", "price_effective_date", "active",
  "version", "created_at", "created_by_user_id", "updated_at", "updated_by_user_id"
];
const products = rows.map((row) => Object.fromEntries(productColumns.map((column) => [column, row[column]])));

const actorJson = JSON.stringify(actors);
const productJson = JSON.stringify(products);
for (const [label, value] of [["actors", actorJson], ["products", productJson]]) {
  if (value.includes("$catalog02a$")) throw new Error(`${label} contains reserved SQL dollar tag.`);
}

process.stdout.write(`
\\set ON_ERROR_STOP on
begin;

insert into public.app_users(id,email,name,role,active,lifecycle_status)
select id,email,name,role,active,lifecycle_status
from jsonb_to_recordset($catalog02a$${actorJson}$catalog02a$::jsonb) as x(
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
from jsonb_to_recordset($catalog02a$${productJson}$catalog02a$::jsonb) as x(
  id uuid,code text,name text,width_cm numeric(9,3),height_cm numeric(9,3),
  price_per_m2 numeric(18,0),price_per_box numeric(18,0),price_per_piece numeric(18,0),
  pieces_per_box integer,sqm_per_box numeric(12,4),surface text,origin text,
  stock_quantity numeric(18,4),price_effective_date date,active boolean,version bigint,
  created_at timestamptz,created_by_user_id text,updated_at timestamptz,updated_by_user_id text
);

do $$
begin
  if (select count(*) from public.products) <> 75 then
    raise exception 'CATALOG_02A_BASELINE_FAIL: expected 75 Products.';
  end if;
end;
$$;

commit;
`);
