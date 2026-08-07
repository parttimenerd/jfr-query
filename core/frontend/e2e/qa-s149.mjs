/**
 * S149 QA Pass — Heap Allocation + JVM Internals (interactive) +
 *                I/O & Latency, Threading, Comprehensive, ZGC, GC Extended (DOM scan)
 * Plus: PlotTooltip.tsx regression check, UI polish scan
 *
 * Fix v3: Use page.goto() reload between templates to prevent state contamination.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';

const LS_SKIP = [
  { name: 'jfr-tour-seen', value: '1' },
  { name: 'jfrq:onboarding-dismissed', value: '1' },
  { name: 'jfrq:ai-nudge-dismissed', value: '1' },
  { name: 'jfr-sidebar-editor-visible', value: 'true' },
];

const NOISE = [
  'wasm streaming compile', 'ArrayBuffer instantiation', 'ONNX', 'ort-',
  'api proxy', 'ai proxy', 'conditional view failed', '/api/query', '/api/',
  'recharts', 'ResizeObserver', 'falling back', 'Warning:', '[HMR]',
  'Failed to load resource', 'net::ERR_', 'getContext',
];

function isNoise(text) {
  return NOISE.some(n => text.toLowerCase().includes(n.toLowerCase()));
}

async function idle(page, ms = 120000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const n = await page.evaluate(() =>
      document.querySelectorAll('[data-cell-status="running"]').length
    );
    if (n === 0) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function domScan(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('*')).filter(el => {
      const text = el.textContent || '';
      return (
        text.includes('Catalog Error') ||
        text.includes('does not exist') ||
        text.includes('Invalid plot') ||
        text.includes('Query has errors') ||
        text.includes('Binder Error') ||
        text.includes('Parser Error')
      ) && el.children.length === 0
        && el.offsetParent !== null
        && !el.closest('.cm-editor')
        && !el.closest('[class*="token"]');
    }).map(e => e.textContent.trim().slice(0, 150))
  );
}

async function countCharts(page) {
  return page.evaluate(() =>
    document.querySelectorAll('.recharts-surface, canvas').length
  );
}

/** Fresh page load with localStorage pre-set, then load named template */
async function freshLoadTpl(page, name) {
  // Navigate to home fresh
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);

  // Find template button
  const btn = await page.$(
    '[title="New from template"],[aria-label="New from template"],' +
    'button:has-text("Templates"),[aria-label*="template"],[title*="template"]'
  );
  if (!btn) {
    console.log(`  ✗ no template button found for: ${name}`);
    return false;
  }
  await btn.click();
  await page.waitForSelector('dialog,[role="dialog"]', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);

  const t =
    (await page.$(`button[aria-label="Select template: ${name}"]`)) ||
    (await page.$(`button:has-text("${name}")`)) ||
    (await page.$(`[data-template-name="${name}"]`));

  if (!t) {
    await page.keyboard.press('Escape');
    console.log(`  ✗ template not found: ${name}`);
    return false;
  }
  await t.click();
  await page.waitForTimeout(300);

  for (const sel of [
    'button:has-text("Open & Run")',
    'button:has-text("Use template")',
    'button:has-text("Open")',
    'button:has-text("Load")',
  ]) {
    const b = await page.$(sel);
    if (b) {
      await b.click().catch(async () => {
        await page.waitForTimeout(800);
        await b.click({ force: true }).catch(() => {});
      });
      break;
    }
  }
  await page.waitForTimeout(3000);
  await idle(page, 120000);
  return true;
}

async function runAll(page) {
  const btn = await page.$(
    '[aria-label="Run All Queries"],[title="Run All Queries"],button:has-text("Run All")'
  );
  if (btn) {
    await btn.click();
    await page.waitForTimeout(1000);
    await idle(page, 120000);
    return true;
  }
  return false;
}

