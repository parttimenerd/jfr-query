# Live Coupling System ($! Variables) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `$!` live variable store (brush/hover values) and SQL substitution so that `WHERE startTime IN $!gc_overview.brush` is rewritten to a real `BETWEEN` clause before DuckDB execution.

**Architecture:** A singleton `LiveVarStore` class (extending `EventTarget`, mirroring `FindBarStore`) holds brush ranges and hover values keyed by alias string. A pure `substituteLiveVars` function rewrites `$!<alias>.<slot>` patterns in SQL text. `executeCell` gains an optional `liveVars` parameter that runs substitution before handing SQL to DuckDB. A `useLiveVarStore` hook wires the singleton into React via `useSyncExternalStore`.

**Tech Stack:** TypeScript 5.8, React 19.2 (`useSyncExternalStore`), Vitest 4.1.9 (`pool: forks`), no external dependencies added.

---

## File Map

| Path | Status | Responsibility |
|---|---|---|
| `src/services/liveVar/liveVarStore.ts` | Create | Singleton store: Map<string, LiveRangeValue\|LiveHoverValue> + EventTarget notifications |
| `src/services/liveVar/liveVarSubstitution.ts` | Create | Pure function: regex rewrite of `$!` patterns in SQL strings |
| `src/services/executor/cellExecutor.ts` | Modify | Accept optional `liveVars` param; run substitution before `client.query` |
| `src/hooks/useLiveVarStore.ts` | Create | React hook: `useSyncExternalStore` wired to the singleton |
| `src/__tests__/liveVar/liveVarStore.test.ts` | Create | Unit tests: get/set/subscribe/_reset |
| `src/__tests__/liveVar/liveVarSubstitution.test.ts` | Create | Unit tests: all substitution cases |
| `src/__tests__/liveVar/cellExecutor.liveVar.test.ts` | Create | Integration tests: executor with live vars |
| `src/__tests__/liveVar/useLiveVarStore.test.ts` | Create | Hook tests: re-render on store change |

---

### Task 1: Write failing tests for `liveVarStore`

**Files:**
- Create: `src/__tests__/liveVar/liveVarStore.test.ts`

- [ ] **Step 1.1: Write the failing test file**

