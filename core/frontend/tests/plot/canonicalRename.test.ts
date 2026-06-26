// W3 — verifies that legacy param names still parse to the same config as their
// canonical replacements, and that deprecation warnings fire (or don't) per spec.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { plotRegistry } from '../../components/plots/plotRegistry';
import { __resetDeprecationWarnings } from '../../components/plots/deprecation';

beforeEach(() => {
    __resetDeprecationWarnings();
    vi.restoreAllMocks();
});

describe('canonical rename — PIE_CHART name → category (deprecated alias)', () => {
    const data = [{ gcCause: 'AF', count: 10 }];

    it('legacy name= parses identically to canonical category=', () => {
        const legacy = plotRegistry['PIE_CHART'].parseConfig('PIE_CHART(name: "gcCause", value: "count")', data);
        const canon  = plotRegistry['PIE_CHART'].parseConfig('PIE_CHART(category: "gcCause", value: "count")', data);
        expect((legacy as any).category).toBe('gcCause');
        expect((canon as any).category).toBe('gcCause');
    });

    it('legacy name= triggers one deprecation warning', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        plotRegistry['PIE_CHART'].parseConfig('PIE_CHART(name: "gcCause", value: "count")', data);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0]).toMatch(/"name" is deprecated/);
    });

    it('deduplicates: second use does not double-warn', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        plotRegistry['PIE_CHART'].parseConfig('PIE_CHART(name: "gcCause", value: "count")', data);
        plotRegistry['PIE_CHART'].parseConfig('PIE_CHART(name: "gcCause", value: "count")', data);
        expect(spy).toHaveBeenCalledTimes(1);
    });
});

describe('canonical rename — HISTOGRAM value → x (deprecated alias)', () => {
    const data = [{ pauseMs: 10 }];

    it('legacy value= parses identically to canonical x=', () => {
        const legacy = plotRegistry['HISTOGRAM'].parseConfig('HISTOGRAM(value: "pauseMs")', data);
        const canon  = plotRegistry['HISTOGRAM'].parseConfig('HISTOGRAM(x: "pauseMs")', data);
        expect((legacy as any).x).toBe('pauseMs');
        expect((canon as any).x).toBe('pauseMs');
    });

    it('legacy value= triggers one deprecation warning', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        plotRegistry['HISTOGRAM'].parseConfig('HISTOGRAM(value: "pauseMs")', data);
        expect(spy).toHaveBeenCalledTimes(1);
    });
});

describe('canonical rename — FLAMEGRAPH label → frames (deprecated alias)', () => {
    const data = [{ stack: 'a;b;c', cpu: 10 }];

    it('legacy label= parses identically to canonical frames=', () => {
        const legacy = plotRegistry['FLAMEGRAPH'].parseConfig('FLAMEGRAPH(label: "stack", value: "cpu")', data);
        const canon  = plotRegistry['FLAMEGRAPH'].parseConfig('FLAMEGRAPH(frames: "stack", value: "cpu")', data);
        expect((legacy as any).frames).toBe('stack');
        expect((canon as any).frames).toBe('stack');
    });
});

describe('canonical rename — GANTT row → lane, label → task (deprecated)', () => {
    const data = [{ s: 0, e: 1, thr: 'main', phase: 'init' }];

    it('row → lane', () => {
        const legacy = plotRegistry['GANTT'].parseConfig('GANTT(start: "s", end: "e", row: "thr", task: "phase")', data);
        const canon  = plotRegistry['GANTT'].parseConfig('GANTT(start: "s", end: "e", lane: "thr", task: "phase")', data);
        expect((legacy as any).lane).toBe('thr');
        expect((canon as any).lane).toBe('thr');
    });

    it('label → task', () => {
        const legacy = plotRegistry['GANTT'].parseConfig('GANTT(start: "s", end: "e", lane: "thr", label: "phase")', data);
        expect((legacy as any).task).toBe('phase');
    });
});

describe('canonical rename — SCATTER_PLOT category → color (deprecated)', () => {
    const data = [{ x: 1, y: 2, region: 'us' }];

    it('legacy category= maps to canonical color', () => {
        const legacy = plotRegistry['SCATTER_PLOT'].parseConfig('SCATTER_PLOT(x: "x", y: "y", category: "region")', data);
        const canon  = plotRegistry['SCATTER_PLOT'].parseConfig('SCATTER_PLOT(x: "x", y: "y", color: "region")', data);
        expect((legacy as any).color).toBe('region');
        expect((canon as any).color).toBe('region');
    });

    it('triggers deprecation warning (category is marked deprecated)', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        plotRegistry['SCATTER_PLOT'].parseConfig('SCATTER_PLOT(x: "x", y: "y", category: "region")', data);
        expect(spy).toHaveBeenCalledTimes(1);
    });
});

describe('non-deprecated alias — BOX_PLOT color → category (no warning)', () => {
    const data = [{ pauseMs: 10, gcType: 'young' }];

    it('color aliases category but does NOT warn', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const cfg = plotRegistry['BOX_PLOT'].parseConfig('BOX_PLOT(value: "pauseMs", color: "gcType")', data);
        expect((cfg as any).category).toBe('gcType');
        expect(spy).not.toHaveBeenCalled();
    });

    it('x aliases value (showcase-canon single-box mode), no warning', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const cfg = plotRegistry['BOX_PLOT'].parseConfig('BOX_PLOT(x: "pauseMs")', data);
        expect((cfg as any).value).toBe('pauseMs');
        expect(spy).not.toHaveBeenCalled();
    });
});
