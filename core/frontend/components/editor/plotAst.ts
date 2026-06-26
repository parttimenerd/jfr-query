/**
 * Shim for the legacy `plotAst.ts` module.
 *
 * The semantic AST + cursor handling now lives under `./plot/`. This file
 * keeps the old public API (`PlotAstNode`, `PlotAstNodeKind`,
 * `PlotCursorContext`, `PlotCompletionKind`, `parsePlotAst`,
 * `getPlotCursorContext`) so existing callers (`completions.ts`) need no
 * changes. The implementation is reduced to a translation layer over the
 * new module.
 */

import { parse } from './plot/parser';
import type { PlotNode } from './plot/ast';
import { walk } from './plot/ast';

// ─── Legacy types (preserved for callers) ─────────────────────────────────────

export type PlotAstNodeKind =
    | 'root'
    | 'call'
    | 'param'
    | 'array'
    | 'value'
    | 'tail'
    | 'let'
    | 'hole';

export interface PlotAstNode {
    kind: PlotAstNodeKind;
    from: number;
    to: number;
    text: string;
    children: PlotAstNode[];
    plotType?: string;
    paramName?: string;
    paramType?: string;
    tailKeyword?: string;
    quoted?: boolean;
    hasCursor?: boolean;
}

export type PlotCompletionKind =
    | 'plot-type'
    | 'param-name'
    | 'param-value'
    | 'array-value'
    | 'tail-keyword'
    | 'tail-value'
    | 'let-name'
    | 'let-value'
    | 'unknown';

export interface PlotCursorContext {
    kind: PlotCompletionKind;
    plotType?: string;
    paramName?: string;
    paramType?: string;
    tailKeyword?: string;
    usedParams?: string[];
    prefix: string;
    from: number;
    inArray: boolean;
}

// ─── Translation layer ────────────────────────────────────────────────────────

const SHAPE_LC_TO_UC: Record<string, string> = {
    line: 'LINE_CHART', bar: 'BAR_CHART', scatter: 'SCATTER_PLOT',
    heatmap: 'HEATMAP', histogram: 'HISTOGRAM', boxplot: 'BOX_PLOT',
    pie: 'PIE_CHART', flamegraph: 'FLAMEGRAPH', table: 'TABLE',
    area: 'AREA_CHART', gantt: 'GANTT_CHART', range: 'RANGE_PLOT',
};

function newToLegacyKind(n: PlotNode): PlotAstNodeKind {
    switch (n.kind) {
        case 'script': return 'root';
        case 'plotCall': return 'call';
        case 'composite': return 'call';
        case 'clause': return 'param';
        case 'list': return 'array';
        case 'literal':
        case 'ident':
        case 'varRef':
        case 'constRef':
        case 'queryRef':
        case 'clauseRef': return 'value';
        case 'tail':
        case 'tailRef': return 'tail';
        case 'letStatement': return 'let';
        case 'hole': return 'hole';
        default: return 'value';
    }
}

function toLegacy(n: PlotNode): PlotAstNode {
    const kind = newToLegacyKind(n);
    // Skip `clauseRef` (a clause's key span) and `tailRef` (a tail's keyword
    // span) children — these are bookkeeping nodes that did not exist in the
    // legacy AST. Their span is already implicit in the parent's `paramName` /
    // `tailKeyword` fields.
    const childrenToTranslate = n.children.filter(c => c.kind !== 'clauseRef' && c.kind !== 'tailRef');
    const legacy: PlotAstNode = {
        kind,
        from: n.from,
        to: n.to,
        text: n.text,
        children: childrenToTranslate.map(toLegacy),
        hasCursor: n.hasCursor,
    };
    if (n.kind === 'plotCall' && n.shape) {
        legacy.plotType = (SHAPE_LC_TO_UC[n.shape] ?? n.shape).toUpperCase();
    } else if (n.kind === 'composite' && n.direction) {
        legacy.plotType = n.direction.toUpperCase();
    }
    if (n.kind === 'clause' && n.key) {
        legacy.paramName = n.key;
    }
    if (n.kind === 'tail') {
        legacy.tailKeyword = (n.keyRaw ?? n.key ?? '').toUpperCase();
    }
    if (n.kind === 'literal' && n.literalKind === 'string') legacy.quoted = true;
    return legacy;
}

/**
 * Parse a plot DSL string into the legacy AST shape.
 */
export function parsePlotAst(src: string, cursorPos: number): PlotAstNode {
    const root = parse(src, { cursorPos });
    return toLegacy(root);
}

function findCursorNodeNew(root: PlotNode, pos: number): PlotNode | null {
    let best: PlotNode | null = null;
    walk(root, n => {
        if (n.from <= pos && pos <= n.to) {
            if (!best || (n.to - n.from) <= (best.to - best.from)) best = n;
        }
    });
    return best;
}

function findEnclosingPlotCall(node: PlotNode): PlotNode | undefined {
    let n: PlotNode | undefined = node.parent;
    while (n) {
        if (n.kind === 'plotCall') return n;
        n = n.parent;
    }
    return undefined;
}

function findEnclosingComposite(node: PlotNode): PlotNode | undefined {
    let n: PlotNode | undefined = node.parent;
    while (n) {
        if (n.kind === 'composite') return n;
        n = n.parent;
    }
    return undefined;
}

function findEnclosingClause(node: PlotNode): PlotNode | undefined {
    let n: PlotNode | undefined = node.parent;
    while (n) {
        if (n.kind === 'clause') return n;
        if (n.kind === 'plotCall' || n.kind === 'composite' || n.kind === 'script') return undefined;
        n = n.parent;
    }
    return undefined;
}

