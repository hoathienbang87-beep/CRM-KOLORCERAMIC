-- PRODUCT-R2 STEP 3 — clean Product schema + dependency cutover.
-- Owner authority: 404 Product R1 rows are disposable and MUST NOT migrate.
-- This migration is intentionally one-shot and fail-closed against the verified
-- production baseline. It does not import or seed any Product.

begin;

select pg_advisory_xact_lock(hashtext('PRODUCT-R2-STEP3-CLEAN-CUTOVER'));

-- ---------------------------------------------------------------------------
-- 0. Fail-fast production preconditions before any destructive statement.
-- ---------------------------------------------------------------------------
do $$
declare
  v_product_count integer;
  v_quote_refs integer;
  v_order_refs integer;
  v_inventory_refs integer;
begin
  if to_regclass('public.products') is null
     or to_regclass('public.quote_items') is null
     or to_regclass('public.order_items') is null
     or to_regclass('public.inventory_movements') is null
     or to_regclass('public.app_users') is null
     or to_regclass('public.audit_logs') is null then
    raise exception 'PRODUCT_R2_PRECONDITION_FAIL: thiếu bảng dependency bắt buộc.';
  end if;

  if to_regprocedure('public.crm_current_app_user_id()') is null
     or to_regprocedure('public.crm_current_user_role()') is null
     or to_regprocedure('public.crm_is_active_user()') is null
     or to_regprocedure('public.crm_write_audit(text,text,text,jsonb)') is null then
    raise exception 'PRODUCT_R2_PRECONDITION_FAIL: thiếu canonical identity/audit helper.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='products' and column_name='id' and data_type='text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='products' and column_name='sku'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='products' and column_name='price'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='products' and column_name='raw_data'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='products' and column_name='is_deleted'
  ) then
    raise exception 'PRODUCT_R2_PRECONDITION_FAIL: products không còn đúng R1 baseline.';
  end if;

  select count(*) into v_product_count from public.products;
  select count(*) into v_quote_refs from public.quote_items where product_id is not null;
  select count(*) into v_order_refs from public.order_items where product_id is not null;
  select count(*) into v_inventory_refs from public.inventory_movements where product_id is not null;

  if v_product_count <> 404 then
    raise exception 'PRODUCT_R2_PRECONDITION_FAIL: products có % rows, kỳ vọng chính xác 404.', v_product_count;
  end if;
  if v_quote_refs <> 1 then
    raise exception 'PRODUCT_R2_PRECONDITION_FAIL: quote_items có % Product refs, kỳ vọng 1.', v_quote_refs;
  end if;
  if exists (
    select 1 from public.quote_items
    where product_id is not null
      and (nullif(btrim(product_sku),'') is null
        or nullif(btrim(product_name),'') is null
        or nullif(btrim(unit),'') is null
        or unit_price is null or unit_price <= 0
        or raw_data is null or jsonb_typeof(raw_data) <> 'object')
  ) then
    raise exception 'PRODUCT_R2_PRECONDITION_FAIL: quote snapshot không đủ giữ lịch sử.';
  end if;
  if v_order_refs <> 0 then
    raise exception 'PRODUCT_R2_PRECONDITION_FAIL: order_items xuất hiện % Product refs.', v_order_refs;
  end if;
  if v_inventory_refs <> 0 then
    raise exception 'PRODUCT_R2_PRECONDITION_FAIL: inventory_movements xuất hiện % Product refs.', v_inventory_refs;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='quote_items_product_id_fkey'
      and conrelid='public.quote_items'::regclass
      and pg_get_constraintdef(oid,true)='FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL'
  ) or not exists (
    select 1 from pg_constraint
    where conname='order_items_product_id_fkey'
      and conrelid='public.order_items'::regclass
      and pg_get_constraintdef(oid,true)='FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL'
  ) or not exists (
    select 1 from pg_constraint
    where conname='inventory_movements_product_id_fkey'
      and conrelid='public.inventory_movements'::regclass
      and pg_get_constraintdef(oid,true)='FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL'
  ) then
    raise exception 'PRODUCT_R2_PRECONDITION_FAIL: Product FK definitions đã thay đổi.';
  end if;

  if to_regclass('public.product_inventory_balance') is null then
    raise exception 'PRODUCT_R2_PRECONDITION_FAIL: thiếu legacy product_inventory_balance view.';
  end if;
end;
$$;

lock table public.products, public.quote_items, public.order_items,
  public.inventory_movements in access exclusive mode;

-- ---------------------------------------------------------------------------
-- 1. Preserve historic transaction snapshots; detach legacy Product identity.
-- ---------------------------------------------------------------------------
update public.quote_items set product_id = null where product_id is not null;

