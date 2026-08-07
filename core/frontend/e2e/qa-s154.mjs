// QA Session S154 — Comprehensive Feature Test deep + Recording Overview interactive, all-11 sweep
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
  // Try clicking Templates button
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

  // Search for the template
  const search = page.locator('input[placeholder*="earch" i]').first();
  await search.fill(title);
  await page.waitForTimeout(600);

  // Click the result
  await page.locator('li, [role="option"], button').filter({ hasText: title }).first().click({ timeout: 5000 });
  await page.waitForTimeout(800);

  // Confirm load dialog if present
  for (const lbl of ['Replace', 'Load', 'Open', 'Use template', 'Insert']) {
    const btn = page.locator('button').filter({ hasText: new RegExp(`^${lbl}$`, 'i') });
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) { await btn.click(); break; }
  }
  await page.waitForTimeout(10000);
}

// ─── Section 1: Demo notebook ───────────────────────────────────────────────
console.log('\n=== Section 1: Demo notebook ===');
await page.goto('http://localhost:3001');
await page.waitForTimeout(2000);
// Clear localStorage after navigating to a real page
await page.evaluate(() => { try { localStorage.clear(); } catch(e) {} });

// Dismiss tour overlay if shown
const closeOverlay = page.locator('button').filter({ hasText: /close|skip|dismiss|×/i }).first();
if (await closeOverlay.isVisible({ timeout: 2000 }).catch(() => false)) await closeOverlay.click();

// Load demo notebook
const demoBtn = page.locator('button, a').filter({ hasText: /try.*demo|demo/i }).first();
if (await demoBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
  await demoBtn.click();
} else {
  // Try toolbar demo button
  const demoBtns = page.locator('button').filter({ hasText: /demo/i });
  const cnt = await demoBtns.count();
  if (cnt > 0) await demoBtns.first().click();
}
await page.waitForTimeout(8000);

// Dismiss any tour shown after demo load
const skipBtn = page.locator('button').filter({ hasText: /skip|close|dismiss/i }).first();
if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) await skipBtn.click();
await page.waitForTimeout(500);

const demo = await domScan('demo');

// 1a. Variables panel: look for variable inputs
const varInputs = await page.locator('input[data-variable], input[placeholder*="variable" i], [data-testid*="variable" i] input').all();
const notebookVarInputs = await page.locator('[class*="variable" i] input, [class*="Variable" i] input').all();
console.log(`[demo-vars] direct var inputs=${varInputs.length}, class-based=${notebookVarInputs.length}`);
// Also check sidebar notebook variables section
const settingsPanel = page.locator('[class*="settings" i], [class*="sidebar" i]').first();
const settingsVisible = await settingsPanel.isVisible({ timeout: 1000 }).catch(() => false);
console.log(`[demo-vars] settings panel visible: ${settingsVisible}`);

// 1b. Run All: click Run All
let runAllClicked = false;
const runAllByLabel = page.locator('[aria-label="Run All Queries"]');
if (await runAllByLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
  await runAllByLabel.click();
  runAllClicked = true;
} else {
  const runAllBtn = page.locator('button').filter({ hasText: /run all/i }).first();
  if (await runAllBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await runAllBtn.click();
    runAllClicked = true;
  }
}
if (runAllClicked) {
  await page.waitForTimeout(10000);
  const afterRunAll = await domScan('demo-after-run-all');
  console.log(`[demo-run-all] clicked=true, charts-after=${afterRunAll.charts}`);
} else {
  console.log('[demo-run-all] Run All button not found');
}

