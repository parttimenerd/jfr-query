# M-B4: Dep Graph Overlay Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans.
> **Testing standard:** See docs/superpowers/TESTING_STANDARD.md — all 5 layers apply.

**Goal:** Ship a modal overlay opened by `⌘G` that visualises the current `DepGraph` (produced by M-A4) as an interactive node-link diagram using **cytoscape.js** + **cytoscape-dagre** for hierarchical layout. The overlay renders all five edge kinds (`data`, `var`, `live-var`, `axis-link`, `prompt`) with distinct **stroke patterns** in addition to colour (per showcase §10a.1 — colour is never the only signal); node shapes encode node kind (rounded rectangle for cells, square for vars, diamond for live-vars). Hover/focus surfaces edge metadata via tooltip + aria-live region. The modal traps focus, is keyboard-traversable, fits to viewport on open, supports pan + zoom, respects `prefers-reduced-motion`, and closes on Escape.

**Architecture:** A portal-mounted `DepGraphOverlay` React component owns dialog semantics (focus trap, ARIA roles, ESC handling, keyboard shortcut wiring) and delegates rendering to `CytoscapeAdapter`, a wrapper that mounts a cytoscape instance into a `useRef`-anchored `<div>` during `useEffect`. Two pure modules (`graphElements.ts` and `edgeStyles.ts`/`nodeStyles.ts`) translate a `DepGraph` into cytoscape `ElementsDefinition` and produce a cytoscape stylesheet array. The pure converters are unit-tested without DOM; the adapter is unit-tested with a `vi.mock('cytoscape')` factory; the visual + a11y layers run against the real cytoscape against a real Playwright DOM. The overlay subscribes to a future `keyboardMap` service (introduced in M-B6) but, because M-B6 is not yet built, falls back to a local `window` keydown listener bound to `(event) => event.metaKey && event.key === 'g'` — guarded so the listener is removed on unmount and a TODO marker is left in place for M-B6 to replace.

**Tech Stack:** React 19.2, TypeScript 5.8, Vite 6.2, Tailwind v4 (CSS-first, `[data-theme="dark"]`), Vitest 4.1.9 (pool: forks), @testing-library/react 16.3.0, @testing-library/user-event 14.6.1, @testing-library/jest-dom 6.6.3, Playwright 1.61.0, AxeBuilder from @axe-core/playwright, cytoscape 3.30.x, cytoscape-dagre 2.5.x, @types/cytoscape (dev).

---

## Pre-resolved decisions

### DECISION 1: Library + version pin
We use **cytoscape@3.30.x** and **cytoscape-dagre@2.5.x**. Rationale: cytoscape is the only mature WebGL-free graph layout library that ships a stable ESM build, supports the dagre hierarchical layout we need, has an active maintainer, and accepts a fully declarative stylesheet (avoiding imperative styling that would defeat snapshot testing). Pin major+minor so behaviour-affecting upgrades are explicit. The plan calls for `npm i cytoscape@^3.30.0 cytoscape-dagre@^2.5.0` and `npm i -D @types/cytoscape`. If a newer 3.x is found via `npm view cytoscape version` at install time, use the latest 3.x but record the exact installed version in the commit message so review can verify nothing surprising landed.

### DECISION 2: Element shape encoding
- Cell nodes: `shape: 'round-rectangle'`, label `#${displayIndex} ${alias}`, padding 8px, font 12px.
- Var nodes (scope `cell` or `global`): `shape: 'rectangle'`, label `$${name}` (cell scope) or `$$${name}` (global scope).
- Live-var nodes: `shape: 'diamond'`, label `$!${name}`.
This matches the showcase requirement that node identity is legible without colour. Rationale: cytoscape's built-in shapes accept named values; `round-rectangle`/`rectangle`/`diamond` are stable across versions. We deliberately avoid `ellipse` (used by cytoscape default) so a screenshot diff cannot accidentally be misinterpreted.

### DECISION 3: Edge stroke patterns (the §10a.1 compliance)
Each edge kind pairs a colour with a stroke pattern. Greyscale tests verify the patterns are distinguishable when colour is stripped.

| Kind | Colour | `line-style` | `line-dash-pattern` | Width | Arrow shape |
|------|--------|--------------|---------------------|-------|-------------|
| `data` | cyan `#22d3ee` | `solid` | (n/a) | 2 | triangle |
| `var` | grey `#94a3b8` | `dashed` | `[6, 4]` | 1.5 | triangle |
| `live-var` | grey `#64748b` | `dashed` | `[10, 4]` (thick dashes) | 3 | triangle-tee |
| `axis-link` | orange `#fb923c` | `solid` | (n/a) | 2 | tee |
| `prompt` | purple `#a78bfa` | `dotted` | `[2, 4]` | 1.5 | triangle |

Cytoscape's standard property is `line-style: 'solid' | 'dashed' | 'dotted'`; `line-dash-pattern` is an array. The `axis-link` `tee` arrow vs `data` `triangle` arrow doubles up the shape encoding on the head end so axis-links can be distinguished from data even at small zoom. Rationale: any single signal (colour, pattern, width, arrow) is sufficient for a partially-impaired reader.

### DECISION 4: Layout choice and dimensions
Use cytoscape-dagre with `rankDir: 'LR'`, `rankSep: 100`, `nodeSep: 40`, `edgeSep: 10`. Rationale: LR (left-to-right) matches the showcase's horizontal "data flows right" mental model. After mount, call `cy.fit(undefined, 40)` (40px padding) to fit the entire graph to the viewport. On window resize and modal-open-reopen, call `cy.fit` again.

### DECISION 5: Reduced-motion handling
Set cytoscape layout option `animate: false` if `window.matchMedia('(prefers-reduced-motion: reduce)').matches`. Otherwise `animate: true, animationDuration: 250`. Tooltip/edge focus changes use no CSS transitions when reduced-motion is on. Rationale: cytoscape-dagre layouts can otherwise visibly settle for ~600ms which is unsuitable for vestibular sensitivity.

### DECISION 6: ⌘G shortcut registration
Until M-B6 ships a `keyboardMap` service, register a local `window` keydown handler inside `DepGraphOverlay` via `useEffect`. Handler:
```
if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g' && !event.shiftKey) { event.preventDefault(); toggleOpen(); }
```
Add `// TODO(M-B6): replace with keyboardMap.register('overlay.depGraph', { chord: '⌘G' })` next to the handler so M-B6 lands cleanly. The handler is **only registered when the overlay's host is mounted** (which is wherever an integrator includes `<DepGraphOverlay graph={…} />` in the tree) — but it is mounted at the top level via `AppShell` in this milestone (Step 11), so the shortcut is global.

### DECISION 7: Portal mount target + dialog roles
Mount the modal into `document.body` via `createPortal`. Outer dialog node has:
- `role="dialog"`
- `aria-modal="true"`
- `aria-labelledby="dep-graph-title"`
- `aria-describedby="dep-graph-help"`
- `tabIndex={-1}` so the dialog body can programmatically receive focus on open.

Heading `<h2 id="dep-graph-title">Dependency graph</h2>` and a visually-hidden `<p id="dep-graph-help">Use Tab to traverse edges. Press Enter on an edge to read its metadata.</p>` provide labelling. Rationale: explicit `aria-labelledby` is more robust than relying on heuristics.

