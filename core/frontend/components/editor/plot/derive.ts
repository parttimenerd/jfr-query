// Derive a runtime `ParsedPlotCall` from a parsed plot AST.
//
// The function aims for byte-equivalence with the original `parsePlotCall`
// output. For uppercase plot calls the `mainConfig` field is the original
// source substring of the plotCall up to (but excluding) any tail clauses
// (which matches what `parsePlotCall` does — strip tails and return the
// remaining text trimmed). For lowercase calls the `mainConfig` is a
// reconstructed uppercase form (`line { x: ts }` → `LINE_CHART(x: "ts")`).

import type { PlotNode } from './ast';

export interface ParsedPlotCall {
    mainConfig: string;
    on?: string[];
    width?: string;
    height?: string;
    zoom?: number;
    title?: string;
    linkX?: [string, string];
    linkXMaster?: boolean;
    linkXClamp?: boolean;
    linkY?: string;
    linkXY?: string;
    linkScroll?: string;
    plotName?: string;
    disabled?: boolean;
    composite?: { direction: 'row' | 'col'; children: ParsedPlotCall[] };
}

const LOWERCASE_TO_UC: Record<string, string> = {
    line: 'LINE_CHART',
    bar: 'BAR_CHART',
    scatter: 'SCATTER_PLOT',
    heatmap: 'HEATMAP',
    histogram: 'HISTOGRAM',
    boxplot: 'BOXPLOT',
    pie: 'PIE_CHART',
    flamegraph: 'FLAMEGRAPH',
    table: 'TABLE',
    area: 'AREA_CHART',
    gantt: 'GANTT',
    range: 'RANGE_CHART',
};

/**
 * Derive the runtime config from a parsed script. The script may contain a
 * top-level composite, a top-level plotCall, or be empty (in which case we
 * return an empty mainConfig and the caller falls back).
 */
export function derive(root: PlotNode): ParsedPlotCall {
    // Find the first plotCall or composite child (skipping letStatements).
    for (const child of root.children) {
        if (child.kind === 'plotCall') return derivePlotCall(child);
        if (child.kind === 'composite') return deriveComposite(child);
    }
    // No recognisable plot — fall back to the source text.
    return { mainConfig: root.text };
}

function derivePlotCall(call: PlotNode): ParsedPlotCall {
    const result: ParsedPlotCall = { mainConfig: '' };

    // Build `mainConfig`.
    if (call.form === 'uppercase') {
        // The mainConfig is the original source text of the plotCall, minus
        // any tail children. Find where the first tail child starts and slice
        // up to that point (then trim trailing whitespace).
        const firstTail = call.children.find(c => c.kind === 'tail');
        const endPos = firstTail ? firstTail.from : call.to;
        result.mainConfig = call.text.length > 0
            ? sourceSlice(call, call.from, endPos).trimEnd()
            : '';
    } else {
        // Lowercase form — reconstruct an uppercase representation from the
        // clause list.
        const ucName = LOWERCASE_TO_UC[call.shape ?? ''] ?? (call.shape ?? '').toUpperCase();
        const clauses = call.children.filter(c => c.kind === 'clause');
        const ucClauses: string[] = [];
        for (const cl of clauses) {
            const key = cl.key ?? '';
            // Value is the first child that is *not* the clauseRef nor a hole.
            const valNode = cl.children.find(c => c.kind !== 'clauseRef' && c.kind !== 'hole');
            const uc = valNode ? reprUppercase(valNode) : '';
            ucClauses.push(`${key}: ${uc}`);
        }
        result.mainConfig = `${ucName}(${ucClauses.join(', ')})`;
    }

    // Process tails.
    const tails = call.children.filter(c => c.kind === 'tail');
    applyTails(result, tails);

    return result;
}

function deriveComposite(comp: PlotNode): ParsedPlotCall {
    const result: ParsedPlotCall = { mainConfig: '' };
    const children: ParsedPlotCall[] = [];
    for (const c of comp.children) {
        if (c.kind === 'plotCall') children.push(derivePlotCall(c));
        else if (c.kind === 'composite') children.push(deriveComposite(c));
    }
    result.composite = { direction: comp.direction ?? 'row', children };
    const tails = comp.children.filter(c => c.kind === 'tail');
    applyTails(result, tails);
    return result;
}

/** Slice a node's text — works even when node.from < segment.from. */
function sourceSlice(node: PlotNode, from: number, to: number): string {
    // node.text begins at node.from in source. Reconstruct the relative slice.
    const start = from - node.from;
    const end = to - node.from;
    if (start < 0 || end > node.text.length) {
        // Best-effort fallback — return entire text.
        return node.text;
    }
    return node.text.slice(start, end);
}

/**
 * Produce an uppercase serialization of a value node — used when rebuilding
 * the mainConfig string from a lowercase plot call.
 */
