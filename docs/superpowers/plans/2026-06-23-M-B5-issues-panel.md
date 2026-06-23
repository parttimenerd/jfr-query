# M-B5: Issues Panel + Diagnostic Rendering + Quickfix Menu Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans.
> **Testing standard:** See docs/superpowers/TESTING_STANDARD.md — all 5 layers apply.

**Goal:** Ship the right-edge **Issues** panel, the per-cell **error-band** highlight, and the **⌥↵ quickfix menu** that lets a user fix a diagnostic with a keystroke. The panel aggregates `Diagnostic` records from every source (notebook parser M-A1, SQL parser M-A2, plot-DSL parser M-A3, dep-graph cycle detector M-A4, formatter M-A5, and a runtime stub for Phase D), deduplicates them, renders one row per diagnostic with a severity glyph, kind, message, and source location, announces new diagnostics via `aria-live="polite"`, and lets the user click a row to scroll the offending cell into view with a transient outline. Pressing ⌥↵ inside an editor near a diagnostic opens a quickfix menu populated from a `quickfixRegistry`; selecting a suggestion mutates the notebook source. The six canonical diagnostic kinds from the spec (`SugarOnly`, `UnknownPlotType`, `UnknownClause`, `UnterminatedBrace`, `BrushProducerUnnamed`, `CycleIntroduced`) each have at least one quickfix; "fix with agent" is rendered as a disabled menu item for every quickfix list with the Phase D TODO marker.

**Architecture:** A pure `DiagnosticRegistry` service maintains an observable, deduplicated, severity-ordered list of diagnostics. Producers (parsers, formatter, dep-graph cycle detector) push into the registry via `registry.set(sourceTag, diagnostics)`; the registry replaces all diagnostics under that tag atomically (so removing a parser error means a re-parse with no errors clears the previous batch). A separate pure `QuickfixRegistry` maps `DiagnosticKind` → array of `QuickfixFactory` functions. Each factory takes `(diagnostic, notebook) → Quickfix[]`. Each `Quickfix` carries a `label`, an `apply(notebook) → Notebook` function, and an `agent: boolean` flag (true for the disabled Phase-D "fix with agent" entry). The UI is split into `IssuesPanel` (subscribes to the registry, renders rows + filter chips + collapse toggle), `DiagnosticRow` (one row, click-to-jump, severity glyph), and `QuickfixMenu` (a portal-mounted contextual menu opened by ⌥↵ inside any editor). The menu reads the diagnostic at the cursor position via a `useDiagnosticAtCursor` hook that consults the registry. A `revealCell` event bus (a simple `EventTarget` singleton) bridges the panel (click row) and the cell column (scroll into view + flash). A `notebookMutationBus` lets quickfixes commit their changes back to the live notebook source.

**Tech Stack:** React 19.2, TypeScript 5.8, Vite 6.2, Tailwind v4 (CSS-first, `[data-theme="dark"]`), Vitest 4.1.9 (pool: forks), @testing-library/react 16.3.0, @testing-library/user-event 14.6.1, @testing-library/jest-dom 6.6.3, Playwright 1.61.0, AxeBuilder from @axe-core/playwright.

---

## Pre-resolved decisions

### DECISION 1: Diagnostic source contract
A "source" is the canonical producer of a class of diagnostics. The registry knows six sources:

| Tag | Producer | Implemented by |
|-----|----------|----------------|
| `parser:notebook` | M-A1 — fence ordering, alias missing, unknown frontmatter keys | live |
| `parser:sql` | M-A2 — `ParseError`, `UnknownIdentifier`, `SecretLeakPrevented` | live |
| `parser:plot` | M-A3 — `SugarOnly`, `UnknownPlotType`, `UnknownClause`, `UnterminatedBrace` | live |
| `depGraph` | M-A4 — `CycleIntroduced`, `BrushProducerUnnamed` | live |
| `formatter` | M-A5 — `FormatterError` | live |
| `runtime` | Phase D — execution errors (DuckDB, agent tools) | **stub** |

Sources push the **full** list under their tag with `registry.set(tag, diagnostics)`. The registry's deduplication key is `(sourceTag, cellAlias, offset, length, kind)` — same key from the same source overwrites. Rationale: this lets parsers re-emit on every keystroke without leaking stale entries.

### DECISION 2: Severity order and ranking
Within the registry, entries are sorted by (severity rank ascending, then `cellDisplayIndex` ascending, then `offset` ascending). Severity rank: `error = 0`, `warning = 1`, `info = 2`. Rationale: errors first, then warnings, then info; within a severity, walk the notebook top-to-bottom.

### DECISION 3: Diagnostic kind glyph table
- `error` → `✕` (red)
- `warning` → `⚠` (amber)
- `info` → `ℹ` (blue)

Glyphs are rendered with `aria-hidden="true"`; the row's accessible name is built from severity + kind + message (e.g. `aria-label="error: SugarOnly — line {N}: …"`). Rationale: §10a.1 forbids colour-only encoding.

### DECISION 4: `Quickfix` interface — extension to the parser types
The existing `parser/types.ts` does not yet export a `Quickfix` interface. We add one and extend `Diagnostic` with an optional `suggestions?: QuickfixSuggestion[]` field. We do **not** modify the existing `Diagnostic` consumers (they already accept extra fields via TypeScript structural typing). The extension lives next to the issue-handling code:

```ts
// src/services/diagnostics/types.ts
import type { Diagnostic, Notebook } from '../parser/types';

export interface QuickfixSuggestion {
  label: string;
  /** Pure-data hint a factory may consume to produce a Quickfix. */
  payload: Record<string, unknown>;
}

export interface Quickfix {
  id: string;
  label: string;
  /** True for stub "fix with agent" entries; rendered disabled in the menu. */
  agent: boolean;
  apply: (notebook: Notebook) => Notebook;
}

export interface DiagnosticWithLocation extends Diagnostic {
  cellAlias: string | null;
  cellDisplayIndex: number;
  /** Optional textual suggestions exported by the producing parser (M-A3 emits these for SugarOnly). */
  suggestions?: QuickfixSuggestion[];
}

export type DiagnosticSource =
  | 'parser:notebook'
  | 'parser:sql'
  | 'parser:plot'
  | 'depGraph'
  | 'formatter'
  | 'runtime';
```

Rationale: keeps the existing `Diagnostic` interface untouched; the registry layer carries location-resolved variants.

### DECISION 5: Registry as an `EventTarget`
The registry is a class that extends `EventTarget` and emits a `'change'` event whenever the merged list changes. React components subscribe via a `useSyncExternalStore`-style adapter so renders are O(1) per subscriber. Rationale: avoids pulling in a state library; aligns with browser-native APIs already used elsewhere.

### DECISION 6: ⌥↵ menu positioning
The menu is portal-mounted at `document.body` and positioned absolutely at the active editor's cursor `(clientX, clientY)` plus a small `(0, 20)` offset. On overflow, the menu flips to render above the cursor. Open via a global `keydown` handler that fires when `event.altKey && event.key === 'Enter'`. Close on Escape, on click outside, or after `apply()` runs. The menu component lives in the panel module but the keystroke handler is wired by `useQuickfixHotkey` so it can be installed inside `CellView` (the only place a cursor-relative position makes sense). Rationale: keeps the menu portable while letting the cell editor own the trigger.

### DECISION 7: Click-to-jump uses a synchronous event bus
A module-level `revealCellBus` is an `EventTarget` exporting `dispatch(alias, line?)` and `subscribe(handler)`. Cells listen and call `element.scrollIntoView({ block: 'center' })` plus add a `data-flash="true"` attribute for 800ms (CSS animation handles the flash). Rationale: avoids prop-drilling a context through every cell; the bus is trivially mockable in tests.

### DECISION 8: "Fix with agent" stub
Every quickfix list ends with one synthetic entry:
```ts
{
  id: 'agent.delegate',
  label: 'Fix with agent (Phase D)',
  agent: true,
  apply: (n) => n, // no-op
}
```
The menu renders `agent: true` rows with `aria-disabled="true"`, `tabIndex={-1}`, and `title="Available in Phase D"`. Activating one is a no-op. Rationale: keeps the UI surface stable when Phase D lands; tests can already assert the row is present.

### DECISION 9: Quickfix mutation surface
`Quickfix.apply(notebook)` returns a new `Notebook` (immutable). The host (`CellView` or the orchestrator) reads the result and writes it back via the existing notebook-source state setter (introduced in M-B1/B2). For the purposes of this plan we expose a `notebookMutationBus` (mirror of `revealCellBus`) that dispatches `{ next: Notebook }` events; the existing notebook owner subscribes in Step 11.

### DECISION 10: Quickfix payload semantics per kind
The six canonical kinds each implement at least one factory:

