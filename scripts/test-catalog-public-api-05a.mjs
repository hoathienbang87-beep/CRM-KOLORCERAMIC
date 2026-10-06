import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, 'supabase-phase-catalog-integration-05a-public-api-v1.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(root, 'supabase-phase-catalog-integration-05a-rollback.sql'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'scripts', 'test-catalog-05a-staging.sql'), 'utf8');
const rollbackRuntime = fs.readFileSync(path.join(root, 'scripts', 'test-catalog-05a-staging-rollback.sql'), 'utf8');
let checks = 0;

function expect(label, condition) {
  checks += 1;
  if (!condition) throw new Error(`FAIL: ${label}`);
}

const functions = [
  'catalog_public_product_json_v1_05a',
  'catalog_public_resolve_product_id_v1_05a',
  'catalog_public_list_products_v1',
  'catalog_public_get_product_v1',
];

for (const name of functions) {
  expect(`${name} created`, new RegExp(`create function public\\.${name}\\b`, 'i').test(migration));
  expect(`${name} security definer`, new RegExp(`create function public\\.${name}[\\s\\S]*?security definer`, 'i').test(migration));
  expect(`${name} stable`, new RegExp(`create function public\\.${name}[\\s\\S]*?stable`, 'i').test(migration));
  expect(`${name} fixed search path`, new RegExp(`create function public\\.${name}[\\s\\S]*?set search_path = pg_catalog, public`, 'i').test(migration));
  expect(`${name} rollback`, new RegExp(`drop function public\\.${name}\\b`, 'i').test(rollback));
}

const serializer = migration.match(/create function public\.catalog_public_product_json_v1_05a[\s\S]*?\$\$;\s*\n\s*-- Resolve/i)?.[0] ?? '';
for (const field of [
  'id', 'code', 'name', 'width_mm', 'height_mm', 'size_display', 'surface', 'origin',
  'color', 'category', 'collection', 'description', 'image_url', 'gallery_urls',
  'pdf_url', 'video_url', 'more_info_url', 'price_per_m2', 'price_unit', 'price_effective_date',
]) {
  expect(`serializer includes ${field}`, new RegExp(`'${field}'`).test(serializer));
}
for (const field of [
  'stock_quantity', 'source_metadata', 'version', 'created_by_user_id', 'updated_by_user_id',
  'price_per_box', 'price_per_piece', 'pieces_per_box', 'sqm_per_box', 'is_published', 'data_status',
]) {
  expect(`serializer excludes ${field}`, !new RegExp(`'${field}'`).test(serializer));
}

expect('serializer enforces active', /where p\.id = p_product_id[\s\S]*?and p\.active/i.test(serializer));
expect('serializer enforces ready', /and p\.data_status = 'READY'/i.test(serializer));
expect('serializer enforces published', /and p\.is_published/i.test(serializer));
expect('list supports search', /p_search text default null/i.test(migration));
expect('list supports category', /p_category text default null/i.test(migration));
expect('list supports collection', /p_collection text default null/i.test(migration));
expect('list supports surface', /p_surface text default null/i.test(migration));
expect('list supports ordered width', /p_width_mm integer default null/i.test(migration));
expect('list supports ordered height', /p_height_mm integer default null/i.test(migration));
expect('list supports price range', /p_min_price numeric default null[\s\S]*p_max_price numeric default null/i.test(migration));
expect('list bounds limit', /p_limit < 1 or p_limit > 100/i.test(migration));
expect('list bounds offset', /p_offset < 0 or p_offset > 100000/i.test(migration));
expect('list reports total', /'total', \(select count\(\*\) from filtered\)/i.test(migration));
expect('list reports has more', /'has_more'/i.test(migration));
expect('list reports next offset', /'next_offset'/i.test(migration));
expect('detail accepts identifier', /catalog_public_get_product_v1\(p_identifier text\)/i.test(migration));
expect('legacy source lookup requires verified', /where m\.verified/i.test(migration));
expect('legacy source lookup requires unique product', /v_mapping_count[\s\S]*<> 1/i.test(migration));
expect('helper denied to anon', /revoke all on function public\.catalog_public_product_json_v1_05a\(uuid\) from public, anon, authenticated;/i.test(migration));
expect('resolver denied to anon', /revoke all on function public\.catalog_public_resolve_product_id_v1_05a\(text\) from public, anon, authenticated;/i.test(migration));
expect('list granted to anon and authenticated', /grant execute on function public\.catalog_public_list_products_v1[^;]+to anon, authenticated;/i.test(migration));
expect('detail granted to anon and authenticated', /grant execute on function public\.catalog_public_get_product_v1\(text\) to anon, authenticated;/i.test(migration));
expect('migration verifies no anon product table read', /has_table_privilege\('anon', 'public\.products', 'SELECT'\)/i.test(migration));
expect('migration verifies no anon mappings read', /has_table_privilege\('anon', 'public\.product_source_mappings', 'SELECT'\)/i.test(migration));
expect('migration is transactional', /(?:^|\n)begin;[\s\S]*commit;\s*$/i.test(migration.trim()));
expect('rollback is transactional', /(?:^|\n)begin;[\s\S]*commit;\s*$/i.test(rollback.trim()));
expect('runtime is staging guarded', /expected post-04 staging baseline 123\/75\/0/i.test(runtime));
expect('runtime switches to anon', /set local role anon;/i.test(runtime));
expect('runtime checks search', /CATALOG_05A_TEST_FAIL: search/i.test(runtime));
expect('runtime checks filters', /CATALOG_05A_TEST_FAIL: combined filters/i.test(runtime));
expect('runtime checks pagination', /CATALOG_05A_TEST_FAIL: first page contract/i.test(runtime));
expect('runtime checks projection', /CATALOG_05A_TEST_FAIL: public projection/i.test(runtime));
expect('runtime checks UUID code and source ID', /CATALOG_05A_TEST_FAIL: detail identifier or publish gate/i.test(runtime));
expect('runtime checks direct table denial', /CATALOG_05A_TEST_FAIL: anon direct products read/i.test(runtime));
expect('runtime rolls back fixtures', /rollback;[\s\S]*Independent post-rollback proof/i.test(runtime));
expect('runtime checks no residue', /CATALOG_05A_TEST_FAIL: fixture rollback residue/i.test(runtime));
expect('rollback rehearsal has staging guard', /expected post-04 staging baseline 123\/75\/0/i.test(rollbackRuntime));
expect('rollback rehearsal preserves 02B RPCs', /02B compatibility RPCs were removed/i.test(rollbackRuntime));
expect('rollback rehearsal restores v1 functions', /rollback rehearsal was not fully reverted/i.test(rollbackRuntime));
expect('rollback rehearsal is self-reverting', /rollback;[\s\S]*Read-back after rollback of the rehearsal transaction/i.test(rollbackRuntime));

console.log(`PASS: Catalog 05A public API static checks (${checks} checks).`);
