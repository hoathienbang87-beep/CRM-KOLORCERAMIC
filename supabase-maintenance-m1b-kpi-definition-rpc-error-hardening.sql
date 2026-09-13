-- KPI maintenance M1B: narrow definition-update parsing errors.
--
-- Scope:
--   * preserve KPI update semantics, authorization, audit, grants and snapshots
--   * give relation/numeric/boolean fields their own validation messages
--   * let unrelated invalid_text_representation errors retain their origin
--
-- This is a forward-only maintenance artifact. Applying it to production is a
-- separate, explicitly approved operation.

begin;

do $$
declare
  v_definition text;
begin
  if to_regprocedure('public.crm_kpi_update_definition_v2(uuid,integer,jsonb)') is null then
    raise exception using
      errcode = '55000',
      message = 'M1B_PRECONDITION: crm_kpi_update_definition_v2 is missing.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'kpi_definitions'
      and column_name = 'customer_relation_mode'
  ) then
    raise exception using
      errcode = '55000',
      message = 'M1B_PRECONDITION: customer_relation_mode is missing.';
  end if;

  select pg_get_functiondef(
    'public.crm_kpi_update_definition_v2(uuid,integer,jsonb)'::regprocedure
  ) into v_definition;

  if position('Invalid KPI numeric or boolean option.' in v_definition) = 0
     or position('customerRelationMode' in v_definition) = 0 then
    raise exception using
      errcode = '55000',
      message = 'M1B_PRECONDITION: definition RPC drifted from the audited implementation.';
  end if;
end;
$$;

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
  v_evidence_required boolean;
  v_location_required boolean;
  v_timestamp_required boolean;
  v_customer_mode text;
begin
  if not public.crm_kpi_is_business_manager() then
    raise exception using errcode = '42501', message = 'Only manager/admin/owner can update KPI definitions.';
  end if;
  if coalesce(jsonb_typeof(p_changes), '') <> 'object' then
    raise exception using errcode = '22023', message = 'KPI changes must be a JSON object.';
  end if;

  select * into v_old from public.kpi_definitions
  where id = p_definition_id for update;
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
  v_customer_mode := case
    when p_changes ? 'customerRelationMode' then upper(btrim(p_changes->>'customerRelationMode'))
    when p_changes ? 'customer_relation_mode' then upper(btrim(p_changes->>'customer_relation_mode'))
    else v_old.customer_relation_mode
  end;

  if p_changes ? 'maxImagesPerEvent' then
    begin
      v_max_images := (p_changes->>'maxImagesPerEvent')::integer;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception using
          errcode = '22023',
          message = 'Invalid KPI numeric option: maxImagesPerEvent.';
    end;
  else
    v_max_images := v_old.max_images_per_event;
  end if;

  if p_changes ? 'evidenceRequired' then
    begin
      v_evidence_required := coalesce((p_changes->>'evidenceRequired')::boolean, false);
    exception when invalid_text_representation then
      raise exception using
        errcode = '22023',
        message = 'Invalid KPI boolean option: evidenceRequired.';
    end;
  else
    v_evidence_required := v_old.evidence_required;
  end if;

  if p_changes ? 'locationRequired' then
    begin
      v_location_required := coalesce((p_changes->>'locationRequired')::boolean, false);
    exception when invalid_text_representation then
      raise exception using
        errcode = '22023',
        message = 'Invalid KPI boolean option: locationRequired.';
    end;
  else
    v_location_required := v_old.location_required;
  end if;

  if p_changes ? 'timestampRequired' then
    begin
      v_timestamp_required := coalesce((p_changes->>'timestampRequired')::boolean, true);
    exception when invalid_text_representation then
      raise exception using
        errcode = '22023',
        message = 'Invalid KPI boolean option: timestampRequired.';
    end;
  else
    v_timestamp_required := v_old.timestamp_required;
  end if;

  if v_name is null or v_unit is null then
    raise exception using errcode = '22023', message = 'KPI name and unit are required.';
  end if;
  if v_type not in ('AUTO', 'MANUAL', 'HYBRID')
     or v_mode <> 'EVENT_CLAIM'
     or v_aggregation not in ('COUNT', 'SUM') then
    raise exception using errcode = '22023', message = 'Invalid KPI configuration.';
  end if;
  if v_customer_mode is null
     or v_customer_mode not in ('REQUIRED', 'OPTIONAL', 'NONE') then
    raise exception using errcode = '22023', message = 'Invalid customer relation mode.';
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
      evidence_required = v_evidence_required,
      aggregation_mode = v_aggregation,
      max_images_per_event = v_max_images,
      location_required = v_location_required,
      timestamp_required = v_timestamp_required,
      customer_relation_mode = v_customer_mode,
      updated_by_user_id = public.crm_current_app_user_id(),
      updated_at = now(),
      version = version + 1
  where id = p_definition_id
  returning * into v_new;

  perform public.crm_kpi_write_audit(
    'definition_update', 'kpi_definitions', p_definition_id::text,
    jsonb_build_object('definitionId', p_definition_id, 'before', to_jsonb(v_old),
      'after', to_jsonb(v_new), 'phase', 'KPI-2-CUSTOMER')
  );
  return to_jsonb(v_new);
end;
$$;

revoke all on function public.crm_kpi_update_definition_v2(uuid, integer, jsonb)
  from public, anon;
grant execute on function public.crm_kpi_update_definition_v2(uuid, integer, jsonb)
  to authenticated;

commit;
