// functionAnnotator: walks every `functionCall` node and attaches
// `annotations.resolves` of kind 'function' with the signature lookup from
// SQL_FUNCTIONS. The function name is the first `identifier` child.

import { type Node, walk } from '../ast';
import { SQL_FUNCTIONS } from '../../sqlFunctions';

// Build a case-insensitive name → signature map once.
const FN_BY_NAME = new Map<string, string>(
    SQL_FUNCTIONS.map(f => [f.name.toLowerCase(), f.signature]),
);

export function annotateFunctions(root: Node): void {
    walk(root, (n) => {
        if (n.kind !== 'functionCall') return;
        if (n.annotations.resolves) return;
        const nameNode = n.children.find(c => c.kind === 'identifier');
        if (!nameNode) return;
        const name = nameNode.text;
        const sig = FN_BY_NAME.get(name.toLowerCase());
        if (sig) {
            n.annotations.resolves = { kind: 'function', name, signature: sig };
            // Also resolve the inner identifier so hover/diagnostics can read it.
            if (!nameNode.annotations.resolves) {
                nameNode.annotations.resolves = { kind: 'function', name, signature: sig };
            }
        }
    });
}
