import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {pathToFileURL} from "node:url";

const entry=process.env.KPI2_PHASE4_PLAYWRIGHT_ENTRY,browserPath=process.env.KPI2_PHASE4_BROWSER_PATH;
if(!entry||!browserPath)throw new Error("Set KPI2_PHASE4_PLAYWRIGHT_ENTRY and KPI2_PHASE4_BROWSER_PATH.");
const {chromium}=await import(pathToFileURL(entry).href),root=path.resolve(import.meta.dirname,"..");
const html=`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/css/styles.css"></head><body><main id="employee"></main><main id="global"></main><aside id="live"></aside><div id="notice"></div><script type="module">import * as api from '/js/features/kpi-team.js';window.phase4=api;</script></body></html>`;
const server=http.createServer((request,response)=>{const url=decodeURIComponent((request.url||"/").split("?")[0]);if(url==="/fixture.html"){response.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Connection":"close"});return response.end(html);}const file=path.resolve(root,url.replace(/^\//,""));if(!file.startsWith(root)||!fs.existsSync(file)){response.writeHead(404);return response.end();}response.writeHead(200,{"Content-Type":file.endsWith(".js")?"text/javascript":"text/css","Connection":"close"});fs.createReadStream(file).pipe(response);});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch({executablePath:browserPath,headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:900}});await page.goto(`http://127.0.0.1:${server.address().port}/fixture.html`,{waitUntil:"networkidle"});await page.waitForFunction(()=>!!window.phase4);
  await page.evaluate(()=>{
    window.assignment={assignment_id:"a",employee_name:"Sale A",definition_snapshot:{code:"CARE",name:"Chăm sóc khách hàng"}};
    window.eventA={id:"a1",assignment_id:"a",actor_user_id:"sale-a",customer_id:"customer-a",customer_name_snapshot:"Nguyễn A",customer_company_name_snapshot:"Công ty ABC",customer_phone_snapshot:"0901",customer_address_snapshot:"Địa chỉ lịch sử rất dài nhưng không được làm vỡ bố cục card trên điện thoại",event_snapshot:{title:"Tư vấn",description:"Đã gửi catalogue",customerName:"Tên live không hợp lệ"},claimed_value:1,event_at:"2026-09-05T03:00:00Z",created_at:"2026-09-05T04:00:00Z",location_snapshot:{latitude:10},status:"PENDING",lock_version:4};
    window.vmA=phase4.managerKpiEventViewModel({event:eventA,assignment,saleName:"Sale A",evidenceCount:2});
    employee.innerHTML=phase4.managerKpiEventCardHtml(vmA,{selectable:true});global.innerHTML=phase4.managerKpiEventCardHtml(vmA,{openAction:true});
    window.liveCustomers={"customer-a":{name:"Nguyễn A hiện tại",company:"Công ty XYZ",phone:"0988"}};
    document.addEventListener("click",e=>{const id=e.target.closest("[data-kpi-current-customer]")?.dataset.kpiCurrentCustomer;if(!id)return;const current=liveCustomers[id];if(current)live.textContent=`${current.name} · ${current.company} · ${current.phone}`;else notice.textContent="Không thể mở hồ sơ khách hàng hiện tại.";});
  });

  // A. Linked Event context
  const employeeText=await page.locator("#employee").textContent();
  for(const value of ["Sale A","Chăm sóc khách hàng","Công ty ABC","Nguyễn A","0901","Địa chỉ lịch sử","Tư vấn","2 minh chứng","Thời gian thực hiện","Thời gian gửi","Chờ duyệt"])assert.match(employeeText,new RegExp(value));
  assert.equal(await page.locator("#employee [data-kpi2-review-event]").getAttribute("data-version"),"4");
  await page.locator("#employee [data-kpi2-review-event]").check();assert.equal(await page.locator("#employee [data-kpi2-review-event]").isChecked(),true);
  assert.equal(await page.locator("#employee [data-kpi2-view-evidence]").isVisible(),true);

  // B/C. NONE and sparse
  await page.evaluate(()=>{const none=phase4.managerKpiEventViewModel({event:{id:"none",event_snapshot:{title:"NONE"},status:"PENDING"},assignment});live.insertAdjacentHTML("beforeend",phase4.managerKpiEventCardHtml(none));const sparse=phase4.managerKpiEventViewModel({event:{id:"sparse",customer_id:"s",customer_name_snapshot:"Khách S",event_snapshot:{title:"Sparse"}},assignment});live.insertAdjacentHTML("beforeend",phase4.managerKpiEventCardHtml(sparse));});
  assert.equal(await page.locator('[data-kpi-manager-event="none"] .kpi-manager-customer').count(),0);
  const sparseText=await page.locator('[data-kpi-manager-event="sparse"]').textContent();assert.match(sparseText,/Khách S/);assert.match(sparseText,/Chưa có thông tin/);assert.doesNotMatch(sparseText,/null|undefined/);

  // D. Historical snapshot and separate live navigation
  await page.locator("#employee [data-kpi-current-customer]").click();
  assert.match(await page.locator("#live").textContent(),/Công ty XYZ.*0988/s);
  assert.match(await page.locator("#employee").textContent(),/Công ty ABC.*0901/s);
  assert.doesNotMatch(await page.locator("#employee").textContent(),/Công ty XYZ|0988/);

  // E/F. Archived/unavailable does not remove snapshot card
  await page.evaluate(()=>{delete liveCustomers["customer-a"];notice.textContent="";});await page.locator("#global [data-kpi-current-customer]").click();
  assert.match(await page.locator("#notice").textContent(),/Không thể mở/);assert.match(await page.locator("#global").textContent(),/Công ty ABC/);

  // G/H. Same semantics across views and per-Event Customers
  assert.equal(await page.locator("#employee .kpi-manager-customer").textContent(),await page.locator("#global .kpi-manager-customer").textContent());
  await page.evaluate(()=>{const b=phase4.managerKpiEventViewModel({event:{...eventA,id:"b1",customer_id:"customer-b",customer_name_snapshot:"Khách B",customer_company_name_snapshot:"Công ty B"},assignment});global.insertAdjacentHTML("beforeend",phase4.managerKpiEventCardHtml(b));});
  assert.match(await page.locator('[data-kpi-manager-event="a1"]').first().textContent(),/Nguyễn A/);assert.match(await page.locator('[data-kpi-manager-event="b1"]').textContent(),/Khách B/);

  // I/J/K. Revision and review controls
  await page.evaluate(()=>{const revision=phase4.managerKpiEventViewModel({event:{...eventA,id:"r2",revision_no:2,customer_phone_snapshot:"0988",status:"REJECTED",review_reason_code:"OUT_OF_SCOPE",manager_note:"Ngoài phạm vi"},assignment});global.insertAdjacentHTML("beforeend",phase4.managerKpiEventCardHtml(revision,{selectable:true}));});
  const revisionText=await page.locator('[data-kpi-manager-event="r2"]').textContent();assert.match(revisionText,/0988/);assert.match(revisionText,/Bản bổ sung 2/);assert.match(revisionText,/OUT_OF_SCOPE/);assert.match(revisionText,/Ngoài phạm vi/);
  assert.equal(await page.locator('[data-kpi-manager-event="r2"] [data-kpi2-review-event]').getAttribute("data-version"),"4");

  // L. Mobile
  for(const width of [390,360]){await page.setViewportSize({width,height:900});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert.ok(overflow<=1,`Manager Event cards overflow at ${width}px`);}
  console.log("KPI-2 Phase 4 browser UI: A-L snapshot/navigation/review/mobile contracts PASS");
}finally{await browser.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
