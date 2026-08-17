-- =====================================================================
-- HOTFIX R1-0 — bộ test bắt buộc (mục 6, 7, 8 của phase)
--
-- Chạy trên PostgreSQL cục bộ với harness dựng lại đúng bề mặt production:
--     psql -f harness-prod-baseline.sql            (trạng thái FAIL-OPEN)
--     psql -f scripts/test-hotfix-r1-0-fail-closed.sql
--
-- Script tự chia hai giai đoạn:
--   PHẦN 1  chạy TRƯỚC hotfix  -> phải tái hiện được lỗ hổng
--   PHẦN 2  áp hotfix
--   PHẦN 3  chạy SAU hotfix    -> mọi đường đều phải bị chặn
--
-- Chỉ đọc/ghi trên harness cục bộ. KHÔNG chạy file này trên production.
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;

create table if not exists r10_results(phase text, name text, ok boolean, detail text);
truncate r10_results;

create or replace function r10(p_phase text, p_name text, p_ok boolean, p_detail text default '')
returns void language sql as $$ insert into r10_results values (p_phase, p_name, p_ok, p_detail); $$;

create or replace function as_uid(p_uid uuid) returns void language sql as $$
  select set_config('crm.test_uid', coalesce(p_uid::text, ''), false);
$$;

-- =====================================================================
-- FIXTURES — owner, admin, manager, sale, nhân viên inactive/archived
-- =====================================================================
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_sale uuid := gen_random_uuid();
  v_inactive uuid := gen_random_uuid();
  v_archived uuid := gen_random_uuid();
begin
  insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values
    (v_owner,'owner@kolor.test',now(),now()),
    (v_admin,'admin@kolor.test',now(),now()),
    (v_manager,'manager@kolor.test',now(),now()),
    (v_sale,'sale@kolor.test',now(),now()),
    (v_inactive,'inactive@kolor.test',now(),now()),
    (v_archived,'archived@kolor.test',now(),now());
  insert into auth.identities(user_id,provider) values
    (v_owner,'google'),(v_admin,'google'),(v_manager,'google'),
    (v_sale,'google'),(v_inactive,'google'),(v_archived,'google');

  insert into public.app_users(id,email,name,role,active,lifecycle_status,supabase_auth_id) values
    ('emp-owner','owner@kolor.test','Owner','owner',true,'active',v_owner),
    ('emp-admin','admin@kolor.test','Admin','admin',true,'active',v_admin),
    ('emp-manager','manager@kolor.test','Manager','manager',true,'active',v_manager),
    ('emp-sale','sale@kolor.test','Sale','sale',true,'active',v_sale),
    ('emp-inactive','inactive@kolor.test','Inactive','sale',false,'inactive',v_inactive),
    ('emp-archived','archived@kolor.test','Archived','sale',false,'archived',v_archived);

  insert into public.customers(id,name) values ('cus-1','Khách của Sale khác');
  insert into public.customer_assignments(id,customer_id,employee_id,is_current)
    values ('as-1','cus-1','emp-sale',true);

  perform set_config('crm.f_owner', v_owner::text, false);
  perform set_config('crm.f_admin', v_admin::text, false);
  perform set_config('crm.f_manager', v_manager::text, false);
  perform set_config('crm.f_sale', v_sale::text, false);
  perform set_config('crm.f_inactive', v_inactive::text, false);
  perform set_config('crm.f_archived', v_archived::text, false);
  perform set_config('crm.f_outsider', gen_random_uuid()::text, false);
end $$;

-- =====================================================================
-- PHẦN 1 — TRƯỚC HOTFIX: phải tái hiện được lỗ hổng (mục 7)
-- =====================================================================
do $$
declare v_outsider uuid := current_setting('crm.f_outsider')::uuid;
        v_err text; v_created int; v_life text; v_snoozed int;
