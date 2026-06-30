export function renderViewTabs() {
  const slot = document.getElementById("viewTabsSlot");
  if (!slot) return;
  slot.innerHTML = `
    <div class="view-tabs">
      <button id="crmViewBtn" class="primary" type="button">CRM</button>
      <button id="customersViewBtn" type="button">Khách hàng</button>
      <button id="ordersViewBtn" type="button">Đơn hàng</button>
      <button id="productsViewBtn" type="button">Sản phẩm</button>
      <button id="quotesViewBtn" type="button">Báo giá</button>
      <button id="kpiViewBtn" type="button">KPI</button>
      <button id="reportsViewBtn" class="hide" type="button">Báo cáo</button>
      <button id="adminViewBtn" class="hide" type="button">Quản trị</button>
    </div>
  `;
}

export function renderAppShell() {
  renderViewTabs();
}
