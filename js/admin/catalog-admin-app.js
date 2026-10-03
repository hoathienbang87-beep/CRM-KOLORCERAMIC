import {
  cleanText, formatVnd, parseVnd, formatSize, parsePositiveInteger,
  parseHttpsUrl, parseGallery, isAdminProfile
} from "./catalog-admin-api.js";
import {createCatalogAdminImport} from "./catalog-admin-import.js";

const PAGE_SIZE = 40;
const ACCESS_CHECK_TIMEOUT_MS = 8000;
const OPTIONAL_TEXT_FIELDS = ["code","surface","color","category","collection","origin","description"];
const URL_FIELDS = [["image_url","Ảnh đại diện"],["pdf_url","PDF URL"],["video_url","Video URL"],["more_info_url","Trang thông tin thêm"]];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]);
}

function booleanFilter(value) {
  return value === "true" ? true : value === "false" ? false : null;
}

function statusBadges(product) {
  return [
    `<span class="badge ${product.data_status === "READY" ? "green" : "amber"}">${product.data_status === "READY" ? "Sẵn sàng" : "Đang cập nhật"}</span>`,
    `<span class="badge ${product.active ? "green" : "red"}">${product.active ? "Đang dùng" : "Lưu trữ"}</span>`,
    `<span class="badge ${product.is_published ? "green" : ""}">${product.is_published ? "Đã đăng" : "Chưa đăng"}</span>`
  ].join("");
}

function updatedLabel(product) {
  const date = product.updated_at ? new Date(product.updated_at) : null;
  const time = date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("vi-VN", {dateStyle:"short",timeStyle:"short"}).format(date) : "—";
  return [time, cleanText(product.updated_by_name)].filter(Boolean).join(" · ");
}

function imageMarkup(product, className) {
  const url = cleanText(product.image_url);
  return url
    ? `<span class="${className}" data-image-frame><img src="${escapeHtml(url)}" alt="" loading="lazy"><span class="hide">Không có ảnh</span></span>`
    : `<span class="${className}">◇</span>`;
}

