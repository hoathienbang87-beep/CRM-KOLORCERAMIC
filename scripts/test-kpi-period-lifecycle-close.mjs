#!/usr/bin/env node
// =====================================================================
// KPI 7C-A — period Close / Cancel guard / Reopen lifecycle integration.
//
// Runs against a DISPOSABLE local PostgreSQL (psql on PATH):
//   PGHOST (default /tmp)  PGPORT (default 5433)  PGUSER (default postgres)
// Builds a Production-shaped KPI schema (scripts/fixtures/kpi-lifecycle-
// prod-baseline.sql, function bodies md5-pinned to Production), applies
// supabase-phase-kpi-7c-period-close-lifecycle.sql, loads synthetic
// fixtures through the real RPCs and runs the lifecycle matrix.
//
// Exit codes: 0 PASS · 1 FAIL · 3 SKIP (no local Postgres; release-blocking
// for any phase that changes KPI period lifecycle SQL).
// Never point this at a remote/Production database: non-local hosts are refused.
// =====================================================================
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PGHOST = process.env.PGHOST || "/tmp";
const PGPORT = process.env.PGPORT || "5433";
const PGUSER = process.env.PGUSER || "postgres";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
if (!(PGHOST.startsWith("/") || LOCAL_HOSTS.has(PGHOST))) {
  console.error(`REFUSING: PGHOST=${PGHOST} is not a local socket/loopback host.`);
  process.exit(1);
}

// CRLF checkouts (core.autocrlf=true) must not leak \r into function bodies.
const readSql = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const BASELINE = readSql("scripts/fixtures/kpi-lifecycle-prod-baseline.sql");
const MIGRATION = readSql("supabase-phase-kpi-7c-period-close-lifecycle.sql");
const HELPERS = readSql("scripts/fixtures/kpi-lifecycle-test-helpers.sql");

