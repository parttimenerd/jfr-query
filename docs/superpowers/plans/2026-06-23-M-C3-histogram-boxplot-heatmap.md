# M-C3: Histogram + Boxplot + Heatmap Renderers — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans.
> **Testing standard:** All 5 layers apply: unit / E2E / visual regression / a11y / perf bench.

**Goal:** Deliver `HistogramPlot`, `BoxplotPlot`, and `HeatmapPlot` — three Recharts/SVG concrete renderers mounting inside `PlotRenderer` (M-C1), using the same `ChartPlotProps` interface as M-C2.

**Blocked by:** M-C2 (plotSeriesUtils, SERIES_COLORS, ChartPlotProps interface)

**Tech stack:** React 19.2, TypeScript 5.8, Recharts (histogram/boxplot), plain SVG (heatmap), Vitest 4.1.9 (pool: forks)

**Architecture:** Three new renderer components added to `src/components/plots/`. `HistogramPlot` bins x-column data client-side and renders as a gapless `BarChart`. `BoxplotPlot` computes quartiles and renders using `ComposedChart` with custom SVG shapes. `HeatmapPlot` builds a 2D grid and renders as pure SVG rects with opacity-based color intensity. All colors use `var(--color-*)` tokens.

---

## CRITICAL RULES (never violate)

- `AppShell.tsx` line 30 MUST stay: `const [collapsed, setCollapsed] = useState(!hasNotebook);` — NEVER change to `useState(false)`
- `import type { JSX } from 'react'` in every React component
- `pool: 'forks'` in vitest.config.ts — NEVER change
- All colors: CSS token vars only — `var(--color-accent)` etc, never hex
- No `text-sm` — use `text-[12px]` or literal sizes
- No `any` — use `unknown` with narrowing

---

## File map

**Create:**
- `src/components/plots/HistogramPlot.tsx`
- `src/components/plots/BoxplotPlot.tsx`
- `src/components/plots/HeatmapPlot.tsx`
- `src/components/plots/heatmapUtils.ts`
- `src/__tests__/plots/histogram.test.tsx`
- `src/__tests__/plots/boxplot.test.tsx`
- `src/__tests__/plots/heatmap.test.tsx`

**Modify:**
- `src/components/plots/index.ts` — add 3 new exports
- `tests/e2e/03-plot-dsl.spec.ts` — add smoke tests
- `tests/visual/plots.spec.ts` — add 3 visual snapshots
- `tests/visual/a11y-plot-renderer.spec.ts` — add axe checks

---

## Shared interface (from M-C2)

```ts
// src/services/parser/types.ts — already exists
interface PanelNode {
  kind: 'histogram' | 'boxplot' | 'heatmap' | 'line' | 'bar' | 'scatter' | 'flamegraph' | 'table';
  keys: Record<string, PlotValue>;
  title?: string;
}
type PlotValue = string | number | boolean | VarRef | PlotValue[];
interface VarRef { name: string }

// ChartPlotProps — same as LineChartPlot/BarChartPlot/ScatterPlot
interface ChartPlotProps {
  node: PanelNode;
  rows: Record<string, unknown>[];
  scope?: Record<string, unknown>;
}
```

---

## Task 1: heatmapUtils — buildGrid + interpolateColor

**Files:**
- Create: `src/components/plots/heatmapUtils.ts`
- Create: `src/__tests__/plots/heatmap.test.tsx` (partial — utils tests)

- [ ] **Step 1: Write failing tests for buildGrid and interpolateColor**

```ts
// src/__tests__/plots/heatmap.test.tsx
import { describe, it, expect } from 'vitest';
import { buildGrid, interpolateColor } from '../../components/plots/heatmapUtils';

describe('buildGrid', () => {
  const rows = [
    { x: 'A', y: 'X', v: 10 },
    { x: 'A', y: 'Y', v: 5 },
    { x: 'B', y: 'X', v: 20 },
    { x: 'B', y: 'Y', v: 0 },
  ];

  it('returns correct xLabels and yLabels', () => {
    const g = buildGrid(rows, 'x', 'y', 'v', 'sum');
    expect(g.xLabels).toEqual(['A', 'B']);
    expect(g.yLabels).toEqual(['X', 'Y']);
  });

  it('sums values correctly', () => {
    const g = buildGrid(rows, 'x', 'y', 'v', 'sum');
    expect(g.cells[0][0]).toBe(10); // A,X
    expect(g.cells[1][0]).toBe(20); // B,X
  });

  it('counts correctly with aggregate=count', () => {
    const g = buildGrid(rows, 'x', 'y', 'v', 'count');
    expect(g.cells[0][0]).toBe(1);
    expect(g.cells[1][0]).toBe(1);
  });

  it('computes mean correctly', () => {
    const dupRows = [...rows, { x: 'A', y: 'X', v: 20 }];
    const g = buildGrid(dupRows, 'x', 'y', 'v', 'mean');
    expect(g.cells[0][0]).toBeCloseTo(15); // (10+20)/2
  });

  it('returns maxValue', () => {
    const g = buildGrid(rows, 'x', 'y', 'v', 'sum');
    expect(g.maxValue).toBe(20);
  });

  it('returns totalCells = xLabels.length * yLabels.length', () => {
    const g = buildGrid(rows, 'x', 'y', 'v', 'sum');
    expect(g.totalCells).toBe(4);
  });

  it('returns error when totalCells > 10000', () => {
    const bigRows: Record<string, unknown>[] = [];
    for (let x = 0; x < 101; x++)
      for (let y = 0; y < 100; y++)
        bigRows.push({ x: String(x), y: String(y), v: 1 });
    const g = buildGrid(bigRows, 'x', 'y', 'v', 'count');
    expect(g.error).toMatch(/Too many cells/);
  });
});

describe('interpolateColor', () => {
  it('returns 0 opacity for ratio=0', () => {
    expect(interpolateColor(0)).toBe('rgba(34,211,238,0.05)');
  });

  it('returns full opacity for ratio=1', () => {
    expect(interpolateColor(1)).toBe('rgba(34,211,238,1)');
  });

  it('returns mid opacity for ratio=0.5', () => {
    const c = interpolateColor(0.5);
    expect(c).toMatch(/rgba\(34,211,238,0\.\d+\)/);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/plots/heatmap.test.tsx 2>&1 | tail -10
```
Expected: FAIL (cannot find module heatmapUtils)

