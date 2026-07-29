import React, { useContext, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { formatNumber } from '../../utils/numberFormatter';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn, getPaletteColors } from '../../utils/plotUtils';
import type { ParsedPlotCall } from '../../utils/plotParser';
import { topN } from '../../services/plot/decimation';
import { PlotTooltip } from './PlotTooltip';

const PIE_SOFT_CAP = 12;

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff7300'];

interface PieChartConfig {
    category: string;
    value: string;
    innerRadius?: number;
    outerRadius?: number;
    showPercent?: boolean;
    sliceLabel?: 'inside' | 'outside' | 'none';
}
const params: PlotParameter[] = [
    { name: 'category', type: 'column', required: true, description: 'Column for category names.' },
    { name: 'value', type: 'column', required: true, description: 'Numeric column for slice values.' },
    { name: 'innerRadius', type: 'number', description: 'Inner radius (0–1, fraction of outer). 0 = pie, 0.5 = donut.', defaultValue: 0 },
    { name: 'outerRadius', type: 'number', description: 'Outer radius (0–1, fraction of chart). Defaults to 0.8.', defaultValue: 0.8 },
    { name: 'showPercent', type: 'boolean', description: 'Show percentage on each slice label.', defaultValue: true },
    { name: 'sliceLabel', type: 'string', options: ['inside', 'outside', 'none'], description: 'Slice label position.', defaultValue: 'outside' },
    // Deprecated alias: `name` → `category` (kept for back-compat).
    { name: 'name', type: 'column', aliasFor: 'category', deprecated: true, description: 'Deprecated alias for "category".' },
    // Deprecated aliases from old API: `labels` → `category`, `values` → `value`.
    { name: 'labels', type: 'column', aliasFor: 'category', deprecated: true, description: 'Deprecated alias for "category".' },
    { name: 'values', type: 'column', aliasFor: 'value', deprecated: true, description: 'Deprecated alias for "value".' },
];
const parseConfig = createConfigParser<PieChartConfig>(buildParserSpec(params));

const PieChartComponent: React.FC<{ config: PieChartConfig; data: any[]; isAnimationActive?: boolean; animationDuration?: number; domainX?: [any, any]; clauses?: ParsedPlotCall; }> = ({ config, data, isAnimationActive, animationDuration, clauses }) => {
  const { settings } = useContext(SettingsContext);
  const colors = getPaletteColors(clauses?.palette, COLORS);
  const legendPos = clauses?.legend;
  const showLegend = legendPos !== 'none';
  
  const { nameCol, valueCol } = useMemo(() => {
    if (!data || data.length === 0) {
        return { nameCol: config.category, valueCol: config.value };
    }
    const allColumns = Object.keys(data[0]);
    return {
        nameCol: findColumn(config.category, allColumns),
        valueCol: findColumn(config.value, allColumns),
    };
  }, [data, config.category, config.value]);

  const chartData = useMemo(() => {
    const raw = data.map(row => ({ name: row[nameCol], value: parseFloat(row[valueCol]) })).filter(item => !isNaN(item.value) && item.value > 0);
    return raw.length > PIE_SOFT_CAP
      ? topN(raw, PIE_SOFT_CAP - 1, 'value', { labelCol: 'name', otherKey: 'Other' })
      : raw;
  }, [data, nameCol, valueCol]);

  if (chartData.length === 0) return <div className="p-4 text-center text-gray-500 text-sm">No valid data.</div>;

  // Resolve radius/label config with defaults.
  const outerR = Math.max(0.1, Math.min(1, config.outerRadius ?? 0.8));
  const innerR = Math.max(0, Math.min(outerR - 0.05, config.innerRadius ?? 0));
  const sliceLabel = config.sliceLabel ?? 'outside';
  const showPercent = config.showPercent ?? true;

  const labelRenderer = sliceLabel === 'none'
    ? false as const
    : ({ name, percent }: any) => showPercent
        ? `${name}: ${(Number(percent || 0) * 100).toFixed(0)}%`
        : String(name);

  return (
    <div style={{ width: '100%', minHeight: 200 }}>
      <ResponsiveContainer width="100%" minHeight={200}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            labelLine={sliceLabel === 'outside'}
            innerRadius={`${Math.round(innerR * 100)}%`}
            outerRadius={`${Math.round(outerR * 100)}%`}
            fill="#8884d8"
            dataKey="value"
            nameKey="name"
            label={labelRenderer as any}
            isAnimationActive={isAnimationActive}
            animationDuration={animationDuration}
          >
            {chartData.map((_, index) => <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />)}
          </Pie>
          <Tooltip
            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }}
            itemStyle={{ color: '#e5e7eb' }}
            formatter={(value: number) => formatNumber(value, settings.decimalPlaces)}
            content={
              (clauses?.onHoverTooltip || (clauses?.tooltipColumns && clauses.tooltipColumns.length > 0))
                ? (props: any) => <PlotTooltip {...props} onHoverTooltip={clauses?.onHoverTooltip} tooltipColumns={clauses?.tooltipColumns} />
                : undefined
            }
          />
          {showLegend && <Legend wrapperStyle={{fontSize: "12px"}} verticalAlign={legendPos === 'top' ? 'top' : 'bottom'} align={legendPos === 'left' ? 'left' : legendPos === 'right' ? 'right' : 'center'}/>}
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export const pieChartPlot: PlotRegistration<PieChartConfig> = {
  name: 'PIE_CHART',
  description: 'Shows how a total breaks down into parts — best for 3–7 categories. Use BAR_CHART if you need precise comparisons.',
  params: withCommonParams(params),
  supportsMultiQuery: true,
  template: 'PIE_CHART(category: , value: )',
  examples: [
    {
      description: 'Thread state breakdown — what fraction of time threads spent running, waiting, or blocked.',
      code: 'PIE_CHART(category: "threadState", value: "totalDuration") TITLE "Thread State Proportions"',
      sampleData: [
        { threadState: 'RUNNABLE', totalDuration: 1500 },
        { threadState: 'WAITING', totalDuration: 800 },
        { threadState: 'TIMED_WAITING', totalDuration: 420 },
        { threadState: 'BLOCKED', totalDuration: 300 },
      ]
    },
    {
      description: 'GC cause breakdown — donut form, outer labels.',
      code: 'PIE_CHART(category: "gcCause", value: "count", innerRadius: 0.5, sliceLabel: "outside") TITLE "GC Causes"',
      sampleData: [
        { gcCause: 'Allocation Failure', count: 142 },
        { gcCause: 'Metadata GC Threshold', count: 23 },
        { gcCause: 'System.gc()', count: 8 },
        { gcCause: 'Ergonomics', count: 5 },
      ]
    },
    {
      description: 'Memory pool usage split — how heap is divided between young and old generation.',
      code: 'PIE_CHART(category: "pool", value: "usedBytes") TITLE "Heap Usage by Pool"',
      sampleData: [
        { pool: 'Eden Space', usedBytes: 512000 },
        { pool: 'Survivor Space', usedBytes: 64000 },
        { pool: 'Old Gen', usedBytes: 920000 },
      ]
    },
  ],
  parseConfig,
  component: PieChartComponent,
};