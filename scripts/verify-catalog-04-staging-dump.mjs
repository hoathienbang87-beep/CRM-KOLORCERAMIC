import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";

const baselinePath=process.argv[2];
const observedPath=process.argv[3];
const mode=process.argv[4]??"dry-run";
assert.ok(baselinePath&&observedPath,"Usage: node scripts/verify-catalog-04-staging-dump.mjs <baseline-data.sql> <observed-data.sql> [dry-run|apply|rollback]");
assert.ok(["dry-run","apply","rollback"].includes(mode),"Unsupported verification mode");

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

const batchId="b0a3e7d9-1afc-4f24-ad26-1ed49d7288a2";
const baseline=parseDump(baselinePath);
const observed=parseDump(observedPath);
const baselineProducts=rows(baseline,"products");
const products=rows(observed,"products");
const batches=rows(observed,"product_import_batches");
const importRows=rows(observed,"product_import_rows");
const history=rows(observed,"product_price_history");
const mappings=rows(observed,"product_source_mappings");
const leads=rows(observed,"website_leads");
const audits=rows(observed,"audit_logs");
const originalBatch=batches.find(row=>row.id===batchId);

assert.equal(baselineProducts.length,75);
const baselineById=new Map(baselineProducts.map(row=>[row.id,JSON.stringify(row)]));
const afterById=new Map(products.map(row=>[row.id,JSON.stringify(row)]));
for(const [id,value] of baselineById) assert.equal(afterById.get(id),value,`Baseline Product ${id} changed in ${mode}`);
assert.equal([...baselineById.keys()].every(id=>afterById.has(id)),true);

assert.ok(originalBatch,"Original import batch is missing");
assert.equal(originalBatch.source_sha256,"bdbe0ac5c1832391db83a9a55a6b90eb4359efd8644df4b45336c465ae7e1dd8");
assert.equal(importRows.length,104);
assert.deepEqual(countBy(importRows,"classification"),{NEW:48,REVIEW:2,UNCHANGED:54});
assert.deepEqual(countBy(importRows,"disposition"),{EXCLUDED_BY_REVIEW:2,READY:95,UPDATING:7});
assert.deepEqual(countBy(importRows,"selected_action"),{CREATE:48,SKIP:56});
assert.equal(importRows.filter(row=>row.match_rule==="FUZZY_SUGGESTION").length,12);
assert.equal(importRows.filter(row=>JSON.parse(row.source_values).price_per_m2===null).length,8);
assert.equal(importRows.filter(row=>row.source_sheet==="Đã loại").length,2);
assert.equal(mappings.length,0);
assert.equal(leads.length,0);

const createdIds=importRows.filter(row=>row.selected_action==="CREATE").map(row=>row.matched_product_id).filter(Boolean);
const createdProducts=products.filter(row=>createdIds.includes(row.id));
const auditCounts={
  preview:audits.filter(row=>row.action==="catalogImportPreview02B"&&row.entity_id===batchId).length,
  approve:audits.filter(row=>row.action==="catalogImportApprove03B"&&row.entity_id===batchId).length,
  apply:audits.filter(row=>row.action==="catalogImportApply02B"&&row.entity_id===batchId).length,
  product_apply:audits.filter(row=>row.action==="catalogImportProductApply03B"&&JSON.parse(row.raw_data).batch_id===batchId).length,
  rollback:audits.filter(row=>row.action==="catalogImportRollback02B"&&row.entity_id===batchId).length,
  product_rollback:audits.filter(row=>row.action==="catalogImportProductRollback03B"&&JSON.parse(row.raw_data).batch_id===batchId).length
};

if(mode==="dry-run"){
  assert.equal(products.length,75);
  assert.equal(batches.length,1);
  assert.equal(originalBatch.status,"READY");
  assert.equal(originalBatch.approved_at,null);
  assert.equal(originalBatch.approved_by_user_id,null);
  assert.equal(originalBatch.approval_idempotency_key,null);
  assert.equal(createdIds.length,0);
  assert.equal(history.length,0);
  assert.deepEqual(auditCounts,{preview:1,approve:0,apply:0,product_apply:0,rollback:0,product_rollback:0});
}

if(mode==="apply"){
  assert.equal(products.length,123);
  assert.equal(batches.length,1);
  assert.equal(originalBatch.status,"APPLIED");
  assert.ok(originalBatch.approved_at);
  assert.equal(originalBatch.approved_by_user_id,"catalog-04-staging-admin");
  assert.equal(originalBatch.approval_idempotency_key,"40400001-4040-4040-8040-404040404040");
  assert.equal(originalBatch.confirm_idempotency_key,"40400002-4040-4040-8040-404040404040");
  assert.equal(createdIds.length,48);
  assert.equal(new Set(createdIds).size,48);
  assert.equal(createdProducts.length,48);
  assert.equal(createdProducts.filter(row=>row.active==="t").length,48);
  assert.equal(createdProducts.filter(row=>row.data_status==="READY").length,41);
  assert.equal(createdProducts.filter(row=>row.data_status==="UPDATING").length,7);
  assert.equal(createdProducts.filter(row=>row.is_published==="t").length,0);
  assert.equal(history.length,42);
  assert.deepEqual(auditCounts,{preview:1,approve:1,apply:1,product_apply:48,rollback:0,product_rollback:0});
}

if(mode==="rollback"){
  const rollbackBatches=batches.filter(row=>row.rollback_of_batch_id===batchId);
  assert.equal(products.length,123);
  assert.equal(batches.length,2);
  assert.equal(originalBatch.status,"CANCELLED");
  assert.ok(originalBatch.rolled_back_at);
  assert.equal(originalBatch.rollback_idempotency_key,"40400003-4040-4040-8040-404040404040");
  assert.equal(rollbackBatches.length,1);
  assert.equal(rollbackBatches[0].status,"APPLIED");
  assert.equal(createdIds.length,48);
  assert.equal(createdProducts.length,48);
  assert.equal(createdProducts.filter(row=>row.active==="f").length,48);
  assert.equal(createdProducts.filter(row=>row.is_published==="t").length,0);
  assert.equal(createdProducts.filter(row=>row.version==="2").length,48);
  assert.equal(history.length,42);
  assert.deepEqual(auditCounts,{preview:1,approve:1,apply:1,product_apply:48,rollback:1,product_rollback:48});
}

console.log(JSON.stringify({
  mode,
  batch_id:batchId,
  original_batch_status:originalBatch.status,
  products:products.length,
  baseline_products_unchanged:true,
  active_products:products.filter(row=>row.active==="t").length,
  ready_products:products.filter(row=>row.data_status==="READY").length,
  updating_products:products.filter(row=>row.data_status==="UPDATING").length,
  published_products:products.filter(row=>row.is_published==="t").length,
  preview_rows:importRows.length,
  classification:countBy(importRows,"classification"),
  disposition:countBy(importRows,"disposition"),
  selected_action:countBy(importRows,"selected_action"),
  created_product_links:createdIds.length,
  price_history:history.length,
  audit:auditCounts,
  baseline_dump_sha256:baseline.sha256,
  observed_dump_sha256:observed.sha256
},null,2));
