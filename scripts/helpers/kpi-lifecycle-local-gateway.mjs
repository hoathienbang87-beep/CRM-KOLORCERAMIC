// =====================================================================
// KPI 7C-B — minimal local Supabase gateway for end-to-end UI acceptance.
//
// Serves the CRM static files and a tiny PostgREST/Auth/Storage subset on
// 127.0.0.1, backed by a DISPOSABLE local PostgreSQL through `psql`:
//   * /auth/v1/token, /auth/v1/user, /auth/v1/logout  (password login by
//     email for synthetic auth.users rows; JWT is unsigned fixture data)
//   * /rest/v1/rpc/<fn>  → real SQL function, executed in a transaction with
//     `set local role authenticated` + request.jwt.claim.* (same as PostgREST)
//   * /rest/v1/<table>   → read-only SELECT for KPI tables + app_users using
//     the PostgREST filter syntax the CRM uses (eq/neq/in/is/gt/gte/lt/lte/
//     like/ilike, order, limit, offset, count=exact)
//   * /storage/v1/object/sign/* → signed URL to a fixture JPEG
// Anything else returns an empty result, like the existing browser mocks.
//
// Limitations (documented, acceptable for UI acceptance): table reads run as
// the cluster owner (no RLS emulation); writes to tables are ignored and
// recorded so tests can assert none happened on KPI tables.
// Never point this at a remote database: non-local PGHOST is refused.
// =====================================================================
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const MIME = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".mp4":"video/mp4",".json":"application/json"};
const READ_TABLES = new Set(["app_users","kpi_periods","kpi_definitions","kpi_assignments","kpi_submissions","kpi_submission_events","kpi_evidence","kpi_duplicate_matches"]);
const IDENT = /^[a-z_][a-z0-9_]*$/;
// 1x1 white JPEG
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

const lit = value => value === null || value === undefined ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");

