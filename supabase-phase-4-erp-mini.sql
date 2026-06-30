-- CRM KOLORCERAMIC - Phase 4.1 ERP mini data model
-- Created: 2026-06-30
--
-- Purpose:
-- 1. Add ERP mini tables without breaking the current CRM app.
-- 2. Keep existing customers/deals/products as the compatibility layer.
-- 3. Add quote, order item, payment and inventory movement structures.
-- 4. Enable RLS using the same admin / manager / sale model from Phase 1.
--
-- How to run:
-- - Run after backing up Supabase.
-- - Run after supabase-phase-1-security-foundation.sql.
-- - This migration is idempotent and does not delete existing business data.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. ERP mini tables
-- ---------------------------------------------------------------------------

create table if not exists public.quotes (
  id text primary key default gen_random_uuid()::text,
  quote_no text unique,
  customer_id text references public.customers(id) on delete set null,
  customer_name text,
  customer_phone text,
  customer_company_name text,
  owner text,
  owner_email text,
  status text default 'draft',
  quote_date date default current_date,
  valid_until date,
  subtotal numeric default 0,
  discount_amount numeric default 0,
  tax_amount numeric default 0,
  total_amount numeric default 0,
  note text,
  sent_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  converted_deal_id text references public.deals(id) on delete set null,
  is_deleted boolean default false,
  deleted_at timestamptz,
  deleted_by_email text,
  created_by_email text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.quote_items (
  id text primary key default gen_random_uuid()::text,
  quote_id text references public.quotes(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  product_sku text,
  product_name text,
  unit text,
  qty numeric default 1,
  unit_price numeric default 0,
  discount_amount numeric default 0,
  line_total numeric default 0,
  sort_order integer default 0,
  note text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.order_items (
  id text primary key default gen_random_uuid()::text,
  deal_id text references public.deals(id) on delete cascade,
  customer_id text references public.customers(id) on delete set null,
  product_id text references public.products(id) on delete set null,
  product_sku text,
  product_name text,
  unit text,
  qty numeric default 1,
  unit_price numeric default 0,
  discount_amount numeric default 0,
  line_total numeric default 0,
  delivered_qty numeric default 0,
  sort_order integer default 0,
  note text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.payments (
  id text primary key default gen_random_uuid()::text,
  payment_no text unique,
  deal_id text references public.deals(id) on delete set null,
  quote_id text references public.quotes(id) on delete set null,
  customer_id text references public.customers(id) on delete set null,
  customer_name text,
  owner text,
  owner_email text,
  amount numeric default 0,
  method text,
  status text default 'paid',
  payment_date date default current_date,
  received_by_email text,
  note text,
  is_deleted boolean default false,
  deleted_at timestamptz,
  deleted_by_email text,
  created_by_email text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.inventory_movements (
  id text primary key default gen_random_uuid()::text,
  product_id text references public.products(id) on delete set null,
  product_sku text,
  product_name text,
  movement_type text default 'adjustment',
  qty numeric not null default 0,
  unit text,
  ref_type text,
  ref_id text,
  warehouse text default 'main',
  note text,
  is_deleted boolean default false,
  deleted_at timestamptz,
  deleted_by_email text,
  created_by_email text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Compatibility columns for reruns or partially-created tables.
alter table public.quotes add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.quotes add column if not exists is_deleted boolean default false;
alter table public.quotes add column if not exists created_by_email text;
alter table public.quotes add column if not exists updated_at timestamptz default now();

alter table public.quote_items add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.quote_items add column if not exists updated_at timestamptz default now();

alter table public.order_items add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.order_items add column if not exists updated_at timestamptz default now();

alter table public.payments add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.payments add column if not exists is_deleted boolean default false;
alter table public.payments add column if not exists created_by_email text;
alter table public.payments add column if not exists updated_at timestamptz default now();

alter table public.inventory_movements add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.inventory_movements add column if not exists is_deleted boolean default false;
alter table public.inventory_movements add column if not exists created_by_email text;
alter table public.inventory_movements add column if not exists updated_at timestamptz default now();

-- ---------------------------------------------------------------------------
-- 2. Helper access functions
-- ---------------------------------------------------------------------------

create or replace function public.crm_can_access_deal_id(p_deal_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.crm_is_manager()
    or exists (
      select 1
      from public.deals d
      where d.id = p_deal_id
        and (
          lower(coalesce(d.owner_email, '')) = public.crm_current_email()
          or public.crm_can_access_customer_id(d.customer_id)
        )
    );
$$;

create or replace function public.crm_can_access_quote_id(p_quote_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.crm_is_manager()
    or exists (
      select 1
      from public.quotes q
      where q.id = p_quote_id
        and (
          lower(coalesce(q.owner_email, '')) = public.crm_current_email()
          or lower(coalesce(q.created_by_email, '')) = public.crm_current_email()
          or public.crm_can_access_customer_id(q.customer_id)
        )
    );
$$;

grant execute on function public.crm_can_access_deal_id(text) to authenticated;
grant execute on function public.crm_can_access_quote_id(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Updated-at trigger
-- ---------------------------------------------------------------------------

create or replace function public.crm_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists quotes_touch_updated_at on public.quotes;
create trigger quotes_touch_updated_at
before update on public.quotes
for each row execute function public.crm_touch_updated_at();

drop trigger if exists quote_items_touch_updated_at on public.quote_items;
create trigger quote_items_touch_updated_at
before update on public.quote_items
for each row execute function public.crm_touch_updated_at();

drop trigger if exists order_items_touch_updated_at on public.order_items;
create trigger order_items_touch_updated_at
before update on public.order_items
for each row execute function public.crm_touch_updated_at();

drop trigger if exists payments_touch_updated_at on public.payments;
create trigger payments_touch_updated_at
before update on public.payments
for each row execute function public.crm_touch_updated_at();

drop trigger if exists inventory_movements_touch_updated_at on public.inventory_movements;
create trigger inventory_movements_touch_updated_at
before update on public.inventory_movements
for each row execute function public.crm_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------------------------

create index if not exists quotes_customer_id_idx on public.quotes(customer_id);
create index if not exists quotes_owner_email_idx on public.quotes(lower(owner_email));
create index if not exists quotes_status_idx on public.quotes(lower(status));
create index if not exists quotes_quote_date_idx on public.quotes(quote_date);
create index if not exists quotes_is_deleted_idx on public.quotes(is_deleted);

create index if not exists quote_items_quote_id_idx on public.quote_items(quote_id);
create index if not exists quote_items_product_id_idx on public.quote_items(product_id);

create index if not exists order_items_deal_id_idx on public.order_items(deal_id);
create index if not exists order_items_customer_id_idx on public.order_items(customer_id);
create index if not exists order_items_product_id_idx on public.order_items(product_id);

create index if not exists payments_deal_id_idx on public.payments(deal_id);
create index if not exists payments_quote_id_idx on public.payments(quote_id);
create index if not exists payments_customer_id_idx on public.payments(customer_id);
create index if not exists payments_owner_email_idx on public.payments(lower(owner_email));
create index if not exists payments_payment_date_idx on public.payments(payment_date);
create index if not exists payments_is_deleted_idx on public.payments(is_deleted);

create index if not exists inventory_movements_product_id_idx on public.inventory_movements(product_id);
create index if not exists inventory_movements_product_sku_idx on public.inventory_movements(lower(product_sku));
create index if not exists inventory_movements_created_at_idx on public.inventory_movements(created_at);
create index if not exists inventory_movements_ref_idx on public.inventory_movements(ref_type, ref_id);

-- ---------------------------------------------------------------------------
-- 5. Grants and RLS
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on
  public.quotes,
  public.quote_items,
  public.order_items,
  public.payments,
  public.inventory_movements
to authenticated;

alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.inventory_movements enable row level security;

-- ---------------------------------------------------------------------------
-- 6. Policies: quotes
-- ---------------------------------------------------------------------------

drop policy if exists "quotes manager or owner read" on public.quotes;
create policy "quotes manager or owner read" on public.quotes
for select
to authenticated
using (
  public.crm_is_manager()
  or public.crm_is_owner(owner_email, created_by_email)
  or public.crm_can_access_customer_id(customer_id)
);

drop policy if exists "quotes manager or owner insert" on public.quotes;
create policy "quotes manager or owner insert" on public.quotes
for insert
to authenticated
with check (
  public.crm_is_active_user()
  and (
    public.crm_is_manager()
    or public.crm_is_owner(owner_email, created_by_email)
    or public.crm_can_access_customer_id(customer_id)
  )
);

drop policy if exists "quotes manager or owner update" on public.quotes;
create policy "quotes manager or owner update" on public.quotes
for update
to authenticated
using (
  public.crm_is_manager()
  or public.crm_is_owner(owner_email, created_by_email)
  or public.crm_can_access_customer_id(customer_id)
)
with check (
  public.crm_is_manager()
  or public.crm_is_owner(owner_email, created_by_email)
  or public.crm_can_access_customer_id(customer_id)
);

drop policy if exists "quotes admin delete" on public.quotes;
create policy "quotes admin delete" on public.quotes
for delete
to authenticated
using (public.crm_is_admin());

-- ---------------------------------------------------------------------------
-- 7. Policies: quote_items
-- ---------------------------------------------------------------------------

drop policy if exists "quote items quote access read" on public.quote_items;
create policy "quote items quote access read" on public.quote_items
for select
to authenticated
using (public.crm_can_access_quote_id(quote_id));

drop policy if exists "quote items quote access insert" on public.quote_items;
create policy "quote items quote access insert" on public.quote_items
for insert
to authenticated
with check (public.crm_can_access_quote_id(quote_id));

drop policy if exists "quote items quote access update" on public.quote_items;
create policy "quote items quote access update" on public.quote_items
for update
to authenticated
using (public.crm_can_access_quote_id(quote_id))
with check (public.crm_can_access_quote_id(quote_id));

drop policy if exists "quote items admin delete" on public.quote_items;
create policy "quote items admin delete" on public.quote_items
for delete
to authenticated
using (public.crm_is_admin() or public.crm_can_access_quote_id(quote_id));

-- ---------------------------------------------------------------------------
-- 8. Policies: order_items
-- ---------------------------------------------------------------------------

drop policy if exists "order items deal access read" on public.order_items;
create policy "order items deal access read" on public.order_items
for select
to authenticated
using (
  public.crm_can_access_deal_id(deal_id)
  or public.crm_can_access_customer_id(customer_id)
);

drop policy if exists "order items deal access insert" on public.order_items;
create policy "order items deal access insert" on public.order_items
for insert
to authenticated
with check (
  public.crm_is_active_user()
  and (
    public.crm_can_access_deal_id(deal_id)
    or public.crm_can_access_customer_id(customer_id)
  )
);

drop policy if exists "order items deal access update" on public.order_items;
create policy "order items deal access update" on public.order_items
for update
to authenticated
using (
  public.crm_can_access_deal_id(deal_id)
  or public.crm_can_access_customer_id(customer_id)
)
with check (
  public.crm_can_access_deal_id(deal_id)
  or public.crm_can_access_customer_id(customer_id)
);

drop policy if exists "order items admin delete" on public.order_items;
create policy "order items admin delete" on public.order_items
for delete
to authenticated
using (public.crm_is_admin() or public.crm_can_access_deal_id(deal_id));

-- ---------------------------------------------------------------------------
-- 9. Policies: payments
-- ---------------------------------------------------------------------------

drop policy if exists "payments manager or owner read" on public.payments;
create policy "payments manager or owner read" on public.payments
for select
to authenticated
using (
  public.crm_is_manager()
  or public.crm_is_owner(owner_email, created_by_email)
  or public.crm_can_access_customer_id(customer_id)
  or public.crm_can_access_deal_id(deal_id)
);

drop policy if exists "payments manager or owner insert" on public.payments;
create policy "payments manager or owner insert" on public.payments
for insert
to authenticated
with check (
  public.crm_is_active_user()
  and (
    public.crm_is_manager()
    or public.crm_is_owner(owner_email, created_by_email)
    or public.crm_can_access_customer_id(customer_id)
    or public.crm_can_access_deal_id(deal_id)
  )
);

drop policy if exists "payments manager update" on public.payments;
create policy "payments manager update" on public.payments
for update
to authenticated
using (
  public.crm_is_manager()
  or public.crm_is_owner(owner_email, created_by_email)
)
with check (
  public.crm_is_manager()
  or public.crm_is_owner(owner_email, created_by_email)
);

drop policy if exists "payments admin delete" on public.payments;
create policy "payments admin delete" on public.payments
for delete
to authenticated
using (public.crm_is_admin());

-- ---------------------------------------------------------------------------
-- 10. Policies: inventory_movements
-- ---------------------------------------------------------------------------

drop policy if exists "inventory movements active users read" on public.inventory_movements;
create policy "inventory movements active users read" on public.inventory_movements
for select
to authenticated
using (public.crm_is_active_user());

drop policy if exists "inventory movements manager insert" on public.inventory_movements;
create policy "inventory movements manager insert" on public.inventory_movements
for insert
to authenticated
with check (public.crm_is_manager());

drop policy if exists "inventory movements manager update" on public.inventory_movements;
create policy "inventory movements manager update" on public.inventory_movements
for update
to authenticated
using (public.crm_is_manager())
with check (public.crm_is_manager());

drop policy if exists "inventory movements admin delete" on public.inventory_movements;
create policy "inventory movements admin delete" on public.inventory_movements
for delete
to authenticated
using (public.crm_is_admin());

-- ---------------------------------------------------------------------------
-- 11. Optional reporting views
-- ---------------------------------------------------------------------------

create or replace view public.product_inventory_balance
with (security_invoker = true)
as
select
  coalesce(im.product_id, '') as product_id,
  coalesce(im.product_sku, '') as product_sku,
  coalesce(im.product_name, '') as product_name,
  coalesce(im.warehouse, 'main') as warehouse,
  sum(coalesce(im.qty, 0)) as qty_balance,
  max(im.updated_at) as last_movement_at
from public.inventory_movements im
where coalesce(im.is_deleted, false) = false
group by
  coalesce(im.product_id, ''),
  coalesce(im.product_sku, ''),
  coalesce(im.product_name, ''),
  coalesce(im.warehouse, 'main');

grant select on public.product_inventory_balance to authenticated;

commit;
