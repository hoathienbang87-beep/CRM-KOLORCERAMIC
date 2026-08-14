import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const supersededSqlFiles = [
  "supabase-phase-kpi2-submission-review-evidence.sql",
  "supabase-phase-kpi2-reconcile-1.sql",
  "supabase-phase-kpi2-reconcile-2.sql",
  "supabase-phase-kpi2-reconcile-3.sql",
  "supabase-phase-kpi2-reconcile-4.sql",
  "supabase-phase-kpi2-remediation.sql",
  "supabase-phase-kpi2-remediation-finalize.sql"
];
const supersededParts = supersededSqlFiles.map(name => fs.readFileSync(path.join(root, name), "utf8"));
const sql = fs.readFileSync(path.join(root, "supabase-phase-kpi2-final-consolidated.sql"), "utf8");
const app = fs.readFileSync(path.join(root, "js", "features", "crm-app.js"), "utf8");
const adapter = fs.readFileSync(path.join(root, "js", "firebase.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const runbook = fs.readFileSync(path.join(root, "KPI-2-PRODUCTION-RUNBOOK.md"), "utf8");
const stagingReport = fs.readFileSync(path.join(root, "KPI-2-SUBMISSION-REVIEW-EVIDENCE.md"), "utf8");
const failures = [];
let checks = 0;

function check(condition, message) {
  checks++;
  if (!condition) failures.push(message);
}

check(/function\s+kpi2DatetimeLocalValue\b/i.test(app), "KPI event form must format datetime-local values in browser local time.");
check(!/kpi2ManualEventAt[^\n]*toISOString\(\)\.slice\(0,\s*16\)/i.test(app), "KPI event form must not write UTC text into datetime-local inputs.");

function latestFunction(name) {
  const marker = `create or replace function public.${name}`;
  const lower = sql.toLowerCase();
  const start = lower.lastIndexOf(marker.toLowerCase());
  if (start < 0) return "";
  const next = lower.indexOf("create or replace function public.", start + marker.length);
  return sql.slice(start, next < 0 ? sql.length : next);
}

check((sql.match(/^begin;$/gim) || []).length === 1 && (sql.match(/^commit;$/gim) || []).length === 1, "Consolidated KPI-2 migration must have one transaction.");
const expectedArtifactHash = "eb33f45534d96f335f494d12ba67b884d96360be5e03020092682945efdf0236";
const actualArtifactHash = crypto.createHash("sha256").update(sql).digest("hex");
check(actualArtifactHash === expectedArtifactHash, "Consolidated KPI-2 artifact SHA256 does not match the production runbook.");
check(runbook.includes(expectedArtifactHash) && stagingReport.includes(expectedArtifactHash), "Current production documents must contain the exact consolidated SHA256.");
check(/ROLL OUT ONLY AFTER FINAL PRODUCTION READINESS RE-AUDIT = READY/i.test(runbook), "Runbook must not authorize rollout before final READY re-audit.");
check(/DO NOT RUN IN PRODUCTION/i.test(stagingReport), "Staging report must mark the old migration chain as forbidden in production.");
check(!/áp dụng tuần tự năm migration nguồn/i.test(stagingReport), "Staging report still instructs production to run the five-file chain.");
for (const part of supersededParts) {
  check(/STAGING DEVELOPMENT \/ SUPERSEDED FOR PRODUCTION/i.test(part), "Every development-chain SQL file must be marked superseded.");
}
check(!/(drop|truncate)\s+table\s+(if\s+exists\s+)?public\.(kpi_rules|kpi_proposals)/i.test(sql), "Legacy KPI tables must not be dropped or truncated.");
check(!/alter\s+table\s+public\.(kpi_rules|kpi_proposals)/i.test(sql), "Legacy KPI tables must not be altered.");
check(!/delete\s+from\s+public\.(kpi_rules|kpi_proposals)/i.test(sql), "Legacy KPI rows must not be deleted.");

check(/add column if not exists aggregation_mode text not null default 'COUNT'/i.test(sql), "Definition aggregation_mode extension missing.");
check(/add column if not exists max_images_per_event integer not null default 2/i.test(sql), "Definition max-images extension missing.");
check(/add column if not exists location_required boolean not null default false/i.test(sql), "Definition location option missing.");
check(/add column if not exists timestamp_required boolean not null default true/i.test(sql), "Definition timestamp option missing.");
check(/add column if not exists score_enabled boolean not null default false/i.test(sql), "Assignment score_enabled must fail safe to false.");
check(/aggregation_mode in \('COUNT', 'SUM'\)/i.test(sql), "COUNT/SUM constraint missing.");
check(/max_images_per_event between 0 and 2/i.test(sql), "Two-image event limit missing.");

for (const table of ["kpi_submissions", "kpi_submission_events", "kpi_evidence", "kpi_action_requests", "kpi_duplicate_matches"]) {
  check(new RegExp(`create table if not exists public\\.${table}`, "i").test(sql), `Missing ${table}.`);
}
check(/status in \('PENDING', 'NEEDS_REVISION', 'APPROVED', 'REJECTED'\)/i.test(sql), "Event review statuses missing.");
check(/review_reason_code.*DUPLICATE[\s\S]*INVALID_EVIDENCE[\s\S]*MISSING_LOCATION[\s\S]*MISSING_TIMESTAMP[\s\S]*INCOMPLETE_INFORMATION[\s\S]*NOT_NEW[\s\S]*OUT_OF_SCOPE[\s\S]*OTHER/i.test(sql), "Review reason codes incomplete.");
check(/kpi_submission_events_root_dedupe_idx/i.test(sql), "Root event dedupe index missing.");
check(/kpi_submission_events_single_revision_idx/i.test(sql), "Single revision index missing.");
check(/constraint kpi_submissions_actor_request_unique unique \(submitted_by_user_id, request_id\)/i.test(sql), "Submission idempotency constraint missing.");
check(/constraint kpi_action_requests_unique unique \(actor_user_id, action, request_id\)/i.test(sql), "Action idempotency constraint missing.");
check(/status in \('STAGED', 'ATTACHED', 'QUARANTINED', 'ARCHIVED'\)/i.test(sql), "Evidence lifecycle missing.");
check(/size_bytes between 1 and 1572864/i.test(sql), "Evidence 1.5MB limit missing.");
check(/mime_type in \('image\/jpeg', 'image\/webp'\)/i.test(sql), "Evidence MIME allow-list missing.");

check(/values \('kpi2-evidence', 'kpi2-evidence', false, 1572864/i.test(sql), "Private evidence bucket configuration missing.");
check(/kpi2 evidence owner insert/i.test(sql), "Owner upload storage policy missing.");
check(/kpi2 evidence canonical read/i.test(sql), "Canonical evidence read policy missing.");
check(/kpi2 evidence staged owner delete/i.test(sql), "STAGED evidence delete policy missing.");
check(/grant select on public\.kpi_submissions, public\.kpi_submission_events, public\.kpi_evidence to authenticated/i.test(sql), "Authenticated read grant missing.");
check(/revoke all on public\.kpi_submissions, public\.kpi_submission_events, public\.kpi_evidence, public\.kpi_action_requests from public, anon, authenticated/i.test(sql), "Direct table writes must be revoked.");

const requiredRpcs = [
  "crm_kpi_create_definition_v2",
  "crm_kpi_update_definition_v2",
  "crm_kpi_update_assignment_options",
  "crm_kpi_stage_evidence",
  "crm_kpi_list_hybrid_candidates",
  "crm_kpi_submit_events",
  "crm_kpi_submit_revision",
  "crm_kpi_review_events",
  "crm_kpi_get_assignment_progress",
  "crm_kpi_get_monthly_scores",
  "crm_kpi_get_duplicate_context"
];
for (const rpc of requiredRpcs) {
  const body = latestFunction(rpc);
  check(Boolean(body), `Missing ${rpc}.`);
  check(/security definer/i.test(body), `${rpc} must use SECURITY DEFINER.`);
  check(/set search_path = public(?:, storage)?/i.test(body), `${rpc} must lock search_path.`);
  check(new RegExp(`revoke all on function public\\.${rpc}\\([\\s\\S]*?from public,\\s*anon`, "i").test(sql), `${rpc} must revoke public/anon.`);
  check(new RegExp(`grant execute on function public\\.${rpc}\\([\\s\\S]*?to authenticated`, "i").test(sql), `${rpc} must grant authenticated only.`);
}

const submit = latestFunction("crm_kpi_submit_events");
check(/request_payload_hash/i.test(sql) && /request_schema_version/i.test(sql), "Payload-bound action request columns missing.");
check(/crm_kpi_payload_hash/i.test(submit) && /crm_kpi_idempotent_response/i.test(submit), "Submit payload-bound idempotency missing.");
check(/pg_advisory_xact_lock/i.test(submit), "Submit idempotency concurrency lock missing.");
check(/for update/i.test(submit), "Submit must lock assignment/period/evidence rows.");
check(/location_required/i.test(submit) && /evidence_required/i.test(submit), "Submit fail-closed evidence/location validation missing.");
check(/possible_duplicate/i.test(submit) && /duplicate_context/i.test(submit), "Duplicate hint logic missing.");
check(/source_event_key/i.test(submit), "Event-level dedupe key missing.");
check(/crm_kpi_write_audit/i.test(submit), "Submission audit missing.");
check(/jsonb_build_object\('code',\s*'POSSIBLE_DUPLICATE'/i.test(submit), "Sale duplicate context must be opaque.");
check(!/duplicate_context[^;]*employeeId/i.test(submit), "Sale-readable duplicate context leaks employee identity.");

const review = latestFunction("crm_kpi_review_events");
check(/crm_kpi_payload_hash/i.test(review) && /crm_kpi_idempotent_response/i.test(review), "Review payload-bound idempotency missing.");
check(/order by e\.id for update/i.test(review), "Review must lock events in deterministic order.");
check(/EVENT_VERSION_CONFLICT/i.test(review), "Review optimistic locking missing.");
check(/jsonb_array_length\(p_rows\) not between 1 and 100/i.test(review), "Bulk review limit missing.");
check(/v_event\.status\s*<>\s*'PENDING'/i.test(review), "Final event immutability guard missing.");
check(/crm_kpi_refresh_submission_status/i.test(review), "Submission status refresh missing.");
check(/bulk_review/i.test(review), "Bulk review audit missing.");
check(!/to_jsonb\s*\(\s*v_event\s*\)/i.test(review), "Review audit must not serialize the full event row.");
check(!/['\"]location_snapshot['\"]\s*,/i.test(review), "Review audit must not copy location_snapshot into generic audit payload.");
check(/previousStatus/i.test(review) && /newStatus/i.test(review) && /previousLockVersion/i.test(review) && /newLockVersion/i.test(review), "Review audit trace metadata is incomplete.");
check(/locationPresent/i.test(review), "Review audit should retain only an opaque location-presence flag.");
check(/eventCount/i.test(review) && /'events',\s*v_result/i.test(review), "Bulk review audit must retain a bounded event ID/result summary.");
check(!/jsonb_build_object\([\s\S]*?['\"]response['\"]\s*,[\s\S]*?location_snapshot/i.test(review), "Action request response must not persist location snapshots.");

const revision = latestFunction("crm_kpi_submit_revision");
check(/crm_kpi_validate_event_at/i.test(revision) && /crm_kpi_validate_location/i.test(revision), "Revision canonical timestamp/location validation missing.");
check(/crm_kpi_payload_hash/i.test(revision) && /crm_kpi_idempotent_response/i.test(revision), "Revision payload-bound idempotency missing.");
check(/status\s*<>\s*'NEEDS_REVISION'/i.test(revision), "Revision status guard missing.");
check(/supersedes_event_id/i.test(revision) && /root_event_id/i.test(revision), "Append-only revision chain missing.");
check(/event_revision/i.test(revision), "Revision audit missing.");
check(!/to_jsonb\s*\(\s*v_(?:old|new|event)\s*\)/i.test(revision), "Revision audit must not serialize full event rows.");
check(!/['\"]location_snapshot['\"]\s*,/i.test(revision), "Revision audit must not copy location_snapshot into generic audit payload.");
check(/previousStatus/i.test(revision) && /newStatus/i.test(revision) && /previousLockVersion/i.test(revision) && /newLockVersion/i.test(revision), "Revision audit trace metadata is incomplete.");
check(/locationPresent/i.test(revision), "Revision audit should retain only an opaque location-presence flag.");

const progress = latestFunction("crm_kpi_get_assignment_progress");
check(/sum\(e\.approved_value\)[\s\S]*status\s*=\s*'APPROVED'/i.test(progress), "Approved actual aggregation missing.");
check(/least\(round/i.test(progress), "Scoring completion cap missing.");
check(/has_open_items/i.test(progress), "Pending/revision visibility missing.");
const monthly = latestFunction("crm_kpi_get_monthly_scores");
check(/filter\s*\(\s*where x\.score_enabled\s*\)/i.test(monthly), "score_enabled denominator filter missing.");
check(/bool_or\(x\.has_open_items\) filter \(where x\.score_enabled\)/i.test(monthly), "Reference-only KPI must not block monthly finality.");

const sourceSnapshot = latestFunction("crm_kpi_source_snapshot");
const candidates = latestFunction("crm_kpi_list_hybrid_candidates");
check(/created_by_user_id\s*=\s*v_actor/i.test(sourceSnapshot + candidates), "customers_v1 must use acquisition actor.");
check(/crm_kpi_resolve_user_id_by_email\(l\.created_by_email\)\s*=\s*v_actor/i.test(sourceSnapshot + candidates), "care_logs_v1 must use care actor mapping.");
check(!/owner_user_id\s*=\s*v_actor/i.test(sourceSnapshot + candidates), "HYBRID adapters must not use current customer owner.");
check(/KPI_BUSINESS_SOURCE_NOT_READY[\s\S]*deals_v1/i.test(sourceSnapshot + candidates), "deals_v1 must be disabled until actor contract exists.");

const locationValidator = latestFunction("crm_kpi_validate_location");
check(/v_lat < -90 or v_lat > 90/i.test(locationValidator), "Latitude range validation missing.");
check(/v_lng < -180 or v_lng > 180/i.test(locationValidator), "Longitude range validation missing.");
check(/v_accuracy <= 0 or v_accuracy > 1000000/i.test(locationValidator), "Accuracy sanity validation missing.");
const timestampValidator = latestFunction("crm_kpi_validate_event_at");
check(/v_event_at < p_period_starts_at or v_event_at >= p_period_ends_at/i.test(timestampValidator), "Period timestamp bounds missing.");
check(/clock_timestamp\(\) \+ interval '5 minutes'/i.test(timestampValidator), "Server future timestamp guard missing.");

const assignEmployee = latestFunction("crm_kpi_assign_employee");
const syncAssignments = latestFunction("crm_kpi_sync_definition_assignments");
check(/source_metric_key[\s\S]*<> 'deals_v1'/i.test(assignEmployee), "Single assignment deals_v1 safe default missing.");
check(/scoreEnabled/i.test(syncAssignments) && /<> 'deals_v1'/i.test(syncAssignments), "Matrix assignment explicit score option/deals safe default missing.");

check(/kpiSubmissions:\s*"kpi_submissions"/.test(adapter), "Adapter kpiSubmissions map missing.");
check(/kpiSubmissionEvents:\s*"kpi_submission_events"/.test(adapter), "Adapter kpiSubmissionEvents map missing.");
check(/kpiEvidence:\s*"kpi_evidence"/.test(adapter), "Adapter kpiEvidence map missing.");
check(/crm_kpi_create_definition_v2/.test(app) && /crm_kpi_update_definition_v2/.test(app), "Definition v2 UI RPCs missing.");
check(/crm_kpi_update_assignment_options/.test(app), "score_enabled UI RPC missing.");
check(/scoreEnabled:\s*!!scoreOption\?\.checked/.test(app), "Assignment matrix must send scoreEnabled explicitly.");
check(/crm_kpi_get_duplicate_context/.test(app), "Manager duplicate detail RPC UI missing.");
check(/KPI_IDEMPOTENCY_PAYLOAD_CONFLICT/.test(app), "Readable idempotency conflict UI message missing.");
check(/crm_kpi_submit_events/.test(app) && /crm_kpi_submit_revision/.test(app), "Sale submit/revision UI RPC missing.");
check(/data-kpi2-open-revision/.test(app) && /kpi2RevisionEventId/.test(html), "Sale revision action UI missing.");
check(/crm_kpi_review_events/.test(app), "Manager review UI RPC missing.");
check(/KPI2_EVIDENCE_BUCKET\s*=\s*"kpi2-evidence"/.test(app), "Private evidence bucket constant missing.");
check(/canvas\.toBlob/i.test(app) && /1\.5\*1024\*1024/.test(app) && /1920/.test(app), "Browser image compression limits missing.");
check(/heic\|heif/i.test(app), "HEIC/HEIF explicit handling missing.");
check(/navigator\.geolocation\.getCurrentPosition/i.test(app), "Required geolocation capture missing.");
check(/createSignedUrl/i.test(app), "Signed evidence preview missing.");
check(/kpi2OperationsPanel/.test(html) && /kpi2ProgressRows/.test(html), "KPI-2 operations panel missing.");
check(/kpi2ReviewRows/.test(html) && /kpi2BulkReviewBtn/.test(html), "Manager review workspace missing.");
check(/kpi1DefinitionAggregation/.test(html) && /kpi1DefinitionMaxImages/.test(html), "Manager definition options missing.");

const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
check(duplicateIds.length === 0, `Duplicate HTML IDs: ${duplicateIds.join(", ")}`);
check(!/service_role/i.test(app), "Frontend must not reference service_role.");
check(!/jjeeazwlqcwynzquimeo/.test(app + html + adapter), "Production project ref must not be hard-coded in KPI-2 frontend files.");
const config = fs.readFileSync(path.join(root, "js", "supabase-config.js"), "utf8");
check(!/service_role|sb_secret_/i.test(config), "Frontend config must not contain privileged Supabase secrets.");
check(/anonKey/i.test(config), "Frontend config should expose only the public anon key.");

if (failures.length) {
  console.error("KPI-2 static contract: FAIL");
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}

console.log(`KPI-2 static contract: PASS (${checks} checks)`);
