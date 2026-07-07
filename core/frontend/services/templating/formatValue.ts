/**
 * Format a scalar value (the first cell of the first row of a `${SELECT …}`
 * result) for inline display in markdown prose. The caller passes a format
 * hint (from `${… | <fmt>}`) and any notebook-level format settings.
 *
 * Format names match those accepted by `splitInlineExprs`:
 *   - `duration_ms` / `duration_ns` — render via `timeFormat`-style helper
 *   - `bytes` — humanize 1234567 -> "1.18 MiB"
 *   - `pct` — multiply by 100 and append "%"
 *   - `int` — strip fractional part, group thousands
 *   - `float` — apply `decimalPlaces`
 *   - `time` — render an absolute timestamp via `timeFormat`
 *   - `raw` — JSON.stringify on objects, String() on scalars
 *
 * When no format hint is provided, infer from the value's JS type. This is
 * intentionally minimal; the existing time/decimal helpers in `utils/` already
 * cover the project's formatting needs and are imported when wired up in
 * `TemplatedMarkdown.tsx`.
 */

import { formatTimestamp } from '../../utils/timeFormatter';

export interface FormatSettings {
    /** Active timeFormat from notebook metadata (e.g. `HH:mm:ss`). */
    timeFormat?: string;
    /** Active decimal-places setting (e.g. `2`). */
    decimalPlaces?: number;
}

const KIB = 1024;
const HUMAN_BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

const formatBytes = (n: number): string => {
    if (!isFinite(n)) return String(n);
    if (n === 0) return '0 B';
    const sign = n < 0 ? '-' : '';
    let abs = Math.abs(n);
    let i = 0;
    while (abs >= KIB && i < HUMAN_BYTE_UNITS.length - 1) {
        abs /= KIB;
        i++;
    }
    return `${sign}${abs >= 100 || i === 0 ? abs.toFixed(0) : abs.toFixed(2)} ${HUMAN_BYTE_UNITS[i]}`;
};

const formatDurationMs = (ms: number): string => {
    if (!isFinite(ms)) return String(ms);
    if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
    if (ms < 1000) return `${ms.toFixed(ms < 10 ? 2 : 0)} ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
    if (ms < 3_600_000) return `${(ms / 60_000).toFixed(2)} min`;
    return `${(ms / 3_600_000).toFixed(2)} h`;
};

const formatInt = (n: number): string => {
    if (!isFinite(n)) return String(n);
    return Math.trunc(n).toLocaleString('en-US');
};

const formatFloat = (n: number, decimals = 2): string => {
    if (!isFinite(n)) return String(n);
    return n.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
};

export const formatValue = (
    value: unknown,
    format: string | undefined,
    settings: FormatSettings,
): string => {
    if (value == null) return '—';
    if (format === 'raw') {
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }

    // Numeric coercion for numeric formats
    const num = typeof value === 'number' ? value : Number(value);
    const numIsValid = !isNaN(num) && isFinite(num);

    switch (format) {
        case 'duration_ms':
            return numIsValid ? formatDurationMs(num) : String(value);
        case 'duration_ns':
            return numIsValid ? formatDurationMs(num / 1e6) : String(value);
        case 'bytes':
            return numIsValid ? formatBytes(num) : String(value);
        case 'pct':
            return numIsValid ? `${(num * 100).toFixed(2)}%` : String(value);
        case 'int':
            return numIsValid ? formatInt(num) : String(value);
        case 'float':
            return numIsValid ? formatFloat(num, settings.decimalPlaces ?? 2) : String(value);
        case 'time':
            try {
                return formatTimestamp(value as number, settings.timeFormat ?? 'HH:mm:ss.SSS');
            } catch {
                return String(value);
            }
    }

    // No format hint — infer minimally.
    if (numIsValid && typeof value === 'number') {
        if (Number.isInteger(value)) return formatInt(value);
        return formatFloat(value, settings.decimalPlaces ?? 2);
    }
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
};
