import React, { useContext, useMemo } from 'react';
import { BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { formatNumber } from '../../utils/numberFormatter';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn, findColumns, getPaletteColors } from '../../utils/plotUtils';
import type { ParsedPlotCall } from '../../utils/plotParser';
import { makeTickFormatter, mapAxisScale } from '../../utils/axisFormat';
import { PlotTooltip } from './PlotTooltip';

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

interface BarChartConfig {
  x: string;
  y: string[];
  lineY?: string[];
  color?: string;
  layout: 'stacked' | 'grouped';
  yAxisLabel?: string;
  logScale: boolean;
  horizontal: boolean;
}

const params: PlotParameter[] = [
  { name: 'x', type: 'column', required: true, description: 'Column for the category axis.' },
  { name: 'y', type: 'column[]', required: true, description: 'One or more numeric columns for the bar values.' },
  { name: 'lineY', type: 'column[]', description: 'Optional. One or more numeric columns to render as lines over the bars.' },
  { name: 'color', type: 'column', description: 'Optional column whose distinct values group bars by color (one series per value).' },
  { name: 'layout', type: 'string', options: ['stacked', 'grouped'], defaultValue: 'grouped', description: 'Layout for multiple `y` series: "stacked" or "grouped" (side-by-side).' },
  { name: 'yAxisLabel', type: 'string', description: 'Label for the numeric value axis.' },
  { name: 'logScale', type: 'boolean', defaultValue: false, description: 'Use a logarithmic scale for the value axis.' },
  { name: 'horizontal', type: 'boolean', defaultValue: false, description: 'If true, creates a horizontal bar chart.' },
];

const parseConfig = createConfigParser<BarChartConfig>(buildParserSpec(params));

const CustomTooltip: React.FC<any> = ({ active, payload, label, formatter }) => {
    if (active && payload && payload.length) {
        return React.createElement(
            'div',
            { className: "p-2 bg-gray-700/80 border border-gray-600 rounded-md shadow-lg backdrop-blur-sm text-sm" },
            React.createElement('p', { className: "font-semibold text-gray-200" }, label),
            React.createElement('ul', { className: "mt-1" },
                ...payload.map((pld: any, index: number) => (
                    React.createElement('li', { key: index, style: { color: pld.color || pld.stroke } },
                        `${pld.name}: ${formatter(pld.value)}`
                    )
                ))
            )
        );
    }
    return null;
};

