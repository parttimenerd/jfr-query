# M-A4: Dep Graph Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pure deterministic `computeDepGraph` covering 5 edge kinds (data/var/live-var/axis-link/prompt), iterative Tarjan SCC cycle detection, 4 property tests at 1000 iters, <30ms p95 on 100-cell fixture.

**Architecture:** Pure function pipeline — 5 edge collectors → canonical sort → cycle detection → return. No DOM/React. Iterative Tarjan to handle 100+ cell notebooks without stack overflow.

**Tech Stack:** TypeScript 5.8, fast-check 3.22, Vitest 4.1

---

## Task 1: Add DepGraph types to types.ts

- [ ] **Step 1.1** — Append DepGraph types to `frontend-v2/src/services/parser/types.ts`.

  Open `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/parser/types.ts` and append:

  ```typescript
  // ─── DepGraph types (M-A4) ──────────────────────────────────────────

  export interface CellNode {
    kind: 'cell';
    alias: string;
    displayIndex: number;
  }

  export interface VarNode {
    kind: 'var';
    name: string;
    scope: 'cell' | 'global';
  }

  export interface LiveVarNode {
    kind: 'live-var';
    name: string;          // e.g. "gc_overview.brush"
    producerAlias: string; // cell that writes this live-var
  }

  export type GraphNode = CellNode | VarNode | LiveVarNode;

  export interface DataEdge {
    kind: 'data';
    from: string;   // producer cell alias
    to: string;     // consumer cell alias
    alias: string;  // the view name used in FROM
  }

  export interface VarEdge {
    kind: 'var';
    from: string;   // var node name
    to: string;     // cell alias that reads it
    scope: 'cell' | 'global';
    renderOnly: boolean;
  }

  export interface LiveVarEdge {
    kind: 'live-var';
    from: string;
    to: string;
    direction: 'read' | 'write';
    liveVarName: string;
  }

  export interface AxisLinkEdge {
    kind: 'axis-link';
    from: string;
    to: string;
    axis: 'x' | 'y' | 'xy';
    variable: string;
  }

  export interface PromptEdge {
    kind: 'prompt';
    from: string;   // source cell alias (referenced in @chip)
    to: string;     // cell that has the last_ai_prompt
    prompt: string;
  }

  export type GraphEdge = DataEdge | VarEdge | LiveVarEdge | AxisLinkEdge | PromptEdge;

  export interface Cycle {
    edges: GraphEdge[];
    introducedBy: 'static' | 'live';
  }

  export interface RuntimeState {
    cycleBreaks: Cycle[];
    liveVars: Record<string, unknown>;
  }

  export interface DepGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
    cycles: Cycle[];
  }
  ```

- [ ] **Step 1.2** — Verify types are present.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query
  grep -c "export interface DepGraph" frontend-v2/src/services/parser/types.ts
  ```

  Expected output:
  ```
  1
  ```

  ```bash
  grep -E "^export (interface|type) (CellNode|VarNode|LiveVarNode|GraphNode|DataEdge|VarEdge|LiveVarEdge|AxisLinkEdge|PromptEdge|GraphEdge|Cycle|RuntimeState|DepGraph)" \
    frontend-v2/src/services/parser/types.ts | wc -l | tr -d ' '
  ```

  Expected output:
  ```
  13
  ```

- [ ] **Step 1.3** — Typecheck after adding types.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run typecheck
  ```

  Expected: exit code 0, no errors.

---

## Task 2: Create skeleton files

- [ ] **Step 2.1** — Create `frontend-v2/src/services/depGraph/` directory.

  ```bash
  mkdir -p /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/depGraph
  ls /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/depGraph
  ```

  Expected output: (empty)

- [ ] **Step 2.2** — Create `DepGraph.ts` stub.

  Write `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/depGraph/DepGraph.ts`:

  ```typescript
  import type { DepGraph, Notebook, RuntimeState } from '../parser/types';

  export function computeDepGraph(
    _notebook: Notebook,
    _runtime: RuntimeState,
  ): DepGraph {
    throw new Error('not implemented');
  }
  ```

- [ ] **Step 2.3** — Create `edgeBuilder.ts` stub.

  Write `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/depGraph/edgeBuilder.ts`:

  ```typescript
  import type {
    AxisLinkEdge,
    DataEdge,
    LiveVarEdge,
    Notebook,
    PromptEdge,
    VarEdge,
  } from '../parser/types';

  export function collectDataEdges(_notebook: Notebook): DataEdge[] {
    throw new Error('not implemented');
  }

  export function collectVarEdges(_notebook: Notebook): VarEdge[] {
    throw new Error('not implemented');
  }

  export function collectLiveVarEdges(_notebook: Notebook): LiveVarEdge[] {
    throw new Error('not implemented');
  }

  export function collectAxisLinkEdges(_notebook: Notebook): AxisLinkEdge[] {
    throw new Error('not implemented');
  }

  export function collectPromptEdges(_notebook: Notebook): PromptEdge[] {
    throw new Error('not implemented');
  }
  ```

- [ ] **Step 2.4** — Create `cycleDetection.ts` stub.

  Write `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/depGraph/cycleDetection.ts`:

  ```typescript
  import type { Cycle, GraphEdge } from '../parser/types';

  export function detectStaticCycles(_edges: GraphEdge[]): Cycle[] {
    throw new Error('not implemented');
  }
  ```

- [ ] **Step 2.5** — Typecheck stubs.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run typecheck
  ```

  Expected: exit code 0, no errors.

- [ ] **Step 2.6** — Confirm no DOM/React imports.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  grep -E "^(import|from)" src/services/depGraph/*.ts | grep -E "(react|recharts|cytoscape|document|window)" | wc -l | tr -d ' '
  ```

  Expected output:
  ```
  0
  ```

---

## Task 3: Failing tests — DataEdge

- [ ] **Step 3.1** — Create test directory.

  ```bash
  mkdir -p /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/depGraph
  ```