drop view public.product_inventory_balance;

alter table public.quote_items drop constraint quote_items_product_id_fkey;
alter table public.order_items drop constraint order_items_product_id_fkey;
alter table public.inventory_movements drop constraint inventory_movements_product_id_fkey;

-- Product-R2 does not use inventory_movements as stock authority. The legacy
-- snapshot table may remain for old order behavior, but no FK/view couples it
-- to the canonical Product catalog.

-- ---------------------------------------------------------------------------
-- 2. Remove R1 runtime database contracts before changing the row type.
-- ---------------------------------------------------------------------------
drop trigger if exists products_guard_soft_delete on public.products;
drop function if exists public.crm_guard_product_soft_delete();
drop function if exists public.crm_update_product(text, jsonb);
drop function if exists public.crm_create_product(jsonb);
drop function if exists public.crm_list_products();
drop policy if exists "products active employee read" on public.products;

-- ---------------------------------------------------------------------------
-- 3. Owner-authorized destructive reset and clean in-place rebuild.
-- ---------------------------------------------------------------------------
delete from public.products;

alter table public.products drop constraint if exists products_updated_by_user_id_fkey;
alter table public.products
  drop column name,
  drop column sku,
  drop column price,
  drop column unit,
  drop column active,
  drop column created_at,
  drop column updated_at,
  drop column raw_data,
  drop column is_deleted,
  drop column stock_quantity,
  drop column updated_by_user_id;

alter table public.products alter column id drop default;
alter table public.products alter column id type uuid using id::uuid;
alter table public.products alter column id set default gen_random_uuid();

alter table public.products
  add column code text not null,
  add column code_normalized text generated always as (
    upper(regexp_replace(btrim(normalize(code, NFKC)), '[[:space:]]+', ' ', 'g'))
  ) stored not null,
  add column name text not null,
  add column width_cm numeric(9,3) not null,
  add column height_cm numeric(9,3) not null,
  add column price_per_m2 numeric(18,0) not null,
  add column price_per_box numeric(18,0),
  add column price_per_piece numeric(18,0),
  add column pieces_per_box integer,
  add column sqm_per_box numeric(12,4),
  add column surface text,
  add column origin text,
  add column stock_quantity numeric(18,4),
  add column price_effective_date date not null,
  add column active boolean not null default true,
  add column version bigint not null default 1,
  add column created_at timestamptz not null default now(),
  add column created_by_user_id text not null,
  add column updated_at timestamptz not null default now(),
  add column updated_by_user_id text not null,
  add constraint products_code_nonempty_check check (btrim(code) <> ''),
  add constraint products_code_normalized_nonempty_check check (btrim(code_normalized) <> ''),
  add constraint products_name_nonempty_check check (btrim(name) <> ''),
  add constraint products_width_cm_check check (width_cm > 0 and width_cm <= 10000),
  add constraint products_height_cm_check check (height_cm > 0 and height_cm <= 10000),
  add constraint products_price_per_m2_check check (price_per_m2 > 0),
  add constraint products_price_per_box_check check (price_per_box is null or price_per_box > 0),
  add constraint products_price_per_piece_check check (price_per_piece is null or price_per_piece > 0),
  add constraint products_pieces_per_box_check check (pieces_per_box is null or pieces_per_box between 1 and 10000),
  add constraint products_sqm_per_box_check check (sqm_per_box is null or (sqm_per_box > 0 and sqm_per_box <= 100000)),
  add constraint products_surface_check check (surface is null or btrim(surface) <> ''),
  add constraint products_origin_check check (origin is null or btrim(origin) <> ''),
  add constraint products_stock_quantity_check check (stock_quantity is null or stock_quantity >= 0),
  add constraint products_version_check check (version > 0),
  add constraint products_code_normalized_key unique (code_normalized),
  add constraint products_created_by_user_id_fkey foreign key (created_by_user_id)
    references public.app_users(id) on delete restrict,
  add constraint products_updated_by_user_id_fkey foreign key (updated_by_user_id)
    references public.app_users(id) on delete restrict;

create index products_active_name_id_idx on public.products(active, name, id);
create index products_updated_at_idx on public.products(updated_at desc, id);

comment on table public.products is
  'PRODUCT-R2 canonical clean catalog. No legacy price/unit/sku/raw_data/is_deleted authority.';
comment on column public.products.stock_quantity is
  'Lightweight manually maintained reference. NULL means unknown; zero means real zero. Not derived from inventory_movements.';
comment on column public.products.price_effective_date is
  'Business effective date for the current price/package snapshot; distinct from system timestamps.';

