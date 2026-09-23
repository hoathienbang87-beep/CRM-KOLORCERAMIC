import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {pathToFileURL} from "node:url";

const entry=process.env.KPI2_PHASE4_PLAYWRIGHT_ENTRY,browserPath=process.env.KPI2_PHASE4_BROWSER_PATH;
if(!entry||!browserPath)throw new Error("Set KPI2_PHASE4_PLAYWRIGHT_ENTRY and KPI2_PHASE4_BROWSER_PATH.");
const {chromium}=await import(pathToFileURL(entry).href),root=path.resolve(import.meta.dirname,"..");
const html=`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/css/styles.css"></head><body><aside id="context" class="drawer kpi-team-detail-drawer"><div style="height:1500px">Historical TEST Event</div></aside><div class="drawer-backdrop is-detail-modal"></div><aside id="detailModal" class="drawer detail-modal is-detail-modal is-evidence-viewer" role="dialog" aria-modal="true"><div class="drawer-head"><div><h2>Minh chứng KPI</h2><div class="muted">Minh chứng đã gửi kèm Event</div></div><button id="close">Đóng</button></div><div id="detailModalContent" class="detail-content muted"></div></aside><script type="module">import * as api from '/js/features/kpi-team.js';window.viewer=api;</script></body></html>`;
const server=http.createServer((request,response)=>{const url=decodeURIComponent((request.url||"/").split("?")[0]);if(url==="/fixture.html"){response.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Connection":"close"});return response.end(html);}const file=path.resolve(root,url.replace(/^\//,""));if(!file.startsWith(root)||!fs.existsSync(file)){response.writeHead(404);return response.end();}response.writeHead(200,{"Content-Type":file.endsWith(".js")?"text/javascript":"text/css","Connection":"close"});fs.createReadStream(file).pipe(response);});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch({executablePath:browserPath,headless:true});
const svg=(width,height,color)=>`data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" text-anchor="middle" fill="white" font-size="48">evidence</text></svg>`).toString("base64")}`;
const portrait=svg(600,1200,"#17643c"),landscape=svg(1600,900,"#174ea6");
try{
  const page=await browser.newPage({viewport:{width:1400,height:900}});
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture.html`,{waitUntil:"networkidle"});
  await page.waitForFunction(()=>!!window.viewer);

  // A. Portrait opens large immediately with no nested link.
  await page.evaluate(url=>{detailModalContent.innerHTML=viewer.kpiEvidenceViewerHtml([{url,kind:"image"}]);},portrait);
  await page.locator(".evidence-viewer-media").waitFor();
  const portraitBox=await page.locator(".evidence-viewer-media").boundingBox(),modalBox=await page.locator("#detailModal").boundingBox();
  assert.ok(modalBox.width>=1300&&modalBox.height>=840,"desktop modal should use roughly 94vw x 94vh");
  assert.ok(portraitBox.height>=680&&portraitBox.height<=780,"portrait evidence should use most available viewer height");
  assert.equal(await page.locator("#detailModalContent a").count(),0,"image must not require a second click");

  // B. Landscape remains contained and aspect ratio is preserved.
  await page.evaluate(url=>{detailModalContent.innerHTML=viewer.kpiEvidenceViewerHtml([{url,kind:"image"}]);},landscape);
  const landscapeBox=await page.locator(".evidence-viewer-media").boundingBox();
  assert.ok(landscapeBox.width>1100&&landscapeBox.height<modalBox.height,"landscape evidence should expand by width and remain contained");
  assert.ok(Math.abs((landscapeBox.width/landscapeBox.height)-(1600/900))<0.04,"landscape aspect ratio must be preserved");

  // C. Video is a directly playable large control.
  await page.evaluate(()=>{detailModalContent.innerHTML=viewer.kpiEvidenceViewerHtml([{url:"data:video/mp4;base64,",kind:"video"}]);});
  const video=page.locator("video.evidence-viewer-media");
  assert.equal(await video.count(),1);assert.equal(await video.getAttribute("controls"),"");assert.equal(await video.getAttribute("playsinline"),"");
  assert.ok((await video.boundingBox()).width>1000,"video control should open large");

  // D. Two items use two columns on desktop and require no gallery click.
  await page.evaluate(({portrait,landscape})=>{detailModalContent.innerHTML=viewer.kpiEvidenceViewerHtml([{url:portrait,kind:"image"},{url:landscape,kind:"image"}]);},{portrait,landscape});
  const desktopItems=await page.locator(".evidence-viewer-item").evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return {x:box.x,y:box.y,width:box.width,height:box.height};}));
  assert.equal(desktopItems.length,2);assert.ok(Math.abs(desktopItems[0].y-desktopItems[1].y)<3,"desktop two-item viewer should use columns when space allows");
  assert.equal(await page.locator("#detailModalContent a").count(),0);

  // E/I/J. Close stays visible; 390px and 360px stack vertically without horizontal overflow.
  for(const width of [390,360]){
    await page.setViewportSize({width,height:800});
    const closeBox=await page.locator("#close").boundingBox();assert.ok(closeBox.y>=0&&closeBox.y+closeBox.height<=800,`Close must remain visible at ${width}px`);
    const items=await page.locator(".evidence-viewer-item").evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return {x:box.x,y:box.y,width:box.width,height:box.height};}));assert.ok(items[1].y>items[0].y+items[0].height-2,`two evidence items must stack at ${width}px`);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert.ok(overflow<=1,`viewer must not overflow horizontally at ${width}px`);
  }
  console.log("KPI-2 Phase 6H evidence viewer browser: A-E/I/J PASS");
}finally{await browser.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
