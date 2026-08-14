import process from "node:process";

const ref = process.env.STAGING_PROJECT_REF || "";
const base = (process.env.STAGING_SUPABASE_URL || "").replace(/\/$/, "");
const service = process.env.STAGING_SERVICE_ROLE_KEY || "";
if (ref !== "ykhtpvyelpujykheycsv" || base !== `https://${ref}.supabase.co` || !service) {
  throw new Error("KPI-2 staging fixture cleanup guard failed.");
}

async function request(path, {method="GET", body, allow=false}={}) {
  const response = await fetch(`${base}${path}`, {
    method,
    signal: AbortSignal.timeout(60000),
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      ...(body === undefined ? {} : {"Content-Type":"application/json"}),
      ...(method === "DELETE" ? {Prefer:"return=representation"} : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!allow && !response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  return {ok:response.ok, data};
}

const rows = async (table, query) => (await request(`/rest/v1/${table}?${query}`)).data || [];
const remove = async (table, query) => {
  const result = await request(`/rest/v1/${table}?${query}`, {method:"DELETE", allow:true});
  if (!result.ok) throw new Error(`Could not clean staging fixture table ${table}.`);
  return Array.isArray(result.data) ? result.data.length : 0;
};
const inFilter = values => `in.(${values.join(",")})`;

const users = await rows("app_users", "id=like.kpi2-*&select=id,supabase_auth_id");
const userIds = users.map(row => row.id);
const customers = await rows("customers", "id=like.kpi2-customer-*&select=id");
const customerIds = customers.map(row => row.id);
const events = userIds.length ? await rows("kpi_submission_events", `actor_user_id=${inFilter(userIds)}&select=id,submission_id`) : [];
const eventIds = events.map(row => row.id);
const submissionIds = [...new Set(events.map(row => row.submission_id))];

if (eventIds.length) {
  await remove("kpi_duplicate_matches", `or=(event_id.${inFilter(eventIds)},duplicate_event_id.${inFilter(eventIds)})`);
  await remove("kpi_evidence", `event_id=${inFilter(eventIds)}`);
}
if (userIds.length) {
  await remove("kpi_evidence", `uploaded_by_user_id=${inFilter(userIds)}`);
  await remove("kpi_action_requests", `actor_user_id=${inFilter(userIds)}`);
}
if (eventIds.length) await remove("kpi_submission_events", `id=${inFilter(eventIds)}`);
if (submissionIds.length) await remove("kpi_submissions", `id=${inFilter(submissionIds)}`);
if (userIds.length) await remove("kpi_assignments", `employee_id=${inFilter(userIds)}`);
await remove("kpi_periods", "name=like.KPI2%20*");
await remove("kpi_definitions", "code=like.KPI2_*");
await remove("care_logs", "created_by_email=like.kpi2-*@example.com");
if (customerIds.length) await remove("customer_assignments", `customer_id=${inFilter(customerIds)}`);
if (userIds.length) {
  await remove("customer_assignments", `or=(employee_id.${inFilter(userIds)},assigned_by_user_id.${inFilter(userIds)},ended_by_user_id.${inFilter(userIds)})`);
}
if (customerIds.length) await remove("customers", `id=${inFilter(customerIds)}`);
await remove("audit_logs", "email=like.kpi2-*@example.com");
if (userIds.length) await remove("app_users", `id=${inFilter(userIds)}`);

for (const user of users) {
  if (user.supabase_auth_id) await request(`/auth/v1/admin/users/${user.supabase_auth_id}`, {method:"DELETE", allow:true});
}

console.log(`KPI-2 staging fixture cleanup: PASS (${users.length} test users inspected)`);
