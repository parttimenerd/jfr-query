
import React, { useRef, useMemo, useCallback, useState, useEffect } from 'react';
import type { NotebookCellData, NotebookMetadata } from '../types';
import NotebookCell from './NotebookCell';
import SettingsPanel from './SettingsPanel';
import { PlusIcon } from './icons/PlusIcon';
import SQLEditor from './SQLEditor';
import { parseCellContent, parseCellDirective, tablesToConditionSql, tokenizeCellContent } from '../utils/notebookParser';
import { cellHandle } from '../utils/cellHandle';
import { resolveCellVisibility } from '../utils/cellVisibility';
import { NotebookTOC } from './NotebookTOC';

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
    onDuplicateCell?: (cellId: string) => void;
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
        collapseTrigger, allCollapsed, isAiFeatureActive, clearResultsTrigger, onRunQuery, onUpdateCell, onDeleteCell, onDuplicateCell, onDeleteQueryBlock,
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

    // cellConditions: evaluate each cell's SQL predicate to decide visibility.
    const [cellVisibility, setCellVisibility] = useState<Record<string, boolean>>({});

    const [tocOpen, setTocOpen] = useState(false);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 't') {
                e.preventDefault();
                setTocOpen(prev => !prev);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    useEffect(() => {
        // Build effective conditions: notebook-level cellConditions merged with
        // per-cell `requires=` attributes from <!-- @cell requires="Table1,Table2" -->.
        const effective: Record<string, string> = { ...(metadata.cellConditions ?? {}) };
        for (let idx = 0; idx < cells.length; idx++) {
            const c = cells[idx];
            const name = cellHandle(c, idx);
            if (effective[name]) continue; // notebook-level condition takes precedence
            const directive = parseCellDirective(c.content);
            const reqAttr = directive?.rest?.requires;
            if (reqAttr) {
                const tables = reqAttr.split(',').map(t => t.trim()).filter(Boolean);
                if (tables.length > 0) effective[name] = tablesToConditionSql(tables);
            }
        }

        if (Object.keys(effective).length === 0) {
            setCellVisibility({});
            return;
        }
        let cancelled = false;
        (async () => {
            const next: Record<string, boolean> = {};
            for (let idx = 0; idx < cells.length; idx++) {
                const c = cells[idx];
                const name = cellHandle(c, idx);
                next[name] = await resolveCellVisibility(
                    name,
                    effective,
                    metadata.variables ?? {},
                    onRunPreviewQuery,
                );
            }
            if (!cancelled) setCellVisibility(next);
        })();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cells, metadata.cellConditions, metadata.variables, onRunPreviewQuery]);

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
                        {cells.map((cell, idx) => {
                            const name = cellHandle(cell, idx);
                            const visible = cellVisibility[name] ?? true;
                            return (
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
                                    isConditionallyHidden={!visible}
                                    onCellCollapseChange={handleCellCollapseChange}
                                    clearResultsTrigger={clearResultsTrigger}
                                    onRunQuery={onRunQuery}
                                    onUpdateCell={onUpdateCell}
                                    onAddCellFromTool={onAddCellFromTool}
                                    onDeleteCell={onDeleteCell}
                                    onDuplicateCell={onDuplicateCell}
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
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 space-y-4">
            {metadata.title && (
              <h1 className="text-2xl font-semibold mb-1">{metadata.title}</h1>
            )}
            {metadata.description && (
              <p className="text-sm text-gray-400 mb-2">{metadata.description}</p>
            )}
            {metadata.tags && metadata.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {metadata.tags.map(t => (
                  <span key={t} className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-100">
                    {t}
                  </span>
                ))}
              </div>
            )}
            {!presenterMode && (
                <SettingsPanel
                    ref={settingsPanelRef}
                    metadata={metadata}
                    onMetadataChange={onMetadataChange}
                    onRunPreviewQuery={onRunPreviewQuery}
                    isAiFeatureActive={isAiFeatureActive}
                />
            )}
            {cells.map((cell, idx) => {
                const name = cellHandle(cell, idx);
                const visible = cellVisibility[name] ?? true;
                return (
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
                        isConditionallyHidden={!visible}
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
                );
            })}
            {!presenterMode && cells.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-5 max-w-lg mx-auto">
                    <div className="text-gray-600 text-4xl">✦</div>
                    <div>
                        <h2 className="text-base font-semibold text-gray-300 mb-1">Notebook is empty</h2>
                        <p className="text-sm text-gray-500">Add a cell and write your first SQL query to get started.</p>
                    </div>
                    <button
                        onClick={() => onAddCellFromTool
                            ? onAddCellFromTool({ type: 'sql', content: 'SELECT\n  *\nFROM\n  ' })
                            : onAddCell()
                        }
                        className="flex items-center gap-2 px-5 py-2.5 bg-cyan-700 hover:bg-cyan-600 text-white rounded-lg transition-colors font-semibold text-sm"
                    >
                        <PlusIcon className="w-4 h-4" /> Add SQL Cell
                    </button>
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 w-full">
                        <div className="bg-gray-800/50 rounded p-2.5 text-left">
                            <div className="text-gray-300 font-medium mb-0.5">Quick query</div>
                            <div>Open the palette (<kbd className="font-mono text-[11px] bg-gray-700 border border-gray-600 px-1 rounded">⇧⇧</kbd>) and type <span className="font-mono text-yellow-400">!! SELECT …</span> to add a SQL cell instantly.</div>
                        </div>
                        <div className="bg-gray-800/50 rounded p-2.5 text-left">
                            <div className="text-gray-300 font-medium mb-0.5">AI-assisted</div>
                            <div>In the palette, type <span className="font-mono text-yellow-400">+ describe your query</span> to let AI write the cell for you.</div>
                        </div>
                    </div>
                </div>
            )}
            {!presenterMode && (
                <div className="flex justify-center py-4">
                    <div className="flex items-center gap-1 bg-gray-800/60 border border-gray-700 rounded-lg p-1">
                        <button
                            onClick={() => onAddCellFromTool
                                ? onAddCellFromTool({ type: 'sql', content: 'SELECT\n  *\nFROM\n  ' })
                                : onAddCell()
                            }
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-gray-400 hover:text-cyan-300 hover:bg-cyan-600/20 transition-colors text-sm font-medium"
                            title="Add SQL cell"
                        >
                            <PlusIcon className="w-4 h-4" /> SQL
                        </button>
                        <div className="w-px h-4 bg-gray-700" />
                        <button
                            onClick={() => onAddCellFromTool
                                ? onAddCellFromTool({ type: 'plot', content: 'TABLE()' })
                                : onAddCell()
                            }
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-gray-400 hover:text-cyan-300 hover:bg-cyan-600/20 transition-colors text-sm font-medium"
                            title="Add Plot / Table cell"
                        >
                            <PlusIcon className="w-4 h-4" /> Plot
                        </button>
                        <div className="w-px h-4 bg-gray-700" />
                        <button
                            onClick={() => onAddCellFromTool
                                ? onAddCellFromTool({ type: 'markdown', content: '## Notes\n\n' })
                                : onAddCell()
                            }
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-gray-400 hover:text-cyan-300 hover:bg-cyan-600/20 transition-colors text-sm font-medium"
                            title="Add Markdown notes cell"
                        >
                            <PlusIcon className="w-4 h-4" /> Markdown
                        </button>
                    </div>
                </div>
            )}
            {/* TOC toggle button */}
            <button
                onClick={() => setTocOpen(prev => !prev)}
                aria-label="Toggle table of contents"
                title="Table of Contents (Ctrl+Shift+T)"
                className="fixed bottom-6 right-6 z-40 p-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-300 hover:text-cyan-300 hover:border-cyan-500 shadow-lg transition-colors text-sm"
                style={{ lineHeight: 1 }}>
                ☰
            </button>

            {/* TOC panel */}
            {tocOpen && (
                <div className="fixed bottom-16 right-6 z-40">
                    <NotebookTOC cells={cells} onClose={() => setTocOpen(false)} />
                </div>
            )}
        </div>
    );
};

export default React.memo(Notebook);
