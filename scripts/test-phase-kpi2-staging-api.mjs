import crypto from "node:crypto";
import process from "node:process";

const ref = process.env.STAGING_PROJECT_REF || "";
const base = (process.env.STAGING_SUPABASE_URL || "").replace(/\/$/, "");
const anon = process.env.STAGING_ANON_KEY || "";
const service = process.env.STAGING_SERVICE_ROLE_KEY || "";
if (ref !== "ykhtpvyelpujykheycsv" || base !== `https://${ref}.supabase.co` || !anon || !service) throw new Error("KPI-2 staging guard failed.");

const run = crypto.randomBytes(5).toString("hex");
const password = `${crypto.randomBytes(18).toString("base64url")}aA1!`;
let month = "";
let eventAt = "";
let revisionEventAt = "";
const users = ["admin","manager","saleA","saleB"].map(key => ({key, role:key.startsWith("sale")?"sale":key, id:`kpi2-${run}-${key}`, email:`kpi2-${run}-${key.toLowerCase()}@example.com`}));
const authIds=[]; const checks=[]; const objectPaths=[]; const ids={definitions:[],assignments:[],submissions:[],events:[],evidence:[],customers:[],careLogs:[]};
const ok=(name,condition)=>{if(!condition) throw new Error(`CHECK FAILED: ${name}`); checks.push(name);};

