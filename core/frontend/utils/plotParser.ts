// Plot configuration language outer-syntax parser.
// Internals use an Ohm.js PEG grammar (plotGrammar.ohm) with a regex-based
// fallback for environments where the grammar file cannot be loaded.

export type LegendPosition = 'right' | 'left' | 'top' | 'bottom' | 'none';

export interface AxisSpec {
    domain?: [number | string, number | string];
    label?: string;
    type?: 'linear' | 'log' | 'time' | 'band';
    format?: string;
}

export interface BrushSpec {
    name: string; // $var
    mode: 'x' | 'y' | 'xy';
}

export interface ParsedPlotCall {
    mainConfig: string; // The function call part, e.g., "LINE_CHART(x: "time")"
    on?: string[]; // Array of query references, e.g., ["1", "my_view"]
    width?: string; // e.g., "100px", "50%"
    height?: string; // e.g., "300px"
    zoom?: number | string; // number or $variable; legacy — kept for back-compat
    zoomX?: number; // horizontal-only scale factor
    title?: string;
    linkX?: [string, string];
    linkXMaster?: boolean;
    linkXClamp?: boolean;
    // Showcase canon clauses (W2)
    legend?: LegendPosition;
    axisX?: AxisSpec;
    axisY?: AxisSpec;
    palette?: string;
    linkY?: string; // $var
    linkXY?: string; // $var
    linkScroll?: string; // group name
    tooltipColumns?: string[];
    onHoverTooltip?: string;
    brush?: BrushSpec;
    /** Second BRUSH variable — set only for CROSSTAB two-var BRUSH syntax. */
    brush2?: string;
    cellName?: string;
    let?: Record<string, string>;
    /**
     * Optional `DATASET <name>` clause: resolves `<name>` against the cell-alias
     * registry. When set and no SQL block backs the plot, the renderer fetches
     * `SELECT * FROM <name>` and uses the result as its data source.
     */
    dataset?: string;
    composite?: {
        direction: 'row' | 'col' | 'overlay';
        children: ParsedPlotCall[];
    };
}

// ---------------------------------------------------------------------------
// Ohm.js PEG grammar — primary parser
// ---------------------------------------------------------------------------
// The grammar source is co-located in plotGrammar.ohm and imported as a raw
// string (Vite's `?raw` suffix) at build time.  In test environments
// (Vitest / Node) we fall back to reading the file from disk.

import { grammar as ohmGrammar, type Semantics } from 'ohm-js';

// Dynamic import of the grammar source.  `?raw` works in Vite; the try/catch
// below handles the Node/Vitest path where `?raw` is not available.
let _grammarSrc: string | null = null;

async function _loadGrammarSrc(): Promise<string> {
    if (_grammarSrc !== null) return _grammarSrc;
    try {
        // Vite (browser + vitest with vite) path
        const mod = await import('./plotGrammar.ohm?raw');
        _grammarSrc = mod.default as string;
    } catch {
        // Node / plain Vitest path — read from disk relative to this file.
        const { readFileSync } = await import('fs');
        const { fileURLToPath } = await import('url');
        const { dirname, join } = await import('path');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        _grammarSrc = readFileSync(join(__dirname, 'plotGrammar.ohm'), 'utf8');
    }
    return _grammarSrc!;
}

// We build the grammar once synchronously after it has been loaded.
let _g: ReturnType<typeof ohmGrammar> | null = null;
let _s: Semantics | null = null;

function _extractStrValue(node: any): string {
    const src = node.sourceString as string;
    return src.slice(1, -1); // strip surrounding quotes
}

function _extractDomainVal(node: any): number | string {
    const src = (node.sourceString as string).trim();
    if (src.startsWith('"') || src.startsWith("'")) return src.slice(1, -1);
    if (src.startsWith('$')) return src; // varRef — keep as-is
    const n = Number(src);
    return isNaN(n) ? src : n;
}

