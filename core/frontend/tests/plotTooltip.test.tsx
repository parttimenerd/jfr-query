// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { PlotTooltip } from '../components/plots/PlotTooltip';
import { parsePlotCall } from '../utils/plotParser';

const payload = [
  { name: 'method', value: 'foo()', dataKey: 'method', color: '#f00' },
  { name: 'duration', value: 123, dataKey: 'duration', color: '#0f0' },
  { name: 'thread', value: 'main', dataKey: 'thread', color: '#00f' },
];

describe('PlotTooltip', () => {
  it('formats {col} placeholders when onHoverTooltip is set', () => {
    const { container } = render(
      <PlotTooltip active={true} payload={payload} onHoverTooltip="Method: {method} — {duration}ms" />
    );
    expect(container.textContent).toContain('Method: foo() — 123ms');
  });

  it('filters rows when tooltipColumns is set', () => {
    const { container } = render(
      <PlotTooltip active={true} payload={payload} tooltipColumns={['method', 'duration']} />
    );
    expect(container.textContent).toContain('method');
    expect(container.textContent).toContain('duration');
    expect(container.textContent).not.toContain('thread');
  });

  it('returns null when inactive', () => {
    const { container } = render(
      <PlotTooltip active={false} payload={payload} onHoverTooltip="x: {duration}" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows all payload entries when both filters absent', () => {
    const { container } = render(
      <PlotTooltip active={true} payload={payload} />
    );
    // Default tooltip now renders all payload entries instead of returning null
    expect(container.firstChild).not.toBeNull();
    expect(container.textContent).toContain('method');
    expect(container.textContent).toContain('duration');
    expect(container.textContent).toContain('thread');
  });
});

describe('PlotTooltip DSL integration', () => {
  it('parses ON HOVER TOOLTIP', () => {
    const parsed = parsePlotCall('LINE_CHART X t Y v ON HOVER TOOLTIP "at {t}: {v}"');
    expect(parsed.onHoverTooltip).toBe('at {t}: {v}');
  });
  it('parses TOOLTIP COLUMNS [...]', () => {
    const parsed = parsePlotCall('LINE_CHART X t Y v TOOLTIP COLUMNS [a, "b c", d]');
    expect(parsed.tooltipColumns).toEqual(['a', 'b c', 'd']);
  });
});
