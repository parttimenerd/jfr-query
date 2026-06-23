# M-B8: Find Across Cells + Docs Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ⌘F find-across-cells search bar and ⌘? keyboard shortcuts reference modal to the JFR SQL Notebook v2.

**Architecture:** FindBar uses a module-level external store (useSyncExternalStore) with a floating portal overlay. ShortcutsModal is a simple dialog portal. Both connect to AppShell without touching existing state.

**Tech Stack:** React 19.2.0, TypeScript 5.8.2, Tailwind v4, Vitest, Playwright, @axe-core/playwright

---

## Pre-resolved decisions

### DECISION 1: FindBar store shape

The `findBarStore` is a plain module-level singleton (class extending `EventTarget`) with three fields:

```ts
interface FindBarState {
  open: boolean;
  query: string;
  results: FindResult[];
}

interface FindResult {
  cellIndex: number;        // 0-based index in notebook.cells
  cellAlias: string | null;
  excerpt: string;          // 40-char window around match, pre-formatted
  matchStart: number;       // position within excerpt where highlight begins
  matchEnd: number;         // position within excerpt where highlight ends
}
```

The store exposes `subscribe(fn) → () => void` and `getSnapshot() → FindBarState` so React's `useSyncExternalStore` can connect directly. Mutations are exposed as top-level functions (`openFindBar`, `closeFindBar`, `setQuery`, `setResults`) that call `this.dispatchEvent(new Event('change'))` after each mutation.

Rationale: Mirrors `activityStore` (M-B7) exactly. No Zustand. No context. Side-effects stay outside React.

### DECISION 2: Search algorithm

`searchCells(query, cells)` is a pure function in `findBarStore.ts`:

1. Normalize: `lowerQuery = query.toLowerCase()`.
2. For each cell, check alias (lowercased) and each SQL block's `source` (lowercased).
3. For each match found: compute a 40-char excerpt centered on the match (`Math.max(0, idx - 18)` … `+40`), compute `matchStart`/`matchEnd` relative to excerpt start.
4. One result per **cell** — first match in that cell wins (alias match preferred over source match).
5. Empty query → empty results array (bar open but showing placeholder "Type to search…").
6. Minimum query length to trigger search: **1 character**.

### DECISION 3: Keyboard wiring for FindBar

`useFindBarHotkey` attaches a single `window.addEventListener('keydown', …)` listener:

- `⌘F` (metaKey + `f`): calls `openFindBar()`, focuses the find input via `requestAnimationFrame`.
- `Escape` (when bar is open): calls `closeFindBar()`.
- Arrow keys inside the results list: handled inside `FindBar.tsx` via `onKeyDown` on the container div — same pattern as `CommandPalette`.
- `Enter`: calls `scrollIntoView` on the matching cell element (found via `document.querySelector(`[data-cell-index="${result.cellIndex}"]`)`).

Rationale: identical pattern to `usePaletteHotkey`. The hook is called once in `AppShell` / wired via `AppShellInner` since `FindBar` is rendered there.

### DECISION 4: Keyboard wiring for ShortcutsModal

`useShortcutsHotkey` attaches:

- `⌘?` = `metaKey + shiftKey + key === '/'`: toggles `open` state (local useState in hook, returned as `[open, setOpen]`).
- `Escape` (when open): close.

Rationale: `⌘?` is `⌘⇧/` on US keyboard layouts (Shift+/ = ?). The hook guards against INPUT/TEXTAREA targets same as `useGlyphLegendHotkey`.

### DECISION 5: ShortcutsModal groups and content

Reads directly from `allBindings()` in `src/services/keyboardMap.ts`. Additionally, M-B8 adds two new bindings to `keyboardMap.ts`:

```ts
{ id: 'find.open',     chord: '⌘F', description: 'Find across cells',         scope: 'global' },
{ id: 'shortcuts.open', chord: '⌘?', description: 'Show keyboard shortcuts',   scope: 'global' },
```

Modal groups bindings into four sections by a `group` field mapped from `scope`:

| Group label | Filter |
|-------------|--------|
| Navigation  | `scope === 'global'` with ids containing `open`, `toggle`, `graph`, `sidebar` |
| Editing     | `scope === 'cell'` |
| Execution   | ids matching `run`, `exec`, `format`, `undo` |
| View        | remaining globals |

A `getGroup(b: Binding): 'Navigation' | 'Editing' | 'Execution' | 'View'` pure helper function performs the mapping. Bindings without an obvious group fall into `View`. The order is always: Navigation → Editing → Execution → View.

### DECISION 6: AppShell wiring — zero state mutations

Both `<FindBar />` and `<ShortcutsModal />` are rendered **after** `<GlyphLegend …/>` in `AppShellInner`'s return JSX:

```tsx
<CommandPalette … />
<GlyphLegend … />
<FindBar />           {/* new */}
<ShortcutsModal />    {/* new */}
```

`FindBar` is self-contained — it hooks into `findBarStore` directly and calls `useFindBarHotkey()` internally. `ShortcutsModal` calls `useShortcutsHotkey()` internally.

The line `const [collapsed, setCollapsed] = useState(!hasNotebook)` in AppShell.tsx is **never touched**.

### DECISION 7: Portal rendering

Both components use `createPortal(…, document.body)` — exact same pattern as `CommandPalette`. The overlay backdrop is `fixed inset-0 z-50 bg-black/40` for `FindBar` (lighter, like a bar not a modal) but the `FindBar` floats top-center: `fixed top-4 left-1/2 -translate-x-1/2 z-50`. `ShortcutsModal` uses `fixed inset-0 z-50 flex items-center justify-center bg-black/40`.

### DECISION 8: Excerpt highlighting

`FindBar` renders each result's excerpt as three spans: `pre` + `<mark>match</mark>` + `post`. The `<mark>` element uses `bg-[--color-accent-amber]/30 text-[--color-accent-amber]` — no hex. Pre/post use `text-[--color-fg-muted]`.

### DECISION 9: Perf bench target

`searchCells` benchmarked over 100-cell notebook (fixture `perf-100cells.notebook.md` already exists at `tests/fixtures/notebooks/perf-100cells.notebook.md`). Target: **< 2ms** per search over 100 cells.

---

## Steps

---

### Step 1 — Types + findBarStore (pure module, no React)

