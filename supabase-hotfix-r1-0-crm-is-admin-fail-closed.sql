-- =====================================================================
-- HOTFIX R1-0 — Authorization guards must fail CLOSED
-- Repository : D:\SUPABASE\CRM-KOLORCERAMIC
-- Target     : PRODUCTION jjeeazwlqcwynzquimeo
-- Scope      : SECURITY ONLY. Không chứa onboarding, self-claim, rehire,
--              relink, UX hay bất kỳ thay đổi nghiệp vụ nào.
--
-- VẤN ĐỀ
--   public.crm_current_user_role() là scalar subquery trên app_users. Khi
--   caller không có row app_users ACTIVE, subquery không trả dòng nào và hàm
--   trả về NULL (không phải '').
--
--   public.crm_is_admin()   = (NULL in ('owner','admin'))  => NULL
--   public.crm_is_manager() = (NULL in (...))              => NULL
--
--   Mọi privileged RPC tự bảo vệ bằng:
--       if not public.crm_is_admin() then raise ... end if;
--   Trong PostgreSQL `if NULL then` KHÔNG vào nhánh, nên guard im lặng
--   không kích hoạt => FAIL-OPEN.
--
-- PHẠM VI ẢNH HƯỞNG ĐÃ AUDIT (20 điểm)
--   16 x  if not public.crm_is_admin() / crm_is_manager()
--          (supabase-phase-p0a-transaction-ownership.sql,
--           supabase-phase-p0b-employee-assignment.sql)
--    3 x  if not public.crm_can_access_customer_id(...)
--          crm_can_access_customer_id = crm_is_manager() OR exists(...)
--          NULL or false => NULL => fail-open trên dữ liệu KHÁCH HÀNG
--    1 x  crm_deactivate_employee: `... and crm_current_user_role() <> 'owner'`
--          true and NULL => NULL => bỏ qua bảo vệ "chỉ owner được ngừng
--          admin/owner"
--
--   KHÔNG bị ảnh hưởng (đã kiểm chứng):
--     crm_is_active_user()  -> `crm_current_app_user_id() is not null`
--                              luôn trả boolean, không bao giờ NULL.
--     `if public.crm_is_manager() then ...` (nhánh dương, p0a:293, p0b:1008)
--                              NULL => không vào nhánh => đi đường hạn chế
--                              hơn => an toàn sẵn.
--
-- CÁCH VÁ
--   Vá tại tầng helper dùng chung. Không sửa 20 RPC. Không sửa RLS policy.
--   Không đổi ngữ nghĩa phân quyền: danh sách role giữ nguyên đúng như bản
--   đang chạy (supabase-phase-f-crm-rls-cleanup.sql cho 3 hàm boolean,
--   supabase-phase-auth-identity-linking-repair.sql cho crm_current_user_role).
--
--   Với RLS policy, NULL vốn đã bị coi là not-true, nên chuyển NULL -> false/''
--   là SIẾT CHẶT hoặc tương đương, không bao giờ nới lỏng.
--
-- KHÔNG đụng tới: grants (create or replace giữ nguyên grant hiện có),
--   signature, search_path, security definer/invoker, RLS, dữ liệu.
--   Không có một câu DML nào.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Precondition — chỉ chạy nếu đang đúng nền tảng mong đợi.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.crm_current_app_user_id()') is null then
    raise exception 'PRECONDITION_FAIL: crm_current_app_user_id() không tồn tại. Sai database hoặc thiếu identity phase.';
  end if;
  if to_regprocedure('public.crm_current_user_role()') is null
     or to_regprocedure('public.crm_is_admin()') is null
     or to_regprocedure('public.crm_is_manager()') is null
     or to_regprocedure('public.crm_is_owner_or_admin()') is null then
    raise exception 'PRECONDITION_FAIL: thiếu một trong các helper phân quyền.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. crm_current_user_role() — không bao giờ trả NULL.
--    Giữ NGUYÊN thân hàm của identity phase: phân giải qua UUID bridge
--    (crm_current_app_user_id), KHÔNG dùng email. Chỉ bọc coalesce.
--    Giữ nguyên security definer + search_path = public.
-- ---------------------------------------------------------------------
create or replace function public.crm_current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select lower(coalesce(u.role, ''))
    from public.app_users u
    where u.id = public.crm_current_app_user_id()
    limit 1
  ), '');
$$;

-- ---------------------------------------------------------------------
-- 2. crm_is_admin() — fail closed.
--    Danh sách role giữ nguyên: owner, admin.
-- ---------------------------------------------------------------------
create or replace function public.crm_is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(public.crm_current_user_role() in ('owner', 'admin'), false);
$$;

-- ---------------------------------------------------------------------
-- 3. crm_is_owner_or_admin() — fail closed. Vẫn ủy quyền cho crm_is_admin().
-- ---------------------------------------------------------------------
create or replace function public.crm_is_owner_or_admin()
returns boolean
language sql
stable
as $$
  select coalesce(public.crm_is_admin(), false);
$$;