```typescript
// src/__tests__/liveVar/liveVarStore.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { liveVarStore } from '../../services/liveVar/liveVarStore';
import type { LiveRangeValue, LiveHoverValue } from '../../services/liveVar/liveVarStore';

beforeEach(() => liveVarStore._reset());

describe('liveVarStore — brush', () => {
  it('getBrush returns null for unknown alias', () => {
    expect(liveVarStore.getBrush('unknown')).toBeNull();
  });

  it('setBrush then getBrush returns the stored range', () => {
    const range: LiveRangeValue = { lo: 100, hi: 200, column: 'startTime' };
    liveVarStore.setBrush('gc', range);
    expect(liveVarStore.getBrush('gc')).toEqual(range);
  });

  it('setBrush with null clears the range', () => {
    liveVarStore.setBrush('gc', { lo: 1, hi: 2, column: 'startTime' });
    liveVarStore.setBrush('gc', null);
    expect(liveVarStore.getBrush('gc')).toBeNull();
  });

  it('aliases are independent', () => {
    liveVarStore.setBrush('a', { lo: 1, hi: 2, column: 'x' });
    liveVarStore.setBrush('b', { lo: 10, hi: 20, column: 'y' });
    expect(liveVarStore.getBrush('a')?.lo).toBe(1);
    expect(liveVarStore.getBrush('b')?.lo).toBe(10);
  });
});

describe('liveVarStore — hover', () => {
  it('getHover returns null for unknown alias', () => {
    expect(liveVarStore.getHover('unknown')).toBeNull();
  });

  it('setHover then getHover returns stored value', () => {
    const hover: LiveHoverValue = { category: 'G1YoungGeneration', value: 42 };
    liveVarStore.setHover('gc', hover);
    expect(liveVarStore.getHover('gc')).toEqual(hover);
  });

  it('setHover with null clears the value', () => {
    liveVarStore.setHover('gc', { category: 'foo' });
    liveVarStore.setHover('gc', null);
    expect(liveVarStore.getHover('gc')).toBeNull();
  });

  it('hover and brush for same alias are stored independently', () => {
    liveVarStore.setBrush('gc', { lo: 1, hi: 2, column: 'startTime' });
    liveVarStore.setHover('gc', { category: 'G1' });
    expect(liveVarStore.getBrush('gc')).not.toBeNull();
    expect(liveVarStore.getHover('gc')).not.toBeNull();
  });
});

describe('liveVarStore — subscribe', () => {
  it('subscribe fires when setBrush is called', () => {
    const listener = vi.fn();
    const unsub = liveVarStore.subscribe(listener);
    liveVarStore.setBrush('gc', { lo: 0, hi: 1, column: 'startTime' });
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('subscribe fires when setHover is called', () => {
    const listener = vi.fn();
    const unsub = liveVarStore.subscribe(listener);
    liveVarStore.setHover('gc', { category: 'G1' });
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsub = liveVarStore.subscribe(listener);
    unsub();
    liveVarStore.setBrush('gc', { lo: 0, hi: 1, column: 'startTime' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('multiple listeners all notified', () => {
    const a = vi.fn();
    const b = vi.fn();
    const ua = liveVarStore.subscribe(a);
    const ub = liveVarStore.subscribe(b);
    liveVarStore.setBrush('gc', { lo: 0, hi: 1, column: 'x' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    ua(); ub();
  });
});

describe('liveVarStore — _reset', () => {
  it('_reset clears brush state', () => {
    liveVarStore.setBrush('gc', { lo: 0, hi: 1, column: 'x' });
    liveVarStore._reset();
    expect(liveVarStore.getBrush('gc')).toBeNull();
  });

  it('_reset clears hover state', () => {
    liveVarStore.setHover('gc', { category: 'G1' });
    liveVarStore._reset();
    expect(liveVarStore.getHover('gc')).toBeNull();
  });

  it('_reset does not fire listeners', () => {
    const listener = vi.fn();
    const unsub = liveVarStore.subscribe(listener);
    liveVarStore._reset();
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });
});
```

- [ ] **Step 1.2: Run the tests to verify they fail with "Cannot find module"**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npx vitest run src/__tests__/liveVar/liveVarStore.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../../services/liveVar/liveVarStore'`

---

### Task 2: Implement `liveVarStore`

**Files:**
- Create: `src/services/liveVar/liveVarStore.ts`

- [ ] **Step 2.1: Create the store**

```typescript
// src/services/liveVar/liveVarStore.ts

export type LiveRangeValue = { lo: number; hi: number; column: string } | null;
export type LiveHoverValue =
  | {
      axes?: Record<string, { column: string; value: unknown }>;
      value?: unknown;
      category?: string;
    }
  | null;

class LiveVarStore extends EventTarget {
  private _brush = new Map<string, LiveRangeValue>();
  private _hover = new Map<string, LiveHoverValue>();

  private _notify(): void {
    this.dispatchEvent(new Event('change'));
  }

  setBrush(alias: string, range: LiveRangeValue): void {
    this._brush.set(alias, range);
    this._notify();
  }

  getBrush(alias: string): LiveRangeValue {
    return this._brush.get(alias) ?? null;
  }

  setHover(alias: string, hover: LiveHoverValue): void {
    this._hover.set(alias, hover);
    this._notify();
  }

  getHover(alias: string): LiveHoverValue {
    return this._hover.get(alias) ?? null;
  }

  subscribe(listener: () => void): () => void {
    this.addEventListener('change', listener);
    return () => this.removeEventListener('change', listener);
  }

  /** Test helper — clears all state without firing listeners. */
  _reset(): void {
    this._brush.clear();
    this._hover.clear();
  }
}

export const liveVarStore = new LiveVarStore();
export type { LiveVarStore };
```

