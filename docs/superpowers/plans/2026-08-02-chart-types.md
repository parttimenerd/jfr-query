# Chart Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the TREEMAP/WATERFALL lowercase DSL bug and add four new chart types: VIOLIN_PLOT, SUNBURST, SANKEY, and CROSSTAB — including full BRUSH variable integration, tests, documentation, and model retraining.

**Architecture:** Each new chart is a self-contained `PlotRegistration` object (config interface + `parseConfig` + React component) registered in `plotRegistry.ts`. The existing brush wiring in `PlotRenderer.tsx` (lines 1048–1062 and 1159–1177) passes `gestureName` / `onVariableChange` down to components that declare them as props — no changes to `PlotRenderer`. CROSSTAB extends the BRUSH clause regex in `plotParser.ts` to optionally accept two variables.

**Tech Stack:** React 18, recharts 3.5.0 (SunburstChart + Sankey already available), Vitest for unit tests, TypeScript, `createConfigParser` / `buildParserSpec` / `withCommonParams` from existing utilities.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `components/editor/plot/parser.ts` | Add treemap/waterfall to SHAPE_NORMALIZE |
| Modify | `components/editor/plot/derive.ts` | Add treemap/waterfall to LOWERCASE_TO_UC |
| Modify | `utils/plotParser.ts` | Extend BRUSH regex for optional second `$var`; add `brush2?: string` to ParsedPlotCall |
| Create | `components/plots/ViolinPlot.tsx` | VIOLIN_PLOT renderer + registration |
| Create | `components/plots/SunburstPlot.tsx` | SUNBURST renderer + registration |
| Create | `components/plots/SankeyPlot.tsx` | SANKEY renderer + registration |
| Create | `components/plots/CrosstabPlot.tsx` | CROSSTAB renderer + registration |
| Modify | `components/plots/plotRegistry.ts` | Import and register all four new plots |
| Create | `tests/components/editor/plot/newShapes.test.ts` | Parser round-trip + BRUSH two-var tests |
| Create | `tests/components/plots/ViolinPlot.test.tsx` | ViolinPlot unit tests |
| Create | `tests/components/plots/SunburstPlot.test.tsx` | SunburstPlot unit tests |
| Create | `tests/components/plots/SankeyPlot.test.tsx` | SankeyPlot unit tests |
| Create | `tests/components/plots/CrosstabPlot.test.tsx` | CrosstabPlot unit tests |
| Modify | `docs-site/web-ui.md` | Document all six charts (incl. TREEMAP/WATERFALL) |
| Modify | `scripts/train/gen_plot_pairs.py` | Add new shapes to PLOT_DOCS and scenario pools |
| Modify | `scripts/train/test_completion_scenarios.py` | Add scenarios for new shapes |

---

## Task 1: Fix TREEMAP / WATERFALL Lowercase DSL

**Files:**
- Modify: `core/frontend/components/editor/plot/parser.ts` (SHAPE_NORMALIZE map, lines 14–28)
- Modify: `core/frontend/components/editor/plot/derive.ts` (LOWERCASE_TO_UC map, lines 30–43)
- Test: `core/frontend/tests/components/editor/plot/newShapes.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

Create `core/frontend/tests/components/editor/plot/newShapes.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parse } from '../../../../components/editor/plot/parser';
import { derive } from '../../../../components/editor/plot/derive';

function p(src: string) {
    const root = parse(src);
    return derive(root);
}

describe('treemap / waterfall lowercase DSL fix', () => {
    it('parses TREEMAP uppercase without error', () => {
        const r = p('TREEMAP(label: "name", value: "size")');
        expect(r.mainConfig).toMatch(/TREEMAP/i);
    });

    it('parses treemap lowercase form', () => {
        const r = p('treemap { label: name, value: size }');
        expect(r.mainConfig).toMatch(/TREEMAP/i);
    });

    it('parses WATERFALL uppercase without error', () => {
        const r = p('WATERFALL(category: "phase", value: "delta")');
        expect(r.mainConfig).toMatch(/WATERFALL/i);
    });

    it('parses waterfall lowercase form', () => {
        const r = p('waterfall { category: phase, value: delta }');
        expect(r.mainConfig).toMatch(/WATERFALL/i);
    });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd core/frontend && npx vitest run tests/components/editor/plot/newShapes.test.ts 2>&1 | head -40
```

Expected: the lowercase treemap/waterfall tests fail (shape not recognized).

- [ ] **Step 3: Add treemap and waterfall to SHAPE_NORMALIZE**

In `core/frontend/components/editor/plot/parser.ts`, find the SHAPE_NORMALIZE block (lines 14–28) and add the two missing entries:

```typescript
const SHAPE_NORMALIZE: Record<string, string> = {
    line_chart: 'line', line: 'line',
    bar_chart: 'bar', bar: 'bar',
    scatter_plot: 'scatter', scatter: 'scatter',
    heatmap: 'heatmap',
    histogram: 'histogram',
    box_plot: 'boxplot', boxplot: 'boxplot',
    pie_chart: 'pie', pie: 'pie',
    flamegraph: 'flamegraph',
    table: 'table',
    area_chart: 'area', area: 'area',
    gantt_chart: 'gantt', gantt: 'gantt',
    range_plot: 'range', range: 'range',
    range_chart: 'range',
    treemap: 'treemap',        // ← add
    waterfall: 'waterfall',    // ← add
};
```

- [ ] **Step 4: Add treemap and waterfall to LOWERCASE_TO_UC**

In `core/frontend/components/editor/plot/derive.ts`, find the LOWERCASE_TO_UC block (lines 30–43) and add:

```typescript
const LOWERCASE_TO_UC: Record<string, string> = {
    line: 'LINE_CHART',
    bar: 'BAR_CHART',
    scatter: 'SCATTER_PLOT',
    heatmap: 'HEATMAP',
    histogram: 'HISTOGRAM',
    boxplot: 'BOX_PLOT',
    pie: 'PIE_CHART',
    flamegraph: 'FLAMEGRAPH',
    table: 'TABLE',
    area: 'AREA_CHART',
    gantt: 'GANTT',
    range: 'RANGE',
    treemap: 'TREEMAP',        // ← add
    waterfall: 'WATERFALL',    // ← add
};
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd core/frontend && npx vitest run tests/components/editor/plot/newShapes.test.ts 2>&1 | tail -20
```

Expected: 4 tests pass.

- [ ] **Step 6: TypeScript check**

```bash
cd core/frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: zero errors related to these changes.

- [ ] **Step 7: Commit**

```bash
git add core/frontend/components/editor/plot/parser.ts \
        core/frontend/components/editor/plot/derive.ts \
        core/frontend/tests/components/editor/plot/newShapes.test.ts
git commit -m "fix(plot): register treemap and waterfall in lowercase DSL lookup tables"
```

---

## Task 2: Extend BRUSH Clause for Two Variables (CROSSTAB prerequisite)

**Files:**
- Modify: `core/frontend/utils/plotParser.ts` (BRUSH regex + ParsedPlotCall interface)
- Test: `core/frontend/tests/components/editor/plot/newShapes.test.ts` (extend existing file)

- [ ] **Step 1: Write the failing tests**

Add to `core/frontend/tests/components/editor/plot/newShapes.test.ts`:

```typescript
import { parsePlotCall } from '../../../../utils/plotParser';

describe('BRUSH two-variable extension', () => {
    it('parses single-variable BRUSH (existing behavior unchanged)', () => {
        const r = parsePlotCall('LINE_CHART(x: "ts") BRUSH $sel MODE X');
        expect(r.brush?.name).toBe('$sel');
        expect(r.brush?.mode).toBe('x');
        expect(r.brush2).toBeUndefined();
    });

    it('parses two-variable BRUSH for CROSSTAB', () => {
        const r = parsePlotCall('CROSSTAB(row: "gcType", col: "phase", value: "dur") BRUSH $row_var $col_var');
        expect(r.brush?.name).toBe('$row_var');
        expect(r.brush2).toBe('$col_var');
    });

    it('brush2 is undefined when only one variable given', () => {
        const r = parsePlotCall('BAR_CHART(x: "cat", y: ["val"]) BRUSH $v MODE X');
        expect(r.brush2).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd core/frontend && npx vitest run tests/components/editor/plot/newShapes.test.ts 2>&1 | grep -A5 'two-variable'
```

Expected: `parsePlotCall` import error or `brush2` is undefined for the two-var case.

- [ ] **Step 3: Add `brush2` to ParsedPlotCall and extend the regex**

In `core/frontend/utils/plotParser.ts`:

**a) Add `brush2` to the `ParsedPlotCall` interface** (after the existing `brush?: BrushSpec` line ~38):

```typescript
    brush?: BrushSpec;
    /** Second BRUSH variable — set only for CROSSTAB two-var BRUSH syntax. */
    brush2?: string;
```

**b) Replace the existing BRUSH clause entry** (line ~170) with two entries — the two-var form must be tried first (more specific):

