import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { subscribeScrollGroup, broadcastScrollPosition } from '../../stores/linkScrollGroups';

// Provide browser stubs for rAF / cAF which don't exist in the node environment.
// broadcastScrollPosition calls these; we mock them so tests don't throw.
beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as any).requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
    });
    (globalThis as any).cancelAnimationFrame = vi.fn();
});

afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).requestAnimationFrame;
    delete (globalThis as any).cancelAnimationFrame;
});

// ─── subscribeScrollGroup ─────────────────────────────────────────────────────

describe('subscribeScrollGroup', () => {
    it('registers a subscriber and returns an unsubscribe function', () => {
        const cb = vi.fn();
        const unsub = subscribeScrollGroup('g1', 'plot-0', cb);
        expect(typeof unsub).toBe('function');
        unsub();
    });

    it('multiple subscribers can join the same group', () => {
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        const u1 = subscribeScrollGroup('g2', 'plot-0', cb1);
        const u2 = subscribeScrollGroup('g2', 'plot-1', cb2);
        u1();
        u2();
    });

    it('unsubscribing before broadcast means callback is not called', () => {
        const received: any[] = [];
        const unsub = subscribeScrollGroup('g3', 'plot-0', (pos) => received.push(pos));
        unsub(); // remove before broadcast
        broadcastScrollPosition('g3', 'other', { top: 10, left: 0 });
        vi.runAllTimers();
        // Callback should not have been called (group was deleted on last unsub)
        expect(received).toHaveLength(0);
    });

    it('broadcast calls subscribers other than the source after debounce', () => {
        const received: any[] = [];
        const u1 = subscribeScrollGroup('g4', 'plot-0', (pos) => received.push({ id: 'plot-0', pos }));
        const u2 = subscribeScrollGroup('g4', 'plot-1', (pos) => received.push({ id: 'plot-1', pos }));
        broadcastScrollPosition('g4', 'plot-0', { top: 50, left: 0 });
        vi.runAllTimers(); // advance past the 16ms debounce
        // Only plot-1 should receive (plot-0 is the source)
        expect(received).toHaveLength(1);
        expect(received[0].id).toBe('plot-1');
        expect(received[0].pos).toEqual({ top: 50, left: 0 });
        u1();
        u2();
    });

    it('broadcast does nothing when the group does not exist', () => {
        expect(() => broadcastScrollPosition('nonexistent', 'any', { top: 0, left: 0 })).not.toThrow();
        vi.runAllTimers();
    });

    it('last subscriber unsubscribing removes the group', () => {
        const unsub = subscribeScrollGroup('g5', 'plot-0', vi.fn());
        unsub();
        // Broadcasting to the deleted group should be a no-op
        expect(() => broadcastScrollPosition('g5', 'any', { top: 0, left: 0 })).not.toThrow();
        vi.runAllTimers();
    });
});
