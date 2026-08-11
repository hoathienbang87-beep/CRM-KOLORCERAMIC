# KPI-0 - Đặc tả nghiệp vụ và audit kiến trúc KPI

Ngày lập: 2026-08-10
Repository: `D:\SUPABASE\CRM-KOLORCERAMIC`
Baseline: branch `main`, commit `2e723ec19f3a99dde5de14fdacda09d5b91ab1e0`

## 1. Kết luận điều hành

**Kết luận: BUSINESS DECISION REQUIRED**

Kiến trúc mục tiêu có thể thiết kế rõ, nhưng chưa nên bắt đầu migration KPI vì còn một số quyết định ảnh hưởng trực tiếp đến model dữ liệu và cách chấm điểm:

1. Một đề xuất KPI là **một lần phát sinh thành tích** (mỗi đề xuất cộng 1 hoặc một giá trị) hay là **bản tổng kết toàn bộ KPI của tháng**?
2. KPI target bằng `0` có hợp lệ không, và nếu hợp lệ thì được chấm theo cơ chế nào?
3. Khi giao/bỏ KPI hoặc nhân viên vào/nghỉ giữa tháng, có prorate target không?
4. Cuối kỳ xử lý `NOT_SUBMITTED`, `PENDING`, `NEEDS_REVISION` thế nào để đóng kỳ?
5. Ai được reopen kỳ `CLOSED`, và điểm đã chốt có được thay thế hay phải tạo phiên bản mới?
6. Danh sách KPI hiện có được phân loại chính thức thành `AUTO`, `MANUAL`, `HYBRID` ra sao?

Các quyết định còn lại về lifecycle kỳ, assignment theo nhân viên, giới hạn điểm 100%, trung bình không trọng số, review bắt buộc, audit và monthly isolation đã đủ rõ để làm nền thiết kế.

Phase này chỉ tạo tài liệu. Không sửa code, SQL, Storage, staging hay production.

## 2. Nghiệp vụ đã chốt

### 2.1 Kỳ KPI

- Mỗi tháng là một kỳ KPI độc lập.
- Lifecycle: `DRAFT -> ACTIVE -> CLOSED`.
- `DRAFT`: manager cấu hình KPI, giao sale và đặt target; được sửa.
- `ACTIVE`: sale thực hiện và gửi duyệt; target/assignment không được sửa tùy tiện.
- `CLOSED`: dữ liệu lịch sử và điểm chính thức bất biến; mọi sửa đổi đặc biệt phải có version và audit.
- Cấu hình tháng mới không được làm thay đổi KPI tháng cũ.

### 2.2 Giao KPI

- Một KPI có thể giao cho một hoặc nhiều sale.
- Mỗi sale có target riêng.
- Không bắt buộc mọi sale có cùng bộ KPI.
- Employee inactive/archived không xuất hiện trong cấu hình kỳ hiện tại, nhưng lịch sử kỳ cũ phải giữ nguyên.

### 2.3 Hoàn thành và điểm

- `Actual Completion % = Actual / Target * 100` và được phép vượt 100%.
- `Scoring Completion % = min(max(Actual Completion %, 0), 100)`.
- Không dùng trọng số trong phiên bản nghiệp vụ này.
- Điểm tháng là trung bình cộng các KPI được giao cho nhân viên.
- Một KPI vượt mạnh không được bù cho KPI khác chưa đạt.

### 2.4 Review

- Trạng thái: `NOT_SUBMITTED`, `PENDING`, `NEEDS_REVISION`, `APPROVED`, `REJECTED`.
- Sale phải chủ động gửi đề xuất, ghi chú và evidence.
- Manager có thể approve, request revision hoặc reject.
- `APPROVED`: điểm chính thức bằng scoring completion đã cap 100%.
- `REJECTED`: điểm chính thức bằng 0%.
- `PENDING` và `NEEDS_REVISION`: chưa có điểm chính thức cuối cùng.
- Chỉ KPI đã xử lý theo quy tắc cuối kỳ mới được dùng để chốt kỳ.

### 2.5 Attribution theo P0-B

- Chuyển khách A sang B không biến khách đó thành khách mới của B.
- Hoạt động do A thực hiện tính cho A; hoạt động do B thực hiện tính cho B.
- KPI hoạt động phải dựa vào actor và event time, không dựa vào owner hiện tại.
- Customer unassigned không thuộc KPI sale nào.
- Dữ liệu lịch sử của employee inactive/archived vẫn được giữ.

### 2.6 Vai trò manager

