# Trạng thái Catalog Integration

`NEXT_PROMPT: 12B`

| ID | Công việc | Dependency | Trạng thái | Báo cáo | Commit |
|---|---|---|---|---|---|
| 01A | Data contract sản phẩm | Không | APPROVED | `reports/01A.md` | `8285746` |
| 01B | Migration SQL additive | 01A | APPROVED | `reports/01B.md` | `66e0b43` |
| 02A | Áp dụng migration staging | 01B | APPROVED | `reports/02A.md` | `88c478e` |
| 02B | RLS và RPC staging | 02A | APPROVED | `reports/02B.md` | `2e4382c` |
| 03A | Parser và matching dry-run | 01A | APPROVED | `reports/03A.md` | `230c5d8` |
| 03B | Import batch, apply, rollback staging | 02B, 03A | APPROVED | `reports/03B.md` | `d27772f` |
| 04 | Dữ liệu đã duyệt trên staging | 03B | APPROVED | `reports/04.md` | `02d66ad` |
| 05A | API catalog công khai | 02B, 04 | APPROVED | `reports/05A.md` | `04f0f76` |
| 05B | Website leads | 02B | APPROVED | `reports/05B.md` | `a16b970` |
| 06A | `/admin` quản lý catalog | 05A | APPROVED | `reports/06A.md` | `31da671` |
| 06B | `/admin` import và rollback | 03B, 06A | APPROVED | `reports/06B.md` | `319c044` |
| 07A | Website catalog `/` | 05A | APPROVED | `reports/07A.md` | `585da0f` |
| 07B | Chi tiết, QR và lead | 05B, 07A | APPROVED | `reports/07B.md` | `8b7a3d1` |
| 08A | Bộ chọn sản phẩm trong CRM | 05A | APPROVED | `reports/08A.md` | `dde1733` |
| 08B | Ẩn quản lý sản phẩm khỏi CRM | 08A | APPROVED | `reports/08B.md` | `25ed03c` |
| 09 | Tách ứng dụng và routing | 06B, 07B, 08B | APPROVED | `reports/09.md` | `307f407` |
| 10 | Firebase redirect cho QR cũ | 09 | APPROVED | `reports/10.md` | `1206569` |
| 11A | Kiểm thử tự động staging | 09, 10 | APPROVED | `reports/11A.md` | `5daa00c` |
| 11B | Kiểm thử UI staging | 11A | APPROVED | `reports/11B.md` | `a7f0069` |
| 12A | Chuẩn bị production release | 11B | APPROVED | `reports/12A.md` | `3a9fa10` |
| 12B | Production cutover | 12A + xác nhận production | IN_PROGRESS | `reports/12B.md` | `f06cdfa` |
| 13 | Theo dõi sau triển khai | 12B | NOT_STARTED | | |

## Lịch sử phê duyệt

- 2026-09-23 — Prompt 01A — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 01A`.
- 2026-09-23 — Prompt 01B — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 01B`.
- 2026-09-23 — Prompt 02A — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 02A`.
- 2026-09-23 — Prompt 02B — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 02B`.
- 2026-09-23 — Prompt 03A — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 03A`.
- 2026-09-24 — Prompt 03B — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 03B`.
- 2026-09-25 — Prompt 04 — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 04`.
- 2026-09-25 — Prompt 05A — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 05A`.
- 2026-09-25 — Prompt 05B — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 05B`.
- 2026-09-25 — Prompt 06A — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 06A`.
- 2026-09-26 — Prompt 06B — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 06B`.
- 2026-09-28 — Prompt 07A — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 07A`.
- 2026-09-28 — Prompt 07B — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 07B`.
- 2026-09-28 — Prompt 08A — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 08A`.
- 2026-09-30 — Prompt 08B — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 08B`.
- 2026-09-30 — Prompt 09 — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 09`.
- 2026-09-30 — Prompt 10 — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 10`.
- 2026-09-30 — Prompt 11A — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 11A`.
- 2026-10-01 — Prompt 11B — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 11B`.
- 2026-10-01 — Prompt 12A — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 12A`; xác nhận cutover production riêng đã được gửi bằng câu `TÔI XÁC NHẬN CUTOVER PRODUCTION`.

## Ghi chú 03B

- 2026-09-24 — Người dùng cho phép ngoại lệ kiểm thử kỹ thuật Prompt 03B trên Supabase Local; ngoại lệ không áp dụng cho 04, 11A hoặc 11B.
- 2026-09-24 — Người dùng cho phép migration bổ sung 03B để thêm approval gate và audit before/after. Migration, rollback và toàn bộ acceptance test đã PASS trên local; đang chờ phê duyệt 03B.

## Ghi chú 04

