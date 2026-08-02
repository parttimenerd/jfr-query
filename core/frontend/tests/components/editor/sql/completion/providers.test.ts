// Tests for SQL completion providers: symbols, keywords, and identifiers.
// Providers are plain objects with matches() and provide() methods — no
// CodeMirror DOM required. We construct minimal ProviderContext objects.

import { describe, it, expect } from 'vitest';
import { tableProvider, viewProvider, cteProvider, functionProvider, macroProvider }
    from '../../../../../components/editor/sql/completion/providers/symbols';
import { keywordProvider, overKeywordProvider }
    from '../../../../../components/editor/sql/completion/providers/keywords';
import { columnInScopeProvider, aliasProvider, qualifiedColumnProvider, selectAliasProvider }
    from '../../../../../components/editor/sql/completion/providers/identifiers';
import type { ProviderContext } from '../../../../../components/editor/sql/completion/types';
import type { SchemaForCompletion } from '../../../../../components/editor/completions';
import { Scope } from '../../../../../components/editor/sql/scope';
import { parse } from '../../../../../components/editor/sql/parser';
import { annotateAliases } from '../../../../../components/editor/sql/annotators/aliasAnnotator';
import type { SqlClause } from '../../../../../components/editor/sql/ast';

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

const EVENTS_TABLE = {
    name: 'events',
    columns: [
        { name: 'ts', type: 'BIGINT' },
        { name: 'cause', type: 'VARCHAR' },
    ],
};

const GC_TABLE = {
    name: 'GarbageCollection',
    columns: [
        { name: 'gcId', type: 'BIGINT' },
        { name: 'duration', type: 'INTERVAL' },
    ],
};

function makeSchema(overrides: Partial<SchemaForCompletion> = {}): SchemaForCompletion {
    const tables = overrides.tables ?? [EVENTS_TABLE, GC_TABLE];
    const views = overrides.views ?? [];
    return {
        tables,
        views,
        macros: overrides.macros ?? [],
        tableMap: new Map(tables.map(t => [t.name.toLowerCase(), t as any])),
        viewMap: new Map(views.map(v => [v.name.toLowerCase(), v as any])),
        ...overrides,
    };
}

const DUMMY_NODE = { kind: 'identifier', text: '', from: 0, to: 0, src: '', children: [], annotations: {} } as any;

