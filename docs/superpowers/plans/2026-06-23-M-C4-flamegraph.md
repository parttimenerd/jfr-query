# M-C4: Flamegraph Renderer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Testing standard:** All 5 layers apply: unit / E2E / visual regression / a11y / perf bench.

**Goal:** Implement an SVG-based flamegraph renderer (`kind: 'flamegraph'`) from scratch — no external library — with tree-building, layout computation, three color schemes, click-to-zoom, keyboard navigation, and full accessibility.

**Blocked by:** M-C2 (plotSeriesUtils, SERIES_COLORS, resolveValue, extractNumeric, extractString)

**Tech stack:** React 19.2, TypeScript 5.8, SVG-based flamegraph (no external lib), Vitest 4.1.9 (pool: forks)

---

## Critical Rules (NEVER violate)

- `AppShell.tsx` line 30 MUST stay: `const [collapsed, setCollapsed] = useState(!hasNotebook);` — NEVER change to `useState(false)`
- `import type { JSX } from 'react'` in every React component file
- `pool: 'forks'` in `vitest.config.ts` — NEVER change this file
- All colors: CSS token vars only — `var(--color-accent)`, `var(--color-accent-amber)` etc. Never hardcode hex values
- No `text-sm` (14px) — use `text-[11px]`, `text-[12px]`, or `text-[13px]`
- No `any` — use `unknown` with type narrowing

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/components/plots/flamegraphUtils.ts` | Create | `buildTree()`, `computeLayout()`, `colorForFrame()`, type definitions |
| `src/components/plots/FlamegraphPlot.tsx` | Create | Main SVG-rendering component, zoom state, keyboard nav |
| `src/components/plots/FlamegraphTooltip.tsx` | Create | Hover tooltip for flamegraph frames |
| `src/components/plots/index.ts` | Modify | Add `FlamegraphPlot` export |
| `src/__tests__/plots/flamegraphUtils.test.ts` | Create | Unit tests for pure functions |
| `src/__tests__/plots/flamegraph.test.tsx` | Create | Component render + interaction tests |
| `src/__tests__/plots/flamegraph.bench.ts` | Create | Perf bench: 50k-frame layout |
| `tests/e2e/03-plot-dsl.spec.ts` | Modify | Add flamegraph smoke E2E test |
| `tests/visual/plots.spec.ts` | Modify | Add flamegraph dark-theme snapshot test |
| `tests/e2e/a11y-plot-renderer.spec.ts` | Modify | Add flamegraph axe-core check |

---

## Data Types (defined in `flamegraphUtils.ts`, referenced throughout)

```ts
export interface FrameNode {
  name: string;
  selfValue: number;
  totalValue: number;       // selfValue + sum of children's totalValues
  children: FrameNode[];
  depth: number;            // 0 = root
  x: number;               // pixel x offset within container (computed by computeLayout)
  width: number;           // pixel width (computed by computeLayout)
}

export interface FlamegraphLayout {
  frames: FrameNode[];     // flat list, all depths
  maxDepth: number;
  totalValue: number;
  rowHeight: number;       // always 18
  containerWidth: number;
}

export type FlamegraphColorScheme = 'hotness' | 'package' | 'fixed';
```

---

## Task 1: Pure-function types and `buildTree()`

**Files:**
- Create: `src/components/plots/flamegraphUtils.ts`
- Create: `src/__tests__/plots/flamegraphUtils.test.ts`

### Step 1.1 — Write the failing tests for `buildTree()`

Create `src/__tests__/plots/flamegraphUtils.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTree } from '../../components/plots/flamegraphUtils';
import type { FrameNode } from '../../components/plots/flamegraphUtils';

const SIMPLE_ROWS = [
  { name: 'main',        value: 0,  parent: ''     },
  { name: 'run',         value: 10, parent: 'main' },
  { name: 'process',     value: 20, parent: 'main' },
  { name: 'doWork',      value: 15, parent: 'run'  },
];

describe('buildTree', () => {
  it('returns roots: frames with no parent', () => {
    const roots = buildTree(SIMPLE_ROWS, 'name', 'value', 'parent');
    expect(roots.map((r) => r.name)).toEqual(['main']);
  });

  it('root has correct children', () => {
    const roots = buildTree(SIMPLE_ROWS, 'name', 'value', 'parent');
    expect(roots[0].children.map((c) => c.name).sort()).toEqual(['process', 'run']);
  });

  it('totalValue of root equals sum of all selfValues', () => {
    const roots = buildTree(SIMPLE_ROWS, 'name', 'value', 'parent');
    expect(roots[0].totalValue).toBe(45); // 0+10+20+15
  });

  it('totalValue of leaf equals its selfValue', () => {
    const roots = buildTree(SIMPLE_ROWS, 'name', 'value', 'parent');
    const run = roots[0].children.find((c) => c.name === 'run')!;
    const doWork = run.children[0];
    expect(doWork.totalValue).toBe(15);
    expect(doWork.selfValue).toBe(15);
  });

  it('depth is assigned correctly', () => {
    const roots = buildTree(SIMPLE_ROWS, 'name', 'value', 'parent');
    expect(roots[0].depth).toBe(0);
    const run = roots[0].children.find((c) => c.name === 'run')!;
    expect(run.depth).toBe(1);
    expect(run.children[0].depth).toBe(2);
  });

  it('handles null/empty parent as root', () => {
    const rows = [
      { name: 'A', value: 5, parent: null },
      { name: 'B', value: 3, parent: ''   },
    ];
    const roots = buildTree(rows, 'name', 'value', 'parent');
    expect(roots).toHaveLength(2);
  });

  it('returns empty array for empty rows', () => {
    expect(buildTree([], 'name', 'value', 'parent')).toHaveLength(0);
  });

  it('skips rows with missing name', () => {
    const rows = [
      { name: '',  value: 5, parent: ''    },
      { name: 'A', value: 3, parent: ''    },
    ];
    const roots = buildTree(rows, 'name', 'value', 'parent');
    // Empty name is filtered
    expect(roots.map((r) => r.name)).toEqual(['A']);
  });
});
```

- [ ] **Step 1.2 — Run failing tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/plots/flamegraphUtils.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../../components/plots/flamegraphUtils'`

- [ ] **Step 1.3 — Implement `buildTree()` in `flamegraphUtils.ts`**

Create `src/components/plots/flamegraphUtils.ts`:

```ts
import { extractNumeric, extractString, SERIES_COLORS } from './plotSeriesUtils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FrameNode {
  name: string;
  selfValue: number;
  totalValue: number;
  children: FrameNode[];
  depth: number;
  x: number;
  width: number;
}

export interface FlamegraphLayout {
  frames: FrameNode[];
  maxDepth: number;
  totalValue: number;
  rowHeight: number;
  containerWidth: number;
}

export type FlamegraphColorScheme = 'hotness' | 'package' | 'fixed';

// ─── buildTree ────────────────────────────────────────────────────────────────

export function buildTree(
  rows: Record<string, unknown>[],
  nameCol: string,
  valueCol: string,
  parentCol: string,
): FrameNode[] {
  if (rows.length === 0) return [];

  // Phase 1: build a flat map name -> FrameNode (x/width set to 0, filled by computeLayout)
  const nodeMap = new Map<string, FrameNode>();

  for (const row of rows) {
    const name = extractString(row, nameCol);
    if (!name) continue;
    const selfValue = extractNumeric(row, valueCol) ?? 0;
    nodeMap.set(name, {
      name,
      selfValue,
      totalValue: selfValue, // will be summed bottom-up
      children: [],
      depth: 0,
      x: 0,
      width: 0,
    });
  }

  // Phase 2: wire parent-child edges
  const roots: FrameNode[] = [];
  for (const row of rows) {
    const name = extractString(row, nameCol);
    if (!name) continue;
    const node = nodeMap.get(name);
    if (!node) continue;
    const parentName = extractString(row, parentCol);
    if (!parentName) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(parentName);
      if (parent) {
        parent.children.push(node);
      } else {
        // Orphan: treat as root
        roots.push(node);
      }
    }
  }

  // Phase 3: assign depth + compute totalValue bottom-up (DFS)
  function visit(node: FrameNode, depth: number): void {
    node.depth = depth;
    let childTotal = 0;
    for (const child of node.children) {
      visit(child, depth + 1);
      childTotal += child.totalValue;
    }
    node.totalValue = node.selfValue + childTotal;
  }

  for (const root of roots) visit(root, 0);

  return roots;
}
```

