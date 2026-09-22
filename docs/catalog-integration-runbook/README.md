# Catalog Integration Runbook

Thư mục này điều phối việc tích hợp website sản phẩm, quản trị catalog và CRM dùng chung Supabase.

## Cách sử dụng

1. Mở một Codex task tại `D:\SUPABASE\CRM-KOLORCERAMIC`.
2. Gửi nội dung trong `MASTER_PROMPT.md` cho Codex.
3. Codex đọc `STATUS.md` và chỉ thực hiện đúng một prompt đang được chỉ định tại `NEXT_PROMPT`.
4. Khi hoàn thành, Codex phải tạo báo cáo, tự đánh giá PASS/FAIL và dừng.
5. Nếu PASS, người dùng kiểm tra báo cáo rồi trả lời chính xác:

   `TÔI DUYỆT PROMPT <PROMPT_ID>`

6. Ở lượt tiếp theo, Codex ghi nhận phê duyệt, cập nhật `STATUS.md`, rồi mới được thực hiện prompt kế tiếp.

Không dùng một lượt Codex để chạy nhiều prompt liên tiếp.

## Cấu trúc

- `MASTER_PROMPT.md`: prompt điều phối duy nhất để bắt đầu hoặc tiếp tục công việc.
- `GOVERNANCE.md`: quy tắc an toàn, stage gate và điều kiện dừng.
- `STATUS.md`: trạng thái chính thức và prompt kế tiếp.
- `DECISIONS.md`: quyết định nghiệp vụ/kỹ thuật đã được người dùng phê duyệt.
- `prompts/GROUP-1-DATA-IMPORT.md`: schema, staging, matching và import.
- `prompts/GROUP-2-APPLICATIONS.md`: API, `/admin`, website và CRM.
- `prompts/GROUP-3-RELEASE.md`: routing, QR, kiểm thử và production.
- `templates/PHASE-REPORT.md`: mẫu báo cáo bắt buộc sau mỗi prompt.
- `reports/`: báo cáo thực thi; tạo khi prompt đầu tiên hoàn thành.

## Nguồn dữ liệu đã chốt

- Backup manifest: `D:\SUPABASE\BACKUPS\CRM-KOLORCERAMIC\2026-09-22_13-13-13\manifest.json`
- Reconciliation: `D:\SUPABASE\BACKUPS\CRM-KOLORCERAMIC\2026-09-22_13-13-13\reconciliation`
- Excel giá: `D:\IN TEM_BẢNG GIÁ NIÊM YẾT KOLOR CERAMICS_25.10.2025.xlsx`
- Supabase production ref: `jjeeazwlqcwynzquimeo`
- Vercel production project: `crm_kolor`
- Firebase project cũ: `kolor-ceramics`
