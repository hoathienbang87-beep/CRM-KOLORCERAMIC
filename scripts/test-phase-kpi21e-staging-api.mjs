import process from "node:process";

const expectedRef = "ykhtpvyelpujykheycsv";
const productionRef = "jjeeazwlqcwynzquimeo";
const projectRef = process.env.STAGING_PROJECT_REF || "";
const baseUrl = (process.env.STAGING_SUPABASE_URL || "").replace(/\/$/, "");
const anonKey = process.env.STAGING_ANON_KEY || "";
const serviceKey = process.env.STAGING_SERVICE_ROLE_KEY || "";
const mode = String(process.env.KPI21E_TEST_MODE || "").toUpperCase();
const runId = process.env.KPI21E_RUN_ID || "";
const password = process.env.KPI21E_TEST_PASSWORD || "";

if (projectRef !== expectedRef || baseUrl !== `https://${expectedRef}.supabase.co`) {
  throw new Error("Refusing to run: KPI-2.1E staging project guard failed.");
}
if (projectRef === productionRef || baseUrl.includes(productionRef)) {
  throw new Error("Refusing to run against production.");
}
if (!anonKey || !serviceKey || !runId || !password || !["PRE", "POST", "CLEANUP", "CLEANUP_ALL"].includes(mode)) {
  throw new Error("Missing KPI-2.1E staging test inputs.");
}

const ruleId = `kpi21e-rule-${runId}`;
const proposalIds = ["approve", "reject", "archive"].map(kind => `kpi21e-${kind}-${runId}`);
const fakeProposalId = `kpi21e-backdate-${runId}`;
const evidenceObject = `kpi21e${runId}saleexamplecom/2026-08/${proposalIds[0]}/proof.png`;
const fakeEvidenceObject = `kpi21e${runId}saleexamplecom/2026-08/${fakeProposalId}/proof.png`;
const users = [
  {key: "sale", role: "sale"},
  {key: "manager", role: "manager"},
  {key: "admin", role: "admin"}
].map(item => ({
  ...item,
  email: `kpi21e-${runId}-${item.key}@example.com`,
  appUserId: `kpi21e-user-${runId}-${item.key}`
}));

const checks = [];
function record(name, condition, detail = "") {
  if (!condition) throw new Error(`Check failed: ${name}${detail ? ` (${detail})` : ""}`);
  checks.push(name);
}

async function request(path, {method = "GET", token = serviceKey, key = serviceKey, body, rawBody, headers = {}, allowError = false} = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? {"Content-Type": "application/json"} : {}),
      ...headers
    },
    body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!allowError && !response.ok) throw new Error(`HTTP ${response.status} for ${method} ${path}`);
  return {ok: response.ok, status: response.status, data};
}

