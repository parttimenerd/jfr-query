// Resolves bare-ident values inside clause positions that the plot shape
// registry declares as "column-typed" (e.g. `x`, `y`, `color`, `size` in
// `line` / `scatter`). Attaches `resolves: { kind: 'column', name, dataType }`
// against the cell's result schema.

import { walk, type PlotNode } from '../ast';
import type { PlotScope } from '../scope';

const DEFAULT_COLUMN_CLAUSES = ['x', 'y', 'y2', 'color', 'size', 'group', 'frame', 'value', 'name', 'start', 'end', 'min', 'max', 'columns'];

export interface PlotShapeInfo {
    /** Lowercased shape name. */
    name: string;
    /** Clauses that take column refs (case-insensitive). */
    columnClauses?: string[];
}

export interface ColumnResolverConfig {
    /** Lowercase shape → registered shape info. */
    shapes?: Record<string, PlotShapeInfo>;
}

export function annotateColumns(root: PlotNode, scope: PlotScope, config: ColumnResolverConfig = {}): void {
    walk(root, n => {
        if (n.kind !== 'ident' || !n.name) return;
        // Find enclosing clause to know which slot we're in.
        const clause = findEnclosingClause(n);
        if (!clause || !clause.key) return;
        const plotCall = findEnclosingPlotCall(n);
        const shape = plotCall?.shape;
        const columnClauses = (shape && config.shapes?.[shape]?.columnClauses) ?? DEFAULT_COLUMN_CLAUSES;
        if (!columnClauses.map(s => s.toLowerCase()).includes(clause.key.toLowerCase())) return;
        // Resolve column against the scope.
        const col = scope.lookupColumn(n.name);
        if (col) {
            n.annotations.resolves = { kind: 'column', name: col.name, dataType: col.dataType };
        }
    });
}

function findEnclosingClause(node: PlotNode): PlotNode | undefined {
    let n: PlotNode | undefined = node.parent;
    while (n) {
        if (n.kind === 'clause') return n;
        if (n.kind === 'plotCall' || n.kind === 'composite' || n.kind === 'script') return undefined;
        n = n.parent;
    }
    return undefined;
}

function findEnclosingPlotCall(node: PlotNode): PlotNode | undefined {
    let n: PlotNode | undefined = node.parent;
    while (n) {
        if (n.kind === 'plotCall') return n;
        n = n.parent;
    }
    return undefined;
}

export { DEFAULT_COLUMN_CLAUSES };
