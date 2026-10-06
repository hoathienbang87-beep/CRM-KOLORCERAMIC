-- Prompt 05B cloud-staging runtime verification.
-- All fixture data is transaction-scoped and rolled back.
begin;

do $$
begin
  if (select count(*) from public.website_leads) <> 0
     or (select count(*) from public.customers) <> 0
     or (select count(*) from public.phone_index) <> 0
     or (select count(*) from public.customer_assignments) <> 0
     or (select count(*) from public.products) <> 123
     or (select count(*) from public.products where active) <> 75
     or (select count(*) from public.products where is_published) <> 0 then
    raise exception 'CATALOG_05B_STAGING_GUARD_FAIL: expected isolated post-05A staging baseline.';
  end if;
end;
$$;

insert into public.app_users(
  id, supabase_auth_id, email, name, role, active, lifecycle_status, created_at, updated_at
) values
  ('lead-05b-manager', '05b00000-0000-4000-8000-000000000001', 'lead-05b-manager@staging.invalid', 'Lead 05B Manager', 'manager', true, 'active', now(), now()),
  ('lead-05b-owner',   '05b00000-0000-4000-8000-000000000002', 'lead-05b-owner@staging.invalid',   'Lead 05B Owner',   'owner',   true, 'active', now(), now()),
  ('lead-05b-sale',    '05b00000-0000-4000-8000-000000000003', 'lead-05b-sale@staging.invalid',    'Lead 05B Sale',    'sale',    true, 'active', now(), now());

create temporary table catalog_05b_test_ids (
  label text primary key,
  id text not null
) on commit drop;
grant select, insert, update on catalog_05b_test_ids to anon, authenticated;

set local role anon;

do $$
declare
  v_result jsonb;
  v_failed boolean;
  v_index integer;
begin
  v_result := public.catalog_submit_website_lead_v1(jsonb_build_object(
    'request_id', '05b10000-0000-4000-8000-000000000001',
    'contact_name', 'Khách Merge',
    'phone', '+84 912 345 678',
    'email', 'merge@staging.invalid',
    'message', 'Tư vấn sản phẩm',
    'source_path', '/san-pham/merge',
    'utm', jsonb_build_object('source', 'test'),
    'privacy_consent', true,
    'anti_spam', jsonb_build_object('honeypot', '', 'provider', 'test')
  ));
  if v_result->>'status' <> 'RECEIVED' or (v_result->>'idempotent_replay')::boolean then
    raise exception 'CATALOG_05B_TEST_FAIL: valid submit.';
  end if;
  insert into catalog_05b_test_ids(label, id) values ('merge_lead', v_result->>'id');

  v_result := public.catalog_submit_website_lead_v1(jsonb_build_object(
    'request_id', '05b10000-0000-4000-8000-000000000001',
    'contact_name', 'Khách Merge', 'phone', '+84 912 345 678',
    'privacy_consent', true
  ));
  if not (v_result->>'idempotent_replay')::boolean then
    raise exception 'CATALOG_05B_TEST_FAIL: request idempotency.';
  end if;

  v_result := public.catalog_submit_website_lead_v1(jsonb_build_object(
    'request_id', '05b10000-0000-4000-8000-000000000002',
    'contact_name', 'Khách Create', 'phone', '0933-333-333',
    'message', 'Tạo khách mới', 'privacy_consent', true
  ));
  insert into catalog_05b_test_ids(label, id) values ('create_lead', v_result->>'id');
  v_result := public.catalog_submit_website_lead_v1(jsonb_build_object(
    'request_id', '05b10000-0000-4000-8000-000000000003',
    'contact_name', 'Khách Mismatch', 'phone', '0944-444-444',
    'privacy_consent', true
  ));
  insert into catalog_05b_test_ids(label, id) values ('mismatch_lead', v_result->>'id');
  v_result := public.catalog_submit_website_lead_v1(jsonb_build_object(
    'request_id', '05b10000-0000-4000-8000-000000000004',
    'contact_name', 'Bot', 'email', 'bot@staging.invalid',
    'privacy_consent', true,
    'anti_spam', jsonb_build_object('honeypot', 'filled-by-bot')
  ));
  insert into catalog_05b_test_ids(label, id) values ('spam_lead', v_result->>'id');

  v_failed := false;
  begin
    perform public.catalog_submit_website_lead_v1(jsonb_build_object(
      'contact_name', 'Thiếu consent', 'phone', '0900000000', 'privacy_consent', false
    ));
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then raise exception 'CATALOG_05B_TEST_FAIL: consent validation.'; end if;

  v_failed := false;
  begin
    perform public.catalog_submit_website_lead_v1(jsonb_build_object(
      'contact_name', 'Sai phone', 'phone', '123', 'privacy_consent', true
    ));
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then raise exception 'CATALOG_05B_TEST_FAIL: phone validation.'; end if;

  for v_index in 1..5 loop
    perform public.catalog_submit_website_lead_v1(jsonb_build_object(
      'request_id', '05b20000-0000-4000-8000-' || lpad(v_index::text, 12, '0'),
      'contact_name', 'Rate Test', 'phone', '0987654321',
      'email', format('rate-%s@staging.invalid', v_index),
      'privacy_consent', true
    ));
  end loop;
  v_failed := false;
  begin
    perform public.catalog_submit_website_lead_v1(jsonb_build_object(
      'request_id', '05b20000-0000-4000-8000-000000000006',
      'contact_name', 'Rate Test', 'phone', '0987654321',
      'email', 'rate-6@staging.invalid', 'privacy_consent', true
    ));
  exception when sqlstate 'P0001' then v_failed := true;
  end;
  if not v_failed then raise exception 'CATALOG_05B_TEST_FAIL: rate limit.'; end if;

  v_failed := false;
  begin
    perform public.catalog_submit_website_lead(jsonb_build_object(
      'contact_name', 'Legacy bypass', 'phone', '0900000000', 'privacy_consent', true
    ));
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'CATALOG_05B_TEST_FAIL: legacy submit bypass.'; end if;

  v_failed := false;
  begin
    perform public.catalog_manager_list_website_leads_v1(null, 10, 0);
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'CATALOG_05B_TEST_FAIL: anon manager API.'; end if;

  v_failed := false;
  begin
    perform count(*) from public.website_leads;
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'CATALOG_05B_TEST_FAIL: anon direct table read.'; end if;
end;
$$;

