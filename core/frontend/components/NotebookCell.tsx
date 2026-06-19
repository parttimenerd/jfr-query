
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import type { NotebookCellData, NotebookMetadata } from '../types';
import { tokenizeCellContent, reconstructCellContent, parseCellContent, CellSegment, MarkdownSection } from '../utils/notebookParser';

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
    
    const handleBlur = (editor: any) => {
        const newContent = editor.getValue();
        onSetEditing(false);
        if (newContent.trim() === '') {
            onUpdate(null);
        } else {
            onUpdate({ title: section?.title || defaultTitle, content: newContent });
        }
    };
    
    const components = useMemo(() => ({ code: ({ node, inline, className, children, ...props }: any) => { const m = /language-(\w+)/.exec(className||''); return !inline&&(m?.[1]==='sql'||m?.[1]==='plot')?<div className="my-2 border border-gray-700 rounded-md overflow-hidden bg-[#263238]"><StaticCodeHighlighter code={String(children).trim()} language={m[1]}/></div>:<code className="bg-gray-700 text-cyan-300 p-1 rounded-md" {...props}>{children}</code>; } }), []);

    if (!section) return <div className="py-2"><button onClick={onAdd} className="flex items-center gap-1.5 text-xs px-2 py-1 bg-gray-700/50 hover:bg-cyan-600/30 text-gray-400 rounded-md"><PlusIcon className="w-3 h-3"/> Add {defaultTitle}</button></div>;
    return <div>{isEditing ? <SQLEditor value={content} onChange={setContent} onBlur={handleBlur} mode="markdown" autoFocus/> : <div className="space-y-2"><h4 onClick={() => onSetEditing(true)} className="text-sm font-semibold text-gray-400 uppercase tracking-wider cursor-pointer">{section.title}</h4><div onClick={() => onSetEditing(true)} className="prose prose-invert max-w-none p-2 rounded-md hover:bg-gray-700/50 cursor-pointer min-h-[3rem]"><ReactMarkdown components={components}>{section.content}</ReactMarkdown></div></div>}</div>;
};

const VariableEditor: React.FC<{ varKey: string; varValue: string; onChange: (o: string, n: string, v: string) => void; onDelete: (k: string) => void; inputRef: React.RefCallback<HTMLInputElement> }> = ({ varKey, varValue, onChange, onDelete, inputRef }) => {
    const [key, setKey] = useState(varKey);
    const [value, setValue] = useState(varValue);
    const debouncedOnChange = useCallback(debounce(onChange, 800), [onChange]);
    useEffect(() => { setKey(varKey); setValue(varValue); }, [varKey, varValue]);
    return <div className="flex items-center gap-2"><input type="text" value={key} onChange={e=>{setKey(e.target.value);if(e.target.value.startsWith('$')&&e.target.value.length>1)debouncedOnChange(varKey,e.target.value,value);}} onBlur={()=>{if(!key.startsWith('$')||key.length<=1)setKey(varKey);else if(key!==varKey)onChange(varKey,key,value);}} className={`w-1/3 bg-gray-800 border ${key.startsWith('$')&&key.length>1?'border-gray-600':'border-red-500'} rounded-md p-1.5 text-sm font-mono text-cyan-300`}/><span className="text-gray-500">=</span><input type="text" value={value} onChange={e=>{setValue(e.target.value);debouncedOnChange(varKey,key,e.target.value);}} onBlur={()=>{if(value!==varValue)onChange(varKey,key,value);}} className="flex-grow bg-gray-800 border border-gray-600 rounded-md p-1.5 text-sm font-mono" ref={inputRef}/><button onClick={()=>onDelete(varKey)} className="p-1.5 text-gray-500 hover:text-red-400"><TrashIcon className="w-4 h-4"/></button></div>;
};

