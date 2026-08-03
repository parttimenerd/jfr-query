# GC Analysis Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SQL convenience macros, plot improvements, and a substantially richer GC analysis notebook template covering overhead, histograms, metaspace, G1 regions, tenuring, concurrent phases, and more.

**Architecture:** Three independent layers, implemented in order: (1) SQL macros in `builtinSql.ts` — pure DuckDB macro strings, tested by running them as SQL; (2) frontend utilities in `plotUtils.ts` and `HistogramPlot.tsx` — pure TypeScript, tested with vitest; (3) template cells in `gc-analysis.md` and `builtinSql.ts` conditional views — tested by reading the template structure and verifying conditional SQL compiles.

**Tech Stack:** TypeScript, Vitest, DuckDB (SQL macros), React (plot components), Recharts

---

## File Map

| File | Change |
|------|--------|
| `core/frontend/data/builtinSql.ts` | Add 6 macros to `BUILTIN_MACROS_SQL`; add 3 conditional views to `CONDITIONAL_VIEWS_SQL` |
| `core/frontend/utils/plotUtils.ts` | Add `spectral`/`rdylgn` palettes; extend `buildSmartTemplate` with GANTT/RANGE/AREA_CHART/VIOLIN_PLOT |
| `core/frontend/components/plots/HistogramPlot.tsx` | Add `yLog` param; wire it to the Y-axis |
| `core/frontend/data/templates/builtin/gc-analysis.md` | Add 10 new cells; add 3 new `cellConditions` entries |
| `core/frontend/tests/ml/classifyColumns.test.ts` | Already written — run to verify baseline |
| `core/frontend/tests/components/plots/HistogramPlot.test.ts` | Add tests for `yLog` param |
| `core/frontend/tests/plot/macros.test.ts` | New: SQL macro smoke tests |

---

## Task 1: SQL macros — P50, P25, P75

**Files:**
- Modify: `core/frontend/data/builtinSql.ts` (after `P999` line ~9)
- Test: `core/frontend/tests/plot/macros.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `core/frontend/tests/plot/macros.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { BUILTIN_MACROS_SQL } from '../../data/builtinSql';

