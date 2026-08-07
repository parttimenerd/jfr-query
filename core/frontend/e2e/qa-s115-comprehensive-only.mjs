/**
 * S115 isolated test: Comprehensive Feature Test template
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

  // Open gallery
  let btn = null;
  for (const sel of ['[title="New from template"]', '[aria-label="New from template"]']) {
    btn = await page.$(sel);
    if (btn) break;
  }
  if (!btn) { console.error('gallery button not found'); process.exit(1); }
  await btn.click();
  await page.waitForSelector('dialog, [role="dialog"]', { timeout: 5000 });
  await page.waitForTimeout(500);

  // List all template buttons in dialog
  const names = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button[aria-label^="Select template:"]'))
      .map(b => b.getAttribute('aria-label'))
  );
  console.log('Templates in gallery:', names);

  const tmpl = await page.$('button[aria-label="Select template: Comprehensive Feature Test"]')
            || await page.$('button:has-text("Comprehensive Feature Test")');
  if (!tmpl) {
    console.error('Template not found — dumping all dialog buttons:');
    const btns = await page.evaluate(() =>
      Array.from(document.querySelectorAll('dialog button, [role="dialog"] button'))
        .map(b => b.getAttribute('aria-label') || b.textContent?.trim().slice(0, 60))
        .filter(Boolean)
    );
    console.log(btns);
    process.exit(1);
  }
  await tmpl.click();
  await page.waitForTimeout(300);
  for (const sel of ['button:has-text("Open & Run")', 'button:has-text("Use template")']) {
    const b = await page.$(sel);
    if (b && !await b.getAttribute('disabled')) { await b.click(); break; }
  }
  await page.waitForTimeout(1000);
  const ok = await waitForIdle(page, 60000);
  const cells = await page.evaluate(() => document.querySelectorAll('[data-cell-status]').length);
  const svgs = await page.evaluate(() => document.querySelectorAll('svg').length);
  const errors = await domScan(page);
  console.log(`Comprehensive Feature Test: ok=${ok}, cells=${cells}, svgs=${svgs}`);
  if (errors.length > 0) console.error('DOM errors:', errors);
  else console.log('0 DOM errors');
  if (consoleErrs.length > 0) console.error('Console errors:', consoleErrs);
  else console.log('0 console errors');

  await ctx.close();
  await browser.close();
})();
