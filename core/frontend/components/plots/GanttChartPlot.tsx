import React, { useContext, useMemo } from 'react';
import { ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { formatNumber } from '../../utils/numberFormatter';
import { formatTimestamp } from '../../utils/timeFormatter';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn, getTimeValue } from '../../utils/plotUtils';
import { usePlotGestures } from '../../hooks/usePlotGestures';

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

interface Config {
  start: string;
  end: string;
  lane: string;
  color?: string;
  task?: string;
}

const params: PlotParameter[] = [
  { name: 'start', type: 'column', required: true, description: 'Column for the start time/value of each bar.' },
  { name: 'end', type: 'column', required: true, description: 'Column for the end time/value of each bar.' },
  { name: 'lane', type: 'column', required: true, description: 'Column for the category/label on the Y-axis (one lane per distinct value).' },
  { name: 'color', type: 'column', description: 'Optional column whose distinct values determine bar color.' },
  { name: 'task', type: 'column', description: 'Optional column whose value is displayed as text inside each bar.' },
  // Deprecated aliases.
  { name: 'row', type: 'column', aliasFor: 'lane', deprecated: true, description: 'Deprecated alias for "lane".' },
  { name: 'label', type: 'column', aliasFor: 'task', deprecated: true, description: 'Deprecated alias for "task".' },
];

const parseConfig = createConfigParser<Config>(buildParserSpec(params));

/** Custom bar shape that renders only the "duration" portion, skipping the transparent offset. */
const GanttBarShape = (props: any) => {
  const { x, y, width, height, fill, fillOpacity, payload } = props;
  if (!payload || payload.__isOffset) {
    // Transparent offset bar — render nothing visible
    return React.createElement('rect', { x, y, width, height, fill: 'transparent' });
  }
  return React.createElement('rect', { x, y, width, height, fill, fillOpacity: fillOpacity ?? 0.85, rx: 2 });
};

