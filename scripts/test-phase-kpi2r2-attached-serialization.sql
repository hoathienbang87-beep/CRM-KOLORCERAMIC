begin;

select set_config('crm.kpi_write', 'on', true);

insert into public.app_users(
  id, supabase_auth_id, email, name, role, active, lifecycle_status, raw_data
) values (
  'kpi2r2-sql-sale',
  '22222222-2222-4222-8222-222222222222'::uuid,
  'kpi2r2-sql-sale@example.com',
  'KPI2R2 SQL Sale',
  'sale',
  true,
  'active',
  '{"purpose":"KPI-2R.2 rollback-only integration"}'::jsonb
);

insert into public.kpi_periods(
  id, period_month, name, status, timezone, starts_at, ends_at,
  created_by_user_id, activated_by_user_id, activated_at
) values (
  '22222222-2222-4222-8222-222222222223'::uuid,
  '2021-01-01'::date,
  'KPI2R2 SQL rollback period',
  'ACTIVE',
  'Asia/Ho_Chi_Minh',
  '2020-12-31 17:00:00+00'::timestamptz,
  '2021-01-31 17:00:00+00'::timestamptz,
  'kpi2r2-sql-sale',
  'kpi2r2-sql-sale',
  now()
);

insert into public.kpi_definitions(
  id, code, name, kpi_type, unit, evidence_required,
  created_by_user_id, updated_by_user_id
) values (
  '22222222-2222-4222-8222-222222222224'::uuid,
  'KPI2R2_SQL_ROLLBACK',
  'KPI2R2 SQL rollback definition',
  'MANUAL',
  'luot',
  true,
  'kpi2r2-sql-sale',
  'kpi2r2-sql-sale'
);

insert into public.kpi_assignments(
  id, period_id, definition_id, employee_id, target, effective_at,
  definition_snapshot, assigned_by_user_id, score_enabled
) values (
  '22222222-2222-4222-8222-222222222225'::uuid,
  '22222222-2222-4222-8222-222222222223'::uuid,
  '22222222-2222-4222-8222-222222222224'::uuid,
  'kpi2r2-sql-sale',
  2,
  '2020-12-31 17:00:00+00'::timestamptz,
  '{
    "code":"KPI2R2_SQL_ROLLBACK",
    "name":"KPI2R2 SQL rollback definition",
    "description":"rollback-only integration fixture",
    "kpi_type":"MANUAL",
    "source_metric_key":null,
    "unit":"luot",
    "submission_mode":"EVENT_CLAIM",
    "evidence_required":true,
    "definition_version":1,
    "aggregation_mode":"COUNT",
    "max_images_per_event":2,
    "location_required":false,
    "timestamp_required":true
  }'::jsonb,
  'kpi2r2-sql-sale',
  true
);

insert into public.kpi_submissions(
  id, assignment_id, submission_no, request_id, submitted_by_user_id
) values (
  '22222222-2222-4222-8222-222222222226'::uuid,
  '22222222-2222-4222-8222-222222222225'::uuid,
  1,
  '22222222-2222-4222-8222-222222222227'::uuid,
  'kpi2r2-sql-sale'
);

insert into public.kpi_submission_events(
  id, submission_id, assignment_id, source_type, source_event_key,
  event_at, actor_user_id, claimed_value, event_snapshot
) values (
  '22222222-2222-4222-8222-222222222228'::uuid,
  '22222222-2222-4222-8222-222222222226'::uuid,
  '22222222-2222-4222-8222-222222222225'::uuid,
  'MANUAL',
  'manual:kpi2r2-sql-attached',
  '2021-01-15 03:00:00+00'::timestamptz,
  'kpi2r2-sql-sale',
  1,
  '{"title":"Attach wins"}'::jsonb
);

insert into public.kpi_evidence(
  id, assignment_id, event_id, object_path, original_name, mime_type,
  size_bytes, sha256, uploaded_by_user_id, attached_at, status, lock_version
) values (
  '22222222-2222-4222-8222-222222222229'::uuid,
  '22222222-2222-4222-8222-222222222225'::uuid,
  '22222222-2222-4222-8222-222222222228'::uuid,
  'kpi2/kpi2r2-sql-sale/22222222-2222-4222-8222-222222222229/attached.webp',
  'attached.webp',
  'image/webp',
  10,
  repeat('a', 64),
  'kpi2r2-sql-sale',
  now(),
  'ATTACHED',
  2
), (
  '22222222-2222-4222-8222-222222222230'::uuid,
  '22222222-2222-4222-8222-222222222225'::uuid,
  null,
  'kpi2/kpi2r2-sql-sale/22222222-2222-4222-8222-222222222230/staged.webp',
  'staged.webp',
  'image/webp',
  10,
  repeat('b', 64),
  'kpi2r2-sql-sale',
  null,
  'STAGED',
  1
);

select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","email":"kpi2r2-sql-sale@example.com","role":"authenticated"}',
  true
);

do $$
begin
  begin
    perform public.crm_kpi_request_discard_staged_evidence(
      '22222222-2222-4222-8222-222222222229'::uuid,
      '22222222-2222-4222-8222-222222222231'::uuid,
      2
    );
    raise exception 'KPI2R2_TEST_FAILED: ATTACHED evidence was discardable';
  exception
    when sqlstate '55000' then
      if position('KPI_EVIDENCE_NOT_DISCARDABLE' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end;
$$;

select public.crm_kpi_request_discard_staged_evidence(
  '22222222-2222-4222-8222-222222222230'::uuid,
  '22222222-2222-4222-8222-222222222232'::uuid,
  1
);

do $$
begin
  begin
    perform public.crm_kpi_submit_events(
      '22222222-2222-4222-8222-222222222225'::uuid,
      '22222222-2222-4222-8222-222222222233'::uuid,
      'discard wins serialization test',
      jsonb_build_array(jsonb_build_object(
        'sourceType', 'MANUAL',
        'sourceEventKey', 'manual:kpi2r2-sql-discard-wins',
        'eventAt', '2021-01-15T03:00:00.000Z',
        'claimedValue', 1,
        'eventSnapshot', jsonb_build_object('title', 'Discard wins'),
        'evidenceIds', jsonb_build_array('22222222-2222-4222-8222-222222222230')
      ))
    );
    raise exception 'KPI2R2_TEST_FAILED: ARCHIVED evidence was attached';
  exception
    when others then
      if sqlerrm like 'KPI2R2_TEST_FAILED:%' then
        raise;
      end if;
  end;
end;
$$;

select jsonb_build_object(
  'attachedDiscardDenied', (
    select status = 'ATTACHED'
      and event_id = '22222222-2222-4222-8222-222222222228'::uuid
    from public.kpi_evidence
    where id = '22222222-2222-4222-8222-222222222229'::uuid
  ),
  'discardWinsAttachDenied', (
    select status = 'ARCHIVED' and event_id is null and attached_at is null
    from public.kpi_evidence
    where id = '22222222-2222-4222-8222-222222222230'::uuid
  )
) as kpi2r2_attached_serialization_result;

rollback;
