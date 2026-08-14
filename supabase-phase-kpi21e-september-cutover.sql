-- KPI-2.1E - September canonical cutover and legacy KPI write freeze.
-- Dependency: P0-A legacy KPI RPCs and KPI-2 canonical foundation are already deployed.
-- This migration does not mutate historical rows or create canonical business configuration.

begin;

create or replace function public.crm_legacy_kpi_cutover_at()
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select timestamptz '2026-09-01 00:00:00+07:00';
$$;

create or replace function public.crm_legacy_kpi_clock_now()
returns timestamptz
language sql
volatile
set search_path = public
as $$
  select clock_timestamp();
$$;

create or replace function public.crm_legacy_kpi_is_pre_cutover(p_at timestamptz)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_at < public.crm_legacy_kpi_cutover_at();
$$;

create or replace function public.crm_legacy_kpi_write_window_open()
returns boolean
language sql
security definer
volatile
set search_path = public
as $$
  select public.crm_legacy_kpi_is_pre_cutover(public.crm_legacy_kpi_clock_now());
$$;

create or replace function public.crm_legacy_kpi_closeout_allowed(
  p_created_at timestamptz,
  p_status text,
  p_is_deleted boolean
)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_created_at is not null
    and p_created_at < public.crm_legacy_kpi_cutover_at()
    and lower(coalesce(p_status, 'pending')) = 'pending'
    and not coalesce(p_is_deleted, false);
$$;

create or replace function public.crm_legacy_kpi_cutover_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := public.crm_current_email();
  v_now timestamptz := public.crm_legacy_kpi_clock_now();
  v_pending bigint := 0;
begin
  if not public.crm_is_active_user() then
    raise exception using errcode = '42501', message = 'Tài khoản CRM không hoạt động.';
  end if;

  select count(*) into v_pending
  from public.kpi_proposals p
  where public.crm_legacy_kpi_closeout_allowed(p.created_at, p.status, p.is_deleted)
    and (
      public.crm_is_manager()
      or lower(coalesce(p.owner_email, p.email, p.created_by_email, '')) = lower(v_actor)
    );

  return jsonb_build_object(
    'serverNow', v_now,
    'cutoverAt', public.crm_legacy_kpi_cutover_at(),
    'preCutover', public.crm_legacy_kpi_is_pre_cutover(v_now),
    'legacyPendingCount', v_pending
  );
end;
$$;

create or replace function public.crm_legacy_kpi_evidence_upload_allowed(p_object_name text)
returns boolean
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_actor text := public.crm_current_email();
  v_folders text[] := storage.foldername(p_object_name);
  v_owner_folder text;
  v_proposal_id text;
  v_owner_compact text;
  v_owner_legacy text;
begin
  if not public.crm_is_active_user() then return false; end if;

  v_owner_folder := coalesce(v_folders[1], '');
  v_proposal_id := coalesce(v_folders[3], '');
  v_owner_compact := regexp_replace(lower(v_actor), '[^a-z0-9]+', '', 'g');
  v_owner_legacy := regexp_replace(lower(v_actor), '[^a-z0-9._-]+', '-', 'g');

  if v_owner_folder not in (v_owner_compact, v_owner_legacy) then return false; end if;
  if public.crm_legacy_kpi_write_window_open() then return true; end if;
  if v_proposal_id = '' then return false; end if;

  return exists (
    select 1
    from public.kpi_proposals p
    where p.id = v_proposal_id
      and lower(coalesce(p.owner_email, p.email, p.created_by_email, '')) = lower(v_actor)
      and public.crm_legacy_kpi_closeout_allowed(p.created_at, p.status, p.is_deleted)
  );
end;
$$;