- **SugarOnly** — payload: `{ sugarSource: string; offset: number; length: number }`. Quickfix labels: "Rewrite as sugar form" → splices `sugarSource` into the cell's plot-block source.
- **UnknownPlotType** — payload: `{ token: string; offset: number; length: number }`. Quickfix labels: "Replace with `line`", "Replace with `bar`" — best-guess by Levenshtein distance to the 12 valid plot names. We pick the top two suggestions.
- **UnknownClause** — payload: `{ clause: string; offset: number; length: number }`. Quickfix labels: "Remove unknown clause", "Did you mean `<closest>`?" — Levenshtein against the union of `PanelClauses ∪ ContainerClauses` keys.
- **UnterminatedBrace** — payload: `{ insertAt: number }`. Quickfix label: "Insert missing `}`".
- **BrushProducerUnnamed** — payload: `{ panelOffset: number; suggestedName: string }`. Quickfix label: "Add `name: \"<alias>\"` to producer panel".
- **CycleIntroduced** — payload: `{ cycle: Cycle; liveEdgeOffset: number; liveEdgeLength: number }`. Quickfix label: "Break cycle by demoting live edge" — rewrites the `$!x` token at the offset to `$x`.

Each factory receives `(diagnostic, notebook)` and returns the per-diagnostic list. Where a payload field is missing (because the producer did not emit it), the factory returns the agent-stub only and logs a `console.debug` so a developer can see which producer fell short.

---

## Steps

### Step 1 — Create the diagnostic types module

- [ ] **1.1** Create `src/services/diagnostics/types.ts`:

```ts
import type { Diagnostic, Notebook } from '../parser/types';

export interface QuickfixSuggestion {
  label: string;
  payload: Record<string, unknown>;
}

export interface Quickfix {
  id: string;
  label: string;
  /** True for stub "Fix with agent" entries; rendered disabled. */
  agent: boolean;
  apply: (notebook: Notebook) => Notebook;
}

export interface DiagnosticWithLocation extends Diagnostic {
  cellAlias: string | null;
  cellDisplayIndex: number;
  suggestions?: QuickfixSuggestion[];
}

export type DiagnosticSource =
  | 'parser:notebook'
  | 'parser:sql'
  | 'parser:plot'
  | 'depGraph'
  | 'formatter'
  | 'runtime';

export interface DiagnosticEntry extends DiagnosticWithLocation {
  source: DiagnosticSource;
}
```

- [ ] **1.2** Run `npx tsc --noEmit` — must pass.

---

### Step 2 — Implement the registry (DiagnosticRegistry)

- [ ] **2.1** Create `src/services/diagnostics/diagnosticRegistry.ts`:

```ts
import type { DiagnosticEntry, DiagnosticSource } from './types';

const SEVERITY_RANK: Record<DiagnosticEntry['severity'], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

function entryKey(e: DiagnosticEntry): string {
  return `${e.source}|${e.cellAlias ?? ''}|${e.offset}|${e.length}|${e.kind}`;
}

function entryCompare(a: DiagnosticEntry, b: DiagnosticEntry): number {
  const sr = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (sr !== 0) return sr;
  const di = a.cellDisplayIndex - b.cellDisplayIndex;
  if (di !== 0) return di;
  return a.offset - b.offset;
}

export class DiagnosticRegistry extends EventTarget {
  private bySource = new Map<DiagnosticSource, DiagnosticEntry[]>();

  /** Atomically replace all diagnostics for a given source. */
  set(source: DiagnosticSource, entries: DiagnosticEntry[]): void {
    const tagged = entries.map((e) => ({ ...e, source }));
    this.bySource.set(source, tagged);
    this.dispatchEvent(new Event('change'));
  }

  clear(source: DiagnosticSource): void {
    if (this.bySource.has(source)) {
      this.bySource.delete(source);
      this.dispatchEvent(new Event('change'));
    }
  }

  clearAll(): void {
    if (this.bySource.size === 0) return;
    this.bySource.clear();
    this.dispatchEvent(new Event('change'));
  }

  getAll(): DiagnosticEntry[] {
    const seen = new Map<string, DiagnosticEntry>();
    for (const list of this.bySource.values()) {
      for (const e of list) {
        seen.set(entryKey(e), e);
      }
    }
    return [...seen.values()].sort(entryCompare);
  }

  subscribe(handler: () => void): () => void {
    this.addEventListener('change', handler);
    return () => this.removeEventListener('change', handler);
  }
}

/** Singleton — components subscribe to this instance. */
export const diagnosticRegistry = new DiagnosticRegistry();
```

- [ ] **2.2** Run `npx tsc --noEmit`.

---

### Step 3 — Unit-test the registry (Red phase)

- [ ] **3.1** Create `src/__tests__/diagnostics/diagnosticRegistry.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiagnosticRegistry } from '../../services/diagnostics/diagnosticRegistry';
import type { DiagnosticEntry } from '../../services/diagnostics/types';

function makeEntry(over: Partial<DiagnosticEntry> = {}): DiagnosticEntry {
  return {
    source: 'parser:plot',
    kind: 'SugarOnly',
    severity: 'warning',
    message: 'Use the sugar form',
    offset: 0,
    length: 0,
    cellAlias: 'gc_overview',
    cellDisplayIndex: 2,
    ...over,
  };
}

describe('DiagnosticRegistry', () => {
  let reg: DiagnosticRegistry;
  beforeEach(() => {
    reg = new DiagnosticRegistry();
  });

  it('starts empty', () => {
    expect(reg.getAll()).toEqual([]);
  });

  it('set() stores entries under the given source', () => {
    reg.set('parser:plot', [makeEntry({ offset: 10 })]);
    expect(reg.getAll()).toHaveLength(1);
    expect(reg.getAll()[0].source).toBe('parser:plot');
  });

  it('set() replaces previous entries for the same source', () => {
    reg.set('parser:plot', [makeEntry({ offset: 10 })]);
    reg.set('parser:plot', [makeEntry({ offset: 20 })]);
    expect(reg.getAll()).toHaveLength(1);
    expect(reg.getAll()[0].offset).toBe(20);
  });

  it('emits a "change" event on set()', () => {
    const spy = vi.fn();
    reg.subscribe(spy);
    reg.set('parser:plot', [makeEntry()]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('deduplicates within a single source by (cellAlias, offset, length, kind)', () => {
    reg.set('parser:plot', [
      makeEntry({ offset: 5, kind: 'SugarOnly' }),
      makeEntry({ offset: 5, kind: 'SugarOnly' }),
    ]);
    expect(reg.getAll()).toHaveLength(1);
  });

  it('preserves entries from different sources', () => {
    reg.set('parser:plot', [makeEntry({ kind: 'SugarOnly' })]);
    reg.set('depGraph', [makeEntry({ kind: 'UnknownClause' })]);
    expect(reg.getAll()).toHaveLength(2);
  });

  it('sorts by severity, then displayIndex, then offset', () => {
    reg.set('parser:plot', [
      makeEntry({ severity: 'info', cellDisplayIndex: 1, offset: 0 }),
      makeEntry({ severity: 'error', cellDisplayIndex: 3, offset: 100 }),
      makeEntry({ severity: 'warning', cellDisplayIndex: 2, offset: 50 }),
    ]);
    const all = reg.getAll();
    expect(all[0].severity).toBe('error');
    expect(all[1].severity).toBe('warning');
    expect(all[2].severity).toBe('info');
  });

  it('clear() drops a single source and notifies', () => {
    const spy = vi.fn();
    reg.set('parser:plot', [makeEntry()]);
    reg.set('depGraph', [makeEntry({ kind: 'CycleIntroduced' as const })]);
    reg.subscribe(spy);
    reg.clear('parser:plot');
    expect(reg.getAll().every((e) => e.source !== 'parser:plot')).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('clear() on an absent source does not fire change', () => {
    const spy = vi.fn();
    reg.subscribe(spy);
    reg.clear('runtime');
    expect(spy).not.toHaveBeenCalled();
  });

  it('clearAll() drops everything and notifies once', () => {
    const spy = vi.fn();
    reg.set('parser:plot', [makeEntry()]);
    reg.subscribe(spy);
    reg.clearAll();
    expect(reg.getAll()).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **3.2** Run `npx vitest run src/__tests__/diagnostics/diagnosticRegistry.test.ts`. Tests must PASS.

---

### Step 4 — Implement quickfix factories per kind

- [ ] **4.1** Create `src/services/diagnostics/quickfixHelpers.ts`:

```ts
const PLOT_NAMES = [
  'line', 'bar', 'scatter', 'histogram', 'boxplot', 'heatmap',
  'pie', 'flamegraph', 'table', 'gantt', 'area', 'range',
] as const;

const CLAUSE_NAMES = [
  'title', 'width', 'height', 'name', 'settings', 'disabled',
  'on_hover', 'on_selection', 'on_brush', 'zoom', 'brush',
  'highlight', 'palette', 'legend', 'tooltip', 'on',
  'link-x', 'link-y', 'link-xy',
] as const;

