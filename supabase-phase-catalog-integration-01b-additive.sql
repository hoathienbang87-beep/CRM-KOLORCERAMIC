-- CATALOG INTEGRATION 01B — additive schema only.
-- Authored for Prompt 01B. Do not apply outside the approved 02A staging gate.
-- This migration intentionally creates no public RPC/view and grants no table
-- access to anon. Existing business values and Product UUIDs are guarded below.
begin;

select pg_advisory_xact_lock(hashtext('CATALOG-INTEGRATION-01B-ADDITIVE'));

-- ---------------------------------------------------------------------------
-- 1. Fail-closed baseline checks and immutable-value guards.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  select string_agg(required_table, ', ' order by required_table)
    into v_missing
  from unnest(array[
    'public.products',
    'public.quote_items',
    'public.product_import_batches',
    'public.product_import_rows',
    'public.product_price_history'
  ]) as required(required_table)
  where to_regclass(required_table) is null;

  if v_missing is not null then
    raise exception 'CATALOG_01B_PRECONDITION_FAIL: missing required tables: %', v_missing;
  end if;

  if to_regclass('public.product_source_mappings') is not null
     or to_regclass('public.website_leads') is not null
     or exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'products'
         and column_name in ('width_mm', 'height_mm', 'data_status', 'is_published')
     ) then
    raise exception 'CATALOG_01B_PRECONDITION_FAIL: migration is already applied or partially applied.';
  end if;

  if exists (
    select 1
    from public.products
    where width_cm is not null
      and (
        width_cm <= 0
        or width_cm * 10 <> trunc(width_cm * 10)
        or width_cm * 10 > 2147483647
      )
  ) or exists (
    select 1
    from public.products
    where height_cm is not null
      and (
        height_cm <= 0
        or height_cm * 10 <> trunc(height_cm * 10)
        or height_cm * 10 > 2147483647
      )
  ) then
    raise exception 'CATALOG_01B_PRECONDITION_FAIL: cm dimensions cannot be converted exactly to positive integer mm.';
  end if;
end;
$$;

create temporary table catalog_01b_products_guard on commit drop as
select id, to_jsonb(p) as old_row
from public.products p;

create temporary table catalog_01b_quote_items_guard on commit drop as
select id, to_jsonb(q) as old_row
from public.quote_items q;

create temporary table catalog_01b_batches_guard on commit drop as
select id, to_jsonb(b) as old_row
from public.product_import_batches b;

create temporary table catalog_01b_rows_guard on commit drop as
select id, to_jsonb(r) as old_row
from public.product_import_rows r;

create temporary table catalog_01b_history_guard on commit drop as
select id, to_jsonb(h) as old_row
from public.product_price_history h;

-- ---------------------------------------------------------------------------
-- 2. Product catalog contract and cm/mm compatibility bridge.
-- ---------------------------------------------------------------------------
alter table public.products
  add column name_normalized text generated always as (
    upper(regexp_replace(btrim(normalize(name, NFKC)), '[[:space:]]+', ' ', 'g'))
  ) stored,
  add column width_mm integer,
  add column height_mm integer,
  add column surface_normalized text generated always as (
    nullif(upper(regexp_replace(btrim(normalize(surface, NFKC)), '[[:space:]]+', ' ', 'g')), '')
  ) stored,
  add column color text,
  add column category text,
  add column collection text,
  add column description text,
  add column image_url text,
  add column gallery_urls jsonb not null default '[]'::jsonb,
  add column pdf_url text,
  add column video_url text,
  add column more_info_url text,
  add column price_unit text not null default 'VND_M2',
  add column data_status text not null default 'UPDATING',
  add column is_published boolean not null default false,
  add column source_metadata jsonb not null default '{}'::jsonb;

-- Contract-approved constraint relaxation for drafts. No column or value is
-- removed; name remains mandatory because nameless rows stay in import staging.
alter table public.products
  alter column code drop not null,
  alter column code_normalized drop not null,
  alter column width_cm drop not null,
  alter column height_cm drop not null,
  alter column price_per_m2 drop not null,
  alter column price_effective_date drop not null;