create or replace function public.crm_submit_kpi_proposal(
  p_proposal_id text,
  p_proposal jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := public.crm_current_email();
  v_id text := coalesce(nullif(p_proposal_id, ''), gen_random_uuid()::text);
  v_rule public.kpi_rules%rowtype;
  v_old public.kpi_proposals%rowtype;
  v_is_update boolean := false;
  v_raw jsonb;
begin
  if not public.crm_is_active_user() then
    raise exception using errcode = '42501', message = 'Tài khoản CRM không hoạt động.';
  end if;

  select * into v_old from public.kpi_proposals where id = v_id for update;
  v_is_update := v_old.id is not null;

  if not v_is_update and not public.crm_legacy_kpi_write_window_open() then
    raise exception using errcode = '55000', message = 'KPI cũ đã ngừng nhận đề xuất mới từ 01/09/2026. Hãy sử dụng KPI hiện tại.';
  end if;

  if v_is_update and (
    lower(coalesce(v_old.owner_email, v_old.email, v_old.created_by_email, '')) <> lower(v_actor)
    or lower(coalesce(v_old.status, 'pending')) <> 'pending'
    or coalesce(v_old.is_deleted, false)
  ) then
    raise exception using errcode = '42501', message = 'Chỉ được sửa đề xuất pending của chính bạn.';
  end if;

  if v_is_update
     and not public.crm_legacy_kpi_write_window_open()
     and not public.crm_legacy_kpi_closeout_allowed(v_old.created_at, v_old.status, v_old.is_deleted) then
    raise exception using errcode = '55000', message = 'Chỉ đề xuất KPI cũ pending được tạo trước 01/09/2026 mới được đóng sổ.';
  end if;

  select * into v_rule
  from public.kpi_rules
  where id = p_proposal->>'kpiRuleId' and coalesce(active, true) = true;
  if v_rule.id is null then
    raise exception using errcode = '22023', message = 'KPI không tồn tại hoặc đang tắt.';
  end if;
  if jsonb_array_length(coalesce(v_rule.assigned_owners, '[]'::jsonb)) > 0
     and not exists (
       select 1 from jsonb_array_elements_text(v_rule.assigned_owners) x where lower(x) = lower(v_actor)
     ) then
    raise exception using errcode = '42501', message = 'KPI này chưa được gán cho bạn.';
  end if;
  if nullif(trim(coalesce(p_proposal->>'content', '')), '') is null then
    raise exception using errcode = '22023', message = 'Nội dung công việc KPI là bắt buộc.';
  end if;

  v_raw := coalesce(v_old.raw_data, '{}'::jsonb) || coalesce(p_proposal, '{}'::jsonb)
    || jsonb_build_object('id', v_id, 'ownerEmail', v_actor, 'email', v_actor,
      'status', 'pending', 'isDeleted', false, 'updatedAt', now());

  insert into public.kpi_proposals(
    id, kpi_rule_id, kpi_name, month, owner, owner_email, email, phone, department,
    customer_id, customer_name, customer_phone, customer_company_name, customer_channel,
    content, evidence_url, status, is_deleted, created_by_email, raw_data, created_at, updated_at
  ) values (
    v_id, v_rule.id, v_rule.name, nullif(p_proposal->>'month', ''),
    coalesce(p_proposal->>'owner', v_actor), v_actor, v_actor,
    nullif(p_proposal->>'phone', ''), nullif(p_proposal->>'department', ''),
    nullif(p_proposal->>'customerId', ''), nullif(p_proposal->>'customerName', ''),
    nullif(p_proposal->>'customerPhone', ''), nullif(p_proposal->>'customerCompanyName', ''),
    nullif(p_proposal->>'customerChannel', ''), p_proposal->>'content',
    nullif(p_proposal->>'evidenceUrl', ''), 'pending', false, v_actor,
    v_raw || jsonb_build_object('createdAt', now(), 'createdByEmail', v_actor), now(), now()
  )
  on conflict (id) do update set
    content = excluded.content,
    evidence_url = excluded.evidence_url,
    phone = excluded.phone,
    department = excluded.department,
    customer_id = excluded.customer_id,
    customer_name = excluded.customer_name,
    customer_phone = excluded.customer_phone,
    customer_company_name = excluded.customer_company_name,
    customer_channel = excluded.customer_channel,
    raw_data = v_raw,
    updated_at = now();

  perform public.crm_write_audit(
    case when v_is_update then 'updateKpiProposal' else 'submitKpiProposal' end,
    'kpiProposals', v_id, jsonb_build_object('before', to_jsonb(v_old), 'after', p_proposal)
  );
  return jsonb_build_object('id', v_id, 'updated', v_is_update);
end;
$$;

create or replace function public.crm_review_kpi_proposal(
  p_proposal_id text,
  p_status text,
  p_review_note text default '',
  p_review_snapshot jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.kpi_proposals%rowtype;
  v_status text := lower(trim(p_status));
begin
  if not public.crm_is_manager() then
    raise exception using errcode = '42501', message = 'Chỉ manager/admin được duyệt KPI.';
  end if;
  if v_status not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'Trạng thái duyệt KPI không hợp lệ.';
  end if;
  select * into v_old from public.kpi_proposals where id = p_proposal_id for update;
  if v_old.id is null then
    raise exception using errcode = 'P0002', message = 'Không tìm thấy đề xuất KPI.';
  end if;
  if lower(coalesce(v_old.status, 'pending')) <> 'pending' or coalesce(v_old.is_deleted, false) then
    raise exception using errcode = '55000', message = 'Đề xuất KPI đã được xử lý.';
  end if;
  if not public.crm_legacy_kpi_write_window_open()
     and not public.crm_legacy_kpi_closeout_allowed(v_old.created_at, v_old.status, v_old.is_deleted) then
    raise exception using errcode = '55000', message = 'Chỉ proposal KPI cũ tạo trước 01/09/2026 mới được đóng sổ.';
  end if;

  update public.kpi_proposals set
    status = v_status,
    review_note = nullif(p_review_note, ''),
    reviewed_by_email = public.crm_current_email(),
    reviewed_at = now(),
    raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
      'status', v_status,
      'reviewNote', p_review_note,
      'reviewedByEmail', public.crm_current_email(),
      'reviewedAt', now(),
      'reviewedSnapshotJson', coalesce(p_review_snapshot, '{}'::jsonb)::text,
      'updatedAt', now()
    ),
    updated_at = now()
  where id = p_proposal_id;

  perform public.crm_write_audit(
    case when v_status = 'approved' then 'approveKpiProposal' else 'rejectKpiProposal' end,
    'kpiProposals', p_proposal_id,
    jsonb_build_object('before', to_jsonb(v_old), 'status', v_status, 'reviewNote', p_review_note)
  );
  return jsonb_build_object('id', p_proposal_id, 'status', v_status);
end;
$$;

create or replace function public.crm_archive_kpi_proposal(p_proposal_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.kpi_proposals%rowtype;
  v_actor text := public.crm_current_email();
  v_is_owner boolean;
begin
  select * into v_old from public.kpi_proposals where id = p_proposal_id for update;
  if v_old.id is null then
    raise exception using errcode = 'P0002', message = 'Không tìm thấy đề xuất KPI.';
  end if;
  v_is_owner := lower(coalesce(v_old.owner_email, v_old.email, v_old.created_by_email, '')) = lower(v_actor);
  if not public.crm_is_admin()
     and not (
       v_is_owner
       and lower(coalesce(v_old.status, 'pending')) = 'pending'
       and not coalesce(v_old.is_deleted, false)
     ) then
    raise exception using errcode = '42501', message = 'Chỉ được xóa đề xuất pending của chính bạn.';
  end if;
  if not public.crm_legacy_kpi_write_window_open()
     and not public.crm_legacy_kpi_closeout_allowed(v_old.created_at, v_old.status, v_old.is_deleted) then
    raise exception using errcode = '55000', message = 'Sau 01/09/2026 chỉ proposal KPI cũ pending mới được đóng sổ.';
  end if;

  update public.kpi_proposals set
    is_deleted = true,
    deleted_by_email = v_actor,
    deleted_at = now(),
    raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
      'isDeleted', true,
      'deletedByEmail', v_actor,
      'deletedAt', now(),
      'updatedByEmail', v_actor,
      'updatedAt', now()
    ),
    updated_at = now()
  where id = p_proposal_id;

  perform public.crm_write_audit(
    case when public.crm_is_admin() and not v_is_owner then 'softDeleteAdminKpiProposal' else 'softDeleteKpiProposal' end,
    'kpiProposals', p_proposal_id, to_jsonb(v_old)
  );
  return jsonb_build_object('id', p_proposal_id, 'archived', true);
end;
$$;

-- Legacy rules remain readable, but direct operational writes close at the server boundary.
drop policy if exists "kpi rules manager write" on public.kpi_rules;
drop policy if exists "kpi rules manager write before september cutover" on public.kpi_rules;
create policy "kpi rules manager write before september cutover"
on public.kpi_rules
for all
to authenticated
using (public.crm_is_manager() and public.crm_legacy_kpi_write_window_open())
with check (public.crm_is_manager() and public.crm_legacy_kpi_write_window_open());

-- All legacy proposal mutation goes through the guarded atomic RPCs.
drop policy if exists "kpi proposals scoped" on public.kpi_proposals;
drop policy if exists "kpi proposals owner or manager read" on public.kpi_proposals;
drop policy if exists "kpi proposals active users insert own pending" on public.kpi_proposals;
drop policy if exists "kpi proposals active users insert own" on public.kpi_proposals;
drop policy if exists "kpi proposals owner edit own pending" on public.kpi_proposals;
drop policy if exists "kpi proposals owner edit pending" on public.kpi_proposals;
drop policy if exists "kpi proposals manager review" on public.kpi_proposals;
drop policy if exists "kpi proposals manager update review" on public.kpi_proposals;
drop policy if exists "kpi proposals admin delete" on public.kpi_proposals;

create policy "kpi proposals owner or manager read"
on public.kpi_proposals
for select
to authenticated
using (
  public.crm_is_manager()
  or lower(coalesce(owner_email, email, created_by_email, '')) = public.crm_current_email()
);

revoke insert, update, delete, truncate, references, trigger on public.kpi_proposals from anon, authenticated;
grant select on public.kpi_proposals to authenticated;

-- Legacy evidence can continue only for an existing pre-cutover pending proposal.
drop policy if exists "kpi evidence authenticated insert own folder" on storage.objects;
drop policy if exists "kpi_evidence_authenticated_insert" on storage.objects;
drop policy if exists "kpi evidence cutover controlled insert" on storage.objects;
create policy "kpi evidence cutover controlled insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'kpi-evidence'
  and public.crm_legacy_kpi_evidence_upload_allowed(name)
);

