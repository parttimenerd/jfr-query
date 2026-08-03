import { describe, it, expect } from 'vitest';
import { parseCellDirective, stripCellDirective, parseNotebook, reconstructNotebook, tokenizeCellContent, parseCellContent, tablesToConditionSql, requiresAttrToConditionSql, updateCellDirectiveAttrs } from '../utils/notebookParser';

describe('parseCellDirective', () => {
    it('returns null for content without a directive', () => {
        expect(parseCellDirective('# heading\n\nbody')).toBeNull();
        expect(parseCellDirective('')).toBeNull();
    });

    it('parses a simple name=value directive', () => {
        const r = parseCellDirective('<!-- @cell name=gc-overview -->\n\n## Title');
        expect(r).not.toBeNull();
        expect(r!.name).toBe('gc-overview');
        expect(r!.collapsed).toBeUndefined();
    });

    it('parses quoted values containing spaces', () => {
        const r = parseCellDirective('<!-- @cell name="my cell" collapsed=true -->\nbody');
        expect(r!.name).toBe('my cell');
        expect(r!.collapsed).toBe(true);
    });

    it('preserves unknown keys', () => {
        const r = parseCellDirective('<!-- @cell name=a foo=bar -->\nx');
        expect(r!.rest.foo).toBe('bar');
    });

    it('skips leading whitespace and blank lines', () => {
        const r = parseCellDirective('\n  \n<!-- @cell name=x -->\nbody');
        expect(r!.name).toBe('x');
    });

    it('stripCellDirective returns body without the directive line', () => {
        const { directive, body } = stripCellDirective('<!-- @cell name=a -->\n## Heading\n');
        expect(directive!.name).toBe('a');
        expect(body).toBe('## Heading\n');
    });

    it('stripCellDirective is a no-op for content without a directive', () => {
        const { directive, body } = stripCellDirective('## Heading\n');
        expect(directive).toBeNull();
        expect(body).toBe('## Heading\n');
    });
});

describe('cellConditions front-matter round-trip', () => {
    it('parses single-line cellConditions', () => {
        const md = `---
cellConditions:
  long-pauses: 'SELECT max(d) > 100 FROM gc'
---

body`;
        const { metadata } = parseNotebook(md);
        expect(metadata.cellConditions).toEqual({ 'long-pauses': 'SELECT max(d) > 100 FROM gc' });
    });

    it('parses multi-line block-scalar cellConditions', () => {
        const md = `---
cellConditions:
  heap-section: |
    SELECT count(*) > 0
    FROM GCHeapSummary
    WHERE heap_used > 1000
---

body`;
        const { metadata } = parseNotebook(md);
        expect(metadata.cellConditions!['heap-section']).toBe(
            'SELECT count(*) > 0\nFROM GCHeapSummary\nWHERE heap_used > 1000'
        );
    });

    it('round-trips cellConditions through stringify+parse', () => {
        const md = `---
cellConditions:
  a: 'SELECT 1'
---

body`;
        const parsed = parseNotebook(md);
        const rebuilt = reconstructNotebook(parsed);
        const reparsed = parseNotebook(rebuilt);
        expect(reparsed.metadata.cellConditions).toEqual({ a: 'SELECT 1' });
    });

    it('round-trips multi-line cellConditions', () => {
        const md = `---
cellConditions:
  a: |
    SELECT 1
    FROM t
---

body`;
        const parsed = parseNotebook(md);
        const rebuilt = reconstructNotebook(parsed);
        const reparsed = parseNotebook(rebuilt);
        expect(reparsed.metadata.cellConditions!.a).toBe('SELECT 1\nFROM t');
    });

    it('does not emit empty cellConditions key', () => {
        const md = `---
timeFormat: 'HH:mm:ss'
---

body`;
        const parsed = parseNotebook(md);
        const rebuilt = reconstructNotebook(parsed);
        expect(rebuilt).not.toContain('cellConditions');
    });
});

describe('tablesToConditionSql', () => {
    it('generates single-table WHERE clause', () => {
        expect(tablesToConditionSql(['ExecutionSample'])).toBe(
            "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'ExecutionSample'"
        );
    });

    it('generates IN clause for multiple tables', () => {
        expect(tablesToConditionSql(['ThreadPark', 'ThreadSleep'])).toBe(
            "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name IN ('ThreadPark', 'ThreadSleep')"
        );
    });

    it('escapes single quotes in table names', () => {
        expect(tablesToConditionSql(["O'Brien"])).toBe(
            "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'O''Brien'"
        );
    });

    it('returns SELECT true for empty array', () => {
        expect(tablesToConditionSql([])).toBe('SELECT true');
    });

    it('passes through a raw SELECT statement unchanged', () => {
        const sql = "SELECT count(*) > 0 FROM my_view WHERE active = true";
        expect(tablesToConditionSql([sql])).toBe(sql);
    });
});

describe('requiresAttrToConditionSql', () => {
    it('converts single table name to WHERE clause', () => {
        expect(requiresAttrToConditionSql('GarbageCollection')).toBe(
            "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'GarbageCollection'"
        );
    });

    it('converts comma-separated names to IN clause', () => {
        expect(requiresAttrToConditionSql('ThreadPark, ThreadSleep')).toBe(
            "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name IN ('ThreadPark', 'ThreadSleep')"
        );
    });

    it('passes through raw SQL predicate unchanged', () => {
        const sql = "SELECT count(*) > 0 FROM latencies_view";
        expect(requiresAttrToConditionSql(sql)).toBe(sql);
    });

    it('passes through SELECT with leading whitespace', () => {
        const sql = "  SELECT 1 > 0";
        expect(requiresAttrToConditionSql(sql)).toBe(sql.trim());
    });
});

