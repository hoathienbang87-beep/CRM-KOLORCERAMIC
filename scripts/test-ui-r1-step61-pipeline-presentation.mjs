import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("js/features/crm-app.js", "utf8");

assert.match(html, /id="pipelineUniqueCount"/);
assert.match(html, /id="pipelineMembershipCount"/);
assert.match(html, /Một khách hàng có thể xuất hiện ở nhiều trạng thái khi có lịch sử giao dịch khác nhau\./);
assert.match(app, /const uniqueCount = currentReportCustomers\(\)\.length/);
assert.match(app, /const membershipCount = data\.reduce\(\(sum,item\) => sum \+ item\.count, 0\)/);
assert.doesNotMatch(app, /pipelineRangeText"\)\.textContent = `\$\{data\.reduce[\s\S]*?khách theo trạng thái hiện tại/);
assert.match(app, /Tỷ trọng lượt phân loại: \$\{esc\(pct\)\}%/);
assert.doesNotMatch(app, /item\.count \/ uniqueCount/);
assert.match(app, /const data = allStages\.slice\(0, 4\)/);
assert.match(app, /`\$\{data\.length\}\/\$\{allStages\.length\} trạng thái chính`/);
assert.equal((html.match(/id="channelReportChart"/g) || []).length, 1);
assert.equal((html.match(/id="growthChart"/g) || []).length, 1);
assert.match(html, /id="reportCustomersPanel"[\s\S]*?id="pipelinePanel"/);
assert.match(app, /if \(sameLabel\(label, "boughtStatus"\)\) return customerHasCompletedDeal/);
assert.match(app, /if \(sameLabel\(label, "depositStatus"\)\) return customerHasDealStatus/);
assert.match(app, /if \(sameLabel\(label, "canceledStatus"\)\) return customerHasDealStatus/);

const summarize = (uniqueCount, counts) => ({uniqueCount, membershipCount:counts.reduce((sum,count)=>sum+count,0)});
assert.deepEqual(summarize(0, []), {uniqueCount:0, membershipCount:0});
assert.deepEqual(summarize(10, [4,3,3]), {uniqueCount:10, membershipCount:10});
assert.deepEqual(summarize(3, [1,1,1,1]), {uniqueCount:3, membershipCount:4});
assert.deepEqual(summarize(100, [70,30,20,10]), {uniqueCount:100, membershipCount:130});

console.log("PASS CRM-UI-R1 STEP6.1 static: unique customers và stage memberships được trình bày tách biệt");
