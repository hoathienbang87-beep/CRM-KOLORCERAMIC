# Master Prompt cho Codex

Làm việc tại:

`D:\SUPABASE\CRM-KOLORCERAMIC`

Bạn phải điều phối công việc theo runbook:

`D:\SUPABASE\CRM-KOLORCERAMIC\docs\catalog-integration-runbook`

Trước khi hành động, đọc đầy đủ theo thứ tự:

1. `README.md`
2. `GOVERNANCE.md`
3. `DECISIONS.md`
4. `STATUS.md`
5. File prompt group chứa `NEXT_PROMPT`
6. Báo cáo prompt dependency gần nhất nếu có

Quy tắc thực thi:

- Chỉ thực hiện đúng một prompt được chỉ định tại `NEXT_PROMPT`.
- Không thực hiện prompt khác trong cùng lượt, kể cả khi còn thời gian.
- Kiểm tra đúng repository, nhánh và Git status trước khi làm.
- Nếu dependency chưa `APPROVED`, dừng và báo rõ.
- Khi bắt đầu, cập nhật prompt thành `IN_PROGRESS`.
- Thực hiện đầy đủ phạm vi, kiểm thử và kiểm tra an toàn.
- Tạo `reports/<PROMPT_ID>.md` theo `templates/PHASE-REPORT.md`.
- Nếu đạt, đặt trạng thái `PASS_PENDING_APPROVAL` và `NEXT_PROMPT: WAITING_FOR_APPROVAL`.
- Nếu không đạt, đặt `FAIL` hoặc `BLOCKED` và giữ nguyên prompt cần xử lý.
- Không tự đánh dấu `APPROVED`.
- Không tự chuyển sang prompt kế tiếp.
- Sau khi báo cáo, dừng hoàn toàn và yêu cầu người dùng dùng câu:

  `TÔI DUYỆT PROMPT <PROMPT_ID>`

Khi nhận một câu duyệt:

- Xác minh ID đúng prompt đang `PASS_PENDING_APPROVAL`.
- Đọc lại báo cáo.
- Ghi trạng thái `APPROVED` và lịch sử phê duyệt.
- Chọn prompt kế tiếp có dependency đầy đủ.
- Thực hiện đúng một prompt kế tiếp rồi lại dừng tại gate.

Không được hiển thị secret, dùng nhầm production, deploy hoặc ghi production ngoài gate quy định. Prompt `12B` còn yêu cầu các câu xác nhận production riêng trong `GOVERNANCE.md`.

Bắt đầu bằng cách đọc runbook và thực hiện `NEXT_PROMPT` hiện tại.
