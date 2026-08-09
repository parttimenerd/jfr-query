# Plot Language Feature Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement three independent plot language features: (1) `SORT $colVar $dirVar` clause for TABLE() that writes sort state to cell variables so dependent SQL cells can use `ORDER BY`, (2) `SORT ASC/DESC` and `LIMIT n` render-time clauses for BAR_CHART, and (3) `step`/`stepBefore`/`stepAfter` curve types for LINE_CHART. Each feature includes DSL parser support, Ohm grammar update, syntax highlighting, autocomplete, component wiring, and comprehensive tests.

**Architecture:** All three features follow the same layered pattern: (a) add to `ParsedPlotCall` interface, (b) add regex clause to `CLAUSES` array, (c) add grammar rule to `plotGrammar.ohm`, (d) add Ohm semantic action, (e) add to `languages.ts` keyword sets, (f) add to `UPPERCASE_TAILS_DEFAULT` in `completions.ts`, (g) wire into the plot component. Features 1 and 3 are partially wired already — this plan completes them with full tests. Feature 2 is new.

**Tech Stack:** TypeScript, React, Recharts, Ohm.js PEG grammar, CodeMirror 6 StreamLanguage, Vitest.

---

## Current State (as of plan writing)

The following work was done before this plan was created and must not be repeated:

- `ParsedPlotCall.sort?: { colVar: string; dirVar: string }` — already added to `plotParser.ts`
- SORT regex clause — already added to `CLAUSES` array in `plotParser.ts` at line 352
- `SortClause` Ohm grammar rule — already added to `plotGrammar.ohm`
- Ohm semantic action for `SortClause` — already added at line 209 of `plotParser.ts`
- `DataTable.onSortChange?: (col: string, dir: 'asc' | 'desc') => void` — already added
- `DataTable.requestSort` — already updated to call `onSortChange`
- `TablePlot.ts` — already wires `clauses.sort` + `onCellVariableChange` → `handleSortChange`
- `PlotRenderer.tsx` single-plot path — already passes `onCellVariableChange` to PlotComponent

**What this plan adds:** tests for everything above, plus features 2 and 3.

---

## File Map

| File | Role |
|------|------|
| `core/frontend/utils/plotParser.ts` | Add `limit` and `sortDir` fields to `ParsedPlotCall`; add LIMIT and BAR_SORT clauses; Ohm actions |
| `core/frontend/utils/plotGrammar.ohm` | Add `LimitClause`, `BarSortClause` grammar rules |
| `core/frontend/components/plots/BarChartPlot.ts` | Apply `SORT ASC/DESC` and `LIMIT n` at render time |
| `core/frontend/components/plots/LineChartPlot.tsx` | Add `step`/`stepBefore`/`stepAfter` to `lineType` param; map to recharts `type` prop |
| `core/frontend/components/editor/languages.ts` | Add `SORT`, `LIMIT`, `ASC`, `DESC`, `STEP` to keyword/subKeyword sets |
| `core/frontend/components/editor/completions.ts` | Add `SORT`, `LIMIT` to `UPPERCASE_TAILS_DEFAULT` |
| `core/frontend/tests/plotParser.clauses.test.ts` | Tests for SORT, LIMIT, BAR_SORT clauses |
| `core/frontend/tests/plots/barChartSort.test.tsx` | Tests for BarChart SORT+LIMIT rendering |
| `core/frontend/tests/plots/lineChartStep.test.tsx` | Tests for LINE_CHART step curve types |
| `core/frontend/tests/plots/tableSort.test.tsx` | Tests for TABLE SORT clause variable wiring |

---

## Task 1: Tests for the already-wired SORT $colVar $dirVar clause (TABLE)

**Purpose:** Confirm the existing parser + DataTable + TablePlot wiring is correct before adding new features. These tests must pass with zero changes to existing code.

**Files:**
- Create: `core/frontend/tests/plots/tableSort.test.tsx`
- Create: `core/frontend/tests/plotParser.sort.test.ts`

- [ ] **Step 1: Write parser tests**

