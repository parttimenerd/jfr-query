import React, { useMemo } from 'react';
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

/**
 * Renders the result of a completed *read* tool call inline in the chat.
 * For runQuery: SQL + DataTable preview of the rows.
 * For previewPlot: SQL + PlotRenderer chart with a one-click promote.
 * For other reads: returns null (handled elsewhere in the UI).
 */
export const InlinePreview: React.FC<InlinePreviewProps> = ({ toolName, args, result, onAddToNotebook, metadata }) => {
    // Stable id for the synthetic previewPlot cell when the runtime didn't
    // mint a previewId. Created once per InlinePreview instance so the
    // PlotRenderer's id-keyed state (brushes, cell vars) doesn't reset on
    // every re-render. We always call useMemo (Rules of Hooks); the value is
    // only read inside the previewPlot branch.
    const fallbackPreviewCellId = useMemo(
        () => `chat-preview-${Math.random().toString(36).slice(2, 8)}`,
        [],
    );

    if (toolName === 'runQuery') {
        const sql = String(args?.sql ?? '');
        // Tool result shape: { columns, rows } (per ChatPanel:399).
        const rows: any[] = Array.isArray(result?.rows)
            ? result.rows
            : Array.isArray(result)
            ? result
            : [];
        const headers: string[] | undefined = Array.isArray(result?.columns)
            ? result.columns.map((c: any) => c.name)
            : undefined;

        // Don't show an inline preview for empty results — these are usually
        // exploratory schema-discovery queries the user doesn't need to see.
        if (rows.length === 0) return null;

        return (
            <div className="my-2 border border-gray-700 rounded bg-gray-800/60">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700 text-[10px] uppercase tracking-wider text-gray-500">
                    <span>SQL preview · {rows.length} row{rows.length === 1 ? '' : 's'}</span>
                    {onAddToNotebook && (
                        <button
                            type="button"
                            onClick={() => onAddToNotebook('sql', sql)}
                            className="px-2 py-0.5 text-[10px] bg-cyan-700/40 hover:bg-cyan-700/70 text-cyan-200 rounded"
                            title="Add this SQL as a new notebook cell"
                        >
                            Add to Notebook
                        </button>
                    )}
                </div>
                <pre className="px-3 py-2 text-[11px] text-gray-300 whitespace-pre-wrap font-mono border-b border-gray-700 max-h-32 overflow-auto">{sql}</pre>
                <div className="max-h-56 overflow-auto">
                    <DataTable data={rows} headers={headers} showSearch={false} />
                </div>
            </div>
        );
    }

    if (toolName === 'previewPlot') {
        const sql = String(args?.sql ?? '');
        const plotConfig = String(result?.plotConfig ?? args?.plotConfig ?? '');
        const rows: any[] = Array.isArray(result?.rows) ? result.rows : [];
        const previewId: string | undefined = result?.previewId;
        const syntheticCell: NotebookCellData = {
            id: previewId ?? fallbackPreviewCellId,
            title: '',
            content: '```sql\n' + sql + '\n```\n```plot\n' + plotConfig + '\n```',
        };
        const combinedContent = '```sql\n' + sql + '\n```\n\n```plot\n' + plotConfig + '\n```';
        const fallbackMetadata: NotebookMetadata = metadata ?? { views: [], macros: [] };

        return (
            <div
                className="my-2 border border-gray-700 rounded bg-gray-800/60"
                data-preview-id={previewId}
            >
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700 text-[10px] uppercase tracking-wider text-gray-500">
                    <span>Plot preview · {rows.length} row{rows.length === 1 ? '' : 's'}</span>
                    {onAddToNotebook && (
                        <button
                            type="button"
                            onClick={() => onAddToNotebook('combined', combinedContent, plotConfig)}
                            className="px-2 py-0.5 text-[10px] bg-cyan-700/40 hover:bg-cyan-700/70 text-cyan-200 rounded"
                            title="Add this SQL + plot as a new notebook cell"
                        >
                            Add to Notebook
                        </button>
                    )}
                </div>
                <details className="border-b border-gray-700">
                    <summary className="px-3 py-1 text-[10px] text-gray-500 cursor-pointer hover:text-gray-300">Show SQL / DSL</summary>
                    <pre className="px-3 py-2 text-[11px] text-gray-300 whitespace-pre-wrap font-mono max-h-32 overflow-auto">{sql}{'\n\n'}{plotConfig}</pre>
                </details>
                <div className="px-2 py-2 h-[250px] overflow-hidden">
                    <PlotErrorBoundary
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
