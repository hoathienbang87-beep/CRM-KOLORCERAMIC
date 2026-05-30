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
let editingKpiRuleId = "";
let editingKpiProposalId = "";
let kpiProposalCustomerContext = null;
let pendingLoginSuccessNotice = false;
const KPI_EVIDENCE_BUCKET = "kpi-evidence";
const KPI_EVIDENCE_MAX_FILES = 6;
const KPI_EVIDENCE_MAX_SIZE = 8 * 1024 * 1024;

const roleKey = () => clean(appUser?.role).toLowerCase();
const isAdmin = () => roleKey() === "admin";
const isManager = () => ["admin","manager","quanly","quản lý","quản lí"].includes(roleKey());
const canExportData = () => ["admin","manager","sale"].includes(roleKey()) || appUser?.canExport === true || String(appUser?.canExport || "").toLowerCase() === "true";
const canEditCustomer = c => !!c && (isManager() || canSeeCustomer(c));
const ownerName = () => clean(appUser?.name) || clean(currentUser?.displayName) || clean(currentUser?.email);
const ownerEmail = () => clean(appUser?.email) || clean(currentUser?.email);
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
  $("savingMask")?.classList.remove("hide");
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
    $("savingMask")?.classList.add("hide");
  }
}

function withActionTimeout(promise, label, ms=45000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} quá lâu, vui lòng kiểm tra mạng rồi thử lại.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const scheduleRenderAll = debounce(() => renderAll(), 180);
const scheduleRenderChart = debounce(() => requestChartRender(), 180);

function authMessage(err) {
  const code = err?.code || "";
  if (code.includes("unauthorized-domain")) return "Domain này chưa được cho phép trong Supabase Authentication. Hãy kiểm tra Site URL/Redirect URLs trong Supabase.";
  if (code.includes("invalid-credential") || code.includes("wrong-password")) return "Email hoặc mật khẩu chưa đúng.";
  if (code.includes("user-not-found")) return "Chưa có tài khoản này trong Supabase Authentication.";
  if (code.includes("popup")) return "Trình duyệt đang chặn popup đăng nhập Google.";
  if (/permission|row-level security|violates row-level security|infinite recursion/i.test(err?.message || "")) return "Bạn chưa có quyền đọc/ghi Supabase. Hãy kiểm tra RLS và role/active trong bảng app_users.";
  if (err?.message?.includes("Chưa được cấp quyền")) return err.message;
  return err?.message || "Không đăng nhập được.";
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
  kpiRules.forEach(rule => kpiRuleAssignedOwners(rule).forEach(email => {
    if (isManager() || normalizeKey(email) === normalizeKey(self?.email)) keys.push(email);
  }));
  return uniq(keys).filter(Boolean);
}

function ownerProfileByValue(value) {
  const key = clean(value);
  return ownerOptions().find(o => clean(o.email) === key || clean(o.name) === key) || {name:key, email:key};
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
    $("adminViewBtn")?.classList.add("hide");
    $("reportsViewBtn")?.classList.add("hide");
  } else {
    $("owner").disabled = false;
    $("editOwner").disabled = false;
    $("filterOwner").disabled = false;
    $("orderFilterOwner").disabled = false;
    $("exportBtn").classList.remove("hide");
    $("deleteCustomerBtn").classList.remove("hide");
    $("seedBtn").classList.toggle("hide", !isAdmin());
    $("syncPhoneBtn").classList.toggle("hide", !isAdmin());
    $("syncOwnerBtn").classList.toggle("hide", !isAdmin());
    $("importBtn").classList.toggle("hide", !isAdmin());
    $("importProductsBtn")?.classList.toggle("hide", !isManager());
    $("kpiRulePanel").classList.remove("hide");
    $("kpiApprovalPanel").classList.remove("hide");
    $("careSettingsPanel").classList.remove("hide");
    $("dropdownSettingsPanel").classList.toggle("hide", !isAdmin());
    $("proHealthPanel").classList.toggle("hide", !isAdmin());
    $("auditPanel").classList.toggle("hide", !isAdmin());
    $("userAdminPanel").classList.toggle("hide", !isAdmin());
    $("trashPanel").classList.toggle("hide", !isAdmin());
    $("adminViewBtn")?.classList.remove("hide");
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
  await loadSettings();
  notice("Đã tạo/cập nhật SETTINGS trên Supabase.");
}

