import React, { useMemo } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec } from '../../utils/plotUtils';

interface HeatmapConfig {
  x: string;
  y: string;
  value: string;
}

const params: PlotParameter[] = [
    { name: 'x', type: 'column', description: 'The column for the X-axis categories.', required: true },
    { name: 'y', type: 'column', description: 'The column for the Y-axis categories.', required: true },
    { name: 'value', type: 'column', description: 'The numeric column that determines the color of each cell.', required: true },
];

const parseConfig = createConfigParser<HeatmapConfig>(buildParserSpec(params));


const HeatmapComponent: React.FC<{ config: HeatmapConfig; data: any[]; isAnimationActive?: boolean; animationDuration?: number; domainX?: [any, any]; }> = ({ config, data, isAnimationActive, animationDuration }) => {
  const { x, y, value: valueCol } = config;

  const { chartData, xLabels, yLabels, min, max } = useMemo(() => {
    const xLabels = [...new Set(data.map(item => item[x]))].sort();
    const yLabels = [...new Set(data.map(item => item[y]))].sort();
    const values = data.map(item => parseFloat(item[valueCol])).filter(v => !isNaN(v));
    const min = Math.min(...values);
    const max = Math.max(...values);
    
    const chartData = data.map(item => ({
      x: xLabels.indexOf(item[x]),
      y: yLabels.indexOf(item[y]),
      z: parseFloat(item[valueCol]),
      ...item
    })).filter(d => !isNaN(d.z) && d.x >= 0 && d.y >= 0);

    return { chartData, xLabels, yLabels, min, max };
  }, [data, x, y, valueCol]);
  
  const colorScale = (value: number) => {
      const ratio = (max - min) === 0 ? 0.5 : (value - min) / (max - min);
      if (isNaN(ratio)) return 'rgba(136, 132, 216, 0.2)';
      const hue = (1 - ratio) * 240; // blue (240) to red (0)
      return `hsl(${hue}, 100%, 50%)`;
  }
  
  if (chartData.length === 0) {
    return <div className="p-4 text-center text-gray-500 text-sm">No valid data to display in heatmap.</div>;
  }

  return (
    <div style={{ width: '100%', height: 200 }}>
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 20, right: 30, bottom: 60, left: 80 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" />
          <XAxis 
            type="number" 
            dataKey="x" 
            name={x} 
            stroke="#9ca3af" 
            tick={{ fontSize: 10 }}
            domain={[-0.5, xLabels.length - 0.5]}
            ticks={xLabels.map((_, i) => i)}
            tickFormatter={(tick) => String(xLabels[tick])}
            interval={0}
            angle={-45}
            textAnchor="end"
            height={60}
          />
          <YAxis 
            type="number" 
            dataKey="y" 
            name={y} 
            stroke="#9ca3af" 
            tick={{ fontSize: 10 }}
            domain={[-0.5, yLabels.length - 0.5]}
            ticks={yLabels.map((_, i) => i)}
            tickFormatter={(tick) => String(yLabels[tick])}
            interval={0}
            width={80}
          />
          <Tooltip 
            cursor={{ strokeDasharray: '3 3' }} 
            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }}
            itemStyle={{ color: '#e5e7eb' }}
            formatter={(value, name, props) => [props.payload[valueCol], valueCol]}
            labelFormatter={(label, payload) => {
                if(payload && payload[0]?.payload) return `${x}: ${payload[0].payload[x]}, ${y}: ${payload[0].payload[y]}`;
                return '';
            }}
            allowEscapeViewBox={{ x: true, y: true }}
            isAnimationActive={isAnimationActive}
            animationDuration={animationDuration}
          />
          <Scatter data={chartData} shape="square" legendType='none' isAnimationActive={isAnimationActive} animationDuration={animationDuration}>
             {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={colorScale(entry.z)} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
};

export const heatmapPlot: PlotRegistration<HeatmapConfig> = {
  name: 'HEATMAP',
  description: 'Two-dimensional color grid — great for showing intensity across two categorical dimensions (e.g., thread × time, class × method).',
  params: withCommonParams(params),
  template: 'HEATMAP(x: , y: , value: )',
  examples: [
    {
      description: 'Lock contention heatmap — which threads are spending the most time waiting on which locks.',
      code: 'HEATMAP(x: "thread", y: "lockClass", value: "contentionMs") TITLE "Lock Contention (ms)"',
      sampleData: [
        { thread: 'worker-1', lockClass: 'HashMap', contentionMs: 120 },
        { thread: 'worker-1', lockClass: 'AppCache', contentionMs: 250 },
        { thread: 'worker-2', lockClass: 'HashMap', contentionMs: 80 },
        { thread: 'worker-2', lockClass: 'AppCache', contentionMs: 300 },
        { thread: 'worker-3', lockClass: 'HashMap', contentionMs: 45 },
        { thread: 'worker-3', lockClass: 'AppCache', contentionMs: 190 },
      ]
    },
    {
      description: 'CPU load by hour and day of week — useful for spotting periodic load patterns in long JFR recordings.',
      code: 'HEATMAP(x: "hour", y: "dayOfWeek", value: "avgCpuLoad") TITLE "CPU Load Heatmap"',
      sampleData: [
        { hour: '08:00', dayOfWeek: 'Mon', avgCpuLoad: 0.45 },
        { hour: '09:00', dayOfWeek: 'Mon', avgCpuLoad: 0.82 },
        { hour: '10:00', dayOfWeek: 'Mon', avgCpuLoad: 0.91 },
        { hour: '08:00', dayOfWeek: 'Tue', avgCpuLoad: 0.38 },
        { hour: '09:00', dayOfWeek: 'Tue', avgCpuLoad: 0.75 },
        { hour: '10:00', dayOfWeek: 'Tue', avgCpuLoad: 0.88 },
      ]
    },
    {
      description: 'Allocation rate per class and GC phase — shows which classes allocate most heavily during each GC phase.',
      code: 'HEATMAP(x: "gcPhase", y: "className", value: "allocatedMB") TITLE "Allocation per GC Phase"',
      sampleData: [
        { gcPhase: 'Minor GC', className: 'byte[]', allocatedMB: 142 },
        { gcPhase: 'Minor GC', className: 'char[]', allocatedMB: 88 },
        { gcPhase: 'Major GC', className: 'byte[]', allocatedMB: 31 },
        { gcPhase: 'Major GC', className: 'char[]', allocatedMB: 22 },
        { gcPhase: 'Concurrent', className: 'byte[]', allocatedMB: 8 },
        { gcPhase: 'Concurrent', className: 'char[]', allocatedMB: 5 },
      ]
    },
  ],
  parseConfig,
  component: HeatmapComponent,
};