# M-E4 Workspace `$session_start` / `$session_end` Topbar Date Pickers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two first-class workspace globals — `$session_start` and `$session_end` — as compact date/time picker chips in the topbar. Clicking a chip expands an inline `<input type="datetime-local">` picker. The values are stored in `liveVarStore` as ISO strings and are substituted into SQL via the existing `substituteNotebookVars` path.

**Architecture:**
The `liveVarStore` singleton already holds arbitrary `VarValue` (ISO string is fine). `substituteNotebookVars` in `cellExecutor.ts` already replaces `$varName` tokens from `notebook.frontmatter.variables`; for session globals we inject them into that same `variables` map at call-time from `liveVarStore`. Two new helpers handle ISO string defaults ("now - 1 hour" and "now") and datetime formatting. A new `SessionDateChip` sub-component inside `Topbar.tsx` renders the compact display and inline picker. No new context or store is required.

**Tech Stack:** TypeScript, React 19 (no external date-picker library — use native `<input type="datetime-local">`), Vitest, @testing-library/react.

---

## File Structure

**Create:**
- `src/utils/sessionDates.ts` — pure helpers: `defaultSessionStart()`, `defaultSessionEnd()`, `isoToCompact(iso: string): string`, `compactLabel(start: string, end: string): string`.
- `src/__tests__/utils/sessionDates.test.ts`
- `src/__tests__/shell/topbarSessionDates.test.tsx`

**Modify:**
- `src/components/shell/Topbar.tsx` — add two `SessionDateChip` sub-components and wire them to `liveVarStore`.
- `src/services/executor/cellExecutor.ts` — inject `$session_start` and `$session_end` from `liveVarStore` into the `variables` map before substitution.
- `src/__tests__/shell/Topbar.test.tsx` — extend with session-date chip smoke tests (check renders, not dates).

---

### Task 1: Pure date helpers

**Files:**
- Create: `src/utils/sessionDates.ts`
- Create: `src/__tests__/utils/sessionDates.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/utils/sessionDates.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  defaultSessionStart,
  defaultSessionEnd,
  isoToCompact,
  compactLabel,
} from '../../utils/sessionDates';

describe('sessionDates', () => {
  beforeEach(() => {
    // Pin "now" to 2026-06-24T13:00:00.000Z
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-24T13:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('defaultSessionEnd returns current ISO time', () => {
    const end = defaultSessionEnd();
    expect(end).toBe('2026-06-24T13:00:00.000Z');
  });

  it('defaultSessionStart returns 1 hour before end', () => {
    const start = defaultSessionStart();
    expect(start).toBe('2026-06-24T12:00:00.000Z');
  });

  it('isoToCompact formats as HH:MM when same day as today', () => {
    // 13:00 UTC on 2026-06-24 — compact is just the local time
    const compact = isoToCompact('2026-06-24T13:00:00.000Z');
    // We just check it is a short string containing digits and ":"
    expect(compact).toMatch(/\d{1,2}:\d{2}/);
  });

  it('isoToCompact formats as MM-DD HH:MM for a different day', () => {
    const compact = isoToCompact('2026-06-23T08:30:00.000Z');
    // Should include date portion
    expect(compact.length).toBeGreaterThan(5);
  });

  it('compactLabel returns "HH:MM — HH:MM" format for same-day range', () => {
    const label = compactLabel('2026-06-24T12:00:00.000Z', '2026-06-24T13:00:00.000Z');
    // Contains the em-dash separator
    expect(label).toContain('—');
    const parts = label.split('—').map((s) => s.trim());
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      expect(part).toMatch(/\d{1,2}:\d{2}/);
    }
  });
});

- [ ] **Step 2: Run to confirm failure**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run sessionDates`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/utils/sessionDates.ts`:

```ts
const ONE_HOUR_MS = 60 * 60 * 1000;

export function defaultSessionEnd(): string {
  return new Date().toISOString();
}

export function defaultSessionStart(): string {
  return new Date(Date.now() - ONE_HOUR_MS).toISOString();
}

/** Format an ISO date string into a compact human label.
 *  Same-day: "HH:MM"
 *  Different day: "MM/DD HH:MM"
 */
export function isoToCompact(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mo}/${dd} ${hh}:${mm}`;
}

/** Compact chip label for the start—end range. */
export function compactLabel(startIso: string, endIso: string): string {
  return `${isoToCompact(startIso)} — ${isoToCompact(endIso)}`;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run sessionDates`
