import React, { useMemo, useContext } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { formatNumber } from '../../utils/numberFormatter';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn } from '../../utils/plotUtils';
import type { ParsedPlotCall } from '../../utils/plotParser';
import { makeTickFormatter, mapAxisScale } from '../../utils/axisFormat';
import { PlotTooltip } from './PlotTooltip';

interface BoxPlotConfig {
  category?: string;
  color?: string;
  value: string;
}

const params: PlotParameter[] = [
    { name: 'value', type: 'column', required: true, description: 'The numeric column for which to calculate the box plot statistics.' },
    { name: 'category', type: 'column', description: 'An optional column to group the data and create multiple box plots.' },
    { name: 'color', type: 'column', aliasFor: 'category', deprecated: false, description: 'Alias for "category" — column whose distinct values determine box grouping.' },
    // Showcase canon: single-box mode uses `x: "numericCol"` (no grouping).
    { name: 'x', type: 'column', aliasFor: 'value', deprecated: false, description: 'Showcase-canon alias for "value" — numeric column for single-box mode.' },
];

const parseConfig = createConfigParser<BoxPlotConfig>(buildParserSpec(params));

export const calculateStats = (arr: number[]) => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    // Use linear interpolation for quantiles to avoid zero-height boxes on small arrays.
    const quantile = (p: number): number => {
        const pos = p * (sorted.length - 1);
        const lo = Math.floor(pos);
        const hi = Math.ceil(pos);
        if (lo === hi) return sorted[lo];
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    };
    const q1 = quantile(0.25);
    const median = quantile(0.5);
    const q3 = quantile(0.75);
    const iqr = q3 - q1;
    // The whiskers extend to the furthest data point within 1.5 * IQR from the box.
    let lowerWhisker = q1 - 1.5 * iqr;
    let upperWhisker = q3 + 1.5 * iqr;

    // Find the actual min/max data points within the whisker range
    const actualMin = sorted.find(v => v >= lowerWhisker) ?? sorted[0];
    const actualMax = sorted.slice().reverse().find(v => v <= upperWhisker) ?? sorted[sorted.length - 1];

    return { min: actualMin, q1, median, q3, max: actualMax };
};

const Box = (props: any) => {
    const { x, y, width, height, payload } = props;
    if (!payload.stats) return null;

    const { min, q1, median, q3, max } = payload.stats;

    // If q1 and q3 are the same, all values are equal — render a single median line.
    if (height === 0 || q3 === q1) {
        return (
            <g>
                <line x1={x} y1={y} x2={x + width} y2={y} stroke="#fff" strokeWidth={2} />
            </g>
        );
    }
    
    // Reconstruct the scale function locally, since yAxis prop is not passed to Bar shapes.
    // The y-axis in SVG is inverted (0 is at the top).
    // `y` prop is the top of the box, `height` is the box height.
    // `y` corresponds to the larger value (q3), `y + height` corresponds to the smaller value (q1).
    const pixelsPerUnit = height / (q3 - q1);
    const scale = (v: number) => y - (v - q3) * pixelsPerUnit;

    const yMin = scale(min);
    const yQ1 = scale(q1);
    const yMedian = scale(median);
    const yQ3 = scale(q3);
    const yMax = scale(max);

    return (
        <g>
            {/* Whiskers */}
            <line x1={x + width / 2} y1={yMax} x2={x + width / 2} y2={yQ3} stroke="#8884d8" />
            <line x1={x + width / 2} y1={yQ1} x2={x + width / 2} y2={yMin} stroke="#8884d8" />
            {/* Whisker caps */}
            <line x1={x + width * 0.25} y1={yMax} x2={x + width * 0.75} y2={yMax} stroke="#8884d8" />
            <line x1={x + width * 0.25} y1={yMin} x2={x + width * 0.75} y2={yMin} stroke="#8884d8" />
            {/* Box */}
            <rect x={x} y={yQ3} width={width} height={yQ1 - yQ3} fill="#8884d8" stroke="#fff" />
            {/* Median Line */}
            <line x1={x} y1={yMedian} x2={x + width} y2={yMedian} stroke="#fff" strokeWidth={2} />
        </g>
    );
};

const CustomBoxPlotTooltip: React.FC<any> = ({ active, payload, label, formatter }) => {
    if (active && payload && payload.length && payload[0].payload.stats) {
        const { min, q1, median, q3, max } = payload[0].payload.stats;
        const StatLine: React.FC<{ label: string, value: number }> = ({ label: statLabel, value }) => (
            <div className="flex items-center justify-between gap-2">
                <span className="text-gray-400">{statLabel}</span>
                <span className="text-gray-100 font-mono font-medium text-right">{formatter(value)}</span>
            </div>
        );
        return (
            <div className="bg-gray-900/95 border border-gray-600/70 text-xs rounded-lg shadow-xl px-3 py-2 min-w-[120px] max-w-[280px] backdrop-blur-sm">
                <div className="text-gray-300 font-semibold border-b border-gray-700 pb-1 mb-1.5 truncate">{label}</div>
                <div className="space-y-0.5">
                    <StatLine label="Max" value={max} />
                    <StatLine label="Q3" value={q3} />
                    <StatLine label="Median" value={median} />
                    <StatLine label="Q1" value={q1} />
                    <StatLine label="Min" value={min} />
                </div>
            </div>
        );
    }
    return null;
};


