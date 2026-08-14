const text = value => value == null ? "" : String(value).trim();

export function kpiValue(row, camel, snake) {
  return row?.[camel] ?? row?.[snake];
}

export function eligibleKpiEmployees(users = []) {
  return users
    .filter(user => text(user?.role).toLowerCase() === "sale")
    .filter(user => user?.active !== false)
    .filter(user => text(user?.lifecycleStatus ?? user?.lifecycle_status ?? "active").toLowerCase() === "active")
    .sort((a, b) => text(a?.name || a?.email).localeCompare(text(b?.name || b?.email), "vi"));
}

export function employeeId(user) {
  return text(user?.uid || user?.id);
}

export function buildKpiEmployeeSummaries({
  employees = [],
  progress = [],
  monthlyScores = [],
  draftAssignments = [],
  periodStatus = ""
} = {}) {
  const progressByEmployee = new Map();
  progress.forEach(row => {
    const id = text(kpiValue(row, "employeeId", "employee_id"));
    if (!id) return;
    if (!progressByEmployee.has(id)) progressByEmployee.set(id, []);
    progressByEmployee.get(id).push(row);
  });
  const scoreByEmployee = new Map(monthlyScores.map(row => [
    text(kpiValue(row, "employeeId", "employee_id")),
    row
  ]));
  const draftByEmployee = new Map();
  draftAssignments
    .filter(row => text(row?.assignmentStatus || row?.assignment_status || "ASSIGNED").toUpperCase() === "ASSIGNED")
    .forEach(row => {
      const id = text(row?.employeeId || row?.employee_id);
      if (!id) return;
      if (!draftByEmployee.has(id)) draftByEmployee.set(id, []);
      draftByEmployee.get(id).push(row);
    });

  return employees.map(user => {
    const id = employeeId(user);
    const rows = progressByEmployee.get(id) || [];
    const drafts = draftByEmployee.get(id) || [];
    const score = scoreByEmployee.get(id);
    const assignedCount = rows.length || (text(periodStatus).toUpperCase() === "DRAFT" ? drafts.length : 0);
    const scoringRows = rows.length ? rows : drafts;
    const scoredCount = score == null
      ? scoringRows.filter(row => !!kpiValue(row, "scoreEnabled", "score_enabled")).length
      : Number(kpiValue(score, "includedKpiCount", "included_kpi_count") || 0);
    const referenceCount = Math.max(0, assignedCount - scoredCount);
    const pendingCount = rows.reduce((sum, row) => sum + Number(kpiValue(row, "pendingCount", "pending_count") || 0), 0);
    const revisionCount = rows.reduce((sum, row) => sum + Number(kpiValue(row, "needsRevisionCount", "needs_revision_count") || 0), 0);
    const rejectedCount = rows.reduce((sum, row) => sum + Number(kpiValue(row, "rejectedCount", "rejected_count") || 0), 0);
    const monthlyScore = score == null ? null : Number(kpiValue(score, "monthlyScore", "monthly_score") || 0);
    return {
      id,
      user,
      name: text(user?.name || user?.email || "Nhân viên"),
      email: text(user?.email),
      assignedCount,
      scoredCount,
      referenceCount,
      pendingCount,
      revisionCount,
      rejectedCount,
      unresolvedCount: pendingCount + revisionCount,
      monthlyScore,
      hasScore: score != null && scoredCount > 0,
      hasOpenItems: !!kpiValue(score, "hasOpenItems", "has_open_items") || pendingCount + revisionCount > 0,
      progressRows: rows,
      draftAssignments: drafts
    };
  });
}

export function filterKpiEmployeeSummaries(rows = [], {search = "", progressFilter = "all", pendingOnly = false} = {}) {
  const key = text(search).toLocaleLowerCase("vi");
  return rows.filter(row => {
    if (key && !`${row.name} ${row.email}`.toLocaleLowerCase("vi").includes(key)) return false;
    if (pendingOnly && row.pendingCount <= 0) return false;
    if (progressFilter === "unassigned" && row.assignedCount !== 0) return false;
    if (progressFilter === "attention" && row.unresolvedCount <= 0) return false;
    if (progressFilter === "complete" && !(row.hasScore && row.monthlyScore >= 100)) return false;
    if (progressFilter === "in-progress" && !(row.hasScore && row.monthlyScore < 100)) return false;
    return true;
  });
}

export function assignmentEmployeeId(assignment) {
  return text(kpiValue(assignment, "employeeId", "employee_id"));
}

export function assignmentId(row) {
  return text(kpiValue(row, "assignmentId", "assignment_id") || row?.id);
}

export function eventsForEmployee(events = [], assignmentRows = []) {
  const ids = new Set(assignmentRows.map(assignmentId).filter(Boolean));
  return events.filter(event => ids.has(text(event?.assignment_id || event?.assignmentId)));
}

export function eventStatusKey(status) {
  const value = text(status).toUpperCase();
  if (value === "APPROVED") return "approved";
  if (value === "REJECTED") return "rejected";
  if (value === "NEEDS_REVISION") return "revision";
  return "pending";
}

export function filterKpiEvents(events = [], status = "all") {
  return status === "all" ? events : events.filter(event => eventStatusKey(event?.status) === status);
}

export function definitionSnapshot(row) {
  return kpiValue(row, "definitionSnapshot", "definition_snapshot") || {};
}

export function definitionName(row) {
  return text(definitionSnapshot(row)?.name || "KPI");
}

export function assignmentProgressMetrics(row = {}) {
  return {
    target: Number(row?.target || 0),
    actual: Number(kpiValue(row, "approvedActual", "approved_actual") || 0),
    actualPercent: Number(kpiValue(row, "actualCompletionPct", "actual_completion_pct") || 0),
    scoringPercent: Number(kpiValue(row, "scoringCompletionPct", "scoring_completion_pct") || 0),
    scoreEnabled: !!kpiValue(row, "scoreEnabled", "score_enabled"),
    pendingCount: Number(kpiValue(row, "pendingCount", "pending_count") || 0),
    revisionCount: Number(kpiValue(row, "needsRevisionCount", "needs_revision_count") || 0),
    rejectedCount: Number(kpiValue(row, "rejectedCount", "rejected_count") || 0)
  };
}

export function groupEvidenceCount(evidence = []) {
  return evidence.reduce((map, row) => {
    const eventId = text(row?.event_id || row?.eventId);
    if (eventId) map.set(eventId, (map.get(eventId) || 0) + 1);
    return map;
  }, new Map());
}
