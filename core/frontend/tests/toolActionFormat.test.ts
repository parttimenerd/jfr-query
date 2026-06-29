import { describe, it, expect } from 'vitest';
import { formatActionLine, shortContent } from '../components/chat/toolActionFormat';

describe('shortContent', () => {
    it('returns empty string for null / undefined / empty', () => {
        expect(shortContent(null)).toBe('');
        expect(shortContent(undefined)).toBe('');
        expect(shortContent('')).toBe('');
    });

    it('collapses internal whitespace', () => {
        expect(shortContent('hello   world')).toBe('hello world');
        expect(shortContent('line1\n\tline2')).toBe('line1 line2');
    });

    it('trims surrounding whitespace', () => {
        expect(shortContent('  hi  ')).toBe('hi');
    });

    it('keeps short strings intact', () => {
        expect(shortContent('SELECT 1', 60)).toBe('SELECT 1');
    });

    it('truncates with ellipsis when too long', () => {
        const long = 'a'.repeat(100);
        expect(shortContent(long, 10)).toBe('aaaaaaaaa…');
        expect(shortContent(long, 10).length).toBe(10);
    });
});

describe('formatActionLine', () => {
    it('formats addCell with type + content', () => {
        const out = formatActionLine('addCell', { type: 'sql', content: 'SELECT * FROM Events' });
        expect(out.verb).toBe('Add');
        expect(out.summary).toContain('sql');
        expect(out.summary).toContain('SELECT * FROM Events');
        expect(out.cellId).toBeNull();
    });

    it('formats editCell with cellId for navigation', () => {
        const out = formatActionLine('editCell', { cellId: 'c-1', content: 'new body' });
        expect(out.verb).toBe('Edit');
        expect(out.cellId).toBe('c-1');
        expect(out.summary).toContain('new body');
    });

    it('formats applyPlot', () => {
        const out = formatActionLine('applyPlot', { cellId: 'c-2', plotConfig: 'BAR_CHART(x: "x")' });
        expect(out.verb).toBe('Plot');
        expect(out.cellId).toBe('c-2');
        expect(out.summary).toContain('BAR_CHART');
    });

    it('formats deleteCell', () => {
        const out = formatActionLine('deleteCell', { cellId: 'c-3' });
        expect(out.verb).toBe('Delete');
        expect(out.cellId).toBe('c-3');
    });

    it('formats moveCell with position + target', () => {
        const out = formatActionLine('moveCell', { cellId: 'a', targetCellId: 'b', position: 'after' });
        expect(out.verb).toBe('Move');
        expect(out.summary).toBe('after b');
        expect(out.cellId).toBe('a');
    });

    it('formats runQuery with the sql', () => {
        const out = formatActionLine('runQuery', { sql: 'SELECT 1' });
        expect(out.verb).toBe('Run');
        expect(out.summary).toContain('SELECT 1');
    });

    it('formats describeTable / sampleRows with the name', () => {
        expect(formatActionLine('describeTable', { name: 'Events' }).verb).toBe('Describe');
        expect(formatActionLine('describeTable', { name: 'Events' }).summary).toContain('Events');
        expect(formatActionLine('sampleRows', { name: 'Events' }).verb).toBe('Sample');
    });

    it('formats list tools without args', () => {
        expect(formatActionLine('listCells', {}).summary).toBe('cells');
        expect(formatActionLine('listPlots', {}).summary).toBe('plots');
        expect(formatActionLine('listVariables', {}).summary).toBe('variables');
    });

    it('formats variable tools', () => {
        const set = formatActionLine('setVariable', { name: 'x', value: '5' });
        expect(set.verb).toBe('Set');
        expect(set.summary).toContain('$x');
        expect(set.summary).toContain('5');

        const del = formatActionLine('deleteVariable', { name: 'x' });
        expect(del.verb).toBe('Delete');
        expect(del.summary).toBe('$x');
    });

    it('falls back to the tool name for unknown tools', () => {
        const out = formatActionLine('mysteryTool', { foo: 'bar' });
        expect(out.verb).toBe('mysteryTool');
        expect(out.cellId).toBeNull();
    });

    it('handles missing args', () => {
        expect(() => formatActionLine('addCell', null)).not.toThrow();
        expect(() => formatActionLine('addCell', undefined)).not.toThrow();
    });

    it('formats previewPlot with the plot DSL', () => {
        const out = formatActionLine('previewPlot', { sql: 'SELECT 1', plotConfig: 'BAR_CHART(x: "a")' });
        expect(out.verb).toBe('Preview');
        expect(out.summary).toContain('BAR_CHART');
    });

    it('formats screenshotPlot with the previewId', () => {
        const out = formatActionLine('screenshotPlot', { previewId: 'preview-xyz' });
        expect(out.verb).toBe('Screenshot');
        expect(out.summary).toContain('preview-xyz');
    });

    it('does not crash on previewPlot with missing args', () => {
        const out = formatActionLine('previewPlot', {});
        expect(out.verb).toBe('Preview');
        expect(out.summary).toContain('plot');
    });

    it('truncates a very long plotConfig in previewPlot', () => {
        const longConfig = 'BAR_CHART(' + 'x: "abc", '.repeat(50) + ')';
        const out = formatActionLine('previewPlot', { plotConfig: longConfig });
        expect(out.summary.length).toBeLessThan(longConfig.length);
        expect(out.summary).toContain('…');
    });

    it('does not crash on screenshotPlot with missing previewId', () => {
        const out = formatActionLine('screenshotPlot', {});
        expect(out.verb).toBe('Screenshot');
        // summary is "preview" alone (trimmed) when previewId is absent
        expect(out.summary).toBe('preview');
    });

    it('collapses whitespace in a multi-line plotConfig before truncating', () => {
        const out = formatActionLine('previewPlot', { plotConfig: 'BAR_CHART(\n  x: "a",\n  y: ["b"]\n)' });
        // Newlines should be normalized to spaces in the summary.
        expect(out.summary).not.toContain('\n');
        expect(out.summary).toMatch(/BAR_CHART\(\s*x:/);
    });
});
