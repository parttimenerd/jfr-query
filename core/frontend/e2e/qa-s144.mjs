/**
 * S144 QA pass: Recording Overview + CPU Profiling + interactive features
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';
const LS = [
  {name:'jfr-tour-seen',value:'1'},
  {name:'jfrq:onboarding-dismissed',value:'1'},
  {name:'jfrq:ai-nudge-dismissed',value:'1'},
  {name:'jfr-sidebar-editor-visible',value:'true'},
];

async function idle(page, ms=90000) {
  const t=Date.now();
  while(Date.now()-t<ms){
    const n=await page.evaluate(()=>document.querySelectorAll('[data-cell-status="running"]').length);
    if(n===0)return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function domScan(page) {
  return page.evaluate(()=>
    Array.from(document.querySelectorAll('*')).filter(el => {
      const text = el.textContent || '';
      return (text.includes('Catalog Error') || text.includes('does not exist') ||
              text.includes('Invalid plot') || text.includes('Query has errors') ||
              text.includes('Binder Error') || text.includes('Parser Error'))
        && el.children.length === 0 && el.offsetParent !== null
        && !el.closest('.cm-editor') && !el.closest('[class*="token"]');
    }).map(e => e.textContent.trim().slice(0, 120))
  );
}

async function loadDemo(page) {
  await page.goto(BASE,{waitUntil:'networkidle',timeout:30000});
  const skip=await page.$('button:has-text("Skip")');if(skip)await skip.click().catch(()=>{});
  const demo=await page.$('button:has-text("Try the demo"),a:has-text("Try the demo"),[aria-label*="demo"]');
  if(demo){await demo.click();await page.waitForTimeout(2000);}
  await idle(page,60000);
}

async function loadTpl(page, name) {
  const btn = await page.$('[title="New from template"],[aria-label="New from template"]');
  if(!btn){console.log(`  no template btn for ${name}`);return false;}
  await btn.click();
  await page.waitForSelector('dialog,[role="dialog"]',{timeout:8000});
  await page.waitForTimeout(500);
  const t=await page.$(`button[aria-label="Select template: ${name}"]`)||await page.$(`button:has-text("${name}")`);
  if(!t){await page.keyboard.press('Escape');console.log(`  template not found: ${name}`);return false;}
  await t.click();
  await page.waitForTimeout(300);
  for(const s of['button:has-text("Open & Run")','button:has-text("Use template")','button:has-text("Open")',' button:has-text("Open")',' button:has-text("Use template")',' button:has-text("Open & Run")']){
    const b=await page.$(s);
    if(b&&!(await b.getAttribute('disabled'))){await b.click();break;}
  }
  await page.waitForTimeout(3000);
  await idle(page,120000);
  return true;
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  const ctx = await browser.newContext({
    viewport:{width:1440,height:900},
    storageState:{cookies:[],origins:[{origin:BASE,localStorage:LS}]}
  });
  ctx.on('dialog',d=>d.accept());
  const page = await ctx.newPage();

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

  // ── 1. Demo notebook ───────────────────────────────────────────────────
  await loadDemo(page);
  let errs = await domScan(page);
  const demoSvgs = await page.evaluate(()=>document.querySelectorAll('svg').length);
  const demoCells = await page.evaluate(()=>document.querySelectorAll('[data-cell-id]').length);
  console.log(`Demo: ${errs.length} errors, ${demoSvgs} SVGs, ${demoCells} cells`);
  if(errs.length) errs.forEach(e=>console.log('  ERR: '+e));

  // ── 2. Template: Recording Overview ──────────────────────────────────
  await loadDemo(page);
  const ok1 = await loadTpl(page,'Recording Overview');
  console.log(`\nRecording Overview: loaded=${ok1}`);
  if(ok1){
    errs = await domScan(page);
    const svgs = await page.evaluate(()=>document.querySelectorAll('svg').length);
    const charts = await page.evaluate(()=>document.querySelectorAll('.recharts-surface').length);
    console.log(`  DOM errors: ${errs.length}, SVGs: ${svgs}, charts: ${charts}`);
    if(errs.length) errs.forEach(e=>console.log('  ERR: '+e));
    const runAll=await page.$('[aria-label="Run All Queries"],[title="Run All Queries"]');
    if(runAll){
      await runAll.click();await page.waitForTimeout(1000);await idle(page,90000);
      errs = await domScan(page);
      const charts2 = await page.evaluate(()=>document.querySelectorAll('.recharts-surface').length);
      console.log(`  After Run All: ${errs.length} errors, ${charts2} charts`);
      if(errs.length) errs.forEach(e=>console.log('  ERR: '+e));
    }
  }

  // ── 3. Template: CPU Profiling ─────────────────────────────────────────
  await loadDemo(page);
  const ok2 = await loadTpl(page,'CPU Profiling');
  console.log(`\nCPU Profiling: loaded=${ok2}`);
  if(ok2){
    errs = await domScan(page);
    const svgs = await page.evaluate(()=>document.querySelectorAll('svg').length);
    const charts = await page.evaluate(()=>document.querySelectorAll('.recharts-surface').length);
    console.log(`  DOM errors: ${errs.length}, SVGs: ${svgs}, charts: ${charts}`);
    if(errs.length) errs.forEach(e=>console.log('  ERR: '+e));
    const runAll=await page.$('[aria-label="Run All Queries"],[title="Run All Queries"]');
    if(runAll){
      await runAll.click();await page.waitForTimeout(1000);await idle(page,90000);
      errs = await domScan(page);
      const charts2 = await page.evaluate(()=>document.querySelectorAll('.recharts-surface').length);
      console.log(`  After Run All: ${errs.length} errors, ${charts2} charts`);
      if(errs.length) errs.forEach(e=>console.log('  ERR: '+e));
    }
  }

  // ── 4. Interactive features ─────────────────────────────────────────────
  console.log('\n── Interactive features ──');
  await loadDemo(page);
  await loadTpl(page,'GC Pause Analysis');

  // Variables panel - click $session_start
  const ssBtn = await page.$('[aria-label^="$session_start"]');
  console.log(`Variables ($session_start btn): ${!!ssBtn}`);
  if(ssBtn){
    await ssBtn.click();await page.waitForTimeout(500);
    const inp = await page.$('input[type="datetime-local"]');
    console.log(`  datetime-local input: ${!!inp}`);
    await page.keyboard.press('Escape');
  }

  // LINK_X zoom: scrollIntoViewIfNeeded, then Shift+scroll
  const allCharts = await page.$$('.recharts-surface');
  let zoomWorked = false;
  for(const chart of allCharts){
    const preBox = await chart.boundingBox();
    if(!preBox || preBox.width<200 || preBox.height<50) continue;
    await chart.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const box = await chart.boundingBox();
    if(!box || box.y<0 || box.y+box.height>900) continue;
    await page.mouse.move(box.x+box.width/2, box.y+box.height/2);
    await page.waitForTimeout(200);
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0,-300);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(800);
    const reset = await page.$('button:has-text("Reset"),button[aria-label*="Reset zoom"]');
    if(reset){zoomWorked=true;await reset.click();await page.waitForTimeout(200);break;}
  }
  console.log(`LINK_X zoom (Shift+scroll): ${zoomWorked}`);

  // Command palette
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(600);
  const palette = await page.$('[role="dialog"] input,[class*="palette"] input');
  console.log(`Command palette (Cmd+K): ${!!palette}`);
  if(palette){
    await palette.type('gc pause');await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
  }

  // Schema explorer + SQL autocomplete (read-only check)
  const tablePreviewBtn = await page.$('[title="Click to preview · Double-click to copy name"]');
  if(tablePreviewBtn){
    await tablePreviewBtn.click();await page.waitForTimeout(800);
    const edCount = await page.evaluate(()=>document.querySelectorAll('.cm-editor').length);
    const hasPreviewEd = await page.evaluate(()=>{
      const allEds = Array.from(document.querySelectorAll('.cm-editor'));
      const previewEd = allEds.find(ed => !ed.closest('[data-cell-id]'));
      return !!previewEd && !!previewEd.querySelector('.cm-content');
    });
    console.log(`Schema explorer: opened preview, ${edCount} editors visible`);
    console.log(`SQL autocomplete: ${hasPreviewEd ? 'editor ready (CM6)' : 'not visible'}`);
    await page.keyboard.press('Escape');
  } else {
    console.log('Schema explorer: no table preview button found');
    console.log('SQL autocomplete: skipped');
  }

  // Help modal
  const helpBtn = await page.$('[title="Keyboard Shortcuts & Tips (?)"],button[aria-label="Keyboard Shortcuts"]');
  if(helpBtn){
    await helpBtn.click();await page.waitForTimeout(600);
    const modal = await page.$('[role="dialog"]');
    const hasContent = modal ? await modal.evaluate(el=>el.textContent?.includes('Ctrl')||el.textContent?.includes('Cmd')||el.textContent?.includes('shortcut')) : false;
    console.log(`Help modal: opened=${!!modal}, hasShortcuts=${hasContent}`);
    if(modal) await page.keyboard.press('Escape');
  } else {
    console.log('Help modal: button not found');
  }

  // Run All
  const runAllBtn = await page.$('[aria-label="Run All Queries"],[title="Run All Queries"]');
  if(runAllBtn){
    await runAllBtn.click();await page.waitForTimeout(1000);await idle(page,120000);
    errs = await domScan(page);
    const charts2 = await page.evaluate(()=>document.querySelectorAll('.recharts-surface').length);
    console.log(`Run All: ${errs.length} errors, ${charts2} charts`);
    if(errs.length) errs.forEach(e=>console.log('  ERR: '+e));
  }

  // Chart tooltip
  const finalCharts = await page.$$('.recharts-surface');
  let tooltipFound = false;
  for(const s of finalCharts.slice(0,5)){
    const box = await s.boundingBox();
    if(!box||box.width<100) continue;
    await s.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const box2 = await s.boundingBox();
    if(!box2||box2.y<0||box2.y>900) continue;
    await page.mouse.move(box2.x+box2.width/2, box2.y+box2.height/2);
    await page.waitForTimeout(500);
    const tt = await page.$('.recharts-tooltip-wrapper,.custom-tooltip,[class*="tooltip"]');
    if(tt){tooltipFound=true;break;}
  }
  console.log(`Chart tooltip: ${tooltipFound}`);

  // Resize handles
  const resizeHandles = await page.$$('[class*="resize-handle"],[style*="cursor: s-resize"],[style*="cursor: ns-resize"]');
  console.log(`Resize handles: ${resizeHandles.length}`);

  // Collapse/Expand All
  const collapseBtn = await page.$('[aria-label="Collapse All"],[title="Collapse All"]');
  if(collapseBtn){
    await collapseBtn.click();await page.waitForTimeout(500);
    const expandBtn = await page.$('[aria-label="Expand All"],[title="Expand All"]');
    if(expandBtn){await expandBtn.click();await page.waitForTimeout(300);}
    console.log('Collapse/Expand All: ✅');
  } else {
    console.log('Collapse/Expand All: not found');
  }

  // ── Console errors ─────────────────────────────────────────────────────
  console.log(`\nConsole errors (real): ${consoleErrs.length}`);
  consoleErrs.slice(0,5).forEach(e=>console.log('  '+e));

  // UI polish
  const zeroHeight = await page.evaluate(()=>
    Array.from(document.querySelectorAll('[data-cell-id]'))
      .filter(el=>el.offsetHeight < 10 && el.offsetParent!==null).length
  );
  console.log(`Zero-height cells: ${zeroHeight}`);

  await ctx.close();
  await browser.close();
  process.exit(0);
})();