- 2026-09-24 — Cloud staging `nalkeptqohjbjnqwpzzv` đã được xác minh và CLI đã chuyển link từ production sang staging.
- 2026-09-24 — Baseline Product R2 schema đã áp trên staging mới/trống. Migration 01B fail-closed tại ACL verification và rollback sạch; 02B/03B, baseline 75 Product và workbook dry-run chưa chạy.
- 2026-09-24 — Prompt 04 giữ `BLOCKED`, chờ người dùng quyết định về migration staging-bootstrap bổ sung để harden default privileges trước 01B.
- 2026-09-25 — Người dùng cho phép migration staging-bootstrap ACL cho Prompt 04. ACL + 01B + 02B + 03B đã PASS trên cloud staging; baseline giữ nguyên 75 UUID.
- 2026-09-25 — Dry-run workbook finalized đã PASS: 102 dòng giữ lại, 2 excluded, 359 ứng viên không được nhập; Product vẫn 75 và không đổi. Prompt 04 ở checkpoint `DRY_RUN_PENDING_USER_REVIEW`.
- 2026-09-25 — Người dùng cho phép phần apply/verify/rollback Prompt 04 trên staging. Apply và rollback replay đều idempotent; 75 baseline giữ nguyên, 48 Product rehearsal đã archive, audit/history đầy đủ. Prompt 04 chuyển `PASS_PENDING_APPROVAL`.

## Ghi chú 05A

- 2026-09-25 — Prompt 04 được người dùng phê duyệt; Prompt 05A bắt đầu với dependency 02B và 04 đều `APPROVED`.
- 2026-09-25 — API/RPC catalog public v1, runtime fixture test, REST read-back và transactional rollback rehearsal đã PASS trên cloud staging `nalkeptqohjbjnqwpzzv`; dữ liệu public trước/sau giống nhau về nội dung và production không bị tác động.

## Ghi chú 05B

- 2026-09-25 — Prompt 05A được người dùng phê duyệt; Prompt 05B bắt đầu với dependency 02B đã `APPROVED`.
- 2026-09-25 — Luồng website lead v1, validate/chống spam, manager/owner workflow, chuyển/ghép customer, idempotency, audit, REST permission, rollback rehearsal và regression đã PASS trên cloud staging `nalkeptqohjbjnqwpzzv`; fixture rollback sạch và production không bị tác động.

## Ghi chú 06A

- 2026-09-25 — Prompt 05B được người dùng phê duyệt; Prompt 06A bắt đầu với dependency 05A đã `APPROVED`.
- 2026-09-25 — Ứng dụng catalog admin tách biệt, auth/role guard, danh sách/lọc/chỉnh sửa/trạng thái, preview URL ảnh/fallback, RPC admin và kiểm thử desktop/mobile đã PASS; migration/runtime/rollback trên cloud staging sạch và production không bị tác động.

## Ghi chú 06B

- 2026-09-25 — Prompt 06A được người dùng phê duyệt; Prompt 06B bắt đầu với dependency 03B và 06A đều `APPROVED`.
- 2026-09-25 — Admin import hai chế độ, Excel preview/matching, candidate review, approval/apply, lịch sử/rollback, PDF OCR pending gate, API đọc/review và E2E cloud staging đã PASS; fixture rollback sạch và production không bị tác động.

## Ghi chú 07A

- 2026-09-26 — Prompt 06B được người dùng phê duyệt; Prompt 07A bắt đầu với dependency 05A đã `APPROVED`.
- 2026-09-26 — Website catalog độc lập, public RPC client, tìm kiếm/lọc/lazy pagination, giá VNĐ/m², trạng thái thiếu dữ liệu, ảnh ngoài/fallback và responsive đã PASS bằng fixture browser; không đổi routing, không deploy và không tác động production.

## Ghi chú 07B

- 2026-09-28 — Prompt 07A được người dùng phê duyệt; Prompt 07B bắt đầu với dependency 05B và 07A đều `APPROVED`.
- 2026-09-28 — Chi tiết `?id=...`, gallery/media, chia sẻ Zalo/WhatsApp/native, QR SVG cục bộ, website lead idempotent và tracking không PII đã PASS bằng fixture browser desktop/mobile; không đổi routing, không deploy và không tác động production.

## Ghi chú 08A

- 2026-09-28 — Prompt 07B được người dùng phê duyệt; Prompt 08A bắt đầu với dependency 05A đã `APPROVED`.
- 2026-09-28 — Product selector dùng RPC 02B, tích hợp đề xuất/quan tâm/đơn hàng và adapter báo giá/kho, website action, snapshot bất biến và responsive đã PASS bằng fixture cục bộ; không migration, deploy hoặc tác động production.

## Ghi chú 08B

- 2026-09-28 — Prompt 08A được người dùng phê duyệt; Prompt 08B bắt đầu với dependency 08A đã `APPROVED`.
- 2026-09-28 — Menu/hash/panel/drawer/import catalog cũ và mutation runtime đã được retire khỏi CRM; owner/admin được hướng tới `/admin`, sale không còn đường sửa catalog, các adapter đọc cho selector/báo giá/đơn/kho/báo cáo được giữ lại và regression desktop/mobile đã PASS. Không migration, database write, deploy, push hoặc tác động production.