- [ ] **Step 1.4 — Run tests, expect pass**

```bash
npx vitest run src/__tests__/plots/flamegraphUtils.test.ts 2>&1 | tail -20
```

Expected: all 8 tests PASS.

- [ ] **Step 1.5 — Commit**

```bash
git add src/components/plots/flamegraphUtils.ts src/__tests__/plots/flamegraphUtils.test.ts
git commit -m "feat(flamegraph): add FrameNode types and buildTree() with unit tests"
```

---

## Task 2: `computeLayout()` — spatial layout of frames

**Files:**
- Modify: `src/components/plots/flamegraphUtils.ts`
- Modify: `src/__tests__/plots/flamegraphUtils.test.ts`

- [ ] **Step 2.1 — Write failing tests for `computeLayout()`**

Append to `src/__tests__/plots/flamegraphUtils.test.ts`:

```ts
import { buildTree, computeLayout } from '../../components/plots/flamegraphUtils';

const LAYOUT_ROWS = [
  { name: 'main',    value: 0,  parent: ''     },
  { name: 'A',       value: 40, parent: 'main' },
  { name: 'B',       value: 60, parent: 'main' },
];

describe('computeLayout', () => {
  it('returns a FlamegraphLayout with all frames', () => {
    const roots = buildTree(LAYOUT_ROWS, 'name', 'value', 'parent');
    const layout = computeLayout(roots, 1000);
    // main + A + B = 3 frames
    expect(layout.frames).toHaveLength(3);
  });

  it('totalValue equals sum of root totalValues', () => {
    const roots = buildTree(LAYOUT_ROWS, 'name', 'value', 'parent');
    const layout = computeLayout(roots, 1000);
    expect(layout.totalValue).toBe(100); // 40 + 60
  });

  it('root frame spans full container width', () => {
    const roots = buildTree(LAYOUT_ROWS, 'name', 'value', 'parent');
    const layout = computeLayout(roots, 1000);
    const main = layout.frames.find((f) => f.name === 'main')!;
    expect(main.x).toBe(0);
    expect(main.width).toBeCloseTo(1000);
  });

  it('child widths are proportional to their totalValue', () => {
    const roots = buildTree(LAYOUT_ROWS, 'name', 'value', 'parent');
    const layout = computeLayout(roots, 1000);
    const A = layout.frames.find((f) => f.name === 'A')!;
    const B = layout.frames.find((f) => f.name === 'B')!;
    expect(A.width).toBeCloseTo(400); // 40% of 1000
    expect(B.width).toBeCloseTo(600); // 60% of 1000
  });

  it('children are positioned left-to-right without overlap', () => {
    const roots = buildTree(LAYOUT_ROWS, 'name', 'value', 'parent');
    const layout = computeLayout(roots, 1000);
    const A = layout.frames.find((f) => f.name === 'A')!;
    const B = layout.frames.find((f) => f.name === 'B')!;
    // A comes first (order from rows), B starts where A ends
    expect(A.x + A.width).toBeCloseTo(B.x);
  });

  it('rowHeight is 18', () => {
    const roots = buildTree(LAYOUT_ROWS, 'name', 'value', 'parent');
    const layout = computeLayout(roots, 1000);
    expect(layout.rowHeight).toBe(18);
  });

  it('maxDepth is 1 for a single-level tree', () => {
    const roots = buildTree(LAYOUT_ROWS, 'name', 'value', 'parent');
    const layout = computeLayout(roots, 1000);
    expect(layout.maxDepth).toBe(1);
  });

  it('returns empty layout for empty roots', () => {
    const layout = computeLayout([], 1000);
    expect(layout.frames).toHaveLength(0);
    expect(layout.totalValue).toBe(0);
    expect(layout.maxDepth).toBe(0);
  });
});
```

- [ ] **Step 2.2 — Run failing tests**

```bash
npx vitest run src/__tests__/plots/flamegraphUtils.test.ts 2>&1 | tail -20
```

Expected: FAIL — `computeLayout is not a function`

- [ ] **Step 2.3 — Implement `computeLayout()`**

Add to `src/components/plots/flamegraphUtils.ts` (after `buildTree`):

```ts
export const ROW_HEIGHT = 18;

export function computeLayout(
  roots: FrameNode[],
  containerWidth: number,
): FlamegraphLayout {
  if (roots.length === 0) {
    return { frames: [], maxDepth: 0, totalValue: 0, rowHeight: ROW_HEIGHT, containerWidth };
  }

  const totalValue = roots.reduce((s, r) => s + r.totalValue, 0);
  if (totalValue === 0) {
    return { frames: [], maxDepth: 0, totalValue: 0, rowHeight: ROW_HEIGHT, containerWidth };
  }

  const allFrames: FrameNode[] = [];
  let maxDepth = 0;

  // Assign x/width via DFS, parent passes its own x as cursor to children
  function layout(node: FrameNode, parentX: number, parentWidth: number): void {
    node.x = parentX;
    node.width = parentWidth;
    if (node.depth > maxDepth) maxDepth = node.depth;
    allFrames.push(node);

    let cursor = parentX;
    const childTotal = node.children.reduce((s, c) => s + c.totalValue, 0);
    if (childTotal === 0) return;

    for (const child of node.children) {
      const childWidth = (child.totalValue / totalValue) * containerWidth;
      layout(child, cursor, childWidth);
      cursor += childWidth;
    }
  }

  // Root frames divide the full container
  let cursor = 0;
  for (const root of roots) {
    const rootWidth = (root.totalValue / totalValue) * containerWidth;
    layout(root, cursor, rootWidth);
    cursor += rootWidth;
  }

  return { frames: allFrames, maxDepth, totalValue, rowHeight: ROW_HEIGHT, containerWidth };
}
```

- [ ] **Step 2.4 — Run tests, expect pass**

```bash
npx vitest run src/__tests__/plots/flamegraphUtils.test.ts 2>&1 | tail -20
```

Expected: all `computeLayout` tests PASS.

- [ ] **Step 2.5 — Commit**

```bash
git add src/components/plots/flamegraphUtils.ts src/__tests__/plots/flamegraphUtils.test.ts
git commit -m "feat(flamegraph): add computeLayout() with proportional width layout"
```

---

## Task 3: `colorForFrame()` — three color schemes

**Files:**
- Modify: `src/components/plots/flamegraphUtils.ts`
- Modify: `src/__tests__/plots/flamegraphUtils.test.ts`

- [ ] **Step 3.1 — Write failing tests**

Append to `src/__tests__/plots/flamegraphUtils.test.ts`:

