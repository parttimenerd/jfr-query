import React, { useContext } from 'react';
import { ComposedChart, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList, Line } from 'recharts';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { formatNumber } from '../../utils/numberFormatter';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn, isDurationColumnName, formatDurationNs, sampleLooksLikeNanoseconds, getPaletteColors, getTimeValue } from '../../utils/plotUtils';
import type { ParsedPlotCall } from '../../utils/plotParser';
import { makeTickFormatter, mapAxisScale } from '../../utils/axisFormat';
import { formatTimestamp } from '../../utils/timeFormatter';
import { regressionLinear } from 'd3-regression';
import { PlotTooltip } from './PlotTooltip';

interface ScatterPlotConfig {
  x: string;
  y: string;
  size?: string;
  color?: string;
  category?: string;
  label?: string;
  trendline?: boolean;
}

const params: PlotParameter[] = [
    { name: 'x', type: 'column', required: true, description: 'Numeric column for the X-axis.' },
    { name: 'y', type: 'column', required: true, description: 'Numeric column for the Y-axis.' },
    { name: 'size', type: 'column', description: 'Numeric column to determine the size of the points.' },
    { name: 'color', type: 'column', description: 'Column whose distinct values determine point color (one series per value).' },
    { name: 'category', type: 'column', aliasFor: 'color', deprecated: true, description: 'Deprecated alias for "color".' },
    { name: 'label', type: 'column', description: 'Optional column whose values are shown as text labels next to each point.' },
    { name: 'trendline', type: 'boolean', defaultValue: false, description: 'If true, adds a linear regression trendline over the scatter points.' },
];

const parseConfig = createConfigParser<ScatterPlotConfig>(buildParserSpec(params));