function findEnclosingList(node: PlotNode): PlotNode | undefined {
    let n: PlotNode | undefined = node.parent;
    while (n) {
        if (n.kind === 'list') return n;
        if (n.kind === 'plotCall' || n.kind === 'composite' || n.kind === 'script') return undefined;
        n = n.parent;
    }
    return undefined;
}

function findEnclosingTail(node: PlotNode): PlotNode | undefined {
    let n: PlotNode | undefined = node.parent;
    while (n) {
        if (n.kind === 'tail') return n;
        if (n.kind === 'plotCall' || n.kind === 'composite' || n.kind === 'script') return undefined;
        n = n.parent;
    }
    return undefined;
}

function findEnclosingLet(node: PlotNode): PlotNode | undefined {
    let n: PlotNode | undefined = node.parent;
    while (n) {
        if (n.kind === 'letStatement') return n;
        n = n.parent;
    }
    return undefined;
}

/**
 * Walk the AST and derive the current cursor completion context.
 */
export function getPlotCursorContext(src: string, cursorPos: number): PlotCursorContext {
    const root = parse(src, { cursorPos });

    // Prefix calculation matches the old behaviour: backtrack from cursor over
    // word chars / quotes.
    const textBefore = src.slice(0, cursorPos);
    const prefixMatch = textBefore.match(/[\w"]*$/);
    const prefix = prefixMatch ? prefixMatch[0].replace(/^"/, '') : '';
    const prefixFrom = cursorPos - (prefixMatch?.[0]?.length ?? 0);

    const none: PlotCursorContext = { kind: 'unknown', prefix, from: prefixFrom, inArray: false };

    // Empty doc → offer plot types.
    if (root.children.length === 0) {
        return { kind: 'plot-type', prefix, from: prefixFrom, inArray: false };
    }

    const cn = findCursorNodeNew(root, cursorPos);
    if (!cn) return none;

    const plotCall = findEnclosingPlotCall(cn);
    const composite = findEnclosingComposite(cn);
    const clause = findEnclosingClause(cn);
    const list = findEnclosingList(cn);
    const tail = findEnclosingTail(cn);
    const letStmt = findEnclosingLet(cn);

    const plotType = plotCall?.shape ? (SHAPE_LC_TO_UC[plotCall.shape] ?? plotCall.shape).toUpperCase() : composite?.direction?.toUpperCase();
    const usedParams = plotCall?.children
        .filter(c => c.kind === 'clause' && c.key)
        .map(c => c.key!) ?? [];

    const inArray = !!list;

    // LET statement contexts
    if (letStmt && !plotCall) {
        // Are we at the @name slot (cursor is on/inside a constRef child that
        // is the first child of letStmt) or at the value?
        const firstChild = letStmt.children[0];
        if (cn === firstChild || (firstChild && cn.from >= firstChild.from && cn.to <= firstChild.to)) {
            return { kind: 'let-name', prefix, from: prefixFrom, inArray: false };
        }
        return { kind: 'let-value', prefix, from: prefixFrom, inArray: false };
    }

    // Tail keyword vs tail value
    if (tail) {
        // If cursor is on the keyword itself (no value child encloses cursor)
        const valChild = tail.children.find(c => c.kind !== 'hole' && c.kind !== 'tailRef');
        if (valChild && cn.from >= valChild.from && cn.to <= valChild.to) {
            return { kind: 'tail-value', plotType, tailKeyword: (tail.keyRaw ?? tail.key)?.toUpperCase(), prefix, from: prefixFrom, inArray };
        }
        return { kind: 'tail-keyword', plotType, prefix, from: prefixFrom, inArray: false };
    }

    // Inside a clause? Position determines name vs value.
    if (clause) {
        // If the cursor falls before the value child or the clause has no value
        // node yet, we're at param-name; else we're at param-value.
        const valNode = clause.children.find(c => c.kind !== 'clauseRef' && (c.kind !== 'hole' || (c.annotations.expectedKinds?.some(k => k !== 'ident'))));
        if (valNode && cn.from >= valNode.from && cn.to <= valNode.to && cn !== clause) {
            return {
                kind: inArray ? 'array-value' : 'param-value',
                plotType,
                paramName: clause.key,
                usedParams,
                prefix,
                from: prefixFrom,
                inArray,
            };
        }
        return {
            kind: 'param-name',
            plotType,
            usedParams,
            prefix,
            from: prefixFrom,
            inArray: false,
        };
    }

    // Inside a plotCall but not in a clause — cursor is on the shape name or
    // between args.
    if (plotCall) {
        // If cursor is on the shape name token itself.
        const shapeStart = plotCall.from;
        const shapeEnd = shapeStart + (plotCall.shapeRaw?.length ?? 0);
        if (cursorPos >= shapeStart && cursorPos <= shapeEnd) {
            return { kind: 'plot-type', plotType, prefix, from: prefixFrom, inArray: false };
        }
        // Between args → expect a param-name
        return {
            kind: 'param-name',
            plotType,
            usedParams,
            prefix,
            from: prefixFrom,
            inArray: false,
        };
    }

    // Inside a composite but outside any plot call → offer plot types.
    if (composite) {
        return { kind: 'plot-type', prefix, from: prefixFrom, inArray: false };
    }

    // Top-level fall-back.
    return { kind: 'plot-type', prefix, from: prefixFrom, inArray: false };
}