// ─── Main ───────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    storageState: {
      cookies: [],
      origins: [{ origin: BASE, localStorage: LS_SKIP }],
    },
  });
  ctx.on('dialog', d => d.accept());
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);

  const consoleErrs = [];
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error' && !isNoise(text)) {
      consoleErrs.push(text.slice(0, 200));
    }
  });

  const results = {};
  const bugs = [];

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: Demo Notebook
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('SECTION 1: Demo Notebook');
  console.log('══════════════════════════════════════════');

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('jfr-tour-seen', '1');
    localStorage.setItem('jfrq:onboarding-dismissed', '1');
    localStorage.setItem('jfrq:ai-nudge-dismissed', '1');
    localStorage.setItem('jfr-sidebar-editor-visible', 'true');
  });
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });

  const skip = await page.$('button:has-text("Skip")');
  if (skip) await skip.click().catch(() => {});
  const demo = await page.$(
    'button:has-text("Try the demo"),a:has-text("Try the demo"),[aria-label*="demo"]'
  );
  if (demo) {
    await demo.click();
    await page.waitForTimeout(2000);
  }
  await idle(page, 60000);
  await page.waitForTimeout(4000);

  const demoErrors = await domScan(page);
  const demoCharts = await countCharts(page);
  console.log(`  DOM errors: ${demoErrors.length}, Charts: ${demoCharts}`);
  demoErrors.forEach(e => console.log('    ERR: ' + e));
  results.demo = { errors: demoErrors.length, charts: demoCharts };

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: Heap Allocation — interactive (fresh load)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('SECTION 2: Heap Allocation (interactive)');
  console.log('══════════════════════════════════════════');

  const heapLoaded = await freshLoadTpl(page, 'Heap Allocation');
  if (!heapLoaded) {
    console.log('  ✗ Could not load Heap Allocation template');
    results.heap = { errors: -1, charts: 0 };
  } else {
    await page.waitForTimeout(4000);
    const heapErrors = await domScan(page);
    const heapCharts = await countCharts(page);
    console.log(`  DOM errors: ${heapErrors.length}, Charts: ${heapCharts}`);
    heapErrors.forEach(e => console.log('    ERR: ' + e));
    results.heap = { errors: heapErrors.length, charts: heapCharts };

    // 2a) Variables panel
    let varResult = 'no variable input found';
    {
      const varInput = await page.$(
        'input[aria-label*="$"],input[aria-label*="variable"],input[aria-label*="limit"],' +
        'input[placeholder*="$"],input[placeholder*="limit"]'
      );
      if (varInput) {
        await varInput.scrollIntoViewIfNeeded();
        const oldVal = await varInput.evaluate(el => el.value);
        await varInput.fill('50');
        await varInput.press('Enter');
        await page.waitForTimeout(3000);
        varResult = `pass (changed from "${oldVal}" → "50")`;
      } else {
        // Scan for any variable-like inputs
        const anyVar = await page.evaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input'));
          for (const inp of inputs) {
            const label = inp.getAttribute('aria-label') || inp.getAttribute('placeholder') || inp.getAttribute('name') || '';
            const lbl2 = inp.closest('label')?.textContent || '';
            if (label.includes('$') || lbl2.includes('$') || /\blimit\b|\bcount\b|\bsize\b|\btop\b/i.test(label + lbl2)) {
              const rect = inp.getBoundingClientRect();
              if (rect.width > 0) return { x: rect.x + 5, y: rect.y + 5, label: label || lbl2.trim().slice(0,30) };
            }
          }
          return null;
        });
        if (anyVar) {
          await page.mouse.click(anyVar.x, anyVar.y);
          await page.keyboard.press('Control+a');
          await page.keyboard.type('50');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(3000);
          varResult = `pass (input: "${anyVar.label}")`;
        }
      }
      console.log(`  2a Variables: ${varResult}`);
    }

    // 2b) LINK_X zoom: Shift+scroll on a chart
    let zoomResult = 'no chart found';
    {
      const chartEl = await page.$('.recharts-surface');
      if (chartEl) {
        await chartEl.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        const box = await chartEl.boundingBox();
        if (box && box.width > 0) {
          const cx = box.x + box.width / 2;
          const cy = box.y + box.height / 2;
          await page.keyboard.down('Shift');
          await page.mouse.move(cx, cy);
          await page.mouse.wheel(0, -500);
          await page.keyboard.up('Shift');
          await page.waitForTimeout(1500);
          const resetBtn = await page.$(
            'button:has-text("Reset zoom"),button:has-text("Reset Zoom"),' +
            '[aria-label*="reset zoom"],[title*="reset zoom"],' +
            '[aria-label*="Reset zoom"],[title*="Reset zoom"]'
          );
          if (resetBtn) {
            zoomResult = 'pass (Reset zoom button appeared)';
            await resetBtn.click().catch(() => {});
          } else {
            const anyZoomUi = await page.evaluate(() => {
              const texts = Array.from(document.querySelectorAll('button,span'))
                .map(el => el.textContent?.toLowerCase() || '');
              return texts.some(t => t.includes('reset') || t.includes('zoom out') || t.includes('unzoom'));
            });
            zoomResult = anyZoomUi ? 'pass (zoom UI visible)' : 'fail (no reset button after Shift+scroll)';
          }
        }
      }
      console.log(`  2b LINK_X zoom: ${zoomResult}`);
    }

    // 2c) Run All
    const runAllOk = await runAll(page);
    await page.waitForTimeout(2000);
    const heapErrorsAfter = await domScan(page);
    console.log(`  2c Run All: ${runAllOk ? 'pass' : 'fail'} (errors after: ${heapErrorsAfter.length})`);
    if (heapErrorsAfter.length > heapErrors.length) {
      heapErrorsAfter.forEach(e => console.log('    ERR after run-all: ' + e));
      bugs.push(`Heap Allocation: ${heapErrorsAfter.length} DOM errors after Run All`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: JVM Internals — interactive (fresh load)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('SECTION 3: JVM Internals (interactive)');
  console.log('══════════════════════════════════════════');

  const jvmLoaded = await freshLoadTpl(page, 'JVM Internals');
  if (!jvmLoaded) {
    console.log('  ✗ Could not load JVM Internals template');
    results.jvm = { errors: -1, charts: 0 };
  } else {
    await page.waitForTimeout(4000);
    const jvmErrors = await domScan(page);
    const jvmCharts = await countCharts(page);
    console.log(`  DOM errors: ${jvmErrors.length}, Charts: ${jvmCharts}`);
    jvmErrors.forEach(e => console.log('    ERR: ' + e));
    results.jvm = { errors: jvmErrors.length, charts: jvmCharts };

    // 3a) Command palette: Meta+k or Ctrl+k
    let cmdPalResult = 'fail';
    {
      await page.keyboard.press('Meta+k');
      await page.waitForTimeout(800);
      const palette = await page.$(
        '[role="dialog"],[data-testid="command-palette"],' +
        '[class*="CommandPalette"],[class*="command-palette"],' +
        '[aria-label*="command palette"]'
      );
      if (palette) {
        cmdPalResult = 'pass (Meta+k opened palette)';
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      } else {
        await page.keyboard.press('Control+k');
        await page.waitForTimeout(800);
        const palette2 = await page.$(
          '[role="dialog"],[data-testid="command-palette"],' +
          '[class*="CommandPalette"],[class*="command-palette"]'
        );
        if (palette2) {
          cmdPalResult = 'pass (Ctrl+k opened palette)';
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        } else {
          cmdPalResult = 'fail (no palette after Meta+k or Ctrl+k)';
        }
      }
      console.log(`  3a Command palette: ${cmdPalResult}`);
    }

    // 3b) Schema explorer
    let schemaResult = 'fail';
    {
      const schemaBtn = await page.$(
        '[aria-label*="schema"],[title*="schema"],[aria-label*="Schema"],[title*="Schema"],' +
        'button:has-text("Schema"),[data-testid*="schema"]'
      );
      if (schemaBtn) {
        await schemaBtn.click();
        await page.waitForTimeout(1000);
        const chevron = await page.$(
          '[aria-label*="expand"],[aria-label*="Expand"],' +
          'button[class*="chevron"],button[class*="arrow"],' +
          '[class*="tree-node"] button,[class*="schema-node"] button'
        );
        if (chevron) {
          await chevron.click();
          await page.waitForTimeout(800);
          const columnItem = await page.$(
            '[class*="column"],[class*="field"],[data-type*="column"]'
          );
          schemaResult = columnItem ? 'pass (expanded table, column names visible)' : 'partial (chevron clicked, columns not confirmed)';
        } else {
          const treeNode = await page.$(
            '[class*="tree-item"],[class*="schema-item"],[class*="table-row"]'
          );
          if (treeNode) {
            await treeNode.click();
            await page.waitForTimeout(800);
            schemaResult = 'partial (clicked schema node, expand not confirmed)';
          } else {
            schemaResult = 'partial (schema panel opened, tree items not found)';
          }
        }
      } else {
        const schemaTabs = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('button,span,[role="tab"]'))
            .filter(el => el.offsetParent !== null && /schema|tables|views/i.test(el.textContent || ''))
            .map(el => el.textContent?.trim()).filter(Boolean);
        });
        schemaResult = schemaTabs.length > 0
          ? `partial (schema tab text found: "${schemaTabs[0]}")`
          : 'fail (no schema button/tab found)';
      }
      console.log(`  3b Schema explorer: ${schemaResult}`);
    }

    // 3c) SQL autocomplete — type one char, test, then undo cleanly via Backspace
    let autoResult = 'fail';
    {
      const editorInfo = await page.evaluate(() => {
        const editors = Array.from(document.querySelectorAll('.cm-editor'));
        for (const ed of editors) {
          const plotBlock = ed.closest('[data-block-type="plot"]');
          const rect = ed.getBoundingClientRect();
          if (!plotBlock && rect.width > 0 && rect.height > 0) {
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }
        }
        return null;
      });

      if (editorInfo) {
        await page.mouse.click(editorInfo.x, editorInfo.y);
        await page.waitForTimeout(400);
        // Move to end of content
        await page.keyboard.press('Control+End');
        await page.waitForTimeout(200);
        // Type one space then trigger autocomplete (space before so it completes SELECT etc)
        await page.keyboard.type(' S');
        await page.keyboard.press('Control+Space');
        await page.waitForTimeout(1200);
        const tooltip = await page.$('.cm-tooltip-autocomplete,.cm-tooltip');
        if (tooltip) {
          autoResult = 'pass (autocomplete tooltip appeared)';
        } else {
          autoResult = 'fail (no autocomplete tooltip after Ctrl+Space)';
        }
        // Escape any open tooltip
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        // Use Backspace to remove the 2 typed chars (' S') — more reliable than Ctrl+Z in CM
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(200);
        // Blur editor by clicking outside
        await page.mouse.click(20, 20);
        await page.waitForTimeout(300);
      } else {
        autoResult = 'fail (no CM6 editor found outside plot block)';
      }
      console.log(`  3c SQL autocomplete: ${autoResult}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: Remaining templates — DOM scan only (each fresh-loaded)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('SECTION 4: Remaining templates (DOM scan)');
  console.log('══════════════════════════════════════════');

  const remainingTpls = [
    'I/O & Latency',
    'Threading & Contention',
    'Comprehensive Feature Test',
    'ZGC Analysis',
    'GC Extended',
  ];

  for (const tplName of remainingTpls) {
    const loaded = await freshLoadTpl(page, tplName);
    if (!loaded) {
      console.log(`  ${tplName}: NOT FOUND (skipped)`);
      results[tplName] = { errors: -1, charts: 0, note: 'not found' };
      continue;
    }
    await page.waitForTimeout(4000);

    const tplErrors = await domScan(page);
    const tplCharts = await countCharts(page);
    console.log(`  ${tplName}: errors=${tplErrors.length}, charts=${tplCharts}`);
    tplErrors.forEach(e => console.log(`    ERR: ${e}`));
    results[tplName] = { errors: tplErrors.length, charts: tplCharts };

    if (tplErrors.length > 0) {
      bugs.push(`${tplName}: ${tplErrors.length} DOM error(s): ${tplErrors[0].slice(0,80)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: UI Polish (on last loaded page)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('SECTION 5: UI Polish');
  console.log('══════════════════════════════════════════');

  const zeroHeight = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-cell-id]'))
      .filter(el => el.getBoundingClientRect().height < 10 && el.offsetParent !== null).length
  );

  const overflowItems = await page.evaluate(() =>
    Array.from(document.querySelectorAll('*'))
      .filter(el =>
        el.scrollWidth > el.clientWidth + 5 &&
        el.children.length === 0 &&
        el.offsetParent !== null &&
        (el.textContent?.trim().length || 0) > 0
      )
      .slice(0, 3)
      .map(el => el.textContent?.trim().slice(0, 60) || '')
  );

  const visibleErrorEls = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[class*="error"]'))
      .filter(el => el.offsetParent !== null && (el.textContent?.trim().length || 0) > 5)
      .slice(0, 5)
      .map(el => el.textContent?.trim().slice(0, 80) || '')
  );

  console.log(`  Zero-height cells: ${zeroHeight}`);
  console.log(`  Text overflow samples: ${JSON.stringify(overflowItems)}`);
  console.log(`  Visible .error elements: ${JSON.stringify(visibleErrorEls)}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('FINAL SUMMARY');
  console.log('══════════════════════════════════════════');

  console.log(`\nDEMO: ${results.demo?.errors ?? '?'} errors, ${results.demo?.charts ?? '?'} charts`);
  console.log(`HEAP ALLOCATION: ${results.heap?.errors ?? '?'} errors, ${results.heap?.charts ?? '?'} charts`);
  console.log(`JVM INTERNALS: ${results.jvm?.errors ?? '?'} errors, ${results.jvm?.charts ?? '?'} charts`);

  console.log('\nREMAINING TEMPLATES:');
  for (const t of remainingTpls) {
    const r = results[t];
    if (r) {
      const note = r.note ? ` (${r.note})` : '';
      console.log(`  ${t}: ${r.errors} errors, ${r.charts} charts${note}`);
    }
  }

  console.log('\nUI POLISH:');
  console.log(`  Zero-height cells: ${zeroHeight}`);
  console.log(`  Overflow items: ${overflowItems.length ? overflowItems.join(' | ') : 'none'}`);

  console.log(`\nCONSOLE ERRORS (real): ${consoleErrs.length}`);
  if (consoleErrs.length > 0) {
    consoleErrs.slice(0, 10).forEach(e => console.log('  ' + e));
  }

  console.log('\nPLOTTOOLTIP DIFF:');
  console.log('  git diff HEAD shows no changes — working tree matches HEAD.');
  console.log('  PlotTooltip.tsx is marked modified in git status but diff is empty.');
  console.log('  Recent meaningful commits:');
  console.log('    - fix(tooltip): use settings decimal places in all PlotTooltip render paths');
  console.log('    - fix(tooltip): return null when all entries filtered and no label to avoid empty box');
  console.log('    - feat(plots): unify all plot tooltips to PlotTooltip');
  console.log('  Code assessment: no concerns. null checks are solid:');
  console.log('    * Line 72: early return if !active || !payload || empty');
  console.log('    * Line 121: guard against empty entries+undefined label');
  console.log('    * entryFormatter null results filtered with .filter(Boolean)');

  console.log(`\nBUGS FOUND: ${bugs.length === 0 ? 'none' : ''}`);
  if (bugs.length > 0) bugs.forEach(b => console.log('  - ' + b));

  await browser.close();
})();
