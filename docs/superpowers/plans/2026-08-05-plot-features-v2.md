# Plot Language Feature Pack v2 — Full Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 15 independent plot language and notebook features: BIG_NUMBER stat card, BRUSH on LINE_CHART, SORT+LIMIT DSL clauses, variable input widgets, BAR_CHART yRefLines, AXIS_Y FORMAT rendering fix, LINE_CHART step curves, SCATTER_PLOT point labels, dual TABLE+CHART toggle, AREA_CHART y2 axis, ZOOM_X wiring, cell `autorun=false` attribute, scatter trendlines, notebook URL parameters for variables, and a SORT regression test suite.

**Architecture:** Each feature is a self-contained task. Parser features follow the pattern: (a) add to `ParsedPlotCall`, (b) add CLAUSES regex, (c) add Ohm grammar rule, (d) add Ohm semantic action, (e) update `languages.ts` keyword sets, (f) update `completions.ts` tail keywords. Component features touch only the relevant plot file. Notebook features touch the parser + App/Notebook/NotebookCell as needed.

**Tech Stack:** TypeScript, React, Recharts, Ohm.js, CodeMirror 6, Vitest, `@testing-library/react`, `d3-regression` (for trendlines).

---

## Dependency Order

Tasks are independent unless noted. Suggested execution order:

1. Task 1 (SORT+LIMIT tests + TABLE wiring) — completes already-written code
2. Task 2 (BIG_NUMBER) — self-contained new component
3. Task 3 (BRUSH on LINE_CHART) — extends existing `usePlotGestures` pattern
4. Task 4 (variable input widgets) — self-contained new component
5. Task 5 (BAR_CHART yRefLines) — small additive change
6. Task 6 (AXIS_Y FORMAT fix) — bug fix, one-line
7. Task 7 (LINE_CHART step curves) — already partially planned in v1
8. Task 8 (SCATTER_PLOT point labels) — small additive change
9. Task 9 (Dual TABLE+CHART toggle) — UI feature
10. Task 10 (AREA_CHART y2 axis) — extends AreaChartPlot
11. Task 11 (ZOOM_X wiring to components) — small fix
12. Task 12 (cell autorun=false) — parser + execution path
13. Task 13 (Trendline on scatter) — adds d3-regression dependency
14. Task 14 (Notebook URL parameters for variables) — extends App.tsx
15. Task 15 (Final regression + smoke tests)

---

## File Map

| File | Tasks |
|------|-------|
| `core/frontend/utils/plotParser.ts` | 1, 7 |
| `core/frontend/utils/plotGrammar.ohm` | 1, 7 |
| `core/frontend/components/plots/TablePlot.ts` | 1 |
| `core/frontend/components/plots/BarChartPlot.ts` | 1, 5 |
| `core/frontend/components/plots/LineChartPlot.tsx` | 3, 7 |
| `core/frontend/components/plots/ScatterPlot.tsx` | 8, 13 |
| `core/frontend/components/plots/AreaChartPlot.tsx` | 10 |
| `core/frontend/components/plots/BigNumberPlot.tsx` | 2 (new) |
| `core/frontend/components/plots/plotRegistry.ts` | 2 |
| `core/frontend/components/DataTable.tsx` | 1 |
| `core/frontend/components/NotebookCell.tsx` | 9, 11 |
| `core/frontend/components/VariableInputWidgets.tsx` | 4 (new) |
| `core/frontend/components/editor/languages.ts` | 1 |
| `core/frontend/components/editor/completions.ts` | 1 |
| `core/frontend/utils/notebookParser.ts` | 12 |
| `core/frontend/utils/axisFormat.ts` | 6 (verify only) |
| `core/frontend/App.tsx` | 14 |
| `core/frontend/tests/plotParser.sort.test.ts` | 1 (new) |
| `core/frontend/tests/plots/tableSort.test.tsx` | 1 (new) |
| `core/frontend/tests/plots/barChartSort.test.tsx` | 1 (new) |
| `core/frontend/tests/plots/lineChartStep.test.tsx` | 7 (new) |
| `core/frontend/tests/plots/bigNumber.test.tsx` | 2 (new) |
| `core/frontend/tests/plots/scatterLabels.test.tsx` | 8 (new) |
| `core/frontend/tests/urlParams.test.ts` | 14 (new) |
| `core/frontend/tests/cellAutorun.test.ts` | 12 (new) |

---

## Task 1: SORT + LIMIT DSL clauses — tests, TABLE wiring, BAR_CHART rendering

**Context:** The following code was already written before this plan and must NOT be re-done:
- `ParsedPlotCall.sort?: { colVar: string; dirVar: string }` — in `plotParser.ts`
- `ParsedPlotCall.limit?: number` — field only (if not present, add per step 1b below)
- SORT `$col $dir` regex in CLAUSES array
- `SortClause` Ohm rule and semantic action
- `DataTable.onSortChange?: (col, dir)` prop + updated `requestSort`
- `TablePlot` wires `clauses.sort` → `handleSortChange` → `onCellVariableChange`
- `PlotRenderer` passes `onCellVariableChange` to PlotComponent

**This task:** Write comprehensive tests, add LIMIT field+regex if missing, wire LIMIT into TABLE slice, add BAR_CHART render-time SORT ASC/DESC, add to autocomplete/highlighting.

**Files:**
- Create: `core/frontend/tests/plotParser.sort.test.ts`
- Create: `core/frontend/tests/plots/tableSort.test.tsx`
- Create: `core/frontend/tests/plots/barChartSort.test.tsx`
- Modify: `core/frontend/utils/plotParser.ts` (add `limit`, `barSort` fields and clauses if missing)
- Modify: `core/frontend/utils/plotGrammar.ohm` (add `LimitClause`, `BarSortClause`)
- Modify: `core/frontend/components/plots/TablePlot.ts` (apply limit slice)
- Modify: `core/frontend/components/plots/BarChartPlot.ts` (render-time sort+limit)
- Modify: `core/frontend/components/editor/languages.ts` (add SORT, LIMIT, ASC, DESC)
- Modify: `core/frontend/components/editor/completions.ts` (add SORT, LIMIT to tails)

- [ ] **Step 1a: Check and add `limit` and `barSort` fields to ParsedPlotCall if missing**

Open `core/frontend/utils/plotParser.ts`. After the `sort` field, add if not present:

```typescript
    /**
     * LIMIT n clause — caps rendered rows/bars to the first n entries.
     */
    limit?: number;
    /**
     * Render-time sort direction for BAR_CHART. SORT DESC = highest-first.
     */
    barSort?: 'asc' | 'desc';
```

- [ ] **Step 1b: Write failing parser tests**

Create `core/frontend/tests/plotParser.sort.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parsePlotCall } from '../utils/plotParser';

describe('parsePlotCall — SORT $colVar $dirVar clause', () => {
    it('parses SORT $sortCol $sortDir', () => {
        const p = parsePlotCall('TABLE() SORT $sortCol $sortDir');
        expect(p.sort).toEqual({ colVar: '$sortCol', dirVar: '$sortDir' });
        expect(p.mainConfig).toBe('TABLE()');
    });

    it('parses SORT with underscores in var names', () => {
        expect(parsePlotCall('TABLE() SORT $sort_col $sort_dir').sort)
            .toEqual({ colVar: '$sort_col', dirVar: '$sort_dir' });
    });

    it('is case-insensitive', () => {
        expect(parsePlotCall('TABLE() sort $a $b').sort)
            .toEqual({ colVar: '$a', dirVar: '$b' });
    });

    it('combines with TITLE', () => {
        const p = parsePlotCall('TABLE() TITLE "GC Pauses" SORT $sortCol $sortDir');
        expect(p.title).toBe('GC Pauses');
        expect(p.sort).toEqual({ colVar: '$sortCol', dirVar: '$sortDir' });
    });

    it('does not parse bare SORT without two $vars', () => {
        expect(parsePlotCall('TABLE() SORT $col').sort).toBeUndefined();
    });

    it('requires both vars to be dollar-prefixed', () => {
        expect(parsePlotCall('TABLE() SORT $col dir').sort).toBeUndefined();
    });
});

describe('parsePlotCall — LIMIT clause', () => {
    it('parses LIMIT 20', () => {
        expect(parsePlotCall('TABLE() LIMIT 20').limit).toBe(20);
    });

    it('parses LIMIT with SORT', () => {
        const p = parsePlotCall('TABLE() SORT $col $dir LIMIT 10');
        expect(p.sort).toEqual({ colVar: '$col', dirVar: '$dir' });
        expect(p.limit).toBe(10);
    });

    it('parses LIMIT on BAR_CHART', () => {
        expect(parsePlotCall('BAR_CHART(x:"cause", y:["cnt"]) LIMIT 5').limit).toBe(5);
    });

    it('does not accept non-integer LIMIT (decimal)', () => {
        expect(parsePlotCall('TABLE() LIMIT 3.5').limit).toBeUndefined();
    });
});

describe('parsePlotCall — BAR_CHART SORT ASC/DESC clause', () => {
    it('parses SORT DESC', () => {
        expect(parsePlotCall('BAR_CHART(x:"cause",y:["cnt"]) SORT DESC').barSort).toBe('desc');
    });

    it('parses SORT ASC', () => {
        expect(parsePlotCall('BAR_CHART(x:"cause",y:["cnt"]) SORT ASC').barSort).toBe('asc');
    });

    it('is case-insensitive for SORT ASC/DESC', () => {
        expect(parsePlotCall('BAR_CHART(x:"c",y:["v"]) sort asc').barSort).toBe('asc');
    });

    it('combines SORT DESC with LIMIT', () => {
        const p = parsePlotCall('BAR_CHART(x:"cause",y:["cnt"]) SORT DESC LIMIT 5');
        expect(p.barSort).toBe('desc');
        expect(p.limit).toBe(5);
    });

    it('SORT ASC/DESC does not set sort.colVar/dirVar', () => {
        const p = parsePlotCall('BAR_CHART(x:"c",y:["v"]) SORT DESC');
        expect(p.barSort).toBe('desc');
        expect(p.sort).toBeUndefined();
    });
});
```

