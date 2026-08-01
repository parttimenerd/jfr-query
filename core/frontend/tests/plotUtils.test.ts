import { describe, it, expect } from 'vitest';
import { buildParserSpec, generateSignature, findColumn, findColumns, getTimeValue, buildSmartTemplate, getPaletteColors, isDurationColumnName, formatDurationNs, sampleLooksLikeNanoseconds } from '../utils/plotUtils';
import type { PlotParameter } from '../components/plots/plotTypes';

// ---------------------------------------------------------------------------
// buildParserSpec
// ---------------------------------------------------------------------------
describe('buildParserSpec', () => {
    it('converts params to spec entries', () => {
        const params: PlotParameter[] = [
            { name: 'x', type: 'column', required: true, description: 'X axis' },
            { name: 'y', type: 'column[]', required: false, description: 'Y axis' },
        ];
        const spec = buildParserSpec(params);
        expect(spec['x']).toEqual({ type: 'column', required: true, defaultValue: undefined, description: 'X axis', options: undefined });
        expect(spec['y']).toEqual({ type: 'column[]', required: false, defaultValue: undefined, description: 'Y axis', options: undefined });
    });

    it('auto-adds title param when not present', () => {
        const spec = buildParserSpec([]);
        expect(spec['title']).toBeDefined();
        expect(spec['title'].type).toBe('string');
        expect(spec['title'].required).toBe(false);
    });

    it('does not overwrite title param when explicitly provided', () => {
        const params: PlotParameter[] = [
            { name: 'title', type: 'number', required: true, description: 'Custom title param' },
        ];
        const spec = buildParserSpec(params);
        expect(spec['title'].type).toBe('number');
        expect(spec['title'].required).toBe(true);
    });

    it('preserves options array', () => {
        const params: PlotParameter[] = [
            { name: 'scale', type: 'string', required: false, description: 'Scale', options: ['linear', 'log'] },
        ];
        const spec = buildParserSpec(params);
        expect(spec['scale'].options).toEqual(['linear', 'log']);
    });

    it('preserves defaultValue', () => {
        const params: PlotParameter[] = [
            { name: 'bins', type: 'number', required: false, description: 'Bin count', defaultValue: 10 },
        ];
        const spec = buildParserSpec(params);
        expect(spec['bins'].defaultValue).toBe(10);
    });
});

// ---------------------------------------------------------------------------
// generateSignature
// ---------------------------------------------------------------------------
describe('generateSignature', () => {
    it('returns "()" for empty params', () => {
        expect(generateSignature([])).toBe('()');
    });

    it('marks required params without "?"', () => {
        const params: PlotParameter[] = [
            { name: 'x', type: 'column', required: true, description: '' },
        ];
        expect(generateSignature(params)).toBe('(x: column)');
    });

    it('marks optional params with "?"', () => {
        const params: PlotParameter[] = [
            { name: 'color', type: 'column', required: false, description: '' },
        ];
        expect(generateSignature(params)).toBe('(color: column?)');
    });

    it('shows required params before optional', () => {
        const params: PlotParameter[] = [
            { name: 'b', type: 'string', required: false, description: '' },
            { name: 'a', type: 'column', required: true, description: '' },
        ];
        const sig = generateSignature(params);
        expect(sig.indexOf('a:')).toBeLessThan(sig.indexOf('b:'));
    });

    it('truncates to 4 params and adds "..."', () => {
        const params: PlotParameter[] = Array.from({ length: 6 }, (_, i) => ({
            name: `p${i}`,
            type: 'string',
            required: true,
            description: '',
        }));
        const sig = generateSignature(params);
        expect(sig).toContain('...');
        // Only 4 params visible before '...'
        const paramCount = (sig.match(/p\d:/g) ?? []).length;
        expect(paramCount).toBe(4);
    });

    it('does not add "..." when params fit within limit', () => {
        const params: PlotParameter[] = Array.from({ length: 4 }, (_, i) => ({
            name: `p${i}`,
            type: 'string',
            required: true,
            description: '',
        }));
        expect(generateSignature(params)).not.toContain('...');
    });
});

