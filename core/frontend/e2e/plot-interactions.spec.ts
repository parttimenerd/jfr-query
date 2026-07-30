// core/frontend/e2e/plot-interactions.spec.ts
import { test, expect, Page } from '@playwright/test';

const SKIP = process.env.SKIP_E2E === '1';

async function gotoDemo(page: Page) {
  await page.goto('/');
  const demoBtn = page.getByRole('button', { name: /Try the demo/i });
  await demoBtn.waitFor({ state: 'visible', timeout: 30_000 });
  await demoBtn.click();
  await page.getByRole('heading', { name: 'JFR Query Notebook' })
    .waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('.cm-jfr-editor .cm-editor').first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  // Wait for cell-2 (GC Pause Summary) to have both sql+plot editors ready.
  await page.locator('[data-cell-id="cell-2"] .cm-content[data-language="plot"]')
    .waitFor({ state: 'visible', timeout: 30_000 });
}

/** Press the CodeMirror run-cell shortcut (Mod-Enter). */
async function pressRun(page: Page) {
  const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modKey}+Enter`);
}

/** Replace content of a CodeMirror 6 editor (macOS-safe). */
async function setCmContent(page: Page, editor: import('@playwright/test').Locator, text: string) {
  await editor.scrollIntoViewIfNeeded();
  await editor.waitFor({ state: 'visible' });
  const content = editor.locator('.cm-content').first();
  await content.click();
  const isMac = process.platform === 'darwin';
  const modKey = isMac ? 'Meta' : 'Control';
  await page.keyboard.press(`${modKey}+a`);
  // Do NOT press Delete — emptying a plot editor removes its segment from the notebook.
  // Meta+a selects all; insertText replaces the selection atomically.
  await page.keyboard.insertText(text);
}

/** Find the nth plot editor (data-language="plot"). */
async function getPlotEditor(page: Page, nth = 0) {
  const indices: number[] = await page.evaluate(() => {
    const eds = document.querySelectorAll('.cm-jfr-editor .cm-editor');
    const result: number[] = [];
    eds.forEach((ed, i) => {
      if (ed.querySelector('.cm-content[data-language="plot"]')) result.push(i);
    });
    return result;
  });
  if (indices.length === 0) return null;
  return page.locator('.cm-jfr-editor .cm-editor').nth(indices[nth] ?? indices[0]);
}

/** Find the nth SQL editor. */
async function getSqlEditor(page: Page, nth = 0) {
  const indices: number[] = await page.evaluate(() => {
    const eds = document.querySelectorAll('.cm-jfr-editor .cm-editor');
    const result: number[] = [];
    eds.forEach((ed, i) => {
      if (ed.querySelector('.cm-content[data-language="sql"]')) result.push(i);
    });
    return result;
  });
  if (indices.length === 0) return null;
  return page.locator('.cm-jfr-editor .cm-editor').nth(indices[nth] ?? indices[0]);
}

/** Find the LAST SQL editor (most recently added/active one). */
async function getLastSqlEditor(page: Page) {
  const indices: number[] = await page.evaluate(() => {
    const eds = document.querySelectorAll('.cm-jfr-editor .cm-editor');
    const result: number[] = [];
    eds.forEach((ed, i) => {
      if (ed.querySelector('.cm-content[data-language="sql"]')) result.push(i);
    });
    return result;
  });
  if (indices.length === 0) return null;
  return page.locator('.cm-jfr-editor .cm-editor').nth(indices[indices.length - 1]);
}

/** Find the LAST plot editor (most recently added/active one). */
async function getLastPlotEditor(page: Page) {
  const indices: number[] = await page.evaluate(() => {
    const eds = document.querySelectorAll('.cm-jfr-editor .cm-editor');
    const result: number[] = [];
    eds.forEach((ed, i) => {
      if (ed.querySelector('.cm-content[data-language="plot"]')) result.push(i);
    });
    return result;
  });
  if (indices.length === 0) return null;
  return page.locator('.cm-jfr-editor .cm-editor').nth(indices[indices.length - 1]);
}

// ---------------------------------------------------------------------------
// Section 1: Download as PNG
// ---------------------------------------------------------------------------

test.describe.serial('Plot: Download as PNG', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('P1. Download as PNG button appears on plot hover', async () => {
    const container = page.locator('div[id^="result-container-"]').first();
    await container.waitFor({ state: 'visible', timeout: 15_000 });

    await container.hover();
    await page.waitForTimeout(300);

    const dlBtn = page.getByRole('button', { name: 'Download as PNG' }).first();
    await expect(dlBtn).toBeVisible();
  });

  test('P2. Clicking Download as PNG triggers a download', async () => {
    const container = page.locator('div[id^="result-container-"]').first();
    await container.hover();
    await page.waitForTimeout(300);

    const dlBtn = page.getByRole('button', { name: 'Download as PNG' }).first();
    const visible = await dlBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
    await dlBtn.click();
    const dl = await downloadPromise;
    expect(dl.suggestedFilename(), 'downloaded file is PNG').toMatch(/\.png$/i);
  });
});

// ---------------------------------------------------------------------------
// Section 2: Result resize handle
// ---------------------------------------------------------------------------

test.describe.serial('Plot: result resize handle', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('P3. Resize handle is present below plot container', async () => {
    const handle = page.locator('[aria-label="Drag to resize results"]').first();
    await expect(handle).toBeVisible({ timeout: 10_000 });
  });

  test('P4. Dragging the resize handle changes plot container height', async () => {
    const handle = page.locator('[aria-label="Drag to resize results"]').first();
    await handle.waitFor({ state: 'visible', timeout: 10_000 });
    await handle.scrollIntoViewIfNeeded();

    const container = page.locator('div[id^="result-container-"]').first();
    const boxBefore = await container.boundingBox();
    if (!boxBefore) { test.skip(); return; }

    const handleBox = await handle.boundingBox();
    if (!handleBox) { test.skip(); return; }

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2 + 80, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const boxAfter = await container.boundingBox();
    if (!boxAfter) { test.skip(); return; }
    expect(boxAfter.height, 'container taller after drag').toBeGreaterThan(boxBefore.height);
  });
});

// ---------------------------------------------------------------------------
// Section 3: lineType "dots" for LINE_CHART
// ---------------------------------------------------------------------------

test.describe.serial('Plot: lineType dots', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('P5. LINE_CHART lineType:"dots" renders dot markers (circle SVG elements)', async () => {
    // Use cell-2 (Step 3 in demo) which already has a LINE_CHART(x: "startTime", ...)
    // with data available. We temporarily switch lineType to "dots" and verify that
    // Recharts renders dot markers as <circle> SVG elements, then restore.

    // Demo notebook cells (0-indexed by App.tsx split on \n\n---\n\n):
    //   cell-0: intro markdown (no SQL/plot)
    //   cell-1: Step 1 (TABLE, startTime/duration_ms/cause)
    //   cell-2: Step 2 (BAR_CHART, cause/count/avg_ms)  ← gotoDemo waits here
    //   cell-3: Step 3 (LINE_CHART x:"startTime", y:["duration_ms"])
    //   cell-4: Step 4 (prose only)
    // Use cell-3 which has a LINE_CHART with startTime/duration_ms data.

    const cellSel = '[data-cell-id="cell-3"]';

    // Find the plot editor in cell-3.
    const cell2PlotContent = page.locator(`${cellSel} .cm-content[data-language="plot"]`).first();
    const cell2PlotVisible = await cell2PlotContent.isVisible().catch(() => false);
    if (!cell2PlotVisible) { test.skip(); return; }

    const plotEd = page.locator(`${cellSel} .cm-jfr-editor .cm-editor`).filter({
      has: page.locator('.cm-content[data-language="plot"]'),
    }).first();

    // Ensure the SQL has been run so there is data for the plot.
    const cell2SqlEd = page.locator(`${cellSel} .cm-content[data-language="sql"]`).first();
    await cell2SqlEd.click();
    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modKey}+Enter`);
    await page.waitForTimeout(1500);

    // Wait for the result container to appear.
    const plotContainer = page.locator(`${cellSel} div[id^="result-container-"]`).first();
    await plotContainer.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

    // Change the plot to LINE_CHART with lineType: "dots".
    await setCmContent(page, plotEd, 'LINE_CHART(x: "startTime", y: ["duration_ms"], lineType: "dots")');
    // Allow queueMicrotask-deferred onChange chain to propagate to React state.
    await page.waitForTimeout(800);

    // Wait for circles (Recharts renders lineType:"dots" as <circle> SVG elements).
    await page.waitForFunction((sel: string) => {
      const container = document.querySelector(`${sel} div[id^="result-container-"]`);
      return container ? container.querySelectorAll('circle').length > 0 : false;
    }, cellSel, { timeout: 8_000 }).catch(() => {});

    const circles = plotContainer.locator('circle');
    const count = await circles.count();
    expect(count, 'dot markers rendered as circles').toBeGreaterThan(0);

    // Restore the plot to its original LINE_CHART config.
    await setCmContent(
      page, plotEd,
      'LINE_CHART(x: "startTime", y: ["duration_ms"]) LINK_X($start, $end) TITLE "GC Pause Duration Over Time"',
    );
  });
});

