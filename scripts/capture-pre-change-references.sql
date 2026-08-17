-- =====================================================================
-- PRE-CHANGE TECHNICAL REFERENCES (mục 2 của phase)
--
-- Owner đã quyết định KHÔNG tạo full production backup cho phase này.
-- File này thay thế bằng ảnh chụp kỹ thuật TỐI THIỂU, đúng phạm vi sắp sửa,
-- đủ để rollback thủ công từng hàm nếu cần.
--
-- TOÀN BỘ là SELECT. Không DDL, không DML. Không đọc token/secret.
-- Chạy TRƯỚC khi áp hotfix R1-0. Lưu output ra file JSON và giữ lại.
-- =====================================================================

-- ---------------------------------------------------------------------
-- P1. Định nghĩa hiện tại của mọi hàm sắp bị thay + hàm liên quan.
--     Cột `definition` chính là bản rollback thủ công.
-- ---------------------------------------------------------------------
select
  'P1_function_definitions' as probe,
  p.proname,
  pg_get_function_identity_arguments(p.oid)      as args,
  p.prosecdef                                     as security_definer,
  p.provolatile,
  p.proconfig                                     as config_search_path,
  pg_get_userbyid(p.proowner)                     as owner,
  md5(pg_get_functiondef(p.oid))                  as definition_md5,
  pg_get_functiondef(p.oid)                       as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    -- sẽ bị thay bởi hotfix R1-0
    'crm_current_user_role', 'crm_is_admin', 'crm_is_owner_or_admin', 'crm_is_manager',
    -- không bị thay nhưng phụ thuộc trực tiếp -> cần bằng chứng "không đổi"
    'crm_current_role', 'crm_current_app_user_id', 'crm_is_active_user',
    'crm_can_access_customer_id', 'crm_current_email', 'crm_auth_linked_app_user_id',
    -- sẽ được thêm bởi migration onboarding
    'crm_create_employee', 'crm_update_employee_profile',
    'crm_deactivate_employee', 'crm_reactivate_employee', 'crm_archive_employee',
    'crm_link_employee_auth_identity', 'crm_relink_employee_auth_identity'
  )
order by p.proname;

-- ---------------------------------------------------------------------
-- P2. Grants hiện tại của các hàm liên quan.
-- ---------------------------------------------------------------------
select
  'P2_function_grants' as probe,
  p.proname,
  pg_get_userbyid(a.grantee) as grantee,
  a.privilege_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
where n.nspname = 'public'
  and p.proname like 'crm_%'
order by p.proname, grantee;

-- ---------------------------------------------------------------------
-- P3. RLS policy hiện tại trên app_users (migration sẽ gỡ 2 policy INSERT).
--     Đây là bản rollback thủ công cho các policy đó.
-- ---------------------------------------------------------------------
select 'P3_app_users_policies' as probe,
       policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'app_users'
order by cmd, policyname;

-- ---------------------------------------------------------------------
-- P4. Trigger + index định danh (phải KHÔNG đổi sau rollout).
-- ---------------------------------------------------------------------
select 'P4_triggers' as probe, tgname as name, tgenabled as detail
from pg_trigger where tgrelid = 'public.app_users'::regclass and not tgisinternal
union all
select 'P4_indexes', indexname, indexdef
from pg_indexes where schemaname = 'public' and tablename = 'app_users';

-- ---------------------------------------------------------------------
-- P5. Inventory định danh tổng quát (không lộ secret).
-- ---------------------------------------------------------------------
select
  'P5_identity_inventory' as probe,
  (select count(*) from public.app_users)                                          as app_users_total,
  (select count(*) from public.app_users where supabase_auth_id is not null)        as linked,
  (select count(*) from public.app_users where supabase_auth_id is null)            as unlinked,
  (select count(*) from public.app_users where coalesce(active,false)
     and lower(coalesce(lifecycle_status,'')) = 'active')                           as active_employees,
  (select count(*) from public.app_users where lower(coalesce(lifecycle_status,'')) = 'inactive') as inactive_employees,
  (select count(*) from public.app_users where lower(coalesce(lifecycle_status,'')) = 'archived') as archived_employees,
  (select count(*) from auth.users where deleted_at is null)                        as auth_users_total,
  (select count(*) from (
      select supabase_auth_id from public.app_users
      where supabase_auth_id is not null
      group by supabase_auth_id having count(*) > 1) d)                             as duplicate_auth_mapping,
  (select count(*) from (
      select lower(btrim(email)) from public.app_users
      group by 1 having count(*) > 1) d)                                            as duplicate_app_email;

-- ---------------------------------------------------------------------
-- P6. Ma trận định danh từng nhân viên — phân loại mục 39.
--     Đây là danh sách "affected employee identity rows".
-- ---------------------------------------------------------------------
select
  'P6_employee_identity_matrix' as probe,
  u.id            as app_user_id,
  u.email,
  u.role,
  u.active,
  u.lifecycle_status,
  u.supabase_auth_id,
  a.id            as candidate_auth_user_id,
  a.last_sign_in_at,
  case
    when (select count(*) from public.app_users d
          where lower(btrim(d.email)) = lower(btrim(u.email))) > 1
      or (select count(*) from auth.users d
          where d.deleted_at is null
            and lower(btrim(d.email)) = lower(btrim(u.email))) > 1  then 'E_DUPLICATE_AMBIGUOUS'
    when u.supabase_auth_id is null and a.id is null                then 'F_AUTH_USER_NOT_FOUND'
    when u.supabase_auth_id is null                                 then 'A_NEW_NULL_NOT_LINKED'
    when u.supabase_auth_id = a.id                                  then 'C_CANONICAL'
    when not exists (select 1 from auth.users x
                     where x.id = u.supabase_auth_id and x.deleted_at is null)
                                                                    then 'B_RETURNING_STALE_AUTH'
    else                                                                 'D_EMAIL_MISMATCH'
  end as classification
from public.app_users u
left join auth.users a
  on a.deleted_at is null
 and lower(btrim(coalesce(a.email,''))) = lower(btrim(coalesce(u.email,'')))
order by classification, u.email;

-- ---------------------------------------------------------------------
-- P7. Số đếm nghiệp vụ theo nhân viên — mốc so sánh cho mục 42/43.
-- ---------------------------------------------------------------------
select
  'P7_business_reference_counts' as probe,
  u.id as app_user_id,
  u.email,
  (select count(*) from public.customer_assignments a where a.employee_id = u.id)                    as assignments_total,
  (select count(*) from public.customer_assignments a where a.employee_id = u.id and a.is_current)   as assignments_current,
  (select count(*) from public.customers c where c.owner_user_id = u.id)                             as customers_owned_cache,
  (select count(*) from public.kpi_assignments k where k.employee_id = u.id)                         as kpi_assignments,
  (select count(*) from public.audit_logs l where l.entity_id = u.id)                                as audit_rows
from public.app_users u
order by u.email;

-- ---------------------------------------------------------------------
-- P8. Bằng chứng phiên bản: migration/ledger đã chạy trước đó.
-- ---------------------------------------------------------------------
select 'P8_identity_ledger' as probe, operation, target_app_user_id,
       previous_auth_id, new_auth_id, reason, created_at
from public.identity_link_requests
order by created_at desc
limit 30;

select 'P8_identity_audits' as probe, action, entity_id, created_at
from public.audit_logs
where action in ('createEmployee','linkEmployeeAuthIdentity','relinkEmployeeAuthIdentity',
                 'reactivateEmployee','deactivateEmployee','archiveEmployee')
order by created_at desc
limit 50;
