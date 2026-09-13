# CRM-KOLORCERAMIC — KPI Maintenance M1B

## Result

**GO for review/staging of the isolated maintenance migration. Production apply remains gated.**

- Production audit was performed inside read-only transactions.
- Production rows written, updated, or deleted by M1B: **0**.
- No deploy, mapping patch, schema rollout, or feature rollout was performed.
- A disposable local database was rebuilt and used for reproduction. Test fixtures were rolled back.

Timestamps below are database UTC unless explicitly marked ICT (`Asia/Ho_Chi_Minh`). Names and IDs needed for the audit are shown; email, phone, address, evidence object path, and other unnecessary PII are omitted.

## 1. Current production assignment count

The September 2026 period (`aeef3880-013e-43fc-83fc-eeea888fe2df`) is `ACTIVE`. It has exactly **25 `ASSIGNED` rows**.

The readiness evidence recorded exactly **21** rows with this KPI distribution:

`CUSTOMER_CARE 4`, `DISPLAY_RACK 2`, `DOANH_SO 3`, `KTS_NEW 3`, `PROJECT_DEVELOPMENT 3`, `SHOWROOM_INVITE 3`, `SOCIAL_VIDEO 3`.

Current production is:

`CUSTOMER_CARE 4`, `DISPLAY_RACK 3`, `DOANH_SO 3`, `KTS_NEW 4`, `PROJECT_DEVELOPMENT 4`, `SHOWROOM_INVITE 3`, `SOCIAL_VIDEO 4`.

Therefore the exact delta is one new row in each of `DISPLAY_RACK`, `KTS_NEW`, `PROJECT_DEVELOPMENT`, and `SOCIAL_VIDEO`.

### All 25 active September assignments

Audit/source abbreviations:

- `MGR/OPTIONS`: `assigned_by_user_id=Z9e4TxM6I8dkmYYx9vo0wFIiiWf1` (Boss Ngân, manager); a later `ACTIVE_ASSIGNMENT_OPTIONS_CHANGED` audit exists at `2026-09-12 23:48:18.699458Z`, reason `Owner-approved customer relation mapping`. It is not claimed as the creation audit.
- `MGR/NO-CREATE-AUDIT`: same manager actor on the row; no assignment-entity audit row was found.
- `MGR/ADD`: same manager actor; exact `ACTIVE_ASSIGNMENT_ADDED` audit exists at the row timestamp, reason `Doanh thu trong tháng`.
- `OWNER/TEST`: `assigned_by_user_id=vFtpyU2bZKZvJ66fzGWyFgDj9mo1` (Thiên Di, owner); exact `ACTIVE_ASSIGNMENT_ADDED` audit exists at the row timestamp, reason `test`.

In the table, `same` in `updated_at` means the exact timestamp is identical to the `created_at` value shown in that row.