reset role;

do $$
begin
  if (select phone_normalized from public.website_leads where request_id = '05b10000-0000-4000-8000-000000000001') <> '0912345678'
     or (select status from public.website_leads where request_id = '05b10000-0000-4000-8000-000000000004') <> 'SPAM'
     or (select spam_reason from public.website_leads where request_id = '05b10000-0000-4000-8000-000000000004') <> 'HONEYPOT' then
    raise exception 'CATALOG_05B_TEST_FAIL: normalization or spam hook.';
  end if;
end;
$$;

insert into public.customers(
  id, name, phone_raw, phone_normalized, no_phone, channel, is_deleted,
  raw_data, created_at, updated_at
) values (
  'lead-05b-existing', 'Khách hiện hữu', '0912345678', '0912345678', false,
  'Website', false, '{}', now(), now()
);
insert into public.phone_index(phone, customer_id, raw_data)
values ('0912345678', 'lead-05b-existing', '{"customerId":"lead-05b-existing"}');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"05b00000-0000-4000-8000-000000000001","email":"lead-05b-manager@staging.invalid","role":"authenticated"}',
  true
);

do $$
declare
  v_merge_lead uuid := (select id::uuid from catalog_05b_test_ids where label = 'merge_lead');
  v_create_lead uuid := (select id::uuid from catalog_05b_test_ids where label = 'create_lead');
  v_mismatch_lead uuid := (select id::uuid from catalog_05b_test_ids where label = 'mismatch_lead');
  v_result jsonb;
  v_customer_id text;
  v_failed boolean;