// 1c. Schema Explorer
let schemaOpened = false;
for (const sel of [
  'button[aria-label*="schema" i]', '[title*="schema" i]',
  'button[aria-label*="Schema" i]', '.sidebar button', 'button[data-testid*="schema" i]'
]) {
  const el = page.locator(sel).first();
  if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
    await el.click();
    schemaOpened = true;
    break;
  }
}
if (!schemaOpened) {
  // Try sidebar tabs
  const tabs = page.locator('[role="tab"], .sidebar-tab, [class*="tab" i]');
  const tabCnt = await tabs.count();
  for (let i = 0; i < tabCnt; i++) {
    const txt = await tabs.nth(i).textContent().catch(() => '');
    if (txt.toLowerCase().includes('schema') || txt.toLowerCase().includes('table')) {
      await tabs.nth(i).click();
      schemaOpened = true;
      break;
    }
  }
}
await page.waitForTimeout(1500);
// Expand first table if found
const tableRows = await page.locator('[class*="schema" i] [class*="table" i], [class*="schema" i] li, [class*="tree" i] li').all();
if (tableRows.length > 0) {
  await tableRows[0].click().catch(() => {});
  await page.waitForTimeout(800);
}
const colItems = await page.locator('[class*="column" i], [class*="field" i], [class*="schema" i] span').count();
console.log(`[demo-schema] opened=${schemaOpened} column-items=${colItems}`);

// 1d. Help modal
let helpOpened = false;
for (const sel of [
  'button[aria-label*="help" i]', 'button[aria-label*="keyboard" i]',
  'button[aria-label*="shortcut" i]', 'button[title*="help" i]',
  'button:has-text("?")', '[data-testid*="help" i]'
]) {
  const el = page.locator(sel).first();
  if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
    await el.click();
    helpOpened = true;
    break;
  }
}
await page.waitForTimeout(800);
const modalContent = await page.locator('[role="dialog"], .modal, [class*="modal" i]').first().textContent().catch(() => '');
const modalLen = modalContent.length;
console.log(`[demo-help] opened=${helpOpened} modal-content-len=${modalLen}`);
if (modalLen > 100) await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// 1e. Command palette: try Ctrl+K (Meta+K doesn't work in headless)
await page.keyboard.press('Control+k');
await page.waitForTimeout(800);
const paletteVisible = await page.locator('.cm-tooltip-autocomplete, [class*="palette" i], [class*="command" i] input, [role="dialog"] input').first().isVisible({ timeout: 1000 }).catch(() => false);
console.log(`[demo-command-palette] Ctrl+K palette visible: ${paletteVisible}`);
if (paletteVisible) await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// ─── Section 2: Comprehensive Feature Test ──────────────────────────────────
console.log('\n=== Section 2: Comprehensive Feature Test ===');
await loadTemplate('Comprehensive Feature Test');
const comp = await domScan('comprehensive');

// 2a. LINK_X zoom
const charts = await page.locator('.recharts-surface').all();
let zoomResetVisible = false;
if (charts.length > 0) {
  const chart = charts[0];
  await chart.scrollIntoViewIfNeeded();
  const box = await chart.boundingBox();
  if (box && box.width > 100 && box.height > 50) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, -500);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(1500);
    zoomResetVisible = await page.locator('button').filter({ hasText: /reset.*zoom/i }).isVisible().catch(() => false);
    console.log(`[comp-link-x] charts=${charts.length} zoom-reset-visible=${zoomResetVisible}`);
    if (zoomResetVisible) {
      await page.locator('button').filter({ hasText: /reset.*zoom/i }).click();
      await page.waitForTimeout(500);
    }
  } else {
    console.log(`[comp-link-x] chart box too small: ${JSON.stringify(box)}`);
  }
} else {
  console.log('[comp-link-x] no recharts-surface found');
}

// 2b. SQL autocomplete
const allEditors = await page.locator('.cm-editor').all();
let sqlEd = null;
for (const ed of allEditors) {
  const isPlot = await ed.evaluate(el => !!el.closest('[data-block-type="plot"]')).catch(() => false);
  const vis = await ed.isVisible().catch(() => false);
  if (!isPlot && vis) { sqlEd = ed; break; }
}
if (sqlEd) {
  await sqlEd.scrollIntoViewIfNeeded();
  await sqlEd.click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('SELECT * FROM Gar');
  await page.keyboard.press('Control+ ');
  await page.waitForTimeout(1200);
  const dropdown = await page.locator('.cm-tooltip-autocomplete, .cm-completionList').isVisible().catch(() => false);
  console.log(`[comp-autocomplete] editor-found=true dropdown=${dropdown}`);
  await page.keyboard.press('Escape');
} else {
  console.log('[comp-autocomplete] no SQL editor outside plot block found');
}

