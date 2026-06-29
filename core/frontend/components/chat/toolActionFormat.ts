// Pure helpers for rendering a one-line summary of a completed tool call
// in the chat. Kept side-effect-free so they're trivial to unit-test in node.

export interface FormattedAction {
    /** Imperative verb prefix shown first: "Add", "Edit", "Plot", "Delete", "Move", "Run", "Set", "Read". */
    verb: string;
    /** Short summary phrase shown after the verb, e.g. `sql "SELECT ..."`. */
    summary: string;
    /** Cell id this action targets, if knowable from args. Used for click-to-scroll. */
    cellId: string | null;
}

const DEFAULT_MAX = 60;

/** Collapse whitespace and truncate to `max` chars with an ellipsis. */
export function shortContent(s: string | null | undefined, max = DEFAULT_MAX): string {
    if (!s) return '';
    const collapsed = String(s).replace(/\s+/g, ' ').trim();
    if (collapsed.length <= max) return collapsed;
    return collapsed.slice(0, max - 1) + '…';
}

/** Map an executed tool call to a one-line action descriptor. */
export function formatActionLine(toolName: string, args: any): FormattedAction {
    const a = args ?? {};
    switch (toolName) {
        case 'addCell': {
            const type = String(a.type ?? 'cell');
            return { verb: 'Add', summary: `${type} "${shortContent(a.content)}"`, cellId: null };
        }
        case 'editCell':
            return { verb: 'Edit', summary: `cell "${shortContent(a.content)}"`, cellId: a.cellId ?? null };
        case 'applyPlot':
            return { verb: 'Plot', summary: `"${shortContent(a.plotConfig)}"`, cellId: a.cellId ?? null };
        case 'deleteCell':
            return { verb: 'Delete', summary: 'cell', cellId: a.cellId ?? null };
        case 'moveCell':
            return { verb: 'Move', summary: `${a.position ?? ''} ${a.targetCellId ?? ''}`.trim(), cellId: a.cellId ?? null };
        case 'runQuery':
            return { verb: 'Run', summary: `"${shortContent(a.sql)}"`, cellId: null };
        case 'previewPlot':
            return { verb: 'Preview', summary: `plot "${shortContent(a.plotConfig)}"`, cellId: null };
        case 'screenshotPlot':
            return { verb: 'Screenshot', summary: `preview ${a.previewId ?? ''}`.trim(), cellId: null };
        case 'describeTable':
            return { verb: 'Describe', summary: `"${shortContent(a.name)}"`, cellId: null };
        case 'sampleRows':
            return { verb: 'Sample', summary: `"${shortContent(a.name)}"`, cellId: null };
        case 'readCell':
            return { verb: 'Read', summary: 'cell', cellId: a.cellId ?? null };
        case 'listCells':
            return { verb: 'List', summary: 'cells', cellId: null };
        case 'listPlots':
            return { verb: 'List', summary: 'plots', cellId: null };
        case 'listVariables':
            return { verb: 'List', summary: 'variables', cellId: null };
        case 'setVariable':
            return { verb: 'Set', summary: `$${a.name ?? ''} = "${shortContent(a.value)}"`, cellId: null };
        case 'deleteVariable':
            return { verb: 'Delete', summary: `$${a.name ?? ''}`, cellId: null };
        default:
            return { verb: toolName || 'call', summary: '', cellId: null };
    }
}
