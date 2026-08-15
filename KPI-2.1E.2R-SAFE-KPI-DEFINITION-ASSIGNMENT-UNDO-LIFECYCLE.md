# KPI-2.1E.2R - Safe KPI Definition/Assignment Undo Lifecycle

Ngay thuc hien: 2026-08-15

## 1. Ket luan

PASS co ghi chu. Backend, frontend, staging API/UI, migration production va read-back deu dat. Mot regression Auth Identity cu bi treo tai phep thu concurrent LINK tren staging; fixture da duoc don sach va khong lien quan den RPC KPI cua phase nay.

## 2. Van de cu

UI dung tu "Xoa gan" va "Tat" mo ho. Nguoi quan ly kho phan biet giua go KPI khoi mot nhan vien, xoa KPI khoi bo danh muc va ngung su dung KPI nhung van giu lich su.

## 3. Chinh sach nghiep vu

- Go KPI chi ap dung cho assignment thuoc ky DRAFT va chua co du lieu phat sinh.
- Xoa KPI chi ap dung cho definition chua tung duoc su dung.
- KPI da tung duoc su dung chi duoc Ngung su dung; snapshot va lich su duoc giu nguyen.
- ACTIVE/CLOSED khong cho go assignment.

## 4. Audit backend

FK runtime den assignment deu RESTRICT. Cac RPC cau hinh da co role guard, row lock va version check. Config mutation khong dung idempotency ledger; voi thao tac xoa mot lan, row lock, optimistic version va ket qua not-found khi lap lai la contract phu hop.

## 5. Go assignment

RPC `crm_kpi_remove_draft_assignment` khoa assignment truoc, khoa period sau, kiem tra role, lifecycle, version va moi bang runtime. Audit va delete nam trong cung transaction.

## 6. Xoa definition

`crm_kpi_delete_unused_definition` duoc harden: khoa definition, kiem tra version va tu choi neu con assignment/submission/event/evidence lien quan.

## 7. Ngung su dung

Van dung `crm_kpi_set_definition_active`. Definition bi tat khong con xuat hien trong dropdown gan moi, nhung snapshot assignment cu khong thay doi.

## 8. Lifecycle ky KPI

DRAFT cho phep sua/go khi sach. ACTIVE va CLOSED tu choi go truc tiep. Migration khong kich hoat, dong hay xoa ky KPI.

## 9. Quyen

Chi manager/admin/owner qua `crm_kpi_is_business_manager()` duoc go assignment hay xoa definition. Sale va anonymous bi chan. Frontend chi hien control cau hinh cho role phu hop.

## 10. Thay doi backend

- Them `crm_kpi_remove_draft_assignment`.
- Giu alias `crm_kpi_delete_draft_assignment` de client cu nhan cung guard moi.
- Harden `crm_kpi_delete_unused_definition`.
- Revoke PUBLIC/anon, grant authenticated.

## 11. Migration va hash

File: `supabase-phase-kpi21e2r-safe-kpi-undo.sql`

SHA256: `D3B3F15D20205319039B4E4CADA876B698204FDC60FFF5218B538AF5FDDE4C13`

## 12. Frontend

Employee detail va matrix DRAFT co nut `Chinh sua` va `Go KPI`. Drawer cho phep sua target/trang thai tinh diem. Bo KPI dung nhan `Ngung su dung`, `Bat lai`, `Xoa KPI`.

## 13. Hop thoai xac nhan

Hop thoai go hien nhan vien, KPI, target, trang thai tinh diem va yeu cau ly do. Thong bao nhac ro go assignment khong xoa definition.

## 14. Audit

Action `assignment_remove_draft` luu actor theo audit helper, assignment, employee, period, definition, target, score, ly do va version period. `definition_delete_unused` luu snapshot definition bi xoa.

## 15. Dependency guard

Go assignment bi tu choi neu co bat ky `kpi_submissions`, `kpi_submission_events` hoac `kpi_evidence`. FK RESTRICT la lop bao ve cuoi, khong thay cho rule nghiep vu.

## 16. Concurrency

Staging chung minh submit-vs-remove giu assignment; update-vs-remove chi co mot ben thang. Thu tu lock assignment -> period tuong thich voi submission flow.

## 17. Staging tests

- KPI-2.1E.2R integration SQL: PASS, rollback sach.
- KPI-2.1E.2R API/UI: PASS 21 checks.
- KPI-1 API: PASS 23 checks.
- KPI-2 API: PASS.
- KPI-2R.2 API: PASS.
- KPI-2.1B UI: PASS 12 checks.
- KPI-2.1E API/UI: PASS.

## 18. Direct API

Sale remove/delete/deactivate bi tu choi. Manager direct DELETE table bi chan. Manager chi thao tac qua RPC nghiep vu.

## 19. Assignment flow

Manager mo ho so nhan vien -> Chinh sua hoac Go KPI -> server kiem tra role/version/lifecycle/dependency -> audit va mutation atomic -> frontend reload read-back.

## 20. Definition flow

Definition chua dung co the xoa. Definition da dung khong co nut xoa va RPC cung tu choi; manager co the Ngung su dung.

## 21. Regression

Static P0-A, P0-B, Auth, KPI-1, KPI-2, KPI-2R.2, KPI-2.1B, KPI-2.1E, KPI-2.1E.2 va KPI-2.1E.2R deu PASS. Auth staging harness cu treo o concurrent LINK; cac check truoc do PASS, fixture residue da ve 0.

## 22. Backup

Backup production: `D:\SUPABASE\BACKUPS\CRM-KOLORCERAMIC-2026-08-15-1231-PRE-KPI21E2R`.

Co `roles.sql`, `schema.sql`, `data.sql`, `SHA256.txt`, inventory production va post-migration verification. Storage inventory: `kpi-evidence` 73 objects/48,550,460 bytes; `kpi2-evidence` 0 object.

## 23. Production rollout

Migration duoc ap dung bang Supabase Management API sau khi doi chieu hash. Khong co DML nghiep vu trong migration install.

Frontend release commit: `151529ff99b9a63743931bd0f7937d14d8da9364`. GitHub/Vercel deployment status: success.

## 24. Production inventory

Sau migration: September period DRAFT version 3; 8 definitions; 2 assignments; 0 submissions; 0 events; 0 evidence. Legacy giu nguyen 8 rules va 102 proposals.

## 25. UI smoke

Production asset read-back PASS: file deploy co RPC moi, nhan `Go KPI`, `Ngung su dung` va action sua assignment. Anonymous RPC smoke bi chan dung. Con can nguoi dung that xac nhan: manager/admin thay control moi; sale khong thay; go/sua tren mot fixture DRAFT sach; definition va nhan vien van con; ACTIVE/CLOSED va definition da dung bi chan.

## 26. Gioi han

Hai RPC cu de sua target va score la hai mutation rieng. Frontend reload server state neu mutation sau loi, nhung day khong phai mot RPC edit gom. Phase nay khong redesign KPI va khong thay September assignment that.

## 27. September readiness

Migration khong tao/xoa assignment thang 09. Hai assignment dang co duoc giu nguyen. Chi bat dau final assignment sau khi UI smoke production dat.

## 28. Khuyen nghi buoc tiep

Hoan tat frontend deploy va real-role smoke. Sau PASS, dung UI moi de sua/go cac cau hinh test sai; sau do moi tiep tuc September Employee Assignment & Target Finalization.