// 2c. Plot tooltip
const allCharts = await page.locator('.recharts-surface').all();
let tooltipHit = false;
for (const chart of allCharts.slice(0, 4)) {
  const box = await chart.boundingBox();
  if (!box || box.width < 100) continue;
  await chart.scrollIntoViewIfNeeded();
  for (const frac of [0.3, 0.4, 0.5, 0.6]) {
    await page.mouse.move(box.x + box.width * frac, box.y + box.height * 0.5);
    await page.waitForTimeout(300);
    const wrapper = page.locator('.recharts-tooltip-wrapper');
    const style = await wrapper.getAttribute('style').catch(() => '');
    if (style && !style.includes('visibility: hidden')) {
      const tooltipContent = await wrapper.textContent().catch(() => '');
      if (tooltipContent && tooltipContent.trim().length > 0) {
        console.log(`[comp-tooltip] VISIBLE — "${tooltipContent.slice(0, 80)}"`);
        tooltipHit = true;
        break;
      }
    }
  }
  if (tooltipHit) break;
}
if (!tooltipHit) console.log('[comp-tooltip] no tooltip triggered on first 4 charts');

// 2d. Resize handle
const resizeHandles = page.locator('[data-resize-handle], [class*="resize"]');
const resizeCount = await resizeHandles.count();
console.log(`[comp-resize] resize-handles-found=${resizeCount}`);
if (resizeCount > 0) {
  const handle = resizeHandles.first();
  await handle.scrollIntoViewIfNeeded();
  const hbox = await handle.boundingBox();
  if (hbox) {
    await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
    await page.mouse.down();
    await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2 + 60);
    await page.mouse.up();
    console.log('[comp-resize] drag done');
  }
}

// 2e. BRUSH clause check
const hasBrush = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.cm-editor, [data-cell-id]'))
    .some(el => el.textContent.includes('BRUSH'))
);
console.log(`[comp-brush] BRUSH-present=${hasBrush}`);
if (hasBrush) {
  const bars = page.locator('.recharts-bar-rectangle, .recharts-rectangle');
  if (await bars.count() > 0) {
    await bars.first().scrollIntoViewIfNeeded();
    await bars.first().click().catch(() => {});
    await page.waitForTimeout(800);
    console.log('[comp-brush] clicked bar');
  }
}

// ─── Section 3: Recording Overview ─────────────────────────────────────────
console.log('\n=== Section 3: Recording Overview ===');
await loadTemplate('Recording Overview');
const overview = await domScan('recording-overview');

// 3a. LINK_X zoom
const ovCharts = await page.locator('.recharts-surface').all();
let ovZoomReset = false;
if (ovCharts.length > 0) {
  const c = ovCharts[0];
  await c.scrollIntoViewIfNeeded();
  const box = await c.boundingBox();
  if (box && box.width > 100 && box.height > 50) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, -500);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(1500);
    ovZoomReset = await page.locator('button').filter({ hasText: /reset.*zoom/i }).isVisible().catch(() => false);
    console.log(`[overview-link-x] charts=${ovCharts.length} zoom-reset=${ovZoomReset}`);
    if (ovZoomReset) {
      await page.locator('button').filter({ hasText: /reset.*zoom/i }).click();
      await page.waitForTimeout(500);
    }
  }
} else {
  console.log('[overview-link-x] no charts');
}

