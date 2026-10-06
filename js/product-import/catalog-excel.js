import {canonicalizeCatalogRow,classifyCatalogDuplicates} from "./catalog-records.js";
import {foldMarker} from "./normalization.js";

function columnName(index){
  let value=index+1,result="";
  while(value){const mod=(value-1)%26;result=String.fromCharCode(65+mod)+result;value=Math.floor((value-1)/26);}
  return result;
}

function decodeCell(address){
  const match=/^([A-Z]+)([1-9]\d*)$/iu.exec(address);
  if(!match) return null;
  let col=0;
  for(const char of match[1].toUpperCase()) col=col*26+char.charCodeAt(0)-64;
  return {r:Number(match[2])-1,c:col-1};
}

function decodeRange(address){
  const [start,end=start]=String(address||"A1").split(":");
  return {s:decodeCell(start),e:decodeCell(end)};
}

function address(row,col){return `${columnName(col)}${row+1}`;}

function cellValue(cell){
  if(cell===null||cell===undefined) return null;
  if(typeof cell!=="object"||Array.isArray(cell)) return cell;
  return cell.v??cell.w??null;
}

function makeCellReader(sheet){
  const merges=Array.isArray(sheet["!merges"])?sheet["!merges"]:[];
  return (row,col)=>{
    const direct=sheet[address(row,col)];
    if(direct!==undefined) return {value:cellValue(direct),source_ref:address(row,col),merged:false};
    const merged=merges.find(range=>row>=range.s.r&&row<=range.e.r&&col>=range.s.c&&col<=range.e.c);
    if(!merged) return {value:null,source_ref:address(row,col),merged:false};
    const sourceRef=address(merged.s.r,merged.s.c);
    return {value:cellValue(sheet[sourceRef]),source_ref:sourceRef,merged:true};
  };
}

function headerMarker(value){return foldMarker(value).replace(/[^A-Z0-9]+/gu," ").trim();}

function detectHeaderColumns(values){
  const result={priceRank:-1};
  values.forEach((value,col)=>{
    const marker=headerMarker(value);
    if(!marker) return;
    if(marker==="PRODUCT ID"||marker==="PRODUCT_ID"||marker==="ID SAN PHAM") result.productId=col;
    if(marker==="SKU"||marker.includes("MA SAN PHAM")||marker.includes("MA HANG")||marker==="CODE") result.sku=col;
    if(marker.includes("TEN SAN PHAM")||marker.includes("TEN HANG")||marker.includes("TEN CHUAN")||marker==="PRODUCT NAME") result.name=col;
    if(marker.includes("KICH THUOC")||marker.includes("QUY CACH")||marker==="SIZE"){
      result.size=col;
      result.defaultSizeUnit=marker.includes(" CM")?"cm":marker.includes(" MM")?"mm":null;
    }
    if(marker.includes("BE MAT")||marker==="SURFACE") result.surface=col;
    if(marker.includes("EFFECTIVE DATE")||marker.includes("NGAY HIEU LUC")) result.effectiveDate=col;
    if(marker.includes("GIA")||marker.includes("PRICE")){
      const perM2=marker.includes("M2")||marker.includes("M 2")||marker.includes("PER M2");
      if(!perM2) return;
      const rank=marker.includes("MOI")||marker.includes("CHOT")?100:marker.includes("PRICE PER M2")?90:50;
      if(rank>result.priceRank){result.price=col;result.priceRank=rank;}
    }
  });
  result.nameFromSku=result.name===undefined&&result.sku!==undefined;
  if(result.nameFromSku) result.name=result.sku;
  const score=[result.name,result.size,result.price].filter(value=>value!==undefined).length;
  return {...result,score};
}

function findHeader(sheet,range,read){
  let best=null;
  const maxRow=Math.min(range.e.r,49);
  const maxCol=Math.min(range.e.c,99);
  for(let row=range.s.r;row<=maxRow;row++){
    const values=[];
    for(let col=range.s.c;col<=maxCol;col++) values[col]=read(row,col).value;
    const columns=detectHeaderColumns(values);
    if(!best||columns.score>best.columns.score) best={row,columns};
  }
  return best?.columns.score>=3?best:null;
}

