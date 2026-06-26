

import React, { useState, useContext, useMemo, useRef, useCallback, useEffect } from 'react';
import { aiService, providerMetadataRegistry } from '../services/AiService';
import type { VisibilityMode, AiTier } from '../services/AiService';
import { SettingsContext } from '../context/SettingsContext';
import { DataContext } from '../context/DuckDBContext';
import type { ChatMessage, NotebookCellData, NotebookMetadata } from '../types';
import { MessageSender } from '../types';
import { SendIcon } from './icons/SendIcon';
import { ClipboardIcon } from './icons/ClipboardIcon';
import { XMarkIcon } from './icons/XMarkIcon';
import { BookOpenIcon } from './icons/BookOpenIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { ArrowCounterclockwiseIcon } from './icons/ArrowCounterclockwiseIcon';
import PlotRenderer from './PlotRenderer';
import type { AiProviderType, ToolChatMessage } from '../services/ai/IAiProvider';
import { TOOLS, type Tool } from '../services/ai/tools';
import type { NotebookMutation, ToolDeps } from '../services/ai/tools/runtime';
import { tokenizeCellContent, reconstructCellContent } from '../utils/notebookParser';
import {
    listConfiguredProviders,
    defaultModelForProvider,
    cellPrimaryType,
    listPlotsFromCells,
} from './ChatPanel';
import {
    chooseProposalKind,
    applyApprovalAction,
    ChatProposalCard,
    type ApprovalRecord,
    type ProposalKind,
} from './ChatProposalCard';
import { resolveVisibility, buildRecentResultFromRows } from './inlineChatHelpers';

// Re-export pure helpers so callers / tests can pull them from InlineChat too.
export { resolveVisibility, buildRecentResultFromRows } from './inlineChatHelpers';

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
    /**
     * C7 — Optional notebook callbacks threaded down from App so the
     * inline-chat tool runtime can mutate cells when the model emits
     * `addCell`/`editCell`/`applyPlot` calls. When undefined the tool
     * runtime degrades gracefully (mutations return `{ ok: false, error }`).
     */
    cells?: NotebookCellData[];
    onAddCell?: (mut: { type: 'sql' | 'plot' | 'markdown'; content: string; afterCellId?: string }) => string | undefined;
    onUpdateCell?: (cellId: string, content: string) => void;
}

/**
 * C7 — Cheap shallow-equality helper used to match a pending approval to a
 * `requireApproval` invocation. Mirrors the helper in ChatPanel; kept private
 * here because the two panels evolve independently.
 */
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

