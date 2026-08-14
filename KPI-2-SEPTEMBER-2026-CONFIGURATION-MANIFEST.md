# KPI-2 September 2026 Configuration Manifest

> **SUPERSEDED / TEST CONFIG DELETED (14/08/2026):** Owner da xac nhan toan bo period, definition, target `10/5/5`, score flag va evidence rule trong manifest nay chi la du lieu test. Cau hinh da duoc xoa an toan qua RPC KPI-2.1E.2; residue period/assignment/definition la `0/0/0`. File nay chi giu lai de audit, khong duoc dung lam cau hinh cutover.

Thời điểm kiểm kê: 14/08/2026. Trạng thái review chung: **PENDING OWNER REVIEW**.

## Period

| Thuộc tính | Giá trị |
|---|---|
| Period ID | `cecedb1f-bb9e-4296-a272-b69b9be82e2b` |
| Tháng | `2026-09-01` |
| Tên | KPI tháng 09/2026 |
| Trạng thái | `DRAFT` |
| Timezone | `Asia/Ho_Chi_Minh` |
| Bắt đầu | `2026-09-01 00:00:00 +07:00` |
| Kết thúc | `2026-10-01 00:00:00 +07:00` |
| Người tạo | Thiên Di - `hoathienbang87@gmail.com` - admin |
| Thời gian tạo | `2026-08-14 19:52:00 +07:00` |
| Review | `PENDING OWNER REVIEW` |

## Canonical definition

| Thuộc tính | Giá trị |
|---|---|
| Definition ID | `d29b1ec3-df5d-4b3e-99a7-95e14f92dc61` |
| Code | `CSKH` |
| Tên | Chăm sóc khách hàng cũ |
| Mục đích hiện nhập | Liên hệ và chăm sóc khách hàng cũ |
| Type | `HYBRID` |
| Source adapter | Không có (`source_metric_key=null`) |
| Submission | `EVENT_CLAIM` |
| Aggregation | `COUNT` |
| Unit | lượt |
| Evidence | Bắt buộc |
| Tối đa ảnh/event | 1 |
| Location | Không bắt buộc |
| Timestamp | Bắt buộc |
| Active | Có |
| Version | 1 |
| Thời gian tạo | `2026-08-14 19:54:41 +07:00` |
| Review | `PENDING OWNER REVIEW` |

Lưu ý cần owner xác nhận: `HYBRID` hiện không gắn source adapter, nên hoạt động thực tế vẫn dựa trên event claim thủ công. Không có adapter tự động nào được bật.

## Assignment mapping

| Nhân viên | Employee ID | Assignment ID | Definition ID | Target | Score enabled | Trạng thái review |
|---|---|---|---|---:|---|---|
| Danh Băng Tâm | `2nLbeTz36HevkpPwcp0ewSAXoVX2` | `bd137f73-9c12-4a64-96c4-f9860aa73ee3` | `d29b1ec3-df5d-4b3e-99a7-95e14f92dc61` | 10 | `true` | `PENDING OWNER REVIEW` |
| Mỹ Trâm | `5f7276eb-804a-4a34-942b-be87ce9cb0ba` | `5f3bc816-f5db-43cf-8e03-8e1f40a6ca3a` | `d29b1ec3-df5d-4b3e-99a7-95e14f92dc61` | 5 | `true` | `PENDING OWNER REVIEW` |
| Thien Di Tran | `e989e233-2789-44ab-9010-925ba2a31e82` | `ba471f9e-fa04-4176-8d8b-49fa65da8df3` | `d29b1ec3-df5d-4b3e-99a7-95e14f92dc61` | 5 | `true` | `PENDING OWNER REVIEW` |

Các assignment được tạo lúc `2026-08-14 19:56:51 +07:00` bởi admin Thiên Di. Mỗi assignment có definition snapshot version 1.

## Safety state

- Active Sale: 3.
- Assignment: 3.
- Sale có 0 assignment: 0.
- Duplicate assignment group: 0.
- Missing definition snapshot: 0.
- September submission/event/evidence: `0/0/0`.
- Period vẫn `DRAFT`, chưa activate.
- Legacy vẫn 8 rules, 102 proposals, 18 pending hiển thị.

## Owner review checklist

- [ ] Xác nhận chỉ dùng một KPI `Chăm sóc khách hàng cũ` trong tháng 09 hay cần thêm KPI khác.
- [ ] Xác nhận target `10/5/5` cho ba sale.
- [ ] Xác nhận cả ba assignment đều `score_enabled=true`.
- [ ] Xác nhận `HYBRID` nhưng không có source adapter là chủ ý; nếu không, chọn lại mode phù hợp qua UI hiện có.
- [ ] Xác nhận evidence bắt buộc, tối đa 1 ảnh.
- [ ] Xác nhận timestamp bắt buộc và location không bắt buộc.
- [ ] Giữ period ở `DRAFT` cho tới đúng runbook 01/09.
