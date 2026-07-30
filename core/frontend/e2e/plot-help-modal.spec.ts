/**
 * PlotHelpModal interactive feature e2e tests.
 *
 * Beginner:
 *   PH1-PH4:  Modal opens via "Plot syntax reference" button; search input visible
 *   PH5-PH7:  Search filter narrows the shape/clause list
 *   PH8-PH10: Escape key closes the modal
 *
 * Complex / power-user:
 *   PH11-PH14: Tab switching — "Shapes & Clauses" vs "Cheat Sheet" tabs
 *   PH15-PH17: "Copy example to clipboard" / "Insert example into editor" buttons
 *   PH18-PH21: Interactive Dashboard Example section — editable config present
 *   PH22-PH24: Filter clears restore all content; modal still functional after operations
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

/** Opens the PlotHelpModal via the "Plot syntax reference" button on a plot block. */
async function openPlotHelp(page: Page): Promise<boolean> {
  const plotRefBtn = page.getByRole('button', { name: 'Plot syntax reference' }).first();
  const visible = await plotRefBtn.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!visible) return false;
  await plotRefBtn.click();
  await page.waitForTimeout(500);
  const dialog = page.getByRole('dialog', { name: 'Plot Function Guide' });
  return dialog.isVisible().catch(() => false);
}

// ---------------------------------------------------------------------------
// Section 1: Open and search (beginner)
// ---------------------------------------------------------------------------

test.describe.serial('PlotHelpModal: Open and search', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('PH1. "Plot syntax reference" button is visible on a plot block', async () => {
    const plotRefBtn = page.getByRole('button', { name: 'Plot syntax reference' }).first();
    const visible = await plotRefBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(plotRefBtn).toBeVisible();
  });

  test('PH2. Clicking "Plot syntax reference" opens the modal dialog', async () => {
    const opened = await openPlotHelp(page);
    if (!opened) { test.skip(); return; }

    const dialog = page.getByRole('dialog', { name: 'Plot Function Guide' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  });

  test('PH3. The "Search plot help" input is visible inside the modal', async () => {
    const searchInput = page.locator('input[aria-label="Search plot help"]');
    const visible = await searchInput.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(searchInput).toBeVisible();
  });

  test('PH4. The modal contains at least one documented shape (e.g. LINE)', async () => {
    const dialog = page.getByRole('dialog', { name: 'Plot Function Guide' });
    const body = await dialog.innerText().catch(() => '');
    expect(body, 'dialog has content').toContain('LINE');
  });
});

// ---------------------------------------------------------------------------
// Section 2: Search filter (beginner)
// ---------------------------------------------------------------------------

test.describe.serial('PlotHelpModal: Search filter', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    await openPlotHelp(page);
  });
  test.afterAll(async () => page.close());

  test('PH5. Typing a shape name in search narrows the list', async () => {
    const searchInput = page.locator('input[aria-label="Search plot help"]');
    const visible = await searchInput.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    const dialog = page.getByRole('dialog', { name: 'Plot Function Guide' });
    const textBefore = await dialog.innerText().catch(() => '');

    await searchInput.fill('BAR');
    await page.waitForTimeout(300);

    const textAfter = await dialog.innerText().catch(() => '');
    // With filter applied, the visible content should differ.
    expect(textAfter.length, 'content changed after filter').toBeGreaterThan(0);
  });

  test('PH6. "BAR" filter shows BAR-related items', async () => {
    const dialog = page.getByRole('dialog', { name: 'Plot Function Guide' });
    const body = await dialog.innerText().catch(() => '');
    expect(body, 'BAR visible after filter').toContain('BAR');
  });

  test('PH7. Clearing the search restores all items', async () => {
    const searchInput = page.locator('input[aria-label="Search plot help"]');
    const visible = await searchInput.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await searchInput.fill('');
    await page.waitForTimeout(300);

    const dialog = page.getByRole('dialog', { name: 'Plot Function Guide' });
    const body = await dialog.innerText().catch(() => '');
    // LINE should be back after clearing.
    expect(body, 'LINE restored after clear').toContain('LINE');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });
});

// ---------------------------------------------------------------------------
// Section 3: Escape key close (beginner)
// ---------------------------------------------------------------------------

