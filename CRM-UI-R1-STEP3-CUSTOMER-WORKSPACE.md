# CRM-UI-R1 STEP 3 — Customer Workspace + Action Cards

## 1. Kết luận

**CRM-UI-R1 STEP3 FULL PASS — CUSTOMER WORKSPACE LIVE AND CRM REOPENED.** Customer Hub và bốn workspace đã hoạt động trên production; controlled smoke Owner/Manager/Sale PASS; maintenance cuối OFF.

## 2. Starting baseline

Bắt đầu từ `0eab2695575429faf69fa53f94b6a3f6a550d1f7`, Step 2 FULL PASS. KPI production giữ nguyên 0 periods, 8 definitions, 0 assignments/runtime; không tái tạo kỳ KPI. Các artifact audit/checkpoint untracked có sẵn được giữ nguyên.

## 3. Files changed

- `index.html`: Customer Hub, dedicated workspaces, di chuyển form/panel hiện hữu, root-relative assets.
- `css/styles.css`: bỏ layout cột form 330px, thêm card/workspace/responsive styles.
- `js/components/app-shell.js`: `CUSTOMER_WORKSPACES` và explicit route whitelist.
- `js/features/crm-app.js`: authorization, workspace visibility/state và navigation.
- `scripts/test-ui-r1-step3-customer-workspace.mjs`: contract test Step 3.
- `scripts/test-ui-r1-step3-customer-workspace-browser.mjs`: browser fixture desktop/mobile.
- `scripts/test-products-shell-layout.mjs`, `scripts/test-ui-r1-step2-navigation.mjs`: cập nhật regression theo layout mới và deep-admin assets.

## 4. Customer IA implementation

Sidebar cấp 1 giữ nguyên. `Khách hàng` mở Hub và các card dẫn tới New, List, Care, Allocation theo IA được duyệt.

## 5. Customer workspace route model

Một model declarative `CUSTOMER_WORKSPACES` ánh xạ `hub | new | list | care | allocation` sang hash, capability và panel. Router chỉ resolve whitelist; `#/customers/foo` và `#/customers///` về `#/customers`.

## 6. Role/capability mapping

Sale được Hub/New/List/Care; Allocation có capability `manager`. Manager/Owner dùng đủ năm route. Direct Allocation của Sale được thay URL và fallback về Hub, không flash panel.

## 7. Customer Hub

Hub có bốn button semantic, mô tả một dòng, focus/hover rõ và kích thước gọn. Card Allocation bị ẩn và disable với Sale.

## 8. Add Customer workspace

`#/customers/new` là panel full workspace, `max-width: 880px`, có context/back và nguyên form nhập khách.

## 9. Form DOM/listener preservation

Toàn bộ ID form cũ chỉ xuất hiện đúng một lần. Node form được restructure tại source, không clone, không render lại; các listener `saveCustomer`, clear, phone, partner toggle và hydration tiếp tục bám node cũ.

## 10. Draft preservation

Panel chỉ đổi `hide`, `inert`, `aria-hidden`; node không unmount. Browser fixture xác nhận draft còn sau New → List → New và chỉ mất khi bấm Clear.

## 11. Search/List workspace

`#/customers/list` dùng nguyên `customerSearchPanel`, giữ search, filter, quick filter, paging, export, row interaction và drawer.

## 12. Care/Appointments workspace

`#/customers/care` dùng nguyên `needCarePanel`; các scope Hôm nay/Quá hạn/Sắp tới/Chưa hẹn và state hiện hữu được giữ. `todayCarePanel` vẫn ở Overview.

## 13. Allocation workspace

`unassignedPoolPanel` được chuyển nguyên node sang `customerAllocationPanel`. Manager/Owner thấy selector, bulk selection, assign và export; smoke không thực hiện phân bổ thật.

## 14. Customer detail drawer compatibility

Drawer hiện hữu không đổi. Khi đổi Customer sub-workspace hoặc rời main view, drawer được đóng để không giữ overlay stale; không thêm deep-link drawer.

## 15. Sidebar active-state integration

Mọi Customer deep route dùng `navId: customers`; desktop/mobile Sidebar giữ active `Khách hàng`.

## 16. Hash/Back/Forward/Refresh

Hash navigation dùng `pushState`, `hashchange`, explicit resolver. Refresh trực tiếp `#/customers/list` trên production khôi phục đúng List; fixture bao phủ mọi deep route và invalid fallback.

## 17. Permanent aside retirement

Đã xóa `<aside class="panel">` chứa Add Customer và toàn bộ CSS sticky/track liên quan. Production xác nhận `.layout > aside.panel` count = 0.

## 18. Overview layout impact

`.layout` trở thành một workspace column; Overview mở rộng theo chiều ngang. Today Care và online presence được giữ ở Overview, không nằm trong form.

## 19. KPI regression

`test-phase-kpi-r3.mjs` PASS 53 checks; `test-phase-kpi-r31.mjs` PASS. Owner/Manager production mở KPI Team bình thường khi 0 active periods; không tạo KPI data.

