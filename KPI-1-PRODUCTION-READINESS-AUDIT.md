# KPI-1 - Production Readiness Audit

Ngày audit: 2026-08-11
Repository: `D:\SUPABASE\CRM-KOLORCERAMIC`
Production: `jjeeazwlqcwynzquimeo`
Staging: `ykhtpvyelpujykheycsv`

## 1. Kết luận GO/NO-GO

**READY FOR KPI-1 PRODUCTION ROLLOUT**

KPI-1 đủ điều kiện kỹ thuật để chuyển sang một production rollout có kiểm soát. Audit này hoàn toàn read-only đối với production: không migration, không DDL/DML, không fixture, không thay đổi Auth/Storage/RLS, không deploy và không commit/push.

Các điều kiện bắt buộc vẫn phải hoàn tất ngay trước rollout:

1. Commit source KPI-1 ổn định và xác minh lại hash.
2. Xác minh backup ngày 2026-08-10 vẫn nguyên checksum.
3. Chạy database trước, frontend sau.
4. Dừng ngay nếu ref không phải `jjeeazwlqcwynzquimeo`, hash đổi, dry-run xuất hiện file ngoài KPI-1 hoặc DB smoke test fail.

## 2. Production identity

Đã xác minh bằng các tín hiệu độc lập:

| Tín hiệu | Kết quả |
|---|---|
| Supabase Projects API | Ref `jjeeazwlqcwynzquimeo`, host `db.jjeeazwlqcwynzquimeo.supabase.co`, region `ap-southeast-1`, trạng thái `ACTIVE_HEALTHY` |
| Workspace production ngoài repo | `project-ref` và `linked-project.json` đều là `jjeeazwlqcwynzquimeo` |
| Kết nối PostgreSQL read-only | PostgreSQL `17.6`, database `postgres`, đúng pooler user của ref production |
| Repo hiện tại | Đang link staging `ykhtpvyelpujykheycsv`, không được dùng để push production |

APP-SO là project khác: `yyjomihkrhjpzxekunfo`. Không có dấu hiệu nhầm project.

## 3. Repo/hash verification

| Mục | Kết quả |
|---|---|
| Branch | `main` |
| HEAD baseline | `2e723ec19f3a99dde5de14fdacda09d5b91ab1e0` |
| Remote | `origin` -> `https://github.com/hoathienbang87-beep/CRM-KOLORCERAMIC.git` |
| Working tree | Có thay đổi KPI-1 chưa commit, đúng trạng thái trước production review |
| KPI-0 source | Có |
| KPI-1 implementation report | Có |
| Consolidated migration | Có |

SHA256 tính lại của `supabase-phase-kpi1-foundation.sql`:

`D7610CD60E364C769E4226CFFFAEA08726A884C894795B3FA716EB8E87A03B0E`

Hash khớp expected và khớp tuyệt đối migration staging cuối:

`20260810095000_kpi1_nonretry_version_conflict.sql`

Không có file source nào được tự sửa trong audit.

## 4. Backup readiness

Backup gần nhất:

`D:\SUPABASE\BACKUPS\CRM-KOLORCERAMIC-2026-08-10-0301-PRE-UPGRADE`

| Thành phần | Trạng thái |
|---|---|
| `roles.sql` | PASS, 5,643 bytes, SHA256 khớp |
| `schema.sql` | PASS, 293,203 bytes, SHA256 khớp |
| `data.sql` | PASS, 2,434,929 bytes, SHA256 khớp |
| Storage `kpi-evidence` | PASS, 66/66 object, 42,767,879 bytes |
| `BACKUP-REPORT.md` | Có |
| `SHA256.txt` | Có, verify lại PASS |
| `STORAGE-SHA256.txt` | Có |

Backup còn nguyên và đủ điều kiện làm mốc trước nâng cấp.

## 5. Production schema baseline

- PostgreSQL: `17.6`.
- Schema liên quan: `public`, `auth`, `storage`, `extensions`.
- Extensions: `pgcrypto 1.3`, `uuid-ossp 1.1`, `plpgsql 1.0`.
- `app_users`, `audit_logs`, `customers`, `customer_assignments` tồn tại và bật RLS.
- P0-A/P0-B đã có đủ 13 RPC nghiệp vụ được kiểm tra: customer create/update/care/basic purchase, assign/unassign/bulk/transfer và employee lifecycle.
- Assignment hiện tại: 173 dòng, gồm 151 current và 22 historical.
- Customer policy dùng assignment hiện tại; không cấp ownership bằng `created_by`.

