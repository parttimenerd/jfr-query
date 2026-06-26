# M-E1: Sidebar Restructure (TABLES / VIEWS / MACROS / Preview Pane) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current flat Sidebar (NOTEBOOKS + MACROS + flat SCHEMA) with a structured layout: a RECORDING panel (when a JFR is loaded), a TABLES panel showing per-table row counts and expandable columns, a VIEWS panel listing cross-cell `view` aliases, a MACROS panel showing signatures with click-to-preview, and a shared bottom PREVIEW pane (SQL line + sortable/filterable grid + "Save as Cell" + "Export CSV") split from the nav panels by a draggable splitter.

**Architecture:** Three new sidebar panel components (`TablesPanel`, `ViewsPanel`, `RecordingPanel`) live in `src/components/shell/sidebarPanels/`. They subscribe to existing stores (`useSchemaExplorer`, `macroRegistry`, a new `viewsRegistry`, a new `recordingStore`). All three "click-to-preview" actions dispatch through a new `previewStore` (Zustand-style external store) so the bottom PREVIEW pane has one entry point regardless of which panel triggered it. A new `SidebarSplitter` component (vertical resize, `aria-valuenow` 0–100, persisted to `localStorage`) sits between the panels container and the preview pane. CSV export reuses the existing `downloadFile` helper. The existing `MacrosPanel` is rewritten to be click-to-preview (not hover-preview). The existing `SchemaExplorer` is replaced by `TablesPanel`, which adds a `row_count` column to each table row.

**Tech Stack:** React 19.2, TypeScript 5.8, Vitest 4.1.9 (`pool: 'forks'`), @testing-library/react 16.3.0, @testing-library/user-event 14.6.1, Playwright 1.61.0, Tailwind v4 CSS tokens. CSV export uses `URL.createObjectURL` via the existing `src/services/export/downloadFile.ts` helper.

---

## Critical Rules

- `import type { JSX } from 'react'` in every component file
- `pool: 'forks'` in `vitest.config.ts` — NEVER change
- All colors via CSS token vars only (`var(--color-accent)`, `text-[var(--color-fg-muted)]`) — never hardcode hex
- No `text-sm` — use `text-[13px]`, `text-[12px]`, `text-[11px]`
- No `any` — use `unknown` with narrowing; structural types for stores
- `useDB()` returns `DuckDBClient` (non-nullable) — `Sidebar` is always inside `DuckDBProvider`; use `__DuckDBCtx` in tests to inject a mock
- External stores use `useSyncExternalStore` (matches `macroRegistry` pattern)
- Splitter uses pointer events (not `MouseEvent`); falls back gracefully when `localStorage` is unavailable (tests use jsdom)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/services/preview/previewStore.ts` | Create | External store: `{ kind: 'table' \| 'view' \| 'macro' \| null, name, sql }`; subscribers re-render |
| `src/services/views/viewsRegistry.ts` | Create | Singleton: scans Notebook for `ViewBlock`s, returns `{ name, source, producerAlias }[]` |
| `src/services/recording/recordingStore.ts` | Create | Holds active JFR metadata: file name, bytes, event count, duration, JVM, GC; cleared on unload |
| `src/services/preview/exportCsv.ts` | Create | Pure converter: `rows[]` + `columns[]` → CSV string; RFC 4180 quoting |
| `src/components/shell/sidebarPanels/TablesPanel.tsx` | Create | Header + filter + list of tables with row counts and chevron-expand columns; clicks dispatch to `previewStore` |
| `src/components/shell/sidebarPanels/ViewsPanel.tsx` | Create | Header + list of `viewsRegistry` entries; click → previewStore |
| `src/components/shell/sidebarPanels/RecordingPanel.tsx` | Create | Card with metadata fields; only rendered when `recordingStore` has a value |
| `src/components/shell/sidebarPanels/MacrosPanel.tsx` | Create | Rewrite of `components/macros/MacrosPanel.tsx` with click-to-preview (replaces hover) |
| `src/components/shell/SidebarSplitter.tsx` | Create | Vertical draggable splitter; emits height ratio 0..1 |
| `src/components/shell/PreviewPane.tsx` | Create | Bottom pane: SQL line, Run, Save as Cell, Export CSV, sortable/filterable ResultTable |
| `src/components/shell/Sidebar.tsx` | Rewrite | Compose RecordingPanel + TablesPanel + ViewsPanel + MacrosPanel above splitter; PreviewPane below |
| `src/services/schema/useSchemaExplorer.ts` | Modify | Add `rowCount: number \| null` to each `TableSchema`; query `SELECT count(*) FROM "t"` lazily |
| `src/hooks/useFileIngest.ts` | Modify | On `done` event, populate `recordingStore` |
| `src/__tests__/preview/previewStore.test.ts` | Create | Unit |
| `src/__tests__/views/viewsRegistry.test.ts` | Create | Unit |
| `src/__tests__/recording/recordingStore.test.ts` | Create | Unit |
| `src/__tests__/preview/exportCsv.test.ts` | Create | Unit |
| `src/__tests__/shell/sidebarPanels/TablesPanel.test.tsx` | Create | Component |
| `src/__tests__/shell/sidebarPanels/ViewsPanel.test.tsx` | Create | Component |
| `src/__tests__/shell/sidebarPanels/RecordingPanel.test.tsx` | Create | Component |
| `src/__tests__/shell/sidebarPanels/MacrosPanel.test.tsx` | Create | Component (rewrite) |
| `src/__tests__/shell/SidebarSplitter.test.tsx` | Create | Component |
| `src/__tests__/shell/PreviewPane.test.tsx` | Create | Component |
| `src/__tests__/shell/Sidebar.test.tsx` | Modify | Add layout tests |
| `tests/visual/sidebar-restructure.visual.spec.ts` | Create | Playwright visual regression |

---

## Key design decisions

1. **One preview store, one preview pane.** TABLES, VIEWS, and MACROS all dispatch `previewStore.set(...)`. The bottom `PreviewPane` reads from `previewStore` via `useSyncExternalStore`. No prop drilling.
2. **Row counts are lazy.** `useSchemaExplorer` performs the cheap `information_schema` queries up front but defers `SELECT count(*) FROM "t"` to a per-table call, fired when the user clicks a table for the first time (or via an explicit `refresh`). Tables that haven't been counted yet render an em dash.
3. **Views registry is derived.** Like `macroRegistry`, it is rebuilt by `NotebookView` on every notebook change. View entries are `{ name, source, producerAlias }` — the producer alias is the cell whose `ViewBlock` defines the view.
4. **CSV export is in-memory.** We do not stream — the grid already holds the rows. `exportCsv(rows, columns)` returns a string; `downloadFile(name, blob)` triggers the download.
5. **Splitter persistence key:** `jfr-notebook.sidebar.splitRatio` in `localStorage`; default `0.55` (nav panels take 55% of sidebar height). Min/max clamps: `0.20`–`0.85`.

---

## Task 1: Define and test the `previewStore`

**Files:**
- Create: `src/services/preview/previewStore.ts`
- Create: `src/__tests__/preview/previewStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/preview/previewStore.test.ts
import { describe, it, expect, vi } from 'vitest';
import { previewStore } from '../../services/preview/previewStore';

