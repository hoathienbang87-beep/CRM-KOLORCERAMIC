import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root=process.cwd(),read=file=>fs.readFileSync(path.join(root,file),"utf8");
const config=JSON.parse(read("vercel.json"));
const websiteHtml=read("website/index.html"),adminHtml=read("admin/index.html"),crmHtml=read("index.html");
const websiteBootstrap=read("js/website/catalog-bootstrap.js");
const adminBootstrap=read("js/admin/catalog-admin-bootstrap.js");
const crmBootstrap=read("js/app.js"),crmApp=read("js/features/crm-app.js");
const shared=read("js/shared/supabase-client.js");
let checks=0;const expect=(label,value)=>{checks++;assert.ok(value,`FAIL: ${label}`);};
const rewrite=(source,destination)=>config.rewrites?.some(route=>route.source===source&&route.destination===destination);
const route=(src,dest)=>config.routes?.some(item=>item.src===src&&item.dest===dest);

expect("clean URLs enabled",config.cleanUrls===true);
expect("website root route precedes filesystem",route("^/$","/website/index"));
expect("website root is not a post-filesystem rewrite",!rewrite("/","/website/index"));
expect("admin canonical route",rewrite("/admin","/admin/index"));
expect("admin refresh route",rewrite("/admin/:path*","/admin/index"));
expect("CRM canonical route",rewrite("/crm","/index"));
expect("CRM refresh route",rewrite("/crm/:path*","/index"));
expect("no html extension in destinations",config.rewrites.every(route=>!route.destination.endsWith(".html")));
expect("legacy CRM redirect",config.redirects?.some(route=>route.source==="/CRM"&&route.destination==="/crm"&&route.permanent===true));
expect("catalog compatibility redirect",config.redirects?.some(route=>route.source==="/catalog"&&route.destination==="/"&&route.permanent===true));
expect("E-STRUCTURE media rewrite",rewrite("/videos/:path*","/public/videos/:path*"));
expect("old admin-to-CRM rewrite removed",!rewrite("/admin","/"));
expect("root is not redirected",!config.redirects?.some(route=>route.source==="/"));
expect("lowercase CRM is not redirected",!config.redirects?.some(route=>route.source==="/crm"));

for(const [label,file] of [["website","website/index.html"],["admin","admin/index.html"],["CRM","index.html"],["E-STRUCTURE","qr/e-structure.html"],["E-STRUCTURE video","public/videos/e-structure.mp4"]])
  expect(`${label} entry exists`,fs.existsSync(path.join(root,file)));
expect("website owns catalog CSS/bootstrap",/\/css\/catalog-website\.css/.test(websiteHtml)&&/\/js\/website\/catalog-bootstrap\.js/.test(websiteHtml));
expect("admin owns catalog CSS/bootstrap",/\/css\/catalog-admin\.css/.test(adminHtml)&&/\/js\/admin\/catalog-admin-bootstrap\.js/.test(adminHtml));
expect("CRM owns CRM CSS/bootstrap",/\/css\/styles\.css/.test(crmHtml)&&/\/js\/app\.js/.test(crmHtml));
expect("website excludes CRM/admin bundles",!/\/js\/(?:app|admin\/)|styles\.css/.test(websiteHtml));
expect("admin excludes CRM/website bundles",!/\/js\/(?:app|website\/)|styles\.css/.test(adminHtml));
expect("CRM excludes catalog entry bundles",!/catalog-(?:admin|website)|\/js\/(?:admin|website)\//.test(crmHtml));

expect("website uses shared public client",/createSupabaseBrowserClient\(\{authMode:"public"\}\)/.test(websiteBootstrap));
expect("admin uses shared authenticated client",/createSupabaseBrowserClient\(\{authMode:"authenticated"\}\)/.test(adminBootstrap));
expect("admin no longer imports CRM adapter",!adminBootstrap.includes("firebase.js"));
expect("CRM adapter uses shared client",read("js/firebase.js").includes('./shared/supabase-client.js'));
expect("shared module has no table/RPC knowledge",!/\.from\(|\.rpc\(|products|customers|catalog_/i.test(shared));
expect("public auth is sessionless",/authMode === "public"[\s\S]*persistSession:false[\s\S]*autoRefreshToken:false[\s\S]*detectSessionInUrl:false/.test(shared));
expect("authenticated apps share only auth storage contract",/storageKey:AUTH_STORAGE_KEY/.test(shared));
expect("shared folder allow-list",fs.readdirSync(path.join(root,"js/shared")).every(name=>name==="supabase-client.js"));

expect("admin denied link returns to CRM",/href="\/crm"[^>]*>Quay về CRM/.test(adminHtml));
expect("CRM admin handoff uses full navigation",/window\.location\.assign\(item\.path\)/.test(crmApp));
expect("CRM admin target remains /admin",read("js/components/app-shell.js").includes('path: "/admin"'));
expect("website assets root-relative",[...websiteHtml.matchAll(/(?:href|src)="([^"]+)"/g)].filter(match=>match[1].startsWith("/")).every(match=>match[1].startsWith("/")));
expect("admin assets root-relative",[...adminHtml.matchAll(/(?:href|src)="([^"]+)"/g)].filter(match=>match[1].startsWith("/")).every(match=>match[1].startsWith("/")));
expect("CRM assets root-relative",[...crmHtml.matchAll(/(?:href|src)="([^"]+)"/g)].filter(match=>match[1].startsWith("/")).every(match=>match[1].startsWith("/")));
expect("maintenance build remains CRM-only",/maintenance\.generated\.js/.test(crmBootstrap)&&!/maintenance\.generated\.js/.test(websiteBootstrap+adminBootstrap));

for(const destination of config.rewrites.map(route=>route.destination)){
  const relative=destination.replace(/^\//,"");
  const wildcardBase=relative.replace(/:path\*$/,"");
  expect(`rewrite destination exists ${destination}`,fs.existsSync(path.join(root,`${relative}.html`))||fs.existsSync(path.join(root,relative))||fs.existsSync(path.join(root,wildcardBase)));
}
for(const destination of config.routes.map(route=>route.dest).filter(Boolean)){
  const relative=destination.replace(/^\//,"");
  expect(`route destination exists ${destination}`,fs.existsSync(path.join(root,`${relative}.html`))||fs.existsSync(path.join(root,relative)));
}

console.log(`PASS: app separation and routing 09 static contract (${checks} checks).`);
