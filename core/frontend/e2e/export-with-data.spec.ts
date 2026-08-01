/**
 * Export-with-data e2e tests (EWD1–EWD6).
 *
 * EWD1: "Export with data" button is visible in toolbar when demo is loaded.
 * EWD2: Button is enabled once a JFR/demo DB is loaded (dbState READY).
 * EWD3: Button is disabled when no DB is loaded (no demo).
 * EWD4: Clicking the button triggers a file download (checks download event).
 * EWD5: Downloaded file name is "notebook-shared.md".
 * EWD6: "Snapshot" badge absent on a freshly loaded demo (no embedded data).
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

test.describe.serial('Export with data: UI presence', () => {
    test.skip(SKIP, 'SKIP_E2E=1 set');

    let page: Page;
    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        await gotoDemo(page);
    });
    test.afterAll(async () => page.close());

    test('EWD1. "Export with data" button is visible in toolbar', async () => {
        const btn = page.getByRole('button', { name: 'Export with data' });
        await expect(btn).toBeVisible({ timeout: 5_000 });
    });

    test('EWD2. Button is enabled after demo DB is loaded', async () => {
        const btn = page.getByRole('button', { name: 'Export with data' });
        await expect(btn).toBeEnabled({ timeout: 10_000 });
    });

    test('EWD6. "Snapshot" badge is absent on a freshly loaded demo notebook', async () => {
        const badge = page.getByText('Snapshot', { exact: true });
        await expect(badge).toBeHidden({ timeout: 3_000 });
    });
});

test.describe.serial('Export with data: download', () => {
    test.skip(SKIP, 'SKIP_E2E=1 set');

    let page: Page;
    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        await gotoDemo(page);
    });
    test.afterAll(async () => page.close());

    test('EWD4–5. Clicking export triggers a download named notebook-shared.md', async () => {
        const btn = page.getByRole('button', { name: 'Export with data' });
        await expect(btn).toBeEnabled({ timeout: 15_000 });

        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60_000 }),
            btn.click(),
        ]);
        expect(download.suggestedFilename()).toBe('notebook-shared.md');
    });
});

test.describe.serial('Export with data: no DB → button disabled', () => {
    test.skip(SKIP, 'SKIP_E2E=1 set');

    let page: Page;
    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        // Go to the app but do NOT click demo — no DB loaded.
        await page.goto('/');
        await page.waitForTimeout(3_000);
    });
    test.afterAll(async () => page.close());

    test('EWD3. "Export with data" button is disabled when no DB is loaded', async () => {
        // Button might be in a notebook that isn't visible before demo load,
        // but if it exists it should be disabled.
        const btn = page.getByRole('button', { name: 'Export with data' });
        const count = await btn.count();
        if (count > 0) {
            await expect(btn).toBeDisabled({ timeout: 3_000 });
        }
        // If the notebook toolbar isn't mounted yet (drop-zone shown), that's fine too.
    });
});
