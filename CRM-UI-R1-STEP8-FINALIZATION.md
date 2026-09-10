# CRM-UI-R1 STEP 8 — Finalization

## 1. Kết luận

**CRM-UI-R1 STEP8 FULL PASS — FINAL UX CLEANUP LIVE, CRM REOPENED, UI-R1 READY TO CLOSE.** Phạm vi finalization đã hoàn tất, không có migration/RPC/RLS hay thay đổi business data. Một lỗi deep-link Admin được phát hiện trong production smoke và đã forward-fix trước khi chốt PASS.

## 2. Starting baseline

- Branch: `main`.
- HEAD ban đầu: `c1e29885363cd293f154cb45207b4551d2922d1e`.
- Tracked tree ban đầu sạch; các file untracked có sẵn được giữ nguyên.
- Deployment ban đầu: `dpl_GjAv12GcaSRyLyEF51JDBeopQTFe`, trạng thái `READY`.
- Maintenance ban đầu: OFF.

## 3. Legacy scaffolding audit

| Legacy item | Mục đích cũ | Dependency thực tế | Còn cần? | Action |
|---|---|---|---|---|
| Horizontal CRM tabs | Điều hướng top-level cũ | Canonical Sidebar/hash đã thay thế | Không | RETIRE |
| Hidden KPI mode tabs | Chọn Team/Library/History | Deep route KPI đã sở hữu mode | Không | RETIRE |
| Hidden Admin panels | Admin trong CRM shell cũ | `/admin` đã canonical | Không | RETIRE |
| Topbar danger controls | Seed/sync/import | Admin Health cần dùng chung node | Có, nhưng sai vị trí | MOVE/KEEP |
| Report controls | Filter/paging/export/back | Report workspace đang dùng | Có | KEEP |
| `setMainView` | Render business workspace | Hash router canonical đang gọi | Có | KEEP |
| `.hide` | Ẩn nhiều node live | Hợp đồng chung toàn app | Có | KEEP |
| KPI historical/test harness | Regression ngoài runtime | Dùng cho kiểm thử | Có | DEFER |

## 4. Removed legacy items

- DOM và handler của `viewTabsSlot`, `crmViewBtn`, `customersViewBtn`, `kpiViewBtn`, `productsViewBtn`, `reportsViewBtn`, `adminViewBtn`.
- `renderLegacyViewTabs` và các toggle/listener điều hướng top-level cũ.
- `legacy-kpi-mode-tabs`, `kpiTeamEmployeesModeBtn`, `kpiTeamLibraryModeBtn`, `kpiTeamHistoryModeBtn`, `setKpiTeamMode` và handler `[data-kpi-team-mode]`.
- Nguồn DOM Admin cũ: `careSettingsPanel`, `dropdownSettingsPanel`, `userAdminPanel`, `auditPanel`.
- Render/listener Admin cũ: `saveCareSettings`, `renderDropdownSettingsForm`, `saveDropdownSettings`, `renderAuditTrail`, audit pager cũ và nhánh `activeMainView === "admin"`.

## 5. Kept compatibility items

- `setMainView` được giữ vì là business renderer của canonical hash router, không phải navigation authority thứ hai.
- `kpiTeamState` và các mode deep-route được giữ để bảo toàn R3/R3.1, cache và drawer.
- Health/safety/trash và danger nodes được giữ, chuyển vật lý vào canonical Admin.
- Report filter, pagination, export và back controls vẫn là chức năng live.
- Reload/Logout ở topbar là session controls live.
- `.hide` được giữ vì dùng rộng; workspace/overlay quan trọng đồng thời áp dụng `inert` và `aria-hidden`.

## 6. Deferred items

- Script KPI legacy/staging và fixture lịch sử ngoài production runtime được giữ làm bằng chứng regression.
- Migration/history artifacts trong repository không phải UI scaffolding và nằm ngoài STEP 8.
- Không còn legacy navigation surface production nào cần defer do dependency chưa rõ.

## 7. Files changed

- `index.html`: retire DOM cũ, chuyển danger controls, bổ sung dialog semantics.
- `css/styles.css`: breakpoint 768px, grid/overflow và responsive KPI.
- `js/app.js`: tải Supabase vendor bằng root-relative URL trên deep-link Admin.
- `js/components/app-shell.js`: chỉ render canonical navigation.
- `js/features/crm-app.js`: retire handler/render cũ, chuẩn hóa overlay/focus/inert.
- Các STEP 2/Product fixture liên quan được cập nhật theo contract cuối.
- Thêm `scripts/test-ui-r1-step8-finalization.mjs` và `scripts/test-ui-r1-step8-finalization-browser.mjs`.

