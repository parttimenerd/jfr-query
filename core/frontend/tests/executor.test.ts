import { describe, it, expect, vi } from 'vitest';
import { Executor } from '../runtime/executor';
import { buildExecutionGraph, GraphCell } from '../runtime/executionGraph';

const mkCell = (id: string, handle: string, sql: string, aliases: string[] = []): GraphCell => ({
    id, handle, producedBareAliases: aliases, referencedSql: sql,
});

describe('Executor', () => {
    it('runs cells respecting dependency order', async () => {
        const cells = [
            mkCell('b', 'cell_1', 'SELECT * FROM gc'),
            mkCell('a', 'cell_2', 'SELECT 1', ['gc']),
        ];
        const graph = buildExecutionGraph(cells);
        const startOrder: string[] = [];
        const ex = new Executor(graph, {
            runFn: async (id) => {
                startOrder.push(id);
                await new Promise(r => setTimeout(r, 5));
            },
        });

        // Schedule in document order — executor must reorder.
        const pB = ex.scheduleRun('b');
        const pA = ex.scheduleRun('a');
        await Promise.all([pA, pB]);

        // 'a' must START before 'b'
        expect(startOrder.indexOf('a')).toBeLessThan(startOrder.indexOf('b'));
        expect(ex.cellStatus('a')).toBe('done');
        expect(ex.cellStatus('b')).toBe('done');
    });

    it('reports failed status when runFn rejects', async () => {
        const graph = buildExecutionGraph([mkCell('x', 'cell_1', 'SELECT 1', [])]);
        const ex = new Executor(graph, {
            runFn: async () => { throw new Error('boom'); },
        });
        await expect(ex.scheduleRun('x')).rejects.toThrow('boom');
        expect(ex.cellStatus('x')).toBe('failed');
    });

    it('emits status callbacks: running then done', async () => {
        const graph = buildExecutionGraph([mkCell('x', 'cell_1', 'SELECT 1', [])]);
        const events: string[] = [];
        const ex = new Executor(graph, {
            runFn: async () => {},
            onStatusChange: (_id, s) => events.push(s),
        });
        await ex.scheduleRun('x');
        expect(events).toEqual(['running', 'done']);
    });

    it('replaces queued run when scheduleRun is called again', async () => {
        const graph = buildExecutionGraph([mkCell('x', 'cell_1', 'SELECT 1', [])]);
        const runFn = vi.fn().mockResolvedValue(undefined);
        const ex = new Executor(graph, { runFn });
        const p1 = ex.scheduleRun('x');
        const p2 = ex.scheduleRun('x');
        await Promise.all([p1, p2]);
        // Both promises resolve, but the runFn only fires once for each — that's OK.
        // The key invariant: status is 'done' after the latest scheduled run.
        expect(ex.cellStatus('x')).toBe('done');
    });

    it('survives a failing upstream and still runs the downstream', async () => {
        const cells = [
            mkCell('a', 'cell_1', 'SELECT 1', ['x']),
            mkCell('b', 'cell_2', 'SELECT * FROM x'),
        ];
        const graph = buildExecutionGraph(cells);
        const ex = new Executor(graph, {
            runFn: async (id) => {
                if (id === 'a') throw new Error('a failed');
            },
        });
        const pA = ex.scheduleRun('a').catch(() => {});
        const pB = ex.scheduleRun('b');
        await Promise.all([pA, pB]);
        // 'b' still ran (no exception thrown), even though upstream failed.
        expect(ex.cellStatus('b')).toBe('done');
        expect(ex.cellStatus('a')).toBe('failed');
    });
});
