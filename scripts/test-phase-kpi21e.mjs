import fs from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const sql = read("supabase-phase-kpi21e-september-cutover.sql");
const app = read("js/features/crm-app.js");
const html = read("index.html");
const helperPath = pathToFileURL(path.join(root, "js/features/kpi-cutover.js")).href;
const cutover = await import(`${helperPath}?test=${Date.now()}`);

let checks = 0;
function check(condition, message) {
  checks += 1;
  if (!condition) throw new Error(`FAIL: ${message}`);
}

check(cutover.KPI_LEGACY_CUTOVER_UTC === "2026-08-31T17:00:00.000Z", "UTC boundary must be exact.");
check(cutover.KPI_LEGACY_CUTOVER_AT === "2026-09-01T00:00:00+07:00", "HCM boundary must be exact.");
check(cutover.isLegacyKpiPreCutover(Date.parse("2026-08-31T16:59:59Z")), "T-1 must be pre-cutover.");
check(!cutover.isLegacyKpiPreCutover(Date.parse("2026-08-31T17:00:00Z")), "T must be post-cutover.");
check(!cutover.isLegacyKpiPreCutover(Date.parse("2026-08-31T17:00:01Z")), "T+1 must be post-cutover.");
check(Date.parse("2026-09-01T00:00:00+07:00") === Date.parse("2026-08-31T17:00:00Z"), "HCM and UTC boundaries must match.");

check(/crm_legacy_kpi_cutover_at\(\)/.test(sql), "Migration must centralize cutover constant.");
check(/crm_legacy_kpi_clock_now\(\)/.test(sql), "Migration must use a trusted DB clock helper.");
check(/crm_legacy_kpi_write_window_open\(\)/.test(sql), "Migration must expose one runtime write-window predicate.");
check(/not v_is_update and not public\.crm_legacy_kpi_write_window_open\(\)/.test(sql), "New proposal RPC must fail closed after cutover.");
check(/v_old\.created_at/.test(sql) && /crm_legacy_kpi_closeout_allowed/.test(sql), "Close-out must use stored created_at.");
check(/kpi rules manager write before september cutover/.test(sql), "Legacy rule writes must be date-guarded.");
check(/revoke insert, update, delete, truncate, references, trigger on public\.kpi_proposals from anon, authenticated/i.test(sql), "Direct proposal DML must be revoked.");
check(/kpi evidence cutover controlled insert/.test(sql), "Legacy evidence insert policy must be cutover-aware.");
check(!/(delete\s+from|truncate\s+table|drop\s+table)\s+public\.(kpi_rules|kpi_proposals)/i.test(sql), "Migration must not delete legacy history.");
check(!/insert\s+into\s+public\.(kpi_periods|kpi_definitions|kpi_assignments|kpi_submission_events)/i.test(sql), "Migration must not fabricate canonical configuration/data.");
check(!/15\/08|2026-08-15/.test(sql + app + html), "Cancelled August cutover must not exist in runtime or migration.");

check(/from "\.\/kpi-cutover\.js"/.test(app), "Frontend must import centralized cutover helper.");
check(!/2026-09-01T00:00:00\+07:00/.test(app), "crm-app must not duplicate the cutover literal.");
check(/operationalKpiPendingCount/.test(app), "Dashboard/report must use operational KPI pending source.");
check(/legacy-pending-kpi/.test(app), "Legacy pending must have a separate action/source.");
check(/KPI cũ đang đóng sổ/.test(app), "Legacy pending must be clearly labelled.");
check(/legacyKpiPreCutover\(\) \? `<button class="small primary" data-open-kpi-proposal-customer/.test(app), "Customer legacy proposal button must hide post-cutover.");
check(/KPI cũ — Đang đóng sổ/.test(html), "Legacy close-out panel must be labelled.");
check(/id="kpiCutoverStatus"/.test(html), "Cutover status banner must exist.");

const before = {createdAt:"2026-08-31T16:59:59Z", status:"pending", isDeleted:false};
const at = {createdAt:"2026-08-31T17:00:00Z", status:"pending", isDeleted:false};
check(cutover.legacyCloseoutEligible(before, true), "Pre-cutover pending proposal must be close-out eligible.");
check(!cutover.legacyCloseoutEligible(at, true), "Proposal created at boundary must not be close-out eligible.");
check(!cutover.legacyCloseoutEligible({...before, isDeleted:true}, true), "Deleted proposal must not be close-out eligible.");
check(!cutover.legacyCloseoutEligible(before, false), "Closed proposal must not be close-out eligible.");

console.log(`KPI-2.1E static/boundary checks PASS (${checks} checks).`);
