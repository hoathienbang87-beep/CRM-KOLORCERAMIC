import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildKpiCustomerEventPayload,
  customerKpiQuickActionHtml,
  createKpiCustomerSearchAdapter,
  createKpiEventFormState,
  eligibleKpiCustomerAssignments,
  KPI_CUSTOMER_NO_ELIGIBLE_MESSAGE,
  kpiCustomerRelationMode,
  kpiCustomerSubmitError,
  normalizeKpiCustomer,
  resetKpiEventFormState,
  setKpiEventAssignment,
  setKpiEventCustomer
} from "../js/features/kpi-customer-link.js";

let checks = 0;
const check = (condition, message) => { checks += 1; assert.ok(condition, message); };
const assignment = (id, mode, name = id) => ({assignmentId:id, periodStatus:"ACTIVE", definitionSnapshot:{name, customer_relation_mode:mode}});
const required = assignment("required", "REQUIRED", "KPI bắt buộc khách");
const optional = assignment("optional", "OPTIONAL", "KPI tùy chọn khách");
const none = assignment("none", "NONE", "KPI không gắn khách");
const legacy = {assignment_id:"legacy", definition_snapshot:{name:"Legacy"}};
const closed = {assignmentId:"closed",periodStatus:"CLOSED",definitionSnapshot:{name:"Closed",customer_relation_mode:"REQUIRED"}};
const customer = {id:"customer-a", name:"Nguyễn A", company_name:"Công ty A", phone_raw:"0901000000", phone_normalized:"0901000000", address:"Hà Nội"};

const quickAction = customerKpiQuickActionHtml(customer.id, true);
check(quickAction.includes('data-kpi2-customer-entry="customer-a"') && quickAction.includes("Đề xuất KPI"), "Sale Customer row renders the KPI-2 quick action with canonical Customer id");
check(customerKpiQuickActionHtml(customer.id, false) === "", "non-submit roles do not receive a Customer-row KPI action");
check(customerKpiQuickActionHtml('customer-\"unsafe', true).includes("&quot;unsafe"), "Customer row action escapes the Customer id");
check(KPI_CUSTOMER_NO_ELIGIBLE_MESSAGE === "Hiện bạn chưa có KPI phù hợp để đề xuất cho khách hàng này.", "no-eligible state uses the approved business message");

check(kpiCustomerRelationMode(required) === "REQUIRED", "REQUIRED comes from assignment snapshot");
check(kpiCustomerRelationMode(optional) === "OPTIONAL", "OPTIONAL comes from assignment snapshot");
check(kpiCustomerRelationMode(none) === "NONE", "NONE comes from assignment snapshot");
check(kpiCustomerRelationMode(legacy) === "NONE", "legacy assignment safely falls back to NONE");
check(kpiCustomerRelationMode({definition_snapshot:{customer_relation_mode:"BROKEN"}}) === "NONE", "invalid mode safely falls back to NONE");
check(eligibleKpiCustomerAssignments([required, optional, none, legacy, closed]).length === 2, "Customer entry excludes NONE, legacy and non-ACTIVE assignments");

const normalized = normalizeKpiCustomer(customer);
check(normalized.id === "customer-a", "Customer VM keeps id");
check(normalized.companyName === "Công ty A", "Customer VM normalizes company");
check(normalized.phoneRaw === "0901000000", "Customer VM normalizes phone");
check(normalized.address === "Hà Nội", "Customer VM normalizes address");

const state = createKpiEventFormState();
check(["assignment","customer","customerRelationMode","eventContent","eventTime","claimedValue","evidence","location","note","submitting","errors"].every(key => key in state), "shared form state covers Event and Customer concerns");
setKpiEventAssignment(state, required);
check(state.customerRelationMode === "REQUIRED", "assignment transition sets REQUIRED mode");
let payload = buildKpiCustomerEventPayload(state, [{sourceType:"MANUAL"}]);
check(!payload.ok && /chọn khách hàng/.test(payload.message), "REQUIRED is blocked without Customer");
setKpiEventCustomer(state, customer);
payload = buildKpiCustomerEventPayload(state, [{sourceType:"MANUAL", customer_id:"stale", customerName:"forbidden", customerSnapshot:{name:"forbidden"}}]);
check(payload.ok && payload.events[0].customerId === "customer-a", "REQUIRED sends Customer identity");
check(!("customer_id" in payload.events[0]), "snake-case stale customer identity is removed");
check(!("customerName" in payload.events[0]), "payload helper strips client-side Customer snapshot fields");
check(!("customerSnapshot" in payload.events[0]), "payload helper strips nested client-side Customer snapshots");
setKpiEventAssignment(state, optional, {preserveCustomer:true});
check(state.customer?.id === "customer-a", "REQUIRED to OPTIONAL preserves selected Customer");
setKpiEventCustomer(state, null);
payload = buildKpiCustomerEventPayload(state, [{sourceType:"MANUAL", customerId:"stale"}]);
check(payload.ok && !("customerId" in payload.events[0]), "OPTIONAL empty omits Customer");
setKpiEventCustomer(state, customer);
payload = buildKpiCustomerEventPayload(state, [{sourceType:"MANUAL"}]);
check(payload.events[0].customerId === "customer-a", "OPTIONAL linked sends Customer identity");
setKpiEventAssignment(state, none, {preserveCustomer:true});
check(state.customer === null, "switching to NONE clears stale Customer state");
payload = buildKpiCustomerEventPayload(state, [{sourceType:"MANUAL", customerId:"stale", customer_id:"stale"}]);
check(!("customerId" in payload.events[0]) && !("customer_id" in payload.events[0]), "NONE cannot leak a stale customerId");
resetKpiEventFormState(state);
check(state.assignment === null && state.customer === null && state.customerRelationMode === "NONE", "success/close reset clears assignment and Customer");

