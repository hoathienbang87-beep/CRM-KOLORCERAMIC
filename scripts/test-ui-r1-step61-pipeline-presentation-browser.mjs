import fs from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(process.env.UI_R1_PLAYWRIGHT_ENTRY).href);
const browser = await chromium.launch({executablePath:process.env.UI_R1_BROWSER_PATH,headless:true});
try {
  const page = await browser.newPage();
  const html = fs.readFileSync("index.html","utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"");
  await page.setContent(html);
  await page.addStyleTag({content:fs.readFileSync("css/styles.css","utf8")});
  await page.evaluate(() => {
    loginView.classList.add("hide"); maintenanceView.classList.add("hide"); appView.classList.remove("hide");
    reportsPanel.classList.remove("hide"); reportCustomersPanel.classList.remove("hide"); pipelinePanel.classList.remove("hide");
    pipelineUniqueCount.textContent="3 khách hàng duy nhất";
    pipelineMembershipCount.textContent="4 lượt phân loại theo trạng thái/lịch sử giao dịch";
    pipelineGrid.innerHTML=[['Lead mới',1],['Đã cọc',1],['Đã mua',1],['Không nhu cầu',1]].map(([s,n])=>`<button class="pipeline-card"><span>${s}</span><b>${n} khách</b><span class="pipeline-share">Tỷ trọng lượt phân loại: 25%</span></button>`).join('');
    overviewPipelineSummary.classList.remove("hide"); overviewPipelineContext.textContent="4/6 trạng thái chính";
  });
  for(const width of [1440,1366,1180,390,360]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.locator('#pipelineUniqueCount').innerText(),'3 khách hàng duy nhất');
    assert.equal(await page.locator('#pipelineMembershipCount').innerText(),'4 lượt phân loại theo trạng thái/lịch sử giao dịch');
    assert.equal(await page.locator('#pipelineGrid .pipeline-card').count(),4);
    assert.ok(await page.locator('#pipelineExplanation').isVisible());
    assert.ok((await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth))<=1,`Không tràn ngang tại ${width}px`);
  }
  assert.equal(await page.locator('#overviewPipelineContext').innerText(),'4/6 trạng thái chính');
  assert.equal(await page.locator('#channelReportChart').count(),1);
  assert.equal(await page.locator('#growthChart').count(),1);
  console.log('PASS CRM-UI-R1 STEP6.1 browser fixture: wording, overlap, responsive và Overview context');
} finally { await browser.close(); }
