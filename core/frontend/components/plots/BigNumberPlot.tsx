import React from 'react';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn } from '../../utils/plotUtils';
import { formatNumber } from '../../utils/numberFormatter';
import { useDisplaySettings } from '../../context/DisplaySettingsContext';
import type { ParsedPlotCall } from '../../utils/plotParser';

interface BigNumberConfig {
    value: string;
    label?: string;
    units?: string;
    previousValue?: string;
    fontSize?: string;
}

const params: PlotParameter[] = [
    { name: 'value', type: 'column', required: true, description: 'Numeric column whose first-row value is displayed as the big number.' },
    { name: 'label', type: 'string', description: 'Optional label text displayed below the number.' },
    { name: 'units', type: 'string', description: 'Optional units suffix displayed after the number (e.g. "ms", "%", "MB").' },
    { name: 'previousValue', type: 'column', description: 'Optional column holding a comparison value. When set, shows a change arrow and percentage delta.' },
    { name: 'fontSize', type: 'string', defaultValue: '4xl', description: 'Tailwind text size for the number: "3xl", "4xl", "5xl", "6xl".' },
];

const parseConfig = createConfigParser<BigNumberConfig>(buildParserSpec(params));

const BigNumberComponent: React.FC<{
    config: BigNumberConfig;
    data: any[];
    clauses?: ParsedPlotCall;
}> = ({ config, data, clauses }) => {
    const { decimalPlaces } = useDisplaySettings();
    const fmt = (v: any) => formatNumber(v, decimalPlaces);

    if (!data || data.length === 0) {
        return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No data.</div>;
    }

    const allCols = Object.keys(data[0]);
    const valueCol = findColumn(config.value, allCols);
    const rawValue = data[0][valueCol];
    if (rawValue == null) {
        return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No data.</div>;
    }

    const numVal = typeof rawValue === 'number' ? rawValue : parseFloat(String(rawValue));
    const displayValue = isNaN(numVal) ? String(rawValue) : fmt(numVal);

    let delta: number | null = null;
    if (config.previousValue) {
        const prevCol = findColumn(config.previousValue, allCols);
        const prevRaw = data[0][prevCol];
        if (prevRaw != null) {
            const prevNum = typeof prevRaw === 'number' ? prevRaw : parseFloat(String(prevRaw));
            if (!isNaN(prevNum) && prevNum !== 0) {
                delta = ((numVal - prevNum) / Math.abs(prevNum)) * 100;
            }
        }
    }

    const fontSizeClass = `text-${config.fontSize ?? '4xl'}`;
    const titleFromClause = clauses?.title ?? undefined;
    const displayLabel = config.label;

    return (
        <div className="flex flex-col items-center justify-center h-full gap-1 py-4">
            {(titleFromClause || displayLabel) && (
                <span className="text-xs text-gray-400 uppercase tracking-widest font-medium text-center">
                    {titleFromClause ?? displayLabel}
                </span>
            )}
            <div className="flex items-baseline gap-1.5">
                <span className={`${fontSizeClass} font-bold text-white tabular-nums leading-none`}>
                    {displayValue}
                </span>
                {config.units && (
                    <span className="text-lg text-gray-400 font-medium">{config.units}</span>
                )}
            </div>
            {displayLabel && titleFromClause !== displayLabel && titleFromClause !== undefined && (
                <span className="text-sm text-gray-400">{displayLabel}</span>
            )}
            {delta !== null && (
                <span className={`text-sm font-medium ${delta >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
                </span>
            )}
        </div>
    );
};

export const bigNumberPlot: PlotRegistration<BigNumberConfig> = {
    name: 'BIG_NUMBER',
    description: 'Displays a single large numeric KPI value — ideal for summary stats like total GC pause time, max heap, or event count.',
    params: withCommonParams(params),
    supportsMultiQuery: false,
    template: 'BIG_NUMBER(value: )',
    examples: [
        {
            description: 'Show the total GC pause time as a large number with a units suffix.',
            code: 'BIG_NUMBER(value: "total_pause_ms", label: "Total GC Pause", units: "ms") TITLE "GC Summary"',
            sampleData: [{ total_pause_ms: 4231.5 }],
        },
        {
            description: 'Show a count with a comparison to a previous value — displays a change arrow.',
            code: 'BIG_NUMBER(value: "gc_count", previousValue: "prev_gc_count", label: "GC Events")',
            sampleData: [{ gc_count: 42, prev_gc_count: 38 }],
        },
    ],
    parseConfig,
    component: BigNumberComponent,
};