begin
  v_result := public.catalog_manager_list_website_leads_v1(null, 5, 0);
  if (v_result #>> '{pagination,total}')::integer <> 9
     or jsonb_array_length(v_result->'items') <> 5
     or (v_result #>> '{pagination,has_more}')::boolean is not true then
    raise exception 'CATALOG_05B_TEST_FAIL: manager list/pagination.';
  end if;

  v_result := public.catalog_manager_find_lead_customer_matches_v1(v_merge_lead);
  if jsonb_array_length(v_result->'matches') <> 1
     or v_result #>> '{matches,0,id}' <> 'lead-05b-existing' then
    raise exception 'CATALOG_05B_TEST_FAIL: duplicate phone discovery.';
  end if;

  v_result := public.catalog_manager_update_website_lead_v1(v_merge_lead, 'CONTACTED', 'lead-05b-sale');
  if v_result->>'status' <> 'CONTACTED' or v_result->>'assigned_to_user_id' <> 'lead-05b-sale' then
    raise exception 'CATALOG_05B_TEST_FAIL: manager status update.';
  end if;

  v_failed := false;
  begin
    perform public.catalog_manager_convert_website_lead_v1(
      v_merge_lead, 'CREATE', null, 'lead-05b-sale', '05b30000-0000-4000-8000-000000000001'
    );
  exception when unique_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'CATALOG_05B_TEST_FAIL: duplicate create blocked.'; end if;

  v_result := public.catalog_manager_convert_website_lead_v1(
    v_merge_lead, 'MERGE', 'lead-05b-existing', null, '05b30000-0000-4000-8000-000000000002'
  );
  if v_result->>'customer_id' <> 'lead-05b-existing'
     or v_result->>'status' <> 'CONVERTED'
     or v_result->>'mode' <> 'MERGE'
     or (v_result->>'idempotent_replay')::boolean then
    raise exception 'CATALOG_05B_TEST_FAIL: merge conversion.';
  end if;
  v_result := public.catalog_manager_convert_website_lead_v1(
    v_merge_lead, 'MERGE', 'lead-05b-existing', null, '05b30000-0000-4000-8000-000000000002'
  );
  if not (v_result->>'idempotent_replay')::boolean then
    raise exception 'CATALOG_05B_TEST_FAIL: merge idempotency.';
  end if;

  v_result := public.catalog_manager_convert_website_lead_v1(
    v_create_lead, 'CREATE', null, 'lead-05b-sale', '05b30000-0000-4000-8000-000000000003'
  );
  v_customer_id := v_result->>'customer_id';
  if v_customer_id is null then
    raise exception 'CATALOG_05B_TEST_FAIL: create conversion/customer assignment.';
  end if;
  insert into catalog_05b_test_ids(label, id) values ('created_customer', v_customer_id);
  v_result := public.catalog_manager_convert_website_lead_v1(
    v_create_lead, 'CREATE', null, 'lead-05b-sale', '05b30000-0000-4000-8000-000000000003'
  );
  if not (v_result->>'idempotent_replay')::boolean then
    raise exception 'CATALOG_05B_TEST_FAIL: create idempotency.';
  end if;

  v_failed := false;
  begin
    perform public.catalog_manager_convert_website_lead_v1(
      v_mismatch_lead, 'MERGE', 'lead-05b-existing', null, '05b30000-0000-4000-8000-000000000004'
    );
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then raise exception 'CATALOG_05B_TEST_FAIL: mismatched phone merge.'; end if;

end;
$$;

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"05b00000-0000-4000-8000-000000000003","email":"lead-05b-sale@staging.invalid","role":"authenticated"}',
  true
);
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.catalog_manager_list_website_leads_v1(null, 10, 0);
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'CATALOG_05B_TEST_FAIL: sale manager denial.'; end if;
end;
$$;

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"05b00000-0000-4000-8000-000000000002","email":"lead-05b-owner@staging.invalid","role":"authenticated"}',
  true
);
do $$
begin
  if (public.catalog_manager_list_website_leads_v1('CONVERTED', 100, 0) #>> '{pagination,total}')::integer <> 2 then
    raise exception 'CATALOG_05B_TEST_FAIL: owner access.';
  end if;
end;
$$;

reset role;

do $$
declare
  v_merge_lead text := (select id from catalog_05b_test_ids where label = 'merge_lead');
  v_create_lead text := (select id from catalog_05b_test_ids where label = 'create_lead');
  v_customer_id text := (select id from catalog_05b_test_ids where label = 'created_customer');
begin
  if not exists (
       select 1 from public.customers c
       where c.id = v_customer_id and c.phone_normalized = '0933333333' and c.channel = 'Website'
     )
     or not exists (select 1 from public.phone_index where phone = '0933333333' and customer_id = v_customer_id)
     or not exists (
       select 1 from public.customer_assignments
       where customer_id = v_customer_id and employee_id = 'lead-05b-sale' and is_current
     ) then
    raise exception 'CATALOG_05B_TEST_FAIL: create conversion/customer assignment.';
  end if;

  if (select count(*) from public.audit_logs where action = 'websiteLeadConvert05B' and entity_id = v_merge_lead) <> 1
     or (select count(*) from public.audit_logs where action = 'websiteLeadConvert05B' and entity_id = v_create_lead) <> 1
     or not exists (
       select 1 from public.audit_logs
       where action = 'websiteLeadStatus05B' and entity_id = v_merge_lead
         and raw_data->>'before_status' = 'NEW' and raw_data->>'after_status' = 'CONTACTED'
     )
     or not exists (
       select 1 from public.audit_logs
       where action = 'websiteLeadConvert05B' and entity_id = v_create_lead
         and raw_data->>'before_status' = 'NEW' and raw_data->>'after_status' = 'CONVERTED'
         and raw_data->>'mode' = 'CREATE'
     ) then
    raise exception 'CATALOG_05B_TEST_FAIL: status/conversion audit or replay duplication.';
  end if;

  if exists (
    select 1 from public.audit_logs
    where action in ('websiteLeadCreate05B','websiteLeadStatus05B','websiteLeadConvert05B')
      and (raw_data::text like '%merge@staging.invalid%' or raw_data::text like '%0912345678%')
  ) then
    raise exception 'CATALOG_05B_TEST_FAIL: lead audit contains contact PII.';
  end if;
end;
$$;

rollback;

-- Independent proof that all fixture data and identities were reverted.
begin;
do $$
begin
  if (select count(*) from public.website_leads) <> 0
     or (select count(*) from public.customers) <> 0
     or (select count(*) from public.phone_index) <> 0
     or (select count(*) from public.customer_assignments) <> 0
     or exists (select 1 from public.app_users where id like 'lead-05b-%') then
    raise exception 'CATALOG_05B_TEST_FAIL: fixture rollback residue.';
  end if;
end;
$$;
commit;
