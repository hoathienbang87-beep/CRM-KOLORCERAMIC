import {ERROR_CODES,PARSER_LIMITS,parserFailure} from "./contracts.js";

function bytesFrom(input){
  if(input instanceof Uint8Array) return input;
  if(input instanceof ArrayBuffer) return new Uint8Array(input);
  if(ArrayBuffer.isView(input)) return new Uint8Array(input.buffer,input.byteOffset,input.byteLength);
  return null;
}

function splitTextItem(item,page,viewport){
  const text=String(item.str||"").trim();
  if(!text) return [];
  const x=Number(item.transform?.[4]||0),height=Math.abs(Number(item.height||item.transform?.[3]||0));
  const y=Number(viewport.height)-Number(item.transform?.[5]||0)-height;
  const width=Math.abs(Number(item.width||0));
  const parts=[...text.matchAll(/\S+/gu)];
  if(parts.length<=1) return [{page,text,x,y,width,height}];
  const total=Math.max(text.length,1);
  return parts.map(match=>({page,text:match[0],x:x+width*(match.index/total),y,width:width*(match[0].length/total),height}));
}

export async function extractPdfGeometry(pdfBytes,pdfjs,{limits=PARSER_LIMITS}={}){
  const bytes=bytesFrom(pdfBytes);
  if(!bytes||bytes.length<5||String.fromCharCode(...bytes.slice(0,5))!=="%PDF-") return parserFailure(ERROR_CODES.UNKNOWN_FORMAT,"File không có PDF magic bytes hợp lệ.");
  if(bytes.byteLength>limits.maxFileBytes) return parserFailure(ERROR_CODES.PDF_TOO_LARGE,"PDF vượt giới hạn kích thước.");
  let loadingTask,document,passwordRequested=false;
  try{
    loadingTask=pdfjs.getDocument({data:bytes,disableAutoFetch:true,disableStream:true,isEvalSupported:false,useWorkerFetch:false});
    loadingTask.onPassword=()=>{passwordRequested=true;loadingTask.destroy();};
    document=await loadingTask.promise;
  }catch(error){
    const encrypted=passwordRequested||/password/i.test(`${error?.name||""} ${error?.message||""}`);
    return parserFailure(encrypted?ERROR_CODES.PDF_ENCRYPTED:ERROR_CODES.UNKNOWN_FORMAT,encrypted?"PDF được mã hóa hoặc yêu cầu mật khẩu.":"Không thể đọc cấu trúc PDF.");
  }
  try{
    if(document.numPages>limits.maxPages) return parserFailure(ERROR_CODES.PDF_TOO_MANY_PAGES,"PDF vượt giới hạn số trang.");
    const pages=[],items=[];
    for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
      const page=await document.getPage(pageNumber);
      const viewport=page.getViewport({scale:1});
      const content=await page.getTextContent({disableNormalization:false});
      const pageItems=content.items.flatMap(item=>splitTextItem(item,pageNumber,viewport));
      items.push(...pageItems);
      pages.push({page:pageNumber,width_pt:String(viewport.width),height_pt:String(viewport.height),text_items:pageItems.length});
      page.cleanup();
      if(items.length>limits.maxTextItems) return parserFailure(ERROR_CODES.TEXT_LAYER_UNAVAILABLE,"Text layer vượt giới hạn an toàn.");
    }
    if(items.length===0) return parserFailure(ERROR_CODES.TEXT_LAYER_UNAVAILABLE,"PDF không có text layer sử dụng được.");
    return {ok:true,pages,items,coordinate_system:"top-left-points"};
  }finally{
    await loadingTask?.destroy?.();
  }
}
