/**
 * QA Session S168 — I/O & Latency + JVM Internals
 * Interactive: variables+popup, LINK_X zoom, Collapse/Expand All, command palette,
 *              SQL autocomplete, schema explorer, Run All, help modal
 * Console errors captured
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
      'DuckDB', 'worker', 'ResizeObserver', 'Lit', 'react', 'React', 'vite', 'timestamp'];
    if (!ignore.some(n => t.toLowerCase().includes(n.toLowerCase()))) {
      allConsoleMsgs.push({ type: msg.type(), text: t.slice(0, 300) });
    }
  });
}

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  setupConsole(page);
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('jfr-tour-seen', '1');
    localStorage.setItem('jfrq:onboarding-dismissed', '1');
  });
  return page;
}

async function loadDemoAndRunAll(browser) {
  const page = await newPage(browser);
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await page.locator('button:has-text("Try the demo")').first().click();
  await page.waitForTimeout(2500);
  const ra = page.locator('[aria-label="Run All Queries"]');
  if (await ra.isVisible()) await ra.click();
  await page.waitForTimeout(32000);
  return page;
}

async function loadTemplate(browser, templateName) {
  const page = await newPage(browser);
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await page.locator('button:has-text("Try the demo")').first().click();
  await page.waitForTimeout(2000);
  const galleryBtn = page.locator('[title="New from template"], [aria-label="New from template"]').first();
  await galleryBtn.click();
  await page.waitForSelector('dialog, [role="dialog"]', { timeout: 8000 });
  await page.waitForTimeout(400);
  await page.locator(`[aria-label="Select template: ${templateName}"]`).first().click();
  await page.waitForTimeout(400);
  await page.locator('button:has-text("Open & Run"), button:has-text("Use template")').first().click();
  await page.waitForTimeout(35000);
  return page;
}

async function tryLinkXZoom(page) {
  const numCharts = await page.locator('.recharts-responsive-container').count();
  for (let i = 0; i < numCharts; i++) {
    await page.evaluate((idx) => {
      const c = document.querySelectorAll('.recharts-responsive-container')[idx];
      if (c) c.scrollIntoView({ block: 'center' });
    }, i);
    await page.waitForTimeout(400);
    const fired = await page.evaluate((idx) => {
      const c = document.querySelectorAll('.recharts-responsive-container')[idx];
      if (!c) return false;
      const rect = c.getBoundingClientRect();
      if (rect.y < 0 || rect.y > 850) return false;
      let el = c.parentElement;
      for (let j = 0; j < 10; j++) {
        if (!el) break;
        if ((el.className || '').includes('group')) {
          const r = el.getBoundingClientRect();
          el.dispatchEvent(new WheelEvent('wheel', {
            deltaY: -500, shiftKey: true,
            clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
            bubbles: true, cancelable: true,
          }));
          return true;
        }
        el = el.parentElement;
      }
      return false;
    }, i);
    if (fired) {
      await page.waitForTimeout(700);
      const resets = await page.locator('[aria-label="Reset zoom"]').count();
      if (resets > 0) {
        await page.locator('[aria-label="Reset zoom"]').first().click();
        await page.waitForTimeout(400);
        return true;
      }
    }
  }
  return false;
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ── SECTION 1: Demo notebook ────────────────────────────────────────────
  console.log('\n── Demo notebook ──');
  const demoPage = await loadDemoAndRunAll(browser);
  const demoCharts = await demoPage.locator('.recharts-wrapper').count();
  const demoErrors = await domScan(demoPage);
  check('Demo: charts rendered after Run All', demoCharts > 0, `charts=${demoCharts}`);
  check('Demo: DOM clean', demoErrors.length === 0, demoErrors.join('; '));

  // ── SECTION 2: Variables ────────────────────────────────────────────────
  console.log('\n── Variables ──');
  const varTokens = await demoPage.evaluate(() =>
    Array.from(document.querySelectorAll('*')).filter(el =>
      el.offsetParent !== null && el.children.length === 0 &&
      /^\$[a-zA-Z_]/.test((el.textContent || '').trim())
    ).length
  );
  check('Variables: $-prefixed tokens visible', varTokens > 0, `found=${varTokens}`);

  const varBtn = demoPage.locator('button[aria-label*="$session_start"]').first();
  if (await varBtn.isVisible().catch(() => false)) {
    await varBtn.click();
    await demoPage.waitForTimeout(500);
    const popup = await demoPage.locator('[role="dialog"], input[type="datetime-local"], [class*="popover"]').count();
    check('Variables: click opens editor', popup > 0, `popup_els=${popup}`);
    await demoPage.keyboard.press('Escape');
    await demoPage.waitForTimeout(300);
  } else {
    check('Variables: click opens editor', false, 'button not found');
  }

  // ── SECTION 3: LINK_X zoom ──────────────────────────────────────────────
  console.log('\n── LINK_X zoom ──');
  const zoomResult = await tryLinkXZoom(demoPage);
  check('LINK_X zoom: reset button appeared', zoomResult);

  // ── SECTION 4: Collapse/Expand All ─────────────────────────────────────
  console.log('\n── Collapse/Expand All ──');
  const collapseBtn = demoPage.locator('[aria-label="Collapse All"]').first();
  if (await collapseBtn.isVisible().catch(() => false)) {
    await collapseBtn.click();
    await demoPage.waitForTimeout(600);
    const chartsAfterCollapse = await demoPage.locator('.recharts-wrapper').count();
    check('Collapse All: charts hidden', chartsAfterCollapse === 0, `charts=${chartsAfterCollapse}`);
    const expandBtn = demoPage.locator('[aria-label="Expand All"]').first();
    if (await expandBtn.isVisible().catch(() => false)) {
      await expandBtn.click();
      await demoPage.waitForTimeout(600);
      const chartsAfterExpand = await demoPage.locator('.recharts-wrapper').count();
      check('Expand All: charts restored', chartsAfterExpand > 0, `charts=${chartsAfterExpand}`);
    } else {
      check('Expand All: charts restored', false, 'Expand All button not found');
    }
  } else {
    check('Collapse All: charts hidden', false, 'Collapse All button not found');
    check('Expand All: charts restored', false, 'skipped');
  }

  // ── SECTION 5: Command palette ──────────────────────────────────────────
  console.log('\n── Command palette ──');
  await demoPage.keyboard.press('Meta+k');
  await demoPage.waitForTimeout(700);
  const cmdVisible = await demoPage.evaluate(() =>
    !!document.querySelector('[role="dialog"], [data-cmdk-root], [class*="command-palette"]')
  );
  check('Command palette opens (Cmd+K)', cmdVisible);
  if (cmdVisible) {
    await demoPage.keyboard.press('Escape');
    await demoPage.waitForTimeout(300);
  }

  // ── SECTION 6: SQL autocomplete ─────────────────────────────────────────
  console.log('\n── SQL autocomplete ──');
  let acFound = false, acItems = 0;
  for (const ed of await demoPage.locator('.cm-editor').all()) {
    if (!await ed.isVisible().catch(() => false)) continue;
    await ed.click();
    await demoPage.waitForTimeout(200);
    await demoPage.keyboard.press('Control+ ');
    await demoPage.waitForTimeout(700);
    const ac = await demoPage.locator('.cm-tooltip-autocomplete, .cm-completionList').count();
    if (ac > 0) {
      acFound = true;
      acItems = await demoPage.locator('.cm-completionList li, .cm-tooltip-autocomplete li').count();
      await demoPage.keyboard.press('Escape');
      await demoPage.waitForTimeout(200);
      break;
    }
  }
  check('SQL autocomplete opens (Ctrl+Space)', acFound, `items=${acItems}`);

  // ── SECTION 7: Schema explorer ──────────────────────────────────────────
  console.log('\n── Schema explorer ──');
  const sidebarItems = await demoPage.locator('aside li, [class*="sidebar"] li, [role="tree"] li').count();
  check('Schema explorer: has list items', sidebarItems > 0, `items=${sidebarItems}`);

  // ── SECTION 8: Help modal ──────────────────────────────────────────────
  console.log('\n── Help modal ──');
  const kbBtn = demoPage.locator('button[aria-label="Keyboard Shortcuts"]').first();
  let helpOpened = false;
  if (await kbBtn.isVisible().catch(() => false)) {
    await kbBtn.click();
    await demoPage.waitForTimeout(500);
    const d = await demoPage.locator('[role="dialog"]').count();
    if (d > 0) {
      helpOpened = true;
      const txt = await demoPage.locator('[role="dialog"]').first().textContent().catch(() => '');
      check('Help modal: has shortcut content', txt.includes('⌘') || txt.includes('Ctrl'), txt.slice(0, 60));
      await demoPage.keyboard.press('Escape');
      await demoPage.waitForTimeout(300);
    }
  }
  check('Help modal opens', helpOpened);

  await demoPage.close();

  // ── SECTION 9: Template: I/O & Latency ──────────────────────────────────
  console.log('\n── Template: I/O & Latency ──');
  try {
    const ioPage = await loadTemplate(browser, 'I/O & Latency');
    const ioCells = await ioPage.locator('.prose, [data-cell]').count();
    const ioCharts = await ioPage.locator('.recharts-wrapper').count();
    const ioErrors = await domScan(ioPage);
    check('I/O & Latency: cells rendered', ioCells > 0, `cells=${ioCells}`);
    check('I/O & Latency: DOM clean', ioErrors.length === 0, ioErrors.join('; '));
    console.log(`  charts=${ioCharts}`);
    if (ioCharts > 0) {
      const zoomed = await tryLinkXZoom(ioPage);
      check('I/O & Latency: LINK_X zoom works', zoomed);
    }
    await ioPage.close();
  } catch (e) {
    fail++; failures.push('I/O & Latency: ' + e.message.slice(0, 120));
    console.log('  ❌ I/O & Latency FAILED: ' + e.message.slice(0, 120));
  }

  // ── SECTION 10: Template: JVM Internals ─────────────────────────────────
  console.log('\n── Template: JVM Internals ──');
  try {
    const jvmPage = await loadTemplate(browser, 'JVM Internals');
    const jvmCells = await jvmPage.locator('.prose, [data-cell]').count();
    const jvmCharts = await jvmPage.locator('.recharts-wrapper').count();
    const jvmErrors = await domScan(jvmPage);
    check('JVM Internals: cells rendered', jvmCells > 0, `cells=${jvmCells}`);
    check('JVM Internals: DOM clean', jvmErrors.length === 0, jvmErrors.join('; '));
    console.log(`  charts=${jvmCharts}`);
    if (jvmCharts > 0) {
      const zoomed = await tryLinkXZoom(jvmPage);
      check('JVM Internals: LINK_X zoom works', zoomed);
    }
    await jvmPage.close();
  } catch (e) {
    fail++; failures.push('JVM Internals: ' + e.message.slice(0, 120));
    console.log('  ❌ JVM Internals FAILED: ' + e.message.slice(0, 120));
  }

  // ── SECTION 11: Console errors ───────────────────────────────────────────
  console.log('\n── Console errors ──');
  const realErrors = allConsoleMsgs.filter(m =>
    m.type === 'error' && !m.text.includes('/api/query') && !m.text.includes('500')
  );
  check('No real console errors (excl. /api/query 500s)', realErrors.length === 0,
    realErrors.map(m => m.text.slice(0, 120)).join('; '));
  if (allConsoleMsgs.filter(m => m.type === 'error').length > 0) {
    console.log('  Error-level messages:');
    allConsoleMsgs.filter(m => m.type === 'error').slice(0, 5)
      .forEach(m => console.log('    ' + m.text.slice(0, 200)));
  }

  await browser.close();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log('S168 QA: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log('  ❌ ' + f));
  } else {
    console.log('All checks pass ✅');
  }
  console.log('══════════════════════════════════════════');
  process.exit(fail > 0 ? 1 : 0);
})();
