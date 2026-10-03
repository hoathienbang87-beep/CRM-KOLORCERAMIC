const ALLOWED_ROLES = new Set(["admin", "owner"]);

export function cleanText(value) {
  return value == null ? "" : String(value).trim();
}

export function formatVnd(value) {
  if (value === null || value === undefined || value === "") return "Đang cập nhật";
  const number = Number(value);
  return Number.isFinite(number) ? `${new Intl.NumberFormat("vi-VN").format(number)} ₫` : "Đang cập nhật";
}

export function parseVnd(value) {
  const text = cleanText(value).replace(/[.\s]/g, "");
  if (!text) return null;
  if (!/^\d+$/.test(text) || Number(text) <= 0) throw new Error("Giá/m² phải là số nguyên dương.");
  return text;
}

export function formatSize(product) {
  const size = value => value == null || value === "" ? "" : Number(value) % 10 === 0 ? String(Number(value) / 10) : (Number(value) / 10).toFixed(1);
  const width = size(product?.width_mm);
  const height = size(product?.height_mm);
  return width && height ? `${width} × ${height} cm` : "Đang cập nhật";
}

export function parsePositiveInteger(value, label) {
  const text = cleanText(value);
  if (!text) return null;
  if (!/^\d+$/.test(text) || Number(text) <= 0) throw new Error(`${label} phải là số nguyên dương.`);
  return text;
}

export function parseHttpsUrl(value, label) {
  const text = cleanText(value);
  if (!text) return null;
  let url;
  try { url = new URL(text); } catch { throw new Error(`${label} không hợp lệ.`); }
  if (url.protocol !== "https:") throw new Error(`${label} phải bắt đầu bằng https://`);
  return url.href;
}

export function parseGallery(value) {
  return cleanText(value).split(/\r?\n/).map(item => item.trim()).filter(Boolean).map((url, index) => parseHttpsUrl(url, `Ảnh gallery dòng ${index + 1}`));
}

export function isAdminProfile(profile) {
  const role = cleanText(profile?.role).toLowerCase();
  const lifecycle = cleanText(profile?.lifecycle_status || "active").toLowerCase();
  return profile?.active !== false && lifecycle === "active" && ALLOWED_ROLES.has(role);
}

export function createCatalogAdminApi(client) {
  if (!client?.auth || !client?.rpc || !client?.from) throw new Error("Không khởi tạo được kết nối Supabase.");
  const rpc = async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  };
  return {
    async getSession() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return data?.session || null;
    },
    onAuthStateChange(callback) {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        queueMicrotask(() => {
          Promise.resolve()
            .then(() => callback(event, session))
            .catch(error => console.error("Catalog Admin auth transition failed", error));
        });
      });
      return () => data?.subscription?.unsubscribe?.();
    },
    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data?.session || null;
    },
    async signInGoogle() {
      const { data, error } = await client.auth.signInWithOAuth({provider:"google", options:{redirectTo:`${location.origin}${location.pathname}`, queryParams:{access_type:"offline",prompt:"select_account"}}});
      if (error) throw error;
      if (data?.url) location.assign(data.url);
    },
    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },
    async profile(authUserId) {
      const { data, error } = await client.from("app_users")
        .select("id,email,name,role,active,lifecycle_status,supabase_auth_id")
        .eq("supabase_auth_id", authUserId).maybeSingle();
      if (error) throw error;
      return data;
    },
    list(filters) {
      return rpc("catalog_admin_list_products_v1", {
        p_search: filters.search || null,
        p_data_status: filters.dataStatus || null,
        p_active: filters.active,
        p_is_published: filters.published,
        p_limit: filters.limit,
        p_offset: filters.offset
      });
    },
    update(productId, expectedVersion, changes) {
      return rpc("catalog_admin_update_product_v1", {p_product_id:productId,p_expected_version:expectedVersion,p_changes:changes});
    },
    setState(productId, expectedVersion, active, published) {
      return rpc("catalog_admin_set_product_state_v1", {p_product_id:productId,p_expected_version:expectedVersion,p_active:active,p_is_published:published});
    },
    async catalogSnapshot() {
      const items = [];
      let offset = 0;
      do {
        const result = await rpc("catalog_admin_list_products_v1", {
          p_search:null,p_data_status:null,p_active:null,p_is_published:null,p_limit:100,p_offset:offset
        });
        items.push(...(result?.items || []));
        if (!result?.pagination?.has_more) break;
        offset += 100;
      } while (offset <= 100000);
      return items;
    },
    previewImport(batch, rows) {
      return rpc("catalog_admin_preview_import", {p_batch:batch,p_rows:rows});
    },
    listImportBatches(status = null, limit = 30, offset = 0) {
      return rpc("catalog_admin_list_import_batches_v1", {p_status:status,p_limit:limit,p_offset:offset});
    },
    getImportBatch(batchId) {
      return rpc("catalog_admin_get_import_batch_v1", {p_batch_id:batchId});
    },
    reviewImportRows(batchId, decisions) {
      return rpc("catalog_admin_review_import_rows_v1", {p_batch_id:batchId,p_decisions:decisions});
    },
    approveImport(batchId, idempotencyKey) {
      return rpc("catalog_admin_approve_import", {p_batch_id:batchId,p_idempotency_key:idempotencyKey});
    },
    applyImport(batchId, idempotencyKey) {
      return rpc("catalog_admin_apply_import", {p_batch_id:batchId,p_idempotency_key:idempotencyKey});
    },
    rollbackImport(batchId, idempotencyKey) {
      return rpc("catalog_admin_rollback_import", {p_batch_id:batchId,p_idempotency_key:idempotencyKey});
    }
  };
}
