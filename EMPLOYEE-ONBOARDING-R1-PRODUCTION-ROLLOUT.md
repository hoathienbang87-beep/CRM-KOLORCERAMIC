# EMPLOYEE-ONBOARDING-R1-PROD — Emergency Authorization Hotfix + Direct Production Onboarding Rollout

Ngày: 2026-08-17
Repository: `D:\SUPABASE\CRM-KOLORCERAMIC`
Production: `jjeeazwlqcwynzquimeo` · Domain: `https://crmkolor.vercel.app/`
Mô hình triển khai: không dùng staging · owner đã miễn full backup

---

## 1. Kết luận

**EMPLOYEE-ONBOARDING-R1-PROD NO-GO — PRODUCTION AUTHORIZATION STILL FAIL-OPEN**

Phải chọn trạng thái này vì mục 54 đặt điều kiện thành công cao nhất là: `crm_is_admin()` không được fail-open trên **production**. Phiên này **không áp được bất kỳ thay đổi nào lên production**, nên production vẫn đang fail-open. Không được phép báo A/B/C.

Lý do rất cụ thể và không phải do staging: phiên Cowork này chạy trong **cloud sandbox**, không có `device_bash`, tức là **không có shell nào trên máy anh**. Không chạy được `psql`, `npx supabase`, `invoke-supabase-management-query.ps1`, `git`, hay deploy Vercel. Đây là giới hạn môi trường, không phải quyết định kỹ thuật.

**Quan trọng — NO-GO ở đây KHÔNG có nghĩa là R1-0 sai.** R1-0 đã được chứng minh đúng và an toàn bằng test chạy thật:

| Bằng chứng | Kết quả |
|---|---|
| Tái hiện chuỗi exploit trên baseline fail-open | **7/7** — lỗ hổng có thật |
| Ma trận vai trò A–G + kiểm NULL sau hotfix | **28/28** |
| Mô phỏng toàn bộ thứ tự rollout (mục 1) | **PASS** |
| Integration matrix onboarding | **44/44** |
| Security regression sau rollout đầy đủ (mục 45) | **13/13** |

Nói cách khác: **bản vá đã sẵn sàng và đã được kiểm chứng; chỉ còn thiếu một lần chạy trên production.** Mục 32 dưới đây có runbook chạy được trong trình duyệt, không cần CLI.

## 2. Production baseline

Đã chụp được (đọc từ repo, không cần kết nối DB):

| Mục | Giá trị |
|---|---|
| Git branch | `main` |
| Local HEAD | `b1a9609c7f8e568f58979d55c8929c5623d7a556` |
| origin/main đã fetch | `b1a9609c7f8e568f58979d55c8929c5623d7a556` |
| Commit message gần nhất | `docs(kpi): record 2.1E.2R production release` |
| Remote | `https://github.com/hoathienbang87-beep/CRM-KOLORCERAMIC.git` |
| Supabase project ref | `jjeeazwlqcwynzquimeo` |

**Chưa chụp được** (cần kết nối production): định nghĩa hàm đang chạy, grants, policy, inventory định danh, commit Vercel đang phục vụ. Script chụp đã chuẩn bị sẵn — xem mục 29.

## 3. R1-0 vulnerability

`public.crm_current_user_role()` là scalar subquery trên `app_users`. Khi caller không có row ACTIVE, subquery không trả dòng nào → hàm trả **NULL**, không phải `''`.

```
crm_is_admin()   = (NULL in ('owner','admin'))  => NULL
crm_is_manager() = (NULL in (...))              => NULL
```

Mọi RPC đặc quyền tự bảo vệ bằng `if not public.crm_is_admin() then raise ... end if;`. Trong PostgreSQL `if NULL then` **không vào nhánh** → guard im lặng không kích hoạt → **fail-open**.

### Phạm vi thật: 20 điểm, rộng hơn con số 17 báo cáo trước

Audit lại đầy đủ (mục 5) cho thấy **ba** lớp fail-open, không phải một:

| Lớp | Số điểm | Hậu quả |
|---|---|---|
| `if not crm_is_admin()` / `if not crm_is_manager()` | **16** | Người ngoài tạo/sửa/ngừng/lưu trữ nhân viên, gọi RPC cấu hình đặc quyền |
| `if not crm_can_access_customer_id(...)` | **3** | `crm_can_access_customer_id = crm_is_manager() OR exists(...)`. `NULL or false = NULL` → **người ngoài ghi được lên dữ liệu KHÁCH HÀNG của Sale khác** |
| `crm_deactivate_employee`: `... and crm_current_user_role() <> 'owner'` | **1** | `true and NULL = NULL` → bỏ qua bảo vệ "chỉ owner được ngừng tài khoản admin/owner" |

Lớp thứ hai là phát hiện mới của phase này và **nghiêm trọng hơn** lớp đã biết: nó chạm vào dữ liệu khách hàng, không chỉ bảng nhân viên.