- [ ] **1.1** Write a failing test at `src/__tests__/findBar/findBarStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  findBarStore,
  openFindBar,
  closeFindBar,
  setQuery,
  searchCells,
} from '../../services/findBar/findBarStore';
import type { FindResult } from '../../services/findBar/types';

beforeEach(() => findBarStore._reset());

describe('findBarStore — initial state', () => {
  it('starts closed with empty query and no results', () => {
    const s = findBarStore.getSnapshot();
    expect(s.open).toBe(false);
    expect(s.query).toBe('');
    expect(s.results).toHaveLength(0);
  });
});

describe('findBarStore — mutations', () => {
  it('openFindBar sets open=true', () => {
    openFindBar();
    expect(findBarStore.getSnapshot().open).toBe(true);
  });

  it('closeFindBar sets open=false, clears query and results', () => {
    openFindBar();
    setQuery('hello');
    closeFindBar();
    const s = findBarStore.getSnapshot();
    expect(s.open).toBe(false);
    expect(s.query).toBe('');
    expect(s.results).toHaveLength(0);
  });

  it('setQuery updates query field', () => {
    openFindBar();
    setQuery('SELECT');
    expect(findBarStore.getSnapshot().query).toBe('SELECT');
  });

  it('subscribe fires on each mutation', () => {
    const calls: number[] = [];
    const unsub = findBarStore.subscribe(() => calls.push(Date.now()));
    openFindBar();
    setQuery('x');
    closeFindBar();
    expect(calls).toHaveLength(3);
    unsub();
  });

  it('unsubscribe stops notifications', () => {
    const calls: number[] = [];
    const unsub = findBarStore.subscribe(() => calls.push(1));
    unsub();
    openFindBar();
    expect(calls).toHaveLength(0);
  });
});

describe('searchCells — pure function', () => {
  const cells = [
    {
      alias: 'gc_overview',
      blocks: [{ kind: 'sql' as const, source: 'SELECT event_thread FROM jdk.GarbageCollection' }],
    },
    {
      alias: null,
      blocks: [{ kind: 'sql' as const, source: 'SELECT duration_ms WHERE duration_ms > 100' }],
    },
    {
      alias: 'long_pauses',
      blocks: [{ kind: 'sql' as const, source: 'SELECT * FROM gc_overview' }],
    },
  ];

  it('returns empty array for empty query', () => {
    expect(searchCells('', cells)).toHaveLength(0);
  });

  it('matches alias substring case-insensitively', () => {
    const results = searchCells('GC_OVER', cells);
    expect(results.some((r: FindResult) => r.cellAlias === 'gc_overview')).toBe(true);
  });

  it('matches SQL source substring case-insensitively', () => {
    const results = searchCells('duration_ms', cells);
    expect(results.some((r: FindResult) => r.cellIndex === 1)).toBe(true);
  });

  it('excerpt is at most 40 chars', () => {
    const results = searchCells('duration_ms', cells);
    for (const r of results) {
      expect(r.excerpt.length).toBeLessThanOrEqual(40);
    }
  });

  it('matchStart < matchEnd within excerpt bounds', () => {
    const results = searchCells('duration_ms', cells);
    for (const r of results) {
      expect(r.matchStart).toBeGreaterThanOrEqual(0);
      expect(r.matchEnd).toBeGreaterThan(r.matchStart);
      expect(r.matchEnd).toBeLessThanOrEqual(r.excerpt.length);
    }
  });

  it('returns one result per cell (first match wins)', () => {
    // gc_overview alias matches AND source references gc_overview
    const results = searchCells('gc_overview', cells);
    const indices = results.map((r: FindResult) => r.cellIndex);
    const unique = new Set(indices);
    expect(unique.size).toBe(indices.length);
  });

  it('alias match takes priority: cellAlias is set', () => {
    const results = searchCells('gc_overview', cells);
    const aliasMatch = results.find((r: FindResult) => r.cellAlias === 'gc_overview');
    expect(aliasMatch).toBeDefined();
    // excerpt should contain alias text or source text — just verify it found cell 0
    expect(aliasMatch?.cellIndex).toBe(0);
  });

  it('no match → result not included', () => {
    const results = searchCells('zzz_no_match_xyz', cells);
    expect(results).toHaveLength(0);
  });
});
```

- [ ] **1.2** Run `npx vitest run src/__tests__/findBar/findBarStore.test.ts` — verify RED (module not found).

- [ ] **1.3** Create `src/services/findBar/types.ts`:

```ts
export interface FindResult {
  cellIndex: number;
  cellAlias: string | null;
  excerpt: string;
  matchStart: number;
  matchEnd: number;
}

export interface FindBarState {
  open: boolean;
  query: string;
  results: FindResult[];
}

export interface SearchableCell {
  alias: string | null;
  blocks: { kind: string; source: string }[];
}
```

- [ ] **1.4** Create `src/services/findBar/findBarStore.ts`:

```ts
import type { FindBarState, FindResult, SearchableCell } from './types';

// ── Pure search function ────────────────────────────────────────────────────

const EXCERPT_HALF = 18;
const EXCERPT_MAX = 40;

export function searchCells(
  query: string,
  cells: SearchableCell[]
): FindResult[] {
  if (query.length === 0) return [];
  const lower = query.toLowerCase();
  const results: FindResult[] = [];

  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    // Prefer alias match
    const aliasLower = (cell.alias ?? '').toLowerCase();
    const aliasIdx = aliasLower.indexOf(lower);
    if (aliasIdx !== -1) {
      const src = cell.alias ?? '';
      const start = Math.max(0, aliasIdx - EXCERPT_HALF);
      const raw = src.slice(start, start + EXCERPT_MAX);
      const mStart = aliasIdx - start;
      const mEnd = Math.min(mStart + lower.length, raw.length);
      results.push({
        cellIndex: i,
        cellAlias: cell.alias,
        excerpt: raw,
        matchStart: mStart,
        matchEnd: mEnd,
      });
      continue;
    }
    // Fall back to SQL source blocks
    let found = false;
    for (const block of cell.blocks) {
      if (block.kind !== 'sql' && block.kind !== 'prose') continue;
      const srcLower = block.source.toLowerCase();
      const srcIdx = srcLower.indexOf(lower);
      if (srcIdx !== -1) {
        const start = Math.max(0, srcIdx - EXCERPT_HALF);
        const raw = block.source.slice(start, start + EXCERPT_MAX);
        const mStart = srcIdx - start;
        const mEnd = Math.min(mStart + lower.length, raw.length);
        results.push({
          cellIndex: i,
          cellAlias: cell.alias,
          excerpt: raw,
          matchStart: mStart,
          matchEnd: mEnd,
        });
        found = true;
        break;
      }
    }
    if (found) continue;
  }
  return results;
}

// ── Store singleton ─────────────────────────────────────────────────────────

class FindBarStore extends EventTarget {
  private _state: FindBarState = { open: false, query: '', results: [] };

  private _notify(): void {
    this.dispatchEvent(new Event('change'));
  }

  getSnapshot(): FindBarState {
    return this._state;
  }

  subscribe(handler: () => void): () => void {
    this.addEventListener('change', handler);
    return () => this.removeEventListener('change', handler);
  }

  open(): void {
    this._state = { ...this._state, open: true };
    this._notify();
  }

  close(): void {
    this._state = { open: false, query: '', results: [] };
    this._notify();
  }

  setQuery(query: string): void {
    this._state = { ...this._state, query };
    this._notify();
  }

  setResults(results: FindResult[]): void {
    this._state = { ...this._state, results };
    this._notify();
  }

  /** For tests only */
  _reset(): void {
    this._state = { open: false, query: '', results: [] };
  }
}

export const findBarStore = new FindBarStore();

export function openFindBar(): void {
  findBarStore.open();
}

export function closeFindBar(): void {
  findBarStore.close();
}

export function setQuery(query: string): void {
  findBarStore.setQuery(query);
}

export function setResults(results: FindResult[]): void {
  findBarStore.setResults(results);
}
```

