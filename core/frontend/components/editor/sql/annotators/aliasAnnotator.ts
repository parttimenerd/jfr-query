// aliasAnnotator: walks the AST, builds a Scope chain rooted at each `query`
// node, and registers CTEs and FROM-clause table bindings into the scope.
//
// Pass 1: for each `query` node, create a `Scope` whose parent is the nearest
// enclosing `query`'s scope. Attach the scope to `node.annotations.scope`.
//
// Pass 2: for each `with` node, register every direct `cte` child on the
// enclosing query's scope.
//
// Pass 3: for each `fromClause` under a query, register every `tableRef`
// child as a `TableBinding` on that query's scope. Aliases are detected by
// looking at trailing identifier children (DuckDB uses `[AS] alias` shapes).
//
// The columns on each binding come from `Scope.resolveTableRef` against the
// passed-in schema.

import { type Node, walk } from '../ast';
import {
    Scope,
    type CteBinding,
    type TableBinding,
} from '../scope';
import type { TableSchema, ViewSchema, ColumnSchema } from '../../../../types';

export interface AliasAnnotatorInput {
    tables: ReadonlyArray<TableSchema>;
    views: ReadonlyArray<ViewSchema>;
}

// Returned by `annotateAliases` so downstream annotators (schemaAnnotator)
// can resolve `Node.annotations.scope.id` back to the real Scope instance.
export type ScopeMap = Map<number, Scope>;

export function annotateAliases(root: Node, input: AliasAnnotatorInput): ScopeMap {
    // Pass 1: attach Scope objects to each `query` node.
    const scopes = new Map<Node, Scope>();
    const ancestry: Scope[] = [];
    const queryStack: Node[] = [];

    // Use a recursive walk so we can pop scopes on exit. The iterative
    // `walk` doesn't track exits, so we DIY here.
    const visit = (n: Node): void => {
        const isQuery = n.kind === 'query';
        let pushed = false;
        if (isQuery) {
            const parent = ancestry.length ? ancestry[ancestry.length - 1] : null;
            const scope = new Scope(parent);
            scopes.set(n, scope);
            n.annotations.scope = { id: scope.id };
            ancestry.push(scope);
            queryStack.push(n);
            pushed = true;
        }
        for (const c of n.children) visit(c);
        if (pushed) {
            ancestry.pop();
            queryStack.pop();
        }
    };
    visit(root);

    // Pass 2: CTEs. A `with` node lives as a child of the enclosing query.
    walk(root, (n) => {
        if (n.kind !== 'with') return;
        // Find the enclosing query (walk up via parent links).
        const enclosing = findEnclosingQuery(n);
        if (!enclosing) return;
        const scope = scopes.get(enclosing);
        if (!scope) return;
        for (const child of n.children) {
            if (child.kind !== 'cte') continue;
            const binding = extractCteBinding(child, input);
            if (binding) scope.addCte(binding);
        }
    });

    // Pass 3: FROM clauses. Each `fromClause` is owned by a `query` —
    // register its tableRefs on that query's scope. We also dive into JOINs
    // because the joined table is a sibling of the primary in the AST.
    walk(root, (n) => {
        if (n.kind !== 'fromClause') return;
        const enclosing = findEnclosingQuery(n);
        if (!enclosing) return;
        const scope = scopes.get(enclosing);
        if (!scope) return;

        for (const child of n.children) {
            if (child.kind === 'tableRef') {
                const b = extractTableBinding(child, scope, input);
                if (b) scope.addTable(b);
            } else if (child.kind === 'join') {
                // A join's first child is the right-hand tableRef.
                for (const jc of child.children) {
                    if (jc.kind === 'tableRef') {
                        const b = extractTableBinding(jc, scope, input);
                        if (b) scope.addTable(b);
                    }
                }
            }
        }
    });

    // Return id → Scope so schemaAnnotator can look up the real instance.
    const byId: ScopeMap = new Map();
    for (const [, s] of scopes) byId.set(s.id, s);
    return byId;
}

function findEnclosingQuery(n: Node): Node | undefined {
    let cur: Node | undefined = n.parent;
    while (cur) {
        if (cur.kind === 'query') return cur;
        cur = cur.parent;
    }
    return undefined;
}