- [ ] **Step 3.2** — Write `edgeBuilder.test.ts` initial file with DataEdge tests.

  Write `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/depGraph/edgeBuilder.test.ts`:

  ```typescript
  import { describe, expect, it } from 'vitest';
  import {
    collectAxisLinkEdges,
    collectDataEdges,
    collectLiveVarEdges,
    collectPromptEdges,
    collectVarEdges,
  } from '../../services/depGraph/edgeBuilder';
  import type { Notebook } from '../../services/parser/types';

  function makeNotebook(cells: Notebook['cells']): Notebook {
    return { frontmatter: {}, cells };
  }

  describe('collectDataEdges', () => {
    it('emits edge when cell B FROMs cell A alias', () => {
      const nb = makeNotebook([
        {
          kind: 'sql',
          alias: 'gc_overview',
          displayIndex: 0,
          sql: 'SELECT * FROM jfr.gc',
          references: [],
          varRefs: [],
        },
        {
          kind: 'sql',
          alias: 'cell_b',
          displayIndex: 1,
          sql: 'SELECT * FROM gc_overview',
          references: [
            { name: 'gc_overview', resolvedTo: 'cross-cell-view' },
          ],
          varRefs: [],
        },
      ]);
      const edges = collectDataEdges(nb);
      expect(edges).toEqual([
        { kind: 'data', from: 'gc_overview', to: 'cell_b', alias: 'gc_overview' },
      ]);
    });

    it('emits edge when reference resolvedTo is "alias"', () => {
      const nb = makeNotebook([
        {
          kind: 'sql',
          alias: 'a',
          displayIndex: 0,
          sql: 'SELECT 1',
          references: [],
          varRefs: [],
        },
        {
          kind: 'sql',
          alias: 'b',
          displayIndex: 1,
          sql: 'SELECT * FROM a',
          references: [{ name: 'a', resolvedTo: 'alias' }],
          varRefs: [],
        },
      ]);
      const edges = collectDataEdges(nb);
      expect(edges).toHaveLength(1);
      expect(edges[0]).toMatchObject({ from: 'a', to: 'b' });
    });

    it('emits self-edge when cell references its own alias', () => {
      const nb = makeNotebook([
        {
          kind: 'sql',
          alias: 'recursive',
          displayIndex: 0,
          sql: 'SELECT * FROM recursive',
          references: [{ name: 'recursive', resolvedTo: 'alias' }],
          varRefs: [],
        },
      ]);
      const edges = collectDataEdges(nb);
      expect(edges).toHaveLength(1);
      expect(edges[0].from).toBe('recursive');
      expect(edges[0].to).toBe('recursive');
    });

    it('returns empty when no cross-cell references exist', () => {
      const nb = makeNotebook([
        {
          kind: 'sql',
          alias: 'a',
          displayIndex: 0,
          sql: 'SELECT * FROM jfr.gc',
          references: [{ name: 'jfr.gc', resolvedTo: 'table' }],
          varRefs: [],
        },
      ]);
      expect(collectDataEdges(nb)).toEqual([]);
    });

    it('ignores PlotBlock cells', () => {
      const nb = makeNotebook([
        {
          kind: 'plot',
          alias: 'plot1',
          displayIndex: 0,
          panels: [],
          varRefs: [],
        },
      ]);
      expect(collectDataEdges(nb)).toEqual([]);
    });

    it('handles multiple references in one cell', () => {
      const nb = makeNotebook([
        { kind: 'sql', alias: 'a', displayIndex: 0, sql: 'SELECT 1', references: [], varRefs: [] },
        { kind: 'sql', alias: 'b', displayIndex: 1, sql: 'SELECT 2', references: [], varRefs: [] },
        {
          kind: 'sql',
          alias: 'c',
          displayIndex: 2,
          sql: 'SELECT * FROM a JOIN b ON a.x = b.x',
          references: [
            { name: 'a', resolvedTo: 'cross-cell-view' },
            { name: 'b', resolvedTo: 'cross-cell-view' },
          ],
          varRefs: [],
        },
      ]);
      const edges = collectDataEdges(nb);
      expect(edges).toHaveLength(2);
      expect(edges.map((e) => e.from).sort()).toEqual(['a', 'b']);
      expect(edges.every((e) => e.to === 'c')).toBe(true);
    });
  });
  ```

- [ ] **Step 3.3** — Run failing tests.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- depGraph/edgeBuilder 2>&1 | tail -20
  ```

  Expected: tests fail with `Error: not implemented`.

---

## Task 4: Failing tests — VarEdge

- [ ] **Step 4.1** — Append VarEdge tests to `edgeBuilder.test.ts`.

  Append to `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/depGraph/edgeBuilder.test.ts`:

  ```typescript
  describe('collectVarEdges', () => {
    it('emits cell-scope VarEdge for $x in SQL', () => {
      const nb = makeNotebook([
        {
          kind: 'sql',
          alias: 'a',
          displayIndex: 0,
          sql: 'SELECT * FROM t WHERE id = $x',
          references: [],
          varRefs: [{ name: 'x', scope: 'cell', renderOnly: false }],
        },
      ]);
      const edges = collectVarEdges(nb);
      expect(edges).toEqual([
        { kind: 'var', from: 'x', to: 'a', scope: 'cell', renderOnly: false },
      ]);
    });

    it('emits global-scope VarEdge for $$global', () => {
      const nb = makeNotebook([
        {
          kind: 'sql',
          alias: 'a',
          displayIndex: 0,
          sql: 'SELECT * FROM t WHERE id = $$global',
          references: [],
          varRefs: [{ name: 'global', scope: 'global', renderOnly: false }],
        },
      ]);
      const edges = collectVarEdges(nb);
      expect(edges).toHaveLength(1);
      expect(edges[0].scope).toBe('global');
    });

    it('emits renderOnly VarEdge for var used only in plot config', () => {
      const nb = makeNotebook([
        {
          kind: 'plot',
          alias: 'p',
          displayIndex: 0,
          panels: [],
          varRefs: [{ name: 'x', scope: 'cell', renderOnly: true }],
        },
      ]);
      const edges = collectVarEdges(nb);
      expect(edges).toHaveLength(1);
      expect(edges[0].renderOnly).toBe(true);
    });

    it('does not emit VarEdge for live-scope vars', () => {
      const nb = makeNotebook([
        {
          kind: 'sql',
          alias: 'a',
          displayIndex: 0,
          sql: 'SELECT $a.brush',
          references: [],
          varRefs: [{ name: 'a.brush', scope: 'live', renderOnly: false }],
        },
      ]);
      expect(collectVarEdges(nb)).toEqual([]);
    });
  });
  ```

- [ ] **Step 4.2** — Confirm new tests fail.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- depGraph/edgeBuilder 2>&1 | grep -E "(FAIL|passed|failed)" | tail -5
  ```

  Expected: 4 more failing tests.

---

## Task 5: Failing tests — LiveVarEdge