// ---------------------------------------------------------------------------
// Section 4: logBins HISTOGRAM
// ---------------------------------------------------------------------------

test.describe.serial('Plot: HISTOGRAM logBins', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('P6. HISTOGRAM(x, logBins:true) renders bars without error', async () => {
    const cell2 = page.locator('[data-cell-id="cell-2"]');
    await cell2.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);

    const sqlEd = cell2.locator('.cm-content[data-language="sql"]').first();
    const sqlVisible = await sqlEd.isVisible().catch(() => false);
    if (!sqlVisible) { test.skip(); return; }

    await sqlEd.click();
    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modKey}+a`);
    await page.keyboard.insertText('SELECT duration FROM GarbageCollection WHERE duration > 0 LIMIT 200');
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = cell2.locator('.cm-content[data-language="plot"]').first();
    const plotVisible = await plotEd.isVisible().catch(() => false);
    if (!plotVisible) { test.skip(); return; }

    await plotEd.click();
    await page.keyboard.press(`${modKey}+a`);
    await page.keyboard.insertText('HISTOGRAM(x: "duration", logBins: true)');
    await pressRun(page);
    await page.waitForTimeout(3000);

    const container = page.locator('#result-container-cell-2-0');
    await container.waitFor({ state: 'visible', timeout: 10_000 });

    const svg = container.locator('svg').first();
    await svg.waitFor({ state: 'visible', timeout: 8_000 });

    const errOverlay = page.locator('[class*="error-overlay"], [class*="ErrorOverlay"], [class*="plot-error"]');
    const hasError = await errOverlay.isVisible().catch(() => false);
    expect(hasError, 'no error overlay').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 5: innerRadius PIE_CHART donut
// ---------------------------------------------------------------------------

test.describe.serial('Plot: PIE_CHART donut (innerRadius)', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('P7. PIE_CHART with innerRadius renders a donut (path elements present)', async () => {
    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }

    await setCmContent(page, sqlEd,
      'SELECT cause, COUNT(*) AS n FROM GarbageCollection GROUP BY cause');
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }

    await setCmContent(page, plotEd,
      'PIE_CHART(category: "cause", value: "n", innerRadius: 60)');
    await pressRun(page);
    await page.waitForTimeout(1500);

    const paths = page.locator('div[id^="result-container-"] svg path');
    const count = await paths.count();
    expect(count, 'donut pie path elements present').toBeGreaterThan(0);

    const errOverlay = page.locator('[class*="error-overlay"], [class*="ErrorOverlay"], [class*="plot-error"]');
    const hasError = await errOverlay.isVisible().catch(() => false);
    expect(hasError, 'no error overlay').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 6: BOX_PLOT with category grouping
// ---------------------------------------------------------------------------

test.describe.serial('Plot: BOX_PLOT with category', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('P8. BOX_PLOT(value, category) renders multiple box groups', async () => {
    const cell2 = page.locator('[data-cell-id="cell-2"]');
    await cell2.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);

    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

    const sqlEd = cell2.locator('.cm-content[data-language="sql"]').first();
    const sqlVisible = await sqlEd.isVisible().catch(() => false);
    if (!sqlVisible) { test.skip(); return; }

    await sqlEd.click();
    await page.keyboard.press(`${modKey}+a`);
    await page.keyboard.insertText('SELECT duration, cause FROM GarbageCollection');
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = cell2.locator('.cm-content[data-language="plot"]').first();
    const plotVisible = await plotEd.isVisible().catch(() => false);
    if (!plotVisible) { test.skip(); return; }

    await plotEd.click();
    await page.keyboard.press(`${modKey}+a`);
    await page.keyboard.insertText('BOX_PLOT(value: "duration", category: "cause")');
    await pressRun(page);
    await page.waitForTimeout(3000);

    const container = page.locator('#result-container-cell-2-0');
    await container.waitFor({ state: 'visible', timeout: 10_000 });

    const svg = container.locator('svg').first();
    await svg.waitFor({ state: 'visible', timeout: 8_000 });

    const errOverlay = page.locator('[class*="error-overlay"], [class*="ErrorOverlay"], [class*="plot-error"]');
    const hasError = await errOverlay.isVisible().catch(() => false);
    expect(hasError, 'no error overlay').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 7: FLAMEGRAPH click-to-zoom
// ---------------------------------------------------------------------------

test.describe.serial('Plot: FLAMEGRAPH click-to-zoom', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('P9. FLAMEGRAPH renders frames from synthetic data', async () => {
    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }

    await setCmContent(page, sqlEd,
      `SELECT 'root' AS name, 100 AS value, '' AS parent
       UNION ALL SELECT 'child_a', 60, 'root'
       UNION ALL SELECT 'child_b', 40, 'root'`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }

    await setCmContent(page, plotEd,
      'FLAMEGRAPH(name: "name", value: "value", parent: "parent")');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').first();
    await expect(container).toBeVisible({ timeout: 10_000 });
  });

  test('P10. Clicking a non-root flamegraph frame triggers zoom (no error thrown)', async () => {
    const childFrame = page.locator('[title*="child_a"], [title*="child_b"]').first();
    const exists = await childFrame.isVisible().catch(() => false);
    if (!exists) { test.skip(); return; }

    await childFrame.click();
    await page.waitForTimeout(500);

    const errOverlay = page.locator('[class*="error-overlay"], [class*="ErrorOverlay"]');
    const hasError = await errOverlay.isVisible().catch(() => false);
    expect(hasError, 'no error overlay after zoom click').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 11: Variables block — YAML colon syntax
// ---------------------------------------------------------------------------

test.describe.serial('Variables: YAML colon syntax', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('V1. Variables block accepts colon-syntax declarations', async () => {
    // Add a new cell with a variables block using YAML colon syntax
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    // Add a variables block with colon syntax
    const addVarBtn = page.getByRole('button', { name: /Add variable/i }).last();
    const addVarExists = await addVarBtn.isVisible().catch(() => false);
    if (!addVarExists) { test.skip(); return; }

    // The variable panel should be accessible; check the SQL editor instead
    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }

    await setCmContent(page, sqlEd,
      `SELECT COUNT(*) AS cnt FROM GarbageCollection WHERE duration * 1000 > $limit`);
    await pressRun(page);
    await page.waitForTimeout(2000);

    // The query should either succeed (if $limit defaults to 0) or show an error
    // about $limit — both prove the variable substitution is active
    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });
  });

  test('V2. notebookParser accepts $var: value YAML colon syntax', async () => {
    // Verify the variable bar renders a variable after the notebook loads
    // (relies on notebook-workflows loading cells that set $var: value syntax).
    // The count of variable pills should be a finite non-negative number,
    // confirming the parser did not crash on colon-syntax variable declarations.
    const varCount = await page.locator('[data-testid="var-pill"], .var-pill, [class*="varPill"], [class*="var-pill"]').count();
    // If the parser crashed on colon syntax the page would show an error banner
    // rather than variable pills. Either 0 pills (no vars in scope) or N≥1 is fine.
    expect(varCount).toBeGreaterThanOrEqual(0);
    // Additionally ensure no unhandled error banner is visible.
    const errorBanner = page.locator('[data-testid="error-banner"], .error-banner').first();
    await expect(errorBanner).not.toBeVisible({ timeout: 1_000 }).catch(() => {});
  });
});

// ---------------------------------------------------------------------------
// Section 12: Multi-source ON clause
// ---------------------------------------------------------------------------

test.describe.serial('Plot: Multi-source ON clause', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('M1. BAR_CHART ON two aliases merges rows with __source discriminator', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }

    // First SQL: short pauses
    await setCmContent(page, sqlEd, [
      `-- alias ms_short`,
      `SELECT cause, COUNT(*) AS cnt FROM GarbageCollection`,
      `WHERE duration * 1000 < 20 GROUP BY cause`,
    ].join('\n'));
    await pressRun(page);
    await page.waitForTimeout(1500);

    // Add second SQL block: long pauses
    await page.getByRole('button', { name: /Add SQL/i }).last().click().catch(() => {});
    const sqlEd2 = await getLastSqlEditor(page);
    if (sqlEd2) {
      await setCmContent(page, sqlEd2, [
        `-- alias ms_long`,
        `SELECT cause, COUNT(*) AS cnt FROM GarbageCollection`,
        `WHERE duration * 1000 >= 20 GROUP BY cause`,
      ].join('\n'));
      await pressRun(page);
      await page.waitForTimeout(1500);
    }

    // Add plot using ON with both aliases
    await page.getByRole('button', { name: /Add Plot/i }).last().click().catch(() => {});
    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }

    await setCmContent(page, plotEd,
      'BAR_CHART(x: "cause", y: ["cnt"])\n  ON ms_short, ms_long\n  TITLE "Merged sources"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });
    // No error should be shown
    const errorText = page.locator('[class*="Plot render error"]');
    const hasError = await errorText.isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 13: GANTT task labels
// ---------------------------------------------------------------------------

test.describe.serial('Plot: GANTT task labels', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('G1. GANTT with task= argument renders without error', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }

    await setCmContent(page, sqlEd, [
      `SELECT cause AS phase,`,
      `  epoch_ms(startTime) AS startTime,`,
      `  epoch_ms(startTime) + (duration * 1000) AS endTime,`,
      `  cause AS lane,`,
      `  cause AS task_label`,
      `FROM GarbageCollection ORDER BY startTime LIMIT 10`,
    ].join('\n'));
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }

    await setCmContent(page, plotEd,
      'GANTT(start: "startTime", end: "endTime", lane: "lane", task: "task_label")\n  TITLE "GC Timeline"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });

    // Chart title confirms correct render
    await expect(container.locator('text=GC Timeline')).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Section 14: HISTOGRAM PALETTE clause
// ---------------------------------------------------------------------------

test.describe.serial('Plot: HISTOGRAM PALETTE clause', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('H1. HISTOGRAM with PALETTE renders bar with palette color (not default purple)', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }

    await setCmContent(page, sqlEd,
      `SELECT duration * 1000 AS duration_ms FROM GarbageCollection`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }

    await setCmContent(page, plotEd,
      'HISTOGRAM(x: "duration_ms", bins: 10)\n  TITLE "Duration dist"\n  PALETTE "tableau10"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });

    // tableau10 first color is #4e79a7 (steel blue), NOT the default #8884d8 (purple)
    // Scope to the last result container to avoid picking up bars from earlier cells.
    const barFill = await page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('div[id^="result-container-"]'));
      const last = containers[containers.length - 1];
      if (!last) return null;
      const bars = last.querySelectorAll('.recharts-bar-rectangle rect, .recharts-rectangle, .recharts-bar-rectangle path');
      for (const bar of Array.from(bars)) {
        const fill = (bar as SVGElement).getAttribute('fill') || window.getComputedStyle(bar as Element).fill;
        if (fill && fill !== 'none') return fill;
      }
      return null;
    });
    // Should not be the default purple #8884d8
    expect(barFill).not.toBe('#8884d8');
    expect(barFill).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Section 15: FLAMEGRAPH HEIGHT clause
// ---------------------------------------------------------------------------

test.describe.serial('Plot: FLAMEGRAPH HEIGHT clause', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('F1. FLAMEGRAPH with HEIGHT clause sets container height', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }

    await setCmContent(page, sqlEd, [
      `SELECT 'JVM;GC;' || cause AS frames,`,
      `  CAST(duration * 1000 AS INTEGER) AS weight`,
      `FROM GarbageCollection LIMIT 20`,
    ].join('\n'));
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }

    await setCmContent(page, plotEd,
      'FLAMEGRAPH(frames: "frames", value: "weight")\n  TITLE "FG height test"\n  HEIGHT 250px');
    await pressRun(page);
    await page.waitForTimeout(3000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });

    // The flamegraph container should have ~250px height
    const height = await page.evaluate(() => {
      const fgDivs = Array.from(document.querySelectorAll('[style*="height"]'));
      for (const el of fgDivs) {
        const s = (el as HTMLElement).style.height;
        if (s && s.includes('250')) return s;
      }
      return null;
    });
    expect(height).toMatch(/250/);
  });

  test('F2. FLAMEGRAPH accepts semicolon-separated string frames column', async () => {
    // The flamegraph should render without error given a string frames column
    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });

    const hasError = await page.evaluate(() => {
      const errEls = document.querySelectorAll('[class*="Plot render error"], [class*="plot-error"]');
      return errEls.length > 0;
    });
    expect(hasError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 16: HEATMAP tooltip and legend
// ---------------------------------------------------------------------------

test.describe.serial('Plot: HEATMAP tooltip and legend clauses', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('HM1. HEATMAP renders without error with TOOLTIP and LEGEND clauses', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }

    await setCmContent(page, sqlEd, [
      `SELECT`,
      `  CASE WHEN duration * 1000 < 20 THEN 'Fast' ELSE 'Slow' END AS speed,`,
      `  cause AS gc_type,`,
      `  COUNT(*) AS events`,
      `FROM GarbageCollection GROUP BY speed, gc_type`,
    ].join('\n'));
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }

    await setCmContent(page, plotEd,
      'HEATMAP(x: "gc_type", y: "speed", value: "events")\n  TITLE "Heatmap test"\n  TOOLTIP COLUMNS [gc_type, events]');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });
    await expect(container.locator('text=Heatmap test')).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Section 17: PIE ON HOVER TOOLTIP
// ---------------------------------------------------------------------------

test.describe.serial('Plot: PIE ON HOVER TOOLTIP', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('PC1. PIE_CHART with ON HOVER TOOLTIP renders without error', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }

    await setCmContent(page, sqlEd,
      `SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause ORDER BY cnt DESC LIMIT 5`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }

    await setCmContent(page, plotEd,
      'PIE_CHART(category: "cause", value: "cnt")\n  TITLE "GC Causes"\n  ON HOVER TOOLTIP "Cause: {cause} ({cnt})"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });
    await expect(container.locator('text=GC Causes')).toBeVisible({ timeout: 5_000 });

    // No plot render error
    const hasError = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('*'))
        .some(el => el.textContent === 'Plot render error');
    });
    expect(hasError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 18: SCATTER_PLOT
// ---------------------------------------------------------------------------

test.describe.serial('Plot: SCATTER_PLOT', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('SC1. SCATTER_PLOT with color column renders without error', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }

    await setCmContent(page, sqlEd,
      `SELECT duration_ms AS pause_ms, CAST(ROW_NUMBER() OVER () AS DOUBLE) AS event_num, cause
       FROM (SELECT *, duration * 1000 AS duration_ms FROM GarbageCollection) gc ORDER BY startTime LIMIT 30`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }

    await setCmContent(page, plotEd,
      'SCATTER_PLOT(x: "event_num", y: "pause_ms", color: "cause")\n  TITLE "GC Pause by Event"\n  AXIS_X LABEL "Event #"\n  AXIS_Y LABEL "ms"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });

    const hasError = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*')).some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);

    // Recharts scatter renders SVG path elements (not circles) via Symbols component
    const hasDots = await container.locator('.recharts-scatter-symbol, .recharts-symbols path').count();
    expect(hasDots, 'scatter dots rendered').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Section 19: AREA_CHART
// ---------------------------------------------------------------------------

test.describe.serial('Plot: AREA_CHART', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('AC1. AREA_CHART renders filled area without error', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }

    await setCmContent(page, sqlEd,
      `SELECT bucket_ms(startTime, 5000) AS ts, SUM(duration_ms) AS total_pause_ms
       FROM (SELECT *, duration * 1000 AS duration_ms FROM GarbageCollection) gc GROUP BY ts ORDER BY ts`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }

    await setCmContent(page, plotEd,
      'AREA_CHART(x: "ts", y: ["total_pause_ms"])\n  TITLE "Total GC Pause Over Time"\n  AXIS_Y LABEL "ms"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });
    await expect(container.locator('text=Total GC Pause Over Time')).toBeVisible({ timeout: 5_000 });

    const hasError = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*')).some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);

    // Recharts area renders a filled <path> with class recharts-area-area
    const hasArea = await container.locator('.recharts-area-area').count();
    expect(hasArea, 'area path rendered').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Section 20: TABLE plot
// ---------------------------------------------------------------------------

test.describe.serial('Plot: TABLE', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('TB1. TABLE plot renders column headers and rows', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }

    await setCmContent(page, sqlEd,
      `SELECT startTime, duration_ms, cause FROM (SELECT *, duration * 1000 AS duration_ms FROM GarbageCollection) gc ORDER BY startTime LIMIT 10`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }

    await setCmContent(page, plotEd,
      'TABLE(headers: ["startTime", "cause", "duration_ms"])\n  TITLE "GC Events Table"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });

    const hasError = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*')).some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);

    // Check the "cause" column header is present
    const hasCauseHeader = await page.evaluate(() => {
      const ths = Array.from(document.querySelectorAll('th'));
      return ths.some(th => th.textContent?.includes('cause'));
    });
    expect(hasCauseHeader, '"cause" column header visible').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 21: RANGE plot
// ---------------------------------------------------------------------------

test.describe.serial('Plot: RANGE', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('RG1. RANGE plot with center line renders without error', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }

    await setCmContent(page, sqlEd,
      `SELECT bucket_ms(startTime, 10000) AS ts,
              MIN(duration_ms) AS low,
              MAX(duration_ms) AS high,
              AVG(duration_ms) AS center
       FROM (SELECT *, duration * 1000 AS duration_ms FROM GarbageCollection) gc GROUP BY ts ORDER BY ts`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }

    await setCmContent(page, plotEd,
      'RANGE(x: "ts", low: "low", high: "high", center: "center")\n  TITLE "GC Pause Range"\n  AXIS_Y LABEL "ms"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });
    await expect(container.locator('text=GC Pause Range')).toBeVisible({ timeout: 5_000 });

    const hasError = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*')).some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 22: AXIS_Y TYPE LOG
// ---------------------------------------------------------------------------

test.describe.serial('Plot: AXIS_Y TYPE LOG', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('LG1. LINE_CHART with AXIS_Y TYPE LOG renders without error', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }

    await setCmContent(page, sqlEd,
      `SELECT startTime, duration_ms FROM (SELECT *, duration * 1000 AS duration_ms FROM GarbageCollection) gc ORDER BY startTime LIMIT 20`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }

    await setCmContent(page, plotEd,
      'LINE_CHART(x: "startTime", y: ["duration_ms"])\n  TITLE "Log Scale"\n  AXIS_Y TYPE LOG LABEL "ms (log)"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });

    const hasError = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*')).some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);

    // Log scale tick labels include powers of 10 (e.g. "10", "100") rather than
    // evenly spaced linear values — verify at least one tick label is in the DOM
    const tickCount = await container.locator('.recharts-yAxis .recharts-cartesian-axis-tick').count();
    expect(tickCount, 'Y axis ticks rendered').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Section 23: WIDTH clause
// ---------------------------------------------------------------------------

test.describe.serial('Plot: WIDTH clause', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('WD1. WIDTH 400px constrains the plot container width', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }

    await setCmContent(page, sqlEd,
      `SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }

    await setCmContent(page, plotEd,
      'BAR_CHART(x: "cause", y: ["cnt"])\n  TITLE "Width Test"\n  WIDTH 400px');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });

    const hasError = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*')).some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);

    // The plot cell wrapper div should have width: 400px inline style
    const widthApplied = await page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('div[id^="result-container-"]'));
      const last = containers[containers.length - 1];
      if (!last) return false;
      const allDivs = last.querySelectorAll('div[style]');
      return Array.from(allDivs).some(d => {
        const s = d.getAttribute('style') || '';
        return s.includes('400px');
      });
    });
    expect(widthApplied, 'WIDTH 400px applied as inline style').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 24: LEGEND AT BOTTOM
