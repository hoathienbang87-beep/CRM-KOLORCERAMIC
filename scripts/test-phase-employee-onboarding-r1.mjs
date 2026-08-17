// EMPLOYEE-ONBOARDING-R1 — static contract gate.
// Chạy: node scripts/test-phase-employee-onboarding-r1.mjs
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sql = fs.readFileSync(path.join(root, "supabase-phase-employee-onboarding-r1-prod.sql"), "utf8");
const hotfix = fs.readFileSync(path.join(root, "supabase-hotfix-r1-0-crm-is-admin-fail-closed.sql"), "utf8");
const app = fs.readFileSync(path.join(root, "js", "features", "crm-app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

let failures = 0;
function check(condition, message) {
  if (condition) console.log(`PASS: ${message}`);
  else { failures += 1; console.error(`FAIL: ${message}`); }
}

// ---- Identity contract is not weakened -------------------------------
check(!/drop\s+policy[\s\S]{0,80}on\s+public\.customers/i.test(sql), "Migration does not touch customer RLS.");
check(!/alter\s+table[\s\S]{0,40}disable\s+row\s+level\s+security/i.test(sql), "Migration never disables RLS.");
check(!/update\s+auth\.users|delete\s+from\s+auth\.users|insert\s+into\s+auth\.users/i.test(sql), "Migration never mutates Auth users.");
check(!/create or replace function public\.crm_current_app_user_id/i.test(sql), "Runtime identity resolver is left unchanged.");
check(!/create or replace function public\.crm_is_active_user/i.test(sql), "crm_is_active_user() is left unchanged.");
check(!/create or replace function public\.crm_link_employee_auth_identity/i.test(sql), "Operator LINK RPC is not modified.");
check(!/create or replace function public\.crm_relink_employee_auth_identity\s*\(/i.test(sql), "Operator RELINK RPC is not modified.");
check(!/drop trigger[\s\S]{0,60}app_users_guard_lifecycle_change/i.test(sql), "Lifecycle guard trigger is preserved.");
check(!/drop index[\s\S]{0,80}app_users_supabase_auth_id_unique_idx/i.test(sql), "Partial unique index on supabase_auth_id is preserved.");

// ---- R1-0 hotfix is isolated and fail-closed --------------------------
check(/create or replace function public\.crm_is_admin\(\)[\s\S]*?coalesce\(/i.test(hotfix), "Hotfix: crm_is_admin() is NULL-safe.");
check(/create or replace function public\.crm_is_manager\(\)[\s\S]*?coalesce\(/i.test(hotfix), "Hotfix: crm_is_manager() is NULL-safe.");
check(/create or replace function public\.crm_is_owner_or_admin\(\)[\s\S]*?coalesce\(/i.test(hotfix), "Hotfix: crm_is_owner_or_admin() is NULL-safe.");
check(/create or replace function public\.crm_current_user_role\(\)[\s\S]*?coalesce\(\(/i.test(hotfix), "Hotfix: crm_current_user_role() never returns NULL.");
check(/'owner', 'admin'\)/i.test(hotfix), "Hotfix preserves the admin role list.");
check(/'owner', 'admin', 'manager', 'quanly'/i.test(hotfix), "Hotfix preserves the manager role list.");
check(/security definer[\s\S]{0,60}set search_path = public/i.test(hotfix), "Hotfix preserves security definer + search_path on crm_current_user_role.");
check(!/insert into|update .*set|delete from/i.test(hotfix.replace(/--[^\n]*/g, "")), "Hotfix contains no DML.");
check(!/drop policy|create policy|alter table/i.test(hotfix), "Hotfix touches no RLS or table structure.");
check(/HOTFIX_VERIFY_FAIL/i.test(hotfix) && /HOTFIX_R1_0_VERIFY_PASS/i.test(hotfix), "Hotfix self-verifies inside its transaction.");

// ---- Onboarding migration must NOT duplicate R1-0 and must require it --
check(!/create or replace function public\.crm_is_admin\(\)/i.test(sql), "Onboarding migration does not redefine crm_is_admin().");
check(!/create or replace function public\.crm_is_manager\(\)/i.test(sql), "Onboarding migration does not redefine crm_is_manager().");
check(!/create or replace function public\.crm_current_user_role\(\)/i.test(sql), "Onboarding migration does not redefine crm_current_user_role().");
check(/PRECONDITION_FAIL[\s\S]{0,200}hotfix-r1-0/i.test(sql), "Onboarding migration refuses to install unless the R1-0 hotfix is live.");

// ---- R1-1 first-login self-claim -------------------------------------
const claim = sql.match(/create or replace function public\.crm_claim_employee_identity_on_first_login\(\)[\s\S]*?\$\$;/i)?.[0] || "";
check(claim.length > 0, "First-login claim RPC exists.");
check(/^create or replace function public\.crm_claim_employee_identity_on_first_login\(\)/i.test(claim), "First-login claim RPC takes no client parameters.");
check(/from auth\.users where id = auth\.uid\(\)/i.test(claim), "Claim reads the email from auth.users, not from the JWT claim.");
check(/email_confirmed_at is null/i.test(claim), "Claim requires a confirmed Auth email.");
check(/is_anonymous/i.test(claim) && /banned_until/i.test(claim), "Claim rejects anonymous and banned Auth users.");
check(/lower\(coalesce\(v_target\.role, ''\)\) <> 'sale'/i.test(claim), "Claim is limited to the Sale role.");
check(/if v_target\.supabase_auth_id is not null then[\s\S]{0,220}RETURNING_EMPLOYEE_RELINK_REQUIRED/i.test(claim), "Claim never overwrites a non-null mapping.");
check(/v_app_email_count > 1 or v_auth_email_count <> 1/i.test(claim), "Claim fails closed on duplicate email on either side.");
check(/v_identity_count <> v_provider_count/i.test(claim), "Claim rejects duplicated provider identities.");
check(/AUTH_ALREADY_MAPPED/i.test(claim), "Claim rejects an Auth UUID already mapped elsewhere.");
check(/pg_advisory_xact_lock/i.test(claim) && /for update/i.test(claim), "Claim uses advisory and row locks.");
check(/md5\('crm:firstlogin:'/i.test(claim), "Claim uses a deterministic request id so replays collapse.");
check(/insert into public\.identity_link_requests/i.test(claim), "Claim writes the identity ledger.");
check(/crm_write_audit\('linkEmployeeAuthIdentity'/i.test(claim), "Claim writes a mandatory audit row.");
check(/set_config\('crm\.allow_identity_write', 'on', true\)/i.test(claim), "Claim goes through the sanctioned identity-write switch.");

// ---- R1-2 returning employee relink ----------------------------------
const relink = sql.match(/create or replace function public\.crm_relink_returning_employee_identity[\s\S]*?\$\$;/i)?.[0] || "";
check(relink.length > 0, "Returning-employee RELINK RPC exists.");
check(/not in \('owner', 'admin'\)[\s\S]{0,200}RETURNING_RELINK_FORBIDDEN/i.test(relink), "Returning RELINK requires an owner/admin actor.");
check(/<> 'sale'[\s\S]{0,220}RETURNING_RELINK_TARGET_NOT_ELIGIBLE/i.test(relink), "Returning RELINK is limited to Sale targets.");
check(/RETURNING_RELINK_MAPPING_IS_NULL/i.test(relink), "Returning RELINK refuses a NULL mapping.");
check(/RETURNING_RELINK_LIFECYCLE_REQUIRED/i.test(relink), "Returning RELINK requires lifecycle reactivation first.");
check(/IDENTITY_EXISTING_MAPPING_VALID/i.test(relink), "Returning RELINK refuses to run while the old Auth user still exists.");
check(/IDENTITY_EMAIL_DISCOVERY_MISMATCH/i.test(relink), "Returning RELINK enforces email match.");
check(/IDENTITY_AUTH_ALREADY_MAPPED/i.test(relink), "Returning RELINK rejects an already-mapped replacement.");
check(/IDENTITY_REQUEST_PAYLOAD_CONFLICT/i.test(relink), "Returning RELINK is idempotent and rejects payload drift.");
check(/crm_write_audit\('relinkReturningEmployeeAuthIdentity'/i.test(relink), "Returning RELINK writes its own audit action.");

// ---- R1-3 archived restore -------------------------------------------
const restore = sql.match(/create or replace function public\.crm_restore_archived_employee[\s\S]*?\$\$;/i)?.[0] || "";
check(restore.length > 0, "Archived-restore RPC exists (rehire path).");
check(/<> 'owner'/i.test(restore), "Archived restore is owner-only.");
check(/lifecycle_status = 'inactive'/i.test(restore) && !/lifecycle_status = 'active'/i.test(restore), "Archived restore goes to INACTIVE, not straight to ACTIVE.");
check(/crm\.allow_employee_lifecycle/i.test(restore), "Archived restore uses the sanctioned lifecycle switch.");
check(!/delete from public\.app_users/i.test(sql), "Migration never deletes an employee row.");

// ---- R1-4 admin status ------------------------------------------------
const status = sql.match(/create or replace function public\.crm_employee_identity_status\(\)[\s\S]*?\$\$;/i)?.[0] || "";
check(/crm_is_admin/i.test(status), "Identity status function is admin-gated.");
check(!/encrypted_password|confirmation_token|recovery_token/i.test(sql), "Migration never reads Auth secrets.");

// ---- Frontend ---------------------------------------------------------
check(!/await setDoc\(ref, data\)/.test(app), "Frontend self-create shell insert is removed.");
check(/crm_claim_employee_identity_on_first_login/.test(app), "Frontend calls the first-login resolver.");
check(/crm_claim_employee_identity_on_first_login",\s*\{\}\)/.test(app), "Frontend sends no employee/auth parameters on first login.");
check(/if \(err\?\.onboardingCode\) return err\.message;/.test(app), "Onboarding failures bypass the generic RLS message (GAP-1).");
check(/Email này chưa được cấp quyền sử dụng CRM/.test(app), "NO_EMPLOYEE_PROFILE has a business message.");
check(/Tài khoản nhân viên cũ cần được xác nhận lại/.test(app), "RETURNING_EMPLOYEE_RELINK_REQUIRED has a business message.");
check(/Bạn chưa có quyền đọc\/ghi Supabase/.test(app), "The generic RLS message is retained for genuine RLS errors.");
check(/crm_employee_identity_status/.test(app), "Admin UI loads onboarding status.");
check(/data-relink-user/.test(app), "Admin UI exposes a relink action.");
check(/Chờ đăng nhập lần đầu/.test(app), "Admin UI shows the awaiting-first-login state.");
check(!/supabase_auth_id\s*:/.test(app), "Frontend never writes supabase_auth_id directly.");
check(!/Supabase Auth tự tạo phiên đăng nhập/.test(html), "Misleading Admin onboarding copy is removed (GAP-2).");
check(/hoàn tất liên kết tài khoản trong lần đăng nhập đầu tiên/.test(html), "Admin onboarding copy describes the real workflow.");

if (failures) {
  console.error(`EMPLOYEE-ONBOARDING-R1 static gate failed: ${failures} check(s).`);
  process.exit(1);
}
console.log("EMPLOYEE-ONBOARDING-R1 static gate passed.");
