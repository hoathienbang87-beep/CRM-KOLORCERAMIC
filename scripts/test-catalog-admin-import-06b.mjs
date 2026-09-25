import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const migration=read("supabase-phase-catalog-integration-06b-admin-import.sql");
const compatibility=read("supabase-phase-catalog-integration-06b-classification-compat.sql");
const aliasFix=read("supabase-phase-catalog-integration-06b-review-alias-fix.sql");
const rollback=read("supabase-phase-catalog-integration-06b-rollback.sql");
const html=read("admin/index.html");
const css=read("css/catalog-admin.css");
const api=read("js/admin/catalog-admin-api.js");
const ui=read("js/admin/catalog-admin-import.js");
const payload=read("js/product-import/catalog-import-payload.js");
const runtime=read("scripts/test-catalog-06b-staging.sql");
const rollbackRuntime=read("scripts/test-catalog-06b-staging-rollback.sql");
let checks=0;
const expect=(label,value)=>{checks++;assert.ok(value,`FAIL: ${label}`);};

for(const fn of ["catalog_admin_list_import_batches_v1","catalog_admin_get_import_batch_v1","catalog_admin_review_import_rows_v1"]){
  expect(`creates ${fn}`,new RegExp(`create function public\\.${fn}\\b`,`i`).test(migration));
  expect(`grants ${fn}`,new RegExp(`grant execute on function public\\.${fn}\\b`,`i`).test(migration));
  expect(`rolls back ${fn}`,new RegExp(`drop function public\\.${fn}\\b`,`i`).test(rollback));
}
expect("helper remains internal",/revoke all on function public\.catalog_admin_import_batch_json_v1_06b\(uuid,boolean\) from public,anon,authenticated/i.test(migration));
expect("admin gate on list",/catalog_admin_list_import_batches_v1[\s\S]*catalog_require_admin_02b\(\)/i.test(migration));
expect("admin gate on get",/catalog_admin_get_import_batch_v1[\s\S]*catalog_require_admin_02b\(\)/i.test(migration));
expect("admin gate on review",/catalog_admin_review_import_rows_v1[\s\S]*catalog_require_admin_02b\(\)/i.test(migration));
expect("review locks approved batches",/approved_at is not null[\s\S]*CATALOG_IMPORT_REVIEW_LOCKED/i.test(migration));
expect("candidate allow-list",/catalog_match[\s\S]*CATALOG_IMPORT_CANDIDATE_NOT_ALLOWED/i.test(migration));
expect("price only candidate whitelist",/b\.import_mode='PRICE_UPDATE_ONLY'[\s\S]*price_per_m2[\s\S]*price_effective_date/i.test(migration));
expect("review audit",/catalogImportReview06B/.test(migration));
expect("no direct writes",/has_table_privilege\('authenticated','public\.product_import_batches','INSERT,UPDATE,DELETE,TRUNCATE'\)/i.test(migration));
expect("transactional migration",/(?:^|\n)begin;[\s\S]*notify pgrst, 'reload schema';\s*commit;\s*$/i.test(migration.trim()));
expect("classification compatibility",/classification in \([\s\S]*'CHANGED'[\s\S]*'CONFLICT'/i.test(compatibility));
expect("compatibility preserves legacy labels",/PRICE_CHANGED/.test(compatibility)&&/INFO_CHANGED/.test(compatibility));
expect("transactional compatibility",/(?:^|\n)begin;[\s\S]*commit;\s*$/i.test(compatibility.trim()));
expect("review alias fix replaces function",/create or replace function public\.catalog_admin_review_import_rows_v1/i.test(aliasFix));
expect("review alias avoids composite ambiguity",/product_import_rows ir[\s\S]*ir\.batch_id=b\.id/i.test(aliasFix));
expect("transactional alias fix",/(?:^|\n)begin;[\s\S]*commit;\s*$/i.test(aliasFix.trim()));
expect("transactional rollback",/(?:^|\n)begin;[\s\S]*commit;\s*$/i.test(rollback.trim()));

for(const id of ["adminImportPage","adminImportForm","adminImportMode","adminImportFile","adminImportPreviewPanel","adminImportRows","adminImportApprove","adminImportApply","adminImportHistory"])
  expect(`html #${id}`,new RegExp(`id=["']${id}["']`).test(html));
expect("two modes",/PRICE_UPDATE_ONLY/.test(html)&&/CATALOG_IMPORT/.test(html));
expect("Excel PDF accept",/\.xlsx,\.xls,\.pdf/.test(html));
expect("responsive import cards",/\.import-row-cards\{display:grid/.test(css));
expect("API preview",/catalog_admin_preview_import/.test(api));
expect("API approve apply rollback",["catalog_admin_approve_import","catalog_admin_apply_import","catalog_admin_rollback_import"].every(name=>api.includes(name)));
expect("structured Excel parser",/parseCatalogExcelWorkbook/.test(ui));
expect("preview builder",/buildCatalogImportPreview/.test(ui));
expect("PDF OCR pending",/chờ OCR[\s\S]*Không có preview database/i.test(ui));
expect("SHA-256",/subtle\.digest\("SHA-256"/.test(ui));
expect("Vietnamese price delta",/deltaMarkup/.test(ui)&&/formatVnd/.test(ui));
expect("review candidates",/USE_CANDIDATE/.test(ui)&&/EXCLUDE/.test(ui));
expect("approval confirmation",/Duyệt batch này/.test(ui));
expect("apply confirmation",/Áp dụng batch/.test(ui));
expect("rollback confirmation",/Rollback batch này/.test(ui));
expect("match candidates persisted",/catalog_match:[\s\S]*candidates:[\s\S]*suggestions:/i.test(payload));
expect("no service role",!/(service[_-]?role|eyJ[A-Za-z0-9_-]{20,})/i.test([migration,compatibility,aliasFix,rollback,html,api,ui,payload].join("\n")));

for(const label of ["dry-run catalog unchanged","candidate review","exclude decision","approval gate","apply result","apply replay","rollback result","rollback replay","audit before/after","sale denied","anon denied","fixture rollback residue"])
  expect(`runtime ${label}`,runtime.includes(label));
expect("runtime self rollback",/rollback;[\s\S]*fixture rollback residue/i.test(runtime));
expect("rollback rehearsal self reverts",/rollback;[\s\S]*REHEARSAL_WAS_NOT_FULLY_REVERTED/i.test(rollbackRuntime));

console.log(`Catalog admin import 06B PASS (${checks} checks).`);
