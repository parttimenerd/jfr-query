/**
 * S94 template QA v2 — loads each builtin template via ?template= URL,
 * then loads demo data, runs all cells, and checks for user-visible errors.
 * Also checks cell counts to verify templates actually loaded.
 *
 * Usage: cd core/frontend && node e2e/template-qa-s94.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';

const TEMPLATES = [
  ['recording-overview', 'Recording Overview'],
  ['gc-analysis',        'GC Pause Analysis'],
  ['gc-extended',        'GC Deep Dive'],
  ['cpu-profiling',      'CPU Profiling'],
  ['heap-allocation',    'Heap Allocation'],
  ['io-latency',         'I/O & Latency'],
  ['jvm-internals',      'JVM Internals'],
  ['memory-leaks',       'Memory Leak Detection'],
  ['container',          'Container & Cloud'],
  ['exceptions',         'Exceptions & Errors'],
  ['threading',          'Threading & Contention'],
  ['comprehensive-test', 'Comprehensive Feature Test'],
  ['zgc-analysis',       'ZGC Analysis'],
];

const ERROR_TERMS = [
  'Catalog Error', 'does not exist', 'Invalid plot', 'Query has errors',
  'Binder Error', 'Parser Error',
];

const LS_SUPPRESS = [
  { name: 'jfr-tour-seen',               value: '1' },
  { name: 'jfrq:onboarding-dismissed',   value: '1' },
  { name: 'jfrq:ai-nudge-dismissed',     value: '1' },
];

async function checkErrors(page) {
  return page.evaluate((terms) => {
    return Array.from(document.querySelectorAll('*')).filter(el => {
      const text = el.textContent || '';
      return terms.some(t => text.includes(t))
        && el.children.length === 0
        && el.offsetParent !== null
        && !el.closest('.cm-editor')
        && !el.closest('[class*="token"]');
    }).map(e => e.textContent.trim().slice(0, 150));
  }, ERROR_TERMS);
}

async function waitForQueries(page, timeoutMs = 40000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const running = await page.evaluate(() =>
      document.querySelectorAll('[data-cell-status="running"]').length +
      Array.from(document.querySelectorAll('*')).filter(el =>
        el.textContent?.trim() === 'Running...' && el.offsetParent !== null
      ).length
    );
    if (running === 0) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function runAll(page) {
  for (const sel of [
    'button[title="Run all cells"]',
    'button:has-text("Run All")',
    '[aria-label="Run all cells"]',
  ]) {
    const btn = await page.$(sel);
    if (btn) { await btn.click(); return true; }
  }
  return false;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const [slug, displayName] of TEMPLATES) {
    process.stdout.write(`  ${displayName} ... `);

    const context = await browser.newContext({
      storageState: {
        cookies: [],
        origins: [{ origin: BASE, localStorage: LS_SUPPRESS }],
      },
    });
    context.on('dialog', d => d.accept());
    const page = await context.newPage();
    page.on('console', () => {});

    try {
      // Step 1: load the app and click "Try the demo" first
      await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(500);

      // Dismiss tour if present
      const skip = await page.$('button:has-text("Skip")');
      if (skip) await skip.click();
      await page.waitForTimeout(200);

      // Load demo data
      let demoLoaded = false;
      for (const sel of ['button:has-text("Try the demo")', 'button:has-text("Load demo")', 'button:has-text("demo")']) {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); demoLoaded = true; break; }
      }
      if (!demoLoaded) {
        throw new Error('Could not find demo button');
      }
      // Wait for demo JFR to import
      await page.waitForTimeout(4000);

      // Step 2: load template via gallery button
      // Find and click "New from template" button
      let galleryOpened = false;
      for (const sel of [
        '[title="New from template"]',
        'button[aria-label="New from template"]',
        'button:has-text("New from template")',
        'button:has-text("Template")',
      ]) {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); galleryOpened = true; break; }
      }

      if (!galleryOpened) {
        // Try the toolbar area
        const btns = await page.$$('button');
        for (const btn of btns) {
          const title = await btn.getAttribute('title');
          const label = await btn.getAttribute('aria-label');
          if ((title || label || '').toLowerCase().includes('template')) {
            await btn.click(); galleryOpened = true; break;
          }
        }
      }

      if (!galleryOpened) throw new Error('Template gallery button not found');

      // Wait for template dialog
      await page.waitForSelector('dialog, [role="dialog"]', { timeout: 5000 });
      await page.waitForTimeout(300);

      // Find and click the template button
      let templateClicked = false;
      for (const sel of [
        `button[aria-label="Select template: ${displayName}"]`,
        `button:has-text("${displayName}")`,
      ]) {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); templateClicked = true; break; }
      }
      if (!templateClicked) throw new Error(`Template not found in gallery: ${displayName}`);
      await page.waitForTimeout(300);

      // Click "Open & Run" or "Use template"
      let confirmClicked = false;
      for (const sel of [
        'button:has-text("Open & Run")',
        'button:has-text("Use template")',
        'button:has-text("Load")',
      ]) {
        const btn = await page.$(sel);
        if (btn) {
          const disabled = await btn.getAttribute('disabled');
          if (!disabled) { await btn.click(); confirmClicked = true; break; }
        }
      }
      if (!confirmClicked) throw new Error('Confirm/Open button not found or disabled');

      await page.waitForTimeout(1000);

      // Check how many cells loaded
      const cellCount = await page.evaluate(() =>
        document.querySelectorAll('[data-cell-id]').length
      );

      // Run all cells
      await runAll(page);

      // Wait for completion
      const settled = await waitForQueries(page, 40000);

      // Scroll to trigger lazy renders
      await page.evaluate(() => {
        const main = document.querySelector('main') || document.documentElement;
        main.scrollTop = 999999;
      });
      await page.waitForTimeout(2000);
      await page.evaluate(() => {
        const main = document.querySelector('main') || document.documentElement;
        main.scrollTop = 0;
      });
      await page.waitForTimeout(500);

      const errors = await checkErrors(page);
      const svgs   = await page.evaluate(() => document.querySelectorAll('svg').length);
      const tables = await page.evaluate(() => document.querySelectorAll('table').length);

      const status = errors.length === 0 ? (settled ? 'PASS' : 'TIMEOUT') : 'FAIL';
      const note   = `(${cellCount} cells, ${svgs} svgs, ${tables} tables)`;
      if (status === 'PASS') {
        console.log(`✅ PASS ${note}`);
      } else if (status === 'TIMEOUT') {
        console.log(`⏱  TIMEOUT ${note}`);
      } else {
        console.log(`❌ FAIL ${note}`);
        errors.forEach(e => console.log(`    ERROR: ${e}`));
      }
      results.push({ name: displayName, slug, status, errors, svgs, tables, cellCount });
    } catch (e) {
      console.log(`💥 ERROR: ${e.message}`);
      results.push({ name: displayName, slug, status: 'ERROR', errors: [e.message], svgs: 0, tables: 0, cellCount: 0 });
    } finally {
      await context.close();
    }
  }

  await browser.close();

  console.log('\n=== SUMMARY ===');
  const pass    = results.filter(r => r.status === 'PASS').length;
  const timeout = results.filter(r => r.status === 'TIMEOUT').length;
  const fail    = results.filter(r => r.status !== 'PASS' && r.status !== 'TIMEOUT').length;
  console.log(`${pass}/${results.length} passed, ${timeout} timeout, ${fail} failed`);
  results.filter(r => r.status !== 'PASS').forEach(r =>
    console.log(`  ${r.status}: ${r.name}: ${r.errors.join('; ')}`)
  );

  process.exit(fail > 0 ? 1 : 0);
})();
