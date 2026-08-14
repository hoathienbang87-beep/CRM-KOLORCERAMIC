# KPI-2.1B - Employee-Centric Manager KPI UX Implementation

Ngày thực hiện: 2026-08-14
Repository: `D:\SUPABASE\CRM-KOLORCERAMIC`
Baseline: `main` tại `8b28f6176182cf3b233773e1cf6a90254254fa82`
Production: `jjeeazwlqcwynzquimeo`
Staging: `ykhtpvyelpujykheycsv`

## 1. Final result

Đã chuyển Manager/Admin KPI UX từ KPI-centric sang employee-centric. Landing mặc định là danh sách Sale active; mỗi nhân viên có tổng điểm tháng, số KPI, pending và trạng thái chưa gán. Manager có thể drill-down theo `Tổng quan / KPI / Đề xuất / Lịch sử`, gán KPI trong kỳ DRAFT, review event và xem lịch sử snapshot.

Backend business logic không thay đổi. Production không bị ghi, không deploy, không commit và không push.

## 2. Scope

Đã thực hiện:

- KPI Team shell với `Nhân viên / Bộ KPI / Lịch sử`.
- Secondary shortcut `Cần duyệt (N)`.
- Employee landing từ `app_users` cache.
- Score từ `crm_kpi_get_monthly_scores`.
- Assignment progress từ `crm_kpi_get_assignment_progress`.
- Employee detail drawer.
- Flow `+ Gán KPI` dùng RPC hiện có.
- Proposal/event grouping theo assignment employee.
- Scoped lazy event/evidence metadata query.
- History từ progress và definition snapshot.
- Responsive 1440/1024/390.
- Selector/static tests và staging UI harness.

Không thực hiện KPI-3, correction/reversal, migration legacy, backend redesign hoặc UI refactor ngoài KPI.

## 3. Backend unchanged confirmation

- Không thêm/sửa migration.
- Không sửa file SQL.
- Không thêm/sửa RPC contract.
- Không sửa RLS.
- Không sửa Storage policy.
- Không sửa Auth mapping.
- Không đổi scoring, COUNT/SUM, evidence, review, attribution hoặc deals fail-closed.
- Không dùng service role trong frontend.

Service role chỉ được runner test lấy tạm cho fixture STAGING, đặt trong environment của process và xóa khỏi environment trong `finally`. Không ghi key vào repo/output.

## 4. Frontend architecture changes

Thêm `js/features/kpi-team.js` làm lớp selector thuần:

- lọc Sale đủ điều kiện;
- tạo employee summary;
- giữ zero-KPI employee;
- map monthly score backend;
- assignment/event attribution;
- event status filter;
- evidence count metadata.

`crm-app.js` giữ orchestration, RPC, render và handlers để phù hợp kiến trúc hiện tại. State KPI Team được gom vào `kpiTeamState`, không tạo thêm nhiều global rời rạc.

## 5. KPI Team shell

Manager/Admin dùng chung shell:

- Header `KPI Team`.
- Mode `Nhân viên`, `Bộ KPI`, `Lịch sử`.
- Period selector.
- Search, progress filter, pending-only.
- `Cần duyệt (N)` và `Tải lại`.

Sale không render shell này.

## 6. Employee landing

Nguồn roster là `users`/`app_users`, không phải assignments. Eligibility:

- `role = sale`;
- `active != false`;
- `lifecycle_status = active`.

Mỗi row/card hiển thị tên, email, score text, progress bar, assigned count, pending, reference count và revision warning. Không đưa toàn bộ assignment detail lên landing.

Search chạy client-side theo tên/email, không request theo keystroke.

## 7. Score source

Total score lấy nguyên giá trị từ:

`crm_kpi_get_monthly_scores(period_id)`

UI không average từ DOM hoặc raw events. Assignment card dùng progress RPC để tách:

- `Thực tế`: actual/target và actual %, có thể trên 100%.
- `Điểm tính KPI`: scoring %, cap tối đa 100%.

Pending/rejected/revision không được cộng vào approved actual.

