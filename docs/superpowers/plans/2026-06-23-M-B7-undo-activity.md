# M-B7: Three-Grain Undo + Activity Feed Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans.
> **Testing standard:** See docs/superpowers/TESTING_STANDARD.md — all 5 layers apply.

**Goal:** Deliver a three-grain undo system and a right-rail activity feed panel. The **three-grain undo** system manages distinct levels of undo: (1) **coarse cell-level undo** (reverting a complete cell source edit with `⌘Z`), (2) **structural notebook-level undo** (reverting notebook-wide mutations — add cell, remove cell, reorder — with `⌘⇧Z`), and (3) **CM6 keystroke undo** (fine-grained char-by-char undo inside a focused editor, handled by CodeMirror's built-in `history` extension — no new code required for this grain). The **activity feed** is a right-rail panel (hideable with `⌥H`) that shows a live, timestamped stream of cell runs, file loads, undo actions, agent proposals, and diagnostic events. Each entry carries a **kind badge** (run=`--color-accent-green`, error=`--color-accent-red`, undo=`--color-accent-amber`, load=`--color-accent` (cyan), agent=`--color-accent-purple`, diag=`--color-fg-muted`) and is capped at 200 entries (LRU eviction, oldest dropped). The `activityBus` follows the `EventTarget` pattern introduced in M-B5.

**Architecture:** A pure `useUndoHistory` hook owns the coarse + structural undo stacks (two separate arrays of `UndoFrame`). A module-level `activityBus` (like `revealCellBus`) dispatches `ActivityEntry` events to any subscriber. `ActivityFeed` is a React component that subscribes via `useSyncExternalStore` over an `activityStore` singleton (an `EventTarget`-based ring buffer). `ActivityFeedPanel` wraps the feed with a header, collapse toggle, and `⌥H` keyboard shortcut via a `useActivityHotkey` hook. The CM6 keystroke undo is intentionally **not reimplemented** — CodeMirror's `history()` extension already handles it; the plan documents the boundary clearly.

**Tech Stack:** React 19.2, TypeScript 5.8, Vite 6.2, Tailwind v4 (CSS-first, `[data-theme="dark"]`), Vitest 4.1.9 (pool: forks), @testing-library/react 16.3.0, @testing-library/user-event 14.6.1, @testing-library/jest-dom 6.6.3, Playwright 1.61.0, AxeBuilder from @axe-core/playwright.

---

## Pre-resolved decisions

### DECISION 1: Three-grain undo boundary

| Grain | Scope | Trigger | Implementation |
|-------|-------|---------|----------------|
| CM6 keystroke | Single editor, char-level | `⌘Z` when CM6 has focus | CodeMirror `history()` extension — **existing, no new code** |
| Coarse cell-level | Single cell full-source | `⌘Z` when no CM6 history remains or editor not focused | `useUndoHistory` coarse stack; each `UndoFrame` captures the previous cell source |
| Structural | Notebook-wide shape | `⌘⇧Z` always | `useUndoHistory` structural stack; each frame captures the previous `Notebook` snapshot |

The `⌘Z` handler checks `document.activeElement` to determine if a CM6 editor has focus: if yes, let CM6 handle it (do nothing). If no, pop the coarse stack. `⌘⇧Z` always pops the structural stack regardless of focus.

Rationale: CM6 already owns fine-grained editing undo; duplicating it in React state would fight the editor's own history. Coarse undo is the "oops I cleared the cell" recovery; structural undo is the "oops I deleted a cell" recovery.

### DECISION 2: UndoFrame shapes

```ts
// Coarse cell-level frame
export interface CoarseUndoFrame {
  grain: 'coarse';
  cellAlias: string;
  before: string; // cell source before the edit
  after: string;  // cell source after the edit (current, needed for redo)
  ts: number;
}

// Structural frame
export interface StructuralUndoFrame {
  grain: 'structural';
  before: Notebook;  // full notebook snapshot before the mutation
  after: Notebook;   // full snapshot after (current)
  reason: string;    // human-readable label e.g. "delete cell gc_overview"
  ts: number;
}

export type UndoFrame = CoarseUndoFrame | StructuralUndoFrame;
```

Stacks are capped at 50 frames each. When the cap is exceeded the oldest frame is dropped. Rationale: 50 coarse frames × (average cell source ~2 KB) ≈ 100 KB — well within memory budget; structural frames snapshot entire notebooks which can be larger so the same cap applies and 50 is still conservative.

### DECISION 3: useUndoHistory API

```ts
interface UndoHistoryApi {
  // Coarse grain
  pushCoarse(frame: Omit<CoarseUndoFrame, 'grain' | 'ts'>): void;
  undoCoarse(): CoarseUndoFrame | undefined;
  redoCoarse(): CoarseUndoFrame | undefined;
  coarseStack: CoarseUndoFrame[];

  // Structural grain
  pushStructural(frame: Omit<StructuralUndoFrame, 'grain' | 'ts'>): void;
  undoStructural(): StructuralUndoFrame | undefined;
  redoStructural(): StructuralUndoFrame | undefined;
  structuralStack: StructuralUndoFrame[];
}
```

`undoCoarse()` and `undoStructural()` each pop from the undo stack and push to a separate redo stack (also capped at 50). Pushing a new frame clears the redo stack (standard linear undo semantics). Rationale: symmetric redo is expected by users.

### DECISION 4: activityBus pattern

Mirrors `revealCellBus` from M-B5:

```ts
class ActivityBus extends EventTarget {
  dispatch(entry: ActivityEntry): void { … }
  subscribe(handler: (entry: ActivityEntry) => void): () => void { … }
}
export const activityBus = new ActivityBus();
```

`activityStore` is a separate singleton that subscribes to `activityBus`, maintains the ring buffer (array capped at 200, oldest evicted), and exposes a `useSyncExternalStore`-compatible API with `subscribe` + `getSnapshot`. Rationale: separating the bus (dispatch) from the store (state) follows the M-B5 pattern and allows components to subscribe without coupling to the bus directly.

### DECISION 5: ActivityEntry shape

```ts
export type ActivityKind =
  | 'run'    // cell execution completed (success)
  | 'error'  // cell execution failed
  | 'undo'   // coarse or structural undo performed
  | 'load'   // JFR file or notebook loaded
  | 'agent'  // agent proposal or action (Phase D stub)
  | 'diag';  // diagnostic event pushed to registry

export interface ActivityEntry {
  id: string;       // nanoid(8) — unique, used as React key
  kind: ActivityKind;
  message: string;
  cellAlias?: string;
  ts: number;       // Date.now()
}
```

`id` is a `nanoid(8)` call (already used elsewhere — if nanoid is not in deps, use `Math.random().toString(36).slice(2, 10)`). Rationale: a stable `id` is essential for the React key in the virtualized list.

### DECISION 6: Kind badge colours

Mapped to existing CSS custom properties, no new tokens added:

| kind | CSS token | Label |
|------|-----------|-------|
| `run` | `--color-accent-green` | `▶ run` |
| `error` | `--color-accent-red` | `✕ error` |
| `undo` | `--color-accent-amber` | `↩ undo` |
| `load` | `--color-accent` (cyan) | `⇩ load` |
| `agent` | `--color-accent-purple` | `🤖 agent` |
| `diag` | `--color-fg-muted` | `ℹ diag` |

Glyph chars are `aria-hidden="true"`; accessible label is the full `message` string on the row element. Rationale: §10a.1 forbids colour-only encoding; badge text + colour together satisfy the requirement.

### DECISION 7: Ring buffer eviction and cap

`activityStore` maintains `entries: ActivityEntry[]`. On each `dispatch`:
1. Append to the front (unshift) so the newest entry appears at the top of the feed.
2. If `entries.length > 200`, drop entries beyond index 199 (the oldest).
3. Notify all `useSyncExternalStore` subscribers.

Rationale: 200 entries at ~150 bytes each ≈ 30 KB — negligible. A flat array is efficient for this size; no linked list needed.

### DECISION 8: ⌥H toggle implementation

`ActivityFeedPanel` maintains a `collapsed: boolean` in local state (not persisted — intentionally ephemeral per session). The panel renders as a right-rail aside with `aria-label="activity feed"`. When collapsed, only the header bar + toggle button is visible (width 32px). `useActivityHotkey` registers a global `keydown` listener for `altKey && key === 'h'` (lowercase, case-insensitive). Toggle is announced via `aria-live="polite"` on a visually hidden span. Rationale: persisting collapse state to SettingsContext (M-B6) is a nice-to-have but out of scope for M-B7 to keep the milestone focused.

### DECISION 9: Keyboard shortcuts registration

Two new entries added to `keyboardMap` (from M-B6):
- `undoCoarse.trigger` → `⌘Z` (scope: `global`)
- `undoStructural.trigger` → `⌘⇧Z` (scope: `global`)
- `activityFeed.toggle` → `⌥H` (scope: `global`)

The coarse `⌘Z` handler calls `e.preventDefault()` only when the coarse stack is non-empty and focus is not inside a CM6 editor element (detected by `element.closest('.cm-editor')`). Structural `⌘⇧Z` always calls `e.preventDefault()`.

### DECISION 10: activityBus producers and wiring

Producers dispatch to `activityBus` at these call sites:

| Producer | Event kind | Where wired |
|----------|-----------|-------------|
| `cellExecutor` (M-B3) | `run` / `error` | `cellExecutor.ts` — appended post-execute |
| `jfrLoader` (M-A7) | `load` | `jfrLoader.ts` — appended post-load |
| `useUndoHistory.undoCoarse` | `undo` | Inside `useUndoHistory` hook |
| `useUndoHistory.undoStructural` | `undo` | Inside `useUndoHistory` hook |
| `diagnosticRegistry.set` | `diag` | `diagnosticRegistry.ts` — only when severity=`error` |
| Agent stub (Phase D) | `agent` | `agentStub.ts` — TODO marker, no-op for now |

Rationale: wiring in the producer (not the consumer) keeps `activityBus` decoupled. Diagnostic events are throttled to errors only to avoid flooding the feed with every re-parse.

---

## Steps

### Step 1 — Create undo types

- [ ] **1.1** Create `src/services/undo/types.ts`:

```ts
import type { Notebook } from '../parser/types';

export interface CoarseUndoFrame {
  grain: 'coarse';
  cellAlias: string;
  before: string;
  after: string;
  ts: number;
}

export interface StructuralUndoFrame {
  grain: 'structural';
  before: Notebook;
  after: Notebook;
  reason: string;
  ts: number;
}

export type UndoFrame = CoarseUndoFrame | StructuralUndoFrame;

export const UNDO_STACK_CAP = 50;
```

- [ ] **1.2** Run `npx tsc --noEmit` — must pass.

---

### Step 2 — Implement useUndoHistory hook

- [ ] **2.1** Create `src/services/undo/useUndoHistory.ts`:

```ts
import { useCallback, useRef, useState } from 'react';
import type { CoarseUndoFrame, StructuralUndoFrame, UndoFrame } from './types';
import { UNDO_STACK_CAP } from './types';

function capStack<T>(stack: T[]): T[] {
  return stack.length > UNDO_STACK_CAP ? stack.slice(0, UNDO_STACK_CAP) : stack;
}

export interface UndoHistoryApi {
  pushCoarse(frame: Omit<CoarseUndoFrame, 'grain' | 'ts'>): void;
  undoCoarse(): CoarseUndoFrame | undefined;
  redoCoarse(): CoarseUndoFrame | undefined;
  coarseStack: CoarseUndoFrame[];
  coarseRedoStack: CoarseUndoFrame[];

  pushStructural(frame: Omit<StructuralUndoFrame, 'grain' | 'ts'>): void;
  undoStructural(): StructuralUndoFrame | undefined;
  redoStructural(): StructuralUndoFrame | undefined;
  structuralStack: StructuralUndoFrame[];
  structuralRedoStack: StructuralUndoFrame[];
}

export function useUndoHistory(): UndoHistoryApi {
  // Use refs for the actual stacks so push/pop don't trigger re-renders;
  // use state only for the snapshot arrays exposed to consumers.
  const coarseRef = useRef<CoarseUndoFrame[]>([]);
  const coarseRedoRef = useRef<CoarseUndoFrame[]>([]);
  const structuralRef = useRef<StructuralUndoFrame[]>([]);
  const structuralRedoRef = useRef<StructuralUndoFrame[]>([]);

  const [coarseStack, setCoarseStack] = useState<CoarseUndoFrame[]>([]);
  const [coarseRedoStack, setCoarseRedoStack] = useState<CoarseUndoFrame[]>([]);
  const [structuralStack, setStructuralStack] = useState<StructuralUndoFrame[]>([]);
  const [structuralRedoStack, setStructuralRedoStack] = useState<StructuralUndoFrame[]>([]);

  const pushCoarse = useCallback(
    (frame: Omit<CoarseUndoFrame, 'grain' | 'ts'>): void => {
      const full: CoarseUndoFrame = { grain: 'coarse', ts: Date.now(), ...frame };
      coarseRef.current = capStack([full, ...coarseRef.current]);
      coarseRedoRef.current = [];
      setCoarseStack([...coarseRef.current]);
      setCoarseRedoStack([]);
    },
    [],
  );

  const undoCoarse = useCallback((): CoarseUndoFrame | undefined => {
    const [top, ...rest] = coarseRef.current;
    if (!top) return undefined;
    coarseRef.current = rest;
    coarseRedoRef.current = capStack([top, ...coarseRedoRef.current]);
    setCoarseStack([...rest]);
    setCoarseRedoStack([...coarseRedoRef.current]);
    return top;
  }, []);

  const redoCoarse = useCallback((): CoarseUndoFrame | undefined => {
    const [top, ...rest] = coarseRedoRef.current;
    if (!top) return undefined;
    coarseRedoRef.current = rest;
    coarseRef.current = capStack([top, ...coarseRef.current]);
    setCoarseRedoStack([...rest]);
    setCoarseStack([...coarseRef.current]);
    return top;
  }, []);

  const pushStructural = useCallback(
    (frame: Omit<StructuralUndoFrame, 'grain' | 'ts'>): void => {
      const full: StructuralUndoFrame = { grain: 'structural', ts: Date.now(), ...frame };
      structuralRef.current = capStack([full, ...structuralRef.current]);
      structuralRedoRef.current = [];
      setStructuralStack([...structuralRef.current]);
      setStructuralRedoStack([]);
    },
    [],
  );

  const undoStructural = useCallback((): StructuralUndoFrame | undefined => {
    const [top, ...rest] = structuralRef.current;
    if (!top) return undefined;
    structuralRef.current = rest;
    structuralRedoRef.current = capStack([top, ...structuralRedoRef.current]);
    setStructuralStack([...rest]);
    setStructuralRedoStack([...structuralRedoRef.current]);
    return top;
  }, []);

  const redoStructural = useCallback((): StructuralUndoFrame | undefined => {
    const [top, ...rest] = structuralRedoRef.current;
    if (!top) return undefined;
    structuralRedoRef.current = rest;
    structuralRef.current = capStack([top, ...structuralRef.current]);
    setStructuralRedoStack([...rest]);
    setStructuralStack([...structuralRef.current]);
    return top;
  }, []);

  return {
    pushCoarse,
    undoCoarse,
    redoCoarse,
    coarseStack,
    coarseRedoStack,
    pushStructural,
    undoStructural,
    redoStructural,
    structuralStack,
    structuralRedoStack,
  };
}
```

- [ ] **2.2** Run `npx tsc --noEmit`.

---

### Step 3 — Unit-test useUndoHistory (Red phase)

- [ ] **3.1** Create `src/__tests__/undo/useUndoHistory.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUndoHistory } from '../../services/undo/useUndoHistory';
import type { Notebook } from '../../services/parser/types';

const EMPTY_NB: Notebook = { frontmatter: {}, cells: [] };

function nb(title: string): Notebook {
  return { frontmatter: { title }, cells: [] };
}

describe('useUndoHistory — coarse grain', () => {
  it('starts with empty stacks', () => {
    const { result } = renderHook(() => useUndoHistory());
    expect(result.current.coarseStack).toHaveLength(0);
    expect(result.current.coarseRedoStack).toHaveLength(0);
  });

  it('pushCoarse adds to coarse stack', () => {
    const { result } = renderHook(() => useUndoHistory());
    act(() => {
      result.current.pushCoarse({ cellAlias: 'gc', before: 'SELECT 1', after: 'SELECT 2' });
    });
    expect(result.current.coarseStack).toHaveLength(1);
    expect(result.current.coarseStack[0].cellAlias).toBe('gc');
  });

  it('undoCoarse pops from stack and returns frame', () => {
    const { result } = renderHook(() => useUndoHistory());
    act(() => {
      result.current.pushCoarse({ cellAlias: 'gc', before: 'SELECT 1', after: 'SELECT 2' });
    });
    let frame: ReturnType<typeof result.current.undoCoarse>;
    act(() => {
      frame = result.current.undoCoarse();
    });
    expect(frame).toBeDefined();
    expect(frame?.before).toBe('SELECT 1');
    expect(result.current.coarseStack).toHaveLength(0);
    expect(result.current.coarseRedoStack).toHaveLength(1);
  });

  it('undoCoarse returns undefined on empty stack', () => {
    const { result } = renderHook(() => useUndoHistory());
    let frame: ReturnType<typeof result.current.undoCoarse>;
    act(() => {
      frame = result.current.undoCoarse();
    });
    expect(frame).toBeUndefined();
  });

  it('redoCoarse moves redo → undo stack', () => {
    const { result } = renderHook(() => useUndoHistory());
    act(() => {
      result.current.pushCoarse({ cellAlias: 'gc', before: 'SELECT 1', after: 'SELECT 2' });
    });
    act(() => { result.current.undoCoarse(); });
    act(() => { result.current.redoCoarse(); });
    expect(result.current.coarseStack).toHaveLength(1);
    expect(result.current.coarseRedoStack).toHaveLength(0);
  });

  it('pushCoarse clears redo stack', () => {
    const { result } = renderHook(() => useUndoHistory());
    act(() => {
      result.current.pushCoarse({ cellAlias: 'gc', before: 'A', after: 'B' });
    });
    act(() => { result.current.undoCoarse(); });
    expect(result.current.coarseRedoStack).toHaveLength(1);
    act(() => {
      result.current.pushCoarse({ cellAlias: 'gc', before: 'B', after: 'C' });
    });
    expect(result.current.coarseRedoStack).toHaveLength(0);
  });

  it('caps coarse stack at UNDO_STACK_CAP (50)', () => {
    const { result } = renderHook(() => useUndoHistory());
    act(() => {
      for (let i = 0; i < 60; i += 1) {
        result.current.pushCoarse({ cellAlias: 'gc', before: String(i), after: String(i + 1) });
      }
    });
    expect(result.current.coarseStack).toHaveLength(50);
  });

  it('frame has grain=coarse and ts > 0', () => {
    const before = Date.now();
    const { result } = renderHook(() => useUndoHistory());
    act(() => {
      result.current.pushCoarse({ cellAlias: 'gc', before: 'A', after: 'B' });
    });
    const frame = result.current.coarseStack[0];
    expect(frame.grain).toBe('coarse');
    expect(frame.ts).toBeGreaterThanOrEqual(before);
  });
});

describe('useUndoHistory — structural grain', () => {
  it('starts with empty structural stacks', () => {
    const { result } = renderHook(() => useUndoHistory());
    expect(result.current.structuralStack).toHaveLength(0);
  });

  it('pushStructural adds to structural stack', () => {
    const { result } = renderHook(() => useUndoHistory());
    act(() => {
      result.current.pushStructural({ before: EMPTY_NB, after: nb('v2'), reason: 'add cell' });
    });
    expect(result.current.structuralStack).toHaveLength(1);
    expect(result.current.structuralStack[0].reason).toBe('add cell');
  });

  it('undoStructural returns frame and moves to redo stack', () => {
    const { result } = renderHook(() => useUndoHistory());
    act(() => {
      result.current.pushStructural({ before: EMPTY_NB, after: nb('v2'), reason: 'add cell' });
    });
    let frame: ReturnType<typeof result.current.undoStructural>;
    act(() => { frame = result.current.undoStructural(); });
    expect(frame?.grain).toBe('structural');
    expect(result.current.structuralStack).toHaveLength(0);
    expect(result.current.structuralRedoStack).toHaveLength(1);
  });

  it('caps structural stack at 50', () => {
    const { result } = renderHook(() => useUndoHistory());
    act(() => {
      for (let i = 0; i < 55; i += 1) {
        result.current.pushStructural({
          before: nb(`before-${i}`),
          after: nb(`after-${i}`),
          reason: `mutation-${i}`,
        });
      }
    });
    expect(result.current.structuralStack).toHaveLength(50);
  });

  it('frame has grain=structural', () => {
    const { result } = renderHook(() => useUndoHistory());
    act(() => {
      result.current.pushStructural({ before: EMPTY_NB, after: nb('v2'), reason: 'test' });
    });
    expect(result.current.structuralStack[0].grain).toBe('structural');
  });
});
```

- [ ] **3.2** Run `npx vitest run src/__tests__/undo/useUndoHistory.test.ts` — must be **red** (hook not yet wired, but types should resolve).

- [ ] **3.3** Confirm the tests pass (they will pass as written since the implementation is in Step 2).

---

### Step 4 — Create activityBus and activityStore

- [ ] **4.1** Create `src/services/activity/types.ts`:

```ts
export type ActivityKind =
  | 'run'
  | 'error'
  | 'undo'
  | 'load'
  | 'agent'
  | 'diag';

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  message: string;
  cellAlias?: string;
  ts: number;
}

export const ACTIVITY_CAP = 200;
```

- [ ] **4.2** Create `src/services/activity/activityBus.ts`:

```ts
import type { ActivityEntry } from './types';

class ActivityBus extends EventTarget {
  dispatch(entry: ActivityEntry): void {
    this.dispatchEvent(new CustomEvent<ActivityEntry>('activity', { detail: entry }));
  }

  subscribe(handler: (entry: ActivityEntry) => void): () => void {
    const wrapped = (e: Event): void =>
      handler((e as CustomEvent<ActivityEntry>).detail);
    this.addEventListener('activity', wrapped);
    return () => this.removeEventListener('activity', wrapped);
  }
}

export const activityBus = new ActivityBus();
```

- [ ] **4.3** Create `src/services/activity/activityStore.ts`:

```ts
import { activityBus } from './activityBus';
import type { ActivityEntry } from './types';
import { ACTIVITY_CAP } from './types';

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function makeEntry(
  kind: ActivityEntry['kind'],
  message: string,
  cellAlias?: string,
): ActivityEntry {
  return { id: makeId(), kind, message, cellAlias, ts: Date.now() };
}

class ActivityStore extends EventTarget {
  private _entries: ActivityEntry[] = [];

  constructor() {
    super();
    activityBus.subscribe((entry) => {
      this._entries = [entry, ...this._entries].slice(0, ACTIVITY_CAP);
      this.dispatchEvent(new Event('change'));
    });
  }

  getSnapshot(): ActivityEntry[] {
    return this._entries;
  }

  subscribe(handler: () => void): () => void {
    this.addEventListener('change', handler);
    return () => this.removeEventListener('change', handler);
  }

  /** For tests: reset state without recreating the singleton. */
  _reset(): void {
    this._entries = [];
  }
}

export const activityStore = new ActivityStore();
```

- [ ] **4.4** Run `npx tsc --noEmit`.

---

### Step 5 — Unit-test activityBus + activityStore (Red phase)

- [ ] **5.1** Create `src/__tests__/activity/activityStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { activityBus } from '../../services/activity/activityBus';
import { activityStore, makeEntry } from '../../services/activity/activityStore';
import { ACTIVITY_CAP } from '../../services/activity/types';

beforeEach(() => {
  activityStore._reset();
});

describe('activityBus', () => {
  it('dispatches entries to subscribers', () => {
    const spy = vi.fn();
    const unsub = activityBus.subscribe(spy);
    const entry = makeEntry('run', 'Cell ran OK', 'gc_overview');
    activityBus.dispatch(entry);
    expect(spy).toHaveBeenCalledWith(entry);
    unsub();
  });

  it('unsubscribe stops delivery', () => {
    const spy = vi.fn();
    const unsub = activityBus.subscribe(spy);
    unsub();
    activityBus.dispatch(makeEntry('run', 'ping'));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('activityStore', () => {
  it('starts empty', () => {
    expect(activityStore.getSnapshot()).toHaveLength(0);
  });

  it('adds entry to the front on dispatch', () => {
    activityBus.dispatch(makeEntry('load', 'loaded foo.jfr'));
    const snap = activityStore.getSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].kind).toBe('load');
  });

  it('maintains insertion order (newest first)', () => {
    activityBus.dispatch(makeEntry('run', 'first'));
    activityBus.dispatch(makeEntry('error', 'second'));
    const snap = activityStore.getSnapshot();
    expect(snap[0].kind).toBe('error');
    expect(snap[1].kind).toBe('run');
  });

  it(`evicts oldest when cap (${ACTIVITY_CAP}) is exceeded`, () => {
    for (let i = 0; i < ACTIVITY_CAP + 5; i += 1) {
      activityBus.dispatch(makeEntry('diag', `msg-${i}`));
    }
    expect(activityStore.getSnapshot()).toHaveLength(ACTIVITY_CAP);
  });

  it('subscribe fires on each new entry', () => {
    const spy = vi.fn();
    const unsub = activityStore.subscribe(spy);
    activityBus.dispatch(makeEntry('undo', 'undid coarse'));
    expect(spy).toHaveBeenCalledTimes(1);
    activityBus.dispatch(makeEntry('undo', 'undid structural'));
    expect(spy).toHaveBeenCalledTimes(2);
    unsub();
  });

  it('makeEntry produces valid shape', () => {
    const e = makeEntry('agent', 'agent proposed refactor', 'gc_overview');
    expect(e.kind).toBe('agent');
    expect(e.message).toBe('agent proposed refactor');
    expect(e.cellAlias).toBe('gc_overview');
    expect(typeof e.id).toBe('string');
    expect(e.id.length).toBeGreaterThan(0);
    expect(e.ts).toBeGreaterThan(0);
  });
});
```

- [ ] **5.2** Run `npx vitest run src/__tests__/activity/activityStore.test.ts` — must pass.

---

### Step 6 — Wire activityBus into producers

- [ ] **6.1** Edit `src/services/executor/cellExecutor.ts` — append dispatch after execution result:

After each successful result dispatch:
```ts
import { activityBus } from '../activity/activityBus';
import { makeEntry } from '../activity/activityStore';

// After a successful execution result is produced (kind: 'ok'):
activityBus.dispatch(makeEntry('run', `Cell "${cellAlias}" ran in ${result.durationMs}ms`, cellAlias));

// After an error result (kind: 'error'):
activityBus.dispatch(makeEntry('error', `Cell "${cellAlias}" failed: ${result.error}`, cellAlias));
```

- [ ] **6.2** Edit `src/services/jfr/jfrLoader.ts` — append dispatch after successful load:

```ts
import { activityBus } from '../activity/activityBus';
import { makeEntry } from '../activity/activityStore';

// After JFR file is loaded successfully:
activityBus.dispatch(makeEntry('load', `Loaded ${fileName} (${eventCount} events)`));
```

- [ ] **6.3** Edit `src/services/diagnostics/diagnosticRegistry.ts` — dispatch for error-severity entries only:

```ts
import { activityBus } from '../activity/activityBus';
import { makeEntry } from '../activity/activityStore';

// Inside set(), after the entries are stored, for each error-severity entry:
const errors = tagged.filter((e) => e.severity === 'error');
for (const err of errors) {
  activityBus.dispatch(
    makeEntry('diag', `${err.kind}: ${err.message}`, err.cellAlias ?? undefined),
  );
}
```

- [ ] **6.4** Run `npx tsc --noEmit`.

---

### Step 7 — Wire activityBus into useUndoHistory

- [ ] **7.1** Edit `src/services/undo/useUndoHistory.ts` to dispatch undo events:

```ts
import { activityBus } from '../activity/activityBus';
import { makeEntry } from '../activity/activityStore';
```

Inside `undoCoarse`:
```ts
// after popping top:
if (top) {
  activityBus.dispatch(makeEntry('undo', `Undo coarse edit in "${top.cellAlias}"`, top.cellAlias));
}
```

Inside `undoStructural`:
```ts
// after popping top:
if (top) {
  activityBus.dispatch(makeEntry('undo', `Undo structural: ${top.reason}`));
}
```

- [ ] **7.2** Run `npx tsc --noEmit`.

---

### Step 8 — Create ActivityFeed React component

- [ ] **8.1** Create `src/components/activity/ActivityFeed.tsx`:

```tsx
import { useSyncExternalStore } from 'react';
import type { JSX } from 'react';
import { activityStore } from '../../services/activity/activityStore';
import type { ActivityEntry, ActivityKind } from '../../services/activity/types';

const KIND_LABEL: Record<ActivityKind, string> = {
  run: '▶ run',
  error: '✕ error',
  undo: '↩ undo',
  load: '⇩ load',
  agent: '🤖 agent',
  diag: 'ℹ diag',
};

const KIND_COLOR: Record<ActivityKind, string> = {
  run: 'var(--color-accent-green)',
  error: 'var(--color-accent-red)',
  undo: 'var(--color-accent-amber)',
  load: 'var(--color-accent)',
  agent: 'var(--color-accent-purple)',
  diag: 'var(--color-fg-muted)',
};

function formatTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

interface ActivityRowProps {
  entry: ActivityEntry;
}

function ActivityRow({ entry }: ActivityRowProps): JSX.Element {
  const labelText = KIND_LABEL[entry.kind];
  return (
    <li
      data-testid="activity-row"
      data-kind={entry.kind}
      aria-label={`${entry.kind}: ${entry.message}`}
      className="flex items-start gap-2 px-3 py-1.5 border-b border-[var(--color-border)] last:border-0"
    >
      <span
        aria-hidden="true"
        className="shrink-0 text-[11px] font-mono rounded px-1 py-0.5 leading-tight"
        style={{ color: KIND_COLOR[entry.kind], border: `1px solid ${KIND_COLOR[entry.kind]}33` }}
      >
        {labelText}
      </span>
      <span className="flex-1 text-[var(--color-fg-base)] text-[12px] break-words min-w-0">
        {entry.message}
      </span>
      <time
        dateTime={new Date(entry.ts).toISOString()}
        className="shrink-0 text-[var(--color-fg-dim)] text-[11px] tabular-nums"
      >
        {formatTs(entry.ts)}
      </time>
    </li>
  );
}

export function ActivityFeed(): JSX.Element {
  const entries = useSyncExternalStore(
    (cb) => activityStore.subscribe(cb),
    () => activityStore.getSnapshot(),
  );

  if (entries.length === 0) {
    return (
      <div
        data-testid="activity-feed-empty"
        className="flex items-center justify-center h-16 text-[var(--color-fg-dim)] text-[12px] italic"
        aria-live="polite"
      >
        No activity yet
      </div>
    );
  }

  return (
    <ol
      data-testid="activity-feed"
      aria-label="activity feed entries"
      aria-live="polite"
      aria-atomic="false"
      aria-relevant="additions"
      className="list-none m-0 p-0"
    >
      {entries.map((entry) => (
        <ActivityRow key={entry.id} entry={entry} />
      ))}
    </ol>
  );
}
```

- [ ] **8.2** Run `npx tsc --noEmit`.

---

### Step 9 — Create useActivityHotkey hook

- [ ] **9.1** Create `src/components/activity/useActivityHotkey.ts`:

```ts
import { useEffect } from 'react';

export function useActivityHotkey(onToggle: () => void): void {
  useEffect(() => {
    function handler(e: KeyboardEvent): void {
      if (e.altKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        onToggle();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onToggle]);
}
```

- [ ] **9.2** Run `npx tsc --noEmit`.

---

### Step 10 — Create ActivityFeedPanel component

- [ ] **10.1** Create `src/components/activity/ActivityFeedPanel.tsx`:

```tsx
import { useState, useCallback, useRef } from 'react';
import type { JSX } from 'react';
import { ActivityFeed } from './ActivityFeed';
import { useActivityHotkey } from './useActivityHotkey';

export function ActivityFeedPanel(): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const announceRef = useRef<HTMLSpanElement>(null);

  const toggle = useCallback((): void => {
    setCollapsed((prev) => {
      const next = !prev;
      if (announceRef.current) {
        announceRef.current.textContent = next ? 'Activity feed collapsed' : 'Activity feed expanded';
      }
      return next;
    });
  }, []);

  useActivityHotkey(toggle);

  return (
    <aside
      data-testid="activity-feed-panel"
      aria-label="activity feed"
      className={[
        'flex flex-col border-l border-[var(--color-border)] bg-[var(--color-bg-surface)] transition-all duration-150',
        collapsed ? 'w-8' : 'w-64',
      ].join(' ')}
    >
      {/* Visually hidden live region for collapse/expand announcements */}
      <span
        ref={announceRef}
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      />

      <div className="flex items-center justify-between px-2 py-1 border-b border-[var(--color-border)]">
        {!collapsed && (
          <span className="text-[var(--color-fg-muted)] text-[11px] font-medium uppercase tracking-wide select-none">
            Activity
          </span>
        )}
        <button
          data-testid="activity-feed-toggle"
          onClick={toggle}
          aria-label={collapsed ? 'Expand activity feed (⌥H)' : 'Collapse activity feed (⌥H)'}
          aria-expanded={!collapsed}
          aria-controls="activity-feed-body"
          className="ml-auto p-1 rounded text-[var(--color-fg-muted)] hover:text-[var(--color-fg-base)] hover:bg-[var(--color-bg-overlay)]"
        >
          <span aria-hidden="true">{collapsed ? '◀' : '▶'}</span>
        </button>
      </div>

      <div
        id="activity-feed-body"
        hidden={collapsed}
        className="flex-1 overflow-y-auto"
      >
        <ActivityFeed />
      </div>
    </aside>
  );
}
```

- [ ] **10.2** Run `npx tsc --noEmit`.

---

### Step 11 — Create useUndoHotkeys hook

- [ ] **11.1** Create `src/services/undo/useUndoHotkeys.ts`:

```ts
import { useEffect } from 'react';
import type { UndoHistoryApi } from './useUndoHistory';

function isCm6Focused(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  return active.closest('.cm-editor') !== null;
}

export function useUndoHotkeys(history: UndoHistoryApi): void {
  useEffect(() => {
    function handler(e: KeyboardEvent): void {
      const isZ = e.key === 'z' || e.key === 'Z';
      if (!(e.metaKey || e.ctrlKey) || !isZ) return;

      if (e.shiftKey) {
        // ⌘⇧Z — structural undo always
        e.preventDefault();
        history.undoStructural();
        return;
      }

      // ⌘Z — coarse undo only when CM6 does not own focus
      if (!isCm6Focused()) {
        e.preventDefault();
        history.undoCoarse();
      }
      // else: let CM6 handle it
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [history]);
}
```

- [ ] **11.2** Run `npx tsc --noEmit`.

---

### Step 12 — Unit-test useUndoHotkeys (Red phase)

- [ ] **12.1** Create `src/__tests__/undo/useUndoHotkeys.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUndoHotkeys } from '../../services/undo/useUndoHotkeys';
import type { UndoHistoryApi } from '../../services/undo/useUndoHistory';

function makeApi(overrides: Partial<UndoHistoryApi> = {}): UndoHistoryApi {
  return {
    pushCoarse: vi.fn(),
    undoCoarse: vi.fn(),
    redoCoarse: vi.fn(),
    coarseStack: [],
    coarseRedoStack: [],
    pushStructural: vi.fn(),
    undoStructural: vi.fn(),
    redoStructural: vi.fn(),
    structuralStack: [],
    structuralRedoStack: [],
    ...overrides,
  };
}

function fire(key: string, opts: Partial<KeyboardEventInit> = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true, ...opts, bubbles: true }));
}

beforeEach(() => {
  // Ensure no CM6 editor is focused during tests
  (document.activeElement as HTMLElement | null)?.blur?.();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useUndoHotkeys', () => {
  it('⌘Z fires undoCoarse when no CM6 editor has focus', () => {
    const api = makeApi();
    renderHook(() => useUndoHotkeys(api));
    act(() => fire('z'));
    expect(api.undoCoarse).toHaveBeenCalledTimes(1);
    expect(api.undoStructural).not.toHaveBeenCalled();
  });

  it('⌘⇧Z fires undoStructural regardless of focus', () => {
    const api = makeApi();
    renderHook(() => useUndoHotkeys(api));
    act(() => fire('Z', { shiftKey: true }));
    expect(api.undoStructural).toHaveBeenCalledTimes(1);
    expect(api.undoCoarse).not.toHaveBeenCalled();
  });

  it('⌘Z does not fire when a .cm-editor is focused', () => {
    const api = makeApi();
    const cmEl = document.createElement('div');
    cmEl.className = 'cm-editor';
    const inner = document.createElement('div');
    cmEl.appendChild(inner);
    document.body.appendChild(cmEl);
    inner.setAttribute('tabindex', '0');
    inner.focus();

    renderHook(() => useUndoHotkeys(api));
    act(() => fire('z'));
    expect(api.undoCoarse).not.toHaveBeenCalled();
    document.body.removeChild(cmEl);
  });

  it('non-undo keys are ignored', () => {
    const api = makeApi();
    renderHook(() => useUndoHotkeys(api));
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true })));
    expect(api.undoCoarse).not.toHaveBeenCalled();
    expect(api.undoStructural).not.toHaveBeenCalled();
  });
});
```

- [ ] **12.2** Run `npx vitest run src/__tests__/undo/useUndoHotkeys.test.ts` — must pass.

---

### Step 13 — Unit-test ActivityFeed component (Red phase)

- [ ] **13.1** Create `src/__tests__/activity/ActivityFeed.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { ActivityFeed } from '../../components/activity/ActivityFeed';
import { activityBus } from '../../services/activity/activityBus';
import { activityStore, makeEntry } from '../../services/activity/activityStore';

beforeEach(() => activityStore._reset());
afterEach(cleanup);

describe('ActivityFeed', () => {
  it('renders empty state when no entries', () => {
    render(<ActivityFeed />);
    expect(screen.getByTestId('activity-feed-empty')).toBeInTheDocument();
  });

  it('renders a row for each entry', async () => {
    await act(async () => {
      activityBus.dispatch(makeEntry('run', 'Cell ran OK', 'gc'));
      activityBus.dispatch(makeEntry('error', 'Cell failed', 'gc'));
    });
    render(<ActivityFeed />);
    expect(screen.getAllByTestId('activity-row')).toHaveLength(2);
  });

  it('shows newest entry first', async () => {
    await act(async () => {
      activityBus.dispatch(makeEntry('run', 'first run'));
      activityBus.dispatch(makeEntry('load', 'loaded file'));
    });
    render(<ActivityFeed />);
    const rows = screen.getAllByTestId('activity-row');
    expect(rows[0].getAttribute('data-kind')).toBe('load');
    expect(rows[1].getAttribute('data-kind')).toBe('run');
  });

  it('each row has a descriptive aria-label', async () => {
    await act(async () => {
      activityBus.dispatch(makeEntry('undo', 'Undo coarse edit in "gc"', 'gc'));
    });
    render(<ActivityFeed />);
    const row = screen.getByTestId('activity-row');
    expect(row.getAttribute('aria-label')).toMatch(/^undo: /);
  });

  it('has aria-live=polite on the list', async () => {
    await act(async () => {
      activityBus.dispatch(makeEntry('run', 'ping'));
    });
    render(<ActivityFeed />);
    const list = screen.getByTestId('activity-feed');
    expect(list.getAttribute('aria-live')).toBe('polite');
  });

  it('updates when a new entry arrives after mount', async () => {
    render(<ActivityFeed />);
    expect(screen.queryByTestId('activity-row')).toBeNull();
    await act(async () => {
      activityBus.dispatch(makeEntry('diag', 'new diagnostic'));
    });
    expect(screen.getAllByTestId('activity-row')).toHaveLength(1);
  });
});
```

- [ ] **13.2** Run `npx vitest run src/__tests__/activity/ActivityFeed.test.tsx` — must pass.

---

### Step 14 — Unit-test ActivityFeedPanel (Red phase)

- [ ] **14.1** Create `src/__tests__/activity/ActivityFeedPanel.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityFeedPanel } from '../../components/activity/ActivityFeedPanel';
import { activityStore } from '../../services/activity/activityStore';

afterEach(() => { cleanup(); activityStore._reset(); });

describe('ActivityFeedPanel', () => {
  it('renders with aria-label="activity feed"', () => {
    render(<ActivityFeedPanel />);
    expect(screen.getByRole('complementary', { name: /activity feed/i })).toBeInTheDocument();
  });

  it('toggle button is visible with aria-expanded=true', () => {
    render(<ActivityFeedPanel />);
    const btn = screen.getByTestId('activity-feed-toggle');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('toggle button collapses the panel', async () => {
    const user = userEvent.setup();
    render(<ActivityFeedPanel />);
    const btn = screen.getByTestId('activity-feed-toggle');
    await user.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('activity-feed-panel').className).toContain('w-8');
  });

  it('⌥H toggles the panel', async () => {
    const user = userEvent.setup();
    render(<ActivityFeedPanel />);
    await user.keyboard('{Alt>}h{/Alt}');
    const btn = screen.getByTestId('activity-feed-toggle');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('feed body is hidden when collapsed', async () => {
    const user = userEvent.setup();
    render(<ActivityFeedPanel />);
    await user.click(screen.getByTestId('activity-feed-toggle'));
    const body = document.getElementById('activity-feed-body');
    expect(body?.hidden).toBe(true);
  });

  it('re-expanding shows feed body', async () => {
    const user = userEvent.setup();
    render(<ActivityFeedPanel />);
    const btn = screen.getByTestId('activity-feed-toggle');
    await user.click(btn);
    await user.click(btn);
    const body = document.getElementById('activity-feed-body');
    expect(body?.hidden).toBe(false);
  });
});
```

- [ ] **14.2** Run `npx vitest run src/__tests__/activity/ActivityFeedPanel.test.tsx` — must pass.

---

### Step 15 — Mount ActivityFeedPanel in AppShell

- [ ] **15.1** Edit `src/components/shell/AppShell.tsx` to import and render `ActivityFeedPanel` in the right rail alongside `IssuesPanel`. The right rail is a flex column; `ActivityFeedPanel` sits below (or beside) `IssuesPanel`. Add the following import:

```tsx
import { ActivityFeedPanel } from '../activity/ActivityFeedPanel';
```

Add `<ActivityFeedPanel />` inside the right rail section adjacent to the issues panel. The exact JSX position depends on the existing shell layout; target is within the `<aside>` or equivalent right-edge container.

- [ ] **15.2** Mount `useUndoHotkeys` from `AppShell` or the `NotebookContext` provider (whichever holds the notebook state). Example wiring fragment:

```tsx
import { useUndoHistory } from '../../services/undo/useUndoHistory';
import { useUndoHotkeys } from '../../services/undo/useUndoHotkeys';

// Inside component:
const undoHistory = useUndoHistory();
useUndoHotkeys(undoHistory);
```

Pass `undoHistory` down via context or props as needed by `CellView` (so cell edits can call `undoHistory.pushCoarse`).

- [ ] **15.3** Run `npx tsc --noEmit`.

---

### Step 16 — E2E smoke test

- [ ] **16.1** Create `tests/e2e/activity/activityFeed.e2e.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('@e2e Activity Feed', () => {
  test('panel is visible on initial load', async ({ page }) => {
    await page.goto('/');
    const panel = page.getByTestId('activity-feed-panel');
    await expect(panel).toBeVisible();
  });

  test('⌥H hides and restores the activity feed', async ({ page }) => {
    await page.goto('/');
    const panel = page.getByTestId('activity-feed-panel');
    await expect(panel).toBeVisible();

    await page.keyboard.press('Alt+h');
    const btn = page.getByTestId('activity-feed-toggle');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('Alt+h');
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  test('toggle button click collapses and expands', async ({ page }) => {
    await page.goto('/');
    const btn = page.getByTestId('activity-feed-toggle');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  test('activity row appears after cell execution via fixture', async ({ page }) => {
    await page.goto('/?fixture=singleSqlCell');
    // Trigger execution via keyboard shortcut ⌘↵ if available or click run button
    const runBtn = page.getByRole('button', { name: /run/i }).first();
    if (await runBtn.isVisible()) {
      await runBtn.click();
      const row = page.getByTestId('activity-row').first();
      await expect(row).toBeVisible({ timeout: 5000 });
    }
  });
});
```

- [ ] **16.2** Run:
```bash
npx playwright test tests/e2e/activity/activityFeed.e2e.spec.ts
```

---

### Step 17 — Accessibility test

- [ ] **17.1** Create `tests/e2e/activity/activityFeed.a11y.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('@a11y Activity Feed', () => {
  test('panel has no axe violations on load', async ({ page }) => {
    await page.goto('/');
    const panel = page.getByTestId('activity-feed-panel');
    await expect(panel).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('[data-testid="activity-feed-panel"]')
      .analyze();
    expect(results.violations).toHaveLength(0);
  });

  test('panel has no axe violations when collapsed', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Alt+h');
    const results = await new AxeBuilder({ page })
      .include('[data-testid="activity-feed-panel"]')
      .analyze();
    expect(results.violations).toHaveLength(0);
  });

  test('activity rows have descriptive aria-labels', async ({ page }) => {
    await page.goto('/?fixture=activityEntries');
    const rows = page.getByTestId('activity-row');
    const count = await rows.count();
    if (count > 0) {
      const labels = await rows.evaluateAll((els) =>
        els.map((el) => el.getAttribute('aria-label')),
      );
      for (const label of labels) {
        expect(label).toMatch(/^(run|error|undo|load|agent|diag): /);
      }
    }
  });

  test('toggle button aria-expanded is correct', async ({ page }) => {
    await page.goto('/');
    const btn = page.getByTestId('activity-feed-toggle');
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
  });
});
```

- [ ] **17.2** Add `activityEntries` fixture: seeds the `activityStore` (via URL param handler) with one entry of each kind.

- [ ] **17.3** Run:
```bash
npx playwright test --grep "@a11y Activity Feed"
```

---

### Step 18 — Visual regression

- [ ] **18.1** Create `tests/e2e/activity/activityFeed.visual.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('@visual Activity Feed', () => {
  test('renders populated feed (dark)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'dark', 'dark only');
    await page.goto('/?fixture=activityEntries');
    const panel = page.getByTestId('activity-feed-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveScreenshot('activity-feed-populated-dark.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('renders collapsed state (dark)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'dark', 'dark only');
    await page.goto('/');
    await page.keyboard.press('Alt+h');
    const panel = page.getByTestId('activity-feed-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveScreenshot('activity-feed-collapsed-dark.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('renders empty state (dark)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'dark', 'dark only');
    await page.goto('/');
    const panel = page.getByTestId('activity-feed-panel');
    await expect(panel).toHaveScreenshot('activity-feed-empty-dark.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});
```

- [ ] **18.2** Run:
```bash
npx playwright test --grep "@visual Activity Feed"
```

---

### Step 19 — Performance benchmark

- [ ] **19.1** Create `src/__tests__/activity/activityStore.bench.ts`:

```ts
import { bench, describe, beforeEach } from 'vitest';
import { activityBus } from '../../services/activity/activityBus';
import { activityStore, makeEntry } from '../../services/activity/activityStore';

describe('activityStore ring buffer', () => {
  beforeEach(() => activityStore._reset());

  bench('dispatch 200 entries (fills to cap)', () => {
    for (let i = 0; i < 200; i += 1) {
      activityBus.dispatch(makeEntry('run', `msg-${i}`));
    }
  });

  bench('dispatch 1 entry when buffer is full (eviction path)', () => {
    // Pre-fill
    for (let i = 0; i < 200; i += 1) {
      activityBus.dispatch(makeEntry('run', `msg-${i}`));
    }
    // Bench the eviction
    activityBus.dispatch(makeEntry('run', 'overflow'));
  });

  bench('getSnapshot on full buffer', () => {
    activityStore.getSnapshot();
  });
});
```

- [ ] **19.2** Run:
```bash
npx vitest bench src/__tests__/activity/activityStore.bench.ts
```
Expected: dispatching 200 entries < 10ms median; single dispatch with eviction < 0.1ms median.

---

### Step 20 — Commit

- [ ] **20.1** Run `npx tsc --noEmit` — must be clean.

- [ ] **20.2** Run `npx vitest run src/__tests__/undo src/__tests__/activity` — all green.

- [ ] **20.3** Stage and commit:

```bash
git add frontend-v2/src/services/undo \
        frontend-v2/src/services/activity \
        frontend-v2/src/components/activity \
        frontend-v2/src/__tests__/undo \
        frontend-v2/src/__tests__/activity \
        frontend-v2/tests/e2e/activity \
        frontend-v2/src/services/executor/cellExecutor.ts \
        frontend-v2/src/services/jfr/jfrLoader.ts \
        frontend-v2/src/services/diagnostics/diagnosticRegistry.ts \
        frontend-v2/src/components/shell/AppShell.tsx
git commit -m "$(cat <<'EOF'
M-B7: three-grain undo + activity feed (⌥H)

Adds coarse cell-level undo (⌘Z, non-CM6 focus) and structural
notebook-level undo (⌘⇧Z) via useUndoHistory; CM6 keystroke undo
remains in the existing CodeMirror history extension. Adds activityBus
(EventTarget pattern) + activityStore (200-entry LRU ring buffer)
dispatched by cellExecutor, jfrLoader, diagnosticRegistry (errors only),
and useUndoHistory. ActivityFeedPanel renders in the right rail with ⌥H
toggle; each entry shows a kind badge (run=green, error=red, undo=amber,
load=cyan, agent=purple, diag=grey) and timestamp.
EOF
)"
```

---

## Done criteria

- [ ] `src/services/undo/` contains `types.ts`, `useUndoHistory.ts`, `useUndoHotkeys.ts`.
- [ ] `src/services/activity/` contains `types.ts`, `activityBus.ts`, `activityStore.ts`.
- [ ] `src/components/activity/` contains `ActivityFeed.tsx`, `ActivityFeedPanel.tsx`, `useActivityHotkey.ts`.
- [ ] `useUndoHistory` maintains separate coarse + structural stacks, each capped at 50; redo stacks are symmetric; pushing clears redo.
- [ ] `⌘Z` fires `undoCoarse` only when no `.cm-editor` element is focused; `⌘⇧Z` always fires `undoStructural`.
- [ ] `activityBus` follows the `EventTarget` / CustomEvent pattern from M-B5 (`revealCellBus`).
- [ ] `activityStore` caps at 200 entries, newest first, oldest evicted; `_reset()` available for tests.
- [ ] `ActivityFeed` renders `aria-live="polite"`, `aria-relevant="additions"`, uses `useSyncExternalStore`.
- [ ] `ActivityFeedPanel` renders `<aside aria-label="activity feed">`, toggle has `aria-expanded`, body uses `hidden` attribute.
- [ ] `⌥H` toggles the panel; announced via a visually-hidden `aria-live="polite"` span.
- [ ] Kind badges: run=`--color-accent-green`, error=`--color-accent-red`, undo=`--color-accent-amber`, load=`--color-accent`, agent=`--color-accent-purple`, diag=`--color-fg-muted`.
- [ ] Glyph chars on badges are `aria-hidden="true"`.
- [ ] `cellExecutor`, `jfrLoader`, and `diagnosticRegistry` (error severity only) dispatch to `activityBus`.
- [ ] `undoCoarse()` and `undoStructural()` dispatch `kind: 'undo'` entries.
- [ ] `npx vitest run src/__tests__/undo src/__tests__/activity` is green.
- [ ] `npx playwright test tests/e2e/activity/activityFeed.e2e.spec.ts` is green.
- [ ] `npx playwright test --grep "@a11y Activity Feed"` is green (0 axe violations).
- [ ] `npx playwright test --grep "@visual Activity Feed"` is green; baselines committed.
- [ ] `npx vitest bench src/__tests__/activity/activityStore.bench.ts` reports < 10ms for 200-entry fill.
- [ ] `npx tsc --noEmit` clean.
- [ ] No `any` types under `src/services/undo`, `src/services/activity`, or `src/components/activity`.
- [ ] No `.dark` class references.
- [ ] All React components use `import type { JSX } from 'react'`.
- [ ] `AxeBuilder` is imported statically from `@axe-core/playwright` in a11y specs.
- [ ] `docs/agent-state/pipeline.md` records M-B7 as a written plan.