- [ ] **Step 5.1** — Append LiveVarEdge tests to `edgeBuilder.test.ts`.

  Append:

  ```typescript
  describe('collectLiveVarEdges', () => {
    it('emits read edge for $alias.brush in SQL', () => {
      const nb = makeNotebook([
        {
          kind: 'sql',
          alias: 'gc',
          displayIndex: 0,
          sql: 'SELECT 1',
          references: [],
          varRefs: [],
        },
        {
          kind: 'sql',
          alias: 'b',
          displayIndex: 1,
          sql: 'SELECT * FROM t WHERE ts BETWEEN $gc.brush.start AND $gc.brush.end',
          references: [],
          varRefs: [{ name: 'gc.brush', scope: 'live', renderOnly: false }],
        },
      ]);
      const edges = collectLiveVarEdges(nb);
      expect(edges).toContainEqual({
        kind: 'live-var',
        from: 'gc.brush',
        to: 'b',
        direction: 'read',
        liveVarName: 'gc.brush',
      });
    });

    it('emits write edge for PlotBlock with brush mode live', () => {
      const nb = makeNotebook([
        {
          kind: 'plot',
          alias: 'gc',
          displayIndex: 0,
          panels: [
            {
              brush: { mode: 'live', variable: 'gc.brush' },
            } as Notebook['cells'][0] extends { panels: infer P } ? (P extends Array<infer E> ? E : never) : never,
          ],
          varRefs: [],
        },
      ]);
      const edges = collectLiveVarEdges(nb);
      expect(edges).toContainEqual({
        kind: 'live-var',
        from: 'gc',
        to: 'gc.brush',
        direction: 'write',
        liveVarName: 'gc.brush',
      });
    });

    it('emits write edge for brush mode progressive', () => {
      const nb = makeNotebook([
        {
          kind: 'plot',
          alias: 'gc',
          displayIndex: 0,
          panels: [
            {
              brush: { mode: 'progressive', variable: 'gc.brush' },
            } as never,
          ],
          varRefs: [],
        },
      ]);
      const edges = collectLiveVarEdges(nb);
      expect(edges.some((e) => e.direction === 'write')).toBe(true);
    });

    it('emits read edge for $!zoom shorthand', () => {
      const nb = makeNotebook([
        {
          kind: 'sql',
          alias: 'a',
          displayIndex: 0,
          sql: 'SELECT * FROM t WHERE ts BETWEEN $!zoom.start AND $!zoom.end',
          references: [],
          varRefs: [{ name: 'zoom', scope: 'live', renderOnly: false }],
        },
      ]);
      const edges = collectLiveVarEdges(nb);
      expect(edges).toHaveLength(1);
      expect(edges[0].direction).toBe('read');
    });
  });
  ```

- [ ] **Step 5.2** — Confirm tests fail.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- depGraph/edgeBuilder 2>&1 | grep -E "(passed|failed)" | tail -3
  ```

  Expected: failure count grew by 4.

---

## Task 6: Failing tests — AxisLinkEdge

- [ ] **Step 6.1** — Append AxisLinkEdge tests.

  Append to `edgeBuilder.test.ts`:

  ```typescript
  describe('collectAxisLinkEdges', () => {
    it('emits x-axis link edges between two panels sharing variable', () => {
      const nb = makeNotebook([
        {
          kind: 'plot',
          alias: 'p1',
          displayIndex: 0,
          panels: [{ linkX: { variable: 'xRange' } } as never],
          varRefs: [],
        },
        {
          kind: 'plot',
          alias: 'p2',
          displayIndex: 1,
          panels: [{ linkX: { variable: 'xRange' } } as never],
          varRefs: [],
        },
      ]);
      const edges = collectAxisLinkEdges(nb);
      expect(edges).toHaveLength(2);
      expect(edges).toContainEqual({
        kind: 'axis-link',
        from: 'p1',
        to: 'p2',
        axis: 'x',
        variable: 'xRange',
      });
      expect(edges).toContainEqual({
        kind: 'axis-link',
        from: 'p2',
        to: 'p1',
        axis: 'x',
        variable: 'xRange',
      });
    });

    it('emits y-axis link edges', () => {
      const nb = makeNotebook([
        {
          kind: 'plot',
          alias: 'p1',
          displayIndex: 0,
          panels: [{ linkY: { variable: 'yRange' } } as never],
          varRefs: [],
        },
        {
          kind: 'plot',
          alias: 'p2',
          displayIndex: 1,
          panels: [{ linkY: { variable: 'yRange' } } as never],
          varRefs: [],
        },
      ]);
      const edges = collectAxisLinkEdges(nb);
      expect(edges.every((e) => e.axis === 'y')).toBe(true);
      expect(edges).toHaveLength(2);
    });

    it('emits xy-axis link edges', () => {
      const nb = makeNotebook([
        {
          kind: 'plot',
          alias: 'p1',
          displayIndex: 0,
          panels: [{ linkXY: { variable: 'both' } } as never],
          varRefs: [],
        },
        {
          kind: 'plot',
          alias: 'p2',
          displayIndex: 1,
          panels: [{ linkXY: { variable: 'both' } } as never],
          varRefs: [],
        },
      ]);
      const edges = collectAxisLinkEdges(nb);
      expect(edges.every((e) => e.axis === 'xy')).toBe(true);
    });

    it('does not link panels with different variables', () => {
      const nb = makeNotebook([
        {
          kind: 'plot',
          alias: 'p1',
          displayIndex: 0,
          panels: [{ linkX: { variable: 'a' } } as never],
          varRefs: [],
        },
        {
          kind: 'plot',
          alias: 'p2',
          displayIndex: 1,
          panels: [{ linkX: { variable: 'b' } } as never],
          varRefs: [],
        },
      ]);
      expect(collectAxisLinkEdges(nb)).toEqual([]);
    });

    it('returns empty when only one panel uses link-x', () => {
      const nb = makeNotebook([
        {
          kind: 'plot',
          alias: 'p1',
          displayIndex: 0,
          panels: [{ linkX: { variable: 'x' } } as never],
          varRefs: [],
        },
      ]);
      expect(collectAxisLinkEdges(nb)).toEqual([]);
    });
  });
  ```

- [ ] **Step 6.2** — Confirm tests fail.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- depGraph/edgeBuilder 2>&1 | grep -E "(passed|failed)" | tail -3
  ```

  Expected: 5 more failures.

---

## Task 7: Failing tests — PromptEdge + sort invariant

