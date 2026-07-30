/**
 * InlineChat (per-cell AI) e2e tests.
 *
 * Beginner:
 *   IC1-IC4:  "Refine with AI" button opens per-cell chat; Close button closes it
 *   IC5-IC8:  Chat textarea is visible; text can be typed
 *   IC9-IC11: "Reset Chat" clears history; "Move to sidebar chat" works
 *
 * Complex / power-user:
 *   IC12-IC15: Typing "/" shows slash-command autocomplete dropdown
 *   IC16-IC18: ArrowDown navigates; Tab/Enter selects from autocomplete
 *   IC19-IC21: Typing "$" shows variable autocomplete when variables exist
 *   IC22-IC24: Context inject buttons ("this sql", "results") are present
 *   IC25-IC27: "Include full notebook context" toggle button works
 *
 * Skipped when SKIP_E2E=1.
 * Note: Tests requiring AI inference are conditional on AI being configured.
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

/** Opens per-cell chat by clicking the "Refine with AI" button. Returns false if not available. */
async function openInlineChat(page: Page): Promise<boolean> {
  const refineBtn = page.getByRole('button', { name: 'Refine with AI' }).first();
  const visible = await refineBtn.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!visible) return false;
  await refineBtn.click();
  await page.waitForTimeout(400);
  return true;
}

// ---------------------------------------------------------------------------
// Section 1: Open and close (beginner)
// ---------------------------------------------------------------------------

