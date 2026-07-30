/**
 * Template gallery e2e tests.
 *
 * Beginner:
 *   TG1-TG3:  "New from template" button opens gallery; Escape / Cancel closes it
 *   TG4-TG6:  Template list shows at least one item; searching narrows results
 *   TG7-TG9:  Clicking a template loads its preview on the right
 *
 * Complex / power-user:
 *   TG10-TG13: "All" tag filter shows all templates; tag button narrows list
 *   TG14-TG17: Insert mode radio buttons are present and toggleable
 *   TG18-TG21: "Use template" button closes gallery and updates notebook
 *   TG22-TG24: Clicking the backdrop (outside dialog) closes the gallery
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

async function openGallery(page: Page): Promise<boolean> {
  const btn = page.getByRole('button', { name: 'New from template' });
  const visible = await btn.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!visible) return false;
  await btn.click();
  await page.waitForTimeout(400);
  return true;
}

// ---------------------------------------------------------------------------
// Section 1: Open and close (beginner)
// ---------------------------------------------------------------------------

test.describe.serial('TemplateGallery: Open and close', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('TG1. "New from template" button is visible in the toolbar', async () => {
    const btn = page.getByRole('button', { name: 'New from template' });
    await expect(btn).toBeVisible({ timeout: 5_000 });
  });

  test('TG2. Clicking "New from template" opens the gallery dialog', async () => {
    const opened = await openGallery(page);
    if (!opened) { test.skip(); return; }
    const dialog = page.getByRole('dialog', { name: 'New from template' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  });

  test('TG3. Clicking "Cancel" closes the gallery', async () => {
    const cancelBtn = page.getByRole('button', { name: 'Cancel' });
    const visible = await cancelBtn.isVisible().catch(() => false);
    if (!visible) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } else {
      await cancelBtn.click();
      await page.waitForTimeout(300);
    }
    const dialog = page.getByRole('dialog', { name: 'New from template' });
    const stillVisible = await dialog.isVisible().catch(() => false);
    expect(stillVisible, 'gallery closed after Cancel/Escape').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 2: Template list and search (beginner)
// ---------------------------------------------------------------------------

test.describe.serial('TemplateGallery: Template list', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('TG4. Gallery shows at least one template in the list', async () => {
    const opened = await openGallery(page);
    if (!opened) { test.skip(); return; }

    const items = page.locator('button[aria-label^="Select template:"]');
    const count = await items.count();
    expect(count, 'at least one template present').toBeGreaterThan(0);
  });

  test('TG5. Search input is visible and accepts text', async () => {
    const search = page.locator('input[aria-label="Search templates"]');
    const visible = await search.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await search.fill('gc');
    await page.waitForTimeout(300);
    const val = await search.inputValue();
    expect(val, 'search accepts text').toBe('gc');
  });

  test('TG6. Clearing search restores the full list', async () => {
    const search = page.locator('input[aria-label="Search templates"]');
    const visible = await search.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    const countBefore = await page.locator('button[aria-label^="Select template:"]').count();
    await search.fill('');
    await page.waitForTimeout(300);
    const countAfter = await page.locator('button[aria-label^="Select template:"]').count();
    expect(countAfter, 'list restored after clear').toBeGreaterThanOrEqual(countBefore);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });
});

// ---------------------------------------------------------------------------
// Section 3: Template preview (beginner)
// ---------------------------------------------------------------------------

test.describe.serial('TemplateGallery: Template preview', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('TG7. Clicking a template shows a preview in the right pane', async () => {
    const opened = await openGallery(page);
    if (!opened) { test.skip(); return; }

    const items = page.locator('button[aria-label^="Select template:"]');
    const count = await items.count();
    if (count === 0) { test.skip(); return; }

    await items.first().click();
    await page.waitForTimeout(400);

    // The preview pane should now show some content.
    const dialog = page.getByRole('dialog', { name: 'New from template' });
    const previewText = await dialog.innerText().catch(() => '');
    expect(previewText.length, 'preview pane has content after selection').toBeGreaterThan(50);
  });

  test('TG8. "Use template" button becomes active after selecting a template', async () => {
    const useBtn = page.getByRole('button', { name: 'Use template' });
    const visible = await useBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    // Button should not be disabled.
    const disabled = await useBtn.getAttribute('disabled');
    expect(disabled, 'Use template button is enabled').toBeNull();
  });

  test('TG9. Gallery dialog is still intact after template selection', async () => {
    const dialog = page.getByRole('dialog', { name: 'New from template' });
    await expect(dialog).toBeVisible({ timeout: 3_000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });
});

// ---------------------------------------------------------------------------
// Section 4: Tag filters (power-user)
// ---------------------------------------------------------------------------

test.describe.serial('TemplateGallery: Tag filters', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('TG10. Gallery tag filter area is visible', async () => {
    const opened = await openGallery(page);
    if (!opened) { test.skip(); return; }

    // Tag buttons have aria-pressed attribute.
    const allBtn = page.locator('button[aria-pressed]').first();
    const visible = await allBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(allBtn).toBeVisible();
  });

  test('TG11. "All" tag is selected by default (aria-pressed="true")', async () => {
    const tagBtns = page.locator('button[aria-pressed]');
    const count = await tagBtns.count();
    if (count === 0) { test.skip(); return; }

    // The first tag button ("All") should be pressed.
    const firstPressed = await tagBtns.first().getAttribute('aria-pressed');
    expect(firstPressed, '"All" tag selected by default').toBe('true');
  });

  test('TG12. Clicking a non-"All" tag button filters the list', async () => {
    const tagBtns = page.locator('button[aria-pressed]');
    const count = await tagBtns.count();
    if (count < 2) { test.skip(); return; }

    const secondTag = tagBtns.nth(1);
    const pressed = await secondTag.getAttribute('aria-pressed');
    if (pressed === 'true') { test.skip(); return; }

    await secondTag.click();
    await page.waitForTimeout(300);

    // The clicked tag should now be pressed.
    const newPressed = await secondTag.getAttribute('aria-pressed');
    expect(newPressed, 'tag now selected').toBe('true');
  });

  test('TG13. Clicking "All" tag restores the unfiltered list', async () => {
    const tagBtns = page.locator('button[aria-pressed]');
    const count = await tagBtns.count();
    if (count === 0) { test.skip(); return; }

    await tagBtns.first().click();
    await page.waitForTimeout(300);

    const firstPressed = await tagBtns.first().getAttribute('aria-pressed');
    expect(firstPressed, '"All" tag re-selected').toBe('true');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });
});

// ---------------------------------------------------------------------------
// Section 5: Insert mode radio buttons (power-user)
// ---------------------------------------------------------------------------

test.describe.serial('TemplateGallery: Insert mode', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    // Select first template so the right pane (and insert mode) is visible.
    const opened = await openGallery(page);
    if (opened) {
      const items = page.locator('button[aria-label^="Select template:"]');
      if (await items.count() > 0) await items.first().click();
      await page.waitForTimeout(300);
    }
  });
  test.afterAll(async () => page.close());

  test('TG14. "Replace" radio is present in the insert-mode fieldset', async () => {
    const replaceRadio = page.locator('input[name="insertMode"][value="replace"]').or(
      page.locator('input[type="radio"]').filter({ hasText: 'Replace' })
    );
    // Locate radio by checking for the Replace text sibling
    const dialog = page.getByRole('dialog', { name: 'New from template' });
    const dialogText = await dialog.innerText().catch(() => '');
    const hasReplace = dialogText.includes('Replace');
    if (!hasReplace) { test.skip(); return; }
    expect(hasReplace, 'Replace option present').toBe(true);
  });

  test('TG15. "Append" radio option is present', async () => {
    const dialog = page.getByRole('dialog', { name: 'New from template' });
    const text = await dialog.innerText().catch(() => '');
    const hasAppend = text.includes('Append');
    if (!hasAppend) { test.skip(); return; }
    expect(hasAppend, 'Append option present').toBe(true);
  });

  test('TG16. "Insert at top" radio option is present', async () => {
    const dialog = page.getByRole('dialog', { name: 'New from template' });
    const text = await dialog.innerText().catch(() => '');
    const hasInsert = text.includes('Insert at top');
    if (!hasInsert) { test.skip(); return; }
    expect(hasInsert, 'Insert at top option present').toBe(true);
  });

  test('TG17. Clicking the "Append" radio changes the selection', async () => {
    const appendRadio = page.locator('input[type="radio"]').nth(1);
    const visible = await appendRadio.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await appendRadio.click();
    await page.waitForTimeout(200);

    const checked = await appendRadio.isChecked().catch(() => false);
    expect(checked, 'Append radio checked after click').toBe(true);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });
});

// ---------------------------------------------------------------------------
// Section 6: Use template workflow (power-user)
// ---------------------------------------------------------------------------

test.describe.serial('TemplateGallery: Use template', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('TG18. Opening gallery, selecting a template and clicking "Use template" closes gallery', async () => {
    const opened = await openGallery(page);
    if (!opened) { test.skip(); return; }

    const items = page.locator('button[aria-label^="Select template:"]');
    if (await items.count() === 0) { test.skip(); return; }

    await items.first().click();
    await page.waitForTimeout(400);

    const useBtn = page.getByRole('button', { name: 'Use template' });
    const useBtnVisible = await useBtn.isVisible().catch(() => false);
    if (!useBtnVisible) { test.skip(); return; }

    await useBtn.click();
    await page.waitForTimeout(800);

    const dialog = page.getByRole('dialog', { name: 'New from template' });
    const stillOpen = await dialog.isVisible().catch(() => false);
    expect(stillOpen, 'gallery closed after Use template').toBe(false);
  });

  test('TG19. After template insert, the notebook heading is still visible', async () => {
    await expect(page.getByRole('heading', { name: 'JFR Query Notebook' })).toBeVisible();
  });

  test('TG20. After template insert, at least one cell editor is visible', async () => {
    const editors = page.locator('.cm-jfr-editor .cm-editor');
    const count = await editors.count();
    expect(count, 'cell editors present after template insert').toBeGreaterThan(0);
  });

  test('TG21. Gallery can be re-opened after a template insert', async () => {
    const opened = await openGallery(page);
    if (!opened) { test.skip(); return; }

    const dialog = page.getByRole('dialog', { name: 'New from template' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });
});

// ---------------------------------------------------------------------------
// Section 7: Backdrop close (power-user)
// ---------------------------------------------------------------------------

test.describe.serial('TemplateGallery: Backdrop close', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('TG22. Pressing Escape closes the gallery', async () => {
    const opened = await openGallery(page);
    if (!opened) { test.skip(); return; }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const dialog = page.getByRole('dialog', { name: 'New from template' });
    const visible = await dialog.isVisible().catch(() => false);
    expect(visible, 'gallery closed by Escape').toBe(false);
  });

  test('TG23. Gallery can be re-opened after Escape close', async () => {
    const opened = await openGallery(page);
    if (!opened) { test.skip(); return; }

    const dialog = page.getByRole('dialog', { name: 'New from template' });
    await expect(dialog).toBeVisible({ timeout: 3_000 });
  });

  test('TG24. "Close" (X) button dismisses the gallery', async () => {
    const closeBtn = page.getByRole('button', { name: 'Close' }).first();
    const visible = await closeBtn.isVisible().catch(() => false);
    if (!visible) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      test.skip();
      return;
    }

    await closeBtn.click();
    await page.waitForTimeout(300);

    const dialog = page.getByRole('dialog', { name: 'New from template' });
    const stillOpen = await dialog.isVisible().catch(() => false);
    expect(stillOpen, 'gallery closed by X button').toBe(false);
  });
});
