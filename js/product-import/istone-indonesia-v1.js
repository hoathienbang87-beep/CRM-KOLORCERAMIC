import {ERROR_CODES,PARSER_LIMITS,parserFailure,parserIssue} from "./contracts.js";
import {detectIstoneIndonesiaV1,extractDocumentMetadata,ISTONE_ADAPTER} from "./format-detector.js";
import {assignGroupRanges,extractExplicitGroups,extractRowAnchors,extractRowText,findUnanchoredRowText} from "./geometry.js";
import {extractSurfaceCandidate} from "./field-parsers.js";
import {normalizeCode,normalizeName} from "./normalization.js";
import {detectDuplicates} from "./duplicate-detector.js";
import {validateCode,validatePriceMath,validateRequired} from "./validation.js";

const GROUP_FIELDS=["source_size_text","source_size_unit","width_cm","height_cm","source_packaging_text","pieces_per_box","sqm_per_box","price_per_m2","price_per_box","price_per_piece"];
const EXPECTED_FIELDS=["pieces_per_box","sqm_per_box","price_per_m2","price_per_box","price_per_piece"];

function resultSummary(rows,groups,duplicates,batchWarnings){
  const mathStatus=status=>rows.filter(row=>row.validation.price_math.status===status).length;
  return {
    physical_rows:rows.length,
    stt_min:rows.length?Math.min(...rows.map(row=>row.stt)):null,
    stt_max:rows.length?Math.max(...rows.map(row=>row.stt)):null,
    unique_normalized_codes:new Set(rows.map(row=>row.code_normalized).filter(Boolean)).size,
    valid_minimum_rows:rows.filter(row=>row.validation.missing_required.length===0).length,
    invalid_rows:rows.filter(row=>row.classification==="INVALID").length,
    review_rows:rows.filter(row=>row.classification==="REVIEW"||row.classification==="DUPLICATE_IN_FILE").length,
    duplicate_participating_rows:rows.filter(row=>row.duplicate_group_id).length,
    duplicate_groups:duplicates.length,
    groups:groups.length,
    merged_groups:groups.filter(group=>group.visually_merged).length,
    single_row_groups:groups.filter(group=>!group.visually_merged).length,
    inherited_rows:rows.filter(row=>row.inherited_fields.length>0).length,
    exact_price_math:mathStatus("EXACT"),within_tolerance_price_math:mathStatus("WITHIN_TOLERANCE"),mismatched_price_math:mathStatus("MISMATCH"),
    recognized_surface_candidates:rows.filter(row=>row.surface_candidate).length,
    null_surface_candidates:rows.filter(row=>!row.surface_candidate).length,
    batch_warnings:batchWarnings.length
  };
}

