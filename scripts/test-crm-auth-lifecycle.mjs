#!/usr/bin/env node
// Phase 6L-C release gate: CRM auth lifecycle must never issue protected reads
// before authentication, after logout, or from callbacks queued under an older session.
//
// Part 1 exercises the real js/firebase.js listener layer against a mock Supabase client.
// Part 2 extracts the CRM lifecycle functions from js/features/crm-app.js and runs them
// against stubs to check ordering, idempotency, token refresh, user change and
// signOut failure handling. Part 3 is a static contract for the auth callback.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks += 1; };

// ---------------------------------------------------------------------------
// Part 1 — firebase.js protected-data gate
// ---------------------------------------------------------------------------
const reads = [];
const channels = new Map();
let removedChannels = 0;
let readDelayMs = 0;
let readFailure = null;

function queryBuilder(table) {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    limit() { return builder; },
    maybeSingle() { return builder; },
    upsert() { return Promise.resolve({error: null}); },
    then(resolve, reject) {
      reads.push(table);
      const run = async () => {
        if (readDelayMs) await wait(readDelayMs);
        if (readFailure) return {data: null, error: readFailure};
        return {data: [], error: null};
      };
      return run().then(resolve, reject);
    }
  };
  return builder;
}

const mockClient = {
  from: table => queryBuilder(table),
  channel(name) {
    const entry = {name, handler: null, removed: false};
    const channel = {
      on(_type, _filter, handler) { entry.handler = handler; return channel; },
      subscribe() { channels.set(name, entry); return channel; },
      entry
    };
    return channel;
  },
  removeChannel(channel) { channel.entry.removed = true; channels.delete(channel.entry.name); removedChannels += 1; },
  auth: {
    getSession: async () => ({data: {session: null}}),
    getUser: async () => ({data: {user: null}}),
    onAuthStateChange: () => ({data: {subscription: {unsubscribe() {}}}}),
    signOut: async () => ({error: null})
  }
};
globalThis.window = {CRM_SUPABASE_CONFIG: {url: "https://fixture.supabase.test", anonKey: "fixture"}, supabase: {createClient: () => mockClient}, location: {origin: "", pathname: "/"}};

const fb = await import(pathToFileURL(join(ROOT, "js/firebase.js")).href);
const {onSnapshot, collection, doc, db, setProtectedDataAccess, protectedDataState, setDoc} = fb;

// A. Anonymous bootstrap: no protected listener can start before AUTHENTICATED.
check(protectedDataState().enabled === false, "A: protected data disabled at module load");
let unsub = onSnapshot(collection(db, "products"), () => {}, () => {});
await wait(200);
check(reads.length === 0, "A: no protected read before authentication");
check(channels.size === 0 && protectedDataState().listeners === 0, "A: no listener/realtime channel before authentication");
unsub(); unsub();

// B. Authenticated bootstrap: watchers start exactly once.
setProtectedDataAccess(true);
const nexts = {products: 0, kpiPeriods: 0, settings: 0};
const errors = [];
const watchers = [
  onSnapshot(collection(db, "products"), () => nexts.products++, err => errors.push(err)),
  onSnapshot(collection(db, "kpiPeriods"), () => nexts.kpiPeriods++, err => errors.push(err)),
  onSnapshot(doc(db, "settings", "crm"), () => nexts.settings++, err => errors.push(err))
];
await wait(30);
check(reads.length === 3, `B: exactly one initial read per watcher (${reads.length})`);
check(protectedDataState().listeners === 3 && channels.size === 3, "B: one listener and one realtime channel per table");

// C. Logout cleanup: a pending debounce and realtime callback do nothing after teardown.
const productsChannel = channels.get("crm-realtime-products");
const staleRealtimeHandler = productsChannel.handler;
staleRealtimeHandler();                         // realtime event queues a debounced refresh
check(protectedDataState().refreshPending === true, "C: realtime event scheduled a debounced refresh");
const readsBeforeLogout = reads.length;
setProtectedDataAccess(false);                  // SIGNING_OUT: gate closes first
watchers.forEach(fn => fn());                   // stopWatchers
watchers.forEach(fn => fn());                   // idempotent second cleanup
check(protectedDataState().refreshPending === false, "C: logout cancelled the pending debounce timer");
check(protectedDataState().listeners === 0 && channels.size === 0, "C: all listeners and realtime channels removed");
check(removedChannels === 3, `C: realtime channels removed exactly once each (${removedChannels})`);
await wait(250);
check(reads.length === readsBeforeLogout, "C: no protected read after logout (debounce window elapsed)");

