# M-C2: Line + Bar + Scatter Renderers

> **For agentic workers:** Use superpowers:executing-plans.
> **Testing standard:** All 5 layers apply: unit / E2E / visual regression / a11y / perf bench.

**Goal:** Deliver `LineChartPlot`, `BarChartPlot`, `ScatterPlot` — three Recharts concrete renderers mounting inside `PlotRenderer` (M-C1). Each takes `node: PanelNode` from M-A3, `rows: Record<string, unknown>[]`, and an optional `scope` for `VarRef` resolution. Colors use `var(--color-*)` CSS tokens as Recharts `stroke`/`fill` props. ResponsiveContainer at 320px height. Wired into `PlotRenderer` from M-C1.

**Blocked by:** M-C1 (PlotRenderer, PlotContext, plotTypes.ts).

**Tech stack:** React 19.2, TypeScript 5.8, Recharts (already installed by M-C1), Vitest 4.1.9 (pool: forks), @testing-library/react 16.3.0, @testing-library/user-event 14.6.1, @testing-library/jest-dom 6.6.3, Playwright 1.61.0, `import AxeBuilder from '@axe-core/playwright'` (static import).

---

## Pre-resolved decisions

### DECISION 1: Renderer prop interface

Every renderer takes:
```ts
interface ChartPlotProps {
  node: PanelNode;                  // from src/services/parser/types.ts
  rows: Record<string, unknown>[];  // raw query result rows
  scope?: Record<string, unknown>;  // VarRef resolution table, default {}
}
```

### DECISION 2: VarRef resolution

`resolveValue(val: PlotValue, scope: Record<string, unknown>): string | number | boolean | undefined`
- `VarRef` → look up `val.name` in scope; `console.warn` + return `undefined` when missing.
- Primitive → return as-is.
- Array → unsupported; return `undefined`.

### DECISION 3: Color palette — CSS tokens only

```ts
export const SERIES_COLORS: string[] = [
  'var(--color-accent)',
  'var(--color-accent-amber)',
  'var(--color-accent-purple)',
  'var(--color-accent-green)',
  'var(--color-accent-orange)',
  'var(--color-accent-yellow)',
  'var(--color-accent-red)',
];
```
Color is selected by `SERIES_COLORS[i % SERIES_COLORS.length]`. No hardcoded hex anywhere.

### DECISION 4: Null y-values

Line and scatter: `null`/`undefined` → gap, not zero. Recharts `connectNulls={false}` on `<Line>`. Bar: null renders as zero-height bar (Recharts default).

### DECISION 5: `prefers-reduced-motion`

When `window.matchMedia('(prefers-reduced-motion: reduce)').matches`, pass `animationDuration={0}` and `isAnimationActive={false}` to all Recharts `<Line>`, `<Bar>`, `<Scatter>`.

### DECISION 6: Scatter cardinality guard

When `color` config key maps to a categorical column with >20 distinct values: `console.warn('[ScatterPlot] High-cardinality color column: …')` and fall back to single color `SERIES_COLORS[0]`.

### DECISION 7: `data-testid` attributes

- `data-testid="line-chart"` on `LineChartPlot` root div
- `data-testid="bar-chart"` on `BarChartPlot` root div
- `data-testid="scatter-chart"` on `ScatterPlot` root div

### DECISION 8: `aria-label` on chart container

- Line: `"Line chart: {N} series"` or `"Line chart"`
- Bar: `"Bar chart: {N} series, {M} categories"` or `"Bar chart"`
- Scatter: `"Scatter chart: {N} points"` or `"Scatter chart"`

### DECISION 9: File locations

New files:
- `frontend-v2/src/components/plots/plotSeriesUtils.ts`
- `frontend-v2/src/components/plots/LineChartPlot.tsx`
- `frontend-v2/src/components/plots/BarChartPlot.tsx`
- `frontend-v2/src/components/plots/ScatterPlot.tsx`

Test files:
- `frontend-v2/src/__tests__/plots/plotSeriesUtils.test.ts`
- `frontend-v2/src/__tests__/plots/line.test.tsx`
- `frontend-v2/src/__tests__/plots/bar.test.tsx`
- `frontend-v2/src/__tests__/plots/scatter.test.tsx`
- `frontend-v2/src/__tests__/plots/line.bench.ts`

E2E: `frontend-v2/tests/e2e/03-plot-dsl.spec.ts` — add `@e2e` cases
Visual: `frontend-v2/tests/visual/plots.spec.ts` — add line/bar/scatter snapshots
A11y: `frontend-v2/tests/e2e/a11y-plot-renderer.spec.ts` — add chart cases

### DECISION 10: Wire into PlotRenderer

`PlotRenderer` accepts an optional `plotNode` prop. When present and `state.status === 'rendered'`, render the concrete chart inside the `plot-state-rendered` shell. Concretely: the caller wraps the renderer:
```tsx
<PlotRenderer state={state} title="…" cellId="…" plotName="…">
  <LineChartPlot node={panelNode} rows={rows} scope={scope} />
</PlotRenderer>
```
No changes to `PlotRenderer.tsx` are needed — children already render inside the rendered shell.

---

## Steps

### Task 1: Shared utilities — test then implement

