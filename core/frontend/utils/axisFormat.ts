import { format as d3Format } from 'd3-format';
import { formatTimestamp } from './timeFormatter';
import type { AxisSpec } from './plotParser';

export function makeTickFormatter(
  axis: AxisSpec | undefined,
): ((v: number | string) => string) | undefined {
  if (!axis) return undefined;
  if (axis.type === 'time') {
    const spec = axis.format ?? 'HH:mm:ss.SSS';
    return (v) => formatTimestamp(v as number, spec);
  }
  if (axis.format) {
    try {
      const f = d3Format(axis.format);
      return (v) => (typeof v === 'number' ? f(v) : String(v));
    } catch {
      return (v) => String(v);
    }
  }
  return undefined;
}

export function mapAxisScale(axis: AxisSpec | undefined): 'time' | 'log' | 'band' | undefined {
  if (!axis) return undefined;
  switch (axis.type) {
    case 'time': return 'time';
    case 'log': return 'log';
    case 'band': return 'band';
    default: return undefined;
  }
}
