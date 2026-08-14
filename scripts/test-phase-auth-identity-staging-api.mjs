import fs from "node:fs";
import crypto from "node:crypto";

const mode = process.argv[2];
const manifestPath = process.env.IDENTITY_TEST_MANIFEST;
const base = (process.env.STAGING_SUPABASE_URL || "").replace(/\/$/, "");
const anon = process.env.STAGING_ANON_KEY || "";
const service = process.env.STAGING_SERVICE_ROLE_KEY || "";
const password = process.env.IDENTITY_TEST_PASSWORD || "";

if (!mode || !manifestPath || !base || !anon || !service || !password) {
  throw new Error("Missing identity staging harness configuration.");
}

async function request(route, { method = "GET", token = service, key = service, body, allowError = false } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok && !allowError) throw new Error(`${method} ${route} -> ${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return { ok: response.ok, status: response.status, data };
}

function uuid() { return crypto.randomUUID(); }
function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION_FAILED: ${message}`);
  console.log(`PASS: ${message}`);
}
function errorText(result) { return JSON.stringify(result.data || ""); }
async function login(email) {
  const result = await request("/auth/v1/token?grant_type=password", { method: "POST", token: anon, key: anon, body: { email, password } });
  return result.data.access_token;
}
async function rpc(name, token, body, allowError = false) {
  return request(`/rest/v1/rpc/${name}`, { method: "POST", token, key: anon, body, allowError });
}
async function expectDenied(promise, label, pattern) {
  const result = await promise;
  assert(!result.ok, `${label} is rejected.`);
  if (pattern) assert(pattern.test(errorText(result)), `${label} returns the expected guarded error.`);
  return result;
}

const userSpecs = [
  ["owner", "owner", true, "active", "mapped"],
  ["manager", "manager", true, "active", "mapped"],
  ["saleA", "sale", true, "active", "mapped"],
  ["saleLink", "sale", true, "active", "null"],
  ["saleConcurrent", "sale", true, "active", "null"],
  ["saleBadAuth", "sale", true, "active", "null"],
  ["saleOccupied", "sale", true, "active", "mapped"],
  ["saleOccupiedTarget", "sale", true, "active", "null"],
  ["inactiveSale", "sale", false, "inactive", "null"],
  ["archivedSale", "sale", false, "archived", "null"],
  ["staleAdmin", "admin", true, "active", "stale"],
  ["validAdmin", "admin", true, "active", "mapped"],
];