const BarChartComponent: React.FC<{ config: BarChartConfig; data: any[]; isAnimationActive?: boolean; animationDuration?: number; domainX?: [any, any]; domainY?: [number, number]; clauses?: ParsedPlotCall; }> = ({ config, data, isAnimationActive, animationDuration, domainX, domainY, clauses }) => {
    const { settings } = useContext(SettingsContext);
    const numberFormatter = (val: any) => formatNumber(val, settings.decimalPlaces);
    const colors = getPaletteColors(clauses?.palette, COLORS);
    const legendPos = clauses?.legend;
    const showLegend = legendPos !== 'none';
    const axisYClause = clauses?.axisY;
    const axisXClause = clauses?.axisX;
    const effectiveLogScale = axisYClause?.type === 'log' ? true : config.logScale;
    const yDomainFromClause = axisYClause?.domain as [any, any] | undefined;
    const yLabelFromClause = axisYClause?.label;
    const xLabelFromClause = clauses?.axisX?.label;

    const { xCol, yCols, lineYCols, chartData } = useMemo(() => {
        if (!data || data.length === 0) {
            return { xCol: config.x, yCols: config.y || [], lineYCols: config.lineY || [], chartData: data };
        }
        const allColumns = Object.keys(data[0]);

        // When color is set, pivot by color column: each distinct value becomes a
        // bar series, overriding the explicit y columns with grouped series keys.
        if (config.color && allColumns.includes(config.color)) {
            const xC = findColumn(config.x, allColumns);
            const colorC = config.color;
            const yBase = config.y ? Array.from(new Set(config.y.flatMap(col => findColumns(col, allColumns)))) : allColumns.filter(c => c !== xC && c !== colorC).slice(0, 1);
            const colorValues = Array.from(new Set(data.map(r => String(r[colorC] ?? ''))));
            const seriesKeys = colorValues.flatMap(cv =>
                yBase.map(yc => yBase.length === 1 ? cv : `${cv} ${yc}`)
            );
            const xMap = new Map<any, Record<string, any>>();
            for (const row of data) {
                const xv = row[xC];
                if (!xMap.has(xv)) xMap.set(xv, { [xC]: xv });
                const entry = xMap.get(xv)!;
                const cv = String(row[colorC] ?? '');
                for (const yc of yBase) {
                    const sk = yBase.length === 1 ? cv : `${cv} ${yc}`;
                    entry[sk] = row[yc];
                }
            }
            let pivotData = Array.from(xMap.values());
            if (clauses?.limit !== undefined) pivotData = pivotData.slice(0, clauses.limit);
            return {
                xCol: xC,
                yCols: seriesKeys,
                lineYCols: [] as string[],
                chartData: pivotData,
            };
        }

        const resolvedYCols = config.y ? Array.from(new Set(config.y.flatMap(col => findColumns(col, allColumns)))) : [];
        const resolvedXCol = findColumn(config.x, allColumns);
        const resolvedLineYCols = config.lineY ? Array.from(new Set(config.lineY.flatMap(col => findColumns(col, allColumns)))) : [];

        let sortedData = data;
        if (clauses?.barSort && resolvedYCols.length > 0) {
            const firstY = resolvedYCols[0];
            sortedData = [...data].sort((a, b) => {
                const av = Number(a[firstY] ?? 0);
                const bv = Number(b[firstY] ?? 0);
                return clauses.barSort === 'desc' ? bv - av : av - bv;
            });
        }
        const finalData = clauses?.limit !== undefined ? sortedData.slice(0, clauses.limit) : sortedData;

        return { xCol: resolvedXCol, yCols: resolvedYCols, lineYCols: resolvedLineYCols, chartData: finalData };
    }, [data, config]);

    if (!data || data.length === 0) {
        return React.createElement('div', { className: "p-4 text-center text-gray-500 text-sm" }, 'No data.');
    }

    if (yCols.length === 0) {
        const tried = (config.y || []).join(', ');
        return React.createElement('div', { className: "p-4 text-center text-yellow-500/80 text-sm font-mono" },
            `No matching y-axis columns found for: ${tried}. Available: ${Object.keys(data[0]).join(', ')}`
        );
    }

    const commonValueAxisProps = {
        type: "number" as const,
        stroke: "#9ca3af",
        tick: { fontSize: 12 },
        tickFormatter: makeTickFormatter(axisYClause) ?? numberFormatter,
        scale: mapAxisScale(axisYClause) ?? (effectiveLogScale ? "log" as const : "auto" as const),
        domain: (
          effectiveLogScale
            ? [Math.max(0.1, (config.horizontal ? domainX?.[0] : domainY?.[0]) ?? (yDomainFromClause ? (Number(yDomainFromClause[0]) > 0 ? Number(yDomainFromClause[0]) : 0.1) : 0.1)),
               (config.horizontal ? domainX?.[1] : domainY?.[1]) ?? yDomainFromClause?.[1] ?? 'dataMax']
            : ((config.horizontal ? domainX : domainY) ?? yDomainFromClause ?? ['dataMin', 'dataMax'])
        ) as any,
        allowDataOverflow: true,
    };
    
    const axisElements = config.horizontal ? [
        React.createElement(YAxis, {
            key: 'y-axis',
            dataKey: xCol,
            type: "category",
            stroke: "#9ca3af",
            tick: { fontSize: 12 },
            angle: 0,
            textAnchor: "end",
            interval: 0,
            width: 80,
            label: xLabelFromClause ? { value: xLabelFromClause, angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 12 } : undefined
        }),
        React.createElement(XAxis, {
            key: 'x-axis',
            xAxisId: 'bottom',
            ...commonValueAxisProps,
            label: (yLabelFromClause || config.yAxisLabel) ? { value: yLabelFromClause || config.yAxisLabel, angle: 0, position: 'top', fill: '#9ca3af', dy: -10 } : undefined
        }),
        ...(lineYCols.length > 0 ? [React.createElement(XAxis, {
            key: 'x-axis-top',
            xAxisId: 'top',
            orientation: 'top' as const,
            type: "number" as const,
            stroke: "#9ca3af",
            tick: { fontSize: 12 },
            tickFormatter: numberFormatter,
        })] : []),
    ] : [
        React.createElement(XAxis, {
            key: 'x-axis',
            dataKey: xCol,
            stroke: "#9ca3af",
            tick: { fontSize: 12 },
            angle: -45,
            textAnchor: "end",
            interval: 0,
            height: 60,
            tickFormatter: makeTickFormatter(axisXClause) ?? undefined,
            scale: mapAxisScale(axisXClause),
            label: xLabelFromClause ? { value: xLabelFromClause, position: 'insideBottom', fill: '#9ca3af', fontSize: 12, offset: -5 } : undefined
        }),
        React.createElement(YAxis, {
            key: 'y-axis',
            yAxisId: 'left',
            ...commonValueAxisProps,
            label: (yLabelFromClause || config.yAxisLabel) ? { value: yLabelFromClause || config.yAxisLabel, angle: -90, position: 'insideLeft', fill: '#9ca3af' } : undefined
        }),
        // B-129: secondary right-side Y axis for lineY series so different scales don't collapse.
        ...(lineYCols.length > 0 ? [React.createElement(YAxis, {
            key: 'y-axis-right',
            yAxisId: 'right',
            orientation: 'right',
            type: "number" as const,
            stroke: "#9ca3af",
            tick: { fontSize: 12 },
            tickFormatter: numberFormatter,
        })] : []),
    ];

    const barElements = yCols.map((y, i) => React.createElement(Bar, {
        key: `bar-${y}`,
        dataKey: y,
        yAxisId: config.horizontal ? undefined : 'left',
        xAxisId: config.horizontal ? 'bottom' : undefined,
        stackId: config.layout === 'stacked' ? 'a' : undefined,
        fill: colors[i % colors.length],
        isAnimationActive,
        animationDuration
    }));

    const lineElements = lineYCols.map((y, i) => React.createElement(Line, {
        key: `line-${y}`,
        type: "monotone",
        dataKey: y,
        yAxisId: config.horizontal ? undefined : 'right',
        xAxisId: config.horizontal ? 'top' : undefined,
        stroke: colors[(yCols.length + i) % colors.length],
        strokeWidth: 2,
        isAnimationActive,
        animationDuration
    }));

    const chartChildren = [
        React.createElement(CartesianGrid, { key: 'grid', strokeDasharray: "3 3", stroke: "#4a5568" }),
        ...axisElements,
        React.createElement(Tooltip, { key: 'tooltip', content: (clauses?.onHoverTooltip || (clauses?.tooltipColumns && clauses.tooltipColumns.length > 0)) ? (props: any) => React.createElement(PlotTooltip, { ...props, onHoverTooltip: clauses?.onHoverTooltip, tooltipColumns: clauses?.tooltipColumns }) : (props: any) => React.createElement(CustomTooltip, { ...props, formatter: numberFormatter }) }),
        ...(showLegend ? [React.createElement(Legend as any, { key: 'legend', wrapperStyle: { fontSize: "12px" }, formatter: (v: string) => String(v).replace(/_/g, ' '), verticalAlign: legendPos === 'top' ? 'top' : 'bottom', align: legendPos === 'left' ? 'left' : legendPos === 'right' ? 'right' : 'center' })] : []),
        ...barElements,
        ...lineElements
    ];

    return React.createElement('div', { style: { width: '100%', minHeight: 200 } },
        React.createElement(ResponsiveContainer, { width: '100%', minHeight: 200 } as any,
            React.createElement(BarChart, {
                data: chartData,
                layout: config.horizontal ? 'vertical' : 'horizontal',
                margin: { top: 5, right: 20, left: 20, bottom: config.horizontal ? 5 : 50 },
                barGap: config.layout === 'grouped' ? 4 : undefined
            },
            ...chartChildren
            )
        )
    );
};

