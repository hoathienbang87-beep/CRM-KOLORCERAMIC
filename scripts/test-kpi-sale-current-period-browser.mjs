#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {pathToFileURL} from "node:url";

const entry = process.env.CRM_AUTH_PLAYWRIGHT_ENTRY;
const browserPath = process.env.CRM_AUTH_BROWSER_PATH;
const previewUrl = String(process.env.KPI_SALE_PREVIEW_URL || "").replace(/\/$/,"");
if (!entry || !browserPath) throw new Error("Set CRM_AUTH_PLAYWRIGHT_ENTRY and CRM_AUTH_BROWSER_PATH.");
const {chromium} = await import(pathToFileURL(entry).href).then(module => module.default || module);

const root = process.cwd();
const ANON_KEY = "fixture-anon-key";
const USER = {id:"00000000-0000-4000-8000-000000000007",email:"sale@fixture.test",aud:"authenticated",role:"authenticated"};
const APP_USER = {id:USER.id,supabase_auth_id:USER.id,uid:USER.id,email:USER.email,name:"Sale Fixture",role:"sale",active:true,lifecycle_status:"active",raw_data:{}};
const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${b64({alg:"HS256",typ:"JWT"})}.${b64({sub:USER.id,role:"authenticated",email:USER.email,exp:Math.floor(Date.now()/1000)+3600})}.fixture`;
const validTokens = new Set([token]);
const requests = [];
let periodMode = "normal";
const september = {id:"period-sep",period_month:"2026-09-01",name:"KPI tháng 9",status:"ACTIVE",timezone:"Asia/Ho_Chi_Minh",starts_at:"2026-09-01T00:00:00+07:00",ends_at:"2026-10-01T00:00:00+07:00"};
const october = {id:"period-oct",period_month:"2026-10-01",name:"KPI tháng 10",status:"ACTIVE",timezone:"Asia/Ho_Chi_Minh",starts_at:"2026-10-01T00:00:00+07:00",ends_at:"2026-11-01T00:00:00+07:00"};
const progress = period => ({assignment_id:`assignment-${period}`,period_id:`period-${period}`,period_status:"ACTIVE",employee_id:USER.id,employee_name:"Sale Fixture",target:10,approved_actual:period==="oct"?3:9,pending_count:period==="oct"?1:7,needs_revision_count:0,actual_completion_pct:period==="oct"?30:90,scoring_completion_pct:period==="oct"?30:90,score_enabled:true,definition_snapshot:{name:`KPI ${period==="oct"?"October":"September"}`,kpi_type:"MANUAL",customer_relation_mode:"REQUIRED",evidence_required:false,max_images_per_event:2}});
const event = period => ({id:`event-${period}`,assignment_id:`assignment-${period}`,submission_id:`submission-${period}`,actor_user_id:USER.id,status:"PENDING",source_type:"MANUAL",event_at:period==="oct"?"2026-10-06T02:00:00Z":"2026-09-06T02:00:00Z",created_at:"2026-10-08T02:00:00Z",claimed_value:1,lock_version:1,event_snapshot:{title:`Event ${period==="oct"?"October":"September"}`}});
const mime = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml"};

function sendJson(res,status,body,headers={}) {
  res.writeHead(status,{"Content-Type":"application/json",...headers});
  res.end(body === undefined ? "" : JSON.stringify(body));
}
function activePeriods() {
  if (periodMode === "none") return [september];
  if (periodMode === "overlap") return [october,{...october,id:"period-overlap",name:"KPI overlap"}];
  return [september,october];
}
function tableRows(table,url) {
  if ((table === "app_users" || table === "profile") && url.searchParams.has("supabase_auth_id")) return [APP_USER];
  if (table === "kpi_periods") return activePeriods();
  if (table === "kpi_submission_events") return [event("sep"),event("oct")];
  if (table === "kpi_evidence") return [];
  if (table === "kpi_submissions") return [{id:"submission-sep",assignment_id:"assignment-sep",sale_note:"Sep"},{id:"submission-oct",assignment_id:"assignment-oct",sale_note:"Oct"}];
  if (table === "kpi_assignments") return [progress("sep"),progress("oct")].map(row => ({id:row.assignment_id,period_id:row.period_id,employee_id:row.employee_id,target:row.target,assignment_status:"ASSIGNED",definition_snapshot:row.definition_snapshot}));
  return [];
}

const server = http.createServer((req,res) => {
  const url = new URL(req.url,"http://localhost");
  const pathname = url.pathname;
  if (pathname === "/js/supabase-config.js") {
    res.writeHead(200,{"Content-Type":mime[".js"]});
    return res.end(`window.CRM_SUPABASE_CONFIG={url:"http://127.0.0.1:${server.address().port}/sb",anonKey:"${ANON_KEY}"};`);
  }
  if (pathname.startsWith("/sb/")) {
    if (req.method === "OPTIONS") { res.writeHead(204,{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"*","Access-Control-Allow-Methods":"*"}); return res.end(); }
    const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i,"");
    const authed = validTokens.has(bearer);
    const sbPath = pathname.slice(3);
    if (sbPath.startsWith("/auth/v1/token")) return sendJson(res,200,{access_token:token,token_type:"bearer",expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:"fixture-refresh",user:USER});
    if (sbPath.startsWith("/auth/v1/user")) return authed ? sendJson(res,200,USER) : sendJson(res,401,{message:"invalid JWT"});
    if (sbPath.startsWith("/rest/v1/")) {
      const rpc = sbPath.startsWith("/rest/v1/rpc/");
      const table = rpc ? sbPath.slice("/rest/v1/rpc/".length) : sbPath.slice("/rest/v1/".length).split("/")[0];
      let body = "";
      req.on("data",chunk => body += chunk);
      req.on("end",() => {
        requests.push({table,rpc,method:req.method,url:url.href,body:body ? JSON.parse(body) : null,mode:periodMode});
        if (!authed) return sendJson(res,401,{code:"42501",message:`permission denied for ${table}`});
        if (req.method === "HEAD") { res.writeHead(200,{"Content-Range":"0-0/0"}); return res.end(); }
        if (rpc) return sendJson(res,200,table === "crm_kpi_get_assignment_progress" ? [progress("sep"),progress("oct")] : []);
        const rows = tableRows(table,url);
        const single = String(req.headers.accept || "").includes("vnd.pgrst.object");
        return sendJson(res,200,single?(rows[0]||null):rows,{"Content-Range":`0-${Math.max(rows.length-1,0)}/${rows.length}`});
      });
      return;
    }
    return sendJson(res,404,{message:"fixture: not found"});
  }
  const rel = pathname === "/crm" || pathname.startsWith("/crm/") ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/,"");
  const file = path.resolve(root,rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200,{"Content-Type":mime[path.extname(file)]||"application/octet-stream"});
  fs.createReadStream(file).pipe(res);
});

await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({executablePath:browserPath,headless:true});
const results = [];
const pass = (condition,label) => results.push([condition?"PASS":"FAIL",label]);
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror",error => pageErrors.push(error.message));
  await page.goto(`${base}/crm#/kpi/mine`,{waitUntil:"load"});
  await page.fill("#loginEmail",USER.email);
  await page.fill("#loginPassword","fixture-password");
  await page.click("#loginBtn");
  await page.waitForSelector("#kpi2OperationsPanel:not(.hide)",{timeout:10000});
  await page.waitForFunction(() => document.querySelector("#kpi2CurrentPeriodContext")?.textContent.includes("10/2026"));
  const normalText = await page.locator("#kpi2OperationsPanel").innerText();
  pass(normalText.includes("KPI October") && !normalText.includes("KPI September"),"normal: only October assignment card renders");
  pass(normalText.includes("Event October") && !normalText.includes("Event September"),"normal: Sale history is current-period only");
  const progressCall = requests.find(row => row.table === "crm_kpi_get_assignment_progress" && row.mode === "normal");
  pass(progressCall?.body?.p_period_id === "period-oct",`normal: progress RPC period = ${progressCall?.body?.p_period_id}`);
  for (const table of ["kpi_submission_events","kpi_evidence","kpi_submissions"]) {
    const call = requests.find(row => row.table === table && row.mode === "normal");
    pass(call?.url.includes("assignment-oct") && !call?.url.includes("assignment-sep"),`normal: ${table} request uses only October assignment ids`);
  }

  const progressCount = () => requests.filter(row => row.table === "crm_kpi_get_assignment_progress").length;
  const beforeNone = progressCount(); periodMode = "none";
  await page.reload({waitUntil:"load"});
  await page.waitForFunction(() => document.querySelector("#kpi2CurrentPeriodContext")?.textContent.includes("Chưa có kỳ KPI"));
  pass(progressCount() === beforeNone,"none: fail closed before progress RPC");
  pass(!(await page.locator("#kpi2ProgressRows").innerText()).includes("Gửi event"),"none: no submit action renders");

  const beforeOverlap = progressCount(); periodMode = "overlap";
  await page.reload({waitUntil:"load"});
  await page.waitForFunction(() => document.querySelector("#kpi2CurrentPeriodContext")?.textContent.includes("nhiều kỳ KPI ACTIVE"));
  pass(progressCount() === beforeOverlap,"overlap: fail closed before progress RPC");
  pass(!(await page.locator("#kpi2ProgressRows").innerText()).includes("Gửi event"),"overlap: no submit action renders");
  pass(requests.filter(row => row.table === "crm_kpi_get_assignment_progress").every(row => row.body?.p_period_id),"observability: no unscoped Sale progress RPC");
  pass(requests.filter(row => /crm_kpi_submit|crm_kpi_withdraw|crm_kpi_review/.test(row.table)).length === 0,"observability: no KPI business mutation RPC");
  pass(pageErrors.length === 0,`browser page errors = ${pageErrors.length} ${pageErrors.slice(0,2).join(" | ")}`);

  if (previewUrl) {
    const preview = await browser.newPage();
    const protectedRequests = [], httpErrors = [], previewPageErrors = [], previewConsoleErrors = [];
    preview.on("request",request => { if (/\/rest\/v1\/|\/storage\/v1\//.test(request.url())) protectedRequests.push(request.url()); });
    preview.on("response",response => { if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`); });
    preview.on("pageerror",error => previewPageErrors.push(error.message));
    preview.on("console",message => { if (message.type() === "error" && !/WebSocket|realtime/i.test(message.text())) previewConsoleErrors.push(message.text()); });
    await preview.goto(`${previewUrl}/crm`,{waitUntil:"networkidle"});
    await preview.waitForSelector("#loginView:not(.hide)",{timeout:10000});
    pass(protectedRequests.length === 0,`preview anonymous: protected reads = ${protectedRequests.length}`);
    pass(httpErrors.length === 0,`preview anonymous: HTTP >=400 = ${httpErrors.length} ${httpErrors.slice(0,2).join(" | ")}`);
    pass(previewPageErrors.length === 0,`preview anonymous: page errors = ${previewPageErrors.length}`);
    pass(previewConsoleErrors.length === 0,`preview anonymous: console errors = ${previewConsoleErrors.length} ${previewConsoleErrors.slice(0,2).join(" | ")}`);
    await preview.close();
  }
} finally {
  await browser.close();
  server.close();
}
for (const [status,label] of results) console.log(status,label);
const failed = results.filter(([status]) => status === "FAIL").length;
assert.equal(failed,0,`${failed} KPI Sale current-period browser check(s) failed`);
console.log(`KPI Sale current-period browser: PASS (${results.length} checks)`);
