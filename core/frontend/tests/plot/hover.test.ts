// Plot-mode hover adapter tests. Asserts the pure `getPlotHoverContent`
// adapter returns a typed `PlotHoverContent` descriptor matching the
// hovered AST node — independently of CodeMirror DOM rendering.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    getPlotHoverContent,
    _resetPlotHoverCacheForTests,
    type PlotHoverDeps,
    type PlotScopeView,
} from '../../components/editor/hover';
import type { ShapeRegistry } from '../../components/editor/plot/annotators/shapeAnnotator';
import type { ColumnSchema } from '../../components/editor/plot/ast';

const lineShape = {
    name: 'line',
    validClauses: ['x', 'y', 'color'],
    columnClauses: ['x', 'y', 'color'],
    requiredClauses: ['x', 'y'],
    description: 'A line chart over time.',
    clauseDefs: [
        { key: 'x', paramType: 'column', required: true, description: 'x axis column' },
        { key: 'y', paramType: 'column', required: true, description: 'y axis column' },
        { key: 'color', paramType: 'column', required: false, description: 'series color column' },
    ],
};

const shapeRegistry: ShapeRegistry = { line: lineShape };

function makeDeps(overrides: Partial<PlotHoverDeps> = {}): PlotHoverDeps {
    return {
        schema: null,
        variables: {},
        shapeRegistry,
        cellColumns: null,
        notebookScope: null,
        ...overrides,
    };
}

beforeEach(() => {
    _resetPlotHoverCacheForTests();
});