const Section: React.FC<{ title: string, children: React.ReactNode, actions?: React.ReactNode }> = ({ title, children, actions }) => (<div><div className="flex justify-between items-center mb-2"><h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">{title}</h4>{actions && <div className="flex items-center gap-2">{actions}</div>}</div><div className="space-y-2">{children}</div></div>);

const NotebookCell: React.FC<NotebookCellProps> = ({ cell, allCells, metadata, results, isAutoRunEnabled, collapseTrigger, allCollapsed, isAiFeatureActive, onRunQuery, onUpdate, onDelete, onDeleteQueryBlock, onMoveCell, onSuggestPlot, onFormatCode, onRunPreviewQuery, onMetadataChange, onGlobalVariableClick }) => {
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [isRawEditing, setIsRawEditing] = useState(false);
    const [editingSection, setEditingSection] = useState<'intro' | 'conclusion' | null>(null);
    const [runningStates, setRunningStates] = useState<Record<number, boolean>>({});
    const [pendingRunStates, setPendingRunStates] = useState<Record<number, boolean>>({});
    const [collapsedStates, setCollapsedStates] = useState<Record<string, boolean>>({});
    const [activeChat, setActiveChat] = useState<string | null>(null);
    const [isPlotHelpModalOpen, setIsPlotHelpModalOpen] = useState(false);
    const [isBeingDragged, setIsBeingDragged] = useState(false);
    const [isDraggingOver, setIsDraggingOver] = useState<'top' | 'bottom' | null>(null);
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

    const title = parsed.introduction?.title || cell.title;
    
    const allVariables = useMemo(() => ({ ...metadata.variables, ...parsed.variables }), [metadata.variables, parsed.variables]);

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

    const handleRun = useCallback(async (sql: string, index: number) => {
        if (runTimersRef.current[index]) clearTimeout(runTimersRef.current[index]);
        setPendingRunStates(s => ({ ...s, [index]: false }));
        setRunningStates(s => ({ ...s, [index]: true }));
        await onRunQuery(cell.id, sql, index, allVariables);
        setRunningStates(s => ({ ...s, [index]: false }));
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

        parsed.sqlBlocks.forEach((sql, i) => {
            const sqlChanged = sql.trim() && sql !== prevSqls?.[i];
            const usesVariables = /\$\w+/.test(sql);
            const needsRun = sqlChanged || (usesVariables && variablesChanged);
            if (needsRun) {
                if (runTimersRef.current[i]) clearTimeout(runTimersRef.current[i]);
                setPendingRunStates(s=>({...s,[i]:true}));
                runTimersRef.current[i] = setTimeout(() => {
                    setPendingRunStates(s=>({...s,[i]:false}));
                    handleRun(sql, i);
                }, 1500);
            }
        });
        for (let i = parsed.sqlBlocks.length; i < (prevSqls?.length || 0); i++) if(runTimersRef.current[i]) clearTimeout(runTimersRef.current[i]);
        prevSqlBlocksRef.current = parsed.sqlBlocks;
        prevVariablesRef.current = allVariables;
    }, [parsed.sqlBlocks, allVariables, handleRun, isAutoRunEnabled]);

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
    const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') handleTitleBlur(e.currentTarget.value); else if (e.key === 'Escape') setIsEditingTitle(false); };
    const handleDragStart = (e: React.DragEvent) => { e.dataTransfer.setData('text/plain', cell.id); e.dataTransfer.effectAllowed = 'move'; setIsBeingDragged(true); };
    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); setIsDraggingOver(e.clientY < r.top+r.height/2 ? 'top':'bottom'); };
    const handleDrop = (e: React.DragEvent) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if(id && id !== cell.id && isDraggingOver) onMoveCell(id, cell.id, isDraggingOver==='top'?'before':'after'); setIsDraggingOver(null); };
    const handleApplyCode = (newCode: string, type: 'sql' | 'plot', index: number) => { if(type==='sql') handleSqlChange(newCode, index); else handlePlotChange(newCode, index); setActiveChat(null); };
    const handleApplyPlotFix = (newConfig: string, index: number) => handlePlotChange(newConfig, index);
    const handleAddVariable = () => { let newVarName = '$newVar'; const currentVars = parsed.variables || {}; let i=1; while(currentVars[newVarName]) newVarName = `$newVar${i++}`; handleCellVariableChange({ ...currentVars, [newVarName]:''}); setFocusVarName(newVarName); };
    const handleDeleteVariable = (k:string) => { const v = {...(parsed.variables||{})}; delete v[k]; handleCellVariableChange(v);};
    const handleVariableChange = (o:string,n:string,v:string) => { const vars:Record<string,string>={}; for(const k in (parsed.variables||{})) { if(k===o) vars[n]=v; else vars[k]=parsed.variables![k]; } handleCellVariableChange(vars); };
    
    const handleVariableClick = (varName: string) => {
        if (varName.startsWith('$$')) { onGlobalVariableClick(varName); return; }
        const focusLocalVar = () => { if (isVariablesCollapsed) { setIsVariablesCollapsed(false); setTimeout(() => variableInputRefs.current[varName]?.focus(), 100); } else { variableInputRefs.current[varName]?.focus(); } };
        if (varName in (parsed.variables || {})) { focusLocalVar(); } else { handleCellVariableChange({...(parsed.variables||{}), [varName]: ''}); setTimeout(focusLocalVar, 100); }
    };
    
    return (
        <div className={`bg-gray-800/50 rounded-lg border border-gray-700 shadow-md relative transition-opacity ${isBeingDragged ? 'opacity-50' : ''}`} onDragOver={handleDragOver} onDragLeave={()=>setIsDraggingOver(null)} onDrop={handleDrop}>
            {isDraggingOver === 'top' && <div className="absolute top-0 left-0 right-0 h-1 bg-cyan-400 z-10" />}
            <div className="p-3 border-b border-gray-700 flex items-center justify-between bg-gray-700/30">
                <div className="flex items-center gap-2 w-full">
                     <div draggable onDragStart={handleDragStart} onDragEnd={()=>setIsBeingDragged(false)} className="cursor-grab p-1 text-gray-500 hover:text-gray-200"><Bars2Icon className="w-5 h-5"/></div>
                    {isEditingTitle ? <input type="text" defaultValue={title} onBlur={e => handleTitleBlur(e.target.value)} onKeyDown={handleTitleKeyDown} className="text-lg font-semibold bg-gray-900 border border-cyan-500 rounded-md px-2 py-1 w-full" autoFocus/> : <h2 onClick={()=>setIsEditingTitle(true)} className="text-lg font-semibold cursor-pointer w-full">{title}</h2>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0"><button onClick={()=>setIsRawEditing(!isRawEditing)} className="p-1.5 hover:bg-cyan-600/30 rounded-md" title={isRawEditing?"Rich View":"Raw Markdown"}>{isRawEditing ? <EyeIcon className="w-5 h-5 text-cyan-300"/>:<CodeBracketIcon className="w-5 h-5 text-gray-400"/>}</button><button onClick={onDelete} className="p-1.5 hover:bg-red-600/50 rounded-md" title="Delete Cell"><TrashIcon className="w-5 h-5 text-gray-400"/></button></div>
            </div>
            {isRawEditing ? <div className="p-2"><SQLEditor value={reconstructCellContent(segments)} onChange={handleRawContentChange} mode="markdown"/></div> : <div className="p-4 space-y-6">
                 <MarkdownSectionEditor 
                    section={parsed.introduction} 
                    defaultTitle="Introduction" 
                    onUpdate={handleIntroUpdate} 
                    onAdd={()=> handleIntroUpdate({title:'Introduction', content:'## Title\n\n '})} 
                    isEditing={editingSection==='intro'} 
                    onSetEditing={e=>setEditingSection(e?'intro':null)}
                />

                <CollapsibleBlock title={`Cell Variables (${Object.keys(parsed.variables||{}).length})`} isCollapsed={isVariablesCollapsed} onToggle={()=>setIsVariablesCollapsed(!isVariablesCollapsed)} preview="" controls={<button onClick={handleAddVariable} className="flex items-center gap-1.5 text-xs px-2 py-1 bg-gray-700 rounded-md"><PlusIcon className="w-3 h-3"/> Add</button>}><div className="p-3"><div className="space-y-2">{Object.entries(parsed.variables||{}).map(([k,v])=><VariableEditor key={k} varKey={k} varValue={v} onChange={handleVariableChange} onDelete={handleDeleteVariable} inputRef={el => { variableInputRefs.current[k] = el; }}/>)}</div>{Object.keys(parsed.variables||{}).length===0 && <p className="text-sm text-gray-500 text-center py-2">No local variables. Use '$' prefix.</p>}</div></CollapsibleBlock>
                
                <Section title="SQL Queries" actions={<button onClick={handleAddSql} className="flex items-center gap-1.5 text-xs px-2 py-1 bg-gray-700 rounded-md"><PlusIcon className="w-3 h-3"/> Add SQL</button>}>
                    {parsed.sqlBlocks.map((sql, i) => {
                        const sqlError = results[i]?.[0]?.error;
                        return (
                        <CollapsibleBlock key={`sql-${i}`} title={`Query ${i+1}`} preview={sql.replace(/\s+/g,' ').substring(0,60)} isCollapsed={!!collapsedStates[`sql-${i}`]} onToggle={()=>toggleCollapse(`sql-${i}`)} statusIndicator={runningStates[i]?(<div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"/>):pendingRunStates[i]?(<div className="w-4 h-4 text-gray-500 animate-pulse">...</div>):null} controls={<><button onClick={()=>handleRun(sql,i)} disabled={runningStates[i]||pendingRunStates[i]} className="p-1.5 rounded-md disabled:opacity-50"><PlayIcon className="w-4 h-4 text-green-400"/></button>{isAiFeatureActive && <><button onClick={()=>handleSuggest(sql,i)} className="p-1.5 rounded-md"><SparklesIcon className="w-4 h-4 text-yellow-400"/></button><button onClick={()=>handleFormat(sql,'sql',i)} className="p-1.5 rounded-md"><AiFormatIcon className="w-4 h-4 text-cyan-400"/></button><button onClick={()=>setActiveChat(p=>p===`sql-${i}`?null:`sql-${i}`)} className="p-1.5 rounded-md"><ChatBubbleSparklesIcon className="w-4 h-4 text-purple-400"/></button></>}<button onClick={()=>onDeleteQueryBlock(i)} className="p-1.5 rounded-md"><TrashIcon className="w-4 h-4 text-gray-400"/></button></>}>
                            <SQLEditor value={sql} onChange={handleSqlChange} index={i} variables={allVariables} onVariableClick={handleVariableClick} metadata={metadata} />
                            {sqlError && (
                                <div className="mt-2 p-3 text-sm text-red-400 bg-red-900/30 font-mono rounded-md whitespace-pre-wrap animate-fade-in">
                                    {String(sqlError)}
                                </div>
                            )}
                            {isAiFeatureActive && activeChat===`sql-${i}` && <InlineChat isAiFeatureActive={isAiFeatureActive} metadata={metadata} targetType="sql" targetValue={sql} cellContext={cell} allCells={allCells} onApplyCode={c=>handleApplyCode(c,'sql',i)} onClose={()=>setActiveChat(null)}/>}
                        </CollapsibleBlock>
                        );
                    })}
                    {parsed.sqlBlocks.length===0 && <p className="text-sm text-gray-500 text-center py-2">No SQL queries.</p>}
                </Section>
                <Section title="Plot Configs" actions={<div className="flex items-center gap-2"><button onClick={()=>setIsPlotHelpModalOpen(true)} className="p-1.5 text-gray-400 rounded-md"><InformationCircleIcon className="w-4 h-4"/></button>{parsed.plotBlocks.length<parsed.sqlBlocks.length && <button onClick={handleAddPlot} className="flex items-center gap-1.5 text-xs px-2 py-1 bg-gray-700 rounded-md"><PlusIcon className="w-3 h-3"/> Add Plot</button>}</div>}>
                    {parsed.plotBlocks.map((config,i)=>(<CollapsibleBlock key={`plot-${i}`} title={`Plot ${i+1}`} preview={config.replace(/\s+/g,' ').substring(0,60)} isCollapsed={!!collapsedStates[`plot-${i}`]} onToggle={()=>toggleCollapse(`plot-${i}`)} controls={<><button onClick={()=>handleFormat(config,'plot',i)} className="p-1.5 rounded-md"><DocumentFormattingIcon className="w-4 h-4 text-cyan-400"/></button>{isAiFeatureActive && <button onClick={()=>setActiveChat(p=>p===`plot-${i}`?null:`plot-${i}`)} className="p-1.5 rounded-md"><ChatBubbleSparklesIcon className="w-4 h-4 text-purple-400"/></button>}</>}><PlotConfigEditor value={config} onChange={handlePlotChange} index={i} data={results[i]} variables={allVariables} onVariableClick={handleVariableClick}/>
                    <div id={`plot-error-portal-${cell.id}-${i}`} />
                    {isAiFeatureActive && activeChat===`plot-${i}`&&<InlineChat isAiFeatureActive={isAiFeatureActive} metadata={metadata} targetType="plot" targetValue={config} cellContext={cell} allCells={allCells} sql={parsed.sqlBlocks[i]} data={results[i]} onApplyCode={c=>handleApplyCode(c,'plot',i)} onClose={()=>setActiveChat(null)} onMetadataChange={onMetadataChange} />}</CollapsibleBlock>))}
                    {parsed.plotBlocks.length===0 && <p className="text-sm text-gray-500 text-center py-2">No plot configs.</p>}
                </Section>
                <Section title="Results">
                    <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-2 space-y-4">
                        {results && results.some(r => r) ? (
                            results.map((r, i) => {
                                if (!r) return null;
                                const plotConfig = parsed.plotBlocks[i];
                                if (plotConfig === '') return null;
                                const configToRender = plotConfig ?? 'TABLE()';

                                return (
                                    <div key={`r-${i}`} className="border-t border-gray-700 first:border-t-0 h-[250px] flex flex-col">
                                        <h5 className="text-xs font-semibold text-gray-400 p-2 shrink-0">Result for Query {i + 1}</h5>
                                        <div className="flex-grow overflow-auto">
                                            <PlotRenderer
                                                config={configToRender}
                                                data={r}
                                                sql={parsed.sqlBlocks[i]}
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
                            })
                        ) : (
                            <p className="text-sm text-gray-500 text-center py-4">Run a query to see results.</p>
                        )}
                    </div>
                </Section>
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