export const barChartPlot: PlotRegistration<BarChartConfig> = {
  name: 'BAR_CHART',
  description: 'Bars for comparing values across categories — e.g. GC causes, top methods, pause counts per thread. Supports grouped, stacked, horizontal, and mixed bar+line.',
  params: withCommonParams(params),
  supportsMultiQuery: true,
  template: 'BAR_CHART(x: , y: [])',
  examples: [
    {
      description: 'A simple bar chart showing duration by GC cause.',
      code: 'BAR_CHART(x: "gcCause", y: ["duration"]) TITLE "GC Durations by Cause"',
      sampleData: [
        { gcCause: 'Allocation Failure', duration: 150.5 },
        { gcCause: 'System.gc()', duration: 320.1 },
        { gcCause: 'Metadata GC Threshold', duration: 95.2 },
      ]
    },
    {
      description: 'A grouped (side-by-side) bar chart comparing young and old generation GC pause times.',
      code: 'BAR_CHART(x: "timestamp", y: ["youngGCPause", "oldGCPause"])',
      sampleData: [
        { timestamp: "12:00", youngGCPause: 25, oldGCPause: 0 },
        { timestamp: "12:05", youngGCPause: 30, oldGCPause: 150 },
        { timestamp: "12:10", youngGCPause: 22, oldGCPause: 0 },
      ]
    },
    {
      description: 'A stacked bar chart showing the breakdown of CPU usage.',
      code: 'BAR_CHART(x: "timestamp", y: ["jvmUser", "jvmSystem", "machineOther"], layout: "stacked")',
      sampleData: [
        { timestamp: "12:00", jvmUser: 0.6, jvmSystem: 0.1, machineOther: 0.15 },
        { timestamp: "12:05", jvmUser: 0.5, jvmSystem: 0.15, machineOther: 0.2 },
        { timestamp: "12:10", jvmUser: 0.7, jvmSystem: 0.1, machineOther: 0.1 },
      ]
    },
    {
      description: 'A bar chart showing allocation rate with a line overlay for the 99th percentile pause time.',
      code: 'BAR_CHART(x: "timestamp", y: ["allocationRateMB"], lineY: ["p99pauseMs"], yAxisLabel: "MB/sec")',
      sampleData: [
          { timestamp: "12:00", allocationRateMB: 500, p99pauseMs: 45 },
          { timestamp: "12:05", allocationRateMB: 800, p99pauseMs: 60 },
          { timestamp: "12:10", allocationRateMB: 650, p99pauseMs: 55 },
      ]
    },
     {
      description: 'A horizontal bar chart, useful for categories with long names.',
      code: 'BAR_CHART(x: "methodName", y: ["executionTime"], horizontal: true)',
      sampleData: [
        { methodName: 'com.app.long.package.name.MethodA', executionTime: 1200 },
        { methodName: 'com.app.long.package.name.MethodB', executionTime: 850 },
        { methodName: 'com.app.long.package.name.MethodC', executionTime: 1500 },
      ]
    }
  ],
  parseConfig,
  component: BarChartComponent,
};