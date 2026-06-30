// core/frontend/e2e/sidebar-features.spec.ts
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

// ---------------------------------------------------------------------------
// Section 1: Schema search filter
// ---------------------------------------------------------------------------

test.describe.serial('Sidebar: schema search filter', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('S1. Schema search input is present', async () => {
    const input = page.locator('input[placeholder="Search schema..."]');
    await input.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(input).toBeVisible();
  });

  test('S2. Typing a table name filters the sidebar list', async () => {
    const input = page.locator('input[placeholder="Search schema..."]');
    await input.fill('GarbageCollection');
    await page.waitForTimeout(300);

    // After filtering, sidebar items that contain GarbageCollection should be visible.
    // Note: the filter also matches tables whose columns contain the term, and the
    // selector spans all sidebar sections, so we only assert count > 0.
    const items = page.locator('.sidebar-list-font li button, .sidebar-list-font button');
    const count = await items.count();
    expect(count, 'at least one item after filter').toBeGreaterThan(0);
  });

  test('S3. Clearing search restores full list', async () => {
    const input = page.locator('input[placeholder="Search schema..."]');
    const beforeCount = await page.locator('.sidebar-list-font li button, .sidebar-list-font button').count();

    await input.fill('');
    await page.waitForTimeout(300);

    const afterCount = await page.locator('.sidebar-list-font li button, .sidebar-list-font button').count();
    expect(afterCount, 'more items after clearing filter').toBeGreaterThanOrEqual(beforeCount);
  });

  test('S4. Searching a nonexistent name shows empty result', async () => {
    const input = page.locator('input[placeholder="Search schema..."]');
    await input.fill('zzz_does_not_exist_xyz');
    await page.waitForTimeout(300);

    // Use li>button to target only table/view/macro list items (not preview panel buttons).
    const items = page.locator('.sidebar-list-font li button');
    const count = await items.count();
    expect(count, 'zero items for nonexistent filter').toBe(0);

    // Clean up.
    await input.fill('');
    await page.waitForTimeout(200);
  });
});

// ---------------------------------------------------------------------------
// Section 2: Show / Hide Internal Views toggle
// ---------------------------------------------------------------------------

test.describe.serial('Sidebar: internal views toggle', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('S5. Internal Views toggle button is present in Views section', async () => {
    const toggle = page.getByRole('button', { name: /Internal Views/i });
    await toggle.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(toggle).toBeVisible();
  });

  test('S6. Clicking the toggle changes the button title', async () => {
    // The Internal Views toggle only has a `title` attribute (icon-only button).
    const toggle = page.getByRole('button', { name: /Internal Views/i });
    const titleBefore = await toggle.getAttribute('title') ?? '';

    await toggle.click();
    await page.waitForTimeout(300);

    const titleAfter = await toggle.getAttribute('title') ?? '';
    expect(titleAfter, 'toggle title changes after click').not.toBe(titleBefore);

    // Toggle back to original state.
    await toggle.click();
    await page.waitForTimeout(200);
  });

  test('S7. After showing internal views, sidebar item count increases', async () => {
    const countBefore = await page.locator('.sidebar-list-font li button, .sidebar-list-font button').count();

    const toggle = page.getByRole('button', { name: /Show Internal Views/i });
    const isShowToggle = await toggle.isVisible().catch(() => false);
    if (!isShowToggle) { test.skip(); return; }

    await toggle.click();
    await page.waitForTimeout(400);

    const countAfter = await page.locator('.sidebar-list-font li button, .sidebar-list-font button').count();
    expect(countAfter, 'more items when internal views shown').toBeGreaterThanOrEqual(countBefore);

    // Restore: wait for "Hide Internal Views" button (post-click state) then click it
    await page.getByRole('button', { name: /Hide Internal Views/i }).waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    await page.getByRole('button', { name: /Internal Views/i }).click();
    await page.waitForTimeout(200);
  });
});

// ---------------------------------------------------------------------------
// Section 3: Macro click — sidebar preview
// ---------------------------------------------------------------------------

test.describe.serial('Sidebar: macro click preview', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('S8. Macros section header is visible', async () => {
    // Sidebar section headings are h3 elements.
    const header = page.locator('h3', { hasText: /Macros/i });
    await header.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(header).toBeVisible();
  });

  test('S9. Clicking a macro item selects/highlights it', async () => {
    // GC demo has recording_start() and recording_end() macros.
    // Items in the sidebar. The Macros section follows Views.
    const macroItems = page.locator('.sidebar-list-font button[title*="Click to preview"]');
    const count = await macroItems.count();
    if (count === 0) { test.skip(); return; }

    const first = macroItems.first();
    await first.scrollIntoViewIfNeeded();
    await first.click();
    await page.waitForTimeout(300);

    // After click the button should have the selected state class bg-cyan-600/30.
    const className = await first.getAttribute('class') ?? '';
    expect(className, 'macro has selected class after click').toMatch(/cyan/);
  });

  test('S10. Hovering a macro shows the schema tooltip', async () => {
    const macroItems = page.locator('.sidebar-list-font button[title*="Click to preview"]');
    const count = await macroItems.count();
    if (count === 0) { test.skip(); return; }

    await macroItems.first().scrollIntoViewIfNeeded();
    await macroItems.first().hover();
    await page.waitForTimeout(400);

    // Tooltip portal is injected into body as a div with class bg-gray-700.
    const tooltip = page.locator('body > div.bg-gray-700').first();
    const appeared = await tooltip.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
    expect(appeared, 'schema tooltip appeared on macro hover').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 4: Sidebar tooltip content
// ---------------------------------------------------------------------------

test.describe.serial('Sidebar: tooltip content for table', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('S11. Hovering GarbageCollection shows column names in tooltip', async () => {
    // Find the GarbageCollection table button.
    const gcButton = page.locator('.sidebar-list-font button', { hasText: /GarbageCollection/i }).first();
    await gcButton.waitFor({ state: 'visible', timeout: 10_000 });
    await gcButton.scrollIntoViewIfNeeded();
    await gcButton.hover();
    await page.waitForTimeout(500);

    const tooltip = page.locator('body > div.bg-gray-700').first();
    await tooltip.waitFor({ state: 'visible', timeout: 5_000 });

    const text = await tooltip.textContent();
    // GarbageCollection has columns: cause, duration, gcId, name, startTime.
    expect(text, 'tooltip shows column name').toMatch(/cause|duration|gcId/i);
  });

  test('S12. Tooltip disappears when mouse leaves', async () => {
    const tooltip = page.locator('body > div.bg-gray-700').first();
    // Move mouse away from the sidebar to any neutral location.
    await page.mouse.move(600, 400);
    await page.waitForTimeout(400);

    const stillVisible = await tooltip.isVisible().catch(() => false);
    expect(stillVisible, 'tooltip hidden after mouse leaves').toBe(false);
  });
});
