import {foldMarker} from "./normalization.js";

export const ISTONE_ADAPTER={
  id:"ISTONE_INDONESIA_V1",
  version:"1.0.0",
  columnBoundaries:[51.36,71.52,167.04,311.16,356.88,404.16,453.60,503.04,552.48],
  columnTolerance:8,
  headerAnchorTolerance:14,
  rowYTolerance:3,
  bandYTolerance:2.5,
  groupCenterTolerance:3,
  sizeUnit:"cm"
};

const REQUIRED_MARKERS=[
  "BANG GIA NIEM YET GACH INDONESIA",
  "STT",
  "MA HANG",
  "TEN HANG",
  "QUY CACH",
  "DONG GOI",
  "DON GIA",
  "CONG TY TNHH SAN XUAT VA XUAT NHAP KHAU ISTONE"
];

function readingText(items){
  return [...items].sort((a,b)=>a.page-b.page||Number(a.y)-Number(b.y)||Number(a.x)-Number(b.x)).map(item=>item.text).join(" ");
}

function inRange(value,min,max,tolerance=0){return value>=min-tolerance&&value<max+tolerance;}

export function detectIstoneIndonesiaV1(items,pages=[]){
  if(!Array.isArray(items)||items.length===0) return {ok:false,code:"TEXT_LAYER_UNAVAILABLE"};
  const folded=foldMarker(readingText(items));
  if(REQUIRED_MARKERS.some(marker=>!folded.includes(marker))) return {ok:false,code:"UNKNOWN_FORMAT"};
  const b=ISTONE_ADAPTER.columnBoundaries,t=ISTONE_ADAPTER.headerAnchorTolerance;
  for(const page of pages.length?pages:[...new Set(items.map(item=>item.page))].map(page=>({page}))){
    const pageItems=items.filter(item=>item.page===page.page);
    const stt=pageItems.some(item=>foldMarker(item.text)==="STT"&&inRange(Number(item.x),b[0],b[1],t));
    const code=pageItems.some(item=>foldMarker(item.text)==="MA"&&inRange(Number(item.x),b[1],b[2],t));
    const name=pageItems.some(item=>foldMarker(item.text)==="TEN"&&inRange(Number(item.x),b[2],b[3],t));
    const size=pageItems.some(item=>foldMarker(item.text).includes("CM")&&inRange(Number(item.x),b[3],b[4],t));
    const packaging=pageItems.some(item=>foldMarker(item.text).includes("VIEN/HOP")&&inRange(Number(item.x),b[4],b[5],t));
    const price=pageItems.some(item=>foldMarker(item.text).includes("VND/M2")&&inRange(Number(item.x),b[5],b[6],t));
    if(!stt||!code||!name) return {ok:false,code:"TABLE_HEADER_NOT_FOUND",page:page.page};
    if(!size||!packaging||!price) return {ok:false,code:"COLUMN_GEOMETRY_INVALID",page:page.page};
  }
  return {ok:true,adapter:ISTONE_ADAPTER.id,adapter_version:ISTONE_ADAPTER.version};
}

export function extractDocumentMetadata(items){
  const ordered=readingText(items);
  const dateMatch=/(\d{2})\.(\d{2})\.(\d{4})/u.exec(ordered);
  const effectiveDate=dateMatch?`${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`:null;
  const folded=foldMarker(ordered);
  return {
    supplier:folded.includes("CONG TY TNHH SAN XUAT VA XUAT NHAP KHAU ISTONE")?"ISTONE":null,
    effective_date:effectiveDate,
    origin_candidate:folded.includes("GACH INDONESIA")?"Indonesia":null,
    origin_confirmed:false
  };
}
