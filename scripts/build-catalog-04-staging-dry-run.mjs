import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {stdin} from "node:process";
import {buildCatalogImportPreview,parseCatalogExcelWorkbook} from "../js/product-import/index.js";

const snapshotPath=process.argv[2];
const outputPath=process.argv[3];
assert.ok(snapshotPath&&outputPath,"Usage: node scripts/build-catalog-04-staging-dry-run.mjs <products.json> <output.sql>");

let workbookJson="";
stdin.setEncoding("utf8");
for await(const chunk of stdin) workbookJson+=chunk;
const workbook=JSON.parse(workbookJson);
const snapshot=JSON.parse(readFileSync(snapshotPath,"utf8"));
assert.ok(Array.isArray(snapshot.rows));
assert.equal(snapshot.rows.length,75);

const approved=parseCatalogExcelWorkbook(workbook,{sheetName:"Đã chốt"});
const excluded=parseCatalogExcelWorkbook(workbook,{sheetName:"Đã loại"});
assert.equal(approved.ok,true);
assert.equal(excluded.ok,true);
assert.equal(approved.rows.length,102);
assert.equal(approved.rows.filter(row=>row.issues.length===0).length,95);
assert.equal(approved.rows.filter(row=>row.issues.length>0).length,7);
assert.equal(excluded.rows.length,2);

const batch={
  supplier:"KOLOR CERAMICS REVIEW 2026-09-22",
  source_filename:"product-review-finalized.xlsx",
  source_sha256:"bdbe0ac5c1832391db83a9a55a6b90eb4359efd8644df4b45336c465ae7e1dd8",
  source_file_size_bytes:26647,
  parser_adapter:"CATALOG_03A_FINALIZED_REVIEW",
  parser_version:"1.0.0",
  effective_date:"2026-09-25",
  import_mode:"CATALOG_IMPORT",
  source_format:"EXCEL",
  source_metadata:{
    prompt:"04",
    checkpoint:"DRY_RUN_PENDING_USER_REVIEW",
    approved_rows:102,
    ready_rows:95,
    updating_rows:7,
    excluded_rows:2,
    unapproved_candidates_omitted:359
  }
};

const preview=buildCatalogImportPreview({batch,rows:approved.rows,products:snapshot.rows});

function excludedRpcRow(row){
  return {
    source_page:2,
    source_row_number:row.source_row_number,
    source_sheet:row.source_sheet??"Đã loại",
    source_cell_ref:row.source_cell_ref??null,
    source_record_id:row.source_id??null,
    source_values:row.raw_values??{},
    source_size_text:row.source_size_text??null,
    source_size_unit:row.source_size_unit??null,
    code:row.sku??null,
    name:row.product_name??null,
    width_mm:row.width_mm??null,
    height_mm:row.height_mm??null,
    surface:row.surface??null,
    classification:"REVIEW",
    disposition:"EXCLUDED_BY_REVIEW",
    conflict_code:"EXCLUDED_BY_REVIEW",
    selected_action:"SKIP",
    warnings:[...new Set((row.warnings||[]).map(item=>typeof item==="string"?item:item?.code).filter(Boolean))],
    proposed_snapshot:{}
  };
}

const rows=[...preview.rows,...excluded.rows.map(excludedRpcRow)];
assert.equal(rows.length,104);
assert.equal(rows.filter(row=>row.disposition==="EXCLUDED_BY_REVIEW").length,2);
assert.equal(rows.filter(row=>row.selected_action==="CREATE"&&row.disposition==="UPDATING").length,7);
assert.equal(rows.filter(row=>row.selected_action==="CREATE"&&row.disposition==="READY").length,95-preview.matching_summary.matched);
assert.equal(rows.filter(row=>row.conflict_code==="PRICE_CONFLICT").length,0);

function counts(field){
  const result={};
  for(const row of rows){
    const key=String(row[field]??"NULL");
    result[key]=(result[key]||0)+1;
  }
  return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));
}

const summary={
  source_rows:rows.length,
  approved_rows:approved.rows.length,
  excluded_rows:excluded.rows.length,
  parser_ready:approved.rows.filter(row=>row.issues.length===0).length,
  parser_updating:approved.rows.filter(row=>row.issues.length>0).length,
  blank_price:approved.rows.filter(row=>row.price_per_m2===null).length,
  missing_size:approved.rows.filter(row=>row.width_mm===null||row.height_mm===null).length,
  matching:preview.matching_summary,
  classification:counts("classification"),
  disposition:counts("disposition"),
  selected_action:counts("selected_action"),
  unapproved_candidates_omitted:359
};