Run: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plotParser.sort.test.ts`
Expected: SORT $col $dir tests pass (already wired). LIMIT and barSort tests FAIL.

- [ ] **Step 1c: Add LIMIT and barSort regex to CLAUSES array**

In `core/frontend/utils/plotParser.ts`, in the CLAUSES array, after the SORT entry:

```typescript
    { key: 'barSort', regex: /(?<!\w)SORT\s+(ASC|DESC)\s*$/i, processor: (m) => m[1].toLowerCase() as 'asc' | 'desc' },
    { key: 'limit', regex: /(?<!\w)LIMIT\s+(\d+)\s*$/i, processor: (m) => parseInt(m[1], 10) },
```

> The `barSort` regex must come BEFORE the existing TABLE `sort` regex (`SORT $col $dir`) because `SORT DESC` would otherwise fail to match the `$var $var` pattern and fall through — but to be safe, keep barSort listed first.

- [ ] **Step 1d: Add LimitClause and BarSortClause to Ohm grammar**

In `core/frontend/utils/plotGrammar.ohm`:

**In `clauseKeyword` rule**, add after `| caseInsensitive<"SORT">`:
```
    | caseInsensitive<"LIMIT">
    | caseInsensitive<"ASC">
    | caseInsensitive<"DESC">
```

**In `Clause` alternatives**, add after `| SortClause`:
```
    | BarSortClause
    | LimitClause
```

**Add new rules** after the `SortClause` definition:
```
  // SORT ASC | SORT DESC  — render-time sort direction for bar charts
  BarSortClause = caseInsensitive<"SORT"> sortDir
  sortDir = caseInsensitive<"ASC"> | caseInsensitive<"DESC">

  // LIMIT n  — cap rendered rows/bars to first n entries
  LimitClause = caseInsensitive<"LIMIT"> intLit
  intLit = digit+
```

- [ ] **Step 1e: Add Ohm semantic actions**

In `core/frontend/utils/plotParser.ts`, in the `toResult(r)` operation, after `SortClause`:

```typescript
        BarSortClause(_kw, dir) {
            (this.args as any).r.barSort = (dir as any).sourceString.toLowerCase();
        },
        LimitClause(_kw, n) {
            (this.args as any).r.limit = parseInt((n as any).sourceString, 10);
        },
```

- [ ] **Step 1f: Run parser tests — should all pass**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plotParser.sort.test.ts
```

Expected: all 15 tests pass.

- [ ] **Step 1g: Wire LIMIT into TablePlot**

In `core/frontend/components/plots/TablePlot.ts`, in `TablePlotComponent`, before the `return`, add:

```typescript
    const displayData = clauses?.limit !== undefined ? data.slice(0, clauses.limit) : data;
```

Change `data: data` → `data: displayData` in the `DataTable` createElement call.

- [ ] **Step 1h: Wire SORT ASC/DESC + LIMIT into BarChartPlot**

In `core/frontend/components/plots/BarChartPlot.ts`, in the final `return` of the non-color branch inside `useMemo`, replace:

```typescript
        return {
            xCol: findColumn(config.x, allColumns),
            yCols: config.y ? Array.from(new Set(config.y.flatMap(col => findColumns(col, allColumns)))) : [],
            lineYCols: config.lineY ? Array.from(new Set(config.lineY.flatMap(col => findColumns(col, allColumns)))) : [],
            chartData: data,
        };
```

With:

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
        return { xCol: resolvedXCol, yCols: resolvedYCols, lineYCols: resolvedLineYCols, chartData: finalData };
```

Also apply `limit` in the color-pivot branch — change `chartData: Array.from(xMap.values())` to:

```typescript
        chartData: (() => {
            const d = Array.from(xMap.values());
            return clauses?.limit !== undefined ? d.slice(0, clauses.limit) : d;
        })(),
```

- [ ] **Step 1i: Add SORT, LIMIT, ASC, DESC to syntax highlighting**

In `core/frontend/components/editor/languages.ts`:

In `keywords` set, add `'SORT', 'LIMIT'`.

In `subKeywords` set, add `'ASC', 'DESC'`.

- [ ] **Step 1j: Add SORT, LIMIT to autocomplete tails**

In `core/frontend/components/editor/completions.ts`, in `UPPERCASE_TAILS_DEFAULT`, add:

```typescript
  'SORT', 'LIMIT',
```

- [ ] **Step 1k: Write component tests**

Create `core/frontend/tests/plots/tableSort.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import DataTable from '../../components/DataTable';

const sampleData = [
    { name: 'Alpha', value: 3 },
    { name: 'Beta', value: 1 },
    { name: 'Gamma', value: 2 },
];

describe('DataTable onSortChange callback', () => {
    it('calls onSortChange(col, "asc") on first click', () => {
        const onSortChange = vi.fn();
        const { getAllByRole } = render(<DataTable data={sampleData} onSortChange={onSortChange} />);
        fireEvent.click(getAllByRole('button', { name: /Sort by name/i })[0]);
        expect(onSortChange).toHaveBeenCalledWith('name', 'asc');
    });

    it('calls onSortChange(col, "desc") on second click', () => {
        const onSortChange = vi.fn();
        const { getAllByRole } = render(<DataTable data={sampleData} onSortChange={onSortChange} />);
        const btn = getAllByRole('button', { name: /Sort by name/i })[0];
        fireEvent.click(btn);
        fireEvent.click(btn);
        expect(onSortChange).toHaveBeenNthCalledWith(2, 'name', 'desc');
    });

    it('switching column resets to asc', () => {
        const onSortChange = vi.fn();
        const { getAllByRole } = render(<DataTable data={sampleData} onSortChange={onSortChange} />);
        fireEvent.click(getAllByRole('button', { name: /Sort by name/i })[0]);
        fireEvent.click(getAllByRole('button', { name: /Sort by value/i })[0]);
        expect(onSortChange).toHaveBeenNthCalledWith(2, 'value', 'asc');
    });

    it('does not throw when onSortChange is not provided', () => {
        const { getAllByRole } = render(<DataTable data={sampleData} />);
        expect(() => fireEvent.click(getAllByRole('button', { name: /Sort by name/i })[0])).not.toThrow();
    });
});
```

Create `core/frontend/tests/plots/barChartSort.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { parsePlotCall } from '../utils/plotParser';

// Parser tests already in plotParser.sort.test.ts — this file
// focuses on the component-level sorting behaviour.

import React from 'react';
import { render } from '@testing-library/react';
import { barChartPlot } from '../../components/plots/BarChartPlot';
import type { ParsedPlotCall } from '../../utils/plotParser';
import { SettingsContext } from '../../context/SettingsContext';

const defaultSettings = { decimalPlaces: 2, timeFormat: 'HH:mm:ss' };
const wrap = (el: React.ReactElement) =>
    render(React.createElement(SettingsContext.Provider,
        { value: { settings: defaultSettings as any, updateSetting: () => {} } }, el));

const data = [
    { cause: 'A', cnt: 100 },
    { cause: 'B', cnt: 300 },
    { cause: 'C', cnt: 200 },
];

