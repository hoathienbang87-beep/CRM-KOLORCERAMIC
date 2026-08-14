# KPI-2.1E.2 - Xoa an toan cau hinh KPI DRAFT

Ngay thuc hien: 14/08/2026.

## Ket qua

- Admin/manager/owner active co the xoa ky KPI `DRAFT` tao sai.
- Co the xoa assignment thuoc ky `DRAFT` neu chua co submission/evidence.
- Co the xoa definition neu definition chua tung duoc gan.
- Sale va anonymous khong co quyen xoa.
- Ky `ACTIVE/CLOSED` va cau hinh da co du lieu van hanh khong duoc xoa.
- Moi thao tac xoa duoc ghi vao `audit_logs` trong cung PostgreSQL transaction.

## RPC moi

- `crm_kpi_delete_draft_assignment(uuid, integer, integer)`
- `crm_kpi_delete_draft_period(uuid, integer)`
- `crm_kpi_delete_unused_definition(uuid, integer)`

Ca ba RPC dung `SECURITY DEFINER`, khoa `search_path=public`, tu kiem tra role/lifecycle va version. Frontend khong gui role de backend tin theo.

## Du lieu test thang 09

Owner xac nhan period, definition, target `10/5/5`, score flag va evidence rule truoc do chi la du lieu test va co the xoa.

Production cleanup da thuc hien atomic:

- Period test `cecedb1f-bb9e-4296-a272-b69b9be82e2b`: da xoa.
- 3 assignment thuoc period: da xoa.
- Definition test `d29b1ec3-df5d-4b3e-99a7-95e14f92dc61`: da xoa.
- Residue: `0/0/0`.
- Audit: `period_delete_draft=1`, `definition_delete_unused=1`.
- Legacy KPI giu nguyen: 8 rules, 102 proposals.

## Backup

Backup production truoc thay doi:

`D:\SUPABASE\BACKUPS\CRM-KOLORCERAMIC-2026-08-14-2036-PRE-KPI21E2`

Database dump PASS voi `roles.sql`, `schema.sql`, `data.sql` va `SHA256.txt`. Storage chi inventory; binary object khong thay doi trong phase nay.

## Test evidence

- Static contract: PASS 24 checks.
- Staging PostgreSQL integration (rollback): PASS.
- Production PostgreSQL integration (rollback): PASS.
- KPI-2.1B staging UI regression: PASS 12 checks.
- Duplicate HTML ID: PASS.
- Existing KPI-1/KPI-2/KPI-2.1B/KPI-2.1E static suites: PASS.

## Rollback

Neu can rollback code, revert commit frontend. Neu can rollback schema, revoke EXECUTE va drop ba RPC moi; khong can restore data van hanh.

Du lieu test da xoa chi phuc hoi tu backup khi owner thuc su muon lay lai du lieu test. Khong tu dong restore.
