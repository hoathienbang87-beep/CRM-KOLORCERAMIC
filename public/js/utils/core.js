export const $ = id => document.getElementById(id);

export const todayIso = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0,10);
};
export const currentMonth = () => todayIso().slice(0,7);
export const currentWeek = () => {
  const d = new Date();
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2,"0")}`;
};
export const clean = v => String(v || "").trim();
export const phoneNorm = v => clean(v).replace(/\D/g, "");
export const uniq = arr => [...new Set((arr || []).map(clean).filter(Boolean))];
export const esc = v => String(v ?? "").replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
export const money = v => Number(v || 0).toLocaleString("vi-VN");

export const toDate = v => v?.toDate ? v.toDate() : (v ? new Date(v) : null);
export const fmtDate = v => {
  if (!v) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? new Date(String(v) + "T00:00:00") : toDate(v);
  return d && !Number.isNaN(d) ? d.toLocaleDateString("vi-VN") : "";
};
export const dateInputValue = v => {
  const d = toDate(v);
  return d && !Number.isNaN(d) ? d.toISOString().slice(0,10) : "";
};
export const monthOf = v => {
  const d = toDate(v);
  return d && !Number.isNaN(d) ? d.toISOString().slice(0,7) : "";
};
export const weekOf = v => {
  const d = toDate(v);
  if (!d || Number.isNaN(d)) return "";
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2,"0")}`;
};
export const byDateDesc = (a,b,field="createdAt") => (toDate(b[field])?.getTime() || 0) - (toDate(a[field])?.getTime() || 0);

export function debounce(fn, wait=220) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function optionValue(item) {
  return typeof item === "object" ? clean(item.email || item.value || item.name) : clean(item);
}

export function optionLabel(item) {
  if (typeof item === "object") {
    const name = clean(item.name || item.label || item.email);
    const email = clean(item.email);
    return email && email !== name ? `${name} (${email})` : name;
  }
  return clean(item);
}

export function uniqueOptions(values) {
  const map = new Map();
  (values || []).forEach(item => {
    const value = optionValue(item);
    if (!value) return;
    if (!map.has(value)) map.set(value, {value, label: optionLabel(item)});
  });
  return [...map.values()];
}

export const listToText = values => (values || []).map(clean).filter(Boolean).join("\n");
export const textToList = text => uniq(clean(text).split(/\r?\n|,/).map(clean));
export function sourceChannelsToText(sourceChannels = {}) {
  return Object.entries(sourceChannels || {})
    .map(([source, channels]) => `${source}: ${(channels || []).join(", ")}`)
    .join("\n");
}
export function textToSourceChannels(text) {
  const map = {};
  clean(text).split(/\r?\n/).forEach(line => {
    const idx = line.indexOf(":");
    if (idx < 0) return;
    const source = clean(line.slice(0, idx));
    const channels = textToList(line.slice(idx + 1));
    if (source) map[source] = channels;
  });
  return map;
}
export function objectToText(obj = {}) {
  return Object.entries(obj || {}).map(([key, value]) => `${key}: ${value}`).join("\n");
}
export function textToObject(text) {
  const obj = {};
  clean(text).split(/\r?\n/).forEach(line => {
    const idx = line.indexOf(":");
    if (idx < 0) return;
    const key = clean(line.slice(0, idx));
    const value = clean(line.slice(idx + 1));
    if (key) obj[key] = value;
  });
  return obj;
}

export function normalizeKey(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, m => m === "Đ" ? "D" : "d")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
