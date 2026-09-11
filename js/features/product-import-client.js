import {PRODUCT_PARSER_WORKER_PROTOCOL} from "../product-import/worker-protocol.js";

export const PRODUCT_IMPORT_MAX_BYTES=20*1024*1024;
export const PRODUCT_IMPORT_ADAPTER="ISTONE_INDONESIA_V1";
export const PRODUCT_IMPORT_PARSER_VERSION="1.0.0";

export function bytesHavePdfMagic(bytes){
  const view=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||0);
  return view.length>=5&&String.fromCharCode(...view.slice(0,5))==="%PDF-";
}

export function validateProductImportFile(file,bytes){
  if(!file) throw new Error("Vui lòng chọn một file PDF.");
  if(file.size<=0) throw new Error("File PDF đang trống.");
  if(file.size>PRODUCT_IMPORT_MAX_BYTES) throw new Error("File PDF vượt giới hạn 20 MiB.");
  if(!bytesHavePdfMagic(bytes)) throw new Error("File không có PDF magic bytes hợp lệ.");
  return true;
}

export async function sha256Hex(bytes){
  const buffer=bytes instanceof ArrayBuffer?bytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  const digest=await crypto.subtle.digest("SHA-256",buffer);
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join("");
}

export function parserResultToStagePayload(file,result,sourceSha256){
  if(!result?.ok||!Array.isArray(result.rows)) throw new Error(result?.error?.message||"Kết quả parser không hợp lệ.");
  const effectiveDate=result.metadata?.effective_date;
  return {
    batch:{
      supplier:"ISTONE",
      source_filename:String(file?.name||"price-list.pdf").split(/[\\/]/).pop(),
      source_sha256:sourceSha256,
      source_file_size_bytes:Number(file?.size||0),
      parser_adapter:PRODUCT_IMPORT_ADAPTER,
      parser_version:PRODUCT_IMPORT_PARSER_VERSION,
      effective_date:effectiveDate,
      page_count:Number(result.metadata?.pages?.length||result.metadata?.page_count||0),
      origin_candidate:"Indonesia"
    },
    rows:result.rows.map(row=>({
      source_page:row.source_page,
      source_row_number:row.source_row_number,
      stt:row.stt,
      source_values:row.source_values||{
        code:row.code,name:row.name,size:row.source_size_text,packaging:row.source_packaging_text,
        price_per_m2:row.price_per_m2,price_per_box:row.price_per_box,price_per_piece:row.price_per_piece,
        pieces_per_box:row.pieces_per_box,sqm_per_box:row.sqm_per_box
      },
      source_size_text:row.source_size_text,
      source_size_unit:row.source_size_unit,
      source_packaging_text:row.source_packaging_text,
      code:row.code,
      code_normalized:row.code_normalized,
      name:row.name,
      name_normalized:row.name_normalized,
      width_cm:row.width_cm,
      height_cm:row.height_cm,
      price_per_m2:row.price_per_m2,
      price_per_box:row.price_per_box,
      price_per_piece:row.price_per_piece,
      pieces_per_box:row.pieces_per_box,
      sqm_per_box:row.sqm_per_box,
      surface_candidate:row.surface_candidate,
      origin_candidate:"Indonesia",
      warnings:row.warnings||[],
      client_classification:row.classification
    }))
  };
}

export class ProductImportWorkerClient{
  constructor(workerUrl=new URL("../workers/product-import.worker.js",import.meta.url)){this.workerUrl=workerUrl;this.worker=null;this.pending=null;}
  parse(bytes,sourceSha256){
    this.cancel();
    const requestId=crypto.randomUUID();
    this.worker=new Worker(this.workerUrl,{type:"module",name:"product-price-list-parser"});
    return new Promise((resolve,reject)=>{
      this.pending={requestId,reject};
      this.worker.onmessage=event=>{
        if(event.data?.requestId!==requestId)return;
        this.pending=null;this.worker?.terminate();this.worker=null;
        if(event.data.type==="RESULT")resolve(event.data.result);
        else reject(new Error(event.data?.error?.message||"Phân tích PDF thất bại."));
      };
      this.worker.onerror=()=>{this.pending=null;this.worker?.terminate();this.worker=null;reject(new Error("Worker phân tích PDF gặp lỗi."));};
      this.worker.postMessage({protocol:PRODUCT_PARSER_WORKER_PROTOCOL,type:"PARSE",requestId,sourceSha256,pdfBytes:bytes},[bytes]);
    });
  }
  cancel(){
    if(this.worker)this.worker.terminate();
    if(this.pending)this.pending.reject(new DOMException("Đã hủy phân tích PDF.","AbortError"));
    this.worker=null;this.pending=null;
  }
}
