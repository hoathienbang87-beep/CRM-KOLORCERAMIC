import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {
  normalizeCrmCatalogProduct,
  crmProductLabel,
  crmProductPrice,
  crmProductWebsiteUrl,
  quoteSnapshotFromProduct,
  quoteSnapshotFromItem,
  encodeProductSnapshot,
  decodeProductSnapshot
} from "../js/features/crm-product-selector.js";

const root=process.cwd(),read=file=>fs.readFileSync(path.join(root,file),"utf8");
const app=read("js/features/crm-app.js"),selector=read("js/features/crm-product-selector.js"),firebase=read("js/firebase.js"),html=read("index.html"),css=read("css/styles.css"),rpc=read("supabase/migrations/20260924040300_catalog_integration_02b.sql");
let checks=0;function expect(label,condition){checks++;assert.ok(condition,`FAIL: ${label}`);}

const source={id:"p-08a",code:"SP-08A",name:"TRAVERTINO DARK GREY",width_mm:1200,height_mm:2400,surface:"MATT",price_per_m2:1915000,price_unit:"VND_M2",data_status:"READY",is_published:true,active:true,version:7};
const product=normalizeCrmCatalogProduct(source);
assert.equal(product.widthCm,"120");checks++;
assert.equal(product.heightCm,"240");checks++;
assert.match(crmProductLabel(product),/120 × 240 cm/);checks++;
assert.equal(crmProductPrice(product.pricePerM2),"1.915.000 ₫/m²");checks++;
assert.equal(crmProductWebsiteUrl(product,"https://crm.example.test"),"https://crm.example.test/?id=SP-08A");checks++;

const original=quoteSnapshotFromProduct(product);
const encoded=encodeProductSnapshot(original);
assert.deepEqual(decodeProductSnapshot(encoded),original);checks++;
const changed=normalizeCrmCatalogProduct({...source,price_per_m2:2250000,version:8});
const reopened=quoteSnapshotFromItem({id:"quote-item-1",productId:product.id,productSku:product.code,productName:product.name,unitPrice:1850000,...original},changed);
assert.equal(reopened.listPriceSnapshot,1915000,"catalog price change must not mutate stored quote snapshot");checks++;
assert.equal(reopened.catalogVersionSnapshot,7);checks++;
const reselection=quoteSnapshotFromProduct(changed);
assert.equal(reselection.listPriceSnapshot,2250000,"explicit reselection captures new catalog price");checks++;

expect("selector uses guarded CRM RPC",/rpc\("catalog_crm_search_products"/.test(selector));
expect("selector has no direct table read",!/\.from\s*\(/.test(selector));
expect("selector excludes inactive products",/product\.id && product\.active/.test(selector));
expect("RPC active employee gate",/crm_is_active_user/.test(rpc)&&/sale', 'manager', 'admin', 'owner/.test(rpc));
expect("RPC is authenticated only",/grant execute on function public\.catalog_crm_search_products\(text,integer\) to authenticated/.test(rpc));
expect("RPC anon revoked",/revoke all on function public\.catalog_crm_search_products\(text,integer\) from public, anon, authenticated/.test(rpc));
for(const field of ["width_mm_snapshot","height_mm_snapshot","surface_snapshot","list_price_snapshot"])expect(`quote DB mapping ${field}`,firebase.includes(`${field}:`));
expect("quote template stores encoded snapshot",/data-quote-product-snapshot/.test(app));
expect("quote collection reads stored snapshot",/decodeProductSnapshot\(row\.querySelector\("\[data-quote-product-snapshot\]/.test(app));
expect("quote to order preserves snapshots",/function quoteOrderItems[\s\S]*widthMmSnapshot[\s\S]*listPriceSnapshot/.test(app));
expect("order normalization preserves snapshots",/function normalizedDealItem[\s\S]*catalogVersionSnapshot/.test(app));
expect("proposal selector",/data-product-selector-context="proposal"/.test(app));
expect("quote selector",/data-product-selector-context="quote"/.test(app));
expect("order selector",/data-product-selector-context="deal"/.test(app));
expect("inventory adapter selector",/data-product-selector-context=\\?"inventory/.test(app));
for(const id of ["need","editNeed","careNeed"])expect(`interest selector ${id}`,new RegExp(`data-product-input=["']${id}["']`).test(html));
expect("interest product association persisted",/needProductSnapshot/.test(app)&&/needProductId/.test(app));
expect("website buttons use canonical query",/searchParams\.set\("id", identifier\)/.test(selector));
expect("noopener website links",/noopener noreferrer/.test(selector)&&/window\.open\(url, "_blank", "noopener"\)/.test(app));
expect("Vietnamese thousand grouping",/Intl\.NumberFormat\("vi-VN"/.test(selector));
expect("desktop selector layout",/\.crm-product-selector-card\{display:grid;grid-template-columns:/.test(css));
expect("mobile selector layout",/@media\(max-width:768px\)[\s\S]*\.crm-product-selector-card\{grid-template-columns:1fr/.test(css));
expect("no production project reference",!/jjeeazwlqcwynzquimeo/.test(selector+app+html+css));

console.log(`PASS: CRM product selector 08A static contract (${checks} checks).`);