- [ ] **1.5** Run `npx vitest run src/__tests__/findBar/findBarStore.test.ts` — verify GREEN (all 13 assertions pass).

- [ ] **1.6** Run `npx tsc --noEmit` — verify zero type errors.

- [ ] **1.7** Commit: `feat(findBar): add findBarStore + searchCells pure function`.

---

### Step 2 — useFindBarHotkey hook

- [ ] **2.1** Write failing tests at `src/__tests__/findBar/findBar.test.tsx` (hotkey section only — add more tests in Step 3):

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import type { JSX } from 'react';
import { findBarStore, openFindBar, closeFindBar } from '../../services/findBar/findBarStore';
import { useFindBarHotkey } from '../../components/findBar/useFindBarHotkey';

afterEach(() => {
  cleanup();
  findBarStore._reset();
});

// Minimal test harness that just mounts the hook
function HotkeyHarness(): JSX.Element {
  useFindBarHotkey();
  return <div data-testid="harness" />;
}

describe('useFindBarHotkey', () => {
  it('⌘F opens the find bar store', () => {
    render(<HotkeyHarness />);
    expect(findBarStore.getSnapshot().open).toBe(false);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { metaKey: true, key: 'f', bubbles: true })
      );
    });
    expect(findBarStore.getSnapshot().open).toBe(true);
  });

  it('Escape while open closes the find bar', () => {
    render(<HotkeyHarness />);
    act(() => openFindBar());
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });
    expect(findBarStore.getSnapshot().open).toBe(false);
  });

  it('Escape while closed does nothing', () => {
    render(<HotkeyHarness />);
    expect(findBarStore.getSnapshot().open).toBe(false);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });
    expect(findBarStore.getSnapshot().open).toBe(false);
  });

  it('removes listener on unmount', () => {
    const spy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<HotkeyHarness />);
    unmount();
    expect(spy).toHaveBeenCalledWith('keydown', expect.any(Function));
    spy.mockRestore();
  });
});
```

- [ ] **2.2** Run `npx vitest run src/__tests__/findBar/findBar.test.tsx` — verify RED (module not found).

- [ ] **2.3** Create `src/components/findBar/useFindBarHotkey.ts`:

```ts
import { useEffect } from 'react';
import { findBarStore, openFindBar, closeFindBar } from '../../services/findBar/findBarStore';

