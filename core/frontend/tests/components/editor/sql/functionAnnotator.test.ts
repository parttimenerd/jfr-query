import { describe, it, expect } from 'vitest';
import { annotateFunctions } from '../../../../components/editor/sql/annotators/functionAnnotator';
import type { Node } from '../../../../components/editor/sql/ast';

// ── helpers ───────────────────────────────────────────────────────────────────

function leaf(kind: Node['kind'], text: string): Node {
    return { kind, from: 0, to: text.length, text, children: [], annotations: {} };
}

function funcCallNode(fnName: string, extraChildren: Node[] = []): Node {
    const nameNode = leaf('identifier', fnName);
    const children = [nameNode, ...extraChildren];
    const n: Node = {
        kind: 'functionCall',
        from: 0,
        to: fnName.length + 2,
        text: `${fnName}()`,
        children,
        annotations: {},
    };
    for (const c of children) c.parent = n;
    return n;
}

function wrapInQuery(children: Node[]): Node {
    const q: Node = { kind: 'query', from: 0, to: 100, text: '', children, annotations: {} };
    for (const c of children) c.parent = q;
    return q;
}

// ── annotateFunctions ─────────────────────────────────────────────────────────

describe('annotateFunctions', () => {
    it('annotates a known SQL function (COUNT)', () => {
        const fn = funcCallNode('COUNT');
        const root = wrapInQuery([fn]);
        annotateFunctions(root);
        expect(fn.annotations.resolves).toBeDefined();
        expect(fn.annotations.resolves?.kind).toBe('function');
        expect(fn.annotations.resolves?.name).toBe('COUNT');
        expect(typeof fn.annotations.resolves?.signature).toBe('string');
        expect(fn.annotations.resolves?.signature).toContain('COUNT');
    });

    it('also resolves the inner identifier node', () => {
        const fn = funcCallNode('SUM');
        const root = wrapInQuery([fn]);
        const nameNode = fn.children[0];
        annotateFunctions(root);
        expect(nameNode.annotations.resolves).toBeDefined();
        expect(nameNode.annotations.resolves?.kind).toBe('function');
        expect(nameNode.annotations.resolves?.name).toBe('SUM');
    });

    it('is case-insensitive: lowercase count resolves', () => {
        const fn = funcCallNode('count');
        const root = wrapInQuery([fn]);
        annotateFunctions(root);
        expect(fn.annotations.resolves).toBeDefined();
        expect(fn.annotations.resolves?.kind).toBe('function');
    });

    it('is case-insensitive: mixed case AVG resolves', () => {
        const fn = funcCallNode('Avg');
        const root = wrapInQuery([fn]);
        annotateFunctions(root);
        expect(fn.annotations.resolves).toBeDefined();
    });

    it('leaves annotations empty for an unknown function', () => {
        const fn = funcCallNode('NONEXISTENT_FUNCTION_XYZ');
        const root = wrapInQuery([fn]);
        annotateFunctions(root);
        expect(fn.annotations.resolves).toBeUndefined();
    });

    it('does not overwrite existing annotations.resolves', () => {
        const fn = funcCallNode('MAX');
        fn.annotations.resolves = { kind: 'function', name: 'CUSTOM', signature: 'CUSTOM()' };
        const root = wrapInQuery([fn]);
        annotateFunctions(root);
        // Pre-existing annotation should be preserved.
        expect(fn.annotations.resolves?.name).toBe('CUSTOM');
    });

    it('annotates multiple function calls in the same query', () => {
        const fn1 = funcCallNode('MIN');
        const fn2 = funcCallNode('MAX');
        const root = wrapInQuery([fn1, fn2]);
        annotateFunctions(root);
        expect(fn1.annotations.resolves?.name).toBe('MIN');
        expect(fn2.annotations.resolves?.name).toBe('MAX');
    });

    it('annotates AVG correctly', () => {
        const fn = funcCallNode('AVG');
        const root = wrapInQuery([fn]);
        annotateFunctions(root);
        expect(fn.annotations.resolves?.signature).toContain('AVG');
    });

    it('does not annotate non-functionCall nodes', () => {
        const id = leaf('identifier', 'COUNT');
        const root = wrapInQuery([id]);
        annotateFunctions(root);
        // identifier that isn't inside a functionCall should not be annotated
        expect(id.annotations.resolves).toBeUndefined();
    });

    it('handles a functionCall with no identifier child gracefully', () => {
        // Edge case: functionCall with no children
        const fn: Node = { kind: 'functionCall', from: 0, to: 5, text: 'fn()', children: [], annotations: {} };
        const root = wrapInQuery([fn]);
        expect(() => annotateFunctions(root)).not.toThrow();
        expect(fn.annotations.resolves).toBeUndefined();
    });
});
