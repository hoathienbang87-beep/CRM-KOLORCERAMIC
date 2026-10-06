import assert from "node:assert/strict";
import fs from "node:fs";
import {pathToFileURL} from "node:url";

const entry = process.env.CATALOG_ADMIN_PLAYWRIGHT_ENTRY;
const browserPath = process.env.CATALOG_ADMIN_BROWSER_PATH;
if (!entry || !browserPath) throw new Error("CATALOG_ADMIN_PLAYWRIGHT_ENTRY and CATALOG_ADMIN_BROWSER_PATH are required.");
const {chromium} = await import(pathToFileURL(entry).href).then(module => module.default || module);
const browser = await chromium.launch({executablePath:browserPath,headless:true});
const read = file => fs.readFileSync(file,"utf8");
const html = read("admin/index.html").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"");
const apiSource = read("js/admin/catalog-admin-api.js").replaceAll("export function","function");
const appSource = read("js/admin/catalog-admin-app.js")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/catalog-admin-api\.js";\s*/,"")
  .replace(/import\s*\{createCatalogAdminImport\}\s*from\s*"\.\/catalog-admin-import\.js";\s*/,"")
  .replaceAll("export function","function");
const importStub = "function createCatalogAdminImport(){return {bind(){},loadHistory:async()=>{},showPage(){}};}";
const owner = {id:"owner",name:"Owner Fixture",email:"owner@fixture.invalid",role:"owner",active:true,lifecycle_status:"active"};
const session = {user:{id:"auth-owner",email:"owner@fixture.invalid"}};

async function boot({initial="success",timeoutMs=40}={}) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {if(message.type()==="error")errors.push(message.text());});
  await page.route("**/*", route => route.abort());
  await page.setContent(html);
  await page.addStyleTag({content:read("css/catalog-admin.css")});
  await page.addScriptTag({content:apiSource+"\n"+importStub+"\n"+appSource});
  await page.evaluate(({initial,timeoutMs,owner,session}) => {
    let subscriber = null;
    const queue = [];
    const pending = new Map();
    const settled = [];
    const deferred = key => {
      let resolve,reject;
      const promise = new Promise((yes,no)=>{resolve=yes;reject=no;});
      pending.set(key,{resolve,reject});
      return promise.finally(()=>settled.push(key));
    };
    if(initial==="slow")queue.push(deferred("initial"));
    else if(initial==="reject")queue.push(Promise.reject(new Error("initial profile rejected")));
    const api = {
      getSession:async()=>session,
      onAuthStateChange:callback=>{subscriber=callback;return()=>{subscriber=null;};},
      profile:async()=>queue.length?await queue.shift():owner,
      signIn:async()=>{},signInGoogle:async()=>{},signOut:async()=>{},
      list:async filters=>({items:[{id:"p-1",code:"K-001",name:"Fixture",width_mm:600,height_mm:1200,surface:"MATT",price_per_m2:1000000,active:true,data_status:"READY",is_published:true,version:1}],pagination:{limit:40,offset:filters.offset,total:1,has_more:false}}),
      update:async()=>{},setState:async()=>{}
    };
    const app=createCatalogAdminApp({api,root:document,accessCheckTimeoutMs:timeoutMs});
    const startPromise=app.start();
    window.authFixture={
      app,startPromise,owner,session,settled,
      queueDeferred(key){queue.push(deferred(key));},
      queueReject(message){queue.push(Promise.reject(new Error(message)));},
      resolve(key,value=owner){pending.get(key)?.resolve(value);},
      reject(key,message="profile rejected"){pending.get(key)?.reject(new Error(message));},
      emit(event,nextSession=session){subscriber?.(event,nextSession);},
      signedOut(){subscriber?.("SIGNED_OUT",null);}
    };
  },{initial,timeoutMs,owner,session});
  return {page,errors};
}

