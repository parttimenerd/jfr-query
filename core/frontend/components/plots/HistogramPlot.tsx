import React, { useMemo, useContext } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { PlotRegistration, PlotParameter } from './plotTypes';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec } from '../../utils/plotUtils';
import { SettingsContext } from '../../context/SettingsContext';
import { formatNumber } from '../../utils/numberFormatter';

interface Config { value: string; bins: number; logScale: boolean; logBins: boolean; xDomain: any[]; }
const params: PlotParameter[] = [ { name: 'value', type: 'column', required: true, description: 'Numeric column for the histogram.' }, { name: 'bins', type: 'number', defaultValue: 10, description: 'Number of bins.' }, { name: 'logScale', type: 'boolean', defaultValue: false, description: 'Use log scale for the Y-axis.' }, { name: 'logBins', type: 'boolean', defaultValue: false, description: 'Use logarithmically sized bins.' }, { name: 'xDomain', type: 'number[]', defaultValue: ['auto', 'auto'], description: 'Set a fixed domain for the X-axis.' }, ];
const parseConfig = createConfigParser<Config>(buildParserSpec(params));

const HistogramComponent: React.FC<{ config: Config; data: any[]; isAnimationActive?: boolean; animationDuration?: number; domainX?: [any, any]; }> = ({ config, data, isAnimationActive, animationDuration }) => {
    const { settings } = useContext(SettingsContext);
    const numberFormatter = (val: any) => formatNumber(val, settings.decimalPlaces);

    const chartData = useMemo(() => {
        const values = data.map(r => parseFloat(r[config.value])).filter(v => !isNaN(v));
        if (values.length === 0) return [];
        let min=Math.min(...values), max=Math.max(...values);
        if (min === max) return [{ range: numberFormatter(min), count: values.length }];
        
        if (config.logBins) {
            const posValues = values.filter(v => v>0);
            if(posValues.length===0) return [];
            min=Math.min(...posValues); max=Math.max(...posValues);
            const logMin=Math.log(min), logMax=Math.log(max);
            const size=(logMax-logMin)/config.bins;
            const hist=Array(config.bins).fill(0).map((_,i)=>({range:`${numberFormatter(Math.exp(logMin+i*size))}-${numberFormatter(Math.exp(logMin+(i+1)*size))}`, count:0}));
            for(const v of posValues){ const i=Math.min(config.bins-1, Math.floor((Math.log(v)-logMin)/size)); if(hist[i]) hist[i].count++;}
            return hist;
        } else {
            const size=(max-min)/config.bins;
            const hist=Array(config.bins).fill(0).map((_,i)=>({range:`${numberFormatter(min+i*size)}-${numberFormatter(min+(i+1)*size)}`, count:0}));
            for(const v of values){ const i=Math.min(config.bins-1, Math.floor((v-min)/size)); if(hist[i]) hist[i].count++; }
            return hist;
        }
    }, [data, config.value, config.bins, config.logBins, numberFormatter]);
    
    if (chartData.length === 0) return <div className="p-4 text-center text-gray-500 text-sm">No valid data.</div>;

    return (
        <div style={{ width: '100%', height: '100%', minHeight: 200 }}>
            <ResponsiveContainer>
                <BarChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 50 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#4a5568"/>
                    <XAxis dataKey="range" stroke="#9ca3af" tick={{fontSize:12}} angle={-45} textAnchor="end" interval="preserveStartEnd" domain={config.xDomain as any}/>
                    <YAxis stroke="#9ca3af" tick={{fontSize:12}} label={{value:'Frequency',angle:-90,position:'insideLeft',fill:'#9ca3af'}} scale={config.logScale?"log":"auto"} domain={config.logScale?[0.1,'dataMax']:[0,'dataMax']} allowDataOverflow/>
                    <Tooltip contentStyle={{backgroundColor:'#1f2937',border:'1px solid #4b5563'}}/>
                    <Bar dataKey="count" fill="#8884d8" isAnimationActive={isAnimationActive} animationDuration={animationDuration}/>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};
export const histogramPlot: PlotRegistration<Config> = { name:'HISTOGRAM', description:'Visualizes the distribution of a numeric dataset.', params, template:'HISTOGRAM(value: , bins: 10)', examples:[{description:'A histogram showing the distribution of GC pause durations.',code:'HISTOGRAM(value: "duration") TITLE "GC Pause Distribution"'},{description:'A histogram with 20 logarithmically-sized bins, useful for data spanning multiple orders of magnitude.',code:'HISTOGRAM(value: "duration", bins: 20, logBins: true)'}], parseConfig, component:HistogramComponent };