import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import process from "node:process";
import {buildCatalogImportPreview,parseCatalogExcelWorkbook} from "../js/product-import/index.js";

let input="";
for await(const chunk of process.stdin) input+=chunk;
const products=JSON.parse(input);
assert.equal(products.length,3,"03B fixture requires exactly three local products");

function workbook(rows){
  const sheet={"!ref":`A1:F${rows.length+1}`};
  const put=(ref,value)=>{if(value!==null&&value!==undefined) sheet[ref]={v:value};};
  ["PRODUCT ID","SKU","PRODUCT NAME","KÍCH THƯỚC (MM)","SURFACE","PRICE PER M2"].forEach((value,index)=>put(`${String.fromCharCode(65+index)}1`,value));
  rows.forEach((row,index)=>row.forEach((value,col)=>put(`${String.fromCharCode(65+col)}${index+2}`,value)));
  return {SheetNames:["03B Fixture"],Sheets:{"03B Fixture":sheet}};
}

const row=p=>[p.id,p.code,p.name,`${p.width_mm}x${p.height_mm}`,p.surface,p.price_per_m2];
const metadata=(suffix,mode)=>({
  supplier:"03B Local Fixture",
  source_filename:`catalog-03b-${suffix}.xlsx`,
  source_sha256:createHash("sha256").update(suffix).digest("hex"),
  source_file_size_bytes:1000+suffix.length,
  parser_adapter:`CATALOG_03A_${suffix.toUpperCase()}`,
  parser_version:"1.0.0",
  effective_date:"2026-09-24",
  import_mode:mode,
  source_format:"EXCEL",
  source_metadata:{fixture:true,case:suffix}
});

function payload(suffix,mode,rows){
  const parsed=parseCatalogExcelWorkbook(workbook(rows));
  assert.equal(parsed.ok,true,`${suffix} workbook must parse`);
  return buildCatalogImportPreview({batch:metadata(suffix,mode),rows:parsed.rows,products});
}

const readyPrice=String(Number(products[0].price_per_m2)+1000);
const ready=payload("a-ready","PRICE_UPDATE_ONLY",[
  [...row(products[0]).slice(0,5),readyPrice],
  [...row(products[0]).slice(0,5),readyPrice],
  [...row(products[1]).slice(0,5),null]
]);
const conflict=payload("b-conflict","PRICE_UPDATE_ONLY",[
  [...row(products[0]).slice(0,5),Number(products[0].price_per_m2)+2000],
  [...row(products[0]).slice(0,5),Number(products[0].price_per_m2)+3000]
]);
const retry=payload("c-retry","PRICE_UPDATE_ONLY",[
  [...row(products[2]).slice(0,5),Number(products[2].price_per_m2)+1000]
]);
const catalog=payload("d-catalog","CATALOG_IMPORT",[
  [null,"LOCAL-03B-READY","LOCAL 03B READY","800x800","POLISH",700000],
  [null,"LOCAL-03B-DRAFT","LOCAL 03B DRAFT","600x1200","MATT",null]
]);

const template=await readFile(new URL("./test-catalog-03b-local-integration.sql",import.meta.url),"utf8");
const literal=value=>`$fixture$${JSON.stringify(value)}$fixture$::jsonb`;
const replacements={
  "__BASELINE_JSON__":literal(products),
  "__READY_BATCH__":literal(ready.batch),"__READY_ROWS__":literal(ready.rows),
  "__CONFLICT_BATCH__":literal(conflict.batch),"__CONFLICT_ROWS__":literal(conflict.rows),
  "__RETRY_BATCH__":literal(retry.batch),"__RETRY_ROWS__":literal(retry.rows),
  "__CATALOG_BATCH__":literal(catalog.batch),"__CATALOG_ROWS__":literal(catalog.rows)
};
let output=template;
for(const [token,value] of Object.entries(replacements)) output=output.replaceAll(token,value);
assert.equal(/__[A-Z_]+__/.test(output),false,"all SQL template tokens must be replaced");
process.stdout.write(output);
