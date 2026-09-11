import assert from "node:assert/strict";
import {createPageResetFailureGeometry,createSyntheticIstoneGeometry,createUnknownGeometry,createWrappedNameAmbiguityGeometry} from "./fixtures/product-r2-parser-synthetic.mjs";
import {detectDuplicates,detectIstoneIndonesiaV1,extractPdfGeometry,extractSurfaceCandidate,mmToCm,normalizeCode,normalizeName,parseDimensions,parseIstoneGeometry,parsePackaging,parseSqm,parseVnd,validateCode,validatePriceMath} from "../js/product-import/index.js";
import {handleParserWorkerRequest,PRODUCT_PARSER_WORKER_PROTOCOL} from "../js/product-import/worker-protocol.js";

let checks=0;
const equal=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const truthy=(actual,message)=>{assert.ok(actual,message);checks++;};

equal(normalizeCode("  ab-1 / x.y  "),"AB-1 / X.Y","normalizeCode keeps punctuation");
equal(normalizeName(" A,  B ,C "),"A,B,C","normalizeName canonical comma spacing");
truthy(validateCode("AB-1 / X.Y"),"valid code keeps conservative punctuation");
equal(validateCode("bad\u0001code"),false,"control characters invalidate code");
equal(mmToCm("75"),"7.5","75 mm to cm");
equal(parseDimensions("75 × 300 mm"),{ok:true,source_size_text:"75 × 300 mm",source_size_unit:"mm",width_cm:"7.5",height_cm:"30"},"decimal mm dimensions");
equal(parseDimensions("600x1200 mm").width_cm,"60","600 mm width");
equal(parseDimensions("600x1200 mm").height_cm,"120","1200 mm height");
equal(parseDimensions("60 x 120",{defaultUnit:"cm"}).width_cm,"60","header cm context");
equal(parseDimensions("600x1200").code,"UNKNOWN_SIZE_UNIT","unit cannot be guessed from magnitude");
equal(parseVnd("760.000"),"760000","grouped VND");
equal(parseVnd("760000"),"760000","plain VND");
for(const invalid of ["76.0000","760,000","760.000,5","-760.000","0"]) equal(parseVnd(invalid),null,`reject malformed VND ${invalid}`);
equal(parseSqm("1,44"),"1.44","exact sqm");
equal(parsePackaging(" 2v = 1,44m2 "),{ok:true,source_packaging_text:"2v = 1,44m2",pieces_per_box:"2",sqm_per_box:"1.44"},"package parser");
equal(extractSurfaceCandidate("SERIES GLOSSY A"),"GLOSSY","surface token");
equal(extractSurfaceCandidate("GLOSSYISH SERIES"),null,"surface must be independent token");

const synthetic=createSyntheticIstoneGeometry();
truthy(detectIstoneIndonesiaV1(synthetic.items,synthetic.pages).ok,"detect ISTONE markers and geometry");
const parsed=parseIstoneGeometry(synthetic);
truthy(parsed.ok,"synthetic parse succeeds");
equal(parsed.summary.physical_rows,5,"synthetic physical rows");
equal(parsed.summary.groups,3,"merged and single groups");
equal(parsed.summary.inherited_rows,2,"merged group provenance");
equal(parsed.summary.duplicate_groups,1,"identical duplicate group");
equal(parsed.duplicates[0].kind,"IDENTICAL","identical duplicate classified");
equal(parsed.rows.find(row=>row.stt===5).width_cm,"7.5","explicit mm normalized without float");
equal(parsed.rows.find(row=>row.stt===6).height_cm,"120","page 2 mm normalized");
equal(parsed.metadata.effective_date,"2099-09-03","canonical effective date serialization");
equal(JSON.parse(JSON.stringify(parsed)).summary.physical_rows,5,"result is JSON serializable");

