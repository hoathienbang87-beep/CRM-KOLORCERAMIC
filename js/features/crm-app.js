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
  runTransaction,
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
let currentUser = null;
let appUser = null;
let settings = {...DEFAULT_SETTINGS};
let allCustomers = [];
let customers = [];
let deletedCustomers = [];
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
let auditLogs = [];
let unsubscribers = [];
let selectedCustomerId = "";
let scopedSnapshots = {customers:{}, careLogs:{}, deals:{}, kpiProposals:{}};
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
const pagingState = {
  customers: {limit: 40, step: 40},
  tasks: {limit: 30, step: 30},
  products: {limit: 80, step: 80},
  saleActivity: {limit: 80, step: 80},
  audit: {limit: 80, step: 80}
};
let pendingLoginSuccessNotice = false;
const KPI_EVIDENCE_BUCKET = "kpi-evidence";
const KPI_EVIDENCE_MAX_FILES = 6;
const KPI_EVIDENCE_MAX_SIZE = 8 * 1024 * 1024;

const roleKey = () => clean(appUser?.role).toLowerCase();
const isOwner = () => roleKey() === "owner";
const isAdmin = () => roleKey() === "admin";
const canAccessAdminPanel = () => isOwner() || isAdmin();
const isManager = () => ["admin","manager","quanly","quản lý","quản lí"].includes(roleKey());
const isSale = () => roleKey() === "sale";
const canExportData = () => ["admin","manager","sale"].includes(roleKey()) || appUser?.canExport === true || String(appUser?.canExport || "").toLowerCase() === "true";
const ownerName = () => clean(appUser?.name) || clean(currentUser?.displayName) || clean(currentUser?.email);
const ownerEmail = () => clean(appUser?.email) || clean(currentUser?.email);
const sameIdentity = (a, b) => !!clean(a) && !!clean(b) && normalizeKey(a) === normalizeKey(b);
const ownerMatchesCurrentUser = item => sameIdentity(item?.ownerEmail, ownerEmail()) || sameIdentity(item?.createdByEmail, ownerEmail()) || sameIdentity(item?.owner, ownerName());
const canEditCustomer = c => !!c?.id && (isManager() || ownerMatchesCurrentUser(c));
const logAudit = (action, entity, entityId = "", payload = {}) => setDoc(doc(collection(db, "auditLogs")), {
  action,
  entity,
  entityId,
  email: currentUser?.email || "",
  payloadJson: JSON.stringify(payload || {}),
  createdAt: serverTimestamp()
});
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
  "/admin": {key:"dashboard", title:"Admin Panel", subtitle:"Quản trị nội dung, sản phẩm, media, người dùng và cấu hình công ty mà không cần chỉnh code."},
  "/admin/content": {key:"content", title:"CMS nội dung", subtitle:"Quản lý các phần hiển thị trên website bằng form an toàn."},
  "/admin/products": {key:"products", title:"Sản phẩm / mẫu gạch", subtitle:"Quản lý danh mục, mẫu gạch, ảnh, trạng thái hiển thị và thứ tự."},
  "/admin/media": {key:"media", title:"Media", subtitle:"Quản lý ảnh cho banner, sản phẩm, dự án và nội dung website."},
  "/admin/users": {key:"users", title:"Người dùng", subtitle:"Quản lý tài khoản, role, khóa/mở và thông tin nhân viên."},
  "/admin/settings": {key:"settings", title:"Cấu hình công ty", subtitle:"Quản lý logo, hotline, email, showroom, mạng xã hội và thương hiệu."},
  "/admin/audit-logs": {key:"audit-logs", title:"Nhật ký hoạt động", subtitle:"Theo dõi các thay đổi nội dung, sản phẩm, user và cấu hình."}
};
const viewDependencies = {
  crm: ["customers", "careLogs", "deals", "settings"],
  customers: ["customers", "careLogs", "deals", "orderItems", "payments", "settings", "users"],
  kpi: ["customers", "kpiRules", "kpiProposals", "settings", "users"],
  orders: ["customers", "deals", "orderItems", "payments", "products", "settings", "users"],
  products: ["products", "inventoryMovements", "settings"],
  quotes: ["customers", "quotes", "quoteItems", "products", "settings", "users"],
  reports: ["customers", "careLogs", "deals", "quotes", "quoteItems", "orderItems", "payments", "inventoryMovements", "products", "auditLogs", "settings", "users"],
  admin: ["customers", "careLogs", "deals", "users", "auditLogs", "settings"]
};
const scheduleRenderAll = debounce(() => renderAll(), 180);
const scheduleRenderChart = debounce(() => requestChartRender(), 180);

function markDirty(...names) {
  names.flat().filter(Boolean).forEach(name => dirtyCollections.add(name));
  scheduleRenderAll();
}

function activeViewKey() {
  return ["customers","kpi","orders","products","quotes","reports","admin"].includes(activeMainView) ? activeMainView : "crm";
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
    products: renderProducts,
    saleActivity: renderSaleActivityReport,
    audit: renderAuditTrail
  };
  renderers[key]?.();
}

function resetPagingAndRender(keys, renderFn) {
  (Array.isArray(keys) ? keys : [keys]).forEach(resetPaging);
  renderFn();
}

function authMessage(err) {
  const code = err?.code || "";
  const message = err?.message || "";
  if (code.includes("unauthorized-domain")) return "Domain này chưa được cho phép trong Supabase Authentication. Hãy kiểm tra Site URL/Redirect URLs trong Supabase.";
  if (code.includes("invalid-credential") || code.includes("wrong-password")) return "Email hoặc mật khẩu chưa đúng.";
  if (code.includes("user-not-found")) return "Chưa có tài khoản này trong Supabase Authentication.";
  if (code.includes("popup")) return "Trình duyệt đang chặn popup đăng nhập Google.";
  if (/upload ảnh|storage|bucket|object/i.test(message) && /permission|row-level security|violates row-level security/i.test(message)) {
    return "Chưa upload được ảnh minh chứng. Hãy kiểm tra bucket kpi-evidence và policy Storage.";
  }
  if (/permission|row-level security|violates row-level security|infinite recursion/i.test(message)) return "Bạn chưa có quyền đọc/ghi Supabase. Hãy kiểm tra RLS và role/active trong bảng app_users.";
  if (message.includes("Chưa được cấp quyền")) return message;
  return message || "Không đăng nhập được.";
}

function on(id, eventName, handler, options) {
  const el = $(id);
  if (!el) {
    console.warn(`CRM: missing element #${id}`);
    return;
  }
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
    .filter(u => u.active !== false && clean(u.role).toLowerCase() !== "admin")
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
  const keys = [...ownerProfiles.map(o => clean(o.email || o.name)), ...customers.map(customerOwnerKey)];
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
    ["quoteFilterOwner", "Tất cả nhân viên"],
    ["taskOwnerFilter", "Tất cả nhân viên"],
    ["orderFilterOwner", "Tất cả nhân viên"],
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
  if (!show) ["companyName","partnerType","partnerActivity","partnerLevel","partnerCapacity"].forEach(id => { if ($(id)) $(id).value = ""; });
}

function toggleCarePartnerFields() {
  $("carePartnerFields").classList.add("hide");
  ["careCompanyName","carePartnerType","carePartnerActivity","carePartnerLevel","carePartnerCapacity"].forEach(id => { if ($(id)) $(id).value = ""; });
}