-- ---------------------------------------------------------------------
-- 4. crm_is_manager() — fail closed.
--    Danh sách role giữ NGUYÊN đúng bản đang chạy:
--    owner, admin, manager, quanly, quản lý, quản lí.
--    Việc này cũng vá gián tiếp crm_can_access_customer_id().
-- ---------------------------------------------------------------------
create or replace function public.crm_is_manager()
returns boolean
language sql
stable
as $$
  select coalesce(
    public.crm_current_user_role() in ('owner', 'admin', 'manager', 'quanly', 'quản lý', 'quản lí'),
    false);
$$;

-- ---------------------------------------------------------------------
-- 5. Tự kiểm chứng NGAY trong transaction.
--    Mô phỏng caller không có app_users row bằng cách đặt auth.uid() về một
--    UUID không tồn tại. Nếu bất kỳ hàm nào còn trả NULL -> rollback.
--
--    Lưu ý: khối này chỉ ĐỌC. Không ghi gì.
-- ---------------------------------------------------------------------
do $$
declare
  v_probe uuid := gen_random_uuid();   -- UUID chắc chắn không có trong app_users
  v_role text;
  v_admin boolean;
  v_manager boolean;
  v_owner_admin boolean;
  v_access boolean;
  v_uid_switched boolean;
begin
  -- Bất biến 1 — đúng với MỌI caller, không phụ thuộc danh tính đang gọi:
  -- không hàm nào được phép trả NULL.
  if public.crm_current_user_role() is null then
    raise exception 'HOTFIX_VERIFY_FAIL: crm_current_user_role() vẫn trả NULL.';
  end if;
  if public.crm_is_admin() is null then
    raise exception 'HOTFIX_VERIFY_FAIL: crm_is_admin() vẫn trả NULL.';
  end if;
  if public.crm_is_manager() is null then
    raise exception 'HOTFIX_VERIFY_FAIL: crm_is_manager() vẫn trả NULL.';
  end if;
  if public.crm_is_owner_or_admin() is null then
    raise exception 'HOTFIX_VERIFY_FAIL: crm_is_owner_or_admin() vẫn trả NULL.';
  end if;

  -- Bất biến 2 — giả lập caller đã xác thực nhưng KHÔNG có hồ sơ nhân viên,
  -- bằng cách gán claim `sub` ở phạm vi transaction (tự huỷ khi commit).
  perform set_config('request.jwt.claim.sub', v_probe::text, true);
  v_uid_switched := (auth.uid() = v_probe);

  if v_uid_switched then
    v_role        := public.crm_current_user_role();
    v_admin       := public.crm_is_admin();
    v_manager     := public.crm_is_manager();
    v_owner_admin := public.crm_is_owner_or_admin();
    v_access      := public.crm_can_access_customer_id('__hotfix_probe_nonexistent__');

    if v_role is null or v_role <> '' then
      raise exception 'HOTFIX_VERIFY_FAIL: crm_current_user_role() = % (mong đợi chuỗi rỗng).', coalesce(v_role, 'NULL');
    end if;
    if v_admin is distinct from false then
      raise exception 'HOTFIX_VERIFY_FAIL: crm_is_admin() = % (mong đợi false).', coalesce(v_admin::text, 'NULL');
    end if;
    if v_manager is distinct from false then
      raise exception 'HOTFIX_VERIFY_FAIL: crm_is_manager() = % (mong đợi false).', coalesce(v_manager::text, 'NULL');
    end if;
    if v_owner_admin is distinct from false then
      raise exception 'HOTFIX_VERIFY_FAIL: crm_is_owner_or_admin() = % (mong đợi false).', coalesce(v_owner_admin::text, 'NULL');
    end if;
    if v_access is distinct from false then
      raise exception 'HOTFIX_VERIFY_FAIL: crm_can_access_customer_id() = % (mong đợi false).', coalesce(v_access::text, 'NULL');
    end if;
    raise notice 'HOTFIX_R1_0_VERIFY_PASS: guard fail-closed với caller đã xác thực nhưng không có hồ sơ.';
  else
    -- auth.uid() không đọc claim `sub` theo cách này ở bản Supabase hiện tại.
    -- Bất biến 1 vẫn đã được chứng minh; phần còn lại kiểm bằng negative smoke
    -- ở mục 11 của phase.
    raise notice 'HOTFIX_R1_0_VERIFY_PARTIAL: không mô phỏng được auth.uid(); đã chứng minh không-NULL. Bắt buộc chạy negative smoke bằng phiên thật.';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

commit;

-- =====================================================================
-- READ-BACK (chạy RIÊNG sau khi commit, chỉ đọc)
-- =====================================================================
-- select p.proname,
--        pg_get_function_identity_arguments(p.oid) as args,
--        p.prosecdef as security_definer,
--        p.provolatile,
--        md5(pg_get_functiondef(p.oid)) as def_md5,
--        pg_get_functiondef(p.oid) as definition
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('crm_current_user_role','crm_is_admin',
--                     'crm_is_owner_or_admin','crm_is_manager',
--                     'crm_can_access_customer_id','crm_is_active_user')
-- order by p.proname;
--
-- select p.proname, r.grantee, r.privilege_type
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
-- join lateral (select pg_get_userbyid(a.grantee) as grantee,
--                      a.privilege_type) r on true
-- where n.nspname = 'public'
--   and p.proname in ('crm_current_user_role','crm_is_admin',
--                     'crm_is_owner_or_admin','crm_is_manager')
-- order by p.proname, r.grantee;
