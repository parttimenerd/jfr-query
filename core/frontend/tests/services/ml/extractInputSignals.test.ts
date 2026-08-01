import { describe, it, expect } from 'vitest';
import { extractInputSignals } from '../../../services/ml/candidates';
import type { TypedColumn } from '../../../services/ml/candidates';

// Helper to get individual tags from the space-separated output
function tags(sql: string, cols: (string | TypedColumn)[]): string[] {
    return extractInputSignals(sql, cols).split(' ');
}

// ─── structural SQL flags ─────────────────────────────────────────────────────

describe('extractInputSignals — SQL structural flags', () => {
    it('emits agg for GROUP BY', () => {
        expect(tags('SELECT cause, COUNT(*) FROM t GROUP BY cause', ['cause', 'count'])).toContain('agg');
    });

    it('does not emit agg without GROUP BY', () => {
        expect(tags('SELECT * FROM t', ['x'])).not.toContain('agg');
    });

    it('emits ordered for ORDER BY + LIMIT without GROUP BY', () => {
        const t = tags('SELECT * FROM t ORDER BY ts LIMIT 10', ['ts']);
        expect(t).toContain('ordered');
        expect(t).not.toContain('sorted');
    });

    it('emits sorted for ORDER BY without LIMIT', () => {
        const t = tags('SELECT * FROM t ORDER BY ts', ['ts']);
        expect(t).toContain('sorted');
        expect(t).not.toContain('ordered');
    });

    it('emits topN for GROUP BY + ORDER BY + LIMIT', () => {
        expect(tags('SELECT cause, COUNT(*) FROM t GROUP BY cause ORDER BY cnt LIMIT 5', ['cause', 'cnt']))
            .toContain('topN');
    });

    it('emits cross for GROUP BY 2+ cols without ORDER BY', () => {
        expect(tags('SELECT a, b, COUNT(*) FROM t GROUP BY a, b', ['a', 'b', 'count']))
            .toContain('cross');
    });

    it('does not emit cross for single-col GROUP BY', () => {
        expect(tags('SELECT cause, COUNT(*) FROM t GROUP BY cause', ['cause', 'count']))
            .not.toContain('cross');
    });

    it('emits raw for LIMIT without GROUP BY, aggregation, or ORDER BY', () => {
        expect(tags('SELECT * FROM t LIMIT 100', ['col'])).toContain('raw');
    });

    it('emits scalar for aggregate fn without GROUP BY', () => {
        expect(tags('SELECT COUNT(*) FROM t', ['count'])).toContain('scalar');
    });

    it('emits having when HAVING is present', () => {
        expect(tags('SELECT cause, COUNT(*) FROM t GROUP BY cause HAVING COUNT(*) > 5', ['cause', 'count']))
            .toContain('having');
    });

    it('emits cnt_agg for COUNT with GROUP BY', () => {
        expect(tags('SELECT cause, COUNT(*) FROM t GROUP BY cause', ['cause', 'count']))
            .toContain('cnt_agg');
    });

    it('emits sum_agg for SUM with GROUP BY', () => {
        expect(tags('SELECT cause, SUM(bytes) FROM t GROUP BY cause', ['cause', 'bytes']))
            .toContain('sum_agg');
    });
});

// ─── column count signals ─────────────────────────────────────────────────────

describe('extractInputSignals — column count', () => {
    it('emits solo for single column', () => {
        expect(tags('SELECT duration FROM t', ['duration'])).toContain('solo');
    });

    it('emits duo for two columns', () => {
        expect(tags('SELECT a, b FROM t', ['a', 'b'])).toContain('duo');
    });

    it('emits wide for 3+ columns', () => {
        expect(tags('SELECT a, b, c FROM t', ['a', 'b', 'c'])).toContain('wide');
    });

    it('emits wide for exactly 3 columns', () => {
        expect(tags('SELECT a, b, c FROM t', ['a', 'b', 'c'])).toContain('wide');
        expect(tags('SELECT a, b, c FROM t', ['a', 'b', 'c'])).not.toContain('duo');
    });
});

// ─── time signal ──────────────────────────────────────────────────────────────

