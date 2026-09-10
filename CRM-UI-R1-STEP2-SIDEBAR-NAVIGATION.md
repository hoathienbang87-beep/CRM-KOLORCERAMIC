# CRM-UI-R1 STEP 2 — Sidebar Navigation

## 1. Kết luận

**CRM-UI-R1 STEP2 FULL PASS — SIDEBAR NAVIGATION LIVE AND CRM REOPENED**

## 2. Starting baseline

- Branch: `main`
- HEAD ban đầu: `e084c7d3968773b99e50aa327fb395282fd39e83`
- Production ban đầu: `dpl_FwWAfeZ2HgLsj2yHuN4bM6r7iG8W`, READY, maintenance OFF.
- Các artifact audit có sẵn được giữ nguyên và không đưa vào implementation commit.

## 3. Files changed

- `index.html`
- `css/styles.css`
- `js/app.js`
- `js/components/app-shell.js`
- `js/features/crm-app.js`
- `vercel.json`
- `scripts/test-ui-r1-step2-navigation.mjs`
- `scripts/test-products-shell-layout.mjs`
- `scripts/test-products-r1-ui.mjs`

## 4. Canonical navigation model

`CRM_NAV_ITEMS` là nguồn duy nhất cho thứ tự, label, hash/path, `mainView` và capability. Desktop Sidebar và mobile drawer cùng render từ model này.

## 5. Route map

- `#/overview` → `crm`
- `#/customers` → `customers`
- `#/kpi` → `kpi`
- `#/products` → `products`
- `#/reports` → `reports`
- `/admin` → Admin shell hiện hữu

## 6. Role/capability map

- Sale: Tổng quan, Khách hàng, KPI, Sản phẩm.
- Manager: thêm Báo cáo.
- Owner/Admin: thêm Quản trị.
- Việc lọc dùng các helper capability hiện hữu; Manager không được nâng thành system Admin.

## 7. setMainView compatibility

`setMainView(view, { syncHash })` tiếp tục điều khiển các panel luôn mounted. Caller cũ vẫn hoạt động; Sidebar đi qua `navigateToWorkspace()` để đồng bộ hash, panel và active state.

## 8. Old tab retirement strategy

DOM tab cũ được giữ làm compatibility scaffolding, nhưng bị `display:none`, vô hiệu pointer, `tabindex=-1` và `aria-hidden=true`; không còn là navigation authority.

## 9. Desktop Sidebar implementation

Sidebar rộng 240px, có label đầy đủ, active state và `aria-current="page"`, focus rõ, vùng account/role/logout phía dưới và có thể cuộn khi chiều cao thấp.

## 10. Mobile drawer implementation

Breakpoint 760px chuyển sang header/hamburger và drawer dùng cùng model. Drawer hỗ trợ backdrop, nút đóng, Esc, focus trap, trả focus về hamburger và khóa scroll nền.

## 11. Hash navigation

Hash được normalize qua whitelist. Hash rỗng/sai hoặc route không được cấp quyền trả về `#/overview` mà không hiển thị panel hạn chế.

## 12. Back/Forward/Refresh

Production Manager smoke xác nhận `Overview → KPI → Reports`, Back về KPI, Forward về Reports và Refresh tại Reports vẫn giữ `#/reports`.

## 13. Login/logout/maintenance behavior

Login shell và maintenance shell vẫn là guard cao nhất. Logout đóng mobile navigation và không để panel hạn chế lộ phía sau. Maintenance ON/OFF đã được kiểm tra trong các lần rollout.

## 14. Admin routing behavior

Owner mở Sidebar Quản trị tới canonical `/admin`; “Về CRM” trả về `#/overview`. Sale/Manager truy cập trực tiếp bị guard và trả về CRM. Smoke phát hiện `/admin` trần từng 404 do rewrite chỉ bắt route con; forward-fix đổi destination theo clean URL và xác nhận `/admin` cùng `/admin/*` đều phục vụ SPA shell.

## 15. CSS/z-index changes

Thứ tự lớp: main shell < mobile nav (16) < business modal/backdrop (20/21) < saving mask (31). Content wrapper có `min-width:0`; bảng lớn giữ overflow nội bộ.

## 16. Customer regression

Form Add Customer, danh sách, search/filter và các DOM/listener hiện hữu được giữ. Sale và Manager mở workspace Khách hàng thành công; không tạo hoặc sửa khách trong smoke.

## 17. KPI R3/R3.1 regression

Sale mở KPI của tôi không có config controls. Manager mở KPI Team với Nhân viên/Bộ KPI/Lịch sử. Các bộ test R3, R3 integration, R3.1 static/integration đều PASS; legacy runtime không được khôi phục.

