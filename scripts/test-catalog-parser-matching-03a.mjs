import assert from "node:assert/strict";
import {
  buildCatalogMatchIndex,
  canonicalizeCatalogRow,
  catalogNameSimilarity,
  dryRunCatalogMatching,
  matchCatalogRow,
  normalizeCatalogName,
  parseCatalogExcelWorkbook,
  parseCatalogSize,
  parseCatalogVnd
} from "../js/product-import/index.js";

let checks=0;
const equal=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const truthy=(actual,message)=>{assert.ok(actual,message);checks++;};

for(const [source,unit,width,height] of [
  ["600x1200 mm",null,600,1200],
  ["600X1200mm",null,600,1200],
  ["600 × 1200 mm",null,600,1200],
  ["60 x 120 cm",null,600,1200],
  ["600x1200","mm",600,1200],
  ["60x120","cm",600,1200]
]){
  const parsed=parseCatalogSize(source,{defaultUnit:unit});
  equal([parsed.ok,parsed.width_mm,parsed.height_mm],[true,width,height],`size ${source}`);
}
equal(parseCatalogSize("600x1200").code,"UNKNOWN_SIZE_UNIT","unitless size fails without header context");
equal(parseCatalogSize("60.05x120 cm").code,"INVALID_SIZE","fractional millimetres fail closed");
equal(parseCatalogSize("").missing,true,"blank size remains missing");

for(const source of ["1.915.000","1,915,000","1915000",1915000]){
  equal(parseCatalogVnd(source).value,"1915000",`VND ${source}`);
}
for(const source of ["1.915,000","1,915.000","1915.50",0,-1]){
  equal(parseCatalogVnd(source).ok,false,`invalid VND ${source}`);
}
equal(parseCatalogVnd("").missing,true,"blank price remains null");

const sizedName=canonicalizeCatalogRow({product_name:" TRAVERTINO DARK  BROWN 600x1200 ",price_per_m2:"1.635.000"},{defaultSizeUnit:"mm"});
equal(sizedName.product_name,"TRAVERTINO DARK BROWN","size suffix removed from name");
equal([sizedName.width_mm,sizedName.height_mm],[600,1200],"size suffix becomes ordered mm");
const surfacedName=canonicalizeCatalogRow({product_name:"BARRO BEIGE GLOSSY",size:"800x800",price_per_m2:"742000"},{defaultSizeUnit:"mm"});
equal([surfacedName.product_name,surfacedName.surface],["BARRO BEIGE","GLOSSY"],"surface suffix moved out of name");
const babySkin=canonicalizeCatalogRow({product_name:"CALACATTA BABY SKIN",size:"60x120 cm",price_per_m2:"760000"});
equal([babySkin.product_name,babySkin.surface],["CALACATTA","BABY SKIN"],"multi-word surface parsed");
const structuredSurface=canonicalizeCatalogRow({product_name:"ALPINE NATURAL",surface:"MATT",size:"600x600 mm",price_per_m2:"500000"});
equal([structuredSurface.product_name,structuredSurface.surface,structuredSurface.issues.length],["ALPINE NATURAL","MATT",0],"structured surface prevents unsafe suffix stripping");
equal(normalizeCatalogName("  Đá–xám__đậm "),"ĐÁ XÁM ĐẬM","Unicode and dash normalization");

