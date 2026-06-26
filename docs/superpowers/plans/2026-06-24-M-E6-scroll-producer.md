# M-E6 Scroll Producer + `link-scroll` Clause Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the fifth live-var kind — scroll. Plots with a `link-scroll: $group` clause write their viewport `{top, left}` to `liveVarStore` under `<alias>.scroll`, and members of the same group sync scroll position in both axes with a 16ms rAF/timeout debounce and no feedback loop. This unblocks the headline use case from showcase §5.1: long flamegraph + correlated table scroll together.

**Architecture:** New `linkScrollGroups` store (mirrors `linkGroups.ts` pattern) tracks members per group and routes incoming scroll updates to non-source peers. New `useScrollProducer` React hook attaches a passive scroll listener with rAF + 16ms timeout debounce, calls `liveVarStore.setScroll(alias, {top,left})`, and on receiving an incoming group update (`linkScrollGroups.subscribe`) applies it to its viewport with an `isProgrammaticScroll` flag so the listener short-circuits — preventing feedback loops. New `link-scroll` clause is added to `PanelClauses` and the plot DSL parser. Wired into `FlamegraphPlot` (existing scroll viewport) and `LineChartPlot` (wrap chart in a scrollable div). The legacy `scrollSync` single-axis path stays untouched — `link-scroll` is the new dual-axis $alias.scroll producer.

**Tech Stack:** TypeScript, React 19.2, Vitest 4.1.9 (`pool: 'forks'`), @testing-library/react 16.3.0, @testing-library/user-event 14.6.1, Playwright 1.61.0, Tailwind v4 CSS tokens.

---

## Critical Rules

- `import type { JSX } from 'react'` in every new component file
- `pool: 'forks'` in `vitest.config.ts` — NEVER change
- All colors via CSS token vars only (`var(--color-*)`) — never hardcode hex
- No `text-sm` — use `text-[13px]`, `text-[12px]`, `text-[11px]`
- No `any` — use `unknown` with narrowing
- Test command: `npm run test -- <pattern>` (note `npm run test` not `npm test`)
- **Fixture rule — IMPORTANT:** Unit and integration tests MUST NOT load raw `.jfr` files (those require the slow GraalVM WASM importer path). All Vitest tests in this milestone use stub/mock data only (no DuckDB fixture needed). If a future integration test does need real DuckDB data, use `tests/fixtures/jfr/sample-small.db` (load with `duckdb_wasm.open()` or mock the `DuckDBClientLike` interface with data from it). For browser/Playwright E2E tests that need JFR data, use `tests/fixtures/jfr/sample-small.jfr`.

---

### Task 1: Add `setScroll/getScroll` to `liveVarStore`

**Files:**
- Modify: `frontend-v2/src/services/liveVar/liveVarStore.ts`
- Create: `frontend-v2/src/__tests__/liveVar/scrollStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend-v2/src/__tests__/liveVar/scrollStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { liveVarStore } from '../../services/liveVar/liveVarStore';

beforeEach(() => liveVarStore._reset());

describe('liveVarStore — scroll', () => {
  it('setScroll stores under "<alias>.scroll"', () => {
    liveVarStore.setScroll('flame', { top: 10, left: 20 });
    expect(liveVarStore.get('flame.scroll')).toEqual({ top: 10, left: 20 });
  });

  it('getScroll round-trips', () => {
    liveVarStore.setScroll('flame', { top: 5, left: 7 });
    expect(liveVarStore.getScroll('flame')).toEqual({ top: 5, left: 7 });
  });

  it('setScroll(null) clears the key', () => {
    liveVarStore.setScroll('flame', { top: 1, left: 2 });
    liveVarStore.setScroll('flame', null);
    expect(liveVarStore.getScroll('flame')).toBeNull();
    expect(liveVarStore.get('flame.scroll')).toBeUndefined();
  });

  it('fires the change event on setScroll', () => {
    let count = 0;
    const off = liveVarStore.subscribe(() => { count += 1; });
    liveVarStore.setScroll('flame', { top: 1, left: 2 });
    expect(count).toBe(1);
    off();
  });

  it('getScroll returns null for malformed values', () => {
    liveVarStore.set('bad.scroll', { top: 'oops' });
    expect(liveVarStore.getScroll('bad')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- scrollStore`
Expected: FAIL — `liveVarStore.setScroll is not a function`.

- [ ] **Step 3: Implement**

Edit `frontend-v2/src/services/liveVar/liveVarStore.ts`. Add the `LiveScrollValue` type near the top alongside `LiveSelectionValue`:

Insert after the `LiveSelectionValue` type (around line 9):

```ts
export type LiveScrollValue = {
  top: number;
  left: number;
};
```

Inside the `LiveVarStore` class, add the following methods after `getSelection` (after line 118, before `getAll`):

```ts
  // Convenience: set a scroll value under "<alias>.scroll"
  setScroll(alias: string, scroll: LiveScrollValue | null): void {
    if (scroll === null) {
      this._vars.delete(`${alias}.scroll`);
    } else {
      this._vars.set(`${alias}.scroll`, scroll);
    }
    this._notify();
  }

  getScroll(alias: string): LiveScrollValue | null {
    const v = this._vars.get(`${alias}.scroll`);
    return isScrollValue(v) ? v : null;
  }
```

