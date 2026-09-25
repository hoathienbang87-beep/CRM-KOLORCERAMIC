-- CATALOG INTEGRATION 05B — website lead workflow and customer conversion.
-- Additive migration. Browser roles never receive direct website_leads access.
begin;

select pg_advisory_xact_lock(hashtext('CATALOG-INTEGRATION-05B-WEBSITE-LEADS'));

do $$
declare
  v_missing text;
begin
  select string_agg(required_object, ', ' order by required_object)
    into v_missing
  from unnest(array[
    'public.website_leads',
    'public.products',
    'public.customers',
    'public.phone_index',
    'public.app_users',
    'public.audit_logs'
  ]) required(required_object)
  where to_regclass(required_object) is null;

  if v_missing is not null then
    raise exception 'CATALOG_05B_PRECONDITION_FAIL: missing objects: %', v_missing;
  end if;
  if to_regprocedure('public.catalog_submit_website_lead(jsonb)') is null
     or to_regprocedure('public.crm_create_customer(jsonb)') is null
     or to_regprocedure('public.crm_update_customer_profile(text,jsonb)') is null then
    raise exception 'CATALOG_05B_PRECONDITION_FAIL: required 02B/CRM RPCs are missing.';
  end if;
  if to_regprocedure('public.catalog_submit_website_lead_v1(jsonb)') is not null
     or exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'website_leads' and column_name = 'conversion_idempotency_key'
     ) then
    raise exception 'CATALOG_05B_PRECONDITION_FAIL: migration already applied.';
  end if;
end;
$$;

create function public.catalog_normalize_phone_05b(p_phone text)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, public
as $$
declare
  v_digits text := regexp_replace(p_phone, '[^0-9]', '', 'g');
begin
  if v_digits = '' then return null; end if;
  if v_digits ~ '^0084[0-9]{9}$' then
    v_digits := '0' || substring(v_digits from 5);
  elsif v_digits ~ '^84[0-9]{9}$' then
    v_digits := '0' || substring(v_digits from 3);
  end if;
  return v_digits;
end;
$$;

create function public.catalog_require_lead_manager_05b()
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor text := public.crm_current_app_user_id();
  v_role text := public.crm_current_user_role();
begin
  if auth.uid() is null
     or v_actor is null
     or not coalesce(public.crm_is_active_user(), false)
     or v_role not in ('manager', 'owner', 'admin', 'quanly', 'quản lý', 'quản lí') then
    raise exception using errcode = '42501', message = 'WEBSITE_LEAD_MANAGER_REQUIRED';
  end if;
  return v_actor;
end;
$$;

