import { describe, it, expect } from 'vitest';
import { makeTickFormatter, mapAxisScale } from '../utils/axisFormat';
import { parsePlotCall } from '../utils/plotParser';

describe('AXIS wiring end-to-end', () => {
  it('parses AXIS_X TYPE time and AXIS_X FORMAT "HH:mm:ss" and yields a tick formatter', () => {
    const parsed = parsePlotCall('LINE_CHART X t Y v AXIS_X TYPE time AXIS_X FORMAT "HH:mm:ss"');
    expect(parsed.axisX?.type).toBe('time');
    expect(parsed.axisX?.format).toBe('HH:mm:ss');
    const fmt = makeTickFormatter(parsed.axisX);
    expect(fmt).toBeDefined();
    expect(fmt!(0)).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(mapAxisScale(parsed.axisX)).toBe('time');
  });

  it('parses AXIS_Y TYPE log and AXIS_Y FORMAT ".2f"', () => {
    const parsed = parsePlotCall('SCATTER_PLOT X t Y v AXIS_Y TYPE log AXIS_Y FORMAT ".2f"');
    expect(parsed.axisY?.type).toBe('log');
    const fmt = makeTickFormatter(parsed.axisY);
    expect(fmt!(3.14159)).toBe('3.14');
    expect(mapAxisScale(parsed.axisY)).toBe('log');
  });
});