- [ ] **Step 2.2: Run the tests to verify they pass**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npx vitest run src/__tests__/liveVar/liveVarStore.test.ts 2>&1 | tail -20
```

Expected: All 14 tests PASS.

- [ ] **Step 2.3: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && git add src/services/liveVar/liveVarStore.ts src/__tests__/liveVar/liveVarStore.test.ts && git commit -m "feat(liveVar): add LiveVarStore singleton with brush/hover/subscribe/_reset"
```

---

### Task 3: Write failing tests for `liveVarSubstitution`

**Files:**
- Create: `src/__tests__/liveVar/liveVarSubstitution.test.ts`

- [ ] **Step 3.1: Write the failing test file**

```typescript
// src/__tests__/liveVar/liveVarSubstitution.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { substituteLiveVars } from '../../services/liveVar/liveVarSubstitution';
import { liveVarStore } from '../../services/liveVar/liveVarStore';

beforeEach(() => liveVarStore._reset());

describe('substituteLiveVars — no patterns', () => {
  it('returns SQL unchanged when no $! patterns present', () => {
    const sql = 'SELECT * FROM events WHERE startTime > 0';
    expect(substituteLiveVars(sql, liveVarStore)).toBe(sql);
  });

  it('returns empty string unchanged', () => {
    expect(substituteLiveVars('', liveVarStore)).toBe('');
  });
});

describe('substituteLiveVars — IN $!<alias>.brush with null range (tautology)', () => {
  it('replaces IN $!gc.brush with (1=1) when range is null', () => {
    const sql = 'SELECT * FROM events WHERE startTime IN $!gc.brush';
    const result = substituteLiveVars(sql, liveVarStore);
    expect(result).toBe('SELECT * FROM events WHERE startTime (1=1)');
  });

  it('replaces IN $!gc_overview.brush with (1=1) when range is null (underscore alias)', () => {
    const sql = 'SELECT * FROM events WHERE startTime IN $!gc_overview.brush';
    const result = substituteLiveVars(sql, liveVarStore);
    expect(result).toBe('SELECT * FROM events WHERE startTime (1=1)');
  });
});

describe('substituteLiveVars — IN $!<alias>.brush with real range', () => {
  it('replaces IN $!gc.brush with BETWEEN lo AND hi', () => {
    liveVarStore.setBrush('gc', { lo: 1000, hi: 2000, column: 'startTime' });
    const sql = 'SELECT * FROM events WHERE startTime IN $!gc.brush';
    const result = substituteLiveVars(sql, liveVarStore);
    expect(result).toBe('SELECT * FROM events WHERE startTime BETWEEN 1000 AND 2000');
  });

  it('preserves surrounding whitespace', () => {
    liveVarStore.setBrush('gc', { lo: 5, hi: 10, column: 'duration' });
    const sql = 'SELECT * FROM t WHERE x IN $!gc.brush AND y > 0';
    const result = substituteLiveVars(sql, liveVarStore);
    expect(result).toBe('SELECT * FROM t WHERE x BETWEEN 5 AND 10 AND y > 0');
  });

  it('handles floating-point lo/hi', () => {
    liveVarStore.setBrush('p', { lo: 1.5, hi: 9.75, column: 'value' });
    const sql = 'SELECT v FROM t WHERE v IN $!p.brush';
    const result = substituteLiveVars(sql, liveVarStore);
    expect(result).toBe('SELECT v FROM t WHERE v BETWEEN 1.5 AND 9.75');
  });
});

describe('substituteLiveVars — IN $!<alias>.brush.x explicit axis', () => {
  it('replaces IN $!gc.brush.x with BETWEEN lo AND hi', () => {
    liveVarStore.setBrush('gc', { lo: 100, hi: 200, column: 'startTime' });
    const sql = 'SELECT * FROM events WHERE startTime IN $!gc.brush.x';
    const result = substituteLiveVars(sql, liveVarStore);
    expect(result).toBe('SELECT * FROM events WHERE startTime BETWEEN 100 AND 200');
  });

  it('replaces IN $!gc.brush.y with BETWEEN lo AND hi', () => {
    liveVarStore.setBrush('gc', { lo: 0, hi: 50, column: 'duration' });
    const sql = 'SELECT * FROM events WHERE duration IN $!gc.brush.y';
    const result = substituteLiveVars(sql, liveVarStore);
    expect(result).toBe('SELECT * FROM events WHERE duration BETWEEN 0 AND 50');
  });

  it('replaces IN $!gc.brush.x with (1=1) when range null', () => {
    const sql = 'SELECT * FROM events WHERE startTime IN $!gc.brush.x';
    const result = substituteLiveVars(sql, liveVarStore);
    expect(result).toBe('SELECT * FROM events WHERE startTime (1=1)');
  });
});

describe('substituteLiveVars — multiple substitutions', () => {
  it('replaces multiple $! patterns in one SQL string', () => {
    liveVarStore.setBrush('gc', { lo: 100, hi: 200, column: 'startTime' });
    liveVarStore.setBrush('alloc', { lo: 0, hi: 50, column: 'size' });
    const sql =
      'SELECT * FROM gc WHERE startTime IN $!gc.brush ' +
      'UNION ALL ' +
      'SELECT * FROM alloc WHERE size IN $!alloc.brush';
    const result = substituteLiveVars(sql, liveVarStore);
    expect(result).toBe(
      'SELECT * FROM gc WHERE startTime BETWEEN 100 AND 200 ' +
        'UNION ALL ' +
        'SELECT * FROM alloc WHERE size BETWEEN 0 AND 50'
    );
  });

  it('handles mix of set and null brushes in same SQL', () => {
    liveVarStore.setBrush('gc', { lo: 10, hi: 20, column: 'startTime' });
    const sql = 'SELECT * FROM a WHERE t IN $!gc.brush AND s IN $!alloc.brush';
    const result = substituteLiveVars(sql, liveVarStore);
    expect(result).toBe('SELECT * FROM a WHERE t BETWEEN 10 AND 20 AND s (1=1)');
  });
});

describe('substituteLiveVars — hover category', () => {
  it("replaces = $!gc.hover.category with = 'value' when hover has category", () => {
    liveVarStore.setHover('gc', { category: 'G1YoungGeneration' });
    const sql = 'SELECT * FROM events WHERE type = $!gc.hover.category';
    const result = substituteLiveVars(sql, liveVarStore);
    expect(result).toBe("SELECT * FROM events WHERE type = 'G1YoungGeneration'");
  });

  it('replaces = $!gc.hover.category with = NULL when hover is null', () => {
    const sql = 'SELECT * FROM events WHERE type = $!gc.hover.category';
    const result = substituteLiveVars(sql, liveVarStore);
    expect(result).toBe('SELECT * FROM events WHERE type = NULL');
  });

  it('replaces = $!gc.hover.category with = NULL when hover has no category', () => {
    liveVarStore.setHover('gc', { value: 42 });
    const sql = 'SELECT * FROM events WHERE type = $!gc.hover.category';
    const result = substituteLiveVars(sql, liveVarStore);
    expect(result).toBe('SELECT * FROM events WHERE type = NULL');
  });

  it("single-quotes category value — escapes embedded single quotes", () => {
    liveVarStore.setHover('gc', { category: "it's fine" });
    const sql = 'SELECT * FROM events WHERE type = $!gc.hover.category';
    const result = substituteLiveVars(sql, liveVarStore);
    expect(result).toBe("SELECT * FROM events WHERE type = 'it''s fine'");
  });
});
```

