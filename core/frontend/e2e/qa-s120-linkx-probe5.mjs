/**
 * Probe 5: LINK_X zoom — find .group wrapper divs, scroll into view, dispatch wheel
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
  await btn.click();await page.waitForSelector('dialog,[role="dialog"]',{timeout:6000});await page.waitForTimeout(600);
  const t=await page.$(`button[aria-label="Select template: ${name}"]`)||await page.$(`button:has-text("${name}")`);
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

  // Find div.group elements that wrap recharts (our wrapperRef)
  const result=await page.evaluate(()=>{
    // The wrapperRef div has class "group" and contains a recharts surface
    const groups=Array.from(document.querySelectorAll('div.group'));
    const plotGroups=groups.filter(g=>g.querySelector('.recharts-surface')&&g.querySelector('.recharts-wrapper'));
    return plotGroups.map((g,i)=>{
      const r=g.getBoundingClientRect();
      return {i,tag:g.tagName,class:g.className?.slice?.(0,80),w:Math.round(r.width),h:Math.round(r.height),y:Math.round(r.y)};
    }).slice(0,5);
  });
  console.log('Plot group divs:', JSON.stringify(result));

  // Scroll first large one into view and dispatch
  const dispatch=await page.evaluate(()=>{
    const groups=Array.from(document.querySelectorAll('div.group'));
    const plotGroups=groups.filter(g=>g.querySelector('.recharts-surface')&&g.querySelector('.recharts-wrapper'));
    const big=plotGroups.find(g=>{const r=g.getBoundingClientRect();return r.width>300;});
    if(!big)return 'no big group';
    big.scrollIntoView({behavior:'instant',block:'center'});
    const r=big.getBoundingClientRect();
    console.log('After scroll, group rect:', r.x,r.y,r.width,r.height);
    const evt=new WheelEvent('wheel',{
      bubbles:true,cancelable:true,
      deltaY:-300,deltaMode:0,
      clientX:r.x+r.width/2,clientY:r.y+r.height/2,
      shiftKey:true
    });
    big.dispatchEvent(evt);
    return `dispatched on div.group w=${Math.round(r.width)} h=${Math.round(r.height)} y=${Math.round(r.y)}`;
  });
  console.log('Dispatch:', dispatch);
  await page.waitForTimeout(1000);

  const resetBtn=await page.$('[aria-label="Reset zoom"]');
  console.log('Reset zoom:', resetBtn!==null);

  if(resetBtn){
    const txt=await resetBtn.evaluate(b=>b.textContent);
    console.log('Button text:', txt);
  }

  await ctx.close();await browser.close();
})();
