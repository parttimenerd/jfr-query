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
 * v1 runs sequentially in dependency order; in particular, after
 * `scheduleRun(A)` and `scheduleRun(B)` with A → B, A's run actually
 * starts before B's. Independent cells may run sequentially too — the
 * executor does NOT attempt parallelism (single DuckDB connection).
 *
 * NB: the graph and the `runFn` are both injected so this module stays
 * free of React. The provider component in `context/ExecutorContext` (Phase
 * 2 wiring) handles graph updates and React state.
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
    private graph: GraphResult;
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
            if (this.runIds.get(cellId) !== myRunId) return;

            this.setStatus(cellId, 'running');
            try {
                await this.cb.runFn(cellId);
                if (this.runIds.get(cellId) === myRunId) this.setStatus(cellId, 'done');
            } catch (err) {
                if (this.runIds.get(cellId) === myRunId) this.setStatus(cellId, 'failed');
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