revoke all on function public.crm_legacy_kpi_cutover_at() from public, anon;
revoke all on function public.crm_legacy_kpi_clock_now() from public, anon, authenticated;
revoke all on function public.crm_legacy_kpi_is_pre_cutover(timestamptz) from public, anon, authenticated;
revoke all on function public.crm_legacy_kpi_write_window_open() from public, anon;
revoke all on function public.crm_legacy_kpi_closeout_allowed(timestamptz, text, boolean) from public, anon, authenticated;
revoke all on function public.crm_legacy_kpi_cutover_status() from public, anon;
revoke all on function public.crm_legacy_kpi_evidence_upload_allowed(text) from public, anon;

grant execute on function public.crm_legacy_kpi_write_window_open() to authenticated;
grant execute on function public.crm_legacy_kpi_cutover_status() to authenticated;
grant execute on function public.crm_legacy_kpi_evidence_upload_allowed(text) to authenticated;

revoke all on function public.crm_submit_kpi_proposal(text, jsonb) from public, anon;
revoke all on function public.crm_review_kpi_proposal(text, text, text, jsonb) from public, anon;
revoke all on function public.crm_archive_kpi_proposal(text) from public, anon;
grant execute on function public.crm_submit_kpi_proposal(text, jsonb) to authenticated;
grant execute on function public.crm_review_kpi_proposal(text, text, text, jsonb) to authenticated;
grant execute on function public.crm_archive_kpi_proposal(text) to authenticated;

comment on function public.crm_legacy_kpi_cutover_at() is
  'Authoritative legacy KPI write cutoff: 2026-09-01 00:00 Asia/Ho_Chi_Minh.';
comment on function public.crm_legacy_kpi_clock_now() is
  'Trusted database clock for KPI-2.1E runtime guards; staging tests may replace temporarily and must restore this artifact.';

commit;