- [ ] **Step 3.2: Run the tests to verify they fail**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npx vitest run src/__tests__/liveVar/liveVarSubstitution.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../../services/liveVar/liveVarSubstitution'`

---

### Task 4: Implement `liveVarSubstitution`

**Files:**
- Create: `src/services/liveVar/liveVarSubstitution.ts`

- [ ] **Step 4.1: Create the substitution module**

```typescript
// src/services/liveVar/liveVarSubstitution.ts
import type { LiveVarStore } from './liveVarStore';

const BRUSH_PATTERN =
  /IN\s+\$!([A-Za-z_][A-Za-z0-9_]*)\.brush(?:\.[xy])?/g;

const HOVER_CATEGORY_PATTERN =
  /=\s+\$!([A-Za-z_][A-Za-z0-9_]*)\.hover\.category/g;

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

export function substituteLiveVars(sql: string, store: LiveVarStore): string {
  let result = sql.replace(BRUSH_PATTERN, (_match: string, alias: string) => {
    const range = store.getBrush(alias);
    if (range === null) return '(1=1)';
    return `BETWEEN ${range.lo} AND ${range.hi}`;
  });

  result = result.replace(
    HOVER_CATEGORY_PATTERN,
    (_match: string, alias: string) => {
      const hover = store.getHover(alias);
      if (hover === null || hover.category === undefined) return '= NULL';
      return `= '${escapeSql(hover.category)}'`;
    }
  );

  return result;
}
```

