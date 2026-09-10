# CRM-UI-R1 STEP 6.1 — Pipeline Count Labeling & Presentation Fix

## 1. Kết luận

FULL PASS. Production phân biệt rõ customer entity count và stage membership count; pipeline business semantics, role scope và dữ liệu được giữ nguyên.

## 2. Starting baseline

Starting HEAD: `c7bf9e3c4565325cf48051c85a331d9029995314`. Working tree không có tracked dirty source; các file untracked có sẵn được bảo toàn.

## 3. Previous misleading presentation

Full pipeline trước đây cộng mọi stage membership rồi ghi `${sum} khách theo trạng thái hiện tại`. Snapshot production là 194 customer duy nhất và 196 membership, nên nhãn cũ khiến 196 bị hiểu là entity count.

## 4. Preserved pipeline semantics

Giữ nguyên `pipelineReportData()`, `currentReportCustomers()`, `customerHasDealStatus()`, `customerHasCompletedDeal()`, `latestDealStatus()`, stage order, deal history và `canSeeCustomer()`.

## 5. Files changed

Thay đổi `index.html`, `css/styles.css`, `js/features/crm-app.js`; thêm `scripts/test-ui-r1-step61-pipeline-presentation.mjs` và `scripts/test-ui-r1-step61-pipeline-presentation-browser.mjs`.

## 6. Unique customer count

`uniqueCount` lấy trực tiếp từ `currentReportCustomers().length`. Production smoke hiển thị `194 khách hàng duy nhất`; không suy ra từ membership hoặc overlap.

## 7. Membership count

`membershipCount` tiếp tục là `pipelineReportData().reduce((sum, item) => sum + item.count, 0)`. Production smoke hiển thị `196 lượt phân loại theo trạng thái/lịch sử giao dịch`.

## 8. Percentage treatment

Giữ denominator là tổng membership và đổi nhãn từng card thành `Tỷ trọng lượt phân loại: X%`. Không dùng unique count làm denominator, nên tỷ lệ không tạo phép chia khiến tổng vượt 100%.

## 9. Helper/explanation text

Full Reports hiển thị semantic text: `Một khách hàng có thể xuất hiện ở nhiều trạng thái khi có lịch sử giao dịch khác nhau.` Nội dung luôn đọc được, không phụ thuộc tooltip.

## 10. Full Reports pipeline

`#/reports/customers` có heading `Pipeline khách hàng`, hai số authority tách biệt, helper text, nhãn tỷ trọng và stage breakdown. Zero state chỉ hiện `Chưa có dữ liệu pipeline.`

## 11. Overview compact pipeline

Overview vẫn dùng bốn stage đầu và thêm context động `${shown}/${allStages.length} trạng thái chính`; production hiện là `4/6 trạng thái chính`. Không thêm tổng dài vào Overview.

## 12. Role/scope preservation

Manager và Owner đọc Reports theo capability hiện hữu. Sale denial và `canSeeCustomer()` không thay đổi. Presentation mới chỉ đọc dataset đã authorized, không mở rộng scope.

## 13. Zero/no-overlap/overlap fixtures

Static test PASS cho: zero `0/0`; no-overlap `10/10`; mandatory overlap `3 unique/4 membership`; many-overlap `100 unique/130 membership`. Không có giả định chênh lệch chỉ 1 hoặc 2.

## 14. Pipeline detail regression

Stage modal giữ nguyên membership và không dedupe chéo stage. Production drill-down `Đã mua` vẫn hiển thị hai customer hợp lệ, gồm customer đồng thời có stage khác.

## 15. Overview chart regression

Hai biểu đồ `Khách hàng theo kênh` và `Tăng trưởng khách hàng theo tháng` vẫn hiện trên production. STEP 5.1 browser test, channel drill-down và Sale scope fixture PASS.

## 16. Responsive/mobile

Browser fixture PASS tại 1440, 1366, 1180, 390 và 360 px. Summary dùng flex-wrap, stage grid chuyển một cột trên mobile và không có page overflow.

## 17. Accessibility

Summary có semantic `strong`/text và `aria-live="polite"`; helper là paragraph đọc được; tỷ trọng nằm trong text của từng button. Counts hiểu được khi không hover.

## 18. Performance

Không thêm fetch, RPC, subscription hoặc dependency. Unique count dùng data đã tải; Overview chỉ gọi `pipelineReportData()` một lần rồi slice.

## 19. Local/static tests

PASS: STEP 6.1 contract, STEP 2 navigation, STEP 3 Customer, STEP 4 Overview, STEP 5 KPI, STEP 5.1 charts, STEP 6 Reports, KPI R3/R3.1 static/integration, Product R1 static, JS syntax và `git diff --check`.

## 20. Browser tests

PASS: STEP 3, STEP 4, STEP 5, STEP 5.1, STEP 6, STEP 6.1 tại các breakpoint yêu cầu; Product UI và Product shell/layout. Product PGlite integration không chạy trong session này vì bundled runtime không có `@electric-sql/pglite`; thay đổi không chạm Product hoặc database.

## 21. Git SHA

Implementation commit: `e544ed419fb8f3ee44ad41fb61577fae67b2fa14` — `fix(ui): clarify pipeline customer counts`.

## 22. Maintenance ON

Deployment gate `dpl_7D9q1wqnUQPFmktCQp2JAmA2BFaq` READY. Readback `maintenance.generated.js` xác nhận `enabled: true`; production assets chứa exact presentation code.

## 23. Production deployment

Final production deployment: `dpl_7cqo5tWhWuXkx7qpvWwuGwJ31jje`, URL `https://crmkolor-5wu29tobo-thien-di-s-projects1.vercel.app`, target production, READY và alias `https://crmkolor.vercel.app`.

## 24. Manager smoke

`devil8xonline@gmail.com` xác nhận role Manager. Full pipeline hiển thị 194 unique/196 membership, sáu stage và tỷ trọng có nhãn đúng. Drill-down PASS; Overview hiện `4/6 trạng thái chính` cùng hai chart.

## 25. Owner smoke

`hoathienbang87@gmail.com` xác nhận role Owner. Direct route `#/reports/customers` hiển thị đúng presentation động 194 unique/196 membership và đầy đủ stage.

## 26. Data/settings integrity

Không có customer, deal, KPI, Product hoặc settings write; không mở/lưu settings; không migration, SQL hay RPC change. Smoke chỉ đọc và mở detail. Role của tài khoản TEST vẫn là Manager.

## 27. Maintenance final state

Readback alias chính sau deployment cuối: `MAINTENANCE_CONFIG.enabled: false`. CRM đã mở.

## 28. Known limitations

Giá trị production 194/196 là snapshot động và có thể thay đổi theo dữ liệu business. Product PGlite integration thiếu runtime dependency như nêu tại mục 20; mọi regression liên quan source/UI Product đều PASS.

## 29. Recommendation

Giữ presentation này cùng semantics multi-stage đã được Owner + K duyệt. Dừng STEP 6.1 và chờ review trước khi bắt đầu STEP 7 hoặc thay đổi reporting khác.
