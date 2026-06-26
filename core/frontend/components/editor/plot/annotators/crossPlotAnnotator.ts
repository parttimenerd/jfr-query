// P3 — Cross-plot reference resolution.
//
// Once `parseAndAnnotate` has populated the AST with column/shape resolutions,
// this annotator walks the tree one more time and resolves:
//
//   • `queryRef` (`#2`, `#"viewname"`) nodes — by looking up the index/alias
//     in the notebook-wide scope view.
//   • Bare `ident` nodes appearing inside `LINK_X` / `LINK_Y` / `LINK_XY` /
//     `LINK_SCROLL` / `ON` tails — these may name another plot in the notebook.
//   • `varRef` nodes whose path starts with `brush` — delegated to the brush
//     annotator so `$gc_plot.brush.lo` picks up the source plot's `xType`.
//
// A `NotebookPlotContext` is required; without it, the annotator is a no-op
// (e.g. when the editor is used outside the notebook host).

import { walk, type PlotNode } from '../ast';
import type { PlotDiagnostic } from '../holeKinds';
import type { NotebookPlotContext } from '../notebookPlotScope';
import { annotateBrush } from './brushAnnotator';

const LINK_TAIL_KEYS = new Set(['link-x', 'link-y', 'link-xy', 'link-scroll', 'on']);
// Positional keywords inside LINK_X/LINK_Y/LINK_XY: not plot names — must not
// be flagged as unknown plots.
const LINK_POSITIONAL_KEYWORDS = new Set(['master', 'slave', 'clamp', 'noclamp', 'free']);

export function annotateCrossPlot(root: PlotNode, ctx?: NotebookPlotContext): void {
    if (!ctx) return;
    walk(root, n => {
        // ----- queryRef ----------------------------------------------------
        if (n.kind === 'queryRef') {
            const qr = lookupQueryRef(n, ctx);
            if (qr) {
                n.annotations.resolves = {
                    kind: 'queryRef',
                    targetCellId: qr.cellId,
                    targetSql: qr.sql,
                    targetColumns: qr.columns ? [...qr.columns] : undefined,
                };
            } else {
                pushDiagnostic(n, {
                    severity: 'warning',
                    code: 'unknown-query-ref',
                    message: n.queryName
                        ? `Unknown view "${n.queryName}"`
                        : `Query ref ${n.text} does not match any SQL block above this cell`,
                });
            }
            return;
        }

        // ----- bare ident inside LINK_* / ON ------------------------------
        if (n.kind === 'ident' && n.name) {
            // Skip idents that have already resolved as columns / constants.
            if (n.annotations.resolves) return;
            const tail = findEnclosingTail(n);
            if (!tail || !tail.key) return;
            if (!LINK_TAIL_KEYS.has(tail.key.toLowerCase())) return;
            const lowered = n.name.toLowerCase();
            if (LINK_POSITIONAL_KEYWORDS.has(lowered)) return; // positional keyword, not a plot
            const plot = ctx.scope.namedPlots.find(p => p.plotName?.toLowerCase() === n.name?.toLowerCase());
            if (plot) {
                n.annotations.resolves = {
                    kind: 'crossPlot',
                    plotName: plot.plotName,
                    cellId: plot.cellId,
                    plotIndex: plot.plotIndexInCell,
                    declaredColumns: plot.declaredColumns?.map(c => c.name),
                };
            } else {
                pushDiagnostic(n, {
                    severity: 'warning',
                    code: 'unknown-plot',
                    message: `Unknown plot "${n.name}" — no plot above this cell has \`name: ${n.name}\``,
                });
            }
            return;
        }

        // ----- varRef with $cell.brush.* ----------------------------------
        if (n.kind === 'varRef' && n.dollar) {
            annotateBrush(n, ctx);
            // After brush handling, enrich with workspace/cellLocal scope info
            // when no brush match took over.
            const resolved = n.annotations.resolves;
            if (!resolved || resolved.kind !== 'variable' || resolved.source) return;
            const v = ctx.scope.variables.get(n.dollar.name);
            if (v) {
                n.annotations.resolves = {
                    kind: 'variable',
                    parsed: n.dollar,
                    value: v.value,
                    source: v.scope,
                    dataType: v.dataType,
                };
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lookupQueryRef(node: PlotNode, ctx: NotebookPlotContext):
    | { cellId: string; sql: string; columns?: ReadonlyArray<{ name: string; dataType?: string }> }
    | undefined
{
    if (typeof node.queryIndex === 'number') {
        const hit = ctx.scope.queryRefs.find(q => q.index === node.queryIndex);
        if (hit) return { cellId: hit.cellId, sql: hit.sql, columns: hit.columns };
    }
    if (node.queryName) {
        const target = node.queryName.toLowerCase();
        const hit = ctx.scope.queryRefs.find(q => (q.alias ?? '').toLowerCase() === target);
        if (hit) return { cellId: hit.cellId, sql: hit.sql, columns: hit.columns };
    }
    return undefined;
}

function findEnclosingTail(node: PlotNode): PlotNode | undefined {
    let n: PlotNode | undefined = node.parent;
    while (n) {
        if (n.kind === 'tail') return n;
        if (n.kind === 'plotCall' || n.kind === 'composite' || n.kind === 'script') return undefined;
        n = n.parent;
    }
    return undefined;
}

function pushDiagnostic(node: PlotNode, diag: PlotDiagnostic): void {
    const list = node.annotations.structuredDiagnostics ?? [];
    list.push(diag);
    node.annotations.structuredDiagnostics = list;
}