/** Standard Levenshtein distance. Bounded for our short strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export function closestPlotNames(token: string, limit = 2): string[] {
  return [...PLOT_NAMES]
    .map((p) => ({ name: p, d: levenshtein(token, p) }))
    .sort((a, b) => a.d - b.d || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((x) => x.name);
}

export function closestClause(token: string): string | null {
  const ranked = [...CLAUSE_NAMES]
    .map((c) => ({ name: c, d: levenshtein(token, c) }))
    .sort((a, b) => a.d - b.d || a.name.localeCompare(b.name));
  if (ranked.length === 0) return null;
  const best = ranked[0];
  return best.d <= Math.max(2, Math.floor(token.length / 2)) ? best.name : null;
}

/** Locate the cell within a Notebook by alias, returning index or -1. */
export function findCellIndex(notebook: { cells: { alias: string | null }[] }, alias: string | null): number {
  if (alias === null) return -1;
  return notebook.cells.findIndex((c) => c.alias === alias);
}
```

- [ ] **4.2** Create `src/services/diagnostics/quickfixRegistry.ts`:

```ts
import type { Notebook } from '../parser/types';
import type {
  DiagnosticEntry,
  Quickfix,
} from './types';
import { closestClause, closestPlotNames, findCellIndex } from './quickfixHelpers';

/** A factory returns 0..N concrete quickfixes for a given diagnostic + notebook context. */
export type QuickfixFactory = (diag: DiagnosticEntry, notebook: Notebook) => Quickfix[];

const AGENT_STUB: Quickfix = {
  id: 'agent.delegate',
  label: 'Fix with agent (Phase D)',
  agent: true,
  apply: (n) => n,
};

/** Replace a span [offset, offset+length) inside `source` with `replacement`. */
function spliceSource(source: string, offset: number, length: number, replacement: string): string {
  return source.slice(0, offset) + replacement + source.slice(offset + length);
}

/** Apply a per-cell, per-block-kind source mutation by alias. */
function mutateBlockSource(
  notebook: Notebook,
  cellAlias: string | null,
  blockKind: 'sql' | 'plot' | 'view' | 'macro' | 'prose',
  mutator: (source: string) => string,
): Notebook {
  const ix = findCellIndex(notebook, cellAlias);
  if (ix < 0) return notebook;
  const cell = notebook.cells[ix];
  const blocks = cell.blocks.map((b) =>
    b.kind === blockKind ? { ...b, source: mutator(b.source) } : b,
  );
  const newCell = { ...cell, blocks };
  const cells = notebook.cells.slice();
  cells[ix] = newCell;
  return { ...notebook, cells };
}

const sugarOnly: QuickfixFactory = (d) => {
  const suggestion = d.suggestions?.[0];
  if (suggestion === undefined) return [AGENT_STUB];
  const sugarSource = suggestion.payload.sugarSource;
  if (typeof sugarSource !== 'string') return [AGENT_STUB];
  return [
    {
      id: 'sugarOnly.rewrite',
      label: 'Rewrite as sugar form',
      agent: false,
      apply: (n) =>
        mutateBlockSource(n, d.cellAlias, 'plot', (src) =>
          spliceSource(src, d.offset, d.length, sugarSource),
        ),
    },
    AGENT_STUB,
  ];
};

const unknownPlotType: QuickfixFactory = (d) => {
  const token = typeof d.suggestions?.[0]?.payload.token === 'string'
    ? (d.suggestions?.[0]?.payload.token as string)
    : '';
  if (token === '') return [AGENT_STUB];
  const candidates = closestPlotNames(token, 2);
  return [
    ...candidates.map((name): Quickfix => ({
      id: `unknownPlotType.replace.${name}`,
      label: `Replace with \`${name}\``,
      agent: false,
      apply: (n) =>
        mutateBlockSource(n, d.cellAlias, 'plot', (src) =>
          spliceSource(src, d.offset, d.length, name),
        ),
    })),
    AGENT_STUB,
  ];
};

const unknownClause: QuickfixFactory = (d) => {
  const clause = typeof d.suggestions?.[0]?.payload.clause === 'string'
    ? (d.suggestions?.[0]?.payload.clause as string)
    : '';
  if (clause === '') return [AGENT_STUB];
  const closest = closestClause(clause);
  const fixes: Quickfix[] = [
    {
      id: 'unknownClause.remove',
      label: 'Remove unknown clause',
      agent: false,
      apply: (n) =>
        mutateBlockSource(n, d.cellAlias, 'plot', (src) =>
          spliceSource(src, d.offset, d.length, ''),
        ),
    },
  ];
  if (closest !== null) {
    fixes.push({
      id: `unknownClause.replace.${closest}`,
      label: `Did you mean \`${closest}\`?`,
      agent: false,
      apply: (n) =>
        mutateBlockSource(n, d.cellAlias, 'plot', (src) =>
          spliceSource(src, d.offset, d.length, closest),
        ),
    });
  }
  fixes.push(AGENT_STUB);
  return fixes;
};

const unterminatedBrace: QuickfixFactory = (d) => {
  const insertAtRaw = d.suggestions?.[0]?.payload.insertAt;
  const insertAt = typeof insertAtRaw === 'number' ? insertAtRaw : d.offset + d.length;
  return [
    {
      id: 'unterminatedBrace.insert',
      label: 'Insert missing `}`',
      agent: false,
      apply: (n) =>
        mutateBlockSource(n, d.cellAlias, 'plot', (src) =>
          spliceSource(src, insertAt, 0, '}'),
        ),
    },
    AGENT_STUB,
  ];
};

const brushProducerUnnamed: QuickfixFactory = (d, notebook) => {
  const sugRaw = d.suggestions?.[0]?.payload;
  const panelOffset =
    typeof sugRaw?.panelOffset === 'number' ? sugRaw.panelOffset : null;
  if (panelOffset === null) return [AGENT_STUB];
  const ix = findCellIndex(notebook, d.cellAlias);
  const fallbackName =
    ix >= 0 ? notebook.cells[ix].alias ?? `cell_${ix}` : 'producer';
  const suggestedName =
    typeof sugRaw?.suggestedName === 'string' ? sugRaw.suggestedName : fallbackName;
  return [
    {
      id: 'brushProducerUnnamed.add',
      label: `Add name: "${suggestedName}" to producer panel`,
      agent: false,
      apply: (n) =>
        mutateBlockSource(n, d.cellAlias, 'plot', (src) =>
          spliceSource(src, panelOffset, 0, `name: "${suggestedName}"\n`),
        ),
    },
    AGENT_STUB,
  ];
};

const cycleIntroduced: QuickfixFactory = (d) => {
  const offRaw = d.suggestions?.[0]?.payload.liveEdgeOffset;
  const lenRaw = d.suggestions?.[0]?.payload.liveEdgeLength;
  if (typeof offRaw !== 'number' || typeof lenRaw !== 'number') return [AGENT_STUB];
  return [
    {
      id: 'cycleIntroduced.demote',
      label: 'Break cycle by demoting live edge',
      agent: false,
      apply: (n) =>
        // The live edge may live in either a sql or plot block; try sql first.
        mutateBlockSource(n, d.cellAlias, 'sql', (src) => {
          if (offRaw + lenRaw > src.length) return src;
          const slice = src.slice(offRaw, offRaw + lenRaw);
          return spliceSource(src, offRaw, lenRaw, slice.replace('$!', '$'));
        }),
    },
    AGENT_STUB,
  ];
};

export class QuickfixRegistry {
  private factories = new Map<string, QuickfixFactory[]>();

  register(kind: string, factory: QuickfixFactory): void {
    const list = this.factories.get(kind) ?? [];
    list.push(factory);
    this.factories.set(kind, list);
  }

  resolve(diag: DiagnosticEntry, notebook: Notebook): Quickfix[] {
    const list = this.factories.get(diag.kind) ?? [];
    const fixes = list.flatMap((f) => f(diag, notebook));
    // Always end with the agent stub if no other fix included one.
    if (!fixes.some((f) => f.agent)) fixes.push(AGENT_STUB);
    return fixes;
  }
}

export const quickfixRegistry = new QuickfixRegistry();
quickfixRegistry.register('SugarOnly', sugarOnly);
quickfixRegistry.register('UnknownPlotType', unknownPlotType);
quickfixRegistry.register('UnknownClause', unknownClause);
quickfixRegistry.register('UnterminatedBrace', unterminatedBrace);
quickfixRegistry.register('BrushProducerUnnamed', brushProducerUnnamed);
quickfixRegistry.register('CycleIntroduced', cycleIntroduced);
```

- [ ] **4.3** Note: `BrushProducerUnnamed` and `CycleIntroduced` are not yet in `DiagnosticKind` from `parser/types.ts`. Extend that union — add `'BrushProducerUnnamed'` and `'CycleIntroduced'` to the `DiagnosticKind` type. This is a tiny additive change; no existing producer emits them yet (M-A4 stubs them out), so no compilation regression elsewhere is expected.

- [ ] **4.4** Edit `src/services/parser/types.ts` to extend `DiagnosticKind`:

```ts
export type DiagnosticKind =
  | 'FenceOrderWarning'
  | 'UnterminatedFence'
  | 'MissingCellAlias'
  | 'UnknownFrontmatterKey'
  | 'SugarOnly'
  | 'UnknownPlotType'
  | 'UnknownClause'
  | 'UnterminatedBrace'
  | 'BrushProducerUnnamed'
  | 'CycleIntroduced'
  | 'ParseError'
  | 'UnknownIdentifier'
  | 'SecretLeakPrevented'
  | 'FormatterError';
