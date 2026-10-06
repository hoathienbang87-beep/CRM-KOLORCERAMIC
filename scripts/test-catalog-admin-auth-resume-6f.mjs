import assert from "node:assert/strict";
import fs from "node:fs";
import {createCatalogAdminApi} from "../js/admin/catalog-admin-api.js";

const appSource = fs.readFileSync("js/admin/catalog-admin-app.js", "utf8");
const apiSource = fs.readFileSync("js/admin/catalog-admin-api.js", "utf8");
let authSubscriber;
let unsubscribed = false;
const fakeClient = {
  auth: {
    onAuthStateChange(callback) {
      authSubscriber = callback;
      return {data:{subscription:{unsubscribe(){unsubscribed = true;}}}};
    },
    getSession: async () => ({data:{session:null},error:null}),
    signInWithPassword: async () => ({data:{session:null},error:null}),
    signInWithOAuth: async () => ({data:{},error:null}),
    signOut: async () => ({error:null})
  },
  rpc: async () => ({data:null,error:null}),
  from: () => ({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null,error:null})})
};

const api = createCatalogAdminApi(fakeClient);
let callbackStarted = false;
let releaseCallback;
const callbackBlocker = new Promise(resolve => { releaseCallback = resolve; });
const unsubscribe = api.onAuthStateChange(async (event, session) => {
  callbackStarted = true;
  assert.equal(event, "TOKEN_REFRESHED");
  assert.equal(session.user.id, "auth-owner");
  await callbackBlocker;
});

const callbackReturn = authSubscriber("TOKEN_REFRESHED", {user:{id:"auth-owner"}});
assert.equal(callbackReturn, undefined, "Supabase subscriber must return synchronously, never return the business Promise");
assert.equal(callbackStarted, false, "business logic must be deferred outside the auth callback");
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(callbackStarted, true, "deferred auth transition must still run");
releaseCallback();
unsubscribe();
assert.equal(unsubscribed, true, "auth subscription remains disposable");

assert.match(apiSource, /onAuthStateChange\(\(event, session\) => \{[\s\S]*queueMicrotask/);
assert.doesNotMatch(apiSource, /onAuthStateChange\(\([^)]*\)\s*=>\s*callback\(/);
assert.match(appSource, /handleSession\("INITIAL_SESSION", session\)/);
assert.match(appSource, /api\.onAuthStateChange\(\(event, nextSession\) => handleSession\(event, nextSession\)\)/);
assert.match(appSource, /event === "TOKEN_REFRESHED" && sameUser/);
assert.match(appSource, /generation !== state\.authGeneration/);
assert.match(appSource, /Promise\.race\(\[api\.profile\(authUserId\), timeout\]\)/);
assert.match(appSource, /ACCESS_CHECK_TIMEOUT/);
assert.match(appSource, /sameUser && isAdminProfile\(state\.profile\)/);

console.log("PASS: Product Admin auth callback deferral, event forwarding, generation guard and timeout contract.");