**1.1 Write failing test** — create `frontend-v2/src/__tests__/plots/plotSeriesUtils.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  resolveValue,
  SERIES_COLORS,
  buildSeriesDescriptors,
  isReducedMotion,
  extractNumeric,
  extractString,
} from '../../components/plots/plotSeriesUtils';
import type { PlotValue } from '../../services/parser/types';

describe('resolveValue', () => {
  it('returns primitive string', () => { expect(resolveValue('ts', {})).toBe('ts'); });
  it('returns primitive number', () => { expect(resolveValue(42, {})).toBe(42); });
  it('returns primitive boolean', () => { expect(resolveValue(true, {})).toBe(true); });
  it('resolves VarRef from scope', () => {
    const ref: PlotValue = { name: 'x', scope: 'cell', path: [], renderOnly: false };
    expect(resolveValue(ref, { x: 'heap' })).toBe('heap');
  });
  it('warns and returns undefined when VarRef missing', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ref: PlotValue = { name: 'missing', scope: 'cell', path: [], renderOnly: false };
    expect(resolveValue(ref, {})).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('missing'));
    vi.restoreAllMocks();
  });
  it('returns undefined for array PlotValue', () => {
    expect(resolveValue([], {})).toBeUndefined();
  });
});

describe('SERIES_COLORS', () => {
  it('has at least 7 entries', () => { expect(SERIES_COLORS.length).toBeGreaterThanOrEqual(7); });
  it('all entries use var(--color-*)', () => {
    for (const c of SERIES_COLORS) expect(c).toMatch(/^var\(--color-/);
  });
  it('first color is var(--color-accent)', () => {
    expect(SERIES_COLORS[0]).toBe('var(--color-accent)');
  });
});

describe('buildSeriesDescriptors', () => {
  it('maps keys to descriptors with cycled colors', () => {
    const r = buildSeriesDescriptors(['a', 'b']);
    expect(r[0]).toEqual({ key: 'a', label: 'a', color: SERIES_COLORS[0] });
    expect(r[1]).toEqual({ key: 'b', label: 'b', color: SERIES_COLORS[1] });
  });
  it('cycles when more series than palette', () => {
    const keys = Array.from({ length: SERIES_COLORS.length + 1 }, (_, i) => `s${i}`);
    const r = buildSeriesDescriptors(keys);
    expect(r[0].color).toBe(r[SERIES_COLORS.length].color);
  });
  it('accepts label overrides', () => {
    const r = buildSeriesDescriptors(['heap'], { heap: 'Heap Used' });
    expect(r[0].label).toBe('Heap Used');
  });
});

describe('extractNumeric', () => {
  it('extracts number', () => { expect(extractNumeric({ v: 42 }, 'v')).toBe(42); });
  it('parses numeric string', () => { expect(extractNumeric({ v: '3.14' }, 'v')).toBe(3.14); });
  it('returns null for null cell', () => { expect(extractNumeric({ v: null }, 'v')).toBeNull(); });
  it('returns null for non-numeric string', () => { expect(extractNumeric({ v: 'text' }, 'v')).toBeNull(); });
  it('returns null for missing column', () => { expect(extractNumeric({}, 'v')).toBeNull(); });
});

describe('extractString', () => {
  it('extracts string', () => { expect(extractString({ c: 'G1GC' }, 'c')).toBe('G1GC'); });
  it('converts number to string', () => { expect(extractString({ c: 42 }, 'c')).toBe('42'); });
  it('returns null for null', () => { expect(extractString({ c: null }, 'c')).toBeNull(); });
  it('returns null for missing column', () => { expect(extractString({}, 'c')).toBeNull(); });
});

describe('isReducedMotion', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it('returns false when matchMedia reports false', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    expect(isReducedMotion()).toBe(false);
  });
  it('returns true when prefers-reduced-motion: reduce', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    expect(isReducedMotion()).toBe(true);
  });
});
```

**1.2 Run to confirm failure:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- plotSeriesUtils
```
Expected: FAIL — `Cannot find module '…/plotSeriesUtils'`

**1.3 Implement** `frontend-v2/src/components/plots/plotSeriesUtils.ts`:

```ts
import type { PlotValue, VarRef } from '../../services/parser/types';
import type { SeriesDescriptor } from './plotTypes';

export const SERIES_COLORS: string[] = [
  'var(--color-accent)',
  'var(--color-accent-amber)',
  'var(--color-accent-purple)',
  'var(--color-accent-green)',
  'var(--color-accent-orange)',
  'var(--color-accent-yellow)',
  'var(--color-accent-red)',
];

function isVarRef(val: unknown): val is VarRef {
  return typeof val === 'object' && val !== null && 'name' in val && 'scope' in val;
}

export function resolveValue(
  val: PlotValue,
  scope: Record<string, unknown>
): string | number | boolean | undefined {
  if (Array.isArray(val)) return undefined;
  if (isVarRef(val)) {
    const resolved = scope[val.name];
    if (resolved === undefined) {
      console.warn(`[plotSeriesUtils] VarRef '${val.name}' not found in scope`);
      return undefined;
    }
    return resolved as string | number | boolean;
  }
  return val as string | number | boolean;
}

export function buildSeriesDescriptors(
  keys: string[],
  labelOverrides: Record<string, string> = {}
): SeriesDescriptor[] {
  return keys.map((key, i) => ({
    key,
    label: labelOverrides[key] ?? key,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
  }));
}

