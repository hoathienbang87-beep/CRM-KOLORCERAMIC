import {collapseWhitespace,foldMarker,normalizeCode} from "./normalization.js";

const SURFACE_ALIASES=new Map([
  ["POLISH","POLISH"],["POLISHED","POLISH"],
  ["MATT","MATT"],["MATTE","MATT"],
  ["GLOSSY","GLOSSY"],["SATIN","SATIN"],
  ["BABY SKIN","BABY SKIN"],["BABYSKIN","BABY SKIN"],
  ["HONED","HONED"],["CARVING","CARVING"],
  ["NATURAL","NATURAL"],["NATORALE","NATURAL"]
]);

function decimalParts(value){
  const source=collapseWhitespace(value).replace(",",".");
  const match=/^(\d+)(?:\.(\d+))?$/u.exec(source);
  if(!match) return null;
  const scale=(match[2]||"").length;
  const units=BigInt(`${match[1]}${match[2]||""}`);
  return {units,scale};
}

function toIntegerMm(value,unit){
  const parsed=decimalParts(value);
  if(!parsed||parsed.units<=0n) return null;
  const multiplier=unit==="cm"?10n:1n;
  const denominator=10n**BigInt(parsed.scale);
  const numerator=parsed.units*multiplier;
  if(numerator%denominator!==0n) return null;
  const mm=numerator/denominator;
  if(mm>2147483647n) return null;
  return Number(mm);
}

export function normalizeCatalogText(value){
  return collapseWhitespace(value)
    .replace(/[‐‑‒–—―_-]+/gu," ")
    .replace(/\s*,\s*/gu," ")
    .replace(/\s+/gu," ")
    .trim();
}

export function normalizeCatalogName(value){
  return normalizeCatalogText(value).toUpperCase();
}

export function normalizeCatalogSurface(value){
  const marker=foldMarker(value);
  return marker?SURFACE_ALIASES.get(marker)||marker:null;
}

export function parseCatalogSize(value,{defaultUnit=null}={}){
  const source=collapseWhitespace(value);
  if(!source) return {ok:true,missing:true,width_mm:null,height_mm:null,source_size_text:null,source_size_unit:null};
  const match=/^([0-9]+(?:[.,][0-9]+)?)\s*[xX×]\s*([0-9]+(?:[.,][0-9]+)?)\s*(mm|cm)?$/iu.exec(source);
  if(!match) return {ok:false,code:"INVALID_SIZE",source_size_text:source};
  const unit=(match[3]||defaultUnit||"").toLowerCase();
  if(!["mm","cm"].includes(unit)) return {ok:false,code:"UNKNOWN_SIZE_UNIT",source_size_text:source};
  const width=toIntegerMm(match[1],unit);
  const height=toIntegerMm(match[2],unit);
  if(!width||!height) return {ok:false,code:"INVALID_SIZE",source_size_text:source,source_size_unit:unit};
  return {ok:true,missing:false,width_mm:width,height_mm:height,source_size_text:source,source_size_unit:unit};
}

export function parseCatalogVnd(value){
  if(value===null||value===undefined||collapseWhitespace(value)==="") return {ok:true,missing:true,value:null};
  if(typeof value==="number"){
    if(!Number.isSafeInteger(value)||value<=0) return {ok:false,code:"INVALID_PRICE",value:null};
    return {ok:true,missing:false,value:String(value)};
  }
  const source=collapseWhitespace(value);
  if(!/^(?:[1-9]\d*|[1-9]\d{0,2}(?:\.\d{3})+|[1-9]\d{0,2}(?:,\d{3})+)$/u.test(source)){
    return {ok:false,code:"INVALID_PRICE",value:null};
  }
  const canonical=source.replace(/[.,]/gu,"");
  return {ok:true,missing:false,value:canonical};
}

function splitTrailingSize(name,defaultUnit){
  const source=collapseWhitespace(name);
  const match=/^(.*?)\s+([0-9]+(?:[.,][0-9]+)?\s*[xX×]\s*[0-9]+(?:[.,][0-9]+)?\s*(?:mm|cm)?)$/iu.exec(source);
  if(!match) return {name:source,size:null};
  const size=parseCatalogSize(match[2],{defaultUnit});
  return size.ok&&!size.missing?{name:match[1],size}:{name:source,size:null};
}

function splitTrailingSurface(name,explicitSurface){
  const source=normalizeCatalogText(name);
  const markers=[...SURFACE_ALIASES.keys()].sort((a,b)=>b.length-a.length);
  for(const marker of markers){
    const escaped=marker.replace(/[.*+?^${}()|[\]\\]/gu,"\\$&");
    const match=new RegExp(`^(.*?)\\s+${escaped}$`,"iu").exec(source);
    if(!match) continue;
    const inferred=normalizeCatalogSurface(marker);
    if(explicitSurface&&inferred!==explicitSurface) return {name:source,surface:explicitSurface,inferred_surface:null,conflict:false};
    return {name:match[1],surface:explicitSurface||inferred,inferred_surface:inferred,conflict:false};
  }
  return {name:source,surface:explicitSurface||null,inferred_surface:null,conflict:false};
}