## 8. Zero-KPI employees

Sale active không có assignment vẫn xuất hiện:

- `Chưa có KPI`;
- `0 KPI · 0 chờ duyệt`;
- có `+ Gán KPI` khi kỳ DRAFT và actor đủ quyền.

Staging test đã chứng minh row zero-KPI tồn tại trước khi gán.

## 9. Employee detail

Desktop dùng drawer tối đa 880px; mobile dùng full-screen drawer. Header hiển thị employee, email, kỳ, lifecycle, total score, assigned count và pending count.

Tabs:

- Tổng quan.
- KPI.
- Đề xuất.
- Lịch sử.

Selected employee và selected tab được lưu rõ trong state.

## 10. KPI tab

KPI tab hiển thị theo assignment snapshot:

- tên KPI;
- unit/aggregation;
- target;
- approved actual;
- actual %;
- scoring %;
- score-enabled/reference;
- pending/revision/rejected.

KPI `score_enabled=false` có label `Tham chiếu — không tính vào điểm tháng`, không bị ẩn.

Kỳ DRAFT dùng raw assignments để hiển thị cấu hình vì progress RPC đúng contract chỉ trả ACTIVE/CLOSED.

## 11. Assign KPI

Flow:

1. Chọn employee.
2. `+ Gán KPI`.
3. Chọn active definition chưa gán.
4. Nhập target > 0.
5. Chọn `Tính vào điểm KPI tháng`.
6. Gọi `crm_kpi_assign_employee`.
7. Nếu lựa chọn score khác default an toàn, gọi `crm_kpi_update_assignment_options`.
8. Read-back foundation, progress và monthly score.

Definition đã gán bị disabled phía UX; unique guard backend vẫn là authority. ACTIVE/CLOSED bị chặn và có thông báo. Không thêm unassign.

Lưu ý còn lại: RPC assign hiện không nhận `score_enabled`, nên thay đổi khác default là hai RPC tuần tự. Nếu RPC thứ hai lỗi, UI nói rõ assignment đã được tạo, tải lại server state và không báo thành công giả.

## 12. Proposal grouping

Employee attribution dùng đúng chuỗi:

`event → assignment_id → kpi_assignments.employee_id`

Tab Đề xuất chỉ query events có assignment IDs của employee được chọn. Staging fixture Sale A/Sale B chứng minh chọn A không thấy event B.

Status hiện có được giữ: Pending, Approved, Needs revision, Rejected.

## 13. Global Cần duyệt

Global queue được giữ như shortcut phụ. Queue:

- chỉ tải khi click;
- chỉ lấy pending events thuộc assignments của period;
- luôn hiện tên nhân viên và KPI;
- không preload evidence/signed URL;
- click item mở đúng employee detail → Đề xuất → event liên quan.

## 14. History

Top-level Lịch sử cho phép chọn period và xem team score của kỳ đó.

Employee Lịch sử:

- gọi progress cho ACTIVE/CLOSED periods;
- gọi monthly score theo period, không theo employee × period;
- hiển thị tháng, score, KPI count, period status và open items;
- click kỳ mở assignment snapshot.

Staging đã đổi tên current definition sau khi assignment được tạo và xác nhận history vẫn hiện `KPI21B Snapshot Original`, không rò tên definition mới.

## 15. KPI library

Foundation/definition/assignment matrix hiện có được chuyển về mode `Bộ KPI`. Không đổi nghiệp vụ:

- period config;
- definitions;
- COUNT/SUM;
- evidence/location/timestamp;
- source mode;
- active state;
- matrix assignment.

Definition vẫn dùng chung, không tạo riêng theo employee.

## 16. Manager/Admin role composition

Manager:

- employee team view;
- assign theo quyền RPC;
- proposal review;
- history.

Admin/Owner:

- cùng operational shell;
- thêm foundation/config theo quyền hiện có.

Foundation và legacy panels không còn render ngầm khi Manager ở employee landing, giảm chi phí và tránh duplicate controls.

## 17. Sale isolation/regression

