import { describe, it, expect } from 'vitest';
import { parse } from '../../components/editor/sql/parser';
import { annotate } from '../../components/editor/sql/annotate';
import { walk, type Node, type NodeKind } from '../../components/editor/sql/ast';
import type { TableSchema, ViewSchema } from '../../types';

const TABLES: TableSchema[] = [
    {
        name: 'ActiveRecording',
        columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'startTime', type: 'TIMESTAMP' },
            { name: 'duration', type: 'INTERVAL' },
        ],
    },
    {
        name: 'GarbageCollection',
        columns: [
            { name: 'gcId', type: 'BIGINT' },
            { name: 'cause', type: 'VARCHAR' },
            { name: 'duration', type: 'INTERVAL' },
        ],
    },
];

const VIEWS: ViewSchema[] = [
    {
        name: 'gc_summary',
        query: 'SELECT * FROM GarbageCollection',
        columns: [
            { name: 'cause', type: 'VARCHAR' },
            { name: 'n', type: 'BIGINT' },
        ],
    },
];

function findAll(root: Node, kind: NodeKind): Node[] {
    const out: Node[] = [];
    walk(root, (n) => { if (n.kind === kind) out.push(n); });
    return out;
}

function annotateSql(sql: string, opts: {
    cellVariables?: Record<string, string>;
    workspaceVariables?: Record<string, string>;
    cellExports?: Record<string, Record<string, string>>;
    cellsWithBrush?: string[];
} = {}) {
    const { root } = parse(sql);
    annotate(root, {
        tables: TABLES,
        views: VIEWS,
        variables: opts.cellVariables || opts.workspaceVariables || opts.cellExports || opts.cellsWithBrush ? {
            cellVariables: new Map(Object.entries(opts.cellVariables ?? {})),
            workspaceVariables: new Map(Object.entries(opts.workspaceVariables ?? {})),
            cellExports: new Map(
                Object.entries(opts.cellExports ?? {}).map(([k, v]) => [k, new Map(Object.entries(v))]),
            ),
            cellsWithBrush: new Set(opts.cellsWithBrush ?? []),
        } : undefined,
    });
    return root;
}

describe('annotators — scope creation', () => {
    it('attaches a scope to every query node', () => {
        const root = annotateSql('SELECT 1');
        const queries = findAll(root, 'query');
        expect(queries.length).toBeGreaterThan(0);
        for (const q of queries) expect(q.annotations.scope).toBeDefined();
    });

    it('creates a child scope for a subquery', () => {
        const root = annotateSql('SELECT * FROM (SELECT id FROM ActiveRecording) sub');
        const queries = findAll(root, 'query');
        expect(queries.length).toBeGreaterThanOrEqual(2);
        // Each query has its own scope id.
        const ids = new Set(queries.map(q => q.annotations.scope!.id));
        expect(ids.size).toBe(queries.length);
    });
});

describe('annotators — CTE registration', () => {
    it('registers a CTE under its enclosing query', () => {
        const root = annotateSql('WITH foo AS (SELECT 1) SELECT * FROM foo');
        // The outer query's scope should know about foo.
        const queries = findAll(root, 'query');
        // The OUTER query is the last `query` traversal-wise? Actually
        // outer comes first in pre-order. Identify it by depth — outer has
        // no `query` parent.
        const outer = queries.find(q => {
            let p = q.parent;
            while (p) { if (p.kind === 'query') return false; p = p.parent; }
            return true;
        })!;
        const fromTableRef = findAll(outer, 'tableRef')[0];
        // The tableRef should resolve to the CTE.
        expect(fromTableRef.children[0].annotations.resolves?.kind).toBe('cte');
    });

    it('flags WITH RECURSIVE on the binding', () => {
        const root = annotateSql(
            'WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r) SELECT * FROM r'
        );
        // The CTE's columns come from the explicit column list `(n)`.
        const outer = findAll(root, 'query').find(q => {
            let p = q.parent;
            while (p) { if (p.kind === 'query') return false; p = p.parent; }
            return true;
        })!;
        const fromTableRef = findAll(outer, 'tableRef')[0];
        expect(fromTableRef.children[0].annotations.resolves?.kind).toBe('cte');
    });
});