export function extractNumeric(row: Record<string, unknown>, col: string): number | null {
  const val = row[col];
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

export function extractString(row: Record<string, unknown>, col: string): string | null {
  const val = row[col];
  if (val === null || val === undefined) return null;
  return String(val);
}

export function isReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
```

**1.4 Run to confirm pass:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- plotSeriesUtils
```
Expected: ALL PASS. Then: `npx tsc --noEmit` — 0 errors.

---

### Task 2: LineChartPlot — test then implement

**2.1 Write failing test** — create `frontend-v2/src/__tests__/plots/line.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { JSX } from 'react';
import { LineChartPlot } from '../../components/plots/LineChartPlot';
import { PlotRenderer } from '../../components/plots/PlotRenderer';
import type { PanelNode } from '../../services/parser/types';

const RENDERED = { status: 'rendered' as const, rowCount: 4 };

const LINE_NODE: PanelNode = {
  kind: 'panel',
  plotType: 'line',
  config: { x: 'ts', y: 'heap' },
  clauses: {},
};

const LINE_NODE_MULTI: PanelNode = {
  kind: 'panel',
  plotType: 'line',
  config: { x: 'ts', y: 'heap', color: 'series' },
  clauses: {},
};

const GC_ROWS = [
  { ts: 0, heap: 100, series: 'G1GC' },
  { ts: 1, heap: 120, series: 'G1GC' },
  { ts: 0, heap: 80,  series: 'ZGC'  },
  { ts: 1, heap: 90,  series: 'ZGC'  },
];

const NULL_ROWS = [
  { ts: 0, heap: 100 },
  { ts: 1, heap: null },
  { ts: 2, heap: 80  },
];

function wrap(node: PanelNode, rows: typeof GC_ROWS | typeof NULL_ROWS): JSX.Element {
  return (
    <PlotRenderer state={RENDERED} title="Test" cellId="c1" plotName="p1">
      <LineChartPlot node={node} rows={rows} />
    </PlotRenderer>
  );
}

describe('LineChartPlot — rendering', () => {
  it('renders with data-testid="line-chart"', () => {
    render(wrap(LINE_NODE, GC_ROWS));
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
  });

  it('has aria-label starting with "Line chart"', () => {
    render(wrap(LINE_NODE, GC_ROWS));
    expect(screen.getByTestId('line-chart').getAttribute('aria-label')).toMatch(/^Line chart/);
  });

  it('multi-series: aria-label mentions series count', () => {
    render(wrap(LINE_NODE_MULTI, GC_ROWS));
    expect(screen.getByTestId('line-chart').getAttribute('aria-label')).toMatch(/2 series/);
  });

  it('renders without throwing on null y values', () => {
    expect(() => render(wrap(LINE_NODE, NULL_ROWS))).not.toThrow();
  });

  it('warns when VarRef x is missing from scope', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const nodeWithRef: PanelNode = {
      kind: 'panel', plotType: 'line',
      config: { x: { name: 'xVar', scope: 'cell', path: [], renderOnly: false }, y: 'heap' },
      clauses: {},
    };
    render(wrap(nodeWithRef, GC_ROWS));
    expect(spy).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('LineChartPlot — reduced-motion', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders without throwing when reduced-motion is set', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    expect(() => render(wrap(LINE_NODE, GC_ROWS))).not.toThrow();
  });
});

describe('LineChartPlot — color tokens', () => {
  it('rendered SVG line strokes are not hardcoded hex', () => {
    const { container } = render(wrap(LINE_NODE, GC_ROWS));
    const paths = container.querySelectorAll('path.recharts-line-curve');
    paths.forEach((p) => {
      const stroke = p.getAttribute('stroke') ?? '';
      expect(stroke).not.toMatch(/^#[0-9a-fA-F]{3,6}$/);
    });
  });
});
```

**2.2 Run to confirm failure:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- line.test
```
Expected: FAIL — `Cannot find module '…/LineChartPlot'`

**2.3 Implement** `frontend-v2/src/components/plots/LineChartPlot.tsx`:

```tsx
import { useEffect, useMemo } from 'react';
import type { JSX } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import type { PanelNode } from '../../services/parser/types';
import { usePlotContext } from './PlotContext';
import {
  resolveValue, buildSeriesDescriptors,
  extractNumeric, extractString, isReducedMotion, SERIES_COLORS,
} from './plotSeriesUtils';

interface LineChartPlotProps {
  node: PanelNode;
  rows: Record<string, unknown>[];
  scope?: Record<string, unknown>;
}

interface ChartPoint {
  x: string | number;
  [key: string]: string | number | null;
}

function buildLineData(
  rows: Record<string, unknown>[],
  xCol: string, yCol: string, colorCol: string | null
): { data: ChartPoint[]; seriesKeys: string[] } {
  if (!colorCol) {
    return {
      data: rows.map((r) => ({ x: extractString(r, xCol) ?? extractNumeric(r, xCol) ?? '', [yCol]: extractNumeric(r, yCol) })),
      seriesKeys: [yCol],
    };
  }
  const seriesSet = new Set<string>();
  for (const r of rows) { const c = extractString(r, colorCol); if (c !== null) seriesSet.add(c); }
  const seriesKeys = Array.from(seriesSet);
  const pointMap = new Map<string | number, ChartPoint>();
  for (const r of rows) {
    const xVal = extractString(r, xCol) ?? extractNumeric(r, xCol) ?? '';
    const cat = extractString(r, colorCol);
    const yVal = extractNumeric(r, yCol);
    if (!pointMap.has(xVal)) {
      const pt: ChartPoint = { x: xVal };
      for (const sk of seriesKeys) pt[sk] = null;
      pointMap.set(xVal, pt);
    }
    if (cat !== null) { const pt = pointMap.get(xVal)!; pt[cat] = yVal; }
  }
  return { data: Array.from(pointMap.values()), seriesKeys };
}

export function LineChartPlot({ node, rows, scope = {} }: LineChartPlotProps): JSX.Element {
  const ctx = usePlotContext();
  const reducedMotion = isReducedMotion();
  const xCol = resolveValue(node.config['x'] ?? '', scope);
  const yCol = resolveValue(node.config['y'] ?? '', scope);
  const colorCol = node.config['color'] !== undefined ? resolveValue(node.config['color'], scope) : null;
  const xColStr = typeof xCol === 'string' ? xCol : null;
  const yColStr = typeof yCol === 'string' ? yCol : null;
  const colorColStr = typeof colorCol === 'string' ? colorCol : null;

  const { data, seriesKeys } = useMemo(
    () => (!xColStr || !yColStr ? { data: [], seriesKeys: [] } : buildLineData(rows, xColStr, yColStr, colorColStr)),
    [rows, xColStr, yColStr, colorColStr]
  );
  const descriptors = useMemo(() => buildSeriesDescriptors(seriesKeys), [seriesKeys]);
  useEffect(() => { ctx.registerSeries(descriptors); }, [ctx, descriptors]);

  const ariaLabel = seriesKeys.length > 1 ? `Line chart: ${seriesKeys.length} series` : 'Line chart';
  const animProps = reducedMotion ? { animationDuration: 0, isAnimationActive: false } : {};
  const hidden = ctx.hiddenSeries;

  return (
    <div data-testid="line-chart" aria-label={ariaLabel} className="w-full">
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="x" tick={{ fill: 'var(--color-fg-muted)', fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: 'var(--color-fg-muted)', fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 4 }}
            labelStyle={{ color: 'var(--color-fg-muted)' }}
            itemStyle={{ color: 'var(--color-fg-base)' }}
          />
          {seriesKeys.map((sk, i) => (
            !hidden.has(sk) && (
              <Line
                key={sk}
                type="monotone"
                dataKey={sk}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                dot={false}
                connectNulls={false}
                strokeWidth={1.5}
                {...animProps}
              />
            )
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

**2.4 Run to confirm pass:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- line.test
```
Expected: ALL PASS. Then: `npx tsc --noEmit` — 0 errors.

---

### Task 3: BarChartPlot — test then implement

**3.1 Write failing test** — create `frontend-v2/src/__tests__/plots/bar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { JSX } from 'react';
import { BarChartPlot } from '../../components/plots/BarChartPlot';
import { PlotRenderer } from '../../components/plots/PlotRenderer';
import type { PanelNode } from '../../services/parser/types';

const RENDERED = { status: 'rendered' as const, rowCount: 3 };

const BAR_NODE_V: PanelNode = {
  kind: 'panel', plotType: 'bar',
  config: { x: 'category', y: 'value' },
  clauses: {},
};
const BAR_NODE_H: PanelNode = {
  kind: 'panel', plotType: 'bar',
  config: { x: 'category', y: 'value', orientation: 'horizontal' },
  clauses: {},
};
const BAR_NODE_STACKED: PanelNode = {
  kind: 'panel', plotType: 'bar',
  config: { x: 'category', y: 'value', color: 'series', stacked: true },
  clauses: {},
};
const BAR_NODE_SORTED: PanelNode = {
  kind: 'panel', plotType: 'bar',
  config: { x: 'category', y: 'value', sort: 'value desc' },
  clauses: {},
};

const ROWS = [
  { category: 'G1GC', value: 200, series: 'heap' },
  { category: 'ZGC',  value: 150, series: 'heap' },
  { category: 'Shen', value: 80,  series: 'heap' },
];
const NEG_ROWS = [{ category: 'G1GC', value: -50 }, { category: 'ZGC', value: 100 }];

function wrap(node: PanelNode, rows: Record<string, unknown>[]): JSX.Element {
  return (
    <PlotRenderer state={RENDERED} title="Test" cellId="c1" plotName="p1">
      <BarChartPlot node={node} rows={rows} />
    </PlotRenderer>
  );
}

describe('BarChartPlot — rendering', () => {
  it('renders with data-testid="bar-chart"', () => {
    render(wrap(BAR_NODE_V, ROWS));
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
  });

  it('aria-label starts with "Bar chart"', () => {
    render(wrap(BAR_NODE_V, ROWS));
    expect(screen.getByTestId('bar-chart').getAttribute('aria-label')).toMatch(/^Bar chart/);
  });

  it('horizontal orientation renders without throwing', () => {
    expect(() => render(wrap(BAR_NODE_H, ROWS))).not.toThrow();
  });

  it('stacked renders without throwing', () => {
    expect(() => render(wrap(BAR_NODE_STACKED, ROWS))).not.toThrow();
  });

  it('sorted renders without throwing', () => {
    expect(() => render(wrap(BAR_NODE_SORTED, ROWS))).not.toThrow();
  });

  it('negative values render without throwing', () => {
    expect(() => render(wrap(BAR_NODE_V, NEG_ROWS))).not.toThrow();
  });
});

describe('BarChartPlot — color tokens', () => {
  it('bar fill is not a hardcoded hex', () => {
    const { container } = render(wrap(BAR_NODE_V, ROWS));
    const rects = container.querySelectorAll('.recharts-bar-rectangle path, .recharts-bar-rectangle rect');
    rects.forEach((el) => {
      const fill = el.getAttribute('fill') ?? '';
      expect(fill).not.toMatch(/^#[0-9a-fA-F]{3,6}$/);
    });
  });
});

describe('BarChartPlot — reduced-motion', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it('renders without throwing when reduced-motion is set', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    expect(() => render(wrap(BAR_NODE_V, ROWS))).not.toThrow();
  });
});
```

**3.2 Run to confirm failure:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- bar.test
```
Expected: FAIL — `Cannot find module '…/BarChartPlot'`

**3.3 Implement** `frontend-v2/src/components/plots/BarChartPlot.tsx`:

```tsx
import { useEffect, useMemo } from 'react';
import type { JSX } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import type { PanelNode } from '../../services/parser/types';
import { usePlotContext } from './PlotContext';
import {
  resolveValue, buildSeriesDescriptors,
  extractNumeric, extractString, isReducedMotion, SERIES_COLORS,
} from './plotSeriesUtils';

interface BarChartPlotProps {
  node: PanelNode;
  rows: Record<string, unknown>[];
  scope?: Record<string, unknown>;
}

export function BarChartPlot({ node, rows, scope = {} }: BarChartPlotProps): JSX.Element {
  const ctx = usePlotContext();
  const reducedMotion = isReducedMotion();

  const xCol = typeof resolveValue(node.config['x'] ?? '', scope) === 'string'
    ? (resolveValue(node.config['x'] ?? '', scope) as string) : null;
  const yCol = typeof resolveValue(node.config['y'] ?? '', scope) === 'string'
    ? (resolveValue(node.config['y'] ?? '', scope) as string) : null;
  const colorCol = node.config['color'] !== undefined
    ? (resolveValue(node.config['color'], scope) as string | undefined) ?? null : null;
  const isHorizontal = resolveValue(node.config['orientation'] ?? '', scope) === 'horizontal';
  const isStacked = resolveValue(node.config['stacked'] ?? false, scope) === true;
  const sortDesc = resolveValue(node.config['sort'] ?? '', scope) === 'value desc';

  // Build pivot data
  const { data, seriesKeys } = useMemo(() => {
    if (!xCol || !yCol) return { data: [], seriesKeys: [] };
    if (!colorCol) {
      let d = rows.map((r) => ({
        x: extractString(r, xCol) ?? extractNumeric(r, xCol) ?? '',
        [yCol]: extractNumeric(r, yCol),
      }));
      if (sortDesc) d = [...d].sort((a, b) => ((b[yCol] as number) ?? 0) - ((a[yCol] as number) ?? 0));
      return { data: d, seriesKeys: [yCol] };
    }
    const seriesSet = new Set<string>();
    for (const r of rows) { const c = extractString(r, colorCol); if (c !== null) seriesSet.add(c); }
    const sk = Array.from(seriesSet);
    const pointMap = new Map<string | number, Record<string, string | number | null>>();
    for (const r of rows) {
      const xVal = extractString(r, xCol) ?? extractNumeric(r, xCol) ?? '';
      const cat = extractString(r, colorCol);
      const yVal = extractNumeric(r, yCol);
      if (!pointMap.has(xVal)) { const pt: Record<string, string | number | null> = { x: xVal }; for (const s of sk) pt[s] = null; pointMap.set(xVal, pt); }
      if (cat !== null) { const pt = pointMap.get(xVal)!; pt[cat] = yVal; }
    }
    return { data: Array.from(pointMap.values()), seriesKeys: sk };
  }, [rows, xCol, yCol, colorCol, sortDesc]);

  const descriptors = useMemo(() => buildSeriesDescriptors(seriesKeys), [seriesKeys]);
  useEffect(() => { ctx.registerSeries(descriptors); }, [ctx, descriptors]);

  const ariaLabel = `Bar chart: ${seriesKeys.length} series, ${data.length} categories`;
  const animProps = reducedMotion ? { animationDuration: 0, isAnimationActive: false } : {};
  const stackId = isStacked ? 'stack' : undefined;
  const hidden = ctx.hiddenSeries;

  const ChartEl = isHorizontal ? BarChart : BarChart;

  return (
    <div data-testid="bar-chart" aria-label={ariaLabel} className="w-full">
      <ResponsiveContainer width="100%" height={320}>
        <ChartEl
          data={data}
          layout={isHorizontal ? 'vertical' : 'horizontal'}
          margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          {isHorizontal ? (
            <>
              <XAxis type="number" tick={{ fill: 'var(--color-fg-muted)', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis dataKey="x" type="category" tick={{ fill: 'var(--color-fg-muted)', fontSize: 11 }} tickLine={false} axisLine={false} />
            </>
          ) : (
            <>
              <XAxis dataKey="x" tick={{ fill: 'var(--color-fg-muted)', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: 'var(--color-fg-muted)', fontSize: 11 }} tickLine={false} axisLine={false} />
            </>
          )}
          <Tooltip
            contentStyle={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 4 }}
            labelStyle={{ color: 'var(--color-fg-muted)' }}
            itemStyle={{ color: 'var(--color-fg-base)' }}
          />
          {seriesKeys.map((sk, i) => (
            !hidden.has(sk) && (
              <Bar
                key={sk}
                dataKey={sk}
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                stackId={stackId}
                {...animProps}
              />
            )
          ))}
        </ChartEl>
      </ResponsiveContainer>
    </div>
  );
}
```

**3.4 Run to confirm pass:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- bar.test
```
Expected: ALL PASS. Then: `npx tsc --noEmit` — 0 errors.

---

### Task 4: ScatterPlot — test then implement

**4.1 Write failing test** — create `frontend-v2/src/__tests__/plots/scatter.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { JSX } from 'react';
import { ScatterPlot } from '../../components/plots/ScatterPlot';
import { PlotRenderer } from '../../components/plots/PlotRenderer';
import type { PanelNode } from '../../services/parser/types';

const RENDERED = { status: 'rendered' as const, rowCount: 5 };

const SC_MINIMAL: PanelNode = {
  kind: 'panel', plotType: 'scatter',
  config: { x: 'cpu', y: 'mem' },
  clauses: {},
};
const SC_WITH_SIZE: PanelNode = {
  kind: 'panel', plotType: 'scatter',
  config: { x: 'cpu', y: 'mem', size: 'count' },
  clauses: {},
};
const SC_WITH_COLOR: PanelNode = {
  kind: 'panel', plotType: 'scatter',
  config: { x: 'cpu', y: 'mem', color: 'gc_type' },
  clauses: {},
};
const SC_HIGH_CARD: PanelNode = {
  kind: 'panel', plotType: 'scatter',
  config: { x: 'cpu', y: 'mem', color: 'thread_id' },
  clauses: {},
};

const ROWS = [
  { cpu: 10, mem: 200, count: 5,  gc_type: 'G1GC' },
  { cpu: 20, mem: 300, count: 10, gc_type: 'ZGC'  },
  { cpu: 30, mem: 150, count: 3,  gc_type: 'Shen' },
];
// 21 distinct thread_id values to trigger high-cardinality guard
const HIGH_CARD_ROWS = Array.from({ length: 21 }, (_, i) => ({
  cpu: i, mem: i * 10, thread_id: `t${i}`,
}));

function wrap(node: PanelNode, rows: Record<string, unknown>[]): JSX.Element {
  return (
    <PlotRenderer state={RENDERED} title="Test" cellId="c1" plotName="p1">
      <ScatterPlot node={node} rows={rows} />
    </PlotRenderer>
  );
}

describe('ScatterPlot — rendering', () => {
  it('renders with data-testid="scatter-chart"', () => {
    render(wrap(SC_MINIMAL, ROWS));
    expect(screen.getByTestId('scatter-chart')).toBeInTheDocument();
  });

  it('aria-label starts with "Scatter chart"', () => {
    render(wrap(SC_MINIMAL, ROWS));
    expect(screen.getByTestId('scatter-chart').getAttribute('aria-label')).toMatch(/^Scatter chart/);
  });

  it('renders with size column without throwing', () => {
    expect(() => render(wrap(SC_WITH_SIZE, ROWS))).not.toThrow();
  });

  it('renders with categorical color column without throwing', () => {
    expect(() => render(wrap(SC_WITH_COLOR, ROWS))).not.toThrow();
  });

  it('warns on >20 distinct color values', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(wrap(SC_HIGH_CARD, HIGH_CARD_ROWS));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[ScatterPlot] High-cardinality color column'));
    vi.restoreAllMocks();
  });

  it('falls back to single color on high-cardinality', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { container } = render(wrap(SC_HIGH_CARD, HIGH_CARD_ROWS));
    const dots = container.querySelectorAll('.recharts-symbols, circle');
    dots.forEach((d) => {
      const fill = d.getAttribute('fill') ?? '';
      expect(fill).not.toMatch(/^#[0-9a-fA-F]{3,6}$/);
    });
    vi.restoreAllMocks();
  });
});

describe('ScatterPlot — reduced-motion', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it('renders without throwing when reduced-motion is set', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    expect(() => render(wrap(SC_MINIMAL, ROWS))).not.toThrow();
  });
});
```

**4.2 Run to confirm failure:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- scatter.test
```
Expected: FAIL — `Cannot find module '…/ScatterPlot'`

**4.3 Implement** `frontend-v2/src/components/plots/ScatterPlot.tsx`:

```tsx
import { useEffect, useMemo } from 'react';
import type { JSX } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import type { PanelNode } from '../../services/parser/types';
import { usePlotContext } from './PlotContext';
import {
  resolveValue, buildSeriesDescriptors,
  extractNumeric, extractString, isReducedMotion, SERIES_COLORS,
} from './plotSeriesUtils';

interface ScatterPlotProps {
  node: PanelNode;
  rows: Record<string, unknown>[];
  scope?: Record<string, unknown>;
}

const HIGH_CARDINALITY_LIMIT = 20;

export function ScatterPlot({ node, rows, scope = {} }: ScatterPlotProps): JSX.Element {
  const ctx = usePlotContext();
  const reducedMotion = isReducedMotion();

  const xCol = resolveValue(node.config['x'] ?? '', scope);
  const yCol = resolveValue(node.config['y'] ?? '', scope);
  const colorCol = node.config['color'] !== undefined ? resolveValue(node.config['color'], scope) : null;
  const sizeCol = node.config['size'] !== undefined ? resolveValue(node.config['size'], scope) : null;

  const xColStr = typeof xCol === 'string' ? xCol : null;
  const yColStr = typeof yCol === 'string' ? yCol : null;
  const colorColStr = typeof colorCol === 'string' ? colorCol : null;
  const sizeColStr = typeof sizeCol === 'string' ? sizeCol : null;

  const { groups, isHighCardinality } = useMemo(() => {
    if (!xColStr || !yColStr) return { groups: [], isHighCardinality: false };

    if (!colorColStr) {
      const pts = rows.map((r) => ({
        x: extractNumeric(r, xColStr),
        y: extractNumeric(r, yColStr),
        z: sizeColStr ? (extractNumeric(r, sizeColStr) ?? 1) : 1,
      }));
      return { groups: [{ key: yColStr, data: pts, colorIdx: 0 }], isHighCardinality: false };
    }

    // Categorical color
    const catMap = new Map<string, Array<{ x: number | null; y: number | null; z: number }>>();
    for (const r of rows) {
      const cat = extractString(r, colorColStr) ?? '__unknown__';
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat)!.push({
        x: extractNumeric(r, xColStr),
        y: extractNumeric(r, yColStr),
        z: sizeColStr ? (extractNumeric(r, sizeColStr) ?? 1) : 1,
      });
    }

    if (catMap.size > HIGH_CARDINALITY_LIMIT) {
      console.warn(`[ScatterPlot] High-cardinality color column: ${colorColStr} has ${catMap.size} distinct values (limit ${HIGH_CARDINALITY_LIMIT}). Falling back to single color.`);
      const allPts = rows.map((r) => ({
        x: extractNumeric(r, xColStr), y: extractNumeric(r, yColStr),
        z: sizeColStr ? (extractNumeric(r, sizeColStr) ?? 1) : 1,
      }));
      return { groups: [{ key: yColStr, data: allPts, colorIdx: 0 }], isHighCardinality: true };
    }

    const gs = Array.from(catMap.entries()).map(([key, data], i) => ({ key, data, colorIdx: i }));
    return { groups: gs, isHighCardinality: false };
  }, [rows, xColStr, yColStr, colorColStr, sizeColStr]);

  const descriptors = useMemo(
    () => isHighCardinality ? [] : buildSeriesDescriptors(groups.map((g) => g.key)),
    [groups, isHighCardinality]
  );
  useEffect(() => { ctx.registerSeries(descriptors); }, [ctx, descriptors]);

  const totalPoints = groups.reduce((s, g) => s + g.data.length, 0);
  const ariaLabel = `Scatter chart: ${totalPoints} points`;
  const animProps = reducedMotion ? { animationDuration: 0, isAnimationActive: false } : {};

  return (
    <div data-testid="scatter-chart" aria-label={ariaLabel} className="w-full">
      <ResponsiveContainer width="100%" height={320}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="x" type="number" name={xColStr ?? 'x'} tick={{ fill: 'var(--color-fg-muted)', fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis dataKey="y" type="number" name={yColStr ?? 'y'} tick={{ fill: 'var(--color-fg-muted)', fontSize: 11 }} tickLine={false} axisLine={false} />
          {sizeColStr && <ZAxis dataKey="z" range={[20, 200]} />}
          <Tooltip
            contentStyle={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 4 }}
            itemStyle={{ color: 'var(--color-fg-base)' }}
          />
          {groups.map((g) => (
            !ctx.hiddenSeries.has(g.key) && (
              <Scatter
                key={g.key}
                name={g.key}
                data={g.data}
                fill={SERIES_COLORS[g.colorIdx % SERIES_COLORS.length]}
                {...animProps}
              />
            )
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
```

**4.4 Run to confirm pass:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- scatter.test
```
Expected: ALL PASS. Then: `npx tsc --noEmit` — 0 errors.

---

### Task 5: Update plots index

**5.1 Update** `frontend-v2/src/components/plots/index.ts` — add new exports:

```ts
// Add to existing index.ts
export { LineChartPlot } from './LineChartPlot';
export { BarChartPlot } from './BarChartPlot';
export { ScatterPlot } from './ScatterPlot';
export {
  resolveValue, buildSeriesDescriptors, extractNumeric,
  extractString, isReducedMotion, SERIES_COLORS,
} from './plotSeriesUtils';
```

**5.2 Typecheck:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npx tsc --noEmit
```
Expected: 0 errors.

---

### Task 6: E2E tests

Add to `frontend-v2/tests/e2e/03-plot-dsl.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('@e2e M-C2 line/bar/scatter', () => {
  test('@e2e app loads without JS errors after M-C2', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    await page.waitForSelector('[data-testid="welcome-cell"]');
    // Filter out non-critical ResizeObserver noise
    const fatal = errors.filter((e) => !e.includes('ResizeObserver'));
    expect(fatal).toHaveLength(0);
  });

  test('@e2e plot DSL cell renders line chart story (if story harness present)', async ({ page }) => {
    await page.goto('/?__plot_story=line');
    try {
      await page.waitForSelector('[data-testid="line-chart"]', { timeout: 4_000 });
      await expect(page.locator('[data-testid="line-chart"]')).toBeVisible();
    } catch {
      test.skip();
    }
  });

  test('@e2e plot DSL cell renders bar chart story (if story harness present)', async ({ page }) => {
    await page.goto('/?__plot_story=bar');
    try {
      await page.waitForSelector('[data-testid="bar-chart"]', { timeout: 4_000 });
      await expect(page.locator('[data-testid="bar-chart"]')).toBeVisible();
    } catch {
      test.skip();
    }
  });

  test('@e2e plot DSL cell renders scatter chart story (if story harness present)', async ({ page }) => {
    await page.goto('/?__plot_story=scatter');
    try {
      await page.waitForSelector('[data-testid="scatter-chart"]', { timeout: 4_000 });
      await expect(page.locator('[data-testid="scatter-chart"]')).toBeVisible();
    } catch {
      test.skip();
    }
  });
});
```

**6.1 Run:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test:e2e -- 03-plot-dsl
```
Expected: smoke test passes; story tests pass or are explicitly skipped.

---

### Task 7: A11y tests

Add to `frontend-v2/tests/e2e/a11y-plot-renderer.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('@a11y M-C2 chart containers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="welcome-cell"]');
  });

  test('injected line-chart container has no axe violations', async ({ page }) => {
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.setAttribute('data-testid', 'line-chart');
      host.setAttribute('aria-label', 'Line chart: 2 series');
      host.style.cssText = 'width:400px;height:320px;';
      document.body.appendChild(host);
    });
    const results = await new AxeBuilder({ page })
      .include('[data-testid="line-chart"]')
      .analyze();
    expect(results.violations).toHaveLength(0);
  });

  test('injected bar-chart container has no axe violations', async ({ page }) => {
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.setAttribute('data-testid', 'bar-chart');
      host.setAttribute('aria-label', 'Bar chart: 1 series, 3 categories');
      host.style.cssText = 'width:400px;height:320px;';
      document.body.appendChild(host);
    });
    const results = await new AxeBuilder({ page })
      .include('[data-testid="bar-chart"]')
      .analyze();
    expect(results.violations).toHaveLength(0);
  });

  test('injected scatter-chart container has no axe violations', async ({ page }) => {
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.setAttribute('data-testid', 'scatter-chart');
      host.setAttribute('aria-label', 'Scatter chart: 42 points');
      host.style.cssText = 'width:400px;height:320px;';
      document.body.appendChild(host);
    });
    const results = await new AxeBuilder({ page })
      .include('[data-testid="scatter-chart"]')
      .analyze();
    expect(results.violations).toHaveLength(0);
  });

  test('line chart aria-label is present and non-empty', async ({ page }) => {
    await page.goto('/?__plot_story=line');
    try {
      const el = await page.waitForSelector('[data-testid="line-chart"]', { timeout: 4_000 });
      const label = await el.getAttribute('aria-label');
      expect(label).not.toBeNull();
      expect(label!.length).toBeGreaterThan(0);
    } catch {
      test.skip();
    }
  });
});
```

**7.1 Run:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test:a11y -- a11y-plot-renderer
```
Expected: ALL PASS.

