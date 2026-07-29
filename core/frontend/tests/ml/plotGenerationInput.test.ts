// Tests that the model input pipeline (extractInputSignals + SEQ2SEQ_INPUT_V3)
// produces the correct signal fingerprints for the canonical completion scenarios.
//
// These tests guard against signal extraction regressions: if extractInputSignals
// produces wrong tags, the in-tree T5-small model will silently mispredict even
// if its weights are correct.
//
// Mirrors the 90-scenario Python test in scripts/train/test_completion_scenarios.py
// but tests the TypeScript signal path only (no ONNX required).

import { describe, it, expect } from 'vitest';
import { extractInputSignals, CANDIDATES } from '../../services/ml/candidates';

const buildInput = CANDIDATES['plot-suggester-local'].buildInput;

// ── helpers ─────────────────────────────────────────────────────────────────

function signals(sql: string, columns: string[]): string {
    return extractInputSignals(sql, columns);
}

function input(sql: string, columns: string[]): string {
    return buildInput(sql, columns);
}

// ── LINE_CHART ───────────────────────────────────────────────────────────────

describe('LINE_CHART scenarios', () => {
    it('time-series aggregation → agg sorted time duo', () => {
        const sql = "SELECT time_bucket('1s', ts) AS bucket, avg(pause_ms) AS avg_pause FROM gc_events GROUP BY bucket ORDER BY bucket";
        const cols = ['bucket', 'avg_pause'];
        const s = signals(sql, cols);
        expect(s).toContain('agg');
        expect(s).toContain('sorted');
        expect(s).toContain('time');
        expect(s).toContain('duo');
        expect(s).not.toContain('ordered');   // no LIMIT → sorted not ordered
    });

    it('buildInput includes hints: header with signals', () => {
        const sql = "SELECT time_bucket('1s', ts) AS bucket, avg(pause_ms) AS avg_pause FROM gc_events GROUP BY bucket ORDER BY bucket";
        const cols = ['bucket', 'avg_pause'];
        const inp = input(sql, cols);
        expect(inp).toMatch(/^hints: /);
        expect(inp).toContain('agg');
        expect(inp).toContain('sorted');
        expect(inp).toContain(`sql: ${sql}`);
        expect(inp).toContain('columns:');
    });
});

// ── BAR_CHART ────────────────────────────────────────────────────────────────

describe('BAR_CHART scenarios', () => {
    it('top-N aggregation → agg ordered cnt_agg duo', () => {
        const sql = 'SELECT method_name, sum(samples) AS total_samples FROM method_samples GROUP BY method_name ORDER BY total_samples DESC LIMIT 20';
        const cols = ['method_name', 'total_samples'];
        const s = signals(sql, cols);
        expect(s).toContain('agg');
        expect(s).toContain('ordered');      // ORDER BY + LIMIT → ranked top-N
        expect(s).toContain('duo');
        expect(s).not.toContain('sorted');   // has LIMIT so it's "ordered", not "sorted"
    });

    it('pure count top-N → agg ordered cnt_agg', () => {
        const sql = 'SELECT gc_cause, COUNT(*) AS event_count FROM gc_events GROUP BY gc_cause ORDER BY event_count DESC LIMIT 10';
        const cols = ['gc_cause', 'event_count'];
        const s = signals(sql, cols);
        expect(s).toContain('agg');
        expect(s).toContain('ordered');
        expect(s).toContain('cnt_agg');
        expect(s).toContain('duo');
    });
});

// ── HISTOGRAM ────────────────────────────────────────────────────────────────

describe('HISTOGRAM scenarios', () => {
    it('ordered+solo (ORDER BY LIMIT single numeric) → ordered solo', () => {
        const sql = 'SELECT pause_ms FROM gc_events ORDER BY pause_ms LIMIT 10000';
        const cols = ['pause_ms'];
        const s = signals(sql, cols);
        expect(s).toContain('ordered');
        expect(s).toContain('solo');
        expect(s).not.toContain('agg');
    });

    it('raw+solo (LIMIT only, no ORDER BY) → raw solo', () => {
        const sql = 'SELECT pause_ms FROM gc_events LIMIT 10000';
        const cols = ['pause_ms'];
        const s = signals(sql, cols);
        expect(s).toContain('raw');
        expect(s).toContain('solo');
        expect(s).not.toContain('ordered');
        expect(s).not.toContain('agg');
    });
});

