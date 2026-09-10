# CRM-UI-R1 STEP 7 — Admin Consolidation

## 1. Kết luận

**CRM-UI-R1 STEP7 FULL PASS — CANONICAL ADMIN CONSOLIDATED AND CRM REOPENED.** Admin có một route authority tại `/admin`, toàn bộ workspace đã smoke bằng Owner, Manager bị chặn trên mọi deep route, production đang mở và không có mutation nghiệp vụ từ phase này.

## 2. Starting baseline

- Repository: `D:\DU AN CUA TOI\CRM-KOLORCERAMIC`
- Branch: `main`
- HEAD đầu kỳ: `7d9d4f90a43b7d7b98f555e3573baad1c1654609`
- Production đầu kỳ: `https://crmkolor.vercel.app/`, maintenance OFF.
- Các file credential/smoke local đã tồn tại từ trước và không được stage.

## 3. Current Admin architecture audit

Admin shell hiện hữu dùng `adminAppView`, History API, `adminRoutes`, `currentAdminRoute()` và guard `canAccessAdminPanel()`. Các route ổn định `/admin`, `/admin/users`, `/admin/categories`, `/admin/settings`, `/admin/audit-logs` được giữ; chỉ bổ sung tối thiểu `/admin/health`.

## 4. Duplicate/legacy Admin surfaces

`appView` còn chứa `careSettingsPanel`, `dropdownSettingsPanel`, `proHealthPanel`, `dataSafetyPanel`, `userAdminPanel`, `trashPanel`, `auditPanel`; topbar còn `seedBtn`, `syncPhoneBtn`, `syncOwnerBtn`, `importBtn`. Chúng đã được đối chiếu trước khi retire/move.

## 5. Files changed

- `index.html`
- `css/styles.css`
- `js/features/crm-app.js`
- `scripts/test-ui-r1-step7-admin-consolidation.mjs`
- `scripts/test-ui-r1-step7-admin-consolidation-browser.mjs`
- `scripts/test-ui-r1-step7-settings-noop.mjs`

## 6. Final Admin IA

Admin gồm Tổng quan hệ thống; Người dùng & vòng đời; Danh mục CRM; Cấu hình công ty & chăm sóc; Sức khỏe & an toàn dữ liệu; Nhật ký & thùng rác.

## 7. Final route map

| Route | Workspace |
|---|---|
| `/admin` | Tổng quan hệ thống |
| `/admin/users` | Người dùng & vòng đời |
| `/admin/categories` | Danh mục CRM |
| `/admin/settings` | Cấu hình công ty & chăm sóc |
| `/admin/health` | Sức khỏe & an toàn dữ liệu |
| `/admin/audit-logs` | Nhật ký & thùng rác |

## 8. Role/capability model

Chỉ `owner` và `admin` qua `canAccessAdminPanel()`. `manager` vẫn là business manager; `sale` không có system Admin. Không đổi backend, RLS, RPC hoặc role semantics.

## 9. Admin Hub

`/admin` có 5 action cards, mỗi card mô tả rõ phạm vi và mở đúng canonical route. Listener dùng delegation tại `adminAppView`, tránh listener trùng khi cards render lại.

## 10. System Overview

Giữ 6 chỉ báo read-only dựa trên dữ liệu đã tải: khách hàng, khách mới tháng, cần chăm, KPI cần duyệt, user active và cảnh báo. Không thêm query backend trang trí.

## 11. Users & lifecycle

`/admin/users` giữ create/invite shell, role/profile update, ACTIVE/INACTIVE/ARCHIVED, deactivate/reactivate/archive và identity status. Lifecycle write tiếp tục qua RPC canonical; không có hard delete user.

## 12. CRM catalogs

`/admin/categories` giữ số ngày cảnh báo, deal statuses, channels, customer types, potentials, statuses, follows, care channels/results và system labels. Customer form vẫn hydrate từ cùng `settings` object.

## 13. Company & care settings

`/admin/settings` giữ company form, preview, Save/Reset rõ ràng và thêm liên kết sang `/admin/categories` cho quy tắc chăm sóc. Mở trang chỉ render dữ liệu, không save.

## 14. Health & data safety

`/admin/health` nhận lại nguyên node `proHealthPanel` và `dataSafetyPanel`, giữ health reload và operational snapshot handler hiện hữu.

## 15. Audit & trash

