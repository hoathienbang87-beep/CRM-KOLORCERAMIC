-- CRM-KPI-R3: canonical ACTIVE-period flexibility and legacy write retirement.
-- Historical legacy rows and storage objects are intentionally preserved.

begin;

create or replace function public.crm_kpi_r3_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'Lý do phải có từ 1 đến 500 ký tự.';
  end if;
  return v_reason;
end;
$$;

revoke all on function public.crm_kpi_r3_reason(text) from public, anon, authenticated;
grant execute on function public.crm_kpi_r3_reason(text) to service_role;

create or replace function public.crm_kpi_assign_employee_r3(
  p_period_id uuid,
  p_definition_id uuid,
  p_employee_id text,
  p_target numeric,
  p_expected_period_version integer,
  p_reason text default null
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
  v_assignment public.kpi_assignments%rowtype;
  v_reason text;
  v_score_enabled boolean;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode='42501', message='Chỉ manager/admin/owner được giao KPI.';
  end if;
  if p_target is null or p_target <= 0 then
    raise exception using errcode='22023', message='Target KPI phải lớn hơn 0.';
  end if;

  select * into v_period from public.kpi_periods where id=p_period_id for update;
  if v_period.id is null then raise exception using errcode='P0002', message='Không tìm thấy kỳ KPI.'; end if;
  if v_period.status not in ('DRAFT','ACTIVE') then
    raise exception using errcode='55000', message='Kỳ KPI đã CLOSED và không thể thay đổi.';
  end if;
  if p_expected_period_version is null or v_period.version<>p_expected_period_version then
    raise exception using errcode='P0001', message='KPI_VERSION_CONFLICT: Kỳ KPI đã thay đổi. Hãy tải lại.';
  end if;
  if v_period.status='ACTIVE' then v_reason := public.crm_kpi_r3_reason(p_reason); end if;

  select * into v_definition from public.kpi_definitions where id=p_definition_id for share;
  if v_definition.id is null or not v_definition.active then
    raise exception using errcode='22023', message='KPI definition không tồn tại hoặc đang ngừng sử dụng.';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('crm:kpi:employee:'||p_employee_id,0)) then
    raise exception using errcode='55P03', message='Nhân viên đang được cập nhật KPI.';
  end if;
  select * into v_employee from public.app_users where id=p_employee_id;
  if v_employee.id is null or lower(coalesce(v_employee.role,''))<>'sale'
     or not coalesce(v_employee.active,false)
     or lower(coalesce(v_employee.lifecycle_status,'inactive'))<>'active' then
    raise exception using errcode='22023', message='Chỉ được giao KPI cho Sale ACTIVE.';
  end if;
  if exists(select 1 from public.kpi_assignments where period_id=p_period_id and definition_id=p_definition_id and employee_id=p_employee_id) then
    raise exception using errcode='23505', message='Sale đã có KPI này trong kỳ; assignment đã hủy không được tái sử dụng.';
  end if;

  v_score_enabled := coalesce(v_definition.source_metric_key,'') <> 'deals_v1';
  perform set_config('crm.kpi_write','on',true);
  insert into public.kpi_assignments(
    period_id,definition_id,employee_id,target,effective_at,assignment_status,
    definition_snapshot,score_enabled,assigned_by_user_id,assigned_at,created_at,updated_at,lock_version
  ) values (
    p_period_id,p_definition_id,p_employee_id,p_target,
    case when v_period.status='ACTIVE' then now() else v_period.starts_at end,
    'ASSIGNED',public.crm_kpi_definition_snapshot(v_definition),v_score_enabled,
    public.crm_current_app_user_id(),now(),now(),now(),1
  ) returning * into v_assignment;
  update public.kpi_periods set version=version+1,updated_at=now() where id=v_period.id;

  perform public.crm_kpi_write_audit(
    case when v_period.status='ACTIVE' then 'ACTIVE_ASSIGNMENT_ADDED' else 'assignment_create' end,
    'kpi_assignments',v_assignment.id::text,
    jsonb_build_object('periodId',v_period.id,'definitionId',v_definition.id,'assignmentId',v_assignment.id,
      'employeeId',v_employee.id,'reason',v_reason,'before',null,'after',to_jsonb(v_assignment),
      'periodVersion',v_period.version+1)
  );
  return to_jsonb(v_assignment)||jsonb_build_object('periodVersion',v_period.version+1);