// ── BOX_PLOT ─────────────────────────────────────────────────────────────────

describe('BOX_PLOT scenarios', () => {
    it('category + numeric raw → ordered duo cat:1 num:1', () => {
        const sql = 'SELECT gc_type, pause_ms FROM gc_events ORDER BY gc_type LIMIT 10000';
        const cols = ['gc_type', 'pause_ms'];
        const s = signals(sql, cols);
        expect(s).toContain('ordered');
        expect(s).toContain('duo');
        expect(s).toContain('cat:1');
        expect(s).toContain('num:1');
    });

    it('raw category + numeric (LIMIT only) → raw duo cat:1', () => {
        const sql = 'SELECT gc_type, pause_ms FROM gc_events LIMIT 5000';
        const cols = ['gc_type', 'pause_ms'];
        const s = signals(sql, cols);
        expect(s).toContain('raw');
        expect(s).toContain('duo');
        expect(s).toContain('cat:1');
        expect(s).toContain('num:1');
        expect(s).not.toContain('ordered');
    });
});

// ── SCATTER_PLOT ─────────────────────────────────────────────────────────────

describe('SCATTER_PLOT scenarios', () => {
    it('two numerics no GROUP BY → duo num:2 cat:0', () => {
        const sql = 'SELECT cpu_pct, alloc_rate FROM thread_stats GROUP BY thread_id LIMIT 1000';
        const cols = ['cpu_pct', 'alloc_rate'];
        const s = signals(sql, cols);
        expect(s).toContain('duo');
        expect(s).toContain('num:2');
        expect(s).toContain('cat:0');
    });

    it('aggregated two numerics (agg+duo+num:2+cat:0) → SCATTER fingerprint', () => {
        const sql = 'SELECT avg(cpu_pct) AS cpu_pct, avg(alloc_rate) AS alloc_rate FROM cpu_profile GROUP BY thread_name';
        const cols = ['cpu_pct', 'alloc_rate'];
        const s = signals(sql, cols);
        expect(s).toContain('agg');
        expect(s).toContain('duo');
        expect(s).toContain('num:2');
        expect(s).toContain('cat:0');
    });
});

// ── PIE_CHART ────────────────────────────────────────────────────────────────

describe('PIE_CHART scenarios', () => {
    it('count aggregation by category → agg cnt_agg duo cat:1 num:1', () => {
        const sql = 'SELECT gc_cause, count(*) AS event_count FROM gc_events GROUP BY gc_cause';
        const cols = ['gc_cause', 'event_count'];
        const s = signals(sql, cols);
        expect(s).toContain('agg');
        expect(s).toContain('cnt_agg');
        expect(s).toContain('duo');
        expect(s).toContain('cat:1');
    });

    it('count aggregation does NOT get "ordered" without LIMIT', () => {
        const sql = 'SELECT gc_cause, count(*) AS event_count FROM gc_events GROUP BY gc_cause';
        const cols = ['gc_cause', 'event_count'];
        const s = signals(sql, cols);
        expect(s).not.toContain('ordered');
    });
});

// ── HEATMAP ──────────────────────────────────────────────────────────────────

describe('HEATMAP scenarios', () => {
    it('GROUP BY two categoricals → agg cross wide cat:2+', () => {
        const sql = 'SELECT thread_name, method_name, sum(cpu_ticks) AS cpu FROM cpu_events GROUP BY thread_name, method_name';
        const cols = ['thread_name', 'method_name', 'cpu'];
        const s = signals(sql, cols);
        expect(s).toContain('agg');
        expect(s).toContain('cross');        // GROUP BY 2+ cols, no ORDER BY
        expect(s).toContain('wide');
        expect(s).not.toContain('ordered');
    });

    it('no ORDER BY GROUP BY two cols → cross signal for heatmap', () => {
        const sql = 'SELECT thread, phase, avg(dur_ms) AS avg_dur FROM events GROUP BY thread, phase';
        const cols = ['thread', 'phase', 'avg_dur'];
        const s = signals(sql, cols);
        expect(s).toContain('cross');
        expect(s).not.toContain('ordered');
    });
});

