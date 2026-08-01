import React, { useMemo, useRef, useState, useCallback } from 'react';
import DataTable from '../DataTable';
import PlotRenderer from '../PlotRenderer';
import { PlotErrorBoundary } from './PlotErrorBoundary';
import type { NotebookCellData, NotebookMetadata } from '../../types';

interface InlinePreviewProps {
    toolName: string;
    args: any;
    result: any;
    /**
     * Promote the previewed content to a notebook cell. The `'combined'`
     * variant is used for previewPlot, where one SQL block and one plot
     * block become a single cell — wire it to `onAddCellFromAI` upstream.
     */
    onAddToNotebook?: (
        type: 'sql' | 'plot' | 'markdown' | 'combined',
        content: string,
        plotConfig?: string,
    ) => void;
    /** Provided to PlotRenderer for read-only chart rendering. */
    metadata?: NotebookMetadata;
}

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    const copy = useCallback(() => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    }, [text]);
    return (
        <button
            type="button"
            onClick={copy}
            className="px-2 py-0.5 text-[10px] text-gray-400 hover:text-gray-200 rounded"
            title="Copy SQL to clipboard"
        >
            {copied ? 'Copied!' : 'Copy SQL'}
        </button>
    );
}

/**
 * Renders the result of a completed *read* tool call inline in the chat.
 * For runQuery: collapsible SQL + full-height DataTable with truncation indicator.
 * For previewPlot: SQL + taller PlotRenderer chart with a one-click promote.
 * For other reads: returns null (handled elsewhere in the UI).
 */
