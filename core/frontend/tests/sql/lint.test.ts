// Tests for the AST-based SQL linter.
//
// Each test calls `lintSql(source, { schema, variables })` and asserts the
// returned CodeMirror Diagnostic[]. Severities and ranges are checked.

import { describe, it, expect } from 'vitest';
import { lintSql } from '../../components/editor/sql/lint';
import { parse } from '../../components/editor/sql/parser';
import { annotate } from '../../components/editor/sql/annotate';
import { markCursorPath } from '../../components/editor/sql/ast';
import type { SchemaForCompletion } from '../../components/editor/completions';

function makeSchema(): SchemaForCompletion {
    const tables = [
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
    return {
        tables,
        views: [],
        macros: [],
        tableMap: new Map(tables.map(t => [t.name.toLowerCase(), t])),
        viewMap: new Map(),
    };
}

describe('lintSql', () => {
    it('flags unknown columns', () => {
        const sql = 'SELECT foo FROM ActiveRecording';
        const diags = lintSql(sql, { schema: makeSchema(), variables: {} });
        const errors = diags.filter(d => d.severity === 'error');
        expect(errors.length).toBe(1);
        expect(errors[0].message).toMatch(/Unknown column 'foo'/);
        // Range covers `foo`.
        expect(sql.slice(errors[0].from, errors[0].to)).toBe('foo');
    });

    it('flags unknown tables', () => {
        const sql = 'SELECT id FROM UnknownTable';
        const diags = lintSql(sql, { schema: makeSchema(), variables: {} });
        const errors = diags.filter(d => d.severity === 'error');
        // The unknown table is at least one error; an unknown column for `id`
        // may also appear since the scope has a tableRef but no resolvable
        // columns. Filter to the table error specifically.
        const tableErr = errors.find(d => /Unknown table or view 'UnknownTable'/.test(d.message));
        expect(tableErr).toBeDefined();
        expect(sql.slice(tableErr!.from, tableErr!.to)).toBe('UnknownTable');
    });

    it('flags unknown functions', () => {
        const sql = 'SELECT bogus_func(id) FROM ActiveRecording';
        const diags = lintSql(sql, { schema: makeSchema(), variables: {} });
        const fnErrs = diags.filter(d => /Unknown function/.test(d.message));
        expect(fnErrs.length).toBe(1);
        expect(fnErrs[0].severity).toBe('error');
        expect(fnErrs[0].message).toMatch(/'bogus_func'/);
    });

    it('warns on dangling alias', () => {
        const sql = 'SELECT id FROM ActiveRecording r WHERE id > 0';
        const diags = lintSql(sql, { schema: makeSchema(), variables: {} });
        const warnings = diags.filter(d => d.severity === 'warning');
        expect(warnings.length).toBe(1);
        expect(warnings[0].message).toMatch(/Alias 'r' is never referenced/);
    });

    it('does not warn when alias is referenced', () => {
        const sql = 'SELECT id FROM ActiveRecording r WHERE r.id > 0';
        const diags = lintSql(sql, { schema: makeSchema(), variables: {} });
        const warnings = diags.filter(d => d.severity === 'warning');
        expect(warnings.length).toBe(0);
    });

    it('emits info for undefined variable', () => {
        const sql = 'SELECT id FROM ActiveRecording WHERE id = $undefinedVar';
        const diags = lintSql(sql, { schema: makeSchema(), variables: {} });
        const infos = diags.filter(d => d.severity === 'info');
        expect(infos.length).toBe(1);
        expect(infos[0].message).toMatch(/Variable '\$undefinedVar' is not defined/);
    });

    it('does not flag defined variable', () => {
        const sql = 'SELECT $defined FROM ActiveRecording';
        const diags = lintSql(sql, { schema: makeSchema(), variables: { defined: 'x' } });
        expect(diags).toEqual([]);
    });

    it('suppresses diagnostics on mid-typing partial parse', () => {
        // Cursor inside a partially-typed identifier. The parser leaves a
        // hole for the incomplete projection, and lintSql must not emit any
        // diagnostics for descendants of that hole.
        const sql = 'SELECT i';
        const { root } = parse(sql);
        // Mark a cursor position inside the partial input so a hole node is
        // produced where expected. `parse()` already produces holes for
        // incomplete clauses; nothing further required.
        markCursorPath(root, sql.length);
        annotate(root, {
            tables: makeSchema().tables,
            views: makeSchema().views,
            variables: {
                cellVariables: new Map(),
                workspaceVariables: new Map(),
                cellExports: new Map(),
                cellsWithBrush: new Set(),
            },
        });
        // Use the pre-parsed root to bypass internal annotate.
        const diags = lintSql(sql, { schema: makeSchema(), variables: {}, root } as any);
        expect(diags).toEqual([]);
    });

    it('emits nothing for a clean query', () => {
        const sql = 'SELECT * FROM ActiveRecording WHERE id = 1';
        const diags = lintSql(sql, { schema: makeSchema(), variables: {} });
        expect(diags).toEqual([]);
    });

    it('flags forward-ref column unknown to a CTE', () => {
        const sql = 'WITH cte AS (SELECT id FROM ActiveRecording) SELECT bogus FROM cte';
        const diags = lintSql(sql, { schema: makeSchema(), variables: {} });
        const errors = diags.filter(d => d.severity === 'error' && /bogus/.test(d.message));
        expect(errors.length).toBe(1);
        expect(errors[0].message).toMatch(/Unknown column 'bogus'/);
    });
});
