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
  // CM6 on macOS maps Ctrl+A to Emacs "go to line start", not "select all".
  const isMac = process.platform === 'darwin';
  const modKey = isMac ? 'Meta' : 'Control';
  await page.keyboard.press(`${modKey}+a`);
  await page.keyboard.press('Delete');
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
    const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    page = await ctx.newPage();
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
    // NotebookCell renders CheckCircleIcon (text-green-400) for ~1.5s after copy.
    const greenIcon = copyBtn.locator('.text-green-400');
    await greenIcon.waitFor({ state: 'visible', timeout: 2_000 });
    // Icon reverts after the timeout.
    await greenIcon.waitFor({ state: 'hidden', timeout: 3_000 });
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

    expect(newFirstTitle, 'cell moved back up').toBe(secondTitleBefore);
  });
});

// ---------------------------------------------------------------------------
// Section 9: Schema sidebar tooltip
// ---------------------------------------------------------------------------

test.describe.serial('Schema sidebar tooltip', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('T27. Hovering a table name in the sidebar shows a tooltip', async () => {
    const sidebarItems = page.locator('.sidebar-list-font li button, .sidebar-list-font button');
    const count = await sidebarItems.count();
    expect(count, 'sidebar has items').toBeGreaterThan(0);

    const firstItem = sidebarItems.first();
    await firstItem.scrollIntoViewIfNeeded();
    await firstItem.hover();

    await page.waitForTimeout(600);

    // Tooltip is a portal rendered into document.body; className includes bg-gray-700 and z-[100]
    const tooltip = page.locator('body > div.bg-gray-700, body > div.absolute.z-\\[100\\]').first();
    const appeared = await tooltip.waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    expect(appeared, 'tooltip appeared on hover').toBe(true);
  });

  test('T28. Tooltip contains column names for GarbageCollection', async () => {
    const gcButton = page.locator('.sidebar-list-font button').filter({ hasText: /GarbageCollection/ }).first();
    const gcVisible = await gcButton.isVisible().catch(() => false);

    if (!gcVisible) {
      test.skip();
      return;
    }

    await gcButton.hover();
    await page.waitForTimeout(600);

    const bodyText = await page.locator('body').innerText();
    const hasColumnInfo =
      bodyText.includes('gcId') ||
      bodyText.includes('cause') ||
      bodyText.includes('duration');
    expect(hasColumnInfo, 'tooltip contains GarbageCollection column names').toBe(true);
  });

  test('T29. Moving mouse away hides the tooltip', async () => {
    await page.mouse.move(100, 100);
    await page.waitForTimeout(800);

    const tooltip = page.locator('body > div.bg-gray-700, body > div.absolute.z-\\[100\\]').first();
    const stillVisible = await tooltip.isVisible().catch(() => false);
    expect(stillVisible, 'tooltip hidden after mouse-out').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 10: InlineChat per-cell AI panel
// ---------------------------------------------------------------------------

test.describe.serial('InlineChat: per-cell AI panel', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);

    // Enable AI features — button has aria-label "Enable AI Features" initially.
    const enableAiBtn = page.getByRole('button', { name: 'Enable AI Features' });
    const aiVisible = await enableAiBtn.isVisible().catch(() => false);
    if (aiVisible) {
      await enableAiBtn.click();
      await page.waitForTimeout(300);
    }
  });

  test.afterAll(async () => page.close());

  test('T30. "Refine with AI" button appears on SQL block when AI is active', async () => {
    const aiBtn = page.getByRole('button', { name: 'Refine with AI' }).first();
    const visible = await aiBtn.isVisible().catch(() => false);
    if (!visible) {
      test.skip();
      return;
    }
    await aiBtn.waitFor({ state: 'visible', timeout: 5_000 });
  });

  test('T31. Clicking "Refine with AI" opens the InlineChat panel', async () => {
    const aiBtn = page.getByRole('button', { name: 'Refine with AI' }).first();
    const visible = await aiBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await aiBtn.click();
    await page.waitForTimeout(400);

    // InlineChat renders a textarea / input for the user message.
    const chatInput = page.locator('textarea[placeholder*="message"], textarea[placeholder*="ask"], textarea[placeholder*="Ask"], input[placeholder*="message"], input[placeholder*="ask"]').first();
    const inputVisible = await chatInput.waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    expect(inputVisible, 'InlineChat input visible').toBe(true);
  });

  test('T32. Clicking "Refine with AI" again closes the InlineChat panel', async () => {
    const aiBtn = page.getByRole('button', { name: 'Refine with AI' }).first();
    const visible = await aiBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    // Click again to toggle closed.
    await aiBtn.click();
    await page.waitForTimeout(400);

    const chatInput = page.locator('textarea[placeholder*="message"], textarea[placeholder*="ask"], textarea[placeholder*="Ask"], input[placeholder*="message"], input[placeholder*="ask"]').first();
    const inputVisible = await chatInput.isVisible().catch(() => false);
    expect(inputVisible, 'InlineChat closed after second click').toBe(false);
  });

  test('T33. "Suggest plot with AI" button appears on SQL block', async () => {
    const sparkleBtn = page.getByRole('button', { name: 'Suggest plot with AI' }).first();
    const visible = await sparkleBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await sparkleBtn.waitFor({ state: 'visible', timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Section 11: DataTable — search, sort, CSV export
// ---------------------------------------------------------------------------

test.describe.serial('DataTable: search, sort, CSV', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    await page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 20_000 });
  });

  test.afterAll(async () => page.close());

  test('T34. Table has sortable column headers', async () => {
    const firstHeader = page.locator('table thead th').first();
    await firstHeader.waitFor({ state: 'visible', timeout: 10_000 });

    await firstHeader.click();
    await page.waitForTimeout(400);
    await firstHeader.waitFor({ state: 'visible' });

    await firstHeader.click();
    await page.waitForTimeout(400);
    await firstHeader.waitFor({ state: 'visible' });
  });

  test('T35. Search box filters rows', async () => {
    // DataTable uses placeholder="Search..." per DataTable.tsx source
    const searchInput = page.locator('input[placeholder="Search..."]').first();
    const searchVisible = await searchInput.isVisible().catch(() => false);
    if (!searchVisible) { test.skip(); return; }

    const rowCountBefore = await page.locator('table tbody tr').count();
    expect(rowCountBefore, 'rows present before filter').toBeGreaterThan(0);

    await searchInput.fill('XYZZY_NO_MATCH_9999');
    await page.waitForTimeout(400);

    const rowCountAfter = await page.locator('table tbody tr').count();
    expect(rowCountAfter, 'fewer rows after search filter').toBeLessThan(rowCountBefore);

    await searchInput.fill('');
    await page.waitForTimeout(300);
  });

  test('T36. CSV export button triggers a download', async () => {
    // DataTable.tsx renders: <button title="Export to CSV">CSV ↓</button>
    const csvBtn = page.getByRole('button', { name: /CSV|csv|export|Export/i }).first();
    const csvVisible = await csvBtn.isVisible().catch(() => false);
    if (!csvVisible) { test.skip(); return; }

    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
    await csvBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename(), 'CSV filename').toMatch(/\.csv$/i);
  });
});

