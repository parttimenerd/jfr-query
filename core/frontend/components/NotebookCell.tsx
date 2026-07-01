
import React, { useState, useCallback, useMemo, useRef, useEffect, useContext } from 'react';
import ReactMarkdown from 'react-markdown';
import type { NotebookCellData, NotebookMetadata } from '../types';
import { tokenizeCellContent, reconstructCellContent, parseCellContent, CellSegment, MarkdownSection } from '../utils/notebookParser';
import { cellHandle as computeCellHandle } from '../utils/cellHandle';
import { useCellAliases } from '../context/CellAliasContext';
import { DataContext } from '../context/DuckDBContext';
import { useExecutor } from '../context/ExecutorContext';
import TemplatedMarkdown from './TemplatedMarkdown';
import { collectPrecedingCellVariables } from '../utils/crossCellVariables';
import { substituteVariables, toSqlVariables } from '../utils/variableSubstitution';
import { expandBrushOperator } from '../services/variableExpander';
import { parsePlotCall } from '../utils/plotParser';
import { expandPlotConstants } from '../utils/plotConstants';
import { cleanDuckDBError, heuristicTip, parseCandidateBindings } from '../utils/sqlErrorMessage';
import { aiService } from '../services/AiService';

// Module-level cache so repeated identical errors (same sql + message) skip the
// API round-trip and show the suggestion instantly.
const aiErrorSuggestionCache = new Map<string, { text: string; code: string | null }>();
// Per-cell SQL-block count cache keyed by cell object reference.
const cellSqlCountCache = new WeakMap<object, number>();
import { NotebookPlotScope } from './editor/plot/notebookPlotScope';
import { SettingsContext } from '../context/SettingsContext';
import PlotSuggestionChip from './PlotSuggestionChip';
import { suggestPlot as runSuggestPlot, cancel as cancelSuggestPlot, type PlotSuggestionResult } from '../services/plotSuggestion';

import SQLEditor from './SQLEditor';
import PlotConfigEditor from './PlotConfigEditor';
import PlotRenderer from './PlotRenderer';
import InlineChat from './InlineChat';
import PlotHelpModal from './PlotHelpModal';
import StaticCodeHighlighter from './StaticCodeHighlighter';
import { TrashIcon } from './icons/TrashIcon';
import { ChevronUpIcon } from './icons/ChevronUpIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { CodeBracketIcon } from './icons/CodeBracketIcon';
import { EyeIcon } from './icons/EyeIcon';
import { Bars2Icon } from './icons/Bars2Icon';
import { PlusIcon } from './icons/PlusIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { PlayIcon } from './icons/PlayIcon';
import { ChatBubbleSparklesIcon } from './icons/ChatBubbleSparklesIcon';
import { InformationCircleIcon } from './icons/InformationCircleIcon';
import { DocumentFormattingIcon } from './icons/DocumentFormattingIcon';
import { ClipboardIcon } from './icons/ClipboardIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import CollapsibleBlock from './CollapsibleBlock';

interface NotebookCellProps {
    cell: NotebookCellData;
    allCells: NotebookCellData[];
    metadata: NotebookMetadata;
    results: (any[] | null)[];
    /** Parallel timing array — queryTimings[i] = elapsed ms for results[i], or null if not yet run / errored. */
    queryTimings?: (number | null)[];
    /**
     * Cross-cell query results keyed by SQL alias name. Populated by Notebook.tsx
     * from all sibling cells' named query blocks. Used to resolve plot ON-clause
     * references that point to SQL aliases in other cells.
     */
    crossCellQueryRefs?: Record<string, any[]>;
    isAutoRunEnabled: boolean;
    collapseTrigger: number;
    allCollapsed: boolean;
    isAiFeatureActive: boolean;
    /**
     * Incremented each time the user clicks "Clear All Results". When this
     * changes, the cell cancels all pending auto-run timers so they cannot
     * repopulate results immediately after the parent clears them.
     */
    clearResultsTrigger?: number;
    /** B-033: initial collapsed state lifted from Notebook.tsx so it survives raw-mode toggle. */
    initialCellCollapsed?: boolean;
    /** B-033: callback to persist cell-level collapse changes to the parent ref. */
    onCellCollapseChange?: (cellId: string, collapsed: boolean) => void;
    onRunQuery: (cellId: string, sql: string, queryIndex: number, allVariables: Record<string, string>) => void;
    /** C7 — tool-runtime callbacks forwarded into InlineChat so AI tool calls
     * can mutate other notebook cells. */
    onUpdateCell: (cellId: string, content: string) => void;
    onAddCellFromTool?: (mut: { type: 'sql' | 'plot' | 'markdown'; content: string; afterCellId?: string }) => string | undefined;
    onDeleteCell: (cellId: string) => void;
    onDeleteQueryBlock: (cellId: string, index: number) => void;
    onMoveCell: (draggedId: string, targetId: string, position: 'before' | 'after') => void;
    /** Forward to InlineChat so "pop to sidebar" can be triggered from a cell. */
    onPopChatToSidebar?: (snapshot: import('./ChatPanel').InlineChatSnapshot) => void;
    /** Forward to InlineChat / chat for reference link navigation. */
    onNavigateRef?: (ref: string) => void;
    onSuggestPlot: (sql: string, customPromptOverride?: string) => Promise<string | null>;
    onFormatCode: (code: string, type: 'sql' | 'plot') => Promise<string | null>;
    onRunPreviewQuery: (queryToRun: string) => Promise<any[]>;
    onGlobalVariableClick: (variableName: string) => void;
    onMetadataChange: (newMetadata: NotebookMetadata) => Promise<void>;
    presenterMode?: boolean;
}

function debounce<T extends (...args: any[]) => any>(func: T, delay: number): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;
  return function(this: any, ...args: Parameters<T>) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}

const MarkdownSectionEditor: React.FC<{ section: MarkdownSection | null; defaultTitle: string; onUpdate: (s: MarkdownSection | null) => void; onAdd: () => void; isEditing: boolean; onSetEditing: (isEditing: boolean) => void; variables?: Record<string, string>; formatSettings?: { timeFormat?: string; decimalPlaces?: number }; presenterMode?: boolean; }> = ({ section, defaultTitle, onUpdate, onAdd, isEditing, onSetEditing, variables, formatSettings, presenterMode }) => {
    const [content, setContent] = useState(section?.content || '');
    useEffect(() => { setContent(section?.content || ''); }, [section]);

    const handleBlur = () => {
        const newContent = content;
        onSetEditing(false);
        if (newContent.trim() === '') {
            onUpdate(null);
        } else {
            onUpdate({ title: section?.title || defaultTitle, content: newContent });
        }
    };

    const components = useMemo(() => ({ code: ({ node, className, children, ...props }: any) => { const m = /language-(\w+)/.exec(className||''); const isBlock = !!className; return isBlock&&(m?.[1]==='sql'||m?.[1]==='plot')?<div className="my-2 border border-gray-700 rounded-md overflow-hidden bg-[#263238]"><StaticCodeHighlighter code={String(children).trim()} language={m[1]}/></div>:<code className="bg-gray-700 text-cyan-300 p-1 rounded-md" {...props}>{children}</code>; } }), []);

    // Tokenize the section content so inline `${…}` and `{if …}` regions
    // evaluate at render time. Plain markdown is preserved 1:1 by the tokenizer.
    const renderSegments = useMemo(
        () => section ? tokenizeCellContent(section.content) : [],
        [section?.content],
    );

    if (!section) return presenterMode ? null : <div className="py-1"><button onClick={onAdd} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 px-1 py-0.5 rounded"><PlusIcon className="w-3 h-3"/> Add {defaultTitle}</button></div>;
    return <div>{isEditing ? <SQLEditor value={content} onChange={setContent} onBlur={handleBlur} mode="markdown" autoFocus/> : <div className="space-y-1"><div onClick={() => { if (!presenterMode) onSetEditing(true); }} className={`prose prose-invert max-w-none px-2 py-1 rounded-md min-h-[2rem] ${presenterMode ? '' : 'hover:bg-gray-700/30 cursor-pointer'}`}><TemplatedMarkdown segments={renderSegments} variables={variables ?? {}} formatSettings={formatSettings}/></div></div>}</div>;
};

const VariableEditor: React.FC<{ varKey: string; varValue: string; usedIn?: string[]; onChange: (o: string, n: string, v: string) => void; onDelete: (k: string) => void; inputRef: React.RefCallback<HTMLInputElement> }> = ({ varKey, varValue, usedIn, onChange, onDelete, inputRef }) => {
    const [key, setKey] = useState(varKey);
    const [value, setValue] = useState(varValue);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    useEffect(() => { setKey(varKey); setValue(varValue); }, [varKey, varValue]);
    return (
        <div className="space-y-0.5">
            <div className="flex items-center gap-2">
                <input type="text" value={key} onChange={e=>{setKey(e.target.value);}} onBlur={()=>{const valid=key.match(/^\$(?!\$)\w+/);if(!valid){setKey(varKey);}else if(key!==varKey){onChangeRef.current(varKey,key,value);}}} className={`w-1/3 bg-gray-800 border ${key.match(/^\$(?!\$)\w+/)?'border-gray-600':'border-red-500'} rounded-md p-1.5 text-sm font-mono text-cyan-300`} title="Cell-local variable: must start with $ (use $$ prefix in Notebook Settings for global scope)" aria-label="Cell-local variable: must start with $ (use $$ prefix in Notebook Settings for global scope)"/>
                <span className="text-gray-500">=</span>
                <input type="text" value={value} onChange={e=>{setValue(e.target.value);}} onBlur={()=>{if(value!==varValue)onChangeRef.current(varKey,key,value);}} className="flex-grow bg-gray-800 border border-gray-600 rounded-md p-1.5 text-sm font-mono" ref={inputRef}/>
                <button onClick={()=>onDelete(varKey)} className="p-1.5 text-gray-400 hover:text-red-400"><TrashIcon className="w-4 h-4"/></button>
            </div>
            {usedIn && usedIn.length > 0 && (
                <div className="pl-1 flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] text-gray-600">used in:</span>
                    {usedIn.map(ref => (
                        <span key={ref} className="text-[10px] px-1.5 py-0.5 bg-gray-700/60 text-gray-400 rounded font-mono">{ref}</span>
                    ))}
                </div>
            )}
        </div>
    );
};