-- New transaction rows may reference native Product UUID. Historical snapshot
-- columns remain unchanged. No arbitrary legacy text is cast.
alter table public.quote_items alter column product_id type uuid using product_id::uuid;
alter table public.order_items alter column product_id type uuid using product_id::uuid;
alter table public.quote_items add constraint quote_items_product_id_fkey
  foreign key (product_id) references public.products(id) on delete set null;
alter table public.order_items add constraint order_items_product_id_fkey
  foreign key (product_id) references public.products(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. Future import provenance schema (no parser/RPC/UI in STEP 3).
-- ---------------------------------------------------------------------------
create table public.product_import_batches (
  id uuid primary key default gen_random_uuid(),
  supplier text not null check (btrim(supplier) <> ''),
  source_filename text not null check (btrim(source_filename) <> '' and length(source_filename) <= 255),
  source_sha256 text not null check (source_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  source_file_size_bytes bigint not null check (source_file_size_bytes > 0),
  storage_object_path text,
  parser_adapter text not null check (btrim(parser_adapter) <> ''),
  parser_version text not null check (btrim(parser_version) <> ''),
  effective_date date not null,
  status text not null default 'STAGED' check (status in ('STAGED','READY','APPLIED','FAILED','CANCELLED')),
  failure_code text,
  failure_detail text check (failure_detail is null or length(failure_detail) <= 4000),
  confirm_idempotency_key uuid unique,
  created_by_user_id text not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  confirmed_by_user_id text references public.app_users(id) on delete restrict,
  confirmed_at timestamptz,
  applied_at timestamptz,
  constraint product_import_batches_failure_state_check check (
    (status='FAILED' and failure_code is not null) or (status<>'FAILED' and failure_code is null and failure_detail is null)
  )
);

create unique index product_import_batches_source_adapter_key
  on public.product_import_batches(lower(source_sha256), parser_adapter, parser_version);

create table public.product_price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  price_per_m2 numeric(18,0) not null check (price_per_m2 > 0),
  price_per_box numeric(18,0) check (price_per_box is null or price_per_box > 0),
  price_per_piece numeric(18,0) check (price_per_piece is null or price_per_piece > 0),
  pieces_per_box integer check (pieces_per_box is null or pieces_per_box between 1 and 10000),
  sqm_per_box numeric(12,4) check (sqm_per_box is null or (sqm_per_box > 0 and sqm_per_box <= 100000)),
  effective_date date not null,
  source_type text not null check (source_type in ('MANUAL','PDF_IMPORT')),
  import_batch_id uuid references public.product_import_batches(id) on delete restrict,
  changed_by_user_id text not null references public.app_users(id) on delete restrict,
  changed_at timestamptz not null default now(),
  reason text check (reason is null or length(reason) <= 1000),
  constraint product_price_history_source_check check (
    (source_type='MANUAL' and import_batch_id is null)
    or (source_type='PDF_IMPORT' and import_batch_id is not null)
  )
);

create index product_price_history_product_effective_idx
  on public.product_price_history(product_id, effective_date desc, changed_at desc);
create unique index product_price_history_batch_product_key
  on public.product_price_history(import_batch_id, product_id)
  where import_batch_id is not null;

create table public.product_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.product_import_batches(id) on delete cascade,
  source_page smallint not null check (source_page > 0),
  source_row_number integer not null check (source_row_number > 0),
  source_values jsonb not null check (jsonb_typeof(source_values)='object'),
  source_size_text text,
  source_size_unit text check (source_size_unit is null or source_size_unit in ('cm','mm')),
  source_packaging_text text,
  code text,
  code_normalized text,
  name text,
  name_normalized text,
  width_cm numeric(9,3),
  height_cm numeric(9,3),
  price_per_m2 numeric(18,0),
  price_per_box numeric(18,0),
  price_per_piece numeric(18,0),
  pieces_per_box integer,
  sqm_per_box numeric(12,4),
  surface_candidate text,
  origin_candidate text,
  warnings text[] not null default '{}',
  classification text not null check (classification in ('NEW','UNCHANGED','CHANGED','DUPLICATE_IN_FILE','CONFLICT','INVALID','REVIEW')),
  matched_product_id uuid references public.products(id) on delete set null,
  diff jsonb not null default '{}',
  selected_action text not null default 'NONE' check (selected_action in ('NONE','CREATE','UPDATE','COLLAPSE_DUPLICATE','SKIP')),
  current_product_version bigint,
  current_fingerprint text,
  created_at timestamptz not null default now(),
  unique(batch_id, source_page, source_row_number)
);

-- ---------------------------------------------------------------------------
-- 5. Immutable history guard and payload parsing helpers.
-- ---------------------------------------------------------------------------
create function public.crm_guard_product_price_history_immutable()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception using errcode='42501', message='Lịch sử giá sản phẩm là bất biến.';
end;
$$;