## 18. Product regression

Catalog tải trên Sale; fixture desktop/mobile kiểm tra search/filter/detail/edit, decimal/server-confirmed và hit-testing đều PASS. Không có Product write production.

## 19. Reports regression

Manager/Owner tải Báo cáo, metrics, activity, filter, pagination và export controls. Sale không thấy menu và direct hash bị fallback.

## 20. Local/static tests

- Navigation contract: PASS.
- JS syntax: PASS.
- `git diff --check`: PASS.
- Product shell/layout và Product UI: PASS.
- Product R1 helpers/static: 40 checks PASS.
- KPI R3/R3.1 và các regression hiện hành: PASS.
- Hai test KPI legacy cũ vẫn tham chiếu contract đã retirement và được phân loại stale từ baseline, không phải regression Step 2.

## 21. Desktop browser tests

Chromium fixture PASS ở 761, 1131, 1180 và 1280px. Production smoke xác nhận Sidebar, active route, workspace, account controls và Admin transition.

## 22. Mobile browser tests

Chromium fixture PASS ở 390px: desktop Sidebar ẩn, hamburger/drawer hiện, menu dùng cùng role model, old tabs không tương tác và Product mobile cards không bị overlay sai.

## 23. Git commit/SHA

- `da950e811ee24f7032a2cd305123bf6fa14baca1` — navigation shell.
- `dd8415d747731e240475549e577521b4c68a7354` — restore workspace trước render.
- `b14fb749d045f5b3b5470c93884f72ad3c3c9965` — thêm exact canonical Admin rewrite.
- `e87dad5f492de41417ca9cf44460910631b50d49` — route Admin qua clean URL đúng cách.

## 24. Maintenance ON

Các rollout và forward-fix critical được đưa lên khi maintenance ON. Khi phát hiện lỗi stale view và lỗi canonical `/admin`, maintenance được bật lại trước khi sửa/deploy.

## 25. Production deployment

Deployment cuối: `dpl_JCSgAucNku9EdLoTEvDHKQoSvyzz`, READY, alias `https://crmkolor.vercel.app` và `https://crmkolor-thien-di-s-projects1.vercel.app`.

## 26. Sale real-role smoke

`devil8xonline@gmail.com` ở role Sale: login PASS; chỉ thấy bốn mục; Customers/KPI/Products tải; không có Reports/Admin/config KPI; `#/reports` và `/admin` bị fallback; logout sạch. Không có business write.

## 27. Manager real-role smoke

Tài khoản test được đổi lại Manager qua canonical Owner UI. Login PASS; thấy đúng năm mục; KPI Team và Reports tải; không thấy Quản trị; direct `/admin` bị fallback; Back/Forward/Refresh PASS; logout sạch. Role cuối là Manager.

## 28. Owner real-role smoke

`hoathienbang87@gmail.com`: thấy đúng sáu mục; Customers/KPI/Products/Reports tải; canonical `/admin` và `/admin/users` tải; “Về CRM” trả `#/overview`. Không kích hoạt các tool ghi dữ liệu.

## 29. Data/settings integrity

Read-only production query cuối xác nhận: `settings` count 1, key `crm`, `updated_at=2026-09-09T09:19:05.524674+00:00`, `updated_by=hoathienbang87@gmail.com`, server fingerprint `6f0b2fdd9c501236a66c69bcf8a8368a97d69b1626eaf0b04644d168e42e54fc`. Count/key/updated timestamp khớp controlled baseline; không có settings write trong Step 2. Canonical KPI hiện có 8 definitions, 0 assignments/submissions/events/evidence/action requests/duplicate matches. Test account active, lifecycle active, role cuối Manager. Các role change của test account là thay đổi đã được Owner phê duyệt và thực hiện qua canonical UI.

Historical settings drift from the previous smoke cannot be reconstructed field-by-field because a pre-change field snapshot was not captured. The current production settings state was accepted by the owner as the new controlled baseline. All subsequent smoke changes were compared against this baseline.

## 30. Maintenance final state

Maintenance OFF. CRM đang mở trên hai production aliases.

## 31. Known transitional limitations

Add Customer form vẫn nằm trong layout hiện hữu theo đúng scope Step 2. Deep workspace routes chưa được triển khai. Old tab nodes còn trong DOM chỉ để tương thích. Product integration test cần PGlite bên ngoài chưa được cài trong workspace; static/helper/UI regression đã PASS.

## 32. Next recommended step

Tiếp tục CRM-UI-R1 Step 3 cho workspace/card redesign dựa trên navigation foundation đã ổn định, giữ nguyên capability map và canonical route API của Step 2.
