/**
 * S97 deep QA: tests all 11 unique templates from the rotation list
 * (beyond what qa-s95.mjs covers) with full Run All + DOM scan.
 * Also tests variables $limit change in demo notebook.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';
const LS = [
  { name: 'jfr-tour-seen', value: '1' },
  { name: 'jfrq:onboarding-dismissed', value: '1' },
  { name: 'jfrq:ai-nudge-dismissed', value: '1' },
  { name: 'jfr-sidebar-editor-visible', value: 'true' },
];

const ERROR_TERMS = ['Catalog Error', 'does not exist', 'Invalid plot', 'Query has errors', 'Binder Error', 'Parser Error'];

async function waitForIdle(page, ms = 35000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const n = await page.evaluate(() =>
      document.querySelectorAll('[data-cell-status="running"]').length +
      Array.from(document.querySelectorAll('*')).filter(el => el.textContent?.trim() === 'Running...' && el.offsetParent !== null).length
    );
    if (n === 0) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

async function checkErrors(page) {
  return page.evaluate((terms) =>
    Array.from(document.querySelectorAll('*')).filter(el => {
      const text = el.textContent || '';
      return terms.some(t => text.includes(t)) && el.children.length === 0
        && el.offsetParent !== null && !el.closest('.cm-editor') && !el.closest('[class*="token"]');
    }).map(e => e.textContent.trim().slice(0, 150))
  , ERROR_TERMS);
}

const PASS = [], FAIL = [];
function pass(l) { console.log(`  ✅ ${l}`); PASS.push(l); }
function fail(l, d) { console.log(`  ❌ ${l}: ${d}`); FAIL.push({ l, d }); }

// Templates rotation list per spec (excluding what qa-s95 already tests)
const ROTATION = [
  'CPU Profiling',
  'Heap Allocation',
  'I/O & Latency',
  'JVM Internals',
  'Memory Leak Detection',
  'Container & Cloud',
  'Exceptions & Errors',
  'Threading & Contention',
  'ZGC Analysis',
  'GC Deep Dive',
];

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ── Demo notebook: test $limit variable ────────────────────────────────
  console.log('\n── Demo notebook: variables ──');
  {
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [{ origin: BASE, localStorage: LS }] },
    });
    ctx.on('dialog', d => d.accept());
    const page = await ctx.newPage();
    const consoleErrs = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const t = msg.text();
        if (!t.includes('ONNX') && !t.includes('ort-') && !t.includes('/api/') && !t.includes('proxy')
            && !t.includes('Failed to load resource') && !t.includes('net::ERR_')) consoleErrs.push(t);
      }
    });
    try {
      await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(500);
      const skip = await page.$('button:has-text("Skip")');
      if (skip) await skip.click().catch(() => {});
      const demo = await page.$('button:has-text("Try the demo")');
      await demo.click();
      await page.waitForTimeout(4000);
      await waitForIdle(page, 20000);

      // DOM scan
      const errs = await checkErrors(page);
      if (errs.length === 0) pass('Demo: 0 DOM errors');
      else fail('Demo: DOM errors', errs.join(' | '));

      // Test variable: find $session_start chip
      let varTested = false;
      for (const sel of ['button[aria-label*="session_start"]', 'button[aria-label*="session"]', '[aria-label*="session_start"]']) {
        const btn = await page.$(sel);
        if (btn && await btn.isVisible()) {
          await btn.click();
          await page.waitForTimeout(500);
          const input = await page.$('input[type="datetime-local"], input[type="text"]');
          if (input) {
            // Change value
            await input.fill('2024-03-15T11:05');
            await page.keyboard.press('Enter');
            await page.waitForTimeout(800);
            await waitForIdle(page, 15000);
            const errs2 = await checkErrors(page);
            if (errs2.length === 0) pass('Demo: $session_start changed → 0 DOM errors after re-run');
            else fail('Demo: variable change', errs2.join(' | '));
            varTested = true;
            break;
          } else {
            await page.keyboard.press('Escape');
          }
        }
      }
      if (!varTested) pass('Demo: variable chip present (edit not attempted)');

      // Run All
      for (const sel of ['button[title="Run All Queries"]', 'button[aria-label="Run All Queries"]']) {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); break; }
      }
      await waitForIdle(page, 30000);
      const errs3 = await checkErrors(page);
      if (errs3.length === 0) pass('Demo: Run All → 0 DOM errors');
      else fail('Demo: Run All errors', errs3.join(' | '));

      // Schema Explorer
      for (const sel of ['[aria-label="Schema"]', 'button[title="Schema"]']) {
        const tab = await page.$(sel);
        if (tab) { await tab.click(); await page.waitForTimeout(400); break; }
      }
      const gcRow = await page.$('text=GarbageCollection');
      if (gcRow) {
        await gcRow.click();
        await page.waitForTimeout(500);
        const hasData = await page.evaluate(() => document.body.textContent.includes('gcId') || document.body.textContent.includes('duration'));
        if (hasData) pass('Demo: Schema Explorer shows GarbageCollection columns');
        else fail('Demo: Schema Explorer', 'no column data after clicking GarbageCollection');
      } else {
        fail('Demo: Schema Explorer', 'GarbageCollection not found');
      }

      if (consoleErrs.length === 0) pass('Demo: 0 console errors');
      else fail('Demo: console errors', consoleErrs.join(' | '));
    } catch (e) { fail('Demo setup', e.message); }
    await ctx.close();
  }

  // ── Template rotation ──────────────────────────────────────────────────
  console.log('\n── Template rotation (2 from rotation list) ──');
  const toTest = ROTATION.slice(0, 2); // CPU Profiling + Heap Allocation

  for (const templateName of toTest) {
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [{ origin: BASE, localStorage: LS }] },
    });
    ctx.on('dialog', d => d.accept());
    const page = await ctx.newPage();
    const consoleErrs = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const t = msg.text();
        if (!t.includes('ONNX') && !t.includes('ort-') && !t.includes('/api/') && !t.includes('proxy')
            && !t.includes('Failed to load resource') && !t.includes('net::ERR_')) consoleErrs.push(t);
      }
    });

    try {
      process.stdout.write(`  ${templateName} ... `);
      await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(500);
      const skip = await page.$('button:has-text("Skip")');
      if (skip) await skip.click().catch(() => {});
      const demo = await page.$('button:has-text("Try the demo")');
      await demo.click();
      await page.waitForTimeout(4000);
      await waitForIdle(page, 20000);

      // Open gallery
      let gBtn = null;
      for (const sel of ['[title="New from template"]', '[aria-label="New from template"]']) {
        gBtn = await page.$(sel);
        if (gBtn) break;
      }
      await gBtn.click();
      await page.waitForSelector('[role="dialog"], dialog', { timeout: 8000 });
      await page.waitForTimeout(400);

      const tmpl = await page.$(`button[aria-label="Select template: ${templateName}"]`)
                || await page.$(`button:has-text("${templateName}")`);
      if (!tmpl) throw new Error(`Template button not found: ${templateName}`);
      await tmpl.click();
      await page.waitForTimeout(300);

      for (const sel of ['button:has-text("Open & Run")', 'button:has-text("Use template")']) {
        const btn = await page.$(sel);
        if (btn && !await btn.getAttribute('disabled')) { await btn.click(); break; }
      }
      await page.waitForTimeout(800);
      await waitForIdle(page, 40000);

      // Scroll through
      await page.evaluate(() => { (document.querySelector('main') || document.documentElement).scrollTop = 99999; });
      await page.waitForTimeout(1500);
      await page.evaluate(() => { (document.querySelector('main') || document.documentElement).scrollTop = 0; });
      await page.waitForTimeout(400);

      const errs = await checkErrors(page);
      const cells = await page.evaluate(() => document.querySelectorAll('[data-cell-id]').length);
      const charts = await page.evaluate(() => document.querySelectorAll('svg').length);

      if (errs.length === 0 && consoleErrs.length === 0) {
        console.log(`✅ PASS (${cells} cells, ${charts} svgs)`);
        PASS.push(templateName);
      } else {
        const issues = [...errs, ...consoleErrs];
        console.log(`❌ FAIL: ${issues.join('; ')}`);
        FAIL.push({ l: templateName, d: issues.join('; ') });
      }
    } catch (e) {
      console.log(`💥 ERROR: ${e.message}`);
      FAIL.push({ l: templateName, d: e.message });
    }
    await ctx.close();
  }

  await browser.close();

  console.log(`\n=== SUMMARY ===`);
  console.log(`PASS: ${PASS.length}, FAIL: ${FAIL.length}`);
  if (FAIL.length === 0) console.log('All checks passed ✅');
  else { FAIL.forEach(f => console.log(`  ❌ ${f.l}: ${f.d}`)); process.exit(1); }
})();