function reprUppercase(node: PlotNode): string {
    switch (node.kind) {
        case 'literal': {
            if (node.literalKind === 'string') return `"${node.literalValue ?? ''}"`;
            if (node.literalKind === 'dimension') return `"${node.literalValue ?? ''}"`;
            if (node.literalKind === 'number') return String(node.literalValue ?? '');
            if (node.literalKind === 'boolean') return String(node.literalValue ?? '');
            if (node.literalKind === 'null') return 'null';
            return node.text;
        }
        case 'ident':
            return `"${node.name ?? ''}"`;
        case 'varRef':
            return node.dollar?.raw ?? node.text;
        case 'constRef':
            return node.text;
        case 'queryRef': {
            const tgt = node.queryIndex !== undefined ? String(node.queryIndex) : (node.queryName ?? '');
            return `"${tgt}"`;
        }
        case 'list': {
            const parts = node.children.map(reprUppercase);
            return `[${parts.join(', ')}]`;
        }
        case 'paren': {
            const inner = node.children.map(reprUppercase).join('');
            return `(${inner})`;
        }
        case 'functionCall': {
            const args = node.children.map(reprUppercase).join(', ');
            return `${node.fnName ?? ''}(${args})`;
        }
        case 'binaryExpr': {
            const left = node.children[0] ? reprUppercase(node.children[0]) : '';
            const right = node.children[1] ? reprUppercase(node.children[1]) : '';
            return `${left} ${node.op} ${right}`;
        }
        case 'unaryExpr': {
            const inner = node.children[0] ? reprUppercase(node.children[0]) : '';
            return `${node.op}${inner}`;
        }
        default:
            return node.text;
    }
}

/** Extract the JS-level value of a value node. */
function jsValue(node: PlotNode): unknown {
    switch (node.kind) {
        case 'literal': {
            if (node.literalKind === 'dimension') return node.literalValue;
            return node.literalValue;
        }
        case 'ident':
            return node.name ?? '';
        case 'varRef':
            return node.dollar?.raw ?? node.text;
        case 'queryRef':
            return node.queryIndex !== undefined ? String(node.queryIndex) : (node.queryName ?? '');
        case 'list':
            return node.children.map(jsValue);
        case 'paren':
            return node.children[0] ? jsValue(node.children[0]) : node.text;
        case 'functionCall':
            return node.text;
        case 'constRef':
            return node.text;
        default:
            return node.text;
    }
}

function applyTails(result: ParsedPlotCall, tails: PlotNode[]): void {
    for (const tail of tails) {
        const key = (tail.key ?? '').toLowerCase();
        // The argument node — first child that isn't a hole or the tailRef keyword span.
        const arg = tail.children.find(c => c.kind !== 'hole' && c.kind !== 'tailRef');
        switch (key) {
            case 'title': {
                if (arg) result.title = String(jsValue(arg));
                break;
            }
            case 'name': {
                if (arg) result.plotName = String(jsValue(arg));
                break;
            }
            case 'zoom': {
                if (arg) {
                    const v = jsValue(arg);
                    result.zoom = typeof v === 'number' ? v : parseFloat(String(v));
                }
                break;
            }
            case 'width': {
                if (arg) result.width = String(jsValue(arg));
                break;
            }
            case 'height': {
                if (arg) result.height = String(jsValue(arg));
                break;
            }
            case 'disabled': {
                result.disabled = true;
                break;
            }
            case 'on': {
                if (arg) {
                    if (arg.kind === 'list') {
                        result.on = arg.children.map(c => String(jsValue(c)));
                    } else {
                        result.on = [String(jsValue(arg))];
                    }
                }
                break;
            }
            case 'link-x':
            case 'linkx':
            case 'link_x': {
                applyLink(result, tail, 'linkX');
                break;
            }
            case 'link-y':
            case 'linky':
            case 'link_y': {
                applyLink(result, tail, 'linkY');
                break;
            }
            case 'link-xy':
            case 'linkxy':
            case 'link_xy': {
                applyLink(result, tail, 'linkXY');
                break;
            }
            case 'link-scroll':
            case 'linkscroll':
            case 'link_scroll': {
                if (arg) {
                    if (arg.kind === 'list' && arg.children.length > 0) {
                        const v = jsValue(arg.children[0]);
                        result.linkScroll = String(v).replace(/^\$/, '');
                    } else {
                        const v = jsValue(arg);
                        result.linkScroll = String(v).replace(/^\$/, '');
                    }
                }
                break;
            }
        }
    }
}

function applyLink(result: ParsedPlotCall, tail: PlotNode, key: 'linkX' | 'linkY' | 'linkXY'): void {
    // Collect args. Tail arg can be a `list` node (LINK_X(...) or [..]) or a
    // single value (less common).
    const arg = tail.children.find(c => c.kind !== 'hole' && c.kind !== 'tailRef');
    const items: unknown[] = [];
    if (!arg) return;
    if (arg.kind === 'list') {
        for (const child of arg.children) items.push(jsValue(child));
    } else {
        items.push(jsValue(arg));
    }
    const vars: string[] = [];
    const opts: string[] = [];
    for (const it of items) {
        if (typeof it === 'string') {
            if (it.startsWith('$')) vars.push(it);
            else opts.push(it);
        }
    }
    if (vars.length >= 2) {
        (result as any)[key] = [vars[0], vars[1]];
        if (key === 'linkX') {
            result.linkXMaster = opts.includes('master');
            result.linkXClamp = opts.includes('clamp');
        }
    } else if (vars.length === 1 && (key === 'linkY' || key === 'linkXY')) {
        (result as any)[key] = vars[0];
    }
}