## 8. Final navigation architecture

Top-level CRM dùng một nguồn canonical trong `app-shell.js` kết hợp hash router. Customer, KPI và Reports dùng workspace model riêng. Admin dùng History API ở `/admin/*`. Không còn hidden navigation system thứ hai thay đổi active state.

## 9. Final route matrix

| Nhóm | Canonical routes |
|---|---|
| CRM | `#/overview` |
| Customer | `#/customers`, `/new`, `/list`, `/care`, `/allocation` |
| KPI | `#/kpi`, `/mine`, `/team`, `/library`, `/history` |
| Product | `#/products` |
| Reports | `#/reports`, `/summary`, `/sales`, `/customers` |
| Admin | `/admin`, `/users`, `/categories`, `/settings`, `/health`, `/audit-logs` |

Invalid route fallback có tính xác định theo role. Deep-link, refresh, back/forward được kiểm tra ở fixture; production kiểm tra representative Customer/KPI/Reports/Admin routes.

## 10. Final role matrix

| Module | Sale | Manager | Owner/Admin |
|---|---:|---:|---:|
| Overview, Customers, KPI, Product | Có | Có | Có |
| Reports | Không | Có | Có |
| Customer Allocation | Không | Có | Có |
| KPI Team/Library/History | Không | Có | Có |
| Admin `/admin/*` | Không | Không | Có |

## 11. Hidden panel contract

Workspace/overlay ẩn không chiếm layout, không nhận pointer/focus và rời accessibility tree bằng `hide` kết hợp `inert`/`aria-hidden` ở các lớp quan trọng. State chỉ được giữ khi node mounted có chủ đích.

## 12. Desktop Sidebar

Đã kiểm tra 1024, 1180, 1366, 1440 và 1920px. Sidebar không che nội dung, active state rõ, account/role/logout dùng được và không còn tab cũ chiếm chỗ.

## 13. Mobile navigation

Đã kiểm tra 360, 390, 430 và 768px. Drawer/backdrop khởi tạo `inert`, hamburger/close/backdrop/Escape hoạt động, focus quay lại trigger, role items đúng và không click-through.

## 14. Focus/keyboard

Customer/Product/detail overlay lưu trigger, đưa focus vào close control và trả focus khi đóng. Keyboard fixture đi qua Sidebar, Hub cards, back và modal; thứ tự hợp lý, focus hiển thị, không có hidden control focusable.

## 15. Modal/drawer/backdrop

Customer drawer có `role="dialog"`, `aria-modal="true"`, `aria-labelledby="drawerTitle"`. Customer/Product/KPI/channel/detail overlays đóng đúng lớp, backdrop không còn sau close/route switch và không xuyên click.

## 16. Z-index/layer contract

Thứ tự cuối: main content < navigation/backdrop < business drawer/modal < saving/critical overlay. Các giá trị được quản lý theo nhóm lớp; không thêm z-index ngẫu nhiên để che lỗi riêng lẻ.

## 17. Scroll handling

Mobile nav/modal khóa underlying scroll khi mở và phục hồi khi đóng. Repeated open/close fixture không tạo double scroll, stuck body hoặc nhảy trang ngoài ý muốn.

## 18. Hit-testing

Fixture xác nhận Sidebar, Customer Hub/card/row, Product catalog/drawer, KPI cards/controls, Reports cards/pipeline, Overview chart/modal và Admin cards nhận click đúng. Không có hidden layer intercept pointer.

## 19. Responsive audit

Browser contract chạy đủ 9 width: 360, 390, 430, 768, 1024, 1180, 1366, 1440, 1920. Breakpoint mobile được thống nhất ở 768px; toolbar search và KPI Hub grid wrap đúng.

## 20. Overflow audit

Whole-page horizontal overflow = 0 ở toàn bộ width kiểm tra. Overflow chỉ còn trong wrapper bảng dày đặc được phép. Không dùng global `overflow-x:hidden` để che lỗi.

## 21. Customer final regression

