// AST node types for the partial DuckDB parser.
//
// Every node carries the absolute source range [from, to) and the original
// text slice. Nodes can have a `hole` placeholder anywhere a child is missing
// or malformed — hole nodes carry `expectedKinds` so the completion engine
// can dispatch by *what was expected* rather than *what was typed*.

import type { Token } from './tokens';

export type NodeKind =
    | 'script'                                 // top-level: list of statements
    | 'query'                                  // SELECT … FROM … (a QueryStatement)
    | 'cte' | 'with'
    | 'selectClause' | 'fromClause'
    | 'whereClause' | 'havingClause'
    | 'groupByClause' | 'orderByClause'
    | 'limitClause' | 'qualifyClause'
    | 'setOp'                                  // UNION / INTERSECT / EXCEPT joining two queries
    | 'tableRef'                               // FROM target (table | subquery | function call)
    | 'join' | 'joinCondition'
    | 'starExpr'                               // * with EXCLUDE/REPLACE/RENAME
    | 'projection'                             // one item in SELECT list
    | 'binaryExpr' | 'unaryExpr'
    | 'caseExpr' | 'castExpr'
    | 'functionCall' | 'filterClause' | 'overClause' | 'windowDef'
    | 'lambdaExpr' | 'columnsExpr'
    | 'identifier' | 'qualifiedIdent'
    | 'literal'
    | 'variableRef' | 'doubleDollarRef' | 'crossCellRef'
    | 'list' | 'paren'
    | 'orderItem'                              // expr [ASC|DESC] [NULLS FIRST|LAST]
    | 'hole';

// Which SQL clause an expression node lives in. Computed by the annotator,
// not the parser — but the parser sets it on clause nodes themselves.
export type SqlClause =
    | 'select' | 'from' | 'where' | 'groupBy' | 'having'
    | 'qualify' | 'orderBy' | 'limit' | 'join' | 'on';

// Annotation attached by the annotator chain. Empty by default; the parser
// populates `expectedKinds` for hole nodes.
export interface NodeAnnotations {
    resolves?: ResolvedSymbol;
    scope?: ScopeRef;
    expectedKinds?: NodeKind[];
    diagnostics?: Diagnostic[];
    clause?: SqlClause;
}

export interface Node {
    kind: NodeKind;
    from: number;
    to: number;
    text: string;
    children: Node[];
    parent?: Node;
    annotations: NodeAnnotations;
    // True if the cursor (offset) falls within [from, to). Set by `cursorNode`,
    // not by the parser. The deepest enclosing node with this flag is the
    // "active" node for completion.
    hasCursor?: boolean;
}

// Forward declaration — the real Scope class lives in scope.ts. We type it as
// an opaque ref here to avoid an import cycle.
export interface ScopeRef {
    readonly id: number;
}

export type ResolvedSymbol =
    | { kind: 'column'; table: string; column: string; dataType: string }
    | { kind: 'table'; name: string; rowCount?: number }
    | { kind: 'view'; name: string }
    | { kind: 'cte'; name: string }
    | { kind: 'function'; name: string; signature: string }
    | { kind: 'variable'; name: string; value: string; source: 'cell' | 'workspace' | 'gesture' }
    | { kind: 'alias'; alias: string; target: string };

export interface Diagnostic {
    severity: 'error' | 'warning' | 'info';
    message: string;
    from: number;
    to: number;
}

// ------------------------------ helpers ------------------------------

// Make a node from a list of tokens (uses the first/last to compute span).
// If children extend beyond the token span (common when a clause ends with a
// hole node positioned past the last consumed keyword), the span is widened
// to cover them. If `tokens` is null/empty, falls back to the children's span,
// then to `fallbackPos`.
export function makeNode(
    kind: NodeKind,
    tokens: Token[] | null,
    children: Node[],
    source: string,
    fallbackPos = 0,
): Node {
    let from: number;
    let to: number;
    if (tokens && tokens.length > 0) {
        from = tokens[0].from;
        to = tokens[tokens.length - 1].to;
        for (const c of children) {
            if (c.from < from) from = c.from;
            if (c.to > to) to = c.to;
        }
    } else if (children.length > 0) {
        from = children[0].from;
        to = children[0].to;
        for (const c of children) {
            if (c.from < from) from = c.from;
            if (c.to > to) to = c.to;
        }
    } else {
        from = fallbackPos;
        to = fallbackPos;
    }
    const node: Node = {
        kind,
        from,
        to,
        text: source.slice(from, to),
        children,
        annotations: {},
    };
    for (const c of children) c.parent = node;
    return node;
}

// Create a hole node marking a missing child. `expectedKinds` tells the
// completion engine what should appear here.
export function makeHole(pos: number, expectedKinds: NodeKind[], source: string): Node {
    return {
        kind: 'hole',
        from: pos,
        to: pos,
        text: '',
        children: [],
        annotations: { expectedKinds },
    };
}

// Pre-order walk; visitor returns false to skip children.
export function walk(root: Node, visit: (n: Node) => boolean | void): void {
    const stack: Node[] = [root];
    while (stack.length) {
        const n = stack.pop()!;
        const descend = visit(n);
        if (descend === false) continue;
        // Push in reverse so we visit children left-to-right.
        for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
    }
}