```

- [ ] **4.5** `npx tsc --noEmit`.

---

### Step 5 — Unit-test quickfix factories (Red phase)

- [ ] **5.1** Create `src/__tests__/diagnostics/quickfixRegistry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { QuickfixRegistry, quickfixRegistry } from '../../services/diagnostics/quickfixRegistry';
import type { DiagnosticEntry } from '../../services/diagnostics/types';
import type { Notebook } from '../../services/parser/types';

function nb(cellAlias: string, blockKind: 'sql' | 'plot', source: string): Notebook {
  return {
    frontmatter: {},
    cells: [
      {
        displayIndex: 1,
        alias: cellAlias,
        frontmatter: {},
        blocks: [{ kind: blockKind, source }],
      },
    ],
  };
}

function diag(over: Partial<DiagnosticEntry> = {}): DiagnosticEntry {
  return {
    source: 'parser:plot',
    kind: 'SugarOnly',
    severity: 'warning',
    message: '',
    offset: 0,
    length: 0,
    cellAlias: 'a',
    cellDisplayIndex: 1,
    ...over,
  };
}

describe('QuickfixRegistry — each kind has at least one fix', () => {
  it.each([
    'SugarOnly',
    'UnknownPlotType',
    'UnknownClause',
    'UnterminatedBrace',
    'BrushProducerUnnamed',
    'CycleIntroduced',
  ] as const)('%s resolves to >=1 quickfix', (kind) => {
    const fixes = quickfixRegistry.resolve(
      diag({ kind, suggestions: [{ label: '', payload: synthPayload(kind) }] }),
      nb('a', 'plot', 'PLACEHOLDER'),
    );
    expect(fixes.length).toBeGreaterThanOrEqual(1);
  });
});

function synthPayload(kind: DiagnosticEntry['kind']): Record<string, unknown> {
  switch (kind) {
    case 'SugarOnly':
      return { sugarSource: 'line { x: "t" }', offset: 0, length: 9 };
    case 'UnknownPlotType':
      return { token: 'LINE_CHART', offset: 0, length: 10 };
    case 'UnknownClause':
      return { clause: 'titel', offset: 0, length: 5 };
    case 'UnterminatedBrace':
      return { insertAt: 5 };
    case 'BrushProducerUnnamed':
      return { panelOffset: 0, suggestedName: 'gc_overview' };
    case 'CycleIntroduced':
      return { liveEdgeOffset: 0, liveEdgeLength: 7 };
    default:
      return {};
  }
}

describe('SugarOnly quickfix applies the sugar source', () => {
  it('replaces the diagnostic span with the sugar suggestion', () => {
    const before = nb('a', 'plot', 'LINE_CHART(x="t")');
    const fixes = quickfixRegistry.resolve(
      diag({
        kind: 'SugarOnly',
        offset: 0,
        length: 17,
        suggestions: [{ label: '', payload: { sugarSource: 'line { x: "t" }' } }],
      }),
      before,
    );
    const concrete = fixes.find((f) => !f.agent)!;
    const after = concrete.apply(before);
    expect((after.cells[0].blocks[0] as { source: string }).source).toBe('line { x: "t" }');
  });
});

describe('UnterminatedBrace quickfix inserts a brace', () => {
  it('inserts `}` at the suggested offset', () => {
    const before = nb('a', 'plot', 'line { x: "t"');
    const fixes = quickfixRegistry.resolve(
      diag({
        kind: 'UnterminatedBrace',
        offset: 13,
        length: 0,
        suggestions: [{ label: '', payload: { insertAt: 13 } }],
      }),
      before,
    );
    const concrete = fixes.find((f) => !f.agent)!;
    const after = concrete.apply(before);
    expect((after.cells[0].blocks[0] as { source: string }).source).toBe('line { x: "t"}');
  });
});

describe('UnknownPlotType ranks suggestions by edit distance', () => {
  it('suggests `line` for "lne" and at most two candidates', () => {
    const before = nb('a', 'plot', 'lne { x: "t" }');
    const fixes = quickfixRegistry.resolve(
      diag({
        kind: 'UnknownPlotType',
        offset: 0,
        length: 3,
        suggestions: [{ label: '', payload: { token: 'lne' } }],
      }),
      before,
    );
    const labels = fixes.filter((f) => !f.agent).map((f) => f.label);
    expect(labels[0]).toBe('Replace with `line`');
    expect(labels.length).toBeLessThanOrEqual(2);
  });
});

describe('UnknownClause uses Levenshtein for "did you mean"', () => {
  it('suggests `title` for "titel"', () => {
    const before = nb('a', 'plot', 'line { titel: "t" }');
    const fixes = quickfixRegistry.resolve(
      diag({
        kind: 'UnknownClause',
        offset: 7,
        length: 5,
        suggestions: [{ label: '', payload: { clause: 'titel' } }],
      }),
      before,
    );
    expect(fixes.find((f) => f.label.includes('`title`'))).toBeTruthy();
  });
});

describe('CycleIntroduced demotes `$!` to `$`', () => {
  it('rewrites the live token at the offset', () => {
    const before = nb('a', 'sql', 'WHERE t = $!brush');
    const fixes = quickfixRegistry.resolve(
      diag({
        kind: 'CycleIntroduced',
        offset: 10,
        length: 7,
        suggestions: [{ label: '', payload: { liveEdgeOffset: 10, liveEdgeLength: 7 } }],
      }),
      before,
    );
    const concrete = fixes.find((f) => !f.agent)!;
    const after = concrete.apply(before);
    expect((after.cells[0].blocks[0] as { source: string }).source).toBe('WHERE t = $brush');
  });
});

describe('BrushProducerUnnamed inserts a name clause', () => {
  it('adds name: "<alias>" at the panel offset', () => {
    const before = nb('gc_overview', 'plot', 'line { x: "t" }');
    const fixes = quickfixRegistry.resolve(
      diag({
        kind: 'BrushProducerUnnamed',
        offset: 0,
        length: 0,
        cellAlias: 'gc_overview',
        suggestions: [{ label: '', payload: { panelOffset: 0, suggestedName: 'gc_overview' } }],
      }),
      before,
    );
    const concrete = fixes.find((f) => !f.agent)!;
    const after = concrete.apply(before);
    expect((after.cells[0].blocks[0] as { source: string }).source).toContain(
      'name: "gc_overview"',
    );
  });
});

describe('Agent stub is always present', () => {
  it('appends `agent.delegate` when no other fix did', () => {
    const reg = new QuickfixRegistry();
    const fixes = reg.resolve(diag(), nb('a', 'plot', ''));
    expect(fixes).toHaveLength(1);
    expect(fixes[0].agent).toBe(true);
    expect(fixes[0].id).toBe('agent.delegate');
  });
});
```

- [ ] **5.2** Run `npx vitest run src/__tests__/diagnostics/quickfixRegistry.test.ts`. Tests must PASS.

---

### Step 6 — Build event buses (reveal + mutation)

- [ ] **6.1** Create `src/services/diagnostics/revealCellBus.ts`:

```ts
export interface RevealCellEvent {
  alias: string;
  line?: number;
}

class RevealBus extends EventTarget {
  dispatch(ev: RevealCellEvent): void {
    this.dispatchEvent(new CustomEvent<RevealCellEvent>('reveal', { detail: ev }));
  }

  subscribe(handler: (ev: RevealCellEvent) => void): () => void {
    const wrapped = (e: Event): void => handler((e as CustomEvent<RevealCellEvent>).detail);
    this.addEventListener('reveal', wrapped);
    return () => this.removeEventListener('reveal', wrapped);
  }
}

export const revealCellBus = new RevealBus();
```

- [ ] **6.2** Create `src/services/diagnostics/notebookMutationBus.ts`:

```ts
import type { Notebook } from '../parser/types';

export interface NotebookMutation {
  next: Notebook;
  reason: string;
}

class MutationBus extends EventTarget {
  dispatch(ev: NotebookMutation): void {
    this.dispatchEvent(new CustomEvent<NotebookMutation>('mutate', { detail: ev }));
  }

  subscribe(handler: (ev: NotebookMutation) => void): () => void {
    const wrapped = (e: Event): void => handler((e as CustomEvent<NotebookMutation>).detail);
    this.addEventListener('mutate', wrapped);
    return () => this.removeEventListener('mutate', wrapped);
  }
}

