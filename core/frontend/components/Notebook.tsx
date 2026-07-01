
import React, { useRef, useMemo, useCallback } from 'react';
import type { NotebookCellData, NotebookMetadata } from '../types';
import NotebookCell from './NotebookCell';
import SettingsPanel from './SettingsPanel';
import { PlusIcon } from './icons/PlusIcon';
import SQLEditor from './SQLEditor';
import { parseCellContent, tokenizeCellContent } from '../utils/notebookParser';

interface NotebookProps {
    notebookMarkdown: string;
    setNotebookMarkdown: (markdown: string) => void;
    isMarkdownMode: boolean;
    isAutoRunEnabled: boolean;
    cells: NotebookCellData[];
    metadata: NotebookMetadata;
    results: Record<string, (any[] | null)[]>;
    queryTimings?: Record<string, (number | null)[]>;
    collapseTrigger: number;
    allCollapsed: boolean;
    isAiFeatureActive: boolean;
    /** Incremented on "Clear All Results" so cells can cancel pending auto-run timers. */
    clearResultsTrigger?: number;
    onRunQuery: (cellId: string, sql: string, queryIndex: number, allVariables: Record<string, string>) => void;
    onUpdateCell: (cellId: string, updatedContent: string) => void;
    onDeleteCell: (cellId: string) => void;
    onDeleteQueryBlock: (cellId: string, index: number) => void;
    onAddCell: () => void;
    /** C7 — tool-runtime addCell forwarded to InlineChat for AI-driven cell creation. */
    onAddCellFromTool?: (mut: { type: 'sql' | 'plot' | 'markdown'; content: string; afterCellId?: string }) => string | undefined;
    onMoveCell: (draggedId: string, targetId: string, position: 'before' | 'after') => void;
    onSuggestPlot: (sql: string, customPromptOverride?: string) => Promise<string | null>;
    onFormatCode: (code: string, type: 'sql' | 'plot') => Promise<string | null>;
    onRunPreviewQuery: (queryToRun: string) => Promise<any[]>;
    onMetadataChange: (newMetadata: NotebookMetadata) => Promise<void>;
    presenterMode?: boolean;
    /** Forward to NotebookCell → InlineChat for "pop to sidebar" feature. */
    onPopChatToSidebar?: (snapshot: import('./ChatPanel').InlineChatSnapshot) => void;
    /** Forward to NotebookCell → InlineChat for reference link navigation. */
    onNavigateRef?: (ref: string) => void;
}

