// A simple but robust parser for the plot configuration language's outer syntax.

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
    zoom?: number; // legacy — kept for back-compat; not in showcase
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

// Helper: parse a `[a, b]` numeric-or-quoted-date pair.
const parseDomainPair = (raw: string): [number | string, number | string] | undefined => {
    const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
    const parts = splitTopLevel(inner, ',');
    if (parts.length !== 2) return undefined;
    const parseOne = (p: string): number | string => {
        const t = p.trim();
        const q = t.match(/^["'](.+)["']$/);
        if (q) return q[1];
        const n = Number(t);
        return isNaN(n) ? t : n;
    };
    return [parseOne(parts[0]), parseOne(parts[1])];
};

// Split a string by `sep` at the top nesting level only (ignores []/()/"" content).
function splitTopLevel(s: string, sep: string): string[] {
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
        if (c === '"' || c === "'") {
            inStr = c;
            cur += c;
            continue;
        }
        if (c === '[' || c === '(' || c === '{') depth++;
        if (c === ']' || c === ')' || c === '}') depth--;
        if (c === sep && depth === 0) {
            out.push(cur);
            cur = '';
            continue;
        }
        cur += c;
    }
    if (cur.length > 0 || out.length > 0) out.push(cur);
    return out;
}

type ClauseSpec = {
    key: keyof ParsedPlotCall | string;
    regex: RegExp;
    processor: (match: RegExpMatchArray, result: ParsedPlotCall) => any;
    // When true, the clause merges into the existing field instead of being skipped on second hit.
    merge?: boolean;
};

const AXIS_SUB = /(DOMAIN\s+(\[[^\]]+\])|LABEL\s+(?:"([^"]*)"|'([^']*)')|TYPE\s+(LINEAR|LOG|TIME|BAND)|FORMAT\s+(?:"([^"]*)"|'([^']*)'))/i;

const buildAxisProcessor = (axis: 'axisX' | 'axisY') => (match: RegExpMatchArray, result: ParsedPlotCall) => {
    // match[2] = DOMAIN bracketed expr, [3]/[4] = LABEL strings,
    // [5] = TYPE keyword, [6]/[7] = FORMAT strings.
    const existing = (result[axis] as AxisSpec | undefined) ?? {};
    if (match[2]) {
        const dom = parseDomainPair(match[2]);
        if (dom) existing.domain = dom;
    } else if (match[3] !== undefined || match[4] !== undefined) {
        existing.label = match[3] ?? match[4];
    } else if (match[5]) {
        existing.type = match[5].toLowerCase() as AxisSpec['type'];
    } else if (match[6] !== undefined || match[7] !== undefined) {
        existing.format = match[6] ?? match[7];
    }
    return existing;
};

