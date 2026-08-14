# KPI-2 Production Runbook

Trạng thái: **PREPARATORY ONLY - NOT AN AUTHORIZATION TO ROLL OUT**
Điều kiện bắt buộc: **ROLL OUT ONLY AFTER FINAL PRODUCTION READINESS RE-AUDIT = READY**

## 1. Identity và artifact

- Production ref: `jjeeazwlqcwynzquimeo`
- Staging ref: `ykhtpvyelpujykheycsv`
- Production artifact duy nhất: `supabase-phase-kpi2-final-consolidated.sql`
- Exact SHA256: `eb33f45534d96f335f494d12ba67b884d96360be5e03020092682945efdf0236`

Không chạy các file staging development sau trên production:

- `supabase-phase-kpi2-submission-review-evidence.sql`
- `supabase-phase-kpi2-reconcile-1.sql`
- `supabase-phase-kpi2-reconcile-2.sql`
- `supabase-phase-kpi2-reconcile-3.sql`
- `supabase-phase-kpi2-reconcile-4.sql`
- `supabase-phase-kpi2-remediation.sql`
- `supabase-phase-kpi2-remediation-finalize.sql`

Các file trên chỉ là `STAGING DEVELOPMENT / AUDIT HISTORY / SUPERSEDED FOR PRODUCTION`.

## 2. Governance

Production migration history không canonical. Không repair history tự động và không dùng automatic `db push` làm source of truth. Rollout chỉ được thực hiện bằng reviewed one-off consolidated SQL trong production workspace đã xác minh độc lập.

Trước cửa sổ rollout phải xác minh lại repo, branch, HEAD, production ref và SHA256 artifact. Hash sai một ký tự thì dừng.

## 3. Fresh backup bắt buộc

Tạo backup ngay trước rollout, không tái sử dụng backup cũ:

1. `roles.sql`, `schema.sql`, `data.sql`.
2. SHA256 cho ba file database.
3. Current Storage bucket và policy inventory.
4. Toàn bộ object legacy `kpi-evidence` cùng size/checksum.
5. Xác minh file tồn tại, readable và size hợp lý.
6. Lưu ngoài Git repository; không lưu password, access token hoặc service-role key.

Không rollout nếu backup không PASS.

## 4. Thứ tự triển khai

1. Final read-only production readiness re-audit phải kết luận `READY FOR KPI-2 PRODUCTION ROLLOUT`.
2. Owner duyệt artifact hash, fresh backup và maintenance window.
3. Apply đúng một consolidated SQL bằng reviewed one-off runner.
4. Kiểm tra schema, function, RLS, grants, bucket private và Storage policies.
5. Chạy controlled smoke cho Auth/RPC/RLS/evidence/idempotency/privacy.
6. Chỉ khi DB và Storage cùng PASS mới deploy frontend KPI-2.
7. Theo dõi audit, error và STAGED orphan trong 24-48 giờ đầu.

## 5. Fail-closed

- DB migration fail: transaction rollback; không deploy frontend.
- DB PASS nhưng Storage/bucket/policy smoke fail: feature giữ OFF; không deploy frontend.
- Auth/RLS/privacy smoke fail: dừng rollout và forward-fix trên staging trước.

## 6. Safe-forward

- Không `DROP` nóng table, function hoặc bucket.
- DB + Storage PASS nhưng frontend fail: rollback frontend, giữ additive schema.
- Nếu evidence đã tồn tại: không xóa table/bucket để rollback.
- Forward-fix chỉ sau khi bản sửa PASS staging và được review.

## 7. Post-rollout smoke tối thiểu

- MANUAL COUNT và SUM.
- HYBRID customers/care; deals fail closed.
- Valid/invalid location và timestamp.
- Same request/same payload; same request/different payload.
- Duplicate privacy giữa hai Sale.
- Bulk review all-or-nothing.
- Private evidence, signed URL 120 giây, tối đa 2 ảnh.
- `score_enabled=false`; actual >100% nhưng score cap 100%.
- Audit revision/review không chứa `latitude`, `longitude` hoặc `location_snapshot`.

Runbook này không tự cấp quyền migration, deploy hoặc push. Mọi hành động production cần owner phê duyệt riêng sau final READY re-audit.
