// Private/local acceptance harness. Node file I/O stays outside the browser parser core.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {performance} from "node:perf_hooks";
import {parseIstoneGeometry,parseIstonePdf} from "../js/product-import/index.js";

const cli=Object.fromEntries(process.argv.slice(2).map(arg=>arg.startsWith("--")&&arg.includes("=")?arg.slice(2).split(/=(.*)/s).slice(0,2):[]).filter(pair=>pair.length===2));
const config={
  pdf:cli.pdf||process.env.PRODUCT_R2_PDF_PATH,
  geometry:cli.geometry||process.env.PRODUCT_R2_GEOMETRY_PATH,
  expected:cli.expected||process.env.PRODUCT_R2_EXPECTED_PATH,
  pdfjs:cli.pdfjs||process.env.PRODUCT_R2_PDFJS_ENTRY,
  outputDir:cli.output||process.env.PRODUCT_R2_PRIVATE_OUTPUT_DIR
};
for(const [key,value] of Object.entries(config)) if(!value) throw new Error(`MISSING_LOCAL_ARGUMENT:${key}`);
for(const [key,value] of Object.entries(config)) if(key!=="outputDir"&&!fs.existsSync(value)) throw new Error(`LOCAL_FILE_NOT_FOUND:${key}`);
if(path.resolve(config.outputDir).startsWith(path.resolve(process.cwd())+path.sep)) throw new Error("PRIVATE_OUTPUT_MUST_BE_OUTSIDE_REPOSITORY");
fs.mkdirSync(config.outputDir,{recursive:true});

const pdfBytes=fs.readFileSync(config.pdf);
const sourceSha256=crypto.createHash("sha256").update(pdfBytes).digest("hex").toUpperCase();
const expected=JSON.parse(fs.readFileSync(config.expected,"utf8"));
const geometry=JSON.parse(fs.readFileSync(config.geometry,"utf8"));

const project=rows=>rows.map(row=>({
  source_page:row.source_page,source_row:row.source_row_number,stt:row.stt,code:row.code,code_normalized:row.code_normalized,
  name:row.name,name_normalized:row.name_normalized,source_size_text:row.source_size_text,source_size_unit:row.source_size_unit,
  width_cm:row.width_cm,height_cm:row.height_cm,pieces_per_box:row.pieces_per_box,sqm_per_box:row.sqm_per_box,
  packaging_text:row.source_packaging_text,price_per_m2:row.price_per_m2,price_per_box:row.price_per_box,price_per_piece:row.price_per_piece,
  surface_candidate:row.surface_candidate,origin_candidate:row.origin_candidate,warnings:row.warnings.map(warning=>warning.code),
  group_first_stt:row.group_first_stt,group_last_stt:row.group_last_stt
}));

function compareRows(label,actualRows,expectedRows){
  const actual=project(actualRows),diffs=[];
  const stringFields=new Set(["pieces_per_box","price_per_m2","price_per_box","price_per_piece"]);
  for(let index=0;index<Math.max(actual.length,expectedRows.length);index++){
    const left=actual[index],right=expectedRows[index];
    if(!left||!right){diffs.push({label,index,reason:"ROW_COUNT"});continue;}
    for(const key of Object.keys(right)){
      const expectedValue=stringFields.has(key)&&right[key]!=null?String(right[key]):right[key];
      if(JSON.stringify(left[key])!==JSON.stringify(expectedValue)) diffs.push({label,index,stt:right.stt,field:key,expected:expectedValue,actual:left[key]});
    }
  }
  return diffs;
}

const coreStart=performance.now();
const coreResult=parseIstoneGeometry(geometry,{sourceSha256});
const coreMs=performance.now()-coreStart;
if(!coreResult.ok) throw new Error(`PRIVATE_GEOMETRY_PARSE_FAILED:${coreResult.error.code}`);
const coreDiffs=compareRows("geometry",coreResult.rows,expected.rows);