function workbookFixture(){
  const sheet={"!ref":"A1:F10","!merges":[{s:{r:2,c:1},e:{r:3,c:1}}]};
  const put=(ref,value)=>{sheet[ref]={v:value};};
  put("A2","STT");put("B2","KÍCH THƯỚC (MM)");put("C2","MÃ SẢN PHẨM");put("D2","BỀ MẶT");put("E2","GIÁ NIÊM YẾT (VNĐ/M2)");put("F2","GIÁ NIÊM YẾT MỚI (VNĐ/M2)");
  const rows=[
    [3,"1200x1200","TRAVERTINO DARK GREY 1200 x 1200","POLISH",1800000,"1.915.000"],
    [4,null,"TRAVERTINO DARK GREY","POLISH",1800000,"1,915,000"],
    [5,"1200X2400","TRAVERTINO DARK GREY","POLISH",1800000,"1.915.000"],
    [6,"800×800","BARRO BEIGE GLOSSY",null,700000,742000],
    [7,"60 X 120 cm","DOLOMITE BLANCO","POLISH",700000,null],
    [8,"600x1200","CONFLICT STONE","MATT",700000,760000],
    [9,null,"CONFLICT STONE","MATT",700000,780000],
    [10,"600x1200","ALPINE NATURAL","MATT",400000,482000]
  ];
  for(const [row,size,name,surface,oldPrice,newPrice] of rows){
    put(`A${row}`,row-2);if(size!==null) put(`B${row}`,size);put(`C${row}`,name);
    if(surface!==null) put(`D${row}`,surface);put(`E${row}`,oldPrice);if(newPrice!==null) put(`F${row}`,newPrice);
  }
  return {SheetNames:["INDONESIA"],Sheets:{INDONESIA:sheet}};
}

const parsed=parseCatalogExcelWorkbook(workbookFixture());
truthy(parsed.ok,"Excel-like workbook parses");
equal(parsed.metadata.header_row,2,"header row detected");
equal(parsed.metadata.default_size_unit,"mm","header unit detected");
equal(parsed.metadata.columns.price,5,"new price column wins over old price");
equal(parsed.summary.physical_rows,8,"all structured rows read");
const row3=parsed.rows.find(row=>row.source_row_number===3);
const row4=parsed.rows.find(row=>row.source_row_number===4);
equal([row3.width_mm,row3.height_mm,row3.size_source_cell_ref,row3.size_merged],[1200,1200,"B3",false],"merge anchor parsed");
equal([row4.width_mm,row4.height_mm,row4.size_source_cell_ref,row4.size_merged],[1200,1200,"B3",true],"merged size inherited with provenance");
equal(row4.disposition,"SKIP_DUPLICATE","same variant and price is duplicate");
truthy(parsed.rows.find(row=>row.source_row_number===5).warnings.some(item=>item.code==="SAME_PRICE_WARNING"),"same price across different size warns, not duplicates");
equal([parsed.rows.find(row=>row.source_row_number===6).product_name,parsed.rows.find(row=>row.source_row_number===6).surface],["BARRO BEIGE","GLOSSY"],"surface extracted in workbook row");
equal(parsed.rows.find(row=>row.source_row_number===7).disposition,"MISSING_PRICE","blank price remains missing");
equal(parsed.rows.filter(row=>row.disposition==="PRICE_CONFLICT").map(row=>row.source_row_number),[8,9],"same variant with different prices conflicts");
equal(parsed.rows.find(row=>row.source_row_number===10).product_name,"ALPINE NATURAL","explicit surface preserves name token");
truthy(parsed.rows.every(row=>row.warnings.some(item=>item.code==="NAME_FROM_SKU_COLUMN")),"name fallback from source product column is traceable");

const catalog=[
  {id:"00000000-0000-4000-8000-000000000001",code:"SKU-A",name:"TRAVERTINO DARK GREY",width_mm:1200,height_mm:1200,surface:"POLISH",price_per_m2:1915000},
  {id:"00000000-0000-4000-8000-000000000002",code:"SKU-B",name:"TRAVERTINO DARK GREY",width_mm:1200,height_mm:2400,surface:"POLISH",price_per_m2:2200000},
  {id:"00000000-0000-4000-8000-000000000003",code:"SKU-C",name:"BARRO BEIGE",width_mm:800,height_mm:800,surface:"GLOSSY",price_per_m2:742000},
  {id:"00000000-0000-4000-8000-000000000004",code:"SKU-D",name:"OCEAN BLUE",width_mm:600,height_mm:1200,surface:"MATT",price_per_m2:800000},
  {id:"00000000-0000-4000-8000-000000000005",code:"SKU-D",name:"OCEAN BLUE",width_mm:600,height_mm:1200,surface:"GLOSSY",price_per_m2:810000},
  {id:"00000000-0000-4000-8000-000000000006",code:"SKU-E",name:"SINGLE SURFACE",width_mm:600,height_mm:600,surface:"MATT",price_per_m2:500000},
  {id:"00000000-0000-4000-8000-000000000007",code:"SKU-F",name:"CENTIMETRE SOURCE",width_cm:60,height_cm:120,surface:"MATT",price_per_m2:600000}
];
const mappings=[{source_system:"FIREBASE",source_id:"SP-EXACT",product_id:catalog[0].id}];
const index=buildCatalogMatchIndex(catalog,mappings);
const canonical=input=>canonicalizeCatalogRow(input,{defaultSizeUnit:"mm"});