describe('previewStore', () => {
  it('starts with no target', () => {
    previewStore.clear();
    expect(previewStore.getSnapshot()).toBeNull();
  });

  it('set() notifies subscribers and clear() resets', () => {
    previewStore.clear();
    const listener = vi.fn();
    const unsub = previewStore.subscribe(listener);
    previewStore.set({ kind: 'table', name: 'gc_pauses', sql: 'SELECT * FROM "gc_pauses" LIMIT 100' });
    expect(previewStore.getSnapshot()).toEqual({
      kind: 'table',
      name: 'gc_pauses',
      sql: 'SELECT * FROM "gc_pauses" LIMIT 100',
    });
    expect(listener).toHaveBeenCalledTimes(1);
    previewStore.clear();
    expect(previewStore.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
  });

  it('snapshot identity is stable when set() is called with same payload', () => {
    previewStore.clear();
    previewStore.set({ kind: 'table', name: 't', sql: 'q' });
    const a = previewStore.getSnapshot();
    previewStore.set({ kind: 'table', name: 't', sql: 'q' });
    const b = previewStore.getSnapshot();
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/preview/previewStore.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the store**

```ts
// src/services/preview/previewStore.ts
export type PreviewKind = 'table' | 'view' | 'macro';

export interface PreviewTarget {
  kind: PreviewKind;
  name: string;
  sql: string;
}

type Listener = () => void;

class PreviewStore {
  private snapshot: PreviewTarget | null = null;
  private listeners: Set<Listener> = new Set();

  getSnapshot = (): PreviewTarget | null => this.snapshot;

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  };

  set(target: PreviewTarget): void {
    const cur = this.snapshot;
    if (cur && cur.kind === target.kind && cur.name === target.name && cur.sql === target.sql) return;
    this.snapshot = { ...target };
    for (const l of this.listeners) l();
  }

  clear(): void {
    if (this.snapshot === null) return;
    this.snapshot = null;
    for (const l of this.listeners) l();
  }
}

export const previewStore = new PreviewStore();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/preview/previewStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/preview/previewStore.ts src/__tests__/preview/previewStore.test.ts
git commit -m "feat(preview): add previewStore singleton for sidebar preview pane"
```

---

## Task 2: Implement `viewsRegistry`

**Files:**
- Create: `src/services/views/viewsRegistry.ts`
- Create: `src/__tests__/views/viewsRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/views/viewsRegistry.test.ts
import { describe, it, expect } from 'vitest';
import { viewsRegistry } from '../../services/views/viewsRegistry';
import type { Notebook } from '../../services/parser/types';

function nb(): Notebook {
  return {
    frontmatter: {},
    cells: [
      {
        displayIndex: 1,
        alias: 'cell_a',
        frontmatter: {},
        blocks: [
          { kind: 'sql', source: 'SELECT 1' },
          { kind: 'view', name: 'my_view', source: 'SELECT * FROM t' },
        ],
      },
      {
        displayIndex: 2,
        alias: 'cell_b',
        frontmatter: {},
        blocks: [
          { kind: 'view', name: 'other_view', source: 'SELECT 2' },
        ],
      },
    ],
  };
}

describe('viewsRegistry', () => {
  it('returns [] for an empty notebook', () => {
    viewsRegistry.setNotebook({ frontmatter: {}, cells: [] });
    expect(viewsRegistry.getSnapshot()).toEqual([]);
  });

  it('lists view blocks with their producer alias', () => {
    viewsRegistry.setNotebook(nb());
    expect(viewsRegistry.getSnapshot()).toEqual([
      { name: 'my_view', source: 'SELECT * FROM t', producerAlias: 'cell_a' },
      { name: 'other_view', source: 'SELECT 2', producerAlias: 'cell_b' },
    ]);
  });

  it('snapshot identity is stable when setNotebook is called with same content', () => {
    viewsRegistry.setNotebook(nb());
    const a = viewsRegistry.getSnapshot();
    viewsRegistry.setNotebook(nb());
    const b = viewsRegistry.getSnapshot();
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/views/viewsRegistry.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement**

```ts
// src/services/views/viewsRegistry.ts
import type { Notebook } from '../parser/types';

export interface ViewEntry {
  name: string;
  source: string;
  producerAlias: string;
}

type Listener = () => void;

class ViewsRegistry {
  private snapshot: readonly ViewEntry[] = [];
  private listeners: Set<Listener> = new Set();

  getSnapshot = (): readonly ViewEntry[] => this.snapshot;

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  };

  setNotebook(nb: Notebook): void {
    const next: ViewEntry[] = [];
    for (const cell of nb.cells) {
      const alias = cell.alias ?? '(unnamed)';
      for (const block of cell.blocks) {
        if (block.kind === 'view') {
          next.push({ name: block.name, source: block.source, producerAlias: alias });
        }
      }
    }
    if (sameViews(this.snapshot, next)) return;
    this.snapshot = next;
    for (const l of this.listeners) l();
  }
}

function sameViews(a: readonly ViewEntry[], b: readonly ViewEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name) return false;
    if (a[i].source !== b[i].source) return false;
    if (a[i].producerAlias !== b[i].producerAlias) return false;
  }
  return true;
}

export const viewsRegistry = new ViewsRegistry();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/views/viewsRegistry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/views/viewsRegistry.ts src/__tests__/views/viewsRegistry.test.ts
git commit -m "feat(views): add viewsRegistry singleton for VIEWS sidebar panel"
```

---

## Task 3: Wire `viewsRegistry` into `NotebookView`

**Files:**
- Modify: `src/components/notebook/NotebookView.tsx` (the existing `useEffect` that calls `macroRegistry.setNotebook(notebook)`)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/notebook/NotebookViewViews.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { NotebookView } from '../../components/notebook/NotebookView';
import { viewsRegistry } from '../../services/views/viewsRegistry';
import type { Notebook } from '../../services/parser/types';
import { DuckDBProvider } from '../../context/DuckDBContext';

describe('NotebookView ↔ viewsRegistry', () => {
  it('populates viewsRegistry from the initial notebook', () => {
    const nb: Notebook = {
      frontmatter: {},
      cells: [
        {
          displayIndex: 1,
          alias: 'src',
          frontmatter: {},
          blocks: [{ kind: 'view', name: 'cool_view', source: 'SELECT 1' }],
        },
      ],
    };
    render(<DuckDBProvider><NotebookView initial={nb} /></DuckDBProvider>);
    expect(viewsRegistry.getSnapshot()).toEqual([
      { name: 'cool_view', source: 'SELECT 1', producerAlias: 'src' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/notebook/NotebookViewViews.test.tsx`
Expected: FAIL — registry is empty.

- [ ] **Step 3: Modify `NotebookView.tsx`**

Locate the existing import block and add:

```ts
import { viewsRegistry } from '../../services/views/viewsRegistry';
```

Locate the existing effect:

```ts
useEffect(() => {
  macroRegistry.setNotebook(notebook);
}, [notebook]);
```

Replace with:

```ts
useEffect(() => {
  macroRegistry.setNotebook(notebook);
  viewsRegistry.setNotebook(notebook);
}, [notebook]);
```

Also extend the initial `useState` initializer block (currently calls `macroRegistry.setNotebook(initial)` synchronously) to also call `viewsRegistry.setNotebook(initial)`:

```ts
const [notebook, setNotebook] = useState<Notebook>(() => {
  macroRegistry.setNotebook(initial);
  viewsRegistry.setNotebook(initial);
  return initial;
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/notebook/NotebookViewViews.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/notebook/NotebookView.tsx src/__tests__/notebook/NotebookViewViews.test.tsx
git commit -m "feat(notebook): sync viewsRegistry from NotebookView"
```

---

## Task 4: Implement `recordingStore`

**Files:**
- Create: `src/services/recording/recordingStore.ts`
- Create: `src/__tests__/recording/recordingStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/recording/recordingStore.test.ts
import { describe, it, expect, vi } from 'vitest';
import { recordingStore } from '../../services/recording/recordingStore';

describe('recordingStore', () => {
  it('starts empty', () => {
    recordingStore.clear();
    expect(recordingStore.getSnapshot()).toBeNull();
  });

  it('set() stores metadata and notifies', () => {
    recordingStore.clear();
    const listener = vi.fn();
    const unsub = recordingStore.subscribe(listener);
    recordingStore.set({
      fileName: 'a.jfr.db',
      bytes: 12345,
      eventCount: 100,
      durationMs: 5000,
      jvmVersion: '21.0.1',
      gcAlgorithm: 'G1',
    });
    expect(recordingStore.getSnapshot()).toMatchObject({ fileName: 'a.jfr.db', eventCount: 100 });
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('clear() resets and notifies once', () => {
    recordingStore.set({ fileName: 'a', bytes: 1, eventCount: 0, durationMs: 0, jvmVersion: null, gcAlgorithm: null });
    const listener = vi.fn();
    const unsub = recordingStore.subscribe(listener);
    recordingStore.clear();
    expect(recordingStore.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    recordingStore.clear();
    expect(listener).toHaveBeenCalledTimes(1); // no second notify when already empty
    unsub();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/recording/recordingStore.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/services/recording/recordingStore.ts
export interface RecordingMetadata {
  fileName: string;
  bytes: number;
  eventCount: number;
  durationMs: number;
  jvmVersion: string | null;
  gcAlgorithm: string | null;
}

type Listener = () => void;

class RecordingStore {
  private snapshot: RecordingMetadata | null = null;
  private listeners: Set<Listener> = new Set();

  getSnapshot = (): RecordingMetadata | null => this.snapshot;

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  };

  set(meta: RecordingMetadata): void {
    this.snapshot = { ...meta };
    for (const l of this.listeners) l();
  }

  clear(): void {
    if (this.snapshot === null) return;
    this.snapshot = null;
    for (const l of this.listeners) l();
  }
}

export const recordingStore = new RecordingStore();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/recording/recordingStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/recording/recordingStore.ts src/__tests__/recording/recordingStore.test.ts
git commit -m "feat(recording): add recordingStore singleton for active JFR metadata"
```

---

## Task 5: Implement `exportCsv` helper

**Files:**
- Create: `src/services/preview/exportCsv.ts`
- Create: `src/__tests__/preview/exportCsv.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/preview/exportCsv.test.ts
import { describe, it, expect } from 'vitest';
import { exportCsv } from '../../services/preview/exportCsv';

describe('exportCsv', () => {
  it('emits header + rows with LF line breaks', () => {
    const csv = exportCsv([{ a: 1, b: 'x' }, { a: 2, b: 'y' }], ['a', 'b']);
    expect(csv).toBe('a,b\n1,x\n2,y');
  });

  it('quotes fields containing commas, quotes, or newlines', () => {
    const csv = exportCsv([{ a: 'hello,world', b: 'sa"id', c: 'two\nlines' }], ['a', 'b', 'c']);
    expect(csv).toBe('a,b,c\n"hello,world","sa""id","two\nlines"');
  });

  it('serializes null as empty and Date as ISO', () => {
    const csv = exportCsv(
      [{ a: null, b: new Date('2026-06-24T00:00:00Z') }],
      ['a', 'b']
    );
    expect(csv).toBe('a,b\n,2026-06-24T00:00:00.000Z');
  });

  it('returns just the header when rows is empty', () => {
    expect(exportCsv([], ['a', 'b'])).toBe('a,b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/preview/exportCsv.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/services/preview/exportCsv.ts
function serializeCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function quoteIfNeeded(s: string): string {
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportCsv(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: readonly string[]
): string {
  const header = columns.map(quoteIfNeeded).join(',');
  if (rows.length === 0) return header;
  const body = rows
    .map((r) => columns.map((c) => quoteIfNeeded(serializeCell(r[c]))).join(','))
    .join('\n');
  return `${header}\n${body}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/preview/exportCsv.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/preview/exportCsv.ts src/__tests__/preview/exportCsv.test.ts
git commit -m "feat(preview): add exportCsv RFC-4180 helper"
```

---

## Task 6: Extend `useSchemaExplorer` with lazy `rowCount`

**Files:**
- Modify: `src/services/schema/useSchemaExplorer.ts`
- Modify: `src/__tests__/schema/useSchemaExplorer.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/schema/useSchemaExplorer.test.ts`:

```ts
describe('useSchemaExplorer rowCount', () => {
  it('initializes rowCount as null and populates it on fetchRowCount', async () => {
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('information_schema.tables')) return Promise.resolve([{ table_name: 'gc_pauses' }]);
        if (sql.includes('information_schema.columns')) return Promise.resolve([{ column_name: 'x', data_type: 'INTEGER' }]);
        if (sql.startsWith('SELECT count(*)')) return Promise.resolve([{ n: 42 }]);
        return Promise.resolve([]);
      }),
    } as unknown as DuckDBClient;
    const { result } = renderHook(() => useSchemaExplorer(client));
    await waitFor(() => expect(result.current.tables).toHaveLength(1));
    expect(result.current.tables[0].rowCount).toBeNull();
    await act(async () => {
      await result.current.fetchRowCount('gc_pauses');
    });
    expect(result.current.tables[0].rowCount).toBe(42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/schema/useSchemaExplorer.test.ts`
Expected: FAIL — `rowCount` and `fetchRowCount` do not exist.

- [ ] **Step 3: Modify `useSchemaExplorer.ts`**

Update the `TableSchema` interface (around line 9):

```ts
export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  expanded: boolean;
  rowCount: number | null;
}
```

Update the `SchemaExplorerApi` (around line 21):

```ts
export interface SchemaExplorerApi extends SchemaExplorerState {
  toggleTable: (name: string) => void;
  refresh: () => void;
  fetchRowCount: (name: string) => Promise<void>;
}
```

In `fetchSchema()`, when building `tableSchemas`, add `rowCount: null` to each returned object.

Add at the bottom of the hook body (before the `return`):

```ts
const rowCountsRef = useRef<Map<string, number>>(new Map());

const fetchRowCount = useCallback(
  async (name: string): Promise<void> => {
    if (!client) return;
    if (rowCountsRef.current.has(name)) return;
    try {
      const safe = name.replace(/"/g, '""');
      const rows = await client.query(`SELECT count(*) AS n FROM "${safe}"`);
      const n = Number((rows[0] ?? {})['n'] ?? 0);
      rowCountsRef.current.set(name, n);
      setTables((prev) => prev.map((t) => (t.name === name ? { ...t, rowCount: n } : t)));
    } catch {
      // ignore — leave as null
    }
  },
  [client]
);
```

Update the returned object: `return { tables, loading, error, toggleTable, refresh, fetchRowCount };`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/schema/useSchemaExplorer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/schema/useSchemaExplorer.ts src/__tests__/schema/useSchemaExplorer.test.ts
git commit -m "feat(schema): add lazy rowCount to useSchemaExplorer"
```

---

## Task 7: Build `TablesPanel`

**Files:**
- Create: `src/components/shell/sidebarPanels/TablesPanel.tsx`
- Create: `src/__tests__/shell/sidebarPanels/TablesPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/shell/sidebarPanels/TablesPanel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TablesPanel } from '../../../components/shell/sidebarPanels/TablesPanel';
import { previewStore } from '../../../services/preview/previewStore';
import { __DuckDBCtx } from '../../../context/DuckDBContext';
import type { DuckDBClient } from '../../../services/duckdb/client';

function makeClient(): DuckDBClient {
  return {
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('information_schema.tables')) return Promise.resolve([{ table_name: 'gc_pauses' }, { table_name: 'jvm_info' }]);
      if (sql.includes('information_schema.columns')) {
        const m = /table_name='([^']+)'/.exec(sql);
        return Promise.resolve([{ column_name: 'a', data_type: 'INT' }, { column_name: `col_${m?.[1] ?? '?'}`, data_type: 'TEXT' }]);
      }
      if (sql.startsWith('SELECT count(*)')) {
        const m = /FROM "([^"]+)"/.exec(sql);
        return Promise.resolve([{ n: m?.[1] === 'gc_pauses' ? 17 : 3 }]);
      }
      return Promise.resolve([]);
    }),
  } as unknown as DuckDBClient;
}

describe('TablesPanel', () => {
  it('renders TABLES header, table list with row count, and dispatches previewStore on click', async () => {
    previewStore.clear();
    const client = makeClient();
    render(<__DuckDBCtx.Provider value={client}><TablesPanel /></__DuckDBCtx.Provider>);
    await waitFor(() => expect(screen.getByText('gc_pauses')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /tables/i })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('tables-row-gc_pauses'));
    await waitFor(() => expect(previewStore.getSnapshot()).toMatchObject({ kind: 'table', name: 'gc_pauses' }));
    // row count populated after click
    await waitFor(() => expect(screen.getByTestId('tables-rowcount-gc_pauses')).toHaveTextContent('17'));
  });

  it('expands columns on chevron click without dispatching preview', async () => {
    previewStore.clear();
    const client = makeClient();
    render(<__DuckDBCtx.Provider value={client}><TablesPanel /></__DuckDBCtx.Provider>);
    await waitFor(() => expect(screen.getByText('gc_pauses')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('tables-chevron-gc_pauses'));
    expect(screen.getByText('col_gc_pauses')).toBeInTheDocument();
    expect(previewStore.getSnapshot()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/shell/sidebarPanels/TablesPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// src/components/shell/sidebarPanels/TablesPanel.tsx
import { useCallback, useContext, useState } from 'react';
import type { JSX } from 'react';
import { __DuckDBCtx } from '../../../context/DuckDBContext';
import { useSchemaExplorer } from '../../../services/schema/useSchemaExplorer';
import type { TableSchema } from '../../../services/schema/useSchemaExplorer';
import { previewStore } from '../../../services/preview/previewStore';

function Chevron({ expanded }: { expanded: boolean }): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
         className={`shrink-0 transition-transform text-[var(--color-fg-dim)] ${expanded ? 'rotate-90' : ''}`}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export function TablesPanel(): JSX.Element {
  const client = useContext(__DuckDBCtx);
  const api = useSchemaExplorer(client);
  const [filter, setFilter] = useState('');

  const tables = api.tables.filter((t) =>
    filter.trim() === '' ? true : t.name.toLowerCase().includes(filter.toLowerCase())
  );

  const handleTableClick = useCallback(
    (t: TableSchema): void => {
      void api.fetchRowCount(t.name);
      previewStore.set({
        kind: 'table',
        name: t.name,
        sql: `SELECT * FROM "${t.name}" LIMIT 100`,
      });
    },
    [api]
  );

  return (
    <section aria-label="tables" data-testid="tables-panel" className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)]">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-fg-muted)]">Tables</h3>
        <span className="text-[11px] text-[var(--color-fg-dim)]">{api.tables.length}</span>
      </div>
      <div className="px-3 py-1.5 border-b border-[var(--color-border)]">
        <input
          type="text"
          placeholder="Filter tables…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-overlay)] px-2 py-1 text-[12px] text-[var(--color-fg-base)] placeholder:text-[var(--color-fg-dim)] outline-none focus:border-[var(--color-accent)] transition-colors"
        />
      </div>
      <ul role="list" className="py-1">
        {tables.map((t) => (
          <li key={t.name}>
            <div className="flex w-full items-center gap-1.5 px-3 py-1 text-[13px] text-[var(--color-fg-base)] hover:bg-[var(--color-bg-overlay)]">
              <button
                type="button"
                data-testid={`tables-chevron-${t.name}`}
                aria-label={`Toggle columns for ${t.name}`}
                onClick={() => api.toggleTable(t.name)}
                className="p-0.5 hover:text-[var(--color-fg-base)]"
              >
                <Chevron expanded={t.expanded} />
              </button>
              <button
                type="button"
                data-testid={`tables-row-${t.name}`}
                onClick={() => handleTableClick(t)}
                className="flex-1 truncate text-left"
              >
                {t.name}
              </button>
              <span
                data-testid={`tables-rowcount-${t.name}`}
                className="shrink-0 rounded bg-[var(--color-bg-overlay)] px-1.5 py-0.5 text-[11px] text-[var(--color-fg-muted)]"
              >
                {t.rowCount === null ? '—' : t.rowCount.toLocaleString()}
              </span>
            </div>
            {t.expanded && (
              <ul className="pb-1">
                {t.columns.map((col) => (
                  <li key={col.name} className="flex items-center gap-2 pl-9 pr-3 py-0.5">
                    <span className="flex-1 truncate text-[12px] text-[var(--color-fg-muted)]">{col.name}</span>
                    <span className="shrink-0 rounded bg-[var(--color-bg-overlay)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-fg-dim)]">{col.type}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/shell/sidebarPanels/TablesPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/sidebarPanels/TablesPanel.tsx src/__tests__/shell/sidebarPanels/TablesPanel.test.tsx
git commit -m "feat(sidebar): TablesPanel with row counts and click-to-preview"
```

---

## Task 8: Build `ViewsPanel`

**Files:**
- Create: `src/components/shell/sidebarPanels/ViewsPanel.tsx`
- Create: `src/__tests__/shell/sidebarPanels/ViewsPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/shell/sidebarPanels/ViewsPanel.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ViewsPanel } from '../../../components/shell/sidebarPanels/ViewsPanel';
import { viewsRegistry } from '../../../services/views/viewsRegistry';
import { previewStore } from '../../../services/preview/previewStore';

describe('ViewsPanel', () => {
  beforeEach(() => {
    previewStore.clear();
    viewsRegistry.setNotebook({ frontmatter: {}, cells: [] });
  });

  it('shows empty state when no views are registered', () => {
    render(<ViewsPanel />);
    expect(screen.getByText(/no views defined/i)).toBeInTheDocument();
  });

  it('lists views with producer alias and dispatches preview on click', async () => {
    viewsRegistry.setNotebook({
      frontmatter: {},
      cells: [{
        displayIndex: 1, alias: 'src_cell', frontmatter: {},
        blocks: [{ kind: 'view', name: 'top_methods', source: 'SELECT * FROM x' }],
      }],
    });
    render(<ViewsPanel />);
    expect(screen.getByText('top_methods')).toBeInTheDocument();
    expect(screen.getByText(/src_cell/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('views-row-top_methods'));
    expect(previewStore.getSnapshot()).toMatchObject({
      kind: 'view',
      name: 'top_methods',
      sql: 'SELECT * FROM x',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/shell/sidebarPanels/ViewsPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/shell/sidebarPanels/ViewsPanel.tsx
import { useSyncExternalStore } from 'react';
import type { JSX } from 'react';
import { viewsRegistry } from '../../../services/views/viewsRegistry';
import { previewStore } from '../../../services/preview/previewStore';

export function ViewsPanel(): JSX.Element {
  const views = useSyncExternalStore(viewsRegistry.subscribe, viewsRegistry.getSnapshot);
  return (
    <section aria-label="views" data-testid="views-panel" className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)]">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-fg-muted)]">Views</h3>
        <span className="text-[11px] text-[var(--color-fg-dim)]">{views.length}</span>
      </div>
      {views.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-[var(--color-fg-dim)]">No views defined. Add a <code>view</code> fence to a cell.</div>
      ) : (
        <ul role="list" className="py-1">
          {views.map((v) => (
            <li key={v.name}>
              <button
                type="button"
                data-testid={`views-row-${v.name}`}
                onClick={() => previewStore.set({ kind: 'view', name: v.name, sql: v.source })}
                className="flex w-full items-center justify-between gap-2 px-3 py-1 text-left hover:bg-[var(--color-bg-overlay)]"
              >
                <span className="truncate text-[13px] text-[var(--color-fg-base)]">{v.name}</span>
                <span className="shrink-0 truncate text-[11px] text-[var(--color-fg-dim)]">{v.producerAlias}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/shell/sidebarPanels/ViewsPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/sidebarPanels/ViewsPanel.tsx src/__tests__/shell/sidebarPanels/ViewsPanel.test.tsx
git commit -m "feat(sidebar): ViewsPanel listing cross-cell view aliases"
```

---

## Task 9: Build the rewritten `MacrosPanel` (click-to-preview)

**Files:**
- Create: `src/components/shell/sidebarPanels/MacrosPanel.tsx`
- Create: `src/__tests__/shell/sidebarPanels/MacrosPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/shell/sidebarPanels/MacrosPanel.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MacrosPanel } from '../../../components/shell/sidebarPanels/MacrosPanel';
import { macroRegistry } from '../../../services/macros/macroRegistry';
import { previewStore } from '../../../services/preview/previewStore';

describe('MacrosPanel (sidebar restructure)', () => {
  beforeEach(() => {
    previewStore.clear();
    macroRegistry.clear();
  });

  it('shows empty state when no macros', () => {
    render(<MacrosPanel />);
    expect(screen.getByText(/no macros defined/i)).toBeInTheDocument();
  });

  it('lists macros with signatures and dispatches preview on click', async () => {
    macroRegistry.set('top_n', {
      kind: 'macro',
      name: 'top_n',
      source: 'SELECT * FROM x ORDER BY y DESC LIMIT 10',
      params: [{ name: 'n', type: 'int' }],
    });
    render(<MacrosPanel />);
    expect(screen.getByText('top_n')).toBeInTheDocument();
    expect(screen.getByText(/\(n: int\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('macros-row-top_n'));
    expect(previewStore.getSnapshot()).toMatchObject({
      kind: 'macro',
      name: 'top_n',
      sql: 'SELECT * FROM x ORDER BY y DESC LIMIT 10',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/shell/sidebarPanels/MacrosPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/shell/sidebarPanels/MacrosPanel.tsx
import { useSyncExternalStore } from 'react';
import type { JSX } from 'react';
import { macroRegistry } from '../../../services/macros/macroRegistry';
import { previewStore } from '../../../services/preview/previewStore';
import type { MacroParam } from '../../../services/parser/types';

function formatParams(params: MacroParam[] | undefined): string {
  if (params === undefined) return '';
  return '(' + params.map((p) => (p.type !== undefined ? `${p.name}: ${p.type}` : p.name)).join(', ') + ')';
}

export function MacrosPanel(): JSX.Element {
  const macros = useSyncExternalStore(macroRegistry.subscribe, macroRegistry.getSnapshot);
  const entries = Array.from(macros.values());
  return (
    <section aria-label="macros" data-testid="macros-panel" className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)]">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-fg-muted)]">Macros</h3>
        <span className="text-[11px] text-[var(--color-fg-dim)]">{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-[var(--color-fg-dim)]">No macros defined. Add a <code>macro</code> fence to a cell.</div>
      ) : (
        <ul role="list" className="py-1">
          {entries.map((m) => (
            <li key={m.name}>
              <button
                type="button"
                data-testid={`macros-row-${m.name}`}
                onClick={() => previewStore.set({ kind: 'macro', name: m.name, sql: m.source })}
                className="flex w-full items-center gap-1 px-3 py-1 text-left hover:bg-[var(--color-bg-overlay)] font-mono text-[12px]"
              >
                <span className="text-[var(--color-fg-base)]">{m.name}</span>
                <span className="text-[var(--color-fg-muted)]">{formatParams(m.params)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/shell/sidebarPanels/MacrosPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/sidebarPanels/MacrosPanel.tsx src/__tests__/shell/sidebarPanels/MacrosPanel.test.tsx
git commit -m "feat(sidebar): MacrosPanel with click-to-preview (replaces hover)"
```

---

## Task 10: Build `RecordingPanel`

**Files:**
- Create: `src/components/shell/sidebarPanels/RecordingPanel.tsx`
- Create: `src/__tests__/shell/sidebarPanels/RecordingPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/shell/sidebarPanels/RecordingPanel.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecordingPanel } from '../../../components/shell/sidebarPanels/RecordingPanel';
import { recordingStore } from '../../../services/recording/recordingStore';

describe('RecordingPanel', () => {
  beforeEach(() => recordingStore.clear());

  it('renders nothing when no recording is loaded', () => {
    const { container } = render(<RecordingPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders metadata when recordingStore has a value', () => {
    recordingStore.set({
      fileName: 'app.jfr.db',
      bytes: 1024 * 1024 * 2.5,
      eventCount: 12345,
      durationMs: 60_000,
      jvmVersion: '21.0.1',
      gcAlgorithm: 'G1',
    });
    render(<RecordingPanel />);
    expect(screen.getByText('app.jfr.db')).toBeInTheDocument();
    expect(screen.getByText(/12,345/)).toBeInTheDocument();
    expect(screen.getByText(/G1/)).toBeInTheDocument();
    expect(screen.getByText(/21\.0\.1/)).toBeInTheDocument();
    expect(screen.getByText(/2\.5 MB|2\.50 MB|2\.5MB/i)).toBeInTheDocument();
    expect(screen.getByText(/60[.,]?0?\s*s|1[.,]?0?\s*m/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/shell/sidebarPanels/RecordingPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/shell/sidebarPanels/RecordingPanel.tsx
import { useSyncExternalStore } from 'react';
import type { JSX } from 'react';
import { recordingStore } from '../../../services/recording/recordingStore';

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} m`;
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between gap-2 px-3 py-0.5 text-[11px]">
      <span className="text-[var(--color-fg-dim)]">{label}</span>
      <span className="truncate text-[var(--color-fg-base)]" title={value}>{value}</span>
    </div>
  );
}

export function RecordingPanel(): JSX.Element | null {
  const meta = useSyncExternalStore(recordingStore.subscribe, recordingStore.getSnapshot);
  if (meta === null) return null;
  return (
    <section aria-label="recording" data-testid="recording-panel" className="flex flex-col border-b border-[var(--color-border)]">
      <div className="flex items-center px-3 py-1.5 border-b border-[var(--color-border)]">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-fg-muted)]">Recording</h3>
      </div>
      <div className="py-1">
        <Row label="File" value={meta.fileName} />
        <Row label="Size" value={formatBytes(meta.bytes)} />
        <Row label="Events" value={meta.eventCount.toLocaleString()} />
        <Row label="Duration" value={formatDuration(meta.durationMs)} />
        <Row label="JVM" value={meta.jvmVersion ?? '—'} />
        <Row label="GC" value={meta.gcAlgorithm ?? '—'} />
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/shell/sidebarPanels/RecordingPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/sidebarPanels/RecordingPanel.tsx src/__tests__/shell/sidebarPanels/RecordingPanel.test.tsx
git commit -m "feat(sidebar): RecordingPanel showing active JFR metadata"
```

---

## Task 11: Build the `SidebarSplitter` (vertical, persisted)

**Files:**
- Create: `src/components/shell/SidebarSplitter.tsx`
- Create: `src/__tests__/shell/SidebarSplitter.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/shell/SidebarSplitter.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SidebarSplitter } from '../../components/shell/SidebarSplitter';