At the bottom of the file, before `export const liveVarStore = new LiveVarStore();`, add the type guard:

```ts
function isScrollValue(v: unknown): v is LiveScrollValue {
  return (
    typeof v === 'object' && v !== null &&
    typeof (v as LiveScrollValue).top === 'number' &&
    typeof (v as LiveScrollValue).left === 'number'
  );
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- scrollStore`
Expected: PASS — 5 cases.

- [ ] **Step 5: Commit**

```bash
git add frontend-v2/src/services/liveVar/liveVarStore.ts frontend-v2/src/__tests__/liveVar/scrollStore.test.ts
git commit -m "feat(liveVar): setScroll/getScroll for \$alias.scroll"
```

---

### Task 2: `linkScrollGroups` store — group membership + routed updates

**Files:**
- Create: `frontend-v2/src/services/liveVar/linkScrollGroups.ts`
- Create: `frontend-v2/src/__tests__/liveVar/linkScrollGroups.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend-v2/src/__tests__/liveVar/linkScrollGroups.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { linkScrollGroups } from '../../services/liveVar/linkScrollGroups';

beforeEach(() => linkScrollGroups._reset());

describe('linkScrollGroups', () => {
  it('register returns an unregister function that removes the member', () => {
    const unreg = linkScrollGroups.register('g1', 'm1');
    expect(linkScrollGroups.members('g1')).toEqual(['m1']);
    unreg();
    expect(linkScrollGroups.members('g1')).toEqual([]);
  });

  it('multiple members can join a group', () => {
    linkScrollGroups.register('g1', 'm1');
    linkScrollGroups.register('g1', 'm2');
    linkScrollGroups.register('g1', 'm3');
    expect(linkScrollGroups.members('g1').sort()).toEqual(['m1', 'm2', 'm3']);
  });

  it('publish delivers to all members except the source', () => {
    const seen: Array<{ id: string; value: { top: number; left: number } }> = [];
    linkScrollGroups.register('g1', 'a', (v) => seen.push({ id: 'a', value: v }));
    linkScrollGroups.register('g1', 'b', (v) => seen.push({ id: 'b', value: v }));
    linkScrollGroups.register('g1', 'c', (v) => seen.push({ id: 'c', value: v }));
    linkScrollGroups.publish('g1', 'b', { top: 99, left: 17 });
    expect(seen.map((s) => s.id).sort()).toEqual(['a', 'c']);
    expect(seen[0]!.value).toEqual({ top: 99, left: 17 });
  });

  it('publish to a group with no members is a no-op', () => {
    expect(() => linkScrollGroups.publish('ghost', 'anyone', { top: 1, left: 2 })).not.toThrow();
  });

  it('publish does not deliver to members of a different group', () => {
    let aCount = 0;
    linkScrollGroups.register('g1', 'a', () => { aCount += 1; });
    linkScrollGroups.register('g2', 'b', () => { aCount += 1; });
    linkScrollGroups.publish('g2', 'b', { top: 5, left: 5 });
    expect(aCount).toBe(0);
  });

  it('unregister cleans up the listener — no further deliveries', () => {
    let count = 0;
    const unreg = linkScrollGroups.register('g1', 'a', () => { count += 1; });
    linkScrollGroups.register('g1', 'b');
    unreg();
    linkScrollGroups.publish('g1', 'b', { top: 1, left: 1 });
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- linkScrollGroups`
Expected: FAIL — cannot find module `linkScrollGroups`.

- [ ] **Step 3: Implement**

Create `frontend-v2/src/services/liveVar/linkScrollGroups.ts`:

```ts
// Group-membership registry for `link-scroll` clauses.
// Plot panels register themselves into a named group with a unique member id
// and a delivery callback. Publishing to the group fans the update out to
// every member EXCEPT the source — this is the core "no feedback loop"
// guarantee for the scroll producer.

export type ScrollValue = { top: number; left: number };
export type ScrollDeliver = (v: ScrollValue) => void;

interface Member {
  id: string;
  deliver?: ScrollDeliver;
}

class LinkScrollGroups {
  private _groups = new Map<string, Member[]>();

  register(group: string, memberId: string, deliver?: ScrollDeliver): () => void {
    let list = this._groups.get(group);
    if (!list) {
      list = [];
      this._groups.set(group, list);
    }
    const entry: Member = { id: memberId, deliver };
    list.push(entry);
    return (): void => {
      const cur = this._groups.get(group);
      if (!cur) return;
      const idx = cur.indexOf(entry);
      if (idx >= 0) cur.splice(idx, 1);
      if (cur.length === 0) this._groups.delete(group);
    };
  }

  publish(group: string, sourceId: string, value: ScrollValue): void {
    const list = this._groups.get(group);
    if (!list) return;
    for (const m of list) {
      if (m.id === sourceId) continue;
      m.deliver?.(value);
    }
  }

  members(group: string): string[] {
    return (this._groups.get(group) ?? []).map((m) => m.id);
  }

  /** Test helper. */
  _reset(): void {
    this._groups.clear();
  }
}

export const linkScrollGroups = new LinkScrollGroups();
export type { LinkScrollGroups };

// Expose on globalThis for Playwright E2E tests.
(globalThis as Record<string, unknown>).__linkScrollGroups = linkScrollGroups;
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- linkScrollGroups`
Expected: PASS — 6 cases.

