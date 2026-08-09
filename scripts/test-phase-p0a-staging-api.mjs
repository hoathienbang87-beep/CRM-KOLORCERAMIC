import crypto from "node:crypto";
import process from "node:process";

const expectedRef = "ykhtpvyelpujykheycsv";
const productionRef = "jjeeazwlqcwynzquimeo";
const projectRef = process.env.STAGING_PROJECT_REF || "";
const baseUrl = (process.env.STAGING_SUPABASE_URL || "").replace(/\/$/, "");
const anonKey = process.env.STAGING_ANON_KEY || "";
const serviceKey = process.env.STAGING_SERVICE_ROLE_KEY || "";

if (projectRef !== expectedRef || baseUrl !== `https://${expectedRef}.supabase.co`) {
  throw new Error("Refusing to run: staging project guard failed.");
}
if (projectRef === productionRef || baseUrl.includes(productionRef)) {
  throw new Error("Refusing to run against production.");
}
if (!anonKey || !serviceKey) {
  throw new Error("Missing ephemeral staging API credentials.");
}

const runId = crypto.randomBytes(5).toString("hex");
const password = `${crypto.randomBytes(18).toString("base64url")}aA1!`;
const customerId = `p0a-api-customer-${runId}`;
const careLogId = `p0a-api-care-${runId}`;
const dealId = `p0a-api-deal-${runId}`;
const kpiRuleId = `p0a-api-rule-${runId}`;
const proposalId = `p0a-api-proposal-${runId}`;
const phone = `09${crypto.randomInt(10000000, 99999999)}`;
const users = [
  {key: "admin", role: "admin"},
  {key: "manager", role: "manager"},
  {key: "saleA", role: "sale"},
  {key: "saleB", role: "sale"}
].map(item => ({...item, email: `p0a-${runId}-${item.key.toLowerCase()}@example.com`}));

const createdAuthIds = [];
const checks = [];

function record(name, condition) {
  if (!condition) throw new Error(`Check failed: ${name}`);
  checks.push(name);
}

async function request(path, {method = "GET", token = serviceKey, key = serviceKey, body, headers = {}, allowError = false} = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? {"Content-Type": "application/json"} : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!allowError && !response.ok) {
    throw new Error(`HTTP ${response.status} for ${method} ${path}`);
  }
  return {ok: response.ok, status: response.status, data};
}

async function createAuthUser(user) {
  const result = await request("/auth/v1/admin/users", {
    method: "POST",
    body: {email: user.email, password, email_confirm: true, user_metadata: {name: `P0A ${user.key}`}}
  });
  user.authId = result.data.id;
  user.appUserId = `p0a-api-user-${runId}-${user.key}`;
  createdAuthIds.push(user.authId);
  await request("/rest/v1/app_users", {
    method: "POST",
    body: {
      id: user.appUserId,
      supabase_auth_id: user.authId,
      email: user.email,
      name: `P0A ${user.key}`,
      role: user.role,
      active: true,
      lifecycle_status: "active",
      raw_data: {testRun: runId}
    }
  });
}

async function signIn(user) {
  const result = await request("/auth/v1/token?grant_type=password", {
    method: "POST",
    token: anonKey,
    key: anonKey,
    body: {email: user.email, password}
  });
  user.token = result.data.access_token;
}

async function rpc(user, name, body) {
  return request(`/rest/v1/rpc/${name}`, {
    method: "POST",
    token: user.token,
    key: anonKey,
    body
  });
}

async function selectRows(user, table, query) {
  return request(`/rest/v1/${table}?${query}`, {token: user.token, key: anonKey});
}

async function cleanup() {
  const filters = [
    ["kpi_proposals", `id=eq.${proposalId}`],
    ["kpi_rules", `id=eq.${kpiRuleId}`],
    ["deals", `id=eq.${dealId}`],
    ["care_logs", `id=eq.${careLogId}`],
    ["customer_assignments", `customer_id=eq.${customerId}`],
    ["phone_index", `customer_id=eq.${customerId}`],
    ["audit_logs", `entity_id=eq.${customerId}`],
    ["audit_logs", `entity_id=eq.${careLogId}`],
    ["audit_logs", `entity_id=eq.${dealId}`],
    ["audit_logs", `entity_id=eq.${proposalId}`],
    ["customers", `id=eq.${customerId}`]
  ];
  for (const [table, filter] of filters) {
    await request(`/rest/v1/${table}?${filter}`, {method: "DELETE", allowError: true});
  }
  for (const user of users) {
    if (user.appUserId) {
      await request(`/rest/v1/app_users?id=eq.${encodeURIComponent(user.appUserId)}`, {method: "DELETE", allowError: true});
    }
  }
  for (const authId of createdAuthIds.reverse()) {
    await request(`/auth/v1/admin/users/${authId}`, {method: "DELETE", allowError: true});
  }
}