// A `cte` node's shape: identifier (name), optional list (column list), query.
function extractCteBinding(node: Node, input: AliasAnnotatorInput): CteBinding | null {
    let name = '';
    let columns: ColumnSchema[] = [];
    let recursive = false;

    // Look for the name (first identifier child) and the inner query.
    for (const c of node.children) {
        if (!name && c.kind === 'identifier') {
            name = c.text;
        }
        if (c.kind === 'list') {
            // Column list — collect identifier children as untyped columns.
            columns = c.children
                .filter(x => x.kind === 'identifier')
                .map(x => ({ name: x.text, type: 'UNKNOWN' }));
        }
    }
    if (!name) return null;

    // `WITH RECURSIVE` is encoded on the parent `with` node's text — easier
    // to scan textually here than chase a flag through the AST.
    if (node.parent && /\bRECURSIVE\b/i.test(node.parent.text)) {
        recursive = true;
    }

    // If no explicit columns, try to pull them from the inner query's
    // projections — best-effort, only when projections look like identifiers
    // or aliased projections.
    if (columns.length === 0) {
        const inner = node.children.find(c => c.kind === 'query');
        if (inner) columns = projectionsToColumns(inner);
    }

    void input; // currently unused; reserved for future schema cross-checks.
    return { name, columns, recursive };
}

// Pull synthetic column schemas from a query's selectClause. For each
// projection we look for an alias (last identifier child) or a leading
// identifier — anything else becomes a positional `?colN` with UNKNOWN type.
function projectionsToColumns(query: Node): ColumnSchema[] {
    // Descend through wrapper `query` nodes (the parser sometimes wraps a
    // bare SELECT in an outer `query` for set-op composability).
    let q = query;
    while (q && q.kind === 'query' && !q.children.some(c => c.kind === 'selectClause')) {
        const inner = q.children.find(c => c.kind === 'query');
        if (!inner) break;
        q = inner;
    }
    const sel = q.children.find(c => c.kind === 'selectClause');
    if (!sel) return [];
    const out: ColumnSchema[] = [];
    let i = 0;
    for (const proj of sel.children) {
        if (proj.kind !== 'projection') continue;
        const idents = proj.children.filter(c => c.kind === 'identifier');
        let name: string;
        if (idents.length >= 2) {
            name = idents[idents.length - 1].text;
        } else if (idents.length === 1) {
            name = idents[0].text;
        } else {
            name = `?col${i}`;
        }
        out.push({ name, type: 'UNKNOWN' });
        i++;
    }
    return out;
}

// A `tableRef` node's shape: the source (identifier, qualifiedIdent, paren
// containing a query, or function call) followed optionally by an alias
// identifier. We don't model AS explicitly in the tokenizer's AST output.
function extractTableBinding(
    node: Node,
    scope: Scope,
    input: AliasAnnotatorInput,
): TableBinding | null {
    if (node.children.length === 0) return null;

    const first = node.children[0];
    let target = '';
    let kind: TableBinding['kind'] = 'unknown';
    let columns: ColumnSchema[] = [];

    if (first.kind === 'identifier') {
        target = first.text;
    } else if (first.kind === 'qualifiedIdent') {
        // `schema.table` — use the last segment as the lookup name.
        const idents = first.children.filter(c => c.kind === 'identifier');
        target = idents.length ? idents[idents.length - 1].text : first.text;
    } else if (first.kind === 'paren' || first.kind === 'query') {
        // Inline subquery: derive columns from its projections.
        const inner = first.children.find(c => c.kind === 'query') ?? first;
        if (inner.kind === 'query') columns = projectionsToColumns(inner);
        kind = 'subquery';
    } else if (first.kind === 'functionCall') {
        // Table-valued function (e.g. `read_csv('...')`). No columns until
        // we resolve the function. Leave columns empty.
        const nameNode = first.children.find(c => c.kind === 'identifier');
        target = nameNode ? nameNode.text : '';
    } else {
        // Unknown shape; bail.
        return null;
    }

    // Resolve via CTE → table → view.
    if (kind === 'unknown' && target) {
        const resolved = Scope.resolveTableRef(
            target,
            scope.listCtes(),
            input.tables,
            input.views,
        );
        if (resolved) {
            kind = resolved.kind;
            columns = resolved.columns;
        }
    }

    // Alias detection: any trailing identifier sibling after the first
    // source child. For a bare-ident table (`FROM t`), the source IS the
    // identifier — no alias unless there are two idents.
    let alias = target;
    const idents = node.children.filter(c => c.kind === 'identifier');
    if (first.kind === 'identifier') {
        if (idents.length >= 2) alias = idents[idents.length - 1].text;
    } else if (idents.length >= 1) {
        alias = idents[idents.length - 1].text;
    }

    return { alias, target, kind, columns };
}
