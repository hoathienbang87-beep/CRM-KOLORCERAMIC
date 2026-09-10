# CRM-UI-R1 STEP 5.1 — Overview Customer Charts

## 1. Kết luận

**CRM-UI-R1 STEP5.1 FULL PASS — ORIGINAL CUSTOMER OVERVIEW CHARTS + CHANNEL DRILLDOWN RESTORED AND CRM REOPENED.** Hai biểu đồ customer cũ đã trở lại Overview, chỉ có một instance/canvas cho mỗi biểu đồ, drilldown giữ cùng nguồn dữ liệu đã scope và production đang mở.

## 2. Starting baseline

- HEAD trước sửa: `2373a5331d89189c5251ab8cfa44d5d7b4a174df`.
- Production trước sửa: `dpl_Gxv9Tp3s78Sz3GGmKqny4g32mmT6`, READY, maintenance OFF.
- Các file untracked có sẵn được giữ nguyên, không đưa vào commit.

## 3. Old chart implementation recovery

Implementation được tìm trong `index.html` và `js/features/crm-app.js` tại parent của Step 4 commit `f3231d1`. Các hàm cũ còn nguyên gồm `renderChart`, `renderChannelReportChart`, `handleChannelReportClick`, `openChannelReportDetail`, `customerDetailRows` và `openDetailModal`. Step 4 chỉ chuyển `.chart-grid` sang Reports và đổi vòng render.

## 4. Exact chart semantics

- Growth: số khách được tạo trong từng tháng T1–T12 của năm hiện tại; đây là số phát sinh theo tháng, không phải số cộng dồn.
- Channel: khách đã qua `customers.filter(canSeeCustomer)`, lọc theo khoảng thời gian, chuẩn hóa bằng `canonicalChannel`; null/không khớp vào nhãn `Khác`.
- Count và modal cùng dùng `rowsByLabel` được lập trong một lần render.

## 5. Files changed

- `index.html`
- `css/styles.css`
- `js/features/crm-app.js`
- `scripts/test-ui-r1-step4-overview.mjs`
- `scripts/test-ui-r1-step4-overview-browser.mjs`
- `scripts/test-ui-r1-step51-overview-charts.mjs`
- `scripts/test-ui-r1-step51-overview-charts-browser.mjs`

## 6. Overview placement

Thêm section `overviewCustomerCharts` sau compact pipeline. Desktop đặt channel bên trái và growth bên phải; breakpoint `1180px` xếp thành một cột. Summary, attention, lịch hẹn và compact pipeline của Step 4 giữ nguyên.

## 7. Customer channel chart

Node `channelReportChart` cũ được chuyển về Overview. Bộ lọc tuần/tháng/năm/custom và nút xóa lọc được giữ. Nhãn hiển thị là “Khách hàng theo kênh”.

## 8. Channel click/drill-down

Listener cũ tiếp tục dùng `channelReportHitAreas`. Chỉ channel có `value > 0` có hit-area; vùng click bám theo thanh và click khoảng trắng không mở modal.

## 9. Restored modal behavior

Modal duy nhất `detailModal` được tái sử dụng với tiêu đề `Khách hàng theo kênh: {label}`. Close button, backdrop và Esc đều đóng modal. Modal được bổ sung `role="dialog"`, `aria-modal="true"` và `aria-labelledby`.

## 10. Modal customer filter consistency

Fixture Facebook=2, Zalo=1 PASS: click Facebook chỉ hiện Customer A/B; Customer C và Unauthorized D không xuất hiện. Click Zalo chỉ hiện Customer C. Không có phép lọc thứ hai lệch khỏi chart count.

## 11. Role/scope security

Cả hai chart khởi đầu bằng `customers.filter(canSeeCustomer)`. Fixture Sale loại Unauthorized D khỏi cả count và modal. Không có fetch company-wide mới, RPC mới hoặc nới RLS.

## 12. Customer detail integration

Modal tiếp tục render `customerDetailRows`; nút `data-open-care` đóng modal rồi gọi customer drawer chuẩn `openDrawer(id, "care")`.

## 13. Monthly growth chart

Giữ canvas line chart cũ và logic `createdAt` theo tháng của năm hiện tại. Khi toàn bộ 12 tháng bằng 0, canvas hiển thị “Chưa có dữ liệu khách hàng trong năm nay.” thay vì đường 0 khó hiểu.

## 14. Reports impact

