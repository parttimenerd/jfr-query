import { describe, it, expect } from 'vitest';
import { tokenizeCellContent, reconstructCellContent, parseCellContent, parseNotebook, reconstructNotebook, parseCellDirective, stripCellDirective } from '../utils/notebookParser';

describe('Notebook Parser', () => {
    it('tokenizes mixed content correctly', () => {
        const input = '# Header\n\n```sql\nSELECT 1\n```\n\nText';
        const segments = tokenizeCellContent(input);
        expect(segments.length).toBe(3);
        expect(segments[0].type).toBe('markdown');
        expect(segments[1].type).toBe('sql');
        expect(segments[2].type).toBe('markdown');
    });

    it('roundtrips content losslessly', () => {
        const input = 'Intro\n```variables\n$x=1\n```\n```sql\nSELECT * FROM table\n```\n```plot\nTABLE()\n```\nOutro';
        const segments = tokenizeCellContent(input);
        const output = reconstructCellContent(segments);
        expect(output).toBe(input);
    });

    it('parses empty notebook', () => {
        const { metadata, content } = parseNotebook('');
        expect(content).toBe('');
        expect(metadata).toBeDefined();
    });

    it('parses notebook with only frontmatter', () => {
        const md = '---\ntitle: Test\n---\n\n';
        const { metadata, content } = parseNotebook(md);
        expect(content.trim()).toBe('');
    });

    it('roundtrips supported metadata fields (title is not serialized back)', () => {
        // Note: title in frontmatter is parsed but NOT re-serialized by reconstructNotebook.
        // Only timeFormat, decimalPlaces, views, macros, customSystemPrompt survive roundtrip.
        const md = '---\ntimeFormat: HH:mm:ss\n---\n\n# Cell 1';
        const parsed = parseNotebook(md);
        const rebuilt = reconstructNotebook(parsed);
        expect(parseNotebook(rebuilt).metadata.timeFormat).toBe(parsed.metadata.timeFormat);
    });

    it('handles variable with equals sign in value', () => {
        const input = '```variables\n$url=http://example.com?a=b\n```';
        const segments = tokenizeCellContent(input);
        const vars = segments.find(s => s.type === 'variables');
        expect(vars).toBeDefined();
        expect(vars?.content).toContain('$url=http://example.com?a=b');
    });

    it('handles multi-cell with --- separators', () => {
        const input = '# Cell A\n\n---\n\n# Cell B';
        const { content } = parseNotebook(input);
        const parts = content.split(/\n\n---\n\n/);
        expect(parts.length).toBe(2);
        expect(parts[0].trim()).toBe('# Cell A');
        expect(parts[1].trim()).toBe('# Cell B');
    });

    it('tokenizes plot block correctly', () => {
        const input = '```plot\nLINE_CHART(x: "t")\n```';
        const segments = tokenizeCellContent(input);
        expect(segments.length).toBe(1);
        expect(segments[0].type).toBe('plot');
        const seg = segments[0];
        if (seg.type !== 'if') expect(seg.content).toContain('LINE_CHART');
    });

    it('handles sql roundtrip with leading/trailing newlines', () => {
        const input = '```sql\n\nSELECT * FROM tbl\n\n```';
        const segments = tokenizeCellContent(input);
        const output = reconstructCellContent(segments);
        expect(output).toBe(input);
    });

    // --- Regression tests for fixed bugs ---

    it('Fix1: does not split on --- in notebook body when frontmatter is present', () => {
        const md = '---\ntimeFormat: HH:mm:ss\n---\n# Cell A\n\n---\n\n# Cell B';
        const { metadata, content } = parseNotebook(md);
        expect(metadata.timeFormat).toBe('HH:mm:ss');
        // The body should contain the --- separator intact
        expect(content).toContain('---');
        expect(content).toContain('# Cell A');
        expect(content).toContain('# Cell B');
    });

    it('Fix1: reconstructNotebook roundtrips a notebook with --- in body', () => {
        // Use serialized form (timeFormat gets single-quoted by stringifyFrontMatter)
        const md = "---\ntimeFormat: 'HH:mm:ss'\n---\n# Cell A\n\n---\n\n# Cell B";
        const parsed = parseNotebook(md);
        const rebuilt = reconstructNotebook(parsed);
        expect(rebuilt).toBe(md);
    });

    it('Fix2: plot block before any sql block is now collected into standalonePlots (not dropped)', () => {
        const input = '```plot\nLINE_CHART(x: "t")\n```\n```sql\nSELECT 1\n```';
        const segments = tokenizeCellContent(input);
        const parsed = parseCellContent(segments);
        // The plot before any SQL is standalone — collected, not dropped
        expect(parsed.standalonePlots).toHaveLength(1);
        expect(parsed.standalonePlots[0]).toBe('LINE_CHART(x: "t")');
        expect(parsed.plotBlocks.length).toBe(1);
        // The plot for the SQL block has no config (empty string), not the orphan
        expect(parsed.plotBlocks[0]).toBe('');
        expect(parsed.sqlBlocks.length).toBe(1);
    });

    it('Fix3: unknown frontmatter fields survive a reconstructNotebook roundtrip', () => {
        const md = '---\ntimeFormat: HH:mm:ss\ncustomTag: myValue\n---\n# Notebook';
        const parsed = parseNotebook(md);
        expect((parsed.metadata as any).customTag).toBe('myValue');
        const rebuilt = reconstructNotebook(parsed);
        const reparsed = parseNotebook(rebuilt);
        expect((reparsed.metadata as any).customTag).toBe('myValue');
    });

    it('Fix4: content after closing --- is preserved exactly (no trimStart)', () => {
        // Use serialized form (timeFormat gets single-quoted by stringifyFrontMatter)
        const md = "---\ntimeFormat: 'HH:mm:ss'\n---\n\n# Cell";
        const { content } = parseNotebook(md);
        // The leading newline before # Cell must be preserved
        expect(content.startsWith('\n')).toBe(true);
        // Reconstructing must reproduce original exactly
        const rebuilt = reconstructNotebook(parseNotebook(md));
        expect(rebuilt).toBe(md);
    });

    it('B-007: metadata.variables map round-trips through frontmatter', () => {
        const md = "---\nvariables:\n  $start: '0'\n  $end: '1000'\n  $$global: 'hello'\n---\n# Body";
        const parsed = parseNotebook(md);
        expect(parsed.metadata.variables).toEqual({ '$start': '0', '$end': '1000', '$$global': 'hello' });
        const rebuilt = reconstructNotebook(parsed);
        const reparsed = parseNotebook(rebuilt);
        expect(reparsed.metadata.variables).toEqual({ '$start': '0', '$end': '1000', '$$global': 'hello' });
    });

    it('B-007: empty variables map is not serialized', () => {
        const md = "---\ntimeFormat: 'HH:mm:ss'\n---\n# Body";
        const parsed = parseNotebook(md);
        parsed.metadata.variables = {};
        const rebuilt = reconstructNotebook(parsed);
        // Should not contain a "variables:" header for an empty map.
        expect(rebuilt).not.toContain('variables:');
    });

    it('C: view with params and includes round-trips through frontmatter', () => {
        const md = `---
views:
  - name: 'gc_top_pauses'
    includes: [gc_phases, heap_summary]
    params: [{name: n, type: INTEGER, default: 10}]
    sql: |
      SELECT * FROM gc_phases LIMIT n
---
# Body`;
        const parsed = parseNotebook(md);
        const view = parsed.metadata.views?.[0];
        expect(view?.name).toBe('gc_top_pauses');
        expect(view?.includes).toEqual(['gc_phases', 'heap_summary']);
        expect(view?.params).toHaveLength(1);
        expect(view?.params?.[0].name).toBe('n');
        expect(view?.params?.[0].type).toBe('INTEGER');
        expect(view?.params?.[0].default).toBe('10');

        const rebuilt = reconstructNotebook(parsed);
        expect(rebuilt).toContain('includes: [gc_phases, heap_summary]');
        expect(rebuilt).toContain('params: [{name: n, type: INTEGER, default: 10}]');
    });

    it('C: view without params/includes still serializes correctly (backwards compat)', () => {
        const md = `---
views:
  - name: 'my_view'
    sql: |
      SELECT 1
---
# Body`;
        const parsed = parseNotebook(md);
        expect(parsed.metadata.views?.[0]?.params).toBeUndefined();
        expect(parsed.metadata.views?.[0]?.includes).toBeUndefined();
        const rebuilt = reconstructNotebook(parsed);
        expect(rebuilt).not.toContain('params:');
        expect(rebuilt).not.toContain('includes:');
    });

    describe('standalone plots (no preceding SQL)', () => {
        it('collects a standalone plot into standalonePlots', () => {
            const input = '```plot\nTABLE() DATASET GarbageCollection\n```';
            const segments = tokenizeCellContent(input);
            const parsed = parseCellContent(segments);
            expect(parsed.standalonePlots).toHaveLength(1);
            expect(parsed.standalonePlots[0]).toBe('TABLE() DATASET GarbageCollection');
            expect(parsed.sqlBlocks).toHaveLength(0);
            expect(parsed.plotBlocks).toHaveLength(0);
        });

        it('standalone plot does not appear in plotBlocks', () => {
            const input = '```plot\nTABLE() DATASET GarbageCollection\n```\n```sql\nSELECT 1\n```';
            const segments = tokenizeCellContent(input);
            const parsed = parseCellContent(segments);
            expect(parsed.standalonePlots).toHaveLength(1);
            expect(parsed.standalonePlots[0]).toBe('TABLE() DATASET GarbageCollection');
            // The sql block has no following plot, so plotBlocks[0] = ''
            expect(parsed.plotBlocks[0]).toBe('');
        });

        it('multiple standalone plots are all collected', () => {
            const input = '```plot\nTABLE() DATASET GarbageCollection\n```\n```plot\nLINE_CHART(x: "t") DATASET HeapSnapshot\n```';
            const segments = tokenizeCellContent(input);
            const parsed = parseCellContent(segments);
            expect(parsed.standalonePlots).toHaveLength(2);
        });

        it('standalone plot coexists with sql-attached plot', () => {
            const input = '```plot\nLINE_CHART() DATASET HeapSnapshot\n```\n```sql\nSELECT 1\n```\n```plot\nTABLE()\n```';
            const segments = tokenizeCellContent(input);
            const parsed = parseCellContent(segments);
            // LINE_CHART before sql → standalone
            expect(parsed.standalonePlots).toHaveLength(1);
            expect(parsed.standalonePlots[0]).toBe('LINE_CHART() DATASET HeapSnapshot');
            // TABLE() after sql → attached
            expect(parsed.plotBlocks[0]).toBe('TABLE()');
        });

        it('roundtrip: standalone plot survives reconstructCellContent', () => {
            const input = '```plot\nTABLE() DATASET GarbageCollection\n```\n';
            const segments = tokenizeCellContent(input);
            const rebuilt = reconstructCellContent(segments);
            expect(rebuilt).toContain('TABLE() DATASET GarbageCollection');
            // Re-tokenize and re-parse to confirm no data loss
            const reparsed = parseCellContent(tokenizeCellContent(rebuilt));
            expect(reparsed.standalonePlots[0]).toBe('TABLE() DATASET GarbageCollection');
        });
    });
});

