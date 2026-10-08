-- =====================================================================
-- CRM-KPI PHASE 7C-A — Transactional period Close + PERIOD_CLOSED
-- auto-reject + Cancel open-item safety guard.
--
-- Business contract (Product Owner approved 2026-10-08):
--   * Normal lifecycle DRAFT -> ACTIVE -> CLOSED. CANCELLED stays exceptional.
--   * Close (Manager/Admin/Owner, ACTIVE only, optimistic version):
--     every OPEN item of the period becomes terminal REJECTED with the
--     machine reason PERIOD_CLOSED, submissions are re-finalised, then the
--     period becomes CLOSED — all in ONE transaction.
--   * Cancel (Admin/Owner) FAILS with KPI_PERIOD_OPEN_ITEMS while open
--     items exist. Cancel never auto-rejects.
--   * Reopen (Admin/Owner) is unchanged: CLOSED -> ACTIVE, reason + version
--     + audit; it never revives PERIOD_CLOSED rejections.
--   * event_at semantics, actual aggregation (APPROVED only), multiple
--     ACTIVE periods: unchanged.
--
-- OPEN ITEM (single canonical definition, crm_kpi_period_open_event_ids):
--   kpi_submission_events e of an assignment in the period where
--     e.status = 'PENDING'
--     OR (e.status = 'NEEDS_REVISION' AND no event has supersedes_event_id = e.id)
--   — the same predicate crm_kpi_get_assignment_progress uses for
--   has_open_items / needs_revision_count.
--
-- Objects:
--   ALTER  kpi_submission_events_reason_check  (+ 'PERIOD_CLOSED')
--   CREATE crm_kpi_period_open_event_ids(uuid)      internal (service_role)
--   CREATE crm_kpi_period_open_items(uuid)          manager read (authenticated)
--   REPLACE crm_kpi_close_period_foundation(uuid, integer)   same signature
--   REPLACE crm_kpi_cancel_active_period(uuid, integer, text) same signature
--
-- No data rewrite. Forward-only. Rollback guidance: see
-- docs/kpi/KPI-7C-A-PERIOD-CLOSE-LIFECYCLE.md.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Preconditions: refuse to install over drifted definitions.
-- ---------------------------------------------------------------------
do $$
declare
  v_expected jsonb := jsonb_build_object(
    'crm_kpi_close_period_foundation',      'a95bb935b7822c9700166055bf3b7eac',
    'crm_kpi_cancel_active_period',         '462fe13b70e6ef4c915d84021b5282d8',
    'crm_kpi_reopen_period',                '80f9b4434bf4d890ac541e864592cc38',
    'crm_kpi_refresh_submission_status',    '5e400e5c71db44dd17075d394608d3ed',
    'crm_kpi_guard_runtime_period_active',  '2e79400a55e697d7386dd42b0c058e66',
    'crm_kpi_period_runtime_dependencies',  '67ce23a9be524959c875c4456fd0eede',
    'crm_kpi_write_audit',                  '9da0455f5af1bffc7093252fcca9f8b2');
  v_key text;
  v_actual text;
  v_reason_def text;
begin
  for v_key in select jsonb_object_keys(v_expected) loop
    select md5(pg_get_functiondef(p.oid)) into v_actual
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_key;
    if v_actual is distinct from v_expected->>v_key then
      raise exception 'PRECONDITION_FAIL: % drifted (md5 %, expected %)', v_key, v_actual, v_expected->>v_key;
    end if;
  end loop;

  select pg_get_constraintdef(c.oid) into v_reason_def
  from pg_constraint c
  where c.conrelid = 'public.kpi_submission_events'::regclass
    and c.conname = 'kpi_submission_events_reason_check';
  if v_reason_def is null or v_reason_def like '%PERIOD_CLOSED%' then
    raise exception 'PRECONDITION_FAIL: kpi_submission_events_reason_check missing or already migrated: %', v_reason_def;
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'kpi_submission_events_r31_period_guard'
                 and tgrelid = 'public.kpi_submission_events'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'kpi_submissions_r31_period_guard'
                 and tgrelid = 'public.kpi_submissions'::regclass) then
    raise exception 'PRECONDITION_FAIL: runtime period guard triggers missing';
  end if;
  raise notice 'PRECONDITION_PASS: KPI 7C-A lifecycle migration';
end $$;