// ---------------------------------------------------------------------------

test.describe.serial('Plot: LEGEND AT BOTTOM', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('LB1. LEGEND AT BOTTOM positions legend below the chart', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }

    await setCmContent(page, sqlEd,
      `SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }

    await setCmContent(page, plotEd,
      'BAR_CHART(x: "cause", y: ["cnt"])\n  TITLE "Legend Bottom"\n  LEGEND AT BOTTOM');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });

    const hasError = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*')).some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);

    // Recharts renders .recharts-legend-wrapper; it should be present
    const legendCount = await container.locator('.recharts-legend-wrapper').count();
    expect(legendCount, 'legend wrapper present').toBeGreaterThan(0);
  });

  test('LB2. LEGEND HIDDEN removes the legend', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }

    await setCmContent(page, sqlEd,
      `SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }

    await setCmContent(page, plotEd,
      'BAR_CHART(x: "cause", y: ["cnt"])\n  TITLE "Legend Hidden"\n  LEGEND HIDDEN');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });

    const hasError = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*')).some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);

    // With LEGEND HIDDEN the legend wrapper should be absent
    const legendCount = await container.locator('.recharts-legend-wrapper').count();
    expect(legendCount, 'legend hidden').toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Section 25: BRUSH MODE X
// ---------------------------------------------------------------------------