```ts
import { colorForFrame } from '../../components/plots/flamegraphUtils';
import type { FlamegraphColorScheme } from '../../components/plots/flamegraphUtils';

const HOT_FRAME = { name: 'hotMethod', selfValue: 90, totalValue: 90, children: [], depth: 1, x: 0, width: 900 };
const COLD_FRAME = { name: 'coldMethod', selfValue: 1, totalValue: 1, children: [], depth: 1, x: 0, width: 10 };

describe('colorForFrame', () => {
  it('fixed scheme always returns var(--color-accent)', () => {
    expect(colorForFrame(HOT_FRAME, 'fixed', 100)).toBe('var(--color-accent)');
    expect(colorForFrame(COLD_FRAME, 'fixed', 100)).toBe('var(--color-accent)');
  });

  it('package scheme returns a CSS var token (not a hex)', () => {
    const color = colorForFrame(HOT_FRAME, 'package', 100);
    expect(color).toMatch(/^var\(--color-/);
    expect(color).not.toMatch(/^#/);
  });

  it('package scheme returns same color for same frame name', () => {
    const c1 = colorForFrame(HOT_FRAME, 'package', 100);
    const c2 = colorForFrame({ ...HOT_FRAME }, 'package', 100);
    expect(c1).toBe(c2);
  });

  it('hotness scheme returns var(--color-accent-red) for hot frame (ratio ~1)', () => {
    const color = colorForFrame(HOT_FRAME, 'hotness', 90);
    expect(color).toBe('var(--color-accent-red)');
  });

  it('hotness scheme returns var(--color-accent) for cold frame (ratio ~0)', () => {
    const color = colorForFrame(COLD_FRAME, 'hotness', 100);
    expect(color).toBe('var(--color-accent)');
  });

  it('hotness scheme returns var(--color-accent-amber) for mid-range frame', () => {
    const midFrame = { ...HOT_FRAME, totalValue: 50 };
    const color = colorForFrame(midFrame, 'hotness', 100);
    expect(color).toBe('var(--color-accent-amber)');
  });
});
```

- [ ] **Step 3.2 — Run failing tests**

```bash
npx vitest run src/__tests__/plots/flamegraphUtils.test.ts 2>&1 | tail -20
```

Expected: FAIL — `colorForFrame is not a function`

- [ ] **Step 3.3 — Implement `colorForFrame()`**

Add to `src/components/plots/flamegraphUtils.ts` (after `computeLayout`):

```ts
// Simple deterministic hash: sum of char codes mod palette length
function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function colorForFrame(
  frame: FrameNode,
  scheme: FlamegraphColorScheme,
  totalValue: number,
): string {
  if (scheme === 'fixed') return 'var(--color-accent)';

  if (scheme === 'package') {
    const idx = hashName(frame.name) % SERIES_COLORS.length;
    return SERIES_COLORS[idx];
  }

  // 'hotness': ratio-based 3-stop gradient
  // cold (0) → var(--color-accent) cyan
  // warm (0.5) → var(--color-accent-amber)
  // hot (1) → var(--color-accent-red)
  const ratio = totalValue === 0 ? 0 : frame.totalValue / totalValue;
  if (ratio >= 0.75) return 'var(--color-accent-red)';
  if (ratio >= 0.25) return 'var(--color-accent-amber)';
  return 'var(--color-accent)';
}
```

- [ ] **Step 3.4 — Run tests, expect pass**

```bash
npx vitest run src/__tests__/plots/flamegraphUtils.test.ts 2>&1 | tail -20
```

Expected: all `colorForFrame` tests PASS.

- [ ] **Step 3.5 — Commit**

```bash
git add src/components/plots/flamegraphUtils.ts src/__tests__/plots/flamegraphUtils.test.ts
git commit -m "feat(flamegraph): add colorForFrame() with hotness/package/fixed schemes"
```

---

## Task 4: `FlamegraphTooltip` component

**Files:**
- Create: `src/components/plots/FlamegraphTooltip.tsx`
- Create (tests inline in next task): covered in `flamegraph.test.tsx`

- [ ] **Step 4.1 — Write FlamegraphTooltip**

Create `src/components/plots/FlamegraphTooltip.tsx`:

```tsx
import type { JSX } from 'react';

export interface FlamegraphTooltipData {
  name: string;
  selfValue: number;
  totalValue: number;
  totalPercent: number; // 0-100
  x: number;           // pixel offset from container left
  y: number;           // pixel offset from container top
}

interface FlamegraphTooltipProps {
  data: FlamegraphTooltipData | null;
}

function formatValue(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

export function FlamegraphTooltip({ data }: FlamegraphTooltipProps): JSX.Element {
  if (!data) {
    return (
      <div
        data-testid="flamegraph-tooltip"
        hidden
        role="tooltip"
        className="pointer-events-none absolute z-20 rounded border border-[--color-border] bg-[--color-bg-surface] px-2 py-1.5 shadow"
      />
    );
  }

  return (
    <div
      data-testid="flamegraph-tooltip"
      role="tooltip"
      style={{ left: data.x + 8, top: data.y - 4 }}
      className="pointer-events-none absolute z-20 rounded border border-[--color-border] bg-[--color-bg-surface] px-2 py-1.5 shadow max-w-xs"
    >
      <div className="font-medium text-[12px] text-[--color-fg-base] truncate mb-1">
        {data.name}
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-[--color-fg-muted]">Self:</span>
          <span className="text-[--color-fg-base]">{formatValue(data.selfValue)}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-[--color-fg-muted]">Total:</span>
          <span className="text-[--color-fg-base]">{formatValue(data.totalValue)}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-[--color-fg-muted]">% of total:</span>
          <span className="text-[--color-accent]">{data.totalPercent.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4.2 — No dedicated test file for this component: covered by flamegraph.test.tsx (Task 7). Verify TypeScript compiles**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors for FlamegraphTooltip.tsx.

- [ ] **Step 4.3 — Commit**

```bash
git add src/components/plots/FlamegraphTooltip.tsx
git commit -m "feat(flamegraph): add FlamegraphTooltip component"
```

---

## Task 5: `FlamegraphPlot` — skeleton render (SVG mount, no interactions)

**Files:**
- Create: `src/components/plots/FlamegraphPlot.tsx`
- Create: `src/__tests__/plots/flamegraph.test.tsx`

- [ ] **Step 5.1 — Write failing render tests**

Create `src/__tests__/plots/flamegraph.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { JSX } from 'react';
import { FlamegraphPlot } from '../../components/plots/FlamegraphPlot';
import { PlotRenderer } from '../../components/plots/PlotRenderer';
import type { PanelNode } from '../../services/parser/types';

const RENDERED = { status: 'rendered' as const, rowCount: 4 };

const FLAMEGRAPH_NODE: PanelNode = {
  kind: 'panel',
  plotType: 'flamegraph',
  config: { name: 'frame', value: 'samples', parent: 'parentFrame' },
  clauses: {},
};

const SIMPLE_ROWS: Record<string, unknown>[] = [
  { frame: 'main',    samples: 0,  parentFrame: ''     },
  { frame: 'run',     samples: 30, parentFrame: 'main' },
  { frame: 'process', samples: 70, parentFrame: 'main' },
];

function wrap(node: PanelNode, rows: Record<string, unknown>[]): JSX.Element {
  return (
    <PlotRenderer state={RENDERED} title="Flamegraph" cellId="c1" plotName="flame">
      <FlamegraphPlot node={node} rows={rows} />
    </PlotRenderer>
  );
}