### Không bị ảnh hưởng (đã kiểm chứng, không cần sửa)

- `crm_is_active_user()` → `crm_current_app_user_id() is not null` → luôn boolean, không bao giờ NULL.
- `if public.crm_is_manager() then ...` (nhánh dương, p0a:293, p0b:1008) → NULL không vào nhánh → đi đường hạn chế hơn → **an toàn sẵn**.

### Mức độ

- **Hiện tại (production đang chạy): CAO.** Bất kỳ ai đăng nhập Google được vào domain đều có thể ghi lên `app_users` và lên dữ liệu khách hàng của Sale khác.
- **Nếu deploy self-claim mà chưa vá: NGHIÊM TRỌNG.** Người ngoài tự tạo hồ sơ Sale cho email mình rồi self-claim → tài khoản CRM Sale hợp lệ.

## 4. R1-0 isolated hotfix

Đã tách thành artifact riêng theo mục 3.

**`supabase-hotfix-r1-0-crm-is-admin-fail-closed.sql`**
SHA-256: `65127bab99e7d99854eadecededd04d486401a4f683d08cf3573704f21e0f509`
230 dòng · một transaction · **không có một câu DML nào**

Nội dung đúng 4 hàm:

| Hàm | Thay đổi | Ngữ nghĩa phân quyền |
|---|---|---|
| `crm_current_user_role()` | bọc `coalesce(..., '')` | **giữ nguyên** — vẫn phân giải qua UUID bridge, không dùng email, giữ `security definer` + `search_path = public` |
| `crm_is_admin()` | bọc `coalesce(..., false)` | **giữ nguyên** — `owner, admin` |
| `crm_is_owner_or_admin()` | bọc `coalesce(..., false)` | **giữ nguyên** — ủy quyền cho `crm_is_admin()` |
| `crm_is_manager()` | bọc `coalesce(..., false)` | **giữ nguyên** — `owner, admin, manager, quanly, quản lý, quản lí` |

Theo mục 4, tôi **không** vá máy móc một biểu thức. Đã đọc thân hàm đang chạy, xác định file nào là bản mới nhất (`supabase-phase-f-crm-rls-cleanup.sql` cho 3 hàm boolean, `supabase-phase-auth-identity-linking-repair.sql` cho `crm_current_user_role`), và giữ nguyên từng danh sách role.

Vá tại tầng helper dùng chung nên **không phải sửa 20 RPC**, và đóng luôn cả 3 lớp fail-open — kể cả lớp khách hàng, vì `crm_can_access_customer_id` gọi `crm_is_manager()`.

Không đụng: grants (`create or replace` giữ nguyên grant hiện có), signature, `security definer`, `search_path`, RLS policy, dữ liệu.

Với RLS policy, NULL vốn đã bị coi là not-true, nên đổi NULL → `false`/`''` là **siết chặt hoặc tương đương, không bao giờ nới lỏng**.

Hotfix có khối tự kiểm chứng ngay trong transaction: giả lập caller đã xác thực nhưng không có hồ sơ (gán `request.jwt.claim.sub` phạm vi transaction), yêu cầu mọi hàm trả `false`/`''`. Nếu bất kỳ hàm nào còn NULL → `raise` → **rollback, không commit nửa vời**.

## 5. Privileged call-site audit

| Vị trí | Guard | Phân loại | Fail-open trước hotfix |
|---|---|---|---|
| p0a:624, 677, 935, 1089 | `if not crm_is_admin()` | admin/owner — cấu hình đặc quyền | **CÓ** |
| p0b:654 | `if not crm_is_admin()` | tạo nhân viên (`crm_create_employee`) | **CÓ** |
| p0b:698 | `if not crm_is_admin()` | sửa hồ sơ nhân viên | **CÓ** |
| p0b:748, 865, 909 | `if not crm_is_admin()` | vòng đời (deactivate/reactivate/archive) | **CÓ** |
| p0a:451, 1044 | `if not crm_is_manager()` | nghiệp vụ manager | **CÓ** |
| p0b:398, 489, 551, 588 | `if not crm_is_manager()` | phân công khách hàng | **CÓ** |
| p0b:1025 | `if not crm_is_manager() and v_owner.id is null` | phân công | **CÓ** |
| p0a:530, 594, 837 | `if not crm_can_access_customer_id(...)` | truy cập khách hàng | **CÓ** (qua `crm_is_manager`) |
| p0b:766 | `... and crm_current_user_role() <> 'owner'` | bảo vệ admin/owner | **CÓ** |
| p0a:977 | `if not crm_is_active_user()` | tài khoản hoạt động | không |
| p0a:293, p0b:1008 | `if crm_is_manager() then` (nhánh dương) | nghiệp vụ | không |

**Tổng: 20 điểm fail-open, tất cả được đóng bằng một hotfix ở tầng helper.** Không viết lại RPC nào — đúng khuyến nghị mục 5.

