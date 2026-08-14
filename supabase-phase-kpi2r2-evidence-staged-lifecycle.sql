-- KPI-2R.2: canonical STAGED evidence discard lifecycle.
-- Additive forward-fix for databases where KPI-2 is already live.
-- Do not rerun the KPI-2 consolidated migration before this file.

begin;

alter table public.kpi_evidence
  add column if not exists discard_requested_at timestamptz,
  add column if not exists discarded_at timestamptz,
  add column if not exists discard_requested_by_user_id text references public.app_users(id) on delete restrict;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.kpi_evidence'::regclass
      and conname = 'kpi_evidence_discard_shape_check'
  ) then
    alter table public.kpi_evidence
      add constraint kpi_evidence_discard_shape_check check (
        discard_requested_at is null
        or (
          status = 'ARCHIVED'
          and event_id is null
          and attached_at is null
          and discard_requested_by_user_id is not null
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.kpi_evidence'::regclass
      and conname = 'kpi_evidence_discard_complete_check'
  ) then
    alter table public.kpi_evidence
      add constraint kpi_evidence_discard_complete_check check (
        discarded_at is null
        or (status = 'ARCHIVED' and discard_requested_at is not null)
      );
  end if;
end;
$$;

create index if not exists kpi_evidence_discard_pending_idx
  on public.kpi_evidence(uploaded_by_user_id, discard_requested_at)
  where status = 'ARCHIVED' and discarded_at is null;

create or replace function public.crm_kpi_request_discard_staged_evidence(
  p_evidence_id uuid,
  p_request_id uuid,
  p_expected_lock_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_actor text := public.crm_current_app_user_id();
  v_actor_row public.app_users%rowtype;
  v_evidence public.kpi_evidence%rowtype;
  v_payload_hash text;
  v_response jsonb;
  v_object_present boolean;
begin
  if auth.uid() is null or v_actor is null or p_evidence_id is null or p_request_id is null
     or coalesce(p_expected_lock_version, 0) < 1 then
    raise exception using errcode = '42501', message = 'Yeu cau huy minh chung khong hop le.';
  end if;

  select * into v_actor_row
  from public.app_users
  where id = v_actor
    and supabase_auth_id = auth.uid()
    and coalesce(active, false) = true
    and lower(coalesce(lifecycle_status, 'active')) = 'active';

  if v_actor_row.id is null or lower(coalesce(v_actor_row.role, '')) <> 'sale' then
    raise exception using errcode = '42501', message = 'Chi Sale dang hoat dong duoc huy anh STAGED cua minh.';
  end if;

  v_payload_hash := public.crm_kpi_payload_hash(jsonb_build_object(
    'action', 'DISCARD_STAGED_EVIDENCE_REQUEST',
    'schemaVersion', 1,
    'evidenceId', p_evidence_id,
    'expectedLockVersion', p_expected_lock_version
  ));

  perform pg_advisory_xact_lock(hashtextextended(
    'crm:kpi:action:' || v_actor || ':DISCARD_STAGED_EVIDENCE_REQUEST:' || p_request_id::text,
    0
  ));
  v_response := public.crm_kpi_idempotent_response(
    v_actor, 'DISCARD_STAGED_EVIDENCE_REQUEST', p_request_id, v_payload_hash
  );
  if v_response is not null then return v_response; end if;

  select * into v_evidence
  from public.kpi_evidence
  where id = p_evidence_id
  for update;

  if v_evidence.id is null or v_evidence.uploaded_by_user_id <> v_actor then
    raise exception using errcode = '42501', message = 'Khong the huy minh chung nay.';
  end if;
  if v_evidence.status <> 'STAGED' or v_evidence.event_id is not null or v_evidence.attached_at is not null then
    raise exception using errcode = '55000', message = 'KPI_EVIDENCE_NOT_DISCARDABLE: Chi anh STAGED chua gan event moi duoc huy.';
  end if;
  if v_evidence.lock_version <> p_expected_lock_version then
    raise exception using errcode = 'P0001', message = 'KPI_EVIDENCE_VERSION_CONFLICT: Anh da thay doi, vui long tai lai.';
  end if;
  if v_evidence.bucket <> 'kpi2-evidence'
     or v_evidence.object_path not like 'kpi2/' || v_actor || '/' || v_evidence.id::text || '/%' then
    raise exception using errcode = '22023', message = 'KPI_EVIDENCE_CANONICAL_PATH_INVALID: Duong dan anh khong hop le.';
  end if;

  select exists(
    select 1 from storage.objects
    where bucket_id = v_evidence.bucket and name = v_evidence.object_path
  ) into v_object_present;

  perform set_config('crm.kpi_write', 'on', true);
  update public.kpi_evidence
  set status = 'ARCHIVED',
      discard_requested_at = now(),
      discard_requested_by_user_id = v_actor,
      updated_at = now(),
      lock_version = lock_version + 1
  where id = v_evidence.id
  returning * into v_evidence;

  v_response := jsonb_build_object(
    'evidenceId', v_evidence.id,
    'status', v_evidence.status,
    'objectPath', v_evidence.object_path,
    'lockVersion', v_evidence.lock_version,
    'objectPresent', v_object_present,
    'storageDeleteRequired', v_object_present,
    'discarded', false
  );

  insert into public.kpi_action_requests(
    actor_user_id, action, request_id, request_payload_hash, request_schema_version, response
  ) values(
    v_actor, 'DISCARD_STAGED_EVIDENCE_REQUEST', p_request_id, v_payload_hash, 1, v_response
  );

  perform public.crm_kpi_write_audit(
    'evidence_discard_requested', 'kpi_evidence', v_evidence.id::text,
    jsonb_build_object(
      'evidenceId', v_evidence.id,
      'previousStatus', 'STAGED',
      'newStatus', 'ARCHIVED',
      'objectPresent', v_object_present,
      'previousLockVersion', p_expected_lock_version,
      'newLockVersion', v_evidence.lock_version,
      'reason', 'user_cancel'
    )
  );

  return v_response;
end;
$$;

create or replace function public.crm_kpi_finalize_discard_staged_evidence(
  p_evidence_id uuid,
  p_request_id uuid,
  p_expected_lock_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_actor text := public.crm_current_app_user_id();
  v_actor_row public.app_users%rowtype;
  v_evidence public.kpi_evidence%rowtype;
  v_payload_hash text;
  v_response jsonb;
begin
  if auth.uid() is null or v_actor is null or p_evidence_id is null or p_request_id is null
     or coalesce(p_expected_lock_version, 0) < 1 then
    raise exception using errcode = '42501', message = 'Yeu cau hoan tat huy minh chung khong hop le.';
  end if;

  select * into v_actor_row
  from public.app_users
  where id = v_actor
    and supabase_auth_id = auth.uid()
    and coalesce(active, false) = true
    and lower(coalesce(lifecycle_status, 'active')) = 'active';

  if v_actor_row.id is null or lower(coalesce(v_actor_row.role, '')) <> 'sale' then
    raise exception using errcode = '42501', message = 'Chi Sale dang hoat dong duoc hoan tat huy anh cua minh.';
  end if;

  v_payload_hash := public.crm_kpi_payload_hash(jsonb_build_object(
    'action', 'DISCARD_STAGED_EVIDENCE_FINALIZE',
    'schemaVersion', 1,
    'evidenceId', p_evidence_id,
    'expectedLockVersion', p_expected_lock_version
  ));

  perform pg_advisory_xact_lock(hashtextextended(
    'crm:kpi:action:' || v_actor || ':DISCARD_STAGED_EVIDENCE_FINALIZE:' || p_request_id::text,
    0
  ));
  v_response := public.crm_kpi_idempotent_response(
    v_actor, 'DISCARD_STAGED_EVIDENCE_FINALIZE', p_request_id, v_payload_hash
  );
  if v_response is not null then return v_response; end if;

  select * into v_evidence
  from public.kpi_evidence
  where id = p_evidence_id
  for update;

  if v_evidence.id is null or v_evidence.uploaded_by_user_id <> v_actor then
    raise exception using errcode = '42501', message = 'Khong the hoan tat huy minh chung nay.';
  end if;
  if v_evidence.status <> 'ARCHIVED' or v_evidence.discard_requested_at is null
     or v_evidence.discard_requested_by_user_id <> v_actor
     or v_evidence.event_id is not null or v_evidence.attached_at is not null then
    raise exception using errcode = '55000', message = 'KPI_EVIDENCE_DISCARD_NOT_REQUESTED: Anh chua o trang thai cho xoa.';
  end if;
  if v_evidence.lock_version <> p_expected_lock_version then
    raise exception using errcode = 'P0001', message = 'KPI_EVIDENCE_VERSION_CONFLICT: Anh da thay doi, vui long tai lai.';
  end if;
  if exists(
    select 1 from storage.objects
    where bucket_id = v_evidence.bucket and name = v_evidence.object_path
  ) then
    raise exception using errcode = '55000', message = 'KPI_EVIDENCE_STORAGE_OBJECT_PRESENT: File van con, hay thu xoa lai.';
  end if;

  perform set_config('crm.kpi_write', 'on', true);
  update public.kpi_evidence
  set discarded_at = coalesce(discarded_at, now()),
      updated_at = now(),
      lock_version = lock_version + 1
  where id = v_evidence.id
  returning * into v_evidence;

  v_response := jsonb_build_object(
    'evidenceId', v_evidence.id,
    'status', 'DISCARDED',
    'lockVersion', v_evidence.lock_version,
    'objectPresent', false,
    'storageDeleteRequired', false,
    'discarded', true,
    'discardedAt', v_evidence.discarded_at,
    'metadataDeleted', true
  );

  insert into public.kpi_action_requests(
    actor_user_id, action, request_id, request_payload_hash, request_schema_version, response
  ) values(
    v_actor, 'DISCARD_STAGED_EVIDENCE_FINALIZE', p_request_id, v_payload_hash, 1, v_response
  );

  perform public.crm_kpi_write_audit(
    'evidence_discarded', 'kpi_evidence', v_evidence.id::text,
    jsonb_build_object(
      'evidenceId', v_evidence.id,
      'previousStatus', 'ARCHIVED',
      'newStatus', 'DISCARDED',
      'objectPresent', false,
      'newLockVersion', v_evidence.lock_version,
      'reason', 'user_cancel'
    )
  );

  -- Metadata is retained while Storage deletion is pending. It is removed only
  -- after the object is confirmed absent; immutable audit/idempotency remain.
  delete from public.kpi_evidence where id = v_evidence.id;

  return v_response;
end;
$$;

revoke all on function public.crm_kpi_request_discard_staged_evidence(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.crm_kpi_finalize_discard_staged_evidence(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.crm_kpi_request_discard_staged_evidence(uuid, uuid, integer)
  to authenticated;
grant execute on function public.crm_kpi_finalize_discard_staged_evidence(uuid, uuid, integer)
  to authenticated;

drop policy if exists "kpi2 evidence canonical select" on storage.objects;
create policy "kpi2 evidence canonical select" on storage.objects for select to authenticated
using (
  bucket_id = 'kpi2-evidence'
  and exists (
    select 1 from public.kpi_evidence e
    where e.bucket = bucket_id
      and e.object_path = name
      and (
        (
          e.status in ('STAGED', 'ATTACHED')
          and (
            e.uploaded_by_user_id = public.crm_current_app_user_id()
            or public.crm_kpi_is_business_manager()
          )
        )
        or (
          e.status = 'ARCHIVED'
          and e.discard_requested_at is not null
          and e.discarded_at is null
          and e.event_id is null
          and e.attached_at is null
          and e.uploaded_by_user_id = public.crm_current_app_user_id()
          and e.discard_requested_by_user_id = public.crm_current_app_user_id()
          and storage.allow_any_operation(array[
            'object.delete',
            'object.delete_many'
          ])
        )
      )
  )
);

drop policy if exists "kpi2 evidence staged owner delete" on storage.objects;
create policy "kpi2 evidence staged owner delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'kpi2-evidence'
  and exists (
    select 1 from public.kpi_evidence e
    where e.bucket = bucket_id
      and e.object_path = name
      and e.status = 'ARCHIVED'
      and e.discard_requested_at is not null
      and e.discarded_at is null
      and e.event_id is null
      and e.attached_at is null
      and e.uploaded_by_user_id = public.crm_current_app_user_id()
      and e.discard_requested_by_user_id = public.crm_current_app_user_id()
      and e.object_path like 'kpi2/' || public.crm_current_app_user_id() || '/' || e.id::text || '/%'
  )
);

commit;