function hydrateSelects() {
  fillSelect("source", settings.sources);
  fillSelect("customerType", settings.customerTypes);
  hydrateChannelOptions();
  fillSelect("owner", ownerOptions());
  fillSelect("editSource", settings.sources);
  fillSelect("editCustomerType", settings.customerTypes);
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
  fillSelect("filterDealStatus", settings.dealStatuses, "", "Tất cả đơn hàng");
  fillSelect("filterFollow", settings.follows, "", "Tất cả tình trạng");
  fillSelect("filterSource", settings.sources, "", "Tất cả nguồn");
  hydrateFilterChannelOptions();
  fillSelect("filterCustomerType", settings.customerTypes, "", "Tất cả phân loại");
  hydrateOrderFilters();
  hydrateProductFilters();
  hydrateProposalKpiOptions();
  renderDropdownSettingsForm();
  // Không tự lọc theo tháng hiện tại. Bộ lọc Tháng/Tuần để trống thì hiển thị tất cả dữ liệu.
  $("filterWeek").value ||= "";
  $("filterMonth").value ||= "";
  $("kpiRuleMonth").value ||= currentMonth();
  $("careDueDays").value = careDueDays();
  togglePartnerFields();
  if (!isManager()) {
    $("owner").value = ownerEmail();
    $("owner").disabled = true;
    $("editOwner").disabled = true;
    $("filterOwner").value = ownerEmail();
    $("filterOwner").disabled = true;
    $("orderFilterOwner").value = ownerEmail();
    $("orderFilterOwner").disabled = true;
    $("exportBtn").classList.toggle("hide", !canExportData());
    $("deleteCustomerBtn").classList.add("hide");
    $("seedBtn").classList.add("hide");
    $("syncPhoneBtn").classList.add("hide");
    $("syncOwnerBtn").classList.add("hide");
    $("importBtn").classList.add("hide");
    $("importProductsBtn")?.classList.add("hide");
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
    $("orderFilterOwner").disabled = false;
    $("exportBtn").classList.remove("hide");
    $("deleteCustomerBtn").classList.remove("hide");
    $("seedBtn").classList.toggle("hide", !canAccessAdminPanel());
    $("syncPhoneBtn").classList.toggle("hide", !canAccessAdminPanel());
    $("syncOwnerBtn").classList.toggle("hide", !canAccessAdminPanel());
    $("importBtn").classList.toggle("hide", !canAccessAdminPanel());
    $("importProductsBtn")?.classList.toggle("hide", !isManager());
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
  if (!isAdmin()) return;
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

async function seedSettings() {
  if (!isAdmin()) return notice("Chỉ admin được tạo SETTINGS.", true);
  await setDoc(doc(db, "settings", "crm"), DEFAULT_SETTINGS, {merge:true});
  await logAudit("seedSettings", "settings", "crm", {keys: Object.keys(DEFAULT_SETTINGS)})
    .catch(err => notice("Đã tạo SETTINGS, nhưng chưa ghi được audit log: " + authMessage(err), true));
  await loadSettings();
  notice("Đã tạo/cập nhật SETTINGS trên Supabase.");
}

async function saveCareSettings() {
  if (!isAdmin()) return notice("Chỉ admin được lưu thiết lập chăm sóc.", true);
  const days = Math.max(0, Number($("careDueDays").value || 0));
  try {
    await setDoc(doc(db, "settings", "crm"), {
      careDueDays: days,
      updatedByEmail: currentUser?.email || "",
      updatedAt: serverTimestamp()
    }, {merge:true});
    await logAudit("updateCareSettings", "settings", "crm", {careDueDays: days})
      .catch(err => notice("Đã lưu thiết lập chăm sóc, nhưng chưa ghi được audit log: " + authMessage(err), true));
    settings.careDueDays = days;
    hydrateSelects();
    renderAll();
    notice("Đã lưu thiết lập chăm sóc.");
  } catch (err) {
    notice("Không lưu được thiết lập chăm sóc: " + authMessage(err), true);
  }
}

function renderDropdownSettingsForm() {
  const pairs = [
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
  if ($("settingsQuoteTemplateUrl") && document.activeElement !== $("settingsQuoteTemplateUrl")) {
    $("settingsQuoteTemplateUrl").value = clean(settings.quoteTemplateUrl);
  }
}

async function saveDropdownSettings() {
  if (!isAdmin()) return notice("Chỉ admin được lưu cấu hình dropdown.", true);
  const channels = textToList($("settingsSourceChannels").value);
  const data = {
    sources: [],
    sourceChannels: {},
    channels,
    customerTypes: [],
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
    quoteTemplateUrl: clean($("settingsQuoteTemplateUrl").value),
    updatedByEmail: currentUser?.email || "",
    updatedAt: serverTimestamp()
  };
  if (!data.channels.length) return notice("Cần có ít nhất 1 kênh chi tiết.", true);
  if (!data.statuses.length || !data.follows.length) return notice("Trạng thái và tình trạng chăm không được để trống.", true);
  try {
    await setDoc(doc(db, "settings", "crm"), data, {merge:true});
    await logAudit("updateDropdownSettings", "settings", "crm", {
      channels: data.channels.length,
      statuses: data.statuses.length,
      follows: data.follows.length,
      careChannels: data.careChannels.length,
      careResults: data.careResults.length,
      dealStatuses: data.dealStatuses.length
    }).catch(err => notice("Đã lưu dropdown, nhưng chưa ghi được audit log: " + authMessage(err), true));
    settings = normalizeSettings({...settings, ...data});
    hydrateSelects();
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
  const updates = [];
  const addUpdate = (collectionName, item) => {
    if (item.ownerEmail || !byName.has(clean(item.owner))) return;
    const p = byName.get(clean(item.owner));
    updates.push({ref: doc(db, collectionName, item.id), data: {owner: p.name, ownerEmail: p.email, updatedAt: serverTimestamp()}});
  };
  customers.forEach(c => addUpdate("customers", c));
  careLogs.forEach(l => addUpdate("careLogs", l));
  deals.forEach(d => addUpdate("deals", d));
  for (let i = 0; i < updates.length; i += 450) {
    const batch = writeBatch(db);
    updates.slice(i, i + 450).forEach(u => batch.update(u.ref, u.data));
    await batch.commit();
  }
  try {
    await logAudit("syncOwnerEmail", "customers/careLogs/deals", "bulk", {count: updates.length});
  } catch (err) {
    notice("Đã đồng bộ nhân viên, nhưng chưa ghi được audit log: " + authMessage(err), true);
  }
  notice(`Đã đồng bộ email nhân viên cho ${updates.length} bản ghi.`);
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
      await runTransaction(db, async tx => {
        const customerRef = doc(collection(db, "customers"));
        const phoneRef = customer.phoneNormalized ? doc(db, "phoneIndex", customer.phoneNormalized) : null;
        if (phoneRef) {
          const phoneSnap = await tx.get(phoneRef);
          if (phoneSnap.exists()) throw new Error("duplicate");
        }
        tx.set(customerRef, customer);
        if (phoneRef) {
          tx.set(phoneRef, {
            customerId: customerRef.id,
            owner: customer.owner,
            ownerEmail: customer.ownerEmail,
            createdByEmail: currentUser.email || "",
            createdAt: serverTimestamp()
          });
        }
        if (dealStatus) {
          const completed = sameLabel(dealStatus, "boughtStatus");
          const deal = {
            customerId: customerRef.id, customerName: customer.name, phoneNormalized: customer.phoneNormalized,
            phoneRaw: customer.phoneRaw, source: customer.source, channel: customer.channel,
            owner: customer.owner, ownerEmail: customer.ownerEmail, dealStatus,
            dealDate: parseImportDate(rowValue(row, ["Ngày đơn", "Ngày mua", "dealDate"])) || todayIso(),
            deliveryDate: parseImportDate(rowValue(row, ["Ngày hẹn giao", "Hẹn giao", "deliveryDate"])),
            product: customer.need,
            amount: parseImportAmount(rowValue(row, ["Giá trị đơn", "Doanh số", "amount"])),
            note: rowValue(row, ["Ghi chú đơn hàng", "Ghi chú đơn", "dealNote"]),
            createdByEmail: currentUser.email || "",
            completed,
            completedAt: completed ? serverTimestamp() : null,
            completedByEmail: completed ? (currentUser.email || "") : "",
            createdAt: serverTimestamp()
          };
          tx.set(doc(collection(db, "deals")), deal);
        }
        tx.set(doc(collection(db, "auditLogs")), {
          action: "importCustomerCsv", entity: "customers", entityId: customerRef.id,
          email: currentUser.email || "", payloadJson: JSON.stringify(customer), createdAt: serverTimestamp()
        });
      });
      imported++;
    } catch (err) {
      if (err.message === "duplicate") skipped++;
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

  unsubscribers.push(onSnapshot(collection(db, "kpiRules"), snap => {
    kpiRules = snap.docs.map(d => ({id:d.id, ...d.data()})).sort((a,b) => clean(a.name).localeCompare(clean(b.name)));
    hydrateProposalKpiOptions();
    markDirty("kpiRules");
  }, err => notice("Lỗi tải KPI: " + authMessage(err), true)));

  unsubscribers.push(onSnapshot(collection(db, "products"), snap => {
    applySnap("products", snap, true);
    hydrateProductFilters();
    renderProductOptions();
  }, err => notice("Lỗi tải sản phẩm: " + authMessage(err), true)));

  if (isManager()) {
    unsubscribers.push(onSnapshot(collection(db, "customers"), snap => applySnap("customers", snap, true), err => notice("Lỗi tải khách: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "careLogs"), snap => applySnap("careLogs", snap, true), err => notice("Lỗi tải lịch sử chăm: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "deals"), snap => applySnap("deals", snap, true), err => notice("Lỗi tải đơn hàng: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "quotes"), snap => applySnap("quotes", snap, true), err => notice("Lỗi tải báo giá: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "quoteItems"), snap => applySnap("quoteItems", snap, false), err => notice("Lỗi tải dòng báo giá: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "orderItems"), snap => applySnap("orderItems", snap, false), err => notice("Lỗi tải dòng đơn hàng: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "payments"), snap => applySnap("payments", snap, false), err => notice("Lỗi tải thanh toán: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "inventoryMovements"), snap => applySnap("inventoryMovements", snap, false), err => notice("Lỗi tải kho: " + authMessage(err), true)));
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
  unsubscribers.push(onSnapshot(collection(db, "careLogs"), snap => applySnap("careLogs", snap, true), err => notice("Lỗi tải lịch sử chăm được cấp quyền: " + authMessage(err), true)));
  unsubscribers.push(onSnapshot(collection(db, "deals"), snap => applySnap("deals", snap, true), err => notice("Lỗi tải đơn hàng được cấp quyền: " + authMessage(err), true)));
  unsubscribers.push(onSnapshot(collection(db, "quotes"), snap => applySnap("quotes", snap, true), err => notice("Lỗi tải báo giá được cấp quyền: " + authMessage(err), true)));
  unsubscribers.push(onSnapshot(collection(db, "quoteItems"), snap => applySnap("quoteItems", snap, false), err => notice("Lỗi tải dòng báo giá được cấp quyền: " + authMessage(err), true)));
  unsubscribers.push(onSnapshot(collection(db, "orderItems"), snap => applySnap("orderItems", snap, false), err => notice("Lỗi tải dòng đơn hàng được cấp quyền: " + authMessage(err), true)));
  unsubscribers.push(onSnapshot(collection(db, "payments"), snap => applySnap("payments", snap, false), err => notice("Lỗi tải thanh toán được cấp quyền: " + authMessage(err), true)));
  unsubscribers.push(onSnapshot(collection(db, "inventoryMovements"), snap => applySnap("inventoryMovements", snap, false), err => notice("Lỗi tải kho được cấp quyền: " + authMessage(err), true)));
  unsubscribers.push(onSnapshot(collection(db, "kpiProposals"), snap => applySnap("kpiProposals", snap, true), err => notice("Lỗi tải đề xuất KPI của bạn: " + authMessage(err), true)));
}

function visibleCustomers() {
  const q = normalizeKey($("searchBox").value);
  const owner = clean($("filterOwner").value);
  const status = clean($("filterStatus").value);
  const dealStatus = clean($("filterDealStatus").value);
  const follow = clean($("filterFollow").value);
  const channel = clean($("filterChannel").value);
  const week = clean($("filterWeek").value);
  const month = clean($("filterMonth").value);

  return customers.filter(canSeeCustomer).filter(c => {
    const haystack = normalizeKey([c.name,c.companyName,c.phoneRaw,c.phoneNormalized,c.address,c.channel,c.owner,c.ownerEmail,customerOwnerName(c),c.status,c.follow,computedFollowStatus(c),c.need,c.note].join(" "));
    if (q && !haystack.includes(q)) return false;
    if (owner && !sameIdentity(customerOwnerKey(c), owner) && !sameIdentity(c.owner, owner)) return false;
    if (status === "__NO_PHONE__" && c.phoneNormalized) return false;
    if (status && status !== "__NO_PHONE__" && clean(c.status) !== status) return false;
    if (dealStatus && !customerDeals(c.id).some(d => normalizeKey(normalizeDealStatus(d.dealStatus)) === normalizeKey(dealStatus))) return false;
    if (!followMatchesFilter(c, follow)) return false;
    if (channel && normalizeKey(canonicalChannel(c.channel)) !== normalizeKey(channel)) return false;
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
  return channelQuickType(c.channel) === quick;
}
function channelQuickLabel(quick = activeChannelQuickFilter) {
  return {company:"Công ty XD", social:"Mạng XH", other:"Kênh khác"}[quick] || "";
}

const customerDeals = id => deals.filter(d => d.customerId === id).sort((a,b) => String(b.dealDate || "").localeCompare(String(a.dealDate || "")) || byDateDesc(a,b));
const customerLogs = id => careLogs.filter(l => l.customerId === id).sort(byDateDesc);
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
const customerHasDealStatus = (id, labelKey) => customerDeals(id).some(d => sameLabel(normalizeDealStatus(d.dealStatus), labelKey));
const customerHasCompletedDeal = id => customerDeals(id).some(isCompletedDeal);
const latestDealStatus = c => normalizeDealStatus(customerDeals(c.id)[0]?.dealStatus || c.dealStatus || "");
const daysBetweenIso = (a, b) => Math.floor((new Date(a + "T00:00:00") - new Date(b + "T00:00:00")) / 86400000);
const careDeltaDays = c => clean(c.nextCareDate) ? daysBetweenIso(todayIso(), clean(c.nextCareDate)) : null;
const careDueDays = () => Math.max(0, Number(settings.careDueDays ?? DEFAULT_SETTINGS.careDueDays ?? 3) || 0);
const isLeadStatus = c => sameLabel(c?.status, "leadStatus");
const isCustomerClosed = c => purchaseCount(c.id) > 0 || isCanceledDeal(latestDealStatus(c)) || isFailStatus(latestDealStatus(c)) || sameLabel(c.status, "noNeedStatus");
function computedFollowStatus(c) {
  if (!c) return "";
  if (isCustomerClosed(c)) return systemLabel("closedFollow");
  const nextDate = clean(c.nextCareDate);
  if (!nextDate) return isLeadStatus(c) ? systemLabel("noDateFollow") : systemLabel("closedFollow");
  const delta = careDeltaDays(c);
  if (delta === null) return isLeadStatus(c) ? systemLabel("noDateFollow") : systemLabel("closedFollow");
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
const kpiViewIds = ["kpiSummaryPanel","kpiRulePanel","kpiApprovalPanel"];
const ordersViewIds = ["ordersPanel"];
const productsViewIds = ["productsPanel"];
const quotesViewIds = ["quotesPanel"];
const reportsViewIds = ["reportsPanel"];

function renderCrmView() {
  renderKpis();
  renderExecutiveDashboard();
  renderPipelineReport();
  requestChartRender();
  renderNeedCare();
}

function setMainView(view) {
  activeMainView = ["customers","kpi","orders","products","quotes","reports","admin"].includes(view) ? view : "crm";
  if (activeMainView === "reports" && !isManager()) activeMainView = "crm";
  if (activeMainView === "admin" && !canAccessAdminPanel()) activeMainView = "crm";
  const isCustomerView = activeMainView === "customers";
  const isKpiView = activeMainView === "kpi";
  const isOrdersView = activeMainView === "orders";
  const isProductsView = activeMainView === "products";
  const isQuotesView = activeMainView === "quotes";
  const isReportsView = activeMainView === "reports";
  const isAdminView = activeMainView === "admin";
  crmViewIds.forEach(id => {
    if (isCustomerView || isKpiView || isOrdersView || isProductsView || isQuotesView || isReportsView || isAdminView) $(id)?.classList.add("hide");
  });
  if (!isCustomerView && !isKpiView && !isOrdersView && !isProductsView && !isQuotesView && !isReportsView && !isAdminView) {
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
  document.querySelector(".chart-grid")?.classList.toggle("hide", isCustomerView || isKpiView || isOrdersView || isProductsView || isQuotesView || isReportsView || isAdminView);
  $("kpiSummaryPanel")?.classList.toggle("hide", !isKpiView);
  $("kpiRulePanel")?.classList.toggle("hide", !isKpiView || !isManager());
  $("kpiApprovalPanel")?.classList.toggle("hide", !isKpiView || !isManager());
  ordersViewIds.forEach(id => $(id)?.classList.toggle("hide", !isOrdersView));
  productsViewIds.forEach(id => $(id)?.classList.toggle("hide", !isProductsView));
  quotesViewIds.forEach(id => $(id)?.classList.toggle("hide", !isQuotesView));
  reportsViewIds.forEach(id => $(id)?.classList.toggle("hide", !isReportsView));
  $("adminViewBtn")?.classList.toggle("hide", !canAccessAdminPanel());
  $("reportsViewBtn")?.classList.toggle("hide", !isManager());
  $("crmViewBtn")?.classList.toggle("primary", !isCustomerView && !isKpiView && !isOrdersView && !isProductsView && !isQuotesView && !isReportsView && !isAdminView);
  $("customersViewBtn")?.classList.toggle("primary", isCustomerView);
  $("ordersViewBtn")?.classList.toggle("primary", isOrdersView);
  $("productsViewBtn")?.classList.toggle("primary", isProductsView);
  $("quotesViewBtn")?.classList.toggle("primary", isQuotesView);
  $("kpiViewBtn")?.classList.toggle("primary", isKpiView);
  $("reportsViewBtn")?.classList.toggle("primary", isReportsView);
  $("adminViewBtn")?.classList.toggle("primary", isAdminView);
  if (!isCustomerView && !isKpiView && !isOrdersView && !isProductsView && !isQuotesView && !isReportsView && !isAdminView) renderCrmView();
  if (isCustomerView) renderCustomers();
  if (isKpiView) {
    renderKpiTable();
    renderMyKpiProposalPanel();
    renderKpiRuleList();
    renderKpiApprovalPanel();
  }
  if (isOrdersView) renderOrders();
  if (isProductsView) renderProducts();
  if (isQuotesView) renderQuotes();
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
  const filteredDeals = deals.filter(d => rowIds.has(d.customerId));
  const completed = filteredDeals.filter(isCompletedDeal);
  const pending = filteredDeals.filter(isActiveDeal);
  const due = rows.filter(isCareDue);
  const overdue = rows.filter(isCareOverdue);
  const withPhone = rows.filter(c => c.phoneNormalized);
  const uniquePhones = new Set(withPhone.map(c => c.phoneNormalized).filter(Boolean)).size;
  const noPhoneCount = rows.length - withPhone.length;
  const thisMonth = currentMonth();
  const monthLead = rows.filter(c => monthOf(c.createdAt) === thisMonth).length;
  const revenue = completed.reduce((sum, d) => sum + dealAmount(d), 0);
  const pendingValue = pending.reduce((sum, d) => sum + dealAmount(d), 0);
  const boughtCustomers = rows.filter(c => customerHasCompletedDeal(c.id));
  const conversionRate = rows.length ? Math.round(boughtCustomers.length / rows.length * 100) : 0;
  const items = [
    ["Tổng khách", rows.length],
    ["Khách mới tháng này", monthLead],
    ["Cần chăm", due.length],
    ["Quá hạn chăm", overdue.length],
    ["Đơn đang xử lý", pending.length],
    ["Đơn hoàn thành", completed.length],
    [systemLabel("depositStatus"), filteredDeals.filter(d => sameLabel(normalizeDealStatus(d.dealStatus), "depositStatus")).length],
    [systemLabel("canceledStatus"), filteredDeals.filter(d => sameLabel(normalizeDealStatus(d.dealStatus), "canceledStatus")).length],
    ["Doanh số hoàn thành", money(revenue)],
    ["Giá trị đang xử lý", money(pendingValue)],
    ["Tỉ lệ mua", conversionRate + "%"]
  ];
  $("kpis").innerHTML = items.map(([label,num]) => `<div class="kpi"><div class="muted">${esc(label)}</div><div class="num">${esc(num)}</div></div>`).join("");
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
  const reportDeals = currentReportDeals();
  const month = currentMonth();
  const monthCustomers = rows.filter(c => monthOf(c.createdAt) === month);
  const completedMonth = reportDeals.filter(d => isCompletedDeal(d) && monthOf(d.completedAt || d.dealDate || d.createdAt) === month);
  const pendingDeals = reportDeals.filter(isActiveDeal);
  const completedDeals = reportDeals.filter(isCompletedDeal);
  const boughtCustomers = rows.filter(c => customerHasCompletedDeal(c.id));
  const pendingValue = pendingDeals.reduce((sum, d) => sum + dealAmount(d), 0);
  const pendingKpi = kpiProposals.filter(p => isPendingKpiProposal(p) && !p.isDeleted).length;
  const dueCare = rows.filter(isCareDue);
  const overdueCare = rows.filter(isCareOverdue);
  const depositDeals = reportDeals.filter(d => sameLabel(normalizeDealStatus(d.dealStatus), "depositStatus"));
  const canceledDeals = reportDeals.filter(d => sameLabel(normalizeDealStatus(d.dealStatus), "canceledStatus"));
  const cards = [
    ["Khách đang quản lý", rows.length, "", "managed-customers"],
    ["Khách mới tháng này", monthCustomers.length, "", "month-customers"],
    ["Doanh số tháng", money(completedMonth.reduce((sum,d) => sum + dealAmount(d), 0)), "", "month-revenue"],
    ["Deal đang xử lý", pendingDeals.length, pendingDeals.length ? "warn" : "", "pending-deals"],
    ["Giá trị đang xử lý", money(pendingValue), pendingValue ? "warn" : "", "pending-deals"],
    ["Đơn hoàn thành", completedDeals.length, "", "completed-deals"],
    [systemLabel("depositStatus"), depositDeals.length, "", "deposit-deals"],
    [systemLabel("canceledStatus"), canceledDeals.length, "", "canceled-deals"],
    ["Cần chăm", dueCare.length, dueCare.length ? "warn" : "", "due-care"],
    ["Quá hạn chăm", overdueCare.length, overdueCare.length ? "bad" : "", "overdue-care"],
    ["KPI chờ duyệt", pendingKpi, pendingKpi ? "warn" : "", "pending-kpi"],
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
          ${d.deliveryDate ? `<span>Hẹn giao: ${esc(fmtDate(d.deliveryDate))}</span>` : ""}
        </div>
        <div>
          <b>${esc(money(dealAmount(d)))}</b>${orderProductText(d) ? ` · ${esc(orderProductText(d))}` : ""}
          <div class="detail-meta">
            <span>Đã thu: ${esc(money(dealPaidAmount(d.id)))}</span>
            <span>Còn nợ: ${esc(money(dealDebtAmount(d)))}</span>
          </div>
        </div>
        ${d.note ? `<div class="detail-note">${esc(d.note)}</div>` : ""}
      </div>
    `;
  }).join("")}</div>` : `<div class="muted">Không có đơn hàng trong nhóm này.</div>`;
}

function openCareDashboardDetail(type) {
  if (!isManager()) return;
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
  if (!isManager()) return;
  const rows = currentReportCustomers();
  const month = currentMonth();
  const matched = type === "month-customers" ? rows.filter(c => monthOf(c.createdAt) === month) : rows;
  openDetailModal(
    type === "month-customers" ? "Khách mới tháng này" : "Khách đang quản lý",
    `${matched.length} khách`,
    customerDetailRows([...matched].sort(byDateDesc))
  );
}

function openDashboardDealDetail(type) {
  if (!isManager()) return;
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
      <b>${esc(fmtDate(l.createdAt))} · ${esc(l.careResult || l.status || "Chăm sóc")}</b>
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
    const batch = writeBatch(db);
    batch.update(doc(db, "customers", c.id), {
      nextCareDate,
      follow: computedFollowStatus({...c, nextCareDate}),
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser.email || ""
    });
    batch.set(doc(collection(db, "auditLogs")), {
      action: "snoozeTask", entity: "customers", entityId: c.id,
      email: currentUser.email || "",
      payloadJson: JSON.stringify({before: c.nextCareDate || "", after: nextCareDate, days}),
      createdAt: serverTimestamp()
    });
    await batch.commit();
    notice(`Đã dời lịch chăm sang ${fmtDate(nextCareDate)}.`);
  } catch (err) {
    notice(authMessage(err), true);
  }
}

function jumpToPendingKpi() {
  if (!isManager()) return;
  setMainView("kpi");
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
      return normalizeKey([c.name, c.companyName, c.phoneRaw, c.phoneNormalized, c.address, c.channel, customerOwnerName(c), c.status, c.need, c.note, computedFollowStatus(c)].join(" ")).includes(key);
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
    return `
      <div class="task-row ${esc(taskClass(type))}">
        <div>
          <div class="task-title">${esc(c.name || "Không tên")}</div>
          <div class="muted">${esc(c.companyName || c.channel || "")}</div>
          <div class="muted">${esc(c.phoneRaw || c.phoneNormalized || "Không SĐT")}</div>
        </div>
        <div>
          <span class="pill ${type === "overdue" ? "red" : type === "upcoming" ? "green" : "orange"}">${esc(taskLabel(type))}</span>
          <div class="muted">${esc(dateText)}${overdueText}</div>
        </div>
        <div>
          <b>${esc(customerOwnerName(c))}</b>
          <div class="muted">${esc(c.need || c.note || "Chưa có nội dung công việc")}</div>
        </div>
        <div class="task-actions">
          <button class="small primary" type="button" data-care-open="${esc(c.id)}">Chăm sóc</button>
          <button class="small" type="button" data-open-template="${esc(c.id)}">Báo giá</button>
          <button class="small" type="button" data-open-deal="${esc(c.id)}">Đơn hàng</button>
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
  box.querySelectorAll("[data-channel-quick]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.channelQuick === activeChannelQuickFilter);
  });
}

function renderCustomers() {
  renderChannelQuickFilters();
  const rows = visibleCustomers();
  const page = pageRows("customers", rows);
  $("customerRows").innerHTML = page.length ? page.map(c => {
    const counts = dealCounts(c.id);
    const st = latestDealStatus(c) || c.status || "";
    const careStatus = computedFollowStatus(c);
    const rowClass = ["customer-row", isFailStatus(st) || isCanceledDeal(st) ? "row-fail" : "", purchaseCount(c.id) ? "row-success row-vip" : "", isCareOverdue(c) ? "row-overdue" : ""].filter(Boolean).join(" ");
    const careBadge = isCareOverdue(c) ? `<br><span class="pill red">Quá ${esc(careDeltaDays(c))} ngày</span>` : isCareDue(c) ? `<br><span class="pill orange">${esc(systemLabel("dueFollow"))}</span>` : "";
    const contactText = c.phoneRaw || c.phoneNormalized || "Không SĐT";
    const customerMeta = [c.companyName, c.address].filter(Boolean).join(" · ");
    const statusClass = isFailStatus(st) || isCanceledDeal(st) ? "red" : purchaseCount(c.id) ? "green" : "orange";
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
      <td><span class="pill ${sameLabel(careStatus, "overdueFollow") ? "red" : sameLabel(careStatus, "dueFollow") ? "orange" : sameLabel(careStatus, "closedFollow") ? "" : "green"}">${esc(careStatus)}</span></td>
      <td>
        <div class="deal-counts">
          <span><b>${esc(counts.deposit)}</b> ${esc(systemLabel("depositStatus"))}</span>
          <span><b>${esc(counts.bought)}</b> ${esc(systemLabel("boughtStatus"))}</span>
          <span><b>${esc(counts.canceled)}</b> ${esc(systemLabel("canceledStatus"))}</span>
        </div>
      </td>
      <td>${esc(fmtDate(c.nextCareDate))}${careBadge}</td>
      <td class="note-col">${esc(c.note || "")}</td>
      <td class="action-col"><div class="row-actions">
        <button class="small primary" data-open-care="${esc(c.id)}">Chăm sóc KH</button>
        <button class="small" data-open-deal="${esc(c.id)}">Đơn hàng</button>
        <button class="small" data-open-template="${esc(c.id)}">Báo giá/Đề xuất</button>
        <button class="small primary" data-open-kpi-proposal-customer="${esc(c.id)}">Đề xuất KPI</button>
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
  const ownerKeys = reportOwnerKeys();
  const dynamicHeads = monthRules.map(rule => `
    <th>
      <span title="${esc(rule.description || "Chưa có diễn giải.")}">${esc(rule.name)}</span>
      ${rule.description ? `<div><button class="small" type="button" data-kpi-rule-explain="${esc(rule.id)}">Diễn giải</button></div>` : ""}
    </th>
  `).join("");
  $("kpiHead").innerHTML = `<tr>
    <th>Nhân viên</th><th>Chỉ tiêu</th><th>Thực hiện</th><th>Đơn hoàn thành</th><th>${esc(systemLabel("depositStatus"))}</th><th>${esc(systemLabel("boughtStatus"))}</th><th>${esc(systemLabel("canceledStatus"))}</th><th>Doanh số</th>${dynamicHeads}<th>Tỉ lệ mua</th><th>${esc(systemLabel("dueFollow"))}</th><th>Quá hạn</th>
  </tr>`;
  $("kpiRows").innerHTML = ownerKeys.map(o => {
    const profile = ownerProfileByValue(o);
    const cs = customers.filter(c => canSeeCustomer(c) && (sameIdentity(customerOwnerKey(c), o) || sameIdentity(c.owner, o)));
    if (!cs.length && !isManager() && !monthRules.some(rule => kpiRuleAppliesToOwner(rule, o))) return "";
    const ids = new Set(cs.map(c => c.id));
    const ds = deals.filter(d => ids.has(d.customerId));
    const monthLead = week ? cs.filter(c => weekOf(c.createdAt) === week).length : month ? cs.filter(c => monthOf(c.createdAt) === month).length : cs.length;
    const closeCount = ds.filter(isCompletedDeal).length;
    const dealCount = ds.filter(isCompletedDeal).length;
    const boughtCustomerCount = cs.filter(c => customerHasCompletedDeal(c.id)).length;
    const cancelCount = ds.filter(d => sameLabel(normalizeDealStatus(d.dealStatus), "canceledStatus")).length;
    const due = cs.filter(isCareDue).length;
    const overdue = cs.filter(isCareOverdue).length;
    const revenue = ds.filter(isKpiRevenueDeal).reduce((sum, d) => sum + dealAmount(d), 0);
    const rate = cs.length ? Math.round(boughtCustomerCount / cs.length * 100) : 0;
    const ruleCells = monthRules.map(rule => {
      if (!kpiRuleAppliesToOwner(rule, o)) return `<td><span class="muted">Không gán</span></td>`;
      const value = kpiRuleValue(rule, o);
      const target = kpiRuleTargetForOwner(rule, o);
      const cls = target && value >= target ? "green" : "";
      return `<td><button class="kpi-progress-btn ${cls}" type="button" title="Xem chi tiết KPI đã gửi" data-kpi-owner-detail="${esc(rule.id)}" data-owner-key="${esc(o)}">${kpiProgressHtml(value, target)}</button></td>`;
    }).join("");
    return `<tr class="kpi-row"><td><b>${esc(profile.name || o)}</b><div class="muted">${esc(profile.email && profile.email !== profile.name ? profile.email : "")}</div></td><td>${cs.length}</td><td>${monthLead}</td><td>${dealCount}</td><td>${ds.filter(d=>sameLabel(normalizeDealStatus(d.dealStatus),"depositStatus")).length}</td><td>${closeCount}</td><td>${cancelCount}</td><td>${esc(money(revenue))}</td>${ruleCells}<td><span class="pill ${rate >= 30 ? "green" : rate ? "orange" : ""}">${rate}%</span></td><td>${due}</td><td>${overdue}</td></tr>`;
  }).join("") || `<tr><td colspan="${9 + monthRules.length}" class="muted">Chưa có KPI.</td></tr>`;
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
    const ds = deals.filter(d => ids.has(d.customerId));
    const closeCount = ds.filter(isCompletedDeal).length;
    const boughtCustomerCount = cs.filter(c => customerHasCompletedDeal(c.id)).length;
    const revenue = ds.filter(isKpiRevenueDeal).reduce((sum, d) => sum + dealAmount(d), 0);
    const rate = cs.length ? Math.round(boughtCustomerCount / cs.length * 100) : 0;
    const row = {
      owner: clean(profile.name || o),
      email: clean(profile.email && profile.email !== profile.name ? profile.email : o),
      totalCustomers: cs.length,
      monthLead: week ? cs.filter(c => weekOf(c.createdAt) === week).length : month ? cs.filter(c => monthOf(c.createdAt) === month).length : cs.length,
      completedDeals: closeCount,
      depositDeals: ds.filter(d => sameLabel(normalizeDealStatus(d.dealStatus), "depositStatus")).length,
      boughtDeals: closeCount,
      canceledDeals: ds.filter(d => sameLabel(normalizeDealStatus(d.dealStatus), "canceledStatus")).length,
      revenue,
      conversionRate: rate,
      dueCare: cs.filter(isCareDue).length,
      overdueCare: cs.filter(isCareOverdue).length,
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
    .filter(p => kpiProposalMonth(p) === month && !p.isDeleted)
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
    "Nhân viên / Email","Tổng khách","Khách mới kỳ này","Đơn hoàn thành",
    systemLabel("depositStatus"), systemLabel("boughtStatus"), systemLabel("canceledStatus"),
    "Doanh số","Tỉ lệ mua", systemLabel("dueFollow"), "Quá hạn", ...dynamicHeads
  ];
  const summaryTable = [
    [`Báo cáo KPI tháng ${month}${week ? " · tuần " + week : ""}`, ...Array(Math.max(0, summaryHeader.length - 1)).fill("")],
    summaryHeader,
    ...summaryRows.map(row => [
      personExportCell(row.owner, row.email), row.totalCustomers, row.monthLead, row.completedDeals,
      row.depositDeals, row.boughtDeals, row.canceledDeals, money(row.revenue),
      `${row.conversionRate}%`, row.dueCare, row.overdueCare,
      ...monthRules.flatMap(rule => {
        const item = row.rules[rule.id] || {value:"", target:""};
        const percent = item.target ? Math.round(item.value / item.target * 100) + "%" : "";
        return [item.value, item.target, percent];
      })
    ])
  ];
  const proposalHeader = ["Nhân viên / Email","KPI","Tháng","SĐT","Bộ phận","Khách hàng","SĐT KH","Công ty","Kênh KH","Trạng thái","Nội dung","Minh chứng","Gửi lúc","Người duyệt","Ngày duyệt","Ghi chú duyệt"];
  const proposalTable = [
    [`Chi tiết đề xuất KPI tháng ${month}`, ...Array(proposalHeader.length - 1).fill("")],
    proposalHeader,
    ...proposalRows.map(p => [
      personExportCell(p.owner, p.email || p.ownerEmail), p.kpiName || "", kpiProposalMonth(p), p.phone || "", p.department || "",
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
  ], `crm-kpi-report-${month}`) && logged) notice("Đã xuất báo cáo KPI và ghi log thao tác.");
}

async function logManagementExport(report) {
  await setDoc(doc(collection(db, "auditLogs")), {
    action: "exportManagementReport",
    entity: "managementReports",
    entityId: currentMonth(),
    email: currentUser?.email || "",
    payloadJson: JSON.stringify({
      totalCustomers: report.customers.length,
      deals: report.deals.length,
      pipelineGroups: report.pipeline.length,
      pendingKpi: report.pendingKpi
    }),
    createdAt: serverTimestamp()
  });
}

async function exportManagementReport() {
  if (!isManager()) return notice("Chỉ admin/manager được xuất báo cáo quản trị.", true);
  const report = {
    customers: currentReportCustomers(),
    deals: currentReportDeals(),
    pipeline: pipelineReportData(),
    pendingKpi: kpiProposals.filter(p => isPendingKpiProposal(p) && !p.isDeleted).length
  };
  const completed = report.deals.filter(isCompletedDeal);
  const pending = report.deals.filter(isActiveDeal);
  const summaryRows = [
    ["Báo cáo quản trị CRM", ""],
    ["Thời điểm xuất", new Date().toLocaleString("vi-VN")],
    ["Người xuất", currentUser?.email || ""],
    ["Tổng khách", report.customers.length],
    ["Khách mới tháng này", report.customers.filter(c => monthOf(c.createdAt) === currentMonth()).length],
    ["Cần chăm", report.customers.filter(isCareDue).length],
    ["Quá hạn chăm", report.customers.filter(isCareOverdue).length],
    ["Deal đang xử lý", pending.length],
    ["Đơn hoàn thành", completed.length],
    ["Doanh số hoàn thành", money(completed.reduce((sum,d) => sum + dealAmount(d), 0))],
    ["KPI chờ duyệt", report.pendingKpi]
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

function renderKpiAssignmentBuilder() {
  if (!isManager()) return;
  const users = kpiAssignableUsers();
  const editingRule = editingKpiRuleId ? kpiRules.find(r => r.id === editingKpiRuleId) : null;
  const assigned = editingRule ? kpiRuleAssignedOwners(editingRule) : [];
  const defaultTarget = Number($("kpiRuleTarget")?.value || 0);
  $("kpiAssignRows").innerHTML = users.length ? users.map(u => `
    <label class="kpi-assign-row">
      <input type="checkbox" data-kpi-assign-email="${esc(u.email)}" ${!editingRule || assigned.includes(u.email) ? "checked" : ""}>
      <span><b>${esc(u.name || u.email)}</b><div class="muted">${esc(u.email)}</div></span>
      <input type="number" min="0" step="1" value="${esc(editingRule ? kpiRuleTargetForOwner(editingRule, u.email) : (defaultTarget || ""))}" placeholder="Chỉ tiêu" data-kpi-target-email="${esc(u.email)}">
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
        <td><div class="actions"><button class="small" data-edit-kpi-rule="${esc(rule.id)}">Sửa</button><button class="small" data-kpi-rule-proposals="${esc(rule.id)}">Chi tiết KPI</button>${rule.active === false ? `<button class="small primary" data-activate-kpi-rule="${esc(rule.id)}">Bật lại</button>` : `<button class="small danger" data-disable-kpi-rule="${esc(rule.id)}">Tắt</button>`}</div></td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="5" class="muted">Chưa có KPI.</td></tr>`;
}

function renderKpiRuleList() {
  if (!isManager()) return;
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
          ${isAdmin() ? `<button class="small danger" data-delete-kpi-proposal="${esc(p.id)}">Xóa test</button>` : ""}
          <button class="small primary" data-approve-kpi-proposal="${esc(p.id)}">Duyệt</button>
          <button class="small danger" data-reject-kpi-proposal="${esc(p.id)}">Từ chối</button>
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
              ${rule ? `<span>Chỉ tiêu: ${esc(rule.target || 0)}</span>` : ""}
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
            ${isAdmin() ? `<button class="small danger" data-delete-kpi-proposal="${esc(p.id)}">Xóa KPI test</button>` : ""}
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
          ${isAdmin() ? `<button class="small danger" data-delete-kpi-proposal="${esc(p.id)}">Xóa test</button>` : ""}
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
  return [ownerEmail(), ownerName()].some(key => kpiProposalMatchesOwner(proposal, key));
}

function canSoftDeleteKpiProposal(proposal) {
  if (!proposal || proposal.isDeleted || isAdmin() || !isPendingKpiProposal(proposal)) return false;
  return [ownerEmail(), ownerName()].some(key => kpiProposalMatchesOwner(proposal, key));
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
  if (editingKpiProposalId && !canEditKpiProposal(existingProposal)) return notice("Đề xuất này đã được duyệt/từ chối hoặc bạn không còn quyền sửa.", true);
  const isEditingProposal = Boolean(editingKpiProposalId);
  const proposalRef = editingKpiProposalId ? doc(db, "kpiProposals", editingKpiProposalId) : doc(collection(db, "kpiProposals"));
  const manualEvidence = clean($("proposalEvidenceUrl").value);
  const content = clean($("proposalContent").value);
  if (!content) return notice("Vui lòng nhập nội dung công việc đạt KPI.", true);
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
    const batch = writeBatch(db);
    if (isEditingProposal) batch.update(proposalRef, data);
    else batch.set(proposalRef, data);
    batch.set(doc(collection(db, "auditLogs")), {
      action: isEditingProposal ? "updateKpiProposal" : "submitKpiProposal",
      entity: "kpiProposals",
      entityId: proposalRef.id,
      email: currentUser?.email || "",
      payloadJson: JSON.stringify({before: existingProposal || null, after: {...data, createdAt: undefined, updatedAt: undefined}}),
      createdAt: serverTimestamp()
    });
    await batch.commit();
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
  const nextStatus = status === "approved" ? "approved" : "rejected";
  const reviewNote = nextStatus === "rejected" ? clean(prompt("Lý do từ chối đề xuất KPI này?", "") || "") : "";
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "kpiProposals", proposalId), {
      status: nextStatus,
      reviewNote,
      reviewedByEmail: currentUser?.email || "",
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    batch.set(doc(collection(db, "auditLogs")), {
      action: nextStatus === "approved" ? "approveKpiProposal" : "rejectKpiProposal",
      entity: "kpiProposals",
      entityId: proposalId,
      email: currentUser?.email || "",
      payloadJson: JSON.stringify({before: proposal, status: nextStatus, reviewNote}),
      createdAt: serverTimestamp()
    });
    await batch.commit();
    notice(nextStatus === "approved" ? "Đã duyệt đề xuất KPI." : "Đã từ chối đề xuất KPI.");
  } catch (err) {
    notice("Không cập nhật được đề xuất KPI: " + authMessage(err), true);
  }
}

async function deleteKpiProposal(proposalId) {
  if (!isAdmin()) return notice("Chỉ admin được xóa KPI test.", true);
  const proposal = kpiProposals.find(p => p.id === proposalId);
  if (!proposal) return notice("Không tìm thấy đề xuất KPI.", true);
  if (!confirm(`Xóa KPI test của ${proposal.owner || proposal.ownerEmail || "nhân viên"}? Dòng này sẽ không còn xuất trong báo cáo KPI.`)) return;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, "kpiProposals", proposalId));
    batch.set(doc(collection(db, "auditLogs")), {
      action: "deleteKpiProposal",
      entity: "kpiProposals",
      entityId: proposalId,
      email: currentUser?.email || "",
      payloadJson: JSON.stringify(proposal),
      createdAt: serverTimestamp()
    });
    await batch.commit();
    closeDetailModal();
    notice("Đã xóa KPI test khỏi báo cáo.");
  } catch (err) {
    notice("Không xóa được KPI test: " + authMessage(err), true);
  }
}

async function softDeleteKpiProposal(proposalId) {
  const proposal = kpiProposals.find(p => p.id === proposalId);
  if (!proposal) return notice("Không tìm thấy đề xuất KPI.", true);
  if (!canSoftDeleteKpiProposal(proposal)) return notice("Chỉ đề xuất KPI đang chờ duyệt của bạn mới được xóa.", true);
  if (!confirm("Xóa đề xuất KPI đang chờ duyệt này? Dữ liệu sẽ được ẩn khỏi KPI và vẫn có log kiểm tra khi cần.")) return;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "kpiProposals", proposalId), {
      isDeleted: true,
      deletedByEmail: currentUser?.email || "",
      deletedAt: serverTimestamp(),
      updatedByEmail: currentUser?.email || "",
      updatedAt: serverTimestamp()
    });
    batch.set(doc(collection(db, "auditLogs")), {
      action: "softDeleteKpiProposal",
      entity: "kpiProposals",
      entityId: proposalId,
      email: currentUser?.email || "",
      payloadJson: JSON.stringify(proposal),
      createdAt: serverTimestamp()
    });
    await batch.commit();
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
  if (!isAdmin()) return;
  if ($("safetyCustomersCount")) $("safetyCustomersCount").textContent = allCustomers.length || customers.length;
  if ($("safetyDealsCount")) $("safetyDealsCount").textContent = allDeals.length || deals.length;
  if ($("safetyPaymentsCount")) $("safetyPaymentsCount").textContent = allPayments.length || payments.length;
  if ($("safetyAuditCount")) $("safetyAuditCount").textContent = auditLogs.length;
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
    c.owner, c.ownerEmail, c.status, c.follow, c.nextCareDate, fmtDate(c.createdAt),
    c.isDeleted ? "yes" : "", fmtDate(c.deletedAt), c.note
  ]);
  const careRows = (allCareLogs.length ? allCareLogs : careLogs).map(l => [
    l.id, l.customerId, l.customerName, l.owner, l.ownerEmail, l.status, l.careChannel,
    l.careResult, l.nextCareDate, l.note, fmtDate(l.createdAt), l.isDeleted ? "yes" : ""
  ]);
  const dealRows = (allDeals.length ? allDeals : deals).map(d => [
    d.id, d.customerId, orderCustomerName(d), orderCustomerPhone(d), orderOwnerName(d),
    orderOwnerEmail(d), orderStatusLabel(d), fmtDate(d.dealDate || d.createdAt),
    fmtDate(d.completedAt), fmtDate(d.deliveryDate), deliveryStatusLabel(deliveryStats(d).status),
    dealAmount(d), dealPaidAmount(d.id), dealDebtAmount(d), orderProductText(d),
    d.isDeleted ? "yes" : "", d.note
  ]);
  const orderItemRows = orderItems.map(i => [
    i.id, i.dealId, i.customerId, i.productId, i.productSku, i.productName || i.product,
    i.qty, i.deliveredQty, i.unitPrice || i.price, i.discountAmount, i.lineTotal, i.unit
  ]);
  const paymentRows = (allPayments.length ? allPayments : payments).map(p => [
    p.id, p.paymentNo, p.dealId, p.customerId, p.customerName, p.owner, p.ownerEmail,
    p.amount, p.method, p.status, fmtDate(p.paymentDate || p.createdAt),
    p.receivedByEmail || p.createdByEmail, p.isDeleted ? "yes" : "", p.note
  ]);
  const inventoryRows = (allInventoryMovements.length ? allInventoryMovements : inventoryMovements).map(m => [
    m.id, m.productId, m.productSku, m.productName, m.movementType, m.qty, m.unit,
    m.warehouse, m.refType, m.refId, m.createdByEmail, fmtDate(m.createdAt),
    m.isDeleted ? "yes" : "", m.note
  ]);
  const productRows = products.map(p => [
    p.id, productSku(p), p.name, p.size, p.surface, p.origin, p.color, p.price || "",
    p.priceText || "", productInventoryQty(p), p.active === false ? "no" : "yes", p.description
  ]);
  const quoteRows = (allQuotes.length ? allQuotes : quotes).map(q => [
    q.id, q.quoteNo, q.customerId, q.customerName, q.customerPhone, q.customerCompanyName,
    q.owner, q.ownerEmail, quoteStatusLabel(q.status), fmtDate(q.quoteDate || q.createdAt),
    fmtDate(q.validUntil), q.subtotal, q.discountAmount, q.totalAmount, q.convertedDealId, q.isDeleted ? "yes" : "", q.note
  ]);
  const kpiRuleRows = kpiRules.map(r => [
    r.id, r.month, r.name, r.target, r.countMode, r.active === false ? "no" : "yes",
    jsonCell(r.assignedOwners), jsonCell(r.ownerTargets), r.description
  ]);
  const kpiProposalRows = kpiProposals.map(p => [
    p.id, p.kpiRuleId, p.kpiName, p.month, p.owner, p.ownerEmail, p.customerName,
    p.customerPhone, p.customerCompanyName, p.status, p.reviewedByEmail, fmtDate(p.reviewedAt),
    p.isDeleted ? "yes" : "", p.content, p.evidenceUrl
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
      ["Deals", dealRows.length, ""],
      ["Order items", orderItemRows.length, ""],
      ["Payments", paymentRows.length, ""],
      ["Inventory", inventoryRows.length, ""],
      ["Products", productRows.length, ""],
      ["Quotes", quoteRows.length, ""],
      ["KPI proposals", kpiProposalRows.length, ""],
      ["Users", userRows.length, ""],
      ["Audit logs", auditRows.length, ""]
    ]),
    snapshotSheet("Customers", ["ID","Tên","Công ty","SĐT","SĐT chuẩn","Địa chỉ","Kênh","Owner","Owner email","Trạng thái","Follow","Hẹn chăm","Ngày tạo","Đã ẩn","Ngày ẩn","Ghi chú"], customerRows),
    snapshotSheet("CareLogs", ["ID","Customer ID","Khách","Owner","Owner email","Trạng thái","Kênh chăm","Kết quả","Hẹn tiếp","Ghi chú","Ngày tạo","Đã ẩn"], careRows),
    snapshotSheet("Deals", ["ID","Customer ID","Khách","SĐT","Owner","Owner email","Trạng thái","Ngày đơn","Ngày mua","Hẹn giao","Giao hàng","Giá trị","Đã thu","Còn nợ","Sản phẩm","Đã ẩn","Ghi chú"], dealRows),
    snapshotSheet("OrderItems", ["ID","Deal ID","Customer ID","Product ID","SKU","Sản phẩm","SL","Đã giao","Đơn giá","Chiết khấu","Thành tiền","Đơn vị"], orderItemRows),
    snapshotSheet("Payments", ["ID","Mã thu","Deal ID","Customer ID","Khách","Owner","Owner email","Số tiền","Hình thức","Trạng thái","Ngày thu","Người ghi","Đã xóa mềm","Ghi chú"], paymentRows),
    snapshotSheet("Inventory", ["ID","Product ID","SKU","Sản phẩm","Loại","SL","Đơn vị","Kho","Ref type","Ref ID","Người tạo","Ngày tạo","Đã xóa mềm","Ghi chú"], inventoryRows),
    snapshotSheet("Products", ["ID","SKU","Tên","Size","Bề mặt","Xuất xứ","Màu","Giá","Giá text","Tồn","Active","Mô tả"], productRows),
    snapshotSheet("Quotes", ["ID","Mã BG","Customer ID","Khách","SĐT","Công ty","Owner","Owner email","Trạng thái","Ngày","Hiệu lực","Tạm tính","Chiết khấu","Tổng","Deal chuyển đổi","Đã ẩn","Ghi chú"], quoteRows),
    snapshotSheet("QuoteItems", ["ID","Quote ID","Product ID","SKU","Sản phẩm","SL","Đơn giá","Chiết khấu","Thành tiền"], quoteItems.map(i => [i.id, i.quoteId, i.productId, i.productSku, i.productName || i.productLabel, i.qty, i.unitPrice, i.discountAmount, i.lineTotal])),
    snapshotSheet("KpiRules", ["ID","Tháng","Tên KPI","Chỉ tiêu","Cách tính","Active","Nhân viên gán","Target riêng","Diễn giải"], kpiRuleRows),
    snapshotSheet("KpiProposals", ["ID","Rule ID","KPI","Tháng","Owner","Owner email","Khách","SĐT","Công ty","Trạng thái","Người duyệt","Ngày duyệt","Đã ẩn","Nội dung","Minh chứng"], kpiProposalRows),
    snapshotSheet("Users", ["ID","Email","Tên","Role","Active","Team","Can export","Cập nhật"], userRows),
    snapshotSheet("AuditLogs", ["ID","Thời gian","Email","Action","Entity","Entity ID","Payload"], auditRows)
  ];

  const exported = exportXlsx(sheets, `crm-operational-snapshot-${todayIso()}-${stamp}`);
  if (exported) {
    await logAudit("exportOperationalSnapshot", "exports", "operationalSnapshot", {
      customers: customerRows.length,
      deals: dealRows.length,
      payments: paymentRows.length,
      inventory: inventoryRows.length,
      products: productRows.length,
      auditLogs: auditRows.length
    }).catch(err => notice("Snapshot đã xuất, nhưng chưa ghi được audit log: " + authMessage(err), true));
    notice("Đã xuất snapshot vận hành.");
  }
}

function renderUserAdmin() {
  if (!isAdmin()) return;
  $("userRows").innerHTML = users.length ? users.map(u => {
    const role = clean(u.role || "sale").toLowerCase();
    const active = u.active !== false;
    return `<tr class="admin-user-row ${active ? "" : "locked"}">
      <td>
        <b>${esc(u.name || u.email || u.uid)}</b>
        <div class="muted">${esc(u.email || "")}</div>
        <div class="admin-badge-row">
          <span class="pill ${role === "admin" ? "red" : role === "manager" ? "orange" : "green"}">${esc(role)}</span>
          <span class="pill ${active ? "green" : "red"}">${active ? "active" : "locked"}</span>
        </div>
      </td>
      <td><select data-user-role="${esc(u.uid)}">
        ${["sale","manager","admin"].map(r => `<option value="${r}" ${role===r ? "selected" : ""}>${r}</option>`).join("")}
      </select></td>
      <td><select data-user-active="${esc(u.uid)}"><option value="true" ${active ? "selected" : ""}>active</option><option value="false" ${!active ? "selected" : ""}>locked</option></select></td>
      <td><input data-user-team="${esc(u.uid)}" value="${esc(u.team || "")}" placeholder="Team"></td>
      <td><select data-user-export="${esc(u.uid)}"><option value="false" ${u.canExport !== true ? "selected" : ""}>Không</option><option value="true" ${u.canExport === true ? "selected" : ""}>Có</option></select></td>
      <td>
        <div class="actions">
          <button class="small primary" data-save-user="${esc(u.uid)}">Lưu</button>
          <button class="small" data-toggle-user="${esc(u.uid)}">${active ? "Khóa" : "Mở"}</button>
          <button class="small danger" data-delete-user="${esc(u.uid)}">Xóa</button>
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
  if (!isAdmin()) return notice("Chỉ admin được quản lý nhân viên.", true);
  const user = users.find(u => u.uid === uid);
  if (!user) return notice("Không tìm thấy user.", true);
  const role = clean(document.querySelector(`[data-user-role="${CSS.escape(uid)}"]`)?.value || "sale");
  const active = document.querySelector(`[data-user-active="${CSS.escape(uid)}"]`)?.value === "true";
  const team = clean(document.querySelector(`[data-user-team="${CSS.escape(uid)}"]`)?.value);
  const canExport = document.querySelector(`[data-user-export="${CSS.escape(uid)}"]`)?.value === "true";
  if (sameIdentity(user.email, currentUser?.email) && (!active || role !== "admin")) {
    return notice("Không thể tự khóa hoặc hạ quyền admin của chính bạn.", true);
  }
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "users", uid), {role, active, team, canExport, updatedByEmail: currentUser?.email || "", updatedAt: serverTimestamp()}, {merge:true});
    batch.set(doc(collection(db, "auditLogs")), {
      action: "updateUser", entity: "users", entityId: uid, email: currentUser?.email || "",
      payloadJson: JSON.stringify({targetEmail:user.email || "", role, active, team, canExport}), createdAt: serverTimestamp()
    });
    await batch.commit();
    users = users.map(u => u.uid === uid ? {...u, role, active, team, canExport} : u);
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
  if (!isAdmin()) return notice("Chỉ admin được thêm nhân viên.", true);
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
    const batch = writeBatch(db);
    batch.set(doc(db, "users", uid), payload, {merge:true});
    batch.set(doc(collection(db, "auditLogs")), {
      action: "addUser",
      entity: "users",
      entityId: uid,
      email: currentUser?.email || "",
      payloadJson: JSON.stringify({targetEmail: payload.email, role: payload.role, team: payload.team, canExport: payload.canExport}),
      createdAt: serverTimestamp()
    });
    await batch.commit();
    users = [...users, {uid, ...payload}].sort((a,b) => clean(a.email).localeCompare(clean(b.email)));
    clearNewUserForm();
    hydrateOwnerDependentFilters();
    renderUserAdmin();
    notice("Đã thêm nhân viên. Nhân viên có thể đăng nhập Google bằng email này.");
  } catch (err) {
    notice("Không thêm được nhân viên: " + authMessage(err), true);
  }
}

async function toggleUserAdmin(uid) {
  if (!isAdmin()) return notice("Chỉ admin được khóa/mở nhân viên.", true);
  const user = users.find(u => u.uid === uid);
  if (!user) return notice("Không tìm thấy user.", true);
  const nextActive = user.active === false;
  if (!nextActive && sameIdentity(user.email, currentUser?.email)) return notice("Không thể tự khóa tài khoản của chính bạn.", true);
  if (!confirm(`${nextActive ? "Mở lại" : "Khóa"} nhân viên ${user.email || user.name || uid}?`)) return;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "users", uid), {active: nextActive, updatedByEmail: currentUser?.email || "", updatedAt: serverTimestamp()}, {merge:true});
    batch.set(doc(collection(db, "auditLogs")), {
      action: nextActive ? "unlockUser" : "lockUser",
      entity: "users",
      entityId: uid,
      email: currentUser?.email || "",
      payloadJson: JSON.stringify({targetEmail: user.email || "", active: nextActive}),
      createdAt: serverTimestamp()
    });
    await batch.commit();
    users = users.map(u => u.uid === uid ? {...u, active: nextActive} : u);
    hydrateOwnerDependentFilters();
    renderUserAdmin();
    notice(nextActive ? "Đã mở lại nhân viên." : "Đã khóa nhân viên.");
  } catch (err) {
    notice("Không cập nhật trạng thái nhân viên: " + authMessage(err), true);
  }
}

async function deleteUserAdmin(uid) {
  if (!isAdmin()) return notice("Chỉ admin được xóa nhân viên.", true);
  const user = users.find(u => u.uid === uid);
  if (!user) return notice("Không tìm thấy user.", true);
  if (sameIdentity(user.email, currentUser?.email)) return notice("Không thể xóa tài khoản của chính bạn.", true);
  if (!confirm(`Xóa quyền truy cập của ${user.email || user.name || uid}? Hành động này không xóa dữ liệu khách/đơn đã tạo.`)) return;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, "users", uid));
    batch.set(doc(collection(db, "auditLogs")), {
      action: "deleteUser",
      entity: "users",
      entityId: uid,
      email: currentUser?.email || "",
      payloadJson: JSON.stringify({targetEmail: user.email || "", role: user.role || ""}),
      createdAt: serverTimestamp()
    });
    await batch.commit();
    users = users.filter(u => u.uid !== uid);
    hydrateOwnerDependentFilters();
    renderUserAdmin();
    notice("Đã xóa quyền truy cập nhân viên.");
  } catch (err) {
    notice("Không xóa được nhân viên: " + authMessage(err), true);
  }
}

function renderAll() {
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
    <div class="field"><label>Tên sản phẩm</label><input data-deal-product list="productOptions" value="${esc(productText)}" placeholder="Gõ tên/mã để chọn từ danh mục"><div class="muted" data-deal-product-meta>${esc(meta)}</div></div>
    <div class="field"><label>Mã hàng</label><input data-deal-code value="${esc(item.code || "")}"></div>
    <div class="field"><label>Số lượng</label><input data-deal-qty value="${esc(item.qty || "")}" placeholder="12 hộp, 1 hộp..."></div>
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
  if ($("saveDealBtn")) $("saveDealBtn").textContent = editingDealId ? "Cập nhật đơn" : "Tạo đơn";
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
  ["name","phone","address","companyName","need","note"].forEach(id => { if ($(id)) $(id).value = ""; });
  ["source","channel","customerType","partnerType","partnerActivity","partnerLevel","partnerCapacity"].forEach(id => { if ($(id)) $(id).value = ""; });
  hydrateChannelOptions();
  togglePartnerFields();
  if (isManager()) $("owner").value = "";
  $("name")?.focus();
}

async function saveCustomer() {
  const phone = phoneNorm($("phone").value);
  const selectedOwner = isManager() ? ownerProfileByValue($("owner").value) : {name: ownerName(), email: ownerEmail()};
  const owner = clean(selectedOwner.name);
  const selectedOwnerEmail = clean(selectedOwner.email);
  const data = {
    name: clean($("name").value), phoneRaw: clean($("phone").value), phoneNormalized: phone,
    address: clean($("address").value), source: "", channel: clean($("channel").value), customerType: "",
    owner, ownerEmail: selectedOwnerEmail, need: clean($("need").value), note: clean($("note").value),
    noPhone: !phone,
    companyName: isPartnerChannel(clean($("channel").value)) ? clean($("companyName").value) : "",
    partnerType: isPartnerChannel(clean($("channel").value)) ? clean($("partnerType").value) : "",
    partnerActivity: isPartnerChannel(clean($("channel").value)) ? clean($("partnerActivity").value) : "",
    partnerLevel: isPartnerChannel(clean($("channel").value)) ? clean($("partnerLevel").value) : "",
    partnerCapacity: isPartnerChannel(clean($("channel").value)) ? clean($("partnerCapacity").value) : "",
    status: systemLabel("leadStatus"), follow: systemLabel("noDateFollow"), nextCareDate: "", isDeleted: false,
    createdByEmail: currentUser.email || "", updatedByEmail: currentUser.email || "",
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  };
  if (!data.name) return notice("Vui lòng nhập tên khách.", true);
  if (isPartnerChannel(data.channel) && !data.companyName) return notice("Vui lòng nhập tên công ty.", true);
  if (!data.ownerEmail && !data.owner) return notice("Vui lòng chọn nhân viên phụ trách.", true);

  try {
    const customerRef = doc(collection(db, "customers"));
    const phoneRef = data.phoneNormalized ? doc(db, "phoneIndex", data.phoneNormalized) : null;
    const auditRef = doc(collection(db, "auditLogs"));
    await runTransaction(db, async tx => {
      if (phoneRef) {
        const phoneSnap = await tx.get(phoneRef);
        if (phoneSnap.exists()) {
          const err = new Error("SĐT đã tồn tại. Hãy mở khách cũ để thêm lần mua hàng/KPI.");
          err.duplicateCustomerId = phoneSnap.data().customerId;
          throw err;
        }
      }
      tx.set(customerRef, data);
      if (phoneRef) {
        tx.set(phoneRef, {
          customerId: customerRef.id,
          owner: data.owner,
          ownerEmail: data.ownerEmail,
          createdByEmail: currentUser.email || "",
          createdAt: serverTimestamp()
        });
      }
      tx.set(auditRef, {
        action: "addCustomer", entity: "customers", entityId: customerRef.id,
        email: currentUser.email || "", payloadJson: JSON.stringify(data), createdAt: serverTimestamp()
      });
    });
    clearForm();
    notice("Đã lưu khách mới.");
  } catch (err) {
    if (err.duplicateCustomerId) {
      const existing = customers.find(c => c.id === err.duplicateCustomerId);
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
  const nextCareDateInput = clean($("careNextDate").value);
  const closeCare = sameLabel($("careResult").value, "noNeedStatus") || sameLabel($("careResult").value, "closedFollow");
  const nextStatus = closeCare ? systemLabel("noNeedStatus") : clean($("careStatus").value);
  const nextCareDate = closeCare ? "" : nextCareDateInput;
  const nextFollow = computedFollowStatus({...c, status: nextStatus || c.status, nextCareDate});
  const log = {
    customerId: c.id, customerName: c.name || "", phoneNormalized: c.phoneNormalized || "",
    owner: c.owner || "", ownerEmail: c.ownerEmail || "", status: nextStatus, follow: nextFollow,
    careChannel: clean($("careChannel").value), careResult: clean($("careResult").value),
    companyName: isPartnerChannel(c.channel) ? clean($("careCompanyName").value) : "",
    partnerType: isPartnerChannel(c.channel) ? clean($("carePartnerType").value) : "",
    partnerActivity: isPartnerChannel(c.channel) ? clean($("carePartnerActivity").value) : "",
    partnerLevel: isPartnerChannel(c.channel) ? clean($("carePartnerLevel").value) : "",
    partnerCapacity: isPartnerChannel(c.channel) ? clean($("carePartnerCapacity").value) : "",
    need: clean($("careNeed").value), note: clean($("careNote").value),
    nextCareDate, createdByEmail: currentUser.email || "",
    createdAt: serverTimestamp()
  };
  try {
    const batch = writeBatch(db);
    const logRef = doc(collection(db, "careLogs"));
    const customerRef = doc(db, "customers", c.id);
    const auditRef = doc(collection(db, "auditLogs"));
    batch.set(logRef, log);
    batch.update(customerRef, {
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
      lastContactAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser.email || ""
    });
    batch.set(auditRef, {
      action: "addCareLog", entity: "careLogs", entityId: c.id,
      email: currentUser.email || "", payloadJson: JSON.stringify(log), createdAt: serverTimestamp()
    });
    await batch.commit();
    notice("Đã lưu chăm sóc.");
  } catch (err) {
    notice(authMessage(err), true);
  }
}

async function saveDeal() {
  if (editingDealId) return updateDeal(editingDealId);
  const c = customers.find(x => x.id === selectedCustomerId);
  if (!c || !canEditCustomer(c)) return notice("Bạn không có quyền tạo đơn cho khách này.", true);
  if (!clean($("dealCustomerName").value)) return notice("Vui lòng nhập tên khách trong đơn hàng.", true);
  const {dealStatus, completed, canceled, depositPercent, amount, items, deal} = dealFormDataForCustomer(c);
  if (depositPercent < 0 || depositPercent > 100) return notice("Tỷ lệ cọc phải từ 0 đến 100%.", true);
  deal.createdByEmail = currentUser.email || "";
  deal.createdAt = serverTimestamp();
  if (!items.length) return notice("Vui lòng thêm ít nhất 1 sản phẩm.", true);
  try {
    const batch = writeBatch(db);
    const dealRef = doc(collection(db, "deals"));
    const dealWithId = {...deal, id: dealRef.id};
    const customerRef = doc(db, "customers", c.id);
    const auditRef = doc(collection(db, "auditLogs"));
    batch.set(dealRef, deal);
    writeOrderItemsForDeal(batch, dealWithId, items);
    batch.update(customerRef, {
      dealStatus: deal.dealStatus,
      status: completed ? systemLabel("boughtStatus") : canceled ? systemLabel("activeStatus") : systemLabel("depositStatus"),
      follow: completed ? systemLabel("closedFollow") : canceled ? systemLabel("dueFollow") : systemLabel("activeFollow"),
      nextCareDate: completed ? "" : canceled ? todayIso() : c.nextCareDate || "",
      need: deal.product || c.need || "",
      note: deal.note || c.note || "",
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser.email || ""
    });
    batch.set(auditRef, {
      action: "addDeal", entity: "deals", entityId: c.id,
      email: currentUser.email || "", payloadJson: JSON.stringify(deal), createdAt: serverTimestamp()
    });
    await batch.commit();
    resetDealForm(c);
    notice("Đã tạo đơn hàng.");
  } catch (err) {
    notice(authMessage(err), true);
  }
}

async function updateDeal(dealId) {
  const oldDeal = deals.find(d => d.id === dealId);
  if (!oldDeal) return notice("Không tìm thấy đơn hàng để cập nhật.", true);
  if (!canEditDeal(oldDeal)) return notice("Bạn không có quyền sửa đơn hàng này.", true);
  const c = customers.find(x => x.id === oldDeal.customerId) || customers.find(x => x.id === selectedCustomerId);
  if (!c) return notice("Không tìm thấy khách của đơn hàng.", true);
  if (!clean($("dealCustomerName").value)) return notice("Vui lòng nhập tên khách trong đơn hàng.", true);
  const {dealStatus, completed, canceled, depositPercent, items, deal} = dealFormDataForCustomer(c);
  if (depositPercent < 0 || depositPercent > 100) return notice("Tỷ lệ cọc phải từ 0 đến 100%.", true);
  if (!items.length) return notice("Vui lòng thêm ít nhất 1 sản phẩm.", true);
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
    const batch = writeBatch(db);
    batch.update(doc(db, "deals", oldDeal.id), updatedDeal);
    writeOrderItemsForDeal(batch, {...oldDeal, ...updatedDeal, id: oldDeal.id}, items, orderItems.filter(item => item.dealId === oldDeal.id));
    batch.update(doc(db, "customers", oldDeal.customerId), customerDealStatePatch(oldDeal.customerId, oldDeal.id, {...oldDeal, ...updatedDeal, id: oldDeal.id}));
    batch.set(doc(collection(db, "auditLogs")), {
      action: "updateDeal", entity: "deals", entityId: oldDeal.id,
      email: currentUser.email || "",
      payloadJson: JSON.stringify({before: oldDeal, after: updatedDeal}),
      createdAt: serverTimestamp()
    });
    await batch.commit();
    resetDealForm(c);
    renderHistories(c.id);
    showDealList(isCompletedDeal(updatedDeal) ? "completed" : "pending");
    notice("Đã cập nhật đơn hàng.");
  } catch (err) {
    notice(authMessage(err), true);
  }
}

async function completeDeal(dealId) {
  const deal = deals.find(d => d.id === dealId);
  if (!deal || deal.completed) return;
  if (!canEditDeal(deal)) return notice("Bạn không có quyền hoàn thành đơn hàng này.", true);
  if (isFailStatus(deal.dealStatus) || isCanceledDeal(deal.dealStatus)) return notice("Đơn đã hủy/rớt không thể hoàn thành.", true);
  try {
    const batch = writeBatch(db);
    const customerRef = doc(db, "customers", deal.customerId);
    batch.update(doc(db, "deals", deal.id), {
      dealStatus: systemLabel("boughtStatus"),
      completed: true,
      completedAt: serverTimestamp(),
      completedByEmail: currentUser.email || "",
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser.email || ""
    });
    batch.update(customerRef, {
      dealStatus: systemLabel("boughtStatus"),
      status: systemLabel("boughtStatus"),
      follow: systemLabel("closedFollow"),
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser.email || ""
    });
    batch.set(doc(collection(db, "auditLogs")), {
      action: "completeDeal", entity: "deals", entityId: deal.id,
      email: currentUser.email || "", payloadJson: JSON.stringify({customerId: deal.customerId}), createdAt: serverTimestamp()
    });
    await batch.commit();
    notice("Đã hoàn thành đơn hàng. Đơn này đã được tính vào lần mua.");
  } catch (err) {
    notice(authMessage(err), true);
  }
}

async function cancelDeal(dealId) {
  const deal = deals.find(d => d.id === dealId);
  if (!deal || deal.completed || isCanceledDeal(deal.dealStatus)) return;
  if (!canEditDeal(deal)) return notice("Bạn không có quyền hủy đơn hàng này.", true);
  const ok = confirm("Hủy đơn hàng này vì khách đổi ý?");
  if (!ok) return;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "deals", deal.id), {
      dealStatus: systemLabel("canceledStatus"),
      canceled: true,
      canceledAt: serverTimestamp(),
      canceledByEmail: currentUser.email || "",
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser.email || ""
    });
    const otherActiveDeals = customerDeals(deal.customerId).filter(d => d.id !== deal.id && !isCanceledDeal(d.dealStatus) && !isFailStatus(d.dealStatus));
    const hasBought = otherActiveDeals.some(d => sameLabel(normalizeDealStatus(d.dealStatus), "boughtStatus") || d.completed === true);
    const hasDeposit = otherActiveDeals.some(d => sameLabel(normalizeDealStatus(d.dealStatus), "depositStatus"));
    batch.update(doc(db, "customers", deal.customerId), {
      dealStatus: hasBought ? systemLabel("boughtStatus") : hasDeposit ? systemLabel("depositStatus") : systemLabel("canceledStatus"),
      status: hasBought ? systemLabel("boughtStatus") : hasDeposit ? systemLabel("depositStatus") : systemLabel("activeStatus"),
      follow: hasBought ? systemLabel("closedFollow") : systemLabel("dueFollow"),
      nextCareDate: hasBought ? "" : todayIso(),
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser.email || ""
    });
    batch.set(doc(collection(db, "auditLogs")), {
      action: "cancelDeal", entity: "deals", entityId: deal.id,
      email: currentUser.email || "", payloadJson: JSON.stringify({customerId: deal.customerId}), createdAt: serverTimestamp()
    });
    await batch.commit();
    notice("Đã hủy đơn hàng.");
  } catch (err) {
    notice(authMessage(err), true);
  }
}

function openDeliveryModal(dealId) {
  const deal = deals.find(d => d.id === dealId);
  if (!deal) return notice("Không tìm thấy đơn hàng.", true);
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
    const batch = writeBatch(db);
    batch.update(doc(db, "deals", deal.id), {
      isDeleted: true,
      deletedAt: serverTimestamp(),
      deletedByEmail: currentUser.email || "",
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser.email || ""
    });
    batch.update(doc(db, "customers", deal.customerId), customerDealStatePatch(deal.customerId, deal.id));
    batch.set(doc(collection(db, "auditLogs")), {
      action: "softDeleteDeal", entity: "deals", entityId: deal.id,
      email: currentUser.email || "", payloadJson: JSON.stringify({customerId: deal.customerId}), createdAt: serverTimestamp()
    });
    await batch.commit();
    notice("Đã xóa mềm đơn hàng.");
  } catch (err) {
    notice(authMessage(err), true);
  }
}

