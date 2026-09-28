import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {CRM_NAV_ITEMS, CRM_HASH_ROUTES, workspaceForHash} from "../js/components/app-shell.js";

const root=process.cwd(),read=file=>fs.readFileSync(path.join(root,file),"utf8");
const app=read("js/features/crm-app.js"),shell=read("js/components/app-shell.js"),html=read("index.html");
const access=read("supabase/migrations/20260924040300_catalog_integration_02b.sql");
const adminSql=read("supabase-phase-catalog-integration-06a-admin-catalog.sql");
const adminApi=read("js/admin/catalog-admin-api.js");
let checks=0;const expect=(label,value)=>{checks++;assert.ok(value,`FAIL: ${label}`);};

expect("Product nav removed",!CRM_NAV_ITEMS.some(item=>item.id==="products"));
expect("Product hash removed",!("#/products" in CRM_HASH_ROUTES));
expect("stale Product hash falls back",workspaceForHash("#/products").hash==="#/overview");
const adminItem=CRM_NAV_ITEMS.find(item=>item.id==="admin");
expect("admin target /admin",adminItem?.path==="/admin");
expect("admin target owner/admin gated",adminItem?.capability==="admin");
expect("admin navigation is explicit",adminItem?.label==="Quản lý catalog");

for(const token of ["productsPanel","productDrawer","addProductBtn","productImportView","productImportFile"])
  expect(`retired DOM ${token}`,!html.includes(`id="${token}"`));
for(const token of ["openProductDrawer","saveProductDrawer","toggleProductActive","renderProducts","createProductImportController","uploadProductImportSource"])
  expect(`retired CRM runtime ${token}`,!app.includes(token));
for(const rpc of ["crm_create_product","crm_update_product","crm_set_product_active","crm_list_product_price_history"])
  expect(`no CRM mutation ${rpc}`,!app.includes(rpc));

expect("read adapter retained",/callCrmRpc\("crm_list_products"/.test(app));
expect("canonical row adapter retained",/rows\.map\(productFromCanonical\)/.test(app));
expect("quote datalist retained",html.includes('id="productOptions"')&&app.includes("renderProductOptions"));
expect("inventory hydration retained",app.includes("hydrateInventoryProductOptions"));
expect("stock reporting retained",app.includes("productStockText"));
for(const context of ["quote","deal","proposal","inventory"])
  expect(`selector context ${context}`,app.includes(`data-product-selector-context="${context}"`));
for(const id of ["need","editNeed","careNeed"])
  expect(`interest selector ${id}`,new RegExp(`data-product-input="${id}"`).test(html));
for(const field of ["widthMmSnapshot","heightMmSnapshot","surfaceSnapshot","listPriceSnapshot","catalogVersionSnapshot"])
  expect(`business snapshot ${field}`,app.includes(field));

for(const signature of ["crm_create_product\\(jsonb\\)","crm_update_product\\(uuid,bigint,jsonb\\)","crm_set_product_active\\(uuid,bigint,boolean\\)"])
  expect(`authenticated revoke ${signature}`,new RegExp(`revoke all on function public\\.${signature} from public, anon, authenticated`,"i").test(access));
expect("admin RPC role guard",/catalog_admin_update_product_v1[\s\S]*?catalog_require_admin_02b\(\)/i.test(adminSql));
expect("admin app owner/admin guard",/new Set\(\["admin", "owner"\]\)/.test(adminApi));
expect("sale role absent from admin guard",!/new Set\(\[[^\]]*"sale"/.test(adminApi));
expect("no production project ref",!/jjeeazwlqcwynzquimeo/.test(app+shell+html));

console.log(`PASS: CRM catalog retirement 08B static contract (${checks} checks).`);