try {
  for (const user of users) await createAuthUser(user);
  for (const user of users) await signIn(user);
  const byKey = Object.fromEntries(users.map(user => [user.key, user]));

  await request("/rest/v1/kpi_rules", {
    method: "POST",
    body: {
      id: kpiRuleId,
      month: "2026-08",
      name: "P0A staging KPI",
      target: 1,
      count_mode: "proposal",
      assigned_owners: [byKey.saleA.email],
      owner_targets: {[byKey.saleA.email]: 1},
      active: true,
      raw_data: {testRun: runId}
    }
  });

  await rpc(byKey.saleA, "crm_create_customer", {p_customer: {
    id: customerId,
    name: "P0A API Customer",
    phoneRaw: phone,
    phoneNormalized: phone,
    channel: "P0A Test",
    status: "Lead moi"
  }});
  let rows = (await selectRows(byKey.saleA, "customers", `id=eq.${customerId}&select=id,owner_user_id,created_by_user_id,name`)).data;
  record("sale A creates and owns customer", rows.length === 1 && rows[0].owner_user_id === byKey.saleA.appUserId);

  await rpc(byKey.saleA, "crm_update_customer_profile", {p_customer_id: customerId, p_changes: {name: "P0A API Customer Updated"}});
  rows = (await selectRows(byKey.saleA, "customers", `id=eq.${customerId}&select=name`)).data;
  record("profile update reads back", rows[0]?.name === "P0A API Customer Updated");

  await rpc(byKey.saleA, "crm_add_care_log", {
    p_customer_id: customerId,
    p_log: {id: careLogId, note: "P0A care", careChannel: "Phone", careResult: "Hen lai"},
    p_customer_patch: {follow: "Dang cham"}
  });
  await rpc(byKey.saleA, "crm_snooze_customer", {
    p_customer_id: customerId,
    p_next_care_date: "2026-08-11",
    p_follow: "Dang cham",
    p_days: 1
  });
  await rpc(byKey.saleA, "crm_save_basic_purchase", {
    p_action: "create",
    p_customer_id: customerId,
    p_deal_id: dealId,
    p_deal: {dealStatus: "Da coc", amount: 1000000, note: "P0A purchase"},
    p_customer_patch: {}
  });

  const directOwnerUpdate = await request(`/rest/v1/customers?id=eq.${customerId}`, {
    method: "PATCH",
    token: byKey.saleA.token,
    key: anonKey,
    body: {owner_user_id: byKey.saleB.appUserId, owner_email: byKey.saleB.email},
    allowError: true
  });
  record("sale cannot direct-update owner", !directOwnerUpdate.ok);

  await rpc(byKey.saleA, "crm_submit_kpi_proposal", {p_proposal_id: proposalId, p_proposal: {
    kpiRuleId,
    month: "2026-08",
    owner: "P0A saleA",
    content: "P0A staging proposal",
    customerId,
    customerName: "P0A API Customer Updated"
  }});

  await rpc(byKey.manager, "crm_transfer_customer", {
    p_customer_id: customerId,
    p_new_owner_email: byKey.saleB.email,
    p_profile_changes: {}
  });

  const saleAAfter = (await selectRows(byKey.saleA, "customers", `id=eq.${customerId}&select=id`)).data;
  const saleBAfter = (await selectRows(byKey.saleB, "customers", `id=eq.${customerId}&select=id,owner_user_id,created_by_user_id`)).data;
  const managerAfter = (await selectRows(byKey.manager, "customers", `id=eq.${customerId}&select=id`)).data;
  const adminAfter = (await selectRows(byKey.admin, "customers", `id=eq.${customerId}&select=id`)).data;
  record("sale A loses customer after transfer", saleAAfter.length === 0);
  record("sale B gains customer after transfer", saleBAfter.length === 1 && saleBAfter[0].owner_user_id === byKey.saleB.appUserId);
  record("created_by remains sale A", saleBAfter[0]?.created_by_user_id === byKey.saleA.appUserId);
  record("manager retains customer access", managerAfter.length === 1);
  record("admin retains customer access", adminAfter.length === 1);

  const saleACare = (await selectRows(byKey.saleA, "care_logs", `id=eq.${careLogId}&select=id`)).data;
  const saleBCare = (await selectRows(byKey.saleB, "care_logs", `id=eq.${careLogId}&select=id`)).data;
  const saleADeal = (await selectRows(byKey.saleA, "deals", `id=eq.${dealId}&select=id`)).data;
  const saleBDeal = (await selectRows(byKey.saleB, "deals", `id=eq.${dealId}&select=id`)).data;
  record("related history follows current owner", saleACare.length === 0 && saleADeal.length === 0 && saleBCare.length === 1 && saleBDeal.length === 1);

  await rpc(byKey.manager, "crm_review_kpi_proposal", {
    p_proposal_id: proposalId,
    p_status: "approved",
    p_review_note: "P0A approved",
    p_review_snapshot: {testRun: runId}
  });
  const proposals = (await selectRows(byKey.saleA, "kpi_proposals", `id=eq.${proposalId}&select=id,status`)).data;
  record("KPI submit/review works", proposals.length === 1 && proposals[0].status === "approved");

  await rpc(byKey.manager, "crm_set_customer_archived", {p_customer_id: customerId, p_archived: true});
  await rpc(byKey.admin, "crm_set_customer_archived", {p_customer_id: customerId, p_archived: false});
  const restored = (await selectRows(byKey.saleB, "customers", `id=eq.${customerId}&select=id,is_deleted`)).data;
  record("archive/restore works", restored.length === 1 && restored[0].is_deleted === false);

  const anonymous = await request("/rest/v1/rpc/crm_create_customer", {
    method: "POST",
    token: anonKey,
    key: anonKey,
    body: {p_customer: {id: `anon-${runId}`, name: "Anonymous"}},
    allowError: true
  });
  record("anonymous RPC is blocked", !anonymous.ok);

  console.log(`Phase P0-A staging API: PASS (${checks.length} checks)`);
  checks.forEach((check, index) => console.log(`${index + 1}. ${check}`));
} finally {
  await cleanup();
}