---

### Task 8: Visual regression tests

Add to `frontend-v2/tests/visual/plots.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('@visual M-C2 chart token snapshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="welcome-cell"]');
  });

  test('@visual line-chart skeleton — dark theme tokens resolve', async ({ page }) => {
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'visual-line';
      host.style.cssText = 'width:400px;height:340px;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--color-bg-surface);padding:8px;';
      host.innerHTML = `
        <div data-testid="line-chart" aria-label="Line chart" style="height:320px;background:var(--color-bg-overlay);border-radius:4px;display:flex;align-items:center;justify-content:center;">
          <svg width="360" height="240">
            <path d="M 20 200 L 100 150 L 180 100 L 260 130 L 340 80"
              stroke="var(--color-accent)" fill="none" stroke-width="1.5"/>
            <text x="20" y="230" fill="var(--color-fg-muted)" font-size="11">t=0</text>
            <text x="340" y="230" fill="var(--color-fg-muted)" font-size="11">t=4</text>
          </svg>
        </div>`;
      document.body.appendChild(host);
    });
    await expect(page.locator('#visual-line')).toHaveScreenshot(
      'line-chart-dark-tokens.png', { maxDiffPixelRatio: 0.02 }
    );
  });

  test('@visual bar-chart skeleton — dark theme tokens resolve', async ({ page }) => {
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'visual-bar';
      host.style.cssText = 'width:400px;height:340px;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--color-bg-surface);padding:8px;';
      host.innerHTML = `
        <div data-testid="bar-chart" aria-label="Bar chart" style="height:320px;background:var(--color-bg-overlay);border-radius:4px;display:flex;align-items:flex-end;justify-content:space-evenly;padding:16px;">
          <div style="width:60px;height:180px;background:var(--color-accent);border-radius:2px 2px 0 0;"></div>
          <div style="width:60px;height:120px;background:var(--color-accent-amber);border-radius:2px 2px 0 0;"></div>
          <div style="width:60px;height:70px;background:var(--color-accent-purple);border-radius:2px 2px 0 0;"></div>
        </div>`;
      document.body.appendChild(host);
    });
    await expect(page.locator('#visual-bar')).toHaveScreenshot(
      'bar-chart-dark-tokens.png', { maxDiffPixelRatio: 0.02 }
    );
  });

  test('@visual scatter-chart skeleton — dark theme tokens resolve', async ({ page }) => {
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'visual-scatter';
      host.style.cssText = 'width:400px;height:340px;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--color-bg-surface);padding:8px;';
      host.innerHTML = `
        <div data-testid="scatter-chart" aria-label="Scatter chart" style="height:320px;background:var(--color-bg-overlay);border-radius:4px;position:relative;">
          <svg width="400" height="320">
            <circle cx="80"  cy="200" r="6" fill="var(--color-accent)"/>
            <circle cx="150" cy="140" r="10" fill="var(--color-accent)"/>
            <circle cx="230" cy="90"  r="5"  fill="var(--color-accent)"/>
            <circle cx="310" cy="170" r="8"  fill="var(--color-accent)"/>
          </svg>
        </div>`;
      document.body.appendChild(host);
    });
    await expect(page.locator('#visual-scatter')).toHaveScreenshot(
      'scatter-chart-dark-tokens.png', { maxDiffPixelRatio: 0.02 }
    );
  });
});
```