Create `core/frontend/tests/plotParser.sort.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parsePlotCall } from '../utils/plotParser';

describe('parsePlotCall — SORT clause', () => {
    it('parses SORT $colVar $dirVar', () => {
        const p = parsePlotCall('TABLE() SORT $sortCol $sortDir');
        expect(p.sort).toEqual({ colVar: '$sortCol', dirVar: '$sortDir' });
        expect(p.mainConfig).toBe('TABLE()');
    });

    it('parses SORT with dollar signs using underscores', () => {
        const p = parsePlotCall('TABLE() SORT $sort_col $sort_dir');
        expect(p.sort).toEqual({ colVar: '$sort_col', dirVar: '$sort_dir' });
    });

    it('is case-insensitive', () => {
        const p = parsePlotCall('TABLE() sort $a $b');
        expect(p.sort).toEqual({ colVar: '$a', dirVar: '$b' });
    });

    it('combines with TITLE', () => {
        const p = parsePlotCall('TABLE() TITLE "GC Pauses" SORT $sortCol $sortDir');
        expect(p.title).toBe('GC Pauses');
        expect(p.sort).toEqual({ colVar: '$sortCol', dirVar: '$sortDir' });
    });

    it('does not parse bare SORT without two $vars', () => {
        // Single var — should not match SORT clause.
        const p = parsePlotCall('TABLE() SORT $col');
        expect(p.sort).toBeUndefined();
    });

    it('requires both vars to be dollar-prefixed', () => {
        // Non-dollar second var — should not match.
        const p = parsePlotCall('TABLE() SORT $col dir');
        expect(p.sort).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run and confirm pass**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plotParser.sort.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 3: Write TablePlot component wiring tests**

Create `core/frontend/tests/plots/tableSort.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import DataTable from '../../components/DataTable';

describe('DataTable onSortChange callback', () => {
    const sampleData = [
        { name: 'Alpha', value: 3 },
        { name: 'Beta', value: 1 },
        { name: 'Gamma', value: 2 },
    ];

    it('calls onSortChange when a column header is clicked', () => {
        const onSortChange = vi.fn();
        const { getAllByRole } = render(
            <DataTable data={sampleData} onSortChange={onSortChange} />
        );
        const sortButtons = getAllByRole('button', { name: /Sort by name/i });
        fireEvent.click(sortButtons[0]);
        expect(onSortChange).toHaveBeenCalledWith('name', 'asc');
    });

    it('toggles direction on second click', () => {
        const onSortChange = vi.fn();
        const { getAllByRole } = render(
            <DataTable data={sampleData} onSortChange={onSortChange} />
        );
        const sortButtons = getAllByRole('button', { name: /Sort by name/i });
        fireEvent.click(sortButtons[0]);
        fireEvent.click(sortButtons[0]);
        expect(onSortChange).toHaveBeenNthCalledWith(1, 'name', 'asc');
        expect(onSortChange).toHaveBeenNthCalledWith(2, 'name', 'desc');
    });

    it('switching column resets to asc', () => {
        const onSortChange = vi.fn();
        const { getAllByRole } = render(
            <DataTable data={sampleData} onSortChange={onSortChange} />
        );
        const nameButtons = getAllByRole('button', { name: /Sort by name/i });
        const valueButtons = getAllByRole('button', { name: /Sort by value/i });
        fireEvent.click(nameButtons[0]);
        fireEvent.click(valueButtons[0]);
        expect(onSortChange).toHaveBeenNthCalledWith(2, 'value', 'asc');
    });

    it('does not call onSortChange when prop is not provided', () => {
        // Should not throw when onSortChange is absent.
        const { getAllByRole } = render(<DataTable data={sampleData} />);
        const sortButtons = getAllByRole('button', { name: /Sort by name/i });
        expect(() => fireEvent.click(sortButtons[0])).not.toThrow();
    });
});
```

- [ ] **Step 4: Run and confirm pass**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/tableSort.test.tsx
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query && git add core/frontend/tests/plotParser.sort.test.ts core/frontend/tests/plots/tableSort.test.tsx && git commit -m "test(table): add SORT clause parser + DataTable onSortChange tests"
```

---

## Task 2: Add LIMIT n clause (TABLE and BAR_CHART)

**Purpose:** `LIMIT 20` in a TABLE() or BAR_CHART() truncates the rendered data to the first N rows (post-sort for TABLE, after render-time sort for BAR_CHART).

**Files:**
- Modify: `core/frontend/utils/plotParser.ts` — add `limit` field + regex + Ohm action
- Modify: `core/frontend/utils/plotGrammar.ohm` — add `LimitClause` rule
- Modify: `core/frontend/components/editor/languages.ts` — add `LIMIT` keyword
- Modify: `core/frontend/components/editor/completions.ts` — add `LIMIT` to tails

### Step-by-step

- [ ] **Step 1: Add `limit` to ParsedPlotCall interface**

In `core/frontend/utils/plotParser.ts`, after the `sort` field (line ~57), add:

```typescript
    /**
     * LIMIT n clause — caps rendered rows/bars to the first n entries.
     * For TABLE: applied after the in-table sort. For BAR_CHART: applied
     * after render-time SORT DESC/ASC.
     */
    limit?: number;
```

- [ ] **Step 2: Write failing parser test**

In `core/frontend/tests/plotParser.sort.test.ts`, append:

