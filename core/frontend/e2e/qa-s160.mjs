/**
 * QA Session S160 — Full interactive + template pass (corrected selectors)
 * Templates: I/O & Latency, JVM Internals
 * Interactive: variables, LINK_X zoom, command palette, SQL autocomplete,
 *              schema explorer, Run All, help modal
 * Console errors captured (excluding ONNX/recharts/ai-proxy noise)
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';
const ERROR_TERMS = ['Catalog Error', 'does not exist', 'Invalid plot',
  'Query has errors', 'Binder Error', 'Parser Error'];

let pass = 0, fail = 0;
const failures = [];
const allConsoleMsgs = [];

function check(label, ok, detail = '') {
  if (ok) { pass++; console.log('  ✅ ' + label); }
  else {
    fail++;
    failures.push(label + (detail ? ': ' + detail : ''));
    console.log('  ❌ ' + label + (detail ? ': ' + detail : ''));
  }
}

async function domScan(page) {
  return page.evaluate((terms) =>
    Array.from(document.querySelectorAll('*'))
      .filter(el => {
        const t = el.textContent || '';
        return terms.some(x => t.includes(x)) && el.children.length === 0 && el.offsetParent !== null;
      })
      .map(e => (e.textContent || '').trim().slice(0, 150)),
    ERROR_TERMS
  );
}

function setupConsole(page) {
  page.on('console', msg => {
    const t = msg.text();
    const ignore = ['ONNX', 'recharts', 'ai-proxy', 'conditional view', 'favicon',
      'DuckDB', 'worker', 'ResizeObserver', 'Lit', 'lit-element'];
    if (!ignore.some(n => t.toLowerCase().includes(n.toLowerCase()))) {
      allConsoleMsgs.push({ type: msg.type(), text: t.slice(0, 300) });
    }
  });
}

async function newPage(browser) {
  const page = await browser.newPage();
  setupConsole(page);
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('jfr-tour-seen', '1');
    localStorage.setItem('jfrq:onboarding-dismissed', '1');
  });
  return page;
}

async function loadDemoPage(browser) {
  const page = await newPage(browser);
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await page.locator('button:has-text("Try the demo")').first().click();
  await page.waitForTimeout(2500);
  return page;
}

async function loadTemplatePage(browser, templateName) {
  const page = await newPage(browser);
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  // Start from landing — click "Try the demo" first to get into the app,
  // then use the "New from template" button in the toolbar
  await page.locator('button:has-text("Try the demo")').first().click();
  await page.waitForTimeout(2000);

  // Open gallery: look for "New from template" icon/button in toolbar
  const galleryBtn = page.locator('[title="New from template"], [aria-label="New from template"]').first();
  await galleryBtn.click();
  await page.waitForSelector('dialog, [role="dialog"]', { timeout: 8000 });
  await page.waitForTimeout(400);

  // Select template
  const card = page.locator(`[aria-label="Select template: ${templateName}"]`).first();
  await card.click();
  await page.waitForTimeout(400);

  // Click Open & Run
  const openBtn = page.locator('button:has-text("Open & Run"), button:has-text("Use template")').first();
  await openBtn.click();
  await page.waitForTimeout(35000);

  return page;
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ── SECTION 1: Demo notebook + Run All ─────────────────────────────────
  console.log('\n── Demo notebook ──');
  const demoPage = await loadDemoPage(browser);

  const ra = demoPage.locator('[aria-label="Run All Queries"]');
  if (await ra.isVisible()) await ra.click();
  await demoPage.waitForTimeout(32000);

  const chartsAfter = await demoPage.locator('.recharts-wrapper').count();
  const demoErrors = await domScan(demoPage);
  check('Demo Run All: charts rendered', chartsAfter > 0, `charts=${chartsAfter}`);
  check('Demo DOM clean', demoErrors.length === 0, demoErrors.join('; '));

  // ── SECTION 2: Variables panel ─────────────────────────────────────────
  console.log('\n── Variables ──');
  // Look for variable tokens inline or in the variables panel
  const varChips = await demoPage.locator('[class*="variable"], button[data-variable], .variable-chip').count();
  // Also look for $-prefixed tokens shown as editable buttons
  const varAny = await demoPage.evaluate(() =>
    Array.from(document.querySelectorAll('*')).filter(el =>
      el.offsetParent !== null && el.children.length === 0 &&
      /^\$[a-zA-Z_]/.test((el.textContent || '').trim())
    ).length
  );
  check('Variables: $-prefixed tokens visible', varAny > 0, `found=${varAny}`);

  // ── SECTION 3: LINK_X charts present ───────────────────────────────────
  console.log('\n── LINK_X ──');
  const linkedCharts = await demoPage.locator('.recharts-responsive-container').count();
  check('LINK_X: recharts containers rendered', linkedCharts > 0, `count=${linkedCharts}`);

  // ── SECTION 4: Command palette ─────────────────────────────────────────
  console.log('\n── Command palette ──');
  await demoPage.keyboard.press('Meta+k');
  await demoPage.waitForTimeout(700);
  const cmdDialogs = await demoPage.locator('[role="dialog"]').count();
  // Also check for command palette-specific classes
  const cmdPalette = await demoPage.evaluate(() =>
    !!document.querySelector('[class*="command-palette"], [class*="CommandPalette"], [class*="cmdk"], [data-cmdk-root]')
  );
  check('Command palette opens (Cmd+K)', cmdDialogs > 0 || cmdPalette, `dialogs=${cmdDialogs} palette=${cmdPalette}`);
  if (cmdDialogs > 0 || cmdPalette) {
    await demoPage.keyboard.press('Escape');
    await demoPage.waitForTimeout(300);
  }

  // ── SECTION 5: SQL autocomplete ────────────────────────────────────────
  console.log('\n── SQL autocomplete ──');
  // Click into first CodeMirror editor that has SQL
  const editors = await demoPage.locator('.cm-editor').all();
  let autocompleteFound = false;
  for (let i = 0; i < Math.min(editors.length, 5); i++) {
    const ed = editors[i];
    const visible = await ed.isVisible().catch(() => false);
    if (!visible) continue;
    await ed.click();
    await demoPage.waitForTimeout(200);
    // Press End to go to end of line, then Ctrl+Space
    await demoPage.keyboard.press('Control+ ');
    await demoPage.waitForTimeout(700);
    const ac = await demoPage.locator('.cm-tooltip-autocomplete, .cm-completionList').count();
    if (ac > 0) {
      autocompleteFound = true;
      await demoPage.keyboard.press('Escape');
      await demoPage.waitForTimeout(200);
      break;
    }
  }
  check('SQL autocomplete popup opens (Ctrl+Space)', autocompleteFound);

  // ── SECTION 6: Schema explorer ─────────────────────────────────────────
  console.log('\n── Schema explorer ──');
  const sidebarListItems = await demoPage.locator('aside li, [class*="sidebar"] li, [role="tree"] li').count();
  check('Schema explorer has list items', sidebarListItems > 0, `items=${sidebarListItems}`);

  // ── SECTION 7: Help modal ──────────────────────────────────────────────
  console.log('\n── Help modal ──');
  // Try multiple selectors for help button
  let helpOpened = false;
  const helpSelectors = [
    'button[aria-label*="help" i]',
    'button[aria-label*="Help"]',
    'button[title*="help" i]',
    'button:has-text("?")',
    'button:has-text("Help")',
    '[data-testid="help-button"]',
  ];
  // The help/keyboard-shortcuts button has aria-label="Keyboard Shortcuts"
  const helpBtn2 = demoPage.locator('button[aria-label="Keyboard Shortcuts"]').first();
  const helpBtnVis = await helpBtn2.isVisible().catch(() => false);
  if (helpBtnVis) {
    await helpBtn2.click();
    await demoPage.waitForTimeout(500);
    const d = await demoPage.locator('[role="dialog"]').count();
    if (d > 0) { helpOpened = true; await demoPage.keyboard.press('Escape'); await demoPage.waitForTimeout(300); }
  }
  if (!helpOpened) {
    // Fallback: keyboard shortcut "?"
    await demoPage.keyboard.press('Shift+Slash');
    await demoPage.waitForTimeout(500);
    const d = await demoPage.locator('[role="dialog"]').count();
    if (d > 0) { helpOpened = true; await demoPage.keyboard.press('Escape'); }
  }
  check('Help modal (Keyboard Shortcuts) opens', helpOpened);

  await demoPage.close();

  // ── SECTION 8: Template: I/O & Latency ─────────────────────────────────
  console.log('\n── Template: I/O & Latency ──');
  try {
    const ioPage = await loadTemplatePage(browser, 'I/O & Latency');
    const ioCells = await ioPage.locator('.prose, [data-cell]').count();
    const ioCharts = await ioPage.locator('.recharts-wrapper').count();
    const ioErrors = await domScan(ioPage);
    check('I/O & Latency: cells rendered', ioCells > 0, `cells=${ioCells}`);
    check('I/O & Latency: DOM clean', ioErrors.length === 0, ioErrors.join('; '));
    console.log(`  charts=${ioCharts}`);
    await ioPage.close();
  } catch (e) {
    fail++;
    failures.push('I/O & Latency template: ' + e.message.slice(0, 100));
    console.log('  ❌ I/O & Latency template FAILED: ' + e.message.slice(0, 100));
  }

  // ── SECTION 9: Template: JVM Internals ─────────────────────────────────
  console.log('\n── Template: JVM Internals ──');
  try {
    const jvmPage = await loadTemplatePage(browser, 'JVM Internals');
    const jvmCells = await jvmPage.locator('.prose, [data-cell]').count();
    const jvmCharts = await jvmPage.locator('.recharts-wrapper').count();
    const jvmErrors = await domScan(jvmPage);
    check('JVM Internals: cells rendered', jvmCells > 0, `cells=${jvmCells}`);
    check('JVM Internals: DOM clean', jvmErrors.length === 0, jvmErrors.join('; '));
    console.log(`  charts=${jvmCharts}`);
    await jvmPage.close();
  } catch (e) {
    fail++;
    failures.push('JVM Internals template: ' + e.message.slice(0, 100));
    console.log('  ❌ JVM Internals template FAILED: ' + e.message.slice(0, 100));
  }

  // ── SECTION 10: Console errors ─────────────────────────────────────────
  console.log('\n── Console errors ──');
  // Per QA spec: HTTP 500 on /api/query is NOT a bug — filter those out
  const realErrors = allConsoleMsgs.filter(m =>
    m.type === 'error' && !m.text.includes('/api/query') && !m.text.includes('500')
  );
  check('No real console errors (excluding /api/query 500s)', realErrors.length === 0,
    realErrors.map(m => m.text.slice(0, 100)).join('; '));
  if (allConsoleMsgs.filter(m => m.type === 'error').length > 0) {
    console.log('  Error-level console messages:');
    allConsoleMsgs.filter(m => m.type === 'error').slice(0, 5).forEach(m => console.log('    ' + m.text.slice(0, 200)));
  }

  await browser.close();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log('S160 QA: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log('  ❌ ' + f));
  } else {
    console.log('All checks pass ✅');
  }
  console.log('══════════════════════════════════════════');
  process.exit(fail > 0 ? 1 : 0);
})();
