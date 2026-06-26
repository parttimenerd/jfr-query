// Find the deepest annotated AST node that contains a hover position.
//
// Mirrors `cursorNode` from ast.ts but tuned for hover:
//   - The same "deepest containing" rule.
//   - Returns null if `pos` lands outside the root span (rare, but possible
//     when the doc has been edited between parse and hover).

import { cursorNode, type Node } from './ast';

export function findHoveredNode(root: Node, pos: number): Node | null {
    if (pos < root.from || pos > root.to) return null;
    const n = cursorNode(root, pos);
    return n;
}

// Walk upward from `node` until we hit a node with `annotations.resolves`.
// Returns the original node if it already resolves, the resolving ancestor
// otherwise, or null if none of the ancestors carry a resolution.
export function nearestResolved(node: Node): Node | null {
    let n: Node | undefined = node;
    while (n) {
        if (n.annotations.resolves) return n;
        n = n.parent;
    }
    return null;
}
