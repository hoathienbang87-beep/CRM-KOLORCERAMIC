# EMPLOYEE-ONBOARDING-R1 — New Employee First Login + Returning Employee Relink

Ngày thực hiện: 2026-08-17
Repository: `D:\SUPABASE\CRM-KOLORCERAMIC`
Production: `jjeeazwlqcwynzquimeo` · Domain: `https://crmkolor.vercel.app/`

---

## ⚠️ CẢNH BÁO BẢO MẬT — ĐỌC TRƯỚC

Trong lúc test phase này tôi phát hiện và **tái hiện được** một lỗ hổng leo thang đặc quyền **đã tồn tại sẵn trong production**, không phải do phase này tạo ra.

`crm_is_admin()` trả về `NULL` (không phải `false`) với bất kỳ user đã đăng nhập nào không có row `app_users` ACTIVE. Toàn bộ RPC đặc quyền tự bảo vệ bằng:

```sql
if not public.crm_is_admin() then raise exception ... end if;
```

`if NULL then` **không vào nhánh**. Guard im lặng không kích hoạt. Có **17 call site** dính pattern này trong `supabase-phase-p0a-transaction-ownership.sql` và `supabase-phase-p0b-employee-assignment.sql`, gồm `crm_create_employee`, `crm_update_employee_profile`, `crm_deactivate_employee`, `crm_reactivate_employee`, `crm_archive_employee`.

Bằng chứng tái hiện (harness cục bộ, copy nguyên văn function body từ repo):

```
NOTICE:  is_admin before: NULL
NOTICE:  crm_create_employee SUCCEEDED as a non-employee: {"id": "evil-1", ...}
NOTICE:  self-claim: LINKED
NOTICE:  resolved app user: evil-1, role: sale
NOTICE:  crm_is_active_user: t
```

**Mức độ hiện tại (production, trước phase này):** bất kỳ ai đăng nhập Google được vào domain đều có thể tạo/sửa/ngừng/lưu trữ row `app_users`. Chưa lấy được quyền đọc dữ liệu CRM vì `supabase_auth_id` vẫn NULL nên RLS vẫn chặn. Mức độ: **cao** (ghi trái phép vào bảng nhân viên, chiếm chỗ email, phá vòng đời nhân viên).

**Mức độ nếu triển khai R1-1 mà chưa vá:** thành **nghiêm trọng** — người ngoài tự tạo hồ sơ Sale cho chính email mình rồi self-claim, có ngay tài khoản Sale hoạt động đầy đủ.

Vì vậy bản vá được đưa vào **cùng migration** (mục R1-0) và là điều kiện tiên quyết bắt buộc. Không được deploy R1-1 nếu không có R1-0.

---

## 1. Kết luận

**EMPLOYEE-ONBOARDING-R1 PARTIAL — NEW EMPLOYEE FLOW READY, RETURNING EMPLOYEE RELINK REQUIRES MANUAL REVIEW**

Trạng thái chi tiết:

| Hạng mục | Trạng thái |
|---|---|
| Thiết kế + code backend (4 RPC + vá bảo mật) | **XONG** |
| Thiết kế + code frontend (resolver, error UX, Admin UI) | **XONG** |
| Static contract gate (57 check) | **PASS 57/57** |
| Integration test matrix (44 test, Postgres thật) | **PASS 44/44** |
| Áp dụng lên STAGING | **CHƯA** |
| Backup production | **CHƯA** |
| Áp dụng lên PRODUCTION | **CHƯA** |
| Repair nhân viên đang lỗi | **CHƯA** |
| Real-role smoke bằng login Google thật | **CHƯA** |

Lý do phần thực thi chưa làm: phiên này chạy trong cloud sandbox, **không có shell trên máy người dùng** (`device_bash` không tồn tại), nên không chạy được `npx supabase`, `psql`, `invoke-supabase-management-query.ps1`, không backup và không deploy được. **Không có thao tác ghi nào lên production hay staging trong phiên này.**

Bù lại, toàn bộ logic backend đã được kiểm chứng thật trên PostgreSQL 16 cục bộ với harness dựng lại đúng schema/trigger/guard/RPC từ repo — không phải chỉ review bằng mắt.

"RETURNING EMPLOYEE RELINK REQUIRES MANUAL REVIEW" là **thiết kế có chủ đích**, đúng mục 32: mapping stale không bao giờ bị ghi đè tự động; hệ thống phát hiện → gắn cờ → Admin xác nhận.

## 2. Root cause hiện tại