function reviewDeal(dealId) {
  const d = deals.find(x => x.id === dealId);
  if (!d) return;
  const ship = deliveryStats(d);
  const itemRows = dealOrderItems(d);
  const items = itemRows.length
    ? itemRows.map((item, idx) => {
      const qty = Math.max(0, qtyNumber(item.qty));
      const delivered = Math.max(0, Number(item.deliveredQty || 0));
      return `
      <div class="detail-row">
        <b>${esc(idx + 1)}. ${esc(item.productName || item.product || item.productLabel || "Sản phẩm")}</b>
        <div class="detail-meta">
          ${item.productSku || item.code ? `<span>Mã: ${esc(item.productSku || item.code)}</span>` : ""}
          ${item.size ? `<span>Size: ${esc(item.size)}</span>` : ""}
          ${item.surface ? `<span>Bề mặt: ${esc(item.surface)}</span>` : ""}
          ${item.origin ? `<span>Xuất xứ: ${esc(item.origin)}</span>` : ""}
          <span>SL: ${esc(qty || item.qty || 0)}</span>
          <span>Đã giao: ${esc(delivered)}</span>
          <span>Còn: ${esc(Math.max(0, qty - delivered))}</span>
        </div>
      </div>
    `;}).join("")
    : `<div class="detail-row">${esc(d.product || "Chưa có sản phẩm")}${d.quantity ? ` · SL: ${esc(d.quantity)}` : ""}</div>`;
  openDetailModal(
    `Chi tiết đơn - ${orderCustomerName(d) || "Khách hàng"}`,
    `${orderCustomerPhone(d) || "Không SĐT"} · ${orderOwnerName(d) || ""}`,
    `
      <div class="profile-stats">
        ${profileStat("Trạng thái", orderStatusLabel(d))}
        ${profileStat("Giá trị", money(d.amount || 0))}
        ${profileStat("Đã cọc", `${d.depositPercent ?? 0}%`)}
        ${profileStat("Ngày đơn", fmtDate(d.dealDate || d.createdAt) || "-")}
        ${profileStat("Giao hàng", `${deliveryStatusLabel(ship.status)} (${ship.delivered}/${ship.total || "-"})`)}
      </div>
      <div class="info-grid">
        ${infoCell("Địa chỉ giao hàng", d.deliveryAddress)}
        ${infoCell("Mã số thuế", d.taxCode)}
        ${infoCell("Ngày mua", fmtDate(d.completedAt))}
        ${infoCell("Ngày giao", fmtDate(d.deliveryDate))}
      </div>
      <div class="section">
        <h3>Sản phẩm</h3>
        <div class="detail-list">${items}</div>
      </div>
      <div class="section">
        <h3>Ghi chú</h3>
        <div class="detail-note">${esc(d.note || "Không có ghi chú.")}</div>
      </div>
      <div class="actions">
        <button class="small" type="button" data-open-care="${esc(d.customerId)}">Mở khách</button>
        <button class="small primary" type="button" data-delivery-deal="${esc(d.id)}">Giao hàng</button>
        <button class="small" type="button" data-print-delivery="${esc(d.id)}">In phiếu giao</button>
        ${canEditDeal(d) ? `<button class="small primary" type="button" data-edit-deal="${esc(d.id)}">Sửa đơn</button>` : ""}
      </div>
    `
  );
}

