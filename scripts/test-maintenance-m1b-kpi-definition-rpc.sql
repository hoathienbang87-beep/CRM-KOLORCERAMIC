-- Disposable local integration test for M1B.
-- Run after the standard local KPI-2 bootstrap and the M1B migration.

\set ON_ERROR_STOP on
begin;

-- Match production identity resolution only for this rolled-back test.
create or replace function public.crm_current_app_user_id()
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select u.id
  from public.app_users u
  where auth.uid() is not null
    and u.supabase_auth_id = auth.uid()
    and coalesce(u.active, false) = true
    and lower(coalesce(u.lifecycle_status, 'inactive')) = 'active'
  limit 1;
$fn$;

select set_config('crm.kpi_write', 'on', true);
insert into public.app_users(id,email,name,role,active,lifecycle_status,supabase_auth_id)
values ('m1b-manager','m1b-manager@example.invalid','M1B Manager','manager',true,'active',
        '11111111-1111-4111-8111-111111111111');

insert into public.kpi_definitions(
  id,code,name,description,kpi_type,unit,submission_mode,evidence_required,
  active,created_by_user_id,updated_by_user_id,aggregation_mode,
  max_images_per_event,location_required,timestamp_required,customer_relation_mode
) values (
  '22222222-2222-4222-8222-222222222222','M1B_REPRO','M1B Repro','Disposable fixture',
  'MANUAL','event','EVENT_CLAIM',false,true,'m1b-manager','m1b-manager',
  'COUNT',2,false,true,'NONE'
);

select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);

do $do$
declare
  v_result jsonb;
  v_version integer := 1;
  v_state text;
  v_message text;
  v_boolean_field text;
begin
  v_result := public.crm_kpi_update_definition_v2(
    '22222222-2222-4222-8222-222222222222', v_version,
    '{"customerRelationMode":"REQUIRED"}'::jsonb
  );
  if v_result->>'customer_relation_mode' <> 'REQUIRED' then
    raise exception 'M1B legitimate relation-mode update failed';
  end if;
  v_version := (v_result->>'version')::integer;

  begin
    perform public.crm_kpi_update_definition_v2(
      '22222222-2222-4222-8222-222222222222', v_version,
      '{"customerRelationMode":"sometimes"}'::jsonb
    );
    raise exception 'M1B_EXPECTED_RELATION_FAILURE_NOT_RAISED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state <> '22023' or v_message <> 'Invalid customer relation mode.' then
      raise exception 'M1B relation error mismatch: state=% message=%', v_state, v_message;
    end if;
  end;

  begin
    perform public.crm_kpi_update_definition_v2(
      '22222222-2222-4222-8222-222222222222', v_version,
      '{"maxImagesPerEvent":"not-an-integer"}'::jsonb
    );
    raise exception 'M1B_EXPECTED_NUMERIC_FAILURE_NOT_RAISED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state <> '22023' or v_message <> 'Invalid KPI numeric option: maxImagesPerEvent.' then
      raise exception 'M1B numeric error mismatch: state=% message=%', v_state, v_message;
    end if;
  end;

  foreach v_boolean_field in array array[
    'evidenceRequired', 'locationRequired', 'timestampRequired'
  ] loop
    begin
      perform public.crm_kpi_update_definition_v2(
        '22222222-2222-4222-8222-222222222222', v_version,
        jsonb_build_object(v_boolean_field, 'not-a-boolean')
      );
      raise exception 'M1B_EXPECTED_BOOLEAN_FAILURE_NOT_RAISED field=%', v_boolean_field;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
      if v_state <> '22023'
         or v_message <> 'Invalid KPI boolean option: ' || v_boolean_field || '.' then
        raise exception 'M1B boolean error mismatch: field=% state=% message=%',
          v_boolean_field, v_state, v_message;
      end if;
    end;
  end loop;
end
$do$;

-- Invalid JWT subjects must no longer be disguised as numeric/boolean errors.
select set_config('request.jwt.claim.sub','m1b-invalid-non-uuid-sub',true);
do $do$
declare
  v_state text;
  v_message text;
begin
  begin
    perform public.crm_kpi_update_definition_v2(
      '22222222-2222-4222-8222-222222222222', 2,
      '{"customerRelationMode":"OPTIONAL"}'::jsonb
    );
    raise exception 'M1B_EXPECTED_AUTH_FAILURE_NOT_RAISED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state <> '22P02'
       or v_message not like 'invalid input syntax for type uuid:%' then
      raise exception 'M1B auth error was remapped: state=% message=%', v_state, v_message;
    end if;
  end;
end
$do$;

do $$
begin
  raise notice 'M1B_RPC_ERROR_HARDENING_PASS';
end;
$$;
rollback;