async function bootstrap() {
  const run = `identity-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const users = {};
  try {
    for (const [key, role, active, lifecycle, mapping] of userSpecs) {
      const email = `${run}-${key.toLowerCase()}@example.test`;
      const auth = await request("/auth/v1/admin/users", { method: "POST", body: { email, password, email_confirm: true } });
      const authId = auth.data.id;
      await login(email); // establishes recent successful sign-in evidence
      const appId = `${run}-${key}`;
      const staleAuthId = mapping === "stale" ? uuid() : null;
      const supabaseAuthId = mapping === "mapped" ? authId : staleAuthId;
      await request("/rest/v1/app_users", {
        method: "POST",
        body: {
          id: appId, supabase_auth_id: supabaseAuthId, email,
          name: `Identity ${key}`, role, active, lifecycle_status: lifecycle,
          team: "identity-staging", raw_data: { testRun: run, purpose: "identity-linking-staging" },
        },
      });
      users[key] = { key, appId, authId, email, role, active, lifecycle, initialMapping: supabaseAuthId };
    }
    const manifest = { run, projectRef: process.env.STAGING_PROJECT_REF, users };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { encoding: "utf8", mode: 0o600 });
    console.log(`BOOTSTRAP_PASS ${run}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

async function runTests() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const u = manifest.users;
  const tokens = {
    owner: await login(u.owner.email),
    manager: await login(u.manager.email),
    saleA: await login(u.saleA.email),
  };
  const fixtureIds = Object.values(u).map((item) => item.appId);
  const select = encodeURIComponent(fixtureIds.map((id) => `"${id}"`).join(","));
  const before = await request(`/rest/v1/app_users?id=in.(${select})&select=id,role,active,lifecycle_status,team,email,supabase_auth_id`);
  const providerBefore = {};
  for (const item of Object.values(u)) {
    const auth = await request(`/auth/v1/admin/users/${item.authId}`);
    providerBefore[item.authId] = (auth.data.identities || []).map((identity) => identity.provider).sort();
  }

  const linkBody = (target, authId, requestId, reason = `Staging identity link ${manifest.run}`) => ({
    p_app_user_id: target.appId,
    p_auth_user_id: authId,
    p_expected_current_auth_id: target.initialMapping,
    p_reason: reason,
    p_request_id: requestId,
  });
  const relinkBody = (target, authId, requestId, reason = `Staging privileged relink ${manifest.run}`) => ({
    p_app_user_id: target.appId,
    p_auth_user_id: authId,
    p_expected_current_auth_id: target.initialMapping,
    p_reason: reason,
    p_request_id: requestId,
  });

  await expectDenied(rpc("crm_link_employee_auth_identity", anon, linkBody(u.saleLink, u.saleLink.authId, uuid()), true), "Anonymous LINK", /forbidden|canonical|permission denied|authenticated/i);
  await expectDenied(rpc("crm_link_employee_auth_identity", tokens.saleA, linkBody(u.saleLink, u.saleLink.authId, uuid()), true), "Sale linking another Sale", /forbidden|owner\/admin/i);
  await expectDenied(rpc("crm_link_employee_auth_identity", tokens.saleA, linkBody(u.saleA, u.saleA.authId, uuid()), true), "Sale self-link", /forbidden|owner\/admin/i);
  await expectDenied(rpc("crm_relink_employee_auth_identity", tokens.manager, relinkBody(u.staleAdmin, u.staleAdmin.authId, uuid()), true), "Manager relinking Admin", /forbidden|owner/i);
  await expectDenied(rpc("crm_link_employee_auth_identity", tokens.owner, linkBody(u.inactiveSale, u.inactiveSale.authId, uuid()), true), "Inactive employee LINK", /NOT_ELIGIBLE|not eligible/i);
  await expectDenied(rpc("crm_link_employee_auth_identity", tokens.owner, linkBody(u.archivedSale, u.archivedSale.authId, uuid()), true), "Archived employee LINK", /NOT_ELIGIBLE|not eligible/i);
  await expectDenied(rpc("crm_link_employee_auth_identity", tokens.owner, linkBody(u.saleBadAuth, uuid(), uuid()), true), "Nonexistent Auth LINK", /NOT_USABLE|not usable/i);
  await expectDenied(rpc("crm_link_employee_auth_identity", tokens.owner, linkBody(u.saleOccupiedTarget, u.saleOccupied.authId, uuid()), true), "Occupied Auth LINK", /ALREADY_MAPPED|already mapped/i);

  const linkRequest = uuid();
  const linked = await rpc("crm_link_employee_auth_identity", tokens.owner, linkBody(u.saleLink, u.saleLink.authId, linkRequest));
  assert(linked.data?.newAuthId === u.saleLink.authId && linked.data?.replayed === false, "Owner links an eligible Sale through the canonical RPC.");
  const replay = await rpc("crm_link_employee_auth_identity", tokens.owner, linkBody(u.saleLink, u.saleLink.authId, linkRequest));
  assert(replay.data?.replayed === true, "Same request and payload replays without another mutation.");
  await expectDenied(rpc("crm_link_employee_auth_identity", tokens.owner, linkBody(u.saleLink, u.saleLink.authId, linkRequest, "Changed payload"), true), "Same LINK request with different payload", /PAYLOAD_CONFLICT|payload conflict/i);
  await expectDenied(rpc("crm_link_employee_auth_identity", tokens.owner, { ...linkBody(u.saleLink, u.saleLink.authId, uuid()), p_expected_current_auth_id: null }, true), "Duplicate LINK");

  const directUpdate = await request(`/rest/v1/app_users?id=eq.${encodeURIComponent(u.saleLink.appId)}`, {
    method: "PATCH", token: tokens.owner, key: anon, body: { supabase_auth_id: uuid() }, allowError: true,
  });
  assert(!directUpdate.ok, "Direct Auth mapping update is blocked outside the RPC.");

  const concurrentRequestA = uuid();
  const concurrentRequestB = uuid();
  const concurrentResults = await Promise.all([
    rpc("crm_link_employee_auth_identity", tokens.owner, linkBody(u.saleConcurrent, u.saleConcurrent.authId, concurrentRequestA), true),
    rpc("crm_link_employee_auth_identity", tokens.owner, linkBody(u.saleConcurrent, u.saleConcurrent.authId, concurrentRequestB), true),
  ]);
  assert(concurrentResults.filter((item) => item.ok).length === 1 && concurrentResults.filter((item) => !item.ok).length === 1, "Concurrent LINK attempts produce exactly one winner.");

  await expectDenied(rpc("crm_relink_employee_auth_identity", tokens.owner, { ...relinkBody(u.staleAdmin, u.staleAdmin.authId, uuid()), p_reason: "" }, true), "RELINK with empty reason");
  await expectDenied(rpc("crm_relink_employee_auth_identity", tokens.owner, relinkBody(u.validAdmin, u.saleBadAuth.authId, uuid()), true), "RELINK over a valid existing mapping");

  const relinkRequest = uuid();
  const relinked = await rpc("crm_relink_employee_auth_identity", tokens.owner, relinkBody(u.staleAdmin, u.staleAdmin.authId, relinkRequest));
  assert(relinked.data?.previousAuthId === u.staleAdmin.initialMapping && relinked.data?.newAuthId === u.staleAdmin.authId, "Owner relinks a stale Admin mapping through the privileged RPC.");
  const relinkReplay = await rpc("crm_relink_employee_auth_identity", tokens.owner, relinkBody(u.staleAdmin, u.staleAdmin.authId, relinkRequest));
  assert(relinkReplay.data?.replayed === true, "RELINK request replay is idempotent.");
  await expectDenied(rpc("crm_relink_employee_auth_identity", tokens.owner, relinkBody(u.staleAdmin, u.staleAdmin.authId, relinkRequest, "Changed relink payload"), true), "Same RELINK request with different payload", /PAYLOAD_CONFLICT|payload conflict/i);
  await expectDenied(rpc("crm_relink_employee_auth_identity", tokens.owner, relinkBody(u.staleAdmin, u.staleAdmin.authId, uuid()), true), "RELINK with stale expected mapping");

  const saleLinkToken = await login(u.saleLink.email);
  const saleResolved = await rpc("crm_current_app_user_id", saleLinkToken, {});
  assert(saleResolved.data === u.saleLink.appId, "Linked Sale login resolves to the correct business identity.");
  const adminToken = await login(u.staleAdmin.email);
  const adminResolved = await rpc("crm_current_app_user_id", adminToken, {});
  assert(adminResolved.data === u.staleAdmin.appId, "Relinked Admin login resolves to the correct business identity.");

  const after = await request(`/rest/v1/app_users?id=in.(${select})&select=id,role,active,lifecycle_status,team,email,supabase_auth_id`);
  const beforeById = new Map(before.data.map((row) => [row.id, row]));
  for (const row of after.data) {
    const old = beforeById.get(row.id);
    assert(old.role === row.role && old.active === row.active && old.lifecycle_status === row.lifecycle_status && old.team === row.team && old.email === row.email, `Role/lifecycle/profile remains unchanged for ${row.id}.`);
  }
  const mapped = after.data.map((row) => row.supabase_auth_id).filter(Boolean);
  assert(new Set(mapped).size === mapped.length, "No Auth UUID is mapped to more than one app user.");

  for (const item of Object.values(u)) {
    const auth = await request(`/auth/v1/admin/users/${item.authId}`);
    const providers = (auth.data.identities || []).map((identity) => identity.provider).sort();
    assert(JSON.stringify(providers) === JSON.stringify(providerBefore[item.authId]), `Auth provider identities remain intact for ${item.key}.`);
  }
  console.log(`IDENTITY_STAGING_API_PASS ${manifest.run}`);
}

async function cleanup() {
  if (!fs.existsSync(manifestPath)) return;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const item of Object.values(manifest.users).reverse()) {
    await request(`/rest/v1/app_users?id=eq.${encodeURIComponent(item.appId)}`, { method: "DELETE", allowError: true });
  }
  for (const item of Object.values(manifest.users).reverse()) {
    await request(`/auth/v1/admin/users/${item.authId}`, { method: "DELETE", allowError: true });
  }
  console.log(`CLEANUP_API_DONE ${manifest.run}`);
}

if (mode === "bootstrap") await bootstrap();
else if (mode === "test") await runTests();
else if (mode === "cleanup") await cleanup();
else throw new Error(`Unknown mode: ${mode}`);
