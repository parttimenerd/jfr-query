// W14 — plotBrushStore: cycle detection, retention on publisher unmount, clamp on data refresh.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { plotBrushStore } from '../../services/plotBrushStore';

describe('plotBrushStore W14 semantics', () => {
    beforeEach(() => {
        plotBrushStore.__reset();
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe('cycle detection', () => {
        it('warns once when cells form a direct cycle', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            // Cell A publishes $x, will subscribe to $y.
            plotBrushStore.publish({ name: '$x', domain: [0, 10], mode: 'x', cellName: 'cellA' });
            plotBrushStore.subscribe('$y', () => {}, 'cellA');

            // Cell B publishes $y, will subscribe to $x → cycle.
            plotBrushStore.publish({ name: '$y', domain: [5, 15], mode: 'x', cellName: 'cellB' });
            const sub = vi.fn();
            plotBrushStore.subscribe('$x', sub, 'cellB');

            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy.mock.calls[0][0]).toMatch(/cycle detected/i);

            // Cycle-broken subscriber should not get live updates.
            plotBrushStore.publish({ name: '$x', domain: [1, 9], mode: 'x', cellName: 'cellA' });
            expect(sub).not.toHaveBeenCalled();
        });

        it('does not warn on fan-out (one cell, multiple subscribers)', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            plotBrushStore.publish({ name: '$x', domain: [0, 10], mode: 'x', cellName: 'src' });
            plotBrushStore.subscribe('$x', () => {}, 'dest1');
            plotBrushStore.subscribe('$x', () => {}, 'dest2');
            expect(warnSpy).not.toHaveBeenCalled();
        });
    });

    describe('publisher unmount retention', () => {
        it('retains the payload during the grace window', () => {
            plotBrushStore.publish({ name: '$sel', domain: [0, 100], mode: 'x', cellName: 'c1' });
            plotBrushStore.publisherUnmounting('$sel', 'c1');
            // Still present immediately.
            expect(plotBrushStore.get('$sel')?.domain).toEqual([0, 100]);
        });

        it('evicts after the retention timeout', () => {
            const fn = vi.fn();
            plotBrushStore.publish({ name: '$sel', domain: [0, 100], mode: 'x', cellName: 'c1' });
            plotBrushStore.subscribe('$sel', fn);
            plotBrushStore.publisherUnmounting('$sel', 'c1');
            vi.advanceTimersByTime(1500);
            expect(plotBrushStore.get('$sel')?.domain).toBeNull();
            // Subscriber was notified with the clear.
            expect(fn).toHaveBeenCalledWith(expect.objectContaining({ domain: null }));
        });

        it('cancels eviction when publisher re-publishes during the grace window', () => {
            const fn = vi.fn();
            plotBrushStore.publish({ name: '$sel', domain: [0, 100], mode: 'x', cellName: 'c1' });
            plotBrushStore.subscribe('$sel', fn);
            plotBrushStore.publisherUnmounting('$sel', 'c1');
            // Re-mount before the timer fires.
            vi.advanceTimersByTime(500);
            plotBrushStore.publish({ name: '$sel', domain: [10, 90], mode: 'x', cellName: 'c1' });
            vi.advanceTimersByTime(1500);
            expect(plotBrushStore.get('$sel')?.domain).toEqual([10, 90]);
        });
    });

    describe('clampToRange', () => {
        it('returns "kept" when brush is fully within new range', () => {
            plotBrushStore.publish({ name: '$sel', domain: [10, 20], mode: 'x' });
            expect(plotBrushStore.clampToRange('$sel', [0, 100])).toBe('kept');
            expect(plotBrushStore.get('$sel')?.domain).toEqual([10, 20]);
        });

        it('clamps when brush overlaps the new range', () => {
            plotBrushStore.publish({ name: '$sel', domain: [50, 200], mode: 'x' });
            expect(plotBrushStore.clampToRange('$sel', [0, 100])).toBe('clamped');
            expect(plotBrushStore.get('$sel')?.domain).toEqual([50, 100]);
        });

        it('clears when brush is fully out of range', () => {
            plotBrushStore.publish({ name: '$sel', domain: [200, 300], mode: 'x' });
            expect(plotBrushStore.clampToRange('$sel', [0, 100])).toBe('cleared');
            expect(plotBrushStore.get('$sel')?.domain).toBeNull();
        });

        it('is a no-op when nothing is published', () => {
            expect(plotBrushStore.clampToRange('$absent', [0, 100])).toBe('kept');
        });
    });
});
