import process from "node:process";

const ref = process.env.STAGING_PROJECT_REF || "";
const base = (process.env.STAGING_SUPABASE_URL || "").replace(/\/$/, "");
const service = process.env.STAGING_SERVICE_ROLE_KEY || "";
if (ref !== "ykhtpvyelpujykheycsv" || base !== `https://${ref}.supabase.co` || !service) {
  throw new Error("KPI-2 staging cleanup guard failed.");
}

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method || "GET",
    signal: AbortSignal.timeout(60000),
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      ...(options.headers || {}),
      ...(options.body ? {"Content-Type": "application/json"} : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path}: HTTP ${response.status}`);
  return text ? JSON.parse(text) : null;
}

if (process.env.KPI2_CLEAN_TEST_AUDIT === "1") {
  const removed = await request("/rest/v1/audit_logs?email=like.kpi2-*@example.com&select=id", {
    method: "DELETE",
    headers: {Prefer: "return=representation"}
  });
  console.log(`KPI-2 staging fixture audit cleanup: ${removed.length} rows removed`);
}

const probes = [
  ["app_users", "id=like.kpi2-*&select=id"],
  ["kpi_periods", "name=like.KPI2%20*&select=id"],
  ["kpi_definitions", "code=like.KPI2_*&select=id"],
  ["audit_logs", "email=like.kpi2-*@example.com&select=id"]
];
const residue = [];
for (const [table, query] of probes) {
  const rows = await request(`/rest/v1/${table}?${query}`);
  if (rows.length) residue.push(`${table}: ${rows.length}`);
}
const objects = await request("/storage/v1/object/list/kpi2-evidence", {
  method: "POST",
  body: {prefix: "kpi2/", limit: 1000, offset: 0, sortBy: {column: "name", order: "asc"}}
});
if (objects.length) residue.push(`kpi2-evidence objects: ${objects.length}`);

if (residue.length) {
  console.error(`KPI-2 staging residue: FAIL (${residue.join(", ")})`);
  process.exit(1);
}
console.log("KPI-2 staging residue: PASS (no test users, periods, definitions, audit rows or objects)");