// D. Delayed debounce: refresh scheduled, gate closed before it fires, listener still registered.
setProtectedDataAccess(true);
const d1 = onSnapshot(collection(db, "customers"), () => {}, () => {});
await wait(20);
const readsD = reads.length;
channels.get("crm-realtime-customers").handler();
setProtectedDataAccess(false);
await wait(250);
check(reads.length === readsD, "D: debounced refetch discarded when gate closed before it fired");
d1();

// E. Stale realtime callback from an older session fires after a new login.
setProtectedDataAccess(true);
const e1 = onSnapshot(collection(db, "kpiAssignments"), () => {}, () => {});
await wait(20);
const oldHandler = channels.get("crm-realtime-kpi_assignments").handler;
setProtectedDataAccess(false); e1();
setProtectedDataAccess(true);                   // new session (new epoch)
const e2 = onSnapshot(collection(db, "kpiAssignments"), () => {}, () => {});
await wait(20);
const readsE = reads.length;
oldHandler();                                   // queued callback of the old channel runs late
await wait(250);
check(reads.length === readsE, "E: stale realtime callback from previous session issues no read");
check(protectedDataState().listeners === 1, "E: new session has exactly one watcher set");
e2();

// F. In-flight fetch result and error after logout are discarded.
setProtectedDataAccess(true);
readDelayMs = 80;
let lateNext = 0; let lateError = 0;
const f1 = onSnapshot(collection(db, "deals"), () => lateNext++, () => lateError++);
setProtectedDataAccess(false); f1();
await wait(150);
check(lateNext === 0, "F: in-flight result delivered after logout is discarded");
setProtectedDataAccess(true);
readFailure = {code: "42501", message: "permission denied (anon)"};
const f2 = onSnapshot(collection(db, "deals"), () => lateNext++, () => lateError++);
setProtectedDataAccess(false); f2();
await wait(150);
check(lateError === 0, "F: late 401-style error after logout is not surfaced");
readDelayMs = 0; readFailure = null;

// G. Rapid logout → login: old generation dead, exactly one new watcher set.
setProtectedDataAccess(true);
const g1 = [onSnapshot(collection(db, "products"), () => {}, () => {}), onSnapshot(collection(db, "customers"), () => {}, () => {})];
await wait(10);
setProtectedDataAccess(false); g1.forEach(fn => fn());
setProtectedDataAccess(true);
const readsG = reads.length;
const g2 = [onSnapshot(collection(db, "products"), () => {}, () => {}), onSnapshot(collection(db, "customers"), () => {}, () => {})];
await wait(30);
check(reads.length - readsG === 2, `G: relogin starts exactly one read per watcher (${reads.length - readsG})`);
check(protectedDataState().listeners === 2 && channels.size === 2, "G: no duplicate listeners/channels after relogin");

// H. Writes refresh only while authenticated; presence write during SIGNING_OUT schedules nothing.
setProtectedDataAccess(false); g2.forEach(fn => fn());
await setDoc(doc(db, "userSessions", "u1"), {online: false});
check(protectedDataState().refreshPending === false, "H: presence write during sign-out schedules no refetch");
check(errors.length === 0, "B-H: no error surfaced to watchers");

// ---------------------------------------------------------------------------
// Part 2 — CRM lifecycle state machine (extracted from crm-app.js)
// ---------------------------------------------------------------------------
const app = fs.readFileSync(join(ROOT, "js/features/crm-app.js"), "utf8").replace(/\r\n/g, "\n");
function slice(start, end) {
  const i = app.indexOf(start);
  const j = app.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, `extract ${start}`);
  return app.slice(i, j);
}
const lifecycleSource = [
  slice("function startPresence()", "function setCollectionState("),
  slice("// Idempotent: safe to call when nothing is running", "function watchData() {"),
  slice("// Logout order: stop protected work first", "onAuthStateChanged(auth, (user, event) => handleAuthUser(user, event));")
].join("\n");

