import React, { useState, useRef, useEffect, useContext, useMemo, useCallback } from 'react';
import { aiService, providerMetadataRegistry } from '../services/AiService';
import type { VisibilityMode, AiTier } from '../services/AiService';
import { SettingsContext } from '../context/SettingsContext';
import { validatePlotConfig } from '../utils/plotValidator';
import type { ChatMessage, NotebookMetadata, NotebookCellData } from '../types';
import { MessageSender } from '../types';
import { XMarkIcon } from './icons/XMarkIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { SendIcon } from './icons/SendIcon';
import { ClipboardIcon } from './icons/ClipboardIcon';
import { PlusIcon } from './icons/PlusIcon';
import { DataContext } from '../context/DuckDBContext';
import { ArrowCounterclockwiseIcon } from './icons/ArrowCounterclockwiseIcon';
import { Content } from '@google/genai';
import type { AiProviderType } from '../services/ai/IAiProvider';
import type { ToolChatMessage } from '../services/ai/IAiProvider';
import { TOOLS, type Tool } from '../services/ai/tools';
import type { NotebookMutation, ToolDeps } from '../services/ai/tools/runtime';
import { tokenizeCellContent, reconstructCellContent } from '../utils/notebookParser';
import {
    chooseProposalKind,
    applyApprovalAction,
    ChatProposalCard,
    type ApprovalRecord,
    type ProposalKind,
} from './ChatProposalCard';

// Re-export pure helpers so tests can pull them from the panel module.
export {
    chooseProposalKind,
    applyApprovalAction,
    formatToolHeader,
    formatToolArgs,
} from './ChatProposalCard';
export type { ApprovalRecord, ProposalKind } from './ChatProposalCard';

interface ChatPanelProps {
    metadata: NotebookMetadata;
    onAddCellFromAI: (query: string, plotConfig: string, title: string, markdownText: string) => void;
    /** C4 — Optional notebook callbacks for the tool runtime. When supplied,
     * the assistant can mutate cells via approved tool calls. */
    cells?: NotebookCellData[];
    onAddCell?: (mut: { type: 'sql' | 'plot' | 'markdown'; content: string; afterCellId?: string }) => string | undefined;
    onUpdateCell?: (cellId: string, content: string) => void;
}

const initialConversation: ChatMessage[] = [
    { id: '1', sender: MessageSender.AI, text: 'Hello! I can help you analyze your JFR data. What would you like to investigate? For example, you could ask about CPU load or garbage collection pauses.' },
];

/**
 * C4 — Returns the list of providers that currently have credentials wired up
 * (per `metadata.isConfigured(settings)`). Used to populate the provider
 * dropdown in the chat header. Pure helper; exported for tests.
 */
export function listConfiguredProviders(settings: import('../context/SettingsContext').Settings): AiProviderType[] {
    const out: AiProviderType[] = [];
    (Object.entries(providerMetadataRegistry) as Array<[AiProviderType, typeof providerMetadataRegistry.google]>).forEach(([id, meta]) => {
        try { if (meta.isConfigured(settings)) out.push(id); } catch { /* ignore */ }
    });
    return out;
}

/**
 * C4 — Resolve the default model id for a given provider at a given tier from
 * its metadata. Cloud providers have a curated `models` list; local/browser
 * fall back to the provider-specific advanced default and let the user type
 * a free-form id in the dropdown's companion text input.
 */
export function defaultModelForProvider(provider: AiProviderType, tier: AiTier = 'advanced'): string {
    const meta = providerMetadataRegistry[provider];
    if (!meta) return '';
    return meta.defaultModels[tier] ?? meta.defaultModels.advanced ?? '';
}

/**
 * C4 — Map a notebook cell to its primary type for tool-runtime consumption.
 * If a cell has only markdown, it's a markdown cell. If it contains any sql
 * block, it's an sql cell; if it contains a plot block (and no sql), it's a
 * plot cell. Pure helper; exported for tests.
 */
