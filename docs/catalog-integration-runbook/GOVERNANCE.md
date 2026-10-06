# Governance và Stage Gate

## Nguyên tắc bắt buộc

- Làm việc trên nhánh `feat/catalog-supabase-integration`.
- Kiểm tra Git trước và sau mỗi prompt.
- Không ghi đè thay đổi không thuộc nhiệm vụ.
- Mỗi prompt chỉ xử lý một phạm vi đã mô tả.
- Không tự chuyển sang prompt kế tiếp, kể cả khi prompt hiện tại PASS.
- Không coi sự im lặng hoặc lời xác nhận mơ hồ là phê duyệt.
- Chỉ chấp nhận phê duyệt có dạng `TÔI DUYỆT PROMPT <PROMPT_ID>`.
- Codex không được tự đánh dấu `APPROVED`; trạng thái này chỉ được ghi sau thông điệp phê duyệt của người dùng.
- Mỗi prompt phải có báo cáo trong `reports/<PROMPT_ID>.md` theo mẫu.
- Commit local riêng sau mỗi prompt khi kiểm thử PASS; không push nếu chưa được yêu cầu.
- Không hiển thị hoặc commit token, JWT, service-role key, mật khẩu hay dữ liệu khách hàng.
- Không dùng production trong các prompt staging.
- Không deploy hoặc ghi production trước prompt `12B` và hai lần xác nhận được quy định tại đó.

## Môi trường integration và cloud staging

- Prompt `02A`, `02B` và ngoại lệ kỹ thuật riêng cho `03B` được phép dùng Supabase local integration chạy bằng Docker, với local URL/host/project ID được xác minh và tuyệt đối không relink production.
- Ngoại lệ `03B` chỉ dùng để kiểm thử tích hợp parser → preview → apply/rollback bằng fixture nhỏ trên local; không được nhập workbook thật hoặc coi local là cloud staging.
- Supabase local chỉ dùng cho migration, schema/RLS/RPC integration, compatibility test và ngoại lệ kiểm thử kỹ thuật `03B`; không được coi là cloud staging hoặc rehearsal trước production.
- Prompt `04`, `11A` và `11B` bắt buộc có Supabase cloud staging riêng, project ref khác production `jjeeazwlqcwynzquimeo`, trước khi bắt đầu.
- Không dùng Supabase local để thay thế cloud staging cho import dữ liệu đã duyệt, E2E, kiểm thử UI staging hoặc rehearsal trước production.

## Trạng thái prompt

- `NOT_STARTED`: chưa thực hiện.
- `IN_PROGRESS`: đang thực hiện.
- `PASS_PENDING_APPROVAL`: hoàn thành và đạt tiêu chí, đang chờ người dùng duyệt.
- `FAIL`: chưa đạt; phải sửa trong cùng prompt hoặc báo cáo blocker.
- `BLOCKED`: cần người dùng hoặc điều kiện bên ngoài.
- `APPROVED`: người dùng đã duyệt bằng câu xác nhận bắt buộc.

## Quy trình một prompt

1. Đọc `STATUS.md`, `DECISIONS.md`, prompt được chỉ định và báo cáo prompt trước.
2. Xác nhận dependency đã `APPROVED`.
3. Đổi prompt hiện tại thành `IN_PROGRESS`.
4. Thực hiện đúng phạm vi.
5. Chạy kiểm thử và kiểm tra an toàn.
6. Tạo báo cáo.
7. Nếu đạt, đổi thành `PASS_PENDING_APPROVAL`; nếu không, dùng `FAIL` hoặc `BLOCKED`.
8. Đặt `NEXT_PROMPT` thành `WAITING_FOR_APPROVAL`.
9. Dừng hoàn toàn và báo người dùng cách duyệt.

Ở lượt sau, nếu người dùng gửi đúng câu duyệt:

1. Kiểm tra ID trùng prompt đang chờ.
2. Đổi prompt đó thành `APPROVED` và ghi ngày/ghi chú vào `STATUS.md`.
3. Chọn prompt kế tiếp theo bảng dependency.
4. Thực hiện đúng một prompt kế tiếp rồi lại dừng.

## Production gate đặc biệt

Prompt `12B` chỉ được bắt đầu khi người dùng đã duyệt `12A` và gửi thêm câu:

`TÔI XÁC NHẬN CUTOVER PRODUCTION`

Sau dry-run production, Codex phải dừng lần nữa. Chỉ được ghi dữ liệu khi người dùng gửi:

`TÔI DUYỆT GHI DỮ LIỆU PRODUCTION BATCH <BATCH_ID>`
