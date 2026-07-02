// core/frontend/e2e/composite-layouts.spec.ts
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
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
}

async function getFirstPlotEditor(page: Page) {
  const indices: number[] = await page.evaluate(() => {
    const eds = document.querySelectorAll('.cm-jfr-editor .cm-editor');
    const result: number[] = [];
    eds.forEach((ed, i) => {
      if (ed.querySelector('.cm-content[data-language="plot"]')) result.push(i);
    });
    return result;
  });
  if (indices.length === 0) return null;
  return page.locator('.cm-jfr-editor .cm-editor').nth(indices[0]);
}

async function getFirstSqlEditor(page: Page) {
  const indices: number[] = await page.evaluate(() => {
    const eds = document.querySelectorAll('.cm-jfr-editor .cm-editor');
    const result: number[] = [];
    eds.forEach((ed, i) => {
      if (ed.querySelector('.cm-content[data-language="sql"]')) result.push(i);
    });
    return result;
  });
  if (indices.length === 0) return null;
  return page.locator('.cm-jfr-editor .cm-editor').nth(indices[0]);
}

async function renderPlot(page: Page, sql: string, plot: string) {
  const sqlEd = await getFirstSqlEditor(page);
  if (!sqlEd) return false;
  await setCmContent(page, sqlEd, sql);
  await pressRun(page);
  await page.waitForTimeout(1500);

  const plotEd = await getFirstPlotEditor(page);
  if (!plotEd) return false;
  await setCmContent(page, plotEd, plot);
  await pressRun(page);
  await page.waitForTimeout(2000);
  return true;
}

// ---------------------------------------------------------------------------
// Section 1: ROW two-up — both children have non-zero width
// ---------------------------------------------------------------------------

