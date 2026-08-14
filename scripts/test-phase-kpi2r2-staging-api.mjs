import crypto from "node:crypto";

const ref=process.env.STAGING_PROJECT_REF||"",base=(process.env.STAGING_SUPABASE_URL||"").replace(/\/$/,""),anon=process.env.STAGING_ANON_KEY||"",service=process.env.STAGING_SERVICE_ROLE_KEY||"";
if(ref!=="ykhtpvyelpujykheycsv"||base!==`https://${ref}.supabase.co`||!anon||!service)throw new Error("KPI-2R.2 staging guard failed.");
const run=crypto.randomBytes(5).toString("hex"),password=`${crypto.randomBytes(18).toString("base64url")}aA1!`,checks=[],authIds=[],objectPaths=[];
const users=["manager","admin","saleA","saleB"].map(key=>({key,role:key.startsWith("sale")?"sale":key,id:`kpi2r2-${run}-${key}`,email:`kpi2r2-${run}-${key.toLowerCase()}@example.com`}));
let periodId,definitionId,assignmentA,assignmentB;
const ok=(name,value)=>{if(!value)throw new Error(`CHECK FAILED: ${name}`);checks.push(name)};
async function req(path,{method="GET",token=service,key=service,body,raw,headers={},allow=false}={}){const response=await fetch(`${base}${path}`,{method,signal:AbortSignal.timeout(90000),headers:{apikey:key,Authorization:`Bearer ${token}`,...headers,...(body===undefined?{}:{"Content-Type":"application/json"})},body:raw??(body===undefined?undefined:JSON.stringify(body))});const text=await response.text();let data=null;if(text)try{data=JSON.parse(text)}catch{data=text}if(!allow&&!response.ok)throw new Error(`${method} ${path}: HTTP ${response.status} ${JSON.stringify(data)?.slice(0,200)}`);return{ok:response.ok,status:response.status,data}}
const rpc=(user,name,body,allow=false)=>req(`/rest/v1/rpc/${name}`,{method:"POST",token:user.token,key:anon,body,allow});
const rows=(table,query)=>req(`/rest/v1/${table}?${query}`);
const storageObjects=prefix=>req("/storage/v1/object/list/kpi2-evidence",{method:"POST",body:{prefix,limit:100,offset:0,sortBy:{column:"name",order:"asc"}}});
const storageObjectExists=async path=>{const split=path.lastIndexOf("/"),prefix=path.slice(0,split),name=path.slice(split+1);return(await storageObjects(prefix)).data.some(item=>item.name===name)};
const user=key=>users.find(item=>item.key===key);
const forgetPath=path=>{const index=objectPaths.indexOf(path);if(index>=0)objectPaths.splice(index,1)};
async function createUser(item){const auth=await req("/auth/v1/admin/users",{method:"POST",body:{email:item.email,password,email_confirm:true}});item.authId=auth.data.id;authIds.push(item.authId);await req("/rest/v1/app_users",{method:"POST",body:{id:item.id,supabase_auth_id:item.authId,email:item.email,name:`KPI2R2 ${item.key}`,role:item.role,active:true,lifecycle_status:"active",raw_data:{testRun:run,purpose:"KPI-2R.2 staging"}}});const login=await req("/auth/v1/token?grant_type=password",{method:"POST",token:anon,key:anon,body:{email:item.email,password}});item.token=login.data.access_token}
async function stage(item,assignment,label){const id=crypto.randomUUID(),name=`${label}.jpg`,path=`kpi2/${item.id}/${id}/${name}`,bytes=Buffer.from([0xff,0xd8,0xff,0xdb,0x00,0x43,0x00,0xff,0xd9]),hash=crypto.createHash("sha256").update(bytes).digest("hex");const upload=await req(`/storage/v1/object/kpi2-evidence/${path}`,{method:"POST",token:item.token,key:anon,raw:bytes,headers:{"Content-Type":"image/jpeg","x-upsert":"false"}});ok(`${label} upload`,upload.ok);objectPaths.push(path);const metadata=(await rpc(item,"crm_kpi_stage_evidence",{p_evidence_id:id,p_assignment_id:assignment,p_object_path:path,p_original_name:name,p_mime_type:"image/jpeg",p_size_bytes:bytes.length,p_sha256:hash})).data;return{id,path,lockVersion:Number(metadata.lock_version),item}}
async function requestDiscard(evidence,requestId=crypto.randomUUID(),expected=evidence.lockVersion,actor=evidence.item,allow=false){return rpc(actor,"crm_kpi_request_discard_staged_evidence",{p_evidence_id:evidence.id,p_request_id:requestId,p_expected_lock_version:expected},allow)}
async function removeObject(evidence,actor=evidence.item,allow=false){return req("/storage/v1/object/kpi2-evidence",{method:"DELETE",token:actor.token,key:anon,body:{prefixes:[evidence.path]},allow})}
async function finalize(evidence,requestId=crypto.randomUUID(),expected=evidence.lockVersion,actor=evidence.item,allow=false){return rpc(actor,"crm_kpi_finalize_discard_staged_evidence",{p_evidence_id:evidence.id,p_request_id:requestId,p_expected_lock_version:expected},allow)}
async function canonicalDiscard(evidence){if(!evidence.archived){const requested=await requestDiscard(evidence);evidence.lockVersion=Number(requested.data.lockVersion);evidence.archived=true}await removeObject(evidence);ok("canonical Storage delete",!(await storageObjectExists(evidence.path)));const finalized=await finalize(evidence);ok("canonical finalize",finalized.ok&&finalized.data.discarded===true&&finalized.data.metadataDeleted===true);forgetPath(evidence.path);return finalized.data}
async function cleanup(){
  for(const item of users.filter(candidate=>candidate.token)){
    const evidenceRows=(await rows("kpi_evidence",`uploaded_by_user_id=eq.${item.id}&select=id,object_path,status,lock_version`)).data;
    for(const row of evidenceRows){
      if(row.status==="ATTACHED")continue;
      const evidence={id:row.id,path:row.object_path,lockVersion:Number(row.lock_version),item,archived:row.status==="ARCHIVED"};
      await canonicalDiscard(evidence);
    }
    const leftovers=(await storageObjects(`kpi2/${item.id}`)).data;
    if(leftovers.length)throw new Error(`Canonical cleanup left ${leftovers.length} Storage object(s) for ${item.id}.`);
  }
  await req(`/rest/v1/kpi_action_requests?actor_user_id=like.kpi2r2-${run}-*`,{method:"DELETE",allow:true});if(assignmentA||assignmentB)await req(`/rest/v1/kpi_assignments?id=in.(${[assignmentA,assignmentB].filter(Boolean).join(",")})`,{method:"DELETE",allow:true});if(definitionId)await req(`/rest/v1/kpi_definitions?id=eq.${definitionId}`,{method:"DELETE",allow:true});if(periodId)await req(`/rest/v1/kpi_periods?id=eq.${periodId}`,{method:"DELETE",allow:true});await req(`/rest/v1/audit_logs?email=like.kpi2r2-${run}-*`,{method:"DELETE",allow:true});await req(`/rest/v1/app_users?id=like.kpi2r2-${run}-*`,{method:"DELETE",allow:true});for(const id of authIds.reverse())await req(`/auth/v1/admin/users/${id}`,{method:"DELETE",allow:true})
}

