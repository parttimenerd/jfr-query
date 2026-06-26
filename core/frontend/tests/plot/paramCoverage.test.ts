// W3 — verifies new canonical params are accepted by the parser and surfaced
// on the parsed config object. Does not render — just confirms the surface.

import { describe, it, expect } from 'vitest';
import { plotRegistry } from '../../components/plots/plotRegistry';

describe('PIE_CHART — new params (innerRadius, outerRadius, showPercent, sliceLabel)', () => {
    const data = [{ gcCause: 'AF', count: 10 }];
    it('accepts innerRadius/outerRadius/showPercent/sliceLabel', () => {
        const cfg = plotRegistry['PIE_CHART'].parseConfig(
            'PIE_CHART(category: "gcCause", value: "count", innerRadius: 0.5, outerRadius: 0.9, showPercent: true, sliceLabel: "outside")',
            data
        );
        expect((cfg as any).innerRadius).toBe(0.5);
        expect((cfg as any).outerRadius).toBe(0.9);
        expect((cfg as any).showPercent).toBe(true);
        expect((cfg as any).sliceLabel).toBe('outside');
    });
});

describe('BAR_CHART — new param: color', () => {
    const data = [{ host: 'a', count: 10, region: 'us' }];
    it('accepts color column', () => {
        const cfg = plotRegistry['BAR_CHART'].parseConfig(
            'BAR_CHART(x: "host", y: ["count"], color: "region")',
            data
        );
        expect((cfg as any).color).toBe('region');
    });
});

describe('LINE_CHART — new params: color, xDomain', () => {
    const data = [{ ts: 1, cpu: 0.5, host: 'a' }];
    it('accepts color column', () => {
        const cfg = plotRegistry['LINE_CHART'].parseConfig(
            'LINE_CHART(x: "ts", y: ["cpu"], color: "host")',
            data
        );
        expect((cfg as any).color).toBe('host');
    });
    it('accepts xDomain array', () => {
        const cfg = plotRegistry['LINE_CHART'].parseConfig(
            'LINE_CHART(x: "ts", y: ["cpu"], xDomain: [0, 100])',
            data
        );
        expect((cfg as any).xDomain).toEqual([0, 100]);
    });
});

describe('AREA_CHART — new params: color, layout, xRefLines + stack deprecated', () => {
    const data = [{ ts: 1, cpu: 0.5, host: 'a' }];

    it('accepts canonical layout: "stacked"', () => {
        const cfg = plotRegistry['AREA_CHART'].parseConfig(
            'AREA_CHART(x: "ts", y: ["cpu"], layout: "stacked")',
            data
        );
        expect((cfg as any).layout).toBe('stacked');
    });

    it('accepts canonical layout: "overlay"', () => {
        const cfg = plotRegistry['AREA_CHART'].parseConfig(
            'AREA_CHART(x: "ts", y: ["cpu"], layout: "overlay")',
            data
        );
        expect((cfg as any).layout).toBe('overlay');
    });

    it('rejects unknown layout value', () => {
        expect(() => plotRegistry['AREA_CHART'].parseConfig(
            'AREA_CHART(x: "ts", y: ["cpu"], layout: "side-by-side")',
            data
        )).toThrow(/Invalid value/);
    });

    it('still accepts legacy stack: true (deprecated)', () => {
        const cfg = plotRegistry['AREA_CHART'].parseConfig(
            'AREA_CHART(x: "ts", y: ["cpu"], stack: true)',
            data
        );
        expect((cfg as any).stack).toBe(true);
    });

    it('accepts color column', () => {
        const cfg = plotRegistry['AREA_CHART'].parseConfig(
            'AREA_CHART(x: "ts", y: ["cpu"], color: "host")',
            data
        );
        expect((cfg as any).color).toBe('host');
    });
});

describe('HISTOGRAM — bins:"auto" mode', () => {
    const data = [{ pauseMs: 10 }];
    it('accepts bins:"auto"', () => {
        const cfg = plotRegistry['HISTOGRAM'].parseConfig(
            'HISTOGRAM(x: "pauseMs", bins: "auto")',
            data
        );
        expect((cfg as any).bins).toBe('auto');
    });
    it('still accepts numeric bins', () => {
        const cfg = plotRegistry['HISTOGRAM'].parseConfig(
            'HISTOGRAM(x: "pauseMs", bins: 20)',
            data
        );
        expect((cfg as any).bins).toBe(20);
    });
});

describe('FLAMEGRAPH — new params: direction, minFrameWidth, search', () => {
    const data = [{ stack: 'a;b', cpu: 5 }];
    it('accepts direction, minFrameWidth, search', () => {
        const cfg = plotRegistry['FLAMEGRAPH'].parseConfig(
            'FLAMEGRAPH(frames: "stack", value: "cpu", direction: "up", minFrameWidth: 2, search: "GC.*")',
            data
        );
        expect((cfg as any).direction).toBe('up');
        expect((cfg as any).minFrameWidth).toBe(2);
        expect((cfg as any).search).toBe('GC.*');
    });
    it('rejects invalid direction', () => {
        expect(() => plotRegistry['FLAMEGRAPH'].parseConfig(
            'FLAMEGRAPH(frames: "stack", value: "cpu", direction: "sideways")',
            data
        )).toThrow(/Invalid value/);
    });
});

describe('GANTT — task param required label column', () => {
    const data = [{ s: 0, e: 1, thr: 'main', phase: 'init' }];
    it('accepts canonical task=', () => {
        const cfg = plotRegistry['GANTT'].parseConfig(
            'GANTT(start: "s", end: "e", lane: "thr", task: "phase")',
            data
        );
        expect((cfg as any).task).toBe('phase');
    });
});