export function cellPrimaryType(content: string): 'sql' | 'plot' | 'markdown' {
    const segs = tokenizeCellContent(content);
    if (segs.some(s => s.type === 'sql')) return 'sql';
    if (segs.some(s => s.type === 'plot')) return 'plot';
    return 'markdown';
}

/**
 * C4 — Extract plot blocks from notebook cells for `listPlots`. Each plot
 * block becomes a single entry; the cell id is used as the plot id.
 */
export function listPlotsFromCells(cells: ReadonlyArray<{ id: string; content: string }>): Array<{ id: string; name?: string; config: string }> {
    const out: Array<{ id: string; name?: string; config: string }> = [];
    for (const c of cells) {
        const segs = tokenizeCellContent(c.content);
        for (const s of segs) {
            if (s.type === 'plot') {
                out.push({ id: c.id, config: s.content.trim() });
            }
        }
    }
    return out;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ metadata, onAddCellFromAI, cells, onAddCell, onUpdateCell }) => {
    const { schema, query } = useContext(DataContext);
    const { settings } = useContext(SettingsContext);
    const [messages, setMessages] = useState<ChatMessage[]>(initialConversation);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [chatVisibility, setChatVisibility] = useState<VisibilityMode>(settings.aiDefaultVisibility);

    // --- C4 header state: per-chat overrides that do not mutate global Settings ---
    const configuredProviders = useMemo(() => listConfiguredProviders(settings), [settings]);
    const [chatProvider, setChatProvider] = useState<AiProviderType>(() => {
        if (configuredProviders.includes(settings.aiProvider)) return settings.aiProvider;
        return configuredProviders[0] ?? settings.aiProvider;
    });
    const [chatModel, setChatModel] = useState<string>(() => defaultModelForProvider(chatProvider, 'advanced'));
    const providerMeta = providerMetadataRegistry[chatProvider];
    const isFreeFormModel = chatProvider === 'local' || chatProvider === 'browser';

    // --- C4 tool-call records (per current turn). approveAllReads is a
    // per-turn flag reset whenever a new user message starts. ---
    const [proposals, setProposals] = useState<ApprovalRecord[]>([]);
    const proposalsRef = useRef<ApprovalRecord[]>([]);
    proposalsRef.current = proposals;
    const [approveAllReads, setApproveAllReads] = useState(false);
    const approveAllReadsRef = useRef(false);
    approveAllReadsRef.current = approveAllReads;

    // resolver registry for pending requireApproval promises
    const approvalResolvers = useRef<Map<string, { resolve: () => void; reject: (e: Error) => void }>>(new Map());

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const cancelledRef = useRef(false);

    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, proposals]);

    // Keep chat header in sync if the user changes the global provider in Settings.
    useEffect(() => {
        if (!configuredProviders.length) return;
        if (!configuredProviders.includes(chatProvider)) {
            const next = configuredProviders.includes(settings.aiProvider) ? settings.aiProvider : configuredProviders[0];
            setChatProvider(next);
            setChatModel(defaultModelForProvider(next, 'advanced'));
        }
    }, [configuredProviders, chatProvider, settings.aiProvider]);

    const handleReset = () => {
        setMessages(initialConversation);
        setProposals([]);
        setApproveAllReads(false);
        approvalResolvers.current.clear();
        setIsLoading(false);
        cancelledRef.current = false;
    };

    const handleCancel = () => {
        cancelledRef.current = true;
        setIsLoading(false);
        // Reject any pending approvals so the orchestrator unwinds cleanly.
        approvalResolvers.current.forEach(r => r.reject(new Error('cancelled')));
        approvalResolvers.current.clear();
        setMessages(prev => [...prev, { id: Date.now().toString(), sender: MessageSender.AI, text: 'Request cancelled.' }]);
    };

    // --- C4 approval action handlers ---
    const approveProposal = useCallback((id: string) => {
        setProposals(prev => applyApprovalAction(prev, { type: 'approve', id }));
        const resolver = approvalResolvers.current.get(id);
        resolver?.resolve();
        approvalResolvers.current.delete(id);
    }, []);

    const rejectProposal = useCallback((id: string) => {
        setProposals(prev => applyApprovalAction(prev, { type: 'reject', id }));
        const resolver = approvalResolvers.current.get(id);
        resolver?.reject(new Error('rejected by user'));
        approvalResolvers.current.delete(id);
    }, []);

    const approveAllReadsHandler = useCallback(() => {
        setApproveAllReads(true);
        approveAllReadsRef.current = true;
        // Auto-resolve any currently-pending read proposals.
        const readIds: string[] = [];
        for (const p of proposalsRef.current) {
            if (p.status !== 'pending') continue;
            const tool = TOOLS.find(t => t.name === p.name);
            if (tool?.kind === 'read') {
                readIds.push(p.id);
                const r = approvalResolvers.current.get(p.id);
                r?.resolve();
                approvalResolvers.current.delete(p.id);
            }
        }
        if (readIds.length) {
            setProposals(prev => applyApprovalAction(prev, { type: 'approve-all-reads', readIds }));
        }
    }, []);

    // --- Build tool deps that the runtime will call. ---
    const buildToolDeps = useCallback((): ToolDeps => {
        const cellSnapshot = cells ?? [];
        const snapshotForRuntime = cellSnapshot.map(c => ({ id: c.id, type: cellPrimaryType(c.content), content: c.content }));
        return {
            duckdbQuery: async (sql: string, _opts) => {
                const rows = await query(sql);
                const columns = rows && rows.length
                    ? Object.keys(rows[0]).map(name => ({ name, type: typeof (rows[0] as any)[name] }))
                    : [];
                return { columns, rows };
            },
            listCells: () => snapshotForRuntime,
            mutateCells: async (op: NotebookMutation) => {
                try {
                    if (op.kind === 'add') {
                        if (!onAddCell) return { ok: false, error: 'addCell not supported in this environment' };
                        const id = onAddCell({ type: op.type, content: op.content, afterCellId: op.afterCellId });
                        return { ok: true, cellId: id };
                    }
                    if (op.kind === 'edit') {
                        if (!onUpdateCell) return { ok: false, error: 'editCell not supported in this environment' };
                        onUpdateCell(op.cellId, op.content);
                        return { ok: true, cellId: op.cellId };
                    }
                    if (op.kind === 'applyPlot') {
                        if (!onUpdateCell) return { ok: false, error: 'applyPlot not supported in this environment' };
                        // Replace the Nth plot block (op.plotBlockIndex, 0-based) within the cell,
                        // or append a new plot block if none exist.
                        const cell = cellSnapshot.find(c => c.id === op.cellId);
                        if (!cell) return { ok: false, error: `cell not found: ${op.cellId}` };
                        const segs = tokenizeCellContent(cell.content);
                        const targetIdx = op.plotBlockIndex ?? 0;
                        const plotSegs = segs.map((s, i) => ({ s, i })).filter(x => x.s.type === 'plot');
                        let newContent: string;
                        if (plotSegs.length === 0) {
                            newContent = cell.content + '\n\n```plot\n' + op.plotConfig + '\n```\n';
                        } else {
                            const target = plotSegs[Math.min(targetIdx, plotSegs.length - 1)];
                            const updatedSegs = segs.map((s, i) =>
                                i === target.i ? { ...s, content: '\n' + op.plotConfig + '\n' } : s
                            );
                            newContent = reconstructCellContent(updatedSegs);
                        }
                        onUpdateCell(op.cellId, newContent);
                        return { ok: true, cellId: op.cellId };
                    }
                    return { ok: false, error: 'unknown mutation' };
                } catch (e: any) {
                    return { ok: false, error: e?.message || String(e) };
                }
            },
            listPlotsInNotebook: () => listPlotsFromCells(cellSnapshot),
            requireApproval: (toolName: string, args: any) => new Promise<void>((resolve, reject) => {
                // The runtime always calls this for mutate tools. We've already
                // registered the pending proposal in onToolCall before reaching
                // executeTool; the resolver gets stored under the same call id.
                const pending = proposalsRef.current.find(p => p.name === toolName && p.status === 'pending' && shallowEqualArgs(p.args, args));
                if (!pending) {
                    // Defensive: if we don't have a record (shouldn't happen),
                    // synthesize one so the UI shows the prompt.
                    const id = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    setProposals(prev => [...prev, { id, name: toolName, args, status: 'pending' }]);
                    approvalResolvers.current.set(id, { resolve, reject });
                    return;
                }
                approvalResolvers.current.set(pending.id, { resolve, reject });
            }),
        };
    }, [cells, onAddCell, onUpdateCell, query]);

    const handleSendLegacy = async () => {
        // Fallback path when the active provider has no tool support (browser).
        const conversationHistory: Content[] = messages.slice(1).map(m => ({
            role: m.sender === MessageSender.User ? 'user' : 'model',
            parts: [{ text: m.code ? `${m.text}\n\`\`\`sql\n${m.code}\n\`\`\`\n\`\`\`plot\n${m.plotConfig}\n\`\`\`` : m.text }],
        }));
        conversationHistory.push({ role: 'user', parts: [{ text: input }] });
        try {
            const resp = await aiService.getAiAgentResponse(conversationHistory, schema!.tables, schema!.views, schema!.macros, metadata.customSystemPrompt, chatVisibility);
            const final: ChatMessage = {
                id: (Date.now() + 1).toString(),
                sender: MessageSender.AI,
                text: resp.text,
                code: resp.code ?? undefined,
                plotConfig: resp.plotConfig ?? (resp.code ? 'TABLE()' : undefined),
                isActionable: !!resp.code,
            };
            if (resp.code) {
                const qres = await query(resp.code);
                const pErr = validatePlotConfig(resp.plotConfig || 'TABLE()', qres || []);
                if (pErr) throw new Error(`Plot validation failed: ${pErr}`);
            }
            setMessages(prev => [...prev, final]);
        } catch (e: any) {
            setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `Error: ${e.message}` }]);
        }
    };

    const handleSend = async () => {
        if (input.trim() === '' || isLoading || !schema) return;

        cancelledRef.current = false;
        const userMessage: ChatMessage = { id: Date.now().toString(), sender: MessageSender.User, text: input };
        setMessages(prev => [...prev, userMessage]);
        const inputText = input;
        setInput('');
        setIsLoading(true);
        // Reset per-turn approval state.
        setProposals([]);
        proposalsRef.current = [];
        setApproveAllReads(false);
        approveAllReadsRef.current = false;
        approvalResolvers.current.clear();

        // Browser provider has no tool support → use legacy path.
        if (chatProvider === 'browser') {
            await handleSendLegacy();
            setIsLoading(false);
            return;
        }

        // Build tool message history (text-only summaries).
        const toolHistory: ToolChatMessage[] = messages.slice(1).map(m => ({
            role: m.sender === MessageSender.User ? 'user' : 'assistant',
            content: m.text + (m.code ? `\n\`\`\`sql\n${m.code}\n\`\`\`` : ''),
        }));
        toolHistory.push({ role: 'user', content: inputText });

        const deps = buildToolDeps();
        // We override the approval gate so we can register the proposal BEFORE
        // the runtime awaits it. Wrap deps.requireApproval so it just waits on
        // the resolver we set in the tool_call handler.
        const wrappedDeps: ToolDeps = {
            ...deps,
            requireApproval: (toolName: string, args: any) => new Promise<void>((resolve, reject) => {
                // Find the most recent pending proposal for this tool/args pair.
                const pending = [...proposalsRef.current].reverse().find(p => p.name === toolName && p.status === 'pending');
                if (pending) {
                    // If already auto-approved, resolve immediately.
                    approvalResolvers.current.set(pending.id, { resolve, reject });
                    return;
                }
                // No record yet — should not happen in normal flow, but fall back.
                const id = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                setProposals(prev => [...prev, { id, name: toolName, args, status: 'pending' }]);
                approvalResolvers.current.set(id, { resolve, reject });
            }),
        };

        let assistantBuf = '';
        try {
            const stream = aiService.streamChatWithTools(
                toolHistory,
                { tables: schema.tables, views: schema.views, macros: schema.macros },
                TOOLS as Tool[],
                wrappedDeps,
                {
                    visibility: chatVisibility,
                    tier: 'advanced',
                    feature: 'chat',
                    providerOverride: chatProvider,
                    modelOverride: chatModel,
                    customSystemPrompt: metadata?.customSystemPrompt,
                },
            );

            for await (const chunk of stream) {
                if (cancelledRef.current) break;
                if (chunk.kind === 'text') {
                    assistantBuf += chunk.delta;
                } else if (chunk.kind === 'tool_call') {
                    const tool = TOOLS.find(t => t.name === chunk.name);
                    const record: ApprovalRecord = { id: chunk.id, name: chunk.name, args: chunk.args, status: 'pending' };
                    setProposals(prev => [...prev, record]);
                    proposalsRef.current = [...proposalsRef.current, record];

                    if (tool?.kind === 'read') {
                        // Visibility / approve-all logic.
                        const proposal = chooseProposalKind(tool, chunk.args, {
                            visibility: chatVisibility,
                            approveAllReads: approveAllReadsRef.current,
                            existingCellContent: undefined,
                        });
                        if (proposal.kind === 'auto-read') {
                            // Mark approved immediately; runtime executes reads
                            // without calling requireApproval so we just update UI.
                            setProposals(prev => applyApprovalAction(prev, { type: 'approve', id: chunk.id }));
                        }
                        // Mutate tools always require user click.
                    }
                } else if (chunk.kind === 'tool_result') {
                    setProposals(prev => applyApprovalAction(prev, { type: 'complete', id: chunk.id, result: chunk.result }));
                }
            }
        } catch (e: any) {
            setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `Error: ${e.message}` }]);
        } finally {
            if (assistantBuf.trim()) {
                setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: assistantBuf.trim() }]);
            }
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as any).isComposing) { e.preventDefault(); handleSend(); }
    };

    const CodeBlock: React.FC<{ code: string }> = ({ code }) => {
        const [copied, setCopied] = useState(false);
        const handleCopy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); };
        return (<div className="relative bg-gray-900 rounded-md my-2"><pre className="p-3 text-sm text-cyan-300 overflow-x-auto font-mono">{code}</pre><button onClick={handleCopy} className="absolute top-2 right-2 p-1.5 bg-gray-700 hover:bg-gray-600 rounded-md"><ClipboardIcon className={`w-4 h-4 ${copied ? 'text-green-400' : 'text-gray-300'}`}/></button></div>);
    };

    const cellById = useMemo(() => {
        const m = new Map<string, NotebookCellData>();
        (cells ?? []).forEach(c => m.set(c.id, c));
        return m;
    }, [cells]);

    return (
        <div className="w-full h-full flex flex-col bg-gray-900 border-l border-gray-700">
            <div className="p-3 border-b border-gray-700 flex-shrink-0 flex flex-col gap-2">
                <div className="flex justify-between items-center gap-2">
                    <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2"><SparklesIcon className="w-5 h-5 text-yellow-400"/>AI Assistant</h2>
                    <button onClick={handleReset} title="Reset Conversation" className="p-1.5 text-gray-500 hover:text-cyan-400 rounded-md"><ArrowCounterclockwiseIcon className="w-4 h-4"/></button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <label className="text-[10px] uppercase tracking-wider text-gray-500" htmlFor="chat-provider">Provider</label>
                    <select id="chat-provider" aria-label="Chat provider" value={chatProvider} onChange={e => { const p = e.target.value as AiProviderType; setChatProvider(p); setChatModel(defaultModelForProvider(p, 'advanced')); }} className="bg-gray-800 border border-gray-600 rounded text-xs px-1.5 py-1 text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500" disabled={configuredProviders.length === 0}>
                        {configuredProviders.length === 0 && <option value="">No providers configured</option>}
                        {configuredProviders.map(id => (<option key={id} value={id}>{providerMetadataRegistry[id].name}</option>))}
                    </select>
                    <label className="text-[10px] uppercase tracking-wider text-gray-500" htmlFor="chat-model">Model</label>
                    {isFreeFormModel ? (
                        <input id="chat-model" type="text" aria-label="Chat model" value={chatModel} onChange={e => setChatModel(e.target.value)} className="bg-gray-800 border border-gray-600 rounded text-xs px-1.5 py-1 text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 w-32"/>
                    ) : (
                        <select id="chat-model" aria-label="Chat model" value={chatModel} onChange={e => setChatModel(e.target.value)} className="bg-gray-800 border border-gray-600 rounded text-xs px-1.5 py-1 text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500">
                            {(providerMeta?.models ?? []).map(m => (<option key={m.id} value={m.id}>{m.name}</option>))}
                        </select>
                    )}
                    <label className="text-[10px] uppercase tracking-wider text-gray-500" htmlFor="chat-visibility">See</label>
                    <select id="chat-visibility" aria-label="AI data visibility" value={chatVisibility} onChange={e => setChatVisibility(e.target.value as VisibilityMode)} title="Controls what slice of recent query results the AI can see" className="bg-gray-800 border border-gray-600 rounded text-xs px-1.5 py-1 text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500">
                        <option value="no-data">No data</option>
                        <option value="sanitized">Sanitized</option>
                        <option value="full">Full</option>
                    </select>
                </div>
            </div>
            <div className="flex-grow p-4 overflow-y-auto space-y-4">
                {messages.map(msg => (<div key={msg.id} className={`flex ${msg.sender === MessageSender.User ? 'justify-end' : 'justify-start'}`}><div className={`max-w-xs md:max-w-sm rounded-lg p-3 ${msg.sender === MessageSender.User ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-200'}`}><p className="text-sm whitespace-pre-wrap">{msg.text}</p>{msg.code && <CodeBlock code={msg.code}/>}{msg.isActionable && msg.code && msg.plotConfig && (<button onClick={() => onAddCellFromAI(msg.code!, msg.plotConfig!, 'AI Suggested Cell', msg.text)} className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md text-sm font-semibold"><PlusIcon className="w-4 h-4"/>Add to Notebook</button>)}</div></div>))}
                {proposals.map(record => {
                    const tool = TOOLS.find(t => t.name === record.name);
                    if (!tool) return null;
                    const existing = (record.name === 'editCell' || record.name === 'applyPlot') ? cellById.get(record.args?.cellId)?.content : undefined;
                    const kind: ProposalKind = chooseProposalKind(tool, record.args, {
                        visibility: chatVisibility,
                        approveAllReads,
                        existingCellContent: existing,
                    });
                    return (
                        <ChatProposalCard
                            key={record.id}
                            record={record}
                            kind={kind}
                            onApprove={() => approveProposal(record.id)}
                            onReject={() => rejectProposal(record.id)}
                            onApproveAllReads={tool.kind === 'read' ? approveAllReadsHandler : undefined}
                        />
                    );
                })}
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

/** Cheap value-equality check used for matching pending approvals to runtime
 * requireApproval invocations. Top-level keys only — sufficient because tool
 * args are flat objects with JSON-serializable primitives. */
function shallowEqualArgs(a: any, b: any): boolean {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const ak = Object.keys(a); const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
        const av = a[k], bv = b[k];
        if (av === bv) continue;
        if (typeof av === 'object' && typeof bv === 'object') {
            if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
        } else if (av !== bv) return false;
    }
    return true;
}

export default ChatPanel;