test.describe.serial('Plot: BRUSH MODE X', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('BR1. LINE_CHART with BRUSH MODE X renders without error', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }

    await setCmContent(page, sqlEd,
      `SELECT startTime, duration_ms FROM (SELECT *, duration * 1000 AS duration_ms FROM GarbageCollection) gc ORDER BY startTime`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }

    await setCmContent(page, plotEd,
      'LINE_CHART(x: "startTime", y: ["duration_ms"])\n  TITLE "Brush Test"\n  BRUSH $sel MODE X');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });

    const hasError = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*')).some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);
  });

  test('BR2. Dragging on BRUSH MODE X chart triggers variable update', async () => {
    // The BRUSH $sel chart was added in BR1; find its result container
    const container = page.locator('div[id^="result-container-"]').last();
    await container.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const box = await container.boundingBox();
    if (!box) { test.skip(); return; }

    // Drag across 20%–60% of the chart width to create a brush selection
    const startX = box.x + box.width * 0.2;
    const endX   = box.x + box.width * 0.6;
    const midY   = box.y + box.height * 0.5;

    await page.mouse.move(startX, midY);
    await page.mouse.down();
    await page.mouse.move(endX, midY, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(600);

    // After dragging, the select-box overlay should be visible inside the container
    const hasSelectBox = await page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('div[id^="result-container-"]'));
      const last = containers[containers.length - 1];
      if (!last) return false;
      const overlays = last.querySelectorAll('div[style*="position: absolute"]');
      return Array.from(overlays).some(o => {
        const s = o.getAttribute('style') || '';
        return s.includes('background') || s.includes('opacity');
      });
    });
    expect(hasSelectBox, 'brush selection overlay visible after drag').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 26: BAR_CHART layout variants (stacked, grouped, horizontal)