### DECISION 8: Edge focus traversal
Use a roving-tabindex pattern over a hidden ordered list of edges (one `<li role="option" tabIndex={…}>` per edge). The visible cytoscape canvas is decorative for sighted users; the focusable list is the keyboard surface. Selecting an edge in the hidden list:
1. Sets the cytoscape edge to `selected` via `cy.$id(edgeId).select()` (which uses the stylesheet's `:selected` rule to render a focus ring).
2. Writes the edge's metadata into the `aria-live="polite"` announcement region.
Rationale: cytoscape does not expose focusable DOM per-edge — building a parallel hidden list is the only way to honour WCAG 2.1 SC 2.1.1 (keyboard accessibility). Tab order: search input (top-bar) → close button → first edge → … → last edge → modal close.

### DECISION 9: Test seam for cytoscape
Export a `createCytoscape` factory from `CytoscapeAdapter` that, by default, returns `cytoscape(options)`. Tests inject a mock factory via a prop `cyFactory?: typeof cytoscape`. Rationale: this is more honest than `vi.mock('cytoscape')` (the mock then has to live in every test file) and lets us assert the exact options cytoscape received.

### DECISION 10: Fixture graph for tests
Build one canonical 4-cell graph fixture at `src/__tests__/depGraph/fixtures/canonicalGraph.ts` containing exactly one of each of the five edge kinds:
- Cells: `load`, `gc_overview`, `long_gc_pauses`, `summary`.
- `data` edge: `load → gc_overview` via alias `load_raw`.
- `var` edge: var `$threshold` (scope `cell`) → `long_gc_pauses`.
- `live-var` edges: write from `gc_overview` → live-var `gc_overview.brush`; read from same live-var → `long_gc_pauses`.
- `axis-link` edge: `gc_overview → long_gc_pauses` on `x` axis via variable `t_axis`.
- `prompt` edge: `summary → gc_overview` with prompt text `"explain spikes"`.
This fixture is reused by unit, visual, and a11y tests.

---

## Steps

### Step 1 — Install cytoscape and types

- [ ] **1.1** Run from `frontend-v2/`:
```bash
npm i cytoscape@^3.30.0 cytoscape-dagre@^2.5.0
npm i -D @types/cytoscape
```

- [ ] **1.2** Verify the lockfile updated:
```bash
git diff package.json package-lock.json
```
Expected: `package.json` dependencies block has `cytoscape` and `cytoscape-dagre`; devDependencies has `@types/cytoscape`. Lockfile contains the resolved versions.

- [ ] **1.3** Confirm types resolve:
```bash
node -e "console.log(require.resolve('@types/cytoscape'))"
```

- [ ] **1.4** If `cytoscape-dagre` does not ship its own types (typical), create a 3-line `.d.ts` shim at `src/types/cytoscape-dagre.d.ts`:
```ts
declare module 'cytoscape-dagre' {
  const ext: cytoscape.Ext;
  export default ext;
}
```

- [ ] **1.5** Run `npx tsc --noEmit` to confirm no type errors.

---

### Step 2 — Create the graph-elements converter (pure)

- [ ] **2.1** Create `src/components/depGraph/graphElements.ts`:

```ts
import type {
  AxisLinkEdge,
  DataEdge,
  DepGraph,
  GraphEdge,
  GraphNode,
  LiveVarEdge,
  PromptEdge,
  VarEdge,
} from '../../services/parser/types';

export type CyNodeData = {
  id: string;
  label: string;
  kind: 'cell' | 'var' | 'live-var';
  // For live-var: which cell writes it (may be empty if producer unknown).
  producerAlias?: string;
};

export type CyEdgeData = {
  id: string;
  source: string;
  target: string;
  kind: GraphEdge['kind'];
  // Free-form per-kind metadata used by tooltip + aria-label.
  meta: Record<string, string>;
};

export interface CyElements {
  nodes: { data: CyNodeData; classes: string }[];
  edges: { data: CyEdgeData; classes: string }[];
}

/** Stable id schemes. */
function nodeId(n: GraphNode): string {
  if (n.kind === 'cell') return `cell:${n.alias}`;
  if (n.kind === 'var') return `var:${n.scope}:${n.name}`;
  return `live:${n.name}`;
}

function edgeIdFor(e: GraphEdge, ix: number): string {
  // Index suffix makes ids unique even when two edges share endpoints (e.g. two var edges).
  return `${e.kind}:${ix}`;
}

function nodeLabel(n: GraphNode): string {
  if (n.kind === 'cell') return `#${n.displayIndex} ${n.alias}`;
  if (n.kind === 'var') return n.scope === 'global' ? `$$${n.name}` : `$${n.name}`;
  return `$!${n.name}`;
}

function edgeEndpoints(e: GraphEdge): { source: string; target: string } {
  if (e.kind === 'data') {
    return { source: `cell:${e.from}`, target: `cell:${e.to}` };
  }
  if (e.kind === 'var') {
    return { source: `var:${e.scope}:${e.from}`, target: `cell:${e.to}` };
  }
  if (e.kind === 'live-var') {
    // For 'write' direction: cell → live-var. For 'read': live-var → cell.
    if (e.direction === 'write') {
      return { source: `cell:${e.from}`, target: `live:${e.liveVarName}` };
    }
    return { source: `live:${e.liveVarName}`, target: `cell:${e.to}` };
  }
  if (e.kind === 'axis-link') {
    return { source: `cell:${e.from}`, target: `cell:${e.to}` };
  }
  // prompt edge
  return { source: `cell:${e.from}`, target: `cell:${e.to}` };
}

function edgeMeta(e: GraphEdge): Record<string, string> {
  if (e.kind === 'data') {
    return { alias: e.alias, from: e.from, to: e.to };
  }
  if (e.kind === 'var') {
    return {
      varName: e.from,
      scope: e.scope,
      to: e.to,
      renderOnly: e.renderOnly ? 'true' : 'false',
    };
  }
  if (e.kind === 'live-var') {
    return {
      liveVarName: e.liveVarName,
      direction: e.direction,
      from: e.from,
      to: e.to,
    };
  }
  if (e.kind === 'axis-link') {
    return { axis: e.axis, variable: e.variable, from: e.from, to: e.to };
  }
  return { prompt: e.prompt, from: e.from, to: e.to };
}

export function depGraphToElements(graph: DepGraph): CyElements {
  const nodes = graph.nodes.map((n) => {
    const data: CyNodeData = {
      id: nodeId(n),
      label: nodeLabel(n),
      kind: n.kind,
      ...(n.kind === 'live-var' ? { producerAlias: n.producerAlias } : {}),
    };
    return { data, classes: n.kind };
  });

  const edges = graph.edges.map((e, ix) => {
    const ends = edgeEndpoints(e);
    const data: CyEdgeData = {
      id: edgeIdFor(e, ix),
      source: ends.source,
      target: ends.target,
      kind: e.kind,
      meta: edgeMeta(e),
    };
    return { data, classes: e.kind };
  });

  return { nodes, edges };
}