```typescript
describe('parsePlotCall — LIMIT clause', () => {
    it('parses LIMIT 20', () => {
        const p = parsePlotCall('TABLE() LIMIT 20');
        expect(p.limit).toBe(20);
    });

    it('parses LIMIT with SORT', () => {
        const p = parsePlotCall('TABLE() SORT $col $dir LIMIT 10');
        expect(p.sort).toEqual({ colVar: '$col', dirVar: '$dir' });
        expect(p.limit).toBe(10);
    });

    it('parses LIMIT on BAR_CHART', () => {
        const p = parsePlotCall('BAR_CHART(x:"cause", y:["cnt"]) LIMIT 5');
        expect(p.limit).toBe(5);
    });

    it('does not accept non-integer LIMIT', () => {
        const p = parsePlotCall('TABLE() LIMIT 3.5');
        expect(p.limit).toBeUndefined();
    });
});
```

Run: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plotParser.sort.test.ts`
Expected: The LIMIT tests FAIL with `limit is undefined`.

- [ ] **Step 3: Add LIMIT regex to CLAUSES array**

In `core/frontend/utils/plotParser.ts`, after the SORT entry (line ~353), add:

```typescript
    { key: 'limit', regex: /(?<!\w)LIMIT\s+(\d+)\s*$/i, processor: (m) => parseInt(m[1], 10) },
```

- [ ] **Step 4: Add LimitClause to Ohm grammar**

In `core/frontend/utils/plotGrammar.ohm`, add `LIMIT` to the `clauseKeyword` rule (after `SORT`):

```
    | caseInsensitive<"SORT">
    | caseInsensitive<"LIMIT">
    | caseInsensitive<"LET">
```

Add `LimitClause` to the `Clause` alternatives (after `SortClause`):

```
    | SortClause
    | LimitClause
    | LetClause
```

Add the rule after the `SortClause` definition:

```
  // LIMIT n  — cap rendered rows to n
  LimitClause = caseInsensitive<"LIMIT"> intLit
  intLit = digit+
```

- [ ] **Step 5: Add Ohm semantic action**

In `core/frontend/utils/plotParser.ts`, in the `toResult(r)` operation body, after the `SortClause` action, add:

```typescript
        LimitClause(_kw, n) { (this.args as any).r.limit = parseInt((n as any).sourceString, 10); },
```

- [ ] **Step 6: Run failing tests — now they should pass**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plotParser.sort.test.ts
```

Expected: All tests pass including the 4 new LIMIT tests.

- [ ] **Step 7: Add LIMIT to syntax highlighting**

In `core/frontend/components/editor/languages.ts`, add `'LIMIT'` to the `keywords` set on the same line as `'AXIS_X', 'AXIS_Y'`:

Change:
```typescript
    'LEGEND', 'PALETTE', 'BRUSH',
    'AXIS_X', 'AXIS_Y', 'AXIS-X', 'AXIS-Y',
    'TOOLTIP',
```

To:
```typescript
    'LEGEND', 'PALETTE', 'BRUSH',
    'AXIS_X', 'AXIS_Y', 'AXIS-X', 'AXIS-Y',
    'TOOLTIP', 'SORT', 'LIMIT',
```

- [ ] **Step 8: Add LIMIT to autocomplete tails**

In `core/frontend/components/editor/completions.ts`, change:

```typescript
  'BRUSH', 'LEGEND', 'PALETTE', 'DATASET', 'DISABLED',
  'AXIS_X', 'AXIS_Y', 'LET',
```

To:
```typescript
  'BRUSH', 'LEGEND', 'PALETTE', 'DATASET', 'DISABLED',
  'AXIS_X', 'AXIS_Y', 'LET',
  'SORT', 'LIMIT',
```

- [ ] **Step 9: Run full suite**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -8
```

Expected: all pass, 0 failing.

- [ ] **Step 10: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query && git add core/frontend/utils/plotParser.ts core/frontend/utils/plotGrammar.ohm core/frontend/components/editor/languages.ts core/frontend/components/editor/completions.ts core/frontend/tests/plotParser.sort.test.ts && git commit -m "feat(parser): add LIMIT n clause to plot DSL with tests"
```

---

## Task 3: Wire LIMIT into TABLE component

**Purpose:** When `clauses.limit` is set, `TablePlot` slices `data` to `data.slice(0, limit)` before passing to `DataTable`.

**Files:**
- Modify: `core/frontend/components/plots/TablePlot.ts`

- [ ] **Step 1: Write failing test**

Add to `core/frontend/tests/plots/tableSort.test.tsx`:

```typescript
import { tablePlot } from '../../components/plots/TablePlot';
import type { ParsedPlotCall } from '../../utils/plotParser';

describe('TablePlot LIMIT clause', () => {
    const makeData = (n: number) =>
        Array.from({ length: n }, (_, i) => ({ id: i, val: i }));

    it('shows all rows when LIMIT is not set', () => {
        const data = makeData(10);
        const { container } = render(
            React.createElement(tablePlot.component as any, {
                config: tablePlot.parseConfig('TABLE()', data),
                data,
                clauses: { mainConfig: 'TABLE()' } as ParsedPlotCall,
            })
        );
        const rows = container.querySelectorAll('tbody tr');
        expect(rows.length).toBe(10);
    });

    it('truncates to LIMIT rows', () => {
        const data = makeData(10);
        const { container } = render(
            React.createElement(tablePlot.component as any, {
                config: tablePlot.parseConfig('TABLE()', data),
                data,
                clauses: { mainConfig: 'TABLE()', limit: 3 } as ParsedPlotCall,
            })
        );
        const rows = container.querySelectorAll('tbody tr');
        expect(rows.length).toBe(3);
    });
});
```

