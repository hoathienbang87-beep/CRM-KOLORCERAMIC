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
  throw new Error("KPI-2.1B UI staging guard failed.");
}

const { chromium } = await import(pathToFileURL(process.env.KPI21B_PLAYWRIGHT_ENTRY).href);
const root = path.resolve(import.meta.dirname, "..");
const run = crypto.randomBytes(5).toString("hex");
const password = `${crypto.randomBytes(18).toString("base64url")}aA1!`;
const users = ["manager", "sale-a", "sale-b"].map(role => ({
  role: role === "manager" ? "manager" : "sale",
  key: role,
  id: `kpi21b-ui-${run}-${role}`,
  email: `kpi21b-ui-${run}-${role}@example.com`,
  name: role === "manager" ? "KPI21B Manager" : role === "sale-a" ? "KPI21B Sale A" : "KPI21B Sale B"
}));
const authIds = [];
const checks = [];
const assignmentIds = [];
const eventIds = [];
let browser;
let server;
let periodId;
let definitionId;
let artifactDir;

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
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  let data = null;
  if (raw) { try { data = JSON.parse(raw); } catch { data = raw; } }
  if (!allow && !response.ok) throw new Error(`${method} ${endpoint}: HTTP ${response.status}`);
  return {ok:response.ok, status:response.status, data};
}

const rpc = (user, name, body, allow = false) => req(`/rest/v1/rpc/${name}`, {
  method:"POST", token:user.token, key:anon, body, allow
});

async function createUser(user) {
  const auth = await req("/auth/v1/admin/users", {method:"POST", body:{email:user.email, password, email_confirm:true}});
  user.authId = auth.data.id;
  authIds.push(user.authId);
  await req("/rest/v1/app_users", {method:"POST", body:{
    id:user.id, supabase_auth_id:user.authId, email:user.email, name:user.name,
    role:user.role, active:true, lifecycle_status:"active",
    raw_data:{testRun:run, purpose:"KPI-2.1B employee-centric staging UI"}
  }});
  const login = await req("/auth/v1/token?grant_type=password", {method:"POST", token:anon, key:anon, body:{email:user.email, password}});
  user.token = login.data.access_token;
}