Sale tiếp tục dùng `kpiSummaryPanel` và `kpi2OperationsPanel` cũ. Không sửa claim/revision/evidence submit handlers.

Sale không thấy:

- team employee list;
- employee cards khác;
- global queue;
- assign action;
- definition admin controls.

KPI-2R.2 staging UI regression PASS 8 checks, gồm stage/upload, lỗi discard, retry, max 2 ảnh, replacement, cancel cleanup và không còn Storage object.

## 18. State model

`kpiTeamState` quản lý:

- active mode, selected period, search/filter;
- assignment progress và monthly scores;
- selected employee/tab;
- employee events/evidence/duplicate context;
- global queue;
- history progress/scores;
- loading/errors;
- request counters/cache keys/tokens.

Pure selectors tạo derived summaries, tránh nhân bản business data.

## 19. Stale-response protection

- Summary có token và kiểm tra selected period trước state update.
- Proposal có token và kiểm tra selected employee.
- History có token.
- Summary có `summaryInFlightKey` để ngăn hai render gần nhau gọi trùng cùng cặp RPC.
- Period status được reconcile từ progress read-back để không hiển thị cache DRAFT cũ sau activation.

## 20. Query strategy

Landing:

1. users cache/listener;
2. một progress RPC;
3. một monthly-score RPC.

Overview/KPI dùng cache, không request theo assignment.

Proposal:

- một scoped event query theo assignment IDs;
- một evidence metadata query theo event IDs nếu có event;
- optional duplicate context chỉ khi có warning.

Evidence signed URL chỉ tạo khi user click xem.

## 21. N+1 verification

Staging instrumentation sau khi có nhiều employee:

- `crm_kpi_get_assignment_progress`: 1 request.
- `crm_kpi_get_monthly_scores`: 1 request.

Thêm employee không làm tăng request landing. Trong quá trình test, harness từng phát hiện duplicate render tạo 2+2 request; implementation đã thêm in-flight guard và gate cuối xác nhận 1+1.

## 22. Lazy evidence/query

- Không tải all-team events/evidence lúc vào KPI.
- Tab proposal mới tải event của employee.
- Evidence metadata tải theo event IDs của tab.
- Signed URL có TTL 120 giây và chỉ tạo khi mở ảnh.
- Global queue không tải evidence.
- Duplicate context chỉ tải cho event có `possible_duplicate`.

## 23. Responsive

Đã test:

- Desktop 1440px.
- Laptop/tablet 1024px.
- Mobile 390px.

Employee rows chuyển thành stacked cards; drawer mobile full width; tabs scroll được; buttons wrap; Manager daily flow không dùng matrix 880px.

Artifacts cuối: `D:\SUPABASE\BACKUP-TEMP\kpi21b-ui-2fac45beb7`.

## 24. Accessibility

- Employee có button `Xem chi tiết` rõ ràng.
- Drawer có `role=dialog`, `aria-modal`, labelled title và close label.
- Tabs có role/aria-selected.
- Progress luôn có text % và aria label; không chỉ dựa màu.
- Escape đóng assign/detail drawer.
- Action không phụ thuộc hover.

## 25. Empty/loading/error states

Đã có state cho:

- no period;
- no active Sale;
- zero KPI;
- no definitions;
- no proposal/filter result;
- no history;
- landing/detail/proposal/history loading;
- summary/proposal/queue/history error và retry.

Không để spinner vô hạn; action vẫn dùng timeout/error framework hiện có.

## 26. Legacy KPI treatment

Không xóa legacy data hoặc business flow. Các panel legacy:

- bị ẩn khỏi employee landing;
- được đặt dưới `Bộ KPI`;
- label rõ `KPI nhân viên legacy` và `Duyệt KPI legacy`;
- tiếp tục dùng handler hiện có.

Không thực hiện legacy migration trong phase này.

## 27. Tests

Static gates:

- P0-A: PASS 80.
- P0-B: PASS 72.
- KPI-1: PASS 121.
- KPI-2: PASS 172.
- KPI-2R.2: PASS 57.
- Identity static: PASS.
- KPI-2.1B selector/static: PASS 25.
- Node syntax: PASS.
- Duplicate HTML IDs: PASS.
- Secret scan trên diff: PASS.
- `git diff --check`: PASS (chỉ cảnh báo LF/CRLF của Git trên Windows).

Staging UI KPI-2.1B: PASS 12 checks.
Staging UI KPI-2R.2 Sale regression: PASS 8 checks.

## 28. Performance evidence

- Landing request count: 2 KPI requests cố định, cộng users cache.
- Employee Overview/KPI detail: 0 request bổ sung sau khi landing đã tải.
- Proposal: 1 event query + tối đa 1 evidence metadata query + optional duplicate RPC.
- Evidence view: tối đa 2 signed URL calls theo giới hạn evidence.
- History: 1 all-period progress RPC + 1 monthly-score RPC mỗi period, không nhân theo employee.
- Không đo INP chính thức trong harness; browser không có uncaught error và visual interactions hoàn tất trong timeout 30 giây trên staging.

## 29. Staging fixtures/cleanup

Harness tạo tạm:

- 1 Manager;
- 2 Sale;
- 1 period;
- 1 definition;
- 2 assignments;
- 2 submission events.

Fixture dùng prefix `kpi21b-ui-<run>-*`. Cleanup chạy trong `finally`, xóa event/submission/assignment/definition/period/audit/app_users/Auth test. Harness kết thúc PASS đồng nghĩa cleanup không phát lỗi.

Không tạo hoặc sửa dữ liệu production.

## 30. Git diff

Runtime sửa:

- `index.html`.
- `css/styles.css`.
- `js/features/crm-app.js`.

Runtime mới:

- `js/features/kpi-team.js`.

Tests mới:

- `scripts/test-phase-kpi21b.mjs`.
- `scripts/test-phase-kpi21b-staging-ui.mjs`.
- `scripts/run-phase-kpi21b-staging-ui.ps1`.

Docs mới:

- `KPI-2.1B-EMPLOYEE-CENTRIC-MANAGER-KPI-UX-IMPLEMENTATION.md`.

Không có SQL/backend file trong diff. Các report/script untracked có trước phase không bị sửa/xóa/stage.

## 31. Risks

1. `crm-app.js` vẫn lớn; phase này giảm selector complexity nhưng chưa tách toàn bộ KPI orchestration để tránh regression.
2. Thay `score_enabled` khác default cần RPC thứ hai sau assign; backend chưa có atomic assign-with-score contract. UI xử lý partial state rõ ràng, nhưng đây là residual risk đã biết.
3. Employee proposal query vẫn có hard limit 500 và evidence 1000. Với một employee vượt ngưỡng cần phase pagination riêng.
4. Employee history dùng một monthly RPC mỗi period. Chấp nhận với số kỳ hiện tại; cần đo lại khi lịch sử nhiều năm.
5. Legacy KPI vẫn tồn tại trong Bộ KPI; owner cần phase riêng nếu sau này muốn deprecate.
6. Staging data nhỏ; production release review vẫn cần limited smoke bằng tài khoản thật theo quyền.

## 32. Production readiness

Implementation đã đạt gate để bước vào **Production Release Review**, chưa phải tự động deploy.

Trước release cần:

1. Review exact diff và owner chấp thuận.
2. Xác nhận backup/release checklist hiện hành.
3. Commit/push trong phase riêng.
4. Deploy có kiểm soát.
5. Smoke Manager/Admin/Sale production không ghi hoặc ghi tối thiểu theo runbook.

Không cần migration hay SQL production cho KPI-2.1B.

## 33. Final recommendation

Tiếp tục phase:

**KPI-2.1C — Employee-Centric KPI UX Production Release Review + Controlled Deployment**

Không bắt đầu KPI-3. Không commit, push hoặc deploy trong phase hiện tại.

**KPI-2.1B PASS — EMPLOYEE-CENTRIC KPI UX IMPLEMENTED AND READY FOR PRODUCTION RELEASE REVIEW**
