// W4 — plotBrushStore: a minimal pub/sub for cross-cell brush coupling.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { plotBrushStore } from '../../services/plotBrushStore';

describe('plotBrushStore', () => {
    beforeEach(() => {
        plotBrushStore.__reset();
    });

    it('publish + get round-trip', () => {
        plotBrushStore.publish({ name: '$sel', domain: [0, 100], mode: 'x', cellName: 'cell1' });
        expect(plotBrushStore.get('$sel')).toEqual({
            name: '$sel', domain: [0, 100], mode: 'x', cellName: 'cell1',
        });
    });

    it('notifies subscribers on publish', () => {
        const fn = vi.fn();
        plotBrushStore.subscribe('$sel', fn);
        plotBrushStore.publish({ name: '$sel', domain: [1, 2], mode: 'x' });
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith({ name: '$sel', domain: [1, 2], mode: 'x' });
    });

    it('supports multiple subscribers for the same name', () => {
        const a = vi.fn();
        const b = vi.fn();
        plotBrushStore.subscribe('$sel', a);
        plotBrushStore.subscribe('$sel', b);
        plotBrushStore.publish({ name: '$sel', domain: [0, 1], mode: 'x' });
        expect(a).toHaveBeenCalledOnce();
        expect(b).toHaveBeenCalledOnce();
    });

    it('isolates subscribers by name', () => {
        const onA = vi.fn();
        const onB = vi.fn();
        plotBrushStore.subscribe('$a', onA);
        plotBrushStore.subscribe('$b', onB);
        plotBrushStore.publish({ name: '$a', domain: [0, 1], mode: 'x' });
        expect(onA).toHaveBeenCalledOnce();
        expect(onB).not.toHaveBeenCalled();
    });

    it('unsubscribe stops notifications', () => {
        const fn = vi.fn();
        const unsub = plotBrushStore.subscribe('$sel', fn);
        plotBrushStore.publish({ name: '$sel', domain: [0, 1], mode: 'x' });
        expect(fn).toHaveBeenCalledTimes(1);
        unsub();
        plotBrushStore.publish({ name: '$sel', domain: [2, 3], mode: 'x' });
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('clear() emits a null-domain payload to subscribers', () => {
        const fn = vi.fn();
        plotBrushStore.subscribe('$sel', fn);
        plotBrushStore.publish({ name: '$sel', domain: [0, 100], mode: 'x', cellName: 'c1' });
        plotBrushStore.clear('$sel', 'c1');
        expect(fn).toHaveBeenCalledTimes(2);
        expect(fn.mock.calls[1][0]).toMatchObject({ name: '$sel', domain: null });
        expect(plotBrushStore.get('$sel')?.domain).toBeNull();
    });

    it('returns undefined for an unpublished name', () => {
        expect(plotBrushStore.get('$nothing')).toBeUndefined();
    });
});
