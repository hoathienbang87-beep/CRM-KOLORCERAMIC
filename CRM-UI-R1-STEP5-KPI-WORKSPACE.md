# CRM-UI-R1 STEP 5 — KPI Workspace + Role-aware Action Cards

## 1. Kết luận

**CRM-UI-R1 STEP5 FULL PASS — KPI WORKSPACE LIVE AND CRM REOPENED.** KPI Hub, deep route và phân quyền role đã live. Có một sai lệch dữ liệu đã tồn tại khi smoke: production hiện có 1 kỳ DRAFT thay vì 0 kỳ như baseline mô tả; không có kỳ ACTIVE và STEP 5 không tạo, sửa hoặc xóa kỳ này.

## 2. Starting baseline

- HEAD: `8d102a54d62b0cf643c9464e00c6dd274ead2a9c`.
- Production: `dpl_F39oJu3Wfr1rWGoEXfriVu9kxZMK`, READY.
- Maintenance: OFF.
- Source liên quan sạch; các artifact audit/smoke untracked có sẵn được giữ ngoài commit.

## 3. Current KPI UI audit

`kpi2OperationsPanel` phục vụ Sale; `kpiTeamPanel` dùng `kpiTeamState.activeMode` cho employee/history/review; `kpiFoundationPanel` chứa definitions, periods, assignment matrix và lifecycle R3/R3.1. Tab Nhân viên/Bộ KPI/Lịch sử trước đây điều khiển mode trong cùng màn hình. Drawers, review, evidence, period và assignment controls đều được map sang workspace tương ứng trước khi thay đổi.

## 4. Files changed

`.vercelignore`, `index.html`, `css/styles.css`, `js/components/app-shell.js`, `js/features/crm-app.js` và hai test STEP 5.

## 5. KPI IA implementation

KPI mở Hub trước. Sale có một đường vào KPI của tôi; Manager/Owner có KPI Team, Bộ KPI & Kỳ KPI, Lịch sử KPI. Action chi tiết tiếp tục nằm trong workspace nghiệp vụ.

## 6. KPI route model

`KPI_WORKSPACES` là nguồn khai báo cho `#/kpi`, `#/kpi/mine`, `#/kpi/team`, `#/kpi/library`, `#/kpi/history`, gồm capability, panel và mode. Router STEP 2 hiện hữu được mở rộng, không tạo router độc lập.

## 7. Role/capability mapping

Sale được phép Hub/Mine. Manager/Owner được phép Hub/Team/Library/History. Sale mở route quản lý sẽ fallback về `#/kpi`; Manager không thấy Admin.

## 8. KPI Hub

Hub dùng card compact cùng ngôn ngữ Customer Hub, có title, mô tả và trạng thái ngắn. Sidebar KPI giữ active trên mọi deep route.

## 9. Sale KPI card/workspace

Card `KPI của tôi` mở `#/kpi/mine`. Workspace tái sử dụng `kpi2OperationsPanel`, giữ event/submission/evidence và guards hiện hữu.

## 10. Manager/Owner KPI cards

Đúng ba card: KPI Team, Bộ KPI & Kỳ KPI, Lịch sử KPI. Không tạo card riêng cho evidence, review hoặc lifecycle action.

## 11. KPI Team workspace

`#/kpi/team` ánh xạ mode `employees`, giữ employee list, pending queue, filters, detail và assignment drawer. Production hiển thị kỳ DRAFT hiện hữu với 3 Sale và 0 assignment; không thực hiện gán.

## 12. KPI Library workspace

`#/kpi/library` mở trực tiếp `kpiFoundationPanel`; heading đổi thành `Bộ KPI & Kỳ KPI`. Production xác nhận 8 definitions, nút tạo kỳ và toàn bộ controls hiện hữu; không bấm thao tác ghi.

## 13. KPI History workspace

`#/kpi/history` ánh xạ mode `history`, đổi heading/context đúng route và giữ history per employee cùng config history.

## 14. Zero-period handling

Zero-state dựa trên kỳ status `ACTIVE`, không dựa vào tổng số period. Vì production có 1 DRAFT nhưng không ACTIVE, Hub và Sale Mine vẫn hiển thị `Chưa có kỳ KPI đang hoạt động`, không có `0%`, `0/0`, `NaN` hoặc `undefined`.

## 15. Definition/period distinction

Library card hiển thị `8 mục · 1 kỳ`; KPI Team hiển thị `Chưa có kỳ đang hoạt động`. Hai khái niệm definitions và active period không còn bị gộp.

## 16. Internal mode migration

Deep route là nguồn mode chính: Team → `employees`, Library → `library`, History → `history`. `activeKpiWorkspace` được giữ qua render và auth initialization.

## 17. Old KPI tab retirement

Tab mode cũ được giữ làm compatibility scaffolding với `hide`, `aria-hidden=true` và `pointer-events:none`; không còn trong keyboard/accessibility tree. Handler cũ chuyển sang canonical route.

## 18. Drawer compatibility

Không xóa DOM ID/control nào của R3/R3.1. Khi đổi KPI workspace, `closeDrawer()` đóng drawer không tương thích; detail/review/assignment controls vẫn hiện trong workspace đúng.

## 19. State/request preservation