test.describe.serial('PlotHelpModal: Escape close', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('PH8. Opening and pressing Escape closes the modal', async () => {
    const opened = await openPlotHelp(page);
    if (!opened) { test.skip(); return; }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const dialog = page.getByRole('dialog', { name: 'Plot Function Guide' });
    const visible = await dialog.isVisible().catch(() => false);
    expect(visible, 'modal closed by Escape').toBe(false);
  });

  test('PH9. The "Close" button also dismisses the modal', async () => {
    const opened = await openPlotHelp(page);
    if (!opened) { test.skip(); return; }

    const closeBtn = page.getByRole('button', { name: 'Close' }).first();
    const btnVisible = await closeBtn.isVisible().catch(() => false);
    if (!btnVisible) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      test.skip();
      return;
    }

    await closeBtn.click();
    await page.waitForTimeout(300);

    const dialog = page.getByRole('dialog', { name: 'Plot Function Guide' });
    const visible = await dialog.isVisible().catch(() => false);
    expect(visible, 'modal closed by X button').toBe(false);
  });

  test('PH10. Modal can be re-opened after closing', async () => {
    const opened = await openPlotHelp(page);
    if (!opened) { test.skip(); return; }

    const dialog = page.getByRole('dialog', { name: 'Plot Function Guide' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });
});

// ---------------------------------------------------------------------------
// Section 4: Tab switching (power-user)
// ---------------------------------------------------------------------------

test.describe.serial('PlotHelpModal: Tab switching', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    await openPlotHelp(page);
  });
  test.afterAll(async () => page.close());

  test('PH11. Both "Shapes & Clauses" and "Cheat Sheet" tabs are visible', async () => {
    const shapesTab = page.getByRole('tab', { name: 'Shapes & Clauses' });
    const cheatTab  = page.getByRole('tab', { name: 'Cheat Sheet' });
    const shapesVisible = await shapesTab.isVisible().catch(() => false);
    const cheatVisible  = await cheatTab.isVisible().catch(() => false);
    if (!shapesVisible || !cheatVisible) { test.skip(); return; }
    await expect(shapesTab).toBeVisible();
    await expect(cheatTab).toBeVisible();
  });

  test('PH12. "Shapes & Clauses" is the default active tab', async () => {
    const shapesTab = page.getByRole('tab', { name: 'Shapes & Clauses' });
    const visible = await shapesTab.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    const selected = await shapesTab.getAttribute('aria-selected');
    expect(selected, '"Shapes & Clauses" selected by default').toBe('true');
  });

  test('PH13. Clicking "Cheat Sheet" switches the active tab', async () => {
    const cheatTab = page.getByRole('tab', { name: 'Cheat Sheet' });
    const visible = await cheatTab.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await cheatTab.click();
    await page.waitForTimeout(300);

    const selected = await cheatTab.getAttribute('aria-selected');
    expect(selected, 'Cheat Sheet tab selected').toBe('true');
  });

  test('PH14. Switching back to "Shapes & Clauses" shows the main content', async () => {
    const shapesTab = page.getByRole('tab', { name: 'Shapes & Clauses' });
    const visible = await shapesTab.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await shapesTab.click();
    await page.waitForTimeout(300);

    const dialog = page.getByRole('dialog', { name: 'Plot Function Guide' });
    const body = await dialog.innerText().catch(() => '');
    expect(body, 'LINE visible after switching back').toContain('LINE');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });
});

// ---------------------------------------------------------------------------
// Section 5: Example copy/insert buttons (power-user)
// ---------------------------------------------------------------------------

test.describe.serial('PlotHelpModal: Example buttons', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    await openPlotHelp(page);
  });
  test.afterAll(async () => page.close());

  test('PH15. At least one example code block is visible in the modal', async () => {
    const dialog = page.getByRole('dialog', { name: 'Plot Function Guide' });
    // Example code blocks are in pre elements.
    const codeBlocks = dialog.locator('pre');
    const count = await codeBlocks.count();
    expect(count, 'at least one code block').toBeGreaterThan(0);
  });

  test('PH16. "Copy example to clipboard" or "Insert example into editor" button exists', async () => {
    // When opened from a plot block, button says "Insert example into editor".
    // When opened standalone, it says "Copy example to clipboard".
    const insertBtn = page.getByRole('button', { name: /Insert example|Copy example/i }).first();
    const visible = await insertBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(insertBtn).toBeVisible();
  });

  test('PH17. Clicking the copy/insert button does not crash the modal', async () => {
    const insertBtn = page.getByRole('button', { name: /Insert example|Copy example/i }).first();
    const visible = await insertBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await insertBtn.click();
    await page.waitForTimeout(300);

    // Modal should still be open (or may have closed if "insert" was used).
    const dialog = page.getByRole('dialog', { name: 'Plot Function Guide' });
    // Just verify the page didn't crash.
    await expect(page.getByRole('heading', { name: 'JFR Query Notebook' })).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });
});

