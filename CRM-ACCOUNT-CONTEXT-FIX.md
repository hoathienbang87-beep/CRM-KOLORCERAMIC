# CRM-ACCOUNT-CONTEXT-FIX

Hoàn tất ngày 08/09/2026, khoảng 23:14, Asia/Saigon. Repository: `D:\DU AN CUA TOI\CRM-KOLORCERAMIC`.

## 1. Kết luận

**CRM ACCOUNT CONTEXT PASS — GITHUB + SUPABASE + VERCEL ĐÚNG PROJECT VÀ SẴN SÀNG**

Đã đăng nhập lần lượt từng service với xác nhận trình duyệt của owner. GitHub có ADMIN và Git HTTPS push=true; Supabase production visible, link đúng và đọc catalog thành công; Vercel đúng team/project, link đúng IDs và xác minh domain/deployment/Git binding. Maintenance vẫn ON.

PASS ở đây là account/tooling context. Không chứng nhận mọi business flow/RLS đã được smoke, không tự cho phép SQL rollout/deploy cụ thể. Task không sửa business code, apply migration, ghi business data, push, deploy hoặc đổi maintenance.

## 2. GitHub before

`gh auth status`: `ksngltech-eng`, active, quyền repo READ. Git Credential Manager cũng chỉ liệt kê account này. Repository đúng `hoathienbang87-beep/CRM-KOLORCERAMIC`.

Ban đầu branch `main`, HEAD `97f0dc5e79aebe82503152be8be96baba85365af`. Working tree có EOL normalization SQL, `.gitattributes` và hai báo cáo từ các task readiness trước; giữ nguyên.

## 3. GitHub login action

Chạy `gh auth login --hostname github.com --git-protocol https --web`, chọn xác thực Git bằng GitHub credential. Dừng khi CLI đưa device code; owner hoàn tất xác nhận trình duyệt rồi báo xong. CLI trả `Authentication complete`, đăng nhập `hoathienbang87-beep` và cấu hình Git protocol HTTPS.

Không logout/xóa account cũ: `ksngltech-eng` vẫn được gh giữ, inactive. Không push thử, không tạo dummy commit.

## 4. GitHub final account/permission

| Kiểm tra | Kết quả |
|---|---|
| gh active account | `hoathienbang87-beep` |
| Repo | `hoathienbang87-beep/CRM-KOLORCERAMIC` |
| viewerPermission | ADMIN |
| Git HTTPS credential thực tế | `hoathienbang87-beep` |
| Git credential API permissions | push=true, admin=true, pull=true |

Git HTTPS được xác minh bằng `git credential fill` không tương tác và GET GitHub `/user`/repo metadata với credential chỉ giữ trong bộ nhớ. Không in/lưu token. Effective credential helper vẫn là Git Credential Manager `manager`; không xóa entry hàng loạt. GitHub PASS.

## 5. Supabase before

CLI `2.116.0`; credential trước chỉ thấy project `dvkvoydcfkapyhcdjnst` (`app so de`), không thấy production CRM. Repo chưa link.

## 6. Supabase login action

`supabase login` ban đầu báo `NonInteractiveError` do output JSON. Chuyển sang flow tương tác được CLI hỗ trợ: `supabase login --output-format text --agent no`.

Khi CLI yêu cầu xác minh trình duyệt, đã dừng. Theo yêu cầu owner, hủy phiên chờ trong tool và mở PowerShell riêng chạy cùng login command để owner trực tiếp nhập mã. Owner xác nhận hoàn tất, sau đó kiểm tra lại project list. Không dùng `--token`, không yêu cầu token qua chat, không xóa credential file thủ công.

## 7. Supabase project visibility

Sau login, `supabase projects list` trả:

- Production `jjeeazwlqcwynzquimeo`, tên `ERP kolorceramic`, ACTIVE_HEALTHY, region ap-southeast-1.
- Organization ID `doburkcngqnrgloqrtzd`.
- Staging cũ `ykhtpvyelpujykheycsv` hiện INACTIVE; không dùng để test hay link.

Project ref chính xác là authority. CLI metadata không cung cấp email account, vì vậy không đoán danh tính email; phạm vi account được chứng minh bằng production visibility và query catalog.

## 8. Supabase link

Chỉ sau khi production visible, chạy:

```powershell
supabase link --project-ref jjeeazwlqcwynzquimeo --output-format text --agent no
```

CLI trả `Finished supabase link.`; không yêu cầu DB password trong phiên này. File `supabase/.temp/project-ref` xác nhận đúng `jjeeazwlqcwynzquimeo`.

