-- =====================================================================
-- CRM-PRODUCTS-R1 — Lightweight Product Catalog + Price + Stock
-- Repository : D:\SUPABASE\CRM-KOLORCERAMIC
-- Target     : PRODUCTION jjeeazwlqcwynzquimeo
-- Scope      : Chỉ catalog sản phẩm nội bộ + giá + tồn kho tham khảo.
--              KHÔNG đụng inventory_movements/product_inventory_balance/
--              order_items/quotes/payments. Các bảng ERP cũ giữ nguyên,
--              không bị migration này sửa.
--
-- Additive only: không xóa cột, không xóa dữ liệu, không đổi kiểu cột
-- hiện có. 403 sản phẩm hiện tại được giữ nguyên.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Precondition
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.products') is null then
    raise exception 'PRECONDITION_FAIL: bảng public.products không tồn tại.';
  end if;
  if to_regprocedure('public.crm_current_user_role()') is null
     or to_regprocedure('public.crm_is_admin()') is null
     or to_regprocedure('public.crm_is_manager()') is null
     or to_regprocedure('public.crm_is_active_user()') is null
     or to_regprocedure('public.crm_current_app_user_id()') is null then
    raise exception 'PRECONDITION_FAIL: thiếu helper phân quyền canonical (crm_is_admin/crm_is_manager/crm_is_active_user).';
  end if;
  -- Hotfix R1-0 phải fail-closed trước khi thêm quyền mới trên products.
  if public.crm_is_admin() is null then
    raise exception 'PRECONDITION_FAIL: crm_is_admin() vẫn trả NULL — hotfix R1-0 chưa live.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. Schema — additive only
-- ---------------------------------------------------------------------
alter table public.products
  add column if not exists stock_quantity numeric,
  add column if not exists updated_by_user_id text references public.app_users(id) on delete set null;

comment on column public.products.stock_quantity is
  'CRM-PRODUCTS-R1: số lượng tồn kho hiện tại do nhân viên tự cập nhật để tham khảo khi tư vấn khách. KHÔNG phải tồn kho kế toán, KHÔNG đồng bộ với inventory_movements.';
comment on column public.products.updated_by_user_id is
  'CRM-PRODUCTS-R1: app_users.id của nhân viên thực hiện lần cập nhật gần nhất. Server-authoritative, chỉ ghi qua crm_update_product/crm_create_product.';

create index if not exists products_updated_by_user_id_idx on public.products (updated_by_user_id);

-- ---------------------------------------------------------------------
-- 2. Grants — fail closed, dọn quyền thừa của anon
-- ---------------------------------------------------------------------
revoke all on public.products from anon;
revoke all on public.products from authenticated;
grant select on public.products to authenticated;
-- Không grant insert/update/delete trực tiếp cho authenticated: mọi thay
-- đổi phải đi qua RPC (security definer) bên dưới.

-- ---------------------------------------------------------------------
-- 3. RLS — thay policy "chỉ admin đọc" bằng "mọi nhân viên active đọc".
--    Không thêm policy UPDATE/INSERT cho authenticated — RPC lo việc ghi.
-- ---------------------------------------------------------------------
drop policy if exists "legacy products owner admin read archive" on public.products;

create policy "products active employee read"
  on public.products
  for select
  to authenticated
  using (coalesce(public.crm_is_active_user(), false));

