import { describe, it, expect } from 'vitest';
import { mergeTemplate, _collectCellHandles, _renameCollidingCells } from '../utils/templateMerge';
import { reconstructNotebook, parseNotebook } from '../utils/notebookParser';
import type { NotebookMetadata } from '../types';

function nb(metadata: Partial<NotebookMetadata>, content = '# Body\n'): string {
    return reconstructNotebook({ metadata: metadata as NotebookMetadata, content });
}

// ─── replace mode ──────────────────────────────────────────────────────────────

describe('mergeTemplate — replace', () => {
    it('returns the template unchanged', () => {
        const current = '---\ntitle: Old\n---\n# Old content\n';
        const template = '---\ntitle: New\n---\n# New content\n';
        const { notebookSource, warnings } = mergeTemplate(current, template, 'replace');
        expect(notebookSource).toBe(template);
        expect(warnings).toEqual([]);
    });

    it('replace ignores insertAtIndex', () => {
        const current = '# a\n\n---\n\n# b\n';
        const template = '# t\n';
        const { notebookSource } = mergeTemplate(current, template, 'replace', 0);
        expect(notebookSource).toBe(template);
    });
});

// ─── append mode ──────────────────────────────────────────────────────────────

describe('mergeTemplate — append', () => {
    it('concatenates template body after current body', () => {
        const current = '---\n---\n# Current\n';
        const template = '---\n---\n# Template\n';
        const { notebookSource, warnings } = mergeTemplate(current, template, 'append');
        expect(warnings).toEqual([]);
        // body must contain both sections separated by ---
        expect(notebookSource).toContain('# Current');
        expect(notebookSource).toContain('# Template');
        expect(notebookSource).toContain('\n\n---\n\n');
    });

    it('current title wins on collision', () => {
        const current = '---\ntitle: Current Title\n---\n# A\n';
        const template = '---\ntitle: Template Title\n---\n# B\n';
        const { notebookSource } = mergeTemplate(current, template, 'append');
        expect(notebookSource).toContain('Current Title');
        expect(notebookSource).not.toContain('Template Title');
    });

    it('unions variables, current wins on collision', () => {
        const current = nb({ variables: { $a: '1', $b: '2' } }, '# A\n');
        const template = nb({ variables: { $b: '99', $c: '3' } }, '# B\n');
        const { notebookSource, warnings } = mergeTemplate(current, template, 'append');
        expect(warnings.some(w => w.includes('"$b"'))).toBe(true);
        expect(notebookSource).toContain('$c:');
    });

    it('renames colliding named cells with suffix', () => {
        const cellA = '<!-- @cell name=summary -->\n# Summary\n';
        const current = `---\n---\n${cellA}`;
        const template = `---\n---\n<!-- @cell name=summary -->\n# Template Summary\n`;
        const { notebookSource, warnings } = mergeTemplate(current, template, 'append');
        expect(warnings.some(w => w.includes('summary') && w.includes('summary-2'))).toBe(true);
        expect(notebookSource).toContain('name=summary-2');
    });

    it('does not rename cells without @cell annotations', () => {
        const current = '---\n---\n# Unnamed cell\n';
        const template = '---\n---\n# Another unnamed cell\n';
        const { warnings } = mergeTemplate(current, template, 'append');
        expect(warnings).toEqual([]);
    });

    it('unions views, current wins on collision', () => {
        const heapView = { id: 'v1', name: 'heap', sql: 'SELECT 1' };
        const newView = { id: 'v2', name: 'new_view', sql: 'SELECT 2' };
        const conflictView = { id: 'v3', name: 'heap', sql: 'SELECT 3' };
        const current = nb({ views: [heapView], macros: [] }, '# A\n');
        const template = nb({ views: [conflictView, newView], macros: [] }, '# B\n');
        const { notebookSource, warnings } = mergeTemplate(current, template, 'append');
        expect(warnings.some(w => w.includes('heap'))).toBe(true);
        expect(notebookSource).toContain('new_view');
    });

    it('unions macros from both notebooks', () => {
        const topN = { id: 'm1', name: 'topN', sql: 'SELECT 1' };
        const bottomK = { id: 'm2', name: 'bottomK', sql: 'SELECT 2' };
        const current = nb({ views: [], macros: [topN] }, '# A\n');
        const template = nb({ views: [], macros: [bottomK] }, '# B\n');
        const { notebookSource } = mergeTemplate(current, template, 'append');
        expect(notebookSource).toContain('topN');
        expect(notebookSource).toContain('bottomK');
    });
});

// ─── insert mode ──────────────────────────────────────────────────────────────