async function req(path,{method="GET",token=service,key=service,body,raw,headers={},allow=false}={}){
  const res=await fetch(`${base}${path}`,{method,signal:AbortSignal.timeout(90000),headers:{apikey:key,Authorization:`Bearer ${token}`,...headers,...(body!==undefined?{"Content-Type":"application/json"}:{})},body:raw??(body===undefined?undefined:JSON.stringify(body))});
  const text=await res.text(); let data=null; if(text){try{data=JSON.parse(text)}catch{data=text}}
  if(!allow&&!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${typeof data==="string"?data.slice(0,180):JSON.stringify(data)?.slice(0,180)}`);
  return {ok:res.ok,status:res.status,data};
}
const rpc=(u,name,body,allow=false)=>req(`/rest/v1/rpc/${name}`,{method:"POST",token:u.token,key:anon,body,allow});
const select=(u,table,q)=>req(`/rest/v1/${table}?${q}`,{token:u.token,key:anon});
async function createUser(u){const a=await req("/auth/v1/admin/users",{method:"POST",body:{email:u.email,password,email_confirm:true}});u.auth=a.data.id;authIds.push(u.auth);await req("/rest/v1/app_users",{method:"POST",body:{id:u.id,supabase_auth_id:u.auth,email:u.email,name:`KPI2 ${u.key}`,role:u.role,active:true,lifecycle_status:"active",raw_data:{testRun:run}}});const l=await req("/auth/v1/token?grant_type=password",{method:"POST",token:anon,key:anon,body:{email:u.email,password}});u.token=l.data.access_token;}
const by=key=>users.find(u=>u.key===key);
async function periodVersion(id){return (await req(`/rest/v1/kpi_periods?id=eq.${id}&select=version`)).data[0].version;}
async function createDefinition(manager,suffix,type="MANUAL",agg="COUNT",evidence=false,location=false,metric=null){const d=(await rpc(manager,"crm_kpi_create_definition_v2",{p_code:`KPI2_${suffix}_${run}`.toUpperCase(),p_name:`KPI2 ${suffix}`,p_description:"staging fixture",p_kpi_type:type,p_source_metric_key:metric,p_unit:agg==="COUNT"?"lượt":"điểm",p_submission_mode:"EVENT_CLAIM",p_evidence_required:evidence,p_aggregation_mode:agg,p_max_images_per_event:2,p_location_required:location,p_timestamp_required:true})).data;ids.definitions.push(d.id);return d;}
async function assign(manager,period,def,sale,target,score=true){const a=(await rpc(manager,"crm_kpi_assign_employee",{p_period_id:period.id,p_definition_id:def.id,p_employee_id:sale.id,p_target:target,p_expected_period_version:await periodVersion(period.id)})).data;ids.assignments.push(a.id);if(!score){await rpc(manager,"crm_kpi_update_assignment_options",{p_assignment_id:a.id,p_score_enabled:false,p_expected_assignment_version:a.lock_version,p_expected_period_version:a.periodVersion});}return a;}
const manualEvent=(value=1)=>({sourceType:"MANUAL",sourceEventKey:`manual:${crypto.randomUUID()}`,eventAt,claimedValue:value,eventSnapshot:{title:"KPI2 test event",description:"controlled staging fixture"},evidenceIds:[]});

async function cleanup(){
  for(const p of objectPaths) await req(`/storage/v1/object/kpi2-evidence/${p}`,{method:"DELETE",allow:true});
  await req(`/rest/v1/kpi_evidence?uploaded_by_user_id=like.kpi2-${run}-*`,{method:"DELETE",allow:true});
  await req(`/rest/v1/kpi_action_requests?actor_user_id=like.kpi2-${run}-*`,{method:"DELETE",allow:true});
  if(ids.events.length)await req(`/rest/v1/kpi_duplicate_matches?or=(event_id.in.(${ids.events.join(",")}),duplicate_event_id.in.(${ids.events.join(",")}))`,{method:"DELETE",allow:true});
  for(const table of ["kpi_submission_events","kpi_submissions","kpi_assignments"]){const list=ids[table==="kpi_submission_events"?"events":table==="kpi_submissions"?"submissions":"assignments"];if(list.length)await req(`/rest/v1/${table}?id=in.(${list.join(",")})`,{method:"DELETE",allow:true});}
  if(ids.definitions.length)await req(`/rest/v1/kpi_definitions?id=in.(${ids.definitions.join(",")})`,{method:"DELETE",allow:true});
  await req(`/rest/v1/kpi_periods?name=like.KPI2 ${run}*`,{method:"DELETE",allow:true});
  if(ids.careLogs.length)await req(`/rest/v1/care_logs?id=in.(${ids.careLogs.join(",")})`,{method:"DELETE",allow:true});
  if(ids.customers.length)await req(`/rest/v1/customer_assignments?customer_id=in.(${ids.customers.join(",")})`,{method:"DELETE",allow:true});
  if(ids.customers.length)await req(`/rest/v1/customers?id=in.(${ids.customers.join(",")})`,{method:"DELETE",allow:true});
  await req(`/rest/v1/audit_logs?email=like.kpi2-${run}-*`,{method:"DELETE",allow:true});
  await req(`/rest/v1/app_users?id=like.kpi2-${run}-*`,{method:"DELETE",allow:true});
  for(const id of authIds.reverse())await req(`/auth/v1/admin/users/${id}`,{method:"DELETE",allow:true});
}

try{
  const existingPeriods=(await req("/rest/v1/kpi_periods?select=period_month")).data.map(row=>row.period_month);
  month=["2024-01-01","2024-02-01","2024-03-01","2024-04-01","2024-05-01","2024-06-01","2024-07-01","2024-08-01","2024-09-01","2024-10-01","2024-11-01","2024-12-01"].find(value=>!existingPeriods.includes(value));
  if(!month)throw new Error("No unused historical KPI period is available for staging fixtures.");
  eventAt=`${month.slice(0,7)}-15T03:00:00Z`;
  revisionEventAt=`${month.slice(0,7)}-16T03:00:00Z`;
  for(const u of users)await createUser(u); const admin=by("admin"),manager=by("manager"),saleA=by("saleA"),saleB=by("saleB");
  const period=(await rpc(manager,"crm_kpi_create_period",{p_period_month:month,p_name:`KPI2 ${run}`,p_timezone:"Asia/Ho_Chi_Minh"})).data;
  const periodDb=(await req(`/rest/v1/kpi_periods?id=eq.${period.id}&select=starts_at,ends_at,timezone`)).data[0];
  const countDef=await createDefinition(manager,"COUNT"); const sumDef=await createDefinition(manager,"SUM","MANUAL","SUM");
  const overDef=await createDefinition(manager,"OVER","MANUAL","SUM"); const hybridDef=await createDefinition(manager,"HYBRID","HYBRID","COUNT",false,false,"customers_v1");
  const careDef=await createDefinition(manager,"CARE","HYBRID","COUNT",false,false,"care_logs_v1");
  const dealsDef=await createDefinition(manager,"DEALS","HYBRID","COUNT",false,false,"deals_v1");
  const evidenceDef=await createDefinition(manager,"EVIDENCE","MANUAL","COUNT",true,true);
  const updatedDef=(await rpc(manager,"crm_kpi_update_definition_v2",{p_definition_id:evidenceDef.id,p_expected_version:evidenceDef.version,p_changes:{code:evidenceDef.code,name:"KPI2 Evidence updated",description:"updated fixture",kpiType:"MANUAL",sourceMetricKey:"",unit:evidenceDef.unit,submissionMode:"EVENT_CLAIM",evidenceRequired:true,aggregationMode:"COUNT",maxImagesPerEvent:2,locationRequired:true,timestampRequired:true}})).data;
  ok("definition v2 options update",updatedDef.name==="KPI2 Evidence updated"&&updatedDef.location_required===true&&updatedDef.max_images_per_event===2&&updatedDef.version===evidenceDef.version+1);
  const countA=await assign(manager,period,countDef,saleA,7); const sumA=await assign(manager,period,sumDef,saleA,100,false);
  const overA=await assign(manager,period,overDef,saleA,10); const hybridA=await assign(manager,period,hybridDef,saleA,5); const hybridB=await assign(manager,period,hybridDef,saleB,5);
  const careA=await assign(manager,period,careDef,saleA,5); const careB=await assign(manager,period,careDef,saleB,5);
  const dealsA=await assign(manager,period,dealsDef,saleA,5); const evidenceA=await assign(manager,period,updatedDef,saleA,1); const countB=await assign(manager,period,countDef,saleB,7);
  const dealsRow=(await req(`/rest/v1/kpi_assignments?id=eq.${dealsA.id}&select=score_enabled`)).data[0];
  ok("deals_v1 assignment defaults score OFF",dealsRow.score_enabled===false);
  await rpc(manager,"crm_kpi_activate_period",{p_period_id:period.id,p_expected_version:await periodVersion(period.id)});

  const events=Array.from({length:7},()=>manualEvent()); const requestId=crypto.randomUUID();
  const submission=(await rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:countA.id,p_request_id:requestId,p_sale_note:"7 count events",p_events:events})).data;ids.submissions.push(submission.submissionId);ids.events.push(...submission.eventIds);
  const same=(await rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:countA.id,p_request_id:requestId,p_sale_note:"7 count events",p_events:events})).data;
  ok("submit idempotency",same.submissionId===submission.submissionId);
  const mismatch=await rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:countA.id,p_request_id:requestId,p_sale_note:"changed payload",p_events:events},true);
  ok("submit idempotency payload mismatch rejected",!mismatch.ok&&JSON.stringify(mismatch.data).includes("KPI_IDEMPOTENCY_PAYLOAD_CONFLICT"));
  const concurrentRequest=crypto.randomUUID(), concurrentEvent=manualEvent();
  const concurrentSame=await Promise.all([
    rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:sumA.id,p_request_id:concurrentRequest,p_sale_note:"same concurrent",p_events:[concurrentEvent]},true),
    rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:sumA.id,p_request_id:concurrentRequest,p_sale_note:"same concurrent",p_events:[concurrentEvent]},true)
  ]);
  ok("concurrent same request and payload has one business result",concurrentSame.every(x=>x.ok)&&concurrentSame[0].data.submissionId===concurrentSame[1].data.submissionId);
  ids.submissions.push(concurrentSame[0].data.submissionId);ids.events.push(...concurrentSame[0].data.eventIds);
  const concurrentMismatchRequest=crypto.randomUUID();
  const concurrentDifferent=await Promise.all([
    rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:sumA.id,p_request_id:concurrentMismatchRequest,p_sale_note:"payload A",p_events:[manualEvent()]},true),
    rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:sumA.id,p_request_id:concurrentMismatchRequest,p_sale_note:"payload B",p_events:[manualEvent()]},true)
  ]);
  ok("concurrent same request different payload has one winner and one conflict",concurrentDifferent.filter(x=>x.ok).length===1&&concurrentDifferent.filter(x=>!x.ok).every(x=>JSON.stringify(x.data).includes("KPI_IDEMPOTENCY_PAYLOAD_CONFLICT")));
  for(const x of concurrentDifferent.filter(x=>x.ok)){ids.submissions.push(x.data.submissionId);ids.events.push(...x.data.eventIds)}
  const approveRequest=crypto.randomUUID();
  const approvedOnce=(await rpc(manager,"crm_kpi_review_events",{p_request_id:approveRequest,p_rows:submission.eventIds.slice(0,5).map(id=>({eventId:id,expectedVersion:1})),p_decision:"APPROVED",p_reason_code:null,p_manager_note:null})).data;
  const approvedRetry=(await rpc(manager,"crm_kpi_review_events",{p_request_id:approveRequest,p_rows:submission.eventIds.slice(0,5).map(id=>({eventId:id,expectedVersion:1})),p_decision:"APPROVED",p_reason_code:null,p_manager_note:null})).data;
  ok("review idempotency",approvedRetry.count===approvedOnce.count&&approvedRetry.events[0].eventId===approvedOnce.events[0].eventId);
  const reviewMismatch=await rpc(manager,"crm_kpi_review_events",{p_request_id:approveRequest,p_rows:submission.eventIds.slice(0,5).map(id=>({eventId:id,expectedVersion:1})),p_decision:"REJECTED",p_reason_code:"OUT_OF_SCOPE",p_manager_note:"changed"},true);
  ok("review idempotency payload mismatch rejected",!reviewMismatch.ok&&JSON.stringify(reviewMismatch.data).includes("KPI_IDEMPOTENCY_PAYLOAD_CONFLICT"));
  await rpc(manager,"crm_kpi_review_events",{p_request_id:crypto.randomUUID(),p_rows:submission.eventIds.slice(5).map(id=>({eventId:id,expectedVersion:1})),p_decision:"REJECTED",p_reason_code:"OUT_OF_SCOPE",p_manager_note:"fixture"});
  let progress=(await rpc(saleA,"crm_kpi_get_assignment_progress",{p_period_id:period.id})).data;
  let row=progress.find(x=>x.assignment_id===countA.id);ok("COUNT approved actual 5",Number(row.approved_actual)===5&&Number(row.scoring_completion_pct)===71.43);

  const sumSub=(await rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:sumA.id,p_request_id:crypto.randomUUID(),p_sale_note:"sum",p_events:[manualEvent(30),manualEvent(40),manualEvent(50)]})).data;ids.submissions.push(sumSub.submissionId);ids.events.push(...sumSub.eventIds);
  await rpc(manager,"crm_kpi_review_events",{p_request_id:crypto.randomUUID(),p_rows:sumSub.eventIds.slice(0,2).map(id=>({eventId:id,expectedVersion:1})),p_decision:"APPROVED",p_reason_code:null,p_manager_note:null});
  await rpc(manager,"crm_kpi_review_events",{p_request_id:crypto.randomUUID(),p_rows:[{eventId:sumSub.eventIds[2],expectedVersion:1}],p_decision:"REJECTED",p_reason_code:"OUT_OF_SCOPE",p_manager_note:null});
  const overSub=(await rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:overA.id,p_request_id:crypto.randomUUID(),p_sale_note:"over",p_events:[manualEvent(12)]})).data;ids.submissions.push(overSub.submissionId);ids.events.push(...overSub.eventIds);
  await rpc(manager,"crm_kpi_review_events",{p_request_id:crypto.randomUUID(),p_rows:[{eventId:overSub.eventIds[0],expectedVersion:1}],p_decision:"APPROVED",p_reason_code:null,p_manager_note:null});
  progress=(await rpc(manager,"crm_kpi_get_assignment_progress",{p_period_id:period.id})).data;
  row=progress.find(x=>x.assignment_id===sumA.id);ok("SUM approved actual 70 and score disabled",Number(row.approved_actual)===70&&row.score_enabled===false);
  row=progress.find(x=>x.assignment_id===overA.id);ok("actual over 100 capped for score",Number(row.actual_completion_pct)===120&&Number(row.scoring_completion_pct)===100);
  const monthly=(await rpc(manager,"crm_kpi_get_monthly_scores",{p_period_id:period.id})).data.find(x=>x.employee_id===saleA.id);
  ok("score disabled excluded from monthly denominator",Number(monthly.included_kpi_count)===5&&Number(monthly.monthly_score)===34.29&&monthly.has_open_items===false);

  const raceEvent=manualEvent(); const race=await Promise.all([rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:countA.id,p_request_id:crypto.randomUUID(),p_sale_note:"race",p_events:[raceEvent]},true),rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:countA.id,p_request_id:crypto.randomUUID(),p_sale_note:"race",p_events:[raceEvent]},true)]);
  ok("duplicate event race one winner",race.filter(x=>x.ok).length===1);for(const x of race.filter(x=>x.ok)){ids.submissions.push(x.data.submissionId);ids.events.push(...x.data.eventIds)}
  const crossSale=(await rpc(saleB,"crm_kpi_submit_events",{p_assignment_id:countB.id,p_request_id:crypto.randomUUID(),p_sale_note:"cross sale duplicate hint",p_events:[raceEvent]})).data;ids.submissions.push(crossSale.submissionId);ids.events.push(...crossSale.eventIds);
  const crossSaleRow=(await select(saleB,"kpi_submission_events",`id=eq.${crossSale.eventIds[0]}&select=possible_duplicate,duplicate_context`)).data[0];
  const winnerEventId=race.find(x=>x.ok).data.eventIds[0];
  ok("cross-sale duplicate is a redacted hint",crossSaleRow.possible_duplicate===true&&Array.isArray(crossSaleRow.duplicate_context)&&crossSaleRow.duplicate_context.length>0&&!JSON.stringify(crossSaleRow.duplicate_context).includes(saleA.id)&&!JSON.stringify(crossSaleRow.duplicate_context).includes(winnerEventId));
  const duplicateDetails=(await rpc(manager,"crm_kpi_get_duplicate_context",{p_event_ids:crossSale.eventIds})).data;
  ok("manager receives duplicate review context",duplicateDetails.some(row=>row.event_id===crossSale.eventIds[0]&&row.duplicate_employee_id===saleA.id));
  const saleBEvents=(await select(saleB,"kpi_submission_events",`assignment_id=eq.${countA.id}&select=id`)).data;ok("sale B cannot read sale A events",saleBEvents.length===0);
  const direct=await req("/rest/v1/kpi_submission_events",{method:"POST",token:saleA.token,key:anon,body:{},allow:true});ok("direct event write blocked",!direct.ok);
  const anonymous=await req("/rest/v1/rpc/crm_kpi_get_assignment_progress",{method:"POST",token:anon,key:anon,body:{p_period_id:period.id},allow:true});ok("anonymous denied",!anonymous.ok);

  const customerId=`kpi2-customer-${run}`;ids.customers.push(customerId);await req("/rest/v1/customers",{method:"POST",body:{id:customerId,name:"KPI2 Hybrid",owner_user_id:saleA.id,owner_email:saleA.email,created_by_user_id:saleA.id,created_by_email:saleA.email,created_at:eventAt,updated_at:eventAt,raw_data:{testRun:run}}});
  const careAId=`kpi2-care-a-${run}`;ids.careLogs.push(careAId);await req("/rest/v1/care_logs",{method:"POST",body:{id:careAId,customer_id:customerId,customer_name:"KPI2 Hybrid",owner_email:saleA.email,created_by_email:saleA.email,care_channel:"Zalo",care_result:"Da tu van",note:"A before transfer",created_at:eventAt,updated_at:eventAt,raw_data:{testRun:run}}});
  await rpc(manager,"crm_transfer_customer",{p_customer_id:customerId,p_new_owner_email:saleB.email,p_profile_changes:{}});
  const transferred=(await req(`/rest/v1/customers?id=eq.${customerId}&select=owner_user_id,created_by_user_id`)).data[0];
  ok("customer transfer preserves acquisition actor",transferred.owner_user_id===saleB.id&&transferred.created_by_user_id===saleA.id);
  const careBId=`kpi2-care-b-${run}`;ids.careLogs.push(careBId);await req("/rest/v1/care_logs",{method:"POST",body:{id:careBId,customer_id:customerId,customer_name:"KPI2 Hybrid",owner_email:saleB.email,created_by_email:saleB.email,care_channel:"Showroom",care_result:"Hen lai",note:"B after transfer",created_at:revisionEventAt,updated_at:revisionEventAt,raw_data:{testRun:run}}});
  const candidates=(await rpc(saleA,"crm_kpi_list_hybrid_candidates",{p_assignment_id:hybridA.id})).data;
  const candidatesB=(await rpc(saleB,"crm_kpi_list_hybrid_candidates",{p_assignment_id:hybridB.id})).data;
  ok("customers_v1 remains attributed to creator after transfer",candidates.some(x=>x.sourceId===customerId&&!x.claimed)&&!candidatesB.some(x=>x.sourceId===customerId));
  const careCandidatesA=(await rpc(saleA,"crm_kpi_list_hybrid_candidates",{p_assignment_id:careA.id})).data;
  const careCandidatesB=(await rpc(saleB,"crm_kpi_list_hybrid_candidates",{p_assignment_id:careB.id})).data;
  ok("care_logs_v1 follows activity actor across transfer",careCandidatesA.some(x=>x.sourceId===careAId)&&!careCandidatesA.some(x=>x.sourceId===careBId)&&careCandidatesB.some(x=>x.sourceId===careBId)&&!careCandidatesB.some(x=>x.sourceId===careAId));
  const dealsCandidates=await rpc(saleA,"crm_kpi_list_hybrid_candidates",{p_assignment_id:dealsA.id},true);
  ok("deals_v1 remains non-scorable until actor contract exists",!dealsCandidates.ok&&JSON.stringify(dealsCandidates.data).includes("KPI_BUSINESS_SOURCE_NOT_READY"));
  const hybridSub=(await rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:hybridA.id,p_request_id:crypto.randomUUID(),p_sale_note:"hybrid",p_events:[{sourceType:"CUSTOMER",sourceId:customerId,claimedValue:1,evidenceIds:[]}]})).data;ids.submissions.push(hybridSub.submissionId);ids.events.push(...hybridSub.eventIds);

  for(const [name,location] of [
    ["latitude string",{latitude:"10",longitude:106,accuracy:10}],
    ["latitude 91",{latitude:91,longitude:106,accuracy:10}],
    ["latitude -91",{latitude:-91,longitude:106,accuracy:10}],
    ["longitude 181",{latitude:10,longitude:181,accuracy:10}],
    ["longitude -181",{latitude:10,longitude:-181,accuracy:10}],
    ["accuracy zero",{latitude:10,longitude:106,accuracy:0}]
  ]){
    const invalidLocation=await rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:evidenceA.id,p_request_id:crypto.randomUUID(),p_sale_note:name,p_events:[{...manualEvent(),location}]},true);
    ok(`location validator rejects ${name}`,!invalidLocation.ok&&JSON.stringify(invalidLocation.data).includes("KPI_LOCATION_INVALID"));
  }
  const timestampCases=[
    ["invalid type","not-a-time","KPI_TIMESTAMP_INVALID"],
    ["missing timezone",`${month.slice(0,7)}-15T10:00:00`,"KPI_TIMESTAMP_INVALID"],
    ["before period",new Date(new Date(periodDb.starts_at).getTime()-1).toISOString(),"KPI_TIMESTAMP_OUTSIDE_PERIOD"],
    ["after period",periodDb.ends_at,"KPI_TIMESTAMP_OUTSIDE_PERIOD"],
    ["future",new Date(Date.now()+10*60*1000).toISOString(),"KPI_TIMESTAMP_FUTURE"]
  ];
  for(const [name,value,code] of timestampCases){
    const invalidTime=await rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:countA.id,p_request_id:crypto.randomUUID(),p_sale_note:name,p_events:[{...manualEvent(),eventAt:value}]},true);
    ok(`timestamp validator rejects ${name}`,!invalidTime.ok&&JSON.stringify(invalidTime.data).includes(code));
  }
  const boundarySub=(await rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:countA.id,p_request_id:crypto.randomUUID(),p_sale_note:"valid period start",p_events:[{...manualEvent(),eventAt:periodDb.starts_at}]})).data;
  ids.submissions.push(boundarySub.submissionId);ids.events.push(...boundarySub.eventIds);ok("period start boundary is valid",boundarySub.eventIds.length===1);

  const evidenceId=crypto.randomUUID(); const original="proof.jpg"; const path=`kpi2/${saleA.id}/${evidenceId}/${original}`;objectPaths.push(path);const bytes=Buffer.from([0xff,0xd8,0xff,0xd9]);const sha=crypto.createHash("sha256").update(bytes).digest("hex");
  await req(`/storage/v1/object/kpi2-evidence/${path}`,{method:"POST",token:saleA.token,key:anon,raw:bytes,headers:{"Content-Type":"image/jpeg","x-upsert":"false"}});
  const staged=(await rpc(saleA,"crm_kpi_stage_evidence",{p_evidence_id:evidenceId,p_assignment_id:evidenceA.id,p_object_path:path,p_original_name:original,p_mime_type:"image/jpeg",p_size_bytes:bytes.length,p_sha256:sha})).data;ids.evidence.push(staged.id);
  const noEvidence=await rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:evidenceA.id,p_request_id:crypto.randomUUID(),p_sale_note:"missing",p_events:[{...manualEvent(),location:{latitude:10,longitude:106,accuracy:10}}]},true);ok("required evidence fail closed",!noEvidence.ok);
  const noLocation=await rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:evidenceA.id,p_request_id:crypto.randomUUID(),p_sale_note:"missing location",p_events:[{...manualEvent(),evidenceIds:[evidenceId]}]},true);ok("required location fail closed",!noLocation.ok);
  const evSub=(await rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:evidenceA.id,p_request_id:crypto.randomUUID(),p_sale_note:"proof",p_events:[{...manualEvent(),evidenceIds:[evidenceId],location:{latitude:10,longitude:106,accuracy:10}}]})).data;ids.submissions.push(evSub.submissionId);ids.events.push(...evSub.eventIds);
  const evidenceEvent=(await select(saleA,"kpi_submission_events",`id=eq.${evSub.eventIds[0]}&select=location_snapshot`)).data[0];ok("location accuracy stored",Number(evidenceEvent.location_snapshot?.accuracy)===10);
  await rpc(manager,"crm_kpi_review_events",{p_request_id:crypto.randomUUID(),p_rows:[{eventId:evSub.eventIds[0],expectedVersion:1}],p_decision:"APPROVED",p_reason_code:null,p_manager_note:"location privacy fixture"});
  const signed=await req(`/storage/v1/object/sign/kpi2-evidence/${path}`,{method:"POST",token:manager.token,key:anon,body:{expiresIn:60}});ok("manager signed evidence access",signed.ok&&!!signed.data.signedURL);
  const saleBEvidence=(await select(saleB,"kpi_evidence",`id=eq.${evidenceId}&select=id`)).data;ok("sale B cannot read sale A evidence metadata",saleBEvidence.length===0);
  const saleBSigned=await req(`/storage/v1/object/sign/kpi2-evidence/${path}`,{method:"POST",token:saleB.token,key:anon,body:{expiresIn:60},allow:true});ok("sale B cannot sign sale A evidence",!saleBSigned.ok);
  const anonSigned=await req(`/storage/v1/object/sign/kpi2-evidence/${path}`,{method:"POST",token:anon,key:anon,body:{expiresIn:60},allow:true});ok("anonymous cannot sign evidence",!anonSigned.ok);
  const delAttached=await req(`/storage/v1/object/kpi2-evidence/${path}`,{method:"DELETE",token:saleA.token,key:anon,allow:true});ok("attached evidence cannot be deleted by sale",!delAttached.ok);

  const revSub=(await rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:countA.id,p_request_id:crypto.randomUUID(),p_sale_note:"revision seed",p_events:[manualEvent()]})).data;ids.submissions.push(revSub.submissionId);ids.events.push(...revSub.eventIds);
  await rpc(manager,"crm_kpi_review_events",{p_request_id:crypto.randomUUID(),p_rows:[{eventId:revSub.eventIds[0],expectedVersion:1}],p_decision:"NEEDS_REVISION",p_reason_code:"INCOMPLETE_INFORMATION",p_manager_note:"Bổ sung nội dung"});
  const invalidRevision=await rpc(saleA,"crm_kpi_submit_revision",{p_event_id:revSub.eventIds[0],p_request_id:crypto.randomUUID(),p_sale_note:"bad time",p_event:{eventAt:periodDb.ends_at,claimedValue:1,eventSnapshot:{title:"Bad"},evidenceIds:[]}},true);
  ok("revision rejects out-of-period timestamp",!invalidRevision.ok&&JSON.stringify(invalidRevision.data).includes("KPI_TIMESTAMP_OUTSIDE_PERIOD"));
  const revisionRequest=crypto.randomUUID(),revisionPayload={eventAt:revisionEventAt,claimedValue:1,eventSnapshot:{title:"Đã bổ sung"},evidenceIds:[],location:{latitude:10.1,longitude:106.1,accuracy:12}};
  const revision=(await rpc(saleA,"crm_kpi_submit_revision",{p_event_id:revSub.eventIds[0],p_request_id:revisionRequest,p_sale_note:"fixed",p_event:revisionPayload})).data;ids.submissions.push(revision.submissionId);ids.events.push(...revision.eventIds);ok("revision appends history",revision.supersedesEventId===revSub.eventIds[0]);
  const revisionBusinessRow=(await select(saleA,"kpi_submission_events",`id=eq.${revision.eventIds[0]}&select=location_snapshot`)).data[0];
  ok("revision business row retains protected location",Number(revisionBusinessRow.location_snapshot?.latitude)===10.1&&Number(revisionBusinessRow.location_snapshot?.longitude)===106.1);
  const revisionRetry=(await rpc(saleA,"crm_kpi_submit_revision",{p_event_id:revSub.eventIds[0],p_request_id:revisionRequest,p_sale_note:"fixed",p_event:revisionPayload})).data;
  ok("revision idempotency same payload",revisionRetry.submissionId===revision.submissionId);
  const revisionMismatch=await rpc(saleA,"crm_kpi_submit_revision",{p_event_id:revSub.eventIds[0],p_request_id:revisionRequest,p_sale_note:"changed",p_event:revisionPayload},true);
  ok("revision idempotency changed payload rejected",!revisionMismatch.ok&&JSON.stringify(revisionMismatch.data).includes("KPI_IDEMPOTENCY_PAYLOAD_CONFLICT"));
  const reviewRaceSub=(await rpc(saleA,"crm_kpi_submit_events",{p_assignment_id:countA.id,p_request_id:crypto.randomUUID(),p_sale_note:"manager race",p_events:[manualEvent()]})).data;ids.submissions.push(reviewRaceSub.submissionId);ids.events.push(...reviewRaceSub.eventIds);
  const reviewRaceRows=[{eventId:reviewRaceSub.eventIds[0],expectedVersion:1}];
  const reviewRace=await Promise.all([rpc(manager,"crm_kpi_review_events",{p_request_id:crypto.randomUUID(),p_rows:reviewRaceRows,p_decision:"APPROVED",p_reason_code:null,p_manager_note:null},true),rpc(admin,"crm_kpi_review_events",{p_request_id:crypto.randomUUID(),p_rows:reviewRaceRows,p_decision:"REJECTED",p_reason_code:"OUT_OF_SCOPE",p_manager_note:"race"},true)]);
  ok("two-manager review race has one winner",reviewRace.filter(x=>x.ok).length===1);
  const audit=(await req(`/rest/v1/audit_logs?email=in.(${manager.email},${admin.email})&action=in.(event_approve,event_reject,event_needs_revision,bulk_review)&select=action`)).data;
  ok("review actions are audited",audit.some(x=>x.action==="event_approve")&&audit.some(x=>x.action==="bulk_review"));
  const privacyAudit=(await req(`/rest/v1/audit_logs?entity_id=in.(${evSub.eventIds[0]},${revision.eventIds[0]})&action=in.(event_approve,event_revision)&select=action,entity_id,payload_json`)).data;
  const privacyAuditText=JSON.stringify(privacyAudit).toLowerCase();
  ok("location audit rows exist",privacyAudit.some(x=>x.action==="event_approve")&&privacyAudit.some(x=>x.action==="event_revision"));
  ok("generic audit excludes exact location",!privacyAuditText.includes("location_snapshot")&&!privacyAuditText.includes("latitude")&&!privacyAuditText.includes("longitude"));
  ok("generic audit retains sanitized trace metadata",privacyAudit.every(x=>String(x.payload_json||"").includes("locationPresent")&&String(x.payload_json||"").includes("newStatus")&&String(x.payload_json||"").includes("newLockVersion")));
  const actionResponses=(await req(`/rest/v1/kpi_action_requests?actor_user_id=like.kpi2-${run}-*&select=response`)).data;
  const actionResponseText=JSON.stringify(actionResponses).toLowerCase();
  ok("action request responses exclude sensitive payload",!actionResponseText.includes("location_snapshot")&&!actionResponseText.includes("latitude")&&!actionResponseText.includes("longitude")&&!actionResponseText.includes("signedurl"));
  console.log(`KPI-2 staging API: PASS (${checks.length} checks)`);checks.forEach(x=>console.log(`PASS: ${x}`));
}finally{await cleanup();}
