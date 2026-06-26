import { describe, it, expect } from 'vitest';
import { parseCellDirective, stripCellDirective, parseNotebook, reconstructNotebook, tokenizeCellContent, parseCellContent } from '../utils/notebookParser';

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
