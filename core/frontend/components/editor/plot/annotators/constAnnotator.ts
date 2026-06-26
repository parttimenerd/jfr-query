// Resolves `@name` references against `letStatement` declarations.
// Order matters: forward references (a const used before it is declared) emit
// a diagnostic. Cycle detection walks the dependency graph of constants.

import { walk, type PlotNode } from '../ast';
import { PlotScope } from '../scope';

/** Walk the AST in document order. Populates the scope and annotates. */
export function annotateConstants(root: PlotNode, scope: PlotScope): void {
    // Pass 1 — collect letStatements in document order; cycle-check by looking
    // at the chain of references they make to other @ names.
    const decls: { name: string; node: PlotNode; refs: string[] }[] = [];
    for (const child of root.children) {
        if (child.kind !== 'letStatement') continue;
        const name = child.letName ?? '';
        if (!name) continue;
        const refs = collectConstRefs(child);
        decls.push({ name, node: child, refs });
    }

    // Cycle detection — Tarjan-lite. We only need to flag cycles for nodes
    // whose own refs eventually point back to themselves.
    for (const d of decls) {
        if (hasCycle(d.name, decls)) {
            d.node.annotations.diagnostics ??= [];
            d.node.annotations.diagnostics.push(`Cycle detected in constant @${d.name}`);
        }
    }

    // Pass 2 — in document order, register each constant. The valueText is
    // taken from the second child (the expression) by reading its source slice.
    for (const child of root.children) {
        if (child.kind !== 'letStatement') continue;
        const name = child.letName ?? '';
        if (!name) continue;
        const exprChild = child.children.find(c => c.kind !== 'constRef' && c.kind !== 'hole') ?? child.children[child.children.length - 1];
        const valueText = exprChild && exprChild.text ? exprChild.text : '';
        if (scope.lookupConstant(name)) {
            child.annotations.diagnostics ??= [];
            child.annotations.diagnostics.push(`Redefinition of constant @${name}`);
        }
        scope.addConstant(name, valueText, child);
        child.annotations.resolves = { kind: 'constant', name, valueText };
    }

    // Pass 3 — resolve every @ref in the document. Forward refs (ref to a
    // const not yet declared at the ref's position) are flagged.
    // For ordering: a ref at position `from` is "forward" if its const is
    // declared at a position > from.
    const declPos = new Map<string, number>();
    for (const d of decls) declPos.set(d.name, d.node.from);

    walk(root, n => {
        if (n.kind !== 'constRef') return;
        if (!n.constName) return;
        const c = scope.lookupConstant(n.constName);
        if (!c) {
            n.annotations.diagnostics ??= [];
            n.annotations.diagnostics.push(`Undefined constant @${n.constName}`);
            return;
        }
        const declAt = declPos.get(n.constName);
        if (declAt !== undefined && declAt > n.from) {
            n.annotations.diagnostics ??= [];
            n.annotations.diagnostics.push(`Forward reference to @${n.constName} (declared later)`);
        }
        n.annotations.resolves = { kind: 'constant', name: n.constName, valueText: c.valueText };
    });
}

function collectConstRefs(node: PlotNode): string[] {
    const refs: string[] = [];
    walk(node, n => {
        if (n.kind === 'constRef' && n.constName && n !== node.children[0]) {
            // first child is the @name being declared (the LHS) — skip it.
            refs.push(n.constName);
        }
    });
    return refs;
}

function hasCycle(start: string, decls: { name: string; refs: string[] }[]): boolean {
    const byName = new Map<string, string[]>();
    for (const d of decls) byName.set(d.name, d.refs);
    const visited = new Set<string>();
    const stack: string[] = [start];
    while (stack.length > 0) {
        const cur = stack.pop()!;
        const refs = byName.get(cur);
        if (!refs) continue;
        for (const r of refs) {
            if (r === start) return true;
            if (visited.has(r)) continue;
            visited.add(r);
            stack.push(r);
        }
    }
    return false;
}