## 6. Local exploit reproduction before fix

Harness: PostgreSQL 16 cục bộ, dựng lại đúng bề mặt production (`harness-prod-baseline.sql`) — schema `auth`/`public`, trigger identity + lifecycle, partial unique index, và thân hàm copy nguyên văn từ repo ở trạng thái **chưa vá**.

Kết quả PHẦN "BEFORE" — **7/7 PASS**, nghĩa là lỗ hổng tái hiện được hoàn toàn:

| Test | Kết quả |
|---|---|
| `crm_is_admin()` trả NULL cho outsider | tái hiện |
| `crm_is_manager()` trả NULL cho outsider | tái hiện |
| `crm_can_access_customer_id()` trả NULL cho outsider | tái hiện |
| **EXPLOIT** outsider gọi được `crm_create_employee` | **thành công, không lỗi** |
| **EXPLOIT** outsider ngừng được nhân viên khác | **thành công**, `lifecycle=inactive` |
| **EXPLOIT** outsider ghi được lên khách hàng của Sale khác | **thành công, không lỗi** |
| Manager bị chặn đúng khi ngừng admin (guard vốn hoạt động) | đúng |

## 7. Local negative proof after fix

Cùng harness, áp hotfix rồi chạy lại — **28/28 PASS**.

Ma trận vai trò (mục 6):

| Ca | Đối tượng | `crm_is_admin()` | Kết quả |
|---|---|---|---|
| A | outsider không có `app_users` row | `false` | PASS |
| B | app_user inactive | `false` | PASS |
| C | app_user archived | `false` | PASS |
| D | Sale | `false` | PASS |
| E | Manager | `false` (và `crm_is_manager()` vẫn `true`) | PASS |
| F | Admin | `true` | PASS |
| G | Owner | `true` | PASS |

Kiểm NULL (mục 8): với cả 7 ca **và** trạng thái chưa xác thực (`auth.uid()` = NULL), không hàm nào trả NULL. `crm_current_user_role()` trả `''`.

Chuỗi exploit (mục 7) sau vá:

| Đường tấn công | Kết quả |
|---|---|
| `crm_create_employee` | DENIED — *Chỉ owner/admin được thêm nhân viên.* · **không ghi một phần** |
| `crm_deactivate_employee` | DENIED · lifecycle giữ nguyên `active` |
| `crm_reactivate_employee` | DENIED |
| `crm_archive_employee` | DENIED |
| Ghi lên khách hàng của Sale khác | DENIED — *Không có quyền với khách hàng này.* · `snoozed=0` |

Không regression:

- Admin vẫn tạo được nhân viên hợp lệ và dùng được RPC vòng đời.
- Sale vẫn truy cập được khách của chính mình.
- Manager giữ nguyên quyền nghiệp vụ, nhưng không leo được lên quyền Admin.
- Bảo vệ "chỉ owner được ngừng admin/owner" **nay mới thực sự kích hoạt** (trước đó bị NULL vô hiệu hoá).

Artifact: `scripts/test-hotfix-r1-0-fail-closed.sql`

## 8. Production R1-0 rollout

**CHƯA THỰC HIỆN.** Không có shell trên máy anh trong phiên này.

Đã chuẩn bị đầy đủ để anh chạy — xem runbook ở mục 32. Cần ghi lại khi chạy:

| Trường | Giá trị |
|---|---|
| Thời điểm | *(điền)* |
| Artifact | `supabase-hotfix-r1-0-crm-is-admin-fail-closed.sql` |
| SHA-256 | `65127bab99e7d99854eadecededd04d486401a4f683d08cf3573704f21e0f509` |
| Operator | *(điền)* |
| Kết quả | *(cần thấy `HOTFIX_R1_0_VERIFY_PASS` và `COMMIT`)* |

## 9. Production security smoke

**CHƯA THỰC HIỆN.** Checklist bắt buộc sau khi áp hotfix (mục 11):

- [ ] Read-back: `pg_get_functiondef` của 4 hàm khớp bản mong đợi, `prosecdef` và `proconfig` không đổi
- [ ] Grants của 4 hàm không đổi so với ảnh chụp P2
- [ ] Signature các hàm phụ thuộc không đổi
- [ ] Phiên Sale thật: `crm_create_employee` → DENIED
- [ ] Phiên Sale thật: RPC vòng đời → DENIED
- [ ] Phiên Manager thật: giữ quyền nghiệp vụ, không leo quyền Admin/Owner
- [ ] Phiên Admin thật: đường hợp lệ vẫn chạy
- [ ] Không tạo row nghiệp vụ thừa; dùng lệnh có thể rollback nếu phải ghi

## 10. New employee root cause

