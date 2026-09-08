# CRM-DEV-READINESS-AUDIT

Ngày kiểm tra: 08/09/2026, Asia/Saigon. Phạm vi: chỉ đọc source/dịch vụ; tạo báo cáo này và bản sao/bằng chứng thử nghiệm tại `%TEMP%\crm-dev-readiness-audit-20260908`. Không sửa source hay trạng thái production.

## 1. Kết luận

**CRM DEV BLOCKED — PROJECT/ACCOUNT/ENVIRONMENT MISMATCH**

Repo đúng và đồng bộ GitHub. Local đủ chạy build/static, nhưng account context chưa đủ điều kiện triển khai: GitHub CLI chỉ READ; Supabase CLI không thấy production CRM; Vercel CLI không truy cập được team/project CRM. Hai local project link đều chưa tồn tại, không có bằng chứng đã link nhầm project. Mismatch nằm ở quyền/account context, không phải URL Supabase frontend.

Build PASS; syntax 41/41 file PASS; 10/11 bộ test local PASS. Test KPI-2 FAIL vì CRLF đổi hash artifact; chạy nguyên test trên Git blob LF trong bản sao tạm PASS 172 checks. Không sửa file gốc hay Git config.

Production maintenance đang ON bằng frontend guard; Google Auth vẫn bật. Login OFF không chặn build/audit. Các smoke real-role/Auth được hoãn, không coi bảo trì là lỗi readiness.

## 2. Repository identity

- Root: `D:\DU AN CUA TOI\CRM-KOLORCERAMIC`.
- Remote fetch/push: `https://github.com/hoathienbang87-beep/CRM-KOLORCERAMIC.git`.
- `gh repo view` xác nhận `hoathienbang87-beep/CRM-KOLORCERAMIC`.
- Không tìm thấy `AGENTS.md` trong repo và các thư mục cha đã kiểm tra.
- Không reset/rebase/checkout/fetch/pull/push/link. Dùng `git ls-remote` xác minh remote trực tiếp mà không đổi local refs.

## 3. Git state

| Mục | Kết quả |
|---|---|
| Branch | `main` |
| HEAD | `97f0dc5e79aebe82503152be8be96baba85365af` |
| origin/main local | Cùng SHA |
| main live qua `git ls-remote origin refs/heads/main` | Cùng SHA |
| `git rev-list --left-right --count HEAD...origin/main` | `0 0` |
| Local chưa push / remote chưa pull | `0 / 0` trên main tại thời điểm kiểm tra |
| Working tree trước audit | CLEAN; không staged/modified/untracked |
| Git | `2.55.0.windows.3`; `C:\Program Files\Git\cmd\git.exe` |
| `git diff --check` | PASS |

Global config: `user.name=ksngltech`, `user.email=devil8xonline@gmail.com`, `init.defaultBranch=main`, `core.autocrlf=true`, `core.editor=code --wait`, `pull.rebase=false`. Global `credential.helper` chưa đặt; effective system helper `manager` từ `C:/Program Files/Git/etc/gitconfig`. Không thay config. Author name khác chủ repo không tự nó là lỗi quyền.

Sau audit: chỉ báo cáo này là untracked, phân loại tài liệu audit được yêu cầu. Không thay đổi runtime, không bỏ file nào.

## 4. GitHub state

CLI `gh 2.98.0`, `C:\Program Files\GitHub CLI\gh.exe`. `gh auth status` xác nhận account active `ksngltech-eng`, keyring, HTTPS; scopes `gist`, `read:org`, `repo`, `workflow`. Không in token.

`gh repo view ... --json nameWithOwner,viewerPermission,defaultBranchRef` trả repo đúng, default branch `main`, **viewerPermission=READ**. Đọc repo, commit status, deployment metadata thành công. Scope token `repo` không cấp thêm quyền repository cho tài khoản.

**Chưa sẵn sàng push với CLI account đã xác minh.** Git Credential Manager là credential context riêng, chưa được chứng minh quyền ghi. Clone/ls-remote thành công không chứng minh push. Không thử push, kể cả dry-run.

## 5. Node/package manager

`node v24.19.0`, `npm 11.17.0`, `npx 11.17.0`; Node tại `C:\Program Files\nodejs\node.exe`, npm/npx wrapper cùng thư mục.

Dự án static HTML/CSS/JavaScript, không có `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`. Không có package manager dự án cần đổi. Có wrapper pnpm trên PATH nhưng dự án không dùng nên không cần chạy. Không chạy `npm run build` vì không có script đó.

## 6. Dependencies

Không có `node_modules`; không phải dependency thiếu đối với build/static hiện tại. Lockfile integrity và npm dependency tree: không áp dụng. Build/static tests dùng Node built-ins và helper JS trong repo.

Supabase JS được vendored trong `js/vendor/supabase/`; app ưu tiên local, fallback CDN `@supabase/supabase-js@2.45.4`. Asset local được HTML tham chiếu đều tồn tại. Không install/nâng version. Không thấy `psql`, `docker` trên PATH; Playwright/integration runtime chưa được chứng minh sẵn sàng. Không cần install để chạy build/static đã thực hiện.

## 7. Project architecture

```text
index.html + css/styles.css
  → js/app.js → js/config/maintenance.generated.js
      ON: hiện maintenance, không load Supabase/CRM module
      OFF: app-shell → Supabase JS → js/features/crm-app.js
          → js/firebase.js (Supabase compatibility adapter)
          → js/supabase-config.js → Supabase Auth/REST/RPC/Storage
          → kpi-team.js, kpi-cutover.js, utils, default-settings.js
scripts/ → build config + static gates + API/UI/SQL/harness tests
supabase-*.sql → artifact theo phase, không phải migration CLI chuẩn
*.md → tài liệu, runbook, audit và rollout lịch sử
vercel.json → static hosting, output thư mục gốc
```