describe('extractInputSignals — time signal', () => {
    it('emits time for column named "time"', () => {
        expect(tags('SELECT time FROM t', ['time'])).toContain('time');
    });

    it('emits time for column named "startTime"', () => {
        expect(tags('SELECT startTime FROM t', ['startTime'])).toContain('time');
    });

    it('emits time for column named "timestamp"', () => {
        expect(tags('SELECT ts FROM t', ['timestamp'])).toContain('time');
    });

    it('emits time for column typed TIMESTAMP', () => {
        expect(tags('SELECT ts FROM t', [{ name: 'ts', type: 'TIMESTAMP' }])).toContain('time');
    });

    it('emits time for column typed DATE', () => {
        expect(tags('SELECT d FROM t', [{ name: 'd', type: 'DATE' }])).toContain('time');
    });

    it('does not emit time for non-time columns', () => {
        expect(tags('SELECT cause FROM t', ['cause'])).not.toContain('time');
    });

    it('emits time for _at suffix', () => {
        expect(tags('SELECT created_at FROM t', ['created_at'])).toContain('time');
    });

    it('emits time for _ts suffix', () => {
        expect(tags('SELECT logged_ts FROM t', ['logged_ts'])).toContain('time');
    });
});

// ─── JFR domain signals ───────────────────────────────────────────────────────

describe('extractInputSignals — domain signals', () => {
    it('emits gc for gc-related column names', () => {
        expect(tags('SELECT gcPause FROM t', ['gcPause'])).toContain('gc');
    });

    it('emits gc for heap column', () => {
        expect(tags('SELECT heap FROM t', ['heap'])).toContain('gc');
    });

    it('emits alloc for alloc column', () => {
        expect(tags('SELECT allocated FROM t', ['allocated'])).toContain('alloc');
    });

    it('emits cpu for cpu column', () => {
        expect(tags('SELECT cpuLoad FROM t', ['cpuLoad'])).toContain('cpu');
    });

    it('emits stack for stack column name', () => {
        expect(tags('SELECT stackTrace FROM t', ['stackTrace'])).toContain('stack');
    });
});

// ─── delta / range signals ────────────────────────────────────────────────────

describe('extractInputSignals — delta and range signals', () => {
    it('emits delta for heap_delta', () => {
        expect(tags('SELECT heap_delta FROM t', ['heap_delta'])).toContain('delta');
    });

    it('does not emit delta for change_count (counter suffix)', () => {
        expect(tags('SELECT change_count FROM t', ['change_count'])).not.toContain('delta');
    });

    it('emits range for start + end columns', () => {
        expect(tags('SELECT startTime, endTime FROM t', ['startTime', 'endTime'])).toContain('range');
    });

    it('emits range for min/max columns', () => {
        expect(tags('SELECT minVal, maxVal FROM t', ['minVal', 'maxVal'])).toContain('range');
    });

    it('does not emit range when only start present', () => {
        expect(tags('SELECT startTime, count FROM t', ['startTime', 'count'])).not.toContain('range');
    });
});

// ─── numeric / categorical counts ────────────────────────────────────────────

describe('extractInputSignals — num/cat tags', () => {
    it('includes num:N tag', () => {
        const result = extractInputSignals('SELECT x FROM t', [{ name: 'x', type: 'INTEGER' }]);
        expect(result).toContain('num:');
    });

    it('includes cat:N tag', () => {
        const result = extractInputSignals('SELECT x FROM t', [{ name: 'x', type: 'VARCHAR' }]);
        expect(result).toContain('cat:');
    });

    it('caps num count at 4', () => {
        const cols: TypedColumn[] = Array.from({ length: 6 }, (_, i) => ({ name: `n${i}`, type: 'INTEGER' }));
        const result = extractInputSignals('SELECT * FROM t', cols);
        expect(result).toContain('num:4');
        expect(result).not.toContain('num:5');
        expect(result).not.toContain('num:6');
    });
});

// ─── TypedColumn vs string columns ───────────────────────────────────────────

describe('extractInputSignals — column input formats', () => {
    it('accepts plain string columns', () => {
        const result = extractInputSignals('SELECT cause FROM t', ['cause']);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('accepts TypedColumn objects', () => {
        const result = extractInputSignals('SELECT cause FROM t', [{ name: 'cause', type: 'VARCHAR' }]);
        expect(typeof result).toBe('string');
    });

    it('handles empty column list', () => {
        const result = extractInputSignals('SELECT * FROM t', []);
        expect(result).toContain('num:0');
        expect(result).toContain('cat:0');
    });
});