Production không có `supabase_migrations.schema_migrations`. P0-A/P0-B trước đây được rollout bằng SQL có kiểm soát thay vì migration history của CLI. Đây là drift vận hành cần ghi nhận, nhưng không phải schema dependency blocker của KPI-1.

## 6. KPI legacy baseline

| Object | Tồn tại | RLS | Rows |
|---|---:|---:|---:|
| `kpi_rules` | Có | Bật | 8 |
| `kpi_proposals` | Có | Bật | 102 |
| `kpi_periods` | Chưa | - | - |
| `kpi_definitions` | Chưa | - | - |
| `kpi_assignments` | Chưa | - | - |

Legacy aggregate:

- Rules active: 8.
- Proposals: 56 approved, 33 pending, 13 rejected.
- Dữ liệu proposal theo tháng: 2026-05 đến 2026-08.
- Ba RPC legacy còn dùng `kpi_rules`/`kpi_proposals`: submit, review và archive proposal.
- Legacy tables có columns, indexes, policies, grants và runtime dependency riêng; KPI-1 không thay đổi chúng.

Kết luận: KPI-1 là side-by-side additive và không phá legacy runtime.

## 7. KPI-1 static migration impact

Migration được bọc trong một transaction `begin`/`commit`.

| Nhóm statement | Số lượng / tác động | Phân loại |
|---|---|---|
| `CREATE TABLE IF NOT EXISTS` | 3 bảng foundation | SAFE ADDITIVE |
| `CREATE INDEX IF NOT EXISTS` | 5 index | SAFE ADDITIVE |
| `CREATE OR REPLACE FUNCTION` | 21 helper/RPC/trigger function mới, đều prefix `crm_kpi_` | SAFE ADDITIVE |
| `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` | 3 guard trên bảng mới, 1 guard deactivation trên `app_users` | EXPECTED HARDENING |
| `ALTER TABLE ... ENABLE RLS` | 3 bảng mới | EXPECTED HARDENING |
| `DROP POLICY IF EXISTS` + `CREATE POLICY` | 3 canonical read policies trên bảng mới | EXPECTED HARDENING |
| `REVOKE`/`GRANT` | Chặn direct table write; chỉ grant SELECT/RPC cần thiết | EXPECTED HARDENING |
| `ALTER` legacy KPI | Không có | SAFE |
| `DROP TABLE`/`TRUNCATE` | Không có | SAFE |
| Top-level business data mutation | Không có | SAFE |
| `CREATE TYPE/DOMAIN` | Không có | N/A |
| `COMMENT ON` | Không có | N/A |

Điểm tương tác duy nhất với object P0-B là trigger `app_users_kpi_draft_deactivation_guard`. Trigger này chặn deactivate sale còn assignment ở kỳ DRAFT, dùng employee advisory lock và đã PASS regression P0-B trên staging.

Không có hành vi ngoài scope: không drop/alter/migrate `kpi_rules`, `kpi_proposals`, proposal hoặc evidence.

## 8. Dependency compatibility

| Dependency | Expected | Production found | Kết luận |
|---|---|---|---|
| `app_users.id` | `text` PK | Đúng | MATCH |
| `app_users.supabase_auth_id` | `uuid` | Đúng | MATCH |
| `role`, `active`, `lifecycle_status` | Có | Đúng | MATCH |
| `audit_logs` legacy shape | id/action/entity/entity_id/email/payload/created/raw | Đúng | MATCH |
| `crm_current_app_user_id()` | SECURITY DEFINER, locked search_path | Có | MATCH |
| `crm_current_user_role()` | SECURITY DEFINER, locked search_path | Có | MATCH |
| `crm_is_active_user()` | SECURITY DEFINER, locked search_path | Có | MATCH |
| `crm_write_audit(...)` | SECURITY DEFINER, locked search_path | Có | MATCH |
| P0-B lifecycle guard | Có | Có | MATCH |
| `pgcrypto` / `gen_random_uuid()` | Có | Có | MATCH |
| Advisory locks / NOWAIT | PostgreSQL 17 | Có | MATCH |
| Timezone `Asia/Ho_Chi_Minh` | PostgreSQL timezone catalog | Có theo staging test | MATCH |

