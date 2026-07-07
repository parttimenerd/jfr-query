import { describe, it, expect } from 'vitest';
import { formatValue } from '../services/templating/formatValue';

describe('formatValue — time', () => {
  it('renders time values using settings.timeFormat', () => {
    const settings = { timeFormat: 'HH:mm:ss' };
    expect(formatValue(83_000, 'time', settings)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('falls back to HH:mm:ss.SSS when timeFormat is unset', () => {
    expect(formatValue(83_000, 'time', {})).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  it('returns String(value) when the value cannot be parsed', () => {
    expect(formatValue('not a date', 'time', {})).toBe('not a date');
  });
});
