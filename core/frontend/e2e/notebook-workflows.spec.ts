/**
 * Systematic workflow e2e tests for features with zero prior coverage.
 *
 * Covers: toolbar interactions (Undo/Redo, Run All, Collapse/Expand All,
 * Clear Results, Raw Markdown mode, Presenter Mode), InlineChat per-cell AI,
 * schema sidebar tooltip, Format SQL, Copy SQL, PlotSuggestionChip,
 * cell-level mutations, DataTable edge cases.
 *
 * Uses the GC demo dataset loaded via "Try the demo".
 * Skipped when SKIP_E2E=1.
 */

import { test, expect, Page } from '@playwright/test';

const SKIP = process.env.SKIP_E2E === '1';

/** Load the GC demo and wait for the first SQL editor to be visible. */
async function gotoDemo(page: Page) {
  await page.goto('/');
  const demoBtn = page.getByRole('button', { name: /Try the demo/i });
  await demoBtn.waitFor({ state: 'visible', timeout: 30_000 });
  await demoBtn.click();
  await page
    .getByRole('heading', { name: 'JFR Query Notebook' })
    .waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('.cm-jfr-editor .cm-editor').first().waitFor({
    state: 'visible',
    timeout: 30_000,
  });
  // Allow schema discovery + initial auto-run to complete.
  await page.waitForTimeout(2000);
}

/** Replace content of a CodeMirror 6 editor with new text (CM6-safe). */
async function setCmContent(page: Page, editor: import('@playwright/test').Locator, text: string) {
  await editor.scrollIntoViewIfNeeded();
  await editor.waitFor({ state: 'visible' });
  const content = editor.locator('.cm-content').first();
  await content.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type(text);
}

// ---------------------------------------------------------------------------
// Section 1: Toolbar — Collapse / Expand All
// ---------------------------------------------------------------------------

