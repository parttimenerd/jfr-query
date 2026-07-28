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
        if (isNaN(µs)) return null;
        const days = Number(value[1] ?? 0);
        const months = Number(value[2] ?? 0);
        return µs / 1_000_000 + days * 86_400 + months * 30 * 86_400;
    }
    if (typeof value === 'string') {
        const m = INTERVAL_RE.exec(value);
        if (!m) return null;
        const µs = Number(m[1]);
        const days = Number(m[2] ?? 0);
        const months = Number(m[3] ?? 0);
        return µs / 1_000_000 + days * 86_400 + months * 30 * 86_400;
    }
    return null;
};

export const isIntervalLike = (value: any): boolean => {
    // DuckDB INTERVAL is stored as [µs: number, days: number, months: number].
    // Guard against arbitrary array columns by requiring all elements to be numeric.
    if (Array.isArray(value) && value.length >= 3 && value.every(v => typeof v === 'number' || typeof v === 'bigint')) return true;
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
    // Allow fractional-second values (e.g. JFR stores durations in seconds: 0.012 s = 12 ms).
    // Upper cap 1e12 excludes epoch-scale timestamps.
    if (num < 0 || num > 1e12) return false;
    return true;
};

const BYTE_KEYWORDS = ['bytes', 'size', 'used', 'committed', 'reserved', 'allocated', 'heap', 'memory', 'ram', 'resident'];
// Values in the range typical for JVM heap sizes: 1 KB – 256 GB
const MIN_BYTE_VAL = 1_024;
const MAX_BYTE_VAL = 256 * 1024 ** 3;

/**
 * Returns true when a numeric column looks like it holds byte counts.
 * Heuristic: column name contains a byte-related keyword AND the sample
 * value falls in [1 KB, 256 GB] (rules out raw counts and timestamps).
 */
export const isByteLike = (key: string, sample: any): boolean => {
    if (!sample || sample[key] === undefined || sample[key] === null) return false;
    const value = sample[key];
    if (typeof value !== 'number' && typeof value !== 'bigint') return false;
    const num = Number(value);
    if (num < MIN_BYTE_VAL || num > MAX_BYTE_VAL) return false;
    const lc = key.toLowerCase();
    return BYTE_KEYWORDS.some(kw => lc.includes(kw));
};

/**
 * Format a byte count as a human-readable string: "500.0 MB", "1.2 GB", etc.
 */
export const formatBytes = (bytes: number): string => {
    const abs = Math.abs(bytes);
    const sign = bytes < 0 ? '-' : '';
    if (abs >= 1024 ** 3) return `${sign}${(abs / 1024 ** 3).toFixed(1)} GB`;
    if (abs >= 1024 ** 2) return `${sign}${(abs / 1024 ** 2).toFixed(1)} MB`;
    if (abs >= 1024)      return `${sign}${(abs / 1024).toFixed(1)} KB`;
    return `${sign}${abs} B`;
};

/**
 * Sort comparator for two values from a data row.
 * Handles null, numeric (including BigInt), and string values (B-114).
 */
export const compareValues = (a: any, b: any, ascending: boolean): number => {
    const asc = ascending ? 1 : -1;
    if (a == null && b == null) return 0;
    if (a == null) return 1 * asc;
    if (b == null) return -1 * asc;
    // B-114: use BigInt comparison to avoid precision loss for nanosecond timestamps.
    if (typeof a === 'bigint' && typeof b === 'bigint') return (a < b ? -1 : a > b ? 1 : 0) * asc;
    // Mixed BigInt/number: promote both to BigInt for a precision-safe comparison.
    if (typeof a === 'bigint' || typeof b === 'bigint') {
        try {
            const ba = BigInt(a), bb = BigInt(b);
            return (ba < bb ? -1 : ba > bb ? 1 : 0) * asc;
        } catch { /* fall through to Number comparison */ }
    }
    if ((typeof a === 'number' || typeof a === 'bigint') &&
        (typeof b === 'number' || typeof b === 'bigint')) return (Number(a) - Number(b)) * asc;
    return String(a).localeCompare(String(b)) * asc;
};

/**
 * Produce a CSV row value for a raw cell value (B-115).
 * Always uses the raw value — never a formatted/display representation.
 */
export const csvValue = (v: any): string => (v == null ? '' : String(v));