export function createCatalogAdminApp({api, root = document, accessCheckTimeoutMs = ACCESS_CHECK_TIMEOUT_MS}) {
  const $ = id => root.getElementById(id);
  const state = {profile:null,products:[],pagination:{total:0,offset:0,has_more:false},selected:null,loading:false,toastTimer:null,returnFocus:null,authUserId:"",authGeneration:0};

  function showOnly(viewId) {
    for (const id of ["adminLoadingView","adminLoginView","adminDeniedView","adminWorkspace"]) {
      const element = $(id);
      const visible = id === viewId;
      element?.classList.toggle("hide", !visible);
      if (id === "adminWorkspace") {
        element?.toggleAttribute("inert", !visible);
        element?.setAttribute("aria-hidden", String(!visible));
      }
    }
  }

  function errorMessage(error) {
    const code = cleanText(error?.code).toUpperCase();
    const message = cleanText(error?.message);
    if (message === "ACCESS_CHECK_TIMEOUT") return "Không thể xác minh quyền truy cập trong thời gian cho phép.";
    if (code === "42501" || /ADMIN_REQUIRED|permission|row-level/i.test(message)) return "Tài khoản không có quyền quản trị catalog.";
    if (code === "40001" || /VERSION_CONFLICT/i.test(message)) return "Sản phẩm vừa được cập nhật ở nơi khác. Hãy tải lại.";
    if (code === "P0002" || /NOT_FOUND/i.test(message)) return "Không tìm thấy sản phẩm.";
    if (code === "23505") return "Mã sản phẩm đã được sử dụng.";
    if (code === "22023" || code === "23514") return "Dữ liệu chưa hợp lệ hoặc chưa đủ điều kiện đăng website.";
    return message || "Không thể hoàn tất thao tác.";
  }

  function toast(message, isError = false) {
    const element = $("adminToast");
    if (!element) return;
    clearTimeout(state.toastTimer);
    element.textContent = message;
    element.classList.remove("hide");
    element.classList.toggle("error", isError);
    state.toastTimer = setTimeout(() => element.classList.add("hide"), 3600);
  }

  const importController = createCatalogAdminImport({api,root,notify:toast});

  function setBusy(busy) {
    state.loading = busy;
    for (const id of ["adminReload","adminSaveProduct","adminSaveState","adminPrevPage","adminNextPage"]) {
      if ($(id)) $(id).disabled = busy;
    }
  }

  function currentFilters(resetOffset = false) {
    if (resetOffset) state.pagination.offset = 0;
    return {
      search: cleanText($("adminSearch")?.value),
      dataStatus: cleanText($("adminStatusFilter")?.value),
      active: booleanFilter($("adminActiveFilter")?.value),
      published: booleanFilter($("adminPublishedFilter")?.value),
      limit: PAGE_SIZE,
      offset: state.pagination.offset
    };
  }

  function attachImageFallbacks(scope = root) {
    scope.querySelectorAll?.("[data-image-frame] img").forEach(image => {
      const fail = () => {
        image.classList.add("hide");
        image.nextElementSibling?.classList.remove("hide");
      };
      image.addEventListener("error", fail, {once:true});
      if (image.complete && image.naturalWidth === 0) fail();
    });
  }

  function renderProducts() {
    const rows = $("adminProductRows");
    const cards = $("adminProductCards");
    const products = state.products;
    if (rows) rows.innerHTML = products.map(product => `
      <tr>
        <td><div class="product-cell">${imageMarkup(product,"thumb")}<span><b>${escapeHtml(product.name || "Chưa có tên")}</b><small>${escapeHtml(product.code || "Chưa có mã")}</small></span></div></td>
        <td>${escapeHtml(formatSize(product))}</td>
        <td>${escapeHtml(product.surface || "—")}</td>
        <td class="money">${escapeHtml(formatVnd(product.price_per_m2))}</td>
        <td><div class="badges">${statusBadges(product)}</div></td>
        <td><small>${escapeHtml(updatedLabel(product))}</small></td>
        <td><button class="row-action" type="button" data-edit-product="${escapeHtml(product.id)}">Chỉnh sửa</button></td>
      </tr>`).join("");
    if (cards) cards.innerHTML = products.map(product => `
      <article class="product-card">
        ${imageMarkup(product,"card-thumb")}
        <div><h3>${escapeHtml(product.name || "Chưa có tên")}</h3><p>${escapeHtml([product.code,formatSize(product),product.surface].filter(Boolean).join(" · "))}</p><span class="money">${escapeHtml(formatVnd(product.price_per_m2))}</span><div class="badges">${statusBadges(product)}</div></div>
        <button class="row-action" type="button" data-edit-product="${escapeHtml(product.id)}">Chỉnh sửa</button>
      </article>`).join("");
    $("adminEmpty")?.classList.toggle("hide", products.length > 0 || state.loading);
    $("adminTotal").textContent = new Intl.NumberFormat("vi-VN").format(state.pagination.total || 0);
    $("adminPageCount").textContent = String(products.length);
    const filters = currentFilters();
    const activeFilters = [filters.search,filters.dataStatus,filters.active !== null ? "active" : "",filters.published !== null ? "published" : ""].filter(Boolean).length;
    $("adminFilterSummary").textContent = activeFilters ? `${activeFilters} điều kiện` : "Tất cả";
    $("adminPageLabel").textContent = `Trang ${Math.floor(state.pagination.offset / PAGE_SIZE) + 1}`;
    $("adminPrevPage").disabled = state.loading || state.pagination.offset <= 0;
    $("adminNextPage").disabled = state.loading || !state.pagination.has_more;
    $("adminCatalogStatus").textContent = state.loading ? "Đang tải danh mục…" : `Hiển thị ${products.length} trong ${state.pagination.total || 0} sản phẩm`;
    attachImageFallbacks();
  }

  async function loadProducts({resetOffset = false} = {}) {
    if (state.loading) return;
    setBusy(true);
    renderProducts();
    try {
      const result = await api.list(currentFilters(resetOffset));
      state.products = Array.isArray(result?.items) ? result.items : [];
      state.pagination = {...state.pagination,...(result?.pagination || {})};
    } catch (error) {
      state.products = [];
      toast(errorMessage(error), true);
      $("adminCatalogStatus").textContent = "Không tải được danh mục.";
    } finally {
      setBusy(false);
      renderProducts();
    }
  }

  function value(id, product, key, fallback = "") {
    if ($(id)) $(id).value = product?.[key] ?? fallback;
  }

  function updatePreview() {
    const image = $("adminImagePreview");
    const fallback = $("adminImageFallback");
    const raw = cleanText($("adminImageUrl")?.value);
    image.classList.toggle("hide", !raw);
    fallback.classList.toggle("hide", Boolean(raw));
    if (!raw) { image.removeAttribute("src"); return; }
    image.src = raw;
    image.onerror = () => { image.classList.add("hide"); fallback.classList.remove("hide"); fallback.textContent = "Không tải được ảnh"; };
    image.onload = () => { image.classList.remove("hide"); fallback.classList.add("hide"); };
  }

  function openDrawer(productId, trigger = null) {
    const product = state.products.find(item => item.id === productId);
    if (!product) return;
    state.selected = {...product};
    state.returnFocus = trigger || root.activeElement;
    $("adminDrawerTitle").textContent = product.name || "Sản phẩm";
    $("adminDrawerMeta").textContent = [product.code,formatSize(product),`Phiên bản ${product.version}`].filter(Boolean).join(" · ");
    value("adminCode",product,"code"); value("adminName",product,"name"); value("adminWidth",product,"width_mm"); value("adminHeight",product,"height_mm");
    value("adminSurface",product,"surface"); value("adminColor",product,"color"); value("adminCategory",product,"category"); value("adminCollection",product,"collection"); value("adminOrigin",product,"origin");
    value("adminPrice",product,"price_per_m2"); value("adminPriceDate",product,"price_effective_date"); value("adminDescription",product,"description");
    value("adminImageUrl",product,"image_url"); value("adminGallery",{gallery:(product.gallery_urls || []).join("\n")},"gallery"); value("adminPdfUrl",product,"pdf_url"); value("adminVideoUrl",product,"video_url"); value("adminMoreInfoUrl",product,"more_info_url");
    $("adminActiveState").checked = product.active === true;
    $("adminPublishedState").checked = product.is_published === true;
    $("adminPublishedState").disabled = product.data_status !== "READY";
    $("adminFormError").textContent = "";
    $("adminDrawerBackdrop").classList.remove("hide");
    $("adminDrawerBackdrop").setAttribute("aria-hidden","false");
    $("adminProductDrawer").classList.remove("hide");
    $("adminProductDrawer").removeAttribute("inert");
    updatePreview();
    $("adminDrawerClose").focus();
  }

  function closeDrawer() {
    $("adminDrawerBackdrop").classList.add("hide");
    $("adminDrawerBackdrop").setAttribute("aria-hidden","true");
    $("adminProductDrawer").classList.add("hide");
    $("adminProductDrawer").setAttribute("inert","");
    state.selected = null;
    state.returnFocus?.focus?.();
  }

  function collectChanges() {
    const original = state.selected;
    if (!original) throw new Error("Không tìm thấy sản phẩm đang chỉnh sửa.");
    const next = {
      code: cleanText($("adminCode").value) || null,
      name: cleanText($("adminName").value),
      width_mm: parsePositiveInteger($("adminWidth").value,"Chiều rộng"),
      height_mm: parsePositiveInteger($("adminHeight").value,"Chiều dài"),
      surface: cleanText($("adminSurface").value) || null,
      color: cleanText($("adminColor").value) || null,
      category: cleanText($("adminCategory").value) || null,
      collection: cleanText($("adminCollection").value) || null,
      origin: cleanText($("adminOrigin").value) || null,
      description: cleanText($("adminDescription").value) || null,
      image_url: parseHttpsUrl($("adminImageUrl").value,"Ảnh đại diện"),
      gallery_urls: parseGallery($("adminGallery").value),
      pdf_url: parseHttpsUrl($("adminPdfUrl").value,"PDF URL"),
      video_url: parseHttpsUrl($("adminVideoUrl").value,"Video URL"),
      more_info_url: parseHttpsUrl($("adminMoreInfoUrl").value,"Trang thông tin thêm"),
      price_per_m2: parseVnd($("adminPrice").value),
      price_effective_date: cleanText($("adminPriceDate").value) || null
    };
    if (!next.name) throw new Error("Tên sản phẩm là bắt buộc.");
    if ((next.width_mm === null) !== (next.height_mm === null)) throw new Error("Quy cách phải có đủ chiều rộng và chiều dài.");
    if ((next.price_per_m2 === null) !== (next.price_effective_date === null)) throw new Error("Giá và ngày hiệu lực phải được cập nhật cùng nhau.");
    const changes = {};
    for (const [key, value] of Object.entries(next)) {
      const oldValue = key === "gallery_urls" ? JSON.stringify(original[key] || []) : String(original[key] ?? "");
      const newValue = key === "gallery_urls" ? JSON.stringify(value) : String(value ?? "");
      if (oldValue !== newValue) changes[key] = value;
    }
    return changes;
  }

  function replaceProduct(product) {
    const index = state.products.findIndex(item => item.id === product.id);
    if (index >= 0) state.products[index] = product;
    state.selected = {...product};
    renderProducts();
  }

  async function saveProduct(event) {
    event.preventDefault();
    if (!state.selected || state.loading) return;
    let reloadAfterSave = false;
    try {
      const changes = collectChanges();
      if (!Object.keys(changes).length) { toast("Không có thay đổi cần lưu."); return; }
      setBusy(true); $("adminFormError").textContent = "";
      const saved = await api.update(state.selected.id,state.selected.version,changes);
      replaceProduct(saved);
      toast("Đã lưu nội dung sản phẩm.");
      closeDrawer();
      reloadAfterSave = true;
    } catch (error) {
      $("adminFormError").textContent = errorMessage(error);
    } finally { setBusy(false); }
    if (reloadAfterSave) await loadProducts();
  }

  async function saveState() {
    if (!state.selected || state.loading) return;
    const active = $("adminActiveState").checked;
    const published = $("adminPublishedState").checked;
    if (published && (!active || state.selected.data_status !== "READY")) {
      $("adminFormError").textContent = "Chỉ sản phẩm đang hoạt động và Sẵn sàng mới được đăng website.";
      return;
    }
    try {
      setBusy(true); $("adminFormError").textContent = "";
      const saved = await api.setState(state.selected.id,state.selected.version,active,published);
      replaceProduct(saved);
      $("adminPublishedState").disabled = saved.data_status !== "READY";
      toast("Đã lưu trạng thái sản phẩm.");
    } catch (error) { $("adminFormError").textContent = errorMessage(error); }
    finally { setBusy(false); }
  }

  function profileWithTimeout(authUserId) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("ACCESS_CHECK_TIMEOUT")), accessCheckTimeoutMs);
    });
    return Promise.race([api.profile(authUserId), timeout]).finally(() => clearTimeout(timeoutId));
  }

  async function handleSession(event, session) {
    const generation = ++state.authGeneration;
    if (!session?.user) {
      state.profile = null;
      state.authUserId = "";
      showOnly("adminLoginView");
      return;
    }
    const authUserId = cleanText(session.user.id);
    const sameUser = Boolean(authUserId) && state.authUserId === authUserId && isAdminProfile(state.profile);
    const backgroundRefresh = event === "TOKEN_REFRESHED" && sameUser;
    if (!backgroundRefresh) showOnly("adminLoadingView");
    try {
      const profile = await profileWithTimeout(authUserId);
      if (generation !== state.authGeneration) return;
      if (!isAdminProfile(profile)) {
        state.profile = null;
        state.authUserId = authUserId;
        $("adminDeniedMessage").textContent = profile ? `Tài khoản ${profile.email || session.user.email || "này"} không có quyền owner/admin đang hoạt động.` : "Tài khoản chưa được liên kết với hồ sơ nhân viên hợp lệ.";
        showOnly("adminDeniedView");
        return;
      }
      state.profile = profile;
      state.authUserId = authUserId;
      $("adminProfileName").textContent = profile.name || profile.email || "Quản trị viên";
      $("adminProfileRole").textContent = cleanText(profile.role).toUpperCase();
      showOnly("adminWorkspace");
      if (!backgroundRefresh || !state.products.length) await loadProducts({resetOffset:true});
    } catch (error) {
      if (generation !== state.authGeneration) return;
      if (sameUser && isAdminProfile(state.profile)) {
        showOnly("adminWorkspace");
        toast(error?.message === "ACCESS_CHECK_TIMEOUT" ? "Chưa thể xác minh lại quyền truy cập. Workspace hiện tại vẫn được giữ." : errorMessage(error), true);
        return;
      }
      state.profile = null;
      state.authUserId = authUserId;
      $("adminDeniedMessage").textContent = errorMessage(error);
      showOnly("adminDeniedView");
    }
  }

  function bind() {
    importController.bind();
    $("adminLoginForm")?.addEventListener("submit", async event => {
      event.preventDefault(); $("adminLoginError").textContent = "";
      try { await api.signIn(cleanText($("adminLoginEmail").value),$("adminLoginPassword").value); }
      catch (error) { $("adminLoginError").textContent = errorMessage(error); }
    });
    $("adminGoogleLogin")?.addEventListener("click", () => api.signInGoogle().catch(error => $("adminLoginError").textContent = errorMessage(error)));
    for (const id of ["adminLogout","adminDeniedLogout"]) $(id)?.addEventListener("click", () => api.signOut().catch(error => toast(errorMessage(error),true)));
    $("adminFilters")?.addEventListener("submit", event => {event.preventDefault();loadProducts({resetOffset:true});});
    for (const id of ["adminStatusFilter","adminActiveFilter","adminPublishedFilter"]) $(id)?.addEventListener("change", () => loadProducts({resetOffset:true}));
    $("adminClearFilters")?.addEventListener("click", () => {for(const id of ["adminSearch","adminStatusFilter","adminActiveFilter","adminPublishedFilter"]) $(id).value="";loadProducts({resetOffset:true});});
    $("adminReload")?.addEventListener("click", () => loadProducts());
    $("adminPrevPage")?.addEventListener("click", () => {state.pagination.offset=Math.max(0,state.pagination.offset-PAGE_SIZE);loadProducts();});
    $("adminNextPage")?.addEventListener("click", () => {if(state.pagination.has_more){state.pagination.offset+=PAGE_SIZE;loadProducts();}});
    root.addEventListener("click", event => {const button=event.target.closest?.("[data-edit-product]");if(button)openDrawer(button.dataset.editProduct,button);});
    $("adminProductForm")?.addEventListener("submit",saveProduct);
    $("adminSaveState")?.addEventListener("click",saveState);
    $("adminDrawerClose")?.addEventListener("click",closeDrawer); $("adminCancelEdit")?.addEventListener("click",closeDrawer); $("adminDrawerBackdrop")?.addEventListener("click",closeDrawer);
    $("adminImageUrl")?.addEventListener("input",updatePreview);
    $("adminActiveState")?.addEventListener("change", () => {if(!$("adminActiveState").checked) $("adminPublishedState").checked=false;});
    root.addEventListener("keydown", event => {if(event.key==="Escape"&&!$("adminProductDrawer")?.classList.contains("hide")){event.preventDefault();closeDrawer();}});
  }

  return {
    async start() {
      bind();
      const session = await api.getSession();
      await handleSession("INITIAL_SESSION", session);
      api.onAuthStateChange((event, nextSession) => handleSession(event, nextSession));
    },
    fatal(error) { $("adminDeniedMessage").textContent = errorMessage(error); showOnly("adminDeniedView"); },
    openDrawer,
    closeDrawer,
    loadProducts,
    importController,
    state
  };
}
