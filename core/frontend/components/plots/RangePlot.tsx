import React, { useContext, useMemo } from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { formatNumber } from '../../utils/numberFormatter';
import { formatTimestamp } from '../../utils/timeFormatter';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn, getTimeValue } from '../../utils/plotUtils';
import { usePlotGestures } from '../../hooks/usePlotGestures';
import type { ParsedPlotCall } from '../../utils/plotParser';
import { makeTickFormatter, mapAxisScale } from '../../utils/axisFormat';
import { PlotTooltip } from './PlotTooltip';

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
  clauses?: ParsedPlotCall;
}> = ({ config, data, domainX, domainY, isAnimationActive, animationDuration, gestureName, onVariableChange, clauses }) => {
  const { settings } = useContext(SettingsContext);
  const numberFormatter = (v: any) => formatNumber(v, settings.decimalPlaces);
  const gestures = usePlotGestures({ name: gestureName, onVariableChange });
  const legendPos = clauses?.legend;
  const showLegend = legendPos !== 'none';
  const xDomainFromClause = clauses?.axisX?.domain as [any, any] | undefined;
  const xLabelFromClause = clauses?.axisX?.label;
  const yDomainFromClause = clauses?.axisY?.domain as [any, any] | undefined;
  const yLabelFromClause = clauses?.axisY?.label;

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

    // Recharts stacked Areas: the first Area fills 0→low (transparent baseline),
    // the second Area fills low→high by storing the *band height* (high - low) as
    // __rangeHeight. Both share stackId="range-band" so they stack correctly.
    const transformedData = data.map(row => {
      const newRow: any = { ...row };
      if (isTimeAxis) {
        newRow[xCol] = getTimeValue(newRow[xCol]);
      }
      const lNum = row[lCol] == null ? NaN : Number(row[lCol]);
      const hNum = row[hCol] == null ? NaN : Number(row[hCol]);
      const lo = Math.min(lNum, hNum);
      const hi = Math.max(lNum, hNum);
      newRow.__rangeLow = lo;
      newRow.__rangeHigh = hi - lo; // band height for stacking (always ≥ 0)
      newRow.__rangeHighAbs = hi; // kept for tooltip display
      if (cCol) newRow.__center = Number(row[cCol]);
      return newRow;
    });

    return { chartData: transformedData, isTime: isTimeAxis, finalXCol: xCol, lowKey: lCol, highKey: hCol, centerKey: cCol };
  }, [data, config]);

  const color = config.color || '#8884d8';

  return (
    <div style={{ width: '100%', minHeight: 200 }}>
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
            domain={xDomainFromClause || domainX || (isTime ? ['dataMin', 'dataMax'] : undefined)}
            tickFormatter={makeTickFormatter(clauses?.axisX) ?? (isTime ? (t: any) => formatTimestamp(t, 'HH:mm:ss.SS') : undefined)}
            scale={mapAxisScale(clauses?.axisX)}
            stroke="#9ca3af"
            tick={{ fontSize: 12 }}
            label={xLabelFromClause ? { value: xLabelFromClause, position: 'insideBottom', fill: '#9ca3af', fontSize: 12, offset: -5 } : undefined}
          />
          <YAxis
            stroke="#9ca3af"
            tick={{ fontSize: 12 }}
            tickFormatter={makeTickFormatter(clauses?.axisY) ?? numberFormatter}
            scale={mapAxisScale(clauses?.axisY)}
            domain={yDomainFromClause || domainY}
            allowDataOverflow
            label={
              (yLabelFromClause || config.yAxisLabel)
                ? { value: yLabelFromClause || config.yAxisLabel, angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 12 }
                : undefined
            }
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }}
            formatter={(v: any, n: any, item: any) => {
              if (n === '__rangeLow') return [numberFormatter(v), `Low (${lowKey})`];
              // For the band height, display the absolute high value from __rangeHighAbs
              if (n === '__rangeHigh') {
                const absHigh = item?.payload?.__rangeHighAbs;
                const display = (absHigh != null && !isNaN(absHigh)) ? absHigh : v + (item?.payload?.__rangeLow ?? 0);
                return [numberFormatter(display), `High (${highKey})`];
              }
              if (n === '__center') return [numberFormatter(v), centerKey ? `Center (${centerKey})` : 'Center'];
              return [numberFormatter(v), String(n).replace(/_/g, ' ')];
            }}
            labelFormatter={isTime ? (l) => formatTimestamp(l, settings.timeFormat) : undefined}
            content={(clauses?.onHoverTooltip || (clauses?.tooltipColumns && clauses.tooltipColumns.length > 0)) ? (props: any) => (<PlotTooltip {...props} onHoverTooltip={clauses?.onHoverTooltip} tooltipColumns={clauses?.tooltipColumns} labelFormatter={isTime ? (l: any) => formatTimestamp(l, settings.timeFormat) : undefined} />) : undefined}
          />
          {showLegend && <Legend
            wrapperStyle={{ fontSize: '12px' }}
            verticalAlign={legendPos === 'top' ? 'top' : 'bottom'}
            align={legendPos === 'left' ? 'left' : legendPos === 'right' ? 'right' : 'center'}
            formatter={(v: string) => {
              if (v === '__rangeHigh') return `Range (${lowKey} – ${highKey})`;
              if (v === '__rangeLow') return null as any;
              if (v === '__center') return centerKey ? `Center (${centerKey})` : 'Center';
              return String(v).replace(/_/g, ' ');
            }}
          />}
          {/* Lower bound — invisible base, fills from 0 to low */}
          <Area
            type="monotone"
            dataKey="__rangeLow"
            stroke="none"
            fill="none"
            stackId="range-band"
            isAnimationActive={isAnimationActive}
            animationDuration={animationDuration}
            legendType="none"
          />
          {/* Upper bound — fills only the band between low and high via stackId */}
          <Area
            type="monotone"
            dataKey="__rangeHigh"
            stroke={color}
            strokeWidth={1}
            strokeDasharray="4 2"
            fill={color}
            fillOpacity={config.opacity}
            stackId="range-band"
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
  supportsZoom: true,
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