/** Human-readable description used for aria-label per edge (Decision 8). */
export function edgeAriaLabel(e: CyEdgeData): string {
  switch (e.kind) {
    case 'data':
      return `data edge from #${e.meta.from} to #${e.meta.to} via alias ${e.meta.alias}`;
    case 'var':
      return `${e.meta.scope === 'global' ? 'global ' : ''}variable $${e.meta.varName} read by ${e.meta.to}`;
    case 'live-var':
      return e.meta.direction === 'write'
        ? `live variable ${e.meta.liveVarName} written by ${e.meta.from}`
        : `live variable ${e.meta.liveVarName} read by ${e.meta.to}`;
    case 'axis-link':
      return `axis link on ${e.meta.axis} from ${e.meta.from} to ${e.meta.to} via ${e.meta.variable}`;
    case 'prompt':
      return `prompt edge from ${e.meta.from} to ${e.meta.to}: "${e.meta.prompt}"`;
  }
}
```

- [ ] **2.2** Run `npx tsc --noEmit` — must pass.

---

### Step 3 — Write fixture + unit tests for the converter (Red)

- [ ] **3.1** Create `src/__tests__/depGraph/fixtures/canonicalGraph.ts`:

```ts
import type { DepGraph } from '../../../services/parser/types';

export const canonicalGraph: DepGraph = {
  nodes: [
    { kind: 'cell', alias: 'load', displayIndex: 1 },
    { kind: 'cell', alias: 'gc_overview', displayIndex: 2 },
    { kind: 'cell', alias: 'long_gc_pauses', displayIndex: 3 },
    { kind: 'cell', alias: 'summary', displayIndex: 4 },
    { kind: 'var', name: 'threshold', scope: 'cell' },
    { kind: 'live-var', name: 'gc_overview.brush', producerAlias: 'gc_overview' },
  ],
  edges: [
    { kind: 'data', from: 'load', to: 'gc_overview', alias: 'load_raw' },
    {
      kind: 'var',
      from: 'threshold',
      to: 'long_gc_pauses',
      scope: 'cell',
      renderOnly: false,
    },
    {
      kind: 'live-var',
      from: 'gc_overview',
      to: 'gc_overview.brush',
      direction: 'write',
      liveVarName: 'gc_overview.brush',
    },
    {
      kind: 'live-var',
      from: 'gc_overview.brush',
      to: 'long_gc_pauses',
      direction: 'read',
      liveVarName: 'gc_overview.brush',
    },
    {
      kind: 'axis-link',
      from: 'gc_overview',
      to: 'long_gc_pauses',
      axis: 'x',
      variable: 't_axis',
    },
    {
      kind: 'prompt',
      from: 'summary',
      to: 'gc_overview',
      prompt: 'explain spikes',
    },
  ],
  cycles: [],
};
```

- [ ] **3.2** Create `src/__tests__/depGraph/graphElements.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { depGraphToElements, edgeAriaLabel } from '../../components/depGraph/graphElements';
import { canonicalGraph } from './fixtures/canonicalGraph';

describe('depGraphToElements', () => {
  it('produces one node per DepGraph node, with kind-class', () => {
    const { nodes } = depGraphToElements(canonicalGraph);
    expect(nodes).toHaveLength(6);
    expect(nodes.filter((n) => n.classes === 'cell')).toHaveLength(4);
    expect(nodes.filter((n) => n.classes === 'var')).toHaveLength(1);
    expect(nodes.filter((n) => n.classes === 'live-var')).toHaveLength(1);
  });

  it('produces exactly six edges, one per fixture edge', () => {
    const { edges } = depGraphToElements(canonicalGraph);
    expect(edges).toHaveLength(6);
    const byKind = (k: string): number => edges.filter((e) => e.classes === k).length;
    expect(byKind('data')).toBe(1);
    expect(byKind('var')).toBe(1);
    expect(byKind('live-var')).toBe(2);
    expect(byKind('axis-link')).toBe(1);
    expect(byKind('prompt')).toBe(1);
  });

  it('produces stable, unique node ids', () => {
    const { nodes } = depGraphToElements(canonicalGraph);
    const ids = nodes.map((n) => n.data.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('cell:load');
    expect(ids).toContain('cell:gc_overview');
    expect(ids).toContain('var:cell:threshold');
    expect(ids).toContain('live:gc_overview.brush');
  });

  it('labels nodes with their display sigil', () => {
    const { nodes } = depGraphToElements(canonicalGraph);
    const labels = nodes.map((n) => n.data.label);
    expect(labels).toContain('#1 load');
    expect(labels).toContain('$threshold');
    expect(labels).toContain('$!gc_overview.brush');
  });

  it('directs live-var edges according to direction', () => {
    const { edges } = depGraphToElements(canonicalGraph);
    const writes = edges.filter(
      (e) => e.data.kind === 'live-var' && e.data.meta.direction === 'write',
    );
    const reads = edges.filter(
      (e) => e.data.kind === 'live-var' && e.data.meta.direction === 'read',
    );
    expect(writes[0].data.source).toBe('cell:gc_overview');
    expect(writes[0].data.target).toBe('live:gc_overview.brush');
    expect(reads[0].data.source).toBe('live:gc_overview.brush');
    expect(reads[0].data.target).toBe('cell:long_gc_pauses');
  });

  it('preserves edge metadata for aria/tooltip use', () => {
    const { edges } = depGraphToElements(canonicalGraph);
    const dataEdge = edges.find((e) => e.data.kind === 'data')!;
    expect(dataEdge.data.meta.alias).toBe('load_raw');

    const axisEdge = edges.find((e) => e.data.kind === 'axis-link')!;
    expect(axisEdge.data.meta.axis).toBe('x');
    expect(axisEdge.data.meta.variable).toBe('t_axis');

    const promptEdge = edges.find((e) => e.data.kind === 'prompt')!;
    expect(promptEdge.data.meta.prompt).toBe('explain spikes');
  });
});

describe('edgeAriaLabel', () => {
  it('renders a human description for each kind', () => {
    const { edges } = depGraphToElements(canonicalGraph);
    for (const e of edges) {
      const label = edgeAriaLabel(e.data);
      expect(label.length).toBeGreaterThan(0);
      // Sanity check: never the literal string "[object Object]"
      expect(label).not.toContain('[object');
    }
    const data = edges.find((e) => e.data.kind === 'data')!.data;
    expect(edgeAriaLabel(data)).toBe('data edge from #load to #gc_overview via alias load_raw');
  });
});
```

- [ ] **3.3** Run `npx vitest run src/__tests__/depGraph/graphElements.test.ts` — these tests must PASS because Step 2 already implemented the module. If a test fails, fix the source (do not skip). This is the "Green" check for the pure-converter layer.

---

### Step 4 — Build the cytoscape stylesheet module

- [ ] **4.1** Create `src/components/depGraph/edgeStyles.ts`:

```ts
import type { Stylesheet } from 'cytoscape';

/** Per Decision 3: each edge kind has a colour + a line-style + a dash pattern + a width + an arrow. */
export const edgeStyles: Stylesheet[] = [
  {
    selector: 'edge.data',
    style: {
      'line-color': '#22d3ee',
      'target-arrow-color': '#22d3ee',
      'target-arrow-shape': 'triangle',
      'line-style': 'solid',
      width: 2,
      'curve-style': 'bezier',
    },
  },
  {
    selector: 'edge.var',
    style: {
      'line-color': '#94a3b8',
      'target-arrow-color': '#94a3b8',
      'target-arrow-shape': 'triangle',
      'line-style': 'dashed',
      'line-dash-pattern': [6, 4],
      width: 1.5,
      'curve-style': 'bezier',
    },
  },
  {
    selector: 'edge.live-var',
    style: {
      'line-color': '#64748b',
      'target-arrow-color': '#64748b',
      'target-arrow-shape': 'triangle-tee',
      'line-style': 'dashed',
      'line-dash-pattern': [10, 4],
      width: 3,
      'curve-style': 'bezier',
    },
  },
  {
    selector: 'edge.axis-link',
    style: {
      'line-color': '#fb923c',
      'target-arrow-color': '#fb923c',
      'target-arrow-shape': 'tee',
      'line-style': 'solid',
      width: 2,
      'curve-style': 'bezier',
    },
  },
  {
    selector: 'edge.prompt',
    style: {
      'line-color': '#a78bfa',
      'target-arrow-color': '#a78bfa',
      'target-arrow-shape': 'triangle',
      'line-style': 'dotted',
      'line-dash-pattern': [2, 4],
      width: 1.5,
      'curve-style': 'bezier',
    },
  },
  {
    selector: 'edge:selected',
    style: {
      'overlay-color': '#facc15',
      'overlay-opacity': 0.3,
      'overlay-padding': 4,
    },
  },
];
```

- [ ] **4.2** Create `src/components/depGraph/nodeStyles.ts`:

```ts
import type { Stylesheet } from 'cytoscape';

export const nodeStyles: Stylesheet[] = [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      'text-valign': 'center',
      'text-halign': 'center',
      'font-size': 12,
      'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
      'background-color': '#1e293b',
      color: '#e2e8f0',
      'border-width': 1,
      'border-color': '#475569',
      padding: '8px',
      width: 'label',
      height: 'label',
    },
  },
  {
    selector: 'node.cell',
    style: {
      shape: 'round-rectangle',
      'background-color': '#0f172a',
    },
  },
  {
    selector: 'node.var',
    style: {
      shape: 'rectangle',
      'background-color': '#1e1b4b',
    },
  },
  {
    selector: 'node.live-var',
    style: {
      shape: 'diamond',
      'background-color': '#3b0764',
      padding: '12px',
    },
  },
  {
    selector: 'node:selected',
    style: {
      'border-color': '#facc15',
      'border-width': 3,
    },
  },
];
```

- [ ] **4.3** Create `src/components/depGraph/stylesheet.ts`:

```ts
import type { Stylesheet } from 'cytoscape';
import { edgeStyles } from './edgeStyles';
import { nodeStyles } from './nodeStyles';