const conflicting=[
  {source_page:1,source_row_number:1,stt:1,code_normalized:"SYN-X",name_normalized:"X",width_cm:"10",height_cm:"10",price_per_m2:"100",price_per_box:"100",price_per_piece:"100",pieces_per_box:"1",sqm_per_box:"1",warnings:[],classification:"VALID"},
  {source_page:1,source_row_number:2,stt:2,code_normalized:"SYN-X",name_normalized:"X",width_cm:"10",height_cm:"10",price_per_m2:"101",price_per_box:"101",price_per_piece:"101",pieces_per_box:"1",sqm_per_box:"1",warnings:[],classification:"VALID"}
];
equal(detectDuplicates(conflicting)[0].kind,"CONFLICTING","conflicting duplicate classified");
const mismatch=validatePriceMath({price_per_m2:"100000",sqm_per_box:"1.5",price_per_box:"160000",pieces_per_box:"2",price_per_piece:"80000"});
equal(mismatch.status,"MISMATCH","price math mismatch");
equal(parseIstoneGeometry(createUnknownGeometry()).error.code,"UNKNOWN_FORMAT","unknown format fails closed");
equal(parseIstoneGeometry({pages:[{page:1}],items:[]}).error.code,"TEXT_LAYER_UNAVAILABLE","missing text layer");
equal(parseIstoneGeometry(createPageResetFailureGeometry()).error.code,"ROW_AMBIGUOUS","page reset forbids cross-page inheritance");
equal(parseIstoneGeometry(createWrappedNameAmbiguityGeometry()).error.code,"ROW_AMBIGUOUS","wrapped name ambiguity is not guessed");

const missingRequired=createSyntheticIstoneGeometry();
missingRequired.items=missingRequired.items.filter(item=>!(item.page===1&&item.text==="SYN-A"));
const missingResult=parseIstoneGeometry(missingRequired);
equal(missingResult.rows.find(row=>row.stt===2).classification,"INVALID","missing required code invalidates row");
truthy(missingResult.rows.find(row=>row.stt===2).warnings.some(warning=>warning.code==="MISSING_REQUIRED_FIELD"),"missing required warning is contextual");

const mismatchGeometry=createSyntheticIstoneGeometry();
const supplierBox=mismatchGeometry.items.find(item=>item.page===1&&item.text==="36.000");
supplierBox.text="36.001";
const mismatchResult=parseIstoneGeometry(mismatchGeometry);
equal(mismatchResult.rows.find(row=>row.stt===2).price_per_box,"36001","mismatch preserves supplier value");
equal(mismatchResult.rows.find(row=>row.stt===2).classification,"REVIEW","math mismatch routes row to review");
truthy(mismatchResult.rows.find(row=>row.stt===2).warnings.some(warning=>warning.code==="PRICE_MATH_MISMATCH"),"math mismatch warning emitted");

const badGeometry=createSyntheticIstoneGeometry();
badGeometry.items=badGeometry.items.filter(item=>item.text!=="Vnđ/m2");
equal(parseIstoneGeometry(badGeometry).error.code,"COLUMN_GEOMETRY_INVALID","column header geometry fails closed");
equal(parseIstoneGeometry({pages:Array.from({length:51},(_,index)=>({page:index+1})),items:[{page:1,text:"x",x:0,y:0}]}).error.code,"PDF_TOO_MANY_PAGES","page limit enforced");
equal((await extractPdfGeometry(new TextEncoder().encode("not a pdf"),{})).error.code,"UNKNOWN_FORMAT","PDF magic bytes checked");
equal((await extractPdfGeometry(new TextEncoder().encode("%PDF-oversize"),{},{limits:{maxFileBytes:5,maxPages:50,maxTextItems:100}})).error.code,"PDF_TOO_LARGE","PDF size limit enforced");
equal((await handleParserWorkerRequest({protocol:PRODUCT_PARSER_WORKER_PROTOCOL,type:"PARSE",requestId:"cancelled",pdfBytes:new Uint8Array()},null,{isCancelled:()=>true})).type,"CANCELLED","worker boundary supports cancellation");

const encrypted=await extractPdfGeometry(new TextEncoder().encode("%PDF-1.7 synthetic"),{getDocument(){return {destroy(){},set onPassword(_) {},promise:Promise.reject(Object.assign(new Error("Password required"),{name:"PasswordException"}))};}});
equal(encrypted.error.code,"PDF_ENCRYPTED","encrypted PDF mapped safely");

console.log(`Product R2 parser public synthetic PASS (${checks} checks).`);
