const LABELS = {
  customers: "\u004b\u0068\u00e1\u0063\u0068\u0020\u0068\u00e0\u006e\u0067",
  reports: "\u0042\u00e1\u006f\u0020\u0063\u00e1\u006f",
  admin: "\u0051\u0075\u1ea3\u006e\u0020\u0074\u0072\u1ecb",
  products: "Sản phẩm",
};

export function renderViewTabs() {
  const slot = document.getElementById("viewTabsSlot");
  if (!slot) return;
  slot.innerHTML = `
    <div class="view-tabs">
      <button id="crmViewBtn" class="primary" type="button">CRM</button>
      <button id="customersViewBtn" type="button">${LABELS.customers}</button>
      <button id="kpiViewBtn" type="button">KPI</button>
      <button id="productsViewBtn" type="button">${LABELS.products}</button>
      <button id="reportsViewBtn" class="hide" type="button">${LABELS.reports}</button>
      <button id="adminViewBtn" class="hide" type="button">${LABELS.admin}</button>
    </div>
  `;
}

export function renderAppShell() {
  renderViewTabs();
}