Expected: PASS — all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add src/utils/sessionDates.ts src/__tests__/utils/sessionDates.test.ts
git commit -m "feat(utils): sessionDates helpers — defaults, compact formatter"
```

---

### Task 2: `SessionDateChip` sub-component inside `Topbar`

The chip renders as a compact button showing the current value (e.g. `⏱ 12:00 — 13:00`). Clicking opens an inline `<input type="datetime-local">` picker that commits on blur or Enter, or cancels on Escape.

**Files:**
- Modify: `src/components/shell/Topbar.tsx`
- Create: `src/__tests__/shell/topbarSessionDates.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/shell/topbarSessionDates.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { Topbar } from '../../components/shell/Topbar';
import { liveVarStore } from '../../services/liveVar/liveVarStore';
import { FileIngestProvider } from '../../context/FileIngestContext';
import { ReportModeProvider } from '../../context/ReportModeContext';

function wrap(children: ReactElement): ReactElement {
  return (
    <ReportModeProvider>
      <FileIngestProvider>{children}</FileIngestProvider>
    </ReportModeProvider>
  );
}

beforeEach(() => {
  liveVarStore._reset();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-24T13:00:00.000Z'));
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('dark'), media: q,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false, onchange: null,
  }));
});

afterEach(() => {
  liveVarStore._reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Topbar — session date chips (hasNotebook=true)', () => {
  it('renders the session-range chip strip', () => {
    render(wrap(<Topbar hasNotebook={true} />));
    expect(screen.getByTestId('topbar-session-range')).toBeInTheDocument();
  });

  it('chip strip is NOT shown when hasNotebook=false', () => {
    render(wrap(<Topbar hasNotebook={false} />));
    expect(screen.queryByTestId('topbar-session-range')).toBeNull();
  });

  it('initialises liveVarStore with $session_start and $session_end on mount', () => {
    render(wrap(<Topbar hasNotebook={true} />));
    expect(typeof liveVarStore.get('session_start')).toBe('string');
    expect(typeof liveVarStore.get('session_end')).toBe('string');
  });

  it('$session_start defaults to ~1 hour before $session_end', () => {
    render(wrap(<Topbar hasNotebook={true} />));
    const start = liveVarStore.get('session_start') as string;
    const end = liveVarStore.get('session_end') as string;
    const diff = new Date(end).getTime() - new Date(start).getTime();
    // Allow 5 seconds tolerance around exactly 1 hour
    expect(Math.abs(diff - 3600000)).toBeLessThan(5000);
  });

  it('start chip has data-testid="session-start-chip"', () => {
    render(wrap(<Topbar hasNotebook={true} />));
    expect(screen.getByTestId('session-start-chip')).toBeInTheDocument();
  });

  it('end chip has data-testid="session-end-chip"', () => {
    render(wrap(<Topbar hasNotebook={true} />));
    expect(screen.getByTestId('session-end-chip')).toBeInTheDocument();
  });

  it('clicking start chip expands a datetime-local input', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<Topbar hasNotebook={true} />));
    await user.click(screen.getByTestId('session-start-chip'));
    expect(screen.getByTestId('session-start-input')).toBeInTheDocument();
  });

  it('clicking end chip expands a datetime-local input', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<Topbar hasNotebook={true} />));
    await user.click(screen.getByTestId('session-end-chip'));
    expect(screen.getByTestId('session-end-input')).toBeInTheDocument();
  });

  it('Escape while the start picker is open collapses it without changing the store', () => {
    render(wrap(<Topbar hasNotebook={true} />));
    const before = liveVarStore.get('session_start') as string;
    fireEvent.click(screen.getByTestId('session-start-chip'));
    const input = screen.getByTestId('session-start-input');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('session-start-input')).toBeNull();
    expect(liveVarStore.get('session_start')).toBe(before);
  });

  it('blur on start input commits the new value to liveVarStore', () => {
    render(wrap(<Topbar hasNotebook={true} />));
    fireEvent.click(screen.getByTestId('session-start-chip'));
    const input = screen.getByTestId('session-start-input') as HTMLInputElement;
    // datetime-local value format: "YYYY-MM-DDTHH:MM"
    fireEvent.change(input, { target: { value: '2026-06-24T10:00' } });
    fireEvent.blur(input);
    const stored = liveVarStore.get('session_start') as string;
    expect(new Date(stored).getHours()).toBe(10);
    expect(screen.queryByTestId('session-start-input')).toBeNull();
  });

  it('Enter on end input commits the new value', () => {
    render(wrap(<Topbar hasNotebook={true} />));
    fireEvent.click(screen.getByTestId('session-end-chip'));
    const input = screen.getByTestId('session-end-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-06-24T14:30' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const stored = liveVarStore.get('session_end') as string;
    expect(new Date(stored).getHours()).toBe(14);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run topbarSessionDates`
Expected: FAIL — `topbar-session-range` does not exist, `session_start` / `session_end` not in store.

- [ ] **Step 3: Add `SessionDateChip` and session bar to `Topbar.tsx`**

In `src/components/shell/Topbar.tsx`, add the following imports at the top of the file (after the existing imports):

```ts
import { useEffect, useState } from 'react';
import { defaultSessionStart, defaultSessionEnd, compactLabel, isoToCompact } from '../../utils/sessionDates';
```

Add the `SessionDateChip` component just before the `TopbarVarChip` component definition (~line 43):

```tsx
interface SessionDateChipProps {
  varKey: 'session_start' | 'session_end';
  label: string;
}

function SessionDateChip({ varKey, label }: SessionDateChipProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  // Read current value from store.
  const stored = liveVarStore.get(varKey);
  const currentIso = typeof stored === 'string' ? stored : '';

  // Convert ISO to datetime-local value: "YYYY-MM-DDTHH:MM"
  function isoToDatetimeLocal(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function commit(localValue: string): void {
    if (!localValue) { setOpen(false); return; }
    const iso = new Date(localValue).toISOString();
    liveVarStore.set(varKey, iso);
    setOpen(false);
  }

  if (open) {
    return (
      <input
        type="datetime-local"
        data-testid={`${varKey.replace('_', '-')}-input`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(draft); }
          if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
        }}
        autoFocus
        className="rounded border border-[var(--color-accent)]/50 bg-[var(--color-bg-base)]
                   px-1.5 py-0.5 text-[11px] font-mono text-[var(--color-fg-base)]
                   focus:outline-none focus:border-[var(--color-accent)] w-36"
        aria-label={`Set ${varKey}`}
      />
    );
  }

  return (
    <button
      type="button"
      data-testid={`${varKey.replace('_', '-')}-chip`}
      onClick={() => {
        setDraft(isoToDatetimeLocal(currentIso));
        setOpen(true);
      }}
      className="inline-flex items-center gap-1 rounded border border-[rgba(34,211,238,0.3)]
                 bg-[rgba(34,211,238,0.08)] px-1.5 py-0.5 text-[11px] font-mono
                 text-[var(--color-accent)] hover:bg-[rgba(34,211,238,0.15)] transition-colors"
      aria-label={`Edit ${varKey}`}
    >
      {label}: {currentIso ? isoToCompact(currentIso) : '—'}
    </button>
  );
}
```

Add session-range initialisation at the start of the `Topbar` component function (after the existing `useSyncExternalStore` call on ~line 82):

```ts
// Seed $session_start / $session_end on first render when a notebook is open.
useEffect(() => {
  if (!hasNotebook) return;
  if (!liveVarStore.get('session_start')) {
    liveVarStore.set('session_start', defaultSessionStart());
  }
  if (!liveVarStore.get('session_end')) {
    liveVarStore.set('session_end', defaultSessionEnd());
  }
}, [hasNotebook]);
```

In the `hasNotebook=true` JSX return path, add the session-range bar. Insert it between the main header `<div>` (the `flex h-9` row) and the varbar row. Place it as a new `{hasNotebook && ...}` conditional block:

```tsx
{hasNotebook && (
  <div
    data-testid="topbar-session-range"
    className="flex items-center gap-2 px-3 py-0.5 border-t border-[var(--color-border)]
               bg-[rgba(34,211,238,0.03)] text-[11px]"
  >
    <span className="text-[var(--color-fg-muted)] select-none" aria-hidden="true">⏱</span>
    <SessionDateChip varKey="session_start" label="start" />
    <span className="text-[var(--color-fg-muted)]" aria-hidden="true">–</span>
    <SessionDateChip varKey="session_end" label="end" />
  </div>
)}
```

Note: The `data-testid` for the input uses the pattern `session-start-input` (replacing underscore with hyphen), which matches what the tests above expect.

- [ ] **Step 4: Run the test to confirm pass**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run topbarSessionDates`
Expected: PASS — all 12 cases.

- [ ] **Step 5: Run the full Topbar suite to catch regressions**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run Topbar`
Expected: all pre-existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/Topbar.tsx \
        src/__tests__/shell/topbarSessionDates.test.tsx
git commit -m "feat(topbar): M-E4 session_start/session_end date picker chips"
```

---

### Task 3: Inject `$session_start` / `$session_end` into SQL execution

When a SQL cell contains `$session_start` or `$session_end`, the existing `substituteNotebookVars` function in `cellExecutor.ts` will replace them — but only if the values appear in the `variables` map that is passed in. Currently that map comes from `notebook.frontmatter.variables` only.

This task makes `executeCell` inject the two session globals from `liveVarStore` into the variables map before substitution.

**Files:**
- Modify: `src/services/executor/cellExecutor.ts`
- Create: `src/__tests__/executor/sessionVarSubstitution.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/executor/sessionVarSubstitution.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeCell } from '../../services/executor/cellExecutor';
import { liveVarStore } from '../../services/liveVar/liveVarStore';
import type { Cell } from '../../services/parser/types';

beforeEach(() => liveVarStore._reset());
afterEach(() => liveVarStore._reset());

function makeCell(sql: string): Cell {
  return {
    alias: 'test_cell',
    displayIndex: 1,
    frontmatter: {},
    blocks: [{ kind: 'sql', source: sql }],
  };
}

function makeClient(capturedSql: { value: string }) {
  return {
    query: async (sql: string) => {
      capturedSql.value = sql;
      return [{ n: 42 }];
    },
  };
}

describe('executeCell — $session_start / $session_end substitution', () => {
  it('substitutes $session_start from liveVarStore into SQL', async () => {
    liveVarStore.set('session_start', '2026-06-24T12:00:00.000Z');
    const captured = { value: '' };
    const client = makeClient(captured);
    const ac = new AbortController();
    await executeCell(
      makeCell('SELECT * FROM events WHERE ts >= \'$session_start\''),
      client as unknown as import('../../services/duckdb/client').DuckDBClient,
      ac.signal,
      liveVarStore,
    );
    expect(captured.value).toContain('2026-06-24T12:00:00.000Z');
    expect(captured.value).not.toContain('$session_start');
  });

  it('substitutes $session_end from liveVarStore', async () => {
    liveVarStore.set('session_end', '2026-06-24T13:00:00.000Z');
    const captured = { value: '' };
    const client = makeClient(captured);
    const ac = new AbortController();
    await executeCell(
      makeCell('SELECT * FROM events WHERE ts <= \'$session_end\''),
      client as unknown as import('../../services/duckdb/client').DuckDBClient,
      ac.signal,
      liveVarStore,
    );
    expect(captured.value).toContain('2026-06-24T13:00:00.000Z');
    expect(captured.value).not.toContain('$session_end');
  });

  it('caller-supplied variables take precedence over liveVarStore session values', async () => {
    liveVarStore.set('session_start', '2026-06-24T12:00:00.000Z');
    const captured = { value: '' };
    const client = makeClient(captured);
    const ac = new AbortController();
    await executeCell(
      makeCell('SELECT \'$session_start\' AS t'),
      client as unknown as import('../../services/duckdb/client').DuckDBClient,
      ac.signal,
      liveVarStore,
      { session_start: 'caller-override' },
    );
    expect(captured.value).toContain('caller-override');
  });

  it('leaves $session_start unchanged when not in liveVarStore', async () => {
    // session_start not set in store
    const captured = { value: '' };
    const client = makeClient(captured);
    const ac = new AbortController();
    await executeCell(
      makeCell('SELECT * FROM events WHERE ts >= \'$session_start\''),
      client as unknown as import('../../services/duckdb/client').DuckDBClient,
      ac.signal,
      liveVarStore,
    );
    // Not substituted — left as literal $session_start token
    expect(captured.value).toContain('$session_start');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run sessionVarSubstitution`
Expected: FAIL — `$session_start` token is not replaced because the store value is not forwarded into the variables map.

- [ ] **Step 3: Inject session globals in `executeCell`**

In `src/services/executor/cellExecutor.ts`, update `executeCell` to merge session globals from `liveVarStore` into the variables map. The injection must happen before `substituteNotebookVars`:

```ts
export async function executeCell(
  cell: Cell,
  client: DuckDBClient,
  signal: AbortSignal,
  liveVars?: LiveVarStore,
  variables?: Record<string, string>
): Promise<ExecutionResult> {
  const start = performance.now();

  const firstSql = cell.blocks.find((b) => b.kind === 'sql');
  if (!firstSql) {
    throw new TypeError(
      `cellExecutor only handles cells with SQL blocks; no SQL block found in cell "${
        cell.alias ?? '(unnamed)'
      }"`
    );
  }

  const rawSql = firstSql.source;

  // Build effective variables map: caller-supplied overrides session globals.
  let effectiveVars = variables;
  if (liveVars !== undefined) {
    const sessionStart = liveVars.get('session_start');
    const sessionEnd = liveVars.get('session_end');
    if (typeof sessionStart === 'string' || typeof sessionEnd === 'string') {
      const injected: Record<string, string> = {};
      if (typeof sessionStart === 'string') injected['session_start'] = sessionStart;
      if (typeof sessionEnd === 'string') injected['session_end'] = sessionEnd;
      // Caller-supplied variables win over injected session globals.
      effectiveVars = { ...injected, ...(variables ?? {}) };
    }
  }

  const withVars = substituteNotebookVars(rawSql, effectiveVars);
  const sqlSource = liveVars !== undefined ? substituteLiveVars(withVars, liveVars) : withVars;

  // … rest of the function unchanged …
