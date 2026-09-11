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
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };

check(/id: "products"[^\n]*hash: "#\/products"/.test(shell), "Giữ canonical Product route");
check(html.includes('id="productsPanel"'), "Giữ Product panel trong CRM-UI-R1 shell");
for (const id of [
  "productWidthCmInput","productHeightCmInput","productPricePerM2Input",
  "productPricePerBoxInput","productPricePerPieceInput","productPiecesPerBoxInput",
  "productSqmPerBoxInput","productPriceEffectiveDateInput","productCreatedByText",
  "productCreatedAtText","productUpdatedByText","productUpdatedAtText","productHistoryList"
]) check(html.includes(`id="${id}"`), `Có UI R2 ${id}`);
check(!html.includes('id="productSizeInput"') && !html.includes('id="productPriceInput"'), "Đã retire input R1");
check(/<th>Giá\/m²<\/th>/.test(html) && /Giá\/hộp/.test(html) && /Giá\/viên/.test(html), "Price labels có unit rõ ràng");
check(!/xóa sản phẩm|deleteProduct/i.test(html + app), "Không có hard-delete Product UI");

const productRuntime = app.slice(app.indexOf("// PRODUCT-R2:"), app.indexOf("const quoteStatusOptions"));
for (const rpc of ["crm_list_products","crm_create_product","crm_update_product","crm_set_product_active","crm_list_product_price_history"])
  check(productRuntime.includes(rpc), `Runtime dùng ${rpc}`);
check(productRuntime.includes('const canEditProduct = () => ["sale","manager","admin","owner"]'), "Sale được create/update trên UI");
check(/!p \|\| !isManager\(\)/.test(productRuntime), "Archive control chỉ Manager+");
check(productRuntime.includes("p_expected_version:productDrawerOriginal.version"), "Update gửi expected version");
check(productRuntime.includes("Không có thay đổi để lưu"), "UI no-op không gửi mutation");
check(productRuntime.includes("createdByName") && productRuntime.includes("updatedByName"), "Hiển thị actor create/update");
check(productRuntime.includes("crm_list_product_price_history"), "Hiển thị history qua RPC");

check(app.includes("selected?.pricePerM2") && app.includes('unit: selected ? "m²" : ""'), "Quote dùng R2 price_per_m2 và unit m²");
check(!/product\?\.price\b|selected\?\.price\b/.test(app), "Không còn Product R1 default price consumer");
check(app.includes("product?.stockQuantity") && !productRuntime.includes("inventoryMovements.reduce"), "Stock Product không tính từ ledger");
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
check(sql.includes("crm_update_product(uuid,bigint,jsonb)"), "Canonical update signature");
check(sql.includes("public.crm_current_app_user_id()"), "Actor server-side");
check(!sql.includes("crm_stage_product_import") && !sql.includes("crm_confirm_product_import"), "Không expose import RPC chưa hoàn chỉnh");
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
console.log(`Product R2 static/helper PASS (${checks} checks).`);