describe('updateCellDirectiveAttrs', () => {
    it('adds a new attribute to an existing directive', () => {
        const content = '<!-- @cell name=foo -->\n## Title';
        const result = updateCellDirectiveAttrs(content, { requires: 'GarbageCollection' });
        expect(result).toContain('requires="GarbageCollection"');
        expect(result).toContain('name="foo"');
        expect(result).toContain('## Title');
    });

    it('removes an attribute when value is null', () => {
        const content = '<!-- @cell name=foo requires="GarbageCollection" -->\nbody';
        const result = updateCellDirectiveAttrs(content, { requires: null });
        expect(result).not.toContain('requires');
        expect(result).toContain('name="foo"');
    });

    it('updates an existing attribute value', () => {
        const content = '<!-- @cell name=foo requires="OldTable" -->\nbody';
        const result = updateCellDirectiveAttrs(content, { requires: 'NewTable' });
        expect(result).toContain('requires="NewTable"');
        expect(result).not.toContain('OldTable');
    });

    it('is a no-op when no directive is present', () => {
        const content = '## No directive here\nbody';
        expect(updateCellDirectiveAttrs(content, { requires: 'X' })).toBe(content);
    });
});

describe('cell-inline requires= attribute', () => {
    it('parseCellDirective captures requires as rest.requires', () => {
        const r = parseCellDirective('<!-- @cell name=gc-section requires="GarbageCollection" -->');
        expect(r!.name).toBe('gc-section');
        expect(r!.rest.requires).toBe('GarbageCollection');
    });

    it('parseCellDirective captures multi-table requires', () => {
        const r = parseCellDirective('<!-- @cell name=blocking requires="ThreadPark,ThreadSleep" -->');
        expect(r!.rest.requires).toBe('ThreadPark,ThreadSleep');
    });
});

describe('requires front-matter shorthand', () => {
    it('expands single table name into information_schema SQL', () => {
        const md = `---
requires:
  hot-methods: ExecutionSample
---

body`;
        const { metadata } = parseNotebook(md);
        expect(metadata.cellConditions!['hot-methods']).toBe(
            "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name = 'ExecutionSample'"
        );
    });

    it('expands inline list into IN clause', () => {
        const md = `---
requires:
  blocking: [ThreadPark, ThreadSleep]
---

body`;
        const { metadata } = parseNotebook(md);
        expect(metadata.cellConditions!['blocking']).toBe(
            "SELECT count(*) > 0 FROM information_schema.tables WHERE table_name IN ('ThreadPark', 'ThreadSleep')"
        );
    });

    it('cellConditions entry takes precedence over requires for the same cell', () => {
        const md = `---
requires:
  my-cell: SomeTable
cellConditions:
  my-cell: 'SELECT 1 = 1'
---

body`;
        const { metadata } = parseNotebook(md);
        expect(metadata.cellConditions!['my-cell']).toBe('SELECT 1 = 1');
    });

    it('requires and cellConditions can coexist for different cells', () => {
        const md = `---
requires:
  cell-a: TableA
cellConditions:
  cell-b: 'SELECT 2 = 2'
---

body`;
        const { metadata } = parseNotebook(md);
        expect(metadata.cellConditions!['cell-a']).toContain("'TableA'");
        expect(metadata.cellConditions!['cell-b']).toBe('SELECT 2 = 2');
    });
});

describe('-- alias <name>[ materialized] directive', () => {
    it('still recognizes legacy "-- name" alias form', () => {
        const segs = tokenizeCellContent('```sql\n-- gc_pauses\nSELECT 1\n```');
        const p = parseCellContent(segs);
        expect(p.queryAliases[0]).toBe('gc_pauses');
        expect(p.queryAliasMaterialized[0]).toBe(false);
        expect(p.sqlBlocks[0]).toBe('SELECT 1');
    });

    it('recognizes "-- alias gc_pauses" explicit form', () => {
        const segs = tokenizeCellContent('```sql\n-- alias gc_pauses\nSELECT 1\n```');
        const p = parseCellContent(segs);
        expect(p.queryAliases[0]).toBe('gc_pauses');
        expect(p.queryAliasMaterialized[0]).toBe(false);
    });

    it('recognizes "materialized" flag', () => {
        const segs = tokenizeCellContent('```sql\n-- alias gc_pauses materialized\nSELECT 1\n```');
        const p = parseCellContent(segs);
        expect(p.queryAliases[0]).toBe('gc_pauses');
        expect(p.queryAliasMaterialized[0]).toBe(true);
    });

    it('is case-insensitive on the keyword', () => {
        const segs = tokenizeCellContent('```sql\n-- ALIAS x\nSELECT 1\n```');
        const p = parseCellContent(segs);
        expect(p.queryAliases[0]).toBe('x');
    });

    it('leaves SQL body untouched after the directive', () => {
        const segs = tokenizeCellContent('```sql\n-- alias x materialized\nSELECT 1\nFROM t\n```');
        const p = parseCellContent(segs);
        expect(p.sqlBlocks[0]).toBe('SELECT 1\nFROM t');
    });
});
