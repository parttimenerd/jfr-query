import { describe, it, expect } from 'vitest';
import { findHoveredNode, nearestResolved } from '../../components/editor/sql/hoverNode';
import type { Node } from '../../components/editor/sql/ast';

// ── helpers ───────────────────────────────────────────────────────────────────

function leaf(kind: Node['kind'], from: number, to: number, text = ''): Node {
    return { kind, from, to, text: text || kind, children: [], annotations: {} };
}

function node(kind: Node['kind'], from: number, to: number, children: Node[]): Node {
    const n: Node = { kind, from, to, text: '', children, annotations: {} };
    for (const c of children) c.parent = n;
    return n;
}

// ── findHoveredNode ───────────────────────────────────────────────────────────

describe('findHoveredNode', () => {
    it('returns null when pos is outside the root span', () => {
        const root = node('query', 0, 10, []);
        expect(findHoveredNode(root, 20)).toBeNull();
        expect(findHoveredNode(root, -1)).toBeNull();
    });

    it('returns the deepest containing node', () => {
        const id = leaf('identifier', 7, 8, 'a');
        const sel = node('selectClause', 0, 10, [id]);
        const root = node('query', 0, 10, [sel]);
        expect(findHoveredNode(root, 7)).toBe(id);
    });

    it('returns root when pos is inside root but no deeper child matches', () => {
        const root = node('query', 0, 10, []);
        // pos inside root span, no children
        const result = findHoveredNode(root, 5);
        expect(result).toBe(root);
    });

    it('handles boundary at from (inclusive)', () => {
        const id = leaf('identifier', 3, 6, 'foo');
        const root = node('query', 0, 10, [id]);
        expect(findHoveredNode(root, 3)).toBe(id);
    });

    it('handles boundary at to (inclusive)', () => {
        const id = leaf('identifier', 3, 6, 'foo');
        const root = node('query', 0, 10, [id]);
        expect(findHoveredNode(root, 6)).toBe(id);
    });

    it('selects sibling based on cursor position', () => {
        const a = leaf('identifier', 0, 3, 'foo');
        const b = leaf('identifier', 4, 7, 'bar');
        const root = node('query', 0, 7, [a, b]);
        expect(findHoveredNode(root, 0)).toBe(a);
        expect(findHoveredNode(root, 5)).toBe(b);
    });
});

// ── nearestResolved ───────────────────────────────────────────────────────────

describe('nearestResolved', () => {
    it('returns node itself when it has annotations.resolves', () => {
        const id = leaf('identifier', 0, 3, 'foo');
        id.annotations.resolves = { kind: 'function', name: 'foo', signature: 'foo()' } as any;
        expect(nearestResolved(id)).toBe(id);
    });

    it('walks up to parent that has resolves', () => {
        const id = leaf('identifier', 0, 3, 'foo');
        const parent = node('functionCall', 0, 5, [id]);
        parent.annotations.resolves = { kind: 'function', name: 'COUNT', signature: 'COUNT()' } as any;
        expect(nearestResolved(id)).toBe(parent);
    });

    it('returns null when no ancestor has resolves', () => {
        const id = leaf('identifier', 0, 3, 'foo');
        const parent = node('query', 0, 10, [id]);
        expect(nearestResolved(id)).toBeNull();
        expect(nearestResolved(parent)).toBeNull();
    });

    it('prefers the closer ancestor', () => {
        const id = leaf('identifier', 0, 3, 'foo');
        const inner = node('projection', 0, 5, [id]);
        inner.annotations.resolves = { kind: 'column', name: 'foo' } as any;
        const outer = node('selectClause', 0, 10, [inner]);
        outer.annotations.resolves = { kind: 'function', name: 'COUNT', signature: '' } as any;
        expect(nearestResolved(id)).toBe(inner);
    });

    it('returns node directly if it has resolves (no traversal needed)', () => {
        const root = leaf('query', 0, 10);
        root.annotations.resolves = { kind: 'function', name: 'fn', signature: '' } as any;
        expect(nearestResolved(root)).toBe(root);
    });
});
