import crypto from "node:crypto";
import process from "node:process";

const expectedRef = "ykhtpvyelpujykheycsv";
const productionRef = "jjeeazwlqcwynzquimeo";
const projectRef = process.env.STAGING_PROJECT_REF || "";
const baseUrl = (process.env.STAGING_SUPABASE_URL || "").replace(/\/$/, "");
const anonKey = process.env.STAGING_ANON_KEY || "";
const serviceKey = process.env.STAGING_SERVICE_ROLE_KEY || "";

if (projectRef !== expectedRef || baseUrl !== `https://${expectedRef}.supabase.co`) throw new Error("Refusing to run: staging project guard failed.");
if (projectRef === productionRef || baseUrl.includes(productionRef)) throw new Error("Refusing to run against production.");
if (!anonKey || !serviceKey) throw new Error("Missing ephemeral staging API credentials.");

const runId = crypto.randomBytes(5).toString("hex");
const password = `${crypto.randomBytes(18).toString("base64url")}aA1!`;
const customerId = `p0b-api-customer-${runId}`;
const bulkCustomerId = `p0b-api-bulk-${runId}`;
const phone = `08${crypto.randomInt(10000000, 99999999)}`;
const users = [
  {key:"admin", role:"admin"},
  {key:"manager", role:"manager"},
  {key:"saleA", role:"sale"},
  {key:"saleB", role:"sale"},
  {key:"saleC", role:"sale"}
].map(item => ({...item, email:`p0b-${runId}-${item.key.toLowerCase()}@example.com`}));

const createdAuthIds = [];
const checks = [];
function record(name, condition) {
  if (!condition) throw new Error(`Check failed: ${name}`);
  checks.push(name);
}

async function request(path, {method="GET", token=serviceKey, key=serviceKey, body, allowError=false}={}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers:{apikey:key, Authorization:`Bearer ${token}`, ...(body !== undefined ? {"Content-Type":"application/json"} : {})},
    body:body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!allowError && !response.ok) throw new Error(`HTTP ${response.status} for ${method} ${path}`);
  return {ok:response.ok, status:response.status, data};
}

async function createAuthUser(user) {
  const authResult = await request("/auth/v1/admin/users", {method:"POST", body:{email:user.email,password,email_confirm:true}});
  user.authId = authResult.data.id;
  user.appUserId = `p0b-api-user-${runId}-${user.key}`;
  createdAuthIds.push(user.authId);
  await request("/rest/v1/app_users", {method:"POST", body:{
    id:user.appUserId, supabase_auth_id:user.authId, email:user.email,
    name:`P0B ${user.key}`, role:user.role, active:true, lifecycle_status:"active",
    raw_data:{testRun:runId}
  }});
  const login = await request("/auth/v1/token?grant_type=password", {method:"POST", token:anonKey, key:anonKey, body:{email:user.email,password}});
  user.token = login.data.access_token;
}

async function cleanupStaleApiFixtures() {
  const filters = [
    ["audit_logs", "actor_user_id=like.p0b-api-user-*"],
    ["audit_logs", "entity_id=like.p0b-api-*"],
    ["customer_assignments", "customer_id=like.p0b-api-*"],
    ["customer_assignments", "employee_id=like.p0b-api-user-*"],
    ["phone_index", "customer_id=like.p0b-api-*"],
    ["customers", "id=like.p0b-api-*"],
    ["app_users", "id=like.p0b-api-user-*"]
  ];
  for (const [table, filter] of filters) {
    await request(`/rest/v1/${table}?${filter}`, {method:"DELETE", allowError:true});
  }
  const authUsers = await request("/auth/v1/admin/users?per_page=1000");
  for (const user of authUsers.data?.users || []) {
    if (/^p0b-.*@example\.com$/i.test(user.email || "")) {
      await request(`/auth/v1/admin/users/${user.id}`, {method:"DELETE", allowError:true});
    }
  }
}

const byKey = () => Object.fromEntries(users.map(user => [user.key,user]));
const rpc = (user,name,body,allowError=false) => request(`/rest/v1/rpc/${name}`, {method:"POST",token:user.token,key:anonKey,body,allowError});
const selectRows = (user,table,query) => request(`/rest/v1/${table}?${query}`, {token:user.token,key:anonKey});