**CASE A — nhân viên mới.** `crm_create_employee` không set `supabase_auth_id`; không có trigger auto-link; không có UI nào gọi `crm_link_employee_auth_identity`. Sau khi login Google, `fetchRef` tra `app_users` theo `supabase_auth_id` (`js/firebase.js:491`) nên luôn trượt, `loadAppUser` rơi vào nhánh self-create shell insert, insert bị chặn, lỗi bị `authMessage` (`crm-app.js:519`) map thành thông báo RLS chung. `crm_current_app_user_id()` = NULL → `crm_is_active_user()` = false → RLS từ chối đúng đặc tả. **RLS không phải root cause.**

**CASE B — nhân viên cũ quay lại.** `app_users.supabase_auth_id` trỏ OLD Auth UUID đã bị xóa. Login lại tạo NEW UUID. Không có đường nào nối NEW UUID vào row cũ:

- `crm_relink_employee_auth_identity` chỉ nhận target `role in ('admin','owner')` → **không dùng được cho Sale**.
- `crm_reactivate_employee` từ chối row `ARCHIVED` và **không tồn tại RPC unarchive nào** → nhân viên đã archive không có đường quay lại hợp lệ.

Đây là hai blocker thật, đã xác minh bằng đọc source và bằng test.

## 3. Identity contract

Không thay đổi:

```
auth.users.id  →  app_users.supabase_auth_id  →  app_users.id
```

- `app_users.id` là business identity, **ổn định vĩnh viễn**, không bao giờ đổi khi Auth UUID đổi.
- Email chỉ là **discovery**. Authority cuối cùng vẫn là `auth.uid()` đã được ghi vào `supabase_auth_id`.
- `crm_current_app_user_id()`, `crm_is_active_user()`, `crm_link_employee_auth_identity()`, `crm_relink_employee_auth_identity()`, hai trigger guard và partial unique index: **giữ nguyên, không sửa** (static gate có check khẳng định điều này).

## 4. New employee flow

```
Admin tạo hồ sơ (crm_create_employee)      → app_users, supabase_auth_id = NULL
Nhân viên login Google đúng email           → auth.users được tạo, email confirmed
Frontend tra theo supabase_auth_id → trượt  → gọi crm_claim_employee_identity_on_first_login()
Server tự resolve và LINK                   → supabase_auth_id = auth.uid()
Frontend đọc lại canonical app user         → vào CRM bình thường (empty state nếu chưa có dữ liệu)
Manager phân công khách hàng / gán KPI      → bước nghiệp vụ riêng
```

RPC `crm_claim_employee_identity_on_first_login()` **không nhận tham số nào**. Client không thể chỉ định `employee_id` hay `auth_uuid`. Server đọc email từ `auth.users` (không dùng claim `auth.email()` trong JWT) rồi tự tìm hồ sơ. Đây chính là yêu cầu "server-authoritative" ở mục 5.

Điều kiện bắt buộc để LINK (fail closed nếu thiếu bất kỳ điều nào):

- `auth.uid()` khác NULL, Auth user không deleted/anonymous/banned, `email_confirmed_at` khác NULL
- `identity_count >= 1` và `identity_count = provider_count`
- đúng **1** row `app_users` khớp email chuẩn hóa, và đúng **1** row `auth.users` khớp email
- `supabase_auth_id IS NULL`
- `role = 'sale'`
- `active = true` và `lifecycle_status = 'active'`
- Auth UUID chưa được map cho nhân viên khác

## 5. Returning employee flow

```
Nhân viên cũ login Google lại
  → self-claim phát hiện mapping non-null, TỪ CHỐI ghi đè
  → trả RETURNING_EMPLOYEE_RELINK_REQUIRED
Admin mở trang Người dùng
  → thấy badge "Cần liên kết lại"
  → (nếu ARCHIVED) Owner: crm_restore_archived_employee  → INACTIVE
  → Admin: crm_reactivate_employee                        → ACTIVE
  → bấm "Liên kết lại đăng nhập"                          → crm_relink_returning_employee_identity
Nhân viên login lại                                        → dùng được CRM
Manager phân công khách hàng / KPI hiện tại                → quyết định nghiệp vụ riêng
```

`app_users.id` **không đổi** ở bất kỳ bước nào. Không tạo row mới. Không xóa gì.

## 6. Lifecycle handling

Contract hiện có (đã audit, giữ nguyên):

| Chuyển đổi | RPC | Actor |
|---|---|---|
| active → inactive | `crm_deactivate_employee` | owner/admin |
| inactive → active | `crm_reactivate_employee` | owner/admin |
| inactive → archived | `crm_archive_employee` | owner/admin |
| archived → * | **không tồn tại** | — |