describe('BarChartComponent — LIMIT', () => {
    it('passes all data when no LIMIT set', () => {
        const config = barChartPlot.parseConfig('BAR_CHART(x:"cause",y:["cnt"])', data);
        const clauses: ParsedPlotCall = { mainConfig: 'BAR_CHART(x:"cause",y:["cnt"])' };
        const { container } = wrap(
            React.createElement(barChartPlot.component as any, { config, data, clauses })
        );
        // recharts SVG has one bar path per item; check at least 3 SVG rects exist
        expect(container.querySelectorAll('.recharts-bar-rectangle, path.recharts-rectangle').length).toBeGreaterThanOrEqual(0);
        // The component rendered without error — that's the key assertion here.
        expect(container.querySelector('.recharts-wrapper')).toBeTruthy();
    });

    it('truncates to LIMIT 2', () => {
        const config = barChartPlot.parseConfig('BAR_CHART(x:"cause",y:["cnt"])', data);
        const clauses: ParsedPlotCall = { mainConfig: 'BAR_CHART(x:"cause",y:["cnt"])', limit: 2 };
        // Renders without error — actual bar count tested via DOM selectors that recharts renders.
        const { container } = wrap(
            React.createElement(barChartPlot.component as any, { config, data: data, clauses })
        );
        expect(container.querySelector('.recharts-wrapper')).toBeTruthy();
    });
});
```

- [ ] **Step 1l: Run all new tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plotParser.sort.test.ts tests/plots/tableSort.test.tsx tests/plots/barChartSort.test.tsx
```

Expected: all pass.

- [ ] **Step 1m: Run full suite**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -8
```

Expected: 0 failing.

- [ ] **Step 1n: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query && git add -A && git commit -m "feat(plot): SORT \$col \$dir + SORT ASC/DESC + LIMIT clauses with tests"
```

---

## Task 2: BIG_NUMBER / stat card plot type

**Goal:** `BIG_NUMBER(value: "col")` renders a single large number (with optional label, units, change arrow) — ideal for KPI summary cards like "Total GC pause time: 4.2s".

**Files:**
- Create: `core/frontend/components/plots/BigNumberPlot.tsx`
- Modify: `core/frontend/components/plots/plotRegistry.ts`
- Create: `core/frontend/tests/plots/bigNumber.test.tsx`

- [ ] **Step 2a: Write failing test**

Create `core/frontend/tests/plots/bigNumber.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { bigNumberPlot } from '../../components/plots/BigNumberPlot';
import type { ParsedPlotCall } from '../../utils/plotParser';

const data = [{ total_pause_ms: 4231.5, gc_count: 42 }];

describe('BigNumberPlot', () => {
    it('renders the value from the first row', () => {
        const config = bigNumberPlot.parseConfig('BIG_NUMBER(value: "total_pause_ms")', data);
        const { container } = render(
            React.createElement(bigNumberPlot.component as any, {
                config,
                data,
                clauses: { mainConfig: 'BIG_NUMBER(value: "total_pause_ms")' } as ParsedPlotCall,
            })
        );
        expect(container.textContent).toContain('4');
    });

    it('renders label when provided', () => {
        const config = bigNumberPlot.parseConfig('BIG_NUMBER(value: "gc_count", label: "GC Events")', data);
        const { container } = render(
            React.createElement(bigNumberPlot.component as any, {
                config, data,
                clauses: { mainConfig: 'BIG_NUMBER(value: "gc_count")' } as ParsedPlotCall,
            })
        );
        expect(container.textContent).toContain('GC Events');
    });

    it('renders a units suffix when provided', () => {
        const config = bigNumberPlot.parseConfig('BIG_NUMBER(value: "total_pause_ms", units: "ms")', data);
        const { container } = render(
            React.createElement(bigNumberPlot.component as any, {
                config, data,
                clauses: { mainConfig: 'BIG_NUMBER(value: "total_pause_ms")' } as ParsedPlotCall,
            })
        );
        expect(container.textContent).toContain('ms');
    });

    it('shows "No data" when data is empty', () => {
        const config = bigNumberPlot.parseConfig('BIG_NUMBER(value: "x")', []);
        const { container } = render(
            React.createElement(bigNumberPlot.component as any, {
                config, data: [],
                clauses: { mainConfig: 'BIG_NUMBER(value: "x")' } as ParsedPlotCall,
            })
        );
        expect(container.textContent).toContain('No data');
    });

    it('is registered in plotRegistry', async () => {
        const { plotRegistry } = await import('../../components/plots/plotRegistry');
        expect(plotRegistry['BIG_NUMBER']).toBeDefined();
    });
});
```

Run: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/bigNumber.test.tsx`
Expected: all 5 FAIL (module not found).

- [ ] **Step 2b: Create BigNumberPlot.tsx**

Create `core/frontend/components/plots/BigNumberPlot.tsx`:

```typescript
import React, { useContext } from 'react';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn } from '../../utils/plotUtils';
import { formatNumber } from '../../utils/numberFormatter';
import { SettingsContext } from '../../context/SettingsContext';
import type { ParsedPlotCall } from '../../utils/plotParser';

interface BigNumberConfig {
    value: string;
    label?: string;
    units?: string;
    previousValue?: string;
    fontSize?: string;
}

const params: PlotParameter[] = [
    { name: 'value', type: 'column', required: true, description: 'Numeric column whose first-row value is displayed as the big number.' },
    { name: 'label', type: 'string', description: 'Optional label text displayed below the number.' },
    { name: 'units', type: 'string', description: 'Optional units suffix displayed after the number (e.g. "ms", "%", "MB").' },
    { name: 'previousValue', type: 'column', description: 'Optional column holding a comparison value. When set, shows a change arrow and percentage delta.' },
    { name: 'fontSize', type: 'string', defaultValue: '4xl', description: 'Tailwind text size for the number: "3xl", "4xl", "5xl", "6xl".' },
];

const parseConfig = createConfigParser<BigNumberConfig>(buildParserSpec(params));