function _buildSemantics(g: ReturnType<typeof ohmGrammar>): Semantics {
    const s = g.createSemantics();

    s.addOperation<void>('toResult(r)', {
        PlotCall(mainContent, clauses, _end) {
            const r = (this.args as any).r as ParsedPlotCall;
            r.mainConfig = (mainContent.sourceString as string).trim();
            (clauses.children as any[]).forEach(c => (c as any).toResult(r));
        },
        Clause(alt) { (alt as any).toResult((this.args as any).r); },
        TitleClause(_kw, str) { (this.args as any).r.title = _extractStrValue(str); },
        ZoomClause_withValue(_kw, val) {
            const src = (val as any).sourceString.trim();
            (this.args as any).r.zoom = src.startsWith('$') ? src : parseFloat(src);
        },
        ZoomClause_bare(_kw) { (this.args as any).r.zoom = 1; },
        ZoomXClause(_kw, num) { (this.args as any).r.zoomX = parseFloat((num as any).sourceString); },
        WidthClause(_kw, sz) { (this.args as any).r.width = (sz as any).sourceString.trim(); },
        HeightClause(_kw, sz) { (this.args as any).r.height = (sz as any).sourceString.trim(); },
        OnHoverTooltipClause(_on, _hover, _tooltip, str) {
            (this.args as any).r.onHoverTooltip = _extractStrValue(str);
        },
        OnClause(_kw, list) {
            (this.args as any).r.on = (list as any).asIteration().children.map(
                (c: any) => (c.sourceString as string).trim(),
            );
        },
        LegendClause_hidden(_kw, _h) { (this.args as any).r.legend = 'none' as LegendPosition; },
        LegendClause_at(_kw, _at, pos) {
            (this.args as any).r.legend = (pos as any).sourceString.toLowerCase() as LegendPosition;
        },
        PaletteClause(_kw, str) { (this.args as any).r.palette = _extractStrValue(str); },
        LinkXClause(_kw, _open, list, _close) {
            const args: string[] = (list as any).asIteration().children.map(
                (c: any) => (c.sourceString as string).trim(),
            );
            const variables = args.filter(a => a.startsWith('$'));
            const options = args.filter(a => !a.startsWith('$'));
            const bareVarLike = options.filter(
                o => /^[A-Za-z_]/.test(o) && !['master', 'clamp'].includes(o.toLowerCase()),
            );
            if (bareVarLike.length > 0) {
                console.warn(
                    `[plotParser] LINK_X: argument(s) "${bareVarLike.join(', ')}" look like variable names but are missing the $ prefix. Did you mean "$${bareVarLike[0]}"?`,
                );
            }
            if (variables.length > 0 && variables.length < 2) {
                console.warn(
                    `[plotParser] LINK_X requires two $variable arguments ($min, $max). Got ${variables.length}. LINK_X ignored.`,
                );
            }
            if (variables.length >= 2) {
                (this.args as any).r.linkX = [variables[0], variables[1]] as [string, string];
                (this.args as any).r.linkXMaster = options.some(o => o.toLowerCase() === 'master') ? true : undefined;
                (this.args as any).r.linkXClamp = options.some(o => o.toLowerCase() === 'clamp');
            }
        },
        LinkYClause(_kw, val) {
            const src = (val as any).sourceString.trim() as string;
            (this.args as any).r.linkY = src.startsWith('"') || src.startsWith("'") ? src.slice(1, -1) : src;
        },
        LinkXYClause(_kw, val) {
            const src = (val as any).sourceString.trim() as string;
            (this.args as any).r.linkXY = src.startsWith('"') || src.startsWith("'") ? src.slice(1, -1) : src;
        },
        LinkScrollClause(_kw, val) {
            const src = (val as any).sourceString.trim() as string;
            (this.args as any).r.linkScroll = src.startsWith('"') || src.startsWith("'") ? src.slice(1, -1) : src;
        },
        TooltipColumnsClause(_tt, _cols, _open, list, _close) {
            (this.args as any).r.tooltipColumns = (list as any).asIteration().children.map(
                (c: any) => _extractStrValue(c),
            );
        },
        BrushTwoVarClause(_kw, var1, var2) {
            const n1 = (var1 as any).sourceString.trim() as string;
            const n2 = (var2 as any).sourceString.trim() as string;
            if (!/^\$[A-Za-z_]\w*$/.test(n1) || !/^\$[A-Za-z_]\w*$/.test(n2)) return;
            (this.args as any).r.brush = { name: n1, mode: 'xy' };
            (this.args as any).r.brush2 = n2;
        },
        BrushClause(_kw, varOrStr, _mode, modeVal) {
            const src = (varOrStr as any).sourceString.trim() as string;
            const name = src.startsWith('"') || src.startsWith("'") ? src.slice(1, -1) : src;
            // Validate: name must match $<letter_or_underscore><word_chars>
            if (!/^\$[A-Za-z_]\w*$/.test(name)) return; // invalid var name — skip
            (this.args as any).r.brush = { name, mode: (modeVal as any).sourceString.toLowerCase() as BrushSpec['mode'] };
        },
        NameClause(_kw, str) { (this.args as any).r.cellName = _extractStrValue(str); },
        DatasetClause(_kw, id) { (this.args as any).r.dataset = (id as any).sourceString; },
        AxisYClause(_kw, subs) {
            const spec: AxisSpec = (this.args as any).r.axisY ?? {};
            (subs.children as any[]).forEach(sub => (sub as any).applyAxisSub(spec));
            (this.args as any).r.axisY = spec;
        },
        AxisXClause(_kw, subs) {
            const spec: AxisSpec = (this.args as any).r.axisX ?? {};
            (subs.children as any[]).forEach(sub => (sub as any).applyAxisSub(spec));
            (this.args as any).r.axisX = spec;
        },
        LetClause(_kw, id, _eq, val) {
            const prev = ((this.args as any).r.let as Record<string, string> | undefined) ?? {};
            (this.args as any).r.let = { ...prev, [(id as any).sourceString]: (val as any).sourceString.trim() };
        },
    });

    s.addOperation<void>('applyAxisSub(spec)', {
        AxisSubClause(alt) { (alt as any).applyAxisSub((this.args as any).spec); },
        DomainSub(_kw, _open, v1, _comma, v2, _close) {
            (this.args as any).spec.domain = [_extractDomainVal(v1), _extractDomainVal(v2)];
        },
        LabelSub(_kw, str) { (this.args as any).spec.label = _extractStrValue(str); },
        TypeSub(_kw, t) { (this.args as any).spec.type = (t as any).sourceString.toLowerCase(); },
        FormatSub(_kw, str) { (this.args as any).spec.format = _extractStrValue(str); },
    });

    return s;
}

