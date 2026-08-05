// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { bigNumberPlot } from '../../components/plots/BigNumberPlot';
import type { ParsedPlotCall } from '../../utils/plotParser';

const data = [{ total_pause_ms: 4231.5, gc_count: 42 }];

describe('BigNumberPlot', () => {
    it('renders the value from the first row', () => {
        const config = bigNumberPlot.parseConfig('BIG_NUMBER(value: "total_pause_ms")', data);
        const { container } = render(
            React.createElement(bigNumberPlot.component as any, {
                config,
                data,
                clauses: { mainConfig: 'BIG_NUMBER(value: "total_pause_ms")' } as ParsedPlotCall,
            })
        );
        expect(container.textContent).toContain('4');
    });

    it('renders label when provided', () => {
        const config = bigNumberPlot.parseConfig('BIG_NUMBER(value: "gc_count", label: "GC Events")', data);
        const { container } = render(
            React.createElement(bigNumberPlot.component as any, {
                config, data,
                clauses: { mainConfig: 'BIG_NUMBER(value: "gc_count")' } as ParsedPlotCall,
            })
        );
        expect(container.textContent).toContain('GC Events');
    });

    it('renders a units suffix when provided', () => {
        const config = bigNumberPlot.parseConfig('BIG_NUMBER(value: "total_pause_ms", units: "ms")', data);
        const { container } = render(
            React.createElement(bigNumberPlot.component as any, {
                config, data,
                clauses: { mainConfig: 'BIG_NUMBER(value: "total_pause_ms")' } as ParsedPlotCall,
            })
        );
        expect(container.textContent).toContain('ms');
    });

    it('shows "No data" when data is empty', () => {
        const config = bigNumberPlot.parseConfig('BIG_NUMBER(value: "x")', []);
        const { container } = render(
            React.createElement(bigNumberPlot.component as any, {
                config, data: [],
                clauses: { mainConfig: 'BIG_NUMBER(value: "x")' } as ParsedPlotCall,
            })
        );
        expect(container.textContent).toContain('No data');
    });

    it('is registered in plotRegistry', async () => {
        const { plotRegistry } = await import('../../components/plots/plotRegistry');
        expect(plotRegistry['BIG_NUMBER']).toBeDefined();
    });
});
