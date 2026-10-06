import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {stdin} from "node:process";
import {dryRunCatalogMatching,parseCatalogExcelWorkbook} from "../js/product-import/index.js";

const snapshotPath=process.argv[2];
assert.ok(snapshotPath,"Usage: node scripts/run-catalog-matching-03a-dry-run.mjs <products-snapshot.json>");

let workbookJson="";
stdin.setEncoding("utf8");
for await(const chunk of stdin) workbookJson+=chunk;

const workbook=JSON.parse(workbookJson);
const snapshot=JSON.parse(await readFile(snapshotPath,"utf8"));
assert.ok(Array.isArray(snapshot.rows),"Product snapshot must expose a rows array");

const parsed=parseCatalogExcelWorkbook(workbook);
assert.equal(parsed.ok,true,"Workbook must parse before matching");
const dryRun=dryRunCatalogMatching(parsed.rows,snapshot.rows);

assert.equal(dryRun.rows.length,parsed.rows.length,"Dry-run must preserve every parsed source row");
assert.equal(dryRun.summary.total,parsed.summary.physical_rows,"Dry-run total must match parsed row count");
assert.equal(
  dryRun.summary.matched+dryRun.summary.ambiguous+dryRun.summary.unmatched,
  dryRun.summary.total,
  "Every row must have exactly one terminal matching status"
);

const matchRules={};
for(const row of dryRun.rows){
  const rule=row.match.match_rule;
  matchRules[rule]=(matchRules[rule]||0)+1;
}

console.log(JSON.stringify({
  mode:"READ_ONLY_DRY_RUN",
  source_rows:parsed.summary.physical_rows,
  target_products:snapshot.rows.length,
  parser_summary:parsed.summary,
  ...dryRun.summary,
  match_rules:matchRules
},null,2));
