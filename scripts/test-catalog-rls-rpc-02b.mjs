import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, 'supabase-phase-catalog-integration-02b-rls-rpc.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(root, 'supabase-phase-catalog-integration-02b-rollback.sql'), 'utf8');
let checks = 0;

function expect(label, condition) {
  checks += 1;
  if (!condition) throw new Error(`FAIL: ${label}`);
}

const requiredFunctions = [
  'catalog_public_list_products',
  'catalog_public_get_product',
  'catalog_crm_search_products',
  'catalog_admin_preview_import',
  'catalog_admin_apply_import',
  'catalog_admin_rollback_import',
  'catalog_submit_website_lead',
  'catalog_admin_list_website_leads',
  'catalog_admin_update_website_lead',
];

for (const name of requiredFunctions) {
  expect(`${name} is created`, new RegExp(`create function public\\.${name}\\b`, 'i').test(migration));
  expect(`${name} is security definer`, new RegExp(`create function public\\.${name}[\\s\\S]*?security definer`, 'i').test(migration));
  expect(`${name} has fixed search_path`, new RegExp(`create function public\\.${name}[\\s\\S]*?set search_path = pg_catalog, public`, 'i').test(migration));
  expect(`${name} is removed by rollback`, new RegExp(`drop function if exists public\\.${name}\\b`, 'i').test(rollback));
}

expect('anon table access revoked', /revoke all on public\.products[\s\S]*from public, anon;/i.test(migration));
expect('authenticated catalog writes revoked', /revoke insert, update, delete, truncate on public\.products[\s\S]*from authenticated;/i.test(migration));
expect('legacy create mutation revoked', /revoke all on function public\.crm_create_product\(jsonb\) from public, anon, authenticated;/i.test(migration));
expect('legacy update mutation revoked', /revoke all on function public\.crm_update_product\(uuid,bigint,jsonb\) from public, anon, authenticated;/i.test(migration));
expect('legacy active mutation revoked', /revoke all on function public\.crm_set_product_active\(uuid,bigint,boolean\) from public, anon, authenticated;/i.test(migration));
expect('audit forging revoked', /revoke all on function public\.crm_write_audit\(text,text,text,jsonb\) from public, anon, authenticated;/i.test(migration));
expect('public list granted to anon', /grant execute on function public\.catalog_public_list_products[^;]+to anon, authenticated;/i.test(migration));
expect('lead submission granted to anon', /grant execute on function public\.catalog_submit_website_lead\(jsonb\) to anon, authenticated;/i.test(migration));
expect('admin role is fail closed', /crm_current_user_role\(\) not in \('admin', 'owner'\)/i.test(migration));
expect('price-only cannot create', /CATALOG_PRICE_ONLY_CREATE_FORBIDDEN/.test(migration));
expect('optimistic apply version guard', /p\.version is distinct from r\.current_product_version/i.test(migration));
expect('optimistic rollback version guard', /CATALOG_ROLLBACK_VERSION_CONFLICT/.test(migration));
expect('apply idempotency', /confirm_idempotency_key = p_idempotency_key/i.test(migration));
expect('rollback idempotency', /rollback_idempotency_key = p_idempotency_key/i.test(migration));
expect('lead consent required', /privacy_consent/.test(migration));
expect('lead rate limit', /v_recent >= 5/.test(migration));
expect('lead rate lock', /WEBSITE_LEAD_02B\|/.test(migration));
expect('PII excluded from lead audit', /jsonb_build_object\('product_id', v_product_id, 'source_path', v_source_path\)/.test(migration));
expect('migration verifies RLS', /CATALOG_02B_VERIFY_FAIL: RLS disabled/.test(migration));
expect('migration verifies direct browser access', /CATALOG_02B_VERIFY_FAIL: direct browser table access/.test(migration));
expect('rollback restores Product R2 mutation grants', /grant execute on function public\.crm_create_product\(jsonb\) to authenticated;/i.test(rollback));
expect('rollback restores explicit audit grants', /grant execute on function public\.crm_write_audit\(text,text,text,jsonb\) to public, anon, authenticated;/i.test(rollback));
expect('transactional migration', /(?:^|\n)begin;[\s\S]*commit;\s*$/i.test(migration.trim()));
expect('transactional rollback', /(?:^|\n)begin;[\s\S]*commit;\s*$/i.test(rollback.trim()));

console.log(`PASS: Catalog 02B RLS/RPC static checks (${checks} checks).`);
