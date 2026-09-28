const clean = value => value == null ? "" : String(value).trim();

function decimal(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cmFromMm(value) {
  const number = decimal(value);
  if (number === null) return null;
  return String(Math.round((number / 10) * 1000) / 1000);
}

export function normalizeCrmCatalogProduct(row = {}) {
  return {
    id: clean(row.id),
    code: clean(row.code),
    name: clean(row.name),
    widthMm: decimal(row.width_mm ?? row.widthMm),
    heightMm: decimal(row.height_mm ?? row.heightMm),
    widthCm: clean(row.width_cm ?? row.widthCm) || cmFromMm(row.width_mm ?? row.widthMm),
    heightCm: clean(row.height_cm ?? row.heightCm) || cmFromMm(row.height_mm ?? row.heightMm),
    surface: clean(row.surface),
    pricePerM2: decimal(row.price_per_m2 ?? row.pricePerM2),
    priceUnit: clean(row.price_unit ?? row.priceUnit) || "VND_M2",
    dataStatus: clean(row.data_status ?? row.dataStatus),
    isPublished: row.is_published ?? row.isPublished ?? false,
    active: row.active !== false,
    version: Number(row.version || 1)
  };
}

export function crmProductSize(product = {}) {
  const width = clean(product.widthCm) || cmFromMm(product.widthMm);
  const height = clean(product.heightCm) || cmFromMm(product.heightMm);
  return width && height ? `${width} × ${height} cm` : "Đang cập nhật";
}

export function crmProductLabel(product = {}) {
  return [clean(product.code), clean(product.name), crmProductSize(product)].filter(Boolean).join(" - ");
}

export function crmProductPrice(value) {
  const number = decimal(value);
  if (number === null) return "Đang cập nhật";
  return `${new Intl.NumberFormat("vi-VN", {maximumFractionDigits: 0}).format(number)} ₫/m²`;
}

export function crmProductWebsiteUrl(product = {}, origin = globalThis.location?.origin || "http://localhost") {
  product = product || {};
  const identifier = clean(product.code) || clean(product.id);
  if (!identifier) return "";
  if (!/^https?:\/\//i.test(clean(origin))) return `/?id=${encodeURIComponent(identifier)}`;
  const url = new URL("/", origin);
  url.searchParams.set("id", identifier);
  return url.toString();
}

export function quoteSnapshotFromProduct(product = {}) {
  const widthMm = decimal(product.widthMm ?? product.width_mm) ?? (decimal(product.widthCm ?? product.width_cm) === null ? null : decimal(product.widthCm ?? product.width_cm) * 10);
  const heightMm = decimal(product.heightMm ?? product.height_mm) ?? (decimal(product.heightCm ?? product.height_cm) === null ? null : decimal(product.heightCm ?? product.height_cm) * 10);
  return {
    productId: clean(product.id),
    productSku: clean(product.code),
    productName: clean(product.name),
    widthMmSnapshot: widthMm,
    heightMmSnapshot: heightMm,
    surfaceSnapshot: clean(product.surface) || null,
    listPriceSnapshot: decimal(product.pricePerM2 ?? product.price_per_m2),
    catalogVersionSnapshot: Number(product.version || 1)
  };
}

export function quoteSnapshotFromItem(item = {}, fallbackProduct = null) {
  const isPersisted = Boolean(
    clean(item.id) || clean(item.productId) || clean(item.product_id) ||
    item.unitPrice !== undefined || item.unit_price !== undefined ||
    item.listPriceSnapshot !== undefined || item.list_price_snapshot !== undefined
  );
  if (!isPersisted && fallbackProduct) return quoteSnapshotFromProduct(fallbackProduct);
  return {
    productId: clean(item.productId ?? item.product_id),
    productSku: clean(item.productSku ?? item.product_sku ?? item.code),
    productName: clean(item.productName ?? item.product_name ?? item.product ?? item.productLabel),
    widthMmSnapshot: decimal(item.widthMmSnapshot ?? item.width_mm_snapshot),
    heightMmSnapshot: decimal(item.heightMmSnapshot ?? item.height_mm_snapshot),
    surfaceSnapshot: clean(item.surfaceSnapshot ?? item.surface_snapshot) || null,
    listPriceSnapshot: decimal(
      item.listPriceSnapshot ?? item.list_price_snapshot ?? item.unitPrice ?? item.unit_price
    ),
    catalogVersionSnapshot: decimal(item.catalogVersionSnapshot ?? item.catalog_version_snapshot)
  };
}

export function encodeProductSnapshot(snapshot = {}) {
  return encodeURIComponent(JSON.stringify(snapshot));
}

export function decodeProductSnapshot(value) {
  try {
    const parsed = JSON.parse(decodeURIComponent(clean(value)));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function escapeHtml(value) {
  return clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function createCrmProductSelector({rpc, documentRef = globalThis.document, windowRef = globalThis.window} = {}) {
  if (typeof rpc !== "function") throw new Error("CRM_PRODUCT_SELECTOR_RPC_REQUIRED");
  if (!documentRef?.body) throw new Error("CRM_PRODUCT_SELECTOR_DOCUMENT_REQUIRED");

  const root = documentRef.createElement("div");
  root.innerHTML = `
    <div class="crm-product-selector-backdrop hide" data-product-selector-backdrop></div>
    <aside class="crm-product-selector hide" data-product-selector role="dialog" aria-modal="true" aria-labelledby="crmProductSelectorTitle">
      <header class="crm-product-selector-head">
        <div><h2 id="crmProductSelectorTitle">Chọn sản phẩm</h2><p>Catalog nội bộ · giá hiện tại</p></div>
        <button type="button" class="small" data-product-selector-close aria-label="Đóng">Đóng</button>
      </header>
      <div class="crm-product-selector-search">
        <label for="crmProductSelectorSearch">Tìm theo mã, tên hoặc bề mặt</label>
        <input id="crmProductSelectorSearch" data-product-selector-search autocomplete="off" placeholder="Ví dụ: TRAVERTINO, SP-001, MATT">
      </div>
      <div class="muted" data-product-selector-status aria-live="polite"></div>
      <div class="crm-product-selector-results" data-product-selector-results></div>
    </aside>`;
  documentRef.body.append(...root.children);

  const backdrop = documentRef.querySelector("[data-product-selector-backdrop]");
  const dialog = documentRef.querySelector("[data-product-selector]");
  const title = dialog.querySelector("#crmProductSelectorTitle");
  const search = dialog.querySelector("[data-product-selector-search]");
  const status = dialog.querySelector("[data-product-selector-status]");
  const results = dialog.querySelector("[data-product-selector-results]");
  let currentSelect = null;
  let generation = 0;
  let timer = 0;
  let previousFocus = null;

  function setOpen(open) {
    backdrop.classList.toggle("hide", !open);
    dialog.classList.toggle("hide", !open);
  }

  function close() {
    generation += 1;
    clearTimeout(timer);
    setOpen(false);
    currentSelect = null;
    previousFocus?.focus?.();
  }

  function render(products) {
    if (!products.length) {
      results.innerHTML = `<div class="crm-product-selector-empty">Không tìm thấy sản phẩm phù hợp.</div>`;
      return;
    }
    results.innerHTML = products.map((product, index) => {
      const webUrl = crmProductWebsiteUrl(product, windowRef?.location?.origin);
      const meta = [crmProductSize(product), product.surface || "Chưa có bề mặt"].filter(Boolean).join(" · ");
      const state = product.dataStatus && product.dataStatus !== "READY" ? product.dataStatus : "";
      return `<article class="crm-product-selector-card" data-product-selector-index="${index}">
        <div><b>${escapeHtml(product.name || product.code || "Sản phẩm")}</b><div class="muted">${escapeHtml([product.code, meta].filter(Boolean).join(" · "))}</div></div>
        <div class="crm-product-selector-price"><b>${escapeHtml(crmProductPrice(product.pricePerM2))}</b>${state ? `<span class="pill warn">${escapeHtml(state)}</span>` : ""}</div>
        <div class="crm-product-selector-actions">
          <a class="small button-link" href="${escapeHtml(webUrl)}" target="_blank" rel="noopener noreferrer">Xem website</a>
          <button class="small primary" type="button" data-product-selector-pick="${index}">Chọn</button>
        </div>
      </article>`;
    }).join("");
    results.querySelectorAll("[data-product-selector-pick]").forEach(button => {
      button.addEventListener("click", () => {
        const product = products[Number(button.dataset.productSelectorPick)];
        const callback = currentSelect;
        close();
        callback?.(product);
      });
    });
  }

  async function load(query = "") {
    const request = ++generation;
    status.textContent = "Đang tải catalog…";
    results.innerHTML = "";
    try {
      const rows = await rpc("catalog_crm_search_products", {p_search: clean(query) || null, p_limit: 50});
      if (request !== generation) return;
      const products = (Array.isArray(rows) ? rows : []).map(normalizeCrmCatalogProduct).filter(product => product.id && product.active);
      status.textContent = `${products.length} sản phẩm · dữ liệu theo quyền tài khoản CRM`;
      render(products);
    } catch (error) {
      if (request !== generation) return;
      status.textContent = error?.code === "42501"
        ? "Tài khoản không có quyền đọc catalog nội bộ."
        : "Không tải được catalog. Hãy thử lại.";
      results.innerHTML = `<div class="crm-product-selector-empty">Catalog chưa sẵn sàng.</div>`;
    }
  }

  function open({heading = "Chọn sản phẩm", initialSearch = "", onSelect} = {}) {
    previousFocus = documentRef.activeElement;
    currentSelect = typeof onSelect === "function" ? onSelect : null;
    title.textContent = heading;
    search.value = clean(initialSearch);
    setOpen(true);
    load(search.value);
    windowRef?.requestAnimationFrame?.(() => search.focus());
  }

  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(search.value), 220);
  });
  dialog.querySelector("[data-product-selector-close]").addEventListener("click", close);
  backdrop.addEventListener("click", close);
  dialog.addEventListener("keydown", event => {
    if (event.key === "Escape") close();
  });

  return {open, close, load, element: dialog};
}
