import type { ResultColumn } from './contextBuilder';

const DSL_KEYWORDS = new Set([
    'LINE_CHART', 'BAR_CHART', 'AREA_CHART', 'SCATTER_PLOT', 'PIE_CHART',
    'BOX_PLOT', 'HISTOGRAM', 'HEATMAP', 'FLAMEGRAPH', 'GANTT', 'RANGE', 'TABLE',
    'line', 'bar', 'area', 'scatter', 'pie', 'box', 'hist', 'heatmap',
    'flame', 'gantt', 'range', 'table',
    'TITLE', 'NAME', 'WIDTH', 'HEIGHT', 'ZOOM', 'ZOOM_X', 'DISABLED',
    'ON', 'LINK_X', 'LINK_Y', 'LINK_XY', 'LINK_SCROLL', 'LET',
    'LEGEND', 'PALETTE', 'BRUSH', 'AXIS_X', 'AXIS_Y', 'TOOLTIP', 'DATASET',
    'MODE', 'TYPE', 'FORMAT', 'LABEL', 'DOMAIN', 'HIDDEN', 'AT',
    'LINEAR', 'LOG', 'TIME', 'BAND', 'COLUMNS', 'HOVER',
    'x', 'y', 'color', 'size', 'name', 'value', 'label', 'fill',
    'stack', 'group', 'bin', 'bins', 'row', 'col',
    'master', 'clamp', 'percent', 'horizontal', 'vertical',
    'true', 'false', 'null',
]);

/**
 * Extract quoted strings that appear as parameter values inside the shape
 * function call's parentheses only (e.g. `x: "col"` inside `LINE_CHART(...)`).
 * Quoted strings outside the parens (e.g. TITLE "foo") are free-text values
 * and should not be treated as column references.
 */
function extractParamQuotedStrings(s: string): string[] {
    // Find the first '(' and its matching ')' — these bound the parameter list.
    const open = s.indexOf('(');
    if (open === -1) return [];
    let depth = 0;
    let close = -1;
    for (let i = open; i < s.length; i++) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')') {
            depth--;
            if (depth === 0) { close = i; break; }
        }
    }
    const inner = close === -1 ? s.slice(open + 1) : s.slice(open + 1, close);

    const out: string[] = [];
    const re = /"([^"\\]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(inner)) !== null) {
        out.push(m[1]);
    }
    return out;
}

/**
 * Returns `suggestion` unchanged if it passes column validation, or `''` if
 * any quoted string value inside the shape's parameter list looks like a column
 * reference that isn't in `schema`.
 * Passes through unconditionally when schema is null or empty.
 */
export function filterSuggestionBySchema(
    suggestion: string,
    schema: ResultColumn[] | null | undefined,
): string {
    if (!schema || schema.length === 0) return suggestion;
    const knownColumns = new Set(schema.map(c => c.name.toLowerCase()));
    const quoted = extractParamQuotedStrings(suggestion);
    for (const token of quoted) {
        const lower = token.toLowerCase();
        if (DSL_KEYWORDS.has(lower) || DSL_KEYWORDS.has(token)) continue;
        if (/^[a-z_][a-z0-9_]*$/i.test(token) && !knownColumns.has(lower)) {
            return '';
        }
    }
    return suggestion;
}