create trigger product_price_history_immutable
before update or delete on public.product_price_history
for each row execute function public.crm_guard_product_price_history_immutable();

create function public.crm_product_parse_numeric(
  p_payload jsonb,
  p_key text,
  p_required boolean,
  p_allow_zero boolean,
  p_scale integer
)
returns numeric
language plpgsql immutable set search_path=public
as $$
declare
  v_text text;
  v_value numeric;
  v_pattern text;
begin
  if not (p_payload ? p_key) or p_payload->p_key = 'null'::jsonb then
    if p_required then
      raise exception using errcode='22023', message='Thiếu trường số bắt buộc: ' || p_key;
    end if;
    return null;
  end if;
  if jsonb_typeof(p_payload->p_key) not in ('number','string') then
    raise exception using errcode='22023', message='Trường số không hợp lệ: ' || p_key;
  end if;
  v_text := btrim(p_payload->>p_key);
  v_pattern := case when p_scale=0 then '^[0-9]+$'
    else '^[0-9]+([.][0-9]{1,' || p_scale::text || '})?$' end;
  if v_text !~ v_pattern then
    raise exception using errcode='22023', message='Trường số không hợp lệ: ' || p_key;
  end if;
  begin
    v_value := v_text::numeric;
  exception when others then
    raise exception using errcode='22023', message='Trường số không hợp lệ: ' || p_key;
  end;
  if (p_allow_zero and v_value < 0) or (not p_allow_zero and v_value <= 0) then
    raise exception using errcode='22023', message='Trường số ngoài phạm vi: ' || p_key;
  end if;
  return v_value;
end;
$$;

create function public.crm_product_parse_date(p_payload jsonb, p_key text, p_required boolean)
returns date
language plpgsql immutable set search_path=public
as $$
declare
  v_text text;
  v_value date;
begin
  if not (p_payload ? p_key) or p_payload->p_key = 'null'::jsonb then
    if p_required then
      raise exception using errcode='22023', message='Thiếu ngày bắt buộc: ' || p_key;
    end if;
    return null;
  end if;
  if jsonb_typeof(p_payload->p_key) <> 'string' then
    raise exception using errcode='22023', message='Ngày không hợp lệ: ' || p_key;
  end if;
  v_text := btrim(p_payload->>p_key);
  if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode='22023', message='Ngày không hợp lệ: ' || p_key;
  end if;
  begin
    v_value := v_text::date;
  exception when others then
    raise exception using errcode='22023', message='Ngày không hợp lệ: ' || p_key;
  end;
  return v_value;
end;
$$;

create function public.crm_product_json(p_product_id uuid)
returns jsonb
language sql stable security definer set search_path=public
as $$
  select jsonb_build_object(
    'id',p.id,'code',p.code,'name',p.name,
    'width_cm',p.width_cm::text,'height_cm',p.height_cm::text,
    'price_per_m2',p.price_per_m2::text,
    'price_per_box',case when p.price_per_box is null then null else to_jsonb(p.price_per_box::text) end,
    'price_per_piece',case when p.price_per_piece is null then null else to_jsonb(p.price_per_piece::text) end,
    'pieces_per_box',p.pieces_per_box,
    'sqm_per_box',case when p.sqm_per_box is null then null else to_jsonb(p.sqm_per_box::text) end,
    'surface',p.surface,'origin',p.origin,
    'stock_quantity',case when p.stock_quantity is null then null else to_jsonb(p.stock_quantity::text) end,
    'price_effective_date',p.price_effective_date,
    'active',p.active,'version',p.version,
    'created_at',p.created_at,'created_by_user_id',p.created_by_user_id,
    'created_by_name',cu.name,
    'updated_at',p.updated_at,'updated_by_user_id',p.updated_by_user_id,
    'updated_by_name',uu.name
  )
  from public.products p
  left join public.app_users cu on cu.id=p.created_by_user_id
  left join public.app_users uu on uu.id=p.updated_by_user_id
  where p.id=p_product_id;
$$;

-- ---------------------------------------------------------------------------
-- 6. Canonical Product-R2 RPCs.
-- ---------------------------------------------------------------------------
create function public.crm_list_products()
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare
  v_role text := public.crm_current_user_role();
begin
  if auth.uid() is null or not coalesce(public.crm_is_active_user(),false)
     or v_role not in ('sale','manager','admin','owner') then
    raise exception using errcode='42501', message='Bạn không có quyền đọc sản phẩm.';
  end if;
  return coalesce((
    select jsonb_agg(public.crm_product_json(p.id) order by p.active desc,p.code_normalized,p.id)
    from public.products p
    where p.active or v_role in ('manager','admin','owner')
  ),'[]'::jsonb);