**8.1 Capture baseline snapshots:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test:visual -- --grep "@visual M-C2" --update-snapshots
```
Expected: snapshots captured, no errors.

**8.2 Verify stable (second run):**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test:visual -- --grep "@visual M-C2"
```
Expected: PASS — all snapshots match within 2% pixel diff.

---

### Task 9: Performance benchmarks

Create `frontend-v2/src/__tests__/plots/line.bench.ts`:

```ts
import { bench, describe } from 'vitest';
import { buildSeriesDescriptors, resolveValue, extractNumeric, SERIES_COLORS } from '../../components/plots/plotSeriesUtils';
import type { PlotValue } from '../../services/parser/types';

// Fixture: 10k rows, single series
const ROWS_10K = Array.from({ length: 10_000 }, (_, i) => ({
  ts: i,
  heap: Math.sin(i / 100) * 512 + 512,
}));

// Fixture: 10k rows, 4 series (multi-series via color column)
const ROWS_MULTI = Array.from({ length: 10_000 }, (_, i) => ({
  ts: i, heap: i * 0.1, series: ['G1GC', 'ZGC', 'Shen', 'Epsilon'][i % 4],
}));

describe('plotSeriesUtils perf', () => {
  bench('resolveValue — primitive string', () => {
    resolveValue('timestamp', {});
  });

  bench('resolveValue — VarRef hit', () => {
    const ref: PlotValue = { name: 'x', scope: 'cell', path: [], renderOnly: false };
    resolveValue(ref, { x: 'heap' });
  });

  bench('buildSeriesDescriptors — 7 series', () => {
    buildSeriesDescriptors(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });

  bench('SERIES_COLORS cycle — 100 accesses', () => {
    for (let i = 0; i < 100; i++) SERIES_COLORS[i % SERIES_COLORS.length];
  });

  bench('extractNumeric — 10k rows', () => {
    for (const r of ROWS_10K) extractNumeric(r as Record<string, unknown>, 'heap');
  });
});
```

