import {
  auth,
  db,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  query,
  where,
  limit,
  onSnapshot,
  writeBatch,
  deleteField,
  supabase,
} from "../firebase.js";

import { DEFAULT_SETTINGS } from "../config/default-settings.js";
import {
  $,
  todayIso,
  currentMonth,
  currentWeek,
  clean,
  phoneNorm,
  uniq,
  esc,
  money,
  toDate,
  fmtDate,
  dateInputValue,
  monthOf,
  weekOf,
  byDateDesc,
  debounce,
  optionValue,
  optionLabel,
  uniqueOptions,
  listToText,
  textToList,
  sourceChannelsToText,
  textToSourceChannels,
  objectToText,
  textToObject,
  normalizeKey,
} from "../utils/core.js";
import {
  parseCsv,
  rowValue,
  parseImportDate,
  parseImportAmount,
} from "../utils/csv.js";
import {
  assignmentEmployeeId,
  assignmentId as kpiTeamAssignmentId,
  assignmentProgressMetrics,
  buildKpiEmployeeSummaries,
  definitionName as kpiTeamDefinitionName,
  eligibleKpiEmployees,
  eventStatusKey,
  filterKpiEmployeeSummaries,
  filterKpiEvents,
  groupEvidenceCount,
  kpiValue as kpiTeamValue
} from "./kpi-team.js";
import {
  KPI_LEGACY_CUTOVER_AT,
  isLegacyKpiPreCutover,
  legacyCloseoutEligible,
  kpiCutoverStatusText
} from "./kpi-cutover.js";
let currentUser = null;
let appUser = null;
let settings = {...DEFAULT_SETTINGS};
let companySettings = {};
let allCustomers = [];
let customers = [];
let deletedCustomers = [];
let customerAssignments = [];
const selectedUnassignedCustomerIds = new Set();
let allCareLogs = [];
let careLogs = [];
let allDeals = [];
let deals = [];
let allQuotes = [];
let quotes = [];
let quoteItems = [];
let orderItems = [];
let allPayments = [];
let payments = [];
let allInventoryMovements = [];
let inventoryMovements = [];
let products = [];
let users = [];
let onlineSessions = [];
let kpiRules = [];
let kpiProposals = [];
let kpiPeriods = [];
let kpiDefinitions = [];
let kpiAssignments = [];
let kpi2Progress = [];
let kpi2Events = [];
let kpi2Evidence = [];
let kpi2StagedEvidence = [];
let kpi2EvidenceBusy = false;
let kpi2Candidates = [];
let kpi2DuplicateDetails = [];
let selectedKpiFoundationPeriodId = "";
const kpiTeamState = {
  activeMode: "employees",
  selectedPeriodId: "",
  employeeSearch: "",
  progressFilter: "all",
  pendingOnly: false,
  assignmentProgress: [],
  monthlyScores: [],
  selectedEmployeeId: "",
  activeEmployeeTab: "overview",
  eventStatus: "all",
  employeeEvents: [],
  employeeEvidence: [],
  proposalCacheKey: "",
  duplicateDetails: [],
  globalQueueOpen: false,
  globalQueueEvents: [],
  focusedEventId: "",
  historyProgress: [],
  historyPeriods: [],
  historyScoresByPeriod: new Map(),
  summaryCacheKey: "",
  summaryInFlightKey: "",
  loading: {summary:false, proposals:false, queue:false, history:false},
  errors: {summary:"", proposals:"", queue:"", history:""},
  requests: {summary:0, proposals:0, queue:0, history:0},
  summaryToken: 0,
  proposalToken: 0,
  historyToken: 0
};
const kpiCutoverState = {
  loaded: false,
  loading: false,
  preCutover: isLegacyKpiPreCutover(),
  legacyPendingCount: 0,
  canonicalPendingCount: 0,
  serverNow: "",
  cutoverAt: KPI_LEGACY_CUTOVER_AT,
  error: ""
};
let auditLogs = [];
let unsubscribers = [];
let selectedCustomerId = "";
let scopedSnapshots = {customers:{}, careLogs:{}, deals:{}, kpiProposals:{}, customerAssignments:{}};
let presenceTimer = null;
let channelReportHitAreas = [];
let activeMainView = "crm";
let activeChannelQuickFilter = "";
let editingKpiRuleId = "";
let editingKpiProposalId = "";
let editingDealId = "";
let editingQuoteId = "";
let kpiProposalCustomerContext = null;
let inventoryQtyCache = new Map();
let renderQueuedWhileHidden = false;
const pagingState = {
  customers: {limit: 40, step: 40},
  tasks: {limit: 30, step: 30},
  products: {limit: 80, step: 80},
  saleActivity: {limit: 80, step: 80},
  audit: {limit: 80, step: 80},
  adminAudit: {limit: 80, step: 80}
};
let pendingLoginSuccessNotice = false;
const KPI_EVIDENCE_BUCKET = "kpi-evidence";
const KPI2_EVIDENCE_BUCKET = "kpi2-evidence";
const KPI_EVIDENCE_MAX_FILES = 6;
const KPI_EVIDENCE_MAX_SIZE = 8 * 1024 * 1024;
const DEFAULT_COMPANY_SETTINGS = {
  companyName: "Kolorceramic THT",
  logoUrl: "",
  phone: "",
  email: "",
  showroomAddress: "",
  facebookUrl: "",
  zaloUrl: "",
  brandColor: "#147a68",
  defaultNotice: ""
};

const roleKey = () => clean(appUser?.role).toLowerCase();
const isOwner = () => roleKey() === "owner";
const isAdmin = () => roleKey() === "admin";
const canAccessAdminPanel = () => isOwner() || isAdmin();
const isManager = () => ["owner","admin","manager","quanly","quản lý","quản lí"].includes(roleKey());
const isSale = () => roleKey() === "sale";
const canExportData = () => ["admin","manager","sale"].includes(roleKey()) || appUser?.canExport === true || String(appUser?.canExport || "").toLowerCase() === "true";
const ownerName = () => clean(appUser?.name) || clean(currentUser?.displayName) || clean(currentUser?.email);
const ownerEmail = () => clean(appUser?.email) || clean(currentUser?.email);
const sameIdentity = (a, b) => !!clean(a) && !!clean(b) && normalizeKey(a) === normalizeKey(b);
const ownerMatchesCurrentUser = item => sameIdentity(item?.ownerUserId, appUser?.uid) || sameIdentity(item?.ownerEmail, ownerEmail()) || sameIdentity(item?.owner, ownerName());
const canEditCustomer = c => !!c?.id && (isManager() || ownerMatchesCurrentUser(c));

const legacyKpiPreCutover = () => kpiCutoverState.loaded ? kpiCutoverState.preCutover : isLegacyKpiPreCutover();
const legacyVisiblePendingCount = () => kpiProposals.filter(p => isPendingKpiProposal(p) && !p.isDeleted).length;
const legacyKpiCloseoutAllowed = proposal => legacyKpiPreCutover() || legacyCloseoutEligible(proposal, isPendingKpiProposal(proposal));
const operationalKpiPendingCount = () => legacyKpiPreCutover()
  ? legacyVisiblePendingCount()
  : Number(kpiCutoverState.canonicalPendingCount || 0);

async function refreshCanonicalKpiPendingCount() {
  if (!isManager() || legacyKpiPreCutover()) {
    kpiCutoverState.canonicalPendingCount = 0;
    return 0;
  }
  const result = await supabase
    .from("kpi_submission_events")
    .select("id", {count: "exact", head: true})
    .eq("status", "PENDING");
  if (result.error) throw result.error;
  kpiCutoverState.canonicalPendingCount = Number(result.count || 0);
  return kpiCutoverState.canonicalPendingCount;
}

async function refreshKpiCutoverState({render = true} = {}) {
  if (!currentUser || !appUser || kpiCutoverState.loading) return;
  kpiCutoverState.loading = true;
  kpiCutoverState.error = "";
  try {
    const status = await callCrmRpc("crm_legacy_kpi_cutover_status", {});
    kpiCutoverState.loaded = true;
    kpiCutoverState.preCutover = status?.preCutover !== false;
    kpiCutoverState.legacyPendingCount = Number(status?.legacyPendingCount || 0);
    kpiCutoverState.serverNow = clean(status?.serverNow);
    kpiCutoverState.cutoverAt = clean(status?.cutoverAt) || kpiCutoverState.cutoverAt;
    await refreshCanonicalKpiPendingCount();
  } catch (error) {
    kpiCutoverState.error = authMessage(error);
    if (!kpiCutoverState.loaded) kpiCutoverState.preCutover = isLegacyKpiPreCutover();
    throw error;
  } finally {
    kpiCutoverState.loading = false;
    if (render) {
      renderKpiCutoverStatus();
      renderExecutiveDashboard();
      renderReportCenter();
      if (canAccessAdminPanel()) renderAdminDashboard();
    }
  }
}

function renderKpiCutoverStatus() {
  const target = $("kpiCutoverStatus");
  if (!target) return;
  const legacyPendingCount = kpiCutoverState.loaded
    ? kpiCutoverState.legacyPendingCount
    : legacyVisiblePendingCount();
  target.classList.toggle("post-cutover", !legacyKpiPreCutover());
  target.innerHTML = `<b>${legacyKpiPreCutover() ? "Chuẩn bị chuyển hệ thống KPI" : "KPI hiện tại"}</b><span>${esc(kpiCutoverStatusText({preCutover:legacyKpiPreCutover(), legacyPendingCount}))}</span>${kpiCutoverState.error ? `<span class="error-text">Chưa đồng bộ được trạng thái từ server: ${esc(kpiCutoverState.error)}</span>` : ""}`;
}
const logAudit = (action, entity, entityId = "", payload = {}) => setDoc(doc(collection(db, "auditLogs")), {
  action,
  entity,
  entityId,
  email: currentUser?.email || "",
  payloadJson: JSON.stringify(payload || {}),
  createdAt: serverTimestamp()
});

function rpcValue(value) {
  if (value?.__serverTimestamp) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(rpcValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rpcValue(item)]));
  }
  return value;
}

async function callCrmRpc(name, args = {}) {
  const {data, error} = await supabase.rpc(name, rpcValue(args));
  if (error) throw error;
  return data;
}

function duplicateCustomerIdFromError(err) {
  const text = [err?.message, err?.details, err?.hint].filter(Boolean).join(" ");
  return text.match(/CRM_DUPLICATE_PHONE:([A-Za-z0-9-]+)/)?.[1] || "";
}
const systemLabel = key => clean(settings?.systemLabels?.[key]) || clean(DEFAULT_SETTINGS.systemLabels[key]);
const sameLabel = (value, key) => normalizeKey(value) === normalizeKey(systemLabel(key));
const normalizeDealStatus = v => {
  const s = clean(v);
  const lower = s.toLowerCase();
  if (s === "Mất" || lower === "fail" || lower === "rớt") return systemLabel("failStatus");
  if (["hủy", "huỷ", "huy", "đã hủy", "đã huỷ"].includes(lower)) return systemLabel("canceledStatus");
  return s;
};
const isFailStatus = v => sameLabel(normalizeDealStatus(v), "failStatus");
const isCanceledDeal = v => sameLabel(normalizeDealStatus(v), "canceledStatus");
const isWonStatus = v => sameLabel(normalizeDealStatus(v), "depositStatus") || sameLabel(normalizeDealStatus(v), "boughtStatus");
const isPartnerChannel = v => {
  const key = normalizeKey(v);
  return key.includes("congtytkxd") || key.includes("tkxd") || key.includes("congtythietkexaydung") || key.includes("congtyxaydungthietke") || key.includes("congtyxaydung") || key.includes("thietkexaydung") || key.includes("xaydungthietke");
};

function canonicalChannel(value, labels = settings.channels || []) {
  const raw = clean(value);
  const normalized = normalizeKey(raw);
  const known = labels.find(label => normalizeKey(label) === normalized);
  if (known) return known;
  const aliasMap = [
    [["khachvanglai", "tuvaoshowroom", "showroom"], "Khách vãng lai"],
    [["congtrinhdd", "congtrinhdandung"], "Công trình dd"],
    [["congtytkxd", "tkxd", "congtythietkexaydung", "congtyxaydungthietke", "congtyxaydung", "thietkexaydung", "xaydungthietke"], "Công ty TK/XD"],
    [["facebook", "fb"], "Facebook"],
    [["zalo"], "Zalo"],
    [["website", "web"], "Website"],
    [["tiktok"], "Tiktok"],
    [["sepgioithieu"], "Sếp giới thiệu"],
    [["doitacgioithieu"], "Đối tác giới thiệu"],
    [["dithitruong", "thitruong"], "Đi thị trường"],
    [["khac", "other"], "Khác"]
  ];
  const matched = aliasMap.find(([keys]) => keys.some(key => normalized.includes(key)));
  if (!matched) return labels.includes("Khác") ? "Khác" : (labels[labels.length - 1] || "Khác");
  const targetKey = normalizeKey(matched[1]);
  return labels.find(label => normalizeKey(label) === targetKey) || matched[1];
}
function notice(msg, bad=false, type="") {
  const box = $("notice");
  box.textContent = msg;
  const cls = bad ? "bad" : (type || "good");
  box.className = "notice " + cls;
  box.classList.remove("hide");
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => box.classList.add("hide"), bad ? 5200 : 3000);
}

const busyKeys = new Set();
let busyActionCount = 0;
function setSavingMaskVisible(visible) {
  const mask = $("savingMask");
  if (!mask) return;
  if (visible) {
    busyActionCount += 1;
    mask.classList.remove("hide");
    return;
  }
  busyActionCount = Math.max(0, busyActionCount - 1);
  if (busyActionCount === 0) mask.classList.add("hide");
}
async function runAction(buttonId, key, label, fn) {
  if (busyKeys.has(key)) return;
  busyKeys.add(key);
  const btn = $(buttonId);
  const oldText = btn?.textContent || "";
  if (btn) {
    btn.disabled = true;
    btn.classList.add("loading");
    btn.dataset.oldText = oldText;
    if (label) btn.textContent = label;
  }
  setSavingMaskVisible(true);
  try {
    return await withActionTimeout(fn(), label || "Đang xử lý");
  } catch (err) {
    notice(authMessage(err), true);
  } finally {
    busyKeys.delete(key);
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("loading");
      btn.textContent = btn.dataset.oldText || oldText;
    }
    setSavingMaskVisible(false);
  }
}

function withActionTimeout(promise, label, ms=45000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} quá lâu, vui lòng kiểm tra mạng rồi thử lại.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const dirtyCollections = new Set();
const adminRoutes = {
  "/admin": {key:"dashboard", title:"Quản trị CRM", subtitle:"Quản trị người dùng, danh mục CRM, chăm sóc khách hàng và dữ liệu vận hành."},
  "/admin/users": {key:"users", title:"Người dùng", subtitle:"Quản lý tài khoản, role, khóa/mở và thông tin nhân viên."},
  "/admin/categories": {key:"categories", title:"Danh mục CRM", subtitle:"Quản lý kênh chi tiết, trạng thái, tình trạng chăm sóc và dropdown CRM."},
  "/admin/settings": {key:"settings", title:"Cấu hình công ty", subtitle:"Quản lý logo, hotline, email, showroom, mạng xã hội và thương hiệu."},
  "/admin/audit-logs": {key:"audit-logs", title:"Nhật ký hoạt động", subtitle:"Theo dõi các thay đổi khách hàng, chăm sóc, KPI, user và cấu hình."}
};
const viewDependencies = {
  crm: ["customers", "careLogs", "deals", "settings"],
  customers: ["customers", "customerAssignments", "careLogs", "deals", "settings", "users"],
  kpi: ["customers", "kpiRules", "kpiProposals", "kpiPeriods", "kpiDefinitions", "kpiAssignments", "settings", "users"],
  reports: ["customers", "careLogs", "deals", "kpiProposals", "auditLogs", "settings", "users"],
  admin: ["customers", "customerAssignments", "careLogs", "deals", "users", "auditLogs", "settings", "companySettings", "kpiRules", "kpiProposals"]
};
const scheduleRenderAll = debounce(() => {
  if (document.hidden) {
    renderQueuedWhileHidden = true;
    return;
  }
  renderAll();
}, 180);
const scheduleRenderChart = debounce(() => requestChartRender(), 180);

const OPERATIONS_WARN_LIMITS = {
  customers: 1200,
  careLogs: 5000,
  auditLogs: 8000,
  kpiProposals: 2500
};

function markDirty(...names) {
  names.flat().filter(Boolean).forEach(name => dirtyCollections.add(name));
  scheduleRenderAll();
}

function activeViewKey() {
  return ["customers","kpi","reports","admin"].includes(activeMainView) ? activeMainView : "crm";
}

function activeViewNeedsRender() {
  if (!dirtyCollections.size) return true;
  const deps = viewDependencies[activeViewKey()] || viewDependencies.crm;
  return deps.some(name => dirtyCollections.has(name));
}

function hasDirty(...names) {
  return !dirtyCollections.size || names.some(name => dirtyCollections.has(name));
}

function pageRows(key, rows) {
  const state = pagingState[key];
  if (!state) return rows;
  return rows.slice(0, state.limit);
}

function resetPaging(key) {
  const state = pagingState[key];
  if (!state) return;
  state.limit = state.step;
}

function renderPager(id, key, total, label="dòng") {
  const el = $(id);
  const state = pagingState[key];
  if (!el || !state) return;
  const shown = Math.min(total, state.limit);
  if (total <= shown) {
    el.classList.add("hide");
    el.innerHTML = total ? `<span>Đang hiển thị ${esc(total)} ${esc(label)}.</span>` : "";
    return;
  }
  el.classList.remove("hide");
  el.innerHTML = `
    <span>Đang hiển thị ${esc(shown)}/${esc(total)} ${esc(label)}</span>
    <button class="small" type="button" data-load-more="${esc(key)}">Hiển thị thêm</button>
  `;
}

function isAdminRoute() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path === "/admin" || path.startsWith("/admin/");
}

function currentAdminRoute() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/admin";
  return adminRoutes[path] ? path : "/admin";
}

function goToRoute(path) {
  if (window.location.pathname === path) return showApp();
  window.history.pushState({}, "", path);
  showApp();
}

function loadMorePage(key) {
  const state = pagingState[key];
  if (!state) return;
  state.limit += state.step;
  const renderers = {
    customers: renderCustomers,
    tasks: renderTaskBoard,
    saleActivity: renderSaleActivityReport,
    audit: renderAuditTrail,
    adminAudit: renderAdminAuditPage
  };
  renderers[key]?.();
}

function resetPagingAndRender(keys, renderFn) {
  (Array.isArray(keys) ? keys : [keys]).forEach(resetPaging);
  renderFn();
}

function authMessage(err) {
  const code = String(err?.code || "");
  const message = String(err?.message || "");
  if (code.includes("unauthorized-domain")) return "Domain này chưa được cho phép trong Supabase Authentication. Hãy kiểm tra Site URL/Redirect URLs trong Supabase.";
  if (code.includes("invalid-credential") || code.includes("wrong-password")) return "Email hoặc mật khẩu chưa đúng.";
  if (code.includes("user-not-found")) return "Chưa có tài khoản này trong Supabase Authentication.";
  if (code.includes("popup")) return "Trình duyệt đang chặn popup đăng nhập Google.";
  if (/KPI_IDEMPOTENCY_PAYLOAD_CONFLICT/i.test(message)) {
    return "Yêu cầu này đã được gửi trước đó với nội dung khác. Vui lòng tải lại dữ liệu rồi thử lại.";
  }
  if (/upload ảnh|storage|bucket|object/i.test(message) && /permission|row-level security|violates row-level security/i.test(message)) {
    return "Chưa upload được ảnh minh chứng. Hãy kiểm tra bucket kpi-evidence và policy Storage.";
  }
  if (/permission|row-level security|violates row-level security|infinite recursion/i.test(message)) return "Bạn chưa có quyền đọc/ghi Supabase. Hãy kiểm tra RLS và role/active trong bảng app_users.";
  if (message.includes("Chưa được cấp quyền")) return message;
  return message || "Không đăng nhập được.";
}

function on(id, eventName, handler, options) {
  const el = $(id);
  if (!el) return;
  el.addEventListener(eventName, handler, options);
}

function fillSelect(id, values, placeholder="-- Chọn --", allLabel="") {
  const el = $(id);
  if (!el) return;
  const current = el.value;
  const items = uniqueOptions(values);
  el.innerHTML = "";
  if (allLabel) el.insertAdjacentHTML("beforeend", `<option value="">${esc(allLabel)}</option>`);
  else el.insertAdjacentHTML("beforeend", `<option value="">${esc(placeholder)}</option>`);
  items.forEach(item => el.insertAdjacentHTML("beforeend", `<option value="${esc(item.value)}">${esc(item.label)}</option>`));
  if (items.some(item => item.value === current) || current === "") el.value = current;
  else el.value = "";
}

function ownerOptions() {
  const activeUserProfiles = users
    .filter(u => u.active !== false && clean(u.lifecycleStatus || "active").toLowerCase() === "active" && !["admin","owner"].includes(clean(u.role).toLowerCase()))
    .map(u => ({name: clean(u.name || u.email), email: clean(u.email)}))
    .filter(u => u.name && u.email);
  if (activeUserProfiles.length) return activeUserProfiles;
  const self = {name: ownerName(), email: ownerEmail()};
  return self.name && self.email ? [self] : [];
}

function selfOwnerProfile() {
  const self = {name: ownerName(), email: ownerEmail()};
  return self.name && self.email ? self : null;
}

function reportOwnerKeys() {
  const ownerProfiles = ownerOptions();
  const keys = ownerProfiles.map(o => clean(o.email || o.name));
  const self = selfOwnerProfile();
  if (!isManager() && self) keys.push(self.email || self.name);
  activeKpiRules().forEach(rule => kpiRuleAssignedOwners(rule).forEach(email => {
    if (isManager() || normalizeKey(email) === normalizeKey(self?.email)) keys.push(email);
  }));
  return uniq(keys).filter(Boolean);
}

function ownerProfileByValue(value) {
  const key = clean(value);
  return ownerOptions().find(o => clean(o.email) === key || clean(o.name) === key) || {name:key, email:key};
}

function hydrateOwnerDependentFilters() {
  const options = ownerOptions();
  [
    ["filterOwner", "Tất cả nhân viên"],
    ["taskOwnerFilter", "Tất cả nhân viên"],
    ["reportActivityOwner", "Tất cả nhân viên"],
    ["erpReportOwner", "Tất cả nhân viên"]
  ].forEach(([id, label]) => {
    const el = $(id);
    if (!el) return;
    const current = el.value;
    fillSelect(id, options, "", label);
    if (options.some(o => clean(o.email) === current || clean(o.name) === current)) el.value = current;
  });
  if (!isManager() && $("filterOwner")) {
    $("filterOwner").value = ownerEmail();
    $("filterOwner").disabled = true;
  }
}

function customerOwnerKey(c) {
  return clean(c.ownerEmail) || clean(c.owner);
}

function customerOwnerName(c) {
  const key = customerOwnerKey(c);
  const profile = ownerProfileByValue(key);
  return clean(profile.name) || clean(c.owner) || key;
}

function togglePartnerFields() {
  const show = isPartnerChannel($("channel").value);
  $("partnerFields").classList.toggle("hide", !show);
  if (!show) ["customerCompanyName","partnerType","partnerActivity","partnerLevel","partnerCapacity"].forEach(id => { if ($(id)) $(id).value = ""; });
}

function toggleCarePartnerFields() {
  $("carePartnerFields").classList.add("hide");
  ["careCompanyName","carePartnerType","carePartnerActivity","carePartnerLevel","carePartnerCapacity"].forEach(id => { if ($(id)) $(id).value = ""; });
}

function hydrateSelects() {
  fillSelect("source", settings.sources);
  fillSelect("customerType", settings.customerTypes);
  fillSelect("potentialLevel", settings.potentialLevels || DEFAULT_SETTINGS.potentialLevels);
  hydrateChannelOptions();
  fillSelect("owner", ownerOptions());
  fillSelect("editSource", settings.sources);
  fillSelect("editCustomerType", settings.customerTypes);
  fillSelect("editPotentialLevel", settings.potentialLevels || DEFAULT_SETTINGS.potentialLevels);
  fillSelect("editOwner", ownerOptions());
  fillSelect("editPartnerType", settings.partnerTypes);
  fillSelect("editPartnerActivity", settings.partnerActivities);
  fillSelect("editPartnerLevel", settings.partnerLevels);
  fillSelect("editPartnerCapacity", settings.partnerCapacity);
  hydrateEditChannelOptions();
  fillSelect("careStatus", settings.statuses);
  updateCareStatusVisual();
  fillSelect("careChannel", settings.careChannels);
  fillSelect("careResult", settings.careResults);
  fillSelect("partnerType", settings.partnerTypes);
  fillSelect("partnerActivity", settings.partnerActivities);
  fillSelect("partnerLevel", settings.partnerLevels);
  fillSelect("partnerCapacity", settings.partnerCapacity);
  fillSelect("carePartnerType", settings.partnerTypes);
  fillSelect("carePartnerActivity", settings.partnerActivities);
  fillSelect("carePartnerLevel", settings.partnerLevels);
  fillSelect("carePartnerCapacity", settings.partnerCapacity);
  fillSelect("dealStatus", settings.dealStatuses);
  fillSelect("filterOwner", ownerOptions(), "", "Tất cả nhân viên");
  fillSelect("filterStatus", [...settings.statuses, {value:"__NO_PHONE__", label:"KH không SĐT"}], "", "Tất cả trạng thái");
  fillSelect("filterDealStatus", settings.dealStatuses, "", "Tất cả trạng thái mua");
  fillSelect("filterFollow", settings.follows, "", "Tất cả tình trạng");
  fillSelect("filterSource", settings.sources, "", "Tất cả nguồn");
  hydrateFilterChannelOptions();
  fillSelect("filterCustomerType", settings.customerTypes, "", "Tất cả phân loại");
  hydrateProposalKpiOptions();
  renderDropdownSettingsForm();
  // Không tự lọc theo tháng hiện tại. Bộ lọc Tháng/Tuần để trống thì hiển thị tất cả dữ liệu.
  $("filterWeek").value ||= "";
  $("filterMonth").value ||= "";
  $("kpiRuleMonth").value ||= currentMonth();
  if (!$("potentialLevel").value) $("potentialLevel").value = "Bình thường";
  $("careDueDays").value = careDueDays();
  togglePartnerFields();
  if (!isManager()) {
    $("owner").value = ownerEmail();
    $("owner").disabled = true;
    $("editOwner").disabled = true;
    $("filterOwner").value = ownerEmail();
    $("filterOwner").disabled = true;
    $("exportBtn").classList.toggle("hide", !canExportData());
    $("deleteCustomerBtn").classList.add("hide");
    $("seedBtn").classList.add("hide");
    $("syncPhoneBtn").classList.add("hide");
    $("syncOwnerBtn").classList.add("hide");
    $("importBtn").classList.add("hide");
    $("kpiRulePanel").classList.add("hide");
    $("kpiApprovalPanel").classList.add("hide");
    $("careSettingsPanel").classList.add("hide");
    $("dropdownSettingsPanel").classList.add("hide");
    $("userAdminPanel").classList.add("hide");
    $("trashPanel").classList.add("hide");
    $("proHealthPanel").classList.add("hide");
    $("auditPanel").classList.add("hide");
    $("adminViewBtn")?.classList.toggle("hide", !canAccessAdminPanel());
    $("reportsViewBtn")?.classList.add("hide");
  } else {
    $("owner").disabled = false;
    $("editOwner").disabled = false;
    $("filterOwner").disabled = false;
    $("exportBtn").classList.remove("hide");
    $("deleteCustomerBtn").classList.remove("hide");
    $("seedBtn").classList.toggle("hide", !canAccessAdminPanel());
    $("syncPhoneBtn").classList.toggle("hide", !canAccessAdminPanel());
    $("syncOwnerBtn").classList.toggle("hide", !canAccessAdminPanel());
    $("importBtn").classList.toggle("hide", !canAccessAdminPanel());
    $("kpiRulePanel").classList.remove("hide");
    $("kpiApprovalPanel").classList.remove("hide");
    $("careSettingsPanel").classList.toggle("hide", !canAccessAdminPanel());
    $("dropdownSettingsPanel").classList.toggle("hide", !canAccessAdminPanel());
    $("proHealthPanel").classList.toggle("hide", !canAccessAdminPanel());
    $("auditPanel").classList.toggle("hide", !canAccessAdminPanel());
    $("userAdminPanel").classList.toggle("hide", !canAccessAdminPanel());
    $("trashPanel").classList.toggle("hide", !canAccessAdminPanel());
    $("adminViewBtn")?.classList.toggle("hide", !canAccessAdminPanel());
    $("reportsViewBtn")?.classList.remove("hide");
  }
}

function sourceChannelOptions(sourceValue) {
  return settings.channels || [];
}

function hydrateChannelOptions() {
  fillSelect("channel", settings.channels || []);
  $("channel").disabled = false;
}

function hydrateFilterChannelOptions() {
  fillSelect("filterChannel", settings.channels || [], "", "Tất cả kênh");
  $("filterChannel").disabled = false;
}

function hydrateEditChannelOptions() {
  fillSelect("editChannel", settings.channels || []);
  $("editChannel").disabled = false;
}

function toggleEditPartnerFields() {
  const show = isPartnerChannel($("editChannel").value);
  $("editPartnerFields").classList.toggle("hide", !show);
  if (!show) ["editCompanyName","editPartnerType","editPartnerActivity","editPartnerLevel","editPartnerCapacity"].forEach(id => { if ($(id)) $(id).value = ""; });
}

function normalizeSettings(raw = {}) {
  const next = {...DEFAULT_SETTINGS, ...raw};
  Object.keys(DEFAULT_SETTINGS).forEach(key => {
    if (Array.isArray(DEFAULT_SETTINGS[key])) {
      next[key] = Array.isArray(raw[key]) && raw[key].length ? raw[key] : [...DEFAULT_SETTINGS[key]];
    } else if (key === "sourceChannels" || key === "systemLabels") {
      next[key] = raw[key] && typeof raw[key] === "object" ? {...DEFAULT_SETTINGS[key], ...raw[key]} : {...DEFAULT_SETTINGS[key]};
    } else if (raw[key] === undefined || raw[key] === null || raw[key] === "") {
      next[key] = DEFAULT_SETTINGS[key];
    }
  });
  if (Number(raw.followConfigVersion || 0) < DEFAULT_SETTINGS.followConfigVersion) {
    next.followConfigVersion = DEFAULT_SETTINGS.followConfigVersion;
    next.follows = [...DEFAULT_SETTINGS.follows];
  }
  next.sourceConfigVersion = Number(raw.sourceConfigVersion || DEFAULT_SETTINGS.sourceConfigVersion);
  delete next.owners;
  delete next.ownerProfiles;
  return next;
}

async function migrateSettingsIfNeeded(raw = {}) {
  if (!canAccessAdminPanel()) return;
  const patch = {};
  Object.keys(DEFAULT_SETTINGS).forEach(key => {
    if (Array.isArray(DEFAULT_SETTINGS[key]) && (!Array.isArray(raw[key]) || !raw[key].length)) patch[key] = DEFAULT_SETTINGS[key];
    else if ((key === "sourceChannels" || key === "systemLabels") && (!raw[key] || typeof raw[key] !== "object")) patch[key] = DEFAULT_SETTINGS[key];
    else if (raw[key] === undefined || raw[key] === null || raw[key] === "") patch[key] = DEFAULT_SETTINGS[key];
  });
  if (raw.owners !== undefined) patch.owners = deleteField();
  if (raw.ownerProfiles !== undefined) patch.ownerProfiles = deleteField();
  if (Number(raw.sourceConfigVersion || 0) < DEFAULT_SETTINGS.sourceConfigVersion) patch.sourceConfigVersion = DEFAULT_SETTINGS.sourceConfigVersion;
  if (Number(raw.followConfigVersion || 0) < DEFAULT_SETTINGS.followConfigVersion) {
    patch.followConfigVersion = DEFAULT_SETTINGS.followConfigVersion;
    patch.follows = DEFAULT_SETTINGS.follows;
  }
  if (!Object.keys(patch).length) return;
  await setDoc(doc(db, "settings", "crm"), patch, {merge:true});
}

function applySettings(rawSettings = {}) {
  settings = normalizeSettings(rawSettings);
  settings.systemLabels = {...DEFAULT_SETTINGS.systemLabels, ...(settings.systemLabels || {})};
  settings.dealStatuses = uniq([
    ...settings.dealStatuses.map(normalizeDealStatus),
    systemLabel("canceledStatus")
  ].filter(s => !sameLabel(s, "failStatus")));
  settings.careDueDays = Math.max(0, Number(settings.careDueDays ?? DEFAULT_SETTINGS.careDueDays) || DEFAULT_SETTINGS.careDueDays);
}

async function loadAppUser(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return {uid:user.uid, ...snap.data()};

  const data = {
    email: user.email || "",
    name: user.displayName || user.email || "Người dùng",
    role: "sale",
    active: false,
    canExport: false,
    team: "",
    createdAt: serverTimestamp()
  };
  await setDoc(ref, data);
  throw new Error("Chưa được cấp quyền CRM. Admin cần vào Supabase > app_users và bật active=true cho tài khoản này.");
}

async function loadSettings() {
  const snap = await getDoc(doc(db, "settings", "crm"));
  const rawSettings = snap.exists() ? snap.data() : {};
  applySettings(rawSettings);
  await migrateSettingsIfNeeded(rawSettings);
  hydrateSelects();
}

function stableSettingsValue(value) {
  if (Array.isArray(value)) return value.map(stableSettingsValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableSettingsValue(value[key])]));
  }
  return value;
}

function settingsValueMatches(actual, expected) {
  return JSON.stringify(stableSettingsValue(actual)) === JSON.stringify(stableSettingsValue(expected));
}

async function saveSettingsAndVerify(data, keys = Object.keys(data)) {
  await setDoc(doc(db, "settings", "crm"), data, {merge:true});
  const savedSnap = await getDoc(doc(db, "settings", "crm"));
  if (!savedSnap.exists()) throw new Error("Supabase không trả lại bản ghi settings/crm sau khi lưu.");
  const persisted = savedSnap.data();
  const mismatched = keys.filter(key => !settingsValueMatches(persisted[key], data[key]));
  if (mismatched.length) {
    throw new Error(`Dữ liệu đọc lại từ Supabase không khớp ở: ${mismatched.join(", ")}. Hãy kiểm tra RLS hoặc trigger của bảng settings.`);
  }
  applySettings(persisted);
  hydrateSelects();
  return persisted;
}

function normalizeCompanySettings(raw = {}) {
  return {
    ...DEFAULT_COMPANY_SETTINGS,
    ...raw,
    brandColor: /^#[0-9a-f]{6}$/i.test(clean(raw.brandColor)) ? clean(raw.brandColor) : DEFAULT_COMPANY_SETTINGS.brandColor
  };
}

async function loadCompanySettings() {
  const snap = await getDoc(doc(db, "companySettings", "main"));
  companySettings = normalizeCompanySettings(snap.exists() ? snap.data() : {});
}

function companySettingsFormData() {
  return normalizeCompanySettings({
    companyName: clean($("companyName")?.value) || DEFAULT_COMPANY_SETTINGS.companyName,
    logoUrl: clean($("companyLogoUrl")?.value),
    phone: clean($("companyPhone")?.value),
    email: clean($("companyEmail")?.value),
    showroomAddress: clean($("companyShowroomAddress")?.value),
    facebookUrl: clean($("companyFacebookUrl")?.value),
    zaloUrl: clean($("companyZaloUrl")?.value),
    brandColor: clean($("companyBrandColor")?.value) || DEFAULT_COMPANY_SETTINGS.brandColor,
    defaultNotice: clean($("companyDefaultNotice")?.value)
  });
}

function renderCompanySettingsPreview(data = companySettingsFormData()) {
  const box = $("companySettingsPreview");
  if (!box) return;
  const contact = [
    data.phone ? `Hotline: ${data.phone}` : "",
    data.email ? `Email: ${data.email}` : "",
    data.showroomAddress ? `Showroom: ${data.showroomAddress}` : "",
    data.facebookUrl ? `Facebook: ${data.facebookUrl}` : "",
    data.zaloUrl ? `Zalo: ${data.zaloUrl}` : ""
  ].filter(Boolean).join("<br>");
  const logo = data.logoUrl
    ? `<img src="${esc(data.logoUrl)}" alt="Logo" onerror="this.remove()">`
    : esc((data.companyName || "K").charAt(0).toUpperCase());
  box.innerHTML = `
    <span class="muted">Xem trước</span>
    <div class="company-preview-logo" style="background:${esc(data.brandColor)}">${logo}</div>
    <b>${esc(data.companyName)}</b>
    <p class="muted">${contact || "Chưa có thông tin liên hệ."}</p>
    ${data.defaultNotice ? `<p>${esc(data.defaultNotice)}</p>` : ""}
  `;
}

function renderCompanySettingsForm() {
  if (!canAccessAdminPanel()) return;
  const data = normalizeCompanySettings(companySettings);
  const pairs = [
    ["companyName", data.companyName],
    ["companyLogoUrl", data.logoUrl],
    ["companyPhone", data.phone],
    ["companyEmail", data.email],
    ["companyShowroomAddress", data.showroomAddress],
    ["companyFacebookUrl", data.facebookUrl],
    ["companyZaloUrl", data.zaloUrl],
    ["companyBrandColor", data.brandColor],
    ["companyDefaultNotice", data.defaultNotice]
  ];
  pairs.forEach(([id, value]) => {
    const el = $(id);
    if (el && document.activeElement !== el) el.value = value || "";
  });
  renderCompanySettingsPreview(data);
}

async function saveCompanySettings() {
  if (!canAccessAdminPanel()) return notice("Chỉ owner/admin được lưu cấu hình công ty.", true);
  const data = companySettingsFormData();
  try {
    await setDoc(doc(db, "companySettings", "main"), {
      ...data,
      updatedByEmail: currentUser?.email || "",
      updatedAt: serverTimestamp()
    }, {merge:true});
    const savedSnap = await getDoc(doc(db, "companySettings", "main"));
    if (!savedSnap.exists()) throw new Error("Supabase không trả lại cấu hình công ty sau khi lưu.");
    const persisted = normalizeCompanySettings(savedSnap.data());
    const mismatched = Object.keys(data).filter(key => !settingsValueMatches(persisted[key], data[key]));
    if (mismatched.length) throw new Error(`Cấu hình đọc lại không khớp ở: ${mismatched.join(", ")}.`);
    companySettings = persisted;
    renderCompanySettingsForm();
    await logAudit("updateCompanySettings", "companySettings", "main", data)
      .catch(err => notice("Đã lưu cấu hình, nhưng chưa ghi được audit log: " + authMessage(err), true));
    notice("Đã lưu cấu hình công ty.");
  } catch (err) {
    notice("Không lưu được cấu hình công ty. Hãy chắc chắn đã chạy file SQL company_settings. " + authMessage(err), true);
  }
}

function resetCompanySettingsForm() {
  renderCompanySettingsForm();
  notice("Đã khôi phục form cấu hình công ty.");
}

function renderAdminCategorySettingsForm() {
  if (!canAccessAdminPanel()) return;
  const pairs = [
    ["adminSettingsSourceChannels", settings.channels],
    ["adminSettingsCustomerTypes", settings.customerTypes],
    ["adminSettingsPotentialLevels", settings.potentialLevels],
    ["adminSettingsStatuses", settings.statuses],
    ["adminSettingsFollows", settings.follows],
    ["adminSettingsCareChannels", settings.careChannels],
    ["adminSettingsCareResults", settings.careResults],
    ["adminSettingsDealStatuses", settings.dealStatuses]
  ];
  pairs.forEach(([id, values]) => {
    const el = $(id);
    if (el && document.activeElement !== el) el.value = listToText(values);
  });
  if ($("adminCareDueDays") && document.activeElement !== $("adminCareDueDays")) $("adminCareDueDays").value = careDueDays();
  if ($("adminSettingsSystemLabels") && document.activeElement !== $("adminSettingsSystemLabels")) {
    $("adminSettingsSystemLabels").value = objectToText(settings.systemLabels);
  }
}

function adminCategorySettingsData() {
  return {
    sources: [],
    sourceChannels: {},
    channels: textToList($("adminSettingsSourceChannels").value),
    customerTypes: textToList($("adminSettingsCustomerTypes").value),
    potentialLevels: textToList($("adminSettingsPotentialLevels").value),
    statuses: textToList($("adminSettingsStatuses").value),
    follows: textToList($("adminSettingsFollows").value),
    careChannels: textToList($("adminSettingsCareChannels").value),
    careResults: textToList($("adminSettingsCareResults").value),
    dealStatuses: textToList($("adminSettingsDealStatuses").value),
    systemLabels: {...DEFAULT_SETTINGS.systemLabels, ...textToObject($("adminSettingsSystemLabels").value)},
    careDueDays: Math.max(0, Number($("adminCareDueDays").value || DEFAULT_SETTINGS.careDueDays)),
    partnerTypes: settings.partnerTypes?.length ? settings.partnerTypes : DEFAULT_SETTINGS.partnerTypes,
    partnerActivities: settings.partnerActivities?.length ? settings.partnerActivities : DEFAULT_SETTINGS.partnerActivities,
    partnerLevels: settings.partnerLevels?.length ? settings.partnerLevels : DEFAULT_SETTINGS.partnerLevels,
    partnerCapacity: settings.partnerCapacity?.length ? settings.partnerCapacity : DEFAULT_SETTINGS.partnerCapacity,
    sourceConfigVersion: DEFAULT_SETTINGS.sourceConfigVersion,
    followConfigVersion: DEFAULT_SETTINGS.followConfigVersion,
    updatedByEmail: currentUser?.email || "",
    updatedAt: serverTimestamp()
  };
}

async function saveAdminCategorySettings() {
  if (!canAccessAdminPanel()) return notice("Chỉ owner/admin được lưu danh mục CRM.", true);
  const data = adminCategorySettingsData();
  if (!data.channels.length) return notice("Cần có ít nhất 1 kênh chi tiết.", true);
  if (!data.customerTypes.length) data.customerTypes = DEFAULT_SETTINGS.customerTypes;
  if (!data.potentialLevels.length) data.potentialLevels = DEFAULT_SETTINGS.potentialLevels;
  if (!data.statuses.length || !data.follows.length) return notice("Trạng thái và tình trạng chăm không được để trống.", true);
  if (!data.careChannels.length || !data.careResults.length) return notice("Hình thức chăm và kết quả chăm không được để trống.", true);
  if (!confirm("Lưu thay đổi danh mục CRM? Các dropdown mới sẽ áp dụng cho toàn bộ nhân viên.")) return;
  try {
    await saveSettingsAndVerify(data, [
      "channels", "customerTypes", "potentialLevels", "statuses", "follows",
      "careChannels", "careResults", "dealStatuses", "systemLabels", "careDueDays"
    ]);
    await logAudit("updateAdminCategorySettings", "settings", "crm", {
      channels: data.channels.length,
      customerTypes: data.customerTypes.length,
      potentialLevels: data.potentialLevels.length,
      statuses: data.statuses.length,
      follows: data.follows.length,
      careChannels: data.careChannels.length,
      careResults: data.careResults.length,
      dealStatuses: data.dealStatuses.length,
      careDueDays: data.careDueDays
    }).catch(err => notice("Đã lưu danh mục, nhưng chưa ghi được audit log: " + authMessage(err), true));
    renderAdminCategorySettingsForm();
    renderAll();
    notice("Đã lưu danh mục CRM.");
  } catch (err) {
    notice("Không lưu được danh mục CRM: " + authMessage(err), true);
  }
}

function resetAdminCategorySettingsForm() {
  renderAdminCategorySettingsForm();
  notice("Đã khôi phục form danh mục CRM.");
}

async function seedSettings() {
  if (!canAccessAdminPanel()) return notice("Chỉ owner/admin được tạo SETTINGS.", true);
  await saveSettingsAndVerify(DEFAULT_SETTINGS, Object.keys(DEFAULT_SETTINGS));
  await logAudit("seedSettings", "settings", "crm", {keys: Object.keys(DEFAULT_SETTINGS)})
    .catch(err => notice("Đã tạo SETTINGS, nhưng chưa ghi được audit log: " + authMessage(err), true));
  await loadSettings();
  notice("Đã tạo/cập nhật SETTINGS trên Supabase.");
}

async function saveCareSettings() {
  if (!canAccessAdminPanel()) return notice("Chỉ owner/admin được lưu thiết lập chăm sóc.", true);
  const days = Math.max(0, Number($("careDueDays").value || 0));
  try {
    const careSettings = {
      careDueDays: days,
      updatedByEmail: currentUser?.email || "",
      updatedAt: serverTimestamp()
    };
    await saveSettingsAndVerify(careSettings, ["careDueDays"]);
    await logAudit("updateCareSettings", "settings", "crm", {careDueDays: days})
      .catch(err => notice("Đã lưu thiết lập chăm sóc, nhưng chưa ghi được audit log: " + authMessage(err), true));
    renderAll();
    notice("Đã lưu thiết lập chăm sóc.");
  } catch (err) {
    notice("Không lưu được thiết lập chăm sóc: " + authMessage(err), true);
  }
}

function renderDropdownSettingsForm() {
  const pairs = [
    ["settingsCustomerTypes", settings.customerTypes],
    ["settingsStatuses", settings.statuses],
    ["settingsFollows", settings.follows],
    ["settingsCareChannels", settings.careChannels],
    ["settingsCareResults", settings.careResults],
    ["settingsDealStatuses", settings.dealStatuses]
  ];
  pairs.forEach(([id, values]) => {
    const el = $(id);
    if (el && document.activeElement !== el) el.value = listToText(values);
  });
  if ($("settingsSourceChannels") && document.activeElement !== $("settingsSourceChannels")) {
    $("settingsSourceChannels").value = listToText(settings.channels);
  }
  if ($("settingsSystemLabels") && document.activeElement !== $("settingsSystemLabels")) {
    $("settingsSystemLabels").value = objectToText(settings.systemLabels);
  }
}

async function saveDropdownSettings() {
  if (!canAccessAdminPanel()) return notice("Chỉ owner/admin được lưu cấu hình dropdown.", true);
  const channels = textToList($("settingsSourceChannels").value);
  const data = {
    sources: [],
    sourceChannels: {},
    channels,
    customerTypes: textToList($("settingsCustomerTypes").value),
    potentialLevels: settings.potentialLevels?.length ? settings.potentialLevels : DEFAULT_SETTINGS.potentialLevels,
    statuses: textToList($("settingsStatuses").value),
    follows: textToList($("settingsFollows").value),
    careChannels: textToList($("settingsCareChannels").value),
    careResults: textToList($("settingsCareResults").value),
    partnerTypes: settings.partnerTypes?.length ? settings.partnerTypes : DEFAULT_SETTINGS.partnerTypes,
    partnerActivities: settings.partnerActivities?.length ? settings.partnerActivities : DEFAULT_SETTINGS.partnerActivities,
    partnerLevels: settings.partnerLevels?.length ? settings.partnerLevels : DEFAULT_SETTINGS.partnerLevels,
    partnerCapacity: settings.partnerCapacity?.length ? settings.partnerCapacity : DEFAULT_SETTINGS.partnerCapacity,
    dealStatuses: textToList($("settingsDealStatuses").value),
    systemLabels: {...DEFAULT_SETTINGS.systemLabels, ...textToObject($("settingsSystemLabels").value)},
    sourceConfigVersion: DEFAULT_SETTINGS.sourceConfigVersion,
    followConfigVersion: DEFAULT_SETTINGS.followConfigVersion,
    updatedByEmail: currentUser?.email || "",
    updatedAt: serverTimestamp()
  };
  if (!data.channels.length) return notice("Cần có ít nhất 1 kênh chi tiết.", true);
  if (!data.customerTypes.length) data.customerTypes = DEFAULT_SETTINGS.customerTypes;
  if (!data.statuses.length || !data.follows.length) return notice("Trạng thái và tình trạng chăm không được để trống.", true);
  try {
    await saveSettingsAndVerify(data, [
      "channels", "customerTypes", "potentialLevels", "statuses", "follows",
      "careChannels", "careResults", "dealStatuses", "systemLabels"
    ]);
    await logAudit("updateDropdownSettings", "settings", "crm", {
      channels: data.channels.length,
      statuses: data.statuses.length,
      follows: data.follows.length,
      careChannels: data.careChannels.length,
      careResults: data.careResults.length,
      dealStatuses: data.dealStatuses.length
    }).catch(err => notice("Đã lưu dropdown, nhưng chưa ghi được audit log: " + authMessage(err), true));
    renderAll();
    notice("Đã lưu cấu hình dropdown.");
  } catch (err) {
    notice("Không lưu được dropdown: " + authMessage(err), true);
  }
}

async function syncPhoneIndex() {
  if (!isManager()) return notice("Chỉ admin/manager được đồng bộ SĐT.", true);
  const seen = new Map();
  const duplicates = [];
  customers.forEach(c => {
    const phone = phoneNorm(c.phoneNormalized || c.phoneRaw || "");
    if (!phone) return;
    if (seen.has(phone)) duplicates.push(`${c.name || c.id} (${phone})`);
    else seen.set(phone, c);
  });
  const entries = [...seen.entries()];
  for (let i = 0; i < entries.length; i += 450) {
    const batch = writeBatch(db);
    entries.slice(i, i + 450).forEach(([phone, c]) => {
      batch.set(doc(db, "phoneIndex", phone), {
        customerId: c.id,
        owner: c.owner || "",
        ownerEmail: c.ownerEmail || "",
        createdByEmail: c.createdByEmail || "",
        updatedAt: serverTimestamp()
      }, {merge:true});
    });
    await batch.commit();
  }
  try {
    await logAudit("syncPhoneIndex", "phoneIndex", "bulk", {count: entries.length, duplicates: duplicates.length});
  } catch (err) {
    notice("Đã đồng bộ SĐT, nhưng chưa ghi được audit log: " + authMessage(err), true);
  }
  notice(`Đã đồng bộ ${entries.length} SĐT.${duplicates.length ? " Có " + duplicates.length + " SĐT đang trùng cần xử lý thủ công." : ""}`, duplicates.length > 0);
}

async function syncOwnerEmail() {
  if (!isAdmin()) return notice("Chỉ admin được đồng bộ nhân viên.", true);
  const byName = new Map();
  ownerOptions().forEach(p => {
    const name = clean(p.name);
    const email = clean(p.email);
    if (name && email && email.includes("@")) byName.set(name, {name, email});
  });
  const updates = customers
    .filter(c => !c.ownerEmail && byName.has(clean(c.owner)))
    .map(c => ({customer: c, employee: byName.get(clean(c.owner))}));
  let completed = 0;
  try {
    for (const item of updates) {
      await callCrmRpc("crm_transfer_customer", {
        p_customer_id: item.customer.id,
        p_new_owner_email: item.employee.email,
        p_profile_changes: {}
      });
      completed++;
    }
    notice(`Đã đồng bộ người phụ trách cho ${completed} khách hàng qua RPC chuyển giao an toàn.`);
  } catch (err) {
    notice(`Đã đồng bộ ${completed}/${updates.length} khách. Dừng tại lỗi: ${authMessage(err)}`, true);
  }
}

function importOwnerFromRow(row) {
  const email = rowValue(row, ["Email nhân viên", "ownerEmail", "email owner", "email phụ trách"]);
  const name = rowValue(row, ["Nhân viên phụ trách", "Phụ trách", "owner", "Nhân viên"]);
  if (email) {
    const profile = ownerProfileByValue(email);
    return {name: clean(profile.name) || name || email, email};
  }
  if (name) {
    const profile = ownerProfileByValue(name);
    return {name: clean(profile.name) || name, email: clean(profile.email).includes("@") ? clean(profile.email) : ""};
  }
  return {name:"", email:""};
}

async function importCsvRows(rows) {
  let imported = 0, skipped = 0, failed = 0;
  for (const row of rows) {
    const phone = phoneNorm(rowValue(row, ["SĐT", "SDT", "Số điện thoại", "Điện thoại", "phone"]));
  const owner = importOwnerFromRow(row);
    const importedCreatedDate = parseImportDate(rowValue(row, ["Ngày tạo", "Ngày nhập", "Ngày tạo khách", "createdAt", "Created At", "Ngày lead"]));
    const importedCreatedAt = importedCreatedDate ? new Date(importedCreatedDate + "T00:00:00") : serverTimestamp();
    const customer = {
      name: rowValue(row, ["Tên khách hàng", "Khách hàng", "Tên", "name"]),
      companyName: rowValue(row, ["Tên công ty", "Công ty", "companyName", "company"]),
      phoneRaw: rowValue(row, ["SĐT", "SDT", "Số điện thoại", "Điện thoại", "phone"]),
      phoneNormalized: phone,
      address: rowValue(row, ["Địa chỉ", "address"]),
      source: rowValue(row, ["Nguồn", "source"]),
      channel: rowValue(row, ["Kênh", "Kênh chi tiết", "channel"]),
      customerType: rowValue(row, ["Phân loại KH", "Loại khách", "customerType"]),
      owner: owner.name,
      ownerEmail: owner.email,
      noPhone: !phone,
      partnerType: rowValue(row, ["Loại TK/XD", "Loại TKXD", "Loại thiết kế xây dựng", "partnerType"]),
      partnerActivity: rowValue(row, ["Hoạt động TK/XD", "Hoạt động TKXD", "partnerActivity"]),
      partnerLevel: rowValue(row, ["Level quan hệ", "Level", "partnerLevel"]),
      partnerCapacity: rowValue(row, ["Năng lực CTY", "Năng lực công ty", "partnerCapacity"]),
      need: rowValue(row, ["Nhu cầu / Sản phẩm", "Nhu cầu", "Sản phẩm", "product"]),
      note: rowValue(row, ["Ghi chú", "note"]),
      status: rowValue(row, ["Trạng thái", "status"]) || systemLabel("leadStatus"),
      follow: rowValue(row, ["Tình trạng chăm", "Follow", "follow"]) || "",
      nextCareDate: parseImportDate(rowValue(row, ["Hẹn chăm", "Ngày hẹn chăm", "nextCareDate"])),
      isDeleted: false,
      createdByEmail: currentUser.email || "",
      updatedByEmail: currentUser.email || "",
      createdAt: importedCreatedAt,
      updatedAt: serverTimestamp()
    };
    customer.follow = customer.follow || computedFollowStatus(customer);
    const dealStatus = normalizeDealStatus(rowValue(row, ["Đã cọc / Đã mua / Đã hủy", "Đã cọc / Đã mua / Rớt/Fail", "Chốt đơn", "Trạng thái đơn", "dealStatus"]));
    if (!customer.name || !customer.ownerEmail) { skipped++; continue; }
    try {
      const customerRef = doc(collection(db, "customers"));
      const completed = sameLabel(dealStatus, "boughtStatus");
      const basicPurchase = dealStatus ? {
        id: doc(collection(db, "deals")).id,
        dealStatus,
        dealDate: parseImportDate(rowValue(row, ["Ngày đơn", "Ngày mua", "dealDate"])) || todayIso(),
        deliveryDate: parseImportDate(rowValue(row, ["Ngày hẹn giao", "Hẹn giao", "deliveryDate"])),
        product: customer.need,
        amount: parseImportAmount(rowValue(row, ["Giá trị đơn", "Doanh số", "amount"])),
        note: rowValue(row, ["Ghi chú đơn hàng", "Ghi chú đơn", "dealNote"]),
        completed,
        completedAt: completed ? serverTimestamp() : null,
        customerStatus: completed ? systemLabel("boughtStatus") : systemLabel("depositStatus"),
        customerFollow: completed ? systemLabel("closedFollow") : systemLabel("activeFollow")
      } : null;
      await callCrmRpc("crm_import_customer", {
        p_customer: {...customer, id: customerRef.id},
        p_basic_purchase: basicPurchase
      });
      imported++;
    } catch (err) {
      if (duplicateCustomerIdFromError(err)) skipped++;
      else failed++;
    }
  }
  notice(`Import xong: ${imported} dòng. Bỏ qua/trùng: ${skipped}. Lỗi: ${failed}.`, failed > 0);
}

async function handleImportFile(event) {
  if (!isAdmin()) return notice("Chỉ admin được import dữ liệu.", true);
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  const text = await file.text();
  const rows = parseCsv(text);
  if (!rows.length) return notice("File CSV không có dữ liệu.", true);
  const ok = confirm(`Import ${rows.length} dòng từ file "${file.name}"? Dòng trùng SĐT hoặc thiếu ownerEmail sẽ được bỏ qua.`);
  if (!ok) return;
  await importCsvRows(rows);
}

function productLabel(p) {
  return [p.code, p.name, p.size].filter(Boolean).join(" - ");
}

function productByAnyValue(value) {
  const key = normalizeKey(value);
  if (!key) return null;
  return products.find(item =>
    normalizeKey(productLabel(item)) === key ||
    normalizeKey(item.id) === key ||
    normalizeKey(item.code) === key ||
    normalizeKey(item.name) === key
  ) || null;
}

function productSearchText(p) {
  return normalizeKey([p.code, p.name, p.size, p.surface, p.origin, p.color, p.description, p.priceText || p.price].join(" "));
}

function parseProductPrice(value) {
  const raw = clean(value);
  const normalized = raw.replace(/[^\d]/g, "");
  return {
    price: Number(normalized || 0),
    priceText: raw
  };
}

function productFromRow(row) {
  const priceData = parseProductPrice(rowValue(row, ["PRICE", "Giá", "Đơn giá", "price"]));
  const product = {
    code: rowValue(row, ["CODE", "Mã", "Mã SP", "SKU", "code"]),
    name: rowValue(row, ["NAME", "Tên", "Tên sản phẩm", "Sản phẩm", "name"]),
    size: rowValue(row, ["SIZE", "Kích thước", "size"]),
    surface: rowValue(row, ["SURFACE", "Bề mặt", "surface"]),
    origin: rowValue(row, ["ORIGIN", "Xuất xứ", "origin"]),
    color: rowValue(row, ["COLOR", "Màu", "color"]),
    price: priceData.price,
    priceText: priceData.priceText,
    description: rowValue(row, ["DESCRIPTION", "Mô tả", "Loại", "description"]),
    isDeleted: false,
    updatedByEmail: currentUser?.email || "",
    updatedAt: serverTimestamp()
  };
  product.searchText = productSearchText(product);
  return product;
}

function productKey(p) {
  return normalizeKey(p.code) || normalizeKey([p.name, p.size, p.surface, p.origin].join("|"));
}

async function importProductRows(rows) {
  if (!isManager()) return notice("Chỉ admin/manager được import sản phẩm.", true);
  const existing = new Map(products.map(p => [productKey(p), p]));
  const pending = new Map();
  rows.map(productFromRow).filter(p => p.name || p.code).forEach(p => pending.set(productKey(p), p));
  const items = [...pending.values()];
  if (!items.length) return notice("File CSV không có sản phẩm hợp lệ.", true);
  let imported = 0;
  for (let i = 0; i < items.length; i += 420) {
    const batch = writeBatch(db);
    items.slice(i, i + 420).forEach(p => {
      const old = existing.get(productKey(p));
      const ref = old?.id ? doc(db, "products", old.id) : doc(collection(db, "products"));
      batch.set(ref, {
        ...p,
        createdByEmail: old?.createdByEmail || currentUser?.email || "",
        createdAt: old?.createdAt || serverTimestamp()
      }, {merge:true});
      imported++;
    });
    batch.set(doc(collection(db, "auditLogs")), {
      action: "importProductsCsv", entity: "products", entityId: "bulk",
      email: currentUser?.email || "", payloadJson: JSON.stringify({count:items.slice(i, i + 420).length}), createdAt: serverTimestamp()
    });
    await batch.commit();
  }
  notice(`Đã import/cập nhật ${imported} sản phẩm.`);
}

async function handleImportProductsFile(event) {
  if (!isManager()) return notice("Chỉ admin/manager được import sản phẩm.", true);
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  const rows = parseCsv(await file.text());
  if (!rows.length) return notice("File CSV không có dữ liệu.", true);
  const ok = confirm(`Import ${rows.length} dòng sản phẩm từ file "${file.name}"? Dòng trùng CODE sẽ được cập nhật.`);
  if (!ok) return;
  await importProductRows(rows);
}

function hydrateProductFilters() {
  if (!$("productFilterSize")) return;
  fillSelect("productFilterSize", uniq(products.map(p => p.size)).sort(), "", "Tất cả size");
  fillSelect("productFilterSurface", uniq(products.map(p => p.surface)).sort(), "", "Tất cả bề mặt");
  fillSelect("productFilterOrigin", uniq(products.map(p => p.origin)).sort(), "", "Tất cả xuất xứ");
}

function visibleProducts() {
  const q = normalizeKey($("productSearchBox")?.value);
  const size = clean($("productFilterSize")?.value);
  const surface = clean($("productFilterSurface")?.value);
  const origin = clean($("productFilterOrigin")?.value);
  return products.filter(p => {
    if (q && !productSearchText(p).includes(q)) return false;
    if (size && clean(p.size) !== size) return false;
    if (surface && clean(p.surface) !== surface) return false;
    if (origin && clean(p.origin) !== origin) return false;
    return true;
  });
}

function renderProductOptions() {
  const el = $("productOptions");
  if (!el) return;
  el.innerHTML = products.map(p => `<option value="${esc(productLabel(p))}">${esc([p.surface, p.origin, p.priceText || money(p.price || 0)].filter(Boolean).join(" · "))}</option>`).join("");
}

function productSku(p) {
  return clean(p?.code || p?.sku);
}

function productInventoryQty(product) {
  const cacheKey = clean(product?.id) || normalizeKey([productSku(product), product?.name].join("|"));
  if (cacheKey && inventoryQtyCache.has(cacheKey)) return inventoryQtyCache.get(cacheKey);
  const keys = new Set([
    clean(product?.id),
    normalizeKey(productSku(product)),
    normalizeKey(product?.name)
  ].filter(Boolean));
  const qty = inventoryMovements.reduce((sum,m) => {
    const movementKeys = [
      clean(m.productId),
      normalizeKey(m.productSku),
      normalizeKey(m.productName)
    ].filter(Boolean);
    return movementKeys.some(k => keys.has(k)) ? sum + Number(m.qty || 0) : sum;
  }, 0);
  if (cacheKey) inventoryQtyCache.set(cacheKey, qty);
  return qty;
}

function inventoryTypeLabel(type) {
  return {in:"Nhập kho", out:"Xuất kho", return:"Hoàn kho", adjustment:"Điều chỉnh", delivery:"Giao hàng", delivery_return:"Hoàn giao"}[clean(type)] || clean(type) || "Điều chỉnh";
}

function inventorySignedQty(type, qty) {
  const value = Number(qty || 0);
  if (clean(type) === "out") return -Math.abs(value);
  if (clean(type) === "in" || clean(type) === "return") return Math.abs(value);
  return value;
}

function hydrateInventoryProductOptions() {
  const el = $("inventoryProduct");
  if (!el) return;
  const current = el.value;
  el.innerHTML = `<option value="">-- Chọn sản phẩm --</option>` + products.map(p => {
    const stock = productInventoryQty(p);
    return `<option value="${esc(p.id)}">${esc([productSku(p), p.name, `Tồn ${stock}`].filter(Boolean).join(" · "))}</option>`;
  }).join("");
  if (products.some(p => p.id === current)) el.value = current;
}

function clearInventoryForm() {
  if (!$("inventoryProduct")) return;
  $("inventoryProduct").value = "";
  $("inventoryType").value = "in";
  $("inventoryQty").value = "";
  $("inventoryWarehouse").value = "main";
  $("inventoryRefType").value = "";
  $("inventoryRefId").value = "";
  $("inventoryNote").value = "";
}

function selectInventoryProduct(productId, type = "in") {
  if (!$("inventoryProduct")) return;
  hydrateInventoryProductOptions();
  $("inventoryProduct").value = productId || "";
  $("inventoryType").value = type;
  $("inventoryQty").value = "";
  $("inventoryNote").focus();
  $("inventoryProduct").scrollIntoView({behavior:"smooth", block:"center"});
}

function renderInventory() {
  if (!$("inventoryRows")) return;
  $("inventoryFormPanel")?.classList.toggle("hide", !isManager());
  hydrateInventoryProductOptions();
  const visible = visibleProducts();
  const totalStock = visible.reduce((sum,p) => sum + productInventoryQty(p), 0);
  const inStock = visible.filter(p => productInventoryQty(p) > 0).length;
  const zeroStock = visible.filter(p => productInventoryQty(p) === 0).length;
  const negativeStock = visible.filter(p => productInventoryQty(p) < 0).length;
  $("inventorySummaryGrid").innerHTML = [
    ["Sản phẩm đang lọc", visible.length, ""],
    ["Có tồn", inStock, ""],
    ["Hết tồn", zeroStock, zeroStock ? "warn" : ""],
    ["Âm kho", negativeStock, negativeStock ? "bad" : ""],
    ["Tổng tồn", totalStock, ""]
  ].map(([label,value,cls]) => `
    <div class="executive-card inventory-card ${esc(cls)}">
      <span class="muted">${esc(label)}</span>
      <b>${esc(value)}</b>
    </div>
  `).join("");
  const rows = inventoryMovements.slice(0, 100);
  $("inventoryRows").innerHTML = rows.length ? rows.map(m => {
    const qty = Number(m.qty || 0);
    const qtyClass = qty < 0 ? "red" : "green";
    return `
      <tr>
        <td>${esc(fmtDate(m.createdAt) || "")}</td>
        <td><b>${esc(m.productName || "Không tên")}</b><div class="muted">${esc(m.productSku || "")}</div></td>
        <td><span class="pill ${qtyClass}">${esc(inventoryTypeLabel(m.movementType))}</span></td>
        <td><b class="money-cell ${qty < 0 ? "debt-positive" : "paid-positive"}">${esc(qty)}</b> ${esc(m.unit || "")}</td>
        <td>${esc(m.warehouse || "main")}</td>
        <td>${esc([m.refType, m.refId].filter(Boolean).join(" · "))}</td>
        <td>${esc(m.createdByEmail || "")}</td>
        <td>${esc(m.note || "")}</td>
        <td>${isAdmin() ? `<button class="small danger" type="button" data-delete-inventory="${esc(m.id)}">Xóa mềm</button>` : ""}</td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="9" class="muted">Chưa có phiếu nhập/xuất kho.</td></tr>`;
}

async function saveInventoryMovement() {
  if (!isManager()) return notice("Chỉ admin/manager được nhập/xuất kho.", true);
  const productId = clean($("inventoryProduct")?.value);
  const p = products.find(item => item.id === productId);
  if (!p) return notice("Hãy chọn sản phẩm cần nhập/xuất kho.", true);
  const rawQty = Number($("inventoryQty")?.value || 0);
  if (!Number.isFinite(rawQty) || rawQty === 0) return notice("Số lượng phải khác 0.", true);
  const movementType = clean($("inventoryType")?.value) || "adjustment";
  const qty = inventorySignedQty(movementType, rawQty);
  const id = doc(collection(db, "inventoryMovements")).id;
  const payload = {
    productId: p.id,
    productSku: productSku(p),
    productName: p.name || productSku(p),
    movementType,
    qty,
    unit: p.unit || p.size || "",
    refType: clean($("inventoryRefType")?.value),
    refId: clean($("inventoryRefId")?.value),
    warehouse: clean($("inventoryWarehouse")?.value) || "main",
    note: clean($("inventoryNote")?.value),
    isDeleted: false,
    createdByEmail: ownerEmail(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(doc(db, "inventoryMovements", id), payload);
  await logAudit("createInventoryMovement", "inventoryMovements", id, {
    productId: p.id,
    productSku: productSku(p),
    movementType,
    qty
  }).catch(() => {});
  clearInventoryForm();
  renderProducts();
  notice("Đã lưu phiếu kho.");
}

async function softDeleteInventoryMovement(id) {
  if (!isAdmin()) return notice("Chỉ admin được xóa phiếu kho.", true);
  const m = allInventoryMovements.find(item => item.id === id) || inventoryMovements.find(item => item.id === id);
  if (!m) return;
  if (!confirm("Xóa mềm phiếu kho này? Tồn kho sẽ được tính lại.")) return;
  await setDoc(doc(db, "inventoryMovements", id), {
    ...m,
    isDeleted: true,
    deletedAt: serverTimestamp(),
    deletedByEmail: ownerEmail(),
    updatedAt: serverTimestamp()
  }, {merge:true});
  await logAudit("softDeleteInventoryMovement", "inventoryMovements", id, {
    productId: m.productId || "",
    qty: m.qty || 0
  }).catch(() => {});
  notice("Đã xóa mềm phiếu kho.");
}

function renderProducts() {
  if (!$("productsPanel")) return;
  $("importProductsBtn")?.classList.toggle("hide", !isManager());
  hydrateProductFilters();
  renderProductOptions();
  renderInventory();
  const rows = visibleProducts();
  const page = pageRows("products", rows);
  $("productRows").innerHTML = page.length ? page.map(p => {
    const readonly = isManager() ? "" : "disabled";
    const stock = productInventoryQty(p);
    const stockClass = stock < 0 ? "red" : stock === 0 ? "orange" : "green";
    const action = isManager()
      ? `<div class="actions"><button class="small primary" type="button" data-save-product="${esc(p.id)}">Lưu</button><button class="small" type="button" data-inventory-product="${esc(p.id)}">Nhập/Xuất</button>${isAdmin() ? `<button class="small danger" type="button" data-delete-product="${esc(p.id)}">Xóa</button>` : ""}</div>`
      : `<span class="muted">Chỉ xem</span>`;
    return `
      <tr>
        <td><input data-product-code="${esc(p.id)}" value="${esc(p.code || "")}" ${readonly}></td>
        <td><input data-product-name="${esc(p.id)}" value="${esc(p.name || "")}" ${readonly}></td>
        <td><input data-product-size="${esc(p.id)}" value="${esc(p.size || "")}" ${readonly}></td>
        <td><input data-product-surface="${esc(p.id)}" value="${esc(p.surface || "")}" ${readonly}></td>
        <td><input data-product-origin="${esc(p.id)}" value="${esc(p.origin || "")}" ${readonly}></td>
        <td><input data-product-color="${esc(p.id)}" value="${esc(p.color || "")}" ${readonly}></td>
        <td><input data-product-price="${esc(p.id)}" value="${esc(p.priceText || (p.price ? money(p.price) : ""))}" ${readonly}></td>
        <td><span class="pill ${stockClass}">${esc(stock)}</span></td>
        <td><input data-product-description="${esc(p.id)}" value="${esc(p.description || "")}" ${readonly}></td>
        <td>${action}</td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="10" class="muted">Chưa có sản phẩm phù hợp. Manager/admin có thể import CSV từ Google Sheet PRODUCTS.</td></tr>`;
  renderPager("productPager", "products", rows.length, "sản phẩm");
}

function productInputValue(row, field) {
  return clean(row.querySelector(`[data-product-${field}]`)?.value);
}

async function saveProduct(productId) {
  if (!isManager()) return notice("Chỉ admin/manager được sửa sản phẩm.", true);
  const row = document.querySelector(`[data-product-name="${CSS.escape(productId)}"]`)?.closest("tr");
  if (!row) return;
  const priceData = parseProductPrice(productInputValue(row, "price"));
  const data = {
    code: productInputValue(row, "code"),
    name: productInputValue(row, "name"),
    size: productInputValue(row, "size"),
    surface: productInputValue(row, "surface"),
    origin: productInputValue(row, "origin"),
    color: productInputValue(row, "color"),
    price: priceData.price,
    priceText: priceData.priceText,
    description: productInputValue(row, "description"),
    isDeleted: false,
    updatedByEmail: currentUser?.email || "",
    updatedAt: serverTimestamp()
  };
  if (!data.name && !data.code) return notice("Sản phẩm cần có tên hoặc code.", true);
  data.searchText = productSearchText(data);
  try {
    await setDoc(doc(db, "products", productId), data, {merge:true});
    await setDoc(doc(collection(db, "auditLogs")), {
      action: "updateProduct", entity: "products", entityId: productId,
      email: currentUser?.email || "", payloadJson: JSON.stringify(data), createdAt: serverTimestamp()
    });
    notice("Đã lưu sản phẩm.");
  } catch (err) {
    notice("Không lưu được sản phẩm: " + authMessage(err), true);
  }
}

async function deleteProduct(productId) {
  if (!isAdmin()) return notice("Chỉ admin được ẩn sản phẩm.", true);
  const p = products.find(x => x.id === productId);
  if (!p) return;
  if (!confirm(`Ẩn sản phẩm "${p.name || p.code}" khỏi danh mục?`)) return;
  try {
    await setDoc(doc(db, "products", productId), {
      isDeleted: true,
      deletedAt: serverTimestamp(),
      deletedByEmail: currentUser?.email || "",
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser?.email || ""
    }, {merge:true});
    await setDoc(doc(collection(db, "auditLogs")), {
      action: "deleteProduct", entity: "products", entityId: productId,
      email: currentUser?.email || "", payloadJson: JSON.stringify({name:p.name, code:p.code}), createdAt: serverTimestamp()
    });
    notice("Đã ẩn sản phẩm.");
  } catch (err) {
    notice("Không xóa được sản phẩm: " + authMessage(err), true);
  }
}

const quoteStatusOptions = [
  {value:"draft", label:"Nháp"},
  {value:"sent", label:"Đã gửi"},
  {value:"accepted", label:"Khách đồng ý"},
  {value:"rejected", label:"Từ chối"},
  {value:"converted", label:"Đã chuyển đơn"}
];

function quoteStatusLabel(value) {
  const key = clean(value) || "draft";
  return quoteStatusOptions.find(s => s.value === key)?.label || key;
}

function quoteStatusClass(value) {
  const key = clean(value) || "draft";
  if (key === "accepted" || key === "converted") return "green";
  if (key === "rejected") return "red";
  if (key === "sent") return "orange";
  return "";
}

function quoteItemsForQuote(quoteId) {
  return quoteItems.filter(item => item.quoteId === quoteId).sort((a,b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
}

function quoteNo() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `BG-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function hydrateQuoteSelects() {
  if (!$("quoteCustomer")) return;
  const currentCustomer = $("quoteCustomer").value;
  const customerOptions = customers
    .filter(canSeeCustomer)
    .sort((a,b) => clean(a.name).localeCompare(clean(b.name), "vi"))
    .map(c => ({value:c.id, label:[c.name || "Không tên", c.phoneRaw || c.phoneNormalized, c.companyName].filter(Boolean).join(" · ")}));
  fillSelect("quoteCustomer", customerOptions, "-- Chọn khách hàng --");
  if (customerOptions.some(o => o.value === currentCustomer)) $("quoteCustomer").value = currentCustomer;
  fillSelect("quoteStatus", quoteStatusOptions, "");
  fillSelect("quoteFilterStatus", quoteStatusOptions, "", "Tất cả trạng thái");
  fillSelect("quoteFilterOwner", ownerOptions(), "", "Tất cả nhân viên");
  if (!isManager()) {
    $("quoteFilterOwner").value = ownerEmail();
    $("quoteFilterOwner").disabled = true;
  } else {
    $("quoteFilterOwner").disabled = false;
  }
}

function quoteItemTemplate(item={}) {
  const product = item.productId ? productByAnyValue(item.productId) : productByAnyValue(item.productName || item.productSku || item.product || "");
  const productText = item.productLabel || item.productName || item.product || (product ? productLabel(product) : "");
  const unitPrice = Number(item.unitPrice ?? item.price ?? product?.price ?? 0);
  return `<div class="quote-item-row" data-quote-item>
    <input type="hidden" data-quote-product-id value="${esc(item.productId || product?.id || "")}">
    <div class="field"><label>Sản phẩm</label><input data-quote-product list="productOptions" value="${esc(productText)}" placeholder="Gõ tên/mã sản phẩm"></div>
    <div class="field"><label>SL</label><input data-quote-qty type="number" min="0" step="0.01" value="${esc(item.qty || 1)}"></div>
    <div class="field"><label>Đơn giá</label><input data-quote-price type="number" min="0" step="1000" value="${esc(unitPrice || 0)}"></div>
    <div class="field"><label>Chiết khấu</label><input data-quote-discount type="number" min="0" step="1000" value="${esc(item.discountAmount || 0)}"></div>
    <div class="field"><label>Thành tiền</label><input data-quote-line-total value="${esc(money(Number(item.lineTotal || 0)))}" disabled></div>
    <button class="small" type="button" data-remove-quote-item>Xóa</button>
  </div>`;
}

function addQuoteItem(item={}) {
  $("quoteItems").insertAdjacentHTML("beforeend", quoteItemTemplate(item));
  updateQuoteTotals();
}

function clearQuoteForm() {
  editingQuoteId = "";
  $("quoteFormTitle").textContent = "Tạo báo giá";
  $("saveQuoteBtn").textContent = "Lưu báo giá";
  $("cancelEditQuoteBtn").classList.add("hide");
  $("quoteCustomer").value = "";
  $("quoteStatus").value = "draft";
  $("quoteDate").value = todayIso();
  $("quoteValidUntil").value = "";
  $("quoteNote").value = "";
  $("quoteItems").innerHTML = "";
  addQuoteItem();
  updateQuoteTotals();
}

function collectQuoteItems() {
  return [...document.querySelectorAll("[data-quote-item]")].map((row, index) => {
    const productValue = clean(row.querySelector("[data-quote-product]").value);
    const selected = productByAnyValue(clean(row.querySelector("[data-quote-product-id]").value) || productValue);
    const qty = Number(row.querySelector("[data-quote-qty]").value || 0);
    const unitPrice = Number(row.querySelector("[data-quote-price]").value || selected?.price || 0);
    const discountAmount = Number(row.querySelector("[data-quote-discount]").value || 0);
    const lineTotal = Math.max(0, qty * unitPrice - discountAmount);
    return {
      productId: selected?.id || clean(row.querySelector("[data-quote-product-id]").value),
      productSku: selected?.code || selected?.sku || "",
      productName: selected?.name || productValue,
      productLabel: selected ? productLabel(selected) : productValue,
      unit: selected?.unit || selected?.size || "",
      qty,
      unitPrice,
      discountAmount,
      lineTotal,
      sortOrder: index
    };
  }).filter(item => item.productName || item.productSku);
}

function quoteTotals(items = collectQuoteItems()) {
  return {
    subtotal: items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0), 0),
    discountAmount: items.reduce((sum, item) => sum + Number(item.discountAmount || 0), 0),
    totalAmount: items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0)
  };
}

function updateQuoteTotals() {
  const items = collectQuoteItems();
  document.querySelectorAll("[data-quote-item]").forEach(row => {
    const qty = Number(row.querySelector("[data-quote-qty]")?.value || 0);
    const unitPrice = Number(row.querySelector("[data-quote-price]")?.value || 0);
    const discountAmount = Number(row.querySelector("[data-quote-discount]")?.value || 0);
    const line = row.querySelector("[data-quote-line-total]");
    if (line) line.value = money(Math.max(0, qty * unitPrice - discountAmount));
  });
  const totals = quoteTotals(items);
  $("quoteSubtotal").textContent = money(totals.subtotal);
  $("quoteDiscountTotal").textContent = money(totals.discountAmount);
  $("quoteTotalAmount").textContent = money(totals.totalAmount);
}

function applyProductToQuoteInput(input) {
  const row = input.closest("[data-quote-item]");
  if (!row) return;
  const p = productByAnyValue(input.value);
  if (!p) {
    row.querySelector("[data-quote-product-id]").value = "";
    updateQuoteTotals();
    return;
  }
  input.value = productLabel(p);
  row.querySelector("[data-quote-product-id]").value = p.id || "";
  row.querySelector("[data-quote-price]").value = Number(p.price || 0);
  updateQuoteTotals();
}

function visibleQuotes() {
  const q = normalizeKey($("quoteSearchBox")?.value || "");
  const owner = clean($("quoteFilterOwner")?.value);
  const status = clean($("quoteFilterStatus")?.value);
  return quotes
    .filter(item => isManager() || sameIdentity(item.ownerEmail, ownerEmail()) || sameIdentity(item.createdByEmail, ownerEmail()))
    .filter(item => {
      if (owner && !sameIdentity(item.ownerEmail, owner) && !sameIdentity(item.owner, owner)) return false;
      if (status && clean(item.status) !== status) return false;
      if (!q) return true;
      return normalizeKey([item.quoteNo, item.customerName, item.customerPhone, item.customerCompanyName, item.owner, item.ownerEmail, item.status, item.note].join(" ")).includes(q);
    })
    .sort((a,b) => String(b.quoteDate || b.createdAt || "").localeCompare(String(a.quoteDate || a.createdAt || "")) || byDateDesc(a,b));
}

function renderQuotes() {
  if (!$("quotesPanel")) return;
  hydrateQuoteSelects();
  if (!$("quoteItems").children.length) clearQuoteForm();
  const rows = visibleQuotes();
  $("quoteRows").innerHTML = rows.length ? rows.map(q => {
    const items = quoteItemsForQuote(q.id);
    return `<tr>
      <td><b>${esc(q.quoteNo || q.id)}</b><br><small>${esc(items.length)} dòng SP</small></td>
      <td><b>${esc(q.customerName || "Khách hàng")}</b>${q.customerCompanyName ? `<br><small>${esc(q.customerCompanyName)}</small>` : ""}<br><small>${esc(q.customerPhone || "")}</small></td>
      <td>${esc(q.owner || q.ownerEmail || "")}</td>
      <td><span class="pill ${quoteStatusClass(q.status)}">${esc(quoteStatusLabel(q.status))}</span></td>
      <td>${esc(fmtDate(q.quoteDate || q.createdAt))}</td>
      <td>${esc(fmtDate(q.validUntil))}</td>
      <td><b>${esc(money(q.totalAmount || 0))}</b></td>
      <td>${esc(q.note || "")}</td>
      <td><div class="row-actions">
        <button class="small primary" type="button" data-open-quote="${esc(q.id)}">Chi tiết</button>
        ${q.convertedDealId ? `<button class="small" type="button" data-review-deal="${esc(q.convertedDealId)}">Mở đơn</button>` : `<button class="small primary" type="button" data-convert-quote="${esc(q.id)}">Chuyển đơn</button>`}
        <button class="small" type="button" data-edit-quote="${esc(q.id)}">Sửa</button>
        <button class="small danger" type="button" data-delete-quote="${esc(q.id)}">Xóa mềm</button>
      </div></td>
    </tr>`;
  }).join("") : `<tr><td colspan="9" class="muted">Không có báo giá phù hợp.</td></tr>`;
}

async function saveQuote() {
  const c = customers.find(item => item.id === clean($("quoteCustomer").value));
  if (!c || !canEditCustomer(c)) return notice("Vui lòng chọn khách hàng bạn có quyền báo giá.", true);
  const items = collectQuoteItems();
  if (!items.length) return notice("Vui lòng thêm ít nhất 1 sản phẩm báo giá.", true);
  const totals = quoteTotals(items);
  const oldQuote = editingQuoteId ? quotes.find(q => q.id === editingQuoteId) : null;
  const status = clean($("quoteStatus").value) || "draft";
  const quoteId = editingQuoteId || doc(collection(db, "quotes")).id;
  const quote = {
    quoteNo: oldQuote?.quoteNo || quoteNo(),
    customerId: c.id,
    customerName: c.name || "",
    customerPhone: c.phoneRaw || c.phoneNormalized || "",
    customerCompanyName: c.companyName || "",
    owner: customerOwnerName(c),
    ownerEmail: customerOwnerKey(c),
    createdByEmail: oldQuote?.createdByEmail || currentUser?.email || "",
    status,
    quoteDate: clean($("quoteDate").value) || todayIso(),
    validUntil: clean($("quoteValidUntil").value),
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    totalAmount: totals.totalAmount,
    note: clean($("quoteNote").value),
    sentAt: status === "sent" && oldQuote?.status !== "sent" ? serverTimestamp() : oldQuote?.sentAt || null,
    acceptedAt: status === "accepted" && oldQuote?.status !== "accepted" ? serverTimestamp() : oldQuote?.acceptedAt || null,
    rejectedAt: status === "rejected" && oldQuote?.status !== "rejected" ? serverTimestamp() : oldQuote?.rejectedAt || null,
    isDeleted: false,
    updatedAt: serverTimestamp()
  };
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "quotes", quoteId), quote, {merge:true});
    quoteItemsForQuote(quoteId).forEach(item => batch.delete(doc(db, "quoteItems", item.id)));
    items.forEach((item, index) => batch.set(doc(collection(db, "quoteItems")), {...item, quoteId, sortOrder:index, createdAt:serverTimestamp(), updatedAt:serverTimestamp()}));
    batch.set(doc(collection(db, "auditLogs")), {
      action: editingQuoteId ? "updateQuote" : "createQuote",
      entity: "quotes",
      entityId: quoteId,
      email: currentUser?.email || "",
      payloadJson: JSON.stringify({quoteNo: quote.quoteNo, customerName: quote.customerName, totalAmount: quote.totalAmount, items: items.length}),
      createdAt: serverTimestamp()
    });
    await batch.commit();
    notice(editingQuoteId ? "Đã cập nhật báo giá." : "Đã tạo báo giá.");
    clearQuoteForm();
    renderQuotes();
  } catch (err) {
    notice("Không lưu được báo giá: " + authMessage(err), true);
  }
}

function editQuote(quoteId) {
  const q = quotes.find(item => item.id === quoteId);
  if (!q) return notice("Không tìm thấy báo giá.", true);
  editingQuoteId = quoteId;
  $("quoteFormTitle").textContent = `Sửa báo giá ${q.quoteNo || ""}`;
  $("saveQuoteBtn").textContent = "Cập nhật báo giá";
  $("cancelEditQuoteBtn").classList.remove("hide");
  $("quoteCustomer").value = q.customerId || "";
  $("quoteStatus").value = q.status || "draft";
  $("quoteDate").value = dateInputValue(q.quoteDate || q.createdAt);
  $("quoteValidUntil").value = dateInputValue(q.validUntil);
  $("quoteNote").value = q.note || "";
  $("quoteItems").innerHTML = "";
  const items = quoteItemsForQuote(quoteId);
  (items.length ? items : [{}]).forEach(addQuoteItem);
  updateQuoteTotals();
  $("quotesPanel")?.scrollIntoView({behavior:"smooth", block:"start"});
}

function openQuoteDetail(quoteId) {
  const q = quotes.find(item => item.id === quoteId);
  if (!q) return notice("Không tìm thấy báo giá.", true);
  const items = quoteItemsForQuote(quoteId);
  openDetailModal(
    `Báo giá ${q.quoteNo || ""}`,
    `${q.customerName || "Khách hàng"} · ${quoteStatusLabel(q.status)}`,
    `<div class="detail-list">
      <div class="detail-row">
        <div class="detail-meta">
          <span>Ngày: ${esc(fmtDate(q.quoteDate || q.createdAt))}</span>
          <span>Hiệu lực: ${esc(fmtDate(q.validUntil) || "Chưa đặt")}</span>
          <span>Phụ trách: ${esc(q.owner || q.ownerEmail || "")}</span>
        </div>
        ${q.customerCompanyName ? `<div>Công ty: ${esc(q.customerCompanyName)}</div>` : ""}
        <div>SĐT: ${esc(q.customerPhone || "")}</div>
        ${q.note ? `<div class="detail-note">${esc(q.note)}</div>` : ""}
      </div>
      ${items.map(item => `<div class="detail-row">
        <b>${esc(item.productName || item.productSku || "Sản phẩm")}</b>
        <div class="detail-meta">
          <span>SL: ${esc(item.qty || 0)}</span>
          <span>Đơn giá: ${esc(money(item.unitPrice || 0))}</span>
          <span>CK: ${esc(money(item.discountAmount || 0))}</span>
          <span>Thành tiền: ${esc(money(item.lineTotal || 0))}</span>
        </div>
      </div>`).join("") || `<div class="muted">Chưa có dòng sản phẩm.</div>`}
      <div class="detail-row"><b>Tổng báo giá: ${esc(money(q.totalAmount || 0))}</b></div>
    </div>`
  );
}

async function softDeleteQuote(quoteId) {
  const q = quotes.find(item => item.id === quoteId);
  if (!q) return notice("Không tìm thấy báo giá.", true);
  if (!confirm(`Xóa mềm báo giá ${q.quoteNo || q.id}? Dữ liệu vẫn giữ trong hệ thống.`)) return;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "quotes", quoteId), {
      isDeleted: true,
      deletedAt: serverTimestamp(),
      deletedByEmail: currentUser?.email || "",
      updatedAt: serverTimestamp()
    }, {merge:true});
    batch.set(doc(collection(db, "auditLogs")), {
      action: "deleteQuote", entity: "quotes", entityId: quoteId, email: currentUser?.email || "",
      payloadJson: JSON.stringify({quoteNo: q.quoteNo || "", customerName: q.customerName || ""}), createdAt: serverTimestamp()
    });
    await batch.commit();
    notice("Đã xóa mềm báo giá.");
  } catch (err) {
    notice("Không xóa được báo giá: " + authMessage(err), true);
  }
}

function quoteOrderItems(q, items) {
  return items.map((item, index) => ({
    customerId: q.customerId || "",
    productId: item.productId || "",
    productSku: item.productSku || "",
    productName: item.productName || item.productLabel || "",
    product: item.productName || item.productLabel || "",
    productLabel: item.productLabel || item.productName || "",
    code: item.productSku || "",
    unit: item.unit || "",
    qty: Number(item.qty || 0),
    unitPrice: Number(item.unitPrice || 0),
    price: Number(item.unitPrice || 0),
    discountAmount: Number(item.discountAmount || 0),
    lineTotal: Number(item.lineTotal || 0),
    sortOrder: index,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));
}

async function convertQuoteToDeal(quoteId) {
  const q = quotes.find(item => item.id === quoteId);
  if (!q) return notice("Không tìm thấy báo giá.", true);
  if (q.convertedDealId) return notice("Báo giá này đã được chuyển thành đơn hàng.", true);
  const c = customerById(q.customerId);
  if (!c?.id || !canEditCustomer(c)) return notice("Không tìm thấy khách hàng hoặc bạn không có quyền tạo đơn.", true);
  const items = quoteItemsForQuote(quoteId);
  if (!items.length) return notice("Báo giá chưa có dòng sản phẩm để chuyển đơn.", true);
  if (!confirm(`Chuyển báo giá ${q.quoteNo || q.id} thành đơn hàng đang xử lý?`)) return;

  const dealRef = doc(collection(db, "deals"));
  const orderRows = quoteOrderItems(q, items);
  const productSummary = orderRows
    .map(item => [item.productName || item.product, item.productSku ? `(${item.productSku})` : "", item.unit].filter(Boolean).join(" "))
    .join("; ");
  const deal = {
    customerId: c.id,
    customerName: c.name || q.customerName || "",
    phoneNormalized: c.phoneNormalized || "",
    phoneRaw: c.phoneRaw || q.customerPhone || "",
    source: c.source || "",
    channel: c.channel || "",
    owner: q.owner || customerOwnerName(c),
    ownerEmail: q.ownerEmail || customerOwnerKey(c),
    dealStatus: "Đang xử lý",
    orderCustomerName: q.customerName || c.name || "",
    orderPhone: q.customerPhone || c.phoneRaw || c.phoneNormalized || "",
    dealDate: todayIso(),
    items: orderRows,
    product: productSummary,
    amount: Number(q.totalAmount || 0),
    revenue: 0,
    depositPercent: 0,
    completed: false,
    completedAt: null,
    canceled: false,
    canceledAt: null,
    quoteId,
    quoteNo: q.quoteNo || "",
    note: [`Chuyển từ báo giá ${q.quoteNo || q.id}`, q.note || ""].filter(Boolean).join("\n"),
    isDeleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  try {
    const batch = writeBatch(db);
    batch.set(dealRef, deal);
    orderRows.forEach((item, index) => batch.set(doc(collection(db, "orderItems")), {
      ...item,
      dealId: dealRef.id,
      customerId: c.id,
      sortOrder: index
    }));
    batch.set(doc(db, "quotes", quoteId), {
      status: "converted",
      convertedDealId: dealRef.id,
      convertedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, {merge:true});
    batch.set(doc(collection(db, "auditLogs")), {
      action: "convertQuoteToDeal",
      entity: "quotes",
      entityId: quoteId,
      email: currentUser?.email || "",
      payloadJson: JSON.stringify({quoteNo: q.quoteNo || "", dealId: dealRef.id, totalAmount: q.totalAmount || 0, items: orderRows.length}),
      createdAt: serverTimestamp()
    });
    await batch.commit();
    notice("Đã chuyển báo giá thành đơn hàng đang xử lý.");
    renderQuotes();
    renderOrders();
  } catch (err) {
    notice("Không chuyển được báo giá thành đơn: " + authMessage(err), true);
  }
}

function resetQuoteFilters() {
  $("quoteSearchBox").value = "";
  $("quoteFilterStatus").value = "";
  $("quoteFilterOwner").value = isManager() ? "" : ownerEmail();
  renderQuotes();
}

function exportQuotes() {
  if (!canExportData()) return notice("Bạn chưa có quyền xuất file.", true);
  const rows = visibleQuotes();
  if (!rows.length) return notice("Không có báo giá phù hợp để xuất.", true);
  exportXlsx([{
    name:"Bao gia",
    rows:[
      ["Mã BG","Khách hàng","SĐT","Công ty","Nhân viên","Trạng thái","Ngày","Hiệu lực","Tạm tính","Chiết khấu","Tổng","Ghi chú"],
      ...rows.map(q => [q.quoteNo || q.id, q.customerName || "", q.customerPhone || "", q.customerCompanyName || "", q.owner || q.ownerEmail || "", quoteStatusLabel(q.status), fmtDate(q.quoteDate || q.createdAt), fmtDate(q.validUntil), q.subtotal || 0, q.discountAmount || 0, q.totalAmount || 0, q.note || ""])
    ]
  }], `crm-bao-gia-${todayIso()}`);
}

function applyProductToDealInput(input) {
  const row = input.closest("[data-deal-item]");
  if (!row) return;
  const p = productByAnyValue(input.value);
  const meta = row.querySelector("[data-deal-product-meta]");
  if (!p) {
    row.querySelector("[data-deal-product-id]").value = "";
    if (meta) meta.textContent = "";
    return;
  }
  input.value = productLabel(p);
  row.querySelector("[data-deal-product-id]").value = p.id || "";
  row.querySelector("[data-deal-code]").value = p.code || "";
  if (meta) meta.textContent = [p.surface, p.origin, p.color, p.priceText || (p.price ? money(p.price) : "")].filter(Boolean).join(" · ");
}

function stopWatchers() {
  unsubscribers.forEach(fn => { try { fn(); } catch {} });
  unsubscribers = [];
  scopedSnapshots = {customers:{}, careLogs:{}, deals:{}, kpiProposals:{}};
}

async function updatePresence(online=true) {
  if (!currentUser || !appUser) return;
  await setDoc(doc(db, "userSessions", currentUser.uid), {
    email: currentUser.email || appUser.email || "",
    name: ownerName(),
    role: appUser.role || "",
    online,
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, {merge:true});
}

function startPresence() {
  clearInterval(presenceTimer);
  updatePresence(true).catch(() => {});
  presenceTimer = setInterval(() => updatePresence(true).catch(() => {}), 60000);
}

function stopPresence() {
  clearInterval(presenceTimer);
  presenceTimer = null;
}

function setCollectionState(targetName, docs) {
  if (targetName === "customers") {
    allCustomers = docs;
    customers = docs.filter(c => !c.isDeleted);
    deletedCustomers = docs.filter(c => c.isDeleted);
  }
  else if (targetName === "careLogs") {
    allCareLogs = docs;
    careLogs = docs.filter(l => !l.isDeleted);
  }
  else if (targetName === "deals") {
    allDeals = docs;
    deals = docs.filter(d => !d.isDeleted);
  }
  else if (targetName === "customerAssignments") {
    customerAssignments = docs.sort((a,b) => (toDate(b.assignedAt)?.getTime() || 0) - (toDate(a.assignedAt)?.getTime() || 0));
  }
  else if (targetName === "quotes") {
    allQuotes = docs;
    quotes = docs.filter(q => !q.isDeleted);
  }
  else if (targetName === "quoteItems") {
    quoteItems = docs.sort((a,b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  }
  else if (targetName === "orderItems") {
    orderItems = docs.sort((a,b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  }
  else if (targetName === "payments") {
    allPayments = docs;
    payments = docs.filter(p => !p.isDeleted && clean(p.status) !== "void");
  }
  else if (targetName === "inventoryMovements") {
    allInventoryMovements = docs;
    inventoryMovements = docs.filter(m => !m.isDeleted).sort(byDateDesc);
    inventoryQtyCache = new Map();
  }
  else if (targetName === "products") {
    products = docs.filter(d => !d.isDeleted).sort((a,b) => clean(a.name).localeCompare(clean(b.name), "vi"));
    inventoryQtyCache = new Map();
  }
  else if (targetName === "kpiProposals") kpiProposals = docs;
  else if (targetName === "kpiPeriods") {
    kpiPeriods = docs.sort((a,b) => clean(b.periodMonth).localeCompare(clean(a.periodMonth)));
  }
  else if (targetName === "kpiDefinitions") {
    kpiDefinitions = docs.sort((a,b) => clean(a.code).localeCompare(clean(b.code), "vi"));
  }
  else if (targetName === "kpiAssignments") {
    kpiAssignments = docs.sort((a,b) => clean(a.employeeId).localeCompare(clean(b.employeeId), "vi"));
  }
}

function setScopedDocs(targetName, scopeKey, docs) {
  scopedSnapshots[targetName][scopeKey] = docs;
  const map = new Map();
  Object.values(scopedSnapshots[targetName]).flat().forEach(item => map.set(item.id, item));
  setCollectionState(targetName, [...map.values()].sort(byDateDesc));
}

function replaceDocs(targetName, docs) {
  setCollectionState(targetName, docs.sort(byDateDesc));
}

function canSeeCustomer(c) {
  if (!c?.id) return false;
  if (isManager()) return true;
  return ownerMatchesCurrentUser(c);
}

function watchData() {
  stopWatchers();
  customers = [];
  allCustomers = [];
  deletedCustomers = [];
  customerAssignments = [];
  selectedUnassignedCustomerIds.clear();
  careLogs = [];
  allCareLogs = [];
  deals = [];
  allDeals = [];
  quotes = [];
  allQuotes = [];
  quoteItems = [];
  orderItems = [];
  payments = [];
  allPayments = [];
  inventoryMovements = [];
  allInventoryMovements = [];
  products = [];
  users = [];
  kpiRules = [];
  kpiProposals = [];
  kpiPeriods = [];
  kpiDefinitions = [];
  kpiAssignments = [];
  auditLogs = [];

  const applySnap = (targetName, snap, filterDeleted=false, scopeKey="") => {
    const docs = snap.docs.map(d => ({id:d.id, ...d.data()})).filter(item => ["customers","careLogs","deals","quotes","quoteItems","orderItems","payments","inventoryMovements","products"].includes(targetName) || !filterDeleted || !item.isDeleted);
    if (scopeKey) setScopedDocs(targetName, scopeKey, docs);
    else replaceDocs(targetName, docs);
    markDirty(targetName);
  };

  unsubscribers.push(onSnapshot(doc(db, "settings", "crm"), snap => {
    applySettings(snap.exists() ? snap.data() : {});
    hydrateSelects();
    markDirty("settings");
  }, err => notice("Lỗi tải SETTINGS: " + authMessage(err), true)));

  if (canAccessAdminPanel()) {
    unsubscribers.push(onSnapshot(doc(db, "companySettings", "main"), snap => {
      companySettings = normalizeCompanySettings(snap.exists() ? snap.data() : {});
      if (isAdminRoute()) renderCompanySettingsForm();
      markDirty("companySettings");
    }, err => notice("Lỗi tải cấu hình công ty: " + authMessage(err), true)));
  }

  unsubscribers.push(onSnapshot(collection(db, "kpiRules"), snap => {
    kpiRules = snap.docs.map(d => ({id:d.id, ...d.data()})).sort((a,b) => clean(a.name).localeCompare(clean(b.name)));
    hydrateProposalKpiOptions();
    markDirty("kpiRules");
  }, err => notice("Lỗi tải KPI: " + authMessage(err), true)));

  if (isManager()) {
    unsubscribers.push(onSnapshot(collection(db, "kpiPeriods"), snap => applySnap("kpiPeriods", snap), err => notice("Lỗi tải kỳ KPI mới: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "kpiDefinitions"), snap => applySnap("kpiDefinitions", snap), err => notice("Lỗi tải KPI definition: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "kpiAssignments"), snap => applySnap("kpiAssignments", snap), err => notice("Lỗi tải assignment KPI mới: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "customers"), snap => applySnap("customers", snap, true), err => notice("Lỗi tải khách: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "customerAssignments"), snap => applySnap("customerAssignments", snap), err => notice("Lỗi tải lịch sử phân công: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "careLogs"), snap => applySnap("careLogs", snap, true), err => notice("Lỗi tải lịch sử chăm: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "deals"), snap => applySnap("deals", snap, true), err => notice("Lỗi tải dữ liệu mua căn bản: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "kpiProposals"), snap => applySnap("kpiProposals", snap, true), err => notice("Lỗi tải đề xuất KPI: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "auditLogs"), snap => {
      auditLogs = snap.docs.map(d => ({id:d.id, ...d.data()})).sort(byDateDesc);
      markDirty("auditLogs");
    }, err => notice("Lỗi tải audit log: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "users"), snap => {
      users = snap.docs.map(d => ({uid:d.id, ...d.data()})).sort((a,b) => clean(a.email).localeCompare(clean(b.email)));
      hydrateSelects();
      hydrateOwnerDependentFilters();
      markDirty("users");
    }, err => notice("Lỗi tải tài khoản nhân viên: " + authMessage(err), true)));
    if (isAdmin()) {
      unsubscribers.push(onSnapshot(collection(db, "userSessions"), snap => {
        onlineSessions = snap.docs.map(d => ({uid:d.id, ...d.data()}));
        renderOnlineUsers();
      }, err => notice("Lỗi tải truy cập: " + authMessage(err), true)));
    }
    return;
  }

  unsubscribers.push(onSnapshot(collection(db, "customers"), snap => applySnap("customers", snap, true), err => notice("Lỗi tải khách được cấp quyền: " + authMessage(err), true)));
  unsubscribers.push(onSnapshot(collection(db, "customerAssignments"), snap => applySnap("customerAssignments", snap), err => notice("Lỗi tải lịch sử phân công: " + authMessage(err), true)));
  unsubscribers.push(onSnapshot(collection(db, "careLogs"), snap => applySnap("careLogs", snap, true), err => notice("Lỗi tải lịch sử chăm được cấp quyền: " + authMessage(err), true)));
  unsubscribers.push(onSnapshot(collection(db, "deals"), snap => applySnap("deals", snap, true), err => notice("Lỗi tải dữ liệu mua căn bản được cấp quyền: " + authMessage(err), true)));
  unsubscribers.push(onSnapshot(collection(db, "kpiProposals"), snap => applySnap("kpiProposals", snap, true), err => notice("Lỗi tải đề xuất KPI của bạn: " + authMessage(err), true)));
}

function visibleCustomers() {
  const q = normalizeKey($("searchBox").value);
  const owner = clean($("filterOwner").value);
  const status = clean($("filterStatus").value);
  const dealStatus = clean($("filterDealStatus").value);
  const follow = clean($("filterFollow").value);
  const channel = clean($("filterChannel").value);
  const customerType = clean($("filterCustomerType").value);
  const week = clean($("filterWeek").value);
  const month = clean($("filterMonth").value);

  return customers.filter(canSeeCustomer).filter(c => {
    const haystack = normalizeKey([c.name,c.companyName,c.phoneRaw,c.phoneNormalized,c.address,c.channel,c.customerType,c.owner,c.ownerEmail,customerOwnerName(c),c.status,c.follow,computedFollowStatus(c),c.need,c.note].join(" "));
    if (q && !haystack.includes(q)) return false;
    if (owner && !sameIdentity(customerOwnerKey(c), owner) && !sameIdentity(c.owner, owner)) return false;
    if (status === "__NO_PHONE__" && c.phoneNormalized) return false;
    if (status && status !== "__NO_PHONE__" && clean(c.status) !== status) return false;
    if (dealStatus && !customerDeals(c.id).some(d => normalizeKey(normalizeDealStatus(d.dealStatus)) === normalizeKey(dealStatus))) return false;
    if (!followMatchesFilter(c, follow)) return false;
    if (channel && normalizeKey(canonicalChannel(c.channel)) !== normalizeKey(channel)) return false;
    if (customerType && normalizeKey(c.customerType) !== normalizeKey(customerType)) return false;
    if (!customerMatchesChannelQuick(c)) return false;
    if (week && weekOf(c.createdAt) !== week) return false;
    if (!week && month && monthOf(c.createdAt) !== month) return false;
    return true;
  });
}

const SOCIAL_CHANNEL_KEYS = ["zalo","facebook","tiktok","website"];
function channelQuickType(channelValue) {
  const key = normalizeKey(canonicalChannel(channelValue));
  if (key === normalizeKey("Công ty TK/XD")) return "company";
  if (SOCIAL_CHANNEL_KEYS.includes(key)) return "social";
  return "other";
}
function customerMatchesChannelQuick(c, quick = activeChannelQuickFilter) {
  if (!quick) return true;
  if (quick === "unassigned") return !clean(c.ownerUserId) && !clean(c.ownerEmail);
  return channelQuickType(c.channel) === quick;
}
function channelQuickLabel(quick = activeChannelQuickFilter) {
  return {company:"Công ty XD", social:"Mạng XH", other:"Kênh khác", unassigned:"Khách chờ phân bổ"}[quick] || "";
}

const customerAssignmentHistory = customerId => customerAssignments
  .filter(item => item.customerId === customerId)
  .sort((a,b) => (toDate(b.assignedAt)?.getTime() || 0) - (toDate(a.assignedAt)?.getTime() || 0));

const firstCustomerAssignment = customerId => customerAssignments
  .filter(item => item.customerId === customerId)
  .sort((a,b) => (toDate(a.assignedAt)?.getTime() || 0) - (toDate(b.assignedAt)?.getTime() || 0))[0] || null;

function customerAcquisitionOwnerKeys(customer) {
  const creator = users.find(user =>
    sameIdentity(user.uid, customer?.createdByUserId) || sameIdentity(user.email, customer?.createdByEmail)
  );
  if (creator && normalizeKey(creator.role) === "sale") {
    return [creator.uid, creator.email, creator.name].map(clean).filter(Boolean);
  }
  const firstAssignment = firstCustomerAssignment(customer?.id);
  if (firstAssignment) {
    return [
      firstAssignment.employeeId,
      firstAssignment.employeeEmailSnapshot,
      firstAssignment.employeeNameSnapshot
    ].map(clean).filter(Boolean);
  }
  return [customer?.createdByUserId, customer?.createdByEmail, customerOwnerKey(customer), customer?.owner]
    .map(clean)
    .filter(Boolean);
}

function customerWasAcquiredBy(customer, ownerKey) {
  const profile = ownerProfileByValue(ownerKey);
  const ownerKeys = [ownerKey, profile.uid, profile.email, profile.name].map(clean).filter(Boolean);
  return customerAcquisitionOwnerKeys(customer).some(acquisitionKey =>
    ownerKeys.some(key => sameIdentity(acquisitionKey, key))
  );
}

function previousAssignmentFor(customerId) {
  return customerAssignmentHistory(customerId).find(item => !item.isCurrent) || null;
}

const customerDeals = id => deals.filter(d => d.customerId === id).sort((a,b) => String(b.dealDate || "").localeCompare(String(a.dealDate || "")) || byDateDesc(a,b));
const careLogActivityDate = l => l?.careDate || l?.createdAt;
const careLogSortDesc = (a,b) => (toDate(careLogActivityDate(b))?.getTime() || 0) - (toDate(careLogActivityDate(a))?.getTime() || 0) || byDateDesc(a,b);
const customerLogs = id => careLogs.filter(l => l.customerId === id).sort(careLogSortDesc);
const dealCounts = id => {
  const list = customerDeals(id);
  return {
    deposit: list.filter(d => sameLabel(normalizeDealStatus(d.dealStatus), "depositStatus")).length,
    bought: list.filter(d => sameLabel(normalizeDealStatus(d.dealStatus), "boughtStatus")).length,
    canceled: list.filter(d => sameLabel(normalizeDealStatus(d.dealStatus), "canceledStatus")).length
  };
};
const isCompletedDeal = d => d?.completed === true || sameLabel(normalizeDealStatus(d?.dealStatus), "boughtStatus");
const isKpiRevenueDeal = d => isCompletedDeal(d) || sameLabel(normalizeDealStatus(d?.dealStatus), "depositStatus");
const dealAmount = d => Number(d?.amount || 0);
const isActiveDeal = d => !!d && !d.isDeleted && !isCompletedDeal(d) && !isCanceledDeal(d.dealStatus) && !isFailStatus(d.dealStatus);
const canEditDeal = d => {
  if (!d || d.isDeleted) return false;
  if (isManager()) return true;
  const c = customerById(d.customerId);
  return (ownerMatchesCurrentUser(d) || ownerMatchesCurrentUser(c)) && isActiveDeal(d);
};
const purchaseCount = id => customerDeals(id).filter(isCompletedDeal).length;
const hasProfileNumber = value => value !== undefined && value !== null && String(value).trim() !== "";
const positiveNumber = value => Math.max(0, Number(value || 0) || 0);
const customerProfileNumber = (c, keys, fallback = 0) => {
  for (const key of keys) {
    if (hasProfileNumber(c?.[key])) return positiveNumber(c[key]);
  }
  return positiveNumber(typeof fallback === "function" ? fallback() : fallback);
};
const showroomVisitCountFor = c => customerProfileNumber(c, ["showroomVisitCount", "showroomVisits", "showroom_visit_count"]);
const basicPurchaseCountFor = c => Math.max(
  customerProfileNumber(c, ["basicPurchaseCount", "purchaseCount", "purchase_count"]),
  purchaseCount(c?.id)
);
const basicPurchaseValueFor = c => Math.max(
  customerProfileNumber(c, ["basicPurchaseValue", "purchaseValue", "purchase_value", "lifetimeValue"]),
  customerDeals(c?.id).filter(isKpiRevenueDeal).reduce((sum, d) => sum + dealAmount(d), 0)
);
const potentialLevelFor = c => clean(c?.potentialLevel || c?.level || c?.customerLevel || "Bình thường");
const customerHasDealStatus = (id, labelKey) => customerDeals(id).some(d => sameLabel(normalizeDealStatus(d.dealStatus), labelKey));
const customerHasCompletedDeal = id => customerDeals(id).some(isCompletedDeal);
const latestDealStatus = c => normalizeDealStatus(customerDeals(c.id)[0]?.dealStatus || c.dealStatus || "");
const daysBetweenIso = (a, b) => Math.floor((new Date(a + "T00:00:00") - new Date(b + "T00:00:00")) / 86400000);
const careDeltaDays = c => clean(c.nextCareDate) ? daysBetweenIso(todayIso(), clean(c.nextCareDate)) : null;
const careDueDays = () => Math.max(0, Number(settings.careDueDays ?? DEFAULT_SETTINGS.careDueDays ?? 3) || 0);
const isLeadStatus = c => sameLabel(c?.status, "leadStatus");
const isCustomerClosed = c => basicPurchaseCountFor(c) > 0 || isCanceledDeal(latestDealStatus(c)) || isFailStatus(latestDealStatus(c)) || sameLabel(c.status, "noNeedStatus");
function computedFollowStatus(c) {
  if (!c) return "";
  if (isCustomerClosed(c)) return systemLabel("closedFollow");
  const nextDate = clean(c.nextCareDate);
  if (!nextDate) return systemLabel("noDateFollow");
  const delta = careDeltaDays(c);
  if (delta === null) return systemLabel("noDateFollow");
  if (delta > careDueDays()) return systemLabel("overdueFollow");
  if (delta >= 0) return systemLabel("dueFollow");
  return systemLabel("activeFollow");
}
const followMatchesFilter = (c, follow) => {
  const computed = computedFollowStatus(c);
  if (!follow) return true;
  if (sameLabel(follow, "leadStatus")) return isLeadStatus(c);
  if (sameLabel(follow, "dueFollow")) return sameLabel(computed, "dueFollow") || sameLabel(computed, "overdueFollow");
  if (sameLabel(follow, "overdueFollow")) return sameLabel(computed, "overdueFollow");
  return normalizeKey(computed) === normalizeKey(follow);
};
const isCareDue = c => sameLabel(computedFollowStatus(c), "dueFollow") || sameLabel(computedFollowStatus(c), "overdueFollow");
const isCareOverdue = c => sameLabel(computedFollowStatus(c), "overdueFollow");
function careScheduleText(c) {
  if (c && isCustomerClosed(c)) return systemLabel("closedFollow");
  const nextDate = clean(c?.nextCareDate);
  if (!nextDate) return "Chưa đặt lịch";
  const delta = careDeltaDays(c);
  if (delta === null) return fmtDate(nextDate);
  if (delta > careDueDays()) return `Quá ${delta} ngày`;
  if (delta === 0) return "Hôm nay";
  if (delta > 0) return `Cần chăm (${delta} ngày)`;
  return `Sắp tới ${fmtDate(nextDate)}`;
}
function careSchedulePillClass(c) {
  if (c && isCustomerClosed(c)) return "green";
  if (isCareOverdue(c)) return "red";
  if (isCareDue(c)) return "orange";
  if (!clean(c?.nextCareDate)) return "orange";
  return "green";
}
const isFollowUpResult = value => normalizeKey(value) === normalizeKey("Hẹn lại");
const isNoNeedResult = value => sameLabel(value, "noNeedStatus") || normalizeKey(value) === normalizeKey("Không nhu cầu");
const openDealCount = id => customerDeals(id).filter(isActiveDeal).length;
const addDaysIso = (iso, days) => {
  const d = new Date((iso || todayIso()) + "T00:00:00");
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
};

function statusPill(status) {
  const s = clean(status);
  const normalized = normalizeDealStatus(s);
  const cls = sameLabel(normalized, "boughtStatus") ? "green" : sameLabel(normalized, "depositStatus") ? "orange" : (sameLabel(normalized, "failStatus") || sameLabel(normalized, "canceledStatus")) ? "red" : "";
  return normalized ? `<span class="pill ${cls}">${esc(normalized)}</span>` : "";
}

function customerStatusClass(status) {
  const value = clean(status);
  if (!value) return "status-gray";
  if (sameLabel(value, "boughtStatus")) return "status-green";
  if (sameLabel(value, "depositStatus")) return "status-orange";
  if (sameLabel(value, "failStatus") || sameLabel(value, "canceledStatus") || sameLabel(value, "noNeedStatus")) return "status-red";
  if (sameLabel(value, "leadStatus")) return "status-blue";
  if (sameLabel(value, "activeStatus") || normalizeKey(value).includes("tuvan") || normalizeKey(value).includes("baogia") || normalizeKey(value).includes("follow")) return "status-green";
  if (normalizeKey(value).includes("tam")) return "status-gray";
  return "status-blue";
}

function updateCareStatusVisual() {
  const el = $("careStatus");
  if (!el) return;
  el.classList.remove("status-green","status-orange","status-red","status-blue","status-gray");
  el.classList.add(customerStatusClass(el.value));
}

const crmViewIds = ["executiveDashboard","pipelinePanel","needCarePanel"];
const adminViewIds = ["careSettingsPanel","dropdownSettingsPanel","proHealthPanel","dataSafetyPanel","userAdminPanel","trashPanel","auditPanel"];
const customerViewIds = ["customerSearchPanel"];
const kpiViewIds = ["kpiCutoverStatus","kpiTeamPanel","kpiSummaryPanel","kpiFoundationPanel","kpi2OperationsPanel","kpiRulePanel","kpiApprovalPanel"];
const reportsViewIds = ["reportsPanel"];

function renderCrmView() {
  renderKpis();
  renderExecutiveDashboard();
  renderPipelineReport();
  requestChartRender();
  renderNeedCare();
}

function setMainView(view) {
  activeMainView = ["customers","kpi","reports","admin"].includes(view) ? view : "crm";
  if (activeMainView === "reports" && !isManager()) activeMainView = "crm";
  if (activeMainView === "admin" && !canAccessAdminPanel()) activeMainView = "crm";
  const isCustomerView = activeMainView === "customers";
  const isKpiView = activeMainView === "kpi";
  const isReportsView = activeMainView === "reports";
  const isAdminView = activeMainView === "admin";
  crmViewIds.forEach(id => {
    if (isCustomerView || isKpiView || isReportsView || isAdminView) $(id)?.classList.add("hide");
  });
  if (!isCustomerView && !isKpiView && !isReportsView && !isAdminView) {
    $("needCarePanel")?.classList.remove("hide");
    $("executiveDashboard")?.classList.toggle("hide", !isManager());
    $("pipelinePanel")?.classList.toggle("hide", !isManager());
  }
  adminViewIds.forEach(id => $(id)?.classList.add("hide"));
  if (isAdminView) {
    $("careSettingsPanel")?.classList.toggle("hide", !canAccessAdminPanel());
    $("proHealthPanel")?.classList.toggle("hide", !canAccessAdminPanel());
    $("dataSafetyPanel")?.classList.toggle("hide", !canAccessAdminPanel());
    $("auditPanel")?.classList.toggle("hide", !canAccessAdminPanel());
    $("dropdownSettingsPanel")?.classList.toggle("hide", !canAccessAdminPanel());
    $("userAdminPanel")?.classList.toggle("hide", !canAccessAdminPanel());
    $("trashPanel")?.classList.toggle("hide", !canAccessAdminPanel());
  }
  customerViewIds.forEach(id => $(id)?.classList.toggle("hide", !isCustomerView));
  document.querySelector(".chart-grid")?.classList.toggle("hide", isCustomerView || isKpiView || isReportsView || isAdminView);
  $("kpiTeamPanel")?.classList.toggle("hide", !isKpiView || !isManager());
  $("kpiSummaryPanel")?.classList.toggle("hide", !isKpiView || isManager());
  $("kpiCutoverStatus")?.classList.toggle("hide", !isKpiView);
  $("kpi2OperationsPanel")?.classList.toggle("hide", !isKpiView || isManager());
  $("kpiFoundationPanel")?.classList.add("hide");
  $("kpiRulePanel")?.classList.add("hide");
  $("kpiApprovalPanel")?.classList.add("hide");
  reportsViewIds.forEach(id => $(id)?.classList.toggle("hide", !isReportsView));
  $("adminViewBtn")?.classList.toggle("hide", !canAccessAdminPanel());
  $("reportsViewBtn")?.classList.toggle("hide", !isManager());
  $("crmViewBtn")?.classList.toggle("primary", !isCustomerView && !isKpiView && !isReportsView && !isAdminView);
  $("customersViewBtn")?.classList.toggle("primary", isCustomerView);
  $("kpiViewBtn")?.classList.toggle("primary", isKpiView);
  $("reportsViewBtn")?.classList.toggle("primary", isReportsView);
  $("adminViewBtn")?.classList.toggle("primary", isAdminView);
  if (!isCustomerView && !isKpiView && !isReportsView && !isAdminView) renderCrmView();
  if (isCustomerView) renderCustomers();
  if (isKpiView) {
    renderKpiCutoverStatus();
    if (isManager()) {
      renderKpiTeamShell();
      reloadKpiTeamSummary().catch(err => notice("Lỗi tải KPI Team: " + authMessage(err), true));
      if (kpiTeamState.activeMode === "library") {
        renderKpiTable();
        renderMyKpiProposalPanel();
        renderKpiRuleList();
        renderKpiApprovalPanel();
        renderKpiFoundation();
      }
    } else {
      reloadKpi2Data().catch(err => notice("Lỗi tải KPI mới: " + authMessage(err), true));
      renderKpiTable();
      renderMyKpiProposalPanel();
    }
    applyKpiManagerModeVisibility();
  }
  if (isReportsView) renderReportCenter();
  if (isAdminView) {
    renderHealthCheck();
    renderDataSafetyPanel();
    renderUserAdmin();
    renderTrash();
    renderAuditTrail();
  }
}

function renderKpis() {
  if (!$("kpis")) return;
  const rows = customers.filter(canSeeCustomer);
  const rowIds = new Set(rows.map(c => c.id));
  const due = rows.filter(isCareDue);
  const overdue = rows.filter(isCareOverdue);
  const thisMonth = currentMonth();
  const monthLead = rows.filter(c => monthOf(c.createdAt) === thisMonth && (isManager() || customerWasAcquiredBy(c, appUser?.uid || ownerEmail()))).length;
  const monthCare = careLogs.filter(l => !l.isDeleted && monthOf(careLogActivityDate(l)) === thisMonth && rowIds.has(l.customerId)).length;
  const noDate = rows.filter(c => !isCustomerClosed(c) && !clean(c.nextCareDate)).length;
  const showroomVisits = rows.reduce((sum, c) => sum + showroomVisitCountFor(c), 0);
  const boughtCustomers = rows.filter(c => basicPurchaseCountFor(c) > 0);
  const purchaseValue = rows.reduce((sum, c) => sum + basicPurchaseValueFor(c), 0);
  const conversionRate = rows.length ? Math.round(boughtCustomers.length / rows.length * 100) : 0;
  const items = [
    ["Tổng khách", rows.length, "managed-customers"],
    ["Khách mới tháng này", monthLead, "month-customers"],
    ["Cần chăm", due.length, "due-care"],
    ["Quá hạn chăm", overdue.length, "overdue-care"],
    ["Chưa có lịch chăm", noDate, "no-date-care"],
    ["Lượt chăm tháng", monthCare, "month-care"],
    ["Đến showroom", showroomVisits, "showroom-visits"],
    ["Khách đã mua", boughtCustomers.length, "bought-customers"],
    ["Giá trị mua căn bản", money(purchaseValue), "purchase-value"],
    ["Tỉ lệ mua", conversionRate + "%", "bought-customers"]
  ];
  $("kpis").innerHTML = items.map(([label,num,action]) => `
    <button class="kpi clickable" type="button" data-dashboard-action="${esc(action)}">
      <div class="muted">${esc(label)}</div>
      <div class="num">${esc(num)}</div>
    </button>
  `).join("");
}

function currentReportCustomers() {
  return customers.filter(canSeeCustomer);
}

function currentReportDeals() {
  const ids = new Set(currentReportCustomers().map(c => c.id));
  return deals.filter(d => ids.has(d.customerId));
}

function renderExecutiveDashboard() {
  $("executiveDashboard")?.classList.toggle("hide", !isManager());
  if (!isManager()) return;
  const rows = currentReportCustomers();
  const month = currentMonth();
  const monthCustomers = rows.filter(c => monthOf(c.createdAt) === month);
  const rowIds = new Set(rows.map(c => c.id));
  const monthCareLogs = careLogs.filter(l => !l.isDeleted && rowIds.has(l.customerId) && monthOf(careLogActivityDate(l)) === month);
  const boughtCustomers = rows.filter(c => basicPurchaseCountFor(c) > 0);
  const purchaseTimes = rows.reduce((sum, c) => sum + basicPurchaseCountFor(c), 0);
  const purchaseValue = rows.reduce((sum, c) => sum + basicPurchaseValueFor(c), 0);
  const pendingKpi = operationalKpiPendingCount();
  const legacyPendingKpi = legacyVisiblePendingCount();
  const dueCare = rows.filter(isCareDue);
  const overdueCare = rows.filter(isCareOverdue);
  const noDateCare = rows.filter(c => !isCustomerClosed(c) && !clean(c.nextCareDate));
  const showroomVisits = rows.reduce((sum, c) => sum + showroomVisitCountFor(c), 0);
  const cards = [
    ["Khách đang quản lý", rows.length, "", "managed-customers"],
    ["Khách mới tháng này", monthCustomers.length, "", "month-customers"],
    ["Lượt chăm tháng", monthCareLogs.length, "", ""],
    ["Cần chăm", dueCare.length, dueCare.length ? "warn" : "", "due-care"],
    ["Quá hạn chăm", overdueCare.length, overdueCare.length ? "bad" : "", "overdue-care"],
    ["Chưa có lịch chăm", noDateCare.length, noDateCare.length ? "warn" : "", ""],
    ["Đến showroom", showroomVisits, "", ""],
    ["Khách đã mua", boughtCustomers.length, "", ""],
    ["Số lần mua", purchaseTimes, "", ""],
    ["Giá trị mua căn bản", money(purchaseValue), "", ""],
    [legacyKpiPreCutover() ? "KPI chờ duyệt" : "KPI hiện tại cần duyệt", pendingKpi, pendingKpi ? "warn" : "", "pending-kpi"],
    ...(!legacyKpiPreCutover() ? [["KPI cũ đang đóng sổ", legacyPendingKpi, legacyPendingKpi ? "warn" : "", "legacy-pending-kpi"]] : []),
    ["Tỉ lệ mua", rows.length ? Math.round(boughtCustomers.length / rows.length * 100) + "%" : "0%", ""]
  ];
  $("executiveGrid").innerHTML = cards.map(([label,value,cls,action]) => `
    <div class="executive-card ${esc(cls)} ${action ? "clickable" : ""}" ${action ? `role="button" tabindex="0" data-dashboard-action="${esc(action)}"` : ""}>
      <span class="muted">${esc(label)}</span>
      <b>${esc(value)}</b>
    </div>
  `).join("");
}

function pipelineReportData() {
  const rows = currentReportCustomers();
  const labels = uniq([...(settings.statuses || []), systemLabel("depositStatus"), systemLabel("boughtStatus"), systemLabel("canceledStatus")]);
  const data = labels.map(label => {
    const matched = rows.filter(c => {
      const status = clean(c.status);
      const dealStatus = latestDealStatus(c);
      if (sameLabel(label, "boughtStatus")) return customerHasCompletedDeal(c.id) || sameLabel(status, "boughtStatus");
      if (sameLabel(label, "depositStatus")) return customerHasDealStatus(c.id, "depositStatus") || sameLabel(status, "depositStatus");
      if (sameLabel(label, "canceledStatus")) return customerHasDealStatus(c.id, "canceledStatus") || sameLabel(status, "canceledStatus");
      return normalizeKey(status) === normalizeKey(label) || normalizeKey(dealStatus) === normalizeKey(label);
    });
    return {label, count: matched.length, customers: matched};
  }).filter(item => item.count > 0);
  if (!data.length && rows.length) data.push({label:"Chưa phân loại", count: rows.length, customers: rows});
  return data;
}

function renderPipelineReport() {
  $("pipelinePanel")?.classList.toggle("hide", !isManager());
  if (!isManager()) return;
  const data = pipelineReportData();
  const total = Math.max(1, data.reduce((sum,item) => sum + item.count, 0));
  $("pipelineRangeText").textContent = `${data.reduce((sum,item) => sum + item.count, 0)} khách theo trạng thái hiện tại`;
  $("pipelineGrid").innerHTML = data.length ? data.map(item => {
    const pct = Math.round(item.count / total * 100);
    return `
      <button class="pipeline-card" type="button" data-pipeline-detail="${esc(item.label)}">
        <span class="muted">${esc(item.label)}</span>
        <b>${esc(item.count)} khách</b>
        <span>${esc(pct)}%</span>
        <span class="pipeline-bar"><span style="width:${esc(pct)}%"></span></span>
      </button>
    `;
  }).join("") : `<div class="muted">Chưa có dữ liệu pipeline.</div>`;
}

function openPipelineDetail(label) {
  if (!isManager()) return;
  const item = pipelineReportData().find(x => x.label === label);
  if (!item) return notice("Không tìm thấy nhóm pipeline.", true);
  openDetailModal(
    `Pipeline: ${item.label}`,
    `${item.count} khách theo trạng thái hiện tại`,
    customerDetailRows([...item.customers].sort(byDateDesc))
  );
}

function chartBox(canvas) {
  if (!canvas || !canvas.isConnected) return null;
  const wrap = canvas.parentElement;
  const rect = (wrap || canvas).getBoundingClientRect();
  const width = Math.floor(rect.width || canvas.clientWidth || 0);
  const height = Math.floor(rect.height || canvas.clientHeight || 0);
  if (width < 80 || height < 80) return null;
  return {width, height};
}

let chartRetryTimer = null;
function requestChartRender(retry=0) {
  clearTimeout(chartRetryTimer);
  const okGrowth = renderChart();
  const okChannel = renderChannelReportChart();
  if ((!okGrowth || !okChannel) && retry < 8) {
    chartRetryTimer = setTimeout(() => requestChartRender(retry + 1), 120);
  }
}

function renderChart() {
  const canvas = $("growthChart");
  if (!canvas) return false;
  const box = chartBox(canvas);
  if (!box) return false;
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, box.width * ratio);
  canvas.height = Math.max(180, box.height * ratio);
  ctx.setTransform(ratio,0,0,ratio,0,0);
  const w = box.width, h = box.height;
  ctx.clearRect(0,0,w,h);
  const year = new Date().getFullYear();
  const counts = Array(12).fill(0);
  customers.filter(canSeeCustomer).forEach(c => {
    const d = toDate(c.createdAt);
    if (d && d.getFullYear() === year) counts[d.getMonth()]++;
  });
  const max = Math.max(1, ...counts);
  const pad = 32, innerW = w - pad * 2, innerH = h - pad * 2;
  ctx.strokeStyle = "#d8e1ee"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(pad, h-pad); ctx.lineTo(w-pad, h-pad); ctx.stroke();
  ctx.strokeStyle = "#147a68"; ctx.fillStyle = "#147a68"; ctx.lineWidth = 3;
  ctx.beginPath();
  counts.forEach((v,i) => {
    const x = pad + (innerW / 11) * i;
    const y = h - pad - (v / max) * innerH;
    if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();
  counts.forEach((v,i) => {
    const x = pad + (innerW / 11) * i;
    const y = h - pad - (v / max) * innerH;
    ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = "#64748b"; ctx.fillText("T"+(i+1), x-8, h-8);
    ctx.fillText(String(v), x-4, y-10);
    ctx.fillStyle = "#147a68";
  });
  return true;
}

function localDateFromInput(value, endOfDay = false) {
  const raw = clean(value);
  if (!raw) return null;
  const d = new Date(`${raw}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function currentMonthStartIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function ensureChannelReportCustomDates() {
  if (!$("channelReportStartDate")?.value) $("channelReportStartDate").value = currentMonthStartIso();
  if (!$("channelReportEndDate")?.value) $("channelReportEndDate").value = todayIso();
}

function updateChannelReportCustomControls() {
  const isCustom = clean($("channelReportRange")?.value) === "custom";
  $("channelReportCustomRange")?.classList.toggle("hide", !isCustom);
  if (isCustom) ensureChannelReportCustomDates();
}

function resetChannelReportFilters() {
  $("channelReportRange").value = "year";
  $("channelReportStartDate").value = "";
  $("channelReportEndDate").value = "";
  updateChannelReportCustomControls();
  requestChartRender();
}

function inReportRange(c, range) {
  const d = toDate(c.createdAt);
  if (!d) return false;
  const now = new Date();
  if (range === "custom") {
    let start = localDateFromInput($("channelReportStartDate")?.value);
    let end = localDateFromInput($("channelReportEndDate")?.value, true);
    if (!start && !end) return true;
    if (start && end && start > end) [start, end] = [end, start];
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
  }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "week") {
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
  } else if (range === "month") {
    start.setDate(1);
  } else {
    start.setMonth(0, 1);
  }
  return d >= start && d <= now;
}

function channelReportRangeLabel(range) {
  if (range === "week") return "tuần này";
  if (range === "month") return "tháng này";
  if (range === "custom") {
    const start = fmtDate($("channelReportStartDate")?.value);
    const end = fmtDate($("channelReportEndDate")?.value);
    if (start && end) return `${start} - ${end}`;
    if (start) return `từ ${start}`;
    if (end) return `đến ${end}`;
    return "khoảng thời gian đã chọn";
  }
  return "năm nay";
}

function renderChannelReportChart() {
  const canvas = $("channelReportChart");
  if (!canvas) return false;
  updateChannelReportCustomControls();
  const box = chartBox(canvas);
  if (!box) return false;
  channelReportHitAreas = [];
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, box.width * ratio);
  canvas.height = Math.max(300, box.height * ratio);
  ctx.setTransform(ratio,0,0,ratio,0,0);
  const w = box.width, h = box.height;
  ctx.clearRect(0,0,w,h);
  const range = clean($("channelReportRange")?.value) || "month";
  const labels = uniq([...(settings.channels || []), "Khác"]).filter(Boolean);
  const counts = Object.fromEntries(labels.map(x => [x, 0]));
  customers.filter(canSeeCustomer).forEach(c => {
    if (!inReportRange(c, range)) return;
    const ch = canonicalChannel(c.channel, labels);
    counts[ch] = (counts[ch] || 0) + 1;
  });
  const rowsByLabel = Object.fromEntries(labels.map(x => [x, []]));
  customers.filter(canSeeCustomer).forEach(c => {
    if (!inReportRange(c, range)) return;
    const ch = canonicalChannel(c.channel, labels);
    if (!rowsByLabel[ch]) rowsByLabel[ch] = [];
    rowsByLabel[ch].push(c);
  });
  const data = labels.map(label => [label, counts[label] || 0]);
  const total = data.reduce((sum, [, value]) => sum + value, 0);
  const max = Math.max(1, ...data.map(([,v]) => v));
  const padL = Math.min(220, Math.max(120, w * 0.34));
  const padR = 42, padT = 20, padB = 34;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  ctx.font = "12px Arial";
  ctx.strokeStyle = "#d8e1ee";
  ctx.fillStyle = "#64748b";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, h - padB);
  ctx.lineTo(w - padR, h - padB);
  ctx.stroke();

  if (!total) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#64748b";
    ctx.font = "13px Arial";
    ctx.fillText(`Chưa có khách trong ${channelReportRangeLabel(range)}.`, padL + innerW / 2, padT + innerH / 2 - 8);
    ctx.fillText("Đổi bộ lọc thời gian để xem dữ liệu cũ hơn.", padL + innerW / 2, padT + innerH / 2 + 14);
    ctx.textAlign = "left";
    return true;
  }

  const ticks = Math.min(5, max);
  ctx.textAlign = "center";
  ctx.fillStyle = "#64748b";
  for (let i = 0; i <= ticks; i++) {
    const value = Math.round((max / ticks) * i);
    const x = padL + innerW * (value / max);
    ctx.strokeStyle = i === 0 ? "#d8e1ee" : "#edf2f7";
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, h - padB);
    ctx.stroke();
    ctx.fillText(String(value), x, h - 10);
  }

  const rowH = innerH / Math.max(1, data.length);
  const barH = Math.max(8, Math.min(22, rowH * 0.56));
  data.forEach(([label,value], i) => {
    const centerY = padT + rowH * i + rowH / 2;
    const y = centerY - barH / 2;
    const bw = Math.max(value > 0 ? 2 : 0, innerW * (value / max));
    channelReportHitAreas.push({
      label,
      value,
      customers: rowsByLabel[label] || [],
      x: padL,
      y: centerY - Math.max(barH, 28) / 2,
      w: Math.max(bw + 36, innerW),
      h: Math.max(barH, 28)
    });
    ctx.textAlign = "right";
    ctx.fillStyle = "#061633";
    ctx.fillText(label, padL - 10, centerY + 4);
    ctx.fillStyle = "#147a68";
    ctx.fillRect(padL, y, bw, barH);
    ctx.textAlign = "left";
    ctx.fillStyle = "#061633";
    ctx.fillText(String(value), padL + bw + 6, centerY + 4);
  });
  ctx.textAlign = "left";
  return true;
}

function closeDetailModal() {
  $("detailModalBackdrop")?.classList.add("hide");
  $("detailModal")?.classList.add("hide");
}

function openDetailModal(title, subtitle, html) {
  $("detailModalTitle").textContent = title || "Chi tiết";
  $("detailModalSubtitle").textContent = subtitle || "";
  $("detailModalContent").innerHTML = html || `<div class="muted">Chưa có dữ liệu chi tiết.</div>`;
  $("detailModalBackdrop").classList.remove("hide");
  $("detailModal").classList.remove("hide");
}

function customerDetailRows(rows) {
  return rows.length ? `<div class="detail-list">${rows.map(c => `
    <div class="detail-row">
      <div class="detail-row-head">
        <div>
          <b>${esc(c.name || "Khách hàng")}</b>
          <div class="detail-meta">
            <span>${esc(c.phoneRaw || c.phoneNormalized || "Không SĐT")}</span>
            <span>${esc(c.channel || "Chưa có kênh")}</span>
            <span>${esc(customerOwnerName(c) || "Chưa phụ trách")}</span>
          </div>
        </div>
        <button class="small primary" data-open-care="${esc(c.id)}">Mở khách</button>
      </div>
      <div class="detail-meta">
        <span>Tạo: ${esc(fmtDate(c.createdAt) || "")}</span>
        <span>Trạng thái: ${esc(c.status || "")}</span>
        <span>Hẹn chăm: ${esc(fmtDate(c.nextCareDate) || "")}</span>
      </div>
      ${c.need ? `<div>Nhu cầu: ${esc(c.need)}</div>` : ""}
      ${c.note ? `<div class="detail-note">${esc(c.note)}</div>` : ""}
    </div>
  `).join("")}</div>` : `<div class="muted">Không có khách trong nhóm này.</div>`;
}

function dealDetailRows(rows) {
  return rows.length ? `<div class="detail-list">${rows.map(d => {
    const c = customerById(d.customerId);
    const statusClass = isCompletedDeal(d) ? "green" : (isCanceledDeal(d.dealStatus) || isFailStatus(d.dealStatus) ? "red" : "orange");
    const statusText = isCompletedDeal(d) ? systemLabel("boughtStatus") : (isCanceledDeal(d.dealStatus) || isFailStatus(d.dealStatus) ? normalizeDealStatus(d.dealStatus) : normalizeDealStatus(d.dealStatus) || "Đang xử lý");
    return `
      <div class="detail-row">
        <div class="detail-row-head">
          <div>
            <b>${esc(orderCustomerName(d) || "Khách hàng")}</b>
            ${c.companyName ? `<div class="muted">${esc(c.companyName)}</div>` : ""}
            <div class="detail-meta">
              <span>${esc(orderCustomerPhone(d) || "Không SĐT")}</span>
              <span>${esc(orderOwnerName(d) || "Chưa phụ trách")}</span>
              <span>${esc(fmtDate(d.dealDate || d.createdAt) || "")}</span>
            </div>
          </div>
          <button class="small primary" data-open-care="${esc(d.customerId)}">Mở khách</button>
        </div>
        <div class="detail-meta">
          <span class="pill ${statusClass}">${esc(statusText)}</span>
          ${d.completedAt ? `<span>Ngày mua: ${esc(fmtDate(d.completedAt))}</span>` : ""}
          ${d.deliveryDate ? `<span>Ngày liên quan: ${esc(fmtDate(d.deliveryDate))}</span>` : ""}
        </div>
        <div>
          <b>${esc(money(dealAmount(d)))}</b>${orderProductText(d) ? ` · ${esc(orderProductText(d))}` : ""}
          <div class="detail-meta">
            <span>Giá trị ghi nhận: ${esc(money(dealAmount(d)))}</span>
          </div>
        </div>
        ${d.note ? `<div class="detail-note">${esc(d.note)}</div>` : ""}
      </div>
    `;
  }).join("")}</div>` : `<div class="muted">Không có dữ liệu mua căn bản trong nhóm này.</div>`;
}

function openCareDashboardDetail(type) {
  const isOverdue = type === "overdue-care";
  const rows = currentReportCustomers()
    .filter(isOverdue ? isCareOverdue : isCareDue)
    .sort((a,b) => {
      const byDate = clean(a.nextCareDate).localeCompare(clean(b.nextCareDate));
      return byDate || clean(a.name).localeCompare(clean(b.name), "vi");
    });
  openDetailModal(
    isOverdue ? "Quá hạn chăm" : "Cần chăm",
    `${rows.length} khách ${isOverdue ? "đã quá hạn chăm" : "đang cần chăm"}`,
    customerDetailRows(rows)
  );
}

function openDashboardCustomerDetail(type) {
  const rows = currentReportCustomers();
  const month = currentMonth();
  const config = {
    "managed-customers": ["Khách đang quản lý", rows],
    "month-customers": ["Khách mới tháng này", rows.filter(c => monthOf(c.createdAt) === month && (isManager() || customerWasAcquiredBy(c, appUser?.uid || ownerEmail())))],
    "no-date-care": ["Chưa có lịch chăm", rows.filter(c => !isCustomerClosed(c) && !clean(c.nextCareDate))],
    "showroom-visits": ["Khách đã đến showroom", rows.filter(c => showroomVisitCountFor(c) > 0)],
    "bought-customers": ["Khách đã mua căn bản", rows.filter(c => basicPurchaseCountFor(c) > 0)]
  }[type] || ["Khách đang quản lý", rows];
  const [title, matched] = config;
  openDetailModal(
    title,
    `${matched.length} khách`,
    customerDetailRows([...matched].sort(byDateDesc))
  );
}

function openDashboardDealDetail(type) {
  const reportDeals = currentReportDeals();
  const month = currentMonth();
  const pendingDeals = reportDeals.filter(isActiveDeal);
  const completedDeals = reportDeals.filter(isCompletedDeal);
  const monthCompleted = completedDeals.filter(d => monthOf(d.completedAt || d.dealDate || d.createdAt) === month);
  const depositDeals = reportDeals.filter(d => sameLabel(normalizeDealStatus(d.dealStatus), "depositStatus"));
  const canceledDeals = reportDeals.filter(d => sameLabel(normalizeDealStatus(d.dealStatus), "canceledStatus"));
  const config = {
    "pending-deals": ["Deal đang xử lý", pendingDeals],
    "completed-deals": ["Đơn hoàn thành", completedDeals],
    "month-revenue": ["Doanh số tháng", monthCompleted],
    "deposit-deals": [systemLabel("depositStatus"), depositDeals],
    "canceled-deals": [systemLabel("canceledStatus"), canceledDeals]
  }[type];
  if (!config) return;
  const [title, rows] = config;
  const total = rows.reduce((sum,d) => sum + dealAmount(d), 0);
  openDetailModal(
    title,
    `${rows.length} đơn · Tổng giá trị ${money(total)}`,
    dealDetailRows([...rows].sort((a,b) => String(orderDate(b)).localeCompare(String(orderDate(a))) || byDateDesc(a,b)))
  );
}

function activityDetailRows(rows) {
  return rows.length ? `<div class="detail-list">${rows.map(r => `
    <div class="activity-mini report-activity ${esc(r.bucket === "deal" || r.bucket === "completed" ? "deal" : r.taskType === "overdue" ? "bad" : "care")}">
      <div class="activity-mini-head">
        <div>
          <span class="activity-type">${esc(r.type || "Hoạt động")}</span>
          <b>${esc(r.customer || "Không tên")}</b>
        </div>
        <span class="muted">${esc(fmtDate(r.date) || "")}</span>
      </div>
      <div class="report-activity-meta">
        <span>${esc(r.owner || "Không rõ NV")}</span>
        <span>${esc(r.phone || "Không SĐT")}</span>
        ${r.channel ? `<span>${esc(r.channel)}</span>` : ""}
      </div>
      <div class="report-activity-body">${r.amount ? `<b>${esc(money(r.amount))}</b> · ` : ""}${esc(r.note || "Không có ghi chú.")}</div>
      ${r.customerId ? `<div class="actions"><button class="small" type="button" data-care-open="${esc(r.customerId)}">Mở khách</button></div>` : ""}
    </div>
  `).join("")}</div>` : `<div class="muted">Không có hoạt động trong nhóm này.</div>`;
}

function openDashboardActivityDetail(type) {
  const month = currentMonth();
  const reportCustomerIds = new Set(currentReportCustomers().map(c => c.id));
  const rows = [];
  if (type === "month-care") {
    careLogs
      .filter(l => !l.isDeleted && reportCustomerIds.has(l.customerId) && monthOf(careLogActivityDate(l)) === month)
      .forEach(l => {
        const c = customerById(l.customerId);
        rows.push({
          date: isoFromAny(careLogActivityDate(l)),
          type: "Chăm sóc",
          owner: l.owner || customerOwnerName(c) || l.ownerEmail,
          ownerEmail: l.ownerEmail || customerOwnerKey(c),
          customer: l.customerName || c.name || "",
          phone: c.phoneRaw || l.phoneRaw || l.phoneNormalized || c.phoneNormalized || "",
          channel: c.channel || "",
          note: [l.careChannel, l.careResult, l.showroomVisit ? "Đến showroom" : "", l.note].filter(Boolean).join(" · "),
          bucket: "care",
          customerId: l.customerId
        });
      });
  }
  if (type === "purchase-value") {
    currentReportDeals()
      .filter(d => isKpiRevenueDeal(d))
      .forEach(d => {
        const c = customerById(d.customerId);
        rows.push({
          date: isoFromAny(d.completedAt || d.dealDate || d.createdAt),
          type: "Mua căn bản",
          owner: orderOwnerName(d),
          ownerEmail: orderOwnerEmail(d),
          customer: orderCustomerName(d),
          phone: orderCustomerPhone(d),
          channel: c.channel || d.channel || "",
          amount: dealAmount(d),
          note: orderProductText(d) || d.note || "",
          bucket: "deal",
          customerId: d.customerId
        });
      });
  }
  const title = type === "purchase-value" ? "Giá trị mua căn bản" : "Lượt chăm tháng";
  const total = rows.reduce((sum,r) => sum + Number(r.amount || 0), 0);
  openDetailModal(
    title,
    type === "purchase-value" ? `${rows.length} lượt mua/cọc · Tổng ${money(total)}` : `${rows.length} lượt chăm trong tháng ${month}`,
    activityDetailRows(rows.sort((a,b) => String(b.date).localeCompare(String(a.date))))
  );
}

function quoteTemplateUrl() {
  return clean(settings.quoteTemplateUrl) || DEFAULT_SETTINGS.quoteTemplateUrl;
}

function quoteCustomerSummary(c) {
  return [
    `Khách hàng: ${c.name || ""}`,
    c.companyName ? `Công ty: ${c.companyName}` : "",
    `SĐT: ${c.phoneRaw || c.phoneNormalized || "Không SĐT"}`,
    c.address ? `Địa chỉ: ${c.address}` : "",
    c.channel ? `Kênh: ${c.channel}` : "",
    c.need ? `Nhu cầu/Sản phẩm: ${c.need}` : "",
    c.note ? `Ghi chú: ${c.note}` : ""
  ].filter(Boolean).join("\n");
}

function quoteProductSuggestions(c) {
  const terms = clean([c.need, c.note].filter(Boolean).join(" "))
    .split(/[^0-9A-Za-zÀ-ỹđĐ]+/u)
    .map(normalizeKey)
    .map(clean)
    .filter(part => part.length >= 3);
  if (!terms.length) return [];
  return products
    .filter(p => !p.isDeleted)
    .filter(p => {
      const text = normalizeKey([p.name, p.code, p.sku, p.size, p.surface, p.color, p.description].filter(Boolean).join(" "));
      return terms.some(part => text.includes(part));
    })
    .slice(0, 8);
}

async function logQuoteAction(customerId, action="openQuoteProposal") {
  try {
    await setDoc(doc(collection(db, "auditLogs")), {
      action, entity: "customers", entityId: customerId,
      email: currentUser.email || "", payloadJson: JSON.stringify({templateUrl: quoteTemplateUrl()}), createdAt: serverTimestamp()
    });
  } catch (err) {
    console.warn("Quote audit log skipped", err);
  }
}

function openQuoteProposal(customerId) {
  const c = customers.find(x => x.id === customerId);
  if (!c || !canSeeCustomer(c)) return notice("Không tìm thấy khách hoặc bạn không có quyền xem.", true);
  const ds = customerDeals(c.id);
  const logs = customerLogs(c.id).slice(0, 4);
  const suggestions = quoteProductSuggestions(c);
  const dealRows = ds.length ? ds.slice(0, 5).map(d => `
    <div class="detail-row">
      <div><b>${esc(orderStatusLabel(d))}</b> · ${esc(fmtDate(d.dealDate || d.createdAt))} · <b>${esc(money(d.amount || 0))}</b></div>
      <div class="muted">${esc(orderProductText(d) || "Chưa có sản phẩm")}</div>
    </div>
  `).join("") : `<div class="muted">Chưa có đơn hàng/deal nào.</div>`;
  const logRows = logs.length ? logs.map(l => `
    <div class="activity-mini care">
      <b>${esc(fmtDate(careLogActivityDate(l)))} · ${esc(l.careResult || l.status || "Chăm sóc")}</b>
      ${l.showroomVisit ? activityMetaPills(["Đến showroom"]) : ""}
      <span class="muted">${esc(l.note || "")}</span>
    </div>
  `).join("") : `<div class="muted">Chưa có lịch sử chăm sóc gần đây.</div>`;
  const productRows = suggestions.length ? suggestions.map(p => `
    <div class="detail-row">
      <b>${esc(p.name || p.code || "Sản phẩm")}</b>
      <div class="muted">${esc([p.code || p.sku, p.size, p.surface, p.color, p.priceText || (p.price ? money(p.price) : "")].filter(Boolean).join(" · "))}</div>
    </div>
  `).join("") : `<div class="muted">Chưa gợi ý được sản phẩm từ nhu cầu hiện tại.</div>`;
  openDetailModal(
    `Báo giá/Đề xuất - ${c.name || "Khách hàng"}`,
    `${c.phoneRaw || c.phoneNormalized || "Không SĐT"} · ${customerOwnerName(c)}`,
    `
      <div class="detail-list">
        <div class="detail-row">
          <h3 style="margin:0 0 8px">Thông tin để báo giá</h3>
          <div class="info-grid">
            <div class="info-cell"><span class="muted">Khách hàng</span><b>${esc(c.name || "")}</b></div>
            <div class="info-cell"><span class="muted">SĐT</span><b>${esc(c.phoneRaw || c.phoneNormalized || "Không SĐT")}</b></div>
            <div class="info-cell"><span class="muted">Công ty</span><b>${esc(c.companyName || "-")}</b></div>
            <div class="info-cell"><span class="muted">Kênh</span><b>${esc(c.channel || "-")}</b></div>
            <div class="info-cell"><span class="muted">Phụ trách</span><b>${esc(customerOwnerName(c))}</b></div>
            <div class="info-cell"><span class="muted">Tình trạng</span><b>${esc(c.status || "-")}</b></div>
          </div>
          <div class="muted" style="margin-top:8px;white-space:pre-wrap">${esc(quoteCustomerSummary(c))}</div>
          <div class="actions" style="margin-top:10px">
            <button class="small primary" type="button" data-quote-create-deal="${esc(c.id)}">Tạo đơn từ báo giá</button>
            <button class="small" type="button" data-quote-open-template="${esc(c.id)}">Mở template báo giá</button>
            <button class="small" type="button" data-quote-copy="${esc(c.id)}">Copy thông tin</button>
          </div>
        </div>
        <div class="grid2">
          <div class="detail-row">
            <h3 style="margin:0 0 8px">Đơn hàng/deal liên quan</h3>
            <div class="detail-list">${dealRows}</div>
          </div>
          <div class="detail-row">
            <h3 style="margin:0 0 8px">Chăm sóc gần đây</h3>
            <div class="detail-list">${logRows}</div>
          </div>
        </div>
        <div class="detail-row">
          <h3 style="margin:0 0 8px">Gợi ý sản phẩm từ nhu cầu</h3>
          <div class="detail-list">${productRows}</div>
        </div>
      </div>
    `
  );
  logQuoteAction(c.id);
}

function createDealFromQuote(customerId) {
  const c = customers.find(x => x.id === customerId);
  if (!c || !canEditCustomer(c)) return notice("Bạn không có quyền tạo đơn cho khách này.", true);
  closeDetailModal();
  openDrawer(c.id, "deal");
  $("dealNote").value = [`Tạo từ Báo giá/Đề xuất ngày ${new Date().toLocaleDateString("vi-VN")}`, c.note || ""].filter(Boolean).join("\n");
  logQuoteAction(c.id, "createDealFromQuote");
}

function openQuoteTemplate(customerId) {
  const c = customers.find(x => x.id === customerId);
  if (c) logQuoteAction(c.id, "openQuoteTemplate");
  window.open(quoteTemplateUrl(), "_blank", "noopener");
}

function copyQuoteCustomerInfo(customerId) {
  const c = customers.find(x => x.id === customerId);
  if (!c) return;
  navigator.clipboard?.writeText(quoteCustomerSummary(c));
  notice("Đã copy thông tin báo giá.");
}

async function snoozeTask(customerId, days=1) {
  const c = customers.find(x => x.id === customerId);
  if (!c || !canEditCustomer(c)) return notice("Bạn không có quyền dời lịch khách này.", true);
  const nextCareDate = addDaysIso(todayIso(), days);
  try {
    await callCrmRpc("crm_snooze_customer", {
      p_customer_id: c.id,
      p_next_care_date: nextCareDate,
      p_follow: computedFollowStatus({...c, nextCareDate}),
      p_days: days
    });
    notice(`Đã dời lịch chăm sang ${fmtDate(nextCareDate)}.`);
  } catch (err) {
    notice(authMessage(err), true);
  }
}

function jumpToPendingKpi() {
  if (!isManager()) return;
  setMainView("kpi");
  if (!legacyKpiPreCutover()) {
    loadKpiTeamGlobalQueue({force:true}).catch(err => notice("Không tải được KPI hiện tại cần duyệt: " + authMessage(err), true));
    return;
  }
  setTimeout(() => {
    $("kpiApprovalPanel")?.scrollIntoView({behavior: "smooth", block: "start"});
    $("kpiApprovalPanel")?.classList.add("focus-flash");
    setTimeout(() => $("kpiApprovalPanel")?.classList.remove("focus-flash"), 1400);
  }, 80);
}

function jumpToLegacyPendingKpi() {
  if (!isManager()) return;
  setMainView("kpi");
  setKpiTeamMode("library");
  setTimeout(() => {
    $("kpiApprovalPanel")?.scrollIntoView({behavior: "smooth", block: "start"});
    $("kpiApprovalPanel")?.classList.add("focus-flash");
    setTimeout(() => $("kpiApprovalPanel")?.classList.remove("focus-flash"), 1400);
  }, 80);
}

function openChannelReportDetail(area) {
  if (!area) return;
  const rows = [...(area.customers || [])].sort(byDateDesc);
  openDetailModal(
    `Chi tiết kênh: ${area.label}`,
    `${rows.length} khách trong bộ lọc báo cáo hiện tại`,
    customerDetailRows(rows)
  );
}

function handleChannelReportClick(event) {
  const canvas = $("channelReportChart");
  if (!canvas || !channelReportHitAreas.length) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const area = channelReportHitAreas.find(item =>
    x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h
  );
  if (area) openChannelReportDetail(area);
}

function handleChannelReportPointer(event) {
  const canvas = $("channelReportChart");
  if (!canvas || !channelReportHitAreas.length) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const hit = channelReportHitAreas.some(item =>
    x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h
  );
  canvas.style.cursor = hit ? "pointer" : "";
}

function careWorkGroups() {
  const visible = customers.filter(canSeeCustomer);
  const openRows = visible.filter(c => !isCustomerClosed(c));
  const todayRows = openRows.filter(c => clean(c.nextCareDate) === todayIso()).sort((a,b) => clean(a.name).localeCompare(clean(b.name), "vi"));
  const overdueRows = openRows.filter(isCareOverdue).sort((a,b) => clean(a.nextCareDate).localeCompare(clean(b.nextCareDate)) || clean(a.name).localeCompare(clean(b.name), "vi"));
  const noDateRows = openRows.filter(c => !clean(c.nextCareDate)).sort(byDateDesc);
  const activeRows = openRows.filter(c => clean(c.nextCareDate) && !isCareDue(c)).sort((a,b) => clean(a.nextCareDate).localeCompare(clean(b.nextCareDate)));
  return {visible, openRows, todayRows, overdueRows, noDateRows, activeRows};
}

function renderCareWorkSummary() {
  const box = $("careWorkSummary");
  if (!box) return;
  const {openRows, todayRows, overdueRows, noDateRows, activeRows} = careWorkGroups();
  $("careWorkSummaryText").textContent = `${openRows.length} công việc/khách đang mở`;
  const cards = [
    ["today", "Hôm nay", todayRows.length, "Lịch hẹn trong ngày", todayRows.length ? "warn" : ""],
    ["overdue", "Quá hạn", overdueRows.length, "Cần xử lý trước", overdueRows.length ? "bad" : ""],
    ["no-date", "Chưa hẹn", noDateRows.length, "Khách chưa có ngày chăm", noDateRows.length ? "warn" : "quiet"],
    ["active", "Đang chăm", activeRows.length, "Có lịch hẹn sắp tới", "quiet"]
  ];
  box.innerHTML = cards.map(([type, label, count, hint, cls]) => `
    <button class="care-work-card ${esc(cls)}" type="button" data-care-work-detail="${esc(type)}">
      <span>${esc(label)}</span>
      <b>${esc(count)}</b>
      <small>${esc(hint)}</small>
    </button>
  `).join("");
}

function hydrateTaskFilters() {
  if (!$("taskOwnerFilter")) return;
  const currentOwner = $("taskOwnerFilter").value;
  fillSelect("taskOwnerFilter", ownerOptions(), "", "Tất cả nhân viên");
  if (ownerOptions().some(o => clean(o.email) === currentOwner || clean(o.name) === currentOwner) || currentOwner === "") $("taskOwnerFilter").value = currentOwner;
  if (!isManager()) {
    $("taskOwnerFilter").value = ownerEmail();
    $("taskOwnerFilter").disabled = true;
  } else {
    $("taskOwnerFilter").disabled = false;
  }
}

function resetTaskFilters() {
  $("taskScopeFilter").value = "priority";
  $("taskSearchBox").value = "";
  $("taskOwnerFilter").value = isManager() ? "" : ownerEmail();
  resetPaging("tasks");
  renderTaskBoard();
}

function taskTypeForCustomer(c) {
  if (isCareOverdue(c)) return "overdue";
  if (clean(c.nextCareDate) === todayIso()) return "today";
  if (!clean(c.nextCareDate)) return "no-date";
  return "upcoming";
}

function taskLabel(type) {
  return {
    overdue: "Quá hạn",
    today: "Hôm nay",
    "no-date": "Chưa hẹn",
    upcoming: "Sắp tới"
  }[type] || "Công việc";
}

function taskClass(type) {
  return type === "overdue" ? "bad" : type === "today" || type === "no-date" ? "warn" : "quiet";
}

function taskRows() {
  const scope = clean($("taskScopeFilter")?.value) || "priority";
  const owner = clean($("taskOwnerFilter")?.value);
  const key = normalizeKey($("taskSearchBox")?.value || "");
  return customers
    .filter(canSeeCustomer)
    .filter(c => !isCustomerClosed(c))
    .map(c => ({customer: c, type: taskTypeForCustomer(c), delta: careDeltaDays(c)}))
    .filter(t => {
      if (scope === "priority") return ["overdue", "today", "no-date"].includes(t.type);
      if (scope !== "all" && t.type !== scope) return false;
      return true;
    })
    .filter(t => {
      const c = t.customer;
      if (owner && !sameIdentity(customerOwnerKey(c), owner) && !sameIdentity(customerOwnerName(c), owner)) return false;
      if (!key) return true;
      return normalizeKey([c.name, c.companyName, c.customerType, c.phoneRaw, c.phoneNormalized, c.address, c.channel, customerOwnerName(c), c.status, c.need, c.note, computedFollowStatus(c), careScheduleText(c)].join(" ")).includes(key);
    })
    .sort((a,b) => {
      const rank = {overdue: 0, today: 1, "no-date": 2, upcoming: 3};
      return (rank[a.type] - rank[b.type]) || clean(a.customer.nextCareDate).localeCompare(clean(b.customer.nextCareDate)) || clean(a.customer.name).localeCompare(clean(b.customer.name), "vi");
    });
}

function renderTaskBoard() {
  const list = $("needCareList");
  const panel = $("needCarePanel");
  if (!list || !panel) return;
  hydrateTaskFilters();
  const rows = taskRows();
  const hasUrgent = rows.some(t => t.type === "overdue" || t.type === "today");
  panel.classList.toggle("care-alert", hasUrgent);
  if (!rows.length) {
    list.className = "care-empty";
    list.textContent = "Không có công việc phù hợp với bộ lọc.";
    renderPager("taskPager", "tasks", 0, "task");
    return;
  }
  list.className = "task-board";
  const page = pageRows("tasks", rows);
  list.innerHTML = page.map(({customer: c, type, delta}) => {
    const dateText = clean(c.nextCareDate) ? fmtDate(c.nextCareDate) : "Chưa đặt lịch";
    const overdueText = type === "overdue" ? ` · Quá ${esc(delta)} ngày` : "";
    const scheduleText = careScheduleText(c);
    return `
      <div class="task-row ${esc(taskClass(type))}">
        <div>
          <div class="task-title">${esc(c.name || "Không tên")}</div>
          <div class="muted">${esc(c.companyName || c.channel || "")}</div>
          <div class="muted">${esc(c.phoneRaw || c.phoneNormalized || "Không SĐT")}</div>
        </div>
        <div>
          <span class="pill ${esc(careSchedulePillClass(c))}">${esc(taskLabel(type))}</span>
          <div class="muted">${esc(dateText)}${overdueText}</div>
          <div class="muted">${esc(scheduleText)}</div>
        </div>
        <div>
          <b>${esc(customerOwnerName(c))}</b>
          <div class="muted">${esc(c.need || c.note || "Chưa có nội dung công việc")}</div>
        </div>
        <div class="task-actions">
          <button class="small primary" type="button" data-care-open="${esc(c.id)}">Chăm sóc</button>
          <button class="small" type="button" data-open-deal="${esc(c.id)}">Ghi mua</button>
          <button class="small" type="button" data-task-snooze="${esc(c.id)}" data-days="1">Dời mai</button>
        </div>
      </div>
    `;
  }).join("");
  renderPager("taskPager", "tasks", rows.length, "task");
}

function openCareWorkDetail(type) {
  const groups = careWorkGroups();
  const config = {
    today: ["Lịch hẹn hôm nay", "khách có lịch chăm trong ngày", groups.todayRows],
    overdue: ["Quá hạn chăm", "khách đã quá hạn chăm", groups.overdueRows],
    "no-date": ["Khách chưa có lịch hẹn", "khách chưa được đặt ngày chăm tiếp", groups.noDateRows],
    active: ["Khách đang chăm", "khách có lịch chăm sắp tới", groups.activeRows]
  }[type];
  if (!config) return;
  const [title, subtitle, rows] = config;
  openDetailModal(title, `${rows.length} ${subtitle}`, customerDetailRows(rows));
}

function renderNeedCare() {
  renderCareWorkSummary();
  renderTaskBoard();
}

function todayCareRows() {
  return customers
    .filter(canSeeCustomer)
    .filter(c => !isCustomerClosed(c) && clean(c.nextCareDate) === todayIso())
    .sort((a,b) => clean(a.name).localeCompare(clean(b.name), "vi"));
}

function todayCareReminderKey(rows) {
  const ids = rows.map(c => c.id).sort().join(",");
  return `crmTodayCare:${ownerEmail() || "guest"}:${todayIso()}:${ids}`;
}

function renderTodayCare() {
  const rows = todayCareRows();
  const list = $("todayCareList");
  const title = $("todayCarePanel")?.querySelector("h3");
  if (!list) return;
  if (title) title.textContent = rows.length ? `Lịch hẹn hôm nay (${rows.length})` : "Lịch hẹn hôm nay";
  if (!rows.length) {
    list.className = "care-empty";
    list.textContent = "Không có lịch hẹn hôm nay.";
    return;
  }
  list.className = "today-list";
  list.innerHTML = rows.map(c => `
    <div class="today-item">
      <b>${esc(c.name)}</b>
      <div class="today-meta">${esc(c.phoneRaw || c.phoneNormalized || "Không SĐT")} · ${esc(customerOwnerName(c))}</div>
      <div><span class="pill ${esc(careSchedulePillClass(c))}">${esc(careScheduleText(c))}</span></div>
      ${c.note ? `<div class="muted">${esc(c.note)}</div>` : ""}
      <button class="small" type="button" data-care-open="${esc(c.id)}">Mở chăm sóc</button>
    </div>
  `).join("");
}

function notifyTodayCare(force=false) {
  const rows = todayCareRows();
  if (!rows.length) return;
  const key = todayCareReminderKey(rows);
  if (!force && localStorage.getItem(key)) return;
  localStorage.setItem(key, "1");
  const body = rows.slice(0,3).map(c => c.name).join(", ") + (rows.length > 3 ? ` và ${rows.length - 3} khách khác` : "");
  notice(`Hôm nay có ${rows.length} lịch hẹn chăm khách.`, false, "warn");
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("CRM - Lịch hẹn hôm nay", {body});
  }
}

async function enableBrowserNotifications() {
  if (!("Notification" in window)) return notice("Trình duyệt này chưa hỗ trợ thông báo desktop.", true);
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return notice("Trình duyệt chưa cho phép thông báo. Bạn vẫn sẽ thấy nhắc trong web.", true);
  notifyTodayCare(true);
  notice("Đã bật nhắc lịch hẹn trên trình duyệt.");
}

function renderChannelQuickFilters() {
  const box = $("channelQuickFilters");
  if (!box) return;
  const counts = customers.filter(canSeeCustomer).reduce((acc, c) => {
    const type = channelQuickType(c.channel);
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {company:0, social:0, other:0});
  $("quickCompanyCount").textContent = counts.company || 0;
  $("quickSocialCount").textContent = counts.social || 0;
  $("quickOtherCount").textContent = counts.other || 0;
  const unassigned = customers.filter(c => !clean(c.ownerUserId) && !clean(c.ownerEmail));
  if ($("quickUnassignedCount")) $("quickUnassignedCount").textContent = unassigned.length;
  $("quickUnassignedCard")?.classList.toggle("hide", !isManager());
  box.querySelectorAll("[data-channel-quick]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.channelQuick === activeChannelQuickFilter);
  });
  renderUnassignedPool(unassigned);
}

function renderUnassignedPool(rows = customers.filter(c => !clean(c.ownerUserId) && !clean(c.ownerEmail))) {
  const panel = $("unassignedPoolPanel");
  const list = $("unassignedPoolList");
  if (!panel || !list) return;
  const visible = isManager() && activeChannelQuickFilter === "unassigned";
  panel.classList.toggle("hide", !visible);
  if (!visible) return;

  const validIds = new Set(rows.map(c => c.id));
  [...selectedUnassignedCustomerIds].forEach(id => { if (!validIds.has(id)) selectedUnassignedCustomerIds.delete(id); });
  fillSelect("unassignedEmployeeSelect", ownerOptions(), "-- Chọn nhân viên ACTIVE --");
  list.innerHTML = rows.length ? rows.map(c => {
    const previous = previousAssignmentFor(c.id);
    const endedAt = previous?.endedAt || c.updatedAt;
    const unassignedDays = endedAt ? Math.max(0, Math.floor((Date.now() - (toDate(endedAt)?.getTime() || Date.now())) / 86400000)) : 0;
    return `<label class="unassigned-pool-row">
      <input type="checkbox" data-unassigned-customer="${esc(c.id)}" ${selectedUnassignedCustomerIds.has(c.id) ? "checked" : ""}>
      <span><b>${esc(c.name || "Khách hàng")}</b><small class="muted">${esc(c.phoneRaw || c.phoneNormalized || "Không SĐT")}</small></span>
      <span>${esc(c.customerType || "Chưa phân loại")}<small class="muted">${esc(c.channel || "Chưa có kênh")}</small></span>
      <span>Trước: ${esc(previous?.employeeNameSnapshot || previous?.employeeEmailSnapshot || "Không rõ")}<small class="muted">Mất phân công: ${esc(fmtDate(endedAt) || "-")}</small></span>
      <span>${esc(c.nextCareDate ? `Hẹn ${fmtDate(c.nextCareDate)}` : "Chưa hẹn chăm")}<small class="muted">${esc(unassignedDays)} ngày chờ phân bổ</small></span>
    </label>`;
  }).join("") : `<div class="muted">Không có khách chờ phân bổ.</div>`;
}

async function assignSelectedUnassignedCustomers() {
  if (!isManager()) return notice("Chỉ manager/admin được phân bổ khách.", true);
  const employeeId = clean($("unassignedEmployeeSelect")?.value);
  const ids = [...selectedUnassignedCustomerIds];
  if (!employeeId) return notice("Vui lòng chọn nhân viên nhận khách.", true);
  if (!ids.length) return notice("Vui lòng chọn ít nhất một khách hàng.", true);
  const reason = clean($("unassignedReason")?.value) || "Phân bổ từ danh sách khách chờ";
  if (!confirm(`Giao ${ids.length} khách đã chọn cho nhân viên này?`)) return;
  try {
    await callCrmRpc("crm_bulk_assign_customers", {
      p_customer_ids: ids,
      p_employee_id: employeeId,
      p_reason: reason
    });
    selectedUnassignedCustomerIds.clear();
    if ($("unassignedReason")) $("unassignedReason").value = "";
    notice(`Đã phân bổ ${ids.length} khách hàng.`);
  } catch (err) {
    notice("Không phân bổ được khách: " + authMessage(err), true);
  }
}

function exportUnassignedCustomers() {
  const rows = customers.filter(c => !clean(c.ownerUserId) && !clean(c.ownerEmail));
  if (!rows.length) return notice("Không có khách chờ phân bổ để xuất.", true);
  exportXlsx([{
    name:"Khach cho phan bo",
    rows:[
      ["Customer ID","Khách hàng","SĐT","Loại khách","Kênh","Mức tiềm năng","Owner trước","Ngày mất assignment","Lần chăm cuối","Hẹn tiếp"],
      ...rows.map(c => {
        const previous = previousAssignmentFor(c.id);
        return [c.id,c.name || "",c.phoneRaw || c.phoneNormalized || "",c.customerType || "",c.channel || "",potentialLevelFor(c),previous?.employeeEmailSnapshot || previous?.employeeNameSnapshot || "",fmtDate(previous?.endedAt),fmtDate(c.lastContactAt),fmtDate(c.nextCareDate)];
      })
    ]
  }], `crm-khach-cho-phan-bo-${todayIso()}`);
}

function renderCustomers() {
  renderChannelQuickFilters();
  const rows = visibleCustomers();
  const page = pageRows("customers", rows);
  $("customerRows").innerHTML = page.length ? page.map(c => {
    const st = latestDealStatus(c) || c.status || "";
    const careStatus = computedFollowStatus(c);
    const purchaseTimes = basicPurchaseCountFor(c);
    const purchaseValue = basicPurchaseValueFor(c);
    const showroomVisits = showroomVisitCountFor(c);
    const rowClass = ["customer-row", isFailStatus(st) || isCanceledDeal(st) ? "row-fail" : "", purchaseTimes ? "row-success row-vip" : "", isCareOverdue(c) ? "row-overdue" : ""].filter(Boolean).join(" ");
    const careBadge = `<br><span class="pill ${esc(careSchedulePillClass(c))}">${esc(careScheduleText(c))}</span>`;
    const contactText = c.phoneRaw || c.phoneNormalized || "Không SĐT";
    const customerMeta = [c.companyName, c.customerType, c.address].filter(Boolean).join(" · ");
    const statusClass = isFailStatus(st) || isCanceledDeal(st) ? "red" : purchaseTimes ? "green" : "orange";
    return `<tr class="${rowClass}">
      <td>
        <div class="customer-cell">
          <b>${esc(c.name || "Không tên")}</b>
          ${customerMeta ? `<span>${esc(customerMeta)}</span>` : ""}
        </div>
      </td>
      <td>
        <div class="phone-cell">
          <b>${esc(contactText)}</b>
          ${(c.phoneRaw || c.phoneNormalized) ? `<button class="quick-copy" type="button" data-copy-phone="${esc(c.phoneRaw || c.phoneNormalized)}">Copy</button>` : ""}
        </div>
      </td>
      <td>${esc(fmtDate(c.createdAt))}</td>
      <td class="source-col">${c.channel ? `<span class="pill">${esc(c.channel)}</span>` : ""}</td>
      <td>${esc(customerOwnerName(c))}</td>
      <td><span class="pill ${statusClass}">${esc(c.status || st || "Chưa rõ")}</span></td>
      <td><span class="pill ${esc(careSchedulePillClass(c))}">${esc(careStatus)}</span></td>
      <td>
        <div class="deal-counts">
          <span><b>${esc(showroomVisits)}</b> đến showroom</span>
          <span><b>${esc(purchaseTimes)}</b> lần mua</span>
          <span><b>${esc(money(purchaseValue))}</b> giá trị</span>
        </div>
      </td>
      <td>${esc(fmtDate(c.nextCareDate))}${careBadge}</td>
      <td class="note-col">${esc(c.note || "")}</td>
      <td class="action-col"><div class="row-actions">
        <button class="small primary" data-open-care="${esc(c.id)}">Chăm sóc KH</button>
        <button class="small" data-open-deal="${esc(c.id)}">Mua căn bản</button>
        ${legacyKpiPreCutover() ? `<button class="small primary" data-open-kpi-proposal-customer="${esc(c.id)}">Đề xuất KPI</button>` : ""}
      </div></td>
    </tr>`;
  }).join("") : `<tr><td colspan="11" class="muted">Không có dữ liệu phù hợp.</td></tr>`;
  renderPager("customerPager", "customers", rows.length, "khách");
}

function renderKpiTable() {
  const week = clean($("filterWeek").value);
  // KPI dùng tháng KPI riêng; bộ lọc Tháng của danh sách khách để trống thì không lọc khách.
  const month = clean($("kpiRuleMonth").value) || currentMonth();
  const monthRules = activeKpiRules();
  $("exportKpiBtn")?.classList.toggle("hide", !isManager());
  if ($("exportKpiBtn")) $("exportKpiBtn").textContent = legacyKpiPreCutover() ? "Xuất KPI" : "Xuất KPI cũ";
  $("openKpiProposalBtn")?.classList.toggle("hide", !isSale() || !legacyKpiPreCutover());
  $("openKpiProposalBtnTop")?.classList.toggle("hide", !legacyKpiPreCutover());
  const ownerKeys = reportOwnerKeys();
  const dynamicHeads = monthRules.map(rule => `
    <th>
      <span title="${esc(rule.description || "Chưa có diễn giải.")}">${esc(rule.name)}</span>
      ${rule.description ? `<div><button class="small" type="button" data-kpi-rule-explain="${esc(rule.id)}">Diễn giải</button></div>` : ""}
    </th>
  `).join("");
  $("kpiHead").innerHTML = `<tr>
    <th>Nhân viên</th><th>Tổng khách</th><th>Khách mới kỳ này</th><th>Lượt chăm</th><th>${esc(systemLabel("dueFollow"))}</th><th>Quá hạn</th><th>Đến showroom</th><th>Khách đã mua</th><th>Số lần mua</th><th>Giá trị mua</th>${dynamicHeads}<th>Tỉ lệ mua</th>
  </tr>`;
  $("kpiRows").innerHTML = ownerKeys.map(o => {
    const profile = ownerProfileByValue(o);
    const cs = customers.filter(c => canSeeCustomer(c) && (sameIdentity(customerOwnerKey(c), o) || sameIdentity(c.owner, o)));
    if (!cs.length && !isManager() && !monthRules.some(rule => kpiRuleAppliesToOwner(rule, o))) return "";
    const ids = new Set(cs.map(c => c.id));
    const acquired = customers.filter(c => canSeeCustomer(c) && customerWasAcquiredBy(c, o));
    const monthLead = week ? acquired.filter(c => weekOf(c.createdAt) === week).length : month ? acquired.filter(c => monthOf(c.createdAt) === month).length : acquired.length;
    const careCount = careLogs.filter(l => !l.isDeleted && ids.has(l.customerId) && (week ? weekOf(careLogActivityDate(l)) === week : month ? monthOf(careLogActivityDate(l)) === month : true)).length;
    const due = cs.filter(isCareDue).length;
    const overdue = cs.filter(isCareOverdue).length;
    const showroomVisits = cs.reduce((sum, c) => sum + showroomVisitCountFor(c), 0);
    const boughtCustomerCount = cs.filter(c => basicPurchaseCountFor(c) > 0).length;
    const purchaseTimes = cs.reduce((sum, c) => sum + basicPurchaseCountFor(c), 0);
    const purchaseValue = cs.reduce((sum, c) => sum + basicPurchaseValueFor(c), 0);
    const rate = cs.length ? Math.round(boughtCustomerCount / cs.length * 100) : 0;
    const ruleCells = monthRules.map(rule => {
      if (!kpiRuleAppliesToOwner(rule, o)) return `<td><span class="muted">Không gán</span></td>`;
      const value = kpiRuleValue(rule, o);
      const target = kpiRuleTargetForOwner(rule, o);
      const cls = target && value >= target ? "green" : "";
      return `<td><button class="kpi-progress-btn ${cls}" type="button" title="Xem chi tiết KPI đã gửi" data-kpi-owner-detail="${esc(rule.id)}" data-owner-key="${esc(o)}">${kpiProgressHtml(value, target)}</button></td>`;
    }).join("");
    return `<tr class="kpi-row"><td><b>${esc(profile.name || o)}</b><div class="muted">${esc(profile.email && profile.email !== profile.name ? profile.email : "")}</div></td><td>${cs.length}</td><td>${monthLead}</td><td>${careCount}</td><td>${due}</td><td>${overdue}</td><td>${showroomVisits}</td><td>${boughtCustomerCount}</td><td>${purchaseTimes}</td><td>${esc(money(purchaseValue))}</td>${ruleCells}<td><span class="pill ${rate >= 30 ? "green" : rate ? "orange" : ""}">${rate}%</span></td></tr>`;
  }).join("") || `<tr><td colspan="${11 + monthRules.length}" class="muted">Chưa có KPI.</td></tr>`;
}

function kpiProposalStatusLabel(p) {
  if (isApprovedKpiProposal(p)) return "Đã duyệt";
  if (isRejectedKpiProposal(p)) return "Từ chối";
  return "Chờ duyệt";
}

function kpiProposalStatusClass(p) {
  if (isApprovedKpiProposal(p)) return "green";
  if (isRejectedKpiProposal(p)) return "red";
  return "orange";
}

function kpiProgressHtml(value, target) {
  const safeValue = Number(value || 0);
  const safeTarget = Number(target || 0);
  const pct = safeTarget ? Math.min(100, Math.round(safeValue / safeTarget * 100)) : 0;
  const done = safeTarget && safeValue >= safeTarget;
  return `
    <div class="kpi-progress ${done ? "done" : ""}">
      <div class="kpi-progress-top"><b>${esc(safeValue)}/${esc(safeTarget)}</b><span>${esc(pct)}%</span></div>
      <div class="kpi-progress-bar"><span style="width:${esc(pct)}%"></span></div>
    </div>
  `;
}

function ownKpiProposals() {
  return kpiProposals
    .filter(p => !p.isDeleted)
    .filter(p => [ownerEmail(), ownerName()].some(key => kpiProposalMatchesOwner(p, key)))
    .sort(byDateDesc);
}

function renderMyKpiProposalPanel() {
  if (!$("kpiMyProposalList")) return;
  const rows = ownKpiProposals();
  const statusFilter = clean($("myKpiProposalStatus")?.value);
  const visibleRows = statusFilter ? rows.filter(p => kpiProposalStatusKey(p) === statusFilter) : rows;
  const pending = rows.filter(isPendingKpiProposal).length;
  const approved = rows.filter(isApprovedKpiProposal).length;
  const rejected = rows.filter(isRejectedKpiProposal).length;
  $("kpiMyProposalList").innerHTML = rows.length ? `
    <div class="detail-meta" style="margin-bottom:8px">
      <span>Chờ duyệt: ${esc(pending)}</span>
      <span>Đã duyệt: ${esc(approved)}</span>
      <span>Từ chối: ${esc(rejected)}</span>
      ${statusFilter ? `<span>Đang lọc: ${esc(kpiProposalStatusLabel({status: statusFilter}))}</span>` : ""}
    </div>
    ${visibleRows.length ? visibleRows.map(kpiProposalCard).join("") : `<div class="muted">Không có đề xuất KPI trong trạng thái đang lọc.</div>`}
  ` : `<div class="muted">Bạn chưa gửi đề xuất KPI nào.</div>`;
}

function resetMyKpiProposalFilter() {
  $("myKpiProposalStatus").value = "";
  renderMyKpiProposalPanel();
}

function kpiReportData() {
  const week = clean($("filterWeek").value);
  const month = clean($("kpiRuleMonth").value) || currentMonth();
  const monthRules = activeKpiRules();
  const ownerKeys = reportOwnerKeys();
  const summaryRows = ownerKeys.map(o => {
    const profile = ownerProfileByValue(o);
    const cs = customers.filter(c => canSeeCustomer(c) && (sameIdentity(customerOwnerKey(c), o) || sameIdentity(c.owner, o)));
    const ids = new Set(cs.map(c => c.id));
    const careCount = careLogs.filter(l => !l.isDeleted && ids.has(l.customerId) && (week ? weekOf(careLogActivityDate(l)) === week : month ? monthOf(careLogActivityDate(l)) === month : true)).length;
    const boughtCustomerCount = cs.filter(c => basicPurchaseCountFor(c) > 0).length;
    const purchaseTimes = cs.reduce((sum, c) => sum + basicPurchaseCountFor(c), 0);
    const purchaseValue = cs.reduce((sum, c) => sum + basicPurchaseValueFor(c), 0);
    const showroomVisits = cs.reduce((sum, c) => sum + showroomVisitCountFor(c), 0);
    const rate = cs.length ? Math.round(boughtCustomerCount / cs.length * 100) : 0;
    const row = {
      owner: clean(profile.name || o),
      email: clean(profile.email && profile.email !== profile.name ? profile.email : o),
      totalCustomers: cs.length,
      monthLead: (() => {
        const acquired = customers.filter(c => canSeeCustomer(c) && customerWasAcquiredBy(c, o));
        return week ? acquired.filter(c => weekOf(c.createdAt) === week).length : month ? acquired.filter(c => monthOf(c.createdAt) === month).length : acquired.length;
      })(),
      careCount,
      dueCare: cs.filter(isCareDue).length,
      overdueCare: cs.filter(isCareOverdue).length,
      showroomVisits,
      boughtCustomers: boughtCustomerCount,
      purchaseTimes,
      purchaseValue,
      conversionRate: rate,
      rules: {}
    };
    monthRules.forEach(rule => {
      if (!kpiRuleAppliesToOwner(rule, o)) return;
      const target = kpiRuleTargetForOwner(rule, o);
      row.rules[rule.id] = {
        name: rule.name,
        value: kpiRuleValue(rule, o),
        target
      };
    });
    return row;
  }).filter(row => row.totalCustomers || isManager());
  const proposalRows = kpiProposals
    .filter(p => !p.isDeleted && (kpiProposalMonth(p) === month || isPendingKpiProposal(p)))
    .sort(byDateDesc);
  return {month, week, monthRules, summaryRows, proposalRows};
}

function excelCell(value, tag="td", extra="") {
  return `<${tag} style="mso-number-format:'\\@';border:1px solid #d9d9d9;padding:6px;${extra}">${esc(value ?? "")}</${tag}>`;
}

function personExportCell(name, email) {
  const n = clean(name);
  const e = clean(email);
  if (n && e && normalizeKey(n) !== normalizeKey(e)) return `${n} | ${e}`;
  return n || e;
}

function exportXlsx(sheets, fileBaseName) {
  const XLSX = window.XLSX;
  if (!XLSX?.utils?.aoa_to_sheet || !XLSX?.writeFile) {
    notice("Chưa tải được thư viện xuất XLSX. Hãy tải lại trang rồi thử lại.", true);
    return false;
  }
  const workbook = XLSX.utils.book_new();
  sheets.forEach((sheet, index) => {
    const rows = (sheet.rows || []).map(row => row.map(value => value == null ? "" : value));
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet["!cols"] = rows[0]?.map((_, colIndex) => ({
      wch: Math.min(42, Math.max(12, ...rows.map(row => clean(row[colIndex]).length + 2)))
    })) || [];
    const rawName = clean(sheet.name) || `Sheet ${index + 1}`;
    XLSX.utils.book_append_sheet(workbook, worksheet, rawName.slice(0, 31));
  });
  XLSX.writeFile(workbook, `${fileBaseName}.xlsx`, { compression: true });
  return true;
}

async function logKpiExport({month, week, summaryRows, proposalRows, monthRules}) {
  await setDoc(doc(collection(db, "auditLogs")), {
    action: "exportKpiReport",
    entity: "kpiReports",
    entityId: month,
    email: currentUser?.email || "",
    payloadJson: JSON.stringify({
      month,
      week,
      summaryRows: summaryRows.length,
      proposals: proposalRows.length,
      rules: monthRules.map(r => ({id:r.id, name:r.name, target:r.target || 0, assignedOwners:kpiRuleAssignedOwners(r)}))
    }),
    createdAt: serverTimestamp()
  });
}

async function exportKpiReport() {
  if (!isManager()) return notice("Chỉ admin/manager được xuất báo cáo KPI.", true);
  const report = kpiReportData();
  const {month, week, monthRules, summaryRows, proposalRows} = report;
  const dynamicHeads = monthRules.flatMap(rule => [`${rule.name} - đạt`, `${rule.name} - chỉ tiêu`, `${rule.name} - tỷ lệ`]);
  const summaryHeader = [
    "Nhân viên / Email","Tổng khách","Khách mới kỳ này","Lượt chăm",
    systemLabel("dueFollow"), "Quá hạn", "Đến showroom", "Khách đã mua",
    "Số lần mua", "Giá trị mua", "Tỉ lệ mua", ...dynamicHeads
  ];
  const summaryTable = [
    [`Báo cáo KPI cũ tháng ${month}${week ? " · tuần " + week : ""}`, ...Array(Math.max(0, summaryHeader.length - 1)).fill("")],
    summaryHeader,
    ...summaryRows.map(row => [
      personExportCell(row.owner, row.email), row.totalCustomers, row.monthLead, row.careCount,
      row.dueCare, row.overdueCare, row.showroomVisits, row.boughtCustomers,
      row.purchaseTimes, money(row.purchaseValue), `${row.conversionRate}%`,
      ...monthRules.flatMap(rule => {
        const item = row.rules[rule.id] || {value:"", target:""};
        const percent = item.target ? Math.round(item.value / item.target * 100) + "%" : "";
        return [item.value, item.target, percent];
      })
    ])
  ];
  const proposalHeader = ["Nhân viên / Email","KPI","Tháng","Chỉ tiêu lúc gửi","SĐT","Bộ phận","Khách hàng","SĐT KH","Công ty","Kênh KH","Trạng thái","Nội dung","Minh chứng","Gửi lúc","Người duyệt","Ngày duyệt","Ghi chú duyệt"];
  const proposalTable = [
    [`Chi tiết đề xuất KPI tháng ${month} và các đề xuất còn chờ duyệt`, ...Array(proposalHeader.length - 1).fill("")],
    proposalHeader,
    ...proposalRows.map(p => [
      personExportCell(p.owner, p.email || p.ownerEmail), p.kpiName || "", kpiProposalMonth(p), p.kpiTargetForOwner || p.kpiRuleTarget || "", p.phone || "", p.department || "",
      p.customerName || "", p.customerPhone || "", p.customerCompanyName || "", p.customerChannel || "",
      isApprovedKpiProposal(p) ? "Đã duyệt" : isRejectedKpiProposal(p) ? "Từ chối" : "Chờ duyệt",
      p.content || "", p.evidenceUrl || "", fmtDate(p.createdAt), p.reviewedByEmail || "", fmtDate(p.reviewedAt), p.reviewNote || ""
    ])
  ];
  let logged = true;
  try {
    await logKpiExport(report);
  } catch (err) {
    logged = false;
    notice("File vẫn được xuất, nhưng chưa ghi được log KPI: " + authMessage(err), true);
  }
  if (exportXlsx([
    { name: "Tong hop KPI", rows: summaryTable },
    { name: "De xuat KPI", rows: proposalTable }
  ], `crm-kpi-cu-${month}`) && logged) notice("Đã xuất báo cáo KPI cũ và ghi log thao tác.");
}

async function logManagementExport(report) {
  await setDoc(doc(collection(db, "auditLogs")), {
    action: "exportManagementReport",
    entity: "managementReports",
    entityId: currentMonth(),
    email: currentUser?.email || "",
    payloadJson: JSON.stringify({
      totalCustomers: report.customers.length,
      boughtCustomers: report.boughtCustomers,
      purchaseTimes: report.purchaseTimes,
      purchaseValue: report.purchaseValue,
      pipelineGroups: report.pipeline.length,
      pendingKpi: report.pendingKpi
    }),
    createdAt: serverTimestamp()
  });
}

async function exportManagementReport() {
  if (!isManager()) return notice("Chỉ admin/manager được xuất báo cáo quản trị.", true);
  const reportCustomers = currentReportCustomers();
  const reportCustomerIds = new Set(reportCustomers.map(c => c.id));
  const report = {
    customers: reportCustomers,
    pipeline: pipelineReportData(),
    careThisMonth: careLogs.filter(l => !l.isDeleted && reportCustomerIds.has(l.customerId) && monthOf(careLogActivityDate(l)) === currentMonth()).length,
    boughtCustomers: reportCustomers.filter(c => basicPurchaseCountFor(c) > 0).length,
    purchaseTimes: reportCustomers.reduce((sum, c) => sum + basicPurchaseCountFor(c), 0),
    purchaseValue: reportCustomers.reduce((sum, c) => sum + basicPurchaseValueFor(c), 0),
    pendingKpi: operationalKpiPendingCount(),
    legacyPendingKpi: legacyVisiblePendingCount()
  };
  const summaryRows = [
    ["Báo cáo quản trị CRM", ""],
    ["Thời điểm xuất", new Date().toLocaleString("vi-VN")],
    ["Người xuất", currentUser?.email || ""],
    ["Tổng khách", report.customers.length],
    ["Khách mới tháng này", report.customers.filter(c => monthOf(c.createdAt) === currentMonth()).length],
    ["Cần chăm", report.customers.filter(isCareDue).length],
    ["Quá hạn chăm", report.customers.filter(isCareOverdue).length],
    ["Lượt chăm tháng", report.careThisMonth],
    ["Khách đã mua căn bản", report.boughtCustomers],
    ["Số lần mua căn bản", report.purchaseTimes],
    ["Giá trị mua căn bản", money(report.purchaseValue)],
    [legacyKpiPreCutover() ? "KPI chờ duyệt" : "KPI hiện tại cần duyệt", report.pendingKpi],
    ...(!legacyKpiPreCutover() ? [["KPI cũ đang đóng sổ", report.legacyPendingKpi]] : [])
  ];
  const pipelineRows = [
    ["Pipeline", "Số khách", "Tỷ trọng"],
    ...report.pipeline.map(item => [
      item.label,
      item.count,
      report.customers.length ? Math.round(item.count / report.customers.length * 100) + "%" : "0%"
    ])
  ];
  const riskRows = [
    ["Khách cần chú ý", "SĐT", "Nhân viên", "Lý do", "Hẹn chăm", "Ghi chú"],
    ...report.customers
      .filter(c => isCareDue(c) || isCareOverdue(c))
      .sort((a,b) => clean(a.nextCareDate).localeCompare(clean(b.nextCareDate)))
      .map(c => [
        c.name || "",
        c.phoneRaw || c.phoneNormalized || "",
        customerOwnerName(c),
        isCareOverdue(c) ? systemLabel("overdueFollow") : systemLabel("dueFollow"),
        fmtDate(c.nextCareDate),
        c.note || ""
      ])
  ];
  let logged = true;
  try {
    await logManagementExport(report);
  } catch (err) {
    logged = false;
    notice("File vẫn được xuất, nhưng chưa ghi được log quản trị: " + authMessage(err), true);
  }
  if (exportXlsx([
    { name: "Tong hop", rows: summaryRows },
    { name: "Pipeline", rows: pipelineRows },
    { name: "Can chu y", rows: riskRows }
  ], `crm-management-report-${todayIso()}`) && logged) notice("Đã xuất báo cáo quản trị và ghi log thao tác.");
}

function renderOnlineUsers() {
  if (!isAdmin()) return;
  const cutoff = Date.now() - 2 * 60 * 1000;
  const active = onlineSessions
    .filter(s => s.online !== false)
    .filter(s => (toDate(s.lastSeenAt)?.getTime() || 0) >= cutoff)
    .sort((a,b) => (toDate(b.lastSeenAt)?.getTime() || 0) - (toDate(a.lastSeenAt)?.getTime() || 0));
  $("onlineUsers").innerHTML = active.length ? active.map(s => `
    <div class="online-item">
      <div><span class="online-dot"></span><b>${esc(s.name || s.email || "Người dùng")}</b></div>
      <div class="muted">${esc(s.email || "")}</div>
      <div class="muted">Hoạt động: ${esc(fmtDate(s.lastSeenAt))}</div>
    </div>
  `).join("") : "Chưa có ai đang truy cập.";
}

function kpi1EmployeeId(user) {
  return clean(user?.uid || user?.id);
}

function kpi1EmployeeById(employeeId) {
  return users.find(user => kpi1EmployeeId(user) === clean(employeeId)) || null;
}

function kpi1EligibleSales() {
  return users
    .filter(user => clean(user.role).toLowerCase() === "sale")
    .filter(user => user.active !== false && clean(user.lifecycleStatus || "active").toLowerCase() === "active")
    .sort((a,b) => clean(a.name || a.email).localeCompare(clean(b.name || b.email), "vi"));
}

function kpi1PeriodLabel(period) {
  const value = clean(period?.periodMonth).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(value)) return value || "Chưa rõ tháng";
  const [year, month] = value.split("-");
  return `${month}/${year}`;
}

function kpi1PeriodAssignments(periodId, includeCancelled = false) {
  return kpiAssignments.filter(item => clean(item.periodId) === clean(periodId))
    .filter(item => includeCancelled || clean(item.assignmentStatus || "ASSIGNED") === "ASSIGNED");
}

function kpi1StatusHtml(status) {
  const value = clean(status || "DRAFT").toUpperCase();
  const cls = value === "ACTIVE" ? "kpi1-status-active" : value === "CLOSED" ? "kpi1-status-closed" : "kpi1-status-draft";
  return `<span class="pill ${cls}">${esc(value)}</span>`;
}

function kpi1SelectedPeriod() {
  return kpiPeriods.find(period => period.id === selectedKpiFoundationPeriodId) || null;
}

function kpi1PeriodValidation(period) {
  const assignments = kpi1PeriodAssignments(period?.id);
  const definitionIds = new Set(assignments.map(item => item.definitionId));
  const employeeIds = new Set(assignments.map(item => item.employeeId));
  const invalidAssignments = assignments.filter(item => {
    const employee = kpi1EmployeeById(item.employeeId);
    const definition = kpiDefinitions.find(row => row.id === item.definitionId);
    return Number(item.target || 0) <= 0
      || !employee
      || clean(employee.role).toLowerCase() !== "sale"
      || employee.active === false
      || clean(employee.lifecycleStatus || "active").toLowerCase() !== "active"
      || !definition
      || definition.active === false;
  });
  return {
    assignments,
    kpiCount: definitionIds.size,
    employeeCount: employeeIds.size,
    invalidCount: invalidAssignments.length,
    canActivate: clean(period?.status).toUpperCase() === "DRAFT" && assignments.length > 0 && invalidAssignments.length === 0
  };
}

async function reloadKpiFoundationData() {
  if (!isManager()) return;
  const [periodSnap, definitionSnap, assignmentSnap] = await Promise.all([
    getDocs(collection(db, "kpiPeriods")),
    getDocs(collection(db, "kpiDefinitions")),
    getDocs(collection(db, "kpiAssignments"))
  ]);
  setCollectionState("kpiPeriods", periodSnap.docs.map(row => ({id:row.id, ...row.data()})));
  setCollectionState("kpiDefinitions", definitionSnap.docs.map(row => ({id:row.id, ...row.data()})));
  setCollectionState("kpiAssignments", assignmentSnap.docs.map(row => ({id:row.id, ...row.data()})));
  renderKpiFoundation();
}

function resetKpi1DefinitionForm() {
  if (!$("kpi1DefinitionId")) return;
  $("kpi1DefinitionId").value = "";
  $("kpi1DefinitionCode").value = "";
  $("kpi1DefinitionCode").disabled = false;
  $("kpi1DefinitionName").value = "";
  $("kpi1DefinitionType").value = "MANUAL";
  $("kpi1DefinitionUnit").value = "";
  $("kpi1DefinitionMetric").value = "";
  $("kpi1DefinitionEvidence").checked = false;
  $("kpi1DefinitionAggregation").value = "COUNT";
  $("kpi1DefinitionMaxImages").value = "2";
  $("kpi1DefinitionLocation").checked = false;
  $("kpi1DefinitionTimestamp").checked = true;
  $("kpi1DefinitionDescription").value = "";
  $("kpi1SaveDefinitionBtn").textContent = "Tạo definition";
  $("kpi1CancelDefinitionBtn").classList.add("hide");
}

async function createKpi1Period() {
  if (!isManager()) return notice("Chỉ manager/admin/owner được tạo kỳ KPI.", true);
  const month = clean($("kpi1PeriodMonth")?.value);
  const name = clean($("kpi1PeriodName")?.value) || (month ? `KPI tháng ${month.slice(5,7)}/${month.slice(0,4)}` : "");
  if (!month) return notice("Vui lòng chọn tháng KPI.", true);
  const created = await callCrmRpc("crm_kpi_create_period", {
    p_period_month: `${month}-01`,
    p_name: name,
    p_timezone: "Asia/Ho_Chi_Minh"
  });
  selectedKpiFoundationPeriodId = created?.id || "";
  $("kpi1PeriodName").value = "";
  await reloadKpiFoundationData();
  notice("Đã tạo kỳ KPI ở trạng thái DRAFT.");
}

async function saveKpi1Definition() {
  if (!isManager()) return notice("Chỉ manager/admin/owner được quản lý KPI definition.", true);
  const id = clean($("kpi1DefinitionId")?.value);
  const current = id ? kpiDefinitions.find(item => item.id === id) : null;
  const data = {
    code: clean($("kpi1DefinitionCode")?.value).toUpperCase(),
    name: clean($("kpi1DefinitionName")?.value),
    description: clean($("kpi1DefinitionDescription")?.value),
    kpiType: clean($("kpi1DefinitionType")?.value),
    sourceMetricKey: clean($("kpi1DefinitionMetric")?.value),
    unit: clean($("kpi1DefinitionUnit")?.value),
    submissionMode: "EVENT_CLAIM",
    evidenceRequired: !!$("kpi1DefinitionEvidence")?.checked,
    aggregationMode: $("kpi1DefinitionAggregation")?.value || "COUNT",
    maxImagesPerEvent: Number($("kpi1DefinitionMaxImages")?.value || 0),
    locationRequired: !!$("kpi1DefinitionLocation")?.checked,
    timestampRequired: !!$("kpi1DefinitionTimestamp")?.checked
  };
  if (!data.code || !data.name || !data.unit) return notice("Mã, tên và đơn vị KPI là bắt buộc.", true);
  if (current) {
    await callCrmRpc("crm_kpi_update_definition_v2", {
      p_definition_id: current.id,
      p_expected_version: Number(current.version),
      p_changes: data
    });
  } else {
    await callCrmRpc("crm_kpi_create_definition_v2", {
      p_code: data.code,
      p_name: data.name,
      p_description: data.description,
      p_kpi_type: data.kpiType,
      p_source_metric_key: data.sourceMetricKey || null,
      p_unit: data.unit,
      p_submission_mode: "EVENT_CLAIM",
      p_evidence_required: data.evidenceRequired,
      p_aggregation_mode: data.aggregationMode,
      p_max_images_per_event: data.maxImagesPerEvent,
      p_location_required: data.locationRequired,
      p_timestamp_required: data.timestampRequired
    });
  }
  resetKpi1DefinitionForm();
  await reloadKpiFoundationData();
  notice(current ? "Đã cập nhật KPI definition. Snapshot kỳ cũ không thay đổi." : "Đã tạo KPI definition.");
}

function editKpi1Definition(definitionId) {
  const item = kpiDefinitions.find(row => row.id === definitionId);
  if (!item) return notice("Không tìm thấy KPI definition.", true);
  $("kpi1DefinitionId").value = item.id;
  $("kpi1DefinitionCode").value = item.code || "";
  $("kpi1DefinitionCode").disabled = true;
  $("kpi1DefinitionName").value = item.name || "";
  $("kpi1DefinitionType").value = item.kpiType || "MANUAL";
  $("kpi1DefinitionUnit").value = item.unit || "";
  $("kpi1DefinitionMetric").value = item.sourceMetricKey || "";
  $("kpi1DefinitionEvidence").checked = !!item.evidenceRequired;
  $("kpi1DefinitionAggregation").value = item.aggregationMode || "COUNT";
  $("kpi1DefinitionMaxImages").value = Number(item.maxImagesPerEvent ?? 2);
  $("kpi1DefinitionLocation").checked = !!item.locationRequired;
  $("kpi1DefinitionTimestamp").checked = item.timestampRequired !== false;
  $("kpi1DefinitionDescription").value = item.description || "";
  $("kpi1SaveDefinitionBtn").textContent = "Lưu definition";
  $("kpi1CancelDefinitionBtn").classList.remove("hide");
  $("kpi1DefinitionName").focus();
}

async function toggleKpi1Definition(definitionId) {
  const item = kpiDefinitions.find(row => row.id === definitionId);
  if (!item) return notice("Không tìm thấy KPI definition.", true);
  const next = item.active === false;
  if (!confirm(`${next ? "Bật" : "Tắt"} KPI ${item.name || item.code}? Snapshot ở các kỳ đã tạo sẽ không đổi.`)) return;
  await callCrmRpc("crm_kpi_set_definition_active", {
    p_definition_id: item.id,
    p_expected_version: Number(item.version),
    p_active: next
  });
  await reloadKpiFoundationData();
  notice(next ? "Đã bật KPI definition." : "Đã tắt KPI definition.");
}

async function renameKpi1Period(periodId) {
  const period = kpiPeriods.find(item => item.id === periodId);
  if (!period || clean(period.status).toUpperCase() !== "DRAFT") return notice("Chỉ kỳ DRAFT mới được đổi tên.", true);
  const nextName = clean(prompt("Tên kỳ KPI:", period.name || "") || "");
  if (!nextName || nextName === clean(period.name)) return;
  await callCrmRpc("crm_kpi_update_period", {
    p_period_id: period.id,
    p_expected_version: Number(period.version),
    p_changes: {name: nextName}
  });
  await reloadKpiFoundationData();
  notice("Đã cập nhật tên kỳ KPI.");
}

function selectKpi1Period(periodId) {
  selectedKpiFoundationPeriodId = periodId;
  renderKpiFoundation();
  $("kpi1PeriodDetail")?.scrollIntoView({behavior:"smooth", block:"start"});
}

function closeKpi1PeriodDetail() {
  selectedKpiFoundationPeriodId = "";
  renderKpiFoundation();
}

async function saveKpi1MatrixRow(definitionId) {
  const period = kpi1SelectedPeriod();
  if (!period || clean(period.status).toUpperCase() !== "DRAFT") return notice("Chỉ kỳ DRAFT mới được sửa ma trận.", true);
  const cells = [...document.querySelectorAll(`[data-kpi1-cell="${CSS.escape(definitionId)}"]`)];
  const rows = [];
  for (const cell of cells) {
    const checkbox = cell.querySelector("[data-kpi1-assigned]");
    const input = cell.querySelector("[data-kpi1-target]");
    const scoreOption = cell.querySelector("[data-kpi2-score-option], [data-kpi1-new-score-option]");
    if (!checkbox?.checked) continue;
    const target = Number(input?.value || 0);
    if (!(target > 0)) return notice("Target của mọi sale được tick phải lớn hơn 0.", true);
    rows.push({employeeId: checkbox.dataset.employeeId, target, scoreEnabled: !!scoreOption?.checked});
  }
  await callCrmRpc("crm_kpi_sync_definition_assignments", {
    p_period_id: period.id,
    p_definition_id: definitionId,
    p_rows: rows,
    p_expected_period_version: Number(period.version),
    p_reason: "Cập nhật ma trận KPI từ Manager UI"
  });
  await reloadKpiFoundationData();
  notice("Đã lưu ma trận assignment cho KPI.");
}

async function updateKpi2ScoreOption(assignmentId, enabled) {
  const assignment = kpiAssignments.find(item => item.id === assignmentId);
  const period = assignment ? kpiPeriods.find(item => item.id === assignment.periodId) : null;
  if (!assignment || !period) throw new Error("Không tìm thấy assignment hoặc kỳ KPI.");
  if (clean(period.status).toUpperCase() !== "DRAFT") throw new Error("Chỉ kỳ DRAFT mới được đổi cách tính điểm.");
  try {
    await callCrmRpc("crm_kpi_update_assignment_options", {
      p_assignment_id: assignment.id,
      p_score_enabled: !!enabled,
      p_expected_assignment_version: Number(assignment.lockVersion),
      p_expected_period_version: Number(period.version)
    });
    await reloadKpiFoundationData();
    notice(enabled ? "Đã đưa KPI vào điểm tháng." : "KPI chỉ còn dùng để tham khảo, không tính vào điểm tháng.");
  } catch (error) {
    await reloadKpiFoundationData();
    throw error;
  }
}

async function activateKpi1Period() {
  const period = kpi1SelectedPeriod();
  if (!period) return notice("Chưa chọn kỳ KPI.", true);
  const validation = kpi1PeriodValidation(period);
  if (!validation.canActivate) return notice("Kỳ KPI chưa hợp lệ: cần assignment, target > 0, definition active và sale ACTIVE.", true);
  const message = `Kích hoạt ${period.name || kpi1PeriodLabel(period)}?\n\n${validation.kpiCount} KPI · ${validation.employeeCount} nhân viên · ${validation.assignments.length} assignment.\nSau khi ACTIVE, target và assignment sẽ bị khóa.`;
  if (!confirm(message)) return;
  await callCrmRpc("crm_kpi_activate_period", {
    p_period_id: period.id,
    p_expected_version: Number(period.version)
  });
  await reloadKpiFoundationData();
  notice("Đã kích hoạt kỳ KPI. Cấu hình chính đã được khóa.");
}

function renderKpi1Matrix(period) {
  const head = $("kpi1MatrixHead");
  const body = $("kpi1MatrixRows");
  if (!head || !body) return;
  const periodAssignments = kpi1PeriodAssignments(period.id, true);
  const assignedEmployeeIds = uniq(periodAssignments.map(item => item.employeeId));
  const activeSales = kpi1EligibleSales();
  const historicalUsers = assignedEmployeeIds
    .map(kpi1EmployeeById)
    .filter(Boolean)
    .filter(user => !activeSales.some(item => kpi1EmployeeId(item) === kpi1EmployeeId(user)));
  const employees = [...activeSales, ...historicalUsers];
  const assignedDefinitionIds = new Set(periodAssignments.map(item => item.definitionId));
  const definitions = kpiDefinitions.filter(item => item.active !== false || assignedDefinitionIds.has(item.id));
  const locked = clean(period.status).toUpperCase() !== "DRAFT";

  head.innerHTML = `<tr><th>KPI</th>${employees.map(user => `<th>${esc(user.name || user.email)}<div class="muted">${esc(user.email || "")}</div></th>`).join("")}<th>Thao tác</th></tr>`;
  body.innerHTML = definitions.length ? definitions.map(definition => {
    const cells = employees.map(user => {
      const employeeId = kpi1EmployeeId(user);
      const assignment = periodAssignments.find(item => item.definitionId === definition.id && item.employeeId === employeeId);
      const assigned = assignment && clean(assignment.assignmentStatus || "ASSIGNED") === "ASSIGNED";
      const employeeActive = user.active !== false && clean(user.lifecycleStatus || "active").toLowerCase() === "active";
      const safeScoreDefault = clean(kpi2Field(definition, "sourceMetricKey", "source_metric_key")).toLowerCase() !== "deals_v1";
      return `<td class="kpi1-matrix-cell" data-kpi1-cell="${esc(definition.id)}">
        <label><input type="checkbox" data-kpi1-assigned data-employee-id="${esc(employeeId)}" ${assigned ? "checked" : ""} ${locked || !employeeActive ? "disabled" : ""}> Áp dụng</label>
        <input type="number" min="0.01" step="0.01" data-kpi1-target value="${assigned ? esc(assignment.target) : ""}" placeholder="Target" ${locked || !employeeActive ? "disabled" : ""}>
        <label><input type="checkbox" ${assigned ? `data-kpi2-score-option="${esc(assignment.id)}"` : "data-kpi1-new-score-option"} ${assigned ? (assignment.scoreEnabled !== false ? "checked" : "") : (safeScoreDefault ? "checked" : "")} ${locked || !employeeActive ? "disabled" : ""}> Tính vào điểm KPI tháng</label>
        ${!assigned && !safeScoreDefault ? `<div class="muted">KPI bán hàng mặc định chỉ tham khảo.</div>` : ""}
        ${!employeeActive ? `<div class="muted">Không còn ACTIVE</div>` : ""}
      </td>`;
    }).join("");
    return `<tr>
      <td><b>${esc(definition.name || definition.code)}</b><div class="muted">${esc(definition.code)} · ${esc(definition.kpiType)} · ${esc(definition.unit)}</div>${definition.active === false ? `<span class="pill red">Đã tắt</span>` : ""}</td>
      ${cells}
      <td>${locked ? `<span class="muted">Đã khóa</span>` : `<button class="small primary" type="button" data-kpi1-save-matrix="${esc(definition.id)}">Lưu hàng</button>`}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="${employees.length + 2}" class="muted">Chưa có KPI definition để cấu hình.</td></tr>`;
}

function renderKpiFoundation() {
  const panel = $("kpiFoundationPanel");
  if (!panel || !isManager()) return;

  const periodRows = $("kpi1PeriodRows");
  periodRows.innerHTML = kpiPeriods.length ? kpiPeriods.map(period => {
    const validation = kpi1PeriodValidation(period);
    return `<tr>
      <td><b>${esc(kpi1PeriodLabel(period))}</b><div class="muted">${esc(period.name || "")}</div></td>
      <td>${kpi1StatusHtml(period.status)}</td>
      <td>${esc(validation.kpiCount)}</td>
      <td>${esc(validation.employeeCount)}</td>
      <td>${esc(validation.assignments.length)}</td>
      <td>${esc(fmtDate(period.createdAt))}</td>
      <td><div class="actions"><button class="small primary" type="button" data-kpi1-select-period="${esc(period.id)}">Xem cấu hình</button>${clean(period.status).toUpperCase() === "DRAFT" ? `<button class="small" type="button" data-kpi1-rename-period="${esc(period.id)}">Đổi tên</button>` : ""}</div></td>
    </tr>`;
  }).join("") : `<tr><td colspan="7" class="muted">Chưa có kỳ KPI mới.</td></tr>`;

  const definitionRows = $("kpi1DefinitionRows");
  definitionRows.innerHTML = kpiDefinitions.length ? kpiDefinitions.map(item => `<tr>
    <td><b>${esc(item.code)}</b></td>
    <td>${esc(item.name)}<div class="muted">${esc(item.description || "")}</div></td>
    <td>${esc(item.kpiType)}<div class="muted">${esc(item.aggregationMode || "COUNT")}</div></td>
    <td>${esc(item.unit)}</td>
    <td>${item.evidenceRequired ? "Bắt buộc" : "Không"}</td>
    <td>${item.active === false ? `<span class="pill red">Đã tắt</span>` : `<span class="pill green">Đang dùng</span>`}</td>
    <td><div class="actions"><button class="small" type="button" data-kpi1-edit-definition="${esc(item.id)}">Sửa</button><button class="small ${item.active === false ? "primary" : "danger"}" type="button" data-kpi1-toggle-definition="${esc(item.id)}">${item.active === false ? "Bật" : "Tắt"}</button></div></td>
  </tr>`).join("") : `<tr><td colspan="7" class="muted">Chưa có KPI definition.</td></tr>`;

  const period = kpi1SelectedPeriod();
  $("kpi1PeriodDetail").classList.toggle("hide", !period);
  if (!period) return;
  const validation = kpi1PeriodValidation(period);
  const locked = clean(period.status).toUpperCase() !== "DRAFT";
  $("kpi1SelectedPeriodTitle").textContent = `${period.name || "Kỳ KPI"} · ${kpi1PeriodLabel(period)}`;
  $("kpi1SelectedPeriodMeta").innerHTML = `${kpi1StatusHtml(period.status)} <span>Version ${esc(period.version)}</span>`;
  $("kpi1ActivationSummary").innerHTML = [
    ["KPI", validation.kpiCount],
    ["Nhân viên", validation.employeeCount],
    ["Assignments", validation.assignments.length],
    ["Không hợp lệ", validation.invalidCount]
  ].map(([label,value]) => `<div class="kpi1-summary-card"><span class="muted">${esc(label)}</span><b>${esc(value)}</b></div>`).join("");
  $("kpi1LockedNotice").classList.toggle("hide", !locked);
  $("kpi1ActivatePeriodBtn").classList.toggle("hide", locked);
  $("kpi1ActivatePeriodBtn").disabled = !validation.canActivate;
  renderKpi1Matrix(period);
}

function kpi2Field(row, camel, snake) { return row?.[camel] ?? row?.[snake]; }
function kpi2Assignment(id) { return kpiAssignments.find(a => a.id === clean(id)); }
function kpi2DefinitionName(row) { return kpi2Field(row,"definitionSnapshot","definition_snapshot")?.name || "KPI"; }
function kpi2DatetimeLocalValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = number => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function kpiTeamPeriod() {
  return kpiPeriods.find(period => clean(period.id) === clean(kpiTeamState.selectedPeriodId)) || null;
}

function ensureKpiTeamPeriod() {
  if (kpiTeamPeriod()) return kpiTeamPeriod();
  const current = kpiPeriods.find(period => clean(period.periodMonth).slice(0, 7) === currentMonth());
  const active = kpiPeriods.find(period => clean(period.status).toUpperCase() === "ACTIVE");
  const selected = current || active || kpiPeriods[0] || null;
  kpiTeamState.selectedPeriodId = selected?.id || "";
  return selected;
}

function kpiTeamRawAssignments(periodId = kpiTeamState.selectedPeriodId) {
  return kpiAssignments
    .filter(row => clean(row.periodId) === clean(periodId))
    .filter(row => clean(row.assignmentStatus || "ASSIGNED").toUpperCase() === "ASSIGNED");
}

function kpiTeamEmployeeAssignments(employeeId = kpiTeamState.selectedEmployeeId) {
  const progressRows = kpiTeamState.assignmentProgress.filter(row => clean(kpiTeamValue(row, "employeeId", "employee_id")) === clean(employeeId));
  if (progressRows.length) return progressRows;
  return kpiTeamRawAssignments().filter(row => assignmentEmployeeId(row) === clean(employeeId));
}

function kpiTeamSummaries() {
  const period = ensureKpiTeamPeriod();
  return buildKpiEmployeeSummaries({
    employees: eligibleKpiEmployees(users),
    progress: kpiTeamState.assignmentProgress,
    monthlyScores: kpiTeamState.monthlyScores,
    draftAssignments: kpiTeamRawAssignments(period?.id),
    periodStatus: period?.status
  });
}

function kpiTeamSelectedSummary() {
  return kpiTeamSummaries().find(row => row.id === clean(kpiTeamState.selectedEmployeeId)) || null;
}

function kpiTeamNumber(value, digits = 0) {
  const number = Number(value || 0);
  return number.toLocaleString("vi-VN", {maximumFractionDigits:digits});
}

function kpiTeamScoreText(summary) {
  if (!summary?.assignedCount) return "Chưa có KPI";
  if (!summary?.hasScore) return "Chưa có điểm";
  return `${kpiTeamNumber(summary.monthlyScore, 2)}%`;
}

function kpiTeamProgressWidth(summary) {
  return summary?.hasScore ? Math.max(0, Math.min(100, Number(summary.monthlyScore || 0))) : 0;
}

function kpiTeamStatusLabel(status) {
  const value = clean(status).toUpperCase();
  if (value === "APPROVED") return "Đã duyệt";
  if (value === "REJECTED") return "Từ chối";
  if (value === "NEEDS_REVISION") return "Cần sửa";
  return "Chờ duyệt";
}

function kpiTeamStatusClass(status) {
  const value = clean(status).toUpperCase();
  if (value === "APPROVED") return "green";
  if (value === "REJECTED" || value === "NEEDS_REVISION") return "red";
  return "orange";
}

function kpiTeamSkeleton(count = 4) {
  return `<div class="kpi-team-skeleton" aria-label="Đang tải KPI">${Array.from({length:count}, () => "<span></span>").join("")}</div>`;
}

function setKpiTeamMode(mode) {
  if (!isManager()) return;
  kpiTeamState.activeMode = ["library", "history"].includes(mode) ? mode : "employees";
  kpiTeamState.globalQueueOpen = false;
  renderKpiTeamShell();
  applyKpiManagerModeVisibility();
  if (kpiTeamState.activeMode === "library") {
    renderKpiTable();
    renderMyKpiProposalPanel();
    renderKpiRuleList();
    renderKpiApprovalPanel();
    renderKpiFoundation();
  }
}

function applyKpiManagerModeVisibility() {
  if (!isManager() || activeMainView !== "kpi") return;
  const library = kpiTeamState.activeMode === "library";
  $("kpiFoundationPanel")?.classList.toggle("hide", !library);
  $("kpiRulePanel")?.classList.toggle("hide", !library);
  $("kpiApprovalPanel")?.classList.toggle("hide", !library);
  $("kpiSummaryPanel")?.classList.toggle("hide", !library);
  $("kpi2OperationsPanel")?.classList.add("hide");
}

function renderKpiTeamShell() {
  if (!isManager() || !$("kpiTeamPanel")) return;
  const period = ensureKpiTeamPeriod();
  const periodSelect = $("kpiTeamPeriod");
  if (periodSelect) {
    periodSelect.innerHTML = kpiPeriods.length
      ? kpiPeriods.map(row => `<option value="${esc(row.id)}" ${clean(row.id) === clean(period?.id) ? "selected" : ""}>${esc(kpi1PeriodLabel(row))} · ${esc(clean(row.status).toUpperCase())}</option>`).join("")
      : `<option value="">Chưa có kỳ KPI</option>`;
    periodSelect.disabled = !kpiPeriods.length;
  }
  document.querySelectorAll("[data-kpi-team-mode]").forEach(button => {
    const active = button.dataset.kpiTeamMode === kpiTeamState.activeMode;
    button.classList.toggle("primary", active);
    button.setAttribute("aria-selected", String(active));
  });
  const showFilters = kpiTeamState.activeMode === "employees" && !kpiTeamState.globalQueueOpen;
  $("kpiTeamSearchField")?.classList.toggle("hide", !showFilters);
  $("kpiTeamProgressField")?.classList.toggle("hide", !showFilters);
  $("kpiTeamPendingOnlyField")?.classList.toggle("hide", !showFilters);
  if ($("kpiTeamSearch")) $("kpiTeamSearch").value = kpiTeamState.employeeSearch;
  if ($("kpiTeamProgressFilter")) $("kpiTeamProgressFilter").value = kpiTeamState.progressFilter;
  if ($("kpiTeamPendingOnly")) $("kpiTeamPendingOnly").checked = kpiTeamState.pendingOnly;
  const pending = kpiTeamSummaries().reduce((sum, row) => sum + row.pendingCount, 0);
  if ($("kpiTeamPendingBtn")) {
    $("kpiTeamPendingBtn").textContent = `Cần duyệt (${pending})`;
    $("kpiTeamPendingBtn").classList.toggle("primary", kpiTeamState.globalQueueOpen);
  }
  if (kpiTeamState.activeMode === "library") {
    $("kpiTeamStatus").textContent = legacyKpiPreCutover()
      ? "Bộ KPI-2 tháng 09 có thể chuẩn bị ở trạng thái DRAFT. KPI tháng 08 vẫn vận hành trên hệ thống cũ."
      : "Bộ KPI-2 là cấu hình vận hành hiện tại. KPI cũ bên dưới chỉ dùng cho lịch sử và đóng sổ.";
    $("kpiTeamContent").innerHTML = `<div class="kpi-team-empty"><b>Bộ KPI</b><span>Dùng các khối cấu hình bên dưới. KPI definition không gắn riêng với một nhân viên.</span></div>`;
  } else if (kpiTeamState.globalQueueOpen) {
    renderKpiTeamGlobalQueue();
  } else if (kpiTeamState.activeMode === "history") {
    renderKpiTeamHistoryMode();
  } else {
    renderKpiTeamEmployeeList();
  }
}

function renderKpiTeamEmployeeList() {
  const target = $("kpiTeamContent");
  if (!target) return;
  if (kpiTeamState.loading.summary) {
    $("kpiTeamStatus").textContent = "Đang tải tiến độ KPI...";
    target.innerHTML = kpiTeamSkeleton();
    return;
  }
  if (kpiTeamState.errors.summary) {
    $("kpiTeamStatus").innerHTML = `<span class="error-text">${esc(kpiTeamState.errors.summary)}</span>`;
    target.innerHTML = `<div class="kpi-team-empty"><b>Không tải được tiến độ KPI.</b><button class="small primary" type="button" data-kpi-team-retry="summary">Thử lại</button></div>`;
    return;
  }
  const allRows = kpiTeamSummaries();
  const rows = filterKpiEmployeeSummaries(allRows, {
    search:kpiTeamState.employeeSearch,
    progressFilter:kpiTeamState.progressFilter,
    pendingOnly:kpiTeamState.pendingOnly
  });
  const period = kpiTeamPeriod();
  $("kpiTeamStatus").textContent = period
    ? `${rows.length}/${allRows.length} nhân viên · ${kpi1PeriodLabel(period)} · ${clean(period.status).toUpperCase()}`
    : "Chưa có kỳ KPI.";
  if (!period) {
    target.innerHTML = `<div class="kpi-team-empty"><b>Chưa có kỳ KPI để theo dõi.</b><span>Hãy mở Bộ KPI để tạo kỳ mới.</span><button class="small primary" type="button" data-kpi-team-mode="library">Mở Bộ KPI</button></div>`;
    return;
  }
  if (!allRows.length) {
    target.innerHTML = `<div class="kpi-team-empty"><b>Chưa có nhân viên Sale đang hoạt động.</b><span>Danh sách chỉ gồm Sale active và lifecycle active.</span></div>`;
    return;
  }
  if (!rows.length) {
    target.innerHTML = `<div class="kpi-team-empty"><b>Không có nhân viên phù hợp bộ lọc.</b><button class="small" type="button" data-kpi-team-clear-filter>Xóa lọc</button></div>`;
    return;
  }
  target.innerHTML = `<div class="kpi-team-employee-list">${rows.map(summary => {
    const canAssign = clean(period.status).toUpperCase() === "DRAFT";
    return `<article class="kpi-team-employee-row ${summary.unresolvedCount ? "needs-attention" : ""}">
      <div class="kpi-team-employee-identity"><b>${esc(summary.name)}</b><span>${esc(summary.email || "Sale")}</span></div>
      <div class="kpi-team-score"><b>${esc(kpiTeamScoreText(summary))}</b><div class="kpi-team-progress" aria-label="Tiến độ ${esc(kpiTeamScoreText(summary))}"><span style="width:${esc(kpiTeamProgressWidth(summary))}%"></span></div></div>
      <div class="kpi-team-employee-meta"><span>${esc(summary.assignedCount)} KPI</span><span>${esc(summary.pendingCount)} chờ duyệt</span>${summary.referenceCount ? `<span>${esc(summary.referenceCount)} tham chiếu</span>` : ""}${summary.revisionCount ? `<span class="pill red">${esc(summary.revisionCount)} cần sửa</span>` : ""}</div>
      <div class="kpi-team-row-actions"><button class="small" type="button" data-kpi-team-open-employee="${esc(summary.id)}">Xem chi tiết</button>${summary.assignedCount === 0 && canAssign ? `<button class="small primary" type="button" data-kpi-team-assign-employee="${esc(summary.id)}">+ Gán KPI</button>` : ""}</div>
    </article>`;
  }).join("")}</div>`;
}

function renderKpiTeamHistoryMode() {
  const target = $("kpiTeamContent");
  if (!target) return;
  if (kpiTeamState.loading.summary) {
    $("kpiTeamStatus").textContent = "Đang tải lịch sử kỳ KPI...";
    target.innerHTML = kpiTeamSkeleton(3);
    return;
  }
  const period = kpiTeamPeriod();
  const rows = kpiTeamSummaries();
  $("kpiTeamStatus").textContent = period ? `Bảng kết quả team kỳ ${kpi1PeriodLabel(period)} · ${clean(period.status).toUpperCase()}` : "Chưa có kỳ KPI.";
  target.innerHTML = period ? `<div class="kpi-team-history-list">${rows.length ? rows.map(summary => `<div class="kpi-team-history-row"><div><b>${esc(summary.name)}</b><span>${esc(summary.email)}</span></div><div><b>${esc(kpiTeamScoreText(summary))}</b><span>${esc(summary.assignedCount)} KPI · ${esc(clean(period.status).toUpperCase())}</span></div><button class="small" type="button" data-kpi-team-open-employee="${esc(summary.id)}" data-kpi-team-open-tab="history">Xem lịch sử</button></div>`).join("") : `<div class="kpi-team-empty">Chưa có nhân viên Sale đang hoạt động.</div>`}</div>` : `<div class="kpi-team-empty"><b>Chưa có lịch sử KPI.</b><span>Hãy tạo kỳ KPI trong Bộ KPI.</span></div>`;
}

async function reloadKpiTeamSummary({force = false} = {}) {
  if (!isManager() || !currentUser || !$("kpiTeamPanel")) return;
  const period = ensureKpiTeamPeriod();
  renderKpiTeamShell();
  if (!period) return;
  const cacheKey = `${period.id}:${period.version || 0}`;
  if (!force && kpiTeamState.summaryCacheKey === cacheKey && !kpiTeamState.errors.summary) return;
  if (kpiTeamState.loading.summary && kpiTeamState.summaryInFlightKey === cacheKey) return;
  const token = ++kpiTeamState.summaryToken;
  kpiTeamState.loading.summary = true;
  kpiTeamState.summaryInFlightKey = cacheKey;
  kpiTeamState.errors.summary = "";
  renderKpiTeamShell();
  kpiTeamState.requests.summary = 2;
  try {
    const [progress, scores] = await Promise.all([
      callCrmRpc("crm_kpi_get_assignment_progress", {p_period_id:period.id}),
      callCrmRpc("crm_kpi_get_monthly_scores", {p_period_id:period.id})
    ]);
    if (token !== kpiTeamState.summaryToken || clean(period.id) !== clean(kpiTeamState.selectedPeriodId)) return;
    kpiTeamState.assignmentProgress = progress || [];
    kpiTeamState.monthlyScores = scores || [];
    const runtimeStatus = clean(kpiTeamValue(kpiTeamState.assignmentProgress[0], "periodStatus", "period_status")).toUpperCase();
    if (runtimeStatus && runtimeStatus !== clean(period.status).toUpperCase()) period.status = runtimeStatus;
    kpiTeamState.summaryCacheKey = cacheKey;
  } catch (error) {
    if (token !== kpiTeamState.summaryToken) return;
    kpiTeamState.errors.summary = `Không tải được tiến độ KPI: ${authMessage(error)}`;
    throw error;
  } finally {
    if (token === kpiTeamState.summaryToken) {
      kpiTeamState.loading.summary = false;
      kpiTeamState.summaryInFlightKey = "";
      renderKpiTeamShell();
      if (kpiTeamState.selectedEmployeeId) renderKpiTeamEmployeeDetail();
    }
  }
}

function openKpiTeamEmployee(employeeId, tab = "overview") {
  const summary = kpiTeamSummaries().find(row => row.id === clean(employeeId));
  if (!summary) return notice("Không tìm thấy nhân viên Sale đang hoạt động.", true);
  if (clean(kpiTeamState.selectedEmployeeId) !== clean(summary.id)) {
    kpiTeamState.employeeEvents = [];
    kpiTeamState.employeeEvidence = [];
    kpiTeamState.duplicateDetails = [];
    kpiTeamState.proposalCacheKey = "";
  }
  kpiTeamState.selectedEmployeeId = summary.id;
  kpiTeamState.activeEmployeeTab = ["kpis", "proposals", "history"].includes(tab) ? tab : "overview";
  kpiTeamState.eventStatus = "all";
  kpiTeamState.focusedEventId = "";
  $("kpiTeamDetailBackdrop")?.classList.remove("hide");
  $("kpiTeamDetailDrawer")?.classList.remove("hide");
  renderKpiTeamEmployeeDetail();
  $("kpiTeamDetailCloseBtn")?.focus();
  if (kpiTeamState.activeEmployeeTab === "proposals") loadKpiTeamEmployeeProposals().catch(error => notice(authMessage(error), true));
  if (kpiTeamState.activeEmployeeTab === "history") loadKpiTeamEmployeeHistory().catch(error => notice(authMessage(error), true));
}

function closeKpiTeamEmployee() {
  $("kpiTeamDetailBackdrop")?.classList.add("hide");
  $("kpiTeamDetailDrawer")?.classList.add("hide");
  kpiTeamState.selectedEmployeeId = "";
  kpiTeamState.employeeEvents = [];
  kpiTeamState.employeeEvidence = [];
  kpiTeamState.proposalCacheKey = "";
  kpiTeamState.duplicateDetails = [];
  kpiTeamState.focusedEventId = "";
}

function setKpiTeamEmployeeTab(tab) {
  if (!["overview", "kpis", "proposals", "history"].includes(tab)) return;
  kpiTeamState.activeEmployeeTab = tab;
  renderKpiTeamEmployeeDetail();
  if (tab === "proposals") loadKpiTeamEmployeeProposals().catch(error => notice(authMessage(error), true));
  if (tab === "history") loadKpiTeamEmployeeHistory().catch(error => notice(authMessage(error), true));
}

function renderKpiTeamEmployeeDetail() {
  const summary = kpiTeamSelectedSummary();
  const period = kpiTeamPeriod();
  if (!summary || !period || !$("kpiTeamDetailDrawer") || $("kpiTeamDetailDrawer").classList.contains("hide")) return;
  $("kpiTeamDetailName").textContent = summary.name;
  $("kpiTeamDetailSubtitle").textContent = `${summary.email || "Sale"} · Kỳ ${kpi1PeriodLabel(period)} · ${clean(period.status).toUpperCase()}`;
  const canAssign = clean(period.status).toUpperCase() === "DRAFT";
  $("kpiTeamDetailSummary").innerHTML = `<div class="kpi-team-detail-score"><span>Tổng KPI</span><b>${esc(kpiTeamScoreText(summary))}</b><div class="kpi-team-progress"><span style="width:${esc(kpiTeamProgressWidth(summary))}%"></span></div></div><div><span>KPI được giao</span><b>${esc(summary.assignedCount)}</b></div><div><span>Chờ duyệt</span><b>${esc(summary.pendingCount)}</b></div><div class="kpi-team-detail-action"><button class="small primary" type="button" data-kpi-team-assign-employee="${esc(summary.id)}" ${canAssign ? "" : "disabled"}>+ Gán KPI</button><span class="muted">${canAssign ? "Kỳ đang DRAFT" : "Chỉ gán KPI khi kỳ DRAFT"}</span></div>`;
  document.querySelectorAll("[data-kpi-employee-tab]").forEach(button => {
    const active = button.dataset.kpiEmployeeTab === kpiTeamState.activeEmployeeTab;
    button.classList.toggle("primary", active);
    button.setAttribute("aria-selected", String(active));
  });
  $("kpiTeamDetailStatus").textContent = "";
  if (kpiTeamState.activeEmployeeTab === "kpis") renderKpiTeamKpiTab(summary, period);
  else if (kpiTeamState.activeEmployeeTab === "proposals") renderKpiTeamProposalTab(summary);
  else if (kpiTeamState.activeEmployeeTab === "history") renderKpiTeamEmployeeHistory(summary);
  else renderKpiTeamOverview(summary);
}

function renderKpiTeamOverview(summary) {
  const completed = summary.progressRows.filter(row => assignmentProgressMetrics(row).scoringPercent >= 100).length;
  const inProgress = Math.max(0, summary.assignedCount - completed);
  const attention = summary.progressRows.filter(row => {
    const metric = assignmentProgressMetrics(row);
    return metric.pendingCount + metric.revisionCount > 0;
  });
  $("kpiTeamDetailContent").innerHTML = `<div class="kpi-team-overview-grid"><div><span>Đã đạt mục tiêu</span><b>${esc(completed)}</b></div><div><span>Đang thực hiện</span><b>${esc(inProgress)}</b></div><div><span>Tính điểm tháng</span><b>${esc(summary.scoredCount)}</b></div><div><span>Chỉ tham chiếu</span><b>${esc(summary.referenceCount)}</b></div></div>${summary.assignedCount ? `<div class="table-title">KPI cần chú ý</div>${attention.length ? `<div class="kpi-team-attention-list">${attention.map(row => { const metric=assignmentProgressMetrics(row); return `<button type="button" data-kpi-team-detail-kpi="${esc(kpiTeamAssignmentId(row))}"><span><b>${esc(kpiTeamDefinitionName(row))}</b><small>${esc(metric.actual)} / ${esc(metric.target)}</small></span><span>${metric.pendingCount ? `${esc(metric.pendingCount)} chờ duyệt` : `${esc(metric.revisionCount)} cần sửa`}</span></button>`; }).join("")}</div>` : `<div class="kpi-team-empty compact">Không có KPI cần xử lý ngay.</div>`}` : `<div class="kpi-team-empty"><b>Chưa được gán KPI.</b><span>${clean(kpiTeamPeriod()?.status).toUpperCase() === "DRAFT" ? "Bấm + Gán KPI để bắt đầu." : "Kỳ này không có KPI được giao cho nhân viên."}</span></div>`}`;
}

function renderKpiTeamKpiTab(summary, period) {
  const rows = kpiTeamEmployeeAssignments(summary.id);
  if (!rows.length) {
    $("kpiTeamDetailContent").innerHTML = `<div class="kpi-team-empty"><b>Chưa được gán KPI.</b><span>${clean(period.status).toUpperCase() === "DRAFT" ? "Bạn có thể gán KPI từ Bộ KPI." : "Kỳ này đã khóa cấu hình."}</span></div>`;
    return;
  }
  const isDraft = clean(period.status).toUpperCase() === "DRAFT";
  $("kpiTeamDetailContent").innerHTML = `<div class="kpi-team-assignment-list">${rows.map(row => {
    const metric = assignmentProgressMetrics(row);
    const snapshot = kpiTeamValue(row, "definitionSnapshot", "definition_snapshot") || {};
    const target = Number(row.target || metric.target || 0);
    const scoreEnabled = kpiTeamValue(row, "scoreEnabled", "score_enabled") ?? row.scoreEnabled;
    return `<article class="kpi-team-assignment-card"><div class="kpi-team-assignment-head"><div><b>${esc(kpiTeamDefinitionName(row))}</b><span>${esc(snapshot.unit || "")}${snapshot.aggregation_mode ? ` · ${esc(snapshot.aggregation_mode)}` : ""}</span></div>${scoreEnabled ? `<span class="pill green">Tính điểm</span>` : `<span class="pill">Tham chiếu</span>`}</div><div class="kpi-team-assignment-metrics"><div><span>Thực tế</span><b>${isDraft ? "Chưa áp dụng" : `${esc(kpiTeamNumber(metric.actual, 2))}/${esc(kpiTeamNumber(target, 2))}`}</b><small>${isDraft ? "Kỳ DRAFT" : `${esc(kpiTeamNumber(metric.actualPercent, 2))}%`}</small></div><div><span>Điểm tính KPI</span><b>${scoreEnabled && !isDraft ? `${esc(kpiTeamNumber(metric.scoringPercent, 2))}%` : "—"}</b><small>${scoreEnabled ? "Tối đa 100%" : "Không tính vào điểm tháng"}</small></div></div><div class="kpi2-progress-meta">${metric.pendingCount ? `<span class="pill orange">Chờ ${esc(metric.pendingCount)}</span>` : ""}${metric.revisionCount ? `<span class="pill red">Cần sửa ${esc(metric.revisionCount)}</span>` : ""}${metric.rejectedCount ? `<span class="pill red">Từ chối ${esc(metric.rejectedCount)}</span>` : ""}</div>${!scoreEnabled ? `<div class="maintenance-note">Tham chiếu — không tính vào điểm tháng</div>` : ""}</article>`;
  }).join("")}</div>`;
}

function kpiTeamEventAssignment(event) {
  return kpiTeamEmployeeAssignments().find(row => kpiTeamAssignmentId(row) === clean(event.assignment_id || event.assignmentId));
}

async function loadKpiTeamEmployeeProposals({force = false} = {}) {
  const employeeId = clean(kpiTeamState.selectedEmployeeId);
  if (!employeeId || !isManager()) return;
  const cacheKey = `${clean(kpiTeamState.selectedPeriodId)}:${employeeId}`;
  if (!force && kpiTeamState.proposalCacheKey === cacheKey && !kpiTeamState.errors.proposals) {
    renderKpiTeamEmployeeDetail();
    return;
  }
  const assignments = kpiTeamEmployeeAssignments(employeeId);
  const ids = assignments.map(kpiTeamAssignmentId).filter(Boolean);
  const token = ++kpiTeamState.proposalToken;
  kpiTeamState.loading.proposals = true;
  kpiTeamState.errors.proposals = "";
  kpiTeamState.employeeEvents = [];
  kpiTeamState.employeeEvidence = [];
  kpiTeamState.duplicateDetails = [];
  renderKpiTeamEmployeeDetail();
  if (!ids.length) {
    kpiTeamState.loading.proposals = false;
    renderKpiTeamEmployeeDetail();
    return;
  }
  try {
    kpiTeamState.requests.proposals = 1;
    const eventResult = await supabase.from("kpi_submission_events").select("*").in("assignment_id", ids).order("created_at", {ascending:false}).limit(500);
    if (eventResult.error) throw eventResult.error;
    if (token !== kpiTeamState.proposalToken || employeeId !== clean(kpiTeamState.selectedEmployeeId)) return;
    const events = eventResult.data || [];
    const eventIds = events.map(row => row.id).filter(Boolean);
    let evidence = [];
    if (eventIds.length) {
      kpiTeamState.requests.proposals += 1;
      const evidenceResult = await supabase.from("kpi_evidence").select("id,event_id,assignment_id,object_path,status").in("event_id", eventIds).eq("status", "ATTACHED").limit(1000);
      if (evidenceResult.error) throw evidenceResult.error;
      evidence = evidenceResult.data || [];
    }
    let duplicates = [];
    const possibleDuplicateIds = events.filter(row => row.possible_duplicate).map(row => row.id);
    if (possibleDuplicateIds.length) {
      kpiTeamState.requests.proposals += 1;
      duplicates = await callCrmRpc("crm_kpi_get_duplicate_context", {p_event_ids:possibleDuplicateIds}) || [];
    }
    if (token !== kpiTeamState.proposalToken || employeeId !== clean(kpiTeamState.selectedEmployeeId)) return;
    kpiTeamState.employeeEvents = events;
    kpiTeamState.employeeEvidence = evidence;
    kpiTeamState.duplicateDetails = duplicates;
    kpiTeamState.proposalCacheKey = cacheKey;
    kpi2Evidence = evidence;
  } catch (error) {
    if (token !== kpiTeamState.proposalToken) return;
    kpiTeamState.errors.proposals = `Không tải được đề xuất của nhân viên: ${authMessage(error)}`;
    throw error;
  } finally {
    if (token === kpiTeamState.proposalToken) {
      kpiTeamState.loading.proposals = false;
      renderKpiTeamEmployeeDetail();
    }
  }
}

function renderKpiTeamProposalTab(summary) {
  const target = $("kpiTeamDetailContent");
  if (kpiTeamState.loading.proposals) {
    $("kpiTeamDetailStatus").textContent = "Đang tải đề xuất KPI...";
    target.innerHTML = kpiTeamSkeleton(3);
    return;
  }
  if (kpiTeamState.errors.proposals) {
    $("kpiTeamDetailStatus").innerHTML = `<span class="error-text">${esc(kpiTeamState.errors.proposals)}</span>`;
    target.innerHTML = `<div class="kpi-team-empty"><button class="small primary" type="button" data-kpi-team-retry="proposals">Thử lại</button></div>`;
    return;
  }
  const events = filterKpiEvents(kpiTeamState.employeeEvents, kpiTeamState.eventStatus);
  const pendingCount = kpiTeamState.employeeEvents.filter(row => clean(row.status).toUpperCase() === "PENDING").length;
  const evidenceCounts = groupEvidenceCount(kpiTeamState.employeeEvidence);
  $("kpiTeamDetailStatus").textContent = `${kpiTeamState.employeeEvents.length} đề xuất · ${pendingCount} chờ duyệt`;
  target.innerHTML = `<div class="kpi-team-event-filters" role="tablist" aria-label="Lọc trạng thái đề xuất">${[["all","Tất cả"],["pending","Chờ duyệt"],["approved","Đã duyệt"],["revision","Cần sửa"],["rejected","Từ chối"]].map(([key,label]) => `<button class="small ${kpiTeamState.eventStatus===key?"primary":""}" type="button" data-kpi-team-event-filter="${key}">${label}</button>`).join("")}</div>${pendingCount ? `<div class="kpi-team-review-controls"><select id="kpiTeamReviewDecision"><option value="APPROVED">Duyệt</option><option value="NEEDS_REVISION">Yêu cầu bổ sung</option><option value="REJECTED">Từ chối</option></select><select id="kpiTeamReviewReason"><option value="">-- Lý do --</option><option>DUPLICATE</option><option>INVALID_EVIDENCE</option><option>MISSING_LOCATION</option><option>MISSING_TIMESTAMP</option><option>INCOMPLETE_INFORMATION</option><option>NOT_NEW</option><option>OUT_OF_SCOPE</option><option>OTHER</option></select><input id="kpiTeamManagerNote" placeholder="Ghi chú Manager"><button id="kpiTeamReviewBtn" class="small primary" type="button">Xử lý mục đã chọn</button></div>` : ""}<div class="kpi-team-event-list">${events.length ? events.map(event => {
    const assignment = kpiTeamEventAssignment(event);
    const snapshot = event.event_snapshot || {};
    const evidenceCount = evidenceCounts.get(clean(event.id)) || 0;
    const duplicateCount = kpiTeamState.duplicateDetails.filter(row => clean(kpiTeamValue(row, "eventId", "event_id")) === clean(event.id)).length;
    const focused = clean(kpiTeamState.focusedEventId) === clean(event.id);
    return `<article class="kpi-team-event-card ${focused ? "is-focused" : ""}"><div class="kpi-team-event-head"><div>${clean(event.status).toUpperCase()==="PENDING"?`<input type="checkbox" data-kpi2-review-event="${esc(event.id)}" data-version="${esc(event.lock_version)}" aria-label="Chọn đề xuất ${esc(snapshot.title || kpiTeamDefinitionName(assignment))}">`:""}<b>${esc(kpiTeamDefinitionName(assignment))}</b></div><span class="pill ${kpiTeamStatusClass(event.status)}">${esc(kpiTeamStatusLabel(event.status))}</span></div><div class="kpi-team-event-body"><b>${esc(snapshot.title || snapshot.description || snapshot.customer_name || event.source_type || "Đề xuất KPI")}</b><span>${esc(fmtDate(event.event_at))} · Giá trị ${esc(kpiTeamNumber(event.claimed_value, 2))}</span><span>${evidenceCount} ảnh minh chứng${event.location ? " · Có vị trí" : ""}${event.event_at ? " · Có thời gian" : ""}</span>${event.possible_duplicate ? `<span class="pill orange">Có thể trùng${duplicateCount ? ` · ${esc(duplicateCount)} kết quả` : ""}</span>` : ""}${event.manager_note ? `<div class="detail-note">${esc(event.manager_note)}</div>` : ""}</div><div class="actions">${evidenceCount ? `<button class="small" type="button" data-kpi2-view-evidence="${esc(event.id)}">Xem ${esc(evidenceCount)} ảnh</button>` : ""}</div></article>`;
  }).join("") : `<div class="kpi-team-empty"><b>Không có đề xuất trong bộ lọc này.</b><span>${summary.name} chưa có dữ liệu phù hợp.</span></div>`}</div>`;
}

async function loadKpiTeamGlobalQueue({force = false} = {}) {
  if (!isManager()) return;
  kpiTeamState.activeMode = "employees";
  applyKpiManagerModeVisibility();
  const ids = kpiTeamState.assignmentProgress.map(kpiTeamAssignmentId).filter(Boolean);
  if (!force && kpiTeamState.globalQueueEvents.length && !kpiTeamState.errors.queue) return renderKpiTeamGlobalQueue();
  kpiTeamState.globalQueueOpen = true;
  kpiTeamState.loading.queue = true;
  kpiTeamState.errors.queue = "";
  renderKpiTeamShell();
  if (!ids.length) {
    kpiTeamState.globalQueueEvents = [];
    kpiTeamState.loading.queue = false;
    renderKpiTeamShell();
    return;
  }
  kpiTeamState.requests.queue = 1;
  const result = await supabase.from("kpi_submission_events").select("*").in("assignment_id", ids).eq("status", "PENDING").order("created_at", {ascending:false}).limit(500);
  if (result.error) {
    kpiTeamState.loading.queue = false;
    kpiTeamState.errors.queue = `Không tải được hàng đợi: ${authMessage(result.error)}`;
    renderKpiTeamShell();
    throw result.error;
  }
  kpiTeamState.globalQueueEvents = result.data || [];
  kpiTeamState.loading.queue = false;
  renderKpiTeamShell();
}

function renderKpiTeamGlobalQueue() {
  const target = $("kpiTeamContent");
  if (!target) return;
  $("kpiTeamStatus").textContent = "Hàng đợi phụ để xử lý nhanh; mỗi đề xuất luôn gắn với một nhân viên.";
  if (kpiTeamState.loading.queue) return void (target.innerHTML = kpiTeamSkeleton(3));
  if (kpiTeamState.errors.queue) return void (target.innerHTML = `<div class="kpi-team-empty"><b>${esc(kpiTeamState.errors.queue)}</b><button class="small primary" type="button" data-kpi-team-retry="queue">Thử lại</button></div>`);
  const progressByAssignment = new Map(kpiTeamState.assignmentProgress.map(row => [kpiTeamAssignmentId(row), row]));
  target.innerHTML = `<div class="pro-section-title"><h3>Cần duyệt</h3><button class="small" type="button" data-kpi-team-close-queue>Quay lại nhân viên</button></div><div class="kpi-team-event-list">${kpiTeamState.globalQueueEvents.length ? kpiTeamState.globalQueueEvents.map(event => {
    const progress = progressByAssignment.get(clean(event.assignment_id));
    const employeeId = clean(kpiTeamValue(progress, "employeeId", "employee_id"));
    const snapshot = event.event_snapshot || {};
    return `<article class="kpi-team-event-card"><div class="kpi-team-event-head"><div><b>${esc(kpiTeamValue(progress, "employeeName", "employee_name") || "Nhân viên")}</b><span>${esc(kpiTeamDefinitionName(progress))}</span></div><span class="pill orange">Chờ duyệt</span></div><div class="kpi-team-event-body"><b>${esc(snapshot.title || snapshot.description || event.source_type || "Đề xuất KPI")}</b><span>${esc(fmtDate(event.event_at))} · Giá trị ${esc(kpiTeamNumber(event.claimed_value, 2))}</span></div><div class="actions"><button class="small primary" type="button" data-kpi-team-open-event="${esc(event.id)}" data-employee-id="${esc(employeeId)}">Mở đề xuất</button></div></article>`;
  }).join("") : `<div class="kpi-team-empty"><b>Không có event chờ duyệt.</b></div>`}</div>`;
}

async function openKpiTeamGlobalEvent(eventId, employeeId) {
  openKpiTeamEmployee(employeeId, "overview");
  kpiTeamState.activeEmployeeTab = "proposals";
  kpiTeamState.focusedEventId = eventId;
  renderKpiTeamEmployeeDetail();
  await loadKpiTeamEmployeeProposals({force:true});
  renderKpiTeamEmployeeDetail();
  requestAnimationFrame(() => $("kpiTeamDetailDrawer")?.querySelector(".kpi-team-event-card.is-focused")?.scrollIntoView({behavior:"smooth", block:"center"}));
}

async function loadKpiTeamEmployeeHistory({force = false} = {}) {
  if (!isManager() || !kpiTeamState.selectedEmployeeId) return;
  if (!force && kpiTeamState.historyProgress.length && !kpiTeamState.errors.history) return renderKpiTeamEmployeeDetail();
  const token = ++kpiTeamState.historyToken;
  kpiTeamState.loading.history = true;
  kpiTeamState.errors.history = "";
  renderKpiTeamEmployeeDetail();
  try {
    const progress = await callCrmRpc("crm_kpi_get_assignment_progress", {p_period_id:null}) || [];
    const periodIds = uniq(progress.map(row => clean(kpiTeamValue(row, "periodId", "period_id"))).filter(Boolean));
    const periods = periodIds.map(id => {
      const saved = kpiPeriods.find(row => clean(row.id) === id);
      const sample = progress.find(row => clean(kpiTeamValue(row, "periodId", "period_id")) === id);
      return saved ? {...saved, status:kpiTeamValue(sample, "periodStatus", "period_status") || saved.status} : {
        id,
        periodMonth:kpiTeamValue(sample, "periodMonth", "period_month"),
        status:kpiTeamValue(sample, "periodStatus", "period_status")
      };
    }).sort((a,b) => clean(b.periodMonth).localeCompare(clean(a.periodMonth)));
    kpiTeamState.requests.history = 1 + periods.length;
    const scoreRows = await Promise.all(periods.map(async period => [period.id, await callCrmRpc("crm_kpi_get_monthly_scores", {p_period_id:period.id}) || []]));
    if (token !== kpiTeamState.historyToken) return;
    kpiTeamState.historyProgress = progress;
    kpiTeamState.historyPeriods = periods;
    kpiTeamState.historyScoresByPeriod = new Map(scoreRows);
  } catch (error) {
    if (token !== kpiTeamState.historyToken) return;
    kpiTeamState.errors.history = `Không tải được lịch sử KPI: ${authMessage(error)}`;
    throw error;
  } finally {
    if (token === kpiTeamState.historyToken) {
      kpiTeamState.loading.history = false;
      renderKpiTeamEmployeeDetail();
    }
  }
}

function renderKpiTeamEmployeeHistory(summary) {
  const target = $("kpiTeamDetailContent");
  if (kpiTeamState.loading.history) {
    $("kpiTeamDetailStatus").textContent = "Đang tải lịch sử KPI...";
    target.innerHTML = kpiTeamSkeleton(3);
    return;
  }
  if (kpiTeamState.errors.history) {
    $("kpiTeamDetailStatus").innerHTML = `<span class="error-text">${esc(kpiTeamState.errors.history)}</span>`;
    target.innerHTML = `<div class="kpi-team-empty"><button class="small primary" type="button" data-kpi-team-retry="history">Thử lại</button></div>`;
    return;
  }
  const rows = kpiTeamState.historyPeriods
    .map(period => {
      const assignments = kpiTeamState.historyProgress.filter(row => clean(kpiTeamValue(row, "periodId", "period_id")) === clean(period.id) && clean(kpiTeamValue(row, "employeeId", "employee_id")) === summary.id);
      const score = (kpiTeamState.historyScoresByPeriod.get(period.id) || []).find(row => clean(kpiTeamValue(row, "employeeId", "employee_id")) === summary.id);
      return {period, assignments, score};
    })
    .filter(row => row.assignments.length || row.score);
  $("kpiTeamDetailStatus").textContent = `${rows.length} kỳ KPI có dữ liệu`;
  target.innerHTML = rows.length ? `<div class="kpi-team-history-list">${rows.map(row => {
    const monthlyScore = row.score == null ? null : Number(kpiTeamValue(row.score, "monthlyScore", "monthly_score") || 0);
    const openCount = row.assignments.reduce((sum, item) => sum + (kpiTeamValue(item, "hasOpenItems", "has_open_items") ? 1 : 0), 0);
    return `<details class="kpi-team-history-detail"><summary><span><b>${esc(kpi1PeriodLabel(row.period))}</b><small>${esc(clean(row.period.status).toUpperCase())}</small></span><span><b>${monthlyScore == null ? "Chưa có điểm" : `${esc(kpiTeamNumber(monthlyScore, 2))}%`}</b><small>${esc(row.assignments.length)} KPI${openCount ? ` · ${esc(openCount)} mục mở` : ""}</small></span></summary><div class="kpi-team-history-assignments">${row.assignments.map(item => { const metric=assignmentProgressMetrics(item); return `<div><span><b>${esc(kpiTeamDefinitionName(item))}</b><small>${kpiTeamValue(item,"scoreEnabled","score_enabled") ? "Tính điểm" : "Tham chiếu"}</small></span><span>${esc(kpiTeamNumber(metric.actual,2))}/${esc(kpiTeamNumber(metric.target,2))} · ${esc(kpiTeamNumber(metric.scoringPercent,2))}%</span></div>`; }).join("")}</div></details>`;
  }).join("")}</div>` : `<div class="kpi-team-empty"><b>Chưa có dữ liệu KPI ở các kỳ trước.</b></div>`;
}

function openKpiTeamAssign(employeeId) {
  const summary = kpiTeamSummaries().find(row => row.id === clean(employeeId));
  const period = kpiTeamPeriod();
  if (!summary || !period) return notice("Không tìm thấy nhân viên hoặc kỳ KPI.", true);
  if (clean(period.status).toUpperCase() !== "DRAFT") return notice("Chỉ có thể gán hoặc cấu hình KPI khi kỳ đang ở trạng thái DRAFT.", true);
  const assignedDefinitionIds = new Set(kpiTeamRawAssignments(period.id).filter(row => assignmentEmployeeId(row) === summary.id).map(row => clean(row.definitionId)));
  const definitions = kpiDefinitions.filter(row => row.active !== false);
  $("kpiTeamAssignTitle").textContent = `Gán KPI cho ${summary.name}`;
  $("kpiTeamAssignSubtitle").textContent = `Kỳ ${kpi1PeriodLabel(period)} · DRAFT`;
  $("kpiTeamAssignDefinition").innerHTML = `<option value="">-- Chọn KPI --</option>${definitions.map(row => `<option value="${esc(row.id)}" ${assignedDefinitionIds.has(clean(row.id)) ? "disabled" : ""}>${esc(row.name || row.code)}${assignedDefinitionIds.has(clean(row.id)) ? " · Đã gán" : ""}</option>`).join("")}`;
  $("kpiTeamAssignTarget").value = "";
  $("kpiTeamAssignScoreEnabled").checked = true;
  $("kpiTeamAssignDefinitionMeta").textContent = definitions.length ? "Chọn KPI dùng chung, sau đó nhập mục tiêu cho nhân viên." : "Bộ KPI chưa có định nghĩa đang hoạt động.";
  $("kpiTeamAssignWarning").classList.toggle("hide", definitions.length > 0);
  $("kpiTeamAssignWarning").textContent = definitions.length ? "" : "Chưa có KPI khả dụng. Hãy tạo hoặc bật KPI trong Bộ KPI.";
  $("kpiTeamAssignSubmitBtn").disabled = !definitions.length;
  $("kpiTeamAssignDrawer").dataset.employeeId = summary.id;
  $("kpiTeamAssignBackdrop").classList.remove("hide");
  $("kpiTeamAssignDrawer").classList.remove("hide");
  $("kpiTeamAssignDefinition").focus();
}

function closeKpiTeamAssign() {
  $("kpiTeamAssignBackdrop")?.classList.add("hide");
  $("kpiTeamAssignDrawer")?.classList.add("hide");
  if ($("kpiTeamAssignDrawer")) delete $("kpiTeamAssignDrawer").dataset.employeeId;
}

function updateKpiTeamAssignDefinitionMeta() {
  const definition = kpiDefinitions.find(row => clean(row.id) === clean($("kpiTeamAssignDefinition")?.value));
  if (!definition) {
    $("kpiTeamAssignDefinitionMeta").textContent = "Chọn KPI dùng chung, sau đó nhập mục tiêu cho nhân viên.";
    return;
  }
  const safeDefault = clean(definition.sourceMetricKey).toLowerCase() !== "deals_v1";
  $("kpiTeamAssignScoreEnabled").checked = safeDefault;
  $("kpiTeamAssignDefinitionMeta").textContent = `${definition.aggregationMode || "COUNT"} · ${definition.unit || "đơn vị"}${safeDefault ? "" : " · Mặc định chỉ tham chiếu (fail-closed)"}`;
}

async function submitKpiTeamAssignment() {
  const employeeId = clean($("kpiTeamAssignDrawer")?.dataset.employeeId);
  const definitionId = clean($("kpiTeamAssignDefinition")?.value);
  const target = Number($("kpiTeamAssignTarget")?.value || 0);
  const period = kpiTeamPeriod();
  if (!employeeId || !period) return notice("Thiếu nhân viên hoặc kỳ KPI.", true);
  if (clean(period.status).toUpperCase() !== "DRAFT") return notice("Chỉ có thể gán KPI khi kỳ đang ở trạng thái DRAFT.", true);
  if (!definitionId) return notice("Hãy chọn KPI cần gán.", true);
  if (!(target > 0)) return notice("Mục tiêu KPI phải lớn hơn 0.", true);
  const definition = kpiDefinitions.find(row => clean(row.id) === definitionId);
  const expectedDefault = clean(definition?.sourceMetricKey).toLowerCase() !== "deals_v1";
  const requestedScoreEnabled = !!$("kpiTeamAssignScoreEnabled")?.checked;
  let assigned;
  try {
    assigned = await callCrmRpc("crm_kpi_assign_employee", {
      p_period_id:period.id,
      p_definition_id:definitionId,
      p_employee_id:employeeId,
      p_target:target,
      p_expected_period_version:Number(period.version)
    });
    if (requestedScoreEnabled !== expectedDefault) {
      await callCrmRpc("crm_kpi_update_assignment_options", {
        p_assignment_id:assigned.id,
        p_score_enabled:requestedScoreEnabled,
        p_expected_assignment_version:Number(assigned.lock_version || 1),
        p_expected_period_version:Number(assigned.periodVersion)
      });
    }
  } catch (error) {
    kpiTeamState.summaryCacheKey = "";
    await reloadKpiFoundationData().catch(() => {});
    await reloadKpiTeamSummary({force:true}).catch(() => {});
    if (assigned?.id) throw new Error(`KPI đã được gán nhưng chưa cập nhật được tùy chọn tính điểm. Dữ liệu đã được tải lại. ${authMessage(error)}`);
    throw error;
  }
  closeKpiTeamAssign();
  kpiTeamState.summaryCacheKey = "";
  await reloadKpiFoundationData();
  await reloadKpiTeamSummary({force:true});
  renderKpiTeamEmployeeDetail();
  notice("Đã gán KPI và tải lại dữ liệu từ hệ thống.");
}

async function reloadKpi2Data() {
  if (!currentUser || !$('kpi2OperationsPanel')) return;
  kpi2Progress = await callCrmRpc("crm_kpi_get_assignment_progress", {p_period_id:null}) || [];
  const [eventsResult,evidenceResult] = await Promise.all([
    supabase.from("kpi_submission_events").select("*").order("created_at",{ascending:false}).limit(500),
    supabase.from("kpi_evidence").select("*").in("status",["STAGED","ATTACHED","ARCHIVED"]).limit(1000)
  ]);
  if (eventsResult.error) throw eventsResult.error;
  if (evidenceResult.error) throw evidenceResult.error;
  kpi2Events = eventsResult.data || []; kpi2Evidence = evidenceResult.data || [];
  kpi2DuplicateDetails = [];
  if (isManager()) {
    const duplicateEventIds = kpi2Events.filter(event => event.possible_duplicate).map(event => event.id).slice(0, 500);
    if (duplicateEventIds.length) {
      kpi2DuplicateDetails = await callCrmRpc("crm_kpi_get_duplicate_context", {p_event_ids: duplicateEventIds}) || [];
    }
  }
  renderKpi2Operations();
}

function renderKpi2Operations() {
  const rows=$('kpi2ProgressRows'); if(!rows)return;
  rows.innerHTML=kpi2Progress.length?kpi2Progress.map(row=>{
    const id=kpi2Field(row,"assignmentId","assignment_id"), target=Number(row.target||0), actual=Number(kpi2Field(row,"approvedActual","approved_actual")||0);
    const pending=Number(kpi2Field(row,"pendingCount","pending_count")||0), revision=Number(kpi2Field(row,"needsRevisionCount","needs_revision_count")||0);
    const pct=Number(kpi2Field(row,"actualCompletionPct","actual_completion_pct")||0), score=Number(kpi2Field(row,"scoringCompletionPct","scoring_completion_pct")||0);
    const employee=kpi2Field(row,"employeeName","employee_name")||kpi2Field(row,"employeeId","employee_id");
    return `<div class="kpi2-progress-card"><div><b>${esc(kpi2DefinitionName(row))}</b>${isManager()?`<div class="muted">${esc(employee)}</div>`:""}</div>
      <div class="metric">${esc(actual)} / ${esc(target)}</div><div class="kpi2-progress-meta"><span class="pill green">Đã duyệt ${esc(actual)}</span><span class="pill orange">Chờ ${esc(pending)}</span>${revision?`<span class="pill red">Bổ sung ${esc(revision)}</span>`:""}</div>
      <div class="muted">Actual ${esc(pct)}% · Score ${esc(score)}%${kpi2Field(row,"scoreEnabled","score_enabled")?"":" · Chỉ tham khảo"}</div>
      ${!isManager()?`<div class="actions"><button class="small primary" type="button" data-kpi2-open-claim="${esc(id)}">Gửi event</button>${revision?`<button class="small" type="button" data-kpi2-open-revision="${esc(id)}">Bổ sung (${esc(revision)})</button>`:""}</div>`:""}</div>`;
  }).join(""):`<div class="muted">Chưa có KPI ACTIVE được giao.</div>`;
  $('kpi2ManagerReviewPanel')?.classList.toggle('hide',!isManager());
  if(isManager()) renderKpi2ReviewQueue();
}

function renderKpi2ReviewQueue(){
  const pending=kpi2Events.filter(e=>e.status==='PENDING'); $('kpi2ReviewCount').textContent=`${pending.length} pending`;
  $('kpi2ReviewRows').innerHTML=pending.length?pending.map(e=>{
    const progress=kpi2Progress.find(p=>clean(kpi2Field(p,"assignmentId","assignment_id"))===clean(e.assignment_id));
    const evidence=kpi2Evidence.filter(x=>x.event_id===e.id);
    const snapshot=e.event_snapshot||{};
    const duplicateDetails=kpi2DuplicateDetails.filter(item=>clean(kpi2Field(item,"eventId","event_id"))===clean(e.id));
    const duplicateHtml=duplicateDetails.length?`<div class="muted">Trùng với ${esc(duplicateDetails.length)} event; chỉ quản lý được xem chi tiết.</div>`:"";
    return `<tr><td><input type="checkbox" data-kpi2-review-event="${esc(e.id)}" data-version="${esc(e.lock_version)}"></td>
      <td><b>${esc(kpi2Field(progress,"employeeName","employee_name")||e.actor_user_id)}</b><div class="muted">${esc(kpi2DefinitionName(progress))}</div></td>
      <td><b>${esc(snapshot.title||snapshot.customer_name||e.source_type)}</b><div class="muted">${esc(fmtDate(e.event_at))} · ${esc(e.source_type)}</div>${e.possible_duplicate?`<span class="pill orange">Có thể trùng</span>${duplicateHtml}`:""}</td>
      <td>${esc(e.claimed_value)}</td><td>${evidence.length?`<button class="small" data-kpi2-view-evidence="${esc(e.id)}">Xem ${evidence.length} ảnh</button>`:"Không có"}</td><td>${kpi1StatusHtml(e.status)}</td></tr>`;
  }).join(""):`<tr><td colspan="6" class="muted">Không có event chờ duyệt.</td></tr>`;
}

async function openKpi2Claim(assignmentId){
  const row=kpi2Progress.find(p=>clean(kpi2Field(p,"assignmentId","assignment_id"))===clean(assignmentId));if(!row)return notice('Không tìm thấy assignment KPI.',true);
  if(!restoreKpi2StagedEvidence(assignmentId))return notice('Hãy gửi hoặc hủy các ảnh đang chờ của KPI hiện tại trước.',true);
  $('kpi2ClaimAssignmentId').value=assignmentId;$('kpi2RevisionEventId').value='';$('kpi2ClaimTitle').textContent=`Gửi event · ${kpi2DefinitionName(row)}`;
  const snapshot=kpi2Field(row,"definitionSnapshot","definition_snapshot")||{}; const hybrid=['HYBRID','AUTO'].includes(clean(snapshot.kpi_type).toUpperCase());
  $('kpi2HybridCandidateArea').classList.toggle('hide',!hybrid);$('kpi2ManualEventArea').classList.toggle('hide',hybrid);
  $('kpi2SaleClaimPanel').classList.remove('hide');$('kpi2ManualEventAt').value=kpi2DatetimeLocalValue();
  if(hybrid){kpi2Candidates=await callCrmRpc('crm_kpi_list_hybrid_candidates',{p_assignment_id:assignmentId})||[];$('kpi2CandidateRows').innerHTML=kpi2Candidates.length?kpi2Candidates.map(c=>`<label class="kpi2-candidate-row"><input type="checkbox" data-kpi2-candidate="${esc(c.sourceId)}" ${c.claimed?'disabled':''}><span><b>${esc(c.customerName||c.summary||c.sourceType)}</b><div class="muted">${esc(c.summary||'')} · ${esc(fmtDate(c.eventAt))}</div></span><span>${c.claimed?'<span class="pill">Đã claim</span>':''}</span></label>`).join(''):'<div class="muted">Không có candidate chưa gửi.</div>';}
  $('kpi2SaleClaimPanel').scrollIntoView({behavior:'smooth',block:'start'});
}

function openKpi2Revision(assignmentId){
  const row=kpi2Progress.find(p=>clean(kpi2Field(p,"assignmentId","assignment_id"))===clean(assignmentId));
  const supersededIds=new Set(kpi2Events.map(event=>clean(event.supersedes_event_id)).filter(Boolean));
  const event=kpi2Events.find(item=>clean(item.assignment_id)===clean(assignmentId)&&item.status==='NEEDS_REVISION'&&!supersededIds.has(clean(item.id)));
  if(!row||!event)return notice('Không còn event nào cần bổ sung.',true);
  if(!restoreKpi2StagedEvidence(assignmentId))return notice('Hãy gửi hoặc hủy các ảnh đang chờ của KPI hiện tại trước.',true);
  const snapshot=kpi2Field(row,'definitionSnapshot','definition_snapshot')||{},eventSnapshot=event.event_snapshot||{};
  $('kpi2ClaimAssignmentId').value=assignmentId;$('kpi2RevisionEventId').value=event.id;$('kpi2ClaimTitle').textContent=`Bổ sung event · ${kpi2DefinitionName(row)}`;
  $('kpi2HybridCandidateArea').classList.add('hide');$('kpi2ManualEventArea').classList.remove('hide');$('kpi2SaleClaimPanel').classList.remove('hide');
  $('kpi2ManualDescription').value=eventSnapshot.title||eventSnapshot.description||'';$('kpi2ManualEventAt').value=kpi2DatetimeLocalValue(event.event_at);$('kpi2ManualValue').value=Number(event.claimed_value||1);$('kpi2SaleNote').value='';$('kpi2EvidenceFiles').value='';
  $('kpi2LocationStatus').textContent=event.manager_note?`Manager yêu cầu: ${event.manager_note}`:(snapshot.location_required?'Cần gửi lại vị trí hiện tại.':'');
  $('kpi2SaleClaimPanel').scrollIntoView({behavior:'smooth',block:'start'});
}

async function compressKpi2Image(file){
  if(file.size>20*1024*1024)throw new Error('Ảnh gốc vượt 20MB.');
  if(/heic|heif/i.test(file.type||file.name))throw new Error('Thiết bị chưa hỗ trợ HEIC/HEIF. Vui lòng chọn ảnh JPEG/WebP.');
  const bitmap=await createImageBitmap(file);const scale=Math.min(1,1920/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  let quality=.86,blob;do{blob=await new Promise(r=>canvas.toBlob(r,'image/webp',quality));quality-=.08;}while(blob&&blob.size>1.5*1024*1024&&quality>=.46);if(!blob||blob.size>1.5*1024*1024)throw new Error('Không thể nén ảnh xuống dưới 1.5MB.');return blob;
}

function kpi2EvidenceValue(row,camel,snake){return row?.[camel]??row?.[snake]??null;}
function clearKpi2StagedEvidenceLocal(){
  kpi2StagedEvidence.forEach(item=>{if(item.previewUrl)URL.revokeObjectURL(item.previewUrl);});
  kpi2StagedEvidence=[];
  if($('kpi2EvidenceFiles'))$('kpi2EvidenceFiles').value='';
  renderKpi2StagedEvidence();
}
function renderKpi2StagedEvidence(){
  const target=$('kpi2StagedEvidenceList');if(!target)return;
  const rows=kpi2StagedEvidence.filter(item=>!item.discardedAt);
  target.innerHTML=rows.length?rows.map(item=>{
    const pending=item.status==='ARCHIVED',busy=kpi2EvidenceBusy&&item.busy;
    return `<div class="kpi2-staged-evidence-item ${pending?'is-pending':''}">${item.previewUrl?`<img src="${esc(item.previewUrl)}" alt="Ảnh đang chờ gửi">`:`<span class="pill">Ảnh</span>`}<div><div class="evidence-name">${esc(item.originalName||'minh-chung.webp')}</div><div class="muted">${pending?'Đang chờ xóa file khỏi Storage':'Đã tải lên, chưa gửi'}${item.error?` · ${esc(item.error)}`:''}</div></div><button class="small danger" type="button" data-kpi2-discard-evidence="${esc(item.id)}" ${busy?'disabled':''}>${busy?'Đang xóa...':pending?'Thử xóa lại':'Xóa ảnh'}</button></div>`;
  }).join(''):'<span class="muted">Chưa chọn ảnh.</span>';
}
function restoreKpi2StagedEvidence(assignmentId){
  if(kpi2StagedEvidence.some(item=>clean(item.assignmentId)!==clean(assignmentId)&&!item.discardedAt))return false;
  if(kpi2StagedEvidence.length)return true;
  kpi2StagedEvidence=kpi2Evidence.filter(row=>clean(kpi2EvidenceValue(row,'assignmentId','assignment_id'))===clean(assignmentId)&&!kpi2EvidenceValue(row,'eventId','event_id')&&['STAGED','ARCHIVED'].includes(clean(row.status).toUpperCase())&&!kpi2EvidenceValue(row,'discardedAt','discarded_at')).map(row=>({
    id:row.id,assignmentId:kpi2EvidenceValue(row,'assignmentId','assignment_id'),objectPath:kpi2EvidenceValue(row,'objectPath','object_path'),originalName:kpi2EvidenceValue(row,'originalName','original_name'),status:clean(row.status).toUpperCase(),lockVersion:Number(kpi2EvidenceValue(row,'lockVersion','lock_version')||1),discardedAt:kpi2EvidenceValue(row,'discardedAt','discarded_at')
  }));
  renderKpi2StagedEvidence();return true;
}
async function stageKpi2Evidence(assignmentId,file){
  const blob=await compressKpi2Image(file),id=crypto.randomUUID(),name=`${clean(file.name).replace(/\.[^.]+$/,'').replace(/[^A-Za-z0-9._-]+/g,'_')||'evidence'}.webp`,path=`kpi2/${appUser.uid||appUser.id}/${id}/${name}`;
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const upload=await supabase.storage.from(KPI2_EVIDENCE_BUCKET).upload(path,blob,{contentType:'image/webp',upsert:false});if(upload.error)throw upload.error;
  let row;try{row=await callCrmRpc('crm_kpi_stage_evidence',{p_evidence_id:id,p_assignment_id:assignmentId,p_object_path:path,p_original_name:name,p_mime_type:'image/webp',p_size_bytes:blob.size,p_sha256:hash});}catch(firstError){try{row=await callCrmRpc('crm_kpi_stage_evidence',{p_evidence_id:id,p_assignment_id:assignmentId,p_object_path:path,p_original_name:name,p_mime_type:'image/webp',p_size_bytes:blob.size,p_sha256:hash});}catch{throw new Error(`Ảnh đã upload nhưng chưa ghi được metadata. Không tự xóa mù; hãy báo admin với mã ${id}. Lỗi: ${authMessage(firstError)}`);}}
  return {id:row.id,assignmentId:kpi2EvidenceValue(row,'assignmentId','assignment_id')||assignmentId,objectPath:kpi2EvidenceValue(row,'objectPath','object_path')||path,originalName:kpi2EvidenceValue(row,'originalName','original_name')||name,status:clean(row.status||'STAGED').toUpperCase(),lockVersion:Number(kpi2EvidenceValue(row,'lockVersion','lock_version')||1),previewUrl:URL.createObjectURL(blob)};
}
async function handleKpi2EvidenceFiles(){
  const input=$('kpi2EvidenceFiles'),assignmentId=clean($('kpi2ClaimAssignmentId')?.value),files=[...(input?.files||[])];if(!files.length||!assignmentId)return;
  const active=kpi2StagedEvidence.filter(item=>!item.discardedAt);if(active.length+files.length>2){input.value='';return notice('Mỗi event chỉ được tối đa 2 ảnh. Hãy xóa ảnh cũ trước.',true);}
  if(kpi2EvidenceBusy)return notice('Ảnh đang được xử lý, vui lòng chờ.',true);
  kpi2EvidenceBusy=true;
  try{for(const file of files){const item=await stageKpi2Evidence(assignmentId,file);kpi2StagedEvidence.push(item);renderKpi2StagedEvidence();}notice(`Đã tải ${files.length} ảnh. Ảnh chỉ được gắn vào KPI sau khi bấm Gửi để duyệt.`);}finally{kpi2EvidenceBusy=false;input.value='';renderKpi2StagedEvidence();}
}
async function discardKpi2StagedEvidence(evidenceId){
  const item=kpi2StagedEvidence.find(row=>clean(row.id)===clean(evidenceId));if(!item||item.discardedAt)return;
  if(kpi2EvidenceBusy)return notice('Một ảnh khác đang được xử lý.',true);
  kpi2EvidenceBusy=true;item.busy=true;item.error='';renderKpi2StagedEvidence();
  try{
    if(item.status==='STAGED'){
      item.discardRequestId=item.discardRequestId||crypto.randomUUID();
      const requested=await callCrmRpc('crm_kpi_request_discard_staged_evidence',{p_evidence_id:item.id,p_request_id:item.discardRequestId,p_expected_lock_version:Number(item.lockVersion)});
      item.status=clean(requested.status||'ARCHIVED').toUpperCase();item.objectPath=kpi2EvidenceValue(requested,'objectPath','object_path')||item.objectPath;item.lockVersion=Number(kpi2EvidenceValue(requested,'lockVersion','lock_version')||item.lockVersion+1);
    }
    const removed=await supabase.storage.from(KPI2_EVIDENCE_BUCKET).remove([item.objectPath]);if(removed.error)throw removed.error;
    item.finalizeRequestId=item.finalizeRequestId||crypto.randomUUID();
    const finalized=await callCrmRpc('crm_kpi_finalize_discard_staged_evidence',{p_evidence_id:item.id,p_request_id:item.finalizeRequestId,p_expected_lock_version:Number(item.lockVersion)});
    item.lockVersion=Number(kpi2EvidenceValue(finalized,'lockVersion','lock_version')||item.lockVersion+1);item.discardedAt=kpi2EvidenceValue(finalized,'discardedAt','discarded_at')||new Date().toISOString();
    if(item.previewUrl)URL.revokeObjectURL(item.previewUrl);kpi2StagedEvidence=kpi2StagedEvidence.filter(row=>row!==item);renderKpi2StagedEvidence();notice('Đã xóa ảnh chưa gửi.');
  }catch(error){item.error=authMessage(error);throw error;}finally{item.busy=false;kpi2EvidenceBusy=false;renderKpi2StagedEvidence();}
}
async function closeKpi2Claim(){
  const pending=kpi2StagedEvidence.filter(item=>!item.discardedAt);
  if(pending.length){if(!confirm(`Bạn có muốn hủy ${pending.length} ảnh chưa gửi?`))return;for(const item of [...pending]){try{await discardKpi2StagedEvidence(item.id);}catch(error){notice(`Chưa đóng form vì còn ảnh chưa xóa: ${authMessage(error)}`,true);return;}}}
  clearKpi2StagedEvidenceLocal();$('kpi2SaleClaimPanel').classList.add('hide');$('kpi2RevisionEventId').value='';
}
async function getKpi2Location(){return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,capturedAt:new Date().toISOString()}),()=>reject(new Error('KPI này cần quyền vị trí. Hãy cho phép vị trí rồi thử lại.')),{enableHighAccuracy:true,timeout:15000,maximumAge:0}));}

async function submitKpi2Claim(){
  const assignmentId=clean($('kpi2ClaimAssignmentId').value),revisionEventId=clean($('kpi2RevisionEventId').value),progress=kpi2Progress.find(p=>clean(kpi2Field(p,'assignmentId','assignment_id'))===assignmentId),snapshot=kpi2Field(progress,'definitionSnapshot','definition_snapshot')||{};if(!progress)return;
  if(kpi2EvidenceBusy)return notice('Ảnh đang được xử lý, vui lòng chờ.',true);
  const pendingDiscard=kpi2StagedEvidence.some(item=>item.status==='ARCHIVED'&&!item.discardedAt);if(pendingDiscard)return notice('Có ảnh đang chờ xóa. Hãy bấm Thử xóa lại trước khi gửi.',true);
  const evidence=kpi2StagedEvidence.filter(item=>clean(item.assignmentId)===assignmentId&&item.status==='STAGED'&&!item.discardedAt).map(item=>item.id);if(evidence.length>2)return notice('Tối đa 2 ảnh mỗi event.',true);
  if(revisionEventId){const description=clean($('kpi2ManualDescription').value),location=snapshot.location_required?await getKpi2Location():null;await callCrmRpc('crm_kpi_submit_revision',{p_event_id:revisionEventId,p_request_id:crypto.randomUUID(),p_sale_note:clean($('kpi2SaleNote').value),p_event:{eventAt:new Date($('kpi2ManualEventAt').value).toISOString(),claimedValue:Number($('kpi2ManualValue').value||1),eventSnapshot:description?{title:description,description}:null,evidenceIds:evidence,location}});clearKpi2StagedEvidenceLocal();$('kpi2SaleClaimPanel').classList.add('hide');$('kpi2RevisionEventId').value='';await reloadKpi2Data();notice('Đã gửi bản bổ sung để Manager duyệt.');return;}
  const hybrid=['HYBRID','AUTO'].includes(clean(snapshot.kpi_type).toUpperCase());let events=[];
  if(hybrid){events=[...document.querySelectorAll('[data-kpi2-candidate]:checked')].map(el=>{const c=kpi2Candidates.find(x=>x.sourceId===el.dataset.kpi2Candidate);return {sourceType:c.sourceType,sourceId:c.sourceId,claimedValue:c.value||1,evidenceIds:[]};});if(!events.length)return notice('Hãy chọn ít nhất một candidate.',true);}
  else{const description=clean($('kpi2ManualDescription').value);if(!description)return notice('Hãy nhập nội dung event.',true);const location=snapshot.location_required?await getKpi2Location():null;events=[{sourceType:'MANUAL',sourceEventKey:`manual:${crypto.randomUUID()}`,eventAt:new Date($('kpi2ManualEventAt').value).toISOString(),claimedValue:Number($('kpi2ManualValue').value||1),eventSnapshot:{title:description,description},evidenceIds:evidence,location}];}
  await callCrmRpc('crm_kpi_submit_events',{p_assignment_id:assignmentId,p_request_id:crypto.randomUUID(),p_sale_note:clean($('kpi2SaleNote').value),p_events:events});clearKpi2StagedEvidenceLocal();$('kpi2SaleClaimPanel').classList.add('hide');await reloadKpi2Data();notice(`Đã gửi ${events.length} event để Manager duyệt.`);
}

async function reviewSelectedKpi2Events(){
  const selected=[...document.querySelectorAll('[data-kpi2-review-event]:checked')].map(x=>({eventId:x.dataset.kpi2ReviewEvent,expectedVersion:Number(x.dataset.version)}));if(!selected.length)return notice('Hãy chọn event cần xử lý.',true);
  const teamReviewVisible=isManager()&&$('kpiTeamDetailDrawer')&&!$('kpiTeamDetailDrawer').classList.contains('hide')&&$('kpiTeamReviewDecision');
  const decision=(teamReviewVisible?$('kpiTeamReviewDecision'):$('kpi2ReviewDecision')).value,reason=(teamReviewVisible?$('kpiTeamReviewReason'):$('kpi2ReviewReason')).value||null,note=clean((teamReviewVisible?$('kpiTeamManagerNote'):$('kpi2ManagerNote')).value)||null;
  if(decision==='REJECTED'&&!reason)return notice('Từ chối cần chọn reason code.',true);if((decision==='NEEDS_REVISION'||reason==='OTHER')&&!note)return notice('Cần ghi chú Manager.',true);
  if(!confirm(`${decision} ${selected.length} event? Toàn bộ batch sẽ rollback nếu một event lỗi.`))return;
  await callCrmRpc('crm_kpi_review_events',{p_request_id:crypto.randomUUID(),p_rows:selected,p_decision:decision,p_reason_code:reason,p_manager_note:note});
  await refreshKpiCutoverState({render:false});
  if(teamReviewVisible){
    kpiTeamState.summaryCacheKey='';
    kpiTeamState.globalQueueEvents=[];
    await Promise.all([reloadKpiTeamSummary({force:true}),loadKpiTeamEmployeeProposals({force:true})]);
  }else await reloadKpi2Data();
  notice(`Đã xử lý ${selected.length} event và tải lại dữ liệu.`);
}

async function viewKpi2Evidence(eventId){
  let rows=kpi2Evidence.filter(e=>clean(e.event_id||e.eventId)===clean(eventId));
  if(!rows.length){const result=await supabase.from('kpi_evidence').select('id,event_id,object_path,status').eq('event_id',eventId).eq('status','ATTACHED').limit(2);if(result.error)throw result.error;rows=result.data||[];}
  const urls=[];for(const e of rows){const {data,error}=await supabase.storage.from(KPI2_EVIDENCE_BUCKET).createSignedUrl(e.object_path,120);if(error)throw error;urls.push(data.signedUrl);}
  openDetail('Minh chứng KPI','URL ký tạm thời trong 2 phút',urls.length?`<div class="evidence-grid">${urls.map(url=>`<img src="${esc(url)}" alt="Minh chứng KPI">`).join('')}</div>`:'<div class="muted">Không có ảnh.</div>');
}

function activeKpiRules() {
  return kpiRules.filter(r => r.active !== false);
}

function kpiAssignableUsers() {
  return ownerOptions()
    .map(o => ({name: clean(o.name || o.email), email: clean(o.email || o.name)}))
    .filter(o => o.email);
}

function kpiRuleAssignedOwners(rule) {
  return Array.isArray(rule.assignedOwners) ? rule.assignedOwners.map(clean).filter(Boolean) : [];
}

function kpiRuleAppliesToOwner(rule, ownerKey) {
  const assigned = kpiRuleAssignedOwners(rule);
  if (!assigned.length) return true;
  const profile = ownerProfileByValue(ownerKey);
  const keys = [ownerKey, profile.email, profile.name].map(clean).filter(Boolean);
  return assigned.some(email => keys.some(key => normalizeKey(key) === normalizeKey(email)));
}

function kpiRuleAppliesToCurrentUser(rule) {
  if (isManager()) return true;
  return [ownerEmail(), ownerName()].some(key => kpiRuleAppliesToOwner(rule, key));
}

function proposalKpiRules() {
  return activeKpiRules().filter(kpiRuleAppliesToCurrentUser);
}

function kpiRuleTargetForOwner(rule, ownerKey) {
  const profile = ownerProfileByValue(ownerKey);
  const targets = rule.ownerTargets || {};
  const keys = [ownerKey, profile.email, profile.name].map(clean).filter(Boolean);
  for (const key of keys) {
    const targetKey = Object.keys(targets).find(savedKey => normalizeKey(savedKey) === normalizeKey(key));
    const value = Number(targets[targetKey || key] || 0);
    if (value > 0) return value;
  }
  return Number(rule.target || 0);
}

function kpiRuleSnapshotForOwner(rule, ownerKey) {
  return {
    kpiRuleId: rule?.id || "",
    kpiName: rule?.name || "",
    kpiRuleDescription: rule?.description || "",
    kpiRuleCountMode: rule?.countMode || "approvedProposals",
    kpiRuleTarget: Number(rule?.target || 0),
    kpiTargetForOwner: kpiRuleTargetForOwner(rule || {}, ownerKey),
    kpiAssignedOwners: kpiRuleAssignedOwners(rule || {}),
    snapshottedAt: new Date().toISOString()
  };
}

function renderKpiAssignmentBuilder() {
  if (!isManager()) return;
  const users = kpiAssignableUsers();
  const editingRule = editingKpiRuleId ? kpiRules.find(r => r.id === editingKpiRuleId) : null;
  const assigned = editingRule ? kpiRuleAssignedOwners(editingRule) : [];
  const defaultTarget = Number($("kpiRuleTarget")?.value || 0);
  $("kpiAssignRows").innerHTML = users.length ? users.map(u => `
    <label class="kpi-assign-row">
      <input type="checkbox" data-kpi-assign-email="${esc(u.email)}" ${!editingRule || assigned.includes(u.email) ? "checked" : ""} ${legacyKpiPreCutover() ? "" : "disabled"}>
      <span><b>${esc(u.name || u.email)}</b><div class="muted">${esc(u.email)}</div></span>
      <input type="number" min="0" step="1" value="${esc(editingRule ? kpiRuleTargetForOwner(editingRule, u.email) : (defaultTarget || ""))}" placeholder="Chỉ tiêu" data-kpi-target-email="${esc(u.email)}" ${legacyKpiPreCutover() ? "" : "disabled"}>
    </label>
  `).join("") : `<div class="muted">Chưa có nhân viên active để gán KPI.</div>`;
}

function collectKpiAssignments() {
  const assignedOwners = [];
  const ownerTargets = {};
  document.querySelectorAll("[data-kpi-assign-email]").forEach(box => {
    const email = clean(box.dataset.kpiAssignEmail);
    if (!email || !box.checked) return;
    assignedOwners.push(email);
    const targetInput = document.querySelector(`[data-kpi-target-email="${CSS.escape(email)}"]`);
    const target = Number(targetInput?.value || $("kpiRuleTarget").value || 0);
    if (target > 0) ownerTargets[email] = target;
  });
  return {assignedOwners, ownerTargets};
}

function hydrateProposalKpiOptions() {
  const el = $("proposalKpiRule");
  if (!el) return;
  const current = el.value;
  const reportMonth = clean($("kpiRuleMonth")?.value) || currentMonth();
  const rules = proposalKpiRules();
  el.innerHTML = `<option value="">-- Chọn KPI --</option>`;
  rules.forEach(rule => el.insertAdjacentHTML("beforeend", `<option value="${esc(rule.id)}" data-month="${esc(reportMonth)}">${esc(rule.name)}</option>`));
  if (!rules.length) el.insertAdjacentHTML("beforeend", `<option value="" disabled>Chưa có KPI active được gán cho bạn</option>`);
  if (rules.some(rule => rule.id === current)) el.value = current;
}

function kpiRuleValue(rule, ownerKey, month = clean($("kpiRuleMonth")?.value) || currentMonth()) {
  return kpiProposals.filter(p => {
    if (p.isDeleted) return false;
    if (!isApprovedKpiProposal(p)) return false;
    if (clean(p.kpiRuleId) !== clean(rule.id)) return false;
    if (month && kpiProposalMonth(p) !== month) return false;
    if (!kpiRuleAppliesToOwner(rule, ownerKey)) return false;
    const proposalKeys = [p.ownerEmail, p.email, p.owner].map(clean).filter(Boolean);
    const ownerProfile = ownerProfileByValue(ownerKey);
    const ownerKeys = [ownerKey, ownerProfile.email, ownerProfile.name].map(clean).filter(Boolean);
    if (!proposalKeys.some(a => ownerKeys.some(b => normalizeKey(a) === normalizeKey(b)))) return false;
    return true;
  }).length;
}

function kpiProposalMonth(p) {
  return clean(p?.month) || monthOf(p?.createdAt) || monthOf(p?.updatedAt) || "";
}

function kpiProposalStatusKey(p) {
  const raw = clean(p?.status);
  const key = normalizeKey(raw);
  if (!key || ["pending", "choduyet", "dangchoduyet", "submitted", "proposed", "reviewing", "wait", "waiting"].includes(key)) return "pending";
  if (["approved", "duyet", "daduyet", "accepted", "approve"].includes(key)) return "approved";
  if (["rejected", "tuchoi", "datuchoi", "reject", "denied"].includes(key)) return "rejected";
  return key;
}

const isApprovedKpiProposal = p => kpiProposalStatusKey(p) === "approved";
const isPendingKpiProposal = p => kpiProposalStatusKey(p) === "pending";
const isRejectedKpiProposal = p => kpiProposalStatusKey(p) === "rejected";

function kpiProposalsForRule(ruleId) {
  return kpiProposals.filter(p => clean(p.kpiRuleId) === clean(ruleId) && !p.isDeleted);
}

function approvedKpiProposalsForRule(ruleId) {
  return kpiProposalsForRule(ruleId).filter(isApprovedKpiProposal);
}

function renderKpiControlRows() {
  if (!isManager()) return;
  const month = clean($("kpiRuleMonth").value) || currentMonth();
  const rules = kpiRules;
  $("kpiControlRows").innerHTML = rules.length ? rules.map(rule => {
    const assigned = kpiRuleAssignedOwners(rule);
    const ownerRows = (assigned.length ? assigned : kpiAssignableUsers().map(u => u.email)).map(email => {
      const profile = ownerProfileByValue(email);
      const value = rule.active === false ? 0 : kpiRuleValue(rule, email, month);
      const target = kpiRuleTargetForOwner(rule, email);
      return `<div class="kpi-assignee-progress"><div><b>${esc(profile.name || email)}</b> <span class="muted">${esc(email)}</span></div>${kpiProgressHtml(value, target)}</div>`;
    }).join("");
    const totalValue = rule.active === false ? 0 : (assigned.length ? assigned : kpiAssignableUsers().map(u => u.email)).reduce((sum,email) => sum + kpiRuleValue(rule, email, month), 0);
    const totalTarget = (assigned.length ? assigned : kpiAssignableUsers().map(u => u.email)).reduce((sum,email) => sum + kpiRuleTargetForOwner(rule, email), 0);
    const statusLabel = rule.active === false ? "Đã tắt" : (totalTarget && totalValue >= totalTarget ? "Đạt" : "Đang chạy");
    const statusClass = rule.active === false ? "red" : (totalTarget && totalValue >= totalTarget ? "green" : "orange");
    return `
      <tr>
        <td><b>${esc(rule.name)}</b><div class="muted">${rule.active === false ? "Đã tắt · " : ""}${assigned.length ? "Gán riêng" : "Áp dụng tất cả nhân viên"}${rule.month ? ` · Tạo từ ${esc(rule.month)}` : ""}</div></td>
        <td>${ownerRows || "<span class='muted'>Chưa gán nhân viên</span>"}</td>
        <td>${kpiProgressHtml(totalValue, totalTarget)}</td>
        <td><span class="pill ${statusClass}">${statusLabel}</span></td>
        <td><div class="actions">${legacyKpiPreCutover() ? `<button class="small" data-edit-kpi-rule="${esc(rule.id)}">Sửa</button>${rule.active === false ? `<button class="small primary" data-activate-kpi-rule="${esc(rule.id)}">Bật lại</button>` : `<button class="small danger" data-disable-kpi-rule="${esc(rule.id)}">Tắt</button>`}` : `<span class="pill">Chỉ đọc</span>`}<button class="small" data-kpi-rule-proposals="${esc(rule.id)}">Chi tiết KPI cũ</button></div></td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="5" class="muted">Chưa có KPI.</td></tr>`;
}

function renderKpiRuleList() {
  if (!isManager()) return;
  const readOnly = !legacyKpiPreCutover();
  ["kpiRuleMonth","kpiRuleName","kpiRuleDescription","kpiRuleTarget","kpiRuleCountMode"].forEach(id => {
    if ($(id)) $(id).disabled = readOnly;
  });
  if ($("saveKpiRuleBtn")) {
    $("saveKpiRuleBtn").disabled = readOnly;
    $("saveKpiRuleBtn").textContent = readOnly ? "KPI cũ chỉ đọc" : (editingKpiRuleId ? "Lưu KPI" : "Tạo KPI");
  }
  if (readOnly) $("cancelEditKpiRuleBtn")?.classList.add("hide");
  renderKpiAssignmentBuilder();
  renderKpiControlRows();
}

function renderKpiApprovalPanel() {
  if (!isManager()) return;
  const reportMonth = clean($("kpiRuleMonth")?.value) || currentMonth();
  const scope = clean($("kpiApprovalScope")?.value) || "all";
  const proposalPending = kpiProposals
    .filter(p => isPendingKpiProposal(p) && !p.isDeleted)
    .sort(byDateDesc);
  const scopedPending = proposalPending.filter(p => {
    const month = kpiProposalMonth(p);
    if (scope === "month") return month === reportMonth;
    if (scope === "old") return month && month !== reportMonth;
    return true;
  });
  const oldPendingCount = proposalPending.filter(p => kpiProposalMonth(p) && kpiProposalMonth(p) !== reportMonth).length;
  const proposalHtml = scopedPending.length ? scopedPending.map(p => `
    <div class="rule-item kpi-approval-item">
      <div class="kpi-approval-grid">
        <div>
          <b>${esc(p.kpiName || "KPI")}</b> <span class="muted">· ${esc(kpiProposalMonth(p) || "Chưa có tháng")}</span>
          ${kpiProposalMonth(p) && kpiProposalMonth(p) !== reportMonth ? `<span class="pill orange">Tồn từ tháng cũ</span>` : ""}
          <div>${esc(p.owner || p.ownerEmail || "Nhân viên")} ${p.department ? "· " + esc(p.department) : ""}</div>
          ${p.customerName || p.customerPhone || p.customerCompanyName ? `<div class="muted">KH: ${esc([p.customerName, p.customerPhone, p.customerCompanyName].filter(Boolean).join(" · "))}</div>` : ""}
          <div class="muted">${esc([p.email, p.phone].filter(Boolean).join(" · "))}</div>
          <div>${esc(p.content || "")}</div>
          ${p.evidenceUrl ? `<div><button class="small" type="button" data-kpi-proposal-detail="${esc(p.id)}">Xem ảnh minh chứng</button></div>` : ""}
        </div>
        <div class="kpi-approval-actions">
          <button class="small" data-kpi-proposal-detail="${esc(p.id)}">Chi tiết</button>
          ${isAdmin() ? `<button class="small danger" data-delete-kpi-proposal="${esc(p.id)}">Ẩn test</button>` : ""}
          ${legacyKpiCloseoutAllowed(p) ? `<button class="small primary" data-approve-kpi-proposal="${esc(p.id)}">Duyệt</button><button class="small danger" data-reject-kpi-proposal="${esc(p.id)}">Từ chối</button>` : `<span class="pill">Chỉ đọc</span>`}
        </div>
      </div>
    </div>
  `).join("") : `<div class="muted">Không có đề xuất KPI chờ duyệt trong bộ lọc này.</div>`;
  $("kpiApprovalList").innerHTML = proposalPending.length ? `
    <div class="kpi-state-grid">
      <div><span>Tổng chờ duyệt</span><b>${esc(proposalPending.length)}</b></div>
      <div><span>Đang hiển thị</span><b>${esc(scopedPending.length)}</b></div>
      <div><span>Tháng báo cáo</span><b>${esc(reportMonth)}</b></div>
      <div class="${oldPendingCount ? "warn" : ""}"><span>Tồn tháng cũ</span><b>${esc(oldPendingCount)}</b></div>
    </div>
    ${proposalHtml}
  ` : proposalHtml;
}

function resetKpiApprovalFilter() {
  $("kpiApprovalScope").value = "all";
  renderKpiApprovalPanel();
}

function evidenceLinks(value) {
  const text = clean(value);
  if (!text) return [];
  const urls = text.match(/https?:\/\/[^\s,;]+/g);
  return uniq(urls && urls.length ? urls : text.split(/[\n,;]+/)).map(clean).filter(Boolean);
}

function googleDriveFileId(url) {
  const value = clean(url);
  return (
    value.match(/\/file\/d\/([^/?#]+)/)?.[1] ||
    value.match(/[?&]id=([^&#]+)/)?.[1] ||
    value.match(/\/d\/([^/?#]+)/)?.[1] ||
    ""
  );
}

function drivePreviewUrl(url) {
  const id = googleDriveFileId(url);
  return id ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1200` : "";
}

function directImagePreviewUrl(url) {
  const value = clean(url);
  if (!value) return "";
  if (/\/storage\/v1\/object\/public\//i.test(value)) return value;
  return /\.(png|jpe?g|webp|gif|bmp|avif)(\?|#|$)/i.test(value) ? value : "";
}

function evidencePreviewHtml(value) {
  const links = evidenceLinks(value);
  if (!links.length) return "";
  return `
    <div>
      <b>Minh chứng</b>
      <div class="evidence-grid">
        ${links.map((link, index) => {
          const preview = drivePreviewUrl(link) || directImagePreviewUrl(link);
          return `
            <div class="evidence-card">
              ${preview ? `<img src="${esc(preview)}" alt="Minh chứng ${esc(index + 1)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.classList.remove('hide');">` : ""}
              <div class="muted ${preview ? "hide" : ""}">Không xem trước được ảnh. Kiểm tra quyền ảnh hoặc mở link gốc.</div>
              <a href="${esc(link)}" target="_blank" rel="noopener">Mở minh chứng ${esc(index + 1)}</a>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function kpiProposalDetailHtml(p) {
  const rule = kpiRules.find(r => r.id === p.kpiRuleId);
  const statusLabel = kpiProposalStatusLabel(p);
  return `
    <div class="detail-list">
      <div class="detail-row">
        <div class="detail-row-head">
          <div>
            <b>${esc(p.kpiName || rule?.name || "KPI")}</b>
          <div class="detail-meta">
            <span>Tháng: ${esc(kpiProposalMonth(p) || rule?.month || "")}</span>
            <span>Trạng thái: ${esc(statusLabel)}</span>
            <span>Chỉ tiêu lúc gửi: ${esc(p.kpiTargetForOwner || p.kpiRuleTarget || rule?.target || 0)}</span>
          </div>
          </div>
        </div>
        <div class="grid2">
          <div><b>Nhân viên</b><div>${esc(p.owner || p.ownerEmail || "")}</div></div>
          <div><b>Email</b><div>${esc(p.email || p.ownerEmail || "")}</div></div>
          <div><b>SĐT</b><div>${esc(p.phone || "")}</div></div>
          <div><b>Bộ phận</b><div>${esc(p.department || "")}</div></div>
        </div>
        ${p.customerName || p.customerPhone || p.customerCompanyName ? `
          <div class="grid2">
            <div><b>Khách hàng</b><div>${esc(p.customerName || "")}</div></div>
            <div><b>SĐT KH</b><div>${esc(p.customerPhone || "")}</div></div>
            <div><b>Công ty</b><div>${esc(p.customerCompanyName || "")}</div></div>
            <div><b>Kênh</b><div>${esc(p.customerChannel || "")}</div></div>
          </div>
        ` : ""}
        <div>
          <b>Nội dung sale gửi</b>
          <div class="detail-note">${esc(p.content || "Chưa có nội dung.")}</div>
        </div>
        ${p.kpiRuleDescription ? `<div><b>Điều kiện KPI lúc gửi</b><div class="detail-note">${esc(p.kpiRuleDescription)}</div></div>` : ""}
        ${evidencePreviewHtml(p.evidenceUrl)}
        <div class="detail-meta">
          <span>Gửi lúc: ${esc(fmtDate(p.createdAt) || "")}</span>
          ${p.reviewedByEmail ? `<span>Duyệt bởi: ${esc(p.reviewedByEmail)}</span>` : ""}
          ${p.reviewedAt ? `<span>Ngày duyệt: ${esc(fmtDate(p.reviewedAt))}</span>` : ""}
        </div>
        ${p.reviewNote ? `<div><b>Ghi chú duyệt/từ chối</b><div class="detail-note">${esc(p.reviewNote)}</div></div>` : ""}
        ${(isAdmin() || canSoftDeleteKpiProposal(p)) ? `
          <div class="actions">
            ${canEditKpiProposal(p) ? `<button class="small primary" data-edit-kpi-proposal="${esc(p.id)}">Sửa đề xuất</button>` : ""}
            ${canSoftDeleteKpiProposal(p) ? `<button class="small danger" data-soft-delete-kpi-proposal="${esc(p.id)}">Xóa đề xuất</button>` : ""}
            ${isAdmin() ? `<button class="small danger" data-delete-kpi-proposal="${esc(p.id)}">Ẩn KPI test</button>` : ""}
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

function kpiProposalCard(p) {
  const statusLabel = kpiProposalStatusLabel(p);
  const statusKey = kpiProposalStatusKey(p);
  const month = kpiProposalMonth(p);
  const reportMonth = clean($("kpiRuleMonth")?.value) || currentMonth();
  return `
    <div class="detail-row kpi-proposal-card ${esc(statusKey)}">
      <div class="detail-row-head">
        <div>
          <b>${esc(p.kpiName || "KPI")}</b>
          <div class="detail-meta">
            <span class="pill ${kpiProposalStatusClass(p)}">${esc(statusLabel)}</span>
            ${month ? `<span>Tháng: ${esc(month)}</span>` : ""}
            ${month && month !== reportMonth && isPendingKpiProposal(p) ? `<span class="pill orange">Tồn tháng cũ</span>` : ""}
            <span>${esc([p.owner, p.email || p.ownerEmail].filter(Boolean).join(" - "))}</span>
            ${p.customerName ? `<span>KH: ${esc(p.customerName)}</span>` : ""}
            <span>${esc(fmtDate(p.createdAt) || "")}</span>
          </div>
        </div>
        <div class="kpi-card-actions">
          <button class="small" data-kpi-proposal-detail="${esc(p.id)}">Chi tiết</button>
          ${canEditKpiProposal(p) ? `<button class="small primary" data-edit-kpi-proposal="${esc(p.id)}">Sửa</button>` : ""}
          ${canSoftDeleteKpiProposal(p) ? `<button class="small danger" data-soft-delete-kpi-proposal="${esc(p.id)}">Xóa đề xuất</button>` : ""}
          ${isAdmin() ? `<button class="small danger" data-delete-kpi-proposal="${esc(p.id)}">Ẩn test</button>` : ""}
        </div>
      </div>
      <div class="detail-note kpi-content-preview">${esc(p.content || "")}</div>
      ${p.evidenceUrl ? `<div><button class="small" type="button" data-kpi-proposal-detail="${esc(p.id)}">Xem ảnh minh chứng</button></div>` : ""}
    </div>
  `;
}

function openKpiRuleProposals(ruleId) {
  if (!isManager()) return notice("Chỉ admin/manager được xem chi tiết KPI.", true);
  const rule = kpiRules.find(r => r.id === ruleId);
  const month = clean($("kpiRuleMonth")?.value) || currentMonth();
  const allRows = kpiProposalsForRule(ruleId).filter(p => kpiProposalMonth(p) === month);
  const rows = allRows.filter(isApprovedKpiProposal).sort(byDateDesc);
  const pending = allRows.filter(isPendingKpiProposal).length;
  const rejected = allRows.filter(isRejectedKpiProposal).length;
  openDetailModal(
    `KPI đã duyệt: ${rule?.name || "KPI"}`,
    `${rows.length} đã duyệt trong tháng ${month} · Chờ duyệt ${pending} · Từ chối ${rejected}`,
    `${rule?.description ? `<div class="detail-row"><b>Diễn giải</b><div class="detail-note">${esc(rule.description)}</div></div>` : ""}${rows.length ? `<div class="detail-list">${rows.map(kpiProposalCard).join("")}</div>` : `<div class="muted">Chưa có đề xuất KPI đã duyệt.</div>`}`
  );
}

function kpiProposalMatchesOwner(p, ownerKey) {
  const key = normalizeKey(ownerKey);
  return [p.ownerEmail, p.email, p.owner].some(v => normalizeKey(v) === key);
}

function isSelfKpiOwner(ownerKey) {
  const profile = ownerProfileByValue(ownerKey);
  const ownKeys = [ownerEmail(), ownerName()].map(clean).filter(Boolean);
  const targetKeys = [ownerKey, profile.email, profile.name].map(clean).filter(Boolean);
  return targetKeys.some(target => ownKeys.some(own => normalizeKey(target) === normalizeKey(own)));
}

function canViewKpiOwnerDetail(ownerKey) {
  return isManager() || isSelfKpiOwner(ownerKey);
}

function canViewKpiProposalDetail(proposal) {
  return isManager() || [ownerEmail(), ownerName()].some(key => kpiProposalMatchesOwner(proposal, key));
}

function canEditKpiProposal(proposal) {
  if (!proposal || proposal.isDeleted || !isPendingKpiProposal(proposal)) return false;
  return legacyKpiCloseoutAllowed(proposal) && [ownerEmail(), ownerName()].some(key => kpiProposalMatchesOwner(proposal, key));
}

function canSoftDeleteKpiProposal(proposal) {
  if (!proposal || proposal.isDeleted || isAdmin() || !isPendingKpiProposal(proposal)) return false;
  return legacyKpiCloseoutAllowed(proposal) && [ownerEmail(), ownerName()].some(key => kpiProposalMatchesOwner(proposal, key));
}

function openKpiOwnerDetail(ruleId, ownerKey) {
  if (!canViewKpiOwnerDetail(ownerKey)) return notice("Bạn chỉ xem được KPI của chính mình.", true);
  const rule = kpiRules.find(r => r.id === ruleId);
  if (!rule) return notice("Không tìm thấy KPI.", true);
  const month = clean($("kpiRuleMonth")?.value) || currentMonth();
  const profile = ownerProfileByValue(ownerKey);
  const allRows = kpiProposalsForRule(ruleId)
    .filter(p => kpiProposalMonth(p) === month)
    .filter(p => kpiProposalMatchesOwner(p, ownerKey))
    .sort(byDateDesc);
  const rows = allRows;
  const approved = allRows.filter(isApprovedKpiProposal).length;
  const pending = allRows.filter(isPendingKpiProposal).length;
  const rejected = allRows.filter(isRejectedKpiProposal).length;
  const target = kpiRuleTargetForOwner(rule, ownerKey);
  openDetailModal(
    `KPI: ${rule.name || "KPI"}`,
    `${profile.name || ownerKey}${profile.email && profile.email !== profile.name ? " · " + profile.email : ""} · Tháng ${month} · Đã duyệt ${approved}/${target || 0} · Chờ ${pending} · Từ chối ${rejected}`,
    `${rule.description ? `<div class="detail-row"><b>Diễn giải</b><div class="detail-note">${esc(rule.description)}</div></div>` : ""}${rows.length ? `<div class="detail-list">${rows.map(kpiProposalCard).join("")}</div>` : `<div class="muted">Nhân viên này chưa có đề xuất KPI.</div>`}`
  );
}

function openKpiRuleExplanation(ruleId) {
  const rule = kpiRules.find(r => r.id === ruleId);
  if (!rule) return notice("Không tìm thấy KPI.", true);
  const assigned = kpiRuleAssignedOwners(rule);
  const ownerHtml = assigned.length ? assigned.map(email => {
    const profile = ownerProfileByValue(email);
    return `<div><b>${esc(profile.name || email)}</b> <span class="muted">${esc(email)}</span> · Chỉ tiêu ${esc(kpiRuleTargetForOwner(rule, email))}</div>`;
  }).join("") : `<div class="muted">KPI cũ áp dụng cho tất cả nhân viên.</div>`;
  openDetailModal(
    `Diễn giải KPI: ${rule.name || "KPI"}`,
    `Áp dụng lâu dài · Cách tính: Số đề xuất được duyệt theo tháng báo cáo`,
    `
      <div class="detail-row">
        <b>Diễn giải</b>
        <div class="detail-note">${esc(rule.description || "Chưa có diễn giải.")}</div>
      </div>
      <div class="detail-row">
        <b>Nhân viên được gán</b>
        ${ownerHtml}
      </div>
    `
  );
}

function openKpiProposalDetail(proposalId) {
  const proposal = kpiProposals.find(p => p.id === proposalId);
  if (!proposal) return notice("Không tìm thấy đề xuất KPI.", true);
  if (!canViewKpiProposalDetail(proposal)) return notice("Bạn chỉ xem được đề xuất KPI của chính mình.", true);
  openDetailModal(
    `Chi tiết KPI: ${proposal.kpiName || "KPI"}`,
    `${proposal.owner || proposal.ownerEmail || "Nhân viên"} · ${kpiProposalMonth(proposal) || ""}`,
    kpiProposalDetailHtml(proposal)
  );
}

async function saveKpiRule() {
  if (!isManager()) return notice("Chỉ admin/manager được tạo KPI.", true);
  if (!legacyKpiPreCutover()) return notice("KPI cũ đã chuyển sang chỉ đọc từ 01/09/2026. Hãy cấu hình KPI-2 trong Bộ KPI.", true);
  const assignments = collectKpiAssignments();
  const existingRule = editingKpiRuleId ? kpiRules.find(r => r.id === editingKpiRuleId) : null;
  const data = {
    month: clean(existingRule?.month) || clean($("kpiRuleMonth").value) || clean($("filterMonth").value) || currentMonth(),
    name: clean($("kpiRuleName").value),
    description: clean($("kpiRuleDescription").value),
    target: Number($("kpiRuleTarget").value || 0),
    assignedOwners: assignments.assignedOwners,
    ownerTargets: assignments.ownerTargets,
    countMode: clean($("kpiRuleCountMode").value) || "approvedProposals",
    active: true,
    updatedByEmail: currentUser?.email || "",
    updatedAt: serverTimestamp()
  };
  if (!data.month) return notice("Vui lòng chọn tháng báo cáo.", true);
  if (!data.name) return notice("Vui lòng nhập tên KPI.", true);
  if (data.target < 0) return notice("Chỉ tiêu KPI không hợp lệ.", true);
  if (!data.assignedOwners.length) return notice("Vui lòng gán KPI cho ít nhất 1 nhân viên.", true);
  try {
    if (editingKpiRuleId) {
      await setDoc(doc(db, "kpiRules", editingKpiRuleId), data, {merge:true});
      await logAudit("updateKpiRule", "kpiRules", editingKpiRuleId, {before: existingRule || null, after: {...data, updatedAt: undefined}})
        .catch(err => notice("Đã cập nhật KPI, nhưng chưa ghi được audit log: " + authMessage(err), true));
      notice("Đã cập nhật KPI.");
    } else {
      const ruleRef = doc(collection(db, "kpiRules"));
      await setDoc(ruleRef, {
        ...data,
        createdByEmail: currentUser?.email || "",
        createdAt: serverTimestamp()
      });
      await logAudit("createKpiRule", "kpiRules", ruleRef.id, {...data, createdAt: undefined, updatedAt: undefined})
        .catch(err => notice("Đã tạo KPI, nhưng chưa ghi được audit log: " + authMessage(err), true));
      notice("Đã tạo KPI.");
    }
    resetKpiRuleForm();
  } catch (err) {
    notice("Không lưu được KPI: " + authMessage(err), true);
  }
}

function resetKpiRuleForm() {
  editingKpiRuleId = "";
  $("kpiRuleName").value = "";
  $("kpiRuleDescription").value = "";
  $("kpiRuleTarget").value = "";
  $("kpiRuleCountMode").value = "approvedProposals";
  $("saveKpiRuleBtn").textContent = "Tạo KPI";
  $("cancelEditKpiRuleBtn").classList.add("hide");
  renderKpiAssignmentBuilder();
}

function editKpiRule(ruleId) {
  if (!isManager()) return notice("Chỉ admin/manager được sửa KPI.", true);
  if (!legacyKpiPreCutover()) return notice("KPI cũ đã chuyển sang chỉ đọc từ 01/09/2026.", true);
  const rule = kpiRules.find(r => r.id === ruleId);
  if (!rule) return notice("Không tìm thấy KPI.", true);
  editingKpiRuleId = rule.id;
  $("kpiRuleName").value = clean(rule.name);
  $("kpiRuleDescription").value = clean(rule.description);
  $("kpiRuleTarget").value = Number(rule.target || 0) || "";
  $("kpiRuleCountMode").value = clean(rule.countMode) || "approvedProposals";
  $("saveKpiRuleBtn").textContent = "Lưu KPI";
  $("cancelEditKpiRuleBtn").classList.remove("hide");
  renderKpiAssignmentBuilder();
  $("kpiRuleName").scrollIntoView({behavior:"smooth", block:"center"});
}

async function disableKpiRule(ruleId) {
  if (!isManager()) return notice("Chỉ admin/manager được tắt KPI.", true);
  if (!legacyKpiPreCutover()) return notice("Không thể thay đổi KPI cũ sau 01/09/2026.", true);
  if (!ruleId) return;
  if (!confirm("Tắt KPI này? Dữ liệu đề xuất vẫn giữ nguyên, sale sẽ không chọn KPI này cho đến khi bật lại.")) return;
  try {
    await setDoc(doc(db, "kpiRules", ruleId), {
      active: false,
      updatedByEmail: currentUser?.email || "",
      updatedAt: serverTimestamp()
    }, {merge:true});
    await logAudit("disableKpiRule", "kpiRules", ruleId, {before: kpiRules.find(r => r.id === ruleId) || null})
      .catch(err => notice("Đã tắt KPI, nhưng chưa ghi được audit log: " + authMessage(err), true));
    notice("Đã tắt KPI.");
  } catch (err) {
    notice("Không tắt được KPI: " + authMessage(err), true);
  }
}

async function activateKpiRule(ruleId) {
  if (!isManager()) return notice("Chỉ admin/manager được bật lại KPI.", true);
  if (!legacyKpiPreCutover()) return notice("Không thể kích hoạt lại KPI cũ sau 01/09/2026.", true);
  if (!ruleId) return;
  try {
    await setDoc(doc(db, "kpiRules", ruleId), {
      active: true,
      updatedByEmail: currentUser?.email || "",
      updatedAt: serverTimestamp()
    }, {merge:true});
    await logAudit("activateKpiRule", "kpiRules", ruleId, {before: kpiRules.find(r => r.id === ruleId) || null})
      .catch(err => notice("Đã bật lại KPI, nhưng chưa ghi được audit log: " + authMessage(err), true));
    notice("Đã bật lại KPI. KPI này sẽ áp dụng cho tháng báo cáo hiện tại và các tháng sau.");
  } catch (err) {
    notice("Không bật lại được KPI: " + authMessage(err), true);
  }
}

function kpiProposalCustomerData(customer) {
  if (!customer) return null;
  const phone = customer.phoneRaw || customer.phoneNormalized || "";
  return {
    customerId: customer.id || "",
    customerName: customer.name || "",
    customerPhone: phone,
    customerCompanyName: customer.companyName || "",
    customerChannel: customer.channel || ""
  };
}

function proposalCustomerText(ctx) {
  if (!ctx) return "";
  return [
    ctx.customerName ? `Khách hàng: ${ctx.customerName}` : "",
    ctx.customerPhone ? `SĐT: ${ctx.customerPhone}` : "",
    ctx.customerCompanyName ? `Công ty: ${ctx.customerCompanyName}` : "",
    ctx.customerChannel ? `Kênh: ${ctx.customerChannel}` : ""
  ].filter(Boolean).join("\n");
}

function proposalEvidenceFiles() {
  return Array.from($("proposalEvidenceFiles")?.files || []);
}

function storageSafePart(value, fallback = "file") {
  const text = normalizeKey(value).replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return text || fallback;
}

function storageEmailFolder(value) {
  return normalizeKey(value).replace(/[^a-z0-9]+/g, "") || "sale";
}

function fileExtension(file) {
  const byName = clean(file?.name).split(".").pop();
  if (byName && byName.length <= 8) return byName.toLowerCase();
  return clean(file?.type).split("/").pop() || "jpg";
}

async function uploadKpiEvidenceFiles(proposalId) {
  const files = proposalEvidenceFiles();
  if (!files.length) return [];
  const existingProposal = editingKpiProposalId ? kpiProposals.find(p => p.id === editingKpiProposalId) : null;
  if (!legacyKpiPreCutover() && !legacyCloseoutEligible(existingProposal, isPendingKpiProposal(existingProposal))) {
    throw new Error("KPI cũ đã ngừng nhận minh chứng cho đề xuất mới từ 01/09/2026.");
  }
  if (files.length > KPI_EVIDENCE_MAX_FILES) {
    throw new Error(`Chỉ được chọn tối đa ${KPI_EVIDENCE_MAX_FILES} ảnh minh chứng.`);
  }

  const ownerFolder = storageEmailFolder(ownerEmail() || currentUser?.email || "sale");
  const monthFolder = storageSafePart(clean($("proposalKpiRule").selectedOptions?.[0]?.dataset.month) || currentMonth(), "month");
  const uploaded = [];

  for (const [index, file] of files.entries()) {
    if (!file.type.startsWith("image/")) throw new Error("Minh chứng chỉ nhận file ảnh.");
    if (file.size > KPI_EVIDENCE_MAX_SIZE) throw new Error(`Ảnh "${file.name}" vượt quá 8MB.`);

    const ext = fileExtension(file);
    const filename = `${Date.now()}-${index + 1}-${crypto.randomUUID()}.${ext}`;
    const path = `${ownerFolder}/${monthFolder}/${proposalId}/${filename}`;
    const { error } = await supabase.storage.from(KPI_EVIDENCE_BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined
    });
    if (error) throw new Error(`Upload ảnh "${file.name}" thất bại: ${error.message}`);

    const { data } = supabase.storage.from(KPI_EVIDENCE_BUCKET).getPublicUrl(path);
    if (data?.publicUrl) uploaded.push(data.publicUrl);
  }

  return uploaded;
}

function openKpiProposalModal(source = "") {
  if (!legacyKpiPreCutover()) return notice("KPI cũ đã ngừng nhận đề xuất mới từ 01/09/2026. Hãy sử dụng KPI hiện tại.", true);
  const customerId = typeof source === "string" ? source : "";
  const customer = customerId ? customers.find(c => c.id === customerId) : null;
  editingKpiProposalId = "";
  kpiProposalCustomerContext = kpiProposalCustomerData(customer);
  hydrateProposalKpiOptions();
  $("proposalModalTitle").textContent = "Đề Xuất KPI";
  $("submitKpiProposalBtn").textContent = "Gửi đề xuất";
  $("proposalName").value = ownerName();
  $("proposalEmail").value = ownerEmail();
  $("proposalPhone").value = clean(appUser?.phone || appUser?.phoneRaw || "");
  $("proposalDepartment").value = clean(appUser?.team || appUser?.department || "");
  $("proposalContent").value = kpiProposalCustomerContext ? proposalCustomerText(kpiProposalCustomerContext) : "";
  $("proposalEvidenceUrl").value = "";
  if ($("proposalEvidenceFiles")) $("proposalEvidenceFiles").value = "";
  if ($("proposalCustomerContext")) {
    $("proposalCustomerContext").classList.toggle("hide", !kpiProposalCustomerContext);
    $("proposalCustomerContext").innerHTML = kpiProposalCustomerContext ? `
      <b>Thông tin khách hàng</b>
      <div class="detail-meta">
        <span>${esc(kpiProposalCustomerContext.customerName || "Chưa có tên")}</span>
        <span>${esc(kpiProposalCustomerContext.customerPhone || "Không SĐT")}</span>
        ${kpiProposalCustomerContext.customerCompanyName ? `<span>${esc(kpiProposalCustomerContext.customerCompanyName)}</span>` : ""}
        ${kpiProposalCustomerContext.customerChannel ? `<span>${esc(kpiProposalCustomerContext.customerChannel)}</span>` : ""}
      </div>
    ` : "";
  }
  $("kpiProposalBackdrop").classList.remove("hide");
  $("kpiProposalModal").classList.remove("hide");
  setTimeout(() => (kpiProposalCustomerContext ? $("proposalKpiRule") : $("proposalContent")).focus(), 50);
}

function openEditKpiProposal(proposalId) {
  const proposal = kpiProposals.find(p => p.id === proposalId);
  if (!proposal) return notice("Không tìm thấy đề xuất KPI.", true);
  if (!canEditKpiProposal(proposal)) return notice("Chỉ đề xuất KPI đang chờ duyệt của bạn mới được sửa.", true);
  editingKpiProposalId = proposal.id;
  kpiProposalCustomerContext = {
    customerId: proposal.customerId || "",
    customerName: proposal.customerName || "",
    customerPhone: proposal.customerPhone || "",
    customerCompanyName: proposal.customerCompanyName || "",
    customerChannel: proposal.customerChannel || ""
  };
  if (kpiProposalMonth(proposal) && $("kpiRuleMonth")) $("kpiRuleMonth").value = kpiProposalMonth(proposal);
  hydrateProposalKpiOptions();
  $("proposalModalTitle").textContent = "Sửa đề xuất KPI";
  $("submitKpiProposalBtn").textContent = "Lưu đề xuất";
  $("proposalKpiRule").value = proposal.kpiRuleId || "";
  $("proposalName").value = proposal.owner || ownerName();
  $("proposalEmail").value = proposal.email || proposal.ownerEmail || ownerEmail();
  $("proposalPhone").value = proposal.phone || "";
  $("proposalDepartment").value = proposal.department || "";
  $("proposalContent").value = proposal.content || "";
  $("proposalEvidenceUrl").value = proposal.evidenceUrl || "";
  if ($("proposalEvidenceFiles")) $("proposalEvidenceFiles").value = "";
  if ($("proposalCustomerContext")) {
    const hasCustomer = Object.values(kpiProposalCustomerContext).some(Boolean);
    $("proposalCustomerContext").classList.toggle("hide", !hasCustomer);
    $("proposalCustomerContext").innerHTML = hasCustomer ? `
      <b>Thông tin khách hàng</b>
      <div class="detail-meta">
        <span>${esc(kpiProposalCustomerContext.customerName || "Chưa có tên")}</span>
        <span>${esc(kpiProposalCustomerContext.customerPhone || "Không SĐT")}</span>
        ${kpiProposalCustomerContext.customerCompanyName ? `<span>${esc(kpiProposalCustomerContext.customerCompanyName)}</span>` : ""}
        ${kpiProposalCustomerContext.customerChannel ? `<span>${esc(kpiProposalCustomerContext.customerChannel)}</span>` : ""}
      </div>
    ` : "";
  }
  closeDetailModal();
  $("kpiProposalBackdrop").classList.remove("hide");
  $("kpiProposalModal").classList.remove("hide");
  setTimeout(() => $("proposalContent").focus(), 50);
}

function closeKpiProposalModal() {
  $("kpiProposalBackdrop").classList.add("hide");
  $("kpiProposalModal").classList.add("hide");
  if ($("proposalEvidenceFiles")) $("proposalEvidenceFiles").value = "";
  editingKpiProposalId = "";
  $("proposalModalTitle").textContent = "Đề Xuất KPI";
  $("submitKpiProposalBtn").textContent = "Gửi đề xuất";
  kpiProposalCustomerContext = null;
}

async function submitKpiProposal() {
  if (!currentUser || !appUser) return notice("Bạn cần đăng nhập để gửi đề xuất KPI.", true);
  const rule = kpiRules.find(r => r.id === clean($("proposalKpiRule").value));
  if (!rule) return notice("Vui lòng chọn KPI cần đề xuất.", true);
  if (rule.active === false) return notice("KPI này đang tắt. Admin/manager cần bật lại trước khi gửi đề xuất.", true);
  if (!kpiRuleAppliesToCurrentUser(rule)) return notice("KPI này chưa được gán cho bạn.", true);
  const existingProposal = editingKpiProposalId ? kpiProposals.find(p => p.id === editingKpiProposalId) : null;
  if (!editingKpiProposalId && !legacyKpiPreCutover()) return notice("KPI cũ đã ngừng nhận đề xuất mới từ 01/09/2026. Hãy sử dụng KPI hiện tại.", true);
  if (editingKpiProposalId && !legacyKpiCloseoutAllowed(existingProposal)) return notice("Chỉ đề xuất KPI cũ pending tạo trước 01/09/2026 mới được sửa để đóng sổ.", true);
  if (editingKpiProposalId && !canEditKpiProposal(existingProposal)) return notice("Đề xuất này đã được duyệt/từ chối hoặc bạn không còn quyền sửa.", true);
  const isEditingProposal = Boolean(editingKpiProposalId);
  const proposalRef = editingKpiProposalId ? doc(db, "kpiProposals", editingKpiProposalId) : doc(collection(db, "kpiProposals"));
  const manualEvidence = clean($("proposalEvidenceUrl").value);
  const content = clean($("proposalContent").value);
  if (!content) return notice("Vui lòng nhập nội dung công việc đạt KPI.", true);
  const ruleSnapshot = kpiRuleSnapshotForOwner(rule, ownerEmail());
  const data = {
    kpiRuleId: rule.id,
    kpiName: rule.name || "",
    month: clean($("kpiRuleMonth")?.value) || currentMonth(),
    owner: ownerName(),
    ownerEmail: ownerEmail(),
    email: ownerEmail(),
    phone: clean($("proposalPhone").value),
    department: clean($("proposalDepartment").value),
    content,
    evidenceUrl: manualEvidence,
    ...(kpiProposalCustomerContext || {}),
    ...ruleSnapshot,
    ruleSnapshotJson: JSON.stringify(ruleSnapshot),
    status: "pending",
    isDeleted: false,
    updatedAt: serverTimestamp()
  };
  if (!isEditingProposal) {
    data.createdByEmail = currentUser?.email || "";
    data.createdAt = serverTimestamp();
  } else {
    data.updatedByEmail = currentUser?.email || "";
  }
  try {
    const uploadedEvidence = await uploadKpiEvidenceFiles(proposalRef.id);
    data.evidenceUrl = [manualEvidence, ...uploadedEvidence].filter(Boolean).join("\n");
    await callCrmRpc("crm_submit_kpi_proposal", {
      p_proposal_id: proposalRef.id,
      p_proposal: data
    });
    await refreshKpiCutoverState({render:false});
    closeKpiProposalModal();
    notice(isEditingProposal ? "Đã cập nhật đề xuất KPI." : "Đã gửi đề xuất KPI cho manager/admin.");
  } catch (err) {
    notice((isEditingProposal ? "Không cập nhật được đề xuất KPI: " : "Không gửi được đề xuất KPI: ") + authMessage(err), true);
  }
}

async function reviewKpiProposal(proposalId, status) {
  if (!isManager()) return notice("Chỉ admin/manager được duyệt đề xuất KPI.", true);
  const proposal = kpiProposals.find(p => p.id === proposalId);
  if (!proposal) return notice("Không tìm thấy đề xuất KPI.", true);
  if (!isPendingKpiProposal(proposal)) return notice("Đề xuất KPI này đã được xử lý, không duyệt/từ chối lại để giữ log.", true);
  if (!legacyKpiCloseoutAllowed(proposal)) return notice("Chỉ proposal KPI cũ pending tạo trước 01/09/2026 mới được đóng sổ.", true);
  const nextStatus = status === "approved" ? "approved" : "rejected";
  const reviewNote = nextStatus === "rejected" ? clean(prompt("Lý do từ chối đề xuất KPI này?", "") || "") : "";
  const rule = kpiRules.find(r => r.id === proposal.kpiRuleId) || {};
  const reviewSnapshot = kpiRuleSnapshotForOwner(rule, proposal.ownerEmail || proposal.email || proposal.owner);
  try {
    await callCrmRpc("crm_review_kpi_proposal", {
      p_proposal_id: proposalId,
      p_status: nextStatus,
      p_review_note: reviewNote,
      p_review_snapshot: reviewSnapshot
    });
    await refreshKpiCutoverState({render:false});
    notice(nextStatus === "approved" ? "Đã duyệt đề xuất KPI." : "Đã từ chối đề xuất KPI.");
  } catch (err) {
    notice("Không cập nhật được đề xuất KPI: " + authMessage(err), true);
  }
}

async function deleteKpiProposal(proposalId) {
  if (!isAdmin()) return notice("Chỉ admin được ẩn KPI test.", true);
  const proposal = kpiProposals.find(p => p.id === proposalId);
  if (!proposal) return notice("Không tìm thấy đề xuất KPI.", true);
  if (!legacyKpiCloseoutAllowed(proposal)) return notice("Sau 01/09/2026 chỉ proposal KPI cũ pending mới được đóng sổ.", true);
  if (!confirm(`Ẩn KPI test của ${proposal.owner || proposal.ownerEmail || "nhân viên"}? Dòng này sẽ không còn xuất trong báo cáo KPI nhưng vẫn giữ audit log.`)) return;
  try {
    await callCrmRpc("crm_archive_kpi_proposal", {p_proposal_id: proposalId});
    await refreshKpiCutoverState({render:false});
    closeDetailModal();
    notice("Đã ẩn KPI test khỏi báo cáo.");
  } catch (err) {
    notice("Không ẩn được KPI test: " + authMessage(err), true);
  }
}

async function softDeleteKpiProposal(proposalId) {
  const proposal = kpiProposals.find(p => p.id === proposalId);
  if (!proposal) return notice("Không tìm thấy đề xuất KPI.", true);
  if (!canSoftDeleteKpiProposal(proposal)) return notice("Chỉ đề xuất KPI đang chờ duyệt của bạn mới được xóa.", true);
  if (!confirm("Xóa đề xuất KPI đang chờ duyệt này? Dữ liệu sẽ được ẩn khỏi KPI và vẫn có log kiểm tra khi cần.")) return;
  try {
    await callCrmRpc("crm_archive_kpi_proposal", {p_proposal_id: proposalId});
    await refreshKpiCutoverState({render:false});
    closeDetailModal();
    notice("Đã xóa đề xuất KPI.");
  } catch (err) {
    notice("Không xóa được đề xuất KPI: " + authMessage(err), true);
  }
}


function renderHealthCheck() {
  const visible = customers.filter(canSeeCustomer);
  const duplicatePhones = (() => {
    const map = new Map();
    visible.forEach(c => {
      const p = phoneNorm(c.phoneNormalized || c.phoneRaw || "");
      if (!p) return;
      map.set(p, (map.get(p) || 0) + 1);
    });
    return [...map.values()].filter(n => n > 1).length;
  })();
  const noOwner = visible.filter(c => !clean(c.ownerEmail) && !clean(c.owner)).length;
  const overdue = visible.filter(isCareOverdue).length;
  const missingNextDate = visible.filter(c => sameLabel(computedFollowStatus(c), "noDateFollow")).length;
  const cards = [
    ["Trùng SĐT", duplicatePhones, duplicatePhones ? "Cần xử lý" : "Ổn", duplicatePhones ? "bad" : "good"],
    ["Thiếu phụ trách", noOwner, noOwner ? "Cần gán sale" : "Ổn", noOwner ? "warn" : "good"],
    ["Quá hạn chăm", overdue, overdue ? "Cần gọi lại" : "Ổn", overdue ? "bad" : "good"],
    ["Lead chưa có ngày chăm", missingNextDate, missingNextDate ? "Cần phân công lịch" : "Ổn", missingNextDate ? "warn" : "good"]
  ];
  $("healthGrid").innerHTML = cards.map(([label,num,note,cls]) => `
    <div class="health-card ${esc(cls)}">
      <div class="muted">${esc(label)}</div>
      <b>${esc(num)}</b>
      <div class="muted">${esc(note)}</div>
    </div>
  `).join("");
}

function renderDataSafetyPanel() {
  if (!canAccessAdminPanel()) return;
  if ($("safetyCustomersCount")) $("safetyCustomersCount").textContent = allCustomers.length || customers.length;
  if ($("safetyDealsCount")) $("safetyDealsCount").textContent = allDeals.length || deals.length;
  if ($("safetyPaymentsCount")) $("safetyPaymentsCount").textContent = allPayments.length || payments.length;
  if ($("safetyAuditCount")) $("safetyAuditCount").textContent = auditLogs.length;
  renderOperationsWarnings();
}

function renderOperationsWarnings() {
  const box = $("operationsWarnings");
  if (!box) return;
  const warnings = [];
  const counts = {
    customers: allCustomers.length || customers.length,
    careLogs: allCareLogs.length || careLogs.length,
    auditLogs: auditLogs.length,
    kpiProposals: kpiProposals.length
  };
  if (counts.customers >= OPERATIONS_WARN_LIMITS.customers) {
    warnings.push(["Dữ liệu khách đã lớn", `${counts.customers} khách. Nên ưu tiên phân trang/query theo bộ lọc ở Supabase nếu app bắt đầu chậm.`]);
  }
  if (counts.careLogs >= OPERATIONS_WARN_LIMITS.careLogs) {
    warnings.push(["Lịch sử chăm sóc nhiều", `${counts.careLogs} log. Nên chỉ tải timeline theo khách khi mở hồ sơ, tránh tải toàn bộ lâu dài.`]);
  }
  if (counts.auditLogs >= OPERATIONS_WARN_LIMITS.auditLogs) {
    warnings.push(["Audit log nhiều", `${counts.auditLogs} log. Nên archive log cũ theo tháng hoặc tạo view/RPC báo cáo.`]);
  }
  if (counts.kpiProposals >= OPERATIONS_WARN_LIMITS.kpiProposals) {
    warnings.push(["KPI proposal nhiều", `${counts.kpiProposals} đề xuất. Nên lọc theo tháng/trạng thái ở query.`]);
  }
  if (!warnings.length) {
    box.innerHTML = `<div class="ops-warning good">Nền dữ liệu hiện chưa vượt ngưỡng cảnh báo.<small>Tiếp tục backup trước deploy và test đủ 3 role sau mỗi thay đổi lớn.</small></div>`;
    return;
  }
  box.innerHTML = warnings.map(([title, note]) => `
    <div class="ops-warning">${esc(title)}<small>${esc(note)}</small></div>
  `).join("");
}

function jsonCell(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function snapshotSheet(name, headers, rows) {
  return {name, rows:[headers, ...rows]};
}

async function exportOperationalSnapshot() {
  if (!isAdmin()) return notice("Chỉ admin được xuất snapshot vận hành.", true);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const customerRows = (allCustomers.length ? allCustomers : customers).map(c => [
    c.id, c.name, c.companyName, c.phoneRaw, c.phoneNormalized, c.address, c.channel,
    c.customerType, potentialLevelFor(c), c.owner, c.ownerEmail, c.status, c.follow, c.nextCareDate, fmtDate(c.createdAt),
    c.isDeleted ? "yes" : "", fmtDate(c.deletedAt), c.note
  ]);
  const careRows = (allCareLogs.length ? allCareLogs : careLogs).map(l => [
    l.id, l.customerId, l.customerName, l.owner, l.ownerEmail, l.status, l.careChannel,
    l.careResult, l.careDate || "", l.nextCareDate, l.showroomVisit ? "yes" : "", l.note, fmtDate(l.createdAt), l.isDeleted ? "yes" : ""
  ]);
  const dealRows = (allDeals.length ? allDeals : deals).map(d => [
    d.id, d.customerId, orderCustomerName(d), orderCustomerPhone(d), orderOwnerName(d),
    orderOwnerEmail(d), orderStatusLabel(d), fmtDate(d.dealDate || d.createdAt),
    fmtDate(d.completedAt), dealAmount(d), orderProductText(d),
    d.isDeleted ? "yes" : "", d.note
  ]);
  const kpiRuleRows = kpiRules.map(r => [
    r.id, r.month, r.name, r.target, r.countMode, r.active === false ? "no" : "yes",
    jsonCell(r.assignedOwners), jsonCell(r.ownerTargets), r.description
  ]);
  const kpiProposalRows = kpiProposals.map(p => [
    p.id, p.kpiRuleId, p.kpiName, p.month, p.owner, p.ownerEmail, p.customerName,
    p.customerPhone, p.customerCompanyName, p.status, p.kpiTargetForOwner || p.kpiRuleTarget || "",
    p.reviewedByEmail, fmtDate(p.reviewedAt), p.isDeleted ? "yes" : "", p.content, p.evidenceUrl
  ]);
  const userRows = users.map(u => [
    u.uid || u.id, u.email, u.name, u.role, u.active === false ? "locked" : "active",
    u.team, u.canExport === true ? "yes" : "no", fmtDate(u.updatedAt || u.createdAt)
  ]);
  const auditRows = auditLogs.map(a => [
    a.id, fmtDate(a.createdAt), a.email, a.action, a.entity, a.entityId, a.payloadJson || a.note || ""
  ]);

  const sheets = [
    snapshotSheet("00_Tong_quan", ["Mục", "Số dòng", "Ghi chú"], [
      ["Thời điểm xuất", new Date().toLocaleString("vi-VN"), "Snapshot Excel để đối chiếu nhanh"],
      ["Customers", customerRows.length, "Gồm cả khách đang ẩn nếu đã tải"],
      ["Care logs", careRows.length, ""],
      ["Basic purchases", dealRows.length, "Ghi nhận mua/cọc/hủy ở mức đánh giá giá trị khách hàng"],
      ["KPI proposals", kpiProposalRows.length, ""],
      ["Users", userRows.length, ""],
      ["Audit logs", auditRows.length, ""]
    ]),
    snapshotSheet("Customers", ["ID","Tên","Công ty","SĐT","SĐT chuẩn","Địa chỉ","Kênh","Loại khách","Mức tiềm năng","Owner","Owner email","Trạng thái","Follow","Hẹn chăm","Ngày tạo","Đã ẩn","Ngày ẩn","Ghi chú"], customerRows),
    snapshotSheet("CareLogs", ["ID","Customer ID","Khách","Owner","Owner email","Trạng thái","Kênh chăm","Kết quả","Ngày chăm","Hẹn tiếp","Đến showroom","Ghi chú","Ngày tạo","Đã ẩn"], careRows),
    snapshotSheet("BasicPurchases", ["ID","Customer ID","Khách","SĐT","Owner","Owner email","Trạng thái","Ngày ghi nhận","Ngày mua","Giá trị","Nội dung mua","Đã ẩn","Ghi chú"], dealRows),
    snapshotSheet("KpiRules", ["ID","Tháng","Tên KPI","Chỉ tiêu","Cách tính","Active","Nhân viên gán","Target riêng","Diễn giải"], kpiRuleRows),
    snapshotSheet("KpiProposals", ["ID","Rule ID","KPI","Tháng","Owner","Owner email","Khách","SĐT","Công ty","Trạng thái","Chỉ tiêu lúc gửi","Người duyệt","Ngày duyệt","Đã ẩn","Nội dung","Minh chứng"], kpiProposalRows),
    snapshotSheet("Users", ["ID","Email","Tên","Role","Active","Team","Can export","Cập nhật"], userRows),
    snapshotSheet("AuditLogs", ["ID","Thời gian","Email","Action","Entity","Entity ID","Payload"], auditRows)
  ];

  const exported = exportXlsx(sheets, `crm-operational-snapshot-${todayIso()}-${stamp}`);
  if (exported) {
    await logAudit("exportOperationalSnapshot", "exports", "operationalSnapshot", {
      customers: customerRows.length,
      deals: dealRows.length,
      auditLogs: auditRows.length
    }).catch(err => notice("Snapshot đã xuất, nhưng chưa ghi được audit log: " + authMessage(err), true));
    notice("Đã xuất snapshot vận hành.");
  }
}

function renderUserAdmin() {
  if (!canAccessAdminPanel() || !$("userRows")) return;
  $("userRows").innerHTML = users.length ? users.map(u => {
    const role = clean(u.role || "sale").toLowerCase();
    const lifecycle = clean(u.lifecycleStatus || (u.active === false ? "inactive" : "active")).toLowerCase();
    const active = lifecycle === "active";
    const currentCustomerIds = new Set(customerAssignments.filter(a => a.isCurrent && a.employeeId === u.uid).map(a => a.customerId));
    const openFollowups = customers.filter(c => currentCustomerIds.has(c.id) && c.nextCareDate).length;
    return `<tr class="admin-user-row ${active ? "" : "locked"}">
      <td>
        <b>${esc(u.name || u.email || u.uid)}</b>
        <div class="muted">${esc(u.email || "")}</div>
        <div class="admin-badge-row">
          <span class="pill ${role === "admin" || role === "owner" ? "red" : role === "manager" ? "orange" : "green"}">${esc(role)}</span>
          <span class="pill ${active ? "green" : lifecycle === "inactive" ? "orange" : "red"}">${esc(lifecycle.toUpperCase())}</span>
        </div>
      </td>
      <td><select data-user-role="${esc(u.uid)}">
        ${["sale","manager","admin","owner"].map(r => `<option value="${r}" ${role===r ? "selected" : ""}>${r}</option>`).join("")}
      </select></td>
      <td><b>${esc(lifecycle.toUpperCase())}</b><div class="muted">${esc(currentCustomerIds.size)} khách · ${esc(openFollowups)} lịch hẹn mở</div></td>
      <td><input data-user-team="${esc(u.uid)}" value="${esc(u.team || "")}" placeholder="Team"></td>
      <td><select data-user-export="${esc(u.uid)}"><option value="false" ${u.canExport !== true ? "selected" : ""}>Không</option><option value="true" ${u.canExport === true ? "selected" : ""}>Có</option></select></td>
      <td>
        <div class="actions">
          <button class="small primary" data-save-user="${esc(u.uid)}">Lưu</button>
          ${lifecycle === "active" ? `<button class="small" data-toggle-user="${esc(u.uid)}">Ngừng hoạt động</button>` : ""}
          ${lifecycle === "inactive" ? `<button class="small" data-toggle-user="${esc(u.uid)}">Mở lại</button><button class="small danger" data-delete-user="${esc(u.uid)}">Lưu trữ</button>` : ""}
          ${lifecycle === "archived" ? `<span class="muted">Chỉ tra cứu lịch sử</span>` : ""}
        </div>
      </td>
    </tr>`;
  }).join("") : `<tr><td colspan="6" class="muted">Chưa có user.</td></tr>`;
}

function renderAuditTrail() {
  if (!isAdmin()) return;
  const rows = pageRows("audit", auditLogs);
  $("auditRows").innerHTML = rows.length ? rows.map(a => `
    <tr class="audit-row">
      <td>${esc(fmtDate(a.createdAt))}</td>
      <td><b>${esc(a.email || "")}</b></td>
      <td><span class="audit-action">${esc(a.action || "")}</span></td>
      <td>${esc(a.entity || "")}<div class="muted">${esc(a.entityId || "")}</div></td>
      <td><div class="audit-payload">${esc(a.payloadJson || a.note || "")}</div></td>
    </tr>
  `).join("") : `<tr><td colspan="5" class="muted">Chưa có audit log hoặc chưa được cấp quyền đọc.</td></tr>`;
  renderPager("auditPager", "audit", auditLogs.length, "log");
}

function hydrateAdminAuditFilters() {
  const el = $("adminAuditEntityFilter");
  if (!el) return;
  const current = el.value;
  const entities = uniq(auditLogs.map(a => clean(a.entity)).filter(Boolean)).sort((a,b) => a.localeCompare(b, "vi"));
  fillSelect("adminAuditEntityFilter", entities, "", "Tất cả đối tượng");
  if (entities.includes(current) || current === "") el.value = current;
}

function filteredAdminAuditRows() {
  const entity = clean($("adminAuditEntityFilter")?.value);
  const key = normalizeKey($("adminAuditSearch")?.value || "");
  return auditLogs
    .filter(a => !entity || clean(a.entity) === entity)
    .filter(a => {
      if (!key) return true;
      return normalizeKey([a.email, a.action, a.entity, a.entityId, a.payloadJson, a.note].join(" ")).includes(key);
    })
    .sort(byDateDesc);
}

function renderAdminAuditPage() {
  if (!canAccessAdminPanel()) return;
  hydrateAdminAuditFilters();
  const rows = filteredAdminAuditRows();
  const page = pageRows("adminAudit", rows);
  $("adminAuditRows").innerHTML = page.length ? page.map(a => `
    <tr class="audit-row">
      <td>${esc(fmtDate(a.createdAt))}</td>
      <td>${esc(a.email || "")}</td>
      <td><span class="audit-action">${esc(a.action || "")}</span></td>
      <td>${esc([a.entity, a.entityId].filter(Boolean).join(" / "))}</td>
      <td><div class="audit-payload" title="${esc(a.payloadJson || a.note || "")}">${esc(a.payloadJson || a.note || "")}</div></td>
    </tr>
  `).join("") : `<tr><td colspan="5" class="muted">Không có nhật ký phù hợp với bộ lọc.</td></tr>`;
  renderPager("adminAuditPager", "adminAudit", rows.length, "log");
}

function resetAdminAuditFilters() {
  if ($("adminAuditEntityFilter")) $("adminAuditEntityFilter").value = "";
  if ($("adminAuditSearch")) $("adminAuditSearch").value = "";
  resetPaging("adminAudit");
  renderAdminAuditPage();
}

function renderTrash() {
  if (!isAdmin()) return;
  $("trashList").innerHTML = deletedCustomers.length ? deletedCustomers
    .sort(byDateDesc)
    .map(c => {
      const relatedCare = allCareLogs.filter(l => l.customerId === c.id).length;
      const relatedDeals = allDeals.filter(d => d.customerId === c.id).length;
      return `
        <div class="rule-item trash-card">
          <div class="trash-card-grid">
            <div>
              <b>${esc(c.name || "Khách hàng")}</b>
              <div class="muted">${esc(c.phoneRaw || c.phoneNormalized || "Không SĐT")} · ${esc(customerOwnerName(c))}</div>
              <div class="detail-meta">
                <span>Xóa: ${esc(fmtDate(c.deletedAt || c.updatedAt))}</span>
                <span>Care logs: ${esc(relatedCare)}</span>
                <span>Deals: ${esc(relatedDeals)}</span>
              </div>
            </div>
            <div class="trash-actions">
              <button class="small primary" data-restore-customer="${esc(c.id)}">Khôi phục</button>
              <button class="small danger" data-permanent-delete-customer="${esc(c.id)}">Xóa vĩnh viễn</button>
            </div>
          </div>
        </div>
      `;
    }).join("") : "Chưa có khách trong thùng rác.";
}

async function saveUserAdmin(uid) {
  if (!canAccessAdminPanel()) return notice("Chỉ owner/admin được quản lý nhân viên.", true);
  const user = users.find(u => u.uid === uid);
  if (!user) return notice("Không tìm thấy user.", true);
  const role = clean(document.querySelector(`[data-user-role="${CSS.escape(uid)}"]`)?.value || "sale");
  const team = clean(document.querySelector(`[data-user-team="${CSS.escape(uid)}"]`)?.value);
  const canExport = document.querySelector(`[data-user-export="${CSS.escape(uid)}"]`)?.value === "true";
  if (sameIdentity(user.email, currentUser?.email) && !["admin","owner"].includes(role)) {
    return notice("Không thể tự hạ quyền admin/owner của chính bạn.", true);
  }
  try {
    await callCrmRpc("crm_update_employee_profile", {
      p_employee_id: uid,
      p_changes: {role, team, canExport}
    });
    users = users.map(u => u.uid === uid ? {...u, role, team, canExport} : u);
    hydrateOwnerDependentFilters();
    renderUserAdmin();
    notice("Đã cập nhật nhân viên.");
  } catch (err) {
    notice("Không cập nhật được nhân viên: " + authMessage(err), true);
  }
}

function newUserFormData() {
  return {
    email: clean($("newUserEmail")?.value).toLowerCase(),
    name: clean($("newUserName")?.value),
    role: clean($("newUserRole")?.value) || "sale",
    team: clean($("newUserTeam")?.value),
    canExport: $("newUserExport")?.value === "true"
  };
}

function clearNewUserForm() {
  ["newUserEmail","newUserName","newUserTeam"].forEach(id => { if ($(id)) $(id).value = ""; });
  if ($("newUserRole")) $("newUserRole").value = "sale";
  if ($("newUserExport")) $("newUserExport").value = "false";
}

async function addUserAdmin() {
  if (!canAccessAdminPanel()) return notice("Chỉ owner/admin được thêm nhân viên.", true);
  const data = newUserFormData();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return notice("Email nhân viên chưa hợp lệ.", true);
  if (users.some(u => sameIdentity(u.email, data.email))) return notice("Email này đã có trong danh sách nhân viên.", true);
  const uid = doc(collection(db, "users")).id;
  const payload = {
    email: data.email,
    name: data.name || data.email,
    role: data.role,
    active: true,
    team: data.team,
    canExport: data.canExport,
    createdByEmail: currentUser?.email || "",
    updatedByEmail: currentUser?.email || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  try {
    const result = await callCrmRpc("crm_create_employee", {p_employee: {...payload, id: uid}});
    users = [...users, {uid:result?.id || uid, ...payload, lifecycleStatus:"active"}].sort((a,b) => clean(a.email).localeCompare(clean(b.email)));
    clearNewUserForm();
    hydrateOwnerDependentFilters();
    renderUserAdmin();
    notice("Đã thêm nhân viên. Nhân viên có thể đăng nhập Google bằng email này.");
  } catch (err) {
    notice("Không thêm được nhân viên: " + authMessage(err), true);
  }
}

function openDeactivateEmployeeModal(uid) {
  const user = users.find(u => u.uid === uid);
  if (!user) return notice("Không tìm thấy nhân viên.", true);
  if (sameIdentity(user.email, currentUser?.email)) return notice("Không thể tự ngừng hoạt động tài khoản đang đăng nhập.", true);
  const assigned = customerAssignments.filter(a => a.isCurrent && a.employeeId === uid);
  const customerIds = new Set(assigned.map(a => a.customerId));
  const openFollowups = customers.filter(c => customerIds.has(c.id) && c.nextCareDate).length;
  const replacements = ownerOptions().filter(item => !sameIdentity(item.email, user.email));
  openDetailModal(
    "Ngừng hoạt động nhân viên",
    `${user.name || user.email} · ${assigned.length} khách · ${openFollowups} lịch hẹn mở`,
    `<div class="section">
      <p>Khách hàng và lịch hẹn sẽ không bị xóa. Chọn cách xử lý toàn bộ khách đang phụ trách:</p>
      <div class="field"><label>Cách xử lý</label><select id="deactivateEmployeeMode">
        <option value="unassigned">Đưa về Khách chờ phân bổ (khuyến nghị)</option>
        <option value="transfer">Chuyển toàn bộ cho nhân viên khác</option>
      </select></div>
      <div id="deactivateReplacementField" class="field hide"><label>Nhân viên nhận bàn giao</label><select id="deactivateReplacementEmployee">
        <option value="">-- Chọn nhân viên ACTIVE --</option>
        ${replacements.map(item => `<option value="${esc(users.find(u => sameIdentity(u.email,item.email))?.uid || "")}">${esc(item.name)} · ${esc(item.email)}</option>`).join("")}
      </select></div>
      <div class="field"><label>Lý do</label><textarea id="deactivateEmployeeReason" placeholder="Ví dụ: Nhân viên nghỉ việc, chuyển bộ phận..."></textarea></div>
      <div class="admin-empty-state"><b>${esc(openFollowups)} lịch hẹn đang mở</b><span>Lịch hẹn vẫn nằm trên hồ sơ khách. Nếu đưa về pool, manager/admin sẽ tiếp tục thấy cảnh báo; khi phân công người mới, trách nhiệm đi theo assignment mới.</span></div>
      <div class="actions" style="margin-top:12px"><button class="danger" type="button" data-confirm-deactivate-employee="${esc(uid)}">Xác nhận ngừng hoạt động</button></div>
    </div>`
  );
  on("deactivateEmployeeMode", "change", () => {
    $("deactivateReplacementField")?.classList.toggle("hide", $("deactivateEmployeeMode")?.value !== "transfer");
  });
}

async function confirmDeactivateEmployee(uid) {
  const mode = clean($("deactivateEmployeeMode")?.value) || "unassigned";
  const replacementId = clean($("deactivateReplacementEmployee")?.value);
  const reason = clean($("deactivateEmployeeReason")?.value);
  if (!reason) return notice("Vui lòng nhập lý do ngừng hoạt động.", true);
  if (mode === "transfer" && !replacementId) return notice("Vui lòng chọn nhân viên nhận bàn giao.", true);
  try {
    const result = await callCrmRpc("crm_deactivate_employee", {
      p_employee_id: uid,
      p_mode: mode,
      p_replacement_employee_id: replacementId || null,
      p_reason: reason
    });
    closeDetailModal();
    notice(`Đã ngừng nhân viên và xử lý ${result?.customerCount || 0} khách hàng.`);
  } catch (err) {
    notice("Không ngừng được nhân viên: " + authMessage(err), true);
  }
}

async function toggleUserAdmin(uid) {
  if (!canAccessAdminPanel()) return notice("Chỉ owner/admin được khóa/mở nhân viên.", true);
  const user = users.find(u => u.uid === uid);
  if (!user) return notice("Không tìm thấy user.", true);
  const lifecycle = clean(user.lifecycleStatus || (user.active === false ? "inactive" : "active")).toLowerCase();
  if (lifecycle === "active") return openDeactivateEmployeeModal(uid);
  if (lifecycle === "archived") return notice("Hồ sơ ARCHIVED chỉ phục vụ tra cứu lịch sử.", true);
  if (!confirm(`Mở lại nhân viên ${user.email || user.name || uid}? Khách cũ sẽ không tự quay lại.`)) return;
  try {
    await callCrmRpc("crm_reactivate_employee", {p_employee_id:uid, p_reason:"Mở lại từ Admin Panel"});
    users = users.map(u => u.uid === uid ? {...u, active:true, lifecycleStatus:"active"} : u);
    hydrateOwnerDependentFilters();
    renderUserAdmin();
    notice("Đã mở lại nhân viên. Khách hàng cần được phân công riêng.");
  } catch (err) {
    notice("Không cập nhật trạng thái nhân viên: " + authMessage(err), true);
  }
}

async function deleteUserAdmin(uid) {
  if (!canAccessAdminPanel()) return notice("Chỉ owner/admin được xóa nhân viên.", true);
  const user = users.find(u => u.uid === uid);
  if (!user) return notice("Không tìm thấy user.", true);
  if (sameIdentity(user.email, currentUser?.email)) return notice("Không thể xóa tài khoản của chính bạn.", true);
  if (!confirm(`Lưu trữ hồ sơ ${user.email || user.name || uid}? Lịch sử khách, chăm sóc và KPI vẫn được giữ nguyên.`)) return;
  try {
    await callCrmRpc("crm_archive_employee", {p_employee_id:uid, p_reason:"Lưu trữ từ Admin Panel"});
    users = users.map(u => u.uid === uid ? {...u, active:false, lifecycleStatus:"archived"} : u);
    hydrateOwnerDependentFilters();
    renderUserAdmin();
    notice("Đã lưu trữ nhân viên; toàn bộ lịch sử vẫn được giữ.");
  } catch (err) {
    notice("Không xóa được nhân viên: " + authMessage(err), true);
  }
}

function renderAll() {
  if (document.hidden) {
    renderQueuedWhileHidden = true;
    return;
  }
  const adminVisible = $("adminAppView") && !$("adminAppView").classList.contains("hide");
  if (adminVisible) {
    renderAdminDashboard();
    dirtyCollections.clear();
    return;
  }
  if (!$("appView") || $("appView").classList.contains("hide")) return;
  const shouldRenderView = activeViewNeedsRender();
  if (hasDirty("customers", "settings")) renderTodayCare();
  if (hasDirty("userSessions", "users")) renderOnlineUsers();
  if (selectedCustomerId && hasDirty("customers", "careLogs", "deals", "orderItems", "payments", "settings")) {
    renderCustomerInfo(customers.find(c => c.id === selectedCustomerId));
    renderHistories(selectedCustomerId);
  }
  if (shouldRenderView) setMainView(activeMainView);
  if (hasDirty("customers", "settings")) notifyTodayCare();
  dirtyCollections.clear();
}

function dealItemTemplate(item={}) {
  const productText = item.productLabel || item.product || item.name || "";
  const productId = item.productId || "";
  const meta = [item.surface, item.origin, item.color, item.priceText || (item.price ? money(item.price) : "")].filter(Boolean).join(" · ");
  return `<div class="deal-item-row" data-deal-item>
    <input type="hidden" data-deal-product-id value="${esc(productId)}">
    <div class="field"><label>Nội dung mua căn bản</label><input data-deal-product list="productOptions" value="${esc(productText)}" placeholder="VD: gạch phòng khách, mẫu showroom, hạng mục khách quan tâm..."><div class="muted" data-deal-product-meta>${esc(meta)}</div></div>
    <div class="field hide"><label>Mã hàng</label><input data-deal-code value="${esc(item.code || "")}"></div>
    <div class="field"><label>Số lượng / ghi chú ngắn</label><input data-deal-qty value="${esc(item.qty || "")}" placeholder="VD: 1 lần mua, 30m2..."></div>
    <button class="small" type="button" data-remove-deal-item>Xóa</button>
  </div>`;
}

function addDealItem(item={}) {
  $("dealItems").insertAdjacentHTML("beforeend", dealItemTemplate(item));
}

function resetDealItems(seedProduct="") {
  $("dealItems").innerHTML = "";
  addDealItem({product: seedProduct});
}

function collectDealItems() {
  return [...document.querySelectorAll("[data-deal-item]")].map(row => {
    const productValue = clean(row.querySelector("[data-deal-product]").value);
    const selected = productByAnyValue(clean(row.querySelector("[data-deal-product-id]").value) || productValue);
    const code = clean(row.querySelector("[data-deal-code]").value) || selected?.code || "";
    return {
      productId: selected?.id || clean(row.querySelector("[data-deal-product-id]").value),
      product: selected?.name || productValue,
      productLabel: selected ? productLabel(selected) : productValue,
      code,
      size: selected?.size || "",
      surface: selected?.surface || "",
      origin: selected?.origin || "",
      color: selected?.color || "",
      price: selected?.price || 0,
      priceText: selected?.priceText || "",
      description: selected?.description || "",
      qty: clean(row.querySelector("[data-deal-qty]").value)
    };
  }).filter(item => item.product || item.code || item.qty);
}

function normalizedDealItem(item = {}, index = 0) {
  return {
    productId: item.productId || "",
    customerId: item.customerId || "",
    productSku: item.productSku || item.code || "",
    productName: item.productName || item.product || item.productLabel || item.name || "",
    unit: item.unit || item.size || "",
    qty: item.qty || 0,
    unitPrice: item.unitPrice || item.price || 0,
    discountAmount: item.discountAmount || 0,
    lineTotal: item.lineTotal || 0,
    deliveredQty: item.deliveredQty || 0,
    sortOrder: item.sortOrder ?? index,
    note: item.note || ""
  };
}

function dealOrderItems(deal) {
  const rows = orderItems.filter(item => item.dealId === deal.id).sort((a,b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  if (rows.length) return rows;
  return (Array.isArray(deal.items) ? deal.items : []).map((item, index) => ({
    id: `legacy:${deal.id}:${index}`,
    dealId: deal.id,
    customerId: deal.customerId || "",
    ...normalizedDealItem(item, index)
  }));
}

function qtyNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const match = clean(value).replace(",", ".").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function deliveryStats(deal) {
  const rows = dealOrderItems(deal);
  const total = rows.reduce((sum,item) => sum + Math.max(0, qtyNumber(item.qty)), 0);
  const delivered = rows.reduce((sum,item) => sum + Math.max(0, Number(item.deliveredQty || 0)), 0);
  const clamped = total ? Math.min(delivered, total) : delivered;
  const status = total <= 0
    ? "none"
    : clamped <= 0
      ? "none"
      : clamped >= total
        ? "done"
        : "partial";
  return {total, delivered: clamped, rawDelivered: delivered, remaining: Math.max(0, total - clamped), status};
}

function deliveryStatusLabel(status) {
  return {none:"Chưa giao", partial:"Giao thiếu", done:"Giao đủ"}[status] || "Chưa giao";
}

function deliveryStatusClass(status) {
  return status === "done" ? "green" : status === "partial" ? "orange" : "red";
}

function canUpdateDelivery(deal) {
  return isManager() && deal?.id && !deal.isDeleted && !isCanceledDeal(deal.dealStatus) && !isFailStatus(deal.dealStatus);
}

function writeOrderItemsForDeal(batch, deal, items, existingItems = []) {
  existingItems.forEach(item => batch.delete(doc(db, "orderItems", item.id)));
  items.forEach((item, index) => {
    const normalized = normalizedDealItem(item, index);
    const matchedOld = existingItems.find(old =>
      (normalized.productId && old.productId === normalized.productId)
      || (normalized.productSku && normalizeKey(old.productSku) === normalizeKey(normalized.productSku))
      || (normalizeKey(old.productName) && normalizeKey(old.productName) === normalizeKey(normalized.productName) && Number(old.sortOrder || 0) === index)
    );
    batch.set(doc(collection(db, "orderItems")), {
      dealId: deal.id,
      customerId: deal.customerId || "",
      ...normalized,
      deliveredQty: matchedOld ? Number(matchedOld.deliveredQty || 0) : 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });
}

function dealFormDataForCustomer(c) {
  const dealStatus = normalizeDealStatus(clean($("dealStatus").value) || systemLabel("depositStatus"));
  const completed = sameLabel(dealStatus, "boughtStatus");
  const canceled = isCanceledDeal(dealStatus) || isFailStatus(dealStatus);
  const depositPercent = Number($("dealDepositPercent").value || 0);
  const amount = Number($("dealAmount").value || 0);
  const items = collectDealItems();
  const productSummary = items.map(item => [item.product || item.productLabel, item.code ? `(${item.code})` : "", item.size].filter(Boolean).join(" ")).join("; ");
  return {
    dealStatus,
    completed,
    canceled,
    depositPercent,
    amount,
    items,
    productSummary,
    deal: {
      customerId: c.id, customerName: c.name || "", phoneNormalized: c.phoneNormalized || "",
      phoneRaw: c.phoneRaw || "", source: c.source || "", channel: c.channel || "",
      owner: c.owner || "", ownerEmail: c.ownerEmail || "", dealStatus,
      orderCustomerName: clean($("dealCustomerName").value) || c.name || "",
      orderPhone: clean($("dealCustomerPhone").value) || c.phoneRaw || c.phoneNormalized || "",
      deliveryAddress: clean($("dealDeliveryAddress").value) || c.address || "",
      taxCode: clean($("dealTaxCode").value),
      dealDate: clean($("dealDate").value) || todayIso(),
      deliveryDate: clean($("dealDeliveryDate").value),
      items,
      product: productSummary,
      depositPercent,
      amount,
      note: clean($("dealNote").value),
      completed,
      completedAt: completed ? serverTimestamp() : null,
      completedByEmail: completed ? (currentUser.email || "") : "",
      canceled,
      canceledAt: canceled ? serverTimestamp() : null,
      canceledByEmail: canceled ? (currentUser.email || "") : ""
    }
  };
}

function setDealFormMode(dealId="") {
  editingDealId = clean(dealId);
  if ($("saveDealBtn")) $("saveDealBtn").textContent = editingDealId ? "Cập nhật mua căn bản" : "Lưu mua căn bản";
  $("cancelEditDealBtn")?.classList.toggle("hide", !editingDealId);
}

function resetDealForm(c) {
  setDealFormMode("");
  $("dealStatus").value = systemLabel("depositStatus");
  $("dealCustomerName").value = clean(c.name);
  $("dealCustomerPhone").value = clean(c.phoneRaw || c.phoneNormalized);
  $("dealDeliveryAddress").value = clean(c.address);
  $("dealTaxCode").value = "";
  $("dealDate").value = todayIso();
  $("dealDeliveryDate").value = "";
  $("dealDepositPercent").value = "";
  $("dealAmount").value = "";
  resetDealItems(clean(c.need));
  $("dealNote").value = "";
}

function populateDealForm(d) {
  setDealFormMode(d.id);
  $("dealStatus").value = normalizeDealStatus(d.dealStatus) || systemLabel("depositStatus");
  $("dealCustomerName").value = clean(d.orderCustomerName || d.customerName);
  $("dealCustomerPhone").value = clean(d.orderPhone || d.phoneRaw || d.phoneNormalized);
  $("dealDeliveryAddress").value = clean(d.deliveryAddress);
  $("dealTaxCode").value = clean(d.taxCode);
  $("dealDate").value = dateInputValue(d.dealDate || d.createdAt);
  $("dealDeliveryDate").value = dateInputValue(d.deliveryDate);
  $("dealDepositPercent").value = d.depositPercent ?? "";
  $("dealAmount").value = d.amount ?? "";
  $("dealItems").innerHTML = "";
  const items = Array.isArray(d.items) && d.items.length ? d.items : [{product: d.product || "", qty: d.quantity || ""}];
  items.forEach(item => addDealItem(item));
  $("dealNote").value = clean(d.note);
  $("saveDealBtn").scrollIntoView({behavior:"smooth", block:"center"});
}

function clearDealEditMode() {
  const c = customers.find(x => x.id === selectedCustomerId);
  if (c) resetDealForm(c);
}

function clearForm() {
  ["name","phone","address","customerCompanyName","need","note"].forEach(id => { if ($(id)) $(id).value = ""; });
  ["source","channel","customerType","partnerType","partnerActivity","partnerLevel","partnerCapacity"].forEach(id => { if ($(id)) $(id).value = ""; });
  if ($("potentialLevel")) $("potentialLevel").value = "Bình thường";
  renderPhoneHint();
  hydrateChannelOptions();
  togglePartnerFields();
  if (isManager()) $("owner").value = "";
  $("name")?.focus();
}

function renderPhoneHint() {
  const hint = $("phoneHint");
  if (!hint) return;
  const phone = phoneNorm($("phone")?.value || "");
  if (!phone) {
    hint.textContent = "Có thể để trống nếu khách chưa có SĐT.";
    hint.className = "muted";
    return;
  }
  const existing = customers.find(c => !c.isDeleted && phoneNorm(c.phoneNormalized || c.phoneRaw || "") === phone);
  if (existing) {
    hint.textContent = `Có thể trùng với khách: ${existing.name || "Không tên"} (${customerOwnerName(existing) || "chưa phụ trách"}).`;
    hint.className = "error";
    return;
  }
  hint.textContent = "SĐT mới, chưa thấy trùng trong dữ liệu đã tải.";
  hint.className = "muted";
}

async function saveCustomer() {
  const phone = phoneNorm($("phone").value);
  const selectedOwner = isManager() ? ownerProfileByValue($("owner").value) : {name: ownerName(), email: ownerEmail()};
  const owner = clean(selectedOwner.name);
  const selectedOwnerEmail = clean(selectedOwner.email);
  const data = {
    name: clean($("name").value), phoneRaw: clean($("phone").value), phoneNormalized: phone,
    address: clean($("address").value), source: "", channel: clean($("channel").value), customerType: clean($("customerType").value),
    owner, ownerEmail: selectedOwnerEmail, need: clean($("need").value), note: clean($("note").value),
    noPhone: !phone,
    companyName: isPartnerChannel(clean($("channel").value)) ? clean($("customerCompanyName").value) : "",
    partnerType: isPartnerChannel(clean($("channel").value)) ? clean($("partnerType").value) : "",
    partnerActivity: isPartnerChannel(clean($("channel").value)) ? clean($("partnerActivity").value) : "",
    partnerLevel: isPartnerChannel(clean($("channel").value)) ? clean($("partnerLevel").value) : "",
    partnerCapacity: isPartnerChannel(clean($("channel").value)) ? clean($("partnerCapacity").value) : "",
    potentialLevel: clean($("potentialLevel").value) || "Bình thường",
    showroomVisitCount: 0,
    basicPurchaseCount: 0,
    basicPurchaseValue: 0,
    status: systemLabel("leadStatus"), follow: systemLabel("noDateFollow"), nextCareDate: "", isDeleted: false,
    createdByEmail: currentUser.email || "", updatedByEmail: currentUser.email || "",
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  };
  if (!data.name) return notice("Vui lòng nhập tên khách.", true);
  if (!data.channel) return notice("Vui lòng chọn kênh chi tiết.", true);
  if (isPartnerChannel(data.channel) && !data.companyName) return notice("Vui lòng nhập tên công ty.", true);
  if (!isManager() && !data.ownerEmail && !data.owner) return notice("Sale phải là người phụ trách khách vừa tạo.", true);

  try {
    const customerRef = doc(collection(db, "customers"));
    await callCrmRpc("crm_create_customer", {p_customer: {...data, id: customerRef.id}});
    clearForm();
    notice("Đã lưu khách mới.");
  } catch (err) {
    const duplicateCustomerId = duplicateCustomerIdFromError(err);
    if (duplicateCustomerId) {
      const existing = customers.find(c => c.id === duplicateCustomerId);
      notice(err.message, true);
      if (existing) openDrawer(existing.id, "deal");
      return;
    }
    notice(authMessage(err), true);
  }
}

async function saveCareLog() {
  const c = customers.find(x => x.id === selectedCustomerId);
  if (!c || !canEditCustomer(c)) return notice("Bạn không có quyền cập nhật khách này.", true);
  const careChannel = clean($("careChannel").value);
  const careResult = clean($("careResult").value);
  const careNote = clean($("careNote").value);
  const careDate = clean($("careDate")?.value) || todayIso();
  const nextCareDateInput = clean($("careNextDate").value);
  const showroomVisit = !!$("careShowroomVisit")?.checked;
  if (!careChannel) return notice("Vui lòng chọn hình thức chăm sóc.", true);
  if (!careResult) return notice("Vui lòng chọn kết quả chăm.", true);
  if (careDate > todayIso()) return notice("Ngày chăm không nên nằm trong tương lai.", true);
  if (!careNote) return notice("Vui lòng nhập ghi chú chăm sóc để lưu lịch sử rõ ràng.", true);
  if (isFollowUpResult(careResult) && !nextCareDateInput) return notice("Kết quả là Hẹn lại thì cần nhập ngày hẹn chăm tiếp.", true);
  if (nextCareDateInput && nextCareDateInput < todayIso()) return notice("Ngày hẹn chăm tiếp không nên nằm trong quá khứ.", true);
  const closeCare = isNoNeedResult(careResult) || sameLabel(careResult, "closedFollow");
  const nextStatus = closeCare ? systemLabel("noNeedStatus") : clean($("careStatus").value);
  const nextCareDate = closeCare ? "" : nextCareDateInput;
  const nextFollow = computedFollowStatus({...c, status: nextStatus || c.status, nextCareDate});
  const log = {
    customerId: c.id, customerName: c.name || "", phoneNormalized: c.phoneNormalized || "",
    owner: c.owner || "", ownerEmail: c.ownerEmail || "", status: nextStatus, follow: nextFollow,
    careChannel, careResult,
    activityType: "care",
    careDate,
    showroomVisit,
    companyName: isPartnerChannel(c.channel) ? clean($("careCompanyName").value) : "",
    partnerType: isPartnerChannel(c.channel) ? clean($("carePartnerType").value) : "",
    partnerActivity: isPartnerChannel(c.channel) ? clean($("carePartnerActivity").value) : "",
    partnerLevel: isPartnerChannel(c.channel) ? clean($("carePartnerLevel").value) : "",
    partnerCapacity: isPartnerChannel(c.channel) ? clean($("carePartnerCapacity").value) : "",
    need: clean($("careNeed").value), note: careNote,
    nextCareDate, createdByEmail: currentUser.email || "",
    createdAt: serverTimestamp()
  };
  try {
    const logRef = doc(collection(db, "careLogs"));
    const customerPatch = {
      status: log.status || c.status || systemLabel("activeStatus"),
      follow: nextFollow,
      companyName: log.companyName || c.companyName || "",
      partnerType: log.partnerType || c.partnerType || "",
      partnerActivity: log.partnerActivity || c.partnerActivity || "",
      partnerLevel: log.partnerLevel || c.partnerLevel || "",
      partnerCapacity: log.partnerCapacity || c.partnerCapacity || "",
      need: log.need || c.need || "",
      note: log.note || c.note || "",
      nextCareDate: log.nextCareDate || "",
      lastCareDate: careDate,
      showroomVisitCount: showroomVisit ? showroomVisitCountFor(c) + 1 : showroomVisitCountFor(c),
      lastContactAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser.email || ""
    };
    await callCrmRpc("crm_add_care_log", {
      p_customer_id: c.id,
      p_log: {...log, id: logRef.id},
      p_customer_patch: customerPatch
    });
    notice("Đã lưu chăm sóc.");
  } catch (err) {
    notice(authMessage(err), true);
  }
}

async function saveDeal() {
  if (editingDealId) return updateDeal(editingDealId);
  const c = customers.find(x => x.id === selectedCustomerId);
  if (!c || !canEditCustomer(c)) return notice("Bạn không có quyền ghi nhận mua căn bản cho khách này.", true);
  if (!clean($("dealCustomerName").value)) return notice("Vui lòng nhập tên khách.", true);
  const {dealStatus, completed, canceled, depositPercent, amount, items, deal} = dealFormDataForCustomer(c);
  if (depositPercent < 0 || depositPercent > 100) return notice("Tỷ lệ cọc phải từ 0 đến 100%.", true);
  deal.createdByEmail = currentUser.email || "";
  deal.createdAt = serverTimestamp();
  if (!items.length && !amount) return notice("Vui lòng nhập nội dung hoặc giá trị mua căn bản.", true);
  try {
    const dealRef = doc(collection(db, "deals"));
    const customerPatch = {
      dealStatus: deal.dealStatus,
      status: completed ? systemLabel("boughtStatus") : canceled ? systemLabel("activeStatus") : systemLabel("depositStatus"),
      follow: completed ? systemLabel("closedFollow") : canceled ? systemLabel("dueFollow") : systemLabel("activeFollow"),
      nextCareDate: completed ? "" : canceled ? todayIso() : c.nextCareDate || "",
      need: deal.product || c.need || "",
      note: deal.note || c.note || "",
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser.email || ""
    };
    await callCrmRpc("crm_save_basic_purchase", {
      p_action: "create",
      p_customer_id: c.id,
      p_deal_id: dealRef.id,
      p_deal: deal,
      p_customer_patch: customerPatch
    });
    resetDealForm(c);
    notice("Đã lưu mua căn bản.");
  } catch (err) {
    notice(authMessage(err), true);
  }
}

function syncCareFormRules() {
  const nextInput = $("careNextDate");
  if (!nextInput) return;
  const result = clean($("careResult")?.value);
  const needsDate = isFollowUpResult(result);
  nextInput.required = needsDate;
  nextInput.min = todayIso();
  nextInput.closest(".field")?.classList.toggle("required-field", needsDate);
}

async function updateDeal(dealId) {
  const oldDeal = deals.find(d => d.id === dealId);
  if (!oldDeal) return notice("Không tìm thấy dữ liệu mua căn bản để cập nhật.", true);
  if (!canEditDeal(oldDeal)) return notice("Bạn không có quyền sửa dữ liệu mua căn bản này.", true);
  const c = customers.find(x => x.id === oldDeal.customerId) || customers.find(x => x.id === selectedCustomerId);
  if (!c) return notice("Không tìm thấy khách của dữ liệu mua căn bản.", true);
  if (!clean($("dealCustomerName").value)) return notice("Vui lòng nhập tên khách.", true);
  const {dealStatus, completed, canceled, depositPercent, items, deal} = dealFormDataForCustomer(c);
  if (depositPercent < 0 || depositPercent > 100) return notice("Tỷ lệ cọc phải từ 0 đến 100%.", true);
  if (!items.length && !Number(deal.amount || 0)) return notice("Vui lòng nhập nội dung hoặc giá trị mua căn bản.", true);
  const updatedDeal = {
    ...deal,
    customerId: oldDeal.customerId,
    customerName: oldDeal.customerName || c.name || "",
    phoneNormalized: oldDeal.phoneNormalized || c.phoneNormalized || "",
    phoneRaw: oldDeal.phoneRaw || c.phoneRaw || "",
    owner: oldDeal.owner || c.owner || "",
    ownerEmail: oldDeal.ownerEmail || c.ownerEmail || "",
    completedAt: completed ? (oldDeal.completedAt || serverTimestamp()) : null,
    completedByEmail: completed ? (oldDeal.completedByEmail || currentUser.email || "") : "",
    canceledAt: canceled ? (oldDeal.canceledAt || serverTimestamp()) : null,
    canceledByEmail: canceled ? (oldDeal.canceledByEmail || currentUser.email || "") : "",
    updatedAt: serverTimestamp(),
    updatedByEmail: currentUser.email || ""
  };
  try {
    await callCrmRpc("crm_save_basic_purchase", {
      p_action: "update",
      p_customer_id: oldDeal.customerId,
      p_deal_id: oldDeal.id,
      p_deal: updatedDeal,
      p_customer_patch: customerDealStatePatch(oldDeal.customerId, oldDeal.id, {...oldDeal, ...updatedDeal, id: oldDeal.id})
    });
    resetDealForm(c);
    renderHistories(c.id);
    showDealList(isCompletedDeal(updatedDeal) ? "completed" : "pending");
    notice("Đã cập nhật mua căn bản.");
  } catch (err) {
    notice(authMessage(err), true);
  }
}

async function completeDeal(dealId) {
  const deal = deals.find(d => d.id === dealId);
  if (!deal || deal.completed) return;
  if (!canEditDeal(deal)) return notice("Bạn không có quyền hoàn thành ghi nhận mua căn bản này.", true);
  if (isFailStatus(deal.dealStatus) || isCanceledDeal(deal.dealStatus)) return notice("Ghi nhận đã hủy/rớt không thể hoàn thành.", true);
  try {
    const dealPatch = {
      dealStatus: systemLabel("boughtStatus"),
      completed: true,
      completedAt: serverTimestamp(),
      completedByEmail: currentUser.email || "",
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser.email || ""
    };
    const customerPatch = {
      dealStatus: systemLabel("boughtStatus"),
      status: systemLabel("boughtStatus"),
      follow: systemLabel("closedFollow"),
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser.email || ""
    };
    await callCrmRpc("crm_save_basic_purchase", {
      p_action: "complete", p_customer_id: deal.customerId, p_deal_id: deal.id,
      p_deal: dealPatch, p_customer_patch: customerPatch
    });
    notice("Đã hoàn thành ghi nhận mua căn bản. Lần mua này đã được tính vào hồ sơ khách.");
  } catch (err) {
    notice(authMessage(err), true);
  }
}

async function cancelDeal(dealId) {
  const deal = deals.find(d => d.id === dealId);
  if (!deal || deal.completed || isCanceledDeal(deal.dealStatus)) return;
  if (!canEditDeal(deal)) return notice("Bạn không có quyền hủy ghi nhận mua căn bản này.", true);
  const ok = confirm("Hủy ghi nhận mua căn bản này vì khách đổi ý?");
  if (!ok) return;
  try {
    const dealPatch = {
      dealStatus: systemLabel("canceledStatus"),
      canceled: true,
      canceledAt: serverTimestamp(),
      canceledByEmail: currentUser.email || "",
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser.email || ""
    };
    const otherActiveDeals = customerDeals(deal.customerId).filter(d => d.id !== deal.id && !isCanceledDeal(d.dealStatus) && !isFailStatus(d.dealStatus));
    const hasBought = otherActiveDeals.some(d => sameLabel(normalizeDealStatus(d.dealStatus), "boughtStatus") || d.completed === true);
    const hasDeposit = otherActiveDeals.some(d => sameLabel(normalizeDealStatus(d.dealStatus), "depositStatus"));
    const customerPatch = {
      dealStatus: hasBought ? systemLabel("boughtStatus") : hasDeposit ? systemLabel("depositStatus") : systemLabel("canceledStatus"),
      status: hasBought ? systemLabel("boughtStatus") : hasDeposit ? systemLabel("depositStatus") : systemLabel("activeStatus"),
      follow: hasBought ? systemLabel("closedFollow") : systemLabel("dueFollow"),
      nextCareDate: hasBought ? "" : todayIso(),
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser.email || ""
    };
    await callCrmRpc("crm_save_basic_purchase", {
      p_action: "cancel", p_customer_id: deal.customerId, p_deal_id: deal.id,
      p_deal: dealPatch, p_customer_patch: customerPatch
    });
    notice("Đã hủy ghi nhận mua căn bản.");
  } catch (err) {
    notice(authMessage(err), true);
  }
}

function openDeliveryModal(dealId) {
  const deal = deals.find(d => d.id === dealId);
  if (!deal) return notice("Không tìm thấy ghi nhận mua căn bản.", true);
  const rows = dealOrderItems(deal);
  const stats = deliveryStats(deal);
  const canSave = canUpdateDelivery(deal);
  openDetailModal(
    `Giao hàng - ${orderCustomerName(deal) || "Khách hàng"}`,
    `${deliveryStatusLabel(stats.status)} · Đã giao ${stats.delivered}/${stats.total || "-"} · Còn ${stats.remaining}`,
    `
      <div class="profile-stats">
        ${profileStat("Trạng thái giao", deliveryStatusLabel(stats.status))}
        ${profileStat("Tổng SL", stats.total || "-")}
        ${profileStat("Đã giao", stats.delivered)}
        ${profileStat("Còn lại", stats.remaining)}
      </div>
      <div class="section">
        <h3>Sản phẩm bàn giao</h3>
        <div class="delivery-list">
          ${rows.length ? rows.map((item, index) => {
            const qty = Math.max(0, qtyNumber(item.qty));
            const delivered = Math.max(0, Number(item.deliveredQty || 0));
            return `
              <div class="delivery-item" data-delivery-row data-order-item-id="${esc(item.id)}" data-delivery-index="${esc(index)}" data-product-id="${esc(item.productId || "")}" data-product-sku="${esc(item.productSku || item.code || "")}" data-product-name="${esc(item.productName || item.product || item.productLabel || "")}" data-qty="${esc(qty)}" data-old-delivered="${esc(delivered)}" data-unit="${esc(item.unit || "")}">
                <div>
                  <b>${esc(item.productName || item.product || item.productLabel || "Sản phẩm")}</b>
                  <div class="detail-meta">
                    ${item.productSku || item.code ? `<span>Mã: ${esc(item.productSku || item.code)}</span>` : ""}
                    <span>SL đơn: ${esc(qty || item.qty || 0)}</span>
                    <span>Đã giao: ${esc(delivered)}</span>
                    <span>Còn: ${esc(Math.max(0, qty - delivered))}</span>
                  </div>
                </div>
                <div class="field">
                  <label>SL đã giao lũy kế</label>
                  <input data-delivery-qty type="number" min="0" step="0.01" value="${esc(delivered)}" ${canSave ? "" : "disabled"}>
                </div>
              </div>
            `;
          }).join("") : `<div class="muted">Đơn này chưa có dòng sản phẩm để giao.</div>`}
        </div>
      </div>
      <div class="section">
        <h3>Ghi chú bàn giao</h3>
        <textarea id="deliveryNote" placeholder="Số phiếu giao, người nhận, ghi chú thiếu hàng..." ${canSave ? "" : "disabled"}></textarea>
      </div>
      <div class="actions">
        <button class="small" type="button" data-review-deal="${esc(deal.id)}">Quay lại chi tiết</button>
        <button class="small" type="button" data-print-delivery="${esc(deal.id)}">In phiếu giao</button>
        ${canSave ? `<button class="small primary" type="button" data-save-delivery="${esc(deal.id)}">Lưu bàn giao</button>` : `<span class="muted">Chỉ admin/manager được cập nhật bàn giao.</span>`}
      </div>
    `
  );
}

async function saveDelivery(dealId) {
  const deal = deals.find(d => d.id === dealId);
  if (!deal) return notice("Không tìm thấy đơn hàng.", true);
  if (!canUpdateDelivery(deal)) return notice("Chỉ admin/manager được cập nhật bàn giao.", true);
  const rows = [...document.querySelectorAll("[data-delivery-row]")];
  if (!rows.length) return notice("Đơn này chưa có sản phẩm để giao.", true);
  const sourceItems = dealOrderItems(deal);
  const batch = writeBatch(db);
  let changed = 0;
  let deliveredTotal = 0;
  let qtyTotal = 0;
  rows.forEach(row => {
    const orderItemId = clean(row.dataset.orderItemId);
    const index = Number(row.dataset.deliveryIndex || 0);
    const source = sourceItems[index] || {};
    const qty = Math.max(0, qtyNumber(row.dataset.qty || source.qty));
    const oldDelivered = Math.max(0, Number(row.dataset.oldDelivered || 0));
    const nextDelivered = Math.max(0, Number(row.querySelector("[data-delivery-qty]")?.value || 0));
    const deliveredQty = qty > 0 ? Math.min(nextDelivered, qty) : nextDelivered;
    const delta = deliveredQty - oldDelivered;
    qtyTotal += qty;
    deliveredTotal += deliveredQty;
    const payload = {
      dealId: deal.id,
      customerId: deal.customerId || "",
      productId: clean(row.dataset.productId || source.productId),
      productSku: clean(row.dataset.productSku || source.productSku || source.code),
      productName: clean(row.dataset.productName || source.productName || source.product || source.productLabel),
      unit: clean(row.dataset.unit || source.unit),
      qty: qty || source.qty || 0,
      unitPrice: source.unitPrice || source.price || 0,
      discountAmount: source.discountAmount || 0,
      lineTotal: source.lineTotal || 0,
      deliveredQty,
      sortOrder: source.sortOrder ?? index,
      note: source.note || "",
      updatedAt: serverTimestamp()
    };
    if (orderItemId.startsWith("legacy:")) {
      batch.set(doc(collection(db, "orderItems")), {...payload, createdAt: serverTimestamp()});
    } else {
      batch.set(doc(db, "orderItems", orderItemId), payload, {merge:true});
    }
    if (delta !== 0) {
      changed += 1;
      const movementType = delta > 0 ? "delivery" : "delivery_return";
      batch.set(doc(collection(db, "inventoryMovements")), {
        productId: payload.productId,
        productSku: payload.productSku,
        productName: payload.productName,
        movementType,
        qty: -delta,
        unit: payload.unit,
        refType: "delivery",
        refId: deal.id,
        warehouse: "main",
        note: clean($("deliveryNote")?.value) || `${delta > 0 ? "Giao hàng" : "Giảm SL giao"} cho ${orderCustomerName(deal)}`,
        isDeleted: false,
        createdByEmail: ownerEmail(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
  });
  const deliveryStatus = qtyTotal <= 0 ? "none" : deliveredTotal <= 0 ? "none" : deliveredTotal >= qtyTotal ? "done" : "partial";
  batch.set(doc(db, "deals", deal.id), {
    deliveryStatus,
    deliveredAt: deliveryStatus === "done" ? serverTimestamp() : null,
    deliveryNote: clean($("deliveryNote")?.value),
    updatedAt: serverTimestamp(),
    updatedByEmail: ownerEmail()
  }, {merge:true});
  batch.set(doc(collection(db, "auditLogs")), {
    action: "saveDelivery",
    entity: "deals",
    entityId: deal.id,
    email: ownerEmail(),
    payloadJson: JSON.stringify({deliveryStatus, deliveredTotal, qtyTotal, changed}),
    createdAt: serverTimestamp()
  });
  await batch.commit();
  closeDetailModal();
  notice("Đã cập nhật bàn giao.");
  renderOrders();
}

function customerDealStatePatch(customerId, excludeDealId="", replacementDeal=null) {
  const otherDeals = customerDeals(customerId).filter(d => d.id !== excludeDealId && !d.isDeleted);
  const sourceDeals = replacementDeal && !replacementDeal.isDeleted ? [replacementDeal, ...otherDeals] : otherDeals;
  const liveDeals = sourceDeals.filter(d => !isCanceledDeal(d.dealStatus) && !isFailStatus(d.dealStatus));
  const hasBought = liveDeals.some(isCompletedDeal);
  const hasDeposit = liveDeals.some(d => sameLabel(normalizeDealStatus(d.dealStatus), "depositStatus"));
  const hasOpen = liveDeals.some(isActiveDeal);
  const status = hasBought ? systemLabel("boughtStatus") : hasDeposit ? systemLabel("depositStatus") : systemLabel("activeStatus");
  return {
    dealStatus: hasBought ? systemLabel("boughtStatus") : hasDeposit ? systemLabel("depositStatus") : hasOpen ? normalizeDealStatus(liveDeals[0]?.dealStatus) : systemLabel("canceledStatus"),
    status,
    follow: hasBought ? systemLabel("closedFollow") : hasOpen || hasDeposit ? systemLabel("activeFollow") : systemLabel("dueFollow"),
    nextCareDate: hasBought ? "" : todayIso(),
    updatedAt: serverTimestamp(),
    updatedByEmail: currentUser.email || ""
  };
}

async function softDeleteDeal(dealId) {
  const deal = deals.find(d => d.id === dealId);
  if (!deal || deal.isDeleted) return;
  if (!deal.customerId) return notice("Đơn hàng này thiếu mã khách, chưa thể xóa mềm an toàn.", true);
  if (!isManager()) return notice("Chỉ admin/manager được xóa mềm đơn hàng.", true);
  const ok = confirm(`Xóa mềm đơn hàng của "${orderCustomerName(deal) || deal.customerName || deal.id}"? Dữ liệu sẽ được giữ trong hệ thống.`);
  if (!ok) return;
  try {
    const dealPatch = {
      isDeleted: true,
      deletedAt: serverTimestamp(),
      deletedByEmail: currentUser.email || "",
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser.email || ""
    };
    await callCrmRpc("crm_save_basic_purchase", {
      p_action: "archive", p_customer_id: deal.customerId, p_deal_id: deal.id,
      p_deal: dealPatch, p_customer_patch: customerDealStatePatch(deal.customerId, deal.id)
    });
    notice("Đã xóa mềm đơn hàng.");
  } catch (err) {
    notice(authMessage(err), true);
  }
}

function reviewDeal(dealId) {
  const d = deals.find(x => x.id === dealId);
  if (!d) return;
  const itemRows = dealOrderItems(d);
  const items = itemRows.length
    ? itemRows.map((item, idx) => {
      const qty = Math.max(0, qtyNumber(item.qty));
      return `
      <div class="detail-row">
        <b>${esc(idx + 1)}. ${esc(item.productName || item.product || item.productLabel || "Nội dung mua")}</b>
        <div class="detail-meta">
          ${item.productSku || item.code ? `<span>Mã: ${esc(item.productSku || item.code)}</span>` : ""}
          ${item.size ? `<span>Size: ${esc(item.size)}</span>` : ""}
          ${item.surface ? `<span>Bề mặt: ${esc(item.surface)}</span>` : ""}
          ${item.origin ? `<span>Xuất xứ: ${esc(item.origin)}</span>` : ""}
          <span>SL: ${esc(qty || item.qty || 0)}</span>
        </div>
      </div>
    `;}).join("")
    : `<div class="detail-row">${esc(d.product || "Chưa có nội dung mua")}${d.quantity ? ` · SL: ${esc(d.quantity)}` : ""}</div>`;
  openDetailModal(
    `Mua căn bản - ${orderCustomerName(d) || "Khách hàng"}`,
    `${orderCustomerPhone(d) || "Không SĐT"} · ${orderOwnerName(d) || ""}`,
    `
      <div class="profile-stats">
        ${profileStat("Trạng thái", orderStatusLabel(d))}
        ${profileStat("Giá trị", money(d.amount || 0))}
        ${profileStat("Đã cọc", `${d.depositPercent ?? 0}%`)}
        ${profileStat("Ngày ghi nhận", fmtDate(d.dealDate || d.createdAt) || "-")}
        ${profileStat("Ngày mua", fmtDate(d.completedAt) || "-")}
      </div>
      <div class="section">
        <h3>Nội dung mua căn bản</h3>
        <div class="detail-list">${items}</div>
      </div>
      <div class="section">
        <h3>Ghi chú</h3>
        <div class="detail-note">${esc(d.note || "Không có ghi chú.")}</div>
      </div>
      <div class="actions">
        <button class="small" type="button" data-open-care="${esc(d.customerId)}">Mở khách</button>
        ${canEditDeal(d) ? `<button class="small primary" type="button" data-edit-deal="${esc(d.id)}">Sửa mua căn bản</button>` : ""}
      </div>
    `
  );
}

function editDeal(dealId) {
  const d = deals.find(x => x.id === dealId);
  if (!d) return notice("Không tìm thấy dữ liệu mua căn bản.", true);
  if (!canEditDeal(d)) return notice("Bạn không có quyền sửa dữ liệu mua căn bản này.", true);
  closeDetailModal();
  openDrawer(d.customerId, "deal");
  populateDealForm(d);
  $("drawerTitle").textContent = `Sửa mua căn bản - ${orderCustomerName(d) || d.customerName || "Khách hàng"}`;
}

async function deleteCustomer() {
  if (!isManager()) return notice("Chỉ admin/manager được xóa khách.", true);
  const c = customers.find(x => x.id === selectedCustomerId);
  if (!c) return;
  const ok = confirm(`Ẩn khách "${c.name}"? Dữ liệu sẽ được lưu lại trong hệ thống/audit log và SĐT sẽ được giải phóng để nhập lại nếu cần.`);
  if (!ok) return;
  try {
    await callCrmRpc("crm_set_customer_archived", {p_customer_id: c.id, p_archived: true});
    closeDrawer();
    notice("Đã ẩn khách an toàn. Dữ liệu vẫn còn trong audit log để truy lại khi cần.");
  } catch (err) {
    notice(authMessage(err), true);
  }
}

async function restoreCustomer(customerId) {
  if (!isAdmin()) return notice("Chỉ admin được khôi phục khách.", true);
  const c = deletedCustomers.find(x => x.id === customerId);
  if (!c) return notice("Không tìm thấy khách trong thùng rác.", true);
  try {
    await callCrmRpc("crm_set_customer_archived", {p_customer_id: c.id, p_archived: false});
    notice("Đã khôi phục khách.");
  } catch (err) {
    notice("Không khôi phục được khách: " + authMessage(err), true);
  }
}

async function permanentlyDeleteCustomer(customerId) {
  if (!isAdmin()) return notice("Chỉ admin được xóa vĩnh viễn.", true);
  const c = deletedCustomers.find(x => x.id === customerId);
  if (!c) return notice("Không tìm thấy khách trong thùng rác.", true);
  notice(`P0-A đã tạm khóa xóa vĩnh viễn khách "${c.name || c.id}" để tránh dữ liệu bị xóa một phần. Hãy dùng Ẩn khách/Thùng rác.`, true);
}

async function cleanupPhoneIndex() {
  if (!isAdmin()) return notice("Chỉ admin được cleanup phoneIndex.", true);
  try {
    const snap = await getDocs(collection(db, "phoneIndex"));
    const activeByPhone = new Map(customers.map(c => [phoneNorm(c.phoneNormalized || c.phoneRaw || ""), c]).filter(([p]) => p));
    const batch = writeBatch(db);
    let removed = 0, repaired = 0;
    snap.docs.forEach(d => {
      const phone = d.id;
      const c = activeByPhone.get(phone);
      if (!c) {
        batch.delete(doc(db, "phoneIndex", phone));
        removed++;
        return;
      }
      const data = d.data();
      if (data.customerId !== c.id || data.ownerEmail !== c.ownerEmail || data.owner !== c.owner) {
        batch.set(doc(db, "phoneIndex", phone), {
          customerId: c.id,
          owner: c.owner || "",
          ownerEmail: c.ownerEmail || "",
          updatedByEmail: currentUser.email || "",
          updatedAt: serverTimestamp()
        }, {merge:true});
        repaired++;
      }
    });
    batch.set(doc(collection(db, "auditLogs")), {
      action: "cleanupPhoneIndex", entity: "phoneIndex", entityId: "bulk",
      email: currentUser.email || "", payloadJson: JSON.stringify({removed,repaired}), createdAt: serverTimestamp()
    });
    await batch.commit();
    notice(`Đã cleanup phoneIndex. Xóa ${removed}, sửa ${repaired}.`);
  } catch (err) {
    notice("Không cleanup phoneIndex được: " + authMessage(err), true);
  }
}

async function cleanupOrphans() {
  if (!isAdmin()) return notice("Chỉ admin được cleanup orphan.", true);
  const allIds = new Set(allCustomers.map(c => c.id));
  const orphanLogs = allCareLogs.filter(l => l.customerId && !allIds.has(l.customerId));
  const orphanDeals = allDeals.filter(d => d.customerId && !allIds.has(d.customerId));
  if (!orphanLogs.length && !orphanDeals.length) return notice("Không có careLogs/deals orphan.");
  notice(`P0-A đã tạm khóa cleanup xóa cứng (${orphanLogs.length} care logs, ${orphanDeals.length} dữ liệu mua căn bản) để tránh xóa một phần.`, true);
}

async function cleanupData() {
  if (!isAdmin()) return notice("Chỉ admin được dọn dữ liệu.", true);
  if (!confirm("Chạy dọn dữ liệu: cleanup phoneIndex và careLogs/deals orphan?")) return;
  await cleanupPhoneIndex();
  await cleanupOrphans();
}

function infoCell(label, value) {
  const display = value === 0 ? 0 : (value || "-");
  return `<div class="info-cell"><span>${esc(label)}</span><b>${esc(display)}</b></div>`;
}

function profileStat(label, value) {
  return `<div class="profile-stat"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
}

function activityMetaPills(values = []) {
  const items = values.filter(Boolean);
  return items.length ? `<div class="activity-pills">${items.map(item => `<span>${esc(item)}</span>`).join("")}</div>` : "";
}

function customerActivityItems(id) {
  const assignmentRows = customerAssignmentHistory(id).map(item => ({
    kind: "assignment",
    label: item.isCurrent ? "Đang phụ trách" : "Lịch sử phân công",
    at: item.isCurrent ? item.assignedAt : (item.endedAt || item.assignedAt),
    title: item.employeeNameSnapshot || item.employeeEmailSnapshot || "Owner lịch sử",
    text: item.isCurrent ? "Assignment hiện tại" : (item.endReason || "Đã kết thúc phân công"),
    meta: item.assignmentReason || "",
    pills: [
      item.assignedAt ? `Từ: ${fmtDate(item.assignedAt)}` : "",
      item.endedAt ? `Đến: ${fmtDate(item.endedAt)}` : "",
      item.assignedByEmail ? `Giao bởi: ${item.assignedByEmail}` : ""
    ]
  }));
  const careRows = customerLogs(id).map(l => ({
    kind: "care",
    label: "Chăm sóc",
    at: careLogActivityDate(l),
    title: l.careResult || l.status || "Ghi chăm sóc",
    text: l.note || "",
    meta: "",
    pills: [
      l.careDate ? `Ngày chăm: ${fmtDate(l.careDate)}` : "",
      l.careChannel ? `Hình thức: ${l.careChannel}` : "",
      l.status ? `Trạng thái: ${l.status}` : "",
      l.nextCareDate ? `Hẹn tiếp: ${fmtDate(l.nextCareDate)}` : "Chưa hẹn tiếp",
      l.showroomVisit ? "Đến showroom" : ""
    ]
  }));
  const dealRows = customerDeals(id).map(d => ({
    kind: "deal",
    label: "Mua căn bản",
    at: d.completedAt || d.dealDate || d.createdAt,
    title: normalizeDealStatus(d.dealStatus) || "Ghi nhận mua căn bản",
    text: [orderProductText(d), dealAmount(d) ? money(dealAmount(d)) : ""].filter(Boolean).join(" · "),
    meta: "",
    pills: [
      d.completedAt ? `Ngày mua: ${fmtDate(d.completedAt)}` : "",
      d.dealDate ? `Ngày ghi: ${fmtDate(d.dealDate)}` : ""
    ]
  }));
  const proposalRows = kpiProposals
    .filter(p => p.customerId === id && !p.isDeleted)
    .map(p => ({
      kind: "kpi",
      label: "KPI",
      at: p.createdAt,
      title: p.kpiName || "Đề xuất KPI",
      text: isApprovedKpiProposal(p) ? "Đã duyệt" : isRejectedKpiProposal(p) ? "Từ chối" : "Chờ duyệt",
      meta: p.content || "",
      pills: [p.status ? `Trạng thái: ${p.status}` : ""]
    }));
  return [...assignmentRows, ...careRows, ...dealRows, ...proposalRows]
    .sort((a,b) => (toDate(b.at)?.getTime() || 0) - (toDate(a.at)?.getTime() || 0));
}

function renderCustomerActivityPreview(c) {
  const box = $("customerActivityPreview");
  if (!box || !c) return;
  const activity = customerActivityItems(c.id);
  const logs = customerLogs(c.id);
  const ds = customerDeals(c.id);
  const proposals = kpiProposals.filter(p => p.customerId === c.id && !p.isDeleted);
  const pendingDeals = ds.filter(isActiveDeal);
  const approvedKpi = proposals.filter(isApprovedKpiProposal);
  const nextCare = careScheduleText(c);
  box.innerHTML = `
    <div class="profile-stats">
      ${profileStat("Lần chăm", logs.length)}
      ${profileStat("Mức tiềm năng", potentialLevelFor(c))}
      ${profileStat("Đến showroom", showroomVisitCountFor(c))}
      ${profileStat("Số lần mua", basicPurchaseCountFor(c))}
      ${profileStat("Giá trị mua", money(basicPurchaseValueFor(c)))}
      ${profileStat("Mua đang xử lý", pendingDeals.length)}
      ${profileStat("KPI duyệt", approvedKpi.length)}
    </div>
    <div class="profile-subtitle">
      <h4>Hoạt động gần đây</h4>
      <span class="pill ${esc(careSchedulePillClass(c))}">Hẹn: ${esc(nextCare)}</span>
    </div>
    ${activity.length ? `<div class="activity-mini-list">${activity.slice(0,5).map(item => `
      <div class="activity-mini ${esc(item.kind)}">
        <div class="activity-mini-head">
          <b>${esc(item.label)} · ${esc(item.title)}</b>
          <span class="muted">${esc(fmtDate(item.at))}</span>
        </div>
        ${activityMetaPills(item.pills)}
        ${item.text ? `<div>${esc(item.text)}</div>` : ""}
        ${item.meta ? `<div class="muted">${esc(item.meta)}</div>` : ""}
      </div>
    `).join("")}</div>` : `<div class="muted">Chưa có hoạt động nào cho khách này.</div>`}
  `;
}

function renderCustomerInfo(c) {
  if (!c) return;
  $("careStatus").value = clean(c.status);
  updateCareStatusVisual();
  $("customerInfoView").innerHTML = [
    infoCell("Khách hàng", c.name),
    infoCell("SĐT", c.phoneRaw || c.phoneNormalized || "Không SĐT"),
    infoCell("Địa chỉ", c.address),
    infoCell("Kênh chi tiết", c.channel),
    infoCell("Loại khách", c.customerType),
    isPartnerChannel(c.channel) ? infoCell("Tên công ty", c.companyName) : "",
    infoCell("Nhân viên phụ trách", customerOwnerName(c)),
    infoCell("Mức tiềm năng", potentialLevelFor(c)),
    infoCell("Số lần đến showroom", showroomVisitCountFor(c)),
    infoCell("Số lần mua căn bản", basicPurchaseCountFor(c)),
    infoCell("Tổng giá trị mua căn bản", money(basicPurchaseValueFor(c))),
    infoCell("Nhu cầu / Quan tâm", c.need),
    infoCell("Ghi chú", c.note)
  ].join("");
  renderCustomerActivityPreview(c);
}

function fillCustomerInfoEdit(c) {
  $("editName").value = clean(c.name);
  $("editPhone").value = clean(c.phoneRaw || c.phoneNormalized);
  $("editCreatedAtField").classList.toggle("hide", !isAdmin());
  $("editCreatedAt").value = dateInputValue(c.createdAt);
  $("editAddress").value = clean(c.address);
  hydrateEditChannelOptions();
  $("editChannel").value = clean(c.channel);
  $("editOwner").value = clean(c.ownerEmail || c.owner);
  $("editSource").value = "";
  $("editCustomerType").value = clean(c.customerType);
  $("editCompanyName").value = clean(c.companyName);
  ["editPartnerType","editPartnerActivity","editPartnerLevel","editPartnerCapacity"].forEach(id => { if ($(id)) $(id).value = ""; });
  $("editPartnerType").value = clean(c.partnerType);
  $("editPartnerActivity").value = clean(c.partnerActivity);
  $("editPartnerLevel").value = clean(c.partnerLevel);
  $("editPartnerCapacity").value = clean(c.partnerCapacity);
  $("editPotentialLevel").value = potentialLevelFor(c);
  $("editShowroomVisitCount").value = showroomVisitCountFor(c);
  $("editBasicPurchaseCount").value = basicPurchaseCountFor(c);
  $("editBasicPurchaseValue").value = basicPurchaseValueFor(c);
  $("editNeed").value = clean(c.need);
  $("editNote").value = clean(c.note);
  if (!isManager()) $("editOwner").value = clean(c.ownerEmail || ownerEmail());
  toggleEditPartnerFields();
}

function toggleCustomerInfoEdit(show) {
  const c = customers.find(x => x.id === selectedCustomerId);
  if (!c) return;
  $("customerInfoView").classList.toggle("hide", show);
  $("customerActivityPreview").classList.toggle("hide", show);
  $("customerInfoEdit").classList.toggle("hide", !show);
  $("editCustomerInfoBtn").classList.toggle("hide", show);
  if (show) fillCustomerInfoEdit(c);
  else renderCustomerActivityPreview(c);
}

async function saveCustomerInfo() {
  const c = customers.find(x => x.id === selectedCustomerId);
  if (!c || !canEditCustomer(c)) return notice("Bạn không có quyền sửa khách này.", true);
  const phone = phoneNorm($("editPhone").value);
  const selectedOwner = isManager() ? ownerProfileByValue($("editOwner").value) : {name: c.owner || ownerName(), email: c.ownerEmail || ownerEmail()};
  const data = {
    name: clean($("editName").value),
    phoneRaw: clean($("editPhone").value),
    phoneNormalized: phone,
    noPhone: !phone,
    address: clean($("editAddress").value),
    source: "",
    channel: clean($("editChannel").value),
    customerType: clean($("editCustomerType").value),
    owner: clean(selectedOwner.name),
    ownerEmail: clean(selectedOwner.email),
    companyName: isPartnerChannel(clean($("editChannel").value)) ? clean($("editCompanyName").value) : "",
    partnerType: isPartnerChannel(clean($("editChannel").value)) ? clean($("editPartnerType").value) : "",
    partnerActivity: isPartnerChannel(clean($("editChannel").value)) ? clean($("editPartnerActivity").value) : "",
    partnerLevel: isPartnerChannel(clean($("editChannel").value)) ? clean($("editPartnerLevel").value) : "",
    partnerCapacity: isPartnerChannel(clean($("editChannel").value)) ? clean($("editPartnerCapacity").value) : "",
    potentialLevel: clean($("editPotentialLevel").value) || "Bình thường",
    showroomVisitCount: positiveNumber($("editShowroomVisitCount").value),
    basicPurchaseCount: positiveNumber($("editBasicPurchaseCount").value),
    basicPurchaseValue: positiveNumber($("editBasicPurchaseValue").value),
    need: clean($("editNeed").value),
    note: clean($("editNote").value),
    updatedAt: serverTimestamp(),
    updatedByEmail: currentUser.email || ""
  };
  if (isAdmin()) {
    const createdAtInput = clean($("editCreatedAt").value);
    if (createdAtInput) data.createdAt = new Date(createdAtInput + "T00:00:00");
  }
  if (!data.name) return notice("Vui lòng nhập tên khách.", true);
  if (!data.channel) return notice("Vui lòng chọn kênh chi tiết.", true);
  if (isPartnerChannel(data.channel) && !data.companyName) return notice("Vui lòng nhập tên công ty.", true);
  if (!data.ownerEmail && !data.owner) return notice("Vui lòng chọn nhân viên phụ trách.", true);
  try {
    const ownerChanged = isManager() && !sameIdentity(data.ownerEmail, c.ownerEmail || c.owner);
    const profileChanges = {...data};
    delete profileChanges.owner;
    delete profileChanges.ownerEmail;
    if (ownerChanged) {
      await callCrmRpc("crm_transfer_customer", {
        p_customer_id: c.id,
        p_new_owner_email: data.ownerEmail,
        p_profile_changes: profileChanges
      });
    } else {
      await callCrmRpc("crm_update_customer_profile", {p_customer_id: c.id, p_changes: profileChanges});
    }
    toggleCustomerInfoEdit(false);
    notice("Đã cập nhật thông tin khách.");
  } catch (err) {
    notice(authMessage(err), true);
  }
}

function openDrawer(id, mode="care") {
  const c = customers.find(x => x.id === id);
  if (!c) return notice("Không tìm thấy khách.", true);
  selectedCustomerId = id;
  const drawerTitle = c.name || "Khách hàng";
  const drawerMeta = [
    c.phoneRaw || c.phoneNormalized || "Không SĐT",
    c.companyName || c.channel || "",
    customerOwnerName(c),
    `Đến showroom: ${showroomVisitCountFor(c)}`,
    `Mua căn bản: ${basicPurchaseCountFor(c)} lần`,
    `Giá trị: ${money(basicPurchaseValueFor(c))}`
  ].filter(Boolean);
  $("drawerTitle").textContent = drawerTitle;
  $("drawerInfo").innerHTML = drawerMeta.map(item => `<span>${esc(item)}</span>`).join("");
  $("careStatus").value = clean(c.status);
  updateCareStatusVisual();
  $("careChannel").value = "";
  $("careResult").value = "";
  $("careCompanyName").value = clean(c.companyName);
  $("carePartnerType").value = clean(c.partnerType);
  $("carePartnerActivity").value = clean(c.partnerActivity);
  $("carePartnerLevel").value = clean(c.partnerLevel);
  $("carePartnerCapacity").value = clean(c.partnerCapacity);
  toggleCarePartnerFields(c.channel);
  $("careNeed").value = clean(c.need);
  $("careNote").value = "";
  if ($("careDate")) $("careDate").value = todayIso();
  if ($("careShowroomVisit")) $("careShowroomVisit").checked = false;
  $("careNextDate").value = clean(c.nextCareDate);
  syncCareFormRules();
  $("dealStatus").value = systemLabel("depositStatus");
  $("dealCustomerName").value = clean(c.name);
  $("dealCustomerPhone").value = clean(c.phoneRaw || c.phoneNormalized);
  $("dealDeliveryAddress").value = clean(c.address);
  $("dealTaxCode").value = "";
  $("dealDate").value = todayIso();
  $("dealDeliveryDate").value = "";
  $("dealDepositPercent").value = "";
  $("dealAmount").value = "";
  resetDealItems(clean(c.need));
  $("dealNote").value = "";
  $("deleteCustomerBtn").classList.toggle("hide", !isManager());
  renderCustomerInfo(c);
  toggleCustomerInfoEdit(false);
  const titleMap = {
    care: `Chăm sóc KH - ${c.name || "Khách hàng"}`,
    deal: `Đơn hàng - ${c.name || "Khách hàng"}`
  };
  $("drawerTitle").textContent = titleMap[mode] || titleMap.care;
  $("customerInfoSection").classList.toggle("hide", mode !== "care");
  $("careSection").classList.toggle("hide", mode !== "care");
  $("logHistorySection").classList.add("hide");
  $("dealSection").classList.toggle("hide", mode !== "deal");
  $("dealListSection").classList.add("hide");
  renderHistories(id);
  $("drawerBackdrop").classList.remove("hide");
  $("drawer").classList.remove("hide");
  setTimeout(() => $("drawer").scrollTo({top:0,behavior:"smooth"}), 60);
}

function toggleCareHistory() {
  if (!selectedCustomerId) return notice("Bạn cần mở khách hàng trước.", true);
  renderHistories(selectedCustomerId);
  $("logHistorySection").classList.toggle("hide");
  if (!$("logHistorySection").classList.contains("hide")) {
    setTimeout(() => $("logHistorySection").scrollIntoView({behavior:"smooth", block:"nearest"}), 60);
  }
}

function closeDrawer() {
  selectedCustomerId = "";
  $("drawerBackdrop").classList.add("hide");
  $("drawer").classList.add("hide");
}

function dealCard(d) {
  return `
    <div class="deal-item">
      <b>${esc(d.dealStatus || "")}</b> · Ngày ghi nhận: ${esc(fmtDate(d.dealDate))} · ${esc(d.product || "")}
      <div class="muted">${esc(d.orderCustomerName || d.customerName || "")} · ${esc(d.orderPhone || d.phoneRaw || d.phoneNormalized || "Không SĐT")}</div>
      ${d.deliveryAddress ? `<div class="muted">Địa chỉ: ${esc(d.deliveryAddress)}</div>` : ""}
      ${d.taxCode ? `<div class="muted">MST: ${esc(d.taxCode)}</div>` : ""}
      ${d.deliveryDate ? `<div class="muted">Ngày liên quan: ${esc(fmtDate(d.deliveryDate))}</div>` : ""}
      <div class="muted">Cọc: ${esc(d.depositPercent ?? 0)}% · Giá trị: ${esc(money(d.amount || 0))}</div>
      ${Array.isArray(d.items) && d.items.length ? `<div class="muted">${esc(d.items.map(item => `${item.product || item.productLabel || ""}${item.code ? " - " + item.code : ""}${item.size ? " - " + item.size : ""}${item.qty ? " - SL: " + item.qty : ""}`).join("; "))}</div>` : ""}
      <div>${d.completed ? `<span class="pill green">Hoàn thành</span> ${d.completedAt ? `<span class="muted">· ${esc(fmtDate(d.completedAt))}</span>` : ""}` : isCanceledDeal(d.dealStatus) ? `<span class="pill red">${esc(systemLabel("canceledStatus"))}</span> ${d.canceledAt ? `<span class="muted">· ${esc(fmtDate(d.canceledAt))}</span>` : ""}` : `<span class="pill orange">Đang xử lý</span>`}</div>
      <div class="muted">${esc(d.note || "")}</div>
      <div class="actions">
        <button class="small" data-review-deal="${esc(d.id)}">Xem lại</button>
        ${canEditDeal(d) ? `<button class="small primary" data-edit-deal="${esc(d.id)}">Sửa</button>` : ""}
        ${canEditDeal(d) && (isActiveDeal(d) || sameLabel(normalizeDealStatus(d.dealStatus), "depositStatus")) ? `<button class="small primary" data-complete-deal="${esc(d.id)}">Hoàn thành</button><button class="small danger" data-cancel-deal="${esc(d.id)}">Hủy</button>` : ""}
        ${isManager() ? `<button class="small danger" data-delete-deal="${esc(d.id)}">Xóa mềm</button>` : ""}
      </div>
    </div>
  `;
}

function showDealList(kind) {
  if (!selectedCustomerId) return;
  const ds = customerDeals(selectedCustomerId).filter(d => kind === "completed" ? isCompletedDeal(d) : isActiveDeal(d) || sameLabel(normalizeDealStatus(d.dealStatus), "depositStatus"));
  $("dealListTitle").textContent = kind === "completed" ? "Mua căn bản đã hoàn thành" : "Mua căn bản đang theo dõi";
  $("dealListContent").innerHTML = ds.length ? ds.map(dealCard).join("") : "Chưa có dữ liệu mua căn bản.";
  $("dealListSection").classList.remove("hide");
  $("dealListSection").scrollIntoView({behavior:"smooth", block:"nearest"});
}

function parseCareLogEditInput(text) {
  const data = {};
  clean(text).split(/\r?\n/).forEach(line => {
    const idx = line.indexOf(":");
    if (idx < 0) return;
    const key = normalizeKey(line.slice(0, idx));
    const value = clean(line.slice(idx + 1));
    if (key === "trangthai") data.status = value;
    if (key === "hinhthuc") data.careChannel = value;
    if (key === "ketqua") data.careResult = value;
    if (key === "ngaycham") data.careDate = value;
    if (key === "hencham") data.nextCareDate = value;
    if (key === "denshowroom") data.showroomVisit = ["yes","true","co","có","1"].includes(normalizeKey(value));
    if (key === "ghichu") data.note = value;
  });
  return data;
}

function latestCareStateForCustomer(customerId, logList = careLogs) {
  const latest = logList
    .filter(l => l.customerId === customerId && !l.isDeleted)
    .sort(careLogSortDesc)[0];
  const c = customers.find(x => x.id === customerId);
  if (!latest) {
    const fallbackStatus = c?.status || systemLabel("leadStatus");
    return {
      status: fallbackStatus,
      follow: computedFollowStatus({...c, status: fallbackStatus, nextCareDate: ""}),
      nextCareDate: "",
      lastContactAt: null
    };
  }
  const state = {
    status: latest.status || c?.status || systemLabel("activeStatus"),
    nextCareDate: latest.nextCareDate || "",
    companyName: latest.companyName || c?.companyName || "",
    partnerType: latest.partnerType || c?.partnerType || "",
    partnerActivity: latest.partnerActivity || c?.partnerActivity || "",
    partnerLevel: latest.partnerLevel || c?.partnerLevel || "",
    partnerCapacity: latest.partnerCapacity || c?.partnerCapacity || "",
    need: latest.need || c?.need || "",
    note: latest.note || c?.note || "",
    lastCareDate: latest.careDate || "",
    lastContactAt: latest.createdAt || null
  };
  state.follow = computedFollowStatus({...c, status: state.status, nextCareDate: state.nextCareDate});
  return state;
}

async function editCareLog(logId) {
  if (!isAdmin()) return notice("Chỉ admin được sửa lịch sử chăm sóc.", true);
  const log = careLogs.find(l => l.id === logId);
  if (!log) return notice("Không tìm thấy lịch sử chăm sóc.", true);
  const text = prompt("Sửa lịch sử chăm sóc theo mẫu bên dưới:", [
    `Trạng thái: ${log.status || ""}`,
    `Hình thức: ${log.careChannel || ""}`,
    `Kết quả: ${log.careResult || ""}`,
    `Ngày chăm: ${log.careDate || ""}`,
    `Hẹn chăm: ${log.nextCareDate || ""}`,
    `Đến showroom: ${log.showroomVisit ? "có" : "không"}`,
    `Ghi chú: ${log.note || ""}`
  ].join("\n"));
  if (text === null) return;
  const updates = parseCareLogEditInput(text);
  if (!Object.keys(updates).length) return notice("Không có nội dung hợp lệ để sửa.", true);
  try {
    const c = customers.find(item => item.id === log.customerId) || {};
    const showroomDelta = typeof updates.showroomVisit === "boolean" && updates.showroomVisit !== !!log.showroomVisit ? (updates.showroomVisit ? 1 : -1) : 0;
    const nextLog = {...log, ...updates, updatedAt: new Date()};
    const nextLogs = careLogs.map(l => l.id === log.id ? nextLog : l);
    const customerPatch = {
      ...latestCareStateForCustomer(log.customerId, nextLogs),
      showroomVisitCount: Math.max(0, showroomVisitCountFor(c) + showroomDelta),
      updatedByEmail: currentUser.email || "",
      updatedAt: serverTimestamp()
    };
    const logPatch = {
      ...updates,
      follow: computedFollowStatus({...customers.find(c => c.id === log.customerId), status: updates.status || log.status, nextCareDate: updates.nextCareDate ?? log.nextCareDate}),
      updatedByEmail: currentUser.email || "",
      updatedAt: serverTimestamp()
    };
    await callCrmRpc("crm_update_care_log", {
      p_log_id: log.id, p_changes: logPatch, p_customer_patch: customerPatch
    });
    notice("Đã sửa lịch sử chăm sóc.");
  } catch (err) {
    notice("Không sửa được lịch sử chăm sóc: " + authMessage(err), true);
  }
}

async function deleteCareLog(logId) {
  if (!isAdmin()) return notice("Chỉ admin được xóa lịch sử chăm sóc.", true);
  const log = careLogs.find(l => l.id === logId);
  if (!log) return notice("Không tìm thấy lịch sử chăm sóc.", true);
  if (!confirm("Xóa lịch sử chăm sóc này? Dòng này sẽ bị ẩn khỏi web và ghi lại audit log.")) return;
  try {
    const c = customers.find(item => item.id === log.customerId) || {};
    const nextLogs = careLogs.map(l => l.id === log.id ? {...l, isDeleted: true} : l);
    const customerPatch = {
      ...latestCareStateForCustomer(log.customerId, nextLogs),
      showroomVisitCount: log.showroomVisit ? Math.max(0, showroomVisitCountFor(c) - 1) : showroomVisitCountFor(c),
      updatedByEmail: currentUser.email || "",
      updatedAt: serverTimestamp()
    };
    await callCrmRpc("crm_archive_care_log", {p_log_id: log.id, p_customer_patch: customerPatch});
    notice("Đã xóa lịch sử chăm sóc.");
  } catch (err) {
    notice("Không xóa được lịch sử chăm sóc: " + authMessage(err), true);
  }
}

function renderHistories(id) {
  if (!$("dealListSection").classList.contains("hide")) {
    const title = $("dealListTitle").textContent.includes("hoàn thành") ? "completed" : "pending";
    showDealList(title);
  }
  const careActionsByDate = new Map(customerLogs(id).flatMap(l => [[String(l.createdAt || ""), l], [String(careLogActivityDate(l) || ""), l]]));
  const timeline = customerActivityItems(id);
  $("logHistory").innerHTML = timeline.length ? timeline.map(item => {
    const careLog = item.kind === "care" ? careActionsByDate.get(String(item.at || "")) : null;
    return `
      <div class="activity-mini ${esc(item.kind)}">
        <div class="activity-mini-head">
          <b>${esc(item.label)} · ${esc(item.title)}</b>
          <span class="muted">${esc(fmtDate(item.at))}</span>
        </div>
        ${activityMetaPills(item.pills)}
        ${item.text ? `<div>${esc(item.text)}</div>` : ""}
        ${item.meta ? `<div class="muted">${esc(item.meta)}</div>` : ""}
        ${careLog && (careLog.companyName || careLog.partnerType || careLog.partnerActivity || careLog.partnerLevel || careLog.partnerCapacity) ? `<div class="muted">${esc([careLog.companyName,careLog.partnerType,careLog.partnerActivity,careLog.partnerLevel,careLog.partnerCapacity].filter(Boolean).join(" · "))}</div>` : ""}
        ${careLog && isAdmin() ? `<div class="actions"><button class="small" data-edit-care-log="${esc(careLog.id)}">Sửa</button><button class="small danger" data-delete-care-log="${esc(careLog.id)}">Xóa</button></div>` : ""}
      </div>
    `;
  }).join("") : "Chưa có timeline hoạt động.";
}

function isoFromAny(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = toDate(value);
  return d && !Number.isNaN(d) ? d.toISOString().slice(0,10) : "";
}

function weekRange(weekValue) {
  const match = /^(\d{4})-W(\d{2})$/.exec(clean(weekValue));
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay() || 7;
  const monday = new Date(simple);
  monday.setUTCDate(simple.getUTCDate() - dow + 1);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {start:monday.toISOString().slice(0,10), end:sunday.toISOString().slice(0,10), label:`tuần ${match[2]}-${year}`};
}

function monthRange(monthValue) {
  const value = clean(monthValue) || currentMonth();
  const [year, month] = value.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return {start:start.toISOString().slice(0,10), end:end.toISOString().slice(0,10), label:`tháng ${String(month).padStart(2,"0")}-${year}`};
}

function selectedReportRange() {
  return weekRange($("filterWeek").value) || monthRange($("filterMonth").value);
}

function selectedActivityReportRange() {
  return weekRange($("reportActivityWeek")?.value) || monthRange($("reportActivityMonth")?.value) || monthRange(currentMonth());
}

function inDateRange(value, range) {
  const iso = isoFromAny(value);
  return !!iso && iso >= range.start && iso <= range.end;
}

function exportOwnerMatches(item, ownerFilter) {
  if (!ownerFilter) return true;
  return sameIdentity(item.ownerEmail, ownerFilter) || sameIdentity(item.owner, ownerFilter);
}

function ownerMatchesKey(item, ownerFilter) {
  if (!ownerFilter) return true;
  return sameIdentity(item.ownerEmail, ownerFilter) || sameIdentity(item.owner, ownerFilter);
}

function customerById(id) {
  return customers.find(c => c.id === id) || {};
}

function orderDate(d) {
  return isoFromAny(d.completedAt || d.dealDate || d.createdAt);
}

function orderProductText(d) {
  const sourceItems = Array.isArray(d.items) && d.items.length ? d.items : orderItems.filter(item => item.dealId === d.id);
  const items = sourceItems.map(item => [item.product || item.productName, item.code || item.productSku, item.qty ? `SL: ${item.qty}` : ""].filter(Boolean).join(" - ")).filter(Boolean);
  return items.length ? items.join("; ") : clean(d.product);
}

function paymentNo() {
  return `TT-${todayIso().replaceAll("-", "")}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function paymentDateValue(p) {
  return clean(p.paymentDate || p.createdAt);
}

function dealPayments(dealId, includeDeleted=false) {
  const source = includeDeleted ? allPayments : payments;
  return source
    .filter(p => p.dealId === dealId)
    .filter(p => includeDeleted || (!p.isDeleted && clean(p.status) !== "void"))
    .sort((a,b) => String(paymentDateValue(b)).localeCompare(String(paymentDateValue(a))) || byDateDesc(a,b));
}

function dealPaidAmount(dealId) {
  return dealPayments(dealId).reduce((sum,p) => sum + Number(p.amount || 0), 0);
}

function dealDebtAmount(d) {
  return Math.max(0, dealAmount(d) - dealPaidAmount(d.id));
}

function canSeePayment(p = {}) {
  const d = p.dealId ? deals.find(item => item.id === p.dealId) : null;
  const c = d?.customerId ? customerById(d.customerId) : null;
  return isManager() || sameIdentity(p.createdByEmail, ownerEmail()) || sameIdentity(p.ownerEmail, ownerEmail()) || ownerMatchesCurrentUser(d) || ownerMatchesCurrentUser(c);
}

function canVoidPayment() {
  return isManager();
}

function printDocStyle() {
  return `
    <style>
      *{box-sizing:border-box}
      body{font-family:Arial,"Segoe UI",sans-serif;color:#061633;margin:0;background:#fff;font-size:13px;line-height:1.45}
      .page{width:210mm;min-height:297mm;margin:0 auto;padding:18mm}
      .top{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #147a68;padding-bottom:12px;margin-bottom:18px}
      .brand{font-size:22px;font-weight:800;color:#147a68}
      .muted{color:#64748b}
      h1{text-align:center;margin:18px 0 4px;font-size:24px;text-transform:uppercase}
      .doc-no{text-align:center;color:#64748b;margin-bottom:18px}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;margin:14px 0}
      .box{border:1px solid #d8e1ee;border-radius:8px;padding:12px;margin:12px 0}
      .line{display:flex;justify-content:space-between;gap:16px;padding:5px 0;border-bottom:1px dashed #e5edf7}
      .line:last-child{border-bottom:0}
      table{width:100%;border-collapse:collapse;margin-top:12px}
      th,td{border:1px solid #d8e1ee;padding:8px;text-align:left;vertical-align:top}
      th{background:#eef7ff}
      .total{font-size:18px;font-weight:800;color:#087443;text-align:right}
      .signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:44px;text-align:center}
      .signatures b{display:block;margin-bottom:54px}
      @page{size:A4;margin:0}
      @media print{.page{margin:0;box-shadow:none}.no-print{display:none}}
    </style>
  `;
}

function openPrintDocument(title, bodyHtml) {
  const win = window.open("", "_blank", "width=920,height=720");
  if (!win) return notice("Trình duyệt đang chặn cửa sổ in. Hãy cho phép popup rồi thử lại.", true);
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>${printDocStyle()}</head><body>${bodyHtml}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 350);
}

function printHeader(title, docNo) {
  return `
    <div class="top">
      <div>
        <div class="brand">Kolorceraic THT</div>
        <div class="muted">CRM nội bộ · Chứng từ bán hàng</div>
      </div>
      <div style="text-align:right">
        <b>Ngày in: ${esc(new Date().toLocaleString("vi-VN"))}</b>
        <div class="muted">Người in: ${esc(ownerName() || ownerEmail())}</div>
      </div>
    </div>
    <h1>${esc(title)}</h1>
    <div class="doc-no">Số chứng từ: ${esc(docNo || "-")}</div>
  `;
}

async function printPaymentReceipt(paymentId) {
  const p = payments.find(item => item.id === paymentId) || allPayments.find(item => item.id === paymentId);
  if (!p) return notice("Không tìm thấy thanh toán để in phiếu thu.", true);
  if (!canSeePayment(p)) return notice("Bạn không có quyền in phiếu thu này.", true);
  const d = deals.find(item => item.id === p.dealId) || {};
  const c = customerById(p.customerId || d.customerId);
  const docNo = p.paymentNo || p.id;
  openPrintDocument(`Phiếu thu ${docNo}`, `
    <div class="page">
      ${printHeader("Phiếu thu", docNo)}
      <div class="box">
        <div class="grid">
          <div><b>Khách hàng:</b> ${esc(p.customerName || orderCustomerName(d) || c.name || "")}</div>
          <div><b>SĐT:</b> ${esc(c.phoneRaw || c.phoneNormalized || orderCustomerPhone(d) || "")}</div>
          <div><b>Công ty:</b> ${esc(c.companyName || "")}</div>
          <div><b>Nhân viên:</b> ${esc(p.owner || orderOwnerName(d) || "")}</div>
          <div><b>Ngày thu:</b> ${esc(fmtDate(p.paymentDate || p.createdAt) || "")}</div>
          <div><b>Hình thức:</b> ${esc(p.method || "")}</div>
        </div>
      </div>
      <div class="box">
        <div class="line"><span>Đơn hàng</span><b>${esc(orderProductText(d) || d.id || "")}</b></div>
        <div class="line"><span>Giá trị đơn</span><b>${esc(money(dealAmount(d)))}</b></div>
        <div class="line"><span>Số tiền thu</span><b>${esc(money(p.amount || 0))}</b></div>
        <div class="line"><span>Ghi chú</span><span>${esc(p.note || "")}</span></div>
      </div>
      <div class="total">Đã thu: ${esc(money(p.amount || 0))}</div>
      <div class="signatures">
        <div><b>Người lập phiếu</b><span>(Ký, ghi rõ họ tên)</span></div>
        <div><b>Người nộp tiền</b><span>(Ký, ghi rõ họ tên)</span></div>
        <div><b>Quản lý</b><span>(Ký, ghi rõ họ tên)</span></div>
      </div>
    </div>
  `);
  await logAudit("printPaymentReceipt", "payments", paymentId, {paymentNo: docNo, amount: p.amount || 0}).catch(() => {});
}

async function printDeliveryNote(dealId) {
  const d = deals.find(item => item.id === dealId);
  if (!d) return notice("Không tìm thấy đơn hàng để in phiếu giao.", true);
  if (!isManager() && !ownerMatchesCurrentUser(d) && !ownerMatchesCurrentUser(customerById(d.customerId))) {
    return notice("Bạn không có quyền in phiếu giao đơn này.", true);
  }
  const c = customerById(d.customerId);
  const stats = deliveryStats(d);
  const docNo = `PG-${String(d.id || "").slice(0, 8).toUpperCase()}`;
  const rows = dealOrderItems(d);
  openPrintDocument(`Phiếu giao ${docNo}`, `
    <div class="page">
      ${printHeader("Phiếu giao hàng", docNo)}
      <div class="box">
        <div class="grid">
          <div><b>Khách hàng:</b> ${esc(orderCustomerName(d) || c.name || "")}</div>
          <div><b>SĐT:</b> ${esc(orderCustomerPhone(d) || c.phoneRaw || c.phoneNormalized || "")}</div>
          <div><b>Công ty:</b> ${esc(c.companyName || "")}</div>
          <div><b>Nhân viên:</b> ${esc(orderOwnerName(d) || "")}</div>
          <div><b>Địa chỉ giao:</b> ${esc(d.deliveryAddress || c.address || "")}</div>
          <div><b>Ngày hẹn/giao:</b> ${esc(fmtDate(d.deliveryDate || d.deliveredAt) || "")}</div>
          <div><b>Trạng thái:</b> ${esc(deliveryStatusLabel(stats.status))}</div>
          <div><b>Tiến độ:</b> ${esc(`${stats.delivered}/${stats.total || "-"}`)}</div>
        </div>
      </div>
      <table>
        <thead><tr><th>STT</th><th>Sản phẩm</th><th>Mã</th><th>SL đơn</th><th>Đã giao</th><th>Còn giao</th><th>Đơn vị</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((item, index) => {
            const qty = Math.max(0, qtyNumber(item.qty));
            const delivered = Math.max(0, Number(item.deliveredQty || 0));
            return `<tr>
              <td>${esc(index + 1)}</td>
              <td>${esc(item.productName || item.product || item.productLabel || "Sản phẩm")}</td>
              <td>${esc(item.productSku || item.code || "")}</td>
              <td>${esc(qty || item.qty || 0)}</td>
              <td>${esc(delivered)}</td>
              <td>${esc(Math.max(0, qty - delivered))}</td>
              <td>${esc(item.unit || item.size || "")}</td>
            </tr>`;
          }).join("") : `<tr><td colspan="7">Chưa có sản phẩm.</td></tr>`}
        </tbody>
      </table>
      <div class="box">
        <b>Ghi chú:</b>
        <div>${esc(d.deliveryNote || d.note || "")}</div>
      </div>
      <div class="signatures">
        <div><b>Người giao</b><span>(Ký, ghi rõ họ tên)</span></div>
        <div><b>Người nhận</b><span>(Ký, ghi rõ họ tên)</span></div>
        <div><b>Quản lý</b><span>(Ký, ghi rõ họ tên)</span></div>
      </div>
    </div>
  `);
  await logAudit("printDeliveryNote", "deals", dealId, {docNo, deliveryStatus: stats.status}).catch(() => {});
}

function orderCustomerName(d) {
  const c = customerById(d.customerId);
  return clean(d.orderCustomerName || d.customerName || c.name || c.companyName);
}

function orderCustomerPhone(d) {
  const c = customerById(d.customerId);
  return clean(d.orderCustomerPhone || d.orderPhone || d.phoneRaw || d.phoneNormalized || c.phoneRaw || c.phoneNormalized);
}

function orderOwnerName(d) {
  const c = customerById(d.customerId);
  const profile = ownerProfileByValue(d.ownerEmail || d.owner || customerOwnerKey(c));
  return clean(profile.name) || clean(d.owner) || customerOwnerName(c);
}

function orderOwnerEmail(d) {
  const c = customerById(d.customerId);
  return clean(d.ownerEmail || customerOwnerKey(c));
}

function orderStatusKey(d) {
  if (d.completed === true || sameLabel(normalizeDealStatus(d.dealStatus), "boughtStatus")) return "bought";
  if (isCanceledDeal(d.dealStatus) || isFailStatus(d.dealStatus)) return "canceled";
  if (sameLabel(normalizeDealStatus(d.dealStatus), "depositStatus")) return "deposit";
  return "open";
}

function orderStatusLabel(d) {
  const key = orderStatusKey(d);
  if (key === "bought") return systemLabel("boughtStatus");
  if (key === "deposit") return systemLabel("depositStatus");
  if (key === "canceled") return normalizeDealStatus(d.dealStatus) || systemLabel("canceledStatus");
  return normalizeDealStatus(d.dealStatus) || "Đang xử lý";
}

function visibleOrderDeals() {
  return deals
    .filter(d => !d.isDeleted)
    .filter(d => isManager() || sameIdentity(orderOwnerEmail(d), ownerEmail()) || sameIdentity(d.owner, ownerName()))
    .sort((a,b) => String(orderDate(b)).localeCompare(String(orderDate(a))) || byDateDesc(a,b));
}

function hydrateOrderFilters() {
  if (!$("orderFilterYear")) return;
  const yearCurrent = $("orderFilterYear").value;
  const monthCurrent = $("orderFilterMonth").value;
  const ownerCurrent = $("orderFilterOwner").value;
  const statusCurrent = $("orderFilterStatus").value;
  const years = uniq([String(new Date().getFullYear()), ...visibleOrderDeals().map(d => orderDate(d).slice(0,4)).filter(Boolean)]).sort((a,b) => b.localeCompare(a));
  fillSelect("orderFilterYear", years, "", "Tất cả năm");
  fillSelect("orderFilterMonth", Array.from({length:12}, (_,i) => ({value:String(i + 1).padStart(2,"0"), label:`Tháng ${String(i + 1).padStart(2,"0")}`})), "", "Tất cả tháng");
  fillSelect("orderFilterOwner", ownerOptions(), "", "Tất cả nhân viên");
  fillSelect("orderFilterStatus", [
    {value:"open", label:"Đang xử lý"},
    {value:"deposit", label:systemLabel("depositStatus")},
    {value:"bought", label:systemLabel("boughtStatus")},
    {value:"canceled", label:systemLabel("canceledStatus")}
  ], "", "Tất cả trạng thái");
  if (years.includes(yearCurrent) || yearCurrent === "") $("orderFilterYear").value = yearCurrent;
  if (/^\d{2}$/.test(monthCurrent) || monthCurrent === "") $("orderFilterMonth").value = monthCurrent;
  if (ownerOptions().some(o => clean(o.email) === ownerCurrent || clean(o.name) === ownerCurrent) || ownerCurrent === "") $("orderFilterOwner").value = ownerCurrent;
  if (["open","deposit","bought","canceled",""].includes(statusCurrent)) $("orderFilterStatus").value = statusCurrent;
  if (!isManager()) {
    $("orderFilterOwner").value = ownerEmail();
    $("orderFilterOwner").disabled = true;
  }
}

function filteredOrderDeals() {
  const year = clean($("orderFilterYear")?.value);
  const month = clean($("orderFilterMonth")?.value);
  const owner = clean($("orderFilterOwner")?.value);
  const status = clean($("orderFilterStatus")?.value);
  return visibleOrderDeals().filter(d => {
    const iso = orderDate(d);
    if (year && iso.slice(0,4) !== year) return false;
    if (month && iso.slice(5,7) !== month) return false;
    if (owner && normalizeKey(orderOwnerEmail(d)) !== normalizeKey(owner) && normalizeKey(orderOwnerName(d)) !== normalizeKey(owner)) return false;
    if (status && orderStatusKey(d) !== status) return false;
    return true;
  });
}

function resetOrderFilters() {
  ["orderFilterYear","orderFilterMonth","orderFilterStatus"].forEach(id => $(id).value = "");
  $("orderFilterOwner").value = isManager() ? "" : ownerEmail();
  renderOrders();
}

function activeOrderFilterLabel() {
  const parts = [
    selectedOptionText("orderFilterYear") ? `Năm: ${selectedOptionText("orderFilterYear")}` : "",
    selectedOptionText("orderFilterMonth") ? `Tháng: ${selectedOptionText("orderFilterMonth")}` : "",
    selectedOptionText("orderFilterOwner") ? `Nhân viên: ${selectedOptionText("orderFilterOwner")}` : "",
    selectedOptionText("orderFilterStatus") ? `Trạng thái: ${selectedOptionText("orderFilterStatus")}` : ""
  ].filter(Boolean);
  return parts.length ? parts.join(" | ") : "Tất cả đơn hàng";
}

function openOrderSummaryDetail(type) {
  const rows = filteredOrderDeals();
  const openRows = rows.filter(d => orderStatusKey(d) === "open");
  const depositRows = rows.filter(d => orderStatusKey(d) === "deposit");
  const boughtRows = rows.filter(d => orderStatusKey(d) === "bought");
  const canceledRows = rows.filter(d => orderStatusKey(d) === "canceled");
  const deliveryPendingRows = rows.filter(d => deliveryStats(d).status === "none" && orderStatusKey(d) !== "canceled");
  const deliveryPartialRows = rows.filter(d => deliveryStats(d).status === "partial");
  const deliveryDoneRows = rows.filter(d => deliveryStats(d).status === "done");
  const paidRows = rows.filter(d => dealPaidAmount(d.id) > 0);
  const debtRows = rows.filter(d => dealDebtAmount(d) > 0);
  const customerIds = new Set();
  rows.forEach(d => {
    const key = d.customerId || `${orderCustomerPhone(d)}:${orderCustomerName(d)}`;
    if (key) customerIds.add(key);
  });
  const config = {
    all: ["Tất cả đơn hàng", rows],
    open: ["Đơn đang xử lý", openRows],
    deposit: [systemLabel("depositStatus"), depositRows],
    bought: [systemLabel("boughtStatus"), boughtRows],
    canceled: [systemLabel("canceledStatus"), canceledRows],
    totalValue: ["Tổng giá trị đơn hàng", rows],
    boughtValue: ["Giá trị đã mua", boughtRows],
    depositValue: ["Giá trị đang cọc", depositRows],
    openValue: ["Giá trị đang xử lý", openRows],
    deliveryPending: ["Chờ giao", deliveryPendingRows],
    deliveryPartial: ["Giao thiếu", deliveryPartialRows],
    deliveryDone: ["Giao đủ", deliveryDoneRows],
    customers: ["Khách đã giao dịch", rows],
    avgValue: ["Giá trị trung bình / đơn", rows],
    paidValue: ["Đã thu", paidRows],
    debtValue: ["Còn nợ", debtRows]
  }[type];
  if (!config) return;
  const [title, detailRows] = config;
  const total = type === "paidValue"
    ? detailRows.reduce((sum,d) => sum + dealPaidAmount(d.id), 0)
    : type === "debtValue"
      ? detailRows.reduce((sum,d) => sum + dealDebtAmount(d), 0)
      : detailRows.reduce((sum,d) => sum + dealAmount(d), 0);
  const extra = type === "customers" ? ` · ${customerIds.size} khách` : total ? ` · Tổng ${money(total)}` : "";
  openDetailModal(
    title,
    `${detailRows.length} đơn${extra} · ${activeOrderFilterLabel()}`,
    dealDetailRows([...detailRows].sort((a,b) => String(orderDate(b)).localeCompare(String(orderDate(a))) || byDateDesc(a,b)))
  );
}

function hydratePaymentDealOptions() {
  const el = $("paymentDeal");
  if (!el) return;
  const current = el.value;
  const rows = filteredOrderDeals();
  el.innerHTML = `<option value="">-- Chọn đơn hàng --</option>` + rows.map(d => {
    const debt = dealDebtAmount(d);
    const label = `${orderCustomerName(d) || "Không tên"} · ${money(dealAmount(d))} · Còn nợ ${money(debt)}`;
    return `<option value="${esc(d.id)}">${esc(label)}</option>`;
  }).join("");
  if (rows.some(d => d.id === current)) el.value = current;
}

function clearPaymentForm() {
  if (!$("paymentDeal")) return;
  $("paymentDeal").value = "";
  $("paymentDate").value = todayIso();
  $("paymentAmount").value = "";
  $("paymentMethod").value = "Chuyển khoản";
  $("paymentNote").value = "";
}

function selectPaymentDeal(dealId) {
  const d = deals.find(item => item.id === dealId);
  if (!d || !$("paymentDeal")) return;
  hydratePaymentDealOptions();
  $("paymentDeal").value = d.id;
  $("paymentDate").value = $("paymentDate").value || todayIso();
  const debt = dealDebtAmount(d);
  $("paymentAmount").value = debt > 0 ? debt : dealAmount(d);
  $("paymentNote").focus();
  $("paymentDeal").scrollIntoView({behavior:"smooth", block:"center"});
}

function filteredPayments() {
  const dealIds = new Set(filteredOrderDeals().map(d => d.id));
  return payments
    .filter(p => dealIds.has(p.dealId))
    .sort((a,b) => String(paymentDateValue(b)).localeCompare(String(paymentDateValue(a))) || byDateDesc(a,b));
}

function renderPayments() {
  if (!$("paymentRows")) return;
  hydratePaymentDealOptions();
  if (!$("paymentDate").value) $("paymentDate").value = todayIso();
  const orderRows = filteredOrderDeals();
  const totalDebt = orderRows.reduce((sum,d) => sum + dealDebtAmount(d), 0);
  const totalPaid = orderRows.reduce((sum,d) => sum + dealPaidAmount(d.id), 0);
  $("paymentSummaryText").textContent = `${orderRows.length} đơn · Đã thu ${money(totalPaid)} · Còn nợ ${money(totalDebt)}`;
  const rows = filteredPayments();
  $("paymentRows").innerHTML = rows.length ? rows.map(p => {
    const d = deals.find(item => item.id === p.dealId) || {};
    return `
      <tr>
        <td><b>${esc(p.paymentNo || p.id)}</b></td>
        <td>${esc(p.customerName || orderCustomerName(d) || "Không tên")}</td>
        <td>${esc(orderProductText(d) || d.id || "")}</td>
        <td>${esc(fmtDate(p.paymentDate || p.createdAt) || "")}</td>
        <td><b class="money-cell">${esc(money(p.amount || 0))}</b></td>
        <td>${esc(p.method || "")}</td>
        <td>${esc(p.receivedByEmail || p.createdByEmail || "")}</td>
        <td>${esc(p.note || "")}</td>
        <td>
          <div class="actions">
            <button class="small" type="button" data-print-payment="${esc(p.id)}">In phiếu thu</button>
            ${canVoidPayment(p) ? `<button class="small danger" type="button" data-delete-payment="${esc(p.id)}">Xóa mềm</button>` : ""}
          </div>
        </td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="9" class="muted">Chưa có thanh toán phù hợp với bộ lọc.</td></tr>`;
}

async function savePayment() {
  const dealId = clean($("paymentDeal")?.value);
  const d = deals.find(item => item.id === dealId);
  if (!d) return notice("Hãy chọn đơn hàng cần ghi nhận thanh toán.", true);
  const c = customerById(d.customerId);
  if (!isManager() && !ownerMatchesCurrentUser(d) && !ownerMatchesCurrentUser(c)) {
    return notice("Bạn không có quyền ghi nhận thanh toán cho đơn này.", true);
  }
  const amount = Number($("paymentAmount")?.value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return notice("Số tiền thanh toán phải lớn hơn 0.", true);
  const id = doc(collection(db, "payments")).id;
  const payload = {
    paymentNo: paymentNo(),
    dealId: d.id,
    quoteId: d.quoteId || "",
    customerId: d.customerId || "",
    customerName: orderCustomerName(d),
    owner: orderOwnerName(d),
    ownerEmail: orderOwnerEmail(d),
    amount,
    method: clean($("paymentMethod")?.value) || "Chuyển khoản",
    status: "paid",
    paymentDate: clean($("paymentDate")?.value) || todayIso(),
    receivedByEmail: ownerEmail(),
    note: clean($("paymentNote")?.value),
    isDeleted: false,
    createdByEmail: ownerEmail(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(doc(db, "payments", id), payload);
  await logAudit("createPayment", "payments", id, {
    dealId: d.id,
    customerId: d.customerId || "",
    amount,
    paymentDate: payload.paymentDate
  }).catch(() => {});
  clearPaymentForm();
  renderOrders();
  notice("Đã ghi nhận thanh toán.");
}

async function softDeletePayment(id) {
  const p = allPayments.find(item => item.id === id) || payments.find(item => item.id === id);
  if (!p) return;
  if (!canVoidPayment(p)) return notice("Chỉ admin/manager được xóa mềm khoản thanh toán.", true);
  if (!confirm("Xóa mềm khoản thanh toán này? Khoản này sẽ không còn được tính vào đã thu.")) return;
  await setDoc(doc(db, "payments", id), {
    ...p,
    status: "void",
    isDeleted: true,
    deletedAt: serverTimestamp(),
    deletedByEmail: ownerEmail(),
    updatedAt: serverTimestamp()
  }, {merge:true});
  await logAudit("softDeletePayment", "payments", id, {
    dealId: p.dealId || "",
    amount: p.amount || 0
  }).catch(() => {});
  notice("Đã xóa mềm khoản thanh toán.");
}

function renderOrders() {
  if (!$("ordersPanel")) return;
  hydrateOrderFilters();
  const rows = filteredOrderDeals();
  const openRows = rows.filter(d => orderStatusKey(d) === "open");
  const depositRows = rows.filter(d => orderStatusKey(d) === "deposit");
  const boughtRows = rows.filter(d => orderStatusKey(d) === "bought");
  const canceledRows = rows.filter(d => orderStatusKey(d) === "canceled");
  const deliveryPendingRows = rows.filter(d => deliveryStats(d).status === "none" && orderStatusKey(d) !== "canceled");
  const deliveryPartialRows = rows.filter(d => deliveryStats(d).status === "partial");
  const deliveryDoneRows = rows.filter(d => deliveryStats(d).status === "done");
  const customersSet = new Set(rows.map(d => d.customerId || `${orderCustomerPhone(d)}:${orderCustomerName(d)}`).filter(Boolean));
  const totalValue = rows.reduce((sum,d) => sum + dealAmount(d), 0);
  const boughtValue = boughtRows.reduce((sum,d) => sum + dealAmount(d), 0);
  const depositValue = depositRows.reduce((sum,d) => sum + dealAmount(d), 0);
  const openValue = openRows.reduce((sum,d) => sum + dealAmount(d), 0);
  const paidValue = rows.reduce((sum,d) => sum + dealPaidAmount(d.id), 0);
  const debtValue = rows.reduce((sum,d) => sum + dealDebtAmount(d), 0);
  const avgValue = rows.length ? Math.round(totalValue / rows.length) : 0;
  const cards = [
    ["Tổng đơn", rows.length, "", "all"],
    ["Đang xử lý", openRows.length, openRows.length ? "warn" : "", "open"],
    [systemLabel("depositStatus"), depositRows.length, depositRows.length ? "warn" : "", "deposit"],
    [systemLabel("boughtStatus"), boughtRows.length, "", "bought"],
    [systemLabel("canceledStatus"), canceledRows.length, canceledRows.length ? "bad" : "", "canceled"],
    ["Tổng giá trị", money(totalValue), "", "totalValue"],
    ["Giá trị đã mua", money(boughtValue), "", "boughtValue"],
    ["Giá trị đang cọc", money(depositValue), depositValue ? "warn" : "", "depositValue"],
    ["Giá trị đang xử lý", money(openValue), openValue ? "warn" : "", "openValue"],
    ["Đã thu", money(paidValue), "", "paidValue"],
    ["Còn nợ", money(debtValue), debtValue ? "bad" : "", "debtValue"],
    ["Chờ giao", deliveryPendingRows.length, deliveryPendingRows.length ? "warn" : "", "deliveryPending"],
    ["Giao thiếu", deliveryPartialRows.length, deliveryPartialRows.length ? "warn" : "", "deliveryPartial"],
    ["Giao đủ", deliveryDoneRows.length, "", "deliveryDone"],
    ["Khách đã giao dịch", customersSet.size, "", "customers"],
    ["Giá trị TB/đơn", money(avgValue), "", "avgValue"]
  ];
  $("orderSummaryGrid").innerHTML = cards.map(([label,value,cls,type]) => `
    <div class="executive-card order-summary-card clickable ${esc(cls)}" role="button" tabindex="0" data-order-summary="${esc(type)}">
      <span class="muted">${esc(label)}</span>
      <b>${esc(value)}</b>
    </div>
  `).join("");
  $("orderRows").innerHTML = rows.length ? rows.map(d => {
    const c = customerById(d.customerId);
    const statusKey = orderStatusKey(d);
    const statusClass = statusKey === "bought" ? "green" : statusKey === "canceled" ? "red" : statusKey === "deposit" ? "orange" : "blue";
    const productText = orderProductText(d);
    const paidAmount = dealPaidAmount(d.id);
    const debtAmount = dealDebtAmount(d);
    const ship = deliveryStats(d);
    const dateMeta = [
      `Đơn: ${fmtDate(d.dealDate || d.createdAt) || "-"}`,
      d.completedAt ? `Mua: ${fmtDate(d.completedAt)}` : "",
      d.deliveryDate ? `Giao: ${fmtDate(d.deliveryDate)}` : ""
    ].filter(Boolean).join(" · ");
    return `
      <tr class="order-row ${statusKey === "bought" ? "order-bought" : statusKey === "canceled" ? "order-canceled" : statusKey === "deposit" ? "order-deposit" : ""}">
        <td>
          <div class="customer-cell">
            <b>${esc(orderCustomerName(d) || "Không tên")}</b>
            ${c.companyName ? `<span>${esc(c.companyName)}</span>` : ""}
          </div>
        </td>
        <td><div class="phone-cell"><b>${esc(orderCustomerPhone(d) || "Không SĐT")}</b></div></td>
        <td>
          <b>${esc(orderOwnerName(d))}</b>
          <div class="muted">${esc(orderOwnerEmail(d))}</div>
        </td>
        <td><span class="pill ${statusClass}">${esc(orderStatusLabel(d))}</span></td>
        <td colspan="3">
          <div class="order-date-stack">${esc(dateMeta)}</div>
          <span class="pill ${deliveryStatusClass(ship.status)}">${esc(deliveryStatusLabel(ship.status))}</span>
          <div class="muted">Đã giao ${esc(ship.delivered)} / ${esc(ship.total || "-")}</div>
        </td>
        <td>
          <div class="order-product-text">${esc(productText || "Chưa có sản phẩm")}</div>
          ${ship.remaining ? `<div class="muted">Còn giao: ${esc(ship.remaining)}</div>` : ""}
        </td>
        <td>
          <b class="money-cell">${esc(money(d.amount || 0))}</b>
          <div class="debt-cell">
            <span class="paid-positive">Đã thu: ${esc(money(paidAmount))}</span>
            <span class="${debtAmount ? "debt-positive" : ""}">Còn nợ: ${esc(money(debtAmount))}</span>
          </div>
        </td>
        <td><div class="order-note">${esc(d.note || "")}</div></td>
        <td>
          <div class="order-actions">
            <button class="small" type="button" data-open-care="${esc(d.customerId)}">Mở khách</button>
            <button class="small" type="button" data-review-deal="${esc(d.id)}">Chi tiết</button>
            <button class="small" type="button" data-delivery-deal="${esc(d.id)}">Giao hàng</button>
            <button class="small" type="button" data-print-delivery="${esc(d.id)}">Phiếu giao</button>
            <button class="small" type="button" data-pay-deal="${esc(d.id)}">Thanh toán</button>
            ${canEditDeal(d) ? `<button class="small primary" type="button" data-edit-deal="${esc(d.id)}">Sửa</button>` : ""}
            ${canEditDeal(d) && (isActiveDeal(d) || statusKey === "deposit") ? `<button class="small primary" type="button" data-complete-deal="${esc(d.id)}">Hoàn thành</button><button class="small danger" type="button" data-cancel-deal="${esc(d.id)}">Hủy</button>` : ""}
            ${isManager() ? `<button class="small danger" type="button" data-delete-deal="${esc(d.id)}">Xóa mềm</button>` : ""}
          </div>
        </td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="11" class="muted">Chưa có đơn hàng phù hợp với bộ lọc.</td></tr>`;
  renderPayments();
}

function renderReportCenter() {
  if (!$("reportsPanel") || !isManager()) return;
  const month = currentMonth();
  const reportCustomers = currentReportCustomers();
  const monthCustomers = reportCustomers.filter(c => monthOf(c.createdAt) === month);
  const dueCare = reportCustomers.filter(c => isCareDue(c));
  const overdueCare = reportCustomers.filter(c => isCareOverdue(c));
  const reportIds = new Set(reportCustomers.map(c => c.id));
  const monthCareLogs = careLogs.filter(l => !l.isDeleted && reportIds.has(l.customerId) && monthOf(careLogActivityDate(l)) === month);
  const boughtCustomers = reportCustomers.filter(c => basicPurchaseCountFor(c) > 0);
  const purchaseValue = reportCustomers.reduce((sum, c) => sum + basicPurchaseValueFor(c), 0);
  const pendingKpi = operationalKpiPendingCount();
  const legacyPendingKpi = legacyVisiblePendingCount();
  const cards = [
    ["Khách đang quản lý", reportCustomers.length, "", "managed-customers"],
    ["Khách mới tháng này", monthCustomers.length, "", "month-customers"],
    ["Cần chăm", dueCare.length, dueCare.length ? "warn" : "", "due-care"],
    ["Quá hạn chăm", overdueCare.length, overdueCare.length ? "warn" : "", "overdue-care"],
    ["Lượt chăm tháng", monthCareLogs.length, "", "month-care"],
    ["Khách đã mua căn bản", boughtCustomers.length, "", "bought-customers"],
    ["Giá trị mua căn bản", money(purchaseValue), "", "purchase-value"],
    [legacyKpiPreCutover() ? "KPI chờ duyệt" : "KPI hiện tại cần duyệt", pendingKpi, pendingKpi ? "warn" : "", "pending-kpi"],
    ...(!legacyKpiPreCutover() ? [["KPI cũ đang đóng sổ", legacyPendingKpi, legacyPendingKpi ? "warn" : "", "legacy-pending-kpi"]] : [])
  ];
  $("reportCenterTime").textContent = `Cập nhật ${new Date().toLocaleString("vi-VN")}`;
  $("reportCenterGrid").innerHTML = cards.map(([label,value,cls,action]) => {
    return `
    <div class="executive-card report-card ${esc(cls)} clickable" role="button" tabindex="0" data-dashboard-action="${esc(action)}">
      <span class="muted">${esc(label)}</span>
      <b>${esc(value)}</b>
    </div>
  `;}).join("");
  renderSaleActivityReport();
}

function hydrateErpReportFilters() {
  if (!$("erpReportMonth")) return;
  if (!$("erpReportMonth").dataset.ready) {
    $("erpReportMonth").value ||= currentMonth();
    $("erpReportMonth").dataset.ready = "1";
  }
  const ownerCurrent = $("erpReportOwner").value;
  fillSelect("erpReportOwner", ownerOptions(), "", "Tất cả nhân viên");
  if (ownerOptions().some(o => clean(o.email) === ownerCurrent || clean(o.name) === ownerCurrent) || ownerCurrent === "") $("erpReportOwner").value = ownerCurrent;
}

function resetErpReportFilters() {
  $("erpReportMonth").value = "";
  $("erpReportOwner").value = "";
  renderErpReport();
}

function selectedErpReportRange() {
  const month = clean($("erpReportMonth")?.value);
  return month ? monthRange(month) : null;
}

function erpOwnerMatches(item, ownerFilter) {
  if (!ownerFilter) return true;
  return sameIdentity(item.ownerEmail, ownerFilter) || sameIdentity(item.owner, ownerFilter) || sameIdentity(item.createdByEmail, ownerFilter);
}

function erpReportDeals() {
  const range = selectedErpReportRange();
  const ownerFilter = clean($("erpReportOwner")?.value);
  return currentReportDeals()
    .filter(d => !d.isDeleted)
    .filter(d => !range || inDateRange(d.dealDate || d.createdAt, range) || inDateRange(d.completedAt, range))
    .filter(d => erpOwnerMatches(d, ownerFilter));
}

function erpReportPayments() {
  const range = selectedErpReportRange();
  const ownerFilter = clean($("erpReportOwner")?.value);
  return payments
    .filter(p => !range || inDateRange(p.paymentDate || p.createdAt, range))
    .filter(p => erpOwnerMatches(p, ownerFilter));
}

function erpReportLabel() {
  const range = selectedErpReportRange();
  const owner = selectedOptionText("erpReportOwner");
  return [range ? range.label : "tất cả thời gian", owner ? `nhân viên ${owner}` : ""].filter(Boolean).join(" · ");
}

function productSalesRows(dealRows) {
  const map = new Map();
  dealRows
    .filter(d => !isCanceledDeal(d.dealStatus) && !isFailStatus(d.dealStatus))
    .forEach(d => {
      dealOrderItems(d).forEach(item => {
        const key = clean(item.productId) || normalizeKey(item.productSku || item.productName || item.product || item.productLabel || "Khác");
        const cur = map.get(key) || {productId:item.productId || "", name:item.productName || item.product || item.productLabel || "Khác", sku:item.productSku || item.code || "", qty:0, delivered:0, revenue:0, deals:new Set()};
        cur.qty += Math.max(0, qtyNumber(item.qty));
        cur.delivered += Math.max(0, Number(item.deliveredQty || 0));
        cur.revenue += Number(item.lineTotal || 0);
        cur.deals.add(d.id);
        map.set(key, cur);
      });
    });
  return [...map.values()].map(r => ({...r, deals:r.deals.size})).sort((a,b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 12);
}

function erpRiskRows(dealRows) {
  const rows = [];
  dealRows.filter(d => dealDebtAmount(d) > 0).slice(0, 20).forEach(d => rows.push({
    type:"Công nợ",
    title: orderCustomerName(d) || "Khách hàng",
    note: `Còn nợ ${money(dealDebtAmount(d))}`,
    action: d.id
  }));
  dealRows.filter(d => deliveryStats(d).status === "partial").slice(0, 20).forEach(d => rows.push({
    type:"Giao thiếu",
    title: orderCustomerName(d) || "Khách hàng",
    note: `Còn giao ${deliveryStats(d).remaining}`,
    action: d.id
  }));
  products.filter(p => productInventoryQty(p) <= 0).slice(0, 20).forEach(p => rows.push({
    type: productInventoryQty(p) < 0 ? "Âm kho" : "Hết tồn",
    title: p.name || productSku(p) || "Sản phẩm",
    note: `Tồn ${productInventoryQty(p)}`,
    productId: p.id
  }));
  return rows.slice(0, 30);
}

function renderErpReport() {
  if (!$("erpReportGrid")) return;
  hydrateErpReportFilters();
  const dealRows = erpReportDeals();
  const paymentRows = erpReportPayments();
  const completed = dealRows.filter(isCompletedDeal);
  const active = dealRows.filter(isActiveDeal);
  const paid = paymentRows.reduce((sum,p) => sum + Number(p.amount || 0), 0);
  const totalValue = dealRows.reduce((sum,d) => sum + dealAmount(d), 0);
  const completedValue = completed.reduce((sum,d) => sum + dealAmount(d), 0);
  const debt = dealRows.reduce((sum,d) => sum + dealDebtAmount(d), 0);
  const partialDelivery = dealRows.filter(d => deliveryStats(d).status === "partial");
  const pendingDelivery = dealRows.filter(d => deliveryStats(d).status === "none" && orderStatusKey(d) !== "canceled");
  const stockNegative = products.filter(p => productInventoryQty(p) < 0);
  const stockZero = products.filter(p => productInventoryQty(p) === 0);
  $("erpReportRangeText").textContent = erpReportLabel();
  $("erpReportGrid").innerHTML = [
    ["Tổng giá trị đơn", money(totalValue), ""],
    ["Doanh thu hoàn thành", money(completedValue), ""],
    ["Đã thu", money(paid), ""],
    ["Còn công nợ", money(debt), debt ? "bad" : ""],
    ["Đơn đang xử lý", active.length, active.length ? "warn" : ""],
    ["Giao thiếu", partialDelivery.length, partialDelivery.length ? "warn" : ""],
    ["Chờ giao", pendingDelivery.length, pendingDelivery.length ? "warn" : ""],
    ["Âm kho / Hết tồn", `${stockNegative.length} / ${stockZero.length}`, stockNegative.length || stockZero.length ? "bad" : ""]
  ].map(([label,value,cls]) => `
    <div class="executive-card report-card ${esc(cls)}">
      <span class="muted">${esc(label)}</span>
      <b>${esc(value)}</b>
    </div>
  `).join("");

  const topProducts = productSalesRows(dealRows);
  $("topProductSummary").textContent = `${topProducts.length} sản phẩm`;
  $("topProductTable").innerHTML = topProducts.length ? `
    <table class="admin-table">
      <thead><tr><th>Sản phẩm</th><th>SL bán</th><th>Đã giao</th><th>Số đơn</th><th>Tồn hiện tại</th></tr></thead>
      <tbody>${topProducts.map(p => {
        const product = products.find(item => item.id === p.productId || normalizeKey(productSku(item)) === normalizeKey(p.sku) || normalizeKey(item.name) === normalizeKey(p.name));
        return `<tr>
          <td><b>${esc(p.name)}</b><div class="muted">${esc(p.sku || "")}</div></td>
          <td>${esc(p.qty)}</td>
          <td>${esc(p.delivered)}</td>
          <td>${esc(p.deals)}</td>
          <td>${esc(product ? productInventoryQty(product) : "")}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>
  ` : `<div class="muted" style="padding:12px">Chưa có dữ liệu sản phẩm bán trong kỳ.</div>`;

  const risks = erpRiskRows(dealRows);
  $("erpRiskSummary").textContent = `${risks.length} cảnh báo`;
  $("erpRiskList").innerHTML = risks.length ? risks.map(r => `
    <div class="activity-mini ${r.type === "Công nợ" || r.type === "Âm kho" ? "bad" : "deal"}">
      <div class="activity-mini-head">
        <b>${esc(r.type)} · ${esc(r.title)}</b>
        ${r.action ? `<button class="small" type="button" data-review-deal="${esc(r.action)}">Mở đơn</button>` : r.productId ? `<button class="small" type="button" data-inventory-product="${esc(r.productId)}">Mở kho</button>` : ""}
      </div>
      <div class="muted">${esc(r.note)}</div>
    </div>
  `).join("") : `<div class="muted">Không có cảnh báo vận hành trong dữ liệu hiện tại.</div>`;
}

function hydrateSaleActivityFilters() {
  if (!$("reportActivityOwner")) return;
  if (!$("reportActivityMonth").value && !$("reportActivityWeek").value) $("reportActivityMonth").value = currentMonth();
  const currentOwner = $("reportActivityOwner").value;
  fillSelect("reportActivityOwner", ownerOptions(), "", "Tất cả nhân viên");
  if (ownerOptions().some(o => clean(o.email) === currentOwner || clean(o.name) === currentOwner) || currentOwner === "") $("reportActivityOwner").value = currentOwner;
}

function resetSaleActivityFilters() {
  $("reportActivityWeek").value = "";
  $("reportActivityMonth").value = currentMonth();
  $("reportActivitySearch").value = "";
  $("reportActivityOwner").value = "";
  resetPaging("saleActivity");
  renderSaleActivityReport();
}

function saleActivityRows() {
  const range = selectedActivityReportRange();
  const ownerFilter = clean($("reportActivityOwner")?.value);
  const key = normalizeKey($("reportActivitySearch")?.value || "");
  const rows = [];

  customers
    .filter(canSeeCustomer)
    .filter(c => !isCustomerClosed(c))
    .filter(c => ownerMatchesKey({owner:c.owner, ownerEmail:c.ownerEmail}, ownerFilter))
    .forEach(c => {
      const taskType = taskTypeForCustomer(c);
      rows.push({
        date: clean(c.nextCareDate) || "",
        type: `Việc ${taskLabel(taskType)}`,
        owner: customerOwnerName(c),
        ownerEmail: customerOwnerKey(c),
        customer: c.name || "",
        phone: c.phoneRaw || c.phoneNormalized || "",
        companyName: c.companyName || "",
        channel: c.channel || "",
        status: c.status || "",
        amount: "",
        note: c.need || c.note || "",
        bucket: "task",
        taskType,
        customerId: c.id
      });
    });

  careLogs
    .filter(l => !l.isDeleted && inDateRange(careLogActivityDate(l), range) && ownerMatchesKey(l, ownerFilter))
    .forEach(l => {
      const c = customerById(l.customerId);
      rows.push({
        date: isoFromAny(careLogActivityDate(l)),
        type: "Chăm sóc",
        owner: l.owner || customerOwnerName(c) || l.ownerEmail,
        ownerEmail: l.ownerEmail || customerOwnerKey(c),
        customer: l.customerName || c.name || "",
        phone: c.phoneRaw || l.phoneRaw || l.phoneNormalized || c.phoneNormalized || "",
        companyName: l.companyName || c.companyName || "",
        channel: c.channel || "",
        status: l.status || c.status || "",
        amount: "",
        note: [l.careChannel, l.careResult, l.showroomVisit ? "Đến showroom" : "", l.note].filter(Boolean).join(" · "),
        bucket: "care",
        customerId: l.customerId
      });
    });

  deals
    .filter(d => !d.isDeleted && inDateRange(d.dealDate || d.createdAt, range) && ownerMatchesKey(d, ownerFilter))
    .forEach(d => {
      const c = customerById(d.customerId);
      rows.push({
        date: isoFromAny(d.dealDate || d.createdAt),
        type: "Ghi nhận mua căn bản",
        owner: orderOwnerName(d),
        ownerEmail: orderOwnerEmail(d),
        customer: orderCustomerName(d),
        phone: orderCustomerPhone(d),
        companyName: c.companyName || "",
        channel: c.channel || d.channel || "",
        status: orderStatusLabel(d),
        amount: dealAmount(d),
        note: orderProductText(d) || d.note || "",
        bucket: "deal",
        customerId: d.customerId
      });
    });

  deals
    .filter(d => !d.isDeleted && isCompletedDeal(d) && inDateRange(d.completedAt || d.dealDate || d.createdAt, range) && ownerMatchesKey(d, ownerFilter))
    .forEach(d => {
      const c = customerById(d.customerId);
      rows.push({
        date: isoFromAny(d.completedAt || d.dealDate || d.createdAt),
        type: "Khách đã mua",
        owner: orderOwnerName(d),
        ownerEmail: orderOwnerEmail(d),
        customer: orderCustomerName(d),
        phone: orderCustomerPhone(d),
        companyName: c.companyName || "",
        channel: c.channel || d.channel || "",
        status: orderStatusLabel(d),
        amount: dealAmount(d),
        note: orderProductText(d) || d.note || "",
        bucket: "completed",
        customerId: d.customerId
      });
    });

  const filtered = key ? rows.filter(r => normalizeKey([r.type,r.owner,r.ownerEmail,r.customer,r.phone,r.companyName,r.channel,r.status,r.note].join(" ")).includes(key)) : rows;
  return {range, rows: filtered.sort((a,b) => String(b.date).localeCompare(String(a.date)) || String(a.owner).localeCompare(String(b.owner), "vi"))};
}

function saleActivitySummary(rows) {
  const map = new Map();
  rows.forEach(r => {
    const id = clean(r.ownerEmail || r.owner || "Không rõ");
    const cur = map.get(id) || {owner: r.owner || id, ownerEmail: r.ownerEmail || "", taskOpen:0, taskOverdue:0, care:0, deal:0, completed:0, revenue:0};
    if (r.bucket === "task") {
      cur.taskOpen += 1;
      if (r.taskType === "overdue") cur.taskOverdue += 1;
    }
    if (r.bucket === "care") cur.care += 1;
    if (r.bucket === "deal") cur.deal += 1;
    if (r.bucket === "completed") {
      cur.completed += 1;
      cur.revenue += Number(r.amount || 0);
    }
    map.set(id, cur);
  });
  return [...map.values()].sort((a,b) => b.taskOverdue - a.taskOverdue || b.care - a.care || b.revenue - a.revenue);
}

function renderSaleActivityReport() {
  if (!$("saleActivitySummary")) return;
  hydrateSaleActivityFilters();
  const {range, rows} = saleActivityRows();
  const summary = saleActivitySummary(rows);
  const metrics = {
    total: rows.length,
    taskOverdue: rows.filter(r => r.bucket === "task" && r.taskType === "overdue").length,
    care: rows.filter(r => r.bucket === "care").length,
    deal: rows.filter(r => r.bucket === "deal").length,
    completed: rows.filter(r => r.bucket === "completed").length,
    revenue: rows.filter(r => r.bucket === "completed").reduce((sum,r) => sum + Number(r.amount || 0), 0)
  };
  if ($("saleActivityMetrics")) {
    $("saleActivityMetrics").innerHTML = [
      ["Tổng hoạt động", metrics.total, ""],
      ["Việc quá hạn", metrics.taskOverdue, metrics.taskOverdue ? "bad" : ""],
      ["Chăm sóc", metrics.care, ""],
      ["Ghi nhận mua", metrics.deal, ""],
      ["Khách đã mua", metrics.completed, ""],
      ["Giá trị mua", money(metrics.revenue), ""]
    ].map(([label,value,cls]) => `
      <div class="report-metric ${esc(cls)}">
        <span>${esc(label)}</span>
        <b>${esc(value)}</b>
      </div>
    `).join("");
  }
  $("saleActivitySummary").innerHTML = summary.length ? `
    <table class="admin-table">
      <thead><tr><th>Nhân viên</th><th>Việc mở</th><th>Quá hạn</th><th>Chăm sóc</th><th>Ghi nhận mua</th><th>Khách đã mua</th><th>Giá trị mua</th></tr></thead>
      <tbody>${summary.map(s => `
        <tr>
          <td><b>${esc(s.owner)}</b><div class="muted">${esc(s.ownerEmail)}</div></td>
          <td>${esc(s.taskOpen)}</td>
          <td>${s.taskOverdue ? `<span class="pill red">${esc(s.taskOverdue)}</span>` : "0"}</td>
          <td>${esc(s.care)}</td>
          <td>${esc(s.deal)}</td>
          <td>${esc(s.completed)}</td>
          <td><b>${esc(money(s.revenue))}</b></td>
        </tr>
      `).join("")}</tbody>
    </table>
  ` : `<div class="muted" style="padding:12px">Không có hoạt động trong khoảng ${esc(range.label)}.</div>`;
  const timelinePage = pageRows("saleActivity", rows);
  $("saleActivityTimeline").innerHTML = timelinePage.length ? timelinePage.map(r => {
    const cls = r.bucket === "deal" || r.bucket === "completed" ? "deal" : r.taskType === "overdue" ? "bad" : "care";
    return `
    <div class="activity-mini report-activity ${esc(cls)}">
      <div class="activity-mini-head">
        <div>
          <span class="activity-type">${esc(r.type)}</span>
          <b>${esc(r.customer || "Không tên")}</b>
        </div>
        <span class="muted">${esc(fmtDate(r.date) || "")}</span>
      </div>
      <div class="report-activity-meta">
        <span>${esc(r.owner || "Không rõ NV")}</span>
        <span>${esc(r.phone || "Không SĐT")}</span>
        ${r.channel ? `<span>${esc(r.channel)}</span>` : ""}
      </div>
      <div class="report-activity-body">${r.amount ? `<b>${esc(money(r.amount))}</b> · ` : ""}${esc(r.note || "Không có ghi chú.")}</div>
      ${r.customerId ? `<div class="actions"><button class="small" type="button" data-care-open="${esc(r.customerId)}">Mở khách</button></div>` : ""}
    </div>
  `;}).join("") : `<div class="muted">Không có timeline hoạt động phù hợp.</div>`;
  renderPager("saleActivityPager", "saleActivity", rows.length, "hoạt động");
}

async function exportOrders() {
  if (!canExportData()) return notice("Bạn chưa có quyền xuất file.", true);
  const rows = filteredOrderDeals();
  if (!rows.length) return notice("Không có đơn hàng phù hợp với bộ lọc hiện tại.", true);
  const header = ["Khách hàng","Tên công ty","SĐT","Nhân viên / Email","Trạng thái","Ngày đơn","Ngày mua","Hẹn giao","Trạng thái giao","Đã giao","Tổng SL","Còn giao","Sản phẩm","Giá trị","Đã thu","Còn nợ","Ghi chú"];
  const dataRows = [
    [`Báo cáo đơn hàng - ${activeOrderFilterLabel()}`, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    header,
    ...rows.map(d => {
      const c = customerById(d.customerId);
      const ship = deliveryStats(d);
      return [
        orderCustomerName(d),
        c.companyName || "",
        orderCustomerPhone(d),
        [orderOwnerName(d), orderOwnerEmail(d)].filter(Boolean).join(" / "),
        orderStatusLabel(d),
        fmtDate(d.dealDate || d.createdAt),
        fmtDate(d.completedAt),
        fmtDate(d.deliveryDate),
        deliveryStatusLabel(ship.status),
        ship.delivered,
        ship.total,
        ship.remaining,
        orderProductText(d),
        d.amount || 0,
        dealPaidAmount(d.id),
        dealDebtAmount(d),
        d.note || ""
      ];
    })
  ];
  const exported = exportXlsx([{ name: "Don hang", rows: dataRows }], `crm-don-hang-${new Date().toISOString().slice(0,10)}`);
  if (exported) {
    await logAudit("exportOrders", "exports", "orders", {
      rows: rows.length,
      filter: activeOrderFilterLabel()
    }).catch(err => notice("File đã xuất, nhưng chưa ghi được audit log: " + authMessage(err), true));
  }
}

async function exportErpReport() {
  if (!isManager()) return notice("Chỉ admin/manager được xuất báo cáo ERP mini.", true);
  const dealRows = erpReportDeals();
  const paymentRows = erpReportPayments();
  const completed = dealRows.filter(isCompletedDeal);
  const active = dealRows.filter(isActiveDeal);
  const paid = paymentRows.reduce((sum,p) => sum + Number(p.amount || 0), 0);
  const totalValue = dealRows.reduce((sum,d) => sum + dealAmount(d), 0);
  const completedValue = completed.reduce((sum,d) => sum + dealAmount(d), 0);
  const debt = dealRows.reduce((sum,d) => sum + dealDebtAmount(d), 0);
  const partialDelivery = dealRows.filter(d => deliveryStats(d).status === "partial");
  const pendingDelivery = dealRows.filter(d => deliveryStats(d).status === "none" && orderStatusKey(d) !== "canceled");
  const stockNegative = products.filter(p => productInventoryQty(p) < 0);
  const stockZero = products.filter(p => productInventoryQty(p) === 0);
  const summaryRows = [
    ["Báo cáo ERP mini", erpReportLabel()],
    ["Thời điểm xuất", new Date().toLocaleString("vi-VN")],
    ["Người xuất", currentUser?.email || ""],
    ["Tổng giá trị đơn", totalValue],
    ["Doanh thu hoàn thành", completedValue],
    ["Đã thu", paid],
    ["Còn công nợ", debt],
    ["Đơn đang xử lý", active.length],
    ["Giao thiếu", partialDelivery.length],
    ["Chờ giao", pendingDelivery.length],
    ["Âm kho", stockNegative.length],
    ["Hết tồn", stockZero.length]
  ];
  const productRows = [
    ["Sản phẩm", "Mã", "SL bán", "Đã giao", "Số đơn", "Tồn hiện tại"],
    ...productSalesRows(dealRows).map(p => {
      const product = products.find(item => item.id === p.productId || normalizeKey(productSku(item)) === normalizeKey(p.sku) || normalizeKey(item.name) === normalizeKey(p.name));
      return [p.name, p.sku, p.qty, p.delivered, p.deals, product ? productInventoryQty(product) : ""];
    })
  ];
  const riskRows = [
    ["Loại", "Tên", "Ghi chú"],
    ...erpRiskRows(dealRows).map(r => [r.type, r.title, r.note])
  ];
  const debtRows = [
    ["Khách hàng", "SĐT", "Nhân viên", "Trạng thái giao", "Giá trị", "Đã thu", "Còn nợ", "Còn giao"],
    ...dealRows.filter(d => dealDebtAmount(d) > 0 || deliveryStats(d).status !== "done").map(d => {
      const ship = deliveryStats(d);
      return [
        orderCustomerName(d),
        orderCustomerPhone(d),
        orderOwnerName(d),
        deliveryStatusLabel(ship.status),
        dealAmount(d),
        dealPaidAmount(d.id),
        dealDebtAmount(d),
        ship.remaining
      ];
    })
  ];
  const exported = exportXlsx([
    {name:"Tong quan ERP", rows:summaryRows},
    {name:"San pham ban chay", rows:productRows},
    {name:"Canh bao", rows:riskRows},
    {name:"Cong no giao hang", rows:debtRows}
  ], `crm-erp-mini-${clean($("erpReportMonth")?.value) || "tat-ca"}`);
  if (exported) {
    await logAudit("exportErpReport", "exports", "erpReport", {
      label: erpReportLabel(),
      deals: dealRows.length,
      payments: paymentRows.length
    }).catch(err => notice("File đã xuất, nhưng chưa ghi được audit log: " + authMessage(err), true));
  }
}

function activityRowsForExport() {
  const range = selectedReportRange();
  const ownerFilter = clean($("filterOwner").value);
  const rows = [];

  careLogs
    .filter(l => !l.isDeleted && inDateRange(careLogActivityDate(l), range) && exportOwnerMatches(l, ownerFilter))
    .forEach(l => {
      const c = customerById(l.customerId);
      rows.push({
        date: isoFromAny(careLogActivityDate(l)),
        type: "Chăm sóc KH",
        owner: l.owner || customerOwnerName(c) || l.ownerEmail,
        customer: l.customerName || c.name || "",
        companyName: l.companyName || c.companyName || "",
        phone: c.phoneRaw || l.phoneNormalized || c.phoneNormalized || "",
        channel: c.channel || "",
        status: l.status || c.status || "",
        follow: l.follow || computedFollowStatus(c),
        careChannel: l.careChannel || "",
        careResult: l.careResult || "",
        nextCareDate: l.nextCareDate || "",
        dealStatus: "",
        amount: "",
        note: [l.showroomVisit ? "Đến showroom" : "", l.note].filter(Boolean).join(" · ")
      });
    });

  deals
    .filter(d => !d.isDeleted && inDateRange(d.dealDate || d.createdAt, range) && exportOwnerMatches(d, ownerFilter))
    .forEach(d => {
      const c = customerById(d.customerId);
      rows.push({
        date: isoFromAny(d.dealDate || d.createdAt),
        type: "Đơn hàng",
        owner: d.owner || customerOwnerName(c) || d.ownerEmail,
        customer: d.orderCustomerName || d.customerName || c.name || "",
        companyName: c.companyName || "",
        phone: d.orderCustomerPhone || d.phoneNormalized || c.phoneRaw || c.phoneNormalized || "",
        channel: c.channel || "",
        status: c.status || "",
        follow: computedFollowStatus(c),
        careChannel: "",
        careResult: "",
        nextCareDate: d.deliveryDate || "",
        dealStatus: normalizeDealStatus(d.dealStatus || ""),
        amount: d.amount || "",
        note: [d.product, d.note].filter(Boolean).join(" - ")
      });
    });

  customers
    .filter(c => canSeeCustomer(c) && inDateRange(c.nextCareDate, range) && exportOwnerMatches(c, ownerFilter))
    .forEach(c => {
      rows.push({
        date: clean(c.nextCareDate),
        type: "Lịch hẹn chăm",
        owner: customerOwnerName(c),
        customer: c.name || "",
        companyName: c.companyName || "",
        phone: c.phoneRaw || c.phoneNormalized || "",
        channel: c.channel || "",
        status: c.status || "",
        follow: computedFollowStatus(c),
        careChannel: "",
        careResult: "",
        nextCareDate: c.nextCareDate || "",
        dealStatus: "",
        amount: "",
        note: c.note || ""
      });
    });

  return {range, rows: rows.sort((a,b) => String(a.date).localeCompare(String(b.date)) || String(a.owner).localeCompare(String(b.owner), "vi"))};
}

async function exportSaleActivityReport() {
  if (!canExportData()) return notice("Bạn chưa có quyền xuất file.", true);
  const {range, rows} = saleActivityRows();
  const summary = saleActivitySummary(rows);
  if (!rows.length) return notice("Không có hoạt động phù hợp để xuất.", true);
  const summaryRows = [
    [`Báo cáo hoạt động sale - ${range.label}`, "", "", "", "", "", "", ""],
    ["Nhân viên","Email","Việc mở","Việc quá hạn","Chăm sóc","Ghi nhận mua","Khách đã mua","Giá trị mua"],
    ...summary.map(s => [s.owner, s.ownerEmail, s.taskOpen, s.taskOverdue, s.care, s.deal, s.completed, s.revenue])
  ];
  const detailRows = [
    [`Chi tiết hoạt động - ${range.label}`, "", "", "", "", "", "", "", "", ""],
    ["Ngày","Loại","Nhân viên","Email","Khách hàng","SĐT","Công ty","Kênh","Trạng thái","Giá trị","Ghi chú"],
    ...rows.map(r => [fmtDate(r.date), r.type, r.owner, r.ownerEmail, r.customer, r.phone, r.companyName, r.channel, r.status, r.amount || "", r.note])
  ];
  const exported = exportXlsx([
    {name:"Tong hop sale", rows:summaryRows},
    {name:"Chi tiet hoat dong", rows:detailRows}
  ], `crm-hoat-dong-sale-${range.start}-${range.end}`);
  if (exported) {
    await logAudit("exportSaleActivityReport", "exports", "saleActivity", {
      rows: rows.length,
      start: range.start,
      end: range.end,
      label: range.label
    }).catch(err => notice("File đã xuất, nhưng chưa ghi được audit log: " + authMessage(err), true));
  }
}

function selectedOptionText(id) {
  const el = $(id);
  if (!el || !clean(el.value)) return "";
  return clean(el.options?.[el.selectedIndex]?.textContent || el.value);
}

function activeCustomerFilterLabel() {
  const parts = [
    clean($("searchBox").value) ? `Tìm kiếm: ${clean($("searchBox").value)}` : "",
    selectedOptionText("filterOwner") ? `Nhân viên: ${selectedOptionText("filterOwner")}` : "",
    selectedOptionText("filterStatus") ? `Trạng thái: ${selectedOptionText("filterStatus")}` : "",
    selectedOptionText("filterDealStatus") ? `Mua căn bản: ${selectedOptionText("filterDealStatus")}` : "",
    selectedOptionText("filterFollow") ? `Tình trạng chăm: ${selectedOptionText("filterFollow")}` : "",
    selectedOptionText("filterChannel") ? `Kênh chi tiết: ${selectedOptionText("filterChannel")}` : "",
    channelQuickLabel() ? `Lọc nhanh: ${channelQuickLabel()}` : "",
    clean($("filterWeek").value) ? `Tuần: ${clean($("filterWeek").value)}` : "",
    !clean($("filterWeek").value) && clean($("filterMonth").value) ? `Tháng: ${clean($("filterMonth").value)}` : ""
  ].filter(Boolean);
  return parts.length ? parts.join(" | ") : "Tất cả khách hàng";
}

async function exportCsv() {
  if (!canExportData()) return notice("Bạn chưa có quyền xuất file.", true);
  const rows = visibleCustomers();
  if (!rows.length) return notice("Không có khách hàng phù hợp với bộ lọc hiện tại.", true);
  const filterLabel = activeCustomerFilterLabel();
  const header = ["Khách hàng","Tên công ty","SĐT","Ngày tạo","Kênh chi tiết","Loại khách","Phụ trách","Trạng thái","Tình trạng chăm","Mức tiềm năng","Đến showroom","Số lần mua","Giá trị mua","Hẹn chăm","Nhu cầu","Ghi chú"];
  const dataRows = [
    [`Danh sách khách hàng - ${filterLabel}`, "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    header,
    ...rows.map(c => [
      c.name || "",
      c.companyName || "",
      c.phoneRaw || c.phoneNormalized || "",
      fmtDate(c.createdAt),
      canonicalChannel(c.channel),
      c.customerType || "",
      customerOwnerName(c),
      c.status || "",
      computedFollowStatus(c),
      potentialLevelFor(c),
      showroomVisitCountFor(c),
      basicPurchaseCountFor(c),
      basicPurchaseValueFor(c),
      fmtDate(c.nextCareDate),
      c.need || "",
      c.note || ""
    ])
  ];
  const exported = exportXlsx([{ name: "Khach hang", rows: dataRows }], `crm-khach-hang-theo-bo-loc-${new Date().toISOString().slice(0,10)}`);
  if (exported) {
    await logAudit("exportCustomers", "exports", "customers", {
      rows: rows.length,
      filter: filterLabel
    }).catch(err => notice("File đã xuất, nhưng chưa ghi được audit log: " + authMessage(err), true));
  }
}

function setViewHidden(id, hidden) {
  const el = $(id);
  if (!el) return;
  if (hidden && el.contains(document.activeElement)) {
    document.activeElement?.blur?.();
  }
  el.classList.toggle("hide", hidden);
  el.toggleAttribute("inert", hidden);
  if (hidden) el.setAttribute("aria-hidden", "true");
  else el.removeAttribute("aria-hidden");
}

function renderAdminDashboard() {
  renderAdminShell();
  if (!$("adminDashboardGrid")) return;
  const managedCustomers = allCustomers.length ? allCustomers : customers;
  const monthCustomers = managedCustomers.filter(c => monthOf(c.createdAt) === currentMonth() && !c.isDeleted).length;
  const dueCare = managedCustomers.filter(c => !c.isDeleted && isCareDue(c)).length;
  const pendingKpi = operationalKpiPendingCount();
  const legacyPendingKpi = legacyVisiblePendingCount();
  const activeUsers = users.filter(u => u.active !== false).length;
  const warnings = [
    managedCustomers.filter(c => !clean(c.ownerEmail) && !clean(c.owner)).length ? "Có khách thiếu phụ trách" : "",
    dueCare ? "Có khách cần chăm sóc" : "",
    auditLogs.length ? "" : "Chưa tải được audit log"
  ].filter(Boolean);
  const cards = [
    ["Tổng khách hàng", managedCustomers.filter(c => !c.isDeleted).length, "Dữ liệu khách đang quản lý"],
    ["Khách mới tháng này", monthCustomers, "Khách được tạo trong tháng"],
    ["Khách cần chăm", dueCare, "Theo logic hẹn chăm hiện tại", dueCare ? "warn" : ""],
    [legacyKpiPreCutover() ? "KPI chờ duyệt" : "KPI hiện tại cần duyệt", pendingKpi, "Đề xuất KPI-2 cần admin/manager xử lý", pendingKpi ? "warn" : ""],
    ...(!legacyKpiPreCutover() ? [["KPI cũ đang đóng sổ", legacyPendingKpi, "Proposal legacy pending tạo trước 01/09/2026", legacyPendingKpi ? "warn" : ""]] : []),
    ["User hoạt động", activeUsers, "Tài khoản active"],
    ["Cảnh báo", warnings.length, warnings.join(" · ") || "Chưa có cảnh báo nổi bật", warnings.length ? "warn" : ""]
  ];
  $("adminDashboardGrid").innerHTML = cards.map(([label, value, note, cls]) => `
    <div class="admin-dashboard-card ${esc(cls || "")}">
      <span>${esc(label)}</span>
      <b>${esc(value)}</b>
      <div class="muted">${esc(note)}</div>
    </div>
  `).join("");
  if ($("adminUserText")) $("adminUserText").textContent = `${currentUser?.email || ""} · ${appUser?.role || ""}`;
}

function renderAdminShell() {
  const route = currentAdminRoute();
  const meta = adminRoutes[route] || adminRoutes["/admin"];
  document.querySelectorAll("[data-admin-page]").forEach(page => {
    page.classList.toggle("hide", page.dataset.adminPage !== meta.key);
  });
  document.querySelectorAll("[data-admin-route]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.adminRoute === route);
  });
  const title = document.querySelector(".admin-header h1");
  const subtitle = document.querySelector(".admin-header p");
  if (title) title.textContent = meta.title;
  if (subtitle) subtitle.textContent = meta.subtitle;
  if ($("adminUserText")) $("adminUserText").textContent = `${currentUser?.email || ""} · ${appUser?.role || ""}`;
  if (meta.key === "users") renderUserAdmin();
  if (meta.key === "categories") renderAdminCategorySettingsForm();
  if (meta.key === "settings") renderCompanySettingsForm();
  if (meta.key === "audit-logs") renderAdminAuditPage();
}

function showLogin() {
  stopPresence();
  stopWatchers();
  setViewHidden("loginView", false);
  setViewHidden("appView", true);
  setViewHidden("adminAppView", true);
  $("onlinePanel").classList.add("hide");
  if (location.protocol === "file:") $("localWarning").classList.remove("hide");
}

function showApp() {
  if (isAdminRoute()) {
    if (!canAccessAdminPanel()) {
      window.history.replaceState({}, "", "/");
      showApp();
      notice("Bạn không có quyền vào khu vực admin.", true);
      return;
    }
    setViewHidden("loginView", true);
    setViewHidden("appView", true);
    setViewHidden("adminAppView", false);
    renderAdminShell();
    renderAdminDashboard();
    return;
  }
  setViewHidden("loginView", true);
  setViewHidden("appView", false);
  setViewHidden("adminAppView", true);
  $("onlinePanel").classList.toggle("hide", !isAdmin());
  $("userText").textContent = currentUser.email || currentUser.displayName || "";
  $("roleText").textContent = `Vai trò: ${appUser.role || "sale"} · Tên hiển thị: ${ownerName()}`;
  // Trình duyệt đôi khi tự khôi phục input type=month sau khi deploy. Chủ động xoá để mặc định là xem tất cả.
  $("filterWeek").value = "";
  $("filterMonth").value = "";
  $("kpiRuleMonth").value ||= currentMonth();
  hydrateSelects();
  renderAll();
}

async function loginEmailPassword() {
  try {
    $("loginError").textContent = "";
    pendingLoginSuccessNotice = true;
    await signInWithEmailAndPassword(auth, clean($("loginEmail").value), $("loginPassword").value);
  } catch (err) {
    pendingLoginSuccessNotice = false;
    $("loginError").textContent = authMessage(err);
  }
}

async function loginGoogle() {
  try {
    $("loginError").textContent = "Đang mở đăng nhập Google...";
    if (location.protocol === "file:") throw {code:"auth/unauthorized-domain"};
    pendingLoginSuccessNotice = true;
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    pendingLoginSuccessNotice = false;
    $("loginError").textContent = authMessage(err);
  }
}

async function reloadApp() {
  try {
    await loadSettings();
    if (canAccessAdminPanel()) await loadCompanySettings();
    await refreshKpiCutoverState({render:false});
    watchData();
    renderAll();
    notice("Đã tải lại settings và dữ liệu mới nhất.");
  } catch (err) {
    notice(authMessage(err), true);
  }
}

function resetFilters() {
  activeChannelQuickFilter = "";
  selectedUnassignedCustomerIds.clear();
  ["searchBox","filterOwner","filterStatus","filterDealStatus","filterFollow","filterSource","filterChannel","filterCustomerType"].forEach(id => {
    if (!(id === "filterOwner" && !isManager())) $(id).value = "";
  });
  hydrateFilterChannelOptions();
  $("filterWeek").value = "";
  $("filterMonth").value = "";
  $("kpiRuleMonth").value = currentMonth();
  resetPaging("customers");
  renderAll();
}

document.addEventListener("click", e => {
  const careId = e.target.closest("[data-open-care]")?.dataset.openCare || e.target.closest("[data-care-open]")?.dataset.careOpen;
  const dealId = e.target.closest("[data-open-deal]")?.dataset.openDeal;
  const taskSnoozeBtn = e.target.closest("[data-task-snooze]");
  const completeDealId = e.target.closest("[data-complete-deal]")?.dataset.completeDeal;
  const cancelDealId = e.target.closest("[data-cancel-deal]")?.dataset.cancelDeal;
  const deleteDealId = e.target.closest("[data-delete-deal]")?.dataset.deleteDeal;
  const editDealId = e.target.closest("[data-edit-deal]")?.dataset.editDeal;
  const reviewDealId = e.target.closest("[data-review-deal]")?.dataset.reviewDeal;
  const pipelineLabel = e.target.closest("[data-pipeline-detail]")?.dataset.pipelineDetail;
  const editKpiRuleId = e.target.closest("[data-edit-kpi-rule]")?.dataset.editKpiRule;
  const disableKpiRuleId = e.target.closest("[data-disable-kpi-rule]")?.dataset.disableKpiRule;
  const activateKpiRuleId = e.target.closest("[data-activate-kpi-rule]")?.dataset.activateKpiRule;
  const kpiRuleExplainId = e.target.closest("[data-kpi-rule-explain]")?.dataset.kpiRuleExplain;
  const kpiRuleProposalId = e.target.closest("[data-kpi-rule-proposals]")?.dataset.kpiRuleProposals;
  const kpiOwnerDetailBtn = e.target.closest("[data-kpi-owner-detail]");
  const kpi1SelectPeriodId = e.target.closest("[data-kpi1-select-period]")?.dataset.kpi1SelectPeriod;
  const kpi1RenamePeriodId = e.target.closest("[data-kpi1-rename-period]")?.dataset.kpi1RenamePeriod;
  const kpi1EditDefinitionId = e.target.closest("[data-kpi1-edit-definition]")?.dataset.kpi1EditDefinition;
  const kpi1ToggleDefinitionId = e.target.closest("[data-kpi1-toggle-definition]")?.dataset.kpi1ToggleDefinition;
  const kpi1SaveMatrixId = e.target.closest("[data-kpi1-save-matrix]")?.dataset.kpi1SaveMatrix;
  const kpiTeamMode = e.target.closest("[data-kpi-team-mode]")?.dataset.kpiTeamMode;
  const kpiTeamEmployeeBtn = e.target.closest("[data-kpi-team-open-employee]");
  const kpiTeamAssignEmployeeId = e.target.closest("[data-kpi-team-assign-employee]")?.dataset.kpiTeamAssignEmployee;
  const kpiTeamEmployeeTab = e.target.closest("[data-kpi-employee-tab]")?.dataset.kpiEmployeeTab;
  const kpiTeamEventFilter = e.target.closest("[data-kpi-team-event-filter]")?.dataset.kpiTeamEventFilter;
  const kpiTeamOpenEventBtn = e.target.closest("[data-kpi-team-open-event]");
  const kpiTeamRetry = e.target.closest("[data-kpi-team-retry]")?.dataset.kpiTeamRetry;
  const kpiTeamDetailKpi = e.target.closest("[data-kpi-team-detail-kpi]")?.dataset.kpiTeamDetailKpi;
  const kpiTeamReviewBtn = e.target.closest("#kpiTeamReviewBtn");
  const kpi2ClaimId = e.target.closest("[data-kpi2-open-claim]")?.dataset.kpi2OpenClaim;
  const kpi2RevisionId = e.target.closest("[data-kpi2-open-revision]")?.dataset.kpi2OpenRevision;
  const kpi2EvidenceEventId = e.target.closest("[data-kpi2-view-evidence]")?.dataset.kpi2ViewEvidence;
  const kpi2DiscardEvidenceId = e.target.closest("[data-kpi2-discard-evidence]")?.dataset.kpi2DiscardEvidence;
  const kpiProposalDetailId = e.target.closest("[data-kpi-proposal-detail]")?.dataset.kpiProposalDetail;
  const editKpiProposalId = e.target.closest("[data-edit-kpi-proposal]")?.dataset.editKpiProposal;
  const customerKpiProposalId = e.target.closest("[data-open-kpi-proposal-customer]")?.dataset.openKpiProposalCustomer;
  const softDeleteKpiProposalId = e.target.closest("[data-soft-delete-kpi-proposal]")?.dataset.softDeleteKpiProposal;
  const deleteKpiProposalId = e.target.closest("[data-delete-kpi-proposal]")?.dataset.deleteKpiProposal;
  const approveKpiProposalId = e.target.closest("[data-approve-kpi-proposal]")?.dataset.approveKpiProposal;
  const rejectKpiProposalId = e.target.closest("[data-reject-kpi-proposal]")?.dataset.rejectKpiProposal;
  const editCareLogId = e.target.closest("[data-edit-care-log]")?.dataset.editCareLog;
  const deleteCareLogId = e.target.closest("[data-delete-care-log]")?.dataset.deleteCareLog;
  const restoreCustomerId = e.target.closest("[data-restore-customer]")?.dataset.restoreCustomer;
  const permanentDeleteCustomerId = e.target.closest("[data-permanent-delete-customer]")?.dataset.permanentDeleteCustomer;
  const saveUserId = e.target.closest("[data-save-user]")?.dataset.saveUser;
  const toggleUserId = e.target.closest("[data-toggle-user]")?.dataset.toggleUser;
  const deleteUserId = e.target.closest("[data-delete-user]")?.dataset.deleteUser;
  const confirmDeactivateEmployeeId = e.target.closest("[data-confirm-deactivate-employee]")?.dataset.confirmDeactivateEmployee;
  const copyPhone = e.target.closest("[data-copy-phone]")?.dataset.copyPhone;
  const dashboardAction = e.target.closest("[data-dashboard-action]")?.dataset.dashboardAction;
  const orderSummary = e.target.closest("[data-order-summary]")?.dataset.orderSummary;
  const careWorkDetail = e.target.closest("[data-care-work-detail]")?.dataset.careWorkDetail;
  const channelQuick = e.target.closest("[data-channel-quick]")?.dataset.channelQuick;
  const loadMoreKey = e.target.closest("[data-load-more]")?.dataset.loadMore;
  if (loadMoreKey) loadMorePage(loadMoreKey);
  if (channelQuick) {
    activeChannelQuickFilter = activeChannelQuickFilter === channelQuick ? "" : channelQuick;
    $("filterChannel").value = "";
    resetPaging("customers");
    renderCustomers();
  }
  if (orderSummary) openOrderSummaryDetail(orderSummary);
  if (careWorkDetail) openCareWorkDetail(careWorkDetail);
  if (dashboardAction === "due-care" || dashboardAction === "overdue-care") openCareDashboardDetail(dashboardAction);
  if (["managed-customers","month-customers","no-date-care","showroom-visits","bought-customers"].includes(dashboardAction)) openDashboardCustomerDetail(dashboardAction);
  if (["pending-deals","completed-deals","month-revenue","deposit-deals","canceled-deals"].includes(dashboardAction)) openDashboardDealDetail(dashboardAction);
  if (["month-care","purchase-value"].includes(dashboardAction)) openDashboardActivityDetail(dashboardAction);
  if (dashboardAction === "pending-kpi") jumpToPendingKpi();
  if (dashboardAction === "legacy-pending-kpi") jumpToLegacyPendingKpi();
  if (careId) {
    closeDetailModal();
    openDrawer(careId, "care");
  }
  if (dealId) openDrawer(dealId, "deal");
  if (taskSnoozeBtn) snoozeTask(taskSnoozeBtn.dataset.taskSnooze, Number(taskSnoozeBtn.dataset.days || 1));
  if (copyPhone) { navigator.clipboard?.writeText(copyPhone); notice("Đã copy SĐT."); }
  if (completeDealId) completeDeal(completeDealId);
  if (cancelDealId) cancelDeal(cancelDealId);
  if (deleteDealId) softDeleteDeal(deleteDealId);
  if (editDealId) editDeal(editDealId);
  if (reviewDealId) reviewDeal(reviewDealId);
  if (pipelineLabel) openPipelineDetail(pipelineLabel);
  if (editKpiRuleId) editKpiRule(editKpiRuleId);
  if (disableKpiRuleId) disableKpiRule(disableKpiRuleId);
  if (activateKpiRuleId) activateKpiRule(activateKpiRuleId);
  if (kpiRuleExplainId) openKpiRuleExplanation(kpiRuleExplainId);
  if (kpiRuleProposalId) openKpiRuleProposals(kpiRuleProposalId);
  if (kpiOwnerDetailBtn) openKpiOwnerDetail(kpiOwnerDetailBtn.dataset.kpiOwnerDetail, kpiOwnerDetailBtn.dataset.ownerKey);
  if (kpi1SelectPeriodId) selectKpi1Period(kpi1SelectPeriodId);
  if (kpi1RenamePeriodId) runAction(`kpi1Rename:${kpi1RenamePeriodId}`, "kpi1Rename", "Đang lưu...", () => renameKpi1Period(kpi1RenamePeriodId));
  if (kpi1EditDefinitionId) editKpi1Definition(kpi1EditDefinitionId);
  if (kpi1ToggleDefinitionId) runAction(`kpi1Toggle:${kpi1ToggleDefinitionId}`, "kpi1Toggle", "Đang cập nhật...", () => toggleKpi1Definition(kpi1ToggleDefinitionId));
  if (kpi1SaveMatrixId) runAction(`kpi1Matrix:${kpi1SaveMatrixId}`, "kpi1Matrix", "Đang lưu ma trận...", () => saveKpi1MatrixRow(kpi1SaveMatrixId));
  if (kpiTeamMode) setKpiTeamMode(kpiTeamMode);
  if (kpiTeamEmployeeBtn) openKpiTeamEmployee(kpiTeamEmployeeBtn.dataset.kpiTeamOpenEmployee, kpiTeamEmployeeBtn.dataset.kpiTeamOpenTab || "overview");
  if (kpiTeamAssignEmployeeId) openKpiTeamAssign(kpiTeamAssignEmployeeId);
  if (kpiTeamEmployeeTab) setKpiTeamEmployeeTab(kpiTeamEmployeeTab);
  if (kpiTeamEventFilter) { kpiTeamState.eventStatus = kpiTeamEventFilter; renderKpiTeamEmployeeDetail(); }
  if (kpiTeamOpenEventBtn) runAction("", `kpiTeamEvent:${kpiTeamOpenEventBtn.dataset.kpiTeamOpenEvent}`, "Đang mở đề xuất...", () => openKpiTeamGlobalEvent(kpiTeamOpenEventBtn.dataset.kpiTeamOpenEvent, kpiTeamOpenEventBtn.dataset.employeeId));
  if (kpiTeamRetry === "summary") runAction("kpiTeamReloadBtn", "kpiTeamSummary", "Đang tải...", () => reloadKpiTeamSummary({force:true}));
  if (kpiTeamRetry === "proposals") runAction("", "kpiTeamProposals", "Đang tải...", () => loadKpiTeamEmployeeProposals({force:true}));
  if (kpiTeamRetry === "queue") runAction("", "kpiTeamQueue", "Đang tải...", () => loadKpiTeamGlobalQueue({force:true}));
  if (kpiTeamRetry === "history") runAction("", "kpiTeamHistory", "Đang tải...", () => loadKpiTeamEmployeeHistory({force:true}));
  if (e.target.closest("[data-kpi-team-clear-filter]")) { kpiTeamState.employeeSearch=""; kpiTeamState.progressFilter="all"; kpiTeamState.pendingOnly=false; renderKpiTeamShell(); }
  if (e.target.closest("[data-kpi-team-close-queue]")) { kpiTeamState.globalQueueOpen=false; renderKpiTeamShell(); }
  if (kpiTeamDetailKpi) setKpiTeamEmployeeTab("kpis");
  if (kpiTeamReviewBtn) runAction("kpiTeamReviewBtn", "kpiTeamReview", "Đang xử lý...", reviewSelectedKpi2Events);
  if (kpi2ClaimId) runAction(`kpi2Claim:${kpi2ClaimId}`, "kpi2Claim", "Đang tải candidate...", () => openKpi2Claim(kpi2ClaimId));
  if (kpi2RevisionId) openKpi2Revision(kpi2RevisionId);
  if (kpi2EvidenceEventId) runAction(`kpi2Evidence:${kpi2EvidenceEventId}`, "kpi2Evidence", "Đang tạo link ảnh...", () => viewKpi2Evidence(kpi2EvidenceEventId));
  if (kpi2DiscardEvidenceId) runAction(`kpi2Discard:${kpi2DiscardEvidenceId}`, "kpi2DiscardEvidence", "Đang xóa ảnh...", () => discardKpi2StagedEvidence(kpi2DiscardEvidenceId));
  if (kpiProposalDetailId) openKpiProposalDetail(kpiProposalDetailId);
  if (editKpiProposalId) openEditKpiProposal(editKpiProposalId);
  if (customerKpiProposalId) openKpiProposalModal(customerKpiProposalId);
  if (softDeleteKpiProposalId) softDeleteKpiProposal(softDeleteKpiProposalId);
  if (deleteKpiProposalId) deleteKpiProposal(deleteKpiProposalId);
  if (approveKpiProposalId) reviewKpiProposal(approveKpiProposalId, "approved");
  if (rejectKpiProposalId) reviewKpiProposal(rejectKpiProposalId, "rejected");
  if (editCareLogId) editCareLog(editCareLogId);
  if (deleteCareLogId) deleteCareLog(deleteCareLogId);
  if (restoreCustomerId) restoreCustomer(restoreCustomerId);
  if (permanentDeleteCustomerId) permanentlyDeleteCustomer(permanentDeleteCustomerId);
  if (saveUserId) runAction(`saveUser:${saveUserId}`, "saveUser", "Đang lưu...", () => saveUserAdmin(saveUserId));
  if (toggleUserId) runAction(`toggleUser:${toggleUserId}`, "toggleUser", "Đang cập nhật...", () => toggleUserAdmin(toggleUserId));
  if (deleteUserId) runAction(`deleteUser:${deleteUserId}`, "deleteUser", "Đang xóa...", () => deleteUserAdmin(deleteUserId));
  if (confirmDeactivateEmployeeId) confirmDeactivateEmployee(confirmDeactivateEmployeeId);
  if (e.target.closest("[data-remove-deal-item]")) {
    e.target.closest("[data-deal-item]")?.remove();
    if (!document.querySelector("[data-deal-item]")) addDealItem();
  }
});

document.addEventListener("change", e => {
  const scoreOption = e.target.closest?.("[data-kpi2-score-option]");
  if (scoreOption) {
    runAction(
      "",
      `kpi2Score:${scoreOption.dataset.kpi2ScoreOption}`,
      "Đang lưu...",
      () => updateKpi2ScoreOption(scoreOption.dataset.kpi2ScoreOption, scoreOption.checked)
    );
    return;
  }
  const checkbox = e.target.closest?.("[data-unassigned-customer]");
  if (!checkbox) return;
  if (checkbox.checked) selectedUnassignedCustomerIds.add(checkbox.dataset.unassignedCustomer);
  else selectedUnassignedCustomerIds.delete(checkbox.dataset.unassignedCustomer);
});

document.addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const dashboardAction = e.target.closest?.("[data-dashboard-action]")?.dataset.dashboardAction;
  const orderSummary = e.target.closest?.("[data-order-summary]")?.dataset.orderSummary;
  const careWorkDetail = e.target.closest?.("[data-care-work-detail]")?.dataset.careWorkDetail;
  if (!dashboardAction && !careWorkDetail && !orderSummary) return;
  e.preventDefault();
  if (orderSummary) openOrderSummaryDetail(orderSummary);
  if (careWorkDetail) openCareWorkDetail(careWorkDetail);
  if (dashboardAction === "due-care" || dashboardAction === "overdue-care") openCareDashboardDetail(dashboardAction);
  if (["managed-customers","month-customers","no-date-care","showroom-visits","bought-customers"].includes(dashboardAction)) openDashboardCustomerDetail(dashboardAction);
  if (["pending-deals","completed-deals","month-revenue","deposit-deals","canceled-deals"].includes(dashboardAction)) openDashboardDealDetail(dashboardAction);
  if (["month-care","purchase-value"].includes(dashboardAction)) openDashboardActivityDetail(dashboardAction);
  if (dashboardAction === "pending-kpi") jumpToPendingKpi();
  if (dashboardAction === "legacy-pending-kpi") jumpToLegacyPendingKpi();
});

$("loginBtn")?.addEventListener("click", () => runAction("loginBtn", "login", "Đang đăng nhập...", loginEmailPassword));
$("googleBtn")?.addEventListener("click", () => runAction("googleBtn", "googleLogin", "Đang mở Google...", loginGoogle));
["loginEmail", "loginPassword"].forEach(id => on(id, "keydown", e => {
  if (e.key === "Enter") runAction("loginBtn", "login", "Đang đăng nhập...", loginEmailPassword);
}));

["searchBox","filterOwner","filterStatus","filterDealStatus","filterFollow","filterSource","filterChannel","filterCustomerType","filterWeek","filterMonth"].forEach(id => on(id, "input", () => resetPagingAndRender("customers", scheduleRenderAll)));
["taskScopeFilter","taskOwnerFilter","taskSearchBox"].forEach(id => on(id, "input", () => resetPagingAndRender("tasks", renderTaskBoard)));
["taskScopeFilter","taskOwnerFilter"].forEach(id => on(id, "change", () => resetPagingAndRender("tasks", renderTaskBoard)));
["reportActivityWeek","reportActivityMonth","reportActivityOwner","reportActivitySearch"].forEach(id => on(id, "input", () => resetPagingAndRender("saleActivity", renderSaleActivityReport)));
["reportActivityWeek","reportActivityMonth","reportActivityOwner"].forEach(id => on(id, "change", () => resetPagingAndRender("saleActivity", renderSaleActivityReport)));
["erpReportMonth","erpReportOwner"].forEach(id => on(id, "input", renderErpReport));
["erpReportMonth","erpReportOwner"].forEach(id => on(id, "change", renderErpReport));
on("resetTaskFilterBtn", "click", resetTaskFilters);
on("resetReportActivityFilterBtn", "click", resetSaleActivityFilters);
on("resetErpReportFilterBtn", "click", resetErpReportFilters);
on("assignSelectedCustomersBtn", "click", () => runAction("assignSelectedCustomersBtn", "bulkAssignCustomers", "Đang phân bổ...", assignSelectedUnassignedCustomers));
on("selectAllUnassignedBtn", "click", () => {
  const rows = customers.filter(c => !clean(c.ownerUserId) && !clean(c.ownerEmail));
  const shouldSelect = rows.some(c => !selectedUnassignedCustomerIds.has(c.id));
  rows.forEach(c => shouldSelect ? selectedUnassignedCustomerIds.add(c.id) : selectedUnassignedCustomerIds.delete(c.id));
  renderUnassignedPool(rows);
});
on("exportUnassignedBtn", "click", exportUnassignedCustomers);
on("addUserBtn", "click", () => runAction("addUserBtn", "addUser", "Đang thêm...", addUserAdmin));
["newUserEmail","newUserName"].forEach(id => on(id, "keydown", e => {
  if (e.key === "Enter") runAction("addUserBtn", "addUser", "Đang thêm...", addUserAdmin);
}));
on("saveCompanySettingsBtn", "click", () => runAction("saveCompanySettingsBtn", "saveCompanySettings", "Đang lưu...", saveCompanySettings));
on("resetCompanySettingsBtn", "click", resetCompanySettingsForm);
on("saveAdminCategoriesBtn", "click", () => runAction("saveAdminCategoriesBtn", "saveAdminCategories", "Đang lưu...", saveAdminCategorySettings));
on("resetAdminCategoriesBtn", "click", resetAdminCategorySettingsForm);
["adminAuditEntityFilter","adminAuditSearch"].forEach(id => on(id, "input", () => resetPagingAndRender("adminAudit", renderAdminAuditPage)));
on("adminAuditEntityFilter", "change", () => resetPagingAndRender("adminAudit", renderAdminAuditPage));
on("resetAdminAuditFilterBtn", "click", resetAdminAuditFilters);
["companyName","companyLogoUrl","companyPhone","companyEmail","companyShowroomAddress","companyFacebookUrl","companyZaloUrl","companyBrandColor","companyDefaultNotice"].forEach(id => {
  on(id, "input", () => renderCompanySettingsPreview());
});
on("filterChannel", "change", () => {
  activeChannelQuickFilter = "";
  resetPagingAndRender("customers", scheduleRenderAll);
});
on("filterMonth", "change", () => resetPagingAndRender("customers", scheduleRenderAll));
on("kpiRuleMonth", "change", () => { hydrateProposalKpiOptions(); scheduleRenderAll(); });
on("myKpiProposalStatus", "change", renderMyKpiProposalPanel);
on("kpiApprovalScope", "change", renderKpiApprovalPanel);
on("resetMyKpiProposalFilterBtn", "click", resetMyKpiProposalFilter);
on("resetKpiApprovalFilterBtn", "click", resetKpiApprovalFilter);
on("kpi1ReloadBtn", "click", () => runAction("kpi1ReloadBtn", "kpi1Reload", "Đang tải...", reloadKpiFoundationData));
on("kpi1CreatePeriodBtn", "click", () => runAction("kpi1CreatePeriodBtn", "kpi1CreatePeriod", "Đang tạo...", createKpi1Period));
on("kpi1SaveDefinitionBtn", "click", () => runAction("kpi1SaveDefinitionBtn", "kpi1SaveDefinition", "Đang lưu...", saveKpi1Definition));
on("kpi1CancelDefinitionBtn", "click", resetKpi1DefinitionForm);
on("kpi1ActivatePeriodBtn", "click", () => runAction("kpi1ActivatePeriodBtn", "kpi1Activate", "Đang kích hoạt...", activateKpi1Period));
on("kpi1ClosePeriodDetailBtn", "click", closeKpi1PeriodDetail);
on("kpiTeamReloadBtn", "click", () => runAction("kpiTeamReloadBtn", "kpiTeamSummary", "Đang tải...", () => reloadKpiTeamSummary({force:true})));
on("kpiTeamPeriod", "change", e => {
  kpiTeamState.selectedPeriodId = clean(e.target.value);
  selectedKpiFoundationPeriodId = kpiTeamState.selectedPeriodId;
  kpiTeamState.summaryCacheKey = "";
  kpiTeamState.assignmentProgress = [];
  kpiTeamState.monthlyScores = [];
  kpiTeamState.employeeEvents = [];
  kpiTeamState.globalQueueEvents = [];
  kpiTeamState.historyProgress = [];
  kpiTeamState.historyPeriods = [];
  kpiTeamState.historyScoresByPeriod = new Map();
  closeKpiTeamEmployee();
  renderKpiTeamShell();
  renderKpiFoundation();
  runAction("", "kpiTeamPeriod", "Đang tải kỳ KPI...", () => reloadKpiTeamSummary({force:true}));
});
on("kpiTeamSearch", "input", debounce(e => { kpiTeamState.employeeSearch = e.target.value; renderKpiTeamEmployeeList(); }, 120));
on("kpiTeamProgressFilter", "change", e => { kpiTeamState.progressFilter = e.target.value; renderKpiTeamEmployeeList(); });
on("kpiTeamPendingOnly", "change", e => { kpiTeamState.pendingOnly = e.target.checked; renderKpiTeamEmployeeList(); });
on("kpiTeamPendingBtn", "click", () => {
  if (kpiTeamState.globalQueueOpen) { kpiTeamState.globalQueueOpen = false; renderKpiTeamShell(); return; }
  runAction("kpiTeamPendingBtn", "kpiTeamQueue", "Đang tải...", () => loadKpiTeamGlobalQueue({force:true}));
});
on("kpiTeamDetailCloseBtn", "click", closeKpiTeamEmployee);
on("kpiTeamDetailBackdrop", "click", closeKpiTeamEmployee);
on("kpiTeamAssignCloseBtn", "click", closeKpiTeamAssign);
on("kpiTeamAssignCancelBtn", "click", closeKpiTeamAssign);
on("kpiTeamAssignBackdrop", "click", closeKpiTeamAssign);
on("kpiTeamAssignDefinition", "change", updateKpiTeamAssignDefinitionMeta);
on("kpiTeamAssignSubmitBtn", "click", () => runAction("kpiTeamAssignSubmitBtn", "kpiTeamAssign", "Đang gán...", submitKpiTeamAssignment));
on("kpi2ReloadBtn", "click", () => runAction("kpi2ReloadBtn", "kpi2Reload", "Đang tải...", reloadKpi2Data));
on("kpi2CloseClaimBtn", "click", () => runAction("kpi2CloseClaimBtn", "kpi2CloseClaim", "Đang đóng...", closeKpi2Claim));
on("kpi2EvidenceFiles", "change", () => runAction("", "kpi2EvidenceUpload", "Đang tải ảnh...", handleKpi2EvidenceFiles));
on("kpi2SubmitBtn", "click", () => runAction("kpi2SubmitBtn", "kpi2Submit", "Đang gửi...", submitKpi2Claim));
on("kpi2BulkReviewBtn", "click", () => runAction("kpi2BulkReviewBtn", "kpi2Review", "Đang xử lý...", reviewSelectedKpi2Events));
on("kpi2SelectAllEvents", "change", e => document.querySelectorAll("[data-kpi2-review-event]").forEach(box => box.checked=e.target.checked));
on("crmViewBtn", "click", () => setMainView("crm"));
on("customersViewBtn", "click", () => setMainView("customers"));
on("kpiViewBtn", "click", () => setMainView("kpi"));
on("reportsViewBtn", "click", () => setMainView("reports"));
on("adminViewBtn", "click", () => goToRoute("/admin"));
on("adminBackToCrmBtn", "click", () => goToRoute("/"));
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if ($("kpiTeamAssignDrawer") && !$("kpiTeamAssignDrawer").classList.contains("hide")) closeKpiTeamAssign();
  else if ($("kpiTeamDetailDrawer") && !$("kpiTeamDetailDrawer").classList.contains("hide")) closeKpiTeamEmployee();
});
on("adminLogoutBtn", "click", async () => {
  try { await updatePresence(false); } catch {}
  await signOut(auth);
});
document.querySelectorAll("[data-admin-route]").forEach(btn => {
  btn.addEventListener("click", () => goToRoute(btn.dataset.adminRoute || "/admin"));
});
on("kpiRuleTarget", "input", () => {
  document.querySelectorAll("[data-kpi-target-email]").forEach(input => {
    if (!clean(input.value)) input.value = $("kpiRuleTarget").value;
  });
});
on("careStatus", "change", updateCareStatusVisual);
on("careResult", "change", syncCareFormRules);
on("source", "change", () => { hydrateChannelOptions(); togglePartnerFields(); });
on("channel", "change", togglePartnerFields);
on("customerType", "change", togglePartnerFields);
on("filterSource", "change", () => { hydrateFilterChannelOptions(); resetPagingAndRender("customers", scheduleRenderAll); });
on("editSource", "change", () => { hydrateEditChannelOptions(); toggleEditPartnerFields(); });
on("editChannel", "change", toggleEditPartnerFields);
on("editCustomerType", "change", toggleEditPartnerFields);
on("logoutBtn", "click", async () => {
  try { await updatePresence(false); } catch {}
  await signOut(auth);
});
on("reloadBtn", "click", () => runAction("reloadBtn", "reload", "Đang tải...", reloadApp));
on("healthReloadBtn", "click", renderHealthCheck);
on("exportManagementReportBtn", "click", () => runAction("exportManagementReportBtn", "exportManagementReport", "Đang xuất...", exportManagementReport));
on("exportOperationalSnapshotBtn", "click", () => runAction("exportOperationalSnapshotBtn", "exportOperationalSnapshot", "Đang xuất...", exportOperationalSnapshot));
on("cleanupPhoneIndexBtn", "click", () => runAction("cleanupPhoneIndexBtn", "cleanupPhoneIndex", "Đang dọn...", cleanupPhoneIndex));
on("cleanupOrphansBtn", "click", () => runAction("cleanupOrphansBtn", "cleanupOrphans", "Đang dọn...", cleanupOrphans));
on("cleanupDataBtn", "click", () => runAction("cleanupDataBtn", "cleanupData", "Đang dọn...", cleanupData));
on("seedBtn", "click", () => runAction("seedBtn", "seedSettings", "Đang tạo...", seedSettings));
on("syncPhoneBtn", "click", () => runAction("syncPhoneBtn", "syncPhone", "Đang đồng bộ...", syncPhoneIndex));
on("syncOwnerBtn", "click", () => runAction("syncOwnerBtn", "syncOwner", "Đang đồng bộ...", syncOwnerEmail));
on("importBtn", "click", () => $("importFile").click());
on("importFile", "change", handleImportFile);
on("saveCustomerBtn", "click", () => runAction("saveCustomerBtn", "saveCustomer", "Đang lưu...", saveCustomer));
on("clearBtn", "click", clearForm);
on("phone", "input", renderPhoneHint);
on("enableNotifyBtn", "click", () => runAction("enableNotifyBtn", "enableNotify", "Đang bật...", enableBrowserNotifications));
on("resetFilterBtn", "click", resetFilters);
on("exportBtn", "click", exportCsv);
on("exportKpiBtn", "click", () => runAction("exportKpiBtn", "exportKpi", "Đang xuất...", exportKpiReport));
on("reportExportManagementBtn", "click", () => runAction("reportExportManagementBtn", "exportManagementReport", "Đang xuất...", exportManagementReport));
on("reportExportKpiBtn", "click", () => runAction("reportExportKpiBtn", "exportKpi", "Đang xuất...", exportKpiReport));
on("reportExportActivityBtn", "click", () => runAction("reportExportActivityBtn", "exportSaleActivity", "Đang xuất...", exportSaleActivityReport));
on("openKpiProposalBtn", "click", () => openKpiProposalModal());
on("openKpiProposalBtnTop", "click", () => openKpiProposalModal());
on("closeKpiProposalBtn", "click", closeKpiProposalModal);
on("kpiProposalBackdrop", "click", closeKpiProposalModal);
on("submitKpiProposalBtn", "click", () => runAction("submitKpiProposalBtn", "submitKpiProposal", "Đang gửi...", submitKpiProposal));
on("closeDetailModalBtn", "click", closeDetailModal);
on("detailModalBackdrop", "click", closeDetailModal);
on("closeDrawerBtn", "click", closeDrawer);
on("drawerBackdrop", "click", closeDrawer);
on("saveCareBtn", "click", () => runAction("saveCareBtn", "saveCare", "Đang lưu...", saveCareLog));
on("saveCareSettingsBtn", "click", () => runAction("saveCareSettingsBtn", "saveCareSettings", "Đang lưu...", saveCareSettings));
on("saveDropdownSettingsBtn", "click", () => runAction("saveDropdownSettingsBtn", "saveDropdownSettings", "Đang lưu...", saveDropdownSettings));
on("toggleCareHistoryBtn", "click", toggleCareHistory);
on("saveDealBtn", "click", () => runAction("saveDealBtn", "saveDeal", "Đang lưu...", saveDeal));
on("cancelEditDealBtn", "click", clearDealEditMode);
on("saveKpiRuleBtn", "click", () => runAction("saveKpiRuleBtn", "saveKpiRule", "Đang lưu...", saveKpiRule));
on("cancelEditKpiRuleBtn", "click", resetKpiRuleForm);
on("addDealItemBtn", "click", () => addDealItem());
on("dealItems", "input", e => {
  if (e.target.matches("[data-deal-product]")) applyProductToDealInput(e.target);
});
on("dealItems", "change", e => {
  if (e.target.matches("[data-deal-product]")) applyProductToDealInput(e.target);
});
on("showPendingDealsBtn", "click", () => showDealList("pending"));
on("showCompletedDealsBtn", "click", () => showDealList("completed"));
on("closeDealListBtn", "click", () => $("dealListSection").classList.add("hide"));
on("editCustomerInfoBtn", "click", () => toggleCustomerInfoEdit(true));
on("cancelCustomerInfoBtn", "click", () => toggleCustomerInfoEdit(false));
on("saveCustomerInfoBtn", "click", () => runAction("saveCustomerInfoBtn", "saveCustomerInfo", "Đang lưu...", saveCustomerInfo));
on("deleteCustomerBtn", "click", () => runAction("deleteCustomerBtn", "deleteCustomer", "Đang xóa...", deleteCustomer));
window.addEventListener("resize", scheduleRenderChart);
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !renderQueuedWhileHidden) return;
  renderQueuedWhileHidden = false;
  renderAll();
  scheduleRenderChart();
});
window.addEventListener("popstate", () => {
  if (currentUser && appUser) showApp();
  else showLogin();
});
on("channelReportRange", "change", () => {
  updateChannelReportCustomControls();
  scheduleRenderChart();
});
on("channelReportStartDate", "change", scheduleRenderChart);
on("channelReportEndDate", "change", scheduleRenderChart);
on("resetChannelReportFilterBtn", "click", resetChannelReportFilters);
on("channelReportChart", "click", handleChannelReportClick);
on("channelReportChart", "mousemove", handleChannelReportPointer);

onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) return showLogin();
  try {
    appUser = await loadAppUser(user);
    if (appUser.active === false) throw new Error("Tài khoản đã bị khóa.");
    await loadSettings();
    if (canAccessAdminPanel()) await loadCompanySettings();
    await refreshKpiCutoverState({render:false});
    startPresence();
    showApp();
    watchData();
    if (pendingLoginSuccessNotice) notice("Đăng nhập thành công.");
    pendingLoginSuccessNotice = false;
  } catch (err) {
    pendingLoginSuccessNotice = false;
    $("loginError").textContent = authMessage(err);
    await signOut(auth);
  }
});
