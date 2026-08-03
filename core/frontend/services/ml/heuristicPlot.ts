import { classifyColumns, looksLikeStartName, looksLikeEndName, looksLikeRangeBound, type ColumnInfo } from './classifyColumns';

/** Approximate the distinct value count for `colName` from the sample rows.
 *  When the sample is empty we conservatively assume the value is unknown and
 *  return `null` so callers can fall back to safe defaults. */
function distinctCount(sample: any[], colName: string): number | null {
    if (!sample || sample.length === 0) return null;
    const seen = new Set<unknown>();
    for (const row of sample) {
        seen.add(row?.[colName]);
        if (seen.size > 64) return seen.size; // bail early on high-card columns
    }
    return seen.size;
}

// Names that suggest accumulative / part-of-a-whole data (safe to stack).
// Matches anywhere in the column name (camelCase-aware via case-insensitive).
const STACKED_NAMES_RE = /pct|percent|share|portion|fraction|alloc|heap|eden|survivor|metaspace|reserved|committed|used|free|available/i;

// Names that suggest the column is an aggregate/summary scalar rather than
// a raw per-event measurement. Single columns matching these fall through to TABLE.
const AGGREGATE_NAMES_RE = /^(count|total|sum|avg|average|mean|median|mode|n|num|number|frequency|occurrences?|events?|hits?|samples?)$/i;

/**
 * Returns true when the numeric columns look like they sum to a meaningful
 * whole (e.g. memory regions, allocation percentages) and stacking them makes
 * sense. Returns false for independent metric series (cpu, gc, latency, …).
 */
function looksLikeStackedSeries(numerics: ColumnInfo[]): boolean {
    return numerics.every(n => STACKED_NAMES_RE.test(n.name));
}

/**
 * Last-resort plot suggester. Produces a plot config string in the syntax that
 * the plot registry actually parses — see components/plots/*.{ts,tsx} for the
 * canonical param names. Getting these wrong silently breaks rendering, so the
 * output is constrained to known plot names and parameter shapes.
 *
 * The heuristic ladder, in priority order:
 *   1. Empty cols → TABLE().
 *   2. Single scalar (one numeric, nothing else) → TABLE().
 *   3. Two time-like cols (start*+end*) + 1+ categories → GANTT.
 *   4. 1 category + 2 numerics with min/max-like names → RANGE.
 *   5. Time + 3+ numerics with stacked-looking names → AREA_CHART (stacked).
 *      Time + 3+ independent numeric series → LINE_CHART.
 *   6. Time + numeric(s) → LINE_CHART(x:time, y:[numerics]).
 *   7. Single category + numeric(s):
 *        cardinality ≤ 32 → BAR_CHART(x:cat, y:[numerics])
 *        cardinality > 32 → TABLE() (bar of 100+ bars is unreadable).
 *   8. Two numerics, no time/cat → SCATTER_PLOT(x:, y:).
 *   9. Single numeric, no time/cat → HISTOGRAM(x:).
 *  10. Many numerics, no time/cat → HISTOGRAM of first numeric.
 *  11. Fallback → TABLE().
 */