function editDeal(dealId) {
  const d = deals.find(x => x.id === dealId);
  if (!d) return notice("Không tìm thấy đơn hàng.", true);
  if (!canEditDeal(d)) return notice("Bạn không có quyền sửa đơn hàng này.", true);
  closeDetailModal();
  openDrawer(d.customerId, "deal");
  populateDealForm(d);
  $("drawerTitle").textContent = `Sửa đơn - ${orderCustomerName(d) || d.customerName || "Khách hàng"}`;
}

async function deleteCustomer() {
  if (!isManager()) return notice("Chỉ admin/manager được xóa khách.", true);
  const c = customers.find(x => x.id === selectedCustomerId);
  if (!c) return;
  const ok = confirm(`Ẩn khách "${c.name}"? Dữ liệu sẽ được lưu lại trong hệ thống/audit log và SĐT sẽ được giải phóng để nhập lại nếu cần.`);
  if (!ok) return;
  const relatedLogs = careLogs.filter(l => l.customerId === c.id);
  const relatedDeals = deals.filter(d => d.customerId === c.id);
  const refs = [
    ...relatedLogs.map(l => doc(db, "careLogs", l.id)),
    ...relatedDeals.map(d => doc(db, "deals", d.id))
  ];
  if (refs.length > 440) {
    return notice("Khách này có quá nhiều lịch sử. Hãy xử lý bằng admin/backoffice để tránh vượt giới hạn batch.", true);
  }
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "customers", c.id), {
      isDeleted: true,
      deletedAt: serverTimestamp(),
      deletedByEmail: currentUser.email || "",
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser.email || ""
    });
    refs.forEach(r => batch.update(r, {
      isDeleted: true,
      deletedAt: serverTimestamp(),
      deletedByEmail: currentUser.email || "",
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser.email || ""
    }));
    if (c.phoneNormalized) batch.delete(doc(db, "phoneIndex", c.phoneNormalized));
    batch.set(doc(collection(db, "auditLogs")), {
      action: "softDeleteCustomer", entity: "customers", entityId: c.id,
      email: currentUser.email || "", payloadJson: JSON.stringify({customer:c, careLogCount:relatedLogs.length, dealCount:relatedDeals.length}), createdAt: serverTimestamp()
    });
    await batch.commit();
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
    const batch = writeBatch(db);
    batch.update(doc(db, "customers", c.id), {
      isDeleted: false,
      restoredAt: serverTimestamp(),
      restoredByEmail: currentUser.email || "",
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser.email || ""
    });
    allCareLogs.filter(l => l.customerId === c.id && l.isDeleted).forEach(l => {
      batch.update(doc(db, "careLogs", l.id), {isDeleted:false, restoredAt:serverTimestamp(), restoredByEmail:currentUser.email || ""});
    });
    allDeals.filter(d => d.customerId === c.id && d.isDeleted).forEach(d => {
      batch.update(doc(db, "deals", d.id), {isDeleted:false, restoredAt:serverTimestamp(), restoredByEmail:currentUser.email || ""});
    });
    if (c.phoneNormalized) {
      batch.set(doc(db, "phoneIndex", c.phoneNormalized), {
        customerId: c.id,
        owner: c.owner || "",
        ownerEmail: c.ownerEmail || "",
        restoredByEmail: currentUser.email || "",
        updatedAt: serverTimestamp()
      }, {merge:true});
    }
    batch.set(doc(collection(db, "auditLogs")), {
      action: "restoreCustomer", entity: "customers", entityId: c.id,
      email: currentUser.email || "", payloadJson: JSON.stringify(c), createdAt: serverTimestamp()
    });
    await batch.commit();
    notice("Đã khôi phục khách.");
  } catch (err) {
    notice("Không khôi phục được khách: " + authMessage(err), true);
  }
}