- Manager quản trị nghiệp vụ sale, phân bổ khách, danh mục CRM, kỳ KPI, KPI, assignment, target, review và báo cáo.
- Manager không quản lý manager/admin/owner khác, không nâng role bản thân và không can thiệp SQL, RLS, API key, Supabase/Vercel hay audit log.
- Admin/owner quản trị role cấp cao và hạ tầng.

## 3. KPI model hiện tại

### 3.1 `kpi_rules`

Model hiện có:

- `month`: text, đang mang ý nghĩa tháng tạo/hiển thị hơn là một period có lifecycle.
- `name`, `description`.
- `target`: target mặc định.
- `count_mode`: hiện frontend mặc định `approvedProposals`.
- `assigned_owners`: JSON array email.
- `owner_targets`: JSON object email -> target.
- `active`: bật/tắt rule toàn cục.
- actor chủ yếu lưu bằng email và `raw_data`.

Frontend `activeKpiRules()` lấy tất cả rule còn active, không cô lập bằng một object kỳ KPI. Rule cũ có thể tiếp tục áp dụng qua tháng mới, nhưng không có snapshot/version chuẩn cho từng kỳ.

### 3.2 `kpi_proposals`

Model hiện có:

- Tham chiếu `kpi_rule_id` bằng text, không thấy foreign key trong schema backup.
- Lưu snapshot tên KPI, tháng, owner/email và một số thông tin customer.
- Nội dung bằng `content`.
- Evidence là `evidence_url` text, có thể chứa nhiều URL phân cách bằng xuống dòng.
- Trạng thái thực tế chỉ hỗ trợ `pending`, `approved`, `rejected`.
- Review được ghi đè trên cùng một row bằng `review_note`, `reviewed_by_email`, `reviewed_at`.
- Soft delete bằng `is_deleted`.

Frontend tính giá trị KPI bằng số proposal `approved` khớp rule, owner và tháng. Vì vậy model hiện tại là KPI dạng **đếm đề xuất đã duyệt**, chưa phải engine KPI AUTO/MANUAL/HYBRID có actual, target, score và source drill-down rõ ràng.

### 3.3 Review RPC hiện tại

Đang có ba RPC atomic từ P0-A:

- `crm_submit_kpi_proposal`
- `crm_review_kpi_proposal`
- `crm_archive_kpi_proposal`

Điểm tốt:

- Chạy transaction PostgreSQL thực.
- `SECURITY DEFINER` có `search_path = public`.
- Tự kiểm tra auth/role cơ bản.
- Ghi generic audit trong cùng transaction.
- Chặn review lần hai bằng row lock và trạng thái `pending`.

Giới hạn:

- Chưa hỗ trợ `NEEDS_REVISION` và lịch sử nhiều vòng submit/review.
- Không có optimistic version để trả conflict nghiệp vụ rõ khi hai browser cùng review.
- Không có actual/scoring/official result snapshot.
- Dùng email làm identity nghiệp vụ chính.
- Rule assignment bằng JSON/email, không phải FK employee theo kỳ.

### 3.4 RLS hiện tại

Các policy KPI hiện có bị chồng lấn theo cơ chế permissive `OR` của PostgreSQL:

- Policy owner chỉ sửa proposal `pending` là đúng ý định.
- Nhưng policy cũ `kpi proposals scoped` áp dụng rộng cho owner/email có thể cấp lại quyền UPDATE trực tiếp ngoài điều kiện pending.
- `kpi_rules` có nhiều policy SELECT; sale có thể đọc toàn bộ active rules ở data layer rồi UI mới lọc assignment.
- Table grants còn rộng; an toàn đang phụ thuộc vào tập policy chồng lấn khó kiểm chứng.

Kết luận: KPI mới phải có một bộ RLS canonical duy nhất theo `app_users.id`, không giữ các policy email cũ song song.

### 3.5 Evidence hiện tại

- Bucket `kpi-evidence` hiện là public theo inventory backup production.
- Có 66 object, khoảng 42.8 MB tại thời điểm backup trước P0-A/P0-B.
- Policy Storage bị trùng: hai policy insert theo hai cách chuẩn hóa folder và hai policy read rộng cho authenticated/active user.
- Frontend upload file trước, lấy public URL rồi mới gọi RPC submit.
- Nếu upload thành công nhưng RPC thất bại, file orphan vẫn tồn tại.
- Không có metadata chuẩn: submission FK, checksum, MIME, size, uploader, retention, trạng thái sử dụng.

### 3.6 Nguồn dữ liệu CRM hiện tại

