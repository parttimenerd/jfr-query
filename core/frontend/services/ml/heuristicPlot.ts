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
 *   5. Time + 3+ numerics → AREA_CHART (stacked).
 *   6. Time + numeric(s) → LINE_CHART(x:time, y:[numerics]).
 *   7. Single category + numeric(s):
 *        cardinality ≤ 32 → BAR_CHART(x:cat, y:[numerics])
 *        cardinality > 32 → TABLE() (bar of 100+ bars is unreadable).
 *   8. Two numerics, no time/cat → SCATTER_PLOT(x:, y:).
 *   9. Single numeric, no time/cat → HISTOGRAM(value:).
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

    // Single scalar value → table
    if (roles.length === 1 && numerics.length === 1) return 'TABLE()';

    // GANTT — require BOTH start* AND end* (conservative; per plan risk matrix
    // we never emit GANTT on a single time column).
    const timeRoles = roles.filter(r => r.role === 'time');
    const startCol = timeRoles.find(r => looksLikeStartName(r.name));
    const endCol = timeRoles.find(r => looksLikeEndName(r.name));
    if (startCol && endCol && startCol.name !== endCol.name && cats.length >= 1) {
        const lane = cats[0].name;
        const task = (cats[1] ?? cats[0]).name;
        return `GANTT(start: "${startCol.name}", end: "${endCol.name}", lane: "${lane}", task: "${task}")`;
    }

    // RANGE — exactly 1 category + 2 numerics whose names look like min/max
    // or p-low/p-high pair.
    if (cats.length === 1 && numerics.length === 2 && !time) {
        const a = looksLikeRangeBound(numerics[0].name);
        const b = looksLikeRangeBound(numerics[1].name);
        if (a && b && a !== b) {
            const low = a === 'low' ? numerics[0] : numerics[1];
            const high = a === 'high' ? numerics[0] : numerics[1];
            return `RANGE(x: "${cats[0].name}", low: "${low.name}", high: "${high.name}")`;
        }
    }

    // AREA_CHART — time + 3+ numerics → stacked area (signal is strong enough
    // that LINE would be too noisy).
    if (time && numerics.length >= 3) {
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
        // High-cardinality bar charts are unreadable; switch to table.
        if (card !== null && card > 32) return 'TABLE()';
        return `BAR_CHART(x: "${cats[0].name}", y: ["${numerics[0].name}"])`;
    }

    // Category + multiple numerics → grouped bar
    if (cats.length === 1 && numerics.length > 1) {
        const card = distinctCount(sample, cats[0].name);
        if (card !== null && card > 32) return 'TABLE()';
        const yCols = numerics.map(n => `"${n.name}"`).join(', ');
        return `BAR_CHART(x: "${cats[0].name}", y: [${yCols}])`;
    }

    // Two numerics (no time, no category) → scatter  (SCATTER_PLOT(x:, y:))
    if (cats.length === 0 && numerics.length === 2 && !time) {
        return `SCATTER_PLOT(x: "${numerics[0].name}", y: "${numerics[1].name}")`;
    }

    // One numeric, no time, no category → histogram  (HISTOGRAM(value:))
    if (numerics.length === 1 && cats.length === 0 && !time) {
        return `HISTOGRAM(value: "${numerics[0].name}")`;
    }

    // Multiple numerics, no time, no category → histogram of first
    if (numerics.length > 1 && cats.length === 0 && !time) {
        return `HISTOGRAM(value: "${numerics[0].name}")`;
    }

    return 'TABLE()';
}
