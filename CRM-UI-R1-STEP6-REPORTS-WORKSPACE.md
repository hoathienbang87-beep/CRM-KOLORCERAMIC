# CRM-UI-R1 STEP 6 — Reports Workspace

## 1. Kết luận

FULL PASS. Reports Workspace đã lên production, kiểm tra đủ Manager, Owner và Sale denial; CRM đã mở lại.

## 2. Starting baseline

Baseline Git: `3b44395ea2d96b38fbf02cf0f643ba236a3aacd3`. Deployment production ban đầu: `dpl_EZ8r8oSEjSe8tnnmz6rpkxCnaNQu`, trạng thái READY; maintenance ban đầu OFF.

## 3. Current Reports audit

Đã đối chiếu các luồng cũ: tổng hợp quản trị, hoạt động Sale, bộ lọc/phân trang/export và pipeline. Các phép tính hiện hữu được giữ nguyên, chỉ tổ chức lại không gian làm việc và route.

## 4. Files changed

Thay đổi `index.html`, `css/styles.css`, `js/components/app-shell.js`, `js/features/crm-app.js`; cập nhật các test UI liên quan và thêm test STEP 6.

## 5. Final Reports IA

Reports Hub có đúng ba workspace: Tổng hợp quản trị, Hoạt động Sale, Khách hàng & kênh.

## 6. Report route model

Mô hình `REPORT_WORKSPACES` khai báo route, capability và panel: `#/reports`, `#/reports/summary`, `#/reports/sales`, `#/reports/customers`.

## 7. Role/capability mapping

Manager và Owner có capability Reports. Sale không có mục Reports và mọi deep link Reports đều quay về Overview.

## 8. Reports Hub

Hub hiển thị đúng ba action card, điều hướng bằng một handler `data-report-route`, nội dung rõ mục đích từng báo cáo.

## 9. Tổng hợp quản trị

`#/reports/summary` giữ các chỉ số tổng hợp hiện hữu và nút xuất báo cáo quản trị. Smoke production đọc được 194 khách hàng trong phạm vi.

## 10. Hoạt động Sale

`#/reports/sales` giữ báo cáo hoạt động Sale. Dữ liệu gồm task khách đang mở, care log trong khoảng chọn, bản ghi mua căn bản trong khoảng chọn và giao dịch hoàn tất trong khoảng chọn; không được diễn giải thành chỉ số hiệu suất tuyệt đối.

## 11. Khách hàng & kênh

`#/reports/customers` chứa pipeline chi tiết theo phạm vi phân quyền và liên kết quay về biểu đồ nhanh ở Overview.

## 12. Pipeline placement

Pipeline đầy đủ nằm tại Reports/Khách hàng & kênh; Overview giữ bản tóm tắt bốn stage. Production hiện phân loại tổng 196 theo semantics pipeline vốn có.

## 13. Activity report preservation

Giữ nguyên nguồn dữ liệu, phép ghép hoạt động và cách hiển thị hiện hữu; `renderReportCenter` không còn tải kèm hoạt động Sale khi người dùng ở workspace khác.

## 14. Filter/pagination/export preservation

Bộ lọc tuần, tháng, nhân viên, tìm kiếm, xóa lọc, phân trang và export vẫn hoạt động. Smoke ghi nhận 189 hoạt động, trang hiển thị 80/189 tại thời điểm kiểm tra.

## 15. Overview chart preservation

Biểu đồ Khách hàng theo kênh và Tăng trưởng khách hàng theo tháng vẫn ở Overview, không bị nhân đôi trong Reports.

## 16. Channel drill-down regression

Khoảng thời gian kênh, reset filter, drill-down và phạm vi Sale được kiểm tra bằng browser fixture/canvas test và đều PASS.

## 17. Internal navigation retirement

Điều hướng nội bộ rời rạc được thay bằng route model và ba panel workspace rõ ràng; các node báo cáo cũ được di chuyển thay vì tạo bản sao.

## 18. State/request preservation

Chuyển workspace giữ state bộ lọc liên quan. Báo cáo nặng chỉ render khi workspace tương ứng được chọn, tránh request thừa.

## 19. Back/Forward/Refresh

Back, Forward và refresh trực tiếp tại từng deep route đã PASS trong browser test; `activeReportWorkspace` được khởi tạo từ URL.

## 20. Sale denial