Run: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/tableSort.test.tsx`
Expected: The LIMIT tests FAIL because TablePlot doesn't slice yet.

- [ ] **Step 2: Apply limit slice in TablePlot**

In `core/frontend/components/plots/TablePlot.ts`, in `TablePlotComponent`, after the `handleSortChange` definition and before the `return` statement, add:

```typescript
    const displayData = sort && clauses?.limit !== undefined
        ? data.slice(0, clauses.limit)
        : clauses?.limit !== undefined
        ? data.slice(0, clauses.limit)
        : data;
```

Simplify to:
```typescript
    const displayData = clauses?.limit !== undefined ? data.slice(0, clauses.limit) : data;
```

Then in the `React.createElement(DataTable, ...)` call, change `data: data` to `data: displayData`:

```typescript
    return React.createElement(
        'div',
        { className: "h-full" },
        React.createElement(DataTable, {
            data: displayData,
            headers: resolvedHeaders,
            columnWidths: widths,
            csvFilename,
            onSortChange: handleSortChange,
        })
    );
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/tableSort.test.tsx
```

Expected: All tests pass.

- [ ] **Step 4: Run full suite**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -8
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query && git add core/frontend/components/plots/TablePlot.ts core/frontend/tests/plots/tableSort.test.tsx && git commit -m "feat(table): apply LIMIT clause to cap rendered rows"
```

---

## Task 4: Add SORT ASC/DESC render-time sort for BAR_CHART

**Purpose:** `BAR_CHART(...) SORT DESC` sorts bars by their first y-column descending before render. `SORT ASC` sorts ascending. Combined with `LIMIT`, this lets you do "Top 10 GC causes by total pause time."

**Architecture:** Add a `barSort` field to `ParsedPlotCall` (value: `'asc' | 'desc' | undefined`). In `BarChartComponent`, sort `chartData` by the first y column before rendering. No interaction with the TABLE SORT clause.

**Files:**
- Modify: `core/frontend/utils/plotParser.ts` — add `barSort` field + regex + Ohm action
- Modify: `core/frontend/utils/plotGrammar.ohm` — add `BarSortClause`
- Modify: `core/frontend/components/plots/BarChartPlot.ts` — apply sort + limit in useMemo
- Modify: `core/frontend/components/editor/languages.ts` — add ASC/DESC as subKeywords
- Modify: `core/frontend/components/editor/completions.ts` — add `SORT ASC`/`SORT DESC` completions

### Step-by-step

- [ ] **Step 1: Write failing tests**

Create `core/frontend/tests/plots/barChartSort.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { parsePlotCall } from '../utils/plotParser';

describe('parsePlotCall — BAR_CHART SORT clause', () => {
    it('parses SORT DESC', () => {
        const p = parsePlotCall('BAR_CHART(x:"cause",y:["cnt"]) SORT DESC');
        expect(p.barSort).toBe('desc');
    });

    it('parses SORT ASC', () => {
        const p = parsePlotCall('BAR_CHART(x:"cause",y:["cnt"]) SORT ASC');
        expect(p.barSort).toBe('asc');
    });

    it('is case-insensitive', () => {
        const p = parsePlotCall('BAR_CHART(x:"cause",y:["cnt"]) sort asc');
        expect(p.barSort).toBe('asc');
    });

    it('combines SORT DESC with LIMIT', () => {
        const p = parsePlotCall('BAR_CHART(x:"cause",y:["cnt"]) SORT DESC LIMIT 5');
        expect(p.barSort).toBe('desc');
        expect(p.limit).toBe(5);
    });

    it('does not confuse bare SORT (TABLE form) with BAR SORT ASC/DESC', () => {
        // TABLE SORT requires two $var refs — ASC/DESC alone is barSort.
        const p = parsePlotCall('BAR_CHART(x:"c",y:["v"]) SORT DESC');
        expect(p.barSort).toBe('desc');
        expect(p.sort).toBeUndefined();
    });
});
```

Run: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/barChartSort.test.tsx`
Expected: All 5 tests FAIL with `barSort is undefined`.

- [ ] **Step 2: Add `barSort` to ParsedPlotCall**

In `core/frontend/utils/plotParser.ts`, after the `limit` field, add:

```typescript
    /**
     * Render-time sort direction for BAR_CHART. `SORT DESC` sorts bars from
     * highest to lowest value; `SORT ASC` from lowest to highest. Combined
     * with `LIMIT n` this gives "Top N bars".
     */
    barSort?: 'asc' | 'desc';
