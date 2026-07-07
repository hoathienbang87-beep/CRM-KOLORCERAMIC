begin;

-- Website CMS tables for the separate admin panel.
-- Run this after a Supabase backup. Keep service keys and database passwords out of Git.

create table if not exists public.website_pages (
  id text primary key,
  slug text not null unique,
  title text,
  status text not null default 'draft',
  is_published boolean not null default false,
  sort_order integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  raw_data jsonb not null default '{}'::jsonb,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.website_sections (
  id text primary key,
  page_id text not null references public.website_pages(id) on delete cascade,
  section_key text not null,
  section_type text not null default 'content',
  title text,
  subtitle text,
  body text,
  image_url text,
  cta_label text,
  cta_url text,
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  raw_data jsonb not null default '{}'::jsonb,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (page_id, section_key)
);

create index if not exists website_pages_status_idx on public.website_pages(status);
create index if not exists website_sections_page_sort_idx on public.website_sections(page_id, sort_order);
create index if not exists website_sections_visible_idx on public.website_sections(is_visible);

create or replace function public.crm_is_owner_or_admin()
returns boolean
language sql
stable
as $$
  select public.crm_current_user_role() in ('owner', 'admin');
$$;

grant execute on function public.crm_is_owner_or_admin() to authenticated;

create or replace function public.crm_touch_cms_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.raw_data = coalesce(new.data, '{}'::jsonb);
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists website_pages_touch_updated_at on public.website_pages;
create trigger website_pages_touch_updated_at
before insert or update on public.website_pages
for each row execute function public.crm_touch_cms_updated_at();

drop trigger if exists website_sections_touch_updated_at on public.website_sections;
create trigger website_sections_touch_updated_at
before insert or update on public.website_sections
for each row execute function public.crm_touch_cms_updated_at();

alter table public.website_pages enable row level security;
alter table public.website_sections enable row level security;

drop policy if exists "website pages admin read" on public.website_pages;
create policy "website pages admin read"
on public.website_pages
for select
to authenticated
using (public.crm_is_owner_or_admin());

drop policy if exists "website pages admin insert" on public.website_pages;
create policy "website pages admin insert"
on public.website_pages
for insert
to authenticated
with check (public.crm_is_owner_or_admin());

drop policy if exists "website pages admin update" on public.website_pages;
create policy "website pages admin update"
on public.website_pages
for update
to authenticated
using (public.crm_is_owner_or_admin())
with check (public.crm_is_owner_or_admin());

drop policy if exists "website pages admin delete" on public.website_pages;
create policy "website pages admin delete"
on public.website_pages
for delete
to authenticated
using (public.crm_is_owner_or_admin());

drop policy if exists "website sections admin read" on public.website_sections;
create policy "website sections admin read"
on public.website_sections
for select
to authenticated
using (public.crm_is_owner_or_admin());

drop policy if exists "website sections admin insert" on public.website_sections;
create policy "website sections admin insert"
on public.website_sections
for insert
to authenticated
with check (public.crm_is_owner_or_admin());

drop policy if exists "website sections admin update" on public.website_sections;
create policy "website sections admin update"
on public.website_sections
for update
to authenticated
using (public.crm_is_owner_or_admin())
with check (public.crm_is_owner_or_admin());

drop policy if exists "website sections admin delete" on public.website_sections;
create policy "website sections admin delete"
on public.website_sections
for delete
to authenticated
using (public.crm_is_owner_or_admin());

insert into public.website_pages (id, slug, title, status, is_published, sort_order, data, raw_data)
values (
  'home',
  'home',
  'Trang chủ',
  'draft',
  false,
  0,
  jsonb_build_object('slug', 'home', 'title', 'Trang chủ', 'status', 'draft', 'isPublished', false, 'sortOrder', 0, 'description', ''),
  jsonb_build_object('slug', 'home', 'title', 'Trang chủ', 'status', 'draft', 'isPublished', false, 'sortOrder', 0, 'description', '')
)
on conflict (id) do nothing;

insert into public.website_sections (
  id,
  page_id,
  section_key,
  section_type,
  title,
  subtitle,
  body,
  is_visible,
  sort_order,
  data,
  raw_data
)
values (
  'home_hero',
  'home',
  'hero',
  'hero',
  'Kolorceramic THT',
  'Không gian gạch và vật liệu hoàn thiện',
  'Section mẫu để admin chỉnh nội dung trang chủ.',
  true,
  0,
  jsonb_build_object('pageId', 'home', 'sectionKey', 'hero', 'sectionType', 'hero', 'title', 'Kolorceramic THT', 'subtitle', 'Không gian gạch và vật liệu hoàn thiện', 'body', 'Section mẫu để admin chỉnh nội dung trang chủ.', 'isVisible', true, 'sortOrder', 0),
  jsonb_build_object('pageId', 'home', 'sectionKey', 'hero', 'sectionType', 'hero', 'title', 'Kolorceramic THT', 'subtitle', 'Không gian gạch và vật liệu hoàn thiện', 'body', 'Section mẫu để admin chỉnh nội dung trang chủ.', 'isVisible', true, 'sortOrder', 0)
)
on conflict (id) do nothing;

commit;