const NotebookCell: React.FC<NotebookCellProps> = ({ cell, allCells, metadata, results, queryTimings, crossCellQueryRefs, isAutoRunEnabled, collapseTrigger, allCollapsed, isAiFeatureActive, initialCellCollapsed, onCellCollapseChange, clearResultsTrigger, onRunQuery, onUpdateCell, onAddCellFromTool, onDeleteCell, onDeleteQueryBlock, onMoveCell, onSuggestPlot, onFormatCode, onRunPreviewQuery, onMetadataChange, onGlobalVariableClick, presenterMode = false, onPopChatToSidebar, onNavigateRef }) => {
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editingTitleValue, setEditingTitleValue] = useState('');
    const [isRawEditing, setIsRawEditing] = useState(false);
    const [editingSection, setEditingSection] = useState<'intro' | 'conclusion' | null>(null);
    const [runningStates, setRunningStates] = useState<Record<number, boolean>>({});
    const [pendingRunStates, setPendingRunStates] = useState<Record<number, boolean>>({});
    const [collapsedStates, setCollapsedStates] = useState<Record<string, boolean>>({});
    const [activeChat, setActiveChat] = useState<string | null>(null);
    const [isPlotHelpModalOpen, setIsPlotHelpModalOpen] = useState(false);
    const [isBeingDragged, setIsBeingDragged] = useState(false);
    const [isDraggingOver, setIsDraggingOver] = useState<'top' | 'bottom' | null>(null);
    const [resultHeight, setResultHeight] = useState(250);
    const resultResizeRef = useRef<{ startY: number; startH: number } | null>(null);
    const resultHeightUserSet = useRef(false);
    const [copiedSql, setCopiedSql] = useState<number | null>(null);
    const variableInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
    const [focusVarName, setFocusVarName] = useState<string | null>(null);
    const { settings } = useContext(SettingsContext);
    const [plotSuggestions, setPlotSuggestions] = useState<Record<number, PlotSuggestionResult | null>>({});
    const [dismissedSuggestions, setDismissedSuggestions] = useState<Record<number, boolean>>({});
    const [aiErrorSuggestions, setAiErrorSuggestions] = useState<Record<number, { text: string; code: string | null } | null>>({});
    const [sparkleLoading, setSparkleLoading] = useState<Record<number, boolean>>({});
    const [editingBlockName, setEditingBlockName] = useState<{ type: 'sql' | 'plot'; idx: number; value: string } | null>(null);
    const [isCellCollapsed, setIsCellCollapsed] = useState(() => initialCellCollapsed ?? false);

    const [segments, setSegments] = useState(() => tokenizeCellContent(cell.content));
    const parsed = useMemo(() => parseCellContent(segments), [segments]);

    useEffect(() => { setSegments(tokenizeCellContent(cell.content)); }, [cell.content]);

    useEffect(() => {
        if (collapseTrigger > 0) {
            setIsCellCollapsed(allCollapsed);
            onCellCollapseChange?.(cell.id, allCollapsed);
        }
    }, [collapseTrigger]);

    // Auto-size the result panel to fit small result sets (avoids excess whitespace for 1-row tables).
    // Skipped once the user has manually dragged the resize handle.
    useEffect(() => {
        if (resultHeightUserSet.current) return;
        const firstResult = results?.[0];
        if (!firstResult || firstResult.length === 0) return;
        const rowPx = 36;
        const overhead = 44 + 44; // search bar + header row
        const fitted = Math.min(250, overhead + firstResult.length * rowPx + 16);
        setResultHeight(Math.max(120, fitted));
    }, [results]);
    
    useEffect(() => { if (focusVarName && variableInputRefs.current[focusVarName]) { variableInputRefs.current[focusVarName]?.focus(); setFocusVarName(null); } }, [focusVarName, parsed.variables]);

    const onUpdateCellRef = useRef(onUpdateCell); onUpdateCellRef.current = onUpdateCell;

    const debouncedOnUpdate = useCallback(debounce((newSegments: CellSegment[]) => { onUpdateCellRef.current(cell.id, reconstructCellContent(newSegments)); }, 800), [cell.id]);

    const handleSegmentsUpdate = useCallback((newSegments: CellSegment[]) => { setSegments(newSegments); debouncedOnUpdate(newSegments); }, [debouncedOnUpdate]);

    const handleIntroUpdate = useCallback((intro: MarkdownSection | null) => {
        const newContent = intro?.content || '';
        // Re-prepend the ## title heading that parseCellContent strips from intro display content.
        const titlePrefix = parsed.title ? `## ${parsed.title}\n\n` : '';
        const fullContent = newContent.trim() === '' ? '' : `${titlePrefix}${newContent}`;
        const newIntroSegments: CellSegment[] = (fullContent.trim() === '') ? [] : [{ type: 'markdown', content: fullContent }];
        
        let firstNonMarkdownIdx = segments.findIndex(s => s.type !== 'markdown');
        if (firstNonMarkdownIdx === -1) firstNonMarkdownIdx = segments.length;
        
        const otherSegments = segments.slice(firstNonMarkdownIdx);

        if (newIntroSegments.length === 0 && otherSegments.length === 0) {
            handleSegmentsUpdate([{ type: 'markdown', content: '' }]);
            return;
        }

        const newSegments = [...newIntroSegments, ...otherSegments];
        handleSegmentsUpdate(newSegments);
    }, [segments, handleSegmentsUpdate, parsed.title]);

    const handleConclusionUpdate = useCallback((conclusion: MarkdownSection | null) => {
        const newContent = conclusion?.content || '';
        const newConclusionSegments: CellSegment[] = (newContent.trim() === '') ? [] : [{ type: 'markdown', content: newContent }];

        let lastNonMarkdownIdx = -1;
        for (let i = segments.length - 1; i >= 0; i--) {
            if (segments[i].type !== 'markdown') {
                lastNonMarkdownIdx = i;
                break;
            }
        }
        
        const coreAndIntroSegments = lastNonMarkdownIdx === -1 ? [] : segments.slice(0, lastNonMarkdownIdx + 1);
        
        const newSegments = [...coreAndIntroSegments, ...newConclusionSegments];
        handleSegmentsUpdate(newSegments);
    }, [segments, handleSegmentsUpdate]);

    const title = parsed.title || cell.title;

    const precedingCellVariables = useMemo(
        () => collectPrecedingCellVariables(allCells, cell.id),
        [allCells, cell.id],
    );

    const allVariables = useMemo(
        () => ({ ...metadata.variables, ...precedingCellVariables, ...parsed.variables }),
        [metadata.variables, precedingCellVariables, parsed.variables],
    );

    // P7 — Notebook-wide plot scope (named plots, query refs, variables, brushes).
    // The scope is rebuilt only when the cells array reference changes or the
    // current cell id changes; the internal `NotebookPlotScope` cache short-
    // circuits identical inputs.
    const plotScopeRef = useRef(new NotebookPlotScope());
    const plotScopeView = useMemo(
        () => plotScopeRef.current.build({
            cells: allCells,
            currentCellId: cell.id,
            workspaceVariables: allVariables,
        }),
        [allCells, cell.id, allVariables],
    );
    // Aggregate SQL block count across all cells (fallback used by `#N` hints
    // when the rich scope is unavailable).
    const totalSqlBlockCount = useMemo(() => {
        let n = 0;
        for (const c of allCells) {
            let count = cellSqlCountCache.get(c);
            if (count === undefined) {
                const m = c.content.match(/```sql\b/gi);
                count = m ? m.length : 0;
                cellSqlCountCache.set(c, count);
            }
            n += count;
        }
        return n;
    }, [allCells]);

    // Stable per-block error specs keyed on the error string. Without memoization,
    // building these inline at render time creates a fresh object every parent
    // render, so the editor's setError effect re-fires on every keystroke elsewhere.
    const errSpecs = useMemo(() => {
        return parsed.sqlBlocks.map((_, i) => {
            const raw = results[i]?.[0]?.error;
            if (!raw) return null;
            const msg = String(raw);
            const lineM = msg.match(/LINE\s+(\d+)(?::\s*(\d+))?/i);
            // DuckDB's error block looks like:
            //   LINE 1: SELECT badCol FROM Foo
            //                  ^
            // The caret line's `^` position (relative to start-of-line) minus the
            // "LINE N: " prefix gives the 1-based column of the offending token.
            const caretM = msg.match(/LINE\s+\d+:[^\n]*\n([^\n]*\^)/);
            let column: number | undefined = lineM && lineM[2] ? Number(lineM[2]) : undefined;
            if (column === undefined && caretM) {
                const prefix = msg.match(/LINE\s+\d+:\s?/)?.[0] ?? 'LINE 1: ';
                const caretPos = caretM[1].indexOf('^');
                column = Math.max(1, caretPos - prefix.length + 1);
            }
            // The `-- alias` line is stripped before DuckDB sees the query,
            // so DuckDB's LINE N is offset by 1 from what the editor shows.
            const aliasOffset = parsed.queryAliases[i] ? 1 : 0;
            return {
                message: cleanDuckDBError(msg),
                line: lineM ? Number(lineM[1]) + aliasOffset : undefined,
                column,
            };
        });
        // Depend on a stable serialization of the error strings to avoid
        // variable-length spread in the deps array (rules-of-hooks violation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [parsed.sqlBlocks.length, parsed.queryAliases, results]);

    // Auto-plot suggestion: when an SQL block completes with non-empty rows AND
    // doesn't yet have a plot block, ask the configured plot model to suggest one.
    useEffect(() => {
        if (!settings.autoPlotSuggestionEnabled) return;
        parsed.sqlBlocks.forEach((sql, i) => {
            const rows = results[i];
            if (!rows || rows.length === 0) return;
            if (rows[0]?.error) return;
            if (parsed.plotBlocks[i] && parsed.plotBlocks[i].trim()) return;
            if (dismissedSuggestions[i]) return;
            if (plotSuggestions[i] !== undefined) return;
            const columns = Object.keys(rows[0] ?? {});
            if (columns.length === 0) return;
            // Mark inflight to avoid re-firing every render.
            setPlotSuggestions(prev => ({ ...prev, [i]: null }));
            runSuggestPlot({ sql, columns, rowCount: rows.length }, { settings })
                .then(result => setPlotSuggestions(prev => ({ ...prev, [i]: result })))
                .catch(() => setPlotSuggestions(prev => ({ ...prev, [i]: null })));
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settings.autoPlotSuggestionEnabled, parsed.sqlBlocks.length, parsed.plotBlocks.join(' '), results]);

    useEffect(() => () => cancelSuggestPlot(), []);

    // Fetch AI-generated fix suggestions for SQL errors when AI is active.
    // Resets on results change (new run) or AI feature toggle.
    useEffect(() => {
        if (!isAiFeatureActive || !aiService.isInitialized()) {
            setAiErrorSuggestions({});
            return;
        }
        errSpecs.forEach((spec, i) => {
            if (!spec) {
                setAiErrorSuggestions(prev => { if (prev[i] !== undefined) { const n = { ...prev }; delete n[i]; return n; } return prev; });
                return;
            }
            // Skip if we already have a suggestion for this error text.
            if (aiErrorSuggestions[i] !== undefined) return;
            const sql = parsed.sqlBlocks[i] ?? '';
            const errorText = spec.message;
            const cacheKey = `${sql}::${errorText}`;
            // Return cached suggestion immediately — no API call needed.
            const cached = aiErrorSuggestionCache.get(cacheKey);
            if (cached) {
                setAiErrorSuggestions(prev => ({ ...prev, [i]: cached }));
                return;
            }
            // Mark inflight.
            setAiErrorSuggestions(prev => ({ ...prev, [i]: null }));
            aiService.getAiInlineSuggestion(
                `Fix this SQL error: ${errorText}`,
                'sql',
                sql,
                '',
                undefined,
                undefined,
                undefined,
                'no-data',
                null,
                'basic',
            ).then(res => {
                // Store the explanation text and the fixed code (if any) for "Apply" button.
                const text = res.text ?? '';
                const suggestion = text.trim() ? { text: text.trim(), code: res.code ?? null } : null;
                if (suggestion) aiErrorSuggestionCache.set(cacheKey, suggestion);
                setAiErrorSuggestions(prev => ({ ...prev, [i]: suggestion }));
            }).catch(() => {
                setAiErrorSuggestions(prev => ({ ...prev, [i]: null }));
            });
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAiFeatureActive, errSpecs]);

    // For each cell-local variable, compute which SQL/plot blocks reference it.
    const variableUsage = useMemo<Record<string, string[]>>(() => {
        const usage: Record<string, string[]> = {};
        for (const varKey of Object.keys(parsed.variables || {})) {
            const refs: string[] = [];
            const pattern = new RegExp(`\\${varKey.replace(/\$/g, '\\$')}\\b`);
            parsed.sqlBlocks.forEach((sql, i) => { if (pattern.test(sql)) refs.push(`Query ${i + 1}`); });
            // Use plotBlocksWithSqlIndex (dense, sequential) rather than plotBlocks
            // (sparse, SQL-indexed) so "Plot N" labels match what the user sees (B-100).
            parsed.plotBlocksWithSqlIndex.forEach((pb, i) => { if (pattern.test(pb.config)) refs.push(`Plot ${i + 1}`); });
            usage[varKey] = refs;
        }
        return usage;
    }, [parsed.variables, parsed.sqlBlocks, parsed.plotBlocksWithSqlIndex]);

    const [isVariablesCollapsed, setIsVariablesCollapsed] = useState(Object.keys(parsed.variables || {}).length === 0);

    const handleCellVariableChange = useCallback((newVars: Record<string, string>) => {
        const content = '\n' + Object.entries(newVars).map(([k, v]) => `${k} = ${v}`).join('\n') + '\n';
        const newSegments = [...segments];
        const varIndex = newSegments.findIndex(s => s.type === 'variables');
        if (varIndex !== -1) {
            if (Object.keys(newVars).length > 0) {
                 newSegments[varIndex] = { type: 'variables', content };
            } else {
                 newSegments.splice(varIndex, 1);
                 if (newSegments[varIndex] && newSegments[varIndex].type === 'markdown' && newSegments[varIndex].content.trim() === '') {
                     newSegments.splice(varIndex, 1);
                 }
            }
        } else if (Object.keys(newVars).length > 0) {
            newSegments.unshift({ type: 'variables', content }, { type: 'markdown', content: '\n\n' });
        }
        handleSegmentsUpdate(newSegments);
    }, [segments, handleSegmentsUpdate]);

    useEffect(() => { if (Object.keys(parsed.variables || {}).length === 0) setIsVariablesCollapsed(true); }, [parsed.variables]);
    useEffect(() => { if (collapseTrigger > 0) { const newStates: Record<string, boolean> = {}; parsed.sqlBlocks.forEach((_, i) => newStates[`sql-${i}`] = allCollapsed); parsed.plotBlocks.forEach((_, i) => newStates[`plot-${i}`] = allCollapsed); setCollapsedStates(newStates); setIsVariablesCollapsed(allCollapsed); } }, [collapseTrigger, allCollapsed, parsed.sqlBlocks, parsed.plotBlocks]);

    const prevSqlBlocksRef = useRef<string[]>([]);
    const prevVariablesRef = useRef<Record<string, string>>({});
    const runTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

    const handleResultResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        resultHeightUserSet.current = true;
        resultResizeRef.current = { startY: e.clientY, startH: resultHeight };
        const onMove = (ev: MouseEvent) => {
            if (!resultResizeRef.current) return;
            const newH = Math.max(120, resultResizeRef.current.startH + ev.clientY - resultResizeRef.current.startY);
            setResultHeight(newH);
        };
        const onUp = () => {
            resultResizeRef.current = null;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, [resultHeight]);

    const handleCopySql = useCallback((sql: string, index: number) => {
        navigator.clipboard.writeText(sql).then(() => {
            setCopiedSql(index);
            setTimeout(() => setCopiedSql(null), 1500);
        }).catch(() => {});
    }, []);

    const { registerAlias, unregisterCell } = useCellAliases();
    const { aliases } = useCellAliases();
    const { query: dbQuery, refreshSchema } = useContext(DataContext);
    // Phase 5 — DATASET clause results, keyed by `<plotIndex>:<datasetName>`.
    const [datasetResults, setDatasetResults] = useState<Record<string, any[]>>({});
    const { awaitUpstream } = useExecutor();
    const cellIndex = useMemo(() => allCells.findIndex(c => c.id === cell.id), [allCells, cell.id]);
    const handleStr = useMemo(() => computeCellHandle(cell, Math.max(0, cellIndex)), [cell, cellIndex]);

    // Phase 5 — fetch data for plots that declare a `DATASET <name>` clause.
    // Re-runs whenever the parsed plot blocks change or any alias bumps version.
    // Empty / unknown / non-identifier dataset names produce no entry; the
    // renderer falls back to its existing query-result lookup.
    const aliasVersionSum = useMemo(
        () => Object.values(aliases).reduce((s, a) => s + a.version, 0),
        [aliases],
    );
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const next: Record<string, any[]> = {};
            for (let pi = 0; pi < parsed.plotBlocks.length; pi++) {
                const config = parsed.plotBlocks[pi];
                if (!config || !config.trim()) continue;
                try {
                    const expanded = expandPlotConstants(config);
                    const firstConfig = expanded.expanded.split(/\n\s*\n/)[0].trim();
                    const parsed2 = parsePlotCall(firstConfig);
                    if (!parsed2.dataset) continue;
                    const name = parsed2.dataset;
                    if (!/^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)?$/.test(name)) continue;
                    const parts = name.split('.');
                    const ident = parts.map(p => `"${p.replace(/"/g, '""')}"`).join('.');
                    const rows = await dbQuery(`SELECT * FROM ${ident}`);
                    if (cancelled) return;
                    next[`${pi}:${name}`] = rows ?? [];
                } catch { /* renderer falls back to query-result data */ }
            }
            if (!cancelled) setDatasetResults(next);
        })();
        return () => { cancelled = true; };
    }, [parsed.plotBlocks, aliasVersionSum, dbQuery]);

    const handleRun = useCallback(async (sql: string, index: number) => {
        if (runTimersRef.current[index]) clearTimeout(runTimersRef.current[index]);
        setPendingRunStates(s => ({ ...s, [index]: false }));
        setRunningStates(s => ({ ...s, [index]: true }));
        try {
            // Wait for any upstream cells (cells producing aliases referenced
            // by this SQL) to finish first. Forward references are resolved
            // here: this is what makes topo-order possible regardless of
            // document position.
            await awaitUpstream(cell.id);
            // Expand brush shorthand (WHERE ts IN $x.brush → BETWEEN lo AND hi)
            // before variable substitution so unresolved brushes produce a clear
            // "unresolved variable" skip rather than a DuckDB syntax error.
            const expandedSql = expandBrushOperator(sql, allVariables);
            const substitutedSql = substituteVariables(expandedSql, toSqlVariables(allVariables));
            await onRunQuery(cell.id, substitutedSql, index, allVariables);
            const aliasName = parsed.queryAliases[index] ?? null;
            const materialized = !!parsed.queryAliasMaterialized?.[index];
            // Fire-and-forget: don't block the UI, and don't surface alias
            // registration errors into the cell's result panel (the result
            // panel still shows the actual query output via onRunQuery).
            // B-096: refresh schema after alias registration so the new temp
            // view shows up in SQL completions on the next keystroke.
            registerAlias({
                cellId: cell.id,
                cellHandle: handleStr,
                cellIndex: Math.max(0, cellIndex),
                sqlIndex: index,
                alias: aliasName,
                sql: substitutedSql,
                materialized,
            }).then(() => refreshSchema()).catch(() => { /* swallow */ });
        } finally {
            setRunningStates(s => ({ ...s, [index]: false }));
        }
    }, [onRunQuery, cell.id, allVariables, parsed.queryAliases, parsed.queryAliasMaterialized, registerAlias, refreshSchema, handleStr, cellIndex, awaitUpstream]);

    useEffect(() => () => { unregisterCell(cell.id).catch(() => {}); }, [cell.id, unregisterCell]);

    useEffect(() => {
        const prevSqls = prevSqlBlocksRef.current;
        const prevVars = prevVariablesRef.current;
        if (!isAutoRunEnabled) {
            Object.values(runTimersRef.current).forEach(clearTimeout); runTimersRef.current = {}; setPendingRunStates({});
            prevSqlBlocksRef.current = parsed.sqlBlocks;
            prevVariablesRef.current = allVariables;
            return;
        }

        const variablesChanged = (() => {
            if (prevVars === allVariables) return false;
            const prevKeys = Object.keys(prevVars ?? {});
            const nextKeys = Object.keys(allVariables);
            if (prevKeys.length !== nextKeys.length) return true;
            for (const k of nextKeys) {
                if ((prevVars as any)?.[k] !== (allVariables as any)[k]) return true;
            }
            return false;
        })();
        // Build a set of custom view/macro names so we can detect when a cell's SQL
        // uses a view whose body references a metadata variable (B-012).
        const customNames = new Set([
            ...(metadata.views || []).map(v => v.name).filter(Boolean),
            ...(metadata.macros || []).map(m => m.name).filter(Boolean),
        ]);

        parsed.sqlBlocks.forEach((sql, i) => {
            const sqlChanged = sql.trim() && sql !== prevSqls?.[i];
            const usesVariables = /\$\$?\w+/.test(sql);
            const usesCustomView = variablesChanged && customNames.size > 0 &&
                [...customNames].some(n => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(sql));
            const needsRun = sqlChanged || (usesVariables && variablesChanged) || usesCustomView;
            if (needsRun) {
                // Gate: skip auto-run if the SQL looks unrunnable to avoid noise
                // while the user is still typing (e.g. trailing comma, unclosed paren).
                const trimmed = sql.trim();
                const hasKeyword = /\b(SELECT|WITH|FROM|CALL|PRAGMA|SHOW)\b/i.test(trimmed);
                const parenDepth = [...trimmed].reduce((d, c) => d + (c === '(' ? 1 : c === ')' ? -1 : 0), 0);
                const trailingComma = /,\s*$/.test(trimmed);
                const isPlaceholder = /\.\.\.|<[^>]+>/.test(trimmed);
                if (!hasKeyword || parenDepth !== 0 || trailingComma || isPlaceholder) {
                    // Unresolved variables are also fine to skip early — they'd just error.
                    return;
                }
                if (runTimersRef.current[i]) clearTimeout(runTimersRef.current[i]);
                setPendingRunStates(s=>({...s,[i]:true}));
                runTimersRef.current[i] = setTimeout(() => {
                    delete runTimersRef.current[i];
                    setPendingRunStates(s=>({...s,[i]:false}));
                    handleRun(sql, i);
                }, 1500);
            }
        });
        for (let i = parsed.sqlBlocks.length; i < (prevSqls?.length || 0); i++) if(runTimersRef.current[i]) { clearTimeout(runTimersRef.current[i]); delete runTimersRef.current[i]; }
        prevSqlBlocksRef.current = parsed.sqlBlocks;
        prevVariablesRef.current = allVariables;
        return () => {
            // Effect cleanup: cancel any pending timers and forget them, AND
            // forget what we last scheduled. React StrictMode runs this
            // cleanup on every effect re-run (and on the dev-only fake
            // unmount). If we didn't reset the prev refs here, the post-
            // cleanup re-run would see prevSqls === currentSqls and treat
            // SQL as "unchanged", so the just-cancelled auto-run would never
            // be re-scheduled.
            for (const k of Object.keys(runTimersRef.current)) {
                clearTimeout(runTimersRef.current[k as unknown as number]);
                delete runTimersRef.current[k as unknown as number];
            }
            prevSqlBlocksRef.current = [];
            prevVariablesRef.current = {};
        };
    }, [parsed.sqlBlocks, allVariables, metadata, handleRun, isAutoRunEnabled]);

    useEffect(() => () => { Object.values(runTimersRef.current).forEach(clearTimeout); }, []);

    // Cancel pending auto-run timers when the parent clears all results so the
    // cleared state is not immediately overwritten by a scheduled re-run.
    useEffect(() => {
        if (!clearResultsTrigger) return;
        Object.values(runTimersRef.current).forEach(clearTimeout);
        runTimersRef.current = {};
        setPendingRunStates({});
        prevSqlBlocksRef.current = [];
    }, [clearResultsTrigger]);

    const toggleCollapse = (key: string) => setCollapsedStates(prev => ({ ...prev, [key]: !prev[key] }));
    
    const handleSqlChange = useCallback((newSql: string, index?: number) => {
        if (typeof index !== 'number') return;
        let sqlBlockCount = -1;
        const newSegments = segments.map(seg => {
            if (seg.type === 'sql') {
                sqlBlockCount++;
                if (sqlBlockCount === index) return { ...seg, content: newSql };
            }
            return seg;
        });
        handleSegmentsUpdate(newSegments);
    }, [segments, handleSegmentsUpdate]);

    const handlePlotChange = useCallback((newConfig: string, index?: number) => {
        if (typeof index !== 'number') return;
        
        let sqlBlockCount = -1;
        let sqlSegmentIndex = -1;
        for(let i = 0; i < segments.length; i++) {
            if (segments[i].type === 'sql') {
                sqlBlockCount++;
                if (sqlBlockCount === index) {
                    sqlSegmentIndex = i;
                    break;
                }
            }
        }
        if (sqlSegmentIndex === -1) return;

        let plotSegmentIndex = -1;
        for (let i = sqlSegmentIndex + 1; i < segments.length; i++) {
            if (segments[i].type === 'plot') {
                plotSegmentIndex = i;
                break;
            }
            if (segments[i].type === 'sql') break;
        }

        const newSegments = [...segments];
        if (plotSegmentIndex !== -1) {
            const existing = newSegments[plotSegmentIndex];
            if (existing.type !== 'if') {
                newSegments[plotSegmentIndex] = { ...existing, content: newConfig };
            }
        } else {
             let insertIndex = sqlSegmentIndex + 1;
             while(insertIndex < newSegments.length && newSegments[insertIndex].type === 'markdown') {
                 insertIndex++;
             }
             newSegments.splice(insertIndex, 0, {type: 'plot', content: newConfig}, {type: 'markdown', content: '\n\n'});
        }
        handleSegmentsUpdate(newSegments);
    }, [segments, handleSegmentsUpdate]);


    const handleRawContentChange = useCallback((newContent: string) => {
        const newSegments = tokenizeCellContent(newContent);
        setSegments(newSegments);
        debouncedOnUpdate(newSegments);
    }, [debouncedOnUpdate]);

    const handleSuggest = async (sql: string, index: number) => { const s = await onSuggestPlot(sql, metadata.customSystemPrompt); if (s) handlePlotChange(s, index); };
    const handleSparkle = async (plotIdx: number, sqlIdx: number) => {
        const sqlContent = parsed.sqlBlocks[sqlIdx] ?? '';
        if (!sqlContent.trim() || sparkleLoading[plotIdx]) return;
        setSparkleLoading(p => ({ ...p, [plotIdx]: true }));
        try {
            const suggestion = await onSuggestPlot(sqlContent, metadata.customSystemPrompt);
            if (suggestion) handlePlotChange(suggestion, sqlIdx);
        } finally {
            setSparkleLoading(p => ({ ...p, [plotIdx]: false }));
        }
    };

    const handleDeletePlot = useCallback((segmentIndex: number) => {
        const newSegments = [...segments];
        newSegments.splice(segmentIndex, 1);
        handleSegmentsUpdate(newSegments);
    }, [segments, handleSegmentsUpdate]);

    const handleDeleteMarkdown = useCallback((segmentIndex: number) => {
        const newSegments = [...segments];
        newSegments.splice(segmentIndex, 1);
        handleSegmentsUpdate(newSegments);
    }, [segments, handleSegmentsUpdate]);
    const handleFormat = async (code: string, type: 'sql' | 'plot', index: number) => { const f = await onFormatCode(code, type); if (f) { if(type==='sql') handleSqlChange(f, index); else handlePlotChange(f, index); } };
    const handleAddSql = () => handleSegmentsUpdate([...segments, {type: 'markdown', content: '\n\n'}, {type: 'sql', content: '\nSELECT 1;\n'}]);
    const handleInsertAt = useCallback((segmentIndex: number, type: 'sql' | 'plot' | 'markdown') => {
        const content = type === 'sql' ? '\nSELECT 1;\n' : type === 'plot' ? '\nTABLE()\n' : '';
        const newSegments = [...segments];
        newSegments.splice(segmentIndex, 0, { type, content } as CellSegment);
        handleSegmentsUpdate(newSegments);
    }, [segments, handleSegmentsUpdate]);
    const handleAddPlot = () => { /* No-op, plot change creates plot blocks */ };
    const handleTitleBlur = (newTitle: string) => { setIsEditingTitle(false); if (newTitle.trim() && newTitle !== title) { const introSegmentIndex = segments.findIndex(s=>s.type==='markdown'); if(introSegmentIndex!==-1){const newSegments=[...segments]; const intro=newSegments[introSegmentIndex]; if(intro.type==='if') return; const newContent=intro.content.replace(/^(?:#|##|###)\s*(.*)/,`## ${newTitle}`); newSegments[introSegmentIndex]={...intro, content:newContent}; handleSegmentsUpdate(newSegments);} }};
    const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { handleTitleBlur(editingTitleValue); } else if (e.key === 'Escape') { setIsEditingTitle(false); } };
    const handleDragStart = (e: React.DragEvent) => { e.dataTransfer.setData('text/plain', cell.id); e.dataTransfer.effectAllowed = 'move'; setIsBeingDragged(true); };
    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); setIsDraggingOver(e.clientY < r.top+r.height/2 ? 'top':'bottom'); };
    const handleDrop = (e: React.DragEvent) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if(id && id !== cell.id && isDraggingOver) onMoveCell(id, cell.id, isDraggingOver==='top'?'before':'after'); setIsDraggingOver(null); };
    // B-055: Alt+Up / Alt+Down on the drag handle (or the cell wrapper) moves
    // the cell one position up or down without requiring mouse drag.
    const handleCellKeyDown = (e: React.KeyboardEvent) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        // Don't steal the shortcut from inner inputs/editors (only intercept from the cell wrapper or drag handle).
        const target = e.target as HTMLElement;
        if (target.closest('input, textarea, [contenteditable="true"], .cm-editor')) return;
        e.preventDefault();
        const idx = allCells.findIndex(c => c.id === cell.id);
        if (e.key === 'ArrowUp' && idx > 0) {
            onMoveCell(cell.id, allCells[idx - 1].id, 'before');
        } else if (e.key === 'ArrowDown' && idx < allCells.length - 1) {
            onMoveCell(cell.id, allCells[idx + 1].id, 'after');
        }
    };
    const handleApplyCode = (newCode: string, type: 'sql' | 'plot', index: number) => { if(type==='sql') handleSqlChange(newCode, index); else handlePlotChange(newCode, index); setActiveChat(null); };
    const handleApplyPlotFix = (newConfig: string, index: number) => handlePlotChange(newConfig, index);
    const handleAddVariable = () => { let newVarName = '$newVar'; const currentVars = parsed.variables || {}; let i=1; while(currentVars[newVarName]) newVarName = `$newVar${i++}`; handleCellVariableChange({ ...currentVars, [newVarName]:''}); setFocusVarName(newVarName); };

    const handleCommitBlockName = useCallback((type: 'sql' | 'plot', idx: number, newName: string) => {
        setEditingBlockName(null);
        const name = newName.trim().replace(/\n/g, ' ');
        let blockIdx = -1;
        const newSegments = segments.map(seg => {
            if (seg.type !== type) return seg;
            blockIdx++;
            if (blockIdx !== idx) return seg;
            // Remove existing alias directive comment at the top (-- alias <name> or
            // legacy -- <name> where name is an identifier-like word), then prepend
            // new one. Only strips recognised alias comments, not arbitrary SQL comments
            // like `-- SELECT * intentionally excluded` (B-180/B-098).
            const withoutAlias = seg.content.replace(/^\s*--\s*(?:alias\s+)?[a-zA-Z_][\w\s-]*?\s*\n/, '');
            const newContent = name ? `-- ${name}\n${withoutAlias}` : withoutAlias;
            return { ...seg, content: newContent };
        });
        handleSegmentsUpdate(newSegments);
    }, [segments, handleSegmentsUpdate]);
    const handleDeleteVariable = (k:string) => { const v = {...(parsed.variables||{})}; delete v[k]; handleCellVariableChange(v);};
    const handleVariableChange = (o:string,n:string,v:string) => {
        const vars:Record<string,string>={};
        for(const k in (parsed.variables||{})) { if(k===o) vars[n]=v; else vars[k]=parsed.variables![k]; }
        if (o !== n) {
            // Rename the variable reference everywhere it appears in this cell's SQL and plot blocks.
            // Build a boundary-safe regex: for $x (single-dollar) require no preceding $; right boundary (?!\w).
            const escapedOld = o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const leftBound = o.startsWith('$$') ? '' : '(?<!\\$)';
            const refRe = new RegExp(`${leftBound}${escapedOld}(?!\\w)`, 'g');
            const newSegments = segments.map(seg => {
                if (seg.type === 'sql' || seg.type === 'plot') {
                    return { ...seg, content: seg.content.replace(refRe, () => n) };
                }
                return seg;
            });
            // Update variables + renamed SQL/plot segments together.
            const varContent = '\n' + Object.entries(vars).map(([k2, v2]) => `${k2} = ${v2}`).join('\n') + '\n';
            const result = newSegments.map(seg => seg.type === 'variables' ? { ...seg, content: varContent } : seg);
            handleSegmentsUpdate(result);
        } else {
            handleCellVariableChange(vars);
        }
    };
    
    const handleVariableClick = (varName: string) => {
        if (varName.startsWith('$$')) { onGlobalVariableClick(varName); return; }
        const focusLocalVar = () => { if (isVariablesCollapsed) { setIsVariablesCollapsed(false); setTimeout(() => variableInputRefs.current[varName]?.focus(), 100); } else { variableInputRefs.current[varName]?.focus(); } };
        if (varName in (parsed.variables || {})) { focusLocalVar(); } else { handleCellVariableChange({...(parsed.variables||{}), [varName]: ''}); setTimeout(focusLocalVar, 100); }
    };
    
    const cellIdx = allCells.findIndex(c => c.id === cell.id);
    const cellAlias = computeCellHandle(cell, cellIdx);

    return (
        <div
            className={`bg-gray-800/40 rounded-lg border border-gray-700/80 shadow-sm relative transition-opacity ${isBeingDragged ? 'opacity-50' : ''}`}
            data-cell-id={cell.id}
            data-cell-idx={cellIdx >= 0 ? String(cellIdx + 1) : undefined}
            data-cell-alias={cellAlias}
            onKeyDown={handleCellKeyDown}
            onDragOver={handleDragOver} onDragLeave={()=>setIsDraggingOver(null)} onDrop={handleDrop}>
            {isDraggingOver === 'top' && <div className="absolute top-0 left-0 right-0 h-1 bg-cyan-400 z-10" />}
            <div className="px-3 py-2 border-b border-gray-700/60 flex items-center justify-between bg-gray-700/20">
                <div className="flex items-center gap-2 w-full">
                     {!presenterMode && <div draggable onDragStart={handleDragStart} onDragEnd={()=>setIsBeingDragged(false)} title="Drag to reorder (Alt+↑/↓ for keyboard)" aria-label="Drag to reorder cell" role="button" tabIndex={0} className="cursor-grab p-1 text-gray-600 hover:text-gray-400"><Bars2Icon className="w-4 h-4"/></div>}
                    {!presenterMode && <button onClick={()=>{ const next = !isCellCollapsed; setIsCellCollapsed(next); onCellCollapseChange?.(cell.id, next); }} className="p-1 text-gray-400 hover:text-gray-300 flex-shrink-0" title={isCellCollapsed ? "Expand cell" : "Collapse cell"}>{isCellCollapsed ? <ChevronDownIcon className="w-3.5 h-3.5"/> : <ChevronUpIcon className="w-3.5 h-3.5"/>}</button>}
                    {isEditingTitle ? <input type="text" value={editingTitleValue} onChange={e=>setEditingTitleValue(e.target.value)} onBlur={()=>handleTitleBlur(editingTitleValue)} onKeyDown={handleTitleKeyDown} className="text-base font-semibold bg-gray-900 border border-cyan-500 rounded-md px-2 py-0.5 w-full" autoFocus/> : <h2 onClick={()=>{if(!presenterMode){setEditingTitleValue(title||'');setIsEditingTitle(true);}}} className={`text-base font-semibold w-full text-gray-100 ${presenterMode ? '' : 'cursor-pointer'}`}>{title}</h2>}
                </div>
                {!presenterMode && <div className="flex items-center gap-1 flex-shrink-0"><button onClick={()=>setIsRawEditing(!isRawEditing)} className="p-1.5 hover:bg-cyan-600/30 rounded-md" title={isRawEditing?"Rich View":"Raw Markdown"}>{isRawEditing ? <EyeIcon className="w-4 h-4 text-cyan-300"/>:<CodeBracketIcon className="w-4 h-4 text-gray-400"/>}</button><button onClick={()=>{if(window.confirm('Delete this cell?'))onDeleteCell(cell.id);}} className="p-1.5 hover:bg-red-600/50 rounded-md" title="Delete Cell" aria-label="Delete Cell"><TrashIcon className="w-4 h-4 text-gray-400"/></button></div>}
            </div>
            {!isCellCollapsed && (isRawEditing ? <div className="p-2"><SQLEditor value={reconstructCellContent(segments)} onChange={handleRawContentChange} mode="markdown"/></div> : <div className="p-3 space-y-3">
                 <MarkdownSectionEditor
                    section={parsed.introduction}
                    defaultTitle="Introduction"
                    onUpdate={handleIntroUpdate}
                    onAdd={()=> handleIntroUpdate({title:'Introduction', content:'## Title\n\n_Introduction_\n'})}
                    isEditing={editingSection==='intro'}
                    onSetEditing={e=>setEditingSection(e?'intro':null)}
                    variables={allVariables}
                    formatSettings={{ timeFormat: metadata?.timeFormat, decimalPlaces: metadata?.decimalPlaces }}
                    presenterMode={presenterMode}
                />

                {Object.keys(parsed.variables||{}).length > 0 || (parsed.variableWarnings?.length ?? 0) > 0
                    ? <CollapsibleBlock title={`Variables (${Object.keys(parsed.variables||{}).length})`} isCollapsed={isVariablesCollapsed} onToggle={()=>setIsVariablesCollapsed(!isVariablesCollapsed)} preview="" controls={<button onClick={handleAddVariable} className="flex items-center gap-1.5 text-xs px-2 py-1 bg-gray-700/80 rounded-md"><PlusIcon className="w-3 h-3"/> Add</button>}><div className="p-2"><div className="space-y-2">{Object.entries(parsed.variables||{}).map(([k,v])=><VariableEditor key={k} varKey={k} varValue={v} usedIn={variableUsage[k]} onChange={handleVariableChange} onDelete={handleDeleteVariable} inputRef={el => { variableInputRefs.current[k] = el; }}/>)}</div>{parsed.variableWarnings?.map((w,i)=><p key={i} className="text-xs text-yellow-400 mt-1 font-mono">{w}</p>)}</div></CollapsibleBlock>
                    : null
                }
                
                {/* Unified segment rendering: SQL editors, plot editors, inline markdown, and inline plot results */}
                <div className="space-y-2">
                    {(() => {
                        const items: React.ReactNode[] = [];
                        let sqlIdx = -1;
                        let plotIdx = -1;

                        segments.forEach((seg, segIdx) => {
                            // Render inline markdown segments (prose inserted between code blocks).
                            // Skip the leading intro markdown (handled by MarkdownSectionEditor above)
                            // and trailing conclusion markdown, but render middle prose blocks.
                            if (seg.type === 'markdown') {
                                const isLeadingMarkdown = segments.slice(0, segIdx).every(s => s.type === 'markdown' || s.type === 'variables');
                                const isTrailingMarkdown = segments.slice(segIdx + 1).every(s => s.type === 'markdown');
                            if (!isLeadingMarkdown && !isTrailingMarkdown) {
                                    const hasContent = seg.content.trim().length > 0;
                                    if (!hasContent && presenterMode) return;
                                    // Skip whitespace-only segments (bare \n between fences) in edit mode too —
                                    // they are formatting noise, not user-added prose blocks.
                                    if (!hasContent && /^\n+$/.test(seg.content)) return;
                                    items.push(
                                        <div key={`prose-${segIdx}`} className="relative group/prose rounded-md border border-gray-700/40 px-3 py-2 min-h-[2.5rem]">
                                            {hasContent ? (
                                                <div className="prose prose-invert max-w-none text-sm">
                                                    <TemplatedMarkdown
                                                        segments={[seg]}
                                                        variables={allVariables}
                                                        formatSettings={{ timeFormat: metadata?.timeFormat, decimalPlaces: metadata?.decimalPlaces }}
                                                    />
                                                </div>
                                            ) : !presenterMode ? (
                                                <p className="text-gray-600 text-sm italic cursor-pointer hover:text-gray-400" onClick={() => {
                                                    const newSegments = [...segments];
                                                    newSegments[segIdx] = { ...seg, content: '\n' };
                                                    handleSegmentsUpdate(newSegments);
                                                }}>Empty prose block — click to edit</p>
                                            ) : null}
                                            {!presenterMode && (
                                                <button onClick={() => handleDeleteMarkdown(segIdx)} className="absolute top-1 right-1 opacity-0 group-hover/prose:opacity-100 p-1 rounded hover:bg-red-600/30 transition-all" title="Delete prose block" aria-label="Delete prose block">
                                                    <TrashIcon className="w-3.5 h-3.5 text-gray-400 hover:text-red-400"/>
                                                </button>
                                            )}
                                        </div>
                                    );
                                }
                                return;
                            }

                            if (seg.type === 'variables') return;

                            if (seg.type === 'if') {
                                // Conditional block: render via TemplatedMarkdown so the
                                // condition is evaluated and the body is shown/hidden
                                // dynamically. Authors edit the source via raw-edit mode.
                                items.push(
                                    <div key={`if-${segIdx}`} className="rounded-md border border-cyan-800/40 px-3 py-2 bg-cyan-900/10">
                                        <div className="text-[10px] text-cyan-500 mb-1 font-mono">{`{if …}`}</div>
                                        <TemplatedMarkdown
                                            segments={[seg]}
                                            variables={allVariables}
                                            formatSettings={{ timeFormat: metadata?.timeFormat, decimalPlaces: metadata?.decimalPlaces }}
                                        />
                                    </div>
                                );
                                return;
                            }

                            // Hover insert bar before this segment (between items).
                            if (!presenterMode && items.length > 0) {
                                const insertIdx = segIdx;
                                items.push(
                                    <div key={`ins-${segIdx}`} className="group/insert relative h-2 flex items-center">
                                        <div className="absolute inset-x-0 h-px bg-gray-700/40 group-hover/insert:bg-cyan-600/40 transition-colors" />
                                        <div className="absolute left-1/2 -translate-x-1/2 opacity-0 group-hover/insert:opacity-100 transition-opacity flex gap-1 bg-gray-900 px-1 py-0.5 rounded border border-gray-700/60 z-10">
                                            <button onClick={() => handleInsertAt(insertIdx, 'sql')} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/80 hover:bg-cyan-800/60 text-gray-400 hover:text-cyan-300 transition-colors">+ SQL</button>
                                            <button onClick={() => handleInsertAt(insertIdx, 'plot')} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/80 hover:bg-purple-800/60 text-gray-400 hover:text-purple-300 transition-colors">+ Plot</button>
                                            <button onClick={() => handleInsertAt(insertIdx, 'markdown')} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/80 hover:bg-gray-600/60 text-gray-400 hover:text-gray-200 transition-colors">+ Prose</button>
                                        </div>
                                    </div>
                                );
                            }

                            if (seg.type === 'sql') {
                                sqlIdx++;
                                const i = sqlIdx;
                                const sql = parsed.sqlBlocks[i] ?? '';
                                const errSpec = errSpecs[i] ?? null;
                                const alias = parsed.queryAliases[i];
                                const isEditingSqlName = editingBlockName?.type === 'sql' && editingBlockName.idx === i;
                                const queryElapsedMs = queryTimings?.[i];
                                const timingChip = queryElapsedMs != null ? (
                                    <span className="ml-1.5 text-[10px] text-gray-500 font-normal font-mono" title="Query execution time">
                                        {queryElapsedMs >= 1000 ? `${(queryElapsedMs / 1000).toFixed(2)}s` : `${Math.round(queryElapsedMs)}ms`}
                                    </span>
                                ) : null;
                                const sqlTitleNode = isEditingSqlName ? (
                                    <input
                                        autoFocus
                                        type="text"
                                        value={editingBlockName.value}
                                        onChange={e => setEditingBlockName({ type: 'sql', idx: i, value: e.target.value })}
                                        onBlur={() => handleCommitBlockName('sql', i, editingBlockName.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') handleCommitBlockName('sql', i, editingBlockName.value); else if (e.key === 'Escape') setEditingBlockName(null); e.stopPropagation(); }}
                                        onClick={e => e.stopPropagation()}
                                        className="bg-gray-800 border border-cyan-500 rounded px-1.5 py-0.5 text-sm font-medium text-gray-100 w-40 focus:outline-none"
                                        placeholder="Query name…"
                                    />
                                ) : (
                                    <span className="flex items-center gap-0">
                                        <span
                                            className="cursor-pointer hover:text-cyan-300 transition-colors"
                                            title="Click to rename" aria-label="Click to rename"
                                            onClick={e => { e.stopPropagation(); setEditingBlockName({ type: 'sql', idx: i, value: alias ?? '' }); }}
                                        >{alias ? `Query ${i+1} · ${alias}` : `Query ${i+1}`}</span>
                                        {timingChip}
                                    </span>
                                );
                                if (!presenterMode) {
                                    items.push(
                                        <CollapsibleBlock key={`sql-${i}`} title={sqlTitleNode} preview={sql.replace(/\s+/g,' ').substring(0,60)} isCollapsed={!!collapsedStates[`sql-${i}`]} onToggle={()=>toggleCollapse(`sql-${i}`)} statusIndicator={runningStates[i]?(<div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"/>):pendingRunStates[i]?(<div className="w-4 h-4 text-gray-500 animate-pulse">...</div>):null} controls={<><button onClick={()=>handleRun(sql,i)} disabled={runningStates[i]||pendingRunStates[i]} title="Run query (Cmd+Enter)" aria-label="Run query (Cmd+Enter)" className="p-1.5 rounded-md disabled:opacity-50"><PlayIcon className="w-4 h-4 text-green-400"/></button><button onClick={()=>handleFormat(sql,'sql',i)} title="Format SQL" aria-label="Format SQL" className="p-1.5 rounded-md"><DocumentFormattingIcon className="w-4 h-4 text-cyan-400"/></button>{isAiFeatureActive && <><button onClick={()=>handleSuggest(sql,i)} title="Suggest plot with AI" aria-label="Suggest plot with AI" className="p-1.5 rounded-md"><SparklesIcon className="w-4 h-4 text-yellow-400"/></button><button onClick={()=>setActiveChat(p=>p===`sql-${i}`?null:`sql-${i}`)} title="Refine with AI" aria-label="Refine with AI" className="p-1.5 rounded-md"><ChatBubbleSparklesIcon className="w-4 h-4 text-purple-400"/></button></>}<button onClick={()=>handleCopySql(sql,i)} title="Copy SQL" aria-label="Copy SQL" className="p-1.5 rounded-md">{copiedSql===i ? <CheckCircleIcon className="w-4 h-4 text-green-400"/> : <ClipboardIcon className="w-4 h-4 text-gray-400"/>}</button><button onClick={()=>onDeleteQueryBlock(cell.id, i)} title="Delete query block" aria-label="Delete query block" className="p-1.5 rounded-md"><TrashIcon className="w-4 h-4 text-gray-400"/></button></>}>
                                            <SQLEditor value={sql} onChange={handleSqlChange} index={i} variables={allVariables} onVariableClick={handleVariableClick} metadata={metadata} onRun={() => handleRun(sql, i)} error={errSpec} notebookPlotScope={plotScopeView} />
                                            {errSpec && (
                                                <div className="mt-1 px-2 py-1.5 text-xs text-red-300 bg-red-900/25 border-l-2 border-red-500/60 font-mono whitespace-pre-wrap rounded-r animate-fade-in" title={errSpec.line ? `LINE ${errSpec.line}${errSpec.column ? `:${errSpec.column}` : ''}` : undefined}>
                                                    {errSpec.message}
                                                    {(() => {
                                                        const tip = heuristicTip(errSpec.message);
                                                        const candidates = parseCandidateBindings(errSpec.message);
                                                        const aiSugg = aiErrorSuggestions[i];
                                                        if (!tip && !candidates.length && aiSugg === undefined) return null;
                                                        const badTokenM =
                                                            errSpec.message.match(/[Cc]olumn\s+"([^"]+)"/) ||
                                                            errSpec.message.match(/[Tt]able with name\s+(\S+)\s+does not exist/i) ||
                                                            errSpec.message.match(/[Vv]iew with name\s+(\S+)\s+does not exist/i);
                                                        const badToken = badTokenM ? badTokenM[1] : null;
                                                        return (
                                                            <div className="mt-1 pt-1 border-t border-red-500/30 font-sans not-italic space-y-1">
                                                                {tip && <p className="text-yellow-300/80">{tip}</p>}
                                                                {candidates.length > 0 && (
                                                                    <div className="flex flex-wrap items-center gap-1">
                                                                        <span className="text-gray-500">Did you mean:</span>
                                                                        {candidates.map(col => (
                                                                            <button key={col} onClick={() => { if (badToken) { const escaped = badToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const fixed = sql.replace(new RegExp(`(?<![\\w"])${escaped}(?![\\w"])`, 'g'), `"${col}"`); handleSqlChange(fixed, i); } else { navigator.clipboard.writeText(`"${col}"`).catch(() => {}); } }} className="px-1.5 py-0.5 text-[10px] bg-gray-700/80 hover:bg-cyan-800/60 text-cyan-300 rounded border border-gray-600/60 hover:border-cyan-600/50 font-mono transition-colors" title={badToken ? `Replace "${badToken}" with "${col}"` : `Copy "${col}" to clipboard`}>{col}</button>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                                {isAiFeatureActive && aiErrorSuggestions[i] === null && <p className="text-gray-500 animate-pulse">AI suggestion loading…</p>}
                                                                {isAiFeatureActive && aiErrorSuggestions[i] && (
                                                                    <div className="flex items-start gap-2">
                                                                        <p className="flex-1 text-cyan-300/80"><span className="text-gray-500">AI: </span>{aiErrorSuggestions[i]!.text}</p>
                                                                        {aiErrorSuggestions[i]!.code && <button onClick={() => handleSqlChange(aiErrorSuggestions[i]!.code!, i)} className="flex-shrink-0 px-2 py-0.5 text-[10px] bg-cyan-800/60 hover:bg-cyan-700/80 text-cyan-200 rounded border border-cyan-600/50 transition-colors" title="Apply AI-suggested fix" aria-label="Apply AI-suggested fix">Apply</button>}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            )}
                                            {isAiFeatureActive && activeChat===`sql-${i}` && <InlineChat isAiFeatureActive={isAiFeatureActive} metadata={metadata} targetType="sql" targetValue={sql} sql={sql} data={results[i] ?? undefined} cellContext={cell} allCells={allCells} cells={allCells} onAddCell={onAddCellFromTool} onUpdateCell={onUpdateCell} onApplyCode={c=>handleApplyCode(c,'sql',i)} onClose={()=>setActiveChat(null)} onPopToSidebar={onPopChatToSidebar} onNavigateRef={onNavigateRef}/>}
                                            {settings.autoPlotSuggestionEnabled && plotSuggestions[i] && !dismissedSuggestions[i] && (!parsed.plotBlocks[i] || !parsed.plotBlocks[i].trim()) && (
                                                <PlotSuggestionChip suggestion={plotSuggestions[i]!} onApply={config => { handlePlotChange(config, i); setDismissedSuggestions(p => ({ ...p, [i]: true })); }} onTryAnother={() => { const rows = results[i] ?? []; const columns = rows.length > 0 ? Object.keys(rows[0] ?? {}) : []; setPlotSuggestions(prev => ({ ...prev, [i]: null })); runSuggestPlot({ sql, columns, rowCount: rows.length, signal: undefined }, { settings }).then(result => setPlotSuggestions(prev => ({ ...prev, [i]: result }))).catch(() => setPlotSuggestions(prev => ({ ...prev, [i]: null }))); }} onDismiss={() => setDismissedSuggestions(p => ({ ...p, [i]: true }))}/>
                                            )}
                                        </CollapsibleBlock>
                                    );
                                }
                            } else if (seg.type === 'plot') {
                                plotIdx++;
                                const plotInfo = parsed.plotBlocksWithSqlIndex[plotIdx];
                                if (!plotInfo) return;
                                const pi = plotIdx;
                                const config = plotInfo.config;
                                const defaultSqlIndex = plotInfo.sqlIndex;
                                // Capture segIdx for delete handler closure.
                                const capturedSegIdx = segIdx;

                                // Resolve ON clause for data lookup.
                                let dataIndex = defaultSqlIndex;
                                let datasetData: any[] | null = null;
                                try {
                                    const configToCheck = (config && config.trim()) ? config : 'TABLE()';
                                    const expanded = expandPlotConstants(configToCheck);
                                    const firstConfig = expanded.expanded.split(/\n\s*\n/)[0].trim();
                                    const parsed2 = parsePlotCall(firstConfig);
                                    if (parsed2.on && parsed2.on.length > 0) {
                                        const ref = parsed2.on[0];
                                        const asNum = parseInt(ref, 10);
                                        if (!isNaN(asNum)) { dataIndex = asNum - 1; }
                                        else { const aliasIdx = parsed.queryAliases.indexOf(ref); if (aliasIdx >= 0) dataIndex = aliasIdx; }
                                    }
                                    if (parsed2.dataset) {
                                        datasetData = datasetResults[`${pi}:${parsed2.dataset}`] ?? null;
                                    }
                                } catch { /* fall back to defaultSqlIndex */ }

                                const resolvedData = datasetData ?? results[dataIndex];
                                const resolvedSql = parsed.sqlBlocks[dataIndex] ?? parsed.sqlBlocks[defaultSqlIndex] ?? '';
                                const plotDataCols = (resolvedData && resolvedData.length > 0) ? Object.keys(resolvedData[0]) : [];
                                const plotAlias = parsed.plotAliases[pi] ?? null;
                                const isEditingPlotName = editingBlockName?.type === 'plot' && editingBlockName.idx === pi;
                                const plotTitleNode = isEditingPlotName ? (
                                    <input
                                        autoFocus
                                        type="text"
                                        value={editingBlockName.value}
                                        onChange={e => setEditingBlockName({ type: 'plot', idx: pi, value: e.target.value })}
                                        onBlur={() => handleCommitBlockName('plot', pi, editingBlockName.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') handleCommitBlockName('plot', pi, editingBlockName.value); else if (e.key === 'Escape') setEditingBlockName(null); e.stopPropagation(); }}
                                        onClick={e => e.stopPropagation()}
                                        className="bg-gray-800 border border-cyan-500 rounded px-1.5 py-0.5 text-sm font-medium text-gray-100 w-40 focus:outline-none"
                                        placeholder="Plot name…"
                                    />
                                ) : (
                                    <span
                                        className="cursor-pointer hover:text-cyan-300 transition-colors"
                                        title="Click to rename" aria-label="Click to rename"
                                        onClick={e => { e.stopPropagation(); setEditingBlockName({ type: 'plot', idx: pi, value: plotAlias ?? '' }); }}
                                    >{plotAlias ? `Plot ${pi+1} · ${plotAlias}` : `Plot ${pi+1}`}</span>
                                );
                                const configToRender = (config && config.trim()) ? config : 'TABLE()';

                                if (!presenterMode) {
                                    items.push(
                                        <CollapsibleBlock key={`plot-${pi}`} title={plotTitleNode} preview={config.replace(/\s+/g,' ').substring(0,60)} isCollapsed={collapsedStates[`plot-${pi}`] !== undefined ? !!collapsedStates[`plot-${pi}`] : !config.trim()} onToggle={()=>toggleCollapse(`plot-${pi}`)} controls={<><button onClick={()=>handleFormat(config,'plot',defaultSqlIndex)} title="Format plot" aria-label="Format plot" className="p-1.5 rounded-md"><DocumentFormattingIcon className="w-4 h-4 text-cyan-400"/></button>{isAiFeatureActive && <><button onClick={()=>handleSparkle(pi, defaultSqlIndex)} disabled={sparkleLoading[pi]} title="Generate plot config with AI" aria-label="Generate plot config with AI" className="p-1.5 rounded-md disabled:opacity-50">{sparkleLoading[pi] ? <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin"/> : <SparklesIcon className="w-4 h-4 text-yellow-400"/>}</button><button onClick={()=>setActiveChat(p=>p===`plot-${pi}`?null:`plot-${pi}`)} title="Refine with AI" aria-label="Refine with AI" className="p-1.5 rounded-md"><ChatBubbleSparklesIcon className="w-4 h-4 text-purple-400"/></button></>}<button onClick={()=>setIsPlotHelpModalOpen(true)} title="Plot syntax reference" aria-label="Plot syntax reference" className="p-1.5 rounded-md"><InformationCircleIcon className="w-4 h-4 text-gray-400"/></button><button onClick={()=>handleDeletePlot(capturedSegIdx)} title="Delete plot block" aria-label="Delete plot block" className="p-1.5 rounded-md"><TrashIcon className="w-4 h-4 text-gray-400"/></button></>}>
                                            {plotDataCols.length > 0 && (
                                                <div className="px-2 pt-1.5 pb-0.5 flex flex-wrap gap-1 items-center border-b border-gray-700/50">
                                                    <span className="text-[10px] text-gray-600 mr-0.5">columns:</span>
                                                    {plotDataCols.slice(0, 12).map(col => (
                                                        <button key={col} onClick={() => navigator.clipboard.writeText(`"${col}"`).catch(() => {})} title={`Copy "${col}" to clipboard`} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/60 hover:bg-cyan-800/50 text-gray-400 hover:text-cyan-300 font-mono transition-colors">{col}</button>
                                                    ))}
                                                    {plotDataCols.length > 12 && <span className="text-[10px] text-gray-600">+{plotDataCols.length - 12} more</span>}
                                                    <span className="text-[10px] text-gray-600 ml-1">— click to copy</span>
                                                </div>
                                            )}
                                            <PlotConfigEditor value={config} onChange={handlePlotChange} index={defaultSqlIndex} data={results[defaultSqlIndex]} variables={allVariables} onVariableClick={handleVariableClick} cellSql={parsed.sqlBlocks[defaultSqlIndex] ?? null} notebookPlotScope={plotScopeView} currentCellId={cell.id} sqlBlockCount={totalSqlBlockCount}/>
                                            {isAiFeatureActive && activeChat===`plot-${pi}` && <InlineChat isAiFeatureActive={isAiFeatureActive} metadata={metadata} targetType="plot" targetValue={config} cellContext={cell} allCells={allCells} cells={allCells} onAddCell={onAddCellFromTool} onUpdateCell={onUpdateCell} sql={parsed.sqlBlocks[defaultSqlIndex]} data={results[defaultSqlIndex]} onApplyCode={c=>handleApplyCode(c,'plot',defaultSqlIndex)} onClose={()=>setActiveChat(null)} onMetadataChange={onMetadataChange} onPopToSidebar={onPopChatToSidebar} onNavigateRef={onNavigateRef}/>}
                                        </CollapsibleBlock>
                                    );
                                }

                                // Inline plot result directly below its editor (or always in presenter mode).
                                // Hide result when plot block is collapsed (unless in presenter mode where editor is hidden).
                                const plotIsCollapsed = !presenterMode && (collapsedStates[`plot-${pi}`] !== undefined ? !!collapsedStates[`plot-${pi}`] : !config.trim());
                                if (resolvedData && !plotIsCollapsed) {
                                    // B-141/142/143: Build a lookup map so PlotRenderer can route per-leaf
                                    // ON clauses to the correct dataset. Keys are 1-based numeric indices
                                    // (matching `ON #1`, `ON 1`) and alias strings (matching `ON myView`).
                                    // Cross-cell refs (aliases from sibling cells) are merged in first so
                                    // local aliases (same name) override them.
                                    const dataByQueryRef: Record<string | number, any[]> = {
                                        ...(crossCellQueryRefs ?? {}),
                                    };
                                    results.forEach((r, idx) => {
                                        if (r) {
                                            dataByQueryRef[idx + 1] = r; // 1-based numeric key
                                            const alias = parsed.queryAliases[idx];
                                            if (alias) dataByQueryRef[alias] = r;
                                        }
                                    });

                                    items.push(
                                        <div key={`result-${pi}`} className="group/result rounded-md border border-gray-700/60 overflow-hidden flex flex-col relative" style={{ height: `${resultHeight}px` }}>
                                            <button title="Download as PNG" aria-label="Download as PNG" className="absolute top-1 right-1 opacity-0 group-hover/result:opacity-100 transition-opacity bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded p-1 text-gray-400 hover:text-gray-200 z-10" onClick={() => { const container = document.getElementById(`result-container-${cell.id}-${pi}`); if (!container) return; const svg = container.querySelector('svg'); if (svg) { const serializer = new XMLSerializer(); const svgStr = serializer.serializeToString(svg); const canvas = document.createElement('canvas'); const rect = svg.getBoundingClientRect(); const scale = window.devicePixelRatio || 1; canvas.width = rect.width * scale; canvas.height = rect.height * scale; const ctx = canvas.getContext('2d')!; ctx.scale(scale, scale); const img = new Image(); const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' }); const url = URL.createObjectURL(blob); img.onload = () => { ctx.fillStyle = '#111827'; ctx.fillRect(0, 0, rect.width, rect.height); ctx.drawImage(img, 0, 0, rect.width, rect.height); URL.revokeObjectURL(url); canvas.toBlob(b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `plot-${cell.id}-${pi + 1}.png`; a.click(); URL.revokeObjectURL(a.href); }, 'image/png'); }; img.src = url; } }}>
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                            </button>
                                            <div id={`result-container-${cell.id}-${pi}`} className="flex-grow overflow-auto">
                                                <PlotRenderer config={configToRender} data={resolvedData} dataByQueryRef={dataByQueryRef} sql={resolvedSql} cellContext={{...cell, content: reconstructCellContent(segments)}} onApplyFix={c => handleApplyPlotFix(c, defaultSqlIndex)} isAiFeatureActive={isAiFeatureActive} metadata={metadata} onMetadataChange={onMetadataChange} onCellVariableChange={handleCellVariableChange} allVariables={allVariables} />
                                            </div>
                                        </div>
                                    );
                                }
                            }
                        });

                        return items;
                    })()}
                    {!presenterMode && (
                        <div className="flex justify-end gap-3">
                            <button onClick={handleAddVariable} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 px-1 py-0.5 rounded"><PlusIcon className="w-3 h-3"/> Add variable</button>
                            <button onClick={handleAddSql} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 px-1 py-0.5 rounded"><PlusIcon className="w-3 h-3"/> Add SQL</button>
                        </div>
                    )}
                    {/* Drag handle to resize result panels */}
                    {results && results.some(r => r) && (
                        <div onMouseDown={handleResultResizeStart} className="h-1.5 mt-0.5 cursor-row-resize rounded-full bg-gray-700 hover:bg-cyan-600/50 transition-colors" title="Drag to resize results" aria-label="Drag to resize results" />
                    )}
                </div>
                 <MarkdownSectionEditor
                    section={parsed.conclusion}
                    defaultTitle="Conclusion"
                    onUpdate={handleConclusionUpdate}
                    onAdd={()=> handleConclusionUpdate({title:'Conclusion', content:'_Conclusion_\n'})}
                    isEditing={editingSection==='conclusion'}
                    onSetEditing={e=>setEditingSection(e?'conclusion':null)}
                    variables={allVariables}
                    formatSettings={{ timeFormat: metadata?.timeFormat, decimalPlaces: metadata?.decimalPlaces }}
                    presenterMode={presenterMode}
                />
            </div>)}
            {isDraggingOver === 'bottom' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-cyan-400 z-10" />}
            <PlotHelpModal isOpen={isPlotHelpModalOpen} onClose={() => setIsPlotHelpModalOpen(false)} />
        </div>
    );
};

function areCrossCellRefsEqual(
    a: Record<string, any[]> | undefined,
    b: Record<string, any[]> | undefined,
): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
        if (a[k] !== b[k]) return false;
    }
    return true;
}

function arePropsEqual(prev: NotebookCellProps, next: NotebookCellProps): boolean {
    // Fast path: same reference for most props (callbacks, primitives).
    // Only deep-check crossCellQueryRefs which always gets a new object on result updates.
    if (prev === next) return true;
    return (
        prev.cell === next.cell &&
        prev.allCells === next.allCells &&
        prev.metadata === next.metadata &&
        prev.results === next.results &&
        prev.queryTimings === next.queryTimings &&
        areCrossCellRefsEqual(prev.crossCellQueryRefs, next.crossCellQueryRefs) &&
        prev.isAutoRunEnabled === next.isAutoRunEnabled &&
        prev.collapseTrigger === next.collapseTrigger &&
        prev.allCollapsed === next.allCollapsed &&
        prev.isAiFeatureActive === next.isAiFeatureActive &&
        prev.initialCellCollapsed === next.initialCellCollapsed &&
        prev.clearResultsTrigger === next.clearResultsTrigger &&
        prev.onCellCollapseChange === next.onCellCollapseChange &&
        prev.onRunQuery === next.onRunQuery &&
        prev.onUpdateCell === next.onUpdateCell &&
        prev.onDeleteCell === next.onDeleteCell &&
        prev.onDeleteQueryBlock === next.onDeleteQueryBlock &&
        prev.onAddCellFromTool === next.onAddCellFromTool &&
        prev.onMoveCell === next.onMoveCell &&
        prev.onSuggestPlot === next.onSuggestPlot &&
        prev.onFormatCode === next.onFormatCode &&
        prev.onRunPreviewQuery === next.onRunPreviewQuery &&
        prev.onGlobalVariableClick === next.onGlobalVariableClick &&
        prev.onMetadataChange === next.onMetadataChange &&
        prev.presenterMode === next.presenterMode &&
        prev.onPopChatToSidebar === next.onPopChatToSidebar &&
        prev.onNavigateRef === next.onNavigateRef
    );
}

export default React.memo(NotebookCell, arePropsEqual);
