// @vitest-environment jsdom
/**
 * Integration tests for CellAliasProvider.registerAlias / unregisterCell.
 *
 * These tests render the provider in a minimal React tree with a mock DuckDB
 * query function. They verify:
 *   - registerAlias creates the right TEMP VIEWs in DuckDB
 *   - the alias becomes queryable via the bare name from a second cell
 *   - materialized aliases create TEMP TABLE instead of TEMP VIEW
 *   - JFR table collision → bare view skipped, qualified view still created
 *   - unregisterCell drops all owned views
 *   - registerAlias on a non-READY DB returns null without calling query
 *   - SQL error during alias creation returns null and does not register
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React, { useEffect, useRef } from 'react';
import {
    CellAliasProvider,
    useCellAliasActions,
    useCellAliases,
    type AliasInfo,
} from '../context/CellAliasContext';
import { DataContext, DBState } from '../context/DuckDBContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryMock(opts: {
    /** Map SQL prefix → rows to return (first match wins). */
    responses?: Array<[pattern: string, rows: any[]]>;
    /** If set, throw for any SQL matching this pattern. */
    failOn?: string;
} = {}) {
    const calls: string[] = [];
    const queryFn = vi.fn(async (sql: string): Promise<any[]> => {
        calls.push(sql);
        if (opts.failOn && sql.includes(opts.failOn)) {
            throw new Error(`mock error: ${opts.failOn}`);
        }
        for (const [pattern, rows] of opts.responses ?? []) {
            if (sql.includes(pattern)) return rows;
        }
        return [];
    });
    return { queryFn, calls };
}

function makeDataContext(queryFn: ReturnType<typeof makeQueryMock>['queryFn'], {
    dbState = DBState.READY,
    shadowedTables = [] as string[],
} = {}) {
    return {
        query: queryFn,
        dbState,
        schema: {
            tables: shadowedTables.map(n => ({ name: n, columns: [] })),
            views: [],
            macros: [],
        },
        mode: 'server' as const,
        sourceType: 'jfr' as const,
        errorMessage: null,
        serverProbeError: null,
        serverCurrentFile: null,
        recordingStart: null,
        recordingEnd: null,
        importProgress: null,
        wasmInitializing: false,
        refreshSchema: async () => {},
        loadFile: async () => {},
        loadServerFile: async () => {},
        setMode: async () => {},
        resetDatabase: async () => {},
    } as any;
}

