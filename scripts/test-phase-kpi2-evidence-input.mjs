import assert from "node:assert/strict";
import fs from "node:fs";

const html=fs.readFileSync("index.html","utf8");
const css=fs.readFileSync("css/styles.css","utf8");
const app=fs.readFileSync("js/features/crm-app.js","utf8");
const checks=[];
const check=(condition,label)=>{assert.ok(condition,label);checks.push(label);};

check(/id="kpi2EvidenceDropZone"[^>]*tabindex="0"[^>]*role="group"/.test(html),"drop zone is keyboard accessible");
check(/id="kpi2EvidenceFiles"[^>]*accept="image\/jpeg,image\/webp,image\/png"[^>]*multiple/.test(html),"picker preserves the current MIME and multiple-file contract");
check(/Kéo ảnh vào đây/.test(html)&&/Ctrl\+V để dán ảnh/.test(html),"desktop helper explains drop and paste");
check(/kpi2-evidence-mobile-help/.test(html)&&/Chọn ảnh từ thiết bị/.test(html),"mobile helper keeps picker-first wording");
check(/\.kpi2-evidence-dropzone\.is-drag-active/.test(css),"drag-active state has a visible style");
check(/@media\(max-width:600px\)[\s\S]*kpi2-evidence-desktop-help\{display:none\}/.test(css),"desktop-only helper is hidden on mobile");

check(/function normalizeKpi2EvidenceFiles\(/.test(app),"one canonical file normalizer exists");
check(/KPI2_EVIDENCE_MAX_FILES=2/.test(app),"evidence limit remains two");
for(const type of ["image/jpeg","image/png","image/webp"])check(app.includes(`'${type}'`),`normalizer permits ${type}`);
check(/KPI2_EVIDENCE_MAX_SOURCE_BYTES=20\*1024\*1024/.test(app),"20MB source limit remains unchanged");
check(/handleKpi2EvidenceFiles\(e\.target\.files,\{source:'picker'\}\)/.test(app),"picker uses the canonical handler");
check(/handleKpi2EvidenceFiles\(files,\{source:'drop'\}\)/.test(app),"drop uses the canonical handler");
check(/handleKpi2EvidenceFiles\(files,\{source:'clipboard'\}\)/.test(app),"paste uses the canonical handler");
check((app.match(/const item=await stageKpi2Evidence\(assignmentId,file\)/g)||[]).length===1,"all sources share the existing staging/upload call");
check(/event\.preventDefault\(\);resetKpi2EvidenceDropState\(\)/.test(app),"drop prevents browser file navigation and clears drag state");
check(/isKpi2TextEditable\(event\.target\)\)return;[\s\S]*event\.preventDefault\(\)/.test(app),"text-editable paste exits before preventDefault");
check(/clipboardData\?\.items/.test(app)&&/item\.kind==='file'/.test(app),"clipboard reads file items only");
check(/kpi-evidence-paste-\$\{Date\.now\(\)\}/.test(app),"unnamed clipboard files receive a safe local name");
check(/files\.slice\(0,remaining\)/.test(app)&&/rejectedForCapacity/.test(app),"multiple input respects remaining capacity without replacement");
check(/resetKpi2EvidenceDropState\(\);\s*renderKpi2StagedEvidence/.test(app),"form cleanup clears temporary drag state");
check((app.match(/on\("kpi2SaleClaimPanel", "paste"/g)||[]).length===1,"paste listener is registered once");
check(!/addEventListener\(['"]paste['"]/.test(app),"no duplicate ad-hoc paste listener exists");

console.log(`KPI-2 Phase 6I evidence input static: ${checks.length} checks PASS`);