const pdfjs=await import(pathToFileURL(path.resolve(config.pdfjs)).href);
if(pdfjs.version!=="6.3.289") throw new Error(`PDFJS_VERSION_MISMATCH:${pdfjs.version}`);
const binaryStart=performance.now();
const binaryResult=await parseIstonePdf(new Uint8Array(pdfBytes),pdfjs,{sourceSha256});
const binaryMs=performance.now()-binaryStart;
if(!binaryResult.ok) throw new Error(`BINARY_PDF_PARSE_FAILED:${binaryResult.error.code}`);
const binaryDiffs=compareRows("binary",binaryResult.rows,expected.rows);
const diffs=[...coreDiffs,...binaryDiffs];

const identicalDuplicate=binaryResult.duplicates.find(group=>group.kind==="IDENTICAL"&&JSON.stringify(group.stt)==="[67,69]");
const checks={
  source_sha256:sourceSha256===expected.metadata.sha256,page_count:binaryResult.metadata.page_count===2,physical_rows:binaryResult.summary.physical_rows===76,
  stt_range:binaryResult.summary.stt_min===2&&binaryResult.summary.stt_max===77,unique_codes:binaryResult.summary.unique_normalized_codes===75,
  groups:binaryResult.summary.groups===22,inherited_rows:binaryResult.summary.inherited_rows===54,minimum_valid:binaryResult.summary.valid_minimum_rows===76,
  invalid:binaryResult.summary.invalid_rows===0,duplicate_group:binaryResult.summary.duplicate_groups===1,duplicate_rows:binaryResult.summary.duplicate_participating_rows===2,
  duplicate_identical:Boolean(identicalDuplicate),exact_math:binaryResult.summary.exact_price_math===76,surface:binaryResult.summary.recognized_surface_candidates===71&&binaryResult.summary.null_surface_candidates===5,
  supplier:binaryResult.metadata.supplier==="ISTONE",effective_date:binaryResult.metadata.effective_date==="2026-09-03",origin_candidate:binaryResult.metadata.origin_candidate==="Indonesia"&&binaryResult.metadata.origin_confirmed===false,
  cross_page_inheritance:binaryResult.rows.every(row=>!row.inherited_from_stt||binaryResult.rows.some(source=>source.stt===row.inherited_from_stt&&source.source_page===row.source_page)),
  field_by_field_diff:diffs.length===0
};
const acceptance=Object.values(checks).every(Boolean);
const parserOutputPath=path.join(config.outputDir,"parser-output.local.json");
const diffPath=path.join(config.outputDir,"oracle-diff.local.json");
const summaryPath=path.join(config.outputDir,"acceptance-summary.private.json");
fs.writeFileSync(parserOutputPath,JSON.stringify(binaryResult,null,2));
fs.writeFileSync(diffPath,JSON.stringify({difference_count:diffs.length,differences:diffs},null,2));
const summary={acceptance,pdfjs_version:pdfjs.version,file_size_bytes:pdfBytes.length,page_count:binaryResult.metadata.page_count,text_items:binaryResult.metadata.text_item_count,parse_time_ms:Number(binaryMs.toFixed(2)),geometry_core_time_ms:Number(coreMs.toFixed(2)),normalized_rows:binaryResult.summary.physical_rows,difference_count:diffs.length,checks};
fs.writeFileSync(summaryPath,JSON.stringify(summary,null,2));
const fileEvidence=Object.fromEntries([parserOutputPath,diffPath,summaryPath].map(file=>[path.basename(file),{bytes:fs.statSync(file).size,sha256:crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase()}]));
console.log(JSON.stringify({acceptance,pdfjs_version:pdfjs.version,file_size_bytes:pdfBytes.length,pages:binaryResult.metadata.page_count,rows:binaryResult.summary.physical_rows,unique_codes:binaryResult.summary.unique_normalized_codes,groups:binaryResult.summary.groups,inherited_rows:binaryResult.summary.inherited_rows,invalid:binaryResult.summary.invalid_rows,review_rows:binaryResult.summary.review_rows,duplicate_groups:binaryResult.summary.duplicate_groups,exact_math:binaryResult.summary.exact_price_math,surface_candidates:binaryResult.summary.recognized_surface_candidates,field_differences:diffs.length,parse_time_ms:summary.parse_time_ms,evidence:fileEvidence},null,2));
if(!acceptance) process.exitCode=1;
