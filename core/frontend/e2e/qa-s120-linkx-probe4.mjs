/**
 * Probe 4: LINK_X zoom — scroll chart into view, dispatch on wrapper div
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

  // Scroll the first big chart into view, then dispatch wheel on wrapper
  const result=await page.evaluate(()=>{
    // Find a chart wrapper div (the div that has the onWheel handler)
    const surfaces=Array.from(document.querySelectorAll('.recharts-surface'));
    const bigSvg=surfaces.find(el=>{const r=el.getBoundingClientRect();return r.width>300&&r.height>100;});
    if(!bigSvg)return {error:'no big svg'};
    // Walk up to find the div that surrounds it (the wrapperRef div)
    let wrapper=bigSvg.parentElement;
    while(wrapper&&wrapper.tagName!=='DIV'){wrapper=wrapper.parentElement;}
    if(!wrapper)return {error:'no wrapper div'};
    // Scroll into view
    bigSvg.scrollIntoView({behavior:'instant',block:'center'});
    return {wrapperTag:wrapper.tagName,wrapperClass:wrapper.className?.slice?.(0,80)};
  });
  console.log('Wrapper info:', result);
  await page.waitForTimeout(500);

  // Now dispatch on wrapper
  const dispatchResult=await page.evaluate(()=>{
    const surfaces=Array.from(document.querySelectorAll('.recharts-surface'));
    const bigSvg=surfaces.find(el=>{const r=el.getBoundingClientRect();return r.width>300&&r.height>100;});
    if(!bigSvg)return 'no big svg';
    bigSvg.scrollIntoView({behavior:'instant',block:'center'});
    const r=bigSvg.getBoundingClientRect();
    console.log('After scroll, chart viewport rect:', r.x, r.y, r.width, r.height);
    // Find parent div wrapper (wrapperRef)
    // Walk up from svg > recharts-wrapper > div (our wrapper)
    let el=bigSvg;
    // go up multiple levels to find the zoom wrapper
    for(let i=0;i<5;i++){
      el=el.parentElement;
      if(!el)break;
      const rect=el.getBoundingClientRect();
      console.log(`Level ${i}: tag=${el.tagName} class=${el.className?.slice?.(0,50)} rect=${rect.x.toFixed(0)},${rect.y.toFixed(0)} ${rect.width.toFixed(0)}x${rect.height.toFixed(0)}`);
    }
    // Dispatch on each level
    el=bigSvg.parentElement;
    for(let i=0;i<5;i++){
      if(!el)break;
      const rect=el.getBoundingClientRect();
      if(rect.width>300){
        const evt=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-300,deltaMode:0,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2,shiftKey:true});
        el.dispatchEvent(evt);
        return `dispatched on level tag=${el.tagName} class=${el.className?.slice?.(0,50)}`;
      }
      el=el.parentElement;
    }
    return 'no suitable wrapper found';
  });
  console.log('Dispatch result:', dispatchResult);
  await page.waitForTimeout(1000);

  const resetBtn=await page.$('[aria-label="Reset zoom"]');
  console.log('Reset zoom button:', resetBtn!==null);

  await ctx.close();await browser.close();
})();
