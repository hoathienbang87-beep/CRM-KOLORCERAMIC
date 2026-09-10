import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let writes = 0;
const stored = {data:{statuses:["Mới"], unknownData:"keep-data"}, raw_data:{careDueDays:3, unknownRaw:"keep-raw"}, updated_at:"baseline"};
const load = row => ({...(row.data || {}), ...(row.raw_data || {})});
const navigateWithoutSave = row => load(row);
const before = structuredClone(stored);
assert.deepEqual(navigateWithoutSave(stored), {statuses:["Mới"], unknownData:"keep-data", careDueDays:3, unknownRaw:"keep-raw"});
assert.equal(writes, 0);
assert.deepEqual(stored, before);

function explicitSave(patch) {
  const merged = {...stored.data, ...stored.raw_data, ...patch};
  stored.data = merged;
  stored.raw_data = merged;
  stored.updated_at = "changed";
  writes += 1;
  return load(stored);
}
const saved = explicitSave({careDueDays:5});
assert.equal(writes, 1);
assert.equal(saved.careDueDays, 5);
assert.equal(saved.unknownData, "keep-data");
assert.equal(saved.unknownRaw, "keep-raw");
assert.deepEqual(stored.data, stored.raw_data);

const root = new URL("../", import.meta.url);
const app = await readFile(new URL("js/features/crm-app.js", root), "utf8");
const adapter = await readFile(new URL("js/firebase.js", root), "utf8");
assert.match(app, /if \(!Object\.keys\(patch\)\.length\) return/);
assert.doesNotMatch(app, /renderAdminShell\([\s\S]{0,300}save(Company)?Settings/i);
assert.match(adapter, /const merged = \{ \.\.\.oldData, \.\.\.oldRaw/);
console.log("PASS CRM-UI-R1 STEP7 settings fixture: no-op không ghi, explicit save giữ unknown keys");
