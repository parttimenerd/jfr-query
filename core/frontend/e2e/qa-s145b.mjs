/**
 * S145b — test the 3 missing templates: Exceptions & Errors, GC Deep Dive, Threading & Contention
 */
import { chromium } from 'playwright';
const BASE = 'http://localhost:3001';
const LS = [
  {name:'jfr-tour-seen',value:'1'},{name:'jfrq:onboarding-dismissed',value:'1'},
  {name:'jfrq:ai-nudge-dismissed',value:'1'},{name:'jfr-sidebar-editor-visible',value:'true'},
];
const TEMPLATES = ['Exceptions & Errors','GC Deep Dive','Threading & Contention'];

async function idle(page,ms=120000){
  const t=Date.now();
  while(Date.now()-t<ms){
    if(!await page.evaluate(()=>document.querySelectorAll('[data-cell-status="running"]').length))return true;
    await page.waitForTimeout(500);
  }
  return false;
}
async function domScan(page){
  return page.evaluate(()=>
    Array.from(document.querySelectorAll('*')).filter(el=>{
      const text=el.textContent||'';
      return (text.includes('Catalog Error')||text.includes('does not exist')||
              text.includes('Invalid plot')||text.includes('Query has errors')||
              text.includes('Binder Error')||text.includes('Parser Error'))
        &&el.children.length===0&&el.offsetParent!==null
        &&!el.closest('.cm-editor')&&!el.closest('[class*="token"]');
    }).map(e=>e.textContent.trim().slice(0,150))
  );
}
async function loadDemo(page){
  await page.goto(BASE,{waitUntil:'networkidle',timeout:30000});
  const skip=await page.$('button:has-text("Skip")');if(skip)await skip.click().catch(()=>{});
  const demo=await page.$('button:has-text("Try the demo"),a:has-text("Try the demo")');
  if(demo){await demo.click();await page.waitForTimeout(2000);}
  await idle(page,60000);
}
async function loadTpl(page,name){
  const btn=await page.$('[title="New from template"],[aria-label="New from template"]');
  if(!btn){return false;}
  await btn.click();
  await page.waitForSelector('dialog,[role="dialog"]',{timeout:8000}).catch(()=>{});
  await page.waitForTimeout(500);
  const t=await page.$(`button[aria-label="Select template: ${name}"]`)||await page.$(`button:has-text("${name}")`);
  if(!t){await page.keyboard.press('Escape');console.log(`  ✗ template not found: ${name}`);return false;}
  await t.click();await page.waitForTimeout(300);
  for(const s of['button:has-text("Open & Run")','button:has-text("Use template")','button:has-text("Open")']){
    const b=await page.$(s);if(b&&!(await b.getAttribute('disabled'))){await b.click();break;}
  }
  await page.waitForTimeout(3000);await idle(page,120000);return true;
}

(async()=>{
  const browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:1440,height:900},storageState:{cookies:[],origins:[{origin:BASE,localStorage:LS}]}});
  ctx.on('dialog',d=>d.accept());
  const page=await ctx.newPage();
  const consoleErrs=[];
  page.on('console',msg=>{
    if(msg.type()==='error'){
      const t=msg.text();
      if(!t.includes('ONNX')&&!t.includes('ort-')&&!t.includes('/api/')&&!t.includes('proxy')&&
         !t.includes('Failed to load resource')&&!t.includes('net::ERR_')&&
         !t.includes('conditional view failed')&&!t.includes('recharts')&&
         !t.includes('wasm streaming compile')&&!t.includes('falling back to ArrayBuffer'))
        consoleErrs.push(t.slice(0,200));
    }
  });

  for(const name of TEMPLATES){
    await loadDemo(page);
    const ok=await loadTpl(page,name);
    if(!ok){console.log(`[${name}] ✗ not loaded`);continue;}
    const runAll=await page.$('[aria-label="Run All Queries"],[title="Run All Queries"]');
    if(runAll){await runAll.click();await page.waitForTimeout(1000);await idle(page,120000);}
    const errs=await domScan(page);
    const charts=await page.evaluate(()=>document.querySelectorAll('.recharts-surface').length);
    const svgs=await page.evaluate(()=>document.querySelectorAll('svg').length);
    const status=errs.length===0?'✅':'❌';
    console.log(`[${name}] ${status} charts=${charts} svgs=${svgs} errors=${errs.length}`);
    if(errs.length) errs.forEach(e=>console.log('  ERR: '+e));
  }

  console.log(`\nConsole errors: ${consoleErrs.length}`);
  consoleErrs.slice(0,5).forEach(e=>console.log('  '+e));

  // Also test the help modal with a different selector
  await loadDemo(page);
  await loadTpl(page,'GC Pause Analysis');
  // Try all possible help button selectors
  const helpSelectors=[
    '[title="Keyboard Shortcuts & Tips (?)"]',
    'button[aria-label="Keyboard Shortcuts"]',
    'button[aria-label*="shortcut"]',
    'button[title*="shortcut"]',
    'button[title*="help"]',
    'button[title*="Help"]',
    '[aria-label*="help"]',
    '[aria-label*="Help"]',
    'button:has-text("?")',
  ];
  let helpFound=false;
  for(const sel of helpSelectors){
    const btn=await page.$(sel);
    if(btn){
      const title=await btn.evaluate(el=>el.title||el.getAttribute('aria-label')||'?');
      console.log(`\nHelp btn found: "${sel}" title="${title}"`);
      await btn.click();await page.waitForTimeout(600);
      const modal=await page.$('[role="dialog"]');
      const hasContent=modal?await modal.evaluate(el=>el.textContent?.includes('Ctrl')||el.textContent?.includes('Cmd')||el.textContent?.includes('shortcut')||el.textContent?.includes('Shift')):false;
      console.log(`Help modal: opened=${!!modal}, hasShortcuts=${hasContent}`);
      if(modal)await page.keyboard.press('Escape');
      helpFound=true;break;
    }
  }
  if(!helpFound){
    // Dump all button titles for debugging
    const btns=await page.evaluate(()=>
      Array.from(document.querySelectorAll('button')).map(b=>({
        title:b.title,aria:b.getAttribute('aria-label'),text:b.textContent?.trim().slice(0,30)
      })).filter(b=>b.title||b.aria)
    );
    console.log('\nAll titled buttons:', JSON.stringify(btns.slice(0,30)));
  }

  await ctx.close();await browser.close();process.exit(0);
})();
