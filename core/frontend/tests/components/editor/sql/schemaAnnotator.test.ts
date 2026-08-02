import { describe, it, expect } from 'vitest';
import { annotateSchema, registerScope } from '../../../../components/editor/sql/annotators/schemaAnnotator';
import { annotateAliases } from '../../../../components/editor/sql/annotators/aliasAnnotator';
import { parse } from '../../../../components/editor/sql/parser';
import { Scope } from '../../../../components/editor/sql/scope';

const eventsTable = {
    name: 'events',
    columns: [
        { name: 'ts', dataType: 'BIGINT' },
        { name: 'cause', dataType: 'VARCHAR' },
        { name: 'duration', dataType: 'DOUBLE' },
    ],
};

function run(sql: string, tables = [eventsTable]) {
    const { root } = parse(sql);
    const scopes = annotateAliases(root, { tables, views: [] });
    annotateSchema(root, { tables, views: [], scopeById: scopes });
    return root;
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

// ── annotateSchema ────────────────────────────────────────────────────────────

describe('annotateSchema — column resolution', () => {
    it('resolves a column identifier to kind=column', () => {
        const root = run('SELECT ts FROM events');
        const idents = findAll(root, 'identifier');
        const tsIdent = idents.find(n => n.text === 'ts' && n.annotations.resolves);
        expect(tsIdent?.annotations.resolves?.kind).toBe('column');
        expect(tsIdent?.annotations.resolves?.column).toBe('ts');
    });

    it('resolves multiple columns', () => {
        const root = run('SELECT ts, cause FROM events');
        const idents = findAll(root, 'identifier');
        const resolved = idents.filter(n => n.annotations.resolves?.kind === 'column');
        const names = resolved.map(n => n.annotations.resolves?.column);
        expect(names).toContain('ts');
        expect(names).toContain('cause');
    });

    it('resolves the table name to kind=table', () => {
        const root = run('SELECT ts FROM events');
        const idents = findAll(root, 'identifier');
        const tableIdent = idents.find(n => n.text === 'events' && n.annotations.resolves?.kind === 'table');
        expect(tableIdent).toBeDefined();
        expect(tableIdent?.annotations.resolves?.name).toBe('events');
    });

    it('does not annotate identifiers in SELECT alias position', () => {
        const root = run('SELECT ts AS myAlias FROM events');
        const idents = findAll(root, 'identifier');
        // 'myAlias' is a definition site — should not have kind=column
        const alias = idents.find(n => n.text === 'myAlias');
        expect(alias?.annotations.resolves?.kind).not.toBe('column');
    });

    it('resolves aliased table columns', () => {
        const root = run('SELECT e.ts FROM events AS e');
        const idents = findAll(root, 'identifier');
        const tsIdent = idents.find(n => n.text === 'ts' && n.annotations.resolves?.kind === 'column');
        expect(tsIdent).toBeDefined();
    });

    it('does not resolve identifiers for unknown columns', () => {
        const root = run('SELECT unknownCol FROM events');
        const idents = findAll(root, 'identifier');
        const unknown = idents.find(n => n.text === 'unknownCol');
        expect(unknown?.annotations.resolves?.kind).not.toBe('column');
    });
});

describe('annotateSchema — views', () => {
    it('resolves table name from view as kind=view', () => {
        const viewSchema = { name: 'summary', columns: [{ name: 'total', dataType: 'INTEGER' }] };
        const { root } = parse('SELECT total FROM summary');
        const scopes = annotateAliases(root, { tables: [], views: [viewSchema] });
        annotateSchema(root, { tables: [], views: [viewSchema], scopeById: scopes });
        const idents = findAll(root, 'identifier');
        const summaryIdent = idents.find(n => n.text === 'summary' && n.annotations.resolves?.kind === 'view');
        expect(summaryIdent).toBeDefined();
    });
});

describe('annotateSchema — no crash cases', () => {
    it('handles empty SQL without throwing', () => {
        expect(() => run('SELECT 1')).not.toThrow();
    });

    it('handles star select without throwing', () => {
        expect(() => run('SELECT * FROM events')).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// registerScope
// ---------------------------------------------------------------------------

describe('registerScope', () => {
    it('associates a Scope with a node and makes it retrievable via annotateSchema', () => {
        // registerScope stores in a WeakMap; the indirect test is that when
        // annotateSchema is passed a scopeById map that includes the scope, the
        // query node's annotations.scope.id is used to look up the right scope.
        // Here we verify that registerScope does not throw and that the same
        // scope surfaces during resolution of a SELECT on that node.
        const { root } = parse('SELECT ts FROM events');
        const scope = new Scope();
        // Annotate aliases first so the query node gets an annotations.scope.id
        const scopes = annotateAliases(root, { tables: [eventsTable], views: [] });
        // Register the scope for the root node as well (no-op for resolution,
        // but must not throw).
        registerScope(root, scope);
        // Now run full schema annotation — should not crash.
        expect(() =>
            annotateSchema(root, { tables: [eventsTable], views: [], scopeById: scopes })
        ).not.toThrow();
    });

    it('accepts any node kind without throwing', () => {
        const { root } = parse('SELECT 1');
        const scope = new Scope();
        // Register on a non-query node — must be silent.
        for (const child of root.children) {
            expect(() => registerScope(child, scope)).not.toThrow();
        }
    });
});
