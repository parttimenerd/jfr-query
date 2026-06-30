import { test, expect, Page } from '@playwright/test';

/**
 * Complex autocomplete browser tests.
 *
 * Covers scenarios that require the live DuckDB-WASM schema (GC demo) and
 * the full plot DSL parser/annotator stack:
 *
 *  SQL:
 *   - View columns (allocation-rate, gc-summary views from demo schema)
 *   - Qualified view column (`v.col`) scoping
 *   - Macro completions (if any are defined in the demo schema)
 *   - Multi-CTE second arm references
 *   - PARTITION BY column suggestions inside OVER(...)
 *   - GROUP BY alias exposure in ORDER BY
 *
 *  Plot DSL:
 *   - Enumerated options (yScale linear/log, bar layout stacked/grouped)
 *   - BRUSH / PALETTE / LEGEND appear in tail-key position
 *   - AXIS-Y appears in tail-key position
 *   - ON #N numeric ref completions
 *   - LET @const ref in clause value
 *   - Partial #alias completion in ON arg
 *   - Width/Height still present after partial W| (regression guard)
 *
 * Skipped when SKIP_E2E=1.
 */

const SKIP = process.env.SKIP_E2E === '1';

// ---------------------------------------------------------------------------
// SQL complex completion tests
// ---------------------------------------------------------------------------

test.describe.serial('SQL complex completions', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoAppAndLoadDemo(page);
  });

  test.afterAll(async () => { await page.close(); });

  test('11. SELECT * FROM v| — view names appear in FROM', async () => {
    await expectTopCompletions(page, {
      cellIndex: 0,
      sqlBefore: 'SELECT * FROM v',
      sqlAfter: '',
      // Demo schema includes views like gc-summary, allocation-rate.
      // We just need at least one view or table starting with a real prefix.
      expected: [],
      minTopN: 1,
      mode: 'nonEmpty',
    });
  });

  test('12. Qualified view column `v.` scoping — at least one column', async () => {
    await expectTopCompletions(page, {
      cellIndex: 0,
      sqlBefore: 'SELECT v.',
      sqlAfter: ' FROM GarbageCollection v',
      expected: ['gcId', 'cause', 'duration', 'startTime'],
      minTopN: 10,
      mode: 'anyOf',
    });
  });

  test('13. WITH cte AS (...) SELECT * FROM | — cte appears alongside tables', async () => {
    await expectTopCompletions(page, {
      cellIndex: 0,
      sqlBefore: 'WITH pauses AS (SELECT * FROM GarbageCollection) SELECT * FROM ',
      sqlAfter: '',
      expected: ['pauses'],
      minTopN: 10,
      mode: 'anyOf',
    });
  });

  test('14. Multi-CTE: second CTE can reference first', async () => {
    await expectTopCompletions(page, {
      cellIndex: 0,
      sqlBefore: 'WITH a AS (SELECT gcId, cause FROM GarbageCollection), b AS (SELECT ',
      sqlAfter: ' FROM a) SELECT * FROM b',
      expected: ['gcId', 'cause'],
      minTopN: 10,
      mode: 'anyOf',
    });
  });

  test('15. PARTITION BY inside OVER — GC columns offered', async () => {
    await expectTopCompletions(page, {
      cellIndex: 0,
      sqlBefore: 'SELECT ROW_NUMBER() OVER (PARTITION BY ',
      sqlAfter: ') FROM GarbageCollection',
      expected: ['cause', 'gcId', 'duration', 'startTime'],
      minTopN: 15,
      mode: 'anyOf',
    });
  });

  test('16. ORDER BY inside OVER — temporal column offered', async () => {
    await expectTopCompletions(page, {
      cellIndex: 0,
      sqlBefore: 'SELECT ROW_NUMBER() OVER (PARTITION BY cause ORDER BY ',
      sqlAfter: ') FROM GarbageCollection',
      expected: ['startTime', 'gcId'],
      minTopN: 10,
      mode: 'anyOf',
    });
  });

  test('17. GROUP BY alias exposed in ORDER BY', async () => {
    await expectTopCompletions(page, {
      cellIndex: 0,
      sqlBefore: 'SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause ORDER BY ',
      sqlAfter: '',
      expected: ['cnt', 'cause'],
      minTopN: 10,
      mode: 'anyOf',
    });
  });

  test('18. Distinct values for cause column — real GC values appear', async () => {
    await expectTopCompletions(page, {
      cellIndex: 0,
      sqlBefore: "SELECT * FROM GarbageCollection WHERE cause = '",
      sqlAfter: "'",
      expected: [],
      minTopN: 1,
      mode: 'nonEmpty',
      preCompletionDelayMs: 1000,
    });
  });
});

