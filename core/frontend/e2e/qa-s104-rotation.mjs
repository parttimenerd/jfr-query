/**
 * S104 template rotation: JVM Internals + Memory Leak Detection
 */
import { chromium } from 'playwright';
const BASE = 'http://localhost:3001';
const LS = [
  { name: 'jfr-tour-seen', value: '1' },
  { name: 'jfrq:onboarding-dismissed', value: '1' },
  { name: 'jfrq:ai-nudge-dismissed', value: '1' },
  { name: 'jfr-sidebar-editor-visible', value: 'true' },
];
const ERR_TERMS = ['Catalog Error','does not exist','Invalid plot','Query has errors','Binder Error','Parser Error'];
async function waitIdle(page, ms=40000) {
  const t = Date.now();
  while (Date.now()-t < ms) {
    const n = await page.evaluate(() =>
      document.querySelectorAll('[data-cell-status="running"]').length +
      Array.from(document.querySelectorAll('*')).filter(e=>e.textContent?.trim()==='Running...'&&e.offsetParent!==null).length
    );
    if (n===0) return true;
    await page.waitForTimeout(400);
  }
  return false;
}
async function domScan(page) {
  return page.evaluate((t)=>Array.from(document.querySelectorAll('*')).filter(el=>{
    const tx=el.textContent||'';
    return t.some(x=>tx.includes(x))&&el.children.length===0&&el.offsetParent!==null
      &&!el.closest('.cm-editor')&&!el.closest('[class*="token"]');
  }).map(e=>e.textContent.trim().slice(0,120)),ERR_TERMS);
}
const P=[],F=[];
const pass=l=>{console.log(`  ✅ ${l}`);P.push(l);};
const fail=(l,d)=>{console.log(`  ❌ ${l}: ${d}`);F.push({l,d});};
async function loadTpl(page,name) {
  let btn=null;
  for(const s of ['[title="New from template"]','[aria-label="New from template"]']){btn=await page.$(s);if(btn)break;}
  if(!btn){fail(name,'no gallery btn');return false;}
  await btn.click();
  await page.waitForSelector('dialog,[role="dialog"]',{timeout:5000});
  await page.waitForTimeout(300);
  const t=await page.$(`button[aria-label="Select template: ${name}"]`)||await page.$(`button:has-text("${name}")`);
  if(!t){fail(name,'not in gallery');await page.keyboard.press('Escape');return false;}
  await t.click();await page.waitForTimeout(300);
  for(const s of ['button:has-text("Open & Run")','button:has-text("Use template")']){
    const b=await page.$(s);if(b&&!await b.getAttribute('disabled')){await b.click();break;}
  }
  await page.waitForTimeout(1000);
  return waitIdle(page,40000);
}
(async()=>{
  const browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({storageState:{cookies:[],origins:[{origin:BASE,localStorage:LS}]}});
  ctx.on('dialog',d=>d.accept());
  const page=await ctx.newPage();
  const errs=[];
  page.on('console',m=>{
    if(m.type()==='error'){const t=m.text();
    if(!t.includes('ONNX')&&!t.includes('ort-')&&!t.includes('/api/')&&!t.includes('proxy')
       &&!t.includes('Failed to load resource')&&!t.includes('net::ERR_'))errs.push(t.slice(0,150));}
  });
  await page.goto(BASE,{waitUntil:'networkidle',timeout:30000});
  await page.waitForTimeout(500);
  const skip=await page.$('button:has-text("Skip")');if(skip)await skip.click().catch(()=>{});
  await page.waitForTimeout(200);
  const demo=await page.$('button:has-text("Try the demo")');if(!demo){process.exit(1);}
  await demo.click();await page.waitForTimeout(3500);await waitIdle(page,20000);
  for(const name of ['JVM Internals','Memory Leak Detection']){
    console.log(`\nLoading: ${name}`);
    const ok=await loadTpl(page,name);
    const cells=await page.evaluate(()=>document.querySelectorAll('[data-cell-status]').length);
    const svgs=await page.evaluate(()=>document.querySelectorAll('svg').length);
    if(!ok){fail(name,'not idle');continue;}
    const e=await domScan(page);
    // Also scroll-scan
    const scrollErrs=[];
    for(let s=0;s<=4000;s+=1000){
      await page.evaluate(sc=>{(document.querySelector('main')||document.documentElement).scrollTop=sc;},s);
      await page.waitForTimeout(300);
      const se=await domScan(page);
      scrollErrs.push(...se);
    }
    const allErrs=[...new Set([...e,...scrollErrs])];
    if(allErrs.length===0)pass(`${name}: ${cells} cells, ${svgs} SVGs, 0 DOM errors`);
    else fail(name,allErrs.join(' | '));
  }
  if(errs.length===0)pass('Console: 0 real errors');
  else fail('Console',errs.join(' | '));
  await ctx.close();await browser.close();
  console.log(`\n=== SUMMARY ===\nPASS: ${P.length}, FAIL: ${F.length}`);
  if(F.length===0)console.log('All checks passed ✅');
  else{F.forEach(f=>console.log(`  ❌ ${f.l}: ${f.d}`));process.exit(1);}
})();