| # | assignment_id | employee/user | definition_id | KPI code / name | created_at | updated_at | snapshot mode | audit/source |
|---:|---|---|---|---|---|---|---|---|
| 1 | `53d36e27-4a62-4289-8c27-5c66964b23a7` | Mỹ Trâm (`5f7276eb-804a-4a34-942b-be87ce9cb0ba`) | `a2fc7c22-d999-4af0-99ec-073359d6c83c` | `CUSTOMER_CARE` / Chăm sóc khách hàng cũ | `2026-09-11 04:40:48.808213Z` | `2026-09-11 04:41:07.960854Z` | `REQUIRED` | MGR/OPTIONS |
| 2 | `ba817b50-ad0b-4993-8a20-09c50130dd82` | Hoài Châu (`fa9a68ae-99ae-4d16-8aa8-c56498db9d51`) | `a2fc7c22-d999-4af0-99ec-073359d6c83c` | `CUSTOMER_CARE` / Chăm sóc khách hàng cũ | `2026-09-11 04:40:48.808213Z` | `2026-09-11 04:41:07.960854Z` | `REQUIRED` | MGR/OPTIONS |
| 3 | `1cd86b67-500c-47e0-93c1-39af2aae5e63` | Danh Băng Tâm (`2nLbeTz36HevkpPwcp0ewSAXoVX2`) | `a2fc7c22-d999-4af0-99ec-073359d6c83c` | `CUSTOMER_CARE` / Chăm sóc khách hàng cũ | `2026-09-11 04:41:07.960854Z` | `2026-09-11 04:41:07.960854Z` | `REQUIRED` | MGR/OPTIONS |
| 4 | `885997a9-d11b-40c9-aeca-e9b40048bf88` | Mỹ Trâm (`5f7276eb-804a-4a34-942b-be87ce9cb0ba`) | `3fde6bd6-fd5e-4cb0-8831-20212c208b45` | `DISPLAY_RACK` / Trưng bày kệ chip cho VP Thiết kế/KTS | `2026-09-11 04:41:45.031859Z` | same | `REQUIRED` | MGR/OPTIONS |
| 5 | `bafcc44e-4033-47aa-ae1a-34d71db8dc2d` | Hoài Châu (`fa9a68ae-99ae-4d16-8aa8-c56498db9d51`) | `3fde6bd6-fd5e-4cb0-8831-20212c208b45` | `DISPLAY_RACK` / Trưng bày kệ chip cho VP Thiết kế/KTS | `2026-09-11 04:41:45.031859Z` | same | `REQUIRED` | MGR/OPTIONS |
| 6 | `82d61fa1-c1fc-4ebd-897e-068900f5e985` | Danh Băng Tâm (`2nLbeTz36HevkpPwcp0ewSAXoVX2`) | `1e46bd50-48e3-462c-864a-5aac07271e0c` | `KTS_NEW` / VP KTS mới | `2026-09-11 04:42:07.546848Z` | same | `REQUIRED` | MGR/OPTIONS |
| 7 | `a21b0de3-7e5e-434c-b192-9df0fe8bf34a` | Hoài Châu (`fa9a68ae-99ae-4d16-8aa8-c56498db9d51`) | `1e46bd50-48e3-462c-864a-5aac07271e0c` | `KTS_NEW` / VP KTS mới | `2026-09-11 04:42:07.546848Z` | same | `REQUIRED` | MGR/OPTIONS |
| 8 | `aa70b64d-3c75-43d4-9e9d-5d466aafc970` | Mỹ Trâm (`5f7276eb-804a-4a34-942b-be87ce9cb0ba`) | `1e46bd50-48e3-462c-864a-5aac07271e0c` | `KTS_NEW` / VP KTS mới | `2026-09-11 04:42:07.546848Z` | same | `REQUIRED` | MGR/OPTIONS |
| 9 | `20434fba-5b91-4d1d-a3c4-3f361ad74117` | Hoài Châu (`fa9a68ae-99ae-4d16-8aa8-c56498db9d51`) | `22649bf9-3d7b-4d24-a286-d8066ddfd46e` | `PROJECT_DEVELOPMENT` / Khai thác công trình | `2026-09-11 04:42:35.146243Z` | same | `REQUIRED` | MGR/OPTIONS |
| 10 | `5667dd03-0fe3-4ee2-8e30-6b75b6ee8f34` | Mỹ Trâm (`5f7276eb-804a-4a34-942b-be87ce9cb0ba`) | `22649bf9-3d7b-4d24-a286-d8066ddfd46e` | `PROJECT_DEVELOPMENT` / Khai thác công trình | `2026-09-11 04:42:35.146243Z` | same | `REQUIRED` | MGR/OPTIONS |
| 11 | `86fdff53-2de8-4f35-8852-1ecc9aef45d6` | Danh Băng Tâm (`2nLbeTz36HevkpPwcp0ewSAXoVX2`) | `22649bf9-3d7b-4d24-a286-d8066ddfd46e` | `PROJECT_DEVELOPMENT` / Khai thác công trình | `2026-09-11 04:42:35.146243Z` | same | `REQUIRED` | MGR/OPTIONS |
| 12 | `3209cddb-eeb8-4f38-89b1-e7c12b90be1d` | Mỹ Trâm (`5f7276eb-804a-4a34-942b-be87ce9cb0ba`) | `a5343d0b-c353-40ed-beac-d62fe32f06fb` | `SHOWROOM_INVITE` / Mời khách hàng về showroom | `2026-09-11 04:42:59.014212Z` | same | `REQUIRED` | MGR/OPTIONS |
| 13 | `6b7d2bd6-01fa-43b4-8a49-f8d86c146dc2` | Danh Băng Tâm (`2nLbeTz36HevkpPwcp0ewSAXoVX2`) | `a5343d0b-c353-40ed-beac-d62fe32f06fb` | `SHOWROOM_INVITE` / Mời khách hàng về showroom | `2026-09-11 04:42:59.014212Z` | same | `REQUIRED` | MGR/OPTIONS |
| 14 | `deb295bb-a362-4b65-9a90-6e38ce4b2a16` | Hoài Châu (`fa9a68ae-99ae-4d16-8aa8-c56498db9d51`) | `a5343d0b-c353-40ed-beac-d62fe32f06fb` | `SHOWROOM_INVITE` / Mời khách hàng về showroom | `2026-09-11 04:42:59.014212Z` | same | `REQUIRED` | MGR/OPTIONS |
| 15 | `2658eefb-fe86-4a5b-afb5-03e0eed46e13` | Hoài Châu (`fa9a68ae-99ae-4d16-8aa8-c56498db9d51`) | `3822fa10-5e3a-4b08-a65d-daa40ed01508` | `SOCIAL_VIDEO` / Đăng video kênh online/social | `2026-09-11 04:43:53.575335Z` | same | `NONE` | MGR/NO-CREATE-AUDIT |
| 16 | `2ae952e9-042c-4147-9b61-efbb87cc2331` | Danh Băng Tâm (`2nLbeTz36HevkpPwcp0ewSAXoVX2`) | `3822fa10-5e3a-4b08-a65d-daa40ed01508` | `SOCIAL_VIDEO` / Đăng video kênh online/social | `2026-09-11 04:43:53.575335Z` | same | `NONE` | MGR/NO-CREATE-AUDIT |
| 17 | `aaaf073f-a3f7-433c-9bf7-32f46c0c6710` | Mỹ Trâm (`5f7276eb-804a-4a34-942b-be87ce9cb0ba`) | `3822fa10-5e3a-4b08-a65d-daa40ed01508` | `SOCIAL_VIDEO` / Đăng video kênh online/social | `2026-09-11 04:43:53.575335Z` | same | `NONE` | MGR/NO-CREATE-AUDIT |
| 18 | `592db763-fe2a-427d-9f9e-1c5ad4d2a605` | Danh Băng Tâm (`2nLbeTz36HevkpPwcp0ewSAXoVX2`) | `2124107d-ff10-4d9d-b39c-48580020b267` | `DOANH_SO` / DOANH SO | `2026-09-11 04:57:08.418975Z` | same | `REQUIRED` | MGR/ADD |
| 19 | `fc4a98c5-8454-4ea5-8cda-f30626bd7798` | Hoài Châu (`fa9a68ae-99ae-4d16-8aa8-c56498db9d51`) | `2124107d-ff10-4d9d-b39c-48580020b267` | `DOANH_SO` / DOANH SO | `2026-09-11 04:57:39.094433Z` | same | `REQUIRED` | MGR/ADD |
| 20 | `de892251-e8d1-4aa9-8601-f231bb546d62` | Mỹ Trâm (`5f7276eb-804a-4a34-942b-be87ce9cb0ba`) | `2124107d-ff10-4d9d-b39c-48580020b267` | `DOANH_SO` / DOANH SO | `2026-09-11 04:58:04.874616Z` | same | `REQUIRED` | MGR/ADD |
| 21 | `a5d7250b-d32e-4e8f-a7c1-0202055200c3` | designated TEST Sale (`e989e233-2789-44ab-9010-925ba2a31e82`) | `a2fc7c22-d999-4af0-99ec-073359d6c83c` | `CUSTOMER_CARE` / Chăm sóc khách hàng cũ | `2026-09-12 06:52:39.824083Z` | same | `REQUIRED` | OWNER/TEST; period version before new delta |
| 22 | `718f651c-c5d9-4045-9a87-32c6ed011c6b` | designated TEST Sale (`e989e233-2789-44ab-9010-925ba2a31e82`) | `3fde6bd6-fd5e-4cb0-8831-20212c208b45` | `DISPLAY_RACK` / Trưng bày kệ chip cho VP Thiết kế/KTS | `2026-09-13 00:25:56.370378Z` | same | `REQUIRED` | OWNER/TEST; periodVersion `16` |
| 23 | `9ab458af-186d-42dd-96d6-0dfaa3ceb212` | designated TEST Sale (`e989e233-2789-44ab-9010-925ba2a31e82`) | `1e46bd50-48e3-462c-864a-5aac07271e0c` | `KTS_NEW` / VP KTS mới | `2026-09-13 00:26:04.924695Z` | same | `REQUIRED` | OWNER/TEST; periodVersion `17` |
| 24 | `f7138f76-c056-4edc-8b7e-a1717c9af6a9` | designated TEST Sale (`e989e233-2789-44ab-9010-925ba2a31e82`) | `3822fa10-5e3a-4b08-a65d-daa40ed01508` | `SOCIAL_VIDEO` / Đăng video kênh online/social | `2026-09-13 00:26:12.518282Z` | same | `NONE` | OWNER/TEST; periodVersion `18` |
| 25 | `5e5a533c-d283-47f0-a009-38d1dc3c4e27` | designated TEST Sale (`e989e233-2789-44ab-9010-925ba2a31e82`) | `22649bf9-3d7b-4d24-a286-d8066ddfd46e` | `PROJECT_DEVELOPMENT` / Khai thác công trình | `2026-09-13 00:26:25.861433Z` | same | `REQUIRED` | OWNER/TEST; periodVersion `19` |

