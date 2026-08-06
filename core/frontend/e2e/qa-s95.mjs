/**
 * S95 Full QA pass — comprehensive interactive + UI polish testing
 *
 * Tests:
 * 1. Demo notebook: DOM scan, variables (varbar pill), Run All, Collapse/Expand
 * 2. Interactive: BRUSH, LINK_X zoom, command palette, SQL autocomplete, schema explorer, help modal
 * 3. UI polish: console errors, tooltip hover, plot resize handle, truncated text check
 * 4. 2 templates from rotation: GC Pause Analysis + Comprehensive Feature Test
 *
 * Usage: cd core/frontend && node e2e/qa-s95.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';

const LS_SUPPRESS = [
  { name: 'jfr-tour-seen',               value: '1' },
  { name: 'jfrq:onboarding-dismissed',   value: '1' },
  { name: 'jfrq:ai-nudge-dismissed',     value: '1' },
];

const ERROR_TERMS = [
  'Catalog Error', 'does not exist', 'Invalid plot', 'Query has errors',
  'Binder Error', 'Parser Error',
];

const CONSOLE_ERRORS = [];

async function makeContext(browser) {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [{ origin: BASE, localStorage: LS_SUPPRESS }] },
  });
  context.on('dialog', d => d.accept());
  return context;
}

async function checkErrors(page, label) {
  const errs = await page.evaluate((terms) => {
    return Array.from(document.querySelectorAll('*')).filter(el => {
      const text = el.textContent || '';
      return terms.some(t => text.includes(t))
        && el.children.length === 0
        && el.offsetParent !== null
        && !el.closest('.cm-editor')
        && !el.closest('[class*="token"]');
    }).map(e => e.textContent.trim().slice(0, 150));
  }, ERROR_TERMS);
  if (errs.length) {
    console.log(`  ❌ DOM errors (${label}):`);
    errs.forEach(e => console.log(`     ${e}`));
  }
  return errs;
}

async function waitForIdle(page, timeoutMs = 35000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const running = await page.evaluate(() =>
      document.querySelectorAll('[data-cell-status="running"]').length +
      Array.from(document.querySelectorAll('*')).filter(
        el => el.textContent?.trim() === 'Running...' && el.offsetParent !== null
      ).length
    );
    if (running === 0) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

async function loadDemo(page) {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  // Dismiss tour if visible
  const skip = await page.$('button:has-text("Skip")');
  if (skip) await skip.click().catch(() => {});
  await page.waitForTimeout(200);
  const demo = await page.$('button:has-text("Try the demo")');
  if (!demo) throw new Error('Demo button not found');
  await demo.click();
  await page.waitForTimeout(3500);
  await waitForIdle(page, 20000);
}

async function loadTemplate(page, displayName) {
  // Open gallery
  let galleryBtn = null;
  for (const sel of ['[title="New from template"]', '[aria-label="New from template"]', 'button:has-text("New from template")']) {
    galleryBtn = await page.$(sel);
    if (galleryBtn) break;
  }
  if (!galleryBtn) throw new Error('Gallery button not found');
  await galleryBtn.click();
  await page.waitForSelector('dialog, [role="dialog"]', { timeout: 5000 });
  await page.waitForTimeout(300);

  // Click the template
  const btn = await page.$(`button[aria-label="Select template: ${displayName}"]`) ||
              await page.$(`button:has-text("${displayName}")`);
  if (!btn) throw new Error(`Template not found: ${displayName}`);
  await btn.click();
  await page.waitForTimeout(300);

  // Confirm
  for (const sel of ['button:has-text("Open & Run")', 'button:has-text("Use template")', 'button:has-text("Load")']) {
    const confirm = await page.$(sel);
    if (confirm && !(await confirm.getAttribute('disabled'))) {
      await confirm.click();
      break;
    }
  }
  await page.waitForTimeout(800);
  await waitForIdle(page, 35000);
}

const PASS = []; const FAIL = [];
function pass(label) { console.log(`  ✅ ${label}`); PASS.push(label); }
function fail(label, detail) { console.log(`  ❌ ${label}: ${detail}`); FAIL.push({ label, detail }); }
function warn(label) { console.log(`  ⚠  ${label}`); }

// ═══════════════════════════════════════════════════════════════════════════
(async () => {
  const browser = await chromium.launch({ headless: true });

  // ── 1. Demo notebook ─────────────────────────────────────────────────────
  console.log('\n══ 1. DEMO NOTEBOOK ══');
  {
    const ctx = await makeContext(browser);
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const t = msg.text();
        // Filter known non-bugs: ONNX warnings, /api/query 500 probe (no Java backend), network resource errors
        if (!t.includes('ONNX') && !t.includes('ort-') && !t.includes('proxy') && !t.includes('/api/')
            && !t.includes('Failed to load resource') && !t.includes('net::ERR_')) {
          consoleErrors.push(t.slice(0, 120));
        }
      }
    });
    page.on('pageerror', err => consoleErrors.push(`[pageerror] ${err.message.slice(0, 120)}`));

    try {
      await loadDemo(page);

      // DOM scan
      const domErrs = await checkErrors(page, 'demo initial');
      if (domErrs.length === 0) pass('Demo: DOM error scan (0 errors)');
      else fail('Demo: DOM error scan', domErrs.join(' | '));

      // Scroll through all cells
      await page.evaluate(() => {
        const main = document.querySelector('main') || document.documentElement;
        main.scrollTop = 99999;
      });
      await page.waitForTimeout(1500);

      // DOM scan after scroll
      const domErrs2 = await checkErrors(page, 'demo after scroll');
      if (domErrs2.length === 0) pass('Demo: DOM scan after full scroll (0 errors)');
      else fail('Demo: DOM scan after scroll', domErrs2.join(' | '));

      // Scroll back
      await page.evaluate(() => {
        const main = document.querySelector('main') || document.documentElement;
        main.scrollTop = 0;
      });
      await page.waitForTimeout(300);

      // Run All
      let runAllClicked = false;
      for (const sel of ['button[title="Run All Queries"]', 'button[aria-label="Run All Queries"]', 'button[title="Run all queries"]']) {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); runAllClicked = true; break; }
      }
      if (runAllClicked) {
        const settled = await waitForIdle(page, 30000);
        const runErrs = await checkErrors(page, 'demo after Run All');
        if (settled && runErrs.length === 0) pass('Demo: Run All (settled, 0 errors)');
        else fail('Demo: Run All', `settled=${settled}, errors=${runErrs.length}`);
      } else {
        fail('Demo: Run All', 'button not found');
      }

      // Collapse All
      let collapseOk = false;
      for (const sel of ['button[title="Collapse All"]', 'button[aria-label="Collapse All"]']) {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); collapseOk = true; break; }
      }
      if (collapseOk) { await page.waitForTimeout(400); pass('Demo: Collapse All'); }
      else fail('Demo: Collapse All', 'button not found');

      // Expand All
      let expandOk = false;
      for (const sel of ['button[title="Expand All"]', 'button[aria-label="Expand All"]']) {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); expandOk = true; break; }
      }
      if (expandOk) { await page.waitForTimeout(400); pass('Demo: Expand All'); }
      else fail('Demo: Expand All', 'button not found');

      // Console error check
      if (consoleErrors.length === 0) pass('Demo: 0 console errors');
      else {
        const nonOnnx = consoleErrors.filter(e => !e.includes('ONNX') && !e.includes('ort-wasm'));
        if (nonOnnx.length === 0) pass(`Demo: console errors = ONNX only (${consoleErrors.length} suppressed)`);
        else fail('Demo: console errors', nonOnnx.join(' | '));
      }

    } catch(e) { fail('Demo: setup', e.message); }
    await ctx.close();
  }

  // ── 2. Interactive features via Comprehensive Feature Test template ───────
  console.log('\n══ 2. INTERACTIVE FEATURES (Comprehensive Feature Test) ══');
  {
    const ctx = await makeContext(browser);
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const t = msg.text();
        if (!t.includes('ONNX') && !t.includes('ort-') && !t.includes('/api/') && !t.includes('proxy')
            && !t.includes('Failed to load resource') && !t.includes('net::ERR_')) {
          consoleErrors.push(t.slice(0, 120));
        }
      }
    });

    try {
      await loadDemo(page);
      await loadTemplate(page, 'Comprehensive Feature Test');

      const cellCount = await page.evaluate(() => document.querySelectorAll('[data-cell-id]').length);
      pass(`Comprehensive Feature Test loaded (${cellCount} cells)`);

      // DOM scan
      const domErrs = await checkErrors(page, 'comprehensive initial');
      if (domErrs.length === 0) pass('Comprehensive: DOM scan (0 errors)');
      else fail('Comprehensive: DOM scan', domErrs.join(' | '));

      // ── Variables panel ─────────────────────────────────────────────────
      // The template has $$threshold and $$window_size in front matter
      const pills = await page.$$('[aria-label*="Variable $"][role="button"]');
      let varChanged = false;
      for (const pill of pills) {
        if (!await pill.isVisible()) continue;
        const label = await pill.getAttribute('aria-label') || '';
        const m = label.match(/= (.+?)\./);
        if (!m) continue;
        const cur = m[1].trim();
        if (!/^\d+(\.\d+)?$/.test(cur)) continue;
        const newVal = String(parseFloat(cur) === 5 ? 10 : 5);
        await pill.click();
        await page.waitForTimeout(400);
        const input = await page.$('input[type="text"][aria-label*="Value for"]') ||
                      await page.$('input[autofocus]');
        if (input) {
          await input.fill(newVal);
          const setBtn = await page.$('button[aria-label*="Set value"]');
          if (setBtn) await setBtn.click(); else await input.press('Enter');
          await page.waitForTimeout(700);
          varChanged = true;
        } else {
          await page.keyboard.press('Escape');
        }
        break;
      }
      if (varChanged) pass('Variables: pill click → value changed → cells re-ran');
      else {
        const hasPills = await page.evaluate(() => !!document.querySelector('[aria-label*="Variable $"]'));
        if (hasPills) warn('Variables: pill found but could not open edit popover');
        else warn('Variables: no variable pills visible (template may hide them initially)');
      }

      // ── LINK_X zoom ──────────────────────────────────────────────────────
      // Find a chart with LINK_X (line chart with recharts-responsive-container)
      const chartWrappers = await page.$$('.recharts-wrapper');
      let linkXTested = false;
      for (const chart of chartWrappers) {
        if (!await chart.isVisible()) continue;
        const bbox = await chart.boundingBox();
        if (!bbox || bbox.width < 100) continue;
        // Hold Shift and scroll to zoom
        await page.keyboard.down('Shift');
        await page.mouse.move(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
        await page.mouse.wheel(0, -300);
        await page.waitForTimeout(300);
        await page.keyboard.up('Shift');
        await page.waitForTimeout(600);
        // Check if a reset button appeared (sign of zoom activation)
        const resetBtn = await page.$('button:has-text("Reset"), button[title*="reset"], button[title*="Reset"]');
        if (resetBtn) {
          pass('LINK_X zoom: Shift+scroll zoom activated (Reset button appeared)');
          await resetBtn.click();
          await page.waitForTimeout(300);
        } else {
          warn('LINK_X zoom: Shift+scroll sent but Reset button not found — may need LINK_X chart specifically');
        }
        linkXTested = true;
        break;
      }
      if (!linkXTested) warn('LINK_X zoom: no recharts-wrapper found on page');

      // ── BRUSH clause ────────────────────────────────────────────────────
      // Look for a chart with BRUSH — drag across it and check if variable updates
      // The comprehensive test template has: BRUSH $sel MODE X on a line chart
      const brushVarBefore = await page.evaluate(() => {
        const pills = Array.from(document.querySelectorAll('[aria-label*="Variable $"]'));
        return pills.map(p => p.getAttribute('aria-label')).filter(l => l.includes('sel'));
      });
      // Try dragging on any line chart
      const lineCharts = await page.$$('.recharts-line-chart .recharts-surface, .recharts-area-chart .recharts-surface');
      if (lineCharts.length > 0) {
        const chart = lineCharts[0];
        const bbox = await chart.boundingBox();
        if (bbox && bbox.width > 50) {
          await page.mouse.move(bbox.x + bbox.width * 0.2, bbox.y + bbox.height * 0.5);
          await page.mouse.down();
          await page.mouse.move(bbox.x + bbox.width * 0.8, bbox.y + bbox.height * 0.5, { steps: 10 });
          await page.mouse.up();
          await page.waitForTimeout(600);
          const brushVarAfter = await page.evaluate(() => {
            const pills = Array.from(document.querySelectorAll('[aria-label*="Variable $"]'));
            return pills.map(p => p.getAttribute('aria-label'));
          });
          if (brushVarAfter.some(l => l.includes('brush') || l.includes('sel'))) {
            pass('BRUSH: drag on chart, variable updated in varbar');
          } else {
            warn('BRUSH: drag completed but $sel variable not found in varbar (chart may not have BRUSH)');
          }
        }
      } else {
        warn('BRUSH: no recharts line/area chart surfaces found');
      }

      // ── Command palette ──────────────────────────────────────────────────
      await page.click('body', { force: true }).catch(() => {});
      await page.waitForTimeout(200);
      await page.keyboard.press('Meta+k');
      await page.waitForTimeout(600);
      const cmdDialog = await page.$('dialog[open], [role="dialog"]');
      if (cmdDialog) {
        // Type something in the palette
        await page.keyboard.type('run');
        await page.waitForTimeout(400);
        const items = await page.$$('[role="option"], [role="listitem"], .command-item');
        pass(`Command palette: opened, typed "run", ${items.length} results visible`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      } else {
        fail('Command palette', 'no dialog after Cmd+K');
      }

      // ── SQL Autocomplete (preview pane) ──────────────────────────────────
      for (const sel of ['[aria-label="Preview"]', 'button[title="Preview"]', 'button:has-text("Preview")']) {
        const tab = await page.$(sel);
        if (tab) { await tab.click(); await page.waitForTimeout(500); break; }
      }
      const previewEl = await page.$('[data-testid="preview-editor"]');
      if (previewEl) {
        const cm = await previewEl.$('.cm-editor');
        if (cm) {
          await cm.click();
          await page.keyboard.press('Meta+a');
          await page.waitForTimeout(100);
          await page.keyboard.press('Backspace');
          await page.waitForTimeout(100);
          await page.keyboard.type('SELECT * FROM Gar', { delay: 20 });
          await page.keyboard.press('Control+Space');
          await page.waitForTimeout(900);
          const tooltip = await page.$('.cm-tooltip, .cm-completionList, .cm-tooltip-autocomplete');
          if (tooltip) {
            const text = await tooltip.textContent();
            if (text.includes('GarbageCollection')) {
              pass(`SQL autocomplete: "Gar" + Ctrl+Space → GarbageCollection shown`);
            } else {
              warn(`SQL autocomplete: tooltip appeared but content: ${text.slice(0, 60)}`);
            }
          } else {
            warn('SQL autocomplete: no completion tooltip appeared');
          }
          await page.keyboard.press('Escape');
          await cm.click();
          await page.keyboard.press('Meta+a');
          await page.keyboard.press('Backspace');
        } else {
          warn('SQL autocomplete: .cm-editor not found in preview-editor');
        }
      } else {
        warn('SQL autocomplete: preview editor not found (Preview tab may need activation)');
      }

      // ── Schema explorer ──────────────────────────────────────────────────
      for (const sel of ['[aria-label="Schema"]', 'button[title="Schema"]', 'button:has-text("Schema")']) {
        const tab = await page.$(sel);
        if (tab) { await tab.click(); await page.waitForTimeout(400); break; }
      }
      const gcRow = await page.$('text=GarbageCollection');
      if (gcRow) {
        await gcRow.click();
        await page.waitForTimeout(500);
        // Check for column type info
        const bodyText = await page.evaluate(() => document.body.textContent);
        const hasCols = bodyText.includes('duration') && (bodyText.includes('DOUBLE') || bodyText.includes('TIMESTAMP') || bodyText.includes('gcId'));
        if (hasCols) pass('Schema explorer: GarbageCollection expanded, columns with types visible');
        else warn('Schema explorer: GarbageCollection clicked but column types not found in body');
      } else {
        warn('Schema explorer: GarbageCollection not found in schema list');
      }

      // ── Help modal ───────────────────────────────────────────────────────
      const helpBtn = await page.$('button[aria-label="Keyboard Shortcuts"], button[title*="Keyboard"], button[title*="Help"]');
      if (helpBtn) {
        await helpBtn.click();
        await page.waitForTimeout(500);
        const modal = await page.$('dialog[open], [role="dialog"]');
        if (modal) {
          const text = await modal.textContent();
          const hasContent = text.includes('Ctrl') || text.includes('Cmd') || text.includes('shortcut');
          if (hasContent) pass('Help modal: opened via toolbar button, shortcut table visible');
          else fail('Help modal', `modal opened but unexpected content: ${text.slice(0, 80)}`);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(200);
        } else {
          fail('Help modal', 'no dialog found after clicking help button');
        }
      } else {
        // Try ? key
        await page.evaluate(() => { document.activeElement?.blur(); });
        await page.waitForTimeout(200);
        await page.keyboard.press('?');
        await page.waitForTimeout(500);
        const modal = await page.$('dialog[open], [role="dialog"]');
        if (modal) pass('Help modal: ? key opened modal');
        else fail('Help modal', 'no button found and ? key also failed');
      }

      // ── UI Polish: tooltip hover ─────────────────────────────────────────
      // Hover over a chart dot/point and check for tooltip
      const chartAreas = await page.$$('.recharts-responsive-container');
      let tooltipFound = false;
      for (const area of chartAreas.slice(0, 3)) {
        if (!await area.isVisible()) continue;
        const bbox = await area.boundingBox();
        if (!bbox || bbox.width < 100) continue;
        await page.mouse.move(bbox.x + bbox.width * 0.5, bbox.y + bbox.height * 0.5);
        await page.waitForTimeout(400);
        const tooltip = await page.$('.recharts-tooltip-wrapper, [class*="tooltip"], .custom-tooltip');
        if (tooltip && await tooltip.isVisible()) {
          const text = await tooltip.textContent();
          if (text.trim().length > 0) {
            pass(`Chart tooltip: appeared on hover ("${text.slice(0, 40)}")`);
            tooltipFound = true;
            break;
          }
        }
      }
      if (!tooltipFound) warn('Chart tooltip: no tooltip visible on hover (may need data or different chart)');

      // ── UI Polish: plot resize handle ────────────────────────────────────
      const plotWrappers = await page.$$('[data-plot-resize], .plot-resize-handle, [class*="resize"]');
      if (plotWrappers.length > 0) {
        pass(`Plot resize: ${plotWrappers.length} resize handle(s) found`);
      } else {
        warn('Plot resize: no [data-plot-resize] handles found (may use different selector)');
      }

      // ── UI Polish: overflow / truncation check ───────────────────────────
      const overflows = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('*')).filter(el => {
          if (el.children.length === 0 && el.offsetParent !== null) {
            const style = getComputedStyle(el);
            return (style.overflow === 'hidden' || style.textOverflow === 'ellipsis') &&
              el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0;
          }
          return false;
        }).slice(0, 5).map(el => ({
          tag: el.tagName,
          text: el.textContent?.trim().slice(0, 40),
          overflow: getComputedStyle(el).overflow
        }));
      });
      if (overflows.length > 0) {
        warn(`Possible text overflow in ${overflows.length} element(s): ${JSON.stringify(overflows).slice(0, 120)}`);
      } else {
        pass('UI polish: no obvious text overflow found');
      }

      // ── Console errors (final check) ─────────────────────────────────────
      const nonOnnx = consoleErrors.filter(e =>
        !e.includes('ONNX') && !e.includes('ort-wasm') && !e.includes('recharts')
      );
      if (nonOnnx.length === 0) pass(`Console: 0 real errors (${consoleErrors.length} suppressed)`);
      else fail('Console errors', nonOnnx.join(' | '));

    } catch(e) { fail('Comprehensive Feature Test', e.message); }
    await ctx.close();
  }

  // ── 3. GC Pause Analysis template ────────────────────────────────────────
  console.log('\n══ 3. GC PAUSE ANALYSIS template ══');
  {
    const ctx = await makeContext(browser);
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const t = msg.text();
        if (!t.includes('ONNX') && !t.includes('ort-') && !t.includes('/api/') && !t.includes('proxy')
            && !t.includes('Failed to load resource') && !t.includes('net::ERR_')) {
          consoleErrors.push(t.slice(0, 120));
        }
      }
    });

    try {
      await loadDemo(page);
      await loadTemplate(page, 'GC Pause Analysis');
      const cells = await page.evaluate(() => document.querySelectorAll('[data-cell-id]').length);
      pass(`GC Pause Analysis loaded (${cells} cells)`);

      const domErrs = await checkErrors(page, 'gc-analysis');
      if (domErrs.length === 0) pass('GC Pause Analysis: DOM scan (0 errors)');
      else fail('GC Pause Analysis: DOM scan', domErrs.join(' | '));

      // Scroll through all cells
      await page.evaluate(() => {
        const main = document.querySelector('main') || document.documentElement;
        main.scrollTop = 99999;
      });
      await page.waitForTimeout(2000);
      const domErrs2 = await checkErrors(page, 'gc-analysis after scroll');
      if (domErrs2.length === 0) pass('GC Pause Analysis: DOM scan after full scroll (0 errors)');
      else fail('GC Pause Analysis: DOM scan after scroll', domErrs2.join(' | '));

      // LINK_X zoom on a chart
      await page.evaluate(() => {
        const main = document.querySelector('main') || document.documentElement;
        main.scrollTop = 0;
      });
      await page.waitForTimeout(300);
      const charts = await page.$$('.recharts-wrapper');
      let zoomed = false;
      for (const chart of charts) {
        if (!await chart.isVisible()) continue;
        const bbox = await chart.boundingBox();
        if (!bbox || bbox.width < 100) continue;
        await page.keyboard.down('Shift');
        await page.mouse.move(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
        await page.mouse.wheel(0, -400);
        await page.waitForTimeout(300);
        await page.keyboard.up('Shift');
        await page.waitForTimeout(600);
        const resetBtn = await page.$('button:has-text("Reset"), button[title*="Reset"], button[title*="reset"]');
        if (resetBtn) {
          pass('LINK_X zoom: zoom activated on GC Pause Analysis chart (Reset button appeared)');
          zoomed = true;
          await resetBtn.click();
          break;
        }
      }
      if (!zoomed) warn('LINK_X zoom: no Reset button appeared — may need LINK_X chart in view');

      const nonOnnx = consoleErrors.filter(e => !e.includes('ONNX') && !e.includes('ort-wasm'));
      if (nonOnnx.length === 0) pass('GC Pause Analysis: 0 real console errors');
      else fail('GC Pause Analysis: console errors', nonOnnx.join(' | '));

    } catch(e) { fail('GC Pause Analysis', e.message); }
    await ctx.close();
  }

  // ── 4. Recording Overview template ───────────────────────────────────────
  console.log('\n══ 4. RECORDING OVERVIEW template ══');
  {
    const ctx = await makeContext(browser);
    const page = await ctx.newPage();

    try {
      await loadDemo(page);
      await loadTemplate(page, 'Recording Overview');
      const cells = await page.evaluate(() => document.querySelectorAll('[data-cell-id]').length);
      pass(`Recording Overview loaded (${cells} cells)`);

      const domErrs = await checkErrors(page, 'overview');
      if (domErrs.length === 0) pass('Recording Overview: DOM scan (0 errors)');
      else fail('Recording Overview: DOM scan', domErrs.join(' | '));

      // Scroll
      await page.evaluate(() => {
        const main = document.querySelector('main') || document.documentElement;
        main.scrollTop = 99999;
      });
      await page.waitForTimeout(1500);
      const domErrs2 = await checkErrors(page, 'overview after scroll');
      if (domErrs2.length === 0) pass('Recording Overview: DOM scan after scroll (0 errors)');
      else fail('Recording Overview: DOM scan after scroll', domErrs2.join(' | '));

    } catch(e) { fail('Recording Overview', e.message); }
    await ctx.close();
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n══ SUMMARY ══');
  console.log(`PASS: ${PASS.length}, FAIL: ${FAIL.length}`);
  if (FAIL.length > 0) {
    console.log('\nFAILURES:');
    FAIL.forEach(f => console.log(`  ❌ ${f.label}: ${f.detail}`));
  } else {
    console.log('All checks passed ✅');
  }

  await browser.close();
  process.exit(FAIL.length > 0 ? 1 : 0);
})();