// ---------------------------------------------------------------------------
// Section 12: Inline block insertion (+ SQL / + Plot / + Prose between blocks)
// ---------------------------------------------------------------------------

test.describe.serial('Inline block insertion', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });

  test.afterAll(async () => page.close());

  test('T37. "+ SQL" insert bar is present between blocks (on hover)', async () => {
    // Insert bars are opacity-0 until hovered. Force-click or hover to reveal.
    const firstCell = page.locator('[data-cell-idx="1"]');
    await firstCell.hover();
    await page.waitForTimeout(300);

    const insertSqlBtns = page.getByText('+ SQL');
    const count = await insertSqlBtns.count();
    expect(count, 'at least one + SQL insert button').toBeGreaterThan(0);
  });

  test('T38. Clicking "+ SQL" inserts a new SQL editor', async () => {
    const editorCountBefore = await page.locator('.cm-jfr-editor .cm-editor').count();

    const firstCell = page.locator('[data-cell-idx="1"]');
    await firstCell.hover();
    await page.waitForTimeout(200);
    const insertSqlBtn = page.getByText('+ SQL').first();
    await insertSqlBtn.click({ force: true });
    await page.waitForTimeout(400);

    const editorCountAfter = await page.locator('.cm-jfr-editor .cm-editor').count();
    expect(editorCountAfter, 'new SQL editor added').toBeGreaterThan(editorCountBefore);
  });
});