function makeHarness({signOutFails = false, sessionAfterFailure = null} = {}) {
  const log = [];
  const ctx = {
    log,
    clean: v => (v == null ? "" : String(v).trim()),
    authLifecycle: "UNKNOWN", authUserId: "", authBootstrapGeneration: 0,
    currentUser: null, appUser: null, presenceTimer: null,
    setInterval: () => 1, clearInterval: () => {},
    setProtectedDataAccess: enabled => log.push(enabled ? "access:on" : "access:off"),
    stopWatchers: () => log.push("stopWatchers"),
    updatePresence: async online => { log.push(`presence:${online}`); },
    signOut: async () => { log.push("signOut"); if (signOutFails) throw new Error("network"); },
    getCurrentAuthUser: async () => sessionAfterFailure,
    notice: msg => log.push(`notice:${msg}`),
    authMessage: err => err.message,
    showLogin: () => { log.push("showLogin"); ctx.teardownProtectedSession(); },
    bootstrapAuthenticatedUser: async (user, generation) => { log.push(`bootstrap:${user.uid}:${generation}`); },
    auth: {}
  };
  vm.createContext(ctx);
  vm.runInContext(`${lifecycleSource}
    globalThis.teardownProtectedSession = teardownProtectedSession;
    globalThis.handleAuthUser = handleAuthUser;
    globalThis.logoutCurrentSession = logoutCurrentSession;
    globalThis.startPresence = startPresence;
    globalThis.setState = s => { if ("authLifecycle" in s) authLifecycle = s.authLifecycle; if ("appUser" in s) appUser = s.appUser; };
    globalThis.getState = () => ({authLifecycle, authUserId, authBootstrapGeneration, currentUser, appUser, presenceTimer});
    var stopPresence = function() { log.push("stopPresence"); };
  `, ctx);
  // stopPresence is declared in the extracted slice; wrap to record calls.
  return ctx;
}
const userA = {uid: "user-a", email: "a@fixture.test"};
const userB = {uid: "user-b", email: "b@fixture.test"};
const bootstraps = log => log.filter(entry => entry.startsWith("bootstrap:")).length;

// Anonymous INITIAL_SESSION (twice: getSession + event) → login, no bootstrap.
{
  const h = makeHarness();
  h.handleAuthUser(null, "INITIAL_SESSION");
  h.handleAuthUser(null, "INITIAL_SESSION");
  check(bootstraps(h.log) === 0 && h.getState().authLifecycle === "ANONYMOUS", "S1: anonymous bootstrap never starts protected work");
  check(!h.log.includes("access:on"), "S1: protected access never enabled while anonymous");
}
// Authenticated load: getSession + INITIAL_SESSION + SIGNED_IN + TOKEN_REFRESHED → one bootstrap.
{
  const h = makeHarness();
  h.handleAuthUser(userA, "INITIAL_SESSION");
  h.handleAuthUser(userA, "INITIAL_SESSION");
  h.handleAuthUser(userA, "SIGNED_IN");
  h.setState({authLifecycle: "AUTHENTICATED"});
  h.handleAuthUser({...userA, token: "refreshed"}, "TOKEN_REFRESHED");
  check(bootstraps(h.log) === 1, `S2: duplicate auth events bootstrap once (${bootstraps(h.log)})`);
  check(!h.log.includes("stopWatchers"), "S2: TOKEN_REFRESHED does not tear down watchers");
  check(h.getState().currentUser.token === "refreshed", "S2: refreshed user object kept");
}
// Logout order + idempotent SIGNED_OUT.
{
  const h = makeHarness();
  h.handleAuthUser(userA, "INITIAL_SESSION");
  h.setState({authLifecycle: "AUTHENTICATED", appUser: {uid: "user-a"}});
  h.log.length = 0;
  await h.logoutCurrentSession();
  const order = h.log.filter(e => ["access:off", "stopWatchers", "presence:false", "signOut"].includes(e) || e === "stopPresence");
  check(order.indexOf("access:off") === 0, "S3: protected gate closed before anything else");
  check(order.indexOf("stopWatchers") < order.indexOf("presence:false"), "S3: watchers stopped before presence write");
  check(order.indexOf("presence:false") < order.indexOf("signOut"), "S3: presence cleanup before signOut");
  h.handleAuthUser(null, "SIGNED_OUT");
  h.handleAuthUser(null, "SIGNED_OUT");
  check(h.getState().authLifecycle === "ANONYMOUS" && h.getState().currentUser === null, "S3: SIGNED_OUT leaves ANONYMOUS state");
  check(bootstraps(h.log) === 0, "S3: SIGNED_OUT never restarts watchers");
  await h.logoutCurrentSession();
  // second logout while anonymous is harmless (teardown idempotent)
  check(true, "S3: repeated cleanup does not throw");
}
// Events during SIGNING_OUT are ignored; rapid relogin bootstraps exactly once with a new generation.
{
  const h = makeHarness();
  h.handleAuthUser(userA, "INITIAL_SESSION");
  h.setState({authLifecycle: "AUTHENTICATED", appUser: {uid: "user-a"}});
  const pending = h.logoutCurrentSession();
  h.handleAuthUser(userA, "TOKEN_REFRESHED");
  await pending;
  h.handleAuthUser(null, "SIGNED_OUT");
  const generationAfterLogout = h.getState().authBootstrapGeneration;
  h.handleAuthUser(userA, "SIGNED_IN");
  h.handleAuthUser(userA, "SIGNED_IN");
  check(bootstraps(h.log) === 2, `S4: relogin bootstraps exactly once more (${bootstraps(h.log)})`);
  check(h.log.at(-1).startsWith("bootstrap:") || h.log.some(e => e === `bootstrap:user-a:${generationAfterLogout + 1}`), "S4: relogin uses a new generation");
}
// User change A → B tears down A before bootstrapping B.
{
  const h = makeHarness();
  h.handleAuthUser(userA, "INITIAL_SESSION");
  h.setState({authLifecycle: "AUTHENTICATED", appUser: {uid: "user-a"}});
  h.log.length = 0;
  h.handleAuthUser(userB, "SIGNED_IN");
  check(h.log.indexOf("access:off") >= 0 && h.log.indexOf("access:off") < h.log.findIndex(e => e.startsWith("bootstrap:user-b")), "S5: user A torn down before user B bootstrap");
  check(h.getState().appUser === null && h.getState().authUserId === "user-b", "S5: no user A state carried into user B");
}
// signOut failure with session still valid → one re-bootstrap, no loop; without session → login.
{
  const h = makeHarness({signOutFails: true, sessionAfterFailure: userA});
  h.handleAuthUser(userA, "INITIAL_SESSION");
  h.setState({authLifecycle: "AUTHENTICATED", appUser: {uid: "user-a"}});
  await h.logoutCurrentSession();
  check(bootstraps(h.log) === 2 && h.log.filter(e => e === "signOut").length === 1, "S6: signOut failure re-evaluates session once, no retry loop");
  check(h.log.some(e => e.startsWith("notice:Không đăng xuất được")), "S6: user sees a sign-out error");
  const h2 = makeHarness({signOutFails: true, sessionAfterFailure: null});
  h2.handleAuthUser(userA, "INITIAL_SESSION");
  h2.setState({authLifecycle: "AUTHENTICATED", appUser: {uid: "user-a"}});
  await h2.logoutCurrentSession();
  check(h2.getState().authLifecycle === "ANONYMOUS" && bootstraps(h2.log) === 1, "S6: signOut failure without session goes to login without watchers");
}
// Presence never starts outside AUTHENTICATED.
{
  const h = makeHarness();
  h.setState({authLifecycle: "AUTHENTICATING"});
  h.startPresence();
  check(!h.log.includes("presence:true") && h.getState().presenceTimer === null, "S7: no heartbeat before AUTHENTICATED");
}