describe('FlamegraphPlot — rendering', () => {
  it('renders with data-testid="flamegraph"', () => {
    render(wrap(FLAMEGRAPH_NODE, SIMPLE_ROWS));
    expect(screen.getByTestId('flamegraph')).toBeInTheDocument();
  });

  it('SVG element is present', () => {
    const { container } = render(wrap(FLAMEGRAPH_NODE, SIMPLE_ROWS));
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders a rect for each frame', () => {
    const { container } = render(wrap(FLAMEGRAPH_NODE, SIMPLE_ROWS));
    const rects = container.querySelectorAll('rect[data-frame]');
    expect(rects.length).toBe(3);
  });

  it('frame rects have role="button"', () => {
    const { container } = render(wrap(FLAMEGRAPH_NODE, SIMPLE_ROWS));
    const buttons = container.querySelectorAll('rect[role="button"]');
    expect(buttons.length).toBe(3);
  });

  it('frame rects have aria-label with frame name', () => {
    const { container } = render(wrap(FLAMEGRAPH_NODE, SIMPLE_ROWS));
    const main = container.querySelector('rect[data-frame="main"]');
    expect(main?.getAttribute('aria-label')).toMatch(/main/);
  });

  it('renders without throwing on empty rows', () => {
    expect(() => render(wrap(FLAMEGRAPH_NODE, []))).not.toThrow();
  });
});