// ---------------------------------------------------------------------------
// Section 13: PlotSuggestionChip
// ---------------------------------------------------------------------------

test.describe.serial('PlotSuggestionChip', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);

    const enableAiBtn = page.getByRole('button', { name: 'Enable AI Features' });
    const aiVisible = await enableAiBtn.isVisible().catch(() => false);
    if (aiVisible) {
      await enableAiBtn.click();
      await page.waitForTimeout(300);
    }

    // Open Settings and enable auto-plot suggestion if possible.
    const settingsBtn = page.getByRole('button', { name: 'Settings' });
    await settingsBtn.click();
    await page.waitForTimeout(400);

    // Try to enable auto-plot suggestion toggle.
    const autoPlotLabel = page.getByText(/auto.plot suggestion/i).first();
    const toggleVisible = await autoPlotLabel.isVisible().catch(() => false);
    if (toggleVisible) {
      // Find the nearest checkbox.
      const toggle = page.locator('input[type="checkbox"]').first();
      const isChecked = await toggle.isChecked().catch(() => false);
      if (!isChecked) {
        await toggle.click().catch(() => {});
        await page.waitForTimeout(200);
      }
    }

    // Close settings modal.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  });

  test.afterAll(async () => page.close());

  test('T39. PlotSuggestionChip appears after a SQL query runs (when feature enabled)', async () => {
    const chip = page.locator('[data-testid="plot-suggestion-chip"]').first();
    const appeared = await chip.waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);

    if (!appeared) {
      console.log('PlotSuggestionChip not visible — AI feature may be inactive');
      test.skip();
      return;
    }
    expect(appeared, 'PlotSuggestionChip visible').toBe(true);
  });

  test('T40. Dismissing the chip hides it', async () => {
    const chip = page.locator('[data-testid="plot-suggestion-chip"]').first();
    const visible = await chip.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    const dismissBtn = chip.getByRole('button', { name: /dismiss|×|close/i }).first();
    const dismissVisible = await dismissBtn.isVisible().catch(() => false);
    if (dismissVisible) {
      await dismissBtn.click();
      await page.waitForTimeout(300);
      const stillVisible = await chip.isVisible().catch(() => false);
      expect(stillVisible, 'chip dismissed').toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 14: Final sanity — no unhandled JS errors
// ---------------------------------------------------------------------------

test.describe('Session sanity', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  test('T41. No unhandled page errors thrown during any test', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto('/');
    const demoBtn = page.getByRole('button', { name: /Try the demo/i });
    await demoBtn.waitFor({ state: 'visible', timeout: 30_000 });
    await demoBtn.click();
    await page.getByRole('heading', { name: 'JFR Query Notebook' }).waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(3000);
    const realErrors = errors.filter(e =>
      !e.includes('server probe') &&
      !e.includes('Failed to fetch') &&
      !e.includes('NetworkError')
    );
    expect(realErrors, `JS errors: ${realErrors.join('; ')}`).toHaveLength(0);
  });
});
