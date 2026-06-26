// AST types and tree helpers for the plot DSL.

import type { ParsedDollar } from '../sql/ast';
import type { PlotHoleHint, PlotDiagnostic } from './holeKinds';

export type PlotNodeKind =
    | 'script'           // top-level — children are letStatement | plotCall | composite
    | 'letStatement'     // LET @name = value
    | 'plotCall'         // shape '(' clauseList ')' tail*    OR   shape '{' clauseList '}' tail*
    | 'composite'        // row / col composite
    | 'clause'           // ident : value
    | 'tail'             // tail keyword + value
    | 'list'             // [ value, value, ... ]
    | 'paren'            // ( expr )
    | 'binaryExpr'       // expr OP expr
    | 'unaryExpr'        // -expr
    | 'functionCall'     // bucket(ts, 100)
    | 'literal'          // number / string / boolean / null
    | 'ident'            // bare identifier (column ref or value placeholder)
    | 'varRef'           // $var / $$var / $cell.var[.path] (uses parsed dollar)
    | 'constRef'         // @name
    | 'hole'             // missing / partial — completion hint
    | 'clauseRef'        // NEW — the bare key of a clause (e.g. `x` in `x: ts`)
    | 'tailRef'          // NEW — the keyword of a tail (`TITLE`, `LINK_X`, lowercase `name`)
    | 'queryRef';        // NEW — `#2` or `#"viewname"` query reference

export interface ColumnSchema {
    name: string;
    dataType?: string;
    nullable?: boolean;
}

export type ResolvedPlotSymbol =
    | { kind: 'constant'; name: string; valueText: string; declarationFrom?: number }
    | {
        kind: 'variable';
        parsed: ParsedDollar;
        value?: string;
        source?: 'cellLocal' | 'workspace' | 'crossCell' | 'brush' | 'gesture' | 'undefined';
        dataType?: 'number' | 'string' | 'timestamp' | 'json' | 'unknown';
    }
    | { kind: 'column'; name: string; dataType?: string; nullable?: boolean }
    | {
        kind: 'plotShape';
        name: string;
        validClauses: string[];
        columnClauses: string[];
        requiredClauses?: string[];
        description?: string;
    }
    | {
        kind: 'clauseDef';
        clauseKey: string;
        shape: string;
        paramType: string;
        required: boolean;
        options?: string[];
        description?: string;
    }
    | {
        kind: 'tailKeyword';
        keyword: string;
        arity: 'bare' | 'single' | 'list';
        accepts: 'string' | 'number' | 'dimension' | 'identList' | 'linkArgs';
    }
    | {
        kind: 'queryRef';
        targetCellId?: string;
        targetSql?: string;
        targetColumns?: ColumnSchema[];
    }
    | {
        kind: 'crossPlot';
        plotName: string;
        cellId?: string;
        plotIndex?: number;
        declaredColumns?: string[];
    };

export interface PlotNodeAnnotations {
    /** Resolved symbol after annotators run. */
    resolves?: ResolvedPlotSymbol;
    /** Only on 'hole' nodes — what kinds of node could legally fill this slot. */
    expectedKinds?: PlotNodeKind[];
    /**
     * Only on 'hole' nodes — richer slot-specific completion hint. New code
     * should prefer this over `expectedKinds`. `expectedKinds` is preserved
     * alongside for back-compat.
     */
    hint?: PlotHoleHint;
    /**
     * Optional user-facing recommendation string carried on a hole (e.g.
     * "Did you mean `pause`?"). Distinct from diagnostics; this is a
     * suggested fix attached at parse time when the hint already implies one.
     */
    errorRecommendation?: string;
    /** Legacy string diagnostics attached during annotation. Kept for back-compat. */
    diagnostics?: string[];
    /** Structured diagnostics (P4 will consume). Co-exists with `diagnostics`. */
    structuredDiagnostics?: PlotDiagnostic[];
}