/** Renders a test component that exposes registerAlias and captured results. */
function TestHarness({
    onReady,
}: {
    onReady: (actions: ReturnType<typeof useCellAliasActions>, getAliases: () => ReturnType<typeof useCellAliases>) => void;
}) {
    const actions = useCellAliasActions();
    const aliases = useCellAliases();
    const aliasesRef = useRef(aliases);
    aliasesRef.current = aliases;
    const calledRef = useRef(false);
    useEffect(() => {
        if (!calledRef.current) {
            calledRef.current = true;
            onReady(actions, () => aliasesRef.current);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
}

function renderWithProvider(
    queryFn: ReturnType<typeof makeQueryMock>['queryFn'],
    opts: { dbState?: DBState; shadowedTables?: string[] } = {},
): {
    getActions: () => ReturnType<typeof useCellAliasActions>;
    getAliases: () => ReturnType<typeof useCellAliases>;
} {
    let actions!: ReturnType<typeof useCellAliasActions>;
    let getAliases!: () => ReturnType<typeof useCellAliases>;
    const dataCtx = makeDataContext(queryFn, opts);

    render(
        React.createElement(
            DataContext.Provider,
            { value: dataCtx },
            React.createElement(
                CellAliasProvider,
                null,
                React.createElement(TestHarness, {
                    onReady: (a, g) => { actions = a; getAliases = g; },
                }),
            ),
        ),
    );
    return {
        getActions: () => actions,
        getAliases,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CellAliasProvider.registerAlias', () => {
    it('executes CREATE SCHEMA + qualified VIEW + bare VIEW statements', async () => {
        const { queryFn } = makeQueryMock({
            responses: [['information_schema.columns', [{ column_name: 'bucket', data_type: 'VARCHAR' }]]],
        });
        const { getActions } = renderWithProvider(queryFn);

        let info!: AliasInfo | null;
        await act(async () => {
            info = await getActions().registerAlias({
                cellId: 'cell-1',
                cellHandle: 'gc-overview',
                cellIndex: 0,
                sqlIndex: 0,
                alias: 'gc_pauses',
                sql: 'SELECT bucket FROM gc_pauses_raw',
                materialized: false,
            });
        });

        expect(info).not.toBeNull();
        const sqls = queryFn.mock.calls.map(c => c[0]);
        expect(sqls).toContain('CREATE SCHEMA IF NOT EXISTS "gc_overview"');
        expect(sqls).toContain(
            'CREATE OR REPLACE TEMP VIEW "gc_overview"."gc_pauses" AS (SELECT bucket FROM gc_pauses_raw)',
        );
        expect(sqls).toContain(
            'CREATE OR REPLACE TEMP VIEW "gc_pauses" AS (SELECT bucket FROM gc_pauses_raw)',
        );
    });

    it('populates alias info with columns returned by information_schema', async () => {
        const { queryFn } = makeQueryMock({
            responses: [[
                'information_schema.columns',
                [
                    { column_name: 'bucket', data_type: 'TIMESTAMP' },
                    { column_name: 'pauseMs', data_type: 'DOUBLE' },
                ],
            ]],
        });
        const { getActions } = renderWithProvider(queryFn);

        let info!: AliasInfo | null;
        await act(async () => {
            info = await getActions().registerAlias({
                cellId: 'cell-1',
                cellHandle: 'cell-1',
                cellIndex: 0,
                sqlIndex: 0,
                alias: 'pauses',
                sql: 'SELECT bucket, AVG(pauseMs) FROM gc GROUP BY bucket',
                materialized: false,
            });
        });

        expect(info?.columns).toEqual([
            { name: 'bucket', type: 'TIMESTAMP' },
            { name: 'pauseMs', type: 'DOUBLE' },
        ]);
    });

    it('registers the alias in the context snapshot (getByBare and getByQualified)', async () => {
        const { queryFn } = makeQueryMock({
            responses: [['information_schema.columns', [{ column_name: 'n', data_type: 'BIGINT' }]]],
        });
        const { getActions, getAliases } = renderWithProvider(queryFn);

        await act(async () => {
            await getActions().registerAlias({
                cellId: 'cell-1',
                cellHandle: 'cell-1',
                cellIndex: 0,
                sqlIndex: 0,
                alias: 'method_counts',
                sql: 'SELECT method, COUNT(*) AS n FROM profiling GROUP BY method',
                materialized: false,
            });
        });

        await waitFor(() => {
            const aliases = getAliases();
            expect(aliases['method_counts']).toBeDefined();
            expect(aliases['cell_1.method_counts']).toBeDefined();
        });

        const byBare = getActions().getByBare('method_counts');
        expect(byBare?.alias).toBe('method_counts');

        const byQual = getActions().getByQualified('cell-1', 'method_counts');
        expect(byQual?.alias).toBe('method_counts');
    });

    it('uses TEMP TABLE when materialized=true', async () => {
        const { queryFn } = makeQueryMock({
            responses: [['information_schema.columns', [{ column_name: 'x', data_type: 'INTEGER' }]]],
        });
        const { getActions } = renderWithProvider(queryFn);

        await act(async () => {
            await getActions().registerAlias({
                cellId: 'cell-2',
                cellHandle: 'cell-2',
                cellIndex: 1,
                sqlIndex: 0,
                alias: 'big_agg',
                sql: 'SELECT SUM(x) AS x FROM cpu_load',
                materialized: true,
            });
        });

        const sqls = queryFn.mock.calls.map(c => c[0]);
        expect(sqls).toContain('CREATE OR REPLACE TEMP TABLE "cell_2"."big_agg" AS (SELECT SUM(x) AS x FROM cpu_load)');
        expect(sqls).toContain('CREATE OR REPLACE TEMP TABLE "big_agg" AS (SELECT SUM(x) AS x FROM cpu_load)');
        expect(sqls.some(s => s.includes('TEMP VIEW'))).toBe(false);
    });

    it('skips bare VIEW when alias name collides with a real JFR table', async () => {
        const { queryFn } = makeQueryMock({
            responses: [['information_schema.columns', [{ column_name: 'x', data_type: 'INTEGER' }]]],
        });
        const { getActions } = renderWithProvider(queryFn, { shadowedTables: ['GarbageCollection'] });

        let info!: AliasInfo | null;
        await act(async () => {
            info = await getActions().registerAlias({
                cellId: 'cell-3',
                cellHandle: 'cell-3',
                cellIndex: 0,
                sqlIndex: 0,
                alias: 'GarbageCollection',
                sql: 'SELECT 1 AS x',
                materialized: false,
            });
        });

        expect(info?.bareShadowed).toBe(true);
        const sqls = queryFn.mock.calls.map(c => c[0]);
        // Bare standalone view must NOT exist (no schema prefix before it):
        expect(sqls.some(s => /TEMP VIEW "GarbageCollection" AS /.test(s))).toBe(false);
        // Qualified view (cell_3."GarbageCollection") MUST exist:
        expect(sqls.some(s => s.includes('"cell_3"."GarbageCollection"'))).toBe(true);
    });

    it('returns null and does not register when DB is not READY', async () => {
        const { queryFn } = makeQueryMock();
        const { getActions, getAliases } = renderWithProvider(queryFn, { dbState: DBState.NEEDS_FILE });

        let info: AliasInfo | null = undefined as any;
        await act(async () => {
            info = await getActions().registerAlias({
                cellId: 'cell-1',
                cellHandle: 'cell-1',
                cellIndex: 0,
                sqlIndex: 0,
                alias: 'test',
                sql: 'SELECT 1',
                materialized: false,
            });
        });

        expect(info).toBeNull();
        expect(queryFn).not.toHaveBeenCalled();
        expect(Object.keys(getAliases())).toHaveLength(0);
    });

    it('returns null when the alias SQL fails (parse error)', async () => {
        const { queryFn } = makeQueryMock({ failOn: 'TEMP VIEW' });
        const { getActions, getAliases } = renderWithProvider(queryFn);

        let info: AliasInfo | null = undefined as any;
        await act(async () => {
            info = await getActions().registerAlias({
                cellId: 'cell-1',
                cellHandle: 'cell-1',
                cellIndex: 0,
                sqlIndex: 0,
                alias: 'broken',
                sql: 'NOT VALID SQL !!!',
                materialized: false,
            });
        });

        expect(info).toBeNull();
        expect(Object.keys(getAliases())).toHaveLength(0);
    });

    it('returns null when columns query fails and rolls back the view', async () => {
        const { queryFn } = makeQueryMock({ failOn: 'information_schema.columns' });
        const { getActions, getAliases } = renderWithProvider(queryFn);

        let info: AliasInfo | null = undefined as any;
        await act(async () => {
            info = await getActions().registerAlias({
                cellId: 'cell-1',
                cellHandle: 'cell-1',
                cellIndex: 0,
                sqlIndex: 0,
                alias: 'will_rollback',
                sql: 'SELECT 1',
                materialized: false,
            });
        });

        expect(info).toBeNull();
        // Rollback DROPs should have been issued
        const sqls = queryFn.mock.calls.map(c => c[0]);
        expect(sqls.some(s => s.includes('DROP VIEW IF EXISTS'))).toBe(true);
        expect(Object.keys(getAliases())).toHaveLength(0);
    });

    it('the registered view is "queryable" from a second cell SQL (bare name resolves)', async () => {
        // Simulate the two-cell cross-reference flow:
        //   Cell A: registers alias "gc_summary" pointing to its aggregation query.
        //   Cell B: SELECT * FROM gc_summary  → should work using the bare name.
        //
        // Here we don't run real DuckDB — we verify the mock receives the correct
        // CREATE TEMP VIEW statement, and that a subsequent query referencing the
        // bare name would work in real DuckDB (since the TEMP VIEW "gc_summary" exists).
        const viewCreatedSqls: string[] = [];
        const { queryFn } = makeQueryMock({
            responses: [['information_schema.columns', [{ column_name: 'total_pause_ms', data_type: 'DOUBLE' }]]],
        });

        // Patch to capture CREATE VIEW statements
        const patchedQuery = vi.fn(async (sql: string): Promise<any[]> => {
            if (sql.startsWith('CREATE')) viewCreatedSqls.push(sql);
            return queryFn(sql);
        });
        const { getActions } = renderWithProvider(patchedQuery as any);

        await act(async () => {
            await getActions().registerAlias({
                cellId: 'cell-A',
                cellHandle: 'cell-A',
                cellIndex: 0,
                sqlIndex: 0,
                alias: 'gc_summary',
                sql: 'SELECT SUM(pauseMs) AS total_pause_ms FROM gc_pauses GROUP BY bucket',
                materialized: false,
            });
        });

        // The bare TEMP VIEW "gc_summary" was created — Cell B can now SELECT from it.
        expect(viewCreatedSqls).toContain(
            'CREATE OR REPLACE TEMP VIEW "gc_summary" AS ' +
            '(SELECT SUM(pauseMs) AS total_pause_ms FROM gc_pauses GROUP BY bucket)',
        );
        // Cell B's SQL referencing the bare view would be:
        // SELECT * FROM gc_summary
        // In real DuckDB this resolves to the TEMP VIEW. We confirm the name is registered:
        const byBare = getActions().getByBare('gc_summary');
        expect(byBare).toBeDefined();
        expect(byBare?.columns[0].name).toBe('total_pause_ms');
    });

    it('re-registration updates columns and bumps version', async () => {
        let call = 0;
        const { queryFn } = makeQueryMock({
            responses: [[
                'information_schema.columns',
                [{ column_name: 'x', data_type: 'INTEGER' }],  // first call
            ]],
        });
        const dynamicQuery = vi.fn(async (sql: string): Promise<any[]> => {
            if (sql.includes('information_schema.columns')) {
                call++;
                if (call === 1) return [{ column_name: 'x', data_type: 'INTEGER' }];
                return [{ column_name: 'x', data_type: 'INTEGER' }, { column_name: 'y', data_type: 'DOUBLE' }];
            }
            return [];
        });

        const { getActions } = renderWithProvider(dynamicQuery);

        let v1!: AliasInfo | null;
        await act(async () => {
            v1 = await getActions().registerAlias({
                cellId: 'cell-1', cellHandle: 'cell-1', cellIndex: 0, sqlIndex: 0,
                alias: 'agg', sql: 'SELECT x FROM t', materialized: false,
            });
        });
        expect(v1?.columns).toHaveLength(1);

        let v2!: AliasInfo | null;
        await act(async () => {
            v2 = await getActions().registerAlias({
                cellId: 'cell-1', cellHandle: 'cell-1', cellIndex: 0, sqlIndex: 0,
                alias: 'agg', sql: 'SELECT x, y FROM t', materialized: false,
            });
        });
        expect(v2?.columns).toHaveLength(2);
        expect(v2!.version).toBeGreaterThan(v1!.version);
    });
});

describe('CellAliasProvider.unregisterCell', () => {
    it('drops all owned views and removes from aliases snapshot', async () => {
        const droppedSqls: string[] = [];
        const queryFn = vi.fn(async (sql: string): Promise<any[]> => {
            if (sql.startsWith('DROP')) droppedSqls.push(sql);
            if (sql.includes('information_schema.columns'))
                return [{ column_name: 'n', data_type: 'BIGINT' }];
            return [];
        });
        const { getActions, getAliases } = renderWithProvider(queryFn);

        await act(async () => {
            await getActions().registerAlias({
                cellId: 'cell-X',
                cellHandle: 'cell-X',
                cellIndex: 0,
                sqlIndex: 0,
                alias: 'my_view',
                sql: 'SELECT COUNT(*) AS n FROM gc',
                materialized: false,
            });
        });

        await waitFor(() => expect(getAliases()['my_view']).toBeDefined());

        await act(async () => {
            await getActions().unregisterCell('cell-X');
        });

        await waitFor(() => expect(getAliases()['my_view']).toBeUndefined());
        expect(getAliases()['cell_x.my_view']).toBeUndefined();
        expect(droppedSqls.length).toBeGreaterThan(0);
    });

    it('is a no-op for a cell that was never registered', async () => {
        const { queryFn } = makeQueryMock();
        const { getActions } = renderWithProvider(queryFn);

        await act(async () => {
            await getActions().unregisterCell('nonexistent-cell');
        });

        expect(queryFn).not.toHaveBeenCalled();
    });
});

describe('cross-cell view reference scenario', () => {
    it('cell A registers alias, cell B can then reference it via qualified name', async () => {
        // Full two-cell scenario:
        //   Cell A runs: SELECT bucket, AVG(pauseMs) AS avg_pause FROM gc_pauses GROUP BY bucket
        //                -- alias gc_summary
        //   Cell B runs: SELECT * FROM "cell_A"."gc_summary" LIMIT 10
        //
        // We verify that after Cell A registers:
        //   1. The qualified TEMP VIEW exists in DuckDB (CREATE was called)
        //   2. getByQualified('cell-A', 'gc_summary') returns the alias info with columns
        const creates: string[] = [];
        const queryFn = vi.fn(async (sql: string): Promise<any[]> => {
            if (sql.startsWith('CREATE')) creates.push(sql);
            if (sql.includes('information_schema.columns'))
                return [
                    { column_name: 'bucket', data_type: 'VARCHAR' },
                    { column_name: 'avg_pause', data_type: 'DOUBLE' },
                ];
            return [];
        });
        const { getActions } = renderWithProvider(queryFn);

        await act(async () => {
            await getActions().registerAlias({
                cellId: 'cell-A',
                cellHandle: 'cell-A',
                cellIndex: 0,
                sqlIndex: 0,
                alias: 'gc_summary',
                sql: 'SELECT bucket, AVG(pauseMs) AS avg_pause FROM gc_pauses GROUP BY bucket',
                materialized: false,
            });
        });

        // Cell B's SQL: SELECT * FROM "cell_A"."gc_summary" LIMIT 10
        // First verify the view was created with the right qualified name:
        expect(creates).toContain(
            'CREATE OR REPLACE TEMP VIEW "cell_A"."gc_summary" AS ' +
            '(SELECT bucket, AVG(pauseMs) AS avg_pause FROM gc_pauses GROUP BY bucket)',
        );

        // Cell B can look up the alias by qualified ref to know the schema:
        const info = getActions().getByQualified('cell-A', 'gc_summary');
        expect(info).toBeDefined();
        expect(info?.columns).toEqual([
            { name: 'bucket', type: 'VARCHAR' },
            { name: 'avg_pause', type: 'DOUBLE' },
        ]);

        // The qualified view name "cell_A"."gc_summary" is now a TEMP VIEW in DuckDB.
        // A real Cell B query: SELECT * FROM "cell_A"."gc_summary" would resolve to it.
    });

    it('two cells each register an alias, both remain accessible', async () => {
        const queryFn = vi.fn(async (sql: string): Promise<any[]> => {
            if (sql.includes('information_schema.columns')) {
                if (sql.includes("table_name = 'gc_summary'"))
                    return [{ column_name: 'avg_pause', data_type: 'DOUBLE' }];
                if (sql.includes("table_name = 'cpu_hot'"))
                    return [{ column_name: 'method', data_type: 'VARCHAR' }, { column_name: 'samples', data_type: 'BIGINT' }];
            }
            return [];
        });
        const { getActions } = renderWithProvider(queryFn);

        await act(async () => {
            await getActions().registerAlias({
                cellId: 'cell-A', cellHandle: 'cell-A', cellIndex: 0, sqlIndex: 0,
                alias: 'gc_summary', sql: 'SELECT AVG(pauseMs) AS avg_pause FROM gc', materialized: false,
            });
            await getActions().registerAlias({
                cellId: 'cell-B', cellHandle: 'cell-B', cellIndex: 1, sqlIndex: 0,
                alias: 'cpu_hot', sql: 'SELECT method, COUNT(*) AS samples FROM cpu GROUP BY method ORDER BY samples DESC LIMIT 20', materialized: false,
            });
        });

        expect(getActions().getByBare('gc_summary')?.alias).toBe('gc_summary');
        expect(getActions().getByBare('cpu_hot')?.alias).toBe('cpu_hot');
        expect(getActions().getByQualified('cell-A', 'gc_summary')?.columns[0].name).toBe('avg_pause');
        expect(getActions().getByQualified('cell-B', 'cpu_hot')?.columns[1].name).toBe('samples');
    });
});
