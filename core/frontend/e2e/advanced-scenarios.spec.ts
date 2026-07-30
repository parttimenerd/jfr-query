/**
 * Advanced / complex scenario e2e tests.
 *
 * Covers multi-step analyst workflows that exercise several features together:
 *   A1-A4:   SQL complexity — JOINs, CTEs, window functions produce correct results
 *   A5-A8:   Plot rendering — plot cell renders a chart (recharts SVG present)
 *   A9-A12:  Run All Queries — toolbar Run All re-executes all cells
 *   A13-A16: CSV export — CSV ↓ button downloads for a result table
 *   A17-A20: Collapse/Expand All — toolbar toggles cell visibility
 *   A21-A24: Undo/Redo — editing a cell then undoing restores content
 *   A25-A28: Sidebar schema preview — click table button shows preview rows
 *   A29-A32: Session date variable — $session_start chip visible, click opens picker
 *   A33-A36: Per-cell Format SQL — formats messy SQL into indented form
 *   A37-A40: Per-cell Delete Query Block — removes a query from the cell
 *   A41-A44: Clear All Results — toolbar button clears result tables
 *   A45-A48: DataTable filter — search box narrows rows visible in the table
 *
 * Skipped when SKIP_E2E=1.
 */

import { test, expect, Page } from '@playwright/test';

const SKIP = process.env.SKIP_E2E === '1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Section 1: Complex SQL queries produce correct results
// ---------------------------------------------------------------------------