- [ ] **Step 7.1** — Append PromptEdge tests.

  Append to `edgeBuilder.test.ts`:

  ```typescript
  describe('collectPromptEdges', () => {
    it('emits PromptEdge for @alias chip in last_ai_prompt', () => {
      const nb = makeNotebook([
        {
          kind: 'sql',
          alias: 'other_cell',
          displayIndex: 0,
          sql: 'SELECT 1',
          references: [],
          varRefs: [],
        },
        {
          kind: 'sql',
          alias: 'target',
          displayIndex: 1,
          sql: 'SELECT 2',
          references: [],
          varRefs: [],
          lastAiPrompt: 'Based on @other_cell show me trends',
        },
      ]);
      const edges = collectPromptEdges(nb);
      expect(edges).toEqual([
        {
          kind: 'prompt',
          from: 'other_cell',
          to: 'target',
          prompt: 'Based on @other_cell show me trends',
        },
      ]);
    });

    it('emits multiple PromptEdges when prompt mentions multiple cells', () => {
      const nb = makeNotebook([
        { kind: 'sql', alias: 'a', displayIndex: 0, sql: '1', references: [], varRefs: [] },
        { kind: 'sql', alias: 'b', displayIndex: 1, sql: '2', references: [], varRefs: [] },
        {
          kind: 'sql',
          alias: 'c',
          displayIndex: 2,
          sql: '3',
          references: [],
          varRefs: [],
          lastAiPrompt: 'Combine @a with @b',
        },
      ]);
      const edges = collectPromptEdges(nb);
      expect(edges).toHaveLength(2);
      expect(edges.map((e) => e.from).sort()).toEqual(['a', 'b']);
    });

    it('ignores @chips referring to non-existent cells', () => {
      const nb = makeNotebook([
        {
          kind: 'sql',
          alias: 'c',
          displayIndex: 0,
          sql: '3',
          references: [],
          varRefs: [],
          lastAiPrompt: 'Reference @ghost cell',
        },
      ]);
      expect(collectPromptEdges(nb)).toEqual([]);
    });

    it('returns empty when no last_ai_prompt is set', () => {
      const nb = makeNotebook([
        { kind: 'sql', alias: 'a', displayIndex: 0, sql: '1', references: [], varRefs: [] },
      ]);
      expect(collectPromptEdges(nb)).toEqual([]);
    });
  });
  ```

- [ ] **Step 7.2** — Append sort-invariant test.

  Append to `edgeBuilder.test.ts`:

  ```typescript
  describe('sorting invariant', () => {
    it('produces stable output across repeated calls (combined edges)', () => {
      const nb = makeNotebook([
        { kind: 'sql', alias: 'a', displayIndex: 0, sql: '1', references: [], varRefs: [] },
        {
          kind: 'sql',
          alias: 'b',
          displayIndex: 1,
          sql: 'SELECT * FROM a',
          references: [{ name: 'a', resolvedTo: 'cross-cell-view' }],
          varRefs: [],
        },
      ]);
      const all1 = [
        ...collectDataEdges(nb),
        ...collectVarEdges(nb),
        ...collectLiveVarEdges(nb),
        ...collectAxisLinkEdges(nb),
        ...collectPromptEdges(nb),
      ];
      const all2 = [
        ...collectDataEdges(nb),
        ...collectVarEdges(nb),
        ...collectLiveVarEdges(nb),
        ...collectAxisLinkEdges(nb),
        ...collectPromptEdges(nb),
      ];
      expect(JSON.stringify(all1)).toBe(JSON.stringify(all2));
    });
  });
  ```