`kpiTeamState`, selection, filters, caches và request tokens được giữ nguyên. Route switch không tạo listener mới; summary cache/in-flight guard tiếp tục chống request trùng.

## 20. Back/Forward/Refresh

Production PASS Back Hub → History và Forward → History. Refresh trực tiếp Library giữ Library. Unauthorized refresh của Sale fallback Hub.

## 21. Overview integration

Card KPI trên Overview tiếp tục trỏ `#/kpi`, nay mở Hub. Các route Overview khác không đổi.

## 22. Customer regression

STEP 3 static/browser PASS, gồm Hub/New/List/Care/Allocation, draft, drawer và accessibility.

## 23. Product regression

Products R1 static/UI và full-shell layout PASS; catalog, filters, drawer, mobile cards và hit-testing không đổi.

## 24. Reports regression

STEP 4 contract/browser PASS; Reports và chart relocation không thay đổi trong STEP 5.

## 25. Admin regression

Owner `/admin` và Nhật ký hoạt động PASS. Manager/Sale không thấy Admin; KPI History vẫn tách khỏi system audit.

## 26. Responsive/mobile

KPI Hub PASS tại 1440, 1366, 1180, 768, 390 và 360 px, không overflow; mobile một cột. KPI detailed responsive rules hiện hữu được bảo toàn.

## 27. Accessibility

Cards là `button`, có accessible name, focus-visible và text status. Heading/context semantic; tab compatibility bị loại khỏi focus và accessibility tree.

## 28. Local/static tests

PASS `test-ui-r1-step5-kpi-workspace.mjs`, JS syntax, `git diff --check`, STEP 2–4, Customer và Products contracts.

## 29. Browser tests

PASS `test-ui-r1-step5-kpi-workspace-browser.mjs` trên sáu viewport, role matrix và control preservation. Production smoke kiểm tra Hub, Team, Library, History, Mine, refresh, Back/Forward và unauthorized fallback.

## 30. R3/R3.1 regression

R3 static PASS 53 checks; R3 integration PASS 5 ACTIVE audit events và 3 negative guards. R3.1 static PASS; integration PASS revert/delete/cancel/roles/freeze/score/history/audit. Integration dùng PGlite cô lập.

## 31. Git commit/SHA

- `28462bb` — `feat(ui): add role-aware KPI workspace navigation`.
- `1a7fbdf` — `chore(deploy): exclude local credentials and smoke artifacts`.
- `caa16d9` — `fix(ui): derive KPI empty state from active period`.
- Report nằm trong commit tài liệu tiếp theo.

## 32. Maintenance ON

Maintenance ON được deploy và đọc lại `enabled: true`. Deployment cuối của gate sau forward-fix: `dpl_5Ca5uwR9g9rGqknLAKA8pTCKsknK`, READY.

## 33. Production deployment

Deployment mở cuối: `dpl_Gxv9Tp3s78Sz3GGmKqny4g32mmT6`, READY, alias `https://crmkolor.vercel.app`. Route model được đọc lại từ asset production. Lần đóng gói đầu phát hiện `.codex-smoke` chưa bị loại; `.vercelignore` đã được thêm, redeploy trước khi mở, và URL `.codex-prod-readonly.env` trả `NOT_FOUND`.

## 34. Sale smoke

TEST đổi Manager → Sale qua Owner Admin UI. PASS: sidebar 4 mục, Hub đúng một card, Mine có no-active state và không config control; direct Library fallback Hub; không business write.

## 35. Manager smoke

PASS ba card, Team, Library 8 definitions, History, no-active status, Back/Forward/Refresh và không Admin. Tài khoản TEST đã được trả về Manager qua canonical Admin UI.

## 36. Owner smoke

PASS ba card và quyền Admin tách biệt. Owner kiểm tra Hub và audit; lifecycle controls tồn tại trong Library nhưng không thao tác period.

## 37. Data/settings integrity

Trạng thái quan sát production cuối: 1 period DRAFT (`KPI tháng 9/2026`), 8 definitions, 0 assignments trong kỳ; không có kỳ ACTIVE. Sai lệch period đã có trước smoke STEP 5 và không do integration tests vì các test dùng PGlite. Audit hiển thị các period events trước đó nhưng chưa đủ bằng chứng để gán chính xác row DRAFT hiện tại; do chính sách no-business-mutation, không xóa row này. Không sửa customer/product/settings; chỉ có role TEST Sale ↔ Manager và session/audit tương ứng. Settings không được mở hoặc lưu.

## 38. Maintenance final state

OFF; asset canonical được đọc lại `enabled: false`. CRM đang mở. Final TEST role: Manager.

## 39. Known limitations

Baseline mô tả `kpi_periods=0` không khớp production thực tế `1 DRAFT`; cần Owner xác định giữ hay xóa ở phase riêng nếu muốn đưa count về 0. STEP 5 chỉ xác nhận 0 assignment từ UI của row; credentials local bị redacted nên không tạo được fingerprint DB độc lập cho submissions/events/evidence/settings. Browser responsive dùng DOM/CSS fixture; real-role smoke trực tiếp thực hiện desktop.

## 40. Next recommended step

Dừng tại STEP 5 để Owner + K review. Tách quyết định về kỳ DRAFT hiện hữu thành một data reconciliation có audit; không tự bắt đầu Reports/Admin/Product redesign hoặc KPI feature mới.
