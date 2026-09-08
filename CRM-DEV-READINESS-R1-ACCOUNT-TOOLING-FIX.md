# CRM-DEV-READINESS-R1 — Account và tooling

Thời điểm: 08/09/2026, khoảng 22:43–22:48, Asia/Saigon. Repository: `D:\DU AN CUA TOI\CRM-KOLORCERAMIC`. Báo cáo này cập nhật kết quả của `CRM-DEV-READINESS-AUDIT.md`; không sửa báo cáo lịch sử.

## 1. Final result

**CRM DEV PARTIAL — LOCAL READY, PRODUCTION ACCOUNT ACCESS CÒN THIẾU**

Đã xử lý an toàn lỗi CRLF của artifact KPI-2: working tree hiện có đúng bytes Git blob LF và đúng expected SHA256; test KPI-2 PASS 172 checks ngay tại repo. Thêm `.gitattributes` chỉ áp dụng cho một file SQL. Toàn bộ 11 bộ static/helper test, syntax 41 file và build local đều PASS.

Chưa thể hoàn tất production readiness: GitHub CLI và Git HTTPS thực tế đều là account `ksngltech-eng`, chỉ đọc repo; Supabase CLI không thấy CRM production; Vercel CLI không có quyền team/project CRM. Không có account GitHub khác được CLI/Git Credential Manager liệt kê để chuyển sang. Những bước cấp quyền/đăng nhập đúng account cần owner thực hiện; đã dừng từng nhánh phụ thuộc quyền, không tự logout/xóa credential.

Maintenance production vẫn ON, HTTP 200. Không sửa CRM business code, không áp SQL, không ghi production, không deploy, không mở login, không commit/push.

## 2. GitHub account/permission

| Kiểm tra | Bằng chứng hiện tại |
|---|---|
| `gh auth status` | Chỉ liệt kê `ksngltech-eng`, active, keyring, HTTPS |
| `gh repo view hoathienbang87-beep/CRM-KOLORCERAMIC --json viewerPermission,nameWithOwner` | Repo đúng; `viewerPermission=READ` |
| `git credential-manager github list` | Chỉ `ksngltech-eng` |
| Effective Git credential helper | `manager`, từ system Git config |
| Git HTTPS credential thực tế | Resolve bằng `git credential fill` ở chế độ không tương tác; dùng credential trong bộ nhớ để GET GitHub `/user` và repo metadata |
| API `/user` qua Git credential | HTTP 200, `login=ksngltech-eng` |
| API repo qua cùng credential | HTTP 200; `pull=true`, `push=false`, `admin=false`, `maintain=false` |

Không in/lưu credential vào báo cáo hay file bằng chứng. Không chạy push kể cả dry-run; không tạo commit thử. Không dùng `gh auth switch` vì không có account thay thế được liệt kê.

**Owner cần làm một trong hai cách:**

1. Chủ repo cấp quyền Write cho `ksngltech-eng` tại phần quản lý quyền truy cập của repository `hoathienbang87-beep/CRM-KOLORCERAMIC`; account nhận lời mời nếu có. Sau đó kiểm lại `gh repo view ... --json viewerPermission` và quyền Git HTTPS phải là `push=true`.
2. Nếu muốn dùng account khác đã có Write/Admin, chạy `gh auth login --hostname github.com --git-protocol https` trong terminal cá nhân, đăng nhập đúng account; sau khi account xuất hiện, có thể `gh auth switch --user <account-đúng>`. Cần xác minh riêng Git HTTPS credential, vì đổi gh account không bảo đảm Git Credential Manager tự dùng cùng account. Không xóa credential cũ hàng loạt.

Không yêu cầu gửi token vào chat. Nhánh push dừng ở đây cho tới khi quyền được cấp.

## 3. Supabase account/project visibility

`supabase --version`: `2.116.0`. `supabase projects list` hoạt động nhưng chỉ trả project `dvkvoydcfkapyhcdjnst`, tên `app so de`, INACTIVE; không có `jjeeazwlqcwynzquimeo`.

