import assert from "node:assert/strict";
import process from "node:process";
import {parseCatalogExcelWorkbook} from "../js/product-import/index.js";

let source="";
for await(const chunk of process.stdin) source+=chunk;
const workbook=JSON.parse(source);
const result=parseCatalogExcelWorkbook(workbook,{sheetName:"INDONESIA"});

assert.equal(result.ok,true,"real workbook must parse");
assert.equal(result.metadata.sheet_name,"INDONESIA");
assert.equal(result.metadata.header_row,13);
assert.equal(result.metadata.default_size_unit,"mm");
assert.equal(result.metadata.columns.price,8,"GIÁ NIÊM YẾT MỚI must win");
assert.equal(result.summary.physical_rows,224);
assert.equal(result.rows[0].source_row_number,15);
assert.deepEqual(
  [result.rows[0].product_name,result.rows[0].width_mm,result.rows[0].height_mm,result.rows[0].price_per_m2],
  ["GIGAUTO BLACK",600,600,"565000"]
);
const inherited=result.rows.find(row=>row.source_row_number===16);
assert.deepEqual([inherited.width_mm,inherited.height_mm,inherited.size_source_cell_ref,inherited.size_inherited],[600,600,"B15",true]);
const merged=result.rows.find(row=>row.source_row_number===68);
assert.deepEqual([merged.width_mm,merged.height_mm,merged.size_source_cell_ref,merged.size_merged],[800,800,"B67",true]);
const large=result.rows.find(row=>row.source_row_number===221);
assert.deepEqual([large.width_mm,large.height_mm,large.price_per_m2],[1200,3000,"1915000"]);
assert.equal(result.rows.at(-1).source_row_number,238);
assert.ok(result.rows.every(row=>row.width_mm&&row.height_mm),"every source row inherits an explicit size group");
assert.ok(result.rows.every(row=>row.source_cell_ref&&row.size_source_cell_ref),"source provenance is retained");

console.log(`Catalog 03A real workbook dry-run PASS (${result.summary.physical_rows} rows, no writes).`);