begin
  perform as_uid(v_outsider);

  perform r10('BEFORE','crm_is_admin() trả NULL cho outsider',
    public.crm_is_admin() is null, coalesce(public.crm_is_admin()::text,'NULL'));
  perform r10('BEFORE','crm_is_manager() trả NULL cho outsider',
    public.crm_is_manager() is null, coalesce(public.crm_is_manager()::text,'NULL'));
  perform r10('BEFORE','crm_can_access_customer_id() trả NULL cho outsider',
    public.crm_can_access_customer_id('cus-1') is null,
    coalesce(public.crm_can_access_customer_id('cus-1')::text,'NULL'));

  -- Escalation 1: outsider tạo được hồ sơ nhân viên
  v_err := '';
  begin
    perform public.crm_create_employee(jsonb_build_object(
      'id','evil-before','email','outsider@gmail.test','role','sale'));
  exception when others then v_err := SQLERRM; end;
  select count(*) into v_created from public.app_users where id='evil-before';
  perform r10('BEFORE','EXPLOIT: outsider gọi được crm_create_employee',
    v_created = 1, coalesce(nullif(v_err,''),'không lỗi'));

  -- Escalation 2: outsider ngừng hoạt động được nhân viên khác
  v_err := '';
  begin
    perform public.crm_deactivate_employee('emp-sale','exploit');
  exception when others then v_err := SQLERRM; end;
  select lifecycle_status into v_life from public.app_users where id='emp-sale';
  perform r10('BEFORE','EXPLOIT: outsider ngừng được nhân viên khác',
    v_life = 'inactive', format('lifecycle=%s %s', v_life, v_err));

  -- Escalation 3: outsider ghi được lên khách hàng không thuộc về mình
  v_err := '';
  begin
    perform public.crm_snooze_customer('cus-1', current_date);
  exception when others then v_err := SQLERRM; end;
  select count(*) into v_snoozed from public.customers
    where id='cus-1' and next_care_date is not null;
  perform r10('BEFORE','EXPLOIT: outsider ghi được lên khách hàng của Sale khác',
    v_snoozed = 1, coalesce(nullif(v_err,''),'không lỗi'));

  -- Escalation 4: bỏ qua bảo vệ "chỉ owner được ngừng admin/owner"
  perform as_uid(current_setting('crm.f_manager')::uuid);
  v_err := '';
  begin
    perform public.crm_deactivate_employee('emp-admin','manager thử ngừng admin');
  exception when others then v_err := SQLERRM; end;
  perform r10('BEFORE','Manager bị chặn đúng khi ngừng admin (guard này vốn hoạt động)',
    v_err like '%Chỉ owner/admin%' or v_err like '%Chỉ owner được%', v_err);
end $$;

-- dọn dấu vết PHẦN 1 để PHẦN 3 chạy trên trạng thái sạch
delete from public.app_users where id = 'evil-before';
update public.customers set next_care_date = null where id = 'cus-1';
do $$
begin
  perform set_config('crm.allow_employee_lifecycle','on',true);
  update public.app_users set active = true, lifecycle_status = 'active' where id = 'emp-sale';
  perform set_config('crm.allow_employee_lifecycle','',true);
end $$;

-- =====================================================================
-- PHẦN 2 — ÁP HOTFIX
-- =====================================================================
\i supabase-hotfix-r1-0-crm-is-admin-fail-closed.sql

-- =====================================================================
-- PHẦN 3 — SAU HOTFIX
-- =====================================================================

-- --- Mục 6: ma trận vai trò A–G, và mục 8: không bao giờ NULL ---
do $$
declare
  v_cases text[][] := array[
    ['A','crm.f_outsider','false','outsider không có app_users row'],
    ['B','crm.f_inactive','false','app_user inactive'],
    ['C','crm.f_archived','false','app_user archived'],
    ['D','crm.f_sale','false','Sale'],
    ['E','crm.f_manager','false','Manager'],
    ['F','crm.f_admin','true','Admin'],
    ['G','crm.f_owner','true','Owner']
  ];
  v_case text[];
  v_admin boolean; v_role text; v_manager boolean; v_oa boolean;
begin
  foreach v_case slice 1 in array v_cases loop
    perform as_uid(current_setting(v_case[2])::uuid);
    v_admin := public.crm_is_admin();
    v_manager := public.crm_is_manager();
    v_oa := public.crm_is_owner_or_admin();
    v_role := public.crm_current_user_role();

    perform r10('AFTER', format('Mục 6.%s crm_is_admin() = %s cho %s', v_case[1], v_case[3], v_case[4]),
      v_admin is not null and v_admin::text = v_case[3], coalesce(v_admin::text,'NULL'));
    perform r10('AFTER', format('Mục 8.%s không hàm nào trả NULL (%s)', v_case[1], v_case[4]),
      v_admin is not null and v_manager is not null and v_oa is not null and v_role is not null,
      format('admin=%s manager=%s oa=%s role=%s',
        coalesce(v_admin::text,'NULL'), coalesce(v_manager::text,'NULL'),
        coalesce(v_oa::text,'NULL'), coalesce(v_role,'NULL')));
  end loop;

  -- Manager: theo hợp đồng hiện hành crm_is_manager() = true, crm_is_admin() = false
  perform as_uid(current_setting('crm.f_manager')::uuid);
  perform r10('AFTER','Mục 6.E Manager giữ nguyên quyền nghiệp vụ (is_manager = true)',
    public.crm_is_manager() = true and public.crm_is_admin() = false, '');

  -- Trạng thái CHƯA xác thực (auth.uid() = NULL)
  perform as_uid(null);
  perform r10('AFTER','Mục 8 chưa xác thực: fail closed, không NULL',
    public.crm_is_admin() = false and public.crm_is_manager() = false
    and public.crm_current_user_role() = '' , format('admin=%s role=%s',
      coalesce(public.crm_is_admin()::text,'NULL'), coalesce(public.crm_current_user_role(),'NULL')));
end $$;

