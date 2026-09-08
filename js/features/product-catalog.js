// Giá/tồn được truyền dưới dạng chuỗi decimal, không qua phép nhân/số thực JS.
export function productDecimal(value, nullable = false) {
  const text = String(value ?? "").trim();
  if (!text && nullable) return null;
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(text)) throw new Error(nullable ? "Dữ liệu tồn kho không hợp lệ." : "Dữ liệu giá không hợp lệ.");
  return text;
}

export function productQuantity(value) {
  return value === null || value === undefined || value === "" ? "Chưa cập nhật" : String(value);
}

export function productMoney(value) {
  if (value === null || value === undefined || value === "") return "Chưa cập nhật";
  const text = String(value);
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(text)) return "Chưa cập nhật";
  const [whole, fraction] = text.split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (fraction ? "," + fraction : "") + " ₫";
}

export function productFromCanonical(row) {
  if (!row?.id) throw new Error("Không thể lưu thay đổi.");
  return {
    id: row.id, code: row.code ?? "", sku: row.code ?? "", name: row.name ?? "",
    size: row.size ?? "", surface: row.surface ?? "", origin: row.origin ?? "",
    price: row.price, stockQuantity: row.stock_quantity,
    updatedAt: row.updated_at, updatedByUserId: row.updated_by_user_id,
    updatedByName: row.updated_by_user_id ? row.updated_by_name ?? "" : ""
  };
}

export function productChanges(values, original) {
  const next = { ...Object.fromEntries(['code','name','size','surface','origin'].map(key => [key, values[key]])),
    price: original && String(values.price ?? "") === String(original.price ?? "") ? original.price : productDecimal(values.price),
    stock_quantity: productDecimal(values.stock_quantity, true) };
  if (!original) return next;
  const old = { code: original.code, name: original.name, size: original.size, surface: original.surface,
    origin: original.origin, price: original.price, stock_quantity: original.stockQuantity };
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => String(value ?? "") !== String(old[key] ?? "")));
}

export function productError(error) {
  if (error?.code === "42501") return "Bạn không có quyền chỉnh sửa sản phẩm.";
  if (error?.code === "P0002") return "Không tìm thấy sản phẩm.";
  if (error?.code === "23505") return "Mã sản phẩm đã được sử dụng.";
  if (error?.code === "22023") return "Dữ liệu giá, tồn kho hoặc thông tin sản phẩm không hợp lệ.";
  return "Không thể lưu thay đổi.";
}