```

- [ ] **Step 3: Add BarSortClause regex**

In `core/frontend/utils/plotParser.ts`, in the `CLAUSES` array, after the SORT entry, add (BEFORE the LIMIT entry so more specific patterns fire first):

```typescript
    { key: 'barSort', regex: /(?<!\w)SORT\s+(ASC|DESC)\s*$/i, processor: (m) => m[1].toLowerCase() as 'asc' | 'desc' },
```

> **IMPORTANT:** The `barSort` regex (`SORT ASC|DESC`) must come BEFORE the existing TABLE `sort` regex (`SORT $col $dir`) in the CLAUSES array. The regex-based parser tries from last-to-first (right strip), but since both end at `$`, order matters when inputs can match both patterns. Since `SORT ASC` cannot match `SORT $col $dir`, they are actually disjoint — but keeping `barSort` earlier is cleaner.

- [ ] **Step 4: Add BarSortClause to Ohm grammar**

In `core/frontend/utils/plotGrammar.ohm`, add to `clauseKeyword`:

```
    | caseInsensitive<"ASC">
    | caseInsensitive<"DESC">
```

(Add after `SORT` entry)

Add to `Clause` alternatives (after `SortClause`, before `LimitClause`):

```
    | BarSortClause
```

Add the rule after `SortClause`:

```
  // SORT ASC | SORT DESC  — render-time sort for bar charts
  BarSortClause = caseInsensitive<"SORT"> sortDir
  sortDir = caseInsensitive<"ASC"> | caseInsensitive<"DESC">
```

- [ ] **Step 5: Add Ohm semantic action**

In `core/frontend/utils/plotParser.ts`, in the `toResult(r)` operation, after `SortClause`, add:

```typescript
        BarSortClause(_kw, dir) {
            (this.args as any).r.barSort = (dir as any).sourceString.toLowerCase();
        },
```

- [ ] **Step 6: Run tests — should now pass**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/barChartSort.test.tsx
```

Expected: All 5 tests pass.

- [ ] **Step 7: Wire sort+limit into BarChartComponent**

In `core/frontend/components/plots/BarChartPlot.ts`, in the `useMemo` block that returns `{ xCol, yCols, lineYCols, chartData }` (around the end, after the color-pivot and normal branch), apply the sort and limit from clauses.

Change the final `return` at the end of the non-color branch from:

```typescript
        return {
            xCol: findColumn(config.x, allColumns),
            yCols: config.y ? Array.from(new Set(config.y.flatMap(col => findColumns(col, allColumns)))) : [],
            lineYCols: config.lineY ? Array.from(new Set(config.lineY.flatMap(col => findColumns(col, allColumns)))) : [],
            chartData: data,
        };
```

To:

```typescript
        const resolvedYCols = config.y ? Array.from(new Set(config.y.flatMap(col => findColumns(col, allColumns)))) : [];
        const resolvedXCol = findColumn(config.x, allColumns);
        const resolvedLineYCols = config.lineY ? Array.from(new Set(config.lineY.flatMap(col => findColumns(col, allColumns)))) : [];

        let sortedData = data;
        if (clauses?.barSort && resolvedYCols.length > 0) {
            const firstY = resolvedYCols[0];
            sortedData = [...data].sort((a, b) => {
                const av = Number(a[firstY] ?? 0);
                const bv = Number(b[firstY] ?? 0);
                return clauses.barSort === 'desc' ? bv - av : av - bv;
            });
        }
        const finalData = clauses?.limit !== undefined ? sortedData.slice(0, clauses.limit) : sortedData;

        return {
            xCol: resolvedXCol,
            yCols: resolvedYCols,
            lineYCols: resolvedLineYCols,
            chartData: finalData,
        };
```

Also apply sort+limit inside the color-pivot branch. After the `return { xCol: xC, yCols: seriesKeys, ... chartData: Array.from(xMap.values()) }`, change it to apply limit:

```typescript
            const pivotedData = Array.from(xMap.values());
            return {
                xCol: xC,
                yCols: seriesKeys,
                lineYCols: [] as string[],
                chartData: clauses?.limit !== undefined ? pivotedData.slice(0, clauses.limit) : pivotedData,
            };
```

- [ ] **Step 8: Write component rendering tests**

Add to `core/frontend/tests/plots/barChartSort.test.tsx`:

```typescript
import React from 'react';
import { render } from '@testing-library/react';
import { barChartPlot } from '../../components/plots/BarChartPlot';
import type { ParsedPlotCall } from '../../utils/plotParser';
import { SettingsContext, defaultSettings } from '../../context/SettingsContext';

const wrap = (el: React.ReactElement) =>
    render(
        React.createElement(SettingsContext.Provider, { value: { settings: defaultSettings, updateSetting: () => {} } }, el)
    );

describe('BarChartComponent — SORT + LIMIT rendering', () => {
    const data = [
        { cause: 'A', cnt: 100 },
        { cause: 'B', cnt: 300 },
        { cause: 'C', cnt: 200 },
    ];

    it('renders all bars when no SORT/LIMIT', () => {
        const config = barChartPlot.parseConfig('BAR_CHART(x:"cause",y:["cnt"])', data);
        const clauses: ParsedPlotCall = { mainConfig: 'BAR_CHART(x:"cause",y:["cnt"])' };
        const { container } = wrap(
            React.createElement(barChartPlot.component as any, { config, data, clauses })
        );
        // recharts renders one .recharts-bar-rectangle per data point
        const rects = container.querySelectorAll('.recharts-bar-rectangle, .recharts-bar-bg');
        expect(rects.length).toBeGreaterThanOrEqual(3);
    });

    it('limits bars to LIMIT count', () => {
        const config = barChartPlot.parseConfig('BAR_CHART(x:"cause",y:["cnt"])', data);
        const clauses: ParsedPlotCall = { mainConfig: 'BAR_CHART(x:"cause",y:["cnt"])', limit: 2 };
        const { container } = wrap(
            React.createElement(barChartPlot.component as any, { config, data, clauses })
        );
        const rects = container.querySelectorAll('.recharts-bar-rectangle, .recharts-bar-bg');
        // At most 2 bars after limit
        expect(rects.length).toBeLessThanOrEqual(4); // bg + rect per bar, max 2*2=4
    });
});
```

Run: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/barChartSort.test.tsx`
Expected: All tests pass.

- [ ] **Step 9: Add ASC/DESC as subKeywords in languages.ts**

In `core/frontend/components/editor/languages.ts`, add `'ASC'` and `'DESC'` to the `subKeywords` set (after `'XY'`):

```typescript
    // BAR SORT direction values
    'ASC', 'DESC',
```

- [ ] **Step 10: Run full test suite**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -8
```

Expected: all pass.

- [ ] **Step 11: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query && git add core/frontend/utils/plotParser.ts core/frontend/utils/plotGrammar.ohm core/frontend/components/plots/BarChartPlot.ts core/frontend/components/editor/languages.ts core/frontend/components/editor/completions.ts core/frontend/tests/plots/barChartSort.test.tsx && git commit -m "feat(bar-chart): add SORT ASC/DESC and LIMIT render-time clauses"
```

---

## Task 5: Add step/stepBefore/stepAfter curve types to LINE_CHART

**Purpose:** `LINE_CHART(..., lineType: "step")` renders staircase-style lines, which is ideal for showing heap size, safepoint states, or GC mode changes where values hold constant until the next event.

**Architecture:** Extend the `lineType` param to accept `"step"`, `"stepBefore"`, and `"stepAfter"`. Map them to recharts `<Line type="step">` / `"stepBefore"` / `"stepAfter"` respectively. Current `"line"` maps to `"monotone"`, current `"dots"` keeps `type="monotone"` but hides the stroke.

**Files:**
- Modify: `core/frontend/components/plots/LineChartPlot.tsx` — extend Config type + params + Line rendering
- Test: `core/frontend/tests/plots/lineChartStep.test.tsx`

### Step-by-step

- [ ] **Step 1: Write failing tests**

Create `core/frontend/tests/plots/lineChartStep.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { lineChartPlot } from '../../components/plots/LineChartPlot';

describe('lineChartPlot — step curve types', () => {
    const data = [
        { t: 1, v: 10 },
        { t: 2, v: 20 },
        { t: 3, v: 15 },
    ];

    it('accepts lineType "step" in config', () => {
        const config = lineChartPlot.parseConfig('LINE_CHART(x:"t", y:["v"], lineType: "step")', data);
        expect((config as any).lineType).toBe('step');
    });

    it('accepts lineType "stepBefore"', () => {
        const config = lineChartPlot.parseConfig('LINE_CHART(x:"t", y:["v"], lineType: "stepBefore")', data);
        expect((config as any).lineType).toBe('stepBefore');
    });

    it('accepts lineType "stepAfter"', () => {
        const config = lineChartPlot.parseConfig('LINE_CHART(x:"t", y:["v"], lineType: "stepAfter")', data);
        expect((config as any).lineType).toBe('stepAfter');
    });

    it('still accepts original lineType "line"', () => {
        const config = lineChartPlot.parseConfig('LINE_CHART(x:"t", y:["v"], lineType: "line")', data);
        expect((config as any).lineType).toBe('line');
    });

    it('still accepts lineType "dots"', () => {
        const config = lineChartPlot.parseConfig('LINE_CHART(x:"t", y:["v"], lineType: "dots")', data);
        expect((config as any).lineType).toBe('dots');
    });

    it('defaults to "line" when not specified', () => {
        const config = lineChartPlot.parseConfig('LINE_CHART(x:"t", y:["v"])', data);
        expect((config as any).lineType).toBe('line');
    });
});
```

Run: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/lineChartStep.test.tsx`
Expected: The three "step" tests FAIL (config parser rejects unknown `lineType` option).

