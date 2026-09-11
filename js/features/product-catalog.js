// PRODUCT-R2: decimal values stay as canonical strings until submitted to
// PostgreSQL numeric columns. The browser never becomes the numeric authority.
function normalizeDecimalText(text) {
  const [wholeRaw, fractionRaw = ""] = text.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const fraction = fractionRaw.replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function productDecimal(value, options = {}) {
  const { nullable = false, scale = 4, integer = false, allowZero = true, label = "Giá trị" } = options;
  const text = String(value ?? "").trim();
  if (!text) {
    if (nullable) return null;
    throw new Error(`${label} là bắt buộc.`);
  }
  const pattern = integer ? /^[0-9]+$/ : new RegExp(`^[0-9]+(?:\\.[0-9]{1,${scale}})?$`);
  if (!pattern.test(text)) throw new Error(`${label} không hợp lệ.`);
  const normalized = normalizeDecimalText(text);
  if (!allowZero && /^0(?:\.0+)?$/.test(normalized)) throw new Error(`${label} phải lớn hơn 0.`);
  return normalized;
}

export function productDate(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Ngày hiệu lực giá là bắt buộc.");
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new Error("Ngày hiệu lực giá không hợp lệ.");
  return text;
}

export function productQuantity(value) {
  return value === null || value === undefined || value === "" ? "Chưa cập nhật" : normalizeDecimalText(String(value));
}

export function productMoney(value) {
  if (value === null || value === undefined || value === "") return "—";
  const text = normalizeDecimalText(String(value));
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(text)) return "—";
  const [whole, fraction] = text.split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (fraction ? "," + fraction : "") + " ₫";
}

export function productDimension(value) {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value);
  return /^[0-9]+(?:\.[0-9]+)?$/.test(text) ? normalizeDecimalText(text) : "";
}

export function productSizeLabel(product) {
  const width = productDimension(product?.widthCm);
  const height = productDimension(product?.heightCm);
  return width && height ? `${width} × ${height} cm` : "—";
}

export function productFromCanonical(row) {
  if (!row?.id) throw new Error("Không thể đọc sản phẩm.");
  return {
    id: String(row.id),
    code: row.code ?? "",
    name: row.name ?? "",
    widthCm: row.width_cm ?? null,
    heightCm: row.height_cm ?? null,
    pricePerM2: row.price_per_m2 ?? null,
    pricePerBox: row.price_per_box ?? null,
    pricePerPiece: row.price_per_piece ?? null,
    piecesPerBox: row.pieces_per_box ?? null,
    sqmPerBox: row.sqm_per_box ?? null,
    surface: row.surface ?? null,
    origin: row.origin ?? null,
    stockQuantity: row.stock_quantity ?? null,
    priceEffectiveDate: row.price_effective_date ?? "",
    active: row.active !== false,
    version: Number(row.version || 1),
    createdAt: row.created_at ?? null,
    createdByUserId: row.created_by_user_id ?? null,
    createdByName: row.created_by_user_id ? row.created_by_name ?? "" : "",
    updatedAt: row.updated_at ?? null,
    updatedByUserId: row.updated_by_user_id ?? null,
    updatedByName: row.updated_by_user_id ? row.updated_by_name ?? "" : ""
  };
}

function canonicalValues(values) {
  const code = String(values.code ?? "").trim();
  const name = String(values.name ?? "").trim();
  if (!code) throw new Error("Mã sản phẩm là bắt buộc.");
  if (!name) throw new Error("Tên sản phẩm là bắt buộc.");
  return {
    code,
    name,
    width_cm: productDecimal(values.width_cm, { scale: 3, allowZero: false, label: "Chiều rộng" }),
    height_cm: productDecimal(values.height_cm, { scale: 3, allowZero: false, label: "Chiều cao" }),
    price_per_m2: productDecimal(values.price_per_m2, { integer: true, allowZero: false, label: "Giá/m²" }),
    price_per_box: productDecimal(values.price_per_box, { nullable: true, integer: true, allowZero: false, label: "Giá/hộp" }),
    price_per_piece: productDecimal(values.price_per_piece, { nullable: true, integer: true, allowZero: false, label: "Giá/viên" }),
    pieces_per_box: productDecimal(values.pieces_per_box, { nullable: true, integer: true, allowZero: false, label: "Số viên/hộp" }),
    sqm_per_box: productDecimal(values.sqm_per_box, { nullable: true, scale: 4, allowZero: false, label: "m²/hộp" }),
    surface: String(values.surface ?? "").trim() || null,
    origin: String(values.origin ?? "").trim() || null,
    stock_quantity: productDecimal(values.stock_quantity, { nullable: true, scale: 4, allowZero: true, label: "Tồn kho" }),
    price_effective_date: productDate(values.price_effective_date)
  };
}

function oldCanonical(product) {
  return {
    code: String(product?.code ?? "").trim(),
    name: String(product?.name ?? "").trim(),
    width_cm: productDimension(product?.widthCm),
    height_cm: productDimension(product?.heightCm),
    price_per_m2: productDimension(product?.pricePerM2),
    price_per_box: product?.pricePerBox == null ? null : productDimension(product.pricePerBox),
    price_per_piece: product?.pricePerPiece == null ? null : productDimension(product.pricePerPiece),
    pieces_per_box: product?.piecesPerBox == null ? null : productDimension(product.piecesPerBox),
    sqm_per_box: product?.sqmPerBox == null ? null : productDimension(product.sqmPerBox),
    surface: String(product?.surface ?? "").trim() || null,
    origin: String(product?.origin ?? "").trim() || null,
    stock_quantity: product?.stockQuantity == null ? null : productDimension(product.stockQuantity),
    price_effective_date: String(product?.priceEffectiveDate ?? "")
  };
}

export function productChanges(values, original) {
  const next = canonicalValues(values);
  if (!original) return next;
  const old = oldCanonical(original);
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== old[key]));
}

export function productError(error) {
  if (error?.code === "42501") return "Bạn không có quyền thực hiện thao tác sản phẩm này.";
  if (error?.code === "P0002") return "Không tìm thấy sản phẩm.";
  if (error?.code === "23505") return "Mã sản phẩm đã được sử dụng.";
  if (error?.code === "40001") return "Sản phẩm vừa được cập nhật ở nơi khác. Hãy tải lại và thử lại.";
  if (error?.code === "22023" || error?.code === "23514" || error?.code === "22003") return "Dữ liệu sản phẩm không hợp lệ.";
  return "Không thể lưu thay đổi.";
}
