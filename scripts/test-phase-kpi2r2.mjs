import fs from "node:fs";

const sql = fs.readFileSync("supabase-phase-kpi2r2-evidence-staged-lifecycle.sql", "utf8");
const app = fs.readFileSync("js/features/crm-app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("css/styles.css", "utf8");
let checks = 0;
function check(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}
function functionBody(name) {
  const match = sql.match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$\\$;`, "i"));
  return match?.[0] || "";
}

check(/^begin;/im.test(sql) && /^commit;/im.test(sql), "Forward-fix must be transactional.");
check(!/drop\s+table|truncate\s+table|delete\s+from\s+public\.(kpi_rules|kpi_proposals)/i.test(sql), "Forward-fix must not mutate legacy KPI.");
for (const column of ["discard_requested_at", "discarded_at", "discard_requested_by_user_id"]) {
  check(new RegExp(`add column if not exists ${column}`, "i").test(sql), `Missing ${column}.`);
}
check(/kpi_evidence_discard_shape_check/i.test(sql), "Discard transition constraint missing.");
check(/kpi_evidence_discard_pending_idx/i.test(sql), "Pending discard index missing.");

const requestRpc = functionBody("crm_kpi_request_discard_staged_evidence");
const finalizeRpc = functionBody("crm_kpi_finalize_discard_staged_evidence");
for (const [name, body] of [["request", requestRpc], ["finalize", finalizeRpc]]) {
  check(body.length > 0, `${name} RPC missing.`);
  check(/security definer/i.test(body), `${name} RPC must be SECURITY DEFINER.`);
  check(/set search_path = public, storage/i.test(body), `${name} RPC must lock search_path.`);
  check(/auth\.uid\(\) is null/i.test(body), `${name} RPC must require auth.uid().`);
  check(/supabase_auth_id = auth\.uid\(\)/i.test(body), `${name} RPC must bind Auth to app_users.`);
  check(/lower\(coalesce\(v_actor_row\.role, ''\)\) <> 'sale'/i.test(body), `${name} RPC must be Sale-only.`);
  check(/lifecycle_status/i.test(body) && /active/i.test(body), `${name} RPC must require active lifecycle.`);
  check(/crm_kpi_payload_hash/i.test(body) && /crm_kpi_idempotent_response/i.test(body), `${name} RPC must use payload-bound idempotency.`);
  check(/pg_advisory_xact_lock/i.test(body), `${name} RPC must serialize same request.`);
  check(/for update/i.test(body), `${name} RPC must row-lock evidence.`);
}
check(/DISCARD_STAGED_EVIDENCE_REQUEST/.test(requestRpc), "Request action key missing.");
check(/status <> 'STAGED'/i.test(requestRpc), "Request must only accept STAGED.");
check(/event_id is not null|v_evidence\.event_id is not null/i.test(requestRpc), "Request must reject attached event FK.");
check(/lock_version <> p_expected_lock_version/i.test(requestRpc), "Request optimistic lock missing.");
check(/object_path not like 'kpi2\/'/i.test(requestRpc), "Canonical object path validation missing.");
check(/set status = 'ARCHIVED'/i.test(requestRpc), "Request must archive before Storage delete.");
check(/evidence_discard_requested/i.test(requestRpc), "Request audit missing.");
check(/KPI_EVIDENCE_STORAGE_OBJECT_PRESENT/i.test(finalizeRpc), "Finalize must fail while Storage object exists.");
check(/delete from public\.kpi_evidence/i.test(finalizeRpc), "Finalize must remove metadata only after object absence check.");
check(/evidence_discarded/i.test(finalizeRpc), "Finalize audit missing.");
check(/metadataDeleted/i.test(finalizeRpc), "Finalize response must disclose metadata completion.");
check(/revoke all on function public\.crm_kpi_request_discard_staged_evidence[\s\S]*from public, anon, authenticated/i.test(sql), "Request grants must fail closed.");
check(/grant execute on function public\.crm_kpi_request_discard_staged_evidence[\s\S]*to authenticated/i.test(sql), "Request execute grant missing.");
check(/e\.status in \('STAGED', 'ATTACHED'\)/i.test(sql), "Archived objects must not remain signable.");
check(/storage\.allow_any_operation\(array\[[\s\S]*'object\.delete'[\s\S]*'object\.delete_many'/i.test(sql), "Archived SELECT must be limited to Storage delete operations.");
check(/e\.status = 'ARCHIVED'/i.test(sql) && /e\.discarded_at is null/i.test(sql), "Storage delete must require pending archived metadata.");
check(/e\.discard_requested_by_user_id = public\.crm_current_app_user_id\(\)/i.test(sql), "Storage delete must require requesting owner.");
check(/e\.object_path like 'kpi2\/' \|\| public\.crm_current_app_user_id\(\)/i.test(sql), "Storage delete must enforce canonical owner path.");

check(/id="kpi2StagedEvidenceList"/.test(html), "Staged evidence UI list missing.");
check(/kpi2-staged-evidence-item/.test(css), "Staged evidence UI styles missing.");
check(/handleKpi2EvidenceFiles/.test(app), "Evidence input staging handler missing.");
check(/data-kpi2-discard-evidence/.test(app), "Remove staged evidence action missing.");
check(/crm_kpi_request_discard_staged_evidence/.test(app), "Frontend request-discard RPC missing.");
check(/\.storage\.from\(KPI2_EVIDENCE_BUCKET\)\.remove/.test(app), "Frontend Storage delete step missing.");
check(/crm_kpi_finalize_discard_staged_evidence/.test(app), "Frontend finalize-discard RPC missing.");
check(app.indexOf("crm_kpi_request_discard_staged_evidence") < app.indexOf(".storage.from(KPI2_EVIDENCE_BUCKET).remove") && app.indexOf(".storage.from(KPI2_EVIDENCE_BUCKET).remove") < app.indexOf("crm_kpi_finalize_discard_staged_evidence"), "Frontend discard step order is unsafe.");
check(/Bạn có muốn hủy/.test(app), "Cancel form prompt missing.");
check(/active\.length\+files\.length>2/.test(app), "Upload replacement/max-two guard missing.");
check(/pendingDiscard/.test(app), "Submit must block while discard is incomplete.");
check(!/service_role|sb_secret_/i.test(app), "Frontend must not include privileged key paths.");

console.log(`KPI-2R.2 static contract: PASS (${checks} checks)`);
