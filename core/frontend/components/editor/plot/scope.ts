// Scope for the plot DSL — tracks declared constants and the cell's result
// schema. Cross-cell variable resolution is handled by the SQL-side variable
// annotator pattern, which we reuse via `parseDollar`.

import type { ColumnSchema, PlotNode, ResolvedPlotSymbol } from './ast';
import type { PlotScopeView } from './notebookPlotScope';

export interface PlotScopeArgs {
    /** Columns of the cell's most recent SQL result. */
    resultColumns?: ColumnSchema[];
    /** Cross-cell exports map (cell-name → variables). Optional. */
    crossCellExports?: Record<string, Record<string, unknown>>;
    /**
     * P3 — notebook-wide view of named plots / query refs / variables /
     * brushes. Constructed by `NotebookPlotScope.build` upstream. Optional so
     * standalone editor invocations (e.g. unit tests) still work.
     */
    crossPlotView?: PlotScopeView;
}

export class PlotScope {
    /** Declared LET constants, indexed by lowercase name. */
    readonly constants = new Map<string, { name: string; valueText: string; node: PlotNode }>();
    /** Cell columns, indexed by name. */
    readonly resultColumns: ColumnSchema[];
    /** Map of column name → schema, case-insensitive lookup. */
    readonly columnsByName = new Map<string, ColumnSchema>();
    /** Cross-cell exports map. */
    readonly crossCellExports: Record<string, Record<string, unknown>>;
    /** Notebook-wide plot scope view (P3). */
    readonly crossPlotView?: PlotScopeView;

    constructor(args: PlotScopeArgs = {}) {
        this.resultColumns = args.resultColumns ?? [];
        for (const c of this.resultColumns) {
            this.columnsByName.set(c.name.toLowerCase(), c);
        }
        this.crossCellExports = args.crossCellExports ?? {};
        this.crossPlotView = args.crossPlotView;
    }

    addConstant(name: string, valueText: string, node: PlotNode): void {
        // Last write wins — but we surface a diagnostic on redefinition.
        this.constants.set(name, { name, valueText, node });
    }

    lookupConstant(name: string): { name: string; valueText: string; node: PlotNode } | undefined {
        return this.constants.get(name);
    }

    lookupColumn(name: string): ColumnSchema | undefined {
        return this.columnsByName.get(name.toLowerCase());
    }
}

export type { ResolvedPlotSymbol };
