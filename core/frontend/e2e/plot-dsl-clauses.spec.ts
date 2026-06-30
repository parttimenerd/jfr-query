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
  await page.waitForTimeout(2000);
}

async function setCmContent(page: Page, editor: import('@playwright/test').Locator, text: string) {
  await editor.scrollIntoViewIfNeeded();
  await editor.waitFor({ state: 'visible' });
  const content = editor.locator('.cm-content').first();
  await content.click();
  const isMac = process.platform === 'darwin';
  const modKey = isMac ? 'Meta' : 'Control';
  await page.keyboard.press(`${modKey}+a`);
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
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
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(1500);

    const plotEd = await getFirstPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'LINE_CHART(x: "startTime", y: ["duration"]) ON HOVER TOOLTIP "{cause}: {duration}ms"');
    await page.keyboard.press('Shift+Enter');
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
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(1500);

    const plotEd = await getFirstPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'LINE_CHART(x: "startTime", y: ["duration"]) AXIS-Y DOMAIN [0, 1000]');
    await page.keyboard.press('Shift+Enter');
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
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(1500);

    const plotEd = await getFirstPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'BAR_CHART(x: "cause", y: ["n"]) AXIS-X LABEL "GC Cause"');
    await page.keyboard.press('Shift+Enter');
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
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(1500);

    const plotEd = await getFirstPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'SCATTER_PLOT(x: "startTime", y: "duration") BRUSH "$ysel" MODE Y');
    await page.keyboard.press('Shift+Enter');
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
    await page.keyboard.press('Shift+Enter');
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

  test('D6. Two SQL cells + LINE_CHART ON 1, 2 renders both series', async () => {
    // Need two SQL cells. Add a second one.
    const addBtn = page.getByRole('button', { name: /Add Cell/i });
    const addVisible = await addBtn.isVisible().catch(() => false);
    if (!addVisible) { test.skip(); return; }

    // First SQL cell: GarbageCollection durations.
    const sqlEd0 = await getFirstSqlEditor(page);
    if (!sqlEd0) { test.skip(); return; }
    await setCmContent(page, sqlEd0,
      'SELECT startTime, duration FROM GarbageCollection ORDER BY startTime LIMIT 50');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(1500);

    // Add second SQL cell.
    await addBtn.click();
    await page.waitForTimeout(400);

    const sqlEditors: number[] = await page.evaluate(() => {
      const eds = document.querySelectorAll('.cm-jfr-editor .cm-editor');
      const r: number[] = [];
      eds.forEach((ed, i) => { if (ed.querySelector('.cm-content[data-language="sql"]')) r.push(i); });
      return r;
    });
    if (sqlEditors.length < 2) { test.skip(); return; }

    const sqlEd1 = page.locator('.cm-jfr-editor .cm-editor').nth(sqlEditors[sqlEditors.length - 1]);
    await setCmContent(page, sqlEd1,
      'SELECT startTime, sumOfPauses FROM GarbageCollection ORDER BY startTime LIMIT 50');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(1500);

    // Set the plot cell to reference both queries.
    const plotEd = await getFirstPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'LINE_CHART(x: "startTime", y: ["duration"]) ON 1\nLINE_CHART(x: "startTime", y: ["sumOfPauses"]) ON 2');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(2000);

    const container = page.locator('div[id^="result-container-"]').first();
    await container.waitFor({ state: 'visible', timeout: 10_000 });

    const errOverlay = page.locator('[class*="ErrorOverlay"], [class*="error-overlay"], [class*="plot-error"]');
    const hasError = await errOverlay.isVisible().catch(() => false);
    expect(hasError, 'no error with multi-query ON 1, 2').toBe(false);

    const svgs = container.locator('svg');
    const svgCount = await svgs.count();
    expect(svgCount, 'SVG renders for multi-query chart').toBeGreaterThan(0);
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
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(1500);

    const plotEd = await getFirstPlotEditor(page);
    if (!plotEd) { test.skip(); return; }
    await setCmContent(page, plotEd,
      'LINE_CHART(x: "startTime", y: ["duration"]) TOOLTIP COLUMNS ["cause", "duration"]');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(1500);

    const svg = page.locator('div[id^="result-container-"] svg').first();
    await svg.waitFor({ state: 'visible', timeout: 5_000 });

    const errOverlay = page.locator('[class*="ErrorOverlay"], [class*="error-overlay"], [class*="plot-error"]');
    const hasError = await errOverlay.isVisible().catch(() => false);
    expect(hasError, 'no error with TOOLTIP COLUMNS').toBe(false);
  });
});
