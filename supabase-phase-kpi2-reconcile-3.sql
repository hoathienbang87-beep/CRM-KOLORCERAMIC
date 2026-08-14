-- STAGING DEVELOPMENT / SUPERSEDED FOR PRODUCTION.
-- Production source of truth: supabase-phase-kpi2-final-consolidated.sql.
-- KPI-2 staging reconciliation 3.
-- Adds a versioned definition update RPC for KPI-2 extension fields.
-- Dependency: KPI-1 foundation and KPI-2 submission/review migration.

begin;

create or replace function public.crm_kpi_update_definition_v2(
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
  v_aggregation text;
  v_max_images integer;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Only manager/admin/owner can update KPI definitions.';
  end if;
  if coalesce(jsonb_typeof(p_changes), '') <> 'object' then
    raise exception using errcode = '22023', message = 'KPI changes must be a JSON object.';
  end if;

  select * into v_old
  from public.kpi_definitions
  where id = p_definition_id
  for update;

  if v_old.id is null then
    raise exception using errcode = 'P0002', message = 'KPI definition not found.';
  end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'KPI_VERSION_CONFLICT: Definition changed. Reload and retry.';
  end if;
  if p_changes ? 'code' and upper(btrim(p_changes->>'code')) <> v_old.code then
    raise exception using errcode = '55000', message = 'KPI code cannot be changed after creation.';
  end if;

  v_name := case when p_changes ? 'name' then nullif(btrim(p_changes->>'name'), '') else v_old.name end;
  v_type := case when p_changes ? 'kpiType' then upper(btrim(p_changes->>'kpiType')) else v_old.kpi_type end;
  v_unit := case when p_changes ? 'unit' then nullif(btrim(p_changes->>'unit'), '') else v_old.unit end;
  v_mode := case when p_changes ? 'submissionMode' then upper(btrim(p_changes->>'submissionMode')) else v_old.submission_mode end;
  v_aggregation := case when p_changes ? 'aggregationMode' then upper(btrim(p_changes->>'aggregationMode')) else v_old.aggregation_mode end;
  v_max_images := case when p_changes ? 'maxImagesPerEvent' then (p_changes->>'maxImagesPerEvent')::integer else v_old.max_images_per_event end;

  if v_name is null or v_unit is null then
    raise exception using errcode = '22023', message = 'KPI name and unit are required.';
  end if;
  if v_type not in ('AUTO', 'MANUAL', 'HYBRID') then
    raise exception using errcode = '22023', message = 'Invalid KPI type.';
  end if;
  if v_mode <> 'EVENT_CLAIM' then
    raise exception using errcode = '22023', message = 'KPI-2 supports EVENT_CLAIM submission mode.';
  end if;
  if v_aggregation not in ('COUNT', 'SUM') then
    raise exception using errcode = '22023', message = 'Aggregation must be COUNT or SUM.';
  end if;
  if v_max_images not between 0 and 2 then
    raise exception using errcode = '22023', message = 'Maximum images per event must be between 0 and 2.';
  end if;

  perform set_config('crm.kpi_write', 'on', true);
  update public.kpi_definitions
  set name = v_name,
      description = case when p_changes ? 'description' then nullif(btrim(p_changes->>'description'), '') else description end,
      kpi_type = v_type,
      source_metric_key = case when p_changes ? 'sourceMetricKey' then nullif(btrim(p_changes->>'sourceMetricKey'), '') else source_metric_key end,
      unit = v_unit,
      submission_mode = v_mode,
      evidence_required = case when p_changes ? 'evidenceRequired' then coalesce((p_changes->>'evidenceRequired')::boolean, false) else evidence_required end,
      aggregation_mode = v_aggregation,
      max_images_per_event = v_max_images,
      location_required = case when p_changes ? 'locationRequired' then coalesce((p_changes->>'locationRequired')::boolean, false) else location_required end,
      timestamp_required = case when p_changes ? 'timestampRequired' then coalesce((p_changes->>'timestampRequired')::boolean, true) else timestamp_required end,
      updated_by_user_id = public.crm_current_app_user_id(),
      updated_at = now(),
      version = version + 1
  where id = p_definition_id
  returning * into v_new;

  perform public.crm_kpi_write_audit(
    'definition_update',
    'kpi_definitions',
    p_definition_id::text,
    jsonb_build_object(
      'definitionId', p_definition_id,
      'before', to_jsonb(v_old),
      'after', to_jsonb(v_new),
      'phase', 'KPI-2'
    )
  );
  return to_jsonb(v_new);
exception
  when invalid_text_representation then
    raise exception using errcode = '22023', message = 'Invalid KPI numeric or boolean option.';
end;
$$;

revoke all on function public.crm_kpi_update_definition_v2(uuid, integer, jsonb)
  from public, anon;
grant execute on function public.crm_kpi_update_definition_v2(uuid, integer, jsonb)
  to authenticated;

commit;