// ── FLAMEGRAPH ───────────────────────────────────────────────────────────────

describe('FLAMEGRAPH scenarios', () => {
    it('stack trace aggregate → agg ordered stack duo', () => {
        const sql = 'SELECT stack_trace, sum(samples) AS sample_count FROM cpu_samples GROUP BY stack_trace ORDER BY sample_count DESC LIMIT 1000';
        const cols = ['stack_trace', 'sample_count'];
        const s = signals(sql, cols);
        expect(s).toContain('agg');
        expect(s).toContain('ordered');
        expect(s).toContain('stack');        // stack_trace column → stack signal
        expect(s).toContain('duo');
    });
});

// ── GANTT ────────────────────────────────────────────────────────────────────

describe('GANTT scenarios', () => {
    it('start/end time columns → ordered wide range', () => {
        const sql = 'SELECT phase_name, start_time, end_time FROM gc_phases ORDER BY start_time LIMIT 100';
        const cols = ['phase_name', 'start_time', 'end_time'];
        const s = signals(sql, cols);
        expect(s).toContain('ordered');
        expect(s).toContain('wide');
        expect(s).toContain('range');        // start + end → range signal
    });

    it('lock events with ORDER BY LIMIT → ordered wide', () => {
        const sql = 'SELECT thread_name, lock_start, lock_end FROM lock_events ORDER BY lock_start LIMIT 500';
        const cols = ['thread_name', 'lock_start', 'lock_end'];
        const s = signals(sql, cols);
        expect(s).toContain('ordered');
        expect(s).toContain('wide');
        expect(s).toContain('range');
    });
});

// ── RANGE ────────────────────────────────────────────────────────────────────

describe('RANGE scenarios', () => {
    it('percentile band columns → range num_range', () => {
        const sql = "SELECT time_bucket('5s', ts) AS bucket, p25, p50, p75, p95 FROM pause_percentiles ORDER BY bucket";
        const cols = ['bucket', 'p25', 'p50', 'p75', 'p95'];
        const s = signals(sql, cols);
        expect(s).toContain('range');        // p25/p95 → range bound detection
        expect(s).toContain('time');         // bucket is a time column
    });
});

// ── TREEMAP ──────────────────────────────────────────────────────────────────

describe('TREEMAP scenarios', () => {
    it('SUM aggregation by category (no cnt_agg) → agg duo num:1 cat:1', () => {
        const sql = 'SELECT class_name, sum(alloc_size_mb) AS total_alloc_mb FROM alloc_events GROUP BY class_name';
        const cols = ['class_name', 'total_alloc_mb'];
        const s = signals(sql, cols);
        expect(s).toContain('agg');
        expect(s).toContain('duo');
        expect(s).not.toContain('cnt_agg');  // SUM not COUNT → no cnt_agg
        expect(s).toContain('cat:1');
        expect(s).toContain('num:1');
    });
});

// ── WATERFALL ────────────────────────────────────────────────────────────────

describe('WATERFALL scenarios', () => {
    it('heap_delta column → delta signal', () => {
        const sql = 'SELECT gc_id, heap_delta_mb FROM gc_events ORDER BY gc_id LIMIT 50';
        const cols = ['gc_id', 'heap_delta_mb'];
        const s = signals(sql, cols);
        expect(s).toContain('delta');        // heap_delta → delta signal
        expect(s).toContain('duo');
    });

    it('phase + heap_delta → delta duo', () => {
        const sql = 'SELECT phase, heap_delta FROM phases ORDER BY phase';
        const cols = ['phase', 'heap_delta'];
        const s = signals(sql, cols);
        expect(s).toContain('delta');
        expect(s).toContain('duo');
    });
});

