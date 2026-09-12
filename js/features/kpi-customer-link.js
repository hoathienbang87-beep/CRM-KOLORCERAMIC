const CUSTOMER_MODES = new Set(["REQUIRED", "OPTIONAL", "NONE"]);
const EMPTY_CUSTOMER_VALUE = "Chưa có thông tin";

const text = value => String(value ?? "").trim();
const html = value => text(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

export function kpiCustomerRelationMode(assignment) {
  const snapshot = assignment?.definitionSnapshot ?? assignment?.definition_snapshot ?? {};
  const mode = text(snapshot.customer_relation_mode ?? snapshot.customerRelationMode).toUpperCase();
  return CUSTOMER_MODES.has(mode) ? mode : "NONE";
}

export function normalizeKpiCustomer(row) {
  if (!row) return null;
  const customer = {
    id: text(row.id ?? row.customerId ?? row.customer_id),
    name: text(row.name ?? row.customerName ?? row.customer_name ?? row.customer_name_snapshot),
    companyName: text(row.companyName ?? row.company_name ?? row.customer_company_snapshot),
    phoneRaw: text(row.phoneRaw ?? row.phone_raw ?? row.phone ?? row.customer_phone_snapshot),
    phoneNormalized: text(row.phoneNormalized ?? row.phone_normalized ?? row.customer_phone_normalized_snapshot),
    address: text(row.address ?? row.customerAddress ?? row.customer_address ?? row.customer_address_snapshot)
  };
  return customer.id ? customer : null;
}

export function eligibleKpiCustomerAssignments(assignments = []) {
  return assignments.filter(assignment => {
    const id = text(assignment?.assignmentId ?? assignment?.assignment_id ?? assignment?.id);
    const periodStatus = text(assignment?.periodStatus ?? assignment?.period_status).toUpperCase();
    return !!id && periodStatus === "ACTIVE" && kpiCustomerRelationMode(assignment) !== "NONE";
  });
}

export function createKpiEventFormState() {
  return {
    entryPoint: "kpi",
    assignment: null,
    assignmentOptions: [],
    customer: null,
    customerRelationMode: "NONE",
    customerLocked: false,
    revision: false,
    eventContent: "",
    eventTime: "",
    claimedValue: 1,
    evidence: [],
    location: null,
    note: "",
    submitting: false,
    errors: {},
    search: {query: "", rows: [], loading: false, error: "", requestId: 0}
  };
}

export function resetKpiEventFormState(state) {
  Object.assign(state, createKpiEventFormState());
  return state;
}

export function setKpiEventAssignment(state, assignment, {preserveCustomer = true} = {}) {
  state.assignment = assignment || null;
  state.customerRelationMode = assignment ? kpiCustomerRelationMode(assignment) : "NONE";
  state.errors = {};
  if (!preserveCustomer || state.customerRelationMode === "NONE") state.customer = null;
  return state;
}

export function setKpiEventCustomer(state, customer) {
  state.customer = normalizeKpiCustomer(customer);
  state.errors = {};
  return state;
}

export function buildKpiCustomerEventPayload(state, sourceEvents = []) {
  const requestedMode = text(state?.customerRelationMode).toUpperCase();
  const mode = CUSTOMER_MODES.has(requestedMode) ? requestedMode : "NONE";
  const customerId = text(state?.customer?.id);
  if (mode === "REQUIRED" && !customerId) {
    return {ok: false, message: "Vui lòng chọn khách hàng cho KPI này.", events: []};
  }
  const events = sourceEvents.map(source => {
    const event = {...source};
    [
      "customerId", "customer_id", "customerName", "customer_name",
      "companyName", "company_name", "customerCompanyName",
      "phone", "phoneRaw", "phone_raw", "customerPhone",
      "phoneNormalized", "phone_normalized", "customerPhoneNormalized",
      "address", "customerAddress", "customer_address",
      "customerSnapshot", "customer_snapshot"
    ].forEach(key => delete event[key]);
    if (mode !== "NONE" && customerId) event.customerId = customerId;
    return event;
  });
  return {ok: true, message: "", events};
}

export function kpiCustomerSubmitError(error) {
  const code = text(error?.code).toUpperCase();
  const detail = [error?.message, error?.details, error?.hint].map(text).filter(Boolean).join(" ").toLowerCase();
  if (code === "42501" && /customer|khach|khách/.test(detail)) {
    return {kind: "customer-access", message: "Bạn không còn quyền thao tác với khách hàng này. Dữ liệu có thể vừa được phân công lại.", clearCustomer: true};
  }
  if ((code === "55000" || code === "P0002") && /customer|khach|khách/.test(detail)) {
    return {kind: "customer-stale", message: "Khách hàng này hiện không còn ở trạng thái có thể sử dụng cho KPI.", clearCustomer: true};
  }
  if (code === "22023" && /(bat buoc customer|required|bắt buộc.*khách|bat buoc.*khach)/.test(detail)) {
    return {kind: "customer-required", message: "Vui lòng chọn khách hàng cho KPI này.", clearCustomer: false};
  }
  return {kind: "other", message: "", clearCustomer: false};
}

export function createKpiCustomerSearchAdapter(callRpc) {
  return async function searchAccessibleKpiCustomers(query, limit = 20) {
    const rows = await callRpc("crm_kpi_search_accessible_customers", {
      p_query: text(query) || null,
      p_limit: Math.max(1, Math.min(Number(limit) || 20, 50))
    });
    return (rows || []).map(normalizeKpiCustomer).filter(Boolean);
  };
}

function assignmentId(assignment) {
  return text(assignment?.assignmentId ?? assignment?.assignment_id ?? assignment?.id);
}

function assignmentName(assignment) {
  const snapshot = assignment?.definitionSnapshot ?? assignment?.definition_snapshot ?? {};
  return text(snapshot.name) || "KPI";
}

function customerValue(value) {
  return text(value) || EMPTY_CUSTOMER_VALUE;
}

export function kpiCustomerSearchResultsHtml(state) {
  const search = state?.search || {};
  if (search.loading) return '<div class="kpi2-customer-search-state" role="status">Đang tìm khách hàng...</div>';
  if (search.error) return '<div class="kpi2-customer-search-state error" role="alert">Không thể tải danh sách khách hàng. Vui lòng thử lại.</div>';
  if (!text(search.query) && !(search.rows || []).length) return '<div class="kpi2-customer-search-state muted">Tìm theo tên, công ty hoặc số điện thoại.</div>';
  if (!(search.rows || []).length) return '<div class="kpi2-customer-search-state muted">Không tìm thấy khách hàng phù hợp.</div>';
  return search.rows.map(row => {
    const customer = normalizeKpiCustomer(row);
    if (!customer) return "";
    const meta = [customer.companyName, customer.phoneRaw || customer.phoneNormalized, customer.address].filter(Boolean);
    return `<button class="kpi2-customer-result" type="button" data-kpi2-select-customer="${html(customer.id)}"><b>${html(customer.name || EMPTY_CUSTOMER_VALUE)}</b>${meta.length ? `<span>${html(meta.join(" · "))}</span>` : ""}</button>`;
  }).join("");
}

export function selectedKpiCustomerHtml(state) {
  const customer = normalizeKpiCustomer(state?.customer);
  if (!customer) return "";
  const canChange = !!state.assignment && !state.customerLocked;
  const canUnlink = canChange && state.customerRelationMode === "OPTIONAL";
  return `<div class="kpi2-selected-customer-card"><div class="kpi2-selected-customer-head"><b>Thông tin khách hàng</b><div class="actions">${canChange ? '<button class="small" type="button" data-kpi2-change-customer>Đổi khách hàng</button>' : ""}${canUnlink ? '<button class="small" type="button" data-kpi2-unlink-customer>Bỏ liên kết</button>' : ""}</div></div><dl><div><dt>Công ty</dt><dd>${html(customerValue(customer.companyName))}</dd></div><div><dt>Khách hàng</dt><dd>${html(customerValue(customer.name))}</dd></div><div><dt>Số điện thoại</dt><dd>${html(customerValue(customer.phoneRaw || customer.phoneNormalized))}</dd></div><div><dt>Địa chỉ</dt><dd>${html(customerValue(customer.address))}</dd></div></dl></div>`;
}

export function renderKpiCustomerLinkUi(state, refs) {
  const options = state.assignmentOptions || [];
  const selectedId = assignmentId(state.assignment);
  if (refs.assignmentArea && refs.assignmentSelect && refs.assignmentHint) {
    refs.assignmentArea.classList.toggle("hide", !options.length && !state.assignment);
    const needsChoice = state.entryPoint === "customer" && options.length > 1;
    const rows = options.length ? options : (state.assignment ? [state.assignment] : []);
    refs.assignmentSelect.innerHTML = `${needsChoice ? '<option value="" disabled>Chọn KPI phù hợp</option>' : ""}${rows.map(row => `<option value="${html(assignmentId(row))}">${html(assignmentName(row))} · ${html(kpiCustomerRelationMode(row))}</option>`).join("")}`;
    refs.assignmentSelect.value = selectedId;
    refs.assignmentSelect.disabled = state.submitting || !needsChoice || state.revision;
    refs.assignmentHint.textContent = state.assignment ? `Chế độ khách hàng: ${state.customerRelationMode}` : "Chọn KPI để tiếp tục.";
  }
  const hasAssignment = !!state.assignment;
  const showCustomer = (hasAssignment && state.customerRelationMode !== "NONE") || (state.entryPoint === "customer" && !hasAssignment && !!state.customer);
  refs.eventFields?.classList.toggle("hide", !hasAssignment);
  refs.customerArea?.classList.toggle("hide", !showCustomer);
  if (refs.customerLabel) refs.customerLabel.textContent = !hasAssignment ? "Khách hàng đã chọn" : state.customerRelationMode === "REQUIRED" ? "Khách hàng *" : "Khách hàng (không bắt buộc)";
  if (refs.customerSearchInput) refs.customerSearchInput.disabled = state.submitting;
  if (refs.customerSearchWrap) refs.customerSearchWrap.classList.toggle("hide", !showCustomer || !!state.customer || state.customerLocked);
  if (refs.customerSearchResults) refs.customerSearchResults.innerHTML = showCustomer && !state.customer ? kpiCustomerSearchResultsHtml(state) : "";
  if (refs.selectedCustomer) {
    refs.selectedCustomer.classList.toggle("hide", !showCustomer || !state.customer);
    refs.selectedCustomer.innerHTML = showCustomer ? selectedKpiCustomerHtml(state) : "";
  }
  if (refs.submit) refs.submit.disabled = state.submitting || !hasAssignment || (state.customerRelationMode === "REQUIRED" && !state.customer);
}