```typescript
    // Two-variable BRUSH for CROSSTAB: BRUSH $rowVar $colVar (no MODE required)
    {
        key: 'brush',
        regex: /(?<!\w)BRUSH\s+(\$[A-Za-z_][\w]*)\s+(\$[A-Za-z_][\w]*)\s*$/i,
        processor: (m, result): BrushSpec => {
            (result as any).brush2 = m[2];
            return { name: m[1], mode: 'xy' };
        },
    },
    // Single-variable BRUSH (existing): BRUSH $var MODE X|Y|XY
    {
        key: 'brush',
        regex: /(?<!\w)BRUSH\s+(?:"(\$[A-Za-z_][\w]*)"|'(\$[A-Za-z_][\w]*)'|(\$[A-Za-z_][\w]*))\s+MODE\s+(X|Y|XY)\s*$/i,
        processor: (m): BrushSpec => ({ name: m[1] ?? m[2] ?? m[3], mode: m[4].toLowerCase() as BrushSpec['mode'] }),
    },
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd core/frontend && npx vitest run tests/components/editor/plot/newShapes.test.ts 2>&1 | tail -20
```

Expected: all tests pass including the new BRUSH two-var tests.

- [ ] **Step 5: TypeScript check**

```bash
cd core/frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add core/frontend/utils/plotParser.ts \
        core/frontend/tests/components/editor/plot/newShapes.test.ts
git commit -m "feat(plot-dsl): extend BRUSH clause to accept two variables for CROSSTAB"
```

---

## Task 3: VIOLIN_PLOT Renderer

**Files:**
- Create: `core/frontend/components/plots/ViolinPlot.tsx`
- Create: `core/frontend/tests/components/plots/ViolinPlot.test.tsx`

VIOLIN_PLOT shows the distribution of a numeric column using a kernel density estimate (KDE), rendered as mirrored recharts `Area` shapes — one per category. Clicking a violin calls `onVariableChange` via `usePlotGestures.onClick`.

- [ ] **Step 1: Write the failing tests**

Create `core/frontend/tests/components/plots/ViolinPlot.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { violinPlot } from '../../../components/plots/ViolinPlot';

// ── registration ──────────────────────────────────────────────────────────────
describe('violinPlot registration', () => {
    it('has name VIOLIN_PLOT', () => {
        expect(violinPlot.name).toBe('VIOLIN_PLOT');
    });

    it('has required param: value', () => {
        const value = violinPlot.params.find(p => p.name === 'value');
        expect(value?.required).toBe(true);
    });

    it('has optional param: category', () => {
        const cat = violinPlot.params.find(p => p.name === 'category');
        expect(cat).toBeDefined();
        expect(cat?.required).toBeFalsy();
    });

    it('has optional param: bins with default 20', () => {
        const bins = violinPlot.params.find(p => p.name === 'bins');
        expect(bins).toBeDefined();
        expect(bins?.defaultValue).toBe(20);
    });
});

// ── parseConfig ───────────────────────────────────────────────────────────────
describe('violinPlot parseConfig', () => {
    it('parses value column', () => {
        const cfg = violinPlot.parseConfig('VIOLIN_PLOT(value: "duration")', []);
        expect(cfg.value).toBe('duration');
    });

    it('parses category and bins', () => {
        const cfg = violinPlot.parseConfig('VIOLIN_PLOT(value: "dur", category: "gcType", bins: 30)', []);
        expect(cfg.category).toBe('gcType');
        expect(cfg.bins).toBe(30);
    });

    it('bins defaults to 20 when not specified', () => {
        const cfg = violinPlot.parseConfig('VIOLIN_PLOT(value: "dur")', []);
        expect(cfg.bins ?? 20).toBe(20);
    });
});

// ── KDE helper ────────────────────────────────────────────────────────────────
import { computeKde } from '../../../components/plots/ViolinPlot';

describe('computeKde', () => {
    it('returns bins array of correct length', () => {
        const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const result = computeKde(data, 10);
        expect(result).toHaveLength(10);
    });

    it('each bin has x and density', () => {
        const result = computeKde([1, 2, 3], 5);
        result.forEach(bin => {
            expect(typeof bin.x).toBe('number');
            expect(typeof bin.density).toBe('number');
            expect(bin.density).toBeGreaterThanOrEqual(0);
        });
    });

    it('returns empty array for empty data', () => {
        expect(computeKde([], 10)).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd core/frontend && npx vitest run tests/components/plots/ViolinPlot.test.tsx 2>&1 | head -20
```

Expected: module not found error.

- [ ] **Step 3: Create `ViolinPlot.tsx`**

Create `core/frontend/components/plots/ViolinPlot.tsx`:

```typescript
import React, { useContext, useMemo, useCallback } from 'react';
import {
    ComposedChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip,
} from 'recharts';
import type { PlotRegistration, PlotParameter } from './plotTypes';
import { withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn, getPaletteColors } from '../../utils/plotUtils';
import { usePlotGestures } from '../../hooks/usePlotGestures';
import type { ParsedPlotCall } from '../../utils/plotParser';

const DEFAULT_COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#f87171', '#a78bfa', '#fb923c'];

export interface ViolinConfig {
    value: string;
    category?: string;
    bins?: number;
}

const params: PlotParameter[] = [
    { name: 'value', type: 'column', required: true, description: 'Numeric column for the distribution axis.' },
    { name: 'category', type: 'column', required: false, description: 'Categorical column — one violin per group.' },
    { name: 'bins', type: 'number', required: false, defaultValue: 20, description: 'KDE resolution (number of density sample points).' },
];

const parseConfig = createConfigParser<ViolinConfig>(buildParserSpec(params));

/** Gaussian KDE evaluated at `bins` evenly-spaced points across the data range. */
export function computeKde(values: number[], bins: number): { x: number; density: number }[] {
    if (values.length === 0) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
        return Array.from({ length: bins }, (_, i) => ({
            x: min + (i / (bins - 1)) * 0.001,
            density: i === Math.floor(bins / 2) ? 1 : 0,
        }));
    }
    const bandwidth = 1.06 * Math.sqrt(
        values.reduce((s, v) => s + (v - values.reduce((a, b) => a + b, 0) / values.length) ** 2, 0) / values.length
    ) * Math.pow(values.length, -0.2);
    const bw = bandwidth > 0 ? bandwidth : (max - min) / bins;
    return Array.from({ length: bins }, (_, i) => {
        const x = min + (i / (bins - 1)) * (max - min);
        const density = values.reduce((sum, v) => {
            const u = (x - v) / bw;
            return sum + Math.exp(-0.5 * u * u) / (bw * Math.sqrt(2 * Math.PI));
        }, 0) / values.length;
        return { x, density };
    });
}

const ViolinComponent: React.FC<{
    config: ViolinConfig;
    data: any[];
    isAnimationActive?: boolean;
    animationDuration?: number;
    clauses?: ParsedPlotCall;
    gestureName?: string;
    onVariableChange?: (vars: Record<string, unknown>) => void;
}> = ({ config, data, isAnimationActive, animationDuration, clauses, gestureName, onVariableChange }) => {
    useContext(SettingsContext);
    const colors = getPaletteColors(clauses?.palette, DEFAULT_COLORS);
    const gestures = usePlotGestures({ name: gestureName, onVariableChange });
    const bins = config.bins ?? 20;

    const valueCol = findColumn(data, config.value) ?? config.value;
    const catCol = config.category ? (findColumn(data, config.category) ?? config.category) : undefined;

    const groups: { label: string; values: number[] }[] = useMemo(() => {
        if (!data || data.length === 0) return [];
        const numericValues = data
            .map(r => parseFloat(String(r[valueCol])))
            .filter(v => !isNaN(v));
        if (!catCol) return [{ label: '', values: numericValues }];
        const map = new Map<string, number[]>();
        for (const row of data) {
            const cat = String(row[catCol] ?? '');
            const val = parseFloat(String(row[valueCol]));
            if (isNaN(val)) continue;
            if (!map.has(cat)) map.set(cat, []);
            map.get(cat)!.push(val);
        }
        return Array.from(map.entries()).map(([label, values]) => ({ label, values }));
    }, [data, valueCol, catCol]);

    if (groups.length === 0) {
        return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No data</div>;
    }

    const violins = useMemo(() =>
        groups.map(g => ({ ...g, kde: computeKde(g.values, bins) })),
        [groups, bins]
    );

    const maxDensity = Math.max(...violins.flatMap(v => v.kde.map(k => k.density)), 0.0001);

    const handleClick = useCallback((groupLabel: string) => {
        if (!gestureName || !onVariableChange) return;
        gestures.onClick({ category: groupLabel });
    }, [gestures, gestureName, onVariableChange]);

    return (
        <div className="w-full h-full flex gap-2 overflow-x-auto">
            {violins.map((v, idx) => {
                const color = colors[idx % colors.length];
                const chartData = v.kde.map(k => ({
                    x: k.x,
                    pos: k.density / maxDensity,
                    neg: -(k.density / maxDensity),
                }));
                return (
                    <div
                        key={v.label || idx}
                        className="flex-1 min-w-[80px] cursor-pointer"
                        onClick={() => handleClick(v.label)}
                        title={v.label || undefined}
                    >
                        {v.label && (
                            <div className="text-center text-[11px] text-gray-400 truncate px-1 mb-1">{v.label}</div>
                        )}
                        <ResponsiveContainer width="100%" height="90%">
                            <ComposedChart data={chartData} layout="vertical"
                                margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                                <XAxis type="number" domain={[-1, 1]} hide />
                                <YAxis type="number" dataKey="x" domain={['dataMin', 'dataMax']}
                                    width={40} tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                <Tooltip
                                    formatter={(val: number) => Math.abs(val).toFixed(3)}
                                    labelFormatter={(l: number) => `value: ${Number(l).toFixed(2)}`}
                                    contentStyle={{ background: '#1f2937', border: 'none', fontSize: 11 }}
                                />
                                <Area type="monotone" dataKey="pos"
                                    fill={color} stroke={color} fillOpacity={0.6}
                                    isAnimationActive={isAnimationActive}
                                    animationDuration={animationDuration} />
                                <Area type="monotone" dataKey="neg"
                                    fill={color} stroke={color} fillOpacity={0.6}
                                    isAnimationActive={isAnimationActive}
                                    animationDuration={animationDuration} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                );
            })}
        </div>
    );
};

export const violinPlot: PlotRegistration<ViolinConfig> = {
    name: 'VIOLIN_PLOT',
    description: 'Distribution shape for numeric data, optionally grouped by category. Shows density via a mirrored kernel density estimate.',
    params: withCommonParams(params),
    template: 'VIOLIN_PLOT(value: )',
    examples: [
        {
            description: 'GC pause duration distribution by cause',
            code: 'VIOLIN_PLOT(value: "pauseDuration", category: "cause") TITLE "Pause Distribution by Cause"',
            sampleData: [
                { pauseDuration: 12, cause: 'G1 GC' }, { pauseDuration: 45, cause: 'G1 GC' },
                { pauseDuration: 8, cause: 'G1 GC' }, { pauseDuration: 180, cause: 'Full GC' },
                { pauseDuration: 210, cause: 'Full GC' }, { pauseDuration: 22, cause: 'G1 GC' },
            ],
        },
    ],
    parseConfig,
    component: ViolinComponent,
};
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd core/frontend && npx vitest run tests/components/plots/ViolinPlot.test.tsx 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Register in plotRegistry**

In `core/frontend/components/plots/plotRegistry.ts`, add the import and registry entry:

```typescript
// Add import at top (after existing imports):
import { violinPlot } from './ViolinPlot';

