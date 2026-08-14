# KPI-2.1E - September Canonical Cutover + Legacy Write Freeze

Ngày thực hiện: 14/08/2026. Repository: `D:\SUPABASE\CRM-KOLORCERAMIC`.

## 1. Kết quả cuối

**KPI-2.1E PARTIAL - CUTOVER INFRA READY, SEPTEMBER BUSINESS CONFIG INCOMPLETE.**

Hạ tầng cutover và backend guard đã sẵn sàng, production đang chạy đúng PRE-CUTOVER. Cấu hình KPI-2 tháng 09 chưa sẵn sàng vì production chưa có period, definition hoặc assignment canonical; owner/manager phải cấu hình nghiệp vụ thật trước 01/09.

## 2. Quyết định cutover chính thức

- Tháng 08/2026 tiếp tục dùng KPI legacy.
- Từ `2026-09-01 00:00:00 Asia/Ho_Chi_Minh`, tương đương `2026-08-31T17:00:00Z`, KPI-2 là hệ thống vận hành duy nhất cho hoạt động KPI mới.
- Legacy chỉ còn lịch sử và hàng đợi đóng sổ có kiểm soát.

## 3. Xác nhận hủy kế hoạch 15/08

Không có logic cutover 15/08 trong migration, helper frontend hoặc UI. Static gate kiểm tra cả `15/08` và `2026-08-15` đã PASS.

## 4. Production legacy inventory refresh

Read-only refresh lúc `2026-08-14T10:25:19Z`:

| Chỉ số | Giá trị |
|---|---:|
| `kpi_rules` | 8 |
| `kpi_proposals` | 102 |
| Approved | 56 |
| Rejected | 13 |
| Pending tổng | 33 |
| Pending hiển thị | 18 |
| Pending soft-deleted | 15 |
| Proposal mới nhất | `2026-08-10T02:33:47.792095Z` |

Không có delta so với KPI-2.1D. Cả 18 pending hiển thị đều trỏ tới rule tồn tại và active.

## 5. Canonical KPI-2 inventory refresh

Production hiện có 0 period, 0 definition, 0 assignment và 0 submission event. Đây là lý do kết luận PARTIAL về business configuration, không phải blocker của hạ tầng cutover.

## 6. Các đường ghi legacy hiện tại

- Rule: frontend dùng adapter `setDoc` vào `kpi_rules` để tạo, sửa và bật/tắt.
- Proposal: RPC `crm_submit_kpi_proposal` cho create/edit.
- Review: RPC `crm_review_kpi_proposal` cho approve/reject.
- Archive: RPC `crm_archive_kpi_proposal` cho soft-delete.
- Evidence: upload trực tiếp vào bucket `kpi-evidence` trước khi submit proposal.
- UI create còn tồn tại ở KPI view và nút theo từng khách hàng trước cutover.
- Dashboard, report, admin và export trước đây đọc số pending legacy.

Không tìm thấy đường ghi legacy hợp lệ nào ngoài các đường trên. Direct proposal DML đã bị thu hồi cho `authenticated` và `anon`.

## 7. Đánh giá enforcement server-side

Frontend clock không được dùng làm authority. PostgreSQL dùng `crm_legacy_kpi_clock_now()` và boundary tập trung tại `crm_legacy_kpi_cutover_at()`. API direct-call staging chứng minh việc ẩn nút không phải lớp bảo vệ duy nhất.

## 8. Kiến trúc cutover

Backend quyết định PRE/POST bằng DB clock. Frontend gọi `crm_legacy_kpi_cutover_status()` để render mode. Helper frontend chỉ là fallback hiển thị khi chưa lấy được server state. Dashboard/report dùng một hàm chọn nguồn pending: legacy trước cutover, canonical event sau cutover; legacy close-out luôn tách riêng.

## 9. Hành vi PRE-CUTOVER

- August legacy rule/proposal/evidence tiếp tục hoạt động.
- Sale vẫn tạo và sửa proposal pending của mình.
- Manager/admin vẫn review.
- KPI-2 tháng 09 có thể được chuẩn bị ở DRAFT.
- Production hậu kiểm ngày 14/08 trả `pre_cutover=true`.

## 10. Hành vi POST-CUTOVER

- Không tạo proposal legacy mới, kể cả khai tháng 08 hoặc truyền ngày cũ.
- Không tạo/sửa/bật/tắt rule legacy.
- KPI-2 là màn vận hành chính.
- Pending KPI-2 và pending legacy đóng sổ hiển thị thành hai số riêng.
- Proposal pending legacy có `created_at` trước boundary vẫn được đóng sổ theo quyền hiện hữu.

## 11. Thay đổi backend

Migration thêm các helper cutover, thay tối thiểu ba RPC legacy, siết policy `kpi_rules`, thu hồi direct DML `kpi_proposals`, giữ policy SELECT theo owner/manager và thay policy INSERT evidence bằng predicate cutover-aware. Không đổi scoring, Auth, KPI-2 schema hoặc dữ liệu lịch sử.

## 12. Migration artifact và hash

Artifact: `supabase-phase-kpi21e-september-cutover.sql`.