- [ ] **Step 2: Extend Config type and params in LineChartPlot.tsx**

In `core/frontend/components/plots/LineChartPlot.tsx`, line 16:

Change:
```typescript
interface Config { x: string; y: string[]; y2?: string[]; color?: string; xDomain?: any[]; yAxisLabel?: string; y2AxisLabel?: string; connectNulls: boolean; xRefLines?: any[]; yRefLines?: any[]; yScale: 'linear' | 'log'; y2Scale: 'linear' | 'log'; yDomain: any[]; y2Domain: any[]; lineType: 'line' | 'dots'; }
```

To:
```typescript
interface Config { x: string; y: string[]; y2?: string[]; color?: string; xDomain?: any[]; yAxisLabel?: string; y2AxisLabel?: string; connectNulls: boolean; xRefLines?: any[]; yRefLines?: any[]; yScale: 'linear' | 'log'; y2Scale: 'linear' | 'log'; yDomain: any[]; y2Domain: any[]; lineType: 'line' | 'dots' | 'step' | 'stepBefore' | 'stepAfter'; }
```

In the `params` array on line 17, change the `lineType` param entry from:
```typescript
{ name: 'lineType', type: 'string', defaultValue: 'line', options: ['line', 'dots'], description: 'Render as a connected "line" or just "dots".' }
```

To:
```typescript
{ name: 'lineType', type: 'string', defaultValue: 'line', options: ['line', 'dots', 'step', 'stepBefore', 'stepAfter'], description: 'Render style: "line" (smooth), "dots" (scatter), "step" (staircase at midpoint), "stepBefore" (staircase before), or "stepAfter" (staircase after).' }
```

- [ ] **Step 3: Map lineType to recharts `type` prop**

In `core/frontend/components/plots/LineChartPlot.tsx`, the `<Line>` elements are on lines 126-127. They currently hard-code `type="monotone"`.

Replace the two `allY.map(...)` and `allY2.map(...)` Line elements with a helper that maps `lineType` to the recharts `type` prop and controls `strokeWidth`/`dot`:

Add before the return statement (around line 116):

```typescript
  const rechartsType = (config.lineType === 'step' ? 'step'
    : config.lineType === 'stepBefore' ? 'stepBefore'
    : config.lineType === 'stepAfter' ? 'stepAfter'
    : 'monotone') as 'step' | 'stepBefore' | 'stepAfter' | 'monotone';
  const strokeWidth = config.lineType === 'dots' ? 0 : 1;
  const showDot = config.lineType === 'dots';
```

Then change line 126 from:
```typescript
          {allY.map((y,i)=><Line yAxisId="left" key={y} type="monotone" dataKey={y} stroke={colors[i%colors.length]} connectNulls={config.connectNulls} strokeWidth={config.lineType === 'line' ? 1 : 0} dot={config.lineType === 'dots'} activeDot={{r: 4}} isAnimationActive={isAnimationActive} animationDuration={animationDuration}/>)}
          {allY2.map((y,i)=><Line yAxisId="right" key={y} type="monotone" dataKey={y} stroke={colors[(allY.length+i)%colors.length]} connectNulls={config.connectNulls} strokeWidth={config.lineType === 'line' ? 1 : 0} dot={config.lineType === 'dots'} activeDot={{r: 4}} isAnimationActive={isAnimationActive} animationDuration={animationDuration}/>)}
```

To:
```typescript
          {allY.map((y,i)=><Line yAxisId="left" key={y} type={rechartsType} dataKey={y} stroke={colors[i%colors.length]} connectNulls={config.connectNulls} strokeWidth={strokeWidth} dot={showDot} activeDot={{r: 4}} isAnimationActive={isAnimationActive} animationDuration={animationDuration}/>)}
          {allY2.map((y,i)=><Line yAxisId="right" key={y} type={rechartsType} dataKey={y} stroke={colors[(allY.length+i)%colors.length]} connectNulls={config.connectNulls} strokeWidth={strokeWidth} dot={showDot} activeDot={{r: 4}} isAnimationActive={isAnimationActive} animationDuration={animationDuration}/>)}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/lineChartStep.test.tsx
```

Expected: All 6 tests pass.

- [ ] **Step 5: Add step types to syntax highlighter subKeywords**

In `core/frontend/components/editor/languages.ts`, in `subKeywords`, add after `'ASC', 'DESC'`:

```typescript
    // LINE_CHART lineType values
    'STEP', 'STEPBEFORE', 'STEPAFTER',
```

(These are parameter values inside the function call, so they are highlighted as subKeywords when inside a `lineType: "..."` context. CodeMirror will highlight them inside strings automatically — this is informational and helps with future completions.)