update public.products
set width_mm = (width_cm * 10)::integer,
    height_mm = (height_cm * 10)::integer
where width_cm is not null
  and height_cm is not null;

update public.products
set data_status = case
  when btrim(name) <> ''
   and width_mm > 0
   and height_mm > 0
   and price_per_m2 > 0
   and price_effective_date is not null
    then 'READY'
  else 'UPDATING'
end;

create function public.crm_catalog_sync_dimensions_01b()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.width_mm is null and new.width_cm is not null then
      if new.width_cm <= 0 or new.width_cm * 10 <> trunc(new.width_cm * 10) then
        raise exception using errcode = '22023', message = 'width_cm must convert exactly to positive integer millimetres.';
      end if;
      new.width_mm := (new.width_cm * 10)::integer;
    elsif new.width_cm is null and new.width_mm is not null then
      new.width_cm := new.width_mm / 10.0;
    end if;

    if new.height_mm is null and new.height_cm is not null then
      if new.height_cm <= 0 or new.height_cm * 10 <> trunc(new.height_cm * 10) then
        raise exception using errcode = '22023', message = 'height_cm must convert exactly to positive integer millimetres.';
      end if;
      new.height_mm := (new.height_cm * 10)::integer;
    elsif new.height_cm is null and new.height_mm is not null then
      new.height_cm := new.height_mm / 10.0;
    end if;
  else
    if new.width_mm is distinct from old.width_mm
       and new.width_cm is not distinct from old.width_cm then
      new.width_cm := case when new.width_mm is null then null else new.width_mm / 10.0 end;
    elsif new.width_cm is distinct from old.width_cm
       and new.width_mm is not distinct from old.width_mm then
      if new.width_cm is not null
         and (new.width_cm <= 0 or new.width_cm * 10 <> trunc(new.width_cm * 10)) then
        raise exception using errcode = '22023', message = 'width_cm must convert exactly to positive integer millimetres.';
      end if;
      new.width_mm := case when new.width_cm is null then null else (new.width_cm * 10)::integer end;
    end if;

    if new.height_mm is distinct from old.height_mm
       and new.height_cm is not distinct from old.height_cm then
      new.height_cm := case when new.height_mm is null then null else new.height_mm / 10.0 end;
    elsif new.height_cm is distinct from old.height_cm
       and new.height_mm is not distinct from old.height_mm then
      if new.height_cm is not null
         and (new.height_cm <= 0 or new.height_cm * 10 <> trunc(new.height_cm * 10)) then
        raise exception using errcode = '22023', message = 'height_cm must convert exactly to positive integer millimetres.';
      end if;
      new.height_mm := case when new.height_cm is null then null else (new.height_cm * 10)::integer end;
    end if;
  end if;

  if (new.width_mm is null) <> (new.width_cm is null)
     or (new.height_mm is null) <> (new.height_cm is null)
     or (new.width_mm is not null and new.width_mm <= 0)
     or (new.height_mm is not null and new.height_mm <= 0)
     or (new.width_mm is not null and new.width_cm * 10 <> new.width_mm)
     or (new.height_mm is not null and new.height_cm * 10 <> new.height_mm) then
    raise exception using errcode = '22023', message = 'cm/mm dimensions must be positive, paired and exactly equivalent.';
  end if;

  new.data_status := case
    when btrim(new.name) <> ''
     and new.width_mm > 0
     and new.height_mm > 0
     and new.price_per_m2 > 0
     and new.price_effective_date is not null
      then 'READY'
    else 'UPDATING'
  end;

  return new;
end;
$$;

create trigger products_catalog_sync_dimensions_01b
before insert or update of name, width_cm, height_cm, width_mm, height_mm,
  price_per_m2, price_effective_date, data_status
on public.products
for each row execute function public.crm_catalog_sync_dimensions_01b();

create function public.crm_catalog_https_url_array_01b(p_urls jsonb)
returns boolean
language sql
immutable
strict
set search_path = public
as $$
  select case
    when jsonb_typeof(p_urls) <> 'array' then false
    else not exists (
      select 1
      from jsonb_array_elements(p_urls) as items(item)
      where jsonb_typeof(item) <> 'string'
         or item #>> '{}' !~ '^https://'
    )
  end;
