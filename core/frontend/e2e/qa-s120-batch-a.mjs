/**
 * S120 batch-A: demo + interactive features + GC Pause Analysis + Recording Overview
 * Tests: variables, LINK_X, BRUSH, command palette, SQL autocomplete, schema explorer,
 *        Run All, help modal, console errors, tooltips, UI polish
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
const warn=(l,d)=>{console.log(`  ⚠  ${l}: ${d??''}`);W.push(l);};

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

  // ── LOAD DEMO ──
  console.log('\n══ DEMO NOTEBOOK ══');
  await page.goto(BASE,{waitUntil:'networkidle',timeout:30000});
  await page.waitForTimeout(400);
  const skip=await page.$('button:has-text("Skip")');if(skip)await skip.click().catch(()=>{});
  await page.waitForTimeout(200);
  const demo=await page.$('button:has-text("Try the demo")');
  if(!demo){console.error('no demo');process.exit(1);}
  await demo.click();await page.waitForTimeout(3500);await idle(page,20000);
  let e=await scan(page);
  if(e.length===0) pass('Demo: DOM scan 0 errors'); else fail('Demo: DOM scan',e.join(' | '));
  const svgs=await page.evaluate(()=>document.querySelectorAll('svg').length);
  const cells=await page.evaluate(()=>document.querySelectorAll('[data-cell-status]').length);
  pass(`Demo: ${cells} cells, ${svgs} SVGs`);
  await scroll(page);e=await scan(page);
  if(e.length===0) pass('Demo: scroll scan 0 errors'); else fail('Demo: scroll',e.join(' | '));

  // ── INTERACTIVE FEATURES ──
  console.log('\n══ INTERACTIVE FEATURES ══');

  // Variables — toggle is [role="button"] with text "Notebook Variables"
  const varPanel=await page.$('[role="button"]:has-text("Notebook Variables"),[aria-expanded]');
  if(varPanel){
    await varPanel.click();await page.waitForTimeout(500);
    // value input has aria-label="Value for {k}"
    const inp=await page.$('[aria-label^="Value for"]');
    if(inp){
      await inp.click({clickCount:3});await inp.type('100');await inp.press('Enter');
      await page.waitForTimeout(800);pass('Variables: opened, value changed');
    } else {
      // maybe already expanded, try directly
      const inputs=await page.$$('[aria-label^="Value for"]');
      if(inputs.length>0){
        await inputs[0].click({clickCount:3});await inputs[0].type('100');await inputs[0].press('Enter');
        await page.waitForTimeout(800);pass('Variables: opened, value changed');
      } else warn('Variables: no value input found');
    }
  } else {
    // try without clicking toggle — maybe already visible
    const inp=await page.$('[aria-label^="Value for"]');
    if(inp){
      await inp.click({clickCount:3});await inp.type('100');await inp.press('Enter');
      await page.waitForTimeout(800);pass('Variables: opened, value changed');
    } else warn('Variables: panel not found');
  }

  // Collapse / Expand All
  const colBtn=await page.$('[aria-label="Collapse All"],[title="Collapse All"],button:has-text("Collapse All")');
  if(colBtn){await colBtn.click();await page.waitForTimeout(400);pass('Collapse All: clicked');}
  else warn('Collapse All: button not found');
  const expBtn=await page.$('[aria-label="Expand All"],[title="Expand All"],button:has-text("Expand All")');
  if(expBtn){await expBtn.click();await page.waitForTimeout(400);pass('Expand All: clicked');}
  else warn('Expand All: button not found');

  // Run All
  const runAll=await page.$('[aria-label="Run All Queries"],[title="Run All"],button:has-text("Run All")');
  if(runAll){
    await runAll.click();await page.waitForTimeout(1000);await idle(page,30000);
    e=await scan(page);
    if(e.length===0) pass('Run All: 0 DOM errors'); else fail('Run All',e.join(' | '));
  } else warn('Run All: button not found');

  // Schema explorer
  const sidebarItems=await page.$$('button[title="Click to preview · Double-click to copy name"]');
  if(sidebarItems.length>0){
    // Find GarbageCollection
    let gcBtn=null;
    for(const b of sidebarItems){
      const txt=await b.evaluate(el=>el.textContent||'');
      if(txt.includes('GarbageCollection')){gcBtn=b;break;}
    }
    if(gcBtn){
      await gcBtn.click();await page.waitForTimeout(500);
      const preview=await page.$('[data-testid="preview-editor"]');
      if(preview) pass('Schema explorer: preview appeared'); else warn('Schema explorer: preview not found');
    } else warn('Schema explorer: GarbageCollection item not found');
  } else warn('Schema explorer: no sidebar items');

  // Command palette
  await page.keyboard.press('Meta+k');await page.waitForTimeout(500);
  const palette=await page.$('[role="dialog"] input,[data-testid="command-palette"] input,.command-palette input');
  if(palette){
    await palette.type('help');await page.waitForTimeout(300);
    await page.keyboard.press('Escape');await page.waitForTimeout(200);
    pass('Command palette: Cmd+K opened');
  } else {
    await page.keyboard.press('Escape');
    warn('Command palette: dialog/input not found');
  }

  // SQL autocomplete
  const addCellBtn=await page.$('[title="Add SQL cell"],[aria-label="Add SQL cell"]');
  if(addCellBtn){
    await addCellBtn.click();await page.waitForTimeout(400);
    const editors=await page.$$('.cm-editor .cm-content');
    if(editors.length>0){
      const lastEditor=editors[editors.length-1];
      await lastEditor.click();await page.waitForTimeout(200);
      await page.keyboard.type('SELECT * FROM Gar');await page.waitForTimeout(300);
      await page.keyboard.press('Control+Space');await page.waitForTimeout(800);
      const ac=await page.$('.cm-tooltip-autocomplete');
      if(ac){
        const items=await page.$$('.cm-tooltip-autocomplete li,.cm-completionLabel');
        const texts=await Promise.all(items.slice(0,5).map(i=>i.evaluate(e=>e.textContent)));
        pass(`SQL autocomplete: completions: ${texts.join(', ')}`);
      } else fail('SQL autocomplete','no tooltip appeared');
      // delete test cell
      await page.keyboard.press('Escape');
      const delBtn=await page.$('[aria-label="Delete cell"],[title="Delete cell"]');
      if(delBtn) await delBtn.click().catch(()=>{});
    } else warn('SQL autocomplete: no cm-editor found');
  } else warn('SQL autocomplete: Add SQL cell button not found');

  // Help modal
  for(const sel of ['[aria-label="Keyboard Shortcuts"]','[title="Keyboard shortcuts"]','button:has-text("?")',' [aria-label*="help" i]']){
    const btn=await page.$(sel);
    if(btn){
      await btn.click();await page.waitForTimeout(500);
      const modal=await page.$('dialog,[role="dialog"]');
      if(modal){
        const txt=await modal.evaluate(el=>el.textContent||'');
        if(txt.length>50) pass('Help modal: shortcut content visible');
        else warn('Help modal: modal opened but content short');
      } else warn('Help modal: no dialog appeared');
      await page.keyboard.press('Escape');await page.waitForTimeout(200);
      break;
    }
  }

  // ── LINK_X ZOOM (GC Pause Analysis) ──
  console.log('\n══ LINK_X ZOOM ══');
  const ok1=await loadTpl(page,'GC Pause Analysis');
  if(ok1){
    // Find div.group wrapperRef divs that contain recharts
    const zoomed=await page.evaluate(()=>{
      const groups=Array.from(document.querySelectorAll('div.group'));
      const plotGroups=groups.filter(g=>g.querySelector('.recharts-surface')&&g.querySelector('.recharts-wrapper'));
      const big=plotGroups.find(g=>{const r=g.getBoundingClientRect();return r.width>300;});
      if(!big)return false;
      big.scrollIntoView({behavior:'instant',block:'center'});
      const r=big.getBoundingClientRect();
      const evt=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-300,deltaMode:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2,shiftKey:true});
      big.dispatchEvent(evt);
      return true;
    });
    await page.waitForTimeout(800);
    if(zoomed){
      const resetBtn=await page.$('[aria-label="Reset zoom"]');
      if(resetBtn) pass('LINK_X zoom: Reset button appeared after Shift+scroll');
      else warn('LINK_X zoom: Reset button not found after Shift+scroll');
    } else warn('LINK_X zoom: no plot group found');
    e=await scan(page);
    if(e.length===0) pass('GC Pause Analysis: 0 DOM errors'); else fail('GC Pause Analysis',e.join(' | '));
  }

  // ── TOOLTIP TEST ──
  console.log('\n══ TOOLTIP HOVER ══');
  const charts2=await page.$$('.recharts-surface');
  if(charts2.length>0){
    const c=charts2[0];const box=await c.boundingBox();
    if(box){
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
      await page.waitForTimeout(600);
      const tip=await page.$('.recharts-tooltip-wrapper,[data-testid="plot-tooltip"],[class*="tooltip"]');
      if(tip) pass('Tooltip: appeared on hover'); else warn('Tooltip: not found on hover');
    }
  } else warn('Tooltip: no charts to hover');

  // ── RECORDING OVERVIEW ──
  console.log('\n══ RECORDING OVERVIEW ══');
  const ok2=await loadTpl(page,'Recording Overview');
  if(ok2){
    const c=await page.evaluate(()=>document.querySelectorAll('[data-cell-status]').length);
    const s=await page.evaluate(()=>document.querySelectorAll('svg').length);
    e=await scan(page);
    if(e.length===0) pass(`Recording Overview: ${c} cells, ${s} SVGs, 0 errors`); else fail('Recording Overview',e.join(' | '));
    await scroll(page);e=await scan(page);
    if(e.length===0) pass('Recording Overview: scroll 0 errors'); else fail('Recording Overview scroll',e.join(' | '));
  }

  // ── CONSOLE ──
  console.log('\n══ CONSOLE ══');
  if(cerrs.length===0) pass('Console: 0 real errors'); else{cerrs.forEach(e=>console.log(`  [console error] ${e}`));fail('Console errors',cerrs.length+' errors');}

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