end;
$$;

create function public.crm_create_product(p_product jsonb)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_actor text := public.crm_current_app_user_id();
  v_code text;
  v_name text;
  v_surface text;
  v_origin text;
  v_width numeric;
  v_height numeric;
  v_price_m2 numeric;
  v_price_box numeric;
  v_price_piece numeric;
  v_pieces integer;
  v_sqm numeric;
  v_stock numeric;
  v_effective date;
  v_id uuid;
begin
  if auth.uid() is null or not coalesce(public.crm_is_active_user(),false)
     or public.crm_current_user_role() not in ('sale','manager','admin','owner') or v_actor is null then
    raise exception using errcode='42501', message='Bạn không có quyền tạo sản phẩm.';
  end if;
  if p_product is null or jsonb_typeof(p_product)<>'object' then
    raise exception using errcode='22023', message='Dữ liệu sản phẩm không hợp lệ.';
  end if;
  if exists (select 1 from jsonb_object_keys(p_product) k where k not in (
    'code','name','width_cm','height_cm','price_per_m2','price_per_box','price_per_piece',
    'pieces_per_box','sqm_per_box','surface','origin','stock_quantity','price_effective_date'
  )) then
    raise exception using errcode='22023', message='Trường sản phẩm không được phép.';
  end if;
  if exists (select 1 from jsonb_each(p_product) e where e.key in ('code','name','surface','origin')
    and jsonb_typeof(e.value) not in ('string','null')) then
    raise exception using errcode='22023', message='Thông tin văn bản không hợp lệ.';
  end if;

  v_code := nullif(btrim(p_product->>'code'),'');
  v_name := nullif(btrim(p_product->>'name'),'');
  if v_code is null or v_name is null then
    raise exception using errcode='22023', message='Mã và tên sản phẩm là bắt buộc.';
  end if;
  v_surface := nullif(btrim(p_product->>'surface'),'');
  v_origin := nullif(btrim(p_product->>'origin'),'');
  v_width := public.crm_product_parse_numeric(p_product,'width_cm',true,false,3);
  v_height := public.crm_product_parse_numeric(p_product,'height_cm',true,false,3);
  v_price_m2 := public.crm_product_parse_numeric(p_product,'price_per_m2',true,false,0);
  v_price_box := public.crm_product_parse_numeric(p_product,'price_per_box',false,false,0);
  v_price_piece := public.crm_product_parse_numeric(p_product,'price_per_piece',false,false,0);
  v_pieces := public.crm_product_parse_numeric(p_product,'pieces_per_box',false,false,0)::integer;
  v_sqm := public.crm_product_parse_numeric(p_product,'sqm_per_box',false,false,4);
  v_stock := public.crm_product_parse_numeric(p_product,'stock_quantity',false,true,4);
  v_effective := public.crm_product_parse_date(p_product,'price_effective_date',true);

  if v_width>10000 or v_height>10000 or coalesce(v_pieces,1)>10000 or coalesce(v_sqm,1)>100000 then
    raise exception using errcode='22023', message='Kích thước hoặc đóng gói ngoài phạm vi.';
  end if;

  insert into public.products(
    code,name,width_cm,height_cm,price_per_m2,price_per_box,price_per_piece,
    pieces_per_box,sqm_per_box,surface,origin,stock_quantity,price_effective_date,
    created_by_user_id,updated_by_user_id
  ) values (
    v_code,v_name,v_width,v_height,v_price_m2,v_price_box,v_price_piece,
    v_pieces,v_sqm,v_surface,v_origin,v_stock,v_effective,v_actor,v_actor
  ) returning id into v_id;

  insert into public.product_price_history(
    product_id,price_per_m2,price_per_box,price_per_piece,pieces_per_box,sqm_per_box,
    effective_date,source_type,changed_by_user_id
  ) values (v_id,v_price_m2,v_price_box,v_price_piece,v_pieces,v_sqm,v_effective,'MANUAL',v_actor);

  perform public.crm_write_audit('createProductR2','products',v_id::text,
    jsonb_build_object('code',v_code,'name',v_name,'version',1,'priceEffectiveDate',v_effective));
  return public.crm_product_json(v_id);
end;
$$;

