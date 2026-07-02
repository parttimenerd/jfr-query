import React, { useContext } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { formatNumber } from '../../utils/numberFormatter';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, isDurationColumnName, formatDurationNs, sampleLooksLikeNanoseconds, getPaletteColors } from '../../utils/plotUtils';
import type { ParsedPlotCall } from '../../utils/plotParser';

interface ScatterPlotConfig {
  x: string;
  y: string;
  size?: string;
  color?: string;
  category?: string;
}

const params: PlotParameter[] = [
    { name: 'x', type: 'column', required: true, description: 'Numeric column for the X-axis.' },
    { name: 'y', type: 'column', required: true, description: 'Numeric column for the Y-axis.' },
    { name: 'size', type: 'column', description: 'Numeric column to determine the size of the points.' },
    { name: 'color', type: 'column', description: 'Column whose distinct values determine point color (one series per value).' },
    { name: 'category', type: 'column', aliasFor: 'color', deprecated: true, description: 'Deprecated alias for "color".' },
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

  const series = React.useMemo(() => {
    const groupCol = config.color;
    if (!groupCol) {
      return [{ name: config.y, data }];
    }
    const groups = data.reduce((acc, row) => {
      const category = row[groupCol];
      if (!acc[category]) acc[category] = [];
      acc[category].push(row);
      return acc;
    }, {} as Record<string, any[]>);
    return Object.keys(groups).map(name => ({ name, data: groups[name] }));
  }, [data, config.color, config.y]);
  
    const sizeDomain = React.useMemo(() => {
    if (!config.size || data.length === 0) return [10, 100];
    const values = data.map(d => d[config.size]).filter(v => typeof v === 'number');
    if(values.length === 0) return [10, 100];
    let min = values[0], max = values[0];
    for (let i = 1; i < values.length; i++) { if (values[i] < min) min = values[i]; if (values[i] > max) max = values[i]; }
    if (min === max) return [0, max * 2 || 1];
    return [min, max];
  }, [data, config.size]);

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 200 }}>
      <ResponsiveContainer minHeight={200}>
        <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" />
          <XAxis allowDataOverflow type="number" dataKey={config.x} name={config.x} tickFormatter={numberFormatter} stroke="#9ca3af" tick={{ fontSize: 12 }} domain={xDomainFromClause || domainX} label={xLabelFromClause ? { value: xLabelFromClause, position: 'insideBottom', fill: '#9ca3af', fontSize: 12, offset: -5 } : undefined} />
          <YAxis type="number" dataKey={config.y} name={config.y} tickFormatter={yFormatter} stroke="#9ca3af" tick={{ fontSize: 12 }} domain={yDomainFromClause || domainY} allowDataOverflow label={yLabelFromClause ? { value: yLabelFromClause, angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 12 } : undefined} />
          {config.size && <ZAxis type="number" dataKey={config.size} name={config.size} range={[10, 200]} domain={sizeDomain} />}
          <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }} formatter={yFormatter} />
          {showLegend && <Legend wrapperStyle={{ fontSize: "12px" }} verticalAlign={legendPos === 'top' ? 'top' : 'bottom'} align={legendPos === 'left' ? 'left' : legendPos === 'right' ? 'right' : 'center'} />}
          {series.map((s, i) => (
            <Scatter key={s.name} name={s.name} data={s.data} fill={colors[i % colors.length]} isAnimationActive={isAnimationActive} animationDuration={animationDuration} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
};

export const scatterPlot: PlotRegistration<ScatterPlotConfig> = {
  name: 'SCATTER_PLOT',
  description: 'Plots individual data points by two numeric axes — great for spotting correlations (e.g. pause duration vs. bytes reclaimed). Add a third numeric column as `size` for bubble charts.',
  params: withCommonParams(params),
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