describe('BUILTIN_MACROS_SQL — P-family completeness', () => {
    it('defines P50', () => {
        expect(BUILTIN_MACROS_SQL.some(s => s.includes('MACRO P50'))).toBe(true);
    });
    it('defines P25', () => {
        expect(BUILTIN_MACROS_SQL.some(s => s.includes('MACRO P25'))).toBe(true);
    });
    it('defines P75', () => {
        expect(BUILTIN_MACROS_SQL.some(s => s.includes('MACRO P75'))).toBe(true);
    });
    it('P50 uses quantile 0.50', () => {
        const sql = BUILTIN_MACROS_SQL.find(s => s.includes('MACRO P50'))!;
        expect(sql).toContain('0.50');
    });
    it('P25 uses quantile 0.25', () => {
        const sql = BUILTIN_MACROS_SQL.find(s => s.includes('MACRO P25'))!;
        expect(sql).toContain('0.25');
    });
    it('P75 uses quantile 0.75', () => {
        const sql = BUILTIN_MACROS_SQL.find(s => s.includes('MACRO P75'))!;
        expect(sql).toContain('0.75');
    });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
cd core/frontend && npx vitest run tests/plot/macros.test.ts
```
Expected: 6 failures — `P50`/`P25`/`P75` not defined yet.

- [ ] **Step 3: Add the macros to `builtinSql.ts`**

In `BUILTIN_MACROS_SQL`, directly after the `P999` line (line ~9):

```typescript
  `CREATE OR REPLACE MACRO P50(col) AS quantile(col, 0.50)`,
  `CREATE OR REPLACE MACRO P25(col) AS quantile(col, 0.25)`,
  `CREATE OR REPLACE MACRO P75(col) AS quantile(col, 0.75)`,
```

- [ ] **Step 4: Run the test to confirm it passes**

```
cd core/frontend && npx vitest run tests/plot/macros.test.ts
```
Expected: 6 pass.

- [ ] **Step 5: Commit**

```bash
git add core/frontend/data/builtinSql.ts core/frontend/tests/plot/macros.test.ts
git commit -m "feat(sql): add P50, P25, P75 macro aliases for percentile consistency"
```

---

## Task 2: SQL macro — `bucket_time`

**Files:**
- Modify: `core/frontend/data/builtinSql.ts` (after `bucket_ms`)
- Modify: `core/frontend/tests/plot/macros.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `macros.test.ts`:

```typescript
describe('BUILTIN_MACROS_SQL — bucket_time', () => {
    it('defines bucket_time', () => {
        expect(BUILTIN_MACROS_SQL.some(s => s.includes('MACRO bucket_time'))).toBe(true);
    });
    it('bucket_time uses epoch_ms twice (round-trip to TIMESTAMP)', () => {
        const sql = BUILTIN_MACROS_SQL.find(s => s.includes('MACRO bucket_time'))!;
        const matches = (sql.match(/epoch_ms/g) || []).length;
        expect(matches).toBeGreaterThanOrEqual(2);
    });
});
```

- [ ] **Step 2: Run to confirm failure**

```
cd core/frontend && npx vitest run tests/plot/macros.test.ts
```
Expected: 2 new failures.

- [ ] **Step 3: Add `bucket_time` to `builtinSql.ts`**

Directly after the `bucket_ms` macro (~line 156):

```typescript
  // Returns a TIMESTAMP (not a raw integer) so LINE_CHART auto-formats the axis.
  `CREATE OR REPLACE MACRO bucket_time(ts, width_ms) AS (
  epoch_ms(epoch_ms(ts) - (epoch_ms(ts) % width_ms))
)`,
```

- [ ] **Step 4: Run tests**

```
cd core/frontend && npx vitest run tests/plot/macros.test.ts
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add core/frontend/data/builtinSql.ts core/frontend/tests/plot/macros.test.ts
git commit -m "feat(sql): add bucket_time macro returning TIMESTAMP instead of epoch integer"
```

---

## Task 3: SQL macros — `format_rate` and `reclaim_mb`

**Files:**
- Modify: `core/frontend/data/builtinSql.ts`
- Modify: `core/frontend/tests/plot/macros.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `macros.test.ts`:

```typescript
describe('BUILTIN_MACROS_SQL — format_rate', () => {
    it('defines format_rate', () => {
        expect(BUILTIN_MACROS_SQL.some(s => s.includes('MACRO format_rate'))).toBe(true);
    });
    it('format_rate handles GB/s, MB/s, KB/s, B/s tiers', () => {
        const sql = BUILTIN_MACROS_SQL.find(s => s.includes('MACRO format_rate'))!;
        expect(sql).toContain('GB/s');
        expect(sql).toContain('MB/s');
        expect(sql).toContain('KB/s');
        expect(sql).toContain('B/s');
    });
});

describe('BUILTIN_MACROS_SQL — reclaim_mb', () => {
    it('defines reclaim_mb', () => {
        expect(BUILTIN_MACROS_SQL.some(s => s.includes('MACRO reclaim_mb'))).toBe(true);
    });
    it('reclaim_mb divides by 1048576', () => {
        const sql = BUILTIN_MACROS_SQL.find(s => s.includes('MACRO reclaim_mb'))!;
        expect(sql).toContain('1048576');
    });
    it('reclaim_mb calls HEAP_BEFORE_GC and HEAP_AFTER_GC', () => {
        const sql = BUILTIN_MACROS_SQL.find(s => s.includes('MACRO reclaim_mb'))!;
        expect(sql).toContain('HEAP_BEFORE_GC');
        expect(sql).toContain('HEAP_AFTER_GC');
    });
});
```

- [ ] **Step 2: Run to confirm failures**

```
cd core/frontend && npx vitest run tests/plot/macros.test.ts
```
Expected: 5 new failures.

- [ ] **Step 3: Add the macros to `builtinSql.ts`**

After `format_hex` (~line 99):

```typescript
  `CREATE OR REPLACE MACRO format_rate(bytes_per_sec, decimals := 2) AS (
  CASE
    WHEN bytes_per_sec IS NULL THEN NULL
    WHEN abs(bytes_per_sec) >= 1073741824 THEN format_decimals(bytes_per_sec / 1073741824.0, decimals) || ' GB/s'
    WHEN abs(bytes_per_sec) >= 1048576    THEN format_decimals(bytes_per_sec / 1048576.0,    decimals) || ' MB/s'
    WHEN abs(bytes_per_sec) >= 1024       THEN format_decimals(bytes_per_sec / 1024.0,       decimals) || ' KB/s'
    ELSE format_decimals(bytes_per_sec * 1.0, decimals) || ' B/s'
  END
)`,
```

After the `GC_TYPE` macro (~line 150):

```typescript
  `CREATE OR REPLACE MACRO reclaim_mb(gc_id) AS (
  (HEAP_BEFORE_GC(gc_id) - HEAP_AFTER_GC(gc_id)) / 1048576.0
)`,
```

- [ ] **Step 4: Run tests**

```
cd core/frontend && npx vitest run tests/plot/macros.test.ts
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add core/frontend/data/builtinSql.ts core/frontend/tests/plot/macros.test.ts
git commit -m "feat(sql): add format_rate and reclaim_mb convenience macros"
```

---

## Task 4: Diverging palettes (`spectral`, `rdylgn`)

**Files:**
- Modify: `core/frontend/utils/plotUtils.ts` (the `PALETTES` map, lines 4–10)
- Test: `core/frontend/tests/utils/plotUtils.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `core/frontend/tests/utils/plotUtils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getPaletteColors } from '../../utils/plotUtils';

describe('getPaletteColors — diverging palettes', () => {
    it('spectral returns 8 colors', () => {
        const colors = getPaletteColors('spectral', []);
        expect(colors).toHaveLength(8);
    });
    it('rdylgn returns 8 colors', () => {
        const colors = getPaletteColors('rdylgn', []);
        expect(colors).toHaveLength(8);
    });
    it('spectral colors are valid CSS hex strings', () => {
        const colors = getPaletteColors('spectral', []);
        colors.forEach(c => expect(c).toMatch(/^#[0-9a-f]{6}$/i));
    });
    it('rdylgn colors are valid CSS hex strings', () => {
        const colors = getPaletteColors('rdylgn', []);
        colors.forEach(c => expect(c).toMatch(/^#[0-9a-f]{6}$/i));
    });
    it('unknown palette name falls back to provided default', () => {
        const fallback = ['#aabbcc'];
        expect(getPaletteColors('nonexistent', fallback)).toEqual(fallback);
    });
    it('existing palette category10 still works', () => {
        expect(getPaletteColors('category10', [])).toHaveLength(10);
    });
});
```

- [ ] **Step 2: Run to confirm failure**

```
cd core/frontend && npx vitest run tests/utils/plotUtils.test.ts
```
Expected: 2 failures for `spectral` and `rdylgn`.

- [ ] **Step 3: Add palettes to `plotUtils.ts`**

In the `PALETTES` map (after `set2`):

```typescript
    spectral: ['#d53e4f','#f46d43','#fdae61','#fee08b','#e6f598','#abdda4','#66c2a5','#3288bd'],
    rdylgn:   ['#d73027','#f46d43','#fdae61','#fee090','#d9ef8b','#a6d96a','#66bd63','#1a9850'],
```

- [ ] **Step 4: Run tests**

```
cd core/frontend && npx vitest run tests/utils/plotUtils.test.ts
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add core/frontend/utils/plotUtils.ts core/frontend/tests/utils/plotUtils.test.ts
git commit -m "feat(plot): add spectral and rdylgn diverging color palettes"
```

---

## Task 5: `buildSmartTemplate` for GANTT, RANGE, AREA_CHART, VIOLIN_PLOT

**Files:**
- Modify: `core/frontend/utils/plotUtils.ts` (the `buildSmartTemplate` switch, lines 258–311)
- Modify: `core/frontend/tests/utils/plotUtils.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `plotUtils.test.ts`:

```typescript
import { buildSmartTemplate } from '../../utils/plotUtils';

describe('buildSmartTemplate — GANTT', () => {
    it('picks start/end columns by name, lane from category', () => {
        const cols = ['startTime', 'endTime', 'phase'];
        const row = { startTime: 1000, endTime: 2000, phase: 'G1 Young' };
        const t = buildSmartTemplate('GANTT', cols, row)!;
        expect(t).toContain('start: "startTime"');
        expect(t).toContain('end: "endTime"');
        expect(t).toContain('lane: "phase"');
    });
    it('falls back to blank template when no start/end found', () => {
        const cols = ['bucket', 'pauseMs'];
        const row = { bucket: 1000, pauseMs: 5 };
        const t = buildSmartTemplate('GANTT', cols, row);
        expect(t).toContain('GANTT(');
    });
});

describe('buildSmartTemplate — RANGE', () => {
    it('picks low/high by looksLikeRangeBound, x from time col', () => {
        const cols = ['bucket', 'p25', 'p75'];
        const row = { bucket: 1000, p25: 5, p75: 20 };
        const t = buildSmartTemplate('RANGE', cols, row)!;
        expect(t).toContain('low: "p25"');
        expect(t).toContain('high: "p75"');
        expect(t).toContain('x: "bucket"');
    });
    it('falls back gracefully with no range columns', () => {
        const t = buildSmartTemplate('RANGE', ['bucket', 'count'], null);
        expect(t).toContain('RANGE(');
    });
});

describe('buildSmartTemplate — AREA_CHART', () => {
    it('picks time x and numeric ys', () => {
        const cols = ['bucket', 'heapUsed', 'heapFree'];
        const row = { bucket: 1000, heapUsed: 500, heapFree: 300 };
        const t = buildSmartTemplate('AREA_CHART', cols, row)!;
        expect(t).toContain('x: "bucket"');
        expect(t).toContain('"heapUsed"');
    });
    it('uses stacked layout when col names suggest accumulative data', () => {
        const cols = ['bucket', 'heapUsed', 'heapFree', 'metaspaceUsed'];
        const row = { bucket: 1000, heapUsed: 500, heapFree: 300, metaspaceUsed: 50 };
        const t = buildSmartTemplate('AREA_CHART', cols, row)!;
        expect(t).toContain('layout: "stacked"');
    });
});

describe('buildSmartTemplate — VIOLIN_PLOT', () => {
    it('picks numeric value col and category col', () => {
        const cols = ['gcCause', 'pauseMs'];
        const row = { gcCause: 'G1 Young', pauseMs: 5 };
        const t = buildSmartTemplate('VIOLIN_PLOT', cols, row)!;
        expect(t).toContain('value: "pauseMs"');
        expect(t).toContain('category: "gcCause"');
    });
    it('works with no category col (single numeric)', () => {
        const cols = ['pauseMs'];
        const row = { pauseMs: 5 };
        const t = buildSmartTemplate('VIOLIN_PLOT', cols, row)!;
        expect(t).toContain('value: "pauseMs"');
    });
});
```

- [ ] **Step 2: Run to confirm failures**

```
cd core/frontend && npx vitest run tests/utils/plotUtils.test.ts
```
Expected: the 8 new GANTT/RANGE/AREA/VIOLIN tests fail (fall through to `return null`).

- [ ] **Step 3: Extend `buildSmartTemplate` in `plotUtils.ts`**

Add this import at the top of `plotUtils.ts` (after the existing imports):

```typescript
import { looksLikeStartName, looksLikeEndName, looksLikeRangeBound } from '../services/ml/classifyColumns';
```

The `STACKED_NAMES_RE` pattern (mirrors the one in `heuristicPlot.ts`):

```typescript
const STACKED_NAMES_RE = /pct|percent|share|portion|fraction|alloc|heap|eden|survivor|metaspace|reserved|committed|used|free|available/i;
```

Add these cases to the `switch` block in `buildSmartTemplate`, before the `default:` case:

```typescript
        case 'AREA_CHART': {
            const xCol = timeCols[0] ?? columns[0];
            const yCols = numericCols.length > 0 ? numericCols.slice(0, 4) : columns.filter(c => c !== xCol).slice(0, 2);
            if (yCols.length === 0) return 'AREA_CHART(x: , y: [])';
            const stacked = yCols.length >= 2 && yCols.every(c => STACKED_NAMES_RE.test(c));
            const layoutPart = stacked ? ', layout: "stacked"' : '';
            return `AREA_CHART(x: ${q(xCol)}, y: [${ql(yCols)}]${layoutPart})`;
        }
        case 'GANTT': {
            const allCols = columns;
            const startCol = allCols.find(c => looksLikeStartName(c));
            const endCol   = allCols.find(c => looksLikeEndName(c));
            const laneCol  = categoryCols[0] ?? allCols.find(c => c !== startCol && c !== endCol);
            if (!startCol || !endCol || !laneCol) return 'GANTT(start: , end: , lane: )';
            const taskCol  = categoryCols[1];
            const taskPart = taskCol ? `, task: ${q(taskCol)}` : '';
            return `GANTT(start: ${q(startCol)}, end: ${q(endCol)}, lane: ${q(laneCol)}${taskPart})`;
        }
        case 'RANGE': {
            const xCol = timeCols[0] ?? categoryCols[0] ?? columns[0];
            const lowCol  = numericCols.find(c => looksLikeRangeBound(c) === 'low');
            const highCol = numericCols.find(c => looksLikeRangeBound(c) === 'high');
            if (!lowCol || !highCol) return 'RANGE(x: , low: , high: )';
            const centerCol = numericCols.find(c => c !== lowCol && c !== highCol && looksLikeRangeBound(c) === null);
            const centerPart = centerCol ? `, center: ${q(centerCol)}` : '';
            return `RANGE(x: ${q(xCol)}, low: ${q(lowCol)}, high: ${q(highCol)}${centerPart})`;
        }
        case 'VIOLIN_PLOT': {
            const valCol = numericCols[0] ?? columns[0];
            const catCol = categoryCols[0];
            const catPart = catCol ? `, category: ${q(catCol)}` : '';
            return `VIOLIN_PLOT(value: ${q(valCol)}${catPart})`;
        }
```

- [ ] **Step 4: Run tests**

```
cd core/frontend && npx vitest run tests/utils/plotUtils.test.ts
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add core/frontend/utils/plotUtils.ts core/frontend/tests/utils/plotUtils.test.ts
git commit -m "feat(plot): add buildSmartTemplate heuristics for GANTT, RANGE, AREA_CHART, VIOLIN_PLOT"
```

---

## Task 6: HISTOGRAM `yLog` parameter

**Files:**
- Modify: `core/frontend/components/plots/HistogramPlot.tsx`
- Modify: `core/frontend/tests/components/plots/HistogramPlot.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the existing `tests/components/plots/HistogramPlot.test.ts` registration section:

```typescript
    it('yLog param defaults to false', () => {
        expect(histogramPlot.params.find(p => p.name === 'yLog')?.defaultValue).toBe(false);
    });
```

Add to the parseConfig section:

```typescript
    it('parses yLog: true', () => {
        expect(histogramPlot.parseConfig('HISTOGRAM(x: "v", yLog: true)', []).yLog).toBe(true);
    });
    it('yLog defaults to false when absent', () => {
        expect(histogramPlot.parseConfig('HISTOGRAM(x: "v")', []).yLog).toBe(false);
    });
```

- [ ] **Step 2: Run to confirm failures**

```
cd core/frontend && npx vitest run tests/components/plots/HistogramPlot.test.ts
```
Expected: 3 failures.

- [ ] **Step 3: Add `yLog` to `HistogramPlot.tsx`**

Change the `Config` interface (line 12):

```typescript
interface Config { x: string; bins: number | string; logScale: boolean; logBins: boolean; xDomain: any[]; yLog: boolean; }
```

Add the new param to the `params` array (after the `xDomain` param, before the deprecated `value` alias):

```typescript
    { name: 'yLog', type: 'boolean', defaultValue: false, description: 'Use a logarithmic scale for the frequency (Y) axis.' },
```

In `HistogramComponent`, change the `effectiveLogScale` line:

```typescript
    const effectiveLogScale = clauses?.axisY?.type === 'log' ? true : (config.logScale || config.yLog);
```

- [ ] **Step 4: Run tests**

```
cd core/frontend && npx vitest run tests/components/plots/HistogramPlot.test.ts
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add core/frontend/components/plots/HistogramPlot.tsx core/frontend/tests/components/plots/HistogramPlot.test.ts
git commit -m "feat(plot): add yLog parameter to HISTOGRAM for log-scale frequency axis"
```

---

## Task 7: Three new conditional SQL views for GC template

**Files:**
- Modify: `core/frontend/data/builtinSql.ts` (`CONDITIONAL_VIEWS_SQL` array)
- Modify: `core/frontend/tests/plot/macros.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `macros.test.ts`:

```typescript
import { CONDITIONAL_VIEWS_SQL } from '../../data/builtinSql';

describe('CONDITIONAL_VIEWS_SQL — new GC views', () => {
    const findView = (name: string) =>
        CONDITIONAL_VIEWS_SQL.find(e => {
            const sql = typeof e === 'string' ? e : (e as any).sql ?? '';
            return sql.includes(`"${name}"`);
        });

    it('defines metaspace-over-time view', () => {
        expect(findView('metaspace-over-time')).toBeDefined();
    });
    it('metaspace-over-time requires MetaspaceSummary', () => {
        const entry = CONDITIONAL_VIEWS_SQL.find(e => {
            const sql = typeof e === 'string' ? e : (e as any).sql ?? '';
            return sql.includes('"metaspace-over-time"');
        }) as any;
        expect(entry?.requires).toBe('MetaspaceSummary');
    });
    it('defines g1-heap-regions view', () => {
        expect(findView('g1-heap-regions')).toBeDefined();
    });
    it('g1-heap-regions requires G1HeapSummary', () => {
        const entry = CONDITIONAL_VIEWS_SQL.find(e => {
            const sql = typeof e === 'string' ? e : (e as any).sql ?? '';
            return sql.includes('"g1-heap-regions"');
        }) as any;
        expect(entry?.requires).toBe('G1HeapSummary');
    });
    it('defines tenuring-distribution view', () => {
        expect(findView('tenuring-distribution')).toBeDefined();
    });
    it('tenuring-distribution requires TenuringDistribution', () => {
        const entry = CONDITIONAL_VIEWS_SQL.find(e => {
            const sql = typeof e === 'string' ? e : (e as any).sql ?? '';
            return sql.includes('"tenuring-distribution"');
        }) as any;
        expect(entry?.requires).toBe('TenuringDistribution');
    });
});
```

- [ ] **Step 2: Run to confirm failures**

```
cd core/frontend && npx vitest run tests/plot/macros.test.ts
```
Expected: 6 new failures.

- [ ] **Step 3: Add the three views to `builtinSql.ts`**

Locate `CONDITIONAL_VIEWS_SQL` (the array of `{ requires, sql }` objects). Add these three entries — position doesn't matter, but placing them near the other GC views is cleanest:

```typescript
  {
    requires: 'MetaspaceSummary',
    sql: `CREATE OR REPLACE VIEW "metaspace-over-time" AS
SELECT
    g.startTime AS "Time",
    round(ms.metaspace$used / 1048576.0, 1) AS "Metaspace Used MB",
    round(ms.metaspace$committed / 1048576.0, 1) AS "Metaspace Committed MB",
    round(ms.gcThreshold / 1048576.0, 1) AS "GC Threshold MB"
FROM MetaspaceSummary ms
JOIN GarbageCollection g ON ms.gcId = g.gcId
WHERE ms."when" = 'After GC'
ORDER BY g.startTime`,
  },
  {
    requires: 'G1HeapSummary',
    sql: `CREATE OR REPLACE VIEW "g1-heap-regions" AS
SELECT
    g.startTime AS "Time",
    round(s.edenUsedSize / 1048576.0, 1) AS "Eden MB",
    round(s.survivorUsedSize / 1048576.0, 1) AS "Survivor MB",
    round(s.oldGenUsedSize / 1048576.0, 1) AS "Old Gen MB"
FROM G1HeapSummary s
JOIN GarbageCollection g ON s.gcId = g.gcId
WHERE s."when" = 'After GC'
ORDER BY g.startTime`,
  },
  {
    requires: 'TenuringDistribution',
    sql: `CREATE OR REPLACE VIEW "tenuring-distribution" AS
SELECT
    td.age AS "Age",
    SUM(td.count) AS "Objects",
    round(SUM(td.size) / 1048576.0, 3) AS "MB",
    MAX(sc.maxTenuringThreshold) AS "Max Tenure Threshold",
    round(MAX(sc.desiredSurvivorSize) / 1048576.0, 1) AS "Desired Survivor MB"
FROM TenuringDistribution td
JOIN GCSurvivorConfiguration sc ON td.gcId = sc.gcId
WHERE td.gcId = (SELECT max(gcId) FROM GarbageCollection)
GROUP BY td.age
ORDER BY td.age`,
  },
```

- [ ] **Step 4: Run tests**

```
cd core/frontend && npx vitest run tests/plot/macros.test.ts
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add core/frontend/data/builtinSql.ts core/frontend/tests/plot/macros.test.ts
git commit -m "feat(sql): add metaspace-over-time, g1-heap-regions, tenuring-distribution views"
```

---

## Task 8: GC template — configuration, overhead, pause histogram cells

These three cells use views that already exist. Edit `core/frontend/data/templates/builtin/gc-analysis.md`.

**Files:**
- Modify: `core/frontend/data/templates/builtin/gc-analysis.md`

- [ ] **Step 1: Add `gc-config` cell after `overview` cell (after line 46)**

Insert between the `<!-- @cell name=overview -->` block and `<!-- @cell name=pause-summary -->`:

```markdown
<!-- @cell name=gc-config -->

## GC & Heap Configuration

Collector, thread counts, pause target, and heap sizing for this recording.

```sql
-- alias gc_config
SELECT * FROM "gc-configuration"
```

```sql
-- alias heap_config
SELECT * FROM "heap-configuration"
```

```plot
TABLE() ON gc_config
```

```plot
TABLE() ON heap_config
```

---
```

- [ ] **Step 2: Add `gc-overhead` cell after `allocation-rate` cell (at end of file)**

Append to the end of the file:

```markdown
<!-- @cell name=gc-overhead -->

## GC Overhead Over Time

Stop-the-world time as a percentage of each 10-second window. Sustained values above ~5% indicate the collector is competing significantly with the application.

```sql
SELECT "Window" AS "Time", "GC Overhead %", "Collections"
FROM "gc-overhead"
ORDER BY 1
```

```plot
LINE_CHART(x: "Time", y: ["GC Overhead %"]) TITLE "GC Overhead % (10-second windows)" LINK_X($start, $end) ZOOM AXIS_Y DOMAIN [0, 100] LABEL "%"
```

---

<!-- @cell name=pause-histogram -->

## Pause Duration Distribution

Distribution of individual stop-the-world pause durations. Log-scale bins reveal the long tail that averages hide — a bimodal distribution (many fast + a few very long) is a common GC tuning problem.

```sql
SELECT round(duration * 1000, 3) AS "Pause (ms)"
FROM GCPhasePause
WHERE name NOT LIKE '%Level%'
ORDER BY 1
```

```plot
HISTOGRAM(x: "Pause (ms)", logBins: true, yLog: true) TITLE "GC Pause Duration Distribution"
```

---
```

- [ ] **Step 3: Verify the template is valid markdown with correct cell names**

Read the file and confirm:
- `<!-- @cell name=gc-config -->` appears once
- `<!-- @cell name=gc-overhead -->` appears once
- `<!-- @cell name=pause-histogram -->` appears once
- All SQL blocks are closed with triple-backtick
- All plot blocks are closed with triple-backtick

- [ ] **Step 4: Commit**

```bash
git add core/frontend/data/templates/builtin/gc-analysis.md
git commit -m "feat(template): add GC config, overhead time series, and pause histogram cells to gc-analysis"
```

---

## Task 9: GC template — concurrent phase Gantt, cause avg/max upgrade

**Files:**
- Modify: `core/frontend/data/templates/builtin/gc-analysis.md`

- [ ] **Step 1: Add `concurrent-phases` cell (append to end of file)**

```markdown
<!-- @cell name=concurrent-phases -->

## Concurrent GC Phase Timeline

Timeline of concurrent (non-stop-the-world) GC work. Overlapping concurrent phases with short gaps between pauses indicate the collector is struggling to keep up with allocation.

```sql
SELECT
  startTime AS "Start",
  startTime + to_seconds(duration) AS "End",
  name AS "Phase",
  CAST(gcId AS VARCHAR) AS "GC"
FROM GCPhaseConcurrent
ORDER BY startTime
```

```plot
GANTT(start: "Start", end: "End", lane: "Phase", task: "GC") TITLE "Concurrent GC Phase Timeline" LINK_X($start, $end)
```

---
```

- [ ] **Step 2: Upgrade the `pause-summary` cell's plot to also show avg vs max per cause**

The existing `pause-summary` cell (around line 49) has a single `BAR_CHART`. Replace the plot block with one that shows both total and avg:

Find this block in `gc-analysis.md`:
```
```plot
BAR_CHART(x: "Cause", y: ["Total Pause (ms)", "Avg Pause (ms)"], layout: "grouped") TITLE "GC Pause Time by Cause"
```
```

Replace with:
```
```plot
BAR_CHART(x: "Cause", y: ["Total Pause (ms)", "Avg Pause (ms)", "Max Pause (ms)"], layout: "grouped") TITLE "GC Pause Time by Cause"
```
```

- [ ] **Step 3: Verify**

Read the file. Confirm `Max Pause (ms)` appears in the plot and that `gc_pauses` SQL query already selects `round(MAX(longestPause) * 1000, 2) AS "Max Pause (ms)"` — it does (line 62 of the original).

- [ ] **Step 4: Commit**

```bash
git add core/frontend/data/templates/builtin/gc-analysis.md
git commit -m "feat(template): add concurrent phase Gantt and max pause to cause breakdown"
```

---

## Task 10: GC template — allocation trigger, reference pressure, system-gc blockers

**Files:**
- Modify: `core/frontend/data/templates/builtin/gc-analysis.md`

These three cells use existing views (`gc-allocation-trigger`, `gc-references`, `blocked-by-system-gc`) and are conditional on event presence.

- [ ] **Step 1: Add three `cellConditions` entries to the template front matter**

The front matter is at lines 1–11 of `gc-analysis.md`. It currently ends with:
```yaml
cellConditions:
  long-pauses-section: "SELECT max(longestPause) * 1000 > $$threshold_ms FROM GarbageCollection"
```

Add three new conditions:
```yaml
  gc-allocation-trigger: "SELECT count(*) > 0 FROM AllocationRequiringGC"
  gc-references: "SELECT count(*) > 0 FROM GCReferenceStatistics"
  system-gc-blockers: "SELECT count(*) > 0 FROM SystemGC"
```

- [ ] **Step 2: Append the three conditional cells to the file**

```markdown
<!-- @cell name=gc-allocation-trigger -->

## Allocation Triggers

Application methods that directly triggered GC by allocating objects too large for TLAB. These are prime candidates for allocation reduction — consider object pooling or smaller allocation units.

*Requires `AllocationRequiringGC` events.*

```sql
SELECT * FROM "gc-allocation-trigger" LIMIT 20
```

```plot
BAR_CHART(x: "Trigger Method (Non-JDK)", y: ["Count"], horizontal: true) TITLE "Top GC Allocation Triggers"
```

---

<!-- @cell name=gc-references -->

## Reference Pressure

Soft, Weak, Phantom, and Final reference counts per GC. A rising Soft reference count means the JVM is holding objects in memory under memory pressure. Rising Final references suggest finalizer queue buildup.

*Requires `GCReferenceStatistics` events.*

```sql
SELECT "Time", "Soft Ref.", "Weak Ref.", "Phantom Ref.", "Final Ref."
FROM "gc-references"
ORDER BY "Time"
```

```plot
LINE_CHART(x: "Time", y: ["Soft Ref.", "Weak Ref.", "Phantom Ref.", "Final Ref."]) TITLE "GC Reference Counts Over Time" LINK_X($start, $end) ZOOM
```

---

<!-- @cell name=system-gc-blockers -->

## Explicit System.gc() Calls

Code paths that call `System.gc()` explicitly. These force full collections regardless of heap occupancy and are almost always a performance bug.

*Requires `SystemGC` events.*

```sql
SELECT
    (c.javaName || '.' || m.name) AS "Caller",
    COUNT(*) AS "Calls"
FROM SystemGC s
JOIN Method m ON s.stackTrace$topApplicationMethod = m._id
JOIN Class c ON m.type = c._id
GROUP BY c.javaName, m.name
ORDER BY COUNT(*) DESC
LIMIT 20
```

```plot
TABLE() TITLE "Explicit System.gc() Callers"
```

---
```

- [ ] **Step 3: Verify front matter is valid YAML**

Read the front matter block (lines 1–15) and confirm all `cellConditions` keys are valid identifiers and the YAML is properly indented.

- [ ] **Step 4: Commit**

```bash
git add core/frontend/data/templates/builtin/gc-analysis.md
git commit -m "feat(template): add allocation trigger, reference pressure, and system-gc blocker cells"
```

---

## Task 11: GC template — metaspace, G1 regions, tenuring cells

These cells use the three views created in Task 7. Each is conditional.

**Files:**
- Modify: `core/frontend/data/templates/builtin/gc-analysis.md`

- [ ] **Step 1: Add three more `cellConditions` to the front matter**

Add to the `cellConditions` block:

```yaml
  metaspace: "SELECT count(*) > 0 FROM MetaspaceSummary"
  g1-regions: "SELECT count(*) > 0 FROM G1HeapSummary"
  tenuring: "SELECT count(*) > 0 FROM TenuringDistribution"
```

- [ ] **Step 2: Append the three cells**

```markdown
<!-- @cell name=metaspace -->

## Metaspace Usage Over Time

Metaspace grows as classes are loaded. When it approaches the GC threshold, a Full GC is triggered. Continuous growth without plateauing indicates a class loader leak (e.g., from repeated hot deployments or dynamic code generation).

*Requires `MetaspaceSummary` events.*

```sql
SELECT * FROM "metaspace-over-time" ORDER BY "Time"
```

```plot
LINE_CHART(x: "Time", y: ["Metaspace Used MB", "GC Threshold MB"]) TITLE "Metaspace Usage Over Time" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

---

<!-- @cell name=g1-regions -->

## G1 Heap Region Breakdown

Eden, Survivor, and Old generation sizes after each GC. A steadily growing Old Gen between mixed collections means G1's IHOP threshold may need tuning (`-XX:InitiatingHeapOccupancyPercent`).

*Only present for G1 recordings with `G1HeapSummary` events.*

```sql
SELECT * FROM "g1-heap-regions" ORDER BY "Time"
```

```plot
AREA_CHART(x: "Time", y: ["Eden MB", "Survivor MB", "Old Gen MB"], layout: "stacked") TITLE "G1 Heap Regions After Each GC" LINK_X($start, $end) ZOOM AXIS_Y LABEL "MB"
```

---

<!-- @cell name=tenuring -->

## Survivor Tenuring Distribution

Object age distribution in survivor space after the most recent GC. Objects piling up at the max tenuring threshold are being promoted prematurely — the survivor space is too small. Consider `-XX:SurvivorRatio` or increasing `-Xmn`.

*Requires `TenuringDistribution` events (G1, CMS, Serial, Parallel collectors).*

```sql
SELECT "Age", "MB", "Objects", "Max Tenure Threshold", "Desired Survivor MB"
FROM "tenuring-distribution"
```

```plot
BAR_CHART(x: "Age", y: ["MB"]) TITLE "Survivor Age Distribution (most recent GC)" AXIS_X LABEL "Survivor Age" AXIS_Y LABEL "MB"
```

---
```

- [ ] **Step 3: Verify the front matter `cellConditions` block now has 6 entries total**

Read lines 1–20 of `gc-analysis.md`. Confirm:
- `long-pauses-section` (original)
- `gc-allocation-trigger`
- `gc-references`
- `system-gc-blockers`
- `metaspace`
- `g1-regions`
- `tenuring`

That is 7 entries. All should be indented with 2 spaces under `cellConditions:`.

- [ ] **Step 4: Commit**

```bash
git add core/frontend/data/templates/builtin/gc-analysis.md
git commit -m "feat(template): add metaspace, G1 region breakdown, and tenuring distribution cells to gc-analysis"
```

---

## Task 12: Run full test suite and verify

- [ ] **Step 1: Run all tests**

```
cd core/frontend && npx vitest run
```

Expected: all tests pass. The new test files are:
- `tests/plot/macros.test.ts`
- `tests/utils/plotUtils.test.ts`
- `tests/components/plots/HistogramPlot.test.ts` (extended)
- `tests/ml/classifyColumns.test.ts` (pre-existing, should still pass)

- [ ] **Step 2: If any test fails, fix the root cause before continuing**

Common failure modes:
- `CONDITIONAL_VIEWS_SQL` import path wrong → check the exact export name in `builtinSql.ts`
- `looksLikeStartName` import in `plotUtils.ts` causing circular dependency → move the `classifyColumns` import to the top and verify it doesn't import from `plotUtils`
- `buildSmartTemplate` GANTT returning blank template on valid input → check that `looksLikeStartName('startTime')` returns true by running the classifyColumns test first

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -p
git commit -m "fix: address test failures from GC improvements integration"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| P50, P25, P75 macros | Task 1 |
| bucket_time macro | Task 2 |
| format_rate macro | Task 3 |
| reclaim_mb macro | Task 3 |
| spectral/rdylgn palettes | Task 4 |
| buildSmartTemplate GANTT/RANGE/AREA/VIOLIN | Task 5 |
| HISTOGRAM yLog param | Task 6 |
| metaspace-over-time view | Task 7 |
| g1-heap-regions view | Task 7 |
| tenuring-distribution view | Task 7 |
| GC config cells (gc-config) | Task 8 |
| GC overhead time series | Task 8 |
| Pause histogram | Task 8 |
| Concurrent phase Gantt | Task 9 |
| Cause avg+max upgrade | Task 9 |
| Allocation trigger cell | Task 10 |
| GC reference pressure cell | Task 10 |
| System.gc() blockers cell | Task 10 |
| Metaspace template cell | Task 11 |
| G1 region area chart cell | Task 11 |
| Tenuring distribution cell | Task 11 |

All 21 requirements covered. ✓

**Placeholder scan:** No TBD, TODO, or "similar to Task N" patterns. All code blocks are complete. ✓

**Type consistency:** `Config` interface in `HistogramPlot.tsx` gains `yLog: boolean` and is used consistently. `buildSmartTemplate` switch cases return strings. `CONDITIONAL_VIEWS_SQL` entries follow the exact `{ requires: string, sql: string }` shape used by existing entries. ✓
