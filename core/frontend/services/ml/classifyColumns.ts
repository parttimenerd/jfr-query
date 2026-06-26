export type ColumnRole = 'time' | 'numeric' | 'category';

export interface ColumnInfo {
    name: string;
    type: string;
    role: ColumnRole;
}

// Names that strongly imply a temporal axis. Anchors are intentional — we
// want `startTime` to match, but NOT `pauseTime` / `gcTime` (which are
// durations, not absolute times).
const TIME_EXACT_NAMES_RE = /^(time|start|end|when|bucket|date|ts|timestamp|tick|at|created|updated|modified|epoch)$/i;
const TIME_PREFIX_NAMES_RE = /^(start|end|event|created|updated|modified)(Time|At|Date|Timestamp|Ts)$/i;
const TIME_SUFFIX_NAMES_RE = /_(at|on|date|time|timestamp|ts)$/i;
// Names that look temporal but are actually numeric durations / scalars.
// These take precedence over the time-name patterns above.
const DURATION_NAMES_RE = /(duration|elapsed|latency|pause|wait|delay|interval|lag|cost|cpu|memory|count|total|sum|avg|min|max|p\d{1,2}|percentile)/i;
const NUMERIC_TYPE_RE = /INT|DOUBLE|DECIMAL|FLOAT|REAL|NUMERIC|HUGEINT|BIGINT|SMALLINT|TINYINT/i;

function looksLikeTimeName(name: string): boolean {
    if (DURATION_NAMES_RE.test(name)) return false;
    return (
        TIME_EXACT_NAMES_RE.test(name) ||
        TIME_PREFIX_NAMES_RE.test(name) ||
        TIME_SUFFIX_NAMES_RE.test(name)
    );
}

// W6 — Helpers for GANTT / RANGE heuristic detection.
//
// looksLikeStartName / looksLikeEndName identify the two endpoints of a time
// interval (used by GANTT). We deliberately avoid matching `time` alone since
// that's ambiguous — GANTT only fires when BOTH start* AND end* are present.
const START_NAME_RE = /^(start|begin|from|since|opened|started)(Time|At|Date|Ts|Timestamp)?$/i;
const END_NAME_RE = /^(end|finish|to|until|closed|ended|stop|stopped)(Time|At|Date|Ts|Timestamp)?$/i;

export function looksLikeStartName(name: string): boolean {
    return START_NAME_RE.test(name);
}

export function looksLikeEndName(name: string): boolean {
    return END_NAME_RE.test(name);
}

// looksLikeRangeBound identifies min/max-style numeric column pairs that
// describe a value range over a category (used by RANGE). p25/p75 etc. count.
// Use anchored numeric matching so `p25` doesn't get matched as `p2` (which
// would then make every percentile name look low/high simultaneously).
export function looksLikeRangeBound(name: string): 'low' | 'high' | null {
    const lower = name.toLowerCase();
    // p<num> — split on the median (50).
    const pctMatch = lower.match(/^p(\d{1,3})(?:[a-z_].*)?$/);
    if (pctMatch) {
        const n = parseInt(pctMatch[1], 10);
        if (n < 50) return 'low';
        if (n > 50) return 'high';
        return null; // p50 is the median, neither bound
    }
    if (/^(min|low|lower|q1|first)/i.test(name)) return 'low';
    if (/^(max|high|upper|q3|last)/i.test(name)) return 'high';
    return null;
}

export function classifyColumns(
    cols: { name: string; type: string }[],
    sample: any[],
): ColumnInfo[] {
    return cols.map(c => {
        const sampleVal = sample[0]?.[c.name];
        const typeStr = c.type?.toUpperCase() ?? '';

        // TIMESTAMP/DATE columns are unambiguously temporal regardless of name.
        if (typeStr.includes('TIMESTAMP') || typeStr.includes('DATE')) {
            return { ...c, role: 'time' as const };
        }
        // Name-based time detection. JFR often stores timestamps as BIGINT
        // (epoch-ns), so we DO let the time-name regex win over a numeric type.
        // The DURATION_NAMES_RE guard inside `looksLikeTimeName` keeps
        // pauseDuration / cpuTime out of this branch.
        if (looksLikeTimeName(c.name)) {
            return { ...c, role: 'time' as const };
        }
        if (typeof sampleVal === 'number' || NUMERIC_TYPE_RE.test(typeStr)) {
            return { ...c, role: 'numeric' as const };
        }
        return { ...c, role: 'category' as const };
    });
}
