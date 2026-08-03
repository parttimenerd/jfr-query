import { describe, it, expect } from 'vitest';
import {
    classifyColumns,
    looksLikeStartName,
    looksLikeEndName,
    looksLikeRangeBound,
} from '../../services/ml/classifyColumns';

// ── looksLikeStartName ────────────────────────────────────────────────────────
describe('looksLikeStartName', () => {
    it.each([
        'start', 'startTime', 'startAt', 'startDate', 'startTs', 'startTimestamp',
        'begin', 'beginTime', 'from', 'since', 'opened', 'started',
    ])('"%s" is a start name', name => {
        expect(looksLikeStartName(name)).toBe(true);
    });

    it.each([
        'end', 'endTime', 'finish', 'bucket', 'ts', 'time', 'timestamp',
        'pauseMs', 'duration', 'gcStart',   // gcStart: not matched (starts with gc, not start/begin)
    ])('"%s" is NOT a start name', name => {
        expect(looksLikeStartName(name)).toBe(false);
    });
});

// ── looksLikeEndName ──────────────────────────────────────────────────────────
describe('looksLikeEndName', () => {
    it.each([
        'end', 'endTime', 'endAt', 'endDate', 'endTs', 'endTimestamp',
        'finish', 'to', 'until', 'closed', 'ended', 'stop', 'stopped',
    ])('"%s" is an end name', name => {
        expect(looksLikeEndName(name)).toBe(true);
    });

    it.each([
        'start', 'begin', 'bucket', 'ts', 'time', 'timestamp',
        'finishLine',  // suffix mismatch
    ])('"%s" is NOT an end name', name => {
        expect(looksLikeEndName(name)).toBe(false);
    });
});

// ── looksLikeRangeBound ───────────────────────────────────────────────────────
describe('looksLikeRangeBound', () => {
    it.each([
        ['p5', 'low'], ['p10', 'low'], ['p25', 'low'], ['p5_pause', 'low'],
        ['min', 'low'], ['low', 'low'], ['lower', 'low'], ['q1', 'low'], ['first', 'low'],
    ] as const)('%s → "low"', (name, expected) => {
        expect(looksLikeRangeBound(name)).toBe(expected);
    });

    it.each([
        ['p75', 'high'], ['p90', 'high'], ['p95', 'high'], ['p99', 'high'],
        ['max', 'high'], ['high', 'high'], ['upper', 'high'], ['q3', 'high'], ['last', 'high'],
    ] as const)('%s → "high"', (name, expected) => {
        expect(looksLikeRangeBound(name)).toBe(expected);
    });

    it.each(['p50', 'median', 'avg', 'bucket', 'gcType'])('"%s" → null', name => {
        expect(looksLikeRangeBound(name)).toBeNull();
    });
});

// ── classifyColumns ───────────────────────────────────────────────────────────
describe('classifyColumns', () => {
    it('TIMESTAMP type columns get role "time" regardless of name', () => {
        const result = classifyColumns(
            [{ name: 'pauseTime', type: 'TIMESTAMP' }], []);
        expect(result[0].role).toBe('time');
    });

    it('DATE type columns get role "time"', () => {
        const result = classifyColumns(
            [{ name: 'created', type: 'DATE' }], []);
        expect(result[0].role).toBe('time');
    });

    it('TIMESTAMP_NS and TIMESTAMP_MS are treated as time', () => {
        const cols = [
            { name: 'eventTime', type: 'TIMESTAMP_NS' },
            { name: 'sampleAt', type: 'TIMESTAMP_MS' },
        ];
        const result = classifyColumns(cols, []);
        expect(result[0].role).toBe('time');
        expect(result[1].role).toBe('time');
    });

    it('BIGINT column named "timestamp" gets role "time" (JFR epoch-ns)', () => {
        const result = classifyColumns(
            [{ name: 'timestamp', type: 'BIGINT' }], []);
        expect(result[0].role).toBe('time');
    });

    it('BIGINT column named "bucket" gets role "time"', () => {
        const result = classifyColumns(
            [{ name: 'bucket', type: 'BIGINT' }], []);
        expect(result[0].role).toBe('time');
    });

    it('"startTime" (BIGINT) gets role "time" via prefix pattern', () => {
        const result = classifyColumns(
            [{ name: 'startTime', type: 'BIGINT' }], []);
        expect(result[0].role).toBe('time');
    });

    it('"endAt" (VARCHAR) gets role "time" via prefix-at pattern', () => {
        const result = classifyColumns(
            [{ name: 'endAt', type: 'VARCHAR' }], []);
        expect(result[0].role).toBe('time');
    });

    it('"pauseTime" (BIGINT) gets role "numeric" — duration name overrides time name', () => {
        // DURATION_NAMES_RE should block the time-name match for "pause"
        const result = classifyColumns(
            [{ name: 'pauseTime', type: 'BIGINT' }], []);
        expect(result[0].role).toBe('numeric');
    });

    it('"cpuTime" (BIGINT) gets role "numeric" — cpu is a duration guard', () => {
        const result = classifyColumns(
            [{ name: 'cpuTime', type: 'BIGINT' }], []);
        expect(result[0].role).toBe('numeric');
    });

    it('"duration" gets role "numeric" regardless of sample', () => {
        const result = classifyColumns(
            [{ name: 'duration', type: '' }], []);
        expect(result[0].role).toBe('numeric');
    });

    it('DOUBLE/INT columns get role "numeric"', () => {
        const cols = [
            { name: 'pauseMs', type: 'DOUBLE' },
            { name: 'count', type: 'INT' },
        ];
        const result = classifyColumns(cols, []);
        expect(result[0].role).toBe('numeric');
        expect(result[1].role).toBe('numeric');
    });

    it('numeric sample value promotes untyped column to "numeric"', () => {
        const result = classifyColumns(
            [{ name: 'score', type: '' }],
            [{ score: 42 }],
        );
        expect(result[0].role).toBe('numeric');
    });

    it('VARCHAR column with non-numeric sample gets role "category"', () => {
        const result = classifyColumns(
            [{ name: 'gcType', type: 'VARCHAR' }],
            [{ gcType: 'G1 Young' }],
        );
        expect(result[0].role).toBe('category');
    });

    it('untyped column with string sample gets role "category"', () => {
        const result = classifyColumns(
            [{ name: 'phase', type: '' }],
            [{ phase: 'young' }],
        );
        expect(result[0].role).toBe('category');
    });

    it('mixed column set: time + numeric + category', () => {
        const cols = [
            { name: 'bucket', type: 'BIGINT' },
            { name: 'pauseMs', type: 'DOUBLE' },
            { name: 'gcType', type: 'VARCHAR' },
        ];
        const result = classifyColumns(cols, [{ bucket: 0, pauseMs: 10, gcType: 'G1' }]);
        expect(result.find(r => r.name === 'bucket')!.role).toBe('time');
        expect(result.find(r => r.name === 'pauseMs')!.role).toBe('numeric');
        expect(result.find(r => r.name === 'gcType')!.role).toBe('category');
    });

    it('preserves input order', () => {
        const cols = [
            { name: 'c', type: 'VARCHAR' },
            { name: 'b', type: 'DOUBLE' },
            { name: 'a', type: 'TIMESTAMP' },
        ];
        const result = classifyColumns(cols, []);
        expect(result.map(r => r.name)).toEqual(['c', 'b', 'a']);
    });
});
