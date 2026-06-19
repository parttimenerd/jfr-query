import React, { useContext, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { PlotRegistration, PlotParameter } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { formatNumber } from '../../utils/numberFormatter';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn } from '../../utils/plotUtils';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff7300'];

interface PieChartConfig { name: string; value: string; }
const params: PlotParameter[] = [ { name: 'name', type: 'column', required: true, description: 'Column for category names.' }, { name: 'value', type: 'column', required: true, description: 'Numeric column for slice values.' } ];
const parseConfig = createConfigParser<PieChartConfig>(buildParserSpec(params));

const PieChartComponent: React.FC<{ config: PieChartConfig; data: any[]; isAnimationActive?: boolean; animationDuration?: number; domainX?: [any, any]; }> = ({ config, data, isAnimationActive, animationDuration }) => {
  const { settings } = useContext(SettingsContext);
  
  const { nameCol, valueCol } = useMemo(() => {
    if (!data || data.length === 0) {
        return { nameCol: config.name, valueCol: config.value };
    }
    const allColumns = Object.keys(data[0]);
    return {
        nameCol: findColumn(config.name, allColumns),
        valueCol: findColumn(config.value, allColumns),
    };
  }, [data, config.name, config.value]);
  
  const chartData = data.map(row => ({ name: row[nameCol], value: parseFloat(row[valueCol]) })).filter(item => !isNaN(item.value));
  
  if (chartData.length === 0) return <div className="p-4 text-center text-gray-500 text-sm">No valid data.</div>;

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 200 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={chartData} cx="50%" cy="50%" labelLine={false} outerRadius={80} fill="#8884d8" dataKey="value" nameKey="name" label={({ name, percent }) => `${name}: ${(Number(percent || 0) * 100).toFixed(0)}%`} isAnimationActive={isAnimationActive} animationDuration={animationDuration}>
            {chartData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }} itemStyle={{ color: '#e5e7eb' }} formatter={(value: number) => formatNumber(value, settings.decimalPlaces)} />
          <Legend wrapperStyle={{fontSize: "12px"}}/>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export const pieChartPlot: PlotRegistration<PieChartConfig> = {
  name: 'PIE_CHART',
  description: 'Shows proportions of a whole.',
  params,
  supportsMultiQuery: true,
  template: 'PIE_CHART(name: , value: )',
  examples: [{ 
      description: 'A pie chart showing the proportion of time spent in different Java thread states.', 
      code: 'PIE_CHART(name: "threadState", value: "totalDuration") TITLE "Thread State Proportions"',
      sampleData: [
          { threadState: 'RUNNABLE', totalDuration: 1500 },
          { threadState: 'WAITING', totalDuration: 800 },
          { threadState: 'BLOCKED', totalDuration: 300 },
      ]
  }],
  parseConfig,
  component: PieChartComponent,
};