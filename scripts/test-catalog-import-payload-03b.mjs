import assert from "node:assert/strict";
import {buildCatalogImportPreview,parseCatalogExcelWorkbook} from "../js/product-import/index.js";

let checks=0;
const equal=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const truthy=(actual,message)=>{assert.ok(actual,message);checks++;};

function workbook(rows){
  const sheet={"!ref":`A1:F${rows.length+1}`};
  const put=(ref,value)=>{if(value!==null&&value!==undefined) sheet[ref]={v:value};};
  ["PRODUCT ID","SKU","PRODUCT NAME","KÍCH THƯỚC (MM)","SURFACE","PRICE PER M2"].forEach((value,index)=>put(`${String.fromCharCode(65+index)}1`,value));
  rows.forEach((row,index)=>{
    const n=index+2;
    row.forEach((value,col)=>put(`${String.fromCharCode(65+col)}${n}`,value));
  });
  return {SheetNames:["Fixture"],Sheets:{Fixture:sheet}};
}

const products=[
  {id:"00000000-0000-4000-8000-000000000101",code:"SKU-101",name:"STONE GREY",width_mm:600,height_mm:1200,surface:"MATT",price_per_m2:500000,version:7},
  {id:"00000000-0000-4000-8000-000000000102",code:"SKU-102",name:"STONE BEIGE",width_mm:600,height_mm:600,surface:"POLISH",price_per_m2:450000,version:3}
];
const meta={supplier:"03B",source_filename:"fixture.xlsx",source_sha256:"a".repeat(64),source_file_size_bytes:100,parser_adapter:"CATALOG_03A",parser_version:"1",effective_date:"2026-09-24",source_format:"EXCEL"};

const ready=parseCatalogExcelWorkbook(workbook([
  [products[0].id,products[0].code,products[0].name,"600x1200",products[0].surface,501000],
  [products[0].id,products[0].code,products[0].name,"600x1200",products[0].surface,"501.000"],
  [products[1].id,products[1].code,products[1].name,"600x600",products[1].surface,null]
]));
truthy(ready.ok,"fixture parses");
const price=buildCatalogImportPreview({batch:{...meta,import_mode:"PRICE_UPDATE_ONLY"},rows:ready.rows,products});
equal(price.rows.length,3,"all parser rows reach RPC payload");
equal([price.rows[0].classification,price.rows[0].selected_action],["CHANGED","UPDATE"],"matched changed price updates");
equal([price.rows[1].classification,price.rows[1].selected_action,price.rows[1].conflict_code],["DUPLICATE_IN_FILE","SKIP","IDENTICAL_VARIANT_PRICE"],"same-price duplicate collapses deterministically");
equal([price.rows[2].classification,price.rows[2].selected_action,price.rows[2].disposition],["UNCHANGED","SKIP","MISSING_PRICE"],"blank price skips without overwrite");
equal(price.rows[0].proposed_snapshot,{price_per_m2:"501000",price_effective_date:"2026-09-24"},"price-only payload whitelists price fields");

const conflicting=parseCatalogExcelWorkbook(workbook([
  [products[0].id,products[0].code,products[0].name,"600x1200",products[0].surface,501000],
  [products[0].id,products[0].code,products[0].name,"600x1200",products[0].surface,502000]
]));
const conflict=buildCatalogImportPreview({batch:{...meta,source_sha256:"b".repeat(64),import_mode:"PRICE_UPDATE_ONLY"},rows:conflicting.rows,products});
equal(conflict.rows.map(row=>[row.classification,row.selected_action,row.conflict_code]),[
  ["CONFLICT","NONE","PRICE_CONFLICT"],["CONFLICT","NONE","PRICE_CONFLICT"]
],"different-price duplicate blocks both rows");

const newRows=parseCatalogExcelWorkbook(workbook([
  [null,"NEW-READY","LOCAL NEW READY","800x800","POLISH",700000],
  [null,"NEW-DRAFT","LOCAL NEW DRAFT","600x1200","MATT",null]
]));
const catalog=buildCatalogImportPreview({batch:{...meta,source_sha256:"c".repeat(64),import_mode:"CATALOG_IMPORT"},rows:newRows.rows,products});
equal(catalog.rows.map(row=>[row.classification,row.selected_action,row.disposition]),[
  ["NEW","CREATE","READY"],["NEW","CREATE","UPDATING"]
],"catalog mode creates ready and updating drafts");
equal(catalog.rows[1].proposed_snapshot.price_per_m2,undefined,"blank price stays absent/null-equivalent");
equal(catalog.rows[0].proposed_snapshot.is_published,false,"new products never auto-publish");

const priceOnlyNew=buildCatalogImportPreview({batch:{...meta,source_sha256:"d".repeat(64),import_mode:"PRICE_UPDATE_ONLY"},rows:newRows.rows,products});
truthy(priceOnlyNew.rows.every(row=>row.selected_action==="NONE"&&row.conflict_code==="PRICE_ONLY_UNMATCHED"),"price-only never creates unmatched products");

console.log(`Catalog import payload 03B PASS (${checks} checks).`);
