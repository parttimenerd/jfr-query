// W13 — decimation helpers.

import { describe, it, expect } from 'vitest';
import { lttb, stride, topN } from '../../services/plot/decimation';

describe('lttb', () => {
    const mkSeries = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: Math.sin(i / 5) * 100 }));

    it('returns original array if length ≤ target', () => {
        const data = mkSeries(50);
        expect(lttb(data, 'x', 'y', 100)).toBe(data);
    });

    it('returns original array if target < 3', () => {
        const data = mkSeries(100);
        expect(lttb(data, 'x', 'y', 2)).toBe(data);
    });

    it('reduces a 1000-point series to ~target points', () => {
        const data = mkSeries(1000);
        const out = lttb(data, 'x', 'y', 100);
        expect(out.length).toBe(100);
    });

    it('preserves first and last points', () => {
        const data = mkSeries(1000);
        const out = lttb(data, 'x', 'y', 50);
        expect(out[0]).toEqual(data[0]);
        expect(out[out.length - 1]).toEqual(data[data.length - 1]);
    });

    it('preserves visual extrema (min/max within 1%)', () => {
        const data = mkSeries(2000);
        const fullMax = Math.max(...data.map(p => p.y));
        const fullMin = Math.min(...data.map(p => p.y));
        const out = lttb(data, 'x', 'y', 200);
        const outMax = Math.max(...out.map(p => p.y));
        const outMin = Math.min(...out.map(p => p.y));
        expect(Math.abs(fullMax - outMax) / Math.abs(fullMax)).toBeLessThan(0.01);
        expect(Math.abs(fullMin - outMin) / Math.abs(fullMin)).toBeLessThan(0.01);
    });

    it('produces a monotonically-increasing x output (preserves order)', () => {
        const data = Array.from({ length: 500 }, (_, i) => ({ x: i, y: Math.random() }));
        const out = lttb(data, 'x', 'y', 50);
        for (let i = 1; i < out.length; i++) {
            expect(out[i].x).toBeGreaterThan(out[i - 1].x);
        }
    });
});

describe('stride', () => {
    it('returns original when target >= length', () => {
        const data = [1, 2, 3];
        expect(stride(data, 10)).toBe(data);
    });

    it('reduces to target length', () => {
        const data = Array.from({ length: 1000 }, (_, i) => i);
        expect(stride(data, 100)).toHaveLength(100);
    });

    it('keeps the first element', () => {
        const data = Array.from({ length: 100 }, (_, i) => i);
        const out = stride(data, 10);
        expect(out[0]).toBe(0);
    });
});

describe('topN', () => {
    const data = [
        { name: 'a', count: 10 },
        { name: 'b', count: 50 },
        { name: 'c', count: 5 },
        { name: 'd', count: 30 },
        { name: 'e', count: 8 },
    ];

    it('returns original when length ≤ n', () => {
        expect(topN(data, 10, 'count')).toBe(data);
    });

    it('keeps top N rows + Other fold', () => {
        const out = topN(data, 2, 'count');
        expect(out).toHaveLength(3);
        expect(out[0].name).toBe('b');
        expect(out[1].name).toBe('d');
        expect(out[2].name).toBe('Other');
        // 10 + 5 + 8 = 23
        expect(out[2].count).toBe(23);
    });

    it('handles ties deterministically', () => {
        const ties = [
            { name: 'a', count: 10 },
            { name: 'b', count: 10 },
            { name: 'c', count: 5 },
        ];
        const out = topN(ties, 1, 'count');
        expect(out).toHaveLength(2);
        expect(out[0].count).toBe(10);
        expect(out[1].name).toBe('Other');
        expect(out[1].count).toBe(15); // 10 + 5
    });
});