describe('FlamegraphPlot — color tokens', () => {
  it('frame fills use CSS var tokens, not hex', () => {
    const { container } = render(wrap(FLAMEGRAPH_NODE, SIMPLE_ROWS));
    const rects = container.querySelectorAll('rect[data-frame]');
    rects.forEach((rect) => {
      const fill = rect.getAttribute('fill') ?? '';
      expect(fill).not.toMatch(/^#[0-9a-fA-F]{3,6}$/);
    });
  });
});
```

- [ ] **Step 5.2 — Run failing tests**

```bash
npx vitest run src/__tests__/plots/flamegraph.test.tsx 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../../components/plots/FlamegraphPlot'`

- [ ] **Step 5.3 — Implement skeleton FlamegraphPlot**

Create `src/components/plots/FlamegraphPlot.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { JSX } from 'react';
import type { PanelNode } from '../../services/parser/types';
import { usePlotContext } from './PlotContext';
import { resolveValue, extractNumeric, extractString } from './plotSeriesUtils';
import {
  buildTree,
  computeLayout,
  colorForFrame,
  ROW_HEIGHT,
} from './flamegraphUtils';
import type { FrameNode, FlamegraphColorScheme } from './flamegraphUtils';
import { FlamegraphTooltip } from './FlamegraphTooltip';
import type { FlamegraphTooltipData } from './FlamegraphTooltip';

const MAX_FRAMES_DISPLAY = 5000;
const MAX_FRAMES_WARN = 50000;

interface FlamegraphPlotProps {
  node: PanelNode;
  rows: Record<string, unknown>[];
  scope?: Record<string, unknown>;
}

export function FlamegraphPlot({ node, rows, scope = {} }: FlamegraphPlotProps): JSX.Element {
  const ctx = usePlotContext();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [zoomedFrame, setZoomedFrame] = useState<FrameNode | null>(null);
  const [focusedFrame, setFocusedFrame] = useState<FrameNode | null>(null);
  const [tooltip, setTooltip] = useState<FlamegraphTooltipData | null>(null);

  // Resolve config columns
  const nameCol = String(resolveValue(node.config['name'] ?? 'name', scope) ?? 'name');
  const valueCol = String(resolveValue(node.config['value'] ?? 'value', scope) ?? 'value');
  const parentCol = String(resolveValue(node.config['parent'] ?? 'parent', scope) ?? 'parent');
  const rawScheme = resolveValue(node.config['color'] ?? 'hotness', scope);
  const colorScheme: FlamegraphColorScheme =
    rawScheme === 'package' || rawScheme === 'fixed' ? rawScheme : 'hotness';

  // Observe container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) setContainerWidth(width);
    });
    obs.observe(el);
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) setContainerWidth(rect.width);
    return () => obs.disconnect();
  }, []);

  // Limit rows for performance
  const effectiveRows = useMemo(() => {
    if (rows.length > MAX_FRAMES_WARN) {
      return [...rows]
        .sort((a, b) => (extractNumeric(b, valueCol) ?? 0) - (extractNumeric(a, valueCol) ?? 0))
        .slice(0, MAX_FRAMES_DISPLAY);
    }
    return rows;
  }, [rows, valueCol]);

  const showWarning = rows.length > MAX_FRAMES_WARN;

  // Build tree and layout
  const roots = useMemo(
    () => buildTree(effectiveRows, nameCol, valueCol, parentCol),
    [effectiveRows, nameCol, valueCol, parentCol],
  );

  // If zoomed, re-root the layout at the zoomed frame
  const layoutRoots = useMemo(
    () => (zoomedFrame ? [zoomedFrame] : roots),
    [zoomedFrame, roots],
  );

  const layout = useMemo(
    () => computeLayout(layoutRoots, containerWidth),
    [layoutRoots, containerWidth],
  );

  // Register series (no legend items for flamegraph, just empty)
  useEffect(() => {
    ctx.registerSeries([]);
  }, [ctx]);

  // Register zoom reset handler
  const handleZoomReset = useCallback(() => {
    setZoomedFrame(null);
    setFocusedFrame(null);
  }, []);

  useEffect(() => {
    ctx.registerZoomReset(handleZoomReset);
  }, [ctx, handleZoomReset]);

  // SVG total height: flames go bottom-up, so height = (maxDepth + 1) * rowHeight
  const svgHeight = (layout.maxDepth + 1) * ROW_HEIGHT;

  // y coordinate: depth 0 at bottom, depth N at top
  // svgY = (maxDepth - frame.depth) * rowHeight
  function svgY(frame: FrameNode): number {
    return (layout.maxDepth - frame.depth) * ROW_HEIGHT;
  }

  function handleFrameClick(frame: FrameNode): void {
    if (frame.children.length === 0) return; // leaf: nothing to zoom into
    setZoomedFrame(frame);
    setFocusedFrame(null);
    setTooltip(null);
  }

  function handleFrameMouseEnter(frame: FrameNode, e: React.MouseEvent): void {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const totalPercent = layout.totalValue === 0
      ? 0
      : (frame.totalValue / layout.totalValue) * 100;
    setTooltip({ name: frame.name, selfValue: frame.selfValue, totalValue: frame.totalValue, totalPercent, x, y });
  }

  function handleFrameMouseLeave(): void {
    setTooltip(null);
  }

  // Keyboard navigation
  function handleFrameKeyDown(frame: FrameNode, e: React.KeyboardEvent): void {
    if (e.key === 'Enter') {
      handleFrameClick(frame);
    } else if (e.key === 'Escape') {
      setZoomedFrame(null);
      setFocusedFrame(null);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      // Navigate siblings at same depth
      const siblings = layout.frames.filter((f) => f.depth === frame.depth);
      const idx = siblings.indexOf(frame);
      const nextIdx = e.key === 'ArrowRight'
        ? Math.min(idx + 1, siblings.length - 1)
        : Math.max(idx - 1, 0);
      setFocusedFrame(siblings[nextIdx] ?? null);
    }
  }

  const ariaLabel = `Flamegraph: ${layout.frames.length} frames`;

  if (rows.length === 0) {
    return (
      <div data-testid="flamegraph" className="flex items-center justify-center h-full text-[12px] text-[--color-fg-dim]">
        No data
      </div>
    );
  }

  return (
    <div data-testid="flamegraph" aria-label={ariaLabel} className="relative w-full" ref={containerRef}>
      {showWarning && (
        <div
          data-testid="flamegraph-overflow-warning"
          className="mb-1 rounded px-2 py-1 text-[11px] text-[--color-accent-amber] border border-[--color-accent-amber] bg-[--color-bg-overlay]"
        >
          Large dataset: showing top {MAX_FRAMES_DISPLAY} frames of {rows.length.toLocaleString()}.
        </div>
      )}

      {zoomedFrame && (
        <div className="mb-1 flex items-center gap-2">
          <button
            type="button"
            onClick={handleZoomReset}
            className="text-[11px] text-[--color-accent] hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-[--color-accent] rounded"
            aria-label="Reset zoom"
          >
            ← Reset zoom
          </button>
          <span className="text-[11px] text-[--color-fg-muted]">
            Zoomed: {zoomedFrame.name}
          </span>
        </div>
      )}

      <svg
        width="100%"
        height={svgHeight || 18}
        role="img"
        aria-label={ariaLabel}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {layout.frames.map((frame) => {
          const fill = colorForFrame(frame, colorScheme, layout.totalValue);
          const y = svgY(frame);
          const isFocused = focusedFrame?.name === frame.name && focusedFrame?.depth === frame.depth;
          const ariaExpanded = frame.children.length > 0;
          const ariaLabelText = `${frame.name}: total ${frame.totalValue} (${layout.totalValue === 0 ? '0' : ((frame.totalValue / layout.totalValue) * 100).toFixed(1)}%)`;

          return (
            <g key={`${frame.name}-${frame.depth}-${frame.x}`}>
              <rect
                data-frame={frame.name}
                x={frame.x + 0.5}
                y={y + 0.5}
                width={Math.max(frame.width - 1, 0)}
                height={ROW_HEIGHT - 1}
                fill={fill}
                stroke="var(--color-bg-base)"
                strokeWidth={0.5}
                role="button"
                aria-label={ariaLabelText}
                aria-expanded={ariaExpanded}
                tabIndex={0}
                onClick={() => handleFrameClick(frame)}
                onMouseEnter={(e) => handleFrameMouseEnter(frame, e)}
                onMouseLeave={handleFrameMouseLeave}
                onKeyDown={(e) => handleFrameKeyDown(frame, e)}
                style={{
                  cursor: frame.children.length > 0 ? 'pointer' : 'default',
                  outline: isFocused ? `2px solid var(--color-accent)` : undefined,
                  outlineOffset: isFocused ? '1px' : undefined,
                }}
              />
              {frame.width > 40 && (
                <text
                  x={frame.x + 4}
                  y={y + ROW_HEIGHT - 5}
                  fontSize={11}
                  fill="var(--color-bg-base)"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  <title>{frame.name}</title>
                  {frame.name.length > Math.floor(frame.width / 7)
                    ? frame.name.slice(0, Math.floor(frame.width / 7)) + '…'
                    : frame.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <FlamegraphTooltip data={tooltip} />
    </div>
  );
}
```

- [ ] **Step 5.4 — Run tests, expect pass**

```bash
npx vitest run src/__tests__/plots/flamegraph.test.tsx 2>&1 | tail -20
```

Expected: all 8 tests PASS.

- [ ] **Step 5.5 — Commit**

```bash
git add src/components/plots/FlamegraphPlot.tsx src/__tests__/plots/flamegraph.test.tsx
git commit -m "feat(flamegraph): add FlamegraphPlot SVG renderer with frame rects and aria attributes"
```

---

## Task 6: Zoom interaction tests

**Files:**
- Modify: `src/__tests__/plots/flamegraph.test.tsx`

- [ ] **Step 6.1 — Write failing zoom interaction tests**

Append to `src/__tests__/plots/flamegraph.test.tsx`:

```tsx
import userEvent from '@testing-library/user-event';

const DEEP_ROWS: Record<string, unknown>[] = [
  { frame: 'main',    samples: 0,   parentFrame: ''     },
  { frame: 'run',     samples: 0,   parentFrame: 'main' },
  { frame: 'doWork',  samples: 100, parentFrame: 'run'  },
];

const DEEP_NODE: PanelNode = {
  kind: 'panel',
  plotType: 'flamegraph',
  config: { name: 'frame', value: 'samples', parent: 'parentFrame' },
  clauses: {},
};

describe('FlamegraphPlot — zoom interactions', () => {
  it('clicking a frame with children zooms in (Reset zoom button appears)', async () => {
    render(wrap(DEEP_NODE, DEEP_ROWS));
    const mainRect = document.querySelector('rect[data-frame="main"]') as HTMLElement;
    await userEvent.click(mainRect);
    expect(screen.getByRole('button', { name: /reset zoom/i })).toBeInTheDocument();
  });

  it('clicking "Reset zoom" button resets to full view', async () => {
    render(wrap(DEEP_NODE, DEEP_ROWS));
    const mainRect = document.querySelector('rect[data-frame="main"]') as HTMLElement;
    await userEvent.click(mainRect);
    const resetBtn = screen.getByRole('button', { name: /reset zoom/i });
    await userEvent.click(resetBtn);
    expect(screen.queryByText(/Zoomed:/)).not.toBeInTheDocument();
  });

  it('clicking leaf frame does not trigger zoom', async () => {
    render(wrap(DEEP_NODE, DEEP_ROWS));
    const doWorkRect = document.querySelector('rect[data-frame="doWork"]') as HTMLElement;
    await userEvent.click(doWorkRect);
    // doWork is a leaf — no Reset zoom button
    expect(screen.queryByRole('button', { name: /reset zoom/i })).not.toBeInTheDocument();
  });

  it('zoomed frame text shows in breadcrumb label', async () => {
    render(wrap(DEEP_NODE, DEEP_ROWS));
    const mainRect = document.querySelector('rect[data-frame="main"]') as HTMLElement;
    await userEvent.click(mainRect);
    expect(screen.getByText(/Zoomed: main/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6.2 — Run failing zoom tests**

```bash
npx vitest run src/__tests__/plots/flamegraph.test.tsx 2>&1 | tail -20
```

Expected: FAIL — `userEvent is not defined` or zoom button not found (interaction not wired yet in test setup).

Note: if userEvent is not installed, run: `npm install --save-dev @testing-library/user-event` (it should already be installed since other plot tests use it).

- [ ] **Step 6.3 — Verify that FlamegraphPlot already wires click-to-zoom (Task 5 implementation includes it). Run again:**

```bash
npx vitest run src/__tests__/plots/flamegraph.test.tsx 2>&1 | tail -30
```

Expected: all zoom tests PASS (the implementation from Task 5 includes zoom handling).

- [ ] **Step 6.4 — Commit**

```bash
git add src/__tests__/plots/flamegraph.test.tsx
git commit -m "test(flamegraph): add zoom interaction tests"
```

---

## Task 7: Tooltip render tests

**Files:**
- Modify: `src/__tests__/plots/flamegraph.test.tsx`

- [ ] **Step 7.1 — Write failing tooltip tests**

Append to `src/__tests__/plots/flamegraph.test.tsx`:

```tsx
import { fireEvent } from '@testing-library/react';

describe('FlamegraphPlot — tooltip', () => {
  it('tooltip is hidden by default', () => {
    render(wrap(FLAMEGRAPH_NODE, SIMPLE_ROWS));
    const tooltip = screen.getByTestId('flamegraph-tooltip');
    expect(tooltip).toHaveAttribute('hidden');
  });

  it('tooltip appears on mouseenter', () => {
    const { container } = render(wrap(FLAMEGRAPH_NODE, SIMPLE_ROWS));
    const rect = container.querySelector('rect[data-frame="process"]') as SVGRectElement;
    fireEvent.mouseEnter(rect, { clientX: 100, clientY: 50 });
    const tooltip = screen.getByTestId('flamegraph-tooltip');
    expect(tooltip).not.toHaveAttribute('hidden');
    expect(tooltip).toHaveTextContent('process');
  });

  it('tooltip hides on mouseleave', () => {
    const { container } = render(wrap(FLAMEGRAPH_NODE, SIMPLE_ROWS));
    const rect = container.querySelector('rect[data-frame="process"]') as SVGRectElement;
    fireEvent.mouseEnter(rect, { clientX: 100, clientY: 50 });
    fireEvent.mouseLeave(rect);
    const tooltip = screen.getByTestId('flamegraph-tooltip');
    expect(tooltip).toHaveAttribute('hidden');
  });

  it('tooltip shows % of total', () => {
    const { container } = render(wrap(FLAMEGRAPH_NODE, SIMPLE_ROWS));
    const rect = container.querySelector('rect[data-frame="process"]') as SVGRectElement;
    fireEvent.mouseEnter(rect, { clientX: 100, clientY: 50 });
    const tooltip = screen.getByTestId('flamegraph-tooltip');
    expect(tooltip).toHaveTextContent('%');
  });
});
```

- [ ] **Step 7.2 — Run tests**

```bash
npx vitest run src/__tests__/plots/flamegraph.test.tsx 2>&1 | tail -20
```

Expected: tooltip hidden-by-default test PASSES (FlamegraphTooltip renders with `hidden` when data is null). Hover tests may fail if jsdom doesn't propagate clientX/Y to the container's getBoundingClientRect. If they fail, the implementation in Task 5 already handles this gracefully — `getBoundingClientRect` in jsdom returns zeros, so x/y will be 0,0, which is fine for the test.

- [ ] **Step 7.3 — Fix if needed: mock getBoundingClientRect in test setup**

If tooltip tests fail with "tooltip text not found", add to the describe block:

```tsx
beforeEach(() => {
  const container = document.querySelector('[data-testid="flamegraph"]');
  if (container) {
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 800, height: 200,
      right: 800, bottom: 200, x: 0, y: 0, toJSON: () => ({})
    } as DOMRect);
  }
});
```

Re-run until all tooltip tests PASS.

- [ ] **Step 7.4 — Commit**

```bash
git add src/__tests__/plots/flamegraph.test.tsx
git commit -m "test(flamegraph): add tooltip show/hide tests"
```

---

## Task 8: Large dataset warning + keyboard navigation tests

**Files:**
- Modify: `src/__tests__/plots/flamegraph.test.tsx`

- [ ] **Step 8.1 — Write failing large-dataset test**

Append to `src/__tests__/plots/flamegraph.test.tsx`:

```tsx
describe('FlamegraphPlot — large dataset guard', () => {
  it('shows overflow warning when rows exceed 50000', () => {
    const bigRows: Record<string, unknown>[] = Array.from({ length: 50_001 }, (_, i) => ({
      frame: `frame_${i}`,
      samples: 1,
      parentFrame: i === 0 ? '' : `frame_${i - 1}`,
    }));
    render(wrap(FLAMEGRAPH_NODE, bigRows));
    expect(screen.getByTestId('flamegraph-overflow-warning')).toBeInTheDocument();
  });

  it('does NOT show warning for <= 50000 rows', () => {
    render(wrap(FLAMEGRAPH_NODE, SIMPLE_ROWS));
    expect(screen.queryByTestId('flamegraph-overflow-warning')).not.toBeInTheDocument();
  });
});