-- ---------------------------------------------------------------------
-- 1. Machine reason PERIOD_CLOSED (system-only; crm_kpi_review_events keeps
--    its own manager allow-list, so Managers cannot pick it by hand).
--    Existing rows all satisfy the widened check; no data is rewritten.
-- ---------------------------------------------------------------------
alter table public.kpi_submission_events drop constraint kpi_submission_events_reason_check;
alter table public.kpi_submission_events add constraint kpi_submission_events_reason_check check (
  review_reason_code is null or review_reason_code = any (array[
    'DUPLICATE', 'INVALID_EVIDENCE', 'MISSING_LOCATION', 'MISSING_TIMESTAMP',
    'INCOMPLETE_INFORMATION', 'NOT_NEW', 'OUT_OF_SCOPE', 'OTHER', 'PERIOD_CLOSED'
  ]::text[])
);
comment on constraint kpi_submission_events_reason_check on public.kpi_submission_events is
  'PERIOD_CLOSED is written only by crm_kpi_close_period_foundation (auto-reject on period Close). UI text: "Từ chối tự động do kỳ KPI đã được đóng."';

-- ---------------------------------------------------------------------
-- 2. Canonical OPEN ITEM definition (one predicate for Close, Cancel, UI).
-- ---------------------------------------------------------------------
create or replace function public.crm_kpi_period_open_event_ids(p_period_id uuid)
returns table(event_id uuid, submission_id uuid, open_state text)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.submission_id, e.status
  from public.kpi_submission_events e
  join public.kpi_assignments a on a.id = e.assignment_id
  where a.period_id = p_period_id
    and (
      e.status = 'PENDING'
      or (e.status = 'NEEDS_REVISION'
          and not exists (select 1 from public.kpi_submission_events r
                          where r.supersedes_event_id = e.id))
    );
$$;
revoke all on function public.crm_kpi_period_open_event_ids(uuid) from public, anon, authenticated;
grant execute on function public.crm_kpi_period_open_event_ids(uuid) to service_role;

