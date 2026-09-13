import assert from "node:assert/strict";
import fs from "node:fs";
import {pathToFileURL} from "node:url";

const entry = process.env.PHASE6G_PLAYWRIGHT_ENTRY;
const browserPath = process.env.PHASE6G_BROWSER_PATH;
if (!entry || !browserPath) throw new Error("Set PHASE6G_PLAYWRIGHT_ENTRY and PHASE6G_BROWSER_PATH.");
const {chromium} = await import(pathToFileURL(entry).href);
const app = fs.readFileSync("js/features/crm-app.js", "utf8");
const lifecycle = app.slice(app.indexOf("const drawerCustomerById"), app.indexOf("async function permanentlyDeleteCustomer"));
const html = fs.readFileSync("index.html", "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
const css = fs.readFileSync("css/styles.css", "utf8");
const harness = `
  const $ = id => document.getElementById(id);
  const clean = value => String(value ?? "").trim();
  const esc = value => clean(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
  let appUser = {role:"sale"};
  let currentUser = {email:"owner@fixture.test"};
  let allCustomers = [], customers = [], deletedCustomers = [], customerAssignments = [], selectedCustomerId = "";
  const isManager = () => ["owner","admin","manager"].includes(clean(appUser.role).toLowerCase());
  const canAccessAdminPanel = () => ["owner","admin"].includes(clean(appUser.role).toLowerCase());
  const customerOwnerName = customer => clean(customer.owner || customer.ownerEmail) || "Chưa phân công";
  const notices = [];
  const rpcCalls = [];
  const notice = (message, bad = false) => notices.push({message,bad});
  const callCrmRpc = async (name,args) => { rpcCalls.push({name,args}); return {id:args.p_customer_id}; };
  const openDetailModal = (title,subtitle,content) => { detailModalTitle.textContent=title;detailModalSubtitle.textContent=subtitle;detailModalContent.innerHTML=content;detailModal.classList.remove("hide");detailModalBackdrop.classList.remove("hide"); };
  const closeDetailModal = () => { detailModal.classList.add("hide");detailModalBackdrop.classList.add("hide"); };
  const renderAll = () => { window.__renderCount=(window.__renderCount||0)+1; };
  const renderCustomerInfo = customer => { window.__lastRenderedCustomer=customer; };
  const openDrawer = customerId => { selectedCustomerId=customerId; const customer=drawerCustomerById(customerId); renderCustomerLifecycle(customer); drawer.classList.remove("hide"); };
  ${lifecycle}
  window.phase6g = {
    setFixture(role, customer, assignment) { appUser={role}; allCustomers=[{...customer}]; customers=customer.isDeleted?[]:[allCustomers[0]]; deletedCustomers=customer.isDeleted?[allCustomers[0]]:[]; customerAssignments=assignment?[{...assignment}]:[]; selectedCustomerId=customer.id; notices.length=0;rpcCalls.length=0;drawer.classList.remove("hide");renderCustomerLifecycle(allCustomers[0]); },
    setRole(role) { appUser={role}; renderCustomerLifecycle(drawerCustomerById(selectedCustomerId)); },
    renderCustomerLifecycle,openUnassignCustomerModal,openArchiveCustomerModal,restoreCustomer,confirmCustomerLifecycle,
    state() { return {allCustomers,customers,deletedCustomers,customerAssignments,notices,rpcCalls}; }
  };
`;

const browser = await chromium.launch({executablePath:browserPath, headless:true});
try {
  const page = await browser.newPage({viewport:{width:390,height:900}});
  await page.setContent(html);
  await page.addStyleTag({content:css});
  await page.addScriptTag({content:harness});
  const customer = {id:"customer-fixture",name:"Khách Fixture",owner:"Sale A",ownerEmail:"sale-a@fixture.test",isDeleted:false};
  const assignment = {id:"assignment-fixture",customerId:"customer-fixture",employeeNameSnapshot:"Sale A",employeeEmailSnapshot:"sale-a@fixture.test",isCurrent:true};

  await page.evaluate(({customer,assignment}) => phase6g.setFixture("sale",customer,assignment), {customer,assignment});
  assert.equal(await page.locator("#customerLifecycleSection").isVisible(), false, "Sale must not see lifecycle controls.");

  for (const role of ["manager","owner"]) {
    await page.evaluate(({role,customer,assignment}) => phase6g.setFixture(role,customer,assignment), {role,customer,assignment});
    assert.equal(await page.locator("#customerLifecycleSection").isVisible(), true, `${role} sees lifecycle controls.`);
    assert.equal(await page.locator("#unassignCustomerBtn").isEnabled(), true);
    assert.equal(await page.locator("#archiveCustomerBtn").isDisabled(), true, "Archive is disabled until unassign.");
  }

  await page.evaluate(({customer,assignment}) => phase6g.setFixture("manager",customer,assignment), {customer,assignment});
  await page.evaluate(() => phase6g.openUnassignCustomerModal());
  assert.match(await page.locator("#detailModalContent").textContent(), /Khách hàng sẽ không còn thuộc Sale A/);
  await page.locator("#customerUnassignReason").fill("Điều chỉnh phân công fixture");
  await page.evaluate(() => phase6g.confirmCustomerLifecycle("unassign","customer-fixture"));
  let state = await page.evaluate(() => phase6g.state());
  assert.deepEqual(state.rpcCalls[0], {name:"crm_unassign_customer",args:{p_customer_id:"customer-fixture",p_reason:"Điều chỉnh phân công fixture"}});
  assert.equal(state.customerAssignments[0].isCurrent,false);
  assert.equal(state.customers.length,1,"Unassigned Customer remains active.");

  await page.evaluate(() => phase6g.renderCustomerLifecycle(phase6g.state().allCustomers[0]));
  assert.equal(await page.locator("#archiveCustomerBtn").isEnabled(),true);
  await page.evaluate(() => phase6g.openArchiveCustomerModal());
  assert.match(await page.locator("#detailModalContent").textContent(), /ẩn khỏi danh sách hoạt động.*lịch sử.*snapshot KPI/s);
  await page.evaluate(() => phase6g.confirmCustomerLifecycle("archive","customer-fixture"));
  state = await page.evaluate(() => phase6g.state());
  assert.deepEqual(state.rpcCalls[1], {name:"crm_set_customer_archived",args:{p_customer_id:"customer-fixture",p_archived:true}});
  assert.equal(state.customers.length,0,"Archived Customer leaves the active list.");
  assert.equal(state.deletedCustomers.length,1,"Archived Customer is retained, not hard-deleted.");

  await page.evaluate(() => { phase6g.setRole("owner"); phase6g.restoreCustomer("customer-fixture"); });
  assert.equal(await page.locator("#confirmCustomerLifecycleBtn").isVisible(),true);
  await page.evaluate(() => phase6g.confirmCustomerLifecycle("restore","customer-fixture"));
  state = await page.evaluate(() => phase6g.state());
  assert.deepEqual(state.rpcCalls[2], {name:"crm_set_customer_archived",args:{p_customer_id:"customer-fixture",p_archived:false}});
  assert.equal(state.customers.length,1,"Restored Customer returns active and unassigned.");

  for (const width of [390,360]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(() => phase6g.renderCustomerLifecycle(phase6g.state().allCustomers[0]));
    const layout = await page.locator("#customerLifecycleSection").evaluate(element => ({right:element.getBoundingClientRect().right,viewport:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
    assert.ok(layout.right <= layout.viewport + 1 && layout.scroll <= layout.viewport + 1, `Lifecycle controls fit ${width}px.`);
    for (const button of await page.locator("#customerLifecycleSection button:visible").all()) assert.ok((await button.boundingBox()).height >= 44, `Lifecycle button is touch-safe at ${width}px.`);
  }

  console.log("Phase 6G Customer lifecycle browser fixture: Sale/Manager/Owner, unassign/archive/restore/list/mobile PASS");
} finally {
  await browser.close();
}
