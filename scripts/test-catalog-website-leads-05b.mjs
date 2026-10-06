import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, 'supabase-phase-catalog-integration-05b-website-leads.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(root, 'supabase-phase-catalog-integration-05b-rollback.sql'), 'utf8');
const cacheSync = fs.readFileSync(path.join(root, 'supabase-phase-catalog-integration-05b-postgrest-cache.sql'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'scripts', 'test-catalog-05b-staging.sql'), 'utf8');
const rollbackRuntime = fs.readFileSync(path.join(root, 'scripts', 'test-catalog-05b-staging-rollback.sql'), 'utf8');
let checks = 0;

function expect(label, condition) {
  checks += 1;
  if (!condition) throw new Error(`FAIL: ${label}`);
}

const securedFunctions = [
  'catalog_require_lead_manager_05b',
  'catalog_website_lead_spam_hook_05b',
  'catalog_submit_website_lead_v1',
  'catalog_manager_list_website_leads_v1',
  'catalog_manager_update_website_lead_v1',
  'catalog_manager_find_lead_customer_matches_v1',
  'catalog_manager_convert_website_lead_v1',
];

for (const name of securedFunctions) {
  expect(`${name} created`, new RegExp(`create function public\\.${name}\\b`, 'i').test(migration));
  expect(`${name} security definer`, new RegExp(`create function public\\.${name}[\\s\\S]*?security definer`, 'i').test(migration));
  expect(`${name} fixed search path`, new RegExp(`create function public\\.${name}[\\s\\S]*?set search_path = pg_catalog, public`, 'i').test(migration));
  expect(`${name} dropped by rollback`, new RegExp(`drop function public\\.${name}\\b`, 'i').test(rollback));
}

for (const column of [
  'phone_normalized', 'request_id', 'spam_score', 'spam_reason', 'customer_id',
  'conversion_mode', 'conversion_idempotency_key', 'converted_at', 'converted_by_user_id',
]) {
  expect(`adds ${column}`, new RegExp(`add column ${column}\\b`, 'i').test(migration));
  expect(`rolls back ${column}`, new RegExp(`drop column ${column}\\b`, 'i').test(rollback));
}