Credential đang hợp lệ trong phạm vi account hiện tại, nhưng không chứng minh quyền CRM. CLI result không cung cấp email account; không tự đoán danh tính. Kiểm tra tên file cấu hình tại vị trí Supabase thông thường chỉ thấy telemetry/traces, không có profile thay thế được xác minh; không đọc traces hoặc quét credential stores để tìm token.

**Owner cần làm:** cấp quyền organization/project CRM cho account Supabase đang dùng, hoặc chạy `supabase login` trong terminal cá nhân và hoàn tất flow bằng account có quyền CRM. CLI help xác nhận `supabase login` hỗ trợ automatic login flow; không cần đưa token lên command line/chat. Không logout trước một cách mù quáng.

Sau đó chạy `supabase projects list`. Điều kiện bắt buộc: kết quả phải chứa chính xác `jjeeazwlqcwynzquimeo` trước khi link. Chưa đạt điều kiện này trong R1.

## 4. Supabase link

Local vẫn chưa có `supabase/config.toml` hoặc `supabase/.temp/project-ref`; chưa link. CLI báo `Cannot find project ref. Have you run supabase link?` khi list.

Không chạy link vì prerequisite production visible chưa đạt. Không tạo config/ID giả. Sau khi owner hoàn tất account access, command dự kiến từ repo đúng là:

```powershell
Set-Location -LiteralPath 'D:\DU AN CUA TOI\CRM-KOLORCERAMIC'
supabase projects list
supabase link --project-ref jjeeazwlqcwynzquimeo
```

Chỉ chạy dòng link sau khi dòng list có đúng production. Nếu CLI yêu cầu password/tương tác thì nhập an toàn trong terminal, không gửi vào báo cáo/chat. Sau link phải đọc local ref và xác nhận đúng project, rồi mới read-only DB proof. Nếu workflow yêu cầu khởi tạo local config, review thay đổi do CLI tạo trước; không tự giả lập project link.

Không `db push`, không apply migration, không repair history trong R1.

## 5. Production read-only DB proof

**Chưa hoàn tất** vì production account access và link chưa đạt. Không biến public anon access thành bằng chứng có quyền catalog/admin DB.

| Hạng mục live | Trạng thái R1 |
|---|---|
| Project ref qua CLI link | Chưa xác minh |
| Schema/catalog | Chưa query |
| Functions/RPC inventory | Chưa query |
| RLS enabled/policy inventory | Chưa query |
| Applied migration history | Chưa query |
| Storage buckets | Chưa query |
| Counts app_users/customers/assignments/care/KPI/products | Chưa query, không dump dữ liệu |
| Hotfix crm_is_admin live | Chưa đối chiếu định nghĩa live |
| Onboarding/employee lifecycle live | Chưa đối chiếu |
| Products R1 live | Chưa đối chiếu |

Source và static contract tương ứng hiện có, nhưng không thay thế live proof. Sau khi quyền/link đạt, cần catalog queries và tổng counts trong transaction read-only, xác minh actual function definitions/grants với reviewed SQL. Lịch sử migration được audit trước đó ghi không canonical; không tự repair hoặc dùng `db push` để làm khớp.

Năng lực apply approved SQL production vẫn **chưa được chứng minh**; không thử ghi để kiểm quyền.

## 6. Vercel account/team/project

| Command | Kết quả |
|---|---|
| `vercel whoami` | `ksngltech-eng` |
| `vercel teams ls` | Team context `ksngl`, tên `KSNGL` |
| `vercel project ls` | Không có project dưới `ksngl` |
| `vercel project ls --scope thien-di-s-projects1` | `The specified scope does not exist` |
| `vercel inspect https://crmkolor.vercel.app/` | Không tìm thấy deployment dưới context `ksngl` |

Lỗi scope phản ánh quyền hiện tại, không chứng minh team CRM đã bị xóa. GitHub deployment metadata vẫn chỉ đến `thien-di-s-projects1`; không đổi sang project khác cùng tên.

