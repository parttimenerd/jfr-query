import { describe, it, expect } from 'vitest';
import { parseAndAnnotate } from '../../../../components/editor/plot/index';

const schema = [
    { name: 'ts', dataType: 'BIGINT' },
    { name: 'duration', dataType: 'DOUBLE' },
    { name: 'cause', dataType: 'VARCHAR' },
];

function findAll(root: ReturnType<typeof parseAndAnnotate>['root'], kind: string): ReturnType<typeof parseAndAnnotate>['root'][] {
    const found: ReturnType<typeof parseAndAnnotate>['root'][] = [];
    function walk(n: typeof root) {
        if (n.kind === kind) found.push(n);
        for (const c of n.children) walk(c);
    }
    walk(root);
    return found;
}

// ── parseAndAnnotate ──────────────────────────────────────────────────────────

describe('parseAndAnnotate — basic parsing', () => {
    it('returns a root node of kind script', () => {
        const { root } = parseAndAnnotate({ src: 'TABLE()' });
        expect(root.kind).toBe('script');
    });

    it('returns a PlotScope', () => {
        const { scope } = parseAndAnnotate({ src: 'TABLE()', resultColumns: schema });
        expect(scope).toBeDefined();
    });

    it('handles empty source without throwing', () => {
        expect(() => parseAndAnnotate({ src: '' })).not.toThrow();
    });
});

describe('parseAndAnnotate — column annotation', () => {
    it('resolves column idents in column-typed clauses', () => {
        const { root } = parseAndAnnotate({
            src: 'LINE_CHART(x: ts, y: [duration])',
            resultColumns: schema,
        });
        const idents = findAll(root, 'ident');
        const tsIdent = idents.find(n => n.name === 'ts' && n.annotations.resolves?.kind === 'column');
        expect(tsIdent).toBeDefined();
    });

    it('does not crash for unknown columns', () => {
        expect(() =>
            parseAndAnnotate({
                src: 'LINE_CHART(x: unknown_col, y: [duration])',
                resultColumns: schema,
            })
        ).not.toThrow();
    });
});

describe('parseAndAnnotate — constant annotation', () => {
    it('resolves LET constants', () => {
        const { root, scope } = parseAndAnnotate({
            src: 'LET @bins = 20\nHISTOGRAM(x: duration)',
            resultColumns: schema,
        });
        expect(scope.lookupConstant('bins')?.valueText).toBe('20');
        const letNodes = findAll(root, 'letStatement');
        expect(letNodes[0]?.annotations.resolves?.kind).toBe('constant');
    });
});

describe('parseAndAnnotate — cursor position', () => {
    it('accepts cursorPos without throwing', () => {
        const src = 'TABLE(';
        expect(() => parseAndAnnotate({ src, cursorPos: src.length })).not.toThrow();
    });
});

describe('parseAndAnnotate — shape registry', () => {
    it('annotates shapes when shapeRegistry is provided', () => {
        const registry = {
            line: {
                name: 'line',
                validClauses: ['x', 'y'],
                columnClauses: ['x', 'y'],
                requiredClauses: ['x', 'y'],
            },
        };
        const { root } = parseAndAnnotate({
            src: 'LINE_CHART(x: ts, y: [duration])',
            resultColumns: schema,
            shapeRegistry: registry,
        });
        const plotCalls = findAll(root, 'plotCall');
        const annotated = plotCalls.find(n => n.annotations.resolves?.kind === 'plotShape');
        expect(annotated).toBeDefined();
        expect(annotated?.annotations.resolves?.name).toBe('line');
    });
});