-- --- Mục 7: chuỗi exploit cũ phải thất bại hoàn toàn, không ghi một phần ---
do $$
declare v_err text; v_created int; v_life text; v_snoozed int;
begin
  perform as_uid(current_setting('crm.f_outsider')::uuid);

  v_err := '';
  begin
    perform public.crm_create_employee(jsonb_build_object(
      'id','evil-after','email','outsider2@gmail.test','role','sale'));
  exception when others then v_err := SQLERRM; end;
  select count(*) into v_created from public.app_users where id='evil-after';
  perform r10('AFTER','Mục 7 outsider bị chặn ở crm_create_employee, không ghi một phần',
    v_err like '%Chỉ owner/admin%' and v_created = 0, v_err);

  v_err := '';
  begin
    perform public.crm_deactivate_employee('emp-sale','exploit');
  exception when others then v_err := SQLERRM; end;
  select lifecycle_status into v_life from public.app_users where id='emp-sale';
  perform r10('AFTER','Mục 7 outsider bị chặn ở RPC vòng đời, trạng thái không đổi',
    v_err like '%Chỉ owner/admin%' and v_life = 'active', format('%s | lifecycle=%s', v_err, v_life));

  v_err := '';
  begin
    perform public.crm_reactivate_employee('emp-inactive','exploit');
  exception when others then v_err := SQLERRM; end;
  perform r10('AFTER','Mục 7 outsider bị chặn ở crm_reactivate_employee',
    v_err like '%Chỉ owner/admin%', v_err);

  v_err := '';
  begin
    perform public.crm_archive_employee('emp-inactive','exploit');
  exception when others then v_err := SQLERRM; end;
  perform r10('AFTER','Mục 7 outsider bị chặn ở crm_archive_employee',
    v_err like '%Chỉ owner/admin%', v_err);

  v_err := '';
  begin
    perform public.crm_snooze_customer('cus-1', current_date);
  exception when others then v_err := SQLERRM; end;
  select count(*) into v_snoozed from public.customers
    where id='cus-1' and next_care_date is not null;
  perform r10('AFTER','Mục 7 outsider bị chặn trên dữ liệu khách hàng, không ghi một phần',
    v_err like '%Không có quyền%' and v_snoozed = 0, format('%s | snoozed=%s', v_err, v_snoozed));
end $$;

-- --- Sale/Manager: đúng ranh giới quyền ---
do $$
declare v_err text;
begin
  perform as_uid(current_setting('crm.f_sale')::uuid);
  v_err := '';
  begin
    perform public.crm_create_employee(jsonb_build_object('id','evil-sale','email','x@kolor.test','role','sale'));
  exception when others then v_err := SQLERRM; end;
  perform r10('AFTER','Sale không tạo được nhân viên',
    v_err like '%Chỉ owner/admin%' and (select count(*) from public.app_users where id='evil-sale') = 0, v_err);

  perform r10('AFTER','Sale vẫn truy cập được khách của chính mình',
    public.crm_can_access_customer_id('cus-1') = true, '');

  perform as_uid(current_setting('crm.f_manager')::uuid);
  v_err := '';
  begin
    perform public.crm_create_employee(jsonb_build_object('id','evil-mgr','email','y@kolor.test','role','sale'));
  exception when others then v_err := SQLERRM; end;
  perform r10('AFTER','Manager không leo được lên quyền Admin (tạo nhân viên)',
    v_err like '%Chỉ owner/admin%' and (select count(*) from public.app_users where id='evil-mgr') = 0, v_err);

  perform r10('AFTER','Manager giữ nguyên quyền đọc khách hàng theo nghiệp vụ',
    public.crm_can_access_customer_id('cus-1') = true, '');
end $$;

-- --- Mục 11: đường hợp lệ của Admin vẫn chạy ---
do $$
declare v jsonb;
begin
  perform as_uid(current_setting('crm.f_admin')::uuid);
  v := public.crm_create_employee(jsonb_build_object(
    'id','emp-legit','email','legit@kolor.test','name','Legit','role','sale'));
  perform r10('AFTER','Admin vẫn tạo được nhân viên hợp lệ (không regression)',
    v->>'id' = 'emp-legit'
    and (select lifecycle_status from public.app_users where id='emp-legit') = 'active', v::text);

  v := public.crm_deactivate_employee('emp-legit','dọn test');
  perform r10('AFTER','Admin vẫn dùng được RPC vòng đời (không regression)',
    v->>'lifecycleStatus' = 'inactive', v::text);
end $$;

-- --- Bảo vệ "chỉ owner được ngừng admin/owner" nay thực sự kích hoạt ---
do $$
declare v_err text; v_life text;
begin
  perform as_uid(current_setting('crm.f_admin')::uuid);
  v_err := '';
  begin
    perform public.crm_deactivate_employee('emp-owner','admin thử ngừng owner');
  exception when others then v_err := SQLERRM; end;
  select lifecycle_status into v_life from public.app_users where id='emp-owner';
  perform r10('AFTER','Chỉ owner được ngừng admin/owner — guard đã kích hoạt',
    v_err like '%Chỉ owner được%' and v_life = 'active', format('%s | %s', v_err, v_life));
end $$;

-- =====================================================================
-- KẾT QUẢ
-- =====================================================================
select phase, case when ok then 'PASS' else 'FAIL' end as result, name, detail
from r10_results order by phase desc, ok, name;

select phase,
       count(*) filter (where ok) as passed,
       count(*) filter (where not ok) as failed,
       count(*) as total
from r10_results group by phase order by phase desc;