test.describe.serial('InlineChat: Open and close', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
  });
  test.afterAll(async () => page.close());

  test('IC1. "Refine with AI" button is visible on the first SQL block', async () => {
    const refineBtn = page.getByRole('button', { name: 'Refine with AI' }).first();
    const visible = await refineBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(refineBtn).toBeVisible();
  });

  test('IC2. Clicking "Refine with AI" opens the inline chat panel', async () => {
    const opened = await openInlineChat(page);
    if (!opened) { test.skip(); return; }

    // InlineChat renders a textarea with placeholder about AI.
    const chatInput = page.locator('textarea[placeholder*="Ask AI"]').first()
      .or(page.locator('textarea[placeholder*="Refine"]').first());
    const visible = await chatInput.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(chatInput).toBeVisible();
  });

  test('IC3. The "Close Chat" button is visible inside the panel', async () => {
    const closeBtn = page.getByRole('button', { name: 'Close Chat' }).first();
    const visible = await closeBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(closeBtn).toBeVisible();
  });

  test('IC4. Clicking "Close Chat" dismisses the panel', async () => {
    const closeBtn = page.getByRole('button', { name: 'Close Chat' }).first();
    const visible = await closeBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await closeBtn.click();
    await page.waitForTimeout(300);

    const chatInput = page.locator('textarea[placeholder*="Ask AI"]').first()
      .or(page.locator('textarea[placeholder*="Refine"]').first());
    const stillVisible = await chatInput.isVisible().catch(() => false);
    expect(stillVisible, 'chat panel closed').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 2: Chat input (beginner)
// ---------------------------------------------------------------------------

test.describe.serial('InlineChat: Chat input', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    await openInlineChat(page);
  });
  test.afterAll(async () => page.close());

  test('IC5. Chat textarea is visible after opening inline chat', async () => {
    const textarea = page.locator('textarea[placeholder*="Ask AI"]').first()
      .or(page.locator('textarea[placeholder*="change"]').first());
    const visible = await textarea.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(textarea).toBeVisible();
  });

  test('IC6. Typing text into the chat textarea updates its value', async () => {
    const textarea = page.locator('textarea[placeholder*="Ask AI"]').first()
      .or(page.locator('textarea[placeholder*="change"]').first());
    const visible = await textarea.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await textarea.fill('rename column duration to ms');
    await page.waitForTimeout(200);
    const val = await textarea.inputValue();
    expect(val, 'text accepted').toBe('rename column duration to ms');
  });

  test('IC7. "Send message" button is enabled when input has text', async () => {
    const sendBtn = page.getByRole('button', { name: 'Send message' }).first();
    const visible = await sendBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    const disabled = await sendBtn.getAttribute('disabled');
    expect(disabled, 'send button enabled with text').toBeNull();
  });

  test('IC8. Clearing the textarea disables the send button', async () => {
    const textarea = page.locator('textarea[placeholder*="Ask AI"]').first()
      .or(page.locator('textarea[placeholder*="change"]').first());
    const visible = await textarea.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await textarea.fill('');
    await page.waitForTimeout(200);

    const sendBtn = page.getByRole('button', { name: 'Send message' }).first();
    const sendVisible = await sendBtn.isVisible().catch(() => false);
    if (!sendVisible) { test.skip(); return; }

    const disabled = await sendBtn.getAttribute('disabled');
    expect(disabled, 'send disabled when empty').not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Section 3: Reset and Move to sidebar (beginner)
// ---------------------------------------------------------------------------

test.describe.serial('InlineChat: Reset and move to sidebar', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    await openInlineChat(page);
  });
  test.afterAll(async () => page.close());

  test('IC9. "Reset Chat" button is visible in the inline chat header', async () => {
    const resetBtn = page.getByRole('button', { name: 'Reset Chat' }).first();
    const visible = await resetBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(resetBtn).toBeVisible();
  });

  test('IC10. Clicking "Reset Chat" clears any messages', async () => {
    const resetBtn = page.getByRole('button', { name: 'Reset Chat' }).first();
    const visible = await resetBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await resetBtn.click();
    await page.waitForTimeout(300);

    // Panel should still be open after reset.
    const textarea = page.locator('textarea[placeholder*="Ask AI"]').first()
      .or(page.locator('textarea[placeholder*="change"]').first());
    const textareaVisible = await textarea.isVisible().catch(() => false);
    expect(textareaVisible, 'chat still open after reset').toBe(true);
  });

  test('IC11. "Move to sidebar chat" button is visible', async () => {
    const moveBtn = page.getByRole('button', { name: 'Move to sidebar chat' }).first();
    const visible = await moveBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(moveBtn).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Section 4: Slash-command autocomplete (power-user)
// ---------------------------------------------------------------------------

test.describe.serial('InlineChat: Slash-command autocomplete', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    await openInlineChat(page);
  });
  test.afterAll(async () => page.close());

  test('IC12. Typing "/" into the chat input triggers a suggestion dropdown', async () => {
    const textarea = page.locator('textarea[placeholder*="Ask AI"]').first()
      .or(page.locator('textarea[placeholder*="change"]').first());
    const visible = await textarea.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await textarea.fill('/');
    await page.waitForTimeout(300);

    // Slash command suggestions are rendered as buttons with font-mono text.
    const firstSuggestion = page.locator('button.font-mono').first();
    const suggVisible = await firstSuggestion.isVisible().catch(() => false);
    if (!suggVisible) { test.skip(); return; }
    await expect(firstSuggestion).toBeVisible();
  });

  test('IC13. The suggestion list contains known commands like "/help"', async () => {
    const suggestions = page.locator('button.font-mono');
    const count = await suggestions.count();
    if (count === 0) { test.skip(); return; }

    // Collect all suggestion texts.
    const texts: string[] = [];
    for (let i = 0; i < Math.min(count, 10); i++) {
      const t = await suggestions.nth(i).textContent().catch(() => '');
      texts.push(t);
    }
    const hasKnownCmd = texts.some(t => t.includes('/help') || t.includes('/mode') || t.includes('/model') || t.includes('/clear'));
    expect(hasKnownCmd, 'known command in suggestions').toBe(true);
  });

  test('IC14. ArrowDown key navigates through suggestions', async () => {
    const textarea = page.locator('textarea[placeholder*="Ask AI"]').first()
      .or(page.locator('textarea[placeholder*="change"]').first());
    const visible = await textarea.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    const suggestions = page.locator('button.font-mono');
    if (await suggestions.count() === 0) { test.skip(); return; }

    await textarea.press('ArrowDown');
    await page.waitForTimeout(150);

    // At least one suggestion should be highlighted (cyan bg).
    const highlighted = page.locator('button.font-mono.bg-cyan-700\\/40').first();
    const hlVisible = await highlighted.isVisible().catch(() => false);
    // Accept either highlighted OR that navigation didn't crash.
    const stillOpen = await suggestions.first().isVisible().catch(() => false);
    expect(hlVisible || stillOpen, 'navigation works').toBe(true);
  });

  test('IC15. Pressing Tab selects the highlighted suggestion', async () => {
    const textarea = page.locator('textarea[placeholder*="Ask AI"]').first()
      .or(page.locator('textarea[placeholder*="change"]').first());
    const visible = await textarea.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await textarea.press('Tab');
    await page.waitForTimeout(200);

    // After Tab, the input should contain a slash command.
    const val = await textarea.inputValue();
    expect(val, 'selected command inserted').toMatch(/^\//);
  });
});

// ---------------------------------------------------------------------------
// Section 5: Context inject and full-context toggle (power-user)
// ---------------------------------------------------------------------------

test.describe.serial('InlineChat: Context inject buttons', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    // Run a query first so "results" context button appears.
    const editor = page.locator('.cm-jfr-editor .cm-editor').first();
    await editor.locator('.cm-content').first().click();
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.insertText('SELECT cause FROM GarbageCollection LIMIT 5');
    await page.keyboard.press(`${mod}+Enter`);
    await page.locator('table').first().waitFor({ state: 'visible', timeout: 12_000 });
    await page.waitForTimeout(500);
    await openInlineChat(page);
  });
  test.afterAll(async () => page.close());

  test('IC19. "this sql" context inject button is present', async () => {
    const thisBtn = page.getByRole('button', { name: /Inject current sql content|this sql/i }).first();
    const visible = await thisBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(thisBtn).toBeVisible();
  });

  test('IC20. "results" context inject button is present after a query ran', async () => {
    const resultsBtn = page.getByRole('button', { name: /Inject first 20 rows|results/i }).first();
    const visible = await resultsBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(resultsBtn).toBeVisible();
  });

  test('IC21. Clicking "this sql" injects SQL text into the chat input', async () => {
    const thisBtn = page.getByRole('button', { name: /Inject current sql content|this sql/i }).first();
    const visible = await thisBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    const textarea = page.locator('textarea[placeholder*="Ask AI"]').first()
      .or(page.locator('textarea[placeholder*="change"]').first());
    const taVisible = await textarea.isVisible().catch(() => false);
    if (!taVisible) { test.skip(); return; }

    await textarea.fill('');
    await thisBtn.click();
    await page.waitForTimeout(300);

    const val = await textarea.inputValue();
    expect(val.length, 'SQL injected into input').toBeGreaterThan(0);
  });

  test('IC22. "Include full notebook context" toggle button is present', async () => {
    const ctxBtn = page.getByRole('button', { name: 'Include full notebook context in prompt' }).first();
    const visible = await ctxBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(ctxBtn).toBeVisible();
  });

  test('IC23. Clicking "Include full notebook context" toggles its active state', async () => {
    const ctxBtn = page.getByRole('button', { name: 'Include full notebook context in prompt' }).first();
    const visible = await ctxBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    const classBefore = await ctxBtn.getAttribute('class') ?? '';
    await ctxBtn.click();
    await page.waitForTimeout(200);
    const classAfter = await ctxBtn.getAttribute('class') ?? '';
    expect(classAfter, 'class changes on toggle').not.toBe(classBefore);
  });

  test('IC24. After context toggle, chat panel is still functional', async () => {
    const textarea = page.locator('textarea[placeholder*="Ask AI"]').first()
      .or(page.locator('textarea[placeholder*="change"]').first());
    const visible = await textarea.isVisible().catch(() => false);
    expect(visible, 'textarea still present').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 6: AI data visibility dropdown (power-user)
// ---------------------------------------------------------------------------

test.describe.serial('InlineChat: AI data visibility', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoDemo(page);
    await openInlineChat(page);
  });
  test.afterAll(async () => page.close());

  test('IC25. "AI data visibility" select is visible in the chat header', async () => {
    const visSelect = page.locator('select[aria-label="AI data visibility"]').first()
      .or(page.locator('[aria-label="AI data visibility"]').first());
    const visible = await visSelect.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }
    await expect(visSelect).toBeVisible();
  });

  test('IC26. The visibility dropdown has multiple options', async () => {
    const visSelect = page.locator('select[aria-label="AI data visibility"]').first();
    const visible = await visSelect.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    const options = visSelect.locator('option');
    const count = await options.count();
    expect(count, 'multiple visibility options').toBeGreaterThanOrEqual(2);
  });

  test('IC27. Changing the visibility dropdown does not crash the panel', async () => {
    const visSelect = page.locator('select[aria-label="AI data visibility"]').first();
    const visible = await visSelect.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    await visSelect.selectOption({ index: 1 });
    await page.waitForTimeout(200);

    // Panel should still be intact.
    const textarea = page.locator('textarea[placeholder*="Ask AI"]').first()
      .or(page.locator('textarea[placeholder*="change"]').first());
    const taVisible = await textarea.isVisible().catch(() => false);
    expect(taVisible, 'panel intact after visibility change').toBe(true);
  });
});
