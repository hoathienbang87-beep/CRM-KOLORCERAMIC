import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const forward=await readFile(new URL("../supabase-phase-catalog-integration-03b-approval-audit.sql",import.meta.url),"utf8");
const rollback=await readFile(new URL("../supabase-phase-catalog-integration-03b-rollback.sql",import.meta.url),"utf8");
const adapter=await readFile(new URL("../js/product-import/catalog-import-payload.js",import.meta.url),"utf8");
const integration=await readFile(new URL("./test-catalog-03b-local-integration.sql",import.meta.url),"utf8");

let checks=0;
const check=(condition,message)=>{assert.ok(condition,message);checks++;};
const has=(text,pattern,message)=>check(pattern.test(text),message);

has(forward,/\bbegin;[\s\S]*commit;\s*$/i,"forward is transactional");
has(rollback,/\bbegin;[\s\S]*commit;\s*$/i,"rollback is transactional");
has(forward,/pg_advisory_xact_lock/i,"forward advisory lock");
has(rollback,/pg_advisory_xact_lock/i,"rollback advisory lock");

for(const token of [
  "approved_by_user_id","approved_at","approval_idempotency_key",
  "product_import_batches_approval_shape_check","product_import_batches_approval_key_unique",
  "catalog_admin_approve_import","CATALOG_IMPORT_APPROVAL_REQUIRED",
  "catalog_admin_apply_import_02b_impl","catalog_admin_rollback_import_02b_impl",
  "catalogImportApprove03B","catalogImportProductApply03B","catalogImportProductRollback03B",
  "'before'","'after'","'batch_id'","'row_id'","'product_id'"
]) has(forward,new RegExp(token,"i"),`forward contains ${token}`);

has(forward,/revoke all on function public\.catalog_admin_apply_import_02b_impl\(uuid,uuid\) from public, anon, authenticated/i,"internal apply is not browser executable");
has(forward,/revoke all on function public\.catalog_admin_rollback_import_02b_impl\(uuid,uuid\) from public, anon, authenticated/i,"internal rollback is not browser executable");
has(forward,/grant execute on function public\.catalog_admin_approve_import\(uuid,uuid\) to authenticated/i,"approval wrapper is granted");
has(forward,/security definer\s+set search_path = pg_catalog, public/gi,"security definer has fixed path");
check((forward.match(/security definer/gi)||[]).length===3,"exactly three new security-definer RPCs");
check((forward.match(/set search_path = pg_catalog, public/gi)||[]).length===3,"all new RPCs pin search path");

for(const token of [
  "drop function public.catalog_admin_approve_import",
  "rename to catalog_admin_apply_import",
  "rename to catalog_admin_rollback_import",
  "drop column approval_idempotency_key",
  "drop column approved_at",
  "drop column approved_by_user_id",
  "CATALOG_03B_ROLLBACK_GUARD"
]) has(rollback,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"i"),`rollback contains ${token}`);

check(!/drop\s+table|truncate\s+|delete\s+from\s+public\.products/i.test(forward),"forward has no destructive catalog DDL/DML");
check(!/jjeeazwlqcwynzquimeo|postgres(?:ql)?:\/\//i.test(forward+rollback),"migration contains no production ref or database URL");

for(const token of [
  "dryRunCatalogMatching","PRICE_UPDATE_ONLY","CATALOG_IMPORT","SKIP_DUPLICATE","PRICE_CONFLICT",
  "MISSING_PRICE_SKIPPED","PRICE_ONLY_UNMATCHED","current_product_version","proposed_snapshot",
  "is_published:false"
]) has(adapter,new RegExp(token,"i"),`adapter contains ${token}`);

for(const token of [
  "apply without approval","approval replay","blank price overwrite","duplicate same price",
  "duplicate different price","stale apply","retry after error","rollback version conflict",
  "ready/draft classification","apply before/after audit","rollback audit count","rollback;"
]) has(integration,new RegExp(token,"i"),`integration covers ${token}`);

console.log(`Catalog import 03B static contract PASS (${checks} checks).`);
