import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {pathToFileURL} from "node:url";

const ref = process.env.STAGING_PROJECT_REF || "";
const base = (process.env.STAGING_SUPABASE_URL || "").replace(/\/$/, "");
const anon = process.env.STAGING_ANON_KEY || "";
const service = process.env.STAGING_SERVICE_ROLE_KEY || "";
if (ref !== "ykhtpvyelpujykheycsv" || base !== `https://${ref}.supabase.co` || !anon || !service) {
  throw new Error("KPI-2.1E.2R staging guard failed.");
}

const {chromium} = await import(pathToFileURL(process.env.KPI21E2R_PLAYWRIGHT_ENTRY).href);
const root = path.resolve(import.meta.dirname, "..");
const run = crypto.randomBytes(5).toString("hex");
const password = `${crypto.randomBytes(18).toString("base64url")}aA1!`;
const manager = {id:`kpi21e2r-${run}-manager`, email:`kpi21e2r-${run}-manager@example.com`, name:"KPI21E2R Manager", role:"manager"};
const sale = {id:`kpi21e2r-${run}-sale`, email:`kpi21e2r-${run}-sale@example.com`, name:"KPI21E2R Sale", role:"sale"};
const authIds = [];
const ids = {periods:[], definitions:[], assignments:[], submissions:[], events:[]};
const checks = [];
let browser;
let server;

function ok(name, condition) {
  if (!condition) throw new Error(`CHECK FAILED: ${name}`);
  checks.push(name);
}

