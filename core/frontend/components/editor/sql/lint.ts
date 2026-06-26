// lint.ts — pure AST-based linter for the partial SQL parser.
//
// Walks the annotated AST (after `annotate()` has run) and emits CodeMirror
// `Diagnostic` objects for the following rules:
//
//   - error  : unknown column        — qualifiedIdent / bare identifier in a
//                                       column-context clause whose
//                                       annotations.resolves is missing AND
//                                       there is at least one table in scope.
//   - error  : unknown table/view    — tableRef whose annotations.resolves is
//                                       missing.
//   - error  : unknown function      — functionCall whose annotations.resolves
//                                       is missing (functionAnnotator looks up
//                                       SQL_FUNCTIONS).
//   - warning: dangling alias        — alias defined on a tableRef but never
//                                       used as the left side of a
//                                       qualifiedIdent inside the same scope.
//   - info   : undefined variable    — variableRef whose annotations.resolves
//                                       is missing AND whose name is not in
//                                       deps.variables.
//
// Mid-typing guard: any node whose ancestor path contains a `hole` is skipped
// — those positions are partial parses where false positives are likely.
//
// This module is intentionally pure and dependency-free apart from the AST
// types. The CM linter glue lives in `components/editor/diagnostics.ts`.

import type { Diagnostic } from '@codemirror/lint';
import { walk, type Node } from './ast';
import { parse } from './parser';
import { annotate } from './annotate';
import type { SchemaForCompletion } from '../completions';
import { SQL_FUNCTIONS } from '../sqlFunctions';

export interface LintDeps {
    schema: SchemaForCompletion;
    variables: Record<string, string>;
}

// Build a case-insensitive name set once per call. Cheap; SQL_FUNCTIONS has
// ~80 entries.
function buildFunctionNameSet(): Set<string> {
    const s = new Set<string>();
    for (const f of SQL_FUNCTIONS) s.add(f.name.toLowerCase());
    return s;
}

// True if `node` or any ancestor is a `hole`. Used to suppress diagnostics
// while the user is mid-token.
export function hasHoleAncestor(node: Node): boolean {
    let cur: Node | undefined = node;
    while (cur) {
        if (cur.kind === 'hole') return true;
        cur = cur.parent;
    }
    return false;
}

// True if any direct descendant of `node` is a hole. Used for tableRefs that
// failed to consume their target.
function hasHoleDescendant(node: Node): boolean {
    let found = false;
    walk(node, (n) => {
        if (n === node) return;
        if (n.kind === 'hole') { found = true; return false; }
    });
    return found;
}

// Walk up to the enclosing clause node (the one with `annotations.clause`).
// Returns undefined if there's no enclosing clause.
function enclosingClause(node: Node): Node['annotations']['clause'] | undefined {
    let cur: Node | undefined = node.parent;
    while (cur) {
        if (cur.annotations.clause) return cur.annotations.clause;
        cur = cur.parent;
    }
    return undefined;
}

// True if the node's enclosing clause is one where bare identifiers refer to
// columns (rather than tables or keywords).
function isColumnContextClause(node: Node): boolean {
    const c = enclosingClause(node);
    return c === 'select'
        || c === 'where'
        || c === 'having'
        || c === 'qualify'
        || c === 'groupBy'
        || c === 'orderBy'
        || c === 'on'
        || c === 'join';
}

// True if `node` is the definition-side identifier in a tableRef or
// projection (i.e. the alias slot or the table name slot). Mirrors logic in
// schemaAnnotator.isDefinitionSite — kept separate to avoid a circular
// dependency.
function isDefinitionSite(n: Node): boolean {
    const p = n.parent;
    if (!p) return false;
    if (p.kind === 'cte') {
        const idents = p.children.filter(c => c.kind === 'identifier');
        if (idents[0] === n) return true;
    }
    if (p.kind === 'projection' || p.kind === 'tableRef') {
        const idents = p.children.filter(c => c.kind === 'identifier');
        if (idents.length >= 2 && idents[idents.length - 1] === n) return true;
        // A tableRef whose first child is a bare identifier — that identifier
        // names the table and is handled by the tableRef diagnostic, not the
        // column diagnostic.
        if (p.kind === 'tableRef' && idents.length >= 1 && idents[0] === n) return true;
    }
    if (p.kind === 'list' && p.parent && (p.parent.kind === 'cte' || p.parent.kind === 'tableRef')) {
        return true;
    }
    return false;
}

