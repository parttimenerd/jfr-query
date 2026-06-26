import React, { useContext, useMemo } from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { formatNumber } from '../../utils/numberFormatter';
import { formatTimestamp } from '../../utils/timeFormatter';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn, getTimeValue } from '../../utils/plotUtils';
import { usePlotGestures } from '../../hooks/usePlotGestures';

interface Config {
  x: string;
  low: string;
  high: string;
  center?: string;
  color: string;
  opacity: number;
  yAxisLabel?: string;
}

const params: PlotParameter[] = [
  { name: 'x', type: 'column', required: true, description: 'Column for the X-axis.' },
  { name: 'low', type: 'column', required: true, description: 'Column for the lower bound of the range band.' },
  { name: 'high', type: 'column', required: true, description: 'Column for the upper bound of the range band.' },
  { name: 'center', type: 'column', description: 'Optional column for a center line (e.g. median or mean) drawn through the band.' },
  { name: 'color', type: 'string', defaultValue: '#8884d8', description: 'Color for the band and center line (CSS color string).' },
  { name: 'opacity', type: 'number', defaultValue: 0.3, description: 'Opacity of the shaded band (0–1).' },
  { name: 'yAxisLabel', type: 'string', description: 'Label for the Y-axis.' },
];

const parseConfig = createConfigParser<Config>(buildParserSpec(params));

