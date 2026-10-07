#!/usr/bin/env node
// Phase 6L-C browser regression: real CRM bundle + real vendored supabase-js against a
// local fixture Supabase (auth + PostgREST). The fixture answers protected reads made
// with the anon key with 401, exactly like Production RLS, and delays /logout so the
// old debounce-vs-signOut race is reproducible.
//
// Usage (from repo root):
//   CRM_AUTH_PLAYWRIGHT_ENTRY=/path/to/playwright/index.mjs \
//   CRM_AUTH_BROWSER_PATH=/path/to/chromium node scripts/test-crm-auth-lifecycle-browser.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {pathToFileURL} from "node:url";

const entry = process.env.CRM_AUTH_PLAYWRIGHT_ENTRY;
const browserPath = process.env.CRM_AUTH_BROWSER_PATH;
if (!entry || !browserPath) throw new Error("Set CRM_AUTH_PLAYWRIGHT_ENTRY and CRM_AUTH_BROWSER_PATH.");
const {chromium} = await import(pathToFileURL(entry).href).then(m => m.default || m);

const root = process.cwd();
const ANON_KEY = "fixture-anon-key";
const USER = {id: "00000000-0000-4000-8000-000000000001", email: "owner@fixture.test", aud: "authenticated", role: "authenticated"};
const b64 = obj => Buffer.from(JSON.stringify(obj)).toString("base64url");
let tokenSerial = 0;
const issueToken = () => `${b64({alg: "HS256", typ: "JWT"})}.${b64({sub: USER.id, role: "authenticated", email: USER.email, exp: Math.floor(Date.now() / 1000) + 3600, n: ++tokenSerial})}.fixture`;
const validTokens = new Set();
const events = [];
const mime = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8"};

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {"Content-Type": "application/json", ...headers});
  res.end(body === undefined ? "" : JSON.stringify(body));
}

