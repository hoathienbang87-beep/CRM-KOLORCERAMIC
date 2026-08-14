import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sql = fs.readFileSync(path.join(root, "supabase-phase-auth-identity-linking-repair.sql"), "utf8");
const adapter = fs.readFileSync(path.join(root, "js", "firebase.js"), "utf8");
const currentUserFunction = sql.match(/create or replace function public\.crm_current_app_user_id\(\)[\s\S]*?\$\$;/i)?.[0] || "";
const fetchRefFunction = adapter.match(/async function fetchRef\(ref\)\s*\{[\s\S]*?\n\}/i)?.[0] || "";
let failures = 0;

function check(condition, message) {
  if (condition) console.log(`PASS: ${message}`);
  else {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

check(/create unique index if not exists app_users_supabase_auth_id_unique_idx/i.test(sql), "Auth bridge is unique when non-null.");
check(/crm_current_app_user_id[\s\S]*supabase_auth_id\s*=\s*auth\.uid\(\)/i.test(sql), "Runtime identity resolves by Auth UUID.");
check(!/crm_current_email/i.test(currentUserFunction), "Runtime identity helper does not authorize by email.");
check(/crm_auth_linked_app_user_id[\s\S]*supabase_auth_id\s*=\s*auth\.uid\(\)/i.test(sql), "Inactive self-profile lookup remains UUID-linked.");
check(/app users read self or manager[\s\S]*crm_auth_linked_app_user_id/i.test(sql), "Self-profile read is separate from active CRM authority.");
check(/crm_link_employee_auth_identity[\s\S]*only canonical owner\/admin/i.test(sql), "LINK enforces privileged actor.");
check(/crm_relink_employee_auth_identity[\s\S]*only canonical owner/i.test(sql), "RELINK is owner-only.");
check(/pg_advisory_xact_lock[\s\S]*for update/i.test(sql), "RPC uses advisory and row locks.");
check(/identity_link_requests_idempotency_unique/i.test(sql), "Idempotency ledger has a unique request contract.");
check(/IDENTITY_REQUEST_PAYLOAD_CONFLICT/i.test(sql), "Request replay rejects payload drift.");
check(/crm\.allow_identity_write/i.test(sql), "Direct mapping updates are guarded.");
check(/app users admin insert[\s\S]*supabase_auth_id is null/i.test(sql), "Admin insert cannot inject an Auth mapping.");
check(/crm_write_audit\('linkEmployeeAuthIdentity'/i.test(sql), "LINK writes mandatory audit in the transaction.");
check(/crm_write_audit\('relinkEmployeeAuthIdentity'/i.test(sql), "RELINK writes mandatory audit in the transaction.");
check(/set search_path = public, auth/i.test(sql), "SECURITY DEFINER identity RPCs pin search_path.");
check(/extensions\.digest/i.test(sql), "Payload hash uses the pinned pgcrypto schema.");
check(/v_identity_count\s*<>\s*v_provider_count/i.test(sql), "Multiple distinct providers on one Auth user are valid; duplicate provider identities are rejected.");
check(/revoke all on public\.identity_link_requests from public, anon, authenticated, service_role/i.test(sql), "Identity ledger is not exposed through the data API.");
check(!/update\s+auth\.users|delete\s+from\s+auth\.users|insert\s+into\s+auth\.users/i.test(sql), "Migration never mutates Auth users.");
check(/ref\.collection\s*===\s*["']users["']\s*\?\s*["']supabase_auth_id["']/i.test(fetchRefFunction), "Frontend resolves the current app user by canonical Auth UUID.");
check(!/auth\.getUser|\.eq\(["']email["']/i.test(fetchRefFunction), "Frontend app-user lookup has no email fallback.");
check(!/service_role_key|sb_secret_/i.test(sql), "Migration contains no privileged frontend secret.");

if (failures) {
  console.error(`Identity static gate failed: ${failures} check(s).`);
  process.exit(1);
}
console.log("Identity static gate passed.");