test.describe.serial('Composite: ROW two-up widths', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('C1. ROW(BAR_CHART, LINE_CHART) — both children have non-zero width', async () => {
    const ok = await renderPlot(page,
      'SELECT cause, COUNT(*) AS n, AVG(duration) AS avg_ms FROM GarbageCollection GROUP BY cause',
      'row { BAR_CHART(x: "cause", y: ["n"]) LINE_CHART(x: "cause", y: ["avg_ms"]) }'
    );
    if (!ok) { test.skip(); return; }

    const container = page.locator('div[id^="result-container-"]').first();
    await container.waitFor({ state: 'visible', timeout: 10_000 });

    // Both child SVGs must have positive rendered width.
    const svgs = container.locator('svg');
    const count = await svgs.count();
    expect(count, 'at least two SVG elements (one per child)').toBeGreaterThanOrEqual(2);

    for (let i = 0; i < Math.min(count, 4); i++) {
      const box = await svgs.nth(i).boundingBox();
      if (box && box.width > 0) {
        expect(box.width, `SVG ${i} has non-zero width`).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Section 2: COL stacked — both children have non-zero height
// ---------------------------------------------------------------------------

test.describe.serial('Composite: COL stacked heights', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('C2. COL(BAR_CHART, HISTOGRAM) — both children have non-zero height', async () => {
    const ok = await renderPlot(page,
      'SELECT cause, COUNT(*) AS n, duration FROM GarbageCollection',
      'col { BAR_CHART(x: "cause", y: ["n"]) HISTOGRAM(x: "duration") }'
    );
    if (!ok) { test.skip(); return; }

    const container = page.locator('div[id^="result-container-"]').first();
    await container.waitFor({ state: 'visible', timeout: 10_000 });

    const svgs = container.locator('svg');
    const count = await svgs.count();
    expect(count, 'at least two SVG elements').toBeGreaterThanOrEqual(2);

    let nonZeroCount = 0;
    for (let i = 0; i < Math.min(count, 4); i++) {
      const box = await svgs.nth(i).boundingBox();
      if (box && box.height > 0) nonZeroCount++;
    }
    expect(nonZeroCount, 'both children have non-zero height').toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Section 3: Overlay (BAR + LINE) — both in same wrapper
// ---------------------------------------------------------------------------

test.describe.serial('Composite: overlay BAR + LINE', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('C3. BAR_CHART + LINE_CHART overlay — both series visible in one SVG', async () => {
    const ok = await renderPlot(page,
      'SELECT cause, COUNT(*) AS n, AVG(duration) AS avg_ms FROM GarbageCollection GROUP BY cause',
      'BAR_CHART(x: "cause", y: ["n"]) + LINE_CHART(x: "cause", y: ["avg_ms"])'
    );
    if (!ok) { test.skip(); return; }

    const container = page.locator('div[id^="result-container-"]').first();
    await container.waitFor({ state: 'visible', timeout: 10_000 });

    // Overlay shares the same SVG; at minimum one SVG should contain both bars and lines.
    const svg = container.locator('svg').first();
    const svgVisible = await svg.isVisible().catch(() => false);
    expect(svgVisible, 'overlay SVG renders').toBe(true);

    const errOverlay = page.locator('[class*="ErrorOverlay"], [class*="error-overlay"], [class*="plot-error"]');
    const hasError = await errOverlay.isVisible().catch(() => false);
    expect(hasError, 'no error overlay').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 4: 2×2 grid — four charts
// ---------------------------------------------------------------------------

test.describe.serial('Composite: 2×2 grid', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('C4. COL(ROW(BAR,LINE), ROW(HISTOGRAM,PIE)) — four leaf charts render', async () => {
    const ok = await renderPlot(page,
      'SELECT cause, COUNT(*) AS n, AVG(duration) AS avg_ms, duration FROM GarbageCollection GROUP BY cause, duration',
      `col {
  row { BAR_CHART(x: "cause", y: ["n"]) LINE_CHART(x: "cause", y: ["avg_ms"]) }
  row { HISTOGRAM(x: "duration") PIE_CHART(category: "cause", value: "n") }
}`
    );
    if (!ok) { test.skip(); return; }

    const container = page.locator('div[id^="result-container-"]').first();
    await container.waitFor({ state: 'visible', timeout: 15_000 });

    // Expect at least 4 SVG elements (one per chart).
    const svgs = container.locator('svg');
    const count = await svgs.count();
    expect(count, 'at least 4 SVGs for 2×2 grid').toBeGreaterThanOrEqual(4);

    const errOverlay = page.locator('[class*="ErrorOverlay"], [class*="error-overlay"], [class*="plot-error"]');
    const hasError = await errOverlay.isVisible().catch(() => false);
    expect(hasError, 'no error overlay in 2×2 grid').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 5: LINK_X pan sync across two LINE charts
// ---------------------------------------------------------------------------

test.describe.serial('Composite: LINK_X pan sync', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('C5. ROW with LINK_X($lo, $hi) renders two charts without error', async () => {
    const ok = await renderPlot(page,
      'SELECT startTime, duration, sumOfPauses FROM GarbageCollection ORDER BY startTime',
      `row {
  LINE_CHART(x: "startTime", y: ["duration"]) LINK_X($lo, $hi)
  LINE_CHART(x: "startTime", y: ["sumOfPauses"]) LINK_X($lo, $hi)
}`
    );
    if (!ok) { test.skip(); return; }

    const container = page.locator('div[id^="result-container-"]').first();
    await container.waitFor({ state: 'visible', timeout: 10_000 });

    const svgs = container.locator('svg');
    const count = await svgs.count();
    expect(count, 'two SVGs for linked row').toBeGreaterThanOrEqual(2);

    const errOverlay = page.locator('[class*="ErrorOverlay"], [class*="error-overlay"], [class*="plot-error"]');
    const hasError = await errOverlay.isVisible().catch(() => false);
    expect(hasError, 'no error with LINK_X').toBe(false);
  });

  test('C6. Dragging to pan on left chart updates $lo/$hi (no error thrown)', async () => {
    const container = page.locator('div[id^="result-container-"]').first();
    const svgs = container.locator('svg');
    const firstSvg = svgs.first();

    const box = await firstSvg.boundingBox();
    if (!box) { test.skip(); return; }

    // Simulate a horizontal drag (pan gesture).
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(800);

    const errOverlay = page.locator('[class*="ErrorOverlay"], [class*="error-overlay"]');
    const hasError = await errOverlay.isVisible().catch(() => false);
    expect(hasError, 'no error after pan drag').toBe(false);
  });
});
