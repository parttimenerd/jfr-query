
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import type { NotebookCellData, NotebookMetadata } from '../types';
import { tokenizeCellContent, reconstructCellContent, parseCellContent, CellSegment, MarkdownSection } from '../utils/notebookParser';
import { substituteVariables } from '../utils/variableSubstitution';
import { buildSmartTemplate } from '../utils/plotUtils';
import { parsePlotCall } from '../utils/plotParser';
import { expandPlotConstants } from '../utils/plotConstants';
import { plotRegistry } from './plots/plotRegistry';

import SQLEditor from './SQLEditor';
import PlotConfigEditor from './PlotConfigEditor';
import PlotRenderer from './PlotRenderer';
import InlineChat from './InlineChat';
import PlotHelpModal from './PlotHelpModal';
import StaticCodeHighlighter from './StaticCodeHighlighter';
import { TrashIcon } from './icons/TrashIcon';
import { AiFormatIcon } from './icons/AiFormatIcon';
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
    isAutoRunEnabled: boolean;
    collapseTrigger: number;
    allCollapsed: boolean;
    isAiFeatureActive: boolean;
    onRunQuery: (cellId: string, sql: string, queryIndex: number, allVariables: Record<string, string>) => void;
    onUpdate: (updatedContent: string) => void;
    onDelete: () => void;
    onDeleteQueryBlock: (index: number) => void;
    onMoveCell: (draggedId: string, targetId: string, position: 'before' | 'after') => void;
    onSuggestPlot: (sql: string, customPromptOverride?: string) => Promise<string | null>;
    onFormatCode: (code: string, type: 'sql' | 'plot') => Promise<string | null>;
    onRunPreviewQuery: (queryToRun: string) => Promise<any[]>;
    onGlobalVariableClick: (variableName: string) => void;
    onMetadataChange: (newMetadata: NotebookMetadata) => Promise<void>;
}

function debounce<T extends (...args: any[]) => any>(func: T, delay: number): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;
  return function(this: any, ...args: Parameters<T>) {
    clearTimeout(timeout);
    setTimeout(() => func.apply(this, args), delay);
  };
}

