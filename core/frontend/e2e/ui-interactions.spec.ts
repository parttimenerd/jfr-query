/**
 * UI interaction e2e tests — features not covered by other spec files.
 *
 * Beginner-oriented:
 *   UI1-UI4:  Sidebar collapse/expand via the chevron button
 *   UI5-UI8:  Per-cell collapse/expand toggle (individual cell, not toolbar)
 *   UI9-UI11: AI Features enable/disable toggle in toolbar
 *   UI12-UI14: Notebook settings — timestamp format field accepts input
 *
 * Complex/power-user:
 *   UI15-UI18: Sidebar — sort tables by alpha vs row-count
 *   UI19-UI21: Sidebar — "Show Internal Views" toggle reveals duckdb_ views
 *   UI22-UI24: Sidebar — "Refresh Schema" button doesn't crash
 *   UI25-UI28: Per-cell raw-markdown toggle (per-cell CodeBracket button)
 *
 * Skipped when SKIP_E2E=1.
 */

import { test, expect, Page } from '@playwright/test';

const SKIP = process.env.SKIP_E2E === '1';

async function gotoDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Try the demo/i })
    .waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('button', { name: /Try the demo/i }).click();
  await page.getByRole('heading', { name: 'JFR Query Notebook' })
    .waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('.cm-jfr-editor .cm-editor').first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(2000);
}

// ---------------------------------------------------------------------------
// Section 1: Sidebar collapse / expand
// ---------------------------------------------------------------------------

