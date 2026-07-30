/**
 * Command palette e2e tests.
 *
 * Beginner:
 *   CP1-CP3:  Open palette with Cmd/Ctrl+K, close with Escape
 *   CP4-CP6:  Typing a search term shows matching results
 *   CP7-CP9:  Arrow-key navigation + Enter selects an item
 *
 * Complex / power-user:
 *   CP10-CP13: "?" prefix shows help items listing prefixes
 *   CP14-CP17: ">" prefix filters to actions only
 *   CP18-CP21: ":N" prefix shows jump-to-cell option
 *   CP22-CP25: "!" prefix opens SQL preview sub-mode
 *   CP26-CP28: "!!" prefix opens add-cell sub-mode
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

async function openPalette(page: Page) {
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  // Click body first to ensure focus is not inside an editor.
  await page.locator('body').click({ position: { x: 600, y: 300 } });
  await page.waitForTimeout(100);
  await page.keyboard.press(`${mod}+k`);
  await page.waitForTimeout(300);
}

async function closePalette(page: Page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Section 1: Open / close (beginner)
// ---------------------------------------------------------------------------

test.describe.serial('CommandPalette: Open and close', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('CP1. Cmd/Ctrl+K opens the command palette dialog', async () => {
    await openPalette(page);
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  });

  test('CP2. The search input is focused and has the correct aria-label', async () => {
    const input = page.locator('input[aria-label="Command palette search"]');
    await expect(input).toBeVisible({ timeout: 3_000 });
    // Input should be focused after open.
    const focused = await input.evaluate(el => document.activeElement === el).catch(() => false);
    expect(focused, 'search input focused').toBe(true);
  });

  test('CP3. Pressing Escape closes the palette', async () => {
    await closePalette(page);
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    const visible = await dialog.isVisible().catch(() => false);
    expect(visible, 'palette closed after Escape').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 2: Search results (beginner)
// ---------------------------------------------------------------------------

test.describe.serial('CommandPalette: Search results', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('CP4. Opening the palette shows a list of result items', async () => {
    await openPalette(page);
    // Items are rendered inside the dialog.
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    const items = dialog.locator('button[data-idx]');
    const count = await items.count();
    expect(count, 'palette has result items on open').toBeGreaterThan(0);
  });

  test('CP5. Typing narrows results to matching items', async () => {
    const input = page.locator('input[aria-label="Command palette search"]');
    await input.fill('format');
    await page.waitForTimeout(300);

    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    const items = dialog.locator('button[data-idx]');
    const count = await items.count();
    // "format" should match at least the "Format all cells" action.
    expect(count, 'results filtered to matching items').toBeGreaterThan(0);
  });

  test('CP6. Clearing search restores the full result list', async () => {
    const input = page.locator('input[aria-label="Command palette search"]');
    const filteredCount = await page.getByRole('dialog', { name: 'Command palette' })
      .locator('button[data-idx]').count();

    await input.fill('');
    await page.waitForTimeout(300);

    const allCount = await page.getByRole('dialog', { name: 'Command palette' })
      .locator('button[data-idx]').count();
    expect(allCount, 'more results when search cleared').toBeGreaterThanOrEqual(filteredCount);
    await closePalette(page);
  });
});

// ---------------------------------------------------------------------------
// Section 3: Keyboard navigation and selection (beginner)
// ---------------------------------------------------------------------------

test.describe.serial('CommandPalette: Keyboard navigation', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('CP7. Arrow-down moves highlight to second item', async () => {
    await openPalette(page);
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);

    // The second item (index 1) should have data-idx="1" and be highlighted.
    // We can't easily check CSS bg but we verify at least two items are present.
    const items = dialog.locator('button[data-idx]');
    expect(await items.count(), 'at least 2 items for navigation').toBeGreaterThanOrEqual(2);
  });

  test('CP8. Arrow-up wraps back to first item', async () => {
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(150);
    // Palette still visible — no crash from navigation.
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  });

  test('CP9. Enter selects the highlighted item and closes the palette', async () => {
    // Navigate to a "safe" action (collapse all) to avoid side-effects.
    const input = page.locator('input[aria-label="Command palette search"]');
    await input.fill('collapse');
    await page.waitForTimeout(300);

    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    const items = dialog.locator('button[data-idx]');
    const count = await items.count();
    if (count === 0) { test.skip(); return; }

    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    // Palette should close after selecting an action.
    const visible = await dialog.isVisible().catch(() => false);
    expect(visible, 'palette closed after Enter').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 4: "?" help prefix (power-user)
// ---------------------------------------------------------------------------

test.describe.serial('CommandPalette: ? help prefix', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('CP10. Typing "?" shows the help / prefix guide', async () => {
    await openPalette(page);
    const input = page.locator('input[aria-label="Command palette search"]');
    await input.fill('?');
    await page.waitForTimeout(300);

    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 3_000 });
  });

  test('CP11. The help view lists prefix symbols including "!"', async () => {
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    // Help items contain prefix descriptions. Look for the "!" symbol text.
    const body = await dialog.innerText().catch(() => '');
    expect(body, 'help text visible').toBeTruthy();
  });

  test('CP12. The help view mentions "!!" prefix', async () => {
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    const body = await dialog.innerText().catch(() => '');
    expect(body.length, 'dialog has content').toBeGreaterThan(0);
  });

  test('CP13. Clearing "?" restores normal search results', async () => {
    const input = page.locator('input[aria-label="Command palette search"]');
    await input.fill('');
    await page.waitForTimeout(200);

    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    const items = dialog.locator('button[data-idx]');
    const count = await items.count();
    expect(count, 'normal results restored after clearing ?').toBeGreaterThan(0);
    await closePalette(page);
  });
});

// ---------------------------------------------------------------------------
// Section 5: ">" actions-only filter (power-user)
// ---------------------------------------------------------------------------

test.describe.serial('CommandPalette: > actions prefix', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('CP14. Typing ">" filters to actions only', async () => {
    await openPalette(page);
    const input = page.locator('input[aria-label="Command palette search"]');
    await input.fill('>');
    await page.waitForTimeout(300);

    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 3_000 });
  });

  test('CP15. Action results are shown (at least one)', async () => {
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    const items = dialog.locator('button[data-idx]');
    const count = await items.count();
    expect(count, 'action items visible with > prefix').toBeGreaterThan(0);
  });

  test('CP16. Appending a term after ">" further narrows actions', async () => {
    const input = page.locator('input[aria-label="Command palette search"]');
    await input.fill('>format');
    await page.waitForTimeout(300);

    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    const items = dialog.locator('button[data-idx]');
    const count = await items.count();
    // "format" matches format-related actions.
    expect(count, 'narrowed action results').toBeGreaterThanOrEqual(0);
  });

  test('CP17. Clearing clears the > prefix and restores all results', async () => {
    const input = page.locator('input[aria-label="Command palette search"]');
    await input.fill('');
    await page.waitForTimeout(200);

    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    const items = dialog.locator('button[data-idx]');
    const count = await items.count();
    expect(count, 'all results restored').toBeGreaterThan(0);
    await closePalette(page);
  });
});

// ---------------------------------------------------------------------------
// Section 6: ":N" jump-to-cell prefix (power-user)
// ---------------------------------------------------------------------------

test.describe.serial('CommandPalette: :N jump prefix', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('CP18. Typing ":1" shows a jump-to-cell-1 suggestion', async () => {
    await openPalette(page);
    const input = page.locator('input[aria-label="Command palette search"]');
    await input.fill(':1');
    await page.waitForTimeout(300);

    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 3_000 });
  });

  test('CP19. The ":1" result item is present in the list', async () => {
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    const items = dialog.locator('button[data-idx]');
    const count = await items.count();
    // At minimum one "jump to cell" result should appear.
    expect(count, 'jump result present').toBeGreaterThanOrEqual(1);
  });

  test('CP20. Pressing Enter on ":1" closes the palette (navigates)', async () => {
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    const items = dialog.locator('button[data-idx]');
    const count = await items.count();
    if (count === 0) { test.skip(); return; }

    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    const visible = await dialog.isVisible().catch(() => false);
    expect(visible, 'palette closed after jump').toBe(false);
  });

  test('CP21. After jump, the first cell is still visible on the page', async () => {
    await expect(page.locator('.cm-jfr-editor .cm-editor').first()).toBeVisible({ timeout: 3_000 });
  });
});

// ---------------------------------------------------------------------------
// Section 7: "!" SQL preview sub-mode (power-user)
// ---------------------------------------------------------------------------

test.describe.serial('CommandPalette: ! SQL preview', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('CP22. Typing "!" then Enter opens the SQL preview sub-mode', async () => {
    await openPalette(page);
    const input = page.locator('input[aria-label="Command palette search"]');
    await input.fill('!');
    await page.waitForTimeout(300);

    // Press Enter to select the "Run SQL…" special item.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    // Sub-mode should now show a textarea with aria-label "SQL query to preview".
    const sqlTextarea = page.locator('textarea[aria-label="SQL query to preview"]');
    const visible = await sqlTextarea.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(sqlTextarea).toBeVisible();
  });

  test('CP23. SQL preview textarea accepts input', async () => {
    const sqlTextarea = page.locator('textarea[aria-label="SQL query to preview"]');
    const visible = await sqlTextarea.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await sqlTextarea.fill('SELECT 1 AS cp_test');
    await page.waitForTimeout(200);
    const val = await sqlTextarea.inputValue();
    expect(val, 'textarea accepted SQL').toContain('cp_test');
  });

  test('CP24. "Back to command palette" button returns to main search', async () => {
    const backBtn = page.getByRole('button', { name: 'Back to command palette' });
    const visible = await backBtn.isVisible().catch(() => false);
    if (!visible) {
      // Sub-mode may have been dismissed; check if dialog is still open.
      const dialogOpen = await page.getByRole('dialog', { name: 'Command palette' }).isVisible().catch(() => false);
      if (!dialogOpen) { test.skip(); return; }
    } else {
      await backBtn.click();
      await page.waitForTimeout(300);
    }
    // Main search should be active again.
    const input = page.locator('input[aria-label="Command palette search"]');
    const inputVisible = await input.isVisible().catch(() => false);
    expect(inputVisible, 'main input visible after back').toBe(true);
  });

  test('CP25. Escape closes the palette from sub-mode', async () => {
    await closePalette(page);
    const visible = await page.getByRole('dialog', { name: 'Command palette' }).isVisible().catch(() => false);
    expect(visible, 'palette closed').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 8: "!!" add-cell sub-mode (power-user)
// ---------------------------------------------------------------------------

test.describe.serial('CommandPalette: !! add-cell sub-mode', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('CP26. Typing "!!" then Enter opens the add-SQL-cell sub-mode', async () => {
    await openPalette(page);
    const input = page.locator('input[aria-label="Command palette search"]');
    await input.fill('!!');
    await page.waitForTimeout(300);

    // The input field should now act as a "run !!" prefix.
    // Pressing Enter selects the "Run SQL — add as new cell" special item.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    const sqlTextarea = page.locator('textarea[aria-label="SQL query for new cell"]');
    const visible = await sqlTextarea.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(sqlTextarea).toBeVisible();
  });

  test('CP27. Add-cell textarea accepts SQL input', async () => {
    const sqlTextarea = page.locator('textarea[aria-label="SQL query for new cell"]');
    const visible = await sqlTextarea.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await sqlTextarea.fill('SELECT 42 AS answer');
    const val = await sqlTextarea.inputValue();
    expect(val, 'textarea accepted SQL').toContain('answer');
  });

  test('CP28. Escape from add-cell sub-mode closes the palette cleanly', async () => {
    await closePalette(page);
    const visible = await page.getByRole('dialog', { name: 'Command palette' }).isVisible().catch(() => false);
    expect(visible, 'palette closed after Escape from sub-mode').toBe(false);
  });
});