export const InlinePreview: React.FC<InlinePreviewProps> = ({ toolName, args, result, onAddToNotebook, metadata }) => {
    // Stable id for the synthetic previewPlot cell when the runtime didn't
    // mint a previewId. Created once per InlinePreview instance so the
    // PlotRenderer's id-keyed state (brushes, cell vars) doesn't reset on
    // every re-render. We always call useRef (Rules of Hooks); the value is
    // only read inside the previewPlot branch.
    const fallbackPreviewCellId = useRef(
        `chat-preview-${Math.random().toString(36).slice(2, 8)}`
    ).current;

    // Pre-extract previewPlot fields unconditionally so useMemo (Rules of Hooks)
    // can be called at the top level.
    const plotBranchData = toolName === 'previewPlot' ? (result?.data ?? result) : null;
    const plotSql = toolName === 'previewPlot' ? String(args?.sql ?? '') : '';
    const plotConfig = toolName === 'previewPlot' ? String(plotBranchData?.plotConfig ?? args?.plotConfig ?? '') : '';
    const plotPreviewId: string | undefined = plotBranchData?.previewId;
    const syntheticCell: NotebookCellData = useMemo(() => ({
        id: plotPreviewId ?? fallbackPreviewCellId,
        title: '',
        content: '```sql\n' + plotSql + '\n```\n\n```plot\n' + plotConfig + '\n```',
    }), [plotSql, plotConfig, plotPreviewId, fallbackPreviewCellId]);

    if (toolName === 'runQuery') {
        const sql = String(args?.sql ?? '');
        // Tool result shape: ToolResult wrapper { ok, data: { columns, rows } }.
        const data = result?.data ?? result;
        const rows: any[] = Array.isArray(data?.rows)
            ? data.rows
            : Array.isArray(data)
            ? data
            : [];
        const headers: string[] | undefined = Array.isArray(data?.columns)
            ? data.columns.map((c: any) => c.name)
            : undefined;
        const truncated: boolean = !!data?.truncated;
        const limit: number = data?.limit ?? 100;

        // Don't show an inline preview for empty results — these are usually
        // exploratory schema-discovery queries the user doesn't need to see.
        if (rows.length === 0) return null;

        const rowLabel = truncated
            ? `${rows.length} rows shown (limited to ${limit} — use offset to page)`
            : `${rows.length} row${rows.length === 1 ? '' : 's'}`;

        return (
            <div className="my-2 border border-gray-700 rounded bg-gray-800/60">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700 text-[10px] uppercase tracking-wider text-gray-500">
                    <span className={truncated ? 'text-amber-400' : ''}>
                        {rowLabel}
                        {truncated && <span className="ml-1 normal-case text-amber-400/70">(truncated)</span>}
                    </span>
                    <div className="flex items-center gap-1">
                        <CopyButton text={sql} />
                        {onAddToNotebook && (
                            <button
                                type="button"
                                onClick={() => onAddToNotebook('sql', sql)}
                                className="px-2 py-0.5 text-[10px] bg-cyan-700/40 hover:bg-cyan-700/70 text-cyan-200 rounded"
                                title="Add this SQL as a new notebook cell"
                                aria-label="Add this SQL as a new notebook cell"
                            >
                                Add to Notebook
                            </button>
                        )}
                    </div>
                </div>
                <details className="border-b border-gray-700">
                    <summary className="px-3 py-1 text-[10px] text-gray-500 cursor-pointer select-none hover:text-gray-300">
                        Show SQL
                    </summary>
                    <pre className="px-3 py-2 text-[11px] text-gray-300 whitespace-pre-wrap font-mono max-h-40 overflow-auto">{sql}</pre>
                </details>
                <div className="max-h-96 overflow-auto">
                    <DataTable data={rows} headers={headers} showSearch={rows.length > 10} />
                </div>
            </div>
        );
    }

    if (toolName === 'previewPlot') {
        const sql = plotSql;
        const rows: any[] = Array.isArray(plotBranchData?.rows) ? plotBranchData.rows : [];
        const truncated: boolean = !!plotBranchData?.truncated;
        const limit: number = plotBranchData?.limit ?? 200;
        const combinedContent = '```sql\n' + sql + '\n```\n\n```plot\n' + plotConfig + '\n```';
        const fallbackMetadata: NotebookMetadata = metadata ?? { views: [], macros: [] };

        const rowLabel = truncated
            ? `${rows.length} rows (limited to ${limit})`
            : `${rows.length} row${rows.length === 1 ? '' : 's'}`;

        return (
            <div
                className="my-2 border border-gray-700 rounded bg-gray-800/60"
                data-preview-id={plotPreviewId}
            >
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700 text-[10px] uppercase tracking-wider text-gray-500">
                    <span className={truncated ? 'text-amber-400/80' : ''}>
                        Plot · {rowLabel}
                    </span>
                    <div className="flex items-center gap-1">
                        <CopyButton text={sql} />
                        {onAddToNotebook && (
                            <button
                                type="button"
                                onClick={() => onAddToNotebook('combined', combinedContent, plotConfig)}
                                className="px-2 py-0.5 text-[10px] bg-cyan-700/40 hover:bg-cyan-700/70 text-cyan-200 rounded"
                                title="Add this SQL + plot as a new notebook cell"
                                aria-label="Add this SQL and plot as a new notebook cell"
                            >
                                Add to Notebook
                            </button>
                        )}
                    </div>
                </div>
                <details className="border-b border-gray-700">
                    <summary className="px-3 py-1 text-[10px] text-gray-500 cursor-pointer select-none hover:text-gray-300">Show SQL / DSL</summary>
                    <pre className="px-3 py-2 text-[11px] text-gray-300 whitespace-pre-wrap font-mono max-h-40 overflow-auto">{sql}{'\n\n'}{plotConfig}</pre>
                </details>
                <div className="px-2 py-2 h-[360px] overflow-hidden">
                    <PlotErrorBoundary
                        resetKey={plotConfig}
                        fallback={
                            <div className="text-xs text-red-300 p-2">
                                Plot config could not be rendered.
                                <pre className="mt-1 text-[11px] text-gray-400 whitespace-pre-wrap font-mono">{plotConfig}</pre>
                            </div>
                        }
                    >
                        <PlotRenderer
                            config={plotConfig}
                            data={rows}
                            sql={sql}
                            cellContext={syntheticCell}
                            onApplyFix={() => { /* read-only preview; no-op */ }}
                            metadata={fallbackMetadata}
                            onMetadataChange={() => { /* read-only preview; no-op */ }}
                            onCellVariableChange={() => { /* read-only preview; no-op */ }}
                            allVariables={fallbackMetadata.variables ?? {}}
                        />
                    </PlotErrorBoundary>
                </div>
            </div>
        );
    }

    return null;
};