// Deepest node whose [from, to] contains `offset`. Ties (multiple nodes
// containing the offset with the same depth — typically adjacent siblings
// at a boundary) are broken toward the rightward node. Returns the root if
// nothing else matches.
export function cursorNode(root: Node, offset: number): Node {
    let best: Node = root;
    walk(root, (n) => {
        if (offset < n.from || offset > n.to) return false;
        // Prefer deeper containment; on tie, prefer rightward (later `from`).
        const bestWidth = best.to - best.from;
        const nWidth = n.to - n.from;
        if (nWidth < bestWidth) {
            best = n;
        } else if (nWidth === bestWidth && n.from >= best.from) {
            best = n;
        }
    });
    return best;
}

// Mark every ancestor of `target` (including target) with hasCursor=true.
// Useful when we want to highlight the path from root to cursor.
export function markCursorPath(root: Node, offset: number): Node {
    const target = cursorNode(root, offset);
    let n: Node | undefined = target;
    while (n) {
        n.hasCursor = true;
        n = n.parent;
    }
    return target;
}

// Walk upward looking for the nearest ancestor of a given kind.
export function findEnclosing(node: Node, kind: NodeKind): Node | undefined {
    let n: Node | undefined = node;
    while (n) {
        if (n.kind === kind) return n;
        n = n.parent;
    }
    return undefined;
}

// Walk upward looking for the nearest ancestor matching any of the kinds.
export function findEnclosingAny(node: Node, kinds: NodeKind[]): Node | undefined {
    let n: Node | undefined = node;
    while (n) {
        if (kinds.includes(n.kind)) return n;
        n = n.parent;
    }
    return undefined;
}

// ----------------------- variable token classification -----------------------
//
// Single-`$` and double-`$$` references are replaced before the SQL is sent
// to DuckDB. The forms we recognize:
//
//   $foo                      — cell-local variable (this cell's own state).
//   $$foo                     — notebook-scoped (workspace) variable.
//   $CELL_NAME.varName        — variable exported by another cell.
//   $CELL_NAME.varName.N      — Nth slot of a tuple-valued variable (0-based
//                               or 1-based — substitution layer decides; the
//                               AST only records the path).
//   $plotName.brush           — convenience alias for the gesture/brush
//                               selection on a plot cell. Recognized as a
//                               specific subform of the cross-cell shape.
//
// All cross-cell and brush forms share the same node kind (`crossCellRef`)
// with a `path[]` that carries the dotted tail. The annotator decides whether
// the tail names a known cell variable, a tuple index, or `.brush`.
//
// Returned shape mirrors what the AST cares about for completion + diagnostics.

export interface ParsedDollar {
    kind: 'variableRef' | 'doubleDollarRef' | 'crossCellRef';
    // Bare name without leading `$` / `$$`. Empty if the token is just `$`/`$$`.
    // For crossCellRef this is the cell name.
    name: string;
    // For crossCellRef, the dotted tail. Examples:
    //   $foo.bar       → ['bar']
    //   $foo.bar.0     → ['bar', '0']
    //   $plot.brush    → ['brush']
    //   $plot.brush.lo → ['brush', 'lo']
    // Empty array for variableRef / doubleDollarRef.
    path: string[];
    // The literal source form.
    raw: string;
}

// Classify a dollar token value (or any string starting with `$`). Tolerant of
// half-typed inputs — `$`, `$$`, `$foo.`, `$$.bar` all return a sensible shape
// so the completion engine can still react.
export function parseDollar(raw: string): ParsedDollar {
    if (!raw.startsWith('$')) {
        return { kind: 'variableRef', name: raw, path: [], raw };
    }
    if (raw.startsWith('$$')) {
        // $$ followed by an optional ident. The `$$` prefix denotes a
        // notebook-scoped global — we don't model dotted access on it for
        // now (no current grammar uses `$$x.y`). Trailing dots are trimmed
        // so completion mid-type still classifies sensibly.
        const body = raw.slice(2);
        return { kind: 'doubleDollarRef', name: stripTrailingDots(body), path: [], raw };
    }
    // Single-dollar. If there's a dot, it's a cross-cell or brush reference.
    const body = raw.slice(1);
    const dot = body.indexOf('.');
    if (dot === -1) {
        return { kind: 'variableRef', name: body, path: [], raw };
    }
    const name = body.slice(0, dot);
    const tail = body.slice(dot + 1);
    // Split on dot, dropping empty segments produced by a trailing dot or
    // consecutive dots. Numeric segments (tuple indices) are kept as strings
    // — the substitution layer parses them.
    const path = tail.split('.').filter(p => p.length > 0);
    return { kind: 'crossCellRef', name, path, raw };
}

function stripTrailingDots(s: string): string {
    let end = s.length;
    while (end > 0 && s[end - 1] === '.') end--;
    return s.slice(0, end);
}

// True if a parsed dollar refers specifically to the `.brush` gesture export
// of another cell (e.g. `$plot.brush`). Convenience for completion + the
// brush-operator expander.
export function isBrushRef(p: ParsedDollar): boolean {
    return p.kind === 'crossCellRef' && p.path.length >= 1 && p.path[0] === 'brush';
}

// True if a parsed dollar's last path segment is a non-negative integer —
// i.e. a tuple-slot index like `$gc.range.0` or `$gc.range.1`.
export function isTupleIndexRef(p: ParsedDollar): boolean {
    if (p.kind !== 'crossCellRef' || p.path.length === 0) return false;
    const last = p.path[p.path.length - 1];
    return /^[0-9]+$/.test(last);
}
