import { describe, it, expect } from 'vitest';
import { extractInputSignals } from '../../services/ml/candidates';

describe('extractInputSignals', () => {
    describe('SQL clause flags', () => {
        it('emits "agg" for GROUP BY queries', () => {
            const s = extractInputSignals('SELECT cause, COUNT(*) FROM GarbageCollections GROUP BY cause', ['cause', 'count']);
            expect(s).toContain('agg');
        });

        it('emits "ordered" for ORDER BY + LIMIT', () => {
            const s = extractInputSignals('SELECT cause, cnt FROM t ORDER BY cnt DESC LIMIT 10', ['cause', 'cnt']);
            expect(s).toContain('ordered');
        });

        it('does NOT emit "ordered" for ORDER BY without LIMIT', () => {
            const s = extractInputSignals('SELECT t, v FROM t ORDER BY t', ['t', 'v']);
            expect(s).not.toContain('ordered');
        });

        it('emits "having" for HAVING queries', () => {
            const s = extractInputSignals('SELECT x, COUNT(*) FROM t GROUP BY x HAVING COUNT(*) > 5', ['x', 'count']);
            expect(s).toContain('having');
        });
    });

    describe('column count signals', () => {
        it('emits "wide" for 3+ columns', () => {
            const s = extractInputSignals('SELECT a, b, c FROM t', ['a', 'b', 'c']);
            expect(s).toContain('wide');
        });

        it('does NOT emit "wide" for 2 columns', () => {
            const s = extractInputSignals('SELECT a, b FROM t', ['a', 'b']);
            expect(s).not.toContain('wide');
        });
    });

    describe('time signal', () => {
        it('emits "time" for timestamp column names', () => {
            const s = extractInputSignals('SELECT startTime, pauseMs FROM t', ['startTime', 'pauseMs']);
            expect(s).toContain('time');
        });

        it('emits "time" for "bucket" column name', () => {
            const s = extractInputSignals('SELECT bucket, count FROM t', ['bucket', 'count']);
            expect(s).toContain('time');
        });

        it('emits "time" for typed TIMESTAMP column', () => {
            const s = extractInputSignals('SELECT t, v FROM t', [
                { name: 't', type: 'TIMESTAMP' },
                { name: 'v', type: 'DOUBLE' },
            ]);
            expect(s).toContain('time');
        });

        it('emits "time" for _at suffix (created_at, occurred_at, etc.)', () => {
            const s = extractInputSignals('SELECT created_at, value FROM metrics ORDER BY created_at', ['created_at', 'value']);
            expect(s).toContain('time');
        });

        it('emits "time" for _ts suffix (event_ts, log_ts)', () => {
            const s = extractInputSignals('SELECT log_ts, cpu_pct FROM stats ORDER BY log_ts', ['log_ts', 'cpu_pct']);
            expect(s).toContain('time');
        });

        it('emits "time" for bare "ts" column name', () => {
            const s = extractInputSignals('SELECT ts, value FROM metrics ORDER BY ts', ['ts', 'value']);
            expect(s).toContain('time');
        });

        it('does NOT emit "time" for pure numeric columns', () => {
            const s = extractInputSignals('SELECT pauseMs, heapUsed FROM t', ['pauseMs', 'heapUsed']);
            expect(s).not.toContain('time');
        });

        it('does NOT count _at columns as categorical', () => {
            const s = extractInputSignals('SELECT created_at, value FROM t', ['created_at', 'value']);
            // created_at should not be cat (it's a time column)
            expect(s).not.toContain('cat:2');
        });
    });

    describe('stack signal', () => {
        it('emits "stack" for stackFrames column', () => {
            const s = extractInputSignals('SELECT stackFrames, ticks FROM t', ['stackFrames', 'ticks']);
            expect(s).toContain('stack');
        });

        it('emits "stack" for frames column', () => {
            const s = extractInputSignals('SELECT frames, weight FROM t', ['frames', 'weight']);
            expect(s).toContain('stack');
        });
    });

    describe('JFR domain signals', () => {
        it('emits "gc" for gc-related column names', () => {
            const s = extractInputSignals('SELECT gcId, pauseMs FROM GarbageCollections', ['gcId', 'pauseMs']);
            expect(s).toContain('gc');
        });

        it('emits "gc" when SQL references GC tables', () => {
            const s = extractInputSignals('SELECT id FROM GarbageCollections', ['id']);
            expect(s).toContain('gc');
        });

        it('emits "alloc" for allocation columns', () => {
            const s = extractInputSignals('SELECT allocSize, className FROM t', ['allocSize', 'className']);
            expect(s).toContain('alloc');
        });

        it('emits "cpu" for cpu/thread columns', () => {
            const s = extractInputSignals('SELECT cpuLoad, threadName FROM t', ['cpuLoad', 'threadName']);
            expect(s).toContain('cpu');
        });

        it('emits "delta" for delta/change/diff column names (WATERFALL hint)', () => {
            const s = extractInputSignals('SELECT phase, delta FROM gc_phases', ['phase', 'delta']);
            expect(s).toContain('delta');
        });

        it('emits "delta" for change/increment/decrement columns', () => {
            const s = extractInputSignals('SELECT step, change FROM waterfall_data', ['step', 'change']);
            expect(s).toContain('delta');
        });
    });

    describe('num/cat counts', () => {
        it('counts numeric columns by name heuristic', () => {
            const s = extractInputSignals('SELECT pauseMs, heapUsed FROM t', ['pauseMs', 'heapUsed']);
            expect(s).toContain('num:2');
        });

        it('counts categorical columns', () => {
            const s = extractInputSignals('SELECT cause, gcType FROM t', ['cause', 'gcType']);
            // cause and gcType have no numeric patterns → categorised as cat
            expect(s).toMatch(/cat:[1-9]/);
        });

        it('uses type info when provided', () => {
            const s = extractInputSignals('SELECT x, y FROM t', [
                { name: 'x', type: 'INTEGER' },
                { name: 'y', type: 'VARCHAR' },
            ]);
            expect(s).toContain('num:1');
            expect(s).toContain('cat:1');
        });

        it('caps counts at 4', () => {
            const s = extractInputSignals(
                'SELECT a, b, c, d, e FROM t',
                [
                    { name: 'pauseMs', type: 'DOUBLE' },
                    { name: 'heapUsed', type: 'BIGINT' },
                    { name: 'duration', type: 'INTEGER' },
                    { name: 'count', type: 'BIGINT' },
                    { name: 'rate', type: 'DOUBLE' },
                ],
            );
            expect(s).toContain('num:4');
        });
    });

    describe('combined real-world cases', () => {
        it('LINE_CHART case: time column + wide', () => {
            const s = extractInputSignals(
                'SELECT startTime, "Used MB", "Heap MB" FROM gc_heap_summary ORDER BY startTime',
                ['startTime', 'Used MB', 'Heap MB'],
            );
            expect(s).toContain('time');
            expect(s).toContain('wide');
            expect(s).toContain('gc');
        });

        it('BAR_CHART case: agg + ordered', () => {
            const s = extractInputSignals(
                'SELECT cause, COUNT(*) as cnt FROM GarbageCollections GROUP BY cause ORDER BY cnt DESC LIMIT 10',
                ['cause', 'cnt'],
            );
            expect(s).toContain('agg');
            expect(s).toContain('ordered');
        });

        it('FLAMEGRAPH case: stack column', () => {
            const s = extractInputSignals(
                'SELECT stackFrames, ticks FROM cpu_hot_methods',
                ['stackFrames', 'ticks'],
            );
            expect(s).toContain('stack');
        });
    });
});