```

- [ ] **Step 4: Run the test to confirm pass**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run sessionVarSubstitution`
Expected: PASS — all 4 cases.

- [ ] **Step 5: Run the full executor suite**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run cellExecutor`
Expected: all pre-existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/executor/cellExecutor.ts \
        src/__tests__/executor/sessionVarSubstitution.test.ts
git commit -m "feat(executor): M-E4 inject \$session_start/\$session_end from liveVarStore"
```

---

### Task 4: Re-execute dependent cells when session dates change

When the user changes a session date chip, `liveVarStore.set('session_start', ...)` fires a `change` event. The existing `CellView` subscription on `useLiveVarVersion` already re-runs cells when `hasSqlLiveVar` is true. However `hasSqlLiveVar` only detects `.brush`, `.hover`, `.zoom`, `.selection` suffixes. We need to also detect plain `$session_start` / `$session_end` tokens.

**Files:**
- Modify: `src/components/cell/CellView.tsx`
- Create: `src/__tests__/cell/sessionVarRerun.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/cell/sessionVarRerun.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hasSqlSessionVar } from '../../components/cell/cellUtils';

describe('hasSqlSessionVar', () => {
  it('returns true when SQL contains $session_start', () => {
    expect(hasSqlSessionVar("SELECT * FROM t WHERE ts >= '$session_start'")).toBe(true);
  });

  it('returns true when SQL contains $session_end', () => {
    expect(hasSqlSessionVar("SELECT * FROM t WHERE ts <= '$session_end'")).toBe(true);
  });

  it('returns false when neither session var is present', () => {
    expect(hasSqlSessionVar('SELECT * FROM t WHERE x IN $gc.brush')).toBe(false);
  });

  it('returns true for both in the same SQL', () => {
    const sql =
      "SELECT * FROM t WHERE ts BETWEEN '$session_start' AND '$session_end'";
    expect(hasSqlSessionVar(sql)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run sessionVarRerun`