// ─── parseCellDirective ───────────────────────────────────────────────────────

describe('parseCellDirective', () => {
    it('returns null for content without a directive', () => {
        expect(parseCellDirective('# Header\nSome text')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parseCellDirective('')).toBeNull();
    });

    it('parses a name attribute', () => {
        const result = parseCellDirective('<!-- @cell name="gc-summary" -->\n# Header');
        expect(result).not.toBeNull();
        expect(result!.name).toBe('gc-summary');
    });

    it('parses a collapsed attribute (true)', () => {
        const result = parseCellDirective('<!-- @cell collapsed="true" -->\nSQL');
        expect(result!.collapsed).toBe(true);
    });

    it('parses a collapsed attribute (false)', () => {
        const result = parseCellDirective('<!-- @cell collapsed="false" -->\nSQL');
        expect(result!.collapsed).toBe(false);
    });

    it('parses both name and collapsed', () => {
        const result = parseCellDirective('<!-- @cell name="foo" collapsed="true" -->\nSQL');
        expect(result!.name).toBe('foo');
        expect(result!.collapsed).toBe(true);
    });

    it('puts unknown key-value pairs into rest', () => {
        const result = parseCellDirective('<!-- @cell name="x" custom="hello" -->\nSQL');
        expect(result!.rest).toEqual({ custom: 'hello' });
    });

    it('parses single-quoted attribute values', () => {
        const result = parseCellDirective("<!-- @cell name='my-cell' -->\nSQL");
        expect(result!.name).toBe('my-cell');
    });

    it('returns the raw directive text', () => {
        const result = parseCellDirective('<!-- @cell name="x" -->\nSQL');
        expect(result!.raw).toBe('<!-- @cell name="x" -->');
    });

    it('matchLength covers directive line including newline', () => {
        const directive = '<!-- @cell name="x" -->\n';
        const result = parseCellDirective(directive + 'body');
        expect(result!.matchLength).toBe(directive.length);
    });

    it('handles leading whitespace before directive', () => {
        const result = parseCellDirective('\n<!-- @cell name="x" -->\n# H');
        expect(result).not.toBeNull();
        expect(result!.name).toBe('x');
    });
});

