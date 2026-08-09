# Performance Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve notebook responsiveness for many interconnected plots and larger JFR files via four targeted changes: faster variable debounce, adaptive JFR import workers, query result caching, and better executor parallelism.

**Architecture:** All four tasks are independent — they can be applied in any order. Tasks 1 and 2 are one-liners; Tasks 3 and 4 require more surgical edits. No new files are created. Tests follow existing vitest patterns.

**Tech Stack:** TypeScript, React hooks, DuckDB-WASM, vitest 4.x.

---

## Critical Files

| File | Role |
|---|---|
| `core/frontend/components/NotebookCell.tsx:885` | Auto-run debounce timeout |
| `core/frontend/utils/jfrToWasmLoader.ts:13-20` | `getMaxWorkers()` — JFR import parallelism |
| `core/frontend/context/DuckDBContext.tsx:258-264,563-587` | `executeQuery` + `query` callback — cache goes here |
| `core/frontend/runtime/executor.ts:36,104-145` | `MAX_CONCURRENT` + `scheduleRun` — executor parallelism |

---

## Task 1: Variable Debounce 800ms → 200ms

**What it does:** Cells that use variables (e.g. `$start`, `$end`) currently wait 800ms after a variable change before re-running. For plots linked by LINK_X/BRUSH, this creates a long visible lag. Reducing to 200ms makes the notebook feel snappy without causing excessive query spam.

**Files:**
- Modify: `core/frontend/components/NotebookCell.tsx:885`

- [ ] **Step 1: Change the debounce timeout**

In `core/frontend/components/NotebookCell.tsx`, line 885, change `800` to `200`:

```typescript
// Before:
                }, 800);

// After:
                }, 200);
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -5
```

Expected: all tests pass (6206+ pass, ≤7 skipped).

- [ ] **Step 3: Commit**

```bash
git add core/frontend/components/NotebookCell.tsx
git commit -m "perf: reduce variable auto-run debounce from 800ms to 200ms"
```

---

## Task 2: Adaptive JFR Import Worker Count

**What it does:** The JFR import currently uses 1 worker by default, even on machines with plenty of RAM. Each GraalVM WASM worker uses ~300–600 MB, so 1 worker is the safe floor — but on devices with ≥ 8 GB `deviceMemory` we can safely use 2 workers, cutting import time roughly in half for large JFR files.

**Files:**
- Modify: `core/frontend/utils/jfrToWasmLoader.ts:13-20`

- [ ] **Step 1: Update `getMaxWorkers()` to return 2 on high-memory devices**

In `core/frontend/utils/jfrToWasmLoader.ts`, replace lines 13–20:

```typescript
// Before:
function getMaxWorkers(): number {
  const override = new URLSearchParams(location.search).get('maxWorkers');
  const n = parseInt(override, 10);
  if (override && !isNaN(n)) return Math.max(1, Math.min(4, n));
  // Default to 1 worker to bound peak GraalVM WASM memory (~300-600 MB per worker).
  // Users on high-memory machines can override with ?maxWorkers=2.
  return 1;
}

// After:
function getMaxWorkers(): number {
  const override = new URLSearchParams(location.search).get('maxWorkers');
  const n = parseInt(override, 10);
  if (override && !isNaN(n)) return Math.max(1, Math.min(4, n));
  // Use 2 workers on devices with ≥8 GB RAM (~600 MB per worker fits within typical
  // browser renderer memory budgets on those machines). Fall back to 1 worker otherwise.
  const mem = (navigator as any).deviceMemory;
  return typeof mem === 'number' && mem >= 8 ? 2 : 1;
}
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add core/frontend/utils/jfrToWasmLoader.ts
git commit -m "perf: use 2 JFR import workers on devices with ≥8 GB RAM"
```

---

## Task 3: Query Result Cache

**What it does:** Every time a variable changes, every dependent cell re-runs its SQL from scratch, even if the query text is identical (e.g. a schema explorer query that never changes). Adding a simple `Map<string, any[]>` cache keyed by the final SQL string eliminates redundant DuckDB round-trips.

**Cache rules:**
- Only cache `SELECT` queries (no DDL, no writes).
- Skip queries containing `-- no-cache` comment.
- Clear the entire cache when a new file is loaded (`loadFile`, `loadDemo`, `loadServerFile`).
- In WASM mode only (server mode results may differ between calls due to server state).

**Files:**
- Modify: `core/frontend/context/DuckDBContext.tsx`

The key locations in the file:
- Line 253: `const wasmDbRef` — add `queryCache` ref after this block
- Line 258: `executeQuery` callback — add cache check/set here (WASM path only)
- Line 406: `loadFile` — clear cache
- Line 462: `loadDemo` — clear cache  
- Line 533: `loadServerFile` — no cache in server mode, but clear it anyway

- [ ] **Step 1: Add the `queryCache` ref after line 256 in `DuckDBContext.tsx`**

Find this block (around line 253–256):