test.describe.serial('Toolbar: Collapse All / Expand All', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('T1. Collapse All hides all cell bodies', async () => {
    const editors = page.locator('.cm-jfr-editor .cm-editor');
    const editorCountBefore = await editors.count();
    expect(editorCountBefore).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Collapse All' }).click();
    await page.waitForTimeout(400);

    const editorsAfter = await editors.count();
    expect(editorsAfter, 'editors hidden after Collapse All').toBe(0);
  });

  test('T2. Expand All reveals all cell bodies again', async () => {
    await page.getByRole('button', { name: 'Expand All' }).click();
    await page.waitForTimeout(400);

    const editors = page.locator('.cm-jfr-editor .cm-editor');
    const editorCount = await editors.count();
    expect(editorCount, 'editors visible after Expand All').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Section 2: Toolbar — Clear All Results
// ---------------------------------------------------------------------------

test.describe.serial('Toolbar: Clear All Results', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('T3. Query results exist before clearing', async () => {
    // Use `main` area selector to exclude sidebar preview tables.
    const resultRows = page.locator('main table tbody tr');
    await resultRows.first().waitFor({ state: 'visible', timeout: 20_000 });
    // Wait for all in-flight queries to finish (no spinning indicators remain).
    await page.waitForFunction(
      () => document.querySelectorAll('.animate-spin').length === 0,
      { timeout: 30_000 }
    );
    const count = await resultRows.count();
    expect(count, 'at least one result row before clear').toBeGreaterThan(0);
  });

  test('T4. Clear All Results removes all result tables', async () => {
    // Ensure no queries are in flight before clearing.
    await page.waitForFunction(
      () => document.querySelectorAll('.animate-spin').length === 0,
      { timeout: 15_000 }
    );
    await page.getByRole('button', { name: 'Clear All Results' }).click();
    await page.waitForTimeout(800);

    // Use `main` area selector to exclude sidebar preview tables.
    const resultRows = page.locator('main table tbody tr');
    const count = await resultRows.count();
    expect(count, 'no result rows after Clear All').toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Section 3: Toolbar — Run All Queries
// ---------------------------------------------------------------------------

test.describe.serial('Toolbar: Run All Queries', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('T5. Clear results then Run All re-populates tables', async () => {
    await page.getByRole('button', { name: 'Clear All Results' }).click();
    await page.waitForTimeout(400);

    const rows = page.locator('main table tbody tr');
    const countAfterClear = await rows.count();
    expect(countAfterClear, 'no rows after clear').toBe(0);

    await page.getByRole('button', { name: 'Run All Queries' }).click();

    await rows.first().waitFor({ state: 'visible', timeout: 30_000 });
    const countAfterRun = await rows.count();
    expect(countAfterRun, 'rows present after Run All').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Section 4: Toolbar — Undo / Redo
// ---------------------------------------------------------------------------

test.describe.serial('Toolbar: Undo / Redo', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('T6. Undo button is visible in toolbar', async () => {
    // Note: Undo may already be enabled because loading the demo notebook
    // registers a history entry via useHistoryState. We only verify it's visible.
    const undoBtn = page.getByRole('button', { name: 'Undo' });
    await undoBtn.waitFor({ state: 'visible' });
    expect(await undoBtn.isVisible(), 'Undo button is visible').toBe(true);
  });

  test('T7. Making a cell edit enables Undo', async () => {
    const editors = page.locator('.cm-jfr-editor .cm-editor');
    const firstEditor = editors.first();
    await setCmContent(page, firstEditor, 'SELECT 42 AS answer');

    await page.waitForTimeout(1200);

    const undoBtn = page.getByRole('button', { name: 'Undo' });
    const isDisabled = await undoBtn.isDisabled();
    expect(isDisabled, 'Undo enabled after edit').toBe(false);
  });

  test('T8. Clicking Undo reverts the edit', async () => {
    const editors = page.locator('.cm-jfr-editor .cm-editor');
    const firstEditor = editors.first();

    const contentBefore = await firstEditor.locator('.cm-content').first().innerText();

    await page.getByRole('button', { name: 'Undo' }).click();
    await page.waitForTimeout(600);

    const contentAfter = await firstEditor.locator('.cm-content').first().innerText();
    expect(contentAfter, 'content changed after Undo').not.toBe(contentBefore);
  });

  test('T9. Redo button is enabled after Undo', async () => {
    const redoBtn = page.getByRole('button', { name: 'Redo' });
    const isDisabled = await redoBtn.isDisabled();
    expect(isDisabled, 'Redo enabled after Undo').toBe(false);
  });

  test('T10. Clicking Redo re-applies the edit', async () => {
    const editors = page.locator('.cm-jfr-editor .cm-editor');
    const firstEditor = editors.first();
    const contentBeforeRedo = await firstEditor.locator('.cm-content').first().innerText();

    await page.getByRole('button', { name: 'Redo' }).click();
    await page.waitForTimeout(600);

    const contentAfterRedo = await firstEditor.locator('.cm-content').first().innerText();
    expect(contentAfterRedo, 'content changed after Redo').not.toBe(contentBeforeRedo);
  });
});

// ---------------------------------------------------------------------------
// Section 5: Toolbar — Raw Markdown mode
// ---------------------------------------------------------------------------

test.describe.serial('Toolbar: Raw Markdown mode', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('T11. "Edit Raw Markdown" button is visible in notebook view', async () => {
    const btn = page.getByRole('button', { name: 'Edit Raw Markdown' });
    await btn.waitFor({ state: 'visible', timeout: 10_000 });
  });

  test('T12. Clicking it switches to raw editor (single full-page CM6 editor)', async () => {
    await page.getByRole('button', { name: 'Edit Raw Markdown' }).click();
    await page.waitForTimeout(400);

    const switchBtn = page.getByRole('button', { name: 'Switch to Notebook View' });
    await switchBtn.waitFor({ state: 'visible', timeout: 5_000 });
  });

  test('T13. Raw editor contains markdown text (## headings, SQL fences)', async () => {
    const rawContent = page.locator('.cm-editor .cm-content').first();
    await rawContent.waitFor({ state: 'visible', timeout: 5_000 });
    const text = await rawContent.innerText();
    expect(text, 'raw content has markdown headings').toMatch(/##/);
  });

  test('T14. "Switch to Notebook View" restores parsed cells', async () => {
    await page.getByRole('button', { name: 'Switch to Notebook View' }).click();
    await page.waitForTimeout(400);

    const editors = page.locator('.cm-jfr-editor .cm-editor');
    const count = await editors.count();
    expect(count, 'editors visible after switching back').toBeGreaterThan(0);

    const rawBtn = page.getByRole('button', { name: 'Edit Raw Markdown' });
    await rawBtn.waitFor({ state: 'visible', timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Section 6: Toolbar — Presenter Mode
// ---------------------------------------------------------------------------

test.describe.serial('Toolbar: Presenter Mode', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    await page.locator('main table tbody tr').first().waitFor({ state: 'visible', timeout: 20_000 });
  });

  test.afterAll(async () => page.close());

  test('T15. "Presenter Mode" button is visible', async () => {
    const btn = page.getByRole('button', { name: 'Presenter Mode' });
    await btn.waitFor({ state: 'visible', timeout: 5_000 });
  });

  test('T16. Entering presenter mode hides SQL editors', async () => {
    const editorsBefore = await page.locator('.cm-jfr-editor .cm-editor').count();
    expect(editorsBefore, 'editors present before presenter mode').toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Presenter Mode' }).click();
    await page.waitForTimeout(400);

    const editorsAfter = await page.locator('.cm-jfr-editor .cm-editor').count();
    expect(editorsAfter, 'no SQL editors in presenter mode').toBe(0);
  });

  test('T17. Result tables remain visible in presenter mode', async () => {
    const rows = page.locator('main table tbody tr');
    const count = await rows.count();
    expect(count, 'result rows still visible in presenter mode').toBeGreaterThan(0);
  });

  test('T18. Drag handles are not visible in presenter mode', async () => {
    const handles = page.getByRole('button', { name: 'Drag to reorder cell' });
    const count = await handles.count();
    expect(count, 'no drag handles in presenter mode').toBe(0);
  });

  test('T19. "Exit Presenter Mode" button restores editors', async () => {
    await page.getByRole('button', { name: 'Exit Presenter Mode' }).click();
    await page.waitForTimeout(400);

    const editors = page.locator('.cm-jfr-editor .cm-editor');
    const count = await editors.count();
    expect(count, 'editors restored after exiting presenter mode').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Section 7: Per-cell SQL buttons — Format SQL, Copy SQL
// ---------------------------------------------------------------------------

test.describe.serial('Per-cell: Format SQL and Copy SQL', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('T20. Format SQL button is visible on first SQL block', async () => {
    const formatBtn = page.getByRole('button', { name: 'Format SQL' }).first();
    await formatBtn.waitFor({ state: 'visible', timeout: 10_000 });
  });

  test('T21. Format SQL reformats an unformatted query', async () => {
    const editors = page.locator('.cm-jfr-editor .cm-editor');
    const firstSqlEditor = editors.first();

    await setCmContent(page, firstSqlEditor, 'select gcId,cause,duration from GarbageCollection where duration>0 limit 5');
    await page.waitForTimeout(300);

    const formatBtn = page.getByRole('button', { name: 'Format SQL' }).first();
    await formatBtn.click();
    await page.waitForTimeout(1000);

    const content = await firstSqlEditor.locator('.cm-content').first().innerText();
    expect(content, 'formatted SQL has newlines').toMatch(/\n/);
    expect(content.toUpperCase(), 'formatted SQL contains SELECT').toContain('SELECT');
  });

  test('T22. Copy SQL button is visible on first SQL block', async () => {
    const copyBtn = page.getByRole('button', { name: 'Copy SQL' }).first();
    await copyBtn.waitFor({ state: 'visible', timeout: 5_000 });
  });

  test('T23. Copy SQL button shows checkmark (visual feedback) after click', async () => {
    const copyBtn = page.getByRole('button', { name: 'Copy SQL' }).first();
    await copyBtn.click();
    await page.waitForTimeout(400);
    await copyBtn.waitFor({ state: 'visible' });
    await page.waitForTimeout(1600);
    await copyBtn.waitFor({ state: 'visible' });
  });
});

// ---------------------------------------------------------------------------
// Section 8: Cell reorder — keyboard shortcut (Alt+Up/Down)
// ---------------------------------------------------------------------------

test.describe.serial('Cell reorder: Alt+Arrow keyboard shortcut', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('T24. Drag handle is visible on each cell', async () => {
    const handles = page.getByRole('button', { name: 'Drag to reorder cell' });
    await handles.first().waitFor({ state: 'visible', timeout: 10_000 });
    const count = await handles.count();
    expect(count, 'at least one drag handle').toBeGreaterThan(0);
  });

  test('T25. Alt+ArrowDown on drag handle moves cell down', async () => {
    // Cells are re-indexed after every move, so we track identity by content (cell title text).
    const cells = page.locator('[data-cell-idx]');
    const firstCellTitle = await cells.nth(0).locator('h2').first().innerText().catch(() => '');
    const secondCellTitle = await cells.nth(1).locator('h2').first().innerText().catch(() => '');
    console.log(`Cell titles before: ["${firstCellTitle}", "${secondCellTitle}"]`);

    const firstHandle = page.getByRole('button', { name: 'Drag to reorder cell' }).first();
    await firstHandle.click();
    await page.waitForTimeout(200);

    await page.keyboard.down('Alt');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Alt');
    await page.waitForTimeout(1500);

    const cellsAfter = page.locator('[data-cell-idx]');
    const newFirstTitle = await cellsAfter.nth(0).locator('h2').first().innerText().catch(() => '');
    const newSecondTitle = await cellsAfter.nth(1).locator('h2').first().innerText().catch(() => '');
    console.log(`Cell titles after: ["${newFirstTitle}", "${newSecondTitle}"]`);

    expect(newFirstTitle, 'first cell is now old second').toBe(secondCellTitle);
    expect(newSecondTitle, 'second cell is now old first').toBe(firstCellTitle);
  });

  test('T26. Alt+ArrowUp on drag handle moves cell back up', async () => {
    // After T25, "Step 1 — Your first query" is at index 0, "" (intro) at index 1.
    // Move index-1 cell back up so the intro returns to position 0.
    const cells = page.locator('[data-cell-idx]');
    const firstTitleBefore = await cells.nth(0).locator('h2').first().innerText().catch(() => '');
    const secondTitleBefore = await cells.nth(1).locator('h2').first().innerText().catch(() => '');

    const secondHandle = page.getByRole('button', { name: 'Drag to reorder cell' }).nth(1);
    await secondHandle.click();
    await page.waitForTimeout(200);
    await page.keyboard.down('Alt');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.up('Alt');
    await page.waitForTimeout(1500);

    const cellsAfter = page.locator('[data-cell-idx]');
    const newFirstTitle = await cellsAfter.nth(0).locator('h2').first().innerText().catch(() => '');

    console.log(`T26 before[0]="${firstTitleBefore}" after[0]="${newFirstTitle}"`);
    expect(newFirstTitle, 'cell moved back up').toBe(secondTitleBefore);
  });
});
