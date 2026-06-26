// W4 — plotBrushStore: a minimal pub/sub for cross-cell brush coupling.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { plotBrushStore } from '../../services/plotBrushStore';
import { expandBrushOperator } from '../../services/variableExpander';
import { substituteVariables } from '../../utils/variableSubstitution';

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

// B-139 — cycle detection must work even when subscribe() is called
// before the publisher has called publish() (pre-publish subscribe).
describe('plotBrushStore — pre-publish cycle detection (B-139)', () => {
    beforeEach(() => { plotBrushStore.__reset(); });

    it('detects cycle when both cells subscribe before either publishes', () => {
        // Cell A will publish $x and subscribe to $y.
        // Cell B will publish $y and subscribe to $x.
        // Both subscribe before any publish() call.
        plotBrushStore.registerPublisher('$x', 'cellA');
        plotBrushStore.registerPublisher('$y', 'cellB');

        const fnA = vi.fn(); // cell A subscribes to $y
        const fnB = vi.fn(); // cell B subscribes to $x

        plotBrushStore.subscribe('$y', fnA, 'cellA');
        // Second subscribe — cellB is the one that detects the cycle since it
        // subscribes second and sees the already-registered cross-subscription.
        plotBrushStore.subscribe('$x', fnB, 'cellB');

        // Now cell B publishes $y — fnA should NOT be called (cycle break).
        plotBrushStore.publish({ name: '$y', domain: [0, 100], mode: 'x', cellName: 'cellB' });
        // And cell A publishes $x — fnB should NOT be called (was silenced on subscribe).
        plotBrushStore.publish({ name: '$x', domain: [0, 100], mode: 'x', cellName: 'cellA' });

        // The second subscriber (fnB) was silenced; fnA should have been notified.
        expect(fnA).toHaveBeenCalledOnce();
        expect(fnB).not.toHaveBeenCalled();
    });

    it('detects cycle even when A subscribes to $y before B calls registerPublisher', () => {
        // Cell A subscribes first; only then does B register as publisher of $y.
        plotBrushStore.registerPublisher('$x', 'cellA');

        const fnA = vi.fn();
        plotBrushStore.subscribe('$y', fnA, 'cellA');

        // Now B registers as publisher of $y and subscribes to $x.
        plotBrushStore.registerPublisher('$y', 'cellB');
        const fnB = vi.fn();
        plotBrushStore.subscribe('$x', fnB, 'cellB');

        plotBrushStore.publish({ name: '$y', domain: [10, 20], mode: 'x', cellName: 'cellB' });
        expect(fnA).toHaveBeenCalledOnce();
        expect(fnB).not.toHaveBeenCalled();
    });

    it('non-cyclic subscriptions are unaffected', () => {
        // Cell A publishes $a and subscribes to nothing.
        // Cell B subscribes to $a — no cycle.
        plotBrushStore.registerPublisher('$a', 'cellA');
        const fnB = vi.fn();
        plotBrushStore.subscribe('$a', fnB, 'cellB');
        plotBrushStore.publish({ name: '$a', domain: [0, 50], mode: 'x', cellName: 'cellA' });
        expect(fnB).toHaveBeenCalledOnce();
    });
});

// Integration: brush variable flattening + SQL expansion (B-179 wiring).
// Simulates what PlotRenderer.makeBrushVarHandler does after a recharts gesture.
describe('brush variable wiring integration', () => {
    it('flat brush variables expand in SQL via expandBrushOperator + substituteVariables', () => {
        // Simulate what makeBrushVarHandler writes into metadata.variables.
        const brushVarName = '$gc';
        const lo = 1000;
        const hi = 2000;
        const flatVars: Record<string, string> = {
            [`${brushVarName}.brush.lo`]: String(lo),
            [`${brushVarName}.brush.hi`]: String(hi),
        };

        const sql = 'SELECT * FROM events WHERE ts IN $gc.brush';
        const expanded = expandBrushOperator(sql, flatVars);
        expect(expanded).toBe('SELECT * FROM events WHERE ts BETWEEN $gc.brush.lo AND $gc.brush.hi');

        const substituted = substituteVariables(expanded, flatVars);
        expect(substituted).toBe('SELECT * FROM events WHERE ts BETWEEN 1000 AND 2000');
    });

    it('brush operator is NOT expanded when brush variables are absent (skips query)', () => {
        const sql = 'SELECT * FROM events WHERE ts IN $gc.brush';
        const emptyVars: Record<string, string> = {};
        const result = expandBrushOperator(sql, emptyVars);
        // Left intact so the unresolved-variable check in handleRun skips execution.
        expect(result).toBe(sql);
    });

    it('plotBrushStore publish makes payload available to subscribers immediately', () => {
        plotBrushStore.__reset();
        const fn = vi.fn();
        plotBrushStore.subscribe('$gc', fn, 'cellB');
        plotBrushStore.publish({ name: '$gc', domain: [1000, 2000], mode: 'x', cellName: 'cellA' });
        expect(fn).toHaveBeenCalledOnce();
        expect(fn.mock.calls[0][0]).toMatchObject({ name: '$gc', domain: [1000, 2000], mode: 'x' });
    });

    it('plotBrushStore clear notifies subscribers with null domain', () => {
        plotBrushStore.__reset();
        const fn = vi.fn();
        plotBrushStore.subscribe('$gc', fn);
        plotBrushStore.publish({ name: '$gc', domain: [1000, 2000], mode: 'x', cellName: 'cellA' });
        plotBrushStore.clear('$gc', 'cellA');
        expect(fn).toHaveBeenCalledTimes(2);
        expect(fn.mock.calls[1][0].domain).toBeNull();
    });
});