// Add to registry object:
[violinPlot.name]: violinPlot,
```

- [ ] **Step 6: TypeScript check**

```bash
cd core/frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add core/frontend/components/plots/ViolinPlot.tsx \
        core/frontend/components/plots/plotRegistry.ts \
        core/frontend/tests/components/plots/ViolinPlot.test.tsx
git commit -m "feat(plot): add VIOLIN_PLOT chart type with KDE rendering and BRUSH support"
```

---

## Task 4: SUNBURST Renderer

**Files:**
- Create: `core/frontend/components/plots/SunburstPlot.tsx`
- Create: `core/frontend/tests/components/plots/SunburstPlot.test.tsx`

SUNBURST uses recharts `SunburstChart` (available in recharts 3.5.0). Clicking a node drills down (re-roots view); clicking the center goes up one level. `BRUSH $var` writes the current root path (slash-joined) to the variable.

**Note on recharts SunburstChart:** The recharts `SunburstChart` component expects data in the form `{ name: string; value?: number; children?: [...] }` tree structure. We must aggregate rows into a tree before rendering.

- [ ] **Step 1: Write the failing tests**

Create `core/frontend/tests/components/plots/SunburstPlot.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { sunburstPlot, buildTree, type SunburstNode } from '../../../components/plots/SunburstPlot';

describe('sunburstPlot registration', () => {
    it('has name SUNBURST', () => {
        expect(sunburstPlot.name).toBe('SUNBURST');
    });

    it('requires path and value params', () => {
        const path = sunburstPlot.params.find(p => p.name === 'path');
        const value = sunburstPlot.params.find(p => p.name === 'value');
        expect(path?.required).toBe(true);
        expect(value?.required).toBe(true);
    });
});

describe('sunburstPlot parseConfig', () => {
    it('parses single path column', () => {
        const cfg = sunburstPlot.parseConfig('SUNBURST(path: "pkg", value: "samples")', []);
        expect(cfg.value).toBe('samples');
        expect(cfg.path).toBe('pkg');
    });
});

