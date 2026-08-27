/**
 * E2E tests for JVM GC log parsing in server mode.
 *
 * Requires:
 *   - query.jar built at core/target/query.jar
 *   - jdklogs data at /Users/i560383_1/code/experiments/jdklogs/data/
 *
 * Run with:
 *   cd core/frontend && npm run test:jvmlog-e2e
 *
 * Skipped when SKIP_E2E=1 or when the jar / log file is absent (checked in globalSetup).
 */

import { test, expect, Page } from '@playwright/test';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname_compat = dirname(__filename);
const JAR = resolve(__dirname_compat, '../../target/query.jar');
const LOG_FILE = resolve(__dirname_compat, '../../../../jdklogs/data/head.G1.log');
const SKIP = process.env.SKIP_E2E === '1' || !existsSync(JAR) || !existsSync(LOG_FILE);

async function waitForNotebook(page: Page) {
  await page.getByRole('heading', { name: 'JFR Query Notebook' })
    .waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(3_000);
}

async function runSqlInNewCell(page: Page, sql: string) {
  // Add a new cell via keyboard shortcut or button
  const addBtn = page.getByRole('button', { name: /add.*(sql|cell)/i }).first();
  if (await addBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await addBtn.click();
    await page.waitForTimeout(500);
  }
  // Type into the last SQL editor
  const editor = page.locator('.cm-jfr-editor .cm-content').last();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(sql, { delay: 0 });
  await page.waitForTimeout(300);
  // Run via button or keyboard shortcut
  const runBtn = page.locator('[data-testid="run-cell"]').last();
  if (await runBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await runBtn.click();
  } else {
    await page.keyboard.press('ControlOrMeta+Enter');
  }
  await page.waitForTimeout(2_000);
}

test.describe.serial('JVM log server-mode e2e', () => {
  test.skip(SKIP, 'SKIP_E2E=1 or jar/log not found');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/');
    await waitForNotebook(page);
  });

  test.afterAll(async () => { await page.close(); });

  // -----------------------------------------------------------------------
  // 1. Server mode detection
  // -----------------------------------------------------------------------

  test('JS1. Notebook loads in server mode', async () => {
    const wasmBadge = page.getByText(/^WASM$/i);
    const isWasm = await wasmBadge.isVisible({ timeout: 3_000 }).catch(() => false);
    expect(isWasm, 'should NOT be in WASM mode — server must be running').toBe(false);
  });

  // -----------------------------------------------------------------------
  // 2. Schema sidebar contains jvmlog tables
  // -----------------------------------------------------------------------

  test('JS2. Schema sidebar lists jvmlog_gc_event table', async () => {
    const tableItems = page.getByTitle(/Click to preview/i);
    const count = await tableItems.count();
    expect(count, 'sidebar should have tables').toBeGreaterThan(0);
    const gcEventItem = page.getByText('jvmlog_gc_event').first();
    await gcEventItem.waitFor({ state: 'visible', timeout: 10_000 });
  });

  test('JS3. Schema sidebar lists jvmlog_gc_init table', async () => {
    const gcInitItem = page.getByText('jvmlog_gc_init').first();
    await gcInitItem.waitFor({ state: 'visible', timeout: 10_000 });
  });

  test('JS4. Schema sidebar lists jvmlog_heap_snapshot table', async () => {
    const item = page.getByText('jvmlog_heap_snapshot').first();
    await item.waitFor({ state: 'visible', timeout: 10_000 });
  });

  // -----------------------------------------------------------------------
  // 3. Direct SQL queries against jvmlog tables
  // -----------------------------------------------------------------------

  test('JS5. SELECT from jvmlog_gc_event returns no error', async () => {
    await runSqlInNewCell(page,
      'SELECT gcId, gcType, pauseMs FROM jvmlog_gc_event LIMIT 5');
    const body = await page.locator('body').textContent() ?? '';
    expect(body).not.toMatch(/Catalog Error|Binder Error|Parser Error/);
  });

  test('JS6. SELECT from jvmlog_gc_init returns algorithm row', async () => {
    await runSqlInNewCell(page,
      "SELECT algorithm FROM jvmlog_gc_init WHERE algorithm IS NOT NULL LIMIT 1");
    const body = await page.locator('body').textContent() ?? '';
    expect(body).not.toMatch(/Catalog Error|Binder Error|Parser Error/);
    expect(body).toMatch(/G1|ZGC|Parallel|Serial/i);
  });

  test('JS7. SELECT from jvmlog_heap_snapshot returns no error', async () => {
    await runSqlInNewCell(page,
      'SELECT gcId, heapBefore, heapAfter FROM jvmlog_heap_snapshot LIMIT 5');
    const body = await page.locator('body').textContent() ?? '';
    expect(body).not.toMatch(/Catalog Error|Binder Error|Parser Error/);
  });

  // -----------------------------------------------------------------------
  // 4. Views render correctly
  // -----------------------------------------------------------------------

  test('JS8. jvmlog-gc-summary view executes without error', async () => {
    await runSqlInNewCell(page, 'SELECT * FROM "jvmlog-gc-summary" LIMIT 10');
    const body = await page.locator('body').textContent() ?? '';
    expect(body).not.toMatch(/Catalog Error|Binder Error|Parser Error/);
  });

  test('JS9. jvmlog-heap-timeline view executes without error', async () => {
    await runSqlInNewCell(page, 'SELECT * FROM "jvmlog-heap-timeline" LIMIT 5');
    const body = await page.locator('body').textContent() ?? '';
    expect(body).not.toMatch(/Catalog Error|Binder Error|Parser Error/);
  });

  test('JS10. jvmlog-pause-percentiles view executes without error', async () => {
    await runSqlInNewCell(page, 'SELECT * FROM "jvmlog-pause-percentiles" LIMIT 5');
    const body = await page.locator('body').textContent() ?? '';
    expect(body).not.toMatch(/Catalog Error|Binder Error|Parser Error/);
  });

  // -----------------------------------------------------------------------
  // 5. Settings modal — Log Patterns tab
  // -----------------------------------------------------------------------

  test('JS11. Settings modal has Log Patterns tab', async () => {
    const settingsBtn = page.getByRole('button', { name: /settings/i }).first();
    await settingsBtn.click();
    await page.waitForTimeout(500);
    const logPatternsTab = page.getByText('Log Patterns').first();
    await logPatternsTab.waitFor({ state: 'visible', timeout: 5_000 });
  });

  test('JS12. Log Patterns tab does not show server-mode-only message', async () => {
    const logPatternsTab = page.getByText('Log Patterns').first();
    if (await logPatternsTab.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await logPatternsTab.click();
      await page.waitForTimeout(500);
    }
    const body = await page.locator('body').textContent() ?? '';
    expect(body).not.toMatch(/only available in server mode/i);
    await page.keyboard.press('Escape');
  });
});
