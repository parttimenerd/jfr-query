import { describe, it, expect } from 'vitest';
import { annotate } from '../../../../components/editor/sql/annotate';
import { parse } from '../../../../components/editor/sql/parser';
import type { Node } from '../../../../components/editor/sql/ast';

const eventsTable = {
    name: 'events',
    columns: [
        { name: 'ts', dataType: 'BIGINT' },
        { name: 'cause', dataType: 'VARCHAR' },
        { name: 'duration', dataType: 'DOUBLE' },
    ],
};

const logsView = {
    name: 'logs',
    columns: [{ name: 'msg', dataType: 'VARCHAR' }],
};

function findAll(root: Node, kind: string): Node[] {
    const found: Node[] = [];
    function walk(n: Node) {
        if (n.kind === kind) found.push(n);
        for (const c of n.children) walk(c);
    }
    walk(root);
    return found;
}

function run(sql: string, opts: Parameters<typeof annotate>[1] = { tables: [eventsTable], views: [] }) {
    const { root } = parse(sql);
    const result = annotate(root, opts);
    return { root, ...result };
}

// ── annotate — alias pass ─────────────────────────────────────────────────────

describe('annotate — alias pass', () => {
    it('returns a scopes map', () => {
        const { scopes } = run('SELECT ts FROM events');
        expect(scopes).toBeDefined();
        expect(scopes instanceof Map).toBe(true);
    });

    it('builds scopes for queries in the source', () => {
        const { scopes } = run('SELECT ts FROM events');
        expect(scopes.size).toBeGreaterThan(0);
    });
});

// ── annotate — schema pass ────────────────────────────────────────────────────

describe('annotate — schema pass', () => {
    it('resolves a column identifier to kind:column', () => {
        const { root } = run('SELECT ts FROM events');
        const identifiers = findAll(root, 'identifier');
        const ts = identifiers.find(n => n.text === 'ts' && n.annotations?.resolves?.kind === 'column');
        expect(ts).toBeDefined();
        expect((ts?.annotations.resolves as any)?.column).toBe('ts');
    });

    it('resolves a table identifier to kind:table', () => {
        const { root } = run('SELECT ts FROM events');
        const identifiers = findAll(root, 'identifier');
        const tbl = identifiers.find(n => n.text === 'events' && n.annotations?.resolves?.kind === 'table');
        expect(tbl).toBeDefined();
        expect((tbl?.annotations.resolves as any)?.name).toBe('events');
    });

    it('resolves a view identifier to kind:view', () => {
        const { root } = run('SELECT msg FROM logs', { tables: [], views: [logsView] });
        const identifiers = findAll(root, 'identifier');
        const viewIdent = identifiers.find(n => n.text === 'logs' && n.annotations?.resolves?.kind === 'view');
        expect(viewIdent).toBeDefined();
    });
});

// ── annotate — function pass ──────────────────────────────────────────────────

describe('annotate — function pass', () => {
    it('resolves COUNT to kind:function', () => {
        const { root } = run('SELECT COUNT(*) FROM events');
        const calls = findAll(root, 'functionCall');
        const count = calls.find(n => n.annotations?.resolves?.kind === 'function');
        expect(count).toBeDefined();
        expect((count?.annotations.resolves as any)?.name.toUpperCase()).toBe('COUNT');
    });

    it('does not crash for unknown functions', () => {
        expect(() => run('SELECT unknown_fn(ts) FROM events')).not.toThrow();
    });
});

// ── annotate — variable pass ──────────────────────────────────────────────────

describe('annotate — variable pass', () => {
    it('resolves $limit to kind:variable when variables provided', () => {
        const { root } = run('SELECT ts FROM events LIMIT $limit', {
            tables: [eventsTable],
            views: [],
            variables: {
                cellVariables: new Map([['limit', '100']]),
                workspaceVariables: new Map(),
                cellExports: new Map(),
            },
        });
        const varRefs = findAll(root, 'variableRef');
        const limitRef = varRefs.find(n => n.annotations?.resolves?.kind === 'variable');
        expect(limitRef).toBeDefined();
        expect((limitRef?.annotations.resolves as any)?.name).toBe('limit');
    });

    it('skips variable pass when variables not provided', () => {
        expect(() => run('SELECT $limit FROM events')).not.toThrow();
    });
});

// ── annotate — combined result ────────────────────────────────────────────────

describe('annotate — all passes together', () => {
    it('all four passes run without error on a complex query', () => {
        const sql = 'SELECT e.cause, COUNT(*) AS cnt FROM events AS e WHERE e.ts > $start GROUP BY e.cause ORDER BY cnt DESC LIMIT $limit';
        expect(() =>
            run(sql, {
                tables: [eventsTable],
                views: [],
                variables: {
                    cellVariables: new Map([['start', '0'], ['limit', '50']]),
                    workspaceVariables: new Map(),
                    cellExports: new Map(),
                },
            })
        ).not.toThrow();
    });

    it('returns a scopes map for a CTE query', () => {
        const sql = 'WITH recent AS (SELECT * FROM events LIMIT 10) SELECT cause FROM recent';
        const { scopes } = run(sql);
        expect(scopes.size).toBeGreaterThan(0);
    });
});
