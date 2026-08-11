import crypto from "node:crypto";
import process from "node:process";

const expectedRef = "ykhtpvyelpujykheycsv";
const productionRef = "jjeeazwlqcwynzquimeo";
const projectRef = process.env.STAGING_PROJECT_REF || "";
const baseUrl = (process.env.STAGING_SUPABASE_URL || "").replace(/\/$/, "");
const anonKey = process.env.STAGING_ANON_KEY || "";
const serviceKey = process.env.STAGING_SERVICE_ROLE_KEY || "";

if (projectRef !== expectedRef || baseUrl !== `https://${expectedRef}.supabase.co`) {
  throw new Error("Refusing to run: KPI-1 staging project guard failed.");
}
if (projectRef === productionRef || baseUrl.includes(productionRef)) {
  throw new Error("Refusing to run KPI-1 tests against production.");
}
if (!anonKey || !serviceKey) throw new Error("Missing ephemeral staging API credentials.");

const runId = crypto.randomBytes(5).toString("hex");
const password = `${crypto.randomBytes(18).toString("base64url")}aA1!`;
const month = "2096-11-01";
const monthRace = "2096-12-01";
const code = `KPI1_${runId.toUpperCase()}`;
const codeRace = `KPI1_RACE_${runId.toUpperCase()}`;
const checks = [];
const createdAuthIds = [];
const users = [
  { key: "admin", role: "admin" },
  { key: "manager", role: "manager" },
  { key: "saleA", role: "sale" },
  { key: "saleB", role: "sale" },
  { key: "saleC", role: "sale" },
  { key: "saleD", role: "sale" }
].map(item => ({ ...item, email: `kpi1-${runId}-${item.key.toLowerCase()}@example.com` }));

function record(name, condition) {
  if (!condition) throw new Error(`Check failed: ${name}`);
  checks.push(name);
}

async function request(path, { method = "GET", token = serviceKey, key = serviceKey, body, allowError = false } = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(90000),
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (error) {
    throw new Error(`Request failed or timed out: ${method} ${path} (${error?.name || "Error"})`);
  }
  const responseText = await response.text();
  let data = null;
  if (responseText) {
    try { data = JSON.parse(responseText); } catch { data = responseText; }
  }
  if (!allowError && !response.ok) throw new Error(`HTTP ${response.status} for ${method} ${path}`);
  return { ok: response.ok, status: response.status, data };
}

const rpc = (user, name, body, allowError = false) => request(`/rest/v1/rpc/${name}`, {
  method: "POST", token: user.token, key: anonKey, body, allowError
});
const selectRows = (user, table, query) => request(`/rest/v1/${table}?${query}`, {
  token: user.token, key: anonKey
});

async function createAuthUser(user) {
  const authResult = await request("/auth/v1/admin/users", {
    method: "POST", body: { email: user.email, password, email_confirm: true }
  });
  user.authId = authResult.data.id;
  user.appUserId = `kpi1-api-${runId}-${user.key}`;
  createdAuthIds.push(user.authId);
  await request("/rest/v1/app_users", {
    method: "POST",
    body: {
      id: user.appUserId,
      supabase_auth_id: user.authId,
      email: user.email,
      name: `KPI1 ${user.key}`,
      role: user.role,
      active: true,
      lifecycle_status: "active",
      raw_data: { testRun: runId }
    }
  });
  const login = await request("/auth/v1/token?grant_type=password", {
    method: "POST", token: anonKey, key: anonKey, body: { email: user.email, password }
  });
  user.token = login.data.access_token;
}

async function cleanup() {
  const periodIds = (await request(`/rest/v1/kpi_periods?name=like.KPI1 API ${runId}*&select=id`, { allowError: true })).data || [];
  const definitionIds = (await request(`/rest/v1/kpi_definitions?code=like.KPI1*${runId.toUpperCase()}*&select=id`, { allowError: true })).data || [];
  for (const period of periodIds) {
    await request(`/rest/v1/kpi_assignments?period_id=eq.${period.id}`, { method: "DELETE", allowError: true });
    await request(`/rest/v1/audit_logs?entity_id=eq.${period.id}`, { method: "DELETE", allowError: true });
  }
  for (const definition of definitionIds) {
    await request(`/rest/v1/kpi_assignments?definition_id=eq.${definition.id}`, { method: "DELETE", allowError: true });
    await request(`/rest/v1/audit_logs?entity_id=eq.${definition.id}`, { method: "DELETE", allowError: true });
  }
  if (periodIds.length) await request(`/rest/v1/kpi_periods?id=in.(${periodIds.map(row => row.id).join(",")})`, { method: "DELETE", allowError: true });
  if (definitionIds.length) await request(`/rest/v1/kpi_definitions?id=in.(${definitionIds.map(row => row.id).join(",")})`, { method: "DELETE", allowError: true });
  await request(`/rest/v1/audit_logs?actor_user_id=like.kpi1-api-${runId}-*`, { method: "DELETE", allowError: true });
  await request(`/rest/v1/app_users?id=like.kpi1-api-${runId}-*`, { method: "DELETE", allowError: true });
  for (const authId of createdAuthIds.reverse()) {
    await request(`/auth/v1/admin/users/${authId}`, { method: "DELETE", allowError: true });
  }
}

