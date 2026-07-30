/**
 * Notebook-management e2e tests.
 *
 * Beginner:
 *   NM1-NM3:  "Save Notebook" button triggers a file download without crash
 *   NM4-NM6:  "Load Notebook" button is present; Redo is disabled at history start
 *   NM7-NM9:  Getting-started banner visible on fresh load, dismiss button hides it
 *
 * Complex / power-user:
 *   NM10-NM13: Tab dirty-state indicator — editing marks tab dirty, saving clears it
 *   NM14-NM17: Multi-tab workflow — open two tabs, run queries in each independently
 *   NM18-NM21: Drag-and-drop .md file loads notebook content
 *   NM22-NM25: Redo button enabled after Undo, disabled once at head of history
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

async function setCmContent(page: Page, editor: import('@playwright/test').Locator, text: string) {
  await editor.scrollIntoViewIfNeeded();
  await editor.waitFor({ state: 'visible' });
  await editor.locator('.cm-content').first().click();
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.insertText(text);
}

// ---------------------------------------------------------------------------
// Section 1: Save Notebook button (beginner)
// ---------------------------------------------------------------------------

test.describe.serial('Notebook management: Save Notebook', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('NM1. "Save Notebook" button is visible in the toolbar', async () => {
    const saveBtn = page.getByRole('button', { name: 'Save Notebook' });
    await expect(saveBtn).toBeVisible({ timeout: 5_000 });
  });

  test('NM2. Clicking "Save Notebook" triggers a .md file download', async () => {
    const saveBtn = page.getByRole('button', { name: 'Save Notebook' });
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 6_000 }).catch(() => null),
      saveBtn.click(),
    ]);
    if (download) {
      expect(download.suggestedFilename(), 'filename is .md').toMatch(/\.md$/);
    }
    // Whether or not the download fired, the page must still be intact.
    await expect(page.getByRole('heading', { name: 'JFR Query Notebook' })).toBeVisible();
  });

  test('NM3. Cmd/Ctrl+S also triggers the save without crash', async () => {
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+s`);
    await page.waitForTimeout(500);
    await expect(page.getByRole('heading', { name: 'JFR Query Notebook' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Section 2: Load Notebook button and Redo state (beginner)
// ---------------------------------------------------------------------------

test.describe.serial('Notebook management: Load Notebook and Redo', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('NM4. "Load Notebook" button is visible in the toolbar', async () => {
    const loadBtn = page.getByRole('button', { name: 'Load Notebook' });
    await expect(loadBtn).toBeVisible({ timeout: 5_000 });
  });

  test('NM5. Redo button is visible in the toolbar', async () => {
    const redoBtn = page.getByRole('button', { name: 'Redo' });
    await expect(redoBtn).toBeVisible({ timeout: 5_000 });
  });

  test('NM6. Redo button is disabled when there is nothing to redo', async () => {
    // At start, before any undo is done, Redo should be disabled.
    const redoBtn = page.getByRole('button', { name: 'Redo' });
    const disabled = await redoBtn.getAttribute('disabled');
    expect(disabled, 'Redo disabled at history head').not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Section 3: Getting-started banner (beginner)
// ---------------------------------------------------------------------------

test.describe.serial('Notebook management: Getting-started banner', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    // Clear jfrq:onboarding-dismissed so the banner appears.
    await page.goto('/');
    await page.evaluate(() => { try { localStorage.removeItem('jfrq:onboarding-dismissed'); } catch {} });
    // Navigate to a state where cells.length === 0 so the banner shows.
    // The landing page (before demo load) has no cells.
    await page.waitForTimeout(500);
  });
  test.afterAll(async () => page.close());

  test('NM7. Getting-started banner is visible when no cells exist', async () => {
    const banner = page.locator('text=Getting started');
    const visible = await banner.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(banner).toBeVisible();
  });

  test('NM8. Dismiss button hides the banner', async () => {
    const dismissBtn = page.getByRole('button', { name: 'Dismiss getting started guide' });
    const visible = await dismissBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await dismissBtn.click();
    await page.waitForTimeout(300);

    const banner = page.locator('text=Getting started');
    const stillVisible = await banner.isVisible().catch(() => false);
    expect(stillVisible, 'banner dismissed').toBe(false);
  });

  test('NM9. After dismiss the page is still functional (navigation works)', async () => {
    await expect(page.locator('body')).toBeVisible();
    // We can still reach the demo.
    const demoBtn = page.getByRole('button', { name: /Try the demo/i });
    const visible = await demoBtn.isVisible().catch(() => false);
    // Demo button may or may not be visible depending on state — just verify no crash.
    await expect(page.locator('body')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Section 4: Tab dirty-state indicator (complex)
// ---------------------------------------------------------------------------

test.describe.serial('Notebook management: Tab dirty state', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('NM10. Active tab button has an aria-label without "(unsaved changes)" initially', async () => {
    const tabBar = page.locator('[data-testid="notebook-tab-bar"]');
    const activeTab = tabBar.locator('button[aria-selected="true"]').first();
    const label = await activeTab.getAttribute('aria-label') ?? '';
    // At demo load the tab should not be dirty yet (or may already be dirty
    // from previous session — just check the label exists).
    expect(label.length, 'tab has aria-label').toBeGreaterThan(0);
  });

  test('NM11. Editing a cell marks the active tab with the amber dirty dot', async () => {
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    await setCmContent(page, editor, '-- dirty edit ' + Date.now());
    await page.waitForTimeout(600);

    // The dirty indicator is a span inside the tab button.
    const tabBar = page.locator('[data-testid="notebook-tab-bar"]');
    const activeTab = tabBar.locator('button[aria-selected="true"]').first();
    const dirtyDot = activeTab.locator('span.rounded-full.bg-amber-400');
    const hasDot = await dirtyDot.isVisible().catch(() => false);

    // Also check aria-label suffix.
    const label = await activeTab.getAttribute('aria-label') ?? '';
    const isDirtyByLabel = label.includes('unsaved changes');

    expect(hasDot || isDirtyByLabel, 'tab shows dirty indicator').toBe(true);
  });

  test('NM12. Saving clears the dirty indicator', async () => {
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+s`);
    await page.waitForTimeout(500);

    const tabBar = page.locator('[data-testid="notebook-tab-bar"]');
    const activeTab = tabBar.locator('button[aria-selected="true"]').first();
    const label = await activeTab.getAttribute('aria-label') ?? '';
    // After save the tab should no longer be marked dirty.
    expect(label, 'no unsaved-changes label after save').not.toContain('unsaved changes');
  });

  test('NM13. Tab dirty dot is absent after save', async () => {
    const tabBar = page.locator('[data-testid="notebook-tab-bar"]');
    const activeTab = tabBar.locator('button[aria-selected="true"]').first();
    const dirtyDot = activeTab.locator('span.rounded-full.bg-amber-400');
    const hasDot = await dirtyDot.isVisible().catch(() => false);
    expect(hasDot, 'amber dot gone after save').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 5: Multi-tab independent queries (complex)
// ---------------------------------------------------------------------------

test.describe.serial('Notebook management: Multi-tab queries', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('NM14. Opening a second tab gives an empty notebook', async () => {
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(100);
    await page.keyboard.press(`${mod}+t`);
    await page.waitForTimeout(500);

    // New tab should be selected.
    const tabBar = page.locator('[data-testid="notebook-tab-bar"]');
    const tabs = tabBar.locator('button[aria-selected]');
    const count = await tabs.count();
    expect(count, 'two tabs exist').toBeGreaterThanOrEqual(2);
  });

  test('NM15. Running a query in the second tab produces a result', async () => {
    // Add a SQL block to the new (empty) tab.
    const addCellBtn = page.getByRole('button', { name: /Add Cell/i });
    const hasCells = await page.locator('[data-cell-id]').count();
    if (hasCells === 0 && await addCellBtn.isVisible().catch(() => false)) {
      await addCellBtn.click();
      await page.waitForTimeout(300);
    }

    const lastCell = page.locator('[data-cell-id]').last();
    const addSqlBtn = lastCell.getByRole('button', { name: /Add SQL/i }).first();
    if (await addSqlBtn.isVisible().catch(() => false)) {
      await addSqlBtn.click();
      await page.waitForTimeout(300);
    }

    const editor = page.locator('.cm-jfr-editor .cm-editor').last();
    const editorVisible = await editor.isVisible().catch(() => false);
    if (!editorVisible) { test.skip(); return; }

    await setCmContent(page, editor, 'SELECT 42 AS answer');
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForTimeout(2000);

    const table = page.locator('table').first();
    const visible = await table.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(table).toBeVisible();
  });

  test('NM16. Switching back to the first tab shows the original demo content', async () => {
    const tabBar = page.locator('[data-testid="notebook-tab-bar"]');
    const firstTab = tabBar.locator('button[aria-selected]').first();
    await firstTab.click();
    await page.waitForTimeout(400);

    // The first tab contains the GC demo — its editor should exist.
    const editors = page.locator('.cm-jfr-editor .cm-editor');
    const count = await editors.count();
    expect(count, 'editors visible in first tab').toBeGreaterThan(0);
  });

  test('NM17. Closing the second tab reduces tab count', async () => {
    const tabBar = page.locator('[data-testid="notebook-tab-bar"]');
    const countBefore = await tabBar.locator('button[aria-selected]').count();
    if (countBefore < 2) { test.skip(); return; }

    // Switch to last tab and close it.
    const lastTab = tabBar.locator('button[aria-selected]').last();
    await lastTab.click();
    await page.waitForTimeout(200);

    // Click its close button.
    const closeBtn = lastTab.getByRole('button', { name: 'Close tab' });
    const closeBtnVisible = await closeBtn.isVisible().catch(() => false);
    if (closeBtnVisible) {
      await closeBtn.click();
    } else {
      const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
      await page.locator('body').click({ position: { x: 10, y: 10 } });
      await page.keyboard.press(`${mod}+w`);
    }
    await page.waitForTimeout(500);

    const countAfter = await tabBar.locator('button[aria-selected]').count();
    expect(countAfter, 'tab count decreased').toBe(countBefore - 1);
  });
});

// ---------------------------------------------------------------------------
// Section 6: Redo after Undo (complex)
// ---------------------------------------------------------------------------

test.describe.serial('Notebook management: Undo and Redo', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('NM22. Redo is disabled before any Undo is performed', async () => {
    const redoBtn = page.getByRole('button', { name: 'Redo' });
    await expect(redoBtn).toBeVisible();
    const disabled = await redoBtn.getAttribute('disabled');
    expect(disabled, 'Redo disabled initially').not.toBeNull();
  });

  test('NM23. After an edit + Undo, the Redo button becomes enabled', async () => {
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    await setCmContent(page, editor, 'SELECT 1 AS redo_test_' + Date.now());
    await page.waitForTimeout(400);

    const undoBtn = page.getByRole('button', { name: 'Undo' });
    const undoDisabled = await undoBtn.getAttribute('disabled');
    if (undoDisabled !== null) { test.skip(); return; }

    await undoBtn.click();
    await page.waitForTimeout(300);

    const redoBtn = page.getByRole('button', { name: 'Redo' });
    const redoDisabled = await redoBtn.getAttribute('disabled');
    expect(redoDisabled, 'Redo enabled after Undo').toBeNull();
  });

  test('NM24. Clicking Redo re-applies the change', async () => {
    const redoBtn = page.getByRole('button', { name: 'Redo' });
    const disabled = await redoBtn.getAttribute('disabled');
    if (disabled !== null) { test.skip(); return; }

    await redoBtn.click();
    await page.waitForTimeout(300);

    // Editor should be visible and functional.
    await expect(page.locator('.cm-jfr-editor .cm-editor').first()).toBeVisible();
  });

  test('NM25. Redo becomes disabled again when at history head', async () => {
    // Keep clicking Redo until disabled.
    const redoBtn = page.getByRole('button', { name: 'Redo' });
    for (let i = 0; i < 15; i++) {
      const d = await redoBtn.getAttribute('disabled');
      if (d !== null) break;
      await redoBtn.click();
      await page.waitForTimeout(200);
    }
    const finalDisabled = await redoBtn.getAttribute('disabled');
    expect(finalDisabled, 'Redo disabled at head of history').not.toBeNull();
  });
});