create function public.crm_update_product(
  p_product_id uuid,
  p_expected_version bigint,
  p_changes jsonb
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_actor text := public.crm_current_app_user_id();
  v_old public.products%rowtype;
  v_code text;
  v_name text;
  v_surface text;
  v_origin text;
  v_width numeric;
  v_height numeric;
  v_price_m2 numeric;
  v_price_box numeric;
  v_price_piece numeric;
  v_pieces integer;
  v_sqm numeric;
  v_stock numeric;
  v_effective date;
  v_price_context_changed boolean;
  v_material_changed boolean;
begin
  if auth.uid() is null or not coalesce(public.crm_is_active_user(),false)
     or public.crm_current_user_role() not in ('sale','manager','admin','owner') or v_actor is null then
    raise exception using errcode='42501', message='Bạn không có quyền cập nhật sản phẩm.';
  end if;
  if p_product_id is null or p_expected_version is null or p_expected_version<=0
     or p_changes is null or jsonb_typeof(p_changes)<>'object' then
    raise exception using errcode='22023', message='Yêu cầu cập nhật sản phẩm không hợp lệ.';
  end if;
  if exists (select 1 from jsonb_object_keys(p_changes) k where k not in (
    'code','name','width_cm','height_cm','price_per_m2','price_per_box','price_per_piece',
    'pieces_per_box','sqm_per_box','surface','origin','stock_quantity','price_effective_date'
  )) then
    raise exception using errcode='22023', message='Trường sản phẩm không được phép.';
  end if;
  if exists (select 1 from jsonb_each(p_changes) e where e.key in ('code','name','surface','origin')
    and jsonb_typeof(e.value) not in ('string','null')) then
    raise exception using errcode='22023', message='Thông tin văn bản không hợp lệ.';
  end if;

  select * into v_old from public.products where id=p_product_id for update;
  if v_old.id is null then
    raise exception using errcode='P0002', message='Không tìm thấy sản phẩm.';
  end if;
  if v_old.version<>p_expected_version then
    raise exception using errcode='40001', message='Sản phẩm đã được người khác cập nhật. Hãy tải lại.';
  end if;

  v_code := case when p_changes?'code' then nullif(btrim(p_changes->>'code'),'') else v_old.code end;
  v_name := case when p_changes?'name' then nullif(btrim(p_changes->>'name'),'') else v_old.name end;
  if v_code is null or v_name is null then
    raise exception using errcode='22023', message='Mã và tên sản phẩm là bắt buộc.';
  end if;
  v_surface := case when p_changes?'surface' then nullif(btrim(p_changes->>'surface'),'') else v_old.surface end;
  v_origin := case when p_changes?'origin' then nullif(btrim(p_changes->>'origin'),'') else v_old.origin end;
  v_width := case when p_changes?'width_cm' then public.crm_product_parse_numeric(p_changes,'width_cm',true,false,3) else v_old.width_cm end;
  v_height := case when p_changes?'height_cm' then public.crm_product_parse_numeric(p_changes,'height_cm',true,false,3) else v_old.height_cm end;
  v_price_m2 := case when p_changes?'price_per_m2' then public.crm_product_parse_numeric(p_changes,'price_per_m2',true,false,0) else v_old.price_per_m2 end;
  v_price_box := case when p_changes?'price_per_box' then public.crm_product_parse_numeric(p_changes,'price_per_box',false,false,0) else v_old.price_per_box end;
  v_price_piece := case when p_changes?'price_per_piece' then public.crm_product_parse_numeric(p_changes,'price_per_piece',false,false,0) else v_old.price_per_piece end;
  v_pieces := case when p_changes?'pieces_per_box' then public.crm_product_parse_numeric(p_changes,'pieces_per_box',false,false,0)::integer else v_old.pieces_per_box end;
  v_sqm := case when p_changes?'sqm_per_box' then public.crm_product_parse_numeric(p_changes,'sqm_per_box',false,false,4) else v_old.sqm_per_box end;
  v_stock := case when p_changes?'stock_quantity' then public.crm_product_parse_numeric(p_changes,'stock_quantity',false,true,4) else v_old.stock_quantity end;
  v_effective := case when p_changes?'price_effective_date' then public.crm_product_parse_date(p_changes,'price_effective_date',true) else v_old.price_effective_date end;

  if v_width>10000 or v_height>10000 or coalesce(v_pieces,1)>10000 or coalesce(v_sqm,1)>100000 then
    raise exception using errcode='22023', message='Kích thước hoặc đóng gói ngoài phạm vi.';
  end if;

  v_price_context_changed :=
    v_price_m2 is distinct from v_old.price_per_m2
    or v_price_box is distinct from v_old.price_per_box
    or v_price_piece is distinct from v_old.price_per_piece
    or v_pieces is distinct from v_old.pieces_per_box
    or v_sqm is distinct from v_old.sqm_per_box
    or v_effective is distinct from v_old.price_effective_date;

  v_material_changed := v_price_context_changed
    or v_code is distinct from v_old.code
    or v_name is distinct from v_old.name
    or v_width is distinct from v_old.width_cm
    or v_height is distinct from v_old.height_cm
    or v_surface is distinct from v_old.surface
    or v_origin is distinct from v_old.origin
    or v_stock is distinct from v_old.stock_quantity;

  if not v_material_changed then
    return public.crm_product_json(v_old.id);
  end if;

  update public.products set
    code=v_code,name=v_name,width_cm=v_width,height_cm=v_height,
    price_per_m2=v_price_m2,price_per_box=v_price_box,price_per_piece=v_price_piece,
    pieces_per_box=v_pieces,sqm_per_box=v_sqm,surface=v_surface,origin=v_origin,
    stock_quantity=v_stock,price_effective_date=v_effective,
    version=v_old.version+1,updated_at=now(),updated_by_user_id=v_actor
  where id=v_old.id;

  if v_price_context_changed then
    insert into public.product_price_history(
      product_id,price_per_m2,price_per_box,price_per_piece,pieces_per_box,sqm_per_box,
      effective_date,source_type,changed_by_user_id
    ) values (v_old.id,v_price_m2,v_price_box,v_price_piece,v_pieces,v_sqm,v_effective,'MANUAL',v_actor);
  end if;

  perform public.crm_write_audit('updateProductR2','products',v_old.id::text,
    jsonb_build_object('code',v_code,'name',v_name,'fromVersion',v_old.version,
      'toVersion',v_old.version+1,'priceContextChanged',v_price_context_changed));
  return public.crm_product_json(v_old.id);
end;
$$;

create function public.crm_set_product_active(
  p_product_id uuid,
  p_expected_version bigint,
  p_active boolean
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_actor text := public.crm_current_app_user_id();
  v_old public.products%rowtype;
begin
  if auth.uid() is null or not coalesce(public.crm_is_active_user(),false)
     or public.crm_current_user_role() not in ('manager','admin','owner') or v_actor is null then
    raise exception using errcode='42501', message='Bạn không có quyền thay đổi trạng thái sản phẩm.';
  end if;
  if p_product_id is null or p_expected_version is null or p_expected_version<=0 or p_active is null then
    raise exception using errcode='22023', message='Yêu cầu trạng thái sản phẩm không hợp lệ.';
  end if;
  select * into v_old from public.products where id=p_product_id for update;
  if v_old.id is null then
    raise exception using errcode='P0002', message='Không tìm thấy sản phẩm.';
  end if;
  if v_old.version<>p_expected_version then
    raise exception using errcode='40001', message='Sản phẩm đã được người khác cập nhật. Hãy tải lại.';
  end if;
  if v_old.active=p_active then
    return public.crm_product_json(v_old.id);
  end if;
  update public.products set active=p_active,version=v_old.version+1,
    updated_at=now(),updated_by_user_id=v_actor where id=v_old.id;
  perform public.crm_write_audit(
    case when p_active then 'reactivateProductR2' else 'archiveProductR2' end,
    'products',v_old.id::text,
    jsonb_build_object('code',v_old.code,'fromVersion',v_old.version,'toVersion',v_old.version+1)
  );
  return public.crm_product_json(v_old.id);
end;
$$;

create function public.crm_list_product_price_history(p_product_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare
  v_role text := public.crm_current_user_role();
begin
  if auth.uid() is null or not coalesce(public.crm_is_active_user(),false)
     or v_role not in ('sale','manager','admin','owner') then
    raise exception using errcode='42501', message='Bạn không có quyền đọc lịch sử giá.';
  end if;
  if not exists (
    select 1 from public.products p where p.id=p_product_id
      and (p.active or v_role in ('manager','admin','owner'))
  ) then
    raise exception using errcode='P0002', message='Không tìm thấy sản phẩm.';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',h.id,'effective_date',h.effective_date,
    'price_per_m2',h.price_per_m2::text,
    'price_per_box',case when h.price_per_box is null then null else to_jsonb(h.price_per_box::text) end,
    'price_per_piece',case when h.price_per_piece is null then null else to_jsonb(h.price_per_piece::text) end,
    'pieces_per_box',h.pieces_per_box,
    'sqm_per_box',case when h.sqm_per_box is null then null else to_jsonb(h.sqm_per_box::text) end,
    'source_type',h.source_type,'changed_by_user_id',h.changed_by_user_id,
    'changed_by_name',u.name,'changed_at',h.changed_at,'reason',h.reason
  ) order by h.effective_date desc,h.changed_at desc,h.id)
  from public.product_price_history h
  left join public.app_users u on u.id=h.changed_by_user_id
  where h.product_id=p_product_id),'[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. RLS/grants: readable catalog/history; all writes are RPC-only.
