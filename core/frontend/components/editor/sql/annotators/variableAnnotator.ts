// variableAnnotator: resolves `$var`, `$$var`, and `$cell.var[.path]` refs
// against the workspace + cell variable maps and attaches
// `annotations.resolves` of kind 'variable'.
//
// Source classification:
//   - variableRef    → checks cellVariables first, falls back to workspace.
//   - doubleDollarRef → workspace variables only.
//   - crossCellRef   → looks up the cell name in `cellExports`, then the
//                       dotted path. `.brush` is recognized as a gesture
//                       export (substitution layer expands it at runtime).

import { type Node, walk, parseDollar } from '../ast';

export interface VariableAnnotatorInput {
    // The current cell's own variable map (single-`$` resolves here).
    cellVariables: ReadonlyMap<string, string>;
    // Notebook-scoped (double-`$`) variables.
    workspaceVariables: ReadonlyMap<string, string>;
    // Map from cell name → { variableName → value }.
    cellExports: ReadonlyMap<string, ReadonlyMap<string, string>>;
    // Optional: cells that have a live brush selection. Used to mark
    // `$plot.brush` as resolved when the plot has produced one.
    cellsWithBrush?: ReadonlySet<string>;
}

export function annotateVariables(root: Node, input: VariableAnnotatorInput): void {
    walk(root, (n) => {
        if (n.annotations.resolves) return;
        if (n.kind !== 'variableRef' && n.kind !== 'doubleDollarRef' && n.kind !== 'crossCellRef') return;
        const parsed = parseDollar(n.text);
        if (parsed.kind === 'variableRef') {
            const local = input.cellVariables.get(parsed.name);
            if (local !== undefined) {
                n.annotations.resolves = {
                    kind: 'variable', name: parsed.name, value: local, source: 'cell',
                };
                return;
            }
            const ws = input.workspaceVariables.get(parsed.name);
            if (ws !== undefined) {
                n.annotations.resolves = {
                    kind: 'variable', name: parsed.name, value: ws, source: 'workspace',
                };
            }
            return;
        }
        if (parsed.kind === 'doubleDollarRef') {
            const ws = input.workspaceVariables.get(parsed.name);
            if (ws !== undefined) {
                n.annotations.resolves = {
                    kind: 'variable', name: parsed.name, value: ws, source: 'workspace',
                };
            }
            return;
        }
        // crossCellRef: `$cell.var[.tail...]`
        const cellName = parsed.name;
        const path = parsed.path;
        const first = path[0];
        if (!first) return;
        if (first === 'brush') {
            const hasBrush = input.cellsWithBrush?.has(cellName) ?? false;
            n.annotations.resolves = {
                kind: 'variable',
                name: `${cellName}.brush${path.length > 1 ? '.' + path.slice(1).join('.') : ''}`,
                value: hasBrush ? '(live brush)' : '',
                source: 'gesture',
            };
            return;
        }
        const exports = input.cellExports.get(cellName);
        if (!exports) return;
        const value = exports.get(first);
        if (value === undefined) return;
        // Tail beyond the variable name (e.g. `.0` tuple slot) — we don't
        // dereference here; the substitution layer handles it. Just record
        // the full path in `name` so hover can show it.
        const fullName = path.length > 1
            ? `${cellName}.${first}.${path.slice(1).join('.')}`
            : `${cellName}.${first}`;
        n.annotations.resolves = {
            kind: 'variable',
            name: fullName,
            value,
            source: 'cell',
        };
    });
}