Expected: FAIL — `cellUtils` module does not exist.

- [ ] **Step 3: Create `cellUtils.ts` with `hasSqlSessionVar`**

First, check whether `CellView.tsx` has its own inline `hasSqlLiveVar` helper:

```bash
grep -n "hasSqlLiveVar" /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/components/cell/CellView.tsx | head -5
```

If `hasSqlLiveVar` is defined inline in `CellView.tsx`, extract it into a new `src/components/cell/cellUtils.ts` file alongside the new `hasSqlSessionVar`. If it is already in a separate file, add `hasSqlSessionVar` there instead.

Create `src/components/cell/cellUtils.ts`:

```ts
/** Returns true when the SQL contains any $alias.kind live-var reference
 *  that triggers a re-run on store change. */
export function hasSqlLiveVar(sql: string): boolean {
  return /\$!?[A-Za-z_][A-Za-z0-9_]*\.(brush|hover|zoom|selection|scroll)\b/.test(sql);
}

/** Returns true when the SQL contains $session_start or $session_end,
 *  indicating the cell must re-run when those workspace globals change. */
export function hasSqlSessionVar(sql: string): boolean {
  return /\$session_start\b|\$session_end\b/.test(sql);
}
```

- [ ] **Step 4: Run the test to confirm pass**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run sessionVarRerun`
Expected: PASS — all 4 cases.

- [ ] **Step 5: Update `CellView.tsx` to use the extracted helpers**

In `src/components/cell/CellView.tsx`:

a. Add the import:

```ts
import { hasSqlLiveVar, hasSqlSessionVar } from './cellUtils';
```

b. Find the existing inline `hasSqlLiveVar` derivation (search for `hasSqlLiveVar` in the file) and replace it with the imported function.

c. Compute a combined `hasDynamicVar` flag that gates re-runs on both live-var and session-var changes:

```ts
const hasDynamicVar = useMemo(() => {
  const sqlBlocks = cell.blocks.filter((b) => b.kind === 'sql');
  const sources = sqlBlocks.map((b) => b.source).join('\n');
  return hasSqlLiveVar(sources) || hasSqlSessionVar(sources);
}, [cell.blocks]);
```

d. Wherever `hasSqlLiveVar` was used to gate the re-run effect, replace it with `hasDynamicVar`.

- [ ] **Step 6: Run the full cell suite**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- --run cell`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/cell/cellUtils.ts src/components/cell/CellView.tsx \
        src/__tests__/cell/sessionVarRerun.test.ts
