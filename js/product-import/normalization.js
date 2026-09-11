export function collapseWhitespace(value){
  return String(value??"").normalize("NFKC").trim().replace(/\s+/gu," ");
}

export function normalizeCode(value){
  return collapseWhitespace(value).toUpperCase();
}

export function normalizeName(value){
  return collapseWhitespace(value).replace(/\s*,\s*/gu,",").toUpperCase();
}

export function foldMarker(value){
  return collapseWhitespace(value).normalize("NFD").replace(/[\u0300-\u036f]/gu,"").replace(/[Đđ]/gu,"D").toUpperCase();
}
