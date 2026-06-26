// W11 — Deprecated-alias warning UX. One-shot per (plot,legacy) pair;
// suppressible via setSuppressDeprecationWarnings().

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    warnDeprecated,
    setSuppressDeprecationWarnings,
    __resetDeprecationWarnings,
} from '../../components/plots/deprecation';

describe('warnDeprecated', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        __resetDeprecationWarnings();
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
        __resetDeprecationWarnings();
    });

    it('emits one warning the first time a (plot,legacy) pair is hit', () => {
        warnDeprecated('PIE_CHART', 'name', 'category');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain('PIE_CHART');
        expect(warnSpy.mock.calls[0][0]).toContain('"name"');
        expect(warnSpy.mock.calls[0][0]).toContain('"category"');
    });

    it('dedupes repeated calls for the same pair', () => {
        warnDeprecated('PIE_CHART', 'name', 'category');
        warnDeprecated('PIE_CHART', 'name', 'category');
        warnDeprecated('PIE_CHART', 'name', 'category');
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('treats different (plot,legacy) pairs as independent', () => {
        warnDeprecated('PIE_CHART', 'name', 'category');
        warnDeprecated('HISTOGRAM', 'value', 'x');
        warnDeprecated('PIE_CHART', 'name', 'category'); // duplicate
        expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    it('is silenced when setSuppressDeprecationWarnings(true) is set', () => {
        setSuppressDeprecationWarnings(true);
        warnDeprecated('PIE_CHART', 'name', 'category');
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('resumes warnings when suppression is turned off again', () => {
        setSuppressDeprecationWarnings(true);
        warnDeprecated('PIE_CHART', 'name', 'category');
        expect(warnSpy).not.toHaveBeenCalled();

        setSuppressDeprecationWarnings(false);
        // Different pair (the suppressed one stays unrecorded — only fires once
        // total per session anyway). Use a different plot so this is unambiguous.
        warnDeprecated('BAR_CHART', 'label', 'x');
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });
});