`/admin/audit-logs` giữ actor/action/time/target/details, filter, pagination; `trashPanel` được chuyển vào cùng workspace. Audit table không có mutation control.

## 16. Dangerous tool treatment

Seed settings, sync phone, sync owner và import được rời khỏi CRM topbar sang danger zone của `/admin/health`. Cleanup nằm trong khu thùng rác, nhãn rõ; guard và confirmation cũ được giữ. Không chạy các tool này trong production smoke.

## 17. Settings data/raw_data preservation

Adapter tiếp tục merge `oldData`, `oldRaw`, incoming `data`, incoming `raw_data`, sau đó ghi cùng merged object cho cả hai field. `saveSettingsAndVerify()` vẫn read-back và báo lỗi nếu giá trị không khớp.

## 18. No-op settings protection

`migrateSettingsIfNeeded()` dừng khi `patch` rỗng. `renderAdminShell()` không gọi save. Fixture xác nhận load → navigate không tạo request/write/updated-at mutation; explicit meaningful edit giữ unknown keys.

## 19. Owner protection

Không đổi lifecycle RPC, owner guard hoặc UI protection. Không thử deactivate/archive/demote Owner trong production.

## 20. Manager denial

Production bằng `devil8xonline@gmail.com · manager`: Sidebar không có Quản trị; `/admin`, `/admin/users`, `/admin/categories`, `/admin/settings`, `/admin/health`, `/admin/audit-logs` đều về Overview. Snapshot ngay sau navigation không thấy restricted Admin shell.

## 21. Old Admin parity matrix

| Capability | Old location | New canonical location | Role | Read/Write | Result |
|---|---|---|---|---|---|
| Care due days | `careSettingsPanel` | `/admin/categories` | Owner/Admin | R/W | PASS |
| CRM dropdown catalogs | `dropdownSettingsPanel` | `/admin/categories` | Owner/Admin | R/W | PASS |
| Company config | canonical form cũ | `/admin/settings` | Owner/Admin | R/W | PASS |
| Health diagnostics | `proHealthPanel` | `/admin/health` | Owner/Admin | Read | PASS |
| Operational snapshot | `dataSafetyPanel` | `/admin/health` | Owner/Admin | Export | PASS |
| Seed settings | CRM topbar `seedBtn` | `/admin/health` danger zone | Owner/Admin | Write | PASS, isolated |
| Sync phone index | CRM topbar `syncPhoneBtn` | `/admin/health` danger zone | Owner/Admin | Write | PASS, isolated |
| Sync owner email | CRM topbar `syncOwnerBtn` | `/admin/health` danger zone | Owner/Admin | Write | PASS, isolated |
| CSV import | CRM topbar `importBtn/importFile` | `/admin/health` danger zone | Owner/Admin | Write | PASS, isolated |
| Employee placeholder | `userAdminPanel` | `/admin/users` | Owner/Admin | R/W | PASS, retired |
| Trash/recovery | `trashPanel` | `/admin/audit-logs` | Owner/Admin | R/W | PASS |
| Cleanup tools | `trashPanel` | `/admin/audit-logs` | Owner/Admin | Write | PASS, guarded |
| Legacy recent audit | `auditPanel` | `/admin/audit-logs` | Owner/Admin | Read | PASS, retired |

## 22. Legacy Admin retirement

`careSettingsPanel`, `dropdownSettingsPanel`, `userAdminPanel`, `auditPanel` bị remove khi khởi tạo. Health, safety, danger controls và trash được move nguyên node để tái sử dụng handler. Nhánh render Admin cũ trong `setMainView()` đã bỏ.

## 23. Admin navigation state

Một `adminRoutes` whitelist quyết định page, title và active nav. Path lạ fallback `/admin`; không có pathname-to-DOM lookup và không tạo `#/admin`.

## 24. Back/Forward/Refresh

Router tiếp tục dùng `pushState`, `popstate` và explicit whitelist. Browser fixture kiểm tra route restoration; production deep-route full reload khôi phục đúng workspace sau auth initialization.

## 25. Deep-route/root-relative assets

Tất cả 6 route trả HTTP 200 và HTML dùng `/css/styles.css`, `/js/...`. Không tái diễn lỗi asset tương đối sau OAuth/deep refresh.

## 26. Responsive/mobile

Browser fixture PASS tại 1440, 1366, 1180, 768, 390 và 360px. Sửa `min-width:0`, grid Admin toolbar và cards/danger buttons mobile; không còn whole-page horizontal overflow.

