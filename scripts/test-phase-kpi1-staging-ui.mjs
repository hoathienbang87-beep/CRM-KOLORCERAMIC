import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const expectedRef = "ykhtpvyelpujykheycsv";
const productionRef = "jjeeazwlqcwynzquimeo";
const projectRef = process.env.STAGING_PROJECT_REF || "";
const baseUrl = (process.env.STAGING_SUPABASE_URL || "").replace(/\/$/, "");
const anonKey = process.env.STAGING_ANON_KEY || "";
const serviceKey = process.env.STAGING_SERVICE_ROLE_KEY || "";
const playwrightEntry = process.env.KPI1_PLAYWRIGHT_ENTRY || "";
const browserPath = process.env.KPI1_BROWSER_PATH || "";
const root = path.resolve(import.meta.dirname, "..");

if (projectRef !== expectedRef || baseUrl !== `https://${expectedRef}.supabase.co`) {
  throw new Error("Refusing to run: KPI-1 UI staging project guard failed.");
}
if (projectRef === productionRef || baseUrl.includes(productionRef)) {
  throw new Error("Refusing to run KPI-1 UI test against production.");
}
if (!anonKey || !serviceKey || !playwrightEntry || !browserPath) {
  throw new Error("Missing ephemeral staging credentials or browser runtime.");
}

const { chromium } = await import(pathToFileURL(playwrightEntry).href);
const runId = crypto.randomBytes(5).toString("hex");
const password = `${crypto.randomBytes(18).toString("base64url")}aA1!`;
const periodName = `KPI1 UI ${runId}`;
const definitionCode = `KPI1_UI_${runId.toUpperCase()}`;
const users = ["manager", "sale"].map(role => ({
  role,
  email: `kpi1-ui-${runId}-${role}@example.com`,
  appUserId: `kpi1-ui-${runId}-${role}`
}));
const authIds = [];
let server;
let browser;

async function request(apiPath, { method = "GET", body, allowError = false } = {}) {
  const response = await fetch(`${baseUrl}${apiPath}`, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!allowError && !response.ok) throw new Error(`HTTP ${response.status}: ${method} ${apiPath}`);
  return { ok: response.ok, data };
}

async function createFixtureUser(user) {
  const auth = await request("/auth/v1/admin/users", {
    method: "POST",
    body: { email: user.email, password, email_confirm: true }
  });
  user.authId = auth.data.id;
  authIds.push(user.authId);
  await request("/rest/v1/app_users", {
    method: "POST",
    body: {
      id: user.appUserId,
      supabase_auth_id: user.authId,
      email: user.email,
      name: `KPI1 UI ${user.role}`,
      role: user.role,
      active: true,
      lifecycle_status: "active",
      raw_data: { testRun: runId }
    }
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml"
  })[ext] || "application/octet-stream";
}