SHA-256: `9e64f762f572a08e5134ee71d21938ba65b911ff89cef115a1abbf42d5bdab45`.

Migration được chạy staging trước, sau đó production từ đúng artifact. Không `DELETE`, `TRUNCATE`, `DROP TABLE` hoặc tạo business config canonical.

## 13. Thay đổi frontend

- Thêm helper tập trung `js/features/kpi-cutover.js`.
- Thêm status banner.
- Ẩn create proposal sau cutover.
- Khóa form/action rule legacy sau cutover.
- Giữ edit/archive pending cũ theo eligibility.
- Đổi nhãn legacy thành `KPI cũ`, `Lịch sử`, `Đang đóng sổ`.
- Bump module cache để Vercel/browser nhận runtime mới.

## 14. Chuyển nguồn dashboard/report

Trước cutover, card `KPI chờ duyệt` dùng proposal legacy. Sau cutover, card `KPI hiện tại cần duyệt` đếm `kpi_submission_events.status=PENDING` theo RLS; `KPI cũ đang đóng sổ` là card riêng. Report và admin dashboard dùng cùng nguyên tắc. Legacy export đổi tên thành `Xuất KPI cũ` và file `crm-kpi-cu-*`.

## 15. Đóng sổ pending legacy

Còn 18 pending hiển thị: 9 của Danh Băng Tâm và 9 của Mỹ Trâm theo inventory KPI-2.1D, không có delta mới. Không yêu cầu số này về 0 trước technical cutover. Chúng không được chuyển vào KPI-2 và không được cộng vào score canonical.

## 16. Đóng băng rule

Post-cutover, RLS chỉ cho rule write khi caller là manager và DB write window còn mở. UI hiển thị `Chỉ đọc`; không mutate active flag của 8 rule lịch sử.

## 17. Đóng băng proposal

Create mới bị RPC từ chối sau boundary. Payload month/createdAt không ảnh hưởng server `created_at`. Existing pending chỉ được update nếu đúng owner, chưa xóa, status pending và được tạo trước boundary. Direct DML bị revoke.

## 18. Hành vi evidence

Trước cutover giữ contract hiện hữu. Sau cutover, INSERT vào `kpi-evidence` chỉ được phép trong folder của sale và proposal ID phải là proposal pending của chính sale, tạo trước boundary. Evidence KPI-2 tiếp tục dùng bucket private `kpi2-evidence`. Không object legacy nào bị di chuyển hoặc xóa.

## 19. Bảo toàn lịch sử khách hàng

102 proposal và liên kết customer giữ nguyên. Timeline legacy không bị xóa; create control bị ẩn sau cutover và nội dung được hiểu là lịch sử KPI cũ.

## 20. Hành vi theo role

- Sale: trước cutover dùng legacy; sau cutover dùng KPI-2, chỉ close-out pending cũ của mình.
- Manager: KPI Team employee-centric là chính; review KPI-2 và đóng sổ legacy theo quyền.
- Admin/owner: cùng mô hình canonical, có lịch sử/close-out nhưng không có bypass re-enable legacy.
- Anonymous và direct API không có quyền ghi legacy.

## 21. Test timezone và boundary

PASS:

- `2026-08-31T16:59:59Z` -> PRE.
- `2026-08-31T17:00:00Z` -> POST.
- `2026-08-31T17:00:01Z` -> POST.
- `2026-09-01T00:00:00+07:00` bằng đúng UTC boundary.
- Browser timezone không đổi quyết định backend.

## 22. Test backdate bypass

Staging POST test gọi RPC với `month=2026-08` và payload `createdAt` cũ: DENIED. Direct INSERT proposal: DENIED. Không có row bypass tồn tại sau test.

## 23. Test close-out dương

Staging POST test PASS cho: sale edit pending của mình, bổ sung evidence đúng proposal, manager approve, manager reject và sale archive pending của mình. Sale review bị chặn; mutation proposal đã đóng bị chặn.

## 24. KPI-2 regression

PASS các suite static và staging của KPI-1, KPI-2, KPI-2R.2. KPI-2 staging PASS 53 checks; KPI-2R.2 PASS 36 checks. Employee-centric UI KPI-2.1B PASS 12 checks. Không thay đổi scoring backend.

## 25. Kết quả staging

- KPI-2.1E PRE API: PASS 7.
- KPI-2.1E POST API: PASS 16.
- KPI-2.1E POST UI: PASS 8.
- P0-A API: PASS 12.
- P0-B API: PASS 18.
- KPI-1 API: PASS 23 khi rerun độc lập; một lần race timing đầu không tái hiện.
- Fixture residue: 0; staging DB clock đã khôi phục về `clock_timestamp()` và PRE.

## 26. Backup

Fresh production backup PASS tại:

`D:\SUPABASE\BACKUPS\CRM-KOLORCERAMIC-2026-08-14-1721-PRE-KPI21E`

Có `roles.sql`, `schema.sql`, `data.sql`, SHA-256, storage inventory, policy evidence, pre/post inventory và frozen migration. Binary Storage chưa được tải xuống.

## 27. Production release

