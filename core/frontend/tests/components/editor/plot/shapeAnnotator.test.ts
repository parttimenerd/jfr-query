import { describe, it, expect } from 'vitest';
import { annotateShapes } from '../../../../components/editor/plot/annotators/shapeAnnotator';
import type { PlotNode } from '../../../../components/editor/plot/ast';
import type { ShapeRegistry } from '../../../../components/editor/plot/annotators/shapeAnnotator';

// ── helpers ───────────────────────────────────────────────────────────────────

function plotCallNode(shape: string, children: PlotNode[] = []): PlotNode {
    const n: PlotNode = {
        kind: 'plotCall',
        from: 0,
        to: 10,
        text: `${shape}()`,
        children,
        annotations: {},
        shape: shape.toLowerCase(),
        shapeRaw: shape,
        form: 'uppercase',
    };
    for (const c of children) c.parent = n;
    return n;
}

function clauseNode(key: string): PlotNode {
    const cref: PlotNode = { kind: 'clauseRef', from: 0, to: key.length, text: key, children: [], annotations: {} };
    const n: PlotNode = {
        kind: 'clause',
        from: 0,
        to: key.length + 5,
        text: `${key}: val`,
        children: [cref],
        annotations: {},
        key,
    };
    cref.parent = n;
    return n;
}

function scriptNode(children: PlotNode[]): PlotNode {
    const n: PlotNode = { kind: 'script', from: 0, to: 100, text: '', children, annotations: {} };
    for (const c of children) c.parent = n;
    return n;
}

const lineRegistry: ShapeRegistry = {
    line: {
        name: 'line',
        validClauses: ['x', 'y', 'color'],
        columnClauses: ['x', 'y', 'color'],
        requiredClauses: ['x', 'y'],
        description: 'Line chart',
    },
};

// ── annotateShapes ────────────────────────────────────────────────────────────

describe('annotateShapes', () => {
    it('resolves a known shape', () => {
        const call = plotCallNode('line');
        const root = scriptNode([call]);
        annotateShapes(root, lineRegistry);
        expect(call.annotations.resolves).toBeDefined();
        expect(call.annotations.resolves?.kind).toBe('plotShape');
        expect(call.annotations.resolves?.name).toBe('line');
    });

    it('leaves annotations undefined for an unknown shape', () => {
        const call = plotCallNode('unknown_shape');
        const root = scriptNode([call]);
        annotateShapes(root, lineRegistry);
        expect(call.annotations.resolves).toBeUndefined();
    });

    it('resolves validClauses from registry entry', () => {
        const call = plotCallNode('line');
        const root = scriptNode([call]);
        annotateShapes(root, lineRegistry);
        expect(call.annotations.resolves?.validClauses).toEqual(['x', 'y', 'color']);
    });

    it('resolves requiredClauses from registry entry', () => {
        const call = plotCallNode('line');
        const root = scriptNode([call]);
        annotateShapes(root, lineRegistry);
        expect(call.annotations.resolves?.requiredClauses).toEqual(['x', 'y']);
    });

    it('annotates clauseRef children with clauseDef resolves', () => {
        const xClause = clauseNode('x');
        const call = plotCallNode('line', [xClause]);
        const root = scriptNode([call]);
        const registryWithDefs: ShapeRegistry = {
            line: {
                ...lineRegistry.line,
                clauseDefs: [
                    { key: 'x', paramType: 'column', required: true, description: 'X axis column' },
                ],
            },
        };
        annotateShapes(root, registryWithDefs);
        const cref = xClause.children[0];
        expect(cref.annotations.resolves?.kind).toBe('clauseDef');
        expect(cref.annotations.resolves?.clauseKey).toBe('x');
        expect(cref.annotations.resolves?.paramType).toBe('column');
        expect(cref.annotations.resolves?.required).toBe(true);
    });

    it('annotates clauseRef without explicit clauseDef by inferring from columnClauses', () => {
        const xClause = clauseNode('x');
        const call = plotCallNode('line', [xClause]);
        const root = scriptNode([call]);
        annotateShapes(root, lineRegistry); // no clauseDefs, only columnClauses
        const cref = xClause.children[0];
        expect(cref.annotations.resolves?.kind).toBe('clauseDef');
        expect(cref.annotations.resolves?.paramType).toBe('column');
    });

    it('does not annotate nodes without a shape field', () => {
        const other: PlotNode = { kind: 'clause', from: 0, to: 5, text: 'x: y', children: [], annotations: {}, key: 'x' };
        const root = scriptNode([other]);
        annotateShapes(root, lineRegistry);
        expect(other.annotations.resolves).toBeUndefined();
    });

    it('does nothing with empty registry', () => {
        const call = plotCallNode('line');
        const root = scriptNode([call]);
        annotateShapes(root, {});
        expect(call.annotations.resolves).toBeUndefined();
    });

    it('annotates multiple plotCalls in the same script', () => {
        const call1 = plotCallNode('line');
        const call2 = plotCallNode('line');
        const root = scriptNode([call1, call2]);
        annotateShapes(root, lineRegistry);
        expect(call1.annotations.resolves?.kind).toBe('plotShape');
        expect(call2.annotations.resolves?.kind).toBe('plotShape');
    });

    it('includes description in resolved annotation', () => {
        const call = plotCallNode('line');
        const root = scriptNode([call]);
        annotateShapes(root, lineRegistry);
        expect(call.annotations.resolves?.description).toBe('Line chart');
    });
});
