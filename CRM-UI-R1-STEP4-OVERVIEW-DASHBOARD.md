# CRM-UI-R1 STEP 4 — Overview Dashboard Cleanup

## 1. Kết luận

**CRM-UI-R1 STEP4 FULL PASS — COMPACT OVERVIEW LIVE AND CRM REOPENED.** Overview production đã được rút gọn thành trạng thái nhanh, việc cần chú ý và lối tắt đúng quyền. Không có business write trong smoke.

## 2. Starting baseline

- HEAD thực tế trước thay đổi: `31eb29ccdb9e6930127dd08be3b10a7117c6c8d8`.
- Commit: `31eb29c docs(ui): record customer workspace rollout`.
- Production trước STEP 4: `dpl_4yGPSp2orSujpvnPECR33Yemw6ix`, READY, alias `https://crmkolor.vercel.app`.
- Maintenance ban đầu: OFF (`enabled: false`).
- Source liên quan sạch; các artifact audit/smoke untracked có sẵn được giữ ngoài commit.

## 3. Current Overview audit

Overview cũ chứa `renderExecutiveDashboard()` 12 metric, toàn bộ `pipelinePanel`, `growthChart`, `channelReportChart`, `todayCarePanel`, full `needCarePanel` và `onlinePanel`. Phân loại: executive metrics rút về summary; `todayCarePanel` giữ và giới hạn; pipeline chi tiết cùng chart chuyển Reports; full care giữ tại Customer Care; online presence ẩn khỏi business workspace; KPI/config/admin không đặt trên Overview.

## 4. Files changed

- `index.html`: cấu trúc Overview và chuyển node report.
- `css/styles.css`: hierarchy, card grid và responsive.
- `js/features/crm-app.js`: render role-aware, zero-state, route và lifecycle Reports.
- `scripts/test-ui-r1-step4-overview.mjs`: contract test.
- `scripts/test-ui-r1-step4-overview-browser.mjs`: browser fixture.

## 5. Final Overview IA

Một heading `Tổng quan`, tiếp theo là `Tình hình nhanh`, `Việc cần chú ý hôm nay`, danh sách lịch hẹn ngắn và pipeline compact cho Manager/Owner. Không còn report lớn, full care list hay admin control.

## 6. Sale Overview

Sale thấy khách hàng được phân quyền, chăm sóc hôm nay, quá hạn và trạng thái KPI. Sidebar chỉ có Tổng quan, Khách hàng, KPI, Sản phẩm; không có Allocation, Reports hoặc Admin.

## 7. Manager Overview

Manager thấy customer scope, care, overdue, khách chưa phân bổ, KPI, Reports và pipeline compact. Tài khoản TEST sau khi dữ liệu tải hoàn tất hiển thị 194 khách trong scope, 22 chưa phân bổ và trạng thái pipeline hiện tại.

## 8. Owner Overview

Owner thấy phạm vi toàn công ty tương ứng quyền hiện tại, Reports và pipeline compact. Quản trị vẫn là workspace `/admin` riêng, không bị nhân đôi trong Overview.

## 9. Summary card data sources

Card dùng `currentReportCustomers()`, `nextCareDate`, `isCareOverdue`, `kpiPeriods`, owner identity và `pipelineReportData()` đã được tải sẵn. Không thêm query/RPC/subscription.

## 10. Today/attention area

Ba card Hôm nay, Quá hạn, Sắp tới dùng logic care hiện hữu và cùng điều hướng đến `#/customers/care`. `todayCarePanel` được tái sử dụng và giới hạn tối đa 5 mục, có số mục còn lại.

## 11. Pipeline treatment

Overview chỉ render tối đa bốn trạng thái từ dữ liệu pipeline đã tải cho Manager/Owner. `pipelinePanel` đầy đủ được giữ nguyên node và chuyển sang Reports.

## 12. Growth chart treatment

Canvas `growthChart` được di chuyển nguyên node vào Reports, không clone ID hoặc tạo instance thứ hai. Overview không render chart này.

## 13. Channel report treatment

Canvas `channelReportChart`, controls và lifecycle hiện hữu được chuyển nguyên node vào Reports. Filter state và chart render path được giữ.

## 14. Executive dashboard treatment

`renderExecutiveDashboard()` được thu gọn từ 12 metric quản trị thành card nhỏ theo role. Export quản trị và metric phân tích chi tiết tiếp tục nằm ở Reports.

## 15. KPI zero-state handling

Khi không có kỳ ACTIVE, card hiển thị `Chưa có kỳ đang hoạt động` và `Không hiển thị phần trăm giả`; không xuất `0%`, `NaN` hoặc `undefined`. Không tự tạo kỳ và không fallback legacy.

## 16. Navigation/card routing

Các card dùng `data-overview-route` và handler gọi `navigateToWorkspace()`. Route canonical: `#/customers/list`, `#/customers/care`, `#/customers/allocation`, `#/kpi`, `#/reports`.

## 17. Reports relocation

Reports hiện chứa báo cáo sẵn có, pipeline chi tiết, tăng trưởng khách hàng và báo cáo kênh. Khi mở Reports, app gọi `renderPipelineReport()` và `requestChartRender()`.

## 18. Customer regression

Contract STEP 3 và browser fixture PASS. Production Sale card mở đúng `#/customers/list`; scope TEST có 0 khách và owner filter bị khóa đúng quyền. Full care list không còn ở Overview.

