import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const edge=read("supabase/functions/product-import-source/index.ts");
const confirmSql=read("supabase-phase-product-r2-import-confirm.sql");
const client=read("js/features/product-import-client.js");
const bytes=Buffer.from("%PDF-1.7 synthetic step6 source");
const hash=crypto.createHash("sha256").update(bytes).digest("hex");
assert.equal(bytes.subarray(0,5).toString(),"%PDF-");assert.equal(bytes.length,31);assert.equal(hash.length,64);
for(const required of ["Authorization","/auth/v1/user","x-product-import-batch-id","MAX_BYTES=20*1024*1024","SOURCE_HASH_MISMATCH","SOURCE_SIZE_MISMATCH","SOURCE_NOT_PDF","SUPABASE_SERVICE_ROLE_KEY","product-price-imports","imports/${batchId}/source.pdf","crm_prepare_product_import_source","crm_register_product_import_source"]){assert.ok(edge.includes(required),`Edge source boundary missing: ${required}`);}
assert.match(edge,/getReader\(\)/);assert.match(edge,/crypto\.subtle\.digest\("SHA-256"/);assert.match(edge,/"x-upsert":"true"/);
for(const forbidden of ["insert into public.products","update public.products","delete from public.products","product_price_history","console.log","signedUrl"]){assert.equal(edge.toLowerCase().includes(forbidden.toLowerCase()),false,`Edge must not mutate Product or leak internals: ${forbidden}`);}
assert.match(confirmSql,/public\.crm_confirm_product_import\(p_batch_id uuid,p_idempotency_key uuid\)/);
assert.match(confirmSql,/storage\.buckets/);assert.match(confirmSql,/false,20971520,array\['application\/pdf'\]/);
assert.ok(confirmSql.includes("storage_object_path = 'imports/'||id::text||'/source.pdf'"));
assert.equal(client.includes("SUPABASE_SERVICE_ROLE_KEY"),false);
assert.match(client,/functions\/v1\/product-import-source/);
console.log(`Product R2 STEP 6 source boundary PASS: synthetic PDF magic/hash ${hash}, bounded stream, JWT/batch authorization, private bucket path, server registration and frontend secret isolation.`);
