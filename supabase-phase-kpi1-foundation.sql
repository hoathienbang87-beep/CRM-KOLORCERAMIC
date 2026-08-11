-- KPI-1 foundation: monthly periods, KPI catalog, employee assignments,
-- canonical RLS and atomic business RPCs.
--
-- Dependencies:
--   * P0-A and P0-B are already applied.
--   * public.app_users, public.audit_logs, public.crm_current_app_user_id(),
--     public.crm_current_user_role() and public.crm_write_audit() exist.
--
-- This migration is additive. It does not alter or migrate legacy
-- public.kpi_rules/public.kpi_proposals.

begin;

-- ---------------------------------------------------------------------------
-- 1. Foundation tables
-- ---------------------------------------------------------------------------

create table if not exists public.kpi_periods (
  id uuid primary key default gen_random_uuid(),
  period_month date not null unique,
  name text not null,
  status text not null default 'DRAFT',
  timezone text not null default 'Asia/Ho_Chi_Minh',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by_user_id text not null references public.app_users(id) on delete restrict,
  activated_by_user_id text references public.app_users(id) on delete restrict,
  closed_by_user_id text references public.app_users(id) on delete restrict,
  reopened_by_user_id text references public.app_users(id) on delete restrict,
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  closed_at timestamptz,
  reopened_at timestamptz,
  version integer not null default 1,
  constraint kpi_periods_month_first_day_check
    check (period_month = date_trunc('month', period_month)::date),
  constraint kpi_periods_status_check
    check (status in ('DRAFT', 'ACTIVE', 'CLOSED')),
  constraint kpi_periods_name_check
    check (nullif(btrim(name), '') is not null),
  constraint kpi_periods_timezone_check
    check (nullif(btrim(timezone), '') is not null),
  constraint kpi_periods_range_check
    check (starts_at < ends_at),
  constraint kpi_periods_version_check
    check (version > 0),
  constraint kpi_periods_lifecycle_shape_check
    check (
      (status = 'DRAFT')
      or (status = 'ACTIVE' and activated_at is not null and activated_by_user_id is not null)
      or (status = 'CLOSED' and activated_at is not null and activated_by_user_id is not null
          and closed_at is not null and closed_by_user_id is not null)
    )
);

create table if not exists public.kpi_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  kpi_type text not null,
  source_metric_key text,
  unit text not null,
  submission_mode text not null default 'EVENT_CLAIM',
  evidence_required boolean not null default false,
  active boolean not null default true,
  created_by_user_id text not null references public.app_users(id) on delete restrict,
  updated_by_user_id text not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint kpi_definitions_code_check
    check (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  constraint kpi_definitions_name_check
    check (nullif(btrim(name), '') is not null),
  constraint kpi_definitions_type_check
    check (kpi_type in ('AUTO', 'MANUAL', 'HYBRID')),
  constraint kpi_definitions_unit_check
    check (nullif(btrim(unit), '') is not null),
  constraint kpi_definitions_submission_mode_check
    check (submission_mode in ('EVENT_CLAIM', 'PERIOD_TOTAL')),
  constraint kpi_definitions_version_check
    check (version > 0)
);

create table if not exists public.kpi_assignments (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.kpi_periods(id) on delete restrict,
  definition_id uuid not null references public.kpi_definitions(id) on delete restrict,
  employee_id text not null references public.app_users(id) on delete restrict,
  target numeric not null,
  effective_at timestamptz not null,
  assignment_status text not null default 'ASSIGNED',
  definition_snapshot jsonb not null,
  assigned_by_user_id text not null references public.app_users(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  cancelled_by_user_id text references public.app_users(id) on delete restrict,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lock_version integer not null default 1,
  constraint kpi_assignments_unique unique (period_id, definition_id, employee_id),
  constraint kpi_assignments_target_check check (target > 0),
  constraint kpi_assignments_status_check
    check (assignment_status in ('ASSIGNED', 'CANCELLED')),
  constraint kpi_assignments_snapshot_object_check
    check (jsonb_typeof(definition_snapshot) = 'object'),
  constraint kpi_assignments_snapshot_fields_check
    check (definition_snapshot ?& array[
      'code', 'name', 'description', 'kpi_type', 'source_metric_key',
      'unit', 'submission_mode', 'evidence_required', 'definition_version'
    ]),
  constraint kpi_assignments_cancel_shape_check
    check (
      (assignment_status = 'ASSIGNED' and cancelled_at is null and cancelled_by_user_id is null)
      or
      (assignment_status = 'CANCELLED' and cancelled_at is not null
        and cancelled_by_user_id is not null
        and nullif(btrim(cancel_reason), '') is not null)
    ),
  constraint kpi_assignments_lock_version_check check (lock_version > 0)
);

create index if not exists kpi_periods_status_month_idx
  on public.kpi_periods(status, period_month desc);
create index if not exists kpi_definitions_active_code_idx
  on public.kpi_definitions(active, code);
create index if not exists kpi_assignments_period_status_idx
  on public.kpi_assignments(period_id, assignment_status);
create index if not exists kpi_assignments_employee_period_idx
  on public.kpi_assignments(employee_id, period_id);
create index if not exists kpi_assignments_definition_period_idx
  on public.kpi_assignments(definition_id, period_id);

-- ---------------------------------------------------------------------------
-- 2. Role, snapshot and audit helpers
-- ---------------------------------------------------------------------------

create or replace function public.crm_kpi_is_business_manager()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.app_users u
    where u.id = public.crm_current_app_user_id()
      and coalesce(u.active, false) = true
      and lower(coalesce(u.lifecycle_status, 'active')) = 'active'
      and lower(coalesce(u.role, '')) in ('manager', 'admin', 'owner')
  );
$$;

create or replace function public.crm_kpi_is_admin_owner()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.app_users u
    where u.id = public.crm_current_app_user_id()
      and coalesce(u.active, false) = true
      and lower(coalesce(u.lifecycle_status, 'active')) = 'active'
      and lower(coalesce(u.role, '')) in ('admin', 'owner')
  );
$$;