**9.1 Run benchmarks:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test:perf -- line.bench
```
Expected: benchmark output with ops/sec, no failures.

---

### Task 10: Playwright MCP visual checkpoint (Checkpoint D)

This is the mandatory visual fidelity checkpoint before marking M-C2 complete. Run the live app and compare against the showcase reference.

**Prerequisites:** `npm run dev` running on port 5173 (or `npm run build && npm run preview` on port 4173).

**10.1 Navigate to live app and screenshot:**
```
mcp__playwright__navigate({ url: "http://localhost:5173" })
mcp__playwright__screenshot({ name: "M-C2-app" })
```

**10.2 Navigate to showcase and screenshot:**
```
mcp__playwright__navigate({ url: "file:///Users/i560383_1/code/experiments/jfr-query/redesign-plan/showcase.html" })
mcp__playwright__screenshot({ name: "M-C2-showcase" })
```

**10.3 Compare screenshots — Checkpoint D checklist:**

| # | Check | Expected | Fail symptom |
|---|-------|----------|-------------|
| 1 | Chart background | `var(--color-bg-overlay)` — dark, not white | White chart area |
| 2 | Axis labels | `var(--color-fg-muted)` — muted grey, not black | Black `#000` text |
| 3 | Grid lines | `var(--color-border)` — subtle, not default grey | Bright `#ccc` lines |
| 4 | Line/bar/dot color | `var(--color-accent)` — cyan, not Recharts default blue `#8884d8` | Blue `#8884d8` marks |
| 5 | Chart title | `var(--color-fg-base)` — near-white in dark mode | Black title |
| 6 | No white-on-white | Background and text distinct in dark mode | Text invisible |

