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
  for(const width of [390,761,1131,1180,1280]){
    await page.setViewportSize({width,height:900});
    const position=await page.locator('.layout>aside.panel').evaluate(el=>getComputedStyle(el).position);
    assert.equal(position,width<=1180?'static':'sticky',`sidebar tại ${width}px`);
    if(width<=1180){
      const boxes=await page.locator('.layout').evaluate(el=>[...el.children].map(x=>{const r=x.getBoundingClientRect();return {top:r.top,bottom:r.bottom};}));
      assert.ok(boxes[1].top>=boxes[0].bottom,'hai vùng không chồng nhau');
    }
    assert.equal(await page.locator('#viewTabsSlot').isVisible(),false,'tab ngang cũ phải ẩn');
    assert.equal(await page.locator('#desktopSidebar').isVisible(),width>760,`Sidebar desktop tại ${width}px`);
    assert.equal(await page.locator('#mobileNavOpenBtn').isVisible(),width<=760,`Hamburger tại ${width}px`);
    if(width>760){
      const sidebarWidth=await page.locator('#desktopSidebar').evaluate(el=>el.getBoundingClientRect().width);
      assert.equal(sidebarWidth,240,'Sidebar desktop rộng 240px');
    }
  }
  console.log('PASS full shell layout: 390/761/1131/1180/1280px');
} finally {await browser.close();}
