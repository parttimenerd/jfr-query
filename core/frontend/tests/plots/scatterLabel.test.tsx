// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import type { ParsedPlotCall } from '../../utils/plotParser';

vi.mock('../../context/SettingsContext', () => ({
    SettingsContext: React.createContext({ settings: { decimalPlaces: 2, timeFormat: 'HH:mm:ss' }, updateSetting: vi.fn() }),
}));

const data = [
    { x: 1, y: 10, name: 'A' },
    { x: 2, y: 20, name: 'B' },
    { x: 3, y: 15, name: 'C' },
];

describe('ScatterPlot — label param', () => {
    it('renders without error when label param is provided', async () => {
        const { scatterPlot } = await import('../../components/plots/ScatterPlot');
        const config = scatterPlot.parseConfig('SCATTER_PLOT(x:"x",y:"y",label:"name")', data);
        expect(config.label).toBe('name');
        expect(() => render(React.createElement(scatterPlot.component as any, {
            config, data,
            clauses: { mainConfig: 'SCATTER_PLOT(x:"x",y:"y",label:"name")' } as ParsedPlotCall,
        }))).not.toThrow();
    });

    it('renders without error when label param is absent', async () => {
        const { scatterPlot } = await import('../../components/plots/ScatterPlot');
        const config = scatterPlot.parseConfig('SCATTER_PLOT(x:"x",y:"y")', data);
        expect(config.label).toBeUndefined();
        expect(() => render(React.createElement(scatterPlot.component as any, {
            config, data,
            clauses: { mainConfig: 'SCATTER_PLOT(x:"x",y:"y")' } as ParsedPlotCall,
        }))).not.toThrow();
    });
});