- Customer ownership hiện đã dùng `customer_assignments` làm source of truth sau P0-B.
- Acquisition identity có thể xác định bằng sale tạo khách hoặc assignment đầu tiên theo quy tắc P0-B.
- `care_logs` có `created_by_email`, nhưng chưa có actor user ID chuẩn trong table cũ; actor attribution dài hạn cần chuẩn hóa ID.
- Showroom visit hiện được lấy từ dữ liệu care/customer profile, một phần nằm trong `raw_data`; chưa phải event model riêng ổn định.
- Mua căn bản hiện lấy từ `deals` và customer summary; phù hợp báo cáo CRM căn bản nhưng cần source contract rõ nếu dùng làm KPI.

## 4. Phân loại object hiện tại

| Object | Quyết định | Lý do |
|---|---|---|
| `kpi_rules` | MIGRATE rồi archive | Trộn template, tháng, assignment và target trong JSON; không đảm bảo monthly isolation |
| `kpi_proposals` | MIGRATE rồi read-only | Có dữ liệu lịch sử giá trị nhưng không đủ revision/result/source model |
| `crm_submit_kpi_proposal` | REFACTOR/REPLACE | Logic atomic có thể reuse, contract cũ không đủ workflow mới |
| `crm_review_kpi_proposal` | REFACTOR/REPLACE | Giữ row lock/audit pattern; thêm revision, result snapshot, conflict/version |
| `crm_archive_kpi_proposal` | REFACTOR | Cần policy archive theo trạng thái mới và giữ immutable history |
| `audit_logs` | KEEP + HARDEN | Dùng làm audit xuyên hệ thống; cần append-only và payload có cấu trúc |
| `settings` liên quan KPI | REMOVE khỏi source of truth | Không dùng settings JSON để lưu period/target/result |
| Bucket `kpi-evidence` | MIGRATE + HARDEN | Chuyển private, metadata có FK, signed URL, dọn policy trùng |
| UI bảng KPI hiện tại | REFACTOR | Có khung bảng/progress/export dùng lại được; công thức và workflow phải thay |
| Đề xuất KPI có customer context | KEEP | Hữu ích cho manual evidence và drill-down |
| File `CRM-KPI-TABLE-PROPOSAL.md` | SUPERSEDE | Thiết kế cũ có trọng số, trái nghiệp vụ hiện tại không trọng số |

Không hard-delete bảng cũ trong rollout KPI đầu tiên.

## 5. Gap analysis

| Yêu cầu | Hiện tại | Khoảng cách |
|---|---|---|
| Period DRAFT/ACTIVE/CLOSED | Chỉ có `month` text | Thiếu period, transition guard, close snapshot |
| Monthly isolation | Rule active dùng xuyên tháng | Target và assignment kỳ cũ có thể bị ảnh hưởng |
| Target theo sale | JSON email -> target | Thiếu FK, constraint, audit từng assignment |
| AUTO/MANUAL/HYBRID | Chỉ đếm approved proposals | Thiếu metric contract và source resolver |
| Actual > 100%, score cap 100% | UI cap phần trăm và không lưu actual | Thiếu hai chỉ số tách biệt |
| Không trọng số | Tài liệu cũ từng đề xuất weights | Cần supersede rõ |
| NEEDS_REVISION | Không có | Thiếu vòng review/resubmit |
| Review history | Ghi đè trên proposal | Không có immutable review events |
| Official score | Tính động từ count | Thiếu result snapshot |
| Drill-down | Chỉ proposal/customer context | AUTO/HYBRID chưa truy nguồn được |
| Actor/event attribution | Một phần dựa owner/customer set | Có nguy cơ quy hoạt động lịch sử cho owner hiện tại |
| Evidence private | Public URL | Sai yêu cầu bảo mật |
| Concurrent review | Row lock chặn lần hai | Có nền tốt, nhưng chưa có version/conflict UX |
| Inactive employee history | Proposal email snapshot | Giữ được tên cơ bản nhưng thiếu FK/snapshot kỳ |
| Close/reopen | Không có | Thiếu workflow và versioning |

## 6. Data model đề xuất

### 6.1 `kpi_periods`

Mỗi row là một tháng KPI.

Trường chính:

- `id uuid`
- `period_month date` luôn là ngày đầu tháng, unique
- `name`
- `status`: `DRAFT`, `ACTIVE`, `CLOSED`
- `timezone` mặc định `Asia/Ho_Chi_Minh`
- `starts_at`, `ends_at`
- `created_by_user_id`, `activated_by_user_id`, `closed_by_user_id`
- `created_at`, `activated_at`, `closed_at`, `updated_at`
- `version integer`

Lý do tồn tại: bảo vệ lifecycle, monthly isolation và điều kiện close/reopen.

### 6.2 `kpi_definitions`

Catalog/template KPI dùng để tạo cấu hình kỳ.

Trường chính:

- `id uuid`, `code text unique`, `name`, `description`
- `kpi_type`: `AUTO`, `MANUAL`, `HYBRID`
- `source_metric_key`: mã resolver nguồn, ví dụ chỉ dùng các metric đã được duyệt
- `unit`: lượt, khách, giá trị hoặc đơn vị nghiệp vụ khác
- `submission_mode`: cần quyết định `EVENT_CLAIM` hay `PERIOD_TOTAL`
- `evidence_required`, `active`
- `created_by_user_id`, `updated_by_user_id`, timestamps, `version`

Definition là template. Sửa definition không sửa kỳ đã ACTIVE/CLOSED.

### 6.3 `kpi_assignments`

Source of truth cho KPI nào áp dụng cho employee nào trong kỳ và target bao nhiêu.

Trường chính:

- `id uuid`
- `period_id` FK `kpi_periods`
- `definition_id` FK `kpi_definitions`
- `employee_id` FK `app_users`
- `target numeric`
- `effective_at`
- `assignment_status`: `ASSIGNED`, `CANCELLED`
- `definition_snapshot jsonb`: name, description, type, metric key, unit, submission mode, evidence rule
- `assigned_by_user_id`, `assigned_at`
- `cancelled_by_user_id`, `cancelled_at`, `cancel_reason`
- `lock_version integer`
- unique `(period_id, definition_id, employee_id)`

Target của kỳ nằm tại assignment, không lấy lại từ definition.

### 6.4 `kpi_submissions`

Mỗi row là một lần sale gửi hoặc gửi lại. Không ghi đè attempt cũ.

Trường chính:

- `id uuid`, `assignment_id` FK
- `attempt_no integer`
- `claimed_value numeric null`
- `sale_note`
- `system_actual_snapshot numeric null`
- `source_as_of timestamptz null`
- `status`: `PENDING`, `NEEDS_REVISION`, `APPROVED`, `REJECTED`
- `submitted_by_user_id`, `submitted_at`
- `supersedes_submission_id null`
- timestamps
- unique `(assignment_id, attempt_no)`

`NOT_SUBMITTED` được suy ra khi assignment chưa có submission. Không cần tạo row rỗng.

### 6.5 `kpi_reviews`

Immutable event history cho từng hành động review.

Trường chính:

- `id uuid`, `submission_id` FK
- `action`: `REQUEST_REVISION`, `APPROVE`, `REJECT`
- `manager_note`
- `reviewed_by_user_id`, `reviewed_at`
- `expected_submission_version`

Không update/delete review. Review RPC lock submission/assignment và từ chối browser thứ hai nếu state/version đã đổi.

### 6.6 `kpi_results`

Source of truth của điểm chính thức đã duyệt/từ chối.

Trường chính:

- `id uuid`, `assignment_id` FK, `submission_id` FK
- `actual_value`
- `target_snapshot`
- `actual_completion_pct`
- `scoring_completion_pct`
- `official_score_pct`
- `decision`: `APPROVED`, `REJECTED`
- `source_as_of`
- `result_version`, `is_current`
- `finalized_by_user_id`, `finalized_at`
- unique current result per assignment

Khi kỳ CLOSED, result current bất biến. Reopen nếu được cho phép phải tạo version mới, không ghi đè lịch sử.

### 6.7 `kpi_result_sources`

Lưu các reference tạo ra con số KPI để drill-down và bảo toàn lịch sử.

Trường chính:

- `result_id`
- `source_type`: customer, care_log, showroom_visit, basic_purchase, manual_claim
- `source_id`
- `event_at`
- `actor_user_id`
- `value_contribution`
- `source_snapshot jsonb` tối thiểu

Lý do tồn tại: dữ liệu CRM có thể đổi/archive sau khi KPI được duyệt; chỉ aggregate number không đủ kiểm toán.

### 6.8 `kpi_evidence`

Metadata của evidence, file thật nằm trong private Storage.

Trường chính:

- `id uuid`, `submission_id` FK
- `bucket`, `object_path`
- `original_name`, `mime_type`, `size_bytes`, `sha256`
- `uploaded_by_user_id`, `uploaded_at`
- `status`: `STAGED`, `ATTACHED`, `QUARANTINED`, `ARCHIVED`

Không lưu public URL. UI yêu cầu signed URL ngắn hạn qua policy/RPC phù hợp.

### 6.9 Source of truth

| Khái niệm | Source of truth |
|---|---|
| Kỳ và lifecycle | `kpi_periods` |
| KPI áp cho sale và target | `kpi_assignments` |
| Cấu hình template hiện hành | `kpi_definitions` |
| Đề xuất của sale | `kpi_submissions` |
| Review history | `kpi_reviews` |
| Điểm chính thức | `kpi_results` |
| Dữ liệu tạo ra điểm đã chốt | `kpi_result_sources` |
| Metadata file | `kpi_evidence` |