## 2–4. Exact four new assignments, actor/source/timestamp, classification

| assignment_id | KPI | created at ICT | actor | audited source | classification |
|---|---|---|---|---|---|
| `718f651c-c5d9-4045-9a87-32c6ed011c6b` | `DISPLAY_RACK` | `2026-09-13 07:25:56.370378+07` | Owner `vFtpyU2bZKZvJ66fzGWyFgDj9mo1` | `ACTIVE_ASSIGNMENT_ADDED`, reason `test`, periodVersion 16 | EXPECTED TEST ARTIFACT |
| `9ab458af-186d-42dd-96d6-0dfaa3ceb212` | `KTS_NEW` | `2026-09-13 07:26:04.924695+07` | same Owner | same, periodVersion 17 | EXPECTED TEST ARTIFACT |
| `f7138f76-c056-4edc-8b7e-a1717c9af6a9` | `SOCIAL_VIDEO` | `2026-09-13 07:26:12.518282+07` | same Owner | same, periodVersion 18 | EXPECTED TEST ARTIFACT |
| `5e5a533c-d283-47f0-a009-38d1dc3c4e27` | `PROJECT_DEVELOPMENT` | `2026-09-13 07:26:25.861433+07` | same Owner | same, periodVersion 19 | EXPECTED TEST ARTIFACT |