// ── TABLE ────────────────────────────────────────────────────────────────────

describe('TABLE scenarios', () => {
    it('raw multi-column event query → ordered wide', () => {
        const sql = 'SELECT ts, gc_type, pause_ms, heap_before_mb, heap_after_mb FROM gc_events ORDER BY ts LIMIT 100';
        const cols = ['ts', 'gc_type', 'pause_ms', 'heap_before_mb', 'heap_after_mb'];
        const s = signals(sql, cols);
        expect(s).toContain('ordered');
        expect(s).toContain('wide');
        expect(s).toContain('time');
    });

    it('scalar aggregate query → scalar wide (not ordered)', () => {
        const sql = 'SELECT count(*) AS events, sum(pause_ms) AS total_pause, avg(pause_ms) AS avg_pause, max(pause_ms) AS max_pause FROM gc_events';
        const cols = ['events', 'total_pause', 'avg_pause', 'max_pause'];
        const s = signals(sql, cols);
        expect(s).toContain('scalar');
        expect(s).toContain('wide');
        expect(s).not.toContain('agg');      // no GROUP BY → scalar, not agg
        expect(s).not.toContain('ordered');
    });
});

// ── AREA_CHART ───────────────────────────────────────────────────────────────

describe('AREA_CHART scenarios', () => {
    it('GROUP BY time + category → agg sorted wide time', () => {
        const sql = "SELECT time_bucket('1s', ts) AS bucket, class_name, sum(alloc_size_kb) AS alloc_kb FROM alloc_events GROUP BY bucket, class_name ORDER BY bucket";
        const cols = ['bucket', 'class_name', 'alloc_kb'];
        const s = signals(sql, cols);
        expect(s).toContain('agg');
        expect(s).toContain('sorted');
        expect(s).toContain('wide');
        expect(s).toContain('time');
        expect(s).not.toContain('cross');    // ORDER BY present → not cross
    });
});

// ── buildInput format ────────────────────────────────────────────────────────

describe('buildInput format contract', () => {
    it('always starts with "hints: " line', () => {
        const sql = 'SELECT cause, count(*) AS n FROM t GROUP BY cause';
        const cols = ['cause', 'n'];
        const inp = input(sql, cols);
        expect(inp).toMatch(/^hints: [a-z]/);
    });

    it('second line starts with "sql: "', () => {
        const sql = 'SELECT cause, count(*) AS n FROM t GROUP BY cause';
        const cols = ['cause', 'n'];
        const lines = input(sql, cols).split('\n');
        expect(lines[1]).toMatch(/^sql: /);
    });

    it('third line starts with "columns: "', () => {
        const sql = 'SELECT cause, count(*) AS n FROM t GROUP BY cause';
        const cols = ['cause', 'n'];
        const lines = input(sql, cols).split('\n');
        expect(lines[2]).toMatch(/^columns: /);
    });

    it('typed columns include type annotation in columns line', () => {
        const sql = 'SELECT ts, pause_ms FROM t LIMIT 100';
        const cols = [
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'pause_ms', type: 'DOUBLE' },
        ];
        const inp = buildInput(sql, cols);
        expect(inp).toContain('"ts" TIMESTAMP');
        expect(inp).toContain('"pause_ms" DOUBLE');
    });

    it('schema section appended when provided', () => {
        const sql = 'SELECT ts, pause_ms FROM gc_events LIMIT 10';
        const cols = ['ts', 'pause_ms'];
        const schema = [{ name: 'gc_events', columns: [{ name: 'ts' }, { name: 'pause_ms' }] }];
        const inp = buildInput(sql, cols, schema);
        expect(inp).toContain('schema:');
        expect(inp).toContain('"gc_events"');
    });

    it('schema capped at 3 tables', () => {
        const sql = 'SELECT x FROM t';
        const cols = ['x'];
        const schema = [
            { name: 'a', columns: [{ name: 'x' }] },
            { name: 'b', columns: [{ name: 'x' }] },
            { name: 'c', columns: [{ name: 'x' }] },
            { name: 'd', columns: [{ name: 'x' }] },  // should be dropped
        ];
        const inp = buildInput(sql, cols, schema);
        expect(inp).toContain('"a"');
        expect(inp).toContain('"c"');
        expect(inp).not.toContain('"d"');
    });
});

