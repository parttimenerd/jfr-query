import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../context/SettingsContext', () => ({
    SettingsContext: { Consumer: ({ children }: any) => children({}), Provider: ({ children }: any) => children },
    useContext: () => ({}),
}));
vi.mock('../../../services/AiService', () => ({ providerMetadataRegistry: {} }));

import { lineChartPlot } from '../../../components/plots/LineChartPlot';

// ── registration ──────────────────────────────────────────────────────────────
describe('lineChartPlot registration', () => {
    it('has name LINE_CHART', () => expect(lineChartPlot.name).toBe('LINE_CHART'));

    it('x param is required', () => {
        expect(lineChartPlot.params.find(p => p.name === 'x')?.required).toBe(true);
    });

    it('y param is required', () => {
        expect(lineChartPlot.params.find(p => p.name === 'y')?.required).toBe(true);
    });

    it('yScale defaults to "linear"', () => {
        expect(lineChartPlot.params.find(p => p.name === 'yScale')?.defaultValue).toBe('linear');
    });

    it('connectNulls defaults to false', () => {
        expect(lineChartPlot.params.find(p => p.name === 'connectNulls')?.defaultValue).toBe(false);
    });

    it('lineType defaults to "line"', () => {
        expect(lineChartPlot.params.find(p => p.name === 'lineType')?.defaultValue).toBe('line');
    });

    it('supportsZoom is true', () => {
        expect(lineChartPlot.supportsZoom).toBe(true);
    });

    it('supportsMultiQuery is true', () => {
        expect(lineChartPlot.supportsMultiQuery).toBe(true);
    });

    it('template covers x and y', () => {
        expect(lineChartPlot.template).toContain('x:');
        expect(lineChartPlot.template).toContain('y:');
    });
});

// ── parseConfig ───────────────────────────────────────────────────────────────
describe('lineChartPlot parseConfig', () => {
    it('parses x and y columns', () => {
        const cfg = lineChartPlot.parseConfig('LINE_CHART(x: "timestamp", y: ["cpuLoad"])', []);
        expect(cfg.x).toBe('timestamp');
        expect(cfg.y).toContain('cpuLoad');
    });

    it('parses multiple y columns', () => {
        const cfg = lineChartPlot.parseConfig(
            'LINE_CHART(x: "ts", y: ["p50", "p99"])', []);
        expect(cfg.y).toContain('p50');
        expect(cfg.y).toContain('p99');
    });

    it('parses optional y2 second-axis columns', () => {
        const cfg = lineChartPlot.parseConfig(
            'LINE_CHART(x: "ts", y: ["heapUsed"], y2: ["gcThroughput"])', []);
        expect(cfg.y2).toContain('gcThroughput');
    });

    it('parses yScale override', () => {
        const cfg = lineChartPlot.parseConfig(
            'LINE_CHART(x: "ts", y: ["val"], yScale: "log")', []);
        expect(cfg.yScale).toBe('log');
    });

    it('parses lineType dots', () => {
        const cfg = lineChartPlot.parseConfig(
            'LINE_CHART(x: "ts", y: ["val"], lineType: "dots")', []);
        expect(cfg.lineType).toBe('dots');
    });

    it('parses connectNulls override', () => {
        const cfg = lineChartPlot.parseConfig(
            'LINE_CHART(x: "ts", y: ["val"], connectNulls: true)', []);
        expect(cfg.connectNulls).toBe(true);
    });

    it('parses yAxisLabel', () => {
        const cfg = lineChartPlot.parseConfig(
            'LINE_CHART(x: "ts", y: ["val"], yAxisLabel: "MB/s")', []);
        expect(cfg.yAxisLabel).toBe('MB/s');
    });

    it('parses optional color column', () => {
        const cfg = lineChartPlot.parseConfig(
            'LINE_CHART(x: "ts", y: ["val"], color: "thread")', []);
        expect(cfg.color).toBe('thread');
    });
});