export function canonicalizeCatalogRow(input,{defaultSizeUnit=null,nameSizeUnit=defaultSizeUnit||"mm"}={}){
  const issues=[];
  const warnings=[];
  const rawName=collapseWhitespace(input.product_name??input.name??"");
  const explicitSurface=normalizeCatalogSurface(input.surface);
  const nameSize=splitTrailingSize(rawName,nameSizeUnit);
  const surfaceSplit=splitTrailingSurface(nameSize.name,explicitSurface);
  const structuredSize=parseCatalogSize(input.size,{defaultUnit:defaultSizeUnit});
  let size=structuredSize;

  if(!structuredSize.ok) issues.push({code:structuredSize.code,field:"size"});
  if((structuredSize.ok&&structuredSize.missing)&&nameSize.size) size=nameSize.size;
  if(structuredSize.ok&&!structuredSize.missing&&nameSize.size
     &&(structuredSize.width_mm!==nameSize.size.width_mm||structuredSize.height_mm!==nameSize.size.height_mm)){
    issues.push({code:"NAME_SIZE_CONFLICT",field:"size"});
  }
  if(surfaceSplit.conflict) issues.push({code:"NAME_SURFACE_CONFLICT",field:"surface"});

  const price=parseCatalogVnd(input.price_per_m2);
  if(!price.ok) issues.push({code:price.code,field:"price_per_m2"});
  else if(price.missing) issues.push({code:"MISSING_PRICE",field:"price_per_m2"});
  if(!surfaceSplit.name) issues.push({code:"MISSING_NAME",field:"product_name"});
  if(size.ok&&size.missing) issues.push({code:"MISSING_SIZE",field:"size"});

  const disposition=issues.some(issue=>issue.code==="MISSING_PRICE")&&!issues.some(issue=>issue.code!=="MISSING_PRICE")
    ?"MISSING_PRICE"
    :issues.length?"MANUAL_REVIEW":"READY";

  return {
    ...input,
    product_id:nullIfBlank(input.product_id),
    source_id:nullIfBlank(input.source_id),
    sku:nullIfBlank(input.sku),
    sku_normalized:normalizeCode(input.sku)||null,
    product_name:normalizeCatalogText(surfaceSplit.name),
    name_normalized:normalizeCatalogName(surfaceSplit.name),
    width_mm:size.ok&&!size.missing?size.width_mm:null,
    height_mm:size.ok&&!size.missing?size.height_mm:null,
    source_size_text:size.ok?size.source_size_text:collapseWhitespace(input.size)||null,
    source_size_unit:size.ok?size.source_size_unit:null,
    surface:surfaceSplit.surface,
    surface_normalized:surfaceSplit.surface,
    price_per_m2:price.ok?price.value:null,
    issues,
    warnings,
    disposition
  };
}

function nullIfBlank(value){
  const normalized=collapseWhitespace(value);
  return normalized||null;
}

export function catalogVariantKey(row){
  if(!row.name_normalized||!row.width_mm||!row.height_mm) return null;
  return `${row.name_normalized}|${row.width_mm}|${row.height_mm}|${row.surface_normalized||""}`;
}

function warning(row,code,details={}){
  if(row.warnings.some(item=>item.code===code&&JSON.stringify(item.details||{})===JSON.stringify(details))) return;
  row.warnings.push({code,details});
}

export function classifyCatalogDuplicates(inputRows){
  const rows=inputRows.map(row=>({...row,issues:[...(row.issues||[])],warnings:[...(row.warnings||[])]}));
  const byVariant=new Map();
  for(const row of rows){
    const key=catalogVariantKey(row);
    if(!key) continue;
    const members=byVariant.get(key)||[];
    members.push(row);byVariant.set(key,members);
  }
  const duplicateGroups=[];
  for(const [key,members] of byVariant){
    const priced=members.filter(row=>row.price_per_m2!==null);
    const prices=[...new Set(priced.map(row=>row.price_per_m2))];
    if(prices.length>1){
      const id=`PRICE-CONFLICT-${duplicateGroups.length+1}`;
      for(const row of members){row.disposition="PRICE_CONFLICT";row.conflict_code="PRICE_CONFLICT";warning(row,"PRICE_CONFLICT",{prices});}
      duplicateGroups.push({id,key,kind:"PRICE_CONFLICT",prices,source_rows:members.map(row=>row.source_row_number)});
    }else if(priced.length>1){
      const id=`DUPLICATE-${duplicateGroups.length+1}`;
      priced.forEach((row,index)=>{
        row.duplicate_group_id=id;
        if(index>0){row.disposition="SKIP_DUPLICATE";row.duplicate_of_source_row=priced[0].source_row_number;}
      });
      duplicateGroups.push({id,key,kind:"IDENTICAL_PRICE",price:prices[0],source_rows:priced.map(row=>row.source_row_number)});
    }
  }

  const byNamePrice=new Map();
  for(const row of rows){
    if(!row.name_normalized||row.price_per_m2===null||!catalogVariantKey(row)) continue;
    const key=`${row.name_normalized}|${row.price_per_m2}`;
    const members=byNamePrice.get(key)||[];members.push(row);byNamePrice.set(key,members);
  }
  for(const members of byNamePrice.values()){
    const variants=new Set(members.map(catalogVariantKey));
    if(variants.size<2) continue;
    for(const row of members) warning(row,"SAME_PRICE_WARNING",{variant_count:variants.size});
  }
  return {rows,duplicate_groups:duplicateGroups};
}