- [ ] **Step 4.2: Run the tests to verify they pass**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npx vitest run src/__tests__/liveVar/liveVarSubstitution.test.ts 2>&1 | tail -20
```

Expected: All 18 tests PASS.

- [ ] **Step 4.3: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && git add src/services/liveVar/liveVarSubstitution.ts src/__tests__/liveVar/liveVarSubstitution.test.ts && git commit -m "feat(liveVar): add substituteLiveVars — rewrites \$! brush/hover patterns in SQL"
```

---

### Task 5: Write failing integration tests for `cellExecutor` with live vars

**Files:**
- Create: `src/__tests__/liveVar/cellExecutor.liveVar.test.ts`

- [ ] **Step 5.1: Write the failing test file**

```typescript
// src/__tests__/liveVar/cellExecutor.liveVar.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeCell } from '../../services/executor/cellExecutor';
import { liveVarStore } from '../../services/liveVar/liveVarStore';
import type { DuckDBClient } from '../../services/duckdb/client';
import type { Cell } from '../../services/parser/types';

function makeSqlCell(source: string, alias = 'c1'): Cell {
  return {
    displayIndex: 1,
    alias,
    frontmatter: {},
    blocks: [{ kind: 'sql', source }],
  };
}

function makeMockClient(impl?: Partial<DuckDBClient>): DuckDBClient {
  return {
    query: vi.fn().mockResolvedValue([]),
    registerFile: vi.fn(),
    shutdown: vi.fn(),
    ...impl,
  } as unknown as DuckDBClient;
}

beforeEach(() => liveVarStore._reset());

describe('executeCell — liveVars substitution', () => {
  it('passes SQL unchanged to DuckDB when no liveVars provided', async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    const client = makeMockClient({ query: queryFn });
    const sql = 'SELECT * FROM events WHERE t IN $!gc.brush';
    await executeCell(makeSqlCell(sql), client, new AbortController().signal);
    expect(queryFn).toHaveBeenCalledWith(sql, expect.any(AbortSignal));
  });

  it('substitutes brush pattern when liveVars provided and range is set', async () => {
    liveVarStore.setBrush('gc', { lo: 100, hi: 200, column: 'startTime' });
    const queryFn = vi.fn().mockResolvedValue([]);
    const client = makeMockClient({ query: queryFn });
    const sql = 'SELECT * FROM events WHERE startTime IN $!gc.brush';
    await executeCell(makeSqlCell(sql), client, new AbortController().signal, liveVarStore);
    expect(queryFn).toHaveBeenCalledWith(
      'SELECT * FROM events WHERE startTime BETWEEN 100 AND 200',
      expect.any(AbortSignal)
    );
  });

  it('substitutes with tautology when liveVars provided but brush is null', async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    const client = makeMockClient({ query: queryFn });
    const sql = 'SELECT * FROM events WHERE startTime IN $!gc.brush';
    await executeCell(makeSqlCell(sql), client, new AbortController().signal, liveVarStore);
    expect(queryFn).toHaveBeenCalledWith(
      'SELECT * FROM events WHERE startTime (1=1)',
      expect.any(AbortSignal)
    );
  });

  it('substitutes hover category when liveVars provided', async () => {
    liveVarStore.setHover('gc', { category: 'G1YoungGeneration' });
    const queryFn = vi.fn().mockResolvedValue([]);
    const client = makeMockClient({ query: queryFn });
    const sql = 'SELECT * FROM events WHERE type = $!gc.hover.category';
    await executeCell(makeSqlCell(sql), client, new AbortController().signal, liveVarStore);
    expect(queryFn).toHaveBeenCalledWith(
      "SELECT * FROM events WHERE type = 'G1YoungGeneration'",
      expect.any(AbortSignal)
    );
  });

  it('SQL without $! is unaffected when liveVars provided', async () => {
    const rows = [{ a: 1 }];
    const queryFn = vi.fn().mockResolvedValue(rows);
    const client = makeMockClient({ query: queryFn });
    const result = await executeCell(
      makeSqlCell('SELECT 1 AS a'),
      client,
      new AbortController().signal,
      liveVarStore
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.rows).toEqual(rows);
  });

  it('rows from DuckDB are forwarded correctly after substitution', async () => {
    liveVarStore.setBrush('gc', { lo: 0, hi: 9999, column: 'startTime' });
    const rows = [{ startTime: 500 }];
    const queryFn = vi.fn().mockResolvedValue(rows);
    const client = makeMockClient({ query: queryFn });
    const result = await executeCell(
      makeSqlCell('SELECT startTime FROM gc WHERE startTime IN $!gc.brush'),
      client,
      new AbortController().signal,
      liveVarStore
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.rows).toEqual(rows);
  });
});
```