-- ---------------------------------------------------------------------------
revoke all on public.products from anon, authenticated;
revoke all on public.product_price_history from anon, authenticated;
revoke all on public.product_import_batches from anon, authenticated;
revoke all on public.product_import_rows from anon, authenticated;
grant select on public.products, public.product_price_history to authenticated;

alter table public.products enable row level security;
alter table public.product_price_history enable row level security;
alter table public.product_import_batches enable row level security;
alter table public.product_import_rows enable row level security;

drop policy if exists "products active employee read" on public.products;
create policy "products r2 employee read" on public.products
for select to authenticated
using (
  auth.uid() is not null and coalesce(public.crm_is_active_user(),false)
  and public.crm_current_user_role() in ('sale','manager','admin','owner')
  and (active or public.crm_current_user_role() in ('manager','admin','owner'))
);

create policy "product price history employee read" on public.product_price_history
for select to authenticated
using (
  auth.uid() is not null and coalesce(public.crm_is_active_user(),false)
  and public.crm_current_user_role() in ('sale','manager','admin','owner')
  and exists (
    select 1 from public.products p where p.id=product_id
      and (p.active or public.crm_current_user_role() in ('manager','admin','owner'))
  )
);

revoke all on function public.crm_guard_product_price_history_immutable() from public,anon,authenticated;
revoke all on function public.crm_product_parse_numeric(jsonb,text,boolean,boolean,integer) from public,anon,authenticated;
revoke all on function public.crm_product_parse_date(jsonb,text,boolean) from public,anon,authenticated;
revoke all on function public.crm_product_json(uuid) from public,anon,authenticated;
revoke all on function public.crm_list_products() from public,anon;
revoke all on function public.crm_create_product(jsonb) from public,anon;
revoke all on function public.crm_update_product(uuid,bigint,jsonb) from public,anon;
revoke all on function public.crm_set_product_active(uuid,bigint,boolean) from public,anon;
revoke all on function public.crm_list_product_price_history(uuid) from public,anon;
grant execute on function public.crm_list_products() to authenticated;
grant execute on function public.crm_create_product(jsonb) to authenticated;
grant execute on function public.crm_update_product(uuid,bigint,jsonb) to authenticated;
grant execute on function public.crm_set_product_active(uuid,bigint,boolean) to authenticated;
grant execute on function public.crm_list_product_price_history(uuid) to authenticated;

