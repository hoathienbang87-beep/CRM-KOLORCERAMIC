#!/usr/bin/env node
// =====================================================================
// KPI 7D — Sale period history selector: end-to-end acceptance.
//
// Real CRM frontend (this checkout) + real KPI backend (Production-shaped
// baseline + 7C-A migration + Production read-side RLS) on a DISPOSABLE
// local PostgreSQL, joined by scripts/helpers/kpi-lifecycle-local-gateway.mjs
// with rlsReads=true, so every Sale SELECT is filtered by the real policies.
//
// Env: CRM_AUTH_PLAYWRIGHT_ENTRY, CRM_AUTH_BROWSER_PATH, PGHOST/PGPORT/PGUSER.
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
if (!entry || !browserPath) { console.log("SKIP: set CRM_AUTH_PLAYWRIGHT_ENTRY and CRM_AUTH_BROWSER_PATH (release-blocking for Sale KPI history)."); process.exit(3); }
const psqlArgs = db => ["-h", PG.host, "-p", String(PG.port), "-U", PG.user, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-d", db];
const psql = (db, sql) => { const r = spawnSync("psql", psqlArgs(db), {input: sql, encoding: "utf8"}); return {code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim()}; };
if (psql("postgres", "select 1").code !== 0) { console.log(`SKIP: no local PostgreSQL at ${PG.host}:${PG.port} (release-blocking for Sale KPI history).`); process.exit(3); }

const DB = `kpi7d_ui_${process.pid}`;
const readSql = rel => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
psql("postgres", `drop database if exists ${DB} with (force)`);
psql("postgres", `create database ${DB}`);
for (const file of ["scripts/fixtures/kpi-lifecycle-prod-baseline.sql", "supabase-phase-kpi-7c-period-close-lifecycle.sql",
  "scripts/fixtures/kpi-lifecycle-test-helpers.sql", "scripts/fixtures/kpi-sale-read-rls.sql", "scripts/fixtures/kpi-sale-history-fixture.sql"]) {
  const r = psql(DB, readSql(file));
  if (r.code !== 0) { console.error(`FAIL: loading ${file}: ${r.err}`); psql("postgres", `drop database if exists ${DB} with (force)`); process.exit(1); }
}
const q = sql => { const r = psql(DB, sql); if (r.code !== 0) throw new Error(`${r.err}\n${sql.slice(0, 300)}`); return r.out; };
const asSale = (authId, sql) => q(`begin;\n\\o /dev/null\nset local role authenticated;\nselect set_config('request.jwt.claim.sub','${authId}',true), set_config('request.jwt.claim.role','authenticated',true);\n\\o\n${sql}\ncommit;`);

const P = {sep: "7d000000-0000-4000-8000-000000000009", oct: "7d000000-0000-4000-8000-000000000010", nov: "7d000000-0000-4000-8000-000000000011",
  aug: "7d000000-0000-4000-8000-000000000008", jul: "7d000000-0000-4000-8000-000000000007", dec: "7d000000-0000-4000-8000-000000000012"};
const A = {sepVisit: "7d100000-0000-4000-8000-000000000901", sepCustomer: "7d100000-0000-4000-8000-000000000902", sepSale2: "7d100000-0000-4000-8000-000000000903",
  octVisit: "7d100000-0000-4000-8000-000000001001", octCustomer: "7d100000-0000-4000-8000-000000001002"};
const AUTH = {sale1: "7c000000-0000-4000-8000-0000000000b1", sale3: "7c000000-0000-4000-8000-0000000000b3"};
const LABEL = "Từ chối tự động do kỳ KPI đã được đóng";

const requests = [];
const customers = [{id: "7d-customer-1", name: "Khách TEST Lịch sử", company_name: "Công ty TEST", phone_raw: "0900000000", phone_normalized: "0900000000",
  owner_user_id: "u_sale1", owner_email: "sale1@example.test", owner: "Sale One", assigned_to: "u_sale1", is_deleted: false, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z"}];
const gateway = await startLocalGateway({root, pg: {...PG, database: DB}, rlsReads: true, staticTables: {customers}, onRequest: r => requests.push(r)});
const {chromium} = await import(pathToFileURL(entry).href).then(m => m.default || m);
const browser = await chromium.launch({executablePath: browserPath, headless: true});

const results = [];
const check = (cond, label, detail = "") => results.push([cond ? "PASS" : "FAIL", `${label}${!cond && detail ? ` — ${detail}` : ""}`]);
const pageErrors = [];
const saleProgressCalls = email => requests.filter(r => r.path === "/rest/v1/rpc/crm_kpi_get_assignment_progress" && r.user === email);

async function login(email, route) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", e => pageErrors.push(`${email}: ${e.message}`));
  page.on("dialog", d => d.dismiss());
  await page.goto(`${gateway.base}/crm${route}`, {waitUntil: "load"});
  await page.fill("#loginEmail", email);
  await page.fill("#loginPassword", "local-fixture");
  await page.click("#loginBtn");
  await page.waitForSelector("#loginView", {state: "hidden", timeout: 15000}).catch(() => {});
  return {context, page};
}
const ctxText = page => page.locator("#kpi2CurrentPeriodContext").innerText();
const options = page => page.$$eval("#kpi2PeriodSelect option", list => list.map(o => ({value: o.value, text: o.textContent})));
const historyText = page => page.locator("#kpi2SaleHistoryRows").innerText();
const count = (page, sel) => page.locator(sel).count();
async function waitMine(page, pattern) {
  await page.waitForSelector("#kpi2OperationsPanel:not(.hide)", {timeout: 15000});
  await page.waitForFunction(src => new RegExp(src).test(document.querySelector("#kpi2CurrentPeriodContext")?.textContent || ""), pattern.source, {timeout: 15000});
}
async function selectPeriod(page, id, notePattern) {
  await page.selectOption("#kpi2PeriodSelect", id);
  if (notePattern) await page.waitForFunction(src => new RegExp(src).test(document.querySelector("#kpi2PeriodViewNote")?.textContent || ""), notePattern.source, {timeout: 15000});
  await page.waitForFunction(() => !/Đang tải KPI của kỳ đã chọn/.test(document.querySelector("#kpi2ProgressRows")?.innerText || ""), null, {timeout: 15000});
  await page.waitForTimeout(300);
}

try {
  // ---- Backend privacy (real RLS, as authenticated sale1) -------------------
  const periodsVisible = asSale(AUTH.sale1, "select string_agg(to_char(period_month,'MM')||':'||status, ',' order by period_month desc) from public.kpi_periods;");
  check(periodsVisible.split("\n").pop() === "10:ACTIVE,09:CLOSED", "RLS: sale1 enumerates only own ACTIVE/CLOSED periods (no DRAFT/CANCELLED/other-Sale)", periodsVisible);
  check(asSale(AUTH.sale1, "select count(*) from public.kpi_submission_events where actor_user_id <> 'u_sale1';").split("\n").pop() === "0", "RLS: sale1 cannot read another Sale's events");
  check(asSale(AUTH.sale1, `select count(*) from public.kpi_assignments where period_id = '${P.jul}';`).split("\n").pop() === "0", "RLS: sale1 cannot read sale2-only July assignments");
  check(asSale(AUTH.sale1, `select count(*) from public.crm_kpi_get_assignment_progress('${P.sep}') where employee_id <> 'u_sale1';`).split("\n").pop() === "0", "progress RPC returns only own September rows");
  check(asSale(AUTH.sale1, `select count(*) from public.kpi_submission_events e join public.kpi_assignments a on a.id = e.assignment_id where a.period_id = '${P.aug}';`).split("\n").pop() === "0", "RLS: CANCELLED period history not readable by Sale (V1 excludes CANCELLED)");

  // ---- Sale with no KPI period, then with exactly one --------------------------
  {
    const {context, page} = await login("sale3@example.test", "#/kpi/mine");
    await waitMine(page, /Chưa có kỳ KPI đang hoạt động/);
    await page.waitForFunction(() => /Bạn chưa có kỳ KPI nào/.test(document.querySelector("#kpi2ProgressRows")?.innerText || ""), null, {timeout: 15000});
    check(true, "sale3 without history: “Bạn chưa có kỳ KPI nào.”");
    check(!(await page.locator("#kpi2PeriodSelectField").isVisible()), "sale3 without history: no empty selector");
    check(saleProgressCalls("sale3@example.test").length === 0, "sale3 without history: no progress RPC at all (no unscoped call)");
    await context.close();
    q(`select lifecycle_test.mk_assignment('7d100000-0000-4000-8000-000000001009', '${P.oct}', 'u_sale3')`);
    const one = await login("sale3@example.test", "#/kpi/mine");
    await waitMine(one.page, /10\/2026/);
    await one.page.waitForSelector("#kpi2PeriodSelectField:not(.hide)");
    const opts = await options(one.page);
    check(opts.length === 1 && opts[0].text === "10/2026 · Đang hoạt động", "Sale with one period: single option, no broken UI", JSON.stringify(opts));
    await one.context.close();
  }

  // ---- sale1: current October default, September history ------------------------
  {
    const {context, page} = await login("sale1@example.test", "#/kpi/mine");
    await waitMine(page, /10\/2026/);
    await page.waitForSelector("#kpi2PeriodSelectField:not(.hide)");
    const opts = await options(page);
    check(q(`select name = normalize(name, NFD) and name <> normalize(name, NFC) from public.kpi_periods where id = '${P.sep}'`) === "t", "fixture: September name stored in Unicode NFD (as in Production)");
    check(JSON.stringify(opts.map(o => o.text)) === JSON.stringify(["10/2026 · Đang hoạt động", "09/2026 · Đã đóng"]), "selector: newest first, ACTIVE + CLOSED only, clear labels", JSON.stringify(opts));
    check(await page.inputValue("#kpi2PeriodSelect") === P.oct, "initial view = current October");
    check(!(await page.locator("#kpi2PeriodViewNote").isVisible()), "October: no historical banner");
    await page.waitForFunction(() => /2 đề xuất/.test(document.querySelector("#kpi2SaleHistoryCount")?.textContent || ""), null, {timeout: 15000});
    check(await count(page, "[data-kpi2-open-claim]") === 2, "October: proposal action available on both current assignments");
    check(await count(page, "[data-kpi2-withdraw-event]") === 1, "October: pending proposal can be withdrawn");
    const initialCalls = requests.filter(r => r.user === "sale1@example.test");
    check(initialCalls.filter(r => r.path.endsWith("crm_kpi_get_assignment_progress")).every(r => r.body?.p_period_id === P.oct), "initial load: only October progress requested (lazy history)");

    // September (CLOSED) read-only
    const before = requests.length;
    await selectPeriod(page, P.sep, /ĐÃ ĐÓNG · Chỉ xem/);
    const sepCalls = requests.slice(before);
    check(sepCalls.some(r => r.path.endsWith("crm_kpi_get_assignment_progress") && r.body?.p_period_id === P.sep), "September: progress RPC with explicit September id");
    const eventsCall = sepCalls.find(r => r.path === "/rest/v1/kpi_submission_events");
    check(eventsCall && eventsCall.url.includes(A.sepVisit) && !eventsCall.url.includes(A.octVisit), "September: events query scoped to September assignments only");
    const note = await page.locator("#kpi2PeriodViewNote").innerText();
    check(note.includes("Đang xem kỳ 09/2026 · ĐÃ ĐÓNG · Chỉ xem") && note.includes("Đề xuất mới luôn thuộc kỳ hiện tại 10/2026"), "September: clear “ĐÃ ĐÓNG · Chỉ xem” banner", note);
    await page.waitForFunction(() => /7 đề xuất/.test(document.querySelector("#kpi2SaleHistoryCount")?.textContent || ""), null, {timeout: 15000});
    const hist = await historyText(page);
    check((hist.match(new RegExp(LABEL, "g")) || []).length === 3, "September: 3 PERIOD_CLOSED proposals with Vietnamese label");
    check(!hist.includes("PERIOD_CLOSED"), "September: no raw PERIOD_CLOSED code");
    check(hist.includes("Đã duyệt") && hist.includes("Đã thu hồi") && hist.includes("Lý do: DUPLICATE"), "September: APPROVED / WITHDRAWN / manual REJECTED history distinguished");
    check(await count(page, "[data-kpi2-open-claim]") === 0 && await count(page, "[data-kpi2-open-revision]") === 0 && await count(page, "[data-kpi2-withdraw-event]") === 0, "September: no proposal / revision / withdraw controls");
    const cards = await page.locator("#kpi2ProgressRows").innerText();
    check(/2 \/ 10/.test(cards) && !/1 \/ 10/.test(cards), "September: backend actual (2/10) — no October values mixed in", cards.replace(/\s+/g, " ").slice(0, 200));
    await page.locator("#kpi2SaleHistoryRows [data-kpi2-view-evidence]").first().click();
    await page.waitForFunction(() => /Minh chứng KPI/.test(document.body.innerText) && document.querySelectorAll("img[src*='/object/sign/']").length > 0, null, {timeout: 15000})
      .then(() => check(true, "September: attached evidence still viewable"), () => check(false, "September: attached evidence still viewable"));
    await page.keyboard.press("Escape");

    // Customer-origin while September is selected → must use current October
    const subBefore = requests.filter(r => /crm_kpi_(submit|stage|withdraw)/.test(r.path)).length;
    await page.evaluate(() => { location.hash = "#/customers/list"; });
    await page.waitForSelector('[data-kpi2-customer-entry="7d-customer-1"]', {timeout: 15000});
    await page.click('[data-kpi2-customer-entry="7d-customer-1"]');
    await page.waitForSelector("#kpi2SaleClaimPanel:not(.hide)", {timeout: 15000});
    const choiceValues = await page.$$eval("#kpi2ClaimAssignmentSelect option", list => list.map(o => o.value).filter(Boolean));
    check(JSON.stringify(choiceValues) === JSON.stringify([A.octCustomer]), "Customer-origin after viewing September: choices = October only (September = 0)", JSON.stringify(choiceValues));
    check(!choiceValues.includes(A.sepCustomer), "Customer-origin: no September assignment offered");
    await page.click("#kpi2CloseClaimBtn");
    check(requests.filter(r => /crm_kpi_(submit|stage|withdraw)/.test(r.path)).length === subBefore, "Customer-origin check: no submission / staging");

    // Return to October
    await page.evaluate(() => { location.hash = "#/kpi/mine"; });
    await page.waitForSelector("#kpi2PeriodSelectField:not(.hide)");
    await selectPeriod(page, P.oct);
    await page.waitForFunction(() => /2 đề xuất/.test(document.querySelector("#kpi2SaleHistoryCount")?.textContent || ""), null, {timeout: 15000});
    check(!(await page.locator("#kpi2PeriodViewNote").isVisible()) && await count(page, "[data-kpi2-open-claim]") === 2, "return to October: operational cards and actions back");
    check(!(await historyText(page)).includes(LABEL), "October: no September history leaked");

    // Reload while September selected → back to October, nothing persisted
    await selectPeriod(page, P.sep, /ĐÃ ĐÓNG/);
    const stored = await page.evaluate(ids => JSON.stringify({...localStorage}) + JSON.stringify({...sessionStorage}) + document.cookie + location.href, [P.sep]);
    check(!stored.includes(P.sep), "historical selection not stored (localStorage/sessionStorage/cookie/URL)");
    await page.reload({waitUntil: "load"});
    await waitMine(page, /10\/2026/);
    await page.waitForSelector("#kpi2PeriodSelectField:not(.hide)");
    check(await page.inputValue("#kpi2PeriodSelect") === P.oct && !(await page.locator("#kpi2PeriodViewNote").isVisible()), "fresh reload returns to current October");
    await context.close();
  }

  // ---- Overlapping current ACTIVE periods ----------------------------------------
  q(`insert into public.kpi_periods(id, period_month, name, status, starts_at, ends_at, created_by_user_id, activated_by_user_id, activated_at)
     select '${P.dec}', '2026-12-01', '[KPI TEST] overlap', 'ACTIVE', starts_at, ends_at, 'u_owner', 'u_owner', now() from public.kpi_periods where id = '${P.oct}';
     select lifecycle_test.mk_assignment('7d100000-0000-4000-8000-000000001201', '${P.dec}', 'u_sale1', '7d000000-0000-4000-8000-00000000d003');`);
  {
    const {context, page} = await login("sale1@example.test", "#/kpi/mine");
    await waitMine(page, /nhiều kỳ KPI ACTIVE/);
    await page.waitForSelector("#kpi2PeriodSelectField:not(.hide)");
    check(await page.inputValue("#kpi2PeriodSelect") === P.sep, "overlap: operational state ambiguous; view defaults to newest CLOSED history, not first ACTIVE row");
    check(await count(page, "[data-kpi2-open-claim]") === 0 && await count(page, "[data-kpi2-withdraw-event]") === 0, "overlap: no write action on history");
    await selectPeriod(page, P.oct, /KHÔNG PHẢI KỲ HIỆN TẠI · Chỉ xem/);
    check(await count(page, "[data-kpi2-open-claim]") === 0 && await count(page, "[data-kpi2-withdraw-event]") === 0, "overlap: an ACTIVE period is still read-only while current is ambiguous");
    await page.evaluate(() => { location.hash = "#/customers/list"; });
    await page.waitForSelector('[data-kpi2-customer-entry="7d-customer-1"]', {timeout: 15000});
    await page.click('[data-kpi2-customer-entry="7d-customer-1"]');
    await page.waitForFunction(() => /nhiều kỳ KPI ACTIVE/.test(document.querySelector("#notice")?.textContent || ""), null, {timeout: 15000})
      .then(() => check(true, "overlap: Customer-origin fails closed"), () => check(false, "overlap: Customer-origin fails closed"));
    check(!(await page.locator("#kpi2SaleClaimPanel").isVisible()), "overlap: no proposal form opened");
    await context.close();
  }
  q(`delete from public.kpi_assignments where period_id = '${P.dec}'; delete from public.kpi_periods where id = '${P.dec}';`);

  // ---- No current ACTIVE period (October closed) ----------------------------------
  q(`do $$ declare v integer; begin select version into v from public.kpi_periods where id = '${P.oct}';
       perform lifecycle_test.actor('u_manager'); perform public.crm_kpi_close_period_foundation('${P.oct}', v); end $$;`);
  {
    const {context, page} = await login("sale1@example.test", "#/kpi/mine");
    await waitMine(page, /Chưa có kỳ KPI đang hoạt động/);
    await page.waitForSelector("#kpi2PeriodSelectField:not(.hide)");
    const opts = await options(page);
    check(JSON.stringify(opts.map(o => o.text)) === JSON.stringify(["10/2026 · Đã đóng", "09/2026 · Đã đóng"]), "no current ACTIVE: history options still listed", JSON.stringify(opts));
    check(await page.inputValue("#kpi2PeriodSelect") === P.oct, "no current ACTIVE: newest relevant CLOSED period shown");
    await page.waitForFunction(() => /Hiện không có kỳ KPI đang hoạt động/.test(document.querySelector("#kpi2PeriodViewNote")?.textContent || ""), null, {timeout: 15000});
    check(true, "no current ACTIVE: banner says historical / no new proposals");
    check(await count(page, "[data-kpi2-open-claim]") === 0, "no current ACTIVE: proposal actions = 0");
    await page.evaluate(() => { location.hash = "#/customers/list"; });
    await page.waitForSelector('[data-kpi2-customer-entry="7d-customer-1"]', {timeout: 15000});
    await page.click('[data-kpi2-customer-entry="7d-customer-1"]');
    await page.waitForFunction(() => /Chưa có kỳ KPI đang hoạt động/.test(document.querySelector("#notice")?.textContent || ""), null, {timeout: 15000})
      .then(() => check(true, "no current ACTIVE: Customer-origin fails closed with clear message"), () => check(false, "no current ACTIVE: Customer-origin fails closed"));
    check(!(await page.locator("#kpi2SaleClaimPanel").isVisible()), "no current ACTIVE: no proposal form opened");
    await context.close();
  }

  // ---- Manager: unchanged, no Sale selector ----------------------------------------
  {
    const {context, page} = await login("manager@example.test", "#/kpi/library");
    await page.waitForSelector(`[data-kpi1-select-period="${P.sep}"]`, {timeout: 15000});
    check(await count(page, `[data-kpi1-select-period="${P.nov}"]`) === 1, "Manager still sees all periods incl. DRAFT in Bộ KPI (unchanged)");
    await page.evaluate(() => { location.hash = "#/kpi/team"; });
    await page.waitForSelector("#kpiTeamPeriod");
    check((await page.$$eval("#kpiTeamPeriod option", l => l.length)) >= 3, "Manager KPI Team period selector unchanged");
    check(!(await page.locator("#kpi2PeriodSelectField").isVisible()), "Manager: no Sale history selector");
    await context.close();
  }

  // ---- Global observability --------------------------------------------------------
  const saleProgress = requests.filter(r => r.path === "/rest/v1/rpc/crm_kpi_get_assignment_progress" && /sale/.test(r.user || ""));
  check(saleProgress.length > 0 && saleProgress.every(r => r.body && typeof r.body.p_period_id === "string" && r.body.p_period_id.length === 36), `Sale progress calls always explicit p_period_id (${saleProgress.length} calls, 0 null)`);
  check(requests.filter(r => /sale/.test(r.user || "") && /crm_kpi_(submit|stage|withdraw|review|close|cancel|reopen|finalize|request_discard)/.test(r.path)).length === 0, "no Sale business writes during the whole run");
  check(requests.filter(r => r.ignoredWrite && /kpi_/.test(r.path)).length === 0, "no direct KPI table writes");
  const relevant = pageErrors.filter(e => !/WebSocket|realtime/i.test(e));
  check(relevant.length === 0, `browser page errors = ${relevant.length}`, relevant.slice(0, 3).join(" | "));
} catch (error) {
  results.push(["FAIL", `exception: ${error.message.split("\n")[0]}`]);
} finally {
  await browser.close();
  await gateway.close();
  psql("postgres", `drop database if exists ${DB} with (force)`);
}

for (const [status, label] of results) console.log(`${status} ${label}`);
const failed = results.filter(([s]) => s === "FAIL").length;
console.log(`\nKPI 7D Sale period history (browser + disposable DB + RLS): ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