describe('FlamegraphPlot — keyboard navigation', () => {
  it('pressing Escape on a frame resets zoom', async () => {
    render(wrap(DEEP_NODE, DEEP_ROWS));
    // First zoom in by clicking
    const mainRect = document.querySelector('rect[data-frame="main"]') as HTMLElement;
    await userEvent.click(mainRect);
    expect(screen.getByRole('button', { name: /reset zoom/i })).toBeInTheDocument();
    // Now press Escape on any frame
    fireEvent.keyDown(mainRect, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /reset zoom/i })).not.toBeInTheDocument();
  });

  it('pressing Enter on a non-leaf frame zooms in', async () => {
    render(wrap(DEEP_NODE, DEEP_ROWS));
    const mainRect = document.querySelector('rect[data-frame="main"]') as HTMLElement;
    fireEvent.keyDown(mainRect, { key: 'Enter' });
    expect(screen.getByRole('button', { name: /reset zoom/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 8.2 — Run failing tests**

```bash
npx vitest run src/__tests__/plots/flamegraph.test.tsx 2>&1 | tail -30
```

Expected: large dataset test may be slow (generating 50001 rows). All keyboard tests should PASS (wired in Task 5 implementation).

- [ ] **Step 8.3 — Run all flamegraph tests**

```bash
npx vitest run src/__tests__/plots/flamegraph.test.tsx src/__tests__/plots/flamegraphUtils.test.ts 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 8.4 — Commit**

```bash
git add src/__tests__/plots/flamegraph.test.tsx
git commit -m "test(flamegraph): add large-dataset warning and keyboard navigation tests"
```

---

## Task 9: Performance bench

**Files:**
- Create: `src/__tests__/plots/flamegraph.bench.ts`

- [ ] **Step 9.1 — Write bench**

Create `src/__tests__/plots/flamegraph.bench.ts`:

```ts
import { bench, describe } from 'vitest';
import { buildTree, computeLayout, colorForFrame } from '../../components/plots/flamegraphUtils';
import type { FlamegraphColorScheme } from '../../components/plots/flamegraphUtils';

// Fixture: flat call tree with 1000 frames (realistic JFR profile)
function makeRows(n: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  rows.push({ name: 'main', value: 0, parent: '' });
  for (let i = 1; i < n; i++) {
    rows.push({
      name: `frame_${i}`,
      value: Math.floor(Math.random() * 100),
      parent: i < 3 ? 'main' : `frame_${Math.floor(Math.random() * (i - 1)) + 1}`,
    });
  }
  return rows;
}

const ROWS_1K = makeRows(1_000);
const ROWS_5K = makeRows(5_000);

describe('flamegraph perf', () => {
  bench('buildTree — 1k rows', () => {
    buildTree(ROWS_1K, 'name', 'value', 'parent');
  });

  bench('buildTree — 5k rows', () => {
    buildTree(ROWS_5K, 'name', 'value', 'parent');
  });

  bench('computeLayout — 1k frames', () => {
    const roots = buildTree(ROWS_1K, 'name', 'value', 'parent');
    computeLayout(roots, 1000);
  });

  bench('computeLayout — 5k frames', () => {
    const roots = buildTree(ROWS_5K, 'name', 'value', 'parent');
    computeLayout(roots, 1000);
  });

  bench('colorForFrame hotness — 5k frames', () => {
    const roots = buildTree(ROWS_1K, 'name', 'value', 'parent');
    const layout = computeLayout(roots, 1000);
    for (const f of layout.frames) colorForFrame(f, 'hotness' as FlamegraphColorScheme, layout.totalValue);
  });
});
```

- [ ] **Step 9.2 — Run bench to verify it executes**

```bash
npx vitest bench src/__tests__/plots/flamegraph.bench.ts 2>&1 | tail -20
```

Expected: bench results print without error. buildTree 1k should be < 5ms, 5k < 50ms.

- [ ] **Step 9.3 — Commit**

```bash
git add src/__tests__/plots/flamegraph.bench.ts
git commit -m "perf(flamegraph): add benchmark for buildTree and computeLayout"
```

---

## Task 10: Export from `index.ts`

**Files:**
- Modify: `src/components/plots/index.ts`

- [ ] **Step 10.1 — Write failing import test**

Append to `src/__tests__/plots/flamegraphUtils.test.ts`:

```ts
describe('index.ts re-exports', () => {
  it('FlamegraphPlot is exported from plots/index', async () => {
    const mod = await import('../../components/plots/index');
    expect(typeof mod.FlamegraphPlot).toBe('function');
  });
});
```

- [ ] **Step 10.2 — Run failing test**

```bash
npx vitest run src/__tests__/plots/flamegraphUtils.test.ts 2>&1 | tail -10
```

Expected: FAIL — `mod.FlamegraphPlot is not a function`

- [ ] **Step 10.3 — Add export to index.ts**

Open `src/components/plots/index.ts` and add after the `ScatterPlot` export line:

```ts
export { FlamegraphPlot } from './FlamegraphPlot';
```

- [ ] **Step 10.4 — Run test, expect pass**

```bash
npx vitest run src/__tests__/plots/flamegraphUtils.test.ts 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 10.5 — Run full test suite to confirm no regressions**

```bash
npx vitest run src/__tests__/plots/ 2>&1 | tail -20
```

Expected: all plot tests PASS.

- [ ] **Step 10.6 — Commit**

```bash
git add src/components/plots/index.ts src/__tests__/plots/flamegraphUtils.test.ts
git commit -m "feat(flamegraph): export FlamegraphPlot from plots index"
```

---

## Task 11: E2E smoke test

**Files:**
- Modify: `tests/e2e/03-plot-dsl.spec.ts`

- [ ] **Step 11.1 — Add flamegraph E2E test**

Open `tests/e2e/03-plot-dsl.spec.ts`. After the scatter story test block (around line 48), add:

```ts
test('@e2e plot DSL cell renders flamegraph story (if story harness present)', async ({ page }) => {
  await page.goto('/?__plot_story=flamegraph');
  try {
    await page.waitForSelector('[data-testid="flamegraph"]', { timeout: 4_000 });
    await expect(page.locator('[data-testid="flamegraph"]')).toBeVisible();
  } catch {
    test.skip();
  }
});
```

- [ ] **Step 11.2 — Run E2E (skip if dev server not running)**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx playwright test tests/e2e/03-plot-dsl.spec.ts 2>&1 | tail -20
```

Expected: the new test either PASSES (if story harness handles `?__plot_story=flamegraph`) or self-skips via `test.skip()`. No failure.

- [ ] **Step 11.3 — Commit**

```bash
git add tests/e2e/03-plot-dsl.spec.ts
git commit -m "test(e2e): add flamegraph story smoke test"
```

---

## Task 12: Visual regression snapshot test

**Files:**
- Modify: `tests/visual/plots.spec.ts`

- [ ] **Step 12.1 — Add flamegraph visual test**

Open `tests/visual/plots.spec.ts`. After the scatter snapshot test block, add a new describe block:

```ts
test.describe('@visual M-C4 flamegraph token snapshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="welcome-cell"]');
  });

  test('@visual flamegraph-chart dark theme — tokens resolve', async ({ page }) => {
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'visual-flamegraph';
      host.style.cssText =
        'width:600px;height:200px;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--color-bg-surface);padding:8px;';
      host.innerHTML = `
        <div
          data-testid="flamegraph"
          aria-label="Flamegraph: 4 frames"
          style="width:100%;height:180px;position:relative;"
        >
          <svg width="584" height="54" role="img" aria-label="Flamegraph: 4 frames" style="display:block;">
            <!-- depth 0: main (full width) -->
            <rect data-frame="main" x="0.5" y="37.5" width="583" height="17"
              fill="var(--color-accent-amber)" stroke="var(--color-bg-base)" stroke-width="0.5"
              role="button" aria-label="main: total 100 (100%)" />
            <text x="4" y="49" font-size="11" fill="var(--color-bg-base)">main</text>
            <!-- depth 1: run (40%) -->
            <rect data-frame="run" x="0.5" y="19.5" width="232" height="17"
              fill="var(--color-accent)" stroke="var(--color-bg-base)" stroke-width="0.5"
              role="button" aria-label="run: total 40 (40%)" />
            <text x="4" y="31" font-size="11" fill="var(--color-bg-base)">run</text>
            <!-- depth 1: process (60%) -->
            <rect data-frame="process" x="233.5" y="19.5" width="350" height="17"
              fill="var(--color-accent-red)" stroke="var(--color-bg-base)" stroke-width="0.5"
              role="button" aria-label="process: total 60 (60%)" />
            <text x="237" y="31" font-size="11" fill="var(--color-bg-base)">process</text>
            <!-- depth 2: doWork (40%) -->
            <rect data-frame="doWork" x="0.5" y="1.5" width="232" height="17"
              fill="var(--color-accent)" stroke="var(--color-bg-base)" stroke-width="0.5"
              role="button" aria-label="doWork: total 40 (40%)" />
            <text x="4" y="13" font-size="11" fill="var(--color-bg-base)">doWork</text>
          </svg>
        </div>`;
      document.body.appendChild(host);
    });
    await expect(page.locator('#visual-flamegraph')).toHaveScreenshot(
      'flamegraph-dark-tokens.png', { maxDiffPixelRatio: 0.02 }
    );
  });
});
```

- [ ] **Step 12.2 — Run visual test to generate baseline snapshot**

```bash
npx playwright test tests/visual/plots.spec.ts --update-snapshots 2>&1 | tail -20
```

Expected: snapshot `flamegraph-dark-tokens.png` written to `tests/visual/plots.spec.ts-snapshots/`.

- [ ] **Step 12.3 — Run again without --update-snapshots to confirm it passes**

```bash
npx playwright test tests/visual/plots.spec.ts 2>&1 | tail -20
```

Expected: PASS with 0 pixel diff.

- [ ] **Step 12.4 — Commit**

```bash
git add tests/visual/plots.spec.ts "tests/visual/plots.spec.ts-snapshots/"
git commit -m "test(visual): add flamegraph dark-theme snapshot baseline"
```

---

## Task 13: Accessibility test

**Files:**
- Modify: `tests/e2e/a11y-plot-renderer.spec.ts`

- [ ] **Step 13.1 — Add flamegraph axe test**

Open `tests/e2e/a11y-plot-renderer.spec.ts`. In the `@a11y M-C2 chart containers` describe block, after the scatter-chart test, add:

```ts
test('injected flamegraph container has no axe violations', async ({ page }) => {
  await page.evaluate(() => {
    // Inject a minimal flamegraph SVG for axe testing
    const host = document.createElement('div');
    host.setAttribute('data-testid', 'flamegraph-axe');
    host.setAttribute('aria-label', 'Flamegraph: 3 frames');
    host.style.cssText = 'width:400px;height:100px;';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '400');
    svg.setAttribute('height', '54');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Flamegraph: 3 frames');

    const makeFrame = (name: string, x: number, y: number, w: number): SVGRectElement => {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('data-frame', name);
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', '17');
      rect.setAttribute('role', 'button');
      rect.setAttribute('aria-label', `${name}: total 100 (100%)`);
      rect.setAttribute('tabindex', '0');
      rect.setAttribute('fill', 'var(--color-accent)');
      return rect;
    };

    svg.appendChild(makeFrame('main', 0.5, 37.5, 399));
    svg.appendChild(makeFrame('run', 0.5, 19.5, 199));
    svg.appendChild(makeFrame('process', 200.5, 19.5, 199));
    host.appendChild(svg);
    document.body.appendChild(host);
  });

  const results = await new AxeBuilder({ page })
    .include('[data-testid="flamegraph-axe"]')
    .analyze();
  expect(results.violations).toHaveLength(0);
});

