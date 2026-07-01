import type { NotebookCellData } from '../types';
import { tokenizeCellContent, parseCellContent } from './notebookParser';

// Module-level WeakMap cache: same cell object → same parsed variables.
// When a cell is edited its object reference changes, so the cache entry is
// naturally invalidated. GC cleans up entries for cells that have been deleted.
const cellVarsCache = new WeakMap<object, Record<string, string>>();

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
        let vars = cellVarsCache.get(c);
        if (!vars) {
            const parsed = parseCellContent(tokenizeCellContent(c.content));
            vars = parsed.variables as Record<string, string>;
            cellVarsCache.set(c, vars);
        }
        for (const [k, v] of Object.entries(vars)) {
            const varName = k.startsWith('$') ? k.slice(1) : k;
            out[`$${cTitle}.${varName}`] = v;
        }
    }
    // If currentCellId was not found in the cells array, return empty rather
    // than leaking all cells' variables (B-099/B-165).
    if (!found) return {};
    return out;
}
