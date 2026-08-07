/**
 * Probe 2: LINK_X zoom — find large charts, try scrolling on them
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

  // Find all recharts surfaces with large bounding box
  const surfaceData=await page.evaluate(()=>
    Array.from(document.querySelectorAll('.recharts-surface')).map((el,i)=>{
      const r=el.getBoundingClientRect();
      return {i,w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),y:Math.round(r.y)};
    })
  );
  console.log('All recharts surfaces:', JSON.stringify(surfaceData.slice(0,20)));

  // Try zoom on a big one (w > 300)
  const bigIdx=surfaceData.findIndex(s=>s.w>300&&s.h>100);
  console.log(`Biggest surface index: ${bigIdx}`, bigIdx>=0?surfaceData[bigIdx]:'none');

  if(bigIdx>=0){
    const big=surfaceData[bigIdx];
    // scroll to make it visible
    await page.evaluate(({x,y})=>window.scrollTo(0,y-100),big);
    await page.waitForTimeout(300);

    // Re-measure after scroll
    const charts=await page.$$('.recharts-surface');
    const chart=charts[bigIdx];
    const box=await chart.boundingBox();
    console.log('Target chart box after scroll:', box);

    await page.mouse.move(box.x+box.width/2, box.y+box.height/2);
    await page.waitForTimeout(200);
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0,-300);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(1000);

    const btns=await page.$$eval('button',bs=>bs.filter(b=>b.offsetParent!==null).map(b=>({text:b.textContent?.trim().slice(0,60),aria:b.getAttribute('aria-label')})).filter(b=>b.text||b.aria));
    const resetBtns=btns.filter(b=>(b.text||'').toLowerCase().includes('reset')||(b.aria||'').toLowerCase().includes('reset'));
    console.log('Reset-related buttons after zoom:', JSON.stringify(resetBtns));
    console.log('All buttons:', JSON.stringify(btns.slice(0,30)));
  }

  await ctx.close();await browser.close();
})();
