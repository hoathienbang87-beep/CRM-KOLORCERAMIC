import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ref = process.env.STAGING_PROJECT_REF || "";
const base = (process.env.STAGING_SUPABASE_URL || "").replace(/\/$/, "");
const anon = process.env.STAGING_ANON_KEY || "";
const service = process.env.STAGING_SERVICE_ROLE_KEY || "";
if (ref !== "ykhtpvyelpujykheycsv" || base !== `https://${ref}.supabase.co` || !anon || !service) {
  throw new Error("KPI-2R.2 UI staging guard failed.");
}

const { chromium } = await import(pathToFileURL(process.env.KPI2_PLAYWRIGHT_ENTRY).href);
const root = path.resolve(import.meta.dirname, "..");
const run = crypto.randomBytes(5).toString("hex");
const password = `${crypto.randomBytes(18).toString("base64url")}aA1!`;
const users = ["manager", "sale"].map(role => ({
  role,
  id: `kpi2r2-ui-${run}-${role}`,
  email: `kpi2r2-ui-${run}-${role}@example.com`,
}));
const authIds = [];
const checks = [];
let browser;
let server;
let periodId;
let definitionId;
let assignmentId;

const ok = (name, value) => {
  if (!value) throw new Error(`CHECK FAILED: ${name}`);
  checks.push(name);
};

