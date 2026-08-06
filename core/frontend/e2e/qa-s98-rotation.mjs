/**
 * S98 template rotation: I/O & Latency + JVM Internals + Threading & Contention
 * Full Run All + scroll + DOM scan per template.
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

async function waitForIdle(page, ms = 40000) {
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
      const t = el.textContent || '';
      return terms.some(x => t.includes(x)) && el.children.length === 0
        && el.offsetParent !== null && !el.closest('.cm-editor') && !el.closest('[class*="token"]');
    }).map(e => e.textContent.trim().slice(0, 150))
  , ERROR_TERMS);
}

const TEMPLATES = ['I/O & Latency', 'JVM Internals', 'Threading & Contention'];
const results = [];

(async () => {
  const browser = await chromium.launch({ headless: true });

  for (const name of TEMPLATES) {
    process.stdout.write(`  ${name} ... `);
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
            && !t.includes('Failed to load resource') && !t.includes('net::ERR_')) consoleErrs.push(t.slice(0, 120));
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

      // Open template gallery
      let gBtn = null;
      for (const sel of ['[title="New from template"]', '[aria-label="New from template"]']) {
        gBtn = await page.$(sel);
        if (gBtn) break;
      }
      await gBtn.click();
      await page.waitForSelector('[role="dialog"], dialog', { timeout: 8000 });
      await page.waitForTimeout(400);

      const tmpl = await page.$(`button[aria-label="Select template: ${name}"]`)
                || await page.$(`button:has-text("${name}")`);
      if (!tmpl) throw new Error(`Template not found: ${name}`);
      await tmpl.click();
      await page.waitForTimeout(300);
      for (const sel of ['button:has-text("Open & Run")', 'button:has-text("Use template")']) {
        const btn = await page.$(sel);
        if (btn && !await btn.getAttribute('disabled')) { await btn.click(); break; }
      }
      await page.waitForTimeout(800);
      await waitForIdle(page, 40000);

      // Full scroll
      await page.evaluate(() => { (document.querySelector('main') || document.documentElement).scrollTop = 99999; });
      await page.waitForTimeout(1500);
      await page.evaluate(() => { (document.querySelector('main') || document.documentElement).scrollTop = 0; });
      await page.waitForTimeout(400);

      const errs = await checkErrors(page);
      const cells = await page.evaluate(() => document.querySelectorAll('[data-cell-id]').length);
      const svgs = await page.evaluate(() => document.querySelectorAll('svg').length);
      const tables = await page.evaluate(() => document.querySelectorAll('table').length);

      const ok = errs.length === 0 && consoleErrs.length === 0;
      const note = `(${cells} cells, ${svgs} svgs, ${tables} tables)`;
      if (ok) {
        console.log(`✅ PASS ${note}`);
      } else {
        const issues = [...errs, ...consoleErrs];
        console.log(`❌ FAIL ${note}: ${issues.join('; ')}`);
      }
      results.push({ name, ok, cells, svgs, tables, issues: ok ? [] : [...errs, ...consoleErrs] });
    } catch(e) {
      console.log(`💥 ERROR: ${e.message}`);
      results.push({ name, ok: false, issues: [e.message] });
    } finally {
      await ctx.close();
    }
  }

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length > 0) {
    failed.forEach(r => console.log(`  ❌ ${r.name}: ${r.issues.join('; ')}`));
    process.exit(1);
  }
})();