try {
  const initialSlow = await boot({initial:"slow",timeoutMs:200});
  assert.ok(await initialSlow.page.locator("#adminLoadingView").isVisible(),"slow initial access shows a bounded loading view");
  await initialSlow.page.evaluate(()=>authFixture.resolve("initial"));
  await initialSlow.page.locator("#adminWorkspace").waitFor({state:"visible"});
  assert.deepEqual(initialSlow.errors,[],`slow initial errors: ${initialSlow.errors.join(" | ")}`);
  await initialSlow.page.close();

  const initialReject = await boot({initial:"reject"});
  await initialReject.page.locator("#adminDeniedView").waitFor({state:"visible"});
  assert.equal(await initialReject.page.locator("#adminLoadingView").isVisible(),false,"rejected initial profile clears loading");
  await initialReject.page.close();

  const {page,errors} = await boot();
  await page.locator("#adminWorkspace").waitFor({state:"visible"});
  assert.equal(await page.locator("#adminProductRows tr").count(),1,"initial session access succeeds");

  await page.evaluate(()=>authFixture.emit("SIGNED_IN"));
  await page.locator("#adminWorkspace").waitFor({state:"visible"});

  await page.evaluate(()=>{authFixture.queueDeferred("resume");Object.defineProperty(document,"visibilityState",{configurable:true,value:"hidden"});document.dispatchEvent(new Event("visibilitychange"));Object.defineProperty(document,"visibilityState",{configurable:true,value:"visible"});document.dispatchEvent(new Event("visibilitychange"));window.dispatchEvent(new Event("focus"));authFixture.emit("TOKEN_REFRESHED");});
  assert.ok(await page.locator("#adminWorkspace").isVisible(),"same-user TOKEN_REFRESHED keeps workspace usable while access revalidates");
  assert.equal(await page.locator("#adminLoadingView").isVisible(),false,"tab resume does not restore the full loading overlay");
  await page.evaluate(()=>authFixture.resolve("resume"));

  await page.evaluate(()=>{authFixture.queueDeferred("stale");authFixture.queueDeferred("fresh");window.dispatchEvent(new Event("focus"));window.dispatchEvent(new Event("focus"));authFixture.emit("TOKEN_REFRESHED");authFixture.emit("TOKEN_REFRESHED");authFixture.resolve("fresh");});
  await page.waitForFunction(()=>authFixture.settled.includes("fresh"));
  await page.evaluate(()=>authFixture.resolve("stale",{id:"sale",role:"sale",active:true,lifecycle_status:"active"}));
  await page.waitForFunction(()=>authFixture.settled.includes("stale"));
  assert.ok(await page.locator("#adminWorkspace").isVisible(),"stale generation cannot replace current access state");

  await page.evaluate(()=>{authFixture.queueReject("refresh profile rejected");authFixture.emit("TOKEN_REFRESHED");});
  await page.locator("#adminToast").waitFor({state:"visible"});
  assert.ok(await page.locator("#adminWorkspace").isVisible(),"same-user rejected revalidation keeps the current workspace");

  await page.evaluate(()=>{authFixture.queueDeferred("timeout");authFixture.emit("TOKEN_REFRESHED");});
  await page.waitForTimeout(80);
  assert.ok(await page.locator("#adminWorkspace").isVisible(),"same-user timeout falls back to the current authorized workspace");
  assert.match(await page.locator("#adminToast").textContent(),/xác minh lại quyền truy cập/i);

  await page.evaluate(()=>{authFixture.queueDeferred("after-signout");authFixture.emit("TOKEN_REFRESHED");authFixture.signedOut();authFixture.resolve("after-signout");});
  await page.locator("#adminLoginView").waitFor({state:"visible"});
  await page.waitForTimeout(20);
  assert.equal(await page.locator("#adminWorkspace").isVisible(),false,"signed out wins over an older profile request");
  assert.equal(await page.locator("#adminLoadingView").isVisible(),false,"signed out clears loading");
  assert.deepEqual(errors,[],`browser errors: ${errors.join(" | ")}`);
  await page.close();

  console.log("PASS: Product Admin initial/SIGNED_IN/TOKEN_REFRESHED/tab-resume/repeat/stale/reject/timeout/signed-out browser regression.");
} finally {
  await browser.close();
}