- [ ] **Step 5: Commit**

```bash
git add frontend-v2/src/services/liveVar/linkScrollGroups.ts frontend-v2/src/__tests__/liveVar/linkScrollGroups.test.ts
git commit -m "feat(liveVar): linkScrollGroups — group-routed scroll fan-out"
```

---

### Task 3: `useScrollProducer` hook — debounced producer + group consumer

**Files:**
- Create: `frontend-v2/src/hooks/useScrollProducer.ts`
- Create: `frontend-v2/src/__tests__/hooks/useScrollProducer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend-v2/src/__tests__/hooks/useScrollProducer.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { liveVarStore } from '../../services/liveVar/liveVarStore';
import { linkScrollGroups } from '../../services/liveVar/linkScrollGroups';
import { useScrollProducer } from '../../hooks/useScrollProducer';

beforeEach(() => {
  liveVarStore._reset();
  linkScrollGroups._reset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

function mkEl(): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('useScrollProducer', () => {
  it('writes $alias.scroll on viewport scroll, debounced 16ms', () => {
    const el = mkEl();
    const ref = { current: el };
    renderHook(() => useScrollProducer(ref, 'flame', 'grp'));

    // First scroll — no immediate write, timer is scheduled.
    el.scrollTop = 30;
    el.scrollLeft = 50;
    el.dispatchEvent(new Event('scroll'));
    expect(liveVarStore.getScroll('flame')).toBeNull();

    // After 16ms, the producer flushes.
    act(() => vi.advanceTimersByTime(16));
    expect(liveVarStore.getScroll('flame')).toEqual({ top: 30, left: 50 });

    document.body.removeChild(el);
  });

  it('publishes to linkScrollGroups so peers receive the update', () => {
    const elA = mkEl();
    const elB = mkEl();
    renderHook(() => useScrollProducer({ current: elA }, 'a', 'g'));
    renderHook(() => useScrollProducer({ current: elB }, 'b', 'g'));

    elA.scrollTop = 99;
    elA.scrollLeft = 17;
    elA.dispatchEvent(new Event('scroll'));
    act(() => vi.advanceTimersByTime(16));

    expect(elB.scrollTop).toBe(99);
    expect(elB.scrollLeft).toBe(17);

    document.body.removeChild(elA);
    document.body.removeChild(elB);
  });

  it('does not echo back when a remote update is applied (no feedback loop)', () => {
    const elA = mkEl();
    const elB = mkEl();
    renderHook(() => useScrollProducer({ current: elA }, 'a', 'g'));
    renderHook(() => useScrollProducer({ current: elB }, 'b', 'g'));

    // A scrolls; B receives via setter; B's listener must NOT re-emit.
    elA.scrollTop = 50;
    elA.scrollLeft = 10;
    elA.dispatchEvent(new Event('scroll'));
    act(() => vi.advanceTimersByTime(16));

    // Mimic browser firing scroll event from programmatic assignment to B.
    elB.dispatchEvent(new Event('scroll'));
    act(() => vi.advanceTimersByTime(16));

    // $b.scroll must remain unset — only $a.scroll was written.
    expect(liveVarStore.getScroll('b')).toBeNull();
    expect(liveVarStore.getScroll('a')).toEqual({ top: 50, left: 10 });

    document.body.removeChild(elA);
    document.body.removeChild(elB);
  });

  it('is a no-op when group is null/undefined', () => {
    const el = mkEl();
    renderHook(() => useScrollProducer({ current: el }, 'a', undefined));
    el.scrollTop = 42;
    el.dispatchEvent(new Event('scroll'));
    act(() => vi.advanceTimersByTime(50));
    expect(liveVarStore.getScroll('a')).toBeNull();
    document.body.removeChild(el);
  });

  it('unmount clears $alias.scroll and unregisters from the group', () => {
    const el = mkEl();
    const { unmount } = renderHook(() => useScrollProducer({ current: el }, 'a', 'g'));
    el.scrollTop = 5;
    el.dispatchEvent(new Event('scroll'));
    act(() => vi.advanceTimersByTime(16));
    expect(liveVarStore.getScroll('a')).toEqual({ top: 5, left: 0 });

    unmount();
    expect(liveVarStore.getScroll('a')).toBeNull();
    expect(linkScrollGroups.members('g')).toEqual([]);
    document.body.removeChild(el);
  });

  it('coalesces rapid scroll events into a single write within the debounce window', () => {
    const el = mkEl();
    renderHook(() => useScrollProducer({ current: el }, 'a', 'g'));

    let writes = 0;
    const off = liveVarStore.subscribe(() => { writes += 1; });

    el.scrollTop = 1; el.dispatchEvent(new Event('scroll'));
    el.scrollTop = 2; el.dispatchEvent(new Event('scroll'));
    el.scrollTop = 3; el.dispatchEvent(new Event('scroll'));
    expect(writes).toBe(0); // none flushed yet
    act(() => vi.advanceTimersByTime(16));
    expect(writes).toBe(1); // single coalesced write
    expect(liveVarStore.getScroll('a')).toEqual({ top: 3, left: 0 });

    off();
    document.body.removeChild(el);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- useScrollProducer`
Expected: FAIL — cannot find module `useScrollProducer`.