CLI tạo metadata trong `supabase/.temp/`: project-ref, linked-project.json, pooler-url, các version/cache files. Thư mục đã được `.gitignore` hiện hữu loại khỏi Git. Không in pooler URL/credential, không tự tạo ID/config giả. Không db push, repair hoặc apply migration.

## 9. Supabase read-only proof

Đã đọc CLI help: `supabase db query --linked` truy vấn linked project qua Management API. Chạy catalog SELECT trong `BEGIN READ ONLY; ... COMMIT;`; kết quả xác nhận `transaction_read_only=on`.

| Metadata live | Kết quả |
|---|---|
| Database | postgres |
| Schema public | Tồn tại |
| Functions trong public | 113 |
| Policies trong public | 53 |
| Bảng relkind=r bật RLS trong public | 30 |
| Storage bucket kpi-evidence | public=true |
| Storage bucket kpi2-evidence | public=false |
| `supabase_migrations.schema_migrations` | Không tồn tại (`to_regclass` trả null) |

Đã đọc inventory tên RPC và policy theo table/command/role; không gọi RPC nghiệp vụ. Functions live có onboarding/lifecycle: `crm_claim_employee_identity_on_first_login`, `crm_relink_returning_employee_identity`, `crm_restore_archived_employee`, `crm_employee_identity_status`; có `crm_create_product`, `crm_update_product` và products policy `products active employee read`.

Định nghĩa live `crm_is_admin()` chứa `select coalesce(public.crm_current_user_role() in ('owner', 'admin'), false);`, xác nhận helper fail-closed hiện diện. Đây là đối chiếu helper cụ thể và inventory presence, không phải full semantic diff mọi function.

Không có history relation chuẩn nên không thể liệt kê applied migrations theo bảng đó. Không coi đây là lỗi account; không tạo/repair history. Trước rollout SQL vẫn cần đối chiếu reviewed artifact với schema/functions live. Không đọc rows khách hàng/nhân viên, không tạo fixtures. CLI ghi `Initialising login role...` trong quy trình xác thực; toàn bộ SQL gửi bởi task là read-only, không thay business data/RLS/Auth configuration.

## 10. Vercel before

CLI `59.10.0`, account `ksngltech-eng`; team context `ksngl` / `KSNGL`, không có project CRM. Repo chưa có `.vercel/project.json`.

## 11. Vercel login action

Chạy `vercel login` sau khi GitHub và Supabase đạt PASS. Dừng ở device/browser confirmation, owner xác nhận. Lượt kiểm tra đầu còn chờ, không tạo flow khác; sau owner xác nhận lại, CLI hoàn tất login và tự chuyển default scope vì team cũ không còn accessible với account mới.

Không logout mọi service, không xóa auth config thủ công, không deploy. Final `vercel whoami`: `hoathienbang87-2345`.

## 12. Vercel team/project

| Metadata live | Giá trị |
|---|---|
| Account | `hoathienbang87-2345` |
| Team slug/name | `thien-di-s-projects1` / `THIEN DI's projects` |
| Team/org ID | `team_7gs92w9113W7Nq7ytCsdoLm4` |
| Project | `crm_kolor` |
| Project ID | `prj_BNeqeHfdUbfR1uaZFyzeuxhzcBRw` |
| Production URL trong project list | `https://crmkolor.vercel.app` |
| Git integration | github |
| Git org/repo | `hoathienbang87-beep/CRM-KOLORCERAMIC` |
| Git repo ID | 1249077236 |
| Production branch | main |

Đã dùng project inspect, domain deployment inspect và authenticated GET Vercel API để đối chiếu trước link. Không chọn chỉ vì trùng tên. API output lọc metadata cần thiết; không in env values hay token.

## 13. Vercel link

Sau xác minh domain/Git binding/project IDs, chạy:

```powershell
vercel link --yes --project crm_kolor --scope thien-di-s-projects1
```

CLI link thành công. `.vercel/project.json`:

```json
{"projectId":"prj_BNeqeHfdUbfR1uaZFyzeuxhzcBRw","orgId":"team_7gs92w9113W7Nq7ytCsdoLm4","projectName":"crm_kolor"}
```

IDs trùng metadata live. CLI tự tạo `.env.local` với tên biến `VERCEL_OIDC_TOKEN` và thêm `.vercel`, `.env*` vào `.gitignore`. Không in giá trị credential. `git check-ignore` xác nhận `.env.local`, `.vercel/project.json` đều ignored. Không chạy `vercel env pull` hoặc deploy.

## 14. Production deployment proof