$$;

alter table public.products
  add constraint products_width_mm_check check (width_mm is null or width_mm > 0),
  add constraint products_height_mm_check check (height_mm is null or height_mm > 0),
  add constraint products_dimension_pairs_check check (
    (width_mm is null and height_mm is null and width_cm is null and height_cm is null)
    or (
      width_mm is not null and height_mm is not null
      and width_cm is not null and height_cm is not null
      and width_cm * 10 = width_mm
      and height_cm * 10 = height_mm
    )
  ),
  add constraint products_price_effective_pair_check check (
    price_per_m2 is null or price_effective_date is not null
  ),
  add constraint products_price_unit_check check (price_unit = 'VND_M2'),
  add constraint products_data_status_check check (data_status in ('UPDATING', 'READY')),
  add constraint products_ready_completeness_check check (
    (data_status = 'READY') = coalesce((
      btrim(name) <> ''
      and width_mm > 0
      and height_mm > 0
      and price_per_m2 > 0
      and price_effective_date is not null
    ), false)
  ),
  add constraint products_publish_gate_check check (
    not is_published or (active and data_status = 'READY')
  ),
  add constraint products_gallery_urls_check check (
    public.crm_catalog_https_url_array_01b(gallery_urls)
  ),
  add constraint products_source_metadata_check check (jsonb_typeof(source_metadata) = 'object'),
  add constraint products_image_url_check check (image_url is null or image_url ~ '^https://'),
  add constraint products_pdf_url_check check (pdf_url is null or pdf_url ~ '^https://'),
  add constraint products_video_url_check check (video_url is null or video_url ~ '^https://'),
  add constraint products_more_info_url_check check (more_info_url is null or more_info_url ~ '^https://');

create index products_catalog_public_idx
  on public.products(name_normalized, id)
  where active and data_status = 'READY' and is_published;

create index products_catalog_variant_lookup_idx
  on public.products(name_normalized, width_mm, height_mm, surface_normalized)
  where data_status = 'READY';

create index products_catalog_status_idx
  on public.products(data_status, is_published, active, updated_at desc, id);

comment on column public.products.width_mm is
  'Canonical ordered width in millimetres. width_cm is a compatibility column during migration.';
comment on column public.products.height_mm is
  'Canonical ordered height in millimetres. height_cm is a compatibility column during migration.';
comment on column public.products.data_status is
  'Catalog readiness only: UPDATING or READY. Vietnamese labels belong in the UI.';
comment on column public.products.is_published is
  'Explicit website publication gate; never inferred from active alone.';

-- ---------------------------------------------------------------------------
-- 3. Source identity and provenance. Firebase SP-* remains source_id text.
-- ---------------------------------------------------------------------------
create table public.product_source_mappings (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  source_system text not null,
  source_id text not null,
  source_checksum text,
  match_rule text,
  verified boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by_user_id text references public.app_users(id) on delete restrict,
  constraint product_source_mappings_source_system_check check (
    btrim(source_system) <> '' and source_system = upper(btrim(source_system))
  ),
  constraint product_source_mappings_source_id_check check (
    btrim(source_id) <> '' and source_id = btrim(source_id)
  ),
  constraint product_source_mappings_checksum_check check (
    source_checksum is null or source_checksum ~ '^[A-Fa-f0-9]{64}$'
  ),
  constraint product_source_mappings_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint product_source_mappings_source_key unique (source_system, source_id)
);

create index product_source_mappings_product_idx
  on public.product_source_mappings(product_id, source_system, id);