describe('SidebarSplitter', () => {
  it('reports a drag delta as a new ratio', () => {
    const onRatio = vi.fn();
    render(<SidebarSplitter ratio={0.5} onRatioChange={onRatio} containerHeight={400} />);
    const handle = screen.getByTestId('sidebar-splitter');
    fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 280, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 280, pointerId: 1 });
    // 280/400 = 0.70
    expect(onRatio).toHaveBeenLastCalledWith(0.7);
  });

  it('clamps ratio between 0.20 and 0.85', () => {
    const onRatio = vi.fn();
    render(<SidebarSplitter ratio={0.5} onRatioChange={onRatio} containerHeight={400} />);
    const handle = screen.getByTestId('sidebar-splitter');
    fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 10, pointerId: 1 });
    expect(onRatio).toHaveBeenLastCalledWith(0.2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/shell/SidebarSplitter.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/shell/SidebarSplitter.tsx
import { useCallback, useRef } from 'react';
import type { JSX } from 'react';

interface SidebarSplitterProps {
  ratio: number;
  onRatioChange: (next: number) => void;
  /** Total height of the container that the ratio is measured against. */
  containerHeight: number;
  /** Optional: override clamps. */
  minRatio?: number;
  maxRatio?: number;
}

export function SidebarSplitter({
  ratio, onRatioChange, containerHeight,
  minRatio = 0.2, maxRatio = 0.85,
}: SidebarSplitterProps): JSX.Element {
  const draggingRef = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
    draggingRef.current = true;
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return;
    const next = Math.min(maxRatio, Math.max(minRatio, e.clientY / Math.max(1, containerHeight)));
    onRatioChange(Number(next.toFixed(3)));
  }, [containerHeight, minRatio, maxRatio, onRatioChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
    draggingRef.current = false;
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={Math.round(minRatio * 100)}
      aria-valuemax={Math.round(maxRatio * 100)}
      data-testid="sidebar-splitter"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="h-1 cursor-row-resize bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors"
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/shell/SidebarSplitter.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/SidebarSplitter.tsx src/__tests__/shell/SidebarSplitter.test.tsx
git commit -m "feat(sidebar): SidebarSplitter component (vertical resize)"
```

---

## Task 12: Build the `PreviewPane`

**Files:**
- Create: `src/components/shell/PreviewPane.tsx`
- Create: `src/__tests__/shell/PreviewPane.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/shell/PreviewPane.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreviewPane } from '../../components/shell/PreviewPane';
import { previewStore } from '../../services/preview/previewStore';
import { insertCellBus } from '../../services/diagnostics/insertCellBus';
import { __DuckDBCtx } from '../../context/DuckDBContext';
import type { DuckDBClient } from '../../services/duckdb/client';

function makeClient(rows: Record<string, unknown>[]): DuckDBClient {
  return { query: vi.fn().mockResolvedValue(rows) } as unknown as DuckDBClient;
}

describe('PreviewPane', () => {
  beforeEach(() => previewStore.clear());

  it('renders placeholder when no target is set', () => {
    const client = makeClient([]);
    render(<__DuckDBCtx.Provider value={client}><PreviewPane /></__DuckDBCtx.Provider>);
    expect(screen.getByTestId('preview-pane-placeholder')).toBeInTheDocument();
  });

  it('runs the SQL when previewStore.set is called and renders rows', async () => {
    const client = makeClient([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
    render(<__DuckDBCtx.Provider value={client}><PreviewPane /></__DuckDBCtx.Provider>);
    previewStore.set({ kind: 'table', name: 't', sql: 'SELECT * FROM "t" LIMIT 100' });
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
    expect(screen.getByText('y')).toBeInTheDocument();
  });

  it('"Save as Cell" fires insertCellBus with current SQL', async () => {
    const client = makeClient([{ a: 1 }]);
    const spy = vi.fn();
    insertCellBus.subscribe(spy);
    render(<__DuckDBCtx.Provider value={client}><PreviewPane /></__DuckDBCtx.Provider>);
    previewStore.set({ kind: 'table', name: 't', sql: 'SELECT 1' });
    await waitFor(() => expect(screen.getByTestId('preview-save-as-cell')).toBeEnabled());
    await userEvent.click(screen.getByTestId('preview-save-as-cell'));
    expect(spy).toHaveBeenCalledWith({ sql: 'SELECT 1' });
  });

  it('"Export CSV" triggers a download', async () => {
    const client = makeClient([{ a: 1, b: 'x' }]);
    const dlSpy = vi.fn();
    vi.doMock('../../services/export/downloadFile', () => ({ downloadFile: dlSpy }));
    // re-import to bind the mock
    const mod = await import('../../components/shell/PreviewPane');
    render(<__DuckDBCtx.Provider value={client}><mod.PreviewPane /></__DuckDBCtx.Provider>);
    previewStore.set({ kind: 'table', name: 't', sql: 'SELECT 1' });
    await waitFor(() => expect(screen.getByTestId('preview-export-csv')).toBeEnabled());
    await userEvent.click(screen.getByTestId('preview-export-csv'));
    expect(dlSpy).toHaveBeenCalled();
    vi.doUnmock('../../services/export/downloadFile');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/shell/PreviewPane.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/shell/PreviewPane.tsx
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { JSX } from 'react';
import { useDB } from '../../context/DuckDBContext';
import { previewStore } from '../../services/preview/previewStore';
import { insertCellBus } from '../../services/diagnostics/insertCellBus';
import { exportCsv } from '../../services/preview/exportCsv';
import { downloadFile } from '../../services/export/downloadFile';
import { ResultTable } from '../resultTable/ResultTable';

export function PreviewPane(): JSX.Element {
  const target = useSyncExternalStore(previewStore.subscribe, previewStore.getSnapshot);
  const client = useDB();
  const [sql, setSql] = useState<string>('');
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [filter, setFilter] = useState('');

  // Sync SQL editor when target changes, and auto-run.
  useEffect(() => {
    if (target === null) {
      setSql(''); setRows(null); setError(null); return;
    }
    setSql(target.sql);
    runSql(target.sql);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.kind, target?.name, target?.sql]);

  const runSql = useCallback(async (q: string): Promise<void> => {
    if (q.trim() === '') return;
    setLoading(true); setError(null);
    try {
      const out = await client.query(q);
      setRows(out);
    } catch (thrown: unknown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
      setRows(null);
    } finally {
      setLoading(false);
    }
  }, [client]);

  const columns = useMemo<string[]>(() => (rows && rows[0] ? Object.keys(rows[0]) : []), [rows]);

  const visibleRows = useMemo<Record<string, unknown>[]>(() => {
    if (!rows) return [];
    let r = rows;
    if (filter.trim() !== '') {
      const f = filter.toLowerCase();
      r = r.filter((row) => columns.some((c) => String(row[c] ?? '').toLowerCase().includes(f)));
    }
    if (sortKey !== null) {
      r = [...r].sort((a, b) => {
        const av = a[sortKey]; const bv = b[sortKey];
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp = av < bv ? -1 : 1;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return r;
  }, [rows, columns, filter, sortKey, sortDir]);

  const handleSaveAsCell = useCallback((): void => {
    insertCellBus.dispatch({ sql });
  }, [sql]);

  const handleExportCsv = useCallback((): void => {
    const csv = exportCsv(visibleRows, columns);
    downloadFile(`${target?.name ?? 'preview'}.csv`, new Blob([csv], { type: 'text/csv' }));
  }, [visibleRows, columns, target?.name]);

  if (target === null) {
    return (
      <div data-testid="preview-pane-placeholder" className="flex h-full items-center justify-center px-3 text-[11px] text-[var(--color-fg-dim)]">
        Click a table, view, or macro to preview.
      </div>
    );
  }

  return (
    <div data-testid="preview-pane" className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-1.5">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-[var(--color-fg-muted)]">
          Preview: {target.kind} · {target.name}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            data-testid="preview-save-as-cell"
            disabled={loading}
            onClick={handleSaveAsCell}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg-overlay)] px-2 py-0.5 text-[11px] disabled:opacity-50"
          >Save as Cell</button>
          <button
            type="button"
            data-testid="preview-export-csv"
            disabled={loading || rows === null || rows.length === 0}
            onClick={handleExportCsv}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg-overlay)] px-2 py-0.5 text-[11px] disabled:opacity-50"
          >Export CSV</button>
        </div>
      </div>
      <div className="flex items-center gap-1.5 border-b border-[var(--color-border)] px-3 py-1.5">
        <input
          type="text"
          data-testid="preview-sql"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runSql(sql); } }}
          className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-overlay)] px-2 py-1 font-mono text-[11px]"
        />
        <input
          type="text"
          data-testid="preview-filter"
          placeholder="Filter rows…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-28 rounded border border-[var(--color-border)] bg-[var(--color-bg-overlay)] px-2 py-1 text-[11px]"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {loading && <div data-testid="preview-loading" className="px-3 py-2 text-[11px] text-[var(--color-fg-dim)]">Loading…</div>}
        {!loading && error !== null && <div role="alert" className="px-3 py-2 text-[11px] text-[var(--color-accent-red)]">{error}</div>}
        {!loading && error === null && rows !== null && rows.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-[var(--color-fg-dim)]">No results.</div>
        )}
        {!loading && error === null && visibleRows.length > 0 && (
          <ResultTable rows={visibleRows} columns={columns}
            onHeaderClick={(c) => {
              if (sortKey === c) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
              else { setSortKey(c); setSortDir('asc'); }
            }}
          />
        )}
      </div>
    </div>
  );
}
```

> NOTE: If `ResultTable` does not yet support `onHeaderClick`, in this same task add the optional prop:
> open `src/components/resultTable/ResultTable.tsx`, find the props interface, append `onHeaderClick?: (column: string) => void;`. Wire each `<th>` to call it via `onClick`. Add a test for it in the same file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/shell/PreviewPane.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/PreviewPane.tsx src/__tests__/shell/PreviewPane.test.tsx src/components/resultTable/ResultTable.tsx
git commit -m "feat(sidebar): PreviewPane (SQL line + grid + Save as Cell + Export CSV)"
```

