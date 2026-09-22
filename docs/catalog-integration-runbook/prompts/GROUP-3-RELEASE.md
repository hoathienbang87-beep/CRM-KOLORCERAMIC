# Nhóm 3 — Routing, kiểm thử và release

Mọi prompt trong file này phải tuân thủ `../GOVERNANCE.md`.

## 09 — Tách ứng dụng và routing

Tổ chức website, website admin và CRM thành entry point, CSS, JS, state độc lập; shared chỉ chứa Supabase client, auth helper, product normalization và contract. Routing `/`, `/admin`, `/crm`, redirect `/CRM`. Test refresh và asset path. Chưa deploy.

## 10 — Firebase redirect QR cũ

Trong dự án Firebase cũ, kiểm tra URL QR và chuẩn bị redirect giữ nguyên query `id/code` sang website mới. Có rollback, test không vòng lặp. Chưa deploy Firebase.

## 11A — Kiểm thử tự động staging

Test routes, APIs, RLS, roles, import dry-run/apply/rollback, conflict, blank price, draft, lead, snapshot quote, QR và ảnh ngoài. Fixture không dùng dữ liệu khách production và tự dọn dữ liệu staging.

## 11B — Kiểm thử UI staging

Kiểm thử desktop/mobile cho catalog, detail, ảnh, lead, auth, admin import, manual match, rollback, CRM selector, quote snapshot, refresh route và unauthorized access. Sửa lỗi trong phạm vi staging rồi chạy lại.

## 12A — Chuẩn bị production release

Tổng hợp commit, release manifest, migration, rollback, backup checklist, dry-run plan, maintenance window và go/no-go. Xác nhận đúng Supabase/Vercel/Firebase. Tuyệt đối chưa chạy migration/deploy/ghi production.

## 12B — Production cutover

Chỉ bắt đầu sau câu `TÔI XÁC NHẬN CUTOVER PRODUCTION`. Backup mới, migration, read-back và dry-run production. Dừng chờ câu `TÔI DUYỆT GHI DỮ LIỆU PRODUCTION BATCH <BATCH_ID>` trước apply. Sau apply mới deploy Vercel, smoke test và cuối cùng mới deploy Firebase redirect. Gate lỗi phải dừng/rollback.

## 13 — Theo dõi sau triển khai

Theo dõi frontend, RLS/RPC, ảnh, lead, QR, import, giá, quote snapshot, duplicate, hiệu năng và auth. Không tự sửa production; lỗi nghiêm trọng phải báo cáo và xin duyệt rollback/forward fix. Không xóa Firebase.
