# Trạng thái Catalog Integration

`NEXT_PROMPT: WAITING_FOR_APPROVAL`

| ID | Công việc | Dependency | Trạng thái | Báo cáo | Commit |
|---|---|---|---|---|---|
| 01A | Data contract sản phẩm | Không | APPROVED | `reports/01A.md` | `8285746` |
| 01B | Migration SQL additive | 01A | APPROVED | `reports/01B.md` | `66e0b43` |
| 02A | Áp dụng migration staging | 01B | APPROVED | `reports/02A.md` | `88c478e` |
| 02B | RLS và RPC staging | 02A | APPROVED | `reports/02B.md` | `2e4382c` |
| 03A | Parser và matching dry-run | 01A | PASS_PENDING_APPROVAL | `reports/03A.md` | `230c5d8` |
| 03B | Import batch, apply, rollback staging | 02B, 03A | NOT_STARTED | | |
| 04 | Dữ liệu đã duyệt trên staging | 03B | NOT_STARTED | | |
| 05A | API catalog công khai | 02B, 04 | NOT_STARTED | | |
| 05B | Website leads | 02B | NOT_STARTED | | |
| 06A | `/admin` quản lý catalog | 05A | NOT_STARTED | | |
| 06B | `/admin` import và rollback | 03B, 06A | NOT_STARTED | | |
| 07A | Website catalog `/` | 05A | NOT_STARTED | | |
| 07B | Chi tiết, QR và lead | 05B, 07A | NOT_STARTED | | |
| 08A | Bộ chọn sản phẩm trong CRM | 05A | NOT_STARTED | | |
| 08B | Ẩn quản lý sản phẩm khỏi CRM | 08A | NOT_STARTED | | |
| 09 | Tách ứng dụng và routing | 06B, 07B, 08B | NOT_STARTED | | |
| 10 | Firebase redirect cho QR cũ | 09 | NOT_STARTED | | |
| 11A | Kiểm thử tự động staging | 09, 10 | NOT_STARTED | | |
| 11B | Kiểm thử UI staging | 11A | NOT_STARTED | | |
| 12A | Chuẩn bị production release | 11B | NOT_STARTED | | |
| 12B | Production cutover | 12A + xác nhận production | NOT_STARTED | | |
| 13 | Theo dõi sau triển khai | 12B | NOT_STARTED | | |

## Lịch sử phê duyệt

- 2026-09-23 — Prompt 01A — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 01A`.
- 2026-09-23 — Prompt 01B — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 01B`.
- 2026-09-23 — Prompt 02A — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 02A`.
- 2026-09-23 — Prompt 02B — Người dùng phê duyệt bằng câu: `TÔI DUYỆT PROMPT 02B`.
