// Public entry point for the plot DSL parser. Composes parse + annotators.

import type { PlotNode, ColumnSchema } from './ast';
import { parse } from './parser';
import { PlotScope } from './scope';
import { annotateConstants } from './annotators/constAnnotator';
import { annotateVariables } from './annotators/variableAnnotator';
import { annotateColumns, type ColumnResolverConfig } from './annotators/columnAnnotator';
import { annotateShapes, type ShapeRegistry } from './annotators/shapeAnnotator';
import { annotateCrossPlot } from './annotators/crossPlotAnnotator';
import { derive, type ParsedPlotCall } from './derive';
import type { NotebookPlotContext } from './notebookPlotScope';

export interface ParseAndAnnotateArgs {
    src: string;
    cursorPos?: number;
    resultColumns?: ColumnSchema[];
    shapeRegistry?: ShapeRegistry;
    /**
     * P3 — notebook-wide plot context (named plots, query refs, brush types).
     * When provided, the cross-plot and brush annotators run after column
     * resolution and enrich `queryRef`, `crossPlot`, and `$plot.brush.*` nodes.
     */
    notebookContext?: NotebookPlotContext;
}

export interface ParseAndAnnotateResult {
    root: PlotNode;
    scope: PlotScope;
}

/** Parse + run all annotators. */
export function parseAndAnnotate(args: ParseAndAnnotateArgs): ParseAndAnnotateResult {
    const root = parse(args.src, { cursorPos: args.cursorPos });
    const scope = new PlotScope({
        resultColumns: args.resultColumns,
        crossPlotView: args.notebookContext?.scope,
    });
    annotateConstants(root, scope);
    annotateVariables(root);
    const colCfg: ColumnResolverConfig = { shapes: args.shapeRegistry };
    annotateColumns(root, scope, colCfg);
    annotateShapes(root, args.shapeRegistry);
    // P3 — cross-plot / brush / queryRef resolution runs last so it sees
    // already-resolved columns and shape clauses.
    annotateCrossPlot(root, args.notebookContext);
    return { root, scope };
}

export { parse } from './parser';
export { derive } from './derive';
export { PlotScope } from './scope';
export type { PlotNode, ColumnSchema, ResolvedPlotSymbol } from './ast';
export type { ParsedPlotCall } from './derive';
export type { PlotHoleHint, PlotDiagnostic } from './holeKinds';
export type { NotebookPlotContext, PlotScopeView } from './notebookPlotScope';
export { NotebookPlotScope } from './notebookPlotScope';