## Ghi chú 09

- 2026-09-30 — Prompt 08B được người dùng phê duyệt; Prompt 09 bắt đầu với dependencies 06B, 07B và 08B đều `APPROVED`.
- 2026-09-30 — Đã tách website catalog, admin catalog và CRM thành ba entry point/bundle/runtime độc lập; thêm shared Supabase client/auth contract không chứa domain logic; cấu hình `/`, `/admin`, `/crm` và redirect `/CRM`; static, browser, refresh/asset-path và regression 06A–08B/CRM đều PASS. Không database write, deploy, push hoặc tác động production. Prompt 09 chuyển `PASS_PENDING_APPROVAL` và dừng tại gate.

## Ghi chú 10

- 2026-09-30 — Prompt 09 được người dùng phê duyệt; Prompt 10 bắt đầu với dependency 09 đã `APPROVED`.
- 2026-09-30 — Đã xác minh read-only QR/link live cũ dùng `?id=` và nhận alias `?code=`; chuẩn bị package redirect-only pin project/site `kolor-ceramics`, thêm `code` compatibility cho catalog mới, rollback procedure và test static/emulator/dry-run. Live Firebase version trước/sau dry-run không đổi; không deploy, clone, tạo channel hoặc tác động production. Prompt 10 chuyển `PASS_PENDING_APPROVAL` và dừng tại gate.

## Ghi chú 11A

- 2026-09-30 — Prompt 10 được người dùng phê duyệt; Prompt 11A bắt đầu với dependencies 09 và 10 đều `APPROVED`. Cloud staging bắt buộc được pin tại `nalkeptqohjbjnqwpzzv`, khác production `jjeeazwlqcwynzquimeo`.
- 2026-09-30 — Automated database/REST/contract/browser E2E đã PASS trên cloud staging `nalkeptqohjbjnqwpzzv`: routes, APIs, RLS/roles, dry-run/apply/idempotency/rollback/conflict/blank price/new-update/draft, lead, quote snapshot, QR và ảnh ngoài đều đạt; fixture rollback sạch, production không bị tác động. Prompt 11A chuyển `PASS_PENDING_APPROVAL` và dừng chờ duyệt.

## Ghi chú 11B

- 2026-09-30 — Prompt 11A được người dùng phê duyệt; Prompt 11B bắt đầu trên Supabase cloud staging `nalkeptqohjbjnqwpzzv`. UI được phục vụ cục bộ và trỏ tới cloud staging thật; không deploy và không dùng production `jjeeazwlqcwynzquimeo`.
- 2026-09-30 — Live UI rehearsal desktop/mobile đã PASS cho catalog/detail/ảnh/lead/Auth/admin import/manual match/approval/apply/rollback/CRM selector/quote snapshot/deep refresh/unauthorized; read-back audit before/after đầy đủ, fixture residue bằng 0 và toàn bộ regression 11A PASS. Prompt 11B chuyển `PASS_PENDING_APPROVAL` và dừng chờ duyệt.

## Ghi chú 12A

- 2026-10-01 — Prompt 11B được người dùng phê duyệt; Prompt 12A bắt đầu để chuẩn bị production release package. Chỉ thực hiện read-only inventory/planning; không migration, database write, deploy hoặc tác động production.
- 2026-10-01 — Release manifest/checksum, production migration/rollback bundle, read-only preflight, fresh-backup checklist, two-phase maintenance window, dry-run/batch approval stop và GO/NO-GO matrix đã hoàn tất; 119 readiness checks, toàn bộ static regression và Firebase dry-run PASS. Prompt 12A chuyển `PASS_PENDING_APPROVAL`; chưa bắt đầu 12B và chưa tác động production.

## Ghi chú 12B

- 2026-10-01 — Prompt 12A được phê duyệt và câu xác nhận cutover production đã được ghi nhận. Prompt 12B bắt đầu tại fresh-backup/preflight gate; chưa apply dữ liệu hoặc deploy.
- 2026-10-01 — Fresh backup SQL + Storage, preflight, 9 migration production và schema/RLS/RPC read-back đều PASS. Production preview tạo batch `ead71cd8-9b44-4fd8-ba5c-f03d9fbce52a`; Product trước/sau byte-identical, batch `READY`, chưa approved/applied.
- 2026-10-01 — Checkpoint `PRODUCTION_PREVIEW_PENDING_BATCH_APPROVAL`. Giữ `NEXT_PROMPT: 12B`; cấm apply/deploy cho đến câu chính xác `TÔI DUYỆT GHI DỮ LIỆU PRODUCTION BATCH ead71cd8-9b44-4fd8-ba5c-f03d9fbce52a`.