async function saveCareSettings() {
  if (!isManager()) return notice("Chỉ admin/manager được lưu thiết lập chăm sóc.", true);
  const days = Math.max(0, Number($("careDueDays").value || 0));
  try {
    await setDoc(doc(db, "settings", "crm"), {
      careDueDays: days,
      updatedByEmail: currentUser?.email || "",
      updatedAt: serverTimestamp()
    }, {merge:true});
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

function renderProducts() {
  if (!$("productsPanel")) return;
  $("importProductsBtn")?.classList.toggle("hide", !isManager());
  hydrateProductFilters();
  renderProductOptions();
  const rows = visibleProducts();
  $("productRows").innerHTML = rows.length ? rows.map(p => {
    const readonly = isManager() ? "" : "disabled";
    const action = isManager()
      ? `<div class="actions"><button class="small primary" type="button" data-save-product="${esc(p.id)}">Lưu</button><button class="small danger" type="button" data-delete-product="${esc(p.id)}">Xóa</button></div>`
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
        <td><input data-product-description="${esc(p.id)}" value="${esc(p.description || "")}" ${readonly}></td>
        <td>${action}</td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="9" class="muted">Chưa có sản phẩm phù hợp. Manager/admin có thể import CSV từ Google Sheet PRODUCTS.</td></tr>`;
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
  if (!isManager()) return notice("Chỉ admin/manager được xóa sản phẩm.", true);
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
  else if (targetName === "products") {
    products = docs.filter(d => !d.isDeleted).sort((a,b) => clean(a.name).localeCompare(clean(b.name), "vi"));
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
  if (isManager()) return true;
  return clean(c.ownerEmail) === ownerEmail() || clean(c.createdByEmail) === ownerEmail() || clean(c.owner) === ownerName();
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
  products = [];
  users = [];
  kpiRules = [];
  kpiProposals = [];
  auditLogs = [];

  const applySnap = (targetName, snap, filterDeleted=false, scopeKey="") => {
    const docs = snap.docs.map(d => ({id:d.id, ...d.data()})).filter(item => ["customers","careLogs","deals","products"].includes(targetName) || !filterDeleted || !item.isDeleted);
    if (scopeKey) setScopedDocs(targetName, scopeKey, docs);
    else replaceDocs(targetName, docs);
    scheduleRenderAll();
  };

  unsubscribers.push(onSnapshot(doc(db, "settings", "crm"), snap => {
    applySettings(snap.exists() ? snap.data() : {});
    hydrateSelects();
    scheduleRenderAll();
  }, err => notice("Lỗi tải SETTINGS: " + authMessage(err), true)));

  unsubscribers.push(onSnapshot(collection(db, "kpiRules"), snap => {
    kpiRules = snap.docs.map(d => ({id:d.id, ...d.data()})).filter(r => r.active !== false).sort((a,b) => clean(a.name).localeCompare(clean(b.name)));
    hydrateProposalKpiOptions();
    scheduleRenderAll();
  }, err => notice("Lỗi tải KPI tháng: " + authMessage(err), true)));

  unsubscribers.push(onSnapshot(collection(db, "products"), snap => {
    applySnap("products", snap, true);
    hydrateProductFilters();
    renderProductOptions();
  }, err => notice("Lỗi tải sản phẩm: " + authMessage(err), true)));

  if (isManager()) {
    unsubscribers.push(onSnapshot(collection(db, "customers"), snap => applySnap("customers", snap, true), err => notice("Lỗi tải khách: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "careLogs"), snap => applySnap("careLogs", snap, true), err => notice("Lỗi tải lịch sử chăm: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "deals"), snap => applySnap("deals", snap, true), err => notice("Lỗi tải đơn hàng: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "kpiProposals"), snap => applySnap("kpiProposals", snap, true), err => notice("Lỗi tải đề xuất KPI: " + authMessage(err), true)));
    unsubscribers.push(onSnapshot(collection(db, "users"), snap => {
      users = snap.docs.map(d => ({uid:d.id, ...d.data()})).sort((a,b) => clean(a.email).localeCompare(clean(b.email)));
      hydrateSelects();
      scheduleRenderAll();
    }, err => notice("Lỗi tải tài khoản nhân viên: " + authMessage(err), true)));
    if (isAdmin()) {
      unsubscribers.push(onSnapshot(collection(db, "userSessions"), snap => {
        onlineSessions = snap.docs.map(d => ({uid:d.id, ...d.data()}));
        renderOnlineUsers();
      }, err => notice("Lỗi tải truy cập: " + authMessage(err), true)));
    }
    return;
  }

  const owned = ownerName();
  const email = ownerEmail();
  unsubscribers.push(onSnapshot(query(collection(db, "customers"), where("ownerEmail", "==", email)), snap => applySnap("customers", snap, true, "ownerEmail"), err => notice("Lỗi tải khách phụ trách: " + authMessage(err), true)));
  unsubscribers.push(onSnapshot(query(collection(db, "customers"), where("owner", "==", owned)), snap => applySnap("customers", snap, true, "owner"), err => notice("Lỗi tải khách cũ phụ trách: " + authMessage(err), true)));
  unsubscribers.push(onSnapshot(query(collection(db, "customers"), where("createdByEmail", "==", email)), snap => applySnap("customers", snap, true, "created"), err => notice("Lỗi tải khách đã tạo: " + authMessage(err), true)));
  unsubscribers.push(onSnapshot(query(collection(db, "careLogs"), where("ownerEmail", "==", email)), snap => applySnap("careLogs", snap, true, "ownerEmail"), err => notice("Lỗi tải lịch sử chăm: " + authMessage(err), true)));
  unsubscribers.push(onSnapshot(query(collection(db, "careLogs"), where("owner", "==", owned)), snap => applySnap("careLogs", snap, true, "owner"), err => notice("Lỗi tải lịch sử chăm cũ: " + authMessage(err), true)));
  unsubscribers.push(onSnapshot(query(collection(db, "deals"), where("ownerEmail", "==", email)), snap => applySnap("deals", snap, true, "ownerEmail"), err => notice("Lỗi tải đơn hàng: " + authMessage(err), true)));
  unsubscribers.push(onSnapshot(query(collection(db, "deals"), where("owner", "==", owned)), snap => applySnap("deals", snap, true, "owner"), err => notice("Lỗi tải đơn hàng cũ: " + authMessage(err), true)));
  unsubscribers.push(onSnapshot(query(collection(db, "kpiProposals"), where("ownerEmail", "==", email)), snap => applySnap("kpiProposals", snap, true, "ownerEmail"), err => notice("Lỗi tải đề xuất KPI: " + authMessage(err), true)));
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
    if (owner && customerOwnerKey(c) !== owner && clean(c.owner) !== owner) return false;
    if (status === "__NO_PHONE__" && c.phoneNormalized) return false;
    if (status && status !== "__NO_PHONE__" && clean(c.status) !== status) return false;
    if (dealStatus && !customerDeals(c.id).some(d => normalizeKey(normalizeDealStatus(d.dealStatus)) === normalizeKey(dealStatus))) return false;
    if (!followMatchesFilter(c, follow)) return false;
    if (channel && normalizeKey(canonicalChannel(c.channel)) !== normalizeKey(channel)) return false;
    if (week && weekOf(c.createdAt) !== week) return false;
    if (!week && month && monthOf(c.createdAt) !== month) return false;
    return true;
  });
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
const dealAmount = d => Number(d?.amount || 0);
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
const openDealCount = id => customerDeals(id).filter(d => !isCompletedDeal(d) && !isCanceledDeal(d.dealStatus) && !isFailStatus(d.dealStatus)).length;

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
const adminViewIds = ["careSettingsPanel","dropdownSettingsPanel","proHealthPanel","userAdminPanel","trashPanel","auditPanel"];
const customerViewIds = ["customerSearchPanel"];
const kpiViewIds = ["kpiSummaryPanel","kpiRulePanel","kpiApprovalPanel"];
const ordersViewIds = ["ordersPanel"];
const productsViewIds = ["productsPanel"];
const reportsViewIds = ["reportsPanel"];

function renderCrmView() {
  renderKpis();
  renderExecutiveDashboard();
  renderPipelineReport();
  requestChartRender();
  renderNeedCare();
}

function setMainView(view) {
  activeMainView = ["customers","kpi","orders","products","reports","admin"].includes(view) ? view : "crm";
  if (activeMainView === "reports" && !isManager()) activeMainView = "crm";
  if (activeMainView === "admin" && !isManager()) activeMainView = "crm";
  const isCustomerView = activeMainView === "customers";
  const isKpiView = activeMainView === "kpi";
  const isOrdersView = activeMainView === "orders";
  const isProductsView = activeMainView === "products";
  const isReportsView = activeMainView === "reports";
  const isAdminView = activeMainView === "admin";
  crmViewIds.forEach(id => {
    if (isCustomerView || isKpiView || isOrdersView || isProductsView || isReportsView || isAdminView) $(id)?.classList.add("hide");
  });
  if (!isCustomerView && !isKpiView && !isOrdersView && !isProductsView && !isReportsView && !isAdminView) {
    $("needCarePanel")?.classList.remove("hide");
    $("executiveDashboard")?.classList.toggle("hide", !isManager());
    $("pipelinePanel")?.classList.toggle("hide", !isManager());
  }
  adminViewIds.forEach(id => $(id)?.classList.add("hide"));
  if (isAdminView) {
    $("careSettingsPanel")?.classList.toggle("hide", !isManager());
    $("proHealthPanel")?.classList.toggle("hide", !isManager());
    $("auditPanel")?.classList.toggle("hide", !isManager());
    $("dropdownSettingsPanel")?.classList.toggle("hide", !isAdmin());
    $("userAdminPanel")?.classList.toggle("hide", !isAdmin());
    $("trashPanel")?.classList.toggle("hide", !isAdmin());
  }
  customerViewIds.forEach(id => $(id)?.classList.toggle("hide", !isCustomerView));
  document.querySelector(".chart-grid")?.classList.toggle("hide", isCustomerView || isKpiView || isOrdersView || isProductsView || isReportsView || isAdminView);
  $("kpiSummaryPanel")?.classList.toggle("hide", !isKpiView);
  $("kpiRulePanel")?.classList.toggle("hide", !isKpiView || !isManager());
  $("kpiApprovalPanel")?.classList.toggle("hide", !isKpiView || !isManager());
  ordersViewIds.forEach(id => $(id)?.classList.toggle("hide", !isOrdersView));
  productsViewIds.forEach(id => $(id)?.classList.toggle("hide", !isProductsView));
  reportsViewIds.forEach(id => $(id)?.classList.toggle("hide", !isReportsView));
  $("adminViewBtn")?.classList.toggle("hide", !isManager());
  $("reportsViewBtn")?.classList.toggle("hide", !isManager());
  $("crmViewBtn")?.classList.toggle("primary", !isCustomerView && !isKpiView && !isOrdersView && !isProductsView && !isReportsView && !isAdminView);
  $("customersViewBtn")?.classList.toggle("primary", isCustomerView);
  $("ordersViewBtn")?.classList.toggle("primary", isOrdersView);
  $("productsViewBtn")?.classList.toggle("primary", isProductsView);
  $("kpiViewBtn")?.classList.toggle("primary", isKpiView);
  $("reportsViewBtn")?.classList.toggle("primary", isReportsView);
  $("adminViewBtn")?.classList.toggle("primary", isAdminView);
  if (!isCustomerView && !isKpiView && !isOrdersView && !isProductsView && !isReportsView && !isAdminView) renderCrmView();
  if (isCustomerView) renderCustomers();
  if (isKpiView) {
    renderKpiTable();
    renderMyKpiProposalPanel();
    renderKpiRuleList();
    renderKpiApprovalPanel();
  }
  if (isOrdersView) renderOrders();
  if (isProductsView) renderProducts();
  if (isReportsView) renderReportCenter();
  if (isAdminView) {
    renderHealthCheck();
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
  const pending = filteredDeals.filter(d => !isCompletedDeal(d) && !isCanceledDeal(d.dealStatus) && !isFailStatus(d.dealStatus));
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
  const pendingDeals = reportDeals.filter(d => !isCompletedDeal(d) && !isCanceledDeal(d.dealStatus) && !isFailStatus(d.dealStatus));
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

function inReportRange(c, range) {
  const d = toDate(c.createdAt);
  if (!d) return false;
  const now = new Date();
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

function renderChannelReportChart() {
  const canvas = $("channelReportChart");
  if (!canvas) return false;
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
        <div><b>${esc(money(dealAmount(d)))}</b>${orderProductText(d) ? ` · ${esc(orderProductText(d))}` : ""}</div>
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
  const pendingDeals = reportDeals.filter(d => !isCompletedDeal(d) && !isCanceledDeal(d.dealStatus) && !isFailStatus(d.dealStatus));
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

function renderNeedCare() {
  const rows = customers.filter(canSeeCustomer).filter(isCareDue).sort((a,b) => clean(a.nextCareDate).localeCompare(clean(b.nextCareDate)));
  const panel = $("needCarePanel");
  panel.classList.toggle("care-alert", rows.length > 0);
  if (!rows.length) {
    $("needCareList").className = "care-empty";
    $("needCareList").textContent = "Không có khách cần chăm.";
    return;
  }
  $("needCareList").className = "need-grid";
  $("needCareList").innerHTML = rows.slice(0,12).map(c => {
    const delta = careDeltaDays(c);
    const label = sameLabel(computedFollowStatus(c), "overdueFollow") ? `${systemLabel("overdueFollow")} ${delta} ngày` : systemLabel("dueFollow");
    return `
      <div class="need-card">
        <div><b>${esc(c.name)}</b> - ${esc(c.phoneRaw || c.phoneNormalized || "Không SĐT")}</div>
        <div class="muted">${esc(customerOwnerName(c))} · Hẹn: ${esc(fmtDate(c.nextCareDate))}</div>
        <div><span class="pill ${delta > 0 ? "red" : "orange"}">${esc(label)}</span></div>
        <button class="small" data-care-open="${esc(c.id)}">Mở</button>
      </div>
    `;
  }).join("");
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

function renderCustomers() {
  const rows = visibleCustomers();
  $("customerRows").innerHTML = rows.length ? rows.map(c => {
    const counts = dealCounts(c.id);
    const st = latestDealStatus(c) || c.status || "";
    const careStatus = computedFollowStatus(c);
    const rowClass = ["customer-row", isFailStatus(st) || isCanceledDeal(st) ? "row-fail" : "", purchaseCount(c.id) ? "row-success row-vip" : "", isCareOverdue(c) ? "row-overdue" : ""].filter(Boolean).join(" ");
    const careBadge = isCareOverdue(c) ? `<br><span class="pill red">Quá ${esc(careDeltaDays(c))} ngày</span>` : isCareDue(c) ? `<br><span class="pill orange">${esc(systemLabel("dueFollow"))}</span>` : "";
    return `<tr class="${rowClass}">
      <td><b>${esc(c.name)}</b>${c.companyName ? `<br><span class="muted">${esc(c.companyName)}</span>` : ""}</td>
      <td>${esc(c.phoneRaw || c.phoneNormalized || "Không SĐT")} ${(c.phoneRaw || c.phoneNormalized) ? `<button class="quick-copy" type="button" data-copy-phone="${esc(c.phoneRaw || c.phoneNormalized)}">Copy</button>` : ""}</td>
      <td>${esc(fmtDate(c.createdAt))}</td>
      <td class="source-col">${c.channel ? `<span class="pill">${esc(c.channel)}</span>` : ""}</td>
      <td>${esc(customerOwnerName(c))}</td>
      <td>${esc(c.status || "")}</td>
      <td><span class="pill ${sameLabel(careStatus, "overdueFollow") ? "red" : sameLabel(careStatus, "dueFollow") ? "orange" : sameLabel(careStatus, "closedFollow") ? "" : "green"}">${esc(careStatus)}</span></td>
      <td>
        <div><b>${esc(systemLabel("depositStatus"))}:</b> ${counts.deposit}</div>
        <div><b>${esc(systemLabel("boughtStatus"))}:</b> ${counts.bought}</div>
        <div><b>${esc(systemLabel("canceledStatus"))}:</b> ${counts.canceled}</div>
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
}

function renderKpiTable() {
  const week = clean($("filterWeek").value);
  // KPI dùng tháng KPI riêng; bộ lọc Tháng của danh sách khách để trống thì không lọc khách.
  const month = clean($("kpiRuleMonth").value) || currentMonth();
  const monthRules = kpiRulesForMonth(month);
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
    const cs = customers.filter(c => canSeeCustomer(c) && (customerOwnerKey(c) === o || clean(c.owner) === o));
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
    const revenue = ds.filter(isCompletedDeal).reduce((sum, d) => sum + dealAmount(d), 0);
    const rate = cs.length ? Math.round(boughtCustomerCount / cs.length * 100) : 0;
    const ruleCells = monthRules.map(rule => {
      if (!kpiRuleAppliesToOwner(rule, o)) return `<td><span class="muted">Không gán</span></td>`;
      const value = kpiRuleValue(rule, o);
      const target = kpiRuleTargetForOwner(rule, o);
      const cls = target && value >= target ? "green" : "";
      return `<td><button class="pill ${cls} kpi-drill-pill" type="button" title="Xem chi tiết KPI đã gửi" data-kpi-owner-detail="${esc(rule.id)}" data-owner-key="${esc(o)}">${esc(value)}${target ? `/${esc(target)}` : ""}</button></td>`;
    }).join("");
    return `<tr><td><b>${esc(profile.name || o)}</b><div class="muted">${esc(profile.email && profile.email !== profile.name ? profile.email : "")}</div></td><td>${cs.length}</td><td>${monthLead}</td><td>${dealCount}</td><td>${ds.filter(d=>sameLabel(normalizeDealStatus(d.dealStatus),"depositStatus")).length}</td><td>${closeCount}</td><td>${cancelCount}</td><td>${esc(money(revenue))}</td>${ruleCells}<td>${rate}%</td><td>${due}</td><td>${overdue}</td></tr>`;
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

function ownKpiProposals() {
  return kpiProposals
    .filter(p => !p.isDeleted)
    .filter(p => [ownerEmail(), ownerName()].some(key => kpiProposalMatchesOwner(p, key)))
    .sort(byDateDesc);
}

function renderMyKpiProposalPanel() {
  if (!$("kpiMyProposalList")) return;
  const rows = ownKpiProposals();
  const pending = rows.filter(isPendingKpiProposal).length;
  const approved = rows.filter(isApprovedKpiProposal).length;
  const rejected = rows.filter(isRejectedKpiProposal).length;
  $("kpiMyProposalList").innerHTML = rows.length ? `
    <div class="detail-meta" style="margin-bottom:8px">
      <span>Chờ duyệt: ${esc(pending)}</span>
      <span>Đã duyệt: ${esc(approved)}</span>
      <span>Từ chối: ${esc(rejected)}</span>
    </div>
    ${rows.map(kpiProposalCard).join("")}
  ` : `<div class="muted">Bạn chưa gửi đề xuất KPI nào.</div>`;
}

function kpiReportData() {
  const week = clean($("filterWeek").value);
  const month = clean($("kpiRuleMonth").value) || currentMonth();
  const monthRules = kpiRulesForMonth(month);
  const ownerKeys = reportOwnerKeys();
  const summaryRows = ownerKeys.map(o => {
    const profile = ownerProfileByValue(o);
    const cs = customers.filter(c => canSeeCustomer(c) && (customerOwnerKey(c) === o || clean(c.owner) === o));
    const ids = new Set(cs.map(c => c.id));
    const ds = deals.filter(d => ids.has(d.customerId));
    const closeCount = ds.filter(isCompletedDeal).length;
    const boughtCustomerCount = cs.filter(c => customerHasCompletedDeal(c.id)).length;
    const revenue = ds.filter(isCompletedDeal).reduce((sum, d) => sum + dealAmount(d), 0);
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
    .filter(p => clean(p.month) === month && !p.isDeleted)
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
      personExportCell(p.owner, p.email || p.ownerEmail), p.kpiName || "", p.month || "", p.phone || "", p.department || "",
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
  const pending = report.deals.filter(d => !isCompletedDeal(d) && !isCanceledDeal(d.dealStatus) && !isFailStatus(d.dealStatus));
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

function kpiRulesForMonth(month) {
  return kpiRules.filter(r => clean(r.month) === month);
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

function proposalKpiRulesForMonth(month) {
  return kpiRulesForMonth(month).filter(kpiRuleAppliesToCurrentUser);
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
  const month = clean($("kpiRuleMonth")?.value) || currentMonth();
  const rules = proposalKpiRulesForMonth(month);
  el.innerHTML = `<option value="">-- Chọn KPI --</option>`;
  rules.forEach(rule => el.insertAdjacentHTML("beforeend", `<option value="${esc(rule.id)}" data-month="${esc(rule.month || "")}">${esc(rule.name)} · ${esc(rule.month)}</option>`));
  if (!rules.length) el.insertAdjacentHTML("beforeend", `<option value="" disabled>Chưa có KPI được gán cho bạn trong tháng này</option>`);
  if (rules.some(rule => rule.id === current)) el.value = current;
}

function kpiRuleValue(rule, ownerKey) {
  return kpiProposals.filter(p => {
    if (p.isDeleted) return false;
    if (!isApprovedKpiProposal(p)) return false;
    if (clean(p.kpiRuleId) !== clean(rule.id)) return false;
    if (clean(p.month) !== clean(rule.month)) return false;
    if (!kpiRuleAppliesToOwner(rule, ownerKey)) return false;
    const proposalKeys = [p.ownerEmail, p.email, p.owner].map(clean).filter(Boolean);
    const ownerProfile = ownerProfileByValue(ownerKey);
    const ownerKeys = [ownerKey, ownerProfile.email, ownerProfile.name].map(clean).filter(Boolean);
    if (!proposalKeys.some(a => ownerKeys.some(b => normalizeKey(a) === normalizeKey(b)))) return false;
    return true;
  }).length;
}

const isApprovedKpiProposal = p => clean(p?.status).toLowerCase() === "approved";
const isPendingKpiProposal = p => clean(p?.status).toLowerCase() === "pending";
const isRejectedKpiProposal = p => clean(p?.status).toLowerCase() === "rejected";

function kpiProposalsForRule(ruleId) {
  return kpiProposals.filter(p => clean(p.kpiRuleId) === clean(ruleId) && !p.isDeleted);
}

function approvedKpiProposalsForRule(ruleId) {
  return kpiProposalsForRule(ruleId).filter(isApprovedKpiProposal);
}

function renderKpiControlRows() {
  if (!isManager()) return;
  const month = clean($("kpiRuleMonth").value) || currentMonth();
  const rules = kpiRulesForMonth(month);
  $("kpiControlRows").innerHTML = rules.length ? rules.map(rule => {
    const assigned = kpiRuleAssignedOwners(rule);
    const ownerRows = (assigned.length ? assigned : kpiAssignableUsers().map(u => u.email)).map(email => {
      const profile = ownerProfileByValue(email);
      const value = kpiRuleValue(rule, email);
      const target = kpiRuleTargetForOwner(rule, email);
      const pct = target ? Math.min(100, Math.round(value / target * 100)) : 0;
      return `<div><b>${esc(profile.name || email)}</b> <span class="muted">${esc(email)}</span> · ${esc(value)}/${esc(target || 0)} <span class="pill ${target && value >= target ? "green" : ""}">${esc(pct)}%</span></div>`;
    }).join("");
    const totalValue = (assigned.length ? assigned : kpiAssignableUsers().map(u => u.email)).reduce((sum,email) => sum + kpiRuleValue(rule, email), 0);
    const totalTarget = (assigned.length ? assigned : kpiAssignableUsers().map(u => u.email)).reduce((sum,email) => sum + kpiRuleTargetForOwner(rule, email), 0);
    const totalPct = totalTarget ? Math.round(totalValue / totalTarget * 100) : 0;
    return `
      <tr>
        <td><b>${esc(rule.name)}</b><div class="muted">${esc(rule.month)} · ${assigned.length ? "Gán riêng" : "Áp dụng tất cả nhân viên"}</div></td>
        <td>${ownerRows || "<span class='muted'>Chưa gán nhân viên</span>"}</td>
        <td><b>${esc(totalValue)}/${esc(totalTarget)}</b><div class="muted">${esc(totalPct)}%</div></td>
        <td><span class="pill ${totalTarget && totalValue >= totalTarget ? "green" : "orange"}">${totalTarget && totalValue >= totalTarget ? "Đạt" : "Đang chạy"}</span></td>
        <td><div class="actions"><button class="small" data-edit-kpi-rule="${esc(rule.id)}">Sửa</button><button class="small" data-kpi-rule-proposals="${esc(rule.id)}">Chi tiết KPI</button><button class="small danger" data-disable-kpi-rule="${esc(rule.id)}">Tắt</button></div></td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="5" class="muted">Chưa có KPI tháng.</td></tr>`;
}

function renderKpiRuleList() {
  if (!isManager()) return;
  renderKpiAssignmentBuilder();
  renderKpiControlRows();
}

function renderKpiApprovalPanel() {
  if (!isManager()) return;
  const proposalPending = kpiProposals
    .filter(p => isPendingKpiProposal(p) && !p.isDeleted)
    .sort(byDateDesc);
  const proposalHtml = proposalPending.length ? proposalPending.map(p => `
    <div class="rule-item">
      <div class="actions" style="justify-content:space-between;align-items:flex-start">
        <div>
          <b>${esc(p.kpiName || "KPI")}</b> <span class="muted">· ${esc(p.month || "")}</span>
          <div>${esc(p.owner || p.ownerEmail || "Nhân viên")} ${p.department ? "· " + esc(p.department) : ""}</div>
          ${p.customerName || p.customerPhone || p.customerCompanyName ? `<div class="muted">KH: ${esc([p.customerName, p.customerPhone, p.customerCompanyName].filter(Boolean).join(" · "))}</div>` : ""}
          <div class="muted">${esc([p.email, p.phone].filter(Boolean).join(" · "))}</div>
          <div>${esc(p.content || "")}</div>
          ${p.evidenceUrl ? `<div><button class="small" type="button" data-kpi-proposal-detail="${esc(p.id)}">Xem ảnh minh chứng</button></div>` : ""}
        </div>
        <div class="actions">
          <button class="small" data-kpi-proposal-detail="${esc(p.id)}">Chi tiết</button>
          ${isAdmin() ? `<button class="small danger" data-delete-kpi-proposal="${esc(p.id)}">Xóa test</button>` : ""}
          <button class="small primary" data-approve-kpi-proposal="${esc(p.id)}">Duyệt</button>
          <button class="small danger" data-reject-kpi-proposal="${esc(p.id)}">Từ chối</button>
        </div>
      </div>
    </div>
  `).join("") : `<div class="muted">Chưa có đề xuất thủ công chờ duyệt.</div>`;
  $("kpiApprovalList").innerHTML = proposalHtml;
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
              <span>Tháng: ${esc(p.month || rule?.month || "")}</span>
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
  return `
    <div class="detail-row">
      <div class="detail-row-head">
        <div>
          <b>${esc(p.kpiName || "KPI")}</b>
          <div class="detail-meta">
            <span class="pill ${kpiProposalStatusClass(p)}">${esc(statusLabel)}</span>
            <span>${esc([p.owner, p.email || p.ownerEmail].filter(Boolean).join(" - "))}</span>
            ${p.customerName ? `<span>KH: ${esc(p.customerName)}</span>` : ""}
            <span>${esc(fmtDate(p.createdAt) || "")}</span>
          </div>
        </div>
        <div class="actions">
          <button class="small" data-kpi-proposal-detail="${esc(p.id)}">Chi tiết</button>
          ${canEditKpiProposal(p) ? `<button class="small primary" data-edit-kpi-proposal="${esc(p.id)}">Sửa</button>` : ""}
          ${canSoftDeleteKpiProposal(p) ? `<button class="small danger" data-soft-delete-kpi-proposal="${esc(p.id)}">Xóa đề xuất</button>` : ""}
          ${isAdmin() ? `<button class="small danger" data-delete-kpi-proposal="${esc(p.id)}">Xóa test</button>` : ""}
        </div>
      </div>
      <div class="detail-note">${esc(p.content || "")}</div>
      ${p.evidenceUrl ? `<div><button class="small" type="button" data-kpi-proposal-detail="${esc(p.id)}">Xem ảnh minh chứng</button></div>` : ""}
    </div>
  `;
}

function openKpiRuleProposals(ruleId) {
  if (!isManager()) return notice("Chỉ admin/manager được xem chi tiết KPI.", true);
  const rule = kpiRules.find(r => r.id === ruleId);
  const allRows = kpiProposalsForRule(ruleId);
  const rows = approvedKpiProposalsForRule(ruleId).sort(byDateDesc);
  const pending = allRows.filter(isPendingKpiProposal).length;
  const rejected = allRows.filter(isRejectedKpiProposal).length;
  openDetailModal(
    `KPI đã duyệt: ${rule?.name || "KPI"}`,
    `${rows.length} đã duyệt trong tháng ${rule?.month || ""} · Chờ duyệt ${pending} · Từ chối ${rejected}`,
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
  const profile = ownerProfileByValue(ownerKey);
  const allRows = kpiProposalsForRule(ruleId)
    .filter(p => kpiProposalMatchesOwner(p, ownerKey))
    .sort(byDateDesc);
  const rows = allRows;
  const approved = allRows.filter(isApprovedKpiProposal).length;
  const pending = allRows.filter(isPendingKpiProposal).length;
  const rejected = allRows.filter(isRejectedKpiProposal).length;
  const target = kpiRuleTargetForOwner(rule, ownerKey);
  openDetailModal(
    `KPI: ${rule.name || "KPI"}`,
    `${profile.name || ownerKey}${profile.email && profile.email !== profile.name ? " · " + profile.email : ""} · Đã duyệt ${approved}/${target || 0} · Chờ ${pending} · Từ chối ${rejected}`,
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
    `${rule.month || ""} · Cách tính: Số đề xuất được duyệt`,
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
    `${proposal.owner || proposal.ownerEmail || "Nhân viên"} · ${proposal.month || ""}`,
    kpiProposalDetailHtml(proposal)
  );
}

async function saveKpiRule() {
  if (!isManager()) return notice("Chỉ admin/manager được tạo KPI tháng.", true);
  const assignments = collectKpiAssignments();
  const data = {
    month: clean($("kpiRuleMonth").value) || clean($("filterMonth").value) || currentMonth(),
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
  if (!data.month) return notice("Vui lòng chọn tháng KPI.", true);
  if (!data.name) return notice("Vui lòng nhập tên KPI.", true);
  if (data.target < 0) return notice("Chỉ tiêu KPI không hợp lệ.", true);
  if (!data.assignedOwners.length) return notice("Vui lòng gán KPI cho ít nhất 1 nhân viên.", true);
  try {
    if (editingKpiRuleId) {
      await setDoc(doc(db, "kpiRules", editingKpiRuleId), data, {merge:true});
      notice("Đã cập nhật KPI tháng.");
    } else {
      await setDoc(doc(collection(db, "kpiRules")), {
        ...data,
        createdByEmail: currentUser?.email || "",
        createdAt: serverTimestamp()
      });
      notice("Đã tạo KPI tháng.");
    }
    resetKpiRuleForm();
  } catch (err) {
    notice("Không lưu được KPI tháng: " + authMessage(err), true);
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
  $("kpiRuleMonth").value = clean(rule.month) || currentMonth();
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
  if (!isManager()) return notice("Chỉ admin/manager được tắt KPI tháng.", true);
  if (!ruleId) return;
  if (!confirm("Tắt KPI tháng này? Dữ liệu chăm sóc vẫn giữ nguyên, chỉ ẩn KPI khỏi bảng.")) return;
  try {
    await setDoc(doc(db, "kpiRules", ruleId), {
      active: false,
      updatedByEmail: currentUser?.email || "",
      updatedAt: serverTimestamp()
    }, {merge:true});
    notice("Đã tắt KPI tháng.");
  } catch (err) {
    notice("Không tắt được KPI tháng: " + authMessage(err), true);
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

  const ownerFolder = storageSafePart(ownerEmail() || currentUser?.email || "sale");
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
  if (proposal.month && $("kpiRuleMonth")) $("kpiRuleMonth").value = proposal.month;
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
    month: rule.month || currentMonth(),
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
    ["Trùng SĐT", duplicatePhones, duplicatePhones ? "Cần xử lý" : "Ổn"],
    ["Thiếu phụ trách", noOwner, noOwner ? "Cần gán sale" : "Ổn"],
    ["Quá hạn chăm", overdue, overdue ? "Cần gọi lại" : "Ổn"],
    ["Lead chưa có ngày chăm", missingNextDate, missingNextDate ? "Cần phân công lịch" : "Ổn"]
  ];
  $("healthGrid").innerHTML = cards.map(([label,num,note]) => `
    <div class="health-card">
      <div class="muted">${esc(label)}</div>
      <b>${esc(num)}</b>
      <div class="muted">${esc(note)}</div>
    </div>
  `).join("");
}

function renderUserAdmin() {
  if (!isAdmin()) return;
  $("userRows").innerHTML = users.length ? users.map(u => {
    const role = clean(u.role || "sale").toLowerCase();
    return `<tr>
      <td><b>${esc(u.name || u.email || u.uid)}</b><div class="muted">${esc(u.email || "")}</div></td>
      <td><select data-user-role="${esc(u.uid)}">
        ${["sale","manager","admin"].map(r => `<option value="${r}" ${role===r ? "selected" : ""}>${r}</option>`).join("")}
      </select></td>
      <td><select data-user-active="${esc(u.uid)}"><option value="true" ${u.active !== false ? "selected" : ""}>active</option><option value="false" ${u.active === false ? "selected" : ""}>locked</option></select></td>
      <td><input data-user-team="${esc(u.uid)}" value="${esc(u.team || "")}" placeholder="Team"></td>
      <td><select data-user-export="${esc(u.uid)}"><option value="false" ${u.canExport !== true ? "selected" : ""}>Không</option><option value="true" ${u.canExport === true ? "selected" : ""}>Có</option></select></td>
      <td><button class="small primary" data-save-user="${esc(u.uid)}">Lưu</button></td>
    </tr>`;
  }).join("") : `<tr><td colspan="6" class="muted">Chưa có user.</td></tr>`;
}

function renderAuditTrail() {
  if (!isManager()) return;
  $("auditRows").innerHTML = auditLogs.length ? auditLogs.slice(0,60).map(a => `
    <tr class="audit-row">
      <td>${esc(fmtDate(a.createdAt))}</td>
      <td><b>${esc(a.email || "")}</b></td>
      <td>${esc(a.action || "")}</td>
      <td>${esc(a.entity || "")}<div class="muted">${esc(a.entityId || "")}</div></td>
      <td><div class="audit-payload">${esc(a.payloadJson || a.note || "")}</div></td>
    </tr>
  `).join("") : `<tr><td colspan="5" class="muted">Chưa có audit log hoặc chưa được cấp quyền đọc.</td></tr>`;
}

function renderTrash() {
  if (!isAdmin()) return;
  $("trashList").innerHTML = deletedCustomers.length ? deletedCustomers
    .sort(byDateDesc)
    .map(c => {
      const relatedCare = allCareLogs.filter(l => l.customerId === c.id).length;
      const relatedDeals = allDeals.filter(d => d.customerId === c.id).length;
      return `
        <div class="rule-item">
          <div class="actions" style="justify-content:space-between;align-items:flex-start">
            <div>
              <b>${esc(c.name || "Khách hàng")}</b> <span class="muted">· ${esc(c.phoneRaw || c.phoneNormalized || "Không SĐT")}</span>
              <div class="muted">${esc(customerOwnerName(c))} · Xóa: ${esc(fmtDate(c.deletedAt || c.updatedAt))}</div>
              <div class="muted">Care logs: ${esc(relatedCare)} · Deals: ${esc(relatedDeals)}</div>
            </div>
            <div class="actions">
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
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "users", uid), {role, active, team, canExport, updatedByEmail: currentUser?.email || "", updatedAt: serverTimestamp()}, {merge:true});
    batch.set(doc(collection(db, "auditLogs")), {
      action: "updateUser", entity: "users", entityId: uid, email: currentUser?.email || "",
      payloadJson: JSON.stringify({targetEmail:user.email || "", role, active, team, canExport}), createdAt: serverTimestamp()
    });
    await batch.commit();
    notice("Đã cập nhật nhân viên.");
  } catch (err) {
    notice("Không cập nhật được nhân viên: " + authMessage(err), true);
  }
}

function renderAll() {
  if (!$("appView") || $("appView").classList.contains("hide")) return;
  renderTodayCare();
  renderOnlineUsers();
  if (selectedCustomerId) {
    renderCustomerInfo(customers.find(c => c.id === selectedCustomerId));
    renderHistories(selectedCustomerId);
  }
  setMainView(activeMainView);
  notifyTodayCare();
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
  const c = customers.find(x => x.id === selectedCustomerId);
  if (!c || !canEditCustomer(c)) return notice("Bạn không có quyền tạo đơn cho khách này.", true);
  if (!clean($("dealCustomerName").value)) return notice("Vui lòng nhập tên khách trong đơn hàng.", true);
  const dealStatus = systemLabel("depositStatus");
  const completed = sameLabel(dealStatus, "boughtStatus");
  const depositPercent = Number($("dealDepositPercent").value || 0);
  const amount = Number($("dealAmount").value || 0);
  if (depositPercent < 0 || depositPercent > 100) return notice("Tỷ lệ cọc phải từ 0 đến 100%.", true);
  const items = collectDealItems();
  const productSummary = items.map(item => [item.product || item.productLabel, item.code ? `(${item.code})` : "", item.size].filter(Boolean).join(" ")).join("; ");
  const deal = {
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
    note: clean($("dealNote").value), createdByEmail: currentUser.email || "",
    completed,
    completedAt: completed ? serverTimestamp() : null,
    completedByEmail: completed ? (currentUser.email || "") : "",
    createdAt: serverTimestamp()
  };
  if (!items.length) return notice("Vui lòng thêm ít nhất 1 sản phẩm.", true);
  try {
    const batch = writeBatch(db);
    const dealRef = doc(collection(db, "deals"));
    const customerRef = doc(db, "customers", c.id);
    const auditRef = doc(collection(db, "auditLogs"));
    batch.set(dealRef, deal);
    batch.update(customerRef, {
      dealStatus: deal.dealStatus,
      status: completed ? systemLabel("boughtStatus") : systemLabel("depositStatus"),
      follow: completed ? systemLabel("closedFollow") : systemLabel("activeFollow"),
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
    ["dealDepositPercent","dealAmount","dealNote","dealDeliveryDate","dealTaxCode"].forEach(id => $(id).value = "");
    resetDealItems();
    $("dealStatus").value = "";
    $("dealDate").value = todayIso();
    notice("Đã tạo đơn hàng.");
  } catch (err) {
    notice(authMessage(err), true);
  }
}

async function completeDeal(dealId) {
  const deal = deals.find(d => d.id === dealId);
  if (!deal || deal.completed) return;
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

function reviewDeal(dealId) {
  const d = deals.find(x => x.id === dealId);
  if (!d) return;
  const items = Array.isArray(d.items) && d.items.length
    ? d.items.map((item, idx) => `${idx + 1}. ${item.product || item.productLabel || ""}${item.code ? ` - ${item.code}` : ""}${item.size ? ` - ${item.size}` : ""}${item.surface ? ` - ${item.surface}` : ""}${item.origin ? ` - ${item.origin}` : ""}${item.qty ? ` - SL: ${item.qty}` : ""}`).join("\n")
    : `${d.product || ""}${d.quantity ? ` - SL: ${d.quantity}` : ""}`;
  alert([
    `Khách hàng: ${d.orderCustomerName || d.customerName || ""}`,
    `SĐT: ${d.orderPhone || d.phoneRaw || d.phoneNormalized || "Không SĐT"}`,
    `Địa chỉ giao hàng: ${d.deliveryAddress || ""}`,
    `Mã số thuế: ${d.taxCode || ""}`,
    `Trạng thái đơn: ${normalizeDealStatus(d.dealStatus)}`,
    `Đã cọc: ${d.depositPercent ?? 0}%`,
    `Ngày cọc: ${fmtDate(d.dealDate)}`,
    `Ngày giao: ${fmtDate(d.deliveryDate)}`,
    `Sản phẩm:\n${items}`,
    `Ghi chú: ${d.note || ""}`
  ].join("\n"));
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
  $("customerInfoEdit").classList.toggle("hide", !show);
  $("editCustomerInfoBtn").classList.toggle("hide", show);
  if (show) fillCustomerInfoEdit(c);
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
  $("drawerTitle").textContent = c.name || "Khách hàng";
  $("drawerInfo").textContent = `${c.phoneRaw || c.phoneNormalized || "Không SĐT"} · ${customerOwnerName(c)} · Lần mua hàng: ${purchaseCount(id)}`;
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
  $("dealStatus").value = "";
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
      ${(!d.completed && !isFailStatus(d.dealStatus) && !isCanceledDeal(d.dealStatus)) ? `<div class="actions"><button class="small" data-review-deal="${esc(d.id)}">Xem lại</button><button class="small primary" data-complete-deal="${esc(d.id)}">Hoàn thành</button><button class="small danger" data-cancel-deal="${esc(d.id)}">Hủy đơn</button></div>` : `<div class="actions"><button class="small" data-review-deal="${esc(d.id)}">Xem lại</button></div>`}
    </div>
  `;
}

function showDealList(kind) {
  if (!selectedCustomerId) return;
  const ds = customerDeals(selectedCustomerId).filter(d => kind === "completed" ? d.completed : (!d.completed && !isCanceledDeal(d.dealStatus)));
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
  const logs = customerLogs(id);
  const dealRows = customerDeals(id).map(d => ({
    type: "Đơn hàng",
    at: d.completedAt || d.dealDate || d.createdAt,
    html: `
      <div class="log-item deal-item">
        <b>${esc(normalizeDealStatus(d.dealStatus) || "Đơn hàng")}</b> · ${esc(fmtDate(d.completedAt || d.dealDate || d.createdAt))}
        <div>${esc(d.product || d.itemsText || "")} ${d.amount ? "· " + esc(money(d.amount)) : ""}</div>
        ${d.note ? `<div class="muted">${esc(d.note)}</div>` : ""}
      </div>
    `
  }));
  const proposalRows = kpiProposals
    .filter(p => p.customerId === id && !p.isDeleted)
    .map(p => ({
      type: "KPI",
      at: p.createdAt,
      html: `
        <div class="log-item">
          <b>KPI: ${esc(p.kpiName || "")}</b> · ${esc(isApprovedKpiProposal(p) ? "Đã duyệt" : isRejectedKpiProposal(p) ? "Từ chối" : "Chờ duyệt")} · ${esc(fmtDate(p.createdAt))}
          <div class="muted">${esc(p.content || "")}</div>
          ${p.evidenceUrl ? `<div><button class="small" type="button" data-kpi-proposal-detail="${esc(p.id)}">Xem ảnh minh chứng</button></div>` : ""}
        </div>
      `
    }));
  const careRows = logs.map(l => ({
    type: "Chăm sóc",
    at: l.createdAt,
    html: `
    <div class="log-item">
      <b>${esc(l.status || "")}</b> · ${esc(l.follow || "")} · ${esc(fmtDate(l.createdAt))}
      <div>${esc(l.careChannel || "")} ${l.careResult ? "· " + esc(l.careResult) : ""}</div>
      ${(l.companyName || l.partnerType || l.partnerActivity || l.partnerLevel || l.partnerCapacity) ? `<div class="muted">${esc([l.companyName,l.partnerType,l.partnerActivity,l.partnerLevel,l.partnerCapacity].filter(Boolean).join(" · "))}</div>` : ""}
      <div class="muted">${esc(l.note || "")}</div>
      ${l.nextCareDate ? `<div class="muted">Hẹn: ${esc(fmtDate(l.nextCareDate))}</div>` : ""}
      ${isAdmin() ? `<div class="actions"><button class="small" data-edit-care-log="${esc(l.id)}">Sửa</button><button class="small danger" data-delete-care-log="${esc(l.id)}">Xóa</button></div>` : ""}
    </div>
    `
  }));
  const timeline = [...careRows, ...dealRows, ...proposalRows].sort((a,b) => (toDate(b.at)?.getTime() || 0) - (toDate(a.at)?.getTime() || 0));
  $("logHistory").innerHTML = timeline.length ? timeline.map(x => x.html).join("") : "Chưa có timeline hoạt động.";
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

function inDateRange(value, range) {
  const iso = isoFromAny(value);
  return !!iso && iso >= range.start && iso <= range.end;
}

function exportOwnerMatches(item, ownerFilter) {
  if (!ownerFilter) return true;
  return clean(item.ownerEmail) === ownerFilter || clean(item.owner) === ownerFilter;
}

function customerById(id) {
  return customers.find(c => c.id === id) || {};
}

function orderDate(d) {
  return isoFromAny(d.completedAt || d.dealDate || d.createdAt);
}

function orderProductText(d) {
  const items = Array.isArray(d.items) ? d.items.map(item => [item.product, item.code, item.qty ? `SL: ${item.qty}` : ""].filter(Boolean).join(" - ")).filter(Boolean) : [];
  return items.length ? items.join("; ") : clean(d.product);
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
  if (sameLabel(normalizeDealStatus(d.dealStatus), "depositStatus")) return "deposit";
  return "";
}

function orderStatusLabel(d) {
  return orderStatusKey(d) === "bought" ? systemLabel("boughtStatus") : systemLabel("depositStatus");
}

function visibleOrderDeals() {
  return deals
    .filter(d => !d.isDeleted && orderStatusKey(d))
    .filter(d => isManager() || normalizeKey(orderOwnerEmail(d)) === normalizeKey(ownerEmail()) || normalizeKey(d.owner) === normalizeKey(ownerName()))
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
    {value:"deposit", label:systemLabel("depositStatus")},
    {value:"bought", label:systemLabel("boughtStatus")}
  ], "", "Tất cả trạng thái");
  if (years.includes(yearCurrent) || yearCurrent === "") $("orderFilterYear").value = yearCurrent;
  if (/^\d{2}$/.test(monthCurrent) || monthCurrent === "") $("orderFilterMonth").value = monthCurrent;
  if (ownerOptions().some(o => clean(o.email) === ownerCurrent || clean(o.name) === ownerCurrent) || ownerCurrent === "") $("orderFilterOwner").value = ownerCurrent;
  if (["deposit","bought",""].includes(statusCurrent)) $("orderFilterStatus").value = statusCurrent;
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

function activeOrderFilterLabel() {
  const parts = [
    selectedOptionText("orderFilterYear") ? `Năm: ${selectedOptionText("orderFilterYear")}` : "",
    selectedOptionText("orderFilterMonth") ? `Tháng: ${selectedOptionText("orderFilterMonth")}` : "",
    selectedOptionText("orderFilterOwner") ? `Nhân viên: ${selectedOptionText("orderFilterOwner")}` : "",
    selectedOptionText("orderFilterStatus") ? `Trạng thái: ${selectedOptionText("orderFilterStatus")}` : ""
  ].filter(Boolean);
  return parts.length ? parts.join(" | ") : "Tất cả đơn đã cọc/đã mua";
}

function renderOrders() {
  if (!$("ordersPanel")) return;
  hydrateOrderFilters();
  const rows = filteredOrderDeals();
  const depositRows = rows.filter(d => orderStatusKey(d) === "deposit");
  const boughtRows = rows.filter(d => orderStatusKey(d) === "bought");
  const customersSet = new Set(rows.map(d => d.customerId || `${orderCustomerPhone(d)}:${orderCustomerName(d)}`).filter(Boolean));
  const totalValue = rows.reduce((sum,d) => sum + dealAmount(d), 0);
  const boughtValue = boughtRows.reduce((sum,d) => sum + dealAmount(d), 0);
  const depositValue = depositRows.reduce((sum,d) => sum + dealAmount(d), 0);
  const avgValue = rows.length ? Math.round(totalValue / rows.length) : 0;
  const cards = [
    ["Tổng đơn", rows.length, ""],
    [systemLabel("depositStatus"), depositRows.length, depositRows.length ? "warn" : ""],
    [systemLabel("boughtStatus"), boughtRows.length, ""],
    ["Tổng giá trị", money(totalValue), ""],
    ["Giá trị đã mua", money(boughtValue), ""],
    ["Giá trị đang cọc", money(depositValue), depositValue ? "warn" : ""],
    ["Khách đã giao dịch", customersSet.size, ""],
    ["Giá trị TB/đơn", money(avgValue), ""]
  ];
  $("orderSummaryGrid").innerHTML = cards.map(([label,value,cls]) => `
    <div class="executive-card ${esc(cls)}">
      <span class="muted">${esc(label)}</span>
      <b>${esc(value)}</b>
    </div>
  `).join("");
  $("orderRows").innerHTML = rows.length ? rows.map(d => {
    const c = customerById(d.customerId);
    const statusClass = orderStatusKey(d) === "bought" ? "green" : "orange";
    return `
      <tr>
        <td><b>${esc(orderCustomerName(d) || "Không tên")}</b>${c.companyName ? `<div class="muted">${esc(c.companyName)}</div>` : ""}</td>
        <td>${esc(orderCustomerPhone(d) || "Không SĐT")}</td>
        <td>${esc(orderOwnerName(d))}<div class="muted">${esc(orderOwnerEmail(d))}</div></td>
        <td><span class="pill ${statusClass}">${esc(orderStatusLabel(d))}</span></td>
        <td>${esc(fmtDate(d.dealDate || d.createdAt))}</td>
        <td>${esc(fmtDate(d.completedAt))}</td>
        <td>${esc(fmtDate(d.deliveryDate))}</td>
        <td>${esc(orderProductText(d))}</td>
        <td><b>${esc(money(d.amount || 0))}</b></td>
        <td>${esc(d.note || "")}</td>
        <td><button class="small" type="button" data-open-care="${esc(d.customerId)}">Mở khách</button></td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="11" class="muted">Chưa có đơn đã cọc/đã mua phù hợp với bộ lọc.</td></tr>`;
}

function renderReportCenter() {
  if (!$("reportsPanel") || !isManager()) return;
  const reportDeals = currentReportDeals();
  const completed = reportDeals.filter(isCompletedDeal);
  const pending = reportDeals.filter(d => !isCompletedDeal(d) && !isCanceledDeal(d.dealStatus) && !isFailStatus(d.dealStatus));
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
    <div class="executive-card ${esc(cls)}">
      <span class="muted">${esc(label)}</span>
      <b>${esc(value)}</b>
    </div>
  `).join("");
}

function exportOrders() {
  if (!canExportData()) return notice("Bạn chưa có quyền xuất file.", true);
  const rows = filteredOrderDeals();
  if (!rows.length) return notice("Không có đơn hàng phù hợp với bộ lọc hiện tại.", true);
  const header = ["Khách hàng","Tên công ty","SĐT","Nhân viên / Email","Trạng thái","Ngày đơn","Ngày mua","Hẹn giao","Sản phẩm","Giá trị","Ghi chú"];
  const dataRows = [
    [`Báo cáo đơn hàng - ${activeOrderFilterLabel()}`, "", "", "", "", "", "", "", "", "", ""],
    header,
    ...rows.map(d => {
      const c = customerById(d.customerId);
      return [
        orderCustomerName(d),
        c.companyName || "",
        orderCustomerPhone(d),
        [orderOwnerName(d), orderOwnerEmail(d)].filter(Boolean).join(" / "),
        orderStatusLabel(d),
        fmtDate(d.dealDate || d.createdAt),
        fmtDate(d.completedAt),
        fmtDate(d.deliveryDate),
        orderProductText(d),
        d.amount || 0,
        d.note || ""
      ];
    })
  ];
  exportXlsx([{ name: "Don hang", rows: dataRows }], `crm-don-hang-${new Date().toISOString().slice(0,10)}`);
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
    clean($("filterWeek").value) ? `Tuần: ${clean($("filterWeek").value)}` : "",
    !clean($("filterWeek").value) && clean($("filterMonth").value) ? `Tháng: ${clean($("filterMonth").value)}` : ""
  ].filter(Boolean);
  return parts.length ? parts.join(" | ") : "Tất cả khách hàng";
}

function exportCsv() {
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
  exportXlsx([{ name: "Khach hang", rows: dataRows }], `crm-khach-hang-theo-bo-loc-${new Date().toISOString().slice(0,10)}`);
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

function showLogin() {
  stopPresence();
  stopWatchers();
  setViewHidden("loginView", false);
  setViewHidden("appView", true);
  $("onlinePanel").classList.add("hide");
  if (location.protocol === "file:") $("localWarning").classList.remove("hide");
}

function showApp() {
  setViewHidden("loginView", true);
  setViewHidden("appView", false);
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
  ["searchBox","filterOwner","filterStatus","filterDealStatus","filterFollow","filterSource","filterChannel","filterCustomerType"].forEach(id => {
    if (!(id === "filterOwner" && !isManager())) $(id).value = "";
  });
  hydrateFilterChannelOptions();
  $("filterWeek").value = "";
  $("filterMonth").value = "";
  $("kpiRuleMonth").value = currentMonth();
  renderAll();
}

document.addEventListener("click", e => {
  const careId = e.target.closest("[data-open-care]")?.dataset.openCare || e.target.closest("[data-care-open]")?.dataset.careOpen;
  const dealId = e.target.closest("[data-open-deal]")?.dataset.openDeal;
  const docId = e.target.closest("[data-open-template]")?.dataset.openTemplate;
  const completeDealId = e.target.closest("[data-complete-deal]")?.dataset.completeDeal;
  const cancelDealId = e.target.closest("[data-cancel-deal]")?.dataset.cancelDeal;
  const reviewDealId = e.target.closest("[data-review-deal]")?.dataset.reviewDeal;
  const pipelineLabel = e.target.closest("[data-pipeline-detail]")?.dataset.pipelineDetail;
  const editKpiRuleId = e.target.closest("[data-edit-kpi-rule]")?.dataset.editKpiRule;
  const disableKpiRuleId = e.target.closest("[data-disable-kpi-rule]")?.dataset.disableKpiRule;
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
  const copyPhone = e.target.closest("[data-copy-phone]")?.dataset.copyPhone;
  const dashboardAction = e.target.closest("[data-dashboard-action]")?.dataset.dashboardAction;
  if (dashboardAction === "due-care" || dashboardAction === "overdue-care") openCareDashboardDetail(dashboardAction);
  if (dashboardAction === "managed-customers" || dashboardAction === "month-customers") openDashboardCustomerDetail(dashboardAction);
  if (["pending-deals","completed-deals","month-revenue","deposit-deals","canceled-deals"].includes(dashboardAction)) openDashboardDealDetail(dashboardAction);
  if (dashboardAction === "pending-kpi") jumpToPendingKpi();
  if (careId) {
    closeDetailModal();
    openDrawer(careId, "care");
  }
  if (dealId) openDrawer(dealId, "deal");
  if (docId) {
    const url = clean(settings.quoteTemplateUrl) || DEFAULT_SETTINGS.quoteTemplateUrl;
    window.open(url, "_blank", "noopener");
  }
  if (copyPhone) { navigator.clipboard?.writeText(copyPhone); notice("Đã copy SĐT."); }
  if (completeDealId) completeDeal(completeDealId);
  if (cancelDealId) cancelDeal(cancelDealId);
  if (reviewDealId) reviewDeal(reviewDealId);
  if (pipelineLabel) openPipelineDetail(pipelineLabel);
  if (editKpiRuleId) editKpiRule(editKpiRuleId);
  if (disableKpiRuleId) disableKpiRule(disableKpiRuleId);
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
  if (saveProductId) runAction(`saveProduct:${saveProductId}`, "saveProduct", "Đang lưu...", () => saveProduct(saveProductId));
  if (deleteProductId) runAction(`deleteProduct:${deleteProductId}`, "deleteProduct", "Đang xóa...", () => deleteProduct(deleteProductId));
  if (editCareLogId) editCareLog(editCareLogId);
  if (deleteCareLogId) deleteCareLog(deleteCareLogId);
  if (restoreCustomerId) restoreCustomer(restoreCustomerId);
  if (permanentDeleteCustomerId) permanentlyDeleteCustomer(permanentDeleteCustomerId);
  if (saveUserId) runAction(`saveUser:${saveUserId}`, "saveUser", "Đang lưu...", () => saveUserAdmin(saveUserId));
  if (e.target.closest("[data-remove-deal-item]")) {
    e.target.closest("[data-deal-item]")?.remove();
    if (!document.querySelector("[data-deal-item]")) addDealItem();
  }
});

document.addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const dashboardAction = e.target.closest?.("[data-dashboard-action]")?.dataset.dashboardAction;
  if (!dashboardAction) return;
  e.preventDefault();
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

["searchBox","filterOwner","filterStatus","filterDealStatus","filterFollow","filterSource","filterChannel","filterCustomerType","filterWeek","filterMonth"].forEach(id => on(id, "input", scheduleRenderAll));
on("filterMonth", "change", scheduleRenderAll);
on("kpiRuleMonth", "change", () => { hydrateProposalKpiOptions(); scheduleRenderAll(); });
on("crmViewBtn", "click", () => setMainView("crm"));
on("customersViewBtn", "click", () => setMainView("customers"));
on("ordersViewBtn", "click", () => setMainView("orders"));
on("productsViewBtn", "click", () => setMainView("products"));
on("kpiViewBtn", "click", () => setMainView("kpi"));
on("reportsViewBtn", "click", () => setMainView("reports"));
on("adminViewBtn", "click", () => setMainView("admin"));
["orderFilterYear","orderFilterMonth","orderFilterOwner","orderFilterStatus"].forEach(id => on(id, "change", renderOrders));
["productSearchBox","productFilterSize","productFilterSurface","productFilterOrigin"].forEach(id => on(id, "input", renderProducts));
on("resetProductFilterBtn", "click", () => {
  ["productSearchBox","productFilterSize","productFilterSurface","productFilterOrigin"].forEach(id => $(id).value = "");
  renderProducts();
});
on("kpiRuleTarget", "input", () => {
  document.querySelectorAll("[data-kpi-target-email]").forEach(input => {
    if (!clean(input.value)) input.value = $("kpiRuleTarget").value;
  });
});
on("careStatus", "change", updateCareStatusVisual);
on("source", "change", () => { hydrateChannelOptions(); togglePartnerFields(); });
on("channel", "change", togglePartnerFields);
on("customerType", "change", togglePartnerFields);
on("filterSource", "change", () => { hydrateFilterChannelOptions(); scheduleRenderAll(); });
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
on("channelReportRange", "change", scheduleRenderChart);
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
