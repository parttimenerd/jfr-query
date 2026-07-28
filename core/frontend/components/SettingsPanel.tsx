
import React, { useState, useRef, useContext, forwardRef, useImperativeHandle, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import type { CustomView, CustomMacro, NotebookMetadata } from '../types';
import SQLEditor from './SQLEditor';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { ChevronUpIcon } from './icons/ChevronUpIcon';
import { ViewIcon } from './icons/ViewIcon';
import { CodeBracketIcon } from './icons/CodeBracketIcon';
import { PlusIcon } from './icons/PlusIcon';
import { PencilIcon } from './icons/PencilIcon';
import { TrashIcon } from './icons/TrashIcon';
import { SettingsContext } from '../context/SettingsContext';
import { DocumentTextIcon } from './icons/DocumentTextIcon';
import { WandSparklesIcon } from './icons/WandSparklesIcon';

const SURPRISE_PROMPTS = [
    "You are a grizzled pirate captain who's found a treasure map in this data. Your responses should be enthusiastic and full of pirate slang.",
    "You are a meticulous, slightly-panicked scientist from a 1950s sci-fi movie.",
    "You are a Shakespearean playwright. Respond in iambic pentameter and use flowery, dramatic language, as well as old english sounding column names when you need a new name.",
    "You are a sarcastic, hard-boiled film noir detective from the 1940s. Be cynical and world-weary.",
    "You are a calm, soothing nature documentary narrator, like David Attenborough. Use animal and biology methaphors.",
    "You are a grumpy cat who has been forced to analyze data. Your responses should be short, begrudging, and slightly annoyed, but ultimately correct.",
    "You are a wise, cryptic oracle speaking in riddles. Your answers are always correct but phrased as mysterious prophecies about the queries and plots.",
    "You are a meticulous and stern librarian. You demand precision in queries and will shush the user if they are not specific enough.",
    "You are an alien anthropologist trying to understand human behavior through the data schema. Express confusion and fascination with our strange customs.",
    "You are a world-class gourmet chef. Talk if you were preparing a fine meal, with columns as ingredients and queries as recipes.",
];

const SimpleSyntaxHighlighter: React.FC<{ code: string }> = ({ code }) => {
    const keywords = new Set(['SELECT','FROM','WHERE','GROUP','BY','ORDER','LIMIT','AS','CASE','WHEN','END','JOIN','ON','AND','OR','IN','NOT','NULL','TRUE','FALSE','CREATE','REPLACE','MACRO','VIEW']);
    return <pre className="p-2 text-xs overflow-x-auto font-mono whitespace-pre-wrap"><code>{code.split(/(\s+|[(),])/g).filter(Boolean).map((part, i) => keywords.has(part.toUpperCase()) ? <span key={i} className="text-purple-400">{part}</span> : <span key={i} className="text-cyan-400">{part}</span>)}</code></pre>;
};

const TooltipContent: React.FC<{ item: CustomView | CustomMacro, type: 'view' | 'macro' }> = ({ item, type }) => (
    <div className="space-y-2"><p className="font-semibold text-cyan-300 flex items-center gap-1.5">{type==='view'?<ViewIcon className="w-4 h-4"/>:<CodeBracketIcon className="w-4 h-4"/>}{item.name}</p>{item.sql && <div className="relative pt-2"><h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Definition</h4><div className="relative bg-gray-900/70 rounded-md border border-gray-600"><SimpleSyntaxHighlighter code={item.sql}/></div></div>}</div>
);

// B-039: module-level counter persists across panel unmount/remount so cycling
// through "Surprise Me!" prompts doesn't reset when the settings panel is closed.
let suggestionIndexCounter = 0;

interface SettingsPanelProps {
    metadata: NotebookMetadata;
    onMetadataChange: (newMetadata: NotebookMetadata) => Promise<void>;
    onRunPreviewQuery: (query: string) => Promise<any[]>;
    isAiFeatureActive: boolean;
}

const SettingsPanel = forwardRef<any, SettingsPanelProps>(({ metadata, onMetadataChange, isAiFeatureActive }, ref) => {
    const { settings: globalSettings } = useContext(SettingsContext);
    const [isPanelCollapsed, setIsPanelCollapsed] = useState(true);
    const [isGeneralCollapsed, setIsGeneralCollapsed] = useState(true);
    const [isVariablesCollapsed, setIsVariablesCollapsed] = useState(true);
    const [isViewsCollapsed, setIsViewsCollapsed] = useState(true);
    const [isMacrosCollapsed, setIsMacrosCollapsed] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [editingSql, setEditingSql] = useState('');
    const [tooltip, setTooltip] = useState<{ visible: boolean; content: React.ReactNode; top: number; left: number } | null>(null);
    const hideTimeout = useRef<number | null>(null);
    const [suggestionIndex, setSuggestionIndex] = useState(() => suggestionIndexCounter);
    const variableInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
    const pendingFocusVar = useRef<string | null>(null);

    useImperativeHandle(ref, () => ({
        focusVariable: (name: string) => {
            // Ensure the section is open, then focus the matching input.
            // If the variable doesn't exist yet, create it first.
            const exists = !!(metadata.variables && name in metadata.variables);
            pendingFocusVar.current = name;
            setIsVariablesCollapsed(false);
            if (!exists) {
                // Async create — the useEffect below retries focus once metadata.variables updates.
                onMetadataChange({ ...metadata, variables: { ...(metadata.variables || {}), [name]: '' } });
            } else {
                // Variable already in DOM; try immediately then let effect retry if needed.
                setTimeout(() => {
                    const el = variableInputRefs.current[name];
                    if (el) { el.focus(); el.select(); pendingFocusVar.current = null; }
                }, 50);
            }
        }
    }), [metadata, onMetadataChange]);

    // After variables render, if a focus is pending, apply it.
    useEffect(() => {
        const name = pendingFocusVar.current;
        if (!name) return;
        const el = variableInputRefs.current[name];
        if (el) { el.focus(); el.select(); pendingFocusVar.current = null; }
    }, [metadata.variables, isVariablesCollapsed]);

    // Clear any stale tooltip when the view/macro list changes (e.g., after deletion).
    useEffect(() => {
        if (hideTimeout.current) clearTimeout(hideTimeout.current);
        setTooltip(null);
    }, [metadata.views, metadata.macros]);

    useEffect(() => {
        return () => { if (hideTimeout.current) clearTimeout(hideTimeout.current); };
    }, []);

    const globalVars = metadata.variables || {};
    const handleAddGlobalVariable = () => {
        let name = 'newVar';
        let i = 1;
        while (globalVars[name]) name = `newVar${i++}`;
        onMetadataChange({ ...metadata, variables: { ...globalVars, [name]: '' } });
        pendingFocusVar.current = name;
        setIsVariablesCollapsed(false);
    };
    const handleDeleteGlobalVariable = (name: string) => {
        const next = { ...globalVars };
        delete next[name];
        onMetadataChange({ ...metadata, variables: next });
    };
    const handleRenameGlobalVariable = (oldName: string, newName: string, inputEl?: HTMLInputElement | null) => {
        if (!newName || oldName === newName) {
            if (inputEl) inputEl.value = oldName;
            return;
        }
        if (newName in globalVars) {
            // Reject: reset the input back to the committed key so it doesn't show a stale name.
            if (inputEl) inputEl.value = oldName;
            return;
        }
        const next: Record<string, string> = {};
        for (const k of Object.keys(globalVars)) {
            if (k === oldName) next[newName] = globalVars[k];
            else next[k] = globalVars[k];
        }
        onMetadataChange({ ...metadata, variables: next });
    };
    const handleChangeGlobalVariableValue = (name: string, value: string) => {
        onMetadataChange({ ...metadata, variables: { ...globalVars, [name]: value } });
    };

    const handleMetadataFieldChange = (field: keyof NotebookMetadata, value: any) => { onMetadataChange({ ...metadata, [field]: value }); };
    const handleAdd = (type: 'view' | 'macro') => { const newItem = { id: `${type}-${Date.now()}`, name: type==='view'?'NewView':'NewMacro', sql: type==='view'?'SELECT 1;':'a + b' }; onMetadataChange(type==='view'?{...metadata, views:[...metadata.views, newItem]}:{...metadata, macros:[...metadata.macros, newItem]}).then(() => handleEdit(type,newItem)).catch(err => console.error('Failed to add item to notebook:', err)); };
    const handleDelete = (type: 'view' | 'macro', id: string) => { onMetadataChange(type==='view'?{...metadata, views:metadata.views.filter(i=>i.id!==id)}:{...metadata, macros:metadata.macros.filter(i=>i.id!==id)}); };
    const handleEdit = (type: 'view' | 'macro', item: CustomView | CustomMacro) => { setEditingId(item.id); setEditingName(item.name); setEditingSql(item.sql); };
    const handleCancel = () => { setEditingId(null); setEditingName(''); setEditingSql(''); };
    const handleSave = async (type: 'view' | 'macro') => { if (!editingId) return; const newItems = (type==='view'?metadata.views:metadata.macros).map(i => i.id===editingId?{...i,name:editingName,sql:editingSql}:i); await onMetadataChange(type==='view'?{...metadata, views:newItems as CustomView[]}:{...metadata, macros:newItems as CustomMacro[]}); handleCancel(); };
    
    const handleShowTooltip = (e: React.MouseEvent, content: React.ReactNode) => {
        if (hideTimeout.current) clearTimeout(hideTimeout.current);
        
        const margin = 5;
        const tooltipMaxWidth = 320; // max-w-xs
        const tooltipMaxHeight = 250; // A reasonable estimate
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let top = e.clientY + margin;
        let left = e.clientX + margin;

        if (top + tooltipMaxHeight > viewportHeight) {
            top = e.clientY - tooltipMaxHeight - margin;
            if (top < 0) top = margin;
        }

        if (left + tooltipMaxWidth > viewportWidth) {
            left = e.clientX - tooltipMaxWidth - margin;
            if (left < 0) left = margin;
        }

        setTooltip({ visible: true, content, top, left });
    };
    
    const handleHideTooltip = () => {
        if (hideTimeout.current) clearTimeout(hideTimeout.current);
        hideTimeout.current = window.setTimeout(() => setTooltip(null), 100);
    };
    const handleSuggestPrompt = () => {
        const nextIndex = suggestionIndex % SURPRISE_PROMPTS.length;
        handleMetadataFieldChange('customSystemPrompt', SURPRISE_PROMPTS[nextIndex]);
        const newIndex = nextIndex + 1;
        suggestionIndexCounter = newIndex;
        setSuggestionIndex(newIndex);
    };

    const renderEditableItem = (type: 'view' | 'macro', item: CustomView | CustomMacro) => { if (editingId === item.id) { return (<div className="p-2 bg-gray-700/50 rounded-md space-y-2"><input type="text" value={editingName} onChange={e=>setEditingName(e.target.value)} className="w-full bg-gray-800 p-1.5 text-sm"/><div className="border border-gray-600 rounded-md"><SQLEditor value={editingSql} onChange={setEditingSql} variables={metadata.variables} metadata={metadata} /></div><div className="flex justify-end gap-2"><button onClick={handleCancel} className="px-2 py-1 text-xs bg-gray-600 rounded">Cancel</button><button onClick={()=>handleSave(type)} className="px-2 py-1 text-xs bg-cyan-600 rounded">Save</button></div></div>); } return (<div className="flex justify-between items-center p-2 hover:bg-gray-700/50 rounded-md" onMouseEnter={e=>handleShowTooltip(e,<TooltipContent item={item} type={type}/>)} onMouseLeave={handleHideTooltip}><span className="font-mono text-sm">{item.name}</span><div className="flex items-center gap-2"><button onClick={()=>handleEdit(type,item)} title={`Edit ${type}`} className="p-1 text-gray-400 hover:text-cyan-400"><PencilIcon className="w-4 h-4"/></button><button onClick={()=>handleDelete(type,item.id)} title={`Delete ${type}`} className="p-1 text-gray-400 hover:text-red-400"><TrashIcon className="w-4 h-4"/></button></div></div>); };
    const hasContent = Object.keys(globalVars).length > 0 || metadata.views.length > 0 || metadata.macros.length > 0;

    return (<><div className="border border-gray-700/60 rounded-lg overflow-hidden">
        {/* Single top-level toggle row */}
        <div className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-700/20" onClick={() => setIsPanelCollapsed(!isPanelCollapsed)}>
            <h3 className="flex items-center gap-2 text-xs font-medium text-gray-500">
                <DocumentTextIcon className="w-3.5 h-3.5"/>
                Notebook Settings
                {hasContent && <span className="text-cyan-500/70">·</span>}
                {Object.keys(globalVars).length > 0 && <span className="text-gray-600">{Object.keys(globalVars).length} var{Object.keys(globalVars).length !== 1 ? 's' : ''}</span>}
                {metadata.views.length > 0 && <span className="text-gray-600">{metadata.views.length} view{metadata.views.length !== 1 ? 's' : ''}</span>}
                {metadata.macros.length > 0 && <span className="text-gray-600">{metadata.macros.length} macro{metadata.macros.length !== 1 ? 's' : ''}</span>}
            </h3>
            {isPanelCollapsed ? <ChevronDownIcon className="w-3.5 h-3.5 text-gray-600"/> : <ChevronUpIcon className="w-3.5 h-3.5 text-gray-600"/>}
        </div>
        {!isPanelCollapsed && <div className="divide-y divide-gray-700/60 animate-fade-in-down">
            <div><div className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-700/20" onClick={()=>setIsGeneralCollapsed(!isGeneralCollapsed)}><h3 className="flex items-center gap-2 text-sm font-medium text-gray-400"><DocumentTextIcon className="w-3.5 h-3.5"/>Settings</h3>{isGeneralCollapsed?<ChevronDownIcon className="w-3.5 h-3.5 text-gray-500"/>:<ChevronUpIcon className="w-3.5 h-3.5 text-gray-500"/>}</div>{!isGeneralCollapsed && <div className="px-3 pb-3 pt-1 space-y-4 animate-fade-in-down">{isAiFeatureActive && (<div><div className="flex items-center justify-between mb-1"><label htmlFor="customSystemPrompt" className="text-sm font-medium text-gray-300 block">Custom System Prompt</label><button onClick={handleSuggestPrompt} className="flex items-center gap-1.5 text-xs px-2 py-1 bg-gray-700/50 hover:bg-cyan-600/30 text-gray-400 rounded-md" title="Suggest a fun prompt" aria-label="Suggest a fun prompt"><WandSparklesIcon className="w-4 h-4"/>Surprise Me!</button></div><textarea id="customSystemPrompt" name="customSystemPrompt" value={metadata.customSystemPrompt || ''} onChange={e => handleMetadataFieldChange('customSystemPrompt', e.target.value)} rows={3} className="w-full bg-gray-800 border border-gray-600 rounded-md p-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500" placeholder="e.g., You are a helpful Garbage Collection expert."/><p className="mt-1 text-xs text-gray-500">Adds instructions to the AI chat assistant for this notebook.</p></div>)}<div className="grid grid-cols-1 md:grid-cols-2 gap-6"><div><label htmlFor="timeFormat" className="text-sm font-medium text-gray-300 block mb-1">Timestamp Format</label><input id="timeFormat" name="timeFormat" type="text" value={metadata.timeFormat || ''} placeholder={globalSettings.timeFormat} onChange={e => handleMetadataFieldChange('timeFormat', e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded-md p-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500" /><p className="mt-1 text-xs text-gray-500">Default: YYYY, MM, DD, HH, mm, ss, SSS</p></div><div><label htmlFor="decimalPlaces" className="text-sm font-medium text-gray-300 block mb-1">Max Decimal Places</label><input id="decimalPlaces" name="decimalPlaces" type="number" min="0" max="20" value={metadata.decimalPlaces ?? ''} placeholder={String(globalSettings.decimalPlaces)} onChange={e => { const v = parseInt(e.target.value, 10); handleMetadataFieldChange('decimalPlaces', e.target.value === '' || isNaN(v) ? undefined : v); }} className="w-full bg-gray-800 border border-gray-600 rounded-md p-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500" /><p className="mt-1 text-xs text-gray-500">For numbers in tables and plots.</p></div></div></div>}</div>

            <div>
                <div className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-700/20" onClick={()=>setIsVariablesCollapsed(!isVariablesCollapsed)}>
                    <h3 className="flex items-center gap-2 text-sm font-medium text-gray-400"><CodeBracketIcon className="w-3.5 h-3.5"/>Notebook Variables ({Object.keys(globalVars).length})</h3>
                    {isVariablesCollapsed?<ChevronDownIcon className="w-3.5 h-3.5 text-gray-500"/>:<ChevronUpIcon className="w-3.5 h-3.5 text-gray-500"/>}
                </div>
                {!isVariablesCollapsed && <div className="px-3 pb-3 space-y-2 animate-fade-in-down">
                    <p className="text-xs text-gray-500">Notebook-scoped variables (use <code className="font-mono bg-gray-800 px-1 rounded">$$name</code> in SQL or plot configs). They flow into custom views/macros and are saved with the notebook.</p>
                    {Object.entries(globalVars).map(([k, v]) => (
                        <div key={k} className="flex items-center gap-2">
                            <input
                                type="text"
                                defaultValue={k}
                                onBlur={e => handleRenameGlobalVariable(k, e.target.value.trim(), e.target)}
                                ref={el => { if (el) variableInputRefs.current[k] = el; else delete variableInputRefs.current[k]; }}
                                className="w-1/3 bg-gray-800 border border-gray-600 rounded-md p-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                placeholder="$$name"
                            />
                            <input
                                type="text"
                                value={v}
                                onChange={e => handleChangeGlobalVariableValue(k, e.target.value)}
                                className="flex-grow bg-gray-800 border border-gray-600 rounded-md p-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                placeholder="value"
                            />
                            <button onClick={() => handleDeleteGlobalVariable(k)} className="p-1 text-gray-400 hover:text-red-400" title="Delete variable" aria-label="Delete variable"><TrashIcon className="w-4 h-4"/></button>
                        </div>
                    ))}
                    {Object.keys(globalVars).length === 0 && <p className="text-sm text-gray-500 text-center py-2">No notebook variables.</p>}
                    <div className="pt-1"><button onClick={handleAddGlobalVariable} className="flex items-center gap-1.5 text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded-md"><PlusIcon className="w-3 h-3"/> Add Variable</button></div>
                </div>}
            </div>

            <div><div className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-700/20" onClick={()=>setIsViewsCollapsed(!isViewsCollapsed)}><h3 className="flex items-center gap-2 text-sm font-medium text-gray-400"><ViewIcon className="w-3.5 h-3.5"/>Views ({metadata.views.length})</h3>{isViewsCollapsed?<ChevronDownIcon className="w-3.5 h-3.5 text-gray-500"/>:<ChevronUpIcon className="w-3.5 h-3.5 text-gray-500"/>}</div>{!isViewsCollapsed && <div className="animate-fade-in-down">{metadata.views.map(v=><div key={v.id}>{renderEditableItem('view',v)}</div>)}<div className="px-3 py-2"><button onClick={()=>handleAdd('view')} className="flex items-center gap-1.5 text-xs px-2 py-1 bg-gray-700 rounded-md"><PlusIcon className="w-3 h-3"/> Add</button></div></div>}</div>
            <div><div className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-700/20" onClick={()=>setIsMacrosCollapsed(!isMacrosCollapsed)}><h3 className="flex items-center gap-2 text-sm font-medium text-gray-400"><CodeBracketIcon className="w-3.5 h-3.5"/>Custom Macros ({metadata.macros.length})</h3>{isMacrosCollapsed?<ChevronDownIcon className="w-3.5 h-3.5 text-gray-500"/>:<ChevronUpIcon className="w-3.5 h-3.5 text-gray-500"/>}</div>{!isMacrosCollapsed && <div className="animate-fade-in-down">{metadata.macros.map(m=><div key={m.id}>{renderEditableItem('macro',m)}</div>)}<div className="px-3 py-2"><button onClick={()=>handleAdd('macro')} className="flex items-center gap-1.5 text-xs px-2 py-1 bg-gray-700 rounded-md"><PlusIcon className="w-3 h-3"/> Add</button></div></div>}</div>
        </div>}
    </div>{tooltip?.visible && ReactDOM.createPortal(<div style={{top:tooltip.top,left:tooltip.left}} className="fixed z-[100] p-2 bg-gray-700 border border-gray-600 rounded shadow-lg w-auto max-w-xs animate-fade-in" onMouseEnter={()=>{if(hideTimeout.current)clearTimeout(hideTimeout.current);}} onMouseLeave={handleHideTooltip}>{tooltip.content}</div>, document.body)}</>);
});

export default React.memo(SettingsPanel);