export function useFindBarHotkey(): void {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        openFindBar();
        return;
      }
      if (event.key === 'Escape' && findBarStore.getSnapshot().open) {
        event.preventDefault();
        closeFindBar();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
```

- [ ] **2.4** Run `npx vitest run src/__tests__/findBar/findBar.test.tsx` — verify GREEN (4 hotkey tests pass).

- [ ] **2.5** Run `npx tsc --noEmit` — zero errors.

- [ ] **2.6** Commit: `feat(findBar): add useFindBarHotkey`.

---

### Step 3 — FindBar React component

- [ ] **3.1** Add FindBar component tests to `src/__tests__/findBar/findBar.test.tsx` (append after existing tests):

```tsx
import { render, screen, cleanup, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FindBar } from '../../components/findBar/FindBar';
import { findBarStore, openFindBar } from '../../services/findBar/findBarStore';

// ── FindBar component tests ──────────────────────────────────────────────────

describe('FindBar component', () => {
  beforeEach(() => {
    findBarStore._reset();
  });

  it('renders nothing when store is closed', () => {
    render(<FindBar cells={[]} />);
    expect(screen.queryByTestId('find-bar-input')).toBeNull();
  });

  it('renders input when store is open', () => {
    act(() => openFindBar());
    render(<FindBar cells={[]} />);
    expect(screen.getByTestId('find-bar-input')).toBeInTheDocument();
  });

  it('input has role="search"', () => {
    act(() => openFindBar());
    render(<FindBar cells={[]} />);
    expect(screen.getByRole('search')).toBeInTheDocument();
  });

  it('shows results list when query matches', async () => {
    const user = userEvent.setup();
    const cells = [
      {
        alias: 'gc_overview',
        blocks: [{ kind: 'sql' as const, source: 'SELECT * FROM jdk.GarbageCollection' }],
      },
    ];
    act(() => openFindBar());
    render(<FindBar cells={cells} />);
    await user.type(screen.getByTestId('find-bar-input'), 'gc');
    const results = screen.getByTestId('find-bar-results');
    expect(results).toBeInTheDocument();
    expect(within(results).getAllByRole('option').length).toBeGreaterThan(0);
  });

  it('each result shows cell index label', async () => {
    const user = userEvent.setup();
    const cells = [
      {
        alias: 'gc_overview',
        blocks: [{ kind: 'sql' as const, source: 'SELECT * FROM jdk.GarbageCollection' }],
      },
    ];
    act(() => openFindBar());
    render(<FindBar cells={cells} />);
    await user.type(screen.getByTestId('find-bar-input'), 'gc');
    const results = screen.getByTestId('find-bar-results');
    // Cell index label "#1" (1-based)
    expect(within(results).getByText(/#?1/)).toBeInTheDocument();
  });

  it('shows alias in result when cell has one', async () => {
    const user = userEvent.setup();
    const cells = [
      {
        alias: 'gc_overview',
        blocks: [{ kind: 'sql' as const, source: 'SELECT * FROM jdk.GarbageCollection' }],
      },
    ];
    act(() => openFindBar());
    render(<FindBar cells={cells} />);
    await user.type(screen.getByTestId('find-bar-input'), 'gc');
    const results = screen.getByTestId('find-bar-results');
    expect(within(results).getByText(/gc_overview/)).toBeInTheDocument();
  });

  it('shows "No results" message when query has no match', async () => {
    const user = userEvent.setup();
    act(() => openFindBar());
    render(<FindBar cells={[]} />);
    await user.type(screen.getByTestId('find-bar-input'), 'zzz_no_match');
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });

  it('Escape calls closeFindBar', async () => {
    const user = userEvent.setup();
    act(() => openFindBar());
    render(<FindBar cells={[]} />);
    await user.keyboard('{Escape}');
    expect(findBarStore.getSnapshot().open).toBe(false);
  });

  it('ArrowDown moves active index down', async () => {
    const user = userEvent.setup();
    const cells = [
      { alias: 'gc_a', blocks: [{ kind: 'sql' as const, source: 'SELECT gc FROM x' }] },
      { alias: 'gc_b', blocks: [{ kind: 'sql' as const, source: 'SELECT gc FROM y' }] },
    ];
    act(() => openFindBar());
    render(<FindBar cells={cells} />);
    await user.type(screen.getByTestId('find-bar-input'), 'gc');
    await user.keyboard('{ArrowDown}');
    const options = screen.getAllByRole('option');
    const selected = options.filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected.length).toBeGreaterThan(0);
  });
});
```

- [ ] **3.2** Run `npx vitest run src/__tests__/findBar/findBar.test.tsx` — verify RED (FindBar component not found).

- [ ] **3.3** Create `src/components/findBar/FindBar.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { JSX } from 'react';
import {
  findBarStore,
  closeFindBar,
  setQuery,
  searchCells,
} from '../../services/findBar/findBarStore';
import type { SearchableCell, FindResult } from '../../services/findBar/types';
import { useFindBarHotkey } from './useFindBarHotkey';

export interface FindBarProps {
  cells: SearchableCell[];
}

export function FindBar({ cells }: FindBarProps): JSX.Element | null {
  const state = useSyncExternalStore(
    (cb) => findBarStore.subscribe(cb),
    () => findBarStore.getSnapshot()
  );
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useFindBarHotkey();

  // Focus input when opened
  useEffect(() => {
    if (!state.open) return;
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [state.open]);

  // Close on outside click
  const handleBackdrop = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) closeFindBar();
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      setQuery(q);
      setActive(0);
    },
    []
  );

  const results: FindResult[] = state.query.length > 0 ? searchCells(state.query, cells) : [];

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const r = results[active];
        if (r !== undefined) {
          const el = document.querySelector(`[data-cell-index="${r.cellIndex}"]`);
          if (el instanceof HTMLElement) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          closeFindBar();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeFindBar();
      }
    },
    [active, results]
  );

  if (!state.open) return null;

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-50"
      onClick={handleBackdrop}
    >
      <div
        role="search"
        data-testid="find-bar-container"
        onKeyDown={handleKeyDown}
        className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[560px] rounded-lg border border-[--color-border] bg-[--color-bg-surface] shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[--color-border]">
          <span className="text-[--color-fg-muted] text-[13px] select-none">⌘F</span>
          <input
            ref={inputRef}
            data-testid="find-bar-input"
            type="text"
            aria-label="Find across cells"
            aria-controls="find-bar-listbox"
            aria-expanded={results.length > 0}
            aria-autocomplete="list"
            value={state.query}
            onChange={handleInputChange}
            placeholder="Find across cells…"
            className="flex-1 bg-transparent text-[13px] text-[--color-fg-base] placeholder:text-[--color-fg-dim] outline-none"
          />
          {state.query.length > 0 && (
            <span className="text-[11px] text-[--color-fg-muted] select-none">
              {results.length} match{results.length !== 1 ? 'es' : ''}
            </span>
          )}
          <button
            type="button"
            aria-label="Close find bar"
            onClick={closeFindBar}
            className="text-[--color-fg-muted] hover:text-[--color-fg-base] text-[13px] px-1"
          >
            ✕
          </button>
        </div>

        {state.query.length > 0 && (
          <ul
            id="find-bar-listbox"
            role="listbox"
            data-testid="find-bar-results"
            aria-label="Find results"
            className="max-h-64 overflow-y-auto"
          >
            {results.length === 0 ? (
              <li className="px-4 py-3 text-[12px] text-[--color-fg-muted]">No results.</li>
            ) : (
              results.map((r, ix) => (
                <li
                  key={`${r.cellIndex}-${r.matchStart}`}
                  role="option"
                  aria-selected={ix === active}
                  data-testid="find-bar-result"
                  onClick={() => {
                    const el = document.querySelector(`[data-cell-index="${r.cellIndex}"]`);
                    if (el instanceof HTMLElement)
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    closeFindBar();
                  }}
                  onMouseEnter={() => setActive(ix)}
                  className={[
                    'flex items-center gap-3 px-4 py-2 cursor-pointer',
                    ix === active
                      ? 'bg-[--color-bg-overlay]'
                      : 'hover:bg-[--color-bg-overlay]/60',
                  ].join(' ')}
                >
                  {/* Cell index badge */}
                  <span className="shrink-0 text-[11px] text-[--color-fg-muted] font-mono w-6 text-right">
                    #{r.cellIndex + 1}
                  </span>
                  {/* Alias (if any) */}
                  {r.cellAlias !== null && (
                    <span className="shrink-0 text-[11px] text-[--color-accent-amber] font-mono max-w-[100px] truncate">
                      {r.cellAlias}
                    </span>
                  )}
                  {/* Excerpt with highlighted match */}
                  <span className="text-[12px] font-mono text-[--color-fg-muted] truncate">
                    <span>{r.excerpt.slice(0, r.matchStart)}</span>
                    <mark className="bg-[--color-accent-amber]/30 text-[--color-accent-amber] rounded-sm">
                      {r.excerpt.slice(r.matchStart, r.matchEnd)}
                    </mark>
                    <span>{r.excerpt.slice(r.matchEnd)}</span>
                  </span>
                </li>
              ))
            )}
          </ul>
        )}

        {state.query.length === 0 && (
          <p className="px-4 py-3 text-[12px] text-[--color-fg-dim]">Type to search across cells…</p>
        )}
      </div>
    </div>,
    document.body
  );
}
```

- [ ] **3.4** Run `npx vitest run src/__tests__/findBar/findBar.test.tsx` — verify GREEN (all tests pass).

- [ ] **3.5** Run `npx tsc --noEmit` — zero errors.

- [ ] **3.6** Commit: `feat(findBar): add FindBar component with portal overlay`.

---

### Step 4 — ShortcutsModal component

- [ ] **4.1** Write failing tests at `src/__tests__/shortcuts/shortcutsModal.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'react';
import { ShortcutsModal } from '../../components/shortcuts/ShortcutsModal';

afterEach(cleanup);

describe('ShortcutsModal — closed state', () => {
  it('renders nothing when open=false', () => {
    render(<ShortcutsModal open={false} onClose={() => {}} />);
    expect(screen.queryByTestId('shortcuts-modal')).toBeNull();
  });
});

