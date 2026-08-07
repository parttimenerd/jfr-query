/**
 * Probe: LINK_X zoom reset button — enumerate all buttons after Shift+scroll
 */
import { chromium } from 'playwright';
const BASE = 'http://localhost:3001';
const LS = [
  { name: 'jfr-tour-seen', value: '1' },
  { name: 'jfrq:onboarding-dismissed', value: '1' },
  { name: 'jfrq:ai-nudge-dismissed', value: '1' },
  { name: 'jfr-sidebar-editor-visible', value: 'true' },
];

async function idle(page,ms=60000){
  const t=Date.now();
  while(Date.now()-t<ms){
    const n=await page.evaluate(()=>document.querySelectorAll('[data-cell-status="running"]').length);
    if(n===0)return true; await page.waitForTimeout(400);
  }return false;
}
async function loadTpl(page,name){
  let btn=null;
  for(const s of['[title="New from template"]','[aria-label="New from template"]']){btn=await page.$(s);if(btn)break;}
  if(!btn){console.error('gallery btn not found');return false;}
  await btn.click();await page.waitForSelector('dialog,[role="dialog"]',{timeout:6000});await page.waitForTimeout(600);
  const t=await page.$(`button[aria-label="Select template: ${name}"]`)||await page.$(`button:has-text("${name}")`);
  if(!t){console.error('template not found');await page.keyboard.press('Escape');return false;}
  await t.click();await page.waitForTimeout(300);
  for(const s of['button:has-text("Open & Run")','button:has-text("Use template")']){const b=await page.$(s);if(b&&!await b.getAttribute('disabled')){await b.click();break;}}
  await page.waitForTimeout(1500);return idle(page,60000);
}

(async()=>{
  const browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:1440,height:900},storageState:{cookies:[],origins:[{origin:BASE,localStorage:LS}]}});
  ctx.on('dialog',d=>d.accept());
  const page=await ctx.newPage();

  await page.goto(BASE,{waitUntil:'networkidle',timeout:30000});
  await page.waitForTimeout(400);
  const skip=await page.$('button:has-text("Skip")');if(skip)await skip.click().catch(()=>{});
  const demo=await page.$('button:has-text("Try the demo")');
  await demo.click();await page.waitForTimeout(3500);await idle(page,20000);

  await loadTpl(page,'GC Pause Analysis');

  const charts=await page.$$('.recharts-surface');
  console.log(`Charts found: ${charts.length}`);
  if(charts.length===0){console.log('No charts');process.exit(0);}

  const chart=charts[0];
  const box=await chart.boundingBox();
  console.log(`Chart box: ${JSON.stringify(box)}`);

  // List all buttons before zoom
  let btns=await page.$$eval('button',bs=>bs.filter(b=>b.offsetParent!==null).map(b=>({text:b.textContent?.trim().slice(0,50),aria:b.getAttribute('aria-label'),title:b.getAttribute('title')})));
  console.log('Buttons before zoom:', JSON.stringify(btns.slice(0,20)));

  // Try zoom
  await page.mouse.move(box.x+box.width/2, box.y+box.height/2);
  await page.waitForTimeout(300);
  await page.keyboard.down('Shift');
  for(let i=0;i<5;i++){await page.mouse.wheel(0,-300);await page.waitForTimeout(100);}
  await page.keyboard.up('Shift');
  await page.waitForTimeout(1000);

  // List all buttons after zoom
  btns=await page.$$eval('button',bs=>bs.filter(b=>b.offsetParent!==null).map(b=>({text:b.textContent?.trim().slice(0,50),aria:b.getAttribute('aria-label'),title:b.getAttribute('title')})));
  console.log('Buttons after zoom:', JSON.stringify(btns));

  // Also check any element containing "reset" or "Reset"
  const resets=await page.evaluate(()=>Array.from(document.querySelectorAll('*')).filter(el=>(el.textContent||'').toLowerCase().includes('reset')&&el.offsetParent!==null&&el.children.length===0).map(el=>({tag:el.tagName,text:el.textContent?.trim().slice(0,80),aria:el.getAttribute('aria-label')})));
  console.log('Elements with reset text:', JSON.stringify(resets));

  await ctx.close();await browser.close();
})();
