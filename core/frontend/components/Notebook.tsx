
import React, { useRef, useMemo, useCallback, useState, useEffect } from 'react';
import type { NotebookCellData, NotebookMetadata } from '../types';
import NotebookCell from './NotebookCell';
import SettingsPanel from './SettingsPanel';
import { PlusIcon } from './icons/PlusIcon';
import SQLEditor from './SQLEditor';
import { NotebookTOC } from './NotebookTOC';
import { parseCellContent, parseCellDirective, requiresAttrToConditionSql, tokenizeCellContent } from '../utils/notebookParser';
import { cellHandle } from '../utils/cellHandle';
import { substituteVariables } from '../utils/variableSubstitution';

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
    /** When true, the tab bar is showing above the notebook — TOC button shifts down to avoid overlap. */
    tabBarVisible?: boolean;
    /** Extra pixels of banner height above the notebook content (each visible banner ~36px). TOC button shifts down by this amount. */
    bannerOffset?: number;
    /** Controlled TOC open state — owned by App so the header button can toggle it. */
    tocOpen?: boolean;
    onToggleTOC?: () => void;
    /** Forward to NotebookCell → InlineChat for "pop to sidebar" feature. */
    onPopChatToSidebar?: (snapshot: import('./ChatPanel').InlineChatSnapshot) => void;
    /** Forward to NotebookCell → InlineChat for reference link navigation. */
    onNavigateRef?: (ref: string) => void;
}

const _REQUIRES_EXPR_RE = /^SELECT\s+([\s\S]+)\s+FROM\s+information_schema\.tables$/i;
const _NORM_BRACES_RE = /\$\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g;

