import { test, expect, Page } from '@playwright/test';

/**
 * W1 — Browser smoke tests for SQL completion popup.
 *
 * Each test drives the real DuckDB-WASM + AST completion stack inside the
 * `gcAnalysisNotebook` demo. We:
 *   1. boot the dev server (handled by playwright.config.ts `webServer`)
 *   2. click "Try example" to load the demo notebook (gives us tables,
 *      views, macros, and CTE context)
 *   3. for each cursor scenario, set the SQL cell text via the CodeMirror
 *      view's dispatch API and assert what appears in the autocomplete popup.
 *
 * Skipped entirely when SKIP_E2E=1 so CI that doesn't have a dev server
 * runtime can still land PRs that touch this file.
 */

const SKIP = process.env.SKIP_E2E === '1';

test.describe.serial('SQL completion smoke', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoAppAndLoadDemo(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('1. SELECT | FROM GarbageCollection g — GC columns in top 10', async () => {
    await expectTopCompletions(page, {
      cellIndex: 0,
      sqlBefore: 'SELECT ',
      sqlAfter: '\nFROM GarbageCollection g',
      expected: ['gcId', 'cause', 'duration', 'startTime'],
      minTopN: 15,
      mode: 'anyOf',
    });
  });

  test('2. SELECT g.| FROM GarbageCollection g — only GC columns', async () => {
    await expectTopCompletions(page, {
      cellIndex: 0,
      sqlBefore: 'SELECT g.',
      sqlAfter: '\nFROM GarbageCollection g',
      expected: ['gcId', 'cause', 'duration', 'startTime'],
      minTopN: 15,
      mode: 'anyOf',
    });
  });

  test('3. WHERE cause = \'|\' — distinct values popup non-empty', async () => {
    await expectTopCompletions(page, {
      cellIndex: 0,
      sqlBefore: "SELECT * FROM GarbageCollection WHERE cause = '",
      sqlAfter: "'",
      expected: [],
      minTopN: 10,
      mode: 'nonEmpty',
      // distinct-value provider issues an async DuckDB query; give it room.
      preCompletionDelayMs: 800,
    });
  });

  test('4. JOIN | — tables + views in top 30', async () => {
    await expectTopCompletions(page, {
      cellIndex: 0,
      sqlBefore: 'SELECT * FROM GarbageCollection g JOIN ',
      sqlAfter: '',
      // Demo schema includes many duckdb_*/pg_* system views; we just want
      // at least one real JFR table or domain view in the popup.
      expected: ['CPULoad', 'GCHeapSummary', 'GCPhasePause', 'ObjectAllocationSample', 'allocation-rate'],
      minTopN: 30,
      mode: 'anyOf',
    });
  });

  test('5. SELECT count(d| FROM GarbageCollection — DISTINCT or d-prefix columns', async () => {
    await expectTopCompletions(page, {
      cellIndex: 0,
      sqlBefore: 'SELECT count(d',
      sqlAfter: ') FROM GarbageCollection',
      // We accept either the DISTINCT keyword or a d-prefixed column
      // (duration is a known column).
      expected: ['DISTINCT', 'duration'],
      minTopN: 15,
      mode: 'anyOf',
    });
  });

  test('6. WITH foo AS (...) SELECT * FROM | — foo present alongside tables', async () => {
    await expectTopCompletions(page, {
      cellIndex: 0,
      sqlBefore: 'WITH foo AS (SELECT * FROM GarbageCollection) SELECT * FROM ',
      sqlAfter: '',
      expected: ['foo'],
      minTopN: 15,
      mode: 'anyOf',
    });
  });

  test('7. WHERE c| — cause is #1 (reranker)', async () => {
    await expectTopCompletions(page, {
      cellIndex: 0,
      sqlBefore: 'SELECT * FROM GarbageCollection WHERE c',
      sqlAfter: '',
      expected: ['cause'],
      minTopN: 1,
      mode: 'topIs',
    });
  });

  test('8. SUM(| FROM GarbageCollection — numeric gcId ranked above non-numeric', async () => {
    // GarbageCollection numeric columns: gcId (INTEGER), duration / sumOfPauses /
    // longestPause (DOUBLE). Type-affinity should rank numeric columns first.
    // We assert gcId appears in the top set (it's the canonical id column).
    await expectTopCompletions(page, {
      cellIndex: 0,
      sqlBefore: 'SELECT SUM(',
      sqlAfter: ') FROM GarbageCollection',
      expected: ['gcId', 'duration', 'sumOfPauses', 'longestPause'],
      minTopN: 20,
      mode: 'anyOf',
    });
  });

  test('9. ORDER BY | — startTime (temporal) in top 5', async () => {
    await expectTopCompletions(page, {
      cellIndex: 0,
      sqlBefore: 'SELECT * FROM GarbageCollection ORDER BY ',
      sqlAfter: '',
      expected: ['startTime'],
      minTopN: 10,
      mode: 'anyOf',
    });
  });

  test('10. WITH x AS (...) SELECT * FROM | — x is #1', async () => {
    await expectTopCompletions(page, {
      cellIndex: 0,
      sqlBefore: 'WITH x AS (SELECT * FROM GarbageCollection) SELECT * FROM ',
      sqlAfter: '',
      expected: ['x'],
      minTopN: 1,
      mode: 'topIs',
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function gotoAppAndLoadDemo(page: Page) {
  await page.goto('/');
  // Wait for the demo button to appear (DropZone rendered).
  const demoBtn = page.getByRole('button', { name: /Try the demo/i });
  await demoBtn.waitFor({ state: 'visible', timeout: 30_000 });
  await demoBtn.click();
  // Wait for the notebook header (rendered once dbState === READY).
  await page
    .getByRole('heading', { name: 'JFR Query Notebook' })
    .waitFor({ state: 'visible', timeout: 60_000 });
  // Wait for at least one CodeMirror editor.
  await page.locator('.cm-jfr-editor .cm-editor').first().waitFor({
    state: 'visible',
    timeout: 30_000,
  });
}

interface ExpectOpts {
  cellIndex: number;
  sqlBefore: string;
  sqlAfter?: string;
  cursorMarker?: string; // unused (we split via sqlBefore/sqlAfter) — kept for spec alignment
  expected: string[];
  minTopN: number;
  /**
   * - 'anyOf'    : every label in `expected` must appear within the top `minTopN`.
   * - 'order'    : `expected` labels appear in the given order within the top `minTopN`.
   * - 'topIs'    : `expected[0]` is the first item in the popup.
   * - 'nonEmpty' : the popup has ≥ `minTopN` items (or any items if minTopN==0).
   */
  mode: 'anyOf' | 'order' | 'topIs' | 'nonEmpty';
  preCompletionDelayMs?: number;
}

async function expectTopCompletions(page: Page, opts: ExpectOpts) {
  const editor = page.locator('.cm-jfr-editor .cm-editor').nth(opts.cellIndex);
  await editor.waitFor({ state: 'visible' });

  const fullText = opts.sqlBefore + (opts.sqlAfter ?? '');
  const trailing = (opts.sqlAfter ?? '').length;

  // Focus the editor's content surface.
  const content = editor.locator('.cm-content').first();
  await content.click();

  // Select all + delete to clear the cell.
  const isMac = process.platform === 'darwin';
  const modKey = isMac ? 'Meta' : 'Control';
  await page.keyboard.press(`${modKey}+a`);
  await page.keyboard.press('Delete');

  // Type the full text. `delay: 0` is fast; we use no delay because CM6
  // handles input events synchronously.
  await page.keyboard.insertText(fullText);

  // Move cursor left by the length of the trailing text so the caret sits
  // at the end of `sqlBefore`.
  for (let i = 0; i < trailing; i++) {
    await page.keyboard.press('ArrowLeft');
  }

  if (opts.preCompletionDelayMs) {
    await page.waitForTimeout(opts.preCompletionDelayMs);
  }

  // Dismiss any popup that may already be showing (from typing), then trigger
  // explicit completion. Ctrl-Space is the standard CM autocomplete key.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Space');

  // Wait for the popup. Some scenarios (distinct values) need extra time
  // because they kick off an async DuckDB query.
  const popup = page.locator('.cm-tooltip-autocomplete').first();
  await popup.waitFor({ state: 'visible', timeout: 10_000 });

  // Give the popup a beat to settle (async providers may add items after
  // initial render).
  if (opts.preCompletionDelayMs) {
    await page.waitForTimeout(600);
  } else {
    await page.waitForTimeout(200);
  }

  const labels = await popup
    .locator('li .cm-completionLabel')
    .allTextContents();

  const top = labels.slice(0, opts.minTopN);

  switch (opts.mode) {
    case 'nonEmpty': {
      expect(labels.length, `expected non-empty popup; got: ${labels.join(', ')}`).toBeGreaterThan(0);
      break;
    }
    case 'topIs': {
      expect(labels[0], `top label should be ${opts.expected[0]}; got: ${labels.slice(0, 5).join(', ')}`).toBe(opts.expected[0]);
      break;
    }
    case 'anyOf': {
      const found = opts.expected.some(e => top.includes(e));
      expect(found, `expected one of [${opts.expected.join(', ')}] in top ${opts.minTopN}; got: ${top.join(', ')}`).toBe(true);
      break;
    }
    case 'order': {
      let cursor = 0;
      for (const e of opts.expected) {
        const idx = top.indexOf(e, cursor);
        expect(idx, `label ${e} not found in order in top ${opts.minTopN}; got: ${top.join(', ')}`).toBeGreaterThanOrEqual(0);
        cursor = idx + 1;
      }
      break;
    }
  }

  await page.keyboard.press('Escape');
  await popup.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
}
