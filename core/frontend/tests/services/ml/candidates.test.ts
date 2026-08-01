import { describe, it, expect } from 'vitest';
import { extractInputSignals, cleanPlotConfig } from '../../../services/ml/candidates';

// ── extractInputSignals ───────────────────────────────────────────────────────

describe('extractInputSignals', () => {
    // Helper: split tag string into set for order-independent assertions
    const tags = (sql: string, cols: any[]) =>
        new Set(extractInputSignals(sql, cols).split(' '));

    it('returns a non-empty string', () => {
        const result = extractInputSignals('SELECT * FROM t LIMIT 10', ['x']);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('emits agg tag for GROUP BY', () => {
        const t = tags('SELECT name, COUNT(*) FROM t GROUP BY name', ['name', 'count']);
        expect(t.has('agg')).toBe(true);
    });

    it('emits topN tag for GROUP BY + ORDER BY + LIMIT', () => {
        const t = tags(
            'SELECT name, COUNT(*) c FROM t GROUP BY name ORDER BY c DESC LIMIT 10',
            ['name', 'c'],
        );
        expect(t.has('topN')).toBe(true);
        expect(t.has('agg')).toBe(true);
    });

    it('emits ordered tag for ORDER BY + LIMIT without GROUP BY', () => {
        const t = tags('SELECT x FROM t ORDER BY x LIMIT 5', ['x']);
        expect(t.has('ordered')).toBe(true);
        expect(t.has('topN')).toBe(false);
    });

    it('emits sorted tag for ORDER BY without LIMIT', () => {
        const t = tags('SELECT x FROM t ORDER BY x', ['x']);
        expect(t.has('sorted')).toBe(true);
        expect(t.has('ordered')).toBe(false);
    });

    it('emits cross tag for GROUP BY 2+ cols without ORDER BY', () => {
        const t = tags('SELECT a, b, COUNT(*) FROM t GROUP BY a, b', ['a', 'b', 'count']);
        expect(t.has('cross')).toBe(true);
    });

    it('emits raw tag for plain SELECT with LIMIT and no GROUP BY/agg', () => {
        const t = tags('SELECT name, size FROM t LIMIT 10', ['name', 'size']);
        expect(t.has('raw')).toBe(true);
    });

    it('emits scalar tag for aggregate fn without GROUP BY', () => {
        const t = tags('SELECT COUNT(*) FROM t', ['count']);
        expect(t.has('scalar')).toBe(true);
    });

    it('emits cnt_agg tag for COUNT + GROUP BY', () => {
        const t = tags('SELECT name, COUNT(*) FROM t GROUP BY name', ['name', 'count']);
        expect(t.has('cnt_agg')).toBe(true);
    });

    it('emits sum_agg tag for SUM + GROUP BY', () => {
        const t = tags('SELECT name, SUM(val) FROM t GROUP BY name', ['name', 'val']);
        expect(t.has('sum_agg')).toBe(true);
    });

    it('emits solo tag for single column', () => {
        const t = tags('SELECT duration FROM t', ['duration']);
        expect(t.has('solo')).toBe(true);
        expect(t.has('duo')).toBe(false);
        expect(t.has('wide')).toBe(false);
    });

    it('emits duo tag for exactly two columns', () => {
        const t = tags('SELECT a, b FROM t', ['a', 'b']);
        expect(t.has('duo')).toBe(true);
        expect(t.has('solo')).toBe(false);
    });

    it('emits wide tag for 3+ columns', () => {
        const t = tags('SELECT a, b, c FROM t', ['a', 'b', 'c']);
        expect(t.has('wide')).toBe(true);
    });

    it('emits time tag when column name contains "time"', () => {
        const t = tags('SELECT startTime, count FROM t', ['startTime', 'count']);
        expect(t.has('time')).toBe(true);
    });

    it('emits time tag when column type is TIMESTAMP', () => {
        const t = tags('SELECT ts, val FROM t', [
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'val', type: 'DOUBLE' },
        ]);
        expect(t.has('time')).toBe(true);
    });

    it('emits stack tag for column named "stackTrace"', () => {
        const t = tags('SELECT stackTrace, samples FROM t', ['stackTrace', 'samples']);
        expect(t.has('stack')).toBe(true);
    });

    it('emits gc tag for gc-related column names', () => {
        const t = tags('SELECT gcPause, heapUsed FROM t', ['gcPause', 'heapUsed']);
        expect(t.has('gc')).toBe(true);
    });

    it('emits delta tag for column named "heap_delta"', () => {
        const t = tags('SELECT bucket, heap_delta FROM t', ['bucket', 'heap_delta']);
        expect(t.has('delta')).toBe(true);
    });

    it('does NOT emit delta tag for "change_count" (excluded pattern)', () => {
        const t = tags('SELECT name, change_count FROM t', ['name', 'change_count']);
        expect(t.has('delta')).toBe(false);
    });

    it('emits range tag for start + end column pair', () => {
        const t = tags('SELECT startTime, endTime, name FROM t', [
            'startTime', 'endTime', 'name',
        ]);
        expect(t.has('range')).toBe(true);
    });

    it('always emits num: and cat: count tags', () => {
        const result = extractInputSignals('SELECT x FROM t', ['x']);
        expect(result).toMatch(/num:\d/);
        expect(result).toMatch(/cat:\d/);
    });

    it('accepts TypedColumn objects as column descriptors', () => {
        const result = extractInputSignals('SELECT x FROM t', [
            { name: 'x', type: 'DOUBLE' },
        ]);
        expect(typeof result).toBe('string');
        expect(result).toContain('solo');
    });

    it('accepts plain string column names', () => {
        const result = extractInputSignals('SELECT x FROM t', ['x']);
        expect(typeof result).toBe('string');
        expect(result).toContain('solo');
    });

    it('emits having tag when SQL contains HAVING', () => {
        const t = tags(
            'SELECT name, COUNT(*) c FROM t GROUP BY name HAVING c > 1',
            ['name', 'c'],
        );
        expect(t.has('having')).toBe(true);
    });
});

// ── cleanPlotConfig ───────────────────────────────────────────────────────────

describe('cleanPlotConfig', () => {
    it('returns a clean plot config unchanged', () => {
        const input = 'BAR_CHART(x=col1, y=col2)';
        expect(cleanPlotConfig(input)).toBe(input);
    });

    it('strips markdown code fences', () => {
        const input = '```plot\nLINE_CHART(x=ts, y=val)\n```';
        expect(cleanPlotConfig(input)).toBe('LINE_CHART(x=ts, y=val)');
    });

    it('strips <think>…</think> chain-of-thought blocks', () => {
        const input = '<think>Let me reason…</think>\nHISTOGRAM(x=duration)';
        expect(cleanPlotConfig(input)).toBe('HISTOGRAM(x=duration)');
    });

    it('strips unclosed <thinking> block (eats everything after opening tag)', () => {
        // The unclosed-CoT regex strips from <thinking> to end-of-string,
        // so the plot config inside the block is lost — returns safe default.
        const input = '<thinking>I should use a bar chart because…\nBAR_CHART(x=a, y=b)';
        expect(cleanPlotConfig(input)).toBe('TABLE()');
    });

    it('strips HF special tokens like <|endoftext|>', () => {
        const input = 'TABLE()<|endoftext|>';
        expect(cleanPlotConfig(input)).toBe('TABLE()');
    });

    it('strips leading prose before the plot name', () => {
        const input = 'Sure, here is a config: BAR_CHART(x=col)';
        expect(cleanPlotConfig(input)).toBe('BAR_CHART(x=col)');
    });

    it('strips trailing prose after balanced parens', () => {
        const input = 'LINE_CHART(x=t, y=v) This looks great.';
        // Trailing prose on same line with no recognised modifier — stripped
        expect(cleanPlotConfig(input)).toBe('LINE_CHART(x=t, y=v)');
    });

    it('strips double-quote wrapping', () => {
        const input = '"SCATTER_PLOT(x=a, y=b)"';
        expect(cleanPlotConfig(input)).toBe('SCATTER_PLOT(x=a, y=b)');
    });

    it('strips single-quote wrapping', () => {
        const input = "'PIE_CHART(label=name, value=cnt)'";
        expect(cleanPlotConfig(input)).toBe('PIE_CHART(label=name, value=cnt)');
    });

    it('handles short alias "bar"', () => {
        const result = cleanPlotConfig('bar(x=a, y=b)');
        expect(result.toLowerCase()).toContain('bar(');
    });

    it('handles nested parens correctly (balanced extraction)', () => {
        const input = 'BAR_CHART(x=col, title="My (Chart)")';
        const result = cleanPlotConfig(input);
        expect(result).toBe(input);
    });

    it('returns TABLE() for empty/null-ish input', () => {
        expect(cleanPlotConfig('')).toBe('TABLE()');
        expect(cleanPlotConfig(null as any)).toBe('TABLE()');
    });

    it('returns TABLE() when no recognisable plot name found', () => {
        expect(cleanPlotConfig('some random text with no plot')).toBe('TABLE()');
    });

    it('returns TABLE() for unclosed parens', () => {
        expect(cleanPlotConfig('BAR_CHART(x=col, y=val')).toBe('TABLE()');
    });

    it('strips </s> and <s> special tokens', () => {
        const input = '<s>TABLE()</s>';
        expect(cleanPlotConfig(input)).toBe('TABLE()');
    });
});
