// STEP 6 source-PDF boundary. Deploy only as an authenticated Supabase Edge Function.
const MAX_BYTES=20*1024*1024;
const json=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const errorResponse=(code:string,status:number)=>json({error:{code,message:code}},status);

function env(name:string){const value=Deno.env.get(name);if(!value)throw new Error(`MISSING_ENV:${name}`);return value;}
function authHeaders(token:string,anonKey:string){return {apikey:anonKey,Authorization:`Bearer ${token}`,"content-type":"application/json"};}

async function boundedBytes(request:Request){
  const declared=Number(request.headers.get("content-length")||0);
  if(declared>MAX_BYTES)return null;
  if(!request.body)return null;
  const reader=request.body.getReader();const chunks:Uint8Array[]=[];let total=0;
  while(true){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>MAX_BYTES){await reader.cancel();return null;}chunks.push(part.value);}
  const result=new Uint8Array(total);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}return result;
}

async function rpc(url:string,token:string,anonKey:string,name:string,body:Record<string,unknown>){
  const response=await fetch(`${url}/rest/v1/rpc/${name}`,{method:"POST",headers:authHeaders(token,anonKey),body:JSON.stringify(body)});
  const payload=await response.json().catch(()=>null);if(!response.ok)throw Object.assign(new Error("RPC_FAILED"),{status:response.status,payload});return payload;
}

function objectUrl(url:string,path:string){return `${url}/storage/v1/object/product-price-imports/${path.split("/").map(encodeURIComponent).join("/")}`;}

Deno.serve(async request=>{
  if(request.method!=="POST")return errorResponse("METHOD_NOT_ALLOWED",405);
  const authorization=request.headers.get("authorization")||"";const token=authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const batchId=request.headers.get("x-product-import-batch-id")||new URL(request.url).searchParams.get("batch_id");
  if(!token||!batchId||!/^[0-9a-f-]{36}$/i.test(batchId))return errorResponse("AUTH_OR_BATCH_REQUIRED",401);
  try{
    const url=env("SUPABASE_URL");const anonKey=env("SUPABASE_ANON_KEY");const serviceKey=env("SUPABASE_SERVICE_ROLE_KEY");
    const userResponse=await fetch(`${url}/auth/v1/user`,{headers:{apikey:anonKey,Authorization:`Bearer ${token}`}});
    if(!userResponse.ok)return errorResponse("INVALID_JWT",401);
    const expected=await rpc(url,token,anonKey,"crm_prepare_product_import_source",{p_batch_id:batchId});
    const bytes=await boundedBytes(request);if(!bytes)return errorResponse("SOURCE_TOO_LARGE_OR_EMPTY",413);
    if(bytes.byteLength<5||new TextDecoder().decode(bytes.slice(0,5))!=="%PDF-")return errorResponse("SOURCE_NOT_PDF",415);
    const digest=await crypto.subtle.digest("SHA-256",bytes);const computed=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join("");
    if(computed!==String(expected.source_sha256).toLowerCase())return errorResponse("SOURCE_HASH_MISMATCH",422);
    if(bytes.byteLength!==Number(expected.source_file_size_bytes))return errorResponse("SOURCE_SIZE_MISMATCH",422);
    const storagePath=`imports/${batchId}/source.pdf`;if(expected.storage_object_path!==storagePath)return errorResponse("SOURCE_PATH_MISMATCH",422);
    const storageHeaders={apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,"content-type":"application/pdf", "cache-control":"no-store", "x-upsert":"true"};
    const existing=await fetch(objectUrl(url,storagePath),{method:"HEAD",headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}});
    if(!existing.ok||expected.verified!==true){
      const upload=await fetch(objectUrl(url,storagePath),{method:"POST",headers:storageHeaders,body:bytes});
      if(!upload.ok){const detail=await upload.text().catch(()=>"");throw Object.assign(new Error("STORAGE_UPLOAD_FAILED"),{status:upload.status,detail});}
    }
    const registered=await rpc(url,token,anonKey,"crm_register_product_import_source",{p_batch_id:batchId,p_source_verified_sha256:computed,p_source_verified_size_bytes:bytes.byteLength,p_storage_object_path:storagePath});
    return json({ok:true,batch_id:batchId,storage_object_path:storagePath,source_verified_sha256:computed,source_verified_size_bytes:bytes.byteLength,source_verified_at:registered.source_verified_at||null});
  }catch(_error){return errorResponse("SOURCE_UPLOAD_FAILED",502);}
});
