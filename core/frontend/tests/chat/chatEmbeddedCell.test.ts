import { describe, it, expect } from 'vitest';
import { parseCellFence, splitCellFences } from '../../components/chat/ChatEmbeddedCell';

describe('parseCellFence', () => {
    it('parses a chart fence', () => {
        const fence = `type=chart
sql: SELECT bucket, avg(pause_ms) AS p FROM gc GROUP BY bucket ORDER BY bucket
plot: LINE_CHART(x: "bucket", y: ["p"])`;
        const result = parseCellFence(fence);
        expect(result).toEqual({
            type: 'chart',
            sql: 'SELECT bucket, avg(pause_ms) AS p FROM gc GROUP BY bucket ORDER BY bucket',
            plotConfig: 'LINE_CHART(x: "bucket", y: ["p"])',
        });
    });

    it('parses a table fence (no plot)', () => {
        const fence = `type=table\nsql: SELECT * FROM gc_events LIMIT 10`;
        const result = parseCellFence(fence);
        expect(result).toEqual({ type: 'table', sql: 'SELECT * FROM gc_events LIMIT 10', plotConfig: undefined });
    });

    it('parses a flamegraph fence', () => {
        const fence = `type=flamegraph\nsql: SELECT stackTrace, sum(samples) AS n FROM ExecutionSample GROUP BY stackTrace ORDER BY n DESC LIMIT 500`;
        const result = parseCellFence(fence);
        expect(result?.type).toBe('flamegraph');
        expect(result?.sql).toContain('ExecutionSample');
    });

    it('returns null for malformed fence (no sql)', () => {
        const fence = `type=chart\nplot: LINE_CHART(x: "x", y: ["y"])`;
        expect(parseCellFence(fence)).toBeNull();
    });
});

describe('splitCellFences', () => {
    it('splits text with one fence into text + cell parts', () => {
        const text = `Here is the chart:\n:::cell type=chart\nsql: SELECT 1\n:::\nDone.`;
        const parts = splitCellFences(text);
        expect(parts).toHaveLength(3);
        expect(parts[0]).toEqual({ kind: 'text', content: 'Here is the chart:\n' });
        expect(parts[1]).toEqual({ kind: 'cell', content: 'type=chart\nsql: SELECT 1' });
        expect(parts[2]).toEqual({ kind: 'text', content: '\nDone.' });
    });

    it('handles multiple fences', () => {
        const text = `A\n:::cell type=table\nsql: SELECT 1\n:::\nB\n:::cell type=chart\nsql: SELECT 2\nplot: BAR_CHART(x: "x", y: "y")\n:::\nC`;
        const parts = splitCellFences(text);
        expect(parts.filter(p => p.kind === 'cell')).toHaveLength(2);
        expect(parts.filter(p => p.kind === 'text')).toHaveLength(3);
    });

    it('returns single text part when no fences', () => {
        const text = 'Just plain text.';
        const parts = splitCellFences(text);
        expect(parts).toHaveLength(1);
        expect(parts[0]).toEqual({ kind: 'text', content: 'Just plain text.' });
    });

    it('handles fence at start of text', () => {
        const text = `:::cell type=table\nsql: SELECT 1\n:::\nAfter`;
        const parts = splitCellFences(text);
        expect(parts[0].kind).toBe('cell');
        expect(parts[1]).toEqual({ kind: 'text', content: '\nAfter' });
    });
});