end;
$$;

create or replace function public.crm_kpi_update_assignment_target_r3(
  p_assignment_id uuid,
  p_target numeric,
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
  v_old public.kpi_assignments%rowtype;
  v_new public.kpi_assignments%rowtype;
  v_period public.kpi_periods%rowtype;
  v_reason text;
  v_runtime_count bigint;
begin
  if not public.crm_kpi_is_business_manager() then raise exception using errcode='42501',message='Không có quyền sửa target KPI.'; end if;
  if p_target is null or p_target<=0 then raise exception using errcode='22023',message='Target KPI phải lớn hơn 0.'; end if;
  select * into v_old from public.kpi_assignments where id=p_assignment_id for update;
  if v_old.id is null then raise exception using errcode='P0002',message='Không tìm thấy assignment KPI.'; end if;
  select * into v_period from public.kpi_periods where id=v_old.period_id for update;
  if v_period.status not in ('DRAFT','ACTIVE') then raise exception using errcode='55000',message='Kỳ KPI đã CLOSED và không thể thay đổi.'; end if;
  if v_old.assignment_status<>'ASSIGNED' then raise exception using errcode='55000',message='Assignment đã ngừng áp dụng.'; end if;
  if p_expected_assignment_version is null or v_old.lock_version<>p_expected_assignment_version
     or p_expected_period_version is null or v_period.version<>p_expected_period_version then
    raise exception using errcode='P0001',message='KPI_VERSION_CONFLICT: Cấu hình KPI đã thay đổi. Hãy tải lại.';
  end if;
  if v_period.status='ACTIVE' then v_reason:=public.crm_kpi_r3_reason(p_reason); end if;
  select count(*) into v_runtime_count from public.kpi_submission_events where assignment_id=v_old.id;
  perform set_config('crm.kpi_write','on',true);
  update public.kpi_assignments set target=p_target,updated_at=now(),lock_version=lock_version+1 where id=v_old.id returning * into v_new;
  update public.kpi_periods set version=version+1,updated_at=now() where id=v_period.id;
  perform public.crm_kpi_write_audit(
    case when v_period.status='ACTIVE' then 'ACTIVE_ASSIGNMENT_TARGET_CHANGED' else 'assignment_target_update' end,
    'kpi_assignments',v_new.id::text,
    jsonb_build_object('periodId',v_period.id,'definitionId',v_old.definition_id,'assignmentId',v_old.id,
      'employeeId',v_old.employee_id,'reason',v_reason,'runtimeEventCount',v_runtime_count,
      'oldTarget',v_old.target,'newTarget',v_new.target,'before',to_jsonb(v_old),'after',to_jsonb(v_new),
      'periodVersion',v_period.version+1)
  );
  return to_jsonb(v_new)||jsonb_build_object('periodVersion',v_period.version+1,'runtimeEventCount',v_runtime_count);
end;
$$;

create or replace function public.crm_kpi_update_assignment_options_r3(
  p_assignment_id uuid,
  p_score_enabled boolean,
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
  v_old public.kpi_assignments%rowtype;
  v_new public.kpi_assignments%rowtype;
  v_period public.kpi_periods%rowtype;
  v_reason text;
  v_runtime_count bigint;
begin
  if not public.crm_kpi_is_business_manager() then raise exception using errcode='42501',message='Không có quyền sửa tùy chọn KPI.'; end if;
  if p_score_enabled is null then raise exception using errcode='22023',message='score_enabled phải được chọn rõ ràng.'; end if;
  select * into v_old from public.kpi_assignments where id=p_assignment_id for update;
  if v_old.id is null then raise exception using errcode='P0002',message='Không tìm thấy assignment KPI.'; end if;
  select * into v_period from public.kpi_periods where id=v_old.period_id for update;
  if v_period.status not in ('DRAFT','ACTIVE') then raise exception using errcode='55000',message='Kỳ KPI đã CLOSED và không thể thay đổi.'; end if;
  if v_old.assignment_status<>'ASSIGNED' then raise exception using errcode='55000',message='Assignment đã ngừng áp dụng.'; end if;
  if p_expected_assignment_version is null or v_old.lock_version<>p_expected_assignment_version
     or p_expected_period_version is null or v_period.version<>p_expected_period_version then
    raise exception using errcode='P0001',message='KPI_VERSION_CONFLICT: Cấu hình KPI đã thay đổi. Hãy tải lại.';
  end if;
  if v_period.status='ACTIVE' then v_reason:=public.crm_kpi_r3_reason(p_reason); end if;
  select count(*) into v_runtime_count from public.kpi_submission_events where assignment_id=v_old.id;
  perform set_config('crm.kpi_write','on',true);
  update public.kpi_assignments set score_enabled=p_score_enabled,updated_at=now(),lock_version=lock_version+1 where id=v_old.id returning * into v_new;
  update public.kpi_periods set version=version+1,updated_at=now() where id=v_period.id;
  perform public.crm_kpi_write_audit(
    case when v_period.status='ACTIVE' then 'ACTIVE_ASSIGNMENT_OPTIONS_CHANGED' else 'assignment_options_update' end,
    'kpi_assignments',v_new.id::text,
    jsonb_build_object('periodId',v_period.id,'definitionId',v_old.definition_id,'assignmentId',v_old.id,
      'employeeId',v_old.employee_id,'reason',v_reason,'runtimeEventCount',v_runtime_count,
      'oldScoreEnabled',v_old.score_enabled,'newScoreEnabled',v_new.score_enabled,
      'before',to_jsonb(v_old),'after',to_jsonb(v_new),'periodVersion',v_period.version+1)
  );
  return to_jsonb(v_new)||jsonb_build_object('periodVersion',v_period.version+1,'runtimeEventCount',v_runtime_count);
end;
$$;

create or replace function public.crm_kpi_remove_or_cancel_assignment_r3(
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
  v_old public.kpi_assignments%rowtype;
  v_new public.kpi_assignments%rowtype;
  v_period public.kpi_periods%rowtype;
  v_reason text := public.crm_kpi_r3_reason(p_reason);
  v_submissions bigint;
  v_events bigint;
  v_evidence bigint;
  v_used boolean;
begin
  if not public.crm_kpi_is_business_manager() then raise exception using errcode='42501',message='Không có quyền gỡ/ngừng KPI.'; end if;
  select * into v_old from public.kpi_assignments where id=p_assignment_id for update;
  if v_old.id is null then raise exception using errcode='P0002',message='Không tìm thấy assignment KPI.'; end if;
  select * into v_period from public.kpi_periods where id=v_old.period_id for update;
  if v_period.status not in ('DRAFT','ACTIVE') then raise exception using errcode='55000',message='Kỳ KPI đã CLOSED và không thể thay đổi.'; end if;
  if v_old.assignment_status<>'ASSIGNED' then raise exception using errcode='55000',message='Assignment đã ngừng áp dụng.'; end if;
  if p_expected_assignment_version is null or v_old.lock_version<>p_expected_assignment_version
     or p_expected_period_version is null or v_period.version<>p_expected_period_version then
    raise exception using errcode='P0001',message='KPI_VERSION_CONFLICT: Cấu hình KPI đã thay đổi. Hãy tải lại.';
  end if;

  select count(*) into v_submissions from public.kpi_submissions where assignment_id=v_old.id;
  select count(*) into v_events from public.kpi_submission_events where assignment_id=v_old.id;
  select count(*) into v_evidence from public.kpi_evidence where assignment_id=v_old.id;
  v_used := v_submissions+v_events+v_evidence>0;
  perform set_config('crm.kpi_write','on',true);

  if not v_used then
    delete from public.kpi_assignments where id=v_old.id;
    update public.kpi_periods set version=version+1,updated_at=now() where id=v_period.id;
    perform public.crm_kpi_write_audit(
      case when v_period.status='ACTIVE' then 'ACTIVE_ASSIGNMENT_REMOVED_UNUSED' else 'assignment_remove' end,
      'kpi_assignments',v_old.id::text,
      jsonb_build_object('periodId',v_period.id,'definitionId',v_old.definition_id,'assignmentId',v_old.id,
        'employeeId',v_old.employee_id,'reason',v_reason,'before',to_jsonb(v_old),'after',null,
        'dependencyCounts',jsonb_build_object('submissions',v_submissions,'events',v_events,'evidence',v_evidence),
        'periodVersion',v_period.version+1)
    );
    return jsonb_build_object('operation','REMOVED','assignmentId',v_old.id,'periodVersion',v_period.version+1,
      'dependencyCounts',jsonb_build_object('submissions',v_submissions,'events',v_events,'evidence',v_evidence));
  end if;

  if v_period.status<>'ACTIVE' then
    raise exception using errcode='55000',message='DRAFT assignment có dữ liệu bất thường nên không thể xóa.';
  end if;
  update public.kpi_assignments set assignment_status='CANCELLED',cancelled_by_user_id=public.crm_current_app_user_id(),
    cancelled_at=now(),cancel_reason=v_reason,updated_at=now(),lock_version=lock_version+1
  where id=v_old.id returning * into v_new;
  update public.kpi_periods set version=version+1,updated_at=now() where id=v_period.id;
  perform public.crm_kpi_write_audit('ACTIVE_ASSIGNMENT_CANCELLED','kpi_assignments',v_old.id::text,
    jsonb_build_object('periodId',v_period.id,'definitionId',v_old.definition_id,'assignmentId',v_old.id,
      'employeeId',v_old.employee_id,'reason',v_reason,'before',to_jsonb(v_old),'after',to_jsonb(v_new),
      'dependencyCounts',jsonb_build_object('submissions',v_submissions,'events',v_events,'evidence',v_evidence),
      'periodVersion',v_period.version+1));
  return to_jsonb(v_new)||jsonb_build_object('operation','CANCELLED','periodVersion',v_period.version+1,
    'dependencyCounts',jsonb_build_object('submissions',v_submissions,'events',v_events,'evidence',v_evidence));
end;
$$;

create or replace function public.crm_kpi_create_definition_active_r3(
  p_period_id uuid,
  p_expected_period_version integer,
  p_reason text,
  p_code text,
  p_name text,
  p_description text,
  p_kpi_type text,
  p_source_metric_key text,
  p_unit text,
  p_submission_mode text,
  p_evidence_required boolean,
  p_aggregation_mode text,
  p_max_images_per_event integer,
  p_location_required boolean,
  p_timestamp_required boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.kpi_periods%rowtype;
  v_row public.kpi_definitions%rowtype;
  v_reason text := public.crm_kpi_r3_reason(p_reason);
  v_code text := upper(btrim(coalesce(p_code,'')));
  v_type text := upper(btrim(coalesce(p_kpi_type,'')));
  v_mode text := upper(btrim(coalesce(p_submission_mode,'EVENT_CLAIM')));
  v_agg text := upper(btrim(coalesce(p_aggregation_mode,'COUNT')));
begin
  if not public.crm_kpi_is_business_manager() then raise exception using errcode='42501',message='Không có quyền tạo KPI.'; end if;
  select * into v_period from public.kpi_periods where id=p_period_id for update;
  if v_period.id is null then raise exception using errcode='P0002',message='Không tìm thấy kỳ KPI.'; end if;
  if v_period.status<>'ACTIVE' then raise exception using errcode='55000',message='RPC này chỉ tạo definition cho kỳ ACTIVE.'; end if;
  if p_expected_period_version is null or v_period.version<>p_expected_period_version then
    raise exception using errcode='P0001',message='KPI_VERSION_CONFLICT: Kỳ KPI đã thay đổi. Hãy tải lại.';
  end if;
  if v_code !~ '^[A-Z][A-Z0-9_]{1,63}$' or nullif(btrim(coalesce(p_name,'')),'') is null or nullif(btrim(coalesce(p_unit,'')),'') is null then
    raise exception using errcode='22023',message='Mã, tên hoặc đơn vị KPI không hợp lệ.';
  end if;
  if v_type not in ('AUTO','MANUAL','HYBRID') or v_mode<>'EVENT_CLAIM' or v_agg not in ('COUNT','SUM') then
    raise exception using errcode='22023',message='Cấu hình KPI không hợp lệ.';
  end if;
  if coalesce(p_max_images_per_event,2) not between 0 and 2 then raise exception using errcode='22023',message='Tối đa 0-2 ảnh mỗi event.'; end if;
  perform set_config('crm.kpi_write','on',true);
  insert into public.kpi_definitions(code,name,description,kpi_type,source_metric_key,unit,submission_mode,evidence_required,
    aggregation_mode,max_images_per_event,location_required,timestamp_required,active,created_by_user_id,updated_by_user_id)
  values(v_code,btrim(p_name),nullif(btrim(coalesce(p_description,'')),''),v_type,nullif(btrim(coalesce(p_source_metric_key,'')),''),btrim(p_unit),
    v_mode,coalesce(p_evidence_required,false),v_agg,coalesce(p_max_images_per_event,2),coalesce(p_location_required,false),
    coalesce(p_timestamp_required,true),true,public.crm_current_app_user_id(),public.crm_current_app_user_id()) returning * into v_row;
  update public.kpi_periods set version=version+1,updated_at=now() where id=v_period.id;
  perform public.crm_kpi_write_audit('ACTIVE_DEFINITION_CREATED','kpi_definitions',v_row.id::text,
    jsonb_build_object('periodId',v_period.id,'reason',v_reason,'before',null,'after',to_jsonb(v_row),'periodVersion',v_period.version+1));
  return to_jsonb(v_row)||jsonb_build_object('periodVersion',v_period.version+1);
exception when unique_violation then raise exception using errcode='23505',message='Mã KPI đã tồn tại.';
end;
$$;

create or replace function public.crm_kpi_get_config_history_r3(p_period_id uuid, p_employee_id text default null)
returns table(id text, action text, entity text, entity_id text, actor_email text, actor_name text, occurred_at timestamptz, reason text, payload jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select l.id,l.action,l.entity,l.entity_id,l.email,u.name,l.created_at,
    coalesce(l.raw_data->>'reason',''),l.raw_data
  from public.audit_logs l
  left join public.app_users u on u.id=l.raw_data->>'actorUserId'
  where l.action in ('ACTIVE_ASSIGNMENT_ADDED','ACTIVE_ASSIGNMENT_TARGET_CHANGED','ACTIVE_ASSIGNMENT_OPTIONS_CHANGED',
    'ACTIVE_ASSIGNMENT_REMOVED_UNUSED','ACTIVE_ASSIGNMENT_CANCELLED','ACTIVE_DEFINITION_CREATED')
    and l.raw_data->>'periodId'=p_period_id::text
    and (p_employee_id is null or l.raw_data->>'employeeId'=p_employee_id)
    and (public.crm_kpi_is_business_manager() or l.raw_data->>'employeeId'=public.crm_current_app_user_id())
  order by l.created_at desc;
$$;

revoke all on function public.crm_kpi_assign_employee_r3(uuid,uuid,text,numeric,integer,text) from public,anon;
revoke all on function public.crm_kpi_update_assignment_target_r3(uuid,numeric,integer,integer,text) from public,anon;
revoke all on function public.crm_kpi_update_assignment_options_r3(uuid,boolean,integer,integer,text) from public,anon;
revoke all on function public.crm_kpi_remove_or_cancel_assignment_r3(uuid,integer,integer,text) from public,anon;
revoke all on function public.crm_kpi_create_definition_active_r3(uuid,integer,text,text,text,text,text,text,text,text,boolean,text,integer,boolean,boolean) from public,anon;
revoke all on function public.crm_kpi_get_config_history_r3(uuid,text) from public,anon;
grant execute on function public.crm_kpi_assign_employee_r3(uuid,uuid,text,numeric,integer,text) to authenticated,service_role;
grant execute on function public.crm_kpi_update_assignment_target_r3(uuid,numeric,integer,integer,text) to authenticated,service_role;
grant execute on function public.crm_kpi_update_assignment_options_r3(uuid,boolean,integer,integer,text) to authenticated,service_role;
grant execute on function public.crm_kpi_remove_or_cancel_assignment_r3(uuid,integer,integer,text) to authenticated,service_role;
grant execute on function public.crm_kpi_create_definition_active_r3(uuid,integer,text,text,text,text,text,text,text,text,boolean,text,integer,boolean,boolean) to authenticated,service_role;
grant execute on function public.crm_kpi_get_config_history_r3(uuid,text) to authenticated,service_role;

-- Legacy remains queryable as historical archive, but normal authenticated users can no longer mutate it.
revoke execute on function public.crm_submit_kpi_proposal(text,jsonb) from authenticated;
revoke execute on function public.crm_review_kpi_proposal(text,text,text,jsonb) from authenticated;
revoke execute on function public.crm_archive_kpi_proposal(text) from authenticated;
revoke insert,update,delete,truncate,references,trigger on table public.kpi_rules from authenticated;
revoke insert,update,delete,truncate,references,trigger on table public.kpi_proposals from authenticated;

commit;
