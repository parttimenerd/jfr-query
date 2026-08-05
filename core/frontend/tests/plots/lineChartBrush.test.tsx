// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import type { ParsedPlotCall } from '../../utils/plotParser';

// Mock SettingsContext + AiService to break the circular dep chain that causes
// lineChartPlot to be undefined when plotRegistry initializes via SettingsContext.
vi.mock('../../context/SettingsContext', () => ({
    SettingsContext: React.createContext({ settings: { decimalPlaces: 2, timeFormat: 'HH:mm:ss' }, updateSetting: vi.fn() }),
}));

const data = [
    { t: 1000, v: 10 }, { t: 2000, v: 20 }, { t: 3000, v: 15 },
];

describe('LineChartComponent — brush props accepted', () => {
    it('renders without error when gestureName + onVariableChange are provided', async () => {
        const { lineChartPlot } = await import('../../components/plots/LineChartPlot');
        const onVariableChange = vi.fn();
        const config = lineChartPlot.parseConfig('LINE_CHART(x:"t",y:["v"])', data);
        expect(() => render(React.createElement(lineChartPlot.component as any, {
            config, data,
            clauses: { mainConfig: 'LINE_CHART(x:"t",y:["v"])' } as ParsedPlotCall,
            gestureName: 'sel',
            onVariableChange,
        }))).not.toThrow();
    });

    it('does not render Brush element when gestureName is absent', async () => {
        const { lineChartPlot } = await import('../../components/plots/LineChartPlot');
        const config = lineChartPlot.parseConfig('LINE_CHART(x:"t",y:["v"])', data);
        const { container } = render(React.createElement(lineChartPlot.component as any, {
            config, data,
            clauses: { mainConfig: 'LINE_CHART(x:"t",y:["v"])' } as ParsedPlotCall,
        }));
        expect(container.querySelector('.recharts-brush')).toBeNull();
    });
});
