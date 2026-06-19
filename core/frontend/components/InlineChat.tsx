

import React, { useState } from 'react';
import { aiService } from '../services/AiService';
import type { ChatMessage, NotebookCellData, NotebookMetadata } from '../types';
import { MessageSender } from '../types';
import { SendIcon } from './icons/SendIcon';
import { ClipboardIcon } from './icons/ClipboardIcon';
import { XMarkIcon } from './icons/XMarkIcon';
import { BookOpenIcon } from './icons/BookOpenIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { ArrowCounterclockwiseIcon } from './icons/ArrowCounterclockwiseIcon';
import PlotRenderer from './PlotRenderer';

interface InlineChatProps {
    targetType: 'sql' | 'plot';
    targetValue: string;
    cellContext: NotebookCellData;
    allCells: NotebookCellData[];
    metadata: NotebookMetadata;
    isAiFeatureActive: boolean;
    sql?: string;
    data?: (any[] | null);
    onApplyCode: (newCode: string) => void;
    onClose: () => void;
    onMetadataChange?: (newMetadata: NotebookMetadata) => void;
}

const InlineChat: React.FC<InlineChatProps> = ({ targetType, targetValue, cellContext, allCells, metadata, isAiFeatureActive, sql, data, onApplyCode, onClose, onMetadataChange }) => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [useFullContext, setUseFullContext] = useState(false);

    const handleSend = async () => {
        if (input.trim() === '' || isLoading) return;
        
        const userMessage: ChatMessage = { id: Date.now().toString(), sender: MessageSender.User, text: input };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        const otherCells = allCells.filter(c => c.id !== cellContext.id);
        const fullNotebookContext = useFullContext ? otherCells.map(c => `### ${c.title}\n\n${c.content}`).join('\n\n---\n\n') : undefined;
        
        try {
            const aiResponse = await aiService.getAiInlineSuggestion(input, targetType, targetValue, cellContext.content, fullNotebookContext, data || undefined, metadata.customSystemPrompt);
            const aiMessage: ChatMessage = { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: aiResponse.text, code: aiResponse.code, isActionable: !!aiResponse.code };
            setMessages(prev => [...prev, aiMessage]);
        } catch (error) {
            const errorMessage: ChatMessage = { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: "Sorry, I encountered an error. Please try again." };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };
    
    const CodeBlock: React.FC<{ code: string; isActionable?: boolean }> = ({ code, isActionable }) => {
        const [copied, setCopied] = useState(false);
        const handleCopy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); };
        return (
            <div className="my-2">
                {targetType === 'plot' && data && (<div className="my-2 p-2 bg-gray-900/50 rounded-lg border border-gray-700 h-[250px] overflow-hidden"><h6 className="text-xs font-semibold text-gray-400 text-center mb-1">Preview</h6><PlotRenderer config={code} data={data.slice(0, 50)} sql={sql || ''} cellContext={cellContext} onApplyFix={onApplyCode} isAiFeatureActive={isAiFeatureActive} metadata={metadata} onMetadataChange={onMetadataChange || (async () => {})} onCellVariableChange={() => {}} allVariables={{}} /></div>)}
                <div className="relative bg-gray-900 rounded-md"><pre className="p-3 text-sm text-cyan-300 overflow-x-auto font-mono">{code}</pre><button onClick={handleCopy} className="absolute top-2 right-2 p-1.5 bg-gray-700 hover:bg-gray-600 rounded-md"><ClipboardIcon className={`w-4 h-4 ${copied ? 'text-green-400' : 'text-gray-300'}`}/></button></div>
                {isActionable && (<button onClick={() => onApplyCode(code)} className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-green-600/30 hover:bg-green-600/50 text-green-300 rounded-md font-semibold"><CheckCircleIcon className="w-4 h-4"/>Apply Code</button>)}
            </div>
        );
    };

    return (
        <div className="mt-4 border-t border-gray-700 pt-4 animate-fade-in-down flex flex-col space-y-3">
            <div className="flex-shrink-0 flex items-center justify-between"><h6 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Refine with AI</h6><div className="flex items-center gap-1"><button onClick={() => setMessages([])} title="Reset Chat" className="p-1 hover:bg-gray-700 rounded-md"><ArrowCounterclockwiseIcon className="w-4 h-4 text-gray-500 hover:text-cyan-400"/></button><button onClick={onClose} title="Close Chat" className="p-1 hover:bg-gray-700 rounded-md"><XMarkIcon className="w-4 h-4 text-gray-500"/></button></div></div>
            <div className="space-y-4">{messages.length === 0 && (<p className="text-sm text-center text-gray-500 p-4">Ask the AI to modify your {targetType} code.</p>)}{messages.map(msg => (<div key={msg.id} className={`flex ${msg.sender === MessageSender.User ? 'justify-end':'justify-start'}`}><div className={`max-w-xs md:max-w-sm rounded-lg p-2 text-sm ${msg.sender===MessageSender.User ? 'bg-cyan-800/70 text-gray-100' : 'bg-gray-700/50 text-gray-300'}`}><p>{msg.text}</p>{msg.code && <CodeBlock code={msg.code} isActionable={msg.isActionable}/>}</div></div>))}{isLoading && (<div className="flex justify-start"><div className="bg-gray-700/50 rounded-lg p-3 inline-flex items-center space-x-2"><span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></span><span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse delay-150"></span><span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse delay-300"></span></div></div>)}</div>
            <div className="flex-shrink-0 space-y-2"><button onClick={() => setUseFullContext(!useFullContext)} className={`w-full flex items-center justify-center gap-2 text-xs p-1.5 rounded-md ${useFullContext ? 'bg-purple-600/30 text-purple-300' : 'bg-gray-700/50 hover:bg-gray-700 text-gray-400'}`}><BookOpenIcon className="w-4 h-4"/>{useFullContext?'Full notebook context is enabled':'Add full notebook context'}</button><div className="relative"><input type="text" value={input} onChange={e=>setInput(e.target.value)} onKeyPress={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend();}}} placeholder={`Ask AI to change ${targetType}...`} className="w-full bg-gray-800/50 border border-gray-600 rounded-lg py-2 pl-3 pr-10 focus:outline-none focus:ring-1 focus:ring-cyan-500 text-sm" disabled={isLoading} autoFocus/><button onClick={handleSend} className="absolute top-1/2 right-2 -translate-y-1/2 p-1.5 bg-cyan-600 hover:bg-cyan-700 rounded-md disabled:bg-gray-600" disabled={isLoading||input.trim()===''}><SendIcon className="w-4 h-4 text-white"/></button></div></div>
        </div>
    );
};

export default InlineChat;