equal(matchCatalogRow(canonical({product_id:catalog[1].id,product_name:"wrong",size:"1x1",price_per_m2:"1"}),index).product_id,catalog[1].id,"product ID has first priority");
equal(matchCatalogRow(canonical({source_id:"SP-EXACT",product_name:"wrong",size:"1x1",price_per_m2:"1"}),index).match_rule,"SOURCE_ID","source ID exact match");
equal(matchCatalogRow(canonical({sku:"SKU-C",product_name:"wrong",size:"1x1",price_per_m2:"1"}),index).match_rule,"SKU","unique SKU match");
equal(matchCatalogRow(canonical({sku:"SKU-D",product_name:"OCEAN BLUE",size:"600x1200",surface:"GLOSSY",price_per_m2:"810000"}),index).product_id,catalog[4].id,"duplicate SKU continues to exact variant");
equal(matchCatalogRow(canonical({product_name:"BARRO BEIGE",size:"800x800",surface:"GLOSSY",price_per_m2:"742000"}),index).match_rule,"NAME_SIZE_SURFACE","name size surface match");
equal(matchCatalogRow(canonical({product_name:"OCEAN BLUE",size:"600x1200",price_per_m2:"800000"}),index).status,"AMBIGUOUS","missing surface with multiple candidates is ambiguous");
equal(matchCatalogRow(canonical({product_name:"SINGLE SURFACE",size:"600x600",price_per_m2:"500000"}),index).match_rule,"NAME_SIZE","missing surface with one candidate may match");
const surfaceConflict=matchCatalogRow(canonical({product_name:"SINGLE SURFACE",size:"600x600",surface:"POLISH",price_per_m2:"500000"}),index);
equal([surfaceConflict.status,surfaceConflict.match_rule],["UNMATCHED","FUZZY_SUGGESTION"],"different known surface never auto-matches");
const fuzzy=matchCatalogRow(canonical({product_name:"BARRO BEIG",size:"800x800",surface:"GLOSSY",price_per_m2:"742000"}),index);
equal([fuzzy.status,fuzzy.match_rule,fuzzy.suggestions[0].id],["UNMATCHED","FUZZY_SUGGESTION",catalog[2].id],"fuzzy is suggestion only");
equal(matchCatalogRow(canonical({product_name:"TRAVERTINO DARK GREY",size:"2400x1200",surface:"POLISH",price_per_m2:"2200000"}),index).status,"UNMATCHED","ordered dimensions are not swapped");
equal(matchCatalogRow(canonical({product_name:"CENTIMETRE SOURCE",size:"600x1200",surface:"MATT",price_per_m2:"600000"}),index).match_rule,"NAME_SIZE_SURFACE","legacy centimetre dimensions normalize to millimetres");
truthy(catalogNameSimilarity("DOLOMITE BLANCO","DOLOMITE BIANCO")>0.8,"fuzzy similarity is deterministic");

const dry=dryRunCatalogMatching(parsed.rows,catalog,mappings);
equal(dry.summary.total,8,"dry run preserves every source row");
equal(dry.rows.length,parsed.rows.length,"dry run does not write or drop rows");
truthy(dry.rows.every(row=>row.match&&Array.isArray(row.match.suggestions)),"every row has explicit match result");

console.log(`Catalog parser and matching 03A PASS (${checks} checks).`);