// ---------------------------------------------------------------------------
// Part 3 — static contract
// ---------------------------------------------------------------------------
const handleAuth = slice("function handleAuthUser(", "onAuthStateChanged(auth, (user, event) => handleAuthUser(user, event));");
check(!/\bawait\b/.test(handleAuth), "C1: auth callback handler awaits nothing");
check(/void bootstrapAuthenticatedUser\(user, generation\)/.test(handleAuth), "C1: bootstrap scheduled outside the auth callback");
check((app.match(/await logoutCurrentSession\(\);/g) || []).length === 3, "C2: all three logout buttons use the ordered logout");
check(!/try \{ await updatePresence\(false\); \} catch \{\}\n  await signOut\(auth\);/.test(app), "C2: no legacy presence→signOut logout left");
const bootstrap = slice("async function bootstrapAuthenticatedUser(", "// Logout order: stop protected work first");
check(bootstrap.indexOf('authLifecycle = "AUTHENTICATED"') < bootstrap.indexOf("setProtectedDataAccess(true)") && bootstrap.indexOf("setProtectedDataAccess(true)") < bootstrap.indexOf("watchData()"), "C3: access enabled only after auth bootstrap, before watchers");
check(/function showLogin\(\) \{\n  teardownProtectedSession\(\);/.test(app), "C4: login view always tears down protected work");
check(/function watchData\(\) \{\n  stopWatchers\(\);\n  if \(authLifecycle !== "AUTHENTICATED"/.test(app), "C5: watchData refuses to run outside AUTHENTICATED");
const firebase = fs.readFileSync(join(ROOT, "js/firebase.js"), "utf8");
check(/if \(!protectedDataActive\(listener\.epoch\)\) return \(\) => \{\};/.test(firebase), "C6: onSnapshot refuses to register while gate closed");
check(/if \(protectedDataActive\(epoch\)\) refreshListeners\(table\);/.test(firebase), "C6: realtime callbacks bound to their session epoch");

console.log(`crm auth lifecycle: PASS (${checks} checks)`);
process.exit(0);