git commit -m "feat(cell): M-E4 re-run on \$session_start/\$session_end change"
```

---

### Task 5: Full suite + build check + smoke test

- [ ] **Step 1: Run the full test suite**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test`
Expected: all tests pass. Baseline ~2028; this plan adds ~25 new tests.

- [ ] **Step 2: TypeScript build**

Run: `cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run build`
Expected: no type errors.

- [ ] **Step 3: Smoke test**

`npm run dev` — open the notebook with a JFR file loaded.
1. The topbar shows a `⏱ 12:00 — 13:00` chip strip below the button row.
2. Clicking the `start:` chip expands a `datetime-local` input prepopulated with the current start.
3. Change the start time by 30 minutes and press Enter — the chip updates to the new time.
4. Press Escape while the picker is open — the chip reverts to the last committed value.
5. Add a SQL cell: `SELECT count(*) AS n FROM events WHERE ts >= '$session_start' AND ts <= '$session_end'`. Run it. The count reflects the 1-hour window.
6. Change the start chip to 2 hours ago — the cell re-runs automatically and the count increases.
7. Confirm no date chips appear when `hasNotebook=false` (welcome screen).

- [ ] **Step 4: Commit any smoke fixes**

```bash
git add -p
git commit -m "chore: smoke fixes for M-E4 session date pickers"
```

