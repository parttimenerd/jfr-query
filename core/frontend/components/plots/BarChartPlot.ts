import React, { useContext, useMemo } from 'react';
import { BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { formatNumber } from '../../utils/numberFormatter';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn, findColumns } from '../../utils/plotUtils';

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

const BarChartComponent: React.FC<{ config: BarChartConfig; data: any[]; isAnimationActive?: boolean; animationDuration?: number; domainX?: [any, any]; }> = ({ config, data, isAnimationActive, animationDuration }) => {
    const { settings } = useContext(SettingsContext);
    const numberFormatter = (val: any) => formatNumber(val, settings.decimalPlaces);

    const { xCol, yCols, lineYCols } = useMemo(() => {
        if (!data || data.length === 0) {
            return { xCol: config.x, yCols: config.y || [], lineYCols: config.lineY || [] };
        }
        const allColumns = Object.keys(data[0]);
        return {
            xCol: findColumn(config.x, allColumns),
            yCols: config.y ? Array.from(new Set(config.y.flatMap(col => findColumns(col, allColumns)))) : [],
            lineYCols: config.lineY ? Array.from(new Set(config.lineY.flatMap(col => findColumns(col, allColumns)))) : [],
        };
    }, [data, config]);

    const commonValueAxisProps = {
        type: "number" as const,
        stroke: "#9ca3af",
        tick: { fontSize: 12 },
        tickFormatter: numberFormatter,
        scale: config.logScale ? "log" as const : "auto" as const,
        domain: (config.logScale ? [0.1, 'dataMax'] : [0, 'dataMax']) as any,
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
            width: 80
        }),
        React.createElement(XAxis, {
            key: 'x-axis',
            ...commonValueAxisProps,
            label: config.yAxisLabel ? { value: config.yAxisLabel, angle: 0, position: 'top', fill: '#9ca3af', dy: -10 } : undefined
        })
    ] : [
        React.createElement(XAxis, {
            key: 'x-axis',
            dataKey: xCol,
            stroke: "#9ca3af",
            tick: { fontSize: 12 },
            angle: -45,
            textAnchor: "end",
            interval: 0,
            height: 60
        }),
        React.createElement(YAxis, {
            key: 'y-axis',
            yAxisId: 'left',
            ...commonValueAxisProps,
            label: config.yAxisLabel ? { value: config.yAxisLabel, angle: -90, position: 'insideLeft', fill: '#9ca3af' } : undefined
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
        stackId: config.layout === 'stacked' ? 'a' : undefined,
        fill: COLORS[i % COLORS.length],
        isAnimationActive,
        animationDuration
    }));

    const lineElements = lineYCols.map((y, i) => React.createElement(Line, {
        key: `line-${y}`,
        type: "monotone",
        dataKey: y,
        yAxisId: config.horizontal ? undefined : 'right',
        stroke: COLORS[(yCols.length + i) % COLORS.length],
        strokeWidth: 2,
        isAnimationActive,
        animationDuration
    }));

    const chartChildren = [
        React.createElement(CartesianGrid, { key: 'grid', strokeDasharray: "3 3", stroke: "#4a5568" }),
        ...axisElements,
        React.createElement(Tooltip, { key: 'tooltip', content: React.createElement(CustomTooltip, { formatter: numberFormatter }) }),
        React.createElement(Legend as any, { key: 'legend', wrapperStyle: { fontSize: "12px" }, formatter: (v: string) => String(v).replace(/_/g, ' ') }),
        ...barElements,
        ...lineElements
    ];

    return React.createElement('div', { style: { width: '100%', height: '100%', minHeight: 200 } },
        React.createElement(ResponsiveContainer, null,
            React.createElement(BarChart, {
                data: data,
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