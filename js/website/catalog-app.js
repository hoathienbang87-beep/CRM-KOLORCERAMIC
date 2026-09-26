import {formatProductSize, formatVndPerM2, safeExternalImageUrl} from "./catalog-api.js";

export function createCatalogWebsiteApp({api, root = document, observerFactory = callback => new IntersectionObserver(callback, {rootMargin:"300px 0px"})}) {
  const byId = id => root.getElementById(id);
  const elements = {
    form:byId("catalogFilters"), search:byId("catalogSearch"), category:byId("categoryFilter"),
    collection:byId("collectionFilter"), surface:byId("surfaceFilter"), size:byId("sizeFilter"),
    price:byId("priceFilter"), clear:byId("clearFilters"), emptyClear:byId("emptyClearFilters"),
    grid:byId("productGrid"), count:byId("catalogCount"), status:byId("catalogStatus"),
    empty:byId("emptyState"), error:byId("errorState"), errorText:byId("catalogError"),
    retry:byId("retryCatalog"), more:byId("loadMore"), sentinel:byId("catalogSentinel"),
    filterToggle:byId("mobileFilterToggle"), filterFields:byId("filterFields"), activeFilters:byId("activeFilterCount")
  };
  const state = {items:[], total:0, nextOffset:0, hasMore:false, loading:false, request:0, limit:12};
  let observer;
  let searchTimer;

  function readFilters() {
    const [widthMm, heightMm] = (elements.size.value || "x").split("x").map(Number);
    const [minRaw, maxRaw] = (elements.price.value || ":").split(":");
    return {
      search:elements.search.value.trim(), category:elements.category.value.trim(),
      collection:elements.collection.value.trim(), surface:elements.surface.value.trim(),
      widthMm:widthMm || null, heightMm:heightMm || null,
      minPrice:minRaw === "" ? null : Number(minRaw), maxPrice:maxRaw === "" ? null : Number(maxRaw),
      limit:state.limit, offset:state.nextOffset
    };
  }

  function activeFilterCount() {
    return [elements.category.value,elements.collection.value,elements.surface.value,elements.size.value,elements.price.value].filter(Boolean).length;
  }

  function setStatus(message = "") { elements.status.textContent = message; }

  function makeText(tag, className, value) {
    const node = root.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  }

  function createProductCard(product) {
    const article = root.createElement("article");
    article.className = "product-card";
    article.dataset.productId = product?.id || "";
    const media = makeText("div", "product-media", "");
    const fallback = makeText("div", "image-fallback", "");
    fallback.append(makeText("span", "", "Ảnh đang cập nhật"));
    media.append(fallback);
    const imageUrl = safeExternalImageUrl(product?.image_url);
    if (imageUrl) {
      const image = root.createElement("img");
      image.src = imageUrl;
      image.alt = product?.name ? `Gạch ${product.name}` : "Ảnh sản phẩm Kolorceramic";
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("load", () => fallback.classList.add("hide"), {once:true});
      image.addEventListener("error", () => { image.remove(); fallback.classList.remove("hide"); }, {once:true});
      media.append(image);
    }
    const info = makeText("div", "product-info", "");
    const meta = makeText("div", "product-meta", "");
    meta.append(makeText("span", "", product?.collection || product?.category || "KOLORCERAMIC"));
    meta.append(makeText("span", "", product?.code || ""));
    info.append(meta, makeText("h3", "", product?.name || "Sản phẩm đang cập nhật"));
    const attributes = makeText("p", "product-attributes", "");
    attributes.append(makeText("span", formatProductSize(product) === "Đang cập nhật" ? "updating" : "", formatProductSize(product)));
    if (product?.surface) attributes.append(makeText("span", "", product.surface));
    if (product?.color) attributes.append(makeText("span", "", product.color));
    const price = makeText("div", "product-price", "");
    const priceText = formatVndPerM2(product?.price_per_m2);
    price.append(makeText("strong", priceText === "Đang cập nhật" ? "updating" : "", priceText));
    price.append(makeText("small", "", product?.origin || ""));
    info.append(attributes, price);
    article.append(media, info);
    return article;
  }

  function renderSkeletons() {
    if (state.items.length) return;
    const fragment = root.createDocumentFragment();
    for (let index=0; index<8; index++) {
      const card = makeText("div", "product-card skeleton", "");
      card.setAttribute("aria-hidden", "true");
      card.append(makeText("div", "product-media", ""), makeText("div", "skeleton-line short", ""), makeText("div", "skeleton-line", ""));
      fragment.append(card);
    }
    elements.grid.replaceChildren(fragment);
  }

  function renderResults({append = false} = {}) {
    if (!append) elements.grid.replaceChildren();
    const rendered = new Set([...elements.grid.querySelectorAll("[data-product-id]")].map(node => node.dataset.productId));
    const fragment = root.createDocumentFragment();
    for (const product of state.items) if (!rendered.has(product.id)) fragment.append(createProductCard(product));
    elements.grid.append(fragment);
    elements.grid.setAttribute("aria-busy", "false");
    elements.count.textContent = state.total ? `${new Intl.NumberFormat("vi-VN").format(state.total)} sản phẩm` : "0 sản phẩm";
    elements.empty.classList.toggle("hide", state.total !== 0);
    elements.more.classList.toggle("hide", !state.hasMore);
    elements.more.disabled = state.loading;
  }

  async function load({reset = false} = {}) {
    if (state.loading && !reset) return;
    const request = ++state.request;
    if (reset) {
      state.items=[]; state.total=0; state.nextOffset=0; state.hasMore=false;
      elements.empty.classList.add("hide"); elements.error.classList.add("hide"); elements.more.classList.add("hide");
      renderSkeletons();
    }
    state.loading=true; elements.grid.setAttribute("aria-busy", "true");
    setStatus(reset ? "Đang tìm sản phẩm phù hợp…" : "Đang tải thêm sản phẩm…");
    try {
      const result = await api.list(readFilters());
      if (request !== state.request) return;
      state.items = reset ? result.items : [...state.items, ...result.items];
      state.total=result.pagination.total; state.hasMore=result.pagination.has_more;
      state.nextOffset=result.pagination.next_offset ?? state.items.length;
      elements.error.classList.add("hide");
      renderResults({append:!reset});
      setStatus("");
    } catch (error) {
      if (request !== state.request) return;
      if (!state.items.length) elements.grid.replaceChildren();
      elements.grid.setAttribute("aria-busy", "false");
      elements.errorText.textContent = "Không thể kết nối tới catalog. Vui lòng thử lại sau.";
      elements.error.classList.remove("hide"); elements.empty.classList.add("hide"); elements.more.classList.add("hide");
      elements.count.textContent = "Catalog tạm thời gián đoạn";
      setStatus("");
      console.error("Catalog public API error", error);
    } finally {
      if (request === state.request) state.loading=false;
    }
  }

  function clearFilters() {
    elements.form.reset(); elements.activeFilters.textContent="0";
    load({reset:true});
  }

  function bind() {
    elements.form.addEventListener("submit", event => {event.preventDefault();elements.activeFilters.textContent=String(activeFilterCount());load({reset:true});});
    elements.search.addEventListener("input", () => {clearTimeout(searchTimer);searchTimer=setTimeout(()=>load({reset:true}),350);});
    for (const field of [elements.category,elements.collection,elements.surface,elements.size,elements.price]) field.addEventListener("change",()=>{elements.activeFilters.textContent=String(activeFilterCount());load({reset:true});});
    elements.clear.addEventListener("click",clearFilters); elements.emptyClear.addEventListener("click",clearFilters);
    elements.retry.addEventListener("click",()=>load({reset:true})); elements.more.addEventListener("click",()=>load());
    elements.filterToggle.addEventListener("click",()=>{const open=elements.filterFields.classList.toggle("open");elements.filterToggle.setAttribute("aria-expanded",String(open));});
    if (typeof observerFactory === "function") {
      observer=observerFactory(entries=>{if(entries.some(entry=>entry.isIntersecting)&&state.hasMore&&!state.loading)load();});
      observer?.observe?.(elements.sentinel);
    }
  }

  return {start(){bind();return load({reset:true});},load,clearFilters,state,destroy(){observer?.disconnect?.();clearTimeout(searchTimer);}};
}
