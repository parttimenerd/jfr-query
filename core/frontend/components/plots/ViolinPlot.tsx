import React, { useContext, useMemo, useCallback } from 'react';
import {
    ComposedChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip,
} from 'recharts';
import type { PlotRegistration, PlotParameter } from './plotTypes';
import { withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, getPaletteColors } from '../../utils/plotUtils';
import type { ParsedPlotCall } from '../../utils/plotParser';

const DEFAULT_COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#f87171', '#a78bfa', '#fb923c'];

export interface ViolinConfig {
    value: string;
    category?: string;
    bins?: number;
}

const params: PlotParameter[] = [
    { name: 'value', type: 'column', required: true, description: 'Numeric column for the distribution axis.' },
    { name: 'category', type: 'column', required: false, description: 'Categorical column — one violin per group.' },
    { name: 'bins', type: 'number', required: false, defaultValue: 20, description: 'KDE resolution (number of density sample points).' },
];

const parseConfig = createConfigParser<ViolinConfig>(buildParserSpec(params));

/** Gaussian KDE evaluated at `bins` evenly-spaced points across the data range. */
export function computeKde(values: number[], bins: number): { x: number; density: number }[] {
    if (values.length === 0) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
        return Array.from({ length: bins }, (_, i) => ({
            x: min + (i / (bins - 1)) * 0.001,
            density: i === Math.floor(bins / 2) ? 1 : 0,
        }));
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);
    const bw = std > 0 ? 1.06 * std * Math.pow(values.length, -0.2) : (max - min) / bins;
    return Array.from({ length: bins }, (_, i) => {
        const x = min + (i / (bins - 1)) * (max - min);
        const density = values.reduce((sum, v) => {
            const u = (x - v) / bw;
            return sum + Math.exp(-0.5 * u * u) / (bw * Math.sqrt(2 * Math.PI));
        }, 0) / values.length;
        return { x, density };
    });
}

const ViolinComponent: React.FC<{
    config: ViolinConfig;
    data: any[];
    isAnimationActive?: boolean;
    animationDuration?: number;
    clauses?: ParsedPlotCall;
    gestureName?: string;
    onVariableChange?: (vars: Record<string, unknown>) => void;
}> = ({ config, data, isAnimationActive, animationDuration, clauses, gestureName, onVariableChange }) => {
    useContext(SettingsContext);
    const colors = getPaletteColors(clauses?.palette, DEFAULT_COLORS);
    const bins = config.bins ?? 20;

    const allColumns = useMemo(() => data && data.length > 0 ? Object.keys(data[0]) : [], [data]);
    const valueCol = config.value;
    const catCol = config.category;

    const groups: { label: string; values: number[] }[] = useMemo(() => {
        if (!data || data.length === 0) return [];
        const numericValues = data
            .map(r => parseFloat(String(r[valueCol])))
            .filter(v => !isNaN(v));
        if (!catCol) return [{ label: '', values: numericValues }];
        const map = new Map<string, number[]>();
        for (const row of data) {
            const cat = String(row[catCol] ?? '');
            const val = parseFloat(String(row[valueCol]));
            if (isNaN(val)) continue;
            if (!map.has(cat)) map.set(cat, []);
            map.get(cat)!.push(val);
        }
        return Array.from(map.entries()).map(([label, values]) => ({ label, values }));
    }, [data, valueCol, catCol]);

    const violins = useMemo(() =>
        groups.map(g => ({ ...g, kde: computeKde(g.values, bins) })),
        [groups, bins]
    );

    const maxDensity = useMemo(() =>
        Math.max(...violins.flatMap(v => v.kde.map(k => k.density)), 0.0001),
        [violins]
    );

    const handleClick = useCallback((groupLabel: string) => {
        if (!gestureName || !onVariableChange) return;
        onVariableChange({ [`${gestureName}.selection`]: groupLabel });
    }, [gestureName, onVariableChange]);

    if (groups.length === 0) {
        return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No data</div>;
    }

    return (
        <div className="w-full h-full flex gap-2 overflow-x-auto">
            {violins.map((v, idx) => {
                const color = colors[idx % colors.length];
                const chartData = v.kde.map(k => ({
                    x: k.x,
                    pos: k.density / maxDensity,
                    neg: -(k.density / maxDensity),
                }));
                return (
                    <div
                        key={v.label || idx}
                        className="flex-1 min-w-[80px] cursor-pointer flex flex-col"
                        onClick={() => handleClick(v.label)}
                        title={v.label || undefined}
                    >
                        {v.label && (
                            <div className="text-center text-[11px] text-gray-400 truncate px-1 mb-1">{v.label}</div>
                        )}
                        <ResponsiveContainer width="100%" minHeight={160}>
                            <ComposedChart data={chartData} layout="vertical"
                                margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                                <XAxis type="number" domain={[-1, 1]} hide />
                                <YAxis type="number" dataKey="x" domain={['dataMin', 'dataMax']}
                                    width={40} tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                <Tooltip
                                    formatter={(val: number) => Math.abs(val).toFixed(3)}
                                    labelFormatter={(l: number) => `value: ${Number(l).toFixed(2)}`}
                                    contentStyle={{ background: '#1f2937', border: 'none', fontSize: 11 }}
                                />
                                <Area type="monotone" dataKey="pos"
                                    fill={color} stroke={color} fillOpacity={0.6}
                                    isAnimationActive={isAnimationActive}
                                    animationDuration={animationDuration} />
                                <Area type="monotone" dataKey="neg"
                                    fill={color} stroke={color} fillOpacity={0.6}
                                    isAnimationActive={isAnimationActive}
                                    animationDuration={animationDuration} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                );
            })}
        </div>
    );
};

// Suppress unused variable warning — allColumns used for future column resolution
void ((_: string[]) => {})([] as string[]);

export const violinPlot: PlotRegistration<ViolinConfig> = {
    name: 'VIOLIN_PLOT',
    description: 'Distribution shape for numeric data, optionally grouped by category. Shows density via a mirrored kernel density estimate.',
    params: withCommonParams(params),
    template: 'VIOLIN_PLOT(value: )',
    examples: [
        {
            description: 'GC pause duration distribution by cause',
            code: 'VIOLIN_PLOT(value: "pauseDuration", category: "cause") TITLE "Pause Distribution by Cause"',
            sampleData: [
                { pauseDuration: 12, cause: 'G1 GC' }, { pauseDuration: 45, cause: 'G1 GC' },
                { pauseDuration: 8, cause: 'G1 GC' }, { pauseDuration: 180, cause: 'Full GC' },
                { pauseDuration: 210, cause: 'Full GC' }, { pauseDuration: 22, cause: 'G1 GC' },
            ],
        },
    ],
    parseConfig,
    component: ViolinComponent,
};
