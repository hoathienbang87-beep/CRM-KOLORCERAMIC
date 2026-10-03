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
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".mp4":"video/mp4"};

function rewritePath(pathname){
  for(const route of config.routes||[]){
    if(route.dest&&new RegExp(route.src).test(pathname))return route.dest;
  }
  for(const route of config.rewrites){
    if(route.source===pathname)return route.destination;
    if(route.source.endsWith("/:path*")){
      const sourceBase=route.source.slice(0,-7);
      if(pathname.startsWith(`${sourceBase}/`))return route.destination.replace(":path*",pathname.slice(sourceBase.length+1));
    }
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
  const contentType=mime[path.extname(file)]||"application/octet-stream";
  const range=request.headers.range;
  if(range&&path.extname(file)===".mp4"){
    const size=fs.statSync(file).size;
    const match=/bytes=(\d+)-(\d*)/.exec(range);
    if(!match){response.writeHead(416,{"Content-Range":`bytes */${size}`});return response.end();}
    const start=Number(match[1]),end=Math.min(match[2]?Number(match[2]):size-1,size-1);
    response.writeHead(206,{"Content-Type":contentType,"Accept-Ranges":"bytes","Content-Range":`bytes ${start}-${end}/${size}`,"Content-Length":end-start+1});
    return fs.createReadStream(file,{start,end}).pipe(response);
  }
  response.writeHead(200,{"Content-Type":contentType,"Accept-Ranges":path.extname(file)===".mp4"?"bytes":"none"});
  fs.createReadStream(file).pipe(response);
});
await new Promise((resolve,reject)=>server.listen(0,"127.0.0.1",error=>error?reject(error):resolve()));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:browserPath,headless:true});

