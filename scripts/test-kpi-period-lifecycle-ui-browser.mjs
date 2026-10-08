#!/usr/bin/env node
// =====================================================================
// KPI 7C-B — Close / Reopen / Cancel UI end-to-end acceptance.
//
// Real CRM frontend (this checkout) + real 7C-A backend on a DISPOSABLE local
// PostgreSQL, joined by scripts/helpers/kpi-lifecycle-local-gateway.mjs.
// Every lifecycle write is executed by the browser through the real RPCs as
// role `authenticated` with JWT claims of the synthetic user.
//
// Env: CRM_AUTH_PLAYWRIGHT_ENTRY, CRM_AUTH_BROWSER_PATH (same as other browser
// tests) and PGHOST/PGPORT/PGUSER (default /tmp:5433 postgres).
// Exit: 0 PASS · 1 FAIL · 3 SKIP (no Playwright or no local Postgres).
// =====================================================================
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startLocalGateway } from "./helpers/kpi-lifecycle-local-gateway.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = process.env.CRM_AUTH_PLAYWRIGHT_ENTRY;
const browserPath = process.env.CRM_AUTH_BROWSER_PATH;
const PG = {host: process.env.PGHOST || "/tmp", port: Number(process.env.PGPORT || 5433), user: process.env.PGUSER || "postgres"};
if (!(PG.host.startsWith("/") || ["localhost", "127.0.0.1", "::1"].includes(PG.host))) { console.error(`REFUSING non-local PGHOST ${PG.host}`); process.exit(1); }
if (!entry || !browserPath) { console.log("SKIP: set CRM_AUTH_PLAYWRIGHT_ENTRY and CRM_AUTH_BROWSER_PATH (release-blocking for KPI lifecycle UI)."); process.exit(3); }