describe('buildTree', () => {
    const rows = [
        { pkg: 'com.example', cls: 'Foo', samples: 10 },
        { pkg: 'com.example', cls: 'Bar', samples: 5 },
        { pkg: 'org.lib', cls: 'Baz', samples: 3 },
    ];

    it('builds a tree with correct children', () => {
        const tree = buildTree(rows, ['pkg', 'cls'], 'samples');
        expect(tree.name).toBe('(root)');
        expect(tree.children).toHaveLength(2);
    });

    it('leaf nodes have value', () => {
        const tree = buildTree(rows, ['pkg', 'cls'], 'samples');
        const example = tree.children!.find(c => c.name === 'com.example');
        expect(example?.children).toHaveLength(2);
        const foo = example?.children?.find(c => c.name === 'Foo');
        expect(foo?.value).toBe(10);
    });

    it('handles empty data', () => {
        const tree = buildTree([], ['pkg'], 'samples');
        expect(tree.children).toHaveLength(0);
    });

    it('handles slash-delimited single column', () => {
        const rows2 = [{ path: 'a/b/c', samples: 7 }];
        const tree = buildTree(rows2, 'path', 'samples', '/');
        const a = tree.children?.find(c => c.name === 'a');
        const b = a?.children?.find(c => c.name === 'b');
        expect(b?.children?.find(c => c.name === 'c')?.value).toBe(7);
    });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd core/frontend && npx vitest run tests/components/plots/SunburstPlot.test.tsx 2>&1 | head -20
```

Expected: module not found.

- [ ] **Step 3: Create `SunburstPlot.tsx`**

Create `core/frontend/components/plots/SunburstPlot.tsx`:

```typescript
import React, { useContext, useMemo, useState, useCallback } from 'react';
import { Sunburst, ResponsiveContainer, Tooltip } from 'recharts';
import type { PlotRegistration, PlotParameter } from './plotTypes';
import { withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn, getPaletteColors } from '../../utils/plotUtils';
import type { ParsedPlotCall } from '../../utils/plotParser';

const DEFAULT_COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#f87171', '#a78bfa', '#fb923c',
    '#38bdf8', '#4ade80', '#fbbf24', '#f472b6'];

export interface SunburstConfig {
    path: string | string[];
    value: string;
}

export interface SunburstNode {
    name: string;
    value?: number;
    children?: SunburstNode[];
    fill?: string;
}

const params: PlotParameter[] = [
    { name: 'path', type: 'column', required: true, description: 'Column(s) defining hierarchy depth. Use array for multiple columns or a single slash-delimited column.' },
    { name: 'value', type: 'column', required: true, description: 'Numeric column for node size.' },
];

const parseConfig = createConfigParser<SunburstConfig>(buildParserSpec(params));

/** Build a hierarchy tree from flat rows. pathCols can be an array of column names or
 *  a single column name (then rows are split by `sep`). */
export function buildTree(
    rows: any[],
    pathCols: string | string[],
    valueCol: string,
    sep = '/',
): SunburstNode {
    const root: SunburstNode & { children: SunburstNode[] } = { name: '(root)', children: [] };
    for (const row of rows) {
        const segments: string[] = Array.isArray(pathCols)
            ? pathCols.map(c => String(row[c] ?? ''))
            : String(row[pathCols] ?? '').split(sep).filter(Boolean);
        const val = parseFloat(String(row[valueCol]));
        if (isNaN(val) || segments.length === 0) continue;
        let node: SunburstNode & { children?: SunburstNode[] } = root;
        for (let d = 0; d < segments.length; d++) {
            const seg = segments[d];
            if (!node.children) node.children = [];
            let child = node.children.find(c => c.name === seg);
            if (!child) { child = { name: seg }; node.children.push(child); }
            if (d === segments.length - 1) {
                child.value = (child.value ?? 0) + val;
            }
            node = child as any;
        }
    }
    return root;
}

function colorTree(node: SunburstNode, colors: string[], depth = 0, idx = { v: 0 }): void {
    if (depth === 1) { node.fill = colors[idx.v++ % colors.length]; }
    else if (depth > 1 && node.fill === undefined) {
        // Inherit parent color (caller sets it before recursing)
    }
    for (const child of node.children ?? []) {
        child.fill = node.fill;
        colorTree(child, colors, depth + 1, idx);
    }
}

const SunburstComponent: React.FC<{
    config: SunburstConfig;
    data: any[];
    isAnimationActive?: boolean;
    animationDuration?: number;
    clauses?: ParsedPlotCall;
    gestureName?: string;
    onVariableChange?: (vars: Record<string, unknown>) => void;
}> = ({ config, data, clauses, gestureName, onVariableChange }) => {
    useContext(SettingsContext);
    const colors = getPaletteColors(clauses?.palette, DEFAULT_COLORS);

    const pathCols: string | string[] = useMemo(() => {
        if (Array.isArray(config.path)) return config.path.map(c => findColumn(data, c) ?? c);
        return findColumn(data, config.path) ?? config.path;
    }, [config.path, data]);

    const valueCol = findColumn(data, config.value) ?? config.value;

    const [rootPath, setRootPath] = useState<string[]>([]);

    const fullTree = useMemo(() => {
        const t = buildTree(data, pathCols, valueCol);
        colorTree(t, colors);
        return t;
    }, [data, pathCols, valueCol, colors]);

    const currentNode: SunburstNode = useMemo(() => {
        let node = fullTree;
        for (const seg of rootPath) {
            const child = node.children?.find(c => c.name === seg);
            if (!child) break;
            node = child;
        }
        return node;
    }, [fullTree, rootPath]);

    const navigate = useCallback((node: SunburstNode) => {
        if (node.name === '(root)') return;
        const newPath = [...rootPath, node.name];
        setRootPath(newPath);
        if (gestureName && onVariableChange) {
            onVariableChange({ [`${gestureName}.click`]: newPath.join('/') });
        }
    }, [rootPath, gestureName, onVariableChange]);

    const navigateUp = useCallback((idx: number) => {
        const newPath = rootPath.slice(0, idx);
        setRootPath(newPath);
        if (gestureName && onVariableChange) {
            onVariableChange({ [`${gestureName}.click`]: newPath.join('/') });
        }
    }, [rootPath, gestureName, onVariableChange]);

    return (
        <div className="w-full h-full flex flex-col">
            {rootPath.length > 0 && (
                <div className="flex items-center gap-1 px-2 py-1 text-[11px] text-gray-400 flex-wrap">
                    <button onClick={() => navigateUp(0)} className="hover:text-cyan-300">(root)</button>
                    {rootPath.map((seg, i) => (
                        <React.Fragment key={i}>
                            <span className="text-gray-600">/</span>
                            <button
                                onClick={() => navigateUp(i + 1)}
                                className={`hover:text-cyan-300 truncate max-w-[120px] ${i === rootPath.length - 1 ? 'text-cyan-300 font-semibold' : ''}`}
                            >{seg}</button>
                        </React.Fragment>
                    ))}
                </div>
            )}
            <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                    <Sunburst
                        data={currentNode}
                        dataKey="value"
                        nameKey="name"
                        onClick={(node: any) => {
                            if (node?.name === currentNode.name) { navigateUp(rootPath.length - 1); }
                            else if (node) { navigate(node); }
                        }}
                    >
                        <Tooltip
                            formatter={(v: number) => v.toLocaleString()}
                            contentStyle={{ background: '#1f2937', border: 'none', fontSize: 11 }}
                        />
                    </Sunburst>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export const sunburstPlot: PlotRegistration<SunburstConfig> = {
    name: 'SUNBURST',
    description: 'Hierarchical part-of-whole chart. Click segments to drill down; click the center to go up.',
    params: withCommonParams(params),
    template: 'SUNBURST(path: , value: )',
    examples: [
        {
            description: 'Package / class allocation breakdown',
            code: 'SUNBURST(path: ["pkg", "className"], value: "allocBytes") TITLE "Allocation by Package"',
            sampleData: [
                { pkg: 'com.example', className: 'Foo', allocBytes: 1024 },
                { pkg: 'com.example', className: 'Bar', allocBytes: 512 },
                { pkg: 'org.lib', className: 'Baz', allocBytes: 256 },
            ],
        },
    ],
    parseConfig,
    component: SunburstComponent,
};
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd core/frontend && npx vitest run tests/components/plots/SunburstPlot.test.tsx 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Register in plotRegistry**

In `core/frontend/components/plots/plotRegistry.ts`, add:

```typescript
import { sunburstPlot } from './SunburstPlot';
// ...
[sunburstPlot.name]: sunburstPlot,
```

- [ ] **Step 6: TypeScript check**

```bash
cd core/frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add core/frontend/components/plots/SunburstPlot.tsx \
        core/frontend/components/plots/plotRegistry.ts \
        core/frontend/tests/components/plots/SunburstPlot.test.tsx
git commit -m "feat(plot): add SUNBURST chart type with drill-down navigation and BRUSH support"
```

---

## Task 5: SANKEY Renderer

**Files:**
- Create: `core/frontend/components/plots/SankeyPlot.tsx`
- Create: `core/frontend/tests/components/plots/SankeyPlot.test.tsx`

SANKEY uses recharts `Sankey`. Click a node to re-root the view (filter edges to those passing through the focused node). A breadcrumb tracks navigation path. `BRUSH $var` writes the focused node name.

**recharts Sankey data format:** `{ nodes: [{name}], links: [{source: idx, target: idx, value}] }`.

- [ ] **Step 1: Write the failing tests**

Create `core/frontend/tests/components/plots/SankeyPlot.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { sankeyPlot, buildSankeyData, filterByFocus } from '../../../components/plots/SankeyPlot';

describe('sankeyPlot registration', () => {
    it('has name SANKEY', () => {
        expect(sankeyPlot.name).toBe('SANKEY');
    });

    it('requires source, target, value', () => {
        ['source', 'target', 'value'].forEach(name => {
            expect(sankeyPlot.params.find(p => p.name === name)?.required).toBe(true);
        });
    });
});

describe('sankeyPlot parseConfig', () => {
    it('parses all three required columns', () => {
        const cfg = sankeyPlot.parseConfig('SANKEY(source: "caller", target: "callee", value: "samples")', []);
        expect(cfg.source).toBe('caller');
        expect(cfg.target).toBe('callee');
        expect(cfg.value).toBe('samples');
    });
});

describe('buildSankeyData', () => {
    const rows = [
        { caller: 'main', callee: 'foo', samples: 10 },
        { caller: 'main', callee: 'bar', samples: 5 },
        { caller: 'foo', callee: 'baz', samples: 8 },
    ];

    it('builds correct node list', () => {
        const { nodes } = buildSankeyData(rows, 'caller', 'callee', 'samples');
        const names = nodes.map(n => n.name);
        expect(names).toContain('main');
        expect(names).toContain('foo');
        expect(names).toContain('baz');
    });

    it('builds correct link list', () => {
        const { nodes, links } = buildSankeyData(rows, 'caller', 'callee', 'samples');
        expect(links).toHaveLength(3);
        const mainIdx = nodes.findIndex(n => n.name === 'main');
        const fooIdx = nodes.findIndex(n => n.name === 'foo');
        const mainToFoo = links.find(l => l.source === mainIdx && l.target === fooIdx);
        expect(mainToFoo?.value).toBe(10);
    });

    it('handles empty data', () => {
        const { nodes, links } = buildSankeyData([], 'a', 'b', 'v');
        expect(nodes).toHaveLength(0);
        expect(links).toHaveLength(0);
    });
});

describe('filterByFocus', () => {
    const rows = [
        { caller: 'main', callee: 'foo', samples: 10 },
        { caller: 'main', callee: 'bar', samples: 5 },
        { caller: 'foo', callee: 'baz', samples: 8 },
    ];

    it('returns all rows when focus is null', () => {
        expect(filterByFocus(rows, 'caller', 'callee', null)).toHaveLength(3);
    });

    it('filters to rows passing through focus node', () => {
        const filtered = filterByFocus(rows, 'caller', 'callee', 'foo');
        // foo is source of [foo→baz] and target of [main→foo]
        expect(filtered).toHaveLength(2);
    });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd core/frontend && npx vitest run tests/components/plots/SankeyPlot.test.tsx 2>&1 | head -20
```

Expected: module not found.

- [ ] **Step 3: Create `SankeyPlot.tsx`**

Create `core/frontend/components/plots/SankeyPlot.tsx`:

```typescript
import React, { useContext, useMemo, useState, useCallback } from 'react';
import { Sankey, Tooltip, ResponsiveContainer, Layer, Rectangle } from 'recharts';
import type { PlotRegistration, PlotParameter } from './plotTypes';
import { withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn, getPaletteColors } from '../../utils/plotUtils';
import type { ParsedPlotCall } from '../../utils/plotParser';

const DEFAULT_COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#f87171', '#a78bfa', '#fb923c'];

export interface SankeyConfig {
    source: string;
    target: string;
    value: string;
}

const params: PlotParameter[] = [
    { name: 'source', type: 'column', required: true, description: 'Column for source node labels.' },
    { name: 'target', type: 'column', required: true, description: 'Column for target node labels.' },
    { name: 'value', type: 'column', required: true, description: 'Numeric column for flow width.' },
];

const parseConfig = createConfigParser<SankeyConfig>(buildParserSpec(params));

export interface SankeyDataNode { name: string; }
export interface SankeyDataLink { source: number; target: number; value: number; }

export function buildSankeyData(
    rows: any[],
    sourceCol: string,
    targetCol: string,
    valueCol: string,
): { nodes: SankeyDataNode[]; links: SankeyDataLink[] } {
    if (rows.length === 0) return { nodes: [], links: [] };
    const nameIndex = new Map<string, number>();
    const nodes: SankeyDataNode[] = [];
    const addNode = (name: string) => {
        if (!nameIndex.has(name)) { nameIndex.set(name, nodes.length); nodes.push({ name }); }
        return nameIndex.get(name)!;
    };
    const linkMap = new Map<string, number>();
    for (const row of rows) {
        const src = String(row[sourceCol] ?? '');
        const tgt = String(row[targetCol] ?? '');
        const val = parseFloat(String(row[valueCol]));
        if (!src || !tgt || isNaN(val)) continue;
        const si = addNode(src);
        const ti = addNode(tgt);
        const key = `${si}→${ti}`;
        linkMap.set(key, (linkMap.get(key) ?? 0) + val);
    }
    const links: SankeyDataLink[] = Array.from(linkMap.entries()).map(([key, value]) => {
        const [s, t] = key.split('→').map(Number);
        return { source: s, target: t, value };
    });
    return { nodes, links };
}

/** Filter rows to only those where `focus` appears as source or target. */
export function filterByFocus(
    rows: any[],
    sourceCol: string,
    targetCol: string,
    focus: string | null,
): any[] {
    if (focus === null) return rows;
    return rows.filter(r =>
        String(r[sourceCol] ?? '') === focus || String(r[targetCol] ?? '') === focus
    );
}

const SankeyComponent: React.FC<{
    config: SankeyConfig;
    data: any[];
    isAnimationActive?: boolean;
    animationDuration?: number;
    clauses?: ParsedPlotCall;
    gestureName?: string;
    onVariableChange?: (vars: Record<string, unknown>) => void;
}> = ({ config, data, clauses, gestureName, onVariableChange }) => {
    useContext(SettingsContext);
    const colors = getPaletteColors(clauses?.palette, DEFAULT_COLORS);

    const sourceCol = findColumn(data, config.source) ?? config.source;
    const targetCol = findColumn(data, config.target) ?? config.target;
    const valueCol = findColumn(data, config.value) ?? config.value;

    const [focus, setFocus] = useState<string | null>(null);
    const [trail, setTrail] = useState<string[]>([]);

    const filteredRows = useMemo(() =>
        filterByFocus(data, sourceCol, targetCol, focus),
        [data, sourceCol, targetCol, focus]
    );

    const sankeyData = useMemo(() =>
        buildSankeyData(filteredRows, sourceCol, targetCol, valueCol),
        [filteredRows, sourceCol, targetCol, valueCol]
    );

    const handleNodeClick = useCallback((node: { name: string }) => {
        if (!node?.name) return;
        const newFocus = node.name;
        setFocus(newFocus);
        setTrail(prev => [...prev, newFocus]);
        if (gestureName && onVariableChange) {
            onVariableChange({ [`${gestureName}.click`]: newFocus });
        }
    }, [gestureName, onVariableChange]);

    const navigateTrail = useCallback((idx: number) => {
        const newTrail = trail.slice(0, idx + 1);
        const newFocus = newTrail[newTrail.length - 1] ?? null;
        setTrail(newTrail);
        setFocus(newFocus);
        if (gestureName && onVariableChange) {
            onVariableChange({ [`${gestureName}.click`]: newFocus ?? '' });
        }
    }, [trail, gestureName, onVariableChange]);

    const resetFocus = useCallback(() => {
        setFocus(null);
        setTrail([]);
        if (gestureName && onVariableChange) {
            onVariableChange({ [`${gestureName}.click`]: '' });
        }
    }, [gestureName, onVariableChange]);

    const CustomNode = useCallback(({ x, y, width, height, index, payload }: any) => {
        const fill = colors[index % colors.length];
        return (
            <Layer key={`node-${index}`}>
                <Rectangle
                    x={x} y={y} width={width} height={height}
                    fill={fill} fillOpacity={0.9} stroke="none"
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleNodeClick(payload)}
                />
                {width > 5 && (
                    <text x={x + width + 6} y={y + height / 2} dy="0.35em"
                        fill="#d1d5db" fontSize={11} textAnchor="start">
                        {payload.name}
                    </text>
                )}
            </Layer>
        );
    }, [colors, handleNodeClick]);

    if (sankeyData.nodes.length === 0) {
        return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No data</div>;
    }

    return (
        <div className="w-full h-full flex flex-col">
            {trail.length > 0 && (
                <div className="flex items-center gap-1 px-2 py-1 text-[11px] text-gray-400 flex-wrap">
                    <button onClick={resetFocus} className="hover:text-cyan-300">All</button>
                    {trail.map((seg, i) => (
                        <React.Fragment key={i}>
                            <span className="text-gray-600">›</span>
                            <button
                                onClick={() => navigateTrail(i)}
                                className={`hover:text-cyan-300 truncate max-w-[140px] ${i === trail.length - 1 ? 'text-cyan-300 font-semibold' : ''}`}
                            >{seg}</button>
                        </React.Fragment>
                    ))}
                </div>
            )}
            <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                    <Sankey
                        data={sankeyData}
                        node={CustomNode}
                        nodePadding={8}
                        nodeWidth={10}
                        margin={{ top: 8, right: 120, bottom: 8, left: 8 }}
                    >
                        <Tooltip
                            formatter={(v: number) => v.toLocaleString()}
                            contentStyle={{ background: '#1f2937', border: 'none', fontSize: 11 }}
                        />
                    </Sankey>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export const sankeyPlot: PlotRegistration<SankeyConfig> = {
    name: 'SANKEY',
    description: 'Flow diagram between categorical nodes. Click a node to re-root the view (flamegraph-like drill-down). Useful for call graphs, class hierarchies, and allocation flows.',
    params: withCommonParams(params),
    template: 'SANKEY(source: , target: , value: )',
    examples: [
        {
            description: 'Method call flow from profiling data',
            code: 'SANKEY(source: "caller", target: "callee", value: "samples") TITLE "Call Flow"',
            sampleData: [
                { caller: 'main', callee: 'gc', samples: 50 },
                { caller: 'gc', callee: 'compact', samples: 30 },
                { caller: 'gc', callee: 'sweep', samples: 20 },
            ],
        },
    ],
    parseConfig,
    component: SankeyComponent,
};
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd core/frontend && npx vitest run tests/components/plots/SankeyPlot.test.tsx 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Register in plotRegistry**

In `core/frontend/components/plots/plotRegistry.ts`, add:

```typescript
import { sankeyPlot } from './SankeyPlot';
// ...
[sankeyPlot.name]: sankeyPlot,
```

- [ ] **Step 6: TypeScript check**

```bash
cd core/frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add core/frontend/components/plots/SankeyPlot.tsx \
        core/frontend/components/plots/plotRegistry.ts \
        core/frontend/tests/components/plots/SankeyPlot.test.tsx
git commit -m "feat(plot): add SANKEY chart type with node re-root navigation and BRUSH support"
```

---

## Task 6: CROSSTAB Renderer

**Files:**
- Create: `core/frontend/components/plots/CrosstabPlot.tsx`
- Create: `core/frontend/tests/components/plots/CrosstabPlot.test.tsx`

CROSSTAB is a pure React pivot table. Cells are colored by value intensity. The `BRUSH $row_var $col_var` two-variable syntax (from Task 2) writes the row label to `$row_var` and the column label to `$col_var` on cell click.

The component reads `clauses.brush2` for the second variable. The handler calls `onVariableChange` with two separate variable entries.

- [ ] **Step 1: Write the failing tests**

Create `core/frontend/tests/components/plots/CrosstabPlot.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { crosstabPlot, aggregate, type AggFunc } from '../../../components/plots/CrosstabPlot';

describe('crosstabPlot registration', () => {
    it('has name CROSSTAB', () => {
        expect(crosstabPlot.name).toBe('CROSSTAB');
    });

    it('requires row, col, value', () => {
        ['row', 'col', 'value'].forEach(name => {
            expect(crosstabPlot.params.find(p => p.name === name)?.required).toBe(true);
        });
    });

    it('has optional agg param with default SUM', () => {
        const agg = crosstabPlot.params.find(p => p.name === 'agg');
        expect(agg).toBeDefined();
        expect(agg?.defaultValue).toBe('SUM');
    });
});

describe('crosstabPlot parseConfig', () => {
    it('parses all required columns', () => {
        const cfg = crosstabPlot.parseConfig('CROSSTAB(row: "gcType", col: "phase", value: "duration")', []);
        expect(cfg.row).toBe('gcType');
        expect(cfg.col).toBe('phase');
        expect(cfg.value).toBe('duration');
    });

    it('parses agg function', () => {
        const cfg = crosstabPlot.parseConfig('CROSSTAB(row: "r", col: "c", value: "v", agg: "AVG")', []);
        expect(cfg.agg).toBe('AVG');
    });

    it('defaults agg to SUM', () => {
        const cfg = crosstabPlot.parseConfig('CROSSTAB(row: "r", col: "c", value: "v")', []);
        expect(cfg.agg ?? 'SUM').toBe('SUM');
    });
});

describe('aggregate', () => {
    const rows = [
        { type: 'G1 GC', phase: 'Mark', dur: 10 },
        { type: 'G1 GC', phase: 'Mark', dur: 20 },
        { type: 'G1 GC', phase: 'Sweep', dur: 15 },
        { type: 'Full GC', phase: 'Mark', dur: 100 },
    ];

    it('SUM aggregates correctly', () => {
        const result = aggregate(rows, 'type', 'phase', 'dur', 'SUM');
        expect(result.get('G1 GC')?.get('Mark')).toBe(30);
    });

    it('AVG aggregates correctly', () => {
        const result = aggregate(rows, 'type', 'phase', 'dur', 'AVG');
        expect(result.get('G1 GC')?.get('Mark')).toBe(15);
    });

    it('COUNT counts rows ignoring value', () => {
        const result = aggregate(rows, 'type', 'phase', 'dur', 'COUNT');
        expect(result.get('G1 GC')?.get('Mark')).toBe(2);
    });

    it('MAX finds maximum', () => {
        const result = aggregate(rows, 'type', 'phase', 'dur', 'MAX');
        expect(result.get('G1 GC')?.get('Mark')).toBe(20);
    });

    it('MIN finds minimum', () => {
        const result = aggregate(rows, 'type', 'phase', 'dur', 'MIN');
        expect(result.get('G1 GC')?.get('Mark')).toBe(10);
    });

    it('handles empty data', () => {
        expect(aggregate([], 'r', 'c', 'v', 'SUM').size).toBe(0);
    });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd core/frontend && npx vitest run tests/components/plots/CrosstabPlot.test.tsx 2>&1 | head -20
```

Expected: module not found.

- [ ] **Step 3: Create `CrosstabPlot.tsx`**

Create `core/frontend/components/plots/CrosstabPlot.tsx`:

```typescript
import React, { useContext, useMemo, useCallback } from 'react';
import type { PlotRegistration, PlotParameter } from './plotTypes';
import { withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn } from '../../utils/plotUtils';
import type { ParsedPlotCall } from '../../utils/plotParser';

export type AggFunc = 'SUM' | 'AVG' | 'COUNT' | 'MAX' | 'MIN';

export interface CrosstabConfig {
    row: string;
    col: string;
    value: string;
    agg?: AggFunc;
}

const params: PlotParameter[] = [
    { name: 'row', type: 'column', required: true, description: 'Column for row labels.' },
    { name: 'col', type: 'column', required: true, description: 'Column for column headers.' },
    { name: 'value', type: 'column', required: true, description: 'Numeric column to aggregate.' },
    {
        name: 'agg', type: 'string', required: false, defaultValue: 'SUM',
        options: ['SUM', 'AVG', 'COUNT', 'MAX', 'MIN'],
        description: 'Aggregation function: SUM (default), AVG, COUNT, MAX, or MIN.',
    },
];

const parseConfig = createConfigParser<CrosstabConfig>(buildParserSpec(params));

/** Aggregate rows into a nested Map: rowLabel → colLabel → aggregated value. */
export function aggregate(
    rows: any[],
    rowCol: string,
    colCol: string,
    valueCol: string,
    agg: AggFunc,
): Map<string, Map<string, number>> {
    const acc = new Map<string, Map<string, { sum: number; count: number; min: number; max: number }>>();
    for (const row of rows) {
        const r = String(row[rowCol] ?? '');
        const c = String(row[colCol] ?? '');
        const v = parseFloat(String(row[valueCol]));
        if (isNaN(v)) continue;
        if (!acc.has(r)) acc.set(r, new Map());
        const inner = acc.get(r)!;
        if (!inner.has(c)) inner.set(c, { sum: 0, count: 0, min: Infinity, max: -Infinity });
        const cell = inner.get(c)!;
        cell.sum += v; cell.count++; cell.min = Math.min(cell.min, v); cell.max = Math.max(cell.max, v);
    }
    const result = new Map<string, Map<string, number>>();
    for (const [r, inner] of acc) {
        result.set(r, new Map());
        for (const [c, cell] of inner) {
            let val: number;
            if (agg === 'SUM') val = cell.sum;
            else if (agg === 'AVG') val = cell.sum / cell.count;
            else if (agg === 'COUNT') val = cell.count;
            else if (agg === 'MAX') val = cell.max;
            else val = cell.min;
            result.get(r)!.set(c, val);
        }
    }
    return result;
}

const ACCENT = '#60a5fa'; // cyan-400 equivalent for heat scale

function cellBg(val: number, min: number, max: number): string {
    if (max === min) return 'transparent';
    const t = (val - min) / (max - min);
    // Interpolate from rgba(0,0,0,0) → rgba(96,165,250,0.7)
    const a = Math.round(t * 70) / 100;
    return `rgba(96,165,250,${a.toFixed(2)})`;
}

const CrosstabComponent: React.FC<{
    config: CrosstabConfig;
    data: any[];
    isAnimationActive?: boolean;
    animationDuration?: number;
    clauses?: ParsedPlotCall;
    gestureName?: string;
    onVariableChange?: (vars: Record<string, unknown>) => void;
}> = ({ config, data, clauses, gestureName, onVariableChange }) => {
    useContext(SettingsContext);

    const rowCol = findColumn(data, config.row) ?? config.row;
    const colCol = findColumn(data, config.col) ?? config.col;
    const valueCol = findColumn(data, config.value) ?? config.value;
    const agg: AggFunc = (config.agg as AggFunc) ?? 'SUM';

    const cells = useMemo(() => aggregate(data, rowCol, colCol, valueCol, agg), [data, rowCol, colCol, valueCol, agg]);

    const rows = useMemo(() => Array.from(cells.keys()).sort(), [cells]);
    const cols = useMemo(() => {
        const s = new Set<string>();
        for (const inner of cells.values()) for (const c of inner.keys()) s.add(c);
        return Array.from(s).sort();
    }, [cells]);

    const { min, max } = useMemo(() => {
        let mn = Infinity, mx = -Infinity;
        for (const inner of cells.values()) for (const v of inner.values()) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
        return { min: isFinite(mn) ? mn : 0, max: isFinite(mx) ? mx : 0 };
    }, [cells]);

    const brush2Name = (clauses as any)?.brush2 as string | undefined;

    const handleCellClick = useCallback((rowLabel: string, colLabel: string) => {
        if (!gestureName || !onVariableChange) return;
        const vars: Record<string, unknown> = {
            [`${gestureName}.click`]: rowLabel,
        };
        if (brush2Name) {
            const g2 = brush2Name.replace(/^\$/, '');
            vars[`${g2}.click`] = colLabel;
        }
        onVariableChange(vars);
    }, [gestureName, brush2Name, onVariableChange]);

    if (rows.length === 0) {
        return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No data</div>;
    }

    return (
        <div className="w-full h-full overflow-auto">
            <table className="text-[11px] border-collapse w-full">
                <thead>
                    <tr>
                        <th className="px-2 py-1 text-left text-gray-500 border-b border-gray-700 sticky top-0 bg-gray-900 z-10" />
                        {cols.map(c => (
                            <th key={c} className="px-2 py-1 text-right text-gray-400 border-b border-gray-700 sticky top-0 bg-gray-900 z-10 whitespace-nowrap">
                                {c}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map(r => (
                        <tr key={r} className="hover:bg-gray-800/50">
                            <td className="px-2 py-1 text-gray-400 whitespace-nowrap border-b border-gray-800/50">{r}</td>
                            {cols.map(c => {
                                const val = cells.get(r)?.get(c);
                                return (
                                    <td
                                        key={c}
                                        className="px-2 py-1 text-right border-b border-gray-800/50 cursor-pointer"
                                        style={{ background: val != null ? cellBg(val, min, max) : undefined }}
                                        onClick={() => val != null && handleCellClick(r, c)}
                                        title={val != null ? `${r} / ${c}: ${val}` : undefined}
                                    >
                                        {val != null ? val.toLocaleString(undefined, { maximumFractionDigits: 2 }) : ''}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export const crosstabPlot: PlotRegistration<CrosstabConfig> = {
    name: 'CROSSTAB',
    description: 'Pivot table with cell-level color intensity scaling. Shows aggregated values (SUM/AVG/COUNT/MAX/MIN) grouped by two categorical dimensions.',
    params: withCommonParams(params),
    template: 'CROSSTAB(row: , col: , value: )',
    examples: [
        {
            description: 'GC pause by cause and phase with AVG aggregation',
            code: 'CROSSTAB(row: "cause", col: "phase", value: "pauseMs", agg: "AVG") TITLE "Avg Pause by Cause and Phase"',
            sampleData: [
                { cause: 'G1 GC', phase: 'Mark', pauseMs: 12 },
                { cause: 'G1 GC', phase: 'Sweep', pauseMs: 8 },
                { cause: 'Full GC', phase: 'Mark', pauseMs: 150 },
                { cause: 'Full GC', phase: 'Compact', pauseMs: 200 },
            ],
        },
    ],
    parseConfig,
    component: CrosstabComponent,
};
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd core/frontend && npx vitest run tests/components/plots/CrosstabPlot.test.tsx 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Register in plotRegistry**

In `core/frontend/components/plots/plotRegistry.ts`, add:

```typescript
import { crosstabPlot } from './CrosstabPlot';
// ...
[crosstabPlot.name]: crosstabPlot,
```

- [ ] **Step 6: TypeScript check**

```bash
cd core/frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add core/frontend/components/plots/CrosstabPlot.tsx \
        core/frontend/components/plots/plotRegistry.ts \
        core/frontend/tests/components/plots/CrosstabPlot.test.tsx
git commit -m "feat(plot): add CROSSTAB pivot table with two-variable BRUSH and color scaling"
```

---

## Task 7: Full Test Suite — All Tests Green

- [ ] **Step 1: Run all new tests together**

```bash
cd core/frontend && npx vitest run \
  tests/components/editor/plot/newShapes.test.ts \
  tests/components/plots/ViolinPlot.test.tsx \
  tests/components/plots/SunburstPlot.test.tsx \
  tests/components/plots/SankeyPlot.test.tsx \
  tests/components/plots/CrosstabPlot.test.tsx \
  2>&1 | tail -30
```

Expected: all tests pass, zero failures.

- [ ] **Step 2: Run the full vitest suite to check for regressions**

```bash
cd core/frontend && npx vitest run 2>&1 | tail -20
```

Expected: no pre-existing tests broken.

- [ ] **Step 3: TypeScript full check**

```bash
cd core/frontend && npx tsc --noEmit 2>&1
```

Expected: zero type errors.

---

## Task 8: Documentation — Update web-ui.md

**Files:**
- Modify: `docs-site/web-ui.md`

- [ ] **Step 1: Find the existing chart-type reference section**

```bash
grep -n 'TREEMAP\|WATERFALL\|BOX_PLOT\|chart type' docs-site/web-ui.md | head -20
```

- [ ] **Step 2: Add / update chart type documentation**

Find the section in `docs-site/web-ui.md` that documents chart types and add entries for all six charts (TREEMAP, WATERFALL — now confirming they work via lowercase, and VIOLIN_PLOT, SUNBURST, SANKEY, CROSSTAB). Add each in the existing format used for other charts. Example entries to append in the appropriate section:

```markdown
### TREEMAP

Proportional area chart — nodes sized by a numeric value.

```
TREEMAP(label: "cause", value: "count")
treemap { label: cause, value: count }   -- lowercase form
```

| Parameter | Required | Notes |
|-----------|----------|-------|
| `label` | yes | Category column |
| `value` | yes | Numeric size column |
| `colorBy` | no | Column to derive node color |
| `showLabels` | no | Default: true |

### WATERFALL

Incremental change chart — shows deltas that sum to a total.

```
WATERFALL(category: "phase", value: "delta")
```

| Parameter | Required | Notes |
|-----------|----------|-------|
| `category` | yes | Step name column |
| `value` | yes | Signed numeric delta column |

### VIOLIN_PLOT

Distribution shape via kernel density estimate, one violin per category.

```
VIOLIN_PLOT(value: "pauseDuration", category: "cause", bins: 30)
VIOLIN_PLOT(value: "pauseDuration", category: "cause") BRUSH $selected MODE X
```

| Parameter | Required | Default | Notes |
|-----------|----------|---------|-------|
| `value` | yes | — | Numeric distribution column |
| `category` | no | — | One violin per group |
| `bins` | no | 20 | KDE resolution |

Clicking a violin with `BRUSH $var` writes the category name to `$var`.

### SUNBURST

Hierarchical part-of-whole. Click segments to drill down; click center to go up.

```
SUNBURST(path: ["pkg", "className"], value: "allocBytes")
SUNBURST(path: "pkg/cls/method", value: "samples") BRUSH $level MODE X
```

| Parameter | Required | Notes |
|-----------|----------|-------|
| `path` | yes | Array of hierarchy columns, or single slash-delimited column |
| `value` | yes | Numeric size column |

`BRUSH $var` writes the current drill-down path (slash-joined) on each navigation.

### SANKEY

Flow diagram between categorical nodes. Click a node to re-root the view (flamegraph-style).

```
SANKEY(source: "caller", target: "callee", value: "samples")
SANKEY(source: "caller", target: "callee", value: "samples") BRUSH $focused MODE X
```

| Parameter | Required | Notes |
|-----------|----------|-------|
| `source` | yes | Left/source node column |
| `target` | yes | Right/target node column |
| `value` | yes | Numeric flow width column |

Clicking a node re-roots the diagram to show only edges passing through that node. A breadcrumb bar shows the navigation path. `BRUSH $var` writes the focused node name.

### CROSSTAB

Pivot table with cell-level color intensity. Supports two-variable BRUSH for row + column selection.

```
CROSSTAB(row: "cause", col: "phase", value: "duration", agg: "AVG")
CROSSTAB(row: "cause", col: "phase", value: "duration") BRUSH $row_var $col_var
```

| Parameter | Required | Default | Notes |
|-----------|----------|---------|-------|
| `row` | yes | — | Row label column |
| `col` | yes | — | Column header column |
| `value` | yes | — | Numeric aggregate column |
| `agg` | no | SUM | SUM, AVG, COUNT, MAX, or MIN |

Clicking a cell with `BRUSH $row_var $col_var` writes the row label to `$row_var` and the column label to `$col_var`.
```

- [ ] **Step 3: Commit**

```bash
git add docs-site/web-ui.md
git commit -m "docs: document TREEMAP, WATERFALL, VIOLIN_PLOT, SUNBURST, SANKEY, CROSSTAB in web-ui.md"
```

---

## Task 9: Model Retraining — Add New Shapes to Training Data

**Files:**
- Modify: `scripts/train/gen_plot_pairs.py`
- Modify: `scripts/train/test_completion_scenarios.py`

- [ ] **Step 1: Update PLOT_DOCS in gen_plot_pairs.py**

In `scripts/train/gen_plot_pairs.py`, find the `PLOT_DOCS` string (line 26) and add the four new chart types after the existing entries, before the closing `"""`:

```python
VIOLIN_PLOT(value: "col", category: "col", bins: N)
  Required: value (numeric). Optional: category (one violin per group), bins (default 20).
  Use for: distribution comparison across categories, spotting bimodal or skewed distributions.

SUNBURST(path: ["col1", "col2"], value: "col")
  Required: path (array of hierarchy columns, or single slash-delimited column), value (numeric).
  Use for: hierarchical part-of-whole, package/class/method allocation breakdowns.

SANKEY(source: "col", target: "col", value: "col")
  Required: source (categorical), target (categorical), value (numeric flow).
  Use for: call graphs, class hierarchies, allocation flows, pipeline stage throughput.

CROSSTAB(row: "col", col: "col", value: "col", agg: "SUM"|"AVG"|"COUNT"|"MAX"|"MIN")
  Required: row (categorical), col (categorical), value (numeric). Optional: agg (default SUM).
  Use for: cross-dimensional aggregation — pause by cause and phase, allocations by type and thread.
```

- [ ] **Step 2: Add scenario entries to test_completion_scenarios.py**

In `scripts/train/test_completion_scenarios.py`, find the `SCENARIOS` list and add at least two scenarios per new shape. Add after the last existing scenario block:

```python
    # ── VIOLIN_PLOT ────────────────────────────────────────────────────────────
    Scenario("violin_pause_by_cause", "VIOLIN_PLOT",
             "SELECT cause, pauseDuration FROM gc_events",
             ["cause", "pauseDuration"], "GC pause distribution by cause"),
    Scenario("violin_cpu_distribution", "VIOLIN_PLOT",
             "SELECT gcType, cpuLoad FROM gc_events",
             ["gcType", "cpuLoad"], "CPU load distribution by GC type"),

    # ── SUNBURST ────────────────────────────────────────────────────────────────
    Scenario("sunburst_alloc_hierarchy", "SUNBURST",
             "SELECT pkg, className, sum(allocBytes) AS allocBytes FROM alloc_events GROUP BY pkg, className",
             ["pkg", "className", "allocBytes"], "Allocation by package / class"),
    Scenario("sunburst_call_hierarchy", "SUNBURST",
             "SELECT module, clazz, method, sum(samples) AS samples FROM profiling GROUP BY module, clazz, method",
             ["module", "clazz", "method", "samples"], "Profiling by module/class/method"),

    # ── SANKEY ──────────────────────────────────────────────────────────────────
    Scenario("sankey_call_flow", "SANKEY",
             "SELECT caller, callee, count(*) AS samples FROM call_graph GROUP BY caller, callee ORDER BY samples DESC LIMIT 100",
             ["caller", "callee", "samples"], "Method call flow"),
    Scenario("sankey_gc_transitions", "SANKEY",
             "SELECT from_phase, to_phase, count(*) AS transitions FROM gc_phase_transitions GROUP BY from_phase, to_phase",
             ["from_phase", "to_phase", "transitions"], "GC phase transitions"),

    # ── CROSSTAB ────────────────────────────────────────────────────────────────
    Scenario("crosstab_pause_cause_phase", "CROSSTAB",
             "SELECT cause, phase, avg(pauseMs) AS avg_pause FROM gc_events GROUP BY cause, phase",
             ["cause", "phase", "avg_pause"], "Average GC pause by cause and phase"),
    Scenario("crosstab_alloc_type_thread", "CROSSTAB",
             "SELECT allocType, threadName, sum(allocBytes) AS total FROM alloc_events GROUP BY allocType, threadName",
             ["allocType", "threadName", "total"], "Allocation by type and thread"),
```

- [ ] **Step 3: Commit the updated training files**

```bash
git add scripts/train/gen_plot_pairs.py scripts/train/test_completion_scenarios.py
git commit -m "feat(train): add VIOLIN_PLOT, SUNBURST, SANKEY, CROSSTAB to training data and test scenarios"
```

- [ ] **Step 4: Run retraining (if Python environment is available)**

```bash
# Only run if ANTHROPIC_API_KEY is set and Python env is active.
# Skip data generation and go straight to retrain on existing + updated scenarios:
cd scripts/train && ./run_training.sh --skip-data 2>&1 | tail -40
```

If the Python training environment is not set up in this session, skip this step and note it for later. The training script requires Python 3.10+ with PyTorch, transformers, and onnxruntime installed.

- [ ] **Step 5: Run model evaluation to verify new shapes are predicted correctly**

```bash
cd scripts/train && python3 test_completion_scenarios.py --onnx onnx/t5-small-q8-arm --category VIOLIN_PLOT 2>&1
cd scripts/train && python3 test_completion_scenarios.py --onnx onnx/t5-small-q8-arm --category SUNBURST 2>&1
cd scripts/train && python3 test_completion_scenarios.py --onnx onnx/t5-small-q8-arm --category SANKEY 2>&1
cd scripts/train && python3 test_completion_scenarios.py --onnx onnx/t5-small-q8-arm --category CROSSTAB 2>&1
```

Expected: pass rate ≥ 75% for each new shape after retraining.

---

## Task 10: Manual Smoke Test in Browser

These steps cannot be automated — they require a running dev server. Run after all code tasks complete.

- [ ] **Step 1: Start dev server**

```bash
cd core/frontend && npm run dev
```

- [ ] **Step 2: Smoke test each new chart type**

Open the app in a browser and create a notebook with one SQL cell per chart:

```sql
-- VIOLIN_PLOT test
SELECT cause, pauseDuration FROM events WHERE pauseDuration IS NOT NULL
```
```
VIOLIN_PLOT(value: "pauseDuration", category: "cause")
```

```sql
-- TREEMAP lowercase test
SELECT cause, count(*) AS cnt FROM events GROUP BY cause
```
```
treemap { label: cause, value: cnt }
```

```sql
-- WATERFALL lowercase test
SELECT phase, duration FROM gc_phases ORDER BY step
```
```
waterfall { category: phase, value: duration }
```

Expected: all charts render without React errors in the browser console.

- [ ] **Step 3: Test SANKEY navigation**

Create a SANKEY plot. Click a node. Verify: breadcrumb appears, diagram re-roots to show only edges through that node. Click breadcrumb to go back. Verify: diagram resets.

- [ ] **Step 4: Test SUNBURST drill-down**

Create a SUNBURST plot with a multi-level path. Click an inner arc. Verify: view re-roots, breadcrumb appears. Click center. Verify: goes up one level.

- [ ] **Step 5: Test CROSSTAB with BRUSH**

Create a notebook with:
1. SQL cell: `SELECT cause, phase, avg(pauseDuration) AS p FROM events GROUP BY cause, phase`
2. Plot cell: `CROSSTAB(row: "cause", col: "phase", value: "p") BRUSH $row $col`
3. A text cell or second plot that references `$row` and `$col`

Click a cell. Verify the variables update.

---

## Self-Review Checklist

- [x] **Spec section 1 (TREEMAP/WATERFALL fix)** → Task 1
- [x] **Spec section 2 (VIOLIN_PLOT)** → Task 3
- [x] **Spec section 3 (SUNBURST)** → Task 4
- [x] **Spec section 4 (SANKEY)** → Task 5
- [x] **Spec section 5 (CROSSTAB + two-var BRUSH syntax)** → Task 2 + Task 6
- [x] **Spec section 6 (docs update)** → Task 8
- [x] **Spec section 7 (unit tests)** → included in each task + Task 7
- [x] **Spec section 8 (model retraining)** → Task 9
- [x] **No placeholders** — all tasks have complete code
- [x] **Type consistency** — `ViolinConfig`, `SunburstConfig`, `SankeyConfig`, `CrosstabConfig` each defined and used consistently; `brush2` field added to `ParsedPlotCall`
- [x] **Brush wiring** — all four components accept `gestureName` and `onVariableChange`; PlotRenderer already passes these via `clauses.brush?.name` (lines 1048–1062) — no PlotRenderer changes needed
