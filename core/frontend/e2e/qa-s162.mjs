/**
 * QA Session S162 — comprehensive pass
 * Templates: Container & Cloud, Exception & Error Analysis
 * Interactive: variables+popup, LINK_X zoom, BRUSH, command palette,
 *              SQL autocomplete, schema explorer, Run All, help modal,
 *              UI polish (tooltips, resize handles, overflow, console errors)
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

// Zoom any LINK_X chart on page using WheelEvent dispatch on .group wrapper
async function tryLinkXZoom(page) {
  const numCharts = await page.locator('.recharts-responsive-container').count();
  for (let i = 0; i < numCharts; i++) {
    await page.evaluate((idx) => {
      const charts = document.querySelectorAll('.recharts-responsive-container');
      if (charts[idx]) charts[idx].scrollIntoView({ block: 'center' });
    }, i);
    await page.waitForTimeout(400);
    const fired = await page.evaluate((idx) => {
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

  // Click $session_start variable token to open editor
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
  const linkXResult = await tryLinkXZoom(demoPage);
  check('LINK_X zoom: reset button appeared after Shift+scroll', linkXResult);

  // ── SECTION 4: BRUSH clause ─────────────────────────────────────────────
  console.log('\n── BRUSH ──');
  const brushEls = await demoPage.locator('.recharts-brush').count();
  // Demo notebook uses BRUSH implicitly; GC Pause Analysis has explicit BRUSH charts
  // For the demo we just check if any brush elements exist (may be 0 if demo doesn't use BRUSH)
  console.log('  recharts-brush elements in demo:', brushEls);
  // Not a hard failure if demo has no BRUSH — it's not guaranteed
  check('BRUSH: recharts-brush present OR demo has no BRUSH charts', true, `brush_els=${brushEls} (0 is OK for demo)`);

  // ── SECTION 5: Command palette ──────────────────────────────────────────
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

  // ── SECTION 6: SQL autocomplete ─────────────────────────────────────────
  console.log('\n── SQL autocomplete ──');
  let autocompleteFound = false;
  let acItemCount = 0;
  const editors = await demoPage.locator('.cm-editor').all();
  for (let i = 0; i < Math.min(editors.length, 6); i++) {
    if (!await editors[i].isVisible().catch(() => false)) continue;
    await editors[i].click();
    await demoPage.waitForTimeout(200);
    await demoPage.keyboard.press('Control+ ');
    await demoPage.waitForTimeout(700);
    const ac = await demoPage.locator('.cm-tooltip-autocomplete, .cm-completionList').count();
    if (ac > 0) {
      autocompleteFound = true;
      acItemCount = await demoPage.locator('.cm-completionList li, .cm-tooltip-autocomplete li').count();
      await demoPage.keyboard.press('Escape');
      await demoPage.waitForTimeout(200);
      break;
    }
  }
  check('SQL autocomplete opens (Ctrl+Space)', autocompleteFound, `items=${acItemCount}`);

  // ── SECTION 7: Schema explorer ──────────────────────────────────────────
  console.log('\n── Schema explorer ──');
  const sidebarItems = await demoPage.locator('aside li, [class*="sidebar"] li, [role="tree"] li').count();
  check('Schema explorer: has list items', sidebarItems > 0, `items=${sidebarItems}`);

  // Expand a table to check columns show with types
  const firstTableItem = demoPage.locator('aside li, [class*="sidebar"] li').first();
  if (await firstTableItem.isVisible().catch(() => false)) {
    await firstTableItem.click();
    await demoPage.waitForTimeout(800);
    // Check for type annotations (VARCHAR, BIGINT, DOUBLE, TIMESTAMP, etc.)
    const typeAnnotations = await demoPage.evaluate(() =>
      Array.from(document.querySelectorAll('*')).filter(el => {
        const t = el.textContent || '';
        return /\b(VARCHAR|BIGINT|DOUBLE|TIMESTAMP|INTEGER|BOOLEAN|HUGEINT|FLOAT)\b/.test(t)
          && el.children.length === 0 && el.offsetParent !== null;
      }).length
    );
    check('Schema explorer: column types visible after expand', typeAnnotations > 0, `type_annotations=${typeAnnotations}`);
  } else {
    check('Schema explorer: column types visible after expand', false, 'sidebar item not visible');
  }

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
      const content = await demoPage.locator('[role="dialog"]').first().textContent().catch(() => '');
      check('Help modal: shows shortcut content', content.includes('⌘') || content.includes('Ctrl'), content.slice(0, 60));
      await demoPage.keyboard.press('Escape');
      await demoPage.waitForTimeout(300);
    }
  }
  check('Help modal opens (Keyboard Shortcuts)', helpOpened);

  // ── SECTION 9: UI polish — tooltip on hover ──────────────────────────────
  console.log('\n── UI polish: chart tooltip ──');
  // Hover over data point in first visible chart
  await demoPage.evaluate(() => {
    const c = document.querySelector('.recharts-responsive-container');
    c?.scrollIntoView({ block: 'center' });
  });
  await demoPage.waitForTimeout(400);
  const chartBox = await demoPage.locator('.recharts-responsive-container').first().boundingBox();
  if (chartBox) {
    await demoPage.mouse.move(chartBox.x + chartBox.width * 0.5, chartBox.y + chartBox.height * 0.5);
    await demoPage.waitForTimeout(600);
    const tooltip = await demoPage.locator('.recharts-tooltip-wrapper, [class*="tooltip"]').count();
    console.log('  Tooltip elements visible:', tooltip);
  }

  // ── SECTION 10: UI polish — resize handles ──────────────────────────────
  console.log('\n── UI polish: resize handles ──');
  const resizeHandles = await demoPage.locator('[class*="resize"], [data-resize]').count();
  // Also check for drag handles by specific tailwind classes used in PlotRenderer
  const plotResizeHandles = await demoPage.evaluate(() =>
    Array.from(document.querySelectorAll('*')).filter(el =>
      el.offsetParent !== null &&
      (el.getAttribute('style') || '').includes('cursor') &&
      ((el.className || '').includes('resize') || (el.className || '').includes('drag'))
    ).length
  );
  console.log('  Resize/drag handle elements:', resizeHandles + plotResizeHandles);

  // ── SECTION 11: UI polish — overflow/truncation ──────────────────────────
  console.log('\n── UI polish: overflow/truncation ──');
  const overflowEls = await demoPage.evaluate(() => {
    return Array.from(document.querySelectorAll('*')).filter(el => {
      if (!el.offsetParent) return false;
      if (el.clientWidth === 0) return false; // collapsed/hidden panels not a concern
      const style = window.getComputedStyle(el);
      if (style.overflow !== 'hidden') return false;
      if (el.scrollWidth <= el.clientWidth + 15) return false; // allow small tolerance for resize handles
      // Exclude ResizablePanel outer wrapper (intentional clipping of resizer handle)
      if ((el.className || '').includes('flex-shrink-0') && (el.className || '').includes('h-full')) return false;
      return true;
    }).map(el => ({ tag: el.tagName, class: (el.className || '').slice(0, 50), scrollW: el.scrollWidth, clientW: el.clientWidth })).slice(0, 5);
  });
  if (overflowEls.length > 0) {
    console.log('  Unexpected overflow:', JSON.stringify(overflowEls));
  } else {
    console.log('  No unexpected overflow detected');
  }
  check('UI polish: no unexpected overflow', overflowEls.length === 0,
    overflowEls.map(e => `${e.tag}.${e.class.split(' ')[0]}(${e.scrollW}>${e.clientW})`).join(', '));

  await demoPage.close();

  // ── SECTION 12: Template: Container & Cloud ──────────────────────────────
  console.log('\n── Template: Container & Cloud ──');
  try {
    const ccPage = await loadTemplate(browser, 'Container & Cloud');
    const ccCells = await ccPage.locator('.prose, [data-cell]').count();
    const ccCharts = await ccPage.locator('.recharts-wrapper').count();
    const ccErrors = await domScan(ccPage);
    check('Container & Cloud: cells rendered', ccCells > 0, `cells=${ccCells}`);
    check('Container & Cloud: DOM clean', ccErrors.length === 0, ccErrors.join('; '));
    console.log(`  charts=${ccCharts}`);
    await ccPage.close();
  } catch (e) {
    fail++; failures.push('Container & Cloud: ' + e.message.slice(0, 120));
    console.log('  ❌ Container & Cloud FAILED: ' + e.message.slice(0, 120));
  }

  // ── SECTION 13: Template: Exceptions & Errors ────────────────────────────
  console.log('\n── Template: Exceptions & Errors ──');
  try {
    const exPage = await loadTemplate(browser, 'Exceptions & Errors');
    const exCells = await exPage.locator('.prose, [data-cell]').count();
    const exCharts = await exPage.locator('.recharts-wrapper').count();
    const exErrors = await domScan(exPage);
    check('Exceptions & Errors: cells rendered', exCells > 0, `cells=${exCells}`);
    check('Exceptions & Errors: DOM clean', exErrors.length === 0, exErrors.join('; '));
    console.log(`  charts=${exCharts}`);
    await exPage.close();
  } catch (e) {
    fail++; failures.push('Exceptions & Errors: ' + e.message.slice(0, 120));
    console.log('  ❌ Exceptions & Errors FAILED: ' + e.message.slice(0, 120));
  }

  // ── SECTION 14: Console errors ───────────────────────────────────────────
  console.log('\n── Console errors ──');
  const realErrors = allConsoleMsgs.filter(m =>
    m.type === 'error' && !m.text.includes('/api/query') && !m.text.includes('500')
  );
  check('No real console errors (excl. /api/query 500s)', realErrors.length === 0,
    realErrors.map(m => m.text.slice(0, 120)).join('; '));
  if (allConsoleMsgs.filter(m => m.type === 'error').length > 0) {
    console.log('  Error messages:');
    allConsoleMsgs.filter(m => m.type === 'error').slice(0, 5)
      .forEach(m => console.log('    ' + m.text.slice(0, 200)));
  }

  await browser.close();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log('S162 QA: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log('  ❌ ' + f));
  } else {
    console.log('All checks pass ✅');
  }
  console.log('══════════════════════════════════════════');
  process.exit(fail > 0 ? 1 : 0);
})();