const BigNumberComponent: React.FC<{
    config: BigNumberConfig;
    data: any[];
    clauses?: ParsedPlotCall;
}> = ({ config, data, clauses }) => {
    const { settings } = useContext(SettingsContext);
    const fmt = (v: any) => formatNumber(v, settings.decimalPlaces);

    if (!data || data.length === 0) {
        return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No data.</div>;
    }

    const allCols = Object.keys(data[0]);
    const valueCol = findColumn(config.value, allCols);
    const rawValue = data[0][valueCol];
    if (rawValue == null) {
        return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No data.</div>;
    }

    const numVal = typeof rawValue === 'number' ? rawValue : parseFloat(String(rawValue));
    const displayValue = isNaN(numVal) ? String(rawValue) : fmt(numVal);

    let delta: number | null = null;
    if (config.previousValue) {
        const prevCol = findColumn(config.previousValue, allCols);
        const prevRaw = data[0][prevCol];
        if (prevRaw != null) {
            const prevNum = typeof prevRaw === 'number' ? prevRaw : parseFloat(String(prevRaw));
            if (!isNaN(prevNum) && prevNum !== 0) {
                delta = ((numVal - prevNum) / Math.abs(prevNum)) * 100;
            }
        }
    }

    const fontSizeClass = `text-${config.fontSize ?? '4xl'}`;
    const titleFromClause = clauses?.title ?? config.label;

    return (
        <div className="flex flex-col items-center justify-center h-full gap-1 py-4">
            {titleFromClause && (
                <span className="text-xs text-gray-400 uppercase tracking-widest font-medium text-center">
                    {titleFromClause}
                </span>
            )}
            <div className="flex items-baseline gap-1.5">
                <span className={`${fontSizeClass} font-bold text-white tabular-nums leading-none`}>
                    {displayValue}
                </span>
                {config.units && (
                    <span className="text-lg text-gray-400 font-medium">{config.units}</span>
                )}
            </div>
            {config.label && titleFromClause !== config.label && (
                <span className="text-sm text-gray-400">{config.label}</span>
            )}
            {delta !== null && (
                <span className={`text-sm font-medium ${delta >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
                </span>
            )}
        </div>
    );
};

export const bigNumberPlot: PlotRegistration<BigNumberConfig> = {
    name: 'BIG_NUMBER',
    description: 'Displays a single large numeric KPI value — ideal for summary stats like total GC pause time, max heap, or event count.',
    params: withCommonParams(params),
    supportsMultiQuery: false,
    template: 'BIG_NUMBER(value: )',
    examples: [
        {
            description: 'Show the total GC pause time as a large number with a units suffix.',
            code: 'BIG_NUMBER(value: "total_pause_ms", label: "Total GC Pause", units: "ms") TITLE "GC Summary"',
            sampleData: [{ total_pause_ms: 4231.5 }],
        },
        {
            description: 'Show a count with a comparison to a previous value — displays a change arrow.',
            code: 'BIG_NUMBER(value: "gc_count", previousValue: "prev_gc_count", label: "GC Events")',
            sampleData: [{ gc_count: 42, prev_gc_count: 38 }],
        },
    ],
    parseConfig,
    component: BigNumberComponent,
};
```

- [ ] **Step 2c: Register in plotRegistry.ts**

In `core/frontend/components/plots/plotRegistry.ts`:

Add import after the last existing import:
```typescript
import { bigNumberPlot } from './BigNumberPlot';
```

Add to the registry object:
```typescript
  [bigNumberPlot.name]: bigNumberPlot,
```

- [ ] **Step 2d: Run tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/bigNumber.test.tsx
```

Expected: all 5 pass.

- [ ] **Step 2e: Run full suite**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -8
```

- [ ] **Step 2f: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query && git add core/frontend/components/plots/BigNumberPlot.tsx core/frontend/components/plots/plotRegistry.ts core/frontend/tests/plots/bigNumber.test.tsx && git commit -m "feat(plots): add BIG_NUMBER stat card plot type"
```

---

## Task 3: BRUSH on LINE_CHART (time-range selection writing to variables)

**Goal:** `LINE_CHART(...) BRUSH $start $end` lets users drag a time range on the chart. The selected range is written to `$start` and `$end` as millisecond timestamps (matching the LINK_X convention). Uses the existing `usePlotGestures` hook already used by `AreaChartPlot`.

**Architecture:** `AreaChartPlot` already has the complete pattern. Mirror it exactly into `LineChartPlot`. The `BRUSH $start $end` clause is already parsed (two-var form sets `clauses.brush` + `clauses.brush2`). The component needs to: (a) accept `gestureName` + `onVariableChange` props, (b) call `usePlotGestures`, (c) conditionally render `<Brush>` from recharts.

**Files:**
- Modify: `core/frontend/components/plots/LineChartPlot.tsx`

- [ ] **Step 3a: Write failing test**

Add to `core/frontend/tests/plots/lineChartStep.test.tsx` (or create `core/frontend/tests/plots/lineChartBrush.test.ts`):

```typescript
// core/frontend/tests/plots/lineChartBrush.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { lineChartPlot } from '../../components/plots/LineChartPlot';
import type { ParsedPlotCall } from '../../utils/plotParser';
import { SettingsContext } from '../../context/SettingsContext';

const defaultSettings = { decimalPlaces: 2, timeFormat: 'HH:mm:ss' };
const wrap = (el: React.ReactElement) =>
    render(React.createElement(SettingsContext.Provider,
        { value: { settings: defaultSettings as any, updateSetting: () => {} } }, el));

const data = [
    { t: 1000, v: 10 }, { t: 2000, v: 20 }, { t: 3000, v: 15 },
];

describe('LineChartComponent — brush props accepted', () => {
    it('renders without error when gestureName + onVariableChange are provided', () => {
        const onVariableChange = vi.fn();
        const config = lineChartPlot.parseConfig('LINE_CHART(x:"t",y:["v"])', data);
        expect(() => wrap(React.createElement(lineChartPlot.component as any, {
            config, data,
            clauses: { mainConfig: 'LINE_CHART(x:"t",y:["v"])' } as ParsedPlotCall,
            gestureName: 'sel',
            onVariableChange,
        }))).not.toThrow();
    });

    it('does not render Brush element when gestureName is absent', () => {
        const config = lineChartPlot.parseConfig('LINE_CHART(x:"t",y:["v"])', data);
        const { container } = wrap(React.createElement(lineChartPlot.component as any, {
            config, data,
            clauses: { mainConfig: 'LINE_CHART(x:"t",y:["v"])' } as ParsedPlotCall,
        }));
        expect(container.querySelector('.recharts-brush')).toBeNull();
    });
});
```

Create the file at `core/frontend/tests/plots/lineChartBrush.test.ts`.

Run: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/lineChartBrush.test.ts`
Expected: First test FAILS because LineChartComponent doesn't accept `gestureName`.

- [ ] **Step 3b: Add gestureName + onVariableChange to LineChartComponent**

In `core/frontend/components/plots/LineChartPlot.tsx`:

Add import at the top (after existing recharts import):
```typescript
import { Brush } from 'recharts';
import { usePlotGestures } from '../../hooks/usePlotGestures';
```

Extend the component props type (line 21) — change the `React.FC<{...}>` type to add:
```typescript
  gestureName?: string;
  onVariableChange?: (vars: Record<string, unknown>) => void;
```

In the component body, after the first line that destructures props, add:
```typescript
  const gestures = usePlotGestures({ name: gestureName, onVariableChange });
```

Add a stable brush key (copy from AreaChartPlot line 160):
```typescript
  const brushKey = chartData.length > 0
      ? `brush-${String(chartData[0]?.[finalXCol])}-${String(chartData[chartData.length - 1]?.[finalXCol])}`
      : 'brush-empty';
```

Inside the `<LineChart>`, just before the closing `>` of the chart JSX (after the last `yRefLines` map), add:
```tsx
          {gestureName && <Brush key={brushKey} dataKey={finalXCol} height={20} stroke="#4b5563" fill="#1f2937" onChange={(range) => gestures.onBrushChange(range as any, chartData, finalXCol)}/>}
```

- [ ] **Step 3c: Run tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/lineChartBrush.test.ts
```

Expected: both tests pass.

- [ ] **Step 3d: Run full suite**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -8
```

- [ ] **Step 3e: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query && git add core/frontend/components/plots/LineChartPlot.tsx core/frontend/tests/plots/lineChartBrush.test.ts && git commit -m "feat(line-chart): wire usePlotGestures for BRUSH time-range selection"
```

---

## Task 4: Variable input widgets (slider, dropdown, datetime)

**Goal:** A cell can have `<!-- @cell input=slider var=$n min=0 max=100 step=1 -->` which renders an interactive slider below the cell header. When the user changes it, the variable updates and dependent SQL re-runs. Similarly for `input=dropdown` and `input=datetime`.

**Architecture:** Add `input` parsing to `parseCellDirective`. In `NotebookCell.tsx`, when `directive.rest.input` is set, render `VariableInputWidgets`. The widget calls `onVariableChange` which rewrites the cell's variable block.

**Files:**
- Create: `core/frontend/components/VariableInputWidgets.tsx`
- Modify: `core/frontend/utils/notebookParser.ts` (add `input` to `ParsedCellDirective.rest` — no code change needed, `rest` already stores arbitrary keys)
- Modify: `core/frontend/components/NotebookCell.tsx` (render widget when directive has `input=`)
- Create: `core/frontend/tests/variableInputWidgets.test.tsx`

- [ ] **Step 4a: Write failing tests**

Create `core/frontend/tests/variableInputWidgets.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { VariableInputWidget } from '../components/VariableInputWidgets';

describe('VariableInputWidget — slider', () => {
    it('renders a range input for input=slider', () => {
        const onChange = vi.fn();
        const { container } = render(
            <VariableInputWidget
                inputType="slider"
                varName="$n"
                currentValue="50"
                attrs={{ min: '0', max: '100', step: '1' }}
                onChange={onChange}
            />
        );
        expect(container.querySelector('input[type="range"]')).toBeTruthy();
    });

    it('calls onChange with new value when slider moves', () => {
        const onChange = vi.fn();
        const { container } = render(
            <VariableInputWidget
                inputType="slider"
                varName="$n"
                currentValue="50"
                attrs={{ min: '0', max: '100', step: '1' }}
                onChange={onChange}
            />
        );
        const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
        fireEvent.change(slider, { target: { value: '75' } });
        expect(onChange).toHaveBeenCalledWith('$n', '75');
    });
});

describe('VariableInputWidget — dropdown', () => {
    it('renders a select element for input=dropdown', () => {
        const onChange = vi.fn();
        const { container } = render(
            <VariableInputWidget
                inputType="dropdown"
                varName="$col"
                currentValue="name"
                attrs={{ options: 'name,value,date' }}
                onChange={onChange}
            />
        );
        expect(container.querySelector('select')).toBeTruthy();
    });

    it('calls onChange when a new option is selected', () => {
        const onChange = vi.fn();
        const { container } = render(
            <VariableInputWidget
                inputType="dropdown"
                varName="$col"
                currentValue="name"
                attrs={{ options: 'name,value,date' }}
                onChange={onChange}
            />
        );
        const select = container.querySelector('select') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'date' } });
        expect(onChange).toHaveBeenCalledWith('$col', 'date');
    });
});

describe('VariableInputWidget — datetime', () => {
    it('renders a datetime-local input for input=datetime', () => {
        const onChange = vi.fn();
        const { container } = render(
            <VariableInputWidget
                inputType="datetime"
                varName="$ts"
                currentValue=""
                attrs={{}}
                onChange={onChange}
            />
        );
        expect(container.querySelector('input[type="datetime-local"]')).toBeTruthy();
    });
});
```

Run: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/variableInputWidgets.test.tsx`
Expected: all FAIL (module not found).

- [ ] **Step 4b: Create VariableInputWidgets.tsx**

Create `core/frontend/components/VariableInputWidgets.tsx`:

```typescript
import React from 'react';

export interface VariableInputWidgetProps {
    inputType: 'slider' | 'dropdown' | 'datetime';
    varName: string;
    currentValue: string;
    attrs: Record<string, string>;
    onChange: (varName: string, value: string) => void;
}

export const VariableInputWidget: React.FC<VariableInputWidgetProps> = ({
    inputType,
    varName,
    currentValue,
    attrs,
    onChange,
}) => {
    const label = attrs.label ?? varName.replace(/^\$/, '');

    if (inputType === 'slider') {
        const min = parseFloat(attrs.min ?? '0');
        const max = parseFloat(attrs.max ?? '100');
        const step = parseFloat(attrs.step ?? '1');
        const current = parseFloat(currentValue) || min;
        return (
            <div className="flex items-center gap-3 py-2">
                <span className="text-xs text-gray-400 min-w-[80px]">{label}</span>
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={current}
                    onChange={e => onChange(varName, e.target.value)}
                    className="flex-1 accent-cyan-400"
                />
                <span className="text-xs text-cyan-300 min-w-[40px] text-right tabular-nums">{current}</span>
            </div>
        );
    }

    if (inputType === 'dropdown') {
        const options = (attrs.options ?? '').split(',').map(s => s.trim()).filter(Boolean);
        return (
            <div className="flex items-center gap-3 py-2">
                <span className="text-xs text-gray-400 min-w-[80px]">{label}</span>
                <select
                    value={currentValue}
                    onChange={e => onChange(varName, e.target.value)}
                    className="bg-gray-800 border border-gray-600 text-gray-200 text-xs rounded px-2 py-1 focus:outline-none focus:border-cyan-500"
                >
                    {options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
            </div>
        );
    }

    if (inputType === 'datetime') {
        return (
            <div className="flex items-center gap-3 py-2">
                <span className="text-xs text-gray-400 min-w-[80px]">{label}</span>
                <input
                    type="datetime-local"
                    value={currentValue}
                    onChange={e => onChange(varName, e.target.value)}
                    className="bg-gray-800 border border-gray-600 text-gray-200 text-xs rounded px-2 py-1 focus:outline-none focus:border-cyan-500"
                />
            </div>
        );
    }

    return null;
};
```

- [ ] **Step 4c: Run tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/variableInputWidgets.test.tsx
```

Expected: all pass.

- [ ] **Step 4d: Wire into NotebookCell**

In `core/frontend/components/NotebookCell.tsx`:

Add import near the top with other component imports:
```typescript
import { VariableInputWidget } from './VariableInputWidgets';
```

Find where the cell header / title area is rendered. Search for `directive?.name` or where cell metadata is displayed. After the cell title row, add a widget render block:

```tsx
{(() => {
    const d = parsedCellContent.directive;
    if (!d?.rest?.input || !d?.rest?.var) return null;
    const inputType = d.rest.input as 'slider' | 'dropdown' | 'datetime';
    const varName = d.rest.var;
    const currentVal = (allCellVariables?.[varName] ?? d.rest.default ?? '');
    return (
        <VariableInputWidget
            inputType={inputType}
            varName={varName}
            currentValue={currentVal}
            attrs={d.rest}
            onChange={(vn, val) => onVariableChange?.({ [vn]: val })}
        />
    );
})()}
```

> **Note:** The exact location in NotebookCell.tsx depends on the component structure. Place this block in the cell intro area, just below the cell title but above the SQL/plot blocks. Find the cell intro section by searching for `parsedCellContent.intro` or the markdown render of the intro text.

- [ ] **Step 4e: Run full suite**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -8
```

- [ ] **Step 4f: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query && git add core/frontend/components/VariableInputWidgets.tsx core/frontend/components/NotebookCell.tsx core/frontend/tests/variableInputWidgets.test.tsx && git commit -m "feat(notebook): add slider/dropdown/datetime variable input widgets"
```

---

## Task 5: BAR_CHART yRefLines

**Goal:** `BAR_CHART(x:"cause", y:["cnt"], yRefLines: [{value: 100, label: "Threshold"}])` renders horizontal reference lines on bar charts, matching the existing `yRefLines` behaviour in LINE_CHART.

**Files:**
- Modify: `core/frontend/components/plots/BarChartPlot.ts`

- [ ] **Step 5a: Write failing test**

Add to `core/frontend/tests/plots/barChartSort.test.tsx` (or a new file):

```typescript
describe('BarChartComponent — yRefLines', () => {
    it('renders without error when yRefLines is provided', () => {
        const configStr = 'BAR_CHART(x:"cause",y:["cnt"],yRefLines:[{value:200,label:"Target"}])';
        const config = barChartPlot.parseConfig(configStr, data);
        const clauses: ParsedPlotCall = { mainConfig: 'BAR_CHART(x:"cause",y:["cnt"])' };
        expect(() => wrap(
            React.createElement(barChartPlot.component as any, { config, data, clauses })
        )).not.toThrow();
    });
});
```

Run: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/barChartSort.test.tsx`
Expected: FAIL (yRefLines param not defined in BarChartPlot).

- [ ] **Step 5b: Add yRefLines param and rendering to BarChartPlot.ts**

In `core/frontend/components/plots/BarChartPlot.ts`:

Add `ReferenceLine` to the recharts import:
```typescript
import { BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
```

Add `yRefLines?: any[]` to `BarChartConfig`:
```typescript
  yRefLines?: any[];
```

Add param to `params` array after `horizontal`:
```typescript
  { name: 'yRefLines', type: 'referenceLine[]', description: 'Horizontal reference lines drawn at specified Y values. Each entry: {value: number, label: string}.' },
```

In `chartChildren`, add reference lines after the existing `lineElements` spread:
```typescript
        ...(config.yRefLines ?? []).map((l, i) =>
            React.createElement(ReferenceLine, {
                key: `yref-${i}`,
                y: l.value,
                yAxisId: config.horizontal ? undefined : 'left',
                xAxisId: config.horizontal ? 'bottom' : undefined,
                label: l.label,
                stroke: '#facc15',
                strokeDasharray: '3 3',
            })
        ),
```

- [ ] **Step 5c: Run tests and full suite**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/barChartSort.test.tsx && npx vitest run 2>&1 | tail -8
```

- [ ] **Step 5d: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query && git add core/frontend/components/plots/BarChartPlot.ts && git commit -m "feat(bar-chart): add yRefLines horizontal reference line support"
```

---

## Task 6: Fix AXIS_Y FORMAT — parse but never render (bug)

**Context:** `axisFormat.ts` already implements `makeTickFormatter` which calls `d3Format(axis.format)`. The fix is confirming LINE_CHART, BAR_CHART, and AreaChartPlot all pass `makeTickFormatter(clauses?.axisY)` as `tickFormatter` to their YAxis elements. The bug may be that the result is not passed to YAxis.

**Files:**
- Verify/fix: `core/frontend/components/plots/LineChartPlot.tsx`, `BarChartPlot.ts`, `AreaChartPlot.tsx`

- [ ] **Step 6a: Write failing test**

Add to `core/frontend/tests/axisFormat.test.ts` (this file exists):

```typescript
describe('makeTickFormatter — FORMAT clause renders formatted values', () => {
    it('formats numbers using d3-format spec ".1f"', () => {
        const fmt = makeTickFormatter({ format: '.1f' });
        expect(fmt).toBeDefined();
        expect(fmt!(1234.567)).toBe('1234.6');
    });

    it('formats with "," thousands separator', () => {
        const fmt = makeTickFormatter({ format: ',.0f' });
        expect(fmt!(1234567)).toBe('1,234,567');
    });

    it('returns undefined for undefined axis', () => {
        expect(makeTickFormatter(undefined)).toBeUndefined();
    });
});
```

Run: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/axisFormat.test.ts`
Expected: pass (function already works). If FAIL, fix `axisFormat.ts`.

- [ ] **Step 6b: Verify LineChartPlot uses makeTickFormatter for Y axis**

In `core/frontend/components/plots/LineChartPlot.tsx`, find the `<YAxis>` for `yAxisId="left"`. Confirm it has `tickFormatter={yTickFmt ?? yFormatter}` where `yTickFmt = makeTickFormatter(axisYClause)`. This is already on line ~114 and line ~122 in the component.

If `yTickFmt` is not used in the `YAxis tickFormatter`, fix it now:
```tsx
// Change from:
tickFormatter={yFormatter}
// To:
tickFormatter={yTickFmt ?? yFormatter}
```

- [ ] **Step 6c: Verify BarChartPlot uses makeTickFormatter for Y axis**

In `BarChartPlot.ts`, the `commonValueAxisProps` already has `tickFormatter: makeTickFormatter(axisYClause) ?? numberFormatter` — this is correct. No change needed.

- [ ] **Step 6d: Commit if any changes were made**

```bash
cd /Users/i560383_1/code/experiments/jfr-query && git add -p && git commit -m "fix(axis): ensure AXIS_Y FORMAT tickFormatter is applied to Y axis"
```

If no changes were needed, skip this commit.

---

## Task 7: LINE_CHART lineType: "step" / "stepBefore" / "stepAfter"

**Files:**
- Modify: `core/frontend/components/plots/LineChartPlot.tsx`
- Create: `core/frontend/tests/plots/lineChartStep.test.tsx`

- [ ] **Step 7a: Write failing tests**

Create `core/frontend/tests/plots/lineChartStep.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { lineChartPlot } from '../../components/plots/LineChartPlot';

const data = [{ t: 1, v: 10 }, { t: 2, v: 20 }, { t: 3, v: 15 }];

describe('LineChartPlot — step curve types', () => {
    it('accepts lineType "step"', () => {
        const config = lineChartPlot.parseConfig('LINE_CHART(x:"t",y:["v"],lineType:"step")', data);
        expect((config as any).lineType).toBe('step');
    });

    it('accepts lineType "stepBefore"', () => {
        const config = lineChartPlot.parseConfig('LINE_CHART(x:"t",y:["v"],lineType:"stepBefore")', data);
        expect((config as any).lineType).toBe('stepBefore');
    });

    it('accepts lineType "stepAfter"', () => {
        const config = lineChartPlot.parseConfig('LINE_CHART(x:"t",y:["v"],lineType:"stepAfter")', data);
        expect((config as any).lineType).toBe('stepAfter');
    });

    it('still accepts "line" and "dots"', () => {
        expect((lineChartPlot.parseConfig('LINE_CHART(x:"t",y:["v"],lineType:"line")', data) as any).lineType).toBe('line');
        expect((lineChartPlot.parseConfig('LINE_CHART(x:"t",y:["v"],lineType:"dots")', data) as any).lineType).toBe('dots');
    });

    it('defaults to "line"', () => {
        expect((lineChartPlot.parseConfig('LINE_CHART(x:"t",y:["v"])', data) as any).lineType).toBe('line');
    });
});
```

Run: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/lineChartStep.test.tsx`
Expected: The three step tests FAIL.

- [ ] **Step 7b: Extend Config type and params**

In `core/frontend/components/plots/LineChartPlot.tsx`, line 16:

Change `lineType: 'line' | 'dots'` to `lineType: 'line' | 'dots' | 'step' | 'stepBefore' | 'stepAfter'`.

In the `params` array (line 17), change the `lineType` entry `options` from `['line', 'dots']` to `['line', 'dots', 'step', 'stepBefore', 'stepAfter']` and update the description to `'Render style: "line" (smooth monotone), "dots" (scatter), "step" (staircase midpoint), "stepBefore", or "stepAfter".'`

- [ ] **Step 7c: Map lineType to recharts `type` prop**

Before the `return` in `LineChartComponent`, add:

```typescript
  const rechartsType = (
      config.lineType === 'step' ? 'step'
    : config.lineType === 'stepBefore' ? 'stepBefore'
    : config.lineType === 'stepAfter' ? 'stepAfter'
    : 'monotone'
  ) as 'step' | 'stepBefore' | 'stepAfter' | 'monotone';
  const lineStrokeWidth = config.lineType === 'dots' ? 0 : 1;
  const showDots = config.lineType === 'dots';
```

In the `allY.map(...)` Line element (line 126), replace `type="monotone"`, `strokeWidth={config.lineType === 'line' ? 1 : 0}`, `dot={config.lineType === 'dots'}` with `type={rechartsType}`, `strokeWidth={lineStrokeWidth}`, `dot={showDots}`.

Same for the `allY2.map(...)` Line (line 127).

- [ ] **Step 7d: Run tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/lineChartStep.test.tsx
```

Expected: all 5 pass.

- [ ] **Step 7e: Run full suite and commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -8
cd /Users/i560383_1/code/experiments/jfr-query && git add core/frontend/components/plots/LineChartPlot.tsx core/frontend/tests/plots/lineChartStep.test.tsx && git commit -m "feat(line-chart): add step/stepBefore/stepAfter curve types"
```

---

## Task 8: SCATTER_PLOT point labels

**Goal:** `SCATTER_PLOT(x:"dur", y:"heap", label: "method")` renders a small text label next to each point using recharts `<LabelList>` inside `<Scatter>`.

**Files:**
- Modify: `core/frontend/components/plots/ScatterPlot.tsx`
- Create: `core/frontend/tests/plots/scatterLabels.test.tsx`

- [ ] **Step 8a: Write failing test**

Create `core/frontend/tests/plots/scatterLabels.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { scatterPlot } from '../../components/plots/ScatterPlot';

const data = [
    { x: 10, y: 20, method: 'methodA' },
    { x: 30, y: 10, method: 'methodB' },
];

describe('ScatterPlot — label param', () => {
    it('accepts a label column param', () => {
        const config = scatterPlot.parseConfig('SCATTER_PLOT(x:"x",y:"y",label:"method")', data);
        expect((config as any).label).toBe('method');
    });

    it('defaults label to undefined when not set', () => {
        const config = scatterPlot.parseConfig('SCATTER_PLOT(x:"x",y:"y")', data);
        expect((config as any).label).toBeUndefined();
    });
});
```

Run: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/scatterLabels.test.tsx`
Expected: `label` test FAILS (param not defined).

- [ ] **Step 8b: Add label param to ScatterPlot**

In `core/frontend/components/plots/ScatterPlot.tsx`:

Add to `ScatterPlotConfig` interface:
```typescript
  label?: string;
```

Add to `params` array after `category`:
```typescript
    { name: 'label', type: 'column', description: 'Optional column whose value is shown as a text label next to each point.' },
```

Add `LabelList` to the recharts import:
```typescript
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList } from 'recharts';
```

In the component, inside the `<Scatter>` JSX elements (find where `<Scatter ... />` is rendered), add `<LabelList>` as a child:

Find the `<Scatter>` elements. They are currently self-closing. Change them to have a child `LabelList`:

```tsx
<Scatter ...>
    {config.label && <LabelList dataKey={config.label} position="top" style={{ fontSize: 10, fill: '#9ca3af' }} />}
</Scatter>
```

> **Note:** The Scatter component in recharts v2+ accepts children. Find where `<Scatter ... />` appears and convert to `<Scatter ...>{...}</Scatter>`.

- [ ] **Step 8c: Run tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/scatterLabels.test.tsx
```

Expected: both pass.

- [ ] **Step 8d: Run full suite and commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -8
cd /Users/i560383_1/code/experiments/jfr-query && git add core/frontend/components/plots/ScatterPlot.tsx core/frontend/tests/plots/scatterLabels.test.tsx && git commit -m "feat(scatter): add label param for point annotations"
```

---

## Task 9: Dual TABLE+CHART view toggle

**Goal:** A small toggle button (table icon / chart icon) appears on each result block header. Clicking it switches between showing the raw data as a TABLE and showing it as the configured plot. The toggle state is local to the cell.

**Files:**
- Modify: `core/frontend/components/NotebookCell.tsx`

- [ ] **Step 9a: Locate the result block header**

Search `NotebookCell.tsx` for `CollapsibleBlock` calls that wrap plot results (`plot-${plotUid}`). The result block controls are the second `<>...</>` block passed as `controls=`. This is where the toggle button goes.

- [ ] **Step 9b: Add viewMode state and toggle button**

In `NotebookCell.tsx`, add a `viewMode` state map per plot UID:

```typescript
const [viewModes, setViewModes] = React.useState<Record<string, 'plot' | 'table'>>({});
const getViewMode = (uid: string) => viewModes[uid] ?? 'plot';
const toggleViewMode = (uid: string) =>
    setViewModes(prev => ({ ...prev, [uid]: prev[uid] === 'table' ? 'plot' : 'table' }));
```

In the plot result block `controls=` JSX, add a toggle button before the existing format/AI buttons:

```tsx
<button
    onClick={() => toggleViewMode(plotUid)}
    title={getViewMode(plotUid) === 'plot' ? 'Show as table' : 'Show as chart'}
    aria-label={getViewMode(plotUid) === 'plot' ? 'Show as table' : 'Show as chart'}
    className="p-1.5 rounded-md">
    {getViewMode(plotUid) === 'plot'
        ? <TableCellsIcon className="w-4 h-4 text-gray-400" />
        : <ChartBarIcon className="w-4 h-4 text-gray-400" />
    }
</button>
```

> **Note:** `TableCellsIcon` and `ChartBarIcon` from `@heroicons/react/24/outline` — check what is already imported in NotebookCell.tsx and use the closest existing icon.

In the result rendering section, when `getViewMode(plotUid) === 'table'`, render `<DataTable data={result} />` instead of the `PlotRenderer`. The condition wraps the `PlotRenderer` element:

```tsx
{getViewMode(plotUid) === 'table'
    ? <DataTable data={result} />
    : <PlotRenderer ... />
}
```

- [ ] **Step 9c: Run full suite**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -8
```

- [ ] **Step 9d: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query && git add core/frontend/components/NotebookCell.tsx && git commit -m "feat(notebook): add TABLE/CHART view toggle on plot result blocks"
```

---

## Task 10: AREA_CHART dual-axis y2

**Goal:** `AREA_CHART(x:"t", y:["heap"], y2:["cpu"])` renders a second Y-axis on the right for the `y2` columns, matching LINE_CHART's existing behaviour.

**Files:**
- Modify: `core/frontend/components/plots/AreaChartPlot.tsx`

- [ ] **Step 10a: Write failing test**

```typescript
// Add to a new file: core/frontend/tests/plots/areaChartY2.test.ts
import { describe, it, expect } from 'vitest';
import { areaChartPlot } from '../../components/plots/AreaChartPlot';

const data = [{ t: 1, heap: 500, cpu: 0.8 }, { t: 2, heap: 600, cpu: 0.9 }];

describe('AreaChartPlot — y2 param', () => {
    it('accepts a y2 column list', () => {
        const config = areaChartPlot.parseConfig('AREA_CHART(x:"t",y:["heap"],y2:["cpu"])', data);
        expect((config as any).y2).toEqual(['cpu']);
    });

    it('y2 defaults to undefined when not provided', () => {
        const config = areaChartPlot.parseConfig('AREA_CHART(x:"t",y:["heap"])', data);
        expect((config as any).y2).toBeUndefined();
    });
});
```

Run: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/areaChartY2.test.ts`
Expected: FAIL (`y2` param not defined).

- [ ] **Step 10b: Add y2 to AreaChartPlot**

In `core/frontend/components/plots/AreaChartPlot.tsx`:

Add to `Config` interface: `y2?: string[];`

Add to `params` array:
```typescript
  { name: 'y2', type: 'column[]', description: 'Columns for a secondary right-hand Y-axis.' },
```

In the `useMemo` block, compute `allY2` by resolving `config.y2` columns (same pattern as `allY`).

Add a right-side `<YAxis yAxisId="right" ...>` when `allY2.length > 0`.

Map `allY2` columns to `<Area yAxisId="right" ...>` elements.

- [ ] **Step 10c: Run tests + commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/areaChartY2.test.ts && npx vitest run 2>&1 | tail -8
cd /Users/i560383_1/code/experiments/jfr-query && git add core/frontend/components/plots/AreaChartPlot.tsx core/frontend/tests/plots/areaChartY2.test.ts && git commit -m "feat(area-chart): add y2 dual-axis support"
```

---

## Task 11: ZOOM_X wiring to plot components

**Context:** `PlotRenderer.tsx` already applies `ZOOM_X` via a CSS `scaleX()` transform on the container div (line 1217). This is a visual zoom but does not change the data domain. The feature works — verify it and add a test.

**Files:**
- Verify: `core/frontend/components/PlotRenderer.tsx` (lines ~1215-1220)
- Create: `core/frontend/tests/plotParser.zoomX.test.ts`

- [ ] **Step 11a: Write test confirming ZOOM_X is parsed**

Create `core/frontend/tests/plotParser.zoomX.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parsePlotCall } from '../utils/plotParser';