---

## Task 13: Rewrite `Sidebar.tsx` to compose new panels

**Files:**
- Modify: `src/components/shell/Sidebar.tsx`
- Modify: `src/__tests__/shell/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/shell/Sidebar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from '../../components/shell/Sidebar';
import { __DuckDBCtx } from '../../context/DuckDBContext';

describe('Sidebar restructure', () => {
  it('renders TABLES, VIEWS, MACROS panels and a preview pane placeholder', () => {
    const client = { query: () => Promise.resolve([]) } as any;
    render(<__DuckDBCtx.Provider value={client}><Sidebar collapsed={false} /></__DuckDBCtx.Provider>);
    expect(screen.getByTestId('tables-panel')).toBeInTheDocument();
    expect(screen.getByTestId('views-panel')).toBeInTheDocument();
    expect(screen.getByTestId('macros-panel')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-splitter')).toBeInTheDocument();
    expect(screen.getByTestId('preview-pane-placeholder')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/shell/Sidebar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Rewrite `Sidebar.tsx`**

```tsx
// src/components/shell/Sidebar.tsx
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { RecordingPanel } from './sidebarPanels/RecordingPanel';
import { TablesPanel } from './sidebarPanels/TablesPanel';
import { ViewsPanel } from './sidebarPanels/ViewsPanel';
import { MacrosPanel } from './sidebarPanels/MacrosPanel';
import { SidebarSplitter } from './SidebarSplitter';
import { PreviewPane } from './PreviewPane';