Năm helper quan trọng có cùng signature, security config và MD5 definition giữa production và staging.

## 9. Object collision

Production không có:

- `kpi_periods`, `kpi_definitions`, `kpi_assignments`.
- Bất kỳ function/RPC `crm_kpi_*` nào.
- Trigger/policy/index KPI-1 nào.

Không phát hiện partial KPI-1 hoặc object collision nguy hiểm.

## 10. RLS/grant impact

Intended access sau KPI-1:

| Role | Period | Definition | Assignment | Direct write |
|---|---|---|---|---|
| Anonymous | Không | Không | Không | Không |
| Sale | ACTIVE/CLOSED có assignment của mình | Không đọc catalog toàn cục | Chỉ của mình trong ACTIVE/CLOSED | Không |
| Manager | Đọc toàn bộ | Đọc toàn bộ | Đọc toàn bộ | Chỉ qua RPC |
| Admin/Owner | Đọc toàn bộ | Đọc toàn bộ | Đọc toàn bộ | Chỉ qua RPC |

- Ba bảng mới revoke toàn bộ quyền `anon/authenticated`, sau đó chỉ grant SELECT cho `authenticated`.
- RLS dùng `auth.uid()` -> `app_users.id`, không cấp quyền bằng email.
- Guard trigger chặn browser DML kể cả khi grant bị mở nhầm; RPC đặt transaction-local write flag.
- Không policy, grant hoặc table privilege nào của legacy KPI bị migration sửa.

Kết luận: RLS/grant đúng thiết kế KPI-1.

## 11. RPC/function security

- 21 function đều `SECURITY DEFINER` và `SET search_path = public`.
- Internal snapshot/audit/guard functions revoke EXECUTE từ `PUBLIC`, `anon`, `authenticated`.
- Bốn read/auth helper chỉ grant `authenticated` khi RLS cần gọi.
- 13 business RPC chỉ grant `authenticated`, nhưng tự kiểm tra active user và role từ DB; không tin role frontend.
- Reopen chỉ admin/owner; manager không được reopen.
- Không có dynamic SQL và không có bề mặt SQL injection từ `EXECUTE` string.
- Có input validation, state checks, target > 0, employee phải là sale ACTIVE và expected version checks.
- Write và audit nằm cùng PostgreSQL transaction; lỗi làm rollback toàn bộ.
- Locking gồm row lock, `NOWAIT`, advisory employee lock và thứ tự employee ổn định ở bulk/matrix.
- Expected business/version conflict dùng `P0001` với prefix `KPI_VERSION_CONFLICT`, không dùng retryable `40001`.

Kết luận: function security phù hợp production rollout.

## 12. Constraints/indexes

DB-level protection đầy đủ:

- `kpi_periods`: unique month, first-day normalization, status DRAFT/ACTIVE/CLOSED, valid range, timezone/name/version/lifecycle shape.
- `kpi_definitions`: unique code, AUTO/MANUAL/HYBRID, EVENT_CLAIM/PERIOD_TOTAL, unit/name/version.
- `kpi_assignments`: FK restrict đến period/definition/employee, unique period-definition-employee, target > 0, status/cancel/snapshot/version checks.

Indexes đủ cho phạm vi foundation:

- period status/month;
- definition active/code;
- assignment period/status;
- assignment employee/period;
- assignment definition/period.

Không phát hiện missing index có khả năng gây vấn đề thực tế ở quy mô hiện tại.

## 13. Migration history/drift

Staging history khớp sáu migration:

1. `20260810090000_kpi1_foundation.sql`
2. `20260810091000_kpi1_foundation_reconcile.sql`
3. `20260810092000_kpi1_concurrency_reconcile.sql`
4. `20260810093000_kpi1_employee_lock_reconcile.sql`
5. `20260810094000_kpi1_fail_fast_concurrency.sql`
6. `20260810095000_kpi1_nonretry_version_conflict.sql`

Local consolidated source trùng byte/hash với file thứ 6. Vì file thứ 6 là full consolidated state cuối, production chỉ cần chạy source này một lần; không chạy chuỗi sáu staging migrations.