// Find the alias and target identifier nodes of a `tableRef` node.
// - `nameNode` is the first identifier child when the tableRef references a
//   table directly. For subqueries / function-call refs it's undefined.
// - `aliasNode` is the trailing identifier when an alias was given, else
//   undefined.
function tableRefParts(node: Node): { nameNode?: Node; aliasNode?: Node; aliasName?: string } {
    if (node.children.length === 0) return {};
    const first = node.children[0];
    const idents = node.children.filter(c => c.kind === 'identifier');
    let nameNode: Node | undefined;
    if (first.kind === 'identifier') {
        nameNode = first;
    }
    let aliasNode: Node | undefined;
    let aliasName: string | undefined;
    if (first.kind === 'identifier') {
        if (idents.length >= 2) {
            aliasNode = idents[idents.length - 1];
            aliasName = aliasNode.text;
        } else {
            // No explicit alias — the bare table name acts as the alias.
            aliasName = first.text;
        }
    } else if (idents.length >= 1) {
        aliasNode = idents[idents.length - 1];
        aliasName = aliasNode.text;
    }
    // An alias may also live inside a `list` child (alias + column list).
    for (const child of node.children) {
        if (child.kind === 'list' && child.parent === node) {
            const listIdents = child.children.filter(c => c.kind === 'identifier');
            if (listIdents.length >= 1) {
                aliasNode = listIdents[0];
                aliasName = aliasNode.text;
            }
        }
    }
    return { nameNode, aliasNode, aliasName };
}

// Pull the left-side identifier name from a `qualifiedIdent` node (the
// qualifier — usually a table alias).
function leftIdentName(qualified: Node): string | undefined {
    const idents = qualified.children.filter(c => c.kind === 'identifier');
    if (idents.length >= 2) return idents[0].text;
    return undefined;
}

// Locate the nearest enclosing `query` node — used to scope dangling-alias
// detection per query (so an alias defined in an outer query is not flagged
// just because the inner subquery never used it).
function enclosingQuery(node: Node): Node | undefined {
    let cur: Node | undefined = node.parent;
    while (cur) {
        if (cur.kind === 'query') return cur;
        cur = cur.parent;
    }
    return undefined;
}

// Pull the leading `$` off a variableRef's text so we can compare against
// `deps.variables` keys (which are stored without the prefix).
function stripDollar(raw: string): string {
    if (raw.startsWith('$$')) return raw.slice(2);
    if (raw.startsWith('$')) return raw.slice(1);
    return raw;
}

// Whether the node's enclosing query scope has at least one table binding
// — i.e. whether unresolved column identifiers are unambiguous errors. If
// the scope has no tables, the identifier could be anything and we don't
// emit a diagnostic.
function scopeHasTables(node: Node, root: Node): boolean {
    const q = enclosingQuery(node);
    if (!q) return false;
    // Scope tables live on the aliasAnnotator pass via tableRef siblings of
    // the FROM clause. We can simply count tableRef nodes inside this query
    // (excluding nested queries' fromClauses).
    let count = 0;
    walk(q, (n) => {
        if (n === q) return;
        if (n.kind === 'query') return false;  // skip nested queries
        if (n.kind === 'tableRef') count++;
    });
    void root;
    return count > 0;
}

