import { describe, it, expect } from 'vitest';
import { makeTickFormatter, mapAxisScale } from '../utils/axisFormat';

describe('makeTickFormatter', () => {
  it('routes HH:mm:ss through formatTimestamp for time axes', () => {
    const fmt = makeTickFormatter({ type: 'time', format: 'HH:mm:ss' });
    expect(fmt!(83_000)).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('applies d3-format-style ".2f" to numeric axes', () => {
    const fmt = makeTickFormatter({ type: 'linear', format: '.2f' });
    expect(fmt!(3.14159)).toBe('3.14');
  });

  it('applies ",.0f" thousand-grouping to numeric axes', () => {
    const fmt = makeTickFormatter({ type: 'linear', format: ',.0f' });
    expect(fmt!(1234567)).toBe('1,234,567');
  });

  it('returns undefined when no format nor time type', () => {
    expect(makeTickFormatter({ type: 'linear' })).toBeUndefined();
    expect(makeTickFormatter(undefined)).toBeUndefined();
  });
});

describe('mapAxisScale', () => {
  it('maps type=time to "time"', () => {
    expect(mapAxisScale({ type: 'time' })).toBe('time');
  });
  it('maps type=log to "log"', () => {
    expect(mapAxisScale({ type: 'log' })).toBe('log');
  });
  it('maps type=band to "band"', () => {
    expect(mapAxisScale({ type: 'band' })).toBe('band');
  });
  it('returns undefined for linear or missing', () => {
    expect(mapAxisScale({ type: 'linear' })).toBeUndefined();
    expect(mapAxisScale(undefined)).toBeUndefined();
  });
});