// 3b. Variables: look for variable inputs or notebook-level variables
const ovVarInputs = await page.locator('[class*="variable" i] input, input[data-variable], [data-testid*="variable" i] input').all();
console.log(`[overview-vars] variable inputs found=${ovVarInputs.length}`);
if (ovVarInputs.length > 0) {
  const vi = ovVarInputs[0];
  const oldVal = await vi.inputValue().catch(() => '');
  await vi.fill('test-value');
  await page.waitForTimeout(3000);
  // Restore old value
  await vi.fill(oldVal || '');
  await page.waitForTimeout(500);
  console.log(`[overview-vars] changed value from "${oldVal}" to "test-value", restored`);
}

// 3c. Plot tooltip on overview charts
let ovTooltipHit = false;
for (const chart of ovCharts.slice(0, 3)) {
  const box = await chart.boundingBox();
  if (!box || box.width < 100) continue;
  await chart.scrollIntoViewIfNeeded();
  for (const frac of [0.3, 0.5, 0.7]) {
    await page.mouse.move(box.x + box.width * frac, box.y + box.height * 0.5);
    await page.waitForTimeout(300);
    const wrapper = page.locator('.recharts-tooltip-wrapper');
    const style = await wrapper.getAttribute('style').catch(() => '');
    if (style && !style.includes('visibility: hidden')) {
      const tooltipContent = await wrapper.textContent().catch(() => '');
      if (tooltipContent && tooltipContent.trim().length > 0) {
        console.log(`[overview-tooltip] VISIBLE — "${tooltipContent.slice(0, 80)}"`);
        ovTooltipHit = true;
        break;
      }
    }
  }
  if (ovTooltipHit) break;
}
if (!ovTooltipHit) console.log('[overview-tooltip] no tooltip triggered');

// ─── Section 4: Remaining 11 templates DOM scan ──────────────────────────────
console.log('\n=== Section 4: DOM sweep of remaining 11 templates ===');
const remaining = [
  'CPU Profiling', 'JVM Internals', 'Heap Allocation',
  'I/O & Latency', 'Threading & Contention', 'Memory Leak Detection',
  'Container & Cloud', 'Exceptions & Errors',
  'GC Pause Analysis', 'GC Deep Dive', 'ZGC Analysis'
];
const sweepResults = {};
for (const title of remaining) {
  await loadTemplate(title);
  sweepResults[title] = await domScan(title);
}

// ─── Section 5: UI Polish ───────────────────────────────────────────────────
console.log('\n=== Section 5: UI Polish ===');
const zeroH = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-cell-id]'))
    .filter(el => el.getBoundingClientRect().height < 10 && el.offsetParent !== null).length
);
const overflow = await page.evaluate(() =>
  Array.from(document.querySelectorAll('p, h1, h2, h3, h4, span, td, th'))
    .filter(el => el.scrollWidth > el.clientWidth + 5 && el.offsetParent !== null && el.textContent.trim().length > 0)
    .slice(0, 5).map(el => el.textContent.trim().slice(0, 60))
);
const visibleErrors = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.error, [class*="error" i]'))
    .filter(el => el.offsetParent !== null && el.textContent.trim().length > 5).length
);
console.log(`[ui-polish] zero-height=${zeroH} overflow=${JSON.stringify(overflow)} visible-errors=${visibleErrors}`);
console.log(`[real-errors] count=${realErrors.length} list=${JSON.stringify(realErrors)}`);

await browser.close();

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n=== SUMMARY ===');
console.log(`DEMO: charts=${demo.charts} errors=${demo.errs.length}`);
console.log(`COMPREHENSIVE: charts=${comp.charts} errors=${comp.errs.length}`);
console.log(`RECORDING_OVERVIEW: charts=${overview.charts} errors=${overview.errs.length}`);
console.log('DOM_SWEEP_11:');
for (const [title, r] of Object.entries(sweepResults)) {
  console.log(`  ${title}: charts=${r.charts} errors=${r.errs.length}`);
}
console.log(`UI_POLISH: zero-height=${zeroH} overflow=${overflow.length}`);
console.log(`CONSOLE_ERRORS: ${realErrors.length}`);