-- Replaceable internal hook: deterministic checks run in PostgreSQL today;
-- a future edge/captcha adapter can replace this function without changing the
-- public submission contract. Client-supplied provider claims are never trusted.
create function public.catalog_website_lead_spam_hook_05b(p_lead jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_context jsonb := coalesce(p_lead->'anti_spam', '{}'::jsonb);
  v_honeypot text;
  v_message text := lower(coalesce(p_lead->>'message', ''));
  v_link_count integer;
  v_score integer := 0;
  v_reason text;
begin
  if jsonb_typeof(v_context) <> 'object'
     or exists (select 1 from jsonb_object_keys(v_context) k where k not in ('honeypot', 'provider')) then
    raise exception using errcode = '22023', message = 'WEBSITE_LEAD_ANTI_SPAM_INVALID';
  end if;
  v_honeypot := nullif(btrim(v_context->>'honeypot'), '');
  v_link_count := (length(v_message) - length(replace(v_message, 'http', ''))) / 4;

  if v_honeypot is not null then
    v_score := 100;
    v_reason := 'HONEYPOT';
  elsif v_link_count >= 6 then
    v_score := 100;
    v_reason := 'EXCESSIVE_LINKS';
  elsif v_link_count >= 3 then
    v_score := 50;
    v_reason := 'MULTIPLE_LINKS';
  end if;

  return jsonb_build_object(
    'blocked', v_score >= 100,
    'score', v_score,
    'reason', v_reason,
    'provider_hint', nullif(btrim(v_context->>'provider'), '')
  );
end;
$$;

alter table public.website_leads
  drop constraint website_leads_status_check,
  add column phone_normalized text,
  add column request_id uuid,
  add column spam_score integer not null default 0,
  add column spam_reason text,
  add column customer_id text references public.customers(id) on delete set null,
  add column conversion_mode text,
  add column conversion_idempotency_key uuid,
  add column converted_at timestamptz,
  add column converted_by_user_id text references public.app_users(id) on delete restrict,
  add constraint website_leads_status_check check (
    status in ('NEW', 'CONTACTED', 'QUALIFIED', 'CLOSED', 'SPAM', 'CONVERTED')
  ),
  add constraint website_leads_phone_normalized_check check (
    phone_normalized is null or phone_normalized ~ '^[0-9]{9,15}$'
  ),
  add constraint website_leads_spam_score_check check (spam_score between 0 and 100),
  add constraint website_leads_spam_reason_check check (
    spam_reason is null or (btrim(spam_reason) <> '' and length(spam_reason) <= 100)
  ),
  add constraint website_leads_conversion_mode_check check (
    conversion_mode is null or conversion_mode in ('CREATE', 'MERGE')
  ),
  add constraint website_leads_conversion_shape_check check (
    (status = 'CONVERTED') = (
      customer_id is not null
      and conversion_mode is not null
      and conversion_idempotency_key is not null
      and converted_at is not null
      and converted_by_user_id is not null
    )
  ),
  add constraint website_leads_request_id_key unique (request_id),
  add constraint website_leads_conversion_idempotency_key unique (conversion_idempotency_key);

update public.website_leads
set phone_normalized = case
  when length(public.catalog_normalize_phone_05b(phone)) between 9 and 15
    then public.catalog_normalize_phone_05b(phone)
  else null
end
where phone is not null;

create index website_leads_phone_normalized_idx
  on public.website_leads(phone_normalized, created_at desc, id)
  where phone_normalized is not null;
create index website_leads_customer_idx
  on public.website_leads(customer_id, converted_at desc, id)
  where customer_id is not null;

create function public.catalog_submit_website_lead_v1(p_lead jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_existing_id uuid;
  v_product_id uuid;
  v_request_id uuid;
  v_name text;
  v_phone text;
  v_phone_normalized text;
  v_email text;
  v_message text;
  v_source_path text;
  v_utm jsonb;
  v_spam jsonb;
  v_internal_status text;
  v_contact_key text;
  v_recent integer;
begin
  if p_lead is null or jsonb_typeof(p_lead) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(p_lead) k
       where k not in (
         'request_id','product_id','contact_name','phone','email','message',
         'source_path','utm','privacy_consent','anti_spam'
       )
     ) then
    raise exception using errcode = '22023', message = 'WEBSITE_LEAD_INVALID';
  end if;

  begin
    v_request_id := nullif(p_lead->>'request_id', '')::uuid;
    v_product_id := nullif(p_lead->>'product_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'WEBSITE_LEAD_IDENTIFIER_INVALID';
  end;

  v_name := nullif(btrim(p_lead->>'contact_name'), '');
  v_phone := nullif(btrim(p_lead->>'phone'), '');
  v_phone_normalized := public.catalog_normalize_phone_05b(v_phone);
  v_email := nullif(lower(btrim(p_lead->>'email')), '');
  v_message := nullif(btrim(p_lead->>'message'), '');
  v_source_path := nullif(btrim(p_lead->>'source_path'), '');
  v_utm := coalesce(p_lead->'utm', '{}'::jsonb);

  if v_name is null or length(v_name) > 200
     or (v_phone is null and v_email is null)
     or (v_phone is not null and (v_phone_normalized is null or length(v_phone_normalized) not between 9 and 15))
     or (v_email is not null and (length(v_email) > 320 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'))
     or length(coalesce(v_message, '')) > 4000
     or length(coalesce(v_source_path, '')) > 1000
     or jsonb_typeof(v_utm) <> 'object'
     or jsonb_typeof(coalesce(p_lead->'privacy_consent', 'false'::jsonb)) <> 'boolean'
     or coalesce((p_lead->>'privacy_consent')::boolean, false) is not true then
    raise exception using errcode = '22023', message = 'WEBSITE_LEAD_VALIDATION_FAILED';
  end if;
  if v_product_id is not null and public.catalog_public_product_json_02b(v_product_id) is null then
    raise exception using errcode = '22023', message = 'WEBSITE_LEAD_PRODUCT_NOT_PUBLIC';
  end if;

  if v_request_id is not null then
    perform pg_advisory_xact_lock(hashtext('WEBSITE_LEAD_REQUEST_05B|' || v_request_id::text));
    select id into v_existing_id from public.website_leads where request_id = v_request_id;
    if v_existing_id is not null then
      return jsonb_build_object('id', v_existing_id, 'status', 'RECEIVED', 'idempotent_replay', true);
    end if;
  end if;

  v_contact_key := coalesce(v_email, '') || '|' || coalesce(v_phone_normalized, '');
  perform pg_advisory_xact_lock(hashtext('WEBSITE_LEAD_RATE_05B|' || v_contact_key));
  select count(*) into v_recent
  from public.website_leads l
  where l.created_at >= now() - interval '15 minutes'
    and (
      (v_email is not null and lower(coalesce(l.email, '')) = v_email)
      or (v_phone_normalized is not null and l.phone_normalized = v_phone_normalized)
    );
  if v_recent >= 5 then
    raise exception using errcode = 'P0001', message = 'WEBSITE_LEAD_RATE_LIMITED';
  end if;

  v_spam := public.catalog_website_lead_spam_hook_05b(p_lead);
  v_internal_status := case when coalesce((v_spam->>'blocked')::boolean, false) then 'SPAM' else 'NEW' end;

  insert into public.website_leads(
    request_id, product_id, contact_name, phone, phone_normalized, email, message,
    source_path, utm, status, privacy_consent_at, spam_score, spam_reason
  ) values (
    v_request_id, v_product_id, v_name, v_phone, v_phone_normalized, v_email, v_message,
    v_source_path, v_utm, v_internal_status, now(),
    coalesce((v_spam->>'score')::integer, 0), nullif(v_spam->>'reason', '')
  ) returning id into v_id;

  perform public.crm_write_audit(
    'websiteLeadCreate05B', 'website_leads', v_id::text,
    jsonb_build_object(
      'product_id', v_product_id,
      'source_path', v_source_path,
      'status', v_internal_status,
      'spam_reason', nullif(v_spam->>'reason', '')
    )
  );
  return jsonb_build_object('id', v_id, 'status', 'RECEIVED', 'idempotent_replay', false);
end;
$$;

create function public.catalog_manager_list_website_leads_v1(
  p_status text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.catalog_require_lead_manager_05b();
  if p_limit is null or p_limit < 1 or p_limit > 500
     or p_offset is null or p_offset < 0 or p_offset > 100000
     or (p_status is not null and upper(p_status) not in ('NEW','CONTACTED','QUALIFIED','CLOSED','SPAM','CONVERTED')) then
    raise exception using errcode = '22023', message = 'WEBSITE_LEAD_QUERY_INVALID';
  end if;

  return (
    with filtered as (
      select l.* from public.website_leads l
      where p_status is null or l.status = upper(p_status)
    ), paged as (
      select * from filtered order by created_at desc, id limit p_limit offset p_offset
    )
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id) from paged x), '[]'::jsonb),
      'pagination', jsonb_build_object(
        'limit', p_limit,
        'offset', p_offset,
        'total', (select count(*) from filtered),
        'has_more', p_offset + p_limit < (select count(*) from filtered),
        'next_offset', case when p_offset + p_limit < (select count(*) from filtered) then p_offset + p_limit else null end
      )
    )
  );
end;
$$;

create function public.catalog_manager_update_website_lead_v1(
  p_lead_id uuid,
  p_status text,
  p_assigned_to_user_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor text := public.catalog_require_lead_manager_05b();
  v_old public.website_leads%rowtype;
  v_result jsonb;
  v_status text := upper(coalesce(p_status, ''));
begin
  if p_lead_id is null or v_status not in ('NEW','CONTACTED','QUALIFIED','CLOSED','SPAM')
     or (p_assigned_to_user_id is not null and not exists (
       select 1 from public.app_users u
       where u.id = p_assigned_to_user_id and u.active and lower(u.lifecycle_status) = 'active'
     )) then
    raise exception using errcode = '22023', message = 'WEBSITE_LEAD_UPDATE_INVALID';
  end if;

  select * into v_old from public.website_leads where id = p_lead_id for update;
  if v_old.id is null then raise exception using errcode = 'P0002', message = 'WEBSITE_LEAD_NOT_FOUND'; end if;
  if v_old.status = 'CONVERTED' then
    raise exception using errcode = '55000', message = 'WEBSITE_LEAD_ALREADY_CONVERTED';
  end if;
  if v_old.status = v_status and v_old.assigned_to_user_id is not distinct from p_assigned_to_user_id then
    return jsonb_build_object(
      'id', v_old.id, 'status', v_old.status,
      'assigned_to_user_id', v_old.assigned_to_user_id,
      'updated_at', v_old.updated_at, 'idempotent_replay', true
    );
  end if;

  update public.website_leads
  set status = v_status, assigned_to_user_id = p_assigned_to_user_id, updated_at = now()
  where id = p_lead_id
  returning jsonb_build_object(
    'id', id, 'status', status, 'assigned_to_user_id', assigned_to_user_id,
    'updated_at', updated_at, 'idempotent_replay', false
  ) into v_result;

  perform public.crm_write_audit(
    'websiteLeadStatus05B', 'website_leads', p_lead_id::text,
    jsonb_build_object(
      'before_status', v_old.status,
      'after_status', v_status,
      'before_assigned_to_user_id', v_old.assigned_to_user_id,
      'after_assigned_to_user_id', p_assigned_to_user_id,
      'actor', v_actor
    )
  );
  return v_result;
end;
$$;

create function public.catalog_manager_find_lead_customer_matches_v1(p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_phone text;
begin
  perform public.catalog_require_lead_manager_05b();
  select phone_normalized into v_phone from public.website_leads where id = p_lead_id;
  if not found then raise exception using errcode = 'P0002', message = 'WEBSITE_LEAD_NOT_FOUND'; end if;

  return jsonb_build_object(
    'phone_normalized', v_phone,
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'company_name', c.company_name,
        'phone_raw', c.phone_raw,
        'phone_normalized', c.phone_normalized,
        'owner_user_id', c.owner_user_id
      ) order by c.updated_at desc nulls last, c.id)
      from public.customers c
      where v_phone is not null
        and c.phone_normalized = v_phone
        and not coalesce(c.is_deleted, false)
    ), '[]'::jsonb)
  );