// ---------------------------------------------------------------------------
// findColumn
// ---------------------------------------------------------------------------
describe('findColumn', () => {
    it('returns direct match when present', () => {
        expect(findColumn('cpu', ['cpu', 'heap', 'ts'])).toBe('cpu');
    });

    it('returns prefixed match when no direct match', () => {
        expect(findColumn('cpu', ['1_cpu', 'heap'])).toBe('1_cpu');
    });

    it('prefers direct match over prefixed', () => {
        expect(findColumn('cpu', ['cpu', '1_cpu'])).toBe('cpu');
    });

    it('returns baseName when no match found', () => {
        expect(findColumn('missing', ['cpu', 'heap'])).toBe('missing');
    });

    it('handles regex special chars in column name', () => {
        // e.g. column named "p50(ns)" — the parens must not break the regex
        expect(findColumn('p50', ['1_p50', 'heap'])).toBe('1_p50');
    });
});

// ---------------------------------------------------------------------------
// findColumns
// ---------------------------------------------------------------------------
describe('findColumns', () => {
    it('returns all prefixed matches', () => {
        const result = findColumns('duration', ['1_duration', '2_duration', 'heap']);
        expect(result).toEqual(['1_duration', '2_duration']);
    });

    it('returns direct match when no prefixed columns', () => {
        expect(findColumns('heap', ['heap', 'cpu'])).toEqual(['heap']);
    });

    it('returns empty array when nothing matches', () => {
        expect(findColumns('missing', ['cpu', 'heap'])).toEqual([]);
    });

    it('does not return direct match when prefixed columns exist', () => {
        // prefixed wins over direct when both exist
        const result = findColumns('duration', ['duration', '1_duration', '2_duration']);
        expect(result).not.toContain('duration');
        expect(result).toContain('1_duration');
    });
});

// ---------------------------------------------------------------------------
// findColumn — B-073: case-insensitive matching
// ---------------------------------------------------------------------------
describe('findColumn — B-073 case-insensitive', () => {
    it('matches when column is uppercase but query is lowercase', () => {
        expect(findColumn('cpu', ['CPU', 'heap'])).toBe('CPU');
    });

    it('matches when column is mixed-case but query is lowercase', () => {
        expect(findColumn('starttime', ['StartTime', 'EndTime'])).toBe('StartTime');
    });

    it('matches when query is uppercase but column is lowercase', () => {
        expect(findColumn('DURATION', ['duration', 'cpu'])).toBe('duration');
    });

    it('prefers exact-case direct match over case-insensitive match', () => {
        // Both 'cpu' and 'CPU' are present; exact match should win
        expect(findColumn('cpu', ['CPU', 'cpu'])).toBe('cpu');
    });

    it('falls back to case-insensitive before trying prefix pattern', () => {
        // 'Heap' (mixed) exists — should match before trying numeric prefix
        expect(findColumn('heap', ['1_Heap', 'Heap'])).toBe('Heap');
    });

    it('matches prefixed column case-insensitively', () => {
        // '1_CPU' exists but query is 'cpu' with no direct match
        expect(findColumn('cpu', ['1_CPU'])).toBe('1_CPU');
    });

    it('returns baseName unchanged when no case-insensitive or prefixed match', () => {
        expect(findColumn('missing', ['CPU', 'heap'])).toBe('missing');
    });
});

// ---------------------------------------------------------------------------
// findColumns — B-073: case-insensitive matching
// ---------------------------------------------------------------------------
describe('findColumns — B-073 case-insensitive', () => {
    it('matches direct column case-insensitively when no prefixed exist', () => {
        expect(findColumns('heap', ['HEAP', 'cpu'])).toEqual(['HEAP']);
    });

    it('matches mixed-case direct column', () => {
        expect(findColumns('starttime', ['StartTime', 'EndTime'])).toEqual(['StartTime']);
    });

    it('prefers prefixed columns even when casing differs', () => {
        const result = findColumns('duration', ['1_Duration', '2_DURATION', 'duration']);
        expect(result).toContain('1_Duration');
        expect(result).toContain('2_DURATION');
        expect(result).not.toContain('duration');
    });
});

