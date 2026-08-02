import React, { useContext, useMemo, useState, useCallback } from 'react';
import { SunburstChart, Tooltip } from 'recharts';
import type { SunburstData } from 'recharts/types/chart/SunburstChart';
import type { PlotRegistration, PlotParameter } from './plotTypes';
import { withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, getPaletteColors } from '../../utils/plotUtils';
import type { ParsedPlotCall } from '../../utils/plotParser';

const DEFAULT_COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#f87171', '#a78bfa', '#fb923c',
    '#38bdf8', '#4ade80', '#fbbf24', '#f472b6'];

export interface SunburstConfig {
    path: string | string[];
    value: string;
}

const params: PlotParameter[] = [
    { name: 'path', type: 'column', required: true, description: 'Column(s) defining hierarchy depth. Use a single column name or a comma-separated list for multiple levels.' },
    { name: 'value', type: 'column', required: true, description: 'Numeric column for node size.' },
];

const parseConfig = createConfigParser<SunburstConfig>(buildParserSpec(params));

export interface SunburstNode extends SunburstData {
    name: string;
    value?: number;
    fill?: string;
    children?: SunburstNode[];
}

/** Build a hierarchy tree from flat rows. pathCols can be an array of column names or
 *  a single column name (then rows are split by `sep`). */
export function buildTree(
    rows: any[],
    pathCols: string | string[],
    valueCol: string,
    sep = '/',
): SunburstNode {
    const root: SunburstNode & { children: SunburstNode[] } = { name: '(root)', children: [] };
    for (const row of rows) {
        const segments: string[] = Array.isArray(pathCols)
            ? pathCols.map(c => String(row[c] ?? ''))
            : String(row[pathCols] ?? '').split(sep).filter(Boolean);
        const val = parseFloat(String(row[valueCol]));
        if (isNaN(val) || segments.length === 0) continue;
        let node: SunburstNode & { children?: SunburstNode[] } = root;
        for (let d = 0; d < segments.length; d++) {
            const seg = segments[d];
            if (!node.children) node.children = [];
            let child = node.children.find(c => c.name === seg);
            if (!child) { child = { name: seg }; node.children.push(child); }
            if (d === segments.length - 1) {
                child.value = (child.value ?? 0) + val;
            }
            node = child;
        }
    }
    return root;
}

function colorTree(node: SunburstNode, colors: string[], depth = 0, idx = { v: 0 }): void {
    if (depth === 1) { node.fill = colors[idx.v++ % colors.length]; }
    for (const child of node.children ?? []) {
        if (depth >= 1) child.fill = node.fill;
        colorTree(child, colors, depth + 1, idx);
    }
}

const SunburstComponent: React.FC<{
    config: SunburstConfig;
    data: any[];
    isAnimationActive?: boolean;
    animationDuration?: number;
    clauses?: ParsedPlotCall;
    gestureName?: string;
    onVariableChange?: (vars: Record<string, unknown>) => void;
}> = ({ config, data, clauses, gestureName, onVariableChange }) => {
    useContext(SettingsContext);
    const colors = getPaletteColors(clauses?.palette, DEFAULT_COLORS);

    const pathCols: string | string[] = Array.isArray(config.path)
        ? config.path
        : config.path;

    const valueCol = config.value;

    const [rootPath, setRootPath] = useState<string[]>([]);

    const fullTree = useMemo(() => {
        const t = buildTree(data, pathCols, valueCol);
        colorTree(t, colors);
        return t;
    }, [data, pathCols, valueCol, colors]);

    const currentNode: SunburstNode = useMemo(() => {
        let node: SunburstNode = fullTree;
        for (const seg of rootPath) {
            const child = node.children?.find(c => c.name === seg);
            if (!child) break;
            node = child;
        }
        return node;
    }, [fullTree, rootPath]);

    const navigate = useCallback((node: SunburstData) => {
        if (!node || node.name === '(root)') return;
        const newPath = [...rootPath, node.name];
        setRootPath(newPath);
        if (gestureName && onVariableChange) {
            onVariableChange({ [`${gestureName}.selection`]: newPath.join('/') });
        }
    }, [rootPath, gestureName, onVariableChange]);

    const navigateUp = useCallback((idx: number) => {
        const newPath = rootPath.slice(0, idx);
        setRootPath(newPath);
        if (gestureName && onVariableChange) {
            onVariableChange({ [`${gestureName}.selection`]: newPath.join('/') });
        }
    }, [rootPath, gestureName, onVariableChange]);

    if (!data || data.length === 0) {
        return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No data</div>;
    }

    return (
        <div className="w-full h-full flex flex-col">
            {rootPath.length > 0 && (
                <div className="flex items-center gap-1 px-2 py-1 text-[11px] text-gray-400 flex-wrap">
                    <button onClick={() => navigateUp(0)} className="hover:text-cyan-300">(root)</button>
                    {rootPath.map((seg, i) => (
                        <React.Fragment key={i}>
                            <span className="text-gray-600">/</span>
                            <button
                                onClick={() => navigateUp(i + 1)}
                                className={`hover:text-cyan-300 truncate max-w-[120px] ${i === rootPath.length - 1 ? 'text-cyan-300 font-semibold' : ''}`}
                            >{seg}</button>
                        </React.Fragment>
                    ))}
                </div>
            )}
            <div className="flex-1 min-h-0 flex items-center justify-center">
                <SunburstChart
                    width={400}
                    height={400}
                    data={currentNode}
                    dataKey="value"
                    onClick={navigate}
                >
                    <Tooltip
                        formatter={(v: number) => v.toLocaleString()}
                        contentStyle={{ background: '#1f2937', border: 'none', fontSize: 11 }}
                    />
                </SunburstChart>
            </div>
        </div>
    );
};

export const sunburstPlot: PlotRegistration<SunburstConfig> = {
    name: 'SUNBURST',
    description: 'Hierarchical part-of-whole chart. Click segments to drill down; click the center to go up.',
    params: withCommonParams(params),
    template: 'SUNBURST(path: , value: )',
    examples: [
        {
            description: 'Package / class allocation breakdown',
            code: 'SUNBURST(path: "pkg", value: "allocBytes") TITLE "Allocation by Package"',
            sampleData: [
                { pkg: 'com.example', allocBytes: 1024 },
                { pkg: 'com.example', allocBytes: 512 },
                { pkg: 'org.lib', allocBytes: 256 },
            ],
        },
    ],
    parseConfig,
    component: SunburstComponent,
};