const baseArgs = ["-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1"];
function psql(db, sql) {
  const r = spawnSync("psql", [...baseArgs, "-d", db], { input: sql, encoding: "utf8" });
  if (r.error) return { code: 127, out: "", err: String(r.error) };
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

const probe = psql("postgres", "select 1");
if (probe.code !== 0) {
  console.log(`SKIP: no local PostgreSQL reachable at ${PGHOST}:${PGPORT} (${probe.err.split("\n")[0]}). ` +
    "Release-blocking: KPI lifecycle SQL is unverified until this suite runs.");
  process.exit(3);
}

const AUTH = {
  u_owner: "7c000000-0000-4000-8000-0000000000a1", u_admin: "7c000000-0000-4000-8000-0000000000a2",
  u_manager: "7c000000-0000-4000-8000-0000000000a3", u_sale1: "7c000000-0000-4000-8000-0000000000b1",
  u_sale2: "7c000000-0000-4000-8000-0000000000b2", u_sale3: "7c000000-0000-4000-8000-0000000000b3",
  u_inactive_manager: "7c000000-0000-4000-8000-0000000000c1",
};
// Statement executed exactly as PostgREST would: role authenticated + JWT claims.
function asUserSql(user, statement, { role = "authenticated", txn = true } = {}) {
  return `${txn ? "begin;" : ""}
\\o /dev/null
set local role ${role};
select set_config('request.jwt.claim.sub', '${AUTH[user] || ""}', true), set_config('request.jwt.claim.role', '${role}', true);
\\o
${statement};
${txn ? "commit;" : ""}`;
}
const asUser = (db, user, statement, opts) => psql(db, asUserSql(user, statement, opts));
const json = (r) => { if (r.code !== 0) throw new Error(`SQL failed: ${r.err}`); return JSON.parse(r.out.split("\n").pop()); };
const q = (db, sql) => { const r = psql(db, sql); if (r.code !== 0) throw new Error(`SQL failed: ${r.err}\n${sql.slice(0, 400)}`); return r.out; };
const qj = (db, sql) => JSON.parse(q(db, sql).split("\n").pop());

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; results.push(`  PASS ${name}`); }
  else { fail++; results.push(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
function expectError(name, r, pattern) {
  check(name, r.code !== 0 && pattern.test(r.err), r.code === 0 ? `succeeded: ${r.out}` : r.err.split("\n")[0]);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------
// Databases
// ---------------------------------------------------------------------
const PREFIX = `kpi7c_${process.pid}`;
const created = [];
function createDb(name, template) {
  q("postgres", `drop database if exists ${name}`);
  q("postgres", `create database ${name}${template ? ` template ${template}` : ""}`);
  created.push(name);
  return name;
}
function cleanup() {
  for (const db of created.reverse()) psql("postgres", `drop database if exists ${db} with (force)`);
}
process.on("exit", cleanup);

let SID = 0;
const periodId = () => { SID++; return `7c100000-0000-4000-8000-${SID.toString(16).padStart(12, "0")}`; };
const assignmentId = () => { SID++; return `7c200000-0000-4000-8000-${SID.toString(16).padStart(12, "0")}`; };
let MONTH = 0;
const nextMonth = () => { MONTH++; const y = 2015 + Math.floor((MONTH - 1) / 12); const m = ((MONTH - 1) % 12) + 1; return `${y}-${String(m).padStart(2, "0")}-01`; };

function scenario(name, fn) {
  results.push(`\n[${name}]`);
  try { fn(); } catch (error) { fail++; results.push(`  FAIL ${name} threw: ${error.message.split("\n")[0]}`); }
}

// ---------------------------------------------------------------------
// 0. Baseline faithfulness + migration install
// ---------------------------------------------------------------------
const pre = createDb(`${PREFIX}_pre`);
q(pre, BASELINE);
scenario("S0 Production-shaped baseline", () => {
  const drift = q(pre, `select coalesce(string_agg(m.proname, ','), '')
    from lifecycle_test.prod_function_manifest m
    left join pg_proc p on p.proname = m.proname and p.pronamespace = 'public'::regnamespace
    where md5(pg_get_functiondef(p.oid)) is distinct from m.md5`);
  check("28 baseline function bodies byte-identical to Production (md5)", drift === "", drift);
  const reasonBefore = q(pre, `select pg_get_constraintdef(oid) from pg_constraint where conname='kpi_submission_events_reason_check'`);
  check("baseline reason check has no PERIOD_CLOSED", !reasonBefore.includes("PERIOD_CLOSED"));
});

const tpl = createDb(`${PREFIX}_tpl`, pre);
scenario("S0 migration install", () => {
  const r = psql(tpl, MIGRATION);
  check("migration applies (PRECONDITION_PASS + APPLIED)", r.code === 0 && /PRECONDITION_PASS/.test(r.err) && /KPI_7C_A_MIGRATION_APPLIED/.test(r.err), r.err);
  const again = psql(tpl, MIGRATION);
  check("re-apply refused by precondition, nothing half-installed", again.code !== 0 && /PRECONDITION_FAIL/.test(again.err));
  const acl = q(tpl, `select string_agg(proname || '=' || coalesce(proacl::text, 'DEFAULT'), ' ' order by proname) from pg_proc
    where pronamespace = 'public'::regnamespace and proname in ('crm_kpi_close_period_foundation','crm_kpi_cancel_active_period','crm_kpi_reopen_period','crm_kpi_period_open_items','crm_kpi_period_open_event_ids')`);
  check("ACL close/cancel = {postgres,authenticated,service_role}",
    /crm_kpi_close_period_foundation=\{postgres=X\/postgres,authenticated=X\/postgres,service_role=X\/postgres\}/.test(acl) &&
    /crm_kpi_cancel_active_period=\{postgres=X\/postgres,authenticated=X\/postgres,service_role=X\/postgres\}/.test(acl), acl);
  check("open_event_ids internal (no authenticated EXECUTE)", /crm_kpi_period_open_event_ids=\{postgres=X\/postgres,service_role=X\/postgres\}/.test(acl), acl);
  const secdef = q(tpl, `select bool_and(prosecdef and proconfig = array['search_path=public']) from pg_proc where pronamespace='public'::regnamespace
    and proname in ('crm_kpi_close_period_foundation','crm_kpi_cancel_active_period','crm_kpi_period_open_items','crm_kpi_period_open_event_ids')`);
  check("SECURITY DEFINER + search_path=public preserved", secdef === "t");
  const untouched = q(tpl, `select coalesce(string_agg(m.proname, ','), '') from lifecycle_test.prod_function_manifest m
    join pg_proc p on p.proname = m.proname and p.pronamespace = 'public'::regnamespace
    where md5(pg_get_functiondef(p.oid)) <> m.md5`);
  check("only close + cancel bodies changed (reopen/review/submit/withdraw untouched)",
    untouched.split(",").sort().join(",") === "crm_kpi_cancel_active_period,crm_kpi_close_period_foundation", untouched);
});
q(tpl, HELPERS);

const fresh = (tag) => createDb(`${PREFIX}_${tag}`, tpl);

// Helpers that build runtime rows through the real RPCs.
const DEF_NO_EVIDENCE = "7c000000-0000-4000-8000-00000000d002"; // SUM, evidence optional
function mkPeriod(db, status = "ACTIVE") {
  const id = periodId(); q(db, `select lifecycle_test.mk_period('${id}', '${nextMonth()}', '${status === "DRAFT" ? "DRAFT" : "ACTIVE"}')`); return id;
}
function mkAssignment(db, period, sale, definition = "7c000000-0000-4000-8000-00000000d001") {
  const id = assignmentId(); q(db, `select lifecycle_test.mk_assignment('${id}', '${period}', '${sale}', '${definition}')`); return id;
}
const submit = (db, sale, a, value = 1) => q(db, `select lifecycle_test.submit('${sale}', '${a}', ${value})`);
const review = (db, e, decision, reason = null) => q(db, `select lifecycle_test.review('${e}', '${decision}', ${reason ? `'${reason}'` : "null"})`);
const withdraw = (db, sale, e) => q(db, `select lifecycle_test.withdraw('${sale}', '${e}')`);
const revise = (db, sale, e) => q(db, `select lifecycle_test.revise('${sale}', '${e}')`);
const snap = (db, p) => qj(db, `select lifecycle_test.snapshot('${p}')`);
const version = (db, p) => Number(q(db, `select version from public.kpi_periods where id='${p}'`));
const close = (db, user, p, v) => asUser(db, user, `select public.crm_kpi_close_period_foundation('${p}', ${v ?? "null"})`);
const cancel = (db, user, p, v, reason = "Hủy kỳ thử nghiệm") => asUser(db, user, `select public.crm_kpi_cancel_active_period('${p}', ${v}, ${reason === null ? "null" : `'${reason}'`})`);
const reopen = (db, user, p, v, reason = "Mở lại để điều chỉnh") => asUser(db, user, `select public.crm_kpi_reopen_period('${p}', ${v}, ${reason === null ? "null" : `'${reason}'`})`);
const auditOf = (db, action, entityId) => qj(db, `select coalesce(jsonb_agg(raw_data order by created_at), '[]') from public.audit_logs where action='${action}'${entityId ? ` and entity_id='${entityId}'` : ""}`);
const progress = (db, p) => json(asUser(db, "u_manager", `select coalesce(jsonb_agg(jsonb_build_object('a', assignment_id, 'actual', approved_actual, 'pct', actual_completion_pct, 'open', has_open_items, 'pending', pending_count, 'nr', needs_revision_count, 'rejected', rejected_count) order by assignment_id), '[]') from public.crm_kpi_get_assignment_progress('${p}')`));
const scores = (db, p) => json(asUser(db, "u_manager", `select coalesce(jsonb_agg(to_jsonb(s) order by employee_id), '[]') from public.crm_kpi_get_monthly_scores('${p}') s`));

// Mixed fixture: 2 APPROVED, 1 REJECTED, 1 WITHDRAWN, 3 PENDING, 2 NEEDS_REVISION (unresolved).
function mixedFixture(db) {
  const p = mkPeriod(db);
  const a1 = mkAssignment(db, p, "u_sale1"), a2 = mkAssignment(db, p, "u_sale2");
  const ev = { approved: [], rejected: [], withdrawn: [], pending: [], revision: [] };
  for (let i = 0; i < 2; i++) { const e = submit(db, "u_sale1", a1); review(db, e, "APPROVED"); ev.approved.push(e); }
  { const e = submit(db, "u_sale1", a1); review(db, e, "REJECTED", "DUPLICATE"); ev.rejected.push(e); }
  { const e = submit(db, "u_sale2", a2); withdraw(db, "u_sale2", e); ev.withdrawn.push(e); }
  for (let i = 0; i < 3; i++) ev.pending.push(submit(db, i < 2 ? "u_sale1" : "u_sale2", i < 2 ? a1 : a2));
  for (let i = 0; i < 2; i++) { const e = submit(db, "u_sale2", a2); review(db, e, "NEEDS_REVISION"); ev.revision.push(e); }
  return { p, a1, a2, ev };
}

// ---------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------
scenario("F23 Close with no open items", () => {
  const db = fresh("f23");
  const p = mkPeriod(db); const a = mkAssignment(db, p, "u_sale1");
  const e1 = submit(db, "u_sale1", a); review(db, e1, "APPROVED");
  const e2 = submit(db, "u_sale1", a); review(db, e2, "REJECTED", "NOT_NEW");
  const e3 = submit(db, "u_sale1", a); withdraw(db, "u_sale1", e3);
  const before = snap(db, p); const v = version(db, p);
  const r = json(close(db, "u_manager", p, v));
  const after = snap(db, p);
  check("closed=true, CLOSED, autoRejectedTotal=0", r.closed === true && r.status === "CLOSED" && r.autoRejectedTotal === 0 && r.newStatus === "CLOSED");
  check("version +1, closed_by = actor", r.previousVersion === v && r.newVersion === v + 1 && after.period.closed_by === "u_manager" && after.period.closed_at);
  check("events / submissions / evidence unchanged", same(before.events, after.events) && same(before.submissions, after.submissions) && same(before.evidence, after.evidence));
  check("one period_close audit, zero event_auto_reject", auditOf(db, "period_close", p).length === 1 && auditOf(db, "event_auto_reject").length === 0);
});

scenario("F24 Close auto-rejects 3 PENDING", () => {
  const db = fresh("f24");
  const p = mkPeriod(db); const a = mkAssignment(db, p, "u_sale1");
  const ids = [submit(db, "u_sale1", a), submit(db, "u_sale1", a), submit(db, "u_sale1", a)];
  const before = snap(db, p); const v = version(db, p);
  const r = json(close(db, "u_admin", p, v));
  const after = snap(db, p);
  check("return: autoRejectedTotal=3 pendingRejected=3 revisionRejected=0", r.autoRejectedTotal === 3 && r.pendingRejected === 3 && r.revisionRejected === 0);
  check("3 events REJECTED / PERIOD_CLOSED, lock+1, reviewed_by closer, approved null",
    ids.every((id) => { const x = after.events[id]; return x.status === "REJECTED" && x.reason === "PERIOD_CLOSED" && x.lock === before.events[id].lock + 1 && x.reviewed_by === "u_admin" && x.approved === null; }));
  check("submissions finalised COMPLETED (no OPEN_REVIEW)", Object.values(after.submissions).every((s) => s.status === "COMPLETED"));
  check("evidence rows untouched (status, event link, object path, version)", same(before.evidence, after.evidence) && Object.values(after.evidence).every((x) => x.status === "ATTACHED"));
  check("period CLOSED", after.period.status === "CLOSED");
  const ea = auditOf(db, "event_auto_reject");
  check("3 event-level audits: reason PERIOD_CLOSED, previous/new status, period, actor",
    ea.length === 3 && ea.every((x) => x.reason === "PERIOD_CLOSED" && x.previousStatus === "PENDING" && x.newStatus === "REJECTED" && x.periodId === p && x.closedByUserId === "u_admin" && x.actorUserId === "u_admin" && x.timestamp));
  const pa = auditOf(db, "period_close", p);
  check("period audit: counts + versions + states", pa.length === 1 && pa[0].autoRejectedTotal === 3 && pa[0].pendingCount === 3 && pa[0].needsRevisionCount === 0 && pa[0].versionBefore === v && pa[0].versionAfter === v + 1 && pa[0].oldStatus === "ACTIVE" && pa[0].newStatus === "CLOSED" && pa[0].actorUserId === "u_admin");
  const sale = asUser(db, "u_sale1", `select public.crm_kpi_submit_events('${a}', gen_random_uuid(), null, '[{"sourceType":"MANUAL","sourceEventKey":"manual:00000000-0000-4000-8000-000000000001","eventAt":"2015-01-05T00:00:00Z","eventSnapshot":{"title":"x"}}]')`);
  expectError("Sale submit after Close blocked (period not ACTIVE)", sale, /ACTIVE/);
});

scenario("F25 Close resolves unresolved NEEDS_REVISION only", () => {
  const db = fresh("f25");
  const p = mkPeriod(db); const a = mkAssignment(db, p, "u_sale1");
  const unresolved = submit(db, "u_sale1", a); review(db, unresolved, "NEEDS_REVISION");
  const resolvedOld = submit(db, "u_sale1", a); review(db, resolvedOld, "NEEDS_REVISION");
  const revisionPending = revise(db, "u_sale1", resolvedOld);
  const openBefore = json(asUser(db, "u_manager", `select public.crm_kpi_period_open_items('${p}')`));
  check("canonical open items: 1 pending (revision) + 1 needs-revision", openBefore.pendingCount === 1 && openBefore.needsRevisionCount === 1 && openBefore.openTotal === 2);
  const before = snap(db, p);
  const r = json(close(db, "u_owner", p, version(db, p)));
  const after = snap(db, p);
  check("autoRejectedTotal=2 (pending 1, revision 1)", r.autoRejectedTotal === 2 && r.pendingRejected === 1 && r.revisionRejected === 1);
  check("unresolved NEEDS_REVISION -> REJECTED/PERIOD_CLOSED, manager note kept", after.events[unresolved].status === "REJECTED" && after.events[unresolved].reason === "PERIOD_CLOSED" && after.events[unresolved].note === before.events[unresolved].note);
  check("superseded NEEDS_REVISION row untouched", same(after.events[resolvedOld], before.events[resolvedOld]));
  check("pending revision -> REJECTED/PERIOD_CLOSED", after.events[revisionPending].status === "REJECTED" && after.events[revisionPending].reason === "PERIOD_CLOSED");
  const nr = auditOf(db, "event_auto_reject", unresolved)[0];
  check("audit keeps previous reviewer of the revision request", nr && nr.previousStatus === "NEEDS_REVISION" && nr.previousReviewedByUserId === "u_manager");
  check("no OPEN_REVIEW submission left", Object.values(after.submissions).every((s) => s.status !== "OPEN_REVIEW"));
  check("period CLOSED", after.period.status === "CLOSED");
});

scenario("F26 Mixed states: only 5 open rows transformed", () => {
  const db = fresh("f26");
  const { p, ev } = mixedFixture(db);
  const before = snap(db, p); const progBefore = progress(db, p); const scoresBefore = scores(db, p);
  const r = json(close(db, "u_manager", p, version(db, p)));
  const after = snap(db, p);
  const terminal = [...ev.approved, ...ev.rejected, ...ev.withdrawn];
  check("autoRejectedTotal=5 (3 pending + 2 revision)", r.autoRejectedTotal === 5 && r.pendingRejected === 3 && r.revisionRejected === 2);
  check("APPROVED/REJECTED/WITHDRAWN rows byte-identical", terminal.every((id) => same(before.events[id], after.events[id])));
  check("5 open rows -> REJECTED/PERIOD_CLOSED", [...ev.pending, ...ev.revision].every((id) => after.events[id].status === "REJECTED" && after.events[id].reason === "PERIOD_CLOSED"));
  check("manual REJECTED keeps DUPLICATE reason", after.events[ev.rejected[0]].reason === "DUPLICATE");
  check("approved actual unchanged (sum)", before.approved_actual === after.approved_actual && Number(after.approved_actual) === 2);
  const progAfter = progress(db, p);
  check("progress RPC actual/pct unchanged per assignment", progBefore.every((x, i) => x.actual === progAfter[i].actual && x.pct === progAfter[i].pct));
  check("progress RPC: no open items after close", progAfter.every((x) => x.open === false && x.pending === 0 && x.nr === 0));
  const scoresAfter = scores(db, p);
  check("monthly score unchanged", scoresBefore.every((x, i) => x.monthly_score === scoresAfter[i].monthly_score));
  check("evidence untouched", same(before.evidence, after.evidence));
});

scenario("F27 Mid-transaction failure rolls back everything", () => {
  for (const [label, sql] of [
    ["failure at final period audit", `create function lifecycle_test.boom() returns trigger language plpgsql as $$ begin
       if new.action = 'period_close' then raise exception 'INJECTED_FAILURE_PERIOD_AUDIT'; end if; return new; end $$;
       create trigger zz_boom before insert on public.audit_logs for each row execute function lifecycle_test.boom();`],
    ["failure while auto-rejecting a NEEDS_REVISION row", `create function lifecycle_test.boom() returns trigger language plpgsql as $$ begin
       if old.status = 'NEEDS_REVISION' and new.review_reason_code = 'PERIOD_CLOSED' then raise exception 'INJECTED_FAILURE_EVENT'; end if; return new; end $$;
       create trigger zz_boom before update on public.kpi_submission_events for each row execute function lifecycle_test.boom();`],
    ["failure while refreshing submissions", `create function lifecycle_test.boom() returns trigger language plpgsql as $$ begin
       if new.status = 'COMPLETED' and old.status = 'OPEN_REVIEW' then raise exception 'INJECTED_FAILURE_SUBMISSION'; end if; return new; end $$;
       create trigger zz_boom before update on public.kpi_submissions for each row execute function lifecycle_test.boom();`],
  ]) {
    const db = fresh(`f27_${SID}`);
    const { p } = mixedFixture(db);
    q(db, sql);
    const before = snap(db, p); const v = version(db, p);
    const r = close(db, "u_manager", p, v);
    const after = snap(db, p);
    expectError(`${label}: Close raises`, r, /INJECTED_FAILURE/);
    check(`${label}: period ACTIVE, version unchanged`, after.period.status === "ACTIVE" && after.period.version === v);
    check(`${label}: all events/submissions/evidence identical`, same(before.events, after.events) && same(before.submissions, after.submissions) && same(before.evidence, after.evidence));
    check(`${label}: no audit row written`, before.audit_count === after.audit_count && auditOf(db, "period_close", p).length === 0);
  }
});

scenario("F28 Stale version: no mutation", () => {
  const db = fresh("f28");
  const { p } = mixedFixture(db);
  const before = snap(db, p); const v = version(db, p);
  expectError("stale version -> KPI_VERSION_CONFLICT", close(db, "u_manager", p, v - 1), /KPI_VERSION_CONFLICT/);
  expectError("null version -> KPI_VERSION_CONFLICT", close(db, "u_manager", p, null), /KPI_VERSION_CONFLICT/);
  check("period/events/evidence/audit unchanged", same(before, snap(db, p)));
});

scenario("F13 Close on DRAFT / CLOSED / CANCELLED rejected", () => {
  const db = fresh("f13");
  const draft = mkPeriod(db, "DRAFT");
  const closed = mkPeriod(db); q(db, `select lifecycle_test.set_status('${closed}', 'CLOSED')`);
  const cancelled = mkPeriod(db); q(db, `select lifecycle_test.set_status('${cancelled}', 'CANCELLED')`);
  const audit = q(db, "select count(*) from public.audit_logs");
  for (const [label, p] of [["DRAFT", draft], ["CLOSED", closed], ["CANCELLED", cancelled]]) {
    const before = snap(db, p);
    expectError(`${label} -> KPI_PERIOD_NOT_ACTIVE`, close(db, "u_owner", p, version(db, p)), /KPI_PERIOD_NOT_ACTIVE/);
    check(`${label} unchanged`, same(before, snap(db, p)));
  }
  expectError("unknown period -> not found", close(db, "u_owner", "7c1fffff-0000-4000-8000-000000000000", 1), /Không tìm thấy/);
  check("no audit for rejected closes", q(db, "select count(*) from public.audit_logs") === audit);
  const p = mkPeriod(db); const v = version(db, p);
  json(close(db, "u_owner", p, v));
  expectError("second Close of same period is not a silent success", close(db, "u_owner", p, v + 1), /KPI_PERIOD_NOT_ACTIVE/);
});

scenario("F22 Close role matrix", () => {
  const db = fresh("f22");
  for (const [user, allowed] of [["u_sale1", false], ["u_inactive_manager", false], ["u_manager", true], ["u_admin", true], ["u_owner", true]]) {
    const p = mkPeriod(db); const a = mkAssignment(db, p, "u_sale1"); submit(db, "u_sale1", a);
    const before = snap(db, p);
    const r = close(db, user, p, version(db, p));
    if (allowed) check(`${user} may Close`, r.code === 0 && JSON.parse(r.out.split("\n").pop()).autoRejectedTotal === 1, r.err);
    else { expectError(`${user} rejected (42501)`, r, /manager\/admin\/owner/); check(`${user}: nothing changed`, same(before, snap(db, p))); }
  }
  const p = mkPeriod(db);
  expectError("anon cannot execute Close", asUser(db, "u_owner", `select public.crm_kpi_close_period_foundation('${p}', 3)`, { role: "anon" }), /permission denied/);
  expectError("authenticated cannot call internal open_event_ids", asUser(db, "u_manager", `select * from public.crm_kpi_period_open_event_ids('${p}')`), /permission denied/);
  expectError("Sale cannot read open-item counts", asUser(db, "u_sale1", `select public.crm_kpi_period_open_items('${p}')`), /manager\/admin\/owner/);
});

scenario("F06 PERIOD_CLOSED is system-only", () => {
  const db = fresh("f06");
  const p = mkPeriod(db); const a = mkAssignment(db, p, "u_sale1"); const e = submit(db, "u_sale1", a);
  const v = q(db, `select lock_version from public.kpi_submission_events where id='${e}'`);
  expectError("Manager review cannot use PERIOD_CLOSED", asUser(db, "u_manager", `select public.crm_kpi_review_events(gen_random_uuid(), '[{"eventId":"${e}","expectedVersion":${v}}]', 'REJECTED', 'PERIOD_CLOSED', null)`), /reason code/);
  expectError("direct UPDATE by authenticated blocked by guard", asUser(db, "u_manager", `update public.kpi_submission_events set review_reason_code='PERIOD_CLOSED' where id='${e}'`), /permission denied|RPC/);
  const bad = psql(db, `update public.kpi_submission_events set review_reason_code='NOT_A_REASON' where id='${e}'`);
  expectError("check constraint still rejects unknown reasons", bad, /reason_check|review_shape_check/);
});

scenario("F29 Cancel with open items fails safely", () => {
  const db = fresh("f29");
  const p = mkPeriod(db); const a = mkAssignment(db, p, "u_sale1"); const e = submit(db, "u_sale1", a);
  const before = snap(db, p);
  for (const user of ["u_admin", "u_owner"]) {
    const r = cancel(db, user, p, version(db, p));
    expectError(`${user} Cancel -> KPI_PERIOD_OPEN_ITEMS`, r, /KPI_PERIOD_OPEN_ITEMS/);
    check(`${user}: safe counts in message/detail`, /1 mục chưa xử lý \(1 chờ duyệt, 0 cần bổ sung\)/.test(r.err) && /"openTotal": 1/.test(r.err));
  }
  const after = snap(db, p);
  check("period ACTIVE, version, Event PENDING, Evidence unchanged, no audit", same(before, after) && after.events[e].status === "PENDING");
  const p2 = mkPeriod(db); const a2 = mkAssignment(db, p2, "u_sale2"); const e2 = submit(db, "u_sale2", a2); review(db, e2, "NEEDS_REVISION");
  const r2 = cancel(db, "u_owner", p2, version(db, p2));
  expectError("unresolved NEEDS_REVISION also blocks Cancel", r2, /KPI_PERIOD_OPEN_ITEMS: .*\(0 chờ duyệt, 1 cần bổ sung\)/);
  check("NEEDS_REVISION not auto-rejected by Cancel", snap(db, p2).events[e2].status === "NEEDS_REVISION");
});

scenario("F30/F20 Cancel zero-open path + role matrix", () => {
  const db = fresh("f30");
  for (const [user, allowed] of [["u_sale1", false], ["u_manager", false], ["u_admin", true], ["u_owner", true]]) {
    const p = mkPeriod(db); const a = mkAssignment(db, p, "u_sale1");
    const e1 = submit(db, "u_sale1", a); review(db, e1, "APPROVED");
    const e2 = submit(db, "u_sale1", a); withdraw(db, "u_sale1", e2);
    const before = snap(db, p); const v = version(db, p);
    const r = cancel(db, user, p, v);
    if (allowed) {
      const out = r.code === 0 ? JSON.parse(r.out.split("\n").pop()) : {};
      const after = snap(db, p);
      check(`${user} Cancel succeeds with zero open items`, r.code === 0 && out.status === "CANCELLED" && out.version === v + 1, r.err);
      check(`${user}: events/evidence untouched by Cancel`, same(before.events, after.events) && same(before.evidence, after.evidence));
      check(`${user}: PERIOD_CANCELLED audit with zero open counts`, auditOf(db, "PERIOD_CANCELLED", p)[0]?.openItemCounts?.openTotal === 0);
    } else {
      expectError(`${user} cannot Cancel`, r, /Owner\/Admin/);
      check(`${user}: nothing changed`, same(before, snap(db, p)));
    }
  }
  const empty = mkPeriod(db);
  expectError("Cancel of period without runtime data keeps existing 'revert to DRAFT' rule", cancel(db, "u_owner", empty, version(db, empty)), /DRAFT/);
  const p = mkPeriod(db); const a = mkAssignment(db, p, "u_sale1"); review(db, submit(db, "u_sale1", a), "APPROVED");
  expectError("Cancel requires reason (unchanged)", cancel(db, "u_owner", p, version(db, p), "   "), /Lý do/);
  expectError("Cancel stale version (unchanged)", cancel(db, "u_owner", p, version(db, p) + 5), /KPI_VERSION_CONFLICT/);
});

scenario("F31/F21 Close then Reopen never revives auto-rejected Events", () => {
  const db = fresh("f31");
  const p = mkPeriod(db); const a = mkAssignment(db, p, "u_sale1");
  const ids = [submit(db, "u_sale1", a), submit(db, "u_sale1", a)];
  json(close(db, "u_manager", p, version(db, p)));
  const closedSnap = snap(db, p); const v = version(db, p);
  expectError("Manager cannot Reopen", reopen(db, "u_manager", p, v), /admin\/owner/);
  expectError("Sale cannot Reopen", reopen(db, "u_sale1", p, v), /admin\/owner/);
  expectError("Reopen requires reason", reopen(db, "u_owner", p, v, "  "), /bắt buộc/);
  expectError("Reopen requires current version", reopen(db, "u_owner", p, v - 1), /KPI_VERSION_CONFLICT/);
  const r = json(reopen(db, "u_owner", p, v));
  const after = snap(db, p);
  check("Owner Reopen: CLOSED -> ACTIVE, version +1", r.status === "ACTIVE" && r.version === v + 1);
  check("auto-rejected Events stay REJECTED/PERIOD_CLOSED (byte-identical)", same(closedSnap.events, after.events) && ids.every((id) => after.events[id].status === "REJECTED" && after.events[id].reason === "PERIOD_CLOSED"));
  check("Evidence remains historical (identical)", same(closedSnap.evidence, after.evidence));
  check("period_reopen audit written", auditOf(db, "period_reopen", p).length === 1);
  check("after Reopen: no open items", progress(db, p).every((x) => x.open === false));
  const fresh1 = submit(db, "u_sale1", a);
  const r2 = json(close(db, "u_admin", p, version(db, p)));
  check("re-Close after Reopen rejects only the new PENDING", r2.autoRejectedTotal === 1 && snap(db, p).events[fresh1].reason === "PERIOD_CLOSED");
  const v3 = version(db, p);
  check("Admin may Reopen too", json(reopen(db, "u_admin", p, v3)).status === "ACTIVE");
});

// --- Concurrency: two real sessions against the same period -------------
function runAsync(db, sql) {
  return new Promise((resolve) => {
    const child = spawn("psql", [...baseArgs, "-d", db]);
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
    child.stdin.end(sql);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForLockWait(db, pattern, timeoutMs = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const n = q(db, `select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query ilike '%${pattern}%'`);
    if (Number(n) > 0) return true;
    await sleep(100);
  }
  return false;
}
const submitSql = (a, key) => `select public.crm_kpi_submit_events('${a}', gen_random_uuid(), null, '[{"sourceType":"MANUAL","sourceEventKey":"manual:${key}","eventAt":"__AT__","claimedValue":1,"eventSnapshot":{"title":"race"}}]'::jsonb)`;
const eventAt = (db, p) => q(db, `select to_char((starts_at + interval '2 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from public.kpi_periods where id='${p}'`);

async function concurrency() {
  results.push("\n[F15 Concurrency]");
  // A. Close holds the period lock; a Sale submission arrives mid-Close.
  {
    const db = fresh("f15a");
    const p = mkPeriod(db); const a = mkAssignment(db, p, "u_sale1", DEF_NO_EVIDENCE); submit(db, "u_sale1", a);
    const v = version(db, p);
    const closing = runAsync(db, `begin;
\\o /dev/null
set local role authenticated;
select set_config('request.jwt.claim.sub', '${AUTH.u_manager}', true), set_config('request.jwt.claim.role', 'authenticated', true);
\\o
select (public.crm_kpi_close_period_foundation('${p}', ${v}))->>'autoRejectedTotal';
select pg_sleep(2);
commit;`);
    await sleep(500);
    const submitting = runAsync(db, asUserSql("u_sale1", submitSql(a, "aaaaaaaa-0000-4000-8000-00000000a001").replace("__AT__", eventAt(db, p))));
    const blocked = await waitForLockWait(db, "crm_kpi_submit_events");
    const [rc, rs] = await Promise.all([closing, submitting]);
    check("A: Sale submit blocks on the period row while Close runs", blocked);
    check("A: Close commits, auto-rejects the 1 pre-existing PENDING", rc.code === 0 && rc.out.split("\n")[0] === "1", rc.err);
    expectError("A: late submit fails after Close (period no longer ACTIVE)", rs, /ACTIVE/);
    const s = snap(db, p);
    check("A: no Event escaped the close boundary (1 event, 0 open, CLOSED)", Object.keys(s.events).length === 1 && Object.values(s.events).every((x) => x.status === "REJECTED") && s.period.status === "CLOSED");
  }
  // B. Sale submission holds FOR SHARE first; Close must wait and then include it.
  {
    const db = fresh("f15b");
    const p = mkPeriod(db); const a = mkAssignment(db, p, "u_sale1", DEF_NO_EVIDENCE);
    const v = version(db, p);
    const submitting = runAsync(db, `begin;
\\o /dev/null
set local role authenticated;
select set_config('request.jwt.claim.sub', '${AUTH.u_sale1}', true), set_config('request.jwt.claim.role', 'authenticated', true);
\\o
${submitSql(a, "bbbbbbbb-0000-4000-8000-00000000b001").replace("__AT__", eventAt(db, p))};
select pg_sleep(2);
commit;`);
    await sleep(500);
    const closing = runAsync(db, asUserSql("u_manager", `select public.crm_kpi_close_period_foundation('${p}', ${v})`));
    const blocked = await waitForLockWait(db, "crm_kpi_close_period_foundation");
    const [rs, rc] = await Promise.all([submitting, closing]);
    check("B: Close waits for the in-flight submission", blocked);
    check("B: submission commits", rs.code === 0, rs.err);
    const out = rc.code === 0 ? JSON.parse(rc.out.split("\n").pop()) : {};
    check("B: Close sees the committed Event and auto-rejects it", rc.code === 0 && out.autoRejectedTotal === 1, rc.err);
    const s = snap(db, p);
    check("B: period CLOSED with zero open items", s.period.status === "CLOSED" && Object.values(s.events).every((x) => x.status === "REJECTED" && x.reason === "PERIOD_CLOSED"));
  }
  // C. Sale withdraw in flight; Close must not overwrite the WITHDRAWN row.
  {
    const db = fresh("f15c");
    const p = mkPeriod(db); const a = mkAssignment(db, p, "u_sale1");
    const e = submit(db, "u_sale1", a); const other = submit(db, "u_sale1", a);
    const lv = q(db, `select lock_version from public.kpi_submission_events where id='${e}'`);
    const v = version(db, p);
    const withdrawing = runAsync(db, `begin;
\\o /dev/null
set local role authenticated;
select set_config('request.jwt.claim.sub', '${AUTH.u_sale1}', true), set_config('request.jwt.claim.role', 'authenticated', true);
\\o
select public.crm_kpi_withdraw_event('${e}', ${lv}, 'Rút lại', gen_random_uuid());
select pg_sleep(2);
commit;`);
    await sleep(500);
    const closing = runAsync(db, asUserSql("u_manager", `select public.crm_kpi_close_period_foundation('${p}', ${v})`));
    const blocked = await waitForLockWait(db, "crm_kpi_close_period_foundation");
    const [rw, rc] = await Promise.all([withdrawing, closing]);
    const s = snap(db, p);
    const out = rc.code === 0 ? JSON.parse(rc.out.split("\n").pop()) : {};
    check("C: Close waits for in-flight withdraw", blocked);
    check("C: withdraw commits; Close auto-rejects only the remaining PENDING", rw.code === 0 && rc.code === 0 && out.autoRejectedTotal === 1, `${rw.err} ${rc.err}`);
    check("C: withdrawn row stays WITHDRAWN, other PENDING -> PERIOD_CLOSED", s.events[e].status === "WITHDRAWN" && s.events[other].reason === "PERIOD_CLOSED");
  }
  // D. Manager review in flight (event row lock held); Close either waits or one side is aborted — never partial.
  {
    const db = fresh("f15d");
    const p = mkPeriod(db); const a = mkAssignment(db, p, "u_sale1");
    const e = submit(db, "u_sale1", a); const other = submit(db, "u_sale1", a);
    const lv = q(db, `select lock_version from public.kpi_submission_events where id='${e}'`);
    const v = version(db, p);
    const reviewing = runAsync(db, `begin;
\\o /dev/null
set local role authenticated;
select set_config('request.jwt.claim.sub', '${AUTH.u_manager}', true), set_config('request.jwt.claim.role', 'authenticated', true);
\\o
select public.crm_kpi_review_events(gen_random_uuid(), '[{"eventId":"${e}","expectedVersion":${lv}}]', 'APPROVED', null, null);
select pg_sleep(2);
commit;`);
    await sleep(500);
    const closing = runAsync(db, asUserSql("u_admin", `select public.crm_kpi_close_period_foundation('${p}', ${v})`));
    const [rr, rc] = await Promise.all([reviewing, closing]);
    const s = snap(db, p);
    check("D: review committed first, Close succeeded after it", rr.code === 0 && rc.code === 0, `${rr.err} ${rc.err}`);
    check("D: approved Event kept APPROVED, other auto-rejected, period CLOSED", s.events[e].status === "APPROVED" && s.events[other].reason === "PERIOD_CLOSED" && s.period.status === "CLOSED");
  }
}

scenario("F32 September Production-shaped (synthetic)", () => {
  const db = fresh("f32");
  // Production 2026-09 shape: 28 APPROVED, 13 PENDING, 4 REJECTED, 8 WITHDRAWN, 0 NEEDS_REVISION
  // across 13 assignments (8 with approved history), 1 event + 1 evidence per submission.
  const p = mkPeriod(db);
  const sales = ["u_sale1", "u_sale2", "u_sale3"];
  const assignments = [];
  for (let i = 0; i < 13; i++) {
    const sale = sales[i % 3];
    const sum = i >= 11;
    const id = assignmentId(); const def = id.replace(/^7c2/, "7c3");
    q(db, `insert into public.kpi_definitions(id, code, name, kpi_type, unit, created_by_user_id, updated_by_user_id, evidence_required, aggregation_mode)
           values ('${def}', 'SEP_KPI_${i}', 'Sep KPI ${i}', 'MANUAL', '${sum ? "VND" : "lần"}', 'u_owner', 'u_owner', true, '${sum ? "SUM" : "COUNT"}');
           select lifecycle_test.mk_assignment('${id}', '${p}', '${sale}', '${def}');`);
    assignments.push({ sale, id });
  }
  // approved history spread over 8 assignments, including both SUM assignments (11, 12)
  const approvedOn = [0, 1, 2, 3, 4, 5, 11, 12];
  for (let i = 0; i < 28; i++) { const a = assignments[approvedOn[i % 8]]; const e = submit(db, a.sale, a.id, 1500 + i); review(db, e, "APPROVED"); }
  for (let i = 0; i < 4; i++) { const a = assignments[i % 2]; const e = submit(db, a.sale, a.id); review(db, e, "REJECTED", "INVALID_EVIDENCE"); }
  for (let i = 0; i < 8; i++) { const a = assignments[i % 2]; const e = submit(db, a.sale, a.id); withdraw(db, a.sale, e); }
  for (let i = 0; i < 13; i++) { const a = assignments[i % 3]; submit(db, a.sale, a.id); }
  const before = snap(db, p); const progBefore = progress(db, p); const scoresBefore = scores(db, p);
  const counts = Object.values(before.events).reduce((m, x) => ((m[x.status] = (m[x.status] || 0) + 1), m), {});
  check("fixture mirrors Production shape (28/13/4/8, 13 assignments)", counts.APPROVED === 28 && counts.PENDING === 13 && counts.REJECTED === 4 && counts.WITHDRAWN === 8 && progBefore.length === 13, JSON.stringify(counts));
  const r = json(close(db, "u_manager", p, version(db, p)));
  const after = snap(db, p);
  check("13 PENDING auto-rejected, period CLOSED", r.autoRejectedTotal === 13 && r.pendingRejected === 13 && after.period.status === "CLOSED");
  check("41 history rows unchanged", Object.entries(before.events).filter(([, x]) => x.status !== "PENDING").every(([id, x]) => same(x, after.events[id])));
  const progAfter = progress(db, p);
  check("approved actual per assignment unchanged (COUNT + SUM)", progBefore.every((x, i) => x.actual === progAfter[i].actual && x.pct === progAfter[i].pct) && before.approved_actual === after.approved_actual);
  check("monthly scores unchanged; has_open_items false", same(scoresBefore.map((x) => x.monthly_score), scores(db, p).map((x) => x.monthly_score)) && progAfter.every((x) => !x.open));
  check("53 evidence rows (1 per event) untouched", Object.keys(after.evidence).length === 53 && same(before.evidence, after.evidence));
  check("13 event-level audits + 1 period audit", auditOf(db, "event_auto_reject").length === 13 && auditOf(db, "period_close", p).length === 1);
});

scenario("F33 October regression: other ACTIVE period untouched", () => {
  const db = fresh("f33");
  const sep = mkPeriod(db); const oct = mkPeriod(db);
  const aSep = mkAssignment(db, sep, "u_sale1"); const aOct = mkAssignment(db, oct, "u_sale1", DEF_NO_EVIDENCE);
  submit(db, "u_sale1", aSep); const octEvent = submit(db, "u_sale1", aOct);
  const octBefore = snap(db, oct);
  json(close(db, "u_manager", sep, version(db, sep)));
  const octAfter = snap(db, oct);
  check("closing Sep leaves Oct period/events/evidence identical (multiple ACTIVE allowed)", same(octBefore.period, octAfter.period) && same(octBefore.events, octAfter.events) && same(octBefore.evidence, octAfter.evidence) && octAfter.events[octEvent].status === "PENDING");
  check("Sale can still submit to Oct", !!submit(db, "u_sale1", aOct));
  const sepAt = eventAt(db, sep);
  expectError("event_at contract unchanged: Sep date rejected for Oct assignment", asUser(db, "u_sale1", submitSql(aOct, "cccccccc-0000-4000-8000-00000000c001").replace("__AT__", sepAt)), /KPI_TIMESTAMP_OUTSIDE_PERIOD/);
  check("Oct progress still reports open items", progress(db, oct).some((x) => x.open));
});

await concurrency();

console.log(results.join("\n"));
console.log(`\nKPI 7C-A lifecycle: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
