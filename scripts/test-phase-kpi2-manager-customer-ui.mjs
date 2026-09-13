import assert from "node:assert/strict";
import fs from "node:fs";
import {
  getKpiEventCustomerSnapshot,
  managerKpiCustomerSnapshotHtml,
  managerKpiEventCardHtml,
  managerKpiEventViewModel
} from "../js/features/kpi-team.js";

let checks=0;
const check=(condition,message)=>{checks+=1;assert.ok(condition,message);};
const assignment={assignment_id:"assignment-a",employee_id:"sale-a",employee_name:"Sale A",definition_snapshot:{code:"CARE",name:"Chăm sóc khách hàng"}};
const event={
  id:"event-a",submission_id:"submission-a",assignment_id:"assignment-a",actor_user_id:"sale-a",
  customer_id:"customer-a",customer_name_snapshot:"Nguyễn Văn A",customer_company_name_snapshot:"Công ty ABC",
  customer_phone_snapshot:"0901000000",customer_phone_normalized_snapshot:"84901000000",customer_address_snapshot:"Địa chỉ lịch sử ABC",
  event_snapshot:{title:"Tư vấn mẫu gạch",description:"Đã gửi catalogue",customerName:"LIVE SHOULD NOT RENDER",phone:"0988000000"},
  claimed_value:1,approved_value:null,event_at:"2026-09-05T03:00:00Z",created_at:"2026-09-05T04:00:00Z",
  location_snapshot:{latitude:10,longitude:106},status:"PENDING",lock_version:7,possible_duplicate:true,revision_no:1
};

const customer=getKpiEventCustomerSnapshot(event);
check(customer.linked,"linked Event is detected");
check(customer.customerId==="customer-a","current navigation identity comes from customer_id");
check(customer.name==="Nguyễn Văn A","name comes from dedicated snapshot column");
check(customer.companyName==="Công ty ABC","company comes from dedicated snapshot column");
check(customer.phone==="0901000000","raw snapshot phone is preferred");
check(customer.address==="Địa chỉ lịch sử ABC","address comes from dedicated snapshot column");

const vm=managerKpiEventViewModel({event,assignment,saleName:"Sale A",evidenceCount:2,duplicateCount:1});
check(vm.saleName==="Sale A"&&vm.kpiName==="Chăm sóc khách hàng","view-model includes Sale and KPI");
check(vm.customer.companyName==="Công ty ABC"&&!JSON.stringify(vm).includes("LIVE SHOULD NOT RENDER"),"view-model never uses event_snapshot Customer metadata");
check(vm.eventTitle==="Tư vấn mẫu gạch"&&vm.eventContent==="Đã gửi catalogue","Event content remains available");
check(vm.eventAt!==vm.createdAt,"performed and submitted timestamps stay distinct");
check(vm.evidenceCount===2&&!!vm.location,"evidence and location are normalized");
check(vm.lockVersion===7,"optimistic lock version is preserved");

const card=managerKpiEventCardHtml(vm,{selectable:true,focused:true});
check(["Sale A","Chăm sóc khách hàng","Công ty ABC","Nguyễn Văn A","0901000000","Địa chỉ lịch sử ABC","Tư vấn mẫu gạch","Đã gửi catalogue","2 ảnh minh chứng","Thời gian thực hiện","Thời gian gửi","Chờ duyệt"].every(value=>card.includes(value)),"linked card contains complete Manager context");
check(card.includes('data-kpi-current-customer="customer-a"'),"current Customer action uses customer_id");
check(card.includes('data-version="7"'),"review checkbox keeps lock_version");
check(!card.includes("LIVE SHOULD NOT RENDER")&&!card.includes("0988000000"),"card is snapshot-only, not event JSON/live Customer");

