import assert from "node:assert/strict";
import fs from "node:fs";
import {pathToFileURL} from "node:url";

const entry = process.env.PHASE6ID_PLAYWRIGHT_ENTRY;
const browserPath = process.env.PHASE6ID_BROWSER_PATH;
if (!entry || !browserPath) throw new Error("Set PHASE6ID_PLAYWRIGHT_ENTRY and PHASE6ID_BROWSER_PATH.");

const app = fs.readFileSync("js/features/crm-app.js", "utf8");
assert.match(app, /const CUSTOMER_OWNER_UNASSIGNED_VALUE\s*=/, "Customer owner intent contract is missing.");
assert.match(app, /function hydrateCustomerOwnerSelect\(/, "Customer owner rehydrate helper is missing.");
assert.match(app, /function normalizeCustomerCreateResult\(/, "Customer create RPC result normalizer is missing.");

function sliceBetween(start, end) {
  const startIndex = app.indexOf(start);
  const endIndex = app.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Unable to extract ${start} ... ${end}`);
  return app.slice(startIndex, endIndex);
}

const ownerContract = sliceBetween("function fillSelect(", "function hydrateOwnerDependentFilters(");
const customerCreate = sliceBetween("function clearForm()", "async function saveCareLog()");
const html = `<!doctype html><html><body>
  <input id="name"><input id="phone"><input id="address"><input id="customerCompanyName">
  <select id="source"></select><select id="channel"><option value="Khác">Khác</option></select>
  <select id="customerType"><option value="Khác">Khác</option></select><select id="potentialLevel"><option value="Bình thường">Bình thường</option></select>
  <select id="owner"></select><select id="partnerType"></select><select id="partnerActivity"></select><select id="partnerLevel"></select><select id="partnerCapacity"></select>
  <input id="need"><textarea id="note"></textarea><div id="phoneHint"></div>
  <button id="saveCustomerBtn">Lưu khách</button><button id="clearBtn">Xóa form</button><div id="notice"></div>
</body></html>`;

const harness = `
  const $ = id => document.getElementById(id);
  const clean = value => String(value ?? "").trim();
  const normalizeKey = value => clean(value).toLowerCase();
  const esc = value => clean(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
  const optionValue = item => typeof item === "object" ? clean(item.email || item.value || item.name) : clean(item);
  const optionLabel = item => typeof item === "object" ? (clean(item.email) && clean(item.email) !== clean(item.name || item.label || item.email) ? clean(item.name || item.label || item.email) + " (" + clean(item.email) + ")" : clean(item.name || item.label || item.email)) : clean(item);
  const uniqueOptions = values => { const map = new Map(); (values || []).forEach(item => { const value = optionValue(item); if (value && !map.has(value)) map.set(value, {value, label:optionLabel(item)}); }); return [...map.values()]; };
  let appUser = {uid:"owner-id",id:"owner-id",role:"owner",name:"Owner",email:"owner@fixture.test"};
  let currentUser = {email:"owner@fixture.test",displayName:"Owner"};
  let users = [];
  const CUSTOMER_OWNER_UNASSIGNED_VALUE = "__UNASSIGNED__";
  const customerOwnerIntent = {kind:"unset",value:"",explicit:false,unavailable:false};
  let customerCreatePartialState = null;
  const roleKey = () => clean(appUser?.role).toLowerCase();
  const isManager = () => ["owner","admin","manager","quanly","quản lý","quản lí"].includes(roleKey());
  const ownerName = () => clean(appUser?.name) || clean(currentUser?.displayName) || clean(currentUser?.email);
  const ownerEmail = () => clean(appUser?.email) || clean(currentUser?.email);
  const isPartnerChannel = () => false;
  const phoneNorm = value => clean(value).replace(/\D/g, "");
  const systemLabel = key => key === "leadStatus" ? "Lead mới" : "chưa có ngày chăm";
  const serverTimestamp = () => ({__serverTimestamp:true});
  const interestProductFields = input => input?.dataset.productId ? {needProductId:input.dataset.productId,needProductCode:"",needProductSnapshot:{productId:input.dataset.productId,productName:"ABSOLUTE WHITE",catalogVersionSnapshot:2}} : {};
  const hydrateChannelOptions = () => {};
  const togglePartnerFields = () => {};
  const restoreInterestProduct = input => { if (input) { input.dataset.productId=""; input.dataset.productSnapshot=""; } };
  const authMessage = error => error?.message || String(error);
  const duplicateCustomerIdFromError = () => "";
  const openDrawer = () => {};
  const db = {};
  const collection = () => ({});
  const doc = () => ({id:"customer-created"});
  const notices = [];
  const rpcCalls = [];
  let rpcResponse = {id:"customer-created",assigned:true,ownerUserId:"sale-a-id",ownerEmail:"sale-a@fixture.test"};
  const notice = (message,bad=false) => { notices.push({message,bad}); $("notice").textContent=message; };
  const callCrmRpc = async (name,args) => { rpcCalls.push({name,args}); if (rpcResponse instanceof Error) throw rpcResponse; return rpcResponse; };
  ${ownerContract}
  ${customerCreate}
  $("owner").addEventListener("change", event => setCustomerOwnerIntent(event.target.value, true));
  window.phase6id = {
    reset({role="owner",response}={}) {
      appUser = role === "sale"
        ? {uid:"sale-self-id",id:"sale-self-id",role:"sale",name:"Sale Self",email:"sale-self@fixture.test"}
        : {uid:"owner-id",id:"owner-id",role:"owner",name:"Owner",email:"owner@fixture.test"};
      currentUser = {email:appUser.email,displayName:appUser.name};
      users = [{id:"sale-a-id",uid:"sale-a-id",name:"Sale A",email:"sale-a@fixture.test",role:"sale",active:true,lifecycleStatus:"active"},{id:"sale-b-id",uid:"sale-b-id",name:"Sale B",email:"sale-b@fixture.test",role:"sale",active:true,lifecycleStatus:"active"}];
      rpcCalls.length=0;notices.length=0;rpcResponse=response || {id:"customer-created",assigned:true,ownerUserId:role === "sale" ? "sale-self-id" : "sale-a-id",ownerEmail:role === "sale" ? "sale-self@fixture.test" : "sale-a@fixture.test"};
      resetCustomerCreateState();
      for (const id of ["name","phone","address","customerCompanyName","need","note"]) $(id).value="";
      $("name").value="Fixture Customer";$("channel").value="Khác";$("customerType").value="Khác";$("potentialLevel").value="Bình thường";
      $("need").value="ABSOLUTE WHITE";$("need").dataset.productId="product-absolute-white";
      hydrateCustomerOwnerSelect();
    },
    select(value) { $("owner").value=value; $("owner").dispatchEvent(new Event("change",{bubbles:true})); },
    rehydrate() { hydrateCustomerOwnerSelect(); },
    removeSale(email) { users=users.filter(user=>user.email!==email); hydrateCustomerOwnerSelect(); },
    setResponse(response) { rpcResponse=response; },
    submit:saveCustomer,
    clear:clearForm,
    state() { return {ownerValue:$("owner").value,ownerText:$("owner").selectedOptions[0]?.textContent||"",name:$("name").value,notices:[...notices],rpcCalls:[...rpcCalls],partial:customerCreatePartialState?{...customerCreatePartialState}:null,buttonDisabled:$("saveCustomerBtn").disabled,buttonText:$("saveCustomerBtn").textContent}; }
  };
`;

const playwrightModule = await import(pathToFileURL(entry).href);
const {chromium} = playwrightModule.default || playwrightModule;
const browser = await chromium.launch({executablePath:browserPath,headless:true});
const consoleErrors = [], pageErrors = [], failedRequests = [], externalRequests = [];
try {
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("requestfailed", request => failedRequests.push(request.url()));
  page.on("request", request => { if (/^https?:/i.test(request.url())) externalRequests.push(request.url()); });
  await page.setContent(html);
  await page.addScriptTag({content:harness});

  await page.evaluate(() => phase6id.reset());
  await page.selectOption("#owner","sale-a@fixture.test");
  await page.dispatchEvent("#owner","change");
  await page.evaluate(() => { phase6id.rehydrate(); phase6id.rehydrate(); });
  assert.equal(await page.locator("#owner").inputValue(),"sale-a@fixture.test","Repeated rehydrate must preserve Sale A.");
  await page.evaluate(() => phase6id.submit());
  let state = await page.evaluate(() => phase6id.state());
  assert.equal(state.rpcCalls.length,1);
  assert.equal(state.rpcCalls[0].name,"crm_create_customer");
  assert.equal(state.rpcCalls[0].args.p_customer.ownerEmail,"sale-a@fixture.test");
  assert.equal(state.rpcCalls[0].args.p_customer.needProductId,"product-absolute-white");
  assert.equal(state.rpcCalls[0].args.p_customer.needProductSnapshot.productId,"product-absolute-white");
  assert.equal(state.name,"","Assigned success clears the form.");
  assert.match(state.notices.at(-1).message,/phân công cho nhân viên/i);

  await page.evaluate(() => phase6id.reset());
  await page.selectOption("#owner","sale-a@fixture.test");
  await page.dispatchEvent("#owner","change");
  await page.evaluate(() => phase6id.removeSale("sale-a@fixture.test"));
  state = await page.evaluate(() => phase6id.state());
  assert.equal(state.ownerValue,"sale-a@fixture.test","Unavailable Sale intent must remain visible instead of falling back to blank.");
  assert.match(state.ownerText,/không còn khả dụng/i);
  await page.evaluate(() => phase6id.submit());
  state = await page.evaluate(() => phase6id.state());
  assert.equal(state.rpcCalls.length,0,"Unavailable Sale must block create RPC.");
  assert.match(state.notices.at(-1).message,/không còn khả dụng/i);
  assert.equal(state.name,"Fixture Customer","Validation failure keeps the form intact.");

  await page.evaluate(() => phase6id.reset({response:{id:"customer-unassigned",assigned:false,ownerUserId:null,ownerEmail:null}}));
  await page.selectOption("#owner","__UNASSIGNED__");
  await page.dispatchEvent("#owner","change");
  await page.evaluate(() => phase6id.submit());
  state = await page.evaluate(() => phase6id.state());
  assert.equal(state.rpcCalls.length,1);
  assert.equal(state.rpcCalls[0].args.p_customer.ownerEmail,"");
  assert.equal(state.name,"");
  assert.match(state.notices.at(-1).message,/hàng chờ phân bổ/i);

  await page.evaluate(() => phase6id.reset({response:{id:"customer-partial",assigned:false,ownerUserId:null,ownerEmail:null}}));
  await page.selectOption("#owner","sale-a@fixture.test");
  await page.dispatchEvent("#owner","change");
  await page.evaluate(() => phase6id.submit());
  state = await page.evaluate(() => phase6id.state());
  assert.equal(state.partial.customerId,"customer-partial");
  assert.equal(state.name,"Fixture Customer","Semantic partial success must retain the form.");
  assert.equal(state.buttonDisabled,true,"Partial success blocks blind create retry.");
  assert.match(state.notices.at(-1).message,/đã được tạo.*chưa xác nhận.*phân công/i);
  await page.evaluate(() => phase6id.submit());
  state = await page.evaluate(() => phase6id.state());
  assert.equal(state.rpcCalls.length,1,"Partial state must prevent a second create RPC.");
  await page.evaluate(() => phase6id.clear());
  state = await page.evaluate(() => phase6id.state());
  assert.equal(state.partial,null,"Intentional form reset releases the partial-success lock.");
  assert.equal(state.buttonDisabled,false);

  await page.evaluate(() => phase6id.reset({response:{id:"customer-mismatch",assigned:true,ownerUserId:"sale-b-id",ownerEmail:"sale-b@fixture.test"}}));
  await page.selectOption("#owner","sale-a@fixture.test");
  await page.dispatchEvent("#owner","change");
  await page.evaluate(() => phase6id.submit());
  state = await page.evaluate(() => phase6id.state());
  assert.equal(state.partial.customerId,"customer-mismatch");
  assert.doesNotMatch(state.notices.at(-1).message,/đã lưu khách mới và phân công/i);

  await page.evaluate(() => phase6id.reset({response:new Error("RPC transaction rolled back")}));
  await page.selectOption("#owner","sale-a@fixture.test");
  await page.dispatchEvent("#owner","change");
  await page.evaluate(() => phase6id.submit());
  state = await page.evaluate(() => phase6id.state());
  assert.equal(state.partial,null,"Thrown RPC error is not a semantic partial-success result.");
  assert.equal(state.name,"Fixture Customer","Thrown RPC error keeps the form for a safe retry.");
  assert.match(state.notices.at(-1).message,/rolled back/i);

  await page.evaluate(() => phase6id.reset({role:"sale",response:{id:"customer-self",assigned:true,ownerUserId:"sale-self-id",ownerEmail:"sale-self@fixture.test"}}));
  await page.evaluate(() => phase6id.submit());
  state = await page.evaluate(() => phase6id.state());
  assert.equal(state.rpcCalls[0].args.p_customer.ownerEmail,"sale-self@fixture.test");
  assert.match(state.notices.at(-1).message,/phân công cho nhân viên/i);

  for (const viewport of [{width:1440,height:900},{width:768,height:1024},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => phase6id.reset());
    await page.selectOption("#owner","sale-a@fixture.test");
    await page.dispatchEvent("#owner","change");
    await page.evaluate(() => { phase6id.rehydrate(); return phase6id.submit(); });
    state = await page.evaluate(() => phase6id.state());
    assert.equal(state.rpcCalls[0].args.p_customer.ownerEmail,"sale-a@fixture.test",`Owner payload at ${viewport.width}x${viewport.height}`);
  }

  assert.deepEqual(consoleErrors,[],"Console errors must be zero.");
  assert.deepEqual(pageErrors,[],"Page errors must be zero.");
  assert.deepEqual(failedRequests,[],"Failed local requests must be zero.");
  assert.deepEqual(externalRequests,[],"Unexpected external requests must be zero.");
  console.log("PASS Phase 6I-D Customer owner intent + RPC result browser contract (8 cases, 3 viewports)");
} finally {
  await browser.close();
}