## 7. KPI types và nguồn actual

### AUTO

- Actual lấy hoàn toàn từ CRM bằng một metric resolver đã version hóa.
- Sale vẫn submit để đáp ứng workflow đã chốt; sale không được sửa actual hệ thống.
- Manager review tính hợp lệ và source drill-down.
- Evidence có thể optional tùy definition.

### MANUAL

- Sale khai báo actual/claim và evidence.
- Manager duyệt/từ chối.
- Current proposal model gần nhất với loại này, đặc biệt nếu mỗi proposal là một achievement claim.

### HYBRID

- Hệ thống đưa actual baseline và danh sách nguồn.
- Sale bổ sung giải trình/evidence hoặc đề nghị điều chỉnh.
- Manager duyệt result cuối cùng; mọi override phải ghi before/after/reason.

### Đề xuất phân loại hiện trạng

- Các `kpi_rules` đang dùng `approvedProposals`: **MANUAL** cho đến khi từng rule có metric nguồn được xác nhận.
- `Khách mới`, `lượt chăm`, `đến showroom`, `lần mua căn bản` có tiềm năng thành AUTO/HYBRID, nhưng chỉ sau khi metric contract và actor/event fields được chuẩn hóa.
- Không tự chuyển rule hiện tại sang AUTO chỉ dựa vào tên KPI.

## 8. Review workflow mục tiêu

```text
Assignment chưa có submission
  -> NOT_SUBMITTED

Sale submit attempt N
  -> PENDING

Manager REQUEST_REVISION
  -> attempt N = NEEDS_REVISION
  -> Sale tạo attempt N+1 = PENDING

Manager APPROVE
  -> attempt hiện tại = APPROVED
  -> tạo kpi_result + kpi_result_sources atomic

Manager REJECT
  -> attempt hiện tại = REJECTED
  -> tạo kpi_result official_score = 0 atomic
```

Nguyên tắc:

- Attempt cũ không bị sửa thành attempt mới.
- Evidence gắn với đúng attempt.
- Sale chỉ sửa draft cục bộ trước submit; sau submit không update trực tiếp.
- Manager review bằng RPC transaction và expected version.
- Hai browser review đồng thời: request thứ hai nhận conflict, UI reload dữ liệu.
- Period chỉ CLOSED khi không còn assignment chưa xử lý theo rule cuối kỳ đã chốt.

## 9. Công thức điểm tháng

Với assignment có `target > 0`:

```text
actual_completion_pct = actual_value / target * 100
scoring_completion_pct = min(max(actual_completion_pct, 0), 100)
```

Điểm chính thức từng KPI:

```text
APPROVED -> official_score_pct = scoring_completion_pct
REJECTED -> official_score_pct = 0
PENDING / NEEDS_REVISION / NOT_SUBMITTED -> official_score_pct = NULL
```

### Provisional score

- Có thể hiển thị trung bình `scoring_completion_pct` hiện tại của tất cả assignment.
- Phải ghi rõ **Tạm tính**, kèm `đã xử lý / tổng KPI`.
- Không dùng provisional score làm điểm trả lương/thưởng.

### Official monthly score

Chỉ tính khi tất cả N assignment đã có decision cuối cùng:

```text
official_monthly_score = SUM(official_score_pct) / N
```

Nếu còn bất kỳ KPI chưa xử lý, official monthly score là `NULL`, UI hiển thị `Chưa chốt`, không silently thay pending bằng 0.

## 10. Role và permission matrix

| Hành động | Sale | Manager | Admin/Owner |
|---|---:|---:|---:|
| Xem KPI assignment của chính mình | Có | Có | Có |
| Xem KPI sale khác | Không | Có, trong phạm vi sale | Có |
| Tạo/sửa period DRAFT | Không | Có | Có |
| Activate period | Không | Có | Có |
| Close period | Không | Có nếu đủ điều kiện | Có |
| Reopen CLOSED | Không | Chưa chốt | Có theo workflow đặc biệt |
| Tạo/sửa definition | Không | Có ở mức nghiệp vụ | Có |
| Giao KPI/target cho sale | Không | Có | Có |
| Giao KPI cho manager/admin | Không | Không | Owner/Admin theo rule riêng |
| Submit/resubmit KPI của mình | Có | Không thay sale | Admin hỗ trợ có audit nếu cần |
| Review sale submission | Không | Có | Có |
| Xem evidence của mình | Có | Có | Có |
| Xem evidence sale khác | Không | Có | Có |
| Sửa SQL/RLS/infrastructure | Không | Không | Không qua UI KPI |
| Xóa review/audit | Không | Không | Không |

