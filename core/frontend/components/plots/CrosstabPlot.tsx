import React, { useContext, useMemo, useCallback } from 'react';
import type { PlotRegistration, PlotParameter } from './plotTypes';
import { withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec } from '../../utils/plotUtils';
import type { ParsedPlotCall } from '../../utils/plotParser';

export type AggFunc = 'SUM' | 'AVG' | 'COUNT' | 'MAX' | 'MIN';

export interface CrosstabConfig {
    row: string;
    col: string;
    value: string;
    agg?: AggFunc;
}

const params: PlotParameter[] = [
    { name: 'row', type: 'column', required: true, description: 'Column for row labels.' },
    { name: 'col', type: 'column', required: true, description: 'Column for column headers.' },
    { name: 'value', type: 'column', required: true, description: 'Numeric column to aggregate.' },
    {
        name: 'agg', type: 'string', required: false, defaultValue: 'SUM',
        options: ['SUM', 'AVG', 'COUNT', 'MAX', 'MIN'],
        description: 'Aggregation function: SUM (default), AVG, COUNT, MAX, or MIN.',
    },
];

const parseConfig = createConfigParser<CrosstabConfig>(buildParserSpec(params));

/** Aggregate rows into a nested Map: rowLabel → colLabel → aggregated value. */
export function aggregate(
    rows: any[],
    rowCol: string,
    colCol: string,
    valueCol: string,
    agg: AggFunc,
): Map<string, Map<string, number>> {
    const acc = new Map<string, Map<string, { sum: number; count: number; min: number; max: number }>>();
    for (const row of rows) {
        const r = String(row[rowCol] ?? '');
        const c = String(row[colCol] ?? '');
        const v = parseFloat(String(row[valueCol]));
        if (isNaN(v)) continue;
        if (!acc.has(r)) acc.set(r, new Map());
        const inner = acc.get(r)!;
        if (!inner.has(c)) inner.set(c, { sum: 0, count: 0, min: Infinity, max: -Infinity });
        const cell = inner.get(c)!;
        cell.sum += v; cell.count++; cell.min = Math.min(cell.min, v); cell.max = Math.max(cell.max, v);
    }
    const result = new Map<string, Map<string, number>>();
    for (const [r, inner] of acc) {
        result.set(r, new Map());
        for (const [c, cell] of inner) {
            let val: number;
            if (agg === 'SUM') val = cell.sum;
            else if (agg === 'AVG') val = cell.sum / cell.count;
            else if (agg === 'COUNT') val = cell.count;
            else if (agg === 'MAX') val = cell.max;
            else val = cell.min;
            result.get(r)!.set(c, val);
        }
    }
    return result;
}

function cellBg(val: number, min: number, max: number): string {
    if (max === min) return 'transparent';
    const t = (val - min) / (max - min);
    const a = Math.round(t * 70) / 100;
    return `rgba(96,165,250,${a.toFixed(2)})`;
}

const CrosstabComponent: React.FC<{
    config: CrosstabConfig;
    data: any[];
    isAnimationActive?: boolean;
    animationDuration?: number;
    clauses?: ParsedPlotCall;
    gestureName?: string;
    onVariableChange?: (vars: Record<string, unknown>) => void;
}> = ({ config, data, clauses, gestureName, onVariableChange }) => {
    useContext(SettingsContext);

    const rowCol = config.row;
    const colCol = config.col;
    const valueCol = config.value;
    const agg: AggFunc = (config.agg as AggFunc) ?? 'SUM';

    const cells = useMemo(() => aggregate(data, rowCol, colCol, valueCol, agg), [data, rowCol, colCol, valueCol, agg]);

    const rows = useMemo(() => Array.from(cells.keys()).sort(), [cells]);
    const cols = useMemo(() => {
        const s = new Set<string>();
        for (const inner of cells.values()) for (const c of inner.keys()) s.add(c);
        return Array.from(s).sort();
    }, [cells]);

    const { min, max } = useMemo(() => {
        let mn = Infinity, mx = -Infinity;
        for (const inner of cells.values()) for (const v of inner.values()) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
        return { min: isFinite(mn) ? mn : 0, max: isFinite(mx) ? mx : 0 };
    }, [cells]);

    const brush2Name = (clauses as any)?.brush2 as string | undefined;

    const handleCellClick = useCallback((rowLabel: string, colLabel: string) => {
        if (!gestureName || !onVariableChange) return;
        const vars: Record<string, unknown> = {
            [`${gestureName}.selection`]: rowLabel,
        };
        if (brush2Name) {
            const g2 = brush2Name.replace(/^\$/, '');
            vars[`${g2}.selection`] = colLabel;
        }
        onVariableChange(vars);
    }, [gestureName, brush2Name, onVariableChange]);

    if (rows.length === 0) {
        return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No data</div>;
    }

    return (
        <div className="w-full h-full overflow-auto">
            <table className="text-[11px] border-collapse w-full">
                <thead>
                    <tr>
                        <th className="px-2 py-1 text-left text-gray-500 border-b border-gray-700 sticky top-0 bg-gray-900 z-10" />
                        {cols.map(c => (
                            <th key={c} className="px-2 py-1 text-right text-gray-400 border-b border-gray-700 sticky top-0 bg-gray-900 z-10 whitespace-nowrap">
                                {c}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map(r => (
                        <tr key={r} className="hover:bg-gray-800/50">
                            <td className="px-2 py-1 text-gray-400 whitespace-nowrap border-b border-gray-800/50">{r}</td>
                            {cols.map(c => {
                                const val = cells.get(r)?.get(c);
                                return (
                                    <td
                                        key={c}
                                        className="px-2 py-1 text-right border-b border-gray-800/50 cursor-pointer"
                                        style={{ background: val != null ? cellBg(val, min, max) : undefined }}
                                        onClick={() => val != null && handleCellClick(r, c)}
                                        title={val != null ? `${r} / ${c}: ${val}` : undefined}
                                    >
                                        {val != null ? val.toLocaleString(undefined, { maximumFractionDigits: 2 }) : ''}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export const crosstabPlot: PlotRegistration<CrosstabConfig> = {
    name: 'CROSSTAB',
    description: 'Pivot table with cell-level color intensity scaling. Shows aggregated values (SUM/AVG/COUNT/MAX/MIN) grouped by two categorical dimensions.',
    params: withCommonParams(params),
    template: 'CROSSTAB(row: , col: , value: )',
    examples: [
        {
            description: 'GC pause by cause and phase with AVG aggregation',
            code: 'CROSSTAB(row: "cause", col: "phase", value: "pauseMs", agg: "AVG") TITLE "Avg Pause by Cause and Phase"',
            sampleData: [
                { cause: 'G1 GC', phase: 'Mark', pauseMs: 12 },
                { cause: 'G1 GC', phase: 'Sweep', pauseMs: 8 },
                { cause: 'Full GC', phase: 'Mark', pauseMs: 150 },
                { cause: 'Full GC', phase: 'Compact', pauseMs: 200 },
            ],
        },
    ],
    parseConfig,
    component: CrosstabComponent,
};