const ScatterPlotComponent: React.FC<{ config: ScatterPlotConfig; data: any[], domainX?: [any, any], domainY?: [number, number], isAnimationActive?: boolean, animationDuration?: number, clauses?: ParsedPlotCall }> = ({ config, data, domainX, domainY, isAnimationActive, animationDuration, clauses }) => {
  const { settings } = useContext(SettingsContext);
  const numberFormatter = (val: any) => formatNumber(val, settings.decimalPlaces);
  const yIsDuration = isDurationColumnName(config.y ?? '') && sampleLooksLikeNanoseconds(data, [config.y]);
  const yFormatter = yIsDuration ? formatDurationNs : numberFormatter;
  const SCATTER_COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088FE', '#00C49F', '#FFBB28', '#FF8042'];
  const colors = getPaletteColors(clauses?.palette, SCATTER_COLORS);
  const legendPos = clauses?.legend;
  const showLegend = legendPos !== 'none';
  const yDomainFromClause = clauses?.axisY?.domain as [any, any] | undefined;
  const xDomainFromClause = clauses?.axisX?.domain as [any, any] | undefined;
  const xLabelFromClause = clauses?.axisX?.label;
  const yLabelFromClause = clauses?.axisY?.label;

  // Detect whether the X column contains timestamp values.
  const allCols = data.length > 0 ? Object.keys(data[0]) : [];
  let resolvedXCol: string;
  try { resolvedXCol = findColumn(config.x, allCols); } catch { resolvedXCol = config.x; }
  const firstXVal = data.find(d => d[resolvedXCol] != null)?.[resolvedXCol];
  const isTimeX = !isNaN(getTimeValue(firstXVal));

  const transformedData = React.useMemo(() =>
    isTimeX
      ? data.map(row => { const r = {...row}; r[resolvedXCol] = getTimeValue(r[resolvedXCol]); return r; })
      : data,
  [data, isTimeX, resolvedXCol]);

  const series = React.useMemo(() => {
    const groupCol = config.color;
    if (!groupCol) {
      return [{ name: config.y, data: transformedData }];
    }
    const groups = transformedData.reduce((acc, row) => {
      const category = row[groupCol];
      if (!acc[category]) acc[category] = [];
      acc[category].push(row);
      return acc;
    }, {} as Record<string, any[]>);
    return Object.keys(groups).map(name => ({ name, data: groups[name] }));
  }, [transformedData, config.color, config.y]);

  const sizeDomain = React.useMemo(() => {
    if (!config.size || transformedData.length === 0) return [10, 100];
    const sizeCols = Object.keys(transformedData[0]);
    let resolvedSizeCol: string;
    try { resolvedSizeCol = findColumn(config.size, sizeCols); } catch { resolvedSizeCol = config.size; }
    const values = transformedData.map(d => d[resolvedSizeCol]).filter(v => typeof v === 'number' && !isNaN(v));
    if(values.length === 0) return [10, 100];
    let min = values[0], max = values[0];
    for (let i = 1; i < values.length; i++) { if (values[i] < min) min = values[i]; if (values[i] > max) max = values[i]; }
    if (min === max) { const half = Math.abs(min) || 1; return [min - half, max + half]; }
    return [min, max];
  }, [transformedData, config.size]);

  const xTickFormatter = makeTickFormatter(clauses?.axisX) ?? (isTimeX ? (l: any) => formatTimestamp(l, settings.timeFormat) : numberFormatter);
  const xDomain = xDomainFromClause || domainX || (isTimeX ? ['dataMin', 'dataMax'] : undefined);
  const xLabelFormatter = isTimeX ? (l: any) => formatTimestamp(l, settings.timeFormat) : undefined;

  const trendlineData = React.useMemo(() => {
    if (!config.trendline || transformedData.length < 2) return null;
    let resolvedX: string;
    let resolvedY: string;
    try { resolvedX = findColumn(config.x, Object.keys(transformedData[0])); } catch { resolvedX = config.x; }
    try { resolvedY = findColumn(config.y, Object.keys(transformedData[0])); } catch { resolvedY = config.y; }
    const pairs = transformedData
      .map(d => [d[resolvedX], d[resolvedY]] as [number, number])
      .filter(([x, y]) => typeof x === 'number' && typeof y === 'number' && isFinite(x) && isFinite(y));
    if (pairs.length < 2) return null;
    const regressor = regressionLinear().x((d: [number, number]) => d[0]).y((d: [number, number]) => d[1]);
    const result = regressor(pairs);
    const xs = pairs.map(p => p[0]);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    return [
      { [resolvedX]: xMin, __trend__: result.predict(xMin) },
      { [resolvedX]: xMax, __trend__: result.predict(xMax) },
    ];
  }, [config.trendline, config.x, config.y, transformedData]);

  if (!data || data.length === 0) return <div className="p-4 text-center text-gray-500 text-sm">No data.</div>;

  return (
    <div style={{ width: '100%', minHeight: 200 }}>
      <ResponsiveContainer width="100%" minHeight={200}>
        <ComposedChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" />
          <XAxis allowDataOverflow type="number" dataKey={config.x} name={config.x} tickFormatter={xTickFormatter} scale={mapAxisScale(clauses?.axisX)} stroke="#9ca3af" tick={{ fontSize: 12 }} domain={xDomain} label={xLabelFromClause ? { value: xLabelFromClause, position: 'insideBottom', fill: '#9ca3af', fontSize: 12, offset: -5 } : undefined} />
          <YAxis type="number" dataKey={config.y} name={config.y} tickFormatter={makeTickFormatter(clauses?.axisY) ?? yFormatter} scale={mapAxisScale(clauses?.axisY)} stroke="#9ca3af" tick={{ fontSize: 12 }} domain={yDomainFromClause || domainY} allowDataOverflow label={yLabelFromClause ? { value: yLabelFromClause, angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 12 } : undefined} />
          {config.size && <ZAxis type="number" dataKey={config.size} name={config.size} range={[10, 200]} domain={sizeDomain} />}
          <Tooltip cursor={{ strokeDasharray: '3 3' }} content={(props: any) => (<PlotTooltip {...props} onHoverTooltip={clauses?.onHoverTooltip} tooltipColumns={clauses?.tooltipColumns?.length ? clauses.tooltipColumns : undefined} labelFormatter={xLabelFormatter} />)}/>
          {showLegend && <Legend wrapperStyle={{ fontSize: "12px" }} verticalAlign={legendPos === 'top' ? 'top' : 'bottom'} align={legendPos === 'left' ? 'left' : legendPos === 'right' ? 'right' : 'center'} />}
          {series.map((s, i) => (
            <Scatter key={s.name} name={s.name} data={s.data} fill={colors[i % colors.length]} isAnimationActive={isAnimationActive} animationDuration={animationDuration}>
              {config.label && <LabelList dataKey={config.label} position="top" style={{ fontSize: 10, fill: '#9ca3af' }} />}
            </Scatter>
          ))}
          {trendlineData && (
            <Line
              data={trendlineData}
              dataKey="__trend__"
              type="linear"
              dot={false}
              activeDot={false}
              stroke="#facc15"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              name="trendline"
              legendType="none"
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export const scatterPlot: PlotRegistration<ScatterPlotConfig> = {
  name: 'SCATTER_PLOT',
  description: 'Plots individual data points by two numeric axes — great for spotting correlations (e.g. pause duration vs. bytes reclaimed). Add a third numeric column as `size` for bubble charts.',
  params: withCommonParams(params),
  supportsZoom: true,
  template: 'SCATTER_PLOT(x: , y: )',
  examples: [
    { 
        description: 'A scatter plot showing the relationship between memory reclaimed and GC pause duration.', 
        code: 'SCATTER_PLOT(x: "reclaimedBytes", y: "pauseDuration") TITLE "Reclaimed Memory vs. Pause Duration"',
        sampleData: [
            { reclaimedBytes: 1024, pauseDuration: 15 },
            { reclaimedBytes: 2048, pauseDuration: 25 },
            { reclaimedBytes: 512, pauseDuration: 10 },
        ]
    },
    { 
        description: 'An interactively zoomable/pannable scatter plot.', 
        code: 'SCATTER_PLOT(x: "reclaimedBytes", y: "pauseDuration") LINK_X($xMin, $xMax)',
        sampleData: [
            { reclaimedBytes: 1024, pauseDuration: 15 },
            { reclaimedBytes: 2048, pauseDuration: 25 },
            { reclaimedBytes: 512, pauseDuration: 10 },
        ]
    },
    {
        description: 'A bubble chart where point size represents young generation size and color represents the GC cause.',
        code: 'SCATTER_PLOT(x: "reclaimedBytes", y: "pauseDuration", size: "youngGenSize", color: "gcCause")',
        sampleData: [
            { reclaimedBytes: 1024, pauseDuration: 15, youngGenSize: 512, gcCause: 'Allocation Failure' },
            { reclaimedBytes: 2048, pauseDuration: 25, youngGenSize: 1024, gcCause: 'Allocation Failure' },
            { reclaimedBytes: 512, pauseDuration: 80, youngGenSize: 512, gcCause: 'System.gc()' },
        ]
    }
  ],
  parseConfig,
  component: ScatterPlotComponent,
};