function startServer() {
  server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (urlPath === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    if (urlPath === "/js/supabase-config.js") {
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
      res.end(`window.CRM_SUPABASE_CONFIG=${JSON.stringify({ url: baseUrl, anonKey })};`);
      return;
    }
    const requested = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const filePath = path.resolve(root, requested);
    if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

async function cleanup() {
  const periods = (await request(`/rest/v1/kpi_periods?name=eq.${encodeURIComponent(periodName)}&select=id`, { allowError: true })).data || [];
  const definitions = (await request(`/rest/v1/kpi_definitions?code=eq.${definitionCode}&select=id`, { allowError: true })).data || [];
  for (const period of periods) {
    await request(`/rest/v1/kpi_assignments?period_id=eq.${period.id}`, { method: "DELETE", allowError: true });
    await request(`/rest/v1/audit_logs?entity_id=eq.${period.id}`, { method: "DELETE", allowError: true });
  }
  for (const definition of definitions) {
    await request(`/rest/v1/kpi_assignments?definition_id=eq.${definition.id}`, { method: "DELETE", allowError: true });
    await request(`/rest/v1/audit_logs?entity_id=eq.${definition.id}`, { method: "DELETE", allowError: true });
  }
  if (periods.length) await request(`/rest/v1/kpi_periods?id=in.(${periods.map(row => row.id).join(",")})`, { method: "DELETE", allowError: true });
  if (definitions.length) await request(`/rest/v1/kpi_definitions?id=in.(${definitions.map(row => row.id).join(",")})`, { method: "DELETE", allowError: true });
  await request(`/rest/v1/audit_logs?actor_user_id=like.kpi1-ui-${runId}-*`, { method: "DELETE", allowError: true });
  await request(`/rest/v1/app_users?id=like.kpi1-ui-${runId}-*`, { method: "DELETE", allowError: true });
  for (const authId of authIds.reverse()) {
    await request(`/auth/v1/admin/users/${authId}`, { method: "DELETE", allowError: true });
  }
  const residualUsers = (await request(`/rest/v1/app_users?id=like.kpi1-ui-${runId}-*&select=id`, { allowError: true })).data || [];
  const residualPeriods = (await request(`/rest/v1/kpi_periods?name=eq.${encodeURIComponent(periodName)}&select=id`, { allowError: true })).data || [];
  const residualDefinitions = (await request(`/rest/v1/kpi_definitions?code=eq.${definitionCode}&select=id`, { allowError: true })).data || [];
  if (residualUsers.length || residualPeriods.length || residualDefinitions.length) {
    throw new Error("KPI-1 UI fixture cleanup left residual rows.");
  }
}

try {
  for (const user of users) await createFixtureUser(user);
  const manager = users.find(user => user.role === "manager");
  const sale = users.find(user => user.role === "sale");
  const port = await startServer();
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const browserErrors = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) browserErrors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.locator("#loginEmail").fill(manager.email);
  await page.locator("#loginPassword").fill(password);
  await page.locator("#loginBtn").click();
  await page.locator("#appView").waitFor({ state: "visible", timeout: 20000 });
  await page.locator("#kpiViewBtn").click();
  await page.locator("#kpiFoundationPanel").waitFor({ state: "visible", timeout: 20000 });
  await page.locator("#kpi1PeriodMonth").fill("2097-02");
  await page.locator("#kpi1PeriodName").fill(periodName);
  await page.locator("#kpi1CreatePeriodBtn").click();
  await page.locator("#kpi1PeriodRows").getByText(periodName).waitFor({ timeout: 20000 });

  await page.locator("#kpi1DefinitionCode").fill(definitionCode);
  await page.locator("#kpi1DefinitionName").fill("KPI UI smoke");
  await page.locator("#kpi1DefinitionUnit").fill("lượt");
  await page.locator("#kpi1SaveDefinitionBtn").click();
  await page.locator("#kpi1DefinitionRows").getByText(definitionCode).waitFor({ timeout: 20000 });

  const periodRow = page.locator("#kpi1PeriodRows tr", { hasText: periodName });
  await periodRow.getByRole("button", { name: "Xem cấu hình" }).click();
  const definitionRow = page.locator("#kpi1MatrixRows tr", { hasText: definitionCode });
  const saleCell = definitionRow.locator(`[data-kpi1-cell]`).filter({ has: page.locator(`[data-employee-id="${sale.appUserId}"]`) });
  await saleCell.locator("[data-kpi1-assigned]").check();
  await saleCell.locator("[data-kpi1-target]").fill("12");
  await definitionRow.getByRole("button", { name: "Lưu hàng" }).click();
  await page.locator("#kpi1ActivationSummary").getByText("1", { exact: true }).first().waitFor({ timeout: 20000 });
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#kpi1ActivatePeriodBtn").click();
  await page.locator("#kpi1LockedNotice").waitFor({ state: "visible", timeout: 20000 });
  if (!(await page.locator("#kpiRulePanel").isVisible())) throw new Error("Legacy KPI panel is not visible.");
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  console.log("KPI-1 staging manager UI: PASS (login, DRAFT, definition, matrix, activation lock, legacy panel)");
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
  await cleanup();
}
