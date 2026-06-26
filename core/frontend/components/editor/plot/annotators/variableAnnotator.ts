// Resolves `$var` / `$$var` / `$cell.var[.path]` references. Reuses
// `parseDollar` semantics from the SQL side.

import { walk, type PlotNode } from '../ast';

export function annotateVariables(root: PlotNode): void {
    walk(root, n => {
        if (n.kind !== 'varRef' || !n.dollar) return;
        n.annotations.resolves = { kind: 'variable', parsed: n.dollar };
    });
}