// Pre-load the grammar synchronously when the module is first imported.
// In environments where top-level await is not available we use a void IIFE
// so that subsequent calls to `parsePlotCall` will have the grammar ready.
let _initPromise: Promise<void> | null = null;

function _ensureGrammar(): void {
    if (_g !== null) return;
    if (_initPromise !== null) return; // loading in progress
    _initPromise = _loadGrammarSrc().then(src => {
        _g = ohmGrammar(src);
        _s = _buildSemantics(_g);
    });
}

// Kick off the async load immediately at module import time.
_ensureGrammar();

// ---------------------------------------------------------------------------
// Regex-based fallback helpers (kept for the synchronous fast-path and for
// inputs that the Ohm grammar cannot parse — e.g. bare-word mainConfig forms
// that fall outside the grammar).
// ---------------------------------------------------------------------------

// Split a string by `sep` at the top nesting level only (ignores []/()/"" content).
function splitTopLevel(s: string, sep: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let inStr: string | null = null;
    let escaped = false;
    let cur = '';
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (escaped) { cur += c; escaped = false; continue; }
        if (c === '\\' && inStr) { cur += c; escaped = true; continue; }
        if (inStr) { cur += c; if (c === inStr) inStr = null; continue; }
        if (c === '"' || c === "'") { inStr = c; cur += c; continue; }
        if (c === '[' || c === '(' || c === '{') depth++;
        if (c === ']' || c === ')' || c === '}') depth--;
        if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
        cur += c;
    }
    if (cur.length > 0) out.push(cur);
    return out;
}

