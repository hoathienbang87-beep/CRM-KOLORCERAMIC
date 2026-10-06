import {canonicalizeCatalogRow,catalogVariantKey,normalizeCatalogName} from "./catalog-records.js";
import {normalizeCode} from "./normalization.js";

function add(map,key,value){
  if(!key) return;
  const values=map.get(key)||[];values.push(value);map.set(key,values);
}

function unique(values){return [...new Map(values.map(value=>[value.id,value])).values()];}

function candidate(product){return {id:product.id,code:product.code??product.sku??null,name:product.product_name,surface:product.surface,width_mm:product.width_mm,height_mm:product.height_mm};}

function normalizedProduct(product){
  const structuredSize=product.width_mm&&product.height_mm
    ?`${product.width_mm}x${product.height_mm} mm`
    :product.width_cm&&product.height_cm
      ?`${product.width_cm}x${product.height_cm} cm`
      :product.size;
  const row=canonicalizeCatalogRow({
    product_id:product.id,
    sku:product.code??product.sku,
    product_name:product.name??product.product_name,
    size:structuredSize,
    surface:product.surface,
    price_per_m2:product.price_per_m2
  },{defaultSizeUnit:"mm"});
  return {...product,...row,id:String(product.id),product_name:row.product_name};
}

export function buildCatalogMatchIndex(products,sourceMappings=[]){
  const normalized=products.map(normalizedProduct);
  const byId=new Map();
  const bySourceId=new Map();
  const bySku=new Map();
  const byVariant=new Map();
  const byNameSize=new Map();
  for(const product of normalized){
    add(byId,product.id,product);
    add(bySku,product.sku_normalized,product);
    add(byVariant,catalogVariantKey(product),product);
    if(product.name_normalized&&product.width_mm&&product.height_mm) add(byNameSize,`${product.name_normalized}|${product.width_mm}|${product.height_mm}`,product);
    for(const sourceId of product.source_ids||[]) add(bySourceId,String(sourceId),product);
  }
  for(const mapping of sourceMappings){
    const product=byId.get(String(mapping.product_id))?.[0];
    if(product&&mapping.source_id) add(bySourceId,String(mapping.source_id),product);
  }
  return {products:normalized,byId,bySourceId,bySku,byVariant,byNameSize};
}

function levenshtein(a,b){
  const previous=Array.from({length:b.length+1},(_,index)=>index);
  for(let i=1;i<=a.length;i++){
    let diagonal=previous[0];previous[0]=i;
    for(let j=1;j<=b.length;j++){
      const above=previous[j];
      previous[j]=Math.min(previous[j]+1,previous[j-1]+1,diagonal+(a[i-1]===b[j-1]?0:1));
      diagonal=above;
    }
  }
  return previous[b.length];
}

export function catalogNameSimilarity(a,b){
  const left=normalizeCatalogName(a),right=normalizeCatalogName(b);
  if(!left&&!right) return 1;
  if(!left||!right) return 0;
  return 1-levenshtein(left,right)/Math.max(left.length,right.length);
}

function matched(rule,product){return {status:"MATCHED",match_rule:rule,product_id:product.id,candidates:[candidate(product)],suggestions:[]};}

export function matchCatalogRow(input,index,{fuzzyThreshold=0.65}={}){
  const row=input.name_normalized!==undefined?input:canonicalizeCatalogRow(input,{defaultSizeUnit:"mm"});
  const ambiguous=[];
  const exactId=row.product_id?index.byId.get(String(row.product_id))||[]:[];
  if(exactId.length===1) return matched("PRODUCT_ID",exactId[0]);
  if(exactId.length>1) ambiguous.push(...exactId);

  const sourceId=row.source_id?index.bySourceId.get(String(row.source_id))||[]:[];
  if(sourceId.length===1) return matched("SOURCE_ID",sourceId[0]);
  if(sourceId.length>1) ambiguous.push(...sourceId);

  const sku=row.sku_normalized?index.bySku.get(row.sku_normalized)||[]:[];
  if(sku.length===1) return matched("SKU",sku[0]);
  if(sku.length>1) ambiguous.push(...sku);

  const nameSizeKey=row.name_normalized&&row.width_mm&&row.height_mm?`${row.name_normalized}|${row.width_mm}|${row.height_mm}`:null;
  const nameSize=nameSizeKey?index.byNameSize.get(nameSizeKey)||[]:[];
  if(row.surface_normalized){
    const variant=index.byVariant.get(catalogVariantKey(row))||[];
    if(variant.length===1) return matched("NAME_SIZE_SURFACE",variant[0]);
    if(variant.length>1) ambiguous.push(...variant);
    if(nameSize.length===1&&(!nameSize[0].surface_normalized||nameSize[0].surface_normalized===row.surface_normalized)) return matched("NAME_SIZE",nameSize[0]);
    if(nameSize.length>0) ambiguous.push(...nameSize);
  }else{
    if(nameSize.length===1) return matched("NAME_SIZE",nameSize[0]);
    if(nameSize.length>1) ambiguous.push(...nameSize);
  }

  const uniqueAmbiguous=unique(ambiguous);
  if(uniqueAmbiguous.length>1) return {status:"AMBIGUOUS",match_rule:"MANUAL",product_id:null,candidates:uniqueAmbiguous.map(candidate),suggestions:[]};

  const suggestions=index.products
    .filter(product=>!row.width_mm||!row.height_mm||(product.width_mm===row.width_mm&&product.height_mm===row.height_mm))
    .map(product=>({product,score:catalogNameSimilarity(row.name_normalized,product.name_normalized)}))
    .filter(item=>item.score>=fuzzyThreshold)
    .sort((a,b)=>b.score-a.score||a.product.id.localeCompare(b.product.id))
    .slice(0,5)
    .map(item=>({...candidate(item.product),score:Number(item.score.toFixed(4))}));
  return {status:"UNMATCHED",match_rule:suggestions.length?"FUZZY_SUGGESTION":"MANUAL",product_id:null,candidates:uniqueAmbiguous.map(candidate),suggestions};
}

export function dryRunCatalogMatching(rows,products,sourceMappings=[]){
  const index=buildCatalogMatchIndex(products,sourceMappings);
  const results=rows.map(row=>({...row,match:matchCatalogRow(row,index)}));
  return {
    rows:results,
    summary:{
      total:results.length,
      matched:results.filter(row=>row.match.status==="MATCHED").length,
      ambiguous:results.filter(row=>row.match.status==="AMBIGUOUS").length,
      unmatched:results.filter(row=>row.match.status==="UNMATCHED").length,
      fuzzy_suggestions:results.filter(row=>row.match.match_rule==="FUZZY_SUGGESTION").length
    }
  };
}
