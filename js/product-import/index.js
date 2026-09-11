export {PARSER_LIMITS,ERROR_CODES} from "./contracts.js";
export {normalizeCode,normalizeName} from "./normalization.js";
export {parseDimensions,mmToCm,parseVnd,parseSqm,parsePackaging,extractSurfaceCandidate} from "./field-parsers.js";
export {detectIstoneIndonesiaV1,ISTONE_ADAPTER} from "./format-detector.js";
export {extractPdfGeometry} from "./pdf-extractor.js";
export {validateCode,validatePriceMath} from "./validation.js";
export {detectDuplicates} from "./duplicate-detector.js";
export {extractRowAnchors,extractExplicitGroups,assignGroupRanges,findUnanchoredRowText} from "./geometry.js";
export {parseIstoneGeometry} from "./istone-indonesia-v1.js";

import {extractPdfGeometry} from "./pdf-extractor.js";
import {parseIstoneGeometry} from "./istone-indonesia-v1.js";

export async function parseIstonePdf(pdfBytes,pdfjs,options={}){
  const geometry=await extractPdfGeometry(pdfBytes,pdfjs,options);
  if(!geometry.ok) return geometry;
  const result=parseIstoneGeometry(geometry,options);
  if(result.ok){
    result.metadata.text_item_count=geometry.items.length;
    result.metadata.pages=geometry.pages;
  }
  return result;
}
