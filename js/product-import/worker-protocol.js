import {parseIstonePdf} from "./index.js";

export const PRODUCT_PARSER_WORKER_PROTOCOL="PRODUCT_R2_PARSER_WORKER_V1";

export async function handleParserWorkerRequest(message,pdfjs,{isCancelled=()=>false}={}){
  if(message?.protocol!==PRODUCT_PARSER_WORKER_PROTOCOL||message?.type!=="PARSE") throw new Error("INVALID_WORKER_MESSAGE");
  if(isCancelled()) return {protocol:PRODUCT_PARSER_WORKER_PROTOCOL,type:"CANCELLED",requestId:message.requestId};
  const result=await parseIstonePdf(message.pdfBytes,pdfjs,{sourceSha256:message.sourceSha256||null});
  return {protocol:PRODUCT_PARSER_WORKER_PROTOCOL,type:"RESULT",requestId:message.requestId,result};
}