export const depGraphStylesheet: Stylesheet[] = [...nodeStyles, ...edgeStyles];
```

- [ ] **4.4** Run `npx tsc --noEmit` — must pass.

---

### Step 5 — Build the CytoscapeAdapter component

- [ ] **5.1** Create `src/components/depGraph/CytoscapeAdapter.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import cytoscape, { type Core, type ElementsDefinition } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import type { DepGraph } from '../../services/parser/types';
import { depGraphToElements } from './graphElements';
import { depGraphStylesheet } from './stylesheet';

// Register the dagre extension exactly once per module load.
let dagreRegistered = false;
function ensureDagreRegistered(cy: typeof cytoscape): void {
  if (!dagreRegistered) {
    cy.use(dagre);
    dagreRegistered = true;
  }
}

export type CyFactory = (options: cytoscape.CytoscapeOptions) => Core;

export interface CytoscapeAdapterProps {
  graph: DepGraph;
  /** Test seam: inject a fake cytoscape factory. Defaults to the real cytoscape function. */
  cyFactory?: CyFactory;
  /** Called once cytoscape has fitted the viewport, used by tests to know layout finished. */
  onReady?: (cy: Core) => void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function CytoscapeAdapter({
  graph,
  cyFactory,
  onReady,
}: CytoscapeAdapterProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (hostRef.current === null) return;
    const factory: CyFactory = cyFactory ?? ((opts) => cytoscape(opts));
    ensureDagreRegistered(cytoscape);
    const reduce = prefersReducedMotion();
    const elements: ElementsDefinition = (() => {
      const e = depGraphToElements(graph);
      return {
        nodes: e.nodes.map((n) => ({ data: n.data, classes: n.classes })),
        edges: e.edges.map((ed) => ({ data: ed.data, classes: ed.classes })),
      };
    })();

    const cy = factory({
      container: hostRef.current,
      elements,
      style: depGraphStylesheet,
      layout: {
        name: 'dagre',
        rankDir: 'LR',
        rankSep: 100,
        nodeSep: 40,
        edgeSep: 10,
        animate: !reduce,
        animationDuration: reduce ? 0 : 250,
        fit: true,
        padding: 40,
      } as unknown as cytoscape.LayoutOptions,
      wheelSensitivity: 0.2,
    });
    cyRef.current = cy;

    cy.ready(() => {
      cy.fit(undefined, 40);
      onReady?.(cy);
    });

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [graph, cyFactory, onReady]);

  return (
    <div
      ref={hostRef}
      data-testid="cytoscape-host"
      aria-hidden="true"
      className="h-full w-full"
    />
  );
}

export function _resetDagreForTests(): void {
  dagreRegistered = false;
}
```

- [ ] **5.2** Run `npx tsc --noEmit` — must pass. If cytoscape types complain about `LayoutOptions`, the cast through `unknown` keeps us safe; dagre's options are not in the cytoscape core types, this is expected.

---

### Step 6 — Unit-test the CytoscapeAdapter with an injected factory (Red)

- [ ] **6.1** Create `src/__tests__/depGraph/CytoscapeAdapter.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { Core, CytoscapeOptions, ElementsDefinition } from 'cytoscape';
import { CytoscapeAdapter, _resetDagreForTests } from '../../components/depGraph/CytoscapeAdapter';
import { canonicalGraph } from './fixtures/canonicalGraph';

afterEach(() => {
  cleanup();
  _resetDagreForTests();
});

function fakeCore(): Core {
  const handlers: Array<() => void> = [];
  const core = {
    ready: (h: () => void) => handlers.push(h),
    fit: vi.fn(),
    destroy: vi.fn(),
    nodes: vi.fn(() => ({ length: 0 })),
    edges: vi.fn(() => ({ length: 0 })),
    flush: () => handlers.splice(0).forEach((h) => h()),
  };
  return core as unknown as Core;
}