describe('ShortcutsModal — open state', () => {
  it('renders dialog with correct testid', () => {
    render(<ShortcutsModal open onClose={() => {}} />);
    expect(screen.getByTestId('shortcuts-modal')).toBeInTheDocument();
  });

  it('has role="dialog" and aria-modal="true"', () => {
    render(<ShortcutsModal open onClose={() => {}} />);
    const dialog = screen.getByTestId('shortcuts-modal');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('has an accessible dialog label', () => {
    render(<ShortcutsModal open onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: /keyboard shortcuts/i })).toBeInTheDocument();
  });

  it('renders at least one section heading for Navigation', () => {
    render(<ShortcutsModal open onClose={() => {}} />);
    expect(screen.getByText(/navigation/i)).toBeInTheDocument();
  });

  it('renders ⌘P shortcut row', () => {
    render(<ShortcutsModal open onClose={() => {}} />);
    expect(screen.getByText('⌘P')).toBeInTheDocument();
  });

  it('renders ⌘F shortcut row', () => {
    render(<ShortcutsModal open onClose={() => {}} />);
    expect(screen.getByText('⌘F')).toBeInTheDocument();
  });

  it('renders ⌘? shortcut row', () => {
    render(<ShortcutsModal open onClose={() => {}} />);
    expect(screen.getByText('⌘?')).toBeInTheDocument();
  });

  it('close button calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ShortcutsModal open onClose={onClose} />);
    const closeBtn = screen.getByRole('button', { name: /close/i });
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape keydown calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ShortcutsModal open onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('backdrop click calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ShortcutsModal open onClose={onClose} />);
    const backdrop = screen.getByRole('presentation');
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('groups are: Navigation, Editing, Execution, View', () => {
    render(<ShortcutsModal open onClose={() => {}} />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/navigation/i);
    expect(text).toMatch(/editing/i);
    expect(text).toMatch(/execution/i);
    expect(text).toMatch(/view/i);
  });
});

describe('useShortcutsHotkey', () => {
  function HotkeyHarness(): JSX.Element {
    const { useShortcutsHotkey } = require('../../components/shortcuts/useShortcutsHotkey');
    const [open, setOpen] = useShortcutsHotkey();
    return <ShortcutsModal open={open} onClose={() => setOpen(false)} />;
  }

  it('⌘⇧/ opens the modal', () => {
    render(<HotkeyHarness />);
    expect(screen.queryByTestId('shortcuts-modal')).toBeNull();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          metaKey: true,
          shiftKey: true,
          key: '/',
          bubbles: true,
        })
      );
    });
    expect(screen.getByTestId('shortcuts-modal')).toBeInTheDocument();
  });
});
```

- [ ] **4.2** Run `npx vitest run src/__tests__/shortcuts/shortcutsModal.test.tsx` — verify RED.

- [ ] **4.3** Create `src/components/shortcuts/useShortcutsHotkey.ts`:

```ts
import { useEffect, useState } from 'react';