export interface PlotNode {
    kind: PlotNodeKind;
    from: number;
    to: number;
    text: string;
    children: PlotNode[];
    parent?: PlotNode;
    annotations: PlotNodeAnnotations;

    // Kind-specific fields (kept on the node for ergonomic access).
    /** plotCall: normalized shape name (lowercased — `line`, `bar`, etc.). */
    shape?: string;
    /** plotCall: original case of the shape token (`LINE_CHART` or `line`). */
    shapeRaw?: string;
    /** plotCall: 'uppercase' or 'lowercase' form (controls serialization). */
    form?: 'uppercase' | 'lowercase';
    /** composite: 'row' | 'col'. */
    direction?: 'row' | 'col';
    /** clause/tail: key (lowercase preserved as written). */
    key?: string;
    /** tail: original keyword text (for round-trip). */
    keyRaw?: string;
    /** literal: parsed JS value. */
    literalValue?: unknown;
    /** literal: original literal kind. */
    literalKind?: 'number' | 'string' | 'boolean' | 'null' | 'dimension';
    /** ident: raw identifier text. */
    name?: string;
    /** functionCall: function name. */
    fnName?: string;
    /** binaryExpr/unaryExpr: operator text. */
    op?: string;
    /** varRef: parsed dollar. */
    dollar?: ParsedDollar;
    /** constRef: bare name (no leading @). */
    constName?: string;
    /** letStatement: name (without @). */
    letName?: string;
    /** Whether the cursor is within / adjacent to this node. */
    hasCursor?: boolean;

    // Span refinements — used by lint actions to underline precise sub-ranges.
    /** clause/tail: source position of the key token's first char. */
    keyFrom?: number;
    /** clause/tail: source position one past the key token. */
    keyTo?: number;
    /** clause: source position of the ':' separator (if present). */
    colonFrom?: number;
    /** clause: source position where the value token begins (if present). */
    valueFrom?: number;
    /** queryRef: parsed numeric index (`#2` → 2) when applicable. */
    queryIndex?: number;
    /** queryRef: parsed view name (`#"v"` or `#v`) when applicable. */
    queryName?: string;
    /** queryRef: source range of the target (excluding the leading `#`). */
    queryTargetFrom?: number;
    queryTargetTo?: number;
}

export function makeNode(kind: PlotNodeKind, from: number, to: number, src: string, fields: Partial<PlotNode> = {}): PlotNode {
    return {
        kind,
        from,
        to,
        text: src.slice(from, to),
        children: [],
        annotations: {},
        ...fields,
    };
}

export function walk(root: PlotNode, visitor: (n: PlotNode) => void): void {
    const stack: PlotNode[] = [root];
    while (stack.length > 0) {
        const n = stack.pop()!;
        visitor(n);
        for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
    }
}

export function setParents(root: PlotNode, parent?: PlotNode): void {
    root.parent = parent;
    for (const c of root.children) setParents(c, root);
}

export function cursorNode(root: PlotNode, pos: number): PlotNode {
    // Return the innermost node containing pos (or the closest before EOF).
    let best: PlotNode = root;
    walk(root, n => {
        if (n.from <= pos && pos <= n.to) {
            // Prefer deeper, more-specific nodes.
            if (
                n.from >= best.from && n.to <= best.to &&
                !(n === root) &&
                // only descend if it's tighter
                (n.to - n.from) <= (best.to - best.from)
            ) {
                best = n;
            }
        }
    });
    return best;
}

export function findEnclosing(node: PlotNode, kind: PlotNodeKind): PlotNode | undefined {
    let n: PlotNode | undefined = node;
    while (n) {
        if (n.kind === kind) return n;
        n = n.parent;
    }
    return undefined;
}

// Re-export parseDollar so plot annotators don't have to import sql/ast directly.
export { parseDollar } from '../sql/ast';
export type { ParsedDollar } from '../sql/ast';