const psqlArgs = db => ["-h", PG.host, "-p", String(PG.port), "-U", PG.user, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-d", db];
const psql = (db, sql) => { const r = spawnSync("psql", psqlArgs(db), {input: sql, encoding: "utf8"}); return {code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim()}; };
if (psql("postgres", "select 1").code !== 0) { console.log(`SKIP: no local PostgreSQL at ${PG.host}:${PG.port} (release-blocking for KPI lifecycle UI).`); process.exit(3); }

const DB = `kpi7cb_ui_${process.pid}`;
const readSql = rel => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
psql("postgres", `drop database if exists ${DB} with (force)`);
psql("postgres", `create database ${DB}`);
for (const file of ["scripts/fixtures/kpi-lifecycle-prod-baseline.sql", "supabase-phase-kpi-7c-period-close-lifecycle.sql",
  "scripts/fixtures/kpi-lifecycle-test-helpers.sql", "scripts/fixtures/kpi-lifecycle-ui-fixture.sql"]) {
  const r = psql(DB, readSql(file));
  if (r.code !== 0) { console.error(`FAIL: loading ${file}: ${r.err}`); psql("postgres", `drop database if exists ${DB} with (force)`); process.exit(1); }
}
const q = sql => { const r = psql(DB, sql); if (r.code !== 0) throw new Error(`${r.err}\n${sql.slice(0, 300)}`); return r.out; };
const qj = sql => JSON.parse(q(sql).split("\n").pop());

const P = {sep: "7cb00000-0000-4000-8000-000000000009", oct: "7cb00000-0000-4000-8000-000000000010", aug: "7cb00000-0000-4000-8000-000000000008",
  jul: "7cb00000-0000-4000-8000-000000000007", jun: "7cb00000-0000-4000-8000-000000000006", may: "7cb00000-0000-4000-8000-000000000005", apr: "7cb00000-0000-4000-8000-000000000004"};
const A = {sep1: "7cb10000-0000-4000-8000-000000000901", may: "7cb10000-0000-4000-8000-000000000501", oct: "7cb10000-0000-4000-8000-000000001001"};
const LABEL = "Từ chối tự động do kỳ KPI đã được đóng";
const snap = period => qj(`select lifecycle_test.snapshot('${period}')`);
const period = id => qj(`select to_jsonb(p) from public.kpi_periods p where id='${id}'`);
const auditCount = () => Number(q("select count(*) from public.audit_logs"));

const requests = [];
const gateway = await startLocalGateway({root, pg: {...PG, database: DB}, onRequest: r => requests.push(r)});
const {chromium} = await import(pathToFileURL(entry).href).then(m => m.default || m);
const browser = await chromium.launch({executablePath: browserPath, headless: true});

const results = [];
const check = (cond, label, detail = "") => results.push([cond ? "PASS" : "FAIL", `${label}${!cond && detail ? ` — ${detail}` : ""}`]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pageErrors = [];
const rpcCalls = name => requests.filter(r => r.path === `/rest/v1/rpc/${name}`);

async function login(email, route) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", e => pageErrors.push(`${email}: ${e.message}`));
  page.on("dialog", d => d.accept());
  await page.goto(`${gateway.base}/crm${route}`, {waitUntil: "load"});
  await page.fill("#loginEmail", email);
  await page.fill("#loginPassword", "local-fixture");
  await page.click("#loginBtn");
  await page.waitForSelector("#loginView", {state: "hidden", timeout: 15000}).catch(() => {});
  return {context, page};
}
async function openLibraryPeriod(page, periodId) {
  await page.evaluate(() => { location.hash = "#/kpi/library"; });
  await page.waitForSelector(`[data-kpi1-select-period="${periodId}"]`, {timeout: 15000});
  await page.click(`[data-kpi1-select-period="${periodId}"]`);
  await page.waitForSelector("#kpi1PeriodDetail:not(.hide)");
  await page.waitForFunction(() => /Submission:/.test(document.querySelector("#kpi1LifecycleInfo")?.textContent || ""), null, {timeout: 15000});
}
const visible = (page, sel) => page.locator(sel).isVisible();
async function waitNotice(page, pattern, timeout = 20000) {
  await page.waitForFunction(src => new RegExp(src).test(document.querySelector("#notice")?.textContent || ""), pattern.source, {timeout});
  return page.locator("#notice").innerText();
}
async function submitDrawer(page) {
  // clear the previous toast so a stale message can never satisfy the next assertion
  await page.evaluate(() => { const n = document.querySelector("#notice"); if (n) { n.textContent = ""; n.className = "notice hide"; } });
  await page.click("#kpiPeriodLifecycleSubmitBtn");
}
const drawerOpen = page => visible(page, "#kpiPeriodLifecycleDrawer");
const drawerText = page => page.locator("#kpiPeriodLifecycleDrawer").innerText();

try {
  // ------------------------------------------------------------------
  // Manager: Close preflight, cancel dialog, Close execute (09/2026)
  // ------------------------------------------------------------------
  {
    const {context, page} = await login("manager@example.test", "#/kpi/library");
    await openLibraryPeriod(page, P.sep);
    check(await visible(page, "#kpi1ClosePeriodBtn"), "Manager sees “Đóng kỳ KPI” on ACTIVE period");
    check(!(await visible(page, "#kpi1CancelPeriodBtn")), "Manager does not see Cancel");
    check(!(await visible(page, "#kpi1ReopenPeriodBtn")), "Manager does not see Reopen on ACTIVE");

    const before = snap(P.sep); const beforePeriod = period(P.sep); const auditBefore = auditCount();
    const openItemsCalls = rpcCalls("crm_kpi_period_open_items").length;
    await page.click("#kpi1ClosePeriodBtn");
    await page.waitForSelector("#kpiPeriodLifecycleDrawer:not(.hide) [data-kpi-close-total]");
    const text = await drawerText(page);
    const call = rpcCalls("crm_kpi_period_open_items").slice(openItemsCalls)[0];
    check(call?.body?.p_period_id === P.sep && call?.status === 200, "preflight uses crm_kpi_period_open_items(current period)", JSON.stringify(call?.body));
    check(text.includes("Đóng kỳ KPI 09/2026?"), "dialog title “Đóng kỳ KPI 09/2026?”", text.split("\n")[0]);
    check(text.includes("Kỳ KPI sẽ chuyển sang trạng thái Đã đóng và chỉ còn chế độ xem."), "dialog explains read-only CLOSED state");
    check(text.includes("Có 5 đề xuất chưa được xử lý. Khi đóng kỳ, 5 đề xuất này sẽ tự động bị từ chối và không được tính vào KPI."), "prominent auto-reject warning with backend total 5");
    check(await page.locator('[data-kpi-close-count="Chờ duyệt"]').innerText() === "3" && await page.locator('[data-kpi-close-count="Cần bổ sung"]').innerText() === "2" && await page.locator("[data-kpi-close-total]").innerText() === "5", "breakdown Chờ duyệt 3 · Cần bổ sung 2 · total 5");
    check(await page.locator("#kpiPeriodLifecycleSubmitBtn").innerText() === "Đóng kỳ & từ chối 5 đề xuất", "primary label “Đóng kỳ & từ chối 5 đề xuất”");
    check(await page.locator("#kpiPeriodLifecycleCancelBtn").innerText() === "Hủy", "secondary “Hủy”");
    check(!/phải xử lý hết/i.test(text), "no “phải xử lý hết trước khi đóng” wording");
    check(!(await visible(page, "#kpiPeriodLifecycleReason")), "Close needs no reason field");
    await page.click("#kpiPeriodLifecycleCancelBtn");
    check(!(await drawerOpen(page)), "Hủy closes the dialog");
    check(same(before, snap(P.sep)) && auditCount() === auditBefore && rpcCalls("crm_kpi_close_period_foundation").length === 0, "Hủy: no mutation, no audit, Close RPC never called");

    const actualBefore = before.approved_actual;
    await page.click("#kpi1ClosePeriodBtn");
    await page.waitForSelector("#kpiPeriodLifecycleDrawer:not(.hide) [data-kpi-close-total]");
    await submitDrawer(page);
    const note = await waitNotice(page, /Kỳ KPI đã được đóng/);
    const closeCall = rpcCalls("crm_kpi_close_period_foundation").at(-1);
    check(closeCall?.body?.p_expected_version === beforePeriod.version && closeCall?.body?.p_period_id === P.sep, `Close RPC sent latest version ${beforePeriod.version}`, JSON.stringify(closeCall?.body));
    check(closeCall?.response?.autoRejectedTotal === 5 && closeCall?.response?.status === "CLOSED", "backend result autoRejectedTotal=5, CLOSED");
    check(note.includes("Kỳ KPI đã được đóng. 5 đề xuất chưa xử lý đã được từ chối tự động."), "success message uses RPC count", note);
    await page.waitForFunction(() => /ĐÃ ĐÓNG/.test(document.querySelector("#kpi1SelectedPeriodMeta")?.textContent || ""));
    check(!(await drawerOpen(page)), "dialog closed after success");
    check(!(await visible(page, "#kpi1ClosePeriodBtn")) && !(await visible(page, "#kpi1CancelPeriodBtn")) && !(await visible(page, "#kpi1ReopenPeriodBtn")), "CLOSED for Manager: no Close/Cancel/Reopen actions");
    const info = await page.locator("#kpi1LifecycleInfo").innerText();
    check(/ĐÃ ĐÓNG · .*Manager Test/.test(info) && info.includes("Chỉ Owner/Admin có thể mở lại kỳ"), "CLOSED metadata (time + actor) and read-only note", info);
    check(await page.locator(`[data-kpi1-select-period="${P.sep}"]`).locator("xpath=ancestor::tr").innerText().then(t => t.includes("ĐÃ ĐÓNG")), "period list shows ĐÃ ĐÓNG without page reload");

    const after = snap(P.sep);
    const openIds = Object.entries(before.events).filter(([, e]) => e.status === "PENDING" || e.status === "NEEDS_REVISION").map(([id]) => id);
    check(openIds.length === 5 && openIds.every(id => after.events[id].status === "REJECTED" && after.events[id].reason === "PERIOD_CLOSED"), "DB: the 5 open items are REJECTED / PERIOD_CLOSED");
    check(Object.entries(before.events).filter(([id]) => !openIds.includes(id)).every(([id, e]) => same(e, after.events[id])), "DB: APPROVED/REJECTED/WITHDRAWN rows unchanged");
    check(same(before.evidence, after.evidence) && Object.keys(after.evidence).length === 10, "DB: attached Evidence (9) + STAGED upload (1) unchanged");
    check(after.evidence["7cbe0000-0000-4000-8000-000000000001"]?.status === "STAGED", "DB: unattached STAGED evidence stays STAGED (documented debt)");
    check(Object.values(after.submissions).every(s => s.status !== "OPEN_REVIEW"), "DB: no OPEN_REVIEW submission remains");
    check(after.approved_actual === actualBefore && Number(after.approved_actual) === 2, `DB: approved actual unchanged (${actualBefore})`);

    // KPI Team (Manager detail) — read-only closed view + label + evidence viewer
    await page.evaluate(() => { location.hash = "#/kpi/team"; });
    await page.waitForSelector("#kpiTeamPeriod");
    await page.selectOption("#kpiTeamPeriod", P.sep);
    await page.waitForSelector('[data-kpi-team-open-employee="u_sale2"]', {timeout: 15000});
    await page.click('[data-kpi-team-open-employee="u_sale2"]');
    await page.click('[data-kpi-employee-tab="proposals"]');
    await page.waitForFunction(label => (document.querySelector("#kpiTeamDetailContent")?.innerText || "").includes(label), LABEL, {timeout: 15000});
    const detail = await page.locator("#kpiTeamDetailContent").innerText();
    check(detail.includes(`Lý do: ${LABEL}`), "Manager detail shows friendly PERIOD_CLOSED label");
    check(!detail.includes("PERIOD_CLOSED"), "Manager detail never shows raw PERIOD_CLOSED");
    check(detail.includes("ĐÃ ĐÓNG chỉ đọc") && !(await page.locator("#kpiTeamReviewBtn").count()), "CLOSED KPI Team: read-only, no approve/reject controls");
    check(!(await page.locator("#kpiTeamDetailContent [data-kpi2-review-event]").count()), "CLOSED KPI Team: no selectable proposals");
    await page.locator("#kpiTeamDetailContent [data-kpi2-view-evidence]").first().click();
    await page.waitForFunction(() => /Minh chứng KPI/.test(document.body.innerText) && document.querySelectorAll("img[src*='/object/sign/']").length > 0, null, {timeout: 15000}).then(() => check(true, "Evidence of an auto-rejected Event still opens (signed URL)"), () => check(false, "Evidence of an auto-rejected Event still opens (signed URL)"));
    await context.close();
  }

  // ------------------------------------------------------------------
  // Owner: Reopen (blank reason blocked) → no revival → new work → Close again
  // ------------------------------------------------------------------
  {
    const {context, page} = await login("owner@example.test", "#/kpi/library");
    await openLibraryPeriod(page, P.sep);
    check(await visible(page, "#kpi1ReopenPeriodBtn") && !(await visible(page, "#kpi1ClosePeriodBtn")) && !(await visible(page, "#kpi1CancelPeriodBtn")), "Owner on CLOSED: Reopen only");
    const closedSnap = snap(P.sep);
    await page.click("#kpi1ReopenPeriodBtn");
    await page.waitForSelector("#kpiPeriodLifecycleDrawer:not(.hide)");
    const text = await drawerText(page);
    check(text.includes("Mở lại kỳ KPI 09/2026?") && text.includes("Kỳ sẽ chuyển về trạng thái ACTIVE.") && text.includes("phát sinh đề xuất mới") && text.includes("sẽ KHÔNG tự phục hồi"), "Reopen dialog explains ACTIVE, new work, no revival");
    check(await page.locator("#kpiPeriodLifecycleReasonLabel").innerText() === "Lý do mở lại" && await page.locator("#kpiPeriodLifecycleSubmitBtn").innerText() === "Mở lại kỳ", "Reopen: “Lý do mở lại” + “Mở lại kỳ”");
    const reopenCalls = rpcCalls("crm_kpi_reopen_period").length;
    await page.fill("#kpiPeriodLifecycleReason", "   ");
    await submitDrawer(page);
    await waitNotice(page, /Hãy nhập lý do mở lại/);
    check(rpcCalls("crm_kpi_reopen_period").length === reopenCalls && period(P.sep).status === "CLOSED", "blank reason blocked locally (no RPC, still CLOSED)");
    await page.fill("#kpiPeriodLifecycleReason", "Điều chỉnh số liệu tháng 9");
    await submitDrawer(page);
    const note = await waitNotice(page, /Đã mở lại kỳ KPI/);
    check(note.includes("vẫn giữ trạng thái từ chối"), "Reopen success message does not imply revival", note);
    const reopenCall = rpcCalls("crm_kpi_reopen_period").at(-1);
    check(reopenCall?.body?.p_reason === "Điều chỉnh số liệu tháng 9" && reopenCall?.body?.p_expected_version === closedSnap.period.version, "Reopen RPC sent reason + latest version");
    const reopened = snap(P.sep);
    check(reopened.period.status === "ACTIVE", "DB: CLOSED → ACTIVE");
    check(same(closedSnap.events, reopened.events), "DB: auto-rejected Events stay REJECTED/PERIOD_CLOSED (no revival)");
    await page.waitForFunction(() => /ACTIVE/.test(document.querySelector("#kpi1SelectedPeriodMeta")?.textContent || ""));
    check(await visible(page, "#kpi1ClosePeriodBtn") && !(await visible(page, "#kpi1ReopenPeriodBtn")), "after Reopen: Close available again, Reopen hidden");

    // new work after Reopen (disposable DB, real submit RPC as Sale), then Close again
    const fresh = q(`select lifecycle_test.submit('u_sale1', '${A.sep1}')`);
    await openLibraryPeriod(page, P.sep);
    await page.click("#kpi1ClosePeriodBtn");
    await page.waitForSelector("#kpiPeriodLifecycleDrawer:not(.hide) [data-kpi-close-total]");
    check(await page.locator("[data-kpi-close-total]").innerText() === "1" && await page.locator("#kpiPeriodLifecycleSubmitBtn").innerText() === "Đóng kỳ & từ chối 1 đề xuất", "second Close preflight counts only the new PENDING");
    await submitDrawer(page);
    const note2 = await waitNotice(page, /Kỳ KPI đã được đóng/);
    check(note2.includes("1 đề xuất chưa xử lý"), "second Close: 1 auto-rejected", note2);
    const closedAgain = snap(P.sep);
    check(closedAgain.events[fresh].reason === "PERIOD_CLOSED" && Object.entries(closedSnap.events).every(([id, e]) => same(e, closedAgain.events[id])), "old PERIOD_CLOSED Events untouched by second Close");

    // Cancel with open items (08/2026) — useful guidance, no fallback to Close
    await openLibraryPeriod(page, P.aug);
    check(await visible(page, "#kpi1CancelPeriodBtn") && await visible(page, "#kpi1ClosePeriodBtn"), "Owner on ACTIVE with data: both Close and Cancel shown");
    check((await page.locator("#kpi1ClosePeriodBtn").getAttribute("title")).includes("Hoàn tất") && (await page.locator("#kpi1CancelPeriodBtn").getAttribute("title")).includes("tạo/vận hành sai"), "Close vs Cancel semantics labelled");
    const augBefore = snap(P.aug);
    await page.click("#kpi1CancelPeriodBtn");
    await page.waitForSelector("#kpiPeriodLifecycleDrawer:not(.hide)");
    check((await drawerText(page)).includes("không dùng để kết thúc tháng"), "Cancel dialog points to Close for month-end");
    await page.fill("#kpiPeriodLifecycleReason", "Tạo nhầm kỳ");
    await submitDrawer(page);
    const cancelNote = await waitNotice(page, /Không thể hủy kỳ/);
    check(cancelNote.includes("Không thể hủy kỳ vì còn đề xuất chưa xử lý. Hãy đóng kỳ nếu mục đích là kết thúc kỳ KPI."), "KPI_PERIOD_OPEN_ITEMS shown as guidance", cancelNote);
    const augAfter = snap(P.aug);
    check(augAfter.period.status === "ACTIVE" && same(augBefore.events, augAfter.events) && rpcCalls("crm_kpi_close_period_foundation").filter(c => c.body?.p_period_id === P.aug).length === 0, "Cancel failure: ACTIVE, Event PENDING, no automatic Close");

    // Cancel with zero open items (07/2026) — existing path still works
    await openLibraryPeriod(page, P.jul);
    await page.click("#kpi1CancelPeriodBtn");
    await page.waitForSelector("#kpiPeriodLifecycleDrawer:not(.hide)");
    await page.fill("#kpiPeriodLifecycleReason", "Kỳ thử nghiệm sai");
    await submitDrawer(page);
    await waitNotice(page, /Đã hủy kỳ KPI/);
    check(period(P.jul).status === "CANCELLED", "zero-open Cancel succeeds (CANCELLED)");

    // Version conflict (06/2026): second actor changes the period while the dialog is open
    await openLibraryPeriod(page, P.jun);
    await page.click("#kpi1ClosePeriodBtn");
    await page.waitForSelector("#kpiPeriodLifecycleDrawer:not(.hide) [data-kpi-close-total]");
    const junBefore = snap(P.jun);
    q(`update public.kpi_periods set version = version + 1, updated_at = now() where id = '${P.jun}'`);
    const bumped = period(P.jun).version;
    await submitDrawer(page);
    const conflictNote = await waitNotice(page, /vừa được thay đổi/);
    check(/tải lại/.test(conflictNote), "KPI_VERSION_CONFLICT → user told data changed", conflictNote);
    await page.waitForFunction(v => (document.querySelector("#kpiPeriodLifecycleSubtitle")?.textContent || "").includes(`Version ${v}`), bumped);
    check(await drawerOpen(page) && (await drawerText(page)).includes("vừa thay đổi"), "dialog reloaded with fresh version/counts; fresh confirmation required");
    const junAfterConflict = snap(P.jun);
    check(junAfterConflict.period.status === "ACTIVE" && same(junBefore.events, junAfterConflict.events), "conflict: no mutation");
    check(rpcCalls("crm_kpi_close_period_foundation").filter(c => c.body?.p_period_id === P.jun).length === 1, "conflict: no automatic retry");
    await submitDrawer(page);
    await waitNotice(page, /Kỳ KPI đã được đóng. 2 đề xuất/);
    check(period(P.jun).status === "CLOSED", "explicit re-confirmation closes the period");

    // Count race (05/2026): a new PENDING arrives after the dialog showed 2
    await openLibraryPeriod(page, P.may);
    await page.click("#kpi1ClosePeriodBtn");
    await page.waitForSelector("#kpiPeriodLifecycleDrawer:not(.hide) [data-kpi-close-total]");
    check(await page.locator("[data-kpi-close-total]").innerText() === "2", "race: dialog shows 2");
    q(`select lifecycle_test.submit('u_sale1', '${A.may}')`);
    await submitDrawer(page);
    const raceNote = await waitNotice(page, /Kỳ KPI đã được đóng/);
    const raceCall = rpcCalls("crm_kpi_close_period_foundation").at(-1);
    check(raceCall?.response?.autoRejectedTotal === 3 && raceNote.includes("3 đề xuất chưa xử lý"), "race: backend rejected N+1 = 3 and UI reports 3 (not stale 2)", raceNote);

    // Transactional failure (04/2026): UI must not show CLOSED
    q(`create function lifecycle_test.ui_boom() returns trigger language plpgsql as $$ begin
         if new.action = 'period_close' and new.entity_id = '${P.apr}' then raise exception 'INJECTED_UI_CLOSE_FAILURE'; end if; return new; end $$;
       create trigger zz_ui_boom before insert on public.audit_logs for each row execute function lifecycle_test.ui_boom();`);
    const aprBefore = snap(P.apr);
    await openLibraryPeriod(page, P.apr);
    await page.click("#kpi1ClosePeriodBtn");
    await page.waitForSelector("#kpiPeriodLifecycleDrawer:not(.hide) [data-kpi-close-total]");
    await submitDrawer(page);
    await page.waitForFunction(() => document.querySelector("#notice")?.classList.contains("bad"), null, {timeout: 20000});
    const aprAfter = snap(P.apr);
    check(aprAfter.period.status === "ACTIVE" && aprAfter.period.version === aprBefore.period.version && same(aprBefore.events, aprAfter.events), "failure: DB rolled back (ACTIVE, Event PENDING)");
    check(/ACTIVE/.test(await page.locator("#kpi1SelectedPeriodMeta").innerText()) && !(await page.locator("#kpi1SelectedPeriodMeta").innerText()).includes("ĐÃ ĐÓNG"), "failure: UI shows ACTIVE, no optimistic CLOSED");
    check(!/đã được đóng/.test(await page.locator("#notice").innerText()), "failure: no success message");
    q("drop trigger zz_ui_boom on public.audit_logs; drop function lifecycle_test.ui_boom();");
    await context.close();
  }

  // ------------------------------------------------------------------
  // Sale view: current period CLOSED → nothing to submit; Admin Reopen →
  // auto-rejected Event shows the friendly label; new submit allowed.
  // ------------------------------------------------------------------
  {
    const manager = await login("manager@example.test", "#/kpi/library");
    await openLibraryPeriod(manager.page, P.oct);
    await manager.page.click("#kpi1ClosePeriodBtn");
    await manager.page.waitForSelector("#kpiPeriodLifecycleDrawer:not(.hide) [data-kpi-close-total]");
    await submitDrawer(manager.page);
    await waitNotice(manager.page, /Kỳ KPI đã được đóng. 1 đề xuất/);
    await manager.context.close();

    const sale = await login("sale1@example.test", "#/kpi/mine");
    await sale.page.waitForSelector("#kpi2OperationsPanel:not(.hide)", {timeout: 15000});
    await sale.page.waitForFunction(() => /Chưa có kỳ KPI đang hoạt động/.test(document.querySelector("#kpi2CurrentPeriodContext")?.textContent || ""));
    check(!(await sale.page.locator("[data-kpi2-open-claim]").count()), "Sale: CLOSED current period → no proposal submit action");
    await sale.page.evaluate(() => { location.hash = "#/kpi/library"; });
    await sale.page.waitForTimeout(800);
    check(!(await visible(sale.page, "#kpi1ClosePeriodBtn")) && !(await visible(sale.page, "#kpi1ReopenPeriodBtn")) && !(await visible(sale.page, "#kpi1CancelPeriodBtn")), "Sale: no Close/Reopen/Cancel controls");
    await sale.context.close();

    const admin = await login("admin@example.test", "#/kpi/library");
    await openLibraryPeriod(admin.page, P.oct);
    check(await visible(admin.page, "#kpi1ReopenPeriodBtn"), "Admin sees Reopen on CLOSED");
    await admin.page.click("#kpi1ReopenPeriodBtn");
    await admin.page.fill("#kpiPeriodLifecycleReason", "Mở lại để Sale bổ sung");
    await submitDrawer(admin.page);
    await waitNotice(admin.page, /Đã mở lại kỳ KPI/);
    check(period(P.oct).status === "ACTIVE", "Admin Reopen: CLOSED → ACTIVE");
    await admin.context.close();

    const sale2 = await login("sale1@example.test", "#/kpi/mine");
    await sale2.page.waitForFunction(() => /10\/2026/.test(document.querySelector("#kpi2CurrentPeriodContext")?.textContent || ""), null, {timeout: 15000});
    await sale2.page.waitForFunction(label => (document.querySelector("#kpi2SaleHistoryRows")?.innerText || "").includes(label), LABEL, {timeout: 15000});
    const history = await sale2.page.locator("#kpi2SaleHistoryRows").innerText();
    check(history.includes(`Lý do: ${LABEL}`) && !history.includes("PERIOD_CLOSED"), "Sale history: friendly label, no raw code");
    check(history.includes("Từ chối") && history.includes("Đã duyệt"), "Sale history: rejected item + approved history visible");
    check(await sale2.page.locator("[data-kpi2-open-claim]").count() > 0, "Sale: ACTIVE again after Reopen → can submit new work");
    check(!(await sale2.page.locator("[data-kpi2-withdraw-event]").count()), "Sale: auto-rejected Events cannot be withdrawn/revived");
    await sale2.context.close();
  }

  const lifecycleWrites = requests.filter(r => /crm_kpi_(close_period_foundation|reopen_period|cancel_active_period)/.test(r.path));
  check(lifecycleWrites.every(r => r.user && r.status != null), "every lifecycle write went through an authenticated RPC");
  check(requests.filter(r => r.ignoredWrite && /kpi_/.test(r.path)).length === 0, "no direct table writes to KPI tables");
  const relevantErrors = pageErrors.filter(e => !/WebSocket|realtime/i.test(e));
  check(relevantErrors.length === 0, `browser page errors = ${relevantErrors.length}`, relevantErrors.slice(0, 3).join(" | "));
} catch (error) {
  results.push(["FAIL", `exception: ${error.message.split("\n")[0]}`]);
} finally {
  await browser.close();
  await gateway.close();
  psql("postgres", `drop database if exists ${DB} with (force)`);
}

for (const [status, label] of results) console.log(`${status} ${label}`);
const failed = results.filter(([s]) => s === "FAIL").length;
console.log(`\nKPI 7C-B lifecycle UI (browser + disposable DB): ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