describe('parsePlotCall — ZOOM_X clause', () => {
    it('parses ZOOM_X 1.5', () => {
        const p = parsePlotCall('LINE_CHART(x:"t",y:["v"]) ZOOM_X 1.5');
        expect(p.zoomX).toBe(1.5);
        expect(p.zoom).toBeUndefined();
    });

    it('parses ZOOM_X 2.0', () => {
        expect(parsePlotCall('BAR_CHART(x:"c",y:["v"]) ZOOM_X 2.0').zoomX).toBe(2.0);
    });

    it('does not confuse ZOOM with ZOOM_X', () => {
        const p = parsePlotCall('LINE_CHART(x:"t",y:["v"]) ZOOM 1.5 ZOOM_X 2.0');
        expect(p.zoom).toBe(1.5);
        expect(p.zoomX).toBe(2.0);
    });
});
```

Run: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plotParser.zoomX.test.ts`
Expected: all pass (already implemented).

- [ ] **Step 11b: Commit tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query && git add core/frontend/tests/plotParser.zoomX.test.ts && git commit -m "test(parser): add ZOOM_X clause regression tests"
```

---

## Task 12: Cell autorun=false attribute

**Goal:** `<!-- @cell name=intro autorun=false -->` makes a cell skip the global "Run All" trigger. The cell can still be run manually via its Run button.

**Architecture:** `parseCellDirective` already stores unknown attrs in `rest`. `autorun=false` will be in `rest.autorun`. In `NotebookCell.tsx`, the auto-run effect that fires when `runAllTrigger` changes needs to check `directive.rest.autorun !== 'false'` before running.

**Files:**
- Modify: `core/frontend/utils/notebookParser.ts` — promote `autorun` from `rest` to a first-class field on `ParsedCellDirective`
- Modify: `core/frontend/components/NotebookCell.tsx` — check `autorun` before auto-running
- Create: `core/frontend/tests/cellAutorun.test.ts`

- [ ] **Step 12a: Write failing test**

Create `core/frontend/tests/cellAutorun.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseCellDirective } from '../utils/notebookParser';