Reports giữ report center, activity, filter, pagination/export và `pipelinePanel`. Wrapper phân tích được đổi nhãn thành “Pipeline khách hàng”; không còn heading/card/canvas rỗng hoặc chart trùng.

## 15. Responsive/mobile

Browser fixture PASS tại `1440x900`, `1366x768`, `1180px`, `390px`, `360px`; mobile một cột, modal theo drawer full-screen hiện có và không có page overflow ngang.

## 16. Performance

Không thêm dependency, polling, subscription hoặc dataset. `renderCrmView` gọi lại renderer khi vào Overview; debounce resize cũ giữ nguyên.

## 17. Local/static tests

PASS: JS syntax, Step 2, Step 3, Step 4 cập nhật, Step 5, Step 5.1, Product R1 static, KPI R3 static/integration, KPI R3.1 static/integration và `git diff --check`.

## 18. Browser tests

PASS: Step 3, Step 4 cập nhật, Step 5 và Step 5.1. Step 5.1 kiểm tra responsive, actual canvas event path trong fixture, category hit-test, modal exact list, đóng/mở lại, Esc, click whitespace và Sale scope.

## 19. Regression

Navigation, Customer workspaces, compact Overview, KPI Workspace, KPI R3/R3.1 và Product static giữ PASS. `test-products-r1-integration.mjs` không chạy được vì runtime ngoài repo `PRODUCTS_TEST_PGLITE_ENTRY` không tồn tại trên máy; thay đổi này không chạm Product/SQL.

## 20. Git SHA

Commit implementation: `0aaf8d6b0c31c242a8f67a323349ae7b1f7eda27` (`fix(ui): restore interactive customer overview charts`).

## 21. Maintenance ON

Đã sinh và đọc lại `maintenance.generated.js` với `enabled: true`. Deployment maintenance: `dpl_AFW2TrB657GaviiRTH2gCMwDZGxj`, READY.

## 22. Production deployment

Deployment ứng dụng: `dpl_EZ8r8oSEjSe8tnnmz6rpkxCnaNQu`, READY. Alias: `https://crmkolor.vercel.app/`.

## 23. Sale security smoke

Fixture Sale có A/B/C được phép và D không được phép. Kết quả: D không có trong count và modal; click khoảng trắng không mở danh sách. Không gán khách thật và không đổi role TEST sang Sale trong production cho task UI này.

## 24. Manager smoke

Đăng nhập production bằng `devil8xonline@gmail.com`, shell xác nhận role Manager. Overview hiển thị hai chart và 194 khách theo phạm vi; KPI vẫn báo không có kỳ ACTIVE. Không thực hiện write.

## 25. Owner smoke

`hoathienbang87@gmail.com` xác nhận Overview có hai chart, channel filter/render hiện dữ liệu production (ví dụ Facebook=1, Tiktok=11, Khác=34 trong custom range), monthly growth hiển thị. Reports còn activity và pipeline; `/admin` và navigation không bị thay đổi. Drilldown logic được xác nhận bằng browser fixture do công cụ smoke production không cung cấp click tọa độ canvas đáng tin cậy.

## 26. Business/settings integrity

Task chỉ thay HTML/CSS/JS frontend và test. Smoke chỉ điều hướng, đổi filter cục bộ, logout/login; không gọi thao tác lưu. Customer, KPI, Product và settings không có expected mutation. Không có credential production read-only hợp lệ để tạo fingerprint DB hậu kiểm độc lập.

Historical settings drift from the previous smoke cannot be reconstructed field-by-field because a pre-change field snapshot was not captured. The current production settings state was accepted by the owner as the new controlled baseline. All subsequent smoke changes were compared against this baseline.

## 27. Maintenance final state

`maintenance.generated.js` trên production đã được đọc lại với `enabled: false`; CRM mở và tải thành công cho Owner và Manager.

## 28. Known limitations

- Production canvas được xác nhận bằng hiển thị và dữ liệu thật; click tọa độ chính xác được chứng minh trong browser fixture vì CUA locator hiện không hỗ trợ coordinate click đáng tin cậy.
- Product PGlite integration phụ thuộc runtime ngoài repo hiện thiếu.
- Không có DB credential read-only hợp lệ để fingerprint từng bảng; bằng chứng integrity dựa trên UI-only code path và không thực hiện write action.

## 29. Final recommendation

Chấp nhận Step 5.1 FULL PASS và giữ CRM mở. Không cần chỉnh KPI draft, customer business data, Product hoặc settings.