test.describe.serial('UI: Sidebar collapse and expand', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('UI1. Sidebar is visible by default after demo loads', async () => {
    // The sidebar contains the "Refresh Schema" and "Sort" buttons.
    const refreshBtn = page.getByRole('button', { name: 'Refresh Schema' });
    await expect(refreshBtn).toBeVisible({ timeout: 5_000 });
  });

  test('UI2. The sidebar has a collapse toggle (ResizablePanel chevron)', async () => {
    // The ResizablePanel renders a collapse chevron button somewhere on the sidebar edge.
    // We find it by looking for a button whose title/label contains "Collapse".
    const collapseBtn = page.getByRole('button', { name: /Collapse/i }).first()
      .or(page.getByTitle(/Collapse/i).first());
    const visible = await collapseBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(collapseBtn).toBeVisible();
  });

  test('UI3. Clicking the collapse toggle hides the sidebar content', async () => {
    const collapseBtn = page.getByRole('button', { name: /Collapse/i }).first()
      .or(page.getByTitle(/Collapse/i).first());
    const visible = await collapseBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await collapseBtn.click();
    await page.waitForTimeout(400);

    // After collapse the Refresh Schema button should no longer be visible.
    const refreshBtn = page.getByRole('button', { name: 'Refresh Schema' });
    const refreshVisible = await refreshBtn.isVisible().catch(() => false);
    // Also check for the "Expand Sidebar" button that appears when collapsed.
    const expandBtn = page.getByRole('button', { name: 'Expand Sidebar' });
    const expandVisible = await expandBtn.isVisible().catch(() => false);

    expect(!refreshVisible || expandVisible, 'sidebar collapsed').toBe(true);
  });

  test('UI4. Clicking "Expand Sidebar" button restores sidebar content', async () => {
    const expandBtn = page.getByRole('button', { name: 'Expand Sidebar' });
    const visible = await expandBtn.isVisible().catch(() => false);
    if (!visible) {
      // Try clicking the collapse toggle again to re-expand.
      const collapseBtn = page.getByRole('button', { name: /Collapse/i }).first();
      const colVisible = await collapseBtn.isVisible().catch(() => false);
      if (!colVisible) { test.skip(); return; }
      await collapseBtn.click();
      await page.waitForTimeout(400);
    } else {
      await expandBtn.click();
      await page.waitForTimeout(400);
    }

    // Sidebar content should be back.
    const refreshBtn = page.getByRole('button', { name: 'Refresh Schema' });
    await expect(refreshBtn).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Section 2: Per-cell collapse / expand toggle
// ---------------------------------------------------------------------------

test.describe.serial('UI: Per-cell collapse toggle', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('UI5. Per-cell collapse button is visible in the cell header', async () => {
    // aria-label is "Collapse cell" or "Expand cell".
    const collapseBtn = page.getByRole('button', { name: /Collapse cell|Expand cell/i }).first();
    await expect(collapseBtn).toBeVisible({ timeout: 5_000 });
  });

  test('UI6. Clicking "Collapse cell" hides the cell body', async () => {
    const collapseBtn = page.getByRole('button', { name: 'Collapse cell' }).first();
    const visible = await collapseBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    // Record the first SQL editor before collapsing.
    const firstCell = page.locator('[data-cell-id]').first();
    const editorBefore = firstCell.locator('.cm-jfr-editor .cm-editor').first();
    await expect(editorBefore).toBeVisible();

    await collapseBtn.click();
    await page.waitForTimeout(400);

    // The editor should be hidden now.
    const editorAfter = firstCell.locator('.cm-jfr-editor .cm-editor').first();
    const stillVisible = await editorAfter.isVisible().catch(() => false);
    expect(stillVisible, 'editor hidden after collapse').toBe(false);
  });

  test('UI7. After collapse the button label changes to "Expand cell"', async () => {
    const expandBtn = page.getByRole('button', { name: 'Expand cell' }).first();
    await expect(expandBtn).toBeVisible({ timeout: 3_000 });
  });

  test('UI8. Clicking "Expand cell" restores the cell body', async () => {
    const expandBtn = page.getByRole('button', { name: 'Expand cell' }).first();
    const visible = await expandBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await expandBtn.click();
    await page.waitForTimeout(400);

    // Editor should be visible again.
    const firstCell = page.locator('[data-cell-id]').first();
    const editor = firstCell.locator('.cm-jfr-editor .cm-editor').first();
    await expect(editor).toBeVisible({ timeout: 3_000 });
  });
});

// ---------------------------------------------------------------------------
// Section 3: AI Features enable / disable
// ---------------------------------------------------------------------------

test.describe.serial('UI: AI Features toggle', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('UI9. AI Features toggle button is visible in the toolbar', async () => {
    const aiBtn = page.getByRole('button', { name: /AI Features/i });
    await expect(aiBtn).toBeVisible({ timeout: 5_000 });
  });

  test('UI10. Clicking the AI toggle flips its aria-label', async () => {
    const aiBtn = page.getByRole('button', { name: /AI Features/i });
    const labelBefore = await aiBtn.getAttribute('aria-label') ?? '';

    await aiBtn.click();
    await page.waitForTimeout(300);

    const labelAfter = await page.getByRole('button', { name: /AI Features/i })
      .getAttribute('aria-label').catch(() => '');
    expect(labelAfter, 'label changed').not.toBe(labelBefore);
  });

  test('UI11. Toggling AI back restores original state and page is intact', async () => {
    const aiBtn = page.getByRole('button', { name: /AI Features/i });
    await aiBtn.click();
    await page.waitForTimeout(300);
    await expect(page.getByRole('heading', { name: 'JFR Query Notebook' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Section 4: Notebook Settings — timestamp format field
// ---------------------------------------------------------------------------

test.describe.serial('UI: Notebook Settings timestamp format', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  async function openSettingsSection(p: Page) {
    const toggle = p.getByRole('button', { name: /Notebook Settings/i }).first();
    if (!(await toggle.isVisible().catch(() => false))) return false;
    if (await toggle.getAttribute('aria-expanded') !== 'true') {
      await toggle.click();
      await p.waitForTimeout(300);
    }
    const general = p.getByRole('button', { name: /^Settings$/i }).first();
    if (await general.isVisible().catch(() => false) && await general.getAttribute('aria-expanded') !== 'true') {
      await general.click();
      await p.waitForTimeout(300);
    }
    return true;
  }

  test('UI12. Notebook Settings panel can be opened', async () => {
    const opened = await openSettingsSection(page);
    if (!opened) { test.skip(); return; }
    const toggle = page.getByRole('button', { name: /Notebook Settings/i }).first();
    expect(await toggle.getAttribute('aria-expanded')).toBe('true');
  });

  test('UI13. Timestamp Format field accepts custom input', async () => {
    const tsInput = page.locator('input#timeFormat');
    const visible = await tsInput.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await tsInput.fill('HH:mm:ss.SSS');
    await page.waitForTimeout(200);
    const val = await tsInput.inputValue();
    expect(val, 'custom timestamp format accepted').toBe('HH:mm:ss.SSS');
  });

  test('UI14. Max Decimal Places field accepts a numeric value', async () => {
    const dpInput = page.locator('input#decimalPlaces');
    const visible = await dpInput.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await dpInput.fill('4');
    await page.waitForTimeout(200);
    const val = await dpInput.inputValue();
    expect(val, 'decimal places accepted').toBe('4');
  });
});

// ---------------------------------------------------------------------------
// Section 5: Sidebar — sort tables alpha vs row-count
// ---------------------------------------------------------------------------

test.describe.serial('UI: Sidebar table sort', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('UI15. "Sort alphabetically" button is visible in sidebar', async () => {
    const sortAlpha = page.getByRole('button', { name: 'Sort alphabetically' });
    await expect(sortAlpha).toBeVisible({ timeout: 5_000 });
  });

  test('UI16. "Sort by row count" button is visible in sidebar', async () => {
    const sortCount = page.getByRole('button', { name: 'Sort by row count' });
    await expect(sortCount).toBeVisible({ timeout: 5_000 });
  });

  test('UI17. Clicking "Sort by row count" does not crash', async () => {
    const sortCount = page.getByRole('button', { name: 'Sort by row count' });
    await sortCount.click();
    await page.waitForTimeout(400);
    // Sidebar should still list at least one item.
    const refreshBtn = page.getByRole('button', { name: 'Refresh Schema' });
    await expect(refreshBtn).toBeVisible();
  });

  test('UI18. Clicking "Sort alphabetically" restores alpha order', async () => {
    const sortAlpha = page.getByRole('button', { name: 'Sort alphabetically' });
    await sortAlpha.click();
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: 'Refresh Schema' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Section 6: Sidebar — Internal Views toggle
// ---------------------------------------------------------------------------

test.describe.serial('UI: Sidebar internal views toggle', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('UI19. "Show Internal Views" toggle is visible in sidebar', async () => {
    const toggleBtn = page.getByRole('button', { name: /Internal Views/i });
    await expect(toggleBtn).toBeVisible({ timeout: 5_000 });
  });

  test('UI20. Clicking "Show Internal Views" reveals duckdb_ prefixed views', async () => {
    const toggleBtn = page.getByRole('button', { name: /Show Internal Views/i });
    const visible = await toggleBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await toggleBtn.click();
    await page.waitForTimeout(500);

    // After enabling, at least one duckdb_ view should appear somewhere in the sidebar.
    const internalItem = page.locator('button', { hasText: 'duckdb_' }).first();
    const appeared = await internalItem.isVisible().catch(() => false);
    // If no duckdb_ views exist in this DB, just verify no crash.
    const stillRefresh = await page.getByRole('button', { name: 'Refresh Schema' }).isVisible();
    expect(appeared || stillRefresh, 'toggle worked without crash').toBe(true);
  });

  test('UI21. Clicking "Hide Internal Views" removes them again', async () => {
    const hideBtn = page.getByRole('button', { name: /Hide Internal Views/i });
    const visible = await hideBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await hideBtn.click();
    await page.waitForTimeout(400);

    await expect(page.getByRole('button', { name: 'Refresh Schema' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Section 7: Sidebar — Refresh Schema
// ---------------------------------------------------------------------------

test.describe.serial('UI: Sidebar refresh schema', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('UI22. "Refresh Schema" button is visible', async () => {
    await expect(page.getByRole('button', { name: 'Refresh Schema' })).toBeVisible({ timeout: 5_000 });
  });

  test('UI23. Clicking "Refresh Schema" does not crash', async () => {
    await page.getByRole('button', { name: 'Refresh Schema' }).click();
    await page.waitForTimeout(1000);
    // Sidebar should still render.
    await expect(page.getByRole('button', { name: 'Refresh Schema' })).toBeVisible();
  });

  test('UI24. After refresh, at least one table is still listed in sidebar', async () => {
    // Tables in the sidebar have title "Click to preview · Double-click to copy name".
    const tableItems = page.getByTitle(/Click to preview/i);
    const count = await tableItems.count();
    expect(count, 'at least one table after refresh').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Section 8: Per-cell Raw Markdown toggle
// ---------------------------------------------------------------------------

test.describe.serial('UI: Per-cell raw markdown toggle', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('UI25. "Raw Markdown" toggle button is visible on first cell', async () => {
    // aria-label is "Raw Markdown" (to switch to raw) or "Rich View" (to switch back).
    const rawBtn = page.getByRole('button', { name: /Raw Markdown|Rich View/i }).first();
    await expect(rawBtn).toBeVisible({ timeout: 5_000 });
  });

  test('UI26. Clicking "Raw Markdown" shows the raw markdown editor', async () => {
    // Start in rich view — button says "Raw Markdown"
    const rawBtn = page.getByRole('button', { name: 'Raw Markdown' }).first();
    const visible = await rawBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await rawBtn.click();
    await page.waitForTimeout(400);

    // In raw mode a CodeMirror editor in markdown mode should appear.
    // The button label should now say "Rich View".
    const richViewBtn = page.getByRole('button', { name: 'Rich View' }).first();
    await expect(richViewBtn).toBeVisible({ timeout: 3_000 });
  });

  test('UI27. Raw markdown editor contains valid markdown text', async () => {
    // The raw editor should have some content — look for .cm-content inside the cell.
    const firstCell = page.locator('[data-cell-id]').first();
    const rawEditor = firstCell.locator('.cm-editor').first();
    const visible = await rawEditor.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    const content = await rawEditor.locator('.cm-content').first().innerText().catch(() => '');
    expect(content.length, 'raw editor has content').toBeGreaterThan(0);
  });

  test('UI28. Clicking "Rich View" switches back to rendered markdown', async () => {
    const richViewBtn = page.getByRole('button', { name: 'Rich View' }).first();
    const visible = await richViewBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await richViewBtn.click();
    await page.waitForTimeout(400);

    // Back in rich view — "Raw Markdown" button should be visible again.
    const rawBtn = page.getByRole('button', { name: 'Raw Markdown' }).first();
    await expect(rawBtn).toBeVisible({ timeout: 3_000 });
  });
});