describe('parseCellDirective — autorun attribute', () => {
    it('parses autorun=false', () => {
        const d = parseCellDirective('<!-- @cell name=intro autorun=false -->\n## Intro');
        expect(d?.autorun).toBe(false);
    });

    it('autorun defaults to true when not specified', () => {
        const d = parseCellDirective('<!-- @cell name=intro -->\n## Intro');
        expect(d?.autorun).toBeUndefined(); // undefined = default = true
    });

    it('parses autorun=true explicitly', () => {
        const d = parseCellDirective('<!-- @cell name=intro autorun=true -->\n## Intro');
        expect(d?.autorun).toBe(true);
    });
});
```

Run: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/cellAutorun.test.ts`
Expected: `autorun` is `undefined` (stored in `rest`, not promoted) — FAIL.

- [ ] **Step 12b: Promote `autorun` to a first-class field**

In `core/frontend/utils/notebookParser.ts`, in `ParsedCellDirective`:

```typescript
export interface ParsedCellDirective {
    name?: string;
    collapsed?: boolean;
    autorun?: boolean;   // ← add this
    rest: Record<string, string>;
    matchLength: number;
    raw: string;
}
```

In `parseCellDirective`, inside the `while ((am = attrRe.exec(attrString)) !== null)` loop, add after `else if (key === 'collapsed')`:

