/**
 * S141 QA: demo + full interactive suite + Recording Overview + Exceptions & Errors
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
  for(const s of['[title="New from template"]','[aria-label="New from template"]']){btn=await page.$(s);if(btn)break;}
  if(!btn){fail(name,'gallery btn not found');return false;}
  await btn.click();await page.waitForSelector('dialog,[role="dialog"]',{timeout:6000});
  await page.waitForTimeout(600);
  const t=await page.$(`button[aria-label="Select template: ${name}"]`)||await page.$(`button:has-text("${name}")`);
  if(!t){fail(name,'not in gallery');await page.keyboard.press('Escape');return false;}
  await t.click();await page.waitForTimeout(300);
  for(const s of['button:has-text("Open & Run")','button:has-text("Use template")']){
    const b=await page.$(s);if(b&&!await b.getAttribute('disabled')){await b.click();break;}
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

  // ── DEMO ──
  console.log('\n══ DEMO NOTEBOOK ══');
  await page.goto(BASE,{waitUntil:'networkidle',timeout:30000});
  await page.waitForTimeout(400);
  const skip=await page.$('button:has-text("Skip")');if(skip)await skip.click().catch(()=>{});
  await page.waitForTimeout(200);
  const demo=await page.$('button:has-text("Try the demo")');
  if(!demo){console.error('no demo button');process.exit(1);}
  await demo.click();await page.waitForTimeout(3500);await idle(page,20000);
  let e=await scan(page);
  if(e.length===0)pass('Demo: DOM scan 0 errors');else fail('Demo: DOM scan',e.join(' | '));
  const svgs=await page.evaluate(()=>document.querySelectorAll('svg').length);
  const cells=await page.evaluate(()=>document.querySelectorAll('[data-cell-status]').length);
  pass(`Demo: ${cells} cells, ${svgs} SVGs`);
  await scroll(page);e=await scan(page);
  if(e.length===0)pass('Demo: scroll 0 errors');else fail('Demo scroll',e.join(' | '));

  // ── INTERACTIVE ──
  console.log('\n══ INTERACTIVE FEATURES ══');
  await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(200);

  // Variables
  {
    let inp=await page.$('[aria-label^="Value for"]');
    if(!inp){
      const tog=await page.$('[role="button"]:has-text("Notebook Variables")');
      if(tog){await tog.click();await page.waitForTimeout(400);}
      inp=await page.$('[aria-label^="Value for"]');
    }
    if(inp){
      const orig=await inp.evaluate(el=>el.value);
      await inp.click({clickCount:3});await inp.type('50');await inp.press('Enter');
      await page.waitForTimeout(800);pass('Variables: opened, value changed');
      await inp.click({clickCount:3});await inp.type(orig||'');await inp.press('Enter');
      await page.waitForTimeout(400);
    } else warn('Variables: no value input found');
  }

  // Collapse/Expand All
  for(const aria of['Collapse All','Expand All']){
    const b=await page.$(`[aria-label="${aria}"],[title="${aria}"]`);
    if(b){await b.click();await page.waitForTimeout(400);pass(`${aria}: clicked`);}
    else warn(`${aria}: not found`);
  }

  // Run All
  {
    const b=await page.$('[aria-label="Run All Queries"],[title="Run All Queries"]');
    if(b){
      await b.click();await page.waitForTimeout(1000);await idle(page,30000);
      e=await scan(page);
      if(e.length===0)pass('Run All: 0 DOM errors');else fail('Run All',e.join(' | '));
    } else warn('Run All: not found');
  }

  // Schema explorer
  {
    const btns=await page.$$('button[title="Click to preview · Double-click to copy name"]');
    let gcBtn=null;
    for(const b of btns){
      const txt=await b.evaluate(el=>el.textContent?.trim()||'');
      if(txt.startsWith('GarbageCollection')){gcBtn=b;break;}
    }
    if(gcBtn){
      await gcBtn.click();await page.waitForTimeout(700);
      const prev=await page.$('[data-testid="preview-editor"]');
      if(prev)pass('Schema explorer: GarbageCollection preview appeared');
      else warn('Schema explorer: preview not found');
    } else warn(`Schema explorer: GarbageCollection not found (${btns.length} items)`);
  }

  // Command palette
  await page.keyboard.press('Meta+k');await page.waitForTimeout(500);
  {
    const pal=await page.$('[role="dialog"] input,[class*="palette"] input,[class*="command"] input');
    if(pal){
      await pal.type('run');await page.waitForTimeout(200);
      pass('Command palette: Cmd+K opened');
      await page.keyboard.press('Escape');await page.waitForTimeout(200);
    } else{
      warn('Command palette: dialog not found');
      await page.keyboard.press('Escape').catch(()=>{});
    }
  }

  // SQL autocomplete
  {
    const addBtn=await page.$('[title="Add SQL cell"],[aria-label="Add SQL cell"]');
    let added=false;
    if(addBtn){await addBtn.click();await page.waitForTimeout(400);added=true;}
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
            .map(e=>e.textContent?.trim()).filter(Boolean).slice(0,3));
        pass(`SQL autocomplete: completions: ${items.join(', ')}`);
      } else fail('SQL autocomplete','no tooltip');
      await page.keyboard.press('Escape');await page.waitForTimeout(100);
      if(added){
        const del=await page.$$('[aria-label="Delete Cell"],[title="Delete Cell"],[aria-label="Delete cell"]');
        if(del.length>0)await del[del.length-1].click().catch(()=>{});
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
        const ok=await dlg.$('table,kbd,[class*="shortcut"],code');
        if(ok)pass('Help modal: shortcut content visible');
        else warn('Help modal: opened but no shortcut content');
      } else warn('Help modal: no dialog');
      await page.keyboard.press('Escape');await page.waitForTimeout(200);
    } else warn('Help modal: button not found');
  }

  // ── LINK_X ZOOM ──
  console.log('\n══ LINK_X ZOOM ══');
  await loadTpl(page,'GC Pause Analysis');
  {
    const zoomed=await page.evaluate(()=>{
      const g=Array.from(document.querySelectorAll('div.group'))
        .filter(g=>g.querySelector('.recharts-surface')&&g.querySelector('.recharts-wrapper'))
        .find(g=>g.getBoundingClientRect().width>300);
      if(!g)return false;
      g.scrollIntoView({behavior:'instant',block:'center'});
      const r=g.getBoundingClientRect();
      g.dispatchEvent(new WheelEvent('wheel',{
        bubbles:true,cancelable:true,deltaY:-300,deltaMode:0,
        clientX:r.x+r.width/2,clientY:r.y+r.height/2,shiftKey:true,
      }));
      return true;
    });
    await page.waitForTimeout(800);
    if(zoomed){
      const rst=await page.$('[aria-label="Reset zoom"]');
      if(rst)pass('LINK_X zoom: Reset button appeared');
      else warn('LINK_X zoom: Reset button not found');
    } else warn('LINK_X zoom: no plot group found');
    e=await scan(page);
    if(e.length===0)pass('GC Pause Analysis: 0 DOM errors');
    else fail('GC Pause Analysis',e.join(' | '));
  }

  // ── RECORDING OVERVIEW ──
  console.log('\n══ RECORDING OVERVIEW ══');
  {
    const ok=await loadTpl(page,'Recording Overview');
    if(ok){
      const c=await page.evaluate(()=>document.querySelectorAll('[data-cell-status]').length);
      const s=await page.evaluate(()=>document.querySelectorAll('svg').length);
      e=await scan(page);
      if(e.length===0)pass(`Recording Overview: ${c} cells, ${s} SVGs, 0 errors`);
      else fail('Recording Overview',e.join(' | '));
      await scroll(page);e=await scan(page);
      if(e.length===0)pass('Recording Overview: scroll 0 errors');
      else fail('Recording Overview scroll',e.join(' | '));
    } else fail('Recording Overview','did not idle');
  }

  // ── EXCEPTIONS & ERRORS ──
  console.log('\n══ EXCEPTIONS & ERRORS ══');
  {
    const ok=await loadTpl(page,'Exceptions & Errors');
    if(ok){
      const c=await page.evaluate(()=>document.querySelectorAll('[data-cell-status]').length);
      const s=await page.evaluate(()=>document.querySelectorAll('svg').length);
      e=await scan(page);
      if(e.length===0)pass(`Exceptions & Errors: ${c} cells, ${s} SVGs, 0 errors`);
      else fail('Exceptions & Errors',e.join(' | '));
      await scroll(page);e=await scan(page);
      if(e.length===0)pass('Exceptions & Errors: scroll 0 errors');
      else fail('Exceptions & Errors scroll',e.join(' | '));
    } else fail('Exceptions & Errors','did not idle');
  }

  // ── CONSOLE ──
  console.log('\n══ CONSOLE ══');
  if(cerrs.length===0)pass('Console: 0 real errors');
  else{
    cerrs.forEach(c=>console.log(`  [console error] ${c}`));
    fail('Console errors',`${cerrs.length} error(s): ${cerrs[0]}`);
  }

  await ctx.close();await browser.close();

  console.log(`\nPASS:${P.length} WARN:${W.length} FAIL:${F.length}`);
  if(F.length===0){
    console.log('No failures ✅');
    W.forEach(w=>console.log(`  ⚠  ${w}`));
  } else{
    F.forEach(f=>console.log(`  ❌ ${f.l}: ${f.d}`));
    process.exit(1);
  }
})();