Phase này bổ sung đúng một chuyển đổi còn thiếu:

| archived → inactive | `crm_restore_archived_employee` | **owner only** |

Cố ý bảo thủ hơn `crm_reactivate_employee`: chỉ owner, và chỉ về **INACTIVE** chứ không nhảy thẳng ACTIVE. Owner phải làm hai bước rõ ràng. `crm_guard_employee_lifecycle_change()` **không bị disable**; RPC mới dùng đúng switch `crm.allow_employee_lifecycle` như các RPC vòng đời khác.

## 7. Existing RPC audit

| RPC | Kết luận |
|---|---|
| `crm_create_employee` | Chỉ tạo `app_users`, không set `supabase_auth_id`. Guard admin bị bypass do NULL (xem cảnh báo đầu báo cáo). Không sửa logic, chỉ vá guard ở tầng helper. |
| `crm_link_employee_auth_identity` | Còn đúng và phù hợp. Actor phải owner/admin canonical hoặc `postgres`; target phải Sale, active, mapping NULL. Không dùng được cho self-claim vì actor là chính nhân viên → giữ nguyên, viết RPC riêng. |
| `crm_relink_employee_auth_identity` | Còn đúng cho Admin/Owner. **Không dùng được cho Sale** (`IDENTITY_TARGET_NOT_ELIGIBLE`). Giữ nguyên, không nới lỏng. |
| `crm_current_app_user_id` / `crm_is_active_user` | Đúng contract, chỉ dùng UUID bridge, không dùng email. Giữ nguyên. |
| `crm_current_user_role` / `crm_is_admin` / `crm_is_manager` | **Có lỗi NULL-propagation.** Vá ở R1-0. |
| `crm_reactivate_employee` / `crm_archive_employee` / `crm_deactivate_employee` | Đúng contract. Thiếu đường archived → inactive. |
| `identity_link_requests` + partial unique index + 2 trigger guard | Còn nguyên, còn hiệu lực. Test 37 khẳng định. |
| `loadAppUser()` | Self-create shell fallback vô dụng và có hại. Đã bỏ. |

## 8. Backend changes

Artifact: **`supabase-phase-employee-onboarding-r1-auth-identity.sql`**
SHA-256: `a3f6f52e8da6d63d7b099b4870148bb8bed20594585c6326daf2422292178eaf`
Một transaction duy nhất, không có business DML.

| Mã | Nội dung |
|---|---|
| **R1-0** | Vá NULL-safe cho `crm_current_user_role`, `crm_current_role`, `crm_is_admin`, `crm_is_owner_or_admin`, `crm_is_manager`. Sửa ở tầng helper nên bịt cả 17 call site cùng lúc. RLS policy không đổi hành vi (policy vốn coi NULL là not-true), nên đây là **siết chặt**, không nới lỏng. |
| **R1-1** | `crm_claim_employee_identity_on_first_login()` — self-claim, không tham số, chỉ NULL → non-null, chỉ Sale, fail closed. Ghi ledger + audit. `request_id` sinh tất định `md5('crm:firstlogin:'||app_user_id||':'||auth_uid)` nên gọi lặp/đồng thời gộp về đúng một bản ghi. |
| **R1-2** | `crm_relink_returning_employee_identity(...)` — RELINK cho Sale quay lại, actor owner/admin, giữ đủ mọi guard của RPC gốc, thêm điều kiện lifecycle phải ACTIVE trước. Audit action riêng `relinkReturningEmployeeAuthIdentity`. |
| **R1-3** | `crm_restore_archived_employee(...)` — archived → inactive, owner-only, bắt buộc có lý do, giữ nguyên `app_users.id`. |
| **R1-4** | `crm_employee_identity_status()` — read-only, admin-gated, phân loại `AWAITING_FIRST_LOGIN` / `READY_TO_LINK` / `LINKED` / `RELINK_REQUIRED` / `MAPPING_MISMATCH` / `AMBIGUOUS`. Không trả token/secret. |
| **R1-5** | Bỏ policy INSERT `app users self create inactive` và `app users create own inactive profile`. Đây là mặt DB của self-create shell vừa bị gỡ ở frontend, và là lỗ cho phép user bất kỳ insert vào `app_users`. `crm_create_employee` là SECURITY DEFINER nên không ảnh hưởng. **Siết chặt.** |

Rollback R1-5 nếu cần:

```sql
create policy "app users self create inactive" on public.app_users
for insert to authenticated
with check (
  lower(coalesce(email, '')) = public.crm_current_email()
  and coalesce(active, false) = false
  and lower(coalesce(lifecycle_status, 'inactive')) = 'inactive'
  and supabase_auth_id is null
);
```

Migration mở đầu bằng khối precondition: fail closed nếu thiếu `identity_link_requests`, partial unique index, hoặc hai trigger guard.

## 9. Frontend changes

Diff thực tế: **133 dòng** trong `js/features/crm-app.js`, **2 dòng** trong `index.html`. Line ending CRLF gốc được giữ nguyên.

| Vị trí | Thay đổi |
|---|---|
| `loadAppUser()` | Bỏ hoàn toàn self-create shell insert. Tra theo `supabase_auth_id`; trượt thì gọi `crm_claim_employee_identity_on_first_login()`; `LINKED`/`ALREADY_LINKED` thì đọc lại canonical row; còn lại ném `OnboardingIdentityError` mang mã trạng thái. |
| `ONBOARDING_MESSAGES` | Bảng thông báo nghiệp vụ tiếng Việt cho 10 mã trạng thái. |
| `authMessage()` | Thêm nhánh đầu tiên `if (err?.onboardingCode) return err.message;` — lỗi onboarding không còn rơi vào thông báo RLS chung. Nhánh RLS chung **giữ nguyên** cho lỗi RLS thật. |
| `refreshEmployeeIdentityStatus()` + `IDENTITY_STATUS_LABEL` + `identityStatusBadge()` | Nạp và hiển thị trạng thái liên kết trong trang Người dùng. |
| `relinkReturningEmployee()` | Gọi `crm_relink_returning_employee_identity` với `crypto.randomUUID()` làm request id. Chặn trước nếu chưa có Auth candidate hoặc lifecycle chưa ACTIVE. |
| `renderUserAdmin()` | Thêm badge trạng thái + nút "Liên kết lại đăng nhập" chỉ hiện khi `RELINK_REQUIRED`. |
| delegation click | Thêm `data-relink-user`. |
| `addUserAdmin()` | Toast mô tả đúng luồng thật. |
| `index.html` | Thay câu sai "Supabase Auth tự tạo phiên đăng nhập" bằng mô tả đúng + hướng dẫn nhân viên cũ quay lại. |

Frontend **không bao giờ** gửi `employee_id`/`auth_uuid` cho first-login, và **không bao giờ** ghi `supabase_auth_id` trực tiếp. Static gate có check khẳng định cả hai.

## 10. Error UX changes

| Mã | Thông báo cho người dùng |
|---|---|
| `NO_EMPLOYEE_PROFILE` | Email này chưa được cấp quyền sử dụng CRM. Vui lòng liên hệ quản lý. |
| `IDENTITY_NOT_LINKED` | Tài khoản của bạn chưa hoàn tất liên kết đăng nhập. Vui lòng liên hệ quản lý để hoàn tất. |
| `RETURNING_EMPLOYEE_RELINK_REQUIRED` | Tài khoản nhân viên cũ cần được xác nhận lại trước khi sử dụng CRM. Vui lòng liên hệ quản lý. |
| `PRIVILEGED_ROLE_MANUAL_LINK_REQUIRED` | Tài khoản quản trị cần được owner liên kết thủ công. Vui lòng liên hệ quản lý. |
| `EMPLOYEE_NOT_ELIGIBLE` | Hồ sơ nhân viên đang không hoạt động. Vui lòng liên hệ quản lý để mở lại tài khoản. |
| `EMAIL_MISMATCH` | Email đăng nhập không trùng với email nhân viên đã được đăng ký. |
| `IDENTITY_DISCOVERY_AMBIGUOUS` | Thông tin nhân viên đang bị trùng lặp nên chưa thể liên kết tài khoản. Vui lòng liên hệ quản lý. |
| `AUTH_NOT_USABLE` | Tài khoản Google chưa xác thực email hoặc đang bị khóa. |
| `AUTH_ALREADY_MAPPED` | Tài khoản Google này đã được liên kết với một nhân viên khác. |
| `NOT_AUTHENTICATED` | Phiên đăng nhập chưa hợp lệ. Vui lòng đăng nhập lại. |

Không lộ tên bảng, tên policy, mã lỗi Postgres cho người dùng thường. Chi tiết kỹ thuật chỉ ghi vào `console.warn`.

## 11. Security rules