const SPLIT_KEY = 'jfr-notebook.sidebar.splitRatio';

function loadRatio(): number {
  try {
    const v = localStorage.getItem(SPLIT_KEY);
    if (v === null) return 0.55;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(0.85, Math.max(0.2, n)) : 0.55;
  } catch { return 0.55; }
}

function saveRatio(r: number): void {
  try { localStorage.setItem(SPLIT_KEY, String(r)); } catch { /* ignore */ }
}

interface SidebarProps { collapsed: boolean; }

export function Sidebar({ collapsed }: SidebarProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(600);
  const [ratio, setRatio] = useState<number>(loadRatio);

  useEffect(() => {
    function measure(): void {
      if (containerRef.current) setHeight(containerRef.current.clientHeight);
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const handleRatio = (r: number): void => { setRatio(r); saveRatio(r); };
  const topHeight = Math.round(height * ratio);
  const bottomHeight = Math.max(0, height - topHeight - 4);

  return (
    <nav
      ref={containerRef}
      data-testid="sidebar"
      aria-label="sidebar"
      {...(collapsed ? { 'data-collapsed': '' } : {})}
      className={
        'flex h-full flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-surface)] transition-[width] duration-150 ' +
        (collapsed ? 'w-0 overflow-hidden' : 'w-72')
      }
    >
      <div style={{ height: topHeight }} className="flex-shrink-0 overflow-y-auto">
        <RecordingPanel />
        <TablesPanel />
        <ViewsPanel />
        <MacrosPanel />
      </div>
      <SidebarSplitter ratio={ratio} onRatioChange={handleRatio} containerHeight={height} />
      <div style={{ height: bottomHeight }} className="flex-shrink-0 overflow-hidden">
        <PreviewPane />
      </div>
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/shell/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/Sidebar.tsx src/__tests__/shell/Sidebar.test.tsx
git commit -m "feat(sidebar): compose Recording/Tables/Views/Macros + splitter + preview"
```

---

## Task 14: Remove the old `SchemaExplorer`/`SidebarPreviewPane` and the old `MacrosPanel`

**Files:**
- Delete: `src/components/schema/SchemaExplorer.tsx`
- Delete: `src/components/schema/SidebarPreviewPane.tsx`
- Delete: `src/components/macros/MacrosPanel.tsx`
- Delete: `src/components/shell/MacrosPanel.tsx` (if it exists as a duplicate)
- Delete: `src/__tests__/schema/SchemaExplorer.test.tsx`
- Delete: `src/__tests__/schema/sidebarPreviewPane.test.tsx`
- Delete: `src/__tests__/shell/MacrosPanel.test.tsx` (old)

- [ ] **Step 1: Confirm nothing else imports them**

```bash
grep -rn "from '.*schema/SchemaExplorer'\|from '.*schema/SidebarPreviewPane'\|from '.*macros/MacrosPanel'\|from '.*shell/MacrosPanel'" src/ tests/ || true
```

Expected: only matches inside files we are deleting.

- [ ] **Step 2: Delete the files**

```bash
rm src/components/schema/SchemaExplorer.tsx
rm src/components/schema/SidebarPreviewPane.tsx
rm src/components/macros/MacrosPanel.tsx
rm -f src/components/shell/MacrosPanel.tsx
rm src/__tests__/schema/SchemaExplorer.test.tsx
rm src/__tests__/schema/sidebarPreviewPane.test.tsx
rm -f src/__tests__/shell/MacrosPanel.test.tsx
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Full test run**

Run: `npm test -- --run`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(sidebar): remove old SchemaExplorer/SidebarPreviewPane/MacrosPanel"
```

---

## Task 15: Playwright visual regression

**Files:**
- Create: `tests/visual/sidebar-restructure.visual.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// tests/visual/sidebar-restructure.visual.spec.ts
import { test, expect } from '@playwright/test';

test('sidebar shows new TABLES/VIEWS/MACROS layout with preview pane', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-example').click();
  await expect(page.getByTestId('tables-panel')).toBeVisible();
  await expect(page.getByTestId('views-panel')).toBeVisible();
  await expect(page.getByTestId('macros-panel')).toBeVisible();
  await expect(page.getByTestId('sidebar-splitter')).toBeVisible();
  await expect(page).toHaveScreenshot('sidebar-restructure-initial.png', { maxDiffPixels: 200 });
});

test('clicking a table populates the preview pane', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-example').click();
  const firstRow = page.locator('[data-testid^="tables-row-"]').first();
  await firstRow.click();
  await expect(page.getByTestId('preview-pane')).toBeVisible();
  await expect(page.getByTestId('preview-save-as-cell')).toBeVisible();
  await expect(page.getByTestId('preview-export-csv')).toBeVisible();
});
```

- [ ] **Step 2: Run the visual test (writes snapshot on first run)**

Run: `npx playwright test tests/visual/sidebar-restructure.visual.spec.ts --update-snapshots`
Expected: snapshot written. Re-run without `--update-snapshots` and confirm green.

- [ ] **Step 3: Commit**

```bash
git add tests/visual/sidebar-restructure.visual.spec.ts tests/visual/sidebar-restructure.visual.spec.ts-snapshots
git commit -m "test(visual): sidebar restructure golden + interaction"
```

---

## Self-Review Checklist

1. **Spec coverage:**
   - TABLES panel with row counts and expandable columns → Tasks 6, 7
   - VIEWS panel listing cross-cell `view` aliases → Tasks 2, 3, 8
   - MACROS panel with signatures + click-to-preview → Task 9
   - PREVIEW pane (editable SQL, sortable/filterable grid, "Save as Cell", "Export CSV") → Tasks 5, 12
   - Splitter between nav panels and preview → Task 11
   - RECORDING panel when JFR loaded → Tasks 4, 10 (data wired in plan 2 — M-E2 Task 8)
   - Sidebar composition → Task 13
2. **Placeholder scan:** no TBD/TODO; every step has code or an exact command.
3. **Type consistency:**
   - `TableSchema.rowCount: number | null` added in Task 6 and consumed in Task 7
   - `PreviewTarget` shape (`kind`/`name`/`sql`) used consistently in Tasks 1, 7, 8, 9, 12
   - `SchemaExplorerApi.fetchRowCount` defined in Task 6 and called in Task 7
   - `ViewEntry` shape used in Tasks 2, 3, 8