function serve() {
  server = http.createServer((request, response) => {
    const url = decodeURIComponent((request.url || "/").split("?")[0]);
    if (url === "/js/supabase-config.js") {
      response.writeHead(200, {"Content-Type":"text/javascript", "Cache-Control":"no-store"});
      response.end(`window.CRM_SUPABASE_CONFIG=${JSON.stringify({url:base, anonKey:anon})}`);
      return;
    }
    const file = path.resolve(root, url === "/" ? "index.html" : url.replace(/^\//, ""));
    if (!file.startsWith(root) || !fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, {
      "Content-Type":file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html",
      "Cache-Control":"no-store"
    });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

async function loginManager(page, user) {
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:"networkidle"});
  await page.locator("#loginEmail").fill(user.email);
  await page.locator("#loginPassword").fill(password);
  await page.locator("#loginBtn").click();
  await page.locator("#appView").waitFor({state:"visible", timeout:30000});
  await page.locator("#kpiViewBtn").click();
  await page.locator("#kpiTeamPanel").waitFor({state:"visible", timeout:30000});
}

async function cleanup() {
  for (const id of eventIds) await req(`/rest/v1/kpi_duplicate_matches?or=(event_id.eq.${id},duplicate_event_id.eq.${id})`, {method:"DELETE", allow:true});
  for (const id of eventIds) await req(`/rest/v1/kpi_evidence?event_id=eq.${id}`, {method:"DELETE", allow:true});
  for (const id of eventIds) await req(`/rest/v1/kpi_submission_events?id=eq.${id}`, {method:"DELETE", allow:true});
  for (const id of assignmentIds) await req(`/rest/v1/kpi_submissions?assignment_id=eq.${id}`, {method:"DELETE", allow:true});
  await req(`/rest/v1/kpi_action_requests?actor_user_id=like.kpi21b-ui-${run}-*`, {method:"DELETE", allow:true});
  for (const id of assignmentIds.reverse()) await req(`/rest/v1/kpi_assignments?id=eq.${id}`, {method:"DELETE", allow:true});
  if (definitionId) await req(`/rest/v1/kpi_definitions?id=eq.${definitionId}`, {method:"DELETE", allow:true});
  if (periodId) await req(`/rest/v1/kpi_periods?id=eq.${periodId}`, {method:"DELETE", allow:true});
  await req(`/rest/v1/audit_logs?email=like.kpi21b-ui-${run}-*`, {method:"DELETE", allow:true});
  await req(`/rest/v1/app_users?id=like.kpi21b-ui-${run}-*`, {method:"DELETE", allow:true});
  for (const id of authIds.reverse()) await req(`/auth/v1/admin/users/${id}`, {method:"DELETE", allow:true});
}

try {
  for (const user of users) await createUser(user);
  const manager = users.find(user => user.key === "manager");
  const saleA = users.find(user => user.key === "sale-a");
  const saleB = users.find(user => user.key === "sale-b");
  const used = (await req("/rest/v1/kpi_periods?select=period_month")).data.map(row => row.period_month);
  const month = Array.from({length:12}, (_, i) => `2021-${String(i + 1).padStart(2,"0")}-01`).find(value => !used.includes(value));
  if (!month) throw new Error("No unused staging month for KPI-2.1B fixture.");
  const period = (await rpc(manager, "crm_kpi_create_period", {p_period_month:month, p_name:`KPI21B ${run}`, p_timezone:"Asia/Ho_Chi_Minh"})).data;
  periodId = period.id;
  const definition = (await rpc(manager, "crm_kpi_create_definition_v2", {
    p_code:`KPI21B_${run}`.toUpperCase(), p_name:"KPI21B Snapshot Original", p_description:"staging fixture",
    p_kpi_type:"MANUAL", p_source_metric_key:null, p_unit:"lượt", p_submission_mode:"EVENT_CLAIM",
    p_evidence_required:false, p_aggregation_mode:"COUNT", p_max_images_per_event:2,
    p_location_required:false, p_timestamp_required:true
  })).data;
  definitionId = definition.id;
  const assignmentA = (await rpc(manager, "crm_kpi_assign_employee", {
    p_period_id:periodId, p_definition_id:definitionId, p_employee_id:saleA.id, p_target:2,
    p_expected_period_version:period.version
  })).data;
  assignmentIds.push(assignmentA.id);

  await serve();
  artifactDir = path.join("D:\\SUPABASE\\BACKUP-TEMP", `kpi21b-ui-${run}`);
  fs.mkdirSync(artifactDir, {recursive:true});
  browser = await chromium.launch({executablePath:process.env.KPI21B_BROWSER_PATH, headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const kpiRequests = [];
  page.on("request", request => {
    if (/crm_kpi_get_(assignment_progress|monthly_scores)/.test(request.url())) kpiRequests.push(request.url());
  });
  await loginManager(page, manager);
  await page.locator("#kpiTeamPeriod").selectOption(periodId);
  await page.waitForFunction(() => !document.querySelector("#kpiTeamStatus")?.textContent?.includes("Đang tải"), null, {timeout:30000});
  await page.waitForFunction(() => performance.getEntriesByType("resource").some(entry => entry.name.includes("crm_kpi_get_monthly_scores")), null, {timeout:30000});
  await page.locator(".kpi-team-employee-row").filter({hasText:saleA.name}).waitFor({timeout:30000});
  await page.locator(".kpi-team-employee-row").filter({hasText:saleB.name}).waitFor({timeout:30000});
  ok("Employee-centric landing is default", await page.locator("#kpiTeamEmployeesModeBtn.primary").count() === 1);
  ok("Assigned Sale appears", await page.locator(".kpi-team-employee-row").filter({hasText:saleA.name}).count() === 1);
  const zeroRow = page.locator(".kpi-team-employee-row").filter({hasText:saleB.name});
  ok("Zero-KPI Sale appears", (await zeroRow.textContent()).includes("0 KPI"));
  kpiRequests.length = 0;
  const progressResponse = page.waitForResponse(response => response.url().includes("crm_kpi_get_assignment_progress"), {timeout:30000});
  const scoreResponse = page.waitForResponse(response => response.url().includes("crm_kpi_get_monthly_scores"), {timeout:30000});
  await page.locator("#kpiTeamReloadBtn").click();
  await Promise.all([progressResponse, scoreResponse]);
  await page.waitForFunction(() => !document.querySelector("#kpiTeamStatus")?.textContent?.includes("Đang tải"), null, {timeout:30000});
  const progressRequests = kpiRequests.filter(url => url.includes("assignment_progress")).length;
  const scoreRequests = kpiRequests.filter(url => url.includes("monthly_scores")).length;
  ok(`Landing uses fixed two KPI RPC requests (progress=${progressRequests}, score=${scoreRequests})`, progressRequests === 1 && scoreRequests === 1);

  await zeroRow.locator("[data-kpi-team-assign-employee]").click();
  await page.locator("#kpiTeamAssignDrawer").waitFor({state:"visible"});
  await page.locator("#kpiTeamAssignDefinition").selectOption(definitionId);
  await page.locator("#kpiTeamAssignTarget").fill("7");
  await page.locator("#kpiTeamAssignSubmitBtn").click();
  await page.locator("#kpiTeamAssignDrawer").waitFor({state:"hidden", timeout:30000});
  const assignmentBRows = (await req(`/rest/v1/kpi_assignments?period_id=eq.${periodId}&employee_id=eq.${saleB.id}&select=id,target,score_enabled`)).data;
  ok("Assign KPI UI persists server data", assignmentBRows.length === 1 && Number(assignmentBRows[0].target) === 7);
  assignmentIds.push(assignmentBRows[0].id);

  const currentPeriod = (await req(`/rest/v1/kpi_periods?id=eq.${periodId}&select=id,version`)).data[0];
  await rpc(manager, "crm_kpi_activate_period", {p_period_id:periodId, p_expected_version:currentPeriod.version});
  const submitEvent = async (sale, assignmentId, title) => {
    const eventAt = `${month.slice(0,7)}-15T10:00:00+07:00`;
    const response = await rpc(sale, "crm_kpi_submit_events", {
      p_assignment_id:assignmentId, p_request_id:crypto.randomUUID(), p_sale_note:"KPI-2.1B staging",
      p_events:[{sourceType:"MANUAL", sourceEventKey:`manual:${crypto.randomUUID()}`, eventAt, claimedValue:1, eventSnapshot:{title,description:title}, evidenceIds:[]}]
    });
    const eventId = response.data?.events?.[0]?.id || response.data?.eventIds?.[0];
    if (eventId) eventIds.push(eventId);
  };
  await submitEvent(saleA, assignmentA.id, "KPI21B Event Sale A");
  await submitEvent(saleB, assignmentBRows[0].id, "KPI21B Event Sale B");
  if (eventIds.length < 2) {
    const rows = (await req(`/rest/v1/kpi_submission_events?assignment_id=in.(${assignmentA.id},${assignmentBRows[0].id})&select=id`)).data;
    rows.forEach(row => { if (!eventIds.includes(row.id)) eventIds.push(row.id); });
  }

  await page.locator("#kpiTeamReloadBtn").click();
  await page.waitForTimeout(1200);
  const saleARow = page.locator(".kpi-team-employee-row").filter({hasText:saleA.name});
  await saleARow.locator("[data-kpi-team-open-employee]").click();
  await page.locator("#kpiTeamDetailDrawer").waitFor({state:"visible"});
  await page.locator('[data-kpi-employee-tab="proposals"]').click();
  await page.locator(".kpi-team-event-card").filter({hasText:"KPI21B Event Sale A"}).waitFor({timeout:30000});
  ok("Employee proposal grouping shows Sale A event", await page.locator(".kpi-team-event-card").filter({hasText:"KPI21B Event Sale A"}).count() === 1);
  ok("Employee proposal grouping hides Sale B event", await page.locator(".kpi-team-event-card").filter({hasText:"KPI21B Event Sale B"}).count() === 0);
  await page.locator('[data-kpi2-review-event]').check();
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#kpiTeamReviewBtn").click();
  await page.locator(".kpi-team-event-card").filter({hasText:"Đã duyệt"}).waitFor({timeout:30000});
  const approvedA = (await req(`/rest/v1/kpi_submission_events?assignment_id=eq.${assignmentA.id}&select=status,approved_value`)).data;
  ok("Event review read-back is approved", approvedA.some(row => row.status === "APPROVED" && Number(row.approved_value) === 1));

  const currentDefinition = (await req(`/rest/v1/kpi_definitions?id=eq.${definitionId}&select=id,version`)).data[0];
  await rpc(manager, "crm_kpi_update_definition_v2", {p_definition_id:definitionId, p_expected_version:currentDefinition.version, p_changes:{name:"KPI21B Current Name Changed"}});
  await page.locator('[data-kpi-employee-tab="history"]').click();
  await page.locator(".kpi-team-history-detail").first().waitFor({timeout:30000});
  await page.locator(".kpi-team-history-detail").first().locator("summary").click();
  ok("History uses immutable definition snapshot", (await page.locator("#kpiTeamDetailContent").textContent()).includes("KPI21B Snapshot Original"));
  ok("History does not leak current definition name", !(await page.locator("#kpiTeamDetailContent").textContent()).includes("KPI21B Current Name Changed"));

  await page.screenshot({path:path.join(artifactDir,"desktop-1440.png"), fullPage:true});
  await page.setViewportSize({width:1024,height:900});
  await page.screenshot({path:path.join(artifactDir,"tablet-1024.png"), fullPage:true});
  await page.setViewportSize({width:390,height:844});
  const drawerBox = await page.locator("#kpiTeamDetailDrawer").boundingBox();
  ok("Mobile detail drawer is full width", drawerBox && drawerBox.width >= 389);
  await page.screenshot({path:path.join(artifactDir,"mobile-390.png"), fullPage:true});
  ok("No uncaught browser errors", pageErrors.length === 0);

  console.log(`KPI-2.1B staging UI: PASS (${checks.length} checks)`);
  console.log(`Artifacts: ${artifactDir}`);
  checks.forEach(name => console.log(`PASS: ${name}`));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
  await cleanup();
}
