import React, { useContext, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { formatNumber } from '../../utils/numberFormatter';
import { formatTimestamp } from '../../utils/timeFormatter';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn, findColumns, getTimeValue, isDurationColumnName, formatDurationNs, sampleLooksLikeNanoseconds, getPaletteColors } from '../../utils/plotUtils';
import { lttb } from '../../services/plot/decimation';

const LINE_SOFT_CAP_PER_SERIES = 5000;

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088FE', '#00C49F', '#FFBB28', '#FF8042'];
interface Config { x: string; y: string[]; y2?: string[]; color?: string; xDomain?: any[]; yAxisLabel?: string; y2AxisLabel?: string; connectNulls: boolean; xRefLines?: any[]; yRefLines?: any[]; yScale: 'linear' | 'log'; y2Scale: 'linear' | 'log'; yDomain: any[]; y2Domain: any[]; lineType: 'line' | 'dots'; }
const params: PlotParameter[] = [ { name: 'x', type: 'column', required: true, description: 'Column for the X-axis.' }, { name: 'y', type: 'column[]', required: true, description: 'Columns for the primary Y-axis.' }, { name: 'y2', type: 'column[]', description: 'Columns for the second Y-axis.' }, { name: 'color', type: 'column', description: 'Optional column whose distinct values group lines by color (one series per value).' }, { name: 'xDomain', type: 'number[]', description: 'Domain for the X-axis (overrides auto-fit). For time axes, pass numeric ms or quoted ISO timestamps.' }, { name: 'yAxisLabel', type: 'string', description: 'Label for the primary Y-axis.' }, { name: 'y2AxisLabel', type: 'string', description: 'Label for the secondary Y-axis.' }, { name: 'yScale', type: 'string', defaultValue: 'linear', options: ['linear', 'log'], description: 'Scale for the primary Y-axis.' }, { name: 'y2Scale', type: 'string', defaultValue: 'linear', options: ['linear', 'log'], description: 'Scale for the secondary Y-axis.' }, { name: 'yDomain', type: 'number[]', defaultValue: ['auto', 'auto'], description: 'Domain for primary Y-axis.' }, { name: 'y2Domain', type: 'number[]', defaultValue: ['auto', 'auto'], description: 'Domain for secondary Y-axis.' }, { name: 'lineType', type: 'string', defaultValue: 'line', options: ['line', 'dots'], description: 'Render as a connected "line" or just "dots".' }, { name: 'connectNulls', type: 'boolean', defaultValue: false, description: 'Connect lines over nulls.' }, { name: 'xRefLines', type: 'referenceLine[]', description: 'Vertical reference lines.' }, { name: 'yRefLines', type: 'referenceLine[]', description: 'Horizontal reference lines.' }, ];

const parseConfig = createConfigParser<Config>(buildParserSpec(params));

