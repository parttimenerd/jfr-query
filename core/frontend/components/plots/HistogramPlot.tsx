import React, { useMemo, useContext } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, getPaletteColors } from '../../utils/plotUtils';
import type { ParsedPlotCall } from '../../utils/plotParser';
import { makeTickFormatter, mapAxisScale } from '../../utils/axisFormat';
import { PlotTooltip } from './PlotTooltip';
import { SettingsContext } from '../../context/SettingsContext';
import { formatNumber } from '../../utils/numberFormatter';

interface Config { x: string; bins: number | string; logScale: boolean; logBins: boolean; xDomain: any[]; }
const params: PlotParameter[] = [
    { name: 'x', type: 'column', required: true, description: 'Numeric column for the histogram.' },
    { name: 'bins', type: 'string', defaultValue: '10', description: 'Number of bins, or "auto" for Freedman-Diaconis.' },
    { name: 'logScale', type: 'boolean', defaultValue: false, description: 'Use log scale for the Y-axis. Deprecated — use AXIS-Y TYPE LOG suffix clause.' },
    { name: 'logBins', type: 'boolean', defaultValue: false, description: 'Use logarithmically sized bins.' },
    { name: 'xDomain', type: 'number[]', defaultValue: ['auto', 'auto'], description: 'Set a fixed domain for the X-axis.' },
    // Deprecated alias: `value` → `x`.
    { name: 'value', type: 'column', aliasFor: 'x', deprecated: true, description: 'Deprecated alias for "x".' },
];
const parseConfig = createConfigParser<Config>(buildParserSpec(params));

// Freedman-Diaconis bin count: bins ≈ (max-min) / (2 * IQR / n^(1/3)). Capped at 100.
function freedmanDiaconisBins(values: number[]): number {
    if (values.length < 2) return 1;
    const sorted = [...values].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.floor((sorted.length - 1) * p)];
    const iqr = q(0.75) - q(0.25);
    if (iqr <= 0) return Math.min(50, Math.ceil(Math.sqrt(values.length)));
    const binWidth = 2 * iqr / Math.cbrt(values.length);
    const range = sorted[sorted.length - 1] - sorted[0];
    return Math.max(1, Math.min(100, Math.ceil(range / binWidth)));
}

