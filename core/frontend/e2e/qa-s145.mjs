/**
 * S145 QA pass: all 11 templates + interactive features
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';
const LS = [
  {name:'jfr-tour-seen',value:'1'},
  {name:'jfrq:onboarding-dismissed',value:'1'},
  {name:'jfrq:ai-nudge-dismissed',value:'1'},
  {name:'jfr-sidebar-editor-visible',value:'true'},
];

const TEMPLATES = [
  'Recording Overview',
  'CPU Profiling',
  'Heap Allocation',
  'I/O & Latency',
  'JVM Internals',
  'Memory Leak Detection',
  'Container & Cloud',
  'Exception & Error Analysis',
  'Comprehensive Feature Test',
  'GC Pause Analysis',
  'ZGC Analysis',
];

async function idle(page, ms=120000) {
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
    }).map(e => e.textContent.trim().slice(0, 150))
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
  if(!btn){console.log(`  ✗ no template btn for ${name}`);return false;}
  await btn.click();
  await page.waitForSelector('dialog,[role="dialog"]',{timeout:8000}).catch(()=>{});
  await page.waitForTimeout(500);
  const t=await page.$(`button[aria-label="Select template: ${name}"]`)||await page.$(`button:has-text("${name}")`);
  if(!t){await page.keyboard.press('Escape');console.log(`  ✗ template not found: ${name}`);return false;}
  await t.click();
  await page.waitForTimeout(300);
  for(const s of['button:has-text("Open & Run")','button:has-text("Use template")','button:has-text("Open")']){
    const b=await page.$(s);
    if(b&&!(await b.getAttribute('disabled'))){await b.click();break;}
  }
  await page.waitForTimeout(3000);
  await idle(page,120000);
  return true;
}

async function runAllAndScan(page) {
  const runAll=await page.$('[aria-label="Run All Queries"],[title="Run All Queries"]');
  if(runAll){
    await runAll.click();await page.waitForTimeout(1000);await idle(page,120000);
  }
  const errs=await domScan(page);
  const charts=await page.evaluate(()=>document.querySelectorAll('.recharts-surface').length);
  const svgs=await page.evaluate(()=>document.querySelectorAll('svg').length);
  return {errs, charts, svgs};
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
  const demoErrs = await domScan(page);
  const demoCells = await page.evaluate(()=>document.querySelectorAll('[data-cell-id]').length);
  const demoSvgs = await page.evaluate(()=>document.querySelectorAll('svg').length);
  console.log(`\n[Demo] cells=${demoCells} svgs=${demoSvgs} errors=${demoErrs.length}`);
  if(demoErrs.length) demoErrs.forEach(e=>console.log('  ERR: '+e));

  // ── 2. All 11 templates ────────────────────────────────────────────────
  const results = {};
  for(const name of TEMPLATES){
    await loadDemo(page);
    const ok = await loadTpl(page, name);
    if(!ok){results[name]={loaded:false};continue;}
    const {errs,charts,svgs} = await runAllAndScan(page);
    results[name]={loaded:true, errs, charts, svgs};
    const status = errs.length===0 ? '✅' : '❌';
    console.log(`\n[${name}] ${status} charts=${charts} svgs=${svgs} errors=${errs.length}`);
    if(errs.length) errs.forEach(e=>console.log('  ERR: '+e));
  }

  // ── 3. Interactive features ─────────────────────────────────────────────
  console.log('\n── Interactive features (GC Pause Analysis) ──');
  await loadDemo(page);
  await loadTpl(page,'GC Pause Analysis');

  // Variables
  const ssBtn = await page.$('[aria-label^="$session_start"]');
  if(ssBtn){
    await ssBtn.click();await page.waitForTimeout(500);
    const inp = await page.$('input[type="datetime-local"]');
    console.log(`Variables panel: ✅ (datetime-local=${!!inp})`);
    await page.keyboard.press('Escape');
  } else {
    console.log('Variables panel: ❌ (button not found)');
  }

  // LINK_X zoom
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
  console.log(`LINK_X zoom: ${zoomWorked?'✅':'❌'}`);

  // Command palette
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(600);
  const palette = await page.$('[role="dialog"] input,[class*="palette"] input');
  console.log(`Command palette (Cmd+K): ${palette?'✅':'❌'}`);
  if(palette){await palette.type('gc');await page.waitForTimeout(300);await page.keyboard.press('Escape');}

  // Schema explorer
  const tablePreviewBtn = await page.$('[title="Click to preview · Double-click to copy name"]');
  if(tablePreviewBtn){
    await tablePreviewBtn.click();await page.waitForTimeout(800);
    const edCount = await page.evaluate(()=>document.querySelectorAll('.cm-editor').length);
    const hasPreviewEd = await page.evaluate(()=>{
      const allEds=Array.from(document.querySelectorAll('.cm-editor'));
      const ed=allEds.find(e=>!e.closest('[data-cell-id]'));
      return !!ed&&!!ed.querySelector('.cm-content');
    });
    console.log(`Schema explorer: ✅ (${edCount} editors, preview CM6=${hasPreviewEd})`);
    await page.keyboard.press('Escape');
  } else {
    console.log('Schema explorer: ❌ (no preview button)');
  }

  // Help modal
  const helpBtn = await page.$('[title="Keyboard Shortcuts & Tips (?)"],button[aria-label="Keyboard Shortcuts"]');
  if(helpBtn){
    await helpBtn.click();await page.waitForTimeout(600);
    const modal = await page.$('[role="dialog"]');
    const hasContent = modal?await modal.evaluate(el=>el.textContent?.includes('Ctrl')||el.textContent?.includes('Cmd')):false;
    console.log(`Help modal: ${hasContent?'✅':'❌'}`);
    if(modal) await page.keyboard.press('Escape');
  } else {
    console.log('Help modal: ❌ (button not found)');
  }

  // Collapse/Expand
  const collapseBtn = await page.$('[aria-label="Collapse All"],[title="Collapse All"]');
  if(collapseBtn){
    await collapseBtn.click();await page.waitForTimeout(500);
    const expandBtn = await page.$('[aria-label="Expand All"],[title="Expand All"]');
    if(expandBtn){await expandBtn.click();await page.waitForTimeout(300);}
    console.log('Collapse/Expand All: ✅');
  } else {
    console.log('Collapse/Expand All: ❌');
  }

  // Chart tooltip
  const finalCharts = await page.$$('.recharts-surface');
  let tooltipFound = false;
  for(const s of finalCharts.slice(0,5)){
    const box=await s.boundingBox();if(!box||box.width<100)continue;
    await s.scrollIntoViewIfNeeded();await page.waitForTimeout(300);
    const box2=await s.boundingBox();if(!box2||box2.y<0||box2.y>900)continue;
    await page.mouse.move(box2.x+box2.width/2,box2.y+box2.height/2);
    await page.waitForTimeout(500);
    const tt=await page.$('.recharts-tooltip-wrapper,.custom-tooltip,[class*="PlotTooltip"]');
    if(tt){tooltipFound=true;break;}
  }
  console.log(`Chart tooltip: ${tooltipFound?'✅':'❌'}`);

  // Resize handles
  const handles=await page.$$('[class*="resize-handle"],[style*="cursor: s-resize"],[style*="cursor: ns-resize"]');
  console.log(`Resize handles: ${handles.length}`);

  // ── Console errors ─────────────────────────────────────────────────────
  console.log(`\nConsole errors (real): ${consoleErrs.length}`);
  consoleErrs.slice(0,8).forEach(e=>console.log('  '+e));

  // UI polish
  const zeroH=await page.evaluate(()=>
    Array.from(document.querySelectorAll('[data-cell-id]'))
      .filter(el=>el.offsetHeight<10&&el.offsetParent!==null).length
  );
  console.log(`Zero-height cells: ${zeroH}`);

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('\n── Summary ──');
  let totalErrors=0;
  for(const [name,r] of Object.entries(results)){
    if(!r.loaded){console.log(`  ${name}: not loaded`);continue;}
    const s=r.errs.length===0?'✅':'❌';
    console.log(`  ${s} ${name}: ${r.errs.length} errors, ${r.charts} charts`);
    totalErrors+=r.errs.length;
  }
  console.log(`Total template errors: ${totalErrors}`);

  await ctx.close();
  await browser.close();
  process.exit(0);
})();
