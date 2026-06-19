
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

interface SettingsPanelProps {
    metadata: NotebookMetadata;
    onMetadataChange: (newMetadata: NotebookMetadata) => Promise<void>;
    onRunPreviewQuery: (query: string) => Promise<any[]>;
    isAiFeatureActive: boolean;
}

const SettingsPanel = forwardRef<any, SettingsPanelProps>(({ metadata, onMetadataChange, isAiFeatureActive }, ref) => {
    const { settings: globalSettings } = useContext(SettingsContext);
    const [isGeneralCollapsed, setIsGeneralCollapsed] = useState(true);
    const [isViewsCollapsed, setIsViewsCollapsed] = useState(true);
    const [isMacrosCollapsed, setIsMacrosCollapsed] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [editingSql, setEditingSql] = useState('');
    const [tooltip, setTooltip] = useState<{ visible: boolean; content: React.ReactNode; top: number; left: number } | null>(null);
    const hideTimeout = useRef<number | null>(null);
    const [suggestionIndex, setSuggestionIndex] = useState(0);

    useImperativeHandle(ref, () => ({
        focusVariable: (name: string) => {
            console.log("Focus variable request:", name);
            // Placeholder for future implementation
        }
    }));

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
    
    const handleHideTooltip = () => { hideTimeout.current = window.setTimeout(() => setTooltip(null), 100); };
    const handleSuggestPrompt = () => { const nextIndex = suggestionIndex % SURPRISE_PROMPTS.length; const newPrompt = SURPRISE_PROMPTS[nextIndex]; handleMetadataFieldChange('customSystemPrompt', newPrompt); setSuggestionIndex(nextIndex + 1); };

    const renderEditableItem = (type: 'view' | 'macro', item: CustomView | CustomMacro) => { if (editingId === item.id) { return (<div className="p-2 bg-gray-700/50 rounded-md space-y-2"><input type="text" value={editingName} onChange={e=>setEditingName(e.target.value)} className="w-full bg-gray-800 p-1.5 text-sm"/><div className="border border-gray-600 rounded-md"><SQLEditor value={editingSql} onChange={setEditingSql} /></div><div className="flex justify-end gap-2"><button onClick={handleCancel} className="px-2 py-1 text-xs bg-gray-600 rounded">Cancel</button><button onClick={()=>handleSave(type)} className="px-2 py-1 text-xs bg-cyan-600 rounded">Save</button></div></div>); } return (<div className="flex justify-between items-center p-2 hover:bg-gray-700/50 rounded-md" onMouseEnter={e=>handleShowTooltip(e,<TooltipContent item={item} type={type}/>)} onMouseLeave={handleHideTooltip}><span className="font-mono text-sm">{item.name}</span><div className="flex items-center gap-2"><button onClick={()=>handleEdit(type,item)} className="p-1 text-gray-400 hover:text-cyan-400"><PencilIcon className="w-4 h-4"/></button><button onClick={()=>handleDelete(type,item.id)} className="p-1 text-gray-400 hover:text-red-400"><TrashIcon className="w-4 h-4"/></button></div></div>); };
    
    return (<div className="bg-gray-800/50 rounded-lg border border-gray-700"><div className="p-4 space-y-4">
        <div className="bg-gray-900/50 rounded-lg border border-gray-700"><div className="p-2 border-b border-gray-700 flex items-center justify-between cursor-pointer" onClick={()=>setIsGeneralCollapsed(!isGeneralCollapsed)}><h3 className="flex items-center gap-2 text-sm font-semibold"><DocumentTextIcon className="w-4 h-4"/>Notebook Settings</h3>{isGeneralCollapsed?<ChevronDownIcon className="w-4 h-4"/>:<ChevronUpIcon className="w-4 h-4"/>}</div>{!isGeneralCollapsed && <div className="p-4 space-y-4 animate-fade-in-down">{isAiFeatureActive && (<div><div className="flex items-center justify-between mb-1"><label htmlFor="customSystemPrompt" className="text-sm font-medium text-gray-300 block">Custom System Prompt</label><button onClick={handleSuggestPrompt} className="flex items-center gap-1.5 text-xs px-2 py-1 bg-gray-700/50 hover:bg-cyan-600/30 text-gray-400 rounded-md" title="Suggest a fun prompt"><WandSparklesIcon className="w-4 h-4"/>Surprise Me!</button></div><textarea id="customSystemPrompt" name="customSystemPrompt" value={metadata.customSystemPrompt || ''} onChange={e => handleMetadataFieldChange('customSystemPrompt', e.target.value)} rows={3} className="w-full bg-gray-800 border border-gray-600 rounded-md p-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500" placeholder="e.g., You are a helpful Garbage Collection expert."/><p className="mt-1 text-xs text-gray-500">Adds instructions to the AI chat assistant for this notebook.</p></div>)}<div className="grid grid-cols-1 md:grid-cols-2 gap-6"><div><label htmlFor="timeFormat" className="text-sm font-medium text-gray-300 block mb-1">Timestamp Format</label><input id="timeFormat" name="timeFormat" type="text" value={metadata.timeFormat || ''} placeholder={globalSettings.timeFormat} onChange={e => handleMetadataFieldChange('timeFormat', e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded-md p-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500" /><p className="mt-1 text-xs text-gray-500">Default: YYYY, MM, DD, HH, mm, ss, SSS</p></div><div><label htmlFor="decimalPlaces" className="text-sm font-medium text-gray-300 block mb-1">Max Decimal Places</label><input id="decimalPlaces" name="decimalPlaces" type="number" min="0" max="20" value={metadata.decimalPlaces ?? ''} placeholder={String(globalSettings.decimalPlaces)} onChange={e => handleMetadataFieldChange('decimalPlaces', e.target.value === '' ? undefined : parseInt(e.target.value, 10))} className="w-full bg-gray-800 border border-gray-600 rounded-md p-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500" /><p className="mt-1 text-xs text-gray-500">For numbers in tables and plots.</p></div></div></div>}</div>

        <div className="bg-gray-900/50 rounded-lg border border-gray-700"><div className="p-2 border-b border-gray-700 flex items-center justify-between cursor-pointer" onClick={()=>setIsViewsCollapsed(!isViewsCollapsed)}><h3 className="flex items-center gap-2 text-sm font-semibold"><ViewIcon className="w-4 h-4"/>Custom Views ({metadata.views.length})</h3>{isViewsCollapsed?<ChevronDownIcon className="w-4 h-4"/>:<ChevronUpIcon className="w-4 h-4"/>}</div>{!isViewsCollapsed && <div className="animate-fade-in-down">{metadata.views.map(v=><div key={v.id}>{renderEditableItem('view',v)}</div>)}<div className="p-2 border-t border-gray-700 mt-2"><button onClick={()=>handleAdd('view')} className="flex items-center gap-1.5 text-xs px-2 py-1 bg-gray-700 rounded-md"><PlusIcon className="w-3 h-3"/> Add</button></div></div>}</div>
        <div className="bg-gray-900/50 rounded-lg border border-gray-700"><div className="p-2 border-b border-gray-700 flex items-center justify-between cursor-pointer" onClick={()=>setIsMacrosCollapsed(!isMacrosCollapsed)}><h3 className="flex items-center gap-2 text-sm font-semibold"><CodeBracketIcon className="w-4 h-4"/>Custom Macros ({metadata.macros.length})</h3>{isMacrosCollapsed?<ChevronDownIcon className="w-4 h-4"/>:<ChevronUpIcon className="w-4 h-4"/>}</div>{!isMacrosCollapsed && <div className="animate-fade-in-down">{metadata.macros.map(m=><div key={m.id}>{renderEditableItem('macro',m)}</div>)}<div className="p-2 border-t border-gray-700 mt-2"><button onClick={()=>handleAdd('macro')} className="flex items-center gap-1.5 text-xs px-2 py-1 bg-gray-700 rounded-md"><PlusIcon className="w-3 h-3"/> Add</button></div></div>}</div>
    </div>{tooltip?.visible && ReactDOM.createPortal(<div style={{top:tooltip.top,left:tooltip.left}} className="absolute z-[100] p-2 bg-gray-700 border border-gray-600 rounded shadow-lg w-auto max-w-xs animate-fade-in" onMouseEnter={()=>{if(hideTimeout.current)clearTimeout(hideTimeout.current);}} onMouseLeave={handleHideTooltip}>{tooltip.content}</div>, document.body)}</div>);
});

export default SettingsPanel;