// ─── stripCellDirective ───────────────────────────────────────────────────────

describe('stripCellDirective', () => {
    it('returns null directive and original body when no directive', () => {
        const result = stripCellDirective('# Header\nSome content');
        expect(result.directive).toBeNull();
        expect(result.body).toBe('# Header\nSome content');
    });

    it('strips directive line and returns remaining body', () => {
        const result = stripCellDirective('<!-- @cell name="gc" -->\n# Header\nContent');
        expect(result.directive).not.toBeNull();
        expect(result.directive!.name).toBe('gc');
        expect(result.body).toBe('# Header\nContent');
    });

    it('body is byte-identical after stripping', () => {
        const body = '```sql\nSELECT 1\n```\n\nBAR_CHART';
        const input = `<!-- @cell name="q" -->\n${body}`;
        expect(stripCellDirective(input).body).toBe(body);
    });

    it('returns empty body when directive is the entire content', () => {
        const result = stripCellDirective('<!-- @cell name="x" -->\n');
        expect(result.body).toBe('');
    });
});

// ─── resultSnapshots roundtrip ────────────────────────────────────────────────

describe('resultSnapshots — front matter roundtrip', () => {
    it('serializes and deserializes resultSnapshots', () => {
        const snapshots: Record<string, any[] | null> = {
            'cell-0:0': [{ time: 1, duration: 100 }],
            'cell-1:0': [{ cause: 'G1 GC' }],
            'cell-2:0': null,
        };
        const nb = reconstructNotebook({ metadata: { resultSnapshots: snapshots } as any, content: '# Body\n' });
        expect(nb).toContain("resultSnapshots: '");
        const parsed = parseNotebook(nb);
        expect(parsed.metadata.resultSnapshots).toEqual(snapshots);
    });

    it('empty resultSnapshots map is not serialized', () => {
        const nb = reconstructNotebook({ metadata: { resultSnapshots: {} } as any, content: '# Body\n' });
        expect(nb).not.toContain('resultSnapshots');
    });

    it('absent resultSnapshots does not appear in output', () => {
        const nb = reconstructNotebook({ metadata: {} as any, content: '# Body\n' });
        expect(nb).not.toContain('resultSnapshots');
    });

    it('notebook without resultSnapshots has no resultSnapshots in parsed metadata', () => {
        const nb = '---\ntitle: "test"\n---\n\n# Body\n';
        const parsed = parseNotebook(nb);
        expect(parsed.metadata.resultSnapshots).toBeUndefined();
    });

    it('survives unicode values in snapshots', () => {
        const snapshots = { 'c:0': [{ name: 'java.lang.String — GC root' }] };
        const nb = reconstructNotebook({ metadata: { resultSnapshots: snapshots } as any, content: '' });
        const parsed = parseNotebook(nb);
        expect(parsed.metadata.resultSnapshots?.['c:0']?.[0]?.name).toBe('java.lang.String — GC root');
    });

    it('round-trips large snapshot without data loss', () => {
        const rows = Array.from({ length: 20 }, (_, i) => ({ idx: i, val: `row-${i}` }));
        const snapshots = { 'cell-0:0': rows };
        const nb = reconstructNotebook({ metadata: { resultSnapshots: snapshots } as any, content: '' });
        const parsed = parseNotebook(nb);
        expect(parsed.metadata.resultSnapshots?.['cell-0:0']).toHaveLength(20);
    });
});
