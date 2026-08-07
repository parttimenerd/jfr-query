/**
 * S119 batch-C: Memory Leak Detection + Threading & Contention + Comprehensive Feature Test + ZGC Analysis + GC Deep Dive
 */
import { chromium } from 'playwright';
const BASE = 'http://localhost:3001';
const LS = [
  { name: 'jfr-tour-seen', value: '1' },
  { name: 'jfrq:onboarding-dismissed', value: '1' },
  { name: 'jfrq:ai-nudge-dismissed', value: '1' },
  { name: 'jfr-sidebar-editor-visible', value: 'true' },
];
const ERR = ['Catalog Error', 'does not exist', 'Invalid plot', 'Query has errors', 'Binder Error', 'Parser Error'];

const P=[],F=[];
const pass=l=>{console.log(`  ✅ ${l}`);P.push(l);};
const fail=(l,d)=>{console.log(`  ❌ ${l}: ${d}`);F.push({l,d});};

async function idle(page,ms=60000){
  const t=Date.now();
  while(Date.now()-t<ms){
    const n=await page.evaluate(()=>document.querySelectorAll('[data-cell-status="running"]').length+Array.from(document.querySelectorAll('*')).filter(e=>e.textContent?.trim()==='Running...'&&e.offsetParent!==null).length);
    if(n===0)return true; await page.waitForTimeout(400);
  }return false;
}
async function scan(page){
  return page.evaluate(terms=>Array.from(document.querySelectorAll('*')).filter(el=>{const t=el.textContent||'';return terms.some(x=>t.includes(x))&&el.children.length===0&&el.offsetParent!==null&&!el.closest('.cm-editor')&&!el.closest('[class*="token"]');}).map(e=>e.textContent.trim().slice(0,120)),ERR);
}
async function scroll(page){
  await page.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=window.innerHeight){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,80));}window.scrollTo(0,0);});
}
async function loadTpl(page,name){
  let btn=null;
  for(const s of['[title="New from template"]','[aria-label="New from template"]']){btn=await page.$(s);if(btn)break;}
  if(!btn){fail(name,'gallery btn not found');return false;}
  await btn.click();await page.waitForSelector('dialog,[role="dialog"]',{timeout:6000});await page.waitForTimeout(600);
  const t=await page.$(`button[aria-label="Select template: ${name}"]`)||await page.$(`button:has-text("${name}")`);
  if(!t){fail(name,'not in gallery');await page.keyboard.press('Escape');return false;}
  await t.click();await page.waitForTimeout(300);
  for(const s of['button:has-text("Open & Run")','button:has-text("Use template")']){const b=await page.$(s);if(b&&!await b.getAttribute('disabled')){await b.click();break;}}
  await page.waitForTimeout(1500);return idle(page,60000);
}

(async()=>{
  const browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:1440,height:900},storageState:{cookies:[],origins:[{origin:BASE,localStorage:LS}]}});
  ctx.on('dialog',d=>d.accept());
  const page=await ctx.newPage();
  const cerrs=[];
  page.on('console',msg=>{if(msg.type()==='error'){const t=msg.text();if(!t.includes('ONNX')&&!t.includes('ort-')&&!t.includes('/api/')&&!t.includes('proxy')&&!t.includes('Failed to load resource')&&!t.includes('net::ERR_')&&!t.includes('conditional view failed'))cerrs.push(t.slice(0,200));}});

  await page.goto(BASE,{waitUntil:'networkidle',timeout:30000});
  await page.waitForTimeout(400);
  const skip=await page.$('button:has-text("Skip")');if(skip)await skip.click().catch(()=>{});
  await page.waitForTimeout(200);
  const demo=await page.$('button:has-text("Try the demo")');
  if(!demo){console.error('no demo');process.exit(1);}
  await demo.click();await page.waitForTimeout(3500);await idle(page,20000);

  for(const name of['Memory Leak Detection','Threading & Contention','Comprehensive Feature Test','ZGC Analysis','GC Deep Dive']){
    console.log(`\nLoading: ${name}`);
    const ok=await loadTpl(page,name);
    if(!ok){fail(name,'did not idle');continue;}
    const c=await page.evaluate(()=>document.querySelectorAll('[data-cell-status]').length);
    const s=await page.evaluate(()=>document.querySelectorAll('svg').length);
    let e=await scan(page);
    if(e.length===0) pass(`${name}: ${c} cells, ${s} SVGs, 0 errors`); else fail(name,e.join(' | '));
    await scroll(page); e=await scan(page);
    if(e.length===0) pass(`${name}: scroll 0 errors`); else fail(`${name} scroll`,e.join(' | '));
  }

  if(cerrs.length===0) pass('Console: 0 real errors'); else cerrs.forEach(e=>console.log(`  [console error] ${e}`));

  await ctx.close();await browser.close();
  console.log(`\nPASS:${P.length} FAIL:${F.length}`);
  if(F.length===0)console.log('All passed ✅');
  else{F.forEach(f=>console.log(`  ❌ ${f.l}: ${f.d}`));process.exit(1);}
})();