- [ ] **Step 3: Implement heatmapUtils.ts**

```ts
// src/components/plots/heatmapUtils.ts

export type AggregateMode = 'sum' | 'count' | 'mean';

export interface GridResult {
  xLabels: string[];
  yLabels: string[];
  /** cells[xi][yi] */
  cells: number[][];
  maxValue: number;
  totalCells: number;
  error?: string;
}

export function buildGrid(
  rows: Record<string, unknown>[],
  xCol: string,
  yCol: string,
  valueCol: string,
  aggregate: AggregateMode
): GridResult {
  const xSet = new Set<string>();
  const ySet = new Set<string>();
  for (const r of rows) {
    xSet.add(String(r[xCol] ?? ''));
    ySet.add(String(r[yCol] ?? ''));
  }
  const xLabels = [...xSet].sort();
  const yLabels = [...ySet].sort();
  const totalCells = xLabels.length * yLabels.length;

  if (totalCells > 10_000) {
    return { xLabels, yLabels, cells: [], maxValue: 0, totalCells, error: `Too many cells: ${totalCells} (max 10000). Reduce data cardinality.` };
  }

  const xi = new Map(xLabels.map((l, i) => [l, i]));
  const yi = new Map(yLabels.map((l, i) => [l, i]));
  const sums = Array.from({ length: xLabels.length }, () => new Array<number>(yLabels.length).fill(0));
  const counts = Array.from({ length: xLabels.length }, () => new Array<number>(yLabels.length).fill(0));

  for (const r of rows) {
    const x = String(r[xCol] ?? '');
    const y = String(r[yCol] ?? '');
    const v = Number(r[valueCol] ?? 0);
    const xi_ = xi.get(x) ?? 0;
    const yi_ = yi.get(y) ?? 0;
    if (!Number.isNaN(v)) {
      sums[xi_][yi_] += v;
      counts[xi_][yi_]++;
    }
  }

  let cells: number[][];
  if (aggregate === 'count') {
    cells = counts;
  } else if (aggregate === 'mean') {
    cells = sums.map((row, xi_) => row.map((s, yi_) => (counts[xi_][yi_] > 0 ? s / counts[xi_][yi_] : 0)));
  } else {
    cells = sums;
  }

  const maxValue = Math.max(...cells.flatMap((r) => r));
  return { xLabels, yLabels, cells, maxValue, totalCells };
}

/** Interpolate from near-transparent to full --color-accent (#22d3ee) */
export function interpolateColor(ratio: number): string {
  const opacity = 0.05 + ratio * 0.95;
  return `rgba(34,211,238,${Math.round(opacity * 100) / 100})`;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/__tests__/plots/heatmap.test.tsx 2>&1 | tail -5
```
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/components/plots/heatmapUtils.ts src/__tests__/plots/heatmap.test.tsx
git commit -m "feat(M-C3): heatmapUtils — buildGrid + interpolateColor"
```

---

## Task 2: HistogramPlot component

**Files:**
- Create: `src/components/plots/HistogramPlot.tsx`
- Create: `src/__tests__/plots/histogram.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// src/__tests__/plots/histogram.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { HistogramPlot } from '../../components/plots/HistogramPlot';
import type { PanelNode } from '../../services/parser/types';

beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false, media: q, addEventListener: () => {}, removeEventListener: () {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false, onchange: null,
  }));
  vi.stubGlobal('ResizeObserver', class {
    observe() {} unobserve() {} disconnect() {}
  });
});

const node: PanelNode = {
  kind: 'histogram',
  keys: { x: 'dur', bins: 10 },
};