`crm_create_employee` tạo row `app_users` nhưng **không set `supabase_auth_id`**. Không có trigger auto-link. Không có UI nào gọi `crm_link_employee_auth_identity`. Sau khi login Google, `fetchRef` tra theo `supabase_auth_id` (`js/firebase.js:491`) nên luôn trượt; `loadAppUser` rơi vào self-create shell insert; insert bị chặn; lỗi bị `authMessage` (`crm-app.js:519`) map thành thông báo RLS chung.

`crm_current_app_user_id()` = NULL → `crm_is_active_user()` = false → RLS từ chối **đúng đặc tả**. RLS không phải root cause.

## 11. Returning employee root cause

`app_users.supabase_auth_id` trỏ OLD Auth UUID đã bị xóa; login lại tạo NEW UUID. Không có đường nối NEW UUID vào row cũ:

- `crm_relink_employee_auth_identity` chỉ nhận target `role in ('admin','owner')` → **không dùng được cho Sale**.
- `crm_reactivate_employee` từ chối row ARCHIVED và **không tồn tại RPC unarchive nào** → nhân viên đã lưu trữ không có đường quay lại hợp lệ.

## 12. Backend onboarding changes

**`supabase-phase-employee-onboarding-r1-prod.sql`**
SHA-256: `47e0f307c5d028a222386d397508528a28d38f04c001fd3f9cf8cb1266281f52`
673 dòng · một transaction · không có business DML

Đã **loại bỏ hoàn toàn** phần R1-0 (mục 33). Thay vào đó, migration mở đầu bằng khối precondition **từ chối cài đặt nếu hotfix R1-0 chưa live**:

```
PRECONDITION_FAIL: crm_is_admin() vẫn trả NULL.
Áp supabase-hotfix-r1-0-crm-is-admin-fail-closed.sql TRƯỚC.
```

Đây là cách ép thứ tự ở mục 1 bằng chính database, không dựa vào kỷ luật thao tác. Đã kiểm chứng: trên baseline chưa vá, migration bị chặn và **không có function nào bị cài một phần**.

Nội dung:

| Mã | RPC |
|---|---|
| R1-1 | `crm_claim_employee_identity_on_first_login()` — self-claim |
| R1-2 | `crm_relink_returning_employee_identity(...)` — RELINK cho Sale quay lại |
| R1-3 | `crm_restore_archived_employee(...)` — ARCHIVED → INACTIVE, owner-only |
| R1-4 | `crm_employee_identity_status()` — trạng thái onboarding cho Admin UI |
| R1-5 | gỡ 2 policy INSERT self-create shell (siết chặt) |

Cũng có precondition kiểm `identity_link_requests`, partial unique index và 2 trigger guard.

## 13. Rehire lifecycle

Hợp đồng hiện có, giữ nguyên: `active → inactive` (`crm_deactivate_employee`), `inactive → active` (`crm_reactivate_employee`), `inactive → archived` (`crm_archive_employee`). `archived → *` **không tồn tại**.

Bổ sung đúng một chuyển đổi còn thiếu:

**`crm_restore_archived_employee(p_employee_id, p_reason)`** — `archived → inactive`, **owner-only**, bắt buộc lý do, giữ nguyên `app_users.id`.

Cố ý bảo thủ hơn `crm_reactivate_employee` (vốn cho admin): chỉ owner, và chỉ về INACTIVE chứ không nhảy thẳng ACTIVE. Owner làm hai bước rõ ràng. `crm_guard_employee_lifecycle_change()` **không bị disable**; RPC dùng đúng switch `crm.allow_employee_lifecycle`.

Theo mục 20: rehire **không** tự khôi phục customer assignment, KPI assignment hay quyền sở hữu hiện tại. Lịch sử ở lại lịch sử.

## 14. Relink contract

`crm_relink_returning_employee_identity(p_app_user_id, p_auth_user_id, p_expected_current_auth_id, p_reason, p_request_id)`

- Actor: owner/admin canonical đang ACTIVE, hoặc `session_user = postgres`
- Target: **role `sale`** — role đặc quyền vẫn dùng RPC operator owner-only, không nới lỏng (mục 27)
- Bắt buộc lifecycle đã ACTIVE trước → `RETURNING_RELINK_LIFECYCLE_REQUIRED`
- Mapping hiện tại phải non-null và khớp `p_expected_current_auth_id`
- OLD UUID phải **không còn** trong `auth.users` → nếu còn: `IDENTITY_EXISTING_MAPPING_VALID`
- OLD UUID không được nhân viên khác tham chiếu
- NEW Auth: tồn tại, `email_confirmed_at` khác NULL, đã từng đăng nhập, không deleted/anonymous/banned
- NEW Auth email khớp chính xác email nhân viên
- Email duy nhất cả hai phía; `identity_count >= 1` và `= provider_count`
- NEW UUID chưa map cho nhân viên khác
- Idempotent theo `request_id`; payload đổi → `IDENTITY_REQUEST_PAYLOAD_CONFLICT`
- Ghi ledger + audit `relinkReturningEmployeeAuthIdentity`

## 15. Self-claim contract

