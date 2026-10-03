import assert from "node:assert/strict";
import fs from "node:fs";
import {evidenceForEvent,kpiEvidenceThumbnailsHtml,managerKpiEventCardHtml,managerKpiEventViewModel} from "../js/features/kpi-team.js";

const app=fs.readFileSync("js/features/crm-app.js","utf8"),css=fs.readFileSync("css/styles.css","utf8");
const checks=[];const check=(value,label)=>{assert.ok(value,label);checks.push(label);};
const rows=[
  {id:"proof-a",event_id:"event-a",previewUrl:"https://example.invalid/a.jpg",mime_type:"image/jpeg"},
  {id:"proof-b",event_id:"event-a",previewUrl:"https://example.invalid/b.mp4",mime_type:"video/mp4"},
  {id:"proof-c",event_id:"event-b",previewUrl:"https://example.invalid/c.jpg",mime_type:"image/jpeg"}
];

check(evidenceForEvent(rows,"event-a").length===2,"event evidence is grouped and capped at two");
const thumbnails=kpiEvidenceThumbnailsHtml(rows.slice(0,2),"event-a");
check((thumbnails.match(/class="kpi-evidence-thumbnail"/g)||[]).length===2,"two evidence items render two thumbnails");
check(thumbnails.includes('data-kpi2-evidence-id="proof-a"')&&thumbnails.includes('data-kpi2-evidence-id="proof-b"'),"each thumbnail targets its exact evidence id");
check(thumbnails.includes('<img')&&thumbnails.includes('<video'),"image and video previews use their native media element");
check(thumbnails.includes('preload="metadata"')&&thumbnails.includes('▶')&&!/autoplay/.test(thumbnails),"video preview has a play cue without autoplay");
check(kpiEvidenceThumbnailsHtml([],"event-a")==="","events without evidence render no thumbnail block");

const vm=managerKpiEventViewModel({event:{id:"event-a",event_snapshot:{title:"TEST"}},evidence:rows.slice(0,2)});
const card=managerKpiEventCardHtml(vm,{selectable:true});
check(card.includes('2 minh chứng')&&card.includes('kpi-evidence-thumbnails'),"shared KPI card includes inline thumbnails and count");
check(card.includes('data-kpi2-view-evidence="event-a"'),"thumbnail reuses the existing large-viewer action");
check(/createSignedUrls\(paths,KPI2_EVIDENCE_SIGNED_URL_SECONDS\)/.test(app),"card previews use one batch signed-URL request");
check(/KPI2_EVIDENCE_SIGNED_URL_SECONDS = 120/.test(app),"thumbnail URL expiry remains 120 seconds");
check(/createSignedUrl\(e\.object_path,120\)/.test(app),"large viewer keeps its existing fresh signed-URL call");
check(/viewKpi2Evidence\(kpi2EvidenceEventId,kpi2EvidenceId\)/.test(app),"thumbnail click passes the selected evidence id to the existing viewer");
check(/\.kpi-evidence-thumbnail\{[^}]*width:118px;height:108px/.test(css),"desktop thumbnail dimensions remain compact and readable");
check(/\.kpi-evidence-thumbnail-media\{[^}]*object-fit:cover/.test(css),"thumbnail media preserves a useful crop");
check(/@media\(max-width:768px\)[\s\S]*\.kpi-evidence-thumbnail\{width:92px;height:86px\}/.test(css),"mobile thumbnail dimensions are reduced");

console.log(`KPI-2 Phase 6J inline evidence static: ${checks.length} checks PASS`);
