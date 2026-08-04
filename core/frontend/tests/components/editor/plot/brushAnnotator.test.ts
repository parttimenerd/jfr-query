import { describe, it, expect } from 'vitest';
import { annotateBrush } from '../../../../components/editor/plot/annotators/brushAnnotator';
import { makeNode } from '../../../../components/editor/plot/ast';
import type { PlotNode } from '../../../../components/editor/plot/ast';
import type { NotebookPlotContext } from '../../../../components/editor/plot/notebookPlotScope';
import type { ParsedDollar } from '../../../../components/editor/sql/ast';

function makeCtx(brushes: Record<string, { xType: 'number' | 'timestamp' | 'string' | 'unknown'; yType: 'number' | 'timestamp' | 'string' | 'unknown' }>): NotebookPlotContext {
    const brushMap = new Map(
        Object.entries(brushes).map(([name, v]) => [name, { plotName: name, cellId: 'cell-0', ...v }])
    );
    return {
        currentCellId: 'cell-1',
        scope: {
            namedPlots: [],
            queryRefs: [],
            variables: new Map(),
            brushes: brushMap,
        },
    };
}

function makeVarRef(dollar: ParsedDollar): PlotNode {
    const n = makeNode('varRef', 0, dollar.raw.length, dollar.raw);
    n.dollar = dollar;
    return n;
}

describe('annotateBrush', () => {
    it('is a no-op for non-varRef nodes', () => {
        const n = makeNode('ident', 0, 4, 'test');
        annotateBrush(n, makeCtx({}));
        expect(n.annotations.resolves).toBeUndefined();
    });

    it('is a no-op for varRef without dollar', () => {
        const n = makeNode('varRef', 0, 4, 'test');
        // no n.dollar set
        annotateBrush(n, makeCtx({}));
        expect(n.annotations.resolves).toBeUndefined();
    });

    it('is a no-op for non-crossCellRef dollar', () => {
        const n = makeVarRef({ kind: 'variableRef', name: 'foo', path: [], raw: '$foo' });
        annotateBrush(n, makeCtx({}));
        expect(n.annotations.resolves).toBeUndefined();
    });

    it('is a no-op when path does not start with "brush"', () => {
        const n = makeVarRef({ kind: 'crossCellRef', name: 'gc', path: ['columns'], raw: '$gc.columns' });
        annotateBrush(n, makeCtx({ gc: { xType: 'timestamp', yType: 'number' } }));
        expect(n.annotations.resolves).toBeUndefined();
    });

    it('is a no-op when brush plot is not found in scope', () => {
        const n = makeVarRef({ kind: 'crossCellRef', name: 'missing', path: ['brush'], raw: '$missing.brush' });
        annotateBrush(n, makeCtx({ gc: { xType: 'timestamp', yType: 'number' } }));
        expect(n.annotations.resolves).toBeUndefined();
    });

    it('resolves a .brush ref to the plot xType', () => {
        const d: ParsedDollar = { kind: 'crossCellRef', name: 'gc', path: ['brush'], raw: '$gc.brush' };
        const n = makeVarRef(d);
        annotateBrush(n, makeCtx({ gc: { xType: 'timestamp', yType: 'number' } }));
        expect(n.annotations.resolves).toBeDefined();
        const r = n.annotations.resolves as any;
        expect(r.kind).toBe('variable');
        expect(r.source).toBe('brush');
        expect(r.dataType).toBe('timestamp');
    });

    it('resolves .brush.lo to the plot xType', () => {
        const d: ParsedDollar = { kind: 'crossCellRef', name: 'gc', path: ['brush', 'lo'], raw: '$gc.brush.lo' };
        const n = makeVarRef(d);
        annotateBrush(n, makeCtx({ gc: { xType: 'number', yType: 'number' } }));
        expect((n.annotations.resolves as any).dataType).toBe('number');
    });

    it('resolves .brush.hi to the plot xType', () => {
        const d: ParsedDollar = { kind: 'crossCellRef', name: 'gc', path: ['brush', 'hi'], raw: '$gc.brush.hi' };
        const n = makeVarRef(d);
        annotateBrush(n, makeCtx({ gc: { xType: 'number', yType: 'number' } }));
        expect((n.annotations.resolves as any).dataType).toBe('number');
    });

    it('resolves .brush.field to "string" regardless of xType', () => {
        const d: ParsedDollar = { kind: 'crossCellRef', name: 'gc', path: ['brush', 'field'], raw: '$gc.brush.field' };
        const n = makeVarRef(d);
        annotateBrush(n, makeCtx({ gc: { xType: 'timestamp', yType: 'number' } }));
        expect((n.annotations.resolves as any).dataType).toBe('string');
    });

    it('attaches the parsed dollar to the resolution', () => {
        const d: ParsedDollar = { kind: 'crossCellRef', name: 'gc', path: ['brush'], raw: '$gc.brush' };
        const n = makeVarRef(d);
        annotateBrush(n, makeCtx({ gc: { xType: 'timestamp', yType: 'number' } }));
        expect((n.annotations.resolves as any).parsed).toBe(d);
    });
});
