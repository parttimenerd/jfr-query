// schemaAnnotator: resolves identifier / qualifiedIdent nodes against the
// scope chain built by aliasAnnotator and attaches `annotations.resolves`.
//
// Skips identifiers that already have a resolution (set by other annotators
// or by the parser). Also skips identifiers that appear inside positions
// where they're clearly definitions, not references:
//   - alias position in a projection (last identifier sibling)
//   - alias position in a tableRef (last identifier sibling)
//   - CTE name (identifier child of `cte` node)
//   - column-list children of CTE / tableRef
//
// For unqualified `identifier` nodes:
//   1. Try `scope.resolveIdent(text)` → resolves to a column-in-scope.
//   2. Fall back to `Scope.resolveTableRef(...)` against schema/CTEs (for
//      identifiers that name a table directly — common in FROM-less contexts
//      and in the FROM tableRef itself).
//   3. If neither matches, leave unresolved.
//
// For `qualifiedIdent` (e.g. `t.col` or `s.t.col`):
//   - Two-segment: treat as `qualifier.column` and call `resolveQualified`.
//   - Three-segment: treat last two as `qualifier.column`, ignore schema
//     prefix for now.

import { type Node, walk } from '../ast';
import { Scope } from '../scope';
import type { TableSchema, ViewSchema } from '../../../../types';

const scopeRegistry = new WeakMap<Node, Scope>();

export interface SchemaAnnotatorInput {
    tables: ReadonlyArray<TableSchema>;
    views: ReadonlyArray<ViewSchema>;
    // The map populated by `attachScope` below. Lets us go from a `query`
    // node's annotations.scope (which carries only an id) back to the real
    // Scope instance. Callers should pass the same map they passed to
    // `annotateAliases` … but we don't require that — aliasAnnotator stores
    // the Scope on a side channel that we accept here.
    scopeById: ReadonlyMap<number, Scope>;
}

// Helper: callers call this to register a Scope so the annotator can find
// it from a node's `annotations.scope.id`. The aliasAnnotator could be
// adapted to do this, but keeping it separate avoids cross-cutting state.
export function registerScope(node: Node, scope: Scope): void {
    scopeRegistry.set(node, scope);
}

export function annotateSchema(root: Node, input: SchemaAnnotatorInput): void {
    walk(root, (n) => {
        if (n.annotations.resolves) return;

        // Definitions, not references — skip.
        if (isDefinitionSite(n)) return;

        if (n.kind === 'identifier') {
            resolveIdentNode(n, input);
        } else if (n.kind === 'qualifiedIdent') {
            resolveQualifiedNode(n, input);
        }
    });
}

function nearestQueryScope(n: Node, input: SchemaAnnotatorInput): Scope | undefined {
    let cur: Node | undefined = n;
    while (cur) {
        if (cur.kind === 'query' && cur.annotations.scope) {
            return input.scopeById.get(cur.annotations.scope.id);
        }
        cur = cur.parent;
    }
    return undefined;
}

function resolveIdentNode(n: Node, input: SchemaAnnotatorInput): void {
    const scope = nearestQueryScope(n, input);
    if (scope) {
        const col = scope.resolveIdent(n.text);
        if (col) {
            n.annotations.resolves = {
                kind: 'column',
                table: col.table,
                column: col.column,
                dataType: col.dataType,
            };
            return;
        }
        // Alias reference: hovering the qualifier in `r.col` lands on the
        // bare `r` identifier inside the parent qualifiedIdent. If the text
        // matches a table-binding alias in scope AND that alias differs from
        // the underlying target name, surface it as an alias.
        const aliasMatch = scope.listTables().find(
            t => t.alias.toLowerCase() === n.text.toLowerCase(),
        );
        if (aliasMatch && aliasMatch.alias.toLowerCase() !== aliasMatch.target.toLowerCase()) {
            n.annotations.resolves = {
                kind: 'alias',
                alias: aliasMatch.alias,
                target: aliasMatch.target,
            };
            return;
        }
        // Try as a table reference (e.g. inside FROM).
        const tab = Scope.resolveTableRef(n.text, scope.listCtes(), input.tables, input.views);
        if (tab) {
            if (tab.kind === 'cte') {
                n.annotations.resolves = { kind: 'cte', name: tab.name };
            } else if (tab.kind === 'view') {
                n.annotations.resolves = { kind: 'view', name: tab.name };
            } else {
                n.annotations.resolves = {
                    kind: 'table',
                    name: tab.name,
                    rowCount: lookupRowCount(tab.name, input.tables),
                };
            }
            return;
        }
    }
    // No scope (or no match in scope) — try schema-only lookup.
    // Pass CTEs from the active scope when available so CTE names in unusual
    // positions (not captured by earlier scope-based checks) still resolve.
    const ctes = scope ? scope.listCtes() : [];
    const tab = Scope.resolveTableRef(n.text, ctes, input.tables, input.views);
    if (tab) {
        if (tab.kind === 'cte') {
            n.annotations.resolves = { kind: 'cte', name: tab.name };
        } else if (tab.kind === 'view') {
            n.annotations.resolves = { kind: 'view', name: tab.name };
        } else {
            n.annotations.resolves = {
                kind: 'table',
                name: tab.name,
                rowCount: lookupRowCount(tab.name, input.tables),
            };
        }
    }
}

function lookupRowCount(name: string, tables: ReadonlyArray<TableSchema>): number | undefined {
    const lower = name.toLowerCase();
    for (const t of tables) {
        if (t.name.toLowerCase() === lower) return t.rowCount;
    }
    return undefined;
}

function resolveQualifiedNode(n: Node, input: SchemaAnnotatorInput): void {
    const scope = nearestQueryScope(n, input);
    if (!scope) return;
    const parts = n.children.filter(c => c.kind === 'identifier').map(c => c.text);
    if (parts.length < 2) return;
    // Always treat the last two as `qualifier.column`.
    const qualifier = parts[parts.length - 2];
    const column = parts[parts.length - 1];
    const col = scope.resolveQualified(qualifier, column);
    if (col) {
        n.annotations.resolves = {
            kind: 'column',
            table: col.table,
            column: col.column,
            dataType: col.dataType,
        };
    }
}

function isDefinitionSite(n: Node): boolean {
    const p = n.parent;
    if (!p) return false;

    // CTE name (first identifier child of a `cte` node).
    if (p.kind === 'cte') {
        const idents = p.children.filter(c => c.kind === 'identifier');
        if (idents[0] === n) return true;
    }

    // Alias slots in projection/tableRef: when the source is itself an
    // identifier (e.g. `col AS alias`), we need 2+ identifiers; when the
    // source is a non-identifier expression (e.g. `count(*) AS n`, `a+b AS r`,
    // `schema.table AS t`), the alias is the only identifier child.
    if (p.kind === 'projection' || p.kind === 'tableRef') {
        const idents = p.children.filter(c => c.kind === 'identifier');
        const first = p.children[0];
        const threshold = first?.kind === 'identifier' ? 2 : 1;
        if (idents.length >= threshold && idents[idents.length - 1] === n) return true;
    }

    // Column-list children of cte / orderItem / etc.
    if (p.kind === 'list' && p.parent && (p.parent.kind === 'cte' || p.parent.kind === 'tableRef')) {
        return true;
    }

    return false;
}
