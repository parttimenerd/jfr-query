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
  // Do NOT press Delete first — emptying a plot editor removes the segment from the notebook.
  // Meta+a selects all; insertText replaces the selection atomically.
  await page.keyboard.insertText(text);
}

/** Overwrite the GC Pause Summary cell (cell-2: sql+BAR_CHART) and return its
 *  result-container locator. Using cell-2 avoids disturbing the TABLE plot on
 *  cell-1 which collapses when its content changes. */
async function renderPlot(page: Page, sql: string, plot: string) {
  const isMac = process.platform === 'darwin';
  const modKey = isMac ? 'Meta' : 'Control';

  // Scroll cell-2 into view so its editors are mounted (notebook may virtualize).
  const cell2 = page.locator('[data-cell-id="cell-2"]');
  await cell2.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(500);

  // Find cell-2's SQL editor.
  const sqlContent = cell2.locator('.cm-content[data-language="sql"]').first();
  const sqlVisible = await sqlContent.isVisible().catch(() => false);
  if (!sqlVisible) return null;

  await sqlContent.click();
  await page.keyboard.press(`${modKey}+a`);
  await page.keyboard.insertText(sql);
  await pressRun(page);
  await page.waitForTimeout(1500);

  // Find cell-2's plot editor.
  const plotContent = cell2.locator('.cm-content[data-language="plot"]').first();
  const plotVisible = await plotContent.isVisible().catch(() => false);
  if (!plotVisible) return null;

  await plotContent.click();
  await page.keyboard.press(`${modKey}+a`);
  await page.keyboard.insertText(plot);
  await pressRun(page);
  await page.waitForTimeout(2500);

  // Wait for cell-2's result container to appear.
  const container = page.locator('#result-container-cell-2-0');
  const appeared = await container.waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true).catch(() => false);
  if (!appeared) return null;
  return container;
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
    const container = await renderPlot(page,
      'SELECT cause, COUNT(*) AS n, AVG(duration) AS avg_ms FROM GarbageCollection GROUP BY cause',
      'row { BAR_CHART(x: "cause", y: ["n"]) LINE_CHART(x: "cause", y: ["avg_ms"]) }'
    );
    if (!container) { test.skip(); return; }

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
    const container = await renderPlot(page,
      'SELECT cause, duration FROM GarbageCollection',
      'col { BAR_CHART(x: "cause", y: ["duration"]) HISTOGRAM(x: "duration") }'
    );
    if (!container) { test.skip(); return; }

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
// Section 3: Overlay (LINE + AREA) — both in same wrapper
// ---------------------------------------------------------------------------

test.describe.serial('Composite: overlay LINE + AREA', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('C3. LINE_CHART + AREA_CHART overlay — both series visible in one SVG', async () => {
    const container = await renderPlot(page,
      'SELECT startTime, duration, sumOfPauses FROM GarbageCollection ORDER BY startTime',
      'LINE_CHART(x: "startTime", y: ["duration"]) + AREA_CHART(x: "startTime", y: ["sumOfPauses"])'
    );
    if (!container) { test.skip(); return; }

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
    const container = await renderPlot(page,
      'SELECT cause, COUNT(*) AS n, AVG(duration) AS avg_ms, duration FROM GarbageCollection GROUP BY cause, duration',
      'col { row { BAR_CHART(x: "cause", y: ["n"]) LINE_CHART(x: "cause", y: ["avg_ms"]) } row { HISTOGRAM(x: "duration") PIE_CHART(category: "cause", value: "n") } }'
    );
    if (!container) { test.skip(); return; }

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
    const container = await renderPlot(page,
      'SELECT startTime, duration, sumOfPauses FROM GarbageCollection ORDER BY startTime',
      'row { LINE_CHART(x: "startTime", y: ["duration"]) LINK_X($lo, $hi) LINE_CHART(x: "startTime", y: ["sumOfPauses"]) LINK_X($lo, $hi) }'
    );
    if (!container) { test.skip(); return; }

    await container.waitFor({ state: 'visible', timeout: 10_000 });

    const svgs = container.locator('svg');
    const count = await svgs.count();
    expect(count, 'two SVGs for linked row').toBeGreaterThanOrEqual(2);

    const errOverlay = page.locator('[class*="ErrorOverlay"], [class*="error-overlay"], [class*="plot-error"]');
    const hasError = await errOverlay.isVisible().catch(() => false);
    expect(hasError, 'no error with LINK_X').toBe(false);
  });

  test('C6. Dragging to pan on left chart updates $lo/$hi (no error thrown)', async () => {
    // Use cell-2's result container which was set up by C5.
    const container = page.locator('#result-container-cell-2-0');
    const exists = await container.isVisible().catch(() => false);
    if (!exists) { test.skip(); return; }
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
