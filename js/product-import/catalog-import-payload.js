import {dryRunCatalogMatching} from "./catalog-matching.js";

function compactObject(value){
  return Object.fromEntries(Object.entries(value).filter(([,item])=>item!==null&&item!==undefined&&item!==""));
}

function warningCodes(row){
  return [...new Set((row.warnings||[]).map(item=>typeof item==="string"?item:item?.code).filter(Boolean))];
}

function sourceFields(row){
  return {
    source_page:1,
    source_row_number:row.source_row_number,
    source_sheet:row.source_sheet??null,
    source_cell_ref:row.source_cell_ref??null,
    source_record_id:row.source_id??null,
    source_values:row.raw_values??{},
    source_size_text:row.source_size_text??null,
    source_size_unit:row.source_size_unit??null,
    code:row.sku??null,
    name:row.product_name??null,
    width_mm:row.width_mm??null,
    height_mm:row.height_mm??null,
    surface:row.surface??null,
    match_rule:row.match?.match_rule??null,
    warnings:warningCodes(row)
  };
}

function productById(products){return new Map(products.map(product=>[String(product.id),product]));}

function priceString(value){return value===null||value===undefined||value===""?null:String(value);}

function createSnapshot(row,effectiveDate){
  return compactObject({
    code:row.sku,
    name:row.product_name,
    width_mm:row.width_mm,
    height_mm:row.height_mm,
    surface:row.surface,
    price_per_m2:row.price_per_m2,
    price_effective_date:row.price_per_m2?effectiveDate:null,
    active:true,
    is_published:false,
    source_metadata:{source_sheet:row.source_sheet??null,source_row_number:row.source_row_number??null}
  });
}

function updateSnapshot(row,effectiveDate,mode){
  if(mode==="PRICE_UPDATE_ONLY"){
    return compactObject({price_per_m2:row.price_per_m2,price_effective_date:row.price_per_m2?effectiveDate:null});
  }
  return createSnapshot(row,effectiveDate);
}

function rpcRow(row,productsById,mode,effectiveDate){
  const base=sourceFields(row);
  if(row.disposition==="PRICE_CONFLICT"||row.conflict_code==="PRICE_CONFLICT"){
    return {...base,classification:"CONFLICT",disposition:"CONFLICT",conflict_code:"PRICE_CONFLICT",selected_action:"NONE",proposed_snapshot:{}};
  }
  if(row.disposition==="SKIP_DUPLICATE"){
    return {...base,classification:"DUPLICATE_IN_FILE",disposition:"DUPLICATE",conflict_code:"IDENTICAL_VARIANT_PRICE",selected_action:"SKIP",proposed_snapshot:{}};
  }
  if(row.match.status==="AMBIGUOUS"){
    return {...base,classification:"CONFLICT",disposition:"CONFLICT",conflict_code:"MULTIPLE_MATCH_CANDIDATES",selected_action:"NONE",proposed_snapshot:{}};
  }

  if(row.match.status==="MATCHED"){
    const target=productsById.get(String(row.match.product_id));
    if(!target){
      return {...base,classification:"CONFLICT",disposition:"CONFLICT",conflict_code:"MATCH_TARGET_MISSING",selected_action:"NONE",proposed_snapshot:{}};
    }
    if(row.price_per_m2===null){
      return {...base,classification:"UNCHANGED",disposition:"MISSING_PRICE",conflict_code:"MISSING_PRICE_SKIPPED",selected_action:"SKIP",matched_product_id:String(target.id),current_product_version:target.version,proposed_snapshot:{}};
    }
    const unchanged=priceString(target.price_per_m2)===priceString(row.price_per_m2);
    return {
      ...base,
      classification:unchanged?"UNCHANGED":"CHANGED",
      disposition:"READY",
      selected_action:unchanged?"SKIP":"UPDATE",
      matched_product_id:String(target.id),
      current_product_version:target.version,
      proposed_snapshot:unchanged?{}:updateSnapshot(row,effectiveDate,mode)
    };
  }

  if(mode==="PRICE_UPDATE_ONLY"){
    return {...base,classification:"CONFLICT",disposition:"CONFLICT",conflict_code:"PRICE_ONLY_UNMATCHED",selected_action:"NONE",proposed_snapshot:{}};
  }
  if(!row.product_name){
    return {...base,classification:"INVALID",disposition:"MANUAL_REVIEW",conflict_code:"NAME_REQUIRED",selected_action:"NONE",proposed_snapshot:{}};
  }
  const ready=Boolean(row.width_mm&&row.height_mm&&row.price_per_m2&&effectiveDate);
  return {
    ...base,
    classification:"NEW",
    disposition:ready?"READY":"UPDATING",
    selected_action:"CREATE",
    proposed_snapshot:createSnapshot(row,effectiveDate)
  };
}

export function buildCatalogImportPreview({batch,rows,products,sourceMappings=[]}){
  if(!batch||!Array.isArray(rows)||!Array.isArray(products)) throw new TypeError("batch, rows and products are required");
  const mode=String(batch.import_mode||"PRICE_UPDATE_ONLY").toUpperCase();
  if(!["PRICE_UPDATE_ONLY","CATALOG_IMPORT"].includes(mode)) throw new TypeError("unsupported catalog import mode");
  if(!batch.effective_date) throw new TypeError("effective_date is required");
  const matching=dryRunCatalogMatching(rows,products,sourceMappings);
  const byId=productById(products);
  return {
    batch:{...batch,import_mode:mode,source_format:String(batch.source_format||"EXCEL").toUpperCase()},
    rows:matching.rows.map(row=>rpcRow(row,byId,mode,batch.effective_date)),
    matching_summary:matching.summary
  };
}