RLS phải dùng `auth.uid()` -> `app_users.id`; email chỉ là snapshot hiển thị/audit, không cấp quyền.

## 11. Drill-down và attribution

Mỗi metric cần một contract version hóa gồm:

- `metric_key`
- source table/event type
- field thời gian dùng để vào kỳ
- field actor dùng để quy sale
- điều kiện active/archive
- cách xử lý duplicate/correction
- query drill-down tương ứng

Định hướng:

- Khách mới: theo acquisition identity, không theo current owner.
- Lượt chăm: theo actor thực hiện care log và care event time.
- Showroom visit: theo visit event và actor; không nên chỉ lấy counter hiện tại trên customer.
- Mua căn bản: theo event được xác định là hoàn thành và actor/attribution đã chốt; không dựa current owner.
- Unassigned: không quy cho sale.

Manager click actual phải thấy đúng source rows tạo ra số đó. Khi approve, các source reference được snapshot vào `kpi_result_sources`.

## 12. Evidence model và upload an toàn

Luồng đề xuất:

1. Frontend upload vào private bucket, đường dẫn theo user/submission draft ID.
2. Ghi metadata `STAGED` với owner, checksum, MIME và size.
3. RPC submit kiểm tra tất cả evidence thuộc caller, còn tồn tại và hợp lệ.
4. RPC đổi metadata sang `ATTACHED` và tạo submission trong transaction DB.
5. Job định kỳ dọn object `STAGED` quá hạn không gắn submission.
6. UI lấy signed URL ngắn hạn khi người có quyền mở evidence.

Storage upload không thể atomic chung với PostgreSQL transaction. Vì vậy phải dùng staged state và cleanup, không coi upload thành công là submit thành công.

Policy mục tiêu:

- Sale upload/read evidence của submission của mình.
- Manager/admin read evidence thuộc sale trong phạm vi quản lý.
- Không public bucket.
- Không cho list toàn bucket.
- Không cho client tùy ý overwrite/delete evidence đã attached.

## 13. Audit và lịch sử

Tối thiểu audit:

- tạo/activate/close/reopen period;
- tạo/sửa definition;
- giao/hủy assignment, target before/after và lý do;
- submit/resubmit, attempt number;
- upload/attach/archive evidence;
- request revision, approve, reject và manager note;
- actual/source snapshot;
- result version và actor chốt.

`audit_logs` dùng cho nhật ký xuyên hệ thống. `kpi_reviews`, `kpi_submissions`, `kpi_results` là lịch sử nghiệp vụ có cấu trúc, không thay thế bằng một JSON audit duy nhất.

Không hard-delete period, assignment, submission, review, result hoặc evidence đã attached. Audit table phải append-only ở quyền ứng dụng.

## 14. Edge cases bắt buộc

| Case | Xử lý đề xuất |
|---|---|
| Target = 0 | Fail validation đối với KPI định lượng; cần quyết định riêng nếu có KPI đạt/không đạt |
| Bỏ KPI giữa tháng | Không xóa; chuyển assignment `CANCELLED`, bắt buộc lý do/audit; quyết định có loại khỏi mẫu số hay không |
| Thêm KPI giữa tháng | Chỉ RPC đặc biệt khi ACTIVE, effective_at + lý do; quyết định prorate |
| Employee vào giữa tháng | Chỉ giao KPI rõ ràng; không tự copy KPI; quyết định prorate |
| Employee nghỉ giữa tháng | Giữ assignment/history; quyết định target và người review phần đã làm |
| Employee reactivate | Không tự khôi phục assignment cũ; manager giao lại có chủ đích |
| Submit hai lần | Mỗi lần là attempt mới; request id/idempotency key chống double-click |
| Review hai browser | `FOR UPDATE` + expected version; browser thứ hai fail conflict và reload |
| Evidence upload fail | Không cho submit nếu evidence required; không tạo partial submission |
| Upload xong, submit fail | Evidence ở `STAGED`; cleanup sau TTL |
| Actual đổi sau APPROVED | Official result giữ snapshot; UI cảnh báo current actual khác approved actual |
| Source bị archive sau approve | Result/source snapshot vẫn giữ; không giảm điểm lịch sử |
| CRM history sửa sau CLOSED | CLOSED result không đổi; correction qua reopen/version đặc biệt |
| Manager sửa target khi ACTIVE | Chặn mặc định; RPC đặc biệt có reason/version nếu nghiệp vụ cho phép |
| Reopen CLOSED | Chỉ actor được chốt; tạo result version mới, không overwrite; quyền còn cần chốt |
| Unassigned customer | Không tính KPI sale |
| Chuyển owner giữa tháng | Khách mới giữ acquisition sale cũ; activity tính theo actor/event time |
| Sale inactive còn pending | Manager vẫn thấy; cần quyết định reject, transfer reviewer hay xử lý lịch sử |
| Kỳ còn pending khi hết tháng | Không tự coi 0; kỳ không CLOSED cho tới workflow cuối kỳ được xử lý |

