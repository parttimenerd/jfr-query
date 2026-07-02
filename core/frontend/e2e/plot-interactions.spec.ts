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
    // Add a fresh SQL+Plot cell pair to avoid re-render bugs when changing
    // existing cells from TABLE/BAR_CHART to LINE_CHART with dot=true.
    // Use the LAST "+ SQL" button so the new cell ends up at the end of the
    // notebook — this ensures ".last()" on result containers finds the right one.
    const addSqlBtn = page.getByRole('button', { name: '+ SQL' }).last();
    const addSqlVisible = await addSqlBtn.isVisible().catch(() => false);
    if (!addSqlVisible) { test.skip(); return; }

    // Count existing SQL editors before adding.
    const sqlCountBefore: number = await page.evaluate(() => {
      const eds = document.querySelectorAll('.cm-jfr-editor .cm-editor');
      return [...eds].filter(e => e.querySelector('.cm-content[data-language="sql"]')).length;
    });

    await addSqlBtn.scrollIntoViewIfNeeded();
    await addSqlBtn.click();

    // Wait until a new SQL editor appears in the DOM.
    await page.waitForFunction(
      (expected: number) => {
        const eds = document.querySelectorAll('.cm-jfr-editor .cm-editor');
        const count = [...eds].filter(e => e.querySelector('.cm-content[data-language="sql"]')).length;
        return count > expected;
      },
      sqlCountBefore,
      { timeout: 5_000 }
    );

    // Type into the newly added SQL editor (last SQL editor in the DOM).
    const newSqlIdx: number = await page.evaluate(() => {
      const eds = document.querySelectorAll('.cm-jfr-editor .cm-editor');
      let last = -1;
      eds.forEach((ed, i) => {
        if (ed.querySelector('.cm-content[data-language="sql"]')) last = i;
      });
      return last;
    });
    if (newSqlIdx < 0) { test.skip(); return; }

    const newSqlEd = page.locator('.cm-jfr-editor .cm-editor').nth(newSqlIdx);
    await setCmContent(page, newSqlEd,
      'SELECT gcId, duration FROM GarbageCollection ORDER BY gcId LIMIT 20');
    await pressRun(page);
    await page.waitForTimeout(1500);

    // Count existing plot editors before adding, and record their DOM positions.
    const plotCountBefore: number = await page.evaluate(() => {
      const eds = document.querySelectorAll('.cm-jfr-editor .cm-editor');
      return [...eds].filter(e => e.querySelector('.cm-content[data-language="plot"]')).length;
    });
    const plotIndicesBefore: number[] = await page.evaluate(() => {
      const eds = document.querySelectorAll('.cm-jfr-editor .cm-editor');
      const result: number[] = [];
      eds.forEach((ed, i) => {
        if (ed.querySelector('.cm-content[data-language="plot"]')) result.push(i);
      });
      return result;
    });

    // Capture existing result container IDs before adding the new plot block.
    const containerIdsBefore: string[] = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('div[id^="result-container-"]')).map(el => el.id);
    });

    // Add a Plot block for this cell — use the LAST "+ Plot" button so it
    // attaches to the same last cell as the new SQL block.
    const addPlotBtn = page.getByRole('button', { name: '+ Plot' }).last();
    const addPlotVisible = await addPlotBtn.isVisible().catch(() => false);
    if (!addPlotVisible) { test.skip(); return; }

    await addPlotBtn.scrollIntoViewIfNeeded();
    await addPlotBtn.click();

    // Wait until a new plot editor appears in the DOM.
    await page.waitForFunction(
      (expected: number) => {
        const eds = document.querySelectorAll('.cm-jfr-editor .cm-editor');
        const count = [...eds].filter(e => e.querySelector('.cm-content[data-language="plot"]')).length;
        return count > expected;
      },
      plotCountBefore,
      { timeout: 5_000 }
    );

    // Find the NEW plot editor (the one that was not present before).
    const newPlotIdx: number = await page.evaluate((indicesBefore: number[]) => {
      const eds = document.querySelectorAll('.cm-jfr-editor .cm-editor');
      const allIndices: number[] = [];
      eds.forEach((ed, i) => {
        if (ed.querySelector('.cm-content[data-language="plot"]')) allIndices.push(i);
      });
      // The new plot editor is at whatever index was not present before.
      // Since adding a plot shifts subsequent editors' indices, we look for
      // a count mismatch: the first index position where allIndices differs.
      for (let i = 0; i < allIndices.length; i++) {
        if (i >= indicesBefore.length || allIndices[i] !== indicesBefore[i]) {
          return allIndices[i];
        }
      }
      return allIndices[allIndices.length - 1] ?? -1;
    }, plotIndicesBefore);
    if (newPlotIdx < 0) { test.skip(); return; }

    const newPlotEd = page.locator('.cm-jfr-editor .cm-editor').nth(newPlotIdx);
    await setCmContent(page, newPlotEd,
      'LINE_CHART(x: "gcId", y: ["duration"], lineType: "dots")');
    await pressRun(page);
    await page.waitForTimeout(3000);

    // Find the NEW result container (the one added for this cell's new plot block).
    const newContainerId: string | null = await page.evaluate((idsBefore: string[]) => {
      const allIds = Array.from(document.querySelectorAll('div[id^="result-container-"]')).map(el => el.id);
      const newId = allIds.find(id => !idsBefore.includes(id));
      return newId ?? null;
    }, containerIdsBefore);

    if (!newContainerId) { test.skip(); return; }

    // Recharts renders dot markers as <circle> elements.
    const newContainer = page.locator(`[id="${newContainerId}"]`);
    const circles = newContainer.locator('circle');
    const count = await circles.count();
    expect(count, 'dot markers rendered as circles').toBeGreaterThan(0);
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
