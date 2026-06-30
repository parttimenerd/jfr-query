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
