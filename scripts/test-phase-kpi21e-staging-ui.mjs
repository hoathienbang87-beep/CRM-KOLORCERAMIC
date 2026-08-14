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
  throw new Error("KPI-2.1E UI staging guard failed.");
}

const {chromium} = await import(pathToFileURL(process.env.KPI21E_PLAYWRIGHT_ENTRY).href);
const root = path.resolve(import.meta.dirname, "..");
const run = crypto.randomBytes(5).toString("hex");
const password = `${crypto.randomBytes(18).toString("base64url")}aA1!`;
const user = {
  id: `kpi21e-ui-${run}-manager`,
  email: `kpi21e-ui-${run}-manager@example.com`,
  name: "KPI21E Cutover Manager"
};
const checks = [];
let authId = "";
let server;
let browser;

function ok(name, value) {
  if (!value) throw new Error(`CHECK FAILED: ${name}`);
  checks.push(name);
}

async function req(endpoint, {method = "GET", token = service, key = service, body, allow = false} = {}) {
  const response = await fetch(`${base}${endpoint}`, {
    method,
    signal: AbortSignal.timeout(90000),
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : {"Content-Type": "application/json"})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  let data = null;
  if (raw) { try { data = JSON.parse(raw); } catch { data = raw; } }
  if (!allow && !response.ok) throw new Error(`${method} ${endpoint}: HTTP ${response.status}`);
  return {ok: response.ok, status: response.status, data};
}

function serve() {
  server = http.createServer((request, response) => {
    const url = decodeURIComponent((request.url || "/").split("?")[0]);
    if (url === "/js/supabase-config.js") {
      response.writeHead(200, {"Content-Type": "text/javascript", "Cache-Control": "no-store"});
      response.end(`window.CRM_SUPABASE_CONFIG=${JSON.stringify({url: base, anonKey: anon})}`);
      return;
    }
    const file = path.resolve(root, url === "/" ? "index.html" : url.replace(/^\//, ""));
    if (!file.startsWith(root) || !fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, {
      "Content-Type": file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html",
      "Cache-Control": "no-store"
    });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
}

async function cleanup() {
  await req(`/rest/v1/app_users?id=eq.${user.id}`, {method: "DELETE", allow: true});
  if (authId) await req(`/auth/v1/admin/users/${authId}`, {method: "DELETE", allow: true});
}

try {
  const auth = await req("/auth/v1/admin/users", {
    method: "POST",
    body: {email: user.email, password, email_confirm: true}
  });
  authId = auth.data.id;
  await req("/rest/v1/app_users", {method: "POST", body: {
    id: user.id,
    supabase_auth_id: authId,
    email: user.email,
    name: user.name,
    role: "manager",
    active: true,
    lifecycle_status: "active",
    raw_data: {testRun: run, purpose: "KPI-2.1E post-cutover UI"}
  }});

  await serve();
  browser = await chromium.launch({executablePath: process.env.KPI21E_BROWSER_PATH, headless: true});
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil: "networkidle"});
  await page.locator("#loginEmail").fill(user.email);
  await page.locator("#loginPassword").fill(password);
  await page.locator("#loginBtn").click();
  await page.locator("#appView").waitFor({state: "visible", timeout: 30000});

  await page.locator("#executiveGrid").waitFor({state: "visible"});
  const dashboardText = await page.locator("#executiveGrid").textContent();
  ok("dashboard primary pending label uses KPI-2", dashboardText.includes("KPI hiện tại cần duyệt"));
  ok("dashboard separates legacy close-out", dashboardText.includes("KPI cũ đang đóng sổ"));

  await page.locator("#kpiViewBtn").click();
  await page.locator("#kpiCutoverStatus").waitFor({state: "visible", timeout: 30000});
  const bannerText = await page.locator("#kpiCutoverStatus").textContent();
  ok("post-cutover banner uses server state", bannerText.includes("KPI-2 là hệ thống KPI hiện tại"));
  ok("employee-centric manager view remains primary", await page.locator("#kpiTeamEmployeesModeBtn.primary").count() === 1);
  ok("new legacy proposal action is hidden", await page.locator("#openKpiProposalBtnTop:visible").count() === 0);

  await page.locator("#reportsViewBtn").click();
  await page.locator("#reportCenterGrid").waitFor({state: "visible", timeout: 30000});
  const reportText = await page.locator("#reportCenterGrid").textContent();
  ok("report primary pending label uses KPI-2", reportText.includes("KPI hiện tại cần duyệt"));
  ok("report separates legacy close-out", reportText.includes("KPI cũ đang đóng sổ"));
  ok("no uncaught browser errors", pageErrors.length === 0);

  console.log(`KPI-2.1E staging UI POST: PASS (${checks.length} checks)`);
  checks.forEach((name, index) => console.log(`${index + 1}. ${name}`));
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await cleanup();
}