Production migration đã COMMIT thành công. Post-check xác nhận 8 rules, 102 proposals và toàn bộ status count không đổi; canonical count vẫn 0. Frontend release thực hiện qua GitHub -> Vercel sau khi quality gate và diff review PASS.

## 28. Git commit/push

Chỉ stage runtime cutover, migration, test và tài liệu phase. Không dùng `git add -A`; các report/script untracked từ phase cũ không thuộc commit. Commit/push release được ghi trong kết quả cuối của task.

## 29. Vercel deployed commit

Production domain: `https://crmkolor.vercel.app/`. Exact release commit và smoke evidence được ghi trong kết quả cuối sau khi GitHub/Vercel hoàn tất.

## 30. Production PRE-CUTOVER smoke

Backend smoke PASS: current server PRE, exact boundary đúng, policy guard tồn tại một bản, legacy/canonical counts không đổi. Frontend smoke được chạy sau Vercel release; không thực hiện production write test.

## 31. Mức sẵn sàng cấu hình tháng 09

**Chưa hoàn tất business config.** Hệ thống hỗ trợ period DRAFT, definitions, assignments, target, `score_enabled` và evidence requirements, nhưng production hiện đều bằng 0. Codex không tự đoán hoặc tạo KPI tháng 09.

## 32. Pending legacy còn lại

18 visible pending, 15 soft-deleted pending. Queue này được hiển thị riêng và không ngăn technical cutover.

## 33. Rủi ro còn lại

- Bucket `kpi-evidence` legacy vẫn public: 73 objects, 48,550,460 bytes.
- Binary Storage chưa có trong backup PRE-KPI21E.
- KPI-2 September business config chưa được owner/manager nhập.
- KPI-1 race test từng flake một lần nhưng PASS khi rerun độc lập; nên tiếp tục theo dõi CI.
- Canonical operational export chuyên biệt vẫn là khoảng trống riêng; legacy export đã được gắn nhãn lịch sử, không giả làm báo cáo tháng 09.

## 34. Runbook ngày 01/09

Không dùng các ID cấu hình test đã ghi trong audit KPI-2.1E.1. Owner xác nhận các giá trị đó chỉ dùng để test và chúng đã được xóa an toàn ngày 14/08/2026. Trước cutover phải tạo và duyệt lại cấu hình thật qua UI.

1. Xác nhận thời gian production đã >= `2026-09-01 00:00:00+07:00`.
2. Gọi/kiểm tra cutover status và xác nhận `preCutover=false`.
3. Xác nhận period 09/2026 tồn tại ở DRAFT và cấu hình đã được owner duyệt.
4. Xác nhận assignments/targets/`score_enabled` đủ cho sale active.
5. Manager/admin activate period bằng UI/RPC KPI-2 được hỗ trợ.
6. Thử tạo proposal legacy mới và xác nhận bị từ chối; không dùng production data thật để test nếu không cần.
7. Sale xác nhận màn KPI-2 active và chỉ thấy dữ liệu của mình.
8. Manager xác nhận KPI Team employee-centric.
9. Xác nhận card pending hiện tại lấy KPI-2.
10. Ghi riêng số pending legacy close-out.
11. Chạy limited smoke sale/manager/admin, không xóa dữ liệu.
12. Lưu thời gian, người kiểm tra và kết quả cuối.

Read-only proof sau boundary:

```sql
select count(*) from public.kpi_rules where created_at >= timestamptz '2026-08-31 17:00:00+00';
select count(*) from public.kpi_proposals where created_at >= timestamptz '2026-08-31 17:00:00+00';
```

Kỳ vọng cả hai bằng 0 cho legacy new-write.

## 35. Checklist owner trước 01/09

- [ ] Tạo lại period 09/2026 ở DRAFT bằng cấu hình thật.
- [ ] Xác nhận definition thực tế cuối.
- [ ] Xác nhận target từng sale.
- [ ] Xác nhận `score_enabled` từng assignment.
- [ ] Hoàn tất assignments cho sale active.
- [ ] Xác nhận evidence/location/timestamp requirements.
- [ ] Review tối đa 18 pending legacy.
- [ ] Thông báo manager về queue đóng sổ riêng.
- [ ] Thông báo sale không tạo KPI legacy từ tháng 09.
- [ ] Chỉ activate period vào đúng luồng vận hành đã thống nhất.

## 36. Rollback và forward-fix

- Frontend lỗi: rollback deployment Vercel về commit baseline/release trước.
- Guard lỗi trước boundary: forward-fix/revert chính xác migration khi còn thời gian và sau backup.
- Sau boundary: không tùy tiện mở lại legacy writes; ưu tiên forward-fix.
- Không xóa KPI-2, không migrate ngược về legacy, không rewrite history, không force-push.

## 37. Khuyến nghị cuối

Giữ release cutover-capable đang PRE mode, hoàn thành business config tháng 09 trước ngày 01/09 và chạy runbook đúng boundary. Sau khi cutover thực tế ổn định, phase kế tiếp nên là **KPI-2.1F - Legacy Read-Only Archive + Evidence Security**; không tự bắt đầu trong task này.
