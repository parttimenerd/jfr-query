// QA Session S153 — GC Pause Analysis deep + Heap Allocation interactive, all-13 sweep
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(20000);
await page.setViewportSize({ width: 1400, height: 900 });

const realErrors = [];
const NOISE = ['wasm streaming', 'ArrayBuffer', 'ONNX', '/api/query', 'recharts',
  'ResizeObserver', '[HMR]', 'falling back', 'ai proxy', 'conditional view',
  'getContext', 'Warning:', 'ERR_ABORTED', 'net::', 'Failed to load resource',
  '500 (Internal Server Error)', '500 ('];
page.on('console', msg => {
  if (msg.type() === 'error') {
    const t = msg.text();
    if (!NOISE.some(n => t.toLowerCase().includes(n.toLowerCase()))) {
      realErrors.push(t.slice(0, 200));
    }
  }
});

const domScan = async (label) => {
  const errs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('*')).filter(el => {
      const t = el.textContent || '';
      return (t.includes('Catalog Error') || t.includes('does not exist') ||
              t.includes('Invalid plot') || t.includes('Query has errors') ||
              t.includes('Binder Error') || t.includes('Parser Error'))
        && el.children.length === 0 && el.offsetParent !== null;
    }).map(e => e.textContent.trim().slice(0, 120))
  );
  const charts = await page.evaluate(() =>
    document.querySelectorAll('.recharts-surface, canvas').length
  );
  console.log(`[${label}] errors=${JSON.stringify(errs)} charts=${charts}`);
  return { errs, charts };
};

async function loadTemplate(title) {
  try {
    await page.locator('button').filter({ hasText: /^templates$/i }).click({ timeout: 5000 });
  } catch {
    try {
      await page.locator('[title*="emplate" i], [aria-label*="emplate" i]').first().click({ timeout: 5000 });
    } catch {
      await page.locator('button').nth(2).click({ timeout: 5000 });
    }
  }
  await page.waitForTimeout(1500);

  const search = page.locator('input[placeholder*="earch" i]').first();
  await search.fill(title);
  await page.waitForTimeout(600);

  await page.locator('li, [role="option"], button').filter({ hasText: title }).first().click({ timeout: 5000 });
  await page.waitForTimeout(800);

  for (const lbl of ['Replace', 'Load', 'Open', 'Use template', 'Insert']) {
    const btn = page.locator('button').filter({ hasText: new RegExp(`^${lbl}$`, 'i') });
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await btn.click();
      break;
    }
  }
  await page.waitForTimeout(10000);
}

// ─── Section 1: Demo notebook ───────────────────────────────────────────────
console.log('\n=== Section 1: Demo notebook ===');
await page.goto('http://localhost:3001');
await page.waitForTimeout(1000);
await page.evaluate(() => { try { localStorage.clear(); } catch(e) {} });
await page.waitForTimeout(2000);
await page.locator('button, a').filter({ hasText: /try.*demo|demo/i }).first().click();
await page.waitForTimeout(8000);

// Dismiss TourOverlay if it opened (it has a dark overlay with onClick=onClose)
try {
  // Try clicking the "Skip" or "×" close button in the tour
  const tourClose = page.locator('button').filter({ hasText: /skip|close|×/i }).first();
  const tourCloseVisible = await tourClose.isVisible({ timeout: 2000 }).catch(() => false);
  if (tourCloseVisible) {
    await tourClose.click();
    await page.waitForTimeout(500);
    console.log('[demo-tour] dismissed tour via close button');
  } else {
    // Fallback: press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    console.log('[demo-tour] dismissed tour via Escape');
  }
} catch (e2) {
  console.log(`[demo-tour] dismiss attempt: ${e2.message}`);
}

const demo = await domScan('demo');

// Run All
try {
  // Button uses aria-label="Run All Queries"
  const runAllBtn = page.locator('[aria-label="Run All Queries"], button[title="Run All Queries"]').first();
  const visible = await runAllBtn.isVisible({ timeout: 3000 }).catch(() => false);
  if (visible) {
    await runAllBtn.click();
    await page.waitForTimeout(10000);
    const demoAfterRun = await domScan('demo-after-run-all');
    console.log(`[demo-run-all] done, charts=${demoAfterRun.charts}`);
  } else {
    console.log('[demo-run-all] button not found');
  }
} catch (e) {
  console.log(`[demo-run-all] error: ${e.message}`);
}