function restRows(table, url) {
  if (table === "profile" && url.searchParams.get("supabase_auth_id") === `eq.${USER.id}`) {
    return [{id: USER.id, supabase_auth_id: USER.id, email: USER.email, name: "Owner Fixture", role: "owner", active: true, raw_data: {}}];
  }
  return [];
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  if (p === "/js/supabase-config.js") {
    res.writeHead(200, {"Content-Type": mime[".js"]});
    return res.end(`window.CRM_SUPABASE_CONFIG={url:"http://127.0.0.1:${server.address().port}/sb",anonKey:"${ANON_KEY}"};`);
  }
  if (p.startsWith("/sb/")) {
    const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const authed = validTokens.has(bearer);
    const sb = p.slice(3);
    if (req.method === "OPTIONS") { res.writeHead(204, {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*"}); return res.end(); }
    if (sb.startsWith("/auth/v1/token")) {
      let body = ""; req.on("data", c => body += c); req.on("end", () => {
        const token = issueToken(); validTokens.add(token);
        events.push({t: Date.now(), kind: "login", path: sb});
        sendJson(res, 200, {access_token: token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `refresh-${tokenSerial}`, user: USER});
      });
      return;
    }
    if (sb.startsWith("/auth/v1/logout")) {
      events.push({t: Date.now(), kind: "logout-start", path: sb});
      return setTimeout(() => { validTokens.delete(bearer); events.push({t: Date.now(), kind: "logout-done", path: sb}); res.writeHead(204); res.end(); }, 400);
    }
    if (sb.startsWith("/auth/v1/user")) return authed ? sendJson(res, 200, USER) : sendJson(res, 401, {message: "invalid JWT"});
    if (sb.startsWith("/rest/v1/")) {
      const isRpc = sb.startsWith("/rest/v1/rpc/");
      let table = isRpc ? sb.slice("/rest/v1/rpc/".length) : sb.slice("/rest/v1/".length).split("/")[0];
      if (table === "app_users" && url.searchParams.has("supabase_auth_id")) table = "profile";
      const write = !isRpc && ["POST", "PATCH", "DELETE"].includes(req.method);
      events.push({t: Date.now(), kind: write ? "write" : "read", method: req.method, table, status: authed ? 200 : 401, anon: !authed});
      if (!authed) return sendJson(res, 401, {code: "42501", message: `permission denied for ${table}`});
      if (req.method === "HEAD") { res.writeHead(200, {"Content-Range": "0-0/0"}); return res.end(); }
      if (write) return sendJson(res, 201, []);
      const rows = isRpc ? [] : restRows(table, url);
      const single = String(req.headers.accept || "").includes("vnd.pgrst.object");
      return sendJson(res, 200, single ? (rows[0] || null) : rows, {"Content-Range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}`});
    }
    return sendJson(res, 404, {message: "fixture: not found"});
  }
  let rel = p === "/crm" || p.startsWith("/crm/") ? "index.html" : decodeURIComponent(p).replace(/^\/+/, "");
  let file = path.resolve(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, {"Content-Type": mime[path.extname(file)] || "application/octet-stream"});
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({executablePath: browserPath, headless: true});
const results = [];
const pass = (cond, label) => { results.push([cond ? "PASS" : "FAIL", label]); };
const since = t => events.filter(e => e.t >= t);
const protectedReads = list => list.filter(e => e.kind === "read");
const count401 = list => list.filter(e => e.status === 401).length;
const tableCounts = list => list.reduce((m, e) => (m[e.table] = (m[e.table] || 0) + 1, m), {});

try {
  const page = await browser.newPage();
  const consoleErrors = [], pageErrors = [];
  page.on("console", m => { if (m.type() === "error" && !/WebSocket|realtime|Failed to load resource/i.test(m.text())) consoleErrors.push(m.text()); });
  page.on("pageerror", e => pageErrors.push(e.message));

  // 1. Cold anonymous load.
  const t0 = Date.now();
  await page.goto(`${base}/crm`, {waitUntil: "load"});
  await page.waitForSelector("#loginView:not(.hide)", {timeout: 10000});
  await page.waitForTimeout(1500);
  const anon = since(t0);
  pass(protectedReads(anon).length === 0, `cold anon: protected reads = ${protectedReads(anon).length}`);
  pass(count401(anon) === 0, `cold anon: 401 = ${count401(anon)}`);

  // 2. Login → watchers start once.
  const t1 = Date.now();
  await page.fill("#loginEmail", USER.email);
  await page.fill("#loginPassword", "fixture-password");
  await page.click("#loginBtn");
  await page.waitForSelector("#appView:not(.hide)", {timeout: 10000});
  await page.waitForTimeout(1500);
  const login = since(t1);
  const loginCounts = tableCounts(protectedReads(login));
  pass(count401(login) === 0, `login: 401 = ${count401(login)}`);
  // One bootstrap per login: the profile lookup runs exactly once (old code: twice).
  pass(loginCounts.profile === 1, `login: single auth bootstrap (profile reads=${loginCounts.profile})`);
  // Each watcher: initial read + at most one refresh caused by the startup presence write
  // (pre-existing heartbeat-driven refresh, intentionally unchanged in 6L-C).
  for (const table of ["products", "kpi_periods", "kpi_definitions", "kpi_assignments", "customers", "care_logs", "deals"]) {
    pass(loginCounts[table] >= 1 && loginCounts[table] <= 2, `login: ${table} watcher started once (reads=${loginCounts[table]})`);
  }
  pass((loginCounts.crm_list_products || 0) === loginCounts.products, `login: crm_list_products follows products watcher (${loginCounts.crm_list_products || 0})`);

  // 3. Logout: presence write may precede signOut; nothing protected after logout starts.
  await page.waitForTimeout(300);
  const t2 = Date.now();
  await page.click("#logoutBtn");
  await page.waitForSelector("#loginView:not(.hide)", {timeout: 10000});
  // 4. Stay logged out beyond the debounce window.
  await page.waitForTimeout(2500);
  const logoutWindow = since(t2);
  const logoutStart = logoutWindow.find(e => e.kind === "logout-start");
  pass(Boolean(logoutStart), "logout: /auth/v1/logout called");
  const afterLogout = logoutWindow.filter(e => e.t >= (logoutStart?.t || t2));
  pass(protectedReads(afterLogout).length === 0, `logout: protected reads after signOut = ${protectedReads(afterLogout).length} ${JSON.stringify(tableCounts(protectedReads(afterLogout)))}`);
  pass(count401(logoutWindow) === 0, `logout: 401 = ${count401(logoutWindow)}`);
  pass(afterLogout.filter(e => e.kind === "write" && e.table === "user_sessions").length === 0, "logout: no heartbeat after signOut");
  pass(protectedReads(logoutWindow).filter(e => e.table !== "user_sessions").length === 0, `logout: no watcher refetch triggered by logout (${JSON.stringify(tableCounts(protectedReads(logoutWindow)))})`);

  // 5. Rapid relogin → exactly one fresh watcher set.
  const t3 = Date.now();
  await page.fill("#loginEmail", USER.email);
  await page.fill("#loginPassword", "fixture-password");
  await page.click("#loginBtn");
  await page.waitForSelector("#appView:not(.hide)", {timeout: 10000});
  await page.waitForTimeout(1500);
  const relogin = since(t3);
  const reCounts = tableCounts(protectedReads(relogin));
  pass(count401(relogin) === 0, `relogin: 401 = ${count401(relogin)}`);
  pass(reCounts.profile === 1, `relogin: single auth bootstrap (profile reads=${reCounts.profile})`);
  pass(["customers", "kpi_periods", "deals", "products"].every(t => reCounts[t] >= 1 && reCounts[t] <= 2), `relogin: one fresh watcher set (${JSON.stringify(reCounts)})`);

  // 6. Logout immediately after login (rapid cycle), then wait.
  const t4 = Date.now();
  await page.click("#logoutBtn");
  await page.waitForSelector("#loginView:not(.hide)", {timeout: 10000});
  await page.waitForTimeout(2000);
  const second = since(t4);
  const secondStart = second.find(e => e.kind === "logout-start");
  pass(protectedReads(second.filter(e => e.t >= (secondStart?.t || t4))).length === 0 && count401(second) === 0, "second logout: no protected read / 401");

  pass(consoleErrors.length === 0, `console errors = ${consoleErrors.length} ${consoleErrors.slice(0, 3).join(" | ")}`);
  pass(pageErrors.length === 0, `page errors = ${pageErrors.length} ${pageErrors.slice(0, 3).join(" | ")}`);
} finally {
  await browser.close();
  server.close();
}
for (const [status, label] of results) console.log(status, label);
const failed = results.filter(r => r[0] === "FAIL").length;
assert.equal(failed, 0, `${failed} CRM auth lifecycle browser check(s) failed`);
console.log(`crm auth lifecycle browser: PASS (${results.length} checks)`);