**Owner cần làm:** mời account hiện tại vào team/project thực tế đang phục vụ CRM với quyền inspect/deploy phù hợp, hoặc chạy `vercel login` và hoàn tất login bằng account có project đó. CLI help đã được đọc, xác nhận command login. Không chạy login mù quáng vì chưa có tương tác chọn account đúng, không logout/xóa credential cũ.

Sau đó chạy lại `vercel whoami`, `vercel teams ls`, `vercel project ls --scope thien-di-s-projects1` (hoặc scope live được xác minh). Phải thấy project thực sự phục vụ domain trước link.

## 7. Vercel link

`.vercel/project.json` vẫn chưa tồn tại; projectId/orgId chưa được lấy từ live API. Không tự điền IDs, không link vì đúng project chưa visible.

Sau khi đã nhìn thấy project và xác minh domain/Git binding, command dự kiến:

```powershell
vercel link --project crm_kolor --scope thien-di-s-projects1
```

Đây là command theo tên lịch sử có bằng chứng GitHub; phải dùng tên/IDs live nếu metadata hiện tại khác. Sau link, đọc `.vercel/project.json`, đối chiếu orgId/projectId với project live. Không deploy để thử link.

## 8. Production deployment reconciliation

| Nguồn | Bằng chứng |
|---|---|
| Local branch | `main` |
| HEAD | `97f0dc5e79aebe82503152be8be96baba85365af` |
| origin/main local | Cùng SHA |
| `git ls-remote origin refs/heads/main` trong R1 | Cùng SHA |
| GitHub Production deployment mới nhất | ID `5954575253`, cùng SHA |
| Status mới nhất của record | success, `2026-09-08T01:54:35Z` |
| URL từ record | `https://crmkolor-2016ifqqu-thien-di-s-projects1.vercel.app` |
| Domain thực tế | HTTP 200, maintenance ON |
| Live alias→deployment→commit | Chưa đọc được do quyền Vercel |
| Live Git integration/production branch | Chưa đọc được |

Local/remote/GitHub deployment record khớp. **Gate deployed SHA vẫn UNKNOWN** vì chưa chứng minh alias `crmkolor.vercel.app` đang trỏ đúng record/deployment nào. Không coi GitHub deployment record là live alias proof. Không deploy để làm SHAs khớp.

Source `vercel.json` vẫn là static deployment: build `node scripts/generate-maintenance-config.mjs`, output `.`, install rỗng, framework null. Chưa xác minh live overrides/env scopes.

## 9. Maintenance state

R1 đã GET domain, `/js/config/maintenance.generated.js`, `/js/app.js`: cả ba HTTP 200; generated `enabled: true`, app có maintenance guard. **Production vẫn ON, người dùng vẫn bị chặn ở frontend.**

Cơ chế xác minh được là generated frontend config. Build source bật khi `.maintenance-on` tồn tại **hoặc** `VITE_MAINTENANCE_MODE` truthy. Repo local không có lock file, generated local false. Chưa đọc được Production env/deployment workspace nên chưa thể kết luận chính xác đầu vào nào đang bật production.

Để mở lại sau này phải kiểm tra cả Production env và lock file trong đúng deployment, loại mọi nguồn bật, build/deploy và read-back trong cửa sổ smoke có kiểm soát. Chưa thực hiện. Maintenance frontend không tự thu hồi token/khóa mọi API session cũ; không coi đây là DB write freeze.

Build thử ở cwd tạm trả `Maintenance mode: OFF` chỉ là output local cô lập, không đổi file generated trong repo hay production. Real-role/Auth smoke tiếp tục hoãn, không phải blocker tooling.

## 10. KPI-2 CRLF/hash gate

Trước sửa đã xác minh working copy khác Git blob **chỉ CRLF**, không có nội dung cần bảo toàn ngoài EOL. SHA Git blob đúng expected. Không có `.gitattributes` trước R1. Diff cấu hình chuẩn bị:

```diff
diff --git a/.gitattributes b/.gitattributes
new file mode 100644
--- /dev/null
+++ b/.gitattributes
@@ -0,0 +1 @@
+/supabase-phase-kpi2-final-consolidated.sql text eol=lf
```

Đã tạo file này, rồi lấy đúng bytes Git blob của artifact vào working tree sau kiểm tra equality normalize LF và exact expected hash. Không chạy mass normalization, không sửa business SQL, không đổi expected hash, không đổi global `core.autocrlf` (vẫn true).

| Kiểm tra | Kết quả |
|---|---|
| SHA256 working copy | `eb33f45534d96f335f494d12ba67b884d96360be5e03020092682945efdf0236` |
| Bytes working copy so HEAD blob | Trùng tuyệt đối |
| `git ls-files --eol` | `i/lf w/lf attr/text eol=lf` |
| `git check-attr text eol` target | text set, eol lf |
| Kiểm tra artifact onboarding khác | eol unspecified, không bị rule tác động |
| `node scripts/test-phase-kpi2.mjs` tại repo | PASS 172 checks |
| `git diff --exit-code -- <artifact>` | 0, không có content diff |

`git status` vẫn đánh `M` artifact sau thay bytes CRLF→LF, trong khi diff content rỗng và so bytes HEAD khớp; phân loại là EOL/working-tree metadata, không thay nghiệp vụ. Không stage hoặc chỉnh index để làm sạch biểu tượng. Quy tắc mới chưa commit; cần được review/commit ở bước được owner cho phép để checkout sau tiếp tục LF.

Kiểm tra cuối trên working tree:

| Bộ kiểm tra | Kết quả |
|---|---|
| test-phase-auth-identity.mjs | PASS |
| test-phase-employee-onboarding-r1.mjs | PASS |
| test-phase-kpi1.mjs | PASS |
| test-phase-kpi2.mjs | PASS |
| test-phase-kpi21b.mjs | PASS |
| test-phase-kpi21e.mjs | PASS |
| test-phase-kpi21e2.mjs | PASS |
| test-phase-kpi21e2r.mjs | PASS |
| test-phase-kpi2r2.mjs | PASS |
| test-phase-p0a.mjs | PASS |
| test-phase-p0b.mjs | PASS |
| `node --check` JS/MJS | PASS 41/41 |
| Duplicate HTML ID | PASS, không trùng |
| `git diff --check` | PASS |
| Build generator | PASS trong cwd tạm, không ghi generated source |

Mỗi test bảng trên chạy bằng `node scripts/<tên-file>`. Không chạy staging/API/UI/SQL fixture tests. Không có package.json nên không có npm build/install cần thực hiện. Bằng chứng chẩn đoán R1 tại `%TEMP%\crm-dev-readiness-r1-20260908`.

## 11. Path/script state

Các executable occurrence chính xác của `D:\SUPABASE\CRM-KOLORCERAMIC`:

| File/dòng | Phân loại |
|---|---|
| scripts/run-phase-auth-identity-staging.ps1:5 | Staging retired |
| scripts/run-phase-kpi1-staging-api.ps1:5 | Staging retired |
| scripts/run-phase-kpi1-staging-ui.ps1:5 | Staging retired |
| scripts/run-phase-kpi21e-staging-api.ps1:3 | Staging retired |
| scripts/run-phase-kpi2r2-attached-serialization.ps1:3 | Staging retired, có guard staging |

Không chạy/sửa các scripts này, không repoint sang production. Không tìm thấy occurrence executable của chính đường dẫn trên trong reusable non-staging scripts. Các đường dẫn BACKUP-TEMP/Github cũ khác đã được báo cáo audit trước; không mass-edit R1. Nếu tái sử dụng harness sau này, dùng đường dẫn theo script/repo (`$PSScriptRoot`/`import.meta.dirname`) và xác minh DB sandbox riêng.

Working tree được hiểu rõ:

- `.gitattributes`: mới, thay đổi tooling được yêu cầu, chưa stage/commit.
- `supabase-phase-kpi2-final-consolidated.sql`: chuẩn hóa bytes LF; content bằng HEAD, không đổi SQL nghiệp vụ.
- `CRM-DEV-READINESS-AUDIT.md`: untracked có sẵn từ task trước, giữ nguyên.
- `CRM-DEV-READINESS-R1-ACCOUNT-TOOLING-FIX.md`: báo cáo R1 mới theo yêu cầu.

Không sửa historical Markdown reports hoặc file CRM khác.

## 12. Remaining blockers

| Blocker | Owner action chính xác | Bước Codex tiếp theo sau đó |
|---|---|---|
| GitHub READ/push=false | Cấp Write cho ksngltech-eng hoặc login account có quyền; xác nhận Git HTTPS cùng account có push | Read-only kiểm viewerPermission và Git credential API lại; không push thử |
| Supabase production không visible | Cấp account quyền CRM hoặc `supabase login` account đúng; list phải thấy jjeeazwlqcwynzquimeo | Link theo CLI được hỗ trợ, xác minh local ref rồi DB read-only proof |
| Vercel team CRM không accessible | Cấp membership/project rights hoặc `vercel login` account có CRM | Đọc live metadata, link exact IDs, chứng minh alias/SHA/Git branch/env |
| Live DB/deployment/maintenance-input proof thiếu | Hoàn tất hai access phía trên | Catalog/counts và config inspection; không SQL write/deploy |

Đây là thiếu quyền/tương tác account thực tế, không có sửa source nào có thể cấp quyền thay owner. R1 cho phép link nhưng prerequisite production visible chưa đạt nên không chạy bước phụ thuộc.

## 13. Final readiness matrix

| Hạng mục | Trạng thái | Bằng chứng | Chặn gì? |
|---|---|---|---|
| Repo/Git local | PASS | main, SHA khớp remote | Không |
| GitHub đúng account có Write/Admin | CHƯA ĐẠT | ksngltech-eng READ | Push |
| Git HTTPS push credential | CHƯA ĐẠT | API push=false | Push |
| Supabase tooling binary/auth | HOẠT ĐỘNG, SAI PHẠM VI CRM | CLI list được project khác | Production |
| Production project visible | CHƯA ĐẠT | Không có jjeeazwlqcwynzquimeo | Link/DB |
| Supabase link đúng | CHƯA LÀM | Prerequisite chưa đạt | CLI production |
| Production DB read-only proof | CHƯA LÀM | Thiếu quyền/link | SQL rollout readiness |
| Vercel account/team/project | CHƯA ĐẠT | ksngl, không CRM | Inspect/deploy |
| Vercel local link | CHƯA LÀM | Không IDs live | CLI deploy |
| Production alias/SHA/Git metadata | MỘT PHẦN | GitHub record khớp; live alias thiếu | Deploy readiness |
| Maintenance | PASS, ON | HTTP generated=true | Không static; smoke hoãn |
| Exact maintenance input | CHƯA XÁC MINH | Env/lock production không đọc được | Gate trước deploy |
| Build | PASS | Generator cwd tạm | Không |
| Static/helper tests | PASS 11/11 | Chạy tại working tree | Không |
| Syntax | PASS 41/41 | node --check | Không |
| KPI-2 exact hash | PASS | LF exact HEAD bytes, 172 checks | Đã xử lý local |
| Working tree | ĐÃ PHÂN LOẠI | Tooling + EOL + 2 reports | Cần review trước commit |

## 14. Recommendation

Owner hoàn tất ba mục account access ở phần 12 rồi chạy lại phần proof/link phụ thuộc quyền. Không cần sửa thêm feature CRM để đạt local readiness. Không cần bật login cho các bước account, catalog, build hay deployment metadata.

R1 kết thúc với local ready, production access còn thiếu. Dừng sau báo cáo; không bắt đầu feature CRM. Khi tiếp tục chỉ xác minh quyền/link/read-only proof theo scope R1; approved SQL hoặc deploy thực tế vẫn cần task/ủy quyền tương ứng, không dùng chúng để thử readiness.
