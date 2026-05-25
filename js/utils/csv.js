import { clean, normalizeKey } from "./core.js";

function detectDelimiter(line) {
  const candidates = [";", ",", "\t"];
  return candidates.map(d => ({d, count:(line.match(new RegExp(d === "\t" ? "\\t" : `\\${d}`, "g")) || []).length}))
    .sort((a,b) => b.count - a.count)[0].d;
}

export function parseCsv(text) {
  const cleaned = text.replace(/^\ufeff/, "").replace(/^sep=.\r?\n/i, "");
  const delimiter = detectDelimiter(cleaned.split(/\r?\n/).find(Boolean) || "");
  const rows = [];
  let row = [], cell = "", inQuotes = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i], next = cleaned[i + 1];
    if (ch === '"' && inQuotes && next === '"') { cell += '"'; i++; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === delimiter && !inQuotes) { row.push(cell); cell = ""; continue; }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some(v => clean(v))) rows.push(row);
      row = []; cell = "";
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some(v => clean(v))) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map(normalizeKey);
  return rows.slice(1).map(values => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = clean(values[i]));
    return obj;
  });
}

export function rowValue(row, aliases) {
  for (const alias of aliases) {
    const value = row[normalizeKey(alias)];
    if (clean(value)) return clean(value);
  }
  return "";
}

export function parseImportDate(value) {
  const v = clean(value);
  if (!v) return "";
  if (/^\d{5}$/.test(v)) {
    const d = new Date((Number(v) - 25569) * 86400000);
    return d && !Number.isNaN(d) ? d.toISOString().slice(0,10) : "";
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(v)) {
    const [y,m,d] = v.split("-");
    return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  }
  const match = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (match) {
    const y = match[3].length === 2 ? "20" + match[3] : match[3];
    return `${y}-${match[2].padStart(2,"0")}-${match[1].padStart(2,"0")}`;
  }
  return "";
}

export function parseImportAmount(value) {
  const normalized = clean(value).replace(/[^\d.-]/g, "");
  return Number(normalized || 0);
}