type ClauseSpec = {
    key: keyof ParsedPlotCall | string;
    regex: RegExp;
    processor: (match: RegExpMatchArray, result: ParsedPlotCall) => any;
    merge?: boolean;
};

const AXIS_SUB_TOKEN = /(?:DOMAIN\s+(\[[^\]]+\])|LABEL\s+(?:"([^"]*)"|'([^']*)')|TYPE\s+(LINEAR|LOG|TIME|BAND)|FORMAT\s+(?:"([^"]*)"|'([^']*)'))/i;

const buildAxisRegex = (axis: 'X' | 'Y') =>
    new RegExp(`(?<!\\w)AXIS[-_]${axis}\\s+((?:(?:DOMAIN\\s+\\[[^\\]]+\\]|LABEL\\s+(?:"[^"]*"|'[^']*')|TYPE\\s+(?:LINEAR|LOG|TIME|BAND)|FORMAT\\s+(?:"[^"]*"|'[^']*'))\\s*)+)$`, 'i');

const applyAxisSubClauses = (existing: AxisSpec, tail: string): AxisSpec => {
    const re = new RegExp(AXIS_SUB_TOKEN.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(tail)) !== null) {
        if (m[1]) { const dom = _parseDomainPair(m[1]); if (dom) existing.domain = dom; }
        else if (m[2] !== undefined || m[3] !== undefined) { existing.label = m[2] ?? m[3]; }
        else if (m[4]) { existing.type = m[4].toLowerCase() as AxisSpec['type']; }
        else if (m[5] !== undefined || m[6] !== undefined) { existing.format = m[5] ?? m[6]; }
    }
    return existing;
};

