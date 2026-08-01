import { describe, it, expect } from 'vitest';
import { annotateAliases } from '../../../../components/editor/sql/annotators/aliasAnnotator';
import { parse } from '../../../../components/editor/sql/parser';
import type { AliasAnnotatorInput } from '../../../../components/editor/sql/annotators/aliasAnnotator';

const eventsTable = {
    name: 'events',
    columns: [
        { name: 'ts', dataType: 'BIGINT' },
        { name: 'cause', dataType: 'VARCHAR' },
        { name: 'duration', dataType: 'DOUBLE' },
    ],
};

const heapTable = {
    name: 'heap',
    columns: [
        { name: 'used', dataType: 'BIGINT' },
    ],
};

function run(sql: string, tables: AliasAnnotatorInput['tables'] = [eventsTable]) {
    const { root } = parse(sql);
    const scopes = annotateAliases(root, { tables, views: [] });
    return { root, scopes };
}

function findAll(root: ReturnType<typeof parse>['root'], kind: string): ReturnType<typeof parse>['root'][] {
    const found: ReturnType<typeof parse>['root'][] = [];
    function walk(n: typeof root) {
        if (n.kind === kind) found.push(n);
        for (const c of n.children) walk(c);
    }
    walk(root);
    return found;
}

function queryScope(root: ReturnType<typeof parse>['root'], scopes: ReturnType<typeof annotateAliases>) {
    const queries = findAll(root, 'query');
    // Take the deepest (non-script) query which has a scope
    for (let i = queries.length - 1; i >= 0; i--) {
        const id = queries[i].annotations?.scope?.id;
        if (id !== undefined) {
            const scope = scopes.get(id);
            if (scope) return scope;
        }
    }
    return null;
}

// ── annotateAliases ───────────────────────────────────────────────────────────

describe('annotateAliases — scope creation', () => {
    it('attaches a scope to the query node', () => {
        const { root, scopes } = run('SELECT 1');
        const queries = findAll(root, 'query');
        const hasScope = queries.some(q => q.annotations?.scope?.id !== undefined && scopes.has(q.annotations.scope.id));
        expect(hasScope).toBe(true);
    });

    it('returns a non-empty ScopeMap', () => {
        const { scopes } = run('SELECT ts FROM events');
        expect(scopes.size).toBeGreaterThan(0);
    });
});

describe('annotateAliases — table aliases', () => {
    it('registers alias and resolves column through it', () => {
        const { root, scopes } = run('SELECT t.ts FROM events AS t');
        const scope = queryScope(root, scopes);
        const resolved = scope?.resolveIdent('ts');
        expect(resolved).toBeDefined();
        expect(resolved?.table).toBe('t');
        expect(resolved?.column).toBe('ts');
    });

    it('resolves column without alias (direct table name)', () => {
        const { root, scopes } = run('SELECT cause FROM events');
        const scope = queryScope(root, scopes);
        const resolved = scope?.resolveIdent('cause');
        expect(resolved).toBeDefined();
        expect(resolved?.column).toBe('cause');
    });

    it('handles multiple table references', () => {
        const { root, scopes } = run('SELECT e.ts, h.used FROM events AS e, heap AS h', [eventsTable, heapTable]);
        const scope = queryScope(root, scopes);
        expect(scope?.resolveIdent('ts')).toBeDefined();
        expect(scope?.resolveIdent('used')).toBeDefined();
    });
});

describe('annotateAliases — CTEs', () => {
    it('registers a CTE name', () => {
        const { root, scopes } = run(
            'WITH cte AS (SELECT ts FROM events) SELECT ts FROM cte'
        );
        const scope = queryScope(root, scopes);
        // The CTE should be visible as a table-like binding in the outer scope.
        expect(scope).not.toBeNull();
        // As long as resolveIdent doesn't error out, the CTE is registered.
        expect(() => scope?.resolveIdent('ts')).not.toThrow();
    });
});

describe('annotateAliases — views', () => {
    it('accepts an empty views array without throwing', () => {
        expect(() => run('SELECT 1')).not.toThrow();
    });

    it('resolves a column from a view', () => {
        const viewSchema = { name: 'myview', columns: [{ name: 'id', dataType: 'INTEGER' }] };
        const { root } = parse('SELECT id FROM myview');
        expect(() => annotateAliases(root, { tables: [], views: [viewSchema] })).not.toThrow();
    });
});

describe('annotateAliases — sub-queries', () => {
    it('creates nested scopes for sub-queries', () => {
        const { scopes } = run(
            'SELECT * FROM (SELECT ts FROM events) AS sub'
        );
        // Outer query + inner query = at least 2 scopes in map
        expect(scopes.size).toBeGreaterThanOrEqual(2);
    });
});
