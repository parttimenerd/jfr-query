# M-B3: Query Execution Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans.
> **Testing standard:** See docs/superpowers/TESTING_STANDARD.md — all 5 layers apply.

**Goal:** Wire real DuckDB-WASM query execution to the cell editor UI built in M-B2. Clicking the run button on a SQL cell must execute via DuckDB, display rows in a `ResultsTable` with sorting/typing, transition a status chip through `idle → running → done|error`, and support cancellation via `AbortController`. SQL parse errors from M-A2's `parseSql` are surfaced as diagnostics and never sent to DuckDB.

**Architecture:** A `DuckDBContext` React context owns the singleton `DuckDBClient` (created via `useRef` so the worker is instantiated once). A `useDB()` hook reads it and throws when used outside the provider. A pure async `cellExecutor.executeCell(cell, client, signal)` performs parse-gate → DuckDB query → timing. `CellView` consumes `useDB()`, manages local state for status/results/abort-controller, and renders a `ResultsTable` below the editor on success. `ResultsTable` is a controlled presentational component supporting click-to-sort headers, BigInt/Date display, and a 200-row DOM cap with a truncation banner.

**Tech Stack:** React 19.2, TypeScript 5.8, Vite 6.2, Tailwind v4 (CSS-first, `[data-theme="dark"]`), Vitest 4.1.9, @testing-library/react 16.3.0, @testing-library/user-event 14.6.1, @testing-library/jest-dom 6.6.3, Playwright 1.61.0, AxeBuilder from @axe-core/playwright

---

## Pre-resolved decisions

### DECISION 1: Context shape and singleton lifetime
The `DuckDBClient` instance lives in a `useRef` inside `DuckDBProvider` so the worker is created exactly once for the lifetime of the provider. The context value is the client (or `null` before mount). `useDB()` reads the context, throws `Error('useDB must be used within DuckDBProvider')` when `null`. Rationale: a `useRef` initializer guarantees lazy single instantiation without re-creating workers on re-render; `useState` lazy initializer would also work but `useRef` carries clearer intent for "this is a side-effecty handle, not state".

### DECISION 2: Parse-gate before DuckDB
`executeCell` calls `parseSql(sqlSource, emptyCatalog)` first. If `diagnostics.some(d => d.severity === 'error')`, it returns `{ error: 'SQL parse error: ' + firstError.message, durationMs: 0 }` WITHOUT touching the client. Rationale: avoids round-tripping malformed SQL through the worker (faster feedback, fewer worker error frames), matches M-A2's role as the structural gate. Empty catalog `{ tables: new Map() }` is used because schema-aware lints are out of scope for M-B3 — only parse-level errors gate.

### DECISION 3: AbortController ownership
`CellView` owns the `AbortController` in a `useRef<AbortController | null>(null)`. Run button creates a fresh controller, stores it in the ref, passes its signal to `executeCell`. Cancel button calls `abortControllerRef.current?.abort()`. Rationale: the executor must be pure (testable without React); the controller belongs to the UI layer because the cancel button is a UI affordance.

### DECISION 4: ExecutionResult discriminated union
```ts
type ExecutionResult =
  | { kind: 'ok'; rows: Record<string, unknown>[]; durationMs: number }
  | { kind: 'error'; error: string; durationMs: number };
```
Rationale: an explicit `kind` discriminant is more ergonomic than a `'error' in result` check and survives JSON round-trips cleanly if results are ever persisted.

### DECISION 5: Non-SQL block handling
`executeCell` throws `TypeError('cellExecutor only handles SQL blocks; got: ' + cell.kind)` for non-SQL cells. Rationale: this is a programmer error, not a user-facing error. The caller (`CellView`) only invokes `executeCell` for SQL cells, so a thrown TypeError signals a bug in the orchestrator.

### DECISION 6: ResultsTable DOM cap
Hard cap at 200 rows in the DOM. If `rows.length > 200`, slice to first 200 and render a banner: `Showing 200 of {rows.length} rows`. Rationale: keeps initial render under ~16ms even on slow devices; full virtualization is M-B5 scope. Sorting operates on the FULL `rows` array, then slices — so sorted views are correct even when truncated.

### DECISION 7: Sort cycle and stability
Header click cycles `none → asc → desc → none`. Comparison: BigInt and number compared numerically (coerce BigInt → Number for compare only — display preserves BigInt string); strings compared via `String.prototype.localeCompare`; `null`/`undefined` sort last in both directions. Sort is stable via index-tagging fallback. Rationale: matches user expectations from spreadsheets; explicit null-last avoids "where did my nulls go" confusion.

### DECISION 8: Status chip glyphs and copy
- `idle`: `▣ idle`
- `running`: `⟳ running…`
- `done`: `✓ {rowCount} rows · {durationMs}ms`
- `error`: `✗ {message.slice(0, 60)}` (truncate to 60 chars to avoid chip blowing up the cell header)
Status chip has `role="status"` and `aria-live="polite"` so screen readers announce transitions without interrupting. Rationale: live regions are the standard pattern for async status; polite vs assertive because query completion is not urgent enough to interrupt.

---