create or replace function public.crm_kpi_sale_has_period_assignment(p_period_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.crm_is_active_user()
    and exists (
      select 1
      from public.kpi_assignments a
      where a.period_id = p_period_id
        and a.employee_id = public.crm_current_app_user_id()
        and a.assignment_status = 'ASSIGNED'
    );
$$;

create or replace function public.crm_kpi_sale_can_read_assignment(
  p_period_id uuid,
  p_employee_id text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.crm_is_active_user()
    and p_employee_id = public.crm_current_app_user_id()
    and exists (
      select 1
      from public.kpi_periods p
      where p.id = p_period_id and p.status in ('ACTIVE', 'CLOSED')
    );
$$;

create or replace function public.crm_kpi_definition_snapshot(p_definition public.kpi_definitions)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'code', p_definition.code,
    'name', p_definition.name,
    'description', coalesce(p_definition.description, ''),
    'kpi_type', p_definition.kpi_type,
    'source_metric_key', p_definition.source_metric_key,
    'unit', p_definition.unit,
    'submission_mode', p_definition.submission_mode,
    'evidence_required', p_definition.evidence_required,
    'definition_version', p_definition.version,
    'snapshotted_at', now()
  );
$$;

create or replace function public.crm_kpi_write_audit(
  p_action text,
  p_entity text,
  p_entity_id text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.crm_write_audit(
    p_action,
    p_entity,
    p_entity_id,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
      'actorUserId', public.crm_current_app_user_id(),
      'actorRole', public.crm_current_user_role(),
      'timestamp', now()
    )
  );
end;
$$;

revoke all on function public.crm_kpi_definition_snapshot(public.kpi_definitions)
  from public, anon, authenticated;
revoke all on function public.crm_kpi_write_audit(text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.crm_kpi_is_business_manager() from public, anon;
revoke all on function public.crm_kpi_is_admin_owner() from public, anon;
revoke all on function public.crm_kpi_sale_has_period_assignment(uuid) from public, anon;
revoke all on function public.crm_kpi_sale_can_read_assignment(uuid, text) from public, anon;
grant execute on function public.crm_kpi_is_business_manager() to authenticated;
grant execute on function public.crm_kpi_is_admin_owner() to authenticated;
grant execute on function public.crm_kpi_sale_has_period_assignment(uuid) to authenticated;
grant execute on function public.crm_kpi_sale_can_read_assignment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Direct-write and lifecycle guards
-- ---------------------------------------------------------------------------

create or replace function public.crm_kpi_guard_direct_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and coalesce(current_setting('crm.kpi_write', true), '') <> 'on' then
    raise exception using
      errcode = '42501',
      message = 'Thay đổi cấu hình KPI phải thực hiện qua RPC nghiệp vụ.';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.crm_kpi_guard_direct_write()
  from public, anon, authenticated;

drop trigger if exists kpi_periods_guard_direct_write on public.kpi_periods;
create trigger kpi_periods_guard_direct_write
before insert or update or delete on public.kpi_periods
for each row execute function public.crm_kpi_guard_direct_write();

drop trigger if exists kpi_definitions_guard_direct_write on public.kpi_definitions;
create trigger kpi_definitions_guard_direct_write
before insert or update or delete on public.kpi_definitions
for each row execute function public.crm_kpi_guard_direct_write();

drop trigger if exists kpi_assignments_guard_direct_write on public.kpi_assignments;
create trigger kpi_assignments_guard_direct_write
before insert or update or delete on public.kpi_assignments
for each row execute function public.crm_kpi_guard_direct_write();

-- A deactivation racing a DRAFT assignment must not leave invalid DRAFT config.
-- ACTIVE/CLOSED assignments remain historical and do not block lifecycle changes.
create or replace function public.crm_kpi_guard_employee_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (coalesce(old.active, false) = true
      and (coalesce(new.active, false) = false
           or lower(coalesce(new.lifecycle_status, 'inactive')) <> 'active')) then
    perform pg_advisory_xact_lock(hashtextextended('crm:kpi:employee:' || old.id, 0));
    if exists (
      select 1
      from public.kpi_assignments a
      join public.kpi_periods p on p.id = a.period_id
      where a.employee_id = old.id
        and a.assignment_status = 'ASSIGNED'
        and p.status = 'DRAFT'
    ) then
      raise exception using
        errcode = '55000',
        message = 'Nhân viên còn KPI ở kỳ DRAFT. Hãy hủy assignment trước khi ngừng hoạt động.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.crm_kpi_guard_employee_deactivation()
  from public, anon, authenticated;

drop trigger if exists app_users_kpi_draft_deactivation_guard on public.app_users;
create trigger app_users_kpi_draft_deactivation_guard
before update of active, lifecycle_status on public.app_users
for each row execute function public.crm_kpi_guard_employee_deactivation();

-- ---------------------------------------------------------------------------
-- 4. Canonical RLS and grants
-- ---------------------------------------------------------------------------

alter table public.kpi_periods enable row level security;
alter table public.kpi_definitions enable row level security;
alter table public.kpi_assignments enable row level security;

revoke all on public.kpi_periods from anon, authenticated;
revoke all on public.kpi_definitions from anon, authenticated;
revoke all on public.kpi_assignments from anon, authenticated;

grant select on public.kpi_periods to authenticated;
grant select on public.kpi_definitions to authenticated;
grant select on public.kpi_assignments to authenticated;

drop policy if exists "kpi periods canonical read" on public.kpi_periods;
create policy "kpi periods canonical read" on public.kpi_periods
for select to authenticated
using (
  public.crm_kpi_is_business_manager()
  or (
    status in ('ACTIVE', 'CLOSED')
    and public.crm_kpi_sale_has_period_assignment(id)
  )
);

drop policy if exists "kpi definitions canonical manager read" on public.kpi_definitions;
create policy "kpi definitions canonical manager read" on public.kpi_definitions
for select to authenticated
using (public.crm_kpi_is_business_manager());

drop policy if exists "kpi assignments canonical read" on public.kpi_assignments;
create policy "kpi assignments canonical read" on public.kpi_assignments
for select to authenticated
using (
  public.crm_kpi_is_business_manager()
  or public.crm_kpi_sale_can_read_assignment(period_id, employee_id)
);

-- ---------------------------------------------------------------------------
-- 5. Period RPCs
-- ---------------------------------------------------------------------------

create or replace function public.crm_kpi_create_period(
  p_period_month date,
  p_name text,
  p_timezone text default 'Asia/Ho_Chi_Minh'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id text := public.crm_current_app_user_id();
  v_month date := date_trunc('month', p_period_month)::date;
  v_timezone text := coalesce(nullif(btrim(p_timezone), ''), 'Asia/Ho_Chi_Minh');
  v_period public.kpi_periods%rowtype;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin/owner được tạo kỳ KPI.';
  end if;
  if p_period_month is null then
    raise exception using errcode = '22004', message = 'Tháng KPI là bắt buộc.';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception using errcode = '22023', message = 'Tên kỳ KPI là bắt buộc.';
  end if;
  if not exists (select 1 from pg_timezone_names where name = v_timezone) then
    raise exception using errcode = '22023', message = 'Múi giờ KPI không hợp lệ.';
  end if;

  perform set_config('crm.kpi_write', 'on', true);
  insert into public.kpi_periods(
    period_month, name, status, timezone, starts_at, ends_at,
    created_by_user_id, created_at, updated_at, version
  ) values (
    v_month, btrim(p_name), 'DRAFT', v_timezone,
    v_month::timestamp at time zone v_timezone,
    (v_month + interval '1 month')::timestamp at time zone v_timezone,
    v_actor_id, now(), now(), 1
  ) returning * into v_period;

  perform public.crm_kpi_write_audit(
    'period_create', 'kpi_periods', v_period.id::text,
    jsonb_build_object('periodId', v_period.id, 'after', to_jsonb(v_period))
  );
  return to_jsonb(v_period);
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'Tháng này đã có kỳ KPI.';
end;
$$;

create or replace function public.crm_kpi_update_period(
  p_period_id uuid,
  p_expected_version integer,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.kpi_periods%rowtype;
  v_new public.kpi_periods%rowtype;
  v_name text;
  v_timezone text;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin/owner được sửa kỳ KPI.';
  end if;
  select * into v_old from public.kpi_periods where id = p_period_id for update;
  if v_old.id is null then
    raise exception using errcode = 'P0002', message = 'Không tìm thấy kỳ KPI.';
  end if;
  if v_old.status <> 'DRAFT' then
    raise exception using errcode = '55000', message = 'Chỉ kỳ DRAFT mới được sửa.';
  end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Kỳ KPI đã thay đổi. Hãy tải lại trước khi sửa.';
  end if;

  v_name := case when p_changes ? 'name' then nullif(btrim(p_changes->>'name'), '') else v_old.name end;
  v_timezone := case when p_changes ? 'timezone' then nullif(btrim(p_changes->>'timezone'), '') else v_old.timezone end;
  if v_name is null then raise exception using errcode = '22023', message = 'Tên kỳ KPI là bắt buộc.'; end if;
  if v_timezone is null or not exists (select 1 from pg_timezone_names where name = v_timezone) then
    raise exception using errcode = '22023', message = 'Múi giờ KPI không hợp lệ.';
  end if;

  perform set_config('crm.kpi_write', 'on', true);
  update public.kpi_periods
  set name = v_name,
      timezone = v_timezone,
      starts_at = period_month::timestamp at time zone v_timezone,
      ends_at = (period_month + interval '1 month')::timestamp at time zone v_timezone,
      updated_at = now(),
      version = version + 1
  where id = p_period_id
  returning * into v_new;

  perform public.crm_kpi_write_audit(
    'period_update', 'kpi_periods', p_period_id::text,
    jsonb_build_object('periodId', p_period_id, 'before', to_jsonb(v_old), 'after', to_jsonb(v_new))
  );
  return to_jsonb(v_new);
end;
$$;

create or replace function public.crm_kpi_activate_period(
  p_period_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.kpi_periods%rowtype;
  v_new public.kpi_periods%rowtype;
  v_assignment_count integer;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin/owner được kích hoạt kỳ KPI.';
  end if;
  select * into v_old from public.kpi_periods where id = p_period_id for update;
  if v_old.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy kỳ KPI.'; end if;
  if v_old.status <> 'DRAFT' then
    raise exception using errcode = '55000', message = 'Chỉ kỳ DRAFT mới được kích hoạt.';
  end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Kỳ KPI đã thay đổi. Hãy tải lại trước khi kích hoạt.';
  end if;

  select count(*) into v_assignment_count
  from public.kpi_assignments a
  where a.period_id = p_period_id and a.assignment_status = 'ASSIGNED';
  if v_assignment_count = 0 then
    raise exception using errcode = '22023', message = 'Kỳ KPI chưa có assignment hợp lệ.';
  end if;
  if exists (
    select 1
    from public.kpi_assignments a
    left join public.app_users u on u.id = a.employee_id
    left join public.kpi_definitions d on d.id = a.definition_id
    where a.period_id = p_period_id
      and a.assignment_status = 'ASSIGNED'
      and (
        a.target <= 0 or u.id is null or lower(coalesce(u.role, '')) <> 'sale'
        or coalesce(u.active, false) = false
        or lower(coalesce(u.lifecycle_status, 'inactive')) <> 'active'
        or d.id is null or coalesce(d.active, false) = false
      )
  ) then
    raise exception using errcode = '22023', message = 'Kỳ KPI có target, definition hoặc nhân viên không hợp lệ.';
  end if;

  perform set_config('crm.kpi_write', 'on', true);
  update public.kpi_periods
  set status = 'ACTIVE',
      activated_by_user_id = public.crm_current_app_user_id(),
      activated_at = now(),
      updated_at = now(),
      version = version + 1
  where id = p_period_id
  returning * into v_new;

  perform public.crm_kpi_write_audit(
    'period_activate', 'kpi_periods', p_period_id::text,
    jsonb_build_object(
      'periodId', p_period_id,
      'assignmentCount', v_assignment_count,
      'before', to_jsonb(v_old),
      'after', to_jsonb(v_new)
    )
  );
  return to_jsonb(v_new);
end;
$$;

create or replace function public.crm_kpi_close_period_foundation(
  p_period_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.kpi_periods%rowtype;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin/owner được yêu cầu đóng kỳ KPI.';
  end if;
  select * into v_period from public.kpi_periods where id = p_period_id for update;
  if v_period.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy kỳ KPI.'; end if;
  if v_period.status <> 'ACTIVE' then
    raise exception using errcode = '55000', message = 'Chỉ kỳ ACTIVE mới có thể yêu cầu đóng.';
  end if;
  if p_expected_version is null or v_period.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Kỳ KPI đã thay đổi. Hãy tải lại.';
  end if;

  -- KPI-1 has no submissions/results, so closing would falsely certify a period.
  perform public.crm_kpi_write_audit(
    'period_close_attempt', 'kpi_periods', p_period_id::text,
    jsonb_build_object(
      'periodId', p_period_id,
      'closed', false,
      'reason', 'KPI-2 review/result finalization is not installed'
    )
  );
  return jsonb_build_object(
    'id', p_period_id,
    'closed', false,
    'code', 'KPI_REVIEW_FOUNDATION_INCOMPLETE',
    'message', 'Chưa thể đóng kỳ trước khi KPI-2 hoàn thiện review và kết quả chính thức.'
  );
end;
$$;

create or replace function public.crm_kpi_reopen_period(
  p_period_id uuid,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.kpi_periods%rowtype;
  v_new public.kpi_periods%rowtype;
begin
  if not public.crm_kpi_is_admin_owner() then
    raise exception using errcode = '42501', message = 'Chỉ admin/owner được mở lại kỳ KPI đã đóng.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'Lý do mở lại kỳ KPI là bắt buộc.';
  end if;
  select * into v_old from public.kpi_periods where id = p_period_id for update;
  if v_old.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy kỳ KPI.'; end if;
  if v_old.status <> 'CLOSED' then
    raise exception using errcode = '55000', message = 'Chỉ kỳ CLOSED mới được mở lại.';
  end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Kỳ KPI đã thay đổi. Hãy tải lại.';
  end if;

  perform set_config('crm.kpi_write', 'on', true);
  update public.kpi_periods
  set status = 'ACTIVE',
      reopened_by_user_id = public.crm_current_app_user_id(),
      reopened_at = now(),
      reopen_reason = btrim(p_reason),
      updated_at = now(),
      version = version + 1
  where id = p_period_id
  returning * into v_new;

  perform public.crm_kpi_write_audit(
    'period_reopen', 'kpi_periods', p_period_id::text,
    jsonb_build_object(
      'periodId', p_period_id,
      'reason', btrim(p_reason),
      'before', to_jsonb(v_old),
      'after', to_jsonb(v_new)
    )
  );
  return to_jsonb(v_new);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Definition RPCs
-- ---------------------------------------------------------------------------

create or replace function public.crm_kpi_create_definition(
  p_code text,
  p_name text,
  p_description text,
  p_kpi_type text,
  p_source_metric_key text,
  p_unit text,
  p_submission_mode text default 'EVENT_CLAIM',
  p_evidence_required boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id text := public.crm_current_app_user_id();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_type text := upper(btrim(coalesce(p_kpi_type, '')));
  v_mode text := upper(btrim(coalesce(p_submission_mode, 'EVENT_CLAIM')));
  v_definition public.kpi_definitions%rowtype;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin/owner được tạo KPI definition.';
  end if;
  if v_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception using errcode = '22023', message = 'Mã KPI chỉ gồm A-Z, 0-9, dấu gạch dưới và dài 2-64 ký tự.';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception using errcode = '22023', message = 'Tên KPI là bắt buộc.';
  end if;
  if v_type not in ('AUTO', 'MANUAL', 'HYBRID') then
    raise exception using errcode = '22023', message = 'Loại KPI không hợp lệ.';
  end if;
  if v_mode not in ('EVENT_CLAIM', 'PERIOD_TOTAL') then
    raise exception using errcode = '22023', message = 'Submission mode không hợp lệ.';
  end if;
  if nullif(btrim(coalesce(p_unit, '')), '') is null then
    raise exception using errcode = '22023', message = 'Đơn vị KPI là bắt buộc.';
  end if;

  perform set_config('crm.kpi_write', 'on', true);
  insert into public.kpi_definitions(
    code, name, description, kpi_type, source_metric_key, unit,
    submission_mode, evidence_required, active,
    created_by_user_id, updated_by_user_id, created_at, updated_at, version
  ) values (
    v_code, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
    v_type, nullif(btrim(coalesce(p_source_metric_key, '')), ''), btrim(p_unit),
    v_mode, coalesce(p_evidence_required, false), true,
    v_actor_id, v_actor_id, now(), now(), 1
  ) returning * into v_definition;

  perform public.crm_kpi_write_audit(
    'definition_create', 'kpi_definitions', v_definition.id::text,
    jsonb_build_object('definitionId', v_definition.id, 'after', to_jsonb(v_definition))
  );
  return to_jsonb(v_definition);
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'Mã KPI đã tồn tại.';
end;
$$;

create or replace function public.crm_kpi_update_definition(
  p_definition_id uuid,
  p_expected_version integer,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.kpi_definitions%rowtype;
  v_new public.kpi_definitions%rowtype;
  v_name text;
  v_type text;
  v_unit text;
  v_mode text;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin/owner được sửa KPI definition.';
  end if;
  select * into v_old from public.kpi_definitions where id = p_definition_id for update;
  if v_old.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy KPI definition.'; end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: KPI definition đã thay đổi. Hãy tải lại.';
  end if;
  if p_changes ? 'code' and upper(btrim(p_changes->>'code')) <> v_old.code then
    raise exception using errcode = '55000', message = 'Mã KPI không được đổi sau khi tạo.';
  end if;

  v_name := case when p_changes ? 'name' then nullif(btrim(p_changes->>'name'), '') else v_old.name end;
  v_type := case when p_changes ? 'kpiType' then upper(btrim(p_changes->>'kpiType')) else v_old.kpi_type end;
  v_unit := case when p_changes ? 'unit' then nullif(btrim(p_changes->>'unit'), '') else v_old.unit end;
  v_mode := case when p_changes ? 'submissionMode' then upper(btrim(p_changes->>'submissionMode')) else v_old.submission_mode end;
  if v_name is null then raise exception using errcode = '22023', message = 'Tên KPI là bắt buộc.'; end if;
  if v_type not in ('AUTO', 'MANUAL', 'HYBRID') then raise exception using errcode = '22023', message = 'Loại KPI không hợp lệ.'; end if;
  if v_unit is null then raise exception using errcode = '22023', message = 'Đơn vị KPI là bắt buộc.'; end if;
  if v_mode not in ('EVENT_CLAIM', 'PERIOD_TOTAL') then raise exception using errcode = '22023', message = 'Submission mode không hợp lệ.'; end if;

  perform set_config('crm.kpi_write', 'on', true);
  update public.kpi_definitions
  set name = v_name,
      description = case when p_changes ? 'description' then nullif(btrim(p_changes->>'description'), '') else description end,
      kpi_type = v_type,
      source_metric_key = case when p_changes ? 'sourceMetricKey' then nullif(btrim(p_changes->>'sourceMetricKey'), '') else source_metric_key end,
      unit = v_unit,
      submission_mode = v_mode,
      evidence_required = case when p_changes ? 'evidenceRequired' then coalesce((p_changes->>'evidenceRequired')::boolean, false) else evidence_required end,
      updated_by_user_id = public.crm_current_app_user_id(),
      updated_at = now(),
      version = version + 1
  where id = p_definition_id
  returning * into v_new;

  perform public.crm_kpi_write_audit(
    'definition_update', 'kpi_definitions', p_definition_id::text,
    jsonb_build_object('definitionId', p_definition_id, 'before', to_jsonb(v_old), 'after', to_jsonb(v_new))
  );
  return to_jsonb(v_new);
end;
$$;

create or replace function public.crm_kpi_set_definition_active(
  p_definition_id uuid,
  p_expected_version integer,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.kpi_definitions%rowtype;
  v_new public.kpi_definitions%rowtype;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin/owner được bật/tắt KPI definition.';
  end if;
  select * into v_old from public.kpi_definitions where id = p_definition_id for update;
  if v_old.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy KPI definition.'; end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: KPI definition đã thay đổi. Hãy tải lại.';
  end if;

  perform set_config('crm.kpi_write', 'on', true);
  update public.kpi_definitions
  set active = coalesce(p_active, false),
      updated_by_user_id = public.crm_current_app_user_id(),
      updated_at = now(),
      version = version + 1
  where id = p_definition_id
  returning * into v_new;

  perform public.crm_kpi_write_audit(
    case when v_new.active then 'definition_activate' else 'definition_deactivate' end,
    'kpi_definitions', p_definition_id::text,
    jsonb_build_object('definitionId', p_definition_id, 'before', to_jsonb(v_old), 'after', to_jsonb(v_new))
  );
  return to_jsonb(v_new);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Assignment RPCs
-- ---------------------------------------------------------------------------

create or replace function public.crm_kpi_assign_employee(
  p_period_id uuid,
  p_definition_id uuid,
  p_employee_id text,
  p_target numeric,
  p_expected_period_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.kpi_periods%rowtype;
  v_definition public.kpi_definitions%rowtype;
  v_employee public.app_users%rowtype;
  v_existing public.kpi_assignments%rowtype;
  v_assignment public.kpi_assignments%rowtype;
  v_snapshot jsonb;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin/owner được giao KPI.';
  end if;
  if p_target is null or p_target <= 0 then
    raise exception using errcode = '22023', message = 'Target KPI phải lớn hơn 0.';
  end if;
  select * into v_period from public.kpi_periods where id = p_period_id for update nowait;
  if v_period.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy kỳ KPI.'; end if;
  if v_period.status <> 'DRAFT' then raise exception using errcode = '55000', message = 'Chỉ kỳ DRAFT mới được giao KPI.'; end if;
  if p_expected_period_version is null or v_period.version <> p_expected_period_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Kỳ KPI đã thay đổi. Hãy tải lại.';
  end if;

  select * into v_definition from public.kpi_definitions where id = p_definition_id for share nowait;
  if v_definition.id is null or not v_definition.active then
    raise exception using errcode = '22023', message = 'KPI definition không tồn tại hoặc đang tắt.';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('crm:kpi:employee:' || p_employee_id, 0)) then
    raise exception using errcode = '55P03', message = 'Nhân viên đang được cập nhật KPI. Hãy tải lại và thử lại.';
  end if;
  select * into v_employee from public.app_users where id = p_employee_id;
  if v_employee.id is null
     or lower(coalesce(v_employee.role, '')) <> 'sale'
     or not coalesce(v_employee.active, false)
     or lower(coalesce(v_employee.lifecycle_status, 'inactive')) <> 'active' then
    raise exception using errcode = '22023', message = 'Chỉ được giao KPI cho sale ACTIVE.';
  end if;

  v_snapshot := public.crm_kpi_definition_snapshot(v_definition);
  select * into v_existing
  from public.kpi_assignments
  where period_id = p_period_id and definition_id = p_definition_id and employee_id = p_employee_id
  for update;

  perform set_config('crm.kpi_write', 'on', true);
  if v_existing.id is null then
    insert into public.kpi_assignments(
      period_id, definition_id, employee_id, target, effective_at,
      assignment_status, definition_snapshot, assigned_by_user_id,
      assigned_at, created_at, updated_at, lock_version
    ) values (
      p_period_id, p_definition_id, p_employee_id, p_target, v_period.starts_at,
      'ASSIGNED', v_snapshot, public.crm_current_app_user_id(),
      now(), now(), now(), 1
    ) returning * into v_assignment;
  elsif v_existing.assignment_status = 'CANCELLED' then
    update public.kpi_assignments
    set target = p_target,
        effective_at = v_period.starts_at,
        assignment_status = 'ASSIGNED',
        definition_snapshot = v_snapshot,
        assigned_by_user_id = public.crm_current_app_user_id(),
        assigned_at = now(),
        cancelled_by_user_id = null,
        cancelled_at = null,
        cancel_reason = null,
        updated_at = now(),
        lock_version = lock_version + 1
    where id = v_existing.id
    returning * into v_assignment;
  else
    raise exception using errcode = '23505', message = 'Sale đã được giao KPI này trong kỳ.';
  end if;

  update public.kpi_periods set version = version + 1, updated_at = now()
  where id = p_period_id;
  perform public.crm_kpi_write_audit(
    'assignment_create', 'kpi_assignments', v_assignment.id::text,
    jsonb_build_object(
      'periodId', p_period_id,
      'definitionId', p_definition_id,
      'assignmentId', v_assignment.id,
      'employeeId', p_employee_id,
      'before', case when v_existing.id is null then null else to_jsonb(v_existing) end,
      'after', to_jsonb(v_assignment),
      'periodVersion', v_period.version + 1
    )
  );
  return to_jsonb(v_assignment) || jsonb_build_object('periodVersion', v_period.version + 1);
end;
$$;

create or replace function public.crm_kpi_bulk_assign(
  p_period_id uuid,
  p_definition_id uuid,
  p_rows jsonb,
  p_expected_period_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.kpi_periods%rowtype;
  v_definition public.kpi_definitions%rowtype;
  v_employee public.app_users%rowtype;
  v_existing public.kpi_assignments%rowtype;
  v_assignment public.kpi_assignments%rowtype;
  v_row jsonb;
  v_employee_id text;
  v_target numeric;
  v_snapshot jsonb;
  v_ids jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin/owner được giao KPI hàng loạt.';
  end if;
  if coalesce(jsonb_typeof(p_rows), '') <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception using errcode = '22023', message = 'Danh sách giao KPI không hợp lệ.';
  end if;
  if jsonb_array_length(p_rows) > 200 then
    raise exception using errcode = '54000', message = 'Mỗi lần chỉ được giao tối đa 200 sale.';
  end if;
  if (select count(*) from jsonb_array_elements(p_rows)) <>
     (select count(distinct nullif(btrim(value->>'employeeId'), '')) from jsonb_array_elements(p_rows)) then
    raise exception using errcode = '22023', message = 'Danh sách giao KPI có employee trùng hoặc thiếu.';
  end if;

  select * into v_period from public.kpi_periods where id = p_period_id for update nowait;
  if v_period.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy kỳ KPI.'; end if;
  if v_period.status <> 'DRAFT' then raise exception using errcode = '55000', message = 'Chỉ kỳ DRAFT mới được giao KPI.'; end if;
  if p_expected_period_version is null or v_period.version <> p_expected_period_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Kỳ KPI đã thay đổi. Hãy tải lại.';
  end if;
  select * into v_definition from public.kpi_definitions where id = p_definition_id for share nowait;
  if v_definition.id is null or not v_definition.active then
    raise exception using errcode = '22023', message = 'KPI definition không tồn tại hoặc đang tắt.';
  end if;
  v_snapshot := public.crm_kpi_definition_snapshot(v_definition);

  -- Validate every row before the first write. Row locks serialize deactivation.
  for v_row in select value from jsonb_array_elements(p_rows) order by value->>'employeeId'
  loop
    v_employee_id := nullif(btrim(v_row->>'employeeId'), '');
    begin
      v_target := (v_row->>'target')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'Target trong danh sách không hợp lệ.';
    end;
    if v_target is null or v_target <= 0 then
      raise exception using errcode = '22023', message = 'Mọi target KPI phải lớn hơn 0.';
    end if;
    if not pg_try_advisory_xact_lock(hashtextextended('crm:kpi:employee:' || v_employee_id, 0)) then
      raise exception using errcode = '55P03', message = 'Danh sách có nhân viên đang được cập nhật KPI. Hãy tải lại.';
    end if;
    select * into v_employee from public.app_users where id = v_employee_id;
    if v_employee.id is null
       or lower(coalesce(v_employee.role, '')) <> 'sale'
       or not coalesce(v_employee.active, false)
       or lower(coalesce(v_employee.lifecycle_status, 'inactive')) <> 'active' then
      raise exception using errcode = '22023', message = 'Danh sách có nhân viên không phải sale ACTIVE.';
    end if;
  end loop;

  perform set_config('crm.kpi_write', 'on', true);
  for v_row in select value from jsonb_array_elements(p_rows) order by value->>'employeeId'
  loop
    v_employee_id := btrim(v_row->>'employeeId');
    v_target := (v_row->>'target')::numeric;
    select * into v_existing
    from public.kpi_assignments
    where period_id = p_period_id and definition_id = p_definition_id and employee_id = v_employee_id
    for update;

    if v_existing.id is null then
      insert into public.kpi_assignments(
        period_id, definition_id, employee_id, target, effective_at,
        assignment_status, definition_snapshot, assigned_by_user_id,
        assigned_at, created_at, updated_at, lock_version
      ) values (
        p_period_id, p_definition_id, v_employee_id, v_target, v_period.starts_at,
        'ASSIGNED', v_snapshot, public.crm_current_app_user_id(),
        now(), now(), now(), 1
      ) returning * into v_assignment;
    elsif v_existing.assignment_status = 'CANCELLED' then
      update public.kpi_assignments
      set target = v_target,
          effective_at = v_period.starts_at,
          assignment_status = 'ASSIGNED',
          definition_snapshot = v_snapshot,
          assigned_by_user_id = public.crm_current_app_user_id(),
          assigned_at = now(),
          cancelled_by_user_id = null,
          cancelled_at = null,
          cancel_reason = null,
          updated_at = now(),
          lock_version = lock_version + 1
      where id = v_existing.id
      returning * into v_assignment;
    else
      raise exception using errcode = '23505', message = 'Danh sách có sale đã được giao KPI này.';
    end if;
    v_ids := v_ids || jsonb_build_array(v_assignment.id);
    v_count := v_count + 1;
  end loop;

  update public.kpi_periods set version = version + 1, updated_at = now()
  where id = p_period_id;
  perform public.crm_kpi_write_audit(
    'assignment_bulk_create', 'kpi_periods', p_period_id::text,
    jsonb_build_object(
      'periodId', p_period_id,
      'definitionId', p_definition_id,
      'assignmentIds', v_ids,
      'rows', p_rows,
      'count', v_count,
      'periodVersion', v_period.version + 1
    )
  );
  return jsonb_build_object(
    'periodId', p_period_id,
    'definitionId', p_definition_id,
    'assignmentIds', v_ids,
    'count', v_count,
    'periodVersion', v_period.version + 1
  );
end;
$$;

create or replace function public.crm_kpi_update_assignment_target(
  p_assignment_id uuid,
  p_target numeric,
  p_expected_assignment_version integer,
  p_expected_period_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
  v_period public.kpi_periods%rowtype;
  v_old public.kpi_assignments%rowtype;
  v_new public.kpi_assignments%rowtype;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin/owner được sửa target KPI.';
  end if;
  if p_target is null or p_target <= 0 then
    raise exception using errcode = '22023', message = 'Target KPI phải lớn hơn 0.';
  end if;
  select period_id into v_period_id from public.kpi_assignments where id = p_assignment_id;
  if v_period_id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy assignment KPI.'; end if;
  select * into v_period from public.kpi_periods where id = v_period_id for update;
  select * into v_old from public.kpi_assignments where id = p_assignment_id for update;
  if v_period.status <> 'DRAFT' then raise exception using errcode = '55000', message = 'Chỉ kỳ DRAFT mới được sửa target.'; end if;
  if v_old.assignment_status <> 'ASSIGNED' then raise exception using errcode = '55000', message = 'Assignment đã bị hủy.'; end if;
  if p_expected_period_version is null or v_period.version <> p_expected_period_version
     or p_expected_assignment_version is null or v_old.lock_version <> p_expected_assignment_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Cấu hình KPI đã thay đổi. Hãy tải lại.';
  end if;

  perform set_config('crm.kpi_write', 'on', true);
  update public.kpi_assignments
  set target = p_target, updated_at = now(), lock_version = lock_version + 1
  where id = p_assignment_id
  returning * into v_new;
  update public.kpi_periods set version = version + 1, updated_at = now()
  where id = v_period.id;

  perform public.crm_kpi_write_audit(
    'assignment_target_update', 'kpi_assignments', p_assignment_id::text,
    jsonb_build_object(
      'periodId', v_period.id,
      'definitionId', v_old.definition_id,
      'assignmentId', p_assignment_id,
      'employeeId', v_old.employee_id,
      'before', to_jsonb(v_old),
      'after', to_jsonb(v_new),
      'periodVersion', v_period.version + 1
    )
  );
  return to_jsonb(v_new) || jsonb_build_object('periodVersion', v_period.version + 1);
end;
$$;

create or replace function public.crm_kpi_sync_definition_assignments(
  p_period_id uuid,
  p_definition_id uuid,
  p_rows jsonb,
  p_expected_period_version integer,
  p_reason text default 'Cập nhật ma trận KPI DRAFT'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.kpi_periods%rowtype;
  v_definition public.kpi_definitions%rowtype;
  v_employee public.app_users%rowtype;
  v_existing public.kpi_assignments%rowtype;
  v_row jsonb;
  v_employee_id text;
  v_target numeric;
  v_snapshot jsonb;
  v_before jsonb;
  v_after jsonb;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin/owner được cập nhật ma trận KPI.';
  end if;
  if coalesce(jsonb_typeof(p_rows), '') <> 'array' then
    raise exception using errcode = '22023', message = 'Danh sách ma trận KPI không hợp lệ.';
  end if;
  if jsonb_array_length(p_rows) > 200 then
    raise exception using errcode = '54000', message = 'Mỗi KPI chỉ được đồng bộ tối đa 200 sale.';
  end if;
  if jsonb_array_length(p_rows) > 0 and (
    (select count(*) from jsonb_array_elements(p_rows)) <>
    (select count(distinct nullif(btrim(value->>'employeeId'), '')) from jsonb_array_elements(p_rows))
  ) then
    raise exception using errcode = '22023', message = 'Ma trận KPI có employee trùng hoặc thiếu.';
  end if;

  select * into v_period from public.kpi_periods where id = p_period_id for update nowait;
  if v_period.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy kỳ KPI.'; end if;
  if v_period.status <> 'DRAFT' then raise exception using errcode = '55000', message = 'Chỉ kỳ DRAFT mới được sửa ma trận KPI.'; end if;
  if p_expected_period_version is null or v_period.version <> p_expected_period_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Kỳ KPI đã thay đổi. Hãy tải lại.';
  end if;
  select * into v_definition from public.kpi_definitions where id = p_definition_id for share nowait;
  if v_definition.id is null or not v_definition.active then
    raise exception using errcode = '22023', message = 'KPI definition không tồn tại hoặc đang tắt.';
  end if;
  v_snapshot := public.crm_kpi_definition_snapshot(v_definition);

  -- Lock existing rows and preserve an audit snapshot before mutation.
  perform 1 from public.kpi_assignments
  where period_id = p_period_id and definition_id = p_definition_id
  order by employee_id
  for update;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.employee_id), '[]'::jsonb)
  into v_before
  from public.kpi_assignments a
  where a.period_id = p_period_id and a.definition_id = p_definition_id;

  -- Validate and lock every desired employee before the first write.
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_employee_id := nullif(btrim(v_row->>'employeeId'), '');
    begin
      v_target := (v_row->>'target')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'Target trong ma trận KPI không hợp lệ.';
    end;
    if v_target is null or v_target <= 0 then
      raise exception using errcode = '22023', message = 'Mọi target KPI phải lớn hơn 0.';
    end if;
    if not pg_try_advisory_xact_lock(hashtextextended('crm:kpi:employee:' || v_employee_id, 0)) then
      raise exception using errcode = '55P03', message = 'Ma trận có nhân viên đang được cập nhật KPI. Hãy tải lại.';
    end if;
    select * into v_employee from public.app_users where id = v_employee_id;
    if v_employee.id is null
       or lower(coalesce(v_employee.role, '')) <> 'sale'
       or not coalesce(v_employee.active, false)
       or lower(coalesce(v_employee.lifecycle_status, 'inactive')) <> 'active' then
      raise exception using errcode = '22023', message = 'Ma trận có nhân viên không phải sale ACTIVE.';
    end if;
  end loop;

  perform set_config('crm.kpi_write', 'on', true);

  -- Rows not present in the desired matrix are cancelled, never deleted.
  update public.kpi_assignments a
  set assignment_status = 'CANCELLED',
      cancelled_by_user_id = public.crm_current_app_user_id(),
      cancelled_at = now(),
      cancel_reason = coalesce(nullif(btrim(p_reason), ''), 'Cập nhật ma trận KPI DRAFT'),
      updated_at = now(),
      lock_version = lock_version + 1
  where a.period_id = p_period_id
    and a.definition_id = p_definition_id
    and a.assignment_status = 'ASSIGNED'
    and not exists (
      select 1 from jsonb_array_elements(p_rows) row_data
      where btrim(row_data->>'employeeId') = a.employee_id
    );

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_employee_id := btrim(v_row->>'employeeId');
    v_target := (v_row->>'target')::numeric;
    select * into v_existing
    from public.kpi_assignments
    where period_id = p_period_id and definition_id = p_definition_id and employee_id = v_employee_id
    for update;

    if v_existing.id is null then
      insert into public.kpi_assignments(
        period_id, definition_id, employee_id, target, effective_at,
        assignment_status, definition_snapshot, assigned_by_user_id,
        assigned_at, created_at, updated_at, lock_version
      ) values (
        p_period_id, p_definition_id, v_employee_id, v_target, v_period.starts_at,
        'ASSIGNED', v_snapshot, public.crm_current_app_user_id(),
        now(), now(), now(), 1
      );
    else
      update public.kpi_assignments
      set target = v_target,
          effective_at = v_period.starts_at,
          assignment_status = 'ASSIGNED',
          definition_snapshot = v_snapshot,
          assigned_by_user_id = public.crm_current_app_user_id(),
          assigned_at = case when assignment_status = 'CANCELLED' then now() else assigned_at end,
          cancelled_by_user_id = null,
          cancelled_at = null,
          cancel_reason = null,
          updated_at = now(),
          lock_version = lock_version + 1
      where id = v_existing.id;
    end if;
  end loop;

  update public.kpi_periods set version = version + 1, updated_at = now()
  where id = p_period_id;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.employee_id), '[]'::jsonb)
  into v_after
  from public.kpi_assignments a
  where a.period_id = p_period_id and a.definition_id = p_definition_id;

  perform public.crm_kpi_write_audit(
    'assignment_matrix_sync', 'kpi_periods', p_period_id::text,
    jsonb_build_object(
      'periodId', p_period_id,
      'definitionId', p_definition_id,
      'reason', coalesce(nullif(btrim(p_reason), ''), 'Cập nhật ma trận KPI DRAFT'),
      'before', v_before,
      'after', v_after,
      'periodVersion', v_period.version + 1
    )
  );
  return jsonb_build_object(
    'periodId', p_period_id,
    'definitionId', p_definition_id,
    'assignments', v_after,
    'periodVersion', v_period.version + 1
  );
end;
$$;

create or replace function public.crm_kpi_cancel_assignment(
  p_assignment_id uuid,
  p_expected_assignment_version integer,
  p_expected_period_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
  v_period public.kpi_periods%rowtype;
  v_old public.kpi_assignments%rowtype;
  v_new public.kpi_assignments%rowtype;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin/owner được hủy assignment KPI.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'Lý do hủy assignment là bắt buộc.';
  end if;
  select period_id into v_period_id from public.kpi_assignments where id = p_assignment_id;
  if v_period_id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy assignment KPI.'; end if;
  select * into v_period from public.kpi_periods where id = v_period_id for update;
  select * into v_old from public.kpi_assignments where id = p_assignment_id for update;
  if v_period.status <> 'DRAFT' then raise exception using errcode = '55000', message = 'Chỉ kỳ DRAFT mới được hủy assignment.'; end if;
  if v_old.assignment_status <> 'ASSIGNED' then raise exception using errcode = '55000', message = 'Assignment đã bị hủy.'; end if;
  if p_expected_period_version is null or v_period.version <> p_expected_period_version
     or p_expected_assignment_version is null or v_old.lock_version <> p_expected_assignment_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Cấu hình KPI đã thay đổi. Hãy tải lại.';
  end if;

  perform set_config('crm.kpi_write', 'on', true);
  update public.kpi_assignments
  set assignment_status = 'CANCELLED',
      cancelled_by_user_id = public.crm_current_app_user_id(),
      cancelled_at = now(),
      cancel_reason = btrim(p_reason),
      updated_at = now(),
      lock_version = lock_version + 1
  where id = p_assignment_id
  returning * into v_new;
  update public.kpi_periods set version = version + 1, updated_at = now()
  where id = v_period.id;

  perform public.crm_kpi_write_audit(
    'assignment_cancel', 'kpi_assignments', p_assignment_id::text,
    jsonb_build_object(
      'periodId', v_period.id,
      'definitionId', v_old.definition_id,
      'assignmentId', p_assignment_id,
      'employeeId', v_old.employee_id,
      'reason', btrim(p_reason),
      'before', to_jsonb(v_old),
      'after', to_jsonb(v_new),
      'periodVersion', v_period.version + 1
    )
  );
  return to_jsonb(v_new) || jsonb_build_object('periodVersion', v_period.version + 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. RPC exposure
-- ---------------------------------------------------------------------------

revoke all on function public.crm_kpi_create_period(date, text, text) from public, anon;
revoke all on function public.crm_kpi_update_period(uuid, integer, jsonb) from public, anon;
revoke all on function public.crm_kpi_activate_period(uuid, integer) from public, anon;
revoke all on function public.crm_kpi_close_period_foundation(uuid, integer) from public, anon;
revoke all on function public.crm_kpi_reopen_period(uuid, integer, text) from public, anon;
revoke all on function public.crm_kpi_create_definition(text, text, text, text, text, text, text, boolean) from public, anon;
revoke all on function public.crm_kpi_update_definition(uuid, integer, jsonb) from public, anon;
revoke all on function public.crm_kpi_set_definition_active(uuid, integer, boolean) from public, anon;
revoke all on function public.crm_kpi_assign_employee(uuid, uuid, text, numeric, integer) from public, anon;
revoke all on function public.crm_kpi_bulk_assign(uuid, uuid, jsonb, integer) from public, anon;
revoke all on function public.crm_kpi_update_assignment_target(uuid, numeric, integer, integer) from public, anon;
revoke all on function public.crm_kpi_sync_definition_assignments(uuid, uuid, jsonb, integer, text) from public, anon;
revoke all on function public.crm_kpi_cancel_assignment(uuid, integer, integer, text) from public, anon;

grant execute on function public.crm_kpi_create_period(date, text, text) to authenticated;
grant execute on function public.crm_kpi_update_period(uuid, integer, jsonb) to authenticated;
grant execute on function public.crm_kpi_activate_period(uuid, integer) to authenticated;
grant execute on function public.crm_kpi_close_period_foundation(uuid, integer) to authenticated;
grant execute on function public.crm_kpi_reopen_period(uuid, integer, text) to authenticated;
grant execute on function public.crm_kpi_create_definition(text, text, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.crm_kpi_update_definition(uuid, integer, jsonb) to authenticated;
grant execute on function public.crm_kpi_set_definition_active(uuid, integer, boolean) to authenticated;
grant execute on function public.crm_kpi_assign_employee(uuid, uuid, text, numeric, integer) to authenticated;
grant execute on function public.crm_kpi_bulk_assign(uuid, uuid, jsonb, integer) to authenticated;
grant execute on function public.crm_kpi_update_assignment_target(uuid, numeric, integer, integer) to authenticated;
grant execute on function public.crm_kpi_sync_definition_assignments(uuid, uuid, jsonb, integer, text) to authenticated;
grant execute on function public.crm_kpi_cancel_assignment(uuid, integer, integer, text) to authenticated;

commit;
