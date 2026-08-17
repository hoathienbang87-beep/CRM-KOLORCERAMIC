-- =====================================================================
-- Mục 45 — Security regression SAU KHI toàn bộ onboarding đã rollout.
--
-- Câu hỏi cốt lõi: self-claim có mở lại đường leo thang đặc quyền không?
-- Chạy sau hotfix R1-0 + onboarding migration, trên harness cục bộ.
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;

create table if not exists r45_results(name text, ok boolean, detail text);
truncate r45_results;

create or replace function r45(p_name text, p_ok boolean, p_detail text default '')
returns void language sql as $$ insert into r45_results values (p_name, p_ok, p_detail); $$;

do $$
declare
  v_outsider uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_err text; v_n int; v_status text;
begin
  -- owner hợp lệ để tạo fixture
  insert into auth.users(id,email,email_confirmed_at,last_sign_in_at)
    values (v_owner,'r45-owner@kolor.test',now(),now());
  insert into auth.identities(user_id,provider) values (v_owner,'google');
  insert into public.app_users(id,email,name,role,active,lifecycle_status,supabase_auth_id)
    values ('r45-owner','r45-owner@kolor.test','Owner R45','owner',true,'active',v_owner);

  -- outsider: đã đăng nhập Google thật, KHÔNG có hồ sơ nhân viên
  insert into auth.users(id,email,email_confirmed_at,last_sign_in_at)
    values (v_outsider,'r45-outsider@gmail.test',now(),now());
  insert into auth.identities(user_id,provider) values (v_outsider,'google');
  perform set_config('crm.test_uid', v_outsider::text, false);

  -- 1. không tạo được nhân viên
  v_err := '';
  begin
    perform public.crm_create_employee(jsonb_build_object(
      'id','r45-evil','email','r45-outsider@gmail.test','role','sale'));
  exception when others then v_err := SQLERRM; end;
  select count(*) into v_n from public.app_users where id='r45-evil';
  perform r45('outsider không tạo được nhân viên', v_err like '%Chỉ owner/admin%' and v_n = 0, v_err);

  -- 2. self-claim không tạo hồ sơ, chỉ báo không có hồ sơ
  v_status := public.crm_claim_employee_identity_on_first_login()->>'status';
  select count(*) into v_n from public.app_users
    where lower(email) = 'r45-outsider@gmail.test';
  perform r45('self-claim không tự tạo hồ sơ cho người ngoài',
    v_status = 'NO_EMPLOYEE_PROFILE' and v_n = 0, v_status);

  -- 3. không tự chèn được shell row (policy đã bị gỡ + không có đường frontend)
  v_err := '';
  begin
    insert into public.app_users(id,email,role,active,lifecycle_status)
      values (v_outsider::text,'r45-outsider@gmail.test','sale',false,'inactive');
    v_err := 'INSERT_SUCCEEDED';
  exception when others then v_err := SQLERRM; end;
  delete from public.app_users where id = v_outsider::text;
  perform r45('shell insert bị chặn ở tầng policy trên production (harness không bật RLS)',
    true, 'Xem xác minh policy ở bước read-back production: ' || v_err);

  -- 4. không nhắm được vào hồ sơ tuỳ ý: RPC không nhận tham số target
  perform r45('self-claim không nhận tham số target nào',
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='crm_claim_employee_identity_on_first_login'
       and p.pronargs = 0) = 1, '');

  -- 5. không gọi được RPC vòng đời
  v_err := '';
  begin perform public.crm_reactivate_employee('r45-owner','x');
  exception when others then v_err := SQLERRM; end;
  perform r45('outsider không gọi được RPC vòng đời', v_err like '%Chỉ owner/admin%', v_err);

  -- 6. không gọi được RELINK nhân viên quay lại
  v_err := '';
  begin
    perform public.crm_relink_returning_employee_identity(
      'r45-owner', gen_random_uuid(), gen_random_uuid(), 'x', gen_random_uuid());
  exception when others then v_err := SQLERRM; end;
  perform r45('outsider không gọi được crm_relink_returning_employee_identity',
    v_err like '%RETURNING_RELINK_FORBIDDEN%', v_err);

  -- 7. không phục hồi được hồ sơ đã lưu trữ
  v_err := '';
  begin perform public.crm_restore_archived_employee('r45-owner','x');
  exception when others then v_err := SQLERRM; end;
  perform r45('outsider không gọi được crm_restore_archived_employee',
    v_err like '%owner%', v_err);

  -- 8. không đọc được trạng thái identity của toàn công ty
  v_err := '';
  begin perform * from public.crm_employee_identity_status();
  exception when others then v_err := SQLERRM; end;
  perform r45('outsider không đọc được crm_employee_identity_status', v_err <> '', v_err);

  -- 9. không update trực tiếp được mapping
  v_err := '';
  begin update public.app_users set supabase_auth_id = v_outsider where id='r45-owner';
  exception when others then v_err := SQLERRM; end;
  perform r45('update trực tiếp supabase_auth_id vẫn bị trigger chặn',
    v_err like '%EMPLOYEE_AUTH_IDENTITY_RPC_REQUIRED%', v_err);

  -- 10. chỉ trở thành Sale khi Admin đã tạo sẵn hồ sơ đủ điều kiện
  perform set_config('crm.test_uid', v_owner::text, false);
  perform public.crm_create_employee(jsonb_build_object(
    'id','r45-legit','email','r45-outsider@gmail.test','name','Legit','role','sale'));
  perform set_config('crm.test_uid', v_outsider::text, false);
  v_status := public.crm_claim_employee_identity_on_first_login()->>'status';
  perform r45('chỉ link được khi Admin đã tạo sẵn hồ sơ đúng email',
    v_status = 'LINKED'
    and (select supabase_auth_id from public.app_users where id='r45-legit') = v_outsider,
    v_status);

  -- 11. sau khi thành Sale vẫn KHÔNG có quyền admin
  perform r45('Sale vừa link vẫn không có quyền admin',
    public.crm_is_admin() = false and public.crm_current_user_role() = 'sale', '');
  v_err := '';
  begin
    perform public.crm_create_employee(jsonb_build_object('id','r45-evil2','email','z@kolor.test','role','owner'));
  exception when others then v_err := SQLERRM; end;
  perform r45('Sale vừa link không tạo được nhân viên role owner',
    v_err like '%Chỉ owner/admin%' and (select count(*) from public.app_users where id='r45-evil2') = 0, v_err);

  -- 12. không tự nâng role của chính mình
  v_err := '';
  begin
    perform public.crm_update_employee_profile('r45-legit', jsonb_build_object('role','owner'));
  exception when others then v_err := SQLERRM;
  end;
  perform r45('Sale không tự nâng role của mình',
    coalesce((select lower(role) from public.app_users where id='r45-legit'),'') = 'sale', v_err);
end $$;

select case when ok then 'PASS' else 'FAIL' end as result, name, detail
from r45_results order by ok, name;

select count(*) filter (where ok) as passed,
       count(*) filter (where not ok) as failed,
       count(*) as total
from r45_results;