const _parseDomainPair = (raw: string): [number | string, number | string] | undefined => {
    const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
    const parts = splitTopLevel(inner, ',');
    if (parts.length !== 2) return undefined;
    const parseOne = (p: string): number | string => {
        const t = p.trim();
        const q = t.match(/^(["'])(.*)\1$/);
        if (q) return q[2];
        const n = Number(t);
        return isNaN(n) ? t : n;
    };
    return [parseOne(parts[0]), parseOne(parts[1])];
};

const buildAxisProcessor = (axis: 'axisX' | 'axisY') => (match: RegExpMatchArray, result: ParsedPlotCall) => {
    const existing = (result[axis] as AxisSpec | undefined) ?? {};
    return applyAxisSubClauses(existing, match[1] ?? '');
};

const CLAUSES: ClauseSpec[] = [
    { key: 'title', regex: /(?<!\w)TITLE\s+(?:"([^"]*)"|'([^']*)')\s*$/i, processor: (m) => m[1] ?? m[2] },
    { key: 'zoom', regex: /(?<!\w)ZOOM\s+(\$[A-Za-z_]\w*)\s*$/i, processor: (m) => m[1] },
    { key: 'zoom', regex: /(?<!\w)ZOOM\s+([\d\.]+)\s*$/i, processor: (m) => parseFloat(m[1]) },
    { key: 'zoom', regex: /(?<!\w)ZOOM\s*$/i, processor: () => 1 },
    { key: 'zoomX', regex: /(?<!\w)ZOOM_X\s+([\d\.]+)\s*$/i, processor: (m) => parseFloat(m[1]) },
    { key: 'height', regex: /(?<!\w)HEIGHT\s+(\$[A-Za-z_]\w*)\s*$/i, processor: (m) => m[1] },
    { key: 'height', regex: /(?<!\w)HEIGHT\s+((?:\d+)(?:px|%)?)\s*$/i, processor: (m) => m[1] },
    { key: 'width', regex: /(?<!\w)WIDTH\s+(\$[A-Za-z_]\w*)\s*$/i, processor: (m) => m[1] },
    { key: 'width', regex: /(?<!\w)WIDTH\s+((?:\d+)(?:px|%)?)\s*$/i, processor: (m) => m[1] },
    { key: 'on', regex: /(?<!\w)ON\s+((?:#\d+|\w+|\d+)(?:\s*,\s*(?:#\d+|\w+|\d+))*)\s*$/i, processor: (m) => m[1].split(',').map(s => s.trim()) },
    { key: 'legend', regex: /(?<!\w)LEGEND\s+HIDDEN\s*$/i, processor: () => 'none' as LegendPosition },
    { key: 'legend', regex: /(?<!\w)LEGEND\s+AT\s+(RIGHT|LEFT|TOP|BOTTOM|NONE)\s*$/i, processor: (m) => m[1].toLowerCase() as LegendPosition },
    { key: 'palette', regex: /(?<!\w)PALETTE\s+(?:"([^"]*)"|'([^']*)')\s*$/i, processor: (m) => m[1] ?? m[2] },
    { key: 'linkY', regex: /(?<!\w)LINK[-_]Y\s+(?:"(\$[A-Za-z_][\w]*)"|'(\$[A-Za-z_][\w]*)'|(\$[A-Za-z_][\w]*))\s*$/i, processor: (m) => m[1] ?? m[2] ?? m[3] },
    { key: 'linkXY', regex: /(?<!\w)LINK[-_]XY\s+(?:"(\$[A-Za-z_][\w]*)"|'(\$[A-Za-z_][\w]*)'|(\$[A-Za-z_][\w]*))\s*$/i, processor: (m) => m[1] ?? m[2] ?? m[3] },
    { key: 'linkScroll', regex: /(?<!\w)LINK[_-]SCROLL\s+(?:"([^"]*)"|'([^']*)'|([A-Za-z_][\w]*))\s*$/i, processor: (m) => m[1] ?? m[2] ?? m[3] },
    { key: 'tooltipColumns', regex: /(?<!\w)TOOLTIP\s+COLUMNS\s+\[([^\]]+)\]\s*$/i, processor: (m) => m[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) },
    { key: 'onHoverTooltip', regex: /(?<!\w)ON\s+HOVER\s+TOOLTIP\s+(?:"([^"]*)"|'([^']*)')\s*$/i, processor: (m) => m[1] ?? m[2] },
    { key: 'brush', regex: /(?<!\w)BRUSH\s+(\$[A-Za-z_][\w]*)\s+(\$[A-Za-z_][\w]*)\s*$/i, processor: (m, result): BrushSpec => { (result as any).brush2 = m[2]; return { name: m[1], mode: 'xy' }; } },
    { key: 'brush', regex: /(?<!\w)BRUSH\s+(?:"(\$[A-Za-z_][\w]*)"|'(\$[A-Za-z_][\w]*)'|(\$[A-Za-z_][\w]*))\s+MODE\s+(X|Y|XY)\s*$/i, processor: (m): BrushSpec => ({ name: m[1] ?? m[2] ?? m[3], mode: m[4].toLowerCase() as BrushSpec['mode'] }) },
    { key: 'cellName', regex: /(?<!\w)NAME\s+(?:"([^"]*)"|'([^']*)')\s*$/i, processor: (m) => m[1] ?? m[2] },
    { key: 'dataset', regex: /(?<!\w)DATASET\s+([A-Za-z_][\w.-]*)\s*$/i, processor: (m) => m[1] },
    { key: 'axisX', regex: buildAxisRegex('X'), processor: buildAxisProcessor('axisX'), merge: true },
    { key: 'axisY', regex: buildAxisRegex('Y'), processor: buildAxisProcessor('axisY'), merge: true },
    {
        key: 'let',
        regex: /(?<!\w)LET\s+([A-Za-z_][\w]*)\s*=\s*((?:(?!\sLET\s+[A-Za-z_][\w]*\s*=).)+?)\s*$/i,
        processor: (m, result) => {
            const prev = (result.let as Record<string, string> | undefined) ?? {};
            return { ...prev, [m[1]]: m[2].trim() };
        },
        merge: true,
    },
];

const tryMatchClauses = (remaining: string, result: ParsedPlotCall): { remaining: string; changed: boolean } => {
    for (const clause of CLAUSES) {
        if (!clause.merge && (result as any)[clause.key] !== undefined) continue;
        const match = remaining.match(clause.regex);
        if (match) {
            (result as any)[clause.key] = clause.processor(match, result);
            return { remaining: remaining.substring(0, match.index).trim(), changed: true };
        }
    }
    return { remaining, changed: false };
};

/** Strip a trailing `# comment` from a plot config line, ignoring `#` inside quoted strings. */
function stripTrailingLineComment(s: string): string {
    let inStr: string | null = null;
    let escaped = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
            if (escaped) { escaped = false; continue; }
            if (c === '\\') { escaped = true; continue; }
            if (c === inStr) inStr = null;
            continue;
        }
        if (c === '"' || c === "'") { inStr = c; continue; }
        if (c === '#' && i > 0 && /\s/.test(s[i - 1]) && !/\d/.test(s[i + 1] ?? '')) {
            return s.slice(0, i);
        }
    }
    return s;
}

/** Regex-based implementation (fallback). */
function _parsePlotCallRegex(configLine: string): ParsedPlotCall {
    let remainingConfig = stripTrailingLineComment(configLine).trim();
    const result: ParsedPlotCall = { mainConfig: '' };

    let changedInLoop = true;
    while (changedInLoop) {
        const r = tryMatchClauses(remainingConfig, result);
        remainingConfig = r.remaining;
        changedInLoop = r.changed;
    }

    const linkXMatch = remainingConfig.match(/(?<!\w)LINK[-_]X\s*\(([^)]+)\)\s*$/i);
    if (linkXMatch) {
        const linkArgs = linkXMatch[1].split(',').map(s => s.trim()).filter(Boolean);
        const variables = linkArgs.filter(arg => arg.startsWith('$'));
        const options = linkArgs.filter(arg => !arg.startsWith('$'));
        const bareVarLike = options.filter(o => /^[A-Za-z_]/.test(o) && !['master', 'clamp'].includes(o.toLowerCase()));
        if (bareVarLike.length > 0) {
            console.warn(`[plotParser] LINK_X: argument(s) "${bareVarLike.join(', ')}" look like variable names but are missing the $ prefix. Did you mean "$${bareVarLike[0]}"?`);
        }
        remainingConfig = remainingConfig.substring(0, linkXMatch.index).trim();
        if (variables.length > 0 && variables.length < 2) {
            console.warn(`[plotParser] LINK_X requires two $variable arguments ($min, $max). Got ${variables.length}: "${linkXMatch[1]}". LINK_X ignored.`);
        }
        if (variables.length >= 2) {
            result.linkX = [variables[0], variables[1]];
            result.linkXMaster = options.some(o => o.toLowerCase() === 'master') ? true : undefined;
            result.linkXClamp = options.some(o => o.toLowerCase() === 'clamp');
        }
    }

    changedInLoop = true;
    while (changedInLoop) {
        const r = tryMatchClauses(remainingConfig, result);
        remainingConfig = r.remaining;
        changedInLoop = r.changed;
    }

    result.mainConfig = remainingConfig;
    return result;
}

/**
 * Parses a single plot configuration line to separate the main function call
 * from advanced clauses. Robust to clause order.
 *
 * Uses the Ohm.js PEG grammar when available; falls back to the regex-based
 * implementation for inputs the grammar cannot handle.
 */
export const parsePlotCall = (configLine: string): ParsedPlotCall => {
    // B-157: strip trailing `# comment` (quote-aware).
    const cleaned = stripTrailingLineComment(configLine).trim();

    // Try Ohm grammar if it has been initialised.
    if (_g !== null && _s !== null) {
        const matchResult = _g.match(cleaned);
        if (matchResult.succeeded()) {
            const result: ParsedPlotCall = { mainConfig: '' };
            (_s(matchResult) as any).toResult(result);
            return result;
        }
        // Grammar failed — fall through to regex fallback.
    }

    return _parsePlotCallRegex(cleaned);
};

// W10 — Composition parsing.
//
// Three composite shapes are recognized:
//   1. Overlay:  A + B + C            (same x-axis, stacked visually)
//   2. Row:      ROW(A, B, C)         (horizontal flex)
//   3. Col:      COL(A, B, C)         (vertical flex)
//
// `parseComposite()` is the top-level entry point. It returns either a
// single ParsedPlotCall (no composition) or a ParsedPlotCall whose
// `composite` field is set with a `direction` and `children` list. Children
// are themselves recursively parsed so `COL(ROW(A, B), C)` works.

const COMPOSITE_RE = /^(ROW|COL)\s*\(([\s\S]*)\)\s*$/i;

/**
 * Split a config line on a top-level operator (single character) that does not
 * appear inside a balanced paren/bracket/brace group or a string literal.
 *
 * Used to split `A + B + C` overlay expressions into parts.
 */
function splitTopLevelOp(s: string, op: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let inStr: string | null = null;
    let escaped = false;
    let cur = '';
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (escaped) {
            cur += c;
            escaped = false;
            continue;
        }
        if (c === '\\' && inStr) {
            cur += c;
            escaped = true;
            continue;
        }
        if (inStr) {
            cur += c;
            if (c === inStr) inStr = null;
            continue;
        }
        if (c === '"' || c === "'") { inStr = c; cur += c; continue; }
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth--;
        if (c === op && depth === 0) {
            out.push(cur);
            cur = '';
            continue;
        }
        cur += c;
    }
    if (cur.length > 0) out.push(cur);
    return out;
}

/**
 * Parse a composite plot configuration. Falls back to `parsePlotCall` for
 * non-composite inputs so callers can use this as a drop-in upgrade.
 */
export function parseComposite(configLine: string): ParsedPlotCall {
    const trimmed = configLine.trim();

    // Layout pseudo-plots: ROW(...)/COL(...). Detect BEFORE the `+` split so
    // an outer `ROW(A + B, C)` parses correctly (the inner `+` lives inside
    // the body and is recursively handled when we parse each child).
    const layoutMatch = trimmed.match(COMPOSITE_RE);
    if (layoutMatch) {
        const direction = layoutMatch[1].toLowerCase() as 'row' | 'col';
        const childParts = splitTopLevelOp(layoutMatch[2], ',')
            .map(p => p.trim())
            .filter(Boolean);
        const children = childParts.map(p => parseComposite(p));
        return { mainConfig: '', composite: { direction, children } };
    }

    // Overlay: split on top-level `+`. If only one piece, no composition.
    const overlayParts = splitTopLevelOp(trimmed, '+').map(p => p.trim()).filter(Boolean);
    if (overlayParts.length > 1) {
        const children = overlayParts.map(p => parseComposite(p));
        return { mainConfig: '', composite: { direction: 'overlay', children } };
    }

    // Single child — delegate to the existing single-call parser.
    const result = parsePlotCall(trimmed);

    // After parsePlotCall strips trailing clauses (TITLE, WIDTH, etc.), the
    // mainConfig may itself be a ROW/COL composite. Re-check and expand so
    // that `ROW(A, B) TITLE "x"` is treated as a composite, not an unknown leaf.
    const innerMatch = result.mainConfig?.trim().match(COMPOSITE_RE);
    if (innerMatch) {
        const direction = innerMatch[1].toLowerCase() as 'row' | 'col';
        const childParts = splitTopLevelOp(innerMatch[2], ',')
            .map(p => p.trim())
            .filter(Boolean);
        const children = childParts.map(p => parseComposite(p));
        return { ...result, mainConfig: '', composite: { direction, children } };
    }

    return result;
}

// Plot types whose x-axis is categorical (band/discrete).
const CATEGORICAL_X_PLOTS = new Set(['BAR_CHART', 'BOX_PLOT', 'PIE_CHART', 'HEATMAP', 'TABLE', 'FLAMEGRAPH']);

const extractXParam = (mainConfig: string): string | undefined => {
    // Best-effort: pull the value of `x:` from the body. Accepts quoted or bare identifier.
    const m = mainConfig.match(/(?:^|[(,\s])x\s*:\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))/i);
    if (!m) return undefined;
    return m[1] ?? m[2] ?? m[3];
};