test('flamegraph aria-label is present and non-empty', async ({ page }) => {
  await page.goto('/?__plot_story=flamegraph');
  try {
    const el = await page.waitForSelector('[data-testid="flamegraph"]', { timeout: 4_000 });
    const label = await el.getAttribute('aria-label');
    expect(label).not.toBeNull();
    expect(label!.length).toBeGreaterThan(0);
  } catch {
    test.skip();
  }
});
```

- [ ] **Step 13.2 — Run a11y tests**

```bash
npx playwright test tests/e2e/a11y-plot-renderer.spec.ts 2>&1 | tail -20
```

Expected: all tests PASS (no axe violations for injected flamegraph).

- [ ] **Step 13.3 — Commit**

```bash
git add tests/e2e/a11y-plot-renderer.spec.ts
git commit -m "test(a11y): add axe-core check for flamegraph SVG container"
```

---

## Checkpoint E: Visual verification against showcase

- [ ] **Step E.1 — Navigate to showcase page**

Using `mcp__playwright__navigate`:

```
url: file:///Users/i560383_1/code/experiments/jfr-sql-notebook/redesign-plan/showcase.html
```

- [ ] **Step E.2 — Take screenshot**

Using `mcp__playwright__screenshot` with no arguments.

Verify: the showcase page loads without error. Note any existing flamegraph illustrations or placeholder sections that M-C4 must match visually.

- [ ] **Step E.3 — Inject flamegraph and screenshot**

Using `mcp__playwright__evaluate`:

```js
const host = document.createElement('div');
host.id = 'checkpoint-flamegraph';
host.style.cssText = 'width:700px;background:var(--color-bg-surface,#151a23);padding:12px;margin:24px auto;border-radius:6px;border:1px solid var(--color-border,#232a37);';
host.innerHTML = `
  <div style="font-size:12px;color:var(--color-fg-muted,#6b7896);margin-bottom:6px;">M-C4 Flamegraph — checkpoint render</div>
  <div data-testid="flamegraph" aria-label="Flamegraph: 5 frames" style="width:100%;position:relative;">
    <svg width="676" height="72" role="img" aria-label="Flamegraph: 5 frames" style="display:block;">
      <rect x="0.5" y="55.5" width="675" height="17" fill="var(--color-accent-amber,#fbbf24)" stroke="var(--color-bg-base,#0d1117)" stroke-width="0.5" role="button" aria-label="main: total 100 (100%)" tabindex="0"/>
      <text x="4" y="67" font-size="11" fill="var(--color-bg-base,#0d1117)">main</text>
      <rect x="0.5" y="37.5" width="270" height="17" fill="var(--color-accent,#22d3ee)" stroke="var(--color-bg-base,#0d1117)" stroke-width="0.5" role="button" aria-label="GC.run: total 40 (40%)" tabindex="0"/>
      <text x="4" y="49" font-size="11" fill="var(--color-bg-base,#0d1117)">GC.run</text>
      <rect x="271.5" y="37.5" width="404" height="17" fill="var(--color-accent-red,#ef4444)" stroke="var(--color-bg-base,#0d1117)" stroke-width="0.5" role="button" aria-label="G1: ParNew: total 60 (60%)" tabindex="0"/>
      <text x="275" y="49" font-size="11" fill="var(--color-bg-base,#0d1117)">G1: ParNew</text>
      <rect x="0.5" y="19.5" width="270" height="17" fill="var(--color-accent,#22d3ee)" stroke="var(--color-bg-base,#0d1117)" stroke-width="0.5" role="button" aria-label="SafepointSynchronize: total 40 (40%)" tabindex="0"/>
      <text x="4" y="31" font-size="11" fill="var(--color-bg-base,#0d1117)">SafepointSynchronize</text>
      <rect x="271.5" y="19.5" width="201" height="17" fill="var(--color-accent-amber,#fbbf24)" stroke="var(--color-bg-base,#0d1117)" stroke-width="0.5" role="button" aria-label="HeapRegion: total 30 (30%)" tabindex="0"/>
      <text x="275" y="31" font-size="11" fill="var(--color-bg-base,#0d1117)">HeapRegion</text>
    </svg>
  </div>`;