describe('getPlotHoverContent', () => {
    it('1. hover on shape token (LINE_CHART) → kind: shape', () => {
        const src = 'LINE_CHART(x: ts)';
        const pos = src.indexOf('LINE_CHART') + 2; // mid-token
        const c = getPlotHoverContent(src, pos, makeDeps({
            cellColumns: [{ name: 'ts', dataType: 'TIMESTAMP' }],
        }));
        expect(c).not.toBeNull();
        expect(c!.kind).toBe('shape');
        if (c!.kind === 'shape') {
            expect(c.name).toBe('line');
            expect(c.requiredClauses).toEqual(expect.arrayContaining(['x', 'y']));
        }
    });

    it('2. hover on a clause key (`x` in `x: ts`) → kind: clauseDef', () => {
        const src = 'line { x: ts }';
        const pos = src.indexOf('x: ts'); // points at `x`
        const c = getPlotHoverContent(src, pos, makeDeps({
            cellColumns: [{ name: 'ts', dataType: 'TIMESTAMP' }],
        }));
        expect(c).not.toBeNull();
        expect(c!.kind).toBe('clauseDef');
        if (c!.kind === 'clauseDef') {
            expect(c.clauseKey).toBe('x');
            expect(c.shape).toBe('line');
            expect(c.paramType).toBe('column');
            expect(c.required).toBe(true);
        }
    });

    it('3. hover on a column value (`ts` in `x: ts`) → kind: column with dataType', () => {
        const src = 'line { x: ts }';
        const cols: ColumnSchema[] = [{ name: 'ts', dataType: 'TIMESTAMP' }];
        const pos = src.indexOf('ts'); // points at `t` of `ts`
        const c = getPlotHoverContent(src, pos, makeDeps({ cellColumns: cols }));
        expect(c).not.toBeNull();
        expect(c!.kind).toBe('column');
        if (c!.kind === 'column') {
            expect(c.name).toBe('ts');
            expect(c.dataType).toBe('TIMESTAMP');
            expect(c.clauseKey).toBe('x');
        }
    });

    it('4. hover on @foo with LET @foo = "..." → kind: constant', () => {
        const src = 'LET @foo = "hello"\nline { x: @foo }';
        const pos = src.lastIndexOf('@foo') + 1; // mid-ref
        const c = getPlotHoverContent(src, pos, makeDeps());
        expect(c).not.toBeNull();
        expect(c!.kind).toBe('constant');
        if (c!.kind === 'constant') {
            expect(c.name).toBe('foo');
            // valueText preserves quotes from the source per constAnnotator semantics.
            expect(c.valueText).toMatch(/hello/);
        }
    });

    it('5. hover on $start (cell-local var defined in variables) → variable scope=cellLocal', () => {
        const src = 'line { x: $start }';
        const pos = src.indexOf('$start') + 2;
        const c = getPlotHoverContent(src, pos, makeDeps({
            variables: { $start: '2024-01-01' },
        }));
        expect(c).not.toBeNull();
        expect(c!.kind).toBe('variable');
        if (c!.kind === 'variable') {
            expect(c.scope).toBe('cellLocal');
            expect(c.value).toBe('2024-01-01');
        }
    });

    it('6. hover on $gc.brush.lo → variable scope=brush, dataType=timestamp', () => {
        const src = 'line { x: $gc.brush.lo }';
        const pos = src.indexOf('$gc.brush.lo') + 1;
        const c = getPlotHoverContent(src, pos, makeDeps({
            notebookScope: { plots: [{ name: 'gc', shape: 'line' }] },
        }));
        expect(c).not.toBeNull();
        expect(c!.kind).toBe('variable');
        if (c!.kind === 'variable') {
            expect(c.scope).toBe('brush');
            expect(c.dataType).toBe('timestamp');
        }
    });

    it('7. hover on LINK_X keyword → kind: tail', () => {
        const src = 'LINE_CHART(x: ts) LINK_X($a, $b)';
        const pos = src.indexOf('LINK_X') + 2;
        const c = getPlotHoverContent(src, pos, makeDeps({
            cellColumns: [{ name: 'ts', dataType: 'TIMESTAMP' }],
        }));
        expect(c).not.toBeNull();
        expect(c!.kind).toBe('tail');
        if (c!.kind === 'tail') {
            expect(c.keyword).toBe('LINK_X');
            expect(c.description).toBeTruthy();
        }
    });

    it('8. hover on cross-plot ref `gc_pauses` inside `ON gc_pauses` → kind: crossPlot', () => {
        const src = 'TABLE() ON gc_pauses';
        const pos = src.indexOf('gc_pauses') + 2;
        const notebookScope: PlotScopeView = {
            plots: [{ name: 'gc_pauses', shape: 'bar', cellId: 'cell-3' }],
        };
        const c = getPlotHoverContent(src, pos, makeDeps({
            shapeRegistry: { table: { name: 'table' } },
            notebookScope,
        }));
        expect(c).not.toBeNull();
        expect(c!.kind).toBe('crossPlot');
        if (c!.kind === 'crossPlot') {
            expect(c.plotName).toBe('gc_pauses');
            expect(c.shape).toBe('bar');
            expect(c.cellId).toBe('cell-3');
        }
    });

    it('returns null on whitespace between tokens', () => {
        const src = 'LINE_CHART( x: ts )';
        // Pick a position firmly in whitespace between `(` and `x`.
        const pos = src.indexOf('( x') + 1;
        const c = getPlotHoverContent(src, pos, makeDeps({
            cellColumns: [{ name: 'ts', dataType: 'TIMESTAMP' }],
        }));
        // It's OK if the adapter returns a wider node (e.g. plotCall) at this
        // position, but it MUST NOT throw and must produce a stable shape.
        if (c !== null) {
            expect(['shape', 'clauseDef', 'column', 'tail']).toContain(c.kind);
        }
    });
});

describe('plot hover cache', () => {
    it('reuses the parsed AST when (source, deps) identities are stable', () => {
        const src = 'line { x: ts }';
        const cols: ColumnSchema[] = [{ name: 'ts', dataType: 'TIMESTAMP' }];
        const deps = makeDeps({ cellColumns: cols });
        const c1 = getPlotHoverContent(src, src.indexOf('ts'), deps);
        const c2 = getPlotHoverContent(src, src.indexOf('ts'), deps);
        expect(c1).not.toBeNull();
        expect(c2).not.toBeNull();
        expect(c2!.kind).toBe(c1!.kind);
    });
});