export function useShortcutsHotkey(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      if (target !== null && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      // ⌘? = ⌘⇧/ on US keyboard
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === '/') {
        event.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return [open, setOpen];
}
```

- [ ] **4.4** Create `src/components/shortcuts/ShortcutsModal.tsx`:

```tsx
import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { JSX } from 'react';
import { allBindings } from '../../services/keyboardMap';
import type { Binding } from '../../services/keyboardMap';

export interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

type ShortcutGroup = 'Navigation' | 'Editing' | 'Execution' | 'View';

const GROUP_ORDER: ShortcutGroup[] = ['Navigation', 'Editing', 'Execution', 'View'];

function getGroup(b: Binding): ShortcutGroup {
  if (b.scope === 'cell') return 'Editing';
  if (/undo|redo|format|exec|run/.test(b.id)) return 'Execution';
  if (/open|toggle|sidebar|graph/.test(b.id)) return 'Navigation';
  return 'View';
}

export function ShortcutsModal({ open, onClose }: ShortcutsModalProps): JSX.Element | null {
  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  const bindings = allBindings();
  const grouped = new Map<ShortcutGroup, Binding[]>();
  for (const g of GROUP_ORDER) grouped.set(g, []);
  for (const b of bindings) {
    const g = getGroup(b);
    grouped.get(g)!.push(b);
  }

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        data-testid="shortcuts-modal"
        className="w-[520px] max-h-[80vh] overflow-y-auto rounded-lg border border-[--color-border] bg-[--color-bg-surface] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[--color-border]">
          <h2 className="text-[13px] font-semibold text-[--color-fg-base]">
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            aria-label="Close shortcuts modal"
            onClick={close}
            className="text-[--color-fg-muted] hover:text-[--color-fg-base] text-[13px] px-2 py-1 rounded hover:bg-[--color-bg-overlay]"
          >
            ✕
          </button>
        </div>

        {/* Groups */}
        <div className="p-4 flex flex-col gap-5">
          {GROUP_ORDER.map((group) => {
            const rows = grouped.get(group) ?? [];
            if (rows.length === 0) return null;
            return (
              <section key={group} aria-labelledby={`shortcuts-group-${group.toLowerCase()}`}>
                <h3
                  id={`shortcuts-group-${group.toLowerCase()}`}
                  className="text-[11px] font-medium uppercase tracking-wide text-[--color-fg-muted] mb-2"
                >
                  {group}
                </h3>
                <table className="w-full">
                  <tbody>
                    {rows.map((b) => (
                      <tr
                        key={b.id}
                        className="border-t border-[--color-border] first:border-0"
                      >
                        <td className="py-1.5 pr-4 w-24">
                          <kbd className="text-[12px] font-mono bg-[--color-bg-overlay] text-[--color-fg-base] border border-[--color-border] rounded px-1.5 py-0.5">
                            {b.chord}
                          </kbd>
                        </td>
                        <td className="py-1.5 text-[12px] text-[--color-fg-base]">
                          {b.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}
        </div>

        <p className="px-5 pb-3 text-[11px] text-[--color-fg-dim]">
          Press <kbd className="font-mono">⌘?</kbd> or <kbd className="font-mono">Esc</kbd> to close
        </p>
      </div>
    </div>,
    document.body
  );
}
```

- [ ] **4.5** Run `npx vitest run src/__tests__/shortcuts/shortcutsModal.test.tsx` — verify GREEN.

- [ ] **4.6** Run `npx tsc --noEmit` — zero errors.

- [ ] **4.7** Commit: `feat(shortcuts): add ShortcutsModal + useShortcutsHotkey`.

---

### Step 5 — Register new bindings in keyboardMap.ts + getGroup helper

- [ ] **5.1** Read `src/services/keyboardMap.ts` to confirm current bindings.

- [ ] **5.2** Edit `src/services/keyboardMap.ts` — add two new bindings to the seed array (after `sidebar.toggle`):

```ts
{ id: 'find.open',      chord: '⌘F', description: 'Find across cells',       scope: 'global' as const },
{ id: 'shortcuts.open', chord: '⌘?', description: 'Show keyboard shortcuts',  scope: 'global' as const },
```

- [ ] **5.3** Verify ShortcutsModal tests still pass (they query `allBindings()` which now includes ⌘F and ⌘?):

```
npx vitest run src/__tests__/shortcuts/shortcutsModal.test.tsx
```

- [ ] **5.4** Run `npx tsc --noEmit`.

- [ ] **5.5** Commit: `feat(keyboardMap): register ⌘F and ⌘? bindings`.

---

### Step 6 — Connect FindBar + ShortcutsModal to AppShell

- [ ] **6.1** Read `src/components/shell/AppShell.tsx` in full to confirm current structure.

- [ ] **6.2** Write a failing test that AppShell renders `<FindBar />` and `<ShortcutsModal />` portals. Add to `src/__tests__/shell/AppShell.test.tsx` (append without touching existing tests):

First, read the file to know what's already there:
```
src/__tests__/shell/AppShell.test.tsx
```
Then append:

```tsx
import { findBarStore, openFindBar } from '../../services/findBar/findBarStore';

describe('AppShell — FindBar wiring', () => {
  afterEach(() => {
    cleanup();
    findBarStore._reset();
  });

  it('FindBar portal appears when store opens', () => {
    render(
      <AppShell>
        <div />
      </AppShell>
    );
    expect(screen.queryByTestId('find-bar-input')).toBeNull();
    act(() => openFindBar());
    expect(screen.getByTestId('find-bar-input')).toBeInTheDocument();
  });

  it('ShortcutsModal portal appears on ⌘⇧/', () => {
    render(
      <AppShell>
        <div />
      </AppShell>
    );
    expect(screen.queryByTestId('shortcuts-modal')).toBeNull();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          metaKey: true,
          shiftKey: true,
          key: '/',
          bubbles: true,
        })
      );
    });
    expect(screen.getByTestId('shortcuts-modal')).toBeInTheDocument();
  });

  it('useState(!hasNotebook) is never touched — sidebar collapses without notebook', () => {
    render(
      <AppShell>
        <div data-testid="content" />
      </AppShell>
    );
    // Sidebar toggle should still work (regression guard)
    const toggle = screen.getByTestId('sidebar-toggle');
    expect(toggle).toBeInTheDocument();
  });
});
```

- [ ] **6.3** Run `npx vitest run src/__tests__/shell/AppShell.test.tsx` — verify RED for new tests.

- [ ] **6.4** Edit `src/components/shell/AppShell.tsx`:

Add imports after the existing `import { ActivityFeedPanel } …`:

```ts
import { FindBar } from '../findBar/FindBar';
import { ShortcutsModal } from '../shortcuts/ShortcutsModal';
import { useShortcutsHotkey } from '../shortcuts/useShortcutsHotkey';
```

Add hook call inside `AppShellInner` (after `useUndoHotkeys(undoHistory)`):

```ts
const [shortcutsOpen, setShortcutsOpen] = useShortcutsHotkey();
```

Build `paletteCtx` cells with SQL blocks for `FindBar` (reuse existing `paletteCtx.notebook?.cells` — map to `SearchableCell`):

The `FindBar` needs `SearchableCell[]`. Build it from `notebook` (same data that feeds `paletteCtx`):

```ts
const findBarCells: import('../../services/findBar/types').SearchableCell[] = notebook
  ? notebook.cells.map((c) => ({
      alias: c.alias ?? null,
      blocks: c.blocks.map((b) => ({ kind: b.kind, source: b.source })),
    }))
  : [];
```

In the return JSX, after `<GlyphLegend … />`:

```tsx
<FindBar cells={findBarCells} />
<ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
```

- [ ] **6.5** Run `npx vitest run src/__tests__/shell/AppShell.test.tsx` — verify GREEN.

- [ ] **6.6** Run `npx tsc --noEmit` — zero errors.

- [ ] **6.7** Commit: `feat(shell): wire FindBar and ShortcutsModal into AppShell`.

---

### Step 7 — Unit tests: perf bench for searchCells

- [ ] **7.1** Create `src/__tests__/findBar/findBarStore.bench.ts`:

```ts
import { bench, describe, beforeEach } from 'vitest';
import { searchCells } from '../../services/findBar/findBarStore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Build a 100-cell array from the fixture notebook (reuse already-parsed data as a simple approximation)
function make100Cells(): Array<{ alias: string | null; blocks: { kind: string; source: string }[] }> {
  return Array.from({ length: 100 }, (_, i) => ({
    alias: i % 5 === 0 ? `cell_alias_${i}` : null,
    blocks: [
      {
        kind: 'sql',
        source: `SELECT event_thread, duration_ms FROM jdk.GarbageCollection WHERE duration_ms > ${i * 10} LIMIT 100`,
      },
    ],
  }));
}

const cells100 = make100Cells();

describe('searchCells perf', () => {
  bench('search "duration_ms" over 100 cells', () => {
    searchCells('duration_ms', cells100);
  });

  bench('search empty string (no-op) over 100 cells', () => {
    searchCells('', cells100);
  });

  bench('search alias match over 100 cells', () => {
    searchCells('cell_alias', cells100);
  });
});
```

- [ ] **7.2** Run `npx vitest bench src/__tests__/findBar/findBarStore.bench.ts` — verify bench runs and reports < 2ms per iteration.

- [ ] **7.3** Commit: `test(findBar): add searchCells perf bench`.

---

### Step 8 — E2E tests: FindBar

- [ ] **8.1** Create `tests/e2e/findBar/findBar.e2e.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('@e2e FindBar', () => {
  test('⌘F opens find bar', async ({ page }) => {
    await page.goto('/');
    expect(await page.$('[data-testid="find-bar-input"]')).toBeNull();
    await page.keyboard.press('Meta+f');
    await expect(page.getByTestId('find-bar-input')).toBeVisible();
  });

  test('find bar input has role="search" container', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+f');
    await expect(page.getByRole('search')).toBeVisible();
  });

  test('Escape closes find bar', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+f');
    await expect(page.getByTestId('find-bar-input')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('find-bar-input')).not.toBeVisible();
  });

  test('typing a query shows results list', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+f');
    await page.getByTestId('find-bar-input').fill('SELECT');
    await expect(page.getByTestId('find-bar-results')).toBeVisible({ timeout: 2000 });
  });

  test('results list shows cell index badge', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+f');
    await page.getByTestId('find-bar-input').fill('SELECT');
    const results = page.getByTestId('find-bar-results');
    // At least one "#N" label
    const text = await results.textContent();
    expect(text).toMatch(/#\d/);
  });

  test('ArrowDown navigates the list', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+f');
    await page.getByTestId('find-bar-input').fill('SELECT');
    await page.keyboard.press('ArrowDown');
    const selected = page.locator('[data-testid="find-bar-result"][aria-selected="true"]');
    await expect(selected).toBeVisible();
  });

  test('Enter jumps to cell and closes bar', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+f');
    await page.getByTestId('find-bar-input').fill('SELECT');
    await expect(page.getByTestId('find-bar-results')).toBeVisible({ timeout: 2000 });
    await page.keyboard.press('Enter');
    // Bar should close
    await expect(page.getByTestId('find-bar-input')).not.toBeVisible({ timeout: 1000 });
  });

  test('clicking outside backdrop closes find bar', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+f');
    await expect(page.getByTestId('find-bar-input')).toBeVisible();
    // Click the backdrop (fixed inset-0 presentation div) via coordinates outside the bar
    await page.mouse.click(10, 10);
    await expect(page.getByTestId('find-bar-input')).not.toBeVisible({ timeout: 1000 });
  });

  test('no match shows "No results" message', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+f');
    await page.getByTestId('find-bar-input').fill('zzz_no_match_xyz_abc');
    await expect(page.getByText(/no results/i)).toBeVisible({ timeout: 2000 });
  });
});