Production không có migration history table. Rollout phải giữ đúng quy trình one-off reviewed SQL hiện tại hoặc thiết lập migration governance trong phase riêng; không được tự repair history trong rollout KPI-1.

## 14. Dry-run result

Dry-run được chạy trong workspace production riêng ngoài repo, linked đúng `jjeeazwlqcwynzquimeo`. CLI xác nhận `--dry-run` không apply migration.

Kết quả:

- `dryRun: true`.
- Chỉ một migration dự kiến: `20260811090000_kpi1_foundation_consolidated.sql`.
- Copy hash khớp source gốc.
- Không seed.
- Không roles file.
- Không migration ngoài ý muốn.
- Không destructive warning.

Production không bị thay đổi.

## 15. Production data compatibility

Aggregate `app_users`:

- 5 user, tất cả ACTIVE.
- 3 sale ACTIVE, 1 manager ACTIVE, 1 admin ACTIVE.
- 0 email trống.
- 0 nhóm email normalized trùng.
- 0 mismatch giữa `active` và `lifecycle_status`.
- Role values chỉ gồm ADMIN, MANAGER, SALE.

KPI-1 migration không tự tạo period, definition hoặc assignment nên không mutate/migrate dữ liệu user hay legacy KPI.

## 16. `audit_logs` compatibility

- Bảng tồn tại, RLS bật, 849 rows, không có `id` null.
- `audit_logs.id` là text PK và không có default.
- Đây không phải blocker: production `crm_write_audit` tự sinh `gen_random_uuid()::text`, insert đúng `public.audit_logs` và implementation MD5 khớp staging.
- `crm_kpi_write_audit` gọi helper P0-A trong cùng transaction, bổ sung actor user id, actor role và timestamp.
- KPI-1 không thay đổi policy/grant legacy của `audit_logs`.

## 17. Legacy lint warning assessment

`crm_json_timestamptz(text)` đang đánh dấu `IMMUTABLE` nhưng ép kiểu `text::timestamptz` có hành vi phụ thuộc timezone (`STABLE`). Production DB lint báo đúng một warning này.

- Không có object relation/index được phát hiện phụ thuộc hàm.
- KPI-1 không gọi hàm.
- Không thể làm KPI-1 migration fail.
- Có correctness risk riêng nếu tương lai dùng hàm trong index/generated expression hoặc session timezone khác nhau.

Phân loại: **NON-BLOCKING BACKLOG**. Không sửa trong phase này.

## 18. Frontend compatibility

- Legacy panel vẫn tồn tại với nhãn `KPI hiện tại (legacy)`.
- Foundation panel có nhãn `Kỳ KPI mới`.
- Foundation panel chỉ hiển thị khi `isManager()`; role này gồm manager/admin/owner.
- Sale không thấy config panel và không đăng ký watcher cho ba bảng foundation.
- Legacy `kpiRules` và `kpiProposals` vẫn được load/tính/duyệt theo runtime hiện tại.
- Nếu DB chưa có KPI-1, manager watcher sẽ báo table-not-found. Vì vậy rollout bắt buộc **DB FIRST, then frontend**.

Không deploy frontend trong audit.

## 19. UI coexistence risk

Nguy cơ manager hiểu nhầm hai hệ thống ở mức trung bình vì hai panel cùng xuất hiện trong một tab.

Đề xuất notice nhỏ khi rollout frontend:

> Hệ thống KPI mới đang trong giai đoạn cấu hình. KPI hiện tại của nhân viên vẫn sử dụng hệ thống cũ cho đến khi chuyển đổi hoàn tất.

Không redesign và không sửa UI trong audit.

## 20. Rollout order