## 15. Các quyết định nghiệp vụ còn thiếu

### Quyết định 1 - Đơn vị submission

Chọn một:

- `EVENT_CLAIM`: mỗi đề xuất là một lần/giá trị thành tích; actual là tổng claim approved. Gần model hiện tại và migrate dễ hơn.
- `PERIOD_TOTAL`: mỗi KPI có một bản tổng kết tháng; resubmit là version mới. Đơn giản hơn cho review tổng kỳ.
- Hỗ trợ cả hai bằng `submission_mode` trên definition snapshot. Linh hoạt nhưng UI/RPC phức tạp hơn.

Khuyến nghị: hỗ trợ cả hai ở schema, nhưng KPI-1 chỉ triển khai `EVENT_CLAIM` để migrate hiện trạng; chỉ bật `PERIOD_TOTAL` sau khi có KPI cụ thể cần nó.

### Quyết định 2 - Target bằng 0

Khuyến nghị: KPI định lượng bắt buộc target > 0. KPI boolean phải dùng evaluation mode riêng, không dùng phép chia 0.

### Quyết định 3 - Prorate

Khuyến nghị phiên bản đầu: không tự prorate. Manager nhập target thực tế khi assignment còn DRAFT. Thay đổi giữa ACTIVE phải có RPC đặc biệt, reason và audit.

### Quyết định 4 - Close kỳ

Khuyến nghị fail-closed: không cho CLOSED nếu còn `NOT_SUBMITTED`, `PENDING`, `NEEDS_REVISION`. Manager phải xử lý rõ từng KPI; không tự chuyển thành 0.

### Quyết định 5 - Reopen

Khuyến nghị: chỉ admin/owner được reopen, bắt buộc lý do; manager gửi yêu cầu ngoài workflow hoặc owner thao tác. Mọi result mới tạo version mới.

### Quyết định 6 - Catalog KPI và metric

Cần owner xác nhận danh sách rule hiện tại, loại KPI, unit, submission mode, evidence requirement và metric source. Không suy đoán từ tên rule.

## 16. Manager UI đề xuất

### Bảng tổng hợp

```text
NHÂN VIÊN | KPI 1 | KPI 2 | KPI 3 | TRUNG BÌNH | REVIEW STATUS
```

Mỗi cell:

```text
12 / 10
120% actual
100% official
APPROVED
```

Nếu chưa duyệt:

- hiện actual và provisional score;
- official hiển thị `--`;
- badge `PENDING`, `NEEDS_REVISION` hoặc `NOT_SUBMITTED`;
- header tổng hợp hiển thị `2/3 KPI đã xử lý`, không hiển thị một điểm chính thức gây hiểu nhầm.

Click cell mở drawer/modal gồm source drill-down, submission attempts, evidence, review history và nút review.

### Sale UI

- Chỉ thấy assignment của chính mình theo tháng.
- Hiển thị target, actual, actual %, provisional score, official score, status, manager feedback.
- Nút submit/resubmit theo state.
- Không đọc definition/assignment của sale khác ở API/RLS, không chỉ ẩn bằng UI.

## 17. Migration strategy dự kiến

Không chạy trong KPI-0.

1. Backup production và commit baseline mới trước KPI-1.
2. Tạo schema mới side-by-side; không sửa/xóa bảng KPI cũ.
3. Tạo period từ các tháng có dữ liệu lịch sử.
4. Migrate mỗi `kpi_rule` thành definition và period assignment snapshot.
5. Map `assigned_owners`/`owner_targets` email sang `app_users.id`; các email không map được đưa vào báo cáo exception, không tự bỏ.
6. Migrate proposal thành submission attempt; approved/rejected giữ decision và timestamp cũ.
7. Với proposal approved, tạo result legacy có source type `manual_claim` và đánh dấu `migrated_legacy`.
8. Parse evidence URL thành metadata ở trạng thái legacy; kiểm kê object thiếu/orphan trước khi private bucket.
9. Chạy shadow read: so sánh số approved proposal cũ với actual/result mới theo rule-owner-month.
10. Chỉ chuyển frontend sau khi staging parity PASS.
11. Giữ bảng cũ read-only ít nhất một chu kỳ đối soát; không hard-delete trong cùng rollout.