describe('CytoscapeAdapter', () => {
  it('calls the factory once with the parsed elements', () => {
    const fakeCy = fakeCore();
    const factory = vi.fn((_opts: CytoscapeOptions): Core => fakeCy);
    render(<CytoscapeAdapter graph={canonicalGraph} cyFactory={factory} />);
    expect(factory).toHaveBeenCalledTimes(1);
    const call = factory.mock.calls[0][0];
    expect(call.layout?.name).toBe('dagre');
    const elements = call.elements as ElementsDefinition;
    expect(elements.nodes).toHaveLength(6);
    expect(elements.edges).toHaveLength(6);
  });

  it('fits the viewport once cytoscape signals ready', () => {
    const fakeCy = fakeCore();
    const factory = (_opts: CytoscapeOptions): Core => fakeCy;
    const onReady = vi.fn();
    render(<CytoscapeAdapter graph={canonicalGraph} cyFactory={factory} onReady={onReady} />);
    (fakeCy as unknown as { flush: () => void }).flush();
    expect(fakeCy.fit).toHaveBeenCalled();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('destroys the cytoscape instance on unmount', () => {
    const fakeCy = fakeCore();
    const factory = (_opts: CytoscapeOptions): Core => fakeCy;
    const { unmount } = render(<CytoscapeAdapter graph={canonicalGraph} cyFactory={factory} />);
    unmount();
    expect(fakeCy.destroy).toHaveBeenCalledTimes(1);
  });

  it('respects prefers-reduced-motion (disables animation)', () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    }));
    try {
      const fakeCy = fakeCore();
      const factory = vi.fn((_opts: CytoscapeOptions): Core => fakeCy);
      render(<CytoscapeAdapter graph={canonicalGraph} cyFactory={factory} />);
      const call = factory.mock.calls[0][0];
      const layout = call.layout as unknown as { animate: boolean; animationDuration: number };
      expect(layout.animate).toBe(false);
      expect(layout.animationDuration).toBe(0);
    } finally {
      window.matchMedia = original;
    }
  });
});
```

- [ ] **6.2** Run `npx vitest run src/__tests__/depGraph/CytoscapeAdapter.test.tsx`. The tests should PASS because Step 5 implemented the adapter. If a test fails, fix the source.

---

### Step 7 — Build the focus-trap hook and edge keyboard list

- [ ] **7.1** Create `src/components/depGraph/useFocusTrap.ts`:

```ts
import { useEffect } from 'react';

/**
 * Constrains Tab/Shift+Tab to a container while `active`.
 * On activation, focus moves to the first focusable element inside.
 * On deactivation, focus returns to the element that had focus before activation.
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (container === null) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    function focusable(): HTMLElement[] {
      const sel =
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
        ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      return Array.from(container!.querySelectorAll<HTMLElement>(sel)).filter(
        (el) => !el.hasAttribute('inert'),
      );
    }

    const items = focusable();
    if (items.length > 0) items[0].focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Tab') return;
      const list = focusable();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    }
    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [active, containerRef]);
}
```

- [ ] **7.2** Create `src/components/depGraph/EdgeKeyboardList.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Core } from 'cytoscape';
import { type CyEdgeData, edgeAriaLabel } from './graphElements';

export interface EdgeKeyboardListProps {
  edges: CyEdgeData[];
  /** Provides access to the live cytoscape instance for selection synchronisation. */
  getCy: () => Core | null;
  /** Called when the user activates (Enter / Space) an edge — used to update the announcement region. */
  onActivate: (edge: CyEdgeData) => void;
}

