/**
 * QA Session S161 — demo + Heap Allocation + Memory Leak Detection + interactive features
 * Rotated templates: Heap Allocation, Memory Leak Detection
 * Interactive: variables, LINK_X, command palette, SQL autocomplete,
 *              schema explorer, Run All, help modal (Keyboard Shortcuts)
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
      'DuckDB', 'worker', 'ResizeObserver', 'Lit', 'react', 'React', 'vite'];
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
  // Open template gallery
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

  // Click a variable token to open editor popup
  const varBtn = demoPage.locator('button[title*="$session_start"], button[aria-label*="$session_start"]').first();
  const varBtnVisible = await varBtn.isVisible().catch(() => false);
  if (varBtnVisible) {
    await varBtn.click();
    await demoPage.waitForTimeout(500);
    // Popup/dropdown should appear
    const popup = await demoPage.locator('[role="dialog"], [class*="popover"], [class*="dropdown"], input[type="datetime-local"]').count();
    check('Variables: click opens editor popup', popup > 0, `popup_elements=${popup}`);
    await demoPage.keyboard.press('Escape');
    await demoPage.waitForTimeout(200);
  } else {
    check('Variables: click opens editor popup', false, 'button not found');
  }

  // ── SECTION 3: LINK_X zoom ──────────────────────────────────────────────
  console.log('\n── LINK_X zoom ──');
  const linkedContainers = await demoPage.locator('.recharts-responsive-container').count();
  check('LINK_X: recharts containers rendered', linkedContainers > 0, `count=${linkedContainers}`);
  // LINK_X zoom: scroll each chart into viewport, find the one with a .group wrapper,
  // dispatch a Shift+WheelEvent, and confirm the reset button appears.
  let zoomResetFound = false;
  const numCharts = linkedContainers;
  for (let i = 0; i < numCharts; i++) {
    // Scroll this chart into view
    await demoPage.evaluate((idx) => {
      const charts = document.querySelectorAll('.recharts-responsive-container');
      if (charts[idx]) charts[idx].scrollIntoView({ block: 'center' });
    }, i);
    await demoPage.waitForTimeout(400);
    // Dispatch wheel on the .group wrapper (ZoomableWrapper div)
    const fired = await demoPage.evaluate((idx) => {
      const charts = document.querySelectorAll('.recharts-responsive-container');
      const c = charts[idx];
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
      await demoPage.waitForTimeout(700);
      const resets = await demoPage.locator('[aria-label="Reset zoom"]').count();
      if (resets > 0) {
        zoomResetFound = true;
        await demoPage.locator('[aria-label="Reset zoom"]').first().click();
        await demoPage.waitForTimeout(400);
        break;
      }
    }
  }
  check('LINK_X zoom: reset button appeared after Shift+scroll', zoomResetFound);

  // ── SECTION 4: Command palette ──────────────────────────────────────────
  console.log('\n── Command palette ──');
  await demoPage.keyboard.press('Meta+k');
  await demoPage.waitForTimeout(700);
  const cmdDialogs = await demoPage.locator('[role="dialog"]').count();
  const cmdPalette = await demoPage.evaluate(() =>
    !!document.querySelector('[class*="command-palette"], [class*="CommandPalette"], [data-cmdk-root]')
  );
  check('Command palette opens (Cmd+K)', cmdDialogs > 0 || cmdPalette, `dialogs=${cmdDialogs}`);
  if (cmdDialogs > 0 || cmdPalette) {
    await demoPage.keyboard.press('Escape');
    await demoPage.waitForTimeout(300);
  }

  // ── SECTION 5: SQL autocomplete ─────────────────────────────────────────
  console.log('\n── SQL autocomplete ──');
  let autocompleteFound = false;
  const editors = await demoPage.locator('.cm-editor').all();
  for (let i = 0; i < Math.min(editors.length, 6); i++) {
    const ed = editors[i];
    if (!await ed.isVisible().catch(() => false)) continue;
    await ed.click();
    await demoPage.waitForTimeout(200);
    await demoPage.keyboard.press('Control+ ');
    await demoPage.waitForTimeout(700);
    const ac = await demoPage.locator('.cm-tooltip-autocomplete, .cm-completionList').count();
    if (ac > 0) {
      autocompleteFound = true;
      const items = await demoPage.locator('.cm-completionList li, .cm-tooltip-autocomplete li').count();
      console.log('  Autocomplete items:', items);
      await demoPage.keyboard.press('Escape');
      await demoPage.waitForTimeout(200);
      break;
    }
  }
  check('SQL autocomplete opens (Ctrl+Space)', autocompleteFound);

  // ── SECTION 6: Schema explorer ──────────────────────────────────────────
  console.log('\n── Schema explorer ──');
  const sidebarItems = await demoPage.locator('aside li, [class*="sidebar"] li, [role="tree"] li').count();
  check('Schema explorer: has list items', sidebarItems > 0, `items=${sidebarItems}`);

  // ── SECTION 7: Help modal (Keyboard Shortcuts) ──────────────────────────
  console.log('\n── Help modal ──');
  const kbBtn = demoPage.locator('button[aria-label="Keyboard Shortcuts"]').first();
  const kbVis = await kbBtn.isVisible().catch(() => false);
  let helpOpened = false;
  if (kbVis) {
    await kbBtn.click();
    await demoPage.waitForTimeout(500);
    const d = await demoPage.locator('[role="dialog"]').count();
    if (d > 0) {
      helpOpened = true;
      // Verify it has keyboard shortcut content
      const content = await demoPage.locator('[role="dialog"]').first().textContent().catch(() => '');
      check('Help modal: shows keyboard shortcut content', content.includes('⌘') || content.includes('Ctrl'), 'content preview: ' + content.slice(0, 80));
      await demoPage.keyboard.press('Escape');
      await demoPage.waitForTimeout(300);
    }
  }
  check('Help modal opens (Keyboard Shortcuts button)', helpOpened);

  await demoPage.close();

  // ── SECTION 8: Heap Allocation template ─────────────────────────────────
  console.log('\n── Template: Heap Allocation ──');
  try {
    const heapPage = await loadTemplate(browser, 'Heap Allocation');
    const heapCells = await heapPage.locator('.prose, [data-cell]').count();
    const heapCharts = await heapPage.locator('.recharts-wrapper').count();
    const heapErrors = await domScan(heapPage);
    check('Heap Allocation: cells rendered', heapCells > 0, `cells=${heapCells}`);
    check('Heap Allocation: DOM clean', heapErrors.length === 0, heapErrors.join('; '));
    console.log(`  charts=${heapCharts}`);
    await heapPage.close();
  } catch (e) {
    fail++; failures.push('Heap Allocation: ' + e.message.slice(0, 120));
    console.log('  ❌ Heap Allocation FAILED: ' + e.message.slice(0, 120));
  }

  // ── SECTION 9: Memory Leak Detection template ────────────────────────────
  console.log('\n── Template: Memory Leak Detection ──');
  try {
    const memPage = await loadTemplate(browser, 'Memory Leak Detection');
    const memCells = await memPage.locator('.prose, [data-cell]').count();
    const memCharts = await memPage.locator('.recharts-wrapper').count();
    const memErrors = await domScan(memPage);
    check('Memory Leak Detection: cells rendered', memCells > 0, `cells=${memCells}`);
    check('Memory Leak Detection: DOM clean', memErrors.length === 0, memErrors.join('; '));
    console.log(`  charts=${memCharts}`);
    await memPage.close();
  } catch (e) {
    fail++; failures.push('Memory Leak Detection: ' + e.message.slice(0, 120));
    console.log('  ❌ Memory Leak Detection FAILED: ' + e.message.slice(0, 120));
  }

  // ── SECTION 10: Console errors ───────────────────────────────────────────
  console.log('\n── Console errors ──');
  // /api/query 500s are NOT bugs per QA spec
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
  console.log('S161 QA: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log('  ❌ ' + f));
  } else {
    console.log('All checks pass ✅');
  }
  console.log('══════════════════════════════════════════');
  process.exit(fail > 0 ? 1 : 0);
})();
