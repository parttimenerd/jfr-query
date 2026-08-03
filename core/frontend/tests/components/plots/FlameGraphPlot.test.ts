import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../context/SettingsContext', () => ({
    SettingsContext: { Consumer: ({ children }: any) => children({}), Provider: ({ children }: any) => children },
    useContext: () => ({}),
}));
vi.mock('../../../services/AiService', () => ({ providerMetadataRegistry: {} }));

import { flameGraphPlot } from '../../../components/plots/FlameGraphPlot';

// ── registration ──────────────────────────────────────────────────────────────
describe('flameGraphPlot registration', () => {
    it('has name FLAMEGRAPH', () => expect(flameGraphPlot.name).toBe('FLAMEGRAPH'));

    it('frames param is required', () => {
        expect(flameGraphPlot.params.find(p => p.name === 'frames')?.required).toBe(true);
    });

    it('value param is required', () => {
        expect(flameGraphPlot.params.find(p => p.name === 'value')?.required).toBe(true);
    });

    it('direction defaults to "down"', () => {
        expect(flameGraphPlot.params.find(p => p.name === 'direction')?.defaultValue).toBe('down');
    });

    it('minFrameWidth defaults to 0.1', () => {
        expect(flameGraphPlot.params.find(p => p.name === 'minFrameWidth')?.defaultValue).toBeCloseTo(0.1);
    });

    it('"label" is a deprecated alias for frames', () => {
        const p = flameGraphPlot.params.find(p => p.name === 'label');
        expect(p?.aliasFor).toBe('frames');
        expect(p?.deprecated).toBe(true);
    });

    it('"stacktrace" is a non-deprecated alias for frames', () => {
        const p = flameGraphPlot.params.find(p => p.name === 'stacktrace');
        expect(p?.aliasFor).toBe('frames');
        expect(p?.deprecated).toBeFalsy();
    });

    it('template covers frames and value', () => {
        expect(flameGraphPlot.template).toContain('frames:');
        expect(flameGraphPlot.template).toContain('value:');
    });

    it('has at least one example', () => {
        expect(flameGraphPlot.examples.length).toBeGreaterThanOrEqual(1);
    });
});

// ── parseConfig ───────────────────────────────────────────────────────────────
describe('flameGraphPlot parseConfig', () => {
    it('parses frames and value', () => {
        const cfg = flameGraphPlot.parseConfig('FLAMEGRAPH(frames: "frame", value: "value")', []);
        expect(cfg.frames).toBe('frame');
        expect(cfg.value).toBe('value');
    });

    it('parses direction override', () => {
        const cfg = flameGraphPlot.parseConfig(
            'FLAMEGRAPH(frames: "f", value: "v", direction: "up")', []);
        expect(cfg.direction).toBe('up');
    });

    it('parses minFrameWidth override', () => {
        const cfg = flameGraphPlot.parseConfig(
            'FLAMEGRAPH(frames: "f", value: "v", minFrameWidth: 0.5)', []);
        expect(cfg.minFrameWidth).toBeCloseTo(0.5);
    });

    it('parses initial search string', () => {
        const cfg = flameGraphPlot.parseConfig(
            'FLAMEGRAPH(frames: "f", value: "v", search: "G1")', []);
        expect(cfg.search).toBe('G1');
    });

    it('deprecated "label" alias resolves to frames', () => {
        const cfg = flameGraphPlot.parseConfig('FLAMEGRAPH(label: "frame", value: "v")', []);
        expect(cfg.frames).toBe('frame');
    });

    it('"stacktrace" alias resolves to frames', () => {
        const cfg = flameGraphPlot.parseConfig('FLAMEGRAPH(stacktrace: "st", value: "v")', []);
        expect(cfg.frames).toBe('st');
    });
});