expect('normalizes Vietnam +84', /\^84\[0-9\]\{9\}\$[\s\S]*'0' \|\| substring\(v_digits from 3\)/i.test(migration));
expect('phone format constrained', /phone_normalized ~ '\^\[0-9\]\{9,15\}\$'/i.test(migration));
expect('statuses include qualified', /'QUALIFIED'/i.test(migration));
expect('statuses include converted', /'CONVERTED'/i.test(migration));
expect('conversion shape constrained', /website_leads_conversion_shape_check/i.test(migration));
expect('submission request id unique', /website_leads_request_id_key unique \(request_id\)/i.test(migration));
expect('conversion idempotency unique', /website_leads_conversion_idempotency_key unique \(conversion_idempotency_key\)/i.test(migration));
expect('honeypot spam hook', /v_reason := 'HONEYPOT'/i.test(migration));
expect('excessive link spam hook', /v_reason := 'EXCESSIVE_LINKS'/i.test(migration));
expect('client provider is untrusted', /Client-supplied provider claims are never trusted/i.test(migration));
expect('strict input whitelist', /where k not in \([\s\S]*'anti_spam'/i.test(migration));
expect('consent required', /WEBSITE_LEAD_VALIDATION_FAILED/i.test(migration));
expect('only public product accepted', /WEBSITE_LEAD_PRODUCT_NOT_PUBLIC/i.test(migration));
expect('submission idempotency lock', /WEBSITE_LEAD_REQUEST_05B\|/i.test(migration));
expect('contact rate lock', /WEBSITE_LEAD_RATE_05B\|/i.test(migration));
expect('rate limit counts email or phone', /v_email is not null[\s\S]*or \(v_phone_normalized is not null/i.test(migration));
expect('rate limit is five per fifteen minutes', /interval '15 minutes'[\s\S]*v_recent >= 5/i.test(migration));
expect('spam response is generic', /'status', 'RECEIVED'/i.test(migration));
expect('lead create audit excludes contact values', /websiteLeadCreate05B[\s\S]*'product_id'[\s\S]*'source_path'[\s\S]*'spam_reason'/i.test(migration));
expect('manager role allowed', /v_role not in \('manager', 'owner', 'admin'/i.test(migration));
expect('sale is not manager', !/v_role not in \([^)]*'sale'/i.test(migration));
expect('manager list paginates', /catalog_manager_list_website_leads_v1[\s\S]*'pagination'/i.test(migration));
expect('status transition cannot directly convert', /v_status not in \('NEW','CONTACTED','QUALIFIED','CLOSED','SPAM'\)/i.test(migration));
expect('status audit has before', /websiteLeadStatus05B[\s\S]*'before_status'/i.test(migration));
expect('duplicate discovery uses normalized phone', /catalog_manager_find_lead_customer_matches_v1[\s\S]*c\.phone_normalized = v_phone/i.test(migration));
expect('conversion only create or merge', /v_mode not in \('CREATE', 'MERGE'\)/i.test(migration));
expect('conversion requires idempotency key', /p_idempotency_key is null/i.test(migration));
expect('conversion locks lead', /WEBSITE_LEAD_CONVERT_05B\|/i.test(migration));
expect('conversion locks phone', /'crm_phone:' \|\| v_lead\.phone_normalized/i.test(migration));
expect('create checks duplicate phone', /WEBSITE_LEAD_DUPLICATE_PHONE:/i.test(migration));
expect('merge checks phone mismatch', /WEBSITE_LEAD_PHONE_MISMATCH/i.test(migration));
expect('create reuses CRM customer RPC', /public\.crm_create_customer\(/i.test(migration));
expect('merge fills blank phone through CRM RPC', /public\.crm_update_customer_profile\(/i.test(migration));
expect('conversion writes linked customer', /customer_id = v_new_customer_id/i.test(migration));
expect('conversion audit has mode and customer', /websiteLeadConvert05B[\s\S]*'mode'[\s\S]*'customer_id'/i.test(migration));
expect('anon direct lead table denied', /revoke all on public\.website_leads from public, anon/i.test(migration));
expect('authenticated direct writes denied', /revoke insert, update, delete, truncate on public\.website_leads from authenticated/i.test(migration));
expect('legacy submit browser grant revoked', /revoke execute on function public\.catalog_submit_website_lead\(jsonb\) from anon, authenticated/i.test(migration));
expect('legacy list browser grant revoked', /revoke execute on function public\.catalog_admin_list_website_leads\(text,integer\) from authenticated/i.test(migration));
expect('new submit granted anon', /grant execute on function public\.catalog_submit_website_lead_v1\(jsonb\) to anon, authenticated/i.test(migration));
expect('manager conversion granted authenticated', /grant execute on function public\.catalog_manager_convert_website_lead_v1[^;]+to authenticated/i.test(migration));
expect('rollback blocks converted state loss', /CATALOG_05B_ROLLBACK_BLOCKED/i.test(rollback));
expect('rollback restores legacy submit grant', /grant execute on function public\.catalog_submit_website_lead\(jsonb\) to anon, authenticated/i.test(rollback));
expect('migration transactional', /(?:^|\n)begin;[\s\S]*commit;\s*$/i.test(migration.trim()));
expect('rollback transactional', /(?:^|\n)begin;[\s\S]*commit;\s*$/i.test(rollback.trim()));
expect('migration reloads PostgREST schema', /notify pgrst, 'reload schema'/i.test(migration));
expect('rollback reloads PostgREST schema', /notify pgrst, 'reload schema'/i.test(rollback));
expect('cache sync guards required functions', /CATALOG_05B_CACHE_SYNC_FAIL/i.test(cacheSync));
expect('cache sync reloads PostgREST schema', /notify pgrst, 'reload schema'/i.test(cacheSync));
expect('cache sync transactional', /(?:^|\n)begin;[\s\S]*commit;\s*$/i.test(cacheSync.trim()));

for (const label of [
  'valid submit', 'request idempotency', 'normalization or spam hook', 'consent validation',
  'phone validation', 'rate limit', 'legacy submit bypass', 'anon manager API',
  'anon direct table read', 'manager list/pagination', 'duplicate phone discovery',
  'manager status update', 'duplicate create blocked', 'merge conversion', 'merge idempotency',
  'create conversion/customer assignment', 'create idempotency', 'mismatched phone merge',
  'sale manager denial', 'owner access', 'status/conversion audit or replay duplication',
  'lead audit contains contact PII', 'fixture rollback residue',
]) {
  expect(`runtime covers ${label}`, runtime.includes(`CATALOG_05B_TEST_FAIL: ${label}`));
}

expect('runtime has exact staging guard', /expected isolated post-05A staging baseline/i.test(runtime));
expect('runtime uses anon role', /set local role anon/i.test(runtime));
expect('runtime uses authenticated role', /set local role authenticated/i.test(runtime));
expect('runtime uses manager identity', /lead-05b-manager@staging\.invalid/i.test(runtime));
expect('runtime uses owner identity', /lead-05b-owner@staging\.invalid/i.test(runtime));
expect('runtime uses sale identity', /lead-05b-sale@staging\.invalid/i.test(runtime));
expect('runtime rolls back fixtures', /rollback;[\s\S]*Independent proof/i.test(runtime));
expect('rollback rehearsal guarded', /expected empty lead\/customer staging baseline/i.test(rollbackRuntime));
expect('rollback rehearsal verifies 02B grants', /rollback shape or 02B grants/i.test(rollbackRuntime));
expect('rollback rehearsal restores 05B', /rehearsal was not fully reverted/i.test(rollbackRuntime));
expect('rollback rehearsal self reverts', /rollback;[\s\S]*begin;[\s\S]*rehearsal was not fully reverted/i.test(rollbackRuntime));

console.log(`PASS: Catalog 05B website lead static checks (${checks} checks).`);