`crm_claim_employee_identity_on_first_login()` — **không nhận tham số nào** (`pronargs = 0`, có test khẳng định). Client không thể chọn `employee_id`, `auth_uuid` hay email target.

Server tự đọc: `auth.uid()` → row `auth.users` tương ứng → email. Email lấy từ **bảng `auth.users`**, không phải từ claim `auth.email()` trong JWT — canonical hơn.

Chỉ LINK khi đủ toàn bộ:

- đã xác thực; Auth không deleted/anonymous/banned; `email_confirmed_at` khác NULL
- `identity_count >= 1` và `= provider_count`
- đúng **1** row `app_users` khớp email chuẩn hóa, và đúng **1** row `auth.users` khớp email
- `supabase_auth_id IS NULL`
- `role = 'sale'`
- `active = true`, `lifecycle_status = 'active'`
- Auth UUID chưa map cho nhân viên khác

Mapping non-null **không bao giờ** bị ghi đè (mục 17): trả `RETURNING_EMPLOYEE_RELINK_REQUIRED`, không mutation.

`request_id` sinh tất định `md5('crm:firstlogin:' || app_user_id || ':' || auth_uid)` + `unique(actor_key, operation, request_id)` + advisory lock + `for update` → gọi lặp/đồng thời gộp về đúng một kết quả canonical.

## 16. Frontend changes

Đã chuẩn bị, **chưa deploy**. Diff **133 dòng** `js/features/crm-app.js` + **2 dòng** `index.html`. Line ending CRLF gốc giữ nguyên (mục 36). `js/firebase.js` **không cần sửa** — `fetchRef` đã tra theo `supabase_auth_id`.

| Vị trí | Thay đổi |
|---|---|
| `loadAppUser()` | Bỏ self-create shell insert. Trượt canonical → gọi resolver. `LINKED`/`ALREADY_LINKED` → đọc lại canonical row; còn lại ném `OnboardingIdentityError` mang mã trạng thái |
| `ONBOARDING_MESSAGES` | 10 thông báo nghiệp vụ tiếng Việt |
| `authMessage()` | Nhánh đầu `if (err?.onboardingCode) return err.message;` — nhánh RLS chung **giữ nguyên** cho lỗi RLS thật |
| `refreshEmployeeIdentityStatus()`, `identityStatusBadge()` | Nạp/hiển thị trạng thái liên kết |
| `relinkReturningEmployee()` | Gọi RPC relink với `crypto.randomUUID()`; chặn trước nếu chưa có Auth candidate hoặc lifecycle chưa ACTIVE |
| `renderUserAdmin()` | Badge trạng thái + nút "Liên kết lại đăng nhập" |
| `addUserAdmin()` | Toast mô tả đúng luồng |
| `index.html` | Bỏ câu sai "Supabase Auth tự tạo phiên đăng nhập" |

Frontend **không bao giờ** gửi `employee_id`/`auth_uuid` cho first-login và **không bao giờ** ghi `supabase_auth_id` trực tiếp (mục 22) — static gate có check khẳng định.

## 17. Error UX

| Mã | Thông báo |
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

Người dùng thường không còn thấy "Hãy kiểm tra RLS và role/active". Chi tiết kỹ thuật chỉ vào `console.warn`.

## 18. Admin employee UI

Badge trong bảng Người dùng: **Chờ đăng nhập lần đầu** · **Chờ liên kết đăng nhập** · **Đã liên kết đăng nhập** · **Cần liên kết lại** · **Sai liên kết đăng nhập** · **Trùng email — cần kiểm tra**. Lifecycle INACTIVE/ARCHIVED vẫn hiển thị bằng badge vòng đời sẵn có.

Nút **Liên kết lại đăng nhập** chỉ hiện khi `RELINK_REQUIRED`. Không hiển thị UUID thô cho thao tác thường.

## 19. Migration artifacts + hashes

| Artifact | SHA-256 | Trạng thái |
|---|---|---|
| `supabase-hotfix-r1-0-crm-is-admin-fail-closed.sql` | `65127bab99e7d99854eadecededd04d486401a4f683d08cf3573704f21e0f509` | chưa áp production |
| `supabase-phase-employee-onboarding-r1-prod.sql` | `47e0f307c5d028a222386d397508528a28d38f04c001fd3f9cf8cb1266281f52` | chưa áp production |

Artifact hợp nhất cũ `supabase-phase-employee-onboarding-r1-auth-identity.sql` (`a3f6f52e…78eaf`) **đã bị thay thế** bởi cặp trên và **không được dùng để rollout** — nó chứa cả R1-0 nên vi phạm yêu cầu tách ở mục 3.

Test artifacts: `scripts/test-hotfix-r1-0-fail-closed.sql`, `scripts/test-phase-employee-onboarding-r1-integration.sql`, `scripts/test-security-regression-after-rollout.sql`, `scripts/test-phase-employee-onboarding-r1.mjs`, `scripts/run-employee-onboarding-r1-prod-local.sh`, `harness-prod-baseline.sql`, `scripts/capture-pre-change-references.sql`.

