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

describe('formatValue — duration_ms', () => {
  it('formats sub-millisecond as microseconds', () => {
    expect(formatValue(0.5, 'duration_ms', {})).toBe('500 µs');
  });

  it('formats milliseconds', () => {
    expect(formatValue(5.25, 'duration_ms', {})).toBe('5.25 ms');
  });

  it('formats whole milliseconds without decimals above 10ms', () => {
    expect(formatValue(120, 'duration_ms', {})).toBe('120 ms');
  });

  it('formats seconds', () => {
    expect(formatValue(1500, 'duration_ms', {})).toBe('1.50 s');
  });

  it('formats minutes', () => {
    expect(formatValue(90_000, 'duration_ms', {})).toBe('1.50 min');
  });

  it('formats hours for large durations', () => {
    expect(formatValue(7_200_000, 'duration_ms', {})).toBe('2.00 h');
  });

  it('handles negative durations', () => {
    expect(formatValue(-500, 'duration_ms', {})).toBe('-500 ms');
  });

  it('returns String(value) for non-numeric input', () => {
    expect(formatValue('fast', 'duration_ms', {})).toBe('fast');
  });
});

describe('formatValue — duration_ns', () => {
  it('converts nanoseconds to ms before formatting', () => {
    // 5_000_000 ns = 5 ms (< 10 ms → 2 decimal places)
    expect(formatValue(5_000_000, 'duration_ns', {})).toBe('5.00 ms');
  });
});

describe('formatValue — bytes', () => {
  it('formats 0 as "0 B"', () => {
    expect(formatValue(0, 'bytes', {})).toBe('0 B');
  });

  it('formats raw bytes', () => {
    expect(formatValue(512, 'bytes', {})).toBe('512 B');
  });

  it('formats KiB', () => {
    expect(formatValue(2048, 'bytes', {})).toBe('2.00 KiB');
  });

  it('formats MiB', () => {
    expect(formatValue(1024 * 1024, 'bytes', {})).toBe('1.00 MiB');
  });

  it('formats GiB', () => {
    expect(formatValue(1024 ** 3, 'bytes', {})).toBe('1.00 GiB');
  });

  it('handles negative bytes', () => {
    expect(formatValue(-1024, 'bytes', {})).toBe('-1.00 KiB');
  });
});

describe('formatValue — pct', () => {
  it('multiplies by 100 and appends %', () => {
    expect(formatValue(0.75, 'pct', {})).toBe('75.00%');
  });

  it('handles 1.0 as 100.00%', () => {
    expect(formatValue(1, 'pct', {})).toBe('100.00%');
  });
});

describe('formatValue — int', () => {
  it('truncates fractional part and formats with commas', () => {
    expect(formatValue(1_234_567.89, 'int', {})).toBe('1,234,567');
  });

  it('handles negative integers', () => {
    expect(formatValue(-42.9, 'int', {})).toBe('-42');
  });
});

describe('formatValue — float', () => {
  it('uses decimalPlaces from settings', () => {
    expect(formatValue(3.14159, 'float', { decimalPlaces: 3 })).toBe('3.142');
  });

  it('defaults to 2 decimal places', () => {
    expect(formatValue(3.14159, 'float', {})).toBe('3.14');
  });
});

describe('formatValue — raw', () => {
  it('JSON.stringifies objects', () => {
    expect(formatValue({ key: 'val' }, 'raw', {})).toBe('{"key":"val"}');
  });

  it('String()s scalars', () => {
    expect(formatValue(42, 'raw', {})).toBe('42');
    expect(formatValue(true, 'raw', {})).toBe('true');
  });
});

describe('formatValue — null/undefined', () => {
  it('returns em-dash for null', () => {
    expect(formatValue(null, undefined, {})).toBe('—');
  });

  it('returns em-dash for undefined', () => {
    expect(formatValue(undefined, undefined, {})).toBe('—');
  });
});

describe('formatValue — no format hint (inferred)', () => {
  it('formats an integer with commas', () => {
    expect(formatValue(1000, undefined, {})).toBe('1,000');
  });

  it('formats a float with decimalPlaces', () => {
    expect(formatValue(3.14159, undefined, { decimalPlaces: 4 })).toBe('3.1416');
  });

  it('stringifies an object', () => {
    expect(formatValue({ a: 1 }, undefined, {})).toBe('{"a":1}');
  });

  it('returns string unchanged', () => {
    expect(formatValue('hello', undefined, {})).toBe('hello');
  });
});

