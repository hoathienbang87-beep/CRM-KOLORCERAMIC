import {formatExactDecimal,parseExactDecimal} from "./exact-decimal.js";
import {collapseWhitespace} from "./normalization.js";

export function parseDimensions(value,{defaultUnit=null}={}){
  const source=collapseWhitespace(value);
  const match=/^([0-9]+(?:[.,][0-9]+)?)\s*[x×]\s*([0-9]+(?:[.,][0-9]+)?)\s*(cm|mm)?$/iu.exec(source);
  if(!match) return {ok:false,code:"INVALID_SIZE"};
  const unit=(match[3]||defaultUnit||"").toLowerCase();
  if(!unit||!['cm','mm'].includes(unit)) return {ok:false,code:"UNKNOWN_SIZE_UNIT"};
  const width=parseExactDecimal(match[1],{maxScale:3});
  const height=parseExactDecimal(match[2],{maxScale:3});
  if(!width||!height) return {ok:false,code:"INVALID_SIZE"};
  const toCm=part=>unit==='cm'?part.text:formatExactDecimal(part.units,part.scale+1);
  return {ok:true,source_size_text:source,source_size_unit:unit,width_cm:toCm(width),height_cm:toCm(height)};
}

export function mmToCm(value){
  const parsed=parseExactDecimal(value,{maxScale:3});
  return parsed?formatExactDecimal(parsed.units,parsed.scale+1):null;
}

export function parseVnd(value){
  const source=collapseWhitespace(value);
  if(!/^(?:[1-9]\d*|[1-9]\d{0,2}(?:\.\d{3})+)$/u.test(source)) return null;
  const integer=source.replaceAll(".","");
  return integer!=="0"?integer:null;
}

export function parseSqm(value){
  const parsed=parseExactDecimal(String(value??"").replace(",","."),{maxScale:4});
  return parsed?.text||null;
}

export function parsePackaging(value){
  const source=collapseWhitespace(value);
  const match=/^([1-9]\d*)\s*v\s*=\s*([0-9]+(?:[.,][0-9]+)?)\s*m(?:2|²)$/iu.exec(source);
  if(!match) return {ok:false,code:"INVALID_PACKAGING"};
  const sqm=parseSqm(match[2]);
  if(!sqm) return {ok:false,code:"INVALID_PACKAGING"};
  return {ok:true,source_packaging_text:source,pieces_per_box:match[1],sqm_per_box:sqm};
}

export function extractSurfaceCandidate(name){
  const matches=collapseWhitespace(name).toUpperCase().match(/(?:^|\s)(MATT|GLOSSY|SATIN)(?=\s|,|$)/gu)||[];
  if(matches.length!==1) return null;
  return matches[0].trim();
}
