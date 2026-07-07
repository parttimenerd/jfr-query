import React, { useContext, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush } from 'recharts';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { formatNumber } from '../../utils/numberFormatter';
import { formatTimestamp } from '../../utils/timeFormatter';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn, findColumns, getTimeValue, isDurationColumnName, formatDurationNs, sampleLooksLikeNanoseconds, getPaletteColors } from '../../utils/plotUtils';
import { usePlotGestures } from '../../hooks/usePlotGestures';
import { warnDeprecated } from './deprecation';
import type { ParsedPlotCall } from '../../utils/plotParser';
import { lttb } from '../../services/plot/decimation';
import { makeTickFormatter, mapAxisScale } from '../../utils/axisFormat';

const AREA_SOFT_CAP_PER_SERIES = 5000;

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

interface Config {
  x: string;
  y: string[];
  color?: string;
  layout?: 'stacked' | 'overlay';
  stack?: boolean;
  opacity: number;
  yAxisLabel?: string;
  yScale: 'linear' | 'log';
  connectNulls: boolean;
  xRefLines?: any[];
}

const params: PlotParameter[] = [
  { name: 'x', type: 'column', required: true, description: 'Column for the X-axis.' },
  { name: 'y', type: 'column[]', required: true, description: 'One or more numeric columns for the area series.' },
  { name: 'color', type: 'column', description: 'Optional column whose distinct values group areas by color (one series per value).' },
  { name: 'layout', type: 'string', options: ['stacked', 'overlay'], defaultValue: 'overlay', description: 'Layout for multiple `y` series: "stacked" (areas stacked) or "overlay" (areas drawn over each other).' },
  { name: 'stack', type: 'boolean', deprecated: true, description: 'Deprecated. Use layout: "stacked" or layout: "overlay".' },
  { name: 'opacity', type: 'number', defaultValue: 0.6, description: 'Fill opacity for the area (0–1).' },
  { name: 'yAxisLabel', type: 'string', description: 'Label for the Y-axis.' },
  { name: 'yScale', type: 'string', defaultValue: 'linear', options: ['linear', 'log'], description: 'Scale for the Y-axis: "linear" or "log".' },
  { name: 'connectNulls', type: 'boolean', defaultValue: false, description: 'Connect lines over null/missing values.' },
  { name: 'xRefLines', type: 'referenceLine[]', description: 'Vertical reference lines.' },
];

const parseConfig = createConfigParser<Config>(buildParserSpec(params));