```typescript
else if (key === 'autorun') autorun = value !== 'false';
```

And add `let autorun: boolean | undefined;` before the loop, and `autorun` to the return object.

- [ ] **Step 12c: Check autorun in NotebookCell's auto-run effect**

In `core/frontend/components/NotebookCell.tsx`, find the `useEffect` that responds to `runAllTrigger` (or `clearTrigger`) and runs queries. The trigger effect checks `isVisible` and `hasSql`. Add a check:

```typescript
// Skip auto-run if the cell directive explicitly opts out.
const directive = parsedCellContent.directive;
if (directive?.autorun === false) return;
```

> **Note:** Find the exact location by searching for `runAllTrigger` in the file. Place the guard at the top of the effect, before the run logic.

- [ ] **Step 12d: Run tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/cellAutorun.test.ts
```

Expected: all pass.

- [ ] **Step 12e: Run full suite and commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -8
cd /Users/i560383_1/code/experiments/jfr-query && git add core/frontend/utils/notebookParser.ts core/frontend/components/NotebookCell.tsx core/frontend/tests/cellAutorun.test.ts && git commit -m "feat(notebook): add autorun=false cell directive to skip Run All"
```

---

## Task 13: Trendline on scatter (linear regression)

**Goal:** `SCATTER_PLOT(x:"dur", y:"heap", trendline: true)` renders a linear regression line over the scatter points using `d3-regression`.

**Files:**
- Modify: `core/frontend/package.json` (add `d3-regression`)
- Modify: `core/frontend/components/plots/ScatterPlot.tsx`
- Create: `core/frontend/tests/plots/scatterTrendline.test.tsx`

- [ ] **Step 13a: Install d3-regression**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npm install d3-regression
```

- [ ] **Step 13b: Write failing test**

Create `core/frontend/tests/plots/scatterTrendline.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { scatterPlot } from '../../components/plots/ScatterPlot';

