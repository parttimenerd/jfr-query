import React, { useEffect, useState, useContext } from 'react';
import { DataContext } from '../../context/DuckDBContext';
import DataTable from '../DataTable';
import { plotRegistry } from '../plots/plotRegistry';
import { normalizePlotName } from '../plots/plotNames';
import { flameGraphPlot } from '../plots/FlameGraphPlot';

export type CellFenceType = 'chart' | 'table' | 'flamegraph' | 'sql';

export interface ParsedCellFence {
    type: CellFenceType;
    sql: string;
    plotConfig?: string;
}

export type FencePart =
    | { kind: 'text'; content: string }
    | { kind: 'cell'; content: string };

/** Parse the inner content of a :::cell fence (everything between ::: markers). */
export function parseCellFence(inner: string): ParsedCellFence | null {
    const lines = inner.split('\n');
    const VALID_TYPES = new Set(['chart', 'table', 'flamegraph', 'sql']);
    let type: CellFenceType | null = null;
    let sql: string | null = null;
    let plotConfig: string | undefined;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('type=')) {
            const raw = trimmed.slice('type='.length).trim();
            if (VALID_TYPES.has(raw)) type = raw as CellFenceType;
        } else if (trimmed.startsWith('sql:')) {
            sql = trimmed.slice('sql:'.length).trim(); // sql must be on a single line in the fence
        } else if (trimmed.startsWith('plot:')) {
            plotConfig = trimmed.slice('plot:'.length).trim();
        }
    }

    if (!type || !sql) return null;
    return { type, sql, plotConfig };
}

/** Split a markdown string into alternating text and cell-fence parts. */
export function splitCellFences(text: string): FencePart[] {
    const FENCE_RE = /:::cell[ \t]+([\s\S]*?):::/g;
    const parts: FencePart[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = FENCE_RE.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push({ kind: 'text', content: text.slice(lastIndex, match.index) });
        }
        parts.push({ kind: 'cell', content: match[1].trim() });
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        parts.push({ kind: 'text', content: text.slice(lastIndex) });
    }

    return parts;
}

// ChatEmbeddedCell component — added in Task 2

interface ChatEmbeddedCellProps {
    type: CellFenceType;
    sql: string;
    plotConfig?: string;
    onAddToNotebook: () => void;
}

type CellState =
    | { status: 'loading' }
    | { status: 'done'; data: any[] }
    | { status: 'error'; message: string };

const TYPE_LABELS: Record<CellFenceType, string> = {
    chart: 'CHART',
    table: 'TABLE',
    flamegraph: 'FLAME GRAPH',
    sql: 'SQL',
};

export function ChatEmbeddedCell({ type, sql, plotConfig, onAddToNotebook }: ChatEmbeddedCellProps) {
    const { query } = useContext(DataContext);
    const [state, setState] = useState<CellState>({ status: 'loading' });

    useEffect(() => {
        setState({ status: 'loading' });
        query(sql)
            .then(data => setState({ status: 'done', data }))
            .catch(err => setState({ status: 'error', message: String((err as Error)?.message ?? err) }));
    }, [sql]);

    const truncatedSql = sql.length > 60 ? sql.slice(0, 60) + '…' : sql;

    return (
        <div className="bg-gray-950 border border-gray-800 rounded-lg overflow-hidden my-2">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-800">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-semibold tracking-widest text-gray-500 shrink-0">
                        {TYPE_LABELS[type]}
                    </span>
                    <span className="text-gray-600 text-xs">&middot;</span>
                    <span className="text-[10px] text-gray-600 font-mono truncate">{truncatedSql}</span>
                </div>
                <button
                    onClick={onAddToNotebook}
                    className="text-[10px] text-cyan-500 hover:text-cyan-300 shrink-0 ml-2 cursor-pointer"
                >
                    &#8599; Add to notebook
                </button>
            </div>

            {/* Body */}
            <div className="p-2">
                {state.status === 'loading' && (
                    <div className="text-xs text-gray-600 py-2 px-1">Running query…</div>
                )}
                {state.status === 'error' && (
                    <div className="text-xs text-red-400 py-2 px-1 font-mono">{state.message}</div>
                )}
                {state.status === 'done' && (type === 'table' || type === 'sql') && (
                    <div className="max-h-[200px] overflow-y-auto">
                        <DataTable data={state.data} showSearch={false} />
                    </div>
                )}
                {state.status === 'done' && type === 'chart' && plotConfig && (
                    <ChartEmbed data={state.data} plotConfig={plotConfig} />
                )}
                {state.status === 'done' && type === 'flamegraph' && (
                    <FlameEmbed data={state.data} />
                )}
            </div>
        </div>
    );
}

function ChartEmbed({ data, plotConfig }: { data: any[]; plotConfig: string }) {
    try {
        const typeName = normalizePlotName(plotConfig.match(/^(\w+)/)?.[1] ?? '');
        const reg = plotRegistry[typeName];
        if (!reg) return <div className="text-xs text-red-400 py-2">Unknown chart type: {typeName}</div>;
        const config = reg.parseConfig(plotConfig, data);
        const PlotComponent = reg.component;
        return <PlotComponent config={config} data={data} clauses={undefined as any} />;
    } catch (err: unknown) {
        return <div className="text-xs text-red-400 py-2 font-mono">{String((err as Error)?.message ?? err)}</div>;
    }
}

function FlameEmbed({ data }: { data: any[] }) {
    const defaultConfig = 'FLAMEGRAPH(frames: "frame", value: "value")';
    try {
        const config = flameGraphPlot.parseConfig(defaultConfig, data);
        const FlameComponent = flameGraphPlot.component;
        return <FlameComponent config={config} data={data} clauses={undefined as any} />;
    } catch (err: unknown) {
        return <div className="text-xs text-red-400 py-2 font-mono">{String((err as Error)?.message ?? err)}</div>;
    }
}