// ── Signal regression guards ─────────────────────────────────────────────────
// These pin specific edge cases where signal extraction was previously wrong.

describe('signal regression guards', () => {
    it('ORDER BY without LIMIT → sorted, NOT ordered', () => {
        const sql = 'SELECT name, SUM(v) AS total FROM t GROUP BY name ORDER BY total DESC';
        const s = signals(sql, ['name', 'total']);
        expect(s).toContain('sorted');
        expect(s).not.toContain('ordered');
    });

    it('ORDER BY with LIMIT → ordered, NOT sorted', () => {
        const sql = 'SELECT name, SUM(v) AS total FROM t GROUP BY name ORDER BY total DESC LIMIT 10';
        const s = signals(sql, ['name', 'total']);
        expect(s).toContain('ordered');
        expect(s).not.toContain('sorted');
    });

    it('cross signal requires GROUP BY 2+ cols AND no ORDER BY', () => {
        const sql = 'SELECT a, b, sum(v) AS v FROM t GROUP BY a, b';
        const s = signals(sql, ['a', 'b', 'v']);
        expect(s).toContain('cross');

        const sqlOrdered = 'SELECT a, b, sum(v) AS v FROM t GROUP BY a, b ORDER BY v';
        const s2 = signals(sqlOrdered, ['a', 'b', 'v']);
        expect(s2).not.toContain('cross');
    });

    it('scalar requires aggregate fn without GROUP BY', () => {
        const sql = 'SELECT COUNT(*) AS n, AVG(pause_ms) AS avg FROM gc_events';
        const s = signals(sql, ['n', 'avg']);
        expect(s).toContain('scalar');
        expect(s).not.toContain('agg');  // no GROUP BY

        // With GROUP BY → agg not scalar
        const sqlGrouped = 'SELECT cause, COUNT(*) AS n FROM gc_events GROUP BY cause';
        const s2 = signals(sqlGrouped, ['cause', 'n']);
        expect(s2).toContain('agg');
        expect(s2).not.toContain('scalar');
    });

    it('raw requires LIMIT with no ORDER BY and no GROUP BY', () => {
        const sql = 'SELECT ts, pause_ms FROM gc_events LIMIT 1000';
        const s = signals(sql, ['ts', 'pause_ms']);
        expect(s).toContain('raw');

        // Adding ORDER BY removes raw
        const sqlOrdered = 'SELECT ts, pause_ms FROM gc_events ORDER BY ts LIMIT 1000';
        const s2 = signals(sqlOrdered, ['ts', 'pause_ms']);
        expect(s2).not.toContain('raw');
        expect(s2).toContain('ordered');
    });

    it('stack signal fires on stack_trace column name', () => {
        const s = signals('SELECT stack_trace, n FROM t GROUP BY stack_trace', ['stack_trace', 'n']);
        expect(s).toContain('stack');
    });

    it('delta signal fires on heap_delta column name', () => {
        const s = signals('SELECT phase, heap_delta FROM t ORDER BY phase', ['phase', 'heap_delta']);
        expect(s).toContain('delta');
    });

    it('num:2 cat:0 for two plain numeric columns', () => {
        const s = signals('SELECT cpu_pct, alloc_rate FROM t LIMIT 100', ['cpu_pct', 'alloc_rate']);
        expect(s).toContain('num:2');
        expect(s).toContain('cat:0');
    });

    it('num:1 cat:1 for one numeric and one categorical', () => {
        const s = signals('SELECT gc_type, pause_ms FROM t LIMIT 100', ['gc_type', 'pause_ms']);
        expect(s).toContain('num:1');
        expect(s).toContain('cat:1');
    });
});