Hub, New, List, Care, Allocation, form đơn, draft, validation/save binding, clear, conditional partner fields, owner/options và duplicate contract PASS qua static/browser fixture. Production Manager mở Hub và Allocation read-only; không tạo khách.

## 22. Overview/chart regression

Summary, attention, compact pipeline và đúng một canvas cho mỗi chart channel/growth còn nguyên. Production tải 194 khách, chart channel và T1–T12 growth; channel drill-down/focus được xác nhận bằng fixture.

## 23. Pipeline regression

Overview hiển thị compact `4/6 trạng thái chính`. Reports Customers phân biệt `194 khách hàng duy nhất` với `196 lượt phân loại`, kèm membership share; không dùng headline gây hiểu nhầm.

## 24. KPI final regression

KPI Hub, Mine/Team/Library/History, definition/period/assignment/lifecycle/review/evidence/drawer và R3/R3.1 PASS. Production hiện không có kỳ ACTIVE và UI xử lý sạch, không hiển thị phần trăm giả; không mutate KPI.

## 25. Product final regression

Catalog, search/filter, row/card, detail drawer, role controls, decimal/server confirmation, mobile cards, backdrop và hit-testing PASS. Production catalog tải bình thường; không add/edit Product.

## 26. Reports final regression

Hub, Summary, Sales, Customers, filter/pagination/export/activity/pipeline/deep-route PASS cho Manager/Owner; Sale bị chặn trong fixture. Production Manager mở Hub và Customers report read-only.

## 27. Admin final regression

Owner PASS `/admin`, Users, Categories, Settings, Health, Audit và `Về CRM → #/overview`. Manager không có Admin Sidebar và bị fallback/deny. Root-relative hotfix đã loại lỗi `/admin/js/vendor/supabase/supabase.js`; phiên browser sạch trên `/admin` có `ERRORS=[]`.

## 28. Settings/lifecycle protection

Mở/navigate Settings không gọi save. Fixture no-op PASS; meaningful isolated save giữ `data`, `raw_data`, unknown keys và read-back contract. Lifecycle ACTIVE/INACTIVE/ARCHIVED, no hard delete và Owner protection PASS; production không save settings hay đổi lifecycle.

## 29. Dangerous tool safety

Seed/sync/import/snapshot utilities không còn ở CRM topbar; chỉ hiện trong Admin Health với guard/label/confirmation. Không tool nguy hiểm nào được chạy trong smoke.

## 30. Accessibility

Landmarks, headings, nav, labels, dialog roles, `aria-modal`, `aria-labelledby`, `aria-hidden`, `inert`, focus return và Escape contract PASS. Không phát hiện duplicate critical DOM id hay hidden workspace focusable trong contract test.

## 31. Performance/listener/request checks

Repeated navigation và repeated drawer open/close chỉ tạo một action mỗi click. KPI/Reports/Customer rapid navigation giữ request token/cache hiện hữu; không thấy double route, double handler, duplicate render hoặc request storm.

## 32. Console/error review

Fixture không có uncaught exception/unhandled rejection/critical console error. Production smoke phát hiện root-relative Supabase bug trên Admin deep-link; commit `d60f5ce` forward-fix. Fresh `/admin` tab sau deploy tải Owner shell và console `ERRORS=[]`.

## 33. Secret/deployment artifact safety

`.vercelignore` tiếp tục chặn local secrets/scratch. HTTP read-back cuối: `/.codex-smoke/`, `/.codex-prod-readonly.env`, `/.env` đều 404. Không secret value được ghi vào report; Supabase anon key là client-public config hiện hữu, không phải service credential.

## 34. Local/static tests

PASS: UI-R1 STEP 2, 3, 4, 5, 5.1, 6, 6.1, STEP 7 Admin, STEP 7 settings no-op, STEP 8 finalization, KPI R3 (53 checks), KPI R3.1, Product R1 (40 checks), onboarding/lifecycle, `node --check`, `git diff --check`.

Integration PASS: KPI R3 PGlite (5 ACTIVE audit, 3 negative guards), KPI R3.1 PGlite, Product PGlite (86 checks; 403 synthetic legacy rows preserved).

## 35. Browser tests

PASS: STEP 3, 4, 5, 5.1, 6, 6.1, 7, Product UI, Product shell layout và STEP 8. STEP 8 bao phủ 3 role fixture, 9 width, overflow, keyboard, modal/drawer, hit-testing, history, route restoration và console.

## 36. Git commits/SHA

