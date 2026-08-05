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

// Column names that suggest a percentage or ratio (0-100 range typically).
const PERCENT_NAMES_RE = /pct|percent|ratio|overhead|utilization|usage/i;

// Column names that represent duration/latency in ms.
const DURATION_MS_NAMES_RE = /pause|duration|latency|elapsed|wait|delay|ms$/i;

// Names that suggest an item label / description (good for big-number label param).
const LABEL_NAMES_RE = /^(label|name|title|description|desc|message|text|key)$/i;

/**
 * Returns true when the numeric columns look like they sum to a meaningful
 * whole (e.g. memory regions, allocation percentages) and stacking them makes
 * sense. Returns false for independent metric series (cpu, gc, latency, …).
 */
function looksLikeStackedSeries(numerics: ColumnInfo[]): boolean {
    return numerics.every(n => STACKED_NAMES_RE.test(n.name));
}

/** Returns the average string length of a category column from sample rows. */
function avgCategoryLength(sample: any[], colName: string): number {
    if (!sample || sample.length === 0) return 0;
    let total = 0;
    let count = 0;
    for (const row of sample) {
        const v = row?.[colName];
        if (typeof v === 'string') { total += v.length; count++; }
        if (count >= 20) break;
    }
    return count > 0 ? total / count : 0;
}

/**
 * Last-resort plot suggester. Produces a plot config string in the syntax that
 * the plot registry actually parses — see components/plots/*.{ts,tsx} for the
 * canonical param names. Getting these wrong silently breaks rendering, so the
 * output is constrained to known plot names and parameter shapes.
 *
 * The heuristic ladder, in priority order:
 *   1. Empty cols → TABLE().
 *   2. Single scalar aggregate (count, total…) → BIG_NUMBER.
 *   3. Two time-like cols (start*+end*) + 1+ categories → GANTT.
 *   4. 1 category + 2 numerics with min/max-like names → RANGE.
 *   5. Time + 3+ numerics with stacked-looking names → AREA_CHART (stacked).
 *      Time + 3+ independent numeric series → LINE_CHART.
 *   6. Time + numeric(s) → LINE_CHART(x:time, y:[numerics]).
 *   7. Single category + 1 numeric:
 *        cardinality ≤ 6 → PIE_CHART (part-of-whole feel)
 *        cardinality 7-32 → BAR_CHART (horizontal if names are long)
 *        cardinality > 32 → TABLE()
 *   8. Single category + multiple numerics:
 *        cardinality ≤ 32 → BAR_CHART (horizontal for long names)
 *        cardinality > 32 → TABLE()
 *   9. Two numerics, no time/cat → SCATTER_PLOT(x:, y:).
 *  10. Single numeric, no time/cat → HISTOGRAM(x:).
 *  11. Many numerics, no time/cat → HISTOGRAM of first numeric.
 *  12. Fallback → TABLE().
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

    // BIG_NUMBER — single aggregate scalar value (count, total, avg, etc.)
    // Also applies to a numeric + a label/description column when sample=1 row (summary result).
    if (roles.length === 1 && numerics.length === 1) {
        const isAggregate = AGGREGATE_NAMES_RE.test(numerics[0].name) || sample.length === 1;
        if (isAggregate) {
            const title = numerics[0].name.replace(/_/g, ' ');
            return `BIG_NUMBER(value: "${numerics[0].name}") TITLE "${title}"`;
        }
    }
    // Single-row label+metric summary (e.g., dashboard KPI row).
    if (numerics.length === 1 && cats.length === 1 && LABEL_NAMES_RE.test(cats[0].name) && sample.length === 1) {
        const title = numerics[0].name.replace(/_/g, ' ');
        return `BIG_NUMBER(value: "${numerics[0].name}", label: "${cats[0].name}") TITLE "${title}"`;
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

    // Time + numerics → line chart (LINE_CHART(x:, y:[]))
    if (time && numerics.length >= 1) {
        const yCols = numerics.map(n => `"${n.name}"`).join(', ');
        let config = `LINE_CHART(x: "${time.name}", y: [${yCols}])`;
        // Add AXIS_Y DOMAIN hint for percentage columns.
        if (numerics.length === 1 && PERCENT_NAMES_RE.test(numerics[0].name)) {
            config += ` AXIS_Y DOMAIN [0, 100] FORMAT ".1f"`;
        }
        return config;
    }

    // Single category + single numeric.
    if (cats.length === 1 && numerics.length === 1) {
        const card = distinctCount(sample, cats[0].name);
        if (card === null || card > 32) return 'TABLE()';
        // Very low cardinality (≤4) and value column looks like percentage/share → PIE_CHART.
        if (card !== null && card <= 4 && PERCENT_NAMES_RE.test(numerics[0].name)) {
            return `PIE_CHART(category: "${cats[0].name}", value: "${numerics[0].name}")`;
        }
        // Larger cardinality → BAR_CHART; horizontal when names are long.
        const avgLen = avgCategoryLength(sample, cats[0].name);
        const horizontal = avgLen > 15 ? ', horizontal: true' : '';
        return `BAR_CHART(x: "${cats[0].name}", y: ["${numerics[0].name}"]${horizontal})`;
    }

    // Category + multiple numerics → grouped bar
    if (cats.length === 1 && numerics.length > 1) {
        const card = distinctCount(sample, cats[0].name);
        if (card === null || card > 32) return 'TABLE()';
        const yCols = numerics.map(n => `"${n.name}"`).join(', ');
        const avgLen = avgCategoryLength(sample, cats[0].name);
        const horizontal = avgLen > 15 ? ', horizontal: true' : '';
        return `BAR_CHART(x: "${cats[0].name}", y: [${yCols}]${horizontal})`;
    }

    // Two numerics (no time, no category) → scatter  (SCATTER_PLOT(x:, y:))
    if (cats.length === 0 && numerics.length === 2 && !time) {
        return `SCATTER_PLOT(x: "${numerics[0].name}", y: "${numerics[1].name}")`;
    }

    // One numeric, no time, no category → histogram  (HISTOGRAM(x:))
    if (numerics.length === 1 && cats.length === 0 && !time) {
        let config = `HISTOGRAM(x: "${numerics[0].name}")`;
        if (DURATION_MS_NAMES_RE.test(numerics[0].name)) {
            config += ` TITLE "${numerics[0].name.replace(/_/g, ' ')} distribution"`;
        }
        return config;
    }

    // Multiple numerics, no time, no category → histogram of first
    if (numerics.length > 1 && cats.length === 0 && !time) {
        return `HISTOGRAM(x: "${numerics[0].name}")`;
    }

    return 'TABLE()';
}

