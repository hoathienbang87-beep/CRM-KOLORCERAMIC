import assert from "node:assert/strict";
import {
  buildKpiEmployeeSummaries,
  eligibleKpiEmployees,
  eventsForEmployee,
  filterKpiEmployeeSummaries,
  filterKpiEvents
} from "../js/features/kpi-team.js";

const users = [
  {uid:"sale-a", name:"Sale A", email:"a@example.com", role:"sale", active:true, lifecycleStatus:"active"},
  {uid:"sale-b", name:"Sale B", email:"b@example.com", role:"sale", active:true, lifecycleStatus:"active"},
  {uid:"sale-c", name:"Sale C", email:"c@example.com", role:"sale", active:false, lifecycleStatus:"active"},
  {uid:"manager", name:"Manager", role:"manager", active:true, lifecycleStatus:"active"}
];
assert.deepEqual(eligibleKpiEmployees(users).map(row => row.uid), ["sale-a", "sale-b"]);

const progress = [
  {assignment_id:"a-1", employee_id:"sale-a", target:10, approved_actual:12, actual_completion_pct:120, scoring_completion_pct:100, score_enabled:true, pending_count:1, needs_revision_count:0, rejected_count:1},
  {assignment_id:"a-2", employee_id:"sale-a", target:5, approved_actual:2, actual_completion_pct:40, scoring_completion_pct:40, score_enabled:false, pending_count:0, needs_revision_count:1, rejected_count:0}
];
const scores = [{employee_id:"sale-a", included_kpi_count:1, monthly_score:100, has_open_items:true}];
const summaries = buildKpiEmployeeSummaries({employees:eligibleKpiEmployees(users), progress, monthlyScores:scores, periodStatus:"ACTIVE"});
assert.equal(summaries.length, 2, "Employee không có assignment vẫn phải xuất hiện");
assert.equal(summaries[0].monthlyScore, 100, "Tổng điểm phải dùng kết quả monthly score RPC");
assert.equal(summaries[0].assignedCount, 2);
assert.equal(summaries[0].scoredCount, 1);
assert.equal(summaries[0].referenceCount, 1);
assert.equal(summaries[0].pendingCount, 1);
assert.equal(summaries[0].revisionCount, 1);
assert.equal(summaries[1].assignedCount, 0);
assert.equal(summaries[1].hasScore, false);
assert.deepEqual(filterKpiEmployeeSummaries(summaries, {pendingOnly:true}).map(row => row.id), ["sale-a"]);
assert.deepEqual(filterKpiEmployeeSummaries(summaries, {progressFilter:"unassigned"}).map(row => row.id), ["sale-b"]);

const draft = buildKpiEmployeeSummaries({
  employees:eligibleKpiEmployees(users),
  draftAssignments:[{id:"draft-1", employeeId:"sale-b", assignmentStatus:"ASSIGNED", scoreEnabled:false}],
  periodStatus:"DRAFT"
});
assert.equal(draft.find(row => row.id === "sale-b").assignedCount, 1);
assert.equal(draft.find(row => row.id === "sale-b").monthlyScore, null);
assert.equal(draft.find(row => row.id === "sale-b").referenceCount, 1);

const events = [
  {id:"event-a", assignment_id:"a-1", status:"PENDING"},
  {id:"event-b", assignment_id:"b-1", status:"APPROVED"},
  {id:"event-a-revision", assignment_id:"a-2", status:"NEEDS_REVISION"}
];
const saleAEvents = eventsForEmployee(events, progress);
assert.deepEqual(saleAEvents.map(row => row.id), ["event-a", "event-a-revision"]);
assert.deepEqual(filterKpiEvents(saleAEvents, "pending").map(row => row.id), ["event-a"]);
assert.deepEqual(filterKpiEvents(saleAEvents, "revision").map(row => row.id), ["event-a-revision"]);

const source = await import("node:fs").then(fs => fs.readFileSync(new URL("../js/features/crm-app.js", import.meta.url), "utf8"));
assert.match(source, /crm_kpi_get_monthly_scores/, "Runtime phải dùng monthly score RPC");
assert.doesNotMatch(source, /crm_kpi_get_team_employee_summary/, "Không được thêm read-model ngoài scope");

console.log("KPI-2.1B selector/static contract: PASS (25 checks)");