// ---------------------------------------------------------------------------
// getTimeValue
// ---------------------------------------------------------------------------
describe('getTimeValue', () => {
    const EPOCH_MS = 1716584383215; // 2024-05-24T20:59:43.215Z

    it('returns NaN for null', () => {
        expect(getTimeValue(null)).toBeNaN();
    });

    it('returns NaN for undefined', () => {
        expect(getTimeValue(undefined)).toBeNaN();
    });

    it('returns ms directly for 13-digit number', () => {
        expect(getTimeValue(EPOCH_MS)).toBe(EPOCH_MS);
    });

    it('converts microsecond number (16 digits) to ms', () => {
        // DuckDB WASM returns TIMESTAMPTZ as BigInt microseconds (16 digits for 2024 dates)
        const us = EPOCH_MS * 1_000; // 16-digit microseconds
        expect(String(us).length).toBe(16);
        expect(getTimeValue(us)).toBeCloseTo(EPOCH_MS, 0);
    });

    it('converts nanosecond number (19 digits) to ms', () => {
        const ns = EPOCH_MS * 1_000_000; // 19-digit nanoseconds
        expect(String(ns).length).toBe(19);
        expect(getTimeValue(ns)).toBeCloseTo(EPOCH_MS, 0);
    });

    it('handles Date object in normal ms range', () => {
        const d = new Date(EPOCH_MS);
        expect(getTimeValue(d)).toBe(EPOCH_MS);
    });

    it('converts Date whose getTime() is in microsecond range (DuckDB TIMESTAMP)', () => {
        // DuckDB WASM returns TIMESTAMP columns as Date objects with μs in getTime().
        // Simulate: create a real Date, then override getTime to return microseconds.
        const microseconds = EPOCH_MS * 1000; // 16-digit value
        const d = new Date(EPOCH_MS);
        d.getTime = () => microseconds;
        expect(getTimeValue(d)).toBeCloseTo(EPOCH_MS, 0);
    });

    it('parses ISO date string', () => {
        const iso = '2024-05-24T20:59:43.215Z';
        expect(getTimeValue(iso)).toBe(new Date(iso).getTime());
    });

    it('parses numeric string (ms)', () => {
        expect(getTimeValue(String(EPOCH_MS))).toBe(EPOCH_MS);
    });

    it('parses numeric string (microseconds, 16 digits)', () => {
        const us = EPOCH_MS * 1_000;
        expect(getTimeValue(String(us))).toBeCloseTo(EPOCH_MS, 0);
    });

    it('parses numeric string (nanoseconds, 19 digits)', () => {
        const ns = EPOCH_MS * 1_000_000;
        expect(getTimeValue(String(ns))).toBeCloseTo(EPOCH_MS, 0);
    });

    it('returns NaN for non-numeric string', () => {
        expect(getTimeValue('not-a-date')).toBeNaN();
    });

    it('handles bigint ms value', () => {
        expect(getTimeValue(BigInt(EPOCH_MS))).toBe(EPOCH_MS);
    });

    it('handles bigint microseconds (DuckDB WASM TIMESTAMPTZ)', () => {
        // DuckDB WASM row.toJSON() returns TIMESTAMPTZ as BigInt microseconds
        const us = BigInt(EPOCH_MS) * 1000n;
        expect(String(us).length).toBe(16);
        expect(getTimeValue(us)).toBeCloseTo(EPOCH_MS, 0);
    });

    it('converts epoch-seconds float (DuckDB TIMESTAMP fractional seconds) to ms', () => {
        // DuckDB WASM returns TIMESTAMP columns as fractional epoch-seconds (e.g. 1716574783.215251)
        // The integer part has 10 digits; the float is not an integer
        const epochSeconds = 1716574783.215251;
        expect(String(epochSeconds).split('.')[0].length).toBe(10);
        expect(getTimeValue(epochSeconds)).toBeCloseTo(epochSeconds * 1000, 0);
    });

    it('multiplies a plain 10-digit integer by 1000 (epoch seconds → ms)', () => {
        // A 10-digit integer represents epoch-seconds (e.g. 1716574783 = May 2024).
        // DuckDB returns TIMESTAMP as fractional floats; integer form indicates seconds.
        const tenDigitSec = 1716574783;
        expect(getTimeValue(tenDigitSec)).toBe(tenDigitSec * 1000);
    });
});