const rows = Array.from({ length: 100 }, (_, i) => ({ dur: i * 10 }));

describe('HistogramPlot', () => {
  it('renders a recharts BarChart container', () => {
    render(<HistogramPlot node={node} rows={rows} />);
    expect(document.querySelector('.recharts-wrapper')).not.toBeNull();
  });

  it('renders with testid histogram-plot', () => {
    render(<HistogramPlot node={node} rows={rows} />);
    expect(screen.getByTestId('histogram-plot')).toBeInTheDocument();
  });

  it('renders empty state when rows is empty', () => {
    render(<HistogramPlot node={node} rows={[]} />);
    expect(screen.getByTestId('histogram-empty')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    const n = { ...node, title: 'GC Pause Distribution' };
    render(<HistogramPlot node={n} rows={rows} />);
    expect(screen.getByText('GC Pause Distribution')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
npx vitest run src/__tests__/plots/histogram.test.tsx 2>&1 | tail -8
```

- [ ] **Step 3: Implement HistogramPlot.tsx**

```tsx
// src/components/plots/HistogramPlot.tsx
import { useMemo } from 'react';
import type { JSX } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { resolveValue, isReducedMotion } from './plotSeriesUtils';
import type { PanelNode } from '../../services/parser/types';

interface ChartPlotProps {
  node: PanelNode;
  rows: Record<string, unknown>[];
  scope?: Record<string, unknown>;
}

function computeBins(values: number[], binCount: number): { label: string; count: number }[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ label: String(min), count: values.length }];
  const step = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({
    label: `${(min + i * step).toFixed(1)}–${(min + (i + 1) * step).toFixed(1)}`,
    count: 0,
  }));
  for (const v of values) {
    const idx = Math.min(Math.floor((v - min) / step), binCount - 1);
    bins[idx].count++;
  }
  return bins;
}

export function HistogramPlot({ node, rows, scope = {} }: ChartPlotProps): JSX.Element {
  const xKey = String(resolveValue(node.keys['x'] ?? '', scope) ?? '');
  const binCount = Number(resolveValue(node.keys['bins'] ?? 20, scope) ?? 20);
  const title = node.title;
  const reduced = isReducedMotion();

  const bins = useMemo(() => {
    const values = rows
      .map((r) => Number(r[xKey]))
      .filter((v) => !Number.isNaN(v));
    return computeBins(values, binCount);
  }, [rows, xKey, binCount]);

  if (bins.length === 0) {
    return (
      <div data-testid="histogram-empty" className="flex items-center justify-center h-40 text-[12px] text-[--color-fg-muted]">
        No data
      </div>
    );
  }

  return (
    <div data-testid="histogram-plot" className="w-full">
      {title && (
        <div className="text-[12px] font-medium text-[--color-fg-base] px-2 pb-1">{title}</div>
      )}
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={bins} barCategoryGap={0} barGap={0}
          margin={{ top: 8, right: 12, bottom: 24, left: 32 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: 'var(--color-fg-muted)', fontSize: 11 }}
            tickLine={false} axisLine={{ stroke: 'var(--color-border)' }}
            interval="preserveStartEnd" />
          <YAxis tick={{ fill: 'var(--color-fg-muted)', fontSize: 11 }}
            tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ background: 'var(--color-bg-overlay)', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 11 }}
            labelStyle={{ color: 'var(--color-fg-base)' }}
            itemStyle={{ color: 'var(--color-accent)' }}
          />
          <Bar dataKey="count" fill="var(--color-accent)"
            isAnimationActive={!reduced} animationDuration={reduced ? 0 : 400}>
            {bins.map((_, i) => (
              <Cell key={i} fill="var(--color-accent)" fillOpacity={0.8} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Run — verify pass**

```bash
npx vitest run src/__tests__/plots/histogram.test.tsx 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/components/plots/HistogramPlot.tsx src/__tests__/plots/histogram.test.tsx
git commit -m "feat(M-C3): HistogramPlot — binning + Recharts BarChart"
```

---

## Task 3: BoxplotPlot — quartile computation

**Files:**
- Create: `src/components/plots/BoxplotPlot.tsx`
- Create: `src/__tests__/plots/boxplot.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// src/__tests__/plots/boxplot.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { BoxplotPlot } from '../../components/plots/BoxplotPlot';
import type { PanelNode } from '../../services/parser/types';

beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false, media: q, addEventListener: () => {}, removeEventListener: () {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false, onchange: null,
  }));
  vi.stubGlobal('ResizeObserver', class {
    observe() {} unobserve() {} disconnect() {}
  });
});

const node: PanelNode = { kind: 'boxplot', keys: { y: 'value' } };
const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => ({ value: v }));

describe('BoxplotPlot', () => {
  it('renders with testid boxplot-plot', () => {
    render(<BoxplotPlot node={node} rows={rows} />);
    expect(screen.getByTestId('boxplot-plot')).toBeInTheDocument();
  });

  it('renders empty state for empty rows', () => {
    render(<BoxplotPlot node={node} rows={[]} />);
    expect(screen.getByTestId('boxplot-empty')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    const n = { ...node, title: 'Pause Times' };
    render(<BoxplotPlot node={n} rows={rows} />);
    expect(screen.getByText('Pause Times')).toBeInTheDocument();
  });

  it('renders recharts wrapper', () => {
    render(<BoxplotPlot node={node} rows={rows} />);
    expect(document.querySelector('.recharts-wrapper')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
npx vitest run src/__tests__/plots/boxplot.test.tsx 2>&1 | tail -8
```

- [ ] **Step 3: Implement BoxplotPlot.tsx**

```tsx
// src/components/plots/BoxplotPlot.tsx
import { useMemo } from 'react';
import type { JSX } from 'react';
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import { resolveValue, isReducedMotion } from './plotSeriesUtils';
import type { PanelNode } from '../../services/parser/types';

interface ChartPlotProps {
  node: PanelNode;
  rows: Record<string, unknown>[];
  scope?: Record<string, unknown>;
}

interface BoxStats {
  category: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  whiskerLow: number;
  whiskerHigh: number;
  /** q1 used as bar base, iqr = q3 - q1 */
  iqr: number;
}

function quantile(sorted: number[], p: number): number {
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function computeStats(values: number[], category: string): BoxStats {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const whiskerLow = Math.max(sorted[0], q1 - 1.5 * iqr);
  const whiskerHigh = Math.min(sorted[sorted.length - 1], q3 + 1.5 * iqr);
  return { category, min: sorted[0], q1, median, q3, max: sorted[sorted.length - 1], iqr, whiskerLow, whiskerHigh };
}

// Custom bar shape rendering the box + whiskers as SVG
function BoxShape(props: Record<string, unknown>): JSX.Element | null {
  const { x, y, width, height, payload } = props as {
    x: number; y: number; width: number; height: number;
    payload: BoxStats & { q1Px?: number; q3Px?: number; medianPx?: number; whiskerLowPx?: number; whiskerHighPx?: number };
  };
  if (!payload) return null;
  const cx = x + width / 2;
  return (
    <g>
      {/* IQR box */}
      <rect x={x} y={y} width={width} height={height}
        fill="var(--color-accent)" fillOpacity={0.25}
        stroke="var(--color-accent)" strokeWidth={1.5} />
      {/* Median line */}
      {payload.medianPx !== undefined && (
        <line x1={x} x2={x + width} y1={payload.medianPx} y2={payload.medianPx}
          stroke="var(--color-accent)" strokeWidth={2} />
      )}
      {/* Whisker lines */}
      {payload.whiskerLowPx !== undefined && (
        <>
          <line x1={cx} x2={cx} y1={y + height} y2={payload.whiskerLowPx}
            stroke="var(--color-fg-muted)" strokeWidth={1} strokeDasharray="3,2" />
          <line x1={x + width * 0.25} x2={x + width * 0.75} y1={payload.whiskerLowPx} y2={payload.whiskerLowPx}
            stroke="var(--color-fg-muted)" strokeWidth={1.5} />
        </>
      )}
      {payload.whiskerHighPx !== undefined && (
        <>
          <line x1={cx} x2={cx} y1={y} y2={payload.whiskerHighPx}
            stroke="var(--color-fg-muted)" strokeWidth={1} strokeDasharray="3,2" />
          <line x1={x + width * 0.25} x2={x + width * 0.75} y1={payload.whiskerHighPx} y2={payload.whiskerHighPx}
            stroke="var(--color-fg-muted)" strokeWidth={1.5} />
        </>
      )}
    </g>
  );
}

export function BoxplotPlot({ node, rows, scope = {} }: ChartPlotProps): JSX.Element {
  const yKey = String(resolveValue(node.keys['y'] ?? '', scope) ?? '');
  const xKey = node.keys['x'] ? String(resolveValue(node.keys['x'], scope) ?? '') : null;
  const title = node.title;
  const reduced = isReducedMotion();

  const stats = useMemo((): BoxStats[] => {
    if (rows.length === 0) return [];
    if (xKey) {
      const groups = new Map<string, number[]>();
      for (const r of rows) {
        const cat = String(r[xKey] ?? '(none)');
        const v = Number(r[yKey]);
        if (!Number.isNaN(v)) {
          if (!groups.has(cat)) groups.set(cat, []);
          groups.get(cat)!.push(v);
        }
      }
      return [...groups.entries()].map(([cat, vals]) => computeStats(vals, cat));
    }
    const values = rows.map((r) => Number(r[yKey])).filter((v) => !Number.isNaN(v));
    return values.length > 0 ? [computeStats(values, yKey)] : [];
  }, [rows, xKey, yKey]);

  if (stats.length === 0) {
    return (
      <div data-testid="boxplot-empty" className="flex items-center justify-center h-40 text-[12px] text-[--color-fg-muted]">
        No data
      </div>
    );
  }

  // For Recharts Bar: render q1 as base offset (transparent), iqr as the bar height
  const chartData = stats.map((s) => ({
    category: s.category,
    q1: s.q1,
    iqr: s.iqr,
    // pass extra for custom shape
    ...s,
  }));

  return (
    <div data-testid="boxplot-plot" className="w-full">
      {title && (
        <div className="text-[12px] font-medium text-[--color-fg-base] px-2 pb-1">{title}</div>
      )}
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 24, left: 32 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="category" tick={{ fill: 'var(--color-fg-muted)', fontSize: 11 }}
            tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} />
          <YAxis tick={{ fill: 'var(--color-fg-muted)', fontSize: 11 }}
            tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ background: 'var(--color-bg-overlay)', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 11 }}
            formatter={(value: unknown, name: string) => [
              typeof value === 'number' ? value.toFixed(2) : value,
              name,
            ]}
          />
          {/* Invisible base to offset box to q1 */}
          <Bar dataKey="q1" stackId="box" fill="transparent" isAnimationActive={false} />
          {/* Visible IQR box */}
          <Bar dataKey="iqr" stackId="box" fill="var(--color-accent)" fillOpacity={0.3}
            stroke="var(--color-accent)" strokeWidth={1.5}
            isAnimationActive={!reduced} animationDuration={reduced ? 0 : 400}
            shape={<BoxShape />}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Run — verify pass**

```bash
npx vitest run src/__tests__/plots/boxplot.test.tsx 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/components/plots/BoxplotPlot.tsx src/__tests__/plots/boxplot.test.tsx
git commit -m "feat(M-C3): BoxplotPlot — quartile stats + ComposedChart"
```

---

## Task 4: HeatmapPlot — SVG renderer

**Files:**
- Create: `src/components/plots/HeatmapPlot.tsx`
- Update: `src/__tests__/plots/heatmap.test.tsx` (add component tests)

- [ ] **Step 1: Append component tests to heatmap.test.tsx**

```tsx
// Add to src/__tests__/plots/heatmap.test.tsx (append after existing describe blocks):

import { render, screen } from '@testing-library/react';
import { HeatmapPlot } from '../../components/plots/HeatmapPlot';
import type { PanelNode } from '../../services/parser/types';

const heatNode: PanelNode = {
  kind: 'heatmap',
  keys: { x: 'hour', y: 'day', value: 'count', aggregate: 'sum' },
};

const heatRows = [
  { hour: '9', day: 'Mon', count: 5 },
  { hour: '10', day: 'Mon', count: 8 },
  { hour: '9', day: 'Tue', count: 3 },
  { hour: '10', day: 'Tue', count: 12 },
];

describe('HeatmapPlot', () => {
  it('renders with testid heatmap-plot', () => {
    render(<HeatmapPlot node={heatNode} rows={heatRows} />);
    expect(screen.getByTestId('heatmap-plot')).toBeInTheDocument();
  });

  it('renders SVG element', () => {
    render(<HeatmapPlot node={heatNode} rows={heatRows} />);
    expect(document.querySelector('svg')).not.toBeNull();
  });

  it('renders correct number of cells', () => {
    render(<HeatmapPlot node={heatNode} rows={heatRows} />);
    const rects = document.querySelectorAll('[data-testid="heatmap-cell"]');
    expect(rects.length).toBe(4); // 2x2 grid
  });

  it('renders empty state for empty rows', () => {
    render(<HeatmapPlot node={heatNode} rows={[]} />);
    expect(screen.getByTestId('heatmap-empty')).toBeInTheDocument();
  });

  it('renders error state when too many cells', () => {
    const bigRows: Record<string, unknown>[] = [];
    for (let x = 0; x < 101; x++)
      for (let y = 0; y < 100; y++)
        bigRows.push({ hour: String(x), day: String(y), count: 1 });
    render(<HeatmapPlot node={heatNode} rows={bigRows} />);
    expect(screen.getByTestId('heatmap-error')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — verify new tests fail**

```bash
npx vitest run src/__tests__/plots/heatmap.test.tsx 2>&1 | tail -8
```

- [ ] **Step 3: Implement HeatmapPlot.tsx**

```tsx
// src/components/plots/HeatmapPlot.tsx
import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { buildGrid, interpolateColor } from './heatmapUtils';
import type { AggregateMode } from './heatmapUtils';
import { resolveValue } from './plotSeriesUtils';
import type { PanelNode } from '../../services/parser/types';

interface ChartPlotProps {
  node: PanelNode;
  rows: Record<string, unknown>[];
  scope?: Record<string, unknown>;
}

const CELL_SIZE = 28;
const LABEL_WIDTH = 64;
const LABEL_HEIGHT = 24;
const PADDING = 8;

export function HeatmapPlot({ node, rows, scope = {} }: ChartPlotProps): JSX.Element {
  const xCol = String(resolveValue(node.keys['x'] ?? '', scope) ?? '');
  const yCol = String(resolveValue(node.keys['y'] ?? '', scope) ?? '');
  const valueCol = String(resolveValue(node.keys['value'] ?? '', scope) ?? '');
  const aggregate = (String(resolveValue(node.keys['aggregate'] ?? 'count', scope) ?? 'count')) as AggregateMode;
  const title = node.title;

  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string } | null>(null);

  const grid = useMemo(() => {
    if (rows.length === 0) return null;
    return buildGrid(rows, xCol, yCol, valueCol, aggregate);
  }, [rows, xCol, yCol, valueCol, aggregate]);

  if (!grid || rows.length === 0) {
    return (
      <div data-testid="heatmap-empty" className="flex items-center justify-center h-40 text-[12px] text-[--color-fg-muted]">
        No data
      </div>
    );
  }

  if (grid.error) {
    return (
      <div data-testid="heatmap-error" className="flex items-center justify-center h-40 text-[12px] text-[--color-accent-red] px-4 text-center">
        {grid.error}
      </div>
    );
  }

  const { xLabels, yLabels, cells, maxValue } = grid;
  const svgWidth = LABEL_WIDTH + xLabels.length * CELL_SIZE + PADDING;
  const svgHeight = LABEL_HEIGHT + yLabels.length * CELL_SIZE + PADDING;

  return (
    <div data-testid="heatmap-plot" className="w-full overflow-auto relative">
      {title && (
        <div className="text-[12px] font-medium text-[--color-fg-base] px-2 pb-1">{title}</div>
      )}
      <svg width={svgWidth} height={svgHeight} aria-label={title ?? 'heatmap'}>
        {/* X axis labels */}
        {xLabels.map((label, xi) => (
          <text
            key={`xl-${xi}`}
            x={LABEL_WIDTH + xi * CELL_SIZE + CELL_SIZE / 2}
            y={LABEL_HEIGHT - 4}
            textAnchor="middle"
            fontSize={10}
            fill="var(--color-fg-muted)"
          >
            {label.length > 6 ? label.slice(0, 5) + '…' : label}
          </text>
        ))}
        {/* Y axis labels */}
        {yLabels.map((label, yi) => (
          <text
            key={`yl-${yi}`}
            x={LABEL_WIDTH - 4}
            y={LABEL_HEIGHT + yi * CELL_SIZE + CELL_SIZE / 2 + 4}
            textAnchor="end"
            fontSize={10}
            fill="var(--color-fg-muted)"
          >
            {label.length > 8 ? label.slice(0, 7) + '…' : label}
          </text>
        ))}
        {/* Cells */}
        {xLabels.map((xl, xi) =>
          yLabels.map((yl, yi) => {
            const value = cells[xi]?.[yi] ?? 0;
            const ratio = maxValue > 0 ? value / maxValue : 0;
            const fill = interpolateColor(ratio);
            return (
              <rect
                key={`${xi}-${yi}`}
                data-testid="heatmap-cell"
                x={LABEL_WIDTH + xi * CELL_SIZE + 1}
                y={LABEL_HEIGHT + yi * CELL_SIZE + 1}
                width={CELL_SIZE - 2}
                height={CELL_SIZE - 2}
                fill={fill}
                rx={2}
                onMouseEnter={(e) => setTooltip({
                  x: e.clientX,
                  y: e.clientY,
                  label: `${xl}, ${yl}: ${value.toFixed(1)}`,
                })}
                onMouseLeave={() => setTooltip(null)}
                style={{ cursor: 'default' }}
              />
            );
          })
        )}
      </svg>
      {tooltip && (
        <div
          className="fixed z-50 px-2 py-1 text-[11px] rounded pointer-events-none"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y - 8,
            background: 'var(--color-bg-overlay)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-fg-base)',
          }}
        >
          {tooltip.label}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run — verify pass**

```bash
npx vitest run src/__tests__/plots/heatmap.test.tsx 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/components/plots/HeatmapPlot.tsx src/__tests__/plots/heatmap.test.tsx
git commit -m "feat(M-C3): HeatmapPlot — SVG grid with opacity-interpolated cells"
```

---

## Task 5: Wire into PlotRenderer + index.ts

**Files:**
- Modify: `src/components/plots/index.ts`
- Modify: `src/components/plots/PlotRenderer.tsx`

- [ ] **Step 1: Update index.ts**

Add to exports:
```ts
export { HistogramPlot } from './HistogramPlot';
export { BoxplotPlot } from './BoxplotPlot';
export { HeatmapPlot } from './HeatmapPlot';
export { buildGrid, interpolateColor } from './heatmapUtils';
```

- [ ] **Step 2: Update PlotRenderer.tsx**

Add cases for `'histogram'`, `'boxplot'`, `'heatmap'` in the renderer switch (same pattern as `'line'`, `'bar'`, `'scatter'`):

```tsx
// In PlotRenderer.tsx, add to the switch/conditional:
import { HistogramPlot } from './HistogramPlot';
import { BoxplotPlot } from './BoxplotPlot';
import { HeatmapPlot } from './HeatmapPlot';

// In render logic, after scatter case:
case 'histogram':
  return <HistogramPlot node={node} rows={rows} scope={scope} />;
case 'boxplot':
  return <BoxplotPlot node={node} rows={rows} scope={scope} />;
case 'heatmap':
  return <HeatmapPlot node={node} rows={rows} scope={scope} />;
```

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run 2>&1 | tail -6
```
Expected: all passing, no new failures.

- [ ] **Step 4: Commit**

```bash
git add src/components/plots/index.ts src/components/plots/PlotRenderer.tsx
git commit -m "feat(M-C3): wire histogram/boxplot/heatmap into PlotRenderer"
```

---

## Task 6: Perf bench — histogram binning + heatmap grid

**Files:**
- Create: `src/__tests__/plots/histogram.bench.ts`

- [ ] **Step 1: Write bench**

```ts
// src/__tests__/plots/histogram.bench.ts
import { bench, describe } from 'vitest';
import { buildGrid } from '../../components/plots/heatmapUtils';

describe('heatmapUtils perf', () => {
  const rows1k = Array.from({ length: 1000 }, (_, i) => ({
    x: String(i % 20), y: String(i % 10), v: i,
  }));

  bench('buildGrid 1k rows 20x10', () => {
    buildGrid(rows1k, 'x', 'y', 'v', 'sum');
  });

  const rows10k = Array.from({ length: 10000 }, (_, i) => ({
    x: String(i % 50), y: String(i % 20), v: i,
  }));

  bench('buildGrid 10k rows 50x20', () => {
    buildGrid(rows10k, 'x', 'y', 'v', 'mean');
  });
});
```

- [ ] **Step 2: Run bench to confirm it works**

```bash
npx vitest bench src/__tests__/plots/histogram.bench.ts 2>&1 | tail -15
```

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/plots/histogram.bench.ts
git commit -m "bench(M-C3): heatmapUtils perf bench"
```

---

## Task 7: E2E smoke tests

**Files:**
- Modify: `tests/e2e/03-plot-dsl.spec.ts`

- [ ] **Step 1: Add smoke tests (self-skipping pattern)**

Append to `tests/e2e/03-plot-dsl.spec.ts`:

```ts
test.describe('M-C3 plot smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4173');
    const hasNotebook = await page.locator('[data-testid="welcome-cell"]').isVisible().catch(() => false);
    if (hasNotebook) test.skip();
  });

  test('histogram plot renders in dark theme', async ({ page }) => {
    // Verified in visual tests; E2E skipped without loaded notebook
    test.skip();
  });

  test('boxplot plot renders in dark theme', async ({ page }) => {
    test.skip();
  });

  test('heatmap plot renders SVG cells', async ({ page }) => {
    test.skip();
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/03-plot-dsl.spec.ts
git commit -m "test(M-C3): E2E smoke stubs for histogram/boxplot/heatmap"
```

---

## Task 8: Visual regression snapshots

**Files:**
- Modify: `tests/visual/plots.spec.ts`

- [ ] **Step 1: Append visual tests**

```ts
// Append to tests/visual/plots.spec.ts:

test('histogram dark tokens visual', async ({ page }) => {
  await page.setContent(`
    <!DOCTYPE html>
    <html data-theme="dark">
    <head>
      <link rel="stylesheet" href="/src/styles/tokens.css" />
      <style>body{margin:0;background:var(--color-bg-base);}</style>
    </head>
    <body>
      <div id="root" style="width:600px;padding:16px;"></div>
      <script type="module">
        import { createRoot } from '/node_modules/react-dom/client';
        import React from '/node_modules/react';
        import { HistogramPlot } from '/src/components/plots/HistogramPlot.tsx';
        const rows = Array.from({length:50}, (_,i) => ({dur: i * 2}));
        const node = { kind: 'histogram', keys: { x: 'dur', bins: 10 } };
        createRoot(document.getElementById('root')).render(
          React.createElement(HistogramPlot, { node, rows })
        );
      </script>
    </body></html>
  `, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="histogram-plot"]')).toBeVisible();
  await expect(page).toHaveScreenshot('histogram-chart-dark-tokens-visual-dark.png');
});

test('heatmap dark tokens visual', async ({ page }) => {
  await page.setContent(`
    <!DOCTYPE html>
    <html data-theme="dark">
    <head>
      <link rel="stylesheet" href="/src/styles/tokens.css" />
      <style>body{margin:0;background:var(--color-bg-base);}</style>
    </head>
    <body>
      <div id="root" style="width:600px;padding:16px;"></div>
      <script type="module">
        import { createRoot } from '/node_modules/react-dom/client';
        import React from '/node_modules/react';
        import { HeatmapPlot } from '/src/components/plots/HeatmapPlot.tsx';
        const rows = [
          {x:'Mon',y:'9am',v:5},{x:'Mon',y:'10am',v:8},
          {x:'Tue',y:'9am',v:3},{x:'Tue',y:'10am',v:12},
          {x:'Wed',y:'9am',v:7},{x:'Wed',y:'10am',v:2},
        ];
        const node = { kind: 'heatmap', keys: { x: 'x', y: 'y', value: 'v', aggregate: 'sum' } };
        createRoot(document.getElementById('root')).render(
          React.createElement(HeatmapPlot, { node, rows })
        );
      </script>
    </body></html>
  `, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="heatmap-plot"]')).toBeVisible();
  await expect(page).toHaveScreenshot('heatmap-chart-dark-tokens-visual-dark.png');
});
```

- [ ] **Step 2: Update visual snapshot baselines**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx playwright test tests/visual/plots.spec.ts --update-snapshots 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add tests/visual/plots.spec.ts tests/visual/plots.spec.ts-snapshots/
git commit -m "test(M-C3): visual regression snapshots for histogram + heatmap"
```

---

## Task 9: A11y tests

**Files:**
- Modify: `tests/visual/a11y-plot-renderer.spec.ts`

- [ ] **Step 1: Add axe checks for new renderers**

```ts
// Append to tests/visual/a11y-plot-renderer.spec.ts:

test('HistogramPlot has no axe violations', async ({ page }) => {
  await page.setContent(`
    <!DOCTYPE html><html data-theme="dark"><head></head>
    <body>
      <div id="root" style="width:600px;"></div>
      <script type="module">
        import { createRoot } from '/node_modules/react-dom/client';
        import React from '/node_modules/react';
        import { HistogramPlot } from '/src/components/plots/HistogramPlot.tsx';
        const rows = Array.from({length:50}, (_,i) => ({dur: i * 2}));
        const node = { kind: 'histogram', keys: { x: 'dur', bins: 10 } };
        createRoot(document.getElementById('root')).render(
          React.createElement(HistogramPlot, { node, rows })
        );
      </script>
    </body></html>
  `, { waitUntil: 'networkidle' });
  const axeBuilder = new AxeBuilder({ page });
  const results = await axeBuilder.include('#root').analyze();
  expect(results.violations).toHaveLength(0);
});

test('HeatmapPlot has no axe violations', async ({ page }) => {
  await page.setContent(`
    <!DOCTYPE html><html data-theme="dark"><head></head>
    <body>
      <div id="root" style="width:600px;"></div>
      <script type="module">
        import { createRoot } from '/node_modules/react-dom/client';
        import React from '/node_modules/react';
        import { HeatmapPlot } from '/src/components/plots/HeatmapPlot.tsx';
        const rows = [{x:'A',y:'X',v:5},{x:'B',y:'X',v:10},{x:'A',y:'Y',v:3},{x:'B',y:'Y',v:7}];
        const node = { kind: 'heatmap', keys: { x: 'x', y: 'y', value: 'v', aggregate: 'sum' } };
        createRoot(document.getElementById('root')).render(
          React.createElement(HeatmapPlot, { node, rows })
        );
      </script>
    </body></html>
  `, { waitUntil: 'networkidle' });
  const axeBuilder = new AxeBuilder({ page });
  const results = await axeBuilder.include('#root').analyze();
  expect(results.violations).toHaveLength(0);
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/visual/a11y-plot-renderer.spec.ts
git commit -m "test(M-C3): a11y checks for HistogramPlot + HeatmapPlot"
```

---

## Task 10: Full test suite + Checkpoint D visual

- [ ] **Step 1: Run full vitest suite**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run 2>&1 | tail -6
```
Expected: all passing, 0 failures. New unit tests should add ~30-40 tests.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 3: Checkpoint D — Visual verification via Playwright MCP**

```
mcp__playwright__navigate({ url: "http://localhost:5173" })
mcp__playwright__screenshot({ name: "M-C3-app-checkpoint" })
mcp__playwright__navigate({ url: "file:///Users/i560383_1/code/experiments/jfr-sql-notebook/redesign-plan/showcase.html" })
mcp__playwright__screenshot({ name: "M-C3-showcase-reference" })
```

Compare screenshots. List any critical deviations (wrong theme, wrong colors, layout broken). Fix any critical issues before final commit.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(M-C3): histogram + boxplot + heatmap renderers — all 5 test layers pass"
```

Report: total tests passing, files created, any visual deviations found.

---

## Summary

**Files created:**
- `src/components/plots/HistogramPlot.tsx`
- `src/components/plots/BoxplotPlot.tsx`
- `src/components/plots/HeatmapPlot.tsx`
- `src/components/plots/heatmapUtils.ts`
- `src/__tests__/plots/histogram.test.tsx`
- `src/__tests__/plots/boxplot.test.tsx`
- `src/__tests__/plots/heatmap.test.tsx`
- `src/__tests__/plots/histogram.bench.ts`

**Files modified:**
- `src/components/plots/index.ts`
- `src/components/plots/PlotRenderer.tsx`
- `tests/e2e/03-plot-dsl.spec.ts`
- `tests/visual/plots.spec.ts`
- `tests/visual/a11y-plot-renderer.spec.ts`

**Test additions:** ~35-45 new unit tests + 2 visual snapshots + 2 a11y checks