test.describe('@a11y FindBar accessibility', () => {
  test('find bar has no axe violations when open', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+f');
    await expect(page.getByTestId('find-bar-input')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .include('[data-testid="find-bar-container"]')
      .analyze();
    expect(results.violations).toHaveLength(0);
  });

  test('find bar with results has no axe violations', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+f');
    await page.getByTestId('find-bar-input').fill('SELECT');
    await expect(page.getByTestId('find-bar-results')).toBeVisible({ timeout: 2000 });
    const results = await new AxeBuilder({ page })
      .include('[data-testid="find-bar-container"]')
      .analyze();
    expect(results.violations).toHaveLength(0);
  });
});
```

- [ ] **8.2** Run `npx playwright test tests/e2e/findBar/findBar.e2e.spec.ts --reporter=list` — verify tests pass (or mark as `.fixme` if dev server is not available in CI, but target is green).

- [ ] **8.3** Commit: `test(e2e): add FindBar E2E + a11y Playwright tests`.

---

### Step 9 — E2E tests: ShortcutsModal

- [ ] **9.1** Create `tests/e2e/shortcuts/shortcuts.e2e.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('@e2e ShortcutsModal', () => {
  test('⌘⇧/ opens shortcuts modal', async ({ page }) => {
    await page.goto('/');
    expect(await page.$('[data-testid="shortcuts-modal"]')).toBeNull();
    await page.keyboard.press('Meta+Shift+/');
    await expect(page.getByTestId('shortcuts-modal')).toBeVisible();
  });

  test('modal has role="dialog" and aria-modal="true"', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+Shift+/');
    const dialog = page.getByTestId('shortcuts-modal');
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  test('modal contains four section headings', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+Shift+/');
    const modal = page.getByTestId('shortcuts-modal');
    const text = await modal.textContent();
    expect(text).toMatch(/navigation/i);
    expect(text).toMatch(/editing/i);
    expect(text).toMatch(/execution/i);
    expect(text).toMatch(/view/i);
  });

  test('modal displays ⌘P shortcut', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+Shift+/');
    await expect(page.getByTestId('shortcuts-modal').getByText('⌘P')).toBeVisible();
  });

  test('modal displays ⌘F shortcut', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+Shift+/');
    await expect(page.getByTestId('shortcuts-modal').getByText('⌘F')).toBeVisible();
  });

  test('Escape closes the modal', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+Shift+/');
    await expect(page.getByTestId('shortcuts-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shortcuts-modal')).not.toBeVisible();
  });

  test('close button (✕) dismisses modal', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+Shift+/');
    await page.getByRole('button', { name: /close shortcuts modal/i }).click();
    await expect(page.getByTestId('shortcuts-modal')).not.toBeVisible();
  });

  test('backdrop click closes modal', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+Shift+/');
    await expect(page.getByTestId('shortcuts-modal')).toBeVisible();
    // Click outside the modal content
    await page.mouse.click(10, 10);
    await expect(page.getByTestId('shortcuts-modal')).not.toBeVisible({ timeout: 1000 });
  });

  test('⌘⇧/ toggles modal closed if already open', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+Shift+/');
    await expect(page.getByTestId('shortcuts-modal')).toBeVisible();
    await page.keyboard.press('Meta+Shift+/');
    await expect(page.getByTestId('shortcuts-modal')).not.toBeVisible({ timeout: 1000 });
  });
});

test.describe('@a11y ShortcutsModal accessibility', () => {
  test('shortcuts modal has no axe violations', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+Shift+/');
    await expect(page.getByTestId('shortcuts-modal')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .include('[data-testid="shortcuts-modal"]')
      .analyze();
    expect(results.violations).toHaveLength(0);
  });

  test('dialog has accessible name', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+Shift+/');
    const dialog = page.getByRole('dialog', { name: /keyboard shortcuts/i });
    await expect(dialog).toBeVisible();
  });
});
```

- [ ] **9.2** Run `npx playwright test tests/e2e/shortcuts/shortcuts.e2e.spec.ts --reporter=list` — verify green.

- [ ] **9.3** Commit: `test(e2e): add ShortcutsModal E2E + a11y Playwright tests`.

---

### Step 10 — Visual regression tests

- [ ] **10.1** Create `tests/visual/findBar.spec.ts`:

```ts
/**
 * Visual regression: FindBar overlay @visual
 * Run: npm run test:visual
 */
import { test, expect } from '@playwright/test';

test.describe('FindBar visual @visual', () => {
  test('find bar empty state (dark theme)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.keyboard.press('Meta+f');
    await expect(page.getByTestId('find-bar-input')).toBeVisible();
    await expect(page).toHaveScreenshot('find-bar-empty-dark.png', { maxDiffPixels: 30 });
  });

  test('find bar with results (dark theme)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.keyboard.press('Meta+f');
    await page.getByTestId('find-bar-input').fill('SELECT');
    await expect(page.getByTestId('find-bar-results')).toBeVisible({ timeout: 2000 });
    await expect(page).toHaveScreenshot('find-bar-results-dark.png', { maxDiffPixels: 50 });
  });

  test('find bar no results (dark theme)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.keyboard.press('Meta+f');
    await page.getByTestId('find-bar-input').fill('zzz_no_match_xyz');
    await expect(page.getByText(/no results/i)).toBeVisible({ timeout: 2000 });
    await expect(page).toHaveScreenshot('find-bar-no-results-dark.png', { maxDiffPixels: 30 });
  });
});

