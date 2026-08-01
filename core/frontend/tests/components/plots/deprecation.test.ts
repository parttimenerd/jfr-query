import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    warnDeprecated,
    setSuppressDeprecationWarnings,
    __resetDeprecationWarnings,
} from '../../../components/plots/deprecation';

beforeEach(() => {
    __resetDeprecationWarnings();
});

// ── warnDeprecated ────────────────────────────────────────────────────────────

describe('warnDeprecated', () => {
    it('calls console.warn on first occurrence', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        warnDeprecated('BAR_CHART', 'logScale', 'scale');
        expect(spy).toHaveBeenCalledOnce();
        spy.mockRestore();
    });

    it('deduplicates: does not warn twice for the same (plotName, legacy) pair', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        warnDeprecated('BAR_CHART', 'logScale', 'scale');
        warnDeprecated('BAR_CHART', 'logScale', 'scale');
        expect(spy).toHaveBeenCalledOnce();
        spy.mockRestore();
    });

    it('warns independently for different (plotName, legacy) pairs', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        warnDeprecated('BAR_CHART', 'logScale', 'scale');
        warnDeprecated('BAR_CHART', 'colorScheme', 'palette');
        expect(spy).toHaveBeenCalledTimes(2);
        spy.mockRestore();
    });

    it('warns independently for same legacy on different plot names', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        warnDeprecated('BAR_CHART', 'logScale', 'scale');
        warnDeprecated('LINE_CHART', 'logScale', 'scale');
        expect(spy).toHaveBeenCalledTimes(2);
        spy.mockRestore();
    });

    it('includes the plot name and param names in the warning message', () => {
        const messages: string[] = [];
        const spy = vi.spyOn(console, 'warn').mockImplementation((msg: string) => messages.push(msg));
        warnDeprecated('HISTOGRAM', 'logScale', 'logBins');
        expect(messages[0]).toContain('HISTOGRAM');
        expect(messages[0]).toContain('logScale');
        expect(messages[0]).toContain('logBins');
        spy.mockRestore();
    });
});

describe('setSuppressDeprecationWarnings', () => {
    it('suppresses warnings when set to true', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setSuppressDeprecationWarnings(true);
        warnDeprecated('BAR_CHART', 'logScale', 'scale');
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('re-enables warnings when set back to false', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setSuppressDeprecationWarnings(true);
        warnDeprecated('BAR_CHART', 'logScale', 'scale');
        setSuppressDeprecationWarnings(false);
        warnDeprecated('BAR_CHART', 'other', 'new');
        expect(spy).toHaveBeenCalledOnce(); // only the second one
        spy.mockRestore();
    });
});

describe('__resetDeprecationWarnings', () => {
    it('allows the same pair to warn again after reset', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        warnDeprecated('BAR_CHART', 'logScale', 'scale');
        __resetDeprecationWarnings();
        warnDeprecated('BAR_CHART', 'logScale', 'scale');
        expect(spy).toHaveBeenCalledTimes(2);
        spy.mockRestore();
    });
});
