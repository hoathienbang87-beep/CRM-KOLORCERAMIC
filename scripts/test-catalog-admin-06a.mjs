import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const migration=read("supabase-phase-catalog-integration-06a-admin-catalog.sql");
const rollback=read("supabase-phase-catalog-integration-06a-rollback.sql");
const runtime=read("scripts/test-catalog-06a-staging.sql");
const rollbackRuntime=read("scripts/test-catalog-06a-staging-rollback.sql");
const html=read("admin/index.html");
const css=read("css/catalog-admin.css");
const api=read("js/admin/catalog-admin-api.js");
const app=read("js/admin/catalog-admin-app.js");
const bootstrap=read("js/admin/catalog-admin-bootstrap.js");
let checks=0;
function expect(label,condition){checks++;if(!condition)throw new Error(`FAIL: ${label}`);}

const functions=[
  ["catalog_admin_product_json_v1_06a","uuid"],
  ["catalog_admin_list_products_v1","text,text,boolean,boolean,integer,integer"],
  ["catalog_admin_update_product_v1","uuid,bigint,jsonb"],
  ["catalog_admin_set_product_state_v1","uuid,bigint,boolean,boolean"]
];
for(const [name,signature] of functions){
  expect(`${name} created`,new RegExp(`create function public\\.${name}\\b`,`i`).test(migration));
  expect(`${name} security definer`,new RegExp(`create function public\\.${name}[\\s\\S]*?security definer`,`i`).test(migration));
  expect(`${name} pinned search path`,new RegExp(`create function public\\.${name}[\\s\\S]*?set search_path = pg_catalog, public`,`i`).test(migration));
  expect(`${name} revoked from anon`,new RegExp(`revoke all on function public\\.${name}\\(${signature.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\) from public, anon, authenticated;`,`i`).test(migration));
  expect(`${name} rollback`,new RegExp(`drop function public\\.${name}\\b`,`i`).test(rollback));
}
expect("list is stable",/catalog_admin_list_products_v1[\s\S]*?stable[\s\S]*?security definer/i.test(migration));
expect("list uses admin guard",/catalog_admin_list_products_v1[\s\S]*?perform public\.catalog_require_admin_02b\(\)/i.test(migration));
expect("update uses admin guard",/v_actor text := public\.catalog_require_admin_02b\(\)/i.test(migration));
expect("list search",/position\(v_search in p\.name_normalized\)/i.test(migration));
for(const filter of ["p_data_status","p_active","p_is_published"])expect(`list filter ${filter}`,new RegExp(filter).test(migration));
expect("bounded pagination",/p_limit < 1 or p_limit > 100[\s\S]*?p_offset < 0 or p_offset > 100000/i.test(migration));
expect("total returned",/'total', \(select count\(\*\) from filtered\)/i.test(migration));
expect("has_more returned",/'has_more'/i.test(migration));
expect("version conflict",/v_old\.version <> p_expected_version[\s\S]*?40001/i.test(migration));
expect("update allowlist",/FIELD_NOT_ALLOWED/i.test(migration));
expect("dimension pair",/DIMENSION_PAIR_REQUIRED/i.test(migration));
expect("name required",/NAME_REQUIRED/i.test(migration));
expect("price validation",/INVALID_PRICE/i.test(migration));
expect("safety unpublish",/v_unpublish := p_changes \?\| array\[[^\]]*'price_per_m2'/i.test(migration));
expect("price history",/insert into public\.product_price_history/i.test(migration));
expect("manual source",/'MANUAL', v_actor, 'Catalog admin 06A'/i.test(migration));
expect("update audit",/catalogAdminUpdate06A/i.test(migration));
expect("state audit",/catalogAdminState06A/i.test(migration));
expect("publish gate",/p_is_published and \(not p_active or v_old\.data_status <> 'READY'\)/i.test(migration));
expect("no authenticated table writes",/has_table_privilege\('authenticated','public\.products','INSERT,UPDATE,DELETE,TRUNCATE'\)/i.test(migration));
expect("only admin APIs granted",(migration.match(/grant execute on function public\.catalog_admin_/gi)||[]).length===3);
expect("transactional migration",/(?:^|\n)begin;[\s\S]*notify pgrst, 'reload schema';\s*commit;\s*$/i.test(migration.trim()));
expect("transactional rollback",/(?:^|\n)begin;[\s\S]*commit;\s*$/i.test(rollback.trim()));

