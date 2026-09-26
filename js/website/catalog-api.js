const clean = value => value == null ? "" : String(value).trim();

export function formatVndPerM2(value) {
  if (value === null || value === undefined || value === "") return "Đang cập nhật";
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? `${new Intl.NumberFormat("vi-VN", {maximumFractionDigits:0}).format(number)} VNĐ/m²`
    : "Đang cập nhật";
}

export function formatProductSize(product) {
  if (clean(product?.size_display)) return clean(product.size_display);
  const cm = value => {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return "";
    return number % 10 === 0 ? String(number / 10) : (number / 10).toFixed(1);
  };
  const width = cm(product?.width_mm);
  const height = cm(product?.height_mm);
  return width && height ? `${width} × ${height} cm` : "Đang cập nhật";
}

export function safeExternalImageUrl(value) {
  try {
    const url = new URL(clean(value));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function createCatalogPublicApi(client) {
  if (!client?.rpc) throw new Error("Không khởi tạo được kết nối catalog.");
  return {
    async list(filters = {}) {
      const {data, error} = await client.rpc("catalog_public_list_products_v1", {
        p_search: clean(filters.search) || null,
        p_category: clean(filters.category) || null,
        p_collection: clean(filters.collection) || null,
        p_surface: clean(filters.surface) || null,
        p_width_mm: filters.widthMm || null,
        p_height_mm: filters.heightMm || null,
        p_min_price: filters.minPrice ?? null,
        p_max_price: filters.maxPrice ?? null,
        p_limit: Math.min(100, Math.max(1, Number(filters.limit) || 24)),
        p_offset: Math.max(0, Number(filters.offset) || 0)
      });
      if (error) throw error;
      return {
        items: Array.isArray(data?.items) ? data.items : [],
        pagination: {
          limit: Number(data?.pagination?.limit) || 24,
          offset: Number(data?.pagination?.offset) || 0,
          total: Number(data?.pagination?.total) || 0,
          has_more: data?.pagination?.has_more === true,
          next_offset: data?.pagination?.next_offset == null ? null : Number(data.pagination.next_offset)
        }
      };
    }
  };
}
