import React, { useState, useRef, useEffect, useContext } from 'react';
import { aiService } from '../services/AiService';
import { validatePlotConfig } from '../utils/plotValidator';
import type { ChatMessage, NotebookMetadata } from '../types';
import { MessageSender } from '../types';
import { XMarkIcon } from './icons/XMarkIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { SendIcon } from './icons/SendIcon';
import { ClipboardIcon } from './icons/ClipboardIcon';
import { PlusIcon } from './icons/PlusIcon';
import { DataContext } from '../context/DuckDBContext';
import { ArrowCounterclockwiseIcon } from './icons/ArrowCounterclockwiseIcon';
import { Content } from '@google/genai';


interface ChatPanelProps {
    metadata: NotebookMetadata;
    onAddCellFromAI: (query: string, plotConfig: string, title: string, markdownText: string) => void;
}

const initialConversation: ChatMessage[] = [
    { id: '1', sender: MessageSender.AI, text: 'Hello! I can help you analyze your JFR data. What would you like to investigate? For example, you could ask about CPU load or garbage collection pauses.' },
];

const ChatPanel: React.FC<ChatPanelProps> = ({ metadata, onAddCellFromAI }) => {
    const { schema, query } = useContext(DataContext);
    const [messages, setMessages] = useState<ChatMessage[]>(initialConversation);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const cancelledRef = useRef(false);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);
    
    const handleReset = () => {
        setMessages(initialConversation);
        setIsLoading(false);
        cancelledRef.current = false;
    };

    const handleCancel = () => {
        cancelledRef.current = true;
        setIsLoading(false);
        setMessages(prev => [...prev, {
            id: Date.now().toString(),
            sender: MessageSender.AI,
            text: 'Request cancelled.',
        }]);
    };

    const handleSend = async () => {
        if (input.trim() === '' || isLoading || !schema) return;

        cancelledRef.current = false;
        const userMessage: ChatMessage = { id: Date.now().toString(), sender: MessageSender.User, text: input };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);
        
        const MAX_ATTEMPTS = 3;
        let attempts = 0;
        const conversationHistory: Content[] = messages.slice(1).map(m => ({
            role: m.sender === MessageSender.User ? 'user' : 'model',
            parts: [{ text: m.code ? `${m.text}\n\`\`\`sql\n${m.code}\n\`\`\`\n\`\`\`plot\n${m.plotConfig}\n\`\`\`` : m.text }]
        }));
        conversationHistory.push({ role: 'user', parts: [{ text: input }] });
        
        let lastAiResponse: any = null;
        let success = false;
        let lastError: string | null = null;

        while (attempts < MAX_ATTEMPTS && !success && !cancelledRef.current) {
            attempts++;
            try {
                lastAiResponse = await aiService.getAiAgentResponse(conversationHistory, schema.tables, schema.views, schema.macros, metadata.customSystemPrompt);

                if (!lastAiResponse.code) {
                    success = true; // Conversational response, no validation needed
                    continue;
                }

                // Step 1: Validate SQL
                const queryResult = await query(lastAiResponse.code);
                
                // Step 2: Validate Plot
                const plotValidationError = validatePlotConfig(lastAiResponse.plotConfig || 'TABLE()', queryResult || []);
                if (plotValidationError) {
                    throw new Error(`Plot validation failed: ${plotValidationError}`);
                }
                
                success = true;

            } catch (error: any) {
                lastError = error.message;
                const feedback = `The last attempt failed with the error: "${error.message}". Please analyze the error and the conversation history, then generate a new, valid response.`;
                conversationHistory.push({ role: 'user', parts: [{ text: feedback }] });
            }
        }
        
        const finalMessage: ChatMessage = (success && lastAiResponse) ? {
            id: (Date.now() + 1).toString(),
            sender: MessageSender.AI,
            text: lastAiResponse.text,
            code: lastAiResponse.code,
            plotConfig: lastAiResponse.plotConfig || (lastAiResponse.code ? 'TABLE()' : undefined),
            isActionable: !!lastAiResponse.code,
        } : {
            id: (Date.now() + 1).toString(),
            sender: MessageSender.AI,
            text: `I'm sorry, I was unable to generate a valid response after ${MAX_ATTEMPTS} attempts. Please try rephrasing your request.${lastError ? `\n\nLast error: ${lastError}` : ''}`
        };
        
        if (cancelledRef.current) return;

        setMessages(prev => [...prev, finalMessage]);
        setIsLoading(false);
    };
    
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as any).isComposing) { e.preventDefault(); handleSend(); }
    };

    const CodeBlock: React.FC<{ code: string }> = ({ code }) => {
        const [copied, setCopied] = useState(false);
        const handleCopy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); };
        return (<div className="relative bg-gray-900 rounded-md my-2"><pre className="p-3 text-sm text-cyan-300 overflow-x-auto font-mono">{code}</pre><button onClick={handleCopy} className="absolute top-2 right-2 p-1.5 bg-gray-700 hover:bg-gray-600 rounded-md"><ClipboardIcon className={`w-4 h-4 ${copied ? 'text-green-400' : 'text-gray-300'}`}/></button></div>);
    };

    return (
        <div className="w-full h-full flex flex-col bg-gray-900 border-l border-gray-700">
            <div className="p-4 border-b border-gray-700 flex-shrink-0 flex justify-between items-center"><h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2"><SparklesIcon className="w-5 h-5 text-yellow-400"/>AI Assistant</h2><button onClick={handleReset} title="Reset Conversation" className="p-1.5 text-gray-500 hover:text-cyan-400 rounded-md"><ArrowCounterclockwiseIcon className="w-4 h-4"/></button></div>
            <div className="flex-grow p-4 overflow-y-auto space-y-4">
                {messages.map(msg => (<div key={msg.id} className={`flex ${msg.sender === MessageSender.User ? 'justify-end' : 'justify-start'}`}><div className={`max-w-xs md:max-w-sm rounded-lg p-3 ${msg.sender === MessageSender.User ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-200'}`}><p className="text-sm">{msg.text}</p>{msg.code && <CodeBlock code={msg.code}/>}{msg.isActionable && msg.code && msg.plotConfig && (<button onClick={() => onAddCellFromAI(msg.code!, msg.plotConfig!, 'AI Suggested Cell', msg.text)} className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md text-sm font-semibold"><PlusIcon className="w-4 h-4"/>Add to Notebook</button>)}</div></div>))}
                {isLoading && (<div className="flex justify-start"><div className="bg-gray-700 rounded-lg p-3 inline-flex items-center space-x-2"><span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse delay-0"></span><span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse delay-150"></span><span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse delay-300"></span></div></div>)}
                <div ref={messagesEndRef}/>
            </div>
            <div className="p-4 border-t border-gray-700 flex-shrink-0">
                <div className="relative">
                    <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="Ask for a query..." className="w-full bg-gray-800 border border-gray-600 rounded-lg py-2 pl-4 pr-20 focus:outline-none focus:ring-2 focus:ring-cyan-500 text-gray-200" disabled={isLoading || !schema}/>
                    {isLoading
                        ? <button onClick={handleCancel} className="absolute top-1/2 right-2 -translate-y-1/2 p-2 bg-red-700 hover:bg-red-600 rounded-md" title="Cancel request"><XMarkIcon className="w-5 h-5 text-white"/></button>
                        : <button onClick={handleSend} className="absolute top-1/2 right-2 -translate-y-1/2 p-2 bg-cyan-600 hover:bg-cyan-700 rounded-md disabled:bg-gray-600" disabled={input.trim() === '' || !schema}><SendIcon className="w-5 h-5 text-white"/></button>
                    }
                </div>
            </div>
        </div>
    );
};

export default ChatPanel;