import React, { useContext, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { Sankey, Tooltip, Layer, Rectangle } from 'recharts';
import type { PlotRegistration, PlotParameter } from './plotTypes';
import { withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, getPaletteColors } from '../../utils/plotUtils';
import type { ParsedPlotCall } from '../../utils/plotParser';

const DEFAULT_COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#f87171', '#a78bfa', '#fb923c'];

export interface SankeyConfig {
    source: string;
    target: string;
    value: string;
}

const params: PlotParameter[] = [
    { name: 'source', type: 'column', required: true, description: 'Column for source node labels.' },
    { name: 'target', type: 'column', required: true, description: 'Column for target node labels.' },
    { name: 'value', type: 'column', required: true, description: 'Numeric column for flow width.' },
];

const parseConfig = createConfigParser<SankeyConfig>(buildParserSpec(params));

export interface SankeyDataNode { name: string; }
export interface SankeyDataLink { source: number; target: number; value: number; }

export function buildSankeyData(
    rows: any[],
    sourceCol: string,
    targetCol: string,
    valueCol: string,
): { nodes: SankeyDataNode[]; links: SankeyDataLink[] } {
    if (rows.length === 0) return { nodes: [], links: [] };
    const nameIndex = new Map<string, number>();
    const nodes: SankeyDataNode[] = [];
    const addNode = (name: string) => {
        if (!nameIndex.has(name)) { nameIndex.set(name, nodes.length); nodes.push({ name }); }
        return nameIndex.get(name)!;
    };
    const linkMap = new Map<string, number>();
    for (const row of rows) {
        const src = String(row[sourceCol] ?? '');
        const tgt = String(row[targetCol] ?? '');
        const val = parseFloat(String(row[valueCol]));
        if (!src || !tgt || isNaN(val)) continue;
        const si = addNode(src);
        const ti = addNode(tgt);
        const key = `${si}→${ti}`;
        linkMap.set(key, (linkMap.get(key) ?? 0) + val);
    }
    const links: SankeyDataLink[] = Array.from(linkMap.entries()).map(([key, value]) => {
        const [s, t] = key.split('→').map(Number);
        return { source: s, target: t, value };
    });
    return { nodes, links };
}

/** Filter rows to only those where `focus` appears as source or target. */
export function filterByFocus(
    rows: any[],
    sourceCol: string,
    targetCol: string,
    focus: string | null,
): any[] {
    if (focus === null) return rows;
    return rows.filter(r =>
        String(r[sourceCol] ?? '') === focus || String(r[targetCol] ?? '') === focus
    );
}

const SankeyComponent: React.FC<{
    config: SankeyConfig;
    data: any[];
    isAnimationActive?: boolean;
    animationDuration?: number;
    clauses?: ParsedPlotCall;
    gestureName?: string;
    onVariableChange?: (vars: Record<string, unknown>) => void;
}> = ({ config, data, clauses, gestureName, onVariableChange }) => {
    useContext(SettingsContext);
    const colors = getPaletteColors(clauses?.palette, DEFAULT_COLORS);

    const sourceCol = config.source;
    const targetCol = config.target;
    const valueCol = config.value;

    const [focus, setFocus] = useState<string | null>(null);
    const [trail, setTrail] = useState<string[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);
    const [dims, setDims] = useState({ width: 600, height: 400 });

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(entries => {
            const { width, height } = entries[0].contentRect;
            if (width > 10 && height > 10) setDims({ width, height });
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const filteredRows = useMemo(() =>
        filterByFocus(data, sourceCol, targetCol, focus),
        [data, sourceCol, targetCol, focus]
    );

    const sankeyData = useMemo(() =>
        buildSankeyData(filteredRows, sourceCol, targetCol, valueCol),
        [filteredRows, sourceCol, targetCol, valueCol]
    );

    const handleNodeClick = useCallback((item: any, type: string, _e?: unknown) => {
        if (type !== 'node' || !item?.name) return;
        const newFocus = item.name as string;
        setFocus(newFocus);
        setTrail(prev => [...prev, newFocus]);
        if (gestureName && onVariableChange) {
            onVariableChange({ [`${gestureName}.selection`]: newFocus });
        }
    }, [gestureName, onVariableChange]);

    const navigateTrail = useCallback((idx: number) => {
        const newTrail = trail.slice(0, idx + 1);
        const newFocus = newTrail[newTrail.length - 1] ?? null;
        setTrail(newTrail);
        setFocus(newFocus);
        if (gestureName && onVariableChange) {
            onVariableChange({ [`${gestureName}.selection`]: newFocus ?? '' });
        }
    }, [trail, gestureName, onVariableChange]);

    const resetFocus = useCallback(() => {
        setFocus(null);
        setTrail([]);
        if (gestureName && onVariableChange) {
            onVariableChange({ [`${gestureName}.selection`]: '' });
        }
    }, [gestureName, onVariableChange]);

    const CustomNode = useCallback((props: any) => {
        const { x, y, width, height, index, payload } = props;
        const fill = colors[index % colors.length];
        return (
            <Layer key={`node-${index}`}>
                <Rectangle
                    x={x} y={y} width={width} height={height}
                    fill={fill} fillOpacity={0.9}
                    style={{ cursor: 'pointer' }}
                />
                {width > 5 && (
                    <text x={x + width + 6} y={y + height / 2} dy="0.35em"
                        fill="#d1d5db" fontSize={11} textAnchor="start">
                        {payload?.name ?? ''}
                    </text>
                )}
            </Layer>
        );
    }, [colors]);

    if (sankeyData.nodes.length === 0) {
        return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No data</div>;
    }

    return (
        <div className="w-full h-full flex flex-col">
            {trail.length > 0 && (
                <div className="flex items-center gap-1 px-2 py-1 text-[11px] text-gray-400 flex-wrap">
                    <button onClick={resetFocus} className="hover:text-cyan-300">All</button>
                    {trail.map((seg, i) => (
                        <React.Fragment key={i}>
                            <span className="text-gray-600">›</span>
                            <button
                                onClick={() => navigateTrail(i)}
                                className={`hover:text-cyan-300 truncate max-w-[140px] ${i === trail.length - 1 ? 'text-cyan-300 font-semibold' : ''}`}
                            >{seg}</button>
                        </React.Fragment>
                    ))}
                </div>
            )}
            <div className="flex-1 min-h-0" ref={containerRef}>
                <Sankey
                    width={dims.width}
                    height={dims.height}
                    data={sankeyData}
                    node={CustomNode}
                    nodePadding={8}
                    nodeWidth={10}
                    margin={{ top: 8, right: 120, bottom: 8, left: 8 }}
                    onClick={handleNodeClick as any}
                >
                    <Tooltip
                        formatter={(v: number) => v.toLocaleString()}
                        contentStyle={{ background: '#1f2937', border: 'none', fontSize: 11 }}
                    />
                </Sankey>
            </div>
        </div>
    );
};

export const sankeyPlot: PlotRegistration<SankeyConfig> = {
    name: 'SANKEY',
    description: 'Flow diagram between categorical nodes. Click a node to re-root the view (flamegraph-like drill-down). Useful for call graphs, class hierarchies, and allocation flows.',
    params: withCommonParams(params),
    template: 'SANKEY(source: , target: , value: )',
    examples: [
        {
            description: 'Method call flow from profiling data',
            code: 'SANKEY(source: "caller", target: "callee", value: "samples") TITLE "Call Flow"',
            sampleData: [
                { caller: 'main', callee: 'gc', samples: 50 },
                { caller: 'gc', callee: 'compact', samples: 30 },
                { caller: 'gc', callee: 'sweep', samples: 20 },
            ],
        },
    ],
    parseConfig,
    component: SankeyComponent,
};
