/**
 * Probe 3: LINK_X zoom — dispatch WheelEvent directly via JS
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
  if(!btn){return false;}
  await btn.click();await page.waitForSelector('dialog,[role="dialog"]',{timeout:6000});await page.waitForTimeout(600);
  const t=await page.$(`button[aria-label="Select template: ${name}"]`)||await page.$(`button:has-text("${name}")`);
  if(!t){await page.keyboard.press('Escape');return false;}
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
  const skip=await page.$('button:has-text("Skip")');if(skip)await skip.click().catch(()=>{});
  const demo=await page.$('button:has-text("Try the demo")');
  await demo.click();await page.waitForTimeout(3500);await idle(page,20000);
  await loadTpl(page,'GC Pause Analysis');

  // Find big chart
  const bigChart=await page.evaluate(()=>{
    const surfaces=Array.from(document.querySelectorAll('.recharts-surface'));
    const big=surfaces.find(el=>{
      const r=el.getBoundingClientRect();
      return r.width>300&&r.height>100;
    });
    return big?{found:true,w:big.getBoundingClientRect().width,h:big.getBoundingClientRect().height}:{found:false};
  });
  console.log('Big chart:', bigChart);

  // Dispatch WheelEvent directly on the big chart with shiftKey
  const result=await page.evaluate(()=>{
    const surfaces=Array.from(document.querySelectorAll('.recharts-surface'));
    const big=surfaces.find(el=>{const r=el.getBoundingClientRect();return r.width>300&&r.height>100;});
    if(!big)return 'no big chart';
    const r=big.getBoundingClientRect();
    const wheelEvent=new WheelEvent('wheel',{
      bubbles:true,cancelable:true,
      deltaY:-300,deltaMode:0,
      clientX:r.x+r.width/2,clientY:r.y+r.height/2,
      shiftKey:true
    });
    big.dispatchEvent(wheelEvent);
    return `dispatched to ${big.tagName} at ${Math.round(r.x)},${Math.round(r.y)}`;
  });
  console.log('Dispatch result:', result);
  await page.waitForTimeout(1000);

  // Check for reset button
  const resetBtn=await page.$('[aria-label="Reset zoom"]');
  console.log('Reset zoom button found:', resetBtn!==null);

  // List any new buttons
  const btns=await page.$$eval('button',bs=>bs.filter(b=>b.offsetParent!==null&&(b.textContent||b.getAttribute('aria-label')||'').toLowerCase().includes('reset')).map(b=>({text:b.textContent?.trim(),aria:b.getAttribute('aria-label')})));
  console.log('Reset buttons:', JSON.stringify(btns));

  await ctx.close();await browser.close();
})();