const RangePlotComponent: React.FC<{
  config: Config;
  data: any[];
  domainX?: [any, any];
  domainY?: [number, number];
  isAnimationActive?: boolean;
  animationDuration?: number;
  gestureName?: string;
  onVariableChange?: (vars: Record<string, unknown>) => void;
}> = ({ config, data, domainX, domainY, isAnimationActive, animationDuration, gestureName, onVariableChange }) => {
  const { settings } = useContext(SettingsContext);
  const numberFormatter = (v: any) => formatNumber(v, settings.decimalPlaces);
  const gestures = usePlotGestures({ name: gestureName, onVariableChange });

  const { chartData, isTime, finalXCol, lowKey, highKey, centerKey } = useMemo(() => {
    if (!data || !data.length || !data[0] || !config.x) {
      return { chartData: data, isTime: false, finalXCol: config.x, lowKey: config.low, highKey: config.high, centerKey: config.center };
    }

    const allColumns = Object.keys(data[0]);
    const xCol = findColumn(config.x, allColumns);
    const lCol = findColumn(config.low, allColumns);
    const hCol = findColumn(config.high, allColumns);
    const cCol = config.center ? findColumn(config.center, allColumns) : undefined;

    const firstXValue = data.find(d => d[xCol] != null)?.[xCol];
    const timeValue = getTimeValue(firstXValue);
    const isTimeAxis = !isNaN(timeValue);

    // Recharts Area with a band uses a [low, high] array as the dataKey value.
    // We expose them as separate columns and use two Areas stacked via referenceArea trick:
    // Actually, we use a single Area where dataKey returns [low, high] — Recharts supports
    // this for "area between two values" when using type="monotone" and passing the range
    // as [baseValue, topValue]. We store these as __rangeLow and __rangeHigh.
    const transformedData = data.map(row => {
      const newRow: any = { ...row };
      if (isTimeAxis) {
        newRow[xCol] = getTimeValue(newRow[xCol]);
      }
      newRow.__rangeLow = Number(row[lCol]);
      newRow.__rangeHigh = Number(row[hCol]);
      if (cCol) newRow.__center = Number(row[cCol]);
      return newRow;
    });

    return { chartData: transformedData, isTime: isTimeAxis, finalXCol: xCol, lowKey: lCol, highKey: hCol, centerKey: cCol };
  }, [data, config]);

  const color = config.color || '#8884d8';

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 200 }}>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
          onMouseMove={gestures.onMouseMove}
          onMouseLeave={gestures.onMouseLeave}
          onClick={gestures.onClick}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" />
          <XAxis
            allowDataOverflow
            dataKey={finalXCol}
            type={isTime ? 'number' : 'category'}
            domain={domainX || (isTime ? ['dataMin', 'dataMax'] : undefined)}
            tickFormatter={isTime ? (t: any) => formatTimestamp(t, 'HH:mm:ss.SS') : undefined}
            stroke="#9ca3af"
            tick={{ fontSize: 12 }}
          />
          <YAxis
            stroke="#9ca3af"
            tick={{ fontSize: 12 }}
            tickFormatter={numberFormatter}
            domain={domainY}
            allowDataOverflow
            label={
              config.yAxisLabel
                ? { value: config.yAxisLabel, angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 12 }
                : undefined
            }
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }}
            formatter={(v: any, n: any) => {
              if (n === '__rangeLow') return [numberFormatter(v), `Low (${lowKey})`];
              if (n === '__rangeHigh') return [numberFormatter(v), `High (${highKey})`];
              if (n === '__center') return [numberFormatter(v), centerKey ? `Center (${centerKey})` : 'Center'];
              return [numberFormatter(v), String(n).replace(/_/g, ' ')];
            }}
            labelFormatter={isTime ? (l) => formatTimestamp(l, settings.timeFormat) : undefined}
          />
          <Legend
            wrapperStyle={{ fontSize: '12px' }}
            formatter={(v: string) => {
              if (v === '__rangeHigh') return `Range (${lowKey} – ${highKey})`;
              if (v === '__rangeLow') return null as any; // hide low from legend — range is shown via high entry
              if (v === '__center') return centerKey ? `Center (${centerKey})` : 'Center';
              return String(v).replace(/_/g, ' ');
            }}
          />
          {/* Lower bound line — invisible, used as the baseline for the filled Area */}
          <Area
            type="monotone"
            dataKey="__rangeLow"
            stroke="none"
            fill="none"
            isAnimationActive={isAnimationActive}
            animationDuration={animationDuration}
            legendType="none"
          />
          {/* Upper bound — fills down to __rangeLow via baseValue stack trick using two Areas */}
          <Area
            type="monotone"
            dataKey="__rangeHigh"
            stroke={color}
            strokeWidth={1}
            strokeDasharray="4 2"
            fill={color}
            fillOpacity={config.opacity}
            isAnimationActive={isAnimationActive}
            animationDuration={animationDuration}
            dot={false}
            activeDot={{ r: 3 }}
          />
          {/* Center line */}
          {centerKey && (
            <Line
              type="monotone"
              dataKey="__center"
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={isAnimationActive}
              animationDuration={animationDuration}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export const rangePlot: PlotRegistration<Config> = {
  name: 'RANGE',
  description: 'Confidence interval / error band chart — shaded area between a low and high bound with an optional center line. Useful for showing p5–p95 latency bands, GC pause ranges, or CPU confidence intervals.',
  params: withCommonParams(params),
  supportsMultiQuery: false,
  template: 'RANGE(x: , low: , high: )',
  examples: [
    {
      description: 'A range band showing p5 to p95 GC pause latency over time.',
      code: 'RANGE(x: "timestamp", low: "p5pause", high: "p95pause") TITLE "GC Pause Latency Band"',
      sampleData: [
        { timestamp: '2023-01-01T12:00:00Z', p5pause: 5, p95pause: 45 },
        { timestamp: '2023-01-01T12:01:00Z', p5pause: 8, p95pause: 60 },
        { timestamp: '2023-01-01T12:02:00Z', p5pause: 4, p95pause: 38 },
        { timestamp: '2023-01-01T12:03:00Z', p5pause: 10, p95pause: 80 },
      ],
    },
    {
      description: 'A range band with a median center line showing CPU usage spread.',
      code: 'RANGE(x: "timestamp", low: "cpuMin", high: "cpuMax", center: "cpuMedian", color: "#82ca9d", opacity: 0.25)',
      sampleData: [
        { timestamp: '2023-01-01T12:00:00Z', cpuMin: 0.3, cpuMedian: 0.6, cpuMax: 0.85 },
        { timestamp: '2023-01-01T12:01:00Z', cpuMin: 0.4, cpuMedian: 0.7, cpuMax: 0.9 },
        { timestamp: '2023-01-01T12:02:00Z', cpuMin: 0.2, cpuMedian: 0.5, cpuMax: 0.75 },
        { timestamp: '2023-01-01T12:03:00Z', cpuMin: 0.5, cpuMedian: 0.75, cpuMax: 0.95 },
      ],
    },
  ],
  parseConfig,
  component: RangePlotComponent,
};