const Notebook: React.FC<NotebookProps> = (props) => {
    const {
        notebookMarkdown, setNotebookMarkdown, isMarkdownMode, isAutoRunEnabled, cells, metadata, results, queryTimings,
        collapseTrigger, allCollapsed, isAiFeatureActive, clearResultsTrigger, onRunQuery, onUpdateCell, onDeleteCell, onDuplicateCell, onDeleteQueryBlock,
        onAddCell, onAddCellFromTool, onMoveCell, onSuggestPlot, onFormatCode, onRunPreviewQuery, onMetadataChange,
        presenterMode = false, tabBarVisible = false, bannerOffset = 0, tocOpen: tocOpenProp, onToggleTOC, onPopChatToSidebar, onNavigateRef,
    } = props;

    const settingsPanelRef = useRef<{ focusVariable: (name: string) => void }>(null);
    const [tocOpenInternal, setTocOpenInternal] = useState(false);
    const tocOpen = tocOpenProp !== undefined ? tocOpenProp : tocOpenInternal;
    const handleCloseTOC = useCallback(() => {
        if (onToggleTOC && tocOpenProp) onToggleTOC();
        else setTocOpenInternal(false);
    }, [onToggleTOC, tocOpenProp]);

    // Persistent cache: cell content string → parsed directive. Avoids re-running the Ohm
    // grammar on unchanged cells when any single cell in the notebook is edited.
    const directiveStrCacheRef = useRef<Map<string, ReturnType<typeof parseCellDirective>>>(new Map());

    // Ctrl+Shift+T toggles TOC — delegate to App handler if controlled, else internal
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 't' || e.key === 'T')) {
                e.preventDefault();
                if (onToggleTOC) onToggleTOC();
                else setTocOpenInternal(prev => !prev);
            }
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [onToggleTOC]);

    // B-033: persist per-cell collapse state across raw-mode remounts.
    const cellCollapseStateRef = useRef<Map<string, boolean>>(new Map());
    const handleCellCollapseChange = useCallback((cellId: string, collapsed: boolean) => {
        cellCollapseStateRef.current.set(cellId, collapsed);
    }, []);

    // Stable empty array — avoids creating a new reference on every render for
    // cells that have no results yet, which would cause useEffect deps to fire.
    const emptyResults = useMemo(() => [], []);

    // cellConditions: evaluate each cell's SQL predicate to decide visibility.
    const [cellVisibility, setCellVisibility] = useState<Record<string, boolean | null | undefined>>({});

    // Cache parsed directives by cell content so parseCellDirective isn't called
    // repeatedly in the render loop and effect loops on unrelated state changes.
    const cellDirectives = useMemo(() => {
        const cache = directiveStrCacheRef.current;
        const map = new Map<string, ReturnType<typeof parseCellDirective>>();
        for (const c of cells) {
            let d = cache.get(c.content);
            if (d === undefined) {
                d = parseCellDirective(c.content);
                cache.set(c.content, d);
            }
            map.set(c.id, d);
        }
        if (cache.size > cells.length * 2) {
            const live = new Set<string>();
            for (const c of cells) live.add(c.content);
            for (const k of cache.keys()) { if (!live.has(k)) cache.delete(k); }
        }
        return map;
    }, [cells]);

    // Names of cells that have a `requires` attribute. Used in render to treat
    // cells not yet in cellVisibility as null (pending) instead of undefined
    // (visible), preventing a one-render window where auto-run fires before the
    // async visibility check populates the map.
    const cellsWithRequires = useMemo(() => {
        const set = new Set<string>();
        for (let idx = 0; idx < cells.length; idx++) {
            const c = cells[idx];
            const name = cellHandle(c, idx);
            const directive = cellDirectives.get(c.id);
            if (directive?.rest?.requires?.trim()) set.add(name);
        }
        return set;
    }, [cells, cellDirectives]);

    // Ref-stabilise onRunPreviewQuery so the visibility effect doesn't re-run
    // every time the underlying DuckDB query function gets a new reference
    // (which happens on every dbState change).
    const onRunPreviewQueryRef = useRef(onRunPreviewQuery);
    useEffect(() => { onRunPreviewQueryRef.current = onRunPreviewQuery; });

    useEffect(() => {
        // Build effective conditions: notebook-level cellConditions merged with
        // per-cell `requires=` attributes from <!-- @cell requires="Table1,Table2" -->.
        const namedConditions = metadata.cellConditions ?? {};
        const effective: Record<string, string> = { ...namedConditions };
        for (let idx = 0; idx < cells.length; idx++) {
            const c = cells[idx];
            const name = cellHandle(c, idx);
            if (effective[name]) continue; // notebook-level condition takes precedence
            const directive = cellDirectives.get(c.id);
            const reqAttr = directive?.rest?.requires;
            if (reqAttr?.trim()) {
                // If requires="some-name" resolves to a named condition, use that SQL directly.
                const namedSql = namedConditions[reqAttr.trim()];
                effective[name] = namedSql ?? requiresAttrToConditionSql(reqAttr);
            }
        }

        if (Object.keys(effective).length === 0) {
            setCellVisibility({});
            return;
        }
        // Mark all conditional cells as pending (null) immediately so
        // NotebookCell's auto-run doesn't fire before we know if they should run.
        const pending: Record<string, boolean | null | undefined> = {};
        for (let idx = 0; idx < cells.length; idx++) {
            const name = cellHandle(cells[idx], idx);
            if (name in effective) pending[name] = null;
        }
        setCellVisibility(pending);
        let cancelled = false;
        (async () => {
            const vars = metadata.variables ?? {};
            // Batch all grammar-compiled checks (SELECT <expr> FROM information_schema.tables)
            // into a single query, run raw-SELECT checks individually.
            type BatchEntry = { name: string; expr: string };
            type RawEntry  = { name: string; sql: string };
            const batchEntries: BatchEntry[] = [];
            const rawEntries: RawEntry[] = [];
            const normBraces = (s: string) => s.replace(_NORM_BRACES_RE, '$$$1');
            for (const [name, sql] of Object.entries(effective)) {
                const expanded = substituteVariables(normBraces(sql), vars);
                const m = _REQUIRES_EXPR_RE.exec(expanded.trim());
                if (m) {
                    batchEntries.push({ name, expr: m[1] });
                } else {
                    rawEntries.push({ name, sql: expanded });
                }
            }

            const next: Record<string, boolean | null | undefined> = { ...pending };

            if (batchEntries.length > 0 && !cancelled) {
                try {
                    const selectList = batchEntries.map((e, i) => `(${e.expr}) AS "_vis${i}"`).join(', ');
                    const rows = await onRunPreviewQueryRef.current(
                        `SELECT ${selectList} FROM information_schema.tables`,
                    );
                    const row = rows?.[0] ?? {};
                    batchEntries.forEach((e, i) => { next[e.name] = Boolean(row[`_vis${i}`]); });
                } catch {
                    batchEntries.forEach(e => { next[e.name] = true; });
                }
            }

            for (const { name, sql } of rawEntries) {
                if (cancelled) return;
                try {
                    const rows = await onRunPreviewQueryRef.current(sql);
                    next[name] = rows && rows.length > 0 ? (() => {
                        const v = Object.values(rows[0])[0];
                        if (v === null || v === undefined) return false;
                        if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
                        if (typeof v === 'string') return v.length > 0 && v.toLowerCase() !== 'false' && v !== '0';
                        if (typeof v === 'boolean') return v;
                        if (typeof v === 'bigint') return v !== 0n;
                        return true;
                    })() : false;
                } catch {
                    next[name] = true;
                }
            }

            if (!cancelled) setCellVisibility(next);
        })();
        return () => { cancelled = true; };
    // onRunPreviewQuery is intentionally omitted — captured via ref to prevent
    // re-runs on every DuckDB state change (dbState triggers new query reference).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cells, metadata.cellConditions, metadata.variables]);

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

    const prevCrossRef = useRef<Record<string, any[]>>({});
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
        // Return the previous object if the alias→data mapping is identical (same references).
        // This keeps prop references stable for cells that use crossCellQueryRefs,
        // so arePropsEqual short-circuits without needing to run areCrossCellRefsEqual.
        const prev = prevCrossRef.current;
        let same = true;
        for (const k in out) { if (out[k] !== prev[k]) { same = false; break; } }
        if (same) {
            for (const k in prev) { if (!(k in out)) { same = false; break; } }
        }
        if (same) return prev;
        prevCrossRef.current = out;
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
                            cells={cells}
                        />
                        {cells.map((cell, idx) => {
                            const name = cellHandle(cell, idx);
                            const rawVisibility = cellVisibility[name];
                            const visibility = rawVisibility === undefined && cellsWithRequires.has(name) ? null : rawVisibility;
                            const isConditionallyHidden = visibility === null ? undefined : (visibility === false ? true : false);
                            if (isConditionallyHidden) return null;
                            return (
                                <NotebookCell
                                    key={cell.id}
                                    cell={cell}
                                    cellIndex={idx}
                                    allCells={cells}
                                    metadata={metadata}
                                    results={results[cell.id] ?? emptyResults}
                                    queryTimings={queryTimings?.[cell.id]}
                                    crossCellQueryRefs={crossCellQueryRefs}
                                    isAutoRunEnabled={isAutoRunEnabled}
                                    collapseTrigger={collapseTrigger}
                                    allCollapsed={allCollapsed}
                                    isAiFeatureActive={isAiFeatureActive}
                                    initialCellCollapsed={cellCollapseStateRef.current.get(cell.id) ?? cellDirectives.get(cell.id)?.collapsed}
                                    isConditionallyHidden={false}
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
                        <HiddenCellsSection
                            cells={cells}
                            cellVisibility={cellVisibility}
                            cellsWithRequires={cellsWithRequires}
                            cellCollapseStateRef={cellCollapseStateRef}
                            cellDirectives={cellDirectives}
                            metadata={metadata}
                            results={results}
                            emptyResults={emptyResults}
                            queryTimings={queryTimings}
                            crossCellQueryRefs={crossCellQueryRefs}
                            isAutoRunEnabled={isAutoRunEnabled}
                            collapseTrigger={collapseTrigger}
                            allCollapsed={allCollapsed}
                            isAiFeatureActive={isAiFeatureActive}
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
                            handleGlobalVariableClick={handleGlobalVariableClick}
                            onMetadataChange={onMetadataChange}
                            presenterMode={presenterMode}
                            onPopChatToSidebar={onPopChatToSidebar}
                            onNavigateRef={onNavigateRef}
                            handleCellCollapseChange={handleCellCollapseChange}
                        />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="relative p-4 md:p-6 space-y-4">
            {/* TOC panel */}
            {tocOpen && !presenterMode && (
                <div
                    className={`fixed ${tabBarVisible ? 'right-10' : 'right-4'} z-40`}
                    style={{ top: `${48 + (tabBarVisible ? 34 : 0) + bannerOffset + 46}px` }}
                >
                    <NotebookTOC cells={cells} onClose={handleCloseTOC} />
                </div>
            )}
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
                    cells={cells}
                />
            )}
            {cells.map((cell, idx) => {
                const name = cellHandle(cell, idx);
                // undefined = not in the visibility map (no requires) → visible
                // null = pending requires check → block auto-run but don't hide visually
                // true = visible (requires satisfied)
                // false = hidden (requires not satisfied)
                // If a cell has requires but isn't in the map yet, treat as null (pending)
                // to prevent auto-run firing before the async check resolves.
                const rawVisibility = cellVisibility[name];
                const visibility = rawVisibility === undefined && cellsWithRequires.has(name) ? null : rawVisibility;
                const isConditionallyHidden = visibility === null ? undefined : (visibility === false ? true : false);
                if (isConditionallyHidden) return null;
                return (
                    <NotebookCell
                        key={cell.id}
                        cell={cell}
                        cellIndex={idx}
                        allCells={cells}
                        metadata={metadata}
                        results={results[cell.id] ?? emptyResults}
                        queryTimings={queryTimings?.[cell.id]}
                        crossCellQueryRefs={crossCellQueryRefs}
                        isAutoRunEnabled={isAutoRunEnabled}
                        collapseTrigger={collapseTrigger}
                        allCollapsed={allCollapsed}
                        isAiFeatureActive={isAiFeatureActive}
                        initialCellCollapsed={cellCollapseStateRef.current.get(cell.id) ?? cellDirectives.get(cell.id)?.collapsed}
                        isConditionallyHidden={false}
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
            <HiddenCellsSection
                cells={cells}
                cellVisibility={cellVisibility}
                cellsWithRequires={cellsWithRequires}
                cellCollapseStateRef={cellCollapseStateRef}
                cellDirectives={cellDirectives}
                metadata={metadata}
                results={results}
                emptyResults={emptyResults}
                queryTimings={queryTimings}
                crossCellQueryRefs={crossCellQueryRefs}
                isAutoRunEnabled={isAutoRunEnabled}
                collapseTrigger={collapseTrigger}
                allCollapsed={allCollapsed}
                isAiFeatureActive={isAiFeatureActive}
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
                handleGlobalVariableClick={handleGlobalVariableClick}
                onMetadataChange={onMetadataChange}
                presenterMode={presenterMode}
                onPopChatToSidebar={onPopChatToSidebar}
                onNavigateRef={onNavigateRef}
                handleCellCollapseChange={handleCellCollapseChange}
            />
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
                    <div className="flex items-center gap-1 bg-gray-800/60 border border-gray-700 rounded-lg p-1">                        <button
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
        </div>
    );
};

export default React.memo(Notebook);

type HiddenCellsSectionProps = {
    cells: NotebookCellData[];
    cellVisibility: Record<string, boolean | null | undefined>;
    cellsWithRequires: Set<string>;
    cellCollapseStateRef: React.MutableRefObject<Map<string, boolean>>;
    cellDirectives: Map<string, ReturnType<typeof parseCellDirective>>;
    metadata: NotebookMetadata;
    results: Record<string, (any[] | null)[]>;
    emptyResults: (any[] | null)[];
    queryTimings: Record<string, number[]> | undefined;
    crossCellQueryRefs: Record<string, any[]>;
    isAutoRunEnabled: boolean;
    collapseTrigger: number;
    allCollapsed: boolean;
    isAiFeatureActive: boolean;
    clearResultsTrigger: number;
    onRunQuery: any; onUpdateCell: any; onAddCellFromTool: any; onDeleteCell: any;
    onDeleteQueryBlock: any; onMoveCell: any; onSuggestPlot: any; onFormatCode: any;
    onRunPreviewQuery: any; handleGlobalVariableClick: any; onMetadataChange: any;
    presenterMode: boolean; onPopChatToSidebar: any; onNavigateRef: any;
    handleCellCollapseChange: any;
};

const HiddenCellsSection: React.FC<HiddenCellsSectionProps> = (props) => {
    const [open, setOpen] = React.useState(false);
    const hiddenCells = props.cells.filter((cell, idx) => {
        const name = cellHandle(cell, idx);
        const raw = props.cellVisibility[name];
        const vis = raw === undefined && props.cellsWithRequires.has(name) ? null : raw;
        return vis === false;
    });
    if (hiddenCells.length === 0) return null;
    return (
        <div className="border border-amber-800/30 rounded-lg bg-amber-950/10 mt-2">
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center gap-2 px-4 py-2 text-left text-xs text-amber-400/70 hover:text-amber-300 transition-colors"
                aria-expanded={open}
            >
                <span className="text-base leading-none">{open ? '▾' : '▸'}</span>
                <span className="font-medium">{hiddenCells.length} hidden view{hiddenCells.length !== 1 ? 's' : ''}</span>
                <span className="text-amber-600/60">— not applicable to the loaded file</span>
            </button>
            {open && (
                <div className="px-3 pb-3 space-y-2 border-t border-amber-800/20 pt-2">
                    {hiddenCells.map((cell) => {
                        const idx = props.cells.indexOf(cell);
                        return (
                            <NotebookCell
                                key={cell.id}
                                cell={cell}
                                cellIndex={idx}
                                allCells={props.cells}
                                metadata={props.metadata}
                                results={props.results[cell.id] ?? props.emptyResults}
                                queryTimings={props.queryTimings?.[cell.id]}
                                crossCellQueryRefs={props.crossCellQueryRefs}
                                isAutoRunEnabled={props.isAutoRunEnabled}
                                collapseTrigger={props.collapseTrigger}
                                allCollapsed={props.allCollapsed}
                                isAiFeatureActive={props.isAiFeatureActive}
                                initialCellCollapsed={props.cellCollapseStateRef.current.get(cell.id) ?? props.cellDirectives.get(cell.id)?.collapsed}
                                isConditionallyHidden={true}
                                onCellCollapseChange={props.handleCellCollapseChange}
                                clearResultsTrigger={props.clearResultsTrigger}
                                onRunQuery={props.onRunQuery}
                                onUpdateCell={props.onUpdateCell}
                                onAddCellFromTool={props.onAddCellFromTool}
                                onDeleteCell={props.onDeleteCell}
                                onDeleteQueryBlock={props.onDeleteQueryBlock}
                                onMoveCell={props.onMoveCell}
                                onSuggestPlot={props.onSuggestPlot}
                                onFormatCode={props.onFormatCode}
                                onRunPreviewQuery={props.onRunPreviewQuery}
                                onGlobalVariableClick={props.handleGlobalVariableClick}
                                onMetadataChange={props.onMetadataChange}
                                presenterMode={props.presenterMode}
                                onPopChatToSidebar={props.onPopChatToSidebar}
                                onNavigateRef={props.onNavigateRef}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
};