Rollback: frontend quay về read model cũ trong thời gian dual-read; schema mới giữ nguyên để điều tra, không drop dữ liệu.

## 18. Những gì có thể reuse

- Pattern RPC atomic, `SECURITY DEFINER`, khóa `search_path`, auth/role check từ P0-A.
- Pattern row lock chống review lặp.
- Generic `crm_write_audit` sau khi harden append-only.
- P0-B employee identity, lifecycle, assignment history và acquisition semantics.
- Modal submit KPI, customer context, evidence picker, progress UI, XLSX export.
- Cơ chế hiển thị pending proposal tháng cũ.
- Supabase realtime có thể dùng để refresh submission/review, nhưng không là source of truth.

## 19. Những gì nên bỏ hoặc supersede

- Rule active toàn cục dùng xuyên tháng như source of truth.
- `assigned_owners` và `owner_targets` JSON/email cho assignment chính thức.
- Tính actual chỉ bằng count proposal trong frontend.
- Public evidence URL và newline URL list.
- Ghi đè review trên một proposal row.
- Policy KPI chồng lấn cũ.
- Weight scoring trong tài liệu cũ.
- Quyền sale dựa email hoặc chỉ được che bằng UI.

## 20. Rủi ro

1. Migrate sai ý nghĩa proposal nếu chưa chốt `EVENT_CLAIM`/`PERIOD_TOTAL`.
2. Email legacy không map được employee ID.
3. Rule cũ active qua nhiều tháng nên khó xác định kỳ gốc/chính xác nếu không đối chiếu nghiệp vụ.
4. Evidence public và policy trùng là rủi ro riêng tư hiện hữu.
5. Care/showroom/basic purchase chưa đồng đều về actor ID và event model, gây sai attribution AUTO.
6. Nếu actual tính trực tiếp từ dữ liệu mutable mà không snapshot, lịch sử CLOSED sẽ đổi.
7. Nếu manager sửa assignment/target ACTIVE tùy ý, điểm mất tính công bằng.
8. Nếu pending bị mặc định 0, báo cáo gây hiểu nhầm; nếu bỏ khỏi mẫu số, điểm bị phồng.
9. Nếu chỉ dùng generic audit JSON, rất khó dựng lại lịch sử review chính xác.

## 21. Roadmap

### KPI-1 - Foundation schema và period/assignment

- Chốt sáu quyết định nghiệp vụ ở mục 15.
- Tạo migration mới cho period, definition, assignment và canonical RLS.
- Tạo RPC lifecycle DRAFT/ACTIVE/CLOSED và assignment/target.
- Tạo manager UI cấu hình kỳ trên staging.
- Chưa migrate proposal production.

### KPI-2 - Submission, review, evidence

- Tạo submissions, reviews, results, evidence metadata và source references.
- RPC submit/resubmit/review atomic, conflict-safe.
- Chuyển bucket private và signed URL sau inventory/backup.
- Migrate dữ liệu legacy trên staging và chạy parity test.

### KPI-3 - Metric engine, drill-down và rollout

- Chuẩn hóa metric contracts AUTO/HYBRID theo từng KPI được owner duyệt.
- Thêm actor ID/event time còn thiếu cho source CRM bằng migration riêng.
- Manager matrix, sale view, provisional/official score và close workflow.
- E2E ba role, concurrency, evidence failure, archive/source mutation và monthly isolation.
- Dual-read/shadow compare trước production rollout.

## 22. Quality gates cho phase sau

- Không migration production trước backup và staging PASS.
- RLS test bằng sale A, sale B, manager, admin, anonymous.
- Test monthly isolation và result immutability.
- Test double submit/idempotency và concurrent review.
- Test upload orphan/cleanup và signed URL authorization.
- Test source drill-down count khớp actual.
- Test employee inactive/reactivate và customer transfer.
- Không service role ở frontend; không commit secret.

## 23. Kết luận cuối

**BUSINESS DECISION REQUIRED**

Hệ thống hiện tại có nền RPC/audit/P0-B đủ tốt để tái sử dụng, nhưng model KPI cũ không đáp ứng kỳ độc lập, revision, official score snapshot, source drill-down và evidence private. Không nên vá thêm trường vào `kpi_rules`/`kpi_proposals`; nên xây model mới side-by-side rồi migrate có đối soát.

Trước KPI-1, owner cần chốt sáu quyết định ở mục 15. Sau khi chốt, dự án có thể chuyển sang trạng thái **READY FOR KPI IMPLEMENTATION**.