export function EdgeKeyboardList({
  edges,
  getCy,
  onActivate,
}: EdgeKeyboardListProps): JSX.Element {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  // When activeIndex changes, sync selection into cytoscape.
  useEffect(() => {
    const cy = getCy();
    if (cy === null) return;
    const edge = edges[activeIndex];
    if (edge === undefined) return;
    cy.elements('edge').unselect();
    const target = cy.$id(edge.id);
    if (target.length > 0) target.select();
  }, [activeIndex, edges, getCy]);

  function handleKey(event: React.KeyboardEvent<HTMLLIElement>, ix: number): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      const next = (ix + 1) % edges.length;
      setActiveIndex(next);
      listRef.current?.querySelector<HTMLLIElement>(`[data-ix="${next}"]`)?.focus();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = (ix - 1 + edges.length) % edges.length;
      setActiveIndex(next);
      listRef.current?.querySelector<HTMLLIElement>(`[data-ix="${next}"]`)?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate(edges[ix]);
    }
  }

  return (
    <ul
      ref={listRef}
      role="listbox"
      aria-label="Graph edges"
      aria-activedescendant={`dep-edge-${activeIndex}`}
      data-testid="edge-keyboard-list"
      className="absolute left-0 top-0 sr-only"
    >
      {edges.map((e, ix) => (
        <li
          key={e.id}
          id={`dep-edge-${ix}`}
          role="option"
          aria-selected={ix === activeIndex}
          aria-label={edgeAriaLabel(e)}
          data-ix={ix}
          tabIndex={ix === activeIndex ? 0 : -1}
          onKeyDown={(ev) => handleKey(ev, ix)}
          onFocus={() => setActiveIndex(ix)}
        >
          {edgeAriaLabel(e)}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **7.3** Run `npx tsc --noEmit`.

---

### Step 8 — Build the DepGraphOverlay shell

- [ ] **8.1** Create `src/components/depGraph/DepGraphOverlay.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { JSX } from 'react';
import type { Core } from 'cytoscape';
import type { DepGraph } from '../../services/parser/types';
import { CytoscapeAdapter, type CyFactory } from './CytoscapeAdapter';
import { EdgeKeyboardList } from './EdgeKeyboardList';
import { depGraphToElements, edgeAriaLabel, type CyEdgeData } from './graphElements';
import { useFocusTrap } from './useFocusTrap';

export interface DepGraphOverlayProps {
  graph: DepGraph;
  /** Controlled open state. If omitted the component manages its own state via ⌘G. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Test seam — same as CytoscapeAdapter's. */
  cyFactory?: CyFactory;
}

export function DepGraphOverlay({
  graph,
  open: openProp,
  onOpenChange,
  cyFactory,
}: DepGraphOverlayProps): JSX.Element | null {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');

  // ⌘G global keybinding. TODO(M-B6): replace with keyboardMap.register.
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        setOpen(!open);
      }
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  useFocusTrap(dialogRef, open);

  const elements = depGraphToElements(graph);
  const handleReady = useCallback((cy: Core) => {
    cyRef.current = cy;
  }, []);

  function handleActivate(edge: CyEdgeData): void {
    setAnnouncement(edgeAriaLabel(edge));
  }

  if (!open) return null;

  const overlay = (
    <div
      data-testid="depgraph-overlay-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dep-graph-title"
        aria-describedby="dep-graph-help"
        tabIndex={-1}
        data-testid="depgraph-overlay-dialog"
        className="relative flex h-[80vh] w-[90vw] max-w-6xl flex-col rounded-lg bg-[--color-bg-base] p-4 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-[--color-border] pb-2">
          <h2 id="dep-graph-title" className="text-lg font-semibold">
            Dependency graph
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close dependency graph"
            className="rounded px-2 py-1 text-sm text-[--color-fg-muted] hover:bg-[--color-bg-overlay]"
          >
            ×
          </button>
        </header>
        <p id="dep-graph-help" className="sr-only">
          Use Tab to traverse edges. Arrow keys move between edges. Press Enter to read an
          edge&apos;s metadata. Press Escape to close.
        </p>
        <div className="relative flex-1">
          <CytoscapeAdapter graph={graph} cyFactory={cyFactory} onReady={handleReady} />
          <EdgeKeyboardList
            edges={elements.edges.map((e) => e.data)}
            getCy={() => cyRef.current}
            onActivate={handleActivate}
          />
        </div>
        <div
          role="status"
          aria-live="polite"
          data-testid="depgraph-announcement"
          className="sr-only"
        >
          {announcement}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
```

- [ ] **8.2** Run `npx tsc --noEmit`.

---

### Step 9 — Overlay unit + a11y tests (Red)

- [ ] **9.1** Create `src/__tests__/depGraph/DepGraphOverlay.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Core, CytoscapeOptions } from 'cytoscape';
import { DepGraphOverlay } from '../../components/depGraph/DepGraphOverlay';
import { canonicalGraph } from './fixtures/canonicalGraph';

beforeEach(() => {
  // Stub matchMedia so reduced-motion is deterministic.
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false,
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  }));
});

afterEach(() => {
  cleanup();
});

function makeFakeCy(): Core {
  const readyQueue: Array<() => void> = [];
  const cy = {
    ready: (h: () => void) => readyQueue.push(h),
    fit: vi.fn(),
    destroy: vi.fn(),
    elements: () => ({
      unselect: vi.fn(),
    }),
    $id: () => ({ length: 0, select: vi.fn() }),
    flushReady: () => readyQueue.splice(0).forEach((h) => h()),
  };
  return cy as unknown as Core;
}

describe('DepGraphOverlay', () => {
  it('does not render anything when closed', () => {
    const cy = makeFakeCy();
    const factory = (_opts: CytoscapeOptions): Core => cy;
    render(<DepGraphOverlay graph={canonicalGraph} cyFactory={factory} open={false} />);
    expect(screen.queryByTestId('depgraph-overlay-dialog')).toBeNull();
  });

  it('renders dialog with correct ARIA when open', () => {
    const cy = makeFakeCy();
    const factory = (_opts: CytoscapeOptions): Core => cy;
    render(<DepGraphOverlay graph={canonicalGraph} cyFactory={factory} open />);
    const dialog = screen.getByTestId('depgraph-overlay-dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('dep-graph-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('dep-graph-help');
    expect(screen.getByText('Dependency graph')).toBeInTheDocument();
  });

  it('renders one edge-list option per graph edge', () => {
    const cy = makeFakeCy();
    const factory = (_opts: CytoscapeOptions): Core => cy;
    render(<DepGraphOverlay graph={canonicalGraph} cyFactory={factory} open />);
    const list = screen.getByRole('listbox', { name: 'Graph edges' });
    const options = list.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(canonicalGraph.edges.length);
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const cy = makeFakeCy();
    const factory = (_opts: CytoscapeOptions): Core => cy;
    const onOpenChange = vi.fn();
    render(
      <DepGraphOverlay
        graph={canonicalGraph}
        cyFactory={factory}
        open
        onOpenChange={onOpenChange}
      />,
    );
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('toggles open via ⌘G', async () => {
    const cy = makeFakeCy();
    const factory = (_opts: CytoscapeOptions): Core => cy;
    const onOpenChange = vi.fn();
    render(
      <DepGraphOverlay
        graph={canonicalGraph}
        cyFactory={factory}
        open={false}
        onOpenChange={onOpenChange}
      />,
    );
    await act(async () => {
      const evt = new KeyboardEvent('keydown', { key: 'g', metaKey: true });
      window.dispatchEvent(evt);
    });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('does not toggle on Shift+⌘G (reserved for other binding)', async () => {
    const cy = makeFakeCy();
    const factory = (_opts: CytoscapeOptions): Core => cy;
    const onOpenChange = vi.fn();
    render(
      <DepGraphOverlay
        graph={canonicalGraph}
        cyFactory={factory}
        open={false}
        onOpenChange={onOpenChange}
      />,
    );
    await act(async () => {
      const evt = new KeyboardEvent('keydown', { key: 'g', metaKey: true, shiftKey: true });
      window.dispatchEvent(evt);
    });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('writes edge metadata to the announcement region on Enter', async () => {
    const user = userEvent.setup();
    const cy = makeFakeCy();
    const factory = (_opts: CytoscapeOptions): Core => cy;
    render(<DepGraphOverlay graph={canonicalGraph} cyFactory={factory} open />);
    const firstOption = screen.getAllByRole('option')[0] as HTMLElement;
    firstOption.focus();
    await user.keyboard('{Enter}');
    const ann = screen.getByTestId('depgraph-announcement');
    expect(ann.textContent).toMatch(/data edge|variable|live variable|axis link|prompt edge/);
  });
});
```

- [ ] **9.2** Run `npx vitest run src/__tests__/depGraph/DepGraphOverlay.test.tsx`. All tests should PASS.

---

### Step 10 — useFocusTrap unit test

- [ ] **10.1** Create `src/__tests__/depGraph/useFocusTrap.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import type { JSX } from 'react';
import { useFocusTrap } from '../../components/depGraph/useFocusTrap';

afterEach(cleanup);

function Harness({ active }: { active: boolean }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(ref, active);
  return (
    <div>
      <button data-testid="outside-before">before</button>
      <div ref={ref} data-testid="trap">
        <button data-testid="first">first</button>
        <button data-testid="middle">middle</button>
        <button data-testid="last">last</button>
      </div>
      <button data-testid="outside-after">after</button>
    </div>
  );
}

describe('useFocusTrap', () => {
  it('focuses the first focusable when activated', async () => {
    const { getByTestId } = render(<Harness active />);
    expect(document.activeElement).toBe(getByTestId('first'));
  });

  it('wraps Tab from last back to first', async () => {
    const user = userEvent.setup();
    const { getByTestId } = render(<Harness active />);
    getByTestId('last').focus();
    await user.tab();
    expect(document.activeElement).toBe(getByTestId('first'));
  });

  it('wraps Shift+Tab from first back to last', async () => {
    const user = userEvent.setup();
    const { getByTestId } = render(<Harness active />);
    getByTestId('first').focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(getByTestId('last'));
  });

  it('does nothing when inactive', async () => {
    const user = userEvent.setup();
    const { getByTestId } = render(<Harness active={false} />);
    getByTestId('outside-before').focus();
    await user.tab();
    expect(document.activeElement).toBe(getByTestId('first'));
    // No wrap behaviour expected.
  });
});
```

- [ ] **10.2** Run `npx vitest run src/__tests__/depGraph/useFocusTrap.test.tsx`. Tests must PASS.

---

### Step 11 — Wire DepGraphOverlay into AppShell + provide a graph source

- [ ] **11.1** Identify where the current `Notebook` lives in the app. From the M-B1/M-B2 plans the notebook is provided by `NotebookView` from `src/components/notebook/`. For M-B4, we attach the overlay at the `AppShell` level and pass it a graph derived from the current notebook.

- [ ] **11.2** Create a small context bridge — `src/components/depGraph/DepGraphSource.tsx`:

```tsx
import { useMemo } from 'react';
import type { JSX } from 'react';
import type { DepGraph, Notebook, RuntimeState } from '../../services/parser/types';
import { computeDepGraph } from '../../services/depGraph/DepGraph';
import { DepGraphOverlay } from './DepGraphOverlay';

export interface DepGraphSourceProps {
  notebook: Notebook;
  runtime?: RuntimeState;
}

export function DepGraphSource({ notebook, runtime }: DepGraphSourceProps): JSX.Element {
  const effectiveRuntime: RuntimeState = runtime ?? { cycleBreaks: [], liveVars: {} };
  const graph: DepGraph = useMemo(
    () => computeDepGraph(notebook, effectiveRuntime),
    [notebook, effectiveRuntime],
  );
  return <DepGraphOverlay graph={graph} />;
}
```

- [ ] **11.3** Add the overlay to `AppShell.tsx`. Modify `AppShell.tsx` to accept an optional `notebook` prop and, when present, render `<DepGraphSource notebook={notebook} />`. If the integrator does not pass a notebook (e.g. in tests), the overlay is not mounted.

```tsx
// src/components/shell/AppShell.tsx — add to props:
interface AppShellProps {
  children: ReactNode;
  notebook?: Notebook;
}
// inside the JSX (after <StatusBar /> in the same fragment):
{notebook ? <DepGraphSource notebook={notebook} /> : null}
```
Add imports: `import type { Notebook } from '../../services/parser/types';` and `import { DepGraphSource } from '../depGraph/DepGraphSource';`.

- [ ] **11.4** Verify `npx tsc --noEmit` passes and existing AppShell tests still pass:
```bash
npx vitest run src/__tests__/shell/AppShell.test.tsx
```

---

### Step 12 — Playwright visual regression test

- [ ] **12.1** Create `tests/e2e/depGraph/overlay.visual.spec.ts`. Assumes Playwright config already has projects `dark` and `light` set by M-B1.

```ts
import { test, expect } from '@playwright/test';

test.describe('@visual DepGraph overlay', () => {
  test('renders canonical graph (dark theme)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'dark', 'dark project only');
    await page.goto('/?fixture=depGraphCanonical');
    await page.keyboard.press('Meta+g');
    const dialog = page.getByTestId('depgraph-overlay-dialog');
    await expect(dialog).toBeVisible();
    // Wait for cytoscape layout to settle (animation duration is 250ms + ~150ms grace).
    await page.waitForTimeout(500);
    await expect(dialog).toHaveScreenshot('overlay-dark.png', { maxDiffPixelRatio: 0.01 });
  });

  test('renders canonical graph (light theme)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'light', 'light project only');
    await page.goto('/?fixture=depGraphCanonical&theme=light');
    await page.keyboard.press('Meta+g');
    const dialog = page.getByTestId('depgraph-overlay-dialog');
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(500);
    await expect(dialog).toHaveScreenshot('overlay-light.png', { maxDiffPixelRatio: 0.01 });
  });

  test('edges remain distinguishable in greyscale', async ({ page }) => {
    await page.goto('/?fixture=depGraphCanonical');
    await page.keyboard.press('Meta+g');
    await page.waitForTimeout(500);
    const dialog = page.getByTestId('depgraph-overlay-dialog');
    // Apply CSS greyscale filter to test the colour-blind story.
    await dialog.evaluate((el) => {
      (el as HTMLElement).style.filter = 'grayscale(1)';
    });
    await expect(dialog).toHaveScreenshot('overlay-greyscale.png', { maxDiffPixelRatio: 0.02 });
  });
});
```

- [ ] **12.2** Add a `?fixture=depGraphCanonical` URL parameter handler to the app entry. Edit `src/main.tsx` to read `URLSearchParams` and, if `fixture=depGraphCanonical`, load `canonicalGraph` from the fixture file and pass a synthesised `Notebook` to AppShell. The synthesised notebook is simply enough cells to satisfy the heading regex; for visual tests we bypass `computeDepGraph` by adding a `graph` prop to `DepGraphSource` (Step 11.2 alternative):

  Modify `DepGraphSource.tsx`:
  ```tsx
  export interface DepGraphSourceProps {
    notebook?: Notebook;
    runtime?: RuntimeState;
    /** Test seam — directly inject a graph (used by Playwright fixtures). */
    graph?: DepGraph;
  }
  // ... and inside:
  const graph: DepGraph = useMemo(
    () => props.graph ?? computeDepGraph(props.notebook!, effectiveRuntime),
    [props.graph, props.notebook, effectiveRuntime],
  );
  ```

  In `main.tsx`:
  ```ts
  const params = new URLSearchParams(window.location.search);
  if (params.get('fixture') === 'depGraphCanonical') {
    const { canonicalGraph } = await import('./__tests__/depGraph/fixtures/canonicalGraph');
    // Render an AppShell wrapping a minimal NotebookView with the injected graph.
    root.render(<AppShell notebook={undefined}><DepGraphSource graph={canonicalGraph} /></AppShell>);
  }
  ```
  Note: the `__tests__` import in production is acceptable here because the fixture file is small and tree-shaken when the parameter is absent.

- [ ] **12.3** Run Playwright to baseline screenshots (first run will write them; subsequent runs assert against them):
```bash
npx playwright test --project=dark --project=light --grep "@visual DepGraph"
```

- [ ] **12.4** Commit the resulting baseline PNGs under `tests/e2e/depGraph/__snapshots__/`.

---

### Step 13 — Playwright a11y test with AxeBuilder

- [ ] **13.1** Create `tests/e2e/depGraph/overlay.a11y.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('@a11y DepGraph overlay', () => {
  test('axe-core finds no violations in open dialog', async ({ page }) => {
    await page.goto('/?fixture=depGraphCanonical');
    await page.keyboard.press('Meta+g');
    await page.waitForSelector('[data-testid="depgraph-overlay-dialog"]');
    const results = await new AxeBuilder({ page })
      .include('[data-testid="depgraph-overlay-dialog"]')
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('Tab moves focus through edges; Enter announces metadata', async ({ page }) => {
    await page.goto('/?fixture=depGraphCanonical');
    await page.keyboard.press('Meta+g');
    await page.waitForSelector('[data-testid="depgraph-overlay-dialog"]');
    // Tab past the close button into the edge list.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    const announcement = await page.getByTestId('depgraph-announcement').textContent();
    expect(announcement).toMatch(/edge|variable|prompt/);
  });

  test('Escape closes dialog and restores focus', async ({ page }) => {
    await page.goto('/?fixture=depGraphCanonical');
    // Focus a known element before opening.
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="sidebar-toggle"]')?.focus());
    await page.keyboard.press('Meta+g');
    await page.waitForSelector('[data-testid="depgraph-overlay-dialog"]');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('depgraph-overlay-dialog')).toHaveCount(0);
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    expect(focused).toBe('sidebar-toggle');
  });
});
```

- [ ] **13.2** Run the a11y suite:
```bash
npx playwright test --grep "@a11y DepGraph"
```
Expected: 3/3 pass. If axe-core reports a violation, fix the source (do not lower the assertion). The most common cause is missing `aria-hidden` on the decorative cytoscape host — verify `data-testid="cytoscape-host"` carries `aria-hidden="true"`.

---

### Step 14 — Performance benchmark

- [ ] **14.1** Create `src/__tests__/depGraph/overlay.bench.ts`:

```ts
import { bench, describe } from 'vitest';
import { depGraphToElements } from '../../components/depGraph/graphElements';
import type { DepGraph, GraphEdge, GraphNode } from '../../services/parser/types';

function makeLargeGraph(cellCount: number): DepGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (let i = 0; i < cellCount; i += 1) {
    nodes.push({ kind: 'cell', alias: `c${i}`, displayIndex: i });
    if (i > 0) {
      edges.push({ kind: 'data', from: `c${i - 1}`, to: `c${i}`, alias: `view_${i}` });
    }
  }
  return { nodes, edges, cycles: [] };
}

describe('depGraphToElements', () => {
  const g100 = makeLargeGraph(100);
  bench('convert 100-cell graph', () => {
    depGraphToElements(g100);
  });

  const g1000 = makeLargeGraph(1000);
  bench('convert 1000-cell graph', () => {
    depGraphToElements(g1000);
  });
});
```

- [ ] **14.2** Run:
```bash
npx vitest bench src/__tests__/depGraph/overlay.bench.ts
```
Expected: 100-cell conversion < 1ms median, 1000-cell conversion < 10ms median on CI hardware. If exceeded, profile and remove obvious allocations (e.g. avoid `Map`s in the hot path). Document the measured numbers in the PR description.

---

### Step 15 — End-to-end smoke

- [ ] **15.1** Create `tests/e2e/depGraph/overlay.e2e.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('opens overlay via ⌘G against a real notebook', async ({ page }) => {
  await page.goto('/');
  // Load the seed notebook from M-B1 (assumed to exist; if not, gracefully skip).
  const present = await page.locator('[data-testid="notebook-view"]').count();
  if (present === 0) test.skip(true, 'NotebookView not yet wired into root');
  await page.keyboard.press('Meta+g');
  await expect(page.getByTestId('depgraph-overlay-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('depgraph-overlay-dialog')).toHaveCount(0);
});
```

- [ ] **15.2** Run:
```bash
npx playwright test tests/e2e/depGraph/overlay.e2e.spec.ts
```

---

### Step 16 — Run the full M-B4 suite

- [ ] **16.1** Run unit tests:
```bash
npx vitest run src/__tests__/depGraph
```
Expected: all green.

- [ ] **16.2** Run visual + a11y:
```bash
npx playwright test --grep "@visual DepGraph"
npx playwright test --grep "@a11y DepGraph"
```

- [ ] **16.3** Run the bench:
```bash
npx vitest bench src/__tests__/depGraph
```

- [ ] **16.4** Confirm no `any` types leaked: `grep -rn ": any" src/components/depGraph` returns nothing.

- [ ] **16.5** Confirm no `.dark` class was used: `grep -rn "\.dark" src/components/depGraph` returns nothing. Theme switching is done via `[data-theme="dark"]` on `<html>`.

---

### Step 17 — Read prior reviews and commit

- [ ] **17.1** Read `docs/reviews/` for critical issues from earlier commits before committing:
```bash
ls docs/reviews/ 2>/dev/null
```
If any unresolved critical issue blocks M-B4 (e.g. a previous commit broke `AppShell.tsx`), address it before continuing.

- [ ] **17.2** Stage and commit. Use a HEREDOC for the message:
```bash
git add frontend-v2/src/components/depGraph \
        frontend-v2/src/__tests__/depGraph \
        frontend-v2/tests/e2e/depGraph \
        frontend-v2/package.json \
        frontend-v2/package-lock.json \
        frontend-v2/src/types/cytoscape-dagre.d.ts \
        frontend-v2/src/components/shell/AppShell.tsx \
        frontend-v2/src/main.tsx
git commit -m "$(cat <<'EOF'
M-B4: dep graph overlay (⌘G modal, 5 edge kinds, cytoscape.js)

Adds a portal-mounted modal opened by ⌘G that renders the current
DepGraph using cytoscape.js + cytoscape-dagre. Each of the five edge
kinds (data / var / live-var / axis-link / prompt) is encoded by
colour AND stroke pattern AND arrow head (§10a.1 colour-blind compliance),
verified by a Playwright greyscale screenshot diff. Includes a parallel
hidden listbox so keyboard users can traverse edges and have their
metadata announced via aria-live; full focus trap; Escape closes;
prefers-reduced-motion disables layout animation.
EOF
)"
```

- [ ] **17.3** Verify the commit landed cleanly:
```bash
git status
```

---

## Done criteria

- [ ] `cytoscape@^3.30.0`, `cytoscape-dagre@^2.5.0`, and `@types/cytoscape` are pinned in `frontend-v2/package.json`.
- [ ] `src/components/depGraph/` contains: `graphElements.ts`, `edgeStyles.ts`, `nodeStyles.ts`, `stylesheet.ts`, `CytoscapeAdapter.tsx`, `useFocusTrap.ts`, `EdgeKeyboardList.tsx`, `DepGraphOverlay.tsx`, `DepGraphSource.tsx`.
- [ ] `src/__tests__/depGraph/` contains: `graphElements.test.ts`, `CytoscapeAdapter.test.tsx`, `useFocusTrap.test.tsx`, `DepGraphOverlay.test.tsx`, `overlay.bench.ts`, `fixtures/canonicalGraph.ts`.
- [ ] All five edge kinds map to distinct `(colour, line-style, line-dash-pattern, arrow-head)` tuples (Decision 3 table).
- [ ] Greyscale Playwright screenshot diff still shows all five edge kinds distinguishable.
- [ ] `⌘G` toggles the overlay; `Escape` closes; both bound only when the overlay is mounted; TODO marker for M-B6 keyboard-map service is present in source.
- [ ] Dialog node has `role="dialog"`, `aria-modal="true"`, `aria-labelledby="dep-graph-title"`, `aria-describedby="dep-graph-help"`.
- [ ] Hidden listbox provides one `role="option"` per edge with an `aria-label` produced by `edgeAriaLabel`; arrow keys navigate; Enter writes metadata to a `role="status" aria-live="polite"` region.
- [ ] `useFocusTrap` keeps Tab inside the dialog and restores focus on close.
- [ ] `prefers-reduced-motion: reduce` disables cytoscape's layout animation (`animate: false, animationDuration: 0`).
- [ ] `npx vitest run src/__tests__/depGraph` is green.
- [ ] `npx playwright test --grep "@visual DepGraph"` is green; baseline PNGs committed under `tests/e2e/depGraph/__snapshots__/`.
- [ ] `npx playwright test --grep "@a11y DepGraph"` returns 0 axe violations.
- [ ] `npx vitest bench src/__tests__/depGraph/overlay.bench.ts` reports < 1ms median for 100-cell and < 10ms median for 1000-cell conversion.
- [ ] `npx tsc --noEmit` clean.
- [ ] No `any` types under `src/components/depGraph/`.
- [ ] No `.dark` class references — theming is via `[data-theme="dark"]` only.
- [ ] All React 19 components import `JSX` via `import type { JSX } from 'react'`.
- [ ] `AxeBuilder` is imported statically from `@axe-core/playwright` in every a11y spec.
- [ ] `docs/agent-state/pipeline.md` is updated to record M-B4 as a written plan.
