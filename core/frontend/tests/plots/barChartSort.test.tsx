// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import type { ParsedPlotCall } from '../../utils/plotParser';

// Mock SettingsContext to avoid circular dep via AiService → plotRegistry
vi.mock('../../context/SettingsContext', () => ({
    SettingsContext: React.createContext({ settings: { decimalPlaces: 2, timeFormat: 'HH:mm:ss' }, updateSetting: vi.fn() }),
}));

const data = [
    { cause: 'A', cnt: 100 },
    { cause: 'B', cnt: 300 },
    { cause: 'C', cnt: 200 },
];

describe('BarChartComponent — LIMIT', () => {
    it('renders chart without error', async () => {
        const { barChartPlot } = await import('../../components/plots/BarChartPlot');
        const config = barChartPlot.parseConfig('BAR_CHART(x:"cause",y:["cnt"])', data);
        const clauses: ParsedPlotCall = { mainConfig: 'BAR_CHART(x:"cause",y:["cnt"])' };
        expect(() => render(
            React.createElement(barChartPlot.component as any, { config, data, clauses })
        )).not.toThrow();
    });

    it('truncates to LIMIT 2', async () => {
        const { barChartPlot } = await import('../../components/plots/BarChartPlot');
        const config = barChartPlot.parseConfig('BAR_CHART(x:"cause",y:["cnt"])', data);
        const clauses: ParsedPlotCall = { mainConfig: 'BAR_CHART(x:"cause",y:["cnt"])', limit: 2 };
        expect(() => render(
            React.createElement(barChartPlot.component as any, { config, data, clauses })
        )).not.toThrow();
    });
});

describe('BarChartComponent — yRefLines', () => {
    it('renders without error when yRefLines is provided', async () => {
        const { barChartPlot } = await import('../../components/plots/BarChartPlot');
        const configStr = 'BAR_CHART(x:"cause",y:["cnt"],yRefLines:[{value:200,label:"Target"}])';
        const config = barChartPlot.parseConfig(configStr, data);
        const clauses: ParsedPlotCall = { mainConfig: 'BAR_CHART(x:"cause",y:["cnt"])' };
        expect(() => render(
            React.createElement(barChartPlot.component as any, { config, data, clauses })
        )).not.toThrow();
    });
});