end;
$$;

create function public.catalog_manager_convert_website_lead_v1(
  p_lead_id uuid,
  p_mode text,
  p_customer_id text default null,
  p_owner_user_id text default null,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor text := public.catalog_require_lead_manager_05b();
  v_mode text := upper(coalesce(p_mode, ''));
  v_lead public.website_leads%rowtype;
  v_customer public.customers%rowtype;
  v_owner public.app_users%rowtype;
  v_duplicate_id text;
  v_result jsonb;
  v_new_customer_id text;
begin
  if p_lead_id is null or v_mode not in ('CREATE', 'MERGE') or p_idempotency_key is null
     or (v_mode = 'CREATE' and p_customer_id is not null)
     or (v_mode = 'MERGE' and nullif(btrim(p_customer_id), '') is null) then
    raise exception using errcode = '22023', message = 'WEBSITE_LEAD_CONVERSION_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtext('WEBSITE_LEAD_CONVERT_05B|' || p_lead_id::text));
  select * into v_lead from public.website_leads where id = p_lead_id for update;
  if v_lead.id is null then raise exception using errcode = 'P0002', message = 'WEBSITE_LEAD_NOT_FOUND'; end if;

  if v_lead.conversion_idempotency_key = p_idempotency_key and v_lead.customer_id is not null then
    return jsonb_build_object(
      'lead_id', v_lead.id,
      'customer_id', v_lead.customer_id,
      'mode', v_lead.conversion_mode,
      'status', v_lead.status,
      'idempotent_replay', true
    );
  end if;
  if v_lead.status = 'CONVERTED' or v_lead.conversion_idempotency_key is not null then
    raise exception using errcode = '55000', message = 'WEBSITE_LEAD_ALREADY_CONVERTED';
  end if;
  if v_lead.status in ('SPAM', 'CLOSED') then
    raise exception using errcode = '55000', message = 'WEBSITE_LEAD_NOT_CONVERTIBLE';
  end if;

  if v_lead.phone_normalized is not null then
    perform pg_advisory_xact_lock(hashtext('crm_phone:' || v_lead.phone_normalized));
  end if;

  if v_mode = 'CREATE' then
    if v_lead.phone_normalized is not null then
      select c.id into v_duplicate_id
      from public.customers c
      where c.phone_normalized = v_lead.phone_normalized
        and not coalesce(c.is_deleted, false)
      order by c.created_at, c.id
      limit 1;
      if v_duplicate_id is not null then
        raise exception using errcode = '23505', message = 'WEBSITE_LEAD_DUPLICATE_PHONE:' || v_duplicate_id;
      end if;
    end if;

    if p_owner_user_id is not null then
      select * into v_owner from public.app_users u
      where u.id = p_owner_user_id
        and u.active
        and lower(u.lifecycle_status) = 'active'
        and lower(coalesce(u.role, 'sale')) not in ('admin', 'owner');
      if v_owner.id is null then
        raise exception using errcode = '22023', message = 'WEBSITE_LEAD_OWNER_INVALID';
      end if;
    end if;

    v_result := public.crm_create_customer(jsonb_strip_nulls(jsonb_build_object(
      'name', v_lead.contact_name,
      'phoneRaw', v_lead.phone,
      'phoneNormalized', v_lead.phone_normalized,
      'noPhone', v_lead.phone_normalized is null,
      'channel', 'Website',
      'status', 'new',
      'need', v_lead.message,
      'ownerEmail', v_owner.email,
      'websiteLeadId', v_lead.id
    )));
    v_new_customer_id := v_result->>'id';
  else
    select * into v_customer
    from public.customers c
    where c.id = p_customer_id and not coalesce(c.is_deleted, false)
    for update;
    if v_customer.id is null then
      raise exception using errcode = 'P0002', message = 'WEBSITE_LEAD_CUSTOMER_NOT_FOUND';
    end if;

    if v_lead.phone_normalized is not null then
      select c.id into v_duplicate_id
      from public.customers c
      where c.phone_normalized = v_lead.phone_normalized
        and c.id <> v_customer.id
        and not coalesce(c.is_deleted, false)
      order by c.created_at, c.id
      limit 1;
      if v_duplicate_id is not null then
        raise exception using errcode = '23505', message = 'WEBSITE_LEAD_DUPLICATE_PHONE:' || v_duplicate_id;
      end if;
      if v_customer.phone_normalized is not null
         and v_customer.phone_normalized <> v_lead.phone_normalized then
        raise exception using errcode = '22023', message = 'WEBSITE_LEAD_PHONE_MISMATCH';
      end if;
      if v_customer.phone_normalized is null then
        perform public.crm_update_customer_profile(v_customer.id, jsonb_build_object(
          'phoneRaw', v_lead.phone,
          'phoneNormalized', v_lead.phone_normalized,
          'noPhone', false
        ));
      end if;
    end if;
    v_new_customer_id := v_customer.id;
  end if;

  update public.website_leads
  set status = 'CONVERTED',
      customer_id = v_new_customer_id,
      conversion_mode = v_mode,
      conversion_idempotency_key = p_idempotency_key,
      converted_at = now(),
      converted_by_user_id = v_actor,
      assigned_to_user_id = coalesce(assigned_to_user_id, p_owner_user_id),
      updated_at = now()
  where id = v_lead.id;

  perform public.crm_write_audit(
    'websiteLeadConvert05B', 'website_leads', v_lead.id::text,
    jsonb_build_object(
      'before_status', v_lead.status,
      'after_status', 'CONVERTED',
      'mode', v_mode,
      'customer_id', v_new_customer_id,
      'actor', v_actor
    )
  );
  return jsonb_build_object(
    'lead_id', v_lead.id,
    'customer_id', v_new_customer_id,
    'mode', v_mode,
    'status', 'CONVERTED',
    'idempotent_replay', false
  );
end;
$$;

alter table public.website_leads enable row level security;
revoke all on public.website_leads from public, anon;
revoke insert, update, delete, truncate on public.website_leads from authenticated;

-- Close 02B browser entrypoints so the 05B validation/spam/manager contract
-- cannot be bypassed. They remain available to service_role for rollback/ops.
revoke execute on function public.catalog_submit_website_lead(jsonb) from anon, authenticated;
revoke execute on function public.catalog_admin_list_website_leads(text,integer) from authenticated;
revoke execute on function public.catalog_admin_update_website_lead(uuid,text,text) from authenticated;

revoke all on function public.catalog_normalize_phone_05b(text) from public, anon, authenticated;
revoke all on function public.catalog_require_lead_manager_05b() from public, anon, authenticated;
revoke all on function public.catalog_website_lead_spam_hook_05b(jsonb) from public, anon, authenticated;
revoke all on function public.catalog_submit_website_lead_v1(jsonb) from public, anon, authenticated;
revoke all on function public.catalog_manager_list_website_leads_v1(text,integer,integer) from public, anon, authenticated;
revoke all on function public.catalog_manager_update_website_lead_v1(uuid,text,text) from public, anon, authenticated;
revoke all on function public.catalog_manager_find_lead_customer_matches_v1(uuid) from public, anon, authenticated;
revoke all on function public.catalog_manager_convert_website_lead_v1(uuid,text,text,text,uuid) from public, anon, authenticated;

grant execute on function public.catalog_submit_website_lead_v1(jsonb) to anon, authenticated;
grant execute on function public.catalog_manager_list_website_leads_v1(text,integer,integer) to authenticated;
grant execute on function public.catalog_manager_update_website_lead_v1(uuid,text,text) to authenticated;
grant execute on function public.catalog_manager_find_lead_customer_matches_v1(uuid) to authenticated;
grant execute on function public.catalog_manager_convert_website_lead_v1(uuid,text,text,text,uuid) to authenticated;

do $$
declare
  v_proc regprocedure;
begin
  foreach v_proc in array array[
    'public.catalog_require_lead_manager_05b()'::regprocedure,
    'public.catalog_website_lead_spam_hook_05b(jsonb)'::regprocedure,
    'public.catalog_submit_website_lead_v1(jsonb)'::regprocedure,
    'public.catalog_manager_list_website_leads_v1(text,integer,integer)'::regprocedure,
    'public.catalog_manager_update_website_lead_v1(uuid,text,text)'::regprocedure,
    'public.catalog_manager_find_lead_customer_matches_v1(uuid)'::regprocedure,
    'public.catalog_manager_convert_website_lead_v1(uuid,text,text,text,uuid)'::regprocedure
  ] loop
    if not exists (
      select 1 from pg_proc p
      where p.oid = v_proc
        and p.prosecdef
        and p.proconfig @> array['search_path=pg_catalog, public']
    ) then
      raise exception 'CATALOG_05B_VERIFY_FAIL: unsafe function %', v_proc;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.website_leads', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.website_leads', 'INSERT,UPDATE,DELETE,TRUNCATE')
     or has_function_privilege('anon', 'public.catalog_submit_website_lead(jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.catalog_admin_list_website_leads(text,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.catalog_admin_update_website_lead(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.catalog_require_lead_manager_05b()', 'EXECUTE')
     or not has_function_privilege('anon', 'public.catalog_submit_website_lead_v1(jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.catalog_manager_convert_website_lead_v1(uuid,text,text,text,uuid)', 'EXECUTE') then
    raise exception 'CATALOG_05B_VERIFY_FAIL: grant matrix.';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