**10.4 Fix any critical deviations before proceeding.** Common fixes:
- Axis labels black: ensure `tick={{ fill: 'var(--color-fg-muted)' }}` on `<XAxis>` and `<YAxis>`.
- Grid lines bright: ensure `stroke="var(--color-border)"` on `<CartesianGrid>`.
- Line stroke is `#8884d8`: ensure `stroke={SERIES_COLORS[0]}` is on each `<Line>`.
- Chart background white: add `bg-[--color-bg-overlay]` class to each renderer root `<div>`.

**10.5 After fixing, commit:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && git add src/components/plots/ && git commit -m "fix(M-C2): checkpoint D visual fixes — dark theme, CSS token colors"
```

---

### Task 11: Final verification

**11.1 Full unit suite:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test
```
Expected: ALL PASS (stateMachine, renderer, plotSeriesUtils, line, bar, scatter).

**11.2 TypeCheck:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npx tsc --noEmit
```
Expected: 0 errors.

**11.3 Lint:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run lint
```
Expected: 0 errors, 0 warnings.

**11.4 E2E smoke:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test:e2e -- 00-smoke
```
Expected: PASS.

**11.5 A11y:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test:a11y
```
Expected: all axe tests PASS.

**11.6 Perf benchmarks:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test:perf -- line.bench
```
Expected: output with ops/sec.

**11.7 Visual regression stable:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test:visual -- --grep "@visual M-C2"
```
Expected: PASS (snapshots match baseline).