async function permanentlyDeleteCustomer(customerId) {
  if (!isAdmin()) return notice("Chỉ admin được xóa vĩnh viễn.", true);
  const c = deletedCustomers.find(x => x.id === customerId);
  if (!c) return notice("Không tìm thấy khách trong thùng rác.", true);
  const ok = confirm(`XÓA VĨNH VIỄN khách "${c.name || c.id}" và toàn bộ careLogs/deals liên quan? Không thể khôi phục.`);
  if (!ok) return;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, "customers", c.id));
    allCareLogs.filter(l => l.customerId === c.id).forEach(l => batch.delete(doc(db, "careLogs", l.id)));
    allDeals.filter(d => d.customerId === c.id).forEach(d => batch.delete(doc(db, "deals", d.id)));
    kpiProposals.filter(p => p.customerId === c.id).forEach(p => batch.delete(doc(db, "kpiProposals", p.id)));
    if (c.phoneNormalized) batch.delete(doc(db, "phoneIndex", c.phoneNormalized));
    batch.set(doc(collection(db, "auditLogs")), {
      action: "permanentDeleteCustomer", entity: "customers", entityId: c.id,
      email: currentUser.email || "", payloadJson: JSON.stringify({customer:c}), createdAt: serverTimestamp()
    });
    await batch.commit();
    notice("Đã xóa vĩnh viễn khách và dữ liệu liên quan.");
  } catch (err) {
    notice("Không xóa vĩnh viễn được: " + authMessage(err), true);
  }
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
  if (!confirm(`Xóa vĩnh viễn ${orphanLogs.length} careLogs và ${orphanDeals.length} deals mồ côi?`)) return;
  try {
    const batch = writeBatch(db);
    orphanLogs.forEach(l => batch.delete(doc(db, "careLogs", l.id)));
    orphanDeals.forEach(d => batch.delete(doc(db, "deals", d.id)));
    batch.set(doc(collection(db, "auditLogs")), {
      action: "cleanupOrphans", entity: "careLogs/deals", entityId: "bulk",
      email: currentUser.email || "", payloadJson: JSON.stringify({careLogs:orphanLogs.length,deals:orphanDeals.length}), createdAt: serverTimestamp()
    });
    await batch.commit();
    notice(`Đã cleanup orphan: ${orphanLogs.length} careLogs, ${orphanDeals.length} deals.`);
  } catch (err) {
    notice("Không cleanup orphan được: " + authMessage(err), true);
  }
}