// Schema Explorer
try {
  const schemaBtn = page.locator('[title*="schema" i], [aria-label*="schema" i], [title*="table" i]').first();
  const schemaVisible = await schemaBtn.isVisible({ timeout: 3000 }).catch(() => false);
  if (schemaVisible) {
    await schemaBtn.click();
    await page.waitForTimeout(1500);
    const firstRow = page.locator('[data-table-row], tr, .schema-row').first();
    const rowVisible = await firstRow.isVisible({ timeout: 3000 }).catch(() => false);
    if (rowVisible) await firstRow.click();
    await page.waitForTimeout(800);
    const colCount = await page.evaluate(() =>
      document.querySelectorAll('td, .column-item, [data-column]').length
    );
    console.log(`[demo-schema] column items found: ${colCount}`);
  } else {
    console.log('[demo-schema] schema button not found');
  }
} catch (e) {
  console.log(`[demo-schema] error: ${e.message}`);
}

// Help modal
try {
  const helpBtn = page.locator('[aria-label="Keyboard Shortcuts"], button[title*="Keyboard Shortcuts" i], button[title*="Tips" i]').first();
  const helpVisible = await helpBtn.isVisible({ timeout: 3000 }).catch(() => false);
  if (helpVisible) {
    await helpBtn.click();
    await page.waitForTimeout(1000);
    const modal = await page.locator('[role="dialog"], .modal, [data-modal]').isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`[demo-help] modal opened: ${modal}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } else {
    console.log('[demo-help] help button not found');
  }
} catch (e) {
  console.log(`[demo-help] error: ${e.message}`);
}

// Command palette
try {
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(800);
  const paletteVisible = await page.locator('[role="dialog"], [data-command-palette], input[placeholder*="command" i], input[placeholder*="search" i]').isVisible({ timeout: 2000 }).catch(() => false);
  console.log(`[demo-command-palette] opened: ${paletteVisible}`);
  if (paletteVisible) {
    await page.keyboard.type('run');
    await page.waitForTimeout(500);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
} catch (e) {
  console.log(`[demo-command-palette] error: ${e.message}`);
}

// ─── Section 2: GC Pause Analysis — deep interactive ───────────────────────
console.log('\n=== Section 2: GC Pause Analysis ===');
await loadTemplate('GC Pause Analysis');
const gc = await domScan('gc-analysis');

// a) Variables panel
try {
  const allInputs = await page.locator('input').all();
  let varInput = null;
  for (const inp of allInputs) {
    const label = await inp.evaluate(el => {
      const parent = el.closest('[data-cell-id]') || el.parentElement?.parentElement;
      return parent ? parent.textContent || '' : '';
    });
    if (label.includes('$threshold') || label.includes('$limit') || label.includes('threshold')) {
      varInput = inp;
      break;
    }
  }
  if (varInput) {
    const orig = await varInput.inputValue();
    await varInput.selectText();
    await varInput.fill(String(Number(orig || '50') + 10));
    await varInput.press('Enter');
    await page.waitForTimeout(4000);
    console.log('[gc-variables] changed variable, waiting for re-run');
    await domScan('gc-after-var-change');
    await varInput.selectText();
    await varInput.fill(orig);
    await varInput.press('Enter');
    await page.waitForTimeout(2000);
  } else {
    console.log('[gc-variables] no variable input found');
  }
} catch (e) {
  console.log(`[gc-variables] error: ${e.message}`);
}

// b) LINK_X zoom
try {
  const charts = await page.locator('.recharts-surface').all();
  console.log(`[gc-link-x] found ${charts.length} charts`);
  if (charts.length > 0) {
    const chart = charts[0];
    await chart.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const box = await chart.boundingBox();
    if (box && box.width > 100) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.keyboard.down('Shift');
      await page.mouse.wheel(0, -400);
      await page.keyboard.up('Shift');
      await page.waitForTimeout(1500);
      const resetVisible = await page.locator('button').filter({ hasText: /reset.*zoom|zoom.*reset/i }).isVisible().catch(() => false);
      console.log(`[gc-link-x] zoom reset button visible: ${resetVisible}`);
      if (resetVisible) {
        await page.locator('button').filter({ hasText: /reset.*zoom|zoom.*reset/i }).click();
        await page.waitForTimeout(500);
      }
    }
  }
} catch (e) {
  console.log(`[gc-link-x] error: ${e.message}`);
}

// c) BRUSH clause
try {
  const hasBrush = await page.evaluate(() => {
    const editors = document.querySelectorAll('.cm-editor');
    for (const ed of editors) {
      if (ed.textContent.includes('BRUSH')) return true;
    }
    const cells = document.querySelectorAll('[data-cell-id]');
    for (const cell of cells) {
      if (cell.textContent.includes('BRUSH')) return true;
    }
    return false;
  });
  console.log(`[gc-brush] BRUSH clause present: ${hasBrush}`);
  if (hasBrush) {
    const barGroups = page.locator('.recharts-bar-rectangle, .recharts-rectangle');
    const barCount = await barGroups.count();
    console.log(`[gc-brush] bar rectangles found: ${barCount}`);
    if (barCount > 0) {
      await barGroups.first().scrollIntoViewIfNeeded();
      await barGroups.first().click().catch(e2 => console.log(`[gc-brush] click failed: ${e2.message}`));
      await page.waitForTimeout(1000);
      const sidebarVars = await page.evaluate(() => {
        const vars = document.querySelectorAll('[data-variable], input[data-var]');
        return Array.from(vars).map(v => v.value || v.textContent).slice(0, 3);
      });
      console.log(`[gc-brush] sidebar vars after click: ${JSON.stringify(sidebarVars)}`);
    }
  }
} catch (e) {
  console.log(`[gc-brush] error: ${e.message}`);
}

// d) SQL autocomplete on gc-analysis
try {
  const editors = await page.locator('.cm-editor').all();
  let sqlEditor = null;
  for (const ed of editors) {
    const isInPlot = await ed.evaluate(el => !!el.closest('[data-block-type="plot"]'));
    const isVisible = await ed.isVisible();
    if (!isInPlot && isVisible) { sqlEditor = ed; break; }
  }
  if (sqlEditor) {
    await sqlEditor.click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+a');
    await page.keyboard.type('SELECT * FROM Gar');
    await page.keyboard.press('Control+ ');
    await page.waitForTimeout(1000);
    const dropdown = await page.locator('.cm-tooltip-autocomplete, .cm-completionList, [role="listbox"]').isVisible().catch(() => false);
    console.log(`[gc-autocomplete] dropdown visible: ${dropdown}`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
  } else {
    console.log('[gc-autocomplete] no SQL editor found');
  }
} catch (e) {
  console.log(`[gc-autocomplete] error: ${e.message}`);
}

// ─── Section 3: Heap Allocation — interactive ───────────────────────────────
console.log('\n=== Section 3: Heap Allocation ===');
await loadTemplate('Heap Allocation');
const heap = await domScan('heap-allocation');

// a) LINK_X zoom
try {
  const heapChartsZoom = await page.locator('.recharts-surface').all();
  console.log(`[heap-link-x] found ${heapChartsZoom.length} charts`);
  if (heapChartsZoom.length > 0) {
    const chart = heapChartsZoom[0];
    await chart.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const box = await chart.boundingBox();
    if (box && box.width > 100) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.keyboard.down('Shift');
      await page.mouse.wheel(0, -400);
      await page.keyboard.up('Shift');
      await page.waitForTimeout(1500);
      const resetVisible = await page.locator('button').filter({ hasText: /reset.*zoom|zoom.*reset/i }).isVisible().catch(() => false);
      console.log(`[heap-link-x] zoom reset button visible: ${resetVisible}`);
      if (resetVisible) {
        await page.locator('button').filter({ hasText: /reset.*zoom|zoom.*reset/i }).click();
        await page.waitForTimeout(500);
      }
    }
  }
} catch (e) {
  console.log(`[heap-link-x] error: ${e.message}`);
}

// b) Variables
try {
  const heapInputs = await page.locator('input').all();
  let heapVarInput = null;
  for (const inp of heapInputs) {
    const ph = await inp.getAttribute('placeholder').catch(() => '');
    const label = await inp.evaluate(el => {
      const parent = el.closest('[data-cell-id]') || el.parentElement?.parentElement;
      return parent ? parent.textContent || '' : '';
    });
    if ((ph && (ph.includes('limit') || ph.includes('top'))) ||
        label.includes('$limit') || label.includes('$top') || label.includes('top_n')) {
      heapVarInput = inp;
      break;
    }
  }
  if (heapVarInput) {
    const origVal = await heapVarInput.inputValue();
    await heapVarInput.selectText();
    await heapVarInput.fill(String(Number(origVal || '10') + 5));
    await heapVarInput.press('Enter');
    await page.waitForTimeout(3000);
    console.log('[heap-variables] changed variable');
    await domScan('heap-after-var-change');
    await heapVarInput.selectText();
    await heapVarInput.fill(origVal);
    await heapVarInput.press('Enter');
    await page.waitForTimeout(1500);
  } else {
    console.log('[heap-variables] no variable input found');
  }
} catch (e) {
  console.log(`[heap-variables] error: ${e.message}`);
}

// c) SQL autocomplete
try {
  const heapEditors = await page.locator('.cm-editor').all();
  let heapSqlEditor = null;
  for (const ed of heapEditors) {
    const isInPlot = await ed.evaluate(el => !!el.closest('[data-block-type="plot"]'));
    const isVisible = await ed.isVisible();
    if (!isInPlot && isVisible) { heapSqlEditor = ed; break; }
  }
  if (heapSqlEditor) {
    await heapSqlEditor.click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+a');
    await page.keyboard.type('SELECT * FROM Obj');
    await page.keyboard.press('Control+ ');
    await page.waitForTimeout(1000);
    const dropdown = await page.locator('.cm-tooltip-autocomplete, .cm-completionList, [role="listbox"]').isVisible().catch(() => false);
    console.log(`[heap-autocomplete] dropdown visible: ${dropdown}`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
  } else {
    console.log('[heap-autocomplete] no SQL editor found');
  }
} catch (e) {
  console.log(`[heap-autocomplete] error: ${e.message}`);
}

// d) Plot tooltip
try {
  const heapCharts = await page.locator('.recharts-surface').all();
  if (heapCharts.length > 0) {
    const chart = heapCharts[0];
    await chart.scrollIntoViewIfNeeded();
    const box = await chart.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
      await page.waitForTimeout(600);
      const tooltipWrapper = page.locator('.recharts-tooltip-wrapper');
      const tooltipStyle = await tooltipWrapper.getAttribute('style').catch(() => '');
      const tooltipVisible = tooltipStyle ? !tooltipStyle.includes('visibility: hidden') : false;
      console.log(`[heap-tooltip] wrapper visible: ${tooltipVisible}, style: ${(tooltipStyle || '').slice(0, 80)}`);
    }
  } else {
    console.log('[heap-tooltip] no charts found');
  }
} catch (e) {
  console.log(`[heap-tooltip] error: ${e.message}`);
}

// e) Resize handle
try {
  const resizeHandle = page.locator('[data-resize-handle], .resize-handle, [title*="esize" i]').first();
  const hasHandle = await resizeHandle.isVisible({ timeout: 2000 }).catch(() => false);
  if (hasHandle) {
    const handleBox = await resizeHandle.boundingBox();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2 + 60);
    await page.mouse.up();
    console.log('[resize-handle] dragged 60px');
  } else {
    console.log('[resize-handle] not found — trying bottom edge of plot cell');
    const plotCell = page.locator('[data-cell-id]').filter({ has: page.locator('.recharts-surface') }).first();
    if (await plotCell.isVisible({ timeout: 2000 }).catch(() => false)) {
      const cellBox = await plotCell.boundingBox();
      if (cellBox) {
        await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height - 5);
        await page.mouse.down();
        await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height + 50);
        await page.mouse.up();
        console.log('[resize-handle] bottom-edge drag done');
      }
    } else {
      console.log('[resize-handle] no plot cell found');
    }
  }
} catch (e) {
  console.log(`[resize-handle] error: ${e.message}`);
}

// ─── Section 4: Remaining 11 templates — DOM scan only ───────────────────────
console.log('\n=== Section 4: Remaining 11 templates ===');
const remaining = [
  'CPU Profiling', 'JVM Internals', 'Memory Leak Detection',
  'I/O & Latency', 'Threading & Contention', 'Container & Cloud',
  'Exceptions & Errors', 'Recording Overview', 'GC Deep Dive',
  'Comprehensive Feature Test', 'ZGC Analysis'
];

const sweepResults = {};
for (const title of remaining) {
  try {
    await loadTemplate(title);
    const result = await domScan(title);
    sweepResults[title] = result;
  } catch (e) {
    console.log(`[${title}] load error: ${e.message}`);
    sweepResults[title] = { errs: [`load error: ${e.message}`], charts: 0 };
  }
}

// ─── Section 5: UI polish ────────────────────────────────────────────────────
console.log('\n=== Section 5: UI polish ===');
try {
  const zeroH = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-cell-id]'))
      .filter(el => el.getBoundingClientRect().height < 10 && el.offsetParent !== null).length
  );
  const overflowItems = await page.evaluate(() =>
    Array.from(document.querySelectorAll('p, h1, h2, h3, h4, span, td, th'))
      .filter(el => el.scrollWidth > el.clientWidth + 5 && el.offsetParent !== null && el.textContent.trim().length > 0)
      .slice(0, 5).map(el => el.textContent.trim().slice(0, 60))
  );
  console.log(`[ui-polish] zero-height=${zeroH} overflow=${JSON.stringify(overflowItems)}`);
} catch (e) {
  console.log(`[ui-polish] error: ${e.message}`);
}

// ─── Final summary ───────────────────────────────────────────────────────────
console.log('\n=== Summary ===');
console.log(`DEMO: errors=${demo.errs.length}, charts=${demo.charts}`);
console.log(`GC_PAUSE_ANALYSIS: errors=${gc.errs.length}, charts=${gc.charts}`);
console.log(`HEAP_ALLOCATION: errors=${heap.errs.length}, charts=${heap.charts}`);
console.log('DOM_SWEEP_11:');
for (const [title, r] of Object.entries(sweepResults)) {
  console.log(`  ${title}: errors=${r.errs.length}, charts=${r.charts}`);
}
console.log(`CONSOLE_ERRORS: ${realErrors.length}`);
if (realErrors.length > 0) {
  realErrors.forEach((e, i) => console.log(`  [err-${i + 1}] ${e}`));
}

await browser.close();