1. Verify lại backup/checksum. STOP nếu fail.
2. Commit stable source; tag/ghi HEAD. STOP nếu working tree còn thay đổi ngoài scope.
3. Tính lại KPI-1 SHA256. STOP nếu khác expected.
4. Xác minh production ref bằng ít nhất hai tín hiệu. STOP nếu khác `jjee...`.
5. Quyết định maintenance window; không tự bật/tắt trong audit.
6. Chạy đúng một consolidated KPI-1 migration. STOP nếu transaction fail.
7. Inventory DB: ba bảng, constraints, indexes, triggers, RLS, grants, RPC. STOP nếu thiếu/khác.
8. Chạy DB/RLS/RPC smoke test có kiểm soát. STOP nếu có partial fixture hoặc audit sai.
9. Deploy frontend sau khi DB PASS. STOP nếu content/hash/version không đúng.
10. Manager UI smoke: DRAFT, definition, assignment, activate lock.
11. Sale legacy regression: legacy KPI vẫn đọc/gửi đúng; sale không thấy config mới.
12. Xác minh audit logs và cleanup fixture.
13. Tắt maintenance nếu đã bật.
14. Monitor error/Auth/RPC trong cửa sổ sau rollout.

## 21. Rollback/safe-forward

Ưu tiên **safe-forward** vì KPI-1 là additive và chưa có dữ liệu production thật.

- DB migration thành công, frontend lỗi: rollback frontend; giữ ba bảng/RPC chưa dùng. Không DROP khẩn cấp.
- Migration fail trong transaction: PostgreSQL rollback toàn bộ; không deploy frontend; inventory xác minh không partial object.
- DB PASS nhưng smoke RLS/RPC fail: giữ maintenance, không deploy frontend, tạo forward-fix đã test staging.
- Frontend đã deploy nhưng regression legacy: rollback frontend về version cũ; KPI-1 schema có thể nằm yên không ảnh hưởng legacy.
- Không tự repair migration history và không dùng destructive rollback SQL trong sự cố.

## 22. Production smoke test plan

Không chạy fixture trong audit này. Sau rollout, dùng một kỳ test tương lai có tên rõ:

Manager:

1. Tạo DRAFT period.
2. Tạo definition test.
3. Giao cho một sale test với target > 0.
4. Activate và xác minh period/assignment bị khóa.

Sale:

1. Chỉ thấy assignment của mình trong ACTIVE/CLOSED.
2. Không thấy assignment sale khác.
3. Không thấy definition catalog/config panel.
4. Direct INSERT/UPDATE/DELETE bị chặn.

Admin/Owner:

- Đọc/quản lý đúng quyền; reopen chỉ admin/owner.

Anonymous:

- Không đọc được business object và không execute business RPC.

Cleanup:

- Ưu tiên cleanup khi period còn DRAFT.
- Không đụng customer thật.
- Nếu lifecycle không cho hard-delete, dùng fixture future rõ ràng và archive/cancel bằng nghiệp vụ được duyệt.

## 23. Blockers

**Không có blocker kỹ thuật được phát hiện.**

Các STOP condition trước rollout không phải blocker hiện tại nhưng bắt buộc tuân thủ: stable commit, hash verification, backup verification, đúng production ref và DB-first deployment.

## 24. Non-blocking backlog

1. Chuẩn hóa migration governance vì production hiện không có `schema_migrations` history; làm ở phase riêng, không repair trong KPI-1 rollout.
2. Sửa volatility của `crm_json_timestamptz` sau một audit dependency riêng.
3. Rà các legacy broad grants/policies của `audit_logs`, `kpi_rules`, `kpi_proposals`; KPI-1 không mở rộng chúng.
4. Thêm notice UI phân biệt legacy KPI và KPI foundation.
5. KPI-2 mới xử lý submission/review/evidence private; KPI-1 chưa thay legacy proposal/evidence.

## 25. Final recommendation

**READY FOR KPI-1 PRODUCTION ROLLOUT**

Bằng chứng quyết định:

- Source hash đúng và trùng migration staging cuối.
- Backup DB/Storage nguyên checksum.
- Production identity đúng.
- Không object collision hoặc partial KPI-1.
- Dependencies P0-A/P0-B khớp staging.
- Legacy KPI không bị alter/drop/migrate.
- RLS/grants/RPC security đạt thiết kế.
- Consolidated source có đủ tất cả concurrency fixes.
- Dry-run chỉ có đúng một migration KPI-1.
- `audit_logs` compatible.
- Static gates PASS: KPI-1 121, P0-A 80, P0-B 72, JavaScript syntax, duplicate HTML ID, secret review và `git diff --check`.

Audit dừng tại đây. Chưa chạy production migration, chưa deploy, chưa commit/push và chưa bắt đầu KPI-2.