for(const id of ["adminLoginView","adminDeniedView","adminWorkspace","adminFilters","adminProductRows","adminProductCards","adminProductDrawer","adminImagePreview","adminSaveState","adminToast"])
  expect(`html #${id}`,new RegExp(`id=["']${id}["']`).test(html));
expect("dedicated admin stylesheet",/catalog-admin\.css/.test(html));
expect("dedicated admin bootstrap",/catalog-admin-bootstrap\.js/.test(html));
expect("no CRM app entry",!/js\/app\.js|crm-app\.js/.test(html));
expect("no product image upload input",!/id=["']adminImage[^"']*["'][^>]+type=["']file["']/i.test(html));
expect("external URL note",/không tải ảnh lên Supabase Storage/i.test(html));
expect("auth form",/id="adminLoginForm"[\s\S]*type="password"/i.test(html));
expect("responsive desktop/mobile",/@media\(max-width:820px\)/.test(css)&&/\.product-cards\{display:grid/.test(css));
expect("drawer responsive",/@media\(max-width:820px\)[\s\S]*\.drawer\{width:100%\}/.test(css));
expect("focus styles",/:focus/.test(css));

expect("API only admin owner",/new Set\(\["admin", "owner"\]\)/.test(api));
expect("API active lifecycle guard",/lifecycle === "active"/.test(api));
expect("API profile via auth id",/\.eq\("supabase_auth_id", authUserId\)/.test(api));
for(const rpc of ["catalog_admin_list_products_v1","catalog_admin_update_product_v1","catalog_admin_set_product_state_v1"])
  expect(`API calls ${rpc}`,api.includes(`"${rpc}"`));
expect("price parses Vietnamese grouping",/replace\(\/\[\.\\s\]\/g, ""\)/.test(api));
expect("price formats vi-VN",/Intl\.NumberFormat\("vi-VN"\)/.test(api));
expect("HTTPS only",/url\.protocol !== "https:"/.test(api));
expect("no service role",!/service[_-]?role/i.test(html+css+api+app+bootstrap));
expect("app auth guard",/isAdminProfile\(profile\)/.test(app));
expect("app separate state",/const state = \{profile:null,products:\[\]/.test(app));
expect("app list rendering",/function renderProducts\(\)/.test(app));
expect("app image fallback",/function attachImageFallbacks/.test(app)&&/image\.onerror/.test(app));
expect("app optimistic version",/api\.update\(state\.selected\.id,state\.selected\.version,changes\)/.test(app));
expect("app publish readiness guard",/state\.selected\.data_status !== "READY"/.test(app));
expect("app keyboard escape",/event\.key==="Escape"/.test(app));
expect("bootstrap imports shared anon client",/import \{ supabase \} from "\.\.\/firebase\.js"/.test(bootstrap));

expect("runtime baseline guarded",/expected post-05B staging baseline 123\/75\/0/i.test(runtime));
for(const label of ["admin list/pagination","filters","content update/read-back","price history","version conflict","HTTPS image constraint","publish state","archive state","publish readiness gate","audit before/after","sale role guard","anon execute denial","fixture rollback residue"])
  expect(`runtime ${label}`,new RegExp(`CATALOG_06A_TEST_FAIL: ${label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}`,"i").test(runtime));
expect("runtime self rollback",/rollback;[\s\S]*Independent|rollback;[\s\S]*fixture rollback residue/i.test(runtime));
expect("rollback preserves 05A",/catalog_public_list_products_v1/.test(rollbackRuntime));
expect("rollback preserves 05B",/catalog_submit_website_lead_v1/.test(rollbackRuntime));
expect("rollback self reverts",/rehearsal was not fully reverted/i.test(rollbackRuntime));

console.log(`PASS: Catalog 06A admin static checks (${checks} checks).`);
