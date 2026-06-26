import type { NotebookCellData } from '../types';
import { tokenizeCellContent, parseCellContent } from './notebookParser';

// Flattens variables exported by every cell ordered BEFORE `currentCellId`
// into a single `{ "$cellTitle.varName": value }` map. Used to thread
// preceding-cell exports into the SQL editor's autocomplete, so typing
// `$otherCell.foo` offers the right candidates.
//
// Cells without a title are skipped: cross-cell refs need a name to address.
// Cells whose id equals `currentCellId` stop the walk; the current cell's
// own variables are merged separately by the caller.
export function collectPrecedingCellVariables(
    cells: ReadonlyArray<NotebookCellData>,
    currentCellId: string,
): Record<string, string> {
    const out: Record<string, string> = {};
    let found = false;
    for (const c of cells) {
        if (c.id === currentCellId) { found = true; break; }
        const cTitle = c.title;
        if (!cTitle) continue;
        const parsed = parseCellContent(tokenizeCellContent(c.content));
        for (const [k, v] of Object.entries(parsed.variables)) {
            const varName = k.startsWith('$') ? k.slice(1) : k;
            out[`$${cTitle}.${varName}`] = v;
        }
    }
    // If currentCellId was not found in the cells array, return empty rather
    // than leaking all cells' variables (B-099/B-165).
    if (!found) return {};
    return out;
}