export function runPsql({host, port, user, database}, sql) {
  return new Promise(resolve => {
    const child = spawn("psql", ["-h", host, "-p", String(port), "-U", user, "-d", database, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1"]);
    let out = "", err = "";
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("close", code => resolve({code, out: out.trim(), err: err.trim()}));
    child.stdin.end(`\\set VERBOSITY verbose\n${sql}`);
  });
}

function pgError(err) {
  const line = err.split("\n").find(l => /^(psql:.*?)?ERROR:/.test(l)) || err.split("\n")[0] || "unknown error";
  const m = line.match(/ERROR:\s+([0-9A-Z]{5}):\s+(.*)$/);
  const detail = (err.match(/DETAIL:\s+(.*)/) || [])[1] || null;
  const hint = (err.match(/HINT:\s+(.*)/) || [])[1] || null;
  return {code: m ? m[1] : "XX000", message: m ? m[2] : line.replace(/^.*ERROR:\s*/, ""), details: detail, hint};
}

function parseFilter(column, raw) {
  if (!IDENT.test(column)) return null;
  let value = raw, negate = false;
  if (value.startsWith("not.")) { negate = true; value = value.slice(4); }
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const op = value.slice(0, dot), arg = value.slice(dot + 1);
  const col = `"${column}"`;
  let sql;
  if (op === "eq") sql = `${col}::text = ${lit(arg)}`;
  else if (op === "neq") sql = `${col}::text <> ${lit(arg)}`;
  else if (["gt","gte","lt","lte"].includes(op)) sql = `${col} ${({gt:">",gte:">=",lt:"<",lte:"<="})[op]} ${lit(arg)}`;
  else if (op === "like" || op === "ilike") sql = `${col}::text ${op} ${lit(arg.replaceAll("*", "%"))}`;
  else if (op === "is") sql = `${col} is ${({null:"null",true:"true",false:"false"})[arg.toLowerCase()] || "null"}`;
  else if (op === "in") {
    const inner = arg.replace(/^\(/, "").replace(/\)$/, "");
    const items = inner.length ? inner.match(/("([^"\\]|\\.)*"|[^,]+)/g).map(v => v.startsWith('"') ? v.slice(1, -1).replace(/\\(.)/g, "$1") : v) : [];
    sql = items.length ? `${col}::text in (${items.map(lit).join(",")})` : "false";
  } else return null;
  return negate ? `not (${sql})` : sql;
}

export async function startLocalGateway({root, pg, onRequest = () => {}}) {
  if (!(pg.host.startsWith("/") || ["localhost", "127.0.0.1", "::1"].includes(pg.host))) throw new Error(`REFUSING non-local PGHOST ${pg.host}`);
  const tokens = new Map(); // token -> auth user
  const columnsCache = new Map();
  const functionCache = new Map();

  async function tableColumns(table) {
    if (!columnsCache.has(table)) {
      const r = await runPsql(pg, `select coalesce(json_agg(column_name), '[]') from information_schema.columns where table_schema='public' and table_name=${lit(table)}`);
      columnsCache.set(table, new Set(JSON.parse(r.out || "[]")));
    }
    return columnsCache.get(table);
  }
  async function functionInfo(name) {
    if (!functionCache.has(name)) {
      const r = await runPsql(pg, `select coalesce(json_agg(json_build_object('args', coalesce(p.proargnames, array[]::text[]), 'types', (select coalesce(array_agg(format_type(t, null) order by i), array[]::text[]) from unnest(p.proargtypes) with ordinality as u(t, i)), 'retset', p.proretset, 'rettype', format_type(p.prorettype, null))), '[]')
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = ${lit(name)}`);
      functionCache.set(name, JSON.parse(r.out || "[]")[0] || null);
    }
    return functionCache.get(name);
  }

  async function handleRpc(name, body, authUser) {
    if (!IDENT.test(name)) return {status: 404, body: {message: "bad rpc"}};
    const info = await functionInfo(name);
    if (!info) return {status: 200, body: []}; // same as the existing mocks: unknown RPCs are inert
    const args = [];
    info.args.forEach((arg, i) => {
      if (!arg || !(arg in (body || {}))) return;
      const type = info.types[i];
      const value = body[arg];
      let expr;
      if (value === null || value === undefined) expr = `null::${type}`;
      else if (type === "jsonb" || type === "json") expr = `${lit(JSON.stringify(value))}::${type}`;
      else if (type.endsWith("[]")) expr = `(select array_agg(x) from jsonb_array_elements_text(${lit(JSON.stringify(value))}::jsonb) x)::${type}`;
      else expr = `${lit(typeof value === "object" ? JSON.stringify(value) : value)}::${type}`;
      args.push(`${arg} => ${expr}`);
    });
    const call = `public.${name}(${args.join(", ")})`;
    const select = info.retset || info.rettype === "record"
      ? `select coalesce(jsonb_agg(r), '[]') from ${call} r;`
      : info.rettype === "void" ? `select ${call}; select 'null';` : `select coalesce(to_jsonb(${call}), 'null');`;
    const sql = `begin;
\\o /dev/null
set local role authenticated;
select set_config('request.jwt.claim.sub', ${lit(authUser?.id || "")}, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.email', ${lit(authUser?.email || "")}, true);
\\o
${select}
commit;`;
    const r = await runPsql(pg, sql);
    if (r.code !== 0) {
      const error = pgError(r.err);
      return {status: error.code === "42501" ? 403 : 400, body: error};
    }
    return {status: 200, body: JSON.parse(r.out.split("\n").pop() || "null")};
  }

  async function handleSelect(table, url, headers, method) {
    if (!READ_TABLES.has(table)) return {status: 200, body: [], total: 0};
    const columns = await tableColumns(table);
    const where = [], order = [];
    let limit = null, offset = null, select = "*";
    for (const [key, value] of url.searchParams) {
      if (key === "select") select = value;
      else if (key === "order") {
        for (const part of value.split(",")) {
          const [col, dir, nulls] = part.split(".");
          if (columns.has(col)) order.push(`"${col}" ${dir === "desc" ? "desc" : "asc"}${nulls === "nullsfirst" ? " nulls first" : nulls === "nullslast" ? " nulls last" : ""}`);
        }
      } else if (key === "limit") limit = Number(value) || null;
      else if (key === "offset") offset = Number(value) || null;
      else if (columns.has(key)) { const f = parseFilter(key, value); if (f) where.push(f); }
    }
    const cols = select === "*" || select.includes("(") ? "*"
      : select.split(",").map(c => c.trim().split(":").pop()).filter(c => columns.has(c)).map(c => `"${c}"`).join(",") || "*";
    const base = `from public.${table}${where.length ? ` where ${where.join(" and ")}` : ""}`;
    const sql = `select coalesce(jsonb_agg(t), '[]') from (select ${cols} ${base}${order.length ? ` order by ${order.join(",")}` : ""}${limit ? ` limit ${limit}` : ""}${offset ? ` offset ${offset}` : ""}) t;
select count(*) ${base};`;
    const r = await runPsql(pg, sql);
    if (r.code !== 0) return {status: 400, body: pgError(r.err)};
    const [rows, total] = r.out.split("\n");
    return {status: 200, body: method === "HEAD" ? undefined : JSON.parse(rows), total: Number(total)};
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;
    const send = (status, body, headers = {}) => {
      res.writeHead(status, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...headers});
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    if (pathname === "/js/supabase-config.js") {
      res.writeHead(200, {"Content-Type": MIME[".js"]});
      return res.end(`window.CRM_SUPABASE_CONFIG={url:"http://127.0.0.1:${server.address().port}/sb",anonKey:"local-gateway-anon"};`);
    }
    if (pathname.startsWith("/sb/")) {
      if (req.method === "OPTIONS") { res.writeHead(204, {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*"}); return res.end(); }
      let raw = "";
      req.on("data", c => (raw += c));
      await new Promise(r => req.on("end", r));
      const body = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : null;
      const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const authUser = tokens.get(bearer) || null;
      const sbPath = pathname.slice(3);
      const record = {method: req.method, path: sbPath, url: url.href, body, user: authUser?.email || null};
      onRequest(record);

      if (sbPath.startsWith("/auth/v1/token")) {
        const email = String(body?.email || "").toLowerCase();
        const r = await runPsql(pg, `select coalesce(json_agg(json_build_object('id', id, 'email', email)), '[]') from auth.users where lower(email) = ${lit(email)}`);
        const found = JSON.parse(r.out || "[]")[0];
        if (!found && url.searchParams.get("grant_type") === "password") return send(400, {error: "invalid_grant", error_description: "Invalid login credentials"});
        const userRow = found || [...tokens.values()].find(u => u.refresh === body?.refresh_token);
        if (!userRow) return send(400, {error: "invalid_grant", error_description: "Refresh Token Not Found"});
        const user = {id: userRow.id, email: userRow.email, aud: "authenticated", role: "authenticated", app_metadata: {provider: "email"}, user_metadata: {}};
        const token = `${b64({alg: "HS256", typ: "JWT"})}.${b64({sub: user.id, role: "authenticated", email: user.email, exp: Math.floor(Date.now() / 1000) + 3600})}.local-${tokens.size}`;
        const refresh = `refresh-${tokens.size}-${user.id}`;
        tokens.set(token, {...user, refresh});
        return send(200, {access_token: token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refresh, user});
      }
      if (sbPath.startsWith("/auth/v1/user")) return authUser ? send(200, authUser) : send(401, {message: "invalid JWT"});
      if (sbPath.startsWith("/auth/v1/logout")) { tokens.delete(bearer); res.writeHead(204, {"Access-Control-Allow-Origin": "*"}); return res.end(); }
      if (sbPath.startsWith("/storage/v1/object/sign/")) {
        const objectPath = decodeURIComponent(sbPath.slice("/storage/v1/object/sign/".length));
        if (Array.isArray(body?.paths)) return send(200, body.paths.map(p => ({path: p, signedURL: `/object/sign/${objectPath}/${p}?token=local`, error: null})));
        return send(200, {signedURL: `/object/sign/${objectPath}?token=local`});
      }
      if (sbPath.startsWith("/storage/v1/")) { res.writeHead(200, {"Content-Type": "image/jpeg", "Access-Control-Allow-Origin": "*"}); return res.end(JPEG); }
      if (sbPath.startsWith("/rest/v1/")) {
        if (!authUser) return send(401, {code: "42501", message: "permission denied (no session)"});
        if (sbPath.startsWith("/rest/v1/rpc/")) {
          const result = await handleRpc(sbPath.slice("/rest/v1/rpc/".length), body, authUser);
          record.status = result.status; record.response = result.body;
          return send(result.status, result.body);
        }
        const table = sbPath.slice("/rest/v1/".length).split("/")[0];
        if (req.method !== "GET" && req.method !== "HEAD") { record.ignoredWrite = true; return send(201, []); }
        const result = await handleSelect(table, url, req.headers, req.method);
        if (result.status !== 200) return send(result.status, result.body);
        const rows = result.body || [];
        const single = String(req.headers.accept || "").includes("vnd.pgrst.object");
        const total = result.total ?? rows.length;
        return send(200, single ? (rows[0] || null) : (req.method === "HEAD" ? undefined : rows), {"Content-Range": `0-${Math.max(rows.length - 1, 0)}/${total}`});
      }
      return send(200, []);
    }
    const rel = pathname === "/crm" || pathname.startsWith("/crm/") ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
    const file = path.resolve(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, {"Content-Type": MIME[path.extname(file)] || "application/octet-stream"});
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {server, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r))};
}