try{
  for(const item of users)await createUser(item);const manager=user("manager"),admin=user("admin"),saleA=user("saleA"),saleB=user("saleB");
  const used=(await rows("kpi_periods","select=period_month")).data.map(row=>row.period_month);const month=["2023-01-01","2023-02-01","2023-03-01","2023-04-01","2023-05-01","2023-06-01","2023-07-01","2023-08-01","2023-09-01","2023-10-01","2023-11-01","2023-12-01"].find(value=>!used.includes(value));if(!month)throw new Error("No unused staging month for KPI-2R.2.");
  const period=(await rpc(manager,"crm_kpi_create_period",{p_period_month:month,p_name:`KPI2R2 ${run}`,p_timezone:"Asia/Ho_Chi_Minh"})).data;periodId=period.id;
  const definition=(await rpc(manager,"crm_kpi_create_definition_v2",{p_code:`KPI2R2_${run}`.toUpperCase(),p_name:"KPI2R2 evidence",p_description:"staging fixture",p_kpi_type:"MANUAL",p_source_metric_key:null,p_unit:"luot",p_submission_mode:"EVENT_CLAIM",p_evidence_required:false,p_aggregation_mode:"COUNT",p_max_images_per_event:2,p_location_required:false,p_timestamp_required:true})).data;definitionId=definition.id;
  const a=(await rpc(manager,"crm_kpi_assign_employee",{p_period_id:periodId,p_definition_id:definitionId,p_employee_id:saleA.id,p_target:2,p_expected_period_version:period.version})).data;assignmentA=a.id;
  const b=(await rpc(manager,"crm_kpi_assign_employee",{p_period_id:periodId,p_definition_id:definitionId,p_employee_id:saleB.id,p_target:2,p_expected_period_version:a.periodVersion})).data;assignmentB=b.id;
  await rpc(manager,"crm_kpi_activate_period",{p_period_id:periodId,p_expected_version:b.periodVersion});

  const first=await stage(saleA,assignmentA,"own-staged");
  const ownSigned=await req(`/storage/v1/object/sign/kpi2-evidence/${first.path}`,{method:"POST",token:saleA.token,key:anon,body:{expiresIn:120}});ok("Sale signs own STAGED evidence",ownSigned.ok&&!!ownSigned.data.signedURL);
  const managerSigned=await req(`/storage/v1/object/sign/kpi2-evidence/${first.path}`,{method:"POST",token:manager.token,key:anon,body:{expiresIn:120}});ok("Manager signs permitted evidence",managerSigned.ok&&!!managerSigned.data.signedURL);
  const otherSigned=await req(`/storage/v1/object/sign/kpi2-evidence/${first.path}`,{method:"POST",token:saleB.token,key:anon,body:{expiresIn:120},allow:true});ok("Sale B cannot sign Sale A evidence",!otherSigned.ok);
  const anonymousSigned=await req(`/storage/v1/object/sign/kpi2-evidence/${first.path}`,{method:"POST",token:anon,key:anon,body:{expiresIn:120},allow:true});ok("Anonymous cannot sign evidence",!anonymousSigned.ok);
  await removeObject(first,saleA,true);ok("Storage delete before discard request denied",await storageObjectExists(first.path));
  const directMetadataDelete=await req(`/rest/v1/kpi_evidence?id=eq.${first.id}`,{method:"DELETE",token:saleA.token,key:anon,allow:true});ok("Sale direct metadata delete denied",!directMetadataDelete.ok);
  const otherDiscard=await requestDiscard(first,crypto.randomUUID(),first.lockVersion,saleB,true);ok("Sale B cannot discard Sale A evidence",!otherDiscard.ok);
  const managerDiscard=await requestDiscard(first,crypto.randomUUID(),first.lockVersion,manager,true);ok("Manager cannot use Sale discard RPC",!managerDiscard.ok);
  const adminDiscard=await requestDiscard(first,crypto.randomUUID(),first.lockVersion,admin,true);ok("Admin cannot use Sale discard RPC",!adminDiscard.ok);
  const anonymousDiscard=await req("/rest/v1/rpc/crm_kpi_request_discard_staged_evidence",{method:"POST",token:anon,key:anon,body:{p_evidence_id:first.id,p_request_id:crypto.randomUUID(),p_expected_lock_version:first.lockVersion},allow:true});ok("Anonymous discard denied",!anonymousDiscard.ok);

  const requestId=crypto.randomUUID(),requested=await requestDiscard(first,requestId);ok("own STAGED request discard",requested.ok&&requested.data.status==="ARCHIVED");first.lockVersion=Number(requested.data.lockVersion);first.archived=true;
  const replay=await requestDiscard(first,requestId,first.lockVersion-1);ok("discard request idempotent replay",replay.ok&&replay.data.lockVersion===requested.data.lockVersion);
  const archivedSigned=await req(`/storage/v1/object/sign/kpi2-evidence/${first.path}`,{method:"POST",token:saleA.token,key:anon,body:{expiresIn:120},allow:true});ok("ARCHIVED evidence is no longer signable",!archivedSigned.ok);
  await removeObject(first,saleB,true);ok("foreign Storage delete fails",await storageObjectExists(first.path));
  const pending=(await rows("kpi_evidence",`id=eq.${first.id}&select=status,discarded_at,lock_version`)).data[0];ok("DB request success plus Storage failure remains reconcilable",pending.status==="ARCHIVED"&&pending.discarded_at===null&&Number(pending.lock_version)===first.lockVersion);
  await removeObject(first);ok("owner Storage delete removes archived object",!(await storageObjectExists(first.path)));forgetPath(first.path);
  const wrongFinalize=await finalize(first,crypto.randomUUID(),first.lockVersion+1,saleA,true);ok("finalize stale version denied after Storage delete",!wrongFinalize.ok&&JSON.stringify(wrongFinalize.data).includes("KPI_EVIDENCE_VERSION_CONFLICT"));
  const finalizeRequest=crypto.randomUUID(),finalized=await finalize(first,finalizeRequest);ok("finalize removes metadata after object absence",finalized.ok&&finalized.data.metadataDeleted===true);const finalizeReplay=await finalize(first,finalizeRequest,first.lockVersion);ok("finalize retry idempotent after metadata deletion",finalizeReplay.ok&&finalizeReplay.data.evidenceId===first.id);
  ok("normal discard metadata residue zero",(await rows("kpi_evidence",`id=eq.${first.id}&select=id`)).data.length===0);ok("normal discard Storage residue zero",!(await storageObjectExists(first.path)));

  const second=await stage(saleA,assignmentA,"payload-conflict"),third=await stage(saleA,assignmentA,"race");
  const conflictRequest=crypto.randomUUID(),secondRequested=await requestDiscard(second,conflictRequest);second.lockVersion=Number(secondRequested.data.lockVersion);second.archived=true;const differentPayload=await requestDiscard(third,conflictRequest,third.lockVersion,saleA,true);ok("same request with different evidence conflicts",!differentPayload.ok&&JSON.stringify(differentPayload.data).includes("KPI_IDEMPOTENCY_PAYLOAD_CONFLICT"));await canonicalDiscard(second);
  const race=await Promise.all([requestDiscard(third,crypto.randomUUID(),third.lockVersion,saleA,true),requestDiscard(third,crypto.randomUUID(),third.lockVersion,saleA,true)]);ok("two-tab discard race exactly one winner",race.filter(result=>result.ok).length===1);const raceWinner=race.find(result=>result.ok);third.lockVersion=Number(raceWinner.data.lockVersion);third.archived=true;await canonicalDiscard(third);

  const fourth=await stage(saleA,assignmentA,"missing-object-retry");const fourthRequest=await requestDiscard(fourth);fourth.lockVersion=Number(fourthRequest.data.lockVersion);fourth.archived=true;await removeObject(fourth);forgetPath(fourth.path);const secondRemove=await removeObject(fourth,saleA,true);ok("already missing Storage object is retry-safe",secondRemove.ok&&!(await storageObjectExists(fourth.path)));await finalize(fourth);ok("missing-object finalize removes metadata",(await rows("kpi_evidence",`id=eq.${fourth.id}&select=id`)).data.length===0);

  const audit=(await rows("audit_logs",`email=eq.${saleA.email}&action=in.(evidence_discard_requested,evidence_discarded)&select=action,entity_id,payload_json`)).data;ok("discard request and completion audited",audit.some(row=>row.action==="evidence_discard_requested")&&audit.some(row=>row.action==="evidence_discarded"));const auditText=JSON.stringify(audit).toLowerCase();ok("discard audit excludes secrets and signed URLs",!auditText.includes("signedurl")&&!auditText.includes("authorization")&&!auditText.includes("image bytes"));
  const remainingObjects=(await storageObjects(`kpi2/${saleA.id}`)).data;const remainingEvidence=(await rows("kpi_evidence",`uploaded_by_user_id=eq.${saleA.id}&select=id`)).data;ok("KPI-2R.2 canonical evidence cleanup residue zero",remainingObjects.length===0&&remainingEvidence.length===0);
  console.log(`KPI-2R.2 staging API: PASS (${checks.length} checks)`);checks.forEach(name=>console.log(`PASS: ${name}`));
}finally{await cleanup()}