const InlineChat: React.FC<InlineChatProps> = ({ targetType, targetValue, cellContext, allCells, metadata, isAiFeatureActive, sql, data, onApplyCode, onClose, onMetadataChange, cells, onAddCell, onUpdateCell }) => {
    const { settings } = useContext(SettingsContext);
    const { query } = useContext(DataContext);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    // Legacy toggle preserved for backwards-compat. `useFullContext=true` is
    // now interpreted as `visibility='full'`; otherwise the dropdown wins.
    const [useFullContext, setUseFullContext] = useState(false);
    const [chatVisibility, setChatVisibility] = useState<VisibilityMode>(settings.aiDefaultVisibility);

    // --- C7 header state mirroring ChatPanel ---
    const configuredProviders = useMemo(() => listConfiguredProviders(settings), [settings]);
    const [chatProvider, setChatProvider] = useState<AiProviderType>(() => {
        if (configuredProviders.includes(settings.aiProvider)) return settings.aiProvider;
        return configuredProviders[0] ?? settings.aiProvider;
    });
    const [chatModel, setChatModel] = useState<string>(() => defaultModelForProvider(chatProvider, 'advanced'));
    const providerMeta = providerMetadataRegistry[chatProvider];
    const isFreeFormModel = chatProvider === 'local' || chatProvider === 'browser';

    // --- C7 tool-call proposal state ---
    const [proposals, setProposals] = useState<ApprovalRecord[]>([]);
    const proposalsRef = useRef<ApprovalRecord[]>([]);
    proposalsRef.current = proposals;
    const [approveAllReads, setApproveAllReads] = useState(false);
    const approveAllReadsRef = useRef(false);
    approveAllReadsRef.current = approveAllReads;
    const approvalResolvers = useRef<Map<string, { resolve: () => void; reject: (e: Error) => void }>>(new Map());

    // Re-sync chat header when configured providers shift under us.
    useEffect(() => {
        if (!configuredProviders.length) return;
        if (!configuredProviders.includes(chatProvider)) {
            const next = configuredProviders.includes(settings.aiProvider) ? settings.aiProvider : configuredProviders[0];
            setChatProvider(next);
            setChatModel(defaultModelForProvider(next, 'advanced'));
        }
    }, [configuredProviders, chatProvider, settings.aiProvider]);

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

    /**
     * Build the tool runtime deps. Same shape as ChatPanel.buildToolDeps;
     * factored as an inline closure because InlineChat's cell list can be
     * either the `cells` prop (when App threads it through) or `allCells`
     * which we already have for legacy notebook-context flow.
     */
    const buildToolDeps = useCallback((): ToolDeps => {
        const cellSnapshot = cells ?? allCells;
        const snapshotForRuntime = cellSnapshot.map(c => ({ id: c.id, type: cellPrimaryType(c.content), content: c.content }));
        return {
            duckdbQuery: async (sqlText: string) => {
                const rows = await query(sqlText);
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
                        // Replace the plot block content within the cell (or append if absent).
                        // Use segment-based reconstruction to target the exact Nth plot block
                        // rather than a regex that may match the wrong one in multi-plot cells.
                        const cell = cellSnapshot.find(c => c.id === op.cellId);
                        if (!cell) return { ok: false, error: `cell not found: ${op.cellId}` };
                        const segs = tokenizeCellContent(cell.content);
                        const plotIdx = segs.findIndex(s => s.type === 'plot');
                        let newContent: string;
                        if (plotIdx === -1) {
                            newContent = cell.content + '\n\n```plot\n' + op.plotConfig + '\n```\n';
                        } else {
                            const updatedSegs = segs.map((s, i) =>
                                i === plotIdx ? { ...s, content: '\n' + op.plotConfig + '\n' } : s
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
                const pending = proposalsRef.current.find(p => p.name === toolName && p.status === 'pending' && shallowEqualArgs(p.args, args));
                if (!pending) {
                    const id = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    setProposals(prev => [...prev, { id, name: toolName, args, status: 'pending' }]);
                    approvalResolvers.current.set(id, { resolve, reject });
                    return;
                }
                approvalResolvers.current.set(pending.id, { resolve, reject });
            }),
        };
    }, [cells, allCells, onAddCell, onUpdateCell, query]);

    const handleReset = () => {
        setMessages([]);
        setProposals([]);
        setApproveAllReads(false);
        approvalResolvers.current.forEach(r => r.reject(new Error('cancelled')));
        approvalResolvers.current.clear();
        setIsLoading(false);
    };

    const handleSendLegacy = async (inputText: string, effectiveVisibility: VisibilityMode) => {
        // Legacy path — used when the active provider has no tool support
        // (e.g. browser model) or when the upstream cells aren't threaded
        // through so tool-mutations would be no-ops anyway.
        const otherCells = allCells.filter(c => c.id !== cellContext.id);
        const fullNotebookContext = useFullContext ? otherCells.map(c => `### ${c.title}\n\n${c.content}`).join('\n\n---\n\n') : undefined;
        const recentResult = buildRecentResultFromRows(data);
        const aiResponse = await aiService.getAiInlineSuggestion(
            inputText,
            targetType,
            targetValue,
            cellContext.content,
            fullNotebookContext,
            data || undefined,
            metadata.customSystemPrompt,
            effectiveVisibility,
            recentResult,
        );
        const aiMessage: ChatMessage = { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: aiResponse.text, code: aiResponse.code, isActionable: !!aiResponse.code };
        setMessages(prev => [...prev, aiMessage]);
    };

    const handleSend = async () => {
        if (input.trim() === '' || isLoading) return;

        const userMessage: ChatMessage = { id: Date.now().toString(), sender: MessageSender.User, text: input };
        setMessages(prev => [...prev, userMessage]);
        const inputText = input;
        setInput('');
        setIsLoading(true);
        setProposals([]);
        proposalsRef.current = [];
        setApproveAllReads(false);
        approveAllReadsRef.current = false;
        // Reject any pending resolvers before clearing so they don't leak or hang.
        approvalResolvers.current.forEach(r => r.reject(new Error('cancelled')));
        approvalResolvers.current.clear();

        const effectiveVisibility = resolveVisibility(useFullContext, chatVisibility);

        try {
            // Browser provider has no tool support; fall back to legacy
            // single-turn inline suggestion. Same path used when the active
            // provider isn't tool-capable.
            if (chatProvider === 'browser') {
                await handleSendLegacy(inputText, effectiveVisibility);
                return;
            }

            const deps = buildToolDeps();
            const wrappedDeps: ToolDeps = {
                ...deps,
                requireApproval: (toolName: string, args: any) => new Promise<void>((resolve, reject) => {
                    const pending = [...proposalsRef.current].reverse().find(p => p.name === toolName && p.status === 'pending');
                    if (pending) {
                        approvalResolvers.current.set(pending.id, { resolve, reject });
                        return;
                    }
                    const id = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    setProposals(prev => [...prev, { id, name: toolName, args, status: 'pending' }]);
                    approvalResolvers.current.set(id, { resolve, reject });
                }),
            };

            const recentResult = buildRecentResultFromRows(data);

            // Build the conversation history from existing messages plus the
            // user's new input. We prepend a system-style turn that pins the
            // current cell context so the model can answer "what's the median
            // pause time" by looking at the relevant cell.
            const toolHistory: ToolChatMessage[] = messages.map(m => ({
                role: m.sender === MessageSender.User ? 'user' : 'assistant',
                content: m.text + (m.code ? `\n\`\`\`${targetType}\n${m.code}\n\`\`\`` : ''),
            }));
            toolHistory.push({
                role: 'user',
                content: `In this notebook cell I am editing a ${targetType} block:\n\n\`\`\`${targetType}\n${targetValue}\n\`\`\`\n\n${inputText}`,
            });

            let assistantBuf = '';
            const stream = aiService.streamChatWithTools(
                toolHistory,
                null, // No global schema bundle from InlineChat — tools can fetch via describeTable.
                TOOLS as Tool[],
                wrappedDeps,
                {
                    visibility: effectiveVisibility,
                    recentResult,
                    tier: 'advanced' as AiTier,
                    feature: 'chat',
                    providerOverride: chatProvider,
                    modelOverride: chatModel,
                },
            );

            for await (const chunk of stream) {
                if (chunk.kind === 'text') {
                    assistantBuf += chunk.delta;
                } else if (chunk.kind === 'tool_call') {
                    const tool = TOOLS.find(t => t.name === chunk.name);
                    const record: ApprovalRecord = { id: chunk.id, name: chunk.name, args: chunk.args, status: 'pending' };
                    setProposals(prev => [...prev, record]);
                    proposalsRef.current = [...proposalsRef.current, record];

                    if (tool?.kind === 'read') {
                        const proposal = chooseProposalKind(tool, chunk.args, {
                            visibility: effectiveVisibility,
                            approveAllReads: approveAllReadsRef.current,
                            existingCellContent: undefined,
                        });
                        if (proposal.kind === 'auto-read') {
                            setProposals(prev => applyApprovalAction(prev, { type: 'approve', id: chunk.id }));
                        }
                    }
                } else if (chunk.kind === 'tool_result') {
                    setProposals(prev => applyApprovalAction(prev, { type: 'complete', id: chunk.id, result: chunk.result }));
                }
            }

            if (assistantBuf.trim()) {
                setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: assistantBuf.trim() }]);
            }
        } catch (error: any) {
            // Tool-calling path may throw if the provider doesn't support
            // tools (e.g. local server without tool support). Fall back to
            // the legacy inline suggestion which is broadly compatible.
            const msg = String(error?.message || error);
            if (/does not support tool calling/i.test(msg)) {
                try {
                    await handleSendLegacy(inputText, effectiveVisibility);
                } catch (e2: any) {
                    setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `Error: ${e2?.message || e2}` }]);
                }
            } else {
                const errorMessage: ChatMessage = { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `Sorry, I encountered an error: ${msg}` };
                setMessages(prev => [...prev, errorMessage]);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const cellById = useMemo(() => {
        const m = new Map<string, NotebookCellData>();
        (cells ?? allCells).forEach(c => m.set(c.id, c));
        return m;
    }, [cells, allCells]);

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
            <div className="flex-shrink-0 flex items-center justify-between flex-wrap gap-2">
                <h6 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Refine with AI</h6>
                <div className="flex items-center gap-1 flex-wrap">
                    <label className="text-[10px] uppercase tracking-wider text-gray-500" htmlFor={`inline-provider-${cellContext.id}`}>Provider</label>
                    <select
                        id={`inline-provider-${cellContext.id}`}
                        aria-label="Chat provider"
                        value={chatProvider}
                        onChange={e => { const p = e.target.value as AiProviderType; setChatProvider(p); setChatModel(defaultModelForProvider(p, 'advanced')); }}
                        disabled={configuredProviders.length === 0}
                        className="bg-gray-800/60 border border-gray-600 rounded text-xs px-1.5 py-0.5 text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    >
                        {configuredProviders.length === 0 && <option value="">No providers configured</option>}
                        {configuredProviders.map(id => (<option key={id} value={id}>{providerMetadataRegistry[id].name}</option>))}
                    </select>
                    <label className="text-[10px] uppercase tracking-wider text-gray-500" htmlFor={`inline-model-${cellContext.id}`}>Model</label>
                    {isFreeFormModel ? (
                        <input
                            id={`inline-model-${cellContext.id}`}
                            type="text"
                            aria-label="Chat model"
                            value={chatModel}
                            onChange={e => setChatModel(e.target.value)}
                            className="bg-gray-800/60 border border-gray-600 rounded text-xs px-1.5 py-0.5 text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 w-28"
                        />
                    ) : (
                        <select
                            id={`inline-model-${cellContext.id}`}
                            aria-label="Chat model"
                            value={chatModel}
                            onChange={e => setChatModel(e.target.value)}
                            className="bg-gray-800/60 border border-gray-600 rounded text-xs px-1.5 py-0.5 text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        >
                            {(providerMeta?.models ?? []).map(m => (<option key={m.id} value={m.id}>{m.name}</option>))}
                        </select>
                    )}
                    <label className="text-[10px] uppercase tracking-wider text-gray-500" htmlFor={`inline-vis-${cellContext.id}`}>See</label>
                    <select
                        id={`inline-vis-${cellContext.id}`}
                        aria-label="AI data visibility"
                        value={chatVisibility}
                        onChange={e => setChatVisibility(e.target.value as VisibilityMode)}
                        title="Controls what slice of the cell's data the AI can see"
                        className="bg-gray-800/60 border border-gray-600 rounded text-xs px-1.5 py-0.5 text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    >
                        <option value="no-data">No data</option>
                        <option value="sanitized">Sanitized</option>
                        <option value="full">Full</option>
                    </select>
                    <button onClick={handleReset} title="Reset Chat" className="p-1 hover:bg-gray-700 rounded-md"><ArrowCounterclockwiseIcon className="w-4 h-4 text-gray-500 hover:text-cyan-400"/></button>
                    <button onClick={onClose} title="Close Chat" className="p-1 hover:bg-gray-700 rounded-md"><XMarkIcon className="w-4 h-4 text-gray-500"/></button>
                </div>
            </div>
            <div className="space-y-4">
                {messages.length === 0 && (<p className="text-sm text-center text-gray-500 p-4">Ask the AI to modify your {targetType} code.</p>)}
                {messages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.sender === MessageSender.User ? 'justify-end':'justify-start'}`}>
                        <div className={`max-w-xs md:max-w-sm rounded-lg p-2 text-sm ${msg.sender===MessageSender.User ? 'bg-cyan-800/70 text-gray-100' : 'bg-gray-700/50 text-gray-300'}`}>
                            <p>{msg.text}</p>
                            {msg.code && <CodeBlock code={msg.code} isActionable={msg.isActionable}/>}
                        </div>
                    </div>
                ))}
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
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-gray-700/50 rounded-lg p-3 inline-flex items-center space-x-2">
                            <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></span>
                            <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse delay-150"></span>
                            <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse delay-300"></span>
                        </div>
                    </div>
                )}
            </div>
            <div className="flex-shrink-0 space-y-2">
                <button onClick={() => setUseFullContext(!useFullContext)} className={`w-full flex items-center justify-center gap-2 text-xs p-1.5 rounded-md ${useFullContext ? 'bg-purple-600/30 text-purple-300' : 'bg-gray-700/50 hover:bg-gray-700 text-gray-400'}`} title="Deprecated: equivalent to setting visibility = 'full'">
                    <BookOpenIcon className="w-4 h-4"/>{useFullContext?'Full notebook context is enabled':'Add full notebook context'}
                </button>
                <div className="relative">
                    <input type="text" value={input} onChange={e=>setInput(e.target.value)} onKeyPress={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend();}}} placeholder={`Ask AI to change ${targetType}...`} className="w-full bg-gray-800/50 border border-gray-600 rounded-lg py-2 pl-3 pr-10 focus:outline-none focus:ring-1 focus:ring-cyan-500 text-sm" disabled={isLoading} autoFocus/>
                    <button onClick={handleSend} className="absolute top-1/2 right-2 -translate-y-1/2 p-1.5 bg-cyan-600 hover:bg-cyan-700 rounded-md disabled:bg-gray-600" disabled={isLoading||input.trim()===''}><SendIcon className="w-4 h-4 text-white"/></button>
                </div>
            </div>
        </div>
    );
};

export default InlineChat;