| Metadata live | Giá trị |
|---|---|
| Deployment ID | `dpl_7oRLJP9TnBNqsNeqT9Xqv1cWhSgv` |
| Project ID | `prj_BNeqeHfdUbfR1uaZFyzeuxhzcBRw` |
| Target/status | production / READY |
| Deployment URL | `https://crmkolor-2016ifqqu-thien-di-s-projects1.vercel.app` |
| Alias | `crmkolor.vercel.app` |
| Các alias khác | crmkolor-thien-di-s-projects1.vercel.app; crmkolor-git-main-thien-di-s-projects1.vercel.app |
| Git source ref | main |
| Git source SHA | `97f0dc5e79aebe82503152be8be96baba85365af` |
| Build command của deployment | `node scripts/generate-maintenance-config.mjs` |
| Install/output/framework | rỗng / `.` / null |
| Node | 24.x |

Local HEAD, origin/main, main live qua `git ls-remote` và production deployment Git SHA đều cùng SHA trên: **ALL MATCH**. Domain→deployment→project→Git binding đã được xác minh live, thay thế trạng thái UNKNOWN của audit trước.

Project settings có build/output null ở cấp project; effective settings trên deployment lấy command/output từ source config như bảng trên. Không nhầm giá trị mặc định hiển thị của project inspect với effective build.

Env metadata: `VITE_MAINTENANCE_MODE` hiện diện ở production và preview. Các `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` cũng ở production/preview; nhóm POSTGRES/SUPABASE/NEXT_PUBLIC integration variables hiện diện ở production. Chỉ đọc/report tên, scope, presence; không in giá trị.

## 15. Maintenance status

Sau các tooling actions, GET `https://crmkolor.vercel.app/js/config/maintenance.generated.js` trả HTTP 200 và `enabled: true`. Maintenance vẫn ON.

Nguồn code là frontend guard đọc generated config; build bật khi `VITE_MAINTENANCE_MODE` truthy hoặc `.maintenance-on` tồn tại. Đã xác minh env name/scopes và output ON, không đọc secret env value hoặc inspect toàn bộ deployment source để kết luận lock file production có/không. Khi mở lại cần kiểm tra cả hai nguồn bật trong task được duyệt.

Không bật/tắt maintenance. Real-role/OAuth smoke vẫn hoãn; account/tooling proof không cần mở login. Frontend maintenance không tự thu hồi session cũ hay đảm bảo DB write freeze.

## 16. Working tree

Thay đổi do task này:

- `supabase/.temp/`: metadata link do CLI tạo, ignored từ trước.
- `.vercel/`: project link/readme do CLI tạo, ignored.
- `.env.local`: credential OIDC local do Vercel CLI tạo, ignored; không in giá trị.
- `.gitignore`: CLI thêm `.vercel` và `.env*`. Rule `.env*` ở cuối cũng ưu tiên hơn exception `.env.example` cũ; ghi nhận nguyên thay đổi CLI, không tự sửa ngoài scope.
- `CRM-ACCOUNT-CONTEXT-FIX.md`: báo cáo mới được yêu cầu.

Các thay đổi có trước task, giữ nguyên: `.gitattributes`, EOL normalization của `supabase-phase-kpi2-final-consolidated.sql`, `CRM-DEV-READINESS-AUDIT.md`, `CRM-DEV-READINESS-R1-ACCOUNT-TOOLING-FIX.md`. Artifact SQL không bị sửa bởi task account này; task R1 đã chứng minh bytes LF bằng HEAD và test PASS.

`git diff --check` PASS. Không stage, commit, discard, reset, rebase, force push. Báo cáo trước được giữ nguyên như bằng chứng lịch sử, không ghi đè kết luận cũ.

## 17. Remaining blockers

Không còn blocker account/project context trong phạm vi task này.

Các giới hạn cho phase sau: không có migration history table chuẩn; chưa full schema drift/semantic diff tất cả RPC; chưa real-role smoke trong maintenance; chưa thử SQL write/deploy thực tế (cố ý không làm). Mọi rollout cụ thể vẫn phải có reviewed SQL/source, backup/read-back và scope được owner giao; không dùng write/deploy để thử quyền.

## 18. Final readiness

| Gate | Kết quả |
|---|---|
| GitHub đúng account/repo, ADMIN | PASS |
| Git HTTPS push capability | PASS, push=true qua API |
| Supabase production visible | PASS |
| Supabase local link exact ref | PASS |
| Production read-only catalog/RPC/RLS/storage proof | PASS |
| Vercel đúng account/team/project | PASS |
| Vercel local project/org IDs | PASS |
| Production domain/deployment metadata | PASS |
| Local/remote/deployed SHA | ALL MATCH |
| Maintenance vẫn ON | PASS |
| Không business-code/production changes do task | PASS |
| Working tree/link artifacts | Đã phân loại; chưa commit |

Dừng sau báo cáo. Không bắt đầu feature CRM, SQL rollout hoặc frontend deployment trong task này.
