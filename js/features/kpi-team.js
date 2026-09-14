const text = value => value == null ? "" : String(value).trim();
const html = value => text(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const eventTime = value => {
  if (!value) return "Chưa có thông tin";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Chưa có thông tin" : date.toLocaleString("vi-VN");
};

const eventNumber = value => Number(value || 0).toLocaleString("vi-VN", {maximumFractionDigits:2});

const managerStatus = status => {
  const value = text(status).toUpperCase();
  if (value === "APPROVED") return {label:"Đã duyệt", className:"green"};
  if (value === "REJECTED") return {label:"Từ chối", className:"red"};
  if (value === "NEEDS_REVISION") return {label:"Cần sửa", className:"red"};
  return {label:"Chờ duyệt", className:"orange"};
};

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

export function getKpiEventCustomerSnapshot(event = {}) {
  const customerId = text(event.customerId ?? event.customer_id);
  const name = text(event.customerNameSnapshot ?? event.customer_name_snapshot);
  const companyName = text(event.customerCompanyNameSnapshot ?? event.customer_company_name_snapshot);
  const phoneRaw = text(event.customerPhoneSnapshot ?? event.customer_phone_snapshot);
  const phoneNormalized = text(event.customerPhoneNormalizedSnapshot ?? event.customer_phone_normalized_snapshot);
  const address = text(event.customerAddressSnapshot ?? event.customer_address_snapshot);
  return {
    linked: !!(customerId || name || companyName || phoneRaw || phoneNormalized || address),
    customerId,
    name,
    companyName,
    phone: phoneRaw || phoneNormalized,
    address
  };
}

export function managerKpiEventViewModel({event = {}, assignment = {}, saleName = "", evidenceCount = 0, duplicateCount = 0} = {}) {
  const snapshot = event.eventSnapshot ?? event.event_snapshot ?? {};
  const definition = definitionSnapshot(assignment);
  return {
    eventId: text(event.eventId ?? event.id),
    submissionId: text(event.submissionId ?? event.submission_id),
    assignmentId: text(event.assignmentId ?? event.assignment_id),
    saleUserId: text(event.saleUserId ?? event.actor_user_id),
    saleName: text(saleName || kpiValue(assignment, "employeeName", "employee_name") || event.actor_user_id || "Nhân viên"),
    kpiCode: text(definition.code),
    kpiName: text(definition.name || "KPI"),
    eventTitle: text(snapshot.title || snapshot.description || event.sourceType || event.source_type || "Đề xuất KPI"),
    eventContent: text(snapshot.description || snapshot.title),
    eventAt: event.eventAt ?? event.event_at ?? null,
    createdAt: event.createdAt ?? event.created_at ?? null,
    claimedValue: Number(event.claimedValue ?? event.claimed_value ?? 0),
    approvedValue: event.approvedValue ?? event.approved_value ?? null,
    status: text(event.status || "PENDING").toUpperCase(),
    customer: getKpiEventCustomerSnapshot(event),
    evidenceCount: Number(evidenceCount || 0),
    location: event.locationSnapshot ?? event.location_snapshot ?? null,
    saleNote: text(event.saleNote ?? event.sale_note),
    reviewReason: text(event.reviewReasonCode ?? event.review_reason_code),
    managerNote: text(event.managerNote ?? event.manager_note),
    reviewedAt: event.reviewedAt ?? event.reviewed_at ?? null,
    lockVersion: Number(event.lockVersion ?? event.lock_version ?? 0),
    possibleDuplicate: !!(event.possibleDuplicate ?? event.possible_duplicate),
    duplicateCount: Number(duplicateCount || 0),
    revisionNo: Number(event.revisionNo ?? event.revision_no ?? 1),
    supersedesEventId: text(event.supersedesEventId ?? event.supersedes_event_id)
  };
}

export function managerKpiCustomerSnapshotHtml(viewModel, {showCurrentCustomerAction = true} = {}) {
  const customer = viewModel?.customer;
  if (!customer?.linked) return "";
  const fallback = "Chưa có thông tin";
  const value = item => html(item || fallback);
  return `<section class="kpi-manager-customer" aria-label="Khách hàng liên quan"><div class="kpi-manager-customer-head"><div><b>Khách hàng liên quan</b><span>Thông tin tại thời điểm Event</span></div>${showCurrentCustomerAction && customer.customerId ? `<button class="small" type="button" data-kpi-current-customer="${html(customer.customerId)}">Xem hồ sơ khách hàng hiện tại</button>` : ""}</div><dl><div><dt>Công ty</dt><dd>${value(customer.companyName)}</dd></div><div><dt>Khách hàng</dt><dd>${value(customer.name)}</dd></div><div><dt>Số điện thoại</dt><dd>${value(customer.phone)}</dd></div><div><dt>Địa chỉ</dt><dd>${value(customer.address)}</dd></div></dl></section>`;
}

export function managerKpiEventCardHtml(viewModel, {selectable = false, focused = false, openAction = false, customerAction = true} = {}) {
  const view = viewModel || managerKpiEventViewModel();
  const status = managerStatus(view.status);
  const showContent = view.eventContent && view.eventContent !== view.eventTitle;
  const review = [view.reviewReason ? `Lý do: ${view.reviewReason}` : "", view.managerNote ? `Ghi chú Manager: ${view.managerNote}` : ""].filter(Boolean);
  return `<article class="kpi-team-event-card ${focused ? "is-focused" : ""}" data-kpi-manager-event="${html(view.eventId)}"><div class="kpi-team-event-head"><div>${selectable ? `<input type="checkbox" data-kpi2-review-event="${html(view.eventId)}" data-version="${html(view.lockVersion)}" aria-label="Chọn đề xuất ${html(view.eventTitle)}">` : ""}<b>${html(view.saleName || "Nhân viên")}</b><span>${html(view.kpiName || "KPI")}${view.kpiCode ? ` · ${html(view.kpiCode)}` : ""}</span></div><span class="pill ${status.className}">${html(status.label)}</span></div>${managerKpiCustomerSnapshotHtml(view,{showCurrentCustomerAction:customerAction})}<div class="kpi-team-event-body"><b>${html(view.eventTitle)}</b>${showContent ? `<span>${html(view.eventContent)}</span>` : ""}<div class="kpi-manager-event-meta"><div><span>Giá trị đề xuất</span><b>${html(eventNumber(view.claimedValue))}</b></div>${view.approvedValue != null ? `<div><span>Giá trị duyệt</span><b>${html(eventNumber(view.approvedValue))}</b></div>` : ""}<div><span>Thời gian thực hiện</span><b>${html(eventTime(view.eventAt))}</b></div><div><span>Thời gian gửi</span><b>${html(eventTime(view.createdAt))}</b></div></div><span>${html(view.evidenceCount)} ảnh minh chứng${view.location ? " · Có vị trí" : ""}${view.revisionNo > 1 ? ` · Bản bổ sung ${html(view.revisionNo)}` : ""}</span>${view.saleNote ? `<div class="detail-note">Ghi chú Sale: ${html(view.saleNote)}</div>` : ""}${view.possibleDuplicate ? `<span class="pill orange">Có thể trùng${view.duplicateCount ? ` · ${html(view.duplicateCount)} kết quả` : ""}</span>` : ""}${review.length || view.reviewedAt ? `<div class="kpi-manager-review-history">${review.map(item => `<span>${html(item)}</span>`).join("")}${view.reviewedAt ? `<span>Review lúc: ${html(eventTime(view.reviewedAt))}</span>` : ""}</div>` : ""}</div><div class="actions">${view.evidenceCount ? `<button class="small" type="button" data-kpi2-view-evidence="${html(view.eventId)}">Xem ${html(view.evidenceCount)} ảnh</button>` : ""}${openAction ? `<button class="small primary" type="button" data-kpi-team-open-event="${html(view.eventId)}" data-employee-id="${html(view.saleUserId)}">Mở đề xuất</button>` : ""}</div></article>`;
}