Nghiệp vụ tập trung trong `crm-app.js`: khách hàng/phân công/chăm sóc, employee/identity, products, KPI, cấu hình/quản trị. Không có framework bundler hay backend application riêng trong repo.

## 8. Environment files

Inventory filesystem không thấy `.env`, `.env.local`, `.env.production`, `.env.example` hay `.env*` khác; không có `.maintenance-on`. `.gitignore` loại env và cho phép `.env.example`.

Runtime dùng `window.CRM_SUPABASE_CONFIG` trong `js/supabase-config.js`; URL và anon key đều hiện diện, không in key. Local và config HTTP production đều dùng `jjeeazwlqcwynzquimeo`; không thấy staging cũ trong runtime.

Build đọc `process.env.VITE_MAINTENANCE_MODE` và `.maintenance-on`; không có dotenv loader. Prefix VITE không có nghĩa dùng Vite. Biến này vắng trong process local nên default OFF; không bắt buộc để build, nhưng phải xác minh Production scope/value trước deploy giữ bảo trì.

Tên biến test: `STAGING_PROJECT_REF`, `STAGING_SUPABASE_URL`, `STAGING_ANON_KEY`, `STAGING_SERVICE_ROLE_KEY`, `IDENTITY_TEST_PASSWORD`, `IDENTITY_TEST_MANIFEST`, `KPI21E_TEST_MODE`, `KPI21E_RUN_ID`, `KPI21E_TEST_PASSWORD`, `KPI2_CLEAN_TEST_AUDIT`; UI paths dùng prefix `KPI1_`, `KPI2_`, `KPI21B_`, `KPI21E_`, `KPI21E2R_` với hậu tố `PLAYWRIGHT_ENTRY`/`BROWSER_PATH`. Harness có `PGHOST`, `PGPORT`, `PGUSER`; tài liệu có `SUPABASE_DB_URL`.

Không thấy biến Supabase/Vercel/DB/staging/maintenance liên quan trong process được kiểm tra. Không coi token env vắng là CLI chưa login vì CLI dùng credential store riêng. Vercel env names/scopes/values hiện chưa đọc được do quyền.

## 9. Supabase CLI

`supabase 2.116.0`, wrapper `C:\Users\ADMIN\AppData\Roaming\npm\supabase.ps1`. `supabase projects list` chạy được, trả một project `dvkvoydcfkapyhcdjnst` (`app so de`, INACTIVE), không có production `jjeeazwlqcwynzquimeo`.

Credential CLI hoạt động với phạm vi đang trả về, nhưng chưa đạt Auth CLI readiness cho production CRM. Kết quả không cung cấp danh tính email chủ credential. Không nâng CLI, không lấy API keys, không apply SQL.

## 10. Supabase project/link

Không có `supabase/config.toml`, `supabase/.temp/project-ref` hay thư mục local Supabase. CLI ghi `Cannot find project ref. Have you run supabase link?` và vẫn liệt kê project accessible.

Local link **CHƯA LINK**, không phải link staging. Expected ref được xác minh trong frontend/public Auth API, chưa được xác minh quyền quản trị. Không `supabase init`/`supabase link`.

## 11. Database/migration state

Git inventory có 45 file SQL: 35 root (gồm baseline harness), 10 trong scripts. Không có `supabase/migrations/` theo timestamp. Regex inventory có 114 tên `create or replace function public.*` phân biệt, gồm lịch sử/harness/tests; không phải số RPC live.

Artifact hiện diện: identity linking repair; hotfix R1-0 fail-closed; onboarding R1; P0-A/P0-B; KPI consolidated, staged evidence lifecycle, September cutover, draft delete, safe undo; products lightweight catalog. Commit mới nhất 18/08/2026 thêm products; commit 17/08/2026 chứa hotfix/onboarding.

`KPI-2-PRODUCTION-RUNBOOK.md:27` ghi history không canonical, không tự repair hoặc lấy automatic `db push` làm authority. Đây là tài liệu lịch sử, chưa phải live read-back.

| Kiểm tra production | Kết quả |
|---|---|
| Applied migration history | CHƯA XÁC MINH — thiếu quyền production |
| Schema drift | CHƯA XÁC MINH — thiếu schema live |
| RPC definitions/grants, fail-closed live | CHƯA XÁC MINH |
| RLS enabled/policy count live | CHƯA XÁC MINH; không đếm SQL lịch sử để thay thế |
| Extensions live | CHƯA XÁC MINH; source có `pgcrypto` |
| Storage buckets live | CHƯA XÁC MINH; source có `kpi-evidence` public, `kpi2-evidence` private |
| Counts app_users/customers/customer_assignments/care/history/KPI/products | CHƯA XÁC MINH; không dump business data |

Không query catalog/count DB hay invoke RPC. Không dùng count anon bị RLS lọc làm tổng baseline. Sau khi có quyền, dùng transaction read-only đọc history/catalog/functions/grants/policies/extensions/buckets và tổng counts; xác định chính xác tên bảng care/history từ catalog trước.

## 12. Auth/identity state

Canonical mapping source: `auth.users.id → app_users.supabase_auth_id → app_users.id`.

