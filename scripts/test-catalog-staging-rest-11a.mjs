import assert from "node:assert/strict";

const expectedRef="nalkeptqohjbjnqwpzzv";
const productionRef="jjeeazwlqcwynzquimeo";
const ref=process.env.STAGING_PROJECT_REF||"";
const base=(process.env.STAGING_SUPABASE_URL||"").replace(/\/$/,"");
const anon=process.env.STAGING_ANON_KEY||"";

assert.equal(ref,expectedRef,"11A REST guard requires the approved cloud staging ref");
assert.equal(base,`https://${expectedRef}.supabase.co`,"11A REST URL must be staging");
assert.ok(!base.includes(productionRef),"11A REST refuses production");
assert.ok(anon,"11A REST requires an ephemeral staging anon key");

const request=async(path,{method="GET",body}={})=>{
  const response=await fetch(`${base}${path}`,{
    method,
    signal:AbortSignal.timeout(90000),
    headers:{apikey:anon,Authorization:`Bearer ${anon}`,...(body?{"Content-Type":"application/json"}:{})},
    body:body?JSON.stringify(body):undefined
  });
  const text=await response.text();
  let data=text;
  try{data=text?JSON.parse(text):null;}catch{}
  return {status:response.status,ok:response.ok,data};
};

let checks=0;
const auth=await request("/auth/v1/settings");
assert.equal(auth.status,200,"staging Auth endpoint");checks++;

const list=await request("/rest/v1/rpc/catalog_public_list_products_v1",{
  method:"POST",
  body:{p_search:null,p_category:null,p_collection:null,p_surface:null,p_width_mm:null,p_height_mm:null,p_min_price:null,p_max_price:null,p_limit:3,p_offset:0}
});
assert.equal(list.status,200,"public catalog RPC over PostgREST");
assert.equal(typeof list.data,"object");checks+=2;

const direct=await request("/rest/v1/products?select=id&limit=1");
assert.ok([401,403].includes(direct.status),`anon direct products read must be denied, got ${direct.status}`);checks++;

const admin=await request("/rest/v1/rpc/catalog_admin_list_products_v1",{
  method:"POST",body:{p_search:null,p_data_status:null,p_active:null,p_is_published:null,p_limit:1,p_offset:0}
});
assert.ok([401,403].includes(admin.status),`anon admin RPC must be denied, got ${admin.status}`);checks++;

const invalidLead=await request("/rest/v1/rpc/catalog_submit_website_lead_v1",{
  method:"POST",
  body:{p_lead:{name:"11A Synthetic",email:"catalog-11a@staging.invalid",privacy_consent:false,request_id:"11111111-1111-4111-8111-111111111119"}}
});
assert.equal(invalidLead.status,400,"lead validation must fail before write");checks++;

console.log(`PASS: Prompt 11A staging REST boundary (${checks} checks, ref ${ref}).`);