## Steps

### Step 1 — Create DuckDBContext and useDB hook

- [ ] **1.1** Create `src/context/DuckDBContext.tsx` with the following exact contents:

```tsx
import * as React from 'react';
import { DuckDBClient } from '../services/duckdb/client';

const DuckDBCtx = React.createContext<DuckDBClient | null>(null);

export interface DuckDBProviderProps {
  children: React.ReactNode;
  /** Test seam: inject a pre-built client (e.g. mock). When omitted, a real client is constructed. */
  client?: DuckDBClient;
}

export function DuckDBProvider({ children, client }: DuckDBProviderProps): React.JSX.Element {
  const ref = React.useRef<DuckDBClient | null>(null);
  if (ref.current === null) {
    ref.current = client ?? new DuckDBClient(new URL('../services/duckdb/worker.ts', import.meta.url));
  }
  return <DuckDBCtx.Provider value={ref.current}>{children}</DuckDBCtx.Provider>;
}

export function useDB(): DuckDBClient {
  const ctx = React.useContext(DuckDBCtx);
  if (ctx === null) {
    throw new Error('useDB must be used within DuckDBProvider');
  }
  return ctx;
}

/** Test-only export so unit tests can render a provider with a null context (impossible via the public API). */
export const __DuckDBCtx = DuckDBCtx;
```

- [ ] **1.2** Create `src/hooks/useDB.ts` (thin re-export):

```ts
export { useDB } from '../context/DuckDBContext';
```

- [ ] **1.3** Update `src/context/index.ts` — add exports. If file does not exist, create it:

```ts
export { DuckDBProvider, useDB } from './DuckDBContext';
export type { DuckDBProviderProps } from './DuckDBContext';
```

- [ ] **1.4** Verify the file compiles by running:

```bash
npx tsc --noEmit
```

Expected: no new TypeScript errors. If `src/services/duckdb/client.ts` exports `DuckDBClient` as a class, the constructor signature must accept a `URL`. If it does not, STOP and report — do not modify the client (it is stable per the constraints).

---

### Step 2 — Write unit tests for DuckDBContext (Red phase)

- [ ] **2.1** Create `src/__tests__/context/DuckDBContext.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import * as React from 'react';
import { DuckDBProvider, useDB } from '../../context/DuckDBContext';
import { DuckDBClient } from '../../services/duckdb/client';

vi.mock('../../services/duckdb/client', () => {
  return {
    DuckDBClient: vi.fn().mockImplementation(() => ({
      query: vi.fn().mockResolvedValue([]),
      registerFile: vi.fn(),
      dropFile: vi.fn(),
      describe: vi.fn(),
    })),
  };
});

describe('DuckDBContext', () => {
  it('useDB inside provider returns the client instance', () => {
    const mockClient = { query: vi.fn(), registerFile: vi.fn(), dropFile: vi.fn(), describe: vi.fn() } as unknown as DuckDBClient;
    const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
      <DuckDBProvider client={mockClient}>{children}</DuckDBProvider>
    );
    const { result } = renderHook(() => useDB(), { wrapper });
    expect(result.current).toBe(mockClient);
  });

  it('useDB outside provider throws', () => {
    expect(() => renderHook(() => useDB())).toThrow(/useDB must be used within DuckDBProvider/);
  });

  it('DuckDBProvider renders children', () => {
    const mockClient = { query: vi.fn() } as unknown as DuckDBClient;
    const { getByText } = render(
      <DuckDBProvider client={mockClient}>
        <span>hello</span>
      </DuckDBProvider>,
    );
    expect(getByText('hello')).toBeInTheDocument();
  });

  it('DuckDBProvider creates a real client lazily when none injected', () => {
    render(
      <DuckDBProvider>
        <span>x</span>
      </DuckDBProvider>,
    );
    expect(DuckDBClient).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **2.2** Run the tests — they must PASS (the file from Step 1 already exists). If any fail, fix the source. Command:

```bash
npx vitest run src/__tests__/context/DuckDBContext.test.tsx
```

---

### Step 3 — Define ExecutionResult type and Cell type alignment

- [ ] **3.1** Inspect `src/types/cell.ts` (or wherever `Cell` is defined — likely from M-A1). Confirm the discriminator is `kind: 'sql' | 'plot' | 'prose'` and there is a `sqlSource: string` field on SQL cells. If the field is named differently (e.g. `source`), use the actual name throughout this plan — note the deviation in the commit message.

- [ ] **3.2** Create `src/services/executor/types.ts`:

```ts
export type ExecutionResult =
  | { kind: 'ok'; rows: Record<string, unknown>[]; durationMs: number }
  | { kind: 'error'; error: string; durationMs: number };
```

---

### Step 4 — Write unit tests for cellExecutor (Red phase)

- [ ] **4.1** Create `src/__tests__/executor/cellExecutor.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeCell } from '../../services/executor/cellExecutor';
import type { DuckDBClient } from '../../services/duckdb/client';
import type { Cell } from '../../types/cell';

