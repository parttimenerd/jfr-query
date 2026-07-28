// Non-LLM analyzer for "by the way" hints. Runs cheaply against the most
// recent query result and surfaces statistical anomalies (skew, zero-rows,
// nulls, suspicious top-row dominance) without making an API call.
//
// Pure: no DOM, no I/O. All analyzers take `RecentResult` and return BtwHint[].

import type { RecentResult } from './visibility';
import type { BtwHint } from './chatModes';

const MAX_HINTS = 3;

function makeId(): string {
    return `btw-an-${Math.random().toString(36).slice(2, 9)}`;
}

function isNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

/** Return hints for a result with no rows. */
function checkEmpty(result: RecentResult): BtwHint[] {
    if (result.rows.length === 0) {
        return [{
            id: makeId(),
            source: 'analyzer',
            text: 'The last query returned 0 rows — the filter may be too narrow.',
        }];
    }
    return [];
}

/** Surface columns that are entirely NULL or have high null-rate (>50%). */
function checkNulls(result: RecentResult): BtwHint[] {
    const out: BtwHint[] = [];
    if (result.rows.length < 5) return out;
    for (const col of result.columns) {
        const total = result.rows.length;
        let nulls = 0;
        for (const r of result.rows) {
            const v = r[col.name];
            if (v === null || v === undefined) nulls++;
        }
        if (nulls === total) {
            out.push({
                id: makeId(),
                source: 'analyzer',
                text: `Column "${col.name}" is entirely NULL in this result.`,
            });
        } else if (nulls / total > 0.5) {
            const pct = Math.round((nulls / total) * 100);
            out.push({
                id: makeId(),
                source: 'analyzer',
                text: `${pct}% of rows have NULL in "${col.name}".`,
            });
        }
        if (out.length >= MAX_HINTS) break;
    }
    return out;
}

/** Surface dominance: when the first row of a sorted result holds >70% of
 * the column total. Heuristic — only applies when the result has 2+ rows and
 * at least one numeric column. */
function checkDominance(result: RecentResult): BtwHint[] {
    if (result.rows.length < 2) return [];
    const out: BtwHint[] = [];
    for (const col of result.columns) {
        const vals: number[] = [];
        for (const r of result.rows) {
            const v = r[col.name];
            if (isNumber(v)) vals.push(v);
        }
        if (vals.length < 2) continue;
        const total = vals.reduce((a, b) => a + b, 0);
        if (total <= 0) continue;
        // Use the value from result.rows[0] directly — the function assumes the
        // result is sorted descending, so rows[0] is the actual top row.
        const topRaw = result.rows[0][col.name];
        if (!isNumber(topRaw)) continue;
        const top = topRaw as number;
        if (top / total > 0.7) {
            const pct = Math.round((top / total) * 100);
            out.push({
                id: makeId(),
                source: 'analyzer',
                text: `Top row holds ${pct}% of total "${col.name}" — investigate the outlier.`,
            });
            break; // one is enough
        }
    }
    return out;
}

/** Combine all analyzers and cap at MAX_HINTS. */
export function analyzeRecentResult(result: RecentResult | null | undefined): BtwHint[] {
    if (!result) return [];
    const all: BtwHint[] = [
        ...checkEmpty(result),
        ...checkNulls(result),
        ...checkDominance(result),
    ];
    return all.slice(0, MAX_HINTS);
}