export const notebookMutationBus = new MutationBus();
```

- [ ] **6.3** `npx tsc --noEmit`.

---

### Step 7 — React hook `useDiagnostics` for subscribing

- [ ] **7.1** Create `src/services/diagnostics/useDiagnostics.ts`:

```ts
import { useSyncExternalStore } from 'react';
import { diagnosticRegistry } from './diagnosticRegistry';
import type { DiagnosticEntry } from './types';

let cache: DiagnosticEntry[] = diagnosticRegistry.getAll();
let cacheKey = 0;
diagnosticRegistry.subscribe(() => {
  cache = diagnosticRegistry.getAll();
  cacheKey += 1;
});

function subscribe(cb: () => void): () => void {
  return diagnosticRegistry.subscribe(cb);
}

function getSnapshot(): DiagnosticEntry[] {
  return cache;
}

export function useDiagnostics(): DiagnosticEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** For test isolation. */
export function _resetDiagnosticsCache(): void {
  cache = [];
  cacheKey += 1;
}
```

- [ ] **7.2** Note the caching pattern: we update `cache` on `change`. `useSyncExternalStore` requires `getSnapshot` to be referentially stable across renders, hence the module-level mutable cache (replaced on each event). Tests must call `_resetDiagnosticsCache()` between cases.

---

### Step 8 — Build `DiagnosticRow` + `IssuesPanel` (Red phase: tests first)

- [ ] **8.1** Create `src/components/issues/DiagnosticRow.tsx`:

```tsx
import { useCallback } from 'react';
import type { JSX } from 'react';
import type { DiagnosticEntry } from '../../services/diagnostics/types';
import { revealCellBus } from '../../services/diagnostics/revealCellBus';

const GLYPH: Record<DiagnosticEntry['severity'], string> = {
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

const COLOR: Record<DiagnosticEntry['severity'], string> = {
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-blue-500',
};

export interface DiagnosticRowProps {
  diagnostic: DiagnosticEntry;
}

export function DiagnosticRow({ diagnostic }: DiagnosticRowProps): JSX.Element {
  const reveal = useCallback(() => {
    if (diagnostic.cellAlias !== null) {
      revealCellBus.dispatch({ alias: diagnostic.cellAlias });
    }
  }, [diagnostic.cellAlias]);

  const cellRef =
    diagnostic.cellAlias === null
      ? `(notebook)`
      : `#${diagnostic.cellDisplayIndex} ${diagnostic.cellAlias}`;

  const accessibleName = `${diagnostic.severity}: ${diagnostic.kind} — ${cellRef}: ${diagnostic.message}`;

  return (
    <button
      type="button"
      role="button"
      onClick={reveal}
      aria-label={accessibleName}
      data-testid="diagnostic-row"
      data-severity={diagnostic.severity}
      data-kind={diagnostic.kind}
      className="flex w-full items-start gap-2 rounded px-2 py-1 text-left text-sm hover:bg-[--color-bg-overlay] focus:bg-[--color-bg-overlay] focus:outline-none focus-visible:ring-2 focus-visible:ring-[--color-fg-focus]"
    >
      <span aria-hidden="true" className={COLOR[diagnostic.severity]}>
        {GLYPH[diagnostic.severity]}
      </span>
      <span className="flex-1">
        <span className="font-mono text-xs text-[--color-fg-muted]">{cellRef}</span>
        <span className="ml-1 text-[--color-fg-base]">{diagnostic.message}</span>
        <span className="ml-2 rounded bg-[--color-bg-overlay] px-1 py-0.5 text-[10px] uppercase text-[--color-fg-muted]">
          {diagnostic.kind}
        </span>
      </span>
    </button>
  );
}
```

- [ ] **8.2** Create `src/components/issues/IssuesPanel.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useDiagnostics } from '../../services/diagnostics/useDiagnostics';
import { DiagnosticRow } from './DiagnosticRow';

const COLLAPSED_KEY = 'jfr-notebook.issuesPanel.collapsed';

function loadCollapsed(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(COLLAPSED_KEY) === 'true';
}

function saveCollapsed(value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(COLLAPSED_KEY, value ? 'true' : 'false');
}

export function IssuesPanel(): JSX.Element {
  const diagnostics = useDiagnostics();
  const [collapsed, setCollapsed] = useState<boolean>(loadCollapsed());
  const previousKeys = useRef(new Set<string>());
  const [announcement, setAnnouncement] = useState<string>('');

  useEffect(() => {
    const next = new Set(diagnostics.map((d) => `${d.source}|${d.cellAlias ?? ''}|${d.offset}|${d.kind}`));
    const added: string[] = [];
    for (const d of diagnostics) {
      const k = `${d.source}|${d.cellAlias ?? ''}|${d.offset}|${d.kind}`;
      if (!previousKeys.current.has(k)) added.push(d.kind);
    }
    previousKeys.current = next;
    if (added.length > 0) {
      setAnnouncement(`${added.length} new diagnostic${added.length === 1 ? '' : 's'}: ${added.slice(0, 3).join(', ')}`);
    }
  }, [diagnostics]);

  function toggle(): void {
    setCollapsed((c) => {
      const next = !c;
      saveCollapsed(next);
      return next;
    });
  }

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;

  return (
    <aside
      role="region"
      aria-label="issues"
      data-testid="issues-panel"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={`flex h-full flex-col border-l border-[--color-border] bg-[--color-bg-elevated] transition-[width] ${collapsed ? 'w-10' : 'w-[280px]'}`}
    >
      <header className="flex items-center justify-between border-b border-[--color-border] px-2 py-1">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand issues panel' : 'Collapse issues panel'}
          className="text-xs text-[--color-fg-muted] hover:text-[--color-fg-base]"
        >
          {collapsed ? '«' : '»'}
        </button>
        {!collapsed ? (
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[--color-fg-muted]">
            Issues
            <span className="ml-2 text-[10px] text-red-500">{errorCount}</span>
            <span className="ml-1 text-[10px] text-amber-500">{warningCount}</span>
          </h2>
        ) : (
          <span aria-hidden="true" className="text-xs text-red-500">
            {errorCount}
          </span>
        )}
      </header>
      {!collapsed ? (
        <ul
          className="flex flex-1 flex-col gap-1 overflow-auto p-1"
          role="list"
          aria-label="diagnostic list"
        >
          {diagnostics.length === 0 ? (
            <li className="px-2 py-1 text-xs text-[--color-fg-muted]">No diagnostics.</li>
          ) : (
            diagnostics.map((d) => (
              <li key={`${d.source}|${d.cellAlias ?? ''}|${d.offset}|${d.kind}`}>
                <DiagnosticRow diagnostic={d} />
              </li>
            ))
          )}
        </ul>
      ) : null}
      <div role="status" aria-live="polite" className="sr-only" data-testid="issues-announcement">
        {announcement}
      </div>
    </aside>
  );
}
```

- [ ] **8.3** `npx tsc --noEmit`.

---

### Step 9 — Unit tests for IssuesPanel + DiagnosticRow

- [ ] **9.1** Create `src/__tests__/issues/IssuesPanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IssuesPanel } from '../../components/issues/IssuesPanel';
import { diagnosticRegistry } from '../../services/diagnostics/diagnosticRegistry';
import { _resetDiagnosticsCache } from '../../services/diagnostics/useDiagnostics';
import { revealCellBus } from '../../services/diagnostics/revealCellBus';
import type { DiagnosticEntry } from '../../services/diagnostics/types';

function entry(over: Partial<DiagnosticEntry> = {}): DiagnosticEntry {
  return {
    source: 'parser:plot',
    kind: 'SugarOnly',
    severity: 'warning',
    message: 'Use the sugar form',
    offset: 0,
    length: 0,
    cellAlias: 'gc_overview',
    cellDisplayIndex: 2,
    ...over,
  };
}

beforeEach(() => {
  diagnosticRegistry.clearAll();
  _resetDiagnosticsCache();
  localStorage.clear();
});

afterEach(cleanup);