// ---------------------------------------------------------------------------
// buildSmartTemplate
// ---------------------------------------------------------------------------
describe('buildSmartTemplate', () => {
    const sampleRow = { ts: new Date(), cpu: 42, heap: 200, event: 'GC', phase: 'mark' };
    const cols = Object.keys(sampleRow);

    it('returns null for empty columns', () => {
        expect(buildSmartTemplate('LINE_CHART', [], null)).toBeNull();
    });

    it('TABLE always returns TABLE()', () => {
        expect(buildSmartTemplate('TABLE', cols, sampleRow)).toBe('TABLE()');
    });

    it('LINE_CHART picks time col as x and numeric cols as y', () => {
        const result = buildSmartTemplate('LINE_CHART', cols, sampleRow);
        expect(result).toContain('LINE_CHART');
        expect(result).toContain('"ts"');
        expect(result).toMatch(/y: \[/);
    });

    it('BAR_CHART picks categorical col as x', () => {
        const result = buildSmartTemplate('BAR_CHART', cols, sampleRow);
        expect(result).toContain('BAR_CHART');
        // event/phase are categorical
        expect(result).toMatch(/x: "(?:event|phase)"/);
    });

    it('PIE_CHART returns category + value', () => {
        const result = buildSmartTemplate('PIE_CHART', cols, sampleRow);
        expect(result).toContain('PIE_CHART');
        expect(result).toContain('category:');
        expect(result).toContain('value:');
    });

    it('SCATTER_PLOT returns x and y', () => {
        const result = buildSmartTemplate('SCATTER_PLOT', cols, sampleRow);
        expect(result).toContain('SCATTER_PLOT');
        expect(result).toContain('x:');
        expect(result).toContain('y:');
    });

    it('HISTOGRAM returns value col', () => {
        const result = buildSmartTemplate('HISTOGRAM', cols, sampleRow);
        expect(result).toContain('HISTOGRAM');
        expect(result).toContain('x:');
    });

    it('FLAMEGRAPH picks frame col by name heuristic', () => {
        const flameCols = ['method', 'samples'];
        const flameRow = { method: 'java.lang.Thread.run', samples: 100 };
        const result = buildSmartTemplate('FLAMEGRAPH', flameCols, flameRow);
        expect(result).toContain('"method"');
        expect(result).toContain('"samples"');
    });

    it('returns null for unknown plot type', () => {
        expect(buildSmartTemplate('UNKNOWN_PLOT', cols, sampleRow)).toBeNull();
    });
});

// ── getPaletteColors ──────────────────────────────────────────────────────────

const fallbackColors = ['#aaa', '#bbb', '#ccc'];

describe('getPaletteColors', () => {
    it('returns fallback when palette is undefined', () => {
        expect(getPaletteColors(undefined, fallbackColors)).toBe(fallbackColors);
    });

    it('returns fallback when palette name is unrecognized', () => {
        expect(getPaletteColors('nonexistent', fallbackColors)).toBe(fallbackColors);
    });

    it('returns category10 palette colors', () => {
        const result = getPaletteColors('category10', fallbackColors);
        expect(result.length).toBe(10);
        expect(result).not.toBe(fallbackColors);
    });

    it('is case-insensitive for palette names', () => {
        const lower = getPaletteColors('tableau10', fallbackColors);
        const upper = getPaletteColors('TABLEAU10', fallbackColors);
        expect(lower).toEqual(upper);
    });

    it('returns all named palettes without fallback', () => {
        for (const name of ['category10', 'tableau10', 'pastel1', 'dark2', 'set2']) {
            const result = getPaletteColors(name, fallbackColors);
            expect(result).not.toBe(fallbackColors);
            expect(result.length).toBeGreaterThan(0);
        }
    });
});

// ── isDurationColumnName ──────────────────────────────────────────────────────

describe('isDurationColumnName', () => {
    it('returns true for "duration"', () => expect(isDurationColumnName('duration')).toBe(true));
    it('returns true for "pause_ms" (contains "pause")', () => expect(isDurationColumnName('pause_ms')).toBe(true));
    it('returns true for "latency"', () => expect(isDurationColumnName('latency')).toBe(true));
    it('returns true for "_ns" suffix', () => expect(isDurationColumnName('cpu_ns')).toBe(true));
    it('returns true for "elapsed"', () => expect(isDurationColumnName('elapsed')).toBe(true));
    it('returns false for "count"', () => expect(isDurationColumnName('count')).toBe(false));
    it('returns false for "name"', () => expect(isDurationColumnName('name')).toBe(false));
    it('is case-insensitive', () => expect(isDurationColumnName('Latency')).toBe(true));
});

// ── formatDurationNs ──────────────────────────────────────────────────────────

describe('formatDurationNs', () => {
    it('formats nanoseconds below 1µs', () => {
        expect(formatDurationNs(500)).toBe('500ns');
    });

    it('formats microseconds (≥1000ns, <1ms)', () => {
        expect(formatDurationNs(1500)).toBe('1.5µs');
    });

    it('formats milliseconds (≥1ms, <1s)', () => {
        expect(formatDurationNs(2_500_000)).toBe('2.5ms');
    });

    it('formats seconds (≥1s)', () => {
        expect(formatDurationNs(1_500_000_000)).toBe('1.5s');
    });

    it('returns non-finite input as string', () => {
        expect(formatDurationNs(NaN)).toBe('NaN');
        expect(formatDurationNs(Infinity)).toBe('Infinity');
    });

    it('handles string numbers', () => {
        expect(formatDurationNs('1000000')).toBe('1ms');
    });

    it('handles zero', () => {
        expect(formatDurationNs(0)).toBe('0ns');
    });
});

// ── sampleLooksLikeNanoseconds ────────────────────────────────────────────────

describe('sampleLooksLikeNanoseconds', () => {
    it('returns false for empty data', () => {
        expect(sampleLooksLikeNanoseconds([], ['duration'])).toBe(false);
    });

    it('returns false for empty cols', () => {
        expect(sampleLooksLikeNanoseconds([{ duration: 2e9 }], [])).toBe(false);
    });

    it('returns true when values are > 1ms in nanoseconds', () => {
        const data = [{ duration: 5_000_000 }]; // 5ms in ns
        expect(sampleLooksLikeNanoseconds(data, ['duration'])).toBe(true);
    });

    it('returns false when values are < 1ms (likely already ms)', () => {
        const data = [{ duration: 5 }]; // 5ms in ms — below 1e6 threshold
        expect(sampleLooksLikeNanoseconds(data, ['duration'])).toBe(false);
    });

    it('returns false when col values are null/undefined', () => {
        const data = [{ duration: null }];
        expect(sampleLooksLikeNanoseconds(data, ['duration'])).toBe(false);
    });

    it('checks all listed columns — returns false if any is small', () => {
        const data = [{ big: 5_000_000, small: 5 }];
        expect(sampleLooksLikeNanoseconds(data, ['big', 'small'])).toBe(false);
    });
});