async function req(endpoint, { method = "GET", token = service, key = service, body, allow = false } = {}) {
  const response = await fetch(`${base}${endpoint}`, {
    method,
    signal: AbortSignal.timeout(90000),
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!allow && !response.ok) throw new Error(`${method} ${endpoint}: HTTP ${response.status}`);
  return { ok: response.ok, status: response.status, data };
}

const rpc = (user, name, body, allow = false) => req(`/rest/v1/rpc/${name}`, {
  method: "POST",
  token: user.token,
  key: anon,
  body,
  allow,
});

const storageObjects = prefix => req("/storage/v1/object/list/kpi2-evidence", {
  method: "POST",
  body: { prefix, limit: 100, offset: 0, sortBy: { column: "name", order: "asc" } },
});

async function createUser(user) {
  const auth = await req("/auth/v1/admin/users", {
    method: "POST",
    body: { email: user.email, password, email_confirm: true },
  });
  user.authId = auth.data.id;
  authIds.push(user.authId);
  await req("/rest/v1/app_users", {
    method: "POST",
    body: {
      id: user.id,
      supabase_auth_id: user.authId,
      email: user.email,
      name: `KPI2R2 UI ${user.role}`,
      role: user.role,
      active: true,
      lifecycle_status: "active",
      raw_data: { testRun: run, purpose: "KPI-2R.2 UI staging" },
    },
  });
  const login = await req("/auth/v1/token?grant_type=password", {
    method: "POST",
    token: anon,
    key: anon,
    body: { email: user.email, password },
  });
  user.token = login.data.access_token;
}

function serve() {
  server = http.createServer((request, response) => {
    const url = decodeURIComponent((request.url || "/").split("?")[0]);
    if (url === "/js/supabase-config.js") {
      response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
      response.end(`window.CRM_SUPABASE_CONFIG=${JSON.stringify({ url: base, anonKey: anon })}`);
      return;
    }
    const file = path.resolve(root, url === "/" ? "index.html" : url.replace(/^\//, ""));
    if (!file.startsWith(root) || !fs.existsSync(file)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

async function login(page, user) {
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "networkidle" });
  await page.locator("#loginEmail").fill(user.email);
  await page.locator("#loginPassword").fill(password);
  await page.locator("#loginBtn").click();
  await page.locator("#appView").waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#kpiViewBtn").click();
  await page.locator("#kpi2OperationsPanel").waitFor({ state: "visible" });
}

async function canonicalCleanupSaleEvidence(sale) {
  const evidenceRows = (await req(
    `/rest/v1/kpi_evidence?uploaded_by_user_id=eq.${sale.id}&select=id,object_path,status,lock_version`
  )).data;
  for (const row of evidenceRows) {
    if (row.status === "ATTACHED") throw new Error("UI cleanup found unexpected ATTACHED evidence.");
    let lockVersion = Number(row.lock_version);
    if (row.status === "STAGED") {
      const requested = await rpc(sale, "crm_kpi_request_discard_staged_evidence", {
        p_evidence_id: row.id,
        p_request_id: crypto.randomUUID(),
        p_expected_lock_version: lockVersion,
      });
      lockVersion = Number(requested.data.lockVersion);
    }
    await req("/storage/v1/object/kpi2-evidence", {
      method: "DELETE",
      token: sale.token,
      key: anon,
      body: { prefixes: [row.object_path] },
    });
    await rpc(sale, "crm_kpi_finalize_discard_staged_evidence", {
      p_evidence_id: row.id,
      p_request_id: crypto.randomUUID(),
      p_expected_lock_version: lockVersion,
    });
  }
}

async function cleanup() {
  const sale = users.find(user => user.role === "sale");
  if (sale?.token) await canonicalCleanupSaleEvidence(sale);
  await req(`/rest/v1/kpi_action_requests?actor_user_id=like.kpi2r2-ui-${run}-*`, { method: "DELETE", allow: true });
  if (assignmentId) await req(`/rest/v1/kpi_assignments?id=eq.${assignmentId}`, { method: "DELETE", allow: true });
  if (definitionId) await req(`/rest/v1/kpi_definitions?id=eq.${definitionId}`, { method: "DELETE", allow: true });
  if (periodId) await req(`/rest/v1/kpi_periods?id=eq.${periodId}`, { method: "DELETE", allow: true });
  await req(`/rest/v1/audit_logs?email=like.kpi2r2-ui-${run}-*`, { method: "DELETE", allow: true });
  await req(`/rest/v1/app_users?id=like.kpi2r2-ui-${run}-*`, { method: "DELETE", allow: true });
  for (const id of authIds.reverse()) await req(`/auth/v1/admin/users/${id}`, { method: "DELETE", allow: true });
}

const upload = (page, names, buffer) => page.locator("#kpi2EvidenceFiles").setInputFiles(
  names.map(name => ({ name, mimeType: "image/png", buffer }))
);

try {
  for (const user of users) await createUser(user);
  const manager = users.find(user => user.role === "manager");
  const sale = users.find(user => user.role === "sale");
  const used = (await req("/rest/v1/kpi_periods?select=period_month")).data.map(row => row.period_month);
  const month = ["2022-01-01", "2022-02-01", "2022-03-01", "2022-04-01", "2022-05-01", "2022-06-01", "2022-07-01", "2022-08-01", "2022-09-01", "2022-10-01", "2022-11-01", "2022-12-01"].find(value => !used.includes(value));
  if (!month) throw new Error("No unused staging month for KPI-2R.2 UI fixture.");

  const period = (await rpc(manager, "crm_kpi_create_period", {
    p_period_month: month,
    p_name: `KPI2R2 UI ${run}`,
    p_timezone: "Asia/Ho_Chi_Minh",
  })).data;
  periodId = period.id;
  const definition = (await rpc(manager, "crm_kpi_create_definition_v2", {
    p_code: `KPI2R2_UI_${run}`.toUpperCase(),
    p_name: "KPI2R2 UI evidence",
    p_description: "staging fixture",
    p_kpi_type: "MANUAL",
    p_source_metric_key: null,
    p_unit: "luot",
    p_submission_mode: "EVENT_CLAIM",
    p_evidence_required: false,
    p_aggregation_mode: "COUNT",
    p_max_images_per_event: 2,
    p_location_required: false,
    p_timestamp_required: true,
  })).data;
  definitionId = definition.id;
  const assignment = (await rpc(manager, "crm_kpi_assign_employee", {
    p_period_id: periodId,
    p_definition_id: definitionId,
    p_employee_id: sale.id,
    p_target: 2,
    p_expected_period_version: period.version,
  })).data;
  assignmentId = assignment.id;
  await rpc(manager, "crm_kpi_activate_period", {
    p_period_id: periodId,
    p_expected_version: assignment.periodVersion,
  });

  await serve();
  browser = await chromium.launch({ executablePath: process.env.KPI2_BROWSER_PATH, headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await login(page, sale);
  await page.locator("[data-kpi2-open-claim]").click();
  const fixtureImage = await page.screenshot({ type: "png" });

  await upload(page, ["network-retry.png"], fixtureImage);
  try {
    await page.locator("[data-kpi2-discard-evidence]").waitFor({ timeout: 30000 });
  } catch (error) {
    const noticeText = await page.locator("#notice").textContent().catch(() => "");
    const loginError = await page.locator("#loginError").textContent().catch(() => "");
    const listText = await page.locator("#kpi2StagedEvidenceList").textContent().catch(() => "");
    throw new Error(`Initial UI upload failed. notice=${noticeText}; login=${loginError}; list=${listText}; pageErrors=${pageErrors.join(" | ")}; cause=${error.message}`);
  }
  ok("UI stages image immediately", (await req(`/rest/v1/kpi_evidence?assignment_id=eq.${assignmentId}&status=eq.STAGED&select=id`)).data.length === 1);

  let aborted = false;
  await page.route("**/rest/v1/rpc/crm_kpi_request_discard_staged_evidence", async route => {
    if (!aborted) {
      aborted = true;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.locator("[data-kpi2-discard-evidence]").click();
  await page.waitForTimeout(800);
  ok("UI keeps image after discard error", await page.locator("[data-kpi2-discard-evidence]").count() === 1);
  await page.unroute("**/rest/v1/rpc/crm_kpi_request_discard_staged_evidence");
  await page.locator("[data-kpi2-discard-evidence]").click();
  await page.locator("[data-kpi2-discard-evidence]").waitFor({ state: "detached", timeout: 30000 });
  ok("UI retry discards image", (await req(`/rest/v1/kpi_evidence?assignment_id=eq.${assignmentId}&select=id`)).data.length === 0);

  await upload(page, ["first.png", "second.png"], fixtureImage);
  await page.waitForFunction(() => document.querySelectorAll("[data-kpi2-discard-evidence]").length === 2, null, { timeout: 30000 });
  ok("UI accepts maximum two staged images", await page.locator("[data-kpi2-discard-evidence]").count() === 2);
  await page.locator("[data-kpi2-discard-evidence]").first().click();
  await page.waitForFunction(() => document.querySelectorAll("[data-kpi2-discard-evidence]").length === 1, null, { timeout: 30000 });
  await upload(page, ["replacement.png"], fixtureImage);
  await page.waitForFunction(() => document.querySelectorAll("[data-kpi2-discard-evidence]").length === 2, null, { timeout: 30000 });
  ok("UI permits replacement after one discard", await page.locator("[data-kpi2-discard-evidence]").count() === 2);

  page.once("dialog", dialog => dialog.accept());
  await page.locator("#kpi2CloseClaimBtn").click();
  await page.locator("#kpi2SaleClaimPanel").waitFor({ state: "hidden", timeout: 30000 });
  ok("Cancel form discards all pending metadata", (await req(`/rest/v1/kpi_evidence?assignment_id=eq.${assignmentId}&select=id`)).data.length === 0);
  ok("Cancel form leaves no Storage object", (await storageObjects(`kpi2/${sale.id}`)).data.length === 0);
  ok("UI has no uncaught page errors", pageErrors.length === 0);

  console.log(`KPI-2R.2 staging UI: PASS (${checks.length} checks)`);
  checks.forEach(name => console.log(`PASS: ${name}`));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
  await cleanup();
}