// Regexes are anchored to the end of the string to be matched and stripped safely.
// Order matters within one pass — but the outer loop runs to fixpoint so any order
// converges. We list more-specific patterns first to reduce wasted iterations.
const CLAUSES: ClauseSpec[] = [
    // Legacy clauses (kept verbatim, /i for case-insensitivity per W12)
    { key: 'title', regex: /(?<!\w)TITLE\s+(?:"([^"]*)"|'([^']*)')\s*$/i, processor: (m) => m[1] ?? m[2] },
    { key: 'zoom', regex: /(?<!\w)ZOOM\s+([\d\.]+)\s*$/i, processor: (m) => parseFloat(m[1]) },
    { key: 'height', regex: /(?<!\w)HEIGHT\s+((?:\d+)(?:px|%)?)\s*$/i, processor: (m) => m[1] },
    { key: 'width', regex: /(?<!\w)WIDTH\s+((?:\d+)(?:px|%)?)\s*$/i, processor: (m) => m[1] },
    { key: 'on', regex: /(?<!\w)ON\s+((?:#\d+|\w+|\d+)(?:\s*,\s*(?:#\d+|\w+|\d+))*)\s*$/i, processor: (m) => m[1].split(',').map(s => s.trim()) },
    // Showcase canon clauses (W2)
    { key: 'legend', regex: /(?<!\w)LEGEND\s+HIDDEN\s*$/i, processor: () => 'none' as LegendPosition },
    { key: 'legend', regex: /(?<!\w)LEGEND\s+AT\s+(RIGHT|LEFT|TOP|BOTTOM|NONE)\s*$/i, processor: (m) => m[1].toLowerCase() as LegendPosition },
    { key: 'palette', regex: /(?<!\w)PALETTE\s+(?:"([^"]*)"|'([^']*)')\s*$/i, processor: (m) => m[1] ?? m[2] },
    { key: 'linkY', regex: /(?<!\w)LINK-Y\s+(?:"(\$[A-Za-z_][\w]*)"|'(\$[A-Za-z_][\w]*)'|(\$[A-Za-z_][\w]*))\s*$/i, processor: (m) => m[1] ?? m[2] ?? m[3] },
    { key: 'linkXY', regex: /(?<!\w)LINK-XY\s+(?:"(\$[A-Za-z_][\w]*)"|'(\$[A-Za-z_][\w]*)'|(\$[A-Za-z_][\w]*))\s*$/i, processor: (m) => m[1] ?? m[2] ?? m[3] },
    { key: 'linkScroll', regex: /(?<!\w)LINK[_-]SCROLL\s+(?:"([^"]*)"|'([^']*)'|([A-Za-z_][\w]*))\s*$/i, processor: (m) => m[1] ?? m[2] ?? m[3] },
    { key: 'tooltipColumns', regex: /(?<!\w)TOOLTIP\s+COLUMNS\s+\[([^\]]+)\]\s*$/i, processor: (m) => m[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) },
    { key: 'onHoverTooltip', regex: /(?<!\w)ON\s+HOVER\s+TOOLTIP\s+(?:"([^"]*)"|'([^']*)')\s*$/i, processor: (m) => m[1] ?? m[2] },
    { key: 'brush', regex: /(?<!\w)BRUSH\s+(?:"(\$[A-Za-z_][\w]*)"|'(\$[A-Za-z_][\w]*)')\s+MODE\s+(X|Y|XY)\s*$/i, processor: (m): BrushSpec => ({ name: m[1] ?? m[2], mode: m[3].toLowerCase() as BrushSpec['mode'] }) },
    { key: 'cellName', regex: /(?<!\w)NAME\s+(?:"([^"]*)"|'([^']*)')\s*$/i, processor: (m) => m[1] ?? m[2] },
    // DATASET <name> — references a cell alias view by name (bare or qualified).
    { key: 'dataset', regex: /(?<!\w)DATASET\s+([A-Za-z_][\w.-]*)\s*$/i, processor: (m) => m[1] },
    // AXIS-X / AXIS-Y — sub-clauses (DOMAIN, LABEL, TYPE, FORMAT) merge into the same axisX/axisY object.
    { key: 'axisX', regex: new RegExp(`(?<!\\w)AXIS-X\\s+${AXIS_SUB.source}\\s*$`, 'i'), processor: buildAxisProcessor('axisX'), merge: true },
    { key: 'axisY', regex: new RegExp(`(?<!\\w)AXIS-Y\\s+${AXIS_SUB.source}\\s*$`, 'i'), processor: buildAxisProcessor('axisY'), merge: true },
    // LET — multiple LETs stack into a single record. Right-hand-side is a non-greedy expression captured up to end-of-string.
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
        // Skip if this clause has already been captured AND it isn't a merge-style clause.
        if (!clause.merge && (result as any)[clause.key] !== undefined) continue;
        const match = remaining.match(clause.regex);
        if (match) {
            (result as any)[clause.key] = clause.processor(match, result);
            return { remaining: remaining.substring(0, match.index).trim(), changed: true };
        }
    }
    return { remaining, changed: false };
};

/**
 * Parses a single plot configuration line to separate the main function call
 * from advanced clauses. Robust to clause order.
 */
export const parsePlotCall = (configLine: string): ParsedPlotCall => {
    // B-157: strip trailing `# comment` from the end of the config line so that
    // e.g. `LINE_CHART(…) LINK_X($a, $b) # interactive zoom` parses correctly.
    // Only strips when `#` is preceded by whitespace (not `#\d+` query-index refs
    // like those used in `ON #1`).
    let remainingConfig = configLine.replace(/\s+#(?!\d)\S*.*$/, '').trim();
    const result: ParsedPlotCall = { mainConfig: '' };

    // Repeatedly try to match and strip clauses from the end until no more can be found.
    let changedInLoop = true;
    while (changedInLoop) {
        const r = tryMatchClauses(remainingConfig, result);
        remainingConfig = r.remaining;
        changedInLoop = r.changed;
    }

    // LINK_X has a paren-arg shape, so it doesn't fit the trailing-clause loop above.
    const linkXMatch = remainingConfig.match(/(?<!\w)LINK_X\s*\(([^)]+)\)\s*$/i);
    if (linkXMatch) {
        const linkArgs = linkXMatch[1].split(',').map(s => s.trim()).filter(Boolean);
        const variables = linkArgs.filter(arg => arg.startsWith('$'));
        const options = linkArgs.filter(arg => !arg.startsWith('$'));
        // Warn if args look like variable names but are missing the $ prefix.
        const bareVarLike = options.filter(o => /^[A-Za-z_]/.test(o) && !['master', 'clamp'].includes(o.toLowerCase()));
        if (bareVarLike.length > 0) {
            console.warn(`[plotParser] LINK_X: argument(s) "${bareVarLike.join(', ')}" look like variable names but are missing the $ prefix. Did you mean "$${bareVarLike[0]}"?`);
        }
        remainingConfig = remainingConfig.substring(0, linkXMatch.index).trim();
        if (variables.length >= 2) {
            result.linkX = [variables[0], variables[1]];
            result.linkXMaster = options.includes('master');
            result.linkXClamp = options.includes('clamp');
        }
    }

    // Re-run the clause loop in case WIDTH/HEIGHT or new-clause forms were blocked
    // behind a trailing LINK_X(...) that we just stripped.
    changedInLoop = true;
    while (changedInLoop) {
        const r = tryMatchClauses(remainingConfig, result);
        remainingConfig = r.remaining;
        changedInLoop = r.changed;
    }

    result.mainConfig = remainingConfig;
    return result;
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
    if (cur.length > 0 || out.length > 0) out.push(cur);
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
    return parsePlotCall(trimmed);
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
