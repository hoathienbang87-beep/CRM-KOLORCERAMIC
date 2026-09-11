import * as pdfjs from "../vendor/pdfjs/pdf.mjs";
import {handleParserWorkerRequest,PRODUCT_PARSER_WORKER_PROTOCOL} from "../product-import/worker-protocol.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.mjs",import.meta.url).href;

self.addEventListener("message",async event=>{
  const requestId=event.data?.requestId||null;
  try{
    const response=await handleParserWorkerRequest(event.data,pdfjs);
    self.postMessage(response);
  }catch(error){
    self.postMessage({
      protocol:PRODUCT_PARSER_WORKER_PROTOCOL,
      type:"ERROR",
      requestId,
      error:{code:"WORKER_PARSE_FAILED",message:"Không thể phân tích PDF. Vui lòng kiểm tra đúng mẫu bảng giá."}
    });
  }
});
