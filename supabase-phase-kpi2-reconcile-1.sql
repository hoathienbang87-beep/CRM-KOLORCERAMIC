-- STAGING DEVELOPMENT / SUPERSEDED FOR PRODUCTION.
-- Production source of truth: supabase-phase-kpi2-final-consolidated.sql.
-- KPI-2 staging reconcile 1: fix review UUID array typing and implement
-- revision as its own append-only transaction.
begin;

create or replace function public.crm_kpi_submit_revision(
  p_event_id uuid, p_request_id uuid, p_sale_note text, p_event jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor text:=public.crm_current_app_user_id(); v_old public.kpi_submission_events%rowtype;
  v_a public.kpi_assignments%rowtype; v_p public.kpi_periods%rowtype; v_s public.kpi_submissions%rowtype;
  v_new public.kpi_submission_events%rowtype; v_snapshot jsonb; v_location jsonb; v_evidence jsonb;
  v_evidence_id uuid; v_count integer; v_value numeric; v_existing jsonb; v_result jsonb;
begin
  if p_request_id is null then raise exception using errcode='22023', message='Revision request ID là bắt buộc.'; end if;
  select response into v_existing from public.kpi_action_requests where actor_user_id=v_actor and action='event_revision' and request_id=p_request_id;
  if v_existing is not null then return v_existing; end if;
  select * into v_old from public.kpi_submission_events where id=p_event_id for update;
  if v_old.id is null or v_old.actor_user_id<>v_actor or v_old.status<>'NEEDS_REVISION' then
    raise exception using errcode='42501', message='Chỉ event NEEDS_REVISION của bạn mới được gửi lại.'; end if;
  if exists(select 1 from public.kpi_submission_events where supersedes_event_id=v_old.id) then
    raise exception using errcode='23505', message='Event này đã có revision.'; end if;
  select * into v_a from public.kpi_assignments where id=v_old.assignment_id and employee_id=v_actor and assignment_status='ASSIGNED' for update;
  select * into v_p from public.kpi_periods where id=v_a.period_id;
  if v_p.status<>'ACTIVE' then raise exception using errcode='55000', message='Chỉ kỳ ACTIVE nhận revision.'; end if;
  v_snapshot:=coalesce(p_event->'eventSnapshot',v_old.event_snapshot);
  if coalesce(v_a.definition_snapshot->>'kpi_type','MANUAL') in ('HYBRID','AUTO') then
    v_snapshot:=public.crm_kpi_source_snapshot(v_a.id,v_old.source_type,v_old.source_id);
  elsif jsonb_typeof(v_snapshot)<>'object' or nullif(btrim(coalesce(v_snapshot->>'title',v_snapshot->>'description','')),'') is null then
    raise exception using errcode='22023', message='Revision MANUAL cần nội dung.';
  end if;
  begin v_value:=coalesce((p_event->>'claimedValue')::numeric,v_old.claimed_value); exception when others then raise exception using errcode='22023', message='Giá trị revision không hợp lệ.'; end;
  if coalesce(v_a.definition_snapshot->>'aggregation_mode','COUNT')='COUNT' then v_value:=1; elsif v_value<=0 then raise exception using errcode='22023', message='Giá trị SUM phải lớn hơn 0.'; end if;
  v_location:=coalesce(p_event->'location',v_old.location_snapshot);
  if coalesce((v_a.definition_snapshot->>'location_required')::boolean,false) and
    (v_location is null or jsonb_typeof(v_location)<>'object' or not(v_location?'latitude') or not(v_location?'longitude') or not(v_location?'accuracy'))
    then raise exception using errcode='22023', message='Revision bắt buộc vị trí.'; end if;
  v_evidence:=coalesce(p_event->'evidenceIds','[]'::jsonb);
  if jsonb_typeof(v_evidence)<>'array' then raise exception using errcode='22023', message='Danh sách evidence không hợp lệ.'; end if;
  v_count:=jsonb_array_length(v_evidence);
  if v_count>least(2,coalesce((v_a.definition_snapshot->>'max_images_per_event')::integer,2)) then raise exception using errcode='22023', message='Vượt quá số ảnh cho phép.'; end if;
  if coalesce((v_a.definition_snapshot->>'evidence_required')::boolean,false) and v_count=0 then raise exception using errcode='22023', message='Revision bắt buộc evidence mới.'; end if;
  perform set_config('crm.kpi_write','on',true);
  insert into public.kpi_submissions(assignment_id,attempt_no,request_id,submitted_by_user_id,sale_note)
  values(v_a.id,v_old.revision_no+1,p_request_id,v_actor,nullif(btrim(coalesce(p_sale_note,'')),'')) returning * into v_s;
  insert into public.kpi_submission_events(submission_id,assignment_id,source_type,source_id,source_event_key,event_at,actor_user_id,
    customer_id,claimed_value,event_snapshot,location_snapshot,possible_duplicate,duplicate_context,supersedes_event_id,root_event_id,revision_no)
  values(v_s.id,v_a.id,v_old.source_type,v_old.source_id,v_old.source_event_key,
    coalesce((p_event->>'eventAt')::timestamptz,v_old.event_at),v_actor,coalesce(nullif(p_event->>'customerId',''),v_old.customer_id),
    v_value,v_snapshot||jsonb_build_object('supersedesEventId',v_old.id),v_location,v_old.possible_duplicate,v_old.duplicate_context,
    v_old.id,coalesce(v_old.root_event_id,v_old.id),v_old.revision_no+1) returning * into v_new;
  for v_evidence_id in select value::text::uuid from jsonb_array_elements_text(v_evidence) loop
    update public.kpi_evidence set event_id=v_new.id,status='ATTACHED',attached_at=now(),updated_at=now(),lock_version=lock_version+1
    where id=v_evidence_id and assignment_id=v_a.id and uploaded_by_user_id=v_actor and status='STAGED';
    if not found then raise exception using errcode='22023', message='Evidence revision không hợp lệ.'; end if;
    perform public.crm_kpi_write_audit('evidence_attach','kpi_evidence',v_evidence_id::text,jsonb_build_object('eventId',v_new.id,'revision',true));
  end loop;
  v_result:=jsonb_build_object('submissionId',v_s.id,'eventIds',jsonb_build_array(v_new.id),'eventCount',1,'supersedesEventId',v_old.id);
  insert into public.kpi_action_requests(actor_user_id,action,request_id,response) values(v_actor,'event_revision',p_request_id,v_result);
  perform public.crm_kpi_write_audit('event_revision','kpi_submission_events',v_new.id::text,
    jsonb_build_object('assignmentId',v_a.id,'submissionId',v_s.id,'supersedesEventId',v_old.id,'newEventId',v_new.id,'after',to_jsonb(v_new)));
  return v_result;
end $$;

create or replace function public.crm_kpi_review_events(
  p_request_id uuid, p_rows jsonb, p_decision text, p_reason_code text, p_manager_note text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor text:=public.crm_current_app_user_id(); v_decision text:=upper(btrim(coalesce(p_decision,'')));
  v_reason text:=upper(nullif(btrim(coalesce(p_reason_code,'')),'')); v_existing jsonb; v_row jsonb;
  v_event public.kpi_submission_events%rowtype; v_ids uuid[]; v_submission_ids uuid[]:=array[]::uuid[];
  v_submission_id uuid; v_result jsonb:='[]'::jsonb;
begin
  if not public.crm_kpi_is_business_manager() or p_request_id is null then raise exception using errcode='42501', message='Chỉ manager/admin/owner được review KPI.'; end if;
  select response into v_existing from public.kpi_action_requests where actor_user_id=v_actor and action='event_review' and request_id=p_request_id;
  if v_existing is not null then return v_existing; end if;
  if v_decision not in ('APPROVED','REJECTED','NEEDS_REVISION') then raise exception using errcode='22023', message='Decision không hợp lệ.'; end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 100 then raise exception using errcode='22023', message='Review cần 1-100 event.'; end if;
  if jsonb_array_length(p_rows)<>(select count(distinct value->>'eventId') from jsonb_array_elements(p_rows)) then raise exception using errcode='22023', message='Danh sách event bị trùng.'; end if;
  if v_decision='REJECTED' and v_reason not in ('DUPLICATE','INVALID_EVIDENCE','MISSING_LOCATION','MISSING_TIMESTAMP','INCOMPLETE_INFORMATION','NOT_NEW','OUT_OF_SCOPE','OTHER')
    then raise exception using errcode='22023', message='Từ chối cần reason code hợp lệ.'; end if;
  if (v_decision='NEEDS_REVISION' or v_reason='OTHER') and nullif(btrim(coalesce(p_manager_note,'')),'') is null
    then raise exception using errcode='22023', message='Cần ghi chú Manager cho NEEDS_REVISION/OTHER.'; end if;
  select array_agg((x->>'eventId')::uuid order by x->>'eventId') into v_ids from jsonb_array_elements(p_rows) x;
  perform 1 from public.kpi_submission_events e where e.id=any(v_ids) order by e.id for update;
  if (select count(*) from public.kpi_submission_events where id=any(v_ids))<>cardinality(v_ids) then raise exception using errcode='P0002', message='Có event không tồn tại.'; end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    select e.* into v_event from public.kpi_submission_events e join public.kpi_assignments a on a.id=e.assignment_id
      join public.app_users u on u.id=a.employee_id where e.id=(v_row->>'eventId')::uuid and lower(u.role)='sale';
    if v_event.id is null then raise exception using errcode='42501', message='Manager chỉ review KPI của sale.'; end if;
    if v_event.status<>'PENDING' or v_event.lock_version<>coalesce((v_row->>'expectedVersion')::integer,0) then
      raise exception using errcode='P0001', message='EVENT_VERSION_CONFLICT: Event đã thay đổi.'; end if;
  end loop;
  perform set_config('crm.kpi_write','on',true);
  for v_row in select value from jsonb_array_elements(p_rows) loop
    update public.kpi_submission_events set status=v_decision,approved_value=case when v_decision='APPROVED' then claimed_value else null end,
      review_reason_code=case when v_decision='APPROVED' then null else v_reason end,manager_note=nullif(btrim(coalesce(p_manager_note,'')),''),
      reviewed_by_user_id=v_actor,reviewed_at=now(),updated_at=now(),lock_version=lock_version+1
    where id=(v_row->>'eventId')::uuid returning * into v_event;
    if not(v_event.submission_id=any(v_submission_ids)) then v_submission_ids:=array_append(v_submission_ids,v_event.submission_id); end if;
    perform public.crm_kpi_write_audit(case v_decision when 'APPROVED' then 'event_approve' when 'REJECTED' then 'event_reject' else 'event_needs_revision' end,
      'kpi_submission_events',v_event.id::text,jsonb_build_object('assignmentId',v_event.assignment_id,'submissionId',v_event.submission_id,
        'eventId',v_event.id,'employeeId',v_event.actor_user_id,'decision',v_decision,'reason',v_reason,'managerNote',p_manager_note,'after',to_jsonb(v_event)));
    v_result:=v_result||jsonb_build_array(jsonb_build_object('eventId',v_event.id,'status',v_event.status,'lockVersion',v_event.lock_version));
  end loop;
  foreach v_submission_id in array v_submission_ids loop perform public.crm_kpi_refresh_submission_status(v_submission_id); end loop;
  v_existing:=jsonb_build_object('decision',v_decision,'count',jsonb_array_length(v_result),'events',v_result);
  insert into public.kpi_action_requests(actor_user_id,action,request_id,response) values(v_actor,'event_review',p_request_id,v_existing);
  perform public.crm_kpi_write_audit('bulk_review','kpi_submission_events','bulk',jsonb_build_object('requestId',p_request_id,'decision',v_decision,'reason',v_reason,'events',v_result));
  return v_existing;
end $$;

revoke all on function public.crm_kpi_submit_revision(uuid,uuid,text,jsonb) from public,anon;
revoke all on function public.crm_kpi_review_events(uuid,jsonb,text,text,text) from public,anon;
grant execute on function public.crm_kpi_submit_revision(uuid,uuid,text,jsonb) to authenticated;
grant execute on function public.crm_kpi_review_events(uuid,jsonb,text,text,text) to authenticated;

commit;