const MarkdownSectionEditor: React.FC<{ section: MarkdownSection | null; defaultTitle: string; onUpdate: (s: MarkdownSection | null) => void; onAdd: () => void; isEditing: boolean; onSetEditing: (isEditing: boolean) => void; }> = ({ section, defaultTitle, onUpdate, onAdd, isEditing, onSetEditing }) => {
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
    
    const components = useMemo(() => ({ code: ({ node, inline, className, children, ...props }: any) => { const m = /language-(\w+)/.exec(className||''); return !inline&&(m?.[1]==='sql'||m?.[1]==='plot')?<div className="my-2 border border-gray-700 rounded-md overflow-hidden bg-[#263238]"><StaticCodeHighlighter code={String(children).trim()} language={m[1]}/></div>:<code className="bg-gray-700 text-cyan-300 p-1 rounded-md" {...props}>{children}</code>; } }), []);

    if (!section) return <div className="py-1"><button onClick={onAdd} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 px-1 py-0.5 rounded"><PlusIcon className="w-3 h-3"/> Add {defaultTitle}</button></div>;
    return <div>{isEditing ? <SQLEditor value={content} onChange={setContent} onBlur={handleBlur} mode="markdown" autoFocus/> : <div className="space-y-1"><div onClick={() => onSetEditing(true)} className="prose prose-invert max-w-none px-2 py-1 rounded-md hover:bg-gray-700/30 cursor-pointer min-h-[2rem]"><ReactMarkdown components={components}>{section.content}</ReactMarkdown></div></div>}</div>;
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
                <input type="text" value={key} onChange={e=>{setKey(e.target.value);}} onBlur={()=>{const valid=key.match(/^\$(?!\$)\w+/);if(!valid){setKey(varKey);}else if(key!==varKey){onChangeRef.current(varKey,key,value);}}} className={`w-1/3 bg-gray-800 border ${key.match(/^\$(?!\$)\w+/)?'border-gray-600':'border-red-500'} rounded-md p-1.5 text-sm font-mono text-cyan-300`} title="Cell-local variable: must start with $ (use $$ prefix in Notebook Settings for global scope)"/>
                <span className="text-gray-500">=</span>
                <input type="text" value={value} onChange={e=>{setValue(e.target.value);}} onBlur={()=>{if(value!==varValue)onChangeRef.current(varKey,key,value);}} className="flex-grow bg-gray-800 border border-gray-600 rounded-md p-1.5 text-sm font-mono" ref={inputRef}/>
                <button onClick={()=>onDelete(varKey)} className="p-1.5 text-gray-500 hover:text-red-400"><TrashIcon className="w-4 h-4"/></button>
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


const NotebookCell: React.FC<NotebookCellProps> = ({ cell, allCells, metadata, results, isAutoRunEnabled, collapseTrigger, allCollapsed, isAiFeatureActive, onRunQuery, onUpdate, onDelete, onDeleteQueryBlock, onMoveCell, onSuggestPlot, onFormatCode, onRunPreviewQuery, onMetadataChange, onGlobalVariableClick }) => {
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
    const [copiedSql, setCopiedSql] = useState<number | null>(null);
    const variableInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
    const [focusVarName, setFocusVarName] = useState<string | null>(null);
    
    const [segments, setSegments] = useState(() => tokenizeCellContent(cell.content));
    const parsed = useMemo(() => parseCellContent(segments), [segments]);

    useEffect(() => { setSegments(tokenizeCellContent(cell.content)); }, [cell.content]);
    
    useEffect(() => { if (focusVarName && variableInputRefs.current[focusVarName]) { variableInputRefs.current[focusVarName]?.focus(); setFocusVarName(null); } }, [focusVarName, parsed.variables]);

    const onUpdateRef = useRef(onUpdate); onUpdateRef.current = onUpdate;
    
    const debouncedOnUpdate = useCallback(debounce((newSegments: CellSegment[]) => { onUpdateRef.current(reconstructCellContent(newSegments)); }, 800), []);
    
    const handleSegmentsUpdate = useCallback((newSegments: CellSegment[]) => { setSegments(newSegments); debouncedOnUpdate(newSegments); }, [debouncedOnUpdate]);

    const handleIntroUpdate = useCallback((intro: MarkdownSection | null) => {
        const newContent = intro?.content || '';
        const newIntroSegments: CellSegment[] = (newContent.trim() === '') ? [] : [{ type: 'markdown', content: newContent }];
        
        let firstNonMarkdownIdx = segments.findIndex(s => s.type !== 'markdown');
        if (firstNonMarkdownIdx === -1) firstNonMarkdownIdx = segments.length;
        
        const otherSegments = segments.slice(firstNonMarkdownIdx);

        if (newIntroSegments.length === 0 && otherSegments.length === 0) {
            handleSegmentsUpdate([{ type: 'markdown', content: '' }]);
            return;
        }

        const newSegments = [...newIntroSegments, ...otherSegments];
        handleSegmentsUpdate(newSegments);
    }, [segments, handleSegmentsUpdate]);

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
    
    const allVariables = useMemo(() => ({ ...metadata.variables, ...parsed.variables }), [metadata.variables, parsed.variables]);

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
                message: msg,
                line: lineM ? Number(lineM[1]) + aliasOffset : undefined,
                column,
            };
        });
        // Depend on the raw error strings, not the results array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [parsed.sqlBlocks.length, parsed.queryAliases, ...parsed.sqlBlocks.map((_, i) => results[i]?.[0]?.error)]);

    // For each cell-local variable, compute which SQL/plot blocks reference it.
    const variableUsage = useMemo<Record<string, string[]>>(() => {
        const usage: Record<string, string[]> = {};
        for (const varKey of Object.keys(parsed.variables || {})) {
            const refs: string[] = [];
            const pattern = new RegExp(`\\${varKey.replace(/\$/g, '\\$')}\\b`);
            parsed.sqlBlocks.forEach((sql, i) => { if (pattern.test(sql)) refs.push(`Query ${i + 1}`); });
            parsed.plotBlocks.forEach((plot, i) => { if (pattern.test(plot)) refs.push(`Plot ${i + 1}`); });
            usage[varKey] = refs;
        }
        return usage;
    }, [parsed.variables, parsed.sqlBlocks, parsed.plotBlocks]);

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
        });
    }, []);

    const handleRun = useCallback(async (sql: string, index: number) => {
        if (runTimersRef.current[index]) clearTimeout(runTimersRef.current[index]);
        setPendingRunStates(s => ({ ...s, [index]: false }));
        setRunningStates(s => ({ ...s, [index]: true }));
        try {
            await onRunQuery(cell.id, sql, index, allVariables);
        } finally {
            setRunningStates(s => ({ ...s, [index]: false }));
        }
    }, [onRunQuery, cell.id, allVariables]);

    useEffect(() => {
        const prevSqls = prevSqlBlocksRef.current;
        const prevVars = prevVariablesRef.current;
        if (!isAutoRunEnabled) {
            Object.values(runTimersRef.current).forEach(clearTimeout); runTimersRef.current = {}; setPendingRunStates({});
            prevSqlBlocksRef.current = parsed.sqlBlocks;
            prevVariablesRef.current = allVariables;
            return;
        }

        const variablesChanged = JSON.stringify(prevVars) !== JSON.stringify(allVariables);
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
            newSegments[plotSegmentIndex] = { ...newSegments[plotSegmentIndex], content: newConfig };
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
    const handleFormat = async (code: string, type: 'sql' | 'plot', index: number) => { const f = await onFormatCode(code, type); if (f) { if(type==='sql') handleSqlChange(f, index); else handlePlotChange(f, index); } };
    const handleAddSql = () => handleSegmentsUpdate([...segments, {type: 'markdown', content: '\n\n'}, {type: 'sql', content: '\nSELECT * FROM ... LIMIT 10;\n'}, {type: 'markdown', content: '\n\n'}, {type: 'plot', content: '\nTABLE()\n'}]);
    const handleAddPlot = () => { /* No-op, plot change creates plot blocks */ };
    const handleTitleBlur = (newTitle: string) => { setIsEditingTitle(false); if (newTitle.trim() && newTitle !== title) { const introSegmentIndex = segments.findIndex(s=>s.type==='markdown'); if(introSegmentIndex!==-1){const newSegments=[...segments]; const intro=newSegments[introSegmentIndex]; const newContent=intro.content.replace(/^(?:#|##|###)\s*(.*)/,`## ${newTitle}`); newSegments[introSegmentIndex]={...intro, content:newContent}; handleSegmentsUpdate(newSegments);} }};
    const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { handleTitleBlur(editingTitleValue); } else if (e.key === 'Escape') { setIsEditingTitle(false); } };
    const handleDragStart = (e: React.DragEvent) => { e.dataTransfer.setData('text/plain', cell.id); e.dataTransfer.effectAllowed = 'move'; setIsBeingDragged(true); };
    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); setIsDraggingOver(e.clientY < r.top+r.height/2 ? 'top':'bottom'); };
    const handleDrop = (e: React.DragEvent) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if(id && id !== cell.id && isDraggingOver) onMoveCell(id, cell.id, isDraggingOver==='top'?'before':'after'); setIsDraggingOver(null); };
    const handleApplyCode = (newCode: string, type: 'sql' | 'plot', index: number) => { if(type==='sql') handleSqlChange(newCode, index); else handlePlotChange(newCode, index); setActiveChat(null); };
    const handleApplyPlotFix = (newConfig: string, index: number) => handlePlotChange(newConfig, index);
    const handleAddVariable = () => { let newVarName = '$newVar'; const currentVars = parsed.variables || {}; let i=1; while(currentVars[newVarName]) newVarName = `$newVar${i++}`; handleCellVariableChange({ ...currentVars, [newVarName]:''}); setFocusVarName(newVarName); };
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
    
    return (
        <div className={`bg-gray-800/40 rounded-lg border border-gray-700/80 shadow-sm relative transition-opacity ${isBeingDragged ? 'opacity-50' : ''}`} onDragOver={handleDragOver} onDragLeave={()=>setIsDraggingOver(null)} onDrop={handleDrop}>
            {isDraggingOver === 'top' && <div className="absolute top-0 left-0 right-0 h-1 bg-cyan-400 z-10" />}
            <div className="px-3 py-2 border-b border-gray-700/60 flex items-center justify-between bg-gray-700/20">
                <div className="flex items-center gap-2 w-full">
                     <div draggable onDragStart={handleDragStart} onDragEnd={()=>setIsBeingDragged(false)} className="cursor-grab p-1 text-gray-600 hover:text-gray-400"><Bars2Icon className="w-4 h-4"/></div>
                    {isEditingTitle ? <input type="text" value={editingTitleValue} onChange={e=>setEditingTitleValue(e.target.value)} onBlur={()=>handleTitleBlur(editingTitleValue)} onKeyDown={handleTitleKeyDown} className="text-base font-semibold bg-gray-900 border border-cyan-500 rounded-md px-2 py-0.5 w-full" autoFocus/> : <h2 onClick={()=>{setEditingTitleValue(title||'');setIsEditingTitle(true);}} className="text-base font-semibold cursor-pointer w-full text-gray-100">{title}</h2>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0"><button onClick={()=>setIsRawEditing(!isRawEditing)} className="p-1.5 hover:bg-cyan-600/30 rounded-md" title={isRawEditing?"Rich View":"Raw Markdown"}>{isRawEditing ? <EyeIcon className="w-4 h-4 text-cyan-300"/>:<CodeBracketIcon className="w-4 h-4 text-gray-500"/>}</button><button onClick={()=>{if(window.confirm('Delete this cell?'))onDelete();}} className="p-1.5 hover:bg-red-600/50 rounded-md" title="Delete Cell"><TrashIcon className="w-4 h-4 text-gray-500"/></button></div>
            </div>
            {isRawEditing ? <div className="p-2"><SQLEditor value={reconstructCellContent(segments)} onChange={handleRawContentChange} mode="markdown"/></div> : <div className="p-3 space-y-3">
                 <MarkdownSectionEditor 
                    section={parsed.introduction} 
                    defaultTitle="Introduction" 
                    onUpdate={handleIntroUpdate} 
                    onAdd={()=> handleIntroUpdate({title:'Introduction', content:'## Title\n\n '})} 
                    isEditing={editingSection==='intro'} 
                    onSetEditing={e=>setEditingSection(e?'intro':null)}
                />

                {Object.keys(parsed.variables||{}).length > 0 || (parsed.variableWarnings?.length ?? 0) > 0
                    ? <CollapsibleBlock title={`Variables (${Object.keys(parsed.variables||{}).length})`} isCollapsed={isVariablesCollapsed} onToggle={()=>setIsVariablesCollapsed(!isVariablesCollapsed)} preview="" controls={<button onClick={handleAddVariable} className="flex items-center gap-1.5 text-xs px-2 py-1 bg-gray-700/80 rounded-md"><PlusIcon className="w-3 h-3"/> Add</button>}><div className="p-2"><div className="space-y-2">{Object.entries(parsed.variables||{}).map(([k,v])=><VariableEditor key={k} varKey={k} varValue={v} usedIn={variableUsage[k]} onChange={handleVariableChange} onDelete={handleDeleteVariable} inputRef={el => { variableInputRefs.current[k] = el; }}/>)}</div>{parsed.variableWarnings?.map((w,i)=><p key={i} className="text-xs text-yellow-400 mt-1 font-mono">{w}</p>)}</div></CollapsibleBlock>
                    : null
                }
                
                <div className="space-y-2">
                    {parsed.sqlBlocks.map((sql, i) => {
                        const errSpec = errSpecs[i] ?? null;
                        const alias = parsed.queryAliases[i];
                        const sqlTitle = alias ? `Query ${i+1} · ${alias}` : `Query ${i+1}`;
                        return (
                        <CollapsibleBlock key={`sql-${i}`} title={sqlTitle} preview={sql.replace(/\s+/g,' ').substring(0,60)} isCollapsed={!!collapsedStates[`sql-${i}`]} onToggle={()=>toggleCollapse(`sql-${i}`)} statusIndicator={runningStates[i]?(<div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"/>):pendingRunStates[i]?(<div className="w-4 h-4 text-gray-500 animate-pulse">...</div>):null} controls={<><button onClick={()=>handleRun(sql,i)} disabled={runningStates[i]||pendingRunStates[i]} className="p-1.5 rounded-md disabled:opacity-50"><PlayIcon className="w-4 h-4 text-green-400"/></button>{isAiFeatureActive && <><button onClick={()=>handleSuggest(sql,i)} className="p-1.5 rounded-md"><SparklesIcon className="w-4 h-4 text-yellow-400"/></button><button onClick={()=>handleFormat(sql,'sql',i)} className="p-1.5 rounded-md"><AiFormatIcon className="w-4 h-4 text-cyan-400"/></button><button onClick={()=>setActiveChat(p=>p===`sql-${i}`?null:`sql-${i}`)} className="p-1.5 rounded-md"><ChatBubbleSparklesIcon className="w-4 h-4 text-purple-400"/></button></>}<button onClick={()=>handleCopySql(sql,i)} title="Copy SQL" className="p-1.5 rounded-md">{copiedSql===i ? <CheckCircleIcon className="w-4 h-4 text-green-400"/> : <ClipboardIcon className="w-4 h-4 text-gray-400"/>}</button><button onClick={()=>onDeleteQueryBlock(i)} className="p-1.5 rounded-md"><TrashIcon className="w-4 h-4 text-gray-400"/></button></>}>
                            <SQLEditor value={sql} onChange={handleSqlChange} index={i} variables={allVariables} onVariableClick={handleVariableClick} metadata={metadata} onRun={() => handleRun(sql, i)} error={errSpec} />
                            {errSpec && (
                                <div className="mt-1 px-2 py-1.5 text-xs text-red-300 bg-red-900/25 border-l-2 border-red-500/60 font-mono whitespace-pre-wrap rounded-r animate-fade-in" title={errSpec.line ? `LINE ${errSpec.line}${errSpec.column ? `:${errSpec.column}` : ''}` : undefined}>
                                    {errSpec.message}
                                </div>
                            )}
                            {isAiFeatureActive && activeChat===`sql-${i}` && <InlineChat isAiFeatureActive={isAiFeatureActive} metadata={metadata} targetType="sql" targetValue={sql} cellContext={cell} allCells={allCells} onApplyCode={c=>handleApplyCode(c,'sql',i)} onClose={()=>setActiveChat(null)}/>}
                        </CollapsibleBlock>
                        );
                    })}
                    <div className="flex justify-end gap-3">
                        <button onClick={handleAddVariable} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 px-1 py-0.5 rounded"><PlusIcon className="w-3 h-3"/> Add variable</button>
                        <button onClick={handleAddSql} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 px-1 py-0.5 rounded"><PlusIcon className="w-3 h-3"/> Add SQL</button>
                    </div>
                </div>
                {parsed.sqlBlocks.length > 0 && <div className="space-y-2">
                    {parsed.plotBlocks.map((config,i)=>{
                        const plotDataCols = (results[i] && results[i].length > 0) ? Object.keys(results[i][0]) : [];
                        const sourceAlias = parsed.queryAliases[i];
                        const plotTitle = sourceAlias ? `Plot ${i+1} · ${sourceAlias}` : `Plot ${i+1}`;
                        return (<CollapsibleBlock key={`plot-${i}`} title={plotTitle} preview={config.replace(/\s+/g,' ').substring(0,60)} isCollapsed={collapsedStates[`plot-${i}`] !== undefined ? !!collapsedStates[`plot-${i}`] : !config.trim()} onToggle={()=>toggleCollapse(`plot-${i}`)} controls={<><button onClick={()=>handleFormat(config,'plot',i)} className="p-1.5 rounded-md"><DocumentFormattingIcon className="w-4 h-4 text-cyan-400"/></button>{isAiFeatureActive && <button onClick={()=>setActiveChat(p=>p===`plot-${i}`?null:`plot-${i}`)} className="p-1.5 rounded-md"><ChatBubbleSparklesIcon className="w-4 h-4 text-purple-400"/></button>}</>}>
                        {plotDataCols.length > 0 && (
                            <div className="px-2 pt-1.5 pb-0.5 flex flex-wrap gap-1 items-center border-b border-gray-700/50">
                                <span className="text-[10px] text-gray-600 mr-0.5">columns:</span>
                                {plotDataCols.slice(0, 12).map(col => (
                                    <button
                                        key={col}
                                        onClick={() => navigator.clipboard.writeText(`"${col}"`).catch(() => {})}
                                        title={`Copy "${col}" to clipboard`}
                                        className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/60 hover:bg-cyan-800/50 text-gray-400 hover:text-cyan-300 font-mono transition-colors"
                                    >{col}</button>
                                ))}
                                {plotDataCols.length > 12 && <span className="text-[10px] text-gray-600">+{plotDataCols.length - 12} more</span>}
                                <span className="text-[10px] text-gray-600 ml-1">— click to copy</span>
                            </div>
                        )}
                        <PlotConfigEditor value={config} onChange={handlePlotChange} index={i} data={results[i]} variables={allVariables} onVariableClick={handleVariableClick}/>
                    <div id={`plot-error-portal-${cell.id}-${i}`} />
                    {isAiFeatureActive && activeChat===`plot-${i}`&&<InlineChat isAiFeatureActive={isAiFeatureActive} metadata={metadata} targetType="plot" targetValue={config} cellContext={cell} allCells={allCells} sql={parsed.sqlBlocks[i]} data={results[i]} onApplyCode={c=>handleApplyCode(c,'plot',i)} onClose={()=>setActiveChat(null)} onMetadataChange={onMetadataChange} />}</CollapsibleBlock>);
                    })}
                    <div className="flex flex-wrap justify-end items-center gap-x-3 gap-y-1">
                        <span className="text-[10px] text-gray-600 mr-auto">switch to:</span>
                        {Object.values(plotRegistry).map(p => (
                            <button key={p.name} onClick={() => {
                                const idx = Math.max(0, parsed.plotBlocks.length - 1);
                                const data = results?.[idx] ?? [];
                                const cols = data.length > 0 ? Object.keys(data[0]) : [];
                                const sample = data[0] ?? null;
                                const tpl = buildSmartTemplate(p.name, cols, sample) ?? p.template;
                                handlePlotChange(tpl, idx);
                            }} title={p.description} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/40 hover:bg-gray-600/60 text-gray-500 hover:text-gray-300 font-mono transition-colors">{p.name}</button>
                        ))}
                        <button onClick={()=>setIsPlotHelpModalOpen(true)} className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-gray-400 px-1 py-0.5 rounded ml-1" title="Plot syntax reference"><InformationCircleIcon className="w-3 h-3"/> help</button>
                    </div>
                </div>}
                {results && results.some(r => r) && <div>
                    <div className="rounded-md border border-gray-700/60 overflow-hidden">
                        {(() => {
                                // Build one panel per plot block. Each plot resolves its data
                                // via its ON clause (1-based index or alias), falling back to
                                // the plot's own position index.
                                const panels: React.ReactNode[] = [];
                                // Use plotBlocksWithSqlIndex so cells with more plots than SQL blocks
                                // (ON clause cross-references) render all plot panels correctly.
                                const plotsToRender: Array<{ config: string | undefined; defaultIndex: number }> =
                                    parsed.plotBlocksWithSqlIndex.length > 0
                                        ? parsed.plotBlocksWithSqlIndex.map(p => ({ config: p.config, defaultIndex: p.sqlIndex }))
                                        : results.map((_, i) => ({ config: undefined, defaultIndex: i }));
                                plotsToRender.forEach(({ config: plotConfig, defaultIndex }, i) => {
                                    // undefined means "no PLOT block at all" — skip.
                                    // Empty string ("") is a PLOT block that is blank — render TABLE() by default.
                                    if (plotConfig === undefined) return;
                                    const configToRender = (plotConfig && plotConfig.trim()) ? plotConfig : 'TABLE()';

                                    // Resolve ON clause
                                    let dataIndex = defaultIndex;
                                    try {
                                        const expanded = expandPlotConstants(configToRender);
                                        const firstConfig = expanded.expanded.split(/\n\s*\n/)[0].trim();
                                        const parsed2 = parsePlotCall(firstConfig);
                                        if (parsed2.on && parsed2.on.length > 0) {
                                            const ref = parsed2.on[0];
                                            const asNum = parseInt(ref, 10);
                                            if (!isNaN(asNum)) {
                                                dataIndex = asNum - 1; // 1-based → 0-based
                                            } else {
                                                const aliasIdx = parsed.queryAliases.indexOf(ref);
                                                if (aliasIdx >= 0) dataIndex = aliasIdx;
                                            }
                                        }
                                    } catch { /* ignore, fall back to defaultIndex */ }

                                    const resolvedData = results[dataIndex];
                                    const resolvedSql = parsed.sqlBlocks[dataIndex] ?? parsed.sqlBlocks[i] ?? '';
                                    if (!resolvedData) return; // query not yet run

                                    panels.push(
                                        <div key={`r-${i}`} className="group/result border-t border-gray-700/60 first:border-t-0 flex flex-col relative" style={{ height: `${resultHeight}px` }}>
                                            <button
                                                title="Download as PNG"
                                                className="absolute top-1 right-1 opacity-0 group-hover/result:opacity-100 transition-opacity bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded p-1 text-gray-400 hover:text-gray-200 z-10"
                                                onClick={() => {
                                                    const container = document.getElementById(`result-container-${cell.id}-${i}`);
                                                    if (!container) return;
                                                    const svg = container.querySelector('svg');
                                                    if (svg) {
                                                        const serializer = new XMLSerializer();
                                                        const svgStr = serializer.serializeToString(svg);
                                                        const canvas = document.createElement('canvas');
                                                        const rect = svg.getBoundingClientRect();
                                                        const scale = window.devicePixelRatio || 1;
                                                        canvas.width = rect.width * scale;
                                                        canvas.height = rect.height * scale;
                                                        const ctx = canvas.getContext('2d')!;
                                                        ctx.scale(scale, scale);
                                                        const img = new Image();
                                                        const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
                                                        const url = URL.createObjectURL(blob);
                                                        img.onload = () => {
                                                            ctx.fillStyle = '#111827';
                                                            ctx.fillRect(0, 0, rect.width, rect.height);
                                                            ctx.drawImage(img, 0, 0, rect.width, rect.height);
                                                            URL.revokeObjectURL(url);
                                                            canvas.toBlob(b => {
                                                                if (!b) return;
                                                                const a = document.createElement('a');
                                                                a.href = URL.createObjectURL(b);
                                                                a.download = `plot-${cell.id}-${i + 1}.png`;
                                                                a.click();
                                                                URL.revokeObjectURL(a.href);
                                                            }, 'image/png');
                                                        };
                                                        img.src = url;
                                                    }
                                                }}
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                </svg>
                                            </button>
                                            <div id={`result-container-${cell.id}-${i}`} className="flex-grow overflow-auto">
                                                <PlotRenderer
                                                    config={configToRender}
                                                    data={resolvedData}
                                                    sql={resolvedSql}
                                                    cellContext={{...cell, content: reconstructCellContent(segments)}}
                                                    onApplyFix={c => handleApplyPlotFix(c, i)}
                                                    isAiFeatureActive={isAiFeatureActive}
                                                    metadata={metadata}
                                                    onMetadataChange={onMetadataChange}
                                                    onCellVariableChange={handleCellVariableChange}
                                                    allVariables={allVariables}
                                                    errorPortalId={`plot-error-portal-${cell.id}-${i}`}
                                                />
                                            </div>
                                        </div>
                                    );
                                });
                                return panels;
                            })()}
                    </div>
                    {/* Drag handle to resize result panels */}
                    {results && results.some(r => r) && (
                        <div
                            onMouseDown={handleResultResizeStart}
                            className="h-1.5 mt-0.5 cursor-row-resize rounded-full bg-gray-700 hover:bg-cyan-600/50 transition-colors"
                            title="Drag to resize results"
                        />
                    )}
                </div>}
                 <MarkdownSectionEditor
                    section={parsed.conclusion} 
                    defaultTitle="Conclusion" 
                    onUpdate={handleConclusionUpdate} 
                    onAdd={()=> handleConclusionUpdate({title:'Conclusion', content:' '})} 
                    isEditing={editingSection==='conclusion'} 
                    onSetEditing={e=>setEditingSection(e?'conclusion':null)}
                />
            </div>}
            {isDraggingOver === 'bottom' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-cyan-400 z-10" />}
            <PlotHelpModal isOpen={isPlotHelpModalOpen} onClose={() => setIsPlotHelpModalOpen(false)} />
        </div>
    );
};

export default NotebookCell;