-- ---------------------------------------------------------------------------
-- 4. Extend existing import and immutable price-history tables additively.
-- The existing Product R2 columns, constraints, history and RPCs remain intact.
-- ---------------------------------------------------------------------------
alter table public.product_import_batches
  add column import_mode text not null default 'PRICE_UPDATE_ONLY',
  add column source_format text not null default 'PDF',
  add column source_metadata jsonb not null default '{}'::jsonb,
  add column rollback_of_batch_id uuid references public.product_import_batches(id) on delete restrict,
  add column rollback_idempotency_key uuid,
  add column rolled_back_at timestamptz,
  add column rolled_back_by_user_id text references public.app_users(id) on delete restrict,
  add constraint product_import_batches_import_mode_check check (
    import_mode in ('CATALOG_IMPORT', 'PRICE_UPDATE_ONLY', 'ROLLBACK')
  ),
  add constraint product_import_batches_source_format_check check (
    source_format in ('PDF', 'EXCEL', 'MANUAL')
  ),
  add constraint product_import_batches_source_metadata_check check (
    jsonb_typeof(source_metadata) = 'object'
  ),
  add constraint product_import_batches_rollback_self_check check (
    rollback_of_batch_id is null or rollback_of_batch_id <> id
  ),
  add constraint product_import_batches_rollback_idempotency_key unique (rollback_idempotency_key);

alter table public.product_import_rows
  add column source_sheet text,
  add column source_cell_ref text,
  add column source_record_id text,
  add column width_mm integer,
  add column height_mm integer,
  add column surface_normalized text,
  add column disposition text,
  add column match_rule text,
  add column conflict_code text,
  add column previous_snapshot jsonb not null default '{}'::jsonb,
  add column proposed_snapshot jsonb not null default '{}'::jsonb,
  add column rollback_snapshot jsonb not null default '{}'::jsonb,
  add constraint product_import_rows_width_mm_check check (width_mm is null or width_mm > 0),
  add constraint product_import_rows_height_mm_check check (height_mm is null or height_mm > 0),
  add constraint product_import_rows_mm_pair_check check ((width_mm is null) = (height_mm is null)),
  add constraint product_import_rows_disposition_check check (
    disposition is null or disposition in (
      'READY', 'UPDATING', 'MISSING_PRICE', 'MANUAL_REVIEW',
      'DUPLICATE', 'CONFLICT', 'EXCLUDED_BY_REVIEW'
    )
  ),
  add constraint product_import_rows_previous_snapshot_check check (jsonb_typeof(previous_snapshot) = 'object'),
  add constraint product_import_rows_proposed_snapshot_check check (jsonb_typeof(proposed_snapshot) = 'object'),
  add constraint product_import_rows_rollback_snapshot_check check (jsonb_typeof(rollback_snapshot) = 'object');

alter table public.product_price_history
  add column previous_price_per_m2 numeric(18,0),
  add column source_format text not null default 'LEGACY',
  add column change_kind text not null default 'PRICE_SET',
  add column rollback_of_history_id uuid references public.product_price_history(id) on delete restrict,
  add column product_version_before bigint,
  add column product_version_after bigint,
  add column change_metadata jsonb not null default '{}'::jsonb,
  add constraint product_price_history_previous_price_check check (
    previous_price_per_m2 is null or previous_price_per_m2 > 0
  ),
  add constraint product_price_history_source_format_check check (
    source_format in ('LEGACY', 'PDF', 'EXCEL', 'MANUAL')
  ),
  add constraint product_price_history_change_kind_check check (
    change_kind in ('PRICE_SET', 'PRICE_UPDATE', 'ROLLBACK')
  ),
  add constraint product_price_history_rollback_self_check check (
    rollback_of_history_id is null or rollback_of_history_id <> id
  ),
  add constraint product_price_history_version_check check (
    (product_version_before is null or product_version_before > 0)
    and (product_version_after is null or product_version_after > 0)
  ),
  add constraint product_price_history_change_metadata_check check (
    jsonb_typeof(change_metadata) = 'object'
  );

create index product_import_batches_catalog_mode_idx
  on public.product_import_batches(import_mode, status, created_at desc, id);

create index product_import_rows_variant_lookup_idx
  on public.product_import_rows(batch_id, name_normalized, width_mm, height_mm, surface_normalized, id);

create index product_import_rows_disposition_idx
  on public.product_import_rows(batch_id, disposition, source_row_number, id);

create index product_price_history_rollback_idx
  on public.product_price_history(rollback_of_history_id)
  where rollback_of_history_id is not null;

