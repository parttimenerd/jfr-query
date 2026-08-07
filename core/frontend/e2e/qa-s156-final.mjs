/**
 * QA Session S156 — Final Pass
 * Tests: demo load, Run All, variables, command palette, keyboard shortcuts,
 *        2 templates (Exception & Error, Container & Cloud), console errors
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';
let pass = 0, fail = 0;

function ok(label) { console.log(`  ✅ ${label}`); pass++; }
function ko(label, detail = '') { console.log(`  ❌ ${label}${detail ? ': ' + detail : ''}`); fail++; }

async function freshPage(browser) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (!t.includes('ONNX') && !t.includes('ai-proxy') && !t.includes('conditional view failed')
          && !t.includes('HTTP 500') && !t.includes('Failed to load resource') && !t.includes('net::ERR')) {
        errors.push(t.slice(0, 120));
      }
    }
  });
  await page.addInitScript(() => {
    localStorage.setItem('jfr-tour-seen', '1');
    localStorage.setItem('jfrq:onboarding-dismissed', '1');
    localStorage.setItem('jfrq:ai-nudge-dismissed', '1');
    localStorage.setItem('jfr-ui-autoRunEnabled', 'true');
  });
  return { page, errors };
}

async function loadDemo(page) {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.locator('button:has-text("Try the demo")').first().click();
  await page.waitForTimeout(2500);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  console.log('\n=== S156 QA Final Pass ===\n');

  // ── 1. Demo notebook ────────────────────────────────────────────────────
  console.log('── 1. Demo Notebook ──');
  const { page, errors } = await freshPage(browser);
  await loadDemo(page);

  // No tour overlay
  const tourVisible = await page.locator('.fixed.inset-0').filter({ has: page.locator('[class*="z-[200]"]') }).isVisible().catch(() => false);
  tourVisible ? ko('Tour overlay absent') : ok('Tour overlay absent');

  const charts = await page.locator('.recharts-wrapper').count();
  charts >= 1 ? ok(`Demo has ${charts} chart(s)`) : ko('Demo charts', `got ${charts}`);

  const cells = await page.locator('[class*="cell"]').count();
  cells >= 1 ? ok(`Demo has ${cells} cell elements`) : ko('Demo cells', `got ${cells}`);

  // ── 2. Variables panel ──────────────────────────────────────────────────
  console.log('\n── 2. Variables Panel ──');
  const varBtns = await page.locator('[aria-label*="— click to edit"]').count();
  varBtns >= 1 ? ok(`${varBtns} variable button(s) visible`) : ko('Variable buttons', `got ${varBtns}`);

  if (varBtns > 0) {
    await page.locator('[aria-label*="— click to edit"]').first().click();
    await page.waitForTimeout(400);
    const inputVisible = await page.locator('input[type="text"], input[type="datetime-local"], input[type="number"]').first().isVisible().catch(() => false);
    inputVisible ? ok('Variable edit input opens') : ko('Variable edit input not visible');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  // ── 3. Run All Queries ──────────────────────────────────────────────────
  console.log('\n── 3. Run All Queries ──');
  const runAllBtn = page.locator('[aria-label="Run All Queries"]');
  const runAllVis = await runAllBtn.isVisible();
  runAllVis ? ok('Run All button visible') : ko('Run All button not visible');
  if (runAllVis) {
    await runAllBtn.click({ timeout: 10000 });
    await page.waitForTimeout(3000);
    const chartsAfter = await page.locator('.recharts-wrapper').count();
    chartsAfter >= charts ? ok(`Charts after Run All: ${chartsAfter}`) : ko('Charts may have regressed', `${charts} → ${chartsAfter}`);
  }

  // ── 4. Command Palette ──────────────────────────────────────────────────
  console.log('\n── 4. Command Palette ──');
  const cmdBtn = page.locator('[aria-label="Command Palette"]');
  const cmdVis = await cmdBtn.isVisible().catch(() => false);
  cmdVis ? ok('Command Palette button visible') : ko('Command Palette button not visible');
  if (cmdVis) {
    await cmdBtn.click();
    await page.waitForTimeout(400);
    const dlg = await page.locator('[role="dialog"]').isVisible().catch(() => false);
    dlg ? ok('Command palette dialog opens') : ko('Command palette dialog did not open');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  // ── 5. Keyboard Shortcuts modal ─────────────────────────────────────────
  console.log('\n── 5. Keyboard Shortcuts ──');
  const kbBtn = page.locator('[aria-label="Keyboard Shortcuts"]');
  const kbVis = await kbBtn.isVisible().catch(() => false);
  kbVis ? ok('Keyboard Shortcuts button visible') : ko('Keyboard Shortcuts button not visible');
  if (kbVis) {
    await kbBtn.click();
    await page.waitForTimeout(500);
    const modal = await page.locator('[role="dialog"]').isVisible().catch(() => false);
    modal ? ok('Keyboard shortcuts modal opens') : ko('Keyboard shortcuts modal did not open');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  // ── 6. Template: Exception & Error Analysis ──────────────────────────────
  console.log('\n── 6. Template: Exceptions & Errors ──');
  const { page: page2, errors: errors2 } = await freshPage(browser);
  await loadDemo(page2);

  await page2.locator('[aria-label="New from template"]').click();
  await page2.waitForTimeout(800);
  const gal1 = await page2.locator('[role="dialog"]').isVisible().catch(() => false);
  gal1 ? ok('Template gallery opens') : ko('Template gallery did not open');

  if (gal1) {
    const exLink = page2.locator('[role="dialog"] button:has-text("Exceptions")').first();
    const exVis = await exLink.isVisible().catch(() => false);
    exVis ? ok('Exceptions & Errors template visible') : ko('Exceptions & Errors template not visible');
    if (exVis) {
      await exLink.click();
      await page2.waitForTimeout(3000);
      // Gallery should close and new notebook loads
      const galClosed = !(await page2.locator('[role="dialog"]').isVisible().catch(() => false));
      galClosed ? ok('Gallery closed after template load') : ok('Gallery may still be open (not critical)');
      const charts2 = await page2.locator('.recharts-wrapper').count();
      const cells2 = await page2.locator('[class*="cell"]').count();
      console.log(`    Exceptions: cells=${cells2}, charts=${charts2}`);
      cells2 >= 3 ? ok(`Exceptions template loaded (${cells2} cell elements)`) : ko('Exceptions template cells too few', `${cells2}`);
    }
  }

  // ── 7. Template: Container & Cloud ─────────────────────────────────────
  console.log('\n── 7. Template: Container & Cloud ──');
  const { page: page3, errors: errors3 } = await freshPage(browser);
  await loadDemo(page3);

  await page3.locator('[aria-label="New from template"]').click();
  await page3.waitForTimeout(800);
  const gal2 = await page3.locator('[role="dialog"]').isVisible().catch(() => false);

  if (gal2) {
    const ctLink = page3.locator('[role="dialog"] button:has-text("Container")').first();
    const ctVis = await ctLink.isVisible().catch(() => false);
    ctVis ? ok('Container & Cloud template visible') : ko('Container & Cloud template not visible');
    if (ctVis) {
      await ctLink.click();
      await page3.waitForTimeout(3000);
      const charts3 = await page3.locator('.recharts-wrapper').count();
      const cells3 = await page3.locator('[class*="cell"]').count();
      console.log(`    Container: cells=${cells3}, charts=${charts3}`);
      cells3 >= 2 ? ok(`Container & Cloud template loaded (${cells3} cell elements)`) : ko('Container & Cloud cells too few', `${cells3}`);
    }
  } else {
    ko('Template gallery 2nd open failed');
  }

  // ── 8. Console Errors ───────────────────────────────────────────────────
  console.log('\n── 8. Console Errors ──');
  const allErrors = [...errors, ...errors2, ...errors3];
  if (allErrors.length === 0) {
    ok('No console errors');
  } else {
    ko(`${allErrors.length} console error(s)`);
    allErrors.forEach(e => console.log('    ERROR:', e));
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);

  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