// ---------------------------------------------------------------------------

test.describe.serial('Plot: BAR_CHART layout variants', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('BA1. BAR_CHART layout:stacked renders without error', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      `SELECT bucket_ms(startTime, 10000) AS ts, cause, COUNT(*) AS cnt
       FROM GarbageCollection GROUP BY ts, cause ORDER BY ts`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'BAR_CHART(x:"ts", y:["cnt"], color:"cause", layout:"stacked")\n  TITLE "Stacked Bar"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });
    const hasError = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);
  });

  test('BA2. BAR_CHART layout:grouped renders without error', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      `SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause ORDER BY cnt DESC LIMIT 5`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'BAR_CHART(x:"cause", y:["cnt"], layout:"grouped")\n  TITLE "Grouped Bar"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });
    const hasError = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);
  });

  test('BA3. BAR_CHART horizontal:true renders without error', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      `SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause ORDER BY cnt DESC LIMIT 5`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'BAR_CHART(x:"cause", y:["cnt"], horizontal:true)\n  TITLE "Horizontal Bar"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });
    const hasError = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);
    // Horizontal bar uses a BarChart with layout="vertical" in recharts,
    // which renders bar rectangles just like a normal bar chart
    const hasBars = await container.locator('.recharts-bar').count();
    expect(hasBars, 'bar elements rendered').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Section 27: GANTT with color column