-- products remains the same table object, so existing supabase_realtime
-- publication membership remains intact.

-- ---------------------------------------------------------------------------
-- 8. Transaction-local verification. Any mismatch rolls everything back.
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.products)<>0 then
    raise exception 'PRODUCT_R2_VERIFY_FAIL: products không rỗng sau reset.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='products'
      and column_name in ('sku','price','unit','raw_data','is_deleted')
  ) then
    raise exception 'PRODUCT_R2_VERIFY_FAIL: legacy Product columns còn tồn tại.';
  end if;
  if (select data_type from information_schema.columns
      where table_schema='public' and table_name='products' and column_name='id')<>'uuid'
     or (select data_type from information_schema.columns
      where table_schema='public' and table_name='quote_items' and column_name='product_id')<>'uuid'
     or (select data_type from information_schema.columns
      where table_schema='public' and table_name='order_items' and column_name='product_id')<>'uuid' then
    raise exception 'PRODUCT_R2_VERIFY_FAIL: UUID conversion chưa hoàn chỉnh.';
  end if;
  if exists (select 1 from public.quote_items where product_id is not null) then
    raise exception 'PRODUCT_R2_VERIFY_FAIL: legacy quote Product ref chưa detach.';
  end if;
  if to_regclass('public.product_inventory_balance') is not null
     or exists (select 1 from pg_constraint where conname='inventory_movements_product_id_fkey'
       and conrelid='public.inventory_movements'::regclass) then
    raise exception 'PRODUCT_R2_VERIFY_FAIL: inventory coupling chưa retire.';
  end if;
  if to_regprocedure('public.crm_update_product(uuid,bigint,jsonb)') is null
     or to_regprocedure('public.crm_create_product(jsonb)') is null
     or to_regprocedure('public.crm_list_products()') is null
     or to_regprocedure('public.crm_set_product_active(uuid,bigint,boolean)') is null
     or to_regprocedure('public.crm_list_product_price_history(uuid)') is null then
    raise exception 'PRODUCT_R2_VERIFY_FAIL: thiếu canonical RPC.';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema='public'
      and table_name in ('products','product_price_history','product_import_batches','product_import_rows')
      and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
  ) then
    raise exception 'PRODUCT_R2_VERIFY_FAIL: authenticated còn direct write grant.';
  end if;
end;
$$;

commit;

-- No Product seed/import follows this migration. Expected rows: 0.