const AreaChartComponent: React.FC<{
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
  const effectiveYScale = (clauses?.axisY?.type === 'log' ? 'log' : config.yScale) as 'linear' | 'log';
  const yDomainFromClause = clauses?.axisY?.domain as [any, any] | undefined;
  const yLabelFromClause = clauses?.axisY?.label;
  const xDomainFromClause = clauses?.axisX?.domain as [any, any] | undefined;
  const xLabelFromClause = clauses?.axisX?.label;
  const legendPos = clauses?.legend;
  const showLegend = legendPos !== 'none';

  const { chartData, isTime, allY, finalXCol } = useMemo(() => {
    if (!data || !data.length || !data[0] || !config.x) {
      return { chartData: data, isTime: false, allY: [], finalXCol: config.x };
    }

    const allColumns = Object.keys(data[0]);
    const xCol = findColumn(config.x, allColumns);

    const firstXValue = data.find(d => d[xCol] != null)?.[xCol];
    const timeValue = getTimeValue(firstXValue);
    const isTimeAxis = !isNaN(timeValue);

    const allYCols = config.y
      ? Array.from(new Set(config.y.flatMap(col => findColumns(col, allColumns))))
      : [];

    const transformedData = isTimeAxis
      ? data.map(row => {
          const newRow = { ...row };
          const timeCols = findColumns(config.x, Object.keys(newRow));
          for (const col of timeCols) {
            newRow[col] = getTimeValue(newRow[col]);
          }
          return newRow;
        })
      : data;

    // When a color column is specified, pivot by color value — same approach as
    // LineChartPlot: one series key per (colorValue × yCol), one row per x value.
    if (config.color && allColumns.includes(config.color)) {
        const colorCol = config.color;
        const colorValues = Array.from(new Set(transformedData.map(r => String(r[colorCol] ?? ''))));
        const yColsForColor = allYCols.length > 0 ? allYCols : (allColumns.filter(c => c !== xCol && c !== colorCol).slice(0, 1));
        const seriesKeys = colorValues.flatMap(cv =>
            yColsForColor.map(yc => yColsForColor.length === 1 ? cv : `${cv} ${yc}`)
        );
        const xMap = new Map<any, Record<string, any>>();
        for (const row of transformedData) {
            const xv = row[xCol];
            if (!xMap.has(xv)) xMap.set(xv, { [xCol]: xv });
            const entry = xMap.get(xv)!;
            const cv = String(row[colorCol] ?? '');
            for (const yc of yColsForColor) {
                const sk = yColsForColor.length === 1 ? cv : `${cv} ${yc}`;
                entry[sk] = row[yc];
            }
        }
        const pivoted = Array.from(xMap.values()).sort((a, b) => {
            const av = a[xCol], bv = b[xCol];
            return av < bv ? -1 : av > bv ? 1 : 0;
        });
        return { chartData: pivoted, isTime: isTimeAxis, allY: seriesKeys, finalXCol: xCol };
    }

    // W13 — LTTB decimation when over the soft cap (time-axis only).
    // B-121: run LTTB guided by each Y series and union the selected indices so
    // features of ALL series are preserved, not just the first one.
    let decimated = transformedData;
    if (isTimeAxis && transformedData.length > AREA_SOFT_CAP_PER_SERIES && allYCols.length > 0) {
        if (allYCols.length === 1) {
            decimated = lttb(transformedData, xCol, allYCols[0], AREA_SOFT_CAP_PER_SERIES);
        } else {
            // Union of per-series selections (deduplicated, preserving order).
            const selected = new Set<number>();
            const perSeries = allYCols.map(y => lttb(transformedData, xCol, y, AREA_SOFT_CAP_PER_SERIES));
            for (const pts of perSeries) {
                for (const pt of pts) {
                    const idx = transformedData.indexOf(pt);
                    if (idx >= 0) selected.add(idx);
                }
            }
            // Re-sort by original index to preserve time ordering.
            decimated = Array.from(selected).sort((a, b) => a - b).map(i => transformedData[i]);
        }
    }

    return { chartData: decimated, isTime: isTimeAxis, allY: allYCols, finalXCol: xCol };
  }, [data, config.x, config.y, config.color]);

  const yIsDuration = allY.length > 0 && allY.every(isDurationColumnName) && sampleLooksLikeNanoseconds(chartData, allY);
  const yFormatter = yIsDuration ? formatDurationNs : numberFormatter;
  const colors = getPaletteColors(clauses?.palette, COLORS);

  const xTickFmt = makeTickFormatter(clauses?.axisX) ?? (isTime ? (t: any) => formatTimestamp(t, 'HH:mm:ss.SS') : undefined);
  const yTickFmt = makeTickFormatter(clauses?.axisY);

  return (
    <div style={{ width: '100%', minHeight: 200 }}>
      <ResponsiveContainer width="100%" minHeight={200}>
        <AreaChart
          data={chartData}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
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
            tickFormatter={xTickFmt}
            scale={mapAxisScale(clauses?.axisX)}
            stroke="#9ca3af"
            tick={{ fontSize: 12 }}
            label={xLabelFromClause ? { value: xLabelFromClause, position: 'insideBottom', fill: '#9ca3af', fontSize: 12, offset: -5 } : undefined}
          />
          <YAxis
            stroke="#9ca3af"
            tick={{ fontSize: 12 }}
            tickFormatter={yTickFmt ?? yFormatter}
            label={
              (yLabelFromClause || config.yAxisLabel)
                ? { value: yLabelFromClause || config.yAxisLabel, angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 12 }
                : undefined
            }
            scale={mapAxisScale(clauses?.axisY) ?? (effectiveYScale === 'log' ? 'log' : 'auto')}
            domain={domainY ?? (effectiveYScale === 'log' ? (yDomainFromClause ? [Math.max(0.1, Number(yDomainFromClause[0]) || 0.1), yDomainFromClause[1]] : [0.1, 'dataMax']) : yDomainFromClause)}
            allowDataOverflow
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }}
            formatter={(v, n) => [yFormatter(v), String(n).replace(/_/g, ' ')]}
            labelFormatter={isTime ? (l) => formatTimestamp(l, settings.timeFormat) : undefined}
          />
          {showLegend && <Legend wrapperStyle={{ fontSize: '12px' }} formatter={v => String(v).replace(/_/g, ' ')} verticalAlign={legendPos === 'top' ? 'top' : 'bottom'} align={legendPos === 'left' ? 'left' : legendPos === 'right' ? 'right' : 'center'} />}
          {allY.map((y, i) => {
            const isStacked = config.layout === 'stacked' || config.stack === true;
            if (config.stack !== undefined) warnDeprecated('AREA_CHART', 'stack', 'layout');
            return (
            <Area
              key={y}
              type="monotone"
              dataKey={y}
              stackId={isStacked ? 'stack' : undefined}
              stroke={colors[i % colors.length]}
              fill={colors[i % colors.length]}
              fillOpacity={config.opacity}
              connectNulls={config.connectNulls}
              isAnimationActive={isAnimationActive}
              animationDuration={animationDuration}
            />
            );
          })}
          {gestureName && <Brush dataKey={finalXCol} height={20} stroke="#4b5563" fill="#1f2937" onChange={(range) => gestures.onBrushChange(range as any, chartData, finalXCol)}/>}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export const areaChartPlot: PlotRegistration<Config> = {
  name: 'AREA_CHART',
  description: 'Filled area chart — ideal for visualizing cumulative or proportional data over time, such as heap usage breakdown or allocation rates. Supports stacked or overlapping areas.',
  params: withCommonParams(params),
  supportsMultiQuery: true,
  supportsZoom: true,
  template: 'AREA_CHART(x: , y: [])',
  examples: [
    {
      description: 'A simple area chart showing heap used over time.',
      code: 'AREA_CHART(x: "timestamp", y: ["heapUsed"]) TITLE "Heap Usage Over Time"',
      sampleData: [
        { timestamp: '2023-01-01T12:00:00Z', heapUsed: 512 },
        { timestamp: '2023-01-01T12:01:00Z', heapUsed: 768 },
        { timestamp: '2023-01-01T12:02:00Z', heapUsed: 640 },
        { timestamp: '2023-01-01T12:03:00Z', heapUsed: 900 },
      ],
    },
    {
      description: 'A stacked area chart showing the breakdown of memory regions over time.',
      code: 'AREA_CHART(x: "timestamp", y: ["eden", "survivor", "old"], layout: "stacked")',
      sampleData: [
        { timestamp: '2023-01-01T12:00:00Z', eden: 200, survivor: 50, old: 300 },
        { timestamp: '2023-01-01T12:01:00Z', eden: 350, survivor: 80, old: 320 },
        { timestamp: '2023-01-01T12:02:00Z', eden: 100, survivor: 30, old: 340 },
        { timestamp: '2023-01-01T12:03:00Z', eden: 400, survivor: 90, old: 360 },
      ],
    },
  ],
  parseConfig,
  component: AreaChartComponent,
};