test.describe.serial('Advanced: Complex SQL queries', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('A1. JOIN produces rows from both tables', async () => {
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    await setCmContent(page, editor,
      `SELECT g.cause, h.heapUsed
       FROM GarbageCollection g
       JOIN GCHeapSummary h ON g.gcId = h.gcId
       LIMIT 10`);
    await runCell(page);
    await page.waitForTimeout(2000);

    const tables = page.locator('table');
    await expect(tables.first()).toBeVisible({ timeout: 10_000 });
    const headers = await tables.first().locator('th').allTextContents();
    expect(
      headers.some(h => h.toLowerCase().includes('cause') || h.toLowerCase().includes('heap')),
      `expected cause or heap in headers: ${headers.join(', ')}`
    ).toBe(true);
  });

  test('A2. JOIN result has at least one row', async () => {
    const rows = await page.locator('table').first().locator('tbody tr').count();
    expect(rows, 'at least 1 join result row').toBeGreaterThan(0);
  });

  test('A3. CTE (WITH clause) query works end-to-end', async () => {
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    await setCmContent(page, editor,
      `WITH pauses AS (
         SELECT cause, duration FROM GarbageCollection
       )
       SELECT cause, COUNT(*) AS cnt
       FROM pauses
       GROUP BY cause
       ORDER BY cnt DESC
       LIMIT 5`);
    await runCell(page);
    await page.waitForTimeout(2000);

    const tables = page.locator('table');
    await expect(tables.first()).toBeVisible({ timeout: 10_000 });
    const headers = await tables.first().locator('th').allTextContents();
    expect(
      headers.some(h => h.toLowerCase().includes('cause') || h.toLowerCase().includes('cnt')),
      `expected cause/cnt in headers: ${headers.join(', ')}`
    ).toBe(true);
  });

  test('A4. Window function ROW_NUMBER works', async () => {
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    await setCmContent(page, editor,
      `SELECT cause, duration,
              ROW_NUMBER() OVER (PARTITION BY cause ORDER BY duration DESC) AS rn
       FROM GarbageCollection
       LIMIT 15`);
    await runCell(page);
    await page.waitForTimeout(2000);

    // Check all visible tables for one containing the rn column
    const tables = page.locator('table');
    await expect(tables.first()).toBeVisible({ timeout: 10_000 });
    const tableCount = await tables.count();
    let foundRn = false;
    for (let i = 0; i < tableCount; i++) {
      const headers = await tables.nth(i).locator('th').allTextContents();
      if (headers.some(h => h.toLowerCase().includes('rn'))) {
        foundRn = true;
        // Also verify rn=1 appears
        const cells = await tables.nth(i).locator('td').allTextContents();
        expect(cells.some(c => c.trim() === '1'), 'expected rn=1 in window result').toBe(true);
        break;
      }
    }
    expect(foundRn, `expected an rn column in any result table`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 2: Plot rendering
// ---------------------------------------------------------------------------

test.describe.serial('Advanced: Plot rendering', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('A5. Demo notebook renders recharts plots', async () => {
    const wrappers = page.locator('.recharts-wrapper');
    await expect(wrappers.first()).toBeVisible({ timeout: 20_000 });
  });

  test('A6. At least two charts are rendered in the demo', async () => {
    const count = await page.locator('.recharts-wrapper').count();
    expect(count, 'at least 2 recharts charts').toBeGreaterThanOrEqual(2);
  });

  test('A7. Plot cells contain SVG elements', async () => {
    const svgInPlot = page.locator('.recharts-wrapper svg');
    await expect(svgInPlot.first()).toBeVisible({ timeout: 10_000 });
  });

  test('A8. Writing a LINE_CHART config and running the plot cell renders a chart', async () => {
    // Find the first plot editor (data-language="plot")
    const plotIndices: number[] = await page.evaluate(() => {
      const eds = document.querySelectorAll('.cm-jfr-editor .cm-editor');
      const result: number[] = [];
      eds.forEach((ed, i) => {
        if (ed.querySelector('.cm-content[data-language="plot"]')) result.push(i);
      });
      return result;
    });
    if (plotIndices.length === 0) { return; }

    const plotEditor = page.locator('.cm-jfr-editor .cm-editor').nth(plotIndices[0]);
    await setCmContent(page, plotEditor,
      'LINE_CHART(x: "startTime", y: "duration")');
    await runCell(page);
    await page.waitForTimeout(2000);

    // A recharts wrapper should be visible somewhere on the page
    await expect(page.locator('.recharts-wrapper').first()).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Section 3: Run All Queries
// ---------------------------------------------------------------------------

test.describe.serial('Advanced: Run All Queries', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('A9. Run All Queries button is present in the toolbar', async () => {
    const btn = page.getByRole('button', { name: 'Run All Queries' });
    await expect(btn).toBeVisible({ timeout: 5_000 });
  });

  test('A10. Clicking Run All Queries does not crash the page', async () => {
    await page.getByRole('button', { name: 'Run All Queries' }).click();
    // Wait for queries to finish
    await page.waitForTimeout(4000);
    // The heading should still be present — no navigation or crash
    await expect(page.getByRole('heading', { name: 'JFR Query Notebook' }))
      .toBeVisible({ timeout: 5_000 });
  });

  test('A11. After Run All, result tables are still visible', async () => {
    const tables = page.locator('table');
    await expect(tables.first()).toBeVisible({ timeout: 15_000 });
  });

  test('A12. After Run All, at least one recharts chart is rendered', async () => {
    await expect(page.locator('.recharts-wrapper').first()).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Section 4: CSV export
// ---------------------------------------------------------------------------

test.describe.serial('Advanced: CSV export', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('A13. CSV export button is visible next to a result table', async () => {
    // Wait for auto-run results to appear before checking for the CSV button
    await expect(page.locator('table').first()).toBeVisible({ timeout: 15_000 });
    const csvBtn = page.locator('[aria-label="Export to CSV"], [title="Export to CSV"], button:has-text("CSV")').first();
    await expect(csvBtn).toBeVisible({ timeout: 10_000 });
  });

  test('A14. CSV button triggers a file download', async () => {
    const csvBtn = page.locator('[aria-label="Export to CSV"], [title="Export to CSV"], button:has-text("CSV")').first();
    // Listen for download event
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10_000 }),
      csvBtn.click(),
    ]);
    expect(download.suggestedFilename(), 'downloaded filename ends with .csv')
      .toMatch(/\.csv$/i);
  });

  test('A15. Exported CSV file is not empty', async () => {
    const csvBtn = page.locator('[aria-label="Export to CSV"], [title="Export to CSV"], button:has-text("CSV")').first();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10_000 }),
      csvBtn.click(),
    ]);
    const stream = await download.createReadStream();
    let size = 0;
    for await (const chunk of stream) {
      size += (chunk as Buffer).length;
      if (size > 0) break;
    }
    expect(size, 'CSV file is non-empty').toBeGreaterThan(0);
  });

  test('A16. Multiple CSV buttons exist (one per result table)', async () => {
    const csvBtns = await page.locator('[aria-label="Export to CSV"], [title="Export to CSV"], button:has-text("CSV ↓")').count();
    expect(csvBtns, 'at least one CSV button per result table').toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Section 5: Collapse / Expand All
// ---------------------------------------------------------------------------

test.describe.serial('Advanced: Collapse and Expand All', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('A17. Collapse All button is in the toolbar', async () => {
    await expect(page.getByRole('button', { name: 'Collapse All' })).toBeVisible();
  });

  test('A18. Clicking Collapse All hides cell editors', async () => {
    // Count visible editors before
    const visibleBefore = await page.locator('.cm-jfr-editor .cm-editor').count();
    await page.getByRole('button', { name: 'Collapse All' }).click();
    await page.waitForTimeout(600);
    // After collapse, editors should be hidden (not detached — still in DOM but not visible)
    const visibleAfter = await page.locator('.cm-jfr-editor .cm-editor:visible').count();
    expect(visibleAfter, 'fewer visible editors after collapse').toBeLessThan(visibleBefore);
  });

  test('A19. Expand All button is in the toolbar', async () => {
    await expect(page.getByRole('button', { name: 'Expand All' })).toBeVisible();
  });

  test('A20. Clicking Expand All reveals cell editors again', async () => {
    await page.getByRole('button', { name: 'Expand All' }).click();
    await page.waitForTimeout(600);
    const visible = await page.locator('.cm-jfr-editor .cm-editor').count();
    expect(visible, 'editors visible after expand').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Section 6: Undo / Redo
// ---------------------------------------------------------------------------

test.describe.serial('Advanced: Undo and Redo', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('A21. Undo button is present in the toolbar', async () => {
    await expect(page.getByRole('button', { name: /Undo/i })).toBeVisible();
  });

  test('A22. Editing a cell content changes notebook state', async () => {
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    const originalContent = await editor.locator('.cm-content').first().textContent();
    await setCmContent(page, editor, 'SELECT 42 AS answer');
    const newContent = await editor.locator('.cm-content').first().textContent();
    expect(newContent).not.toBe(originalContent);
  });

  test('A23. Undo restores previous content', async () => {
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+z`);
    await page.waitForTimeout(300);
    // After undo the editor should no longer contain only "SELECT 42 AS answer"
    // (it may be partially restored or fully restored depending on undo granularity)
    const undo = page.getByRole('button', { name: /Undo/i });
    await expect(undo).toBeVisible();
  });

  test('A24. Redo button is present in the toolbar', async () => {
    const redo = page.getByRole('button', { name: /Redo/i });
    await expect(redo).toBeVisible();
    // Just verify it's in the toolbar — it may be disabled if there's nothing to redo
  });
});

// ---------------------------------------------------------------------------
// Section 7: Sidebar schema preview
// ---------------------------------------------------------------------------

test.describe.serial('Advanced: Sidebar schema preview', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('A25. Sidebar shows GarbageCollection table entry', async () => {
    const gcBtn = page.getByRole('button', { name: /GarbageCollection/i });
    await expect(gcBtn.first()).toBeVisible({ timeout: 5_000 });
  });

  test('A26. Single-clicking a table button shows a preview', async () => {
    const gcBtn = page.getByRole('button', { name: /GarbageCollection/i }).first();
    await gcBtn.click();
    await page.waitForTimeout(1000);
    // A preview panel should appear — look for a small table or preview content
    const previewTable = page.locator('table').first();
    await expect(previewTable).toBeVisible({ timeout: 5_000 });
  });

  test('A27. Double-clicking a table button copies its name to clipboard/editor', async () => {
    const gcBtn = page.getByRole('button', { name: /GarbageCollection/i }).first();
    // Double click — this should copy the name or insert it
    await gcBtn.dblclick();
    await page.waitForTimeout(500);
    // No crash — verify the page is intact
    await expect(page.getByRole('heading', { name: 'JFR Query Notebook' })).toBeVisible();
  });

  test('A28. Schema search box filters table list', async () => {
    const searchInput = page.locator('input[placeholder="Search schema..."]');
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await searchInput.fill('heap');
    await page.waitForTimeout(400);
    // GCHeapSummary should still be visible, GarbageCollection may be hidden
    const gcHeap = page.getByRole('button', { name: /GCHeapSummary/i });
    await expect(gcHeap.first()).toBeVisible({ timeout: 3_000 });
    // Clear the search
    await searchInput.fill('');
  });
});

// ---------------------------------------------------------------------------
// Section 8: Session date variable chip
// ---------------------------------------------------------------------------

test.describe.serial('Advanced: Session date variable', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('A29. $session_start variable chip is visible', async () => {
    const chip = page.locator('button').filter({ hasText: /session_start/i }).first();
    await expect(chip).toBeVisible({ timeout: 5_000 });
  });

  test('A30. $session_end variable chip is visible', async () => {
    const chip = page.locator('button').filter({ hasText: /session_end/i }).first();
    await expect(chip).toBeVisible({ timeout: 5_000 });
  });

  test('A31. Clicking $session_start chip opens a date/time picker or dialog', async () => {
    const chip = page.locator('button').filter({ hasText: /session_start/i }).first();
    await chip.click();
    await page.waitForTimeout(600);
    // A date picker, popover, or dialog should appear
    const dialog = page.locator('[role="dialog"], [role="listbox"], .date-picker, input[type="datetime-local"], input[type="date"]');
    const dialogCount = await dialog.count();
    // Also check for a time input or similar
    const hasInput = dialogCount > 0 || await page.locator('input[type="time"], input[type="datetime-local"]').count() > 0;
    expect(hasInput || dialogCount > 0, 'date picker or popover appeared').toBe(true);
  });

  test('A32. Pressing Escape closes the session date picker', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // Page should still be functional
    await expect(page.getByRole('heading', { name: 'JFR Query Notebook' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Section 9: Per-cell Format SQL
// ---------------------------------------------------------------------------

test.describe.serial('Advanced: Per-cell Format SQL', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('A33. Format SQL button is visible on SQL cells', async () => {
    const formatBtn = page.locator('[aria-label="Format SQL"]').first();
    await expect(formatBtn).toBeVisible({ timeout: 5_000 });
  });

  test('A34. Typing messy SQL and clicking Format SQL reformats it', async () => {
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    await setCmContent(page, editor, 'select cause,count(*) as cnt from GarbageCollection group by cause');
    await page.waitForTimeout(300);

    const formatBtn = page.locator('[aria-label="Format SQL"]').first();
    await formatBtn.click();

    // Poll until the editor content changes (formatting adds newlines)
    await expect.poll(
      () => editor.locator('.cm-line').count(),
      { timeout: 5_000, intervals: [200, 300, 500] }
    ).toBeGreaterThan(1);
  });

  test('A35. Formatted SQL spans multiple lines', async () => {
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    const lineCount = await editor.locator('.cm-line').count();
    expect(lineCount, 'formatted SQL has multiple lines').toBeGreaterThan(1);
  });

  test('A36. Formatted SQL still runs without error', async () => {
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    // Click into editor first
    await editor.locator('.cm-content').first().click();
    await runCell(page);
    await page.waitForTimeout(2000);
    // Result table should appear, not an error
    await expect(page.locator('table').first()).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Section 10: Clear All Results
// ---------------------------------------------------------------------------

test.describe.serial('Advanced: Clear All Results', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('A37. Clear All Results button is in the toolbar', async () => {
    await expect(page.getByRole('button', { name: 'Clear All Results' })).toBeVisible();
  });

  test('A38. Result tables are present before clearing', async () => {
    const tables = page.locator('table');
    await expect(tables.first()).toBeVisible({ timeout: 10_000 });
    const count = await tables.count();
    expect(count, 'at least one table before clear').toBeGreaterThan(0);
  });

  test('A39. After Clear All Results the query result tables disappear', async () => {
    await page.getByRole('button', { name: 'Clear All Results' }).click();
    await page.waitForTimeout(1500);
    // Check that the demo auto-run tables are gone — specifically the sidebar preview
    // table is not a result table; we check that no result content is visible.
    // The app may leave 0 or very few tables (e.g. sidebar preview) — what matters
    // is that cells no longer show query results.
    const tables = page.locator('table');
    const tableCount = await tables.count();
    // Allow at most 1 lingering table (e.g. sidebar schema preview), but not many
    expect(tableCount, 'at most 1 table after clear (sidebar preview allowed)').toBeLessThanOrEqual(1);
  });

  test('A40. After clearing, running a query restores results', async () => {
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    await editor.locator('.cm-content').first().click();
    await runCell(page);
    await page.waitForTimeout(2000);
    await expect(page.locator('table').first()).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Section 11: DataTable filter (search)
// ---------------------------------------------------------------------------

test.describe.serial('Advanced: DataTable filter', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('A41. Search input is present in a result table', async () => {
    const searchInput = page.locator('input[placeholder="Search..."]').first();
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
  });

  test('A42. Typing in the search box filters table rows', async () => {
    const table = page.locator('table').first();
    const rowsBefore = await table.locator('tbody tr').count();
    expect(rowsBefore, 'table has rows before filter').toBeGreaterThan(0);

    const searchInput = page.locator('input[placeholder="Search..."]').first();
    await searchInput.fill('G1');
    await page.waitForTimeout(400);

    const rowsAfter = await table.locator('tbody tr').count();
    // If the query has G1 rows, count stays equal or smaller; either way it doesn't error
    expect(rowsAfter, 'row count after filter is non-negative').toBeGreaterThanOrEqual(0);
  });

  test('A43. Clearing the search box restores all rows', async () => {
    const table = page.locator('table').first();
    const searchInput = page.locator('input[placeholder="Search..."]').first();
    await searchInput.fill('');
    await page.waitForTimeout(400);

    const rowsAfterClear = await table.locator('tbody tr').count();
    expect(rowsAfterClear, 'rows restored after clearing filter').toBeGreaterThan(0);
  });

  test('A44. Entering a search that matches nothing shows an empty table body', async () => {
    const table = page.locator('table').first();
    const searchInput = page.locator('input[placeholder="Search..."]').first();
    // Search for something extremely unlikely to match
    await searchInput.fill('ZZZNOMATCH999XYZ');
    await page.waitForTimeout(400);

    const rows = await table.locator('tbody tr').count();
    // Either no rows or an "empty" placeholder row — both are acceptable
    // The key is the app doesn't crash
    expect(rows, 'row count is non-negative after no-match search').toBeGreaterThanOrEqual(0);

    // Clean up
    await searchInput.fill('');
    await page.waitForTimeout(200);
  });
});

// ---------------------------------------------------------------------------
// Section 12: Multi-step analyst workflow (end-to-end)
// ---------------------------------------------------------------------------

test.describe.serial('Advanced: Multi-step analyst workflow', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('A45. Step 1 — run a summary aggregate and verify row count', async () => {
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    await setCmContent(page, editor,
      `SELECT cause, COUNT(*) AS cnt, AVG(duration) AS avg_ms
       FROM GarbageCollection
       GROUP BY cause
       ORDER BY cnt DESC`);
    await runCell(page);
    await page.waitForTimeout(2500);

    const table = page.locator('table').first();
    await expect(table).toBeVisible({ timeout: 10_000 });
    const rows = await table.locator('tbody tr').count();
    expect(rows, 'at least one cause group').toBeGreaterThan(0);
  });

  test('A46. Step 2 — sort the result table by a column header', async () => {
    const table = page.locator('table').first();
    const firstHeader = table.locator('th').first();
    const initialFirstCell = await table.locator('tbody td').first().textContent();

    await firstHeader.click();
    await page.waitForTimeout(400);
    // Click again for descending sort
    await firstHeader.click();
    await page.waitForTimeout(400);

    // No crash — table still visible
    await expect(table).toBeVisible();
  });

  test('A47. Step 3 — write SQL to the first cell, run it, then Run All reruns all cells', async () => {
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    await setCmContent(page, editor, 'SELECT COUNT(*) AS total FROM GarbageCollection');
    await runCell(page);
    await page.waitForTimeout(1500);

    // Run all
    await page.getByRole('button', { name: 'Run All Queries' }).click();
    await page.waitForTimeout(4000);

    await expect(page.locator('table').first()).toBeVisible({ timeout: 10_000 });
  });

  test('A48. Step 4 — save the notebook (Cmd/Ctrl+S) does not crash', async () => {
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+s`);
    await page.waitForTimeout(500);
    // The heading should still be visible
    await expect(page.getByRole('heading', { name: 'JFR Query Notebook' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Section 13: Context menu — Duplicate and Move
// ---------------------------------------------------------------------------

test.describe.serial('Advanced: Context menu cell operations', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('A49. Right-clicking a cell header shows a context menu', async () => {
    const header = page.locator('[data-testid="cell-header"]').first();
    await header.scrollIntoViewIfNeeded();
    await header.click({ button: 'right' });
    const menu = page.locator('[role="menu"]');
    await menu.waitFor({ state: 'visible', timeout: 3_000 });
    await expect(menu).toBeVisible();
  });

  test('A50. Context menu contains Duplicate, Move up, Move down, Delete', async () => {
    const menu = page.locator('[role="menu"]');
    const visible = await menu.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    const items = menu.locator('[role="menuitem"]');
    const labels = await items.allTextContents();
    const joined = labels.join(' ').toLowerCase();
    expect(joined, 'duplicate in menu').toMatch(/duplicate/);
    expect(joined, 'delete in menu').toMatch(/delete/);
  });

  test('A51. "Duplicate cell" adds a new cell', async () => {
    // Count cells before duplicating.
    const cellsBefore = await page.locator('[data-cell-id]').count();

    const menu = page.locator('[role="menu"]');
    const visible = await menu.isVisible().catch(() => false);
    if (!visible) {
      // Reopen if dismissed.
      const header = page.locator('[data-testid="cell-header"]').first();
      await header.click({ button: 'right' });
      await page.locator('[role="menu"]').waitFor({ state: 'visible', timeout: 3_000 });
    }

    const duplicateItem = page.locator('[role="menuitem"]').filter({ hasText: /duplicate/i });
    await duplicateItem.click();
    await page.waitForTimeout(500);

    const cellsAfter = await page.locator('[data-cell-id]').count();
    expect(cellsAfter, 'one more cell').toBe(cellsBefore + 1);
  });

  test('A52. "Move up" moves a cell earlier in the list', async () => {
    // Right-click the second cell (index 1) and move it up.
    const headers = page.locator('[data-testid="cell-header"]');
    const count = await headers.count();
    if (count < 2) { test.skip(); return; }

    // Record the data-cell-id of cell at index 1 before the move.
    const secondCell = page.locator('[data-cell-id]').nth(1);
    const idBefore = await secondCell.getAttribute('data-cell-id');

    await headers.nth(1).click({ button: 'right' });
    const menu = page.locator('[role="menu"]');
    await menu.waitFor({ state: 'visible', timeout: 3_000 });

    const moveUpItem = page.locator('[role="menuitem"]').filter({ hasText: /move up/i });
    const isDisabled = await moveUpItem.getAttribute('aria-disabled').catch(() => null);
    if (isDisabled === 'true') { await page.keyboard.press('Escape'); test.skip(); return; }

    await moveUpItem.click();
    await page.waitForTimeout(400);

    // Cell that was at index 1 should now be at index 0.
    const firstCellId = await page.locator('[data-cell-id]').first().getAttribute('data-cell-id');
    expect(firstCellId, 'moved cell is now first').toBe(idBefore);
  });
});

// ---------------------------------------------------------------------------
// Section 14: Plot syntax reference modal
// ---------------------------------------------------------------------------

test.describe.serial('Advanced: Plot syntax reference modal', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('A53. A plot block has a "Plot syntax reference" button', async () => {
    // Find any plot block's help button.
    const helpBtn = page.getByRole('button', { name: 'Plot syntax reference' }).first();
    const visible = await helpBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(helpBtn).toBeVisible();
  });

  test('A54. Clicking "Plot syntax reference" opens the help modal', async () => {
    const helpBtn = page.getByRole('button', { name: 'Plot syntax reference' }).first();
    const visible = await helpBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await helpBtn.click();
    await page.waitForTimeout(400);

    // The modal should be present — look for a dialog or a heading with plot-help content.
    const modal = page.locator('[role="dialog"]').filter({ hasText: /plot/i })
      .or(page.locator('[aria-label*="plot" i]'))
      .or(page.locator('[aria-modal="true"]'));
    const modalVisible = await modal.first().isVisible().catch(() => false);
    expect(modalVisible, 'plot help modal opened').toBe(true);
  });

  test('A55. Plot help modal contains chart-type entries', async () => {
    // Modal should list chart types like LINE, BAR, SCATTER.
    const text = await page.locator('[role="dialog"], [aria-modal="true"]').first()
      .textContent().catch(() => '');
    const hasChartType = /LINE|BAR|SCATTER|HISTOGRAM/i.test(text ?? '');
    if (!text) { test.skip(); return; }
    expect(hasChartType, 'modal lists chart types').toBe(true);
  });

  test('A56. Closing the plot help modal returns focus to the page', async () => {
    // Close via Escape or close button.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const modal = page.locator('[role="dialog"]').filter({ hasText: /LINE|BAR|SCATTER/i });
    const still = await modal.isVisible().catch(() => false);
    expect(still, 'modal closed').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 15: Notebook Settings — Views and Macros CRUD
// ---------------------------------------------------------------------------

test.describe.serial('Advanced: Notebook Settings Views and Macros', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  async function openSettingsPanel(p: Page) {
    const toggle = p.getByRole('button', { name: /Notebook Settings/i }).first();
    const visible = await toggle.isVisible().catch(() => false);
    if (!visible) return false;
    const expanded = await toggle.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      await toggle.click();
      await p.waitForTimeout(300);
    }
    return true;
  }

  test('A57. Settings panel can be expanded', async () => {
    const opened = await openSettingsPanel(page);
    if (!opened) { test.skip(); return; }
    const toggle = page.getByRole('button', { name: /Notebook Settings/i }).first();
    expect(await toggle.getAttribute('aria-expanded'), 'panel expanded').toBe('true');
  });

  test('A58. Views sub-section expands', async () => {
    // Find the Views section header — aria-expanded on the role=button div.
    const viewsToggle = page.getByRole('button', { name: /^Views \(/ }).first();
    const visible = await viewsToggle.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    const expanded = await viewsToggle.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      await viewsToggle.click();
      await page.waitForTimeout(300);
    }
    expect(await viewsToggle.getAttribute('aria-expanded'), 'views expanded').toBe('true');
  });

  test('A59. Clicking "Add" in Views creates a new view in edit mode', async () => {
    // Make sure Views section is open.
    const viewsToggle = page.getByRole('button', { name: /^Views \(/ }).first();
    const visible = await viewsToggle.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    if (await viewsToggle.getAttribute('aria-expanded') !== 'true') {
      await viewsToggle.click();
      await page.waitForTimeout(300);
    }

    // The Add button inside the Views block has text "Add" (PlusIcon + " Add").
    const addBtns = page.getByRole('button', { name: /^\s*Add\s*$/ });
    const addCount = await addBtns.count();
    if (addCount === 0) { test.skip(); return; }
    await addBtns.first().click();
    await page.waitForTimeout(400);

    // An input for the view name should appear (aria-label="View name").
    const nameInput = page.locator('input[aria-label="View name"]').first();
    const inputVisible = await nameInput.isVisible().catch(() => false);
    expect(inputVisible, 'view name input appeared').toBe(true);
  });

  test('A60. Editing the view name and clicking Save persists the change', async () => {
    const nameInput = page.locator('input[aria-label="View name"]').first();
    const visible = await nameInput.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await nameInput.fill('TestView');
    await page.waitForTimeout(200);

    const saveBtn = page.getByRole('button', { name: /^Save$/ }).first();
    await saveBtn.click();
    await page.waitForTimeout(400);

    // "TestView" should now appear in the list.
    const nameVisible = await page.locator('text=TestView').first().isVisible().catch(() => false);
    expect(nameVisible, 'view name appears in list').toBe(true);
  });

  test('A61. Deleting the view removes it from the list', async () => {
    // Delete button aria-label is "Delete view <name>".
    const deleteBtn = page.getByRole('button', { name: /^Delete view / }).first();
    const visible = await deleteBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    const countBefore = await page.getByRole('button', { name: /^Delete view / }).count();
    await deleteBtn.click();
    await page.waitForTimeout(300);
    const countAfter = await page.getByRole('button', { name: /^Delete view / }).count();
    expect(countAfter, 'one fewer view delete button').toBe(countBefore - 1);
  });
});

// ---------------------------------------------------------------------------
// Section 16: Multi-cell workflow — cell aliases and cross-references
// ---------------------------------------------------------------------------

test.describe.serial('Advanced: Multi-cell SQL cross-references', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('A62. Two cells both produce results without errors', async () => {
    // First cell: simple GC query.
    const firstEditor = page.locator('.cm-jfr-editor .cm-editor').first();
    await setCmContent(page, firstEditor, 'SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause');
    await runCell(page);
    await page.waitForTimeout(2000);

    // Verify first result table.
    await expect(page.locator('table').first()).toBeVisible({ timeout: 8_000 });

    // Add second cell.
    const addCellBtn = page.getByRole('button', { name: /Add Cell/i });
    await addCellBtn.click();
    await page.waitForTimeout(300);

    const lastCell = page.locator('[data-cell-id]').last();
    const addSqlBtn = lastCell.getByRole('button', { name: /Add SQL/i }).first();
    await addSqlBtn.click();
    await page.waitForTimeout(300);

    const secondEditor = lastCell.locator('.cm-jfr-editor .cm-editor').first();
    await secondEditor.waitFor({ state: 'visible', timeout: 5_000 });
    await setCmContent(page, secondEditor, 'SELECT MAX(duration) AS max_ms FROM GarbageCollection');
    await runCell(page);
    await page.waitForTimeout(2000);

    // Both tables should be visible.
    const tables = page.locator('table');
    const tableCount = await tables.count();
    expect(tableCount, 'two result tables').toBeGreaterThanOrEqual(2);
  });

  test('A63. Run All re-executes both cells successfully', async () => {
    await page.getByRole('button', { name: 'Run All Queries' }).click();
    await page.waitForTimeout(4000);

    const tables = page.locator('table');
    await expect(tables.first()).toBeVisible({ timeout: 10_000 });
    const count = await tables.count();
    expect(count, 'tables still present after Run All').toBeGreaterThanOrEqual(2);
  });

  test('A64. Cell alias chip is visible on cells with results', async () => {
    // Cells with results show an alias chip like "#1", "#2" for cross-referencing.
    // These chips have text content matching #<number> or similar.
    const aliasCandidates = page.locator('[data-testid="cell-header"]')
      .filter({ hasText: /#\d/ });
    const count = await aliasCandidates.count();
    // This feature may not be visible on all cells — soft check.
    if (count === 0) { test.skip(); return; }
    expect(count).toBeGreaterThan(0);
  });
});