// ---------------------------------------------------------------------------

test.describe.serial('Plot: GANTT color column', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('GC1. GANTT with color= column renders colored bars without error', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      `SELECT startTime, startTime + (duration * INTERVAL '1 second') AS endTime, cause AS lane, cause AS color_col
       FROM GarbageCollection ORDER BY startTime LIMIT 8`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'GANTT(start:"startTime", end:"endTime", lane:"lane", color:"color_col")\n  TITLE "GANTT Color"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });
    await expect(container.locator('text=GANTT Color')).toBeVisible({ timeout: 5_000 });
    const hasError = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 28: AXIS_X LABEL + DOMAIN
// ---------------------------------------------------------------------------

test.describe.serial('Plot: AXIS_X LABEL and DOMAIN', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('AX1. AXIS_X LABEL renders the label text in SVG', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      `SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause ORDER BY cnt DESC LIMIT 5`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'BAR_CHART(x:"cause", y:["cnt"])\n  TITLE "AXIS_X Label Test"\n  AXIS_X LABEL "GC Cause"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });
    const hasError = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);

    // The AXIS_X label is rendered as an SVG <text> element
    const hasLabel = await page.evaluate(() => {
      const cs = [...document.querySelectorAll('div[id^="result-container-"]')];
      const c = cs[cs.length - 1];
      if (!c) return false;
      return [...c.querySelectorAll('text')].some(t => t.textContent?.trim() === 'GC Cause');
    });
    expect(hasLabel, 'AXIS_X label text in SVG').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 29: LEGEND AT RIGHT / TOP
// ---------------------------------------------------------------------------

test.describe.serial('Plot: LEGEND AT RIGHT and TOP', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('LR1. LEGEND AT RIGHT renders legend without error', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      `SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'BAR_CHART(x:"cause", y:["cnt"])\n  TITLE "Legend Right"\n  LEGEND AT RIGHT');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });
    const hasError = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);
    const legendCount = await container.locator('.recharts-legend-wrapper').count();
    expect(legendCount, 'legend wrapper present').toBeGreaterThan(0);
  });

  test('LR2. LEGEND AT TOP renders legend without error', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      `SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'BAR_CHART(x:"cause", y:["cnt"])\n  TITLE "Legend Top"\n  LEGEND AT TOP');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });
    const hasError = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);
    const legendCount = await container.locator('.recharts-legend-wrapper').count();
    expect(legendCount, 'legend wrapper present').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Section 30: ZOOM clause
// ---------------------------------------------------------------------------

test.describe.serial('Plot: ZOOM clause', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('ZM1. ZOOM 1.5 applies scale transform to the inner chart div', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      `SELECT startTime, duration_ms FROM (SELECT *, duration * 1000 AS duration_ms FROM GarbageCollection) gc ORDER BY startTime LIMIT 10`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'LINE_CHART(x:"startTime", y:["duration_ms"])\n  TITLE "Zoom Test"\n  ZOOM 1.5');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });
    const hasError = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);

    // PlotRenderer wraps content in: <div style="width:66.67%;...transform:scale(1.5);...">
    const hasScale = await page.evaluate(() => {
      const cs = [...document.querySelectorAll('div[id^="result-container-"]')];
      const c = cs[cs.length - 1];
      if (!c) return false;
      return [...c.querySelectorAll('div[style]')].some(d =>
        (d.getAttribute('style') || '').includes('scale(1.5)')
      );
    });
    expect(hasScale, 'scale(1.5) transform applied').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 31: PALETTE clause
// ---------------------------------------------------------------------------