describe('IssuesPanel', () => {
  it('renders empty state when no diagnostics', () => {
    render(<IssuesPanel />);
    expect(screen.getByText(/no diagnostics/i)).toBeInTheDocument();
  });

  it('renders one row per diagnostic', () => {
    diagnosticRegistry.set('parser:plot', [
      entry({ kind: 'SugarOnly' }),
      entry({ kind: 'UnknownClause', offset: 10 }),
    ]);
    render(<IssuesPanel />);
    const rows = screen.getAllByTestId('diagnostic-row');
    expect(rows).toHaveLength(2);
  });

  it('renders six canonical kinds when each is present', () => {
    const kinds = [
      'SugarOnly',
      'UnknownPlotType',
      'UnknownClause',
      'UnterminatedBrace',
      'BrushProducerUnnamed',
      'CycleIntroduced',
    ] as const;
    diagnosticRegistry.set(
      'parser:plot',
      kinds.map((k, i) => entry({ kind: k, offset: i * 10 })),
    );
    render(<IssuesPanel />);
    for (const k of kinds) {
      expect(screen.getByText(k)).toBeInTheDocument();
    }
  });

  it('clicking a row dispatches reveal on the bus', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const unsubscribe = revealCellBus.subscribe(spy);
    diagnosticRegistry.set('parser:plot', [entry({ cellAlias: 'gc_overview' })]);
    render(<IssuesPanel />);
    await user.click(screen.getByTestId('diagnostic-row'));
    expect(spy).toHaveBeenCalledWith({ alias: 'gc_overview' });
    unsubscribe();
  });

  it('announces newly-added diagnostics via aria-live region', async () => {
    render(<IssuesPanel />);
    expect(screen.getByTestId('issues-announcement').textContent).toBe('');
    diagnosticRegistry.set('parser:plot', [entry({ kind: 'SugarOnly' })]);
    // Wait a tick for effect to flush.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId('issues-announcement').textContent).toMatch(/SugarOnly/);
  });

  it('collapsible — toggle persists to localStorage', async () => {
    const user = userEvent.setup();
    render(<IssuesPanel />);
    const toggle = screen.getByRole('button', { name: /collapse issues panel/i });
    await user.click(toggle);
    expect(localStorage.getItem('jfr-notebook.issuesPanel.collapsed')).toBe('true');
    expect(screen.getByTestId('issues-panel').getAttribute('data-collapsed')).toBe('true');
  });

  it('renders rows sorted by severity', () => {
    diagnosticRegistry.set('parser:plot', [
      entry({ severity: 'info', offset: 0 }),
      entry({ severity: 'error', offset: 10 }),
      entry({ severity: 'warning', offset: 5 }),
    ]);
    render(<IssuesPanel />);
    const rows = screen.getAllByTestId('diagnostic-row');
    expect(rows[0].getAttribute('data-severity')).toBe('error');
    expect(rows[1].getAttribute('data-severity')).toBe('warning');
    expect(rows[2].getAttribute('data-severity')).toBe('info');
  });
});
```

- [ ] **9.2** Run `npx vitest run src/__tests__/issues/IssuesPanel.test.tsx`. All must pass.

---

### Step 10 — Build QuickfixMenu + useQuickfixHotkey

- [ ] **10.1** Create `src/components/issues/QuickfixMenu.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { JSX } from 'react';
import type { Quickfix } from '../../services/diagnostics/types';

export interface QuickfixMenuProps {
  open: boolean;
  position: { x: number; y: number };
  fixes: Quickfix[];
  onApply: (fix: Quickfix) => void;
  onClose: () => void;
}

