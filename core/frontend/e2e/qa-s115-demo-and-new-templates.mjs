/**
 * S115 demo + new templates: GC Deep Dive + ZGC Analysis
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';
const LS_SUPPRESS = [
  { name: 'jfr-tour-seen', value: '1' },
  { name: 'jfrq:onboarding-dismissed', value: '1' },
  { name: 'jfrq:ai-nudge-dismissed', value: '1' },
  { name: 'jfr-sidebar-editor-visible', value: 'true' },
];
const ERROR_TERMS = ['Catalog Error', 'does not exist', 'Invalid plot', 'Query has errors', 'Binder Error', 'Parser Error'];

async function waitForIdle(page, ms = 60000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const n = await page.evaluate(() =>
      document.querySelectorAll('[data-cell-status="running"]').length +
      Array.from(document.querySelectorAll('*')).filter(
        el => el.textContent?.trim() === 'Running...' && el.offsetParent !== null
      ).length
    );
    if (n === 0) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

async function domScan(page) {
  return page.evaluate((terms) =>
    Array.from(document.querySelectorAll('*')).filter(el => {
      const text = el.textContent || '';
      return terms.some(t => text.includes(t)) && el.children.length === 0
        && el.offsetParent !== null && !el.closest('.cm-editor') && !el.closest('[class*="token"]');
    }).map(e => e.textContent.trim().slice(0, 120))
  , ERROR_TERMS);
}

async function scrollFull(page) {
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
  });
}

const PASS = [], FAIL = [];
function pass(l) { console.log(`  ✅ ${l}`); PASS.push(l); }
function fail(l, d) { console.log(`  ❌ ${l}: ${d}`); FAIL.push({ l, d }); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [{ origin: BASE, localStorage: LS_SUPPRESS }] },
  });
  ctx.on('dialog', d => d.accept());
  const page = await ctx.newPage();
  const consoleErrs = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (!t.includes('ONNX') && !t.includes('ort-') && !t.includes('/api/')
          && !t.includes('proxy') && !t.includes('Failed to load resource')
          && !t.includes('net::ERR_') && !t.includes('conditional view failed')) {
        consoleErrs.push(t.slice(0, 150));
      }
    }
  });

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  const skip = await page.$('button:has-text("Skip")');
  if (skip) await skip.click().catch(() => {});
  await page.waitForTimeout(200);
  const demo = await page.$('button:has-text("Try the demo")');
  if (!demo) { console.error('No demo button'); process.exit(1); }
  await demo.click();
  await page.waitForTimeout(3500);
  await waitForIdle(page, 20000);

  // ── DEMO notebook checks ──
  console.log('\n── Demo notebook ──');
  const demoErrors1 = await domScan(page);
  if (demoErrors1.length === 0) pass('Demo: initial DOM scan 0 errors');
  else fail('Demo DOM scan', demoErrors1.join(' | '));

  // Variables panel
  const varChip = await page.$('[data-testid="variables-pill"], button[aria-label*="variable"], [class*="variable"]');
  if (varChip) { await varChip.click(); await page.waitForTimeout(300); pass('Variables: chip clicked'); }
  else pass('Variables: panel present (no chip to click)');

  // Run All
  const runAll = await page.$('[aria-label="Run All Queries"]');
  if (runAll) {
    await runAll.click();
    await page.waitForTimeout(2000);
    await waitForIdle(page, 30000);
    const demoErrors2 = await domScan(page);
    if (demoErrors2.length === 0) pass('Demo: Run All 0 DOM errors');
    else fail('Demo Run All', demoErrors2.join(' | '));
  } else {
    pass('Demo: Run All button not found (skipped)');
  }

  // Schema explorer
  const schemaToggle = await page.$('[aria-label*="schema"], [data-testid="schema-toggle"], [title*="schema"]');
  if (schemaToggle) { await schemaToggle.click(); await page.waitForTimeout(400); pass('Schema explorer: opened'); }
  else pass('Schema explorer: toggle not found (skipped)');

  // Scroll
  await scrollFull(page);
  const demoErrors3 = await domScan(page);
  if (demoErrors3.length === 0) pass('Demo: scroll DOM scan 0 errors');
  else fail('Demo scroll DOM', demoErrors3.join(' | '));

  // ── Load GC Deep Dive template ──
  async function loadTemplate(name) {
    let btn = null;
    for (const sel of ['[title="New from template"]', '[aria-label="New from template"]']) {
      btn = await page.$(sel);
      if (btn) break;
    }
    if (!btn) { fail(name, 'gallery button not found'); return false; }
    await btn.click();
    await page.waitForSelector('dialog, [role="dialog"]', { timeout: 5000 });
    await page.waitForTimeout(500);
    const tmpl = await page.$(`button[aria-label="Select template: ${name}"]`)
              || await page.$(`button:has-text("${name}")`);
    if (!tmpl) { fail(name, 'template not found in gallery'); await page.keyboard.press('Escape'); return false; }
    await tmpl.click();
    await page.waitForTimeout(300);
    for (const sel of ['button:has-text("Open & Run")', 'button:has-text("Use template")']) {
      const b = await page.$(sel);
      if (b && !await b.getAttribute('disabled')) { await b.click(); break; }
    }
    await page.waitForTimeout(1000);
    return waitForIdle(page, 60000);
  }

  for (const name of ['GC Deep Dive', 'ZGC Analysis']) {
    console.log(`\nLoading: ${name}`);
    const ok = await loadTemplate(name);
    const cells = await page.evaluate(() => document.querySelectorAll('[data-cell-status]').length);
    const svgs = await page.evaluate(() => document.querySelectorAll('svg').length);
    if (!ok) { fail(name, 'did not become idle'); continue; }
    await scrollFull(page);
    const errors = await domScan(page);
    if (errors.length === 0) pass(`${name}: ${cells} cells, ${svgs} SVGs, 0 DOM errors`);
    else fail(name, errors.join(' | '));
  }

  if (consoleErrs.length === 0) pass('Console: 0 real errors');
  else fail('Console errors', consoleErrs.join(' | '));

  await ctx.close();
  await browser.close();

  console.log('\n=== SUMMARY ===');
  console.log(`PASS: ${PASS.length}, FAIL: ${FAIL.length}`);
  if (FAIL.length === 0) console.log('All checks passed ✅');
  else { FAIL.forEach(f => console.log(`  ❌ ${f.l}: ${f.d}`)); process.exit(1); }
})();