-- ---------------------------------------------------------------------
-- 4. crm_update_product — Sale/Manager/Admin/Owner đang active được sửa.
--    Merge raw_data an toàn theo key, không overwrite field không đổi.
--    Client không thể tự gửi updated_by_user_id / updated_at.
-- ---------------------------------------------------------------------
create or replace function public.crm_update_product(
  p_product_id text,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id text := public.crm_current_app_user_id();
  v_old public.products%rowtype;
  v_code text;
  v_name text;
  v_size text;
  v_surface text;
  v_origin text;
  v_price numeric;
  v_stock numeric;
  v_raw jsonb;
begin
  if not coalesce(public.crm_is_active_user(), false) then
    raise exception using errcode = '42501',
      message = 'Chỉ nhân viên đang hoạt động mới được sửa sản phẩm.';
  end if;
  if v_actor_id is null then
    raise exception using errcode = '42501',
      message = 'Không xác định được nhân viên hiện tại.';
  end if;
  if p_product_id is null or nullif(btrim(p_product_id), '') is null then
    raise exception using errcode = '22023', message = 'Thiếu mã định danh sản phẩm.';
  end if;

  select * into v_old from public.products where id = p_product_id for update;
  if v_old.id is null then
    raise exception using errcode = 'P0002', message = 'Không tìm thấy sản phẩm.';
  end if;

  v_code    := case when p_changes ? 'code'    then nullif(btrim(p_changes->>'code'), '')    else nullif(btrim(v_old.sku), '') end;
  v_name    := case when p_changes ? 'name'    then nullif(btrim(p_changes->>'name'), '')    else v_old.name end;
  v_size    := case when p_changes ? 'size'    then nullif(btrim(p_changes->>'size'), '')    else nullif(btrim(v_old.raw_data->>'size'), '') end;
  v_surface := case when p_changes ? 'surface' then nullif(btrim(p_changes->>'surface'), '') else nullif(btrim(v_old.raw_data->>'surface'), '') end;
  v_origin  := case when p_changes ? 'origin'  then nullif(btrim(p_changes->>'origin'), '')  else nullif(btrim(v_old.raw_data->>'origin'), '') end;

  if p_changes ? 'price' then
    if nullif(btrim(p_changes->>'price'), '') is null then
      raise exception using errcode = '22023', message = 'Giá sản phẩm không được để trống.';
    end if;
    begin
      v_price := (p_changes->>'price')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'Giá sản phẩm không hợp lệ.';
    end;
    if v_price is null or v_price < 0 then
      raise exception using errcode = '22023', message = 'Giá sản phẩm không hợp lệ.';
    end if;
  else
    v_price := v_old.price;
  end if;

  if p_changes ? 'stock_quantity' then
    if nullif(btrim(p_changes->>'stock_quantity'), '') is null then
      v_stock := null;
    else
      begin
        v_stock := (p_changes->>'stock_quantity')::numeric;
      exception when others then
        raise exception using errcode = '22023', message = 'Tồn kho không hợp lệ.';
      end;
      if v_stock is null or v_stock < 0 then
        raise exception using errcode = '22023', message = 'Tồn kho không hợp lệ.';
      end if;
    end if;
  else
    v_stock := v_old.stock_quantity;
  end if;

  if v_name is null and v_code is null then
    raise exception using errcode = '22023', message = 'Sản phẩm cần có tên hoặc mã SP.';
  end if;

  if v_code is not null and exists (
    select 1 from public.products p2
    where p2.id <> p_product_id
      and lower(btrim(coalesce(p2.sku, ''))) = lower(v_code)
  ) then
    raise exception using errcode = '23505',
      message = 'Mã sản phẩm này đã được dùng cho sản phẩm khác.';
  end if;

  v_raw := coalesce(v_old.raw_data, '{}'::jsonb) || jsonb_build_object(
    'code', coalesce(v_code, ''),
    'name', coalesce(v_name, ''),
    'size', coalesce(v_size, ''),
    'surface', coalesce(v_surface, ''),
    'origin', coalesce(v_origin, ''),
    'price', v_price,
    'updatedByEmail', public.crm_current_email(),
    'updatedByName', coalesce((select u.name from public.app_users u where u.id = v_actor_id), ''),
    'updatedAt', now()
  );

  update public.products
  set name = coalesce(v_name, name),
      sku = v_code,
      price = v_price,
      stock_quantity = v_stock,
      raw_data = v_raw,
      updated_at = now(),
      updated_by_user_id = v_actor_id
  where id = p_product_id;

  perform public.crm_write_audit('updateProduct', 'products', p_product_id,
    jsonb_build_object(
      'code', v_code, 'name', v_name, 'price', v_price, 'stockQuantity', v_stock
    ));

  return jsonb_build_object(
    'id', p_product_id,
    'code', v_code, 'name', v_name, 'size', v_size, 'surface', v_surface, 'origin', v_origin,
    'price', v_price, 'stock_quantity', v_stock,
    'updated_at', now(), 'updated_by_user_id', v_actor_id
  );
end;
$$;

revoke all on function public.crm_update_product(text, jsonb) from public, anon;
grant execute on function public.crm_update_product(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 5. crm_create_product — Manager/Admin/Owner only. Sale KHÔNG tạo được.
-- ---------------------------------------------------------------------
create or replace function public.crm_create_product(
  p_product jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id text := public.crm_current_app_user_id();
  v_id text := gen_random_uuid()::text;
  v_code text := nullif(btrim(coalesce(p_product->>'code', '')), '');
  v_name text := nullif(btrim(coalesce(p_product->>'name', '')), '');
  v_size text := nullif(btrim(coalesce(p_product->>'size', '')), '');
  v_surface text := nullif(btrim(coalesce(p_product->>'surface', '')), '');
  v_origin text := nullif(btrim(coalesce(p_product->>'origin', '')), '');
  v_price numeric;
  v_stock numeric;
  v_raw jsonb;
begin
  if not coalesce(public.crm_is_manager(), false) then
    raise exception using errcode = '42501',
      message = 'Chỉ manager/admin/owner được tạo sản phẩm mới.';
  end if;
  if v_actor_id is null then
    raise exception using errcode = '42501',
      message = 'Không xác định được nhân viên hiện tại.';
  end if;
  if v_name is null and v_code is null then
    raise exception using errcode = '22023', message = 'Sản phẩm cần có tên hoặc mã SP.';
  end if;

  if nullif(btrim(coalesce(p_product->>'price', '')), '') is null then
    raise exception using errcode = '22023', message = 'Giá sản phẩm không được để trống.';
  end if;
  begin
    v_price := (p_product->>'price')::numeric;
  exception when others then
    raise exception using errcode = '22023', message = 'Giá sản phẩm không hợp lệ.';
  end;
  if v_price is null or v_price < 0 then
    raise exception using errcode = '22023', message = 'Giá sản phẩm không hợp lệ.';
  end if;

  if nullif(btrim(coalesce(p_product->>'stock_quantity', '')), '') is not null then
    begin
      v_stock := (p_product->>'stock_quantity')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'Tồn kho không hợp lệ.';
    end;
    if v_stock is null or v_stock < 0 then
      raise exception using errcode = '22023', message = 'Tồn kho không hợp lệ.';
    end if;
  end if;

  if v_code is not null and exists (
    select 1 from public.products p2 where lower(btrim(coalesce(p2.sku, ''))) = lower(v_code)
  ) then
    raise exception using errcode = '23505',
      message = 'Mã sản phẩm này đã được dùng cho sản phẩm khác.';
  end if;

  v_raw := jsonb_build_object(
    'code', coalesce(v_code, ''), 'name', coalesce(v_name, ''), 'size', coalesce(v_size, ''),
    'surface', coalesce(v_surface, ''), 'origin', coalesce(v_origin, ''), 'price', v_price,
    'createdByEmail', public.crm_current_email(), 'updatedByEmail', public.crm_current_email(),
    'createdByName', coalesce((select u.name from public.app_users u where u.id = v_actor_id), ''),
    'updatedByName', coalesce((select u.name from public.app_users u where u.id = v_actor_id), ''),
    'createdAt', now(), 'updatedAt', now()
  );

  insert into public.products(
    id, name, sku, price, active, is_deleted, raw_data, stock_quantity,
    created_at, updated_at, updated_by_user_id
  ) values (
    v_id, coalesce(v_name, v_code), v_code, v_price, true, false, v_raw, v_stock,
    now(), now(), v_actor_id
  );

  perform public.crm_write_audit('createProduct', 'products', v_id,
    jsonb_build_object('code', v_code, 'name', v_name, 'price', v_price, 'stockQuantity', v_stock));

  return jsonb_build_object(
    'id', v_id, 'code', v_code, 'name', v_name, 'size', v_size, 'surface', v_surface, 'origin', v_origin,
    'price', v_price, 'stock_quantity', v_stock,
    'updated_at', now(), 'updated_by_user_id', v_actor_id
  );
end;
$$;

revoke all on function public.crm_create_product(jsonb) from public, anon;
grant execute on function public.crm_create_product(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Tự kiểm chứng trong transaction — chỉ đọc + gọi thử với payload rỗng
--    để xác nhận guard fail-closed, không có ghi thật nào xảy ra khi FAIL.
-- ---------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.products;
  if v_count < 403 then
    raise exception 'PRODUCTS_R1_VERIFY_FAIL: số dòng products giảm (còn %, kỳ vọng >= 403). Rollback.', v_count;
  end if;

  if to_regprocedure('public.crm_update_product(text, jsonb)') is null then
    raise exception 'PRODUCTS_R1_VERIFY_FAIL: crm_update_product chưa tồn tại đúng signature.';
  end if;
  if to_regprocedure('public.crm_create_product(jsonb)') is null then
    raise exception 'PRODUCTS_R1_VERIFY_FAIL: crm_create_product chưa tồn tại đúng signature.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='products' and column_name='stock_quantity'
  ) then
    raise exception 'PRODUCTS_R1_VERIFY_FAIL: thiếu cột stock_quantity.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='products' and column_name='updated_by_user_id'
  ) then
    raise exception 'PRODUCTS_R1_VERIFY_FAIL: thiếu cột updated_by_user_id.';
  end if;

  raise notice 'PRODUCTS_R1_VERIFY_PASS: schema + RPC đã sẵn sàng, dữ liệu cũ còn nguyên (% dòng).', v_count;
end;
$$;

commit;

-- =====================================================================
-- READ-BACK (chạy RIÊNG sau khi commit, chỉ đọc)
-- =====================================================================
-- select column_name, data_type from information_schema.columns
-- where table_schema='public' and table_name='products' order by ordinal_position;
--
-- select policyname, cmd, roles, qual, with_check from pg_policies
-- where schemaname='public' and tablename='products';
--
-- select grantee, privilege_type from information_schema.role_table_grants
-- where table_schema='public' and table_name='products' order by grantee, privilege_type;
--
-- select proname, pg_get_function_identity_arguments(oid), prosecdef, proconfig
-- from pg_proc where pronamespace='public'::regnamespace
-- and proname in ('crm_update_product','crm_create_product');
--
-- select count(*) from public.products;