-- Existing quote columns product_sku/product_name/unit_price/qty/unit remain the
-- compatibility snapshots. Only snapshot attributes that do not yet exist are
-- added, so historical rendering remains unchanged.
alter table public.quote_items
  add column width_mm_snapshot integer,
  add column height_mm_snapshot integer,
  add column surface_snapshot text,
  add column list_price_snapshot numeric(18,0),
  add constraint quote_items_width_mm_snapshot_check check (
    width_mm_snapshot is null or width_mm_snapshot > 0
  ),
  add constraint quote_items_height_mm_snapshot_check check (
    height_mm_snapshot is null or height_mm_snapshot > 0
  ),
  add constraint quote_items_dimension_snapshot_pair_check check (
    (width_mm_snapshot is null) = (height_mm_snapshot is null)
  ),
  add constraint quote_items_list_price_snapshot_check check (
    list_price_snapshot is null or list_price_snapshot > 0
  );

-- ---------------------------------------------------------------------------
-- 5. Website lead inbox. No browser role receives table access; 05B/02B must
-- expose a validated, rate-limited RPC instead of direct inserts.
-- ---------------------------------------------------------------------------
create table public.website_leads (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  contact_name text not null,
  phone text,
  email text,
  message text,
  source_path text,
  utm jsonb not null default '{}'::jsonb,
  status text not null default 'NEW',
  privacy_consent_at timestamptz,
  assigned_to_user_id text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_leads_contact_name_check check (
    btrim(contact_name) <> '' and length(contact_name) <= 200
  ),
  constraint website_leads_contact_method_check check (
    nullif(btrim(phone), '') is not null or nullif(btrim(email), '') is not null
  ),
  constraint website_leads_phone_check check (phone is null or length(phone) <= 50),
  constraint website_leads_email_check check (email is null or length(email) <= 320),
  constraint website_leads_message_check check (message is null or length(message) <= 4000),
  constraint website_leads_source_path_check check (source_path is null or length(source_path) <= 1000),
  constraint website_leads_utm_check check (jsonb_typeof(utm) = 'object'),
  constraint website_leads_status_check check (status in ('NEW', 'CONTACTED', 'CLOSED', 'SPAM'))
);

create index website_leads_status_created_idx
  on public.website_leads(status, created_at desc, id);

create index website_leads_product_created_idx
  on public.website_leads(product_id, created_at desc, id)
  where product_id is not null;

alter table public.product_source_mappings enable row level security;
alter table public.website_leads enable row level security;

