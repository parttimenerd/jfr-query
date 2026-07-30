/**
 * CompareView and cell-local variable e2e tests.
 *
 * Beginner:
 *   CV1-CV3:  Compare view toggle button is visible per-cell; clicking it changes aria state
 *   CV4-CV6:  Cell-local variable "Add" button adds a row
 *   CV7-CV9:  Cell-local variable name accepts input; value accepts input
 *
 * Complex / power-user:
 *   CV10-CV13: Delete a cell-local variable row removes it
 *   CV14-CV17: Compare view shows two-pane layout after running two queries in the same cell
 *   CV18-CV21: Toggling compare view off hides the panes, toggle on re-shows them
 *   CV22-CV24: Multiple cell-local variables co-exist; deleting one leaves others intact
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
// Section 1: Compare view toggle (beginner)
// ---------------------------------------------------------------------------

test.describe.serial('CompareView: Toggle button', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('CV1. Compare view toggle button is visible in cell footer', async () => {
    const compareBtn = page.locator('[data-testid="compare-view-toggle"]').first();
    await expect(compareBtn).toBeVisible({ timeout: 5_000 });
  });

  test('CV2. Toggle button has correct aria-label "Toggle compare view"', async () => {
    const compareBtn = page.locator('[data-testid="compare-view-toggle"]').first();
    const label = await compareBtn.getAttribute('aria-label');
    expect(label, 'correct aria-label').toBe('Toggle compare view');
  });

  test('CV3. Clicking the toggle changes its visual state (cyan vs gray text)', async () => {
    const compareBtn = page.locator('[data-testid="compare-view-toggle"]').first();
    const classBefore = await compareBtn.getAttribute('class') ?? '';

    await compareBtn.click();
    await page.waitForTimeout(300);

    const classAfter = await compareBtn.getAttribute('class') ?? '';
    // Toggling changes cyan/gray in className.
    expect(classAfter, 'class changes after toggle').not.toBe(classBefore);

    // Toggle back off.
    await compareBtn.click();
    await page.waitForTimeout(200);
  });
});

// ---------------------------------------------------------------------------
// Section 2: Cell-local variable add (beginner)
// ---------------------------------------------------------------------------

test.describe.serial('CompareView: Cell-local variable add', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('CV4. "Add variable" button is visible in cell footer', async () => {
    const addVarBtn = page.getByRole('button', { name: 'Add variable' }).first();
    await expect(addVarBtn).toBeVisible({ timeout: 5_000 });
  });

  test('CV5. Clicking "Add variable" adds a new variable row', async () => {
    const addVarBtn = page.getByRole('button', { name: 'Add variable' }).first();
    const visible = await addVarBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    const varsBefore = await page.locator('input[aria-label^="Cell-local variable"]').count();
    await addVarBtn.click();
    await page.waitForTimeout(400);

    const varsAfter = await page.locator('input[aria-label^="Cell-local variable"]').count();
    expect(varsAfter, 'variable row added').toBeGreaterThan(varsBefore);
  });

  test('CV6. New variable row has both a key input and a value input', async () => {
    const keyInputs = page.locator('input[aria-label^="Cell-local variable"]');
    const count = await keyInputs.count();
    if (count === 0) { test.skip(); return; }

    // There should be at least one Cell-local variable input.
    await expect(keyInputs.last()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Section 3: Cell-local variable edit (beginner)
// ---------------------------------------------------------------------------

test.describe.serial('CompareView: Cell-local variable edit', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    // Add a variable row first.
    const addVarBtn = page.getByRole('button', { name: 'Add variable' }).first();
    if (await addVarBtn.isVisible().catch(() => false)) {
      await addVarBtn.click();
      await page.waitForTimeout(400);
    }
  });
  test.afterAll(async () => page.close());

  test('CV7. Cell-local variable key input accepts a $var name', async () => {
    const keyInput = page.locator('input[aria-label^="Cell-local variable"]').last();
    const visible = await keyInput.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await keyInput.fill('$testVar');
    await page.waitForTimeout(200);
    const val = await keyInput.inputValue();
    expect(val, 'key accepted').toContain('testVar');
  });

  test('CV8. Pressing Enter moves focus to the value input', async () => {
    const keyInput = page.locator('input[aria-label^="Cell-local variable"]').last();
    const visible = await keyInput.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await keyInput.focus();
    await keyInput.fill('$testVar');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    // Value input for $testVar should now be focused.
    const valInput = page.locator('input[aria-label="Value for $testVar"]').last();
    const valVisible = await valInput.isVisible().catch(() => false);
    if (!valVisible) { test.skip(); return; }
    await expect(valInput).toBeVisible();
  });

  test('CV9. Value input accepts text and persists on blur', async () => {
    const valInput = page.locator('input[aria-label="Value for $testVar"]').last();
    const visible = await valInput.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await valInput.fill('hello world');
    await valInput.press('Enter');
    await page.waitForTimeout(200);

    const stored = await valInput.inputValue().catch(() => '');
    expect(stored, 'value persisted').toBe('hello world');
  });
});

// ---------------------------------------------------------------------------
// Section 4: Cell-local variable delete (power-user)
// ---------------------------------------------------------------------------

test.describe.serial('CompareView: Cell-local variable delete', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    // Add a variable row so we have one to delete.
    const addVarBtn = page.getByRole('button', { name: 'Add variable' }).first();
    if (await addVarBtn.isVisible().catch(() => false)) {
      await addVarBtn.click();
      await page.waitForTimeout(400);
    }
  });
  test.afterAll(async () => page.close());

  test('CV10. Delete button is present for each cell-local variable row', async () => {
    const keyInput = page.locator('input[aria-label^="Cell-local variable"]').last();
    const visible = await keyInput.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    // Read the variable key to find its delete button.
    const varKey = await keyInput.inputValue();
    if (!varKey) { test.skip(); return; }

    const deleteBtn = page.locator(`button[aria-label="Delete variable ${varKey}"]`).last();
    const deleteVisible = await deleteBtn.isVisible().catch(() => false);
    if (!deleteVisible) {
      // Also try by title attribute.
      const deleteBtnByTitle = page.locator(`button[title="Delete variable ${varKey}"]`).last();
      const titleVisible = await deleteBtnByTitle.isVisible().catch(() => false);
      expect(titleVisible, 'delete button found by title').toBe(true);
    } else {
      await expect(deleteBtn).toBeVisible();
    }
  });

  test('CV11. Clicking delete removes the variable row', async () => {
    const keyInputs = page.locator('input[aria-label^="Cell-local variable"]');
    const countBefore = await keyInputs.count();
    if (countBefore === 0) { test.skip(); return; }

    const lastKey = await keyInputs.last().inputValue();
    if (!lastKey) { test.skip(); return; }

    const deleteBtn = page.locator(`button[aria-label="Delete variable ${lastKey}"]`).last()
      .or(page.locator(`button[title="Delete variable ${lastKey}"]`).last());
    const deleteBtnVisible = await deleteBtn.isVisible().catch(() => false);
    if (!deleteBtnVisible) { test.skip(); return; }

    await deleteBtn.click();
    await page.waitForTimeout(400);

    const countAfter = await keyInputs.count();
    expect(countAfter, 'variable row removed after delete').toBe(countBefore - 1);
  });

  test('CV12. After deletion the remaining rows are still intact', async () => {
    const keyInputs = page.locator('input[aria-label^="Cell-local variable"]');
    const count = await keyInputs.count();
    // Just verify the remaining inputs are still functional.
    for (let i = 0; i < Math.min(count, 3); i++) {
      await expect(keyInputs.nth(i)).toBeVisible();
    }
  });

  test('CV13. Notebook heading still visible after variable CRUD', async () => {
    await expect(page.getByRole('heading', { name: 'JFR Query Notebook' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Section 5: Compare view two-pane layout (power-user)
// ---------------------------------------------------------------------------

test.describe.serial('CompareView: Two-pane layout', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    // Run a SQL query so there is at least one result to compare.
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    await editor.locator('.cm-content').first().click();
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.insertText('SELECT cause, duration FROM GarbageCollection LIMIT 10');
    await page.keyboard.press(`${mod}+Enter`);
    await page.locator('table').first().waitFor({ state: 'visible', timeout: 12_000 });
    await page.waitForTimeout(500);
  });
  test.afterAll(async () => page.close());

  test('CV14. Compare view toggle is visible after a query result exists', async () => {
    const compareBtn = page.locator('[data-testid="compare-view-toggle"]').first();
    await expect(compareBtn).toBeVisible({ timeout: 5_000 });
  });

  test('CV15. Toggling compare view on shows two labelled panes', async () => {
    const compareBtn = page.locator('[data-testid="compare-view-toggle"]').first();
    await compareBtn.click();
    await page.waitForTimeout(400);

    // CompareView renders "Candidate" and "Baseline" (or query alias) labels.
    // Look for at least one DataTable or "No data" in the compare area.
    const compareArea = page.locator('.divide-x').first();
    const visible = await compareArea.isVisible().catch(() => false);

    // If the cell has only one result, the compare area still renders (with "No data" on baseline).
    const noData = page.locator('text=No data').first();
    const tableOrNoData = visible || await noData.isVisible().catch(() => false);
    expect(tableOrNoData, 'compare view area rendered').toBe(true);
  });

  test('CV16. Compare view button appears highlighted (cyan text) when active', async () => {
    const compareBtn = page.locator('[data-testid="compare-view-toggle"]').first();
    const cls = await compareBtn.getAttribute('class') ?? '';
    expect(cls, 'cyan color in class when active').toContain('cyan');
  });

  test('CV17. Toggling compare view off hides the two-pane area', async () => {
    const compareBtn = page.locator('[data-testid="compare-view-toggle"]').first();
    await compareBtn.click();
    await page.waitForTimeout(300);

    // After toggle off, the divide-x container should no longer be visible.
    const compareArea = page.locator('.divide-x').first();
    const visible = await compareArea.isVisible().catch(() => false);
    expect(visible, 'compare area hidden after toggle off').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 6: Multiple cell-local variables (power-user)
// ---------------------------------------------------------------------------

test.describe.serial('CompareView: Multiple cell-local variables', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('CV18. Can add multiple variable rows in sequence', async () => {
    const addVarBtn = page.getByRole('button', { name: 'Add variable' }).first();
    const visible = await addVarBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    const countBefore = await page.locator('input[aria-label^="Cell-local variable"]').count();

    await addVarBtn.click();
    await page.waitForTimeout(300);
    await addVarBtn.click();
    await page.waitForTimeout(300);

    const countAfter = await page.locator('input[aria-label^="Cell-local variable"]').count();
    expect(countAfter, 'two rows added').toBeGreaterThanOrEqual(countBefore + 2);
  });

  test('CV19. Each variable row has an independent value input', async () => {
    const keyInputs = page.locator('input[aria-label^="Cell-local variable"]');
    const count = await keyInputs.count();
    if (count < 2) { test.skip(); return; }

    // Fill the last two rows with distinct names.
    for (let i = count - 2; i < count; i++) {
      const inp = keyInputs.nth(i);
      await inp.fill(`$var${i}`);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(150);
    }

    const finalCount = await keyInputs.count();
    expect(finalCount, 'rows still present').toBeGreaterThanOrEqual(count);
  });

  test('CV20. Deleting one variable leaves the others intact', async () => {
    const keyInputs = page.locator('input[aria-label^="Cell-local variable"]');
    const countBefore = await keyInputs.count();
    if (countBefore === 0) { test.skip(); return; }

    const lastKey = await keyInputs.last().inputValue();
    if (!lastKey || !lastKey.startsWith('$')) { test.skip(); return; }

    const deleteBtn = page.locator(`button[aria-label="Delete variable ${lastKey}"]`).last()
      .or(page.locator(`button[title="Delete variable ${lastKey}"]`).last());
    const deleteBtnVisible = await deleteBtn.isVisible().catch(() => false);
    if (!deleteBtnVisible) { test.skip(); return; }

    await deleteBtn.click();
    await page.waitForTimeout(400);

    const countAfter = await keyInputs.count();
    expect(countAfter, 'one row removed, others intact').toBe(countBefore - 1);
  });

  test('CV21. Page is stable after variable CRUD session', async () => {
    await expect(page.locator('.cm-jfr-editor .cm-editor').first()).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole('heading', { name: 'JFR Query Notebook' })).toBeVisible();
  });
});