```typescript
  const wasmDbRef = useRef<AsyncDuckDB | null>(null);
  const wasmConnRef = useRef<AsyncDuckDBConnection | null>(null);
  // In-flight eager init promise — loadFile awaits this instead of re-initializing.
  const wasmInitPromiseRef = useRef<Promise<void> | null>(null);
```

Add one line after:

```typescript
  const wasmDbRef = useRef<AsyncDuckDB | null>(null);
  const wasmConnRef = useRef<AsyncDuckDBConnection | null>(null);
  // In-flight eager init promise — loadFile awaits this instead of re-initializing.
  const wasmInitPromiseRef = useRef<Promise<void> | null>(null);
  const queryCacheRef = useRef<Map<string, any[]>>(new Map());
```

- [ ] **Step 2: Update `executeQuery` to check/populate cache for WASM SELECT queries**

Find this block (around line 258–264):

```typescript
  const executeQuery = useCallback(async (sql: string): Promise<any> => {
    if (mode === 'wasm') {
        if (!wasmConnRef.current) throw new Error('WASM DB not initialized');
        return runWasmQuery(wasmConnRef.current, sql);
    }
    return executeRemoteQuery(sql);
  }, [mode]);
```

Replace with:

```typescript
  const executeQuery = useCallback(async (sql: string): Promise<any> => {
    if (mode === 'wasm') {
        if (!wasmConnRef.current) throw new Error('WASM DB not initialized');
        const cleaned = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
        const isSelect = /^select\b/i.test(cleaned);
        const noCache = /--\s*no-cache/i.test(sql);
        if (isSelect && !noCache) {
            const cached = queryCacheRef.current.get(sql);
            if (cached !== undefined) return cached;
            const result = await runWasmQuery(wasmConnRef.current, sql);
            queryCacheRef.current.set(sql, result);
            return result;
        }
        return runWasmQuery(wasmConnRef.current, sql);
    }
    return executeRemoteQuery(sql);
  }, [mode]);
```

- [ ] **Step 3: Clear cache in `loadFile`**

Find the start of `loadFile` (around line 406):

```typescript
  const loadFile = useCallback(async (source: File | Uint8Array, fileName: string, stacktraceDepth = 10) => {
    setDbState(DBState.IMPORTING);
    setImportProgress(0.01);
    setErrorMessage(null);
```

Add cache clear as the 4th line:

```typescript
  const loadFile = useCallback(async (source: File | Uint8Array, fileName: string, stacktraceDepth = 10) => {
    setDbState(DBState.IMPORTING);
    setImportProgress(0.01);
    setErrorMessage(null);
    queryCacheRef.current.clear();
```

- [ ] **Step 4: Clear cache in `loadDemo`**

Find the start of `loadDemo` (around line 462):

```typescript
  const loadDemo = useCallback(async () => {
    setDbState(DBState.IMPORTING);
    setErrorMessage(null);
```

Add cache clear as the 3rd line:

```typescript
  const loadDemo = useCallback(async () => {
    setDbState(DBState.IMPORTING);
    setErrorMessage(null);
    queryCacheRef.current.clear();
```

- [ ] **Step 5: Clear cache in `loadServerFile`**

Find the start of `loadServerFile` (around line 533):

```typescript
  const loadServerFile = useCallback(async (path: string) => {
    setDbState(DBState.IMPORTING);
    setErrorMessage(null);
```

Add cache clear as the 3rd line:

```typescript
  const loadServerFile = useCallback(async (path: string) => {
    setDbState(DBState.IMPORTING);
    setErrorMessage(null);
    queryCacheRef.current.clear();
```

- [ ] **Step 6: Run tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -5
```

Expected: all tests pass. If any test checks that a query runs twice and gets different results, that test is exercising cache-busting — use `-- no-cache` comment or `loadFile`/`loadDemo` reset as the fix.

- [ ] **Step 7: Commit**

```bash
git add core/frontend/context/DuckDBContext.tsx
git commit -m "perf: add SELECT query result cache for WASM mode; cleared on file load"
```

---

## Task 4: Executor Parallelism for Independent Cells

**What it does:** The executor caps simultaneous running cells at `MAX_CONCURRENT = 4`, even for cells that have no dependency on each other. Since all queries are serialized by the `dbLock` inside DuckDB anyway, the concurrency cap just adds unnecessary queueing overhead (cells wait for a "slot" before even trying to acquire the DB lock). 

The fix is to remove the concurrency semaphore entirely from the executor. The DuckDB `dbLock` is the real serializer — cells with no deps will pipeline into it immediately, and cells with deps still wait for their upstream first. This removes artificial queuing without changing correctness.

**Files:**
- Modify: `core/frontend/runtime/executor.ts`

- [ ] **Step 1: Remove the concurrency semaphore from `executor.ts`**

The current file has:
- Line 36: `const MAX_CONCURRENT = 4;`
- Lines 47–49: `runningCount`, `concurrencyQueue` fields
- Lines 83–97: `acquireSlot()` and `releaseSlot()` methods
- Line 129: `await this.acquireSlot();`
- Line 139: `this.releaseSlot();` (in `finally`)

Replace the entire file contents with:

```typescript
/**
 * Topological cell executor.
 *
 * The executor owns "when does each cell actually run", isolating that
 * concern from individual cell components. Callers (typically NotebookCell)
 * invoke `scheduleRun(cellId)` after edits or user-triggered runs; the
 * executor:
 *
 *   1. Looks up the cell's dependencies in the current graph snapshot.
 *   2. Waits for each upstream cell's most-recent run promise to resolve
 *      (or be `'done'`).
 *   3. Invokes the registered `runFn(cellId)` for this cell.
 *   4. On completion, wakes dependents.
 *
 * Cells with no dependencies start immediately and pipeline into the shared
 * DuckDB lock. The lock is the only real serializer — there is no artificial
 * concurrency cap here.
 */