revoke all on public.product_source_mappings, public.website_leads from public, anon, authenticated;
revoke all on public.product_import_batches, public.product_import_rows, public.product_price_history from anon;
revoke all on function public.crm_catalog_sync_dimensions_01b() from public, anon, authenticated;
revoke all on function public.crm_catalog_https_url_array_01b(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. In-transaction verification. Any mismatch aborts the whole migration.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  select string_agg(required_column, ', ' order by required_column)
    into v_missing
  from unnest(array[
    'products.width_mm',
    'products.height_mm',
    'products.data_status',
    'products.is_published',
    'products.gallery_urls',
    'product_import_batches.import_mode',
    'product_import_batches.source_format',
    'product_import_rows.width_mm',
    'product_import_rows.height_mm',
    'product_price_history.previous_price_per_m2',
    'quote_items.width_mm_snapshot',
    'quote_items.height_mm_snapshot'
  ]) as required(required_column)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = split_part(required_column, '.', 1)
      and c.column_name = split_part(required_column, '.', 2)
  );

  if v_missing is not null then
    raise exception 'CATALOG_01B_VERIFY_FAIL: missing columns: %', v_missing;
  end if;

  if exists (
    select 1
    from catalog_01b_products_guard g
    full join public.products p on p.id = g.id
    where g.id is null
       or p.id is null
       or g.old_row <> to_jsonb(p) - array[
         'name_normalized', 'width_mm', 'height_mm', 'surface_normalized',
         'color', 'category', 'collection', 'description', 'image_url',
         'gallery_urls', 'pdf_url', 'video_url', 'more_info_url', 'price_unit',
         'data_status', 'is_published', 'source_metadata'
       ]::text[]
  ) then
    raise exception 'CATALOG_01B_VERIFY_FAIL: an existing Product ID or business value changed.';
  end if;

  if exists (
    select 1
    from catalog_01b_quote_items_guard g
    full join public.quote_items q on q.id = g.id
    where g.id is null
       or q.id is null
       or g.old_row <> to_jsonb(q) - array[
         'width_mm_snapshot', 'height_mm_snapshot', 'surface_snapshot', 'list_price_snapshot'
       ]::text[]
  ) then
    raise exception 'CATALOG_01B_VERIFY_FAIL: an existing quote item value changed.';
  end if;

  if exists (
    select 1
    from catalog_01b_batches_guard g
    full join public.product_import_batches b on b.id = g.id
    where g.id is null
       or b.id is null
       or g.old_row <> to_jsonb(b) - array[
         'import_mode', 'source_format', 'source_metadata', 'rollback_of_batch_id',
         'rollback_idempotency_key', 'rolled_back_at', 'rolled_back_by_user_id'
       ]::text[]
  ) then
    raise exception 'CATALOG_01B_VERIFY_FAIL: an existing import batch value changed.';
  end if;

  if exists (
    select 1
    from catalog_01b_rows_guard g
    full join public.product_import_rows r on r.id = g.id
    where g.id is null
       or r.id is null
       or g.old_row <> to_jsonb(r) - array[
         'source_sheet', 'source_cell_ref', 'source_record_id', 'width_mm',
         'height_mm', 'surface_normalized', 'disposition', 'match_rule',
         'conflict_code', 'previous_snapshot', 'proposed_snapshot', 'rollback_snapshot'
       ]::text[]
  ) then
    raise exception 'CATALOG_01B_VERIFY_FAIL: an existing import row value changed.';
  end if;

  if exists (
    select 1
    from catalog_01b_history_guard g
    full join public.product_price_history h on h.id = g.id
    where g.id is null
       or h.id is null
       or g.old_row <> to_jsonb(h) - array[
         'previous_price_per_m2', 'source_format', 'change_kind',
         'rollback_of_history_id', 'product_version_before',
         'product_version_after', 'change_metadata'
       ]::text[]
  ) then
    raise exception 'CATALOG_01B_VERIFY_FAIL: an existing price-history value changed.';
  end if;

  if exists (
    select 1
    from public.products
    where (width_cm is null) <> (width_mm is null)
       or (height_cm is null) <> (height_mm is null)
       or (width_mm is not null and width_cm * 10 <> width_mm)
       or (height_mm is not null and height_cm * 10 <> height_mm)
       or (data_status = 'READY' and (
         width_mm is null or height_mm is null or price_per_m2 is null or price_effective_date is null
       ))
       or is_published
  ) then
    raise exception 'CATALOG_01B_VERIFY_FAIL: dimension/readiness/publication backfill is unsafe.';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('product_source_mappings', 'website_leads')
      and not c.relrowsecurity
  ) then
    raise exception 'CATALOG_01B_VERIFY_FAIL: a new internal table does not have RLS enabled.';
  end if;

  if has_table_privilege('anon', 'public.products', 'SELECT')
     or has_table_privilege('anon', 'public.products', 'INSERT')
     or has_table_privilege('anon', 'public.products', 'UPDATE')
     or has_table_privilege('anon', 'public.products', 'DELETE')
     or has_table_privilege('anon', 'public.product_source_mappings', 'SELECT')
     or has_table_privilege('anon', 'public.website_leads', 'INSERT')
     or has_table_privilege('authenticated', 'public.product_source_mappings', 'INSERT')
     or has_table_privilege('authenticated', 'public.website_leads', 'SELECT') then
    raise exception 'CATALOG_01B_VERIFY_FAIL: anon has direct catalog/lead table access.';
  end if;

  if (select count(*) from public.product_source_mappings) <> 0
     or (select count(*) from public.website_leads) <> 0 then
    raise exception 'CATALOG_01B_VERIFY_FAIL: schema migration must not import catalog or lead data.';
  end if;
end;
$$;

comment on table public.product_source_mappings is
  'Internal source identity/provenance. External IDs such as Firebase SP-* never replace Product UUIDs.';
comment on table public.website_leads is
  'Private website lead inbox. Browser access must be mediated by audited RPCs added in a later prompt.';

commit;
