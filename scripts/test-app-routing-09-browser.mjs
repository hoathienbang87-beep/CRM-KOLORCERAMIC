import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";

const playwrightEntry=process.env.ROUTING_09_PLAYWRIGHT_ENTRY;
const browserPath=process.env.ROUTING_09_BROWSER_PATH;
if(!playwrightEntry||!browserPath)throw new Error("ROUTING_09_PLAYWRIGHT_ENTRY and ROUTING_09_BROWSER_PATH are required.");
const {chromium}=await import(pathToFileURL(playwrightEntry).href).then(module=>module.default||module);
const root=process.cwd(),config=JSON.parse(fs.readFileSync("vercel.json","utf8"));
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".png":"image/png"};

function rewritePath(pathname){
  for(const route of config.rewrites){
    if(route.source===pathname)return route.destination;
    if(route.source.endsWith("/:path*")&&pathname.startsWith(route.source.slice(0,-7)+"/"))return route.destination;
  }
  return pathname;
}

const server=http.createServer((request,response)=>{
  const url=new URL(request.url,"http://localhost");
  const redirect=config.redirects?.find(route=>route.source===url.pathname);
  if(redirect){response.writeHead(redirect.permanent?308:307,{Location:`${redirect.destination}${url.search}`});return response.end();}
  if(url.pathname==="/js/supabase-config.js"){
    response.writeHead(200,{"Content-Type":"text/javascript; charset=utf-8"});
    return response.end(`window.CRM_SUPABASE_CONFIG={url:"http://127.0.0.1:${server.address().port}/supabase",anonKey:"fixture-anon-key"};`);
  }
  if(url.pathname.startsWith("/supabase/")){
    response.writeHead(url.pathname.includes("/rpc/")?200:401,{"Content-Type":"application/json"});
    return response.end(url.pathname.includes("/rpc/")?"[]":JSON.stringify({message:"fixture unauthenticated"}));
  }
  let pathname=rewritePath(url.pathname);
  let relative=decodeURIComponent(pathname).replace(/^\/+/,"");
  let file=path.resolve(root,relative);
  if(!path.extname(file)&&fs.existsSync(`${file}.html`))file=`${file}.html`;
  if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){
    response.writeHead(404,{"Content-Type":"text/plain"});return response.end("Not found");
  }
  response.writeHead(200,{"Content-Type":mime[path.extname(file)]||"application/octet-stream"});
  fs.createReadStream(file).pipe(response);
});
await new Promise((resolve,reject)=>server.listen(0,"127.0.0.1",error=>error?reject(error):resolve()));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:browserPath,headless:true});

try{
  const context=await browser.newContext();
  const page=await context.newPage();
  const localFailures=[],productionRequests=[];
  page.on("response",response=>{if(response.url().startsWith(base)&&response.status()>=400&&!response.url().includes("/supabase/"))localFailures.push(`${response.status()} ${response.url()}`);});
  page.on("request",request=>{if(request.url().includes("jjeeazwlqcwynzquimeo"))productionRequests.push(request.url());});
  await page.route("https://cdn.jsdelivr.net/**",route=>route.abort());

  const cases=[
    {url:"/",title:/Catalog gạch/,selector:"#catalogView",css:"catalog-website.css"},
    {url:"/?id=SP-ROUTE-09",title:/Kolorceramic/,selector:"#productDetailView",css:"catalog-website.css"},
    {url:"/?code=SP-LEGACY-10",title:/Kolorceramic/,selector:"#productDetailView",css:"catalog-website.css"},
    {url:"/admin",title:/Quản trị Catalog/,selector:"#adminLoadingView",css:"catalog-admin.css"},
    {url:"/admin/import",title:/Quản trị Catalog/,selector:"#adminWorkspace",css:"catalog-admin.css"},
    {url:"/crm",title:/CRM Công Ty/,selector:"#appView",css:"styles.css"},
    {url:"/crm/deep-refresh",title:/CRM Công Ty/,selector:"#appView",css:"styles.css"}
  ];
  for(const item of cases){
    await page.goto(`${base}${item.url}`,{waitUntil:"domcontentloaded"});
    await page.locator(item.selector).waitFor({state:"attached"});
    assert.match(await page.title(),item.title,`title ${item.url}`);
    const hasStylesheet=await page.evaluate(
      css=>[...document.styleSheets].some(sheet=>Boolean(sheet.href?.includes(css))),
      item.css
    );
    assert.ok(hasStylesheet,`stylesheet ${item.css} at ${item.url}`);
    await page.reload({waitUntil:"domcontentloaded"});
    await page.locator(item.selector).waitFor({state:"attached"});
    assert.equal(new URL(page.url()).pathname,new URL(`${base}${item.url}`).pathname,`refresh path ${item.url}`);
  }

  const redirect=await context.request.get(`${base}/CRM?source=legacy`,{maxRedirects:0});
  assert.equal(redirect.status(),308,"legacy redirect status");
  assert.equal(redirect.headers().location,"/crm?source=legacy","legacy redirect preserves query");
  assert.deepEqual(localFailures,[],`local asset failures: ${localFailures.join(" | ")}`);
  assert.deepEqual(productionRequests,[],"routing fixture must not request production");
  console.log("PASS: app routing 09 browser — /, /admin, /crm, deep refresh, root-relative assets and /CRM redirect.");
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