export function QuickfixMenu({
  open,
  position,
  fixes,
  onApply,
  onClose,
}: QuickfixMenuProps): JSX.Element | null {
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      previousFocus.current = document.activeElement as HTMLElement | null;
      setActiveIndex(fixes.findIndex((f) => !f.agent));
      // Defer focus so the portal node is mounted.
      requestAnimationFrame(() => {
        containerRef.current?.querySelector<HTMLButtonElement>('[data-active="true"]')?.focus();
      });
    } else if (previousFocus.current !== null) {
      previousFocus.current.focus();
    }
  }, [open, fixes]);

  const handleKey = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => {
          let next = i;
          for (let step = 1; step <= fixes.length; step += 1) {
            const cand = (i + step) % fixes.length;
            if (!fixes[cand].agent) { next = cand; break; }
          }
          return next;
        });
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => {
          let next = i;
          for (let step = 1; step <= fixes.length; step += 1) {
            const cand = (i - step + fixes.length) % fixes.length;
            if (!fixes[cand].agent) { next = cand; break; }
          }
          return next;
        });
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const fix = fixes[activeIndex];
        if (fix !== undefined && !fix.agent) onApply(fix);
      }
    },
    [fixes, activeIndex, onApply, onClose],
  );

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={containerRef}
      role="menu"
      aria-label="Quickfix suggestions"
      onKeyDown={handleKey}
      data-testid="quickfix-menu"
      style={{ position: 'absolute', left: position.x, top: position.y, zIndex: 60 }}
      className="min-w-[260px] rounded-md border border-[--color-border] bg-[--color-bg-elevated] py-1 shadow-xl"
    >
      {fixes.map((fix, ix) => (
        <button
          key={fix.id}
          type="button"
          role="menuitem"
          aria-disabled={fix.agent}
          tabIndex={fix.agent ? -1 : ix === activeIndex ? 0 : -1}
          data-active={ix === activeIndex ? 'true' : 'false'}
          data-fix-id={fix.id}
          disabled={fix.agent}
          onClick={() => {
            if (!fix.agent) onApply(fix);
          }}
          title={fix.agent ? 'Available in Phase D' : ''}
          className={`flex w-full items-center px-3 py-1 text-left text-sm ${
            fix.agent ? 'opacity-40' : 'hover:bg-[--color-bg-overlay] focus:bg-[--color-bg-overlay]'
          }`}
        >
          {fix.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
```

- [ ] **10.2** Create `src/components/issues/useQuickfixHotkey.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { diagnosticRegistry } from '../../services/diagnostics/diagnosticRegistry';
import { notebookMutationBus } from '../../services/diagnostics/notebookMutationBus';
import { quickfixRegistry } from '../../services/diagnostics/quickfixRegistry';
import type { DiagnosticEntry, Quickfix } from '../../services/diagnostics/types';
import type { Notebook } from '../../services/parser/types';

export interface QuickfixHotkeyState {
  open: boolean;
  position: { x: number; y: number };
  fixes: Quickfix[];
  diagnostic: DiagnosticEntry | null;
}

export function useQuickfixHotkey(getNotebook: () => Notebook | null): {
  state: QuickfixHotkeyState;
  close: () => void;
  apply: (fix: Quickfix) => void;
} {
  const [state, setState] = useState<QuickfixHotkeyState>({
    open: false,
    position: { x: 0, y: 0 },
    fixes: [],
    diagnostic: null,
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!(event.altKey && event.key === 'Enter')) return;
      const target = event.target as HTMLElement | null;
      if (target === null) return;
      const cellEl = target.closest<HTMLElement>('[data-cell-alias]');
      const cellAlias = cellEl?.dataset.cellAlias ?? null;
      const all = diagnosticRegistry.getAll();
      // Find the first diagnostic whose cellAlias matches the cursor's cell.
      const diag = all.find((d) => d.cellAlias === cellAlias) ?? all[0];
      if (diag === undefined) return;
      const notebook = getNotebook();
      if (notebook === null) return;
      event.preventDefault();
      const rect = target.getBoundingClientRect();
      setState({
        open: true,
        position: { x: rect.left + 8, y: rect.bottom + 4 },
        fixes: quickfixRegistry.resolve(diag, notebook),
        diagnostic: diag,
      });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [getNotebook]);

  const close = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
  }, []);

  const apply = useCallback(
    (fix: Quickfix) => {
      if (fix.agent) return;
      const notebook = getNotebook();
      if (notebook === null) return;
      const next = fix.apply(notebook);
      notebookMutationBus.dispatch({ next, reason: `quickfix:${fix.id}` });
      setState((s) => ({ ...s, open: false }));
    },
    [getNotebook],
  );

  return { state, close, apply };
}
```

- [ ] **10.3** `npx tsc --noEmit`.

---

### Step 11 — Unit tests for QuickfixMenu

- [ ] **11.1** Create `src/__tests__/issues/QuickfixMenu.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickfixMenu } from '../../components/issues/QuickfixMenu';
import type { Quickfix } from '../../services/diagnostics/types';

afterEach(cleanup);

function fix(over: Partial<Quickfix> = {}): Quickfix {
  return {
    id: 'x',
    label: 'do thing',
    agent: false,
    apply: (n) => n,
    ...over,
  };
}

describe('QuickfixMenu', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <QuickfixMenu
        open={false}
        position={{ x: 0, y: 0 }}
        fixes={[]}
        onApply={() => {}}
        onClose={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders one menuitem per fix', () => {
    render(
      <QuickfixMenu
        open
        position={{ x: 0, y: 0 }}
        fixes={[fix({ id: 'a', label: 'A' }), fix({ id: 'b', label: 'B' })]}
        onApply={() => {}}
        onClose={() => {}}
      />,
    );
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(2);
  });

  it('renders the agent stub as aria-disabled with Phase D tooltip', () => {
    render(
      <QuickfixMenu
        open
        position={{ x: 0, y: 0 }}
        fixes={[fix(), fix({ id: 'agent.delegate', label: 'Fix with agent (Phase D)', agent: true })]}
        onApply={() => {}}
        onClose={() => {}}
      />,
    );
    const agent = screen.getByText(/fix with agent/i);
    expect(agent.getAttribute('aria-disabled')).toBe('true');
    expect(agent.getAttribute('title')).toBe('Available in Phase D');
  });

  it('Enter applies the active fix', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <QuickfixMenu
        open
        position={{ x: 0, y: 0 }}
        fixes={[fix({ id: 'a', label: 'A' })]}
        onApply={onApply}
        onClose={() => {}}
      />,
    );
    await user.keyboard('{Enter}');
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('Escape calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <QuickfixMenu
        open
        position={{ x: 0, y: 0 }}
        fixes={[fix()]}
        onApply={() => {}}
        onClose={onClose}
      />,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('ArrowDown skips the agent stub when navigating', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <QuickfixMenu
        open
        position={{ x: 0, y: 0 }}
        fixes={[
          fix({ id: 'a', label: 'A' }),
          fix({ id: 'agent.delegate', label: 'Agent', agent: true }),
          fix({ id: 'b', label: 'B' }),
        ]}
        onApply={onApply}
        onClose={() => {}}
      />,
    );
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('click outside calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <div>
        <button data-testid="outside">outside</button>
        <QuickfixMenu
          open
          position={{ x: 0, y: 0 }}
          fixes={[fix()]}
          onApply={() => {}}
          onClose={onClose}
        />
      </div>,
    );
    await user.click(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **11.2** Run `npx vitest run src/__tests__/issues/QuickfixMenu.test.tsx`. Must pass.

---

### Step 12 — Wire the panel + hotkey into AppShell

- [ ] **12.1** Modify `src/components/shell/AppShell.tsx` to:
1. Accept an optional `notebook?: Notebook` prop (already added by M-B4 step 11).
2. Render `<IssuesPanel />` as the right rail, between `<main>` and the closing `<div>`.
3. Compose with the M-B4 `<DepGraphSource />` block already inserted.

Sketch of the new layout body:

```tsx
<div className="flex flex-1 min-h-0">
  <div className="flex items-start"><Sidebar /* … */ /></div>
  <main className="flex-1 overflow-auto">{children}</main>
  <IssuesPanel />
</div>
```

Add import: `import { IssuesPanel } from '../issues/IssuesPanel';`.

- [ ] **12.2** In whichever component owns the live notebook state (introduced by M-B1 / M-B2 — typically a `NotebookProvider` or the top-level `NotebookView`), subscribe to `notebookMutationBus` and apply mutations:

```ts
useEffect(() => {
  const unsub = notebookMutationBus.subscribe(({ next }) => {
    setNotebook(next);
  });
  return unsub;
}, [setNotebook]);
```

If the existing code uses a different setter name, adapt accordingly. Add a TODO comment if the live state owner is not yet wired (the e2e in Step 14 will catch the omission).

- [ ] **12.3** In `CellView` (the cell renderer from M-B2), opt into the hotkey by reading a `getNotebook` reference. Add this snippet inside `CellView`:

```tsx
import { useQuickfixHotkey } from '../issues/useQuickfixHotkey';
import { QuickfixMenu } from '../issues/QuickfixMenu';
// inside CellView, given a `notebookRef: React.RefObject<Notebook | null>`:
const { state, close, apply } = useQuickfixHotkey(() => notebookRef.current);
// near the end of JSX:
<QuickfixMenu open={state.open} position={state.position} fixes={state.fixes} onApply={apply} onClose={close} />
```

If `CellView` does not yet have a `notebookRef`, add one from props (parent component supplies `useRef(notebook)` and updates the ref via `useEffect`). The wiring detail can vary — record any deviation in the commit message.

- [ ] **12.4** Mark the offending DOM nodes with `data-cell-alias={cell.alias}` on the cell container so the hotkey's `closest('[data-cell-alias]')` can resolve the cell from the cursor target.

- [ ] **12.5** `npx tsc --noEmit`; `npx vitest run src/__tests__/shell/AppShell.test.tsx` must still pass.

---

### Step 13 — Producer wiring: pipe parser/depGraph/formatter diagnostics into the registry

- [ ] **13.1** Identify where each producer's output is consumed in the live app:
- **Notebook parser (M-A1)**: emits diagnostics in the same call that returns the `Notebook`. The host (top-level state) should call `diagnosticRegistry.set('parser:notebook', resolveLocations(diagnostics, notebook))` after every parse.
- **SQL parser (M-A2)**: called per SQL block; collect across cells, then `set('parser:sql', …)`.
- **Plot DSL parser (M-A3)**: same as SQL but for plot blocks; `set('parser:plot', …)`.
- **Dep graph (M-A4)**: every recompute → `set('depGraph', diagnostics)`.
- **Formatter (M-A5)**: every format → `set('formatter', diagnostics)`.

- [ ] **13.2** Add a tiny helper `src/services/diagnostics/resolveLocations.ts`:

```ts
import type { Diagnostic, Notebook } from '../parser/types';
import type { DiagnosticEntry, DiagnosticSource } from './types';

/**
 * Attach cellAlias + cellDisplayIndex to a bare Diagnostic. The offset is treated
 * as a byte offset within the notebook source; this helper walks the cells'
 * source spans (provided by the notebook parser via `_raw`) to map offsets to cells.
 * If a cell's `_raw` is not available, falls back to `(null, 0)`.
 */
export function resolveLocations(
  diagnostics: Diagnostic[],
  notebook: Notebook,
  source: DiagnosticSource,
): DiagnosticEntry[] {
  const cellSpans: { start: number; end: number; alias: string | null; displayIndex: number }[] = [];
  let cursor = 0;
  for (const cell of notebook.cells) {
    const raw = cell._raw ?? '';
    cellSpans.push({
      start: cursor,
      end: cursor + raw.length,
      alias: cell.alias,
      displayIndex: cell.displayIndex,
    });
    cursor += raw.length;
  }
  return diagnostics.map((d) => {
    const span = cellSpans.find((s) => d.offset >= s.start && d.offset < s.end);
    return {
      ...d,
      source,
      cellAlias: span?.alias ?? null,
      cellDisplayIndex: span?.displayIndex ?? 0,
    };
  });
}
```

- [ ] **13.3** Producers that already know their cell context (per-block parsers like M-A2 SQL parser) can build `DiagnosticEntry` directly without going through `resolveLocations`. The helper is for whole-notebook producers (M-A1, M-A5).

- [ ] **13.4** In the top-level orchestrator (likely `NotebookView` or a `notebookEngine` hook from M-B2), after each parse cycle call:

```ts
diagnosticRegistry.set('parser:notebook', resolveLocations(parsed.diagnostics, parsed.notebook, 'parser:notebook'));
```

Repeat per producer. The exact integration site depends on existing wiring — if multiple parse points exist, prefer a single `runPipeline()` function in `services/pipeline` that owns the calls.

- [ ] **13.5** Stub for runtime (Phase D): create a no-op exported helper for future use:

```ts
// src/services/diagnostics/runtimeStub.ts
import { diagnosticRegistry } from './diagnosticRegistry';

/** TODO(M-D*): replace with real runtime error handler. */
export function reportRuntimeError(_args: unknown): void {
  diagnosticRegistry.set('runtime', []);
}
```

- [ ] **13.6** `npx tsc --noEmit`.

---

### Step 14 — Playwright e2e: SugarOnly → ⌥↵ → accept → source rewritten

- [ ] **14.1** Add a fixture URL parameter to the app entry: `?fixture=quickfixSugarOnly` loads a 1-cell notebook with a plot block containing `LINE_CHART(x="t")`. The plot parser (M-A3) is expected to emit a `SugarOnly` diagnostic with a `sugarSource` suggestion. If M-A3 does not yet emit `suggestions` for `SugarOnly`, prepend an interim emitter inside the fixture loader that synthesises the diagnostic with the right `suggestions` payload — and leave a TODO comment so the real M-A3 emitter overrides it.

  In `src/main.tsx`, add:

  ```ts
  if (params.get('fixture') === 'quickfixSugarOnly') {
    const { quickfixSugarOnlyFixture } = await import('./__tests__/issues/fixtures/quickfixSugarOnly');
    // bootstrap with this notebook
  }
  ```

  Fixture file `src/__tests__/issues/fixtures/quickfixSugarOnly.ts`:

  ```ts
  import { diagnosticRegistry } from '../../../services/diagnostics/diagnosticRegistry';
  import type { Notebook } from '../../../services/parser/types';

  export const quickfixSugarOnlyFixture: Notebook = {
    frontmatter: { version: '2.0' },
    cells: [
      {
        displayIndex: 1,
        alias: 'demo',
        frontmatter: {},
        blocks: [{ kind: 'plot', source: 'LINE_CHART(x="t")' }],
        _raw: '### #1 demo\n\n```plot\nLINE_CHART(x="t")\n```\n',
      },
    ],
  };

  /** Seeds the registry with the expected SugarOnly diagnostic — interim until M-A3 emits suggestions natively. */
  export function seedQuickfixSugarOnly(): void {
    diagnosticRegistry.set('parser:plot', [
      {
        source: 'parser:plot',
        kind: 'SugarOnly',
        severity: 'warning',
        message: 'Use the sugar form: `line { x: "t" }`',
        offset: 0,
        length: 17,
        cellAlias: 'demo',
        cellDisplayIndex: 1,
        suggestions: [{ label: '', payload: { sugarSource: 'line { x: "t" }' } }],
      },
    ]);
  }
  ```

- [ ] **14.2** Create `tests/e2e/diagnostics/quickfix.e2e.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('SugarOnly diagnostic appears, ⌥↵ opens menu, accept rewrites source', async ({ page }) => {
  await page.goto('/?fixture=quickfixSugarOnly');
  // Issues panel renders the diagnostic.
  const row = page.getByTestId('diagnostic-row');
  await expect(row).toContainText('Use the sugar form');
  // Focus inside the plot block editor.
  const editor = page.locator('[data-cell-alias="demo"]').first();
  await editor.click();
  // Open quickfix menu with ⌥↵.
  await page.keyboard.press('Alt+Enter');
  const menu = page.getByTestId('quickfix-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /rewrite as sugar form/i })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /fix with agent/i })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  // Accept.
  await page.keyboard.press('Enter');
  // The plot block source should now be the sugar form.
  await expect(editor).toContainText('line { x: "t" }');
});
```

- [ ] **14.3** Run:
```bash
npx playwright test tests/e2e/diagnostics/quickfix.e2e.spec.ts
```

---

### Step 15 — Playwright a11y test

- [ ] **15.1** Create `tests/e2e/diagnostics/issues.a11y.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('@a11y Issues panel', () => {
  test('axe finds no violations with six diagnostics rendered', async ({ page }) => {
    await page.goto('/?fixture=quickfixAllKinds');
    await page.waitForSelector('[data-testid="issues-panel"]');
    const results = await new AxeBuilder({ page })
      .include('[data-testid="issues-panel"]')
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('rows have descriptive aria-label', async ({ page }) => {
    await page.goto('/?fixture=quickfixAllKinds');
    const rows = page.getByTestId('diagnostic-row');
    const labels = await rows.evaluateAll((els) =>
      els.map((el) => el.getAttribute('aria-label')),
    );
    for (const label of labels) {
      expect(label).toMatch(/^(error|warning|info): /);
    }
  });

  test('quickfix menu has role=menu and items have role=menuitem', async ({ page }) => {
    await page.goto('/?fixture=quickfixSugarOnly');
    await page.locator('[data-cell-alias="demo"]').first().click();
    await page.keyboard.press('Alt+Enter');
    const menu = page.getByTestId('quickfix-menu');
    await expect(menu).toHaveAttribute('role', 'menu');
    const items = menu.getByRole('menuitem');
    await expect(items.first()).toBeVisible();
  });
});
```

- [ ] **15.2** Add a `quickfixAllKinds` fixture that seeds the registry with one diagnostic of each of the six canonical kinds (the test only checks rendering + ARIA, not application).

- [ ] **15.3** Run:
```bash
npx playwright test --grep "@a11y Issues"
```

---

### Step 16 — Visual regression

- [ ] **16.1** Create `tests/e2e/diagnostics/issues.visual.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('@visual Issues panel', () => {
  test('renders six kinds (dark)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'dark', 'dark only');
    await page.goto('/?fixture=quickfixAllKinds');
    const panel = page.getByTestId('issues-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveScreenshot('issues-panel-dark.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('renders quickfix menu (dark)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'dark', 'dark only');
    await page.goto('/?fixture=quickfixSugarOnly');
    await page.locator('[data-cell-alias="demo"]').first().click();
    await page.keyboard.press('Alt+Enter');
    const menu = page.getByTestId('quickfix-menu');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveScreenshot('quickfix-menu-dark.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});
```

- [ ] **16.2** Run:
```bash
npx playwright test --grep "@visual Issues"
```

---

### Step 17 — Performance benchmark

- [ ] **17.1** Create `src/__tests__/diagnostics/registry.bench.ts`:

```ts
import { bench, describe } from 'vitest';
import { DiagnosticRegistry } from '../../services/diagnostics/diagnosticRegistry';
import type { DiagnosticEntry } from '../../services/diagnostics/types';

function makeBulk(n: number): DiagnosticEntry[] {
  const out: DiagnosticEntry[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      source: 'parser:plot',
      kind: 'SugarOnly',
      severity: 'warning',
      message: 'msg',
      offset: i,
      length: 1,
      cellAlias: 'a',
      cellDisplayIndex: 1,
    });
  }
  return out;
}

describe('DiagnosticRegistry', () => {
  const reg = new DiagnosticRegistry();
  const bulk = makeBulk(1000);
  bench('set 1000 diagnostics then getAll', () => {
    reg.set('parser:plot', bulk);
    reg.getAll();
  });
});
```

- [ ] **17.2** Run:
```bash
npx vitest bench src/__tests__/diagnostics/registry.bench.ts
```
Expected: < 5ms median per iteration on CI hardware.

---

### Step 18 — Read prior reviews, commit

- [ ] **18.1** Read `docs/reviews/` for any unresolved critical issues.

- [ ] **18.2** Stage and commit:

```bash
git add frontend-v2/src/services/diagnostics \
        frontend-v2/src/components/issues \
        frontend-v2/src/__tests__/diagnostics \
        frontend-v2/src/__tests__/issues \
        frontend-v2/tests/e2e/diagnostics \
        frontend-v2/src/services/parser/types.ts \
        frontend-v2/src/components/shell/AppShell.tsx \
        frontend-v2/src/components/cell/CellView.tsx \
        frontend-v2/src/main.tsx
git commit -m "$(cat <<'EOF'
M-B5: issues panel, diagnostic registry, quickfix menu (⌥↵)

Adds a global DiagnosticRegistry that aggregates parser, dep-graph,
formatter, and (stub) runtime diagnostics; a right-rail IssuesPanel
that renders them sorted (error → warning → info), announces new
entries via aria-live, and offers click-to-jump via a revealCellBus.
Adds a QuickfixRegistry with at least one fix per canonical kind
(SugarOnly, UnknownPlotType, UnknownClause, UnterminatedBrace,
BrushProducerUnnamed, CycleIntroduced) and a QuickfixMenu opened by
⌥↵; "fix with agent" is rendered as a disabled stub for Phase D.
Extends DiagnosticKind to cover BrushProducerUnnamed + CycleIntroduced.
EOF
)"
```

---

## Done criteria

- [ ] `src/services/diagnostics/` contains `types.ts`, `diagnosticRegistry.ts`, `quickfixRegistry.ts`, `quickfixHelpers.ts`, `revealCellBus.ts`, `notebookMutationBus.ts`, `resolveLocations.ts`, `useDiagnostics.ts`, `runtimeStub.ts`.
- [ ] `src/components/issues/` contains `IssuesPanel.tsx`, `DiagnosticRow.tsx`, `QuickfixMenu.tsx`, `useQuickfixHotkey.ts`.
- [ ] `DiagnosticKind` in `src/services/parser/types.ts` includes `BrushProducerUnnamed` and `CycleIntroduced`.
- [ ] Registry replaces a source's diagnostics atomically on `set()`; deduplicates by `(source, cellAlias, offset, length, kind)`; sorts by severity then displayIndex then offset.
- [ ] Each of the six canonical kinds yields ≥ 1 non-agent quickfix (verified by parameterised test).
- [ ] Every quickfix list ends with `agent.delegate` rendered `aria-disabled="true"` with the Phase D tooltip.
- [ ] Issues panel: `role="region"` `aria-label="issues"`; rows are `role="button"` with severity-rich `aria-label`; new entries announced via `role="status" aria-live="polite"` region.
- [ ] Quickfix menu: `role="menu"`, items `role="menuitem"`, agent stub `aria-disabled`; arrow keys navigate skipping disabled items; Enter applies; Escape closes; click-outside closes; focus restores to the trigger.
- [ ] Clicking a diagnostic row dispatches `{ alias, line? }` on `revealCellBus`.
- [ ] Quickfix `apply` is pure (`(notebook) → notebook`) and emits via `notebookMutationBus`.
- [ ] `npx vitest run src/__tests__/diagnostics src/__tests__/issues` is green.
- [ ] `npx playwright test tests/e2e/diagnostics/quickfix.e2e.spec.ts` is green.
- [ ] `npx playwright test --grep "@a11y Issues"` is green (0 axe violations).
- [ ] `npx playwright test --grep "@visual Issues"` is green; baselines committed.
- [ ] `npx vitest bench src/__tests__/diagnostics/registry.bench.ts` reports < 5ms median.
- [ ] `npx tsc --noEmit` clean.
- [ ] No `any` types under `src/services/diagnostics` or `src/components/issues`.
- [ ] No `.dark` class references.
- [ ] All React 19 components use `import type { JSX } from 'react'`.
- [ ] `AxeBuilder` is imported statically from `@axe-core/playwright`.
- [ ] `docs/agent-state/pipeline.md` records M-B5 as a written plan.