async function cleanupData() {
  if (!isAdmin()) return notice("Chỉ admin được dọn dữ liệu.", true);
  if (!confirm("Chạy dọn dữ liệu: cleanup phoneIndex và careLogs/deals orphan?")) return;
  await cleanupPhoneIndex();
  await cleanupOrphans();
}

function infoCell(label, value) {
  return `<div class="info-cell"><span>${esc(label)}</span><b>${esc(value || "-")}</b></div>`;
}

function profileStat(label, value) {
  return `<div class="profile-stat"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
}

function customerActivityItems(id) {
  const careRows = customerLogs(id).map(l => ({
    kind: "care",
    label: "Chăm sóc",
    at: l.createdAt,
    title: [l.status, l.careResult].filter(Boolean).join(" · ") || "Ghi chăm sóc",
    text: [l.careChannel, l.note].filter(Boolean).join(" · "),
    meta: l.nextCareDate ? `Hẹn tiếp: ${fmtDate(l.nextCareDate)}` : ""
  }));
  const dealRows = customerDeals(id).map(d => ({
    kind: "deal",
    label: "Đơn hàng",
    at: d.completedAt || d.dealDate || d.createdAt,
    title: normalizeDealStatus(d.dealStatus) || "Đơn hàng",
    text: [orderProductText(d), dealAmount(d) ? money(dealAmount(d)) : ""].filter(Boolean).join(" · "),
    meta: d.completedAt ? `Ngày mua: ${fmtDate(d.completedAt)}` : d.deliveryDate ? `Hẹn giao: ${fmtDate(d.deliveryDate)}` : ""
  }));
  const proposalRows = kpiProposals
    .filter(p => p.customerId === id && !p.isDeleted)
    .map(p => ({
      kind: "kpi",
      label: "KPI",
      at: p.createdAt,
      title: p.kpiName || "Đề xuất KPI",
      text: isApprovedKpiProposal(p) ? "Đã duyệt" : isRejectedKpiProposal(p) ? "Từ chối" : "Chờ duyệt",
      meta: p.content || ""
    }));
  return [...careRows, ...dealRows, ...proposalRows]
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
  const nextCare = clean(c.nextCareDate) ? fmtDate(c.nextCareDate) : "Chưa hẹn";
  box.innerHTML = `
    <div class="profile-stats">
      ${profileStat("Lần chăm", logs.length)}
      ${profileStat("Đơn xử lý", pendingDeals.length)}
      ${profileStat("Đã mua", purchaseCount(c.id))}
      ${profileStat("KPI duyệt", approvedKpi.length)}
    </div>
    <div class="profile-subtitle">
      <h4>Hoạt động gần đây</h4>
      <span class="pill ${isCareOverdue(c) ? "red" : isCareDue(c) ? "orange" : "green"}">Hẹn: ${esc(nextCare)}</span>
    </div>
    ${activity.length ? `<div class="activity-mini-list">${activity.slice(0,5).map(item => `
      <div class="activity-mini ${esc(item.kind)}">
        <div class="activity-mini-head">
          <b>${esc(item.label)} · ${esc(item.title)}</b>
          <span class="muted">${esc(fmtDate(item.at))}</span>
        </div>
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
    isPartnerChannel(c.channel) ? infoCell("Tên công ty", c.companyName) : "",
    infoCell("Nhân viên phụ trách", customerOwnerName(c)),
    infoCell("Nhu cầu / Sản phẩm", c.need),
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
  $("editCustomerType").value = "";
  $("editCompanyName").value = clean(c.companyName);
  ["editPartnerType","editPartnerActivity","editPartnerLevel","editPartnerCapacity"].forEach(id => { if ($(id)) $(id).value = ""; });
  $("editPartnerType").value = clean(c.partnerType);
  $("editPartnerActivity").value = clean(c.partnerActivity);
  $("editPartnerLevel").value = clean(c.partnerLevel);
  $("editPartnerCapacity").value = clean(c.partnerCapacity);
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
    customerType: "",
    owner: clean(selectedOwner.name),
    ownerEmail: clean(selectedOwner.email),
    companyName: isPartnerChannel(clean($("editChannel").value)) ? clean($("editCompanyName").value) : "",
    partnerType: isPartnerChannel(clean($("editChannel").value)) ? clean($("editPartnerType").value) : "",
    partnerActivity: isPartnerChannel(clean($("editChannel").value)) ? clean($("editPartnerActivity").value) : "",
    partnerLevel: isPartnerChannel(clean($("editChannel").value)) ? clean($("editPartnerLevel").value) : "",
    partnerCapacity: isPartnerChannel(clean($("editChannel").value)) ? clean($("editPartnerCapacity").value) : "",
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
  if (isPartnerChannel(data.channel) && !data.companyName) return notice("Vui lòng nhập tên công ty.", true);
  if (!data.ownerEmail && !data.owner) return notice("Vui lòng chọn nhân viên phụ trách.", true);
  try {
    const oldPhone = phoneNorm(c.phoneNormalized || c.phoneRaw || "");
    const customerRef = doc(db, "customers", c.id);
    const auditRef = doc(collection(db, "auditLogs"));
    await runTransaction(db, async tx => {
      if (phone && phone !== oldPhone) {
        const newPhoneRef = doc(db, "phoneIndex", phone);
        const newPhoneSnap = await tx.get(newPhoneRef);
        if (newPhoneSnap.exists() && newPhoneSnap.data().customerId !== c.id) {
          throw new Error("SĐT mới đã thuộc khách hàng khác.");
        }
        tx.set(newPhoneRef, {
          customerId: c.id,
          owner: data.owner,
          ownerEmail: data.ownerEmail,
          createdByEmail: c.createdByEmail || currentUser.email || "",
          updatedByEmail: currentUser.email || "",
          updatedAt: serverTimestamp()
        }, {merge:true});
      }
      if (oldPhone && oldPhone !== phone) tx.delete(doc(db, "phoneIndex", oldPhone));
      if (phone && phone === oldPhone) {
        tx.set(doc(db, "phoneIndex", phone), {
          owner: data.owner,
          ownerEmail: data.ownerEmail,
          updatedByEmail: currentUser.email || "",
          updatedAt: serverTimestamp()
        }, {merge:true});
      }
      tx.update(customerRef, data);
      tx.set(auditRef, {
        action: "updateCustomerInfo", entity: "customers", entityId: c.id,
        email: currentUser.email || "", payloadJson: JSON.stringify(data), createdAt: serverTimestamp()
      });
    });
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
    `Lần mua hàng: ${purchaseCount(id)}`
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
  $("careNextDate").value = clean(c.nextCareDate);
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
      <b>${esc(d.dealStatus || "")}</b> · Ngày đơn: ${esc(fmtDate(d.dealDate))} · ${esc(d.product || "")}
      <div class="muted">${esc(d.orderCustomerName || d.customerName || "")} · ${esc(d.orderPhone || d.phoneRaw || d.phoneNormalized || "Không SĐT")}</div>
      ${d.deliveryAddress ? `<div class="muted">Giao: ${esc(d.deliveryAddress)}</div>` : ""}
      ${d.taxCode ? `<div class="muted">MST: ${esc(d.taxCode)}</div>` : ""}
      ${d.deliveryDate ? `<div class="muted">Hẹn giao: ${esc(fmtDate(d.deliveryDate))}</div>` : ""}
      <div class="muted">Cọc: ${esc(d.depositPercent ?? 0)}% · Giá trị: ${esc(money(d.amount || 0))}</div>
      ${Array.isArray(d.items) && d.items.length ? `<div class="muted">${esc(d.items.map(item => `${item.product || item.productLabel || ""}${item.code ? " - " + item.code : ""}${item.size ? " - " + item.size : ""}${item.qty ? " - SL: " + item.qty : ""}`).join("; "))}</div>` : ""}
      <div>${d.completed ? `<span class="pill green">Hoàn thành</span> ${d.completedAt ? `<span class="muted">· ${esc(fmtDate(d.completedAt))}</span>` : ""}` : isCanceledDeal(d.dealStatus) ? `<span class="pill red">${esc(systemLabel("canceledStatus"))}</span> ${d.canceledAt ? `<span class="muted">· ${esc(fmtDate(d.canceledAt))}</span>` : ""}` : `<span class="pill orange">Đang xử lý</span>`}</div>
      <div class="muted">${esc(d.note || "")}</div>
      <div class="actions">
        <button class="small" data-review-deal="${esc(d.id)}">Xem lại</button>
        ${canEditDeal(d) ? `<button class="small primary" data-edit-deal="${esc(d.id)}">Sửa đơn</button>` : ""}
        ${canEditDeal(d) && (isActiveDeal(d) || sameLabel(normalizeDealStatus(d.dealStatus), "depositStatus")) ? `<button class="small primary" data-complete-deal="${esc(d.id)}">Hoàn thành</button><button class="small danger" data-cancel-deal="${esc(d.id)}">Hủy đơn</button>` : ""}
        ${isManager() ? `<button class="small danger" data-delete-deal="${esc(d.id)}">Xóa mềm</button>` : ""}
      </div>
    </div>
  `;
}

function showDealList(kind) {
  if (!selectedCustomerId) return;
  const ds = customerDeals(selectedCustomerId).filter(d => kind === "completed" ? isCompletedDeal(d) : isActiveDeal(d) || sameLabel(normalizeDealStatus(d.dealStatus), "depositStatus"));
  $("dealListTitle").textContent = kind === "completed" ? "Đơn đã hoàn thành" : "Đơn đang xử lý";
  $("dealListContent").innerHTML = ds.length ? ds.map(dealCard).join("") : "Chưa có đơn hàng.";
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
    if (key === "hencham") data.nextCareDate = value;
    if (key === "ghichu") data.note = value;
  });
  return data;
}

function latestCareStateForCustomer(customerId, logList = careLogs) {
  const latest = logList
    .filter(l => l.customerId === customerId && !l.isDeleted)
    .sort(byDateDesc)[0];
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
    `Hẹn chăm: ${log.nextCareDate || ""}`,
    `Ghi chú: ${log.note || ""}`
  ].join("\n"));
  if (text === null) return;
  const updates = parseCareLogEditInput(text);
  if (!Object.keys(updates).length) return notice("Không có nội dung hợp lệ để sửa.", true);
  try {
    const nextLog = {...log, ...updates, updatedAt: new Date()};
    const nextLogs = careLogs.map(l => l.id === log.id ? nextLog : l);
    const customerState = latestCareStateForCustomer(log.customerId, nextLogs);
    const batch = writeBatch(db);
    batch.update(doc(db, "careLogs", log.id), {
      ...updates,
      follow: computedFollowStatus({...customers.find(c => c.id === log.customerId), status: updates.status || log.status, nextCareDate: updates.nextCareDate ?? log.nextCareDate}),
      updatedByEmail: currentUser.email || "",
      updatedAt: serverTimestamp()
    });
    batch.update(doc(db, "customers", log.customerId), {
      ...customerState,
      updatedByEmail: currentUser.email || "",
      updatedAt: serverTimestamp()
    });
    batch.set(doc(collection(db, "auditLogs")), {
      action: "editCareLog", entity: "careLogs", entityId: log.id,
      email: currentUser.email || "", payloadJson: JSON.stringify({before: log, after: updates}), createdAt: serverTimestamp()
    });
    await batch.commit();
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
    const nextLogs = careLogs.map(l => l.id === log.id ? {...l, isDeleted: true} : l);
    const customerState = latestCareStateForCustomer(log.customerId, nextLogs);
    const batch = writeBatch(db);
    batch.update(doc(db, "careLogs", log.id), {
      isDeleted: true,
      deletedAt: serverTimestamp(),
      deletedByEmail: currentUser.email || "",
      updatedAt: serverTimestamp(),
      updatedByEmail: currentUser.email || ""
    });
    batch.update(doc(db, "customers", log.customerId), {
      ...customerState,
      updatedByEmail: currentUser.email || "",
      updatedAt: serverTimestamp()
    });
    batch.set(doc(collection(db, "auditLogs")), {
      action: "deleteCareLog", entity: "careLogs", entityId: log.id,
      email: currentUser.email || "", payloadJson: JSON.stringify(log), createdAt: serverTimestamp()
    });
    await batch.commit();
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
  const careActionsByDate = new Map(customerLogs(id).map(l => [String(l.createdAt || ""), l]));
  const timeline = customerActivityItems(id);
  $("logHistory").innerHTML = timeline.length ? timeline.map(item => {
    const careLog = item.kind === "care" ? careActionsByDate.get(String(item.at || "")) : null;
    return `
      <div class="activity-mini ${esc(item.kind)}">
        <div class="activity-mini-head">
          <b>${esc(item.label)} · ${esc(item.title)}</b>
          <span class="muted">${esc(fmtDate(item.at))}</span>
        </div>
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
  const reportDeals = currentReportDeals();
  const completed = reportDeals.filter(isCompletedDeal);
  const pending = reportDeals.filter(isActiveDeal);
  const month = currentMonth();
  const monthCompleted = completed.filter(d => monthOf(d.completedAt || d.dealDate || d.createdAt) === month);
  const cards = [
    ["Khách đang quản lý", currentReportCustomers().length, ""],
    ["Đơn hoàn thành", completed.length, ""],
    ["Đơn đang xử lý", pending.length, pending.length ? "warn" : ""],
    ["Doanh số tháng", money(monthCompleted.reduce((sum,d) => sum + dealAmount(d), 0)), ""],
    ["KPI chờ duyệt", kpiProposals.filter(p => isPendingKpiProposal(p) && !p.isDeleted).length, kpiProposals.some(p => isPendingKpiProposal(p) && !p.isDeleted) ? "warn" : ""],
    ["Sản phẩm đang bán", products.length, ""]
  ];
  $("reportCenterTime").textContent = `Cập nhật ${new Date().toLocaleString("vi-VN")}`;
  $("reportCenterGrid").innerHTML = cards.map(([label,value,cls]) => `
    <div class="executive-card report-card ${esc(cls)}">
      <span class="muted">${esc(label)}</span>
      <b>${esc(value)}</b>
    </div>
  `).join("");
  renderErpReport();
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
        type: `Task ${taskLabel(taskType)}`,
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
    .filter(l => !l.isDeleted && inDateRange(l.createdAt, range) && ownerMatchesKey(l, ownerFilter))
    .forEach(l => {
      const c = customerById(l.customerId);
      rows.push({
        date: isoFromAny(l.createdAt),
        type: "Chăm sóc",
        owner: l.owner || customerOwnerName(c) || l.ownerEmail,
        ownerEmail: l.ownerEmail || customerOwnerKey(c),
        customer: l.customerName || c.name || "",
        phone: c.phoneRaw || l.phoneRaw || l.phoneNormalized || c.phoneNormalized || "",
        companyName: l.companyName || c.companyName || "",
        channel: c.channel || "",
        status: l.status || c.status || "",
        amount: "",
        note: [l.careChannel, l.careResult, l.note].filter(Boolean).join(" · "),
        bucket: "care",
        customerId: l.customerId
      });
    });

  const quoteActivityActions = ["openQuoteProposal","openQuoteTemplate","createDealFromQuote","createQuote","updateQuote","convertQuoteToDeal"];
  auditLogs
    .filter(a => inDateRange(a.createdAt, range) && quoteActivityActions.includes(clean(a.action)))
    .forEach(a => {
      const q = quotes.find(item => item.id === a.entityId) || {};
      const c = customerById(q.customerId || a.entityId);
      if (!c.id || !canSeeCustomer(c) || !ownerMatchesKey({owner:c.owner, ownerEmail:c.ownerEmail}, ownerFilter)) return;
      const action = clean(a.action);
      rows.push({
        date: isoFromAny(a.createdAt),
        type: action === "convertQuoteToDeal" || action === "createDealFromQuote"
          ? "Chuyển báo giá thành đơn"
          : action === "updateQuote"
            ? "Cập nhật báo giá"
            : "Báo giá/Đề xuất",
        owner: customerOwnerName(c),
        ownerEmail: customerOwnerKey(c),
        customer: c.name || "",
        phone: c.phoneRaw || c.phoneNormalized || "",
        companyName: c.companyName || "",
        channel: c.channel || "",
        status: c.status || "",
        amount: "",
        note: q.quoteNo || action || "",
        bucket: "quote",
        customerId: c.id
      });
    });

  deals
    .filter(d => !d.isDeleted && inDateRange(d.dealDate || d.createdAt, range) && ownerMatchesKey(d, ownerFilter))
    .forEach(d => {
      const c = customerById(d.customerId);
      rows.push({
        date: isoFromAny(d.dealDate || d.createdAt),
        type: "Tạo đơn/deal",
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
        type: "Hoàn thành đơn",
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

  payments
    .filter(p => !p.isDeleted && inDateRange(p.paymentDate || p.createdAt, range) && ownerMatchesKey(p, ownerFilter))
    .forEach(p => {
      const d = deals.find(item => item.id === p.dealId) || {};
      const c = customerById(p.customerId || d.customerId);
      rows.push({
        date: isoFromAny(p.paymentDate || p.createdAt),
        type: "Thu thanh toán",
        owner: p.owner || orderOwnerName(d),
        ownerEmail: p.ownerEmail || orderOwnerEmail(d),
        customer: p.customerName || orderCustomerName(d),
        phone: c.phoneRaw || c.phoneNormalized || orderCustomerPhone(d),
        companyName: c.companyName || "",
        channel: c.channel || "",
        status: p.method || "Thanh toán",
        amount: p.amount || 0,
        note: p.note || p.paymentNo || "",
        bucket: "payment",
        customerId: p.customerId || d.customerId
      });
    });

  const filtered = key ? rows.filter(r => normalizeKey([r.type,r.owner,r.ownerEmail,r.customer,r.phone,r.companyName,r.channel,r.status,r.note].join(" ")).includes(key)) : rows;
  return {range, rows: filtered.sort((a,b) => String(b.date).localeCompare(String(a.date)) || String(a.owner).localeCompare(String(b.owner), "vi"))};
}

function saleActivitySummary(rows) {
  const map = new Map();
  rows.forEach(r => {
    const id = clean(r.ownerEmail || r.owner || "Không rõ");
    const cur = map.get(id) || {owner: r.owner || id, ownerEmail: r.ownerEmail || "", taskOpen:0, taskOverdue:0, care:0, quote:0, deal:0, completed:0, payment:0, revenue:0};
    if (r.bucket === "task") {
      cur.taskOpen += 1;
      if (r.taskType === "overdue") cur.taskOverdue += 1;
    }
    if (r.bucket === "care") cur.care += 1;
    if (r.bucket === "quote") cur.quote += 1;
    if (r.bucket === "deal") cur.deal += 1;
    if (r.bucket === "payment") cur.payment += 1;
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
    quote: rows.filter(r => r.bucket === "quote").length,
    deal: rows.filter(r => r.bucket === "deal").length,
    payment: rows.filter(r => r.bucket === "payment").length,
    completed: rows.filter(r => r.bucket === "completed").length,
    revenue: rows.filter(r => r.bucket === "completed").reduce((sum,r) => sum + Number(r.amount || 0), 0)
  };
  if ($("saleActivityMetrics")) {
    $("saleActivityMetrics").innerHTML = [
      ["Tổng hoạt động", metrics.total, ""],
      ["Task quá hạn", metrics.taskOverdue, metrics.taskOverdue ? "bad" : ""],
      ["Chăm sóc", metrics.care, ""],
      ["Báo giá", metrics.quote, ""],
      ["Deal tạo", metrics.deal, ""],
      ["Thanh toán", metrics.payment, ""],
      ["Đơn hoàn thành", metrics.completed, ""],
      ["Doanh số", money(metrics.revenue), ""]
    ].map(([label,value,cls]) => `
      <div class="report-metric ${esc(cls)}">
        <span>${esc(label)}</span>
        <b>${esc(value)}</b>
      </div>
    `).join("");
  }
  $("saleActivitySummary").innerHTML = summary.length ? `
    <table class="admin-table">
      <thead><tr><th>Nhân viên</th><th>Task mở</th><th>Quá hạn</th><th>Chăm sóc</th><th>Báo giá</th><th>Deal tạo</th><th>Thanh toán</th><th>Đơn hoàn thành</th><th>Doanh số</th></tr></thead>
      <tbody>${summary.map(s => `
        <tr>
          <td><b>${esc(s.owner)}</b><div class="muted">${esc(s.ownerEmail)}</div></td>
          <td>${esc(s.taskOpen)}</td>
          <td>${s.taskOverdue ? `<span class="pill red">${esc(s.taskOverdue)}</span>` : "0"}</td>
          <td>${esc(s.care)}</td>
          <td>${esc(s.quote)}</td>
          <td>${esc(s.deal)}</td>
          <td>${esc(s.payment)}</td>
          <td>${esc(s.completed)}</td>
          <td><b>${esc(money(s.revenue))}</b></td>
        </tr>
      `).join("")}</tbody>
    </table>
  ` : `<div class="muted" style="padding:12px">Không có hoạt động trong khoảng ${esc(range.label)}.</div>`;
  const timelinePage = pageRows("saleActivity", rows);
  $("saleActivityTimeline").innerHTML = timelinePage.length ? timelinePage.map(r => {
    const cls = r.bucket === "deal" || r.bucket === "completed" || r.bucket === "payment" ? "deal" : r.bucket === "quote" ? "kpi" : r.taskType === "overdue" ? "bad" : "care";
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
    .filter(l => !l.isDeleted && inDateRange(l.createdAt, range) && exportOwnerMatches(l, ownerFilter))
    .forEach(l => {
      const c = customerById(l.customerId);
      rows.push({
        date: isoFromAny(l.createdAt),
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
        note: l.note || ""
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
    ["Nhân viên","Email","Task mở","Task quá hạn","Chăm sóc","Báo giá","Deal tạo","Đơn hoàn thành","Doanh số"],
    ...summary.map(s => [s.owner, s.ownerEmail, s.taskOpen, s.taskOverdue, s.care, s.quote, s.deal, s.completed, s.revenue])
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
    selectedOptionText("filterDealStatus") ? `Đơn hàng: ${selectedOptionText("filterDealStatus")}` : "",
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
  const header = ["Khách hàng","Tên công ty","SĐT","Ngày tạo","Kênh chi tiết","Phụ trách","Trạng thái","Tình trạng chăm","Đã cọc","Đã mua","Đã hủy","Hẹn chăm","Ghi chú"];
  const dataRows = [
    [`Danh sách khách hàng - ${filterLabel}`, "", "", "", "", "", "", "", "", "", "", "", ""],
    header,
    ...rows.map(c => {
      const counts = dealCounts(c.id);
      return [
        c.name || "",
        c.companyName || "",
        c.phoneRaw || c.phoneNormalized || "",
        fmtDate(c.createdAt),
        canonicalChannel(c.channel),
        customerOwnerName(c),
        c.status || "",
        computedFollowStatus(c),
        counts.deposit,
        counts.bought,
        counts.canceled,
        fmtDate(c.nextCareDate),
        c.note || ""
      ];
    })
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
  const activeProducts = products.filter(p => p.active !== false && !p.isDeleted).length;
  const newOrders = deals.filter(d => !d.isDeleted && isActiveDeal(d)).length;
  const dueCare = managedCustomers.filter(c => !c.isDeleted && isCareDue(c)).length;
  const activeUsers = users.filter(u => u.active !== false).length;
  const warnings = [
    managedCustomers.filter(c => !clean(c.ownerEmail) && !clean(c.owner)).length ? "Có khách thiếu phụ trách" : "",
    dueCare ? "Có khách cần chăm sóc" : "",
    auditLogs.length ? "" : "Chưa tải được audit log"
  ].filter(Boolean);
  const cards = [
    ["Tổng khách hàng", managedCustomers.filter(c => !c.isDeleted).length, "Dữ liệu khách đang quản lý"],
    ["Đơn hàng mới", newOrders, "Deal/đơn đang xử lý"],
    ["Khách cần chăm", dueCare, "Theo logic hẹn chăm hiện tại", dueCare ? "warn" : ""],
    ["Sản phẩm hiển thị", activeProducts, "Sản phẩm active"],
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
    watchData();
    renderAll();
    notice("Đã tải lại settings và dữ liệu mới nhất.");
  } catch (err) {
    notice(authMessage(err), true);
  }
}

function resetFilters() {
  activeChannelQuickFilter = "";
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
  const docId = e.target.closest("[data-open-template]")?.dataset.openTemplate;
  const quoteCreateDealId = e.target.closest("[data-quote-create-deal]")?.dataset.quoteCreateDeal;
  const quoteOpenTemplateId = e.target.closest("[data-quote-open-template]")?.dataset.quoteOpenTemplate;
  const quoteCopyId = e.target.closest("[data-quote-copy]")?.dataset.quoteCopy;
  const taskSnoozeBtn = e.target.closest("[data-task-snooze]");
  const completeDealId = e.target.closest("[data-complete-deal]")?.dataset.completeDeal;
  const cancelDealId = e.target.closest("[data-cancel-deal]")?.dataset.cancelDeal;
  const deleteDealId = e.target.closest("[data-delete-deal]")?.dataset.deleteDeal;
  const editDealId = e.target.closest("[data-edit-deal]")?.dataset.editDeal;
  const reviewDealId = e.target.closest("[data-review-deal]")?.dataset.reviewDeal;
  const deliveryDealId = e.target.closest("[data-delivery-deal]")?.dataset.deliveryDeal;
  const saveDeliveryId = e.target.closest("[data-save-delivery]")?.dataset.saveDelivery;
  const pipelineLabel = e.target.closest("[data-pipeline-detail]")?.dataset.pipelineDetail;
  const editKpiRuleId = e.target.closest("[data-edit-kpi-rule]")?.dataset.editKpiRule;
  const disableKpiRuleId = e.target.closest("[data-disable-kpi-rule]")?.dataset.disableKpiRule;
  const activateKpiRuleId = e.target.closest("[data-activate-kpi-rule]")?.dataset.activateKpiRule;
  const kpiRuleExplainId = e.target.closest("[data-kpi-rule-explain]")?.dataset.kpiRuleExplain;
  const kpiRuleProposalId = e.target.closest("[data-kpi-rule-proposals]")?.dataset.kpiRuleProposals;
  const kpiOwnerDetailBtn = e.target.closest("[data-kpi-owner-detail]");
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
  const copyPhone = e.target.closest("[data-copy-phone]")?.dataset.copyPhone;
  const dashboardAction = e.target.closest("[data-dashboard-action]")?.dataset.dashboardAction;
  const orderSummary = e.target.closest("[data-order-summary]")?.dataset.orderSummary;
  const careWorkDetail = e.target.closest("[data-care-work-detail]")?.dataset.careWorkDetail;
  const openQuoteId = e.target.closest("[data-open-quote]")?.dataset.openQuote;
  const editQuoteId = e.target.closest("[data-edit-quote]")?.dataset.editQuote;
  const deleteQuoteId = e.target.closest("[data-delete-quote]")?.dataset.deleteQuote;
  const convertQuoteId = e.target.closest("[data-convert-quote]")?.dataset.convertQuote;
  const payDealId = e.target.closest("[data-pay-deal]")?.dataset.payDeal;
  const deletePaymentId = e.target.closest("[data-delete-payment]")?.dataset.deletePayment;
  const printPaymentId = e.target.closest("[data-print-payment]")?.dataset.printPayment;
  const printDeliveryId = e.target.closest("[data-print-delivery]")?.dataset.printDelivery;
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
  if (dashboardAction === "managed-customers" || dashboardAction === "month-customers") openDashboardCustomerDetail(dashboardAction);
  if (["pending-deals","completed-deals","month-revenue","deposit-deals","canceled-deals"].includes(dashboardAction)) openDashboardDealDetail(dashboardAction);
  if (dashboardAction === "pending-kpi") jumpToPendingKpi();
  if (careId) {
    closeDetailModal();
    openDrawer(careId, "care");
  }
  if (dealId) openDrawer(dealId, "deal");
  if (docId) openQuoteProposal(docId);
  if (quoteCreateDealId) createDealFromQuote(quoteCreateDealId);
  if (quoteOpenTemplateId) openQuoteTemplate(quoteOpenTemplateId);
  if (quoteCopyId) copyQuoteCustomerInfo(quoteCopyId);
  if (openQuoteId) openQuoteDetail(openQuoteId);
  if (editQuoteId) editQuote(editQuoteId);
  if (deleteQuoteId) softDeleteQuote(deleteQuoteId);
  if (convertQuoteId) convertQuoteToDeal(convertQuoteId);
  if (payDealId) selectPaymentDeal(payDealId);
  if (deletePaymentId) softDeletePayment(deletePaymentId);
  if (printPaymentId) printPaymentReceipt(printPaymentId);
  if (printDeliveryId) printDeliveryNote(printDeliveryId);
  if (taskSnoozeBtn) snoozeTask(taskSnoozeBtn.dataset.taskSnooze, Number(taskSnoozeBtn.dataset.days || 1));
  if (copyPhone) { navigator.clipboard?.writeText(copyPhone); notice("Đã copy SĐT."); }
  if (completeDealId) completeDeal(completeDealId);
  if (cancelDealId) cancelDeal(cancelDealId);
  if (deleteDealId) softDeleteDeal(deleteDealId);
  if (editDealId) editDeal(editDealId);
  if (reviewDealId) reviewDeal(reviewDealId);
  if (deliveryDealId) openDeliveryModal(deliveryDealId);
  if (saveDeliveryId) runAction(`saveDelivery:${saveDeliveryId}`, "saveDelivery", "Đang lưu...", () => saveDelivery(saveDeliveryId));
  if (pipelineLabel) openPipelineDetail(pipelineLabel);
  if (editKpiRuleId) editKpiRule(editKpiRuleId);
  if (disableKpiRuleId) disableKpiRule(disableKpiRuleId);
  if (activateKpiRuleId) activateKpiRule(activateKpiRuleId);
  if (kpiRuleExplainId) openKpiRuleExplanation(kpiRuleExplainId);
  if (kpiRuleProposalId) openKpiRuleProposals(kpiRuleProposalId);
  if (kpiOwnerDetailBtn) openKpiOwnerDetail(kpiOwnerDetailBtn.dataset.kpiOwnerDetail, kpiOwnerDetailBtn.dataset.ownerKey);
  if (kpiProposalDetailId) openKpiProposalDetail(kpiProposalDetailId);
  if (editKpiProposalId) openEditKpiProposal(editKpiProposalId);
  if (customerKpiProposalId) openKpiProposalModal(customerKpiProposalId);
  if (softDeleteKpiProposalId) softDeleteKpiProposal(softDeleteKpiProposalId);
  if (deleteKpiProposalId) deleteKpiProposal(deleteKpiProposalId);
  if (approveKpiProposalId) reviewKpiProposal(approveKpiProposalId, "approved");
  if (rejectKpiProposalId) reviewKpiProposal(rejectKpiProposalId, "rejected");
  const saveProductId = e.target.closest("[data-save-product]")?.dataset.saveProduct;
  const deleteProductId = e.target.closest("[data-delete-product]")?.dataset.deleteProduct;
  const inventoryProductId = e.target.closest("[data-inventory-product]")?.dataset.inventoryProduct;
  const deleteInventoryId = e.target.closest("[data-delete-inventory]")?.dataset.deleteInventory;
  if (saveProductId) runAction(`saveProduct:${saveProductId}`, "saveProduct", "Đang lưu...", () => saveProduct(saveProductId));
  if (deleteProductId) runAction(`deleteProduct:${deleteProductId}`, "deleteProduct", "Đang xóa...", () => deleteProduct(deleteProductId));
  if (inventoryProductId) {
    setMainView("products");
    selectInventoryProduct(inventoryProductId);
  }
  if (deleteInventoryId) softDeleteInventoryMovement(deleteInventoryId);
  if (editCareLogId) editCareLog(editCareLogId);
  if (deleteCareLogId) deleteCareLog(deleteCareLogId);
  if (restoreCustomerId) restoreCustomer(restoreCustomerId);
  if (permanentDeleteCustomerId) permanentlyDeleteCustomer(permanentDeleteCustomerId);
  if (saveUserId) runAction(`saveUser:${saveUserId}`, "saveUser", "Đang lưu...", () => saveUserAdmin(saveUserId));
  if (toggleUserId) runAction(`toggleUser:${toggleUserId}`, "toggleUser", "Đang cập nhật...", () => toggleUserAdmin(toggleUserId));
  if (deleteUserId) runAction(`deleteUser:${deleteUserId}`, "deleteUser", "Đang xóa...", () => deleteUserAdmin(deleteUserId));
  if (e.target.closest("[data-remove-deal-item]")) {
    e.target.closest("[data-deal-item]")?.remove();
    if (!document.querySelector("[data-deal-item]")) addDealItem();
  }
  if (e.target.closest("[data-remove-quote-item]")) {
    e.target.closest("[data-quote-item]")?.remove();
    if (!document.querySelector("[data-quote-item]")) addQuoteItem();
    updateQuoteTotals();
  }
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
  if (dashboardAction === "managed-customers" || dashboardAction === "month-customers") openDashboardCustomerDetail(dashboardAction);
  if (["pending-deals","completed-deals","month-revenue","deposit-deals","canceled-deals"].includes(dashboardAction)) openDashboardDealDetail(dashboardAction);
  if (dashboardAction === "pending-kpi") jumpToPendingKpi();
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
on("addUserBtn", "click", () => runAction("addUserBtn", "addUser", "Đang thêm...", addUserAdmin));
["newUserEmail","newUserName"].forEach(id => on(id, "keydown", e => {
  if (e.key === "Enter") runAction("addUserBtn", "addUser", "Đang thêm...", addUserAdmin);
}));
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
on("crmViewBtn", "click", () => setMainView("crm"));
on("customersViewBtn", "click", () => setMainView("customers"));
on("ordersViewBtn", "click", () => setMainView("orders"));
on("productsViewBtn", "click", () => setMainView("products"));
on("quotesViewBtn", "click", () => setMainView("quotes"));
on("kpiViewBtn", "click", () => setMainView("kpi"));
on("reportsViewBtn", "click", () => setMainView("reports"));
on("adminViewBtn", "click", () => goToRoute("/admin"));
on("adminBackToCrmBtn", "click", () => goToRoute("/"));
on("adminLogoutBtn", "click", async () => {
  try { await updatePresence(false); } catch {}
  await signOut(auth);
});
document.querySelectorAll("[data-admin-route]").forEach(btn => {
  btn.addEventListener("click", () => goToRoute(btn.dataset.adminRoute || "/admin"));
});
["orderFilterYear","orderFilterMonth","orderFilterOwner","orderFilterStatus"].forEach(id => on(id, "change", renderOrders));
on("resetOrderFilterBtn", "click", resetOrderFilters);
on("savePaymentBtn", "click", () => runAction("savePaymentBtn", "savePayment", "Đang lưu...", savePayment));
on("clearPaymentBtn", "click", clearPaymentForm);
on("paymentDeal", "change", () => {
  const d = deals.find(item => item.id === $("paymentDeal").value);
  if (!d) return;
  $("paymentAmount").value = dealDebtAmount(d) || dealAmount(d);
  if (!$("paymentDate").value) $("paymentDate").value = todayIso();
});
["productSearchBox","productFilterSize","productFilterSurface","productFilterOrigin"].forEach(id => on(id, "input", () => resetPagingAndRender("products", renderProducts)));
on("resetProductFilterBtn", "click", () => {
  ["productSearchBox","productFilterSize","productFilterSurface","productFilterOrigin"].forEach(id => $(id).value = "");
  resetPaging("products");
  renderProducts();
});
on("saveInventoryBtn", "click", () => runAction("saveInventoryBtn", "saveInventoryMovement", "Đang lưu...", saveInventoryMovement));
on("clearInventoryBtn", "click", clearInventoryForm);
["quoteSearchBox","quoteFilterOwner","quoteFilterStatus"].forEach(id => on(id, "input", renderQuotes));
["quoteFilterOwner","quoteFilterStatus"].forEach(id => on(id, "change", renderQuotes));
on("resetQuoteFilterBtn", "click", resetQuoteFilters);
on("exportQuotesBtn", "click", exportQuotes);
on("kpiRuleTarget", "input", () => {
  document.querySelectorAll("[data-kpi-target-email]").forEach(input => {
    if (!clean(input.value)) input.value = $("kpiRuleTarget").value;
  });
});
on("careStatus", "change", updateCareStatusVisual);
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
on("importProductsBtn", "click", () => $("importProductsFile").click());
on("importProductsFile", "change", handleImportProductsFile);
on("saveCustomerBtn", "click", () => runAction("saveCustomerBtn", "saveCustomer", "Đang lưu...", saveCustomer));
on("clearBtn", "click", clearForm);
on("enableNotifyBtn", "click", () => runAction("enableNotifyBtn", "enableNotify", "Đang bật...", enableBrowserNotifications));
on("resetFilterBtn", "click", resetFilters);
on("exportBtn", "click", exportCsv);
on("exportOrdersBtn", "click", () => runAction("exportOrdersBtn", "exportOrders", "Đang xuất...", exportOrders));
on("exportKpiBtn", "click", () => runAction("exportKpiBtn", "exportKpi", "Đang xuất...", exportKpiReport));
on("reportExportManagementBtn", "click", () => runAction("reportExportManagementBtn", "exportManagementReport", "Đang xuất...", exportManagementReport));
on("reportExportKpiBtn", "click", () => runAction("reportExportKpiBtn", "exportKpi", "Đang xuất...", exportKpiReport));
on("reportExportOrdersBtn", "click", () => runAction("reportExportOrdersBtn", "exportOrders", "Đang xuất...", exportOrders));
on("reportExportActivityBtn", "click", () => runAction("reportExportActivityBtn", "exportSaleActivity", "Đang xuất...", exportSaleActivityReport));
on("reportExportErpBtn", "click", () => runAction("reportExportErpBtn", "exportErpReport", "Đang xuất...", exportErpReport));
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
on("saveQuoteBtn", "click", () => runAction("saveQuoteBtn", "saveQuote", "Đang lưu...", saveQuote));
on("clearQuoteBtn", "click", clearQuoteForm);
on("cancelEditQuoteBtn", "click", clearQuoteForm);
on("addQuoteItemBtn", "click", () => addQuoteItem());
on("dealItems", "input", e => {
  if (e.target.matches("[data-deal-product]")) applyProductToDealInput(e.target);
});
on("dealItems", "change", e => {
  if (e.target.matches("[data-deal-product]")) applyProductToDealInput(e.target);
});
on("quoteItems", "input", e => {
  if (e.target.matches("[data-quote-product]")) applyProductToQuoteInput(e.target);
  if (e.target.matches("[data-quote-qty],[data-quote-price],[data-quote-discount]")) updateQuoteTotals();
});
on("quoteItems", "change", e => {
  if (e.target.matches("[data-quote-product]")) applyProductToQuoteInput(e.target);
  updateQuoteTotals();
});
on("showPendingDealsBtn", "click", () => showDealList("pending"));
on("showCompletedDealsBtn", "click", () => showDealList("completed"));
on("closeDealListBtn", "click", () => $("dealListSection").classList.add("hide"));
on("editCustomerInfoBtn", "click", () => toggleCustomerInfoEdit(true));
on("cancelCustomerInfoBtn", "click", () => toggleCustomerInfoEdit(false));
on("saveCustomerInfoBtn", "click", () => runAction("saveCustomerInfoBtn", "saveCustomerInfo", "Đang lưu...", saveCustomerInfo));
on("deleteCustomerBtn", "click", () => runAction("deleteCustomerBtn", "deleteCustomer", "Đang xóa...", deleteCustomer));
window.addEventListener("resize", scheduleRenderChart);
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