## 20. Product regression

Product R1 static/helper PASS 40 checks; shell layout browser PASS; Manager production mở Products được. Không add/edit sản phẩm.

## 21. Reports regression

Owner và Manager production mở Reports được trên chiều rộng mới; panel/filter/chart shell render bình thường. Không export hoặc ghi dữ liệu.

## 22. Admin regression

`/admin` PASS. Smoke phát hiện fresh OAuth quay lại `/admin/users` làm relative assets resolve sai; forward-fix đổi CSS/JS sang root-relative và thêm contract test. Deep `/admin/users` sau fix khởi tạo đúng và Sale bị trả về CRM.

## 23. Responsive/mobile

Browser fixture PASS tại 1440, 1366, 1180, 768, 390, 360px. Hub xuống một cột dưới 760px; form chỉ xuất hiện ở New; shell không tràn ngang ngoài table wrapper có kiểm soát.

## 24. Accessibility

Cards/back là `<button>`, keyboard reachable, có focus-visible. Panel ẩn đồng thời có `display:none`, `inert`, `aria-hidden=true`; panel hiện gỡ `inert` và đặt `aria-hidden=false`.

## 25. Local/static tests

PASS: JS syntax; Step 2 navigation; Step 3 contracts; KPI R3; KPI R3.1; Product R1; `git diff --check`.

## 26. Browser tests

Step 3 fixture PASS cho routes, role denial, active Sidebar, single form, hidden form, draft, responsive. Shell layout fixture PASS tại 360/390/768/1180/1440px. Production smoke dùng UI thật và dữ liệu theo quyền thật.

## 27. Git commit/SHA

- `563a0fd277dd44f8a3caeaae246559bbf175128b` — `feat(ui): add customer workspace navigation`
- `ce7669c` — `fix(ui): load assets on deep admin routes`

## 28. Maintenance ON

Rollout chính: `dpl_BW3HU7y4knPvsBTT82weksh5voNw`, READY, read-back `enabled=true`. Forward-fix: `dpl_BsN8dP6QEuDpN1F2YDtUfyLxr1oH`, READY, maintenance ON trước khi thay production.

## 29. Production deployment

Deployment cuối `dpl_4yGPSp2orSujpvnPECR33Yemw6ix`, READY, target production. Aliases gồm `https://crmkolor.vercel.app` và project alias. HTTP read-back xác nhận absolute assets, `CUSTOMER_WORKSPACES`, Allocation route và maintenance OFF.

## 30. Sale smoke

`devil8xonline@gmail.com` ở role Sale: login PASS; Sidebar đúng 4 item; Hub đúng 3 card; New/List/Care PASS; Allocation card không thấy; direct Allocation fallback Hub; không có panel restricted. Không tạo khách.

## 31. Manager smoke

`devil8xonline@gmail.com` ở role Manager: Hub 4 card, Allocation/pool PASS; KPI/Products/Reports navigation PASS. Không phân bổ và không ghi dữ liệu. Role cuối đã trả về Manager qua Admin UI canonical.

## 32. Owner smoke

`hoathienbang87@gmail.com`: Hub 4 card, New/List/Care/Allocation PASS; refresh List PASS; `/admin`, KPI, Products, Reports PASS; permanent aside count 0.

## 33. Data/settings integrity

Không bấm Save Customer, care, assignment, KPI, Product hoặc settings. Mutation có chủ đích duy nhất là TEST role Manager → Sale → Manager qua UI canonical; account có 0 khách và 0 lịch hẹn mở. Audit cuối không có settings action mới. Baseline settings được kế thừa từ checkpoint Step 2: count 1, key `crm`, `updated_at=2026-09-09T09:19:05.524674+00:00`, `updated_by=hoathienbang87@gmail.com`, fingerprint `6f0b2fdd9c501236a66c69bcf8a8368a97d69b1626eaf0b04644d168e42e54fc`; UI/config và audit không cho thấy drift trong smoke.

Historical settings drift from the previous smoke cannot be reconstructed field-by-field because a pre-change field snapshot was not captured. The current production settings state was accepted by the owner as the new controlled baseline. All subsequent smoke changes were compared against this baseline.

## 34. Maintenance final state

HTTP read-back `maintenance.generated.js` xác nhận `enabled=false`; Owner UI xác nhận maintenance không hiển thị. CRM OPEN.

## 35. Known limitations

Customer drawer vẫn không deep-link theo đúng scope Step 3. Settings exact fingerprint cuối không được tái truy vấn trực tiếp vì production secret pull trả placeholder; gate dựa trên controlled baseline, không có settings write path được kích hoạt và audit không có settings action mới. Project alias phụ có Vercel protection khi gọi không có browser session; production canonical `crmkolor.vercel.app` hoạt động bình thường.

## 36. Next recommended step

Owner + K review Step 3 trên production. Không bắt đầu KPI card redesign, Reports redesign, Overview redesign hoặc Admin consolidation trong phase này.
