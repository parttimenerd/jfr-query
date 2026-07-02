// core/frontend/e2e/plot-dsl-clauses.spec.ts
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

async function pressRun(page: Page) {
  const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modKey}+Enter`);
}

async function setCmContent(page: Page, editor: import('@playwright/test').Locator, text: string) {
  await editor.scrollIntoViewIfNeeded();
  await editor.waitFor({ state: 'visible' });
  const content = editor.locator('.cm-content').first();
  await content.click();
  const isMac = process.platform === 'darwin';
  const modKey = isMac ? 'Meta' : 'Control';
  await page.keyboard.press(`${modKey}+a`);
  // Do NOT press Delete — emptying a plot editor removes its segment from the notebook.
  await page.keyboard.insertText(text);
}

async function getFirstPlotEditor(page: Page) {
  const indices: number[] = await page.evaluate(() => {
    const eds = document.querySelectorAll('.cm-jfr-editor .cm-editor');
    const r: number[] = [];
    eds.forEach((ed, i) => { if (ed.querySelector('.cm-content[data-language="plot"]')) r.push(i); });
    return r;
  });
  if (indices.length === 0) return null;
  return page.locator('.cm-jfr-editor .cm-editor').nth(indices[0]);
}

async function getFirstSqlEditor(page: Page) {
  const indices: number[] = await page.evaluate(() => {
    const eds = document.querySelectorAll('.cm-jfr-editor .cm-editor');
    const r: number[] = [];
    eds.forEach((ed, i) => { if (ed.querySelector('.cm-content[data-language="sql"]')) r.push(i); });
    return r;
  });
  if (indices.length === 0) return null;
  return page.locator('.cm-jfr-editor .cm-editor').nth(indices[0]);
}

// ---------------------------------------------------------------------------
// Section 1: ON HOVER TOOLTIP custom text
// ---------------------------------------------------------------------------

test.describe.serial('Plot DSL: ON HOVER TOOLTIP', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('D1. LINE_CHART with ON HOVER TOOLTIP renders without error', async () => {
    const sqlEd = await getFirstSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      'SELECT startTime, duration, cause FROM GarbageCollection ORDER BY startTime LIMIT 50');
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getFirstPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'LINE_CHART(x: "startTime", y: ["duration"]) ON HOVER TOOLTIP "{cause}: {duration}ms"');
    await pressRun(page);
    await page.waitForTimeout(1500);

    const container = page.locator('div[id^="result-container-"]').first();
    await container.waitFor({ state: 'visible', timeout: 10_000 });

    const errOverlay = page.locator('[class*="ErrorOverlay"], [class*="error-overlay"], [class*="plot-error"]');
    const hasError = await errOverlay.isVisible().catch(() => false);
    expect(hasError, 'no error with ON HOVER TOOLTIP').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 2: AXIS-Y DOMAIN
// ---------------------------------------------------------------------------

test.describe.serial('Plot DSL: AXIS-Y DOMAIN', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('D2. LINE_CHART with AXIS-Y DOMAIN [0, 1000] renders without error', async () => {
    const sqlEd = await getFirstSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      'SELECT startTime, duration FROM GarbageCollection ORDER BY startTime LIMIT 50');
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getFirstPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'LINE_CHART(x: "startTime", y: ["duration"]) AXIS-Y DOMAIN [0, 1000]');
    await pressRun(page);
    await page.waitForTimeout(1500);

    const svg = page.locator('div[id^="result-container-"] svg').first();
    await svg.waitFor({ state: 'visible', timeout: 5_000 });

    const errOverlay = page.locator('[class*="ErrorOverlay"], [class*="error-overlay"], [class*="plot-error"]');
    const hasError = await errOverlay.isVisible().catch(() => false);
    expect(hasError, 'no error with AXIS-Y DOMAIN').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 3: AXIS-X LABEL
// ---------------------------------------------------------------------------

test.describe.serial('Plot DSL: AXIS-X LABEL', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('D3. BAR_CHART with AXIS-X LABEL "GC Cause" renders without error', async () => {
    const sqlEd = await getFirstSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      'SELECT cause, COUNT(*) AS n FROM GarbageCollection GROUP BY cause');
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getFirstPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'BAR_CHART(x: "cause", y: ["n"]) AXIS-X LABEL "GC Cause"');
    await pressRun(page);
    await page.waitForTimeout(1500);

    const svg = page.locator('div[id^="result-container-"] svg').first();
    await svg.waitFor({ state: 'visible', timeout: 5_000 });

    const errOverlay = page.locator('[class*="ErrorOverlay"], [class*="error-overlay"], [class*="plot-error"]');
    const hasError = await errOverlay.isVisible().catch(() => false);
    expect(hasError, 'no error with AXIS-X LABEL').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 4: BRUSH MODE Y
// ---------------------------------------------------------------------------

test.describe.serial('Plot DSL: BRUSH MODE Y', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('D4. SCATTER_PLOT with BRUSH MODE Y renders without error', async () => {
    const sqlEd = await getFirstSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      'SELECT startTime, duration FROM GarbageCollection ORDER BY startTime LIMIT 100');
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getFirstPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'SCATTER_PLOT(x: "startTime", y: "duration") BRUSH "$ysel" MODE Y');
    await pressRun(page);
    await page.waitForTimeout(1500);

    const svg = page.locator('div[id^="result-container-"] svg').first();
    await svg.waitFor({ state: 'visible', timeout: 5_000 });

    const errOverlay = page.locator('[class*="ErrorOverlay"], [class*="error-overlay"], [class*="plot-error"]');
    const hasError = await errOverlay.isVisible().catch(() => false);
    expect(hasError, 'no error with BRUSH MODE Y').toBe(false);
  });

  test('D5. BRUSH MODE XY renders without error', async () => {
    const plotEd = await getFirstPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'SCATTER_PLOT(x: "startTime", y: "duration") BRUSH "$xysel" MODE XY');
    await pressRun(page);
    await page.waitForTimeout(1500);

    const svg = page.locator('div[id^="result-container-"] svg').first();
    await svg.waitFor({ state: 'visible', timeout: 5_000 });

    const errOverlay = page.locator('[class*="ErrorOverlay"], [class*="error-overlay"], [class*="plot-error"]');
    const hasError = await errOverlay.isVisible().catch(() => false);
    expect(hasError, 'no error with BRUSH MODE XY').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 5: Multi-query ON 1, 2 syntax
// ---------------------------------------------------------------------------

test.describe.serial('Plot DSL: multi-query ON 1, 2', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('D6. LINE_CHART ON 1 references first query block and renders without error', async () => {
    // ON 1 references the first SQL block within the same cell (1-based).
    // We use cell-2 which has exactly one SQL block, so ON 1 = that query's data.
    const cell2 = page.locator('[data-cell-id="cell-2"]');
    await cell2.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);

    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

    const sqlEd = cell2.locator('.cm-content[data-language="sql"]').first();
    const sqlVisible = await sqlEd.isVisible().catch(() => false);
    if (!sqlVisible) { test.skip(); return; }

    await sqlEd.click();
    await page.keyboard.press(`${modKey}+a`);
    await page.keyboard.insertText('SELECT startTime, duration FROM GarbageCollection ORDER BY startTime LIMIT 50');
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = cell2.locator('.cm-content[data-language="plot"]').first();
    const plotVisible = await plotEd.isVisible().catch(() => false);
    if (!plotVisible) { test.skip(); return; }

    await plotEd.click();
    await page.keyboard.press(`${modKey}+a`);
    await page.keyboard.insertText('LINE_CHART(x: "startTime", y: ["duration"]) ON 1');
    await pressRun(page);
    await page.waitForTimeout(3000);

    const container = page.locator('#result-container-cell-2-0');
    await container.waitFor({ state: 'visible', timeout: 10_000 });

    const errOverlay = page.locator('[class*="ErrorOverlay"], [class*="error-overlay"], [class*="plot-error"]');
    const hasError = await errOverlay.isVisible().catch(() => false);
    expect(hasError, 'no error with ON 1 clause').toBe(false);

    const svgs = container.locator('svg');
    await svgs.first().waitFor({ state: 'visible', timeout: 8_000 });
    const svgCount = await svgs.count();
    expect(svgCount, 'SVG renders for ON 1 chart').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Section 6: TOOLTIP COLUMNS
// ---------------------------------------------------------------------------

test.describe.serial('Plot DSL: TOOLTIP COLUMNS', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('D7. LINE_CHART with TOOLTIP COLUMNS renders without error', async () => {
    const sqlEd = await getFirstSqlEditor(page);
    if (!sqlEd) { test.skip(); return; }
    await setCmContent(page, sqlEd,
      'SELECT startTime, duration, cause FROM GarbageCollection ORDER BY startTime LIMIT 50');
    await pressRun(page);
    await page.waitForTimeout(1500);

    const plotEd = await getFirstPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'LINE_CHART(x: "startTime", y: ["duration"]) TOOLTIP COLUMNS ["cause", "duration"]');
    await pressRun(page);
    await page.waitForTimeout(1500);

    const svg = page.locator('div[id^="result-container-"] svg').first();
    await svg.waitFor({ state: 'visible', timeout: 5_000 });

    const errOverlay = page.locator('[class*="ErrorOverlay"], [class*="error-overlay"], [class*="plot-error"]');
    const hasError = await errOverlay.isVisible().catch(() => false);
    expect(hasError, 'no error with TOOLTIP COLUMNS').toBe(false);
  });
});