const GanttChartComponent: React.FC<{
  config: Config;
  data: any[];
  domainX?: [any, any];
  isAnimationActive?: boolean;
  animationDuration?: number;
  gestureName?: string;
  onVariableChange?: (vars: Record<string, unknown>) => void;
}> = ({ config, data, isAnimationActive, animationDuration, gestureName, onVariableChange }) => {
  const { settings } = useContext(SettingsContext);
  const numberFormatter = (v: any) => formatNumber(v, settings.decimalPlaces);
  const gestures = usePlotGestures({ name: gestureName, onVariableChange });

  const { chartData, isTime, startCol, endCol, rowCol, colorCategories } = useMemo(() => {
    if (!data || !data.length || !data[0]) {
      return { chartData: [], isTime: false, startCol: config.start, endCol: config.end, rowCol: config.lane, colorCategories: [] };
    }

    const allColumns = Object.keys(data[0]);
    const sCol = findColumn(config.start, allColumns);
    const eCol = findColumn(config.end, allColumns);
    const rCol = findColumn(config.lane, allColumns);
    const colorCol = config.color ? findColumn(config.color, allColumns) : null;

    // B-183: if a required column wasn't found, bail out early to avoid silently
    // rendering an empty chart with all-blank lane labels.
    if (!allColumns.includes(sCol) || !allColumns.includes(eCol) || !allColumns.includes(rCol)) {
      return { chartData: [], isTime: false, startCol: sCol, endCol: eCol, rowCol: rCol, colorCategories: [] };
    }

    const firstStart = data.find(d => d[sCol] != null)?.[sCol];
    const timeVal = getTimeValue(firstStart);
    const isTimeAxis = !isNaN(timeVal);

    const toNum = (v: any) => isTimeAxis ? getTimeValue(v) : Number(v);

    // Collect distinct color categories for the legend
    const colorCats: string[] = colorCol
      ? Array.from(new Set(data.map(r => String(r[colorCol] ?? ''))))
      : [];

    const transformed = data.map((row, i) => {
      const startVal = toNum(row[sCol]);
      const endVal = toNum(row[eCol]);
      const duration = isNaN(startVal) || isNaN(endVal) ? 0 : Math.max(0, endVal - startVal);
      const colorCategory = colorCol ? String(row[colorCol] ?? '') : null;
      const colorIndex = colorCategory !== null ? colorCats.indexOf(colorCategory) : i;
      return {
        __rowLabel: String(row[rCol] ?? ''),
        __offset: startVal,
        __duration: duration,
        __startRaw: row[sCol],
        __endRaw: row[eCol],
        __color: COLORS[colorIndex % COLORS.length],
        __label: config.task ? String(row[findColumn(config.task, allColumns)] ?? '') : undefined,
        ...row,
      };
    });

    return { chartData: transformed, isTime: isTimeAxis, startCol: sCol, endCol: eCol, rowCol: rCol, colorCategories: colorCats };
  }, [data, config]);

  const tickFormatter = isTime
    ? (v: any) => formatTimestamp(v, 'HH:mm:ss.SS')
    : (v: any) => numberFormatter(v);

  const tooltipFormatter = (_value: any, _name: string, props: any) => {
    const row = props?.payload;
    if (!row) return [_value, _name];
    if (_name === '__offset') return [null as any, null as any]; // hide offset
    const startFmt = isTime ? formatTimestamp(getTimeValue(row.__startRaw), settings.timeFormat) : numberFormatter(row.__startRaw);
    const endFmt = isTime ? formatTimestamp(getTimeValue(row.__endRaw), settings.timeFormat) : numberFormatter(row.__endRaw);
    return [`${startFmt} → ${endFmt}`, 'Range'];
  };

  const chartHeight = Math.max(320, new Set(chartData.map(r => r.__rowLabel ?? r.lane ?? r.row)).size * 28 + 60);
  return (
    <div style={{ width: '100%' }}>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <ComposedChart
          layout="vertical"
          data={chartData}
          margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
          onMouseMove={gestures.onMouseMove}
          onMouseLeave={gestures.onMouseLeave}
          onClick={gestures.onClick}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" horizontal={false} />
          <XAxis
            type="number"
            stroke="#9ca3af"
            tick={{ fontSize: 11 }}
            tickFormatter={tickFormatter}
            domain={['dataMin', 'dataMax']}
            allowDataOverflow
          />
          <YAxis
            type="category"
            dataKey="__rowLabel"
            stroke="#9ca3af"
            tick={{ fontSize: 11 }}
            width={95}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }}
            formatter={tooltipFormatter}
            labelFormatter={(l) => String(l)}
          />
          {/* Transparent offset bar — pushes the duration bar to the correct start position */}
          <Bar
            dataKey="__offset"
            stackId="gantt"
            fill="transparent"
            isAnimationActive={isAnimationActive}
            animationDuration={animationDuration}
            legendType="none"
          />
          {/* Visible duration bar */}
          <Bar
            dataKey="__duration"
            stackId="gantt"
            isAnimationActive={isAnimationActive}
            animationDuration={animationDuration}
            name="Duration"
            shape={<GanttBarShape />}
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.__color} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export const ganttChartPlot: PlotRegistration<Config> = {
  name: 'GANTT',
  description: 'Horizontal Gantt chart showing time ranges per category — ideal for thread activity timelines, GC pause periods, or any start→end interval data.',
  params: withCommonParams(params),
  supportsMultiQuery: false,
  template: 'GANTT(start: , end: , lane: )',
  examples: [
    {
      description: 'A Gantt chart showing GC pause intervals per GC phase.',
      code: 'GANTT(start: "startTime", end: "endTime", lane: "phase") TITLE "GC Phase Timeline"',
      sampleData: [
        { startTime: '2023-01-01T12:00:00.000Z', endTime: '2023-01-01T12:00:00.050Z', phase: 'Young GC' },
        { startTime: '2023-01-01T12:00:01.000Z', endTime: '2023-01-01T12:00:01.200Z', phase: 'Old GC' },
        { startTime: '2023-01-01T12:00:02.000Z', endTime: '2023-01-01T12:00:02.030Z', phase: 'Young GC' },
      ],
    },
    {
      description: 'A Gantt chart showing thread activity, color-coded by thread state, with the phase as a per-bar label.',
      code: 'GANTT(start: "startTime", end: "endTime", lane: "thread", task: "phase", color: "state")',
      sampleData: [
        { startTime: '2023-01-01T12:00:00.000Z', endTime: '2023-01-01T12:00:00.100Z', thread: 'main', phase: 'parse', state: 'RUNNABLE' },
        { startTime: '2023-01-01T12:00:00.100Z', endTime: '2023-01-01T12:00:00.300Z', thread: 'main', phase: 'lock-wait', state: 'BLOCKED' },
        { startTime: '2023-01-01T12:00:00.050Z', endTime: '2023-01-01T12:00:00.250Z', thread: 'worker-1', phase: 'compute', state: 'RUNNABLE' },
      ],
    },
  ],
  parseConfig,
  component: GanttChartComponent,
};
