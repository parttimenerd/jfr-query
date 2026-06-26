// P3 — `$plotName.brush[.lo|.hi|.field]` resolution.
//
// Single-node annotator invoked from `crossPlotAnnotator`. Given a `varRef`
// whose parsed dollar is a `crossCellRef` with `path[0] === 'brush'`, look up
// the named source plot in the notebook scope and project its inferred x-axis
// type onto the resolution. The trailing `.lo` / `.hi` / `.field` is purely
// structural — both endpoints share the source plot's axis dataType.

import type { PlotNode } from '../ast';
import type { NotebookPlotContext } from '../notebookPlotScope';

export function annotateBrush(node: PlotNode, ctx: NotebookPlotContext): void {
    if (node.kind !== 'varRef' || !node.dollar) return;
    const d = node.dollar;
    if (d.kind !== 'crossCellRef') return;
    if (d.path.length === 0 || d.path[0] !== 'brush') return;

    const brush = ctx.scope.brushes.get(d.name);
    if (!brush) return;

    // For `.lo` / `.hi` the dataType matches the axis. `.field` is a string
    // accessor — fall back to 'string'.
    const tail = d.path[1];
    let dataType: 'number' | 'string' | 'timestamp' | 'unknown' = brush.xType;
    if (tail === 'field') dataType = 'string';

    node.annotations.resolves = {
        kind: 'variable',
        parsed: d,
        source: 'brush',
        dataType,
    };
}
