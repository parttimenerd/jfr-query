# Treemap, Waterfall, and LLM Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TREEMAP and WATERFALL plot types, improve LLM context quality (all examples per shape, cardinality hints, new heuristics), and update training data generation to include the new plot families.

**Architecture:** Each new plot type follows the established PlotRegistration pattern (Config interface → params → parseConfig → component → export). LLM improvements touch the autocomplete system prompt (aiPlotContext.ts), the suggestPlot tool heuristics (runtime.ts), and the training data generator (generatePlotDataset.ts). No new abstractions; all changes slot into the existing plugin points.

**Tech Stack:** React 18, TypeScript, Recharts 3.2.1 (has built-in `<Treemap>`), ComposedChart + Bar (invisible base) for Waterfall, Transformers.js T5-small, DuckDB-WASM, Vitest.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `core/frontend/components/plots/TreemapPlot.tsx` | Create | TREEMAP component + registration |
| `core/frontend/components/plots/WaterfallPlot.tsx` | Create | WATERFALL component + registration |
| `core/frontend/components/plots/plotRegistry.ts` | Modify | Register TREEMAP + WATERFALL + TREE alias |
| `core/frontend/components/plots/plotNames.ts` | Modify | Add TREE → TREEMAP, FALL → WATERFALL aliases |
| `core/frontend/services/ml/candidates.ts` | Modify | Add TREEMAP + WATERFALL to PLOT_NAMES |
| `core/frontend/components/editor/plot/aiPlotContext.ts` | Modify | SYSTEM_PROMPT shape list + multi-example summarizer |
| `core/frontend/services/ai/tools/runtime.ts` | Modify | suggestPlot: cardinality query + new heuristics |
| `core/frontend/scripts/training/generatePlotDataset.ts` | Modify | PlotFamily type + SQL_POOL entries for new families |
| `core/frontend/tests/plots/treemap.test.ts` | Create | Unit tests for TreemapPlot |
| `core/frontend/tests/plots/waterfall.test.ts` | Create | Unit tests for WaterfallPlot |
| `core/frontend/tests/services/tools.suggestPlot.test.ts` | Modify | Tests for new heuristics + cardinality path |
| `core/frontend/tests/editor/aiPlotContext.test.ts` | Modify | Tests for multi-example summarizer |

---

## Task 1: TREEMAP plot component

**Files:**
- Create: `core/frontend/components/plots/TreemapPlot.tsx`
- Test: `core/frontend/tests/plots/treemap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `core/frontend/tests/plots/treemap.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { treemapPlot } from '../../components/plots/TreemapPlot';