const extractTypeName = (mainConfig: string): string | undefined => {
    const m = mainConfig.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
    return m?.[1]?.toUpperCase();
};

export interface CompositeValidationIssue {
    severity: 'error' | 'warn';
    message: string;
}

/**
 * Validate a composite plot configuration. Returns a list of issues.
 * Empty list = valid.
 *
 * Rules (W14):
 *  - `+` overlay children must share x-axis semantics:
 *    - categorical (BAR/BOX/PIE/HEATMAP) cannot overlay with continuous (LINE/AREA/SCATTER/RANGE) → error.
 *    - all children must share the same `x` column name; soft-warn if same type but different name.
 *  - ROW/COL children are independent; no x-axis constraint.
 */
export function validateComposite(parsed: ParsedPlotCall): CompositeValidationIssue[] {
    const issues: CompositeValidationIssue[] = [];
    if (!parsed.composite) return issues;

    if (parsed.composite.direction === 'overlay') {
        const childTypes = parsed.composite.children.map(c => extractTypeName(c.mainConfig) ?? '');
        const xCols = parsed.composite.children.map(c => extractXParam(c.mainConfig));
        const hasCategorical = childTypes.some(t => CATEGORICAL_X_PLOTS.has(t));
        const hasContinuous = childTypes.some(t => t && !CATEGORICAL_X_PLOTS.has(t));
        if (hasCategorical && hasContinuous) {
            issues.push({
                severity: 'error',
                message: `"+" overlay: cannot mix categorical x (${childTypes.filter(t => CATEGORICAL_X_PLOTS.has(t)).join(', ')}) with continuous x (${childTypes.filter(t => t && !CATEGORICAL_X_PLOTS.has(t)).join(', ')}).`,
            });
        }
        const definedX = xCols.filter((x): x is string => !!x);
        if (definedX.length >= 2) {
            const unique = Array.from(new Set(definedX));
            if (unique.length > 1) {
                issues.push({
                    severity: 'warn',
                    message: `"+" overlay: child x columns differ (${unique.join(' vs ')}); using "${unique[0]}" from the first child.`,
                });
            }
        }

        // B-154: warn if LINK_X variable pairs differ across overlay children.
        const linkXPairs = parsed.composite.children
            .map(c => c.linkX)
            .filter((lx): lx is [string, string] => !!lx);
        if (linkXPairs.length >= 2) {
            const key = (pair: [string, string]) => pair.join(',');
            const uniquePairs = Array.from(new Set(linkXPairs.map(key)));
            if (uniquePairs.length > 1) {
                issues.push({
                    severity: 'warn',
                    message: `"+" overlay: LINK_X variable pairs differ (${uniquePairs.join(' vs ')}); charts will pan independently.`,
                });
            }
        }
    }

    // Recurse into children for nested composites.
    for (const child of parsed.composite.children) {
        issues.push(...validateComposite(child));
    }
    return issues;
}
