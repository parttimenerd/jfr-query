/**
 * S121 QA: demo + full interactive suite + CPU Profiling + JVM Internals
 * Uses selectors validated in S120.
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

const P=[],F=[],W=[];
const pass=l=>{console.log(`  ✅ ${l}`);P.push(l);};
const fail=(l,d)=>{console.log(`  ❌ ${l}: ${d}`);F.push({l,d});};
const warn=(l,d='')=>{console.log(`  ⚠  ${l}${d?': '+d:''}`);W.push(l);};

async function idle(page,ms=60000){
  const t=Date.now();
  while(Date.now()-t<ms){
    const n=await page.evaluate(()=>
      document.querySelectorAll('[data-cell-status="running"]').length+
      Array.from(document.querySelectorAll('*')).filter(e=>e.textContent?.trim()==='Running...'&&e.offsetParent!==null).length
    );
    if(n===0)return true;
    await page.waitForTimeout(400);
  }
  return false;
}
async function scan(page){
  return page.evaluate(terms=>
    Array.from(document.querySelectorAll('*')).filter(el=>{
      const t=el.textContent||'';
      return terms.some(x=>t.includes(x))&&el.children.length===0&&el.offsetParent!==null
        &&!el.closest('.cm-editor')&&!el.closest('[class*="token"]');
    }).map(e=>e.textContent.trim().slice(0,120)),
  ERR);
}
async function scroll(page){
  await page.evaluate(async()=>{
    for(let y=0;y<document.body.scrollHeight;y+=window.innerHeight){
      window.scrollTo(0,y);await new Promise(r=>setTimeout(r,80));
    }
    window.scrollTo(0,0);
  });
}
async function loadTpl(page,name){
  let btn=null;
  for(const s of['[title="New from template"]','[aria-label="New from template"]']){
    btn=await page.$(s);if(btn)break;
  }
  if(!btn){fail(name,'gallery btn not found');return false;}
  await btn.click();
  await page.waitForSelector('dialog,[role="dialog"]',{timeout:6000});
  await page.waitForTimeout(600);
  const t=await page.$(`button[aria-label="Select template: ${name}"]`)||
           await page.$(`button:has-text("${name}")`);
  if(!t){fail(name,'not in gallery');await page.keyboard.press('Escape');return false;}
  await t.click();await page.waitForTimeout(300);
  for(const s of['button:has-text("Open & Run")','button:has-text("Use template")']){
    const b=await page.$(s);
    if(b&&!await b.getAttribute('disabled')){await b.click();break;}
  }
  await page.waitForTimeout(1500);
  return idle(page,60000);
}

(async()=>{
  const browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({
    viewport:{width:1440,height:900},
    storageState:{cookies:[],origins:[{origin:BASE,localStorage:LS}]},
  });
  ctx.on('dialog',d=>d.accept());
  const page=await ctx.newPage();
  const cerrs=[];
  page.on('console',msg=>{
    if(msg.type()==='error'){
      const t=msg.text();
      if(!t.includes('ONNX')&&!t.includes('ort-')&&!t.includes('/api/')&&
         !t.includes('proxy')&&!t.includes('Failed to load resource')&&
         !t.includes('net::ERR_')&&!t.includes('conditional view failed'))
        cerrs.push(t.slice(0,200));
    }
  });

  // ── LOAD DEMO ──
  console.log('\n══ DEMO NOTEBOOK ══');
  await page.goto(BASE,{waitUntil:'networkidle',timeout:30000});
  await page.waitForTimeout(400);
  const skip=await page.$('button:has-text("Skip")');
  if(skip)await skip.click().catch(()=>{});
  await page.waitForTimeout(200);
  const demo=await page.$('button:has-text("Try the demo")');
  if(!demo){console.error('no demo button');process.exit(1);}
  await demo.click();await page.waitForTimeout(3500);await idle(page,20000);

  let e=await scan(page);
  if(e.length===0) pass('Demo: DOM scan 0 errors'); else fail('Demo: DOM scan',e.join(' | '));
  const svgs=await page.evaluate(()=>document.querySelectorAll('svg').length);
  const cells=await page.evaluate(()=>document.querySelectorAll('[data-cell-status]').length);
  pass(`Demo: ${cells} cells, ${svgs} SVGs`);
  await scroll(page);e=await scan(page);
  if(e.length===0) pass('Demo: scroll scan 0 errors'); else fail('Demo scroll',e.join(' | '));

  // ── INTERACTIVE FEATURES ──
  console.log('\n══ INTERACTIVE FEATURES ══');
  await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(200);

  // Variables — toggle with "Notebook Variables" role=button, input via aria-label "Value for {k}"
  {
    // Try to find value input directly (panel might already be expanded)
    let inp=await page.$('[aria-label^="Value for"]');
    if(!inp){
      // Try to expand the panel
      const toggle=await page.$('[role="button"]:has-text("Notebook Variables"),[aria-expanded]');
      if(toggle){await toggle.click();await page.waitForTimeout(400);}
      inp=await page.$('[aria-label^="Value for"]');
    }
    if(inp){
      const orig=await inp.evaluate(el=>el.value);
      await inp.click({clickCount:3});await inp.type('50');await inp.press('Enter');
      await page.waitForTimeout(800);
      pass('Variables: opened, value changed');
      // restore
      await inp.click({clickCount:3});await inp.type(orig||'');await inp.press('Enter');
      await page.waitForTimeout(400);
    } else warn('Variables: no value input found');
  }

  // Collapse All + Expand All
  const colBtn=await page.$('[aria-label="Collapse All"],[title="Collapse All"]');
  if(colBtn){await colBtn.click();await page.waitForTimeout(400);pass('Collapse All: clicked');}
  else warn('Collapse All: not found');
  const expBtn=await page.$('[aria-label="Expand All"],[title="Expand All"]');
  if(expBtn){await expBtn.click();await page.waitForTimeout(400);pass('Expand All: clicked');}
  else warn('Expand All: not found');

  // Run All
  const runAll=await page.$('[aria-label="Run All Queries"],[title="Run All Queries"]');
  if(runAll){
    await runAll.click();await page.waitForTimeout(1000);await idle(page,30000);
    e=await scan(page);
    if(e.length===0) pass('Run All: 0 DOM errors'); else fail('Run All',e.join(' | '));
  } else warn('Run All: button not found');

  // Schema explorer — find GarbageCollection in sidebar
  {
    const sbBtns=await page.$$('button[title="Click to preview · Double-click to copy name"]');
    let gcBtn=null;
    for(const b of sbBtns){
      const txt=await b.evaluate(el=>el.textContent?.trim()||'');
      if(txt.startsWith('GarbageCollection')){gcBtn=b;break;}
    }
    if(gcBtn){
      await gcBtn.click();await page.waitForTimeout(600);
      const prev=await page.$('[data-testid="preview-editor"]');
      if(prev) pass('Schema explorer: GarbageCollection preview appeared');
      else warn('Schema explorer: preview not found after click');
    } else warn(`Schema explorer: GarbageCollection not found (${sbBtns.length} items)`);
  }

  // Command palette
  await page.keyboard.press('Meta+k');await page.waitForTimeout(500);
  {
    const pal=await page.$('[role="dialog"] input,[class*="palette"] input,[class*="command"] input');
    if(pal){
      await pal.type('run');await page.waitForTimeout(200);
      pass('Command palette: Cmd+K opened');
      await page.keyboard.press('Escape');await page.waitForTimeout(200);
    } else {
      warn('Command palette: dialog not found after Cmd+K');
      await page.keyboard.press('Escape').catch(()=>{});
    }
  }

  // SQL autocomplete — add fresh cell, type trigger text, check popup
  {
    const addBtn=await page.$('[title="Add SQL cell"],[aria-label="Add SQL cell"]');
    let addedCell=false;
    if(addBtn){await addBtn.click();await page.waitForTimeout(400);addedCell=true;}
    const eds=await page.$$('.cm-editor .cm-content');
    const ed=eds[eds.length-1];
    if(ed){
      await ed.click();await page.waitForTimeout(100);
      await page.keyboard.press('Meta+a');await page.waitForTimeout(50);
      await page.keyboard.type('SELECT * FROM Gar');await page.waitForTimeout(300);
      await page.keyboard.press('Control+Space');await page.waitForTimeout(1000);
      const ac=await page.$('.cm-tooltip-autocomplete');
      if(ac){
        const items=await page.evaluate(()=>
          Array.from(document.querySelectorAll('.cm-completionLabel'))
            .map(e=>e.textContent?.trim()).filter(Boolean).slice(0,3)
        );
        pass(`SQL autocomplete: completions: ${items.join(', ')}`);
      } else fail('SQL autocomplete','no tooltip appeared');
      await page.keyboard.press('Escape');await page.waitForTimeout(100);
      if(addedCell){
        const delBtns=await page.$$('[aria-label="Delete Cell"],[title="Delete Cell"],[aria-label="Delete cell"]');
        const d=delBtns[delBtns.length-1];if(d)await d.click().catch(()=>{});
      }
    } else warn('SQL autocomplete: no editor found');
  }

  // Help modal
  {
    const hBtn=await page.$('[aria-label="Keyboard Shortcuts"],[title*="Keyboard Shortcuts"]');
    if(hBtn){
      await hBtn.click();await page.waitForTimeout(500);
      const dlg=await page.$('[role="dialog"]');
      if(dlg){
        const hasCont=await dlg.$('table,kbd,[class*="shortcut"],code');
        if(hasCont) pass('Help modal: shortcut content visible');
        else warn('Help modal: dialog opened but no shortcut content');
      } else warn('Help modal: no dialog after click');
      await page.keyboard.press('Escape');await page.waitForTimeout(200);
    } else warn('Help modal: button not found');
  }

  // LINK_X zoom — dispatch WheelEvent on div.group after scrollIntoView
  console.log('\n══ LINK_X ZOOM ══');
  await loadTpl(page,'GC Pause Analysis');
  {
    const zoomed=await page.evaluate(()=>{
      const groups=Array.from(document.querySelectorAll('div.group'));
      const plotGroups=groups.filter(g=>
        g.querySelector('.recharts-surface')&&g.querySelector('.recharts-wrapper')
      );
      const big=plotGroups.find(g=>g.getBoundingClientRect().width>300);
      if(!big)return false;
      big.scrollIntoView({behavior:'instant',block:'center'});
      const r=big.getBoundingClientRect();
      big.dispatchEvent(new WheelEvent('wheel',{
        bubbles:true,cancelable:true,deltaY:-300,deltaMode:0,
        clientX:r.x+r.width/2,clientY:r.y+r.height/2,shiftKey:true,
      }));
      return true;
    });
    await page.waitForTimeout(800);
    if(zoomed){
      const rst=await page.$('[aria-label="Reset zoom"]');
      if(rst) pass('LINK_X zoom: Reset button appeared after Shift+scroll');
      else warn('LINK_X zoom: Reset button not found');
    } else warn('LINK_X zoom: no plot group found');
    e=await scan(page);
    if(e.length===0) pass('GC Pause Analysis: 0 DOM errors'); else fail('GC Pause Analysis',e.join(' | '));
  }

  // ── CPU PROFILING ──
  console.log('\n══ CPU PROFILING ══');
  {
    const ok=await loadTpl(page,'CPU Profiling');
    if(ok){
      const c=await page.evaluate(()=>document.querySelectorAll('[data-cell-status]').length);
      const s=await page.evaluate(()=>document.querySelectorAll('svg').length);
      e=await scan(page);
      if(e.length===0) pass(`CPU Profiling: ${c} cells, ${s} SVGs, 0 errors`);
      else fail('CPU Profiling',e.join(' | '));
      await scroll(page);e=await scan(page);
      if(e.length===0) pass('CPU Profiling: scroll 0 errors');
      else fail('CPU Profiling scroll',e.join(' | '));
    } else fail('CPU Profiling','did not idle');
  }

  // ── JVM INTERNALS ──
  console.log('\n══ JVM INTERNALS ══');
  {
    const ok=await loadTpl(page,'JVM Internals');
    if(ok){
      const c=await page.evaluate(()=>document.querySelectorAll('[data-cell-status]').length);
      const s=await page.evaluate(()=>document.querySelectorAll('svg').length);
      e=await scan(page);
      if(e.length===0) pass(`JVM Internals: ${c} cells, ${s} SVGs, 0 errors`);
      else fail('JVM Internals',e.join(' | '));
      await scroll(page);e=await scan(page);
      if(e.length===0) pass('JVM Internals: scroll 0 errors');
      else fail('JVM Internals scroll',e.join(' | '));
    } else fail('JVM Internals','did not idle');
  }

  // ── CONSOLE ──
  console.log('\n══ CONSOLE ══');
  if(cerrs.length===0) pass('Console: 0 real errors');
  else{cerrs.forEach(c=>console.log(`  [console error] ${c}`));fail('Console',cerrs.length+' errors');}

  // ── UI POLISH ──
  console.log('\n══ UI POLISH ══');
  {
    // Check for zero-height cells
    const zeroH=await page.evaluate(()=>
      Array.from(document.querySelectorAll('[data-cell-status]'))
        .filter(el=>el.offsetParent!==null&&el.getBoundingClientRect().height<5)
        .length
    );
    if(zeroH===0) pass('UI: no zero-height cells');
    else warn(`UI: ${zeroH} zero-height cells`);

    // Check for overflow (horizontal scrollbar on main content)
    const overflowX=await page.evaluate(()=>{
      const main=document.querySelector('main,[role="main"],.notebook-content')||document.body;
      return main.scrollWidth>main.clientWidth+5;
    });
    if(!overflowX) pass('UI: no horizontal overflow');
    else warn('UI: horizontal overflow detected');
  }

  await ctx.close();await browser.close();

  console.log(`\nPASS:${P.length} WARN:${W.length} FAIL:${F.length}`);
  if(F.length===0){
    console.log('No failures ✅');
    W.forEach(w=>console.log(`  ⚠  ${w}`));
  } else {
    F.forEach(f=>console.log(`  ❌ ${f.l}: ${f.d}`));
    process.exit(1);
  }
})();
