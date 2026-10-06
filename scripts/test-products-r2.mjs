import fs from "node:fs";
import assert from "node:assert/strict";
import {
  productDecimal,
  productDate,
  productQuantity,
  productMoney,
  productSizeLabel,
  productFromCanonical,
  productChanges,
  productError
} from "../js/features/product-catalog.js";

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const app = read("js/features/crm-app.js");
const adapter = read("js/features/product-catalog.js");
const firebase = read("js/firebase.js");
const html = read("index.html");
const shell = read("js/components/app-shell.js");
const sql = read("supabase-phase-product-r2-clean-rebuild.sql");
const accessSql = read("supabase/migrations/20260924040300_catalog_integration_02b.sql");
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };

check(!/id: "products"[^\n]*hash: "#\/products"/.test(shell), "Product management route đã retire khỏi CRM");
check(!html.includes('id="productsPanel"') && !html.includes('id="productDrawer"'), "Product management DOM đã retire khỏi CRM");
check(!/crm_(create_product|update_product|set_product_active)/.test(app), "CRM runtime không còn gọi Product mutation RPC");
check(/callCrmRpc\("crm_list_products"/.test(app), "CRM giữ read adapter cho nghiệp vụ");
check(["quote","deal","proposal","inventory"].every(context => app.includes(`data-product-selector-context="${context}"`)), "CRM giữ product selector nghiệp vụ");
check(/path: "\/admin"[^\n]*capability: "admin"/.test(shell), "Owner/admin được hướng sang /admin");
for (const signature of ["crm_create_product\\(jsonb\\)", "crm_update_product\\(uuid,bigint,jsonb\\)", "crm_set_product_active\\(uuid,bigint,boolean\\)"])
  check(new RegExp(`revoke all on function public\\.${signature} from public, anon, authenticated`, "i").test(accessSql), `Legacy mutation ${signature} bị revoke`);
check(!/xóa sản phẩm|deleteProduct/i.test(html + app), "Không có hard-delete Product UI");

check(app.includes("selected?.pricePerM2") && app.includes('unit: selected ? "m²" : ""'), "Quote dùng R2 price_per_m2 và unit m²");
check(!/product\?\.price\b|selected\?\.price\b/.test(app), "Không còn Product R1 default price consumer");
check(app.includes("product?.stockQuantity"), "Kho và báo cáo giữ stock adapter");
check(!/normalizeKey\(item\.name\) === normalizeKey\(p\.name\)/.test(app), "Không match historical deal bằng Product name");

const productMap = firebase.slice(firebase.indexOf('case "products":'), firebase.indexOf('case "kpiRules":'));
for (const field of ["width_cm","height_cm","price_per_m2","price_per_box","price_per_piece","price_effective_date","created_by_user_id","updated_by_user_id"])
  check(productMap.includes(field), `Firebase adapter biết ${field}`);
check(!/\bsku:|\bprice:|\bunit:|raw_data/.test(productMap), "Product adapter không có legacy alias");
check(!/\bsku:|\bprice:|\bsize:|raw_data/.test(adapter), "Product helper không có legacy alias");

check(sql.includes("delete from public.products"), "Migration retire 404 legacy rows");
check(sql.includes("alter column id type uuid"), "Migration dùng native UUID");
check(sql.includes("code_normalized text generated always"), "Generated normalized code");
check(sql.includes("product_price_history"), "Có immutable Product price history");
check(sql.includes("product_price_history_immutable"), "History update/delete bị chặn");
check(sql.includes("crm_update_product(uuid,bigint,jsonb)"), "Canonical update signature vẫn tồn tại để rollback lịch sử");
check(sql.includes("public.crm_current_app_user_id()"), "Actor server-side");
check(!sql.includes("crm_stage_product_import") && !sql.includes("crm_confirm_product_import"), "Không expose import RPC chưa hoàn chỉnh ở migration R2");
check(/revoke all on public\.products from anon, authenticated/.test(sql), "Direct Product write bị revoke");

assert.equal(productDecimal("007.500", {scale:3,allowZero:false,label:"Size"}), "7.5"); checks++;
assert.equal(productDecimal("0", {nullable:true,scale:4,allowZero:true,label:"Stock"}), "0"); checks++;
assert.equal(productDecimal("", {nullable:true}), null); checks++;
for (const value of ["-1","NaN","Infinity","1,5","1e3","1.2345"])
  assert.throws(() => productDecimal(value, {scale:3,allowZero:false,label:"Size"})), checks++;
assert.equal(productDate("2026-09-03"), "2026-09-03"); checks++;
assert.throws(() => productDate("2026-02-31")); checks++;
assert.equal(productQuantity(null), "Chưa cập nhật"); checks++;
assert.equal(productQuantity("0.0000"), "0"); checks++;
assert.equal(productMoney("1094400"), "1.094.400 ₫"); checks++;

const row = productFromCanonical({
  id:"ca6d43f6-e3aa-4263-80d8-163b6469b6ef",code:"R2-A",name:"Gạch R2",
  width_cm:"7.500",height_cm:"30.000",price_per_m2:"760000",price_per_box:null,
  price_per_piece:null,pieces_per_box:null,sqm_per_box:null,surface:null,origin:null,
  stock_quantity:null,price_effective_date:"2026-09-03",active:true,version:1,
  created_at:"2026-09-11T00:00:00Z",created_by_user_id:"u1",created_by_name:"Sale Test",
  updated_at:"2026-09-11T00:00:00Z",updated_by_user_id:"u1",updated_by_name:"Sale Test"
});
assert.equal(productSizeLabel(row), "7.5 × 30 cm"); checks++;
assert.equal(row.stockQuantity, null); checks++;
assert.equal(row.createdByName, "Sale Test"); checks++;
check(!("price" in row) && !("sku" in row) && !("size" in row) && !("rawData" in row), "Canonical row không có alias R1");

const unchanged = productChanges({
  code:"R2-A",name:"Gạch R2",width_cm:"7.5",height_cm:"30",
  price_per_m2:"760000",price_per_box:"",price_per_piece:"",pieces_per_box:"",
  sqm_per_box:"",surface:"",origin:"",stock_quantity:"",price_effective_date:"2026-09-03"
}, row);
assert.deepEqual(unchanged, {}); checks++;
const clearOptional = productChanges({
  code:"R2-A",name:"Gạch R2",width_cm:"7.5",height_cm:"30",
  price_per_m2:"760000",price_per_box:"",price_per_piece:"",pieces_per_box:"",
  sqm_per_box:"",surface:"",origin:"",stock_quantity:"0",price_effective_date:"2026-09-03"
}, row);
assert.deepEqual(clearOptional, {stock_quantity:"0"}); checks++;
assert.equal(productError({code:"40001"}).includes("tải lại"), true); checks++;
assert.equal(productError({message:"SQL secret"}), "Không thể lưu thay đổi."); checks++;

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
check(new Set(ids).size === ids.length, "HTML IDs unique");
console.log(`Product R2 helper/read-adapter regression PASS (${checks} checks).`);