- [ ] **Step 3: Implement**

Create `frontend-v2/src/hooks/useScrollProducer.ts`:

```ts
import { useEffect, useId, useRef } from 'react';
import { liveVarStore } from '../services/liveVar/liveVarStore';
import { linkScrollGroups } from '../services/liveVar/linkScrollGroups';

const DEBOUNCE_MS = 16;

/**
 * Attach a debounced scroll producer to an element ref.
 *
 * - Writes `$<alias>.scroll = { top, left }` to `liveVarStore` after 16ms of
 *   quiet (so rapid scroll events coalesce into a single flush).
 * - Publishes the same value to `linkScrollGroups` so peers in the same
 *   group can update their viewports.
 * - When a peer publishes, this hook applies `scrollTop` / `scrollLeft`
 *   to its element while setting an `isProgrammaticScroll` flag — the
 *   listener short-circuits, preventing a feedback loop.
 * - On unmount: clears `$<alias>.scroll` and unregisters from the group.
 * - No-op when `group` is null/undefined (panel didn't opt in).
 */
export function useScrollProducer(
  ref: { current: HTMLElement | null },
  alias: string,
  group: string | null | undefined
): void {
  const memberId = useId();
  const isProgrammaticRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const latestRef = useRef<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!group) return;
    const el = ref.current;
    if (!el) return;

    const onScroll = (): void => {
      if (isProgrammaticRef.current) {
        isProgrammaticRef.current = false;
        return;
      }
      latestRef.current = { top: el.scrollTop, left: el.scrollLeft };
      if (timerRef.current !== null) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const v = latestRef.current;
        if (!v) return;
        liveVarStore.setScroll(alias, v);
        linkScrollGroups.publish(group, memberId, v);
      }, DEBOUNCE_MS);
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    const unregister = linkScrollGroups.register(group, memberId, (incoming) => {
      // Apply remote scroll to viewport without re-emitting.
      if (el.scrollTop === incoming.top && el.scrollLeft === incoming.left) return;
      isProgrammaticRef.current = true;
      el.scrollTop = incoming.top;
      el.scrollLeft = incoming.left;
    });

    return (): void => {
      el.removeEventListener('scroll', onScroll);
      unregister();
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      latestRef.current = null;
      liveVarStore.setScroll(alias, null);
    };
  }, [ref, alias, group, memberId]);
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- useScrollProducer`
Expected: PASS — 6 cases.

- [ ] **Step 5: Commit**

```bash
git add frontend-v2/src/hooks/useScrollProducer.ts frontend-v2/src/__tests__/hooks/useScrollProducer.test.tsx
git commit -m "feat(liveVar): useScrollProducer hook — debounced producer + group fan-out"
```

---

### Task 4: `link-scroll` clause in PanelClauses + plot DSL parser

**Files:**
- Modify: `frontend-v2/src/services/parser/types.ts`
- Modify: `frontend-v2/src/services/parser/plotDslParser.ts`
- Create: `frontend-v2/src/__tests__/parser/linkScrollClause.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend-v2/src/__tests__/parser/linkScrollClause.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parsePlot } from '../../services/parser/plotDslParser';

describe('plotDslParser — link-scroll clause', () => {
  it('parses link-scroll: $g on a panel', () => {
    const out = parsePlot('flamegraph { name: "n", value: "v", parent: "p" } | link-scroll: $flame_scroll');
    expect(out.diagnostics).toEqual([]);
    if (out.node?.kind !== 'panel') throw new Error('expected panel');
    expect(out.node.clauses['link-scroll']).toEqual({ group: 'flame_scroll' });
  });

  it('parses link-scroll on a line plot', () => {
    const out = parsePlot('line { x: "t", y: "v" } | link-scroll: $timeline');
    if (out.node?.kind !== 'panel') throw new Error('expected panel');
    expect(out.node.clauses['link-scroll']).toEqual({ group: 'timeline' });
  });

  it('emits no diagnostics when link-scroll is combined with other clauses', () => {
    const out = parsePlot('line { x: "t", y: "v" } | title: "T" | link-scroll: $g');
    expect(out.diagnostics).toEqual([]);
    if (out.node?.kind !== 'panel') throw new Error('expected panel');
    expect(out.node.clauses['link-scroll']).toEqual({ group: 'g' });
    expect(out.node.clauses.title).toBe('T');
  });

  it('does not emit "Unknown clause" warning for link-scroll', () => {
    const out = parsePlot('line { x: "t", y: "v" } | link-scroll: $g');
    const unknown = out.diagnostics.filter((d) => d.kind === 'UnknownClause');
    expect(unknown).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- linkScrollClause`
Expected: FAIL — `clauses['link-scroll']` is undefined; diagnostics likely contain UnknownClause.

- [ ] **Step 3: Implement**

Edit `frontend-v2/src/services/parser/types.ts`. Find the `PanelClauses` interface (around line 161). Add `'link-scroll'?: { group: string };` immediately after the `'link-xy'?: { group: string };` line:

```ts
  'link-x'?: { group: string };
  'link-y'?: { group: string };
  'link-xy'?: { group: string };
  'link-scroll'?: { group: string };
  scrollSync?: string;
```

