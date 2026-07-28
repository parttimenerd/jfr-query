import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { NotebookCellData } from '../types';
import { cellHandle } from '../utils/cellHandle';
import { buildExecutionGraph, GraphCell } from '../runtime/executionGraph';
import { Executor } from '../runtime/executor';
import { parseCellContent, tokenizeCellContent } from '../utils/notebookParser';
import { parsePlotCall } from '../utils/plotParser';

interface ExecutorContextType {
    /**
     * Await all upstream dependencies of `cellId`. Resolves immediately if
     * the cell has no dependencies or if the graph is empty.
     */
    awaitUpstream: (cellId: string) => Promise<void>;
    /** Schedule a cell-run via the executor. The actual run is performed by
     * `runFn` registered with the executor (typically the existing onRunQuery
     * pipeline). Returns when the run finishes. */
    scheduleRun: (cellId: string) => Promise<void>;
    /** Register the run-function for a cell. Should be called by NotebookCell
     * when it mounts so the executor knows how to run it. */
    registerRunFn: (cellId: string, runFn: () => Promise<void>) => void;
    unregisterRunFn: (cellId: string) => void;
}

const defaultCtx: ExecutorContextType = {
    awaitUpstream: async () => {},
    scheduleRun: async () => {},
    registerRunFn: () => {},
    unregisterRunFn: () => {},
};

export const ExecutorContext = createContext<ExecutorContextType>(defaultCtx);
export const useExecutor = () => useContext(ExecutorContext);

interface ProviderProps {
    cells: NotebookCellData[];
    children: ReactNode;
}

export const ExecutorProvider: React.FC<ProviderProps> = ({ cells, children }) => {
    const runFns = useRef<Map<string, () => Promise<void>>>(new Map());
    const executorRef = useRef<Executor | null>(null);
    // Per-cell parse cache for execution graph construction.
    const graphCellCacheRef = useRef<WeakMap<object, GraphCell>>(new WeakMap());

    // Build graph cells from the live notebook cells.
    // Derive a stable structural key from cell id+content so that changes that
    // don't affect SQL structure (e.g. metadata.variables updates that trigger a
    // parent re-render) don't rebuild the execution graph on every frame.
    const graphStructKey = useMemo(
        () => cells.map(c => `${c.id}:${c.name ?? ''}:${c.content}`).join('\n'),
        [cells],
    );
    const graphCells: GraphCell[] = useMemo(() => {
        return cells.map((c, idx) => {
            const cached = graphCellCacheRef.current.get(c);
            if (cached) return cached;
            const handle = cellHandle(c, idx);
            const parsed = parseCellContent(tokenizeCellContent(c.content));
            const aliases = parsed.queryAliases.filter((a): a is string => !!a);
            const referencedSql = parsed.sqlBlocks.join('\n');
            // B-161: collect named (non-numeric) ON-clause refs from plot blocks so
            // cross-cell alias dependencies are tracked in the execution graph.
            const plotOnRefs: string[] = [];
            for (const { config: plotContent } of parsed.plotBlocksWithSqlIndex) {
                if (!plotContent?.trim()) continue;
                try {
                    const call = parsePlotCall(plotContent.trim());
                    for (const ref of call.on ?? []) {
                        const stripped = ref.replace(/^#/, '');
                        // Skip numeric refs — those are cell-local (ON #1, ON 1).
                        if (/^\d+$/.test(stripped)) continue;
                        plotOnRefs.push(stripped);
                    }
                } catch { /* ignore malformed plot configs */ }
            }
            const cell: GraphCell = { id: c.id, handle, producedBareAliases: aliases, referencedSql, plotOnRefs };
            graphCellCacheRef.current.set(c, cell);
            return cell;
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [graphStructKey]);

    // Build/refresh the executor as the graph changes. Existing in-flight
    // runs continue against their old graph; new scheduleRun calls use the
    // refreshed dependency edges.
    const graph = useMemo(() => buildExecutionGraph(graphCells), [graphCells]);
    useEffect(() => {
        if (!executorRef.current) {
            executorRef.current = new Executor(graph, {
                runFn: async (cellId) => {
                    const fn = runFns.current.get(cellId);
                    if (fn) await fn();
                },
            });
        } else {
            executorRef.current.updateGraph(graph);
        }
    }, [graph]);

    const awaitUpstream = useCallback(async (cellId: string) => {
        const ex = executorRef.current;
        if (!ex) return;
        const deps = ex.graph.deps.get(cellId);
        if (!deps || deps.size === 0) return;
        // Don't block forever on cycle participants.
        if (ex.graph.cycles.has(cellId)) return;
        for (const dep of deps) {
            try { await ex.awaitCell(dep); } catch { /* keep going */ }
        }
    }, []);

    const scheduleRun = useCallback(async (cellId: string) => {
        const ex = executorRef.current;
        if (!ex) return;
        await ex.scheduleRun(cellId);
    }, []);

    const registerRunFn = useCallback((cellId: string, runFn: () => Promise<void>) => {
        runFns.current.set(cellId, runFn);
    }, []);
    const unregisterRunFn = useCallback((cellId: string) => {
        runFns.current.delete(cellId);
    }, []);

    const value = useMemo<ExecutorContextType>(() => ({
        awaitUpstream, scheduleRun, registerRunFn, unregisterRunFn,
    }), [awaitUpstream, scheduleRun, registerRunFn, unregisterRunFn]);

    return <ExecutorContext.Provider value={value}>{children}</ExecutorContext.Provider>;
};