- [ ] **Step 7.3** — Count failing tests.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- depGraph/edgeBuilder 2>&1 | grep -E "(passed|failed)" | tail -3
  ```

  Expected: ≥ 25 failing tests total.

---

## Task 8: Implement edgeBuilder.ts

- [ ] **Step 8.1** — Replace `edgeBuilder.ts` with complete implementation.

  Write `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/depGraph/edgeBuilder.ts`:

  ```typescript
  import type {
    AxisLinkEdge,
    Cell,
    DataEdge,
    LiveVarEdge,
    Notebook,
    PlotNode,
    PromptEdge,
    SqlStatement,
    VarEdge,
    VarRef,
  } from '../parser/types';

  // ─── helpers ────────────────────────────────────────────────────────

  function isSqlBlock(cell: Cell): cell is Extract<Cell, { kind: 'sql' }> {
    return cell.kind === 'sql';
  }

  function isPlotBlock(cell: Cell): cell is Extract<Cell, { kind: 'plot' }> {
    return cell.kind === 'plot';
  }

  function getCellAliases(notebook: Notebook): Set<string> {
    return new Set(notebook.cells.map((c) => c.alias));
  }

  // ─── DataEdge ───────────────────────────────────────────────────────

  export function collectDataEdges(notebook: Notebook): DataEdge[] {
    const aliases = getCellAliases(notebook);
    const edges: DataEdge[] = [];
    for (const cell of notebook.cells) {
      if (!isSqlBlock(cell)) continue;
      const refs = (cell as unknown as SqlStatement).references ?? [];
      for (const ref of refs) {
        if (ref.resolvedTo === 'cross-cell-view' || ref.resolvedTo === 'alias') {
          if (aliases.has(ref.name)) {
            edges.push({
              kind: 'data',
              from: ref.name,
              to: cell.alias,
              alias: ref.name,
            });
          }
        }
      }
    }
    return edges;
  }

  // ─── VarEdge ────────────────────────────────────────────────────────

  export function collectVarEdges(notebook: Notebook): VarEdge[] {
    const edges: VarEdge[] = [];
    for (const cell of notebook.cells) {
      const varRefs: VarRef[] = (cell as unknown as { varRefs?: VarRef[] }).varRefs ?? [];
      for (const v of varRefs) {
        if (v.scope === 'live') continue;
        edges.push({
          kind: 'var',
          from: v.name,
          to: cell.alias,
          scope: v.scope,
          renderOnly: v.renderOnly,
        });
      }
    }
    return edges;
  }

  // ─── LiveVarEdge ────────────────────────────────────────────────────

  type PanelWithBrush = {
    brush?: { mode?: 'live' | 'progressive' | 'static'; variable?: string };
    linkX?: { variable?: string };
    linkY?: { variable?: string };
    linkXY?: { variable?: string };
  };

  export function collectLiveVarEdges(notebook: Notebook): LiveVarEdge[] {
    const edges: LiveVarEdge[] = [];
    // reads
    for (const cell of notebook.cells) {
      const varRefs: VarRef[] = (cell as unknown as { varRefs?: VarRef[] }).varRefs ?? [];
      for (const v of varRefs) {
        if (v.scope !== 'live') continue;
        edges.push({
          kind: 'live-var',
          from: v.name,
          to: cell.alias,
          direction: 'read',
          liveVarName: v.name,
        });
      }
    }
    // writes
    for (const cell of notebook.cells) {
      if (!isPlotBlock(cell)) continue;
      const panels = (cell as unknown as PlotNode).panels ?? [];
      for (const p of panels as PanelWithBrush[]) {
        const brush = p.brush;
        if (!brush || !brush.variable) continue;
        if (brush.mode === 'live' || brush.mode === 'progressive') {
          edges.push({
            kind: 'live-var',
            from: cell.alias,
            to: brush.variable,
            direction: 'write',
            liveVarName: brush.variable,
          });
        }
      }
    }
    return edges;
  }

  // ─── AxisLinkEdge ───────────────────────────────────────────────────

  export function collectAxisLinkEdges(notebook: Notebook): AxisLinkEdge[] {
    type Slot = { alias: string; variable: string; axis: 'x' | 'y' | 'xy' };
    const slots: Slot[] = [];
    for (const cell of notebook.cells) {
      if (!isPlotBlock(cell)) continue;
      const panels = (cell as unknown as PlotNode).panels ?? [];
      for (const p of panels as PanelWithBrush[]) {
        if (p.linkX?.variable) {
          slots.push({ alias: cell.alias, variable: p.linkX.variable, axis: 'x' });
        }
        if (p.linkY?.variable) {
          slots.push({ alias: cell.alias, variable: p.linkY.variable, axis: 'y' });
        }
        if (p.linkXY?.variable) {
          slots.push({ alias: cell.alias, variable: p.linkXY.variable, axis: 'xy' });
        }
      }
    }
    const edges: AxisLinkEdge[] = [];
    for (let i = 0; i < slots.length; i++) {
      for (let j = 0; j < slots.length; j++) {
        if (i === j) continue;
        const a = slots[i];
        const b = slots[j];
        if (a.axis !== b.axis) continue;
        if (a.variable !== b.variable) continue;
        if (a.alias === b.alias) continue;
        edges.push({
          kind: 'axis-link',
          from: a.alias,
          to: b.alias,
          axis: a.axis,
          variable: a.variable,
        });
      }
    }
    // de-duplicate (same from/to/axis/variable)
    const seen = new Set<string>();
    const out: AxisLinkEdge[] = [];
    for (const e of edges) {
      const k = `${e.from} ${e.to} ${e.axis} ${e.variable}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
    }
    return out;
  }

  // ─── PromptEdge ─────────────────────────────────────────────────────

  const CHIP_RE = /@([a-z][a-z0-9_]*)/g;

  export function collectPromptEdges(notebook: Notebook): PromptEdge[] {
    const aliases = getCellAliases(notebook);
    const edges: PromptEdge[] = [];
    for (const cell of notebook.cells) {
      const prompt = (cell as unknown as { lastAiPrompt?: string }).lastAiPrompt;
      if (!prompt) continue;
      const matches = prompt.matchAll(CHIP_RE);
      const seen = new Set<string>();
      for (const m of matches) {
        const name = m[1];
        if (seen.has(name)) continue;
        seen.add(name);
        if (!aliases.has(name)) continue;
        edges.push({
          kind: 'prompt',
          from: name,
          to: cell.alias,
          prompt,
        });
      }
    }
    return edges;
  }
  ```

- [ ] **Step 8.2** — Run edgeBuilder tests.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- depGraph/edgeBuilder 2>&1 | tail -10
  ```

  Expected: all edgeBuilder tests pass (25+).

- [ ] **Step 8.3** — Verify no DOM/React imports leaked in.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  grep -E "(react|recharts|cytoscape)" src/services/depGraph/edgeBuilder.ts | wc -l | tr -d ' '
  ```

  Expected output:
  ```
  0
  ```

---

## Task 9: Implement DepGraph.ts

- [ ] **Step 9.1** — Replace `DepGraph.ts` with complete implementation.

  Write `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/depGraph/DepGraph.ts`:

  ```typescript
  import type {
    CellNode,
    DepGraph,
    GraphEdge,
    GraphNode,
    LiveVarNode,
    Notebook,
    RuntimeState,
    VarNode,
  } from '../parser/types';
  import {
    collectAxisLinkEdges,
    collectDataEdges,
    collectLiveVarEdges,
    collectPromptEdges,
    collectVarEdges,
  } from './edgeBuilder';
  import { detectStaticCycles } from './cycleDetection';

  function buildNodes(notebook: Notebook, edges: GraphEdge[]): GraphNode[] {
    const cellNodes: CellNode[] = notebook.cells.map((c) => ({
      kind: 'cell',
      alias: c.alias,
      displayIndex: c.displayIndex,
    }));

    const varNodes = new Map<string, VarNode>();
    const liveVarNodes = new Map<string, LiveVarNode>();

    for (const e of edges) {
      if (e.kind === 'var') {
        const key = `${e.scope} ${e.from}`;
        if (!varNodes.has(key)) {
          varNodes.set(key, { kind: 'var', name: e.from, scope: e.scope });
        }
      } else if (e.kind === 'live-var') {
        const name = e.liveVarName;
        if (!liveVarNodes.has(name)) {
          const producer = e.direction === 'write' ? e.from : '';
          liveVarNodes.set(name, {
            kind: 'live-var',
            name,
            producerAlias: producer,
          });
        } else if (e.direction === 'write') {
          const existing = liveVarNodes.get(name)!;
          if (!existing.producerAlias) {
            liveVarNodes.set(name, { ...existing, producerAlias: e.from });
          }
        }
      }
    }

    return [...cellNodes, ...varNodes.values(), ...liveVarNodes.values()];
  }

  function sortNodes(nodes: GraphNode[]): GraphNode[] {
    return [...nodes].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
      const an = a.kind === 'cell' ? a.alias : a.name;
      const bn = b.kind === 'cell' ? b.alias : b.name;
      return an.localeCompare(bn);
    });
  }

  function sortEdges(edges: GraphEdge[]): GraphEdge[] {
    return [...edges].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
      if (a.from !== b.from) return a.from.localeCompare(b.from);
      if (a.to !== b.to) return a.to.localeCompare(b.to);
      return JSON.stringify(a).localeCompare(JSON.stringify(b));
    });
  }

  export function computeDepGraph(
    notebook: Notebook,
    runtime: RuntimeState,
  ): DepGraph {
    const edges: GraphEdge[] = [
      ...collectDataEdges(notebook),
      ...collectVarEdges(notebook),
      ...collectLiveVarEdges(notebook),
      ...collectAxisLinkEdges(notebook),
      ...collectPromptEdges(notebook),
    ];
    const nodes = buildNodes(notebook, edges);
    const cycles = [...detectStaticCycles(edges), ...runtime.cycleBreaks];
    return {
      nodes: sortNodes(nodes),
      edges: sortEdges(edges),
      cycles,
    };
  }
  ```

- [ ] **Step 9.2** — Stub cycle detection so DepGraph imports resolve.

  Replace `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/depGraph/cycleDetection.ts` with a minimal placeholder (real impl in Task 10):

  ```typescript
  import type { Cycle, GraphEdge } from '../parser/types';

  export function detectStaticCycles(_edges: GraphEdge[]): Cycle[] {
    return [];
  }
  ```

- [ ] **Step 9.3** — Typecheck.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run typecheck
  ```

  Expected: exit code 0.

- [ ] **Step 9.4** — Run edgeBuilder tests again.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- depGraph/edgeBuilder 2>&1 | grep -E "(Tests|passed|failed)" | tail -3
  ```

  Expected: all edgeBuilder tests pass.

---

## Task 10: Cycle detection — failing tests + Tarjan impl

- [ ] **Step 10.1** — Write failing `cycleDetection.test.ts`.

  Write `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/depGraph/cycleDetection.test.ts`:

  ```typescript
  import { describe, expect, it } from 'vitest';
  import { detectStaticCycles } from '../../services/depGraph/cycleDetection';
  import type { DataEdge, GraphEdge } from '../../services/parser/types';

  function dataEdge(from: string, to: string): DataEdge {
    return { kind: 'data', from, to, alias: from };
  }

  describe('detectStaticCycles', () => {
    it('returns empty for empty edge list', () => {
      expect(detectStaticCycles([])).toEqual([]);
    });

    it('returns empty for a forward-only chain', () => {
      const edges: GraphEdge[] = [
        dataEdge('a', 'b'),
        dataEdge('b', 'c'),
        dataEdge('c', 'd'),
      ];
      expect(detectStaticCycles(edges)).toEqual([]);
    });

    it('detects a direct A→B→A cycle', () => {
      const edges: GraphEdge[] = [dataEdge('a', 'b'), dataEdge('b', 'a')];
      const cycles = detectStaticCycles(edges);
      expect(cycles).toHaveLength(1);
      expect(cycles[0].introducedBy).toBe('static');
      expect(cycles[0].edges.length).toBeGreaterThan(0);
    });

    it('detects a longer A→B→C→A cycle', () => {
      const edges: GraphEdge[] = [
        dataEdge('a', 'b'),
        dataEdge('b', 'c'),
        dataEdge('c', 'a'),
      ];
      expect(detectStaticCycles(edges)).toHaveLength(1);
    });

    it('detects a self-loop', () => {
      const edges: GraphEdge[] = [dataEdge('a', 'a')];
      const cycles = detectStaticCycles(edges);
      expect(cycles).toHaveLength(1);
    });

    it('detects two independent cycles', () => {
      const edges: GraphEdge[] = [
        dataEdge('a', 'b'),
        dataEdge('b', 'a'),
        dataEdge('c', 'd'),
        dataEdge('d', 'c'),
      ];
      expect(detectStaticCycles(edges)).toHaveLength(2);
    });

    it('does not report SCCs of size 1 (no self-loop)', () => {
      const edges: GraphEdge[] = [dataEdge('a', 'b'), dataEdge('b', 'c')];
      expect(detectStaticCycles(edges)).toEqual([]);
    });

    it('handles shared node between cycle and chain', () => {
      // a→b→c→a (cycle), c→d (chain out)
      const edges: GraphEdge[] = [
        dataEdge('a', 'b'),
        dataEdge('b', 'c'),
        dataEdge('c', 'a'),
        dataEdge('c', 'd'),
      ];
      const cycles = detectStaticCycles(edges);
      expect(cycles).toHaveLength(1);
    });

    it('handles a 50-node forward chain without reporting cycles', () => {
      const edges: GraphEdge[] = [];
      for (let i = 0; i < 49; i++) {
        edges.push(dataEdge(`n${i}`, `n${i + 1}`));
      }
      expect(detectStaticCycles(edges)).toEqual([]);
    });

    it('handles a 500-node chain without stack overflow (iterative invariant)', () => {
      const edges: GraphEdge[] = [];
      for (let i = 0; i < 499; i++) {
        edges.push(dataEdge(`n${i}`, `n${i + 1}`));
      }
      expect(() => detectStaticCycles(edges)).not.toThrow();
      expect(detectStaticCycles(edges)).toEqual([]);
    });

    it('detects cycle mixed across edge kinds (data + var)', () => {
      const edges: GraphEdge[] = [
        { kind: 'data', from: 'a', to: 'b', alias: 'a' },
        { kind: 'var', from: 'b', to: 'a', scope: 'cell', renderOnly: false },
      ];
      const cycles = detectStaticCycles(edges);
      expect(cycles).toHaveLength(1);
    });

    it('treats axis-link edges as part of the directed graph', () => {
      const edges: GraphEdge[] = [
        { kind: 'axis-link', from: 'a', to: 'b', axis: 'x', variable: 'v' },
        { kind: 'axis-link', from: 'b', to: 'a', axis: 'x', variable: 'v' },
      ];
      expect(detectStaticCycles(edges)).toHaveLength(1);
    });

    it('handles dense interconnected nodes (5-clique)', () => {
      const nodes = ['a', 'b', 'c', 'd', 'e'];
      const edges: GraphEdge[] = [];
      for (const from of nodes) {
        for (const to of nodes) {
          if (from !== to) edges.push(dataEdge(from, to));
        }
      }
      const cycles = detectStaticCycles(edges);
      expect(cycles).toHaveLength(1);
    });

    it('includes original edges of the cycle in the result', () => {
      const e1 = dataEdge('a', 'b');
      const e2 = dataEdge('b', 'a');
      const cycles = detectStaticCycles([e1, e2]);
      expect(cycles[0].edges).toEqual(expect.arrayContaining([e1, e2]));
    });

    it('produces deterministic cycle ordering when run twice', () => {
      const edges: GraphEdge[] = [
        dataEdge('a', 'b'),
        dataEdge('b', 'a'),
        dataEdge('c', 'd'),
        dataEdge('d', 'c'),
      ];
      const c1 = detectStaticCycles(edges);
      const c2 = detectStaticCycles(edges);
      expect(JSON.stringify(c1)).toBe(JSON.stringify(c2));
    });

    it('returns empty when edges form a DAG with branching', () => {
      const edges: GraphEdge[] = [
        dataEdge('a', 'b'),
        dataEdge('a', 'c'),
        dataEdge('b', 'd'),
        dataEdge('c', 'd'),
      ];
      expect(detectStaticCycles(edges)).toEqual([]);
    });
  });
  ```

- [ ] **Step 10.2** — Confirm failures.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- depGraph/cycleDetection 2>&1 | grep -E "(passed|failed)" | tail -3
  ```

  Expected: most tests fail (placeholder returns `[]` — tests expecting cycles fail).

- [ ] **Step 10.3** — Replace `cycleDetection.ts` with iterative Tarjan SCC.

  Write `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/depGraph/cycleDetection.ts`:

  ```typescript
  import type { Cycle, GraphEdge } from '../parser/types';

  /**
   * Iterative Tarjan's strongly-connected-components algorithm.
   * Returns SCCs that are either size > 1 OR a single node with a self-loop.
   * Each returned Cycle.edges contains only the input edges whose endpoints
   * are both inside the SCC.
   */
  export function detectStaticCycles(edges: GraphEdge[]): Cycle[] {
    // Build adjacency list keyed by node name.
    const adj = new Map<string, string[]>();
    const nodes = new Set<string>();
    for (const e of edges) {
      nodes.add(e.from);
      nodes.add(e.to);
      if (!adj.has(e.from)) adj.set(e.from, []);
      adj.get(e.from)!.push(e.to);
    }

    // Sort nodes for determinism.
    const orderedNodes = [...nodes].sort();

    const indexMap = new Map<string, number>();
    const lowlinkMap = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    let index = 0;
    const sccs: string[][] = [];

    type Frame = {
      node: string;
      neighborsIter: number;
      neighbors: string[];
    };

    for (const start of orderedNodes) {
      if (indexMap.has(start)) continue;

      const callStack: Frame[] = [];
      callStack.push({
        node: start,
        neighborsIter: 0,
        neighbors: (adj.get(start) ?? []).slice().sort(),
      });
      indexMap.set(start, index);
      lowlinkMap.set(start, index);
      index++;
      stack.push(start);
      onStack.add(start);

      while (callStack.length > 0) {
        const frame = callStack[callStack.length - 1];
        if (frame.neighborsIter < frame.neighbors.length) {
          const w = frame.neighbors[frame.neighborsIter];
          frame.neighborsIter++;
          if (!indexMap.has(w)) {
            indexMap.set(w, index);
            lowlinkMap.set(w, index);
            index++;
            stack.push(w);
            onStack.add(w);
            callStack.push({
              node: w,
              neighborsIter: 0,
              neighbors: (adj.get(w) ?? []).slice().sort(),
            });
          } else if (onStack.has(w)) {
            const cur = lowlinkMap.get(frame.node)!;
            const wIdx = indexMap.get(w)!;
            if (wIdx < cur) lowlinkMap.set(frame.node, wIdx);
          }
        } else {
          const v = frame.node;
          if (lowlinkMap.get(v) === indexMap.get(v)) {
            const scc: string[] = [];
            while (true) {
              const w = stack.pop()!;
              onStack.delete(w);
              scc.push(w);
              if (w === v) break;
            }
            sccs.push(scc);
          }
          callStack.pop();
          if (callStack.length > 0) {
            const parent = callStack[callStack.length - 1];
            const pLow = lowlinkMap.get(parent.node)!;
            const vLow = lowlinkMap.get(v)!;
            if (vLow < pLow) lowlinkMap.set(parent.node, vLow);
          }
        }
      }
    }

    // Build cycles: SCC size > 1, or size 1 with a self-loop.
    const cycles: Cycle[] = [];
    // Stable order: sort each SCC, then sort SCCs.
    const sortedSccs = sccs
      .map((s) => [...s].sort())
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

    for (const scc of sortedSccs) {
      const set = new Set(scc);
      if (scc.length === 1) {
        const node = scc[0];
        const hasSelfLoop = (adj.get(node) ?? []).some((t) => t === node);
        if (!hasSelfLoop) continue;
      }
      const sccEdges = edges.filter((e) => set.has(e.from) && set.has(e.to));
      cycles.push({ edges: sccEdges, introducedBy: 'static' });
    }
    return cycles;
  }
  ```

- [ ] **Step 10.4** — Run cycle detection tests.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- depGraph/cycleDetection 2>&1 | tail -10
  ```

  Expected: all 16 cycle tests pass.

---

## Task 11: Property tests + perf fixture

- [ ] **Step 11.1** — Verify fast-check is installed.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  node -e "console.log(require('fast-check/package.json').version)"
  ```

  Expected: a version string starting `3.`. If missing:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm install --save-dev fast-check@^3.22.0
  ```

- [ ] **Step 11.2** — Write `DepGraph.property.test.ts`.

  Write `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/depGraph/DepGraph.property.test.ts`:

  ```typescript
  import fc from 'fast-check';
  import { describe, expect, it } from 'vitest';
  import { computeDepGraph } from '../../services/depGraph/DepGraph';
  import type { Cell, Notebook, RuntimeState, VarRef } from '../../services/parser/types';

  // ─── Arbitraries ────────────────────────────────────────────────────

  const aliasArb = fc.stringMatching(/^[a-z][a-z0-9_]{0,6}$/);

  function notebookFromAliases(aliases: string[], allowFwdRefs: boolean): Notebook {
    const unique = Array.from(new Set(aliases));
    const cells: Cell[] = unique.map((alias, i) => {
      const refs = allowFwdRefs
        ? unique.slice(0, i).map((n) => ({ name: n, resolvedTo: 'cross-cell-view' as const }))
        : [];
      const varRefs: VarRef[] = [];
      return {
        kind: 'sql',
        alias,
        displayIndex: i,
        sql: 'SELECT 1',
        references: refs,
        varRefs,
      } as unknown as Cell;
    });
    return { frontmatter: {}, cells };
  }

  const emptyRuntime: RuntimeState = { cycleBreaks: [], liveVars: {} };

  // ─── Property 1: determinism ────────────────────────────────────────

  describe('DepGraph properties', () => {
    it('Property 1: same input yields byte-identical JSON (1000 iters)', () => {
      fc.assert(
        fc.property(fc.array(aliasArb, { minLength: 1, maxLength: 10 }), (aliases) => {
          const nb = notebookFromAliases(aliases, true);
          const g1 = computeDepGraph(nb, emptyRuntime);
          const g2 = computeDepGraph(nb, emptyRuntime);
          return JSON.stringify(g1) === JSON.stringify(g2);
        }),
        { numRuns: 1000 },
      );
    });

    // ─── Property 2: purity (no mutation) ─────────────────────────────

    it('Property 2: does not mutate notebook input (1000 iters)', () => {
      fc.assert(
        fc.property(fc.array(aliasArb, { minLength: 1, maxLength: 10 }), (aliases) => {
          const nb = notebookFromAliases(aliases, true);
          const snapshotBefore = JSON.stringify(nb);
          computeDepGraph(nb, emptyRuntime);
          const snapshotAfter = JSON.stringify(nb);
          return snapshotBefore === snapshotAfter;
        }),
        { numRuns: 1000 },
      );
    });

    // ─── Property 3: acyclic-on-acyclic-input ────────────────────────

    it('Property 3: forward-only references produce zero cycles (1000 iters)', () => {
      fc.assert(
        fc.property(fc.array(aliasArb, { minLength: 2, maxLength: 8 }), (aliases) => {
          const nb = notebookFromAliases(aliases, true);
          const g = computeDepGraph(nb, emptyRuntime);
          return g.cycles.length === 0;
        }),
        { numRuns: 1000 },
      );
    });

    // ─── Property 4: no dangling edges ────────────────────────────────

    it('Property 4: every edge endpoint corresponds to a node (1000 iters)', () => {
      fc.assert(
        fc.property(fc.array(aliasArb, { minLength: 1, maxLength: 10 }), (aliases) => {
          const nb = notebookFromAliases(aliases, true);
          const g = computeDepGraph(nb, emptyRuntime);
          const nodeNames = new Set(
            g.nodes.map((n) => (n.kind === 'cell' ? n.alias : n.name)),
          );
          for (const e of g.edges) {
            if (!nodeNames.has(e.from) || !nodeNames.has(e.to)) return false;
          }
          return true;
        }),
        { numRuns: 1000 },
      );
    });
  });
  ```

- [ ] **Step 11.3** — Run property tests.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- depGraph/DepGraph.property 2>&1 | tail -10
  ```

  Expected: 4 properties pass (each at 1000 runs).

- [ ] **Step 11.4** — Generate the 100-cell perf fixture.

  Create the generator script at `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/scripts/gen-perf-fixture.mjs`:

  ```javascript
  import { mkdirSync, writeFileSync } from 'node:fs';
  import { dirname, resolve } from 'node:path';
  import { fileURLToPath } from 'node:url';

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(__dirname, '../../tests/fixtures/notebooks/perf-100cells.notebook.md');

  const N = 100;
  const VAR_COUNT = 30;

  const lines = ['---', 'title: Perf fixture (100 cells)', '---', ''];

  for (let i = 0; i < N; i++) {
    const alias = `cell_${i}`;
    lines.push(`## ${alias}`);
    lines.push('');
    lines.push('```sql');
    if (i === 0) {
      lines.push('SELECT * FROM jfr.gc');
    } else {
      const varName = `v${i % VAR_COUNT}`;
      lines.push(`SELECT * FROM cell_${i - 1} WHERE x = $${varName}`);
    }
    lines.push('```');
    lines.push('');
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`Wrote ${outPath} (${lines.length} lines)`);
  ```

  Run it:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  node scripts/gen-perf-fixture.mjs
  ```

  Expected output:
  ```
  Wrote /Users/i560383_1/code/experiments/jfr-query/frontend-v2/../tests/fixtures/notebooks/perf-100cells.notebook.md (...)
  ```

  Verify:
  ```bash
  wc -l /Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/fixtures/notebooks/perf-100cells.notebook.md | awk '{print $1}'
  ```

  Expected output:
  ```
  504
  ```

- [ ] **Step 11.5** — Add perf bench assertion.

  Append to `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/depGraph/DepGraph.property.test.ts`:

  ```typescript
  // ─── Perf gate ──────────────────────────────────────────────────────

  import { readFileSync } from 'node:fs';
  import { resolve } from 'node:path';
  import { parseNotebook } from '../../services/parser/notebookParser';

  describe('DepGraph perf', () => {
    it('computes 100-cell notebook DepGraph p95 < 30ms', () => {
      const fixturePath = resolve(
        __dirname,
        '../../../tests/fixtures/notebooks/perf-100cells.notebook.md',
      );
      const src = readFileSync(fixturePath, 'utf8');
      const nb = parseNotebook(src);
      // Warmup
      for (let i = 0; i < 5; i++) computeDepGraph(nb, emptyRuntime);
      const samples: number[] = [];
      for (let i = 0; i < 50; i++) {
        const t0 = performance.now();
        computeDepGraph(nb, emptyRuntime);
        samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);
      const p95 = samples[Math.floor(samples.length * 0.95)];
      expect(p95).toBeLessThan(30);
    });
  });
  ```

  Note: if `parseNotebook` is not exported, use the actual export name from `frontend-v2/src/services/parser/notebookParser.ts` (M-A1 should export it).

- [ ] **Step 11.6** — Run perf bench.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- depGraph/DepGraph.property 2>&1 | tail -10
  ```

  Expected: perf test passes (p95 well under 30ms).

---

## Task 12: Gate + commit

- [ ] **Step 12.1** — Run full depGraph suite.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- depGraph 2>&1 | tail -15
  ```

  Expected: ≥ 55 tests pass (≥ 25 edgeBuilder + ≥ 16 cycleDetection + 4 property + 1 perf + initial DataEdge tests). 0 failed.

- [ ] **Step 12.2** — Typecheck.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run typecheck
  ```

  Expected: exit code 0.

- [ ] **Step 12.3** — Stage files.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query
  git add frontend-v2/src/services/depGraph/ \
    frontend-v2/src/__tests__/depGraph/ \
    frontend-v2/src/services/parser/types.ts \
    frontend-v2/tests/fixtures/notebooks/perf-100cells.notebook.md \
    frontend-v2/scripts/gen-perf-fixture.mjs
  git status --short
  ```

  Expected: 8–10 files staged (all under `frontend-v2/`).

- [ ] **Step 12.4** — Commit.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query
  git commit -m "$(cat <<'EOF'
  feat(v2): M-A4 dep graph — 5 edge kinds, Tarjan SCC, property tests

  - DataEdge / VarEdge / LiveVarEdge / AxisLinkEdge / PromptEdge collectors
  - Iterative Tarjan SCC cycle detection (no stack-overflow on 500-node chains)
  - Canonical node + edge ordering (deterministic JSON output)
  - 4 fast-check properties at 1000 iters: determinism, purity, acyclic-on-DAG, no dangling edges
  - 100-cell perf fixture; p95 < 30ms
  - Pure module: no DOM, no React, no recharts/cytoscape imports
  EOF
  )"
  ```

  Expected: commit succeeds; pre-commit hook (if any) runs typecheck + tests.

- [ ] **Step 12.5** — Verify commit.

  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query
  git log -1 --oneline
  git status --short
  ```

  Expected: latest commit references M-A4; working tree clean.

---

## Done

- 5 edge kinds implemented as pure collectors
- Iterative Tarjan SCC (no recursion → no stack overflow on 500+ node chains)
- 4 fast-check properties × 1000 iters
- 100-cell perf gate < 30ms p95
- All depGraph tests pass; typecheck clean; commit landed
