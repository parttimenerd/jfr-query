import { describe, it, expect } from 'vitest';
import { tokenizeCellContent, reconstructCellContent, parseCellContent, parseNotebook, reconstructNotebook } from '../utils/notebookParser';

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
        expect(segments[0].content).toContain('LINE_CHART');
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

    it('Fix2: plot block before any sql block is silently dropped (not stored at index -1)', () => {
        const input = '```plot\nLINE_CHART(x: "t")\n```\n```sql\nSELECT 1\n```';
        const segments = tokenizeCellContent(input);
        const parsed = parseCellContent(segments);
        // The plot before any SQL is an orphan and must be dropped
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
});