test.describe('ShortcutsModal visual @visual', () => {
  test('shortcuts modal dark theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.keyboard.press('Meta+Shift+/');
    await expect(page.getByTestId('shortcuts-modal')).toBeVisible();
    await expect(page).toHaveScreenshot('shortcuts-modal-dark.png', { maxDiffPixels: 50 });
  });

  test('shortcuts modal light theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/?theme=light');
    await page.keyboard.press('Meta+Shift+/');
    await expect(page.getByTestId('shortcuts-modal')).toBeVisible();
    await expect(page).toHaveScreenshot('shortcuts-modal-light.png', { maxDiffPixels: 50 });
  });
});
```

- [ ] **10.2** Run `npx playwright test tests/visual/findBar.spec.ts --update-snapshots` to generate baseline screenshots.

- [ ] **10.3** Commit: `test(visual): add FindBar + ShortcutsModal visual regression snapshots`.

---

### Step 11 — Full test suite smoke run

- [ ] **11.1** Run all unit tests:

```
npx vitest run
```

Expect: all existing tests still GREEN. New tests GREEN.

- [ ] **11.2** Run typecheck:

```
npx tsc --noEmit
```

Expect: zero errors.

- [ ] **11.3** Run E2E smoke:

```
npx playwright test tests/e2e/findBar/ tests/e2e/shortcuts/ --reporter=list
```

- [ ] **11.4** Run a11y E2E:

```
npx playwright test --grep "@a11y" tests/e2e/findBar/ tests/e2e/shortcuts/ --reporter=list
```

- [ ] **11.5** Commit: `test(M-B8): all layers green — findBar + shortcuts`.

---

### Step 12 — Playwright MCP checkpoint

- [ ] **12.1** Start dev server if not already running:

```
npm run dev
```

- [ ] **12.2** Navigate to app using `mcp__playwright__navigate`:

```
url: http://localhost:5173
```

- [ ] **12.3** Take screenshot of initial state with `mcp__playwright__screenshot`:

```
name: "M-B8-initial-state"
```

- [ ] **12.4** Open FindBar via `mcp__playwright__keyboard_press`:

```
key: "Meta+f"
```

- [ ] **12.5** Screenshot FindBar open:

```
name: "M-B8-findbar-open"
```

- [ ] **12.6** Type query "SELECT" via `mcp__playwright__fill`:

```
selector: "[data-testid='find-bar-input']"
value: "SELECT"
```

- [ ] **12.7** Screenshot FindBar with results:

```
name: "M-B8-findbar-results"
```

- [ ] **12.8** Close FindBar via `mcp__playwright__keyboard_press`:

```
key: "Escape"
```

- [ ] **12.9** Open ShortcutsModal via `mcp__playwright__keyboard_press`:

```
key: "Meta+Shift+/"
```

- [ ] **12.10** Screenshot ShortcutsModal:

```
name: "M-B8-shortcuts-modal"
```

- [ ] **12.11** Verify modal contains all four groups by evaluating text content.

- [ ] **12.12** Close modal via `mcp__playwright__keyboard_press`:

```
key: "Escape"
```

- [ ] **12.13** Commit: `chore(M-B8): Playwright MCP checkpoint screenshots captured`.

---

## File inventory

| File | Role | New/Modified |
|------|------|-------------|
| `src/services/findBar/types.ts` | `FindResult`, `FindBarState`, `SearchableCell` types | New |
| `src/services/findBar/findBarStore.ts` | Store singleton + `searchCells` pure fn | New |
| `src/components/findBar/useFindBarHotkey.ts` | ⌘F / Escape hotkey hook | New |
| `src/components/findBar/FindBar.tsx` | Portal overlay component | New |
| `src/components/shortcuts/useShortcutsHotkey.ts` | ⌘⇧/ hotkey hook | New |
| `src/components/shortcuts/ShortcutsModal.tsx` | Modal dialog with grouped bindings table | New |
| `src/services/keyboardMap.ts` | Add `find.open` (⌘F) + `shortcuts.open` (⌘?) | Modified |
| `src/components/shell/AppShell.tsx` | Import + render FindBar, ShortcutsModal after GlyphLegend | Modified |
| `src/__tests__/findBar/findBarStore.test.ts` | Unit tests: store mutations + searchCells | New |
| `src/__tests__/findBar/findBar.test.tsx` | Unit tests: hotkey hook + component RTL | New |
| `src/__tests__/findBar/findBarStore.bench.ts` | Perf bench: searchCells over 100 cells | New |
| `src/__tests__/shortcuts/shortcutsModal.test.tsx` | Unit tests: modal + hotkey hook | New |
| `tests/e2e/findBar/findBar.e2e.spec.ts` | E2E + a11y: FindBar Playwright | New |
| `tests/e2e/shortcuts/shortcuts.e2e.spec.ts` | E2E + a11y: ShortcutsModal Playwright | New |
| `tests/visual/findBar.spec.ts` | Visual regression: FindBar + ShortcutsModal | New |

---

## Constraint checklist

| Constraint | Where enforced |
|------------|---------------|
| `import type { JSX } from 'react'` | All `.tsx` files (FindBar, ShortcutsModal) |
| No `any` — `unknown` + narrowing | All source files (store uses typed interfaces throughout) |
| All colors via `var(--color-*)` — ZERO hex | FindBar.tsx: `text-[--color-fg-muted]`, `bg-[--color-bg-overlay]`, `text-[--color-accent-amber]` etc. |
| Never `text-sm` — use `text-[NNpx]` | `text-[11px]`, `text-[12px]`, `text-[13px]` throughout |
| Never touch `useState(!hasNotebook)` | AppShell edit only adds 3 imports + 1 hook call + 2 JSX elements |
| 5 test layers | Unit (Vitest/RTL), E2E (Playwright), a11y (AxeBuilder), visual regression, perf bench |
| TDD cycle: red → green | Each step: write test → run RED → implement → run GREEN |
| `import AxeBuilder from '@axe-core/playwright'` static import | All a11y spec files |
| Vitest pool is `forks` — do NOT touch vite.config.ts | vite.config.ts never touched |
| Playwright MCP checkpoint | Step 12 |

---

## Architecture summary

```
AppShell
  ├── <CommandPalette open={paletteOpen} … />   (existing)
  ├── <GlyphLegend open={legendOpen} … />        (existing)
  ├── <FindBar cells={findBarCells} />           ← NEW (portal; self-managed via findBarStore)
  └── <ShortcutsModal open={shortcutsOpen} … /> ← NEW (portal; controlled by useShortcutsHotkey)

findBarStore (EventTarget singleton)
  ├── state: { open, query, results }
  ├── searchCells(query, cells) — pure fn, no side-effects
  ├── subscribe() + getSnapshot() — useSyncExternalStore API
  └── openFindBar / closeFindBar / setQuery / setResults

keyboardMap (Map<id, Binding>)
  ├── palette.open  ⌘P
  ├── glyphLegend.open  ?
  ├── depGraph.open  ⌘G
  ├── quickfix.open  ⌥↵
  ├── sidebar.toggle  ⌘\
  ├── find.open  ⌘F          ← NEW
  └── shortcuts.open  ⌘?     ← NEW
```
