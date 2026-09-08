// UI local với fixture, không đăng nhập hoặc gọi production.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PRODUCTS_TEST_PLAYWRIGHT_ENTRY).href);
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const browser=await chromium.launch({executablePath:process.env.PRODUCTS_TEST_BROWSER_PATH,headless:true});
const page=await browser.newPage();
await page.route('**/*',route=>route.abort());
try {
  await page.setContent('<style>'+read('css/styles.css')+'</style><div id="fixture"></div>');
  await page.evaluate(html=>{
    const doc=new DOMParser().parseFromString(html,'text/html');
    const host=document.querySelector('#fixture');host.style.padding='12px';
    host.innerHTML='<div id="viewTabsSlot"></div>';
    for(const id of ['productsPanel','productDrawerBackdrop','productDrawer'])host.append(doc.getElementById(id));
    document.querySelector('#productsPanel').classList.remove('hide');
  },read('index.html'));
  const app=read('js/features/crm-app.js');
  const slice=(a,b)=>app.slice(app.indexOf(a),app.indexOf(b));
  const harness=`
    ${read('js/features/product-catalog.js').replaceAll('export function','function')}
    ${read('js/components/app-shell.js').replaceAll('export function','function')}
    const $=id=>document.getElementById(id),clean=x=>String(x??'').trim();
    const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const normalizeKey=x=>clean(x).normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/đ/g,'d').toLowerCase();
    const uniq=x=>[...new Set(x)],uniqueOptions=x=>x.map(v=>({value:v,label:v}));
    const productSku=p=>p.code,toDate=x=>new Date(x),pageRows=(key,x)=>x.slice(0,80),renderPager=()=>{},renderProductOptions=()=>{};
    let manager=false, products=[], notices=[];const isManager=()=>manager,notice=(text,error)=>notices.push({text,error});
    let calls=[],resolveSave;const callCrmRpc=async(name,args)=>{calls.push({name,args});return new Promise(resolve=>resolveSave=resolve)};
    ${slice('function fillSelect(', 'function ownerOptions(')}
    ${slice('function productSearchText(', 'function hydrateProductFilters(')}
    ${slice('function hydrateProductFilters(', 'function renderProductOptions(')}
    ${slice('let productDrawerEditingId', 'const quoteStatusOptions')}
    renderAppShell();
    products=Array.from({length:403},(_,i)=>productFromCanonical({id:'p'+i,code:'SP'+i,name:'Gạch mẫu '+i,size:i%2?'600x600':'900x900',surface:'MATT',origin:'VN',price:'325000.125',stock_quantity:i?'125.5':null,updated_by_user_id:null}));
    productsLoading=false;renderProducts();
    document.addEventListener('click',e=>{const id=e.target.closest('[data-open-product]')?.dataset.openProduct;if(id)openProductDrawer(id)});
    $('editProductBtn').onclick=()=>{$('productDrawer').querySelectorAll('input').forEach(x=>x.disabled=false);$('editProductBtn').classList.add('hide');$('saveProductBtn').classList.remove('hide')};
    $('saveProductBtn').onclick=saveProductDrawer;$('closeProductDrawerBtn').onclick=closeProductDrawer;
    ['productSearchBox','productFilterSize','productFilterSurface','productFilterOrigin'].forEach(id=>$(id).oninput=renderProducts);
    window.fixture={get calls(){return calls},get notices(){return notices},complete(){resolveSave({id:'p0',code:'SP0',name:'Gạch mẫu 0',size:'900x900',surface:'MATT',origin:'VN',price:'325000.125',stock_quantity:'125.500000000000000001',updated_at:'2026-09-08T16:00:00Z',updated_by_user_id:'real-server-actor',updated_by_name:'Người cập nhật server'})},manager(){manager=true;renderProducts()}};
  `;
  await page.addScriptTag({content:harness});
  await page.setViewportSize({width:1440,height:1000});
  assert.equal(await page.locator('#productRows tr').count(),80);
  assert.equal(await page.locator('#addProductBtn').isVisible(),false);
  await page.locator('#productSearchBox').fill('gach mau 0');
  assert.equal(await page.locator('#productRows tr').count(),1);
  await page.locator('#productRows tr').click();
  assert.equal(await page.locator('#productPriceInput').inputValue(),'325000.125');
  assert.equal(await page.locator('#productPriceInput').isDisabled(),true);
  await page.locator('#editProductBtn').click();
  await page.locator('#productStockInput').fill('125.500000000000000001');
  await page.locator('#saveProductBtn').click();
  assert.equal(await page.evaluate(()=>fixture.notices.length),0);
  assert.deepEqual(await page.evaluate(()=>fixture.calls[0].args),{p_product_id:'p0',p_changes:{stock_quantity:'125.500000000000000001'}});
  await page.evaluate(()=>fixture.complete());
  await page.waitForFunction(()=>fixture.notices.length===1);
  assert.match(await page.locator('#productDrawerMeta').textContent(),/Người cập nhật server/);
  await page.locator('#closeProductDrawerBtn').click();
  await page.locator('#productSearchBox').fill('');
  await page.locator('#productFilterSize').selectOption('900x900');
  assert.equal(await page.locator('#productFilterSize').inputValue(),'900x900');
  const output=process.env.PRODUCTS_TEST_OUTPUT_DIR;
  if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'products-desktop.png'),fullPage:true});}
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('.product-table-wrap').isVisible(),false);
  assert.equal(await page.locator('#productCardList').isVisible(),true);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=390));
  if(output)await page.screenshot({path:path.join(output,'products-mobile.png')});
  await page.locator('.product-card').first().click();
  assert.ok(await page.locator('#editProductBtn').isVisible());
  if(output)await page.screenshot({path:path.join(output,'products-mobile-detail.png')});
  await page.locator('#closeProductDrawerBtn').click();
  await page.evaluate(()=>fixture.manager());
  assert.ok(await page.locator('#addProductBtn').isVisible());
  console.log('Product R1 UI fixture PASS: desktop/mobile 390px, search/filter, detail/edit, decimal payload, server-confirmed success/updater, create visibility.');
} finally {await browser.close();}
