import assert from "node:assert/strict";
import process from "node:process";
import {parseCatalogExcelWorkbook} from "../js/product-import/index.js";

let source="";
for await(const chunk of process.stdin) source+=chunk;
const workbook=JSON.parse(source);
const result=parseCatalogExcelWorkbook(workbook,{sheetName:"Đã chốt"});

assert.equal(result.ok,true,"finalized workbook must parse");
assert.equal(result.metadata.header_row,8);
assert.equal(result.metadata.default_size_unit,"cm");
assert.equal(result.metadata.size_fill_down,false,"blank finalized sizes must stay blank");
assert.equal(result.metadata.columns.price,14,"finalized price column must win");
assert.equal(result.summary.physical_rows,102);
assert.equal(result.rows.filter(row=>row.issues.some(issue=>issue.code==="MISSING_SIZE")).length,3);
assert.equal(result.rows.filter(row=>row.issues.some(issue=>issue.code==="MISSING_PRICE")).length,6);
assert.equal(result.rows.filter(row=>row.issues.length===0).length,95);

console.log("Catalog 03A finalized workbook dry-run PASS (102 retained, 95 complete, 3 missing size, 6 missing price).");