describe('TreemapPlot registration', () => {
    it('has name TREEMAP', () => {
        expect(treemapPlot.name).toBe('TREEMAP');
    });

    it('parseConfig extracts label and value params', () => {
        const cfg = treemapPlot.parseConfig('TREEMAP(label: "objectClass", value: "weight")', []);
        expect(cfg.label).toBe('objectClass');
        expect(cfg.value).toBe('weight');
    });

    it('parseConfig accepts optional colorBy param', () => {
        const cfg = treemapPlot.parseConfig('TREEMAP(label: "objectClass", value: "weight", colorBy: "thread")', []);
        expect(cfg.colorBy).toBe('thread');
    });

    it('parseConfig uses defaults for missing optional params', () => {
        const cfg = treemapPlot.parseConfig('TREEMAP(label: "name", value: "size")', []);
        expect(cfg.showLabels).toBe(true);
        expect(cfg.colorBy).toBeUndefined();
    });

    it('template contains required params', () => {
        expect(treemapPlot.template).toContain('label');
        expect(treemapPlot.template).toContain('value');
    });

    it('has at least 2 examples', () => {
        expect(treemapPlot.examples.length).toBeGreaterThanOrEqual(2);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd core/frontend && npx vitest run tests/plots/treemap.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `core/frontend/components/plots/TreemapPlot.tsx`:

```typescript
import React, { useContext, useMemo } from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { getPaletteColors } from '../../utils/plotUtils';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec } from '../../utils/plotUtils';
import type { ParsedPlotCall } from '../../utils/plotParser';

interface TreemapConfig {
    label: string;
    value: string;
    colorBy?: string;
    showLabels?: boolean;
}

const DEFAULT_COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff7300'];

const params: PlotParameter[] = [
    { name: 'label', type: 'column', required: true, description: 'Column for node labels (category names).' },
    { name: 'value', type: 'column', required: true, description: 'Numeric column for node sizes.' },
    { name: 'colorBy', type: 'column', description: 'Column to derive node color from. Omit to use a sequential palette.' },
    { name: 'showLabels', type: 'boolean', description: 'Show text labels inside nodes.', defaultValue: true },
];

const parseConfig = createConfigParser<TreemapConfig>(buildParserSpec(params));

const COLORS_STABLE = DEFAULT_COLORS;

const TreemapComponent: React.FC<{
    config: TreemapConfig;
    data: any[];
    isAnimationActive?: boolean;
    animationDuration?: number;
    clauses?: ParsedPlotCall;
}> = ({ config, data, isAnimationActive, clauses }) => {
    const { settings } = useContext(SettingsContext);
    const colors = getPaletteColors(clauses?.palette, COLORS_STABLE);

    const chartData = useMemo(() => {
        if (!data || data.length === 0) return [];
        // Build unique color index per colorBy value if colorBy is set.
        const colorIndex: Record<string, number> = {};
        let colorCounter = 0;
        return data
            .map(row => {
                const label = String(row[config.label] ?? '');
                const value = parseFloat(row[config.value]);
                if (isNaN(value) || value <= 0) return null;
                let colorKey = config.colorBy ? String(row[config.colorBy] ?? '') : label;
                if (!(colorKey in colorIndex)) colorIndex[colorKey] = colorCounter++ % colors.length;
                return { name: label, size: value, fill: colors[colorIndex[colorKey]] };
            })
            .filter(Boolean) as { name: string; size: number; fill: string }[];
    }, [data, config.label, config.value, config.colorBy, colors]);

    if (chartData.length === 0) return <div className="p-4 text-center text-gray-500 text-sm">No valid data.</div>;

    const showLabels = config.showLabels ?? true;

    const CustomContent = (props: any) => {
        const { x, y, width, height, name } = props;
        if (!showLabels || width < 30 || height < 20) return <g><rect x={x} y={y} width={width} height={height} style={{ fill: props.fill, stroke: '#fff', strokeWidth: 1 }} /></g>;
        return (
            <g>
                <rect x={x} y={y} width={width} height={height} style={{ fill: props.fill, stroke: '#fff', strokeWidth: 1 }} />
                <text x={x + width / 2} y={y + height / 2} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={Math.min(12, width / 6)} style={{ pointerEvents: 'none' }}>
                    {String(name).slice(0, Math.floor(width / 7))}
                </text>
            </g>
        );
    };

    return (
        <div style={{ width: '100%', minHeight: 200 }}>
            <ResponsiveContainer width="100%" minHeight={200}>
                <Treemap
                    data={chartData}
                    dataKey="size"
                    aspectRatio={4 / 3}
                    isAnimationActive={isAnimationActive}
                    content={<CustomContent />}
                >
                    <Tooltip formatter={(v: any, name: any) => [v, name]} />
                </Treemap>
            </ResponsiveContainer>
        </div>
    );
};

export const treemapPlot: PlotRegistration<TreemapConfig> = {
    name: 'TREEMAP',
    description: 'Treemap — shows hierarchical data as nested rectangles sized by a numeric value.',
    params: withCommonParams(params),
    supportsMultiQuery: false,
    template: 'TREEMAP(label: "$label", value: "$value")',
    examples: [
        {
            description: 'Allocation by class (sized by weight)',
            code: 'TREEMAP(label: "objectClass", value: "weight")',
        },
        {
            description: 'Heap regions sized by live data, colored by region type',
            code: 'TREEMAP(label: "region", value: "liveData", colorBy: "type")',
        },
        {
            description: 'Method call count treemap with labels hidden',
            code: 'TREEMAP(label: "method", value: "callCount", showLabels: false) TITLE "Call distribution"',
        },
    ],
    parseConfig,
    component: TreemapComponent,
};
```

- [ ] **Step 4: Run test to verify it passes**

```
cd core/frontend && npx vitest run tests/plots/treemap.test.ts
```
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add core/frontend/components/plots/TreemapPlot.tsx core/frontend/tests/plots/treemap.test.ts
git commit -m "feat(plots): add TREEMAP plot type"
```

---

## Task 2: WATERFALL plot component

**Files:**
- Create: `core/frontend/components/plots/WaterfallPlot.tsx`
- Test: `core/frontend/tests/plots/waterfall.test.ts`

- [ ] **Step 1: Write the failing test**

Create `core/frontend/tests/plots/waterfall.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { waterfallPlot } from '../../components/plots/WaterfallPlot';

describe('WaterfallPlot registration', () => {
    it('has name WATERFALL', () => {
        expect(waterfallPlot.name).toBe('WATERFALL');
    });

    it('parseConfig extracts category and value params', () => {
        const cfg = waterfallPlot.parseConfig('WATERFALL(category: "phase", value: "delta")', []);
        expect(cfg.category).toBe('phase');
        expect(cfg.value).toBe('delta');
    });

    it('parseConfig accepts optional total param', () => {
        const cfg = waterfallPlot.parseConfig('WATERFALL(category: "step", value: "change", total: "isTotal")', []);
        expect(cfg.total).toBe('isTotal');
    });

    it('parseConfig has showValues defaulting to true', () => {
        const cfg = waterfallPlot.parseConfig('WATERFALL(category: "step", value: "change")', []);
        expect(cfg.showValues).toBe(true);
    });

    it('template contains required params', () => {
        expect(waterfallPlot.template).toContain('category');
        expect(waterfallPlot.template).toContain('value');
    });

    it('has at least 2 examples', () => {
        expect(waterfallPlot.examples.length).toBeGreaterThanOrEqual(2);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd core/frontend && npx vitest run tests/plots/waterfall.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `core/frontend/components/plots/WaterfallPlot.tsx`:

```typescript
import React, { useContext, useMemo } from 'react';
import { ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { getPaletteColors } from '../../utils/plotUtils';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec } from '../../utils/plotUtils';
import type { ParsedPlotCall } from '../../utils/plotParser';

interface WaterfallConfig {
    category: string;
    value: string;
    total?: string;
    showValues?: boolean;
    positiveColor?: string;
    negativeColor?: string;
    totalColor?: string;
}

const params: PlotParameter[] = [
    { name: 'category', type: 'column', required: true, description: 'Column for step/phase labels on X axis.' },
    { name: 'value', type: 'column', required: true, description: 'Numeric column for the delta change at each step.' },
    { name: 'total', type: 'column', description: 'Boolean column (truthy = this row is a total bar, rendered from zero).' },
    { name: 'showValues', type: 'boolean', description: 'Show the numeric delta above each bar.', defaultValue: true },
    { name: 'positiveColor', type: 'string', description: 'Fill color for positive bars (default: #22c55e).', defaultValue: '#22c55e' },
    { name: 'negativeColor', type: 'string', description: 'Fill color for negative bars (default: #ef4444).', defaultValue: '#ef4444' },
    { name: 'totalColor', type: 'string', description: 'Fill color for total bars (default: #60a5fa).', defaultValue: '#60a5fa' },
];

const parseConfig = createConfigParser<WaterfallConfig>(buildParserSpec(params));

interface WaterfallBar {
    name: string;
    base: number;    // invisible base bar (bottom of visible segment)
    delta: number;   // visible height
    fill: string;
    rawDelta: number;
    isTotal: boolean;
}

function buildWaterfallBars(
    data: any[],
    config: WaterfallConfig,
): WaterfallBar[] {
    const posColor = config.positiveColor ?? '#22c55e';
    const negColor = config.negativeColor ?? '#ef4444';
    const totColor = config.totalColor ?? '#60a5fa';

    let running = 0;
    return data.map(row => {
        const name = String(row[config.category] ?? '');
        const delta = parseFloat(row[config.value]);
        if (isNaN(delta)) return null;
        const isTotal = config.total ? Boolean(row[config.total]) : false;

        let base: number;
        let fill: string;

        if (isTotal) {
            base = 0;
            fill = totColor;
            running = delta; // reset running total to the total value
        } else {
            base = delta >= 0 ? running : running + delta;
            fill = delta >= 0 ? posColor : negColor;
            running += delta;
        }

        return { name, base, delta: Math.abs(delta), fill, rawDelta: delta, isTotal };
    }).filter(Boolean) as WaterfallBar[];
}

const WaterfallComponent: React.FC<{
    config: WaterfallConfig;
    data: any[];
    isAnimationActive?: boolean;
    animationDuration?: number;
    clauses?: ParsedPlotCall;
}> = ({ config, data, isAnimationActive, animationDuration }) => {
    const showValues = config.showValues ?? true;

    const bars = useMemo(() => {
        if (!data || data.length === 0) return [];
        return buildWaterfallBars(data, config);
    }, [data, config]);

    if (bars.length === 0) return <div className="p-4 text-center text-gray-500 text-sm">No valid data.</div>;

    return (
        <div style={{ width: '100%', minHeight: 200 }}>
            <ResponsiveContainer width="100%" minHeight={200}>
                <ComposedChart data={bars} margin={{ top: showValues ? 20 : 5, right: 20, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip
                        formatter={(value: any, name: string, entry: any) => {
                            if (name === 'base') return null;
                            return [entry.payload.rawDelta, entry.payload.name];
                        }}
                        filterNull
                    />
                    {/* Invisible base bar to push visible segment up */}
                    <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} legendType="none" />
                    {/* Visible delta bar */}
                    <Bar dataKey="delta" stackId="wf" isAnimationActive={isAnimationActive} animationDuration={animationDuration}>
                        {bars.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                        {showValues && (
                            <LabelList
                                dataKey="rawDelta"
                                position="top"
                                formatter={(v: number) => v > 0 ? `+${v}` : String(v)}
                                style={{ fontSize: 11 }}
                            />
                        )}
                    </Bar>
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
};

export const waterfallPlot: PlotRegistration<WaterfallConfig> = {
    name: 'WATERFALL',
    description: 'Waterfall chart — shows cumulative effect of sequential positive/negative deltas.',
    params: withCommonParams(params),
    supportsMultiQuery: false,
    template: 'WATERFALL(category: "$category", value: "$value")',
    examples: [
        {
            description: 'GC pause contribution per phase',
            code: 'WATERFALL(category: "phase", value: "pauseMs")',
        },
        {
            description: 'Memory change by GC event with totals highlighted',
            code: 'WATERFALL(category: "gcName", value: "memDelta", total: "isCumulative", showValues: true)',
        },
        {
            description: 'Heap delta before/after GC with custom colors',
            code: 'WATERFALL(category: "step", value: "heapDelta", positiveColor: "#22c55e", negativeColor: "#ef4444") TITLE "Heap waterfall"',
        },
    ],
    parseConfig,
    component: WaterfallComponent,
};
```

- [ ] **Step 4: Run test to verify it passes**

```
cd core/frontend && npx vitest run tests/plots/waterfall.test.ts
```
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add core/frontend/components/plots/WaterfallPlot.tsx core/frontend/tests/plots/waterfall.test.ts
git commit -m "feat(plots): add WATERFALL plot type"
```

---

## Task 3: Register new plots in registry, aliases, and candidates

**Files:**
- Modify: `core/frontend/components/plots/plotRegistry.ts`
- Modify: `core/frontend/components/plots/plotNames.ts`
- Modify: `core/frontend/services/ml/candidates.ts`

- [ ] **Step 1: Write the failing test**

The existing registry test or a quick smoke test can verify. Use the existing test suite — run all plot tests first to establish baseline:

```
cd core/frontend && npx vitest run tests/plots/
```
Expected: all existing tests pass; the new imports won't be there yet until Task 1+2 are done (they should be done first).

- [ ] **Step 2: Update plotRegistry.ts**

In `core/frontend/components/plots/plotRegistry.ts`, add after the existing imports:

```typescript
import { treemapPlot } from './TreemapPlot';
import { waterfallPlot } from './WaterfallPlot';
```

And in the `plotRegistry` object, add:

```typescript
  [treemapPlot.name]: treemapPlot,
  [waterfallPlot.name]: waterfallPlot,
```

Full final file:

```typescript
import type { PlotRegistration } from './plotTypes';
import { tablePlot } from './TablePlot';
import { pieChartPlot } from './PieChartPlot';
import { lineChartPlot } from './LineChartPlot';
import { scatterPlot } from './ScatterPlot';
import { heatmapPlot } from './HeatmapPlot';
import { flameGraphPlot } from './FlameGraphPlot';
import { histogramPlot } from './HistogramPlot';
import { boxPlot } from './BoxPlot';
import { barChartPlot } from './BarChartPlot';
import { areaChartPlot } from './AreaChartPlot';
import { ganttChartPlot } from './GanttChartPlot';
import { rangePlot } from './RangePlot';
import { treemapPlot } from './TreemapPlot';
import { waterfallPlot } from './WaterfallPlot';

export const plotRegistry: Record<string, PlotRegistration<any>> = {
  [tablePlot.name]: tablePlot,
  [barChartPlot.name]: barChartPlot,
  [pieChartPlot.name]: pieChartPlot,
  [lineChartPlot.name]: lineChartPlot,
  [scatterPlot.name]: scatterPlot,
  [heatmapPlot.name]: heatmapPlot,
  [flameGraphPlot.name]: flameGraphPlot,
  FLAME_GRAPH: flameGraphPlot,
  [histogramPlot.name]: histogramPlot,
  [boxPlot.name]: boxPlot,
  [areaChartPlot.name]: areaChartPlot,
  [ganttChartPlot.name]: ganttChartPlot,
  [rangePlot.name]: rangePlot,
  [treemapPlot.name]: treemapPlot,
  [waterfallPlot.name]: waterfallPlot,
};
```

- [ ] **Step 3: Update plotNames.ts**

In `core/frontend/components/plots/plotNames.ts`, add the two new aliases to `SHORT_ALIASES`:

```typescript
const SHORT_ALIASES: Record<string, string> = {
    LINE: 'LINE_CHART',
    BAR: 'BAR_CHART',
    AREA: 'AREA_CHART',
    SCATTER: 'SCATTER_PLOT',
    PIE: 'PIE_CHART',
    BOX: 'BOX_PLOT',
    HIST: 'HISTOGRAM',
    HEAT: 'HEATMAP',
    FLAME: 'FLAMEGRAPH',
    TREE: 'TREEMAP',
    FALL: 'WATERFALL',
    // GANTT, RANGE, TABLE, HEATMAP, HISTOGRAM, FLAMEGRAPH already canonical short
};
```

- [ ] **Step 4: Update candidates.ts PLOT_NAMES**

In `core/frontend/services/ml/candidates.ts`, update the `PLOT_NAMES` array at line ~67:

```typescript
const PLOT_NAMES = [
    'LINE_CHART', 'BAR_CHART', 'AREA_CHART', 'SCATTER_PLOT', 'PIE_CHART',
    'HISTOGRAM', 'HEATMAP', 'BOX_PLOT', 'TABLE', 'FLAMEGRAPH', 'GANTT', 'RANGE',
    'TREEMAP', 'WATERFALL',
    // Composition primitives.
    'ROW', 'COL',
    // Legacy names still emitted by older artifacts — keep parseable.
    'FLAME_GRAPH', 'GANTT_CHART', 'RANGE_PLOT',
];
```

Also update `PLOT_SHORT_ALIASES` to include the new short forms:

```typescript
const PLOT_SHORT_ALIASES = [
    'line', 'bar', 'area', 'scatter', 'pie', 'box', 'hist',
    'heatmap', 'flame', 'gantt', 'range', 'table', 'tree', 'fall',
];
```

- [ ] **Step 5: Run all tests**

```
cd core/frontend && npx vitest run
```
Expected: All tests pass (the normalizePlotName tests should cover TREE→TREEMAP and FALL→WATERFALL).

- [ ] **Step 6: Commit**

```bash
git add core/frontend/components/plots/plotRegistry.ts core/frontend/components/plots/plotNames.ts core/frontend/services/ml/candidates.ts
git commit -m "feat(plots): register TREEMAP and WATERFALL in registry, aliases, and candidates"
```

---

## Task 4: LLM context improvements (aiPlotContext + suggestPlot heuristics)

**Files:**
- Modify: `core/frontend/components/editor/plot/aiPlotContext.ts`
- Modify: `core/frontend/services/ai/tools/runtime.ts`
- Test: `core/frontend/tests/editor/aiPlotContext.test.ts` (modify)
- Test: `core/frontend/tests/services/tools.suggestPlot.test.ts` (modify)

- [ ] **Step 1: Write failing tests first**

In `core/frontend/tests/editor/aiPlotContext.test.ts`, add/update the multi-example test. First check the file exists:

```
cd core/frontend && ls tests/editor/
```

If `aiPlotContext.test.ts` exists, read it and add:

```typescript
it('summarizeShapeRegistry includes multiple examples per shape when available', () => {
    const fakeReg = {
        FOO_PLOT: {
            name: 'FOO_PLOT',
            description: 'A foo plot',
            params: [
                { name: 'x', type: 'column', required: true, description: 'X axis' },
                { name: 'y', type: 'column', required: true, description: 'Y axis' },
            ],
            examples: [
                { description: 'Basic', code: 'FOO_PLOT(x: "a", y: "b")' },
                { description: 'Multi-y', code: 'FOO_PLOT(x: "a", y: ["b","c"])' },
            ],
            template: 'FOO_PLOT(x: "$x", y: "$y")',
            parseConfig: () => ({}),
            component: () => null,
        },
    } as any;
    const summary = summarizeShapeRegistry(fakeReg);
    expect(summary).toContain('FOO_PLOT(x: "a", y: "b")');
    expect(summary).toContain('FOO_PLOT(x: "a", y: ["b","c"])');
});
```

If the file doesn't exist, create it:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { summarizeShapeRegistry } from '../../components/editor/plot/aiPlotContext';

describe('summarizeShapeRegistry', () => {
    it('returns empty string for empty registry', () => {
        expect(summarizeShapeRegistry({})).toBe('');
    });

    it('lists shape name and required params', () => {
        const summary = summarizeShapeRegistry({
            LINE_CHART: {
                name: 'LINE_CHART',
                description: 'line',
                params: [{ name: 'x', type: 'column', required: true, description: 'X' }],
                examples: [{ description: 'Basic', code: 'LINE_CHART(x: "ts", y: "val")' }],
                template: '',
                parseConfig: () => ({}),
                component: () => null,
            } as any,
        });
        expect(summary).toContain('LINE_CHART');
        expect(summary).toContain('x: column');
    });

    it('includes multiple examples per shape when available', () => {
        const fakeReg = {
            FOO_PLOT: {
                name: 'FOO_PLOT',
                description: 'A foo plot',
                params: [
                    { name: 'x', type: 'column', required: true, description: 'X axis' },
                    { name: 'y', type: 'column', required: true, description: 'Y axis' },
                ],
                examples: [
                    { description: 'Basic', code: 'FOO_PLOT(x: "a", y: "b")' },
                    { description: 'Multi-y', code: 'FOO_PLOT(x: "a", y: ["b","c"])' },
                ],
                template: 'FOO_PLOT(x: "$x", y: "$y")',
                parseConfig: () => ({}),
                component: () => null,
            } as any,
        };
        const summary = summarizeShapeRegistry(fakeReg);
        expect(summary).toContain('FOO_PLOT(x: "a", y: "b")');
        expect(summary).toContain('FOO_PLOT(x: "a", y: ["b","c"])');
    });
});
```

Run to verify tests fail on multi-example assertion:

```
cd core/frontend && npx vitest run tests/editor/aiPlotContext.test.ts
```

- [ ] **Step 2: Update summarizeShapeRegistry in aiPlotContext.ts**

In `core/frontend/components/editor/plot/aiPlotContext.ts`, replace the `summarizeShapeRegistry` function (lines 121-135):

```typescript
export function summarizeShapeRegistry(
    reg: Record<string, PlotRegistration<any>> | undefined,
): string {
    if (!reg) return '';
    const entries = Object.values(reg).slice(0, 20);
    if (entries.length === 0) return '';
    const lines: string[] = [];
    for (const p of entries) {
        const required = p.params.filter(x => x.required).map(x => `${x.name}: ${x.type}`).join(', ');
        const optional = p.params.filter(x => !x.required && !x.deprecated).map(x => x.name).slice(0, 6).join(', ');
        const examples = (p.examples ?? []).slice(0, 3).map(e => e.code.replace(/\s+/g, ' ').slice(0, 100));
        const exStr = examples.length > 0 ? `  e.g. ${examples.join(' | ')}` : '';
        lines.push(`- ${p.name}(${required}${optional ? ' | ' + optional : ''})${exStr}`);
    }
    return lines.join('\n');
}
```

Also update the `SYSTEM_PROMPT` constant's `Shapes:` line (around line 93-95) to include TREEMAP and WATERFALL:

Old:
```
Shapes: LINE_CHART, BAR_CHART, AREA_CHART, SCATTER_PLOT, PIE_CHART, BOX_PLOT,
HISTOGRAM, HEATMAP, FLAMEGRAPH, GANTT, RANGE, TABLE.
Short aliases: line/bar/area/scatter/pie/box/hist/heatmap/flame/gantt/range/table.
```

New:
```
Shapes: LINE_CHART, BAR_CHART, AREA_CHART, SCATTER_PLOT, PIE_CHART, BOX_PLOT,
HISTOGRAM, HEATMAP, FLAMEGRAPH, GANTT, RANGE, TABLE, TREEMAP, WATERFALL.
Short aliases: line/bar/area/scatter/pie/box/hist/heatmap/flame/gantt/range/table/tree/fall.
```

- [ ] **Step 3: Add suggestPlot heuristics + cardinality query**

In `core/frontend/tests/services/tools.suggestPlot.test.ts`, add tests for new heuristics:

```typescript
it('heuristic suggests TREEMAP for label+value columns', async () => {
    const duckdbQuery = vi.fn().mockResolvedValue({
        columns: [
            { name: 'objectClass', type: 'VARCHAR' },
            { name: 'weight', type: 'BIGINT' },
        ],
        rows: [],
    });
    // cardinality query will also be called
    const duckdbQueryWithCard = vi.fn()
        .mockResolvedValueOnce({ columns: [{ name: 'objectClass', type: 'VARCHAR' }, { name: 'weight', type: 'BIGINT' }], rows: [] })
        .mockResolvedValueOnce({ columns: [{ name: 'cnt', type: 'BIGINT' }], rows: [{ cnt: 85 }] });
    const result = await executeTool('suggestPlot', { cellId: 'cell-1' }, makeDeps({ duckdbQuery: duckdbQueryWithCard }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.instruction).toContain('TREEMAP');
});

it('heuristic suggests WATERFALL when column named delta/change/diff', async () => {
    const duckdbQuery = vi.fn()
        .mockResolvedValueOnce({
            columns: [
                { name: 'phase', type: 'VARCHAR' },
                { name: 'heapDelta', type: 'DOUBLE' },
            ],
            rows: [],
        })
        .mockResolvedValueOnce({ columns: [{ name: 'cnt', type: 'BIGINT' }], rows: [{ cnt: 8 }] });
    const result = await executeTool('suggestPlot', { cellId: 'cell-1' }, makeDeps({ duckdbQuery }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.instruction).toContain('WATERFALL');
});
```

Run to verify they fail:

```
cd core/frontend && npx vitest run tests/services/tools.suggestPlot.test.ts
```

- [ ] **Step 4: Update suggestPlot in runtime.ts**

In `core/frontend/services/ai/tools/runtime.ts`, replace the `suggestPlot` case (lines 339-368). The new version:
1. Fetches schema as before (LIMIT 0)
2. Runs a lightweight cardinality query: `SELECT COUNT(DISTINCT ${firstCatCol}) AS cnt FROM (${sql}) _q LIMIT 1` for the first VARCHAR column
3. Uses the cardinality + column name patterns to emit richer heuristic hints

Find the existing case and replace it:

```typescript
case 'suggestPlot': {
    const cell = deps.listCells().find(c => c.id === args.cellId);
    if (!cell) {
        return { ok: false, error: `Cell "${args.cellId}" not found. Call listCells() to see available cell IDs.` };
    }
    if (cell.type !== 'sql') {
        return { ok: false, error: `Cell "${args.cellId}" is a ${cell.type} cell, not a SQL cell. suggestPlot requires a SQL cell to read its result schema.` };
    }
    if (isForbiddenSql(cell.content)) return { ok: false, error: 'SQL references $ai_providers which contains sensitive credentials and cannot be queried.' };

    let schemaColumns: { name: string; type: string }[] = [];
    try {
        const result = await deps.duckdbQuery(cell.content, { limit: 0 });
        schemaColumns = result.columns as { name: string; type: string }[];
    } catch {
        schemaColumns = [];
    }

    const columns = schemaColumns.map((c: { name: string; type: string }) => `${c.name} (${c.type})`);

    // Lightweight cardinality hint: count distinct values for the first VARCHAR column.
    let cardinalityHint = '';
    const firstCatCol = schemaColumns.find(c => c.type === 'VARCHAR' || c.type === 'TEXT');
    if (firstCatCol && !isForbiddenSql(cell.content)) {
        try {
            const cardResult = await deps.duckdbQuery(
                `SELECT COUNT(DISTINCT "${firstCatCol.name}") AS cnt FROM (${cell.content}) _q LIMIT 1`,
                {},
            );
            const cnt = Number(cardResult.rows?.[0]?.cnt ?? cardResult.rows?.[0]?.[0] ?? 0);
            if (cnt > 0) cardinalityHint = ` ("${firstCatCol.name}" has ~${cnt} distinct values)`;
        } catch {
            // cardinality unavailable — proceed without hint
        }
    }

    // Build heuristic recommendation based on column patterns.
    const colNames = schemaColumns.map(c => c.name.toLowerCase());
    const colTypes = schemaColumns.map(c => c.type.toUpperCase());
    const hasTimestamp = colTypes.some(t => t.includes('TIMESTAMP') || t.includes('DATE'));
    const hasVarchar = colTypes.some(t => t === 'VARCHAR' || t === 'TEXT');
    const numericCols = schemaColumns.filter(c => /INT|FLOAT|DOUBLE|NUMERIC|DECIMAL|BIGINT|HUGEINT|REAL/.test(c.type.toUpperCase()));
    const hasDeltaColumn = colNames.some(n => /delta|change|diff|increment|decrement/.test(n));
    const hasEndTime = colNames.some(n => n.includes('end') || n.includes('endtime') || n.includes('stop'));

    let hint: string;
    if (hasDeltaColumn && hasVarchar) {
        hint = 'Column names suggest sequential deltas → WATERFALL; categorical + delta value → WATERFALL(category: "...", value: "...").';
    } else if (hasVarchar && numericCols.length === 1 && !hasTimestamp) {
        hint = 'One category + one numeric column → consider BAR_CHART or TREEMAP (if many categories); ' +
            'TREEMAP works best with > 20 distinct values for the label column' + cardinalityHint + '.';
    } else if (hasTimestamp && numericCols.length >= 1) {
        hint = `Timestamp + numeric → LINE_CHART${numericCols.length > 1 ? ' with multiple y columns' : ''}.`;
    } else if (!hasTimestamp && numericCols.length >= 2 && !hasVarchar) {
        hint = 'Two+ numerics, no timestamps → SCATTER_PLOT or HEATMAP.';
    } else if (numericCols.length === 1 && !hasTimestamp && !hasVarchar) {
        hint = 'Single numeric distribution → HISTOGRAM.';
    } else if (hasEndTime && hasTimestamp) {
        hint = 'Start/end time columns → GANTT or RANGE.';
    } else if (colNames.some(n => n === 'stackframes' || n === 'stack' || n.includes('frame'))) {
        hint = 'Stack frame column → FLAMEGRAPH.';
    } else {
        hint = 'General data → TABLE as safe default; inspect columns to pick a more specific chart.';
    }

    return {
        ok: true,
        data: {
            cellId: cell.id,
            sql: cell.content,
            columns: columns.join(', ') || '(schema unavailable — inspect the cell manually)',
            instruction: 'Based on these column names and types, suggest the most appropriate plot shape and write a minimal DSL config. ' +
                `Heuristic recommendation: ${hint} ` +
                'Also consider: timestamps → LINE_CHART; categorical + numeric → BAR_CHART; ' +
                'two numerics → SCATTER_PLOT; single numeric distribution → HISTOGRAM; ' +
                'hierarchical call stacks → FLAMEGRAPH; time-range events → GANTT; ' +
                'part-of-whole hierarchy → TREEMAP; cumulative deltas → WATERFALL. ' +
                'Return a plot DSL code block the user can copy.',
        },
    };
}
```

- [ ] **Step 5: Run all changed tests**

```
cd core/frontend && npx vitest run tests/editor/aiPlotContext.test.ts tests/services/tools.suggestPlot.test.ts
```
Expected: all pass.

- [ ] **Step 6: Run full test suite**

```
cd core/frontend && npx vitest run
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add core/frontend/components/editor/plot/aiPlotContext.ts core/frontend/services/ai/tools/runtime.ts core/frontend/tests/editor/aiPlotContext.test.ts core/frontend/tests/services/tools.suggestPlot.test.ts
git commit -m "feat(llm): multi-example summarizer, TREEMAP/WATERFALL in system prompt, cardinality heuristics in suggestPlot"
```

---

## Task 5: Training data generator — add TREEMAP and WATERFALL families

**Files:**
- Modify: `core/frontend/scripts/training/generatePlotDataset.ts`

- [ ] **Step 1: Verify the generator compiles in dry-run mode (baseline)**

```
cd core/frontend && npx tsx scripts/training/generatePlotDataset.ts --dry-run 2>&1 | head -30
```
Expected: prints a prompt snippet, no crash.

- [ ] **Step 2: Update PlotFamily type**

In `generatePlotDataset.ts` around line 101, extend the union type:

Old:
```typescript
type PlotFamily =
    | 'LINE_CHART' | 'BAR_CHART' | 'PIE_CHART' | 'SCATTER_PLOT'
    | 'AREA_CHART' | 'HISTOGRAM' | 'BOX_PLOT' | 'HEATMAP'
    | 'FLAMEGRAPH' | 'GANTT' | 'RANGE' | 'TABLE'
    | 'COMPOSITION' | 'SPARKLINE' | 'ERGONOMIC';
```

New:
```typescript
type PlotFamily =
    | 'LINE_CHART' | 'BAR_CHART' | 'PIE_CHART' | 'SCATTER_PLOT'
    | 'AREA_CHART' | 'HISTOGRAM' | 'BOX_PLOT' | 'HEATMAP'
    | 'FLAMEGRAPH' | 'GANTT' | 'RANGE' | 'TABLE'
    | 'TREEMAP' | 'WATERFALL'
    | 'COMPOSITION' | 'SPARKLINE' | 'ERGONOMIC';
```

- [ ] **Step 3: Add TREEMAP SQL_POOL entries**

After the existing SQL_POOL entries (around the end of the RANGE section), add:

```typescript
    // ── TREEMAP (part-of-whole hierarchy) ────────────────────────────────────
    {
        sql: 'SELECT objectClass, SUM(weight) AS totalWeight FROM ObjectAllocationSample GROUP BY objectClass ORDER BY totalWeight DESC',
        columns: [{ name: 'objectClass', type: 'VARCHAR' }, { name: 'totalWeight', type: 'BIGINT' }],
        schema: pickSchemas('ObjectAllocationSample'),
        sample: [{ objectClass: 'byte[]', totalWeight: 5242880 }, { objectClass: 'char[]', totalWeight: 2097152 }],
        plotFamilyHint: 'TREEMAP',
    },
    {
        sql: 'SELECT thread, objectClass, SUM(weight) AS w FROM ObjectAllocationSample GROUP BY thread, objectClass',
        columns: [{ name: 'thread', type: 'VARCHAR' }, { name: 'objectClass', type: 'VARCHAR' }, { name: 'w', type: 'BIGINT' }],
        schema: pickSchemas('ObjectAllocationSample'),
        sample: [{ thread: 'main', objectClass: 'byte[]', w: 1048576 }],
        plotFamilyHint: 'TREEMAP',
        biasHint: 'Use colorBy param to color by thread.',
    },
    {
        sql: 'SELECT name AS gcType, COUNT(*) AS cnt FROM GarbageCollection GROUP BY name',
        columns: [{ name: 'gcType', type: 'VARCHAR' }, { name: 'cnt', type: 'BIGINT' }],
        schema: pickSchemas('GarbageCollection'),
        sample: [{ gcType: 'G1 Young Generation', cnt: 42 }, { gcType: 'G1 Old Generation', cnt: 3 }],
        plotFamilyHint: 'TREEMAP',
    },
    // ── WATERFALL (cumulative deltas) ─────────────────────────────────────────
    {
        sql: "SELECT phase, SUM(duration) AS totalMs FROM GarbageCollection GROUP BY phase ORDER BY MIN(startTime)",
        columns: [{ name: 'phase', type: 'VARCHAR' }, { name: 'totalMs', type: 'DOUBLE' }],
        schema: pickSchemas('GarbageCollection'),
        sample: [{ phase: 'Mark', totalMs: 12.5 }, { phase: 'Remark', totalMs: 4.2 }, { phase: 'Cleanup', totalMs: -3.1 }],
        plotFamilyHint: 'WATERFALL',
    },
    {
        sql: "SELECT gcId, heapBeforeGC - heapAfterGC AS freed FROM GarbageCollection ORDER BY gcId",
        columns: [{ name: 'gcId', type: 'BIGINT' }, { name: 'freed', type: 'DOUBLE' }],
        schema: pickSchemas('GarbageCollection'),
        sample: [{ gcId: 1, freed: 256000 }, { gcId: 2, freed: -4096 }],
        plotFamilyHint: 'WATERFALL',
        biasHint: 'Column "freed" is a delta; use WATERFALL with category="gcId", value="freed".',
    },
    {
        sql: "SELECT cause AS step, longestPause AS pauseMs FROM GarbageCollection ORDER BY startTime",
        columns: [{ name: 'step', type: 'VARCHAR' }, { name: 'pauseMs', type: 'DOUBLE' }],
        schema: pickSchemas('GarbageCollection'),
        sample: [{ step: 'G1 Evacuation Pause', pauseMs: 8.3 }, { step: 'GCLocker Initiated GC', pauseMs: 2.1 }],
        plotFamilyHint: 'WATERFALL',
    },
```

- [ ] **Step 4: Update per-family targets in the generator**

Find the distribution/target config in the generator (search for `perFamilyTarget` or a similar object). If distribution is uniform, no change needed. If there's an explicit per-family count, add TREEMAP and WATERFALL entries matching the average of the existing families (typically ~600 each for a 7500-example dataset with 15 families).

If the distribution is implicit (uniform over SQL_POOL), no code change is needed — the new entries will be sampled proportionally.

- [ ] **Step 5: Update the SYSTEM_PROMPT inside generatePlotDataset.ts**

Search for the teacher prompt that lists supported plot types and add TREEMAP and WATERFALL to it. It will look something like:

```
const TEACHER_PROMPT = `You are a plot configuration expert for a JFR analysis notebook. 
Supported plot types: LINE_CHART, BAR_CHART, ...
```

Add `, TREEMAP, WATERFALL` to that list.

- [ ] **Step 6: Dry-run to verify no TypeScript errors and correct output**

```
cd core/frontend && npx tsx scripts/training/generatePlotDataset.ts --dry-run 2>&1 | head -60
```
Expected: prints sample SQLs including TREEMAP and WATERFALL families; no crash; no TypeScript errors.

- [ ] **Step 7: Run full test suite**

```
cd core/frontend && npx vitest run
```
Expected: all tests pass (the generator is not unit-tested directly, but TypeScript compilation is exercised by vitest's transform).

- [ ] **Step 8: Commit**

```bash
git add core/frontend/scripts/training/generatePlotDataset.ts
git commit -m "feat(training): add TREEMAP and WATERFALL families to plot dataset generator"
```

---

## Task 6: Verify end-to-end and run full test suite

- [ ] **Step 1: TypeScript check**

```
cd core/frontend && npx tsc --noEmit 2>&1 | head -40
```
Expected: no errors.

- [ ] **Step 2: Full test suite**

```
cd core/frontend && npx vitest run 2>&1 | tail -20
```
Expected: all tests pass.

- [ ] **Step 3: Spot-check the registry reflects all 15 entries**

```
cd core/frontend && node -e "
const { plotRegistry } = require('./components/plots/plotRegistry');
console.log(Object.keys(plotRegistry));
" 2>/dev/null || npx tsx -e "
import { plotRegistry } from './components/plots/plotRegistry.ts';
console.log(Object.keys(plotRegistry));
"
```
Expected output includes: `TREEMAP`, `WATERFALL`.

- [ ] **Step 4: Spot-check normalizePlotName**

```
cd core/frontend && npx tsx -e "
import { normalizePlotName } from './components/plots/plotNames.ts';
console.log(normalizePlotName('tree'));    // TREEMAP
console.log(normalizePlotName('TREE'));   // TREEMAP
console.log(normalizePlotName('fall'));   // WATERFALL
console.log(normalizePlotName('FALL'));   // WATERFALL
"
```
Expected: all four print the canonical names.

- [ ] **Step 5: Commit (if any stragglers)**

If nothing uncommitted, skip. Otherwise:
```bash
git add -p
git commit -m "chore: final integration checks for treemap/waterfall/llm improvements"
```
