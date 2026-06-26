/**
 * Pure utility functions extracted from DataTable.tsx so they can be unit-tested
 * without a DOM/React environment.
 */

export const DURATION_KEYWORDS = ['duration', 'pause', 'latency', 'elapsed', 'period', 'age', 'length', 'wait', 'delay'];

// DuckDB interval arrays: [microseconds, days, months, ?] — first element is µs.
export const INTERVAL_RE = /^(-?\d+),(-?\d+),(-?\d+)(?:,(-?\d+))?$/;

export const parseIntervalToSeconds = (value: any): number | null => {
    if (Array.isArray(value)) {
        const µs = Number(value[0]);
        return isNaN(µs) ? null : µs / 1_000_000;
    }
    if (typeof value === 'string') {
        const m = INTERVAL_RE.exec(value);
        if (!m) return null;
        return Number(m[1]) / 1_000_000;
    }
    return null;
};

export const isIntervalLike = (value: any): boolean => {
    if (Array.isArray(value) && value.length >= 3) return true;
    if (typeof value === 'string' && INTERVAL_RE.test(value)) return true;
    return false;
};

/**
 * Returns true when a column should be rendered as a duration.
 *
 * Two paths:
 *  1. Genuine DuckDB INTERVAL shape (array [µs, days, months] or comma string).
 *  2. Numeric heuristic: column name contains a duration keyword AND value is
 *     in [0, 1e12] µs (≈ 0 – 11.6 days). Cap raised from 1e9 to 1e12 (B-113).
 */
export const isDurationLike = (key: string, sample: any): boolean => {
    if (!sample || sample[key] === undefined || sample[key] === null) return false;
    const value = sample[key];
    // Genuine DuckDB INTERVAL shape — always a duration regardless of magnitude.
    if (isIntervalLike(value)) return true;
    // Numeric heuristic.
    const lc = key.toLowerCase();
    if (!DURATION_KEYWORDS.some(kw => lc.includes(kw))) return false;
    if (typeof value !== 'number' && typeof value !== 'bigint') return false;
    const num = Number(value);
    if (num < 1 || num > 1e12) return false;
    return true;
};

/**
 * Sort comparator for two values from a data row.
 * Handles null, numeric (including BigInt), and string values (B-114).
 */
export const compareValues = (a: any, b: any, ascending: boolean): number => {
    const asc = ascending ? 1 : -1;
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if ((typeof a === 'number' || typeof a === 'bigint') &&
        (typeof b === 'number' || typeof b === 'bigint')) return (Number(a) - Number(b)) * asc;
    return String(a).localeCompare(String(b)) * asc;
};

/**
 * Produce a CSV row value for a raw cell value (B-115).
 * Always uses the raw value — never a formatted/display representation.
 */
export const csvValue = (v: any): string => (v == null ? '' : String(v));