export function heuristicPlot(
    columns: { name: string; type: string }[],
    sample: any[],
): string {
    if (columns.length === 0) return 'TABLE()';

    const roles: ColumnInfo[] = classifyColumns(columns, sample);
    const time = roles.find(r => r.role === 'time');
    const numerics = roles.filter(r => r.role === 'numeric');
    const cats = roles.filter(r => r.role === 'category');

    // Single scalar value → table only when the column name suggests an aggregate (count, total, sum…)
    // or when sample has exactly 1 row. Single raw-measurement columns (pauseMs, duration…) → HISTOGRAM.
    if (roles.length === 1 && numerics.length === 1) {
        const isAggregate = AGGREGATE_NAMES_RE.test(numerics[0].name) || sample.length === 1;
        if (isAggregate) return 'TABLE()';
    }

    // GANTT — require BOTH start* AND end* (conservative; per plan risk matrix
    // we never emit GANTT on a single time column).
    // Also check numeric columns: BIGINT timestamps (epoch-ns) are numeric-typed by
    // classifyColumns but can have start/end-style names.
    const timeRoles = roles.filter(r => r.role === 'time');
    const startCol = [...timeRoles, ...numerics].find(r => looksLikeStartName(r.name));
    const endCol = [...timeRoles, ...numerics].find(r => looksLikeEndName(r.name));
    if (startCol && endCol && startCol.name !== endCol.name && cats.length >= 1) {
        const lane = cats[0].name;
        const task = cats.length > 1 ? cats[1].name : undefined;
        const taskPart = task ? `, task: "${task}"` : '';
        return `GANTT(start: "${startCol.name}", end: "${endCol.name}", lane: "${lane}"${taskPart})`;
    }

    // RANGE — 1 category (or time) + exactly 2 numerics with min/max-like names.
    // Allow time column as x so `bucket (time) + p25 + p75` also works.
    const rangeX = cats[0] ?? time;
    const rangeNumerics = cats.length === 1 ? numerics : (time && cats.length === 0 ? numerics : []);
    if (rangeX && rangeNumerics.length === 2) {
        const a = looksLikeRangeBound(rangeNumerics[0].name);
        const b = looksLikeRangeBound(rangeNumerics[1].name);
        if (a && b && a !== b) {
            const low = a === 'low' ? rangeNumerics[0] : rangeNumerics[1];
            const high = a === 'high' ? rangeNumerics[0] : rangeNumerics[1];
            return `RANGE(x: "${rangeX.name}", low: "${low.name}", high: "${high.name}")`;
        }
    }

    // AREA_CHART — time + 3+ numerics AND the column names suggest accumulative
    // or stacked data (e.g., they all sum to a meaningful whole).
    // For independent metric series (cpu, heap, gc, …) LINE_CHART is safer.
    if (time && numerics.length >= 3 && looksLikeStackedSeries(numerics)) {
        const yCols = numerics.map(n => `"${n.name}"`).join(', ');
        return `AREA_CHART(x: "${time.name}", y: [${yCols}], layout: "stacked")`;
    }

    // Time + numerics → line chart  (LINE_CHART(x:, y:[]))
    if (time && numerics.length >= 1) {
        const yCols = numerics.map(n => `"${n.name}"`).join(', ');
        return `LINE_CHART(x: "${time.name}", y: [${yCols}])`;
    }

    // Single category + single numeric → bar or table depending on cardinality.
    if (cats.length === 1 && numerics.length === 1) {
        const card = distinctCount(sample, cats[0].name);
        // High-cardinality or empty-sample bar charts are unreadable; switch to table.
        if (card === null || card > 32) return 'TABLE()';
        return `BAR_CHART(x: "${cats[0].name}", y: ["${numerics[0].name}"])`;
    }

    // Category + multiple numerics → grouped bar
    if (cats.length === 1 && numerics.length > 1) {
        const card = distinctCount(sample, cats[0].name);
        if (card === null || card > 32) return 'TABLE()';
        const yCols = numerics.map(n => `"${n.name}"`).join(', ');
        return `BAR_CHART(x: "${cats[0].name}", y: [${yCols}])`;
    }

    // Two numerics (no time, no category) → scatter  (SCATTER_PLOT(x:, y:))
    if (cats.length === 0 && numerics.length === 2 && !time) {
        return `SCATTER_PLOT(x: "${numerics[0].name}", y: "${numerics[1].name}")`;
    }

    // One numeric, no time, no category → histogram  (HISTOGRAM(x:))
    if (numerics.length === 1 && cats.length === 0 && !time) {
        return `HISTOGRAM(x: "${numerics[0].name}")`;
    }

    // Multiple numerics, no time, no category → histogram of first
    if (numerics.length > 1 && cats.length === 0 && !time) {
        return `HISTOGRAM(x: "${numerics[0].name}")`;
    }

    return 'TABLE()';
}