export function lintSql(source: string, deps: LintDeps & { root?: Node }): Diagnostic[];
export function lintSql(source: string, deps: LintDeps): Diagnostic[];
export function lintSql(source: string, deps: LintDeps & { root?: Node }): Diagnostic[] {
    const root = deps.root ?? parse(source).root;
    if (!deps.root) {
        annotate(root, {
            tables: deps.schema.tables,
            views: deps.schema.views,
            variables: {
                cellVariables: new Map(Object.entries(deps.variables)),
                workspaceVariables: new Map(),
                cellExports: new Map(),
                cellsWithBrush: new Set(),
            },
        });
    }

    const diagnostics: Diagnostic[] = [];
    const fnNames = buildFunctionNameSet();

    // For dangling-alias detection. Keyed by enclosing-query node identity.
    interface AliasInfo {
        node: Node;       // the alias identifier node
        name: string;
    }
    const aliasesByQuery = new Map<Node, AliasInfo[]>();
    const referencedByQuery = new Map<Node, Set<string>>();

    walk(root, (node) => {
        // Mid-typing guard.
        if (hasHoleAncestor(node)) return;

        switch (node.kind) {
            case 'identifier': {
                if (isDefinitionSite(node)) return;
                if (!isColumnContextClause(node)) return;
                if (node.annotations.resolves) return;
                // Skip if the parent is a qualifiedIdent (we handle the
                // whole qualified node, not the inner idents).
                if (node.parent && node.parent.kind === 'qualifiedIdent') return;
                // Skip identifiers that name the inside of a functionCall —
                // those are handled by the functionCall branch.
                if (node.parent && node.parent.kind === 'functionCall'
                    && node.parent.children[0] === node) return;
                if (!scopeHasTables(node, root)) return;
                diagnostics.push({
                    from: node.from,
                    to: node.to,
                    severity: 'error',
                    message: `Unknown column '${node.text}'.`,
                });
                return;
            }
            case 'qualifiedIdent': {
                // Track left-side qualifier for dangling-alias check.
                const left = leftIdentName(node);
                if (left) {
                    const q = enclosingQuery(node);
                    if (q) {
                        let set = referencedByQuery.get(q);
                        if (!set) { set = new Set(); referencedByQuery.set(q, set); }
                        set.add(left.toLowerCase());
                    }
                }
                if (!isColumnContextClause(node)) return;
                if (node.annotations.resolves) return;
                if (!scopeHasTables(node, root)) return;
                diagnostics.push({
                    from: node.from,
                    to: node.to,
                    severity: 'error',
                    message: `Unknown column '${node.text}'.`,
                });
                return;
            }
            case 'tableRef': {
                // Collect alias for dangling check.
                const parts = tableRefParts(node);
                if (parts.aliasName) {
                    const q = enclosingQuery(node);
                    if (q) {
                        let list = aliasesByQuery.get(q);
                        if (!list) { list = []; aliasesByQuery.set(q, list); }
                        // Only flag explicit aliases (where the alias node
                        // differs from the bare name node).
                        if (parts.aliasNode) {
                            list.push({ node: parts.aliasNode, name: parts.aliasName });
                        }
                    }
                }
                // Unknown table/view: nameNode resolves to nothing AND no
                // hole hides the failure.
                if (parts.nameNode && !parts.nameNode.annotations.resolves) {
                    if (hasHoleDescendant(node)) return;
                    diagnostics.push({
                        from: parts.nameNode.from,
                        to: parts.nameNode.to,
                        severity: 'error',
                        message: `Unknown table or view '${parts.nameNode.text}'.`,
                    });
                }
                return;
            }
            case 'functionCall': {
                if (node.annotations.resolves) return;
                const nameNode = node.children.find(c => c.kind === 'identifier');
                if (!nameNode) return;
                if (fnNames.has(nameNode.text.toLowerCase())) return;
                diagnostics.push({
                    from: nameNode.from,
                    to: nameNode.to,
                    severity: 'error',
                    message: `Unknown function '${nameNode.text}'.`,
                });
                return;
            }
            case 'variableRef':
            case 'doubleDollarRef':
            case 'crossCellRef': {
                if (node.annotations.resolves) return;
                const name = stripDollar(node.text);
                if (!name) return;
                // Cell-name part for crossCellRef has its own resolution path
                // — only fire if truly unknown.
                if (node.kind === 'variableRef' && deps.variables[name] !== undefined) return;
                diagnostics.push({
                    from: node.from,
                    to: node.to,
                    severity: 'info',
                    message: `Variable '${node.text}' is not defined; substitution may fail.`,
                });
                return;
            }
        }
    });

    // Dangling alias pass.
    for (const [query, aliases] of aliasesByQuery) {
        const refs = referencedByQuery.get(query) ?? new Set<string>();
        for (const a of aliases) {
            if (!refs.has(a.name.toLowerCase())) {
                diagnostics.push({
                    from: a.node.from,
                    to: a.node.to,
                    severity: 'warning',
                    message: `Alias '${a.name}' is never referenced.`,
                });
            }
        }
    }

    return diagnostics;
}
