import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationPath = path.join(root, 'supabase-phase-kpi2-customer-linked-event.sql');
const integrationPath = path.join(root, 'scripts', 'test-phase-kpi2-customer-linked-event-integration.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const integration = fs.readFileSync(integrationPath, 'utf8');

let passed = 0;
const failures = [];

function check(name, condition) {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(name);
}

function has(text, pattern) {
  return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
}

function between(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  return from >= 0 && to > from ? text.slice(from, to) : '';
}

const submit = between(
  migration,
  'create or replace function public.crm_kpi_submit_events(',
  '-- ---------------------------------------------------------------------------\n-- 6.'
);
const revision = between(
  migration,
  'create or replace function public.crm_kpi_submit_revision(',
  '-- ---------------------------------------------------------------------------\n-- 7.'
);
const customerSnapshot = between(
  migration,
  'create or replace function public.crm_kpi_customer_snapshot(',
  'revoke all on function public.crm_kpi_customer_snapshot'
);
const search = between(
  migration,
  'create or replace function public.crm_kpi_search_accessible_customers(',
  'revoke all on function public.crm_kpi_search_accessible_customers'
);
const eventAudit = between(
  submit,
  "'event_claim_create', 'kpi_submission_events'",
  'v_ids := v_ids'
);
const revisionAudit = between(
  revision,
  "'event_revision', 'kpi_submission_events'",
  'return v_response'
);

check('migration is transactional', /^begin;[\s\S]*commit;\s*$/m.test(migration));
check('definition mode column defaults NONE', has(migration, "customer_relation_mode text not null default 'NONE'"));
check('definition mode CHECK has all values', has(migration, "customer_relation_mode in ('REQUIRED', 'OPTIONAL', 'NONE')"));
check('definition snapshot freezes mode', has(migration, "'customer_relation_mode', p_definition.customer_relation_mode"));
check('existing snapshots backfill only missing mode', /update public\.kpi_assignments[\s\S]*'customer_relation_mode', 'NONE'[\s\S]*where not \(definition_snapshot \? 'customer_relation_mode'\)/.test(migration));
check('assignment snapshot constraint requires mode', has(migration, "'evidence_required', 'customer_relation_mode'"));

for (const column of [
  'customer_name_snapshot',
  'customer_company_name_snapshot',
  'customer_phone_snapshot',
  'customer_phone_normalized_snapshot',
  'customer_address_snapshot'
]) {
  check(`event has ${column}`, has(migration, `add column if not exists ${column} text`));
}
check('unlinked legacy shape stays valid', /customer_id is null[\s\S]*customer_name_snapshot is null[\s\S]*customer_address_snapshot is null/.test(migration));
check('unsnapshotted linked precondition fails loudly', has(migration, 'KPI2_CUSTOMER_SNAPSHOT_PRECONDITION'));
check('Customer FK is RESTRICT', /foreign key \(customer_id\) references public\.customers\(id\) on delete restrict/.test(migration));
check('partial Customer/event time index exists', /on public\.kpi_submission_events\(customer_id, event_at desc\)[\s\S]*where customer_id is not null/.test(migration));

check('snapshot helper is SECURITY DEFINER', has(customerSnapshot, 'security definer'));
check('snapshot helper locks Customer row', /from public\.customers[\s\S]*for share/.test(customerSnapshot));
check('snapshot helper locks current assignment', /from public\.customer_assignments[\s\S]*and is_current[\s\S]*for share/.test(customerSnapshot));
check('snapshot helper uses authoritative access predicate', has(customerSnapshot, 'crm_can_access_customer_id(v_customer.id)'));
check('guessed Customer raises 42501', /errcode = '42501'[\s\S]*khong co quyen truy cap Customer/.test(customerSnapshot));
check('archived Customer raises 55000', /coalesce\(v_customer\.is_deleted, false\)[\s\S]*errcode = '55000'/.test(customerSnapshot));
check('phone display has normalized fallback', /coalesce\(nullif\(v_customer\.phone_raw, ''\), nullif\(v_customer\.phone_normalized, ''\)\)/.test(customerSnapshot));
check('internal snapshot helper is not client executable', /revoke all on function public\.crm_kpi_customer_snapshot\(text\)[\s\S]*from public, anon, authenticated/.test(migration));

check('submit reads relation mode from assignment snapshot', has(submit, "v_a.definition_snapshot->>'customer_relation_mode'"));
check('submit enforces REQUIRED', /v_customer_mode = 'REQUIRED' and v_customer_id is null/.test(submit));
check('submit enforces NONE', /v_customer_mode = 'NONE' and v_customer_id is not null/.test(submit));
check('submit resolves authoritative Customer in-RPC', has(submit, 'v_customer_snapshot := public.crm_kpi_customer_snapshot(v_customer_id)'));
check('submit writes all dedicated snapshot columns', /customer_name_snapshot, customer_company_name_snapshot,[\s\S]*customer_phone_snapshot, customer_phone_normalized_snapshot,[\s\S]*customer_address_snapshot/.test(submit));
check('submit strips generic Customer metadata', has(submit, 'v_snapshot := public.crm_kpi_strip_customer_metadata(v_snapshot)'));
check('HYBRID client Customer must match source', has(submit, 'Customer ID khong khop authoritative source event'));
check('submit keeps action advisory lock', has(submit, 'pg_advisory_xact_lock'));
check('submit keeps idempotent response binding', has(submit, 'crm_kpi_idempotent_response'));
check('submit keeps evidence attachment lifecycle', /status = 'ATTACHED'[\s\S]*evidence_attach/.test(submit));
check('submit keeps duplicate detection', has(submit, 'kpi_duplicate_matches'));
check('event audit identifies link without Customer PII', has(eventAudit, "'customerId'") && has(eventAudit, "'customerRelationMode'") && has(eventAudit, "'customerLinked'") && !/phone|address/i.test(eventAudit));

check('revision explicitly rejects Customer change', /p_event \? 'customerId'[\s\S]*is distinct from v_old\.customer_id[\s\S]*Revision khong duoc doi Customer/.test(revision));
check('revision inserts immutable old Customer ID', has(revision, 'v_event_at, v_actor, v_old.customer_id'));
check('revision reauthorizes and refreshes Customer snapshot', has(revision, 'v_customer_snapshot := public.crm_kpi_customer_snapshot(v_old.customer_id)'));
check('revision never coalesces a client Customer ID', !has(revision, "coalesce(nullif(p_event->>'customerId'"));
check('revision preserves append-only linkage', /supersedes_event_id, root_event_id, revision_no/.test(revision));
check('revision audit identifies link without Customer PII', has(revisionAudit, "'customerId'") && has(revisionAudit, "'customerRelationMode'") && has(revisionAudit, "'customerLinked'") && !/phone|address/i.test(revisionAudit));

check('search RPC is SECURITY INVOKER', has(search, 'security invoker'));
check('search checks active user', has(search, 'crm_is_active_user()'));
check('search applies current Customer access', has(search, 'crm_can_access_customer_id(c.id)'));
check('search excludes archived Customer', has(search, 'not coalesce(c.is_deleted, false)'));
check('search clamps limit to 50', has(search, 'greatest(1, least(coalesce(p_limit, 20), 50))'));
check('search returns only least-data fields', /returns table\([\s\S]*id text,[\s\S]*name text,[\s\S]*company_name text,[\s\S]*phone_raw text,[\s\S]*phone_normalized text,[\s\S]*address text[\s\S]*\)/.test(search));
check('search is authenticated-only', /grant execute on function public\.crm_kpi_search_accessible_customers\(text, integer\)[\s\S]*to authenticated/.test(migration));

check('create uses a distinct v3 RPC', has(migration, 'crm_kpi_create_definition_v3('));
check('ACTIVE create uses a distinct r4 RPC', has(migration, 'crm_kpi_create_definition_active_r4('));
check('JSON update flow supports camel case mode', has(migration, "p_changes ? 'customerRelationMode'"));
check('no create-v2 signature replacement', !has(migration, 'create or replace function public.crm_kpi_create_definition_v2('));
check('legacy KPI tables are not altered', !/(alter|update|insert into|delete from)\s+(table\s+)?public\.kpi_(rules|proposals)\b/i.test(migration));
check('source snapshot requires current access', /crm_kpi_source_snapshot\([\s\S]*crm_can_access_customer_id/.test(migration));
check('candidate listing requires current access', /crm_kpi_list_hybrid_candidates\([\s\S]*crm_can_access_customer_id/.test(migration));

for (const label of 'ABCDEFGHIJKLMNO') {
  check(`integration contains Test ${label}`, has(integration, `Test ${label}`));
}
check('integration Test B asserts 42501', /Test B[\s\S]*when sqlstate '42501'/.test(integration));
check('integration proves batch row counts unchanged', /Test L[\s\S]*count\(\*\) from public\.kpi_submissions[\s\S]*count\(\*\) from public\.kpi_submission_events/.test(integration));
check('integration is rollback-only', /^begin;[\s\S]*rollback;\s*$/m.test(integration));

if (failures.length) {
  console.error(`KPI-2 Customer-linked static checks: ${passed} PASS, ${failures.length} FAIL`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`KPI-2 Customer-linked static checks: ${passed} checks PASS`);
