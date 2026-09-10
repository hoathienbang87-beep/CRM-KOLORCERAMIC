// Regression khung trang thật: sidebar không che nội dung khi layout một cột.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PRODUCTS_TEST_PLAYWRIGHT_ENTRY).href);
const browser=await chromium.launch({executablePath:process.env.PRODUCTS_TEST_BROWSER_PATH,headless:true});
try {
  const page=await browser.newPage();
  await page.route('**/*',r=>r.abort());
  const html=fs.readFileSync('index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  await page.setContent(html);
  await page.addStyleTag({content:fs.readFileSync('css/styles.css','utf8')});
  await page.addScriptTag({content:fs.readFileSync('js/components/app-shell.js','utf8').replaceAll('export function','function').replaceAll('export const','const')+';renderAppShell();'});
  await page.evaluate(()=>{
    document.querySelector('#loginView').classList.add('hide');
    document.querySelector('#maintenanceView').classList.add('hide');
    document.querySelector('#appView').classList.remove('hide');
  });
  assert.equal(await page.locator('.layout>aside.panel').count(),0,'permanent Add Customer aside phải được gỡ');
  for(const width of [360,390,768,1180,1440]){
    await page.setViewportSize({width,height:900});
    const layout=await page.locator('.layout').boundingBox();
    const rootBox=await page.locator('.workspace-root').boundingBox();
    assert.ok(layout && rootBox && rootBox.width >= layout.width-40,'workspace phải dùng chiều rộng shell đã giải phóng');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    assert.ok(overflow<=1,`shell không được tràn ngang tại ${width}px`);
  }
  console.log('PASS full shell layout: 390/761/1131/1180/1280px');
} finally {await browser.close();}