## 27. Accessibility

Giữ landmark Admin navigation/main, button labels dạng chữ, heading hierarchy, `aria-label`, `inert`/`aria-hidden` cho view, focusable controls và table overflow có kiểm soát.

## 28. Secret/deployment artifact safety

`.vercelignore` vẫn loại `.codex*` và `.env*`. Production trả NOT_FOUND cho `.codex-smoke/`, `.codex-prod-readonly.env`, `.env`; không log hay render secret.

## 29. Customer regression

STEP 3 static/browser PASS: Hub, new/list/care/allocation, draft, drawer, role/capability và responsive. Catalog implementation không đổi value/semantics.

## 30. KPI regression

STEP 5 browser/static, KPI R3 static 53 checks, R3 integration và R3.1 static/integration đều PASS. Phase không tạo/sửa KPI production.

## 31. Overview regression

STEP 4 và STEP 5.1 static/browser PASS: compact Overview, 4/6 pipeline context, channel chart/drill-down và monthly growth giữ nguyên.

## 32. Reports regression

STEP 6 và 6.1 static/browser PASS. Unique customers và stage memberships vẫn tách nhãn; system audit không bị chuyển vào Reports.

## 33. Product regression

Product static/helper 40 checks, UI fixture, shell layout và PGlite integration 86 checks PASS. Không có Product production write.

## 34. Local/static tests

STEP 2–6.1 static, STEP 7 contract, settings no-op, lifecycle onboarding, KPI R3/R3.1, Product static, `node --check` và `git diff --check` đều PASS.

## 35. Browser tests

STEP 3–6.1, Product UI/shell và STEP 7 browser fixtures đều PASS. STEP 7 bao phủ 6 viewport, 6 Admin workspaces, Owner/Admin-capable state, Manager/Sale denial và no-overflow.

## 36. Lifecycle/settings fixtures

Employee onboarding/lifecycle static gate PASS cho ACTIVE/INACTIVE/ARCHIVED, canonical RPC, no hard delete và owner/admin authority. Settings fixture PASS cho no-op và merged explicit save.

## 37. Git SHA

Implementation commit: `869282cd1ec36acd0d708d09de02342874c1e466` (`feat(ui): consolidate canonical admin workspaces`).

## 38. Maintenance ON

Tạo `.maintenance-on`, generate `enabled: true`, deploy và read-back production `maintenance.generated.js` xác nhận ON trước khi pre-open gate.

## 39. Production deployment

Maintenance deployment: `dpl_46N76GfFLjb4yQgRrFZJdTxS6BzF`. Final open deployment: `dpl_GjAv12GcaSRyLyEF51JDBeopQTFe`, trạng thái READY, alias `https://crmkolor.vercel.app` và project alias đều đúng.

## 40. Owner smoke

`hoathienbang87@gmail.com · owner` PASS: Sidebar Quản trị, Hub, Users, Catalogs, Settings, Health/Safety, Audit/Trash, direct route reload và Về CRM. Không Save settings, không danger action, không employee mutation.

## 41. Manager denial smoke

`devil8xonline@gmail.com · manager` PASS đủ 6 Admin routes; restricted UI không flash; return an toàn về `#/overview`. Final TEST state quan sát: active session, role Manager.

## 42. Data/settings integrity

Expected production business mutation là NONE và smoke chỉ navigation/read. Settings quan sát giữ `careDueDays=3` cùng các catalog hiện hành; không có settings audit mới do STEP 7. Không có credential an toàn để tạo fingerprint DB độc lập trong phase này.

## 43. Maintenance final state

Production read-back: `enabled: false`. CRM OPEN sau khi Owner và Manager security smoke PASS.

## 44. Known limitations

Không thực hiện production mutation để chứng minh Save/lifecycle/danger tools; contract được chứng minh bằng static, browser và isolated fixtures. “Historical settings drift from the previous smoke cannot be reconstructed field-by-field because a pre-change field snapshot was not captured. The current production settings state was accepted by the owner as the new controlled baseline. All subsequent smoke changes were compared against this baseline.”

## 45. Next recommendation

Owner và K review báo cáo cùng UI production. Không bắt đầu Product redesign, Admin backend redesign, KPI feature, migration, CRM-UI-R2 hoặc phase khác trước quyết định tiếp theo.