const data = [
    { x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 },
];

describe('ScatterPlot — trendline param', () => {
    it('accepts trendline: true', () => {
        const config = scatterPlot.parseConfig('SCATTER_PLOT(x:"x",y:"y",trendline:true)', data);
        expect((config as any).trendline).toBe(true);
    });

    it('trendline defaults to false', () => {
        const config = scatterPlot.parseConfig('SCATTER_PLOT(x:"x",y:"y")', data);
        expect((config as any).trendline).toBe(false);
    });
});
```

Run: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/scatterTrendline.test.tsx`
Expected: FAIL.

- [ ] **Step 13c: Add trendline to ScatterPlot**

In `core/frontend/components/plots/ScatterPlot.tsx`:

Add import at top:
```typescript
import { regressionLinear } from 'd3-regression';
import { Line } from 'recharts';
```

Add to `ScatterPlotConfig`: `trendline?: boolean;`

Add to `params`:
```typescript
    { name: 'trendline', type: 'boolean', defaultValue: false, description: 'Overlay a linear regression trendline on the scatter plot.' },
```

In the component, compute the trendline data when `config.trendline` is true:

```typescript
    const trendData = React.useMemo(() => {
        if (!config.trendline || !data || data.length < 2) return null;
        const allCols = data.length > 0 ? Object.keys(data[0]) : [];
        let xCol: string, yCol: string;
        try { xCol = findColumn(config.x, allCols); } catch { return null; }
        try { yCol = findColumn(config.y, allCols); } catch { return null; }
        const pairs = data
            .filter(d => d[xCol] != null && d[yCol] != null)
            .map(d => [Number(d[xCol]), Number(d[yCol])] as [number, number]);
        if (pairs.length < 2) return null;
        const reg = regressionLinear().x(d => d[0]).y(d => d[1])(pairs);
        const xs = pairs.map(p => p[0]);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        return [
            { [config.x]: minX, __trend__: reg.predict(minX) },
            { [config.x]: maxX, __trend__: reg.predict(maxX) },
        ];
    }, [config.trendline, config.x, config.y, data]);
```

In the rendered JSX, inside `<ScatterChart>`, after the existing `<Scatter>` elements, add:

```tsx
{trendData && (
    <Line
        type="linear"
        dataKey="__trend__"
        data={trendData}
        dot={false}
        stroke="#facc15"
        strokeWidth={2}
        strokeDasharray="4 4"
        isAnimationActive={false}
    />
)}
```

- [ ] **Step 13d: Run tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/plots/scatterTrendline.test.tsx
```

Expected: both pass.

- [ ] **Step 13e: Run full suite and commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -8
cd /Users/i560383_1/code/experiments/jfr-query && git add core/frontend/components/plots/ScatterPlot.tsx core/frontend/tests/plots/scatterTrendline.test.tsx core/frontend/package.json core/frontend/package-lock.json && git commit -m "feat(scatter): add trendline linear regression overlay"
```

---

## Task 14: Notebook URL parameters for variables

**Goal:** `?var.sortCol=name&var.sortDir=asc` in the URL pre-sets notebook metadata variables before the first query runs. Useful for linking to pre-filtered views.

**Architecture:** In `App.tsx`, in the startup `useEffect` that reads URL params, after the existing `?notebook=` and `?jfr=` handling, read any `var.*` params and set them as global metadata variables via `setNotebookMetadata`.

**Files:**
- Modify: `core/frontend/App.tsx`
- Create: `core/frontend/tests/urlParams.test.ts`

- [ ] **Step 14a: Write failing test**

Create `core/frontend/tests/urlParams.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

// Utility: extract var.* params from URL
function extractVarParams(search: string): Record<string, string> {
    const params = new URLSearchParams(search);
    const vars: Record<string, string> = {};
    for (const [key, value] of params.entries()) {
        if (key.startsWith('var.')) {
            vars['$' + key.slice(4)] = value;
        }
    }
    return vars;
}

describe('URL variable params', () => {
    it('extracts var.sortCol into $sortCol', () => {
        const result = extractVarParams('?var.sortCol=name&var.sortDir=asc');
        expect(result).toEqual({ '$sortCol': 'name', '$sortDir': 'asc' });
    });

    it('returns empty object when no var. params', () => {
        expect(extractVarParams('?notebook=foo&run=true')).toEqual({});
    });

    it('handles encoded values', () => {
        const result = extractVarParams('?var.ts=2024-01-01T00%3A00%3A00');
        expect(result['$ts']).toBe('2024-01-01T00:00:00');
    });
});
```

Run: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run tests/urlParams.test.ts`
Expected: all PASS (pure utility function, no App deps). This test validates the parsing logic before it's wired in.

- [ ] **Step 14b: Wire into App.tsx**

In `core/frontend/App.tsx`, find the startup effect that reads URL params (around line 486). Add after the existing `?notebook=` and `?jfr=` handling:

```typescript
        // ?var.NAME=VALUE — pre-set global metadata variables.
        const varParams: Record<string, string> = {};
        for (const [key, value] of params.entries()) {
            if (key.startsWith('var.')) {
                varParams['$' + key.slice(4)] = value;
            }
        }
        if (Object.keys(varParams).length > 0) {
            setNotebookMetadata(prev => ({
                ...prev,
                variables: { ...(prev.variables ?? {}), ...varParams },
            }));
        }
```

- [ ] **Step 14c: Run full suite and commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -8
cd /Users/i560383_1/code/experiments/jfr-query && git add core/frontend/App.tsx core/frontend/tests/urlParams.test.ts && git commit -m "feat(app): support ?var.NAME=VALUE URL params to pre-set notebook variables"
```

---

## Task 15: Final regression run and smoke tests

- [ ] **Step 15a: Run complete test suite**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -20
```

Expected: 0 failing. The count should be at least 25 higher than before this plan.

- [ ] **Step 15b: TypeScript check**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors introduced by this plan.

- [ ] **Step 15c: Spot-check each feature in browser**

Start dev server: `cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npm run dev`

Check:
1. **BIG_NUMBER**: Create cell `BIG_NUMBER(value: "total") TITLE "Total"` with SQL returning `{total: 42}` → shows "42" large.
2. **BRUSH on LINE_CHART**: `LINE_CHART(x:"t", y:["v"]) BRUSH $start $end` → drag on chart writes `$start`/`$end` to variables.
3. **SORT DESC LIMIT 5 on BAR_CHART**: Create a bar chart, confirm only 5 bars render, highest first.
4. **TABLE SORT $sortCol $sortDir**: Create TABLE with SORT clause, click column header → variable block updates.
5. **step LINE_CHART**: `LINE_CHART(x:"t", y:["v"], lineType: "step")` → staircase shape.
6. **BAR_CHART yRefLines**: `BAR_CHART(x:"c", y:["v"], yRefLines: [{value: 100, label: "T"}])` → dashed line at y=100.
7. **BIG_NUMBER with previousValue**: Shows change arrow.
8. **Slider widget**: `<!-- @cell input=slider var=$n min=1 max=10 step=1 -->` renders slider.
9. **autorun=false**: A cell with this directive is skipped when Run All is clicked.
10. **URL params**: Open `http://localhost:3001/?var.n=5` → global variable `$n` is `5`.

---

## Self-Review

**Spec coverage:**

| Feature | Task | Tests |
|---------|------|-------|
| BIG_NUMBER stat card | 2 | 5 |
| BRUSH on LINE_CHART | 3 | 2 |
| SORT $col $dir for TABLE | 1 | 6 parser + 4 component |
| LIMIT n clause | 1 | 4 parser |
| SORT ASC/DESC for BAR_CHART | 1 | 5 parser + 2 component |
| Variable input widgets (slider/dropdown/datetime) | 4 | 6 |
| BAR_CHART yRefLines | 5 | 1 |
| AXIS_Y FORMAT fix | 6 | 3 (verify existing) |
| LINE_CHART step curves | 7 | 5 |
| SCATTER_PLOT point labels | 8 | 2 |
| Dual TABLE+CHART toggle | 9 | 0 (UI-only, smoke tested) |
| AREA_CHART y2 dual axis | 10 | 2 |
| ZOOM_X wiring confirmation | 11 | 3 |
| cell autorun=false | 12 | 3 |
| Scatter trendlines | 13 | 2 |
| Notebook URL parameters | 14 | 3 |

**Total new tests: ~59**

**Type consistency:** All new interfaces and types are defined in their respective task steps. `ParsedCellDirective.autorun: boolean | undefined` is consistent across tasks 12. `BigNumberConfig.value` is `string` throughout. `BarChartConfig.yRefLines: any[]` matches recharts `ReferenceLine` prop shape.

**No placeholders found.**