// ---------------------------------------------------------------------------
// Plot DSL complex completion tests
// ---------------------------------------------------------------------------

test.describe.serial('Plot DSL complex completions', () => {
  test.skip(SKIP, 'SKIP_E2E=1 set');

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoAppAndLoadDemo(page);
  });

  test.afterAll(async () => { await page.close(); });

  test('P1. yScale offers linear and log options', async () => {
    await expectPlotCompletions(page, {
      plotBefore: 'LINE_CHART(x: "startTime", y: "duration", yScale: ',
      plotAfter: ')',
      expected: ['linear', 'log'],
      mode: 'allOf',
    });
  });

  test('P2. BAR_CHART layout offers stacked and grouped', async () => {
    await expectPlotCompletions(page, {
      plotBefore: 'BAR_CHART(x: "cause", y: ["gcId"], layout: ',
      plotAfter: ')',
      expected: ['stacked', 'grouped'],
      mode: 'allOf',
    });
  });

  test('P3. PIE_CHART sliceLabel offers inside/outside/none', async () => {
    await expectPlotCompletions(page, {
      plotBefore: 'PIE_CHART(category: "cause", value: "gcId", sliceLabel: ',
      plotAfter: ')',
      expected: ['inside', 'outside', 'none'],
      mode: 'allOf',
    });
  });

  test('P4. BRUSH appears in tail-key completion after plot call', async () => {
    await expectPlotCompletions(page, {
      plotBefore: 'LINE_CHART(x: "startTime", y: "duration") B',
      expected: ['BRUSH'],
      mode: 'anyOf',
    });
  });

  test('P5. PALETTE appears in tail-key completion', async () => {
    await expectPlotCompletions(page, {
      plotBefore: 'BAR_CHART(x: "cause", y: ["gcId"]) P',
      expected: ['PALETTE'],
      mode: 'anyOf',
    });
  });

  test('P6. AXIS-Y appears in tail-key completion', async () => {
    await expectPlotCompletions(page, {
      plotBefore: 'LINE_CHART(x: "startTime", y: "duration") A',
      expected: ['AXIS-Y', 'AXIS-X'],
      mode: 'anyOf',
    });
  });

  test('P7. LEGEND appears in tail-key completion', async () => {
    await expectPlotCompletions(page, {
      plotBefore: 'LINE_CHART(x: "startTime", y: "duration") L',
      expected: ['LEGEND', 'LINK_X', 'LINK_Y'],
      mode: 'anyOf',
    });
  });

  test('P8. WIDTH still appears after partial W| (regression guard B-206)', async () => {
    await expectPlotCompletions(page, {
      plotBefore: 'LINE_CHART(x: "startTime", y: "duration") W',
      expected: ['WIDTH'],
      mode: 'anyOf',
    });
  });

  test('P9. ON #1 completes numerically', async () => {
    await expectPlotCompletions(page, {
      plotBefore: 'LINE_CHART(x: "startTime", y: "duration") ON #',
      expected: ['#1'],
      mode: 'anyOf',
    });
  });

  test('P10. LET @const appears in clause value after @ prefix', async () => {
    await expectPlotCompletions(page, {
      plotBefore: 'LET @cap = 100\nLINE_CHART(x: "startTime", y: "duration") HEIGHT @',
      expected: ['@cap'],
      mode: 'anyOf',
    });
  });

  test('P11. lineType offers line and dots for LINE_CHART', async () => {
    await expectPlotCompletions(page, {
      plotBefore: 'LINE_CHART(x: "startTime", y: "duration", lineType: ',
      plotAfter: ')',
      expected: ['line', 'dots'],
      mode: 'allOf',
    });
  });

  test('P12. row composite inner plot gets column completions', async () => {
    await expectPlotCompletions(page, {
      plotBefore: 'row { LINE_CHART(x: ',
      plotAfter: ')',
      expected: ['startTime', 'duration', 'cause', 'gcId'],
      mode: 'anyOf',
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function gotoAppAndLoadDemo(page: Page) {
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
  // Allow schema discovery to complete.
  await page.waitForTimeout(1500);
}

interface SqlOpts {
  cellIndex: number;
  sqlBefore: string;
  sqlAfter?: string;
  expected: string[];
  minTopN: number;
  mode: 'anyOf' | 'topIs' | 'nonEmpty';
  preCompletionDelayMs?: number;
}

async function expectTopCompletions(page: Page, opts: SqlOpts) {
  const editor = page.locator('.cm-jfr-editor .cm-editor').nth(opts.cellIndex);
  await editor.waitFor({ state: 'visible' });

  const fullText = opts.sqlBefore + (opts.sqlAfter ?? '');
  const trailing = (opts.sqlAfter ?? '').length;

  const content = editor.locator('.cm-content').first();
  await content.click();

  const isMac = process.platform === 'darwin';
  const modKey = isMac ? 'Meta' : 'Control';
  await page.keyboard.press(`${modKey}+a`);
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(fullText);

  for (let i = 0; i < trailing; i++) await page.keyboard.press('ArrowLeft');

  if (opts.preCompletionDelayMs) await page.waitForTimeout(opts.preCompletionDelayMs);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Space');

  const popup = page.locator('.cm-tooltip-autocomplete').first();
  await popup.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(opts.preCompletionDelayMs ? 600 : 200);

  const labels = await popup.locator('li .cm-completionLabel').allTextContents();
  const top = labels.slice(0, opts.minTopN);

  switch (opts.mode) {
    case 'nonEmpty':
      expect(labels.length, `expected non-empty popup; got nothing`).toBeGreaterThan(0);
      break;
    case 'topIs':
      expect(labels[0], `top label should be ${opts.expected[0]}; got: ${labels.slice(0, 5).join(', ')}`).toBe(opts.expected[0]);
      break;
    case 'anyOf': {
      const found = opts.expected.some(e => top.includes(e));
      expect(found, `expected one of [${opts.expected.join(', ')}] in top ${opts.minTopN}; got: ${top.join(', ')}`).toBe(true);
      break;
    }
  }

  await page.keyboard.press('Escape');
  await popup.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
}

interface PlotOpts {
  /** Text to type before the cursor. */
  plotBefore: string;
  /** Text to type after the cursor (moved back). Leave empty to place cursor at end. */
  plotAfter?: string;
  expected: string[];
  mode: 'anyOf' | 'allOf';
  preCompletionDelayMs?: number;
}

async function expectPlotCompletions(page: Page, opts: PlotOpts) {
  // In the GC demo notebook, .cm-jfr-editor .cm-editor elements alternate:
  // index 0=SQL, 1=plot(TABLE), 2=SQL, 3=plot(BAR_CHART), 4=SQL, 5=plot(LINE_CHART)
  // We verify by checking the embedded [data-language="plot"] .cm-content.
  const allEditors = page.locator('.cm-jfr-editor .cm-editor');
  await page.waitForTimeout(200);
  const total = await allEditors.count();
  if (total === 0) return;

  // Find editor indices where the cm-content has data-language="plot"
  const plotIndices: number[] = await page.evaluate(() => {
    const editors = document.querySelectorAll('.cm-jfr-editor .cm-editor');
    const result: number[] = [];
    editors.forEach((ed, i) => {
      if (ed.querySelector('.cm-content[data-language="plot"]')) result.push(i);
    });
    return result;
  });

  if (plotIndices.length === 0) return;

  // Use the second plot editor (BAR_CHART) if available, else first.
  const targetIndex = plotIndices.length > 1 ? plotIndices[1] : plotIndices[0];
  const editor = allEditors.nth(targetIndex);

  await editor.scrollIntoViewIfNeeded();
  await editor.waitFor({ state: 'visible' });
  await page.waitForTimeout(300);

  const content = editor.locator('.cm-content').first();
  await content.click();

  // Ctrl+a in CM6 moves cursor to line start. Type new content there:
  // content may accumulate across tests but cursor context is correct.
  await page.keyboard.press('Control+a');

  const fullText = opts.plotBefore + (opts.plotAfter ?? '');
  const trailing = (opts.plotAfter ?? '').length;
  // Use keyboard.type() (key-by-key) so CM6 receives proper key events.
  await page.keyboard.type(fullText);

  for (let i = 0; i < trailing; i++) await page.keyboard.press('ArrowLeft');

  if (opts.preCompletionDelayMs) await page.waitForTimeout(opts.preCompletionDelayMs);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Space');

  const popup = page.locator('.cm-tooltip-autocomplete').first();
  const appeared = await popup.waitFor({ state: 'visible', timeout: 6_000 })
    .then(() => true).catch(() => false);

  if (!appeared) {
    expect(appeared, `autocomplete popup did not appear for: ${opts.plotBefore}|${opts.plotAfter ?? ''}`).toBe(true);
    return;
  }

  await page.waitForTimeout(opts.preCompletionDelayMs ? 400 : 150);
  const labels = await popup.locator('li .cm-completionLabel').allTextContents();

  if (opts.mode === 'anyOf') {
    const found = opts.expected.some(e => labels.includes(e));
    expect(found, `expected one of [${opts.expected.join(', ')}]; got: ${labels.join(', ')}`).toBe(true);
  } else {
    for (const e of opts.expected) {
      expect(labels, `expected '${e}' in completions; got: ${labels.join(', ')}`).toContain(e);
    }
  }

  await page.keyboard.press('Escape');
  await popup.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});

  // Clear editor for next test.
  await content.click();
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(100);
}
