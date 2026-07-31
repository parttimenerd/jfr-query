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

/** Parse the inner content of a :::cell fence (everything between ::: markers).
 *  Supports multi-line SQL via an indented block after `sql:` or a ```sql fence.
 */
export function parseCellFence(inner: string): ParsedCellFence | null {
    const VALID_TYPES = new Set(['chart', 'table', 'flamegraph', 'sql']);
    let type: CellFenceType | null = null;
    let sql: string | null = null;
    let plotConfig: string | undefined;

    // Try ```sql ... ``` block first (model sometimes emits this)
    const sqlFence = inner.match(/```sql\s*\n([\s\S]*?)```/i);
    if (sqlFence) sql = sqlFence[1].trim();

    const lines = inner.split('\n');
    let i = 0;
    while (i < lines.length) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('type=')) {
            const raw = trimmed.slice('type='.length).trim();
            if (VALID_TYPES.has(raw)) type = raw as CellFenceType;
        } else if (trimmed.startsWith('plot:')) {
            plotConfig = trimmed.slice('plot:'.length).trim();
        } else if (trimmed.startsWith('sql:')) {
            const inline = trimmed.slice('sql:'.length).trim();
            if (inline) {
                // Inline single-line SQL
                if (!sql) sql = inline;
            } else {
                // Multi-line: collect indented lines until a non-indented line or EOF
                const sqlLines: string[] = [];
                i++;
                while (i < lines.length) {
                    const l = lines[i];
                    // Stop at the next key= / plot: / type= line or a blank+non-indented line
                    if (/^\s*(?:type=|sql:|plot:)/.test(l)) break;
                    sqlLines.push(l.replace(/^  /, '')); // strip leading 2-space indent
                    i++;
                }
                if (!sql) sql = sqlLines.join('\n').trim();
                continue; // i already advanced
            }
        }
        i++;
    }

    if (!type || !sql) return null;
    return { type, sql, plotConfig };
}

/** Split a markdown string into alternating text and cell-fence parts. */
export function splitCellFences(text: string): FencePart[] {
    const FENCE_RE = /:::cell[ \t\n]+([\s\S]*?):::/g;
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
    onError?: (error: string, sql: string, type: CellFenceType, plotConfig?: string) => void;
    retryCount?: number;
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

export function ChatEmbeddedCell({ type, sql, plotConfig, onAddToNotebook, onError, retryCount }: ChatEmbeddedCellProps) {
    const { query } = useContext(DataContext);
    const [state, setState] = useState<CellState>({ status: 'loading' });

    useEffect(() => {
        setState({ status: 'loading' });
        query(sql)
            .then(data => setState({ status: 'done', data }))
            .catch(err => {
                const message = String((err as Error)?.message ?? err);
                setState({ status: 'error', message });
                onError?.(message, sql, type, plotConfig);
            });
    }, [sql, query, retryCount]);

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
                    <div className="py-2 px-1">
                        <div className="text-xs text-red-400 font-mono">{state.message}</div>
                        {(retryCount ?? 0) >= 2 && onError && (
                            <button
                                onClick={() => onError(state.message, sql, type, plotConfig)}
                                className="text-[10px] text-cyan-500 hover:text-cyan-300 cursor-pointer mt-1"
                            >
                                Ask AI to fix →
                            </button>
                        )}
                    </div>
                )}
                {state.status === 'done' && (type === 'table' || type === 'sql') && (
                    <div className="max-h-[200px] overflow-y-auto">
                        <DataTable data={state.data} showSearch={false} />
                    </div>
                )}
                {state.status === 'done' && type === 'chart' && (
                    plotConfig
                        ? <ChartEmbed data={state.data} plotConfig={plotConfig} />
                        : <div className="text-xs text-yellow-500 py-2 px-1">No plot config provided.</div>
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
    // Detect frame (string) and value (numeric) columns from actual data.
    const sample = data[0] ?? {};
    const cols = Object.keys(sample);
    const frameCol = cols.find(c => typeof sample[c] === 'string') ?? cols[0] ?? 'frame';
    const valueCol = cols.find(c => typeof sample[c] === 'number') ?? cols[1] ?? 'value';
    const defaultConfig = `FLAMEGRAPH(frames: "${frameCol}", value: "${valueCol}")`;
    try {
        const config = flameGraphPlot.parseConfig(defaultConfig, data);
        const FlameComponent = flameGraphPlot.component;
        return <FlameComponent config={config} data={data} clauses={undefined as any} />;
    } catch (err: unknown) {
        return <div className="text-xs text-red-400 py-2 font-mono">{String((err as Error)?.message ?? err)}</div>;
    }
}
