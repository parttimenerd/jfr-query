import { describe, it, expect, beforeEach } from 'vitest';
import { Scope, _resetScopeIdsForTests } from '../../components/editor/sql/scope';
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

describe('Scope — basic id and parent', () => {
    beforeEach(_resetScopeIdsForTests);

    it('gives each scope a unique id', () => {
        const a = new Scope();
        const b = new Scope();
        expect(a.id).not.toBe(b.id);
    });

    it('parent chain links upward', () => {
        const outer = new Scope();
        const inner = new Scope(outer);
        expect(inner.parent).toBe(outer);
        expect(outer.parent).toBeNull();
    });
});

describe('Scope — CTE registration and visibility', () => {
    beforeEach(_resetScopeIdsForTests);

    it('registers a CTE and finds it on the same scope', () => {
        const s = new Scope();
        s.addCte({ name: 'foo', columns: [{ name: 'x', type: 'INT' }], recursive: false });
        const hit = s.findCte('foo');
        expect(hit).toBeDefined();
        expect(hit!.columns.length).toBe(1);
    });

    it('CTE lookup is case-insensitive', () => {
        const s = new Scope();
        s.addCte({ name: 'Foo', columns: [], recursive: false });
        expect(s.findCte('FOO')).toBeDefined();
        expect(s.findCte('foo')).toBeDefined();
    });

    it('child scope sees parent CTEs', () => {
        const outer = new Scope();
        outer.addCte({ name: 'foo', columns: [], recursive: false });
        const inner = new Scope(outer);
        expect(inner.findCte('foo')).toBeDefined();
    });

    it('child scope CTE shadows parent CTE', () => {
        const outer = new Scope();
        outer.addCte({ name: 'foo', columns: [{ name: 'outer', type: 'X' }], recursive: false });
        const inner = new Scope(outer);
        inner.addCte({ name: 'foo', columns: [{ name: 'inner', type: 'X' }], recursive: false });
        expect(inner.findCte('foo')!.columns[0].name).toBe('inner');
    });

    it('listCtes deduplicates by name and prefers nearest', () => {
        const outer = new Scope();
        outer.addCte({ name: 'foo', columns: [{ name: 'a', type: 'INT' }], recursive: false });
        const inner = new Scope(outer);
        inner.addCte({ name: 'foo', columns: [{ name: 'b', type: 'INT' }], recursive: false });
        const list = inner.listCtes();
        expect(list.length).toBe(1);
        expect(list[0].columns[0].name).toBe('b');
    });
});

describe('Scope — table bindings and resolveIdent', () => {
    beforeEach(_resetScopeIdsForTests);

    it('resolves an unqualified column', () => {
        const s = new Scope();
        s.addTable({
            alias: 'ActiveRecording',
            target: 'ActiveRecording',
            kind: 'table',
            columns: TABLES[0].columns,
        });
        const r = s.resolveIdent('startTime');
        expect(r).toBeDefined();
        expect(r!.column).toBe('startTime');
        expect(r!.dataType).toBe('TIMESTAMP');
        expect(r!.ambiguous).toBe(false);
    });

    it('flags ambiguous columns when two tables match', () => {
        const s = new Scope();
        s.addTable({ alias: 'a', target: 'ActiveRecording', kind: 'table', columns: TABLES[0].columns });
        s.addTable({ alias: 'g', target: 'GarbageCollection', kind: 'table', columns: TABLES[1].columns });
        const r = s.resolveIdent('duration');
        expect(r).toBeDefined();
        expect(r!.ambiguous).toBe(true);
    });

    it('returns undefined for an unknown column', () => {
        const s = new Scope();
        s.addTable({ alias: 'a', target: 'ActiveRecording', kind: 'table', columns: TABLES[0].columns });
        expect(s.resolveIdent('nope')).toBeUndefined();
    });

    it('child scope sees parent tables (correlated subquery)', () => {
        const outer = new Scope();
        outer.addTable({ alias: 'g', target: 'GarbageCollection', kind: 'table', columns: TABLES[1].columns });
        const inner = new Scope(outer);
        const r = inner.resolveIdent('cause');
        expect(r).toBeDefined();
        expect(r!.table).toBe('g');
    });
});

describe('Scope — resolveQualified', () => {
    beforeEach(_resetScopeIdsForTests);

    it('resolves alias.column', () => {
        const s = new Scope();
        s.addTable({
            alias: 'r',
            target: 'ActiveRecording',
            kind: 'table',
            columns: TABLES[0].columns,
        });
        const r = s.resolveQualified('r', 'duration');
        expect(r).toBeDefined();
        expect(r!.column).toBe('duration');
    });

    it('resolves target.column when no alias is given', () => {
        const s = new Scope();
        s.addTable({
            alias: 'ActiveRecording',
            target: 'ActiveRecording',
            kind: 'table',
            columns: TABLES[0].columns,
        });
        const r = s.resolveQualified('ActiveRecording', 'id');
        expect(r).toBeDefined();
        expect(r!.column).toBe('id');
    });

    it('returns undefined when qualifier matches but column does not', () => {
        const s = new Scope();
        s.addTable({ alias: 'r', target: 'ActiveRecording', kind: 'table', columns: TABLES[0].columns });
        expect(s.resolveQualified('r', 'no_such_col')).toBeUndefined();
    });

    it('returns undefined for unknown qualifier', () => {
        const s = new Scope();
        s.addTable({ alias: 'r', target: 'ActiveRecording', kind: 'table', columns: TABLES[0].columns });
        expect(s.resolveQualified('x', 'duration')).toBeUndefined();
    });

    it('is case-insensitive on qualifier and column', () => {
        const s = new Scope();
        s.addTable({ alias: 'r', target: 'ActiveRecording', kind: 'table', columns: TABLES[0].columns });
        const r = s.resolveQualified('R', 'DURATION');
        expect(r).toBeDefined();
    });
});

describe('Scope.resolveTableRef', () => {
    it('finds a CTE before a table of the same name', () => {
        const ctes = [{ name: 'ActiveRecording', columns: [], recursive: false }];
        const r = Scope.resolveTableRef('ActiveRecording', ctes, TABLES, VIEWS);
        expect(r!.kind).toBe('cte');
    });

    it('finds a table by name', () => {
        const r = Scope.resolveTableRef('GarbageCollection', [], TABLES, VIEWS);
        expect(r!.kind).toBe('table');
        expect(r!.columns.length).toBe(3);
    });

    it('finds a view when no table matches', () => {
        const r = Scope.resolveTableRef('gc_summary', [], TABLES, VIEWS);
        expect(r!.kind).toBe('view');
    });

    it('returns undefined for unknown names', () => {
        expect(Scope.resolveTableRef('nope', [], TABLES, VIEWS)).toBeUndefined();
    });

    it('is case-insensitive', () => {
        expect(Scope.resolveTableRef('GARBAGECOLLECTION', [], TABLES, VIEWS)!.kind).toBe('table');
        expect(Scope.resolveTableRef('GC_SUMMARY', [], TABLES, VIEWS)!.kind).toBe('view');
    });
});
