/**
 * S119 batch-A: Demo notebook + interactive features + JVM Internals + Container & Cloud
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

const P = [], F = [], W = [];
const pass = l => { console.log(`  ✅ ${l}`); P.push(l); };
const fail = (l,d) => { console.log(`  ❌ ${l}: ${d}`); F.push({l,d}); };
const warn = (l,d) => { console.log(`  ⚠  ${l}: ${d}`); W.push({l,d}); };

async function idle(page, ms=60000) {
  const t = Date.now();
  while (Date.now()-t < ms) {
    const n = await page.evaluate(() =>
      document.querySelectorAll('[data-cell-status="running"]').length +
      Array.from(document.querySelectorAll('*')).filter(e=>e.textContent?.trim()==='Running...'&&e.offsetParent!==null).length
    );
    if (n===0) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

async function scan(page) {
  return page.evaluate(terms =>
    Array.from(document.querySelectorAll('*')).filter(el => {
      const t = el.textContent||'';
      return terms.some(x=>t.includes(x)) && el.children.length===0 && el.offsetParent!==null
        && !el.closest('.cm-editor') && !el.closest('[class*="token"]');
    }).map(e=>e.textContent.trim().slice(0,120))
  , ERR);
}

async function scroll(page) {
  await page.evaluate(async () => {
    for (let y=0; y<document.body.scrollHeight; y+=window.innerHeight) {
      window.scrollTo(0,y); await new Promise(r=>setTimeout(r,80));
    }
    window.scrollTo(0,0);
  });
}

async function loadTpl(page, name) {
  let btn=null;
  for (const s of ['[title="New from template"]','[aria-label="New from template"]']) { btn=await page.$(s); if(btn) break; }
  if (!btn) { fail(name,'gallery btn not found'); return false; }
  await btn.click();
  await page.waitForSelector('dialog,[role="dialog"]',{timeout:6000});
  await page.waitForTimeout(600);
  const t = await page.$(`button[aria-label="Select template: ${name}"]`) || await page.$(`button:has-text("${name}")`);
  if (!t) { fail(name,'not in gallery'); await page.keyboard.press('Escape'); return false; }
  await t.click(); await page.waitForTimeout(300);
  for (const s of ['button:has-text("Open & Run")','button:has-text("Use template")']) {
    const b=await page.$(s); if(b && !await b.getAttribute('disabled')) { await b.click(); break; }
  }
  await page.waitForTimeout(1500);
  return idle(page,60000);
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  const ctx = await browser.newContext({viewport:{width:1440,height:900},storageState:{cookies:[],origins:[{origin:BASE,localStorage:LS}]}});
  ctx.on('dialog',d=>d.accept());
  const page = await ctx.newPage();
  const cerrs=[];
  page.on('console',msg=>{
    if(msg.type()==='error'){
      const t=msg.text();
      if(!t.includes('ONNX')&&!t.includes('ort-')&&!t.includes('/api/')&&!t.includes('proxy')
         &&!t.includes('Failed to load resource')&&!t.includes('net::ERR_')&&!t.includes('conditional view failed'))
        cerrs.push(t.slice(0,200));
    }
  });

  await page.goto(BASE,{waitUntil:'networkidle',timeout:30000});
  await page.waitForTimeout(400);
  const skip=await page.$('button:has-text("Skip")'); if(skip) await skip.click().catch(()=>{});
  await page.waitForTimeout(200);
  const demo=await page.$('button:has-text("Try the demo")');
  if(!demo){console.error('no demo btn');process.exit(1);}
  await demo.click(); await page.waitForTimeout(3500); await idle(page,30000);

  // ── DEMO ──
  console.log('\n══ DEMO NOTEBOOK ══');
  let e=await scan(page);
  if(e.length===0) pass('Demo: DOM scan 0 errors'); else fail('Demo DOM',e.join(' | '));
  const nc=await page.evaluate(()=>document.querySelectorAll('[data-cell-status]').length);
  const ns=await page.evaluate(()=>document.querySelectorAll('svg').length);
  pass(`Demo: ${nc} cells, ${ns} SVGs`);
  await scroll(page); e=await scan(page);
  if(e.length===0) pass('Demo: scroll scan 0 errors'); else fail('Demo scroll',e.join(' | '));

  // ── INTERACTIVE ──
  console.log('\n══ INTERACTIVE FEATURES ══');
  await page.evaluate(()=>window.scrollTo(0,0)); await page.waitForTimeout(200);

  // Variables
  const vBtn = await page.$('[data-testid="variables-pill"]') || await page.$('button[aria-label*="variable" i]');
  if(vBtn){
    await vBtn.click(); await page.waitForTimeout(400);
    const inp=await page.$('input[type="text"],input[type="number"]');
    if(inp){ await inp.click({clickCount:3}); await inp.type('50'); await inp.press('Enter'); await page.waitForTimeout(800); pass('Variables: opened, value changed'); }
    else warn('Variables','no input found');
  } else warn('Variables','no pill found');

  // Collapse/Expand All
  const colBtn=await page.$('[aria-label="Collapse All"]')||await page.$('button:has-text("Collapse All")');
  if(colBtn){ await colBtn.click(); await page.waitForTimeout(400); pass('Collapse All: clicked');
    const expBtn=await page.$('[aria-label="Expand All"]')||await page.$('button:has-text("Expand All")');
    if(expBtn){ await expBtn.click(); await page.waitForTimeout(400); pass('Expand All: clicked'); }
  } else warn('Collapse All','button not found');

  // Run All
  const raBtn=await page.$('[aria-label="Run All Queries"]');
  if(raBtn){
    await raBtn.click(); await page.waitForTimeout(1000); await idle(page,40000);
    e=await scan(page);
    if(e.length===0) pass('Run All: 0 DOM errors'); else fail('Run All',e.join(' | '));
  } else warn('Run All','button not found');

  // Schema explorer
  const sbBtns=await page.$$('button[title="Click to preview · Double-click to copy name"]');
  let tBtn=null;
  for(const b of sbBtns){const t=await b.evaluate(e=>e.textContent?.trim()||''); if(t.startsWith('GarbageCollection')){tBtn=b;break;}}
  if(!tBtn&&sbBtns.length>0){
    for(const b of sbBtns){const t=await b.evaluate(e=>e.textContent?.trim()||''); if(/^[A-Z]/.test(t)&&!/^P\d/.test(t)){tBtn=b;break;}}
  }
  if(tBtn){
    const tn=await tBtn.evaluate(b=>b.textContent?.trim().replace(/\d+$/,'')||'');
    await tBtn.click(); await page.waitForTimeout(500);
    const prev=await page.$('[data-testid="preview-editor"]');
    if(prev){ const sql=await prev.evaluate(e=>e.textContent?.trim().slice(0,60)); pass(`Schema explorer: "${tn}" → ${sql}`); }
    else warn('Schema explorer','no preview after click');
  } else warn('Schema explorer','no sidebar items');

  // Command palette
  await page.keyboard.press('Meta+k'); await page.waitForTimeout(400);
  const pal=await page.$('[role="dialog"] input,[class*="palette"] input,[class*="command"] input');
  if(pal){ await pal.type('run'); await page.waitForTimeout(200); pass('Command palette: Cmd+K opened'); await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  else { warn('Command palette','no input after Cmd+K'); await page.keyboard.press('Escape').catch(()=>{}); }

  // SQL autocomplete
  const addBtn=await page.$('[title="Add SQL cell"]');
  let addedCell=false;
  if(addBtn){await addBtn.click(); await page.waitForTimeout(400); addedCell=true;}
  const eds=await page.$$('.cm-editor .cm-content');
  const ed=eds[eds.length-1];
  if(ed){
    await ed.click(); await page.waitForTimeout(100);
    await page.keyboard.press('Meta+a'); await page.waitForTimeout(50);
    await page.keyboard.type('SELECT * FROM Gar'); await page.waitForTimeout(300);
    await page.keyboard.press('Control+Space'); await page.waitForTimeout(1000);
    const pop=await page.$('.cm-tooltip-autocomplete');
    if(pop){
      const items=await page.evaluate(()=>Array.from(document.querySelectorAll('.cm-completionLabel')).map(e=>e.textContent?.trim()).filter(Boolean).slice(0,3));
      pass(`SQL autocomplete: completions: ${items.join(', ')}`);
    } else warn('SQL autocomplete','no popup');
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    if(addedCell){const ds=await page.$$('[aria-label="Delete Cell"],[title="Delete Cell"]');const d=ds[ds.length-1];if(d){await d.click();await page.waitForTimeout(200);}}
  } else warn('SQL autocomplete','no editor');

  // Help modal
  const hBtn=await page.$('[aria-label="Keyboard Shortcuts"]')||await page.$('[title*="Keyboard Shortcuts"]');
  if(hBtn){
    await hBtn.click(); await page.waitForTimeout(400);
    const dlg=await page.$('[role="dialog"]');
    if(dlg&&await dlg.$('table,kbd,[class*="shortcut"]')) pass('Help modal: shortcut content visible');
    else warn('Help modal','no shortcut content');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  } else warn('Help modal','button not found');

  // ── JVM INTERNALS ──
  console.log('\n══ JVM INTERNALS ══');
  const jvmOk=await loadTpl(page,'JVM Internals');
  if(jvmOk){
    const c=await page.evaluate(()=>document.querySelectorAll('[data-cell-status]').length);
    const s=await page.evaluate(()=>document.querySelectorAll('svg').length);
    e=await scan(page);
    if(e.length===0) pass(`JVM Internals: ${c} cells, ${s} SVGs, 0 errors`); else fail('JVM Internals',e.join(' | '));
    await scroll(page); e=await scan(page);
    if(e.length===0) pass('JVM Internals: scroll 0 errors'); else fail('JVM Internals scroll',e.join(' | '));
  } else fail('JVM Internals','did not idle');

  // ── CONTAINER & CLOUD ──
  console.log('\n══ CONTAINER & CLOUD ══');
  const ccOk=await loadTpl(page,'Container & Cloud');
  if(ccOk){
    const c=await page.evaluate(()=>document.querySelectorAll('[data-cell-status]').length);
    const s=await page.evaluate(()=>document.querySelectorAll('svg').length);
    e=await scan(page);
    if(e.length===0) pass(`Container & Cloud: ${c} cells, ${s} SVGs, 0 errors`); else fail('Container & Cloud',e.join(' | '));
    await scroll(page); e=await scan(page);
    if(e.length===0) pass('Container & Cloud: scroll 0 errors'); else fail('Container & Cloud scroll',e.join(' | '));
  } else fail('Container & Cloud','did not idle');

  // ── LINK_X ZOOM ──
  console.log('\n══ LINK_X ZOOM ══');
  const gcOk=await loadTpl(page,'GC Pause Analysis');
  if(gcOk){
    await page.evaluate(()=>window.scrollTo(0,0)); await page.waitForTimeout(300);
    const ch=await page.$('.recharts-surface');
    if(ch){
      const bx=await ch.boundingBox();
      if(bx){
        await page.mouse.move(bx.x+bx.width/2, bx.y+bx.height/2);
        await page.keyboard.down('Shift'); await page.mouse.wheel(0,-300); await page.keyboard.up('Shift');
        await page.waitForTimeout(700);
        const rst=await page.$('button:has-text("Reset")')||await page.$('button[aria-label*="Reset" i]');
        if(rst) pass('LINK_X zoom: Reset button appeared after Shift+scroll');
        else warn('LINK_X zoom','no Reset button appeared');
      }
    } else warn('LINK_X zoom','no recharts surface');
    e=await scan(page);
    if(e.length===0) pass('GC Pause Analysis: 0 DOM errors'); else fail('GC Pause Analysis',e.join(' | '));
  } else warn('LINK_X zoom','GC Pause Analysis did not load');

  // console
  console.log('\n══ CONSOLE ══');
  if(cerrs.length===0) pass('Console: 0 real errors'); else cerrs.forEach(e=>fail('Console error',e));

  await ctx.close(); await browser.close();
  console.log(`\nPASS:${P.length} WARN:${W.length} FAIL:${F.length}`);
  if(F.length===0){console.log('No failures ✅');W.forEach(w=>console.log(`  ⚠  ${w.l}: ${w.d}`));}
  else{F.forEach(f=>console.log(`  ❌ ${f.l}: ${f.d}`));W.forEach(w=>console.log(`  ⚠  ${w.l}: ${w.d}`));process.exit(1);}
})();