- [ ] **Step 5.2: Run the tests to verify first test passes but substitution tests fail**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npx vitest run src/__tests__/liveVar/cellExecutor.liveVar.test.ts 2>&1 | tail -20
```

---

### Task 6: Wire substitution into `cellExecutor`

**Files:**
- Modify: `src/services/executor/cellExecutor.ts`

- [ ] **Step 6.1: Read the existing file first**

```bash
cat /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/executor/cellExecutor.ts
```

- [ ] **Step 6.2: Add the liveVars parameter**

Add two imports after the existing imports:
```typescript
import type { LiveVarStore } from '../liveVar/liveVarStore';
import { substituteLiveVars } from '../liveVar/liveVarSubstitution';
```

Change the `executeCell` signature from:
```typescript
export async function executeCell(
  cell: Cell,
  client: DuckDBClient,
  signal: AbortSignal
): Promise<ExecutionResult> {
```
to:
```typescript
export async function executeCell(
  cell: Cell,
  client: DuckDBClient,
  signal: AbortSignal,
  liveVars?: LiveVarStore
): Promise<ExecutionResult> {
```

Find the line:
```typescript
  const sqlSource = firstSql.source;
```
Replace it with:
```typescript
  const rawSql = firstSql.source;
  const sqlSource = liveVars !== undefined ? substituteLiveVars(rawSql, liveVars) : rawSql;
```

Also update the formatter parse-gate to use `rawSql` not `sqlSource` (so syntax errors are checked on raw SQL before substitution):
```typescript
  if (rawSql.trim().length === 0) {
  // and
  const { diagnostics } = formatSql(rawSql);
```

- [ ] **Step 6.3: Run the new integration tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npx vitest run src/__tests__/liveVar/cellExecutor.liveVar.test.ts 2>&1 | tail -20
```

Expected: All 6 tests PASS.

- [ ] **Step 6.4: Verify existing executor tests still pass**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npx vitest run src/__tests__/executor/ 2>&1 | tail -20
```

Expected: All existing tests PASS.

- [ ] **Step 6.5: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && git add src/services/executor/cellExecutor.ts src/__tests__/liveVar/cellExecutor.liveVar.test.ts && git commit -m "feat(executor): add optional liveVars param to executeCell for \$! substitution"
```

---

### Task 7: Write failing tests for `useLiveVarStore`

**Files:**
- Create: `src/__tests__/liveVar/useLiveVarStore.test.ts`

- [ ] **Step 7.1: Write the failing test file**

```typescript
// src/__tests__/liveVar/useLiveVarStore.test.ts
import { describe, it, expect, act, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLiveVarStore } from '../../hooks/useLiveVarStore';
import { liveVarStore } from '../../services/liveVar/liveVarStore';

beforeEach(() => liveVarStore._reset());

describe('useLiveVarStore', () => {
  it('returns the liveVarStore singleton', () => {
    const { result } = renderHook(() => useLiveVarStore());
    expect(result.current).toBe(liveVarStore);
  });

  it('re-renders when setBrush is called', async () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useLiveVarStore();
    });
    const initialCount = renderCount;
    await act(async () => {
      liveVarStore.setBrush('gc', { lo: 0, hi: 100, column: 'startTime' });
    });
    expect(renderCount).toBeGreaterThan(initialCount);
    expect(result.current.getBrush('gc')).toEqual({ lo: 0, hi: 100, column: 'startTime' });
  });

  it('re-renders when setHover is called', async () => {
    let renderCount = 0;
    renderHook(() => {
      renderCount += 1;
      return useLiveVarStore();
    });
    const initialCount = renderCount;
    await act(async () => {
      liveVarStore.setHover('gc', { category: 'G1' });
    });
    expect(renderCount).toBeGreaterThan(initialCount);
  });

  it('does not re-render after _reset (no notification)', async () => {
    let renderCount = 0;
    renderHook(() => {
      renderCount += 1;
      return useLiveVarStore();
    });
    const initialCount = renderCount;
    await act(async () => {
      liveVarStore._reset();
    });
    expect(renderCount).toBe(initialCount);
  });
});
```

- [ ] **Step 7.2: Run to verify failure**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npx vitest run src/__tests__/liveVar/useLiveVarStore.test.ts 2>&1 | tail -20
```

---

### Task 8: Implement `useLiveVarStore`

**Files:**
- Create: `src/hooks/useLiveVarStore.ts`

- [ ] **Step 8.1: Create the hook**

```typescript
// src/hooks/useLiveVarStore.ts
import { useSyncExternalStore } from 'react';
import { liveVarStore } from '../services/liveVar/liveVarStore';
import type { LiveVarStore } from '../services/liveVar/liveVarStore';

export function useLiveVarStore(): LiveVarStore {
  useSyncExternalStore(
    (onStoreChange) => liveVarStore.subscribe(onStoreChange),
    () => liveVarStore
  );
  return liveVarStore;
}
```

- [ ] **Step 8.2: Run the hook tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npx vitest run src/__tests__/liveVar/useLiveVarStore.test.ts 2>&1 | tail -20
```

Expected: All 4 tests PASS.

- [ ] **Step 8.3: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && git add src/hooks/useLiveVarStore.ts src/__tests__/liveVar/useLiveVarStore.test.ts && git commit -m "feat(hooks): add useLiveVarStore — useSyncExternalStore wrapper for live-var singleton"
```

---

### Task 9: Full regression check + TypeScript

- [ ] **Step 9.1: Run all liveVar tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npx vitest run src/__tests__/liveVar/ 2>&1 | tail -20
```

- [ ] **Step 9.2: Run the full test suite**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npx vitest run 2>&1 | tail -8
```

Expected: All tests PASS, 0 failures.

- [ ] **Step 9.3: TypeScript check**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npx tsc -b --noEmit 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 9.4: Commit any type fixes if needed, then mark milestone complete**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && git add -p && git commit -m "fix(liveVar): TypeScript and regression fixes from final check"
```