Hotfix có `crm_is_admin()` dùng `coalesce(..., false)`, `crm_current_user_role()` dùng canonical lookup/coalesce chuỗi rỗng, cùng các helper manager/owner-admin fail-closed. Test identity/onboarding PASS; lookup frontend được kiểm tra không có email fallback cho authority.

RPC source: `crm_create_employee`, `crm_update_employee_profile`, `crm_deactivate_employee`, `crm_reactivate_employee`, `crm_archive_employee`, `crm_claim_employee_identity_on_first_login`, `crm_relink_returning_employee_identity`, `crm_restore_archived_employee`, `crm_employee_identity_status`. UI gọi first-login claim tại `js/features/crm-app.js:818`. Onboarding SQL có precondition hotfix/index; email chỉ discovery; returning employee đi qua lifecycle/relink. Sự hiện diện trong source không chứng minh đã apply production.

Read-only `GET https://jjeeazwlqcwynzquimeo.supabase.co/auth/v1/settings` bằng anon key hiện có trả 200: `external.google=true`, `external.email=true`, `external.anonymous_users=false`, `disable_signup=false`, `mailer_autoconfirm=false`. Không đọc secret. Xác minh provider presence, không chứng minh callback/session OAuth. Redirect allowlist và full Auth config chưa có quyền đọc.

## 13. Login maintenance mode