All four target the already designated TEST Sale, were added sequentially by the Owner, and carry the exact audited reason `test`. The audit action is emitted uniquely by `crm_kpi_assign_employee_r3` for an ACTIVE period. The production Admin UI also calls that RPC. The audit payload has no `rpc` or `source` field, so it proves the canonical RPC path but cannot distinguish UI invocation from a direct RPC call. No unsupported inference is made.

**Mandatory: Were the four extra assignments intentionally created for TEST smoke? YES.** Evidence: designated TEST employee, Owner actor, four sequential `ACTIVE_ASSIGNMENT_ADDED` audits, exact reason `test`, and period versions 16–19.

## 5. Current submission/Event classification

| field | read-only production evidence |
|---|---|
| submission_id | `f213f569-a08f-4318-948b-4248d1899376` |
| Event id | `4f7455d8-38a5-447b-8c9a-905d6e62f5b9` |
| actor | designated TEST Sale `e989e233-2789-44ab-9010-925ba2a31e82` |
| assignment | `718f651c-c5d9-4045-9a87-32c6ed011c6b`, one of the four new TEST assignments |
| KPI | `DISPLAY_RACK` / Trưng bày kệ chip cho VP Thiết kế/KTS |
| customer link | customer `ee56d8b8-2627-4a0c-a2aa-40a2d431b66f`; authoritative current assignment to the same TEST Sale exists |
| Customer TEST evidence | Customer name snapshot is `test 2`; TEST-marker predicate is true |
| Event TEST evidence | title `test`, description `test`; TEST-marker predicate is true |
| created_at | `2026-09-13 00:29:23.857035Z` (`07:29:23.857035+07`) |
| event_at | `2026-09-13 00:28:00Z` |
| status | submission `OPEN_REVIEW`; Event `PENDING`; no review audit |
| values/evidence | claimed `1`, approved value null, exactly one evidence row |
| audit chain | `evidence_stage` at `00:29:01.273964Z`; then `event_claim_create`, `evidence_attach`, and `submission_create` at `00:29:23.857035Z`, all by the TEST Sale |

Classification: **EXPECTED TEST ARTIFACT**.

**Mandatory: Is the one submission / one Event the TEST smoke artifact? YES.** It is authored by the designated TEST Sale, uses a newly created TEST assignment, links the TEST Sale's current Customer, and both Event content and Customer snapshot contain explicit TEST markers.

## 6. Definition mapping consistency

