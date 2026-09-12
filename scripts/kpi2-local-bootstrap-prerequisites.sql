-- Test-only normalization for harness-prod-baseline.sql.
--
-- This is not a production migration and is not migration history. It expands
-- the deliberately small employee-onboarding baseline with the exact CRM
-- columns used by these already-reviewed artifacts:
--   supabase-phase-1-security-foundation.sql
--   supabase-phase-p0a-transaction-ownership.sql
--   supabase-phase-p0b-employee-assignment.sql
-- It must only run on the disposable local Supabase project.

alter table public.customers
  add column if not exists company_name text,
  add column if not exists phone_raw text,
  add column if not exists phone_normalized text,
  add column if not exists no_phone boolean default false,
  add column if not exists address text,
  add column if not exists channel text,
  add column if not exists owner text,
  add column if not exists owner_email text,
  add column if not exists created_by_email text,
  add column if not exists created_by_user_id text,
  add column if not exists status text,
  add column if not exists follow text,
  add column if not exists last_contact_at timestamptz,
  add column if not exists note text,
  add column if not exists need text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_email text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table public.customers
  alter column next_care_date type timestamptz
  using next_care_date::timestamptz;

alter table public.customer_assignments
  add column if not exists employee_email_snapshot text,
  add column if not exists employee_name_snapshot text,
  add column if not exists assigned_at timestamptz not null default now(),
  add column if not exists ended_at timestamptz,
  add column if not exists assigned_by_user_id text,
  add column if not exists assigned_by_email text,
  add column if not exists ended_by_user_id text,
  add column if not exists ended_by_email text,
  add column if not exists assignment_reason text,
  add column if not exists end_reason text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists raw_data jsonb not null default '{}'::jsonb;