GET [production](https://crmkolor.vercel.app/) và `/js/config/maintenance.generated.js` trả 200, generated `enabled: true`. `js/app.js` production có guard giống local: ON thì hiện maintenance, không load Supabase/CRM module. Local generated `false`, không bị thay trong audit.

Cơ chế xác minh được: **frontend guard từ build-generated config**. Google provider không bị tắt. Chưa xác định đầu vào build production là `VITE_MAINTENANCE_MODE` hay `.maintenance-on` trong deployment workspace; output ON không chỉ rõ nguồn bật. HEAD không có lock file.

| Câu hỏi | Trả lời |
|---|---|
| A. Chặn build/test? | Không; build/static đã chạy |
| B. Chặn API/backend inspection? | Không do frontend guard; public Auth GET hoạt động. DB đang vướng quyền account riêng |
| C. Chặn real-role smoke? | Có với luồng UI đang phục vụ, mọi vai trò ở maintenance. Direct Auth API có thể vẫn hoạt động; không thử login |
| D. Bật lại ở đâu? | Trong đúng Vercel project, xác minh rồi đặt `VITE_MAINTENANCE_MODE=false`/bỏ biến, bỏ `.maintenance-on` nếu deployment có, build/deploy lại và read-back; chưa thực hiện |

Frontend guard không thu hồi token, không đảm bảo chặn session cũ/direct API ghi DB. Không kết luận có database write freeze hay thay đổi RLS/Auth.

## 14. Vercel CLI/project

`vercel 59.10.0`, wrapper `C:\Users\ADMIN\AppData\Roaming\npm\vercel.ps1`. `whoami`: `ksngltech-eng`; `teams ls`: context `ksngl`, team name `KSNGL`; `project ls`: không có project trong context này.

`vercel project ls --scope thien-di-s-projects1` trả `The specified scope does not exist`; điều này nói về access hiện tại, không chứng minh team thật bị xóa. `vercel inspect https://crmkolor.vercel.app/` không tìm thấy deployment dưới `ksngl`.

`.vercel/project.json` không tồn tại: CHƯA LINK, chưa có local projectId/orgId. Không suy team slug thành org ID. GitHub Vercel status chỉ đến `thien-di-s-projects1/crm_kolor`; cần live project access trước link/deploy.

## 15. Current production deployment

DNS A: `64.29.17.3`, `216.198.79.3`; HTTPS 200, server Vercel; maintenance ON live.

GitHub deployment `5954575253`, environment Production, SHA `97f0dc5e79aebe82503152be8be96baba85365af`. Status mới nhất `2026-09-08T01:54:35Z`: success, `Deployment has completed`, URL [deployment ghi nhận qua GitHub](https://crmkolor-2016ifqqu-thien-di-s-projects1.vercel.app). Cùng record có status cũ 18/08/2026 với URL deployment khác.

[Vercel commit status](https://vercel.com/thien-di-s-projects1/crm_kolor/7oRLJP9TnBNqsNeqT9Xqv1cWhSgv) success. Chưa đọc được live alias mapping domain→deployment ID. Chưa lấy được đầy đủ recent failed deployments; không tuyên bố không có failure.

HTTP `index.html`, `js/app.js`, `js/supabase-config.js`, `js/features/crm-app.js` khớp local sau chuẩn hóa CRLF/LF và BOM. Hai diff ban đầu chỉ là BOM đầu file khi đọc `Response.text()`. Generated maintenance khác local đúng mục đích build. So khớp một số asset không chứng minh SHA toàn deployment.

## 16. GitHub→Vercel pipeline

Bằng chứng pipeline đã chạy: HEAD có Vercel success và Production deployment cùng SHA. GitHub default branch main.

`vercel.json`: build `node scripts/generate-maintenance-config.mjs`, install rỗng, output `.`, framework null, Cache-Control no-store, rewrites `/` và `/admin/:path*` về index.

Chưa đọc được live Git integration binding, production branch, build/output overrides hoặc env scopes do quyền. Pipeline được nhận diện qua GitHub nhưng chưa xác minh đầy đủ cấu hình hiện hành. Không tự coi GitHub default branch là Vercel production branch.

## 17. Local vs remote vs deployed commit

| Nguồn | Kết quả |
|---|---|
| Local HEAD | `97f0dc5e79aebe82503152be8be96baba85365af` |
| origin/main và main live | Cùng SHA |
| GitHub Production deployment record | Cùng SHA, success |
| Vercel deployment đang được domain alias phục vụ | SHA chưa xác minh trực tiếp |

**Phân loại: E. UNKNOWN.** Thiếu live alias→deployment→commit chain, chưa tuyên bố ALL MATCH. Không có local unpushed/behind trên main tại thời điểm kiểm tra.

## 18. Build

**PASS**. Command đúng từ vercel.json là `node scripts/generate-maintenance-config.mjs`, không phải npm build.

Chạy chính script repo bằng absolute path, cwd `%TEMP%\crm-dev-readiness-audit-20260908\build` để không ghi đè tracked generated config. Script đọc env/lock theo cwd, output `Maintenance mode: OFF`, generated JS hợp lệ. Đây là build với môi trường local, không mô phỏng production env ON. Không đổi login local/production.

Không chạy `build-phase-kpi2-consolidated.mjs` vì nó ghi SQL artifact tracked. Không có bundling/npm lifecycle cần chạy.

## 19. Static/tests

Inventory imports/đường thực thi trước khi chạy: các bộ static chỉ đọc file/assert/helper local, không gọi production hay tạo DB fixture.

| Command | Kết quả working tree |
|---|---|
| `node scripts/test-phase-auth-identity.mjs` | PASS |
| `node scripts/test-phase-employee-onboarding-r1.mjs` | PASS |
| `node scripts/test-phase-kpi1.mjs` | PASS |
| `node scripts/test-phase-kpi2.mjs` | FAIL — SHA256/CRLF |
| `node scripts/test-phase-kpi21b.mjs` | PASS |
| `node scripts/test-phase-kpi21e.mjs` | PASS |
| `node scripts/test-phase-kpi21e2.mjs` | PASS |
| `node scripts/test-phase-kpi21e2r.mjs` | PASS |
| `node scripts/test-phase-kpi2r2.mjs` | PASS |
| `node scripts/test-phase-p0a.mjs` | PASS |
| `node scripts/test-phase-p0b.mjs` | PASS |

Syntax `node --check` PASS 41/41 JS/MJS trong js/scripts, gồm cú pháp staging scripts nhưng không thực thi staging. Duplicate ID `index.html`: không trùng. Asset local HTML: không thiếu. `git diff --check`: PASS. Không có lint framework/package riêng; syntax không thay thế lint đầy đủ. Không thấy product-specific static test riêng; sản phẩm chưa được real-role CRUD smoke.

KPI-2 exact SHA256:

- Checkout CRLF: `884d8f521dd74883c5b95ab68418c8ea10a57c5710267cbe7b2f20556a7e8cd3`.
- Git blob HEAD LF và runbook: `eb33f45534d96f335f494d12ba67b884d96360be5e03020092682945efdf0236`.
- Normalize LF trong bộ nhớ khớp Git blob. `git ls-files --eol`: `i/lf w/crlf`; global autocrlf true.
- Bản sao git archive cũng có CRLF nên lần chẩn đoán đầu vẫn FAIL. Thay duy nhất artifact trong bản sao tạm bằng bytes Git blob rồi chạy test nguyên bản: **PASS 172 checks**. Không sửa expected hash/test/source thật. Working tree gate vẫn FAIL, cần xử lý trước dùng artifact rollout.

Phân loại mọi script: PRODUCTION WRITE nghĩa có ghi nếu target production, không có nghĩa đã thực thi.

| Script | Phân loại | Quyết định |
|---|---|---|
| `scripts/build-phase-kpi2-consolidated.mjs` | SAFE LOCAL | Ghi SQL artifact local; không chạy |
| `scripts/capture-pre-change-references.sql` | SAFE READ-ONLY PRODUCTION | SELECT có dữ liệu định danh chi tiết; không chạy nguyên file trong audit counts-only |
| `scripts/check-phase-kpi2-staging-clean.mjs` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/cleanup-phase-kpi2-staging-fixtures.mjs` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/generate-maintenance-config.mjs` | SAFE LOCAL | Chạy trong cwd tạm; sinh file local |
| `scripts/run-employee-onboarding-r1-prod-local.sh` | PRODUCTION WRITE | Harness mặc định local nhưng DROP schema và PGHOST override; không chạy |
| `scripts/run-phase-auth-identity-staging.ps1` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/run-phase-kpi1-staging-api.ps1` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/run-phase-kpi1-staging-ui.ps1` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/run-phase-kpi2-staging-api.ps1` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/run-phase-kpi2-staging-clean-check.ps1` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/run-phase-kpi2-staging-fixture-cleanup.ps1` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/run-phase-kpi2-staging-ui.ps1` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/run-phase-kpi21b-staging-ui.ps1` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/run-phase-kpi21e-staging-api.ps1` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/run-phase-kpi21e2r-staging-api-ui.ps1` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/run-phase-kpi2r2-attached-serialization.ps1` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/run-phase-kpi2r2-staging-api.ps1` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/run-phase-kpi2r2-staging-ui.ps1` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/test-hotfix-r1-0-fail-closed.sql` | PRODUCTION WRITE | Có DDL/DML/fixture nếu trỏ production; không chạy |
| `scripts/test-kpi21e2-draft-config-delete.sql` | PRODUCTION WRITE | Có DDL/DML/fixture nếu trỏ production; không chạy |
| `scripts/test-phase-auth-identity-staging-api.mjs` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/test-phase-auth-identity.mjs` | SAFE LOCAL | Đã chạy |
| `scripts/test-phase-employee-onboarding-r1-integration.sql` | PRODUCTION WRITE | Có DDL/DML/fixture nếu trỏ production; không chạy |
| `scripts/test-phase-employee-onboarding-r1.mjs` | SAFE LOCAL | Đã chạy |
| `scripts/test-phase-kpi1-integration.sql` | PRODUCTION WRITE | Có DDL/DML/fixture nếu trỏ production; không chạy |
| `scripts/test-phase-kpi1-staging-api.mjs` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/test-phase-kpi1-staging-ui.mjs` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/test-phase-kpi1.mjs` | SAFE LOCAL | Đã chạy |
| `scripts/test-phase-kpi2-staging-api.mjs` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/test-phase-kpi2-staging-ui.mjs` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/test-phase-kpi2.mjs` | SAFE LOCAL | Đã chạy |
| `scripts/test-phase-kpi21b-staging-ui.mjs` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/test-phase-kpi21b.mjs` | SAFE LOCAL | Đã chạy |
| `scripts/test-phase-kpi21e-staging-api.mjs` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/test-phase-kpi21e-staging-ui.mjs` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/test-phase-kpi21e.mjs` | SAFE LOCAL | Đã chạy |
| `scripts/test-phase-kpi21e2.mjs` | SAFE LOCAL | Đã chạy |
| `scripts/test-phase-kpi21e2r-integration.sql` | PRODUCTION WRITE | Có DDL/DML/fixture nếu trỏ production; không chạy |
| `scripts/test-phase-kpi21e2r-staging-api-ui.mjs` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/test-phase-kpi21e2r.mjs` | SAFE LOCAL | Đã chạy |
| `scripts/test-phase-kpi2r2-attached-serialization.sql` | PRODUCTION WRITE | Có DDL/DML/fixture nếu trỏ production; không chạy |
| `scripts/test-phase-kpi2r2-staging-api.mjs` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/test-phase-kpi2r2-staging-ui.mjs` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/test-phase-kpi2r2.mjs` | SAFE LOCAL | Đã chạy |
| `scripts/test-phase-p0a-integration.sql` | PRODUCTION WRITE | Có DDL/DML/fixture nếu trỏ production; không chạy |
| `scripts/test-phase-p0a-staging-api.mjs` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/test-phase-p0a.mjs` | SAFE LOCAL | Đã chạy |
| `scripts/test-phase-p0b-integration.sql` | PRODUCTION WRITE | Có DDL/DML/fixture nếu trỏ production; không chạy |
| `scripts/test-phase-p0b-staging-api.mjs` | REQUIRES OLD STAGING | Có thể ghi fixture hoặc yêu cầu session; không chạy |
| `scripts/test-phase-p0b.mjs` | SAFE LOCAL | Đã chạy |
| `scripts/test-security-regression-after-rollout.sql` | PRODUCTION WRITE | Có DDL/DML/fixture nếu trỏ production; không chạy |

`check-phase-kpi2-staging-clean.mjs` có DELETE audit_logs khi `KPI2_CLEAN_TEST_AUDIT=1`, không luôn read-only. UI staging/real-role tests đồng thời REQUIRES LOGIN. SQL rollback vẫn có ghi fixture nên không chạy. Harness local DROP schema và nhận PGHOST override; cần sandbox DB được xác minh khi dùng sau này.

## 20. Old staging references

Quét mọi file Git tracked, gồm file bị mặc định ignore: 40 occurrence theo dòng, 37 file của `ykhtpvyelpujykheycsv`. Không occurrence trong index/js/css/vercel.json; không có env file/CI hiện hành chứa ref. Runtime config live đúng production.

| Vị trí | Phân loại |
|---|---|
| `KPI-1-FOUNDATION-IMPLEMENTATION.md:7` | documentation only |
| `KPI-1-PRODUCTION-READINESS-AUDIT.md:6` | documentation only |
| `KPI-1-PRODUCTION-READINESS-AUDIT.md:30` | documentation only |
| `KPI-1-PRODUCTION-ROLLOUT.md:5` | documentation only |
| `KPI-1-PRODUCTION-ROLLOUT.md:49` | documentation only |
| `KPI-2-PRODUCTION-RUNBOOK.md:9` | documentation only |
| `KPI-2-SUBMISSION-REVIEW-EVIDENCE.md:5` | documentation only |
| `KPI-2.1B-EMPLOYEE-CENTRIC-MANAGER-KPI-UX-IMPLEMENTATION.md:7` | documentation only |
| `PHASE-P0A-STAGING-VALIDATION.md:25` | documentation only |
| `PHASE-P0A-STAGING-VALIDATION.md:31` | documentation only |
| `PHASE-P0A-TRANSACTION-RLS.md:282` | documentation only |
| `PHASE-P0AB-PRODUCTION-ROLLOUT.md:20` | documentation only |
| `PHASE-P0B-EMPLOYEE-ASSIGNMENT-ARCHITECTURE.md:6` | documentation only |
| `scripts/check-phase-kpi2-staging-clean.mjs:6` | retired staging test/script |
| `scripts/cleanup-phase-kpi2-staging-fixtures.mjs:6` | retired staging test/script |
| `scripts/run-phase-auth-identity-staging.ps1:3` | retired staging test/script |
| `scripts/run-phase-kpi1-staging-api.ps1:3` | retired staging test/script |
| `scripts/run-phase-kpi1-staging-ui.ps1:3` | retired staging test/script |
| `scripts/run-phase-kpi2-staging-api.ps1:2` | retired staging test/script |
| `scripts/run-phase-kpi2-staging-clean-check.ps1:3` | retired staging test/script |
| `scripts/run-phase-kpi2-staging-fixture-cleanup.ps1:2` | retired staging test/script |
| `scripts/run-phase-kpi2-staging-ui.ps1:1` | retired staging test/script |
| `scripts/run-phase-kpi21b-staging-ui.ps1:2` | retired staging test/script |
| `scripts/run-phase-kpi21e-staging-api.ps1:4` | retired staging test/script |
| `scripts/run-phase-kpi21e2r-staging-api-ui.ps1:2` | retired staging test/script |
| `scripts/run-phase-kpi2r2-attached-serialization.ps1:7` | retired staging test/script |
| `scripts/run-phase-kpi2r2-staging-api.ps1:2` | retired staging test/script |
| `scripts/run-phase-kpi2r2-staging-ui.ps1:2` | retired staging test/script |
| `scripts/test-phase-kpi1-staging-api.mjs:4` | retired staging test/script |
| `scripts/test-phase-kpi1-staging-ui.mjs:8` | retired staging test/script |
| `scripts/test-phase-kpi2-staging-api.mjs:8` | retired staging test/script |
| `scripts/test-phase-kpi2-staging-ui.mjs:8` | retired staging test/script |
| `scripts/test-phase-kpi21b-staging-ui.mjs:11` | retired staging test/script |
| `scripts/test-phase-kpi21e-staging-api.mjs:3` | retired staging test/script |
| `scripts/test-phase-kpi21e-staging-ui.mjs:11` | retired staging test/script |
| `scripts/test-phase-kpi21e2r-staging-api-ui.mjs:11` | retired staging test/script |
| `scripts/test-phase-kpi2r2-staging-api.mjs:4` | retired staging test/script |
| `scripts/test-phase-kpi2r2-staging-ui.mjs:11` | retired staging test/script |
| `scripts/test-phase-p0a-staging-api.mjs:4` | retired staging test/script |
| `scripts/test-phase-p0b-staging-api.mjs:4` | retired staging test/script |

Các staging scripts ngừng sử dụng theo owner vì staging đã đóng. Không chạy hay đổi staging ref sang production để làm test chạy. Tài liệu cũ không chứng minh link hiện tại.

## 21. Production access readiness

| Capability | Hiện trạng |
|---|---|
| Public Auth settings read-only | Đã xác minh HTTP 200 |
| Production schema/count queries | Chưa sẵn sàng qua quyền đã kiểm tra |
| Supabase CLI | Chạy được, không thấy production CRM |
| Management API production | Chưa chứng minh quyền; project list thiếu CRM |
| Apply SQL | Chưa chứng minh credential/đúng đích, không thử |
| Invoke RPC | Adapter/anon có; quyền cần session/grants/RLS, chưa invoke |
| Edit local | Filesystem cho phép; không sửa source trong audit |
| Build local | PASS |
| Commit local | Git/author config có; không tạo commit thử |
| Push | CLI account READ, chưa sẵn sàng |
| GitHub/Vercel deploy | Chưa sẵn sàng với context hiện tại |

Không xuất keys/token hay dump business data. Login OFF không cấp quyền DB cho Codex.

## 22. Secret scan

Quét nội dung mọi tracked file trước báo cáo: GitHub token, Supabase access/secret key, private key, PostgreSQL URL chứa password, JWT role. Chỉ ghi vị trí/loại, không in match. Anon JWT hiện diện không phải privileged secret.

Hai URL cảnh báo `PHASE-4-13-DATA-SAFETY-BACKUP.md:41` và `:102` được kiểm tra trong bộ nhớ là PASSWORD placeholder, không mật khẩu thật. Không phát hiện privileged token/private key/JWT khác anon trong các pattern. Không có env local; gitignore loại env/backups/exports.

Giới hạn: pattern scan current tree, không phải chứng nhận toàn bộ history/mọi token format/Vercel env. Gitleaks không có trên PATH, không cài scanner. Không đọc credential store. Kết quả: không phát hiện secret thật trong phạm vi đã quét.

## 23. Path consistency

Authority `D:\DU AN CUA TOI\CRM-KOLORCERAMIC`. Có 38 vị trí hard-code các đường dẫn `D:\SUPABASE\CRM-KOLORCERAMIC`, `D:\SUPABASE\BACKUP-TEMP`, `D:\Github\CRM-KOLORCERAMIC`; README preview dùng đường dẫn Github cũ.

| Vị trí | Phân loại |
|---|---|
| `CRM-KOLORCERAMIC-AUDIT.md:15` | tài liệu/lệnh mẫu |
| `EMPLOYEE-ONBOARDING-R1-NEW-FIRST-LOGIN-RETURNING-EMPLOYEE-RELINK.md:4` | tài liệu/lệnh mẫu |
| `EMPLOYEE-ONBOARDING-R1-PRODUCTION-ROLLOUT.md:4` | tài liệu/lệnh mẫu |
| `KPI-0-BUSINESS-SPEC-AND-ARCHITECTURE.md:4` | tài liệu/lệnh mẫu |
| `KPI-1-FOUNDATION-IMPLEMENTATION.md:15` | tài liệu/lệnh mẫu |
| `KPI-1-FOUNDATION-IMPLEMENTATION.md:234` | tài liệu/lệnh mẫu |
| `KPI-1-PRODUCTION-READINESS-AUDIT.md:4` | tài liệu/lệnh mẫu |
| `KPI-2-SUBMISSION-REVIEW-EVIDENCE.md:4` | tài liệu/lệnh mẫu |
| `KPI-2.1B-EMPLOYEE-CENTRIC-MANAGER-KPI-UX-IMPLEMENTATION.md:4` | tài liệu/lệnh mẫu |
| `KPI-2.1B-EMPLOYEE-CENTRIC-MANAGER-KPI-UX-IMPLEMENTATION.md:301` | tài liệu/lệnh mẫu |
| `KPI-2.1E-SEPTEMBER-CANONICAL-CUTOVER-LEGACY-WRITE-FREEZE.md:3` | tài liệu/lệnh mẫu |
| `KPI-2.1E.1-SEPTEMBER-KPI-BUSINESS-CONFIGURATION.md:5` | tài liệu/lệnh mẫu |
| `PHASE-4-13-DATA-SAFETY-BACKUP.md:34` | tài liệu/lệnh mẫu |
| `PHASE-P0A-STAGING-VALIDATION.md:4` | tài liệu/lệnh mẫu |
| `PHASE-P0A-STAGING-VALIDATION.md:203` | tài liệu/lệnh mẫu |
| `PHASE-P0AB-PRODUCTION-ROLLOUT.md:17` | tài liệu/lệnh mẫu |
| `PHASE-P0AB-PRODUCTION-ROLLOUT.md:104` | tài liệu/lệnh mẫu |
| `PHASE-P0B-EMPLOYEE-ASSIGNMENT-ARCHITECTURE.md:4` | tài liệu/lệnh mẫu |
| `README.md:19` | tài liệu/lệnh mẫu |
| `scripts/run-phase-auth-identity-staging.ps1:5` | script thực thi |
| `scripts/run-phase-auth-identity-staging.ps1:6` | script thực thi |
| `scripts/run-phase-auth-identity-staging.ps1:7` | script thực thi |
| `scripts/run-phase-kpi1-staging-api.ps1:5` | script thực thi |
| `scripts/run-phase-kpi1-staging-ui.ps1:5` | script thực thi |
| `scripts/run-phase-kpi1-staging-ui.ps1:6` | script thực thi |
| `scripts/run-phase-kpi2-staging-ui.ps1:1` | script thực thi |
| `scripts/run-phase-kpi21b-staging-ui.ps1:3` | script thực thi |
| `scripts/run-phase-kpi21e-staging-api.ps1:3` | script thực thi |
| `scripts/run-phase-kpi21e-staging-api.ps1:6` | script thực thi |
| `scripts/run-phase-kpi21e-staging-api.ps1:8` | script thực thi |
| `scripts/run-phase-kpi21e2r-staging-api-ui.ps1:3` | script thực thi |
| `scripts/run-phase-kpi2r2-attached-serialization.ps1:2` | script thực thi |
| `scripts/run-phase-kpi2r2-attached-serialization.ps1:3` | script thực thi |
| `scripts/run-phase-kpi2r2-staging-ui.ps1:3` | script thực thi |
| `scripts/test-phase-kpi21b-staging-ui.mjs:143` | script thực thi |
| `supabase-hotfix-r1-0-crm-is-admin-fail-closed.sql:3` | chú thích SQL |
| `supabase-phase-crm-products-r1-lightweight-catalog.sql:3` | chú thích SQL |
| `supabase-phase-employee-onboarding-r1-prod.sql:5` | chú thích SQL |

Static gates đã chạy không phụ thuộc đường dẫn cũ. PS1/UI staging có thể fail hoặc dùng sai runtime do hard-code, không chạy. Không rewrite lịch sử. Preview đề xuất sau audit: từ root đúng, `python -m http.server 5181 --bind 127.0.0.1` nếu Python sẵn; chưa chạy preview.

## 24. Login-off impact

Không chặn source/Git/build/static/helper tests, backend inspection với credential đúng hoặc deploy mechanism. Thiếu quyền GitHub/Supabase/Vercel độc lập với maintenance.

Hoãn Google OAuth end-to-end, Sale RLS real-session, Manager/Admin real-session, employee first-login, returning relink/rehire, product CRUD real-role. Không tạo session/login. Không yêu cầu mở login chỉ để audit.

Frontend maintenance không là DB write freeze toàn diện: session cũ/direct API có thể ghi theo grants/RLS. Rollout sau này phải xác minh trạng thái ghi cạnh tranh riêng; không tự thay RLS/Auth trong phase này.

## 25. Readiness matrix

| Component | Status | Evidence | Blocker? |
|---|---|---|---|
| Git | PASS | Đúng repo, SHA khớp live remote | Không |
| GitHub | BLOCKED | ksngltech-eng READ | Có, push |
| Node | PASS | 24.19.0, tests chạy | Không |
| npm/pnpm | PASS/không áp dụng | npm 11.17.0, không manifest | Không |
| Dependencies | PASS static | Built-ins/vendored assets | Không static |
| Build | PASS | Generator trong cwd tạm | Không |
| Tests | CẦN XỬ LÝ | 10/11, KPI-2 CRLF; Git blob PASS | Có artifact gate |
| Supabase CLI | PASS tooling | 2.116.0 | Không binary |
| Supabase Auth CLI | BLOCKED CRM | Project list không có CRM | Có |
| Supabase project link | CHƯA LINK | Không config/project-ref | Có CLI rollout |
| Production DB access | CHƯA XÁC MINH | Chỉ public Auth GET | Có |
| Migration state | CHƯA XÁC MINH | Thiếu live history/schema | Có DB rollout |
| Vercel CLI | BLOCKED CRM | Context ksngl không có CRM | Có |
| Vercel project link | CHƯA LINK | Không project.json/IDs | Có CLI deploy |
| GitHub→Vercel | MỘT PHẦN | GitHub success, live settings thiếu | Có trước deploy |
| Production domain | PASS | DNS/HTTPS 200, maintenance ON | Không |
| SHA gate | UNKNOWN | Thiếu live alias→deployment→commit | Có trước deploy |
| Environment variables | MỘT PHẦN | Runtime đúng ref, prod scopes thiếu | Có trước deploy |
| Old staging references | PASS runtime | 40 dòng docs/tests, không runtime | Không static |
| Login maintenance mode | ON có chủ đích | Generated true, Google bật | Không dev; smoke hoãn |
| Secret safety | Không phát hiện trong phạm vi | Pattern scan và placeholder triage | Không phát hiện blocker |
| Working tree | AN TOÀN | Trước sạch, sau chỉ report | Không |

## 26. Blockers

1. GitHub CLI chỉ READ, thiếu quyền push.
2. Supabase credential không thấy CRM, thiếu link và production read-back để xác minh migration/RPC/RLS/count baseline.
3. Vercel credential không có team CRM; thiếu link và live alias/commit/Git binding/production branch/env scope.
4. KPI-2 artifact checkout CRLF không đạt exact hash gate dù Git blob đúng.

Login OFF, không package.json và không node_modules không phải blocker của static project. Không có bằng chứng local source unsafe để chọn trạng thái blocked repository state.

## 27. Recommended fixes

Chỉ đề xuất, chưa thực hiện.

| Vấn đề | Fix đề xuất | Codex tự làm? | Owner cần làm? | Rủi ro |
|---|---|---|---|---|
| GitHub READ | Cấp Write cho ksngltech-eng hoặc dùng account được cấp; `gh auth login`/`gh auth switch --user <account>` nếu cần; kiểm lại viewerPermission và Git HTTPS identity | Kiểm tra được; không tự cấp quyền | Cấp quyền/chọn account/xác thực | Trung bình |
| Supabase không thấy CRM | `supabase login` với account đúng rồi `supabase projects list`, yêu cầu production ref xuất hiện | Kiểm tra khi có credential | Cấp membership hoặc login đúng; không gửi token vào chat | Cao nếu nhầm project |
| Supabase chưa link/DB access | Sau xác minh repo/account, chuẩn bị workspace CLI được duyệt nếu cần, `supabase link --project-ref jjeeazwlqcwynzquimeo`, read-only catalog/counts | Có ở phase sau khi được phép | Cấp DB access an toàn, review phạm vi | Cao |
| Migration state chưa rõ | Đọc history/schema/functions live, đối chiếu artifact; không tự repair/db push | Có khi có quyền | Review rollout/backup ở phase sau | Cao |
| Vercel sai scope | Login account có CRM; `vercel teams ls`, `vercel project ls --scope thien-di-s-projects1`, `vercel inspect https://crmkolor.vercel.app/ --scope thien-di-s-projects1` | Inspect được khi quyền đủ | Cấp quyền/chọn account đúng | Cao nếu deploy nhầm |
| Vercel link thiếu | Đọc projectId/orgId và Git/build/output/env; sau xác minh mới `vercel link --project crm_kolor --scope thien-di-s-projects1` | Có sau review phase sau | Cấp access | Trung bình |
| SHA/alias/env gate | Xác minh domain alias→deployment→SHA, production branch và maintenance env/lock; giữ ON trước smoke | Có khi có quyền | Cấp quyền đọc metadata cần thiết | Cao |
| CRLF exact hash | Review `.gitattributes` với `supabase-phase-kpi2-final-consolidated.sql text eol=lf`, bảo toàn local changes trước chuẩn hóa; kiểm exact SHA và chạy lại test. Artifact rollout có thể lấy exact Git blob khi được duyệt | Có sau owner review; không làm lúc này | Review policy repo | Thấp source, cao nếu bỏ qua hash |
| Staging/path cũ | Retire/guard scripts cũ, repo-relative paths cho scripts dùng lại; không đổi staging ref sang production | Có ở phase sau | Quyết định môi trường integration mới | Trung bình |
| Smoke hoãn | Sau rollout/read-back, mở login có kiểm soát, Admin/Manager/Sale/OAuth/onboarding/rehire/products smoke | Một phần sau session hợp lệ | Login tài khoản test, quyết định mở CRM | Cao nếu mở sớm |

Không cần `npm install`/`npm ci` cho project này. Không đổi expected hash để che CRLF, không đổi global autocrlf hàng loạt.

## 28. Final recommendation

Dừng sau báo cáo để owner review. Local có nền tảng build/static, nhưng phải xử lý account/quyền và các gate production trước triển khai.

Workflow sau khi giải quyết blocker: giữ login OFF → phát triển → local tests → xác minh backup/ghi cạnh tranh và rollout backend có kiểm soát → deploy frontend còn maintenance ON → read-back schema/RPC/deployment/config → mở login có kiểm soát cho Admin/Manager/Sale smoke → chỉ mở CRM khi PASS.

Không sửa source/config, install/nâng package, apply SQL, đổi data/RLS/Auth/login, commit/push/deploy. File mới duy nhất trong repo là báo cáo được yêu cầu này. Bằng chứng/bản sao chẩn đoán ở thư mục tạm đã nêu, không chứa secret values hay business-data dump.