export function parseIstoneGeometry(input,{sourceSha256=null,limits=PARSER_LIMITS}={}){
  const pages=Array.isArray(input?.pages)?input.pages:[];
  const items=Array.isArray(input?.items)?input.items:[];
  if(pages.length>limits.maxPages) return parserFailure(ERROR_CODES.PDF_TOO_MANY_PAGES,"PDF vượt giới hạn số trang.");
  if(items.length===0) return parserFailure(ERROR_CODES.TEXT_LAYER_UNAVAILABLE,"Không có geometry text items.");
  if(items.length>limits.maxTextItems) return parserFailure(ERROR_CODES.TEXT_LAYER_UNAVAILABLE,"Text layer vượt giới hạn an toàn.");
  const detection=detectIstoneIndonesiaV1(items,pages);
  if(!detection.ok) return parserFailure(detection.code,"Không nhận diện được adapter ISTONE an toàn.",{page:detection.page||null});
  const documentMetadata=extractDocumentMetadata(items);
  if(!documentMetadata.effective_date) return parserFailure(ERROR_CODES.EFFECTIVE_DATE_NOT_FOUND,"Không tìm thấy ngày hiệu lực rõ ràng.");

  const anchors=extractRowAnchors(items,ISTONE_ADAPTER);
  if(anchors.length>limits.maxRows) return parserFailure(ERROR_CODES.ROW_AMBIGUOUS,"Số Product row vượt giới hạn.");
  const batchWarnings=[];
  const discontinuityStt=new Set();
  if(anchors[0]?.stt!==1) batchWarnings.push(parserIssue("SOURCE_STT_STARTS_AT_2",{page:anchors[0]?.page||null,stt:anchors[0]?.stt||null,field:"stt",message:"STT nguồn không bắt đầu từ 1."}));
  for(let index=1;index<anchors.length;index++) if(anchors[index].stt!==anchors[index-1].stt+1){discontinuityStt.add(anchors[index].stt);batchWarnings.push(parserIssue("STT_DISCONTINUITY",{page:anchors[index].page,stt:anchors[index].stt,field:"stt",message:"STT nguồn có khoảng trống hoặc trùng."}));}

  const rows=[],groups=[];
  for(const page of pages){
    const pageRows=anchors.filter(row=>row.page===page.page);
    const pageItems=items.filter(item=>item.page===page.page);
    if(!pageRows.length) continue;
    if(findUnanchoredRowText(pageItems,pageRows,ISTONE_ADAPTER).length) return parserFailure(ERROR_CODES.ROW_AMBIGUOUS,"Có text code/name không thể gắn chắc chắn vào row anchor.",{page:page.page});
    const explicit=extractExplicitGroups(pageItems,pageRows,ISTONE_ADAPTER);
    const assigned=assignGroupRanges(pageRows,explicit,ISTONE_ADAPTER);
    if(!assigned.ok) return parserFailure(assigned.code,"Không thể chứng minh group boundary từ geometry.",{page:page.page});
    for(const group of assigned.groups){
      groups.push(group);
      const members=pageRows.filter(row=>row.stt>=group.first_stt&&row.stt<=group.last_stt);
      members.forEach((anchor,index)=>{
        const code=extractRowText(pageItems,anchor,ISTONE_ADAPTER.columnBoundaries[1],ISTONE_ADAPTER.columnBoundaries[2],ISTONE_ADAPTER);
        const name=extractRowText(pageItems,anchor,ISTONE_ADAPTER.columnBoundaries[2],ISTONE_ADAPTER.columnBoundaries[3],ISTONE_ADAPTER);
        const warnings=[];
        const inheritedFields=index===0?[]:["size","packaging","price_per_m2","price_per_box","price_per_piece"];
        if(inheritedFields.length) warnings.push(parserIssue("INHERITED_GROUP_VALUE",{page:anchor.page,stt:anchor.stt,message:`Giá trị group kế thừa từ STT ${group.first_stt}.`}));
        if(discontinuityStt.has(anchor.stt)) warnings.push(parserIssue("STT_DISCONTINUITY",{page:anchor.page,stt:anchor.stt,field:"stt",message:"STT nguồn có khoảng trống hoặc trùng."}));
        const row={
          source_page:anchor.page,source_row_number:anchor.stt,stt:anchor.stt,
          code,code_normalized:normalizeCode(code),name,name_normalized:normalizeName(name),
          ...Object.fromEntries(GROUP_FIELDS.map(field=>[field,group[field]??null])),
          surface_candidate:extractSurfaceCandidate(name),origin_candidate:null,
          inherited_fields:inheritedFields,inherited_from_stt:inheritedFields.length?group.first_stt:null,
          warnings,validation:null,duplicate_group_id:null,duplicate_kind:null,classification:"VALID",
          group_first_stt:group.first_stt,group_last_stt:group.last_stt
        };
        const missingRequired=validateRequired(row);
        const invalidCode=!validateCode(row.code);
        const priceMath=validatePriceMath(row);
        const missingExpected=EXPECTED_FIELDS.filter(field=>!row[field]);
        for(const field of missingExpected) warnings.push(parserIssue(ERROR_CODES.EXPECTED_FIELD_MISSING,{page:anchor.page,stt:anchor.stt,field,message:"Thiếu trường được kỳ vọng trong ISTONE adapter."}));
        if(priceMath.status==="MISMATCH") warnings.push(parserIssue(ERROR_CODES.PRICE_MATH_MISMATCH,{page:anchor.page,stt:anchor.stt,field:"prices",message:"Giá nguồn không khớp phép tính package chính xác."}));
        for(const field of missingRequired) warnings.push(parserIssue(ERROR_CODES.MISSING_REQUIRED_FIELD,{page:anchor.page,stt:anchor.stt,field,message:"Thiếu trường Product bắt buộc."}));
        if(invalidCode) warnings.push(parserIssue(ERROR_CODES.INVALID_CODE,{page:anchor.page,stt:anchor.stt,field:"code",message:"Mã Product không hợp lệ."}));
        row.validation={missing_required:missingRequired,missing_expected:missingExpected,invalid_code:invalidCode,price_math:priceMath};
        if(missingRequired.length||invalidCode) row.classification="INVALID";
        else if(missingExpected.length||priceMath.status==="MISMATCH"||group.parse_errors.length||discontinuityStt.has(anchor.stt)) row.classification="REVIEW";
        rows.push(row);
      });
    }
  }
  const duplicates=detectDuplicates(rows);
  const metadata={adapter:detection.adapter,adapter_version:detection.adapter_version,source_sha256:sourceSha256,page_count:pages.length,supplier:documentMetadata.supplier,effective_date:documentMetadata.effective_date,origin_candidate:documentMetadata.origin_candidate,origin_confirmed:false,warnings:batchWarnings};
  return {ok:true,metadata,rows,groups:groups.map(group=>({page:group.page,first_stt:group.first_stt,last_stt:group.last_stt,row_count:group.row_count,source_size_text:group.source_size_text,source_size_unit:group.source_size_unit,width_cm:group.width_cm,height_cm:group.height_cm,source_packaging_text:group.source_packaging_text,pieces_per_box:group.pieces_per_box,sqm_per_box:group.sqm_per_box,price_per_m2:group.price_per_m2,price_per_box:group.price_per_box,price_per_piece:group.price_per_piece,visually_merged:group.visually_merged})),duplicates,summary:resultSummary(rows,groups,duplicates,batchWarnings)};
}