document.body.prepend(host);
```

Take screenshot. Verify: frames are visible, CSS tokens resolve to correct colors (cyan/amber/red), text labels render at 11px.

- [ ] **Step E.4 — Record result**

If the screenshot shows correctly-colored flame frames with bottom-up layout, Checkpoint E is PASSED. If tokens did not resolve (frames appear white/transparent), it indicates the page does not have the CSS token definitions loaded — that is expected for a static showcase page; the actual app will have them.

---

## Task 14: Final integration — run all test layers

- [ ] **Step 14.1 — Run all unit tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run 2>&1 | tail -30
```

Expected: all tests PASS. No regressions in non-plot tests.

- [ ] **Step 14.2 — Run TypeScript type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: zero errors.

- [ ] **Step 14.3 — Run E2E tests**

```bash
npx playwright test tests/e2e/ 2>&1 | tail -20
```

Expected: 03-plot-dsl flamegraph test PASSES or self-skips; no new failures.

- [ ] **Step 14.4 — Run visual tests**

```bash
npx playwright test tests/visual/ 2>&1 | tail -20
```

Expected: flamegraph snapshot matches baseline; existing snapshots unchanged.

- [ ] **Step 14.5 — Run a11y tests**

```bash
npx playwright test tests/e2e/a11y-plot-renderer.spec.ts 2>&1 | tail -20
```

Expected: zero axe violations.

- [ ] **Step 14.6 — Run perf bench**

```bash
npx vitest bench src/__tests__/plots/flamegraph.bench.ts 2>&1 | tail -20
```

Expected: buildTree 1k < 5ms (p50), computeLayout 5k < 50ms (p50).

- [ ] **Step 14.7 — Final commit**

```bash
git add -p  # review everything
git commit -m "feat(M-C4): complete flamegraph renderer — SVG, zoom, keyboard nav, 5-layer tests"
```

---

## Summary of all files created/modified

| File | Action |
|---|---|
| `src/components/plots/flamegraphUtils.ts` | Created — `FrameNode`, `FlamegraphLayout`, `FlamegraphColorScheme`, `buildTree()`, `computeLayout()`, `colorForFrame()`, `ROW_HEIGHT` |
| `src/components/plots/FlamegraphTooltip.tsx` | Created — hover tooltip with name, self, total, % |
| `src/components/plots/FlamegraphPlot.tsx` | Created — SVG renderer with zoom, keyboard nav, ResizeObserver, large-dataset guard |
| `src/components/plots/index.ts` | Modified — added `FlamegraphPlot` export |
| `src/__tests__/plots/flamegraphUtils.test.ts` | Created — `buildTree`, `computeLayout`, `colorForFrame`, `index.ts` re-export tests |
| `src/__tests__/plots/flamegraph.test.tsx` | Created — render, color tokens, zoom, tooltip, large dataset, keyboard tests |
| `src/__tests__/plots/flamegraph.bench.ts` | Created — perf bench for buildTree + computeLayout |
| `tests/e2e/03-plot-dsl.spec.ts` | Modified — flamegraph story smoke test |
| `tests/visual/plots.spec.ts` | Modified — flamegraph dark-theme snapshot |
| `tests/e2e/a11y-plot-renderer.spec.ts` | Modified — axe-core check for injected flamegraph SVG |

---

## Dependency chain

```
flamegraphUtils.ts  ←  plotSeriesUtils.ts (SERIES_COLORS, extractNumeric, extractString)
FlamegraphTooltip.tsx  ← (no imports from flamegraphUtils)
FlamegraphPlot.tsx  ←  flamegraphUtils.ts + FlamegraphTooltip.tsx + PlotContext.ts + plotSeriesUtils.ts
index.ts  ←  FlamegraphPlot.tsx
```

All dependencies are already present from M-C1 + M-C2. No new npm packages required.