import type { GraphResult } from './executionGraph';

export type CellStatus = 'pending' | 'running' | 'done' | 'failed';

export interface ExecutorCallbacks {
    /** Run the cell. Resolves on completion, rejects on failure. */
    runFn: (cellId: string) => Promise<void>;
    /** Optional notification when a cell's status changes (for UI updates). */
    onStatusChange?: (cellId: string, status: CellStatus) => void;
}

export class Executor {
    graph: GraphResult;
    private cb: ExecutorCallbacks;
    private status = new Map<string, CellStatus>();
    /** Each cell's CURRENT run promise (resolves when that run finishes). */
    private runPromises = new Map<string, Promise<void>>();
    /** Monotonic per-cell run id, so old promises can be invalidated on re-schedule. */
    private runIds = new Map<string, number>();

    constructor(graph: GraphResult, cb: ExecutorCallbacks) {
        this.graph = graph;
        this.cb = cb;
        for (const id of graph.order) this.status.set(id, 'pending');
    }

    /** Swap in a new graph snapshot. Existing in-flight runs continue; new
     * scheduleRun calls use the new dependency edges. */
    updateGraph(graph: GraphResult): void {
        const newIds = new Set(graph.order);
        for (const id of this.status.keys()) {
            if (!newIds.has(id)) {
                this.status.delete(id);
                this.runPromises.delete(id);
                this.runIds.delete(id);
            }
        }
        this.graph = graph;
        for (const id of graph.order) {
            if (!this.status.has(id)) this.status.set(id, 'pending');
        }
    }

    cellStatus(cellId: string): CellStatus {
        return this.status.get(cellId) ?? 'pending';
    }

    /** Returns the current run promise for a cell, or a resolved promise if none. */
    awaitCell(cellId: string): Promise<void> {
        return this.runPromises.get(cellId) ?? Promise.resolve();
    }

    /**
     * Schedule cell `cellId` to run. Returns a promise that resolves when
     * this scheduled run completes (or rejects if it fails). Calling again
     * before the previous run finishes replaces the queued run.
     */
    scheduleRun(cellId: string): Promise<void> {
        const myRunId = (this.runIds.get(cellId) ?? 0) + 1;
        this.runIds.set(cellId, myRunId);

        const deps = this.graph.deps.get(cellId);
        const cycle = this.graph.cycles.has(cellId);

        const p = (async () => {
            // Wait for upstream cells.
            if (deps && !cycle) {
                for (const depId of deps) {
                    try { await this.awaitCell(depId); } catch (upstreamErr) {
                        // B-163: log upstream failure but continue running downstream
                        // against potentially stale data (consistent with test expectations).
                        console.warn(`[Executor] upstream cell ${depId} failed; ${cellId} may run against stale data`, upstreamErr);
                    }
                }
            }
            // If the run id was bumped while we waited, abandon this run.
            // The newer run owns the status — never touch it.
            if (this.runIds.get(cellId) !== myRunId) {
                return;
            }

            this.setStatus(cellId, 'running');
            try {
                await this.cb.runFn(cellId);
                if (this.runIds.get(cellId) === myRunId) this.setStatus(cellId, 'done');
            } catch (err) {
                if (this.runIds.get(cellId) === myRunId) {
                    this.setStatus(cellId, 'failed');
                }
                throw err;
            }
        })();

        this.runPromises.set(cellId, p);
        return p;
    }

    private setStatus(cellId: string, status: CellStatus): void {
        this.status.set(cellId, status);
        this.cb.onStatusChange?.(cellId, status);
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/core/frontend && npx vitest run 2>&1 | tail -5
```

Expected: all tests pass. Executor tests in particular should still pass — removing the slot mechanism doesn't change observable behavior for correct dependency orderings.

- [ ] **Step 3: Commit**

```bash
git add core/frontend/runtime/executor.ts
git commit -m "perf: remove executor concurrency cap; DuckDB lock is the real serializer"
```

---

## Verification

After all tasks:

1. `npx vitest run` — all tests pass (6206+ pass, ≤7 skipped)
2. Load demo notebook — Run All completes, all plots render, no console errors
3. Interact with LINK_X on a chart — linked charts update within ~200ms of variable change
4. Check browser DevTools console — no errors, no warnings beyond known ONNX/recharts noise
