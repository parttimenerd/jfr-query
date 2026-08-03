import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../context/SettingsContext', () => ({
    SettingsContext: { Consumer: ({ children }: any) => children({}), Provider: ({ children }: any) => children },
    useContext: () => ({}),
}));
vi.mock('../../../services/AiService', () => ({ providerMetadataRegistry: {} }));

import { rangePlot } from '../../../components/plots/RangePlot';

describe('rangePlot registration', () => {
    it('has name RANGE', () => expect(rangePlot.name).toBe('RANGE'));

    it('x, low, high params are required', () => {
        const req = rangePlot.params.filter(p => p.required).map(p => p.name);
        expect(req).toContain('x');
        expect(req).toContain('low');
        expect(req).toContain('high');
    });

    it('center param is optional', () => {
        const p = rangePlot.params.find(p => p.name === 'center');
        expect(p).toBeDefined();
        expect(p?.required).toBeFalsy();
    });

    it('opacity param defaults to 0.3', () => {
        expect(rangePlot.params.find(p => p.name === 'opacity')?.defaultValue).toBeCloseTo(0.3);
    });

    it('color param defaults to a CSS color string', () => {
        const c = rangePlot.params.find(p => p.name === 'color');
        expect(c?.defaultValue).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('template covers all three required params', () => {
        expect(rangePlot.template).toContain('x:');
        expect(rangePlot.template).toContain('low:');
        expect(rangePlot.template).toContain('high:');
    });

    it('supportsZoom is true', () => {
        expect(rangePlot.supportsZoom).toBe(true);
    });
});

describe('rangePlot parseConfig', () => {
    it('parses x, low, high columns', () => {
        const cfg = rangePlot.parseConfig('RANGE(x: "timestamp", low: "p5", high: "p95")', []);
        expect(cfg.x).toBe('timestamp');
        expect(cfg.low).toBe('p5');
        expect(cfg.high).toBe('p95');
    });

    it('parses optional center column', () => {
        const cfg = rangePlot.parseConfig(
            'RANGE(x: "ts", low: "lo", high: "hi", center: "median")', []);
        expect(cfg.center).toBe('median');
    });

    it('parses opacity override', () => {
        const cfg = rangePlot.parseConfig(
            'RANGE(x: "ts", low: "lo", high: "hi", opacity: 0.5)', []);
        expect(cfg.opacity).toBeCloseTo(0.5);
    });

    it('parses color override', () => {
        const cfg = rangePlot.parseConfig(
            'RANGE(x: "ts", low: "lo", high: "hi", color: "#82ca9d")', []);
        expect(cfg.color).toBe('#82ca9d');
    });

    it('full config with all optional fields', () => {
        const cfg = rangePlot.parseConfig(
            'RANGE(x: "timestamp", low: "cpuMin", high: "cpuMax", center: "cpuMedian", color: "#82ca9d", opacity: 0.25)', []);
        expect(cfg).toMatchObject({
            x: 'timestamp',
            low: 'cpuMin',
            high: 'cpuMax',
            center: 'cpuMedian',
            color: '#82ca9d',
            opacity: 0.25,
        });
    });
});