Edit `frontend-v2/src/services/parser/plotDslParser.ts`. Update `PANEL_CLAUSE_KEYS` (around line 31) to include `'link-scroll'`:

```ts
const PANEL_CLAUSE_KEYS: ReadonlySet<string> = new Set([
  'title',
  'width',
  'height',
  'name',
  'settings',
  'disabled',
  'on_hover',
  'on_selection',
  'on_brush',
  'zoom',
  'brush',
  'highlight',
  'palette',
  'legend',
  'tooltip',
  'on',
  'link-x',
  'link-y',
  'link-xy',
  'link-scroll',
]);
```

In the same file, find the `switch (key)` block in `parsePanelClauses` (around line 440-446). Update the link case to include `'link-scroll'`:

```ts
      case 'link-x':
      case 'link-y':
      case 'link-xy':
      case 'link-scroll':
        if (isVarRef(v)) {
          (out as Record<string, unknown>)[key] = { group: v.name };
        }
        break;
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- linkScrollClause`
Expected: PASS — 4 cases.

- [ ] **Step 5: Commit**

```bash
git add frontend-v2/src/services/parser/types.ts frontend-v2/src/services/parser/plotDslParser.ts frontend-v2/src/__tests__/parser/linkScrollClause.test.ts
git commit -m "feat(parser): link-scroll clause on PanelClauses"
```

---

### Task 5: Register `link-scroll` in coupling clauses lifecycle

**Files:**
- Modify: `frontend-v2/src/services/plots/coupleClauses.ts`
- Create: `frontend-v2/src/__tests__/plots/coupleClauses.linkScroll.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend-v2/src/__tests__/plots/coupleClauses.linkScroll.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { liveVarStore } from '../../services/liveVar/liveVarStore';
import { registerCouplingClauses } from '../../services/plots/coupleClauses';
import type { PanelClauses } from '../../services/parser/types';

beforeEach(() => liveVarStore._reset());

describe('registerCouplingClauses — link-scroll', () => {
  it('initializes "<alias>.scroll" to null when link-scroll clause is present', () => {
    const clauses: PanelClauses = { 'link-scroll': { group: 'g' } };
    const cleanup = registerCouplingClauses(clauses, 'flame', 'panel1');
    expect(liveVarStore.get('flame.scroll')).toBeUndefined(); // setScroll(null) clears
    expect(liveVarStore.getScroll('flame')).toBeNull();
    cleanup();
  });

  it('cleanup clears "<alias>.scroll" on unmount', () => {
    const clauses: PanelClauses = { 'link-scroll': { group: 'g' } };
    const cleanup = registerCouplingClauses(clauses, 'flame', 'panel1');
    liveVarStore.setScroll('flame', { top: 10, left: 20 });
    cleanup();
    expect(liveVarStore.getScroll('flame')).toBeNull();
  });

  it('does nothing when link-scroll is absent', () => {
    const clauses: PanelClauses = {};
    const cleanup = registerCouplingClauses(clauses, 'flame', 'panel1');
    liveVarStore.setScroll('flame', { top: 1, left: 2 });
    cleanup();
    // Cleanup must not touch a value the panel did not declare.
    expect(liveVarStore.getScroll('flame')).toEqual({ top: 1, left: 2 });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- coupleClauses.linkScroll`
Expected: FAIL — `link-scroll` is not registered; first test fails because `getScroll` may be undefined initially but the cleanup behavior isn't wired.

- [ ] **Step 3: Implement**

Edit `frontend-v2/src/services/plots/coupleClauses.ts`. Add after the `zoom` block (after the `if (clauses.zoom !== undefined)` block, before the `link-x/link-y/link-xy` block):

```ts
  if (clauses['link-scroll'] !== undefined) {
    liveVarStore.setScroll(cellAlias, null);
    cleanups.push(() => liveVarStore.setScroll(cellAlias, null));
  }
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- coupleClauses.linkScroll`
Expected: PASS — 3 cases.

- [ ] **Step 5: Commit**

```bash
git add frontend-v2/src/services/plots/coupleClauses.ts frontend-v2/src/__tests__/plots/coupleClauses.linkScroll.test.ts
git commit -m "feat(plots): register link-scroll in coupling lifecycle"
```

---

### Task 6: Wire `useScrollProducer` into `FlamegraphPlot`

**Files:**
- Modify: `frontend-v2/src/components/plots/FlamegraphPlot.tsx`
- Modify: `frontend-v2/src/components/cell/PlotPane.tsx`
- Create: `frontend-v2/src/__tests__/plots/flamegraphLinkScroll.test.tsx`

The flamegraph already has a `scrollContainerRef`. We attach the new producer there, gated on the `link-scroll` clause. The legacy `scrollSync` single-axis hook continues to work in parallel (independent feature).

**Why the alias must come via prop:** `FlamegraphPlot` does not have access to `cellId` today. The owning `PanelPane` in `PlotPane.tsx` knows `alias = liveVarKey ?? cellId`. We add an optional `cellAlias?: string` prop to `FlamegraphPlot` and pass it from `renderChartForPanel`. To do so, `renderChartForPanel` is extended to accept an `alias` argument, which `PanelPane` already has in scope.

- [ ] **Step 1: Write the failing test**