## 20. Git/release commit

**CHƯA THỰC HIỆN** — không có `git` trong phiên này.

Baseline trước thay đổi: `main @ b1a9609c7f8e568f58979d55c8929c5623d7a556`.

Theo mục 37, khi commit chỉ stage đúng các file sau, **không `git add -A`**:

```
supabase-hotfix-r1-0-crm-is-admin-fail-closed.sql
supabase-phase-employee-onboarding-r1-prod.sql
harness-prod-baseline.sql
scripts/test-hotfix-r1-0-fail-closed.sql
scripts/test-security-regression-after-rollout.sql
scripts/test-phase-employee-onboarding-r1-integration.sql
scripts/test-phase-employee-onboarding-r1.mjs
scripts/run-employee-onboarding-r1-prod-local.sh
scripts/capture-pre-change-references.sql
js/features/crm-app.js
index.html
EMPLOYEE-ONBOARDING-R1-PRODUCTION-ROLLOUT.md
EMPLOYEE-ONBOARDING-R1-NEW-FIRST-LOGIN-RETURNING-EMPLOYEE-RELINK.md
```

Cần kiểm `git diff --stat` trước khi commit: kỳ vọng đúng **133 dòng** ở `crm-app.js` và **2 dòng** ở `index.html`. Nếu lệch nhiều hơn → line ending bị chuẩn hoá nhầm, **dừng lại**.

Artifact hợp nhất cũ `supabase-phase-employee-onboarding-r1-auth-identity.sql` nên được xóa hoặc đánh dấu superseded để tránh chạy nhầm.

## 21. Vercel deployment

**CHƯA THỰC HIỆN.** Bắt buộc theo mục 35: chỉ deploy frontend **sau khi** cả hai migration đã áp và read-back xong.

Kiểm trước khi deploy: đúng repo `hoathienbang87-beep/CRM-KOLORCERAMIC`, đúng project/team, đúng commit, production alias trỏ `https://crmkolor.vercel.app/`. Không dùng Vercel CLI nếu chưa chắc identity/project context (mục 38) — đẩy qua GitHub để pipeline tự chạy.

**Lý do thứ tự này là bắt buộc:** `loadAppUser` mới gọi `crm_claim_employee_identity_on_first_login`. Nếu frontend lên trước, RPC chưa tồn tại → mọi nhân viên chưa link nhận `IDENTITY_NOT_LINKED`.

## 22. Current new employee repair

**CHƯA THỰC HIỆN.** Sau khi backend + frontend lên, nhân viên mới đang lỗi **tự khỏi** ở lần đăng nhập Google kế tiếp, nếu inventory xác nhận: `supabase_auth_id IS NULL`, email khớp chính xác, không trùng email hai phía, `role = 'sale'`, `active = true`, `lifecycle_status = 'active'`.

Khác điều kiện trên → dừng, xử lý theo mục 23.

## 23. Returning employee inventory/repairs

**CHƯA THỰC HIỆN.** Dùng probe `P6` trong `scripts/capture-pre-change-references.sql`, hoặc `crm_employee_identity_status()` sau khi migration lên.

| Lớp | Xử lý |
|---|---|
| A `NEW_NULL_NOT_LINKED` | tự khỏi khi nhân viên login |
| B `RETURNING_STALE_AUTH` | (nếu ARCHIVED) owner restore → admin reactivate → RELINK. **Từng người một** |
| C `CANONICAL` | không làm gì |
| D `EMAIL_MISMATCH` | dừng, xác minh danh tính thật trước |
| E `DUPLICATE_AMBIGUOUS` | dừng, xử lý trùng lặp trước, **không auto-merge** |
| F `AUTH_USER_NOT_FOUND` | chờ nhân viên login lần đầu |

Không bulk repair. Mỗi RELINK có lý do ghi vào ledger và audit.

## 24. Real-role smoke

**CHƯA THỰC HIỆN.** Bằng login Google thật, không JWT copy, không service role.

Admin: tạo nhân viên chạy · badge trạng thái đúng · nút rehire/relink đúng ngữ cảnh.
Sale mới: login lần đầu vào được · CRM load · không lỗi RLS chung · chỉ thấy dữ liệu của mình.
Sale quay lại: đúng hồ sơ lịch sử · login được · **không có hồ sơ trùng** · lịch sử nguyên vẹn · khách/KPI cũ **không** tự khôi phục.
Manager: quản lý được Sale theo policy · **không** đụng được role đặc quyền.

## 25. Customer/history integrity

Vì `app_users.id` không đổi, mọi FK lịch sử tiếp tục trỏ đúng. Sau mỗi RELINK đối chiếu trước/sau bằng probe `P7`: `customer_assignments` (toàn bộ lịch sử, không chỉ `is_current`), `customers.owner_user_id` cache, care history, `audit_logs` theo `entity_id`, mọi tham chiếu `created_by`.