Tài khoản TEST ở role Sale không thấy Reports. Cả bốn URL Reports đều được kiểm tra và tự chuyển về `#/overview`, panel Reports không hiển thị.

## 21. Customer regression

Workspace Khách hàng, thêm/tìm/chăm sóc/phân bổ và shell layout đã qua test hồi quy; không có thay đổi dữ liệu khách hàng.

## 22. KPI regression

KPI R3 và R3.1 static/integration test PASS. Production smoke cuối ghi nhận không có kỳ KPI ACTIVE; STEP 6 không thay đổi KPI.

## 23. Product regression

Product R1 static/helper, Product UI và Product shell layout test PASS.

## 24. Admin regression

Admin vẫn là khu riêng tại `/admin`; Owner truy cập được. Canonical Admin UI đã được dùng để chuyển role TEST có kiểm soát và khôi phục về Manager.

## 25. Responsive/mobile

Hub, action cards và ba workspace đáp ứng breakpoint desktop/mobile; browser test responsive PASS.

## 26. Accessibility

Panel ẩn dùng `hidden`, `inert`, `aria-hidden`; heading, region, nút và nhãn form có tên truy cập. Static/browser accessibility contract PASS.

## 27. Performance

Chỉ workspace đang active render nội dung nặng. Không thêm thư viện, migration hay request nền mới.

## 28. Local/static tests

PASS: STEP 2 navigation, STEP 3 Customer, STEP 4 Overview, STEP 5 KPI, STEP 5.1 charts, STEP 6 contract, KPI R3/R3.1, Product R1, JS syntax và diff check.

## 29. Browser tests

PASS: STEP 3, STEP 4, STEP 5, STEP 5.1 canvas/drill-down/Sale scope, STEP 6 routes/roles/history/responsive, Product UI và Product shell layout.

## 30. Git SHA

Implementation commit: `9024dc28b49ef2c94183a61422c11c383eb48914` (`feat(ui): add reports workspace navigation`).

## 31. Maintenance ON

Deployment maintenance ON: `dpl_Gf5PMMcjoHmaAwX3WJjZrUSAwFPX`, READY. Readback xác nhận `enabled: true` trước production smoke có kiểm soát.

## 32. Production deployment

Deployment cuối: `dpl_ECFqM1sCnpaHeX4iVfHhGBckX2N4`, target production, READY; alias `https://crmkolor.vercel.app` hoạt động.

## 33. Sale smoke

`devil8xonline@gmail.com` được đổi Manager → Sale qua canonical UI. Login đúng shell Sale; không thấy Reports; deep-link denial PASS; Overview charts vẫn hiện và phạm vi Sale là 0 khách.

## 34. Manager smoke

Manager Hub có đúng ba card; Summary, Sales và Customers tải đúng; filter/pager/export, pipeline và các deep route PASS. Sau smoke, TEST được khôi phục Sale → Manager và đăng nhập lại xác nhận `Vai trò: manager`.

## 35. Owner smoke

`hoathienbang87@gmail.com` login thành công; Reports Hub có đúng ba card; `/admin` vẫn tách riêng và hoạt động.

## 36. Data/settings integrity

Không có DB migration, direct SQL, thay đổi customer/KPI/product business data hoặc lưu settings. Mutation có chủ đích duy nhất là role TEST Manager → Sale → Manager qua canonical Admin UI, kèm audit hệ thống. Historical settings drift from the previous smoke cannot be reconstructed field-by-field because a pre-change field snapshot was not captured. The current production settings state was accepted by the owner as the new controlled baseline. All subsequent smoke changes were compared against this baseline.

## 37. Maintenance final state

Readback production cuối xác nhận `MAINTENANCE_CONFIG.enabled: false`; CRM đang mở.

## 38. Known limitations

Pipeline hiện có tổng phân loại 196 trong khi phạm vi báo cáo hiện tại là 194 khách; đây là semantics/stage classification hiện hữu và không thuộc scope STEP 6. Không có credential DB read-only hợp lệ để tạo fingerprint trực tiếp; integrity được giới hạn bằng code diff, UI smoke và xác nhận không thực hiện luồng ghi ngoài role TEST.

## 39. Next recommended step

Dừng phase tại đây. Bước tiếp theo nên được triển khai như phase độc lập sau khi Owner duyệt scope mới; không gộp thêm thay đổi vào STEP 6.
