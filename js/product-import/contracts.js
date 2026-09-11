export const PARSER_LIMITS = Object.freeze({
  maxFileBytes: 20 * 1024 * 1024,
  maxPages: 50,
  maxRows: 5000,
  maxTextItems: 200000
});

export const ERROR_CODES = Object.freeze({
  UNKNOWN_FORMAT:"UNKNOWN_FORMAT",
  PDF_ENCRYPTED:"PDF_ENCRYPTED",
  PDF_TOO_LARGE:"PDF_TOO_LARGE",
  PDF_TOO_MANY_PAGES:"PDF_TOO_MANY_PAGES",
  TEXT_LAYER_UNAVAILABLE:"TEXT_LAYER_UNAVAILABLE",
  TABLE_HEADER_NOT_FOUND:"TABLE_HEADER_NOT_FOUND",
  COLUMN_GEOMETRY_INVALID:"COLUMN_GEOMETRY_INVALID",
  ROW_AMBIGUOUS:"ROW_AMBIGUOUS",
  MISSING_REQUIRED_FIELD:"MISSING_REQUIRED_FIELD",
  INVALID_CODE:"INVALID_CODE",
  INVALID_SIZE:"INVALID_SIZE",
  UNKNOWN_SIZE_UNIT:"UNKNOWN_SIZE_UNIT",
  INVALID_PRICE:"INVALID_PRICE",
  INVALID_PACKAGING:"INVALID_PACKAGING",
  PRICE_MATH_MISMATCH:"PRICE_MATH_MISMATCH",
  DUPLICATE_CODE:"DUPLICATE_CODE",
  EFFECTIVE_DATE_NOT_FOUND:"EFFECTIVE_DATE_NOT_FOUND",
  EXPECTED_FIELD_MISSING:"EXPECTED_FIELD_MISSING"
});

export function parserIssue(code,{page=null,stt=null,field=null,message=""}={}){
  return {code,page,stt,field,message};
}

export function parserFailure(code,message,context={}){
  return {
    ok:false,
    error:parserIssue(code,{...context,message}),
    metadata:null,
    rows:[],
    groups:[],
    duplicates:[],
    summary:{physical_rows:0}
  };
}