describe('mergeTemplate — insert', () => {
    // Use nb() so the front matter is properly formatted (not ambiguous ---)
    const current = nb({}, '# Cell 1\n\n---\n\n# Cell 2\n');
    const template = nb({}, '# Cell 3\n');

    it('all three cells appear after insert at 0', () => {
        const { notebookSource } = mergeTemplate(current, template, 'insert', 0);
        expect(notebookSource).toContain('# Cell 1');
        expect(notebookSource).toContain('# Cell 2');
        expect(notebookSource).toContain('# Cell 3');
        // Cell 3 must come before Cell 1
        expect(notebookSource.indexOf('# Cell 3')).toBeLessThan(notebookSource.indexOf('# Cell 1'));
    });

    it('inserts at index 1 (between cells)', () => {
        const { notebookSource } = mergeTemplate(current, template, 'insert', 1);
        expect(notebookSource).toContain('# Cell 1');
        expect(notebookSource).toContain('# Cell 2');
        expect(notebookSource).toContain('# Cell 3');
        // Cell 1 before Cell 3 before Cell 2
        expect(notebookSource.indexOf('# Cell 1')).toBeLessThan(notebookSource.indexOf('# Cell 3'));
        expect(notebookSource.indexOf('# Cell 3')).toBeLessThan(notebookSource.indexOf('# Cell 2'));
    });

    it('clamps out-of-bounds index to end', () => {
        const { notebookSource } = mergeTemplate(current, template, 'insert', 99);
        expect(notebookSource).toContain('# Cell 1');
        expect(notebookSource).toContain('# Cell 3');
        // Cell 3 should be last heading
        const c1 = notebookSource.indexOf('# Cell 1');
        const c2 = notebookSource.indexOf('# Cell 2');
        const c3 = notebookSource.indexOf('# Cell 3');
        expect(c3).toBeGreaterThan(c1);
        expect(c3).toBeGreaterThan(c2);
    });

    it('clamps negative index to beginning', () => {
        const { notebookSource } = mergeTemplate(current, template, 'insert', -5);
        // Cell 3 must come before Cell 1
        expect(notebookSource.indexOf('# Cell 3')).toBeLessThan(notebookSource.indexOf('# Cell 1'));
    });

    it('handles no insertAtIndex (appends)', () => {
        const { notebookSource } = mergeTemplate(current, template, 'insert');
        expect(notebookSource).toContain('# Cell 3');
    });
});

// ─── cellConditions rekey ──────────────────────────────────────────────────────

describe('mergeTemplate — cellConditions rekey on rename', () => {
    it('rekeys cellConditions from template when cell is renamed', () => {
        const current = `---\n---\n<!-- @cell name=analysis -->\n# Analysis\n`;
        const template = `---\ncellConditions:\n  analysis: SELECT 1\n---\n<!-- @cell name=analysis -->\n# Template Analysis\n`;
        const { notebookSource, warnings } = mergeTemplate(current, template, 'append');
        // 'analysis' cell renamed to 'analysis-2' in template
        expect(warnings.some(w => w.includes('analysis-2'))).toBe(true);
        // The cellCondition should be rekeyed to analysis-2
        expect(notebookSource).toContain('analysis-2');
    });
});

// ─── _collectCellHandles ──────────────────────────────────────────────────────

describe('_collectCellHandles', () => {
    it('collects bare name attributes', () => {
        const content = '<!-- @cell name=foo -->\n# A\n\n---\n\n<!-- @cell name=bar -->\n# B\n';
        const handles = _collectCellHandles(content);
        expect(handles.has('foo')).toBe(true);
        expect(handles.has('bar')).toBe(true);
    });

    it('collects quoted name attributes', () => {
        const content = '<!-- @cell name="my cell" -->\n# A\n';
        const handles = _collectCellHandles(content);
        expect(handles.has('my cell')).toBe(true);
    });

    it('returns empty set for content with no @cell', () => {
        const content = '# Just a heading\nsome text\n';
        expect(_collectCellHandles(content).size).toBe(0);
    });
});

// ─── _renameCollidingCells ────────────────────────────────────────────────────

describe('_renameCollidingCells', () => {
    it('renames a colliding cell and records in renameMap', () => {
        const existing = new Set(['foo']);
        const renameMap = new Map<string, string>();
        const warnings: string[] = [];
        const input = '<!-- @cell name=foo -->\n# Foo\n';
        const result = _renameCollidingCells(input, existing, renameMap, warnings);
        expect(result).toContain('name=foo-2');
        expect(renameMap.get('foo')).toBe('foo-2');
        expect(warnings).toHaveLength(1);
    });

    it('increments suffix when -2 also collides', () => {
        const existing = new Set(['foo', 'foo-2']);
        const renameMap = new Map<string, string>();
        const warnings: string[] = [];
        const input = '<!-- @cell name=foo -->\n# Foo\n';
        const result = _renameCollidingCells(input, existing, renameMap, warnings);
        expect(result).toContain('name=foo-3');
    });

    it('does not rename non-colliding cells', () => {
        const existing = new Set(['other']);
        const renameMap = new Map<string, string>();
        const warnings: string[] = [];
        const input = '<!-- @cell name=unique -->\n# Unique\n';
        const result = _renameCollidingCells(input, existing, renameMap, warnings);
        expect(result).toContain('name=unique');
        expect(warnings).toHaveLength(0);
    });
});