const byKey = () => Object.fromEntries(users.map(user => [user.key, user]));

try {
  for (const user of users) await createAuthUser(user);
  console.log("KPI-1 staging API fixtures: READY");
  const u = byKey();

  console.log("KPI-1 staging API phase: role and period");
  const saleCreate = await rpc(u.saleA, "crm_kpi_create_period", {
    p_period_month: month, p_name: `KPI1 API ${runId} forbidden`, p_timezone: "Asia/Ho_Chi_Minh"
  }, true);
  record("sale cannot create KPI period", !saleCreate.ok);

  const period = (await rpc(u.manager, "crm_kpi_create_period", {
    p_period_month: "2096-11-19", p_name: `KPI1 API ${runId} main`, p_timezone: "Asia/Ho_Chi_Minh"
  })).data;
  record("manager creates normalized DRAFT period", period.period_month === month && period.status === "DRAFT");

  const duplicate = await rpc(u.manager, "crm_kpi_create_period", {
    p_period_month: month, p_name: `KPI1 API ${runId} duplicate`, p_timezone: "Asia/Ho_Chi_Minh"
  }, true);
  record("duplicate month is rejected", !duplicate.ok);

  const definition = (await rpc(u.manager, "crm_kpi_create_definition", {
    p_code: code,
    p_name: "KPI1 API Name A",
    p_description: "KPI-1 API fixture",
    p_kpi_type: "MANUAL",
    p_source_metric_key: null,
    p_unit: "lượt",
    p_submission_mode: "EVENT_CLAIM",
    p_evidence_required: true
  })).data;

  console.log("KPI-1 staging API phase: assignment and direct-write guard");
  const draftPeriods = (await selectRows(u.saleA, "kpi_periods", `id=eq.${period.id}&select=id`)).data;
  record("sale cannot read DRAFT period", draftPeriods.length === 0);

  const assignedA = (await rpc(u.manager, "crm_kpi_assign_employee", {
    p_period_id: period.id,
    p_definition_id: definition.id,
    p_employee_id: u.saleA.appUserId,
    p_target: 20,
    p_expected_period_version: period.version
  })).data;
  record("single assignment stores employee target and snapshot", assignedA.employee_id === u.saleA.appUserId && Number(assignedA.target) === 20 && assignedA.definition_snapshot.name === "KPI1 API Name A");

  const directInsert = await request("/rest/v1/kpi_assignments", {
    method: "POST", token: u.manager.token, key: anonKey,
    body: {
      period_id: period.id, definition_id: definition.id,
      employee_id: u.saleB.appUserId, target: 10,
      effective_at: period.starts_at, definition_snapshot: assignedA.definition_snapshot,
      assigned_by_user_id: u.manager.appUserId
    },
    allowError: true
  });
  record("manager direct assignment insert is blocked", !directInsert.ok);

  let currentPeriod = (await selectRows(u.manager, "kpi_periods", `id=eq.${period.id}&select=*`)).data[0];
  const concurrentAssignments = await Promise.all([
    rpc(u.manager, "crm_kpi_assign_employee", {
      p_period_id: period.id, p_definition_id: definition.id,
      p_employee_id: u.saleB.appUserId, p_target: 15,
      p_expected_period_version: currentPeriod.version
    }, true),
    rpc(u.admin, "crm_kpi_assign_employee", {
      p_period_id: period.id, p_definition_id: definition.id,
      p_employee_id: u.saleB.appUserId, p_target: 17,
      p_expected_period_version: currentPeriod.version
    }, true)
  ]);
  record("concurrent duplicate assign has exactly one success", concurrentAssignments.filter(result => result.ok).length === 1);
  const saleBAssignments = (await selectRows(u.manager, "kpi_assignments", `period_id=eq.${period.id}&employee_id=eq.${u.saleB.appUserId}&select=id`)).data;
  record("concurrent assign leaves one unique row", saleBAssignments.length === 1);

  console.log("KPI-1 staging API phase: activate race and RLS");
  currentPeriod = (await selectRows(u.manager, "kpi_periods", `id=eq.${period.id}&select=*`)).data[0];
  const assignmentA = (await selectRows(u.manager, "kpi_assignments", `id=eq.${assignedA.id}&select=*`)).data[0];
  const editVsActivate = await Promise.all([
    rpc(u.manager, "crm_kpi_update_assignment_target", {
      p_assignment_id: assignmentA.id,
      p_target: 24,
      p_expected_assignment_version: assignmentA.lock_version,
      p_expected_period_version: currentPeriod.version
    }, true),
    rpc(u.admin, "crm_kpi_activate_period", {
      p_period_id: period.id,
      p_expected_version: currentPeriod.version
    }, true)
  ]);
  record("target edit versus activate serializes to one winner", editVsActivate.filter(result => result.ok).length === 1);

  currentPeriod = (await selectRows(u.manager, "kpi_periods", `id=eq.${period.id}&select=*`)).data[0];
  if (currentPeriod.status === "DRAFT") {
    currentPeriod = (await rpc(u.manager, "crm_kpi_activate_period", {
      p_period_id: period.id, p_expected_version: currentPeriod.version
    })).data;
  }
  record("period is ACTIVE after serialized activation", currentPeriod.status === "ACTIVE");

  const saleAPeriods = (await selectRows(u.saleA, "kpi_periods", `id=eq.${period.id}&select=id,status`)).data;
  const saleAAssignments = (await selectRows(u.saleA, "kpi_assignments", `period_id=eq.${period.id}&select=id,employee_id`)).data;
  const saleADefinitions = (await selectRows(u.saleA, "kpi_definitions", "select=id&limit=1")).data;
  record("sale sees assigned ACTIVE period", saleAPeriods.length === 1 && saleAPeriods[0].status === "ACTIVE");
  record("sale sees only own assignments", saleAAssignments.length === 1 && saleAAssignments[0].employee_id === u.saleA.appUserId);
  record("sale cannot read definition catalog", saleADefinitions.length === 0);

  const closeResult = (await rpc(u.manager, "crm_kpi_close_period_foundation", {
    p_period_id: period.id, p_expected_version: currentPeriod.version
  })).data;
  record("foundation close is fail-closed", closeResult.closed === false && closeResult.code === "KPI_REVIEW_FOUNDATION_INCOMPLETE");

  console.log("KPI-1 staging API phase: snapshot and bulk atomicity");
  const racePeriod = (await rpc(u.manager, "crm_kpi_create_period", {
    p_period_month: monthRace, p_name: `KPI1 API ${runId} race`, p_timezone: "Asia/Ho_Chi_Minh"
  })).data;
  const raceDefinition = (await rpc(u.manager, "crm_kpi_create_definition", {
    p_code: codeRace,
    p_name: "Race Name A",
    p_description: "Definition snapshot race",
    p_kpi_type: "HYBRID",
    p_source_metric_key: "future_metric_v1",
    p_unit: "lượt",
    p_submission_mode: "EVENT_CLAIM",
    p_evidence_required: false
  })).data;

  const editVsSnapshot = await Promise.all([
    rpc(u.manager, "crm_kpi_update_definition", {
      p_definition_id: raceDefinition.id,
      p_expected_version: raceDefinition.version,
      p_changes: { name: "Race Name B" }
    }, true),
    rpc(u.admin, "crm_kpi_assign_employee", {
      p_period_id: racePeriod.id,
      p_definition_id: raceDefinition.id,
      p_employee_id: u.saleC.appUserId,
      p_target: 12,
      p_expected_period_version: racePeriod.version
    }, true)
  ]);
  record("definition edit and snapshot assignment both complete safely", editVsSnapshot.every(result => result.ok));
  const raceAssignment = (await selectRows(u.manager, "kpi_assignments", `period_id=eq.${racePeriod.id}&employee_id=eq.${u.saleC.appUserId}&select=definition_snapshot`)).data[0];
  record("snapshot is internally version-consistent", ["Race Name A", "Race Name B"].includes(raceAssignment.definition_snapshot.name) && [1, 2].includes(Number(raceAssignment.definition_snapshot.definition_version)));
  record("snapshot name/version pair is not torn", (raceAssignment.definition_snapshot.name === "Race Name A" && Number(raceAssignment.definition_snapshot.definition_version) === 1) || (raceAssignment.definition_snapshot.name === "Race Name B" && Number(raceAssignment.definition_snapshot.definition_version) === 2));

  const racePeriodCurrent = (await selectRows(u.manager, "kpi_periods", `id=eq.${racePeriod.id}&select=*`)).data[0];
  const invalidBulk = await rpc(u.manager, "crm_kpi_bulk_assign", {
    p_period_id: racePeriod.id,
    p_definition_id: raceDefinition.id,
    p_rows: [
      { employeeId: u.saleA.appUserId, target: 10 },
      { employeeId: u.manager.appUserId, target: 10 }
    ],
    p_expected_period_version: racePeriodCurrent.version
  }, true);
  record("bulk assign rejects invalid role", !invalidBulk.ok);
  const partialBulk = (await selectRows(u.manager, "kpi_assignments", `period_id=eq.${racePeriod.id}&employee_id=eq.${u.saleA.appUserId}&select=id`)).data;
  record("invalid bulk assign leaves no partial row", partialBulk.length === 0);

  const lifecycleRacePeriod = (await selectRows(u.manager, "kpi_periods", `id=eq.${racePeriod.id}&select=*`)).data[0];
  console.log("KPI-1 staging employee lifecycle race: START");
  const assignVsDeactivate = await Promise.all([
    rpc(u.manager, "crm_kpi_assign_employee", {
      p_period_id: racePeriod.id,
      p_definition_id: raceDefinition.id,
      p_employee_id: u.saleD.appUserId,
      p_target: 9,
      p_expected_period_version: lifecycleRacePeriod.version
    }, true),
    rpc(u.admin, "crm_deactivate_employee", {
      p_employee_id: u.saleD.appUserId,
      p_mode: "unassigned",
      p_replacement_employee_id: null,
      p_reason: "KPI-1 employee lifecycle race test"
    }, true)
  ]);
  record("assign versus employee deactivation serializes to one winner", assignVsDeactivate.filter(result => result.ok).length === 1);
  const lifecycleAssignment = (await request(`/rest/v1/kpi_assignments?period_id=eq.${racePeriod.id}&employee_id=eq.${u.saleD.appUserId}&select=id`, { allowError: true })).data || [];
  const lifecycleEmployee = (await request(`/rest/v1/app_users?id=eq.${u.saleD.appUserId}&select=active,lifecycle_status`)).data[0];
  record(
    "employee lifecycle race leaves no invalid DRAFT assignment",
    (lifecycleAssignment.length === 1 && lifecycleEmployee.active === true && lifecycleEmployee.lifecycle_status === "active")
      || (lifecycleAssignment.length === 0 && lifecycleEmployee.active === false && lifecycleEmployee.lifecycle_status === "inactive")
  );
  console.log("KPI-1 staging employee lifecycle race: PASS");

  const anon = await request("/rest/v1/rpc/crm_kpi_create_period", {
    method: "POST", token: anonKey, key: anonKey,
    body: { p_period_month: "2096-10-01", p_name: "Anonymous", p_timezone: "Asia/Ho_Chi_Minh" },
    allowError: true
  });
  record("anonymous KPI RPC is blocked", !anon.ok);

  const audit = (await selectRows(u.manager, "audit_logs", `entity_id=eq.${period.id}&select=action`)).data;
  record("period lifecycle actions are audited", audit.some(row => row.action === "period_create") && audit.some(row => row.action === "period_activate") && audit.some(row => row.action === "period_close_attempt"));

  console.log(`KPI-1 staging API: PASS (${checks.length} checks)`);
  checks.forEach((item, index) => console.log(`${index + 1}. ${item}`));
} finally {
  await cleanup();
}

const residualProfiles = await request(`/rest/v1/app_users?id=like.kpi1-api-${runId}-*&select=id`);
const residualPeriods = await request(`/rest/v1/kpi_periods?name=like.KPI1 API ${runId}*&select=id`);
const residualDefinitions = await request(`/rest/v1/kpi_definitions?code=like.KPI1*${runId.toUpperCase()}*&select=id`);
if (residualProfiles.data.length || residualPeriods.data.length || residualDefinitions.data.length) {
  throw new Error("KPI-1 staging fixture cleanup failed.");
}
console.log("KPI-1 staging fixture cleanup: PASS (0 residual profiles/periods/definitions)");
