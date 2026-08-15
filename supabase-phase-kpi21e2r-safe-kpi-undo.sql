-- KPI-2.1E.2R: safe DRAFT assignment removal and definition lifecycle hardening.
-- Dependencies: KPI-1, KPI-2 final consolidated, KPI-2.1E.2.
-- Installing this migration does not mutate KPI business rows.

begin;

create or replace function public.crm_kpi_remove_draft_assignment(
  p_assignment_id uuid,
  p_expected_assignment_version integer,
  p_expected_period_version integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.kpi_assignments%rowtype;
  v_period public.kpi_periods%rowtype;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'Sửa cấu hình KPI DRAFT');
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Bạn không có quyền gỡ KPI khỏi nhân viên.';
  end if;

  select * into v_assignment
  from public.kpi_assignments
  where id = p_assignment_id
  for update;
  if v_assignment.id is null then
    raise exception using errcode = 'P0002', message = 'Không tìm thấy KPI đã gán.';
  end if;

  select * into v_period
  from public.kpi_periods
  where id = v_assignment.period_id
  for update;
  if v_period.id is null then
    raise exception using errcode = 'P0002', message = 'Không tìm thấy kỳ KPI.';
  end if;
  if v_period.status = 'ACTIVE' then
    raise exception using errcode = '55000', message = 'Không thể gỡ KPI vì kỳ KPI đã được kích hoạt.';
  elsif v_period.status = 'CLOSED' then
    raise exception using errcode = '55000', message = 'Không thể gỡ KPI vì kỳ KPI đã đóng.';
  elsif v_period.status <> 'DRAFT' then
    raise exception using errcode = '55000', message = 'Chỉ KPI thuộc kỳ DRAFT mới có thể gỡ.';
  end if;

  if p_expected_period_version is null
     or p_expected_assignment_version is null
     or v_period.version <> p_expected_period_version
     or v_assignment.lock_version <> p_expected_assignment_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Cấu hình đã thay đổi. Hãy tải lại.';
  end if;

  -- Check every canonical runtime child explicitly. FK RESTRICT remains the
  -- structural last line of defence; it is not used as business permission.
  if exists (select 1 from public.kpi_submissions where assignment_id = v_assignment.id)
     or exists (select 1 from public.kpi_submission_events where assignment_id = v_assignment.id)
     or exists (select 1 from public.kpi_evidence where assignment_id = v_assignment.id) then
    raise exception using errcode = '55000', message = 'Không thể gỡ KPI vì đã có dữ liệu phát sinh.';
  end if;

  perform public.crm_kpi_write_audit(
    'assignment_remove_draft', 'kpi_assignments', v_assignment.id::text,
    jsonb_build_object(
      'assignmentId', v_assignment.id,
      'employeeId', v_assignment.employee_id,
      'periodId', v_assignment.period_id,
      'definitionId', v_assignment.definition_id,
      'target', v_assignment.target,
      'scoreEnabled', v_assignment.score_enabled,
      'reason', v_reason,
      'removedAssignment', to_jsonb(v_assignment),
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
    'removed', true,
    'assignmentId', v_assignment.id,
    'employeeId', v_assignment.employee_id,
    'definitionId', v_assignment.definition_id,
    'periodId', v_period.id,
    'periodVersion', v_period.version + 1
  );
end;
$$;

-- Backward-compatible alias. Existing clients receive the same stronger
-- server-side guards while the UI moves to the explicit "remove" action.
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
begin
  return public.crm_kpi_remove_draft_assignment(
    p_assignment_id,
    p_expected_assignment_version,
    p_expected_period_version,
    'Sửa cấu hình KPI DRAFT từ client cũ'
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
    raise exception using errcode = '42501', message = 'Bạn không có quyền xóa KPI khỏi Bộ KPI.';
  end if;

  select * into v_definition
  from public.kpi_definitions
  where id = p_definition_id
  for update;
  if v_definition.id is null then
    raise exception using errcode = 'P0002', message = 'Không tìm thấy KPI definition.';
  end if;
  if p_expected_version is null or v_definition.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: KPI đã thay đổi. Hãy tải lại.';
  end if;

  -- Historical assignment rows are authoritative usage. A DRAFT assignment
  -- safely removed before runtime leaves no row and therefore permits cleanup.
  if exists (select 1 from public.kpi_assignments where definition_id = v_definition.id)
     or exists (
       select 1 from public.kpi_submissions s
       join public.kpi_assignments a on a.id = s.assignment_id
       where a.definition_id = v_definition.id
     )
     or exists (
       select 1 from public.kpi_submission_events e
       join public.kpi_assignments a on a.id = e.assignment_id
       where a.definition_id = v_definition.id
     )
     or exists (
       select 1 from public.kpi_evidence e
       join public.kpi_assignments a on a.id = e.assignment_id
       where a.definition_id = v_definition.id
     ) then
    raise exception using errcode = '55000', message = 'KPI này đã từng được sử dụng nên không thể xóa. Bạn có thể chọn Ngừng sử dụng.';
  end if;

  perform public.crm_kpi_write_audit(
    'definition_delete_unused', 'kpi_definitions', v_definition.id::text,
    jsonb_build_object(
      'definitionId', v_definition.id,
      'code', v_definition.code,
      'name', v_definition.name,
      'deletedDefinition', to_jsonb(v_definition)
    )
  );
  perform set_config('crm.kpi_write', 'on', true);
  delete from public.kpi_definitions where id = v_definition.id;

  return jsonb_build_object(
    'deleted', true,
    'definitionId', v_definition.id,
    'code', v_definition.code
  );
end;
$$;

revoke all on function public.crm_kpi_remove_draft_assignment(uuid, integer, integer, text) from public, anon;
revoke all on function public.crm_kpi_delete_draft_assignment(uuid, integer, integer) from public, anon;
revoke all on function public.crm_kpi_delete_unused_definition(uuid, integer) from public, anon;
grant execute on function public.crm_kpi_remove_draft_assignment(uuid, integer, integer, text) to authenticated;
grant execute on function public.crm_kpi_delete_draft_assignment(uuid, integer, integer) to authenticated;
grant execute on function public.crm_kpi_delete_unused_definition(uuid, integer) to authenticated;

commit;