async function request(endpoint, {method="GET", token=service, key=service, body, allow=false}={}) {
  const response = await fetch(`${base}${endpoint}`, {
    method,
    signal:AbortSignal.timeout(90000),
    headers:{apikey:key, Authorization:`Bearer ${token}`, ...(body === undefined ? {} : {"Content-Type":"application/json"})},
    body:body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  let data = null;
  if (raw) { try { data = JSON.parse(raw); } catch { data = raw; } }
  if (!allow && !response.ok) throw new Error(`${method} ${endpoint}: HTTP ${response.status} ${typeof data === "string" ? data.slice(0,180) : JSON.stringify(data)?.slice(0,180)}`);
  return {ok:response.ok, status:response.status, data};
}

const rpc = (user, name, body, allow=false) => request(`/rest/v1/rpc/${name}`, {method:"POST", token:user.token, key:anon, body, allow});

async function createUser(user) {
  const auth = await request("/auth/v1/admin/users", {method:"POST", body:{email:user.email,password,email_confirm:true}});
  user.authId = auth.data.id;
  authIds.push(user.authId);
  await request("/rest/v1/app_users", {method:"POST", body:{
    id:user.id, supabase_auth_id:user.authId, email:user.email, name:user.name,
    role:user.role, active:true, lifecycle_status:"active", raw_data:{testRun:run,purpose:"KPI-2.1E.2R"}
  }});
  const login = await request("/auth/v1/token?grant_type=password", {method:"POST",token:anon,key:anon,body:{email:user.email,password}});
  user.token = login.data.access_token;
}

async function periodVersion(id) {
  return (await request(`/rest/v1/kpi_periods?id=eq.${id}&select=version`)).data[0].version;
}

async function createPeriod(month, name) {
  const row = (await rpc(manager, "crm_kpi_create_period", {p_period_month:month,p_name:name,p_timezone:"Asia/Ho_Chi_Minh"})).data;
  ids.periods.push(row.id);
  return row;
}

async function createDefinition(label) {
  const row = (await rpc(manager, "crm_kpi_create_definition_v2", {
    p_code:`KPI21E2R_${label}_${run}`.toUpperCase(), p_name:`KPI21E2R ${label}`,
    p_description:"Controlled staging fixture", p_kpi_type:"MANUAL", p_source_metric_key:null,
    p_unit:"lượt", p_submission_mode:"EVENT_CLAIM", p_evidence_required:false,
    p_aggregation_mode:"COUNT", p_max_images_per_event:1, p_location_required:false, p_timestamp_required:true
  })).data;
  ids.definitions.push(row.id);
  return row;
}

async function assign(period, definition, target=10, score=true) {
  let row = (await rpc(manager, "crm_kpi_assign_employee", {
    p_period_id:period.id, p_definition_id:definition.id, p_employee_id:sale.id,
    p_target:target, p_expected_period_version:await periodVersion(period.id)
  })).data;
  ids.assignments.push(row.id);
  if (!score) {
    row = (await rpc(manager, "crm_kpi_update_assignment_options", {
      p_assignment_id:row.id, p_score_enabled:false,
      p_expected_assignment_version:row.lock_version, p_expected_period_version:row.periodVersion
    })).data;
  }
  return row;
}

function serve() {
  server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    if (url === "/js/supabase-config.js") {
      res.writeHead(200,{"Content-Type":"text/javascript","Cache-Control":"no-store"});
      res.end(`window.CRM_SUPABASE_CONFIG=${JSON.stringify({url:base,anonKey:anon})}`);
      return;
    }
    const file = path.resolve(root, url === "/" ? "index.html" : url.replace(/^\//,""));
    if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200,{"Content-Type":file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html","Cache-Control":"no-store"});
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0,"127.0.0.1",()=>resolve(server.address().port)));
}

async function cleanup() {
  if (ids.events.length) await request(`/rest/v1/kpi_duplicate_matches?or=(event_id.in.(${ids.events.join(",")}),duplicate_event_id.in.(${ids.events.join(",")}))`, {method:"DELETE",allow:true});
  if (ids.events.length) await request(`/rest/v1/kpi_submission_events?id=in.(${ids.events.join(",")})`, {method:"DELETE",allow:true});
  if (ids.submissions.length) await request(`/rest/v1/kpi_submissions?id=in.(${ids.submissions.join(",")})`, {method:"DELETE",allow:true});
  await request(`/rest/v1/kpi_action_requests?actor_user_id=in.(${manager.id},${sale.id})`, {method:"DELETE",allow:true});
  if (ids.assignments.length) await request(`/rest/v1/kpi_assignments?id=in.(${ids.assignments.join(",")})`, {method:"DELETE",allow:true});
  if (ids.periods.length) await request(`/rest/v1/kpi_periods?id=in.(${ids.periods.join(",")})`, {method:"DELETE",allow:true});
  if (ids.definitions.length) await request(`/rest/v1/kpi_definitions?id=in.(${ids.definitions.join(",")})`, {method:"DELETE",allow:true});
  await request(`/rest/v1/audit_logs?email=like.kpi21e2r-${run}-*`, {method:"DELETE",allow:true});
  await request(`/rest/v1/user_sessions?user_id=in.(${manager.id},${sale.id})`, {method:"DELETE",allow:true});
  await request(`/rest/v1/app_users?id=in.(${manager.id},${sale.id})`, {method:"DELETE",allow:true});
  for (const id of authIds.reverse()) await request(`/auth/v1/admin/users/${id}`, {method:"DELETE",allow:true});
}

try {
  await createUser(manager);
  await createUser(sale);
  const existing = (await request("/rest/v1/kpi_periods?select=period_month")).data.map(row => row.period_month);
  const months = ["2023-01-01","2023-02-01","2023-03-01","2023-04-01","2023-05-01","2023-06-01"].filter(value => !existing.includes(value));
  if (months.length < 4) throw new Error("Not enough unused staging months.");

  const draft = await createPeriod(months[0], `KPI21E2R ${run} DRAFT`);
  const mistakeDef = await createDefinition("MISTAKE");
  const unusedDef = await createDefinition("UNUSED");
  const usedDef = await createDefinition("USED");
  const mistakeAssignment = await assign(draft, mistakeDef, 10, true);
  const usedAssignment = await assign(draft, usedDef, 5, true);

  const saleRemove = await rpc(sale, "crm_kpi_remove_draft_assignment", {
    p_assignment_id:mistakeAssignment.id, p_expected_assignment_version:mistakeAssignment.lock_version,
    p_expected_period_version:await periodVersion(draft.id), p_reason:"Sale bypass"
  }, true);
  ok("Sale direct RPC remove denied", !saleRemove.ok && saleRemove.status === 403);
  const directDelete = await request(`/rest/v1/kpi_assignments?id=eq.${mistakeAssignment.id}`, {method:"DELETE",token:manager.token,key:anon,allow:true});
  ok("Manager direct table delete denied", !directDelete.ok);
  const usedDelete = await rpc(manager, "crm_kpi_delete_unused_definition", {p_definition_id:usedDef.id,p_expected_version:usedDef.version}, true);
  ok("Used definition direct RPC delete denied", !usedDelete.ok);

  const activePeriod = await createPeriod(months[1], `KPI21E2R ${run} ACTIVE`);
  const activeDef = await createDefinition("ACTIVE");
  const activeAssignment = await assign(activePeriod, activeDef, 3, true);
  await rpc(manager, "crm_kpi_activate_period", {p_period_id:activePeriod.id,p_expected_version:await periodVersion(activePeriod.id)});
  const activeRemove = await rpc(manager, "crm_kpi_remove_draft_assignment", {
    p_assignment_id:activeAssignment.id,p_expected_assignment_version:activeAssignment.lock_version,
    p_expected_period_version:await periodVersion(activePeriod.id),p_reason:"Negative ACTIVE"
  }, true);
  ok("ACTIVE assignment hard remove denied", !activeRemove.ok && JSON.stringify(activeRemove.data).includes("đã được kích hoạt"));

  const submitVsRemove = await Promise.all([
    rpc(sale,"crm_kpi_submit_events",{
      p_assignment_id:activeAssignment.id,p_request_id:crypto.randomUUID(),p_sale_note:"race",
      p_events:[{sourceType:"MANUAL",sourceEventKey:`manual:${crypto.randomUUID()}`,eventAt:`${months[1].slice(0,7)}-15T03:00:00Z`,claimedValue:1,eventSnapshot:{title:"race"},evidenceIds:[]}]
    },true),
    rpc(manager,"crm_kpi_remove_draft_assignment",{
      p_assignment_id:activeAssignment.id,p_expected_assignment_version:activeAssignment.lock_version,
      p_expected_period_version:await periodVersion(activePeriod.id),p_reason:"submit race"
    },true)
  ]);
  ok("Submission vs remove race preserves assignment", submitVsRemove[0].ok && !submitVsRemove[1].ok);
  if (submitVsRemove[0].ok) { ids.submissions.push(submitVsRemove[0].data.submissionId); ids.events.push(...submitVsRemove[0].data.eventIds); }

  const racePeriod = await createPeriod(months[2], `KPI21E2R ${run} RACE`);
  const raceDef = await createDefinition("RACE");
  const raceAssignment = await assign(racePeriod, raceDef, 4, true);
  const raceVersion = await periodVersion(racePeriod.id);
  const updateVsRemove = await Promise.all([
    rpc(manager,"crm_kpi_update_assignment_target",{p_assignment_id:raceAssignment.id,p_target:6,p_expected_assignment_version:raceAssignment.lock_version,p_expected_period_version:raceVersion},true),
    rpc(manager,"crm_kpi_remove_draft_assignment",{p_assignment_id:raceAssignment.id,p_expected_assignment_version:raceAssignment.lock_version,p_expected_period_version:raceVersion,p_reason:"concurrency"},true)
  ]);
  ok("Update vs remove has exactly one winner", updateVsRemove.filter(row => row.ok).length === 1);

  await serve();
  browser = await chromium.launch({executablePath:process.env.KPI21E2R_BROWSER_PATH,headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("dialog", dialog => dialog.type() === "prompt" ? dialog.accept("Gán nhầm KPI") : dialog.accept());
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:"networkidle"});
  await page.locator("#loginEmail").fill(manager.email);
  await page.locator("#loginPassword").fill(password);
  await page.locator("#loginBtn").click();
  await page.locator("#appView").waitFor({state:"visible",timeout:30000});
  await page.locator("#kpiViewBtn").click();
  await page.locator("#kpiTeamPanel").waitFor({state:"visible",timeout:30000});
  await page.locator("#kpiTeamPeriod").selectOption(draft.id);
  const employeeRow = page.locator(".kpi-team-employee-row").filter({hasText:sale.name});
  await employeeRow.waitFor({timeout:30000});
  await employeeRow.locator("[data-kpi-team-open-employee]").click();
  await page.locator("#kpiTeamDetailDrawer").waitFor({state:"visible",timeout:30000});
  await page.locator('[data-kpi-employee-tab="kpis"]').click();
  const mistakeCard = page.locator(".kpi-team-assignment-card").filter({hasText:mistakeDef.name});
  await mistakeCard.locator("[data-kpi-team-edit-assignment]").click();
  await page.locator("#kpiTeamAssignTarget").fill("12");
  await page.locator("#kpiTeamAssignScoreEnabled").uncheck();
  await page.locator("#kpiTeamAssignSubmitBtn").click();
  await page.locator("#kpiTeamAssignDrawer").waitFor({state:"hidden",timeout:30000});
  const edited = (await request(`/rest/v1/kpi_assignments?id=eq.${mistakeAssignment.id}&select=target,score_enabled`)).data[0];
  ok("Employee detail edits DRAFT target and score", Number(edited.target) === 12 && edited.score_enabled === false);

  const refreshedMistakeCard = page.locator(".kpi-team-assignment-card").filter({hasText:mistakeDef.name});
  await refreshedMistakeCard.locator("[data-kpi1-remove-assignment]").click();
  await page.waitForFunction(id => !document.querySelector(`[data-kpi1-remove-assignment="${id}"]`), mistakeAssignment.id, {timeout:30000});
  const removedRows = (await request(`/rest/v1/kpi_assignments?id=eq.${mistakeAssignment.id}&select=id`)).data;
  ok("Manager UI removes clean DRAFT assignment", removedRows.length === 0);
  ok("Definition remains after assignment removal", (await request(`/rest/v1/kpi_definitions?id=eq.${mistakeDef.id}&select=id`)).data.length === 1);
  ok("Zero-assignment employee remains visible", await employeeRow.isVisible());
  ok("Employee can be assigned again", await page.locator("#kpiTeamDetailDrawer [data-kpi-team-assign-employee]").isVisible());

  await page.locator("#kpiTeamDetailCloseBtn").click();
  await page.locator("#kpiTeamLibraryModeBtn").click();
  await page.locator("#kpiFoundationPanel").waitFor({state:"visible",timeout:30000});
  const unusedRow = page.locator("#kpi1DefinitionRows tr").filter({hasText:unusedDef.name});
  await unusedRow.locator("[data-kpi1-delete-definition]").click();
  await page.waitForFunction(name => ![...document.querySelectorAll("#kpi1DefinitionRows tr")].some(row => row.textContent.includes(name)), unusedDef.name, {timeout:30000});
  ok("Unused definition UI delete succeeds", (await request(`/rest/v1/kpi_definitions?id=eq.${unusedDef.id}&select=id`)).data.length === 0);

  const usedRow = page.locator("#kpi1DefinitionRows tr").filter({hasText:usedDef.name});
  ok("Used definition hides delete action", await usedRow.locator("[data-kpi1-delete-definition]").count() === 0);
  ok("Used definition offers deactivate", await usedRow.getByText("Ngừng sử dụng", {exact:true}).count() === 1);
  await usedRow.locator("[data-kpi1-toggle-definition]").click();
  await page.waitForFunction(name => [...document.querySelectorAll("#kpi1DefinitionRows tr")].some(row => row.textContent.includes(name) && row.textContent.includes("Đã tắt") && row.textContent.includes("Bật lại")), usedDef.name, {timeout:30000});
  const deactivated = (await request(`/rest/v1/kpi_definitions?id=eq.${usedDef.id}&select=active`)).data[0];
  ok("Used definition deactivates", deactivated.active === false);
  const snapshot = (await request(`/rest/v1/kpi_assignments?id=eq.${usedAssignment.id}&select=definition_snapshot`)).data[0].definition_snapshot;
  ok("Definition snapshot remains historical", snapshot.name === usedDef.name && Number(snapshot.definition_version) === 1);

  await page.locator("#kpiTeamEmployeesModeBtn").click();
  await employeeRow.locator("[data-kpi-team-open-employee]").click();
  await page.locator("#kpiTeamDetailDrawer [data-kpi-team-assign-employee]").click();
  const assignOptions = await page.locator("#kpiTeamAssignDefinition option").allTextContents();
  ok("Deactivated definition absent from assignment dropdown", !assignOptions.some(value => value.includes(usedDef.name)));
  await page.locator("#kpiTeamAssignCloseBtn").click();
  ok("Manager UI has no page errors", pageErrors.length === 0);

  const saleContext = await browser.newContext({viewport:{width:1280,height:800}});
  const salePage = await saleContext.newPage();
  await salePage.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:"networkidle"});
  await salePage.locator("#loginEmail").fill(sale.email);
  await salePage.locator("#loginPassword").fill(password);
  await salePage.locator("#loginBtn").click();
  await salePage.locator("#appView").waitFor({state:"visible",timeout:30000});
  await salePage.locator("#kpiViewBtn").click();
  ok("Sale has no KPI configuration panel", await salePage.locator("#kpiFoundationPanel").count() === 1 && await salePage.locator("#kpiFoundationPanel").isHidden());
  ok("Sale has no remove controls", await salePage.locator("[data-kpi1-remove-assignment]").count() === 0);
  await saleContext.close();

  const audit = (await request(`/rest/v1/audit_logs?email=eq.${manager.email}&action=in.(assignment_remove_draft,definition_delete_unused,definition_deactivate)&select=action,raw_data`)).data;
  ok("Undo lifecycle audit actions exist", ["assignment_remove_draft","definition_delete_unused","definition_deactivate"].every(action => audit.some(row => row.action === action)));
  console.log(`KPI-2.1E.2R staging API/UI: PASS (${checks.length} checks)`);
} finally {
  await browser?.close().catch(()=>{});
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  await cleanup();
}
