export const CRM_NAV_ITEMS = Object.freeze([
  { id: "overview", label: "Tổng quan", hash: "#/overview", mainView: "crm", capability: "crm" },
  { id: "customers", label: "Khách hàng", hash: "#/customers", mainView: "customers", capability: "crm" },
  { id: "kpi", label: "KPI", hash: "#/kpi", mainView: "kpi", capability: "crm" },
  { id: "products", label: "Sản phẩm", hash: "#/products", mainView: "products", capability: "crm" },
  { id: "reports", label: "Báo cáo", hash: "#/reports", mainView: "reports", capability: "manager" },
  { id: "admin", label: "Quản trị", path: "/admin", capability: "admin" }
]);

export const CUSTOMER_WORKSPACES = Object.freeze([
  { id: "hub", label: "Khách hàng", hash: "#/customers", mainView: "customers", customerWorkspace: "hub", capability: "crm", panelId: "customerHubPanel" },
  { id: "new", label: "Thêm khách hàng mới", hash: "#/customers/new", mainView: "customers", customerWorkspace: "new", capability: "crm", panelId: "customerNewPanel" },
  { id: "list", label: "Tìm & danh sách khách hàng", hash: "#/customers/list", mainView: "customers", customerWorkspace: "list", capability: "crm", panelId: "customerSearchPanel" },
  { id: "care", label: "Chăm sóc & lịch hẹn", hash: "#/customers/care", mainView: "customers", customerWorkspace: "care", capability: "crm", panelId: "needCarePanel" },
  { id: "allocation", label: "Phân bổ khách hàng", hash: "#/customers/allocation", mainView: "customers", customerWorkspace: "allocation", capability: "manager", panelId: "customerAllocationPanel" }
]);

export const KPI_WORKSPACES = Object.freeze([
  { id: "hub", label: "KPI", hash: "#/kpi", mainView: "kpi", kpiWorkspace: "hub", capability: "crm", panelId: "kpiHubPanel" },
  { id: "mine", label: "KPI của tôi", hash: "#/kpi/mine", mainView: "kpi", kpiWorkspace: "mine", capability: "sale", panelId: "kpi2OperationsPanel" },
  { id: "team", label: "KPI Team", hash: "#/kpi/team", mainView: "kpi", kpiWorkspace: "team", capability: "manager", panelId: "kpiTeamPanel", mode: "employees" },
  { id: "library", label: "Bộ KPI & Kỳ KPI", hash: "#/kpi/library", mainView: "kpi", kpiWorkspace: "library", capability: "manager", panelId: "kpiFoundationPanel", mode: "library" },
  { id: "history", label: "Lịch sử KPI", hash: "#/kpi/history", mainView: "kpi", kpiWorkspace: "history", capability: "manager", panelId: "kpiTeamPanel", mode: "history" }
]);

export const REPORT_WORKSPACES = Object.freeze([
  { id: "hub", label: "Báo cáo", hash: "#/reports", mainView: "reports", reportWorkspace: "hub", capability: "manager", panelId: "reportsHubPanel" },
  { id: "summary", label: "Tổng hợp quản trị", hash: "#/reports/summary", mainView: "reports", reportWorkspace: "summary", capability: "manager", panelId: "reportSummaryPanel" },
  { id: "sales", label: "Hoạt động Sale", hash: "#/reports/sales", mainView: "reports", reportWorkspace: "sales", capability: "manager", panelId: "reportSalesPanel" },
  { id: "customers", label: "Khách hàng & kênh", hash: "#/reports/customers", mainView: "reports", reportWorkspace: "customers", capability: "manager", panelId: "reportCustomersPanel" }
]);

export const CRM_HASH_ROUTES = Object.freeze(Object.fromEntries([
  ...CRM_NAV_ITEMS.filter(item => item.hash).map(item => [item.hash, item]),
  ...CUSTOMER_WORKSPACES.map(item => [item.hash, {...item, id: "customers", navId: "customers"}]),
  ...KPI_WORKSPACES.map(item => [item.hash, {...item, id: "kpi", navId: "kpi"}]),
  ...REPORT_WORKSPACES.map(item => [item.hash, {...item, id: "reports", navId: "reports"}])
]));

export function normalizeWorkspaceHash(hash = "") {
  const raw = String(hash || "").trim().toLowerCase();
  if (!raw || raw === "#/" || raw === "#") return "#/overview";
  const normalized = raw.startsWith("#") ? raw : `#${raw.startsWith("/") ? "" : "/"}${raw}`;
  return normalized.replace(/\/+$/, "") || "#/overview";
}

export function workspaceForHash(hash = "") {
  const normalized = normalizeWorkspaceHash(hash);
  return CRM_HASH_ROUTES[normalized]
    || (normalized.startsWith("#/customers") ? CRM_HASH_ROUTES["#/customers"]
      : normalized.startsWith("#/kpi") ? CRM_HASH_ROUTES["#/kpi"]
      : normalized.startsWith("#/reports") ? CRM_HASH_ROUTES["#/reports"]
      : CRM_HASH_ROUTES["#/overview"]);
}

function navMarkup(className) {
  return CRM_NAV_ITEMS.map(item => `
    <button class="${className}" type="button" data-workspace-nav="${item.id}"
      data-nav-capability="${item.capability}"${item.hash ? ` data-nav-hash="${item.hash}"` : ` data-nav-path="${item.path}"`}>
      <span>${item.label}</span>
    </button>`).join("");
}

export function renderNavigation() {
  const desktop = document.getElementById("desktopNavItems");
  const mobile = document.getElementById("mobileNavItems");
  if (desktop) desktop.innerHTML = navMarkup("crm-nav-item");
  if (mobile) mobile.innerHTML = navMarkup("crm-nav-item crm-mobile-nav-item");
}

export function renderAppShell() {
  renderNavigation();
}
