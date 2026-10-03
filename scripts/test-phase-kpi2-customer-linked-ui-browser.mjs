import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {assertBrowserObservability,observeBrowserPage} from "./helpers/browser-observability.mjs";

const playwrightEntry = process.env.KPI2_PHASE3_PLAYWRIGHT_ENTRY;
const browserPath = process.env.KPI2_PHASE3_BROWSER_PATH;
if (!playwrightEntry || !browserPath) throw new Error("Set KPI2_PHASE3_PLAYWRIGHT_ENTRY and KPI2_PHASE3_BROWSER_PATH.");
const {chromium} = await import(pathToFileURL(playwrightEntry).href);
const root = path.resolve(import.meta.dirname, "..");
const sourceHtml = fs.readFileSync(path.join(root, "index.html"), "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
const fixtureScript = `<script type="module">import * as api from '/js/features/kpi-customer-link.js';window.kpiPhase3=api;</script>`;

const server = http.createServer((request, response) => {
  const url = decodeURIComponent((request.url || "/").split("?")[0]);
  if (url === "/fixture.html") {
    response.writeHead(200, {"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Connection":"close"});
    response.end(sourceHtml.replace("</body>", `${fixtureScript}</body>`));
    return;
  }
  if (url === "/favicon.ico") { response.writeHead(204); response.end(); return; }
  const file = path.resolve(root, url.replace(/^\//, ""));
  if (!file.startsWith(root) || !fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, {"Content-Type":file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/plain","Connection":"close"});
  fs.createReadStream(file).pipe(response);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

const browser = await chromium.launch({executablePath:browserPath, headless:true});
try {
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  const observability = observeBrowserPage(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture.html`, {waitUntil:"networkidle"});
  await page.waitForFunction(() => !!window.kpiPhase3);
  await page.evaluate(() => {
    loginView.classList.add("hide"); maintenanceView.classList.add("hide"); appView.classList.remove("hide"); appView.removeAttribute("inert");
    customerSearchPanel.classList.remove("hide"); customerSearchPanel.removeAttribute("inert"); customerSearchPanel.setAttribute("aria-hidden","false");
    kpi2OperationsPanel.classList.remove("hide"); kpi2SaleClaimPanel.classList.remove("hide");
    const api = window.kpiPhase3;
    window.required = {assignmentId:"required",periodStatus:"ACTIVE",definitionSnapshot:{name:"KPI REQUIRED",customer_relation_mode:"REQUIRED"}};
    window.optional = {assignmentId:"optional",periodStatus:"ACTIVE",definitionSnapshot:{name:"KPI OPTIONAL",customer_relation_mode:"OPTIONAL"}};
    window.none = {assignmentId:"none",periodStatus:"ACTIVE",definitionSnapshot:{name:"KPI NONE",customer_relation_mode:"NONE"}};
    window.customerA = {id:"customer-a",name:"Nguyễn A",company_name:"Công ty A",phone_raw:"0901000000",address:"Hà Nội"};
    window.phase3State = api.createKpiEventFormState();
    window.phase3Refs = {assignmentArea:kpi2ClaimAssignmentArea,assignmentSelect:kpi2ClaimAssignmentSelect,assignmentHint:kpi2ClaimAssignmentHint,customerArea:kpi2CustomerArea,customerLabel:kpi2CustomerLabel,customerSearchInput:kpi2CustomerSearchInput,customerSearchWrap:kpi2CustomerSearchWrap,customerSearchResults:kpi2CustomerSearchResults,selectedCustomer:kpi2SelectedCustomer,eventFields:kpi2EventFields,submit:kpi2SubmitBtn};
    window.renderPhase3 = () => api.renderKpiCustomerLinkUi(phase3State, phase3Refs);
    window.phase3Customers = [customerA];
    window.renderCustomerQuickActions = () => {
      customerRows.innerHTML = phase3Customers.map(customer => `<tr data-customer-row="${customer.id}"><td><div class="row-actions"><button class="small primary" type="button" data-open-care="${customer.id}">Chăm sóc KH</button><button class="small" type="button" data-open-deal="${customer.id}">Mua căn bản</button>${api.customerKpiQuickActionHtml(customer.id,true)}</div></td></tr>`).join("");
    };
    document.addEventListener("click", event => {
      const id = event.target.closest("[data-kpi2-customer-entry]")?.dataset.kpi2CustomerEntry;
      if (!id) return;
      const customer = phase3Customers.find(row => row.id === id);
      api.resetKpiEventFormState(phase3State);
      phase3State.entryPoint = "customer";
      phase3State.assignmentOptions = [required];
      api.setKpiEventCustomer(phase3State, customer);
      api.setKpiEventAssignment(phase3State, required, {preserveCustomer:true});
      renderPhase3();
    });
    renderCustomerQuickActions();
  });

  // Customer list quick action: existing row, shared state and unchanged sibling actions.
  const existingActions = page.locator('[data-customer-row="customer-a"] .row-actions');
  assert.equal(await existingActions.locator("button").count(), 3, "Customer row has care, deal and KPI actions");
  assert.deepEqual(await existingActions.locator("button").allTextContents(), ["Chăm sóc KH","Mua căn bản","Đề xuất KPI"]);
  await existingActions.locator("[data-kpi2-customer-entry]").click();
  assert.equal(await page.evaluate(() => phase3State.customer?.id), "customer-a", "clicked Customer is preselected");
  assert.match(await page.locator("#kpi2SelectedCustomer").textContent(), /Công ty A.*Nguyễn A.*0901000000.*Hà Nội/s, "live Customer details render in shared form");

  // Newly saved/rendered Customer gains the action and works without navigation/reload.
  await page.evaluate(() => {
    phase3Customers.push({id:"customer-new",name:"Khách vừa lưu",company_name:"Công ty mới",phone_raw:"0912000000",address:"Đà Nẵng"});
    renderCustomerQuickActions();
  });
  const newAction = page.locator('[data-customer-row="customer-new"] [data-kpi2-customer-entry]');
  assert.equal(await newAction.isVisible(), true, "newly rendered Customer has the KPI action without reload");
  await newAction.click();
  assert.equal(await page.evaluate(() => phase3State.customer?.id), "customer-new", "newly saved Customer is immediately preselected");
  assert.match(await page.locator("#kpi2SelectedCustomer").textContent(), /Công ty mới.*Khách vừa lưu.*0912000000.*Đà Nẵng/s);

  // A. NONE
  await page.evaluate(() => { kpiPhase3.setKpiEventAssignment(phase3State, none); phase3State.assignmentOptions=[none]; renderPhase3(); });
  assert.equal(await page.locator("#kpi2CustomerArea").isVisible(), false, "NONE hides Customer UI");
  assert.equal(await page.locator("#kpi2SubmitBtn").isEnabled(), true, "NONE preserves submit behavior");

  // B. REQUIRED
  await page.evaluate(() => { kpiPhase3.setKpiEventAssignment(phase3State, required); phase3State.assignmentOptions=[required]; renderPhase3(); });
  assert.equal(await page.locator("#kpi2CustomerArea").isVisible(), true, "REQUIRED shows selector");
  assert.equal(await page.locator("#kpi2CustomerLabel").textContent(), "Khách hàng *");
  assert.equal(await page.locator("#kpi2SubmitBtn").isDisabled(), true, "REQUIRED blocks submit without Customer");
  await page.evaluate(() => { kpiPhase3.setKpiEventCustomer(phase3State, customerA); renderPhase3(); });
  assert.equal(await page.locator("#kpi2SubmitBtn").isEnabled(), true, "REQUIRED enables submit after selection");
  const selectedText = await page.locator("#kpi2SelectedCustomer").textContent();
  assert.match(selectedText, /Nguyễn A/); assert.match(selectedText, /Công ty A/);

  // C/D. OPTIONAL empty and linked/unlink UI
  await page.evaluate(() => { kpiPhase3.setKpiEventAssignment(phase3State, optional, {preserveCustomer:false}); phase3State.assignmentOptions=[optional]; renderPhase3(); });
  assert.equal(await page.locator("#kpi2SubmitBtn").isEnabled(), true, "OPTIONAL empty can submit");
  await page.evaluate(() => { kpiPhase3.setKpiEventCustomer(phase3State, customerA); renderPhase3(); });
  assert.equal(await page.locator("[data-kpi2-unlink-customer]").isVisible(), true, "OPTIONAL linked can unlink");
  assert.equal(await page.locator("#kpi2SelectedCustomer input").count(), 0, "selected Customer panel is read-only");

  // E/F/G. Customer entry assignment choices
  const eligible = await page.evaluate(() => kpiPhase3.eligibleKpiCustomerAssignments([required,optional,none]).map(row => row.assignmentId));
  assert.deepEqual(eligible, ["required","optional"], "Customer entry lists only REQUIRED/OPTIONAL");
  assert.equal(await page.evaluate(() => kpiPhase3.eligibleKpiCustomerAssignments([none]).length), 0, "no applicable KPI is detected");
  await page.evaluate(() => { kpiPhase3.resetKpiEventFormState(phase3State); phase3State.entryPoint="customer"; phase3State.assignmentOptions=[required,optional]; kpiPhase3.setKpiEventCustomer(phase3State,customerA); renderPhase3(); });
  assert.equal(await page.locator("#kpi2ClaimAssignmentSelect option").count(), 3, "multiple KPI shows prompt plus choices");
  assert.equal(await page.locator("#kpi2EventFields").isVisible(), false, "event fields wait for assignment choice");
  assert.match(await page.locator("#kpi2SelectedCustomer").textContent(), /Nguyễn A/, "Customer remains visibly preselected before KPI choice");

  // H. Search states and identifying fields
  await page.evaluate(() => { kpiPhase3.setKpiEventAssignment(phase3State,required,{preserveCustomer:false}); phase3State.search={query:"0901",rows:[customerA],loading:false,error:"",requestId:1}; renderPhase3(); });
  const resultText = await page.locator("[data-kpi2-select-customer='customer-a']").textContent();
  assert.match(resultText, /Nguyễn A/); assert.match(resultText, /Công ty A/); assert.match(resultText, /0901000000/);
  await page.evaluate(() => { phase3State.search.loading=true; renderPhase3(); });
  assert.match(await page.locator("#kpi2CustomerSearchResults").textContent(), /Đang tìm/);
  await page.evaluate(() => { phase3State.search.loading=false; phase3State.search.rows=[]; renderPhase3(); });
  assert.match(await page.locator("#kpi2CustomerSearchResults").textContent(), /Không tìm thấy/);
  await page.evaluate(() => { phase3State.search.error="failed"; renderPhase3(); });
  assert.match(await page.locator("#kpi2CustomerSearchResults").textContent(), /Không thể tải/);

  // J/K/L. Error mapping and stale state transitions
  const friendly = await page.evaluate(() => kpiPhase3.kpiCustomerSubmitError({code:"42501",message:"Ban khong co quyen truy cap Customer nay."}));
  assert.equal(friendly.clearCustomer, true); assert.doesNotMatch(friendly.message, /42501|permission denied/i);
  const stale = await page.evaluate(() => { kpiPhase3.setKpiEventCustomer(phase3State,customerA); kpiPhase3.setKpiEventAssignment(phase3State,none,{preserveCustomer:true}); return {customer:phase3State.customer,payload:kpiPhase3.buildKpiCustomerEventPayload(phase3State,[{customerId:"stale"}])}; });
  assert.equal(stale.customer, null, "NONE clears prior Customer");
  assert.equal("customerId" in stale.payload.events[0], false, "NONE payload omits stale Customer");

  for (const [width,height] of [[1440,900],[768,1024],[390,844]]) {
    await page.setViewportSize({width,height});
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `Customer-linked form does not overflow at ${width}px`);
    const actionOverflow = await page.locator('[data-customer-row="customer-new"] .row-actions').evaluate(element => element.scrollWidth-element.clientWidth);
    assert.ok(actionOverflow <= 1, `three Customer actions do not overflow their group at ${width}px`);
  }
  assert.equal(await page.locator("#kpi2CustomerEntryBtn").getAttribute("type"), "button", "Customer action is a real button");
  assertBrowserObservability(observability);
  console.log("KPI-2 Phase 3 browser UI: A-L state/render/mobile contracts PASS");
} finally {
  await browser.close();
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}