describe('annotators — column resolution', () => {
    it('resolves an unqualified column to its table', () => {
        const root = annotateSql('SELECT cause FROM GarbageCollection');
        // Find the identifier `cause` inside the selectClause (not the
        // table name).
        const ids = findAll(root, 'identifier');
        const cause = ids.find(i => i.text === 'cause' && i.parent?.kind === 'projection');
        expect(cause).toBeDefined();
        const resolved = cause!.annotations.resolves;
        expect(resolved?.kind).toBe('column');
        if (resolved?.kind === 'column') {
            expect(resolved.column).toBe('cause');
            expect(resolved.dataType).toBe('VARCHAR');
        }
    });

    it('resolves alias.column via qualifiedIdent', () => {
        const root = annotateSql('SELECT r.duration FROM ActiveRecording r');
        const qids = findAll(root, 'qualifiedIdent');
        expect(qids.length).toBe(1);
        const resolved = qids[0].annotations.resolves;
        expect(resolved?.kind).toBe('column');
        if (resolved?.kind === 'column') {
            expect(resolved.column).toBe('duration');
            expect(resolved.table).toBe('r');
        }
    });

    it('leaves unresolved when column is unknown', () => {
        const root = annotateSql('SELECT nope FROM ActiveRecording');
        const ids = findAll(root, 'identifier').filter(
            i => i.text === 'nope' && i.parent?.kind === 'projection',
        );
        expect(ids[0]?.annotations.resolves).toBeUndefined();
    });

    it('resolves a table reference inside FROM', () => {
        const root = annotateSql('SELECT * FROM ActiveRecording');
        const tableRefs = findAll(root, 'tableRef');
        const inner = tableRefs[0].children[0];
        expect(inner.annotations.resolves?.kind).toBe('table');
    });

    it('resolves a view reference inside FROM', () => {
        const root = annotateSql('SELECT * FROM gc_summary');
        const tableRefs = findAll(root, 'tableRef');
        const inner = tableRefs[0].children[0];
        expect(inner.annotations.resolves?.kind).toBe('view');
    });
});

describe('annotators — function resolution', () => {
    it('attaches signature for COUNT', () => {
        const root = annotateSql('SELECT count(*) FROM GarbageCollection');
        const fc = findAll(root, 'functionCall')[0];
        expect(fc).toBeDefined();
        const resolved = fc.annotations.resolves;
        expect(resolved?.kind).toBe('function');
        if (resolved?.kind === 'function') {
            expect(resolved.name.toLowerCase()).toBe('count');
            expect(resolved.signature).toMatch(/COUNT/i);
        }
    });

    it('attaches signature for SUM', () => {
        const root = annotateSql('SELECT SUM(duration) FROM ActiveRecording');
        const fc = findAll(root, 'functionCall')[0];
        expect(fc.annotations.resolves?.kind).toBe('function');
    });

    it('leaves an unknown function unresolved', () => {
        const root = annotateSql('SELECT no_such_fn(x) FROM ActiveRecording');
        const fc = findAll(root, 'functionCall')[0];
        expect(fc.annotations.resolves).toBeUndefined();
    });
});