- `60842810e5e074d8c2b5562cddc55a4ec64cab50` — `chore(ui): finalize CRM UI R1 shell`.
- `d60f5ce` — `fix(ui): load Supabase vendor from root on admin routes`.
- Report được commit riêng sau khi hoàn tất smoke.

## 37. Maintenance ON

Rollout đầu: `dpl_6y7tLzZjmnaMgmbJFJ2Bf5m9sJAH`, read-back `enabled: true`. Hotfix rollout: `dpl_FnL3t9bwDU3QdFj1cStD6GvZumX6`, `READY`, alias production, read-back `enabled: true`; `/`, `/admin`, root vendor asset đều HTTP 200 trước reopen.

## 38. Production deployment

Final deployment: `dpl_994C3b1SoecgPH1nGHpz3TGWac7p` tại `https://crmkolor-31g9jb0sj-thien-di-s-projects1.vercel.app`, target production, trạng thái `READY`, aliased `https://crmkolor.vercel.app` và project alias.

## 39. Sale smoke

Không đổi TEST account sang Sale vì role switch là optional và STEP 8 yêu cầu read-only khi có thể. Sale navigation/deny, KPI Mine, absence của Reports/Admin/manager KPI routes và không restricted flash đã PASS bằng browser fixture. Final TEST role vẫn là Manager.

## 40. Manager smoke

`devil8xonline@gmail.com` ở role Manager: Sidebar đúng 5 module, không có Admin; Overview → Customer Hub → Allocation → KPI Team → KPI Library → Reports Hub → Reports Customers → Product PASS. Không có business write. Representative deep route/refresh/history PASS fixture; production security fallback không lộ Admin content.

## 41. Owner smoke

`hoathienbang87@gmail.com`: full CRM navigation và Admin Hub/Users/Categories/Settings/Health/Audit PASS; `Về CRM` trả đúng `#/overview`. Không Save, danger tool, lifecycle mutation. Fresh Admin deep-link sau hotfix restore đúng Owner shell và console sạch.

## 42. Data/settings integrity

Smoke chỉ đọc: không tạo/sửa customer, KPI, Product, role hoặc lifecycle; không gọi settings save. Audit UI vẫn hoạt động. Không có direct production DB credential độc lập để tạo fingerprint mới sau STEP 8, nên kết luận dựa trên zero-mutation path, fixture contract và audit/readback tốt nhất hiện có.

Historical settings drift from the previous smoke cannot be reconstructed field-by-field because a pre-change field snapshot was not captured. The current production settings state was accepted by the owner as the new controlled baseline. All subsequent smoke changes were compared against this baseline.

## 43. Maintenance final state

Production read-back cuối của `/js/config/maintenance.generated.js` là `enabled: false`. Marker local đã xóa, CRM mở tại canonical alias và deployment cuối `READY`.

## 44. Known limitations

- Không có direct DB fingerprint độc lập trong STEP 8; không tuyên bố bằng chứng chưa tồn tại.
- Sale production role switch không chạy để tránh mutation tùy chọn; browser fixture là bằng chứng Sale chính.
- Console cũ trong tab lâu sống còn lưu error trước hotfix; tab sạch sau hotfix có zero error.
- Historical settings drift limitation được ghi nguyên văn ở mục 42.

## 45. Final risk review

| Risk | Đánh giá cuối |
|---|---|
| Navigation/auth/role | Thấp; canonical authority và role fixture/production smoke PASS |
| Customer/KPI/Product state | Thấp; không mutation, regression/integration PASS |
| Product hit-testing | Thấp; browser fixture PASS |
| Pipeline/charts | Thấp; semantics và production data render PASS |
| Admin settings/lifecycle | Thấp; no-op/guard fixture PASS, Owner read-only smoke PASS |
| Dangerous tools | Thấp; isolated trong Admin, không chạy |
| Deployment secrets | Thấp; representative sensitive paths 404 |
| Admin deep-link assets | Đã đóng bằng `d60f5ce`, fresh console sạch |

## 46. Final UI-R1 closeout recommendation

**Đề nghị CLOSE CRM-UI-R1.** Tất cả critical gate của STEP 8 đã PASS, CRM production đang mở và canonical deployment ổn định. Mọi cải tiến tiếp theo nên mở dưới CRM-UI-R2 hoặc một feature phase độc lập. Dừng tại đây để Owner + K review.