const LineChartComponent: React.FC<{ config: Config; data: any[]; domainX?: [any, any]; domainY?: [number, number]; isAnimationActive?: boolean; animationDuration?: number; clauses?: import('../../utils/plotParser').ParsedPlotCall; }> = ({ config, data, domainX, domainY, isAnimationActive, animationDuration, clauses }) => {
  const { settings } = useContext(SettingsContext);
  const numberFormatter = (v: any) => formatNumber(v, settings.decimalPlaces);

  // W4 — cross-cutting clauses override config-level fields where both exist.
  const legendPos = clauses?.legend; // 'right' | 'left' | 'top' | 'bottom' | 'none'
  const showLegend = legendPos !== 'none';
  const axisXClause = clauses?.axisX;
  const axisYClause = clauses?.axisY;
  const xLabel = axisXClause?.label;
  const yLabelFromClause = axisYClause?.label;
  const yDomainFromClause = axisYClause?.domain as [any, any] | undefined;
  const xDomainFromClause = axisXClause?.domain as [any, any] | undefined;
  // AXIS-Y TYPE LOG overrides the config-level yScale param.
  const effectiveYScale = (axisYClause?.type === 'log' ? 'log' : config.yScale) as 'linear' | 'log';

  const { chartData, isTime, allY, allY2, finalXCol } = useMemo<{ chartData: any[]; isTime: boolean; allY: string[]; allY2: string[]; finalXCol: string }>(() => {
    if (!data || !data.length || !data[0] || !config.x) {
        return { chartData: data, isTime: false, allY: [], allY2: [], finalXCol: config.x };
    }

    const allColumns = Object.keys(data[0]);
    const xCol = findColumn(config.x, allColumns);

    const firstXValue = data.find(d => d[xCol] != null)?.[xCol];
    const timeValue = getTimeValue(firstXValue);
    const isTimeAxis = !isNaN(timeValue);

    const allYCols = config.y ? Array.from(new Set(config.y.flatMap(col => findColumns(col, allColumns)))) : [];
    const allY2Cols = config.y2 ? Array.from(new Set(config.y2.flatMap(col => findColumns(col, allColumns)))) : [];

    const transformedData = isTimeAxis
      ? data.map(row => {
          const newRow = {...row};
          const timeCols = findColumns(config.x, Object.keys(newRow));
          for (const col of timeCols) {
              newRow[col] = getTimeValue(newRow[col]);
          }
          return newRow;
      })
      : data;

    // When a color column is specified, pivot the data: group by color value and
    // produce one series key per (colorValue × yCol) pair, stored as columns in
    // a per-x-value row so recharts can render one <Line> per series.
    if (config.color && allColumns.includes(config.color)) {
        const colorCol = config.color;
        const colorValues = Array.from(new Set(transformedData.map(r => String(r[colorCol] ?? ''))));
        const yColsForColor = allYCols.length > 0 ? allYCols : (allColumns.filter(c => c !== xCol && c !== colorCol).slice(0, 1));
        const seriesKeys = colorValues.flatMap(cv =>
            yColsForColor.map(yc => yColsForColor.length === 1 ? cv : `${cv} ${yc}`)
        );
        const xMap = new Map<any, Record<string, any>>();
        for (const row of transformedData) {
            const xv = row[xCol];
            if (!xMap.has(xv)) xMap.set(xv, { [xCol]: xv });
            const entry = xMap.get(xv)!;
            const cv = String(row[colorCol] ?? '');
            for (const yc of yColsForColor) {
                const sk = yColsForColor.length === 1 ? cv : `${cv} ${yc}`;
                entry[sk] = row[yc];
            }
        }
        const pivoted = Array.from(xMap.values()).sort((a, b) => {
            const av = a[xCol], bv = b[xCol];
            return av < bv ? -1 : av > bv ? 1 : 0;
        });
        return { chartData: pivoted, isTime: isTimeAxis, allY: seriesKeys, allY2: [], finalXCol: xCol };
    }

    // W13 — decimate via LTTB when over the soft cap. Picks the first y column
    // as the area-preserving signal; visual extrema across all series stay
    // close to faithful because LTTB on the dominant series sweeps the same
    // x-positions where other series fluctuate.
    const primaryY = allYCols[0] ?? allY2Cols[0];
    const decimated = (isTimeAxis && primaryY && transformedData.length > LINE_SOFT_CAP_PER_SERIES)
      ? lttb(transformedData, xCol, primaryY, LINE_SOFT_CAP_PER_SERIES)
      : transformedData;

    return { chartData: decimated, isTime: isTimeAxis, allY: allYCols, allY2: allY2Cols, finalXCol: xCol };
  }, [data, config.x, config.y, config.y2, config.color]);

  const yIsDuration = allY.length > 0 && allY.every(isDurationColumnName) && sampleLooksLikeNanoseconds(chartData, allY);
  const y2IsDuration = allY2.length > 0 && allY2.every(isDurationColumnName) && sampleLooksLikeNanoseconds(chartData, allY2);
  const yFormatter = yIsDuration ? formatDurationNs : numberFormatter;
  const y2Formatter = y2IsDuration ? formatDurationNs : numberFormatter;
  const colors = getPaletteColors(clauses?.palette, COLORS);

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 200 }}>
      <ResponsiveContainer minHeight={200}>
        <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#4a5568"/>
          <XAxis allowDataOverflow dataKey={finalXCol} type={isTime?'number':'category'} domain={xDomainFromClause || domainX || (isTime?['dataMin','dataMax']:undefined)} tickFormatter={isTime?(t:any)=>formatTimestamp(t,"HH:mm:ss.SS"):undefined} stroke="#9ca3af" tick={{fontSize:12}} label={xLabel?{value:xLabel,position:'insideBottom',fill:'#9ca3af',fontSize:12,offset:-5}:undefined}/>
          <YAxis yAxisId="left" stroke="#9ca3af" tick={{fontSize:12}} tickFormatter={yFormatter} label={(yLabelFromClause || config.yAxisLabel)?{value:yLabelFromClause || config.yAxisLabel,angle:-90,position:'insideLeft',fill:'#9ca3af',fontSize:12}:undefined} scale={effectiveYScale === 'log' ? "log" : "auto"} domain={effectiveYScale === 'log' ? (domainY ?? (yDomainFromClause ? [Math.max(0.1, Number(yDomainFromClause[0]) || 0.1), yDomainFromClause[1]] : [0.1,'dataMax'])) : (domainY ?? yDomainFromClause ?? config.yDomain) as any} allowDataOverflow/>
          {allY2.length>0 && <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" tick={{fontSize:12}} tickFormatter={y2Formatter} label={config.y2AxisLabel?{value:config.y2AxisLabel,angle:90,position:'insideRight',fill:'#82ca9d',fontSize:12}:undefined} scale={config.y2Scale === 'log' ? "log" : "auto"} domain={config.y2Scale === 'log' ? [0.1,'dataMax'] : config.y2Domain as any} allowDataOverflow/>}
          <Tooltip contentStyle={{backgroundColor:'#1f2937',border:'1px solid #4b5563'}} formatter={(v,n)=>[(allY2.includes(String(n)) ? y2Formatter : yFormatter)(v),String(n).replace(/_/g,' ')]} labelFormatter={isTime?(l)=>formatTimestamp(l,settings.timeFormat):undefined}/>
          {showLegend && <Legend wrapperStyle={{fontSize:"12px"}} formatter={v=>String(v).replace(/_/g,' ')} verticalAlign={legendPos === 'top' ? 'top' : legendPos === 'bottom' ? 'bottom' : 'middle'} align={legendPos === 'left' ? 'left' : legendPos === 'right' ? 'right' : 'center'}/>}
          {allY.map((y,i)=><Line yAxisId="left" key={y} type="monotone" dataKey={y} stroke={colors[i%colors.length]} connectNulls={config.connectNulls} strokeWidth={config.lineType === 'line' ? 1 : 0} dot={config.lineType === 'dots'} activeDot={{r: 4}} isAnimationActive={isAnimationActive} animationDuration={animationDuration}/>)}
          {allY2.map((y,i)=><Line yAxisId="right" key={y} type="monotone" dataKey={y} stroke={colors[(allY.length+i)%colors.length]} connectNulls={config.connectNulls} strokeWidth={config.lineType === 'line' ? 1 : 0} dot={config.lineType === 'dots'} activeDot={{r: 4}} isAnimationActive={isAnimationActive} animationDuration={animationDuration}/>)}
          {config.xRefLines?.map((l,i)=><ReferenceLine key={`x-${i}`} x={l.value} label={l.label} stroke="#facc15" strokeDasharray="3 3"/>)}
          {config.yRefLines?.map((l,i)=><ReferenceLine key={`y-${i}`} y={l.value} label={l.label} stroke="#facc15" strokeDasharray="3 3"/>)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export const lineChartPlot: PlotRegistration<Config> = {
    name:'LINE_CHART',
    description:'Lines over time — ideal for CPU, memory, GC activity, or any metric that changes continuously. Supports zoom, pan, dual Y-axis, and reference lines.',
    params: withCommonParams(params),
    supportsMultiQuery:true,
    template:'LINE_CHART(x: , y: [])', 
    examples:[
        {
            description:'A simple time-series chart showing total CPU usage.',
            code:'LINE_CHART(x: "timestamp", y: ["cpuLoad"]) TITLE "CPU Load Over Time"',
            sampleData: [
                { timestamp: "2023-01-01T12:00:00Z", cpuLoad: 0.75 },
                { timestamp: "2023-01-01T12:01:00Z", cpuLoad: 0.82 },
                { timestamp: "2023-01-01T12:02:00Z", cpuLoad: 0.65 },
            ]
        },
        {
            description: 'An interactively zoomable chart linked to global variables `$start` and `$end`. Use scroll wheel to zoom and drag to pan.',
            code: 'LINE_CHART(x: "timestamp", y: ["cpuLoad"]) LINK_X($start, $end)',
            sampleData: [
                { timestamp: "2023-01-01T12:00:00Z", cpuLoad: 0.75 },
                { timestamp: "2023-01-01T12:01:00Z", cpuLoad: 0.82 },
                { timestamp: "2023-01-01T12:02:00Z", cpuLoad: 0.65 },
            ]
        },
        {
            description:'A chart showing data points without a connecting line.',
            code:'LINE_CHART(x: "timestamp", y: ["cpuLoad"], lineType: "dots")',
            sampleData: [
                { timestamp: "2023-01-01T12:00:00Z", cpuLoad: 0.75 },
                { timestamp: "2023-01-01T12:01:00Z", cpuLoad: 0.82 },
                { timestamp: "2023-01-01T12:02:00Z", cpuLoad: 0.65 },
            ]
        },
        {
            description:'A multi-series chart comparing total machine CPU vs. JVM user CPU.',
            code:'LINE_CHART(x: "timestamp", y: ["cpuMachineTotal", "cpuJvmUser"])',
            sampleData: [
                { timestamp: "2023-01-01T12:00:00Z", cpuMachineTotal: 0.8, cpuJvmUser: 0.6 },
                { timestamp: "2023-01-01T12:01:00Z", cpuMachineTotal: 0.85, cpuJvmUser: 0.7 },
                { timestamp: "2023-01-01T12:02:00Z", cpuMachineTotal: 0.7, cpuJvmUser: 0.5 },
            ]
        },
        {
            description:'Chart of allocation rate with a threshold line. `connectNulls` bridges gaps where no allocation events were recorded.', 
            code:'LINE_CHART(x: "timestamp", y: ["allocationRate"], connectNulls: true, yRefLines: [{value: 500, label: "High Allocation"}])',
            sampleData: [
                { timestamp: "2023-01-01T12:00:00Z", allocationRate: 340 },
                { timestamp: "2023-01-01T12:01:00Z", allocationRate: 480 },
                { timestamp: "2023-01-01T12:02:00Z", allocationRate: null },
                { timestamp: "2023-01-01T12:03:00Z", allocationRate: 510 },
            ]
        },
        {
            description:'A chart with a second Y-axis comparing Heap Used (MB) with GC Throughput (%).',
            code:'LINE_CHART(x: "timestamp", y: ["heapUsed"], y2: ["gcThroughput"], yAxisLabel: "Heap Used (MB)", y2AxisLabel: "GC Throughput (%)")',
            sampleData: [
                { timestamp: "2023-01-01T12:00:00Z", heapUsed: 1024, gcThroughput: 99.5 },
                { timestamp: "2023-01-01T12:01:00Z", heapUsed: 1536, gcThroughput: 99.2 },
                { timestamp: "2023-01-01T12:02:00Z", heapUsed: 800, gcThroughput: 97.1 },
                { timestamp: "2023-01-01T12:03:00Z", heapUsed: 1800, gcThroughput: 99.8 },
            ]
        }
    ], 
    parseConfig, 
    component:LineChartComponent 
};