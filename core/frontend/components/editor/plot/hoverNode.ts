// Finds the deepest plot AST node whose span contains a given position. Used
// by the plot-hover adapter to translate `(source, pos)` into an annotated
// node from which a typed `PlotHoverContent` descriptor can be derived.
//
// `findHoveredPlotNode` returns `null` if no node strictly contains `pos`
// (this is what suppresses tooltips when the cursor lands on whitespace
// between tokens).

import { walk, type PlotNode } from './ast';

export function findHoveredPlotNode(root: PlotNode, pos: number): PlotNode | null {
    let best: PlotNode | null = null;
    walk(root, n => {
        // Skip the synthetic script root — we want a token-y node.
        if (n.kind === 'script') return;
        if (n.from <= pos && pos < n.to) {
            if (!best) { best = n; return; }
            // Prefer the tightest containing node.
            const bestLen = best.to - best.from;
            const len = n.to - n.from;
            if (len <= bestLen) best = n;
        }
    });
    return best;
}
