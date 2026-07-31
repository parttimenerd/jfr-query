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

        it('emits "sorted" for ORDER BY without LIMIT (BAR_CHART discriminator)', () => {
            const s = extractInputSignals('SELECT name, pauseDuration FROM t GROUP BY name ORDER BY pauseDuration DESC', ['name', 'pauseDuration']);
            expect(s).toContain('sorted');
            expect(s).not.toContain('ordered');
        });

        it('does NOT emit "sorted" for ORDER BY with LIMIT (that is "ordered")', () => {
            const s = extractInputSignals('SELECT cause, cnt FROM t ORDER BY cnt DESC LIMIT 10', ['cause', 'cnt']);
            expect(s).not.toContain('sorted');
            expect(s).toContain('ordered');
        });

        it('does NOT emit "sorted" when no ORDER BY present', () => {
            const s = extractInputSignals('SELECT x, y, z FROM t GROUP BY x, y', ['x', 'y', 'z']);
            expect(s).not.toContain('sorted');
        });

        it('emits "cross" for GROUP BY 2+ cols without ORDER BY (HEATMAP discriminator)', () => {
            const s = extractInputSignals('SELECT thread, lockClass, duration FROM t GROUP BY thread, lockClass', ['thread', 'lockClass', 'duration']);
            expect(s).toContain('cross');
        });

        it('does NOT emit "cross" when ORDER BY is present (that is BAR_CHART territory)', () => {
            const s = extractInputSignals('SELECT name, phase, max FROM t GROUP BY name, phase ORDER BY max DESC', ['name', 'phase', 'max']);
            expect(s).not.toContain('cross');
        });

        it('does NOT emit "cross" for single-column GROUP BY', () => {
            const s = extractInputSignals('SELECT cause, COUNT(*) FROM t GROUP BY cause', ['cause', 'count']);
            expect(s).not.toContain('cross');
        });

        it('emits "having" for HAVING queries', () => {
            const s = extractInputSignals('SELECT x, COUNT(*) FROM t GROUP BY x HAVING COUNT(*) > 5', ['x', 'count']);
            expect(s).toContain('having');
        });

        it('emits "raw" for SELECT with LIMIT and no GROUP/AGG/ORDER (TABLE discriminator)', () => {
            const s = extractInputSignals('SELECT className, allocSize FROM ObjectAllocations LIMIT 100', ['className', 'allocSize']);
            expect(s).toContain('raw');
        });

        it('does NOT emit "raw" when ORDER BY is present', () => {
            const s = extractInputSignals('SELECT name, cnt FROM t ORDER BY cnt LIMIT 10', ['name', 'cnt']);
            expect(s).not.toContain('raw');
        });

        it('does NOT emit "raw" when GROUP BY is present', () => {
            const s = extractInputSignals('SELECT cause, COUNT(*) FROM t GROUP BY cause LIMIT 10', ['cause', 'count']);
            expect(s).not.toContain('raw');
        });

        it('does NOT emit "raw" when no LIMIT is present', () => {
            const s = extractInputSignals('SELECT name, value FROM t', ['name', 'value']);
            expect(s).not.toContain('raw');
        });

        it('emits "scalar" for aggregate fn without GROUP BY (TABLE discriminator)', () => {
            const s = extractInputSignals('SELECT COUNT(*) as total FROM GarbageCollections', ['total']);
            expect(s).toContain('scalar');
        });

        it('emits "scalar" for SUM/AVG/MIN/MAX without GROUP BY', () => {
            const s = extractInputSignals('SELECT AVG(pauseMs) as avgPause, MAX(pauseMs) as maxPause FROM GarbageCollections', ['avgPause', 'maxPause']);
            expect(s).toContain('scalar');
        });

        it('does NOT emit "scalar" when GROUP BY is present', () => {
            const s = extractInputSignals('SELECT cause, COUNT(*) FROM t GROUP BY cause', ['cause', 'count']);
            expect(s).not.toContain('scalar');
        });

        it('emits "cnt_agg" for COUNT() with GROUP BY (PIE_CHART discriminator)', () => {
            const s = extractInputSignals('SELECT cause, COUNT(*) FROM GarbageCollections GROUP BY cause', ['cause', 'count']);
            expect(s).toContain('cnt_agg');
        });

        it('does NOT emit "cnt_agg" without GROUP BY', () => {
            const s = extractInputSignals('SELECT COUNT(*) as total FROM t', ['total']);
            expect(s).not.toContain('cnt_agg');
        });

        it('does NOT emit "cnt_agg" for SUM with GROUP BY', () => {
            const s = extractInputSignals('SELECT cause, SUM(duration) FROM t GROUP BY cause', ['cause', 'duration']);
            expect(s).not.toContain('cnt_agg');
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

        it('emits "solo" for exactly 1 column (HISTOGRAM discriminator)', () => {
            const s = extractInputSignals('SELECT pauseMs FROM GarbageCollections', ['pauseMs']);
            expect(s).toContain('solo');
            expect(s).not.toContain('duo');
            expect(s).not.toContain('wide');
        });

        it('emits "duo" for exactly 2 columns (PIE/FLAMEGRAPH/TREEMAP/WATERFALL discriminator)', () => {
            const s = extractInputSignals('SELECT cause, COUNT(*) FROM t GROUP BY cause', ['cause', 'count']);
            expect(s).toContain('duo');
            expect(s).not.toContain('solo');
            expect(s).not.toContain('wide');
        });

        it('does NOT emit "solo" or "duo" for 3+ columns', () => {
            const s = extractInputSignals('SELECT a, b, c FROM t', ['a', 'b', 'c']);
            expect(s).not.toContain('solo');
            expect(s).not.toContain('duo');
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

        it('emits "range" when both start/low and end/high columns present (RANGE/GANTT hint)', () => {
            const s = extractInputSignals('SELECT startTime, endTime, phase FROM gc_phases', ['startTime', 'endTime', 'phase']);
            expect(s).toContain('range');
        });

        it('emits "range" for low/high column pairs', () => {
            const s = extractInputSignals('SELECT bucket, low, high, avg FROM stats', ['bucket', 'low', 'high', 'avg']);
            expect(s).toContain('range');
        });

        it('emits "range" for percentile pairs p5/p95 (RANGE plot indicator)', () => {
            const s = extractInputSignals('SELECT bucket, p5, p95 FROM latency_stats', ['bucket', 'p5', 'p95']);
            expect(s).toContain('range');
        });

        it('emits "range" for min*/max* column name prefixes', () => {
            const s = extractInputSignals('SELECT startTime, minPause, maxPause FROM gc', ['startTime', 'minPause', 'maxPause']);
            expect(s).toContain('range');
        });

        it('does NOT emit "range" when only start column present', () => {
            const s = extractInputSignals('SELECT startTime, duration FROM gc', ['startTime', 'duration']);
            expect(s).not.toContain('range');
        });

        it('emits "num_range" for time column + min*/max* numeric band (RANGE indicator)', () => {
            const s = extractInputSignals('SELECT startTime, minPause, maxPause FROM gc ORDER BY startTime', ['startTime', 'minPause', 'maxPause']);
            expect(s).toContain('num_range');
        });

        it('emits "num_range" for time column + percentile band columns', () => {
            const s = extractInputSignals('SELECT bucket, p5, p50, p95 FROM latency ORDER BY bucket', ['bucket', 'p5', 'p50', 'p95']);
            expect(s).toContain('num_range');
        });

        it('does NOT emit "num_range" for GANTT-style time+category interval (no numeric bands)', () => {
            const s = extractInputSignals('SELECT startTime, endTime, phase FROM gc_phases ORDER BY startTime', ['startTime', 'endTime', 'phase']);
            expect(s).not.toContain('num_range');
        });

        it('does NOT emit "num_range" without a time column', () => {
            const s = extractInputSignals('SELECT cause, minAlloc, maxAlloc FROM t', ['cause', 'minAlloc', 'maxAlloc']);
            expect(s).not.toContain('num_range');
        });

        it('does NOT emit "delta" for compound column names like change_count', () => {
            const s = extractInputSignals('SELECT flag_name, change_count FROM metadata GROUP BY flag_name ORDER BY change_count DESC LIMIT 20', ['flag_name', 'change_count']);
            expect(s).not.toContain('delta');
        });

        it('does NOT emit "delta" for exchange_rate (change embedded mid-word)', () => {
            const s = extractInputSignals('SELECT currency, exchange_rate FROM rates', ['currency', 'exchange_rate']);
            expect(s).not.toContain('delta');
        });

        it('emits "delta" for heap_delta column name (suffix)', () => {
            const s = extractInputSignals('SELECT phase, heap_delta FROM gc_phases', ['phase', 'heap_delta']);
            expect(s).toContain('delta');
        });

        it('emits "gantt_span" for category + two time-named start/end columns', () => {
            const s = extractInputSignals('SELECT phase, start_ts, end_ts FROM concurrent_gc_phases ORDER BY start_ts', ['phase', 'start_ts', 'end_ts']);
            expect(s).toContain('gantt_span');
        });

        it('emits "gantt_span" for task_name + startTime + endTime columns', () => {
            const s = extractInputSignals('SELECT task_name, start_time, end_time FROM tasks ORDER BY start_time', ['task_name', 'start_time', 'end_time']);
            expect(s).toContain('gantt_span');
        });

        it('does NOT emit "gantt_span" when numeric bands are present (RANGE scenario)', () => {
            const s = extractInputSignals('SELECT bucket, p5, p95 FROM latency ORDER BY bucket', ['bucket', 'p5', 'p95']);
            expect(s).not.toContain('gantt_span');
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
