import React, { useContext, useMemo } from 'react';
import { ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn } from '../../utils/plotUtils';
import type { ParsedPlotCall } from '../../utils/plotParser';
import { SettingsContext } from '../../context/SettingsContext';

interface WaterfallConfig {
    category: string;
    value: string;
    total?: string;
    showValues?: boolean;
    positiveColor?: string;
    negativeColor?: string;
    totalColor?: string;
}

export interface WaterfallBar {
    name: string;
    base: number;
    delta: number;
    fill: string;
    rawDelta: number;
    isTotal: boolean;
}

const params: PlotParameter[] = [
    { name: 'category', type: 'column', required: true, description: 'Column for step/phase labels on X axis.' },
    { name: 'value', type: 'column', required: true, description: 'Numeric column for the delta change at each step.' },
    { name: 'total', type: 'column', required: false, description: 'Boolean column (truthy = this row is a total bar, rendered from zero).' },
    { name: 'showValues', type: 'boolean', required: false, defaultValue: true, description: 'Show the numeric delta above each bar.' },
    { name: 'positiveColor', type: 'string', required: false, defaultValue: '#22c55e', description: 'Fill color for positive bars.' },
    { name: 'negativeColor', type: 'string', required: false, defaultValue: '#ef4444', description: 'Fill color for negative bars.' },
    { name: 'totalColor', type: 'string', required: false, defaultValue: '#60a5fa', description: 'Fill color for total bars.' },
];

const parseConfig = createConfigParser<WaterfallConfig>(buildParserSpec(params));

/**
 * Builds the stacked-bar data for a waterfall chart.
 * Each row has a transparent "base" bar (invisible spacer) and a visible "delta" bar.
 */
export function buildWaterfallBars(data: any[], config: WaterfallConfig): WaterfallBar[] {
    if (!data || data.length === 0) return [];

    const allColumns = Object.keys(data[0]);
    const categoryCol = findColumn(config.category, allColumns);
    const valueCol = findColumn(config.value, allColumns);
    const totalCol = config.total ? findColumn(config.total, allColumns) : null;

    const positiveColor = config.positiveColor ?? '#22c55e';
    const negativeColor = config.negativeColor ?? '#ef4444';
    const totalColor = config.totalColor ?? '#60a5fa';

    let running = 0;
    const bars: WaterfallBar[] = [];

    for (const row of data) {
        const name = String(row[categoryCol] ?? '');
        const rawDelta = parseFloat(row[valueCol]);

        if (isNaN(rawDelta)) continue;

        const isTotal = totalCol ? Boolean(row[totalCol]) : false;

        let base: number;
        let fill: string;

        if (isTotal) {
            base = 0;
            fill = totalColor;
            running = rawDelta;
        } else if (rawDelta >= 0) {
            base = running;
            fill = positiveColor;
            running += rawDelta;
        } else {
            base = running + rawDelta;
            fill = negativeColor;
            running += rawDelta;
        }

        bars.push({
            name,
            base,
            delta: Math.abs(rawDelta),
            fill,
            rawDelta,
            isTotal,
        });
    }

    return bars;
}

const WaterfallComponent: React.FC<{
    config: WaterfallConfig;
    data: any[];
    isAnimationActive?: boolean;
    animationDuration?: number;
    clauses?: ParsedPlotCall;
}> = ({ config, data, isAnimationActive, animationDuration }) => {
    // SettingsContext is consumed to stay consistent with other plot components
    // even though we don't use specific settings here currently.
    useContext(SettingsContext);

    const showValues = config.showValues ?? true;

    const bars = useMemo(() => buildWaterfallBars(data, config), [data, config]);

    if (bars.length === 0) {
        return <div className="p-4 text-center text-gray-500 text-sm">No valid data.</div>;
    }

    return (
        <div style={{ width: '100%', minHeight: 200 }}>
            <ResponsiveContainer width="100%" minHeight={200}>
                <ComposedChart data={bars} margin={{ top: showValues ? 20 : 5, right: 20, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip
                        formatter={(value: any, name: string, entry: any) => {
                            if (name === 'base') return null;
                            return [entry?.payload?.rawDelta, entry?.payload?.name];
                        }}
                        filterNull
                    />
                    {/* Invisible base bar — transparent spacer */}
                    <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} legendType="none" />
                    {/* Visible delta bar */}
                    <Bar dataKey="delta" stackId="wf" isAnimationActive={isAnimationActive} animationDuration={animationDuration}>
                        {bars.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                        {showValues && (
                            <LabelList
                                dataKey="rawDelta"
                                position="top"
                                formatter={(v: number) => v > 0 ? `+${v}` : String(v)}
                                style={{ fontSize: 11 }}
                            />
                        )}
                    </Bar>
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
};

export const waterfallPlot: PlotRegistration<WaterfallConfig> = {
    name: 'WATERFALL',
    description: 'Waterfall chart — shows cumulative effect of sequential positive/negative deltas.',
    params: withCommonParams(params),
    supportsMultiQuery: false,
    template: 'WATERFALL(category: "$category", value: "$value")',
    examples: [
        {
            description: 'GC pause contribution per phase',
            code: 'WATERFALL(category: "phase", value: "pauseMs")',
        },
        {
            description: 'Memory change by GC event with totals highlighted',
            code: 'WATERFALL(category: "gcName", value: "memDelta", total: "isCumulative", showValues: true)',
        },
        {
            description: 'Heap delta with custom colors',
            code: 'WATERFALL(category: "step", value: "heapDelta", positiveColor: "#22c55e", negativeColor: "#ef4444") TITLE "Heap waterfall"',
        },
    ],
    parseConfig,
    component: WaterfallComponent,
};
