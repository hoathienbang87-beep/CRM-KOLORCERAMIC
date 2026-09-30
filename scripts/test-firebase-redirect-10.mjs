import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root=process.cwd();
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const firebaseConfig=JSON.parse(read("firebase-legacy-redirect/firebase.json"));
const projectConfig=JSON.parse(read("firebase-legacy-redirect/.firebaserc"));
const bootstrap=read("js/website/catalog-bootstrap.js");
const rollback=read("firebase-legacy-redirect/README.md");
const hosting=firebaseConfig.hosting;
const destination="https://crmkolor.vercel.app/";
let checks=0;
const expect=(label,value)=>{checks++;assert.ok(value,`FAIL: ${label}`);};

expect("Firebase project is pinned",projectConfig.projects?.default==="kolor-ceramics");
expect("Hosting site is pinned",hosting.site==="kolor-ceramics");
expect("redirect-only public directory exists",fs.existsSync(path.join(root,"firebase-legacy-redirect/public")));
expect("no functions or rewrites",!firebaseConfig.functions&&!hosting.rewrites);
expect("exactly one catch-all redirect",hosting.redirects?.length===1);
expect("all paths including root redirect",hosting.redirects[0]?.regex==="^/.*$"&&hosting.redirects[0]?.destination===destination&&hosting.redirects[0]?.type===301);
expect("destination is HTTPS",new URL(destination).protocol==="https:");
expect("destination leaves legacy origin",new URL(destination).hostname!=="kolor-ceramics.web.app");
expect("destination is not Firebase",!/firebaseapp\.com$|\.web\.app$/i.test(new URL(destination).hostname));
expect("no redirect loop in config",hosting.redirects.every(rule=>new URL(rule.destination).hostname!=="kolor-ceramics.web.app"));
expect("emulator is loopback-only",firebaseConfig.emulators?.hosting?.host==="127.0.0.1");
expect("new catalog accepts id",/query\.get\("id"\)/.test(bootstrap));
expect("new catalog accepts legacy code",/query\.get\("code"\)/.test(bootstrap));
expect("rollback records live version",/current live Hosting version ID/i.test(rollback));
expect("rollback uses Firebase release history",/Release history[\s\S]*Roll back/i.test(rollback));
expect("rollback never disables site",/Never use `hosting:disable`/i.test(rollback));
expect("Prompt 10 explicitly forbids deploy",/not deployed|No command in this document is authorized by Prompt 10/i.test(rollback));

console.log(`PASS: Firebase legacy redirect 10 static contract (${checks} checks).`);
