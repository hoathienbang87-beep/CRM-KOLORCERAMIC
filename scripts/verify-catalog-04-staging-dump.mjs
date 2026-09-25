import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";

const baselinePath=process.argv[2];
const dryRunPath=process.argv[3];
assert.ok(baselinePath&&dryRunPath,"Usage: node scripts/verify-catalog-04-staging-dump.mjs <baseline-data.sql> <after-dry-run-data.sql>");

function parseDump(path){
  const source=readFileSync(path,"utf8");
  const tables=new Map();
  let current=null;
  for(const line of source.split(/\r?\n/)){
    const start=line.match(/^COPY "public"\."([^"]+)" \((.+)\) FROM stdin;$/);
    if(start){
      const columns=[...start[2].matchAll(/"([^"]+)"/g)].map(match=>match[1]);
      current={columns,rows:[]};
      tables.set(start[1],current);
      continue;
    }
    if(current&&line==="\\."){
      current=null;
      continue;
    }
    if(current){
      const values=line.split("\t").map(decodeCopyValue);
      assert.equal(values.length,current.columns.length,`COPY column mismatch in ${path}`);
      current.rows.push(Object.fromEntries(current.columns.map((column,index)=>[column,values[index]])));
    }
  }
  return {source,tables,sha256:createHash("sha256").update(source).digest("hex")};
}

function decodeCopyValue(value){
  if(value==="\\N") return null;
  return value.replace(/\\([\\tnrbfv])/g,(_,code)=>({"\\":"\\",t:"\t",n:"\n",r:"\r",b:"\b",f:"\f",v:"\v"})[code]);
}

function rows(dump,table){return dump.tables.get(table)?.rows??[];}
function countBy(input,field){
  const output={};
  for(const row of input){const value=row[field]??"NULL";output[value]=(output[value]||0)+1;}
  return Object.fromEntries(Object.entries(output).sort(([a],[b])=>a.localeCompare(b)));
}

const baseline=parseDump(baselinePath);
const dryRun=parseDump(dryRunPath);
const baselineProducts=rows(baseline,"products");
const products=rows(dryRun,"products");
const batches=rows(dryRun,"product_import_batches");
const importRows=rows(dryRun,"product_import_rows");
const history=rows(dryRun,"product_price_history");
const mappings=rows(dryRun,"product_source_mappings");
const leads=rows(dryRun,"website_leads");
const audits=rows(dryRun,"audit_logs");

assert.equal(baselineProducts.length,75);
assert.equal(products.length,75);
const baselineById=new Map(baselineProducts.map(row=>[row.id,JSON.stringify(row)]));
const afterById=new Map(products.map(row=>[row.id,JSON.stringify(row)]));
assert.deepEqual([...afterById.keys()].sort(),[...baselineById.keys()].sort(),"Product IDs changed after dry-run");
for(const [id,value] of baselineById) assert.equal(afterById.get(id),value,`Product ${id} changed after dry-run`);
assert.equal(products.filter(row=>row.data_status==="READY").length,75);
assert.equal(products.filter(row=>row.is_published==="t").length,0);

assert.equal(batches.length,1);
assert.equal(batches[0].source_sha256,"bdbe0ac5c1832391db83a9a55a6b90eb4359efd8644df4b45336c465ae7e1dd8");
assert.equal(batches[0].status,"READY");
assert.equal(batches[0].approved_at,null);
assert.equal(batches[0].approved_by_user_id,null);
assert.equal(batches[0].approval_idempotency_key,null);

assert.equal(importRows.length,104);
assert.deepEqual(countBy(importRows,"classification"),{NEW:48,REVIEW:2,UNCHANGED:54});
assert.deepEqual(countBy(importRows,"disposition"),{EXCLUDED_BY_REVIEW:2,READY:95,UPDATING:7});
assert.deepEqual(countBy(importRows,"selected_action"),{CREATE:48,SKIP:56});
assert.equal(importRows.filter(row=>row.match_rule==="FUZZY_SUGGESTION").length,12);
assert.equal(importRows.filter(row=>row.disposition==="MANUAL_REVIEW").length,0);
assert.equal(importRows.filter(row=>row.classification==="DUPLICATE_IN_FILE").length,0);
assert.equal(importRows.filter(row=>row.classification==="CONFLICT").length,0);
assert.equal(importRows.filter(row=>JSON.parse(row.source_values).price_per_m2===null).length,8);
assert.equal(importRows.filter(row=>row.source_sheet==="Đã loại").length,2);

assert.equal(history.length,0);
assert.equal(mappings.length,0);
assert.equal(leads.length,0);
assert.equal(audits.filter(row=>row.action==="catalogImportPreview02B").length,1);
assert.equal(audits.filter(row=>/^catalogImport(Apply|Rollback)/.test(row.action??"")).length,0);

console.log(JSON.stringify({
  batch_id:batches[0].id,
  batch_status:batches[0].status,
  products:products.length,
  products_unchanged:true,
  ready_products:75,
  published_products:0,
  preview_rows:importRows.length,
  classification:countBy(importRows,"classification"),
  disposition:countBy(importRows,"disposition"),
  selected_action:countBy(importRows,"selected_action"),
  fuzzy_suggestions:12,
  blank_price_including_excluded:8,
  blank_price_approved:6,
  price_history:history.length,
  preview_audit:1,
  apply_or_rollback_audit:0,
  baseline_dump_sha256:baseline.sha256,
  dry_run_dump_sha256:dryRun.sha256
},null,2));