try{
  const context=await browser.newContext();
  const page=await context.newPage();
  const localFailures=[],productionRequests=[],pageErrors=[],consoleErrors=[],failedRequests=[],externalRequests=[];
  page.on("response",response=>{if(response.url().startsWith(base)&&response.status()>=400&&!response.url().includes("/supabase/"))localFailures.push(`${response.status()} ${response.url()}`);});
  page.on("pageerror",error=>pageErrors.push(error.message));
  page.on("console",message=>{if(message.type()==="error"&&!/Failed to load resource/i.test(message.text()))consoleErrors.push(message.text());});
  page.on("requestfailed",request=>{
    const errorText=request.failure()?.errorText||"failed";
    const navigationAbortedVideo=request.url().startsWith(`${base}/videos/`)&&errorText==="net::ERR_ABORTED";
    if(request.url().startsWith(base)&&!navigationAbortedVideo)failedRequests.push(`${request.method()} ${request.url()} ${errorText}`);
  });
  page.on("request",request=>{
    if(request.url().includes("jjeeazwlqcwynzquimeo"))productionRequests.push(request.url());
    const allowedExternal=["https://cdn.jsdelivr.net/","https://fonts.googleapis.com/","https://fonts.gstatic.com/"];
    if(!request.url().startsWith(base)&&!allowedExternal.some(origin=>request.url().startsWith(origin)))externalRequests.push(request.url());
  });
  await page.route("https://cdn.jsdelivr.net/**",route=>route.abort());

  const cases=[
    {url:"/",title:/Catalog gạch/,selector:"#catalogView",css:"catalog-website.css"},
    {url:"/?id=SP-ROUTE-09",title:/Kolorceramic/,selector:"#productDetailView",css:"catalog-website.css"},
    {url:"/?code=SP-LEGACY-10",title:/Kolorceramic/,selector:"#productDetailView",css:"catalog-website.css"},
    {url:"/admin",title:/Quản trị Catalog/,selector:"#adminLoadingView",css:"catalog-admin.css"},
    {url:"/admin/import",title:/Quản trị Catalog/,selector:"#adminWorkspace",css:"catalog-admin.css"},
    {url:"/crm",title:/CRM Công Ty/,selector:"#appView",css:"styles.css"},
    {url:"/crm/deep-refresh",title:/CRM Công Ty/,selector:"#appView",css:"styles.css"},
    {url:"/qr/e-structure",title:/E-STRUCTURE/,selector:"#experienceVideo"}
  ];
  for(const item of cases){
    await page.goto(`${base}${item.url}`,{waitUntil:"domcontentloaded"});
    await page.locator(item.selector).waitFor({state:"attached"});
    assert.match(await page.title(),item.title,`title ${item.url}`);
    if(item.css){
      const hasStylesheet=await page.evaluate(
        css=>[...document.styleSheets].some(sheet=>Boolean(sheet.href?.includes(css))),
        item.css
      );
      assert.ok(hasStylesheet,`stylesheet ${item.css} at ${item.url}`);
    }
    await page.reload({waitUntil:"domcontentloaded"});
    await page.locator(item.selector).waitFor({state:"attached"});
    assert.equal(new URL(page.url()).pathname,new URL(`${base}${item.url}`).pathname,`refresh path ${item.url}`);
  }

  for(const [width,height] of [[1440,900],[768,1024],[390,844]]){
    await page.setViewportSize({width,height});
    await page.goto(`${base}/qr/e-structure`,{waitUntil:"domcontentloaded"});
    const videoState=await page.locator("#experienceVideo").evaluate(video=>({
      autoplay:video.autoplay,muted:video.muted,playsInline:video.playsInline,loop:video.loop,
      source:video.querySelector("source")?.getAttribute("src"),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
    }));
    assert.deepEqual(
      {autoplay:videoState.autoplay,muted:videoState.muted,playsInline:videoState.playsInline,loop:videoState.loop,source:videoState.source},
      {autoplay:true,muted:true,playsInline:true,loop:true,source:"/videos/e-structure.mp4"},
      `E-STRUCTURE autoplay contract ${width}x${height}`
    );
    assert.ok(videoState.overflow<=1,`E-STRUCTURE has no horizontal overflow ${width}x${height}`);
    await page.waitForFunction(()=>document.querySelector("#experienceVideo")?.readyState>=2,{timeout:5000});
  }

  const redirect=await context.request.get(`${base}/CRM?source=legacy`,{maxRedirects:0});
  assert.equal(redirect.status(),308,"legacy redirect status");
  assert.equal(redirect.headers().location,"/crm?source=legacy","legacy redirect preserves query");
  const catalogRedirect=await context.request.get(`${base}/catalog?source=legacy`,{maxRedirects:0});
  assert.equal(catalogRedirect.status(),308,"catalog redirect status");
  assert.equal(catalogRedirect.headers().location,"/?source=legacy","catalog redirect preserves query");
  const video=await context.request.get(`${base}/videos/e-structure.mp4`,{headers:{Range:"bytes=0-1023"}});
  assert.equal(video.status(),206,"E-STRUCTURE video supports byte ranges");
  assert.match(video.headers()["content-type"],/^video\/mp4/,"E-STRUCTURE video content type");
  assert.equal((await video.body()).length,1024,"E-STRUCTURE byte range length");

  await page.goto(`${base}/crm`,{waitUntil:"domcontentloaded"});
  await page.goto(`${base}/`,{waitUntil:"domcontentloaded"});
  await page.goBack({waitUntil:"domcontentloaded"});
  assert.equal(new URL(page.url()).pathname,"/crm","browser back restores CRM canonical path");
  await page.goForward({waitUntil:"domcontentloaded"});
  assert.equal(new URL(page.url()).pathname,"/","browser forward restores Catalog root");
  assert.deepEqual(localFailures,[],`local asset failures: ${localFailures.join(" | ")}`);
  assert.deepEqual(productionRequests,[],"routing fixture must not request production");
  assert.deepEqual(pageErrors,[],`page errors: ${pageErrors.join(" | ")}`);
  assert.deepEqual(consoleErrors,[],`console errors: ${consoleErrors.join(" | ")}`);
  assert.deepEqual(failedRequests,[],`failed local requests: ${failedRequests.join(" | ")}`);
  assert.deepEqual(externalRequests,[],`unexpected external requests: ${externalRequests.join(" | ")}`);
  console.log("PASS: unified routing browser — Catalog, Admin, CRM, E-STRUCTURE, redirects, deep refresh, history and byte-range media.");
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