async function createUser(user) {
  const auth = await request("/auth/v1/admin/users", {
    method: "POST",
    body: {email: user.email, password, email_confirm: true, user_metadata: {name: `KPI21E ${user.key}`}}
  });
  user.authId = auth.data.id;
  await request("/rest/v1/app_users", {
    method: "POST",
    body: {
      id: user.appUserId,
      supabase_auth_id: user.authId,
      email: user.email,
      name: `KPI21E ${user.key}`,
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

async function rpc(user, name, body, allowError = false) {
  return request(`/rest/v1/rpc/${name}`, {
    method: "POST",
    token: user.token,
    key: anonKey,
    body,
    allowError
  });
}

async function selectService(table, query) {
  return (await request(`/rest/v1/${table}?${query}`)).data;
}

async function cleanup() {
  await request(`/storage/v1/object/kpi-evidence/${evidenceObject}`, {method: "DELETE", allowError: true});
  await request(`/storage/v1/object/kpi-evidence/${fakeEvidenceObject}`, {method: "DELETE", allowError: true});
  for (const id of [...proposalIds, fakeProposalId]) {
    await request(`/rest/v1/audit_logs?entity_id=eq.${encodeURIComponent(id)}`, {method: "DELETE", allowError: true});
    await request(`/rest/v1/kpi_proposals?id=eq.${encodeURIComponent(id)}`, {method: "DELETE", allowError: true});
  }
  await request(`/rest/v1/kpi_rules?id=eq.${encodeURIComponent(ruleId)}`, {method: "DELETE", allowError: true});
  for (const user of users) {
    const authRows = await request(`/auth/v1/admin/users?page=1&per_page=1000`, {allowError: true});
    const authUser = Array.isArray(authRows.data?.users)
      ? authRows.data.users.find(item => item.email === user.email)
      : null;
    await request(`/rest/v1/app_users?id=eq.${encodeURIComponent(user.appUserId)}`, {method: "DELETE", allowError: true});
    if (authUser?.id) await request(`/auth/v1/admin/users/${authUser.id}`, {method: "DELETE", allowError: true});
  }
}

async function cleanupAllPhaseFixtures() {
  await request("/rest/v1/audit_logs?entity_id=like.kpi21e-*", {method: "DELETE", allowError: true});
  await request("/rest/v1/kpi_proposals?id=like.kpi21e-*", {method: "DELETE", allowError: true});
  await request("/rest/v1/kpi_rules?id=like.kpi21e-*", {method: "DELETE", allowError: true});
  const authRows = await request("/auth/v1/admin/users?page=1&per_page=1000", {allowError: true});
  const phaseUsers = Array.isArray(authRows.data?.users)
    ? authRows.data.users.filter(item => String(item.email || "").startsWith("kpi21e-"))
    : [];
  await request("/rest/v1/app_users?id=like.kpi21e-user-*", {method: "DELETE", allowError: true});
  for (const authUser of phaseUsers) {
    await request(`/auth/v1/admin/users/${authUser.id}`, {method: "DELETE", allowError: true});
  }
}

async function runPre() {
  const bucket = await request("/storage/v1/bucket/kpi-evidence", {allowError: true});
  if (!bucket.ok) {
    await request("/storage/v1/bucket", {
      method: "POST",
      body: {id: "kpi-evidence", name: "kpi-evidence", public: true, file_size_limit: 5242880}
    });
  }
  record("legacy evidence bucket available in staging", true);
  for (const user of users) await createUser(user);
  for (const user of users) await signIn(user);
  const byKey = Object.fromEntries(users.map(user => [user.key, user]));

  const status = await rpc(byKey.manager, "crm_legacy_kpi_cutover_status", {});
  record("server reports PRE-CUTOVER", status.data?.preCutover === true);

  const rule = await request("/rest/v1/kpi_rules", {
    method: "POST",
    token: byKey.manager.token,
    key: anonKey,
    headers: {Prefer: "return=representation"},
    body: {
      id: ruleId,
      month: "2026-08",
      name: "KPI21E staging legacy rule",
      target: 3,
      count_mode: "proposal",
      assigned_owners: [byKey.sale.email],
      owner_targets: {[byKey.sale.email]: 3},
      active: true,
      created_by_email: byKey.manager.email,
      raw_data: {testRun: runId}
    }
  });
  record("manager creates legacy rule before cutover", Array.isArray(rule.data) && rule.data.length === 1);

  for (const [index, proposalId] of proposalIds.entries()) {
    const result = await rpc(byKey.sale, "crm_submit_kpi_proposal", {
      p_proposal_id: proposalId,
      p_proposal: {
        kpiRuleId: ruleId,
        month: "2026-08",
        owner: "KPI21E sale",
        content: `Pre-cutover proposal ${index + 1}`
      }
    });
    record(`sale creates pre-cutover proposal ${index + 1}`, result.data?.id === proposalId);
  }

  const rows = await selectService("kpi_proposals", `id=in.(${proposalIds.join(",")})&select=id,status,created_at`);
  record("all pre-cutover proposals persisted", rows.length === 3 && rows.every(row => row.status === "pending"));
}

async function runPost() {
  for (const user of users) await signIn(user);
  const byKey = Object.fromEntries(users.map(user => [user.key, user]));

  const status = await rpc(byKey.manager, "crm_legacy_kpi_cutover_status", {});
  record("server reports POST-CUTOVER", status.data?.preCutover === false);

  const backdated = await rpc(byKey.sale, "crm_submit_kpi_proposal", {
    p_proposal_id: fakeProposalId,
    p_proposal: {
      kpiRuleId: ruleId,
      month: "2026-08",
      createdAt: "2026-08-01T00:00:00Z",
      owner: "KPI21E sale",
      content: "Backdated bypass attempt"
    }
  }, true);
  record("backdated new legacy proposal denied by RPC", !backdated.ok);

  const directProposal = await request("/rest/v1/kpi_proposals", {
    method: "POST",
    token: byKey.sale.token,
    key: anonKey,
    body: {id: fakeProposalId, month: "2026-08", status: "pending", created_at: "2026-08-01T00:00:00Z"},
    allowError: true
  });
  record("direct legacy proposal insert denied", !directProposal.ok);

  const newRule = await request("/rest/v1/kpi_rules", {
    method: "POST",
    token: byKey.manager.token,
    key: anonKey,
    body: {id: `kpi21e-new-rule-${runId}`, month: "2026-08", name: "Bypass", target: 1, active: true},
    allowError: true
  });
  record("new legacy rule denied", !newRule.ok);

  const rulePatch = await request(`/rest/v1/kpi_rules?id=eq.${ruleId}`, {
    method: "PATCH",
    token: byKey.manager.token,
    key: anonKey,
    headers: {Prefer: "return=representation"},
    body: {active: false},
    allowError: true
  });
  const persistedRule = await selectService("kpi_rules", `id=eq.${ruleId}&select=active`);
  record("legacy rule edit/toggle denied", !rulePatch.ok || (Array.isArray(rulePatch.data) && rulePatch.data.length === 0));
  record("legacy rule remains unchanged", persistedRule[0]?.active === true);

  const edit = await rpc(byKey.sale, "crm_submit_kpi_proposal", {
    p_proposal_id: proposalIds[0],
    p_proposal: {kpiRuleId: ruleId, month: "2026-08", content: "Close-out supplement after cutover"}
  });
  record("sale edits own pre-cutover pending proposal", edit.data?.updated === true);

  const wrongReviewer = await rpc(byKey.sale, "crm_review_kpi_proposal", {
    p_proposal_id: proposalIds[1],
    p_status: "approved",
    p_review_note: "not allowed",
    p_review_snapshot: {}
  }, true);
  record("sale cannot review legacy proposal", !wrongReviewer.ok);

  const evidenceUpload = await request(`/storage/v1/object/kpi-evidence/${evidenceObject}`, {
    method: "POST",
    token: byKey.sale.token,
    key: anonKey,
    headers: {"Content-Type": "image/png", "x-upsert": "false"},
    rawBody: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    allowError: true
  });
  const evidenceAllowed = await rpc(byKey.sale, "crm_legacy_kpi_evidence_upload_allowed", {p_object_name: evidenceObject});
  record("server predicate allows evidence for existing pre-cutover pending", evidenceAllowed.data === true, JSON.stringify(evidenceAllowed.data));
  record("sale supplements evidence for existing pre-cutover pending", evidenceUpload.ok, `${evidenceUpload.status} ${JSON.stringify(evidenceUpload.data)}`);

  const fakeEvidence = await request(`/storage/v1/object/kpi-evidence/${fakeEvidenceObject}`, {
    method: "POST",
    token: byKey.sale.token,
    key: anonKey,
    headers: {"Content-Type": "image/png", "x-upsert": "false"},
    rawBody: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    allowError: true
  });
  record("new legacy evidence path denied", !fakeEvidence.ok);

  const approved = await rpc(byKey.manager, "crm_review_kpi_proposal", {
    p_proposal_id: proposalIds[0], p_status: "approved", p_review_note: "close-out", p_review_snapshot: {testRun: runId}
  });
  const rejected = await rpc(byKey.manager, "crm_review_kpi_proposal", {
    p_proposal_id: proposalIds[1], p_status: "rejected", p_review_note: "close-out", p_review_snapshot: {testRun: runId}
  });
  const archived = await rpc(byKey.sale, "crm_archive_kpi_proposal", {p_proposal_id: proposalIds[2]});
  record("manager approves pre-cutover pending", approved.data?.status === "approved");
  record("manager rejects pre-cutover pending", rejected.data?.status === "rejected");
  record("sale archives own pre-cutover pending", archived.data?.archived === true);

  const closedEdit = await rpc(byKey.sale, "crm_submit_kpi_proposal", {
    p_proposal_id: proposalIds[0],
    p_proposal: {kpiRuleId: ruleId, month: "2026-08", content: "Mutate closed proposal"}
  }, true);
  record("closed legacy proposal mutation denied", !closedEdit.ok);

  const noBypass = await selectService("kpi_proposals", `id=eq.${fakeProposalId}&select=id`);
  record("backdate bypass created no row", noBypass.length === 0);
}

try {
  if (mode === "PRE") await runPre();
  if (mode === "POST") await runPost();
  if (mode === "CLEANUP") await cleanup();
  if (mode === "CLEANUP_ALL") await cleanupAllPhaseFixtures();
  console.log(`KPI-2.1E staging ${mode}: PASS (${checks.length} checks)`);
  checks.forEach((name, index) => console.log(`${index + 1}. ${name}`));
} catch (error) {
  console.error(`KPI-2.1E staging ${mode}: FAIL - ${error.message}`);
  process.exitCode = 1;
}