Create `frontend-v2/src/__tests__/plots/flamegraphLinkScroll.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { liveVarStore } from '../../services/liveVar/liveVarStore';
import { linkScrollGroups } from '../../services/liveVar/linkScrollGroups';
import { FlamegraphPlot } from '../../components/plots/FlamegraphPlot';
import { PlotContext } from '../../components/plots/PlotContext';
import type { PlotContextValue } from '../../components/plots/plotTypes';
import type { PanelNode } from '../../services/parser/types';

beforeEach(() => {
  liveVarStore._reset();
  linkScrollGroups._reset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

// Minimal PlotContext stub — only the fields FlamegraphPlot reads.
const noopCtx: PlotContextValue = {
  registerSeries: () => {},
  onHover: () => {},
  hiddenSeries: new Set<string>(),
  addPin: () => {},
  onZoomReset: null,
  registerZoomReset: () => {},
  setBrush: () => {},
  setHover: () => {},
  setZoom: () => {},
};

function panelWithLinkScroll(group: string): PanelNode {
  return {
    kind: 'panel',
    plotType: 'flamegraph',
    config: { name: 'name', value: 'value', parent: 'parent' },
    clauses: { 'link-scroll': { group } },
  };
}

describe('FlamegraphPlot — link-scroll', () => {
  it('registers as a member of the link-scroll group when cellAlias is provided', () => {
    const rows = [
      { name: 'root', value: 100, parent: null },
      { name: 'a', value: 60, parent: 'root' },
    ];
    render(
      <PlotContext.Provider value={noopCtx}>
        <FlamegraphPlot
          node={panelWithLinkScroll('flame_grp')}
          rows={rows}
          cellAlias="flame_cell"
        />
      </PlotContext.Provider>
    );
    expect(linkScrollGroups.members('flame_grp').length).toBe(1);
  });

  it('does not register without a link-scroll clause', () => {
    const rows = [{ name: 'root', value: 1, parent: null }];
    const node: PanelNode = {
      kind: 'panel',
      plotType: 'flamegraph',
      config: { name: 'name', value: 'value', parent: 'parent' },
      clauses: {},
    };
    render(
      <PlotContext.Provider value={noopCtx}>
        <FlamegraphPlot node={node} rows={rows} cellAlias="flame_cell" />
      </PlotContext.Provider>
    );
    expect(linkScrollGroups.members('flame_grp').length).toBe(0);
  });

  it('does not register when cellAlias is missing (defensive)', () => {
    const rows = [{ name: 'root', value: 1, parent: null }];
    render(
      <PlotContext.Provider value={noopCtx}>
        <FlamegraphPlot node={panelWithLinkScroll('flame_grp')} rows={rows} />
      </PlotContext.Provider>
    );
    expect(linkScrollGroups.members('flame_grp').length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- flamegraphLinkScroll`
Expected: FAIL — `cellAlias` is not a known prop on `FlamegraphPlot`; registration count is 0.

- [ ] **Step 3: Implement**

**Part A — extend `FlamegraphPlot` to accept `cellAlias`:**

Edit `frontend-v2/src/components/plots/FlamegraphPlot.tsx`.

Add the import after the existing `useScrollSync` import (around line 16):

```ts
import { useScrollProducer } from '../../hooks/useScrollProducer';
```

Update the `FlamegraphPlotProps` interface (around line 21-25) to include the new prop:

```ts
interface FlamegraphPlotProps {
  node: PanelNode;
  rows: Record<string, unknown>[];
  scope?: Record<string, unknown>;
  /** Cell alias for live-var producers (e.g. `$<alias>.scroll`). */
  cellAlias?: string;
}
```

Update the function signature to destructure `cellAlias`:

```ts
export function FlamegraphPlot({ node, rows, scope = {}, cellAlias }: FlamegraphPlotProps): JSX.Element {
```

Add the `link-scroll` wiring **immediately after the existing `useScrollSync(scrollContainerRef, scrollSync);` line** (around line 38):

```ts
  const linkScrollGroup =
    typeof node.clauses?.['link-scroll']?.group === 'string'
      ? node.clauses['link-scroll'].group
      : undefined;
  // Only enable when both alias and group are known — defensive against
  // older PanelPane callers that don't pass cellAlias.
  useScrollProducer(scrollContainerRef, cellAlias ?? '', cellAlias ? linkScrollGroup : undefined);
```

**Part B — pass `cellAlias` from `PlotPane.tsx`:**

Edit `frontend-v2/src/components/cell/PlotPane.tsx`.

Update `renderChartForPanel` to accept and pass an alias (around line 44):

```ts
function renderChartForPanel(
  panelNode: PanelNode,
  rows: Record<string, unknown>[],
  alias: string,
): JSX.Element | null {
  switch (panelNode.plotType) {
    case 'line':
      return <LineChartPlot node={panelNode} rows={rows} />;
    case 'bar':
      return <BarChartPlot node={panelNode} rows={rows} />;
    case 'scatter':
      return <ScatterPlot node={panelNode} rows={rows} />;
    case 'heatmap':
      return <HeatmapPlot node={panelNode} rows={rows} />;
    case 'boxplot':
      return <BoxplotPlot node={panelNode} rows={rows} />;
    case 'histogram':
      return <HistogramPlot node={panelNode} rows={rows} />;
    case 'flamegraph':
      return <FlamegraphPlot node={panelNode} rows={rows} cellAlias={alias} />;
    case 'pie':
      return <PieChartPlot node={panelNode} rows={rows} />;
    case 'area':
      return <AreaChartPlot node={panelNode} rows={rows} />;
    case 'range':
      return <RangePlot node={panelNode} rows={rows} />;
    case 'gantt':
      return <GanttChartPlot node={panelNode} rows={rows} />;
    case 'table':
      return <TablePlot node={panelNode} rows={rows} />;
    default: {
      const _exhaustive: never = panelNode.plotType;
      void _exhaustive;
      return null;
    }
  }
}
```

