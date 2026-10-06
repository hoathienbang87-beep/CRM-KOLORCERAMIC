import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {assertBrowserObservability,observeBrowserPage} from "./helpers/browser-observability.mjs";

const entry=process.env.KPI2_PHASE4_PLAYWRIGHT_ENTRY,browserPath=process.env.KPI2_PHASE4_BROWSER_PATH;
if(!entry||!browserPath)throw new Error("Set KPI2_PHASE4_PLAYWRIGHT_ENTRY and KPI2_PHASE4_BROWSER_PATH.");
const {chromium}=await import(pathToFileURL(entry).href),root=path.resolve(import.meta.dirname,"..");
const appSource=fs.readFileSync(path.join(root,"js/features/crm-app.js"),"utf8");
function productionFunction(name,nextName){
  const pattern=value=>new RegExp(`(?:async\\s+)?function\\s+${value}\\s*\\(`),match=pattern(name).exec(appSource);
  if(!match)throw new Error(`Production function ${name} was not found.`);
  const remainder=appSource.slice(match.index+match[0].length),next=pattern(nextName).exec(remainder);
  if(!next)throw new Error(`Production boundary ${nextName} was not found after ${name}.`);
  return appSource.slice(match.index,match.index+match[0].length+next.index).trim();
}
const productionBoundaries=[["resetKpi2EvidenceDropState","kpi2ClipboardFile"],["kpi2ClipboardFile","normalizeKpi2EvidenceFiles"],["normalizeKpi2EvidenceFiles","isKpi2TextEditable"],["isKpi2TextEditable","kpi2ClipboardFiles"],["kpi2ClipboardFiles","setKpi2EvidenceDragActive"],["setKpi2EvidenceDragActive","kpi2EvidenceValue"],["renderKpi2StagedEvidence","restoreKpi2StagedEvidence"],["handleKpi2EvidenceFiles","handleKpi2EvidenceDragEnter"],["handleKpi2EvidenceDragEnter","handleKpi2EvidenceDragOver"],["handleKpi2EvidenceDragOver","handleKpi2EvidenceDragLeave"],["handleKpi2EvidenceDragLeave","handleKpi2EvidenceDrop"],["handleKpi2EvidenceDrop","handleKpi2EvidencePaste"],["handleKpi2EvidencePaste","discardKpi2StagedEvidence"]];
const productionLogic=productionBoundaries.map(([name,nextName])=>productionFunction(name,nextName)).join("\n");
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/css/styles.css"></head><body><section id="kpi2SaleClaimPanel" class="kpi2-workspace"><input id="kpi2ClaimAssignmentId" value="assignment-local"><div class="field"><label for="kpi2EvidenceFiles">Ảnh minh chứng (tối đa 2)</label><div id="kpi2EvidenceDropZone" class="kpi2-evidence-dropzone" tabindex="0" role="group" aria-describedby="kpi2EvidenceHelp"><div class="kpi2-evidence-drop-copy"><strong>Kéo ảnh vào đây</strong><span id="kpi2EvidenceHelp" class="muted kpi2-evidence-desktop-help">hoặc Ctrl+V để dán ảnh từ clipboard</span><span class="muted kpi2-evidence-mobile-help">Chọn ảnh từ thiết bị</span></div><label class="button small" for="kpi2EvidenceFiles">Chọn ảnh</label><input id="kpi2EvidenceFiles" class="visually-hidden" type="file" accept="image/jpeg,image/webp,image/png" multiple></div><div id="kpi2StagedEvidenceList" class="kpi2-staged-evidence-list"></div><div id="notice"></div></div></section><script src="/fixture-evidence-input.js"></script></body></html>`;
const fixtureScript=`
const $=id=>document.getElementById(id),clean=value=>String(value??'').trim(),esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const KPI2_EVIDENCE_MAX_SOURCE_BYTES=20*1024*1024,KPI2_EVIDENCE_MIME_TYPES=new Set(['image/jpeg','image/png','image/webp']);
let kpi2StagedEvidence=[],kpi2EvidenceBusy=false,kpi2EvidenceDragDepth=0,stageCalls=[];
const kpi2ClaimState={evidenceMode:'OPTIONAL',evidenceMax:2,evidence:[]};function renderKpi2ClaimCustomerUi(){}
const notices=[];function notice(message,error=false){notices.push({message,error});$('notice').textContent=message;}
async function stageKpi2Evidence(assignmentId,file){stageCalls.push({assignmentId,name:file.name,type:file.type,size:file.size});return {id:'local-'+stageCalls.length,assignmentId,originalName:file.name,status:'STAGED',lockVersion:1,previewUrl:URL.createObjectURL(file)};}
async function runAction(_button,_key,_label,action){try{return await action();}catch(error){notice(error.message,true);}}
${productionLogic}
$('kpi2EvidenceFiles').addEventListener('change',domEvent=>runAction('', 'kpi2EvidenceUpload', 'Đang tải ảnh...',()=>handleKpi2EvidenceFiles(domEvent.target.files,{source:'picker'})));
$('kpi2EvidenceDropZone').addEventListener('dragenter',handleKpi2EvidenceDragEnter);$('kpi2EvidenceDropZone').addEventListener('dragover',handleKpi2EvidenceDragOver);$('kpi2EvidenceDropZone').addEventListener('dragleave',handleKpi2EvidenceDragLeave);$('kpi2EvidenceDropZone').addEventListener('drop',handleKpi2EvidenceDrop);$('kpi2SaleClaimPanel').addEventListener('paste',handleKpi2EvidencePaste);
document.addEventListener('click',domEvent=>{const button=domEvent.target.closest('[data-kpi2-discard-evidence]');if(!button)return;const index=kpi2StagedEvidence.findIndex(item=>item.id===button.dataset.kpi2DiscardEvidence);if(index<0)return;const [item]=kpi2StagedEvidence.splice(index,1);if(item.previewUrl)URL.revokeObjectURL(item.previewUrl);renderKpi2StagedEvidence();});
renderKpi2StagedEvidence();window.evidenceFixture={state:()=>({items:kpi2StagedEvidence.map(item=>({id:item.id,name:item.originalName,status:item.status})),stageCalls:[...stageCalls],notices:[...notices],dragDepth:kpi2EvidenceDragDepth,evidenceMode:kpi2ClaimState.evidenceMode,evidenceMax:kpi2ClaimState.evidenceMax}),setContract:(mode,max)=>{kpi2ClaimState.evidenceMode=mode;kpi2ClaimState.evidenceMax=max;}};`;
const server=http.createServer((request,response)=>{const url=decodeURIComponent((request.url||"/").split("?")[0]);if(url==="/fixture.html"){response.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Connection":"close"});return response.end(html);}if(url==="/fixture-evidence-input.js"){response.writeHead(200,{"Content-Type":"text/javascript; charset=utf-8","Connection":"close"});return response.end(fixtureScript);}if(url==="/favicon.ico"){response.writeHead(204);return response.end();}const file=path.resolve(root,url.replace(/^\//,""));if(!file.startsWith(root)||!fs.existsSync(file)){response.writeHead(404);return response.end();}response.writeHead(200,{"Content-Type":"text/css","Connection":"close"});fs.createReadStream(file).pipe(response);});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch({executablePath:browserPath,headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),observability=observeBrowserPage(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture.html`);
  try{await page.waitForFunction(()=>!!window.evidenceFixture,null,{timeout:5000});}catch(error){throw new Error(`Evidence fixture did not initialize: ${JSON.stringify(observability)}`,{cause:error});}
  const zone=page.locator('#kpi2EvidenceDropZone'),picker=page.locator('#kpi2EvidenceFiles'),list=page.locator('#kpi2StagedEvidenceList');
  assert.equal(await zone.getAttribute('tabindex'),'0');assert.equal(await picker.getAttribute('multiple'),'');assert.equal(await picker.getAttribute('accept'),'image/jpeg,image/webp,image/png');

  await picker.setInputFiles({name:'picker-proof.png',mimeType:'image/png',buffer:Buffer.from('picker-image')});await page.waitForFunction(()=>window.evidenceFixture.state().items.length===1);assert.match(await list.textContent(),/picker-proof\.png/);assert.equal(await list.locator('img').count(),1);assert.equal(await list.locator('[data-kpi2-discard-evidence]').count(),1);
  await list.locator('[data-kpi2-discard-evidence]').click();await page.waitForFunction(()=>window.evidenceFixture.state().items.length===0);assert.doesNotMatch(await list.textContent(),/picker-proof/);

  const pastePrevented=await page.evaluate(()=>{const file=new File(['paste-image'],'',{type:'image/png'}),item={kind:'file',type:'image/png',getAsFile:()=>file},domEvent=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(domEvent,'clipboardData',{value:{items:[item]}});document.getElementById('kpi2SaleClaimPanel').dispatchEvent(domEvent);return domEvent.defaultPrevented;});
  assert.equal(pastePrevented,true);await page.waitForFunction(()=>window.evidenceFixture.state().items.length===1);let state=await page.evaluate(()=>window.evidenceFixture.state());assert.match(state.items[0].name,/^kpi-evidence-paste-\d+\.png$/);assert.match(await list.textContent(),/kpi-evidence-paste-/);

  const dropPrevented=await page.evaluate(()=>{const zoneElement=document.getElementById('kpi2EvidenceDropZone'),transfer=new DataTransfer();transfer.items.add(new File(['drop-image'],'drop-proof.webp',{type:'image/webp'}));for(const type of ['dragenter','dragover'])zoneElement.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:transfer}));const domEvent=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer});zoneElement.dispatchEvent(domEvent);return domEvent.defaultPrevented;});
  assert.equal(dropPrevented,true);await page.waitForFunction(()=>window.evidenceFixture.state().items.length===2);state=await page.evaluate(()=>window.evidenceFixture.state());assert.deepEqual(state.items.map(item=>item.name),[state.items[0].name,'drop-proof.webp']);assert.equal(state.stageCalls.length,3);assert.equal(await zone.evaluate(node=>node.classList.contains('is-drag-active')),false);assert.equal(state.dragDepth,0);assert.equal(await list.locator('.kpi2-staged-evidence-item').count(),2);assert.equal(await list.locator('img').count(),2);
  await list.locator('[data-kpi2-discard-evidence]').first().click();await page.waitForFunction(()=>window.evidenceFixture.state().items.length===1);assert.doesNotMatch(await list.textContent(),/kpi-evidence-paste-/);assert.match(await list.textContent(),/drop-proof\.webp/);

  await page.evaluate(()=>window.evidenceFixture.setContract('REQUIRED',1));
  const callsBeforeSecond=(await page.evaluate(()=>window.evidenceFixture.state())).stageCalls.length;
  await picker.setInputFiles({name:'blocked-second.png',mimeType:'image/png',buffer:Buffer.from('blocked-second')});
  await page.waitForFunction(()=>/tối đa 1 ảnh/.test(document.getElementById('notice').textContent));
  state=await page.evaluate(()=>window.evidenceFixture.state());assert.equal(state.items.length,1,"REQUIRED max one keeps the first Evidence only");assert.equal(state.stageCalls.length,callsBeforeSecond,"REQUIRED max one does not stage/upload a second Evidence");

  await page.evaluate(()=>window.evidenceFixture.setContract('NONE',0));
  const callsBeforeNone=(await page.evaluate(()=>window.evidenceFixture.state())).stageCalls.length;
  await picker.setInputFiles({name:'blocked-none.png',mimeType:'image/png',buffer:Buffer.from('blocked-none')});
  await page.waitForFunction(()=>/không nhận ảnh minh chứng/.test(document.getElementById('notice').textContent));
  state=await page.evaluate(()=>window.evidenceFixture.state());assert.equal(state.stageCalls.length,callsBeforeNone,"NONE never calls the staging/upload function");

  for(const [width,height] of [[1440,900],[768,1024],[390,844]]){await page.setViewportSize({width,height});const overflow=await page.evaluate(()=>document.getElementById('kpi2SaleClaimPanel').scrollWidth-document.getElementById('kpi2SaleClaimPanel').clientWidth);assert.ok(overflow<=1,`evidence input must not overflow at ${width}px`);assert.equal(await page.getByText('Xóa ảnh',{exact:true}).isVisible(),true);assert.equal(await page.getByText('Chọn ảnh',{exact:true}).isVisible(),true);}
  assertBrowserObservability(observability);
  console.log('KPI-2 Phase 6I evidence input browser: picker/paste/drop/staged preview + responsive contracts PASS');
}finally{await browser.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
