// For each `plotCall`, looks up the shape in the registry and attaches
// `annotations.resolves` with the shape metadata. Also resolves `clauseRef`
// nodes (the bare key of a clause, e.g. `x` in `x: ts`) to a `clauseDef`
// symbol, and enriches `hole` nodes whose hint carries a `shape` field with
// the registry's required/available/column clause lists.

import { walk, type PlotNode } from '../ast';
import type { PlotHoleHint } from '../holeKinds';
import { DEFAULT_COLUMN_CLAUSES } from './columnAnnotator';

export interface ClauseDef {
    /** Clause key (lowercase, e.g. `x`, `color`). */
    key: string;
    /** Parameter type — `column`, `string`, `number`, `dimension`, `list<column>`. */
    paramType: string;
    /** Required clauses fail with a diagnostic when absent. */
    required?: boolean;
    /** Closed enum of literal options (e.g. `['linear','log']` for `scale`). */
    options?: string[];
    /** Optional documentation string. */
    description?: string;
}

export interface ShapeRegistryEntry {
    /** Canonical lowercase shape (`line`, `bar`, ...). */
    name: string;
    /** All clause names this shape accepts. */
    validClauses?: string[];
    /** Clauses that take column refs. */
    columnClauses?: string[];
    /** Clauses that must be present for the shape to render. */
    requiredClauses?: string[];
    /** Optional rich per-clause definitions. */
    clauseDefs?: ClauseDef[];
    /** Optional shape description. */
    description?: string;
}

export interface ShapeRegistry {
    /** Lowercase shape name → entry. */
    [shape: string]: ShapeRegistryEntry;
}

export function annotateShapes(root: PlotNode, registry: ShapeRegistry = {}): void {
    walk(root, n => {
        if (n.kind === 'plotCall' && n.shape) {
            const entry = registry[n.shape];
            if (!entry) return;
            n.annotations.resolves = {
                kind: 'plotShape',
                name: entry.name,
                validClauses: entry.validClauses ?? [],
                columnClauses: entry.columnClauses ?? DEFAULT_COLUMN_CLAUSES,
                requiredClauses: entry.requiredClauses ?? [],
                description: entry.description,
            };

            // Enrich any clauseKey/clauseValue holes attached to this plot.
            enrichHolesForShape(n, entry);

            // Resolve `clauseRef` children to `clauseDef`.
            for (const child of n.children) {
                if (child.kind !== 'clause') continue;
                const key = child.key?.toLowerCase();
                if (!key) continue;
                const def = findClauseDef(entry, key);
                const cref = child.children.find(c => c.kind === 'clauseRef');
                if (cref) {
                    cref.annotations.resolves = {
                        kind: 'clauseDef',
                        clauseKey: key,
                        shape: entry.name,
                        paramType: def?.paramType ?? inferParamType(entry, key),
                        required: def?.required ?? (entry.requiredClauses?.includes(key) ?? false),
                        options: def?.options,
                        description: def?.description,
                    };
                }
            }
        }
    });
}

function findClauseDef(entry: ShapeRegistryEntry, key: string): ClauseDef | undefined {
    return entry.clauseDefs?.find(d => d.key.toLowerCase() === key);
}

function inferParamType(entry: ShapeRegistryEntry, key: string): string {
    const columnClauses = entry.columnClauses ?? DEFAULT_COLUMN_CLAUSES;
    return columnClauses.map(s => s.toLowerCase()).includes(key) ? 'column' : 'value';
}

/**
 * Walk the plotCall's children looking for hole nodes whose hint references
 * the shape, and fill in `availableKeys`/`requiredMissing`/`columnKeys`/
 * `paramType` using the registry entry.
 */
function enrichHolesForShape(call: PlotNode, entry: ShapeRegistryEntry): void {
    const usedKeys = call.children
        .filter(c => c.kind === 'clause' && c.key)
        .map(c => c.key!.toLowerCase());
    const validClauses = (entry.validClauses ?? []).map(s => s.toLowerCase());
    const columnClauses = (entry.columnClauses ?? DEFAULT_COLUMN_CLAUSES).map(s => s.toLowerCase());
    const requiredClauses = (entry.requiredClauses ?? []).map(s => s.toLowerCase());
    const availableKeys = validClauses.filter(k => !usedKeys.includes(k));
    const requiredMissing = requiredClauses.filter(k => !usedKeys.includes(k));

    walk(call, n => {
        if (n.kind !== 'hole') return;
        const hint = n.annotations.hint;
        if (!hint) return;
        if (hint.kind === 'clauseKey' && hint.shape === entry.name) {
            // Merge registry knowledge into the hint.
            n.annotations.hint = {
                ...hint,
                usedKeys,
                availableKeys,
                columnKeys: columnClauses,
                requiredMissing,
            } satisfies PlotHoleHint;
        } else if (hint.kind === 'clauseValue' && hint.shape === entry.name) {
            const def = findClauseDef(entry, hint.clauseKey);
            const paramType = def?.paramType ?? inferParamType(entry, hint.clauseKey);
            n.annotations.hint = {
                ...hint,
                paramType,
                columnTyped: columnClauses.includes(hint.clauseKey),
                options: def?.options ?? hint.options,
            } satisfies PlotHoleHint;
        }
    });
}