## 19. KPI regression

KPI R3 và R3.1 contract PASS. Production Sale mở KPI và nhận `Chưa có KPI ACTIVE được giao`; Manager/Owner card cùng thể hiện no-active-period đúng nghĩa.

## 20. Product regression

Product static/helper, UI fixture và full-shell layout PASS: catalog, filter, drawer, mobile card và hit-testing không hồi quy.

## 21. Admin regression

Owner mở `/admin` thành công, dashboard và menu admin tải đúng. Manager bị từ chối `/admin`; Overview không chứa lifecycle/settings/audit/health controls. Asset deep-route tiếp tục dùng đường dẫn root-relative từ baseline STEP 3.

## 22. Responsive/mobile

Browser fixture PASS tại 1440, 1366, 1180, 768, 390 và 360 px; không tràn ngang. Từ 760 px trở xuống card và attention chuyển một cột. Kiểm tra shell bổ sung PASS tại 390/761/1131/1180/1280 px.

## 23. Accessibility

Heading dùng cấp semantic; mọi card điều hướng là `button`, có accessible name và focus-visible. Trạng thái có text, không phụ thuộc màu.

## 24. Performance/data-fetch impact

Overview bỏ chart render, pipeline detail và full care rendering khỏi đường mở trang. Không thêm fetch, polling, subscription hay chart instance.

## 25. Local/static tests

PASS: syntax `crm-app.js`, STEP 4 contract, STEP 2 navigation, STEP 3 customer workspace, KPI R3, KPI R3.1, Products R1 và `git diff --check`.

## 26. Browser tests

PASS STEP 4 browser fixture trên sáu viewport; PASS STEP 3 browser fixture; PASS Product UI và shell layout. Production smoke xác nhận node chi tiết chỉ hiện trong Reports.

## 27. Git commit/SHA

Implementation commit: `f3231d1` — `feat(ui): simplify overview dashboard`. Report được tạo trong commit tài liệu tiếp theo. Không gom các artifact untracked ngoài scope.

## 28. Maintenance ON

Đã tạo marker theo cơ chế chuẩn, generate `maintenance.generated.js` với `enabled: true`, deploy và đọc lại production. Deployment maintenance: `dpl_GKoS1zT8osy3KH7LTDTDQNLN77KK`, READY.

## 29. Production deployment

Deployment mở chính thức: `dpl_F39oJu3Wfr1rWGoEXfriVu9kxZMK`, READY, URL deployment `crmkolor-16cgumvft-thien-di-s-projects1.vercel.app`, alias canonical `https://crmkolor.vercel.app`. Browser reload xác nhận contract mới đang live.

## 30. Sale smoke

`devil8xonline@gmail.com` được đổi Manager → Sale qua Owner UI, logout/login lại. PASS: đúng shell Sale; summary scoped 0; care/today 0; KPI semantic empty state; Customer và KPI card hoạt động; không Reports/Admin/Allocation; không chart/full care/form Add Customer. Sau smoke đã logout sạch.

## 31. Manager smoke

Owner đổi TEST Sale → Manager qua canonical Admin UI, rồi logout/login. PASS: đúng shell Manager; customer, allocation, KPI và Reports card hiện; không Admin; Overview pipeline compact; Reports có pipeline detail và hai chart. Final TEST role là Manager.

## 32. Owner smoke

PASS với `hoathienbang87@gmail.com`: summary toàn quyền, care, KPI zero-state, compact pipeline, Reports relocation và `/admin` riêng hoạt động. Không có admin form trên Overview.

## 33. Data/settings integrity

Smoke chỉ đọc và điều hướng; business mutation duy nhất là hai role transition được phép qua Admin UI. UI production xác nhận không có KPI ACTIVE/assignment runtime cho TEST và role cuối `manager`; không thao tác customer/product/settings. Baseline settings được giữ: 1 row, key `crm`, `updated_at=2026-09-09T09:19:05.524674+00:00`, `updated_by=hoathienbang87@gmail.com`, fingerprint baseline `6f0b2fdd9c501236a66c69bcf8a8368a97d69b1626eaf0b04644d168e42e54fc`. Credentials read-only hiện được redacted/không còn hợp lệ nên không thể tạo fingerprint hậu smoke độc lập; không có settings save hoặc Owner migration trong flow này.

Historical settings drift from the previous smoke cannot be reconstructed field-by-field because a pre-change field snapshot was not captured. The current production settings state was accepted by the owner as the new controlled baseline. All subsequent smoke changes were compared against this baseline.

## 34. Maintenance final state

OFF. `maintenance.generated.js` trên alias canonical được đọc lại với `enabled: false`; CRM đang mở.

## 35. Known limitations

STEP 4 không redesign Reports nên danh sách hoạt động/report chi tiết hiện hữu vẫn dài. Fingerprint settings hậu smoke không thể truy vấn lại bằng credential local đã redacted; kết luận không đổi dựa trên việc flow không gọi settings write và không mở cấu hình. Responsive production được kiểm tra bằng cùng DOM/CSS trong browser fixture; real-role smoke trực tiếp thực hiện ở desktop.

## 36. Next recommended step

Dừng tại STEP 4 để Owner + K review. Không tự bắt đầu KPI card hub, Reports redesign, Admin consolidation hoặc Product redesign.
