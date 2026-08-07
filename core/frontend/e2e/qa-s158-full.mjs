/**
 * Full visual QA — loads all 13 templates + demo, runs queries,
 * scans DOM for user-visible errors per the specified check.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';
const TIMEOUT_RUN_ALL = 45_000; // ms to wait for queries after Run All

const ERROR_TERMS = [
  'Catalog Error', 'does not exist', 'Invalid plot',
  'Query has errors', 'Binder Error', 'Parser Error',
];

// Template aria-label names in the gallery
const TEMPLATES = [
  'Recording Overview',
  'GC Pause Analysis',
  'GC Deep Dive',
  'CPU Profiling',
  'Heap Allocation',
  'I/O & Latency',
  'Threading & Contention',
  'JVM Internals',
  'Memory Leak Detection',
  'Container & Cloud',
  'Exceptions & Errors',
  'ZGC Analysis',
  'Comprehensive Feature Test',
];

const NOISE = ['ONNX', 'ai-proxy', 'conditional view failed', 'HTTP 500',
               'Failed to load resource', 'net::ERR', 'favicon',
               'recharts', 'ResizeObserver'];

function makeErrorCollector(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (!NOISE.some(n => t.includes(n))) errors.push(t.slice(0, 200));
    }
  });
  page.on('pageerror', err => errors.push('PAGE_ERR: ' + err.message.slice(0, 200)));
  return errors;
}

async function scanDomErrors(page) {
  return page.evaluate((terms) => {
    return Array.from(document.querySelectorAll('*'))
      .filter(el => {
        const text = el.textContent || '';
        return terms.some(t => text.includes(t))
          && el.children.length === 0
          && el.offsetParent !== null;
      })
      .map(e => e.textContent.trim().slice(0, 150));
  }, ERROR_TERMS);
}

async function runAll(page) {
  const btn = page.locator('[aria-label="Run All Queries"]');
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btn.click();
    // Wait for running indicator to clear, or just sleep
    await page.waitForTimeout(TIMEOUT_RUN_ALL);
  }
}

async function countCharts(page) {
  return page.locator('.recharts-wrapper').count();
}

async function countCells(page) {
  // count .prose blocks as proxy for rendered cells
  return page.locator('.prose').count();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  let totalFail = 0;

  console.log('=== Full Visual QA ===\n');

  // ── Helper: open a fresh page with suppressed first-visit UX ──────────────
  async function freshPage() {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('jfr-tour-seen', '1');
      localStorage.setItem('jfrq:onboarding-dismissed', '1');
      localStorage.setItem('jfrq:ai-nudge-dismissed', '1');
      localStorage.setItem('jfr-ui-autoRunEnabled', 'true');
    });
    return page;
  }

  // ── Helper: select template and click "Open & Run" ────────────────────────
  async function loadTemplate(page, templateName) {
    await page.locator('[aria-label="New from template"]').click();
    await page.waitForTimeout(600);
    const dlg = page.locator('[role="dialog"]');
    await dlg.waitFor({ state: 'visible', timeout: 6000 });

    const selectBtn = dlg.locator(`[aria-label="Select template: ${templateName}"]`);
    if (!(await selectBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      await page.keyboard.press('Escape');
      return false;
    }
    await selectBtn.click();
    await page.waitForTimeout(300);

    const openBtn = dlg.locator('button:has-text("Open & Run")');
    if (!(await openBtn.isEnabled({ timeout: 2000 }).catch(() => false))) {
      await page.keyboard.press('Escape');
      return false;
    }
    await openBtn.click();
    await page.waitForTimeout(2000);
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. DEMO NOTEBOOK
  // ─────────────────────────────────────────────────────────────────────────
  console.log('── Demo notebook ──');
  {
    const page = await freshPage();
    const consoleErrors = makeErrorCollector(page);
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    await page.locator('button:has-text("Try the demo")').first().click();
    await page.waitForTimeout(2500);

    await runAll(page);

    const domErrs = await scanDomErrors(page);
    const charts = await countCharts(page);
    const cells = await countCells(page);

    const status = domErrs.length === 0 && consoleErrors.length === 0 ? '✅' : '❌';
    if (status === '❌') totalFail++;
    console.log(`  ${status} Demo | cells=${cells} charts=${charts} domErrs=${domErrs.length} consoleErrs=${consoleErrors.length}`);
    if (domErrs.length > 0) domErrs.forEach(e => console.log(`     DOM: ${e}`));
    if (consoleErrors.length > 0) consoleErrors.forEach(e => console.log(`     CON: ${e}`));

    results.push({ name: 'Demo', cells, charts, domErrs, consoleErrors: [...consoleErrors] });
    await page.close();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. ALL 13 TEMPLATES
  // ─────────────────────────────────────────────────────────────────────────
  for (const templateName of TEMPLATES) {
    console.log(`── ${templateName} ──`);
    const page = await freshPage();
    const consoleErrors = makeErrorCollector(page);

    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    // Load demo first so the "New from template" button exists
    await page.locator('button:has-text("Try the demo")').first().click();
    await page.waitForTimeout(1500);

    const loaded = await loadTemplate(page, templateName);
    if (!loaded) {
      console.log(`  ❌ ${templateName} | FAILED TO LOAD`);
      totalFail++;
      results.push({ name: templateName, cells: 0, charts: 0, domErrs: ['FAILED TO LOAD'], consoleErrors: [] });
      await page.close();
      continue;
    }

    await runAll(page);

    const domErrs = await scanDomErrors(page);
    const charts = await countCharts(page);
    const cells = await countCells(page);

    const status = domErrs.length === 0 && consoleErrors.length === 0 ? '✅' : '❌';
    if (status === '❌') totalFail++;
    console.log(`  ${status} ${templateName} | cells=${cells} charts=${charts} domErrs=${domErrs.length} consoleErrs=${consoleErrors.length}`);
    if (domErrs.length > 0) domErrs.forEach(e => console.log(`     DOM: ${e}`));
    if (consoleErrors.length > 0) consoleErrors.forEach(e => console.log(`     CON: ${e}`));

    results.push({ name: templateName, cells, charts, domErrs, consoleErrors: [...consoleErrors] });
    await page.close();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=== SUMMARY ===');
  const passed = results.filter(r => r.domErrs.length === 0 && r.consoleErrors.length === 0).length;
  console.log(`${passed}/${results.length} clean | ${totalFail} with issues\n`);
  console.log('| Template | Cells | Charts | DOM Errors | Console Errors |');
  console.log('|---|---|---|---|---|');
  for (const r of results) {
    const de = r.domErrs.length > 0 ? r.domErrs.join(' // ').slice(0, 80) : '0';
    const ce = r.consoleErrors.length > 0 ? r.consoleErrors.join(' // ').slice(0, 80) : '0';
    console.log(`| ${r.name} | ${r.cells} | ${r.charts} | ${de} | ${ce} |`);
  }

  await browser.close();
  process.exit(totalFail > 0 ? 1 : 0);
})();