- Email là **discovery**, `auth.uid()` là **authority**. Không policy nào được sửa để tin email.
- Email được đọc từ `auth.users` chứ không từ claim JWT — canonical hơn.
- Self-claim chỉ áp dụng cho `role = 'sale'`. Manager/Admin/Owner vẫn phải đi đường operator.
- Self-claim **không bao giờ** ghi đè mapping non-null (mục 32).
- Mọi mutation identity đều qua `crm.allow_identity_write` + ledger + audit. Update trực tiếp vẫn bị trigger chặn (test 37 khẳng định).
- R1-0 và R1-5 đều là siết chặt, không nới lỏng.
- Không có RPC nào đọc `encrypted_password`, `confirmation_token`, `recovery_token`.

## 12. Duplicate/email guards

Kiểm tra ở **cả hai phía**, trước khi lock, và fail closed:

```
count(app_users where lower(btrim(email)) = X) phải = 1
count(auth.users where deleted_at is null and lower(btrim(email)) = X) phải = 1
count(auth.identities where user_id = U) >= 1 và = count(distinct provider)
```

Sai bất kỳ điều nào → `IDENTITY_DISCOVERY_AMBIGUOUS`, không auto-merge, không mutation. Nhiều provider khác nhau trên cùng một Auth user (email + google) là hợp lệ; trùng provider thì không.

Ở tầng schema, `app_users_email_unique_idx on public.app_users(lower(email))` khiến trùng email trong `app_users` là bất khả thi (test 33.D khẳng định).

## 13. Staging tests

Chưa chạy trên staging Supabase. Đã chạy **thật** trên PostgreSQL 16 cục bộ với harness dựng lại schema, trigger, guard và RPC từ repo.

Artifact: `scripts/test-phase-employee-onboarding-r1-integration.sql` — **44/44 PASS**.

Ma trận mục 33 (nhân viên mới):

| Test | Kết quả |
|---|---|
| 33.A Admin tạo Sale → mapping NULL, lifecycle active | PASS |
| 33.B Login đúng email → LINKED, `app_users.id` giữ nguyên, đúng 1 ledger + 1 audit | PASS |
| 33.B2 Gọi lại → ALREADY_LINKED, vẫn 1 ledger row | PASS |
| 33.C Email không có hồ sơ → NO_EMPLOYEE_PROFILE, không mutation | PASS |
| 33.D Trùng email trong `app_users` → bị unique index chặn | PASS |
| 33.E Auth UUID đã dùng → không đụng row khác | PASS |
| 33.F Sau link, helper RLS resolve đúng Sale | PASS |
| 33.G Auth chưa confirm email → AUTH_NOT_USABLE, không mutation | PASS |
| 33.H Role admin → PRIVILEGED_ROLE_MANUAL_LINK_REQUIRED, không mutation | PASS |
| 33.I Nhân viên inactive → EMPLOYEE_NOT_ELIGIBLE, không mutation | PASS |

Ma trận mục 34 (nhân viên quay lại):

| Test | Kết quả |
|---|---|
| 34.A Inactive + Auth cũ còn sống → chỉ reactivate, mapping không đổi | PASS |
| 34.B Auth cũ bị xóa + login mới → self-claim từ chối ghi đè; reactivate rồi RELINK; `app_users.id` giữ nguyên; resolve canonical | PASS |
| 34.B2 RELINK khi Auth cũ còn tồn tại → `IDENTITY_EXISTING_MAPPING_VALID` | PASS |
| 34.C ARCHIVED: reactivate bị chặn → owner restore → INACTIVE → reactivate → ACTIVE, id giữ nguyên | PASS |
| 34.C2 Admin (không phải owner) gọi restore → bị từ chối | PASS |
| 34.D Stale UUID + email lệch → `IDENTITY_EMAIL_DISCOVERY_MISMATCH` | PASS |
| 34.E UUID mới đã map cho nhân viên khác → `IDENTITY_AUTH_ALREADY_MAPPED` | PASS |
| 34.G RELINK trên mapping NULL → `RETURNING_RELINK_MAPPING_IS_NULL` | PASS |
| 34.H RELINK khi còn INACTIVE → `RETURNING_RELINK_LIFECYCLE_REQUIRED` | PASS |
| 34.I RELINK nhắm role đặc quyền → `RETURNING_RELINK_TARGET_NOT_ELIGIBLE` | PASS |

Mục 35/36/37/39 và R1-0:

| Test | Kết quả |
|---|---|
| 35 Zero dữ liệu vẫn resolve identity active | PASS |
| 36 Owner canonical cũ không bị ảnh hưởng | PASS |
| 37 Partial unique index còn nguyên | PASS |
| 37 Hai trigger guard còn bật | PASS |
| 37 Policy self-create shell đã bị gỡ | PASS |
| 37 Update trực tiếp `supabase_auth_id` vẫn bị chặn | PASS |
| 39 RELINK/restore ghi đúng audit action riêng | PASS |
| 39 Ledger không chứa chuỗi giống token/secret | PASS |
| R1-0 `crm_is_admin`/`crm_is_manager` trả false, `crm_current_user_role` trả `''` | PASS |
| R1-0 Người ngoài không còn gọi được `crm_create_employee` và RPC vòng đời | PASS |
| R1-4 Phân loại trạng thái đúng; Sale bị từ chối đọc | PASS |

Static gate: `scripts/test-phase-employee-onboarding-r1.mjs` — **57/57 PASS**.

## 14. Concurrency

`request_id` tất định + `unique(actor_key, operation, request_id)` + `pg_advisory_xact_lock` trên request key, employee key và auth key + `for update` trên row target.

Test 38: gọi self-claim hai lần liên tiếp → `LINKED` rồi `ALREADY_LINKED`, đúng **1** ledger row, đúng **1** row có `supabase_auth_id` đó. Duplicate mapping = 0.

Hạn chế thành thật: đây là serialization trong cùng một session, **chưa phải test đa kết nối thật**. Test đồng thời thật (hai connection song song, và Admin RELINK trong lúc client LINK) phải chạy ở staging. Đã ghi vào checklist mục 16.

## 15. Production backup

**CHƯA THỰC HIỆN.** Bắt buộc trước khi ghi production, theo chuẩn `AUTH-IDENTITY-PRODUCTION-CONTROLLED-REPAIR-KPI2-UNBLOCK.md` mục 5:

- `roles.sql`, `schema.sql`, `data.sql`
- inventory identity `auth.users` ↔ `app_users`
- inventory vòng đời nhân viên
- số đếm tham chiếu khách hàng/assignment/KPI cho từng nhân viên sẽ đụng tới
- SHA256 của migration đóng băng
- không ghi secret vào report

## 16. Production rollout

Thứ tự bắt buộc, không được đảo:

1. Chạy `node scripts/test-phase-employee-onboarding-r1.mjs` → phải PASS 57/57.
2. Áp `supabase-phase-employee-onboarding-r1-auth-identity.sql` lên **staging**.
3. Chạy `scripts/test-phase-employee-onboarding-r1-integration.sql` trên staging → phải PASS 44/44.
4. Bổ sung test đồng thời đa kết nối trên staging (mục 14).
5. Regression staging: `test-phase-p0a/p0b/kpi1/kpi2/kpi2r2-staging-api.mjs` + `test-phase-auth-identity*.mjs`.
6. Smoke staging bằng login Google thật: nhân viên mới, nhân viên cũ quay lại, Sale/Manager/Admin hiện có.
7. Backup production (mục 15).
8. Áp migration lên production bằng `psql -X -v ON_ERROR_STOP=1`, xác nhận marker `COMMIT` và SHA256 khớp.
9. Verify cấu trúc: 4 RPC mới tồn tại, helper đã NULL-safe, index/trigger còn nguyên, policy shell đã gỡ.
10. Deploy frontend, xác nhận commit GitHub và bản Vercel đang phục vụ `https://crmkolor.vercel.app/`.
11. Inventory read-only phân loại nhân viên (mục 18).
12. Repair từng người một (mục 17, 18).
13. Real-role smoke (mục 19).

**Không được** deploy frontend trước migration: `loadAppUser` sẽ gọi một RPC chưa tồn tại và mọi nhân viên chưa link sẽ nhận `IDENTITY_NOT_LINKED` thay vì được link.

## 17. Current new employee repair

Sau khi migration + frontend lên production, nhân viên mới đang lỗi **tự khỏi** ngay lần đăng nhập Google kế tiếp, với điều kiện diagnosis xác nhận:

- `supabase_auth_id IS NULL`
- email `app_users` khớp chính xác email `auth.users`
- không trùng email cả hai phía
- `role = 'sale'`, `active = true`, `lifecycle_status = 'active'`

Nếu diagnosis cho kết quả khác → **dừng**, xử lý theo mục 18. Dùng `scripts/diagnose-new-employee-auth-identity.sql` (đã bàn giao ở phase trước) để phân loại trước.

## 18. Returning employee repair inventory

Đọc read-only trước, phân loại từng người theo mục 40:

| Lớp | Xử lý |
|---|---|
| A `NEW_NULL_NOT_LINKED` | Tự khỏi khi nhân viên login (mục 17) |
| B `RETURNING_STALE_AUTH` | (nếu ARCHIVED) owner restore → admin reactivate → RELINK. **Từng người một.** |
| C `CANONICAL` | Không làm gì |
| D `EMAIL_MISMATCH` | Dừng, xác minh danh tính thật trước |
| E `DUPLICATE/AMBIGUOUS` | Dừng, xử lý trùng lặp trước, không auto-merge |
| F `AUTH_USER_NOT_FOUND` | Chờ nhân viên login lần đầu |

Truy vấn phân loại: `crm_employee_identity_status()` sau khi migration lên, hoặc probe `D3` trong `scripts/diagnose-new-employee-auth-identity.sql` trước đó.

**Không bulk mutate.** Mỗi RELINK là một quyết định nghiệp vụ có lý do ghi vào ledger và audit.

## 19. Real-role smoke

Bằng login Google **thật**. Không JWT copy, không impersonate, không service role.

Nhân viên mới (Sale):

- [ ] Login Google → vào CRM, không hiện lỗi permission
- [ ] `supabase_auth_id` = `auth.users.id`, `app_users.id` không đổi
- [ ] Chỉ thấy khách của mình; 0 khách thì hiện empty state
- [ ] Không thấy control cấu hình Manager/Admin
- [ ] Đúng 1 ledger row + 1 audit `linkEmployeeAuthIdentity`

Nhân viên cũ quay lại (Sale):

- [ ] Login lần đầu sau khi quay lại → thông báo "cần xác nhận lại", **không** phải lỗi RLS
- [ ] Admin thấy badge "Cần liên kết lại"
- [ ] Sau restore/reactivate/relink → login vào được
- [ ] `app_users.id` **giống hệt** trước khi nghỉ
- [ ] **Không** có row `app_users` thứ hai cho email đó
- [ ] Khách hàng cũ **không** tự động được gán lại
- [ ] KPI cũ **không** tự động được khôi phục
- [ ] Đúng 1 audit `relinkReturningEmployeeAuthIdentity`

Admin/Manager:

- [ ] Badge trạng thái hiển thị đúng cho từng nhân viên
- [ ] Nút "Liên kết lại" chỉ hiện khi `RELINK_REQUIRED`
- [ ] Manager không thấy được RPC trạng thái identity
- [ ] Sale/Manager/Admin hiện có login bình thường, không bị ép relink

## 20. Customer/history integrity

Vì `app_users.id` không đổi, mọi FK lịch sử tiếp tục trỏ đúng. Sau mỗi RELINK phải đối chiếu số đếm trước/sau:

- `customers.owner_user_id` cache
- `customer_assignments` (toàn bộ lịch sử, không chỉ `is_current`)
- `care_logs`
- `deals`
- `audit_logs` theo `entity_id`
- mọi tham chiếu `created_by` / `*_by_email`

Yêu cầu: **không đổi một dòng nào**. Test 34.B đã khẳng định `app_users.id` và số row email không đổi sau RELINK. Không xóa row, không đổi FK sang CASCADE, không null hóa `created_by`.

## 21. KPI/history integrity

KPI cũ là **lịch sử**, giữ nguyên, không tự khôi phục. Kỳ hiện tại (tháng 9) do Manager gán tay qua KPI Team UI. Migration không đụng bảng KPI nào — static gate check "no unrelated DML" khẳng định.

Tương tự, khách hàng cũ **không** tự động được gán lại (mục 15 của brief). Quyền sở hữu hiện tại là quyết định nghiệp vụ tường minh của Manager.

## 22. Remaining risks

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| 1 | **Lỗ hổng NULL guard đang tồn tại trên production ngay lúc này** | **Cao** | Vá trong R1-0. Cân nhắc đẩy R1-0 lên production sớm, độc lập với phần còn lại của phase. |
| 2 | Chưa chạy trên staging thật; harness cục bộ không có PostgREST, GoTrue, RLS runtime | Trung bình | Bắt buộc bước 2–6 mục 16 |
| 3 | Test đồng thời mới ở mức một session | Trung bình | Bổ sung test đa kết nối ở staging |
| 4 | `crm_guard_employee_lifecycle_change()` có nhánh bypass `auth.role() = 'service_role'` | Trung bình | Ngoài phạm vi phase này. Cần review riêng ai nắm service_role key. |
| 5 | Deploy frontend trước migration sẽ chặn toàn bộ nhân viên chưa link | Trung bình | Ghi rõ thứ tự ở mục 16 |
| 6 | Self-claim tiết lộ gián tiếp việc một email có tồn tại hồ sơ nhân viên | Thấp | Người gọi phải kiểm soát chính email đã xác thực đó; rò rỉ tối thiểu |
| 7 | Nhân viên có role đặc quyền vẫn phải link thủ công | Thấp | Có chủ đích. Owner dùng RPC operator sẵn có. |
| 8 | R1-5 gỡ policy INSERT — nếu có code ngoài repo phụ thuộc vào nó | Thấp | Rollback SQL ở mục 8 |