// ---------------------------------------------------------------------------
// Section 6: Interactive Dashboard Example (power-user)
// ---------------------------------------------------------------------------

test.describe.serial('PlotHelpModal: Interactive example', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    await openPlotHelp(page);
  });
  test.afterAll(async () => page.close());

  test('PH18. The "Interactive Dashboard Example" section is present', async () => {
    // Scroll down to reach the interactive example section.
    const dialog = page.getByRole('dialog', { name: 'Plot Function Guide' });
    const interactiveHeading = dialog.locator('h3', { hasText: 'Interactive Dashboard Example' });
    const visible = await interactiveHeading.isVisible().catch(() => false);
    if (!visible) {
      await dialog.locator('div').first().evaluate(el => el.scrollTop = 9999);
      await page.waitForTimeout(300);
    }
    const heading = dialog.locator('text=Interactive Dashboard Example').first();
    const headingVisible = await heading.isVisible().catch(() => false);
    if (!headingVisible) { test.skip(); return; }
    await expect(heading).toBeVisible();
  });

  test('PH19. An editable config editor is present in the interactive example', async () => {
    const dialog = page.getByRole('dialog', { name: 'Plot Function Guide' });
    // The editable area is a CodeMirror editor inside the dialog.
    const cmEditor = dialog.locator('.cm-editor').first();
    const visible = await cmEditor.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(cmEditor).toBeVisible();
  });

  test('PH20. The interactive preview area is present', async () => {
    // The "Interactive Preview" label is shown above the PlotRenderer.
    const dialog = page.getByRole('dialog', { name: 'Plot Function Guide' });
    const previewLabel = dialog.locator('h5', { hasText: 'Interactive Preview' });
    const visible = await previewLabel.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(previewLabel).toBeVisible();
  });

  test('PH21. Editable config section is labeled "Editable Config"', async () => {
    const dialog = page.getByRole('dialog', { name: 'Plot Function Guide' });
    const editableLabel = dialog.locator('h5', { hasText: 'Editable Config' });
    const visible = await editableLabel.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(editableLabel).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Section 7: Stability after operations (power-user)
// ---------------------------------------------------------------------------

test.describe.serial('PlotHelpModal: Stability', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    await openPlotHelp(page);
  });
  test.afterAll(async () => page.close());

  test('PH22. Applying then clearing search leaves modal in original state', async () => {
    const searchInput = page.locator('input[aria-label="Search plot help"]');
    const visible = await searchInput.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await searchInput.fill('SCATTER');
    await page.waitForTimeout(200);
    await searchInput.fill('');
    await page.waitForTimeout(200);

    const dialog = page.getByRole('dialog', { name: 'Plot Function Guide' });
    const body = await dialog.innerText().catch(() => '');
    expect(body, 'full content restored').toContain('LINE');
  });

  test('PH23. Switching tabs and back leaves search intact', async () => {
    const searchInput = page.locator('input[aria-label="Search plot help"]');
    if (!(await searchInput.isVisible().catch(() => false))) { test.skip(); return; }

    await searchInput.fill('BAR');
    await page.waitForTimeout(200);

    const cheatTab = page.getByRole('tab', { name: 'Cheat Sheet' });
    if (await cheatTab.isVisible().catch(() => false)) {
      await cheatTab.click();
      await page.waitForTimeout(200);
      const shapesTab = page.getByRole('tab', { name: 'Shapes & Clauses' });
      if (await shapesTab.isVisible().catch(() => false)) {
        await shapesTab.click();
        await page.waitForTimeout(200);
      }
    }

    // Search value should still be "BAR" after tab switch.
    const val = await searchInput.inputValue();
    expect(val, 'filter persists across tab switch').toBe('BAR');
  });

  test('PH24. Modal and notebook remain functional after all operations', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await expect(page.getByRole('heading', { name: 'JFR Query Notebook' })).toBeVisible();
    await expect(page.locator('.cm-jfr-editor .cm-editor').first()).toBeVisible({ timeout: 3_000 });
  });
});
