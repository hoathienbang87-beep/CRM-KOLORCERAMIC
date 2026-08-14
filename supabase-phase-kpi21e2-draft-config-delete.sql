-- KPI-2.1E.2: safe deletion for mistaken DRAFT KPI configuration.
-- Dependencies: KPI-1 foundation and KPI-2 final schema must already exist.
-- This migration does not delete application data when installed.

begin;

create or replace function public.crm_kpi_delete_draft_assignment(
  p_assignment_id uuid,
  p_expected_assignment_version integer,
  p_expected_period_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.kpi_assignments%rowtype;
  v_period public.kpi_periods%rowtype;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chi manager/admin/owner duoc xoa assignment KPI.';
  end if;

  select * into v_assignment
  from public.kpi_assignments
  where id = p_assignment_id
  for update;
  if v_assignment.id is null then
    raise exception using errcode = 'P0002', message = 'Khong tim thay assignment KPI.';
  end if;

  select * into v_period
  from public.kpi_periods
  where id = v_assignment.period_id
  for update;
  if v_period.status <> 'DRAFT' then
    raise exception using errcode = '55000', message = 'Chi assignment thuoc ky DRAFT moi duoc xoa.';
  end if;
  if p_expected_period_version is null or v_period.version <> p_expected_period_version
     or p_expected_assignment_version is null or v_assignment.lock_version <> p_expected_assignment_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Cau hinh KPI da thay doi. Hay tai lai.';
  end if;
  if exists (select 1 from public.kpi_submissions where assignment_id = v_assignment.id)
     or exists (select 1 from public.kpi_evidence where assignment_id = v_assignment.id) then
    raise exception using errcode = '55000', message = 'Assignment da phat sinh de xuat hoac minh chung nen khong the xoa.';
  end if;

  perform public.crm_kpi_write_audit(
    'assignment_delete_draft', 'kpi_assignments', v_assignment.id::text,
    jsonb_build_object(
      'periodId', v_period.id,
      'definitionId', v_assignment.definition_id,
      'employeeId', v_assignment.employee_id,
      'deleted', to_jsonb(v_assignment),
      'periodVersionBefore', v_period.version,
      'periodVersionAfter', v_period.version + 1
    )
  );
  perform set_config('crm.kpi_write', 'on', true);
  delete from public.kpi_assignments where id = v_assignment.id;
  update public.kpi_periods
  set version = version + 1, updated_at = now()
  where id = v_period.id;

  return jsonb_build_object(
    'deleted', true,
    'assignmentId', v_assignment.id,
    'periodId', v_period.id,
    'periodVersion', v_period.version + 1
  );
end;
$$;

create or replace function public.crm_kpi_delete_draft_period(
  p_period_id uuid,
  p_expected_period_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.kpi_periods%rowtype;
  v_assignments jsonb;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chi manager/admin/owner duoc xoa ky KPI.';
  end if;

  select * into v_period
  from public.kpi_periods
  where id = p_period_id
  for update;
  if v_period.id is null then
    raise exception using errcode = 'P0002', message = 'Khong tim thay ky KPI.';
  end if;
  if v_period.status <> 'DRAFT' then
    raise exception using errcode = '55000', message = 'Chi ky DRAFT moi duoc xoa.';
  end if;
  if p_expected_period_version is null or v_period.version <> p_expected_period_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Ky KPI da thay doi. Hay tai lai.';
  end if;

  perform 1
  from public.kpi_assignments
  where period_id = v_period.id
  order by id
  for update;

  if exists (
    select 1
    from public.kpi_submissions s
    join public.kpi_assignments a on a.id = s.assignment_id
    where a.period_id = v_period.id
  ) or exists (
    select 1
    from public.kpi_evidence e
    join public.kpi_assignments a on a.id = e.assignment_id
    where a.period_id = v_period.id
  ) then
    raise exception using errcode = '55000', message = 'Ky KPI da phat sinh de xuat hoac minh chung nen khong the xoa.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]'::jsonb)
  into v_assignments
  from public.kpi_assignments a
  where a.period_id = v_period.id;

  perform public.crm_kpi_write_audit(
    'period_delete_draft', 'kpi_periods', v_period.id::text,
    jsonb_build_object(
      'deletedPeriod', to_jsonb(v_period),
      'deletedAssignments', v_assignments,
      'assignmentCount', jsonb_array_length(v_assignments)
    )
  );
  perform set_config('crm.kpi_write', 'on', true);
  delete from public.kpi_assignments where period_id = v_period.id;
  delete from public.kpi_periods where id = v_period.id;

  return jsonb_build_object(
    'deleted', true,
    'periodId', v_period.id,
    'assignmentCount', jsonb_array_length(v_assignments)
  );
end;
$$;

create or replace function public.crm_kpi_delete_unused_definition(
  p_definition_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_definition public.kpi_definitions%rowtype;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chi manager/admin/owner duoc xoa KPI definition.';
  end if;

  select * into v_definition
  from public.kpi_definitions
  where id = p_definition_id
  for update;
  if v_definition.id is null then
    raise exception using errcode = 'P0002', message = 'Khong tim thay KPI definition.';
  end if;
  if p_expected_version is null or v_definition.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Definition da thay doi. Hay tai lai.';
  end if;
  if exists (select 1 from public.kpi_assignments where definition_id = v_definition.id) then
    raise exception using errcode = '55000', message = 'KPI definition dang hoac da duoc dung. Hay xoa ky DRAFT lien quan truoc; du lieu lich su khong duoc xoa.';
  end if;

  perform public.crm_kpi_write_audit(
    'definition_delete_unused', 'kpi_definitions', v_definition.id::text,
    jsonb_build_object('deleted', to_jsonb(v_definition))
  );
  perform set_config('crm.kpi_write', 'on', true);
  delete from public.kpi_definitions where id = v_definition.id;

  return jsonb_build_object('deleted', true, 'definitionId', v_definition.id);
end;
$$;

revoke all on function public.crm_kpi_delete_draft_assignment(uuid, integer, integer) from public, anon;
revoke all on function public.crm_kpi_delete_draft_period(uuid, integer) from public, anon;
revoke all on function public.crm_kpi_delete_unused_definition(uuid, integer) from public, anon;
grant execute on function public.crm_kpi_delete_draft_assignment(uuid, integer, integer) to authenticated;
grant execute on function public.crm_kpi_delete_draft_period(uuid, integer) to authenticated;
grant execute on function public.crm_kpi_delete_unused_definition(uuid, integer) to authenticated;

commit;