function makeCtx(overrides: Partial<ProviderContext> = {}): ProviderContext {
    return {
        schema: makeSchema(),
        variables: {},
        runner: null,
        source: '',
        upTo: '',
        pos: 0,
        root: DUMMY_NODE,
        scopes: new Map(),
        cursorNode: DUMMY_NODE,
        scope: null,
        token: '',
        tokenFrom: 0,
        explicit: false,
        enclosingClause: null,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// tableProvider
// ---------------------------------------------------------------------------

describe('tableProvider — matches', () => {
    it('matches when enclosingClause is null (top-level)', () => {
        expect(tableProvider.matches(DUMMY_NODE, makeCtx({ enclosingClause: null }))).toBe(true);
    });

    it('matches in FROM clause', () => {
        expect(tableProvider.matches(DUMMY_NODE, makeCtx({ enclosingClause: 'from' }))).toBe(true);
    });

    it('matches in JOIN clause', () => {
        expect(tableProvider.matches(DUMMY_NODE, makeCtx({ enclosingClause: 'join' }))).toBe(true);
    });

    it('does not match when token contains a dot (qualified)', () => {
        expect(tableProvider.matches(DUMMY_NODE, makeCtx({ token: 't.col', enclosingClause: 'from' }))).toBe(false);
    });
});

describe('tableProvider — provide', () => {
    it('returns all tables when token is empty', () => {
        const result = tableProvider.provide(DUMMY_NODE, makeCtx({ enclosingClause: 'from' }));
        expect(result.items.map(i => i.label)).toContain('events');
        expect(result.items.map(i => i.label)).toContain('GarbageCollection');
    });

    it('filters by prefix (case-insensitive)', () => {
        const result = tableProvider.provide(DUMMY_NODE, makeCtx({
            enclosingClause: 'from',
            token: 'Garb',
        }));
        expect(result.items.map(i => i.label)).toContain('GarbageCollection');
        expect(result.items.map(i => i.label)).not.toContain('events');
    });

    it('returns empty when no table matches prefix', () => {
        const result = tableProvider.provide(DUMMY_NODE, makeCtx({ token: 'zzz' }));
        expect(result.items).toHaveLength(0);
    });

    it('labels items with type=table', () => {
        const result = tableProvider.provide(DUMMY_NODE, makeCtx());
        expect(result.items.every(i => i.type === 'table')).toBe(true);
    });

    it('includes row count in detail when rowCount is set', () => {
        const schema = makeSchema({
            tables: [{ name: 'events', columns: [], rowCount: 1234 }],
        });
        const result = tableProvider.provide(DUMMY_NODE, makeCtx({ schema }));
        expect(result.items[0].detail).toMatch(/1,234/);
    });
});

// ---------------------------------------------------------------------------
// viewProvider
// ---------------------------------------------------------------------------

describe('viewProvider — provide', () => {
    it('returns views from schema', () => {
        const schema = makeSchema({
            tables: [],
            views: [{ name: 'gc_summary', columns: [{ name: 'id', type: 'INT' }], query: 'SELECT 1' }],
        });
        const result = viewProvider.provide(DUMMY_NODE, makeCtx({ schema, enclosingClause: 'from' }));
        expect(result.items.map(i => i.label)).toContain('gc_summary');
        expect(result.items[0].type).toBe('view');
    });

    it('returns empty when no views exist', () => {
        const result = viewProvider.provide(DUMMY_NODE, makeCtx({ enclosingClause: 'from' }));
        expect(result.items).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// cteProvider
// ---------------------------------------------------------------------------

describe('cteProvider — matches', () => {
    it('returns false when scope is null', () => {
        expect(cteProvider.matches(DUMMY_NODE, makeCtx({ scope: null }))).toBe(false);
    });

    it('returns true in FROM clause with a scope', () => {
        expect(cteProvider.matches(DUMMY_NODE, makeCtx({
            scope: new Scope(),
            enclosingClause: 'from',
        }))).toBe(true);
    });
});

describe('cteProvider — provide', () => {
    it('returns empty when no CTEs in scope', () => {
        const result = cteProvider.provide(DUMMY_NODE, makeCtx({ scope: new Scope() }));
        expect(result.items).toHaveLength(0);
    });

    it('lists CTEs from scope', () => {
        const scope = new Scope();
        scope.addCte({ name: 'pauses', columns: [{ name: 'id', type: 'INT' }], recursive: false });
        const result = cteProvider.provide(DUMMY_NODE, makeCtx({ scope, enclosingClause: 'from' }));
        expect(result.items.map(i => i.label)).toContain('pauses');
        expect(result.items[0].detail).toMatch(/CTE/);
    });
});

// ---------------------------------------------------------------------------
// functionProvider
// ---------------------------------------------------------------------------

describe('functionProvider — matches', () => {
    it('matches in SELECT clause', () => {
        expect(functionProvider.matches(DUMMY_NODE, makeCtx({ enclosingClause: 'select' }))).toBe(true);
    });

    it('does not match in FROM clause', () => {
        expect(functionProvider.matches(DUMMY_NODE, makeCtx({ enclosingClause: 'from' }))).toBe(false);
    });
});

describe('functionProvider — provide', () => {
    it('returns function completions in SELECT context', () => {
        const result = functionProvider.provide(DUMMY_NODE, makeCtx({ enclosingClause: 'select' }));
        expect(result.items.length).toBeGreaterThan(0);
        expect(result.items.every(i => i.type === 'function')).toBe(true);
    });

    it('filters by prefix', () => {
        const result = functionProvider.provide(DUMMY_NODE, makeCtx({
            enclosingClause: 'select',
            token: 'COUNT',
        }));
        expect(result.items.some(i => i.label.toLowerCase().startsWith('count'))).toBe(true);
        expect(result.items.every(i => i.label.toLowerCase().startsWith('count'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// macroProvider
// ---------------------------------------------------------------------------

describe('macroProvider — provide', () => {
    it('lists macros from schema', () => {
        const schema = makeSchema({
            macros: [{
                name: 'my_macro',
                parameters: ['a', 'b'],
                sql: 'SELECT a + b',
                returnType: 'INT',
            }],
        });
        const result = macroProvider.provide(DUMMY_NODE, makeCtx({ schema }));
        const macro = result.items.find(i => i.label === 'my_macro');
        expect(macro).toBeDefined();
        expect(macro!.detail).toMatch(/macro/);
        expect(macro!.apply).toBe('my_macro(');
    });

    it('returns empty when schema has no macros', () => {
        const result = macroProvider.provide(DUMMY_NODE, makeCtx());
        expect(result.items).toHaveLength(0);
    });

    it('filters macros by prefix', () => {
        const schema = makeSchema({
            macros: [
                { name: 'get_gc', parameters: [], sql: 'SELECT 1', returnType: 'TABLE' },
                { name: 'list_threads', parameters: [], sql: 'SELECT 2', returnType: 'TABLE' },
            ],
        });
        const result = macroProvider.provide(DUMMY_NODE, makeCtx({ schema, token: 'get' }));
        expect(result.items.map(i => i.label)).toContain('get_gc');
        expect(result.items.map(i => i.label)).not.toContain('list_threads');
    });
});

// ---------------------------------------------------------------------------
// keywordProvider
// ---------------------------------------------------------------------------

describe('keywordProvider — matches', () => {
    it('always matches when token has no dot', () => {
        expect(keywordProvider.matches(DUMMY_NODE, makeCtx())).toBe(true);
    });

    it('does not match when token contains a dot', () => {
        expect(keywordProvider.matches(DUMMY_NODE, makeCtx({ token: 'a.b' }))).toBe(false);
    });
});

describe('keywordProvider — provide', () => {
    it('returns keywords for SELECT clause', () => {
        const result = keywordProvider.provide(DUMMY_NODE, makeCtx({ enclosingClause: 'select' }));
        expect(result.items.length).toBeGreaterThan(0);
        expect(result.items.every(i => i.type === 'keyword')).toBe(true);
    });

    it('returns top-level keywords when enclosingClause is null', () => {
        const result = keywordProvider.provide(DUMMY_NODE, makeCtx({ enclosingClause: null }));
        expect(result.items.some(i => /SELECT/i.test(i.label))).toBe(true);
    });

    it('filters by prefix', () => {
        const result = keywordProvider.provide(DUMMY_NODE, makeCtx({
            enclosingClause: null,
            token: 'sel',
        }));
        expect(result.items.length).toBeGreaterThan(0);
        expect(result.items.every(i => /^sel/i.test(i.label))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// overKeywordProvider
// ---------------------------------------------------------------------------

describe('overKeywordProvider — matches', () => {
    it('matches when upTo ends with a window function call in SELECT', () => {
        const ctx = makeCtx({
            enclosingClause: 'select',
            token: '',
            upTo: 'SELECT ROW_NUMBER() ',
        });
        expect(overKeywordProvider.matches(DUMMY_NODE, ctx)).toBe(true);
    });

    it('does not match in FROM clause', () => {
        const ctx = makeCtx({
            enclosingClause: 'from',
            upTo: 'SELECT ROW_NUMBER() FROM ',
        });
        expect(overKeywordProvider.matches(DUMMY_NODE, ctx)).toBe(false);
    });

    it('does not match when not preceded by a window function call', () => {
        const ctx = makeCtx({
            enclosingClause: 'select',
            upTo: 'SELECT id ',
        });
        expect(overKeywordProvider.matches(DUMMY_NODE, ctx)).toBe(false);
    });
});

describe('overKeywordProvider — provide', () => {
    it('returns OVER when token prefix matches', () => {
        const ctx = makeCtx({
            enclosingClause: 'select',
            upTo: 'SELECT ROW_NUMBER() ',
            token: '',
        });
        const result = overKeywordProvider.provide(DUMMY_NODE, ctx);
        expect(result.items.some(i => i.label === 'OVER')).toBe(true);
    });

    it('returns empty when token prefix does not match OVER', () => {
        const ctx = makeCtx({
            enclosingClause: 'select',
            upTo: 'SELECT ROW_NUMBER() ',
            token: 'xyz',
        });
        const result = overKeywordProvider.provide(DUMMY_NODE, ctx);
        expect(result.items).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// columnInScopeProvider
// ---------------------------------------------------------------------------

describe('columnInScopeProvider — matches', () => {
    it('returns false in FROM clause (not a column context)', () => {
        expect(columnInScopeProvider.matches(DUMMY_NODE, makeCtx({ enclosingClause: 'from' }))).toBe(false);
    });

    it('returns true in SELECT clause', () => {
        expect(columnInScopeProvider.matches(DUMMY_NODE, makeCtx({ enclosingClause: 'select' }))).toBe(true);
    });

    it('returns false when token contains a dot', () => {
        expect(columnInScopeProvider.matches(DUMMY_NODE, makeCtx({
            enclosingClause: 'select',
            token: 't.col',
        }))).toBe(false);
    });
});

describe('columnInScopeProvider — provide', () => {
    it('offers schema columns as fallback when scope has no tables', () => {
        const result = columnInScopeProvider.provide(DUMMY_NODE, makeCtx({ enclosingClause: 'select' }));
        const labels = result.items.map(i => i.label);
        expect(labels).toContain('ts');
        expect(labels).toContain('cause');
    });

    it('filters by prefix', () => {
        const result = columnInScopeProvider.provide(DUMMY_NODE, makeCtx({
            enclosingClause: 'select',
            token: 'ca',
        }));
        expect(result.items.every(i => i.label.toLowerCase().startsWith('ca'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// aliasProvider
// ---------------------------------------------------------------------------

describe('aliasProvider — matches', () => {
    it('returns false when scope is null', () => {
        expect(aliasProvider.matches(DUMMY_NODE, makeCtx({ scope: null, enclosingClause: 'select' }))).toBe(false);
    });

    it('returns false outside column context', () => {
        expect(aliasProvider.matches(DUMMY_NODE, makeCtx({ scope: new Scope(), enclosingClause: 'from' }))).toBe(false);
    });

    it('returns true in SELECT clause with a scope', () => {
        expect(aliasProvider.matches(DUMMY_NODE, makeCtx({
            scope: new Scope(),
            enclosingClause: 'select',
        }))).toBe(true);
    });
});

describe('aliasProvider — provide', () => {
    it('surfaces aliases that differ from their target table name', () => {
        const scope = new Scope();
        scope.addTable({ alias: 'e', target: 'events', kind: 'table', columns: EVENTS_TABLE.columns as any });
        const result = aliasProvider.provide(DUMMY_NODE, makeCtx({
            scope,
            enclosingClause: 'select',
        }));
        expect(result.items.map(i => i.label)).toContain('e');
    });

    it('does not surface aliases identical to their target name', () => {
        const scope = new Scope();
        scope.addTable({ alias: 'events', target: 'events', kind: 'table', columns: EVENTS_TABLE.columns as any });
        const result = aliasProvider.provide(DUMMY_NODE, makeCtx({
            scope,
            enclosingClause: 'select',
        }));
        expect(result.items.map(i => i.label)).not.toContain('events');
    });
});

// ---------------------------------------------------------------------------
// qualifiedColumnProvider — matches
// ---------------------------------------------------------------------------

describe('qualifiedColumnProvider — matches', () => {
    it('matches when token contains a dot', () => {
        expect(qualifiedColumnProvider.matches(DUMMY_NODE, makeCtx({ token: 't.col' }))).toBe(true);
    });

    it('does not match when token has no dot and node is plain ident', () => {
        expect(qualifiedColumnProvider.matches(DUMMY_NODE, makeCtx({ token: 'col' }))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// selectAliasProvider — matches
// ---------------------------------------------------------------------------

describe('selectAliasProvider — matches', () => {
    it('matches in ORDER BY clause', () => {
        expect(selectAliasProvider.matches(DUMMY_NODE, makeCtx({ enclosingClause: 'orderBy' }))).toBe(true);
    });

    it('matches in HAVING clause', () => {
        expect(selectAliasProvider.matches(DUMMY_NODE, makeCtx({ enclosingClause: 'having' }))).toBe(true);
    });

    it('does not match in SELECT clause', () => {
        expect(selectAliasProvider.matches(DUMMY_NODE, makeCtx({ enclosingClause: 'select' }))).toBe(false);
    });

    it('does not match when token contains a dot', () => {
        expect(selectAliasProvider.matches(DUMMY_NODE, makeCtx({
            enclosingClause: 'orderBy',
            token: 'a.b',
        }))).toBe(false);
    });
});
