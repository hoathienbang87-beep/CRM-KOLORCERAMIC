create table if not exists public.user_sessions (
  id text primary key,
  email text,
  name text,
  role text,
  online boolean default false,
  last_seen_at timestamptz,
  updated_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb
);

create index if not exists user_sessions_online_idx on public.user_sessions(online);
create index if not exists user_sessions_last_seen_at_idx on public.user_sessions(last_seen_at);
create index if not exists user_sessions_email_idx on public.user_sessions(lower(email));

alter table public.user_sessions enable row level security;

drop policy if exists "user sessions self write" on public.user_sessions;
create policy "user sessions self write" on public.user_sessions
for all
using (
  public.crm_is_manager()
  or lower(email) = public.crm_current_email()
)
with check (
  lower(email) = public.crm_current_email()
);

drop policy if exists "user sessions manager read" on public.user_sessions;
create policy "user sessions manager read" on public.user_sessions
for select
using (public.crm_is_manager() or lower(email) = public.crm_current_email());