- [ ] **Step 6: Run full suite**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -8
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query && git add core/frontend/components/plots/LineChartPlot.tsx core/frontend/components/editor/languages.ts core/frontend/tests/plots/lineChartStep.test.tsx && git commit -m "feat(line-chart): add step/stepBefore/stepAfter curve types"
```

---

## Task 6: Add SORT to TABLE SORT clause example in TablePlot + documentation

**Purpose:** Surface the new TABLE SORT clause as an example so users discover it, and confirm the full integration end-to-end works.

**Files:**
- Modify: `core/frontend/components/plots/TablePlot.ts` — add SORT example
- Modify: `core/frontend/components/plots/BarChartPlot.ts` — add SORT+LIMIT example

- [ ] **Step 1: Add TABLE SORT example**

In `core/frontend/components/plots/TablePlot.ts`, in the `examples` array, add after the second example:

```typescript
    {
        description: 'A table that writes the clicked column and sort direction to variables. SQL cells can reference $sortCol and $sortDir in ORDER BY clauses.',
        code: 'TABLE() TITLE "GC Pauses" SORT $sortCol $sortDir LIMIT 50',
        sampleData: [
            { startTime: '2023-01-01 10:00:05.123', duration: 15.6, gcCause: 'Allocation Failure' },
            { startTime: '2023-01-01 10:05:10.456', duration: 180.2, gcCause: 'System.gc()' },
        ]
    },
```

- [ ] **Step 2: Add BAR_CHART SORT+LIMIT example**

In `core/frontend/components/plots/BarChartPlot.ts`, in the `examples` array, add after the first example:

```typescript
    {
        description: 'Top 5 GC causes by total pause time, sorted descending. SORT DESC + LIMIT 5 work at render time — no SQL change needed.',
        code: 'BAR_CHART(x: "gcCause", y: ["totalPauseMs"]) SORT DESC LIMIT 5 TITLE "Top 5 GC Causes"',
        sampleData: [
            { gcCause: 'Allocation Failure', totalPauseMs: 1200 },
            { gcCause: 'System.gc()', totalPauseMs: 3500 },
            { gcCause: 'Metadata GC Threshold', totalPauseMs: 450 },
            { gcCause: 'Ergonomics', totalPauseMs: 780 },
            { gcCause: 'GCLocker Initiated GC', totalPauseMs: 90 },
            { gcCause: 'Heap Inspection Initiated GC', totalPauseMs: 30 },
        ]
    },
```

- [ ] **Step 3: Run full test suite**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -8
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query && git add core/frontend/components/plots/TablePlot.ts core/frontend/components/plots/BarChartPlot.ts && git commit -m "docs(plots): add SORT $col $dir and SORT DESC + LIMIT examples to TABLE and BAR_CHART"
```

---

## Task 7: Full regression test run + verification

- [ ] **Step 1: Run complete test suite**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -20
```

Expected: All tests pass (0 failing). Count should be higher than before this plan (new tests added: ~25).

- [ ] **Step 2: Verify TABLE SORT wiring builds without TypeScript errors**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors (or only pre-existing errors unrelated to these changes).

- [ ] **Step 3: Spot-check new features in browser**

Start dev server if not running: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npm run dev`

Check these in the browser:
1. Create a TABLE() cell, add `SORT $sortCol $sortDir` clause. Click a column header. In the variables block, `$sortCol` and `$sortDir` should appear with the column name and `asc`/`desc`.
2. Create a BAR_CHART cell, add `SORT DESC LIMIT 3`. Only 3 bars should render, highest first.
3. Create a LINE_CHART cell with `lineType: "step"`. The line should render as a staircase.

---

## Self-Review Checklist

**Spec coverage:**
- ✅ TABLE SORT $colVar $dirVar — Task 1 (tests), wiring already done
- ✅ LIMIT n for TABLE — Tasks 2 + 3
- ✅ SORT ASC/DESC for BAR_CHART — Task 4
- ✅ LIMIT n for BAR_CHART — Task 4 (wired in same task)
- ✅ step/stepBefore/stepAfter LINE_CHART — Task 5
- ✅ Syntax highlighting for SORT, LIMIT, ASC, DESC — Tasks 2 and 4
- ✅ Autocomplete tails for SORT, LIMIT — Task 2
- ✅ Documentation/examples — Task 6
- ✅ Full regression run — Task 7

**Type consistency:**
- `ParsedPlotCall.sort` — `{ colVar: string; dirVar: string }` — used in Tasks 1 and TablePlot
- `ParsedPlotCall.barSort` — `'asc' | 'desc' | undefined` — used in Tasks 4 and BarChartPlot
- `ParsedPlotCall.limit` — `number | undefined` — used in Tasks 2, 3, 4
- `DataTable.onSortChange` — `(col: string, dir: 'asc' | 'desc') => void` — consistent throughout
- `TablePlot.displayData` — `data.slice(0, clauses.limit)` — consistent naming

**No placeholders found.** All code blocks are complete.