const normalizedPhone=getKpiEventCustomerSnapshot({customer_id:"customer-b",customer_name_snapshot:"B",customer_phone_normalized_snapshot:"84909000000"});
check(normalizedPhone.phone==="84909000000","normalized snapshot phone is the display fallback");
const noneVm=managerKpiEventViewModel({event:{id:"none",event_snapshot:{title:"KPI NONE"},status:"PENDING"},assignment});
check(!noneVm.customer.linked,"legacy/NONE Event is unlinked");
check(managerKpiCustomerSnapshotHtml(noneVm)==="","NONE Event has no Customer block");
const sparseVm=managerKpiEventViewModel({event:{id:"sparse",customer_id:"customer-s",customer_name_snapshot:"Khách S",event_snapshot:{title:"Sparse"}},assignment});
const sparseCard=managerKpiEventCardHtml(sparseVm);
check(sparseCard.includes("Khách S")&&sparseCard.includes("Chưa có thông tin"),"sparse snapshot uses friendly fallback");
check(!/null|undefined/.test(sparseCard),"sparse/legacy UI never renders null or undefined");

const revision1=managerKpiEventViewModel({event:{...event,id:"revision-1",revision_no:1,customer_phone_snapshot:"0901"},assignment});
const revision2=managerKpiEventViewModel({event:{...event,id:"revision-2",revision_no:2,customer_phone_snapshot:"0988",supersedes_event_id:"revision-1"},assignment});
check(revision1.customer.phone==="0901"&&revision2.customer.phone==="0988","each revision uses its own dedicated snapshot");
check(managerKpiEventCardHtml(revision2).includes("Bản bổ sung 2"),"revision number is visible");
const second=managerKpiEventViewModel({event:{...event,id:"event-b",customer_id:"customer-b",customer_name_snapshot:"Khách B",customer_company_name_snapshot:"Công ty B"},assignment});
check(vm.customer.customerId!==second.customer.customerId&&second.customer.name==="Khách B","multiple Events retain separate Customers");

const reviewed=managerKpiEventViewModel({event:{...event,status:"REJECTED",review_reason_code:"OUT_OF_SCOPE",manager_note:"Ngoài phạm vi",reviewed_at:"2026-09-06T03:00:00Z"},assignment});
const reviewedCard=managerKpiEventCardHtml(reviewed);
check(reviewedCard.includes("Từ chối")&&reviewedCard.includes("OUT_OF_SCOPE")&&reviewedCard.includes("Ngoài phạm vi"),"review status, reason and Manager note render together");

const app=fs.readFileSync("js/features/crm-app.js","utf8");
const team=fs.readFileSync("js/features/kpi-team.js","utf8");
check((app.match(/managerKpiEventCardHtml\(/g)||[]).length===2,"employee list and global queue use the same card renderer");
check((app.match(/managerKpiEventViewModel\(/g)||[]).length===2,"employee list and global queue use the same view-model");
check(/customer_name_snapshot[\s\S]*customer_company_name_snapshot[\s\S]*customer_phone_snapshot[\s\S]*customer_address_snapshot/.test(team),"dedicated Customer snapshot fields are mapped centrally");
check(!/event_snapshot\s*\?\?[^\n]*customer/i.test(team),"Customer snapshot helper does not source identity from event_snapshot");
check(/openKpiManagerCurrentCustomer[\s\S]*customers\.find[\s\S]*navigateToWorkspace\("#\/customers\/list"\)[\s\S]*openDrawer\(customer\.id,"care"\)/.test(app),"current profile navigation reuses live Customer workflow");
check(/if\(!customer\)[\s\S]*return notice[\s\S]*closeKpiTeamEmployee/.test(app),"unavailable Customer leaves Event review context open");
check(/crm_kpi_review_events[\s\S]*expectedVersion:Number\(x\.dataset\.version\)/.test(app)||/expectedVersion:Number\(x\.dataset\.version\)[\s\S]*crm_kpi_review_events/.test(app),"review RPC still carries expected lock version");
check((app.match(/crm_kpi_review_events/g)||[]).length===1,"review RPC implementation remains singular");
check(/globalQueueEvidence/.test(app)&&/groupEvidenceCount\(kpiTeamState\.globalQueueEvidence\)/.test(app),"global queue loads and renders evidence consistently");
check(/function viewKpi2Evidence\([\s\S]*openDetailModal\(/.test(app),"Manager evidence viewer reuses canonical detail modal");
check(!/\bopenDetail\(/.test(app),"stale undefined openDetail handler is absent from production app");
check(/urls\.map\(url=>`<img src=/.test(app),"one or two signed evidence URLs render as images");

console.log(`KPI-2 Phase 4 Manager Customer snapshot static: ${checks} checks PASS`);