async function cleanup() {
  const customerFilter = `customer_id=in.(${customerId},${bulkCustomerId})`;
  const filters = [
    ["customer_assignments", customerFilter],
    ["phone_index", customerFilter],
    ["audit_logs", `entity_id=in.(${customerId},${bulkCustomerId})`],
    ["audit_logs", `entity_id=in.(${users.map(u=>u.appUserId).filter(Boolean).join(",")})`],
    ["audit_logs", `actor_user_id=in.(${users.map(u=>u.appUserId).filter(Boolean).join(",")})`],
    ["customers", `id=in.(${customerId},${bulkCustomerId})`]
  ];
  for (const [table,filter] of filters) await request(`/rest/v1/${table}?${filter}`, {method:"DELETE",allowError:true});
  for (const user of users) if (user.appUserId) await request(`/rest/v1/app_users?id=eq.${user.appUserId}`, {method:"DELETE",allowError:true});
  for (const authId of createdAuthIds.reverse()) await request(`/auth/v1/admin/users/${authId}`, {method:"DELETE",allowError:true});
}

try {
  await cleanupStaleApiFixtures();
  for (const user of users) await createAuthUser(user);
  const u = byKey();

  await rpc(u.saleA,"crm_create_customer",{p_customer:{
    id:customerId,name:"P0B API Customer",phoneRaw:phone,phoneNormalized:phone,
    channel:"P0B Test",nextCareDate:"2026-08-12"
  }});
  let rows = (await selectRows(u.saleA,"customers",`id=eq.${customerId}&select=id,owner_user_id,created_by_user_id,next_care_date`)).data;
  record("sale A create produces current assignment/cache", rows.length===1 && rows[0].owner_user_id===u.saleA.appUserId && rows[0].created_by_user_id===u.saleA.appUserId);

  const directAssignment = await request("/rest/v1/customer_assignments", {method:"POST",token:u.saleA.token,key:anonKey,body:{customer_id:customerId,employee_id:u.saleB.appUserId,is_current:true},allowError:true});
  record("sale direct assignment insert blocked", !directAssignment.ok);
  const directOwner = await request(`/rest/v1/customers?id=eq.${customerId}`, {method:"PATCH",token:u.saleA.token,key:anonKey,body:{owner_user_id:u.saleB.appUserId},allowError:true});
  record("sale direct owner cache update blocked", !directOwner.ok);

  await rpc(u.manager,"crm_unassign_customer",{p_customer_id:customerId,p_reason:"P0B API unassign"});
  const managerPool = (await selectRows(u.manager,"customers",`id=eq.${customerId}&select=id,owner_user_id,next_care_date`)).data;
  const saleAPool = (await selectRows(u.saleA,"customers",`id=eq.${customerId}&select=id`)).data;
  record("manager sees unassigned and follow-up survives", managerPool.length===1 && managerPool[0].owner_user_id===null && !!managerPool[0].next_care_date);
  record("sale cannot see unassigned customer", saleAPool.length===0);

  const concurrent = await Promise.allSettled([
    rpc(u.manager,"crm_assign_customer",{p_customer_id:customerId,p_employee_id:u.saleB.appUserId,p_reason:"Concurrent B"}),
    rpc(u.admin,"crm_assign_customer",{p_customer_id:customerId,p_employee_id:u.saleC.appUserId,p_reason:"Concurrent C"})
  ]);
  record("concurrent assignment requests complete without partial failure", concurrent.some(item=>item.status==="fulfilled"));
  const currentAssignments = (await selectRows(u.manager,"customer_assignments",`customer_id=eq.${customerId}&is_current=eq.true&select=id,employee_id`)).data;
  record("concurrency leaves exactly one current assignment", currentAssignments.length===1);
  const finalEmployeeId = currentAssignments[0].employee_id;
  const finalOwner = [u.saleB,u.saleC].find(item=>item.appUserId===finalEmployeeId);
  const otherOwner = finalOwner===u.saleB ? u.saleC : u.saleB;
  record("final assigned sale has access", (await selectRows(finalOwner,"customers",`id=eq.${customerId}&select=id`)).data.length===1);
  record("non-current sale has no access", (await selectRows(otherOwner,"customers",`id=eq.${customerId}&select=id`)).data.length===0);
  const assignmentHistory = (await selectRows(u.manager,"customer_assignments",`customer_id=eq.${customerId}&select=employee_id,assigned_at,is_current&order=assigned_at.asc`)).data;
  rows = (await selectRows(u.manager,"customers",`id=eq.${customerId}&select=id,created_by_user_id`)).data;
  record("reassignment preserves original acquisition identity", rows[0]?.created_by_user_id===u.saleA.appUserId && assignmentHistory[0]?.employee_id===u.saleA.appUserId);

  await rpc(u.admin,"crm_deactivate_employee",{
    p_employee_id:finalOwner.appUserId,p_mode:"unassigned",p_replacement_employee_id:null,p_reason:"P0B API leave"
  });
  rows = (await selectRows(u.manager,"customers",`id=eq.${customerId}&select=id,owner_user_id,next_care_date`)).data;
  record("deactivate moves customers to pool and preserves follow-up", rows.length===1 && rows[0].owner_user_id===null && !!rows[0].next_care_date);
  const inactiveSelf = (await selectRows(finalOwner,"app_users",`id=eq.${finalOwner.appUserId}&select=id,active,lifecycle_status`)).data;
  const inactiveCustomers = (await selectRows(finalOwner,"customers",`select=id&limit=1`)).data;
  record("inactive employee loses CRM runtime access", inactiveSelf[0]?.active===false && inactiveSelf[0]?.lifecycle_status==="inactive" && inactiveCustomers.length===0);

  await rpc(u.manager,"crm_create_customer",{p_customer:{id:bulkCustomerId,name:"P0B Bulk Customer"}});
  const bulkResult = await rpc(u.manager,"crm_bulk_assign_customers",{
    p_customer_ids:[bulkCustomerId,`missing-${runId}`],p_employee_id:u.saleA.appUserId,p_reason:"P0B all-or-nothing"
  },true);
  record("bulk assignment reports row failure", !bulkResult.ok);
  const bulkCurrent = (await selectRows(u.manager,"customer_assignments",`customer_id=eq.${bulkCustomerId}&is_current=eq.true&select=id`)).data;
  record("bulk assignment rolls back earlier rows", bulkCurrent.length===0);

  const assignVsDeactivate = await Promise.allSettled([
    rpc(u.manager,"crm_assign_customer",{p_customer_id:bulkCustomerId,p_employee_id:u.saleA.appUserId,p_reason:"P0B assign/deactivate race"}),
    rpc(u.admin,"crm_deactivate_employee",{p_employee_id:u.saleA.appUserId,p_mode:"unassigned",p_replacement_employee_id:null,p_reason:"P0B concurrent leave"})
  ]);
  record("assign/deactivate race completes without hanging", assignVsDeactivate.every(item=>item.status==="fulfilled" || item.status==="rejected"));
  const saleAProfile = (await selectRows(u.manager,"app_users",`id=eq.${u.saleA.appUserId}&select=id,active,lifecycle_status`)).data;
  const saleACurrentAssignments = (await selectRows(u.manager,"customer_assignments",`employee_id=eq.${u.saleA.appUserId}&is_current=eq.true&select=id`)).data;
  record("deactivate race leaves no assignment on inactive employee", saleAProfile[0]?.active===false && saleAProfile[0]?.lifecycle_status==="inactive" && saleACurrentAssignments.length===0);

  const anon = await request("/rest/v1/rpc/crm_assign_customer", {method:"POST",token:anonKey,key:anonKey,body:{p_customer_id:customerId,p_employee_id:u.saleA.appUserId,p_reason:"anon"},allowError:true});
  record("anonymous assignment RPC blocked", !anon.ok);

  console.log(`Phase P0-B staging API: PASS (${checks.length} checks)`);
  checks.forEach((item,index)=>console.log(`${index+1}. ${item}`));
} finally {
  await cleanup();
}

const residualProfiles = await request("/rest/v1/app_users?id=like.p0b-api-user-*&select=id");
const residualCustomers = await request("/rest/v1/customers?id=like.p0b-api-*&select=id");
const residualAuth = await request("/auth/v1/admin/users?per_page=1000");
const residualAuthCount = (residualAuth.data?.users || []).filter(user => /^p0b-.*@example\.com$/i.test(user.email || "")).length;
if (residualProfiles.data.length || residualCustomers.data.length || residualAuthCount) {
  throw new Error("P0-B staging fixture cleanup failed.");
}
console.log("P0-B staging fixture cleanup: PASS (0 residual profiles/customers/auth users)");