const HistogramComponent: React.FC<{ config: Config; data: any[]; isAnimationActive?: boolean; animationDuration?: number; domainX?: [any, any]; clauses?: ParsedPlotCall; }> = ({ config, data, isAnimationActive, animationDuration, domainX, clauses }) => {
    const { settings } = useContext(SettingsContext);
    const numberFormatter = (val: any) => formatNumber(val, settings.decimalPlaces);
    const effectiveLogScale = clauses?.axisY?.type === 'log' ? true : config.logScale;
    const yDomainFromClause = clauses?.axisY?.domain as [any, any] | undefined;
    const xLabelFromClause = clauses?.axisX?.label;
    const yLabelFromClause = clauses?.axisY?.label;
    const DEFAULT_HISTOGRAM_COLORS = ['#8884d8'];
    const colors = getPaletteColors(clauses?.palette, DEFAULT_HISTOGRAM_COLORS);

    const chartData = useMemo(() => {
        const values = data.map(r => parseFloat(r[config.x])).filter(v => !isNaN(v));
        if (values.length === 0) return [];
        let min = values[0], max = values[0];
        for (let i = 1; i < values.length; i++) { if (values[i] < min) min = values[i]; if (values[i] > max) max = values[i]; }
        if (min === max) return [{ range: numberFormatter(min), count: values.length }];

        // Resolve bin count. Accepts number, numeric string, or 'auto' (Freedman-Diaconis).
        const rawBins = config.bins as any;
        const binCount = typeof rawBins === 'string' && rawBins.toLowerCase() === 'auto'
            ? freedmanDiaconisBins(values)
            : Number(rawBins) || 10;

        if (config.logBins) {
            const posValues = values.filter(v => v>0);
            if(posValues.length===0) return [];
            min=posValues[0]; max=posValues[0];
            for (let i = 1; i < posValues.length; i++) { if (posValues[i] < min) min = posValues[i]; if (posValues[i] > max) max = posValues[i]; }
            if (min === max) return [{ range: numberFormatter(min), count: posValues.length }];
            const logMin=Math.log(min), logMax=Math.log(max);
            const size=(logMax-logMin)/binCount;
            const hist=Array(binCount).fill(0).map((_,i)=>({range:`${numberFormatter(Math.exp(logMin+i*size))}-${numberFormatter(Math.exp(logMin+(i+1)*size))}`, count:0}));
            for(const v of posValues){ const i=Math.max(0, Math.min(binCount-1, Math.floor((Math.log(v)-logMin)/size))); if(hist[i]) hist[i].count++;}
            return hist;
        } else {
            if (min === max) return [{ range: numberFormatter(min), count: values.length }];
            const size=(max-min)/binCount;
            const hist=Array(binCount).fill(0).map((_,i)=>({range:`${numberFormatter(min+i*size)}-${numberFormatter(min+(i+1)*size)}`, count:0}));
            for(const v of values){ const i=Math.max(0, Math.min(binCount-1, Math.floor((v-min)/size))); if(hist[i]) hist[i].count++; }
            return hist;
        }
    }, [data, config.x, config.bins, config.logBins, settings.decimalPlaces]);
    
    if (chartData.length === 0) return <div className="p-4 text-center text-gray-500 text-sm">No valid data.</div>;

    return (
        <div style={{ width: '100%', minHeight: 200 }}>
            <ResponsiveContainer width="100%" minHeight={200}>
                <BarChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 50 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#4a5568"/>
                    <XAxis dataKey="range" stroke="#9ca3af" tick={{fontSize:12}} angle={-45} textAnchor="end" interval="preserveStartEnd" domain={domainX ?? config.xDomain ?? ['auto', 'auto']} tickFormatter={makeTickFormatter(clauses?.axisX) ?? undefined} scale={mapAxisScale(clauses?.axisX)} label={xLabelFromClause ? { value: xLabelFromClause, position: 'insideBottom', fill: '#9ca3af', fontSize: 12, offset: -5 } : undefined}/>
                    <YAxis stroke="#9ca3af" tick={{fontSize:12}} tickFormatter={makeTickFormatter(clauses?.axisY) ?? numberFormatter} label={{value: yLabelFromClause || 'Frequency', angle:-90, position:'insideLeft', fill:'#9ca3af'}} scale={mapAxisScale(clauses?.axisY) ?? (effectiveLogScale?"log":"auto")} domain={effectiveLogScale && yDomainFromClause ? [Math.max(0.1, Number(yDomainFromClause[0]) || 0.1), yDomainFromClause[1]] : (yDomainFromClause ?? (effectiveLogScale?[0.1,'dataMax']:[0,'dataMax']))} allowDataOverflow/>
                    <Tooltip contentStyle={{backgroundColor:'#1f2937',border:'1px solid #4b5563'}} content={(clauses?.onHoverTooltip || (clauses?.tooltipColumns && clauses.tooltipColumns.length > 0)) ? (props: any) => (<PlotTooltip {...props} onHoverTooltip={clauses?.onHoverTooltip} tooltipColumns={clauses?.tooltipColumns} />) : undefined}/>
                    <Bar dataKey="count" fill={colors[0]} isAnimationActive={isAnimationActive} animationDuration={animationDuration}/>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};
export const histogramPlot: PlotRegistration<Config> = { name:'HISTOGRAM', description:'Frequency distribution of a single numeric column — shows how values cluster. Use logBins: true for data spanning many orders of magnitude (e.g., pause durations from µs to seconds).', params: withCommonParams(params), template:'HISTOGRAM(x: , bins: 10)', examples:[{description:'Distribution of GC pause durations — reveals if most pauses are short with occasional long ones.',code:'HISTOGRAM(x: "duration") TITLE "GC Pause Distribution"',sampleData:[{duration:5},{duration:8},{duration:12},{duration:6},{duration:150},{duration:7},{duration:9},{duration:200},{duration:11},{duration:6},{duration:8},{duration:14}]},{description:'Log-scale bins for data spanning multiple orders of magnitude — e.g. object allocation sizes from bytes to megabytes.',code:'HISTOGRAM(x: "allocationSize", bins: 20, logBins: true) TITLE "Allocation Size Distribution"',sampleData:[{allocationSize:64},{allocationSize:128},{allocationSize:1024},{allocationSize:4096},{allocationSize:65536},{allocationSize:1048576},{allocationSize:256},{allocationSize:512},{allocationSize:2048}]}], parseConfig, component:HistogramComponent };