Yêu cầu: **không đổi một dòng nào**. Test 34.B trong integration matrix đã khẳng định `app_users.id` và số row email không đổi sau RELINK. Không tự động gán lại khách hàng (mục 20).

## 26. KPI/history integrity

KPI cũ là lịch sử, giữ nguyên, **không tự khôi phục**. Kỳ hiện tại do Manager gán tay qua KPI Team UI. Cả hai migration **không đụng bảng KPI nào**.

## 27. Security regression after rollout

Đã chạy cục bộ **sau khi** áp cả hotfix và onboarding migration — **13/13 PASS**:

| Kiểm tra | Kết quả |
|---|---|
| outsider không tạo được nhân viên | PASS |
| self-claim **không** tự tạo hồ sơ cho người ngoài (`NO_EMPLOYEE_PROFILE`) | PASS |
| self-claim không nhận tham số target nào (`pronargs = 0`) | PASS |
| outsider không gọi được RPC vòng đời | PASS |
| outsider không gọi được `crm_relink_returning_employee_identity` | PASS |
| outsider không gọi được `crm_restore_archived_employee` | PASS |
| outsider không đọc được `crm_employee_identity_status` | PASS |
| update trực tiếp `supabase_auth_id` vẫn bị trigger chặn | PASS |
| chỉ link được khi Admin đã tạo sẵn hồ sơ đúng email | PASS |
| Sale vừa link **vẫn không có** quyền admin | PASS |
| Sale vừa link không tạo được nhân viên role owner | PASS |
| Sale không tự nâng role của mình | PASS |

**Kết luận mục 45: self-claim không mở lại đường leo thang.** Người ngoài chỉ có thể trở thành Sale khi Admin đã chủ động tạo sẵn hồ sơ đúng email đó — đúng ý định nghiệp vụ.

Lưu ý trung thực: kiểm "shell insert bị chặn" chỉ xác minh được ở tầng policy trên production (harness không bật RLS). Phải xác nhận trong read-back production rằng hai policy INSERT đã bị gỡ.

## 28. RLS integrity

Không policy nào bị nới lỏng. Cụ thể:

- Hotfix R1-0: **không đụng** policy nào. Chỉ đổi NULL → `false`/`''`, mà policy vốn đã coi NULL là not-true → siết chặt hoặc tương đương.
- Migration onboarding: **gỡ** 2 policy INSERT self-create shell → siết chặt. Không thêm/sửa policy nào khác.
- Không thêm email fallback vào bất kỳ policy nào. Email vẫn chỉ là discovery; authority vẫn là `auth.uid()` trong `supabase_auth_id`.
- `crm_current_app_user_id()`, `crm_is_active_user()`, 2 trigger guard, partial unique index: **không sửa**.

Việc sửa identity linking là thứ mở được quyền truy cập — không phải sửa RLS.

## 29. Pre-change technical references captured

Theo mục 2/50: **không tạo full backup** (owner đã miễn), và điều này **không** bị coi là blocker.

Đã chụp được trong phiên này:

- Git branch, local HEAD, origin/main, commit message, remote URL (mục 2)
- SHA-256 của cả hai artifact (mục 19)
- Định nghĩa **mong đợi** của 4 hàm sau vá (nằm ngay trong artifact hotfix)
- Toàn bộ call-site audit 20 điểm (mục 5)

Chưa chụp được, cần chạy trước khi áp hotfix — `scripts/capture-pre-change-references.sql` (chỉ SELECT, không đọc secret):

| Probe | Nội dung |
|---|---|
| P1 | `pg_get_functiondef` đầy đủ của 17 hàm — **đây chính là bản rollback thủ công** |
| P2 | grants hiện tại của mọi hàm `crm_*` |
| P3 | RLS policy trên `app_users` — bản rollback cho 2 policy sắp gỡ |
| P4 | trigger + index định danh (phải không đổi sau rollout) |
| P5 | inventory định danh tổng quát |
| P6 | ma trận định danh từng nhân viên, phân loại A–F |
| P7 | số đếm nghiệp vụ theo nhân viên — mốc so sánh mục 25/26 |
| P8 | ledger + audit đã có |

## 30. Known limitations

1. **Production vẫn fail-open ngay lúc này.** Đây là hạn chế lớn nhất và là lý do verdict D.
2. Test chạy trên harness cục bộ dựng lại từ source, **không có** PostgREST, GoTrue, RLS runtime của Supabase. Read-back và smoke bằng phiên thật là bắt buộc, không thể thay thế.
3. Test đồng thời (mục 32) mới ở mức serialize trong một session; chưa test đa kết nối thật.
4. `crm_guard_employee_lifecycle_change()` có nhánh bypass `auth.role() = 'service_role'`. Ngoài phạm vi phase này, nhưng cần review riêng ai đang giữ service_role key.
5. Kiểm policy shell insert chỉ xác minh được trên production (mục 27).
6. Chưa đối chiếu định nghĩa hàm **thực tế đang chạy** trên production với giả định từ repo. Probe P1 sẽ đóng khoảng trống này — nếu P1 cho thấy production khác repo, **dừng và đánh giá lại trước khi áp**.