create or replace function public.crm_kpi_period_open_items(p_period_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_result jsonb;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin/owner được xem mục chưa xử lý của kỳ KPI.';
  end if;
  select jsonb_build_object(
    'periodId', p_period_id,
    'pendingCount', count(*) filter (where open_state = 'PENDING'),
    'needsRevisionCount', count(*) filter (where open_state = 'NEEDS_REVISION'),
    'openTotal', count(*)
  ) into v_result
  from public.crm_kpi_period_open_event_ids(p_period_id);
  return v_result;
end;
$$;
revoke all on function public.crm_kpi_period_open_items(uuid) from public, anon;
grant execute on function public.crm_kpi_period_open_items(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Close: functional, atomic. Public API name and signature retained.
--
-- Concurrency: the period row is locked FOR UPDATE before the open-item
-- scan. Every runtime write path (crm_kpi_submit_events,
-- crm_kpi_submit_revision, crm_kpi_withdraw_event and the r31 trigger on
-- kpi_submissions / kpi_submission_events / kpi_evidence) takes FOR SHARE
-- on the same period row, so:
--   * a writer that got FOR SHARE first makes Close wait; its rows are
--     committed and visible to Close's scan (READ COMMITTED, new snapshot
--     per statement);
--   * a writer arriving after Close holds FOR UPDATE waits, then sees
--     status CLOSED and fails.
-- No open event can be created between the scan and ACTIVE -> CLOSED.
-- ---------------------------------------------------------------------
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
  v_actor text := public.crm_current_app_user_id();
  v_old public.kpi_periods%rowtype;
  v_new public.kpi_periods%rowtype;
  v_event public.kpi_submission_events%rowtype;
  v_prev public.kpi_submission_events%rowtype;
  v_ids uuid[];
  v_submission_ids uuid[];
  v_submission_id uuid;
  v_pending integer := 0;
  v_revision integer := 0;
  v_rejected integer := 0;
  v_remaining integer;
  v_orphans integer;
begin
  -- A/B. actor + role
  if v_actor is null or not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin/owner được đóng kỳ KPI.';
  end if;

  -- C/D. lock + validate period before any mutation
  select * into v_old from public.kpi_periods where id = p_period_id for update;
  if v_old.id is null then
    raise exception using errcode = 'P0002', message = 'Không tìm thấy kỳ KPI.';
  end if;
  if v_old.status <> 'ACTIVE' then
    raise exception using errcode = '55000',
      message = 'KPI_PERIOD_NOT_ACTIVE: Chỉ kỳ ACTIVE mới có thể đóng (trạng thái hiện tại: ' || v_old.status || ').';
  end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Kỳ KPI đã thay đổi. Hãy tải lại.';
  end if;

  -- E. canonical open set, locked in id order
  select coalesce(array_agg(event_id order by event_id), array[]::uuid[]),
         count(*) filter (where open_state = 'PENDING'),
         count(*) filter (where open_state = 'NEEDS_REVISION')
    into v_ids, v_pending, v_revision
  from public.crm_kpi_period_open_event_ids(p_period_id);
  perform 1 from public.kpi_submission_events where id = any(v_ids) order by id for update;

  -- F/G. auto-reject; evidence rows and storage objects are not touched
  perform set_config('crm.kpi_write', 'on', true);
  for v_prev in
    select * from public.kpi_submission_events where id = any(v_ids) order by id
  loop
    update public.kpi_submission_events
    set status = 'REJECTED',
        approved_value = null,
        review_reason_code = 'PERIOD_CLOSED',
        reviewed_by_user_id = v_actor,
        reviewed_at = now(),
        updated_at = now(),
        lock_version = lock_version + 1
    where id = v_prev.id
      and (status = 'PENDING'
           or (status = 'NEEDS_REVISION'
               and not exists (select 1 from public.kpi_submission_events r
                               where r.supersedes_event_id = v_prev.id)))
    returning * into v_event;
    if not found then
      raise exception using errcode = '40001', message = 'KPI_CLOSE_EVENT_CHANGED: Mục KPI đã thay đổi trong lúc đóng kỳ. Hãy thử lại.';
    end if;
    v_rejected := v_rejected + 1;

    perform public.crm_kpi_write_audit(
      'event_auto_reject', 'kpi_submission_events', v_event.id::text,
      jsonb_build_object(
        'periodId', p_period_id,
        'assignmentId', v_event.assignment_id,
        'submissionId', v_event.submission_id,
        'eventId', v_event.id,
        'employeeId', v_event.actor_user_id,
        'decision', 'REJECTED',
        'reason', 'PERIOD_CLOSED',
        'autoRejected', true,
        'closedByUserId', v_actor,
        'previousStatus', v_prev.status,
        'newStatus', v_event.status,
        'previousLockVersion', v_prev.lock_version,
        'newLockVersion', v_event.lock_version,
        'previousReasonCode', v_prev.review_reason_code,
        'previousReviewedByUserId', v_prev.reviewed_by_user_id,
        'previousReviewedAt', v_prev.reviewed_at,
        'sourceType', v_event.source_type,
        'sourceEventKey', v_event.source_event_key
      )
    );
  end loop;

  -- H. re-finalise submissions with the existing Manager-review semantics
  select coalesce(array_agg(distinct e.submission_id), array[]::uuid[]) into v_submission_ids
  from public.kpi_submission_events e where e.id = any(v_ids);
  foreach v_submission_id in array v_submission_ids loop
    perform public.crm_kpi_refresh_submission_status(v_submission_id);
  end loop;

  -- I. invariants: nothing open, no OPEN_REVIEW submission in the period
  select count(*) into v_remaining from public.crm_kpi_period_open_event_ids(p_period_id);
  if v_remaining <> 0 or v_rejected <> cardinality(v_ids) then
    raise exception using errcode = 'P0001', message = 'KPI_CLOSE_INVARIANT: Kỳ vẫn còn mục chưa xử lý; không đóng kỳ.';
  end if;
  select count(*) into v_orphans
  from public.kpi_submissions s join public.kpi_assignments a on a.id = s.assignment_id
  where a.period_id = p_period_id and s.status = 'OPEN_REVIEW';
  if v_orphans <> 0 then
    raise exception using errcode = 'P0001', message = 'KPI_CLOSE_INVARIANT: Còn submission OPEN_REVIEW; không đóng kỳ.';
  end if;

  -- J/K. ACTIVE -> CLOSED
  update public.kpi_periods
  set status = 'CLOSED',
      closed_at = now(),
      closed_by_user_id = v_actor,
      updated_at = now(),
      version = version + 1
  where id = p_period_id
  returning * into v_new;

  -- L. lifecycle audit
  perform public.crm_kpi_write_audit(
    'period_close', 'kpi_periods', p_period_id::text,
    jsonb_build_object(
      'periodId', p_period_id,
      'oldStatus', v_old.status,
      'newStatus', v_new.status,
      'versionBefore', v_old.version,
      'versionAfter', v_new.version,
      'autoRejectedTotal', v_rejected,
      'pendingCount', v_pending,
      'needsRevisionCount', v_revision,
      'autoRejectedEventIds', to_jsonb(v_ids),
      'submissionsRefreshed', cardinality(v_submission_ids),
      'reason', 'PERIOD_CLOSED',
      'before', to_jsonb(v_old),
      'after', to_jsonb(v_new)
    )
  );

  -- M. structured result (no customer data)
  return to_jsonb(v_new) || jsonb_build_object(
    'closed', true,
    'periodId', p_period_id,
    'oldStatus', v_old.status,
    'newStatus', v_new.status,
    'previousVersion', v_old.version,
    'newVersion', v_new.version,
    'autoRejectedTotal', v_rejected,
    'pendingRejected', v_pending,
    'revisionRejected', v_revision
  );
end;
$$;
revoke all on function public.crm_kpi_close_period_foundation(uuid, integer) from public, anon;
grant execute on function public.crm_kpi_close_period_foundation(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Cancel: unchanged contract + open-item guard (no auto-reject).
-- ---------------------------------------------------------------------
create or replace function public.crm_kpi_cancel_active_period(p_period_id uuid, p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := public.crm_current_app_user_id();
  v_old public.kpi_periods%rowtype;
  v_new public.kpi_periods%rowtype;
  v_dependencies jsonb;
  v_reason text := public.crm_kpi_r3_reason(p_reason);
  v_pending integer;
  v_revision integer;
begin
  if not public.crm_kpi_is_admin_owner() then
    raise exception using errcode='42501', message='Chỉ Owner/Admin được hủy toàn bộ kỳ KPI đã có dữ liệu.';
  end if;
  select * into v_old from public.kpi_periods where id=p_period_id for update;
  if v_old.id is null then raise exception using errcode='P0002', message='Không tìm thấy kỳ KPI.'; end if;
  if v_old.status <> 'ACTIVE' then raise exception using errcode='55000', message='Chỉ kỳ ACTIVE được hủy.'; end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception using errcode='P0001', message='KPI_VERSION_CONFLICT: Kỳ KPI đã thay đổi. Hãy tải lại.';
  end if;
  v_dependencies := public.crm_kpi_period_runtime_dependencies(p_period_id);
  if (v_dependencies->>'runtimeTotal')::bigint = 0 then
    raise exception using errcode='55000', message='Kỳ chưa có dữ liệu thực hiện. Hãy đưa kỳ về DRAFT thay vì hủy.';
  end if;
  select count(*) filter (where open_state = 'PENDING'),
         count(*) filter (where open_state = 'NEEDS_REVISION')
    into v_pending, v_revision
  from public.crm_kpi_period_open_event_ids(p_period_id);
  if v_pending + v_revision > 0 then
    raise exception using errcode='P0001',
      message = format('KPI_PERIOD_OPEN_ITEMS: Kỳ KPI còn %s mục chưa xử lý (%s chờ duyệt, %s cần bổ sung). Hãy xử lý hết hoặc đóng kỳ thay vì hủy.',
                       v_pending + v_revision, v_pending, v_revision),
      detail = jsonb_build_object('code','KPI_PERIOD_OPEN_ITEMS','pendingCount',v_pending,
                                  'needsRevisionCount',v_revision,'openTotal',v_pending + v_revision)::text;
  end if;
  perform set_config('crm.kpi_write','on',true);
  update public.kpi_periods set status='CANCELLED', cancelled_by_user_id=v_actor,
    cancelled_at=now(), cancel_reason=v_reason, updated_at=now(), version=version+1
    where id=p_period_id returning * into v_new;
  perform public.crm_kpi_write_audit('PERIOD_CANCELLED','kpi_periods',p_period_id::text,
    jsonb_build_object('periodId',p_period_id,'oldStatus','ACTIVE','newStatus','CANCELLED',
      'versionBefore',v_old.version,'versionAfter',v_new.version,'reason',v_reason,
      'dependencyCounts',v_dependencies,'openItemCounts',
      jsonb_build_object('pendingCount',0,'needsRevisionCount',0,'openTotal',0),
      'before',to_jsonb(v_old),'after',to_jsonb(v_new)));
  return to_jsonb(v_new) || jsonb_build_object('dependencyCounts',v_dependencies);
end;
$$;
revoke all on function public.crm_kpi_cancel_active_period(uuid, integer, text) from public, anon;
grant execute on function public.crm_kpi_cancel_active_period(uuid, integer, text) to authenticated, service_role;

-- crm_kpi_reopen_period is intentionally NOT replaced: it only flips the
-- period CLOSED -> ACTIVE and never touches events, so PERIOD_CLOSED
-- rejections stay terminal after Reopen.

do $$ begin raise notice 'KPI_7C_A_MIGRATION_APPLIED'; end $$;

commit;
