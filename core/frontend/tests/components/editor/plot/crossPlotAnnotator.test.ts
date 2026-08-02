import { describe, it, expect } from 'vitest';
import { annotateCrossPlot } from '../../../../components/editor/plot/annotators/crossPlotAnnotator';
import { parse } from '../../../../components/editor/plot/parser';
import { setParents, makeNode } from '../../../../components/editor/plot/ast';
import type { NotebookPlotContext } from '../../../../components/editor/plot/notebookPlotScope';

function makeCtx(overrides: Partial<NotebookPlotContext['scope']> = {}): NotebookPlotContext {
    return {
        currentCellId: 'cell-1',
        scope: {
            namedPlots: [],
            queryRefs: [],
            variables: new Map(),
            brushes: new Map(),
            ...overrides,
        },
    };
}

function walk(root: any, kind: string): any[] {
    const found: any[] = [];
    const visit = (n: any) => {
        if (n.kind === kind) found.push(n);
        for (const c of n.children) visit(c);
    };
    visit(root);
    return found;
}

describe('annotateCrossPlot — no-op without context', () => {
    it('returns immediately when ctx is undefined', () => {
        const root = parse('LINE_CHART(x: ts) ON #1');
        setParents(root);
        // No error thrown, no annotations set
        expect(() => annotateCrossPlot(root)).not.toThrow();
    });
});

describe('annotateCrossPlot — queryRef resolution', () => {
    it('resolves a numeric queryRef when found in scope', () => {
        const root = parse('LINE_CHART(x: ts) ON #1');
        setParents(root);
        const ctx = makeCtx({
            queryRefs: [{ index: 1, cellId: 'cell-0', sql: 'SELECT ts FROM events', columns: [] }],
        });
        annotateCrossPlot(root, ctx);
        const refs = walk(root, 'queryRef').filter((n: any) => n.annotations.resolves);
        expect(refs.length).toBeGreaterThanOrEqual(1);
        expect(refs[0].annotations.resolves.kind).toBe('queryRef');
        expect(refs[0].annotations.resolves.targetCellId).toBe('cell-0');
    });

    it('adds a warning diagnostic when queryRef index not in scope', () => {
        const root = parse('LINE_CHART(x: ts) ON #9');
        setParents(root);
        const ctx = makeCtx({ queryRefs: [] });
        annotateCrossPlot(root, ctx);
        const refs = walk(root, 'queryRef');
        const withDiag = refs.filter((n: any) =>
            n.annotations.structuredDiagnostics?.some((d: any) => d.code === 'unknown-query-ref')
        );
        expect(withDiag.length).toBeGreaterThanOrEqual(1);
    });
});

describe('annotateCrossPlot — named plot resolution in LINK_X', () => {
    it('resolves a bare ident in LINK_X tail to a known named plot', () => {
        const root = parse('LINE_CHART(x: ts) LINK_X($a, $b, gc_plot)');
        setParents(root);
        const ctx = makeCtx({
            namedPlots: [{ plotName: 'gc_plot', cellId: 'cell-0', plotIndexInCell: 0, shape: 'line', hasBrush: false }],
        });
        annotateCrossPlot(root, ctx);
        const idents = walk(root, 'ident').filter((n: any) =>
            n.name === 'gc_plot' && n.annotations.resolves?.kind === 'crossPlot'
        );
        expect(idents.length).toBe(1);
        expect(idents[0].annotations.resolves.plotName).toBe('gc_plot');
    });

    it('adds a warning diagnostic for unknown bare ident inside LINK_X', () => {
        const root = parse('LINE_CHART(x: ts) LINK_X($a, $b, no_such_plot)');
        setParents(root);
        const ctx = makeCtx({ namedPlots: [] });
        annotateCrossPlot(root, ctx);
        const idents = walk(root, 'ident').filter((n: any) => n.name === 'no_such_plot');
        const hasDiag = idents.some((n: any) =>
            n.annotations.structuredDiagnostics?.some((d: any) => d.code === 'unknown-plot')
        );
        expect(hasDiag).toBe(true);
    });

    it('does not flag positional keywords like "master" inside LINK_X', () => {
        const root = parse('LINE_CHART(x: ts) LINK_X($a, $b, master)');
        setParents(root);
        const ctx = makeCtx({ namedPlots: [] });
        annotateCrossPlot(root, ctx);
        const masterIdents = walk(root, 'ident').filter((n: any) => n.name === 'master');
        const hasDiag = masterIdents.some((n: any) =>
            n.annotations.structuredDiagnostics?.some((d: any) => d.code === 'unknown-plot')
        );
        expect(hasDiag).toBe(false);
    });
});

describe('annotateCrossPlot — variable enrichment', () => {
    it('enriches a varRef that already has an unresolved variable annotation', () => {
        // crossPlotAnnotator enriches varRef nodes that have been pre-annotated
        // by the variable annotator with kind='variable' but no source yet.
        const root = parse('LINE_CHART(x: $myVar)');
        setParents(root);
        // Manually seed the unresolved annotation that the variable annotator would set.
        const varRefs = walk(root, 'varRef');
        const target = varRefs.find((n: any) => n.dollar?.name === 'myVar');
        expect(target).toBeDefined();
        target!.annotations.resolves = {
            kind: 'variable',
            parsed: target!.dollar!,
            // no source yet — the enrichment path requires source to be absent
        } as any;

        const ctx = makeCtx({
            variables: new Map([['myVar', { name: 'myVar', scope: 'workspace', value: '42', dataType: 'number' }]]),
        });
        annotateCrossPlot(root, ctx);
        expect(target!.annotations.resolves!.source).toBe('workspace');
        expect(target!.annotations.resolves!.value).toBe('42');
    });

    it('does not overwrite a varRef that already has a source annotation', () => {
        // Once source is set (e.g. by brush annotator) the enrichment must skip it.
        const root = parse('LINE_CHART(x: $myVar)');
        setParents(root);
        const varRefs = walk(root, 'varRef');
        const target = varRefs.find((n: any) => n.dollar?.name === 'myVar');
        expect(target).toBeDefined();
        target!.annotations.resolves = {
            kind: 'variable',
            parsed: target!.dollar!,
            source: 'brush',
            dataType: 'timestamp',
        } as any;

        const ctx = makeCtx({
            variables: new Map([['myVar', { name: 'myVar', scope: 'workspace', value: '42', dataType: 'number' }]]),
        });
        annotateCrossPlot(root, ctx);
        // Source should remain 'brush', not be overwritten
        expect(target!.annotations.resolves!.source).toBe('brush');
    });
});