const calls = [];
const adapter = createKpiCustomerSearchAdapter(async (name, args) => { calls.push({name,args}); return [customer]; });
const rows = await adapter("Nguyễn", 100);
check(calls.length === 1, "Customer search uses one centralized adapter call");
check(calls[0].name === "crm_kpi_search_accessible_customers", "adapter uses authorized search RPC");
check(calls[0].args.p_limit === 50, "adapter clamps search limit");
check(rows[0].companyName === "Công ty A", "adapter returns normalized Customer VM");

const access = kpiCustomerSubmitError({code:"42501", message:"Ban khong co quyen truy cap Customer nay."});
check(access.kind === "customer-access" && access.clearCustomer, "42501 Customer access clears stale selection");
check(!/42501|permission denied/i.test(access.message), "42501 maps to business-friendly text");
const archived = kpiCustomerSubmitError({code:"55000", message:"Customer da archived"});
check(archived.kind === "customer-stale" && archived.clearCustomer, "archived Customer maps and clears selection");
const missing = kpiCustomerSubmitError({code:"22023", message:"KPI nay bat buoc Customer."});
check(missing.kind === "customer-required" && !missing.clearCustomer, "backend REQUIRED rejection maps to friendly validation");

const app = fs.readFileSync("js/features/crm-app.js", "utf8");
const view = fs.readFileSync("index.html", "utf8");
check((app.match(/async function submitKpi2Claim\s*\(/g) || []).length === 1, "there is one canonical Event submit function");
check(/openKpi2Claim\(assignmentId\).*openKpi2EventForm/s.test(app), "KPI Mine enters the shared Event form");
check(/openKpi2ClaimFromCustomer[\s\S]*openKpi2EventForm\(\{customer,entryPoint:'customer'\}\)/.test(app), "Customer Detail enters the shared Event form");
check((app.match(/crm_kpi_submit_events/g) || []).length === 1, "there is no duplicate root Event RPC submit path");
check(/createKpiCustomerSearchAdapter\(callCrmRpc\)/.test(app), "UI uses centralized Customer search adapter");
check(!app.includes("callCrmRpc('crm_kpi_search_accessible_customers'"), "UI does not bypass Customer search adapter");
check(/debounce\(\(\{value,session\}\)=>[\s\S]*,320\)/.test(app), "Customer search is debounced at 320ms");
check(/kpi2CustomerEntryBtn[\s\S]*!isSale\(\)/.test(app), "Customer Detail action is Sale-gated");
check(/id="kpi2CustomerEntryBtn"[^>]*>Đề xuất KPI</.test(view), "Customer Detail action exists");
check(/customerKpiQuickActionHtml\(c\.id,isSale\(\)\)/.test(app), "every rendered Sale Customer row receives the shared quick-action markup");
check(/data-kpi2-customer-entry[\s\S]*openKpi2ClaimFromCustomer\(kpi2CustomerEntryId\)/.test(app), "Customer-list click delegates to the same canonical Customer entry point");
check(/openKpi2ClaimFromCustomer[\s\S]*customers\.find\(row=>clean\(row\.id\)===clean\(customerId\)\)[\s\S]*openKpi2EventForm\(\{customer,entryPoint:'customer'\}\)/.test(app), "clicked/newly rendered Customer resolves from live list state and enters the shared form");
check((app.match(/KPI_CUSTOMER_NO_ELIGIBLE_MESSAGE/g) || []).length === 3, "all Customer entry no-eligible exits share the approved message constant");
check(/const canLabel = btn\?\.tagName === "BUTTON"[\s\S]*if \(canLabel\) \{[\s\S]*if \(label\) btn\.textContent = label/.test(app), "shared action runner preserves native select options while loading");
check(/data-open-care="\$\{esc\(c\.id\)\}"[\s\S]*data-open-deal="\$\{esc\(c\.id\)\}"[\s\S]*customerKpiQuickActionHtml/.test(app), "care and deal actions remain beside the KPI quick action");
check(["kpi2ClaimAssignmentSelect","kpi2CustomerSearchInput","kpi2CustomerSearchResults","kpi2SelectedCustomer","kpi2EventFields"].every(id => view.includes(`id="${id}"`)), "shared form contains assignment and Customer UI");
check(!/Proposal|proposal/.test(app.slice(app.indexOf("async function openKpi2ClaimFromCustomer"), app.indexOf("async function runKpi2CustomerSearch"))), "Customer entry does not invoke legacy Proposal");
check(!/kpi_proposals/.test(app.slice(app.indexOf("function renderCustomers"), app.indexOf("function excelCell"))), "Customer-list renderer has no legacy kpi_proposals dependency");
check(/p_events:linkedPayload\.events/.test(app), "canonical submit sends only sanitized Customer-linked Event payloads");

console.log(`KPI-2 Phase 3 Customer-linked Sale UI static: ${checks} checks PASS`);