## 23. Admin operational guide

### Nhân viên mới

1. Admin vào **Quản trị → Người dùng**, nhập email + tên + role, bấm **Thêm nhân viên**.
2. Bảng hiện badge **Chờ đăng nhập lần đầu**.
3. Báo nhân viên đăng nhập Google bằng **đúng email đó**.
4. Sau lần đăng nhập đầu tiên, badge tự chuyển **Đã liên kết đăng nhập**. Không cần thao tác thủ công.
5. Manager phân công khách hàng và gán KPI.

### Nhân viên cũ quay lại

1. Admin tìm **hồ sơ cũ** trong bảng Người dùng. **Tuyệt đối không tạo nhân viên mới.**
2. Nếu trạng thái là **ARCHIVED**: Owner phục hồi hồ sơ về INACTIVE trước.
3. Admin bấm **Mở lại** để về ACTIVE.
4. Nhân viên đăng nhập Google lại bằng đúng email cũ.
5. Nếu tài khoản Google cũ đã bị xóa, badge hiện **Cần liên kết lại** → Admin bấm **Liên kết lại đăng nhập**, nhập lý do.
6. Nhân viên đăng nhập lại → dùng được CRM.
7. Manager phân công khách hàng/KPI **hiện tại**. Khách và KPI cũ nằm lại ở lịch sử, không tự khôi phục.

### Nhân viên nghỉ việc

1. **Ngừng hoạt động** (inactive), nếu cần thì **Lưu trữ** (archived).
2. Chuyển giao hoặc đưa khách về pool chờ phân bổ.
3. Giữ nguyên hồ sơ `app_users`. **Không xóa.**
4. **Khuyến nghị: đừng xóa tài khoản trong Supabase Auth.** Vòng đời + RLS đã chặn hoàn toàn nhân viên inactive/archived: `crm_current_app_user_id()` yêu cầu `active = true` và `lifecycle_status = 'active'`, nên tài khoản Auth còn tồn tại cũng không truy cập được gì.
5. Chỉ xóa Auth khi có lý do bảo mật thực sự. Khi đó nhân viên quay lại sẽ cần RELINK — vẫn hỗ trợ, chỉ thêm một bước.
6. **Xóa email khỏi Supabase Auth không phải là xóa nhân viên.** Nhân viên là `app_users.id`, và nó phải sống cùng lịch sử.

## 24. Final recommendation

1. **Ưu tiên cao nhất:** xem xét đẩy **R1-0** (vá NULL guard) lên production sớm, tách khỏi phần còn lại nếu cần. Lỗ hổng đang mở trên production ngay lúc này và không liên quan gì tới việc phase này có được duyệt hay không.
2. Chạy đủ chuỗi staging ở mục 16 bước 2–6 trước khi bàn tới production.
3. Giữ nguyên tính bảo thủ của luồng nhân viên quay lại. Auto-relink mapping stale là rủi ro chiếm tài khoản; giữ **phát hiện → gắn cờ → Admin xác nhận**.
4. Deploy đúng thứ tự: migration trước, frontend sau.
5. Repair từng người một, có lý do, đọc lại sau mỗi lần.
6. Sau khi ổn định, cân nhắc hai việc riêng: review ai nắm `service_role` key (rủi ro #4), và rà soát toàn bộ pattern `if not <boolean function>` còn lại trong codebase.

---

## Phụ lục — Artifacts

| File | Nội dung |
|---|---|
| `supabase-phase-employee-onboarding-r1-auth-identity.sql` | Migration hợp nhất. SHA-256 `a3f6f52e8da6d63d7b099b4870148bb8bed20594585c6326daf2422292178eaf` |
| `scripts/test-phase-employee-onboarding-r1.mjs` | Static contract gate, 57 check |
| `scripts/test-phase-employee-onboarding-r1-integration.sql` | Integration matrix, 44 test |
| `js/features/crm-app.js` | Onboarding resolver, error UX, Admin identity UI |
| `index.html` | UX copy đúng luồng thật |

## STOP

Phase dừng tại đây theo mục 57. Không khởi động công việc KPI, staging retirement hay redesign CRM nào khác.