function makeSqlCell(sqlSource: string, id = 'c1'): Cell {
  // Cell shape from M-A1 — adjust field names if the actual type differs.
  return {
    kind: 'sql',
    id,
    sqlSource,
    name: undefined,
  } as unknown as Cell;
}

function makeMockClient(impl?: Partial<DuckDBClient>): DuckDBClient {
  return {
    query: vi.fn().mockResolvedValue([]),
    registerFile: vi.fn(),
    dropFile: vi.fn(),
    describe: vi.fn(),
    ...impl,
  } as unknown as DuckDBClient;
}

describe('executeCell', () => {
  let signal: AbortSignal;
  beforeEach(() => {
    signal = new AbortController().signal;
  });

  it('returns rows array for valid SQL', async () => {
    const rows = [{ a: 1 }, { a: 2 }];
    const client = makeMockClient({ query: vi.fn().mockResolvedValue(rows) });
    const result = await executeCell(makeSqlCell('SELECT 1 AS a'), client, signal);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.rows).toEqual(rows);
  });

  it('records durationMs as a non-negative finite number', async () => {
    const client = makeMockClient({ query: vi.fn().mockResolvedValue([]) });
    const result = await executeCell(makeSqlCell('SELECT 1'), client, signal);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.durationMs)).toBe(true);
  });

  it('SQL parse error returns error result without calling client.query', async () => {
    const queryFn = vi.fn();
    const client = makeMockClient({ query: queryFn });
    const result = await executeCell(makeSqlCell('SELEKT ***'), client, signal);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error).toMatch(/SQL parse error/);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('AbortSignal abort rejects correctly when client throws DOMException', async () => {
    const ac = new AbortController();
    const client = makeMockClient({
      query: vi.fn().mockImplementation(() => {
        ac.abort();
        return Promise.reject(new DOMException('aborted', 'AbortError'));
      }),
    });
    const result = await executeCell(makeSqlCell('SELECT 1'), client, ac.signal);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error).toMatch(/abort/i);
  });

  it('throws TypeError on non-SQL block (plot)', async () => {
    const cell = { kind: 'plot', id: 'p1' } as unknown as Cell;
    await expect(executeCell(cell, makeMockClient(), signal)).rejects.toThrow(TypeError);
  });

  it('throws TypeError on non-SQL block (prose)', async () => {
    const cell = { kind: 'prose', id: 'm1' } as unknown as Cell;
    await expect(executeCell(cell, makeMockClient(), signal)).rejects.toThrow(TypeError);
  });

  it('empty result set returns empty rows array', async () => {
    const client = makeMockClient({ query: vi.fn().mockResolvedValue([]) });
    const result = await executeCell(makeSqlCell('SELECT 1 WHERE FALSE'), client, signal);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.rows).toEqual([]);
  });

  it('non-abort client error returns error result with message', async () => {
    const client = makeMockClient({ query: vi.fn().mockRejectedValue(new Error('table x does not exist')) });
    const result = await executeCell(makeSqlCell('SELECT * FROM x'), client, signal);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error).toMatch(/table x does not exist/);
  });

  it('multiple columns preserved in row order', async () => {
    const rows = [{ a: 1, b: 2, c: 3 }];
    const client = makeMockClient({ query: vi.fn().mockResolvedValue(rows) });
    const result = await executeCell(makeSqlCell('SELECT a, b, c FROM t'), client, signal);
    if (result.kind === 'ok') {
      expect(Object.keys(result.rows[0])).toEqual(['a', 'b', 'c']);
    }
  });

  it('BigInt values preserved in rows', async () => {
    const rows = [{ big: 9007199254740993n }];
    const client = makeMockClient({ query: vi.fn().mockResolvedValue(rows) });
    const result = await executeCell(makeSqlCell('SELECT 1::BIGINT AS big'), client, signal);
    if (result.kind === 'ok') {
      expect(typeof result.rows[0].big).toBe('bigint');
    }
  });

  it('null values in rows preserved', async () => {
    const rows = [{ a: null }, { a: 1 }];
    const client = makeMockClient({ query: vi.fn().mockResolvedValue(rows) });
    const result = await executeCell(makeSqlCell('SELECT a FROM t'), client, signal);
    if (result.kind === 'ok') expect(result.rows[0].a).toBeNull();
  });

  it('empty SQL is treated as parse error (no client call)', async () => {
    const queryFn = vi.fn();
    const client = makeMockClient({ query: queryFn });
    const result = await executeCell(makeSqlCell(''), client, signal);
    expect(result.kind).toBe('error');
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('whitespace-only SQL is treated as parse error (no client call)', async () => {
    const queryFn = vi.fn();
    const client = makeMockClient({ query: queryFn });
    const result = await executeCell(makeSqlCell('   \n\t  '), client, signal);
    expect(result.kind).toBe('error');
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('very long SQL (10k chars) still executes', async () => {
    const longSql = 'SELECT 1' + ' /* comment */'.repeat(800);
    const client = makeMockClient({ query: vi.fn().mockResolvedValue([{ x: 1 }]) });
    const result = await executeCell(makeSqlCell(longSql), client, signal);
    expect(result.kind).toBe('ok');
  });

  it('passes signal through to client.query', async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    const client = makeMockClient({ query: queryFn });
    await executeCell(makeSqlCell('SELECT 1'), client, signal);
    expect(queryFn).toHaveBeenCalledWith(expect.any(String), signal);
  });

  it('error result still records durationMs', async () => {
    const client = makeMockClient({ query: vi.fn().mockRejectedValue(new Error('boom')) });
    const result = await executeCell(makeSqlCell('SELECT 1'), client, signal);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **4.2** Run the tests — all must FAIL (file does not exist yet):

```bash
npx vitest run src/__tests__/executor/cellExecutor.test.ts
```

Expected: 16 failures, all citing missing module `cellExecutor`.

---

### Step 5 — Implement cellExecutor (Green phase)

- [ ] **5.1** Create `src/services/executor/cellExecutor.ts`:

```ts
import { parseSql } from '../../parsers/sql';
import type { DuckDBClient } from '../duckdb/client';
import type { Cell } from '../../types/cell';
import type { ExecutionResult } from './types';

const EMPTY_CATALOG = { tables: new Map<string, unknown>() };

export async function executeCell(
  cell: Cell,
  client: DuckDBClient,
  signal: AbortSignal,
): Promise<ExecutionResult> {
  if (cell.kind !== 'sql') {
    throw new TypeError(`cellExecutor only handles SQL blocks; got: ${cell.kind}`);
  }

  const start = performance.now();
  const sqlSource = (cell as { sqlSource: string }).sqlSource ?? '';

  // Parse-gate: never send malformed SQL to DuckDB.
  if (sqlSource.trim().length === 0) {
    return { kind: 'error', error: 'SQL parse error: empty statement', durationMs: performance.now() - start };
  }

  const parse = parseSql(sqlSource, EMPTY_CATALOG as never);
  const firstError = parse.diagnostics.find((d) => d.severity === 'error');
  if (firstError !== undefined) {
    return {
      kind: 'error',
      error: `SQL parse error: ${firstError.message}`,
      durationMs: performance.now() - start,
    };
  }

  try {
    const rows = await client.query(sqlSource, signal);
    return { kind: 'ok', rows, durationMs: performance.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'error', error: message, durationMs: performance.now() - start };
  }
}

export type { ExecutionResult } from './types';
```

- [ ] **5.2** Re-run tests:

```bash
npx vitest run src/__tests__/executor/cellExecutor.test.ts
```

Expected: 16 pass. If `parseSql` signature differs from `(sql: string, catalog: Catalog) => { diagnostics: Diagnostic[] }`, adapt the call site to match the actual M-A2 export shape. Do NOT modify `parseSql` itself.

- [ ] **5.3** If `client.query` does not accept a signal as second arg, drop the second arg and rely on `signal.aborted` polling around the await (less ideal but acceptable):

```ts
if (signal.aborted) {
  return { kind: 'error', error: 'aborted', durationMs: performance.now() - start };
}
const rows = await client.query(sqlSource);
```

Verify against `src/services/duckdb/client.ts` before committing.

---

### Step 6 — Write unit tests for ResultsTable (Red phase)

- [ ] **6.1** Create `src/__tests__/results/ResultsTable.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResultsTable } from '../../components/results/ResultsTable';

describe('ResultsTable', () => {
  it('renders "No results" when rows empty', () => {
    render(<ResultsTable rows={[]} columns={['a']} />);
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });

  it('renders a column header for each column', () => {
    render(<ResultsTable rows={[{ a: 1, b: 2 }]} columns={['a', 'b']} />);
    expect(screen.getByTestId('col-header-a')).toBeInTheDocument();
    expect(screen.getByTestId('col-header-b')).toBeInTheDocument();
  });

  it('renders the correct row count', () => {
    const rows = [{ a: 1 }, { a: 2 }, { a: 3 }];
    render(<ResultsTable rows={rows} columns={['a']} />);
    expect(screen.getAllByTestId('results-table-row')).toHaveLength(3);
  });

  it('shows truncation banner when rows > 200', () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ a: i }));
    render(<ResultsTable rows={rows} columns={['a']} />);
    const banner = screen.getByTestId('results-truncation-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/200 of 250/);
    expect(screen.getAllByTestId('results-table-row')).toHaveLength(200);
  });

  it('does not show banner when rows ≤ 200', () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ a: i }));
    render(<ResultsTable rows={rows} columns={['a']} />);
    expect(screen.queryByTestId('results-truncation-banner')).toBeNull();
  });

  it('clicking header once sorts ascending', async () => {
    const user = userEvent.setup();
    const rows = [{ a: 3 }, { a: 1 }, { a: 2 }];
    render(<ResultsTable rows={rows} columns={['a']} />);
    await user.click(screen.getByTestId('col-header-a'));
    const tds = screen.getAllByTestId('results-table-row').map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(tds).toEqual(['1', '2', '3']);
    expect(screen.getByTestId('col-header-a')).toHaveAttribute('aria-sort', 'ascending');
  });

  it('clicking header twice sorts descending', async () => {
    const user = userEvent.setup();
    const rows = [{ a: 1 }, { a: 3 }, { a: 2 }];
    render(<ResultsTable rows={rows} columns={['a']} />);
    await user.click(screen.getByTestId('col-header-a'));
    await user.click(screen.getByTestId('col-header-a'));
    const tds = screen.getAllByTestId('results-table-row').map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(tds).toEqual(['3', '2', '1']);
    expect(screen.getByTestId('col-header-a')).toHaveAttribute('aria-sort', 'descending');
  });

  it('clicking header three times removes sort', async () => {
    const user = userEvent.setup();
    const rows = [{ a: 3 }, { a: 1 }, { a: 2 }];
    render(<ResultsTable rows={rows} columns={['a']} />);
    const header = screen.getByTestId('col-header-a');
    await user.click(header);
    await user.click(header);
    await user.click(header);
    const tds = screen.getAllByTestId('results-table-row').map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(tds).toEqual(['3', '1', '2']);
    expect(header).toHaveAttribute('aria-sort', 'none');
  });

  it('aria-sort defaults to "none"', () => {
    render(<ResultsTable rows={[{ a: 1 }]} columns={['a']} />);
    expect(screen.getByTestId('col-header-a')).toHaveAttribute('aria-sort', 'none');
  });

  it('BigInt values displayed as string with title attribute', () => {
    const rows = [{ big: 9007199254740993n }];
    render(<ResultsTable rows={rows} columns={['big']} />);
    const cell = screen.getAllByRole('cell')[0];
    expect(cell.textContent).toBe('9007199254740993');
    expect(cell).toHaveAttribute('title', '9007199254740993');
  });

  it('Date values displayed as "YYYY-MM-DD HH:MM:SS"', () => {
    const d = new Date('2026-06-23T15:04:05.000Z');
    render(<ResultsTable rows={[{ when: d }]} columns={['when']} />);
    const cell = screen.getAllByRole('cell')[0];
    expect(cell.textContent).toBe('2026-06-23 15:04:05');
  });

  it('rows have data-testid="results-table-row"', () => {
    render(<ResultsTable rows={[{ a: 1 }, { a: 2 }]} columns={['a']} />);
    expect(screen.getAllByTestId('results-table-row')).toHaveLength(2);
  });

  it('region role and aria-label set on container', () => {
    render(<ResultsTable rows={[{ a: 1 }]} columns={['a']} />);
    const region = screen.getByRole('region', { name: /query results/i });
    expect(region).toHaveAttribute('data-testid', 'results-table');
  });

  it('null values render as empty (no crash)', () => {
    render(<ResultsTable rows={[{ a: null }]} columns={['a']} />);
    const cell = screen.getAllByRole('cell')[0];
    expect(cell.textContent).toBe('');
  });
});
```

- [ ] **6.2** Run — all must fail:

```bash
npx vitest run src/__tests__/results/ResultsTable.test.tsx
```

Expected: 14 failures from missing module.

---

### Step 7 — Implement ResultsTable (Green phase)

- [ ] **7.1** Create `src/components/results/ResultsTable.tsx`:

```tsx
import * as React from 'react';

const MAX_ROWS = 200;

export interface ResultsTableProps {
  rows: Record<string, unknown>[];
  columns: string[];
}

type SortState = { col: string; dir: 'asc' | 'desc' } | null;

function formatCell(value: unknown): { display: string; title?: string } {
  if (value === null || value === undefined) return { display: '' };
  if (typeof value === 'bigint') {
    const s = value.toString();
    return { display: s, title: s };
  }
  if (value instanceof Date) {
    return { display: value.toISOString().replace('T', ' ').slice(0, 19) };
  }
  if (typeof value === 'object') {
    try {
      return { display: JSON.stringify(value) };
    } catch {
      return { display: String(value) };
    }
  }
  return { display: String(value) };
}

function compareValues(a: unknown, b: unknown): number {
  // null/undefined sort last
  const aNil = a === null || a === undefined;
  const bNil = b === null || b === undefined;
  if (aNil && bNil) return 0;
  if (aNil) return 1;
  if (bNil) return -1;
  if (typeof a === 'bigint' || typeof b === 'bigint') {
    const an = typeof a === 'bigint' ? Number(a) : Number(a as number);
    const bn = typeof b === 'bigint' ? Number(b) : Number(b as number);
    return an - bn;
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b));
}

function ariaSortOf(sort: SortState, col: string): 'ascending' | 'descending' | 'none' {
  if (sort === null || sort.col !== col) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
}

export function ResultsTable({ rows, columns }: ResultsTableProps): React.JSX.Element {
  const [sort, setSort] = React.useState<SortState>(null);

  const cycleSort = React.useCallback((col: string) => {
    setSort((prev) => {
      if (prev === null || prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      return null;
    });
  }, []);

  const sortedRows = React.useMemo(() => {
    if (sort === null) return rows;
    const tagged = rows.map((r, i) => ({ r, i }));
    tagged.sort((x, y) => {
      const c = compareValues(x.r[sort.col], y.r[sort.col]);
      if (c !== 0) return sort.dir === 'asc' ? c : -c;
      return x.i - y.i; // stable
    });
    return tagged.map((t) => t.r);
  }, [rows, sort]);

  const displayed = sortedRows.slice(0, MAX_ROWS);
  const truncated = rows.length > MAX_ROWS;

  if (rows.length === 0) {
    return (
      <div data-testid="results-table" role="region" aria-label="Query results" className="text-sm opacity-60 p-2">
        No results
      </div>
    );
  }

  return (
    <div
      data-testid="results-table"
      role="region"
      aria-label="Query results"
      className="overflow-auto max-h-96 border border-[var(--border)] rounded"
    >
      {truncated && (
        <div
          data-testid="results-truncation-banner"
          className="px-2 py-1 text-xs bg-[var(--surface-2)] text-[var(--fg-2)] border-b border-[var(--border)]"
        >
          Showing 200 of {rows.length} rows
        </div>
      )}
      <table role="table" className="w-full text-sm">
        <thead className="sticky top-0 bg-[var(--surface-1)]">
          <tr>
            {columns.map((col) => {
              const sortDir = ariaSortOf(sort, col);
              const indicator = sortDir === 'ascending' ? ' ▲' : sortDir === 'descending' ? ' ▼' : '';
              return (
                <th
                  key={col}
                  scope="col"
                  aria-sort={sortDir}
                  data-testid={`col-header-${col}`}
                  onClick={() => cycleSort(col)}
                  className="text-left px-2 py-1 cursor-pointer select-none border-b border-[var(--border)]"
                >
                  {col}
                  {indicator}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {displayed.map((row, i) => (
            <tr key={i} data-testid="results-table-row" className="border-b border-[var(--border)]/40">
              {columns.map((col) => {
                const { display, title } = formatCell(row[col]);
                return (
                  <td key={col} title={title} className="px-2 py-1 font-mono">
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **7.2** Re-run tests:

```bash
npx vitest run src/__tests__/results/ResultsTable.test.tsx
```

Expected: 14 pass. If the "null values render as empty" test sees `null` text, the formatter is wrong — verify `formatCell` returns `{ display: '' }` for null.

---

### Step 8 — Wire CellView to executor

- [ ] **8.1** Read the current `src/components/cell/CellView.tsx` so the edits below preserve all M-B2 markup (CM editor, name chip, sigil rendering). Then modify it to:

1. Import `useDB`, `executeCell`, `ResultsTable`, `ExecutionResult`.
2. Add state: `status`, `result`, and an `abortControllerRef`.
3. Replace the stub run handler with the real one.
4. Render a cancel button when `status === 'running'`.
5. Render `<ResultsTable>` when `result?.kind === 'ok'` and `status === 'done'`.
6. Update the status chip text by state.

Apply the following diff/edit pattern. **Add these imports near the top:**

```tsx
import { useDB } from '../../hooks/useDB';
import { executeCell, type ExecutionResult } from '../../services/executor/cellExecutor';
import { ResultsTable } from '../results/ResultsTable';
```

**Inside the CellView function body, add:**

```tsx
const client = useDB();
const [status, setStatus] = React.useState<'idle' | 'running' | 'error' | 'done'>('idle');
const [result, setResult] = React.useState<ExecutionResult | null>(null);
const abortRef = React.useRef<AbortController | null>(null);

const onRun = React.useCallback(async () => {
  if (cell.kind !== 'sql') return;
  abortRef.current?.abort();
  const ac = new AbortController();
  abortRef.current = ac;
  setStatus('running');
  setResult(null);
  const r = await executeCell(cell, client, ac.signal);
  if (ac.signal.aborted) {
    setStatus('error');
    setResult({ kind: 'error', error: 'cancelled', durationMs: r.durationMs });
    return;
  }
  setResult(r);
  setStatus(r.kind === 'ok' ? 'done' : 'error');
}, [cell, client]);

const onCancel = React.useCallback(() => {
  abortRef.current?.abort();
}, []);

const statusText = (() => {
  if (status === 'idle') return '▣ idle';
  if (status === 'running') return '⟳ running…';
  if (status === 'done' && result?.kind === 'ok') {
    return `✓ ${result.rows.length} rows · ${Math.round(result.durationMs)}ms`;
  }
  if (status === 'error' && result?.kind === 'error') {
    return `✗ ${result.error.slice(0, 60)}`;
  }
  return '';
})();

const columns = result?.kind === 'ok' && result.rows.length > 0 ? Object.keys(result.rows[0]) : [];
```

**Replace the run button JSX to call `onRun`:**

```tsx
<button
  type="button"
  data-testid="cell-run-button"
  onClick={onRun}
  disabled={status === 'running'}
  aria-label="Run cell"
  className="..."
>
  ▶ Run
</button>
{status === 'running' && (
  <button
    type="button"
    data-testid="cell-cancel-button"
    onClick={onCancel}
    aria-label="Cancel query"
    className="..."
  >
    ✕ Cancel
  </button>
)}
```

**Replace the status chip JSX:**

```tsx
<span
  data-testid="cell-status"
  role="status"
  aria-live="polite"
  className="text-xs font-mono opacity-80"
>
  {statusText}
</span>
```

**Below the editor, conditionally render the results table:**

```tsx
{status === 'done' && result?.kind === 'ok' && (
  <ResultsTable rows={result.rows} columns={columns} />
)}
```

- [ ] **8.2** Run `npx tsc --noEmit` and resolve any type errors. Common pitfalls:
  - `Cell.kind` narrowing — ensure the `cell.kind !== 'sql'` guard is the FIRST line in `onRun`.
  - React 19: `import type { JSX } from 'react'` if you use `JSX.Element` in annotations.

---

### Step 9 — Add DuckDBProvider to App

- [ ] **9.1** Read `src/App.tsx` and identify the outermost JSX node. Wrap it in `<DuckDBProvider>`:

```tsx
import { DuckDBProvider } from './context/DuckDBContext';

export function App(): React.JSX.Element {
  return (
    <DuckDBProvider>
      {/* existing app content */}
    </DuckDBProvider>
  );
}
```

- [ ] **9.2** Update `src/components/notebook/exampleNotebook.ts`. Read the current file first. Then add two new SQL cells AFTER the existing demo cell:

```ts
// Cell 2: create the events table
{
  kind: 'sql',
  id: 'cell-events-create',
  name: 'events',
  sqlSource: `-- @events
CREATE TABLE IF NOT EXISTS events AS
SELECT 1 AS id, 'GC' AS type, 100 AS duration_ms
UNION ALL SELECT 2, 'JIT', 200
UNION ALL SELECT 3, 'GC', 150;`,
},
// Cell 3: query the events table
{
  kind: 'sql',
  id: 'cell-events-query',
  sqlSource: `SELECT * FROM events ORDER BY duration_ms DESC`,
},
```

Adjust field names (`sqlSource` vs `source`, etc.) to match the actual M-A1 cell shape. Preserve the existing first cell so the `$var` demo still works.

---

### Step 10 — E2E tests for query execution

- [ ] **10.1** Open `tests/e2e/04-cross-cell.spec.ts`. Locate the `test.fixme` blocks. Replace four of them with the following live tests:

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('run button executes SQL and shows results table', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-example').click();
  const runButtons = page.getByTestId('cell-run-button');
  // First click the table-create cell, then the query cell.
  await runButtons.nth(1).click();
  await expect(page.getByTestId('cell-status').nth(1)).toHaveText(/rows/, { timeout: 10000 });
  await runButtons.nth(2).click();
  await expect(page.getByTestId('results-table')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('results-table-row')).toHaveCount(3);
});

test('status chip transitions idle → done', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-example').click();
  const status = page.getByTestId('cell-status').nth(2);
  await expect(status).toHaveText(/idle/);
  await page.getByTestId('cell-run-button').nth(1).click();
  await expect(page.getByTestId('cell-status').nth(1)).toHaveText(/rows/, { timeout: 10000 });
  await page.getByTestId('cell-run-button').nth(2).click();
  await expect(status).toHaveText(/rows/, { timeout: 10000 });
});

test('SQL error shows error status, no results table', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-example').click();
  // Replace the first cell's SQL with malformed content via CM6 keyboard input.
  const editor = page.locator('[data-testid="cell-editor"]').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type('SELEKT *** FROM');
  await page.getByTestId('cell-run-button').first().click();
  await expect(page.getByTestId('cell-status').first()).toHaveText(/✗/, { timeout: 5000 });
  // Results table should NOT be rendered under this cell.
  const firstCell = page.getByTestId('cell-view').first();
  await expect(firstCell.getByTestId('results-table')).toHaveCount(0);
});

test('cancel button aborts long query', async ({ page }) => {
  test.fixme(true, 'requires injectable slow query fixture; planned for M-B5');
});

test('a11y sweep after results render', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-example').click();
  await page.getByTestId('cell-run-button').nth(1).click();
  await expect(page.getByTestId('cell-status').nth(1)).toHaveText(/rows/, { timeout: 10000 });
  await page.getByTestId('cell-run-button').nth(2).click();
  await expect(page.getByTestId('results-table')).toBeVisible({ timeout: 10000 });
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'critical')).toEqual([]);
});
```

- [ ] **10.2** Confirm `@axe-core/playwright` is installed (`grep axe-core package.json`). If not, install:

```bash
npm i -D @axe-core/playwright
```

---

### Step 11 — Visual regression entries (fixme)

- [ ] **11.1** Append to `tests/visual/plots.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.fixme('results table with 3 rows screenshot', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-example').click();
  await page.getByTestId('cell-run-button').nth(1).click();
  await page.getByTestId('cell-run-button').nth(2).click();
  await expect(page.getByTestId('results-table')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('results-table')).toHaveScreenshot('results-table-3rows.png');
});

test.fixme('status chip in done state', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-example').click();
  await page.getByTestId('cell-run-button').nth(1).click();
  await expect(page.getByTestId('cell-status').nth(1)).toHaveText(/rows/, { timeout: 10000 });
  await expect(page.getByTestId('cell-status').nth(1)).toHaveScreenshot('status-done.png');
});
```

Leave these as `.fixme` until M-B4 visual baseline pass.

---

### Step 12 — Perf bench

- [ ] **12.1** Create `src/__tests__/executor/cellExecutor.bench.ts`:

```ts
import { bench } from 'vitest';
import { executeCell } from '../../services/executor/cellExecutor';
import type { DuckDBClient } from '../../services/duckdb/client';
import type { Cell } from '../../types/cell';

const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i, val: i * 2 }));
const mockClient = { query: () => Promise.resolve(rows) } as unknown as DuckDBClient;
const cell = { kind: 'sql', id: 'b1', sqlSource: 'SELECT id, val FROM t' } as unknown as Cell;

bench(
  'execute 1000-row query (mocked client)',
  async () => {
    await executeCell(cell, mockClient, new AbortController().signal);
  },
  { iterations: 100 },
);
```

- [ ] **12.2** Run:

```bash
npx vitest bench --run src/__tests__/executor/cellExecutor.bench.ts
```

Expected: per-iteration mean under ~5ms (parse + format + Promise resolution is dominated by `parseSql`). Record the number in the commit message.

---

### Step 13 — Full Vitest sweep

- [ ] **13.1**

```bash
npx vitest run
```

Expected: all existing M-A0..M-B2 tests still pass; new tests pass; total count grows by ≥35.

- [ ] **13.2** Run typecheck:

```bash
npx tsc --noEmit
```

Expected: clean.

---

### Step 14 — Playwright gate

- [ ] **14.1** Build & launch dev server (Playwright config will start it via `webServer` if configured):

```bash
npx playwright test \
  tests/e2e/00-smoke.spec.ts \
  tests/e2e/01-shell-and-ingest.spec.ts \
  tests/e2e/02-vars-and-sigils.spec.ts \
  tests/e2e/04-cross-cell.spec.ts \
  --project=dark
```

Expected: 22+ tests pass (10 smoke + 6 shell + 3 vars stubs skipped/fixme + 2–3 execution tests + a11y sweep). Zero failures.

- [ ] **14.2** If the a11y sweep flags `aria-sort` on non-grid `<th>` (axe sometimes warns when `role="table"` is implicit), either:
  - Switch the wrapper to `role="grid"` and add `role="row"`/`role="gridcell"` accordingly, OR
  - Filter the rule in the AxeBuilder call.

Prefer the first option only if axe complains; the table semantics are inherent so axe usually passes.

---

### Step 15 — Sanity check before completion

- [ ] **15.1** Run the full Vitest sweep and Playwright gate one more time. Verify:
  - Status chip transitions through all four states in the live app.
  - Cancel button appears only during running state.
  - Results table truncates correctly at 200 rows (test with a `SELECT * FROM range(1000)` if needed).
  - SQL parse errors never call the worker (check DevTools network/console for absence of worker query messages).
  - Sort cycles correctly on numeric, BigInt, and string columns.

- [ ] **15.2** Re-read the milestone description and confirm every "After M-B3" bullet is satisfied.

---

## Done criteria

- [ ] `src/context/DuckDBContext.tsx` exports `DuckDBProvider` and `useDB`, with `useRef`-backed singleton lifetime.
- [ ] `src/hooks/useDB.ts` re-exports `useDB`.
- [ ] `src/services/executor/cellExecutor.ts` implements `executeCell(cell, client, signal): Promise<ExecutionResult>` with parse-gate, timing, abort handling, and TypeError on non-SQL.
- [ ] `src/services/executor/types.ts` defines the `ExecutionResult` discriminated union.
- [ ] `src/components/results/ResultsTable.tsx` renders headers, rows, sort cycle, BigInt/Date formatting, 200-row cap, truncation banner.
- [ ] `src/components/cell/CellView.tsx` is wired to `useDB`, runs `executeCell` on run button click, shows cancel button while running, renders status chip text per state, renders `ResultsTable` on success.
- [ ] `src/components/notebook/exampleNotebook.ts` includes a `CREATE TABLE events` cell and a `SELECT * FROM events` cell.
- [ ] `src/App.tsx` is wrapped in `<DuckDBProvider>`.
- [ ] `src/__tests__/executor/cellExecutor.test.ts` has ≥15 tests, all passing.
- [ ] `src/__tests__/results/ResultsTable.test.tsx` has ≥12 tests, all passing.
- [ ] `src/__tests__/context/DuckDBContext.test.tsx` has ≥4 tests, all passing.
- [ ] `src/__tests__/executor/cellExecutor.bench.ts` runs and reports a mean iteration time.
- [ ] `tests/e2e/04-cross-cell.spec.ts` has at least three un-fixme'd tests covering run/status/error, plus an a11y sweep.
- [ ] `tests/visual/plots.spec.ts` has two new `test.fixme` entries for results table and status chip screenshots.
- [ ] `npx tsc --noEmit` is clean.
- [ ] `npx vitest run` is green.
- [ ] `npx playwright test --project=dark` against the four listed files passes with ≥22 tests, zero failures.
- [ ] No `any` types introduced anywhere in the new code (verified by grep).
- [ ] `src/services/duckdb/client.ts` and `worker.ts` are unchanged from M-A6.
