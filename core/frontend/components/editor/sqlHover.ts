// Pure SQL hover-content adapter. Builds a structured result describing what
// the user is hovering over, given a source string, a cursor offset, and a
// schema + variables snapshot.
//
// Distinct from `components/editor/hover.ts` — that module is the plot DSL
// hover adapter. The two modules share a sibling shape (a discriminated
// union keyed on `kind`) but operate over different parsers / ASTs.
//
// The adapter is cached on (source, schema, variables) identity so callers
// invoking it many times per keystroke pay parsing cost once. `_resetHoverCacheForTests`
// clears the cache deterministically.

import { parse } from './sql/parser';
import { annotate } from './sql/annotate';
import { findHoveredNode, nearestResolved } from './sql/hoverNode';
import type { Node, ResolvedSymbol } from './sql/ast';
import type { SchemaForCompletion } from './completions';

export type SqlHoverContent =
    | { kind: 'column'; name: string; table: string; dataType: string; from: number; to: number }
    | { kind: 'table'; name: string; rowCount?: number; from: number; to: number }
    | { kind: 'view'; name: string; from: number; to: number }
    | { kind: 'cte'; name: string; from: number; to: number }
    | { kind: 'function'; name: string; signature: string; from: number; to: number }
    | {
          kind: 'variable';
          name: string;
          value: string | undefined;
          source: 'cell' | 'workspace' | 'gesture' | undefined;
          from: number;
          to: number;
      }
    | { kind: 'alias'; alias: string; target: string; from: number; to: number }
    | { kind: 'unresolved'; text: string; from: number; to: number };

export interface SqlHoverDeps {
    schema: SchemaForCompletion | null;
    variables: Record<string, string>;
}

interface SqlHoverCacheEntry {
    src: string;
    schema: SchemaForCompletion | null;
    variables: Record<string, string>;
    root: Node;
}
let sqlHoverCache: SqlHoverCacheEntry | null = null;

function getAnnotatedSqlRoot(source: string, deps: SqlHoverDeps): Node {
    if (
        sqlHoverCache &&
        sqlHoverCache.src === source &&
        sqlHoverCache.schema === deps.schema &&
        sqlHoverCache.variables === deps.variables
    ) {
        return sqlHoverCache.root;
    }
    const { root } = parse(source);
    // Split the flat `{ $foo: 'v', $$bar: 'w' }` map into the structured
    // input the annotator expects. Keys are kept with their leading `$` so the
    // annotator's bare-name lookup (which uses the stripped form) matches.
    const cellVariables = new Map<string, string>();
    const workspaceVariables = new Map<string, string>();
    for (const [k, v] of Object.entries(deps.variables)) {
        if (k.startsWith('$$')) {
            workspaceVariables.set(k.slice(2), v);
        } else if (k.startsWith('$')) {
            cellVariables.set(k.slice(1), v);
        }
    }
    annotate(root, {
        tables: deps.schema?.tables ?? [],
        views: deps.schema?.views ?? [],
        variables: {
            cellVariables,
            workspaceVariables,
            cellExports: new Map(),
        },
    });
    sqlHoverCache = { src: source, schema: deps.schema, variables: deps.variables, root };
    return root;
}

export function _resetHoverCacheForTests(): void {
    sqlHoverCache = null;
}

// Map a ResolvedSymbol from the SQL annotator into the user-facing hover content.
function fromResolved(resolved: ResolvedSymbol, node: Node): SqlHoverContent | null {
    switch (resolved.kind) {
        case 'column':
            return {
                kind: 'column',
                name: resolved.column,
                table: resolved.table,
                dataType: resolved.dataType,
                from: node.from,
                to: node.to,
            };
        case 'table':
            return {
                kind: 'table',
                name: resolved.name,
                rowCount: resolved.rowCount,
                from: node.from,
                to: node.to,
            };
        case 'view':
            return { kind: 'view', name: resolved.name, from: node.from, to: node.to };
        case 'cte':
            return { kind: 'cte', name: resolved.name, from: node.from, to: node.to };
        case 'function':
            return {
                kind: 'function',
                name: resolved.name,
                signature: resolved.signature,
                from: node.from,
                to: node.to,
            };
        case 'variable':
            return {
                kind: 'variable',
                name: resolved.name,
                value: resolved.value,
                source: resolved.source,
                from: node.from,
                to: node.to,
            };
        case 'alias':
            return {
                kind: 'alias',
                alias: resolved.alias,
                target: resolved.target,
                from: node.from,
                to: node.to,
            };
    }
}

// Variable refs that didn't resolve still produce a 'variable' tooltip with
// an undefined value so the UI can render "(undefined)" rather than swallowing
// the hover. Mirrors the plot-side behavior.
function fromVariableNode(node: Node): SqlHoverContent | null {
    if (node.kind !== 'variableRef' && node.kind !== 'doubleDollarRef') return null;
    const raw = node.text;
    const isDouble = raw.startsWith('$$');
    const name = isDouble ? raw : raw;
    return {
        kind: 'variable',
        name,
        value: undefined,
        source: isDouble ? 'workspace' : 'cell',
        from: node.from,
        to: node.to,
    };
}

// Identifier-leaning kinds: things that can carry an explicit identity at a
// position the user might want a tooltip for. Structural nodes (clauses,
// joins, etc.) are filtered out so hovering inside whitespace returns null.
const LEAF_KINDS = new Set<string>([
    'identifier',
    'qualifiedIdent',
    'functionCall',
    'variableRef',
    'doubleDollarRef',
    'crossCellRef',
    'tableRef',
    'literal',
]);

export function getHoverContent(
    source: string,
    pos: number,
    deps: SqlHoverDeps,
): SqlHoverContent | null {
    const root = getAnnotatedSqlRoot(source, deps);
    const hovered = findHoveredNode(root, pos);
    if (!hovered) return null;

    // Walk up to the nearest node carrying a resolution. If we find one, use it.
    const resolvedNode = nearestResolved(hovered);
    if (resolvedNode && resolvedNode.annotations.resolves) {
        const content = fromResolved(resolvedNode.annotations.resolves, resolvedNode);
        if (content) return content;
    }

    // Unresolved variable: still surface a 'variable' tooltip rather than swallowing.
    const variableContent = fromVariableNode(hovered);
    if (variableContent) return variableContent;

    // Otherwise: only emit something for leaf-typed nodes the user could
    // plausibly be pointing at. Structural / clause nodes return null.
    if (LEAF_KINDS.has(hovered.kind) && hovered.text.length > 0) {
        return {
            kind: 'unresolved',
            text: hovered.text,
            from: hovered.from,
            to: hovered.to,
        };
    }

    return null;
}
