// W12 — Minimal language ergonomics: case-insensitive plot names + param names,
// short plot aliases, trailing-comma tolerance, `#` comments, unquoted identifiers.

import { describe, it, expect } from 'vitest';
import { plotRegistry } from '../../components/plots/plotRegistry';
import { normalizePlotName } from '../../components/plots/plotNames';
import { parsePlotCall } from '../../utils/plotParser';

describe('normalizePlotName — short aliases', () => {
    it.each([
        ['line', 'LINE_CHART'],
        ['LINE', 'LINE_CHART'],
        ['Line', 'LINE_CHART'],
        ['bar', 'BAR_CHART'],
        ['area', 'AREA_CHART'],
        ['scatter', 'SCATTER_PLOT'],
        ['pie', 'PIE_CHART'],
        ['box', 'BOX_PLOT'],
        ['hist', 'HISTOGRAM'],
        ['heat', 'HEATMAP'],
        ['flame', 'FLAMEGRAPH'],
        ['gantt', 'GANTT'],
        ['range', 'RANGE'],
        ['table', 'TABLE'],
    ])('"%s" → %s', (input, expected) => {
        expect(normalizePlotName(input)).toBe(expected);
    });

    it('canonical names pass through unchanged', () => {
        expect(normalizePlotName('LINE_CHART')).toBe('LINE_CHART');
        expect(normalizePlotName('line_chart')).toBe('LINE_CHART');
    });

    it('unknown names normalize to their uppercase form (registry lookup will fail downstream)', () => {
        expect(normalizePlotName('sankey')).toBe('SANKEY');
    });
});

describe('case-insensitive param names', () => {
    const data = [{ ts: 1, cpu: 0.5 }];

    it('parses uppercase param keys', () => {
        const cfg = plotRegistry['LINE_CHART'].parseConfig('LINE_CHART(X: "ts", Y: ["cpu"])', data);
        expect((cfg as any).x).toBe('ts');
        expect((cfg as any).y).toEqual(['cpu']);
    });

    it('parses mixed-case param keys', () => {
        const cfg = plotRegistry['LINE_CHART'].parseConfig('LINE_CHART(x: "ts", y: ["cpu"], YScale: "log")', data);
        expect((cfg as any).yScale).toBe('log');
    });
});

describe('case-insensitive clause keywords (already verified in plotParser.clauses.test, sanity check here)', () => {
    it('lowercase title clause works', () => {
        const parsed = parsePlotCall('LINE_CHART(x: "ts", y: ["cpu"]) title "CPU"');
        expect(parsed.title).toBe('CPU');
    });
});

describe('trailing comma in param list', () => {
    const data = [{ ts: 1, cpu: 0.5 }];

    it('tolerates trailing comma', () => {
        const cfg = plotRegistry['LINE_CHART'].parseConfig('LINE_CHART(x: "ts", y: ["cpu"],)', data);
        expect((cfg as any).x).toBe('ts');
    });

    it('tolerates trailing comma inside array', () => {
        const cfg = plotRegistry['LINE_CHART'].parseConfig('LINE_CHART(x: "ts", y: ["cpu",])', data);
        expect((cfg as any).y).toEqual(['cpu']);
    });
});

describe('# comment stripping', () => {
    const data = [{ ts: 1, cpu: 0.5 }];

    it('strips trailing comment after the call', () => {
        const cfg = plotRegistry['LINE_CHART'].parseConfig('LINE_CHART(x: "ts", y: ["cpu"]) # primary CPU chart', data);
        expect((cfg as any).x).toBe('ts');
    });

    it('strips mid-line comments before newline', () => {
        const cfg = plotRegistry['LINE_CHART'].parseConfig('LINE_CHART(x: "ts", # the time column\n y: ["cpu"])', data);
        expect((cfg as any).y).toEqual(['cpu']);
    });

    it('preserves # inside string literals (e.g. CSS color)', () => {
        const cfg = plotRegistry['LINE_CHART'].parseConfig('LINE_CHART(x: "ts", y: ["cpu"], yAxisLabel: "#count")', data);
        expect((cfg as any).yAxisLabel).toBe('#count');
    });
});

describe('unquoted simple identifiers for column-type params', () => {
    const data = [{ ts: 1, cpu: 0.5, host: 'a' }];

    it('accepts unquoted column name', () => {
        const cfg = plotRegistry['LINE_CHART'].parseConfig('LINE_CHART(x: ts, y: [cpu])', data);
        expect((cfg as any).x).toBe('ts');
        expect((cfg as any).y).toEqual(['cpu']);
    });

    it('column type still works when quoted', () => {
        const cfg = plotRegistry['LINE_CHART'].parseConfig('LINE_CHART(x: "ts", y: ["cpu"])', data);
        expect((cfg as any).x).toBe('ts');
    });
});