Find every call site of `renderChartForPanel` in `PlotPane.tsx` and pass the alias. Use Grep first:

```bash
grep -n "renderChartForPanel" /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/components/cell/PlotPane.tsx
```

For each call, change `renderChartForPanel(panelNode, rows)` to `renderChartForPanel(panelNode, rows, alias)` — where `alias` is the local variable (or `liveVarKey ?? cellId` if the call site doesn't yet have an `alias` local). In `PanelPane` the local `alias` (line 96 in the source today) is already in scope.

If call sites outside `PanelPane` need an alias, add a default of `cellId` from the nearest enclosing scope. Reading the file confirms there is one main caller inside `PanelPane`'s render flow; pass `alias` there.

- [ ] **Step 4: Run to confirm pass**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- flamegraphLinkScroll`
Expected: PASS — 3 cases.

- [ ] **Step 5: Commit**

```bash
git add frontend-v2/src/components/plots/FlamegraphPlot.tsx frontend-v2/src/components/cell/PlotPane.tsx frontend-v2/src/__tests__/plots/flamegraphLinkScroll.test.tsx
git commit -m "feat(plots): wire link-scroll producer into FlamegraphPlot via PanelPane"
```

---

### Task 7: Integration test — two panels in same `link-scroll` group sync

**Files:**
- Create: `frontend-v2/src/__tests__/integration/linkScrollTwoPanels.test.tsx`

**Note on fixtures:** This test uses stub `PanelNode` data and synthetic rows only — no raw `.jfr` files, no WASM importer, no DuckDB fixture. If a test variant needs real flamegraph data in the future, use `tests/fixtures/jfr/sample-small.db` via a mocked `DuckDBClientLike`.

- [ ] **Step 1: Write the failing test**

Create `frontend-v2/src/__tests__/integration/linkScrollTwoPanels.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { liveVarStore } from '../../services/liveVar/liveVarStore';
import { linkScrollGroups } from '../../services/liveVar/linkScrollGroups';
import { FlamegraphPlot } from '../../components/plots/FlamegraphPlot';
import { PlotContext } from '../../components/plots/PlotContext';
import type { PlotContextValue } from '../../components/plots/plotTypes';
import type { PanelNode } from '../../services/parser/types';

beforeEach(() => {
  liveVarStore._reset();
  linkScrollGroups._reset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const noopCtx: PlotContextValue = {
  registerSeries: () => {},
  onHover: () => {},
  hiddenSeries: new Set<string>(),
  addPin: () => {},
  onZoomReset: null,
  registerZoomReset: () => {},
  setBrush: () => {},
  setHover: () => {},
  setZoom: () => {},
};

function panel(group: string): PanelNode {
  return {
    kind: 'panel',
    plotType: 'flamegraph',
    config: { name: 'name', value: 'value', parent: 'parent' },
    clauses: { 'link-scroll': { group } },
  };
}

const rows = [
  { name: 'root', value: 100, parent: null },
  { name: 'a', value: 60, parent: 'root' },
  { name: 'b', value: 40, parent: 'root' },
];

describe('link-scroll integration — two panels in the same group', () => {
  it('two panels register as members of the same group', () => {
    render(
      <div>
        <PlotContext.Provider value={noopCtx}>
          <FlamegraphPlot node={panel('grp1')} rows={rows} cellAlias="a" />
        </PlotContext.Provider>
        <PlotContext.Provider value={noopCtx}>
          <FlamegraphPlot node={panel('grp1')} rows={rows} cellAlias="b" />
        </PlotContext.Provider>
      </div>
    );
    act(() => { vi.runOnlyPendingTimers(); });
    expect(linkScrollGroups.members('grp1').length).toBe(2);
  });

  it('publish from one member delivers to other members but not the source', () => {
    render(
      <div>
        <PlotContext.Provider value={noopCtx}>
          <FlamegraphPlot node={panel('grp1')} rows={rows} cellAlias="a" />
        </PlotContext.Provider>
        <PlotContext.Provider value={noopCtx}>
          <FlamegraphPlot node={panel('grp1')} rows={rows} cellAlias="b" />
        </PlotContext.Provider>
      </div>
    );
    act(() => { vi.runOnlyPendingTimers(); });

    const memberIds = linkScrollGroups.members('grp1');
    expect(memberIds.length).toBe(2);
    const idA = memberIds[0]!;

    // Add an observer to confirm that publishing from A fans out to non-A members.
    let observerReceived: { top: number; left: number } | null = null;
    linkScrollGroups.register('grp1', 'observer', (v) => { observerReceived = v; });
    linkScrollGroups.publish('grp1', idA, { top: 42, left: 0 });
    expect(observerReceived).toEqual({ top: 42, left: 0 });

    // Publishing from a member must NOT echo back to that same member's callback.
    let selfEcho: { top: number; left: number } | null = null;
    const unreg = linkScrollGroups.register('grp1', 'observer-2', (v) => { selfEcho = v; });
    linkScrollGroups.publish('grp1', 'observer-2', { top: 1, left: 1 });
    expect(selfEcho).toBeNull();
    unreg();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- linkScrollTwoPanels`
Expected: PASS if Tasks 1-6 succeeded. If FAIL — likely because the FlamegraphPlot wasn't fully wired with `cellAlias`. Inspect Task 6 result.

- [ ] **Step 3: Implement**

This is a verification test — no production code changes needed if Tasks 1-6 are complete. If the registration count is unexpectedly 0, examine whether `useEffect` actually fires under the test (it should, since `render` triggers commit). If 0, add `await Promise.resolve()` or a microtask flush before the assertion.

- [ ] **Step 4: Run to confirm pass**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- linkScrollTwoPanels`
Expected: PASS — 2 cases.

- [ ] **Step 5: Commit**

```bash
git add frontend-v2/src/__tests__/integration/linkScrollTwoPanels.test.tsx
git commit -m "test(integration): link-scroll members register and fan-out without echo"
```

---

### Task 8: Full suite + build check

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test`
Expected: All tests pass — no regressions introduced.

If any pre-existing tests fail that touch `liveVarStore`, `coupleClauses`, or the plot DSL parser, investigate. Common causes:
- `getAll()` snapshot tests that count entries now see scroll keys — adjust expectations if the test legitimately needs to.
- Property tests for `plotDslParser` that enumerate clause keys — they may now expect `link-scroll` as a valid key.

- [ ] **Step 2: Typecheck + build**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run typecheck && npm run build`
Expected: No TypeScript errors, build succeeds.

If `tsc` complains about `node.clauses?.['link-scroll']` being possibly undefined, the optional-chain plus `typeof === 'string'` guard in Task 6 already handles it.

- [ ] **Step 3: Final commit (if any fixes needed)**

If Tasks 1–7 are clean, nothing to commit here. If fixes were needed:

```bash
git add <files>
git commit -m "fix: resolve <issue> from link-scroll integration"
```

---

## Self-Review

**Spec coverage** (from `redesign-plan/IMPLEMENTATION_PLAN.md` §M-E6):
- Scroll position written as `LiveScrollValue { top, left }` to `$cell.scroll` — ✓ Task 1
- `link-scroll` clause subscribes plots to a shared scroll group — ✓ Tasks 4, 5, 6
- Group fan-out: scrolling one synchronizes the rest — ✓ Tasks 2, 3, 7
- Debounced at 16ms — ✓ Task 3 (DEBOUNCE_MS = 16)
- No feedback loop (`isProgrammaticScroll` flag) — ✓ Task 3 (`isProgrammaticRef`)
- ScrollGesture writes LiveScrollValue → consolidated into `useScrollProducer` hook for React idiom — ✓ Task 3
- Unit tests cover scroll write, debounce, no-echo — ✓ Tasks 1, 3
- Integration test: two plots in same `link-scroll` group sync — ✓ Task 7

**Placeholder scan:** No TBD patterns. Every Step 3 has complete, copy-pasteable code with concrete imports, types, and logic. Task 6 inspects an existing source file to locate the destructure to update; the alternative target is given explicitly.

**Type consistency:**
- `LiveScrollValue = { top: number; left: number }` — defined in `liveVarStore.ts`, re-used as inline type in `linkScrollGroups.ts` (`ScrollValue`) and `useScrollProducer.ts` (anonymous shape). Compatible by structural typing.
- `PanelClauses['link-scroll']` is `{ group: string } | undefined` — matches the `link-x/y/xy` pattern already in the codebase.

**Out of scope / deferred:**
- LineChartPlot and ScatterPlot wiring — these don't currently have an inner scrollable viewport; they fit their container. Adding scrollable wrappers for them is a separate UX decision (would require introducing a max-height + overflow:auto). Deferred to M-E6.1 or absorbed into M-E8.
- E2E Playwright test — the unit + integration tests cover the contract surfaces; a full E2E test requires a fixture notebook with a long flamegraph and is best added alongside the next showcase iteration. When that E2E test is implemented: use `tests/fixtures/jfr/sample-small.jfr` (browser path via ingest UI) for Playwright tests; do NOT bypass the ingest UI or use raw JFR files in Vitest. Deferred.
- `LineChartPlot.tsx`'s `wheel` handler for zoom is unchanged. `link-scroll` does not interfere with the zoom wheel handler because scroll producer is bound to the `scrollContainerRef`, not the SVG.
- Legacy single-axis `scrollSync` clause is preserved (unchanged). The new `link-scroll` is a separate, dual-axis, $alias.scroll producer. A future cleanup could fold them together; not in this milestone.
- Visual showcase / `WorkspaceGlobalsSection` UI updates — `$alias.scroll` will appear automatically in any varbar that lists `liveVarStore.getAll()`; no UI code change required for this milestone.

**Gate criteria (from main plan):**
- scroll writes `$cell.scroll` — ✓
- linked plots scroll-sync via `link-scroll` group — ✓
- 16ms debounce — ✓
- no feedback loop — ✓