## 31. Operational guide

### Nhân viên mới
Admin → **Thêm nhân viên** (email + tên + role) → badge **Chờ đăng nhập lần đầu** → nhân viên đăng nhập Google **đúng email đó** → badge tự chuyển **Đã liên kết đăng nhập** → Manager phân công khách hàng/KPI.

### Nhân viên cũ quay lại
Admin tìm **hồ sơ cũ** — **tuyệt đối không tạo nhân viên mới**. Nếu ARCHIVED: Owner phục hồi về INACTIVE. Admin bấm **Mở lại** → ACTIVE. Nhân viên đăng nhập Google lại. Nếu tài khoản Google cũ đã bị xóa, badge hiện **Cần liên kết lại** → Admin bấm **Liên kết lại đăng nhập**, nhập lý do. Manager phân công khách/KPI **hiện tại**; khách và KPI cũ ở lại lịch sử.

### Nhân viên nghỉ việc
**Ngừng hoạt động** → nếu cần thì **Lưu trữ**. Chuyển giao hoặc đưa khách về pool. Giữ nguyên hồ sơ `app_users`, **không xóa**.

**Khuyến nghị: đừng xóa tài khoản trong Supabase Auth.** Vòng đời + RLS đã chặn hoàn toàn nhân viên inactive/archived — `crm_current_app_user_id()` yêu cầu `active = true` và `lifecycle_status = 'active'`, nên tài khoản Auth còn tồn tại cũng không truy cập được gì. Chỉ xóa Auth khi có lý do bảo mật thực sự; khi đó nhân viên quay lại sẽ cần RELINK.

**Xóa email khỏi Supabase Auth KHÔNG phải là xóa nhân viên.** Nhân viên là `app_users.id`, và nó phải sống cùng lịch sử (mục 49).

## 32. Final recommendation

### Việc cần làm ngay — vá lỗ hổng

Hotfix chỉ dùng SQL thuần, **không cần CLI**. Anh có thể chạy trong **Supabase SQL Editor** trên trình duyệt:

1. Mở SQL Editor của project `jjeeazwlqcwynzquimeo`.
2. Chạy `scripts/capture-pre-change-references.sql`, **lưu output lại** (đây là rollback reference thay cho backup).
3. Đối chiếu probe P1: định nghĩa 4 hàm trên production có khớp giả định trong mục 3 không. **Nếu khác → dừng, báo lại.**
4. Dán toàn bộ `supabase-hotfix-r1-0-crm-is-admin-fail-closed.sql` và chạy. Phải thấy `HOTFIX_R1_0_VERIFY_PASS`. Nếu thấy `HOTFIX_VERIFY_FAIL` → transaction tự rollback, không có gì thay đổi.
5. Chạy phần READ-BACK ở cuối file hotfix (đang comment sẵn).
6. Negative smoke bằng phiên Sale/Manager thật (mục 9).

Bước 1–5 mất vài phút và **đóng cả 20 điểm fail-open**, kể cả đường ghi vào dữ liệu khách hàng.

### Sau đó — phần onboarding

7. Dán `supabase-phase-employee-onboarding-r1-prod.sql` và chạy. Nếu R1-0 chưa live nó sẽ tự từ chối.
8. Read-back: 4 RPC mới, signature, grants, `security definer`/`search_path`, 2 policy INSERT đã gỡ.
9. Commit + push đúng danh sách file ở mục 20, kiểm `git diff --stat` trước.
10. Deploy Vercel, xác minh commit đang phục vụ.
11. Inventory nhân viên (P6), repair từng người một.
12. Real-role smoke (mục 24).

### Nguyên tắc giữ nguyên

- **Không rollback R1-0** về trạng thái fail-open (mục 12/51). Nếu onboarding hỏng thì forward-fix, hoặc rollback riêng frontend.
- Backend an toàn phải ở lại kể cả khi phải hạ frontend về bản cũ.
- Nếu bất kỳ nhân viên nào còn mơ hồ về định danh: **để nguyên**, liệt kê cho owner xem xét (mục 57).

### Về việc phiên này không chạy được production

Nếu anh muốn tôi tự thực hiện rollout thay vì đưa runbook, cần một phiên Cowork **chạy trên máy anh** (Claude desktop app → "Run this task" → "On your computer"). Khi đó tôi có shell, chạy được `psql`/`git`/deploy và tự làm hết mục 8–24. Phiên cloud này thì không.

---

## STOP

Phase dừng tại đây theo mục 57. Không khởi động KPI, staging retirement, CRM redesign, reporting hay legacy cleanup.