---

## Self-Review

**Spec coverage:**
- `$session_start` / `$session_end` stored in `liveVarStore` as ISO strings → Task 2 (initialised on mount) ✓
- Defaults: start = "now − 1h", end = "now" → Task 1 helpers ✓
- Shown in topbar as compact chips → Task 2 `SessionDateChip` ✓
- Clicking expands datetime picker → Task 2 ✓
- Used in SQL: `WHERE timestamp BETWEEN $session_start AND $session_end` → Task 3 injection ✓
- Re-runs dependent cells when changed → Task 4 ✓
- Compact chip format `⏱ HH:MM — HH:MM` → Task 2 JSX + Task 1 `compactLabel` ✓

**Placeholder scan:** No TBD patterns. Every test has concrete assertions; every implementation step shows full code.

**Type consistency:**
- `liveVarStore.set(varKey, iso)` — `VarValue = unknown`, so ISO string is valid.
- `hasSqlSessionVar` and `hasSqlLiveVar` are both `(sql: string) => boolean` — no mismatch.
- `effectiveVars` in `executeCell` is `Record<string, string> | undefined` — consistent with the existing `variables` parameter type.
- `SessionDateChip` props: `varKey: 'session_start' | 'session_end'` (union literal) — referenced as `liveVarStore.get(varKey)` which returns `VarValue | undefined`; narrowed with `typeof stored === 'string'` before use.

**Out of scope (deferred):**
- Persisting session dates to `localStorage` across page reloads — the workspace `persistence.ts` from M-F2 can do this later by storing `$$session_start` / `$$session_end`.
- Relative presets ("Last 15m", "Last 1h", "Today") — a follow-up UX task.
- Time-zone awareness — the `datetime-local` input uses local browser time; ISO conversion via `new Date(localValue).toISOString()` is correct for this phase.
```

---