const Notebook: React.FC<NotebookProps> = (props) => {
    const {
        notebookMarkdown, setNotebookMarkdown, isMarkdownMode, isAutoRunEnabled, cells, metadata, results, queryTimings,
        collapseTrigger, allCollapsed, isAiFeatureActive, clearResultsTrigger, onRunQuery, onUpdateCell, onDeleteCell, onDeleteQueryBlock,
        onAddCell, onAddCellFromTool, onMoveCell, onSuggestPlot, onFormatCode, onRunPreviewQuery, onMetadataChange,
        presenterMode = false, onPopChatToSidebar, onNavigateRef,
    } = props;

    const settingsPanelRef = useRef<{ focusVariable: (name: string) => void }>(null);

    // B-033: persist per-cell collapse state across raw-mode remounts.
    const cellCollapseStateRef = useRef<Map<string, boolean>>(new Map());
    const handleCellCollapseChange = useCallback((cellId: string, collapsed: boolean) => {
        cellCollapseStateRef.current.set(cellId, collapsed);
    }, []);

    // Stable empty array — avoids creating a new reference on every render for
    // cells that have no results yet, which would cause useEffect deps to fire.
    const emptyResults = useMemo(() => [], []);

    // B-161/cross-cell ON routing: build a map from SQL alias name → dataset so
    // plots in any cell can reference results from other cells via ON <alias>.
    // Keys are bare alias names (lowercase-normalised look-up, original casing stored).
    //
    // Split into two memos: parsed aliases only re-compute when cell content changes;
    // the final map re-computes when any result changes (but parse is already cached).
    // Per-cell parse cache keyed by cell object reference (same object = same content).
    const aliasCacheRef = useRef<WeakMap<object, (string | null)[]>>(new WeakMap());
    const cellAliasesByCell = useMemo((): Map<string, (string | null)[]> => {
        const out = new Map<string, (string | null)[]>();
        for (const cell of cells) {
            let aliases = aliasCacheRef.current.get(cell);
            if (!aliases) {
                const parsed = parseCellContent(tokenizeCellContent(cell.content));
                aliases = parsed.queryAliases as (string | null)[];
                aliasCacheRef.current.set(cell, aliases);
            }
            out.set(cell.id, aliases);
        }
        return out;
    }, [cells]);

    const crossCellQueryRefs = useMemo((): Record<string, any[]> => {
        const out: Record<string, any[]> = {};
        for (const cell of cells) {
            const aliases = cellAliasesByCell.get(cell.id);
            const cellResults = results[cell.id];
            if (!aliases || !cellResults) continue;
            aliases.forEach((alias, i) => {
                if (alias && cellResults[i]) {
                    out[alias] = cellResults[i]!;
                }
            });
        }
        return out;
    // Recompute when cell aliases or any result changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cellAliasesByCell, results]);

    const handleGlobalVariableClick = useCallback((variableName: string) => {
        settingsPanelRef.current?.focusVariable(variableName);
    }, []);

    if (isMarkdownMode) {
        return (
            <div className="flex h-full gap-0">
                <div className="w-1/2 h-full border-r border-gray-700 shrink-0">
                    <SQLEditor
                        value={notebookMarkdown}
                        onChange={setNotebookMarkdown}
                        mode="markdown"
                        fullHeight
                    />
                </div>
                <div className="w-1/2 h-full overflow-y-auto">
                    <div className="p-4 md:p-6 space-y-4">
                        <SettingsPanel
                            ref={settingsPanelRef}
                            metadata={metadata}
                            onMetadataChange={onMetadataChange}
                            onRunPreviewQuery={onRunPreviewQuery}
                            isAiFeatureActive={isAiFeatureActive}
                        />
                        {cells.map(cell => (
                            <NotebookCell
                                key={cell.id}
                                cell={cell}
                                allCells={cells}
                                metadata={metadata}
                                results={results[cell.id] ?? emptyResults}
                                queryTimings={queryTimings?.[cell.id]}
                                crossCellQueryRefs={crossCellQueryRefs}
                                isAutoRunEnabled={isAutoRunEnabled}
                                collapseTrigger={collapseTrigger}
                                allCollapsed={allCollapsed}
                                isAiFeatureActive={isAiFeatureActive}
                                initialCellCollapsed={cellCollapseStateRef.current.get(cell.id)}
                                onCellCollapseChange={handleCellCollapseChange}
                                clearResultsTrigger={clearResultsTrigger}
                                onRunQuery={onRunQuery}
                                onUpdateCell={onUpdateCell}
                                onAddCellFromTool={onAddCellFromTool}
                                onDeleteCell={onDeleteCell}
                                onDeleteQueryBlock={onDeleteQueryBlock}
                                onMoveCell={onMoveCell}
                                onSuggestPlot={onSuggestPlot}
                                onFormatCode={onFormatCode}
                                onRunPreviewQuery={onRunPreviewQuery}
                                onGlobalVariableClick={handleGlobalVariableClick}
                                onMetadataChange={onMetadataChange}
                                presenterMode={presenterMode}
                                onPopChatToSidebar={onPopChatToSidebar}
                                onNavigateRef={onNavigateRef}
                            />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 space-y-4">
            <SettingsPanel
                ref={settingsPanelRef}
                metadata={metadata}
                onMetadataChange={onMetadataChange}
                onRunPreviewQuery={onRunPreviewQuery}
                isAiFeatureActive={isAiFeatureActive}
            />
            {cells.map(cell => (
                <NotebookCell
                    key={cell.id}
                    cell={cell}
                    allCells={cells}
                    metadata={metadata}
                    results={results[cell.id] ?? emptyResults}
                    queryTimings={queryTimings?.[cell.id] ?? emptyResults as any}
                    crossCellQueryRefs={crossCellQueryRefs}
                    isAutoRunEnabled={isAutoRunEnabled}
                    collapseTrigger={collapseTrigger}
                    allCollapsed={allCollapsed}
                    isAiFeatureActive={isAiFeatureActive}
                    initialCellCollapsed={cellCollapseStateRef.current.get(cell.id)}
                    onCellCollapseChange={handleCellCollapseChange}
                    clearResultsTrigger={clearResultsTrigger}
                    onRunQuery={onRunQuery}
                    onUpdateCell={onUpdateCell}
                    onAddCellFromTool={onAddCellFromTool}
                    onDeleteCell={onDeleteCell}
                    onDeleteQueryBlock={onDeleteQueryBlock}
                    onMoveCell={onMoveCell}
                    onSuggestPlot={onSuggestPlot}
                    onFormatCode={onFormatCode}
                    onRunPreviewQuery={onRunPreviewQuery}
                    onGlobalVariableClick={handleGlobalVariableClick}
                    onMetadataChange={onMetadataChange}
                    presenterMode={presenterMode}
                    onPopChatToSidebar={onPopChatToSidebar}
                    onNavigateRef={onNavigateRef}
                />
            ))}
            <div className="flex justify-center py-4">
                <button
                    onClick={onAddCell}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-cyan-600/50 text-gray-300 hover:text-cyan-300 rounded-lg transition-colors font-semibold"
                >
                    <PlusIcon className="w-5 h-5" /> Add Cell
                </button>
            </div>
        </div>
    );
};

export default React.memo(Notebook);