const batchJson=JSON.stringify(preview.batch);
const rowsJson=JSON.stringify(rows);
for(const value of [batchJson,rowsJson]){
  assert.equal(value.includes("$catalog04batch$"),false);
  assert.equal(value.includes("$catalog04rows$"),false);
}

const countChecks=Object.entries(summary.disposition).map(([value,count])=>
  `     or (select count(*) from public.product_import_rows where batch_id=v_batch_id and disposition=${sqlText(value)}) <> ${count}`
).join("\n");
const actionChecks=Object.entries(summary.selected_action).map(([value,count])=>
  `     or (select count(*) from public.product_import_rows where batch_id=v_batch_id and selected_action=${sqlText(value)}) <> ${count}`
).join("\n");
const classChecks=Object.entries(summary.classification).map(([value,count])=>
  `     or (select count(*) from public.product_import_rows where batch_id=v_batch_id and classification=${sqlText(value)}) <> ${count}`
).join("\n");

const adminAuthId="40404040-4040-4040-8040-404040404040";
const sql=`-- Prompt 04 cloud-staging dry-run only. This migration does not approve or apply the batch.
begin;

select pg_advisory_xact_lock(hashtext('CATALOG-INTEGRATION-04-STAGING-DRY-RUN'));

do $$
begin
  if (select count(*) from public.products) <> 75
     or (select count(*) from public.products where data_status='READY') <> 75
     or (select count(*) from public.products where is_published) <> 0
     or exists (select 1 from public.product_import_batches)
     or exists (select 1 from public.product_import_rows)
     or exists (select 1 from public.product_price_history)
     or exists (select 1 from public.product_source_mappings) then
    raise exception 'CATALOG_04_DRY_RUN_PRECONDITION_FAIL: expected clean 75-Product staging baseline.';
  end if;
end;
$$;

create temporary table catalog_04_products_guard on commit drop as
select id,to_jsonb(p) as old_row from public.products p;

insert into public.app_users(
  id,supabase_auth_id,email,name,role,active,lifecycle_status,created_at,updated_at
) values (
  'catalog-04-staging-admin','${adminAuthId}'::uuid,'catalog-04-admin@staging.invalid',
  'Catalog 04 Staging Admin','admin',true,'active',now(),now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub','${adminAuthId}',true);
select public.catalog_admin_preview_import(
  $catalog04batch$${batchJson}$catalog04batch$::jsonb,
  $catalog04rows$${rowsJson}$catalog04rows$::jsonb
);
reset role;

do $$
declare
  v_batch_id uuid;
begin
  select id into v_batch_id
  from public.product_import_batches
  where source_sha256='${batch.source_sha256}';

  if v_batch_id is null
     or (select count(*) from public.product_import_batches) <> 1
     or (select count(*) from public.product_import_rows where batch_id=v_batch_id) <> 104
     or (select count(*) from public.products) <> 75
     or (select count(*) from public.product_price_history) <> 0
     or (select count(*) from public.product_source_mappings) <> 0
     or (select count(*) from public.website_leads) <> 0
${countChecks}
${actionChecks}
${classChecks}
     or exists (
       select 1
       from catalog_04_products_guard g
       full join public.products p on p.id=g.id
       where g.id is null or p.id is null or g.old_row is distinct from to_jsonb(p)
     )
     or exists (
       select 1 from public.product_import_batches
       where id=v_batch_id
         and (approved_at is not null or approved_by_user_id is not null or approval_idempotency_key is not null)
     )
     or not exists (
       select 1 from public.audit_logs
       where action='catalogImportPreview02B' and entity_id=v_batch_id::text
     )
     or exists (
       select 1 from public.audit_logs
       where action in ('catalogImportApply02B','catalogImportRollback02B','catalogImportApply03B','catalogImportRollback03B')
     ) then
    raise exception 'CATALOG_04_DRY_RUN_VERIFY_FAIL';
  end if;
end;
$$;

commit;
`;

writeFileSync(outputPath,sql,{encoding:"utf8",flag:"wx"});
console.log(JSON.stringify({output:outputPath,summary},null,2));

function sqlText(value){
  return `'${String(value).replaceAll("'","''")}'`;
}
