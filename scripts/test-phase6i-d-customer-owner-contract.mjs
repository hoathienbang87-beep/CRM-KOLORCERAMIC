import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../js/features/crm-app.js", import.meta.url), "utf8");
const sql = fs.readFileSync(new URL("../supabase-phase-p0b-employee-assignment.sql", import.meta.url), "utf8");
const firebase = fs.readFileSync(new URL("../js/firebase.js", import.meta.url), "utf8");

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Missing ${start} ... ${end}`);
  return source.slice(startIndex, endIndex);
}

const createUi = between(app, "async function saveCustomer()", "async function saveCareLog()");
const createRpc = between(sql.toLowerCase(), "create or replace function public.crm_create_customer", "-- 8. rpc exposure");

assert.match(app, /const CUSTOMER_OWNER_UNASSIGNED_VALUE\s*=\s*"__UNASSIGNED__"/);
assert.match(app, /const customerOwnerIntent\s*=\s*\{kind:"unset", value:"", explicit:false, unavailable:false\}/);
assert.match(app, /function hydrateCustomerOwnerSelect\([\s\S]*customerOwnerIntent\.unavailable = true/);
assert.match(app, /on\("owner", "change", event => setCustomerOwnerIntent\(event\.target\.value, true\)\)/);
assert.match(app, /function customerOwnerSelectionForSubmit\([\s\S]*Nhân viên phụ trách đã chọn không còn khả dụng/);
assert.match(app, /function normalizeCustomerCreateResult\([\s\S]*ownerUserId[\s\S]*ownerEmail/);
assert.match(createUi, /interestProductFields\(\$\("need"\)\)/, "Product snapshot fields must remain in Customer create payload.");
assert.match(createUi, /normalizeCustomerCreateResult\(await callCrmRpc\("crm_create_customer"/);
assert.match(createUi, /result\.assigned !== true \|\| !emailMatches \|\| !idMatches/);
assert.match(createUi, /result\.assigned !== false \|\| result\.ownerEmail \|\| result\.ownerUserId/);
assert.match(createUi, /setCustomerCreatePartialState\(result, ownerSelection\.intendedEmail\)/);
assert.match(createUi, /Đã lưu khách mới và phân công cho nhân viên/);
assert.match(createUi, /Đã lưu khách mới vào hàng chờ phân bổ/);
assert.doesNotMatch(createUi, /crm_assign_customer|crm_transfer_customer/, "Create fix must not add a second assignment write.");
assert.match(app, /if \(!isManager\(\)\)[\s\S]*profile:\{id:clean\(appUser\?\.id \|\| appUser\?\.uid\), name, email\}/, "Sale self-create must keep implicit owner identity.");

assert.match(createRpc, /v_requested_owner_email text := nullif\(trim\(coalesce\(p_customer->>'owneremail', ''\)\), ''\)/);
assert.match(createRpc, /if v_requested_owner_email is not null/);
assert.match(createRpc, /if v_owner\.id is null then[\s\S]*nhân viên phụ trách không hợp lệ hoặc không active/);
assert.match(createRpc, /insert into public\.customers[\s\S]*if v_owner\.id is not null then[\s\S]*insert into public\.customer_assignments/);
assert.match(createRpc, /return jsonb_build_object\('id',[\s\S]*'assigned',[\s\S]*'owneruserid',[\s\S]*'owneremail'/);
assert.match(firebase, /import\s*\{[^}]*readSupabaseBrowserConfig[^}]*\}\s*from\s*["']\.\/shared\/supabase-client\.js["']/);
assert.match(firebase, /export async function signInWithPopup\(\)\s*\{\s*const config = readSupabaseBrowserConfig\(\);/);

console.log("PASS Phase 6I-D static Customer owner state + backend RPC/auth contract (23 checks)");
