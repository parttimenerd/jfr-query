import { describe, it, expect } from 'vitest';
import { getPaletteColors, buildSmartTemplate } from '../../utils/plotUtils';

describe('getPaletteColors — diverging palettes', () => {
    it('spectral returns 8 colors', () => {
        const colors = getPaletteColors('spectral', []);
        expect(colors).toHaveLength(8);
    });
    it('rdylgn returns 8 colors', () => {
        const colors = getPaletteColors('rdylgn', []);
        expect(colors).toHaveLength(8);
    });
    it('spectral colors are valid CSS hex strings', () => {
        const colors = getPaletteColors('spectral', []);
        colors.forEach(c => expect(c).toMatch(/^#[0-9a-f]{6}$/i));
    });
    it('rdylgn colors are valid CSS hex strings', () => {
        const colors = getPaletteColors('rdylgn', []);
        colors.forEach(c => expect(c).toMatch(/^#[0-9a-f]{6}$/i));
    });
    it('unknown palette name falls back to provided default', () => {
        const fallback = ['#aabbcc'];
        expect(getPaletteColors('nonexistent', fallback)).toEqual(fallback);
    });
    it('existing palette category10 still works', () => {
        expect(getPaletteColors('category10', [])).toHaveLength(10);
    });
});

describe('buildSmartTemplate — GANTT', () => {
    it('picks start/end columns by name, lane from category', () => {
        const cols = ['startTime', 'endTime', 'phase'];
        const row = { startTime: 1000, endTime: 2000, phase: 'G1 Young' };
        const t = buildSmartTemplate('GANTT', cols, row)!;
        expect(t).toContain('start: "startTime"');
        expect(t).toContain('end: "endTime"');
        expect(t).toContain('lane: "phase"');
    });
    it('falls back to blank template when no start/end found', () => {
        const cols = ['bucket', 'pauseMs'];
        const row = { bucket: 1000, pauseMs: 5 };
        const t = buildSmartTemplate('GANTT', cols, row);
        expect(t).toContain('GANTT(');
    });
});

describe('buildSmartTemplate — RANGE', () => {
    it('picks low/high by looksLikeRangeBound, x from time col', () => {
        const cols = ['bucket', 'p25', 'p75'];
        const row = { bucket: 1000, p25: 5, p75: 20 };
        const t = buildSmartTemplate('RANGE', cols, row)!;
        expect(t).toContain('low: "p25"');
        expect(t).toContain('high: "p75"');
        expect(t).toContain('x: "bucket"');
    });
    it('falls back gracefully with no range columns', () => {
        const t = buildSmartTemplate('RANGE', ['bucket', 'count'], null);
        expect(t).toContain('RANGE(');
    });
});

describe('buildSmartTemplate — AREA_CHART', () => {
    it('picks time x and numeric ys', () => {
        const cols = ['bucket', 'heapUsed', 'heapFree'];
        const row = { bucket: 1000, heapUsed: 500, heapFree: 300 };
        const t = buildSmartTemplate('AREA_CHART', cols, row)!;
        expect(t).toContain('x: "bucket"');
        expect(t).toContain('"heapUsed"');
    });
    it('uses stacked layout when col names suggest accumulative data', () => {
        const cols = ['bucket', 'heapUsed', 'heapFree', 'metaspaceUsed'];
        const row = { bucket: 1000, heapUsed: 500, heapFree: 300, metaspaceUsed: 50 };
        const t = buildSmartTemplate('AREA_CHART', cols, row)!;
        expect(t).toContain('layout: "stacked"');
    });
});

describe('buildSmartTemplate — VIOLIN_PLOT', () => {
    it('picks numeric value col and category col', () => {
        const cols = ['gcCause', 'pauseMs'];
        const row = { gcCause: 'G1 Young', pauseMs: 5 };
        const t = buildSmartTemplate('VIOLIN_PLOT', cols, row)!;
        expect(t).toContain('value: "pauseMs"');
        expect(t).toContain('category: "gcCause"');
    });
    it('works with no category col (single numeric)', () => {
        const cols = ['pauseMs'];
        const row = { pauseMs: 5 };
        const t = buildSmartTemplate('VIOLIN_PLOT', cols, row)!;
        expect(t).toContain('value: "pauseMs"');
    });
});