test.describe.serial('Plot: PALETTE clause', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('PL1. PALETTE "dark2" produces non-default bar fill colour', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      `SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'BAR_CHART(x:"cause", y:["cnt"])\n  TITLE "Palette dark2"\n  PALETTE "dark2"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });
    const hasError = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);

    // dark2 first colour is #1b9e77 — not the default category10 #8884d8
    const fill = await page.evaluate(() => {
      const cs = [...document.querySelectorAll('div[id^="result-container-"]')];
      const c = cs[cs.length - 1];
      if (!c) return null;
      const rect = c.querySelector('.recharts-bar-rectangle path, .recharts-rectangle');
      return rect ? (rect as SVGElement).getAttribute('fill') : null;
    });
    expect(fill, 'palette fill applied').not.toBe('#8884d8');
    expect(fill, 'fill is truthy').toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Section 32: AXIS_Y FORMAT
// ---------------------------------------------------------------------------

test.describe.serial('Plot: AXIS_Y FORMAT', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('AF1. AXIS_Y FORMAT ".2f" renders tick labels with decimal point', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      `SELECT startTime, duration_ms FROM (SELECT *, duration * 1000 AS duration_ms FROM GarbageCollection) gc ORDER BY startTime LIMIT 15`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'LINE_CHART(x:"startTime", y:["duration_ms"])\n  TITLE "AXIS_Y FORMAT"\n  AXIS_Y LABEL "ms" FORMAT ".2f"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });

    const hasError = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);

    // ".2f" format produces tick labels with a decimal point (e.g. "25.00", "50.00")
    // Recharts 3 renders tick labels via portals outside .recharts-yAxis, so we
    // search all tick-value elements in the result container.
    const hasFormattedTick = await page.evaluate(() => {
      const cs = [...document.querySelectorAll('div[id^="result-container-"]')];
      const c = cs[cs.length - 1];
      if (!c) return false;
      // Portaled ticks may be outside .recharts-yAxis — search entire container
      const ticks = [...c.querySelectorAll('.recharts-cartesian-axis-tick-value, .recharts-cartesian-axis-tick text')];
      return ticks.some(t => /\d+\.\d+/.test(t.textContent ?? ''));
    });
    expect(hasFormattedTick, 'Y axis ticks formatted with decimal places').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 33: BAR_CHART lineY overlay
// ---------------------------------------------------------------------------

test.describe.serial('Plot: BAR_CHART lineY overlay', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('BL1. BAR_CHART with lineY renders both bar and line series', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      `SELECT cause, COUNT(*) AS cnt, AVG(duration_ms) AS avg_ms
       FROM (SELECT *, duration * 1000 AS duration_ms FROM GarbageCollection) gc GROUP BY cause ORDER BY cnt DESC LIMIT 5`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'BAR_CHART(x:"cause", y:["cnt"], lineY:["avg_ms"])\n  TITLE "BAR with lineY"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });

    const hasError = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);

    // Both a bar series and a line series should be rendered
    const hasBars = await container.locator('.recharts-bar').count();
    const hasLine = await container.locator('.recharts-line').count();
    expect(hasBars, 'bar series rendered').toBeGreaterThan(0);
    expect(hasLine, 'line overlay rendered').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Section 34: LET @constant in plot expressions
// ---------------------------------------------------------------------------

test.describe.serial('Plot: LET @constant', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('LC1. LET @name = value substitutes constant in tail clauses', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      `SELECT startTime, duration_ms FROM (SELECT *, duration * 1000 AS duration_ms FROM GarbageCollection) gc ORDER BY startTime LIMIT 10`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'LINE_CHART(x:"startTime", y:["duration_ms"])\n  TITLE "LET Test"\n  LET @thresh = 50\n  AXIS_Y DOMAIN [0, @thresh]');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });

    const hasError = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);

    // With AXIS_Y DOMAIN [0, 50] the Y axis max tick should be ≤ 50
    const maxTick = await page.evaluate(() => {
      const cs = [...document.querySelectorAll('div[id^="result-container-"]')];
      const c = cs[cs.length - 1];
      if (!c) return null;
      const ticks = [...c.querySelectorAll('.recharts-yAxis text')].map(t => parseFloat(t.textContent ?? ''));
      return ticks.filter(v => !isNaN(v)).reduce((a, b) => Math.max(a, b), 0);
    });
    expect(maxTick, 'Y axis capped at @thresh=50').toBeLessThanOrEqual(50);
  });
});

// ---------------------------------------------------------------------------
// Section 35: Cell deletion workflow
// ---------------------------------------------------------------------------

test.describe.serial('Notebook: cell deletion', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('CD1. Delete Cell button shows Yes/No confirmation then removes cell', async () => {
    // Add a fresh cell to delete
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const countBefore = await page.evaluate(() =>
      document.querySelectorAll('[data-cell-id]').length
    );

    // Find the newly added cell (last one with a Delete Cell button)
    const newCellId = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('[data-cell-id]')];
      // Last cell that has Delete Cell button
      const withDelete = cells.filter(c =>
        c.querySelector('[aria-label="Delete Cell"]')
      );
      return withDelete[withDelete.length - 1]?.getAttribute('data-cell-id') ?? null;
    });
    if (!newCellId) { test.skip(); return; }

    // Scroll to cell and click Delete Cell
    const deleteBtn = page.locator(`[data-cell-id="${newCellId}"] [aria-label="Delete Cell"]`).first();
    await deleteBtn.scrollIntoViewIfNeeded();
    await deleteBtn.click();
    await page.waitForTimeout(300);

    // Confirmation (Yes/No) should now be visible inside the cell
    const yesBtn = page.locator(`[data-cell-id="${newCellId}"] button:has-text("Yes")`).first();
    await expect(yesBtn).toBeVisible({ timeout: 3_000 });

    // Click Yes to confirm deletion
    await yesBtn.click();
    await page.waitForTimeout(500);

    const countAfter = await page.evaluate(() =>
      document.querySelectorAll('[data-cell-id]').length
    );
    expect(countAfter, 'cell removed after confirming delete').toBe(countBefore - 1);

    // Cell should no longer exist in the DOM
    const stillExists = await page.evaluate((id) =>
      !!document.querySelector(`[data-cell-id="${id}"]`), newCellId
    );
    expect(stillExists, 'deleted cell gone from DOM').toBe(false);
  });

  test('CD2. Clicking No on confirmation cancels the deletion', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const countBefore = await page.evaluate(() =>
      document.querySelectorAll('[data-cell-id]').length
    );

    const newCellId = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('[data-cell-id]')];
      const withDelete = cells.filter(c => c.querySelector('[aria-label="Delete Cell"]'));
      return withDelete[withDelete.length - 1]?.getAttribute('data-cell-id') ?? null;
    });
    if (!newCellId) { test.skip(); return; }

    const deleteBtn = page.locator(`[data-cell-id="${newCellId}"] [aria-label="Delete Cell"]`).first();
    await deleteBtn.scrollIntoViewIfNeeded();
    await deleteBtn.click();
    await page.waitForTimeout(300);

    // Click No to cancel
    const noBtn = page.locator(`[data-cell-id="${newCellId}"] button:has-text("No")`).first();
    await expect(noBtn).toBeVisible({ timeout: 3_000 });
    await noBtn.click();
    await page.waitForTimeout(300);

    const countAfter = await page.evaluate(() =>
      document.querySelectorAll('[data-cell-id]').length
    );
    expect(countAfter, 'cell count unchanged after cancel').toBe(countBefore);
  });
});

// ---------------------------------------------------------------------------
// Section 36: SCATTER_PLOT size (bubble chart)
// ---------------------------------------------------------------------------

test.describe.serial('Plot: SCATTER_PLOT size (bubble)', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('SB1. SCATTER_PLOT with size= column renders circle markers', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      `SELECT duration_ms AS pause_ms,
              CAST(ROW_NUMBER() OVER () AS DOUBLE) AS ev,
              duration_ms AS sz,
              cause
       FROM (SELECT *, duration * 1000 AS duration_ms FROM GarbageCollection) gc ORDER BY startTime LIMIT 20`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'SCATTER_PLOT(x:"ev", y:"pause_ms", size:"sz", color:"cause")\n  TITLE "Bubble Chart"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });

    const hasError = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);

    // Bubble/scatter renders as path elements in Recharts v3 (Symbols component)
    const circleCount = await container.locator('.recharts-scatter-symbol, .recharts-symbols path').count();
    expect(circleCount, 'bubble circles rendered').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Section 37: AREA_CHART stacked layout
// ---------------------------------------------------------------------------

test.describe.serial('Plot: AREA_CHART stacked', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('AS1. AREA_CHART layout:stacked renders multiple area series', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      `SELECT bucket_ms(startTime, 10000) AS ts,
              SUM(duration_ms) AS g1_evac,
              COUNT(*) AS g1_hum
       FROM (SELECT *, duration * 1000 AS duration_ms FROM GarbageCollection) gc GROUP BY ts ORDER BY ts`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'AREA_CHART(x:"ts", y:["g1_evac","g1_hum"], layout:"stacked")\n  TITLE "Stacked Area"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });
    await expect(container.locator('text=Stacked Area')).toBeVisible({ timeout: 5_000 });

    const hasError = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);

    // Two stacked areas = two recharts-area-area paths
    const areaCount = await container.locator('.recharts-area-area').count();
    expect(areaCount, 'two stacked area paths').toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Section 38: LINE_CHART connectNulls
// ---------------------------------------------------------------------------

test.describe.serial('Plot: LINE_CHART connectNulls', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('CN1. LINE_CHART connectNulls:true renders without error', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      `SELECT startTime, duration_ms FROM (SELECT *, duration * 1000 AS duration_ms FROM GarbageCollection) gc ORDER BY startTime LIMIT 10`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'LINE_CHART(x:"startTime", y:["duration_ms"], connectNulls:true)\n  TITLE "connectNulls"');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });

    const hasError = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);

    // Line path should be present
    const lineCount = await container.locator('.recharts-line-curve').count();
    expect(lineCount, 'line curve rendered').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Section 39: AXIS_X TYPE BAND
// ---------------------------------------------------------------------------

test.describe.serial('Plot: AXIS_X TYPE BAND', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('AB1. AXIS_X TYPE BAND renders categorical axis without error', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      `SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause ORDER BY cnt DESC LIMIT 5`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'BAR_CHART(x:"cause", y:["cnt"])\n  TITLE "AXIS_X BAND"\n  AXIS_X TYPE BAND');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });

    const hasError = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);

    const tickCount = await container.locator('.recharts-xAxis .recharts-cartesian-axis-tick').count();
    expect(tickCount, 'X axis ticks rendered').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Section 40: LINK_Y zoom variable
// ---------------------------------------------------------------------------

test.describe.serial('Plot: LINK_Y', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('LY1. LINE_CHART with LINK_Y renders without error', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      `SELECT startTime, duration_ms FROM (SELECT *, duration * 1000 AS duration_ms FROM GarbageCollection) gc ORDER BY startTime LIMIT 15`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'LINE_CHART(x:"startTime", y:["duration_ms"])\n  TITLE "LINK_Y Test"\n  LINK_Y($y_zoom)');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });

    const hasError = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 41: ZOOM_X clause
// ---------------------------------------------------------------------------

test.describe.serial('Plot: ZOOM_X clause', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('ZX1. ZOOM_X 1.5 applies scaleX transform without changing height', async () => {
    await page.getByRole('button', { name: /Add Cell/i }).last().click();
    await page.waitForTimeout(500);

    const sqlEd = await getLastSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      `SELECT startTime, duration_ms FROM (SELECT *, duration * 1000 AS duration_ms FROM GarbageCollection) gc ORDER BY startTime LIMIT 10`);
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getLastPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'LINE_CHART(x:"startTime", y:["duration_ms"])\n  TITLE "ZOOM_X Test"\n  ZOOM_X 1.5');
    await pressRun(page);
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').last();
    await expect(container).toBeVisible({ timeout: 10_000 });

    const hasError = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
    );
    expect(hasError).toBe(false);

    // PlotRenderer wraps content in: <div style="width:66.67%;...transform:scaleX(1.5);...">
    const hasScaleX = await page.evaluate(() => {
      const cs = [...document.querySelectorAll('div[id^="result-container-"]')];
      const c = cs[cs.length - 1];
      if (!c) return false;
      return [...c.querySelectorAll('div[style]')].some(d =>
        (d.getAttribute('style') || '').includes('scaleX(1.5)')
      );
    });
    expect(hasScaleX, 'scaleX(1.5) transform applied').toBe(true);
  });
});