function parseSheet(sheet,sheetName){
  const range=decodeRange(sheet["!ref"]||"A1");
  const read=makeCellReader(sheet);
  const header=findHeader(sheet,range,read);
  if(!header) return {ok:false,error:{code:"TABLE_HEADER_NOT_FOUND",sheet:sheetName},rows:[]};

  const rows=[];
  let lastSize=null;
  const allowSizeFillDown=(sheet["!merges"]||[]).some(range=>range.s.c===header.columns.size&&range.e.c===header.columns.size&&range.e.r>range.s.r);
  for(let row=header.row+1;row<=range.e.r;row++){
    const nameCell=read(row,header.columns.name);
    const skuCell=header.columns.sku===undefined?{value:null,source_ref:null}:read(row,header.columns.sku);
    if(String(nameCell.value??"").trim()===""&&String(skuCell.value??"").trim()==="") continue;
    const rawSize=read(row,header.columns.size);
    if(String(rawSize.value??"").trim()!=="") lastSize=rawSize;
    const sizeCell=String(rawSize.value??"").trim()!==""?rawSize:allowSizeFillDown?lastSize:null;
    const surfaceCell=header.columns.surface===undefined?{value:null,source_ref:null}:read(row,header.columns.surface);
    const priceCell=read(row,header.columns.price);
    const productIdCell=header.columns.productId===undefined?{value:null}:read(row,header.columns.productId);
    const effectiveDateCell=header.columns.effectiveDate===undefined?{value:null}:read(row,header.columns.effectiveDate);
    const parsed=canonicalizeCatalogRow({
      source_sheet:sheetName,
      source_row_number:row+1,
      source_cell_ref:nameCell.source_ref,
      size_source_cell_ref:sizeCell?.source_ref||rawSize.source_ref,
      size_inherited:Boolean(sizeCell&&sizeCell.source_ref!==rawSize.source_ref),
      size_merged:Boolean(sizeCell?.merged),
      product_id:productIdCell.value,
      sku:skuCell.value,
      product_name:nameCell.value,
      size:sizeCell?.value,
      surface:surfaceCell.value,
      price_per_m2:priceCell.value,
      effective_date:effectiveDateCell.value,
      raw_values:{
        product_id:productIdCell.value,sku:skuCell.value,name:nameCell.value,
        size:sizeCell?.value??null,surface:surfaceCell.value,price_per_m2:priceCell.value
      }
    },{defaultSizeUnit:header.columns.defaultSizeUnit});
    if(header.columns.nameFromSku) parsed.warnings.push({code:"NAME_FROM_SKU_COLUMN",details:{header_row:header.row+1}});
    rows.push(parsed);
  }
  const classified=classifyCatalogDuplicates(rows);
  const summary={
    physical_rows:classified.rows.length,
    ready:classified.rows.filter(row=>row.disposition==="READY").length,
    missing_price:classified.rows.filter(row=>row.disposition==="MISSING_PRICE").length,
    manual_review:classified.rows.filter(row=>row.disposition==="MANUAL_REVIEW").length,
    duplicate_rows:classified.rows.filter(row=>row.disposition==="SKIP_DUPLICATE").length,
    price_conflicts:classified.rows.filter(row=>row.disposition==="PRICE_CONFLICT").length,
    same_price_warnings:classified.rows.filter(row=>row.warnings.some(item=>item.code==="SAME_PRICE_WARNING")).length
  };
  return {
    ok:true,
    metadata:{sheet_name:sheetName,header_row:header.row+1,default_size_unit:header.columns.defaultSizeUnit,size_fill_down:allowSizeFillDown,columns:header.columns},
    rows:classified.rows,
    duplicate_groups:classified.duplicate_groups,
    summary
  };
}

export function parseCatalogExcelWorkbook(workbook,{sheetName=null}={}){
  if(!workbook||!Array.isArray(workbook.SheetNames)||!workbook.Sheets) return {ok:false,error:{code:"INVALID_WORKBOOK"},rows:[]};
  const names=sheetName?[sheetName]:workbook.SheetNames;
  let firstFailure=null;
  for(const name of names){
    const sheet=workbook.Sheets[name];
    if(!sheet) continue;
    const result=parseSheet(sheet,name);
    if(result.ok) return result;
    firstFailure||=result;
  }
  return firstFailure||{ok:false,error:{code:"TABLE_HEADER_NOT_FOUND"},rows:[]};
}
