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

export const CRM_HASH_ROUTES = Object.freeze(Object.fromEntries([
  ...CRM_NAV_ITEMS.filter(item => item.hash).map(item => [item.hash, item]),
  ...CUSTOMER_WORKSPACES.map(item => [item.hash, {...item, id: "customers", navId: "customers"}])
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
    || (normalized.startsWith("#/customers") ? CRM_HASH_ROUTES["#/customers"] : CRM_HASH_ROUTES["#/overview"]);
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

// Scaffolding tương thích cho các handler hiện hữu; không còn là navigation.
export function renderLegacyViewTabs() {
  const slot = document.getElementById("viewTabsSlot");
  if (!slot) return;
  slot.innerHTML = `
    <button id="crmViewBtn" type="button" tabindex="-1" aria-hidden="true">Tổng quan</button>
    <button id="customersViewBtn" type="button" tabindex="-1" aria-hidden="true">Khách hàng</button>
    <button id="kpiViewBtn" type="button" tabindex="-1" aria-hidden="true">KPI</button>
    <button id="productsViewBtn" type="button" tabindex="-1" aria-hidden="true">Sản phẩm</button>
    <button id="reportsViewBtn" type="button" tabindex="-1" aria-hidden="true">Báo cáo</button>
    <button id="adminViewBtn" type="button" tabindex="-1" aria-hidden="true">Quản trị</button>
  `;
}

export function renderAppShell() {
  renderNavigation();
  renderLegacyViewTabs();
}