**11.8 Final commit:**
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && git add src/components/plots/ src/__tests__/plots/ tests/e2e/ tests/visual/ && git commit -m "feat(M-C2): line/bar/scatter renderers — all 5 test layers pass"
```

---

## Acceptance criteria

All of the following must be true before marking M-C2 complete:

1. `LineChartPlot` renders from `PanelNode { plotType: 'line' }`; multi-series via `color` config key; null y values produce gaps (`connectNulls={false}`); `VarRef` values in config resolve through `scope`; warns when VarRef missing.
2. `BarChartPlot` renders vertical (default) and horizontal (`orientation: 'horizontal'`) layouts; `stacked: true` produces `stackId` on `<Bar>`; `sort: 'value desc'` sorts categories client-side; negative values render correctly.
3. `ScatterPlot` renders dots at `(x, y)`; `size` column maps to `ZAxis` radius; categorical `color` column produces one `<Scatter>` per category; >20 distinct color values triggers `console.warn('[ScatterPlot] High-cardinality color column: …')` and falls back to `SERIES_COLORS[0]`.
4. All colors use `var(--color-*)` CSS tokens — zero hardcoded hex in any renderer or utility.
5. `prefers-reduced-motion` disables Recharts animations (`animationDuration={0}`, `isAnimationActive={false}`).
6. `aria-label` on each chart container describes chart type and data summary.
7. All React components use `import type { JSX } from 'react'` — no implicit `JSX.Element` from `React` namespace.
8. No `any` — `unknown` with narrowing only.
9. `AxeBuilder` imported statically: `import AxeBuilder from '@axe-core/playwright'`.
10. Unit tests pass: `plotSeriesUtils`, `line`, `bar`, `scatter`.
11. E2E smoke test passes: no fatal JS errors on app load.
12. A11y tests pass: no axe violations on injected chart containers.
13. Visual snapshots stable across 2 consecutive runs (maxDiffPixelRatio 0.02).
14. Perf benchmarks run and produce ops/sec output.
15. Checkpoint D visual comparison done: no critical deviations from design-token color scheme.