- Definitions: **9 total = 8 `REQUIRED`, 1 `NONE`, 0 `OPTIONAL`**.
- September assignments: **25 total = 21 `REQUIRED`, 4 `NONE`, 0 `OPTIONAL`**.
- The four `NONE` assignments are all `SOCIAL_VIDEO`:
  - Hoài Châu — `2658eefb-fe86-4a5b-afb5-03e0eed46e13`.
  - Danh Băng Tâm — `2ae952e9-042c-4147-9b61-efbb87cc2331`.
  - Mỹ Trâm — `aaaf073f-a3f7-433c-9bf7-32f46c0c6710`.
  - designated TEST Sale — `f7138f76-c056-4edc-8b7e-a1717c9af6a9`.
- `SOCIAL_VIDEO` assignments now: **4**.
- Additional `NONE` assignment on the TEST account for another KPI: **NO**.

## 7. Root cause of misleading 22023

Production `crm_kpi_update_definition_v2` has one function-wide handler:

```sql
exception when invalid_text_representation then
  raise exception using errcode = '22023',
    message = 'Invalid KPI numeric or boolean option.';
```

Its scope begins before the authorization check and ends after the audit write. It can therefore remap an `invalid_text_representation` raised by:

- `auth.uid()` called through `crm_kpi_is_business_manager()` or `crm_current_app_user_id()`;
- the `maxImagesPerEvent` integer cast;
- the three boolean casts;
- any UUID/text cast executed inside a called helper or audit path.

Nuance: malformed values for typed RPC parameters such as `p_definition_id uuid` can be rejected during function argument binding, before the function body, and therefore are not necessarily caught by this handler.

`customerRelationMode` itself is read as text and is not routed through the numeric or boolean parser. The misleading message is caused by the broad handler, not by relation-mode parsing.

## 8. Safe local reproduction

The disposable `local-product-r2` database was rebuilt. Inside a rolled-back transaction, local identity resolution was temporarily replaced with the production `auth.uid()`-based helper.

1. Legitimate UUID JWT subject + `{"customerRelationMode":"REQUIRED"}`: **PASS**, result `REQUIRED`.
2. Intentionally invalid non-UUID JWT subject + otherwise legitimate relation payload against the unpatched function: **reproduced** as `22023 Invalid KPI numeric or boolean option.`
3. After the maintenance migration, the same invalid subject remains the originating `22P02 invalid input syntax for type uuid`; it is no longer disguised.
4. Invalid relation mode: `22023 Invalid customer relation mode.`
5. Invalid `maxImagesPerEvent`: `22023 Invalid KPI numeric option: maxImagesPerEvent.`
6. Invalid `evidenceRequired`, `locationRequired`, and `timestampRequired`: field-specific boolean messages.
7. Existing customer-linked Event A–O integration: **PASS** after the migration, including assignment snapshot freeze.
8. KPI-2 static contract: **PASS (172 checks)**.

## 9. Proposed minimal hardening

Artifact: `supabase-maintenance-m1b-kpi-definition-rpc-error-hardening.sql`.

- Remove only the function-wide remap.
- Keep relation mode's two accepted aliases and the three approved values.
- Split relation-mode validation from generic KPI configuration validation.
- Parse `maxImagesPerEvent` in a narrow block that maps only its own cast failures.
- Parse each boolean in its own narrow block with the field named in the error.
- Preserve unrelated `invalid_text_representation` errors unchanged.
- Preserve authorization call, `SECURITY DEFINER`, `search_path=public`, audit payload, function signature, authenticated grant, and anon denial.
- Do not touch schema, assignment mapping, Sale/Manager UI, RLS, snapshot semantics, or KPI business semantics.

Test artifact: `scripts/test-maintenance-m1b-kpi-definition-rpc.sql`.

## 10. Is a code change justified?

**YES.** The root cause is reproducible, and the patch is isolated and deterministic. It changes diagnostic routing only; accepted numeric/boolean parsing behavior and KPI semantics remain unchanged.

## 11. Production writes performed

**0.** All production SQL was wrapped in read-only transactions. No production update, delete, insert, migration, RPC mutation, or deploy was executed.

Disposable local writes were limited to rebuilding the named local stack and applying the maintenance artifact locally. Reproduction fixtures and temporary identity-helper replacement were rolled back.

## 12. GO / BLOCKED

**GO** for Owner/code review and a separately authorized staging run of the maintenance migration.

**BLOCKED** for production apply by the explicit M1B stop gate. No production rollout should occur from this task.

## Mandatory deletion decision

**Should any production rows be deleted now? NO — not before explicit Owner approval after audit.** The five assignments on the designated TEST Sale and the one submission/Event are preserved. M1B performed no deletion.
