import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../context/SettingsContext', () => ({
    SettingsContext: { Consumer: ({ children }: any) => children({}), Provider: ({ children }: any) => children },
    useContext: () => ({}),
}));
vi.mock('../../../services/AiService', () => ({ providerMetadataRegistry: {} }));

import { tablePlot } from '../../../components/plots/TablePlot';

// ── registration ──────────────────────────────────────────────────────────────
describe('tablePlot registration', () => {
    it('has name TABLE', () => expect(tablePlot.name).toBe('TABLE'));

    it('headers param is optional', () => {
        const p = tablePlot.params.find(p => p.name === 'headers');
        expect(p).toBeDefined();
        expect(p?.required).toBeFalsy();
    });

    it('columnWidths param is optional', () => {
        const p = tablePlot.params.find(p => p.name === 'columnWidths');
        expect(p).toBeDefined();
        expect(p?.required).toBeFalsy();
    });

    it('supportsMultiQuery is falsy (table does not combine queries)', () => {
        expect(tablePlot.supportsMultiQuery).toBeFalsy();
    });

    it('template is TABLE()', () => {
        expect(tablePlot.template).toBe('TABLE()');
    });

    it('has at least one example', () => {
        expect(tablePlot.examples.length).toBeGreaterThanOrEqual(1);
    });
});

// ── parseConfig ───────────────────────────────────────────────────────────────
describe('tablePlot parseConfig', () => {
    it('empty parens → no headers or columnWidths', () => {
        const cfg = tablePlot.parseConfig('TABLE()', []);
        expect(cfg.headers).toBeUndefined();
        expect(cfg.columnWidths).toBeUndefined();
    });

    it('parses headers array', () => {
        const cfg = tablePlot.parseConfig(
            'TABLE(headers: ["startTime", "duration", "gcCause"])', []);
        expect(cfg.headers).toEqual(['startTime', 'duration', 'gcCause']);
    });

    it('parses columnWidths with numbers and strings', () => {
        const cfg = tablePlot.parseConfig(
            'TABLE(headers: ["a", "b", "c"], columnWidths: ["50%", 100, -1])', []);
        expect(cfg.columnWidths).toBeDefined();
        expect(cfg.columnWidths).toHaveLength(3);
        expect(cfg.columnWidths![0]).toBe('50%');
        expect(cfg.columnWidths![1]).toBe(100);
        expect(cfg.columnWidths![2]).toBe(-1);
    });

    it('parses headers without columnWidths', () => {
        const cfg = tablePlot.parseConfig(
            'TABLE(headers: ["col1", "col2"])', []);
        expect(cfg.headers).toHaveLength(2);
        expect(cfg.columnWidths).toBeUndefined();
    });
});
