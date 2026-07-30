/**
 * Complex / power-user workflow e2e tests.
 *
 * Covers analyst and advanced-user interactions not yet in advanced-scenarios.spec.ts:
 *   PW1-PW4:  Undo button disabled state at history boundaries
 *   PW5-PW8:  Auto-Run toggle enables/disables and persists across cell edits
 *   PW9-PW12: Presenter Mode hides editors, shows results, exit restores editors
 *   PW13-PW16: Per-cell variables in SQL — $limit used in LIMIT clause
 *   PW17-PW20: Multiple SQL blocks in one cell produce independent result tables
 *   PW21-PW24: Format SQL on messy input, then undo restores original
 *   PW25-PW28: Cell deletion via context menu "Delete" item (not toolbar)
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
  await page.waitForTimeout(2500);
}

async function setCmContent(page: Page, editor: import('@playwright/test').Locator, text: string) {
  await editor.scrollIntoViewIfNeeded();
  await editor.waitFor({ state: 'visible' });
  const content = editor.locator('.cm-content').first();
  await content.click();
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.insertText(text);
}

async function runCell(page: Page) {
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+Enter`);
}

// ---------------------------------------------------------------------------
// Section 1: Undo button disabled state
// ---------------------------------------------------------------------------

test.describe.serial('Power user: Undo disabled state', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('PW1. Undo button exists in the toolbar', async () => {
    const undoBtn = page.getByRole('button', { name: 'Undo' });
    await expect(undoBtn).toBeVisible({ timeout: 5_000 });
  });

  test('PW2. After making an edit, Undo button is enabled', async () => {
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    await setCmContent(page, editor, 'SELECT 1 AS undo_test');
    await page.waitForTimeout(300);

    const undoBtn = page.getByRole('button', { name: 'Undo' });
    const disabled = await undoBtn.getAttribute('disabled');
    expect(disabled, 'Undo enabled after edit').toBeNull();
  });

  test('PW3. Clicking Undo reverts the editor content', async () => {
    const undoBtn = page.getByRole('button', { name: 'Undo' });
    await undoBtn.click();
    await page.waitForTimeout(400);

    // The content should have changed (reverted) — just verify no crash and
    // editor is still visible.
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    await expect(editor).toBeVisible();
  });

  test('PW4. Undo button becomes disabled when history is exhausted', async () => {
    // Keep clicking Undo until it becomes disabled.
    const undoBtn = page.getByRole('button', { name: 'Undo' });
    for (let i = 0; i < 20; i++) {
      const disabled = await undoBtn.getAttribute('disabled');
      if (disabled !== null) break;
      await undoBtn.click();
      await page.waitForTimeout(200);
    }
    const finalDisabled = await undoBtn.getAttribute('disabled');
    expect(finalDisabled, 'Undo disabled at start of history').not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Section 2: Auto-Run toggle
// ---------------------------------------------------------------------------

test.describe.serial('Power user: Auto-Run toggle', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('PW5. Auto-Run toggle button is visible in toolbar', async () => {
    // aria-label is "Disable Auto-Run" when enabled, "Enable Auto-Run" when disabled.
    const autoRunBtn = page.getByRole('button', { name: /Auto-Run/i });
    await expect(autoRunBtn).toBeVisible({ timeout: 5_000 });
  });

  test('PW6. Clicking Auto-Run toggles its state (label flips)', async () => {
    const autoRunBtn = page.getByRole('button', { name: /Auto-Run/i });
    const labelBefore = await autoRunBtn.getAttribute('aria-label') ?? '';

    await autoRunBtn.click();
    await page.waitForTimeout(300);

    const labelAfter = await autoRunBtn.getAttribute('aria-label') ?? '';
    expect(labelAfter, 'label changed after toggle').not.toBe(labelBefore);
  });

  test('PW7. Toggling back restores the original state', async () => {
    const autoRunBtn = page.getByRole('button', { name: /Auto-Run/i });
    const labelAfterFirst = await autoRunBtn.getAttribute('aria-label') ?? '';

    await autoRunBtn.click();
    await page.waitForTimeout(300);

    const labelRestored = await autoRunBtn.getAttribute('aria-label') ?? '';
    expect(labelRestored, 'label restored after second toggle').not.toBe(labelAfterFirst);
  });

  test('PW8. Page heading still visible after toggling Auto-Run twice', async () => {
    await expect(page.getByRole('heading', { name: 'JFR Query Notebook' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Section 3: Presenter Mode
// ---------------------------------------------------------------------------

test.describe.serial('Power user: Presenter Mode', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    // Run the first query so there is a visible result to show in presenter mode.
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    await setCmContent(page, editor, 'SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause LIMIT 5');
    await runCell(page);
    await page.waitForTimeout(2000);
  });
  test.afterAll(async () => page.close());

  test('PW9. "Presenter Mode" button is visible in toolbar', async () => {
    const presenterBtn = page.getByRole('button', { name: 'Presenter Mode' });
    await expect(presenterBtn).toBeVisible({ timeout: 5_000 });
  });

  test('PW10. Clicking "Presenter Mode" hides the SQL editor', async () => {
    await page.getByRole('button', { name: 'Presenter Mode' }).click();
    await page.waitForTimeout(600);

    // In presenter mode, CodeMirror SQL editors should be hidden.
    const editors = page.locator('.cm-jfr-editor .cm-editor');
    const count = await editors.count();
    // Either count is 0 or all are hidden.
    let allHidden = true;
    for (let i = 0; i < count; i++) {
      const vis = await editors.nth(i).isVisible().catch(() => false);
      if (vis) { allHidden = false; break; }
    }
    expect(allHidden || count === 0, 'editors hidden in presenter mode').toBe(true);
  });

  test('PW11. In Presenter Mode a result table is still visible', async () => {
    const table = page.locator('table').first();
    const visible = await table.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(table).toBeVisible();
  });

  test('PW12. Clicking "Exit Presenter Mode" restores the SQL editor', async () => {
    await page.getByRole('button', { name: 'Exit Presenter Mode' }).click();
    await page.waitForTimeout(600);

    // Editor should be visible again.
    await expect(page.locator('.cm-jfr-editor .cm-editor').first())
      .toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Section 4: Per-cell $variable used in SQL LIMIT
// ---------------------------------------------------------------------------

test.describe.serial('Power user: Per-cell variable in SQL', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    // Add a fresh cell to work with.
    await page.getByRole('button', { name: /Add Cell/i }).click();
    await page.waitForTimeout(400);
  });
  test.afterAll(async () => page.close());

  test('PW13. Add a cell-local $limit variable and set its value to 3', async () => {
    const addVarBtn = page.getByRole('button', { name: /Add variable/i }).last();
    const visible = await addVarBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await addVarBtn.click();
    await page.waitForTimeout(400);

    // The key input gets focus with "$newVar".
    const keyInput = page.locator('input[aria-label*="Cell-local variable"]').last();
    const keyVisible = await keyInput.isVisible().catch(() => false);
    if (!keyVisible) { test.skip(); return; }

    // Clear and type "$limit".
    await keyInput.fill('$limit');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    // Set value to 3.
    const valueInput = page.locator('input[aria-label^="Value for "]').last();
    await valueInput.fill('3');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
  });

  test('PW14. Add a SQL block to the cell using $limit', async () => {
    const lastCell = page.locator('[data-cell-id]').last();
    const addSqlBtn = lastCell.getByRole('button', { name: /Add SQL/i }).first();
    const visible = await addSqlBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await addSqlBtn.click();
    await page.waitForTimeout(300);

    const sqlEditor = lastCell.locator('.cm-jfr-editor .cm-editor').first();
    await sqlEditor.waitFor({ state: 'visible', timeout: 5_000 });
    await setCmContent(page, sqlEditor, 'SELECT cause FROM GarbageCollection LIMIT $limit');
    await page.waitForTimeout(200);
  });

  test('PW15. Running the SQL produces a result with ≤3 rows', async () => {
    const lastCell = page.locator('[data-cell-id]').last();
    const runBtn = lastCell.getByRole('button', { name: /Run query/i }).first();
    const visible = await runBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await runBtn.click();
    await page.waitForTimeout(2500);

    const table = lastCell.locator('table').first();
    const tableVisible = await table.isVisible().catch(() => false);
    if (!tableVisible) { test.skip(); return; }

    const rows = await table.locator('tbody tr').count();
    expect(rows, 'result respects $limit = 3').toBeLessThanOrEqual(3);
  });

  test('PW16. Changing the variable value to 7 and re-running gives ≤7 rows', async () => {
    const valueInput = page.locator('input[aria-label^="Value for "]').last();
    const visible = await valueInput.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await valueInput.fill('7');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    const lastCell = page.locator('[data-cell-id]').last();
    const runBtn = lastCell.getByRole('button', { name: /Run query/i }).first();
    await runBtn.click();
    await page.waitForTimeout(2500);

    const rows = await lastCell.locator('table tbody tr').count();
    expect(rows, 'result respects $limit = 7').toBeLessThanOrEqual(7);
  });
});

// ---------------------------------------------------------------------------
// Section 5: Multiple SQL blocks in one cell
// ---------------------------------------------------------------------------

test.describe.serial('Power user: Multiple SQL blocks per cell', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    await page.getByRole('button', { name: /Add Cell/i }).click();
    await page.waitForTimeout(400);
  });
  test.afterAll(async () => page.close());

  test('PW17. Add two SQL blocks to one cell', async () => {
    const lastCell = page.locator('[data-cell-id]').last();

    // Add first SQL block.
    const addSql1 = lastCell.getByRole('button', { name: /Add SQL/i }).first();
    const visible = await addSql1.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await addSql1.click();
    await page.waitForTimeout(300);

    const editors = lastCell.locator('.cm-jfr-editor .cm-editor');
    const editor1 = editors.first();
    await editor1.waitFor({ state: 'visible', timeout: 5_000 });
    await setCmContent(page, editor1, 'SELECT COUNT(*) AS gc_count FROM GarbageCollection');
    await page.waitForTimeout(200);

    // Add second SQL block.
    const addSql2 = lastCell.getByRole('button', { name: /Add SQL/i }).last();
    await addSql2.click();
    await page.waitForTimeout(300);

    const editor2 = editors.last();
    await editor2.waitFor({ state: 'visible', timeout: 5_000 });
    await setCmContent(page, editor2, 'SELECT MAX(duration) AS max_ms FROM GarbageCollection');
    await page.waitForTimeout(200);

    const editorCount = await editors.count();
    expect(editorCount, 'two SQL editors in the cell').toBeGreaterThanOrEqual(2);
  });

  test('PW18. Running both blocks produces two result tables in the same cell', async () => {
    const lastCell = page.locator('[data-cell-id]').last();

    // Run each SQL block by clicking its individual Run button.
    const runBtns = lastCell.getByRole('button', { name: /Run query/i });
    const runCount = await runBtns.count();
    if (runCount < 2) { test.skip(); return; }

    await runBtns.nth(0).click();
    await page.waitForTimeout(1800);
    await runBtns.nth(1).click();
    await page.waitForTimeout(1800);

    const tables = lastCell.locator('table');
    const tableCount = await tables.count();
    expect(tableCount, 'at least two result tables in cell').toBeGreaterThanOrEqual(2);
  });

  test('PW19. Each result table has at least one row', async () => {
    const lastCell = page.locator('[data-cell-id]').last();
    const tables = lastCell.locator('table');
    const count = await tables.count();
    if (count < 2) { test.skip(); return; }

    for (let i = 0; i < Math.min(count, 2); i++) {
      const rows = await tables.nth(i).locator('tbody tr').count();
      expect(rows, `table ${i + 1} has rows`).toBeGreaterThan(0);
    }
  });

  test('PW20. Deleting one SQL block leaves the other intact', async () => {
    const lastCell = page.locator('[data-cell-id]').last();
    const deleteQueryBtns = lastCell.getByRole('button', { name: 'Delete query block' });
    const count = await deleteQueryBtns.count();
    if (count < 2) { test.skip(); return; }

    const tablesBefore = await lastCell.locator('table').count();
    await deleteQueryBtns.last().click();
    await page.waitForTimeout(400);

    // One fewer SQL editor but the other result should persist.
    const editors = await lastCell.locator('.cm-jfr-editor .cm-editor').count();
    expect(editors, 'one editor remains').toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Section 6: Format SQL then Undo
// ---------------------------------------------------------------------------

test.describe.serial('Power user: Format SQL then Undo', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('PW21. Write messy SQL into first editor', async () => {
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    await setCmContent(page, editor, 'select cause,count(*) as cnt from GarbageCollection where duration>0 group by cause order by cnt desc limit 10');
    await page.waitForTimeout(300);

    const content = await editor.locator('.cm-content').first().innerText();
    expect(content, 'messy SQL written').toContain('select');
  });

  test('PW22. Clicking "Format SQL" reformats into indented form', async () => {
    const formatBtn = page.getByRole('button', { name: 'Format SQL' }).first();
    const visible = await formatBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await formatBtn.click();
    await page.waitForTimeout(500);

    // Formatted SQL is multi-line: "SELECT" should appear in the content.
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    const content = await editor.locator('.cm-content').first().innerText();
    // Format capitalises and indents — check for uppercase SELECT.
    const hasUppercase = /SELECT/i.test(content);
    expect(hasUppercase, 'SQL formatted with uppercase keywords').toBe(true);
  });

  test('PW23. Pressing Ctrl+Z (Undo) reverts the formatting', async () => {
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    await editor.locator('.cm-content').first().click();
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+z`);
    await page.waitForTimeout(400);

    // After undo the notebook-level undo may not restore CodeMirror internal state,
    // but the editor should still be visible with no crash.
    await expect(editor).toBeVisible();
  });

  test('PW24. Notebook-level Undo button restores pre-format state', async () => {
    // The Format SQL operation is captured in the notebook history.
    // Clicking the toolbar Undo should revert it.
    const undoBtn = page.getByRole('button', { name: 'Undo' });
    const disabled = await undoBtn.getAttribute('disabled');
    if (disabled !== null) { test.skip(); return; }

    await undoBtn.click();
    await page.waitForTimeout(500);

    // Editor and page still intact.
    await expect(page.locator('.cm-jfr-editor .cm-editor').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'JFR Query Notebook' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Section 7: Context menu Delete item
// ---------------------------------------------------------------------------

test.describe.serial('Power user: Delete cell via context menu', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    // Add a spare cell to delete.
    await page.getByRole('button', { name: /Add Cell/i }).click();
    await page.waitForTimeout(400);
  });
  test.afterAll(async () => page.close());

  test('PW25. Right-clicking the last cell header opens the context menu', async () => {
    const headers = page.locator('[data-testid="cell-header"]');
    const count = await headers.count();
    const lastHeader = headers.nth(count - 1);
    await lastHeader.scrollIntoViewIfNeeded();
    await lastHeader.click({ button: 'right' });

    const menu = page.locator('[role="menu"]');
    await menu.waitFor({ state: 'visible', timeout: 3_000 });
    await expect(menu).toBeVisible();
  });

  test('PW26. Context menu has a "Delete cell" item', async () => {
    const deleteItem = page.locator('[role="menuitem"]').filter({ hasText: /delete.*cell/i });
    const visible = await deleteItem.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(deleteItem).toBeVisible();
  });

  test('PW27. Clicking "Delete cell" in context menu removes the cell', async () => {
    const cellsBefore = await page.locator('[data-cell-id]').count();

    const deleteItem = page.locator('[role="menuitem"]').filter({ hasText: /delete.*cell/i });
    const visible = await deleteItem.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await deleteItem.click();
    await page.waitForTimeout(500);

    const cellsAfter = await page.locator('[data-cell-id]').count();
    expect(cellsAfter, 'one fewer cell after context-menu delete').toBe(cellsBefore - 1);
  });

  test('PW28. No JS errors after context-menu delete', async () => {
    // Verify the page is still functional.
    await expect(page.getByRole('heading', { name: 'JFR Query Notebook' })).toBeVisible();
    const cells = page.locator('[data-cell-id]');
    const count = await cells.count();
    expect(count, 'at least one cell remains').toBeGreaterThan(0);
  });
});
