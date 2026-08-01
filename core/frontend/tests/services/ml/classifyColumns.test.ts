import { describe, it, expect } from 'vitest';
import {
    classifyColumns,
    looksLikeStartName,
    looksLikeEndName,
    looksLikeRangeBound,
} from '../../../services/ml/classifyColumns';

// ─── classifyColumns ──────────────────────────────────────────────────────────

describe('classifyColumns — type-based detection', () => {
    it('classifies TIMESTAMP columns as time regardless of name', () => {
        const out = classifyColumns([{ name: 'pauseDuration', type: 'TIMESTAMP' }], []);
        expect(out[0].role).toBe('time');
    });

    it('classifies TIMESTAMP WITH TIME ZONE as time', () => {
        const out = classifyColumns([{ name: 'createdAt', type: 'TIMESTAMP WITH TIME ZONE' }], []);
        expect(out[0].role).toBe('time');
    });

    it('classifies DATE column as time', () => {
        const out = classifyColumns([{ name: 'birthday', type: 'DATE' }], []);
        expect(out[0].role).toBe('time');
    });

    it('classifies BIGINT column as numeric via type', () => {
        const out = classifyColumns([{ name: 'value', type: 'BIGINT' }], []);
        expect(out[0].role).toBe('numeric');
    });

    it('classifies DOUBLE column as numeric', () => {
        const out = classifyColumns([{ name: 'ratio', type: 'DOUBLE' }], []);
        expect(out[0].role).toBe('numeric');
    });

    it('classifies VARCHAR column as category', () => {
        const out = classifyColumns([{ name: 'cause', type: 'VARCHAR' }], []);
        expect(out[0].role).toBe('category');
    });
});

describe('classifyColumns — name-based time detection', () => {
    it('classifies "time" column as time (exact name match)', () => {
        const out = classifyColumns([{ name: 'time', type: 'BIGINT' }], []);
        expect(out[0].role).toBe('time');
    });

    it('classifies "ts" column as time', () => {
        const out = classifyColumns([{ name: 'ts', type: 'BIGINT' }], []);
        expect(out[0].role).toBe('time');
    });

    it('classifies "startTime" as time via prefix pattern', () => {
        const out = classifyColumns([{ name: 'startTime', type: 'BIGINT' }], []);
        expect(out[0].role).toBe('time');
    });

    it('classifies "eventTimestamp" as time via prefix pattern', () => {
        const out = classifyColumns([{ name: 'eventTimestamp', type: 'BIGINT' }], []);
        expect(out[0].role).toBe('time');
    });

    it('classifies "created_at" as time via suffix pattern', () => {
        const out = classifyColumns([{ name: 'created_at', type: 'BIGINT' }], []);
        expect(out[0].role).toBe('time');
    });

    it('does NOT classify "pauseDuration" as time (duration override)', () => {
        const out = classifyColumns([{ name: 'pauseDuration', type: 'BIGINT' }], []);
        expect(out[0].role).toBe('numeric');
    });

    it('does NOT classify "cpuTime" as time (duration names re-overrides)', () => {
        const out = classifyColumns([{ name: 'cpuTime', type: 'BIGINT' }], []);
        expect(out[0].role).toBe('numeric');
    });

    it('does NOT classify "elapsed" as time', () => {
        const out = classifyColumns([{ name: 'elapsed', type: 'BIGINT' }], []);
        expect(out[0].role).toBe('numeric');
    });
});

describe('classifyColumns — sample-value fallback', () => {
    it('classifies as numeric when sample value is a number, even with VARCHAR type', () => {
        const out = classifyColumns([{ name: 'n', type: 'VARCHAR' }], [{ n: 42 }]);
        expect(out[0].role).toBe('numeric');
    });

    it('classifies as category when type is non-numeric and sample is a string', () => {
        const out = classifyColumns([{ name: 'cause', type: 'VARCHAR' }], [{ cause: 'G1 Young' }]);
        expect(out[0].role).toBe('category');
    });
});

describe('classifyColumns — JFR-specific patterns', () => {
    it('young/old/meta GC heap columns are numeric', () => {
        const cols = [
            { name: 'young', type: 'BIGINT' },
            { name: 'old', type: 'BIGINT' },
            { name: 'meta', type: 'BIGINT' },
        ];
        const out = classifyColumns(cols, []);
        for (const c of out) expect(c.role).toBe('numeric');
    });

    it('preserves original name and type on output ColumnInfo', () => {
        const col = { name: 'startTime', type: 'BIGINT' };
        const out = classifyColumns([col], []);
        expect(out[0].name).toBe('startTime');
        expect(out[0].type).toBe('BIGINT');
    });
});

describe('classifyColumns — empty input', () => {
    it('returns empty array for no columns', () => {
        expect(classifyColumns([], [])).toEqual([]);
    });
});

// ─── looksLikeStartName ───────────────────────────────────────────────────────

describe('looksLikeStartName', () => {
    it.each([
        'start', 'startTime', 'startAt', 'startTs', 'begin', 'from', 'since', 'opened', 'started',
    ])('matches "%s"', (name) => {
        expect(looksLikeStartName(name)).toBe(true);
    });

    it.each(['end', 'time', 'ts', 'duration', 'finish', 'latency'])(
        'does NOT match "%s"', (name) => {
            expect(looksLikeStartName(name)).toBe(false);
        },
    );
});

// ─── looksLikeEndName ─────────────────────────────────────────────────────────

describe('looksLikeEndName', () => {
    it.each([
        'end', 'endTime', 'finish', 'to', 'until', 'closed', 'ended', 'stop', 'stopped',
    ])('matches "%s"', (name) => {
        expect(looksLikeEndName(name)).toBe(true);
    });

    it.each(['start', 'time', 'ts', 'begin'])(
        'does NOT match "%s"', (name) => {
            expect(looksLikeEndName(name)).toBe(false);
        },
    );
});

// ─── looksLikeRangeBound ─────────────────────────────────────────────────────

describe('looksLikeRangeBound', () => {
    it('p25 → low', () => expect(looksLikeRangeBound('p25')).toBe('low'));
    it('p75 → high', () => expect(looksLikeRangeBound('p75')).toBe('high'));
    it('p50 → null (median, neither bound)', () => expect(looksLikeRangeBound('p50')).toBeNull());
    it('p99 → high', () => expect(looksLikeRangeBound('p99')).toBe('high'));
    it('p1 → low', () => expect(looksLikeRangeBound('p1')).toBe('low'));

    it('min → low', () => expect(looksLikeRangeBound('min')).toBe('low'));
    it('max → high', () => expect(looksLikeRangeBound('max')).toBe('high'));
    it('lower → low', () => expect(looksLikeRangeBound('lower')).toBe('low'));
    it('upper → high', () => expect(looksLikeRangeBound('upper')).toBe('high'));
    it('q1 → low', () => expect(looksLikeRangeBound('q1')).toBe('low'));
    it('q3 → high', () => expect(looksLikeRangeBound('q3')).toBe('high'));

    it('unrelated column → null', () => {
        expect(looksLikeRangeBound('duration')).toBeNull();
        expect(looksLikeRangeBound('count')).toBeNull();
        expect(looksLikeRangeBound('cause')).toBeNull();
    });
});