const BoxPlotComponent: React.FC<{ config: BoxPlotConfig; data: any[]; isAnimationActive?: boolean; animationDuration?: number; domainX?: [any, any]; domainY?: [number, number]; clauses?: ParsedPlotCall; }> = ({ config, data, isAnimationActive, animationDuration, domainY, clauses }) => {
    const { settings } = useContext(SettingsContext);
    const numberFormatter = (val: any) => formatNumber(val, settings.decimalPlaces);
    const yDomainFromClause = clauses?.axisY?.domain as [any, any] | undefined;
    const xLabelFromClause = clauses?.axisX?.label;
    const yLabelFromClause = clauses?.axisY?.label;

    const chartData = useMemo(() => {
        if (!data || data.length === 0) return [];
        const allColumns = Object.keys(data[0]);
        const valueCol = findColumn(config.value, allColumns);
        const categoryCol = config.category ? findColumn(config.category, allColumns) : undefined;
        
        const groups: Record<string, number[]> = {};
        if (categoryCol) {
            data.forEach(row => {
                const category = row[categoryCol];
                const value = parseFloat(row[valueCol]);
                if (!isNaN(value)) {
                    if (!groups[category]) groups[category] = [];
                    groups[category].push(value);
                }
            });
        } else {
            groups[config.value] = data.map(row => parseFloat(row[valueCol])).filter(v => !isNaN(v));
        }

        return Object.entries(groups).map(([category, values]) => {
            const stats = calculateStats(values);
            // The dummy prop is needed for recharts to render a bar, which we then replace with our custom shape.
            // The values represent the top and bottom of the box (Q3 and Q1).
            return { category, stats, dummy: stats ? [stats.q1, stats.q3] : [0,0] };
        }).filter(d => d.stats);

    }, [data, config.category, config.value]);
    
     if (chartData.length === 0) return <div className="p-4 text-center text-gray-500 text-sm">No valid data for Box Plot.</div>;

    return (
        <div style={{ width: '100%', minHeight: 200 }}>
            <ResponsiveContainer width="100%" minHeight={200}>
                <BarChart data={chartData} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" />
                    <XAxis dataKey="category" stroke="#9ca3af" tick={{ fontSize: 12 }} tickFormatter={makeTickFormatter(clauses?.axisX) ?? undefined} scale={mapAxisScale(clauses?.axisX)} label={xLabelFromClause ? { value: xLabelFromClause, position: 'insideBottom', fill: '#9ca3af', fontSize: 12, offset: -5 } : undefined} />
                    <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }} tickFormatter={makeTickFormatter(clauses?.axisY) ?? numberFormatter} scale={mapAxisScale(clauses?.axisY) === 'log' ? undefined : mapAxisScale(clauses?.axisY)} domain={(domainY ?? yDomainFromClause) ?? ['dataMin', 'dataMax']} allowDataOverflow label={yLabelFromClause ? { value: yLabelFromClause, angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 12 } : undefined} />
                    <Tooltip
                        content={(clauses?.onHoverTooltip || clauses?.tooltipColumns?.length) ? (props: any) => (<PlotTooltip {...props} onHoverTooltip={clauses?.onHoverTooltip} tooltipColumns={clauses?.tooltipColumns?.length ? clauses.tooltipColumns : undefined} />) : <CustomBoxPlotTooltip formatter={numberFormatter} />}
                        cursor={{ fill: 'rgba(130, 202, 157, 0.1)' }}
                        isAnimationActive={isAnimationActive}
                        animationDuration={animationDuration}
                    />
                    <Bar dataKey="dummy" shape={Box} isAnimationActive={isAnimationActive} animationDuration={animationDuration} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};


export const boxPlot: PlotRegistration<BoxPlotConfig> = {
  name: 'BOX_PLOT',
  description: 'Distribution summary (min, Q1, median, Q3, max) — good for comparing spread across categories like GC pauses per cause or latency per endpoint.',
  params: withCommonParams(params),
  template: 'BOX_PLOT(value: )',
  examples: [
    { 
        description: 'A single box plot showing the distribution of GC pause durations.', 
        code: 'BOX_PLOT(value: "pauseDuration") TITLE "Distribution of GC Pauses"',
        sampleData: [
            { pauseDuration: 10 }, { pauseDuration: 12 }, { pauseDuration: 15 }, { pauseDuration: 18 },
            { pauseDuration: 5 },  { pauseDuration: 6 },  { pauseDuration: 7 },  { pauseDuration: 8 },
            { pauseDuration: 25 }, { pauseDuration: 50 }, { pauseDuration: 15 }, { pauseDuration: 11 },
            { pauseDuration: 9 }, { pauseDuration: 14 }, { pauseDuration: 16 }, { pauseDuration: 1 },
        ]
    },
    { 
        description: 'Multiple box plots to compare pause duration distributions across different GC types.', 
        code: 'BOX_PLOT(value: "pauseDuration", category: "gcType")',
        sampleData: [
            { gcType: 'G1 Young', pauseDuration: 10 },
            { gcType: 'G1 Young', pauseDuration: 12 },
            { gcType: 'G1 Young', pauseDuration: 15 },
            { gcType: 'G1 Young', pauseDuration: 18 },
            { gcType: 'G1 Young', pauseDuration: 25 },
            { gcType: 'G1 Old', pauseDuration: 80 },
            { gcType: 'G1 Old', pauseDuration: 95 },
            { gcType: 'G1 Old', pauseDuration: 110 },
            { gcType: 'G1 Old', pauseDuration: 130 },
            { gcType: 'G1 Old', pauseDuration: 75 },
        ]
    }
  ],
  parseConfig,
  component: BoxPlotComponent,
};