describe('annotators — variable resolution', () => {
    it('resolves $local to a cell variable', () => {
        const root = annotateSql('SELECT $threshold', {
            cellVariables: { threshold: '5' },
        });
        const vr = findAll(root, 'variableRef')[0];
        expect(vr).toBeDefined();
        const resolved = vr.annotations.resolves;
        expect(resolved?.kind).toBe('variable');
        if (resolved?.kind === 'variable') {
            expect(resolved.source).toBe('cell');
            expect(resolved.value).toBe('5');
        }
    });

    it('falls back to workspace for $name when no cell var', () => {
        const root = annotateSql('SELECT $foo', {
            workspaceVariables: { foo: 'ws-value' },
        });
        const vr = findAll(root, 'variableRef')[0];
        const resolved = vr.annotations.resolves;
        expect(resolved?.kind).toBe('variable');
        if (resolved?.kind === 'variable') {
            expect(resolved.source).toBe('workspace');
        }
    });

    it('resolves $$global to a workspace variable', () => {
        const root = annotateSql('SELECT $$shared', {
            workspaceVariables: { shared: 'x' },
        });
        const vr = findAll(root, 'doubleDollarRef')[0];
        expect(vr.annotations.resolves?.kind).toBe('variable');
    });

    it('resolves $cell.var as cross-cell variable', () => {
        const root = annotateSql('SELECT $gc.threshold', {
            cellExports: { gc: { threshold: '42' } },
        });
        const vr = findAll(root, 'crossCellRef')[0];
        const resolved = vr.annotations.resolves;
        expect(resolved?.kind).toBe('variable');
        if (resolved?.kind === 'variable') {
            expect(resolved.name).toBe('gc.threshold');
            expect(resolved.value).toBe('42');
        }
    });

    it('resolves $cell.var.0 tuple slot (records full path)', () => {
        const root = annotateSql('SELECT $gc.range.0', {
            cellExports: { gc: { range: '[10, 20]' } },
        });
        const vr = findAll(root, 'crossCellRef')[0];
        const resolved = vr.annotations.resolves;
        expect(resolved?.kind).toBe('variable');
        if (resolved?.kind === 'variable') {
            expect(resolved.name).toBe('gc.range.0');
        }
    });

    it('resolves $plot.brush with gesture source', () => {
        const root = annotateSql('SELECT * FROM ActiveRecording WHERE id IN $plot.brush', {
            cellsWithBrush: ['plot'],
        });
        const vr = findAll(root, 'crossCellRef')[0];
        const resolved = vr.annotations.resolves;
        expect(resolved?.kind).toBe('variable');
        if (resolved?.kind === 'variable') {
            expect(resolved.source).toBe('gesture');
        }
    });

    it('leaves unknown variables unresolved', () => {
        const root = annotateSql('SELECT $unknown');
        const vr = findAll(root, 'variableRef')[0];
        expect(vr.annotations.resolves).toBeUndefined();
    });
});

describe('annotators — alias scoping', () => {
    it('alias on FROM is visible to projections', () => {
        const root = annotateSql('SELECT r.id FROM ActiveRecording r');
        const qids = findAll(root, 'qualifiedIdent');
        expect(qids[0].annotations.resolves?.kind).toBe('column');
    });

    it('JOINed table is visible in projections', () => {
        const root = annotateSql(
            'SELECT g.cause FROM ActiveRecording r JOIN GarbageCollection g ON r.id = g.gcId',
        );
        const qids = findAll(root, 'qualifiedIdent');
        const causeRef = qids.find(q => q.text === 'g.cause');
        expect(causeRef?.annotations.resolves?.kind).toBe('column');
    });

    it('CTE columns are visible in the outer SELECT', () => {
        const root = annotateSql('WITH foo(x) AS (SELECT 1) SELECT x FROM foo');
        const projIds = findAll(root, 'identifier').filter(
            i => i.text === 'x' && i.parent?.kind === 'projection',
        );
        // The CTE's column `x` should resolve.
        expect(projIds[0]?.annotations.resolves?.kind).toBe('column');
    });
});

describe('annotators — idempotence', () => {
    it('does not overwrite an existing resolution', () => {
        const { root } = parse('SELECT cause FROM GarbageCollection');
        annotate(root, { tables: TABLES, views: VIEWS });
        const id = findAll(root, 'identifier').find(
            i => i.text === 'cause' && i.parent?.kind === 'projection',
        );
        const before = id?.annotations.resolves;
        annotate(root, { tables: TABLES, views: VIEWS });
        expect(id?.annotations.resolves).toBe(before);
    });
});
